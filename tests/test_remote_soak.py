# Remote control under a long, mixed load: the main window, a programmer, an operator and three phones change things
# at random (400 actions: scenes, levels, layers, fixtures, playlists, the master, the main window's own edits) while
# every zone plays a playlist, and phones and the operator drop off and come back. Afterwards every device must show
# exactly the main computer's project, and no page may have an error.
import os, sys, time, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8162
RP = PORT + 1
STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 400
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)
def until(pg, js, timeout=15000, arg=None):
    try: pg.wait_for_function(js, arg=arg, timeout=timeout, polling=200); return True
    except Exception: return False

bridge = start_bridge(PORT)
errs = []
def watch(pg, name):
    pg.on("pageerror", lambda e: errs.append((name, str(e))))
    pg.on("console", lambda m: errs.append((name, m.text)) if app_error(m) and "WebSocket" not in m.text and "ERR_CONNECTION" not in m.text else None)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    host = br.new_page(viewport={"width": 1440, "height": 900}); watch(host, "host")
    host.goto(f"http://127.0.0.1:{PORT}/"); host.wait_for_function("window.olm && olm.bridge.connected")
    host.evaluate(f"(() => {{ const p = demoProject(); p.settings.fps = 8; olm.loadProject(p); remote.cfg = {{ on: true, port: {RP}, password: 'pw' }}; remoteConfigure(); }})()")
    # every zone plays a playlist of short steps all along, so the look changes by itself while the devices edit
    host.evaluate("""(() => { for (const z of olm.project.zones) {
      const a = newPlaylist({ name: 'Loop', steps: z.scenes.map(s => newStep(s.id, 1.5)) }), b = newPlaylist({ name: 'Other', steps: z.scenes.slice(0, 2).map(s => newStep(s.id, 2.5)), end: a.id });
      z.playlists = [a, b]; playPlaylist(z, a.id); } commit(); })()""")
    until(host, "remote.status && remote.status.on")
    def app(role):
        pg = br.new_context(viewport={"width": 1280, "height": 800}).new_page(); watch(pg, role)
        pg.goto(f"http://127.0.0.1:{RP}/"); pg.click(f".role[data-role={role}]")
        if role == "programmer": pg.fill("#pw", "pw")
        pg.click("#go"); pg.wait_for_url(f"http://127.0.0.1:{RP}/app"); until(pg, "window.olm && remote.loaded", 30000)
        return pg
    def phone(i):
        pg = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True).new_page(); watch(pg, "phone%d" % i)
        pg.goto(f"http://127.0.0.1:{RP}/remote"); until(pg, "document.querySelectorAll('.zone').length > 0", 20000)
        return pg
    pr, op = app("programmer"), app("operator")
    phones = [phone(i) for i in range(3)]
    check("everyone is connected", host.evaluate("remote.clients.size") == 5, host.evaluate("[...remote.clients.values()].map(c => c.role)"))
    rnd = random.Random(11)
    acts = {"host": 0, "programmer": 0, "operator": 0, "phone": 0, "drop": 0}
    t0 = time.time()
    for i in range(STEPS):
        k = rnd.random()
        try:
            if k < 0.25:
                pg = rnd.choice(phones); c = pg.locator(".zone").nth(rnd.randrange(3))
                q = rnd.random()
                if q < 0.35: c.locator(".scene").nth(rnd.randrange(max(1, c.locator(".scene").count()))).tap(timeout=3000)
                elif q < 0.5: c.locator(".ppill").nth(rnd.randrange(2)).tap(timeout=3000)
                elif q < 0.65 and c.locator(".pplay").is_visible(): c.locator(".pnext" if rnd.random() < 0.5 else ".pbig").tap(timeout=3000)
                else: c.locator(".dim input").evaluate("(e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }", rnd.randrange(101))
                acts["phone"] += 1
            elif k < 0.45:
                pr.evaluate("""(([i, d]) => { const f = olm.project.fixtures[i % olm.project.fixtures.length];
                  if (i % 7 === 0) addFixture(newFixture('line', { x1: 50 + i, y1: 620, x2: 150 + i, y2: 620, pixels: 10 }), { select: false });
                  else if (i % 11 === 0 && olm.project.fixtures.length > 9) { ui.sel = new Set([olm.project.fixtures.at(-1).id]); deleteSel(); }
                  else { moveFixture(f, snapshotGeom(f), d, -d); markGeom(); commit(); } })""", [i, rnd.choice([-3, 3])])
                acts["programmer"] += 1
            elif k < 0.65:
                op.evaluate("""(([i, v]) => { const z = olm.project.zones[i % olm.project.zones.length];
                  if (i % 3 === 0 && z.scenes.length) goScene(z, z.scenes[i % z.scenes.length]);
                  else if (i % 6 === 1 && z.playlists[0] && z.playlists[0].steps[0]) { z.playlists[0].steps[0].time = 1 + (i % 3) * 0.5; commit(); }
                  else if (i % 3 === 1 && z.layers[0]) { z.layers[0].opacity = v; commitSoft(); }
                  else { setZoneOpacity(z, v, true); commitSoft(); } })""", [i, round(rnd.random(), 2)])
                acts["operator"] += 1
            elif k < 0.85:
                host.evaluate("""(([i, v]) => { const z = olm.project.zones[i % olm.project.zones.length];
                  if (i % 4 === 0) { z.name = 'Zone ' + i; commit(); }
                  else if (i % 4 === 1 && z.scenes.length) goScene(z, z.scenes[i % z.scenes.length], true);
                  else if (i % 4 === 2) { project.settings.master = v; remoteLiveChanged(); }
                  else { setZoneOpacity(z, v); commitSoft(); } })""", [i, round(rnd.random(), 2)])
                acts["host"] += 1
            else:
                j = rnd.randrange(4)
                if j < 3:
                    phones[j].close(); phones[j] = phone(j)
                else:
                    op.reload(); until(op, "window.olm && remote.loaded", 30000)
                acts["drop"] += 1
        except Exception as e:
            errs.append(("step %d" % i, str(e)[:200]))
        time.sleep(rnd.random() * 0.08)
    check(f"{STEPS} actions in {time.time() - t0:.0f} s: {acts}", True)
    playing = host.evaluate("olm.project.zones.filter(z => z._play && z._play.on).length")
    host.evaluate("olm.project.zones.forEach(z => pausePlaylist(z))")   # the look holds still for the comparison
    time.sleep(4)
    hs = host.evaluate("serialize(false)")
    for name, pg in [("programmer", pr), ("operator", op)]:
        check(f"the {name} ends with the main computer's project", until(pg, "s => serialize(false) === s", 20000, hs))
    want = host.evaluate("olm.project.zones.slice().reverse().map(z => [z.name, Math.round(z.opacity * 100), (z.scenes.find(s => s.id === z.scene) || {}).name || null, playingList(z) && !z._play.ended ? playingList(z).name : null])")
    for i, pg in enumerate(phones):
        got = pg.evaluate("[...document.querySelectorAll('.zone')].map(c => [c.querySelector('.zhead b').textContent, +c.querySelector('.dim input').value, (c.querySelector('.scene.live b') || {}).textContent || null, (c.querySelector('.ppill.on, .ppill.paused') || {}).textContent || null])")
        check(f"phone {i + 1} shows the main computer's zones, levels, scenes and playlists", got == want, (got, want))
    check("playlists were still playing at the end of it", playing >= 1, playing)
    check("the project is still sound", host.evaluate("olm.project.fixtures.length >= 9 && olm.project.zones.length === 3 && olm.project.controllers.length === 1"))
    f0 = host.evaluate("olm.frameIndex"); time.sleep(1.5)
    check("the main computer still renders", host.evaluate("olm.frameIndex") > f0)
    check("no page errors", not errs, errs[:6])
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
