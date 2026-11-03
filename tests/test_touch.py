# Interactive content: effects that follow a finger. They compile, their touch inputs are no controls, their thumbnails
# are lit; the trail follows the finger on its zone only, fades, and lets go of a pad gone quiet; several pads at once;
# the Interact button in an effect's Parameters opens a black pad where the mouse moves the content; the Remote page
# offers Interact on a zone that plays one, and a finger on its pad moves the content on the computer.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8240
RP = PORT + 1
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

IDS = ["touchblobs", "touchclouds", "touchparticles", "touchripples", "touchsmoke"]
bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 950})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate

    # ---------- the effects
    r = ev("ids => ids.map(id => { const s = srcById('b-' + id), rt = runtimeOf(s); return [id, !!rt.R && !rt.error, (rt.touch || []).map(i => i.NAME).sort().join(), controlsOf(s).some(i => i.NAME.startsWith('touch')), isTouchSource(s)]; })", IDS)
    check("5 effects follow a finger, and all compile", all(x[1] and x[2] == "touchDown,touchField,touchX,touchY" and x[4] for x in r), r)
    check("their touch inputs are no controls", not any(x[3] for x in r), r)
    check("other effects don't", not ev("isTouchSource(srcById('b-rainbow')) || isTouchSource(srcById('b-bassbloom'))"))
    tags = ev("ids => ids.map(id => srcTags(srcById('b-' + id)).includes('interactive'))", IDS)
    check("all tagged interactive (found by searching touch or interactive)", all(tags), tags)
    ev("ids => ids.forEach(id => drawThumb(srcById('b-' + id), true))", IDS); time.sleep(0.6)
    r = ev("ids => ids.map(id => { const c = thumbs.get('b-' + id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s > 0; })", IDS)
    check("every one has a lit thumbnail (a made-up finger going round)", all(r), list(zip(IDS, r)))

    # ---------- the trail, drawn per zone
    # brightness of the effect drawn for zone z, in the top-left and bottom-right quarters
    LOOK = """async ([id, swipe]) => { const z = olm.project.zones[0], src = srcById('b-' + id), W = 160, H = 100;
      const step = async (pts) => { touchInput(z.id, pts); frameIndex++; touchFeatures(z.id); await new Promise(r => setTimeout(r, 20)); };
      if (swipe) for (let k = 0; k <= 12; k++) await step([[1, 0.1 + 0.2 * k / 12, 0.1 + 0.2 * k / 12]]);
      renderSource(src, { id: 'Lt', params: {} }, W, H, z); renderSource(src, { id: 'Lt', params: {} }, W, H, z);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(glCanvas, 0, glCanvas.height - H, W, H, 0, 0, W, H);
      const q = (x0, y0) => { const d = x.getImageData(x0, y0, W / 2, H / 2).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return Math.round(s / (d.length / 4)); };
      return [q(0, 0), q(W / 2, H / 2)]; }"""
    ev("touches.clear()")
    still = ev(LOOK, ["touchsmoke", False])
    swiped = ev(LOOK, ["touchsmoke", True])
    check("untouched, Touch Smoke is dark; a swipe at the top left leaves smoke there, and only there", still[0] < 15 and swiped[0] > still[0] + 20 and swiped[1] < 15, (still, swiped))
    t = ev("(() => { const T = touches.get(String(olm.project.zones[0].id)); return { n: T.fingers.size, down: T.down, x: T.x, y: T.y }; })()")
    check("the finger is down there (x, y smoothed towards it)", t["n"] == 1 and t["down"] > 0.5 and t["x"] < 0.35 and t["y"] < 0.35, t)
    ev("touchInput(olm.project.zones[0].id, [])")
    r = ev("""async () => { const z = olm.project.zones[0]; for (let k = 0; k < 120; k++) { frameIndex++; touchFeatures(z.id); await new Promise(r => setTimeout(r, 100)); }
      const T = touches.get(String(z.id)); const d = T.ctx.getImageData(0, 0, TOUCH_W, TOUCH_H).data; let b = 0; for (let i = 2; i < d.length; i += 4) b = Math.max(b, d[i]); return [T.down, b]; }""")
    check("let go, it eases out, and the swirl and smoke settle away within about ten seconds", r[0] < 0.05 and r[1] < 12, r)
    # another zone's pad doesn't touch this one
    ev("(() => { touches.clear(); touchInput('elsewhere', [[1, 0.2, 0.2]]); })()")
    other = ev(LOOK, ["touchsmoke", False])
    check("a finger on another zone's pad leaves this zone alone", other[0] < 15, other)
    # several pads, each its own fingers
    r = ev("""(() => { const z = olm.project.zones[0].id; touches.clear();
      touchInput(z, [[1, 0.2, 0.2]], 'a'); touchInput(z, [[1, 0.8, 0.8], [2, 0.5, 0.5]], 'b'); const n1 = touches.get(String(z)).fingers.size;
      touchInput(z, [], 'a'); const n2 = touches.get(String(z)).fingers.size;
      for (const f of touches.get(String(z)).fingers.values()) f.t -= 5; frameIndex++; touchFeatures(z); const n3 = touches.get(String(z)).fingers.size;
      return [n1, n2, n3]; })()""")
    check("two pads at once: each keeps its own fingers; one lifting leaves the other's", r[:2] == [3, 2], r)
    check("a pad gone quiet (a phone that lost the network) is let go", r[2] == 0, r)
    r = ev("(() => { touches.clear(); touchInput(olm.project.zones[0].id, [[1, 9, -3], [2, 'x', 1], 'junk', [3, 0.5, 0.5]]); return [...touches.get(String(olm.project.zones[0].id)).fingers.values()].map(f => [f.x, f.y]); })()")
    check("odd points are kept on the pad or ignored", r == [[1, 0], [0.5, 0.5]], r)
    ev("touches.clear()")

    # ---------- Interact, from an effect's Parameters
    ev("(() => { const z = olm.project.zones[0]; z.layers = [newLayer('b-touchsmoke')]; ui.zone = z.id; ui.layer = z.layers[0].id; ui.rightTab = 'content'; showRight(true); commit(); renderRight(); })()")
    time.sleep(0.3)
    note = pg.locator("#rightBody .tnote:has-text('Interactive')")
    check("its Parameters say it is interactive, with Interact", note.count() == 1 and note.locator("button:has-text('Interact')").count() == 1)
    ev("updateTempoUI()"); time.sleep(0.2)   # a tap or Listen redraws the tempo notes: not this one
    check("…and it stays so when the tempo changes", pg.locator("#rightBody .tnote:has-text('Interactive')").count() == 1 and pg.locator("#rightBody .tnote:has-text('beat')").count() == 0)
    with pg.expect_popup() as pop: note.locator("button").click()
    win = pop.value; time.sleep(0.4)
    check("Interact opens a black pad in a window of its own", win.locator("body.touchwin .tpad canvas").count() == 1 and "Interact" in win.title(), win.title())
    m = ev("(() => { const z = olm.project.zones[0], M = touchMap(z); return [M.length, M.every(v => v >= 0 && v <= 1), olm.project.fixtures.filter(f => f._pts).length]; })()")
    check("the zone's map: its pixels, 0..1 across and down it", m[0] > 0 and m[0] <= 6002 and m[1], m)
    check("the pad shows the zone's fixtures faintly, before any finger", win.evaluate("""(() => { const c = document.querySelector('.tpad canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 20) n++; return n; })()""") > 50)
    box = win.locator(".tpad canvas").bounding_box()
    zid = ev("String(olm.project.zones[0].id)")
    win.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.25); win.mouse.down()
    for k in range(10): win.mouse.move(box["x"] + box["width"] * (0.25 + k * 0.05), box["y"] + box["height"] * 0.25, steps=2); time.sleep(0.03)
    time.sleep(0.15)
    r = ev(f"(() => {{ const T = touches.get('{zid}'); return T ? [...T.fingers.values()].map(f => [Math.round(f.x * 100) / 100, Math.round(f.y * 100) / 100]) : null; }})()")
    check("dragging the mouse on it is a finger on the zone, where it is on the pad", r and len(r) == 1 and abs(r[0][0] - 0.7) < 0.05 and abs(r[0][1] - 0.25) < 0.05, r)
    win.mouse.up(); time.sleep(0.15)
    check("letting go lifts it", ev(f"touches.get('{zid}').fingers.size") == 0)
    win.mouse.move(box["x"] + 50, box["y"] + 50); win.mouse.down(); time.sleep(0.1)
    win.close(); time.sleep(0.7)
    check("closing the window lifts a finger held on it", ev(f"touches.get('{zid}').fingers.size") == 0)

    # ---------- the Remote page
    ev("touches.clear()")
    ev(f"(() => {{ remote.cfg = {{ on: true, port: {RP}, password: 'x' }}; remoteConfigure(); }})()")
    pg.wait_for_function("remote.status && remote.status.on", timeout=8000)
    st = ev("remoteState().zones.map(z => [z.name, z.touch])")
    check("the phones are told which zones play something interactive", any(x[1] for x in st) and not all(x[1] for x in st) if len(st) > 1 else st[0][1], st)
    ph = br.new_page(viewport={"width": 390, "height": 800}, has_touch=True)
    ph.on("pageerror", lambda e: errs.append("phone: " + str(e)))
    ph.goto(f"http://127.0.0.1:{RP}/remote")
    ph.wait_for_function("document.querySelectorAll('.zone').length > 0", timeout=10000); time.sleep(0.4)
    card = ph.locator(f".zone[data-id='{zid}']")
    check("its zone has Interact on the Remote page; the others don't", card.locator(".tint").is_visible() and ph.locator(".zone .tint:visible").count() == 1)
    card.locator(".tint").click(); time.sleep(0.3)
    check("Interact covers the screen with a black pad", ph.locator(".tpadr canvas").is_visible())
    time.sleep(0.5)
    check("…showing the zone's fixtures faintly (their map asked of the computer)", ph.evaluate("""(() => { const c = document.querySelector('.tpadr canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 20) n++; return n; })()""") > 50)
    vb = ph.viewport_size
    ph.mouse.move(vb["width"] * 0.5, vb["height"] * 0.6); ph.mouse.down()
    for k in range(8): ph.mouse.move(vb["width"] * (0.5 + k * 0.03), vb["height"] * 0.6, steps=2); time.sleep(0.04)
    ok = True
    try: pg.wait_for_function(f"touches.get('{zid}') && touches.get('{zid}').fingers.size === 1", timeout=4000)
    except Exception: ok = False
    r = ev(f"(() => {{ const T = touches.get('{zid}'); return T ? [...T.fingers.values()].map(f => [Math.round(f.x * 100) / 100, Math.round(f.y * 100) / 100]) : null; }})()")
    check("a finger on the phone's pad is a finger on the zone, on the computer", ok and r and abs(r[0][0] - 0.71) < 0.06 and abs(r[0][1] - 0.6) < 0.06, r)
    time.sleep(1.8)
    check("held still, it stays (the phone says so now and then)", ev(f"touches.get('{zid}').fingers.size") == 1)
    ph.mouse.up(); time.sleep(0.4)
    check("lifting it lifts it on the computer", ev(f"touches.get('{zid}').fingers.size") == 0)
    ph.mouse.move(100, 300); ph.mouse.down(); time.sleep(0.3)
    ph.evaluate("document.querySelector('.tpadr .tdone').click()"); time.sleep(0.4)   # another finger taps Done
    check("Done closes the pad, letting go of the zone", ph.locator(".tpadr").count() == 0 and ev(f"touches.get('{zid}').fingers.size") == 0)
    r = ev(f"(() => {{ remoteFromDevice('c9', 'http', {{ op: 'touch', zone: '{zid}', pts: [[1, 0.5, 0.5]] }}); return touches.get('{zid}').fingers.size; }})()")
    check("an HTTP trigger can't touch", r == 0)
    ev("(() => { const z = olm.project.zones[0]; z.layers = [newLayer('b-rainbow')]; commit(); })()")
    ok = True
    try: ph.wait_for_function(f"document.querySelector(\".zone[data-id='{zid}'] .tint\").hidden", timeout=4000)
    except Exception: ok = False
    check("when the zone plays something else, Interact goes", ok)
    # the scenes' snapshots on the Remote page's buttons
    shot = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    ev(f"(() => {{ const z = olm.project.zones[0]; z.scenes.push({{ id: 'scshot', name: 'With a picture', layers: [], fade: 0, thumb: '{shot}' }}, {{ id: 'scplain', name: 'Without', layers: [], fade: 0 }}); commit(); }})()")
    ok = True
    try: ph.wait_for_function("!!document.querySelector(\".scene.shot[data-id='scshot']\")", timeout=5000)
    except Exception: ok = False
    check("a scene's snapshot shows on its button on the Remote page; one without stays plain", ok and ph.locator(".scene[data-id='scplain']").get_attribute("class").find("shot") < 0)
    ev("(() => { const z = olm.project.zones[0]; z.scenes.find(s => s.id === 'scshot').thumb = null; commit(); })()")
    ok = True
    try: ph.wait_for_function("!document.querySelector(\".scene.shot[data-id='scshot']\")", timeout=5000)
    except Exception: ok = False
    check("…and goes when the snapshot is removed", ok)
    ev("(() => { remote.cfg.on = false; remoteConfigure(); })()")
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
