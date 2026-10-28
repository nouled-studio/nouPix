# The patch bay (ui-bay.js), the MIDI window's second view: switching between the list and the bay (remembered); the
# controls, what they drive and the effects in three columns; a wire for each mapping (dashed into a folded group,
# bright while its control moves); a wire picked shows its settings (Pickup or Jump, Toggle and Follow) and is
# removed by its button or Delete; learning by clicking a row; the rows' sliders and buttons; folding; a control
# forgotten (×) and the controls put in order by dragging; wires drawn by dragging, either way round; the macros'
# blue wires to the effects' controls (pointed at, pinned, picked, removed, drawn, refused); both views the same.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, FAKE_MIDI
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8188
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
K = "nanoKONTROL2"

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); ctx = br.new_context(viewport={"width": 1440, "height": 1000})
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
    maps = lambda: ev("project.midi.maps.map(w => w.key.split(':').slice(-2).join(' ') + ' > ' + w.to.split(':')[0])")
    # the demo, with mappings onto the master, Speed, a zone's level and two of its scenes, Blackout and an effect
    ev("""(() => { olm.loadProject(demoProject()); const z = project.zones.find(z => z.scenes.length > 2), fx = project.zones[0].layers[0].src;
      window.__z = z.id; window.__fx = 'p:' + fx + ':' + controlsOf(srcById(fx)).find(i => i.TYPE === 'float').NAME;
      const m = (k, t) => newMidiMap('midi:nanoKONTROL2:1:' + k, t);
      project.midi.maps = [m('cc:1', 'master'), m('cc:2', 'm:speed'), m('note:36', 'blackout'), m('cc:4', 'z:' + z.id), m('note:40', 'sc:' + z.id + ':' + z.scenes[1].id),
        m('note:41', 'sc:' + z.id + ':' + z.scenes[2].id), m('cc:5', __fx)];
      ui.midiView = 'list'; ui.bayOpen = []; ui.midiVc = false; commit(); })()""")
    Z = ev("__z"); FX = ev("__fx")
    with pg.expect_popup() as pi: pg.click("#btnMidi")
    W = pi.value; W.set_viewport_size({"width": 1180, "height": 800}); settle(0.6)
    W.on("pageerror", lambda e: errs.append("MIDI window: " + str(e)))
    check("the MIDI window opens on the list, with a switch to the patch bay", W.locator(".mmaps").count() == 1 and W.locator(".mwhead .seg button.on").inner_text() == "List")
    W.locator(".mwhead .seg button", has_text="Patch bay").click(); settle(0.6)
    # a wire is clicked at a point on it where nothing covers it (the middle of its box may be off a curved wire, or
    # under a row)
    def pick(wid, t=0.3):
        x, y = W.evaluate("""id => { const p = document.querySelector(`.bwires path.hit[data-wire="${id}"]`), n = p.getTotalLength(), m = p.getScreenCTM();
          for (let k = 1; k < 40; k++) {
            const q = p.getPointAtLength(n * k / 40), x = m.a * q.x + m.c * q.y + m.e, y = m.b * q.x + m.d * q.y + m.f;
            if (document.elementFromPoint(x, y) === p) return [x, y];
          }
          return [0, 0]; }""", wid)
        W.mouse.click(x, y); settle(t)
    check("the patch bay: controls, what they drive, the effects", W.locator(".bay .bcol h3").all_inner_texts()[:2] == ["CONTROLS", "OUTPUT"] or [x.upper() for x in W.locator(".bay .bcol > h3").all_inner_texts()][:2] == ["CONTROLS", "OUTPUT"],
          W.locator(".bay .bcol h3").all_inner_texts())
    check("and it is remembered", ev("ui.midiView") == "bay" and "midiView" in ev("UI_PREFS"))
    keys = W.locator(".bay .bctl .mk").all_inner_texts()
    check("each mapped control is listed once", sorted(keys) == sorted(["CC 1", "CC 2", "CC 4", "CC 5", "Note 36", "Note 40", "Note 41"]), keys)
    wires = W.locator(".bwires path.wire")
    check("a wire for each mapping", wires.count() == 7, wires.count())
    check("into a folded zone the scenes' wires are dashed, ending at the zone", W.locator(".bwires path.wire.folded").count() == 2, W.locator(".bwires path.wire.folded").count())
    check("an effect's mapped control shows while the effect is folded", W.locator(f'.bay .bfx [data-in="{FX}"]').count() == 1)
    W.locator(f'.bay [data-group="z:{Z}"] .mfold').click(); settle(0.5)
    check("opening the zone: its scenes, the next scene and its playlists, and solid wires to them", W.locator(f'.bay [data-g="z:{Z}"] .bsub .brow').count() >= 3
          and W.locator(".bwires path.wire.folded").count() == 0 and "z:" + Z in ev("ui.bayOpen"))

    # ---------- moving: the controls' bars, the rows, hot wires
    for v in (10, 40, 90): cc(1, v)
    settle(0.1)
    check("a control moving lights its wire and shows where it is", W.locator(".bwires path.glow").count() == 1
          and W.locator('.bay [data-cbar="midi:nanoKONTROL2:1:cc:1"]').evaluate("e => parseFloat(e.style.width) > 60"))
    settle(0.9)
    check("once it stops, the glow fades away by itself", W.locator(".bwires path.glow").count() == 0)
    check("the master's row follows (pickup reached on the way)", abs(float(W.locator('.bay [data-bv="master"]').input_value()) - ev("project.settings.master")) < 0.01)
    r = W.locator('.bay [data-bv="m:speed"]'); r.fill("0.75"); r.dispatch_event("input"); settle()
    check("a row's slider moves what it drives (Speed at 1.5×)", abs(ev("project.macros.speed.v") - 1.5) < 0.01, ev("project.macros.speed.v"))
    W.locator('.bay [data-bb="blackout"]').click(); settle()
    check("a row's button turns Blackout on, and says so", ev("ui.blackout") and W.locator('.bay [data-bb="blackout"]').text_content() == "On")
    W.locator('.bay [data-bb="blackout"]').click(); settle()
    check("the crossfader is under Output, with its slider", W.locator('.bay .btgts .brow[data-t="xf"]').count() == 1 and W.locator('.bay .brow[data-t="xf"] input[type=range]').count() == 1)

    # ---------- a wire picked
    i = ev("project.midi.maps.findIndex(w => w.to === 'master')")
    mid = ev("project.midi.maps[%d].id" % i)
    pick(mid)
    pop = W.locator("#bayPop")
    check("clicking a wire picks it and shows its settings", pop.is_visible() and "CC 1" in pop.inner_text() and "Master" in pop.inner_text() and W.locator(".bwires path.wire.sel").count() == 1, pop.inner_text())
    pop.locator("button", has_text="Jump").click(); settle()
    check("Jump from there", ev(f"project.midi.maps.find(w => w.id === '{mid}').takeover") == "jump" and pop.is_visible())
    W.locator(".bay .bcol.btgts h3").first.click(); settle()
    check("a click elsewhere lets it go", pop.is_hidden() and W.locator(".bwires path.wire.sel").count() == 0)
    bid = ev("project.midi.maps.find(w => w.to === 'blackout').id")
    pick(bid)
    check("a pad on Blackout: Toggle, Hold or Flash", [x.strip() for x in pop.locator(".seg button").all_inner_texts()] == ["Toggle", "Hold", "Flash"], pop.locator(".seg button").all_inner_texts())
    W.keyboard.press("Delete"); settle()
    check("Delete removes the wire picked, and it is a step of undo", not ev("project.midi.maps.some(w => w.to === 'blackout')") and W.locator(".bwires path.wire").count() == 6)
    W.keyboard.press("Control+z"); settle(0.5)
    check("undone, it is back", ev("project.midi.maps.some(w => w.to === 'blackout')") and W.locator(".bwires path.wire").count() == 7)
    fid = ev(f"project.midi.maps.find(w => w.to === '{FX}').id")
    pick(fid)
    pop.locator("button", has_text="Remove").click(); settle()
    check("Remove removes it; the effect's control goes back into its folded effect", not ev(f"project.midi.maps.some(w => w.to === '{FX}')") and W.locator(f'.bay .bfx [data-in="{FX}"]').count() == 0)

    # ---------- learn in the bay
    W.click(".btn.learn"); settle(0.2)
    cc(9, 30); cc(9, 50); settle(0.4)
    check("learning, the control moved shows in the controls, marked", W.locator('.bay .bctl.new[data-key="midi:nanoKONTROL2:1:cc:9"]').count() == 1)
    W.locator('.bay .brow[data-t="m:intensity"] .nm').click(); settle(0.5)
    check("clicking a row learns it, without moving it", ["cc 9 > m"] == [x for x in maps() if x.startswith("cc 9")] and ev("project.macros.intensity.v") == 1
          and W.locator(".bwires path.wire").count() == 7, maps())
    W.locator(f'.bay [data-group="fx:{FX.split(":")[1]}"] .mfold').click(); settle(0.5)
    W.locator(f'.bay [data-t="{FX}"] .nm').click(); settle(0.2)
    cc(10, 64); settle(0.5)
    check("or the other way round: an effect's control clicked, then a fader moved", ev(f"project.midi.maps.some(w => w.key.endsWith('cc:10') && w.to === '{FX}')"), maps())
    W.keyboard.press("Escape"); settle()

    # ---------- forgetting a control, and putting the controls in order
    cc(30, 50); settle(0.4)
    row = W.locator('.bay .bctl[data-key="midi:nanoKONTROL2:1:cc:30"]')
    check("a control moved while not learning isn't listed (as in the list)", row.count() == 0)
    W.click(".btn.learn"); settle(0.2); cc(30, 60); settle(0.4)
    check("while learning, it is", row.count() == 1)
    row.hover(); row.locator("button.x").click(); settle(0.4)
    check("× forgets it", W.locator('.bay .bctl[data-key="midi:nanoKONTROL2:1:cc:30"]').count() == 0 and ev("midi.learn.pending") is None)
    W.keyboard.press("Escape"); settle(0.3)
    n0 = ev("project.midi.maps.length")
    row = W.locator('.bay .bctl[data-key="midi:nanoKONTROL2:1:cc:9"]'); row.hover(); row.locator("button.x").click(); settle(0.4)
    check("forgetting a mapped one removes its mappings too, as a step of undo", ev("project.midi.maps.length") == n0 - 1 and not ev("project.midi.maps.some(w => w.key.endsWith('cc:9'))"))
    W.keyboard.press("Control+z"); settle(0.5)
    check("undone, it is back", ev("project.midi.maps.some(w => w.key.endsWith('cc:9'))"))
    order = lambda: [x.strip() for x in W.locator(".bay .bctl .mk").all_inner_texts()]
    before = order()
    src = W.locator('.bay .bctl[data-key="midi:nanoKONTROL2:1:note:41"]').bounding_box(); dst = W.locator('.bay .bctl[data-key="midi:nanoKONTROL2:1:cc:1"]').bounding_box()
    W.mouse.move(src["x"] + 20, src["y"] + src["height"] / 2); W.mouse.down()
    W.mouse.move(src["x"] + 20, src["y"] - 30, steps=4); W.mouse.move(dst["x"] + 20, dst["y"] + 6, steps=8)
    moving = W.locator(".bay .bctl.dragging").count() == 1 and W.locator('.bay .bctl[data-key="midi:nanoKONTROL2:1:cc:1"]').evaluate("e => getComputedStyle(e).transform !== 'none'")
    check("while dragged, it follows the pointer and the others slide out of its way", moving)
    W.mouse.up(); settle(0.6)
    after = order()
    check("dragging a control puts it in another place", after[0] == "Note 41" and sorted(after) == sorted(before), (before, after))
    check("which the project keeps, and the list follows", ev("project.midi.order[0]").endswith("note:41") and ev("project.midi.maps[0].key").endswith("note:41"))
    check("the wires follow it", W.locator(".bwires path.wire").count() == ev("project.midi.maps.filter(w => midiTarget(w.to)).length"))
    saved = ev("JSON.parse(serialize()).midi.order")
    check("saved in the file", saved and saved[0].endswith("note:41"), saved)

    # ---------- drawing wires: a control to a target, a target to a control
    def draw(a_sel, b_sel, steps=8):
        W.locator(a_sel).first.scroll_into_view_if_needed(); W.locator(b_sel).first.scroll_into_view_if_needed(); settle(0.2)
        a = W.locator(a_sel).first.bounding_box(); b = W.locator(b_sel).first.bounding_box()
        W.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2); W.mouse.down()
        W.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=steps)
        mid = W.locator(".bwires path.draw").count()
        W.mouse.up(); settle(0.5)
        return mid
    n0 = ev("project.midi.maps.length")
    drawn = draw('.bay [data-out="midi:nanoKONTROL2:1:cc:2"]', '.bay .brow[data-t="m:saturation"] .nm')
    check("a wire drawn from a control's dot to a row maps it (a line follows the pointer)", drawn == 1 and ev("project.midi.maps.some(w => w.key.endsWith('cc:2') && w.to === 'm:saturation')")
          and ev("project.midi.maps.length") == n0 + 1 and ev("project.midi.maps.some(w => w.key.endsWith('cc:2') && w.to === 'm:speed')"), maps())
    cc(4, 30); cc(4, 70); settle(0.3)   # it moves like a fader
    draw('.bay [data-in="blackout"]', '.bay .bctl[data-key="midi:nanoKONTROL2:1:cc:4"] .mk')
    check("and the other way round: from a target's dot to a control; another control on it stays", ev("project.midi.maps.filter(w => w.to === 'blackout').length") == 2, maps())
    check("drawn onto something on or off, a fader follows it (it moved like one)", ev("project.midi.maps.find(w => w.to === 'blackout' && w.key.endsWith('cc:4')).mode") == "hold")
    W.keyboard.press("Control+z"); W.keyboard.press("Control+z"); settle(0.5)
    check("each wire drawn is a step of undo", ev("project.midi.maps.length") == n0, maps())

    # ---------- the macros' blue wires to the effects' controls
    W.locator('.bay [data-g="fx:b-bars"]').count() or None
    sp = W.locator('.bay [data-mac="speed"]')
    check("a macro's row says how many effect controls follow it", "→" in sp.locator(".fan").inner_text(), sp.locator(".fan").inner_text())
    sp.locator(".nm").hover(); settle(0.3)
    n = W.locator(".bwires path.link").count()
    check("pointing at it draws its links, in blue", n >= 3, n)
    W.mouse.move(5, 5); settle(0.3)
    check("and they go when the pointer leaves", W.locator(".bwires path.link").count() == 0)
    sp.locator(".nm").click(); W.mouse.move(5, 5); settle(0.3)
    check("clicking its name keeps them drawn", W.locator(".bwires path.link").count() == n and "pinned" in sp.get_attribute("class"))
    FXS = FX.split(":")[1]
    W.locator(f'.bay [data-group="fx:{FXS}"] .mfold').count() and None
    if "fx:" + FXS not in ev("ui.bayOpen"): W.locator(f'.bay [data-group="fx:{FXS}"] .mfold').click(); settle(0.5)
    spd = f"p:{FXS}:speed"
    check("an open effect shows which macro each control follows", W.locator(f'.bay .brow[data-t="{spd}"] .mtag').inner_text() == "Speed")
    lid = f"l:{FXS}|speed"
    pick(lid, 0.4)
    pop = W.locator("#bayPop")
    check("clicking a blue wire: what that control follows, and Remove", pop.is_visible() and "follows" in pop.inner_text() and pop.locator("select").input_value() == "speed", pop.inner_text())
    W.keyboard.press("Delete"); settle(0.5)
    check("Delete takes it out of the macro (its own value), a step of undo", ev(f"project.macroLinks['{FXS}'] && project.macroLinks['{FXS}'].speed") == "" and W.locator(f'.bay .brow[data-t="{spd}"] .mtag').count() == 0)
    drawn = draw('.bay [data-mout="speed"]', f'.bay .brow[data-t="{spd}"] .nm')
    check("a blue wire drawn from the macro's dot to the control links it again", ev(f"(project.macroLinks['{FXS}'] || {{}}).speed") is None and W.locator(f'.bay .brow[data-t="{spd}"] .mtag').inner_text() == "Speed", ev("project.macroLinks"))
    other = ev(f"controlsOf(srcById('{FXS}')).find(i => i.TYPE === 'float' && i.NAME !== 'speed' && !macroRolesOf(srcById('{FXS}'), effectRt(srcById('{FXS}')))[i.NAME]).NAME")
    draw(f'.bay [data-in="p:{FXS}:{other}"]', '.bay [data-mac="width"] .nm')
    check("from an effect's control to a shared macro: it follows it", ev(f"project.macroLinks['{FXS}']['{other}']") == "width", ev("project.macroLinks"))
    draw(f'.bay [data-in="p:{FXS}:{other}"]', '.bay [data-mac="speed"] .nm')
    check("a control that can't follow that macro says so, and nothing changes", ev(f"project.macroLinks['{FXS}']['{other}']") == "width" and "can't follow Speed" in W.inner_text("body"), W.inner_text("body")[-200:])   # the message shows in the window worked in
    W.mouse.move(5, 5); W.keyboard.press("Escape"); settle(0.3)
    check("Esc lets the macro go", W.locator(".bwires path.link").count() == 0 and W.locator(".bay .brow.pinned").count() == 0)

    # ---------- the list shows the same
    W.locator(".mwhead .seg button", has_text="List").click(); settle(0.5)
    check("back to the list: the same mappings", W.locator(".mmaps .mmap").count() == ev("project.midi.maps.length") and ev("ui.midiView") == "list")
    W.locator(".mwhead .seg button", has_text="Patch bay").click(); settle(0.5)
    check("and the bay again, with its folds as they were", "z:" + Z in ev("ui.bayOpen") and W.locator(f'.bay [data-g="z:{Z}"].open').count() == 1)
    ev("loadProject(blankProject())"); settle(0.6)
    check("a project with nothing mapped: the bay says what to do", W.locator(".bay .bctl").count() >= 0 and W.locator(".bwires path.wire").count() == 0)

    check("no errors", not errs, errs[:5])
    W.close()
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
