# The built-in effects added in 1.1: each compiles, has Speed from -1 (full, reverse) through 0 (still) to 1 (full),
# moves only by it, follows the Color 1 and 2 macros with its colours, shows a lit thumbnail, and has its place in
# the source list's filters.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8208
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)
NEW = ["wash", "cascade", "orbit", "marble", "embers", "ripples", "nebula", "caustics", "fireflies", "bokeh", "kaleido", "lasers", "tunnel",
       "chevrons", "lightning", "heartbeat", "ganzfeld", "infinity", "sunhaze", "tubes", "chromatic", "opwave", "datastream", "colorfield", "constellation"]

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    ev = pg.evaluate
    check("all 25 are in the library", ev("ids => ids.every(id => BUILTINS.some(b => b.id === id))", NEW) and ev("BUILTINS.length") == 57, ev("BUILTINS.length"))

    # ---------- each one: compiles, its speed, what moves it, its macros, its facets
    info = ev("""ids => ids.map(id => {
      const src = srcById('b-' + id), rt = runtimeOf(src), hdr = rt.hdr, e = effectRt(src), roles = macroRoles(e);
      const sp = (hdr.INPUTS || []).find(i => i.NAME === 'speed'), colors = (hdr.INPUTS || []).filter(i => i.TYPE === 'color').map(i => roles[i.NAME] || '');
      const code = sourceCode(src).split('*/')[1];
      // TIME only ever times speed: nothing moves at speed 0
      const loose = (code.match(/\\bTIME\\b(?!\\s*\\*\\s*speed)/g) || []).length;
      const f = srcFacets(src);
      return { id, error: rt.error, speed: sp ? [sp.MIN, sp.MAX] : null, isSpeed: !!e.speed && roles.speed === 'speed', colors, loose,
        facets: !!(f.mood && f.use && f.look && f.motion), named: !!src.name };
    })""", NEW)
    for o in info:
        problems = []
        if o["error"]: problems.append("error: " + o["error"][:200])
        if o["speed"] != [-1, 1]: problems.append("speed " + str(o["speed"]))
        if not o["isSpeed"]: problems.append("speed not followed by the Speed macro")
        if o["loose"]: problems.append("TIME used without speed")
        if not o["colors"] or o["colors"][0] != "color1" or (len(o["colors"]) > 1 and o["colors"][1] != "color2"): problems.append("colours " + str(o["colors"]))
        if not o["facets"]: problems.append("no mood, use, look and motion")
        check(f"{o['id']}: compiles, Speed -1..1 on the Speed macro, colours on Color 1 and 2, in the filters", not problems, "; ".join(problems))

    # ---------- through a layer: lit, still at speed 0, backwards below 0, and their thumbnails lit
    ev("""(() => { const p = blankProject('E'); p.settings.compW = 200; p.settings.compH = 100; p.settings.transition = 0;
      p.zones = [newZone({ w: 200, h: 100, layers: [newLayer('b-wash')] })];
      p.fixtures = [newFixture('matrix', { x: 5, y: 5, w: 190, h: 90, cols: 16, rows: 8 })];
      olm.loadProject(p); })()""")
    time.sleep(0.8)
    col = lambda: ev("Array.from(olm.project.fixtures[0]._col)")
    def play(id, speed):
        ev(f"(() => {{ const L = olm.project.zones[0].layers[0]; L.src = 'b-{id}'; L.params = {{ 'b-{id}': {{ speed: {speed} }} }}; }})()"); time.sleep(0.35)
    lit, still, moves, back = [], [], [], []
    for id in NEW:
        play(id, 0); a = col(); time.sleep(0.4); b = col()
        if sum(a) == 0 and sum(b) == 0: lit.append(id)
        if a != b: still.append(id)
        play(id, 1); c = col(); time.sleep(0.4); d = col()
        if c == d: moves.append(id)
    check("each one lights the fixtures", not lit, lit)
    check("each one stands still at speed 0", not still, still)
    check("and moves at full speed", not moves, moves)
    # backwards: the same picture a moment ago, played at -1, is where +1 came from
    rev = ev("""ids => ids.filter(id => {
      const src = srcById('b-' + id), rt = runtimeOf(src), read = () => { const c = document.createElement('canvas'); c.width = 40; c.height = 20;
        c.getContext('2d').drawImage(glCanvas, 0, glCanvas.height - 20, 40, 20, 0, 0, 40, 20); return c.getContext('2d').getImageData(0, 0, 40, 20).data.join(); };
      const at = (t, s) => { isfTime = t; applyParams(rt, { params: { ['b-' + id]: { speed: s } } }, src); rt.R.draw({ width: 40, height: 20 }); isfTime = null; return read(); };
      return at(2, -1) !== at(-2, 1);
    })""", NEW)
    check("reverse is the same movement backwards (speed -1 at a time is speed 1 at minus that time)", not rev, rev)
    ev("(() => { ui.srcFacets = {}; ui.srcFilter = ''; renderSrcList(); })()"); time.sleep(3)
    dark = ev("""ids => ids.filter(id => { const c = thumbOf(srcById('b-' + id)), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s < c.width * c.height * 12; })""", NEW)
    check("each thumbnail shows its effect (not black)", not dark, dark)
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED:", fails or "none")
