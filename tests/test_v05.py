# 0.5: smooth speed + reverse, per-fixture trims, duplicate patches, frame rate to 100, data links, advanced patch, pen tool
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, FakeNode
from test_e2e_lib import base_project, solid
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8191
bridge = start_bridge(PORT)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
UNI = "u => Array.from(olm.universes().find(x => x.uni === u).data.slice(0, 24))"
with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    load = lambda proj: (pg.evaluate("p => olm.loadProject(p)", proj), time.sleep(0.6))
    tick = lambda: (pg.evaluate("() => { olm.tick(); }"), time.sleep(0.05))

    # ---------- trims per fixture
    proj = base_project([solid([1, 1, 1])]); proj["settings"]["trim"] = [0.5, 1, 0.25]
    proj["fixtures"].append(dict(proj["fixtures"][0], id="f2", name="W", order="RGBW", y1=150, y2=150))
    proj["controllers"][0]["chains"] = [["f1", "f2"]]
    load(proj)
    t = pg.evaluate("olm.project.fixtures.map(f => f.trim)")
    check("an old project's global trim becomes each fixture's trim", t == [[0.5, 1, 0.25, 1], [0.5, 1, 0.25, 1]], t)
    check("the global trim setting is gone", "trim" not in pg.evaluate("olm.project.settings"))
    time.sleep(0.3); d = pg.evaluate(UNI, 3)
    check("the output keeps the old trim", d[:3] == [128, 255, 64], d[:6])
    pg.evaluate("() => { olm.project.settings.whiteMode = 'sub'; olm.project.fixtures[1].trim = [1, 1, 1, 0.5]; olm.project.fixtures[0].trim = [1, 0.5, 1, 1]; }"); time.sleep(0.3)
    d = pg.evaluate(UNI, 3)
    check("each fixture has its own trim; white trim scales W", d[:3] == [255, 128, 255] and d[15:19] == [0, 0, 0, 128], (d[:3], d[15:19]))
    pg.evaluate("() => { olm.ui.sel = new Set(['f2']); onSelection(); olm.ui.rightTab = 'inspector'; renderRight(); }"); time.sleep(0.2)
    labels = pg.evaluate("[...document.querySelectorAll('#rightBody .row .lbl')].map(e => e.textContent)")
    ci = labels.index("Color order") if "Color order" in labels else -1
    check("the Inspector has trims after Color order, with White for RGBW", ci >= 0 and labels[ci + 1:ci + 5] == ["Red trim", "Green trim", "Blue trim", "White trim"], labels)
    pg.evaluate("() => { olm.ui.sel = new Set(['f1']); onSelection(); }"); time.sleep(0.2)
    labels = pg.evaluate("[...document.querySelectorAll('#rightBody .row .lbl')].map(e => e.textContent)")
    check("no White trim for RGB", "Red trim" in labels and "White trim" not in labels, labels)
    pg.click("#rightTabs button[data-tab=settings]"); time.sleep(0.2)
    check("Settings has no global trims any more", "Red trim" not in pg.inner_text("#rightBody"))

    # ---------- frame rate up to 100
    fr = pg.evaluate("[...document.querySelectorAll('#rightBody input[type=range]')].find(r => r.getAttribute('aria-label') === 'Frame rate').max")
    check("the frame rate goes up to 100", fr == "100", fr)
    load(base_project([solid([1, 0, 0])])); proj2 = dict(base_project([solid([1, 0, 0])]))
    rate = {}
    pg.evaluate("() => { olm.ui.showContent = false; olm.ui.outputMode = 'identify'; olm.ui.sel = new Set(['f1']); }")   # a light frame: this sandbox renders shaders in software
    for fps in (40, 100):
        pg.evaluate("f => { olm.project.settings.fps = f; startClock(); }", fps); time.sleep(0.5)
        f0 = pg.evaluate("olm.frameIndex"); time.sleep(2.0); f1 = pg.evaluate("olm.frameIndex"); rate[fps] = (f1 - f0) / 2
    print("   ticks/s:", rate, "tick cost ms:", round(pg.evaluate("olm.tickCost"), 1), "tick period:", pg.evaluate("tickPeriod"))
    check("at 100 fps the clock runs every 10 ms, and faster than at 40 as far as this machine can render", pg.evaluate("tickPeriod") == 10 and (rate[100] > rate[40] * 1.4 or rate[100] > 80), rate)
    node = FakeNode("127.0.0.1")
    pg.evaluate("() => { olm.setOutput(true); }"); time.sleep(0.5)
    t0 = time.time(); time.sleep(2.0); n = node.count(t0, time.time()) / 2
    pg.evaluate("() => { olm.setOutput(false); olm.project.settings.fps = 40; startClock(); olm.ui.showContent = true; olm.ui.outputMode = 'content'; }")
    node.close()
    check("and sends as many frames as it renders", n > rate[100] * 0.8, (n, rate[100]))
    check("a file asking for 500 fps gets 100", pg.evaluate("p => { const q = JSON.parse(JSON.stringify(p)); q.settings.fps = 500; olm.loadProject(q); return olm.project.settings.fps; }", proj2) == 100)

    # ---------- duplicate: patched after the others on the same output, if it fits
    pj = base_project([solid([1, 0, 0])])
    pj["controllers"][0].update({"outputs": 2, "upo": 1, "chains": [["f1"], []]})
    pj["fixtures"][0]["pixels"] = 80   # 240 channels: two fit in one universe, three don't
    load(pj)
    pg.evaluate("() => { olm.ui.sel = new Set(['f1']); onSelection(); duplicateSel(); }"); time.sleep(0.3)
    ch = pg.evaluate("olm.project.controllers[0].chains[0].length")
    check("a duplicate that fits goes on the same output, after the original", ch == 2, ch)
    pg.evaluate("() => { olm.ui.sel = new Set([olm.project.fixtures[0].id]); onSelection(); duplicateSel(); }"); time.sleep(0.3)
    st = pg.evaluate("({ chain: olm.project.controllers[0].chains[0].length, last: olm.project.fixtures[olm.project.fixtures.length - 1]._patch })")
    check("a duplicate that doesn't fit stays unpatched", st["chain"] == 2 and st["last"] is None, st)

    # ---------- advanced patch
    pj = base_project([solid([1, 0.5, 0.25])])
    pj["fixtures"] = [dict(pj["fixtures"][0], id="a", name="A", pixels=4), dict(pj["fixtures"][0], id="b", name="B", pixels=2, y1=150, y2=150)]
    pj["controllers"][0].update({"upo": 2, "chains": [["a", "b"]]})
    load(pj)
    pg.evaluate("() => { olm.ui.sel = new Set(['a']); onSelection(); olm.ui.rightTab = 'inspector'; renderRight(); }"); time.sleep(0.2)
    pg.locator("#rightBody label.checkrow", has_text="Set universe and channel").click(); time.sleep(0.2)
    has = pg.evaluate("({ addr: olm.project.fixtures[0].addr, u: !!document.querySelector('#rightBody select[aria-label=\"Start universe\"]') })")
    check("Advanced patch starts from the fixture's current address", has["addr"] == {"u": 3, "ch": 1} and has["u"], has)
    opts = pg.evaluate("[...document.querySelector('#rightBody select[aria-label=\"Start universe\"]').options].map(o => o.value)")
    check("the universe can only be one of the output's", opts == ["3", "4"], opts)
    pg.evaluate("() => { const f = olm.project.fixtures[0]; f.addr = { u: 3, ch: 10 }; olm.computePatch(); }"); time.sleep(0.3)
    d = pg.evaluate(UNI, 3)
    pa = pg.evaluate("olm.project.fixtures.map(f => [f._patch.first, f._patch.last])")
    check("A starts at channel 10, B follows right after it", pa == [[9, 20], [21, 26]] and d[9:12] == [255, 128, 64] and d[:9] == [0] * 9, (pa, d))
    pg.evaluate("() => { const f = olm.project.fixtures[1]; f.addr = { u: 4, ch: 1 }; olm.computePatch(); }"); time.sleep(0.3)
    d4 = pg.evaluate(UNI, 4)
    check("B can be put in the output's second universe", d4[:3] == [255, 128, 64], d4[:6])
    pg.evaluate("() => { const f = olm.project.fixtures[1]; f.addr = { u: 3, ch: 13 }; markPatch(); }"); time.sleep(0.4); ov = pg.evaluate("({ o: olm.project.fixtures[1]._patch.overlap, badge: document.querySelector('#fxList li[data-id=b] .badge').className })")
    check("starting on channels the fixture before uses is flagged", ov["o"] and "warn" in ov["badge"], ov)
    pg.evaluate("() => { const f = olm.project.fixtures[1]; f.addr = { u: 9, ch: 1 }; olm.computePatch(); }")
    out = pg.evaluate("olm.project.fixtures[1]._patch")
    check("a start outside the output is not used", out["outside"] and out["first"] == 21, out)
    saved = pg.evaluate("JSON.parse(JSON.stringify(olm.project, (k, v) => k.startsWith('_') ? undefined : v))")
    saved["fixtures"][0]["addr"] = {"u": "3", "ch": 700}
    load(saved)
    check("a set address is saved and tidied when opened", pg.evaluate("olm.project.fixtures[0].addr") == {"u": 3, "ch": 512})
    pg.evaluate("() => { const c = olm.project.controllers[0]; c.outputs = 2; ensureChains(c); assign('a', c, 1); olm.computePatch(); }")
    check("moving it to another output drops the set address", pg.evaluate("olm.project.fixtures[0].addr") is None)

    # ---------- speed: 0–100 % and reverse, smooth
    load(base_project([{"id": "L1", "src": "b-bars", "params": {"b-bars": {"speed": 0.5}}, "opacity": 1, "blend": "alpha", "on": True}]))
    pg.evaluate("() => { selectZone(olm.project.zones[0]); olm.ui.layer = 'L1'; olm.ui.rightTab = 'content'; renderRight(); }"); time.sleep(0.4)
    sp = pg.evaluate("""(() => { const r = [...document.querySelectorAll('#rightBody input[type=range]')].find(x => x.getAttribute('aria-label') === 'Speed');
        return r && { min: r.min, max: r.max, v: +r.value, rev: !!r.closest('.row').nextElementSibling.querySelector('button.rev'), same: [...document.querySelectorAll('#rightBody .sec input[type=range]')].filter(x => x.closest('.sec') === r.closest('.sec')).every(x => Math.abs(x.getBoundingClientRect().width - r.getBoundingClientRect().width) < 1) }; })()""")
    check("speed is a 0–100 % slider with a Reverse button", sp and sp["min"] == "0" and sp["max"] == "100" and abs(sp["v"] - 16.67) < 0.5 and sp["rev"] and sp["same"], sp)
    # the shader sees TIME × speed = layer clock × full speed; changing the slider must not make it jump
    prod = "(() => { const c = speedClocks.get('L1|b-bars'); const v = olm.project.zones[0].layers[0].params['b-bars'].speed; return c.tau * 3 * (v < 0 ? -1 : 1); })()"
    p0 = pg.evaluate(prod); time.sleep(0.2)
    pg.evaluate("""(() => { const r = [...document.querySelectorAll('#rightBody input[type=range]')].find(x => x.getAttribute('aria-label') === 'Speed');
        r.value = 90; r.dispatchEvent(new Event('input', { bubbles: true })); })()""")
    pg.evaluate("() => olm.tick()"); p1 = pg.evaluate(prod)
    check("moving the speed slider doesn't jump the animation", abs(p1 - p0) < 0.5, (p0, p1))
    time.sleep(0.5); p2 = pg.evaluate(prod)
    check("and it then runs at the new speed", (p2 - p1) / 0.5 > 2.0, (p1, p2))
    pg.locator("#rightBody button.rev").click(); time.sleep(0.3)
    v = pg.evaluate("olm.project.zones[0].layers[0].params['b-bars'].speed")
    check("Reverse runs it backwards at the same speed", abs(v + 2.7) < 0.01 and pg.evaluate("document.querySelector('#rightBody button.rev').getAttribute('aria-pressed')") == "true", v)
    a = pg.evaluate(prod); time.sleep(0.4); b = pg.evaluate(prod)
    check("in reverse the animation goes the other way", b < a, (a, b))
    load(base_project([{"id": "L2", "src": "b-plasma", "params": {"b-plasma": {"speed": 1.5}}, "opacity": 1, "blend": "alpha", "on": True}]))
    time.sleep(0.4)
    c0 = pg.evaluate("[...speedClocks.entries()].find(([k]) => k.startsWith('L2|'))[1].tau"); time.sleep(0.5)
    c1 = pg.evaluate("[...speedClocks.entries()].find(([k]) => k.startsWith('L2|'))[1].tau")
    check("a speed that can't go below 0 can still run in reverse", pg.evaluate("(() => { const L = olm.project.zones[0].layers[0]; L.params['b-plasma'].speed = -1.5; return true; })()") and c1 > c0)

    # ---------- wiring: data links
    load(base_project([solid([1, 0, 0])]))
    pg.evaluate("() => { const f = olm.project.fixtures[0]; olm.project.fixtures.push(Object.assign(JSON.parse(JSON.stringify(f)), { id: 'g2', name: 'L2', y1: 160, y2: 160 })); olm.project.controllers[0].chains[0].push('g2'); markGeom(); olm.computePatch(); olm.ui.showWiring = true; redrawStage(); }")
    time.sleep(0.5)
    shots = pg.screenshot(path="v05_wiring.png")
    check("wiring with data links draws without errors", not errs, errs[:2])

    # ---------- pen tool
    load(base_project([solid([0, 1, 0])]))
    pg.keyboard.press("n"); time.sleep(0.1)
    box = pg.locator("#view").bounding_box()
    S = lambda x, y: pg.evaluate("([x, y]) => [x * olm.ui.view.zoom + olm.ui.view.x, y * olm.ui.view.zoom + olm.ui.view.y]", [x, y])
    def at(x, y): sx, sy = S(x, y); return box["x"] + sx, box["y"] + sy
    x, y = at(50, 150); pg.mouse.click(x, y)                                   # corner
    x, y = at(200, 50); pg.mouse.move(x, y); pg.mouse.down(); x2, y2 = at(260, 50); pg.mouse.move(x2, y2, steps=5); pg.mouse.up()   # smooth point
    x, y = at(350, 150); pg.mouse.click(x, y)
    pg.keyboard.press("Enter"); time.sleep(0.3)
    f = pg.evaluate("(() => { const f = olm.project.fixtures[olm.project.fixtures.length - 1]; return { type: f.type, n: f.pts.length / 2, ctl: f.ctl, px: f.pixels, len: pathLength(f), straight: Math.hypot(150, 100) + Math.hypot(150, 100) }; })()")
    check("the pen draws a curved path", f["type"] == "path" and f["n"] == 3 and f["ctl"] and abs(f["ctl"][6] - 60) < 3 and abs(f["ctl"][4] + 60) < 3, f)
    check("its length follows the curve and sets the pixels", f["len"] > f["straight"] * 1.02 and abs(f["px"] - (round(f["len"] / 10) + 1)) <= 1, f)
    pts = pg.evaluate("(() => { const f = olm.project.fixtures[olm.project.fixtures.length - 1]; return Array.from(f._pts); })()")
    def dseg(px, py, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay; t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5
    off = max(min(dseg(pts[2*i], pts[2*i+1], 50, 150, 200, 50), dseg(pts[2*i], pts[2*i+1], 200, 50, 350, 150)) for i in range(len(pts) // 2))
    check("pixels run along the curve, off the straight corner lines", off > 8, off)
    gaps = [((pts[2*i+2]-pts[2*i])**2 + (pts[2*i+3]-pts[2*i+1])**2) ** 0.5 for i in range(len(pts)//2 - 1)]
    check("and are evenly spaced along it", max(gaps) - min(gaps) < 1.0, (min(gaps), max(gaps)))
    fid = pg.evaluate("olm.project.fixtures[olm.project.fixtures.length - 1].id")
    pg.evaluate("id => { olm.ui.sel = new Set([id]); onSelection(); redrawStage(); }", fid); time.sleep(0.2)
    # drag the out handle of the middle point: the in handle turns with it
    hx, hy = at(260, 50); tx, ty = at(260, 110)
    pg.mouse.move(hx, hy); pg.mouse.down(); pg.mouse.move(tx, ty, steps=5); pg.mouse.up(); time.sleep(0.2)
    c = pg.evaluate("id => olm.project.fixtures.find(f => f.id === id).ctl", fid)
    check("dragging a handle keeps the point smooth (the other handle turns with it)", abs(c[6] - 60) < 3 and abs(c[7] - 60) < 3 and abs(c[4] + 42.4) < 3 and abs(c[5] + 42.4) < 3, c[4:8])
    # double-click the first point: it becomes smooth; again: a corner
    px_, py_ = at(50, 150)
    pg.mouse.dblclick(px_, py_); time.sleep(0.2)
    c = pg.evaluate("id => olm.project.fixtures.find(f => f.id === id).ctl", fid)
    check("double-clicking a corner point makes it smooth", c and (c[2] != 0 or c[3] != 0), c[:4] if c else c)
    pg.mouse.dblclick(px_, py_); time.sleep(0.2)
    c = pg.evaluate("id => olm.project.fixtures.find(f => f.id === id).ctl", fid)
    check("and again makes it a corner", c and c[:4] == [0, 0, 0, 0], c[:4] if c else c)
    pg.keyboard.press("Control+z"); time.sleep(0.2)
    check("Ctrl Z undoes it", pg.evaluate("id => olm.project.fixtures.find(f => f.id === id).ctl.slice(0, 4).some(v => v)", fid))
    # closing by clicking the first point
    pg.keyboard.press("n")
    for (a, b_) in [(60, 60), (160, 60), (160, 160)]:
        x, y = at(a, b_); pg.mouse.click(x, y); time.sleep(0.05)
    x, y = at(60, 60); pg.mouse.click(x, y); time.sleep(0.3)
    g = pg.evaluate("(() => { const f = olm.project.fixtures[olm.project.fixtures.length - 1]; return { n: f.pts.length / 2, closed: f.closed, ctl: f.ctl || null, tool: olm.ui.tool }; })()")
    check("clicking the first point closes the path", g == {"n": 3, "closed": True, "ctl": None, "tool": "select"}, g)
    saved = pg.evaluate("JSON.parse(JSON.stringify(olm.project, (k, v) => k.startsWith('_') ? undefined : v))")
    curved = [f for f in saved["fixtures"] if f.get("ctl")][0]
    load(saved)
    check("curves are saved and opened", pg.evaluate("id => !!olm.project.fixtures.find(f => f.id === id).ctl", curved["id"]))
    saved["fixtures"][[i for i, f in enumerate(saved["fixtures"]) if f.get("ctl")][0]]["ctl"] = [1, 2, "x"]
    load(saved)
    check("broken curve data opens as straight lines", pg.evaluate("id => olm.project.fixtures.find(f => f.id === id).ctl", curved["id"]) is None)
    check("no page errors", not errs, errs[:3])
    br.close()
bridge.terminate(); bridge.communicate()
print("FAILED:", fails or "none")
