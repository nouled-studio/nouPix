# Step 2b of MIDI: which macro each control of an effect follows, chosen per effect (project.macroLinks: none, or
# another macro it can follow; by its name otherwise), in the engine, in files and undo, and in the "Macros it
# follows" fold of an effect's Parameters (locked for an operator); and MIDI straight onto one control of an effect
# (p:<source>:<control>): learnt from its slider, tick, list or button in either order, in every layer that plays it,
# pickup and jump, a scene bringing its own value back, speed with its direction, lists in steps, ticks, events, an
# effect that isn't playing, a deleted one, the MIDI window's list; and a fader learnt onto something that is on or
# off starting on Follow.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, FAKE_MIDI
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8186
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
K = "nanoKONTROL2"
# effects of one's own: one with a list, a tick and an event; one with a whole number (which ISF doesn't draw, but a
# file can have: MIDI still sets it)
MINE = """/*{"INPUTS":[{"NAME":"look","TYPE":"long","VALUES":[0,1,2],"LABELS":["A","B","C"],"DEFAULT":0},
{"NAME":"flip","TYPE":"bool","DEFAULT":false},{"NAME":"kick","TYPE":"event"}]}*/
void main(){gl_FragColor=vec4(float(look)/2.0,flip?1.0:0.0,kick?1.0:0.0,1.0);}"""
INTS = """/*{"INPUTS":[{"NAME":"steps","TYPE":"int","MIN":0,"MAX":10,"DEFAULT":2}]}*/
void main(){gl_FragColor=vec4(1.0);}"""

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); ctx = br.new_context(viewport={"width": 1440, "height": 1100})
    ctx.add_init_script(FAKE_MIDI)
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    ev = pg.evaluate
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm")
    ev(f"sessionStorage.setItem('fakeMidi', JSON.stringify({{ ports: [{K!r}] }}))")
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    def settle(t=0.3): time.sleep(t)
    def send(*b): ev(f"__midi.send({K!r}, {list(b)})"); time.sleep(0.04)
    cc = lambda n, v: send(0xB0, n, v)
    on = lambda n: send(0x90, n, 100)
    off = lambda n: send(0x80, n, 0)
    # a project with one fixture and, in each zone, one layer of these effects (a second zone if two are given)
    def load(*srcs, links=None):
        ev(f"""(() => {{ const p = blankProject('Links'); p.fixtures.push(newFixture('line', {{ x1: 100, y1: 320, x2: 900, y2: 320, pixels: 8 }}));
          p.sources.push({{ id: 'mine', kind: 'isf', name: 'Mine', code: {MINE!r} }}, {{ id: 'ints', kind: 'isf', name: 'Ints', code: {INTS!r} }});
          const srcs = {list(srcs)!r};
          p.zones[0].layers = [newLayer(srcs[0])];
          if (srcs[1]) {{ const z = newZone({{ name: 'Zone 2', w: 1000, h: 640 }}); z.layers = [newLayer(srcs[1])]; p.zones.push(z); }}
          p.macroLinks = {links or {}};
          olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); ui.rightTab = 'content'; ui.zone = olm.project.zones[0].id; ui.layer = olm.project.zones[0].layers[0].id;
          showRight(true); renderRight(); }})()"""); settle(0.5)
    col = lambda i=0: ev(f"Array.from(olm.project.fixtures[0]._col.slice({i * 3}, {i * 3 + 3}))")
    roles = lambda src: ev(f"macroRolesOf(srcById('{src}'), runtimeOf(srcById('{src}')))")
    uni = lambda src, name: ev(f"runtimeOf(srcById('{src}')).R.uniforms['{name}'].value")
    param = lambda name, z=0: ev(f"(() => {{ const L = project.zones[{z}].layers[0], s = srcById(L.src); return paramValue(L, s, controlsOf(s).find(i => i.NAME === '{name}')); }})()")
    maps = lambda: ev("project.midi.maps.map(w => [w.key.split(':').slice(-2).join(' '), w.to, w.mode])")
    def rate(key):
        a = ev(f"[speedClocks.get({key}).tau, clockT]"); settle(0.6); b = ev(f"[speedClocks.get({key}).tau, clockT]")
        return (b[0] - a[0]) / (b[1] - a[1])
    learn = lambda on=True: ev(f"midiSetLearn({'true' if on else 'false'})")
    ev("setMidiOn(true)"); settle()

    # ---------- which macro a control follows, per effect
    load("b-solid", links={})
    ev("project.zones[0].layers[0].params['b-solid'] = { color: [0, 0, 1, 1] }; setMacro('color1', { h: 0, s: 1, v: 1 })"); settle()
    check("by its name, an effect's colour follows Color 1", roles("b-solid") == {"color": "color1"} and col() == [255, 0, 0], col())
    ev("setMacroLink(srcById('b-solid'), 'color', '')"); settle()
    check("chosen not to follow anything, it keeps its own colour while Color 1 is on", roles("b-solid") == {} and col() == [0, 0, 255]
          and ev("project.macroLinks") == {"b-solid": {"color": ""}}, (roles("b-solid"), col()))
    ev("setMacroLink(srcById('b-solid'), 'color', 'color2'); setMacro('color2', { h: 120, s: 1, v: 1 })"); settle()
    check("chosen to follow Color 2, it does", roles("b-solid") == {"color": "color2"} and col() == [0, 255, 0], col())
    ev("setMacroLink(srcById('b-solid'), 'color', 'color1')"); settle()
    check("back to what its name says, nothing is kept for it", ev("project.macroLinks") == {} and col() == [255, 0, 0], ev("project.macroLinks"))
    ev("setMacroLink(srcById('b-solid'), 'color', ''); undo()"); settle()
    check("a choice is a step of undo", ev("project.macroLinks") == {} and col() == [255, 0, 0])
    ev("redo()"); settle()
    check("and of redo", ev("project.macroLinks") == {"b-solid": {"color": ""}} and col() == [0, 0, 255])
    ev("project.macros = defaultMacros(); updateMacrosUI()")

    load("b-rainbow")
    key = "project.zones[0].layers[0].id + '|b-rainbow'"
    r1 = rate(key); ev("setMacro('speed', { v: 2 })"); r2 = rate(key)
    ev("setMacroLink(srcById('b-rainbow'), 'speed', '')"); r3 = rate(key)
    check("an effect taken out of Speed runs at its own speed while Speed is 2×", abs(r2 / r1 - 2) < 0.15 and abs(r3 / r1 - 1) < 0.15, (r1, r2, r3))
    load("b-checker", links={"b-checker": {"scroll": ""}})
    ev("project.zones[0].layers[0].params['b-checker'] = { rate: 2, scroll: 1 }")
    ka, kb = "project.zones[0].layers[0].id + '|b-checker|flip'", "project.zones[0].layers[0].id + '|b-checker|travel'"
    ev("setMacro('speed', { v: 1 })"); a1, b1 = rate(ka), rate(kb)
    ev("setMacro('speed', { v: 2 })"); a2, b2 = rate(ka), rate(kb)
    check("each clock's rate on its own: one still follows Speed, the one taken out doesn't", abs(a2 / a1 - 2) < 0.15 and abs(b2 / b1 - 1) < 0.15, (a1, a2, b1, b2))
    ev("project.macros = defaultMacros(); updateMacrosUI()")

    load("b-plasma", links={"b-plasma": {"range": "width"}})
    check("a control without a macro of its own can follow a shared control", roles("b-plasma").get("range") == "width", roles("b-plasma"))
    ev("setMacro('width', { on: true, v: 1 })"); settle()
    hi = ev("controlsOf(srcById('b-plasma')).find(i => i.NAME === 'range').MAX")
    check("it goes to the same point of its own range", abs(uni("b-plasma", "range") - hi) < 1e-6, (uni("b-plasma", "range"), hi))
    ev("project.macros = defaultMacros(); updateMacrosUI()")
    load("b-bars", links={"b-bars": {"color": "speed", "width": "intensity", "count": 7}})
    check("a file's choices that an effect can't follow are left out or ignored: its controls follow by name",
          roles("b-bars") == {"color": "color1", "background": "color2", "count": "count", "width": "width", "softness": "softness", "speed": "speed", "angle": "angle"}
          and ev("project.macroLinks") == {"b-bars": {"color": "speed"}}, (roles("b-bars"), ev("project.macroLinks")))
    ev("loadProject(Object.assign(JSON.parse(serialize()), { macroLinks: { nope: { color: '' }, 'b-bars': { speed: '', angle: 'color9' } } }))"); settle()
    check("links to an effect that isn't there go; the others are kept", ev("project.macroLinks") == {"b-bars": {"speed": ""}}, ev("project.macroLinks"))
    data = ev("serialize()")
    ev("d => { loadProject(blankProject()); loadProject(JSON.parse(d)); }", data); settle()
    check("saved with the project and opened again", ev("project.macroLinks") == {"b-bars": {"speed": ""}})
    ev("loadProject(Object.assign(JSON.parse(serialize()), { macroLinks: undefined }))"); settle()
    check("a file from before has none", ev("project.macroLinks") == {})

    # ---------- the fold in an effect's Parameters
    load("b-bars")
    ev("ui.macroOpen = []; renderRight()"); settle()
    fold = pg.locator("#rightBody .row.mlinks")
    check("an effect's Parameters end with what it follows, folded to one line: how many of its controls follow",
          fold.count() == 1 and "Macros it follows" in fold.inner_text() and "7 of 7" in fold.inner_text() and pg.locator("#rightBody .msub select").count() == 0, fold.inner_text())
    fold.locator(".mfold").click(); settle()
    rows = pg.locator("#rightBody .row.mlinks + .msub .row")
    check("opened: a row for each control that can follow a macro, with what it follows", rows.count() == 7
          and rows.locator(".lbl").all_inner_texts() == ["Bar color", "Background", "Bars", "Width", "Softness", "Speed", "Angle"]
          and pg.locator("#rightBody .msub").last.locator(".note").inner_text() == "For Bars wherever it plays.", rows.locator(".lbl").all_inner_texts())
    sp = pg.locator("#rightBody .msub .row:has(.lbl:text-is('Speed')) select")
    check("a speed can follow Speed or nothing", sp.locator("option").all_inner_texts() == ["Its own value", "Speed"], sp.locator("option").all_inner_texts())
    an = pg.locator("#rightBody .msub .row:has(.lbl:text-is('Angle')) select")
    check("another number: Saturation or a shared control", an.locator("option").all_inner_texts()[:3] == ["Its own value", "Saturation", "Angle"] and "Speed" not in an.locator("option").all_inner_texts()
          and "Intensity" not in an.locator("option").all_inner_texts())
    sp.select_option(""); settle()
    check("choosing marks the row and offers to go back", ev("project.macroLinks") == {"b-bars": {"speed": ""}} and pg.locator("#rightBody .row.mchg").count() == 1
          and "6 of 7" in pg.locator("#rightBody .row.mlinks").inner_text() and pg.locator("#rightBody .msub button:has-text('As their names say')").count() == 1)
    check("the open fold is remembered", "links" in ev("ui.macroOpen") and "macroOpen" in ev("UI_PREFS"))
    pg.locator("#rightBody .msub button:has-text('As their names say')").click(); settle()
    check("As their names say: back to the usual", ev("project.macroLinks") == {} and pg.locator("#rightBody .row.mchg").count() == 0)
    ev("setMacro('speed', { v: 1.5 })"); settle()
    check("the note under a control says what it follows", pg.locator("#rightBody .note.via:visible").all_inner_texts() == ["Follows Speed (1.50×)"], pg.locator("#rightBody .note.via:visible").all_inner_texts())
    ev("setMacroLink(srcById('b-bars'), 'speed', '')"); settle()
    check("and doesn't once it is taken out", pg.locator("#rightBody .note.via:visible").count() == 0)
    ev("project.macros = defaultMacros(); remote.role = 'operator'; renderRight()"); settle()
    check("an operator sees the choices but can't change them", pg.locator("#rightBody .msub").last.locator("select:disabled").count() == 7 and "Operator" in pg.locator("#rightBody .msub").last.inner_text())
    ev("remote.role = null; renderRight()")

    # ---------- MIDI straight onto an effect's control
    load("b-bars")
    w0 = param("width")
    learn(); cc(5, 40); settle(0.2)
    pg.locator("#rightBody .slider [data-midi='p:b-bars:width']").click(); settle()
    check("learn: a control moved, then an effect's slider clicked, drives it (the slider doesn't move)", maps() == [["cc 5", "p:b-bars:width", "toggle"]] and param("width") == w0, (maps(), param("width")))
    pg.locator("#rightBody .slider [data-midi='p:b-bars:count']").click(); settle(0.2)
    check("the other way round: the slider first, it waits for a control", ev("midi.learn.target") == "p:b-bars:count")
    cc(6, 30); settle()
    check("then the control moved drives it", ["cc 6", "p:b-bars:count", "toggle"] in maps())
    learn(False)
    check("each slider an effect's control drives has its tag", pg.locator("#rightBody [data-midi='p:b-bars:width'] > .ftag").text_content() == "CC 5")
    for v in (0, 10, 20): cc(5, v)
    check("on Pickup, the fader waits until it reaches the value", abs(param("width") - w0) < 1e-9, param("width"))
    for v in range(30, 128, 6): cc(5, v)
    settle()
    lo, hi = ev("(() => { const i = controlsOf(srcById('b-bars')).find(i => i.NAME === 'width'); return [i.MIN ?? 0, i.MAX ?? 1]; })()")
    want = lo + (hi - lo) * 126 / 127
    check("then it follows, over the control's range", abs(param("width") - want) < 1e-6, (param("width"), want))
    check("the slider in the Content tab shows it", pg.locator("#rightBody .row:has([data-midi='p:b-bars:width']) .sval").inner_text() == f"{want:.2f}",
          pg.locator("#rightBody .row:has([data-midi='p:b-bars:width']) .sval").inner_text())
    check("and has the fader's line", pg.locator("#rightBody [data-midi='p:b-bars:width'] > .fline:not([hidden])").count() == 1)
    settle(0.6); ev("undo()"); settle()
    check("moving it is a step of undo", param("width") < want - 0.01, param("width"))
    ev("redo()")

    load("b-bars", "b-bars")
    ev("project.midi.maps = [Object.assign(newMidiMap('midi:nanoKONTROL2:1:cc:5', 'p:b-bars:width'), { takeover: 'jump' })]")
    cc(5, 127); settle()
    check("on Jump it goes at once, and in every layer that plays that effect (both zones)", abs(param("width", 0) - hi) < 1e-9 and abs(param("width", 1) - hi) < 1e-9, (param("width", 0), param("width", 1)))
    ev("(() => { const z = project.zones[0]; storeScene(z); z.scenes[0].layers[0].params['b-bars'] = { width: 0.1 }; project.midi.maps[0].takeover = 'pickup'; project.midi.maps[0]._picked = true; })()")
    ev("goScene(project.zones[0], project.zones[0].scenes[0], true)"); settle()
    check("a scene played brings its own value back", abs(param("width") - 0.1) < 1e-9, param("width"))
    cc(5, 120); settle()
    check("and a fader on Pickup waits for it again", abs(param("width") - 0.1) < 1e-9 and not ev("midiPicked(project.midi.maps[0])"), param("width"))

    load("b-bars")
    ev("project.zones[0].layers[0].params['b-bars'] = { speed: -0.2 }; project.midi.maps = [Object.assign(newMidiMap('midi:nanoKONTROL2:1:cc:7', 'p:b-bars:speed'), { takeover: 'jump' })]")
    M = ev("speedTop(controlsOf(srcById('b-bars')).find(i => i.NAME === 'speed'))")
    cc(7, 127); settle()
    check("a speed goes from still to full, keeping its direction (here reversed)", abs(param("speed") + M) < 1e-9, (param("speed"), M))
    ev("project.midi.maps.push(Object.assign(newMidiMap('midi:nanoKONTROL2:1:cc:8', 'p:b-bars:angle'), { takeover: 'jump' }))")
    cc(8, 0); a0 = param("angle"); cc(8, 127); a1 = param("angle")
    amin, amax = ev("(() => { const i = controlsOf(srcById('b-bars')).find(i => i.NAME === 'angle'); return [i.MIN, i.MAX]; })()")
    check("an angle goes over its range", a0 == amin and a1 == amax, (a0, a1, amin, amax))

    load("ints")
    ev("project.midi.maps = [Object.assign(newMidiMap('midi:nanoKONTROL2:1:cc:1', 'p:ints:steps'), { takeover: 'jump' })]")
    cc(1, 64); settle()
    check("a whole number goes in whole steps", param("steps") == 5, param("steps"))
    load("mine")
    ev("""project.midi.maps = [Object.assign(newMidiMap('midi:nanoKONTROL2:1:cc:2', 'p:mine:look'), { takeover: 'pickup' }),
      newMidiMap('midi:nanoKONTROL2:1:note:40', 'p:mine:flip'), newMidiMap('midi:nanoKONTROL2:1:note:41', 'p:mine:kick')]""")
    for v in (0, 30, 64, 100, 127): cc(2, v)
    check("a list steps through its choices (and Pickup holds on to them)", param("look") == 2 and ev("midiPicked(project.midi.maps[0])"), param("look"))
    cc(2, 60); settle()
    check("the middle of the fader is the middle choice", param("look") == 1, param("look"))
    on(40); off(40); settle()
    check("a pad turns a tick on", param("flip") is True)
    on(40); off(40); settle()
    check("and off", param("flip") is False)
    ev("(() => { const L = project.zones[0].layers[0]; (L.params.mine = L.params.mine || {}).kick = false; window.__kicks = []; const t0 = setInterval(() => __kicks.push(L.params.mine.kick), 10); setTimeout(() => clearInterval(t0), 400); })()")
    on(41); off(41); settle(0.5)
    check("an event is on for a moment, and isn't kept", True in ev("__kicks") and param("kick") is False, ev("__kicks")[:12])
    check("the tick, the list and the event button are marked for MIDI", pg.locator("#rightBody .checkrow[data-midi='p:mine:flip']").count() == 1
          and pg.locator("#rightBody .mslot[data-midi='p:mine:look'] > select").count() == 1 and pg.locator("#rightBody button[data-midi='p:mine:kick']").count() == 1)
    learn(); pg.locator("#rightBody .checkrow[data-midi='p:mine:flip']").click(); settle(0.2)
    check("clicking a tick while learning picks it, without ticking it", ev("midi.learn.target") == "p:mine:flip" and param("flip") is False)
    pg.locator("#rightBody .mslot[data-midi='p:mine:look']").click(); settle(0.2)
    check("so does a list, without opening it", ev("midi.learn.target") == "p:mine:look")
    learn(False)

    # ---------- an effect that isn't playing, or is gone; the MIDI window
    load("b-bars")
    ev("project.midi.maps = [Object.assign(newMidiMap('midi:nanoKONTROL2:1:cc:9', 'p:b-plasma:scale'), { takeover: 'jump' })]")
    cc(9, 100); settle()
    check("a control of an effect that isn't playing does nothing, and keeps its name", ev("midiTargetLabel('p:b-plasma:scale')") == "Plasma · Scale"
          and "plasma" not in str(ev("project.zones[0].layers[0].params")).lower(), ev("midiTargetLabel('p:b-plasma:scale')"))
    check("one that isn't there is missing", ev("midiTarget('p:b-plasma:nope')") is None and ev("midiTarget('p:gone:scale')") is None and ev("midiTarget('p:ints:steps')") is not None)
    with pg.expect_popup() as pi: pg.click("#btnMidi")
    W = pi.value; W.set_viewport_size({"width": 1180, "height": 760}); settle(0.6)
    opts = W.locator(".mmap select.mtarget optgroup[label='Bars (effect)'] option").all_inner_texts()
    check("the MIDI window lists the effects' controls", opts == ["Bars · Bars", "Bars · Width", "Bars · Softness", "Bars · Speed", "Bars · Angle"], opts)
    check("and the effect a mapping drives, playing or not", W.locator(".mmap select.mtarget optgroup[label='Plasma (effect)'] option").count() >= 1)
    W.locator(".mmap select.mtarget").select_option("p:b-bars:softness"); settle()
    check("picking another control there drives it", maps() == [["cc 9", "p:b-bars:softness", "toggle"]], maps())

    # ---------- a fader learnt onto something on or off starts on Follow
    ev("project.midi.maps = []; updateMidiUI()"); settle()
    learn(); cc(20, 64); cc(20, 90); settle(0.2)
    pg.click("#btnBlackout"); settle()
    check("a fader learnt onto Blackout follows it (Hold)", maps() == [["cc 20", "blackout", "hold"]], maps())
    check("which the MIDI window calls Follow for a CC", W.locator(".mmap .seg button.on").inner_text() == "Follow", W.locator(".mmap .seg button").all_inner_texts())
    cc(21, 127); settle(0.2); pg.click("#btnBlackout"); settle()
    check("a button sending only on and off toggles it", ["cc 21", "blackout", "toggle"] in maps(), maps())
    on(44); settle(0.2); off(44); pg.click("#btnBlackout"); settle()
    check("a pad toggles it too", ["note 44", "blackout", "toggle"] in maps(), maps())
    learn(False); settle()
    check("for a note the MIDI window says Hold", "Hold" in W.locator(".mmap[data-map='%s'] .seg" % ev("project.midi.maps.find(w => w.key.endsWith('note:44')).id")).inner_text())
    ev("project.midi.maps = [Object.assign(newMidiMap('midi:nanoKONTROL2:1:cc:20', 'blackout'), { mode: 'hold' })]")
    cc(20, 100); settle(0.1); b1 = ev("ui.blackout"); cc(20, 20); settle(0.1); b2 = ev("ui.blackout")
    check("Follow: on while the fader is past the middle", b1 is True and b2 is False, (b1, b2))

    check("no errors", not errs, errs[:5])
    W.close()
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
