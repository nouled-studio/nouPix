# Typing and scrolling values in the panels: double-click a slider's value (or Enter on it) to type one; Shift + scroll
# over a slider, a number box or a colour picker slider moves it a notch at a time; angles of shaders have buttons
# every 45°, go round past 360° and take any typed angle. Each change is one step of undo.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8178
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

RADIANS = '/*{"INPUTS":[{"NAME":"angle","LABEL":"Angle","TYPE":"float","MIN":0,"MAX":6.2832,"DEFAULT":0}]}*/\nvoid main(){gl_FragColor=vec4(1.0);}'

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 1200})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    ev("""(() => { const p = blankProject('Values'); const f = newFixture('line', { x1: 100, y1: 300, x2: 900, y2: 300, pixels: 8 }); p.fixtures.push(f);
      p.zones[0].layers = [newLayer('b-bars')]; olm.loadProject(JSON.parse(JSON.stringify(p, replacer)));
      olm.selectZone(olm.project.zones[0].id); ui.layer = olm.project.zones[0].layers[0].id; olm.ui.rightTab = 'content'; renderRight(); })()""")
    time.sleep(0.4)
    par = lambda k: ev(f"(() => {{ const L = olm.project.zones[0].layers[0]; return paramValue(L, srcById(L.src), isfInputs(srcById(L.src)).find(i => i.NAME === '{k}')); }})()")
    hidx = lambda: ev("hist.idx")
    rowsel = lambda label: f"#rightBody .row:has(> .lbl:text-is('{label}'))"
    val = lambda label: pg.locator(rowsel(label) + " .sval")
    btns = lambda: pg.locator("#rightBody .seg.angles button")
    lit = lambda: [b.inner_text() for b in btns().all() if "on" in (b.get_attribute("class") or "")]
    def typed(label, text, key="Enter"):
        v = val(label); v.scroll_into_view_if_needed(); v.dblclick()
        inp = pg.locator(rowsel(label) + " input.sedit")
        inp.fill(text); inp.press(key); time.sleep(0.15)
    # a mouse wheel's clicks (Playwright's wheel is always whole clicks)
    def wheel(sel, dy, shift=True, times=1):
        el = pg.locator(sel).first; el.scroll_into_view_if_needed(); b = el.bounding_box()
        pg.mouse.move(b["x"] + min(40, b["width"] / 2), b["y"] + b["height"] / 2)
        if shift: pg.keyboard.down("Shift")
        for _ in range(times): pg.mouse.wheel(0, dy); time.sleep(0.03)
        if shift: pg.keyboard.up("Shift")
        time.sleep(0.1)
    # a trackpad: small moves, close together (wheel events made by hand, with no wheelDelta clicks)
    def pad(sel, deltas):
        pg.locator(sel).first.evaluate("(el, ds) => { for (const d of ds) el.dispatchEvent(new WheelEvent('wheel', { deltaY: d, shiftKey: true, bubbles: true, cancelable: true })); }", deltas)

    # ---------- angle buttons
    check("a shader angle has buttons every 45°, and 0° is lit", btns().all_inner_texts() == ["0°", "45°", "90°", "135°", "180°", "225°", "270°", "315°"] and lit() == ["0°"], btns().all_inner_texts())
    h0 = hidx(); btns().nth(2).click(); time.sleep(0.2)
    check("90° sets the angle, shows it on the slider and lights its button, one undo step", par("angle") == 90 and val("Angle").inner_text() == "90°" and lit() == ["90°"] and hidx() == h0 + 1, (par("angle"), val("Angle").inner_text(), lit()))
    ev("undo()"); time.sleep(0.3)
    check("undo goes back to 0°", par("angle") == 0 and lit() == ["0°"])

    # ---------- typing a value
    v = val("Angle"); v.scroll_into_view_if_needed(); v.dblclick()
    inp = pg.locator(rowsel("Angle") + " input.sedit")
    check("double-clicking the value opens a box with the value, selected", inp.count() == 1 and inp.input_value() == "0" and ev("document.activeElement.classList.contains('sedit') && document.activeElement.selectionEnd - document.activeElement.selectionStart === 1"))
    h0 = hidx(); inp.fill("37.5"); inp.press("Enter"); time.sleep(0.15)
    check("a typed angle is taken as it is, shown, one undo step, and no button is lit", par("angle") == 37.5 and val("Angle").inner_text() == "37.5°" and lit() == [] and hidx() == h0 + 1, (par("angle"), val("Angle").inner_text(), lit(), hidx() - h0))
    check("after Enter the value has the focus again", ev("document.activeElement.classList.contains('sval')"))
    ev("(() => { const z = olm.project.zones[0]; storeScene(z); storeScene(z); z.scene = z.scenes[0].id; })()"); time.sleep(0.2)
    sc0 = ev("olm.project.zones[0].scene")
    pg.keyboard.press("7"); time.sleep(0.1)
    inp = pg.locator(rowsel("Angle") + " input.sedit")
    check("a digit on the value starts typing with it (and doesn't play scene 7)", inp.count() == 1 and inp.input_value() == "7" and ev("olm.project.zones[0].scene") == sc0, inp.input_value() if inp.count() else "")
    pg.keyboard.type("5"); pg.keyboard.press("Enter"); time.sleep(0.15)
    check("typing on: 75°", par("angle") == 75, par("angle"))
    h0 = hidx(); sel0 = ev("[...ui.sel]")
    pg.keyboard.press("ArrowUp"); pg.keyboard.press("Shift+ArrowUp"); pg.keyboard.press("ArrowDown"); time.sleep(0.1)
    check("arrow keys on the value step it: up 5°, Shift ×10, down", par("angle") == 125 and hidx() == h0, (par("angle"), hidx() - h0))
    time.sleep(0.6)
    check("one undo step once the keys stop", hidx() == h0 + 1, hidx() - h0)
    ev("undo()"); time.sleep(0.3)
    check("undo takes the arrow steps back: 75°", par("angle") == 75, par("angle"))
    ev("(() => { const L = olm.project.zones[0].layers[0]; setParam(L, srcById('b-bars'), 'width', 0.35573); commit(); renderRight(); })()"); time.sleep(0.2)
    h0 = hidx(); v = val("Width"); v.scroll_into_view_if_needed(); v.dblclick(); pg.keyboard.press("Enter"); time.sleep(0.15)
    check("Enter without a change keeps the value exactly (0.35573, not 0.36)", par("width") == 0.35573 and hidx() == h0, par("width"))
    v = val("Angle"); v.scroll_into_view_if_needed(); v.focus()
    pg.keyboard.press("Enter"); time.sleep(0.1)
    check("Enter on the value opens the box too", pg.locator(rowsel("Angle") + " input.sedit").count() == 1)
    pg.keyboard.press("Escape"); time.sleep(0.1)
    typed("Angle", "450")
    check("450° goes round to 90°", par("angle") == 90 and lit() == ["90°"], par("angle"))
    typed("Angle", "-45")
    check("-45° goes round to 315°", par("angle") == 315, par("angle"))
    typed("Angle", "12,5")
    check("a decimal comma works: 12,5 is 12.5°", par("angle") == 12.5, par("angle"))
    h0 = hidx(); z0 = ev("ui.zone")
    typed("Angle", "200", key="Escape")
    check("Escape keeps the value, adds no undo step and leaves the selection alone", par("angle") == 12.5 and hidx() == h0 and ev("ui.zone") == z0 and pg.locator("#rightBody input.sedit").count() == 0)
    typed("Angle", "abc")
    check("text that is not a number changes nothing", par("angle") == 12.5 and hidx() == h0 and val("Angle").inner_text() == "12.5°")
    v = val("Angle"); v.dblclick(); pg.locator(rowsel("Angle") + " input.sedit").fill("120")
    pg.locator("#rightBody .sec h3").first.click(); time.sleep(0.15)
    check("clicking elsewhere keeps what was typed", par("angle") == 120 and pg.locator("#rightBody input.sedit").count() == 0, par("angle"))
    w_max = ev("isfInputs(srcById('b-bars')).find(i => i.NAME === 'width').MAX")
    typed("Width", "50")
    check("a value past the slider's end is kept to it", par("width") == w_max, (par("width"), w_max))
    typed("Opacity", "40")
    check("percentages are typed as percentages: 40 is 40 %", ev("olm.project.zones[0].layers[0].opacity") == 0.4 and val("Opacity").inner_text() == "40%", ev("olm.project.zones[0].layers[0].opacity"))
    sp_max = ev("speedMax(runtimeOf(srcById('b-bars')).speed)")
    typed("Speed", "50")
    check("speed is typed in percent of its full speed", abs(par("speed") - sp_max / 2) < 1e-9 and val("Speed").inner_text() == "50%", (par("speed"), sp_max))

    # ---------- Shift + scroll
    typed("Angle", "37.5")
    wheel(rowsel("Angle") + " .slider", -100)
    check("Shift + scroll up moves an angle to the next 5°: 37.5 → 40", par("angle") == 40, par("angle"))
    wheel(rowsel("Angle") + " .slider", -100)
    check("and on to 45°, which lights its button", par("angle") == 45 and lit() == ["45°"], (par("angle"), lit()))
    wheel(rowsel("Angle") + " .slider", 100)
    check("scrolling down goes back: 40°", par("angle") == 40, par("angle"))
    time.sleep(0.6)
    h0 = hidx()
    pad(rowsel("Angle") + " .slider", [-40, -40, -40, 40])
    check("while scrolling, no undo step yet", hidx() == h0 and par("angle") == 50, (hidx() - h0, par("angle")))
    time.sleep(0.6)
    check("when the scrolling stops: one undo step for all of it", hidx() == h0 + 1, hidx() - h0)
    ev("undo()"); time.sleep(0.3)
    check("and one undo takes all of it back", par("angle") == 40, par("angle"))
    wheel(rowsel("Angle") + " .slider", -100, shift=False)
    check("scrolling without Shift leaves the value alone", par("angle") == 40)
    typed("Angle", "355")
    wheel(rowsel("Angle") + " .slider", -100)
    check("355° up a notch is 360°, the same as 0°", par("angle") == 360 and lit() == ["0°"], (par("angle"), lit()))
    wheel(rowsel("Angle") + " .slider", -100)
    check("and past it the angle goes round to 5°", par("angle") == 5, par("angle"))
    wheel(rowsel("Angle") + " .slider", 100, times=2)
    check("down past 0° it goes round to 355°", par("angle") == 355, par("angle"))
    sl = rowsel("Angle") + " .slider"
    pad(sl, [-2])
    check("a trackpad: the first small move after a pause is a notch (355° → 360°)", par("angle") == 360, par("angle"))
    time.sleep(0.3); pad(sl, [-10] * 9)
    check("then its moves add up: a notch, then one every 40 px (3 notches: 15°)", par("angle") == 15, par("angle"))
    time.sleep(0.3); pad(sl, [10] * 5)
    check("and back down the same way (2 notches: 5°)", par("angle") == 5, par("angle"))
    time.sleep(0.6)
    wheel(rowsel("Opacity") + " .slider", -100)
    check("Shift + scroll on opacity: 1 % a notch", abs(ev("olm.project.zones[0].layers[0].opacity") - 0.41) < 1e-9, ev("olm.project.zones[0].layers[0].opacity"))
    wheel(rowsel("Width") + " .slider", 100)
    check("a shader's slider: a hundredth of its range a notch", abs(par("width") - (w_max - w_max / 100)) < 1e-6, par("width"))
    time.sleep(0.6)

    # ---------- the colour picker
    ev("(() => { const L = olm.project.zones[0].layers[0]; setParam(L, srcById('b-bars'), 'color', [1, 0, 0, 1]); commit(); renderRight(); })()"); time.sleep(0.2)
    pg.locator(rowsel("Bar color") + " .cswatch").click(); time.sleep(0.2)
    pg.locator(".cpop .seg button", has_text="HSV").click(); time.sleep(0.1)
    wheel(".cpop .cpslider:has(.cpl:text-is('Hue'))", -100, times=2)
    c = par("color")
    check("Shift + scroll on the picker's hue: 5° a notch", abs(c[1] - 10 / 60) < 0.02 and c[0] == 1 and c[2] == 0, c)
    time.sleep(0.6); h0 = hidx()
    wheel(".cpop .cpslider:has(.cpl:text-is('Hue'))", 100, times=3)
    c = par("color")
    check("and round past 0° to 355°", c[0] == 1 and c[1] == 0 and abs(c[2] - 5 / 60) < 0.02, c)
    time.sleep(0.6)
    check("one undo step for the picker's scrolling", hidx() == h0 + 1, hidx() - h0)
    pg.keyboard.press("Escape"); time.sleep(0.1)

    # ---------- other shaders
    ev("(() => { const L = olm.project.zones[0].layers[0]; loadSource('b-checker', L); renderRight(); })()"); time.sleep(0.3)
    check("an angle from 0 to 90° gets 0°, 45° and 90°", btns().all_inner_texts() == ["0°", "45°", "90°"], btns().all_inner_texts())
    ev("""c => { const s = { id: 'rad', kind: 'isf', name: 'Radians', code: c }; olm.project.sources.push(s); runtimeOf(s);
      loadSource('rad', olm.project.zones[0].layers[0]); renderRight(); }""", RADIANS); time.sleep(0.4)
    check("an angle in radians (0 to 6.28) is a plain slider, no degree buttons", btns().count() == 0 and val("Angle").count() == 1 and "°" not in val("Angle").inner_text(), val("Angle").inner_text() if val("Angle").count() else "")

    # ---------- the inspector and settings
    ev("(() => { ui.sel = new Set([olm.project.fixtures[0].id]); ui.rightTab = 'inspector'; onSelection(); })()"); time.sleep(0.2)
    typed("Dimmer", "50")
    check("the fixture's dimmer typed: 50 is 50 %", ev("olm.project.fixtures[0].dimmer") == 0.5)
    h0 = hidx(); px0 = ev("olm.project.fixtures[0].pixels")
    wheel("#rightBody input[aria-label='Pixels']", -100, times=3)
    check("Shift + scroll on a number box: one a notch, the fixture follows", ev("olm.project.fixtures[0].pixels") == px0 + 3 and pg.locator("#rightBody input[aria-label='Pixels']").input_value() == str(px0 + 3))
    time.sleep(0.6)
    check("one undo step for it", hidx() == h0 + 1 and ev("olm.project.fixtures[0]._n") == px0 + 3, (hidx() - h0, ev("olm.project.fixtures[0]._n")))
    ev("(() => { ui.rightTab = 'settings'; renderRight(); })()"); time.sleep(0.2)
    typed("Frame rate", "33.4")
    check("frame rate takes whole numbers: 33.4 is 33", ev("olm.project.settings.fps") == 33, ev("olm.project.settings.fps"))

    # ---------- a locked panel
    ev("(() => { ui.rightTab = 'inspector'; renderRight(); lockPanel($('#rightBody')); })()"); time.sleep(0.1)
    d0 = ev("olm.project.fixtures[0].dimmer"); v = val("Dimmer"); v.scroll_into_view_if_needed()
    v.dispatch_event("dblclick")
    wheel(rowsel("Dimmer") + " .slider", -100)
    check("in a locked panel the values can't be typed or scrolled", pg.locator("#rightBody input.sedit").count() == 0 and ev("olm.project.fixtures[0].dimmer") == d0)
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
  bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
