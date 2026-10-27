import socket, struct, base64, os, json, time, subprocess, sys, threading
sys.path.insert(0, os.path.dirname(__file__))
from harness import FakeNode, start_bridge
node = FakeNode()
p = start_bridge(8097)

# A window as a browser is one: it answers the bridge's pings by itself (unless muted, a window gone without its close
# arriving), and sends under a lock, as the pongs go out from the reader
class WS:
    def __init__(s, port):
        s.s = socket.create_connection(("127.0.0.1", port))
        s.s.sendall(("GET /ws HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (port, base64.b64encode(os.urandom(16)).decode())).encode())
        s.buf = b""; s.msgs = []; s.lock = threading.Lock(); s.muted = False
        hdr = b""
        while b"\r\n\r\n" not in hdr: hdr += s.s.recv(1)
        threading.Thread(target=s.reader, daemon=True).start()
    def reader(s):
        f = s.s.makefile("rb")
        while True:
            try:
                b0, b1 = f.read(2); n = b1 & 0x7f
                if n == 126: n = struct.unpack(">H", f.read(2))[0]
                elif n == 127: n = struct.unpack(">Q", f.read(8))[0]
                d = f.read(n)
                if b0 & 0x0f == 1: s.msgs.append(json.loads(d))
                elif b0 & 0x0f == 9 and not s.muted: s.send(d, 0xA)
            except Exception: return
    def send(s, payload, op=2):
        if isinstance(payload, dict): payload, op = json.dumps(payload).encode(), 1
        mask = os.urandom(4); n = len(payload)
        hdr = bytes((0x80 | op,)) + (bytes((0x80 | n,)) if n < 126 else bytes((0x80 | 126,)) + struct.pack(">H", n))
        with s.lock: s.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
    def close(s):   # as a browser closes: a close message, then the connection
        try: s.send(b"", 8)
        except OSError: pass
        s.s.shutdown(socket.SHUT_RDWR); s.s.close()
    def hello(s, t=5.0):
        end = time.time() + t
        while time.time() < end and not any(m.get("t") == "hello" for m in s.msgs): time.sleep(0.02)
        return next(m for m in s.msgs if m.get("t") == "hello")

def frame(val, uni=1):
    return struct.pack("<BBH", 1, 0, 1) + socket.inet_aton("127.0.0.1") + struct.pack("<HH", uni, 512) + bytes([val]) * 512

try:
  a, b = WS(8097), WS(8097)
  h = a.hello(); b.hello()
  print("hello discovery:", h["discovery"], "|", h["discoveryNote"])
  t0 = time.time(); a.send(frame(10)); time.sleep(0.2)
  print("frame without output-on sent:", node.count(t0, time.time()))
  a.send({"t": "output", "on": True}); time.sleep(0.05)
  t0 = time.time(); a.send(frame(20)); time.sleep(0.2)
  print("owner frame sent:", node.count(t0, time.time()), "value", node.last(1)[0])
  b.send({"t": "output", "on": True}); time.sleep(0.2)
  print("A got takeover:", any(m.get("t") == "takeover" for m in a.msgs))
  t0 = time.time(); a.send(frame(30)); time.sleep(0.2)
  print("old owner frame dropped:", node.count(t0, time.time()) == 0)
  b.send(frame(40)); time.sleep(0.1)
  t0 = time.time(); time.sleep(3.0)
  n = node.count(t0, time.time())
  print("held frames in 3 s after stall:", n, "value", node.last(1)[0])
  b.send(frame(50)); time.sleep(0.2)
  b.send({"t": "output", "on": False}); time.sleep(0.1)
  t0 = time.time(); time.sleep(2.0)
  print("after output off, frames:", node.count(t0, time.time()))
  b.send({"t": "output", "on": True}); b.send(frame(60)); time.sleep(0.2); b.close(); time.sleep(0.3)
  t0 = time.time(); time.sleep(2.0)
  print("after owner disconnect, frames:", node.count(t0, time.time()))
  # a window whose close never arrives (lost by a firewall, or the browser killed): it stops answering the pings, and
  # the bridge lets it go within WS_SILENT (10 s) and stops driving the lights for it
  c = WS(8097); c.hello()
  c.send({"t": "output", "on": True}); time.sleep(0.05); c.send(frame(70)); time.sleep(0.3)
  print("silent window's frame sent:", node.last(1)[0] == 70)
  c.muted = True; time.sleep(12.5)
  t0 = time.time(); time.sleep(2.0)
  print("after owner went silent, frames:", node.count(t0, time.time()))
  d = WS(8097); d.hello(); time.sleep(12)
  print("a window that answers stays:", d.s.fileno() != -1 and not any(m.get("t") == "takeover" for m in d.msgs) and d.send({"t": "output", "on": True}) is None)
  t0 = time.time(); d.send(frame(80)); time.sleep(0.3)
  print("and drives the lights after 12 s:", node.count(t0, time.time()) >= 1 and node.last(1)[0] == 80)
finally:
  p.terminate(); print(p.communicate()[0])
