# Panels moved to a side (ui-dock.js): the bottom panel's Scenes, Cue list and Timeline each have place buttons
# (bottom, left, right; the scenes also a window). Sent right, a panel is one more tab in the right panel after
# Inspector, Content and Settings, which stay; sent left, the left panel gets a tab row (Fixtures, then the moved
# ones). A moved tab has a ✕ that sends it back to the bottom. The bottom panel loses its tab meanwhile. The side is
# as wide as set while a moved tab is open (its edge dragged); playing and levels work there; kept after a reload.
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
    places = lambda root: E(f"[...$$('{root} .spos button')].map(b => b.dataset.place + (b.classList.contains('on') ? '*' : ''))")
    rtabs = lambda: E("[...$$('#rightTabs button:not(#btnHideRight)')].map(b => b.textContent.replace('✕', '').trim() + (b.classList.contains('on') ? '*' : ''))")

    check("the scenes at the bottom at first, with their place buttons", places("#dockBody") == ["bottom*", "left", "right", "window"], places("#dockBody"))
    pg.click("#dockBody .spos button[data-place=right]"); time.sleep(0.6)
    check("sent right: one more tab in the right panel, after Inspector, Content and Settings, open", rtabs() == ["Inspector", "Content", "Settings", "Scenes*"], rtabs())
    check("…the scenes drawn there, the right panel wider, none left at the bottom, whose Scenes tab goes",
          pg.locator("#rightHost .scene").count() == 24 and box("aside.right")["width"] > 450 and pg.locator("#dockBody .scene").count() == 0 and not pg.locator("#dockTabs [data-tab=scenes]").is_visible())
    check("…the left panel left as it was", pg.locator("aside.left").is_visible() and pg.locator("#leftTabs").is_hidden())
    check("…its tab has a ✕, its place buttons show Right", pg.locator("#rightTabs .mtab .mx").count() == 1 and places("#rightHost") == ["bottom", "left", "right*", "window"])
    check("…the scenes wrap there: no row scrolls sideways", pg.locator("#rightHost .hscroll").count() == 0)
    pg.click("#rightTabs button[data-tab=inspector]"); time.sleep(0.3)
    check("Inspector clicked: the Inspector shows, Scenes stays a tab, the panel back to its own width",
          rtabs() == ["Inspector*", "Content", "Settings", "Scenes"] and pg.locator("#rightBody").is_visible() and pg.locator("#rightHost").is_hidden() and box("aside.right")["width"] < 320, rtabs())
    pg.click("#rightTabs .mtab[data-panel=scenes]"); time.sleep(0.3)
    check("the Scenes tab clicked shows them again", pg.locator("#rightHost .scene").count() == 24 and rtabs()[-1] == "Scenes*")

    # ---------- playing there
    Z = E("project.zones.at(-1).id")
    pg.locator(f"#rightHost .zoneblock[data-zone='{Z}'] .scene").nth(2).click(); time.sleep(0.3)
    check("a scene clicked there plays", E(f"(() => {{ const z = zoneById('{Z}'); return z.scene === z.scenes[2].id; }})()"))
    r = pg.locator(f"#rightHost .zoneblock[data-zone='{Z}'] input[data-zone-op]")
    r.evaluate("e => { e.value = 0.4; e.dispatchEvent(new Event('input', { bubbles: true })); }"); time.sleep(0.2)
    check("its level slider moves the zone", abs(E(f"zoneById('{Z}').opacity") - 0.4) < 1e-6)
    E(f"setZoneOpacity(zoneById('{Z}'), 1)")
    E(f"(() => {{ const z = zoneById('{Z}'); z.scenes[3].fade = 3; goScene(z, z.scenes[3]); }})()"); time.sleep(0.8)
    prog = E(f"parseFloat($(`#rightHost .scene[data-id='${{zoneById('{Z}').scenes[3].id}}'] .prog`).style.width) || 0")
    check("a fade's progress moves on its tile there", prog > 5, prog)

    # ---------- the width
    w0 = box("aside.right")["width"]
    g = box("#rightGrip"); x, y = g["x"] + g["width"] / 2, g["y"] + 300
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 150, y, steps=6); pg.mouse.up(); time.sleep(0.4)
    w1 = box("aside.right")["width"]
    check("its edge dragged makes it wider, kept", abs(w1 - (w0 + 150)) < 6 and E("ui.sideW.right") == round(w1), (w0, w1))
    check("…the stage's canvas takes its new size", abs(E("$('#stage canvas').getBoundingClientRect().width") - box("#stage")["width"]) < 3)

    # ---------- the X-Fader: A above B when narrow, side by side when wide
    E("setXfadeOn(true)"); time.sleep(0.5); pg.keyboard.press("Escape"); time.sleep(0.2)
    pair = lambda: E("(() => { const b = $$('#rightHost .xfpair > .zoneblock').map(e => e.getBoundingClientRect()); return b.length === 2 ? (Math.abs(b[0].top - b[1].top) < 2 ? 'side' : b[1].top > b[0].bottom - 2 ? 'above' : '?') : 'none'; })()")
    E("ui.sideW.right = 760; renderSides()"); time.sleep(0.4)
    check("wide: A and B side by side", pair() == "side", pair())
    E("ui.sideW.right = 460; renderSides()"); time.sleep(0.4)
    check("narrow: A above B", pair() == "above", pair())
    E("setXfadeOn(false)"); time.sleep(0.3)

    # ---------- the ✕, the left side, several at once
    pg.click("#rightTabs .mtab[data-panel=scenes] .mx"); time.sleep(0.5)
    check("its ✕ sends it back to the bottom: the right panel's own again, the Scenes tab at the bottom, open",
          rtabs() == ["Inspector*", "Content", "Settings"] and pg.locator("#dockBody .scene").count() == 24 and E("ui.dockTab") == "scenes" and box("aside.right")["width"] < 320, rtabs())
    pg.click("#dockBody .spos button[data-place=left]"); time.sleep(0.5)
    ltabs = E("[...$$('#leftTabs button')].map(b => b.textContent.replace('✕', '').trim() + (b.classList.contains('on') ? '*' : ''))")
    check("sent left: the left panel gets a tab row, Fixtures then Scenes, open", ltabs == ["Fixtures", "Scenes*"] and pg.locator("#leftHost .scene").count() == 24, ltabs)
    pg.click("#leftTabs button:has-text('Fixtures')"); time.sleep(0.3)
    check("Fixtures clicked: the fixtures and sources as before", pg.locator("#fxList").is_visible() and pg.locator("#leftHost").is_hidden())
    E("ui.dockTab = 'cues'; renderDock()"); time.sleep(0.2)
    pg.locator("#dockBody .cuetabs .spos button[data-place=right]").click(); time.sleep(0.4)
    E("ui.dockTab = 'timeline'; renderDock()"); time.sleep(0.2)
    pg.locator("#dockBody .cuetabs .spos button[data-place=right]").click(); time.sleep(0.4)
    check("the cue list and the timeline sent right too: two tabs there, the last one open", rtabs() == ["Inspector", "Content", "Settings", "Cue list", "Timeline*"] and pg.locator("#rightHost .tlpanel").count() == 1, rtabs())
    check("…the bottom panel keeps Patch alone", E("[...$$('#dockTabs button[data-tab]')].filter(b => !b.hidden).map(b => b.dataset.tab)") == ["patch"] and E("ui.dockTab") == "patch")
    pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.8)
    check("kept after a reload", rtabs() == ["Inspector", "Content", "Settings", "Cue list", "Timeline*"] and E("[...$$('#leftTabs button')].length") == 2)
    E("(() => { olm.loadProject(demoProject()); })()"); time.sleep(0.4)
    E("openSideTab('left', 'scenes')"); time.sleep(0.3)
    with pg.expect_popup() as pi: pg.click("#leftHost .spos button[data-place=window]")
    W = pi.value; time.sleep(0.8)
    check("Window: the scenes in their own window, their tab on the left showing nothing meanwhile", W.locator(".scene").count() > 0 and pg.locator("#leftHost").is_hidden())
    E("scenesWin.document.querySelector('.spos button[data-place=bottom]').click()"); time.sleep(0.6)
    check("Bottom from the window: it closes, the scenes at the bottom, the left panel's tab row gone", E("!scenesWinOpen()") and E("ui.places.scenes") == "bottom" and pg.locator("#leftTabs").is_hidden())
    for k in ["cues", "timeline"]: E(f"setPanelPlace('{k}', 'bottom')")
    time.sleep(0.3)
    check("all back: the bottom panel's four tabs, the right panel its own three", E("[...$$('#dockTabs button[data-tab]')].filter(b => !b.hidden).length") == 4 and [t.rstrip("*") for t in rtabs()] == ["Inspector", "Content", "Settings"], (rtabs(), E("[...document.querySelectorAll('#dockTabs button[data-tab]')].filter(b => !b.hidden).map(b => b.dataset.tab)")))
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
