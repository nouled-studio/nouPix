#!/usr/bin/env python3
"""
nouPix - local server and Art-Net bridge.

Browsers cannot send UDP, so this script does the network side:
  * serves the mapper interface (index.html) on http://127.0.0.1:<port>/
  * opens it in its own Chrome/Edge window, which keeps running when hidden
  * receives pixel frames from the interface over a WebSocket
  * sends them to your controllers as Art-Net ArtDmx packets (UDP 6454)
  * runs ArtPoll discovery and reports the nodes it finds
  * with Remote control on (Settings), lets phones, tablets and other computers on the network use it too
  * receives NDI and OMT video streams for the interface, when their libraries are installed

Python 3.8+ and the standard library only. No installs needed.

    python3 noupix.py                    # start and open it in its own browser window
    python3 noupix.py --port 9000        # different web port
    python3 noupix.py --bind-ip 2.0.0.10 # send Art-Net from a specific network card
    python3 noupix.py --default-browser  # use your normal browser instead of its own window
    python3 noupix.py --no-browser
    python3 noupix.py --background       # no terminal needed: see BACKGROUND below

The downloadable apps (desktop/) are an Electron window around the interface. They run this script,
packed with PyInstaller (noupix.spec), with --embedded.
"""

import argparse
import base64
import hashlib
import hmac
import http.client
import http.server
import json
import os
import re
import secrets
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser

VERSION = "1.1.0"
HERE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
ARTNET_PORT = 6454
WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ARTNET_ID = b"Art-Net\x00"
OP_POLL, OP_POLL_REPLY, OP_DMX, OP_SYNC = 0x2000, 0x2100, 0x5000, 0x5200
HOLD_AFTER = 1.0   # seconds without frames from the page before the bridge starts repeating the last one
HOLD_EVERY = 0.5   # how often the held frame is repeated, so controllers don't time out


def log(msg):
    try:
        print("  %s  %s" % (time.strftime("%H:%M:%S"), msg), flush=True)
    except (OSError, ValueError):  # the terminal or the app that read the output is gone
        pass


# --------------------------------------------------------------------------- Art-Net

class ArtNet:
    def __init__(self, bind_ip="0.0.0.0", bind_port=ARTNET_PORT):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # No SO_REUSEADDR: on Windows it lets two programs share UDP 6454, and then neither reliably
        # receives. Without it, a busy port is detected and nouPix falls back to sending without discovery.
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        if hasattr(socket, "SIO_UDP_CONNRESET"):  # Windows: ignore ICMP port-unreachable resets
            try:
                self.sock.ioctl(socket.SIO_UDP_CONNRESET, False)
            except (OSError, ValueError):
                pass
        self.bind_error = None
        try:
            self.sock.bind((bind_ip, bind_port))
        except OSError as e:
            self.bind_error = "port %d unavailable (%s) - is another Art-Net app running?" % (bind_port, e.strerror or e)
            self.sock.bind((bind_ip, 0))
        self.bind_ip, self.bind_port = self.sock.getsockname()
        # Replies to ArtPoll arrive on 6454, so discovery only works when we own that port.
        self.discovery = self.bind_port == ARTNET_PORT
        self.discovery_note = "" if self.discovery else (
            self.bind_error or "listening on UDP %d instead of %d (--bind-port)" % (self.bind_port, ARTNET_PORT))
        self.seq = {}
        # Frames come from the page's connection, and from the hold loop when the page stalls: one at a time
        self.send_lock = threading.Lock()
        self.packets = 0
        self.frames = 0
        self.last_frame = 0.0
        self.errors = 0
        self.last_error = ""
        self.nodes = {}
        self.listeners = set()
        self.owner = None  # the window allowed to send: the last one that switched Art-Net on
        self.held = None   # last frame from the owner, repeated if the window stalls
        self.holding = False
        threading.Thread(target=self._recv_loop, daemon=True).start()
        threading.Thread(target=self._hold_loop, daemon=True).start()

    def set_output(self, ws, on):
        if on:
            if self.owner is not None and self.owner is not ws:
                self.owner.send_json({"t": "takeover"})  # two windows must not fight over the same universes
            self.owner, self.held, self.last_frame = ws, None, time.time()
        elif self.owner is ws:
            self.owner = None

    def frame_from(self, ws, payload):
        if ws is not self.owner:
            return
        self.send_frame(payload)
        self.frames += 1
        self.held, self.last_frame = payload, time.time()
        if self.holding:
            self.holding = False
            log("Frames from the nouPix window resumed.")

    def send_frame(self, p):
        # [u8 type=1][u8 flags][u16 count] then count x ([4 ip][u16 universe][u16 length][data])
        if len(p) < 4 or p[0] != 1:
            return
        flags, count = p[1], struct.unpack_from("<H", p, 2)[0]
        off, ips = 4, []
        with self.send_lock:
            for _ in range(count):
                if off + 8 > len(p):
                    break
                ip = socket.inet_ntoa(p[off:off + 4])
                uni, n = struct.unpack_from("<HH", p, off + 4)
                off += 8
                self.send_dmx(ip, uni, p[off:off + min(n, 512)])  # ArtDmx carries at most 512 channels
                off += n
                if ip not in ips:
                    ips.append(ip)
            if flags & 1:
                self.send_sync(ips)

    def _hold_loop(self):
        # If the page stops sending (window minimised, asleep, busy) keep repeating its last frame,
        # so controllers that blank on signal loss keep showing the last look.
        last = 0.0
        while True:
            time.sleep(0.1)
            now = time.time()
            if self.owner is None or self.held is None or now - self.last_frame < HOLD_AFTER:
                continue
            if not self.holding:
                self.holding = True
                log("No frames from the nouPix window for %.0f s: repeating the last frame. "
                    "Is the window minimised, or the computer asleep?" % HOLD_AFTER)
            if now - last >= HOLD_EVERY:
                last = now
                self.send_frame(self.held)

    def send_dmx(self, ip, universe, data):
        key = (ip, universe)
        seq = self.seq.get(key, 0) % 255 + 1  # 1..255, 0 means "sequencing off"
        self.seq[key] = seq
        n = len(data)
        if n % 2:
            data = data + b"\x00"
            n += 1
        pkt = (ARTNET_ID + struct.pack("<H", OP_DMX) + bytes((0, 14, seq, 0, universe & 0xFF, (universe >> 8) & 0x7F))
               + struct.pack(">H", n) + data)
        try:
            self.sock.sendto(pkt, (ip, ARTNET_PORT))
            self.packets += 1
        except OSError as e:
            self.errors += 1
            self.last_error = "%s: %s" % (ip, e.strerror or e)

    def send_sync(self, ips):
        pkt = ARTNET_ID + struct.pack("<H", OP_SYNC) + bytes((0, 14, 0, 0))
        for ip in ips:
            try:
                self.sock.sendto(pkt, (ip, ARTNET_PORT))
                self.packets += 1
            except OSError as e:
                self.errors += 1
                self.last_error = "%s: %s" % (ip, e.strerror or e)

    def poll(self, address):
        pkt = ARTNET_ID + struct.pack("<H", OP_POLL) + bytes((0, 14, 0, 0))
        try:
            self.sock.sendto(pkt, (address, ARTNET_PORT))
            return None
        except OSError as e:
            return "ArtPoll to %s failed: %s" % (address, e.strerror or e)

    def _recv_loop(self):
        while True:
            try:
                data, addr = self.sock.recvfrom(2048)
            except OSError:
                time.sleep(0.05)
                continue
            if len(data) < 10 or data[:8] != ARTNET_ID:
                continue
            if struct.unpack("<H", data[8:10])[0] == OP_POLL_REPLY:
                node = parse_poll_reply(data, addr)
                if node:
                    key = "%s#%d" % (node["ip"], node["bindIndex"])
                    self.nodes[key] = node
                    for fn in list(self.listeners):
                        try:
                            fn(node)
                        except Exception:
                            pass


def parse_poll_reply(d, addr):
    if len(d) < 197:
        return None
    text = lambda b: b.split(b"\x00")[0].decode("latin-1", "replace").strip()
    net, sub = d[18] & 0x7F, d[19] & 0x0F
    nports = min(d[173], 4)
    outs = []
    for i in range(nports):
        if d[174 + i] & 0x80:  # port can output DMX
            outs.append((net << 8) | (sub << 4) | (d[190 + i] & 0x0F))
    return {
        "ip": socket.inet_ntoa(d[10:14]) if d[10:14] != b"\x00\x00\x00\x00" else addr[0],
        "from": addr[0],
        "shortName": text(d[26:44]),
        "longName": text(d[44:108]),
        "report": text(d[108:172]),
        "ports": nports,
        "outUniverses": outs,
        "mac": ":".join("%02x" % b for b in d[201:207]) if len(d) >= 207 else "",
        "bindIndex": d[211] if len(d) >= 212 else 0,
        "seen": time.time(),
    }


# --------------------------------------------------------------------------- WebSocket

def unmask(data, mask):
    n = len(data)
    m = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "little") ^ int.from_bytes(m, "little")).to_bytes(n, "little")


class WebSocket:
    def __init__(self, rfile, wfile):
        self.r, self.w = rfile, wfile
        self.lock = threading.Lock()
        self.alive = True

    def _read(self, n):
        b = self.r.read(n)
        if not b or len(b) < n:
            raise ConnectionError("closed")
        return b

    def recv(self):
        op0, buf = None, b""
        while True:
            b0, b1 = self._read(2)
            fin, op, n = b0 & 0x80, b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            if n > 32 * 1024 * 1024:
                raise ConnectionError("frame too large")
            mask = self._read(4) if b1 & 0x80 else None
            data = self._read(n) if n else b""
            if mask:
                data = unmask(data, mask)
            if op == 8:
                raise ConnectionError("closed by client")
            if op == 9:
                self.send(data, 0xA)
                continue
            if op == 0xA:
                continue
            if op:
                op0, buf = op, data
            else:
                buf += data
            if fin:
                return op0, buf

    def send(self, data, op=1):
        if isinstance(data, str):
            data = data.encode("utf-8")
        n = len(data)
        if n < 126:
            hdr = bytes((0x80 | op, n))
        elif n < 65536:
            hdr = bytes((0x80 | op, 126)) + struct.pack(">H", n)
        else:
            hdr = bytes((0x80 | op, 127)) + struct.pack(">Q", n)
        with self.lock:
            if not self.alive:
                return
            try:
                self.w.write(hdr + data)
            except OSError:
                self.alive = False

    def send_json(self, obj):
        self.send(json.dumps(obj))


# --------------------------------------------------------------------------- video from the network (NDI, OMT)
# A browser can't receive NDI or OMT, so the bridge does: it loads the library the user has installed (NDI Tools or the
# NDI runtime; libomt for Open Media Transport; nothing is bundled) with ctypes, lists the sources on the network and
# receives the ones a window plays.
# The window asks with {"t": "vin", "op": "find"} and {"t": "vin", "op": "sub", "subs": [{"proto", "name", "hq"}]};
# each stream has a thread that keeps its newest frame, and each window a thread that sends them as binary messages:
#   b"VIN1" | key length (1 byte) | key (utf-8) | width, height (2 bytes each, big-endian) | RGBA pixels, row by row
# A frame goes only once the one before it has gone out, so a slow page gets fewer frames, never a queue. Pixel
# mapping needs few pixels: by default the source's small preview stream (about 640 wide), and every frame is cut
# down to VIN_MAX_W (or VIN_MAX_W_HQ for full quality) by taking every n-th pixel.

VIN_MAX_W, VIN_MAX_W_HQ = 640, 1920
VIN_MAGIC = b"VIN1"


def ndi_library_paths():
    """Where the NDI library may be, most likely first."""
    env = os.environ.get("NOUPIX_NDI_LIB")
    paths = [env] if env else []
    if os.name == "nt":
        for v in ("NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5", "NDI_RUNTIME_DIR_V4"):
            if os.environ.get(v):
                paths.append(os.path.join(os.environ[v], "Processing.NDI.Lib.x64.dll"))
        for d in (r"C:\Program Files\NDI\NDI 6 Runtime\v6", r"C:\Program Files\NDI\NDI 5 Runtime\v5",
                  r"C:\Program Files\NDI\NDI 6 Tools\Runtime", r"C:\Program Files\NDI\NDI 5 Tools\Runtime"):
            paths.append(os.path.join(d, "Processing.NDI.Lib.x64.dll"))
        paths.append("Processing.NDI.Lib.x64.dll")
    elif sys.platform == "darwin":
        for v in ("NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5"):
            if os.environ.get(v):
                paths.append(os.path.join(os.environ[v], "libndi.dylib"))
        paths += ["/usr/local/lib/libndi.dylib", "/opt/homebrew/lib/libndi.dylib",
                  "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib", "/Library/NDI 6 SDK for Apple/lib/macOS/libndi.dylib",
                  "/Applications/NDI Video Monitor.app/Contents/Frameworks/libndi.dylib", "libndi.dylib"]
    else:
        for d in ("", "/usr/lib/", "/usr/local/lib/", "/usr/lib/x86_64-linux-gnu/", "/usr/lib/aarch64-linux-gnu/"):
            paths += [d + "libndi.so.6", d + "libndi.so.5", d + "libndi.so"]
    return paths


class Ndi:
    """The parts of the NDI library nouPix uses: finding sources and receiving video as RGBA."""
    proto = "ndi"

    def __init__(self, path=None):
        self.lib, self.note, self.finder, self.urls = None, "", None, {}
        self.lock = threading.Lock()
        try:
            import ctypes
        except ImportError:
            self.note = "This Python can't load libraries."
            return
        self.C = ctypes
        lib = None
        for p in ([path] if path else ndi_library_paths()):
            try:
                lib = ctypes.CDLL(p)
                self.path = p
                break
            except OSError:
                continue
        if lib is None:
            self.note = "NDI isn't installed on this computer. Install NDI Tools (free, from ndi.video) and restart nouPix."
            return
        C = ctypes

        class Source(C.Structure):
            _fields_ = [("p_ndi_name", C.c_char_p), ("p_url_address", C.c_char_p)]

        class FindCreate(C.Structure):
            _fields_ = [("show_local_sources", C.c_bool), ("p_groups", C.c_char_p), ("p_extra_ips", C.c_char_p)]

        class RecvCreate(C.Structure):
            _fields_ = [("source_to_connect_to", Source), ("color_format", C.c_int), ("bandwidth", C.c_int),
                        ("allow_video_fields", C.c_bool), ("p_ndi_recv_name", C.c_char_p)]

        class VideoFrame(C.Structure):
            _fields_ = [("xres", C.c_int), ("yres", C.c_int), ("FourCC", C.c_uint32), ("frame_rate_N", C.c_int),
                        ("frame_rate_D", C.c_int), ("picture_aspect_ratio", C.c_float), ("frame_format_type", C.c_int),
                        ("timecode", C.c_int64), ("p_data", C.c_void_p), ("line_stride_in_bytes", C.c_int),
                        ("p_metadata", C.c_char_p), ("timestamp", C.c_int64)]
        self.Source, self.FindCreate, self.RecvCreate, self.VideoFrame = Source, FindCreate, RecvCreate, VideoFrame
        try:
            sig = {
                "NDIlib_initialize": (C.c_bool, []),
                "NDIlib_find_create_v2": (C.c_void_p, [C.POINTER(FindCreate)]),
                "NDIlib_find_get_current_sources": (C.POINTER(Source), [C.c_void_p, C.POINTER(C.c_uint32)]),
                "NDIlib_recv_create_v3": (C.c_void_p, [C.POINTER(RecvCreate)]),
                "NDIlib_recv_destroy": (None, [C.c_void_p]),
                "NDIlib_recv_capture_v2": (C.c_int, [C.c_void_p, C.POINTER(VideoFrame), C.c_void_p, C.c_void_p, C.c_uint32]),
                "NDIlib_recv_free_video_v2": (None, [C.c_void_p, C.POINTER(VideoFrame)]),
            }
            for name, (res, args) in sig.items():
                f = getattr(lib, name)
                f.restype, f.argtypes = res, args
        except AttributeError:
            self.note = "The NDI library found is too old. Install NDI Tools 5 or newer."
            return
        if not lib.NDIlib_initialize():
            self.note = "NDI can't run on this computer's processor."
            return
        self.lib = lib

    def sources(self):
        """The names of the NDI sources seen on the network so far."""
        if not self.lib:
            return []
        C = self.C
        with self.lock:
            if not self.finder:
                # NOUPIX_NDI_EXTRA_IPS: computers to ask directly, where the network doesn't pass NDI's discovery
                extra = os.environ.get("NOUPIX_NDI_EXTRA_IPS")
                fc = self.FindCreate(True, None, extra.encode() if extra else None)
                self.finder = self.lib.NDIlib_find_create_v2(C.byref(fc))
                if not self.finder:
                    return []
            n = C.c_uint32(0)
            arr = self.lib.NDIlib_find_get_current_sources(self.finder, C.byref(n))
            # a receiver connects sooner with the source's address than by its name alone
            for i in range(n.value):
                if arr[i].p_ndi_name:
                    self.urls[arr[i].p_ndi_name.decode("utf-8", "replace")] = arr[i].p_url_address
            return sorted({arr[i].p_ndi_name.decode("utf-8", "replace") for i in range(n.value) if arr[i].p_ndi_name})

    def open(self, name, hq):
        """A receiver for one source, or None."""
        if not self.lib:
            return None
        C = self.C
        end = time.monotonic() + 3.0
        while name not in self.urls and time.monotonic() < end:   # a source just asked for: wait a moment to find where it is
            self.sources()
            if name not in self.urls:
                time.sleep(0.25)
        rc = self.RecvCreate(self.Source(name.encode("utf-8"), self.urls.get(name)), 2, 100 if hq else 0, False, b"nouPix")   # RGBX_RGBA; highest or lowest
        r = self.lib.NDIlib_recv_create_v3(C.byref(rc))
        return NdiReceiver(self, r) if r else None


class NdiReceiver:
    def __init__(self, ndi, r):
        self.ndi, self.r = ndi, r

    def capture(self, timeout_ms):
        """The next video frame as (width, height, stride, RGBA bytes), or None."""
        n, C = self.ndi, self.ndi.C
        vf = n.VideoFrame()
        if n.lib.NDIlib_recv_capture_v2(self.r, C.byref(vf), None, None, timeout_ms) != 1:   # 1: a video frame
            return None
        try:
            if not vf.p_data or vf.xres <= 0 or vf.yres <= 0:
                return None
            stride = vf.line_stride_in_bytes or vf.xres * 4
            return vf.xres, vf.yres, stride, C.string_at(vf.p_data, stride * vf.yres)
        finally:
            n.lib.NDIlib_recv_free_video_v2(self.r, C.byref(vf))

    def close(self):
        if self.r:
            self.ndi.lib.NDIlib_recv_destroy(self.r)
            self.r = None


def omt_library_paths():
    """Where the OMT library (libomt, with libvmx beside it) may be, most likely first."""
    env = os.environ.get("NOUPIX_OMT_LIB")
    paths = [env] if env else []
    name = "libomt.dll" if os.name == "nt" else "libomt.dylib" if sys.platform == "darwin" else "libomt.so"
    for d in (HERE, os.path.join(HERE, "omt"), os.path.join(os.path.expanduser("~"), ".noupix", "omt")):
        paths.append(os.path.join(d, name))
    if sys.platform == "darwin":
        paths += ["/usr/local/lib/libomt.dylib", "/opt/homebrew/lib/libomt.dylib"]
    elif os.name != "nt":
        paths += ["/usr/local/lib/libomt.so", "/usr/lib/libomt.so"]
    return paths + [name]


class Omt:
    """The parts of libomt (Open Media Transport) nouPix uses: finding sources and receiving video as BGRA."""
    proto, bgra = "omt", True

    def __init__(self, path=None):
        self.lib, self.note = None, ""
        self.lock = threading.Lock()
        import ctypes as C
        self.C = C
        lib = None
        for p in ([path] if path else omt_library_paths()):
            try:
                lib = C.CDLL(p)
                break
            except OSError:
                continue
        if lib is None:
            self.note = ("OMT isn't installed for nouPix. Put libomt and libvmx (from the Open Media Transport releases) "
                         "in the folder ~/.noupix/omt and restart nouPix.")
            return

        class MediaFrame(C.Structure):   # OMTMediaFrame in libomt.h
            _fields_ = [("Type", C.c_int), ("Timestamp", C.c_int64), ("Codec", C.c_int), ("Width", C.c_int), ("Height", C.c_int),
                        ("Stride", C.c_int), ("Flags", C.c_int), ("FrameRateN", C.c_int), ("FrameRateD", C.c_int),
                        ("AspectRatio", C.c_float), ("ColorSpace", C.c_int), ("SampleRate", C.c_int), ("Channels", C.c_int),
                        ("SamplesPerChannel", C.c_int), ("Data", C.c_void_p), ("DataLength", C.c_int),
                        ("CompressedData", C.c_void_p), ("CompressedLength", C.c_int),
                        ("FrameMetadata", C.c_void_p), ("FrameMetadataLength", C.c_int)]
        self.MediaFrame = MediaFrame
        try:
            sig = {
                "omt_discovery_getaddresses": (C.POINTER(C.c_char_p), [C.POINTER(C.c_int)]),
                "omt_receive_create": (C.c_void_p, [C.c_char_p, C.c_int, C.c_int, C.c_int]),
                "omt_receive_destroy": (None, [C.c_void_p]),
                "omt_receive": (C.POINTER(MediaFrame), [C.c_void_p, C.c_int, C.c_int]),
            }
            for name, (res, args) in sig.items():
                f = getattr(lib, name)
                f.restype, f.argtypes = res, args
        except AttributeError:
            self.note = "The OMT library found isn't one nouPix can use."
            return
        self.lib = lib

    def sources(self):
        if not self.lib:
            return []
        C = self.C
        with self.lock:
            n = C.c_int(0)
            arr = self.lib.omt_discovery_getaddresses(C.byref(n))
            return sorted({arr[i].decode("utf-8", "replace") for i in range(max(0, n.value)) if arr and arr[i]})

    def open(self, name, hq):
        if not self.lib:
            return None
        # video only, BGRA, the 1/8 preview unless full quality is asked for
        r = self.lib.omt_receive_create(name.encode("utf-8"), 2, 2, 0 if hq else 1)
        return OmtReceiver(self, r) if r else None


class OmtReceiver:
    def __init__(self, omt, r):
        self.omt, self.r = omt, r

    def capture(self, timeout_ms):
        """The next video frame as (width, height, stride, BGRA bytes), or None. The data is libomt's until the next call."""
        lib, C = self.omt.lib, self.omt.C
        p = lib.omt_receive(self.r, 2, timeout_ms)
        if not p:
            return None
        f = p.contents
        if f.Type != 2 or not f.Data or f.Width <= 0 or f.Height <= 0 or f.Codec not in (0x41524742, 0x58524742):   # BGRA, BGRX
            return None
        stride = f.Stride or f.Width * 4
        return f.Width, f.Height, stride, C.string_at(f.Data, stride * f.Height)

    def close(self):
        if self.r:
            self.omt.lib.omt_receive_destroy(self.r)
            self.r = None


def bgra_to_rgba(data):
    b = bytearray(data)
    b[0::4], b[2::4] = data[2::4], data[0::4]
    return bytes(b)


def shrink_rgba(w, h, stride, data, max_w):
    """Takes every n-th pixel of every n-th row, so the frame is at most max_w wide, the rows packed tightly."""
    import array
    k = -(-w // max_w)
    if k == 1 and stride == w * 4:
        return w, h, data
    if stride % 4:
        data, stride = b"".join(data[y * stride:y * stride + w * 4] for y in range(h)), w * 4
    px, out, W = array.array("I"), array.array("I"), stride // 4
    px.frombytes(data[:W * 4 * h])
    for y in range(0, h, k):
        out.extend(px[y * W:y * W + w:k])
    return len(range(0, w, k)), len(range(0, h, k)), out.tobytes()


class Stream:
    """One source being received: a thread that keeps its newest frame."""

    def __init__(self, backend, key, name, hq):
        self.backend, self.key, self.name, self.hq = backend, key, name, hq
        self.frame, self.seq, self.state, self.size = None, 0, "connecting", None
        self.frames, self.users, self.alive = 0, 0, True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        rx, last = None, time.monotonic()
        while self.alive:
            if rx is None:
                rx = self.backend.open(self.name, self.hq)
                if rx is None:
                    self.state = "error"
                    time.sleep(1.0)
                    continue
            f = rx.capture(250)
            now = time.monotonic()
            if f is None:
                if now - last > 2.0:
                    self.state = "waiting"
                if now - last > 6.0:   # connect again: the source may have moved, or been found only now
                    rx.close()
                    rx, last = None, now
                    getattr(self.backend, "urls", {}).pop(self.name, None)
                continue
            w, h, data = shrink_rgba(*f, VIN_MAX_W_HQ if self.hq else VIN_MAX_W)
            if getattr(self.backend, "bgra", False):
                data = bgra_to_rgba(data)
            last, self.state, self.size = now, "ok", (w, h)
            with VIN_CHANGED:
                self.frame, self.seq, self.frames = (w, h, data), self.seq + 1, self.frames + 1
                VIN_CHANGED.notify_all()
        if rx:
            rx.close()


VIN_CHANGED = threading.Condition()


class VideoIn:
    """The streams the windows play, shared between them."""

    def __init__(self, ndi_path=None, omt_path=None):
        self.ndi_path, self.omt_path, self._backends = ndi_path, omt_path, None
        self.streams, self.lock = {}, threading.RLock()

    @property
    def backends(self):
        # loaded when a window first asks, so starting nouPix never waits for them
        with self.lock:
            if self._backends is None:
                self._backends = {"ndi": Ndi(self.ndi_path), "omt": Omt(self.omt_path)}
            return self._backends

    def info(self):
        return {p: {"ok": bool(b.lib), "note": b.note} for p, b in self.backends.items()}

    def find(self):
        out = []
        for p, b in self.backends.items():
            out += [{"proto": p, "name": n} for n in b.sources()]
        return out

    def window(self, ws):
        """Called once per window: returns the function its messages go to, and the one to call when it closes."""
        subs = {}   # key -> [stream, last seq sent]

        def message(msg):
            if msg.get("op") == "find":
                ws.send_json({"t": "vin", "sources": self.find(), "info": self.info()})
            elif msg.get("op") == "sub" and isinstance(msg.get("subs"), list):
                want = {}
                for s in msg["subs"][:16]:
                    if isinstance(s, dict) and s.get("proto") in self.backends and isinstance(s.get("name"), str) and s["name"]:
                        name, hq = s["name"][:120], s.get("hq") is True
                        want["%s|%s|%d" % (s["proto"], name, hq)] = (s["proto"], name, hq)
                with self.lock:
                    for key in [k for k in subs if k not in want]:
                        self._release(subs.pop(key)[0])
                    for key, (p, name, hq) in want.items():
                        if key not in subs:
                            st = self.streams.get(key)
                            if not st:
                                st = self.streams[key] = Stream(self.backends[p], key, name, hq)
                            st.users += 1
                            subs[key] = [st, 0]
                with VIN_CHANGED:
                    VIN_CHANGED.notify_all()

        def send_loop():
            last_status = 0.0
            while ws.alive:
                with VIN_CHANGED:
                    VIN_CHANGED.wait(0.5)
                with self.lock:
                    items = list(subs.items())
                for key, s in items:
                    st = s[0]
                    if st.seq != s[1] and st.frame:
                        s[1] = st.seq
                        w, h, data = st.frame
                        k = key.encode("utf-8")
                        ws.send(VIN_MAGIC + bytes((len(k),)) + k + struct.pack(">HH", w, h) + data, 2)
                now = time.monotonic()
                if items and now - last_status > 1.0:
                    last_status = now
                    ws.send_json({"t": "vin", "status": {key: {"state": s[0].state, "size": s[0].size} for key, s in items}})

        def closed():
            with self.lock:
                for s in subs.values():
                    self._release(s[0])
                subs.clear()
        threading.Thread(target=send_loop, daemon=True).start()
        return message, closed

    def _release(self, st):
        st.users -= 1
        if st.users <= 0:
            st.alive = False
            self.streams.pop(st.key, None)


# --------------------------------------------------------------------------- HTTP handler

def local_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    for probe in ("8.8.8.8", "10.255.255.254", "2.255.255.254", "192.168.255.254"):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((probe, 9))  # no packet is sent; this just asks the OS for a route
            ips.add(s.getsockname()[0])
        except OSError:
            pass
        finally:
            s.close()
    ips.discard("0.0.0.0")
    return sorted(ips, key=lambda ip: (ip.startswith("127."), ip))


IPV4 = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def _posix_nets():
    """(name, ip, mask) of each IPv4 address on an interface that is up, from getifaddrs() (Linux, macOS)."""
    import ctypes
    import ctypes.util

    class sockaddr(ctypes.Structure):
        _fields_ = [("data", ctypes.c_ubyte * 16)]

    class ifaddrs(ctypes.Structure):
        pass
    ifaddrs._fields_ = [("ifa_next", ctypes.POINTER(ifaddrs)), ("ifa_name", ctypes.c_char_p), ("ifa_flags", ctypes.c_uint),
                        ("ifa_addr", ctypes.POINTER(sockaddr)), ("ifa_netmask", ctypes.POINTER(sockaddr))]
    libc = ctypes.CDLL(ctypes.util.find_library("c") or None)
    head = ctypes.POINTER(ifaddrs)()
    if libc.getifaddrs(ctypes.byref(head)) != 0:
        return []
    bsd = sys.platform == "darwin" or "bsd" in sys.platform   # their sockaddr starts with a length byte
    out = []
    try:
        cur = head
        while cur:
            a = cur.contents
            cur = a.ifa_next
            if not a.ifa_addr or not (a.ifa_flags & 1):   # IFF_UP
                continue
            d = bytes(a.ifa_addr.contents.data)
            if (d[1] if bsd else d[0] | d[1] << 8) != socket.AF_INET:
                continue
            m = bytes(a.ifa_netmask.contents.data) if a.ifa_netmask else b""
            # macOS shortens a netmask's sockaddr to the bytes that are set: missing bytes are 0
            mb = (m[4:max(4, min(8, m[0]))] if bsd and m else m[4:8]).ljust(4, b"\0")
            out.append(((a.ifa_name or b"").decode("utf-8", "replace"), socket.inet_ntoa(d[4:8]), socket.inet_ntoa(mb)))
    finally:
        libc.freeifaddrs(head)
    return out


def _windows_nets():
    """(name, ip, mask) of each IPv4 address of each network adapter, from GetAdaptersInfo()."""
    import ctypes
    from ctypes import wintypes

    class IP_ADDR_STRING(ctypes.Structure):
        pass
    IP_ADDR_STRING._fields_ = [("Next", ctypes.POINTER(IP_ADDR_STRING)), ("IpAddress", ctypes.c_char * 16),
                               ("IpMask", ctypes.c_char * 16), ("Context", wintypes.DWORD)]

    class IP_ADAPTER_INFO(ctypes.Structure):
        pass
    IP_ADAPTER_INFO._fields_ = [
        ("Next", ctypes.POINTER(IP_ADAPTER_INFO)), ("ComboIndex", wintypes.DWORD), ("AdapterName", ctypes.c_char * 260),
        ("Description", ctypes.c_char * 132), ("AddressLength", ctypes.c_uint), ("Address", ctypes.c_ubyte * 8),
        ("Index", wintypes.DWORD), ("Type", ctypes.c_uint), ("DhcpEnabled", ctypes.c_uint),
        ("CurrentIpAddress", ctypes.POINTER(IP_ADDR_STRING)), ("IpAddressList", IP_ADDR_STRING),
        ("GatewayList", IP_ADDR_STRING), ("DhcpServer", IP_ADDR_STRING), ("HaveWins", wintypes.BOOL),
        ("PrimaryWinsServer", IP_ADDR_STRING), ("SecondaryWinsServer", IP_ADDR_STRING),
        ("LeaseObtained", ctypes.c_int64), ("LeaseExpires", ctypes.c_int64)]
    get = ctypes.windll.iphlpapi.GetAdaptersInfo
    get.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
    size = ctypes.c_ulong(0)
    get(None, ctypes.byref(size))
    if not size.value:
        return []
    buf = ctypes.create_string_buffer(size.value)
    if get(buf, ctypes.byref(size)) != 0:
        return []
    out = []
    p = ctypes.cast(buf, ctypes.POINTER(IP_ADAPTER_INFO))
    while p:
        a = p.contents
        name = a.Description.decode("mbcs", "replace")
        node = a.IpAddressList
        while True:
            out.append((name, node.IpAddress.decode("ascii", "replace"), node.IpMask.decode("ascii", "replace")))
            if not node.Next:
                break
            node = node.Next.contents
        p = a.Next
    return out


def network_interfaces():
    """This computer's IPv4 networks, for discovery: name, address, mask and the network's broadcast address.
    Loopback is left out. Where the system can't be asked, the known addresses get the usual masks
    (255.0.0.0 for the 2.x and 10.x Art-Net ranges, 255.255.255.0 otherwise) and are marked as guessed."""
    try:
        raw, guessed = (_windows_nets() if os.name == "nt" else _posix_nets()), False
    except Exception as e:
        log("Could not list the network interfaces (%s); guessing their masks." % e)
        raw = []
    if not raw:
        raw, guessed = [("", ip, "255.0.0.0" if ip.split(".")[0] in ("2", "10") else "255.255.255.0") for ip in local_ips()], True
    nets, seen = [], set()
    for name, ip, mask in raw:
        if not IPV4.match(ip) or not IPV4.match(mask) or ip in seen or ip.startswith("127.") or ip == "0.0.0.0" or mask == "255.255.255.255":
            continue
        seen.add(ip)
        a, m = struct.unpack("!I", socket.inet_aton(ip))[0], struct.unpack("!I", socket.inet_aton(mask))[0]
        nets.append({"name": name, "ip": ip, "mask": mask, "prefix": bin(m).count("1"),
                     "broadcast": socket.inet_ntoa(struct.pack("!I", (a & m) | (~m & 0xFFFFFFFF))), "guessed": guessed})
    return sorted(nets, key=lambda n: n["ip"])


# The interface's styles and scripts: only files in css/ and js/ (and js/vendor/), named plainly, so nothing else is served
STATIC = re.compile(r"^/(?:css|js|js/vendor)/[A-Za-z0-9_-]+\.(css|js|woff2)$")   # woff2: the fonts in css/
STATIC_TYPES = {"css": "text/css; charset=utf-8", "js": "text/javascript; charset=utf-8", "woff2": "font/woff2"}


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "nouPix/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
            return self.websocket()
        if path == "/favicon.ico":
            return self.send_file(os.path.join(HERE, "icons", "noupix.ico"), "image/x-icon")
        if path in ("/", "/index.html"):
            return self.send_file(os.path.join(HERE, "index.html"), "text/html; charset=utf-8")
        m = STATIC.match(path)
        if m:
            return self.send_file(os.path.join(HERE, *path.lstrip("/").split("/")), STATIC_TYPES[m.group(1)])
        self.send_error(404)

    def send_file(self, fn, ctype):
        try:
            with open(fn, "rb") as f:
                body = f.read()
        except OSError:
            return self.send_error(404, "%s not found next to noupix.py" % os.path.relpath(fn, HERE))
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin or origin == "null":
            return True
        host = urllib.parse.urlparse(origin).hostname or ""
        return host in ("localhost", "127.0.0.1", "::1") or urllib.parse.urlparse(origin).netloc == self.headers.get("Host")

    def websocket(self):
        if not self.origin_ok():
            return self.send_error(403, "Origin not allowed")
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1(key.encode() + WS_GUID).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.close_connection = True

        art = self.server.artnet
        ws = WebSocket(self.rfile, self.wfile)
        self.server.window_count(+1)
        on_node = lambda node: ws.send_json({"t": "node", "node": node})
        art.listeners.add(on_node)
        vin_message, vin_closed = self.server.vin.window(ws)
        ws.send_json({
            "t": "hello", "version": VERSION, "bindIp": art.bind_ip, "bindPort": art.bind_port,
            "discovery": art.discovery, "discoveryNote": art.discovery_note, "interfaces": local_ips(),
            "nets": network_interfaces(),
            "nodes": list(art.nodes.values()),
            "remote": self.server.remote.status(),
        })

        def stats():
            last_p, last_f, last_t = art.packets, art.frames, time.time()
            while ws.alive:
                time.sleep(1.0)
                now = time.time()
                dt = max(1e-3, now - last_t)
                ws.send_json({"t": "stats", "pps": round((art.packets - last_p) / dt), "fps": round((art.frames - last_f) / dt, 1),
                              "errors": art.errors, "lastError": art.last_error})
                last_p, last_f, last_t = art.packets, art.frames, now
        threading.Thread(target=stats, daemon=True).start()

        try:
            while True:
                op, payload = ws.recv()
                if op == 2:
                    art.frame_from(ws, payload)
                elif op == 1:
                    self.handle_message(art, ws, payload, self.server.remote, vin_message)
        except (ConnectionError, OSError, ValueError):
            pass
        finally:
            ws.alive = False
            vin_closed()
            self.server.window_count(-1)
            art.listeners.discard(on_node)
            if art.owner is ws:
                art.owner = None
                log("The nouPix window closed or disconnected while Art-Net was on.")
            self.server.remote.host_gone(ws)

    @staticmethod
    def handle_message(art, ws, payload, remote=None, vin=None):
        try:
            msg = json.loads(payload.decode("utf-8"))
        except ValueError:
            return
        if not isinstance(msg, dict):
            return
        if msg.get("t") == "output":
            art.set_output(ws, bool(msg.get("on")))
        elif msg.get("t") == "remote" and remote:
            remote.configure(ws, msg)
        elif msg.get("t") == "vin" and vin:
            vin(msg)
        elif msg.get("t") == "rout" and remote:
            remote.route(ws, msg)
        elif msg.get("t") == "poll":
            if not art.discovery:
                ws.send_json({"t": "error", "msg": "Discovery unavailable: " + art.discovery_note})
                return
            # ArtPoll goes to the broadcast address of each network the page lists by its address ("ifaces"),
            # and to one more address if given. A page from before network choice sends only "broadcast".
            nets = network_interfaces()
            ifaces, extra = msg.get("ifaces"), msg.get("broadcast")
            targets = [n["broadcast"] for n in nets if isinstance(ifaces, list) and n["ip"] in ifaces]
            if isinstance(extra, str) and IPV4.match(extra.strip()):
                targets.append(extra.strip())
            if not isinstance(ifaces, list) and not targets:
                targets = ["255.255.255.255"]
            targets = list(dict.fromkeys(targets))
            errors = [e for e in (art.poll(t) for t in targets) if e]
            ws.send_json({"t": "polled", "targets": targets, "nets": nets})
            for err in errors:
                ws.send_json({"t": "error", "msg": err})


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # Lets it restart on the same port right after it stops. Not on Windows, where it would let a second
    # copy open the same port instead of moving to the next one.
    allow_reuse_address = os.name != "nt"

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.windows, self.seen_window, self.windows_changed = 0, False, time.monotonic()
        self.windows_lock = threading.Lock()

    def window_count(self, delta):
        """Counts the interface pages connected over the WebSocket."""
        with self.windows_lock:
            self.windows += delta
            self.seen_window = True
            self.windows_changed = time.monotonic()


# --------------------------------------------------------------------------- remote control
# With Remote control switched on (Settings, in the main window), phones, tablets and other computers on the network
# can use nouPix. They get a second web server on all network cards, apart from the local one that only this
# computer reaches: a login page that asks who you are, then
#   programmer  the whole interface, with the password set in the main window
#   operator    the interface with the mapping locked: content, layers, scenes, zone levels
#   remote      a page for phones: play the scenes of each zone and dim the zones
# The main window stays in charge. Every change a device makes is passed to it with the device's role (which the
# device cannot choose: it comes from its login), the main window applies what that role may change and sends the
# result to every device. Remote devices never send Art-Net.

REMOTE_ROLES = ("programmer", "operator", "remote")
REMOTE_PAGES = {"/": "login.html", "/app": "index.html", "/remote": "remote.html"}
# The remote page installs as an app on phones: its manifest, service worker and icons
REMOTE_FILES = {"/remote.webmanifest": ("remote.webmanifest", "application/manifest+json"), "/remote-sw.js": ("remote-sw.js", "text/javascript; charset=utf-8"),
                "/icons/remote-192.png": ("icons/remote-192.png", "image/png"), "/icons/remote-512.png": ("icons/remote-512.png", "image/png"),
                "/icons/remote-maskable-512.png": ("icons/remote-maskable-512.png", "image/png")}
REMOTE_PORT = 8090
REMOTE_MAX_TRIES, REMOTE_LOCK = 8, 60.0   # wrong passwords from one address before it waits, and how long


class RemoteClient:
    def __init__(self, cid, role, ws, sock, addr):
        self.cid, self.role, self.ws, self.sock, self.addr = cid, role, ws, sock, addr

    def close(self, reason=""):
        if reason:
            self.ws.send_json({"t": "bye", "reason": reason})
        self.ws.alive = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


class LanServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"


class Remote:
    def __init__(self):
        self.server = None    # the network web server, while remote control is on
        self.port = 0
        self.password = ""
        self.tokens = {}      # login token -> role
        self.clients = {}     # cid -> RemoteClient
        self.host = None      # the main window: its WebSocket on the local server
        self.lock = threading.Lock()
        self.tries = {}       # address -> [wrong passwords, waiting until]
        self.next_cid = 1

    # ---- from the main window
    def configure(self, ws, msg):
        if not msg.get("on"):
            if self.host in (ws, None):
                self.stop("Remote control was switched off on the main computer.")
            return ws.send_json(self.status())
        try:
            port = int(msg.get("port") or REMOTE_PORT)
        except (TypeError, ValueError):
            port = REMOTE_PORT
        port = min(65535, max(1024, port))
        password = str(msg.get("password") or "")[:200]
        error = None
        with self.lock:
            changed = password != self.password
            self.password, self.host = password, ws
        if changed:   # a new password: whoever logged in with the old one logs in again
            self.forget("programmer", "The programmer password changed on the main computer. Log in again.")
        if self.server and self.port != port:
            self.stop("Remote control moved to another port.")
        if not self.server:
            try:
                srv = LanServer(("0.0.0.0", port), RemoteHandler)
            except OSError as e:
                error = "Port %d is not free (%s). Choose another port." % (port, e.strerror or e)
            else:
                srv.remote = self
                self.server, self.port = srv, port
                threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.25}, daemon=True).start()
                log("Remote control on: %s" % ", ".join(self.urls()))
        ws.send_json(self.status(error))
        with self.lock:
            clients = list(self.clients.values())
        for c in clients:   # the main window may have reloaded: it needs to know who is connected
            ws.send_json({"t": "rjoin", "cid": c.cid, "role": c.role, "addr": c.addr})
            c.ws.send_json({"t": "host", "on": True})

    def route(self, ws, msg):
        """A message from the main window to one device (to), or to every device of some roles."""
        if ws is not self.host or not isinstance(msg.get("m"), dict):
            return
        data = json.dumps(msg["m"])
        to, roles = msg.get("to"), msg.get("roles")
        with self.lock:
            targets = [c for c in self.clients.values() if (to is None or c.cid == to) and (not isinstance(roles, list) or c.role in roles)]
        for c in targets:
            c.ws.send(data)

    def host_gone(self, ws):
        with self.lock:
            if self.host is not ws:
                return
            self.host = None
            clients = list(self.clients.values())
        for c in clients:
            c.ws.send_json({"t": "host", "on": False})

    def stop(self, reason):
        srv, self.server = self.server, None
        self.forget(None, reason)
        with self.lock:
            self.tokens.clear()
        if srv:
            threading.Thread(target=lambda: (srv.shutdown(), srv.server_close()), daemon=True).start()
            log("Remote control off.")

    def forget(self, role, reason):
        with self.lock:
            self.tokens = {t: r for t, r in self.tokens.items() if role is not None and r != role}
            gone = [c for c in self.clients.values() if role is None or c.role == role]
        for c in gone:
            c.close(reason)

    def urls(self):
        return ["http://%s:%d/" % (ip, self.port) for ip in local_ips() if not ip.startswith("127.")] or ["http://127.0.0.1:%d/" % self.port]

    def status(self, error=None):
        with self.lock:
            clients = [{"cid": c.cid, "role": c.role, "addr": c.addr} for c in self.clients.values()]
        return {"t": "remote", "on": bool(self.server), "port": self.port, "urls": self.urls() if self.server else [],
                "error": error, "clients": clients, "hasPassword": bool(self.password)}

    # ---- from the devices
    def login(self, addr, role, password):
        """Returns (http status, reply)."""
        if role not in REMOTE_ROLES:
            return 400, {"error": "Choose programmer, operator or remote."}
        if role == "programmer":
            now = time.time()
            with self.lock:
                tries, until = self.tries.get(addr, [0, 0])
            if until > now:
                return 429, {"error": "Too many wrong passwords. Try again in %d s." % (until - now + 1)}
            if not self.password:
                return 403, {"error": "No programmer password is set on the main computer (Settings, Remote control)."}
            if not hmac.compare_digest(password.encode("utf-8"), self.password.encode("utf-8")):
                time.sleep(0.6)   # slows down guessing
                with self.lock:
                    tries += 1
                    self.tries[addr] = [0, now + REMOTE_LOCK] if tries >= REMOTE_MAX_TRIES else [tries, 0]
                return 401, {"error": "Wrong password."}
            with self.lock:
                self.tries.pop(addr, None)
        token = secrets.token_urlsafe(18)
        with self.lock:
            self.tokens[token] = role
        return 200, {"token": token, "role": role}

    def join(self, token, ws, sock, addr):
        with self.lock:
            role = self.tokens.get(token)
            if not role or not self.server:
                return None
            c = RemoteClient(self.next_cid, role, ws, sock, addr)
            self.next_cid += 1
            self.clients[c.cid] = c
            host = self.host
        ws.send_json({"t": "hello", "role": role, "cid": c.cid, "version": VERSION, "host": host is not None})
        if host:
            host.send_json({"t": "rjoin", "cid": c.cid, "role": role, "addr": addr})
        log("Remote %s connected from %s." % (role, addr))
        return c

    def leave(self, c):
        with self.lock:
            self.clients.pop(c.cid, None)
            host = self.host
        if host:
            host.send_json({"t": "rleave", "cid": c.cid})

    def message(self, c, payload):
        try:
            m = json.loads(payload.decode("utf-8"))
        except ValueError:
            return
        host = self.host
        if isinstance(m, dict) and host:
            host.send_json({"t": "rmsg", "cid": c.cid, "role": c.role, "m": m})


class RemoteHandler(Handler):
    """The network web server of remote control: its pages, the interface's files, logging in, and devices' WebSocket."""

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/rws" and self.headers.get("Upgrade", "").lower() == "websocket":
            return self.remote_socket()
        if path == "/favicon.ico":
            return self.send_file(os.path.join(HERE, "icons", "noupix.ico"), "image/x-icon")
        if path == "/info":
            r = self.server.remote
            return self.send_json(200, {"version": VERSION, "hasPassword": bool(r.password), "host": r.host is not None})
        if path in REMOTE_PAGES:
            return self.send_file(os.path.join(HERE, REMOTE_PAGES[path]), "text/html; charset=utf-8")
        if path in REMOTE_FILES:
            fn, ctype = REMOTE_FILES[path]
            return self.send_file(os.path.join(HERE, *fn.split("/")), ctype)
        m = STATIC.match(path)
        if m:
            return self.send_file(os.path.join(HERE, *path.lstrip("/").split("/")), STATIC_TYPES[m.group(1)])
        self.send_error(404)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/login" or not self.same_origin():
            return self.send_error(404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8")) if 0 < n <= 4096 else {}
        except (ValueError, OSError):
            body = {}
        if not isinstance(body, dict):
            body = {}
        status, reply = self.server.remote.login(self.client_address[0], body.get("role"), str(body.get("password") or ""))
        self.send_json(status, reply)

    def send_json(self, status, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def same_origin(self):
        origin = self.headers.get("Origin")
        return not origin or urllib.parse.urlparse(origin).netloc == self.headers.get("Host")

    def remote_socket(self):
        if not self.same_origin():
            return self.send_error(403, "Origin not allowed")
        token = (urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("token") or [""])[0]
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1(key.encode() + WS_GUID).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.close_connection = True
        ws = WebSocket(self.rfile, self.wfile)
        remote = self.server.remote
        c = remote.join(token, ws, self.connection, self.client_address[0])
        if not c:
            ws.send_json({"t": "denied", "reason": "Log in again: nouPix was restarted or remote control was switched off and on."})
            return
        try:
            while ws.alive:
                op, payload = ws.recv()
                if op == 1:
                    remote.message(c, payload)
        except (ConnectionError, OSError, ValueError):
            pass
        finally:
            ws.alive = False
            remote.leave(c)


# --------------------------------------------------------------------------- background mode
# BACKGROUND: the apps have no terminal window, so there is nothing to close to stop the server. Instead it
# stops by itself a few seconds after the last nouPix window closes; starting it again while it runs
# only opens another window to the running copy; and what it would print goes to a log file.

LOG_FILE = os.path.join(os.path.expanduser("~"), ".noupix", "noupix.log")
QUIT_AFTER_CLOSE = 10.0     # seconds with no window before it stops (a page reload takes far less)
QUIT_IF_NO_WINDOW = 120.0   # ...or after starting, if no window ever connects


def log_to_file():
    """Sends print() and errors to LOG_FILE, started afresh each run."""
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        sys.stdout = sys.stderr = open(LOG_FILE, "w", buffering=1, encoding="utf-8", errors="replace")
    except OSError:
        sys.stdout = sys.stderr = open(os.devnull, "w")


def alert(msg):
    """Shows an error where the user sees it, since there is no terminal to print it in."""
    try:
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, msg, "nouPix", 0x10)  # MB_ICONERROR
        elif sys.platform == "darwin":
            text = msg.replace("\\", "\\\\").replace('"', '\\"')
            subprocess.run(["osascript", "-e", 'display alert "nouPix" message "%s" as critical' % text],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
    except Exception:
        pass


def running_copy(host, first_port):
    """The address of an nouPix already running on one of the ports this one would try, or None."""
    for port in range(first_port, first_port + 10):
        conn = http.client.HTTPConnection(host, port, timeout=0.5)
        try:
            conn.request("GET", "/favicon.ico")
            if conn.getresponse().getheader("Server", "").startswith(("nouPix/", "openLedMapper/")):   # or one from before the name
                return "http://%s:%d/" % (host, port)
        except (OSError, http.client.HTTPException):
            pass
        finally:
            conn.close()
    return None


def stop_when_input_closes(server):
    """--embedded: the desktop app holds this process's stdin open and closes it when it quits,
    and the bridge stops with it instead of being left running without a window."""
    try:
        while sys.stdin.buffer.read(4096):
            pass
    except (OSError, ValueError):
        pass
    log("The nouPix app closed. Stopping.")
    server.shutdown()


def stop_when_parent_ends(server, pid):
    """--parent-pid: if the app is killed, its stdin pipe may stay open (on macOS and Linux the bridge inherits other
    copies of it), so the bridge also checks every second that the app is still there."""
    while process_alive(pid) and (os.name == "nt" or os.getppid() == pid):
        time.sleep(1.0)
    log("The nouPix app is gone. Stopping.")
    server.shutdown()


def process_alive(pid):
    if os.name == "nt":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel32.CloseHandle(handle)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def quit_when_closed(server):
    while True:
        time.sleep(1.0)
        with server.windows_lock:
            windows, seen, idle = server.windows, server.seen_window, time.monotonic() - server.windows_changed
        if windows <= 0 and idle > (QUIT_AFTER_CLOSE if seen else QUIT_IF_NO_WINDOW):
            log("No nouPix window open%s. Stopping." % ("" if seen else " since it started"))
            server.shutdown()
            return


# --------------------------------------------------------------------------- app window

# Chromium switches that stop the browser from slowing down or pausing a window that is
# minimised, covered by other windows or in the background. They only apply to a browser
# started with its own profile, which is why nouPix gets a separate window and profile.
KEEP_RUNNING = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows"]
PROFILE = os.path.join(os.path.expanduser("~"), ".noupix", "browser-profile")
# this app was called openLedMapper, and Weft before that: the first of their folders found is moved
OLD_HOMES = [os.path.join(os.path.expanduser("~"), ".openledmapper"), os.path.join(os.path.expanduser("~"), ".weft")]


def find_browser():
    """Chrome, Edge, Chromium or Brave, in that order of preference."""
    if sys.platform == "win32":
        roots = [os.environ.get(k) for k in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
        rel = [r"Google\Chrome\Application\chrome.exe", r"Microsoft\Edge\Application\msedge.exe",
               r"BraveSoftware\Brave-Browser\Application\brave.exe"]
        found = [os.path.join(r, p) for p in rel for r in roots if r]
    elif sys.platform == "darwin":
        apps = ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"]
        found = [os.path.join(d, a + ".app", "Contents", "MacOS", a)
                 for a in apps for d in ("/Applications", os.path.expanduser("~/Applications"))]
    else:
        found = [shutil.which(n) for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                                             "microsoft-edge", "brave-browser")]
    return next((p for p in found if p and os.path.isfile(p)), None)


def profile_dir():
    """The window's own browser profile. The first time, the one openLedMapper (or Weft) used is moved here, with
    the project kept in it; if that window is still open, its profile is used where it is."""
    new_home = os.path.dirname(PROFILE)
    old_home = next((d for d in OLD_HOMES if os.path.isdir(d)), None)
    if os.path.exists(new_home) or not old_home:
        return PROFILE
    old = os.path.join(old_home, "browser-profile")
    if os.path.lexists(os.path.join(old, "SingletonLock")):  # the old window is open (macOS, Linux)
        return old
    try:
        os.rename(old_home, new_home)
        log("Moved the window profile from %s to %s (the app had another name before)." % (old_home, new_home))
        return PROFILE
    except OSError:  # in use (Windows)
        return old


def open_window(exe, url):
    profile = profile_dir()
    os.makedirs(profile, exist_ok=True)
    args = [exe, "--app=" + url, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check"] + KEEP_RUNNING
    kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":  # keep the browser open when this console window closes or gets Ctrl+C
        kw["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        kw["start_new_session"] = True
    subprocess.Popen(args, **kw)


def main():
    ap = argparse.ArgumentParser(description="nouPix - local server and Art-Net bridge")
    ap.add_argument("--port", type=int, default=8080, help="web interface port (default 8080)")
    ap.add_argument("--host", default="127.0.0.1", help="web interface address (use 0.0.0.0 to reach it from other devices)")
    ap.add_argument("--bind-ip", default="0.0.0.0", help="network card to send Art-Net from (default: all)")
    ap.add_argument("--bind-port", type=int, default=ARTNET_PORT, help="local UDP port (default 6454; 0 = any, disables discovery)")
    ap.add_argument("--default-browser", action="store_true", help="open the interface in your default browser instead of its own window")
    ap.add_argument("--browser-path", help="Chrome, Edge or Chromium executable for its window (found automatically)")
    ap.add_argument("--no-browser", action="store_true", help="don't open any window")
    ap.add_argument("--background", action="store_true", help="run without a terminal: log to %s and stop when the "
                    "last window closes" % LOG_FILE.replace("%", "%%"))
    ap.add_argument("--embedded", action="store_true", help="run inside the desktop app: no window, prints 'READY <address>' "
                    "once listening, and stops when its input closes (when the app quits)")
    ap.add_argument("--ndi-lib", help="the NDI library to use (found automatically where NDI Tools installs it)")
    ap.add_argument("--omt-lib", help="the OMT library, libomt (looked for in ~/.noupix/omt, next to nouPix, and the usual places)")
    ap.add_argument("--parent-pid", type=int, help="with --embedded: also stop if this process (the app) disappears")
    args = ap.parse_args()
    if args.embedded:
        args.no_browser, args.background = True, False
    background = args.background
    if background and not args.no_browser and show_running_copy(args):
        return
    if background:
        log_to_file()
        try:
            run(args, background)
        except SystemExit as e:
            if e.code not in (None, 0):
                alert(str(e.code))
            raise
        except Exception:
            import traceback
            traceback.print_exc()
            alert("nouPix stopped because of an error. Details are in %s" % LOG_FILE)
            sys.exit(1)
    else:
        run(args, background)


def show_running_copy(args):
    """If nouPix is already running, opens another window to it (instead of starting a second copy
    with its own port, without discovery) and returns True. Leaves the running copy's log alone."""
    url = running_copy(shown_host(args), args.port)
    if not url:
        return False
    exe = None if args.default_browser else (args.browser_path or find_browser())
    if exe:
        try:
            open_window(exe, url)
            return True
        except OSError:
            pass
    webbrowser.open(url)
    return True


def shown_host(args):
    return "127.0.0.1" if args.host in ("0.0.0.0", "") else args.host


def run(args, background):
    art = ArtNet(args.bind_ip, args.bind_port)
    server = None
    for port in range(args.port, args.port + 10):
        try:
            server = Server((args.host, port), Handler)
            break
        except OSError:
            continue
    if server is None:
        sys.exit("Could not open a web port between %d and %d." % (args.port, args.port + 9))
    server.artnet = art
    server.remote = Remote()
    server.vin = VideoIn(args.ndi_lib, args.omt_lib)
    url = "http://%s:%d/" % (shown_host(args), server.server_address[1])

    exe = None if args.no_browser or args.default_browser else (args.browser_path or find_browser())
    print("")
    print("  nouPix %s" % VERSION)
    print("  Interface   %s" % url)
    if exe:
        print("  Window      own window (%s), keeps running when hidden" % os.path.basename(exe))
    elif not args.no_browser:
        print("  Window      default browser: output can slow down when that window is hidden%s"
              % ("" if args.default_browser else " (no Chrome or Edge found)"))
    print("  Art-Net     sending from %s:%d" % (art.bind_ip, art.bind_port))
    if art.discovery:
        print("  Discovery   on (listening on UDP %d)" % ARTNET_PORT)
    else:
        print("  Discovery   off - %s" % art.discovery_note)
    print("  This PC     %s" % ", ".join(local_ips()))
    if args.embedded:
        print("  Stops       when the nouPix app quits")
    elif background and not args.no_browser:
        print("  Stops       %d s after the last nouPix window closes" % QUIT_AFTER_CLOSE)
    else:
        print("  Press Ctrl+C to stop.")
    print("")

    def open_ui():
        if exe:
            try:
                return open_window(exe, url)
            except OSError as e:
                log("Could not start %s (%s). Opening the default browser instead." % (exe, e.strerror or e))
        webbrowser.open(url)
    if args.embedded:
        print("READY %s" % url, flush=True)
        threading.Thread(target=stop_when_input_closes, args=(server,), daemon=True).start()
        if args.parent_pid:
            threading.Thread(target=stop_when_parent_ends, args=(server, args.parent_pid), daemon=True).start()
    if not args.no_browser:
        threading.Timer(0.6, open_ui).start()
        if background:
            threading.Thread(target=quit_when_closed, args=(server,), daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    main()
