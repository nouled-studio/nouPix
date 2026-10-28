# HTTP triggers: with remote control on and its HTTP triggers on, a plain GET on the remote control's address plays a
# scene (by name or id, with its fade or cut), sets a zone's level, the master and blackout, and /trigger lists them all;
# answers are JSON. Off, or with the main window gone, they say so. They go through the same path as the phones
# (remoteFromDevice), so the phones see what they did. The Remote control menu and Settings show and switch them.
import os, sys, time, json, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, fetch
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8234
RP = PORT + 1
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
def get(path):
    r = fetch(f"http://127.0.0.1:{RP}{path}")
    try: body = json.loads(r.body or b"{}")
    except ValueError: body = {"raw": r.body[:80]}
    return r.status, body

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 950})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    ev("""(() => { const p = blankProject('HTTP'); p.fixtures.push(newFixture('line', { x1: 100, y1: 300, x2: 900, y2: 300, pixels: 20 }));
      const z = p.zones[0]; z.name = 'Main'; z.layers = [newLayer('b-bars')];
      z.scenes = [{ id: 's1', name: 'Bars', fade: 0, layers: [newLayer('b-bars')] }, { id: 's2', name: 'Strobe Hit', fade: 1.5, layers: [newLayer('b-rainbow')] }];
      const z2 = newZone({ name: 'Side', x: 0, y: 0, w: 300, h: 300 }); z2.scenes = [{ id: 't1', name: 'Bars', fade: 0, layers: [] }, { id: 't2', name: 'Bars', fade: 0, layers: [] }];
      p.zones.push(z2); olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); })()""")
    time.sleep(0.3)
    Z = "olm.project.zones[0]"
    ev(f"remote.cfg = {{ on: true, port: {RP}, password: '', http: false }}; remoteConfigure()")
    pg.wait_for_function("remote.status && remote.status.on", timeout=8000)
    s, b = get("/trigger/scene/Main/Bars")
    check("off by default: a trigger is refused, saying how to turn them on", s == 404 and "off" in b.get("error", ""), (s, b))
    # the menu and the window
    pg.click("#btnRemote"); time.sleep(0.2)
    item = pg.locator(".menu :text('HTTP triggers…')")
    check("the Remote control menu has HTTP triggers…", item.count() == 1)
    item.click(); time.sleep(0.2)
    dlg = pg.locator(".modal[aria-label='HTTP triggers']")
    check("it opens a window with a switch, off", dlg.count() == 1 and dlg.locator(".onsw").get_attribute("aria-checked") == "false")
    dlg.locator(".onsw").click(); time.sleep(0.4)
    check("switched on, it lists every trigger with its address", ev("remote.cfg.http") is True and dlg.locator(".rurl").count() == ev("httpTriggers().length")
          and f"http://" in dlg.locator(".rurl .mono").first.inner_text() and f":{RP}/trigger/master/100" in dlg.locator(".rurl .mono").first.inner_text(), dlg.locator(".rurl .mono").first.inner_text())
    texts = dlg.locator(".rurl .mono").all_inner_texts()
    check("scenes by name, the same name twice by id", any(t.endswith("/trigger/scene/Main/Strobe%20Hit") for t in texts) and any(t.endswith("/trigger/scene/Side/t2") for t in texts)
          and any(t.endswith("/trigger/level/Main/100") for t in texts), texts)
    dlg.locator("button:text-is('Done')").click()
    check("the setting is kept for next time", ev("store.get('noupix.remote').http") is True)

    # the triggers
    s, b = get("/trigger/scene/Main/Strobe%20Hit")
    check("a scene by name plays, with its fade, and says what it did", s == 200 and b.get("ok") and ev(f"{Z}.scene") == "s2" and ev(f"{Z}._fade && {Z}._fade.dur") == 1.5, (s, b))
    s, b = get("/trigger/scene/main/bars/cut")
    check("names in any case; /cut cuts", s == 200 and ev(f"{Z}.scene") == "s1" and not ev(f"{Z}._fade"), (s, b))
    s, b = get(f"/trigger/scene/{ev(Z + '.id')}/s2")
    check("by id too", s == 200 and ev(f"{Z}.scene") == "s2", (s, b))
    s, b = get("/trigger/level/Main/40")
    check("a zone's level from 0 to 100", s == 200 and ev(f"{Z}.opacity") == 0.4, (s, b, ev(f"{Z}.opacity")))
    s, b = get("/trigger/master/25")
    check("the master", s == 200 and ev("project.settings.master") == 0.25 and pg.locator("#masterVal").inner_text().strip() == "25%", (s, b))
    s, b = get("/trigger/blackout/on"); a = ev("ui.blackout")
    s2, b2 = get("/trigger/blackout/toggle")
    check("blackout on, and toggle", s == 200 and a and s2 == 200 and not ev("ui.blackout"), (b, b2))
    s, b = get("/trigger/level/Main/150")
    check("a level past 100 is 100", s == 200 and ev(f"{Z}.opacity") == 1)
    for path, code in [("/trigger/scene/Nowhere/Bars", 404), ("/trigger/scene/Main/Nothing", 404), ("/trigger/level/Main/lots", 400),
                       ("/trigger/master", 400), ("/trigger/blackout/maybe", 400), ("/trigger/fly", 404), ("/trigger/scene/Main/%E0%A4%A", 400)]:
        s, b = get(path)
        check(f"{path} is refused with {code} and why", s == code and b.get("error"), (s, b))
    s, b = get("/trigger")
    check("/trigger lists them all", s == 200 and len(b.get("triggers", [])) == ev("httpTriggers().length") and b["triggers"][0]["path"] == "/trigger/master/100", b)
    check("triggers are no step of the project's undo beyond what a phone's would be", ev("project.settings.master") == 0.25)
    # with the X-Fader driving a zone
    ev(f"""(() => {{ setXfadeOn(true); }})()"""); time.sleep(0.2)
    s, b = get("/trigger/level/Main/10")
    check("a zone on the X-Fader says so", s == 409 and "X-Fader" in b.get("error", ""), (s, b))
    ev("setXfadeOn(false); $$('.modal-bg').forEach(m => m.remove())")
    # the phones see what a trigger did
    st = ev("JSON.parse(JSON.stringify(remoteState()))")
    check("the Remote page's state follows (the same path as a phone)", [z for z in st["zones"] if z["name"] == "Main"][0]["scene"] == ev(f"{Z}.scene"))
    # in Settings
    ev("ui.rightTab = 'settings'; renderRight()"); time.sleep(0.2)
    box = pg.locator("#remoteSec label:has-text('HTTP triggers') input")
    check("Settings → Remote control shows the switch, on", box.count() == 1 and box.is_checked())
    box.uncheck(); time.sleep(0.4)
    s, b = get("/trigger/master/100")
    check("switched off there, triggers are refused again", s == 404 and ev("project.settings.master") == 0.25, (s, b))
    box.check(); time.sleep(0.4)
    # the main window gone
    pg.goto("about:blank"); time.sleep(1.0)
    s, b = get("/trigger/master/100")
    check("with the main window closed, a trigger says so", s in (404, 503) and b.get("error"), (s, b))
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
