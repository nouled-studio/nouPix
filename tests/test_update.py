# Looking for a new version: the latest release on GitHub (answered here, never asked of GitHub itself) compared with
# the version running; the window that tells of a newer one (notes, Download, Later, Skip this version); on every start,
# and once a day at most while it runs; nothing by itself in a test browser, with it off, or without internet; Check now in Settings always answers.
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8206
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) and "api.github.com" not in m.text and "Failed to load resource" not in m.text else None)
    # GitHub's answer, as the test wants it: a release, an error, or no connection
    gh = {"mode": "release", "tag": "v9.0.0", "hits": 0}
    def answer(route):
        gh["hits"] += 1
        if gh["mode"] == "offline": route.abort(); return
        if gh["mode"] == "error": route.fulfill(status=404, body="{}"); return
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                      body=json.dumps({"tag_name": gh["tag"], "html_url": "https://github.com/nouled-studio/nouPix/releases/tag/" + gh["tag"], "body": "**Download** the file for your computer.\n- New: something <b>bold</b>"}))
    pg.route("https://api.github.com/**", answer)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected && bridge.hello")
    ev = pg.evaluate
    mine = ev("bridge.hello.version")
    dlg = pg.locator(".modal[aria-label='New version']")
    time.sleep(5)
    check("a test browser doesn't look by itself", gh["hits"] == 0 and dlg.count() == 0, gh["hits"])
    check("versions compare by their numbers", ev("[newerVersion('1.10.0', '1.9.9'), newerVersion('v2.0.0', '1.9.9'), newerVersion('1.1.0', '1.1.0'), newerVersion('1.0.9', '1.1.0'), newerVersion('1.1', '1.0.9')]") == [True, True, False, False, True])

    # ---------- by itself: as a normal browser would, once the version is known
    ev("(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); ui.updateAt = 0; ui.updateSkip = ''; })()")
    ev("checkUpdates(false)"); time.sleep(0.6)
    check("a newer release: the window tells of it", dlg.count() == 1 and "nouPix 9.0.0 is available" in dlg.inner_text() and f"You have {mine}" in dlg.inner_text(), dlg.inner_text() if dlg.count() else "")
    nt = pg.locator(".updnotes").inner_text()
    check("with its notes, as plain text", "New: something <b>bold</b>" in nt and nt.startswith("Download the file") and pg.locator(".updnotes b").count() == 0, nt)
    check("and it is remembered that it looked", abs(ev("Date.now() - ui.updateAt")) < 5000 and ev("JSON.parse(localStorage.getItem('noupix.ui')).updateAt") == ev("ui.updateAt"))
    ev("(() => { window._opened = []; window.open = (u, t) => { window._opened.push(u); return null; }; })()")
    dlg.locator("button", has_text="Download").click(); time.sleep(0.2)
    check("Download opens the latest release's page (the newest, even if one came out after the window was shown)", ev("window._opened") == ["https://github.com/nouled-studio/nouPix/releases/latest"] and dlg.count() == 0, ev("window._opened"))
    h0 = gh["hits"]
    ev("checkUpdates(false)"); time.sleep(0.5)
    check("not again the same day", gh["hits"] == h0 and dlg.count() == 0)
    ev("ui.updateAt = Date.now() - 21 * 3600e3; checkUpdates(false)"); time.sleep(0.5)
    check("the next day, again", gh["hits"] == h0 + 1 and dlg.count() == 1)
    dlg.locator("button", has_text="Later").click(); time.sleep(0.2)
    check("Later closes it", dlg.count() == 0)
    ev("ui.updateAt = Date.now(); checkUpdates(false, true)"); time.sleep(0.5)
    check("every time nouPix starts, even if it looked earlier that day", gh["hits"] == h0 + 2 and dlg.count() == 1)
    dlg.locator("button", has_text="Later").click(); time.sleep(0.2)
    check("starting looks with atStart, and keeps looking once a day while it runs", "checkUpdates(false, true)" in ev("showVersion.toString()") and "setInterval" in ev("showVersion.toString()"))
    ev("ui.updateAt = 0; checkUpdates(false)"); time.sleep(0.5)
    dlg.locator("button", has_text="Skip this version").click(); time.sleep(0.2)
    check("Skip this version is remembered", ev("ui.updateSkip") == "9.0.0" and ev("JSON.parse(localStorage.getItem('noupix.ui')).updateSkip") == "9.0.0")
    ev("ui.updateAt = 0; checkUpdates(false)"); time.sleep(0.5)
    check("that version isn't told of again by itself", dlg.count() == 0)
    gh["tag"] = "v9.0.1"
    ev("ui.updateAt = 0; checkUpdates(false)"); time.sleep(0.5)
    check("a later one is", dlg.count() == 1 and "9.0.1" in dlg.inner_text())
    dlg.locator("button", has_text="Later").click()
    gh["tag"] = "v" + mine
    ev("ui.updateAt = 0; checkUpdates(false)"); time.sleep(0.5)
    check("the same version: nothing", dlg.count() == 0 and pg.locator(".toast").filter(has_text="latest").count() == 0)
    gh["mode"] = "offline"; h0 = gh["hits"]
    ev("ui.updateAt = 0; checkUpdates(false)"); time.sleep(0.5)
    check("no internet: nothing said", gh["hits"] == h0 + 1 and dlg.count() == 0 and pg.locator(".toast").filter(has_text="GitHub").count() == 0 and ev("ui.updateAt") == 0)
    gh["mode"] = "release"; h0 = gh["hits"]
    ev("ui.updates = false; ui.updateAt = 0; checkUpdates(false)"); time.sleep(0.5)
    check("switched off: it doesn't look", gh["hits"] == h0)
    ev("ui.updates = true")

    # ---------- Settings → Updates: the switch and Check now
    ev("(() => { ui.rightTab = 'settings'; showRight(true); renderRight(); })()"); time.sleep(0.2)
    cb = pg.locator("#rightBody label.checkrow:has-text('Look for new versions') input[type=checkbox]")
    check("Settings → This computer → Look for new versions: on at first", cb.count() == 1 and cb.is_checked())
    cb.uncheck(); time.sleep(0.2)
    check("turning it off is kept", ev("ui.updates") is False and ev("JSON.parse(localStorage.getItem('noupix.ui')).updates") is False)
    cb.check()
    gh["tag"] = "v" + mine
    pg.locator("#rightBody button", has_text="Check now").click(); time.sleep(0.6)
    check("Check now with the latest: says so", pg.locator(".toast").filter(has_text=f"nouPix {mine} is the latest version").count() >= 1)
    gh["tag"] = "v9.0.0"
    pg.locator("#rightBody button", has_text="Check now").click()
    try: dlg.first.wait_for(timeout=5000)   # the answer comes when it comes: on a busy machine, later than a moment
    except Exception: pass
    check("Check now tells of a skipped version too", dlg.count() == 1)
    dlg.locator("button", has_text="Later").click()
    gh["mode"] = "error"
    pg.locator("#rightBody button", has_text="Check now").click(); time.sleep(0.6)
    check("Check now when GitHub can't be reached: says so", pg.locator(".toast").filter(has_text="Couldn't reach GitHub").count() >= 1)

    # ---------- a device on the network never looks
    check("devices don't look (only the main computer)", "REMOTE_CLIENT" in ev("showVersion.toString()"))
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED:", fails or "none")
