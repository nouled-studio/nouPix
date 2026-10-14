# The MIDI mapping mockup (docs/mockups/midi-mapping.html), opened from disk: no OSC or sample controller left; a
# macro clicked keeps its wires drawn; the monitor folds; controls reorder by dragging; sliders a MIDI control
# drives keep their colour and show only a thin yellow line, with the control's tag only while the MIDI window is
# open; thin scroll bars that show on hover; colour macros and zones that fold; scenes and playlists played by pads
# (trigger, toggle, hold), learnt from either window; the wire popover (pickup, jump, remove); dragging wires; pickup
# on the main window's sliders; the floating window and the window opened on its own. The port argument is unused.
import os, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCK = os.path.join(ROOT, "docs", "mockups")
URL = "file://" + os.path.join(MOCK, "midi-mapping.html")
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

# ---------- the files
text = "".join(open(os.path.join(MOCK, f), encoding="utf-8").read() for f in sorted(os.listdir(MOCK)))
check("nothing about OSC is left in the mockup", "OSC" not in text and "osc:" not in text.lower())
check("nor the sample nanoKONTROL", "nano" not in text.lower() and "simulated" not in text.lower())

def centre(loc):
    b = loc.bounding_box(); return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

with sync_playwright() as pw:
    br = pw.chromium.launch(); ctx = br.new_context(viewport={"width": 1440, "height": 900})
    errs = []
    def watch(page, who):
        page.on("pageerror", lambda e: errs.append(who + ": " + str(e)))
    pg = ctx.new_page(); watch(pg, "main")
    pg.goto(URL); pg.wait_for_function("typeof eng !== 'undefined' && document.querySelector('.scene')"); time.sleep(0.3)
    ev = pg.evaluate
    zone = lambda z: ev(f"(() => {{ const z = eng.zone('{z}'); return {{ scene: z.scene, play: z.play && z.play.pl, step: z.play && z.play.step }}; }})()")

    # ---------- the main window, the MIDI window closed
    check("while the MIDI window is closed, no control tags show", pg.locator(".ftag:visible").count() == 0, pg.locator(".ftag:visible").all_inner_texts())
    look = ev("""(() => { const m = document.querySelector('#app .master input[type=range]'), z = document.querySelector('.zhead input[type=range]');
      return { mapped: !!m.closest('.mslider.mapped'), a: getComputedStyle(m).accentColor, b: getComputedStyle(z).accentColor,
        before: getComputedStyle(m.closest('.mslider'), '::before').content }; })()""")
    check("a slider a MIDI control drives keeps the colour of the others, with no underline", look["mapped"] and look["a"] == look["b"] and look["before"] in ("none", "normal"), look)
    check("it shows a thin yellow line where the fader is", pg.locator("#app .master .fline").is_visible() and ev("getComputedStyle(document.querySelector('#app .master .fline')).width") == "2px")

    # ---------- the MIDI window
    with pg.expect_popup() as pi: pg.click("#btnMidi")
    w = pi.value; watch(w, "window"); w.set_viewport_size({"width": 1280, "height": 860})
    w.wait_for_function("document.querySelectorAll('#colMac .mac').length > 10"); time.sleep(0.4)
    check("with the MIDI window open, the main window shows the tags", ev("document.body.classList.contains('midi-open')") and pg.locator("#app .master .ftag").inner_text() == "CC 28"
          and pg.locator("#btnBlackout .ftag").inner_text() == "Note 36" and pg.locator(".scene", has_text="Groove").locator(".ftag").inner_text() == "Note 37",
          (pg.locator(".ftag:visible").all_inner_texts()))
    check("the mapping window shows no tags of its own (the wires show the controls)", w.locator(".ftag:visible").count() == 0)
    bars = w.evaluate("""(() => { const c = document.querySelector('#colMac'), s = getComputedStyle(c); return { w: s.scrollbarWidth, col: s.scrollbarColor }; })()""")
    check("the lists have thin scroll bars, hidden until the pointer is over them", bars["w"] == "thin" and "rgba(0, 0, 0, 0)" in bars["col"], bars)
    x, y = centre(w.locator("#colMac")); w.mouse.move(x, y); time.sleep(0.1)
    shown = w.evaluate("getComputedStyle(document.querySelector('#colMac')).scrollbarColor")
    check("over a list its scroll bar shows", shown != bars["col"] and "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)" != shown, shown)
    clipped = w.evaluate("""(() => { const out = []; for (const p of document.querySelectorAll('.pscroll .port')) { const r = p.getBoundingClientRect(), c = p.closest('.pscroll').getBoundingClientRect();
      if (r.height && (r.left < c.left - 0.5 || r.right > c.right + 0.5)) out.push(p.dataset.in || p.dataset.out || p.dataset.alias); } return out; })()""")
    check("no wire dot is cut by its column", not clipped, clipped[:5])
    heads = w.locator(".colh").all_inner_texts()
    check("the three columns have their headings, outside the scrolling lists", [x.lower() for x in heads] == ["midi controls", "macros", "effects"]
          and w.evaluate("[...document.querySelectorAll('.colh')].every(h => !h.closest('.pscroll'))"), heads)
    tall = w.evaluate("[...document.querySelectorAll('#colMac .mac:not(.sub)')].filter(r => r.offsetHeight > 34).map(r => r.dataset.target || r.dataset.mac)")
    check("every macro, the output and each zone fit on one line", not tall, tall)

    # ---------- folds
    c1 = w.locator(".group", has=w.locator('[data-fold="m:color1"]'))
    folded_h = c1.bounding_box()["height"]
    check("the colour macros start folded, on one line", w.locator('[data-target^="m:color1."]').count() == 0 and w.locator('[data-target^="m:color2."]').count() == 0 and folded_h < 36, folded_h)
    check("a wire to a part of a folded colour goes to the colour, dashed", w.locator("#wires path.wire.folded").count() >= 1)
    c1.locator(".fold").click(); time.sleep(0.2)
    names = w.locator('[data-target^="m:color1."] .nm').all_inner_texts()
    check("open, a colour shows its hue, saturation and value", names == ["Hue", "Sat", "Value"] and c1.bounding_box()["height"] > folded_h * 3, names)
    check("the wire now goes to the hue itself", w.evaluate("!!document.querySelector('#wires path.wire.ctl:not(.folded)')") and w.locator('[data-in="m:color1.0"]').count() == 1)
    c1.locator(".seg button", has_text="RGB").click(); time.sleep(0.3)
    check("RGB gives it red, green and blue", w.locator('[data-target^="m:color1."] .nm').all_inner_texts() == ["Red", "Green", "Blue"] and ev("eng.macros.color1.mode") == "rgb")
    c1.locator(".seg button", has_text="HSV").click(); time.sleep(0.2)
    c1.locator(".fold").click(); time.sleep(0.2)
    check("folded again it takes one line", w.locator('[data-target^="m:color1."]').count() == 0 and c1.bounding_box()["height"] == folded_h)
    zb = w.locator('.group', has=w.locator('[data-fold="zone:z2"]'))
    check("the zones start folded to their level", w.locator('[data-target^="sc:"]').count() == 0 and zb.locator('input[type=range]').count() == 1)
    zb.locator(".fold").click(); time.sleep(0.2)
    rows = zb.locator(".mac.sub .nm").all_inner_texts()
    check("open, a zone lists its scenes, Next scene and its playlist", rows == ["Groove", "Chill", "Peak", "Next scene", "Party"], rows)

    # ---------- scenes and playlists from pads
    def pad(i, down=True, up=True):
        x, y = centre(w.locator(".vpad").nth(i)); w.mouse.move(x, y)
        if down: w.mouse.down()
        if up: w.mouse.up()
        time.sleep(0.25)
    ev("eng.recall('z2', 1)"); time.sleep(0.1)
    pad(2)
    check("a note on (pad 3) plays the scene it is wired to", zone("z2")["scene"] == 2 and pg.locator(".zoneblock", has_text="Bar").locator(".scene.live").inner_text().startswith("Peak"), zone("z2"))
    pad(1)
    check("another pad, another scene; the window shows it playing", zone("z2")["scene"] == 0 and zb.locator(".btn.live").inner_text() == "Playing")
    pad(1, up=False); s1 = zone("z2")["scene"]; pad(1, down=False)
    check("a note off does nothing to a scene", s1 == 0 and zone("z2")["scene"] == 0)
    pad(3)
    check("a pad plays a playlist (toggle) and the main window's playlist button shows it", zone("z1")["play"] == 0 and pg.locator(".zoneblock", has_text="Façade").locator(".plbtn.playing").count() == 1, zone("z1"))
    pad(3)
    check("pressed again it stops", zone("z1")["play"] is None and pg.locator(".plbtn.playing").count() == 0)
    ev("eng.set('pl:z2:1', 1)"); ev("eng.tick(6.05)"); time.sleep(0.15)
    check("a playlist moves on to its next step's scene", zone("z2")["step"] == 1 and zone("z2")["scene"] == 2, zone("z2"))
    pad(1)
    check("a scene played by a pad stops the zone's playlist", zone("z2")["play"] is None and zone("z2")["scene"] == 0, zone("z2"))
    w.keyboard.press("3"); time.sleep(0.25)
    check("keys 1 to 8 play the pads", zone("z2")["scene"] == 2)

    # ---------- the wire popover
    def pick(to):
        wid = ev(f"eng.wires.find(w => w.to === '{to}').id")
        w.evaluate(f"document.querySelector('#wires path.hit[data-wid=\"w:{wid}\"]').dispatchEvent(new MouseEvent('click', {{ bubbles: true }}))"); time.sleep(0.2)
        return wid
    wid = pick("pl:z1:1")
    pop = w.locator("#wpop")
    check("clicking a wire to a playlist shows it, with Toggle and Hold", pop.is_visible() and "Note 39" in pop.inner_text() and "Façade · Evening" in pop.inner_text()
          and pop.locator(".seg button.on").inner_text() == "Toggle", pop.inner_text() if pop.is_visible() else "hidden")
    pop.locator(".seg button", has_text="Hold").click(); time.sleep(0.25)
    pad(3, up=False); held = zone("z1")["play"]; pad(3, down=False)
    check("with Hold, the playlist plays while the pad is held", ev(f"eng.wires.find(w => w.id === '{wid}').mode") == "hold" and held == 0 and zone("z1")["play"] is None, (held, zone("z1")))
    wid = pick("sc:z2:1")
    check("a wire to a scene says a press plays it", pop.is_visible() and "A press plays it" in pop.inner_text())
    wid = pick("m:speed")
    check("a wire to a fader offers Pickup and Jump", pop.is_visible() and pop.locator(".seg button.on").inner_text() == "Pickup" and "CC 21" in pop.inner_text())
    w.evaluate("document.querySelector('#wpop .seg button').dataset.keep = '1'")
    x, y = centre(w.locator(".vf").nth(1).locator(".vtrack")); w.mouse.click(x, y); time.sleep(0.3)
    check("moving a fader leaves the popover as it is (a click on it isn't lost)", pop.is_visible() and w.evaluate("document.querySelector('#wpop .seg button').dataset.keep === '1'"))
    pop.locator(".seg button", has_text="Jump").click(); time.sleep(0.25)
    check("Jump is kept on the wire", ev(f"eng.wires.find(w => w.id === '{wid}').takeover") == "jump" and pop.locator(".seg button.on").inner_text() == "Jump")
    n0 = ev("eng.wires.length"); pop.locator("button", has_text="Remove").click(); time.sleep(0.3)
    check("Remove takes the wire away and closes the popover", ev("eng.wires.length") == n0 - 1 and not ev(f"eng.wires.some(w => w.id === '{wid}')") and pop.is_hidden())
    wid = pick("p:bars:width"); w.keyboard.press("Delete"); time.sleep(0.3)
    check("Delete removes the picked wire", not ev(f"eng.wires.some(w => w.id === '{wid}')"))
    w.keyboard.press("Escape")

    # ---------- learning a pad to a scene, from the main window and from the MIDI window
    w.click("#learn"); time.sleep(0.2)
    pad(4)
    check("learning: a pad pressed waits for what it should play", "Note 40" in w.inner_text("#hint"))
    s0 = zone("z1")["scene"]
    pg.locator(".zoneblock", has_text="Façade").locator(".scene", has_text="Night").click(); time.sleep(0.3)
    check("touching a scene in the main window wires the pad to it (and doesn't play it)", ev("eng.wires.some(w => w.key.endsWith('note:40') && w.to === 'sc:z1:2')") and zone("z1")["scene"] == s0)
    w.locator('.group', has=w.locator('[data-fold="zone:z3"]')).locator(".fold").click(); time.sleep(0.2)
    pad(5); s3 = zone("z3")["scene"]
    w.locator('[data-target="nx:z3"] .btn').click(); time.sleep(0.3)
    check("touching Next scene in the MIDI window wires the pad to it (and doesn't play it)", ev("eng.wires.some(w => w.key.endsWith('note:41') && w.to === 'nx:z3')") and zone("z3")["scene"] == s3)
    pad(6)
    pg.locator(".zoneblock", has_text="Stage").locator(".plbtn").click(); time.sleep(0.3)
    check("touching a playlist button wires the pad to it", ev("eng.wires.some(w => w.key.endsWith('note:42') && w.to === 'pl:z3:1')") and zone("z3")["play"] is None)
    w.click("#learn"); time.sleep(0.2)
    pad(4)
    check("the learnt pad plays its scene", zone("z1")["scene"] == 1)
    pad(5)
    check("the learnt pad plays the next scene", zone("z3")["scene"] == (s3 + 1) % 3)
    pad(6)
    check("the learnt pad plays the playlist", zone("z3")["play"] == 0); pad(6)
    check("while the window is open, the learnt scene shows its tag", pg.locator(".zoneblock", has_text="Façade").locator(".scene", has_text="Night").locator(".ftag").inner_text() == "Note 40")

    # ---------- a macro picked keeps its wires drawn while the effects scroll
    links = lambda m: w.locator(f'#wires path.hit[data-wid^="l:{m}|"]').count()
    fan = ev("eng.effects().reduce((n, s) => n + eng.params(s).filter(p => eng.macrosOf(p).includes('speed')).length, 0)")
    w.locator("#colMac").evaluate("e => e.scrollTop = 0"); w.mouse.move(5, 5); time.sleep(0.2)
    check("a macro's wires to the effects don't show until it is pointed at", links("speed") == 0)
    w.locator('.mac[data-mac="speed"] .nm').click(); w.mouse.move(5, 5); time.sleep(0.2)
    check("clicked, a macro is picked and all its wires show", w.locator('.mac[data-mac="speed"].picked').count() == 1 and links("speed") == fan and fan > 5
          and w.locator(".par.lit").count() == fan, (links("speed"), fan))
    w.locator("#colFx").evaluate("e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')); }"); time.sleep(0.2)
    check("scrolling the effects, its wires stay drawn", links("speed") == fan and w.evaluate("document.querySelector('#colFx').scrollTop") > 200)
    x, y = centre(w.locator("#colFx")); w.mouse.move(x, y); w.mouse.wheel(0, -400); time.sleep(0.3); w.mouse.move(5, 5); time.sleep(0.1)
    check("and with the wheel too", links("speed") == fan)
    w.locator('.mac[data-mac="angle"] .nm').click(); w.mouse.move(5, 5); time.sleep(0.2)
    check("clicking another macro picks that one", links("angle") > 0 and links("speed") == 0 and w.locator(".mac.picked").count() == 1)
    w.locator('.mac[data-mac="angle"] .nm').click(); w.mouse.move(5, 5); time.sleep(0.2)
    check("clicked again, it lets go", links("angle") == 0 and w.locator(".mac.picked").count() == 0)
    w.locator('.mac[data-mac="speed"] .nm').click(); w.keyboard.press("Escape"); w.mouse.move(5, 5); time.sleep(0.2)
    check("Esc lets go too", links("speed") == 0)
    s0 = ev("eng.macros.speed.v"); x, y = centre(w.locator('.mac[data-mac="speed"] input[type=range]')); w.mouse.click(x + 20, y); time.sleep(0.2)
    check("moving its slider doesn't pick it", w.locator(".mac.picked").count() == 0 and ev("eng.macros.speed.v") != s0)

    # ---------- the monitor folds
    pw0 = w.locator("#patch").bounding_box()["width"]
    w.click("#monFold"); time.sleep(0.3)
    check("the monitor folds to a thin strip and the patch bay takes the room", w.locator("#monitor").bounding_box()["width"] < 40 and w.locator("#mon").is_hidden()
          and w.locator("#patch").bounding_box()["width"] > pw0 + 150, (w.locator("#monitor").bounding_box()["width"], pw0, w.locator("#patch").bounding_box()["width"]))
    m0 = w.inner_text("#monMeta"); pad(7); pad(7)
    check("folded, it still counts the messages", int(w.inner_text("#monMeta") or 0) == int(m0 or 0) + 4, (m0, w.inner_text("#monMeta")))
    w.locator("#monitor").click(); time.sleep(0.3)
    check("clicking the strip opens it again", w.locator("#mon").is_visible() and w.locator("#monitor").bounding_box()["width"] > 150 and "Note on 43" in w.inner_text("#mon"))

    # ---------- the order of the controls
    def order(): return ev("[...eng.controls.keys()].map(k => k.split(':').slice(-2).join(' '))")
    def drag_ctl(key, y_to):
        w.locator(f'.ctl[data-key$="{key}"]').scroll_into_view_if_needed()
        x, y = centre(w.locator(f'.ctl[data-key$="{key}"] .pillk'))
        w.mouse.move(x, y); w.mouse.down(); w.mouse.move(x, y + (8 if y_to() > y else -8), steps=2); w.mouse.move(x, y_to(), steps=8); time.sleep(0.15)
        line = w.locator(".dropline").is_visible(); w.mouse.up(); time.sleep(0.35); return line
    w.locator("#colCtl").evaluate("e => e.scrollTop = 0")
    o0, n0 = order(), ev("eng.wires.length")
    line = drag_ctl("cc:28", lambda: w.locator('.ctl[data-key$="cc:21"]').bounding_box()["y"] + 4)
    o1 = order()
    check("dragging a control up puts it there, with a line showing where", line and o1[0] == "cc 28" and o1[1:] == [k for k in o0 if k != "cc 28"], (o0, o1))
    check("the list follows, and its wires stay", w.locator("div.ctl").first.get_attribute("data-key").endswith("cc:28") and ev("eng.wires.length") == n0
          and w.locator('#wires path.hit[data-wid^="w:"]').count() >= 1)
    line = drag_ctl("cc:28", lambda: w.locator('.ctl[data-key$="note:36"]').bounding_box()["y"] + w.locator('.ctl[data-key$="note:36"]').bounding_box()["height"] - 4)
    o2 = order()
    check("dragging it down puts it below", o2.index("cc 28") == o2.index("note 36") + 1, o2)
    x, y = centre(w.locator('.ctl[data-key$="cc:22"] .pillk')); w.mouse.move(x, y); w.mouse.down(); w.mouse.up(); time.sleep(0.2)
    check("a click on a control doesn't move it", order() == o2)
    x, y = centre(w.locator('.ctl[data-key$="cc:22"] .port.out')); w.mouse.move(x, y); w.mouse.down(); w.mouse.move(x, y + 120, steps=5); w.mouse.up(); time.sleep(0.2)
    check("dragging from its dot draws a wire instead of moving it", order() == o2)

    # ---------- dragging wires
    x, y = centre(w.locator(".vf").nth(4).locator(".vtrack")); w.mouse.click(x, y); time.sleep(0.3)
    a = w.locator('.ctl[data-key$="cc:25"] .port.out'); b = w.locator('.mac[data-mac="angle"] .port.in')
    a.scroll_into_view_if_needed(); b.scroll_into_view_if_needed(); time.sleep(0.1)
    ax, ay = centre(a); bx, by = centre(b)
    w.mouse.move(ax, ay); w.mouse.down(); w.mouse.move((ax + bx) / 2, (ay + by) / 2, steps=4); w.mouse.move(bx, by, steps=4); w.mouse.up(); time.sleep(0.3)
    check("a wire dragged from a control to a macro joins them", ev("eng.wires.some(w => w.key.endsWith('cc:25') && w.to === 'm:angle')"), ((ax, ay), (bx, by), ev("eng.wires.map(w => w.key.slice(-6) + '>' + w.to)")))
    b = w.locator('[data-alias="m:color2"]'); b.scroll_into_view_if_needed(); time.sleep(0.1)
    n0 = ev("eng.wires.length"); ax, ay = centre(a); bx, by = centre(b)
    w.mouse.move(ax, ay); w.mouse.down(); w.mouse.move(bx, by, steps=6); w.mouse.up(); time.sleep(0.3)
    check("dropped on a folded colour, it opens it and waits for a part", ev("eng.wires.length") == n0 and w.locator('[data-target^="m:color2."]').count() == 3)

    # ---------- pickup on the main window's sliders
    ev("eng.set('master', 1)"); time.sleep(0.1)
    t8 = w.locator(".vf").nth(7).locator(".vtrack"); x, y = centre(t8); w.mouse.click(x, y); time.sleep(0.35)
    line = pg.locator("#app .master .fline")
    check("with pickup, a fader away from the slider moves only its line (faint)", ev("eng.master") == 1 and "away" in line.get_attribute("class") and line.is_visible())
    b8 = t8.bounding_box(); w.mouse.click(x, b8["y"] + 2); time.sleep(0.35)
    w.mouse.click(x, y); time.sleep(0.35)
    check("once it reaches the slider, the slider follows it", 0.4 < ev("eng.master") < 0.6 and "away" not in line.get_attribute("class"), ev("eng.master"))

    # ---------- closing the window hides the tags; the floating window; the window on its own
    w.close(); time.sleep(1.2)
    check("closed again, the tags hide", not ev("document.body.classList.contains('midi-open')") and pg.locator(".ftag:visible").count() == 0)
    ev("openFloating(); syncTop()")
    fr = pg.frame_locator(".fwin iframe")
    fr.locator("#colMac .mac").first.wait_for(timeout=5000); time.sleep(0.4)
    check("the floating window works off the main window's engine", fr.locator("div.ctl").count() == ev("eng.controls.size") and ev("document.body.classList.contains('midi-open')"),
          (fr.locator("div.ctl").count(), ev("eng.controls.size"), ev("document.body.className")))
    solo = ctx.new_page(); watch(solo, "on its own")
    solo.goto("file://" + os.path.join(MOCK, "midi-window.html")); solo.wait_for_function("document.querySelectorAll('#colMac .mac').length > 10"); time.sleep(0.3)
    x, y = centre(solo.locator(".vpad").nth(2)); solo.mouse.click(x, y); time.sleep(0.3)
    check("opened on its own, the MIDI window runs its own engine", solo.locator('.ctl[data-key$="note:38"].hit, .ctl[data-key$="note:38"]').count() == 1 and "Note on 38" in solo.inner_text("#mon"))

    real = [e for e in errs if "fonts" not in e]
    check("no errors on the pages", not real, real[:3])
    br.close()
print("FAILED: " + (", ".join(fails) if fails else "none"))
