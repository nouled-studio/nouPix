# Changes kept in the scene playing: what is changed in a zone's layers with the same contents (a colour, a speed, a
# layer's opacity, from the Content tab's values or MIDI onto an effect's control) goes into the scene it plays, so
# recalling it brings it back as it was left; one step of undo for both; not while the zone fades in. Other contents
# (a source swapped, a layer added) don't: the scene shows an "edited" button that saves them, and recalled without
# saving it comes back as it was stored. Files with 1.5.2's Keep setting open without it.
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
P = {"name": "K", "settings": {"compW": 400, "compH": 200, "transition": 0, "fps": 30, "sceneKeep": True},
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
    scene = lambda sid: E(f"{Z}.scenes.find(s => s.id === '{sid}').layers")
    # a change as the Content tab makes it: the layer's value, a soft commit, the scenes redrawn
    change = lambda color: E(f"c => {{ {Z}.layers[0].params['b-solid'].color = c; commitSoft(); refreshScenes(); }}", color + [1])
    edited = lambda sid: pg.locator(f".scene[data-id='{sid}'] .edited")

    check("no Keep button: it is always so", pg.locator(".sfoot .keepbtn").count() == 0)
    check("a file from 1.5.2 with Keep opens without the setting", "sceneKeep" not in E("olm.project.settings"))

    # ---------- the same contents: kept
    change([0, 1, 0]); time.sleep(0.6)
    check("a colour changed while Red plays goes into Red", scene("s1")[0]["params"]["b-solid"]["color"] == [0, 1, 0, 1])
    check("…with no edited button", edited("s1").count() == 0)
    check("…and Blue, not playing, stays as it was", scene("s2")[0]["params"]["b-solid"]["color"] == [0, 0, 1, 1])
    E(f"goScene({Z}, {Z}.scenes[1])"); time.sleep(0.3)
    # (commit, not the delayed commitSoft: under load two delayed saves could land as one step of undo)
    E(f"{Z}.layers[0].opacity = 0.4; {Z}.layers[0].params['b-solid'].speed = 0.9; commit()"); time.sleep(0.3)
    E(f"goScene({Z}, {Z}.scenes[0])"); time.sleep(0.3)
    check("recalling Red brings it back as it was left (green)", E(f"{Z}.layers[0].params['b-solid'].color") == [0, 1, 0, 1])
    E(f"goScene({Z}, {Z}.scenes[1])"); time.sleep(0.3)
    check("and Blue keeps its new speed and its layer's opacity", E(f"[{Z}.layers[0].params['b-solid'].speed, {Z}.layers[0].opacity]") == [0.9, 0.4])
    # the scene just recalled saves its step a moment later too: take it now, so the MIDI move is a step of its own
    E("pushHistory()"); h0 = E("hist.idx")
    E("setEffectControl(srcById('b-solid'), 'speed', 0.25)")
    # its step of undo comes a moment later (commitSoft): wait for it rather than a fixed time
    try: pg.wait_for_function(f"hist.idx > {h0}", timeout=5000)
    except Exception: pass
    check("a MIDI control on an effect goes into the scene playing too", scene("s2")[0]["params"]["b-solid"]["speed"] == 0.25)
    E("undo()"); time.sleep(0.3)
    check("undo takes it back from the zone and the scene together", E(f"{Z}.layers[0].params['b-solid'].speed") == 0.9 and scene("s2")[0]["params"]["b-solid"]["speed"] == 0.9)

    # ---------- other contents: an edited button, not kept unless saved
    E(f"(() => {{ const L = {Z}.layers[0]; L.src = 'b-rainbow'; commit(); refreshScenes(); }})()"); time.sleep(0.5)
    check("a source swapped in Blue's layer doesn't go into Blue", scene("s2")[0]["src"] == "b-solid")
    check("…Blue shows an edited button instead", edited("s2").count() == 1 and edited("s2").evaluate("e => e.tagName") == "BUTTON")
    E(f"(() => {{ {Z}.layers[0].opacity = 0.7; commit(); }})()"); time.sleep(0.3)
    check("…and nothing more goes in while the contents differ", scene("s2")[0]["opacity"] == 0.4)
    E(f"goScene({Z}, {Z}.scenes[0]); goScene({Z}, {Z}.scenes[1])"); time.sleep(0.4)
    check("recalled without saving, Blue comes back as it was stored", E(f"{Z}.layers[0].src") == "b-solid" and E(f"{Z}.layers[0].opacity") == 0.4)
    E(f"(() => {{ const z = {Z}; z.layers.push(Object.assign(newLayer(), {{ src: 'b-rainbow' }})); commit(); refreshScenes(); }})()"); time.sleep(0.5)
    check("a layer added shows the edited button too", edited("s2").count() == 1 and len(scene("s2")) == 1)
    edited("s2").click(); time.sleep(0.3)
    asked = pg.locator(".modal:has-text('Overwrite')").count() == 1 and len(scene("s2")) == 1
    pg.locator(".modal button:has-text('Overwrite')").click(); time.sleep(0.4)
    check("clicking the pencil asks first, nothing changed until Overwrite", asked)
    check("clicking edited saves the zone's contents into the scene", len(scene("s2")) == 2 and scene("s2")[1]["src"] == "b-rainbow" and edited("s2").count() == 0)
    check("…without recalling anything else", E(f"{Z}.scene") == "s2")

    # ---------- not while the zone fades in
    E(f"(() => {{ const z = {Z}; z.scenes[0].fade = 5; goScene(z, z.scenes[0]); z.layers[0].params['b-solid'].color = [1, 1, 0, 1]; commit(); }})()"); time.sleep(0.3)
    check("not while its zone fades to it", scene("s1")[0]["params"]["b-solid"]["color"] == [0, 1, 0, 1])
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
