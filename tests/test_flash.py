# MIDI Flash: a pad on Flash plays a scene while held (with the scene's own fade) and brings back what played before
# when let go (the scene, the layers as they were, or the playlist carrying on); on a fader it goes full while held
# and back where it was; on something on or off, on while held and back as it was. The MIDI window offers it, files
# keep it.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, FAKE_MIDI
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8226
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); ctx = br.new_context(viewport={"width": 1440, "height": 950}); ctx.add_init_script(FAKE_MIDI); pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    ev("""(() => { const p = blankProject('Flash'); p.fixtures.push(newFixture('line', { x1: 100, y1: 300, x2: 900, y2: 300, pixels: 20 }));
      const z = p.zones[0]; z.layers = [newLayer('b-bars')];
      z.scenes = [{ id: 's1', name: 'Bars', fade: 0, layers: [newLayer('b-bars')] }, { id: 's2', name: 'Strobe', fade: 0.6, layers: [newLayer('b-rainbow')] },
        { id: 's3', name: 'Third', fade: 0, layers: [newLayer('b-bars')] }];
      z.scene = 's1';
      p.midi.maps = [{ id: 'm1', key: 'midi:K:1:note:36', to: 'sc:' + z.id + ':s2', takeover: 'pickup', mode: 'flash' },
        { id: 'm2', key: 'midi:K:1:note:37', to: 'z:' + z.id, takeover: 'pickup', mode: 'flash' },
        { id: 'm3', key: 'midi:K:1:note:38', to: 'blackout', takeover: 'pickup', mode: 'flash' },
        { id: 'm4', key: 'midi:K:1:note:39', to: 'master', takeover: 'pickup', mode: 'flash' },
        { id: 'm5', key: 'midi:K:1:note:40', to: 'nx:' + z.id, takeover: 'pickup', mode: 'flash' }];
      olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); })()""")
    time.sleep(0.4)
    on = lambda n: ev(f"midiIn({{ port: 'K', ch: 1, type: 'on', num: {n}, val: 100 }})")
    off = lambda n: ev(f"midiIn({{ port: 'K', ch: 1, type: 'off', num: {n}, val: 0 }})")
    Z = "olm.project.zones[0]"
    scene = lambda: ev(f"{Z}.scene")
    src = lambda: ev(f"{Z}.layers.map(L => L.src).join(',')")

    check("Flash is kept when the project is opened", ev("project.midi.maps.every(w => w.mode === 'flash')"))
    on(36); time.sleep(0.1)
    check("held: the scene plays, with its own fade", scene() == "s2" and src() == "b-rainbow" and ev(f"{Z}._fade && {Z}._fade.dur") == 0.6, (scene(), src(), ev(f"{Z}._fade && {Z}._fade.dur")))
    on(36)   # a repeated note on while held changes nothing
    off(36); time.sleep(0.1)
    check("let go: the scene before comes back, over the flashed scene's fade", scene() == "s1" and src() == "b-bars" and ev(f"{Z}._fade && {Z}._fade.dur") == 0.6, (scene(), src()))
    # layers changed by hand after the scene: they come back as they were, not as the scene had them
    ev(f"{Z}.layers[0].opacity = 0.4"); time.sleep(1.0)
    on(36); off(36); time.sleep(0.1)
    check("layers changed by hand come back as they were", scene() == "s1" and ev(f"{Z}.layers[0].opacity") == 0.4)
    # with a playlist playing, it carries on afterwards
    ev(f"""(() => {{ const z = {Z}; z.playlists = [newPlaylist({{ name: 'Show', steps: [newStep('s1', 30), newStep('s3', 30)] }})]; commit(); playPlaylist(z, z.playlists[0].id); }})()""")
    time.sleep(0.3)
    playing = lambda: ev(f"!!({Z}._play && {Z}._play.on)")
    check("a playlist plays", playing())
    on(36); time.sleep(0.1)
    check("a flash pauses it and plays the scene", scene() == "s2" and not playing())
    off(36); time.sleep(0.1)
    check("let go: the playlist carries on from its step", playing() and scene() == "s1", (playing(), scene()))
    ev(f"stopPlaylist({Z}); {Z}.playlists = []; commit()")
    # next scene on Flash
    ev(f"goScene({Z}, {Z}.scenes[0], true)"); time.sleep(0.1)
    on(40); time.sleep(0.1); a = scene(); off(40); time.sleep(0.1)
    check("next scene on Flash: the next while held, back when let go", a == "s2" and scene() == "s1", (a, scene()))
    # a zone's level
    ev(f"setZoneOpacity({Z}, 0.3)")
    on(37); a = ev(f"{Z}.opacity"); off(37)
    check("a level on Flash: full while held, back where it was", a == 1 and ev(f"{Z}.opacity") == 0.3, (a, ev(f"{Z}.opacity")))
    ev("project.settings.master = 0.5")
    on(39); a = ev("project.settings.master"); off(39)
    check("the master on Flash: full while held, back to half", a == 1 and ev("project.settings.master") == 0.5)
    on(38); a = ev("ui.blackout"); off(38)
    check("blackout on Flash: on while held, off again", a and not ev("ui.blackout"))
    ev("toggleBlackout()"); on(38); a = ev("ui.blackout"); off(38)
    check("blackout already on: stays on", a and ev("ui.blackout"))
    ev("toggleBlackout()")
    # a CC button on Flash
    ev(f"project.midi.maps.push({{ id: 'm6', key: 'midi:K:1:cc:50', to: 'sc:' + {Z}.id + ':s3', takeover: 'pickup', mode: 'flash' }})")
    ev("midiIn({ port: 'K', ch: 1, type: 'cc', num: 50, val: 127 })"); a = scene(); ev("midiIn({ port: 'K', ch: 1, type: 'cc', num: 50, val: 0 })")
    check("a CC button on Flash works the same", a == "s3" and scene() == "s1", (a, scene()))

    # the MIDI window offers it
    ev("ui.midiView = 'list'")
    with pg.expect_popup() as pi: pg.click("#btnMidi")
    W = pi.value; W.set_viewport_size({"width": 1180, "height": 760}); time.sleep(0.6)
    how = lambda mid: [x.strip() for x in W.locator(f".mmap[data-map='{mid}'] .seg button").all_inner_texts()]
    check("a scene offers Press and Flash", how("m1") == ["Press", "Flash"], how("m1"))
    check("a level offers Toggle, Hold and Flash", how("m2") == ["Toggle", "Hold", "Flash"], how("m2"))
    W.locator(".mmap[data-map='m1'] .seg button:text-is('Press')").click(); time.sleep(0.3)
    check("Press: the scene stays when let go", ev("project.midi.maps.find(w => w.id === 'm1').mode") == "toggle" and (on(36), off(36), scene())[2] == "s2")
    ev("undo()"); time.sleep(0.2)
    check("undo gives Flash back", ev("project.midi.maps.find(w => w.id === 'm1').mode") == "flash")
    saved = json.loads(ev("serialize()"))
    check("Flash is saved", [w["mode"] for w in saved["midi"]["maps"]][:2] == ["flash", "flash"])
    W.close()
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
