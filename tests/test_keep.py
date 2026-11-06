# Keep changes (the Scenes panel's Keep button): off by default, a change to a zone's layers while it plays a scene stays
# a change (the "edited" badge, ⋯ → Update); on, the scene playing takes it as it is made (a colour, a speed, from the
# Content tab's values or MIDI onto an effect's control), so recalling the scene brings it back as it was left; one step
# of undo for both; not while the zone fades in; the setting kept in files and undo.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8252
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

def layer(color, speed=0.5):
    return {"id": "l1", "src": "b-solid", "params": {"b-solid": {"color": color + [1], "speed": speed}}, "opacity": 1, "blend": "alpha", "on": True}
P = {"name": "K", "settings": {"compW": 400, "compH": 200, "transition": 0, "fps": 30},
     "fixtures": [{"id": "a", "type": "line", "name": "a", "order": "RGB", "x1": 20, "y1": 50, "x2": 380, "y2": 50, "pixels": 10}],
     "controllers": [],
     "zones": [{"id": "z1", "name": "Zone 1", "x": 0, "y": 0, "w": 400, "h": 200, "opacity": 1, "layers": [layer([1, 0, 0])],
                "scenes": [{"id": "s1", "name": "Red", "fade": 0, "layers": [layer([1, 0, 0])]},
                           {"id": "s2", "name": "Blue", "fade": 0, "layers": [layer([0, 0, 1])]}], "scene": "s1"}]}

bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = br.new_page(viewport={"width": 1500, "height": 1000})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    E = pg.evaluate
    E("p => { olm.loadProject(p); ui.dockTab = 'scenes'; ui.dockCollapsed = false; renderDock(); }", P); time.sleep(0.8)
    Z = "olm.project.zones[0]"
    sceneColor = lambda sid: E(f"{Z}.scenes.find(s => s.id === '{sid}').layers[0].params['b-solid'].color")
    # a change as the Content tab makes it: the layer's value, then a soft commit
    change = lambda color: E(f"c => {{ {Z}.layers[0].params['b-solid'].color = c; commitSoft(); refreshScenes(); }}", color + [1])
    btn = pg.locator(".sfoot .keepbtn")

    # ---------- off, as before
    check("Keep is in the Scenes panel, off by default", btn.count() == 1 and "on" not in (btn.get_attribute("class") or "") and E("olm.project.settings.sceneKeep") is False)
    change([0, 1, 0]); time.sleep(0.6)
    check("off: a change while Red plays leaves Red as it was", sceneColor("s1") == [1, 0, 0, 1], sceneColor("s1"))
    check("…and Red shows it was edited", pg.locator(".scene[data-id='s1'] .badge", has_text="edited").count() == 1)
    E(f"goScene({Z}, {Z}.scenes[1]); goScene({Z}, {Z}.scenes[0])"); time.sleep(0.4)
    check("…so recalling Red brings back its own colour", E(f"{Z}.layers[0].params['b-solid'].color") == [1, 0, 0, 1])

    # ---------- on
    btn.click(); time.sleep(0.4)
    check("Keep turns on from its button", E("olm.project.settings.sceneKeep") is True and "on" in (pg.locator(".sfoot .keepbtn").get_attribute("class") or ""))
    change([0, 1, 0]); time.sleep(0.6)
    check("on: a colour changed while Red plays goes into Red", sceneColor("s1") == [0, 1, 0, 1], sceneColor("s1"))
    check("…with no edited badge", pg.locator(".scene[data-id='s1'] .badge", has_text="edited").count() == 0)
    check("…and Blue, not playing, stays as it was", sceneColor("s2") == [0, 0, 1, 1])
    E(f"goScene({Z}, {Z}.scenes[1])"); time.sleep(0.3)
    E(f"{Z}.layers[0].params['b-solid'].speed = 0.9; commitSoft()"); time.sleep(0.6)
    E(f"goScene({Z}, {Z}.scenes[0])"); time.sleep(0.3)
    check("recalling Red brings it back as it was left (green)", E(f"{Z}.layers[0].params['b-solid'].color") == [0, 1, 0, 1])
    E(f"goScene({Z}, {Z}.scenes[1])"); time.sleep(0.3)
    check("and Blue keeps its new speed", E(f"{Z}.layers[0].params['b-solid'].speed") == 0.9, E(f"{Z}.layers[0].params['b-solid'].speed"))

    # MIDI onto an effect's control (setEffectControl): the scene playing takes it too
    E("setEffectControl(srcById('b-solid'), 'speed', 0.25)"); time.sleep(0.7)
    check("a MIDI control on an effect goes into the scene playing too", E(f"{Z}.scenes[1].layers[0].params['b-solid'].speed") == 0.25, E(f"{Z}.scenes[1].layers[0].params['b-solid'].speed"))

    # undo: the scene and the zone go back together
    E("undo()"); time.sleep(0.3)
    check("undo takes back the change from the zone and the scene together", E(f"{Z}.layers[0].params['b-solid'].speed") == 0.9 and E(f"{Z}.scenes[1].layers[0].params['b-solid'].speed") == 0.9)

    # not while the zone fades in: the scene isn't written with a half-way look
    E(f"(() => {{ const z = {Z}; z.scenes[0].fade = 5; goScene(z, z.scenes[0]); z.layers[0].params['b-solid'].color = [1, 1, 0, 1]; commit(); }})()"); time.sleep(0.3)
    check("not while its zone fades to it", sceneColor("s1") == [0, 1, 0, 1], sceneColor("s1"))
    E(f"(() => {{ {Z}._fade = null; {Z}.scenes[0].fade = 0; }})()")

    # ---------- files and off again
    check("the setting is kept in the project", E("JSON.parse(serialize()).settings.sceneKeep") is True)
    check("a file without it opens with Keep off", E("p => hydrate(p).settings.sceneKeep", P) is False)
    pg.locator(".sfoot .keepbtn").click(); time.sleep(0.4)
    change([1, 1, 1]); time.sleep(0.6)
    check("off again: changes stay changes", sceneColor("s1") != [1, 1, 1, 1] and E("olm.project.settings.sceneKeep") is False)
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
