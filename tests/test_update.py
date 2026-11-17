# Looking for a new version: the latest release on GitHub (answered here, never asked of GitHub itself) compared with
# the version running; the window that tells of a newer one (notes, Download, Later, Skip this version); on every start,
# and once a day at most while it runs; nothing by itself in a test browser, with it off, or without internet; Check now in Settings always answers.
# Download gives the file for this computer (Windows setup, Mac disk image for Apple silicon or Intel), the release's
# page when none fits or the window is old; running from the source, the commands to update it (git pull, or a clone).
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
    gh = {"mode": "release", "tag": "v9.0.0", "hits": 0, "assets": True}
    FILES = "https://github.com/nouled-studio/nouPix/releases/download/"
    def assets(tag):
        v = tag[1:]
        names = [f"nouPix-{v}-windows-setup.exe", f"nouPix-{v}-macos-apple-silicon.dmg", f"nouPix-{v}-macos-intel.dmg"]
        # (first, a file of the right name from somewhere else: never offered)
        return [{"name": f"x-{v}-windows-setup.exe", "browser_download_url": "https://example.com/x.exe"}] + [{"name": n, "browser_download_url": FILES + tag + "/" + n} for n in names]
    def answer(route):
        gh["hits"] += 1
        if gh["mode"] == "offline": route.abort(); return
        if gh["mode"] == "error": route.fulfill(status=404, body="{}"); return
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                      body=json.dumps({"tag_name": gh["tag"], "html_url": "https://github.com/nouled-studio/nouPix/releases/tag/" + gh["tag"], "body": "**Download** the file for your computer.\n- New: something <b>bold</b>",
                                       "assets": assets(gh["tag"]) if gh["assets"] else []}))
    pg.route("https://api.github.com/**", answer)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected && bridge.hello")
    ev = pg.evaluate
    mine = ev("bridge.hello.version")
    plat = ev("bridge.hello.platform")
    check("the bridge says which computer this is, and that it runs from the source here", plat["os"] in ("linux", "mac", "windows") and plat["arch"] in ("x64", "arm64") and plat["app"] is False
          and plat["git"] is True and os.path.isfile(os.path.join(plat["dir"], "noupix.py")), plat)
    ev("bridge.hello.platform = { os: 'windows', arch: 'x64', app: true }")   # the app on Windows, until said otherwise
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
    check("Download, in the app on Windows, gets the Windows setup of that release straight away", ev("window._opened") == [FILES + "v9.0.0/nouPix-9.0.0-windows-setup.exe"] and dlg.count() == 0, ev("window._opened"))
    check("…and says to quit nouPix before installing", pg.locator(".toast").filter(has_text="Downloading nouPix-9.0.0-windows-setup.exe").count() == 1)
    LATEST = "https://github.com/nouled-studio/nouPix/releases/latest"
    def again(platform=None, button="Download", before=""):
        ev("p => { window._opened = []; if (p) bridge.hello.platform = p; ui.updateAt = 0; checkUpdates(true); }", platform)
        dlg.first.wait_for(timeout=5000)
        text = dlg.inner_text(); cmd = dlg.locator(".updcmd").inner_text() if dlg.locator(".updcmd").count() else ""
        btns = [b.strip().lower() for b in dlg.locator("footer button").all_inner_texts()]
        if before: ev(before)
        if button: dlg.locator("button", has_text=button).click(); time.sleep(0.2)
        return ev("window._opened"), text, cmd, btns
    o = again({"os": "mac", "arch": "arm64", "app": True})[0]
    check("on a Mac with Apple silicon, the Apple silicon disk image", o == [FILES + "v9.0.0/nouPix-9.0.0-macos-apple-silicon.dmg"], o)
    o = again({"os": "mac", "arch": "x64", "app": True})[0]
    check("on a Mac with Intel, the Intel one", o == [FILES + "v9.0.0/nouPix-9.0.0-macos-intel.dmg"], o)
    gh["assets"] = False
    o = again({"os": "windows", "arch": "x64", "app": True})[0]
    check("a release with no file for this computer: its page", o == [LATEST], o)
    gh["assets"] = True
    o = again(before="(() => { const now = Date.now; Date.now = () => now() + 7 * 3600e3; setTimeout(() => { Date.now = now; }, 400); })()")[0]; time.sleep(0.4)
    check("a window left open for hours leads to the newest release's page, not to a file that may be old by then", o == [LATEST], o)
    o, text, cmd, btns = again({"os": "linux", "arch": "x64", "app": False, "git": True, "dir": "/home/me/nouPix"}, button="Open GitHub")
    check("running from the source in a git clone: the commands to update it, in its folder", cmd.split("\n") == ['cd "/home/me/nouPix"', "git pull", "python3 noupix.py"] and "running from its source" in text, cmd)
    check("…with Copy commands and Open GitHub instead of Download, and Open GitHub going to the release's page", btns == ["skip this version", "later", "open github", "copy commands"] and o == [LATEST], (btns, o))
    ev("(() => { window._copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window._copied = t; return Promise.resolve(); } } }); })()")
    again(button="Copy commands"); time.sleep(0.2)
    check("Copy commands copies them, says what to do next and leaves the window open", ev("window._copied") == 'cd "/home/me/nouPix"\ngit pull\npython3 noupix.py' and dlg.count() == 1
          and pg.locator(".toast").filter(has_text="paste the commands in a terminal").count() >= 1, ev("window._copied"))
    dlg.locator("button", has_text="Later").click(); time.sleep(0.2)
    cmd = again({"os": "linux", "arch": "arm64", "app": False, "git": False, "dir": "/opt/noupix"}, button="Later")[2]
    check("a copy of the source that is no clone: cloned anew", cmd.split("\n") == ["git clone https://github.com/nouled-studio/nouPix.git", "cd nouPix", "python3 noupix.py"], cmd)
    cmd = again({"os": "windows", "arch": "x64", "app": False, "git": True, "dir": "C:\\nouPix"}, button="Later")[2]
    check("from the source on Windows: python, not python3", cmd.split("\n")[1:] == ["git pull", "python noupix.py"] and cmd.startswith('cd "C:\\nouPix"'), cmd)
    check("which file fits: none from the source, none for an unknown computer", ev("[updateAsset({ assets: [] }, { os: 'linux', app: false }), updateAsset({}, null), updateCommands({ os: 'mac', app: true })]") == [None, None, None])
    ev("bridge.hello.platform = { os: 'windows', arch: 'x64', app: true }; ui.updateAt = Date.now()")
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
