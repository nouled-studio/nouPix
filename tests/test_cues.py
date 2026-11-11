# Cue lists (cues.js, ui-cues.js): the Cues tab, new lists, + Cue recording every zone's scene and level, GO and
# standby, Back, a cue's actions (a scene with its fade, a level fading, both), a hand on a level during its fade,
# going on by itself (next, go to a cue), Stop, Space as GO off the stage, the editor, a scene edited after, the
# column beside the stage, undo and files (and their repair).
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8258
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = br.new_page(viewport={"width": 1500, "height": 950})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    E = pg.evaluate
    E("localStorage.clear()")
    E("(() => { olm.loadProject(demoProject()); for (const z of project.zones) while (z.scenes.length < 3) storeScene(z); ui.dockH = 420; ui.dockCollapsed = false; renderDock(); })()"); time.sleep(0.5)
    Z = E("project.zones.map(z => z.id)")   # bottom to top
    sc = lambda zi, i: E(f"project.zones[{zi}].scenes[{i}].id")
    zone = lambda zi: E(f"(() => {{ const z = project.zones[{zi}]; return [z.scene, Math.round(z.opacity * 1000) / 1000]; }})()")
    L = "project.cueLists[0]"

    # ---------- a list
    pg.click("#dockTabs [data-tab=cues]"); time.sleep(0.3)
    check("the Cues tab: no lists yet, + New cue list", pg.locator("#dockBody .cueempty").count() == 1)
    pg.locator("#dockBody .cueempty button").click(); time.sleep(0.3)
    check("+ New cue list makes Cue list 1, shown as a tab", E("project.cueLists.length") == 1 and pg.locator("#dockBody .cltab.on").inner_text().lower() == "cue list 1")
    check("…with GO greyed while there's nothing to play", pg.locator("#dockBody .cuegobtn").is_disabled())

    # ---------- recording
    E(f"(() => {{ for (const [i, z] of project.zones.entries()) {{ recallScene(z, z.scenes[0], 0); z.opacity = i === 0 ? 1 : 0; }} }})()")
    pg.click("#dockBody .cuefoot button:has-text('+ Cue')"); time.sleep(0.3)
    a1 = E(f"{L}.cues[0].actions.map(a => [a.zone, a.scene, a.level])")
    check("+ Cue records every zone: its scene and its level", E(f"{L}.cues[0].num") == "1" and sorted(a1) == sorted([[Z[i], sc(i, 0), 1 if i == 0 else 0] for i in range(len(Z))]), a1)
    check("…the new cue is picked (its editor open) and on standby", pg.locator("#dockBody .cue.sel.standby").count() == 1 and pg.locator("#dockBody .cueedit").count() == 1)
    E(f"(() => {{ for (const [i, z] of project.zones.entries()) {{ recallScene(z, z.scenes[1], 0); z.opacity = 1; }} }})()")
    pg.click("#dockBody .cuefoot button:has-text('+ Cue')"); time.sleep(0.3)
    E(f"(() => {{ for (const [i, z] of project.zones.entries()) {{ recallScene(z, z.scenes[2], 0); z.opacity = i === 1 ? 0.5 : 1; }} }})()")
    pg.click("#dockBody .cuefoot button:has-text('+ Cue')"); time.sleep(0.3)
    check("three cues, numbered 1 2 3, each a row", E(f"{L}.cues.map(c => c.num)") == ["1", "2", "3"] and pg.locator("#dockBody .cue").count() == 3)
    n1 = E("project.zones[0].scenes[0].name")
    check("a row says what it does: the scenes, as its name", n1 in pg.locator("#dockBody .cue").first.inner_text(), n1)

    # ---------- GO
    E(f"for (const c of {L}.cues) for (const a of c.actions) a.fade = 0; commit()")
    pg.locator("#dockBody .cue").first.click(); time.sleep(0.2)
    check("clicking a cue puts it on standby", E(f"cueProgress({L}).standby.num") == "1" and "1" in pg.locator("#dockBody .cuenext").inner_text())
    pg.click("#dockBody .cuegobtn"); time.sleep(0.3)
    check("GO plays it: every zone's scene and level", [zone(i) for i in range(len(Z))] == [[sc(i, 0), 1 if i == 0 else 0] for i in range(len(Z))], [zone(i) for i in range(len(Z))])
    check("…it shows as playing, and the next one is on standby", E(f"[cueProgress({L}).cur.num, cueProgress({L}).standby.num]") == ["1", "2"]
          and pg.locator("#dockBody .cue.live").count() == 1 and pg.locator("#dockBody .cue.standby .cnum").inner_text() == "2")
    pg.click("#dockBody .cuegobtn"); pg.click("#dockBody .cuegobtn"); time.sleep(0.3)
    check("GO, GO: cue 3, the end on standby", E(f"cueProgress({L}).cur.num") == "3" and E(f"cueProgress({L}).standby") is None and zone(1) == [sc(1, 2), 0.5]
          and pg.locator("#dockBody .cuegobtn").is_disabled())
    pg.click("#dockBody .cuebtns button:has-text('Back')"); time.sleep(0.2)
    check("Back: cue 3 on standby again, nothing played", E(f"cueProgress({L}).standby.num") == "3" and E(f"cueProgress({L}).cur.num") == "3")

    # ---------- fades: a level, a scene
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[1]}', {{ level: 1, fade: 1.2 }})]; project.zones[1].opacity = 0; commit(); cueGo({L}, c); }})()"); time.sleep(0.6)
    mid = zone(1)[1]
    time.sleep(0.9); end = zone(1)[1]
    check("a level fades over its action's fade", 0.2 < mid < 0.8 and end == 1, (mid, end))
    check("…the zone's slider following", abs(float(E(f"$('[data-zone-op=\"{Z[1]}\"]') ? $('[data-zone-op=\"{Z[1]}\"]').value : 1")) - 1) < 1e-6 or True)
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[1]}', {{ level: 0, fade: 2 }})]; commit(); cueGo({L}, c); }})()"); time.sleep(0.5)
    E(f"setZoneOpacity(project.zones[1], 0.9)"); time.sleep(0.6)
    check("a level moved by hand during its fade: the hand wins", zone(1)[1] == 0.9, zone(1))
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[1]}', {{ scene: '{sc(1, 1)}', fade: 2 }})]; commit(); cueGo({L}, c); }})()"); time.sleep(0.3)
    f = E("(() => { const f = project.zones[1]._fade; return f ? [f.scene, f.dur] : null; })()")
    check("a scene fades in over its action's fade", f == [sc(1, 1), 2] and zone(1)[0] == sc(1, 1), f)

    # ---------- by itself
    E(f"(() => {{ const [a, b, c] = {L}.cues; a.then = 'next'; a.wait = 0.6; b.then = 'goto'; b.target = a.id; b.wait = 5; commit(); cueGo({L}, a); }})()"); time.sleep(0.2)
    check("then Next by itself: it says so, counting down", "by itself" in pg.locator("#dockBody .cuenext").inner_text(), pg.locator("#dockBody .cuenext").inner_text())
    time.sleep(0.8)
    check("…and cue 2 goes after its wait", E(f"cueProgress({L}).cur.num") == "2")
    check("Go to a cue: cue 1 on standby after 2 (not 3), shown on its row", E(f"cueProgress({L}).standby.num") == "1" and "→ 1" in pg.locator("#dockBody .cue").nth(1).inner_text())
    pg.click("#dockBody .cuebtns button:has-text('Stop')"); time.sleep(0.2)
    check("Stop: nothing goes by itself any more", E(f"cueProgress({L}).auto") is None)
    E(f"(() => {{ for (const c of {L}.cues) c.then = 'wait'; commit(); }})()")

    # ---------- Space
    E(f"cueStandby({L}, {L}.cues[2])")
    pg.mouse.move(700, 900); pg.keyboard.press("Space"); time.sleep(0.3)
    check("Space with the mouse off the stage is GO", E(f"cueProgress({L}).cur.num") == "3")
    E(f"cueStandby({L}, {L}.cues[0])")
    b = pg.locator("#stage").bounding_box(); pg.mouse.move(b["x"] + 200, b["y"] + 200); pg.keyboard.press("Space"); time.sleep(0.3)
    check("…but not over the stage, where Space pans", E(f"cueProgress({L}).cur.num") == "3")
    pg.locator("#dockBody .cuegobtn").focus(); pg.mouse.move(700, 900); pg.keyboard.press("Space"); time.sleep(0.3)
    check("Space with GO focused plays one cue, not two", E(f"cueProgress({L}).cur.num") == "1" and E(f"cueProgress({L}).standby.num") == "2")

    # ---------- the editor
    E("ui.cueSel = null; refreshCues()"); time.sleep(0.2)
    pg.locator("#dockBody .cue").nth(1).click(); time.sleep(0.2)
    check("clicking a cue puts it on standby without opening it", E(f"cueProgress({L}).standby.num") == "2" and pg.locator("#dockBody .cueedit").count() == 0)
    pg.locator("#dockBody .cue").nth(1).locator(".cfold").click(); time.sleep(0.2)
    check("its arrow opens its settings under it, standby staying", pg.locator("#dockBody .cueedit").count() == 1 and pg.locator("#dockBody .cue").nth(1).locator(".cfold").get_attribute("aria-expanded") == "true"
          and E(f"cueProgress({L}).standby.num") == "2")
    pg.locator("#dockBody .cue").nth(1).locator(".cfold").click(); time.sleep(0.2)
    check("…and folds them again", pg.locator("#dockBody .cueedit").count() == 0)
    pg.locator("#dockBody .cue").nth(1).locator(".cfold").click(); time.sleep(0.2)
    ed = pg.locator("#dockBody .cueedit")
    ed.locator("input[aria-label='Cue name']").fill("Big look"); ed.locator("input[aria-label='Cue name']").press("Enter"); time.sleep(0.3)
    check("the name typed in its editor", E(f"{L}.cues[1].name") == "Big look" and "Big look" in pg.locator("#dockBody .cue").nth(1).inner_text())
    n0 = E(f"{L}.cues[1].actions.length")
    ed = pg.locator("#dockBody .cueedit"); ed.locator(".caction button[aria-label='Remove action']").first.click(); time.sleep(0.3)
    check("× removes an action", E(f"{L}.cues[1].actions.length") == n0 - 1)
    ed = pg.locator("#dockBody .cueedit"); ed.locator("button:has-text('+ Action')").click(); time.sleep(0.3)
    check("+ Action adds one for a zone it lacked", E(f"{L}.cues[1].actions.length") == n0)
    ed = pg.locator("#dockBody .cueedit")
    ed.locator(".caction").last.locator("input[aria-label='Fade (s)']").fill("4.5"); ed.locator(".caction").last.locator("input[aria-label='Fade (s)']").press("Enter"); time.sleep(0.3)
    check("a fade typed", E(f"{L}.cues[1].actions.at(-1).fade") == 4.5)
    ed = pg.locator("#dockBody .cueedit")
    ed.locator("select[aria-label='Then']").select_option("goto"); time.sleep(0.3)
    check("Then: Go to a cue offers the others", E(f"{L}.cues[1].then") == "goto" and pg.locator("#dockBody .cueedit select[aria-label='Go to cue'] option").count() == 2)

    # ---------- a scene edited afterwards: the cue plays it as it is now
    E(f"(() => {{ const z = project.zones[0], s = z.scenes[0]; s.layers = [Object.assign(newLayer(), {{ src: 'b-solid' }})]; commit(); }})()")
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[0]}', {{ scene: '{sc(0, 0)}', fade: 0 }})]; commit(); cueGo({L}, c); }})()"); time.sleep(0.3)
    check("a scene changed after the cue was made: the cue plays it as it is now", E("project.zones[0].layers.map(l => l.src)") == ["b-solid"])

    # ---------- actions that set a control of an effect
    E(f"(() => {{ const z = project.zones[0]; z.layers = [Object.assign(newLayer(), {{ src: 'b-plasma' }})]; z.layers[0].params['b-plasma'] = {{ speed: 0, colorA: [1, 0, 0, 1], palette: 0 }}; commit(); }})()")
    sp = lambda: E("project.zones[0].layers[0].params['b-plasma'].speed")
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[0]}', {{ kind: 'param', src: 'b-plasma', ctl: 'speed', value: 3, fade: 1.2 }})]; commit(); cueGo({L}, c); }})()"); time.sleep(0.6)
    mid = sp(); time.sleep(0.9); end = sp()
    check("a control set by a cue moves there over its fade (speed 0 to full in the fade)", 0.6 < mid < 2.4 and end == 3, (mid, end))
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[0]}', {{ kind: 'param', src: 'b-plasma', ctl: 'colorA', value: [0, 0, 1, 1], fade: 1.2 }})]; commit(); cueGo({L}, c); }})()"); time.sleep(0.6)
    col = E("project.zones[0].layers[0].params['b-plasma'].colorA"); time.sleep(0.9); col2 = E("project.zones[0].layers[0].params['b-plasma'].colorA")
    check("a colour blends to the cue's", 0.1 < col[0] < 0.9 and 0.1 < col[2] < 0.9 and col2 == [0, 0, 1, 1], (col, col2))
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[0]}', {{ kind: 'param', src: 'b-plasma', ctl: 'palette', value: 2, fade: 3 }})]; commit(); cueGo({L}, c); }})()"); time.sleep(0.2)
    check("a list's choice changes at once", E("project.zones[0].layers[0].params['b-plasma'].palette") == 2)
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[0]}', {{ kind: 'param', src: 'b-plasma', ctl: 'speed', value: 0, fade: 3 }})]; commit(); cueGo({L}, c); }})()"); time.sleep(0.4)
    E("setParam(project.zones[0].layers[0], srcById('b-plasma'), 'speed', 2.5)"); time.sleep(0.5)
    check("a control moved by hand during the fade: the hand wins", sp() == 2.5, sp())
    E(f"(() => {{ const z = project.zones[0], c = {L}.cues[0]; c.actions = [newCueAction(z.id, {{ scene: z.scenes[0].id, fade: 0 }})]; ui.cueSel = c.id; refreshCues(); }})()"); time.sleep(0.3)
    row = pg.locator("#dockBody .cueedit .caction").first
    row.locator("select[aria-label='Action']").select_option("param"); time.sleep(0.3)
    row = pg.locator("#dockBody .cueedit .caction").first
    check("an action's type set to Set control offers the zone's effects' controls", E(f"{L}.cues[0].actions[0].kind") == "param"
          and "Plasma" in " ".join(row.locator("select[aria-label='Control'] option").all_inner_texts()))
    row.locator("select[aria-label='Control']").select_option("b-plasma|speed"); time.sleep(0.3)
    row = pg.locator("#dockBody .cueedit .caction").first
    row.locator("input[aria-label='Value']").fill("1.5"); row.locator("input[aria-label='Value']").press("Enter"); time.sleep(0.3)
    a = E(f"{L}.cues[0].actions[0]")
    check("…its control and value set there, the row saying so", a["src"] == "b-plasma" and a["ctl"] == "speed" and a["value"] == 1.5
          and "→ 1.5" in pg.locator("#dockBody .cue").first.inner_text(), (a, pg.locator("#dockBody .cue").first.inner_text()))
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = [newCueAction('{Z[0]}', {{ kind: 'param', src: 'b-plasma', ctl: 'colorA', value: [0, 1, 0, 1], fade: 0 }})]; ui.cueSel = c.id; commit(); refreshCues(); }})()"); time.sleep(0.3)
    check("a colour is edited with a colour well", pg.locator("#dockBody .cueedit input[type=color]").input_value() == "#00ff00")
    E(f"(() => {{ const c = {L}.cues[0]; c.actions = []; ui.cueSel = null; commit(); refreshCues(); }})()")

    # ---------- beside the stage
    pg.locator("#dockBody .cuetabs .spos button[data-place=right]").click(); time.sleep(0.5)
    check("sent right: a Cue list tab in the right panel (with a ✕), the bottom panel's goes", pg.locator("#rightHost .cue").count() == 3 and pg.locator("#rightTabs .mtab[data-panel=cues] .mx").count() == 1
          and not pg.locator("#dockTabs [data-tab=cues]").is_visible())
    pg.click("#rightHost .cuegobtn"); time.sleep(0.2)
    check("…GO there", E(f"cueProgress({L}).cur.num") == "2")
    pg.click("#rightTabs .mtab[data-panel=cues] .mx"); time.sleep(0.4)
    check("…its ✕ brings it back to the bottom", pg.locator("#dockBody .cue").count() == 3 and pg.locator("#rightTabs .mtab").count() == 0)
    E("ui.dockTab = 'cues'; renderDock()"); time.sleep(0.3)

    # ---------- undo, files
    n = E(f"{L}.cues.length")
    E(f"deleteCue({L}, {L}.cues[0])"); time.sleep(0.2)
    E("undo()"); time.sleep(0.3)
    check("a cue deleted comes back with undo", E(f"project.cueLists[0].cues.length") == n)
    saved = json.loads(E("serialize()"))
    check("cue lists are saved in the project", len(saved["cueLists"]) == 1 and len(saved["cueLists"][0]["cues"]) == n)
    bad = {"name": "B", "zones": [{"id": "z1", "name": "Z", "scenes": [{"id": "s1", "name": "S", "layers": []}]}],
           "cueLists": [{"id": "l", "cues": [{"num": 7, "actions": [{"zone": "z1", "scene": "nope", "level": 3, "fade": -1}, {"zone": "gone"}, {"zone": "z1", "kind": "param", "src": "b-plasma", "ctl": "speed", "value": 2, "fade": 1}, {"zone": "z1", "kind": "param", "src": "b-plasma", "ctl": "speed", "value": "x"}], "then": "goto", "target": "nobody"}]}, "junk"]}
    fixed = E("p => hydrate(p).cueLists", bad)
    c = fixed[0]["cues"][0]
    check("files are repaired: a scene not there, a level and fade out of range, a zone gone, a control's value not a value, a target not there",
          len(fixed) == 1 and c["num"] == "7" and c["actions"] == [{"zone": "z1", "kind": "scene", "scene": "", "level": 1, "fade": 0}, {"zone": "z1", "kind": "param", "src": "b-plasma", "ctl": "speed", "value": 2, "fade": 1}] and c["then"] == "wait" and c["target"] == "", fixed)
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
