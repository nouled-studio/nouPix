# The built-in effects added after 1.1.0: each compiles, has Speed from -1 (full, reverse) through 0 (still) to 1 (full),
# moves only by it, follows the Color 1 and 2 macros with its colours, shows a lit thumbnail, and has its place in
# the source list's filters. Rainbow and Plasma: their own hues as before, or between their two colours.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8208
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)
NEW = ["wash", "cascade", "orbit", "marble", "embers", "nebula", "caustics", "fireflies", "bokeh", "kaleido", "lasers", "tunnel",
       "chevrons", "lightning", "heartbeat", "ganzfeld", "infinity", "sunhaze", "tubes", "opwave", "constellation"]
GONE = ["ripples", "chromatic", "datastream", "colorfield"]

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    ev = pg.evaluate
    check("all 21 are in the library", ev("ids => ids.every(id => BUILTINS.some(b => b.id === id))", NEW) and ev("BUILTINS.length") == 53, ev("BUILTINS.length"))
    check("Ripples, Cruzado, Ikada and Rothco are gone", ev("ids => !ids.some(id => BUILTINS.some(b => b.id === id))", GONE))

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
        # a few looks over a second and a half: Lightning, for one, is dark between its flashes
        play(id, 1); c = col(); seen = False
        for _ in range(5):
            time.sleep(0.3)
            if col() != c: seen = True; break
        if not seen: moves.append(id)
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

    # ---------- Rainbow and Plasma: Colors as Rainbow (the default, as before) or Color A to B, on Color 1 and 2
    pal = ev("""['rainbow', 'plasma'].map(id => { const src = srcById('b-' + id), hdr = runtimeOf(src).hdr, e = effectRt(src), roles = macroRoles(e);
      const inp = n => (hdr.INPUTS || []).find(i => i.NAME === n) || {};
      return { id, palette: inp('palette').DEFAULT, labels: inp('palette').LABELS, a: roles.colorA, b: roles.colorB }; })""")
    check("Rainbow and Plasma have Colors (Rainbow by default) and two colours on Color 1 and 2",
          all(o["palette"] == 0 and o["labels"] == ["Rainbow", "Color A to B"] and o["a"] == "color1" and o["b"] == "color2" for o in pal), pal)
    # the picture: rainbow by default; red to blue with Color A to B only reds, blues and their mixes (no green), still at speed 0
    shot = ev("""([id, P]) => { const src = srcById('b-' + id), rt = runtimeOf(src), c = document.createElement('canvas'); c.width = 64; c.height = 8;
      isfTime = 1; applyParams(rt, { params: { ['b-' + id]: Object.assign({ speed: 0 }, P) } }, src); rt.R.draw({ width: 64, height: 8 }); isfTime = null;
      c.getContext('2d').drawImage(glCanvas, 0, glCanvas.height - 8, 64, 8, 0, 0, 64, 8); return Array.from(c.getContext('2d').getImageData(0, 0, 64, 8).data); }""", ["rainbow", {}])
    greens = lambda d: max(d[i + 1] for i in range(0, len(d), 4))
    check("Rainbow by default plays every hue", greens(shot) > 200, greens(shot))
    for id in ("rainbow", "plasma"):
        d = ev("""([id, P]) => { const src = srcById('b-' + id), rt = runtimeOf(src), c = document.createElement('canvas'); c.width = 64; c.height = 8;
          isfTime = 1; applyParams(rt, { params: { ['b-' + id]: Object.assign({ speed: 0 }, P) } }, src); rt.R.draw({ width: 64, height: 8 }); isfTime = null;
          c.getContext('2d').drawImage(glCanvas, 0, glCanvas.height - 8, 64, 8, 0, 0, 64, 8); return Array.from(c.getContext('2d').getImageData(0, 0, 64, 8).data); }""",
          [id, {"palette": 1, "colorA": [1, 0, 0, 1], "colorB": [0, 0, 1, 1], "saturation": 1}])
        reds, blues = max(d[i] for i in range(0, len(d), 4)), max(d[i + 2] for i in range(0, len(d), 4))
        check(f"{id} with Color A to B goes between its two colours (red to blue: no green)", greens(d) < 12 and reds > 200 and blues > 200, (greens(d), reds, blues))
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED:", fails or "none")
