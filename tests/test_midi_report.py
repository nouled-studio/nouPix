# The findings of a MIDI test session (v1.2.1, the desktop app on Windows) and their fixes: the MIDI window brought to
# the front again (the app restores it, also from minimised: #raise); the list and the bay keeping where they were
# scrolled when a message or a change draws them again; an effect's control in the patch bay showing where its macro
# takes it; Ctrl+S writing the file the project came from or went to (the app: by its path, through the bridge); a
# colour macro's swatch following its hue; the control just learnt playing while learning goes on; learning a control
# onto one more target (Alt: instead); a group's arrow opening it while learning; a colour's row learnt as its first
# part; the mark a fader on Pickup has to reach; a pad on a fader (Toggle or Hold); a mapping removed (undo says so);
# a pad's bar going down when let go.
import os, sys, time, json, tempfile, http.client
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, FAKE_MIDI
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8222
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
def wait(fn, t=4.0):
    end = time.time() + t
    while time.time() < end:
        v = fn()
        if v: return v
        time.sleep(0.1)
    return fn()
K = "nanoKONTROL2"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()

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
    on = lambda n, v=100: send(0x90, n, v)
    off = lambda n: send(0x80, n, 0)
    # the demo, its first zone playing Rainbow (its Angle follows the Angle macro), and 30 mappings: a list that scrolls
    ev("""(() => { olm.loadProject(demoProject()); const z = project.zones.find(z => z.scenes.length > 2); window.__z = z.id;
      project.zones[0].layers[0].src = 'b-rainbow';
      const m = (k, t) => newMidiMap('midi:nanoKONTROL2:1:' + k, t);
      project.midi.maps = [m('cc:1', 'master'), m('note:36', 'blackout'), m('note:40', 'sc:' + z.id + ':' + z.scenes[1].id)];
      for (let i = 0; i < 30; i++) project.midi.maps.push(m('cc:' + (60 + i), 'm:speed'));
      ui.midiView = 'list'; ui.bayOpen = []; ui.midiVc = false; commit(); })()""")
    Z = ev("__z")
    with pg.expect_popup() as pi: pg.click("#btnMidi")
    W = pi.value; W.set_viewport_size({"width": 1180, "height": 700}); settle(0.6)
    W.on("pageerror", lambda e: errs.append("MIDI window: " + str(e)))

    # ---------- 1. the MIDI window, brought back
    pg.bring_to_front(); settle(0.2)
    pages = len(ctx.pages)
    pg.click("#btnMidi"); settle(0.3)
    check("the MIDI button, with the window open: no second window, and the app is asked to bring it to the front (#raise)",
          len(ctx.pages) == pages and W.evaluate("location.hash").startswith("#raise") and W.locator(".mmaps").count() == 1, (len(ctx.pages), W.evaluate("location.hash")))
    main = open(os.path.join(ROOT, "desktop", "main.js")).read()
    check("the app restores it, also from minimised, and the Window menu has it", "did-navigate-in-page" in main and "isMinimized()) w.restore()" in main and "label: 'MIDI window'" in main)

    # ---------- 2. the list keeps where it was scrolled
    col = W.locator(".mcol.mmaps")
    W.evaluate("document.querySelector('.mcol.mmaps').scrollTop = 10000"); settle(0.2)
    top = W.evaluate("document.querySelector('.mcol.mmaps').scrollTop")
    on(40); off(40); settle(0.4)
    check("a pad pressed: the list stays where it was scrolled", top > 200 and abs(W.evaluate("document.querySelector('.mcol.mmaps').scrollTop") - top) < 2, (top, W.evaluate("document.querySelector('.mcol.mmaps').scrollTop")))
    W.locator(".mmap .x").last.click(); settle(0.4)
    after = W.evaluate("document.querySelector('.mcol.mmaps').scrollTop")
    check("a mapping removed (the list built again): it stays scrolled", after > 150 and abs(after - top) < 60, (top, after))

    # ---------- 12. removing says how to bring it back; Ctrl Z there does
    n = ev("project.midi.maps.length")
    toasts = lambda: " ".join(pg.locator(".toast").all_inner_texts() + W.locator(".toast").all_inner_texts())
    check("removing a mapping says how to bring it back", "Z brings it back" in toasts(), toasts())
    W.keyboard.press("Control+z"); settle(0.4)
    check("and Ctrl Z in the MIDI window does", ev("project.midi.maps.length") == n + 1)
    ev("project.midi.maps = project.midi.maps.filter(w => !w.key.match(/cc:(6\\d|7\\d|8\\d)$/)); commit()"); settle(0.3)

    # ---------- 13. a pad's bar goes down when let go
    bar = lambda: W.evaluate("(() => { const el = [...document.querySelectorAll('.mmap')].find(e => e.textContent.includes('Note 36')); return el.querySelector('.cbar').style.width; })()")
    on(36); settle(0.15); held = bar()
    off(36); settle(0.15)
    check("a pad's bar is full while held and empty once let go", held == "100%" and bar() in ("0%", "0px", "0"), (held, bar()))
    if ev("ui.blackout"): on(36); off(36)

    # ---------- 6. the control just learnt plays, learning on
    W.locator(".mwhead .btn.learn").click(); settle(0.2)
    on(37); off(37); settle(0.2)
    pg.click("#btnBlackout"); settle(0.3)
    learnt = ev("project.midi.maps.some(w => w.key.endsWith('note:37') && w.to === 'blackout')")
    on(37); off(37); settle(0.2)
    check("learning: a pad learnt onto Blackout plays it at once, learning still on", learnt and ev("ui.blackout") and ev("midi.learn.on"), (learnt, ev("ui.blackout")))
    on(37); off(37); settle(0.2)
    check("and again, off", not ev("ui.blackout"))
    on(38); off(38); settle(0.2)
    check("another control moved still waits to be learnt", ev("midi.learn.pending") == "midi:nanoKONTROL2:1:note:38" and not ev("ui.blackout"))

    # ---------- 7. learnt onto one more: as well; with Alt: instead
    ev("midiLearnTarget('master')"); settle(0.2)
    on(38); off(38); settle(0.2)
    ev("midiLearnTarget('xf')"); settle(0.2)
    on(38); off(38); settle(0.3)
    both = ev("project.midi.maps.filter(w => w.key.endsWith('note:38')).map(w => w.to).sort()")
    toast = toasts()
    check("learnt onto something else, a control does that as well, and the message says so (and that Alt replaces)", both == ["master", "xf"] and "as well as Master" in toast and "Alt" in toast, (both, toast[-200:]))
    pg.locator("#btnBlackout").click(modifiers=["Alt"]); settle(0.2)
    on(38); off(38); settle(0.3)
    only = ev("project.midi.maps.filter(w => w.key.endsWith('note:38')).map(w => w.to)")
    check("with Alt held on the click, instead: it drives only that", only == ["blackout"], only)

    # ---------- 8. the arrow of a group opens it while learning; 9. a colour's row is learnt as its first part
    W.locator(".mwhead .seg button", has_text="Patch bay").click(); settle(0.6)
    cc(20, 90); settle(0.3)
    check("learning in the bay, a control moved is waiting", ev("midi.learn.pending") == "midi:nanoKONTROL2:1:cc:20")
    W.locator(f'.bgroup[data-g="z:{Z}"] > .bhead .mfold').click(); settle(0.4)
    check("its arrow opens a zone's group, and learns nothing", ev(f"ui.bayOpen.includes('z:{Z}')") and ev("midi.learn.pending") == "midi:nanoKONTROL2:1:cc:20"
          and not ev("project.midi.maps.some(w => w.key.endsWith('cc:20'))"))
    W.locator('.brow[data-t="m:color1"] .nm').click(); settle(0.4)
    check("Color 1's own row learns it, as its first part (Hue)", ev("project.midi.maps.some(w => w.key.endsWith('cc:20') && w.to === 'm:color1.0')"), ev("project.midi.maps.map(w => w.to)"))

    # ---------- 5. its swatch follows the hue moved by MIDI, in place
    W.locator(".mwhead .btn.learn").click(); settle(0.2)
    sw = lambda: W.evaluate("document.querySelector('.bay [data-sw=\"color1\"]').style.background")
    ev("project.midi.maps.find(w => w.key.endsWith('cc:20')).takeover = 'jump'; updateMidiUI()"); settle(0.4)
    s0 = sw(); built = W.evaluate("document.querySelector('.bay [data-sw=\"color1\"]') === (window.__sw = document.querySelector('.bay [data-sw=\"color1\"]'))")
    cc(20, 0); settle(0.2); cc(20, 42); settle(0.4)
    check("Color 1's swatch follows its hue moved by MIDI, in place", sw() != s0 and W.evaluate("document.querySelector('.bay [data-sw=\"color1\"]') === window.__sw"), (s0, sw()))

    # ---------- 3. an effect's control shows where its macro takes it
    W.evaluate("0"); ev("ui.bayOpen = [...ui.bayOpen, 'fx:b-rainbow']; savePrefs(); updateMidiUI()"); settle(0.5)
    mark = lambda: W.evaluate("(() => { const m = document.querySelector('.bay [data-bmod=\"p:b-rainbow:angle\"]'); return m ? [m.hidden, m.style.left, m.title] : null; })()")
    check("Rainbow's Angle has a mark for its macro, hidden while the macro is off", mark() is not None and mark()[0] is True, mark())
    ev("setMacro('angle', { on: true, v: 1 })"); settle(0.4)
    m = mark()
    base = W.evaluate("document.querySelector('.bay input[data-bv=\"p:b-rainbow:angle\"]').value")
    check("with Angle at its top, the mark shows the angle at its end, the slider its own value", m and not m[0] and "Angle: 100 %" in m[2] and float(base) < 0.5, (m, base))
    ev("setMacro('angle', { on: false })"); settle(0.3)

    # ---------- 10. Pickup: the mark the fader has to reach; 11. a pad on a fader
    W.locator(".mwhead .seg button", has_text="List").click(); settle(0.5)
    ev("project.settings.master = 0.6; project.midi.maps.push(newMidiMap('midi:nanoKONTROL2:1:cc:9', 'master'), newMidiMap('midi:nanoKONTROL2:1:note:44', 'z:' + __z)); commit()"); settle(0.4)
    row = lambda key: f"[...document.querySelectorAll('.mmap')].find(e => e.querySelector('.mk').textContent.startsWith('{key}'))"
    pick = lambda: W.evaluate(f"(() => {{ const p = {row('CC 9')}.querySelector('.cpick'); return [p.hidden, p.style.left]; }})()")
    cc(9, 10); settle(0.3)
    check("a fader on Pickup, not there yet: a mark shows where it has to go (60 %)", pick() == [False, "60%"], pick())
    cc(9, 100); settle(0.3)
    check("once it has picked up, the mark goes", pick()[0] is True and abs(ev("project.settings.master") - 100 / 127) < 0.01, (pick(), ev("project.settings.master")))
    how = W.evaluate(f"[...{row('Note 44')}.querySelectorAll('.seg button')].map(b => b.textContent)")
    check("a pad on a zone's level offers Toggle, Hold and Flash, not Pickup and Jump", how == ["Toggle", "Hold", "Flash"], how)
    lvl = lambda: ev(f"zoneById('{Z}').opacity")
    ev(f"setZoneOpacity(zoneById('{Z}'), 0.3)")
    on(44); settle(0.15); a = lvl(); off(44); settle(0.15); b = lvl()
    check("Toggle: a press takes it full, the next one off", a == 1 and b == 1, (a, b))
    on(44); off(44); settle(0.15)
    check("…and off", lvl() == 0)
    W.evaluate(f"[...{row('Note 44')}.querySelectorAll('.seg button')].find(b => b.textContent === 'Hold').click()"); settle(0.3)
    on(44); settle(0.15); a = lvl(); off(44); settle(0.15)
    check("Hold: full while held, off when let go", a == 1 and lvl() == 0, (a, lvl()))

    # ---------- 4. Save writes the file it came from or went to
    path = os.path.join(tmp, "show.noupix")
    ev("p => savedToPath(p)", path); settle(0.3)
    check("a project saved by the app (a download) is named after its file", ev("project.name") == "show")
    pg.bring_to_front(); pg.keyboard.press("Control+s"); settle(0.6)
    check("Ctrl S writes it there, without asking", os.path.exists(path) and json.load(open(path))["name"] == "show" and json.load(open(path))["midi"]["maps"])
    ev("project.zones[0].name = 'Changed'; commit()")
    pg.keyboard.press("Control+s"); settle(0.6)
    check("and again after a change", json.load(open(path))["zones"][0]["name"] == "Changed")
    other = os.path.join(tmp, "other.noupix"); open(other, "w").write(json.dumps(json.load(open(path)) | {"name": "x"}))
    ev("p => openPath(p)", other); settle(0.8)
    ev("project.zones[0].name = 'Other'; commit()"); pg.keyboard.press("Control+s"); settle(0.6)
    check("a project opened by its path is saved back to its file", json.load(open(other))["zones"][0]["name"] == "Other" and json.load(open(path))["zones"][0]["name"] == "Changed")
    def post(body):
        c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5); c.request("POST", "/save-path", body=json.dumps(body)); r = c.getresponse(); r.read(); c.close(); return r.status
    check("the bridge writes only nouPix projects, to a .noupix at a full path in a folder that exists",
          post({"path": os.path.join(tmp, "a.txt"), "project": "{\"fixtures\": []}"}) == 400 and post({"path": "rel.noupix", "project": "{\"fixtures\": []}"}) == 400
          and post({"path": os.path.join(tmp, "nope", "a.noupix"), "project": "{\"fixtures\": []}"}) == 400 and post({"path": os.path.join(tmp, "a.noupix"), "project": "[1]"}) == 400
          and not os.path.exists(os.path.join(tmp, "a.txt")))
    ev("loadProject(blankProject('New')); setProjectFile(null)"); settle(0.3)
    check("a new project forgets the file", ev("projectPath") is None)
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED:", fails or "none")
