# The Scenes window (ui-dock.js): the scenes and playlists in a window of their own, which this page draws into.
# Opening it from the Scenes tab (which then says where they are); scenes fired there, keeping its scroll; the zone
# levels both ways; the ⋯ menu, the scene dialog and messages in that window; keys 1–9, B, undo; playlists playing
# there; MIDI learnt from it and its tags; closing it (its button, the tab's button, the window itself); it closes
# with the page.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, FAKE_MIDI
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8190
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); ctx = br.new_context(viewport={"width": 1280, "height": 860})
    ctx.add_init_script(FAKE_MIDI)
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    ev = pg.evaluate
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.4)
    def settle(t=0.3): time.sleep(t)
    ev("(() => { olm.loadProject(demoProject()); for (const z of project.zones) { while (z.scenes.length < 12) storeScene(z); } ui.dockTab = 'scenes'; ui.dockCollapsed = false; renderDock(); })()"); settle(0.6)
    Z = ev("project.zones.at(-1).id")   # the top zone: the first row

    # ---------- opening it
    with pg.expect_popup() as pi: pg.click("#dockBody button[aria-label='Open in a window']")
    W = pi.value; W.on("pageerror", lambda e: errs.append("Scenes window: " + str(e))); W.set_viewport_size({"width": 1180, "height": 460}); settle(0.8)
    check("Open in a window: the scenes in a window of their own", W.title() == "Scenes · nouPix" and W.locator(".scenerow").count() == 3 and W.locator(".scene").count() == 36)
    check("with the app's look", W.evaluate("getComputedStyle(document.body).backgroundColor") == ev("getComputedStyle(document.body).backgroundColor"))
    check("the bottom panel's Scenes tab says where they are", "in their own window" in pg.inner_text("#dockBody") and pg.locator("#dockBody .scene").count() == 0)
    n0 = len(ctx.pages); pg.click("#dockBody button:has-text('Show the window')"); settle(0.4)
    check("Show the window brings it forward: the same one, no second", len(ctx.pages) == n0 and not W.is_closed())

    # ---------- playing from it
    row = W.locator(".zoneblock").first
    row.locator(".harrow.r").click(); settle(0.8)
    left = row.locator(".stiles").evaluate("e => Math.round(e.scrollLeft)")
    tiles = row.locator(".scene"); box = row.locator(".stiles").bounding_box()
    i = next(i for i in range(tiles.count()) if (lambda b: b["x"] > box["x"] + 40 and b["x"] + b["width"] < box["x"] + box["width"] - 40)(tiles.nth(i).bounding_box()))
    tiles.nth(i).click(); settle(0.5)
    check("a scene clicked there plays", ev(f"(() => {{ const z = zoneById('{Z}'); return z.scene === z.scenes[{i}].id; }})()") and row.locator(".scene.live").count() == 1)
    check("and the row stays where it was scrolled", row.locator(".stiles").evaluate("e => Math.round(e.scrollLeft)") == left and left > 0, left)
    ev(f"goScene(zoneById('{Z}'), zoneById('{Z}').scenes[0], true)"); settle(0.4)
    check("a scene played from elsewhere shows there too", row.locator(".scene").first.evaluate("e => e.classList.contains('live')"))
    r = row.locator("input[data-zone-op]")
    r.evaluate("e => { e.value = 0.3; e.dispatchEvent(new Event('input', { bubbles: true })); }"); settle()
    check("its level slider moves the zone", abs(ev(f"zoneById('{Z}').opacity") - 0.3) < 1e-6)
    ev(f"setZoneOpacity(zoneById('{Z}'), 0.7)"); settle()
    check("and follows a level moved elsewhere (a fader, the Inspector)", abs(float(r.input_value()) - 0.7) < 1e-6 and "70" in row.locator("[data-zone-pct]").inner_text())

    # ---------- menus, dialogs, messages there
    tiles.nth(i).locator("button.x").click(); settle(0.3)
    check("⋯ opens its menu in that window", W.locator(".menu").count() == 1 and pg.locator(".menu").count() == 0)
    W.locator(".menu button", has_text="Rename").first.click(); settle(0.3)
    check("and its dialog too", W.locator(".modal").count() == 1 and pg.locator(".modal").count() == 0, W.locator(".menu button").all_inner_texts() if W.locator(".menu").count() else "")
    W.keyboard.press("Escape"); settle(0.2)
    check("Esc closes the dialog", W.locator(".modal").count() == 0)
    n = ev(f"zoneById('{Z}').scenes.length")
    row.locator("button:has-text('+ Store')").click(); settle(0.4)
    check("a message about what was done there shows there", W.locator(".toast").count() >= 1 and pg.locator(".toast").count() == 0 and ev(f"zoneById('{Z}').scenes.length") == n + 1)
    W.locator("body").click(position={"x": 600, "y": 440}); W.keyboard.press("Control+z"); settle(0.4)
    check("Ctrl Z undoes there (the scene just stored goes)", ev(f"zoneById('{Z}').scenes.length") == n)

    # ---------- keys
    ev(f"selectZone(zoneById('{Z}'))"); settle(0.3)
    W.locator("body").click(position={"x": 600, "y": 440}); W.keyboard.press("Digit3"); settle(0.4)
    check("key 3 there plays the selected zone's third scene", ev(f"(() => {{ const z = zoneById('{Z}'); return z.scene === z.scenes[2].id; }})()"))
    W.keyboard.press("b"); settle(0.2)
    check("B blacks out", ev("ui.blackout"))
    W.keyboard.press("b"); settle(0.2)
    W.keyboard.press("Delete"); settle(0.2)
    check("Delete doesn't delete the fixtures selected in the main window", ev("project.fixtures.length") > 0)

    # ---------- MIDI
    ev("sessionStorage.setItem('fakeMidi', JSON.stringify({ ports: ['K'] })); __midi.plug('K'); setMidiOn(true); midiSetLearn(true)"); settle(0.3)
    ev("__midi.send('K', [0x90, 50, 100]); __midi.send('K', [0x80, 50, 0])"); settle(0.2)
    row.locator(".scene").nth(4).click(); settle(0.4)
    sid = ev(f"zoneById('{Z}').scenes[4].id")
    check("learning, a scene clicked there takes the control (and doesn't play)", ev(f"project.midi.maps.some(w => w.to === 'sc:{Z}:{sid}')") and not ev(f"zoneById('{Z}').scene === '{sid}'"))
    check("it is outlined there while learning", W.evaluate("document.body.classList.contains('midi-learning')"))
    ev("midiSetLearn(false)"); settle(0.3)
    ev("__midi.send('K', [0x90, 50, 100]); __midi.send('K', [0x80, 50, 0])"); settle(0.4)
    check("the pad plays it", ev(f"zoneById('{Z}').scene === '{sid}'"))
    check("its tag is there", row.locator(".scene").nth(4).locator(".ftag").text_content() == "N50")

    # ---------- this page minimized: its frames stop, the Scenes window's draw the X-Fader's previews
    ev("setXfadeOn(true)"); settle(0.6)
    W.keyboard.press("Escape"); settle(0.2)   # (the advice to make A and B full size, if it showed there)
    ev("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); window._pv = 0; window._thumb = mixer.thumb; mixer.thumb = (z, c) => { if (c.ownerDocument !== document) window._pv++; return window._thumb(z, c); }; 0")
    settle(1.0)
    n = ev("window._pv")
    check("with this page minimized, the X-Fader's previews in the Scenes window keep moving", W.locator("canvas[data-xf-pv]").count() == 2 and n >= 20, n)
    ev("mixer.thumb = window._thumb; delete document.hidden; setXfadeOn(false)"); settle(0.4)

    # ---------- closing
    W.locator("button[aria-label='Back to the panel']").click(); settle(0.6)
    check("Back to the panel closes it, and the scenes are in the bottom panel again", W.is_closed() and pg.locator("#dockBody .scene").count() == 36)
    with pg.expect_popup() as pi: pg.click("#dockBody button[aria-label='Open in a window']")
    W = pi.value; settle(0.6)
    pg.click("#dockBody button:has-text('Back here')"); settle(0.6)
    check("Back here (in the tab) closes it too", W.is_closed() and pg.locator("#dockBody .scene").count() == 36)
    with pg.expect_popup() as pi: pg.click("#dockBody button[aria-label='Open in a window']")
    W = pi.value; settle(0.6)
    W.close(); settle(1.5)
    check("closing the window itself brings the scenes back to the panel", pg.locator("#dockBody .scene").count() == 36)
    with pg.expect_popup() as pi: pg.click("#dockBody button[aria-label='Open in a window']")
    W = pi.value; settle(0.6)
    pg.reload(); pg.wait_for_function("window.olm"); settle(0.6)
    check("it closes with the page", W.is_closed())

    check("no errors", not errs, errs[:5])
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
