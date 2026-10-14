# MIDI in (midi.js, ui-midi.js), with a MIDI controller simulated in the page (Web MIDI replaced by a fake one):
# MIDI asked for only once it is turned on; the MIDI window (its own, big; it closes with the page); controllers
# plugged in and out; learn in either order, from the MIDI window and the main window's
# top bar and the Scenes panel, without moving or playing what is touched; master and zone levels with pickup and
# jump; blackout and playlists as toggles or held; scenes and the next scene on a press; ports switched off; the same
# controller under another port name; mappings saved, undone, removed, missing; the line and the tags; refused and
# missing Web MIDI; a burst of messages.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8182
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

# A Web MIDI stand-in: __midi.plug(name), unplug(name), send(name, bytes); asked counts requestMIDIAccess calls
FAKE = """(() => {
  const inputs = new Map(), access = { inputs, outputs: new Map(), onstatechange: null, sysexEnabled: false };
  const fire = p => { if (access.onstatechange) access.onstatechange({ port: p }); };
  const saved = JSON.parse(sessionStorage.getItem('fakeMidi') || '{}');
  window.__midi = {
    asked: 0, refuse: !!saved.refuse,
    plug(name) { const p = { id: name, name, state: 'connected', type: 'input', onmidimessage: null }; inputs.set(name, p); fire(p); },
    unplug(name) { const p = inputs.get(name); if (!p) return; p.state = 'disconnected'; inputs.delete(name); fire(p); },
    send(name, bytes) { const p = inputs.get(name); if (p && p.onmidimessage) p.onmidimessage({ data: new Uint8Array(bytes) }); },
  };
  for (const n of saved.ports || []) window.__midi.plug(n);
  if (saved.none) { Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined }); return; }
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: () => { window.__midi.asked++; return window.__midi.refuse ? Promise.reject(new Error('refused')) : Promise.resolve(access); } });
})();"""
K = "nanoKONTROL2"

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); ctx = br.new_context(viewport={"width": 1600, "height": 950})
    ctx.add_init_script(FAKE)
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    ev = pg.evaluate
    def boot(fake=None):
        if pg.url == "about:blank": pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm")
        if fake is not None: ev(f"sessionStorage.setItem('fakeMidi', JSON.stringify({fake}))")
        pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    def send(*b, port=K): ev(f"__midi.send({port!r}, {list(b)})"); time.sleep(0.05)
    cc = lambda n, v, port=K: send(0xB0, n, v, port=port)
    on = lambda n, port=K: send(0x90, n, 100, port=port)
    off = lambda n, port=K: send(0x80, n, 0, port=port)
    def tap(n, port=K): on(n, port); off(n, port)
    maps = lambda: ev("project.midi.maps.map(w => w.key.split(':').slice(-2).join(' ') + ' > ' + w.to.split(':')[0])")
    def settle(t=0.25): time.sleep(t)
    def dock(tab): ev(f"ui.dockTab = '{tab}'; ui.dockCollapsed = false; renderDock()"); settle(0.2)
    # the MIDI window: opened by the MIDI button (or brought to the front)
    def window():
        with pg.expect_popup() as pi: pg.click("#btnMidi")
        w = pi.value; w.on("pageerror", lambda e: errs.append("MIDI window: " + str(e))); w.set_viewport_size({"width": 1180, "height": 760}); settle(0.5)
        return w

    # ---------- MIDI off until asked for
    boot("{ ports: ['nanoKONTROL2'] }")
    check("MIDI is not asked for until it is turned on", ev("__midi.asked") == 0 and ev("midi.status") == "off" and not ev("ui.midiOn"))
    W = window()
    check("the MIDI button opens the MIDI window, big, and turns MIDI on", ev("__midi.asked") == 1 and ev("midi.status") == "ok" and ev("ui.midiOn")
          and pg.locator("#btnMidi.on").count() == 1 and W.title() == "MIDI · openLedMapper" and W.locator(".midipanel .mmaps").count() == 1
          and W.locator(".mwhead .btn.learn").is_visible(), W.title())
    check("it has the app's look", W.evaluate("getComputedStyle(document.body).backgroundColor") == ev("getComputedStyle(document.body).backgroundColor"))
    check("the bottom panel keeps its tabs", "MIDI" not in pg.inner_text("#dockTabs"))
    check("the controller plugged in is listed", W.locator(".mport .nm").all_inner_texts() == [K], W.locator(".mport .nm").all_inner_texts())
    ev("__midi.plug('Launchpad')"); settle()
    check("a controller plugged in later shows", "Launchpad" in " ".join(W.locator(".mport .nm").all_inner_texts()))
    ev("__midi.unplug('Launchpad')"); settle()
    check("and goes when unplugged", "Launchpad" not in " ".join(W.locator(".mport .nm").all_inner_texts()))
    cc(1, 64); settle()
    check("a message blinks the button's light and shows unmapped in the monitor", ev("midi.log[0].text") == "CC 1 · ch1" and ev("midi.log[0].note") == "not mapped")

    # ---------- learn: control first, then what it drives
    ev("project.settings.master = 1; $('#master').value = 1")
    W.click(".btn.learn"); settle()
    check("Learn shows the bar that says what to do, and outlines what MIDI can drive", pg.locator("#midiLearnBar").is_visible() and ev("document.body.classList.contains('midi-learning')")
          and pg.locator("#btnMidi.learning").count() == 1)
    cc(7, 10); settle()
    check("a control moved while learning waits for its target", ev("midi.learn.pending").endswith("cc:7") and "CC 7" in pg.inner_text("#midiLearnBar") and "CC 7" in W.inner_text(".mwhint"))
    pg.locator(".master .mslot").click(); settle()
    check("clicking the master wires it, and doesn't move the master", maps() == ["cc 7 > master"] and ev("project.settings.master") == 1, (maps(), ev("project.settings.master")))
    check("learning goes on for the next one", ev("midi.learn.on") and ev("midi.learn.pending") is None)
    # what it drives first, then the control
    pg.click("#btnBlackout"); settle()
    check("clicking Blackout while learning picks it, without blacking out", ev("midi.learn.target") == "blackout" and not ev("ui.blackout") and pg.locator("#btnBlackout.midi-pick").count() == 1)
    on(36); off(36); settle()
    check("then a pad wires to it", "note 36 > blackout" in maps() and not ev("ui.blackout"), maps())
    # the Scenes panel: a scene, a playlist, a zone's level
    dock("scenes")
    z = ev("(() => { const z = project.zones.find(z => z.scenes.length >= 3); return { id: z.id, scenes: z.scenes.map(s => s.id), scene: z.scene, op: z.opacity }; })()")
    tiles = pg.locator(f'.scene[data-zone="{z["id"]}"]')
    on(37); off(37); tiles.nth(2).click(); settle()
    check("a pad and a scene", "note 37 > sc" in maps() and ev(f"zoneById('{z['id']}').scene") == z["scene"], maps())
    cc(8, 50); pg.locator(f'.zhead .mslot[data-midi="z:{z["id"]}"]').click(); settle()
    check("a knob and a zone's level, which stays where it was", "cc 8 > z" in maps() and ev(f"zoneById('{z['id']}').opacity") == z["op"], (maps(), ev(f"zoneById('{z['id']}').opacity")))
    if not ev(f"zoneById('{z['id']}').playlists.length"):
        ev(f"(() => {{ const z = zoneById('{z['id']}'); addPlaylist(z, {{ name: 'Show', steps: z.scenes.slice(0, 2).map(s => newStep(s.id, 5)) }}); }})()"); dock("scenes")
    on(38); off(38); pg.locator(f'.zoneblock[data-zone="{z["id"]}"] .ptab[data-midi]').first.click(); settle()
    check("a pad and a playlist, which doesn't start", "note 38 > pl" in maps() and not ev(f"!!zoneById('{z['id']}')._play"), maps())
    # a button that sends CC 127 when pressed and CC 0 when released: once learnt, its release doesn't start it again
    n0 = len(maps())
    cc(10, 127); tiles.nth(0).click(); cc(10, 0); settle()
    tiles.nth(1).click(); settle()
    check("a CC button learnt, then released: the next scene clicked waits for a new control", len(maps()) == n0 + 1 and ev("midi.learn.pending") is None
          and ev("midi.learn.target") == f"sc:{z['id']}:{z['scenes'][1]}", (maps(), ev("midi.learn")))
    cc(11, 127); cc(11, 0); settle()
    check("the next button goes to it, and is released too", len(maps()) == n0 + 2 and ev("project.midi.maps.some(w => w.key.endsWith('cc:11') && w.to.endsWith(':" + z['scenes'][1] + "'))")
          and ev("midi.learn.pending") is None and ev("midi.learn.target") is None, (maps(), ev("midi.learn")))
    tiles.nth(3).click(); cc(12, 127); settle(0.1); cc(12, 0); settle(); tiles.nth(0).click(); settle()
    check("the other way round too: scene, button, release, and the next scene waits", len(maps()) == n0 + 3 and ev("midi.learn.target") == f"sc:{z['id']}:{z['scenes'][0]}", ev("midi.learn"))
    tiles.nth(0).click(); settle()
    for v in range(0, 128, 8): cc(13, v)
    tiles.nth(1).click(); settle()
    for v in range(0, 128, 8): cc(13, 127 - v)
    settle(); tiles.nth(2).click(); settle()
    check("a fader learnt while it moves: the rest of its move doesn't learn it again", ev("midi.learn.pending") is None
          and ev("midi.learn.target") == f"sc:{z['id']}:{z['scenes'][2]}", ev("midi.learn"))
    check("learnt onto a scene another control played, it replaces that control", len(maps()) == n0 + 3
          and ev("project.midi.maps.filter(w => w.to === 'sc:" + z['id'] + ":" + z['scenes'][1] + "').map(w => w.key.split(':').pop())") == ["13"], maps())
    tiles.nth(2).click(); time.sleep(1.2); cc(13, 30); settle()
    check("the control just learnt stays done, even after a while", ev("midi.learn.pending") is None and ev("midi.learn.target") is None, ev("midi.learn"))
    other = ev(f"project.zones.find(x => x.id !== '{z['id']}').id")
    pg.locator(f'.zhead .mslot[data-midi="z:{other}"]').click(); cc(13, 40); settle()
    check("clicked first, something else takes the same control", ev(f"project.midi.maps.some(w => w.key.endsWith('cc:13') && w.to === 'z:{other}')") and ev("midi.learn.target") is None, maps())
    ev("project.midi.maps = project.midi.maps.filter(w => !/cc:1[0-3]$/.test(w.key)); commit(); midiSetLearn(true)"); settle()
    check("while learning, the tags show on what is wired", pg.locator(".master .ftag").is_visible() and pg.locator(".master .ftag").inner_text() == "CC 7"
          and tiles.nth(2).locator(".ftag").inner_text() == "Note 37")
    W.keyboard.press("Escape"); settle()
    check("Esc stops learning, in the MIDI window too", not ev("midi.learn.on") and pg.locator("#midiLearnBar").is_hidden() and not ev("document.body.classList.contains('midi-learning')"))
    check("with the MIDI window open the tags show", pg.locator(".master .ftag").is_visible())
    W.close(); settle(1.3)
    check("closed, and not learning, the tags hide", pg.locator(".ftag:visible").count() == 0 and not ev("document.body.classList.contains('midi-open')"))
    W = window()
    look = ev("(() => { const m = document.querySelector('#master'), z = document.querySelector('.zhead input[type=range]'); return [getComputedStyle(m).accentColor, getComputedStyle(z).accentColor, !!m.closest('.midi-mapped')]; })()")
    check("a slider MIDI drives keeps its colour", look[0] == look[1] and look[2], look)

    # ---------- master: pickup and jump
    cc(7, 20); settle()
    line = pg.locator(".master .fline")
    check("with pickup, a fader away from the master doesn't move it: a faint line shows where it is", ev("project.settings.master") == 1 and line.is_visible() and "away" in (line.get_attribute("class") or ""))
    cc(7, 127); cc(7, 64); settle()
    check("once it reaches the master, the master follows it", abs(ev("project.settings.master") - 64 / 127) < 1e-6 and abs(float(ev("$('#master').value")) - 64 / 127) < 0.01
          and "away" not in (line.get_attribute("class") or ""), ev("project.settings.master"))
    pg.locator("#master").fill("0.9"); ev("$('#master').dispatchEvent(new Event('input', { bubbles: true }))"); settle()
    cc(7, 70); settle()
    check("moved with the mouse since, it has to be picked up again", abs(ev("project.settings.master") - 0.9) < 1e-6, ev("project.settings.master"))
    cc(7, 120); cc(7, 100); settle()
    check("and follows once picked up", abs(ev("project.settings.master") - 100 / 127) < 1e-6)
    ev("midiSetMap(project.midi.maps.find(w => w.to === 'master').id, { takeover: 'jump' })"); cc(7, 10); settle()
    check("with Jump it goes where the fader is at once", abs(ev("project.settings.master") - 10 / 127) < 1e-6)
    cc(7, 127); settle()

    # ---------- zone level
    cc(8, int(z["op"] * 127)); cc(8, 30); settle()
    check("a knob on a zone's level moves it and every slider for it", abs(ev(f"zoneById('{z['id']}').opacity") - 30 / 127) < 1e-6
          and abs(float(ev(f"document.querySelector('[data-zone-op=\"{z['id']}\"]').value")) - 30 / 127) < 0.01)
    cc(8, 127); settle()

    # ---------- blackout
    tap(36); settle()
    check("a pad turns blackout on", ev("ui.blackout") and pg.locator("#btnBlackout.on").count() == 1)
    tap(36); settle()
    check("and off", not ev("ui.blackout"))
    ev("midiSetMap(project.midi.maps.find(w => w.to === 'blackout').id, { mode: 'hold' })")
    on(36); settle(0.1); held = ev("ui.blackout"); off(36); settle(0.1)
    check("with Hold, blackout is on while the pad is held", held and not ev("ui.blackout"))

    # ---------- scenes
    tap(37); settle(0.3)
    check("a pad plays its scene", ev(f"zoneById('{z['id']}').scene") == z["scenes"][2])
    ev(f"goScene(zoneById('{z['id']}'), zoneById('{z['id']}').scenes[0], true)"); settle()
    on(37); settle(0.2)
    check("a note on plays it, a note off doesn't matter", ev(f"zoneById('{z['id']}').scene") == z["scenes"][2]); off(37)
    row = W.locator(".mmap", has=W.locator(".mk", has_text="Note 37"))
    zname = ev(f"zoneById('{z['id']}').name")
    row.locator("select.mtarget").select_option(label=f"{zname} · next scene"); settle()
    check("the list of a mapping changes what it drives: the next scene", ev("project.midi.maps.some(w => w.key.endsWith('note:37') && w.to.startsWith('nx:'))"), maps())
    ids = ev(f"zoneById('{z['id']}').scenes.map(s => s.id)"); i0 = ids.index(ev(f"zoneById('{z['id']}').scene"))
    tap(37); settle(0.3); s1 = ev(f"zoneById('{z['id']}').scene"); tap(37); settle(0.3); s2 = ev(f"zoneById('{z['id']}').scene")
    check("a pad plays the next scene each time, back to the first after the last", s1 == ids[(i0 + 1) % len(ids)] and s2 == ids[(i0 + 2) % len(ids)], (i0, s1, s2, ids))

    # ---------- playlists
    tap(38); settle(0.3)
    check("a pad plays a playlist", ev(f"(() => {{ const z = zoneById('{z['id']}'); return !!z._play && z._play.on; }})()"))
    tap(38); settle(0.3)
    check("and pauses it", ev(f"(() => {{ const z = zoneById('{z['id']}'); return !!z._play && !z._play.on; }})()"))
    send(0xB0, 9, 127); send(0xB0, 9, 0)
    ev("(() => { const w = project.midi.maps.find(w => w.to.startsWith('pl:')); midiSetMap(w.id, { key: w.key.replace(/note:38$/, 'cc:9') }); })()")
    send(0xB0, 9, 127); settle(0.2); a = ev(f"zoneById('{z['id']}')._play.on"); send(0xB0, 9, 0); send(0xB0, 9, 127); settle(0.2); b = ev(f"zoneById('{z['id']}')._play.on")
    check("a button sending CC 127 and 0 works like a pad", a and not b, (a, b))

    # ---------- the MIDI tab
    check("the MIDI window lists the mappings", W.locator(".mmap").count() == len(maps()) and W.locator(".mmap select.mtarget").first.evaluate("s => s.selectedOptions[0].textContent") == "Master")
    W.locator(".mfold").click(); settle()
    cc(7, 127); settle()
    check("the monitor shows each message and what it moves", "CC 7 · ch1" in W.inner_text("#midiMon") and "→ Master" in W.inner_text("#midiMon"))
    ev("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })")
    cc(7, 100); settle(0.4)
    check("with the main window in the background, the MIDI window still follows", "100" in W.inner_text("#midiMon .mrow .v"))
    ev("delete document.hidden")

    # ---------- ports
    ev(f"ui.midiOff = ['{K}']; updateMidiUI()"); m0 = ev("project.settings.master"); cc(7, 127); cc(7, 5); settle()
    check("a port switched off is ignored", ev("project.settings.master") == m0 and ev("midi.log[0].note") == "port off")
    ev("ui.midiOff = []; updateMidiUI()")
    ev(f"__midi.unplug('{K}'); __midi.plug('nanoKONTROL2 (Windows)')"); settle()
    cc(7, 127, port="nanoKONTROL2 (Windows)"); cc(7, 40, port="nanoKONTROL2 (Windows)"); settle()
    check("the same controller under another name works while the one it was learnt on is unplugged", abs(ev("project.settings.master") - 40 / 127) < 1e-6)
    check("the controller it was learnt on shows as not plugged in", "not plugged in" in W.inner_text(".mports"))
    ev(f"__midi.plug('{K}')"); settle(); cc(7, 90, port="nanoKONTROL2 (Windows)"); settle()
    check("but not while it is plugged in", abs(ev("project.settings.master") - 40 / 127) < 1e-6)
    ev("__midi.unplug('nanoKONTROL2 (Windows)')"); cc(7, 127); settle()

    # ---------- saved, undone, removed, missing
    saved = ev("JSON.parse(serialize()).midi.maps")
    check("the mappings are saved in the project, without their working state", len(saved) == len(maps()) and all(set(w) == {"id", "key", "to", "takeover", "mode"} for w in saved), saved[:1])
    n0 = len(maps()); W.locator(".mmap .x").first.click(); settle()
    check("× removes a mapping", len(maps()) == n0 - 1)
    ev("undo()"); settle()
    check("undo brings it back", len(maps()) == n0)
    ev(f"(() => {{ const z = zoneById('{z['id']}'); z.scenes.splice(2, 1); commit(); }})()"); ev("midiSetMap(project.midi.maps.find(w => w.key.endsWith('note:37')).id, { to: 'sc:" + z["id"] + ":" + z["scenes"][2] + "' })"); settle()
    check("a mapping to a deleted scene shows as missing", W.locator(".mmap.missing").count() == 1 and "Missing" in W.locator(".mmap.missing select").evaluate("s => s.selectedOptions[0].textContent"))
    tap(37); settle()
    check("and does nothing", not errs, errs[:2])
    kept = ev("serialize()")
    ev("""loadProject(Object.assign(JSON.parse(serialize()), { midi: { maps: [{ key: 'midi:x:1:cc:1', to: 'master', takeover: 'nope', mode: 3 }, { key: 'bad', to: 'master' }, { key: 'midi:x:1:note:2' }, 'x'] } }))"""); settle()
    check("a file's mappings are repaired: bad ones go, the rest get their defaults", ev("project.midi.maps.map(w => [w.key, w.to, w.takeover, w.mode, typeof w.id])") == [["midi:x:1:cc:1", "master", "pickup", "toggle", "string"]])
    pg.evaluate("s => { loadProject(JSON.parse(s)); saveSoon(); }", kept); settle(1.2)

    # ---------- after a reload
    boot("{ ports: ['nanoKONTROL2'] }"); settle(0.5)
    check("the MIDI window closes with the page", W.is_closed())
    check("after a reload MIDI is on again and the mappings are there", ev("__midi.asked") == 1 and ev("midi.status") == "ok" and len(maps()) >= 4, maps())
    m = ev("project.settings.master"); cc(7, int(m * 127)); cc(7, 50); settle()
    check("and they work", abs(ev("project.settings.master") - 50 / 127) < 1e-6)
    t0 = time.time()
    ev("(() => { for (let i = 0; i < 2000; i++) __midi.send('nanoKONTROL2', [0xB0, 7, i % 128]); })()"); settle(0.5)
    check("2000 messages in a burst: the last one wins, no errors", abs(ev("project.settings.master") - (1999 % 128) / 127) < 1e-6 and not errs and time.time() - t0 < 5, time.time() - t0)
    W = window(); W.click(".mwhead button:text('Turn off')"); settle()
    check("turned off, the MIDI window offers to turn it on again", W.locator(".midipanel.off button", has_text="Turn MIDI on").count() == 1)
    m = ev("project.settings.master"); cc(7, 0); cc(7, 127); settle()
    check("turned off, MIDI is ignored and stays off after a reload", ev("project.settings.master") == m and not ev("ui.midiOn"))
    boot()
    check("(it isn't asked for)", ev("__midi.asked") == 0 and ev("midi.status") == "off")

    # ---------- refused, missing
    boot("{ ports: ['nanoKONTROL2'], refuse: true }"); W = window(); settle(0.3)
    check("MIDI refused by the browser says how to allow it", ev("midi.status") == "blocked" and "refused" in W.inner_text(".mports") and pg.locator("#btnMidi.warn").count() == 1)
    ev("setMidiOn(false)"); boot("{ none: true }"); W = window(); settle(0.3)
    check("a browser without MIDI says so", ev("midi.status") == "none" and "no MIDI" in W.inner_text(".mports"))
    ev("setMidiOn(false)")
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
  bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
