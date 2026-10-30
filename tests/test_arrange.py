# Reordering zones, fixtures and scenes by dragging; align, distribute and centre
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge
from test_e2e_lib import base_project, solid
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8190
bridge = start_bridge(PORT)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
names = lambda pg: pg.evaluate("olm.project.zones.map(z => z.name)")
def drop(pg, src, dst, half):
    b = dst.bounding_box()
    src.drag_to(dst, target_position={"x": min(30, b["width"] / 2), "y": 4 if half == "top" else b["height"] - 4})
    time.sleep(0.3)
with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 1200})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    pg.evaluate("localStorage.clear(); olm.loadProject(olm.project)"); time.sleep(0.5)
    # ---- zones in the Content tab (listed top first: All, Rings, Strips)
    pg.click("#rightTabs button[data-tab=content]"); time.sleep(0.3)
    items = lambda: pg.locator(".list.zones li")
    check("zone list shows the top zone first", names(pg) == ["Strips", "Rings", "All"])
    drop(pg, items().nth(2), items().nth(0), "top")          # Strips onto the top half of All
    check("dragging a zone above another puts it over that zone", names(pg) == ["Rings", "All", "Strips"], names(pg))
    pg.keyboard.press("Escape"); pg.keyboard.press("Control+z"); time.sleep(0.3)
    check("Ctrl Z undoes the new order", names(pg) == ["Strips", "Rings", "All"], names(pg))
    drop(pg, items().nth(0), items().nth(2), "bottom")       # All onto the bottom half of Strips
    check("dragging a zone below the last one puts it at the bottom", names(pg) == ["All", "Strips", "Rings"], names(pg))
    # the opacity slider inside a zone item still works and doesn't drag the zone
    order = names(pg)
    sl = items().nth(1).locator("input[type=range]"); sb = sl.bounding_box()
    op0 = pg.evaluate("olm.project.zones[1].opacity")
    pg.mouse.move(sb["x"] + sb["width"] - 3, sb["y"] + sb["height"] / 2); pg.mouse.down(); pg.mouse.move(sb["x"] + 6, sb["y"] + sb["height"] / 2 + 20, steps=8); pg.mouse.up(); time.sleep(0.3)
    check("a zone's opacity slider still slides, without dragging the zone", names(pg) == order and pg.evaluate("olm.project.zones[1].opacity") < op0, (names(pg), op0, pg.evaluate("olm.project.zones[1].opacity")))
    pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z"); time.sleep(0.3)
    # ---- zones and scenes in the Scenes panel
    pg.evaluate("p => olm.loadProject(p)", pg.evaluate("JSON.parse(JSON.stringify(olm.project, (k, v) => k.startsWith('_') ? undefined : v))"))
    pg.click("#dockTabs button[data-tab=scenes]"); time.sleep(0.2)
    pg.evaluate("() => { olm.ui.dockH = 520; renderDock(); }"); time.sleep(0.4)   # every row on screen
    rows = lambda: pg.locator(".scenerow")
    heads = lambda: pg.locator(".scenerow .zhead")
    before = names(pg)
    drop(pg, heads().nth(0), rows().nth(1), "bottom")          # top zone's header below the second row
    after = names(pg)
    check("dragging a zone header in the Scenes panel reorders the zones", after == [before[0], before[2], before[1]], (before, after))
    # an empty zone gets a scene dropped on its row
    pg.evaluate("() => { addZone({ x: 0, y: 0, w: 100, h: 100 }); }"); time.sleep(0.4)
    empty = pg.evaluate("olm.project.zones[0].name")
    src_zone = pg.evaluate("olm.project.zones[olm.project.zones.length - 1]")
    n0 = len(src_zone["scenes"])
    tile = pg.locator(".scenerow").nth(0).locator(".scene").nth(0)
    moved_name = tile.locator(".nm").inner_text()
    print("   dragging", moved_name, "from", pg.locator(".scenerow").nth(0).locator(".zhead .nm").inner_text(), "to", pg.locator(".scenerow").last.locator(".zhead .nm").inner_text())
    drop(pg, tile, pg.locator(".scenerow").last, "bottom")   # the new zone is at the bottom (added under the others)
    st = pg.evaluate("() => ({ top: olm.project.zones[olm.project.zones.length - 1].scenes.map(s => s.name), empty: olm.project.zones[0].scenes.map(s => s.name) })")
    check("a scene dropped on a zone row with no scenes moves there", st["empty"] == [moved_name] and len(st["top"]) == n0 - 1, st)
    # ---- fixtures: drag in the list to reorder; several at once; dragging onto a patch output still patches
    pg.evaluate("p => olm.loadProject(p)", {"name": "F", "settings": {"compW": 400, "compH": 200, "transition": 0},
        "fixtures": [{"id": "a", "type": "line", "name": "A", "x1": 20, "y1": 50, "x2": 120, "y2": 50, "pixels": 4},
                     {"id": "b", "type": "line", "name": "B", "x1": 250, "y1": 150, "x2": 380, "y2": 150, "pixels": 4},
                     {"id": "c", "type": "line", "name": "C", "x1": 150, "y1": 100, "x2": 200, "y2": 100, "pixels": 4},
                     {"id": "d", "type": "line", "name": "D", "x1": 30, "y1": 180, "x2": 60, "y2": 180, "pixels": 4}],
        "controllers": [{"id": "c1", "name": "C1", "ip": "127.0.0.1", "outputs": 2, "upo": 1, "startUniverse": 3, "chains": [[], []]}],
        "zones": [{"id": "zl", "name": "L", "x": 0, "y": 0, "w": 200, "h": 200, "layers": [solid([1, 0, 0])]}, {"id": "zr", "name": "R", "x": 200, "y": 0, "w": 200, "h": 200, "layers": [solid([0, 0, 1])]}]})
    time.sleep(0.8)
    fx = lambda: pg.evaluate("olm.project.fixtures.map(f => f.name).join('')")
    lis = lambda: pg.locator("#fxList li")
    drop(pg, lis().nth(0), lis().nth(2), "bottom")            # A below C
    check("dragging a fixture in the list reorders it", fx() == "BCAD", fx())
    lis().nth(0).click(); lis().nth(3).click(modifiers=["Control"]); time.sleep(0.2)  # B and D
    drop(pg, lis().nth(3), lis().nth(2), "bottom")            # drag D (with B) below A
    check("several selected fixtures move together, in their order", fx() == "CABD", fx())
    time.sleep(0.8)
    cols = pg.evaluate("olm.project.fixtures.map(f => f.name + Array.from(f._col.slice(0, 3)).join(','))")
    check("after reordering, each fixture still takes its own colour", cols == ["C255,0,0", "A255,0,0", "B0,0,255", "D255,0,0"], cols)
    pg.click("#dockTabs button[data-tab=patch]"); time.sleep(0.4)
    lis().nth(0).click(); time.sleep(0.2)                       # C
    lis().nth(0).drag_to(pg.locator(".outrow").nth(1)); time.sleep(0.4)
    check("dragging a fixture onto a patch output still patches it", pg.evaluate("olm.project.controllers[0].chains[1]") == ["c"] and fx() == "CABD", (pg.evaluate("olm.project.controllers[0].chains"), fx()))
    # ---- arrange
    pg.click("#rightTabs button[data-tab=inspector]"); time.sleep(0.2)
    pg.evaluate("() => { olm.ui.sel = new Set(['a', 'b', 'c']); onSelection(); }"); time.sleep(0.3)
    bounds = lambda: pg.evaluate("olm.project.fixtures.filter(f => 'abc'.includes(f.id)).sort((p, q) => p.id < q.id ? -1 : 1).map(f => { const b = fixtureBounds(f); return [b.x0, b.y0, b.x1, b.y1]; })")
    pg.click("button[aria-label='Align left']"); time.sleep(0.2)
    b = bounds(); check("align left: the same left edge as the leftmost", len({x[0] for x in b}) == 1 and b[0][0] == 20, b)
    pg.click("button[aria-label='Align centres vertically']"); time.sleep(0.2)
    b = bounds(); mids = {(x[1] + x[3]) / 2 for x in b}
    check("align centres vertically: the same middle, in the middle of the selection", len(mids) == 1 and list(mids)[0] == 100, b)
    pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z"); time.sleep(0.3)
    b = bounds(); check("undo puts them back", b == [[20, 50, 120, 50], [250, 150, 380, 150], [150, 100, 200, 100]], b)
    pg.click("button[aria-label='Distribute horizontally: the same spacing between centres']"); time.sleep(0.2)
    b = bounds(); cx = sorted((x[0] + x[2]) / 2 for x in b)
    check("distribute horizontally: equal spacing between centres, the outermost two stay", cx == [70, 180.75, 291.5] or abs((cx[1] - cx[0]) - (cx[2] - cx[1])) < 1e-6 and cx[0] == 70 and cx[2] == 315, cx)
    pg.click("button[aria-label='Centre them together on the canvas']"); time.sleep(0.2)
    b = bounds(); box = [min(x[0] for x in b), min(x[1] for x in b), max(x[2] for x in b), max(x[3] for x in b)]
    check("centre together on the canvas", (box[0] + box[2]) / 2 == 200 and (box[1] + box[3]) / 2 == 100, box)
    pg.evaluate("() => { olm.ui.sel = new Set(['d']); onSelection(); }"); time.sleep(0.3)
    pg.click("button[aria-label='Align right']"); time.sleep(0.2)
    d = pg.evaluate("(() => { const b = fixtureBounds(olm.project.fixtures.find(f => f.id === 'd')); return [b.x0, b.x1]; })()")
    check("one fixture aligns to the canvas", d[1] == 400, d)
    # locked fixtures stay put but still count for the selection's box, so the others line up with them
    pg.evaluate("""() => { const F = id => olm.project.fixtures.find(f => f.id === id);
        Object.assign(F('a'), { x1: 20, y1: 50, x2: 120, y2: 50 }); Object.assign(F('b'), { x1: 250, y1: 150, x2: 380, y2: 150, locked: true });
        Object.assign(F('c'), { x1: 150, y1: 100, x2: 200, y2: 100 }); markGeom(); olm.ui.sel = new Set(['a', 'b', 'c']); onSelection(); }"""); time.sleep(0.3)
    geo = lambda: pg.evaluate("Object.fromEntries(olm.project.fixtures.map(f => { const b = fixtureBounds(f); return [f.id, [b.x0, b.y0, b.x1, b.y1]]; }))")
    note = lambda: pg.evaluate("[...document.querySelectorAll('#rightBody h3')].find(h => h.textContent.trim() === 'Arrange').parentElement.querySelector('.note')?.textContent || ''")
    check("with some free, Arrange shows no explanation (its buttons say what they do on pointing)", note() == "", note())
    pg.click("button[aria-label='Align right']"); time.sleep(0.2)
    g = geo(); check("align right with a locked fixture: the others line up with it, it stays", g["a"][2] == 380 and g["c"][2] == 380 and g["b"] == [250, 150, 380, 150], g)
    pg.evaluate("() => { olm.ui.sel = new Set(['b', 'd']); onSelection(); }"); time.sleep(0.3)
    d0 = geo()["d"]
    pg.click("button[aria-label='Align top']"); time.sleep(0.2)
    g = geo(); check("two selected, one locked: the other aligns to the locked one", g["d"][1] == 150 and g["d"][3] == 150 and g["d"][0] == d0[0] and g["b"] == [250, 150, 380, 150], (d0, g["d"], g["b"]))
    pg.evaluate("() => { olm.ui.sel = new Set(['b']); onSelection(); }"); time.sleep(0.3)
    dis = pg.evaluate("[...document.querySelectorAll('button[aria-label^=Align], button[aria-label^=Centre]')].map(b => b.disabled)")
    check("one locked fixture: the buttons are off and the note says why", dis and all(dis) and note().startswith("Locked."), (dis, note()))
    check("no page errors", not errs, errs[:3])
    br.close()
bridge.terminate(); bridge.communicate()
print("FAILED:", fails or "none")
