import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import FakeNode, start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = 8093
node = FakeNode()
bridge = start_bridge(PORT)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail) if detail else ""))
    if not ok: fails.append(name)

A, B = [0.8, 0.4, 0.2], [0.5, 0.5, 1.0]
def base_project(layers, scenes=None):
    return {"name": "T", "settings": {"compW": 400, "compH": 200, "transition": 0, "gamma": 1},
            "fixtures": [{"id": "f1", "type": "line", "name": "L", "enabled": True, "locked": False, "tag": "#fff", "order": "RGB",
                          "reverse": False, "dimmer": 1, "x1": 100, "y1": 100, "x2": 300, "y2": 100, "pixels": 5}],
            "controllers": [{"id": "c1", "name": "C", "ip": "127.0.0.1", "enabled": True, "outputs": 1, "upo": 1, "startUniverse": 3, "split": False, "chains": [["f1"]]}],
            "zones": [{"id": "z1", "name": "Zone 1", "tag": "#ffb341", "x": 0, "y": 0, "w": 400, "h": 200, "opacity": 1, "layers": layers, "scenes": scenes or [], "scene": None}]}
def solid(c, **kw): return dict({"id": kw.pop("id", None) or os.urandom(4).hex(), "src": "b-solid", "params": {"b-solid": {"color": c + [1]}}, "opacity": 1, "blend": "alpha", "on": True}, **kw)

with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS)
    ctx = br.new_context(viewport={"width": 1500, "height": 950})
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/")
    pg.wait_for_function("window.olm && olm.bridge.connected", timeout=10000)
    time.sleep(1)
    info = pg.evaluate("({ zones: olm.project.zones.map(z => [z.name, z.scenes.length, z.layers.map(l => l.src)]), sources: olm.project.sources.length, mixer: olm.mixer.ok })")
    check("demo loads with zones, scenes and layers", len(info["zones"]) == 3 and info["mixer"], info)
    col = lambda: pg.evaluate("Array.from(olm.project.fixtures[0]._col.slice(6, 9))")

    # --- blend maths, with two layers sharing one shader (per-layer parameters)
    def expect(mode, b, t, a):
        f = {"alpha": lambda b, t: t, "add": lambda b, t: min(b + t, 1), "screen": lambda b, t: 1 - (1 - b) * (1 - t), "multiply": lambda b, t: b * t,
             "subtract": lambda b, t: max(b - t, 0), "lighten": max, "darken": min, "difference": lambda b, t: abs(b - t)}[mode]
        return [round(255 * (bb + (f(bb, tt) - bb) * a)) for bb, tt in zip(b, t)]
    for mode in ["alpha", "add", "screen", "multiply", "subtract", "lighten", "darken", "difference"]:
        pg.evaluate("p => olm.loadProject(p)", base_project([solid(A), solid(B, blend=mode, opacity=0.6)]))
        time.sleep(0.35)
        got, exp = col(), expect(mode, [round(x * 255) / 255 for x in A], [round(x * 255) / 255 for x in B], 0.6)
        check(f"blend {mode}", all(abs(g - e) <= 2 for g, e in zip(got, exp)), f"got {got} expected {exp}")
    pg.evaluate("p => olm.loadProject(p)", base_project([solid(A), solid(B, on=False)]))
    time.sleep(0.3)
    check("hidden layer ignored", all(abs(g - round(x * 255)) <= 1 for g, x in zip(col(), A)), col())

    # --- scenes: fade, cut, interrupted fade
    red, blue = solid([1, 0, 0], id="L1"), solid([0, 0, 1], id="L1")
    scenes = [{"id": "s1", "name": "Red", "fade": 1.0, "tag": "#f00", "layers": [red]}, {"id": "s2", "name": "Blue", "fade": 2.0, "tag": "#00f", "layers": [blue]}]
    pg.evaluate("p => olm.loadProject(p)", base_project([solid([0, 1, 0])], scenes))
    time.sleep(0.3)
    Z = "olm.project.zones[0]"
    pg.evaluate(f"olm.goScene({Z}, {Z}.scenes[0], true)"); time.sleep(0.25)
    check("cut to scene", col() == [255, 0, 0], col())
    pg.evaluate(f"olm.goScene({Z}, {Z}.scenes[1])")
    samples = []
    for _ in range(8): time.sleep(0.12); samples.append(col())
    mono = all(samples[i][2] <= samples[i + 1][2] + 1 for i in range(len(samples) - 1)) and all(samples[i][0] >= samples[i + 1][0] - 1 for i in range(len(samples) - 1))
    mid = samples[-1]
    check("fade progresses smoothly red→blue", mono and 40 < mid[2] < 215 and abs(mid[0] + mid[2] - 255) <= 3, samples)
    before = col()
    pg.evaluate(f"olm.goScene({Z}, {Z}.scenes[0])")   # interrupt: fade back to red from where we are
    time.sleep(0.06); after = col()
    check("interrupted fade starts from current colour (no jump)", abs(after[2] - before[2]) <= 30 and abs(after[0] - before[0]) <= 30, f"{before} -> {after}")
    time.sleep(1.2)
    check("interrupted fade ends on the new scene", col() == [255, 0, 0], col())
    check("status bar names the scene", "Red" in pg.inner_text("#status"))

    # --- keyboard: key 2 recalls scene 2, Shift cuts
    pg.click("#view", position={"x": 20, "y": 20}); pg.keyboard.press("Shift+Digit2"); time.sleep(0.25)
    check("Shift+2 cuts to scene 2", col() == [0, 0, 255], col())

    # --- store / edited badge / delete / undo through the UI
    pg.evaluate("olm.ui.dockTab = 'scenes'; olm.ui.dockCollapsed = false"); pg.click("#dockTabs button[data-tab=scenes]")
    pg.click(".zhead >> text=+ Store"); time.sleep(0.2)
    n = pg.evaluate("olm.project.zones[0].scenes.length")
    check("Store scene adds a scene", n == 3, n)
    pg.evaluate("olm.project.zones[0].layers[0].opacity = 0.5"); pg.evaluate("olm.loadSource('b-noise')")
    pg.click("#dockTabs button[data-tab=scenes]"); time.sleep(0.1)
    check("edited badge after changing the layers", pg.locator(".scene.live .badge").count() == 1)
    pg.locator(".scene").nth(2).locator("button.x").click(); pg.click(".menu >> text=Delete"); time.sleep(0.1)
    n2 = pg.evaluate("olm.project.zones[0].scenes.length")
    pg.keyboard.press("Control+z"); time.sleep(0.2)
    n3 = pg.evaluate("olm.project.zones[0].scenes.length")
    check("delete scene, then undo restores it", n2 == 2 and n3 == 3, (n2, n3))

    # --- Art-Net bytes, Web Lock
    pg.evaluate("p => olm.loadProject(p)", base_project([solid([1, 0.5, 0.25])]))
    time.sleep(0.3)
    pg.evaluate("olm.setOutput(true)"); time.sleep(0.6)
    d = node.last(3)
    check("Art-Net universe 3 carries the layer colour", d is not None and list(d[:15]) == [255, 128, 64] * 5, list(d[:15]) if d else None)
    locks = pg.evaluate("navigator.locks.query().then(q => q.held.map(l => l.name))")
    check("Web Lock held while Art-Net is on", any(l.startswith("openledmapper-output-") for l in locks), locks)

    # --- a second window taking over
    pg2 = ctx.new_page(); pg2.goto(f"http://127.0.0.1:{PORT}/"); pg2.wait_for_function("window.olm && olm.bridge.connected", timeout=10000)
    pg2.evaluate("olm.setOutput(true)"); time.sleep(0.5)
    on1, on2 = pg.evaluate("olm.ui.outputOn"), pg2.evaluate("olm.ui.outputOn")
    locks = pg.evaluate("navigator.locks.query().then(q => q.held.map(l => l.name))")
    check("second window takes over Art-Net, first stops", (on1, on2) == (False, True), (on1, on2))
    check("first window released its Web Lock", sum(1 for l in locks if l.startswith("openledmapper-output-")) == 1, locks)
    pg2.evaluate("olm.setOutput(false)"); time.sleep(0.3); pg2.close()

    # --- migration of a Weft 0.1 project
    old = base_project([]); del old["zones"]
    old["sources"] = [{"id": "b-bars", "kind": "isf", "builtin": "bars", "name": "Bars", "params": {"count": 7}},
                      {"id": "x1", "kind": "isf", "name": "Mine", "code": "/*{\"INPUTS\":[]}*/ void main(){gl_FragColor=vec4(1.0);}", "params": {}}]
    old["activeSource"] = "b-bars"
    pg.evaluate("p => olm.loadProject(p)", old)
    m = pg.evaluate("({ layers: olm.project.zones[0].layers, active: 'activeSource' in olm.project, srcParams: olm.project.sources.some(s => 'params' in s), n: olm.project.sources.length, last: olm.project.sources.at(-1).id })")
    check("0.1 project migrates to one layer keeping parameters", len(m["layers"]) == 1 and m["layers"][0]["src"] == "b-bars" and m["layers"][0]["params"]["b-bars"]["count"] == 7 and not m["active"] and not m["srcParams"] and m["last"] == "x1", m)

    errs = [e for e in errs if "ERR_TUNNEL_CONNECTION_FAILED" not in e]  # Google Fonts is blocked in this sandbox
    check("no console errors", not errs, errs[:5])
    br.close()
bridge.terminate(); out = bridge.communicate()[0]
print("--- bridge log ---\n" + out)
print("FAILED:", fails if fails else "none")
