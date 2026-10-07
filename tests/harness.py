# Shared test harness: fake Art-Net node + openLedMapper bridge + headless Chromium
import socket, struct, subprocess, sys, threading, time, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repo: the app is in its root
WEFT = os.environ.get("WEFT", ROOT)

class FakeNode:
    def __init__(self, ip="127.0.0.1"):
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.s.bind((ip, 6454)); self.s.settimeout(0.2)
        self.lock = threading.Lock(); self.log = []   # (t, op, uni, seq, data)
        self.alive = True
        threading.Thread(target=self.loop, daemon=True).start()
    def loop(self):
        while self.alive:
            try: d, a = self.s.recvfrom(2048)
            except OSError: continue
            if d[:8] != b"Art-Net\x00": continue
            op = struct.unpack("<H", d[8:10])[0]
            uni = d[14] | (d[15] << 8) if op == 0x5000 else None
            with self.lock: self.log.append((time.time(), op, uni, d[12] if op == 0x5000 else None, d[18:] if op == 0x5000 else b""))
    def count(self, t0, t1, op=0x5000):
        with self.lock: return sum(1 for e in self.log if t0 <= e[0] < t1 and e[1] == op)
    def last(self, uni):
        with self.lock:
            for e in reversed(self.log):
                if e[1] == 0x5000 and e[2] == uni: return e[4]
    def close(self): self.alive = False; self.s.close()

def bridge_script(build):
    """openledmapper.py, or weft.py in builds from before the rename"""
    p = os.path.join(build, "openledmapper.py")
    return p if os.path.exists(p) else os.path.join(build, "weft.py")

def start_bridge(port=8099, extra=()):
    p = subprocess.Popen([sys.executable, bridge_script(WEFT), "--no-browser", "--bind-port", "0", "--port", str(port), *extra],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(0.8)
    return p

def app_error(m):
    """A console message that is an error of the app: not the web fonts failing to load (offline, or a proxy
    that breaks their certificate), which the app does without"""
    if m.type != "error" or "TUNNEL" in m.text:
        return False
    url = (m.location or {}).get("url", "") or ""
    return not ("fonts.googleapis.com" in url or "fonts.gstatic.com" in url)

CHROME_ARGS = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
