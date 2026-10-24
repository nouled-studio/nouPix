# Shared test harness: fake Art-Net node + nouPix bridge + headless Chromium
import socket, struct, subprocess, sys, tempfile, threading, time, os
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
    """noupix.py, or openledmapper.py or weft.py in builds from before the names changed"""
    for name in ("noupix.py", "openledmapper.py"):
        p = os.path.join(build, name)
        if os.path.exists(p): return p
    return os.path.join(build, "weft.py")

def start_bridge(port=8099, extra=()):
    # the startup project of this computer's nouPix never reaches the tests: each bridge has its own (none) unless one is given
    env = dict(os.environ)
    env.setdefault("NOUPIX_STARTUP_FILE", os.path.join(tempfile.gettempdir(), "noupix-test-startup-%d.noupix" % port))
    env.setdefault("NOUPIX_MEDIA_DIR", os.path.join(tempfile.gettempdir(), "noupix-test-media-%d" % port))   # never this computer's library
    if "NOUPIX_STARTUP_FILE" not in os.environ:
        try: os.remove(env["NOUPIX_STARTUP_FILE"])
        except OSError: pass
    p = subprocess.Popen([sys.executable, bridge_script(WEFT), "--no-browser", "--bind-port", "0", "--port", str(port), *extra],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
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

# A Web MIDI stand-in, for ctx.add_init_script: __midi.plug(name), unplug(name), send(name, bytes); asked counts
# requestMIDIAccess calls. The ports plugged in at the start, and a refused or missing Web MIDI, come from
# sessionStorage.fakeMidi ({ ports, refuse, none }), so they hold across a reload.
FAKE_MIDI = """(() => {
  const inputs = new Map(), access = { inputs, outputs: new Map(), onstatechange: null, sysexEnabled: false };
  const fire = p => { if (access.onstatechange) access.onstatechange({ port: p }); };
  const saved = JSON.parse(sessionStorage.getItem('fakeMidi') || '{}');
  window.__midi = {
    asked: 0, refuse: !!saved.refuse,
    plug(name) { const p = { id: name, name, state: 'connected', type: 'input', onmidimessage: null }; inputs.set(name, p); fire(p); },
    unplug(name) { const p = inputs.get(name); if (!p) return; p.state = 'disconnected'; inputs.delete(name); fire(p); },
    send(name, bytes) { const p = inputs.get(name); if (p && p.onmidimessage) p.onmidimessage({ data: new Uint8Array(bytes) }); },
  };
  for (const n of saved.ports || []) window.__midi.plug(n);
  if (saved.none) { Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined }); return; }
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: () => { window.__midi.asked++; return window.__midi.refuse ? Promise.reject(new Error('refused')) : Promise.resolve(access); } });
})();"""
