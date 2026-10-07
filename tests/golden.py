# Record (or compare) deterministic output of a Weft build: DMX bytes per universe, pixel colours, stage checksum.
import os, sys, time, json, hashlib, socket, struct, threading, subprocess
from math import cos as math_cos, sin as math_sin
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, bridge_script
from playwright.sync_api import sync_playwright

BUILD, OUT = sys.argv[1], sys.argv[2]
PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 8070

class Node:
    def __init__(self, ip):
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); self.s.bind((ip, 6454)); self.s.settimeout(0.2)
        self.last = {}; self.n = 0; self.alive = True; self.lock = threading.Lock()
        threading.Thread(target=self.loop, daemon=True).start()
    def loop(self):
        while self.alive:
            try: d, _ = self.s.recvfrom(2048)
            except OSError: continue
            if d[:8] == b"Art-Net\x00" and struct.unpack("<H", d[8:10])[0] == 0x5000:
                with self.lock: self.last[d[14] | (d[15] << 8)] = bytes(d[18:]); self.n += 1
    def snap(self):
        with self.lock: return dict(self.last), self.n

nodes = {ip: Node(ip) for ip in ("127.0.0.1", "127.0.0.2", "127.0.0.3")}
bridge = subprocess.Popen([sys.executable, bridge_script(BUILD), "--no-browser", "--bind-port", "0", "--port", str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

uid = iter(range(10**6))
def F(kind, **kw):
    base = {"id": "f%d" % next(uid), "type": kind, "name": kind, "enabled": True, "locked": False, "tag": "#3cc8ff", "order": "RGB", "reverse": False, "dimmer": 1}
    return dict(base, **kw)
def L(src, params=None, **kw):
    return dict({"id": "l%d" % next(uid), "src": "b-" + src, "params": {"b-" + src: params or {}}, "opacity": 1, "blend": "alpha", "on": True}, **kw)
def Z(name, x, y, w, h, layers, opacity=1):
    return {"id": "z%d" % next(uid), "name": name, "tag": "#ffb341", "x": x, "y": y, "w": w, "h": h, "opacity": opacity, "layers": layers, "scenes": [], "scene": None}

# ---- scenario A: zones, blends, orders, RGBW, gamma, trims, split packing, two controllers
M1 = F("matrix", cx=250, cy=200, w=400, h=300, cols=40, rows=30, start="BR", dir="V", snake=True, order="GRB", rot=0)
S = [F("line", x1=50, y1=450 + 40 * i, x2=950, y2=450 + 40 * i, pixels=150, order=o, reverse=i % 2 == 1) for i, o in enumerate(["RGB", "BGR", "RGBW", "GRBW"])]
S[1]["dimmer"] = 0.5
R = [F("circle", cx=700, cy=200, r=70, pixels=72, start=30, sweep=360, ccw=False), F("circle", cx=870, cy=200, r=70, pixels=60, start=90, sweep=270, ccw=True, order="W")]
P = F("path", pts=[20, 20, 980, 30, 990, 620, 30, 610], closed=True, pixels=200, order="BRG")
Poff = F("line", x1=10, y1=630, x2=990, y2=630, pixels=40, enabled=False)
OUTSIDE = F("line", x1=-50, y1=100, x2=1100, y2=100, pixels=30)
scA = {"name": "A", "settings": {"compW": 1000, "compH": 640, "gamma": 2.2, "master": 0.9, "trim": [1, 0.95, 0.85], "whiteMode": "sub", "transition": 0},
  "fixtures": [M1] + S + R + [P, Poff, OUTSIDE],
  "controllers": [
    {"id": "c1", "name": "C1", "ip": "127.0.0.1", "enabled": True, "outputs": 4, "upo": 8, "startUniverse": 0, "split": False, "chains": [[M1["id"]], [S[0]["id"], S[1]["id"]], [S[2]["id"], S[3]["id"]], [P["id"], Poff["id"], OUTSIDE["id"]]]},
    {"id": "c2", "name": "C2", "ip": "127.0.0.2", "enabled": True, "outputs": 2, "upo": 1, "startUniverse": 300, "split": True, "chains": [[R[0]["id"]], [R[1]["id"]]]}],
  "zones": [
    Z("base", 0, 0, 1000, 640, [L("plasma", {"speed": 0}), L("noise", {"speed": 0}, blend="multiply", opacity=0.8)]),
    Z("left", 0, 0, 500, 400, [L("rainbow", {"speed": 0, "mode": 1}), L("bars", {"speed": 0}, blend="add", opacity=0.5)], opacity=0.7),
    Z("right", 600, 100, 400, 220, [L("pulse", {"speed": 0}), L("comet", {"speed": 0, "mode": 2}, blend="screen")]),
    Z("bottom", 0, 420, 1000, 220, [L("gradient", {"speed": 0}), L("shape", {"shape": 3, "thickness": 0.4}, blend="multiply"), L("twinkle", {"speed": 0}, blend="add", opacity=0.6),
                                    L("strobe", {"rate": 0}, blend="subtract", opacity=0.2), L("solid", {"color": [0.2, 0.7, 0.4, 1]}, blend="difference", opacity=0.3),
                                    L("breathe", {"rate": 0}, blend="lighten", opacity=0.5), L("checker", {"rate": 0, "scroll": 0}, blend="darken", opacity=0.4)], opacity=0.85)]}

# ---- scenario B: every built-in shader, each in its own zone, over one matrix
shaders = [("rainbow", {"speed": 0}), ("plasma", {"speed": 0}), ("noise", {"speed": 0}), ("aurora", {"speed": 0}), ("water", {"speed": 0}), ("fire", {"speed": 0}),
           ("lava", {"speed": 0}), ("bars", {"speed": 0}), ("comet", {"speed": 0}), ("wipe", {"speed": 0}), ("pulse", {"speed": 0}), ("sweep", {"speed": 0}),
           ("spiral", {"speed": 0}), ("rain", {"speed": 0}), ("twinkle", {"speed": 0}), ("checker", {"rate": 0, "scroll": 0}), ("breathe", {"rate": 0}),
           ("strobe", {"rate": 0}), ("gradient", {"speed": 0}), ("shape", {}), ("solid", {"color": [0.3, 0.6, 0.9, 1]})]
MB = F("matrix", cx=350, cy=150, w=700, h=300, cols=70, rows=30, start="TL", dir="H", snake=False, rot=0)
scB = {"name": "B", "settings": {"compW": 700, "compH": 300, "gamma": 1, "transition": 0},
  "fixtures": [MB], "controllers": [{"id": "c3", "name": "C3", "ip": "127.0.0.3", "enabled": True, "outputs": 2, "upo": 8, "startUniverse": 1000, "split": False, "chains": [[MB["id"]], []]}],
  "zones": [Z(n, (i % 7) * 100, (i // 7) * 100, 100, 100, [L(n, p)]) for i, (n, p) in enumerate(shaders)]}

# ---- scenario C: an image in three zones with fit, fill and stretch
MC = F("matrix", cx=200, cy=150, w=400, h=300, cols=40, rows=30, start="TL", dir="H", snake=True, rot=0)
scC = {"name": "C", "settings": {"compW": 400, "compH": 300, "gamma": 1, "transition": 0}, "fixtures": [MC],
  "controllers": [{"id": "c4", "name": "C4", "ip": "127.0.0.1", "enabled": True, "outputs": 1, "upo": 8, "startUniverse": 50, "split": False, "chains": [[MC["id"]]]}],
  "zones": [Z("fit", 0, 0, 200, 150, []), Z("fill", 200, 0, 200, 300, []), Z("stretch", 0, 150, 200, 150, [])]}


# ---- scenario D: the example ISF shader as a custom source, still (speed 0), with two sets of controls
FOL = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "examples", "06-GradientBounce.fs")).read()
RD = [F("circle", cx=285 + 90 * math_cos(a), cy=320 + 90 * math_sin(a), r=45, pixels=48, start=0, sweep=360, ccw=False) for a in [i * 1.0472 for i in range(6)]] + [F("circle", cx=285, cy=320, r=45, pixels=48, start=0, sweep=360, ccw=False)]
def LC(params): return {"id": "l%d" % next(uid), "src": "fol", "params": {"fol": params}, "opacity": 1, "blend": "alpha", "on": True}
scD = {"name": "D", "settings": {"compW": 571, "compH": 640, "gamma": 1.8, "transition": 0},
  "fixtures": RD, "sources": [{"id": "fol", "kind": "isf", "name": "Fruit of Life", "code": FOL}],
  "controllers": [{"id": "c5", "name": "C5", "ip": "127.0.0.2", "enabled": True, "outputs": 1, "upo": 4, "startUniverse": 20, "split": False, "chains": [[f["id"] for f in RD]]}],
  "zones": [Z("fol", 0, 0, 571, 640, [LC({"speed": 0, "softness": 0.6, "angle": 30})])]}
# ---- scenario E: the 30k-pixel project (192 universes), everything still
from bigproj import big_project
scE = big_project(ctrl_ip="127.0.0.2", k=1 / 6)
for z in scE["zones"]:
    for l in z["layers"]:
        for k, v in l["params"].items(): v.update({"speed": 0})

results = {}
def settle(pg, secs=2.0):
    time.sleep(secs)
    # wait for two identical consecutive frames on every node
    prev = None
    for _ in range(40):
        cur = {ip: n.snap()[0] for ip, n in nodes.items()}
        if cur == prev and any(cur.values()): return cur
        prev = cur; time.sleep(0.6)
    return cur

def capture(pg, label):
    st = settle(pg)
    cols = pg.evaluate("olm.project.fixtures.map(f => Array.from(f._col))")
    stage = pg.evaluate("""() => { const c = olm.mixer.canvas, t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
      const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; } return [t.width, t.height, h]; }""")
    results[label] = {"dmx": {ip: {str(u): d.hex() for u, d in sorted(v.items())} for ip, v in st.items()}, "cols": cols, "stage": stage}
    nu = sum(len(v) for v in st.values())
    print(f"{label:22s} universes {nu:3d}  pixels {sum(len(c) for c in cols) // 3:5d}  stage {stage}", flush=True)

with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS + [a for a in os.environ.get('EXTRA', '').split(',') if a]); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    pg.evaluate("localStorage.clear(); olm.ui.showContent = true")
    def load(sc):
        pg.evaluate("p => { olm.loadProject(p); olm.setOutput(true); }", sc)
        if os.environ.get("FORCE"): pg.evaluate("g => { if (olm.samplePick) Object.assign(olm.samplePick, { gpu: g, at: 1e15 }); }", os.environ["FORCE"] == "gpu")
        time.sleep(1.5)   # let packets of the previous project drain before recording
        for n in nodes.values():
            with n.lock: n.last.clear()
    ONLY = os.environ.get("ONLY", "ABC")
    if "A" in ONLY:
      load(scA); capture(pg, "A zones+blends")
      pg.evaluate("olm.ui.outputMode = 'white'"); capture(pg, "A test white")
      pg.evaluate("olm.ui.outputMode = 'black'"); capture(pg, "A test black")
      pg.evaluate("olm.ui.outputMode = 'content'; olm.project.settings.master = 0.5; olm.project.settings.whiteMode = 'add'"); capture(pg, "A master50 wAdd")
      pg.evaluate("olm.project.settings.master = 1; olm.project.settings.whiteMode = 'off'; olm.project.zones[1].opacity = 0; olm.project.zones[3].layers[2].on = false"); capture(pg, "A zone0 layerOff")
    if "B" in ONLY:
      load(scB); capture(pg, "B all shaders")
    if "C" in ONLY:
      load(scC)
      pg.evaluate("""async () => {
        const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d');
        for (let i = 0; i < 16; i++) for (let j = 0; j < 9; j++) { x.fillStyle = `rgb(${i * 16},${j * 28},${(i * j * 7) % 256})`; x.fillRect(i * 10, j * 10, 10, 10); }
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        for (let k = 0; k < 3; k++) {
          olm.selectZone(olm.project.zones[k]);
          const dt = new DataTransfer(); dt.items.add(new File([blob], 'img' + k + '.png', { type: 'image/png' }));
          const inp = document.getElementById('fileMedia'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
          await new Promise(r => setTimeout(r, 300));
        }
        const imgs = olm.project.sources.filter(s => s.kind === 'image');
        imgs[0].fit = 'fit'; imgs[1].fit = 'fill'; imgs[2].fit = 'stretch';
        olm.project.zones.forEach((z, k) => { z.layers.forEach(l => l.src = imgs[k].id); });
      }""")
      capture(pg, "C image fits")
      pg.evaluate("olm.ui.blackout = true"); capture(pg, "C blackout")
      pg.evaluate("olm.ui.blackout = false")
    if "D" in ONLY:
        load(scD); capture(pg, "D custom ISF")
        pg.evaluate("() => { const P = olm.project.zones[0].layers[0].params.fol; Object.assign(P, { mirror: true, angle: 120, softness: 0.2, colorA: [0.1, 1, 0.3, 1] }); }"); capture(pg, "D custom ISF mirrored")
    if "E" in ONLY:
        load(scE); capture(pg, "E 30k pixels")
    print("page errors:", errs[:3])
    br.close()
bridge.terminate(); bridge.communicate()
json.dump(results, open(OUT, "w"))
print("saved", OUT)
