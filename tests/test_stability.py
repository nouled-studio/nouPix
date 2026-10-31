# Stability: a long session of everything at once, as on a show night. Scenes and playlists, every built-in effect,
# the X-Fader (on, off, moved, its modes), MIDI controls, macros, undo and redo, panels resized, the look switched,
# the Scenes window opened and closed, projects saved and opened again, a phone on the Remote page tapping scenes and
# moving the X-Fader. Meanwhile the Art-Net output must never stop (a node listens), the JS heap and the GPU objects
# must stay bounded, and nothing may throw. At the end the project must still be whole.
# python3 test_stability.py [port] [minutes]
import os, sys, time, random, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, FakeNode, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8210
MINUTES = float(sys.argv[2]) if len(sys.argv) > 2 else 3
RP = PORT + 1
rnd = random.Random(23)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:500] if detail != "" else ""), flush=True); ok or fails.append(name)
# GPU objects made and deleted, counted in every WebGL context of the page
COUNT = """(() => { const P = WebGLRenderingContext.prototype; window.__gl = { programs: 0, textures: 0, buffers: 0, fbs: 0 };
  const wrap = (make, del, key) => { const m = P[make], d = P[del];
    P[make] = function () { const o = m.apply(this, arguments); if (o) window.__gl[key]++; return o; };
    P[del] = function (o) { if (o) window.__gl[key]--; return d.apply(this, arguments); }; };
  wrap('createProgram', 'deleteProgram', 'programs'); wrap('createTexture', 'deleteTexture', 'textures'); wrap('createBuffer', 'deleteBuffer', 'buffers'); wrap('createFramebuffer', 'deleteFramebuffer', 'fbs'); })();"""

node = FakeNode()
bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS + ["--js-flags=--expose-gc", "--enable-precise-memory-info"])
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); ctx.add_init_script(COUNT)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("page: " + str(e)[:300]))
    pg.on("console", lambda m: errs.append("console: " + m.text[:300]) if app_error(m) else None)
    pg.on("dialog", lambda d: d.dismiss())
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate

    # ---------- the show: the demo, sent to the node listening here, with MIDI, a playlist, the X-Fader and a phone
    ev("""(() => { localStorage.clear(); const p = demoProject(); p.controllers.forEach(c => { c.ip = '127.0.0.1'; }); p.settings.fps = 40;
      olm.loadProject(p); setOutput(true); fitView(); })()""")
    ev("""(() => {
      const zs = olm.project.zones, k = (t, n) => `midi:Desk:1:${t}:${n}`;
      project.midi.maps = [newMidiMap(k('cc', 1), 'master'), newMidiMap(k('cc', 2), 'xf'), newMidiMap(k('cc', 3), 'z:' + zs[0].id), newMidiMap(k('cc', 4), 'm:speed'),
        newMidiMap(k('cc', 5), 'm:intensity'), newMidiMap(k('note', 36), `sc:${zs[1].id}:${zs[1].scenes[0].id}`), newMidiMap(k('note', 37), 'nx:' + zs[2].id), newMidiMap(k('note', 38), 'blackout')];
      project.midi.maps.forEach(w => { w.takeover = 'jump'; });
      const z = zs[1]; addPlaylist(z, { name: 'Night', steps: z.scenes.map(sc => newStep(sc.id, 1.5, 0.5)), fade: null, end: 'loop', autoplay: false });
      project.xfade.phone = true; commit();
      remote.cfg = { on: true, port: %d, password: 'x' }; remoteConfigure();
    })()""" % RP)
    pg.wait_for_function("remote.status && remote.status.on", timeout=10000)
    ph = ctx.new_page(); ph.set_viewport_size({"width": 390, "height": 800})
    ph.on("pageerror", lambda e: errs.append("phone: " + str(e)[:300]))
    ph.goto(f"http://127.0.0.1:{RP}/remote"); ph.wait_for_function("document.querySelectorAll('.zone').length === 3", timeout=10000)
    # every effect compiled once first, so what follows measures the session and not the first compile of each
    n = ev("(() => { for (const b of BUILTINS) runtimeOf(srcById('b-' + b.id)); return BUILTINS.length; })()")
    time.sleep(2)

    def stats():
        return ev("""() => { gc(); gc(); return { heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), gl: Object.assign({}, window.__gl),
          frame: olm.frameIndex, runtimes: runtimes.size, hist: hist.stack.length, nodes: document.getElementsByTagName('*').length }; }""")
    # the same show at the start and at the end: how fast it runs then, as frames and Art-Net packets a second
    REF = ev("serialize(false)")
    def reference():
        ev("""ref => { if (scenesWinOpen()) closeScenesWindow(); if (ui.blackout) toggleBlackout(); setTheme('dark'); showRight(true);
          ui.dockTab = 'scenes'; ui.dockH = 250; document.querySelector('#dock').style.setProperty('--bottom-h', '250px');
          olm.loadProject(JSON.parse(ref), { resetView: false }); setOutput(true); renderDock(); }""", REF)
        time.sleep(4)
        f0, t0 = ev("olm.frameIndex"), time.time(); time.sleep(12); t1 = time.time()
        return round((ev("olm.frameIndex") - f0) / (t1 - t0), 1), round(node.count(t0, t1) / (t1 - t0), 1), ev("document.getElementsByTagName('*').length")
    ref0 = reference()
    print(f"reference show at the start: {ref0[0]} frames/s, {ref0[1]} packets/s, {ref0[2]} elements", flush=True)

    # ---------- the actions, chosen at random
    BUILT = ev("BUILTINS.map(b => 'b-' + b.id)")
    def a_scene():
        ev("cut => { const zs = olm.project.zones, z = zs[Math.floor(Math.random() * zs.length)]; if (z.scenes.length) goScene(z, z.scenes[Math.floor(Math.random() * z.scenes.length)], cut); }", rnd.random() < 0.3)
    def a_effect():
        ev("src => { const zs = olm.project.zones, z = zs[Math.floor(Math.random() * zs.length)], L = z.layers[0]; if (L) { L.src = src; syncMedia(); commit(); } }", rnd.choice(BUILT))
    def a_xfade():
        r = rnd.random()
        if r < 0.2: ev("(() => { setXfadeOn(!project.xfade.on); document.querySelectorAll('.modal-bg').forEach(m => m.remove()); })()")
        elif r < 0.3: ev("m => setXfadeMode(m)", rnd.choice(["mix", "dip", "cut"]))
        elif r < 0.4: ev("(() => { const zs = olm.project.zones; setXfadeZone(Math.random() < 0.5 ? 'a' : 'b', zs[Math.floor(Math.random() * zs.length)].id); })()")
        else: ev("x => { setXfade(x); commitSoft(); }", rnd.random())
    def a_midi():
        if rnd.random() < 0.7: ev("([n, v]) => midiIn({ port: 'Desk', ch: 1, type: 'cc', num: n, val: v })", [rnd.randint(1, 5), rnd.randint(0, 127)])
        else:
            num = rnd.choice([36, 37, 38]); ev("n => { midiIn({ port: 'Desk', ch: 1, type: 'on', num: n, val: 100 }); midiIn({ port: 'Desk', ch: 1, type: 'off', num: n, val: 0 }); }", num)
            if num == 38 and rnd.random() < 0.9: ev("(() => { if (ui.blackout) toggleBlackout(); })()")   # blackout seldom stays on
    def a_macro():
        ev("([id, v]) => setMacro(id, { v })", rnd.choice([["speed", rnd.random() * 2], ["intensity", rnd.random()], ["saturation", rnd.random()]]))
    def a_playlist():
        ev("d => { const z = olm.project.zones[1], pl = z.playlists[0]; if (pl) playlistDo(z, pl, d); }", rnd.choice(["start", "pause", "resume", "next", "prev", "stop", "start"]))
    def a_undo():
        ev("Math.random() < 0.6 ? undo() : redo()")
    def a_resize():
        r = rnd.random()
        if r < 0.6: ev("h => { ui.dockH = h; document.querySelector('#dock').style.setProperty('--bottom-h', h + 'px'); }", rnd.randint(140, 500))
        elif r < 0.8: ev("showRight(!!ui.rightHidden)")   # hide it, or show it again
        else: ev("(() => { ui.dockTab = ['scenes', 'patch'][Math.floor(Math.random() * 2)]; renderDock(); if (Math.random() < 0.3) openMonitor(); })()")
    def a_look():
        ev("setTheme(ui.theme === 'light' ? 'dark' : 'light')")
    def a_window():
        ev("(() => { if (scenesWinOpen()) closeScenesWindow(); else openScenesWindow(); })()")
    def a_reload():
        ev("(() => { const s = serialize(false); olm.loadProject(JSON.parse(s), { resetView: false }); setOutput(true); })()")
    def a_phone():
        r = rnd.random()
        try:
            if r < 0.5:
                tiles = ph.locator(".scene"); k = tiles.count()
                if k: tiles.nth(rnd.randrange(k)).click(timeout=2000)
            elif r < 0.8 and ph.locator("#xfade:not([hidden]) .xrow:not([hidden]) input").count():
                b = ph.locator("#xfade input").bounding_box(); ph.mouse.click(b["x"] + b["width"] * rnd.random(), b["y"] + b["height"] / 2)
            else:
                dims = ph.locator(".zone .dim input:not([disabled])"); k = dims.count()
                if k: d = dims.nth(rnd.randrange(k)).bounding_box(); ph.mouse.click(d["x"] + d["width"] * rnd.random(), d["y"] + d["height"] / 2)
        except Exception as e:
            pass   # a tile that moved under the finger, as on a real phone
    def a_stage():
        ev("(() => { const f = olm.project.fixtures[Math.floor(Math.random() * olm.project.fixtures.length)]; ui.sel = new Set([f.id]); onSelection(); })()")
        pg.keyboard.press(rnd.choice(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]))
    ACTIONS = [(a_scene, 14), (a_effect, 10), (a_xfade, 12), (a_midi, 14), (a_macro, 6), (a_playlist, 6), (a_undo, 6), (a_resize, 8),
               (a_look, 1), (a_window, 1), (a_reload, 1), (a_phone, 8), (a_stage, 4)]
    pick = [f for f, w in ACTIONS for _ in range(w)]

    s0 = stats(); samples = [s0]; t_start = time.time(); end = t_start + MINUTES * 60; steps = 0; next_sample = t_start + 30; failed_actions = []
    print(f"start: {n} effects compiled, {json.dumps(s0)}", flush=True)
    while time.time() < end:
        f = rnd.choice(pick)
        try: f()
        except Exception as e: failed_actions.append(f"{f.__name__}: {str(e)[:160]}")
        steps += 1
        time.sleep(rnd.uniform(0.1, 0.4))
        if time.time() >= next_sample:
            s = stats(); s["t"] = round(time.time() - t_start); s["pkts"] = node.count(time.time() - 30, time.time()); samples.append(s)
            print(f"t={s['t']}s heap {s['heapMB']} MB · gl {s['gl']} · runtimes {s['runtimes']} · elements {s['nodes']} · Art-Net {s['pkts']} packets in 30 s · errors {len(errs)}", flush=True)
            next_sample += 30
    # back to the reference show: it must run as fast as at the start, with as many elements on the page
    ref1 = reference()
    print(f"reference show at the end: {ref1[0]} frames/s, {ref1[1]} packets/s, {ref1[2]} elements", flush=True)
    last = stats()
    print(f"{steps} actions in {round(time.time() - t_start)} s", flush=True)

    # ---------- the output never stopped
    with node.lock: ts = [e[0] for e in node.log if e[1] == 0x5000 and e[0] >= t_start]
    gaps = sorted(b - a for a, b in zip(ts, ts[1:]))
    check("Art-Net kept going all session: no gap over 2 s", ts and gaps[-1] < 2.0, round(gaps[-1], 2) if gaps else "nothing received")
    check("and in every half minute", all(s.get("pkts", 1) > 0 for s in samples), [s.get("pkts") for s in samples])
    check("the frame clock kept ticking", last["frame"] > s0["frame"] + MINUTES * 60 * 3, (s0["frame"], last["frame"]))
    check("the same show runs as fast at the end as at the start (nothing builds up)", ref1[0] >= 0.85 * ref0[0] and ref1[1] >= 0.85 * ref0[1], (ref0, ref1))
    check("and the page holds no more elements than at the start", ref1[2] <= ref0[2] + 50, (ref0[2], ref1[2]))
    # ---------- bounded
    check("JS heap stays bounded (the second half grows no more than a few MB)", last["heapMB"] < max(s["heapMB"] for s in samples[:len(samples) // 2 + 1]) + 12,
          [s["heapMB"] for s in samples] + [last["heapMB"]])
    check("GPU objects stay bounded", all(last["gl"][k] <= s0["gl"][k] + 12 for k in s0["gl"]), (s0["gl"], last["gl"]))
    check("compiled effects stay at one each", last["runtimes"] <= n + 4, last["runtimes"])
    check("undo history stays capped", last["hist"] <= 200, last["hist"])
    # ---------- the project is whole, the X-Fader consistent, the phone in step
    whole = ev("""(() => { const s = serialize(false), p = hydrate(JSON.parse(s)); return JSON.stringify(p, replacer) === JSON.stringify(hydrate(JSON.parse(JSON.stringify(project, replacer))), replacer); })()""")
    check("the project saves and opens the same", whole)
    xf = ev("""(() => { const p = xfZones(); if (!p) return 'off'; const [a, b] = xfLevels(project.xfade.x, project.xfade.mode); return Math.abs(p[0].opacity - a) < 1e-9 && Math.abs(p[1].opacity - b) < 1e-9; })()""")
    check("the X-Fader's levels match its position", xf in (True, "off"), xf)
    time.sleep(1.5)
    same = ph.evaluate("document.querySelectorAll('.zone').length") == ev("olm.project.zones.length")
    check("the phone shows the same zones", same)
    lit = ev("olm.project.fixtures.some(f => f._col.some(v => v > 0))")
    check("the lights are still lit", lit)
    check("no action failed", not failed_actions, failed_actions[:4])
    check("no errors in the app or on the phone", not errs, errs[:4])
    br.close()
finally:
    bridge.kill(); node.close()
print("FAILED:", fails or "none")
