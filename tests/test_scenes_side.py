# The scenes beside the stage (ui-dock.js): the place buttons (bottom, left, right, a window); left or right, a column the
# full height with the fixtures and the Inspector folded (their buttons bring them back) and Patch alone at the bottom,
# folded; the scenes wrapping in a grid, A above B when narrow and side by side when wide; playing, levels and fades'
# progress from there; the divider dragged, its double-click; the window and back to the side; kept after a reload.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8256
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    ctx = br.new_context(viewport={"width": 1600, "height": 900})
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    E = pg.evaluate
    E("localStorage.clear()")
    E("(() => { olm.loadProject(demoProject()); for (const z of project.zones) while (z.scenes.length < 8) storeScene(z); ui.dockTab = 'scenes'; ui.dockCollapsed = false; renderDock(); })()"); time.sleep(0.6)
    box = lambda s: pg.locator(s).bounding_box()
    col = lambda: pg.locator("#scenesCol").is_visible()
    places = lambda root: E(f"[...$$('{root} .spos button')].map(b => b.dataset.place + (b.classList.contains('on') ? '*' : ''))")

    check("at first the scenes are at the bottom, with four place buttons", not col() and places("#dockBody") == ["bottom*", "left", "right", "window"], places("#dockBody"))
    st0 = box("#stage")["width"]
    pg.click("#dockBody .spos button[data-place=right]"); time.sleep(0.8)
    check("Right: a column the full height on the right of the stage", col() and box("#scenesCol")["x"] > box("#stage")["x"] + box("#stage")["width"] - 2
          and box("#scenesCol")["height"] > box(".center")["height"] - 4)
    check("…the fixtures and the Inspector fold", not pg.locator("aside.left").is_visible() and not pg.locator("aside.right").is_visible())
    check("…the scenes are there, none left in the bottom panel, whose Scenes tab goes", pg.locator("#scenesBody .scene").count() == 24 and pg.locator("#dockBody .scene").count() == 0
          and not pg.locator("#dockTabs [data-tab=scenes]").is_visible())
    check("…Patch stays at the bottom, folded to its tab bar", E("ui.dockTab") == "patch" and E("ui.dockCollapsed") and box("#dock")["height"] <= 34)
    check("…the place buttons in the column's head show Right", places("#scenesTools") == ["bottom", "left", "right*", "window"])
    half = abs(box("#scenesCol")["width"] - box(".center")["width"] / 2) < 4
    check("…half and half at first", half, (box("#scenesCol")["width"], box(".center")["width"]))
    check("…the scenes wrap: no row scrolls sideways", pg.locator("#scenesBody .hscroll").count() == 0 and E("$$('#scenesBody .stiles').every(t => t.scrollWidth <= t.clientWidth + 1)"))
    pg.click("#btnLeft"); time.sleep(0.4)
    check("the fixtures' button brings them back beside the column", pg.locator("aside.left").is_visible() and col())
    pg.click("#btnLeft"); time.sleep(0.3)

    # ---------- playing there
    Z = E("project.zones.at(-1).id")
    tile = pg.locator(f"#scenesBody .zoneblock[data-zone='{Z}'] .scene").nth(2)
    tile.click(); time.sleep(0.4)
    check("a scene clicked there plays", E(f"(() => {{ const z = zoneById('{Z}'); return z.scene === z.scenes[2].id; }})()"))
    r = pg.locator(f"#scenesBody .zoneblock[data-zone='{Z}'] input[data-zone-op]")
    r.evaluate("e => { e.value = 0.4; e.dispatchEvent(new Event('input', { bubbles: true })); }"); time.sleep(0.2)
    check("its level slider moves the zone", abs(E(f"zoneById('{Z}').opacity") - 0.4) < 1e-6)
    E(f"setZoneOpacity(zoneById('{Z}'), 1)")
    E(f"(() => {{ const z = zoneById('{Z}'); z.scenes[3].fade = 3; goScene(z, z.scenes[3]); }})()"); time.sleep(0.8)
    prog = E(f"parseFloat($(`#scenesBody .scene[data-id='${{zoneById('{Z}').scenes[3].id}}'] .prog`).style.width) || 0")
    check("a fade's progress moves on its tile there", prog > 5, prog)

    # ---------- the divider
    w0 = box("#scenesCol")["width"]
    g = box("#scenesGrip"); x, y = g["x"] + g["width"] / 2, g["y"] + 300
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 250, y, steps=6); pg.mouse.up(); time.sleep(0.5)
    w1 = box("#scenesCol")["width"]
    check("dragging the divider right makes the column narrower and the stage wider", abs(w1 - (w0 - 250)) < 6 and E("ui.scenesW") == round(w1), (w0, w1, E("ui.scenesW")))
    check("…the stage's canvas takes its new size", abs(E("$('#stage canvas').getBoundingClientRect().width") - box("#stage")["width"]) < 3)
    pg.mouse.move(x + 250 - 0, y); g = box("#scenesGrip"); pg.mouse.move(g["x"] + 3, y); pg.mouse.down(); pg.mouse.move(g["x"] + 3 + 2000, y, steps=4); pg.mouse.up(); time.sleep(0.4)
    check("…never narrower than 260px", abs(box("#scenesCol")["width"] - 260) < 3, box("#scenesCol")["width"])
    g = box("#scenesGrip"); pg.mouse.move(g["x"] + 3, y); pg.mouse.down(); pg.mouse.move(g["x"] + 3 - 3000, y, steps=4); pg.mouse.up(); time.sleep(0.4)
    check("…and the stage never narrower than 240px", box("#stage")["width"] >= 230, box("#stage")["width"])
    pg.dblclick("#scenesGrip"); time.sleep(0.4)
    check("double-click: half and half again", abs(box("#scenesCol")["width"] - box(".center")["width"] / 2) < 4 and E("ui.scenesW") == 0)

    # ---------- the X-Fader: A above B when narrow, side by side when wide
    E("setXfadeOn(true)"); time.sleep(0.5); pg.keyboard.press("Escape"); time.sleep(0.2)
    pair = lambda: E("(() => { const b = $$('#scenesBody .xfpair > .zoneblock').map(e => e.getBoundingClientRect()); return b.length === 2 ? (Math.abs(b[0].top - b[1].top) < 2 ? 'side' : b[1].top > b[0].bottom - 2 ? 'above' : '?') : 'none'; })()")
    check("wide: A and B side by side", pair() == "side", (pair(), box("#scenesCol")["width"]))
    check("…the X-Fader's strip at the bottom of the column", pg.locator("#scenesBody .xfstrip, #scenesBody canvas[data-xf-pv]").count() >= 2)
    E("ui.scenesW = 420; renderDock()"); time.sleep(0.5)
    check("narrow: A above B", pair() == "above", pair())
    E("ui.scenesW = 0; setXfadeOn(false)"); time.sleep(0.3)

    # ---------- left, the window, bottom
    pg.click("#scenesTools .spos button[data-place=left]"); time.sleep(0.6)
    check("Left: the column on the left of the stage", col() and box("#scenesCol")["x"] + box("#scenesCol")["width"] <= box("#stage")["x"] + 2 and places("#scenesTools")[1] == "left*")
    g = box("#scenesGrip"); w0 = box("#scenesCol")["width"]; pg.mouse.move(g["x"] + 3, 400); pg.mouse.down(); pg.mouse.move(g["x"] + 3 - 150, 400, steps=5); pg.mouse.up(); time.sleep(0.4)
    check("…its divider on its right edge: dragged left, narrower", abs(box("#scenesCol")["width"] - (w0 - 150)) < 6, (w0, box("#scenesCol")["width"]))
    pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.8)
    check("kept after a reload: on the left, at its width", col() and E("ui.scenesAt") == "left" and abs(box("#scenesCol")["width"] - (w0 - 150)) < 6)
    E("(() => { olm.loadProject(demoProject()); })()"); time.sleep(0.4)
    with pg.expect_popup() as pi: pg.click("#scenesTools .spos button[data-place=window]")
    W = pi.value; time.sleep(0.8)
    check("Window: the scenes in their own window, the column gone meanwhile", W.locator(".scene").count() > 0 and not col() and pg.locator("#scenesBody .scene").count() == 0)
    W.locator(".spos button[data-place=left]").click(); time.sleep(0.6)
    check("Left from the window: it closes and they are on the left again", W.is_closed() and col() and pg.locator("#scenesBody .scene").count() > 0)
    pg.click("#scenesTools .spos button[data-place=bottom]"); time.sleep(0.6)
    check("Bottom: back in the bottom panel's Scenes tab, open", not col() and pg.locator("#dockBody .scene").count() > 0 and E("ui.dockTab") == "scenes" and not E("ui.dockCollapsed")
          and pg.locator("#dockTabs [data-tab=scenes]").is_visible())
    check("…and the stage the whole width between the panels", box("#stage")["width"] > 1000)
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
