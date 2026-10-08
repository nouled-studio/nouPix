# The remote page as an app on a phone: its manifest, icons and service worker are served; Chrome finds it installable
# where the address counts as secure (localhost, or the network address with Chrome's "insecure origins treated as
# secure" setting) and says why not on plain http; the page works over the computer's network address, not only
# 127.0.0.1; and its Full screen button hides the browser's bars and brings them back.
import os, sys, time, json, struct, tempfile, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8164
RP = PORT + 1
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)
DIRECT = ['--proxy-server=direct://', '--proxy-bypass-list=*']   # devices reach the computer directly, as on a show network

bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    host = br.new_page(); host.goto(f"http://127.0.0.1:{PORT}/"); host.wait_for_function("window.olm && olm.bridge.connected")
    host.evaluate(f"(() => {{ const p = demoProject(); p.settings.fps = 10; olm.loadProject(p); remote.cfg = {{ on: true, port: {RP}, password: 'pw' }}; remoteConfigure(); }})()")
    host.wait_for_function("remote.status && remote.status.on")
    lan = [u for u in host.evaluate("remote.status.urls") if not u.startswith("http://127.")]
    lan = lan[0].rstrip("/") if lan else None

    # ---------- the files that make it an app
    get = lambda p: urllib.request.urlopen(f"http://127.0.0.1:{RP}{p}")
    r = get("/remote.webmanifest"); man = json.loads(r.read())
    check("the manifest is served as a manifest", "manifest+json" in r.headers["Content-Type"])
    check("it opens the remote page, without the browser's bars", man["start_url"] == "/remote" and man["display"] == "standalone" and man["name"] and man["short_name"], man)
    sizes = {}
    for ic in man["icons"]:
        r = get(ic["src"]); data = r.read()
        w, hh = struct.unpack(">II", data[16:24])
        sizes[ic["src"]] = (r.headers["Content-Type"], w, hh, ic.get("purpose"))
    check("its icons are PNGs of the sizes it says, one for round icons (maskable)", all(ct == "image/png" and f"{w}x{hh}" == next(i["sizes"] for i in man["icons"] if i["src"] == src) for src, (ct, w, hh, _) in sizes.items()) and any(p == "maskable" for *_, p in sizes.values()), sizes)
    r = get("/remote-sw.js")
    check("the service worker is served as JavaScript", "javascript" in r.headers["Content-Type"] and b"fetch" in r.read())
    html = get("/remote").read().decode()
    check("the remote page links the manifest; the login and the interface don't", 'rel="manifest"' in html and 'rel="manifest"' not in get("/").read().decode() and 'rel="manifest"' not in get("/app").read().decode())

    # ---------- installable where the address counts as secure
    def device(user_dir=False, extra=(), channel=None, url=None):
        args = CHROME_ARGS + DIRECT + list(extra)
        if user_dir:
            ctx = pw.chromium.launch_persistent_context(tempfile.mkdtemp(prefix="olm-phone-"), channel=channel, args=args, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            b2 = None
        else:
            b2 = pw.chromium.launch(args=args); ctx = b2.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
        pg.goto(url + "/remote"); pg.wait_for_function("document.querySelectorAll('.zone').length > 0 && document.querySelector('#conn').classList.contains('ok')", timeout=20000)
        time.sleep(1.5)
        cdp = ctx.new_cdp_session(pg)
        inst = [e["errorId"] for e in cdp.send("Page.getInstallabilityErrors")["installabilityErrors"]]
        info = pg.evaluate("(async () => ({ secure: isSecureContext, sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0 }))()")
        return ctx, b2, pg, inst, info
    ctx, b2, pg, inst, info = device(url=f"http://127.0.0.1:{RP}")
    check("on a secure address (localhost) Chrome finds it installable, with its service worker", inst == [] and info["secure"] and info["sw"] == 1, (inst, info))
    ctx.close(); b2 and b2.close()
    if not lan:
        print("SKIP: this computer has no network address besides 127.0.0.1")
    else:
        ctx, b2, pg, inst, info = device(url=lan)
        check(f"over the network address ({lan}) the phone page connects and shows the zones", pg.locator(".zone").count() == 3)
        # Full screen: the button hides the browser's bars (the Fullscreen API works on plain http too)
        check("a Full screen button", pg.is_visible("#full"))
        pg.click("#full"); time.sleep(0.4)
        on = pg.evaluate("!!document.fullscreenElement") and "on" in pg.get_attribute("#full", "class")
        pg.click("#full"); time.sleep(0.4)
        off = not pg.evaluate("!!document.fullscreenElement")
        check("it goes full screen, and back", on and off, (on, off))
        check("left on purpose, it stays off", pg.evaluate("localStorage.getItem('olm.remote.full')") == "0")
        pg.click("#full"); time.sleep(0.3); pg.evaluate("document.exitFullscreen()"); time.sleep(0.3)
        ctx.close(); b2 and b2.close()
        try:
            ctx, b2, pg, inst, info = device(user_dir=True, channel="chromium", url=lan)
            check("plain http on the network: Chrome says it can't install it (not a secure address)", inst == ["not-from-secure-origin"] and not info["secure"], (inst, info))
            ctx.close()
            ctx, b2, pg, inst, info = device(user_dir=True, channel="chromium", url=lan, extra=[f"--unsafely-treat-insecure-origin-as-secure={lan}"])
            check("with Chrome's 'insecure origins treated as secure' setting for that address: installable", inst == [] and info["secure"] and info["sw"] == 1, (inst, info))
            ctx.close()
        except Exception as e:
            print("SKIP: the full Chromium build isn't available here (%s)" % str(e)[:120])
    errs[:] = [e for e in errs if "googleapis" not in e and "ERR_CERT" not in e]
    check("no page errors", not errs, errs[:5])
    host.evaluate("remote.cfg.on = false; remoteConfigure()")
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
