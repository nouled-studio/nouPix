# Remote control, end to end: the main window switches it on in Settings; the network server serves only its pages
# and files; logging in as programmer (password, wrong passwords slowed and locked out), operator and remote; the
# phone page (zones, content, scenes, dimmers) on phone, tablet and computer sizes; the operator's locked mapping
# (also against a forged message); the programmer's full access both ways; several devices at once converge; the
# main window closing and coming back; a new password logging programmers out; switching off; a busy port.
import os, sys, time, json, random, socket, http.client
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8160
RP = PORT + 1   # remote control port
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

def req(method, path, body=None, headers=None, src="127.0.0.1"):
    c = http.client.HTTPConnection("127.0.0.1", RP, timeout=10, source_address=(src, 0))
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"} if data else {}
    h.update(headers or {})
    c.request(method, path, body=data, headers=h)
    r = c.getresponse(); out = r.read(); c.close()
    return r.status, r.getheader("Content-Type") or "", out
def port_open(p):
    s = socket.socket(); s.settimeout(1)
    try: s.connect(("127.0.0.1", p)); return True
    except OSError: return False
    finally: s.close()

def until(pg, js, timeout=8000, arg=None):
    try: pg.wait_for_function(js, arg=arg, timeout=timeout, polling=100); return True
    except Exception: return False

bridge = start_bridge(PORT)
errs = []
def watch(pg, name):
    pg.on("pageerror", lambda e: errs.append((name, str(e))))
    pg.on("console", lambda m: errs.append((name, m.text)) if app_error(m) else None)
    pg.on("dialog", lambda d: d.dismiss())
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    hctx = br.new_context(viewport={"width": 1440, "height": 900})
    host = hctx.new_page(); watch(host, "host")
    host.goto(f"http://127.0.0.1:{PORT}/"); host.wait_for_function("window.olm && olm.bridge.connected")
    # 10 frames a second: this test runs the main window and three copies of the interface on one computer, each
    # rendering in software; real devices each have their own processor and graphics
    host.evaluate("(() => { localStorage.removeItem('openledmapper.remote'); const p = demoProject(); p.settings.fps = 10; olm.loadProject(p); })()")
    H = host.evaluate

    # ---------- switching it on, in Settings
    check("off at first: nothing listens on the remote port", not port_open(RP))
    H("ui.rightTab = 'settings'; showRight(true); renderRight()")
    sec = host.locator("#remoteSec")
    check("Settings has a Remote control section, off", sec.count() == 1 and "OFF" in sec.locator(".onsw").inner_text())
    sec.locator(".row:has-text('Port') input").fill(str(RP)); sec.locator(".row:has-text('Port') input").press("Enter")
    sec = host.locator("#remoteSec")
    pwi = sec.locator("input[type=password]"); pwi.fill("open sesame"); pwi.press("Tab")
    host.locator("#remoteSec .onsw").click()
    check("switching it on opens the remote port", until(host, "remote.status && remote.status.on") and port_open(RP), H("remote.status"))
    st = H("remote.status")
    check("Settings shows the address to open on the other devices", until(host, f"document.querySelector('#remoteSec') && document.querySelector('#remoteSec').innerText.includes(':{RP}/')"), st)
    check("the address is this computer's network address", any(not u.startswith("http://127.") for u in st["urls"]) or not st["urls"], st["urls"])
    check("the top-bar button shows it is on", "on" in host.get_attribute("#btnRemote", "class"))
    check("the setting is kept in this browser", H("JSON.parse(localStorage.getItem('openledmapper.remote'))") == {"on": True, "port": RP, "password": "open sesame"})

    # ---------- what the network server serves
    for path, kind in [("/", "html"), ("/app", "html"), ("/remote", "html"), ("/css/remote.css", "css"), ("/css/app.css", "css"), ("/js/remote-app.js", "javascript"), ("/js/app.js", "javascript"), ("/js/vendor/isf.js", "javascript")]:
        s, ct, _ = req("GET", path)
        check(f"serves {path}", s == 200 and kind in ct, (s, ct))
    for path in ["/ws", "/openledmapper.py", "/js/../openledmapper.py", "/js/%2e%2e/openledmapper.py", "/tests/harness.py", "/login.html/..", "/examples/01-led-bars.json", "/index.html"]:
        s, _, _ = req("GET", path)
        check(f"does not serve {path}", s == 404, s)
    s, _, out = req("GET", "/info"); info = json.loads(out)
    check("/info: version, a password is set, the main window is there", s == 200 and info["hasPassword"] and info["host"] and info["version"], info)

    # ---------- logging in
    s, _, out = req("POST", "/login", {"role": "admin"}); check("an unknown role is refused", s == 400, (s, out))
    s, _, out = req("POST", "/login", {"role": "programmer", "password": "nope"}); check("programmer with a wrong password: refused", s == 401 and b"Wrong password" in out, (s, out))
    t0 = time.time(); req("POST", "/login", {"role": "programmer", "password": "nope2"})
    check("a wrong password takes a moment (slows guessing)", time.time() - t0 >= 0.5, time.time() - t0)
    s, _, out = req("POST", "/login", {"role": "programmer", "password": "open sesame"}); check("programmer with the password: a token", s == 200 and json.loads(out).get("token"), (s, out))
    s, _, out = req("POST", "/login", {"role": "operator"}); check("operator: no password needed", s == 200 and json.loads(out).get("role") == "operator", (s, out))
    s, _, out = req("POST", "/login", {"role": "remote"}); check("remote: no password needed", s == 200, (s, out))
    s, _, out = req("POST", "/login", {"role": "operator"}, {"Origin": "http://evil.example"}); check("logging in from another site's page is refused", s == 404, s)
    codes = [req("POST", "/login", {"role": "programmer", "password": "guess%d" % i}, src="127.0.0.2")[0] for i in range(8)]
    s, _, out = req("POST", "/login", {"role": "programmer", "password": "open sesame"}, src="127.0.0.2")
    check("after 8 wrong passwords that address waits, even with the right one", codes[-1] == 401 and s == 429, (codes, s, out))
    s, _, _ = req("POST", "/login", {"role": "programmer", "password": "open sesame"})
    check("other addresses can still log in", s == 200)

    # ---------- the phone page
    phctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    ph = phctx.new_page(); watch(ph, "phone")
    ph.goto(f"http://127.0.0.1:{RP}/")
    check("the login page asks who you are, three choices", ph.locator(".role").count() == 3 and "Who are you?" in ph.inner_text("h1"))
    ph.click(".role[data-role=remote]"); ph.click("#go")
    check("Remote opens the phone page, live", until(ph, "document.querySelectorAll('.zone').length > 0 && document.querySelector('#conn').classList.contains('ok')"))
    zn = ph.locator(".zone .zhead b").all_inner_texts()
    check("one card per zone, top zone first", zn == H("olm.project.zones.slice().reverse().map(z => z.name)"), zn)
    now = ph.locator(".zone").first.locator(".now").inner_text()
    check("each card says what plays: the scene and its content", "Plasma" in now, now)
    check("each card has a dimmer and its scenes", ph.locator(".zone").first.locator(".dim input[type=range]").count() == 1 and ph.locator(".zone").first.locator(".scene").count() == 4)
    over = ph.evaluate("document.documentElement.scrollWidth - innerWidth")
    check("phone: no sideways scrolling", over <= 0, over)
    # play a scene
    ph.locator(".zone").first.locator(".scene", has_text="Blue pool").tap()
    check("tapping a scene plays it on the main computer, with its fade", until(host, "(() => { const z = olm.project.zones.at(-1); return z.scenes.find(s => s.id === z.scene).name === 'Blue pool' && !!z._fade; })()"))
    check("and the phone marks it playing", until(ph, "document.querySelector('.zone .scene.live b').textContent === 'Blue pool'"))
    # dim a zone, live while the finger moves
    box = ph.locator(".zone").nth(1).locator(".dim input").bounding_box()
    y = box["y"] + box["height"] / 2
    ph.mouse.move(box["x"] + box["width"] - 15, y); ph.mouse.down()
    ph.mouse.move(box["x"] + box["width"] * 0.6, y, steps=4); time.sleep(0.4)
    mid = H("olm.project.zones.at(-2).opacity")
    ph.mouse.move(box["x"] + box["width"] * 0.3, y, steps=4); ph.mouse.up()
    check("dimming follows the finger on the main computer (while it moves)", 0.45 < mid < 0.8, mid)
    check("and ends where the finger stops", until(host, "Math.abs(olm.project.zones.at(-2).opacity - 0.3) < 0.08"), H("olm.project.zones.at(-2).opacity"))
    # a second phone sees it
    ph2 = phctx.new_page(); watch(ph2, "phone2")
    ph2.goto(f"http://127.0.0.1:{RP}/remote")
    check("a phone opening /remote straight away logs itself in", until(ph2, "document.querySelectorAll('.zone').length === 3"))
    check("a second phone shows the same levels and scenes", until(ph2, "Math.abs(document.querySelectorAll('.zone .dim input')[1].value - 30) < 8 && document.querySelector('.zone .scene.live b').textContent === 'Blue pool'"))
    # changes on the main computer reach the phones
    H("(() => { const z = olm.project.zones.at(-1); z.name = 'Everything'; goScene(z, z.scenes[1], true); commit(); })()")
    check("a scene played on the main computer shows on the phone", until(ph, "document.querySelector('.zone .scene.live b').textContent === 'Fire and sparks' && document.querySelector('.zone .zhead b').textContent === 'Everything'"))
    H("toggleBlackout()")
    check("blackout on the main computer shows on the phone", until(ph, "!document.querySelector('#bo').hidden"))
    H("toggleBlackout()")
    check("and goes away", until(ph, "document.querySelector('#bo').hidden"))
    ph.screenshot(path=os.path.join(os.environ.get("SHOTS", "/tmp"), "remote-phone.png"), full_page=True)
    # tablet and computer sizes
    for (w, hh, cols) in [(820, 1180, 2), (1440, 900, 4)]:
        ph.set_viewport_size({"width": w, "height": hh}); time.sleep(0.3)
        n = ph.evaluate("getComputedStyle(document.querySelector('.zones')).gridTemplateColumns.split(' ').length")
        over = ph.evaluate("document.documentElement.scrollWidth - innerWidth")
        check(f"{w} px wide: {cols} columns, no sideways scrolling", n == cols and over <= 0, (n, over))
    ph.set_viewport_size({"width": 390, "height": 844})
    # what a phone may not do
    H("window.__m0 = olm.project.settings.master")
    ph.evaluate("(() => { const ws = new WebSocket(`ws://${location.host}/rws?token=${sessionStorage.getItem('olm.remote.token')}`); ws.onopen = () => { ws.send(JSON.stringify({ op: 'master', value: 0.1 })); ws.send(JSON.stringify({ op: 'blackout', on: true })); ws.send(JSON.stringify({ op: 'project', data: '{\"fixtures\":[]}' })); }; })()")
    time.sleep(1.2)
    check("a phone can't change the master, blackout or the project", H("olm.project.settings.master === window.__m0 && !ui.blackout && olm.project.fixtures.length === 9"))
    check("the main window lists the phones", H("[...remote.clients.values()].filter(c => c.role === 'remote').length") >= 2)

    # ---------- the operator
    octx = br.new_context(viewport={"width": 1280, "height": 800})
    op = octx.new_page(); watch(op, "operator")
    op.goto(f"http://127.0.0.1:{RP}/"); op.click(".role[data-role=operator]"); op.click("#go")
    check("operator: the interface, with the project of the main computer", until(op, "window.olm && remote.loaded && olm.project.fixtures.length === 9", 15000))
    O = op.evaluate
    check("the top bar says Operator; no Art-Net, Highlight or Nodes", "Operator" in op.inner_text("#btnRemote") and not op.is_visible("#btnOutput") and not op.is_visible("#hl") and not op.is_visible("#dockTabs [data-tab=nodes]"))
    check("no tools that draw fixtures, no + Add or SVG", op.locator("#rail button:visible").count() == 1 and not op.is_visible("#btnAddFx") and not op.is_visible("#btnImportSvg"))
    # the stage: select, but nothing moves
    fx = O("(() => { const f = olm.project.fixtures[0]; const r = document.querySelector('#view').getBoundingClientRect(); const [x, y] = toS(f.cx, f.cy); return [r.left + x, r.top + y, f.cx]; })()")
    op.mouse.move(fx[0], fx[1]); op.mouse.down(); op.mouse.move(fx[0] + 80, fx[1] + 40, steps=6); op.mouse.up(); time.sleep(0.6)
    check("dragging a fixture selects it but doesn't move it", O("ui.sel.size") >= 1 and O("olm.project.fixtures[0].cx") == fx[2] and H("olm.project.fixtures[0].cx") == fx[2], (O("olm.project.fixtures[0].cx"), H("olm.project.fixtures[0].cx")))
    op.locator("#view").hover(); op.keyboard.press("Delete"); op.keyboard.press("Control+d"); op.keyboard.press("l"); time.sleep(0.5)
    check("Delete, Ctrl D and the drawing keys do nothing", O("olm.project.fixtures.length") == 9 and O("ui.tool") == "select" and H("olm.project.fixtures.length") == 9)
    O("ui.rightTab = 'inspector'; renderRight()")
    dis = O("[...document.querySelectorAll('#rightBody input, #rightBody select')].every(e => e.disabled)")
    check("the fixture inspector is shown locked", dis and "can see the mapping" in op.inner_text("#rightBody"))
    O("ui.dockTab = 'patch'; renderDock()")
    check("the patch is shown locked", O("[...document.querySelectorAll('#dockBody .ctrl-edit input')].every(e => e.disabled)") and "can see the patch" in op.inner_text("#dockBody"))
    op.locator("#view").click(button="right", position={"x": 300, "y": 200}); time.sleep(0.2)
    check("no right-click menu on the stage", op.locator(".menu").count() == 0)
    op.click("#btnFile"); items = op.locator(".menu button").all_inner_texts(); op.keyboard.press("Escape")
    check("the Project menu only saves and exports", not any("New" in i or "Open" in i or "Import" in i for i in items) and any("Save" in i for i in items), items)
    # content: allowed, reaches the main computer
    O("(() => { const z = olm.project.zones.at(-2); selectZone(z); ui.rightTab = 'content'; renderRight(); })()")
    sel = op.locator("#rightBody .row:has-text('Source') select").first
    sel.select_option("b-rainbow")
    check("operator: changing a layer's source reaches the main computer", until(host, "olm.project.zones.at(-2).layers.some(L => L.src === 'b-rainbow')"), H("olm.project.zones.at(-2).layers.map(L => L.src)"))
    O("(() => { const z = olm.project.zones.at(-2); storeScene(z); })()")
    check("operator: storing a scene", until(host, "olm.project.zones.at(-2).scenes.length === 5"))
    O("(() => { const z = olm.project.zones.at(-2); goScene(z, z.scenes[2]); })()")
    check("operator: playing a scene fades on the main computer", until(host, "(() => { const z = olm.project.zones.at(-2); return z.scene === z.scenes[2].id; })()"))
    rng = op.locator(f"#rightBody input[data-zone-op]").first
    rng.evaluate("e => { e.value = 0.42; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    check("operator: a zone level, live", until(host, "olm.project.zones.some(z => Math.abs(z.opacity - 0.42) < 0.001)"))
    op.locator("#master").evaluate("e => { e.value = 0.55; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    check("operator: the master", until(host, "Math.abs(olm.project.settings.master - 0.55) < 0.001"))
    op.click("#btnBlackout")
    check("operator: blackout on the main computer", until(host, "ui.blackout === true"))
    op.click("#btnBlackout")
    check("and off again", until(host, "ui.blackout === false"))
    # a forged message: mapping changes are dropped, content goes through
    O("""(() => { const p = JSON.parse(serialize(false)); p.fixtures[0].cx += 300; p.fixtures.pop(); p.controllers[0].ip = '6.6.6.6'; p.settings.compW = 333;
      p.zones[0].name = 'Hacked'; p.zones[0].x = 77; p.zones[0].layers = [{ id: 'forged', src: 'b-solid', params: {}, opacity: 1, blend: 'alpha', on: true }];
      remoteOp({ op: 'project', data: JSON.stringify(p) }); })()""")
    check("a forged operator message: the content goes in", until(host, "olm.project.zones[0].layers.length === 1 && olm.project.zones[0].layers[0].src === 'b-solid'"))
    check("but fixtures, patch, settings and zone areas stay", H("cx => olm.project.fixtures.length === 9 && olm.project.fixtures[0].cx === cx && olm.project.controllers[0].ip === '10.0.0.50' && olm.project.settings.compW === 1000 && olm.project.zones[0].name !== 'Hacked' && olm.project.zones[0].x !== 77", fx[2]))
    check("and the operator is put right again", until(op, "olm.project.fixtures.length === 9 && olm.project.controllers[0].ip === '10.0.0.50'"))
    op.screenshot(path=os.path.join(os.environ.get("SHOTS", "/tmp"), "remote-operator.png"))

    # ---------- the programmer
    pctx = br.new_context(viewport={"width": 1280, "height": 800})
    pr = pctx.new_page(); watch(pr, "programmer")
    pr.goto(f"http://127.0.0.1:{RP}/"); pr.click(".role[data-role=programmer]"); pr.fill("#pw", "wrong"); pr.click("#go")
    check("a wrong password says so, and stays on the login page", until(pr, "document.querySelector('#msg').textContent.includes('Wrong password')") and pr.url.endswith("/"))
    pr.fill("#pw", "open sesame"); pr.press("#pw", "Enter")
    check("with the password: the whole interface", until(pr, "window.olm && remote.loaded && olm.project.fixtures.length === 9", 15000) and pr.locator("#rail button:visible").count() > 5)
    P_ = pr.evaluate
    check("no Art-Net button on a device", not pr.is_visible("#btnOutput"))
    fx = P_("(() => { const f = olm.project.fixtures[0]; const r = document.querySelector('#view').getBoundingClientRect(); const [x, y] = toS(f.cx, f.cy); return [r.left + x, r.top + y, f.cx]; })()")
    pr.mouse.move(fx[0], fx[1]); pr.mouse.down(); pr.mouse.move(fx[0] + 60, fx[1], steps=8); pr.mouse.up()
    check("programmer: dragging a fixture moves it on the main computer", until(host, "cx => olm.project.fixtures[0].cx > cx + 20", arg=fx[2]), (H("olm.project.fixtures[0].cx"), fx[2]))
    check("and the operator sees it move", until(op, "cx => olm.project.fixtures[0].cx > cx + 20", arg=fx[2]))
    P_("(() => { const f = newFixture('line', { x1: 100, y1: 600, x2: 400, y2: 600, pixels: 30, name: 'From the tablet' }); addFixture(f); })()")
    check("programmer: a new fixture", until(host, "olm.project.fixtures.some(f => f.name === 'From the tablet')"))
    P_("(() => { olm.project.controllers[0].ip = '10.0.0.77'; markPatch(); commit(); })()")
    check("programmer: the patch", until(host, "olm.project.controllers[0].ip === '10.0.0.77'"))
    P_("undo()")
    check("programmer: undo goes back on the main computer too", until(host, "olm.project.controllers[0].ip === '10.0.0.50'"))
    P_("(() => { const p = JSON.parse(serialize(false)); p.settings.bridgeUrl = 'ws://evil.example/ws'; p.name = 'Renamed by the programmer'; remoteOp({ op: 'project', data: JSON.stringify(p), seq: ++remote.seq }); })()")
    check("a programmer's project can't move the main window's Art-Net connection", until(host, "olm.project.name === 'Renamed by the programmer'") and H("olm.project.settings.bridgeUrl") == "", H("olm.project.settings.bridgeUrl"))
    H("(() => { olm.project.fixtures[1].name = 'Renamed here'; commit(); })()")
    check("a change on the main computer reaches the programmer", until(pr, "olm.project.fixtures[1].name === 'Renamed here'"))
    pr.click("#btnAddSrc"); items = pr.locator(".menu button").evaluate_all("l => l.map(b => [b.textContent, b.disabled])"); pr.keyboard.press("Escape")
    check("videos and screen capture are added on the main computer only", any("ISF" in t and not d for t, d in items) and all(d for t, d in items if "video" in t or "Screen" in t), items)
    P_("setOutput(true)"); time.sleep(0.6)
    check("a device can't switch Art-Net on", not H("ui.outputOn"))

    # ---------- everyone at once
    pr2 = pctx.new_page(); watch(pr2, "programmer2")
    pr2.goto(f"http://127.0.0.1:{RP}/app", wait_until="commit")   # four copies of the interface render on one computer here: don't wait for every file
    until(pr2, "document.readyState !== 'loading' && (!!window.olm || !!document.querySelector('.role'))", 30000)
    check("a second programmer tab in the same session gets in", until(pr2, "window.olm && remote.loaded", 30000) or "Who are you" in pr2.content())
    if "Who are you" in pr2.content():
        pr2.click(".role[data-role=programmer]"); pr2.fill("#pw", "open sesame"); pr2.click("#go"); until(pr2, "window.olm && remote.loaded", 15000)
    rnd = random.Random(7)
    devs = [("programmer", pr), ("programmer2", pr2), ("operator", op)]
    for i in range(60):
        name, pg = rnd.choice(devs)
        k = rnd.random()
        try:
            if k < 0.3: pg.evaluate("(i => { const z = olm.project.zones[i % olm.project.zones.length]; if (z.scenes.length) goScene(z, z.scenes[i % z.scenes.length]); })", i)
            elif k < 0.55: pg.evaluate("(v => { const z = olm.project.zones[0]; setZoneOpacity(z, v, true); commitSoft(); })", round(rnd.random(), 2))
            elif k < 0.75 and name != "operator": pg.evaluate("(d => { const f = olm.project.fixtures[2]; moveFixture(f, snapshotGeom(f), d, 0); markGeom(); commit(); })", rnd.choice([-5, 5]))
            elif k < 0.9: pg.evaluate("(v => { const L = olm.project.zones[1].layers[0]; if (L) { L.opacity = v; commitSoft(); } })", round(rnd.random(), 2))
            else:
                ph.locator(".zone").nth(rnd.randrange(3)).locator(".scene").first.tap()
        except Exception as e: errs.append(("fuzz", str(e)[:200]))
        time.sleep(rnd.random() * 0.12)
    time.sleep(3)
    hs = H("serialize(false)")
    same = {n: until(pg, "s => serialize(false) === s", 10000, hs) for n, pg in devs}
    check("after 60 changes from three devices and phones, every device has the main computer's project", all(same.values()), same)
    st = ph.evaluate("[...document.querySelectorAll('.zone')].map(c => [c.querySelector('.zhead b').textContent, Math.round(c.querySelector('.dim input').value)])")
    want = H("olm.project.zones.slice().reverse().map(z => [z.name, Math.round(z.opacity * 100)])")
    check("and the phone shows the same levels", st == want, (st, want))
    f0 = H("olm.frameIndex"); time.sleep(1.5)
    check("the main computer keeps rendering", H("olm.frameIndex") > f0, (f0, H("olm.frameIndex")))

    # ---------- the main window closes and comes back
    host.close()
    check("main window gone: the devices say they wait for it", until(ph, "!document.querySelector('#wait').hidden && document.querySelector('#waitMsg').textContent.includes('main computer')") and until(op, "!!document.querySelector('#remoteWait')"))
    host = hctx.new_page(); watch(host, "host2"); H = host.evaluate
    host.goto(f"http://127.0.0.1:{PORT}/"); host.wait_for_function("window.olm && olm.bridge.connected")
    check("reopened, it switches remote control on again by itself", until(host, "remote.status && remote.status.on && remote.clients.size >= 4", 10000), H("remote.status"))
    check("and the devices carry on without logging in again", until(ph, "document.querySelector('#wait').hidden") and until(op, "!document.querySelector('#remoteWait')") and until(pr, "!document.querySelector('#remoteWait')"))

    # ---------- a new password logs the programmers out
    H("remote.cfg.password = 'new one'; remoteConfigure()")
    check("a new password logs the programmers out, with a message", until(pr, "!!document.querySelector('#remoteWait') && document.querySelector('#remoteWait').innerText.includes('password changed')"))
    check("operators and phones stay", until(op, "!document.querySelector('#remoteWait')") and until(ph, "document.querySelector('#wait').hidden"))
    pr.click("#remoteWait button")
    try: pr.wait_for_url(f"http://127.0.0.1:{RP}/", timeout=8000); ok = True
    except Exception: ok = False
    check("Log in again goes to the login page", ok, pr.url)

    # ---------- switching off; a busy port
    H("remote.cfg.on = false; remoteConfigure()")
    check("switching off disconnects every device, with a message", until(ph, "!document.querySelector('#wait').hidden && document.querySelector('#waitMsg').textContent.includes('switched off')") and until(op, "!!document.querySelector('#remoteWait') && document.querySelector('#remoteWait').innerText.includes('switched off')"))
    time.sleep(0.5)
    check("and closes the port", not port_open(RP))
    blocker = socket.socket(); blocker.bind(("0.0.0.0", RP + 5)); blocker.listen(1)
    H(f"remote.cfg = {{ on: true, port: {RP + 5}, password: 'x' }}; remoteConfigure(); ui.rightTab = 'settings'; renderRight()")
    check("a port that is taken: Settings says so", until(host, "remote.status && remote.status.error && document.querySelector('#remoteSec').innerText.includes('not free')"), H("remote.status"))
    blocker.close()
    H("remote.cfg.on = false; remoteConfigure()")
    errs[:] = [e for e in errs if "WebSocket connection" not in e[1] and "ERR_CONNECTION_REFUSED" not in e[1] and "status of 401" not in e[1]]   # 401: the wrong passwords tried on purpose
    check("no page errors on any page", not errs, errs[:6])
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
