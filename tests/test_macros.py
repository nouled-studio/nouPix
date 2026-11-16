# Macros (macros.js, ui-macros.js): what each effect control follows; Speed through the effects' clocks (also the
# ones a rate or bpm drives), Intensity, Saturation, Color 1 and 2, the shared controls; the layers' own values never
# change, scenes keep working, thumbnails keep their own look; saved in the project, repaired on opening, kept through
# an undo; the macros in the MIDI window (the colour parts in HSV or RGB, the shared controls folded, typed values) and
# the notes under an effect's controls; an effect's colour showing Color 1 while it follows it, and an open colour
# picker following a fader; MIDI learnt onto a macro (clicked, or chosen from the list of the control just moved) and
# onto a part of a colour; a device's change by its role.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8184
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 1100})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    ev = pg.evaluate
    def settle(t=0.3): time.sleep(t)
    def load(src, params=None):
        ev(f"""(() => {{ const p = blankProject('Macros'); p.fixtures.push(newFixture('line', {{ x1: 100, y1: 320, x2: 900, y2: 320, pixels: 8 }}));
          const L = newLayer('{src}'); {f"L.params['{src}'] = {params};" if params else ''} p.zones[0].layers = [L];
          for (const z of p.zones) {{ const sc = {{ id: uid(), name: 'Scene 1', fade: 0, layers: cloneLayers(z.layers) }}; z.scenes = [sc]; z.scene = sc.id; }}
          olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); ui.rightTab = 'content'; ui.zone = olm.project.zones[0].id; renderRight(); }})()"""); settle(0.5)
    col = lambda i=0: ev(f"Array.from(olm.project.fixtures[0]._col.slice({i * 3}, {i * 3 + 3}))")
    roles = lambda src: ev(f"(() => {{ const rt = runtimeOf(srcById('{src}')); return rt.roles; }})()")
    reset = lambda: ev("project.macros = defaultMacros(); updateMacrosUI()")

    # ---------- defaults and files
    load("b-solid", "{ color: [0, 0, 1, 1] }")
    check("a new project has every macro, none changing anything", ev("MACROS.every(d => !macroActive(d.id))") and ev("Object.keys(project.macros).length") == 13)
    check("so the effects look as they did", col() == [0, 0, 255], col())
    ev("loadProject(Object.assign(JSON.parse(serialize()), { macros: { speed: { v: 9 }, color1: { on: 1, h: 400, s: 'x', mode: 'cmyk' }, angle: 'no' } }))"); settle()
    m = ev("project.macros")
    check("a file's macros are repaired: in range, with defaults for the rest", m["speed"]["v"] == 2 and m["color1"]["on"] is True and m["color1"]["h"] == 40 and m["color1"]["s"] == 1
          and m["color1"]["mode"] == "hsv" and m["angle"] == {"on": False, "v": 0.5}, m)
    ev("loadProject(Object.assign(JSON.parse(serialize()), { macros: undefined }))"); settle()
    check("a file without macros opens with them neutral", ev("MACROS.every(d => !macroActive(d.id))"))

    # ---------- what follows what
    r = roles("b-bars")
    check("bars: its colour follows Color 1, its background Color 2, its speed Speed, and its shared controls theirs",
          r == {"color": "color1", "background": "color2", "count": "count", "width": "width", "softness": "softness", "speed": "speed", "angle": "angle"}, r)
    check("the rate or bpm a clock runs at follows Speed", roles("b-strobe").get("rate") == "speed" and roles("b-discodots").get("bpm") == "speed"
          and roles("b-checker").get("rate") == "speed" and roles("b-checker").get("scroll") == "speed", (roles("b-strobe"), roles("b-checker")))
    check("saturation and fade (decay) follow theirs", roles("b-rainbow").get("saturation") == "saturation" and roles("b-twinkle").get("decay") == "decay")
    ev("""(() => { const code = '/*{"INPUTS":[{"NAME":"tint","TYPE":"color","DEFAULT":[1,0,0,1]},{"NAME":"speed","TYPE":"float","MIN":0,"MAX":1,"DEFAULT":0.5}]}*/\\nvoid main(){gl_FragColor=vec4(1.0);}';
      project.sources.push({ id: 'mine', kind: 'isf', name: 'Mine', code }); })()""")
    check("an effect of your own follows by the same names; a speed it doesn't run by TIME doesn't follow Speed", roles("mine") == {"tint": "color1"}, roles("mine"))

    # ---------- on stored scenes only: content a zone plays from no scene keeps its own values
    ev("""(() => { const p = blankProject('Scenes'); p.fixtures.push(newFixture('line', { x1: 100, y1: 320, x2: 900, y2: 320, pixels: 8 }));
      const L = newLayer('b-solid'); L.params['b-solid'] = { color: [0, 0, 1, 1] }; p.zones[0].layers = [L];
      olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); ui.rightTab = 'content'; ui.zone = olm.project.zones[0].id; ui.layer = olm.project.zones[0].layers[0].id; renderRight(); })()"""); settle(0.5)
    ev("setMacro('color1', { h: 0, s: 1, v: 1 }); setMacro('intensity', { v: 0.5 })"); settle()
    check("content that is no scene yet shows its own colour and level: the macros leave it alone", col() == [0, 0, 255], col())
    check("…and its controls aren't marked as following them", pg.locator("#rightBody .lbl.mac").count() == 0)
    ev("storeScene(project.zones[0])"); settle()
    check("stored as a scene, it follows them", col() == [128, 0, 0], col())
    check("…and its colour is marked as following Color 1", pg.locator("#rightBody .lbl.mac", has_text="Color").count() == 1)
    ev("(() => { const z = project.zones[0]; z.layers.push(newLayer('b-bars')); commit(); })()"); settle()
    check("edited (a layer added), it is still the scene and follows them", col() == [128, 0, 0] or col()[2] == 0, col())
    ev("stopZone(project.zones[0])"); settle(0.3)
    ev("(() => { const z = project.zones[0]; z.layers = [Object.assign(newLayer('b-solid'), { params: { 'b-solid': { color: [0, 0, 1, 1] } } })]; z._fade = null; commit(); })()"); settle()
    check("stopped, new content put there is no scene: its own colour again", col() == [0, 0, 255], col())
    reset(); settle()

    # ---------- colours, intensity, saturation
    load("b-solid", "{ color: [0, 0, 1, 1] }")
    ev("setMacro('color1', { h: 0, s: 1, v: 1 })"); settle()
    check("Color 1 moved: it turns on, and every effect's colour is it", ev("project.macros.color1.on") and col() == [255, 0, 0], col())
    ev("setMacro('intensity', { v: 0.5 })"); settle()
    check("Intensity at 50 % halves every layer", col() == [128, 0, 0], col())
    ev("setMacro('intensity', { v: 0 })"); settle()
    check("at 0 it is dark", col() == [0, 0, 0])
    ev("setMacro('color1', { on: false }); setMacro('intensity', { v: 1 })"); settle()
    check("off again, each effect has its own colour back, which never changed", col() == [0, 0, 255] and ev("project.zones[0].layers[0].params['b-solid'].color") == [0, 0, 1, 1])
    load("b-bars", "{ color: [1, 1, 1, 1], background: [0, 0, 0, 1], count: 1, width: 0.05, softness: 0 }")
    ev("setMacro('color2', { h: 120, s: 1, v: 1 })"); settle()
    check("Color 2 is the background", sum(col(i) == [0, 255, 0] for i in range(8)) >= 5, [col(i) for i in range(8)])
    load("b-rainbow", "{ saturation: 1 }")
    ev("setMacro('saturation', { v: 0 })"); settle()
    c = col(2)
    check("Saturation at 0 makes a rainbow grey", max(c) - min(c) <= 2, c)
    reset(); settle()
    c = col(2)
    check("and back at 100 % it is coloured again", max(c) - min(c) > 100, c)

    # ---------- speed
    def rate(key):
        a = ev(f"[speedClocks.get({key}).tau, clockT]"); settle(0.6); b = ev(f"[speedClocks.get({key}).tau, clockT]")
        return (b[0] - a[0]) / (b[1] - a[1])
    key = "project.zones[0].layers[0].id + '|b-rainbow'"
    r1 = rate(key); ev("setMacro('speed', { v: 2 })"); r2 = rate(key)
    check("Speed at 2× runs an effect twice as fast", abs(r2 / r1 - 2) < 0.1, (r1, r2))
    ev("setMacro('speed', { v: 0 })"); a = col(3); settle(0.6); b = col(3)
    check("at 0 it stops, where it was", a == b and rate(key) == 0, (a, b))
    load("b-strobe")
    skey = "project.zones[0].layers[0].id + '|b-strobe|flash'"
    reset(); r1 = rate(skey); ev("setMacro('speed', { v: 0.5 })"); r2 = rate(skey)
    check("an effect with a rate clock (Strobe) follows it too", abs(r2 / r1 - 0.5) < 0.05, (r1, r2))
    reset()

    # ---------- shared controls
    inp = "isfInputs(srcById('b-bars')).find(i => i.NAME === 'angle')"
    check("a shared control on sets every effect's control to the same point of its range", ev(f"(() => {{ project.macros.angle = {{ on: true, v: 0.25 }}; return macroOver('angle', {inp}, 300); }})()") == 90)
    check("off, each keeps its own", ev(f"(() => {{ project.macros.angle.on = false; return macroOver('angle', {inp}, 300); }})()") == 300)
    reset()

    # ---------- scenes, thumbnails, undo, files
    load("b-solid", "{ color: [0, 0, 1, 1] }")
    ev("(() => { const z = project.zones[0]; storeScene(z); z.layers = [newLayer('b-solid')]; z.layers[0].params['b-solid'] = { color: [0, 1, 0, 1] }; storeScene(z); })()"); settle()
    ev("setMacro('color1', { h: 0, s: 1, v: 1 })"); ev("goScene(project.zones[0], project.zones[0].scenes[0], true)"); settle()
    check("a scene played keeps following the macro", col() == [255, 0, 0])
    ev("setMacro('color1', { on: false })"); settle()
    check("and has its own colour when it is off", col() == [0, 0, 255])
    ev("setMacro('color1', { on: true })"); ev("(() => { const s = srcById('b-solid'); drawThumb(s, true); })()")
    t = ev("Array.from(thumbs.get('b-solid').getContext('2d').getImageData(48, 48, 1, 1).data.slice(0, 3))")
    check("a source's thumbnail keeps its own look", t != [255, 0, 0], t)
    ev("setMacro('speed', { v: 1.5 })"); ev("project.name = 'Changed'; commit()"); ev("undo()"); settle()
    check("an undo leaves the macros where they are", ev("project.macros.speed.v") == 1.5 and ev("project.macros.color1.on"))
    saved = ev("JSON.parse(serialize()).macros")
    check("the macros are saved in the project file", saved["speed"]["v"] == 1.5 and saved["color1"]["on"] is True)
    ev("s => loadProject(JSON.parse(s))", ev("serialize()")); settle()
    check("and come back when it opens", ev("project.macros.speed.v") == 1.5 and ev("project.macros.color1.on"))
    reset(); settle()

    # ---------- the macros, in the MIDI window
    load("b-bars")
    check("the Content tab has no macros of its own", pg.locator("#rightBody .sec.macros, #rightBody .mmacros").count() == 0)
    ev("ui.midiVc = false; ui.macroOpen = []")
    with pg.expect_popup() as pi: pg.click("#btnMidi")
    W = pi.value; W.set_viewport_size({"width": 1180, "height": 760}); settle(0.6)
    sec = W.locator(".mports .mmacros")
    check("the MIDI window has them under the controllers: Speed, Intensity and Saturation first", W.locator(".mports h3.mmhead").inner_text().lower() == "macros"
          and [x.strip() for x in sec.locator(".row .lbl").all_inner_texts()][:3] == ["Speed", "Intensity", "Saturation"], sec.locator(".row .lbl").all_inner_texts())
    sl = sec.locator(".row", has=W.locator(".lbl", has_text="Speed")).locator("input[type=range]")
    sl.fill("1.5"); sl.dispatch_event("input"); settle()
    check("the Speed slider moves Speed", ev("project.macros.speed.v") == 1.5 and "1.50×" in sec.inner_text())
    v = sec.locator(".row", has=W.locator(".lbl", has_text="Intensity")).locator(".sval"); v.dblclick(); W.keyboard.type("40"); W.keyboard.press("Enter"); settle()
    check("a value can be typed (40 means 40 %)", abs(ev("project.macros.intensity.v") - 0.4) < 1e-9, ev("project.macros.intensity.v"))
    marks = lambda: ev("[...document.querySelectorAll('#rightBody .lbl.mac, #rightBody .lbl.own')].map(l => l.dataset.tip)")
    check("a control that follows a macro: its name marked, what it follows on pointing at it, no text in the panel",
          "Follows Speed (1.50×)" in marks() and "Follows" not in pg.inner_text("#rightBody"), marks())
    lbl = pg.locator("#rightBody .lbl.mac").first; lbl.hover(); time.sleep(0.6)
    check("…shown as a tip on pointing at it", pg.locator(".tip:not([hidden])").count() == 1 and "follows" in pg.locator(".tip").inner_text().lower(), pg.locator(".tip").all_inner_texts())
    pg.mouse.move(5, 5)
    reset(); settle()
    check("and isn't once it is back to neutral; the slider there follows", marks() == [] and "1.00×" in sec.inner_text(), marks())
    sec.locator(".mshared .mfold").click(); settle()
    sec = W.locator(".mports .mmacros")
    shared = sec.locator(".msub .row")
    check("the shared controls open, each off", shared.count() == 8 and all("off" in (shared.nth(i).get_attribute("class") or "") for i in range(8)))
    a = sec.locator(".row", has=W.locator(".mlbl", has_text="Angle"))
    s2 = a.locator("input[type=range]"); s2.fill("0.75"); s2.dispatch_event("input"); settle()
    check("moving one turns it on, and the effect's angle is marked as following it", ev("project.macros.angle.on") and "off" not in (a.get_attribute("class") or "") and "Follows Angle" in marks(), marks())
    a.locator("input[type=checkbox]").uncheck(); settle()
    check("its tick turns it off", not ev("project.macros.angle.on") and "Follows Angle" not in marks(), marks())
    c1 = sec.locator(".row.mcolor").first
    c1.locator(".mfold").click(); settle()
    sec = W.locator(".mports .mmacros"); c1 = sec.locator(".row.mcolor").first
    parts = sec.locator(".msub").first.locator(".row .lbl").all_inner_texts()
    check("Color 1 opens to its hue, saturation and value", parts[1:] == ["Hue", "Saturation", "Value"], parts)
    sec.locator(".msub").first.locator(".seg button", has_text="RGB").click(); settle()
    sec = W.locator(".mports .mmacros"); c1 = sec.locator(".row.mcolor").first
    parts = sec.locator(".msub").first.locator(".row .lbl").all_inner_texts()
    check("or red, green and blue, without switching it on", parts[1:] == ["Red", "Green", "Blue"] and ev("project.macros.color1.mode") == "rgb" and not ev("project.macros.color1.on"), parts)
    g = sec.locator(".msub").first.locator(".row", has=W.locator(".lbl", has_text="Green")).locator("input[type=range]")
    ev("setMacro('color1', { h: 0, s: 1, v: 1, on: false })"); settle(); g.fill("1"); g.dispatch_event("input"); settle()
    check("moving green makes it yellow, and on", [round(x * 255) for x in ev("macroRgb(project.macros.color1)")] == [255, 255, 0] and ev("project.macros.color1.on"))
    check("its swatch shows it", "#FFFF00" in c1.locator(".cswatch").inner_text(), c1.locator(".cswatch").inner_text())

    # ---------- an effect's colour while it follows Color 1
    fx = pg.locator("#rightBody .row", has=pg.locator(".lbl", has_text="Bar color")).locator(".cswatch")
    check("an effect's colour that follows Color 1 shows Color 1 while it is on", "#FFFF00" in fx.inner_text(), fx.inner_text())
    ev("setMacro('color1', { h: 120 })"); settle()
    check("and follows it when it moves", "#00FF00" in fx.inner_text(), fx.inner_text())
    fx.click(); settle()
    ev("ui.colorMode") == "hsv" or pg.locator(".cpop .seg button", has_text="HSV").click(); settle()
    hue = lambda: pg.locator(".cpop .cpslider", has=pg.locator(".cpl", has_text="Hue")).locator("input[type=number]").input_value()
    check("its picker opens on Color 1", hue() == "120", hue())
    ev("setMacro('color1', { h: 240 })"); settle()
    check("an open picker follows a macro moved from elsewhere (a fader)", hue() == "240" and pg.locator(".cpop input.mono").input_value() == "#0000FF", (hue(), pg.locator(".cpop input.mono").input_value()))
    check("its name is marked as following Color 1, the tip saying a colour picked here is this layer's alone",
          "Follows Color 1|A colour picked here is for this layer only." in marks(), marks())
    pg.locator(".cpop .cpchip").first.click(); settle()
    mine = ev("project.zones[0].layers[0].params['b-bars'].color")
    check("a colour chosen there is this layer's alone: Color 1 stays as it was, the layer keeps its own and no longer follows it",
          ev("project.macros.color1.h") == 240 and ev("project.macros.color1.on") and ev("project.zones[0].layers[0].own") == {"b-bars": ["color"]} and mine and mine[:3] != [0, 0, 1],
          (ev("project.macros.color1"), ev("project.zones[0].layers[0].own"), mine))
    ev("closeColorPicker()"); settle()
    hexOf = lambda c: "#%02X%02X%02X" % tuple(round(x * 255) for x in c[:3])
    check("its swatch shows its own colour while Color 1 stays on", hexOf(mine) in fx.inner_text(), (fx.inner_text(), mine))
    ev("undo()"); settle(); ev("renderRight()"); settle()
    check("one step of undo gives it back to Color 1", not ev("project.zones[0].layers[0].own") and "#0000FF" in fx.inner_text(), (ev("project.zones[0].layers[0].own"), fx.inner_text()))
    ev("redo()"); settle(); ev("renderRight()"); settle()
    own = pg.locator("#rightBody .lbl.own", has_text="Bar color")
    check("its name's line dashed, its tip saying so, and a link to follow Color 1 again", own.count() == 1 and "until Color 1 moves" in (own.get_attribute("data-tip") or "")
          and own.locator("button.relink:visible").get_attribute("aria-label") == "Follow Color 1 again", marks())
    ev("setMacro('color1', { on: false })"); settle()
    ev("setMacro('color1', { on: true })"); settle()
    check("Color 1 turned off and on leaves it alone", hexOf(mine) in fx.inner_text() and ev("project.zones[0].layers[0].own") == {"b-bars": ["color"]}, fx.inner_text())
    ev("setMacro('color1', { h: 120 })"); settle()
    check("Color 1 moved again (its fader): the layer takes it again", not ev("project.zones[0].layers[0].own") and "#00FF00" in fx.inner_text() and any(m.startswith("Follows Color 1") for m in marks()),
          (ev("project.zones[0].layers[0].own"), fx.inner_text()))
    ev("setOwnCtl(project.zones[0].layers[0], 'b-bars', 'color', true); commit(); renderRight()"); settle()
    pg.locator("#rightBody .lbl.own button.relink").click(); settle()
    check("Follow Color 1 again: it follows it once more", not ev("project.zones[0].layers[0].own") and "#00FF00" in fx.inner_text(), (ev("project.zones[0].layers[0].own"), fx.inner_text()))
    ev("setMacro('color1', { on: false })"); settle()
    check("Color 1 off: it shows its own colour again", hexOf(mine) in fx.inner_text(), fx.inner_text())

    # the light: one layer with its own colour, another on top following Color 1, and back
    load("b-solid", "{ color: [0, 0, 1, 1] }")
    ev("setMacro('color1', { h: 0, s: 1, v: 1, on: true })"); settle()
    check("a layer following Color 1 sends it", col() == [255, 0, 0], col())
    ev("setOwnCtl(project.zones[0].layers[0], 'b-solid', 'color', true)"); settle()
    check("the same layer keeping its own colour sends its own", col() == [0, 0, 255], col())
    ev("(() => { const z = project.zones[0], L = newLayer('b-solid'); L.params['b-solid'] = { color: [0, 1, 0, 1] }; z.layers.push(L); })()"); settle()
    check("another layer of the same effect on top still follows Color 1", col() == [255, 0, 0], col())
    ev("project.zones[0].layers.pop()"); settle()
    # Color 2 moved: a layer keeping its own Color 1 stays as it is
    ev("setMacro('color2', { h: 200, s: 1, v: 1 })"); settle()
    check("another colour macro moving leaves it alone", ev("project.zones[0].layers[0].own") == {"b-solid": ["color"]} and col() == [0, 0, 255], (ev("project.zones[0].layers[0].own"), col()))
    data = ev("JSON.parse(serialize())")
    check("a file keeps it", data["zones"][0]["layers"][0].get("own") == {"b-solid": ["color"]}, data["zones"][0]["layers"][0].get("own"))
    data["zones"][0]["layers"][0]["own"] = {"b-solid": ["color", 3, "", "color"], "gone": [], "x": "no"}
    ev("d => olm.loadProject(d)", data); settle()
    check("and a file's is repaired", ev("project.zones[0].layers[0].own") == {"b-solid": ["color"]} and col() == [0, 0, 255], (ev("project.zones[0].layers[0].own"), col()))
    ev("storeScene && storeScene(project.zones[0])"); settle()
    check("a scene stored keeps it", ev("(project.zones[0].scenes.at(-1) || {}).layers") and ev("project.zones[0].scenes.at(-1).layers[0].own") == {"b-solid": ["color"]},
          ev("project.zones[0].scenes.map(s => s.layers.map(L => L.own))"))
    reset(); load("b-bars")
    ev("project.macros.color1 = Object.assign(project.macros.color1, { h: 0, s: 1, v: 1 }); updateMacrosUI()")
    ev("ui.macroOpen = []; savePrefs()"); reset(); settle()

    # ---------- MIDI
    ev("ui.midiOn = true; ui.midiVc = false; updateMidiUI()"); settle()
    def cc(n, v): ev(f"midiIn({{ port: 'K', ch: 1, type: 'cc', num: {n}, val: {v} }})"); time.sleep(0.03)
    ev("midiSetLearn(true)"); cc(21, 10); settle(0.3)
    new = W.locator(".mmap.new")
    check("learning, the control moved shows at the top of the mappings, with a list to choose what it moves", new.count() == 1 and "CC 21" in new.inner_text()
          and new.locator("select option").first.inner_text() == "Choose what it moves…", new.inner_text() if new.count() else "")
    W.locator('.mmacros .mslot[data-midi="m:speed"]').click(); settle()
    check("clicking the Speed slider in the MIDI window learns it (it stays where it was)", ev("project.midi.maps.some(w => w.key === 'midi:K:1:cc:21' && w.to === 'm:speed')") and ev("project.macros.speed.v") == 1
          and W.locator(".mmap.new").count() == 0)
    W.locator(".mmacros .row.mcolor").first.locator(".mfold").click(); settle()
    cc(22, 10); settle(0.3)
    W.locator(".mmap.new select").select_option("m:color1.0"); settle()
    ev("midiSetLearn(false)"); settle()
    check("and another onto Color 1's hue, chosen from its list", ev("project.midi.maps.some(w => w.key === 'midi:K:1:cc:22' && w.to === 'm:color1.0')"), ev("project.midi.maps.map(w => w.key + '>' + w.to)"))
    for v in (60, 64, 100): cc(21, v)
    settle()
    check("with pickup, Speed follows the fader once it reaches 1×", abs(ev("project.macros.speed.v") - 200 / 127) < 1e-6, ev("project.macros.speed.v"))
    cc(22, 0); cc(22, 127); cc(22, 64); settle()
    check("the hue fader moves the hue and turns Color 1 on", abs(ev("project.macros.color1.h") - 64 / 127 * 360) < 1e-6 and ev("project.macros.color1.on"), ev("project.macros.color1"))
    check("the slider in the MIDI window moves, and shows where the fader is, with its tag", W.locator('.mmacros .mslot[data-midi="m:speed"] .fline').is_visible()
          and W.locator('.mmacros .mslot[data-midi="m:speed"] > .ftag').inner_text() == "CC 21"
          and abs(float(W.locator('.mmacros .mslot[data-midi="m:speed"] input').input_value()) - 200 / 127) < 0.01)
    check("a mapping onto a macro is named after it", ev("midiTargetLabel('m:speed')") == "Speed" and ev("midiTargetLabel('m:color1.0')") in ("Color 1 · Hue", "Color 1 · Red"))
    opts = W.locator(".mmap select.mtarget").first.locator("optgroup[label=Macros] option").all_inner_texts()
    check("the MIDI window's list has the macros", opts[:3] == ["Speed", "Intensity", "Saturation"] and "Fade" in opts and any(o.startswith("Color 1 · ") for o in opts), opts)
    W.close()

    # ---------- devices
    ev("remoteFromDevice('a', 'operator', { op: 'macro', id: 'saturation', patch: { v: 0.25 } })")
    ev("remoteFromDevice('b', 'remote', { op: 'macro', id: 'saturation', patch: { v: 0.9 } })")
    ev("remoteFromDevice('c', 'programmer', { op: 'macro', id: 'nope', patch: { v: 0.9 } })")
    check("an operator's device can move a macro, a phone can't", ev("project.macros.saturation.v") == 0.25)
    check("the devices hear the macros with the master", ev("remoteLive().macros.saturation.v") == 0.25)
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
  bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
