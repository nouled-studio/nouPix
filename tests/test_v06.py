# 0.5.3 features: Highlight modes, per-fixture gamma, patch order and its animation, copy names, copy and paste,
# source facets and search, rate clocks, rotating and resizing selections, ovals, layers order, controller form,
# network choice for discovery, locking, and that all of it survives saving and opening
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge
from test_e2e_lib import base_project, solid
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8152
bridge = start_bridge(PORT)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

def two_lines(color=(1, 0, 0)):
    p = base_project([solid(list(color))])
    p["fixtures"][0]["name"] = "Line 1"
    p["fixtures"].append(dict(p["fixtures"][0], id="f2", name="Line 2", y1=150, y2=150))
    p["controllers"][0]["chains"] = [["f1", "f2"]]
    return p

with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    load = lambda proj: (ev("p => olm.loadProject(p)", proj), time.sleep(0.5))
    uni = lambda u=3, n=30: ev(f"Array.from(olm.universes().find(x => x.uni === {u}).data.slice(0, {n}))")
    px = lambda d, i: d[3 * i: 3 * i + 3]
    settle = lambda: (ev("olm.tick()"), time.sleep(0.15))

    # ---------- Highlight
    load(two_lines())
    settle(); d = uni()
    check("content: both lines red", px(d, 0) == [255, 0, 0] and px(d, 9) == [255, 0, 0], d[:6])
    ev("olm.ui.sel = new Set(); setHighlight(true, 'flood')"); settle(); d = uni()
    check("Flood with nothing selected lights everything white", all(v == 255 for v in d), d)
    ev("olm.ui.sel = new Set(['f1']); onSelection()"); settle(); d = uni()
    check("Flood lights only the selection", all(v == 255 for v in d[:15]) and all(v == 0 for v in d[15:30]), d)
    ev("setHighlight(true, 'spot')"); settle(); d = uni()
    check("Spotlight: selected yellow, the rest blue", px(d, 0) == [255, 190, 0] and px(d, 5) == [0, 40, 255], (px(d, 0), px(d, 5)))
    ev("olm.ui.sel = new Set(); setHighlight(true, 'trace')"); settle(); d = uni()
    check("Trace: first pixel red, last blue", px(d, 0) == [255, 0, 0] and px(d, 4) == [0, 0, 255] and px(d, 5) == [255, 0, 0] and px(d, 9) == [0, 0, 255], d)
    ev("setHighlight(true, 'color')"); settle(); d = uni()
    check("Color check: every pixel one of R, G, B, W", px(d, 0) in ([255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]) and all(px(d, i) == px(d, 0) for i in range(10)), d)
    ev("setHighlight(true, 'pixel'); pickPixel(olm.project.fixtures[1], 2)"); settle(); d = uni()
    lit = [i for i in range(10) if px(d, i) != [0, 0, 0]]
    check("Pixel finder lights just the picked pixel", lit == [7] and px(d, 7) == [255, 255, 255], lit)
    toast = ev("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')")
    check("and says where it is", "Line 2 · pixel 3 of 5 · U 3 ch 22–24" in toast, toast)
    ev("setHighlight(false)"); settle(); d = uni()
    check("Highlight off: the content again", px(d, 0) == [255, 0, 0] and px(d, 7) == [255, 0, 0], d[:6])
    check("the old mode names still work (identify = trace)", ev("(() => { testPattern('identify'); return Array.from(olm.project.fixtures[0]._col.slice(0, 3)); })()") == [255, 0, 0])

    # ---------- gamma per fixture
    load(two_lines((0.5, 0.5, 0.5)))
    ev("olm.project.fixtures[0].gamma = 2.2"); settle(); d = uni()
    expect = ev(f"gammaLUT(2.2)[{d[15]}]")
    check("gamma is per fixture", d[0] == expect and d[15] != d[0], (d[0], d[15], expect))
    ev("olm.ui.sel = new Set(['f1']); onSelection(); duplicateSel()"); time.sleep(0.2)
    g = ev("olm.project.fixtures.map(f => [f.name, f.gamma])")
    check("a copy keeps its gamma", ["Line 3", 2.2] in g, g)

    # ---------- patch order
    load(two_lines())
    ev("olm.project.fixtures[1].order = 'GRB'")
    ev("olm.ui.dockTab = 'patch'; olm.ui.selCtrl = 'c1'; olm.ui.dockCollapsed = false; renderDock()"); settle()
    anims = ev("(() => { moveOnOutput(['f2'], -1); const r = document.querySelector('#dockBody .prow[data-id=\"f2\"]'); return r ? r.getAnimations().length : -1; })()")
    check("↑ puts Line 2 first on the output", ev("olm.project.controllers[0].chains[0]") == ["f2", "f1"])
    check("and the move is animated", anims >= 1, anims)
    settle(); d = uni()
    check("its address follows: Line 2 (GRB) now at channel 1", px(d, 0) == [0, 255, 0] and px(d, 5) == [255, 0, 0], d)
    time.sleep(0.15)
    check("the animation outlives the panel being rebuilt", ev("document.querySelector('#dockBody .prow[data-id=\"f2\"]').getAnimations().length") >= 1)
    ev("olm.ui.sel = new Set(['f2']); onSelection()"); pg.mouse.move(700, 300); pg.keyboard.press("Alt+ArrowDown"); time.sleep(0.1)
    check("Alt ↓ moves the selection later", ev("olm.project.controllers[0].chains[0]") == ["f1", "f2"])
    ev("moveToOutputEdge(['f2'], false)")
    check("to the start of the output", ev("olm.project.controllers[0].chains[0]") == ["f2", "f1"])
    check("nothing to move: says so", ev("moveOnOutput(['nope'], 1)") in (0, False))

    # ---------- copy names, duplicate patching, copy and paste
    cases = [["Line 1", [], "Line 2"], ["Matrix 10", [], "Matrix 11"], ["Wave", [], "Wave 2"], ["Strip 09", [], "Strip 10"], ["A 01", [], "A 02"], ["Line 1", ["Line 2"], "Line 3"]]
    got = [ev("([n, t]) => nextCopyName(n, new Set(t))", [n, t]) for n, t, _ in cases]
    check("copies are numbered on from the original", got == [c[2] for c in cases], got)
    load(two_lines())
    ev("olm.ui.sel = new Set(['f1', 'f2']); onSelection()")
    clip = ev("clipOfSel()")
    ev("d => pasteFixtures(d)", clip); time.sleep(0.2)
    fx = ev("olm.project.fixtures.map(f => ({ id: f.id, name: f.name, patched: !!f._patch }))")
    check("paste adds copies with new names", [f["name"] for f in fx] == ["Line 1", "Line 2", "Line 3", "Line 4"], fx)
    check("with new ids, not patched", len({f["id"] for f in fx}) == 4 and not fx[2]["patched"] and not fx[3]["patched"], fx)
    items = ev("patchToItems([olm.project.fixtures[2]]).map(i => Array.isArray(i) ? i[0] : i && i.head || i)")
    check("Patch to lists the output", any("OUT 1" in str(i) for i in items), items)

    # ---------- source facets and search
    ev("olm.ui.srcFacets = {}; olm.ui.srcFilter = ''; renderSrcList()")
    n_all = ev("document.querySelectorAll('#srcList .tile').length")
    nb = ev("BUILTINS.length")
    check("all built-ins listed", n_all == nb, (n_all, nb))
    check("every built-in has a mood, use, look and motion", ev("olm.project.sources.filter(s => s.builtin).every(s => { const f = srcFacets(s); return f.mood && f.use && f.look && f.motion; })"))
    ev("olm.ui.srcFacets = { mood: 'party' }; renderSrcList()")
    party = ev("[...document.querySelectorAll('#srcList .tile .nm')].map(e => e.textContent)")
    check("Mood → Party", "Disco dots" in party and "Aurora" not in party and len(party) >= 5, party)
    ev("olm.ui.srcFacets = {}; olm.ui.srcFilter = 'disco'; renderSrcList()")
    check("search 'disco' finds the Party sources", sorted(ev("[...document.querySelectorAll('#srcList .tile .nm')].map(e => e.textContent)")) == sorted(party))
    ev("olm.ui.srcFilter = 'stars'; renderSrcList()")
    check("search by keyword", sorted(ev("[...document.querySelectorAll('#srcList .tile .nm')].map(e => e.textContent)")) == ["Starfield", "Twinkle"])
    ev("olm.ui.srcFilter = 'zzzz'; renderSrcList()")
    check("no match: says so", "Nothing matches" in pg.inner_text("#srcList"))
    check("no 'null' left by the filters", "null" not in pg.inner_text("#srcFacets"))
    ev("olm.ui.srcFilter = ''; renderSrcList()")
    fs = ev("""(() => { const s = { id: 'u1', kind: 'isf', name: 'Mine', code: '/*{"CATEGORIES":["Generator","Disco","Dots"],"INPUTS":[]}*/\\nvoid main(){gl_FragColor=vec4(1.0);}' };
      olm.project.sources.push(s); const f = srcFacets(s); olm.project.sources.pop(); return f; })()""")
    check("a custom shader is placed from its categories", fs == {"type": "shader", "mood": "party", "use": "show", "look": "particles"}, fs)

    # ---------- rate clocks: hidden inputs, running totals
    clk = ev("(() => { const s = olm.project.sources.find(s => s.builtin === 'breathe'); const rt = runtimeOf(s); return { clocks: Object.keys(rt.clocks || {}), shown: isfInputs(rt).map(i => i.NAME) }; })()")
    check("Breathe has a hidden clock for its rate", clk["clocks"] and all(c not in clk["shown"] for c in clk["clocks"]), clk)
    t = ev("(() => { const a = speedTime('test|x', 1); return a; })()"); time.sleep(0.25)
    t2 = ev("speedTime('test|x', 10)"); t3 = ev("speedTime('test|x', 10)")
    check("a clock keeps running when its rate changes (no jump back)", t2 >= t and t3 - t2 < 1, (t, t2, t3))

    # ---------- rotate and resize
    ev("olm.loadProject(demoProject())"); time.sleep(0.4)
    strips = "olm.project.fixtures.filter(f => f.name.startsWith('Strip'))"
    ev(f"olm.ui.sel = new Set({strips}.map(f => f.id)); onSelection()")
    F0 = ev("selFrame(rotatable())")
    ev("rotateSel(45)"); F1 = ev("selFrame(rotatable())")
    check("a group turns around its middle and its frame keeps its size", F1["angle"] == 45 and abs(F1["w"] - F0["w"]) < 0.5 and abs(F1["h"] - F0["h"]) < 0.5 and abs(F1["cx"] - F0["cx"]) < 0.5, (F0, F1))
    check("the group keeps the angle", ev(f"groupById({strips}[0].group).rot") == 45)
    L0 = ev(f"{strips}.map(f => Math.hypot(f.x2 - f.x1, f.y2 - f.y1))")
    ev("resizeSel(selFrame(rotatable()).w * 2, selFrame(rotatable()).h)")
    L1 = ev(f"{strips}.map(f => Math.hypot(f.x2 - f.x1, f.y2 - f.y1))")
    check("resizing along the turned frame doubles the strips", all(abs(b / a - 2) < 0.01 for a, b in zip(L0, L1)), (L0, L1))
    check("pixel counts stay", ev(f"{strips}.map(f => f.pixels)") == [57, 57, 57, 57])
    ev("undo(); undo()")
    check("undo puts them back", abs(ev(f"{strips}[0].x2 - {strips}[0].x1") - 560) < 0.01 and ev(f"groupById({strips}[0].group).rot") is None)
    hs = ev("selHandles().map(h => h.selscale ? 's' : h.selrot ? 'r' : '?').join('')")
    check("a selection has 8 resize handles and a rotate handle", hs == "ssssssssr", hs)
    # a handle drag on the stage
    hd = ev("(() => { const h = selHandles().find(h => h.gx === 1 && h.gy === 0), r = cv.getBoundingClientRect(), p = toS(h.x, h.y); return [r.left + p[0], r.top + p[1]]; })()")
    W0 = ev("selFrame(rotatable()).w"); z = ev("olm.ui.view.zoom")
    pg.mouse.move(*hd); pg.mouse.down(); pg.mouse.move(hd[0] - W0 * z / 2, hd[1], steps=6); pg.mouse.up(); time.sleep(0.1)
    W1 = ev("selFrame(rotatable()).w")
    check("dragging the side handle halves the width", abs(W1 / W0 - 0.5) < 0.02, (W0, W1))
    ev("undo()")
    # one circle: frame handles, no radius handles; a side handle makes an oval
    ring = "olm.project.fixtures.find(f => f.name === 'Ring 2')"
    ev(f"olm.ui.sel = new Set([{ring}.id]); onSelection()")
    check("one circle has the frame handles", ev("selHandles().length") == 9 and ev(f"handlesOf({ring}).length") == 0)
    ev("(() => { const F = selFrame(rotatable()); resizeSel(F.w * 1.5, F.h); })()")
    check("stretching a circle one way makes an oval", ev(f"[{ring}.r, {ring}.ry]") == [120, 80], ev(f"[{ring}.r, {ring}.ry]"))
    ev("rotateSel(30)")
    o = ev(f"(() => {{ const r = {ring}; rebuildGeometry(); return {{ rot: r.rot, p0: [r._pts[0], r._pts[1]], cx: r.cx, cy: r.cy }}; }})()")
    import math
    exp = (o["cx"] + 80 * math.sin(math.radians(30)), o["cy"] - 80 * math.cos(math.radians(30)))
    check("an oval turns with its pixels", o["rot"] == 30 and abs(o["p0"][0] - exp[0]) < 0.5 and abs(o["p0"][1] - exp[1]) < 0.5, (o, exp))
    check("its frame follows its axes", ev("selFrame(rotatable()).angle") == 30)
    ev(f"(() => {{ const r = {ring}; r.start = numOr(r.start, 0) + numOr(r.rot, 0); delete r.rot; delete r.ry; markGeom(); }})()")
    # a circle in a turned selection turns its start
    ev("olm.ui.sel = new Set([olm.project.fixtures.find(f => f.name === 'Ring 1').id]); onSelection(); rotateSel(90)")
    check("a round circle turns its start angle", ev("olm.project.fixtures.find(f => f.name === 'Ring 1').start") == 90)
    # locked fixtures stay
    ev(f"olm.ui.sel = new Set({strips}.map(f => f.id)); onSelection(); {strips}[0].locked = true")
    a0 = ev(f"[{strips}[0].x1, {strips}[0].y1]"); ev("rotateSel(90)")
    check("locked fixtures stay put when the others turn", ev(f"[{strips}[0].x1, {strips}[0].y1]") == a0 and ev(f"Math.abs({strips}[1].x2 - {strips}[1].x1) < 1e-6"))
    ev(f"{strips}[0].locked = false; undo()")
    # R key
    ev(f"olm.ui.sel = new Set({strips}.map(f => f.id)); onSelection()"); pg.mouse.move(700, 300); pg.keyboard.press("r"); time.sleep(0.1)
    check("R turns the selection 90°", ev(f"{strips}.every(f => Math.abs(f.x1 - f.x2) < 1e-6)"))
    ev("undo()")

    # ---------- layers order
    ev("olm.ui.rightTab = 'content'; selectZone(olm.project.zones.find(z => z.name === 'Rings')); renderRight()")
    names = lambda: ev("[...document.querySelectorAll('.layers li .nm')].map(e => e.textContent)")
    n0 = names()
    pg.locator(".layers li").nth(1).hover(); pg.locator(".layers li").nth(1).locator(".mv button").first.click()
    check("a layer's ↑ moves it up", names() == n0[::-1], (n0, names()))
    pg.locator(".layers li").nth(1).drag_to(pg.locator(".layers li").nth(0), target_position={"x": 100, "y": 3})
    check("dragging a layer reorders", names() == n0, names())

    # ---------- controller form
    ev("olm.ui.dockTab = 'patch'; olm.ui.selCtrl = olm.project.controllers[0].id; renderDock()")
    labels = ev("[...document.querySelectorAll('.ctrl-fields .f > span')].map(e => e.textContent)")
    check("short labels", "Unis / output" in labels and "First uni" in labels, labels)
    check("no Find box, no discovery note", pg.locator(".pfind").count() == 0 and pg.locator(".discovered").count() == 0)
    pg.click(".onsw"); check("the switch turns a controller off", ev("olm.project.controllers[0].enabled") is False)
    settle(); check("an output that is off sends nothing", ev("olm.universes().length > 0 && olm.universes().every(u => !u.enabled)"))
    pg.click(".onsw"); check("and on", ev("olm.project.controllers[0].enabled") is True)
    pg.uncheck("#ctrlSkip"); check("Skip ch 511–512 off: all 512 channels", ev("olm.project.controllers[0].split") is True)
    pg.check("#ctrlSkip")
    pg.click(".btn.trash"); check("one click on the bin deletes nothing", ev("olm.project.controllers.length") == 1)
    pg.dblclick(".btn.trash"); check("a double-click deletes", ev("olm.project.controllers.length") == 0)
    ev("undo()"); check("undo brings it back", ev("olm.project.controllers.length") == 1)

    # ---------- networks for discovery
    ev("""(() => { olm.bridge.hello.nets = [{ name: 'en0', ip: '2.0.0.10', mask: '255.0.0.0', prefix: 8, broadcast: '2.255.255.255' },
        { name: 'wlan', ip: '192.168.1.20', mask: '255.255.255.0', prefix: 24, broadcast: '192.168.1.255' }];
      const node = (ip, u) => ({ ip, bindIndex: 0, shortName: 'N' + ip, longName: '', report: '', ports: 1, outUniverses: u, mac: '' });
      olm.bridge.nodes.clear(); olm.bridge.nodes.set('a', node('2.0.0.50', [0, 1, 2])); olm.bridge.nodes.set('b', node('192.168.1.77', [5]));
      olm.ui.scanOff = []; olm.ui.dockTab = 'nodes'; renderDock(); })()""")
    check("a chip per network", pg.locator(".netchip").count() == 2)
    check("both nodes listed, with their network", pg.locator(".nodes tbody tr").count() == 2 and "wlan" in pg.inner_text(".nodes tbody"))
    pg.locator(".netchip").nth(1).locator("input").uncheck(); time.sleep(0.1)
    check("unticking a network hides its nodes", pg.locator(".nodes tbody tr").count() == 1 and "1 more on networks turned off" in pg.inner_text(".nodes"))
    ev("(() => { window._sent = []; const o = olm.bridge.ws.send.bind(olm.bridge.ws); olm.bridge.ws.send = d => { window._sent.push(d); o(d); }; })()")
    pg.click("text=Discover"); time.sleep(0.2)
    sent = ev("window._sent.map(JSON.parse).filter(m => m.t === 'poll')")
    check("Discover sends only the ticked networks", sent and sent[-1]["ifaces"] == ["2.0.0.10"], sent)
    ev("olm.ui.scanOff = []; savePrefs()")
    ev("addNodeAsController(nodeDevices().find(n => n.ip === '2.0.0.50'))"); time.sleep(0.1)
    c = ev("olm.project.controllers.find(c => c.ip === '2.0.0.50')")
    check("Add as controller keeps what the device reported", c and c["discovered"] == [0, 1, 2] and c["startUniverse"] == 0, c)
    check("the row shows the reported universes", pg.inner_text(".ctrl-fields .reported") == "U 0–2")

    # ---------- a turned group's copies keep its frame
    ev(f"olm.ui.sel = new Set({strips}.map(f => f.id)); onSelection(); rotateSel(30)")
    ev("duplicateSel()"); time.sleep(0.1)
    check("a duplicated turned group keeps its angle", ev("olm.project.groups.filter(g => g.name.startsWith('Strips')).map(g => g.rot)") == [30, 30], ev("olm.project.groups.map(g => [g.name, g.rot])"))
    ev("undo()")
    ev(f"olm.ui.sel = new Set({strips}.map(f => f.id)); onSelection()")
    ev("d => pasteFixtures(d)", ev("clipOfSel()")); time.sleep(0.1)
    check("a pasted turned group keeps its angle", ev("olm.project.groups.filter(g => g.name.startsWith('Strips')).map(g => g.rot)") == [30, 30], ev("olm.project.groups.map(g => [g.name, g.rot])"))
    ev("undo(); undo()")
    # ---------- everything survives saving and opening
    ev(f"olm.ui.sel = new Set({strips}.map(f => f.id)); onSelection(); rotateSel(30)")
    ev(f"(() => {{ const r = {ring}; r.ry = 40; r.rot = 15; r.gamma = 2.4; markGeom(); commit(); }})()")
    before = ev("JSON.parse(serialize(false))")
    ev("olm.loadProject(JSON.parse(serialize(false)))"); time.sleep(0.3)
    after = ev("JSON.parse(serialize(false))")
    pick = lambda p: (p["groups"], [(f["name"], f.get("rot"), f.get("ry"), f.get("gamma"), f.get("start")) for f in p["fixtures"]], [(c["ip"], c.get("discovered"), c["split"], c["enabled"]) for c in p["controllers"]])
    check("group angle, ovals, gamma, discovery survive a save", pick(before) == pick(after), (pick(before)[0], pick(after)[0]))
    check("no page errors", not errs, errs)
    br.close()
bridge.terminate()
print("FAILED:", fails or "none")
