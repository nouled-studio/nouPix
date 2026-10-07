import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import FakeNode, start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
node = FakeNode(); bridge = start_bridge(8084)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail) if detail else "")); ok or fails.append(name)
rid = lambda: os.urandom(4).hex()
def solid(c, **kw): return dict({"id": rid(), "src": "b-solid", "params": {"b-solid": {"color": c + [1]}}, "opacity": 1, "blend": "alpha", "on": True}, **kw)
def zone(name, x, y, w, h, layers, opacity=1, scenes=None, zid=None):
    return {"id": zid or rid(), "name": name, "tag": "#ffb341", "x": x, "y": y, "w": w, "h": h, "opacity": opacity, "layers": layers, "scenes": scenes or [], "scene": None}
def proj(zones):
    fx = [{"id": "f1", "type": "line", "name": "L", "enabled": True, "locked": False, "tag": "#fff", "order": "RGB", "reverse": False, "dimmer": 1, "x1": 100, "y1": 100, "x2": 300, "y2": 100, "pixels": 5},
          {"id": "f2", "type": "line", "name": "P", "enabled": True, "locked": False, "tag": "#fff", "order": "RGB", "reverse": False, "dimmer": 1, "x1": 100, "y1": 70, "x2": 100, "y2": 70, "pixels": 1}]
    return {"name": "T", "settings": {"compW": 400, "compH": 200, "transition": 0, "gamma": 1}, "fixtures": fx,
            "controllers": [{"id": "c1", "name": "C", "ip": "127.0.0.1", "enabled": True, "outputs": 1, "upo": 1, "startUniverse": 5, "split": False, "chains": [["f1"]]}], "zones": zones}
with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS); ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto("http://127.0.0.1:8084/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    load = lambda pr: (pg.evaluate("p => olm.loadProject(p)", pr), time.sleep(0.5))
    px = lambda: pg.evaluate("Array.from(olm.project.fixtures[0]._col)")   # 5 pixels at x = 100..300
    pt = lambda: pg.evaluate("Array.from(olm.project.fixtures[1]._col)")   # 1 pixel at (100, 70)
    rgb = lambda a, i: a[3 * i: 3 * i + 3]
    near = lambda a, b, t=2: all(abs(x - y) <= t for x, y in zip(a, b))

    # 1. stacking and opacity: A (left half, red, top) over B (whole canvas, blue)
    load(proj([zone("B", 0, 0, 400, 200, [solid([0, 0, 1])]), zone("A", 0, 0, 200, 200, [solid([1, 0, 0])], opacity=0.25, zid="zA")]))
    a = px()
    check("upper zone blends over lower by its opacity", near(rgb(a, 0), [64, 0, 191]) and near(rgb(a, 1), [64, 0, 191]) and rgb(a, 3) == [0, 0, 255], [rgb(a, i) for i in range(5)])
    pg.evaluate("olm.project.zones[1].opacity = 0"); time.sleep(0.3)
    check("zone at opacity 0 shows nothing", all(rgb(px(), i) == [0, 0, 255] for i in range(5)), [rgb(px(), i) for i in range(5)])
    pg.evaluate("olm.project.zones[1].opacity = 1"); time.sleep(0.3)
    a = px()
    check("opaque upper zone covers the lower one", rgb(a, 0) == [255, 0, 0] and rgb(a, 1) == [255, 0, 0] and rgb(a, 4) == [0, 0, 255], [rgb(a, i) for i in range(5)])
    # 2. outside every zone is black
    load(proj([zone("A", 0, 0, 200, 200, [solid([1, 1, 1])])]))
    a = px()
    check("pixels outside every zone stay black", rgb(a, 0) == [255, 255, 255] and rgb(a, 3) == [0, 0, 0] and rgb(a, 4) == [0, 0, 0], [rgb(a, i) for i in range(5)])
    # 3. content fitted to the zone: a centred circle lands on the zone's centre, not the canvas's
    shape = {"id": rid(), "src": "b-shape", "params": {"b-shape": {"shape": 0, "size": 0.3, "softness": 0}}, "opacity": 1, "blend": "alpha", "on": True}
    load(proj([zone("Z", 50, 20, 100, 100, [shape])]))
    check("content fits the zone: circle centred on the zone centre", pt() == [255, 255, 255] and rgb(px(), 0) == [0, 0, 0], (pt(), rgb(px(), 0)))
    # 4. per-zone scenes: fading one zone leaves the other alone
    red, blue, green = solid([1, 0, 0], id="L"), solid([0, 0, 1], id="L"), solid([0, 1, 0], id="L")
    A = zone("A", 0, 0, 200, 200, [red], scenes=[{"id": "a1", "name": "Blue", "fade": 1.5, "layers": [blue]}], zid="zA")
    B = zone("B", 200, 0, 200, 200, [green], scenes=[{"id": "b1", "name": "Red", "fade": 0, "layers": [red]}], zid="zB")
    load(proj([B, A]))
    r = pg.evaluate("""async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), col = () => Array.from(olm.project.fixtures[0]._col);
      const [B, A] = olm.project.zones;
      olm.goScene(A, A.scenes[0]);
      const t0 = olm.clockT; while (olm.clockT - t0 < 0.7) await wait(20);
      const mid = col();
      olm.goScene(B, B.scenes[0], true);
      const c0 = olm.clockT; while (olm.clockT - c0 < 0.1) await wait(20);
      const afterCut = col(), stillFading = !!A._fade;
      while (A._fade) await wait(40);
      await wait(150);
      return { mid, afterCut, stillFading, end: col(), selected: olm.ui.zone };
    }""")
    m, c, e = r["mid"], r["afterCut"], r["end"]
    check("zone A fades on its own", 60 < m[2] < 200 and near(m[3 * 4: 3 * 4 + 3], [0, 255, 0]), (m[0:3], m[12:15]))
    check("cutting zone B does not disturb zone A's fade", r["stillFading"] and c[12:15] == [255, 0, 0] and 0 < c[2] < 255, (c[0:3], c[12:15]))
    check("both end on their scenes", e[0:3] == [0, 0, 255] and e[12:15] == [255, 0, 0], (e[0:3], e[12:15]))
    check("recalling a scene selects its zone", r["selected"] == "zB", r["selected"])
    # 5. keys 1-9 recall scenes of the selected zone
    pg.evaluate("olm.selectZone(olm.project.zones[1])")
    pg.click("#view", position={"x": 30, "y": 30}); pg.keyboard.press("Shift+Digit1"); time.sleep(0.3)
    check("key 1 recalls scene 1 of the selected zone", pg.evaluate("olm.project.zones[1].scene") == "a1")
    # 6. Art-Net bytes come from the composite
    load(proj([zone("B", 0, 0, 400, 200, [solid([0, 0, 1])]), zone("A", 0, 0, 200, 200, [solid([1, 0, 0])], opacity=0.5)]))
    pg.evaluate("olm.setOutput(true)")
    d, t0 = None, time.time()
    while time.time() - t0 < 5 and not (d and near(list(d[0:3]), [128, 0, 127])): time.sleep(0.2); d = node.last(5)  # this sandbox renders at ~2 fps
    check("Art-Net carries the zone mix", d is not None and near(list(d[0:3]), [128, 0, 127]) and list(d[12:15]) == [0, 0, 255], list(d[:15]) if d else None)
    pg.evaluate("olm.setOutput(false)"); time.sleep(0.3)
    # 7. migration: 0.2 project (layers and scenes at the top level) becomes one whole-canvas zone
    old = proj([]); del old["zones"]
    old["layers"] = [solid([1, 0, 1])]; old["scenes"] = [{"id": "s1", "name": "S", "fade": 1, "layers": [solid([0, 1, 1])]}]
    load(old)
    m = pg.evaluate("({ zones: olm.project.zones.map(z => ({ x: z.x, y: z.y, w: z.w, h: z.h, layers: z.layers.length, scenes: z.scenes.map(s => s.name) })), stray: ['layers', 'scenes', 'activeSource'].filter(k => k in olm.project) })")
    check("0.2 project opens as one whole-canvas zone", m["zones"] == [{"x": 0, "y": 0, "w": 400, "h": 200, "layers": 1, "scenes": ["S"]}] and not m["stray"], m)
    check("migrated colours come through", rgb(px(), 2) == [255, 0, 255], rgb(px(), 2))
    # 8. whole-canvas zone follows a new composition size
    pg.click("#rightTabs button[data-tab=settings]")
    w = pg.locator("input[aria-label=W]").first; w.fill("800"); w.press("Enter"); time.sleep(0.3)
    check("resizing the canvas keeps a whole-canvas zone whole", pg.evaluate("[olm.project.zones[0].w, olm.project.zones[0].h]") == [800, 200], pg.evaluate("[olm.project.zones[0].w, olm.project.zones[0].h]"))
    # 9. zone tool with the mouse
    load(proj([zone("All", 0, 0, 400, 200, [solid([1, 1, 1])])]))
    pg.evaluate("olm.setTool('zone')"); time.sleep(0.2)
    toScreen = lambda x, y: pg.evaluate("([x, y]) => { const r = document.getElementById('view').getBoundingClientRect(), v = olm.ui.view; return [r.left + v.x + x * v.zoom, r.top + v.y + y * v.zoom]; }", [x, y])
    def drag(a, b):
        pg.mouse.move(*toScreen(*a)); pg.mouse.down(); pg.mouse.move(*toScreen(*((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)), steps=4); pg.mouse.move(*toScreen(*b), steps=4); pg.mouse.up(); time.sleep(0.2)
    drag((40, 40), (140, 120))
    zs = pg.evaluate("olm.project.zones.map(z => [z.name, z.x, z.y, z.w, z.h])")
    check("dragging draws a new zone, under the others", len(zs) == 2 and zs[0][1:] == [40, 40, 100, 80], zs)
    drag((140, 120), (170, 150))   # its se handle (it is selected)
    check("dragging a handle resizes the zone", pg.evaluate("[olm.project.zones[0].w, olm.project.zones[0].h]") == [130, 110], pg.evaluate("[olm.project.zones[0].w, olm.project.zones[0].h]"))
    lab = pg.evaluate("(() => { const v = olm.ui.view; return [(40 * v.zoom + 20) / v.zoom, (40 * v.zoom - 12) / v.zoom]; })()")  # a point on its label, just above its top edge
    drag((lab[0], lab[1]), (lab[0] + 50, lab[1] + 30))
    check("dragging the label moves the zone", pg.evaluate("[olm.project.zones[0].x, olm.project.zones[0].y]") == [90, 70], pg.evaluate("[olm.project.zones[0].x, olm.project.zones[0].y]"))
    pg.mouse.click(*toScreen(300, 20)); time.sleep(0.2)
    check("clicking selects the zone under the pointer", pg.evaluate("olm.project.zones.find(z => z.id === olm.ui.zone).name") == "All")
    pg.keyboard.press("Control+z"); time.sleep(0.3)
    check("zone edits are undoable", pg.evaluate("[olm.project.zones[0].x, olm.project.zones[0].y]") == [40, 40], pg.evaluate("[olm.project.zones[0].x, olm.project.zones[0].y]"))
    pg.evaluate("olm.setTool('select')")
    # 10. thumbnails and the layer preview
    pg.evaluate("localStorage.clear(); olm.loadProject(JSON.parse(JSON.stringify(olm.project)))")
    load(proj([zone("All", 0, 0, 400, 200, [{"id": "pl", "src": "b-plasma", "params": {}, "opacity": 1, "blend": "alpha", "on": True}])]))
    time.sleep(1.5)
    sig = lambda sel: pg.evaluate("sel => { const c = document.querySelector(sel); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 97) s += d[i]; return s; }", sel)
    thumbs = pg.evaluate("[...document.querySelectorAll('#srcList .tile canvas')].map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s > 0; })")
    n_builtin = pg.evaluate("BUILTINS.length")
    check("every built-in source has a thumbnail", len(thumbs) == n_builtin and all(thumbs), (sum(thumbs), n_builtin))
    pg.hover("#srcList .tile >> nth=1"); s1 = sig("#srcList .tile:nth-child(2) canvas"); time.sleep(0.8); s2 = sig("#srcList .tile:nth-child(2) canvas")
    check("thumbnail plays while hovered", s1 != s2, (s1, s2))
    pg.mouse.move(700, 300); time.sleep(0.5)
    pg.click("#rightTabs button[data-tab=content]"); time.sleep(0.8)
    v1 = sig(".lpreview"); time.sleep(0.8); v2 = sig(".lpreview")
    check("layer preview is live above the parameters", v1 > 0 and v1 != v2, (v1, v2))
    check("no page errors", not errs, errs[:4])
    br.close()
bridge.terminate(); bridge.communicate()
print("FAILED:", fails or "none")
