# nouPix's look and name (1.0): the fonts come with the app, black by default and white one click away (the top
# bar's button and Settings, kept on this computer, the MIDI and Scenes windows and the stage follow), colours only
# on groups and zones (none at first, chosen by the user; fixtures and scenes show them), sliders filled up to their
# value, the scene tiles' cuts, the name, the file format, and what openLedMapper kept carried over.
import os, sys, time, json, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, FAKE_MIDI
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8192
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  # ---------- the fonts are the app's own: served from css/, nothing from the internet
  r = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/css/saira-latin.woff2")
  check("the bridge serves the fonts kept in css/", r.status == 200 and r.headers["Content-Type"] == "font/woff2" and len(r.read()) > 10000)
  page = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/").read().decode()
  check("the page asks nothing of Google Fonts", "fonts.googleapis" not in page and 'href="css/fonts.css"' in page)
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(FAKE_MIDI)
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    outside = []; pg.on("request", lambda q: outside.append(q.url) if not q.url.startswith(("http://127.0.0.1", "data:", "blob:")) else None)
    ev = pg.evaluate
    def settle(t=0.3): time.sleep(t)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); settle(0.8)
    ev("document.fonts.ready"); settle(0.3)
    fams = ev("[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family)")
    check("Saira, Chakra Petch and JetBrains Mono load", all(f in fams for f in ["Saira", "Chakra Petch", "JetBrains Mono"]), fams)
    check("and nothing is fetched from outside this computer", not outside, outside[:3])
    css = lambda sel, prop: ev(f"getComputedStyle(document.querySelector({json.dumps(sel)})).{prop}")

    # ---------- the name
    check("the window says nouPix, with the version", pg.title() == "nouPix" and ev("document.querySelector('.brand').title").startswith("nouPix ")
          and pg.locator(".brand-word[aria-label=nouPix]").count() == 1)

    # ---------- black by default
    check("black by default", ev("ui.theme") == "dark" and css("body", "backgroundColor") == "rgb(0, 0, 0)" and not ev("document.documentElement.dataset.theme === 'light'"))
    check("running text in Saira 300, labels in Chakra Petch", css("body", "fontWeight") == "300" and "Saira" in css("body", "fontFamily")
          and "Chakra Petch" in css(".phead h2", "fontFamily") and css(".phead h2", "textTransform") == "uppercase")
    check("square corners", css(".btn", "borderRadius") == "0px" and css(".pill", "borderRadius") == "0px")
    check("Art-Net's rate shows in the status bar, not the top bar, so the top bar doesn't move",
          ev("(() => { setOutput(true); updateBridgeUI(); const p = document.querySelector('#bridgePill'), r = !!p.closest('.statusbar') && !p.closest('.topbar') && !p.hidden && /pkt\\/s/.test(p.textContent); return r; })()"))
    check("Art-Net is on from the start, with no button in the top bar; Blackout is a red icon", ev("ui.outputOn") and pg.locator("#btnOutput").count() == 0
          and css("#btnBlackout", "color") == "rgb(255, 59, 59)" and pg.locator("#btnBlackout svg").count() == 1)
    ev("(() => { ui.rightTab = 'settings'; renderRight(); })()"); settle(0.3)
    pg.click("label[for=outputOn]"); settle(0.3)
    check("Settings → Art-Net connection switches it off, and the status bar says so", not ev("ui.outputOn") and "Art-Net off" in pg.text_content("#bridgePill") and pg.is_visible("#bridgePill"))
    pg.click("label[for=outputOn]"); settle(0.3)
    check("and on again", ev("ui.outputOn") and "Sending" in pg.text_content("#bridgePill"))
    ev("toggleBlackout()"); settle(0.3)
    check("Blackout on breathes red", "bobreathe" in css("#btnBlackout", "animationName"))
    ev("toggleBlackout()")

    # ---------- white one click away, kept on this computer
    pg.click("#btnTheme"); settle(0.4)
    check("the top bar's button turns it white", ev("document.documentElement.dataset.theme") == "light" and css("body", "backgroundColor") != "rgb(0, 0, 0)"
          and ev("ui.theme") == "light" and pg.get_attribute("#btnTheme", "aria-pressed") == "true")
    check("the canvas stays black, so the fixtures look the same; around it the stage is white, with a halo under what crosses the canvas",
          ev("SC.canvas") == "#000000" and ev("SC.dot") == "#000000" and ev("SC.out") == "#ffffff" and ev("SC.halo") == "#ffffff")
    check("kept with this computer's preferences, not in the project", ev("store.get('noupix.ui', {}).theme") == "light" and "theme" not in ev("JSON.parse(serialize(true))"))
    pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); settle(0.6)
    check("and still white after a reload, from the start", ev("document.documentElement.dataset.theme") == "light" and ev("ui.theme") == "light")
    ev("(() => { ui.rightTab = 'settings'; renderRight(); })()"); settle(0.3)
    look = pg.locator(".sec", has_text="Interface")
    check("Settings has the same choice", look.count() == 1 and look.locator(".seg button.on").inner_text().strip().lower() == "white")
    look.locator(".seg button", has_text="Black").click(); settle(0.4)
    check("and turns it black again", ev("ui.theme") == "dark" and ev("document.documentElement.dataset.theme") == "dark" and css("body", "backgroundColor") == "rgb(0, 0, 0)")

    # ---------- the windows this page draws into follow
    ev("(() => { olm.loadProject(demoProject()); ui.dockTab = 'scenes'; ui.dockCollapsed = false; renderDock(); })()"); settle(0.6)
    with pg.expect_popup() as pi: pg.click("#dockBody button[aria-label='Open in a window']")
    W = pi.value; settle(0.8)
    check("the Scenes window has the same look", W.evaluate("document.documentElement.dataset.theme") == "dark" and W.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(0, 0, 0)")
    ev("setTheme('light')"); settle(0.4)
    check("and changes with it", W.evaluate("document.documentElement.dataset.theme") == "light" and W.evaluate("getComputedStyle(document.body).backgroundColor") != "rgb(0, 0, 0)")
    ev("setTheme('dark')"); settle(0.3)
    W.close(); settle(0.8)

    # ---------- colours: only a group's and a zone's, none at first
    ev("(() => { olm.loadProject(demoProject()); })()"); settle(0.5)
    p = ev("JSON.parse(serialize(true))")
    check("the demo has no colours: none on fixtures or scenes, none chosen for groups and zones",
          not any("tag" in f for f in p["fixtures"]) and not any("tag" in s for z in p["zones"] for s in z["scenes"])
          and all(g["tag"] == "" for g in p["groups"]) and all(z["tag"] == "" for z in p["zones"]), [g["tag"] for g in p["groups"]])
    ev("(() => { addFixture(newFixture('line', { x1: 10, y1: 10, x2: 200, y2: 10 })); })()"); settle(0.2)
    ev("(() => { ui.sel = new Set(project.fixtures.slice(-1).map(f => f.id)); groupSel(); })()"); settle(0.3)
    g = ev("project.groups.at(-1)")
    check("a new group, fixture and zone get none", g["tag"] == "" and "tag" not in ev("project.fixtures.at(-1)") and ev("(() => { addZone({ x: 0, y: 0, w: 100, h: 100 }); return project.zones.at(-1).tag; })()") == "")
    ev("(() => { const g = project.groups.find(g => g.name === 'Rings'); ui.sel = new Set(project.fixtures.filter(f => f.group === g.id).map(f => f.id)); ui.rightTab = 'inspector'; onSelection(); renderRight(); })()"); settle(0.3)
    sw = pg.locator(".right .swatches button")
    check("the group's colour: None, then the eight saturated ones", sw.count() == 9 and "none" in sw.nth(0).get_attribute("class") and "on" in sw.nth(0).get_attribute("class"))
    sw.nth(2).click(); settle(0.3)
    rings = ev("project.groups.find(g => g.name === 'Rings')")
    check("one is chosen", rings["tag"] == ev("TAGS[1]"))
    check("its fixtures show it: in the list and on the stage", ev("project.fixtures.filter(f => f.group === project.groups.find(g => g.name === 'Rings').id).every(f => fxTag(f) === TAGS[1])")
          and ev("[...document.querySelectorAll('#fxList li.in .tag')].some(t => getComputedStyle(t).backgroundColor !== 'rgba(0, 0, 0, 0)')"))
    ev("undo()"); settle(0.3)
    check("a step of undo", ev("project.groups.find(g => g.name === 'Rings').tag") == "")
    ev("(() => { const z = project.zones.find(z => z.name === 'Rings'); ui.sel = new Set(); selectZone(z); setTool('zone'); ui.rightTab = 'inspector'; renderRight(); ui.dockTab = 'scenes'; renderDock(); })()"); settle(0.3)
    pg.locator(".right .swatches button").nth(4).click(); settle(0.3)
    zid = ev("project.zones.find(z => z.name === 'Rings').id")
    check("a zone's colour edges its scenes", ev(f"zoneById('{zid}').tag") == ev("TAGS[3]")
          and ev(f"[...document.querySelectorAll('.zoneblock')].some(b => [...b.querySelectorAll('.scene')].some(s => s.style.getPropertyValue('--tag') === TAGS[3]))"))
    check("and its scenes have none of their own", not any("tag" in s for s in ev(f"zoneById('{zid}').scenes")))
    ev("setTool('select')")

    # ---------- files: colours of before are dropped, the user's kept; the old format opens
    old = ev("(() => { const p = JSON.parse(serialize(true)); p.format = 'openledmapper-project'; p.version = 3; p.groups[0].tag = '#3cc8ff'; const z = p.zones.find(z => z.scenes.length); z.tag = '#ffb341'; p.fixtures[0].tag = '#46e08c'; z.scenes[0].tag = '#ff6f86'; return p; })()")
    ev("p => olm.loadProject(p)", old); settle(0.3)
    q = ev("JSON.parse(serialize(true))"); qz = next(z for z in q["zones"] if z["scenes"])
    check("a project from openLedMapper opens, without its automatic colours", q["format"] == "noupix-project" and q["version"] == 4
          and q["groups"][0]["tag"] == "" and qz["tag"] == "" and "tag" not in q["fixtures"][0] and "tag" not in qz["scenes"][0], (q["format"], q["version"], q["groups"][0]["tag"], qz["tag"], q["fixtures"][0].get("tag"), qz["scenes"][0].get("tag")))
    mine = dict(q); mine["groups"] = [dict(q["groups"][0], tag="#5ba59b")] + q["groups"][1:]
    ev("p => olm.loadProject(p)", mine); settle(0.3)
    check("colours chosen in nouPix are kept", ev("project.groups[0].tag") == "#5ba59b", (mine["version"], ev("project.groups.map(g => g.tag)")))
    # where the browser can't write files, each save downloads a copy, named .noupix
    ev("(() => { window._picker = window.showSaveFilePicker; window.showSaveFilePicker = undefined; })()")
    with pg.expect_download() as dl: ev("saveProjectFile()")
    check("projects are saved as .noupix", dl.value.suggested_filename.endswith(".noupix") and not dl.value.suggested_filename.endswith(".json"), dl.value.suggested_filename)
    # where it can: the first Save asks for the file, the next ones write over it, Save as asks again; autosave follows
    ev("""(() => { window._asked = 0; window._written = [];
      const handle = name => ({ name, queryPermission: async () => 'granted', createWritable: async () => ({ write: async t => window._written.push(t), close: async () => {} }) });
      window.showSaveFilePicker = async o => { window._asked++; return handle(o.suggestedName); }; projectFile = null; })()""")
    ev("saveProjectFile()"); settle(0.3); ev("saveProjectFile()"); settle(0.3)
    check("Save asks where only the first time, then writes over the same file", ev("window._asked") == 1 and ev("window._written.length") == 2 and ev("projectFile.name").endswith(".noupix"), (ev("window._asked"), ev("window._written.length")))
    ev("saveProjectFile(true)"); settle(0.3)
    check("Save as asks again", ev("window._asked") == 2 and ev("window._written.length") == 3)
    ev("(() => { setAutosave(true); project.name = 'Autosaved'; commit(); })()"); settle(2.6)
    check("with autosave on, a change reaches the file by itself", ev("window._asked") == 2 and "Autosaved" in ev("window._written.at(-1)"), ev("window._written.length"))
    ev("(() => { setAutosave(false); const n = window._written.length; project.name = 'Not autosaved'; commit(); window._n = n; })()"); settle(2.6)
    check("and with it off, it doesn't", ev("window._written.length === window._n"))
    ev("(() => { window.showSaveFilePicker = window._picker; projectFile = null; })()")

    # ---------- sliders: filled up to their value
    fill = lambda sel: ev(f"document.querySelector({json.dumps(sel)}).style.getPropertyValue('--p')")
    ev("(() => { project.settings.master = 0.25; renderAll(); })()"); settle(0.2)
    check("a slider's track is filled up to its value", fill("#master") == "25%", fill("#master"))
    pg.locator("#master").evaluate("e => { e.value = 0.8; e.dispatchEvent(new Event('input', { bubbles: true })); }"); settle(0.2)
    check("and follows it when moved", fill("#master") == "80%", fill("#master"))
    zr = ev("project.zones.at(-1).id")
    ev(f"setZoneOpacity(zoneById('{zr}'), 0.4)"); settle(0.2)
    check("and when something else moves it (a fader, a device)", ev(f"document.querySelector('input[data-zone-op=\"{zr}\"]').style.getPropertyValue('--p')") == "40%")
    check("drawn by the app, not the browser's round handle", css("#master", "appearance") == "none" and css("#master", "accentColor") == ev("getComputedStyle(document.documentElement).getPropertyValue('--fader').trim().replace(/^#(..)(..)(..)$/, (m, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`)"))

    # ---------- scene tiles: the logo's two cuts; the playing one white with one red mark
    ev("(() => { ui.dockTab = 'scenes'; renderDock(); })()"); settle(0.3)
    tile = "#dockBody .scene"
    clip = ev(f"getComputedStyle(document.querySelector('{tile}'), '::before').clipPath")
    check("a scene tile has the cut corners", clip.startswith("polygon(8px 0px"), clip)
    z0 = ev("project.zones.at(-1).id")
    ev(f"goScene(zoneById('{z0}'), zoneById('{z0}').scenes[0], true)"); settle(0.3)
    live = pg.locator("#dockBody .scene.live").first
    check("the playing one: a white edge and the red mark", live.evaluate("e => getComputedStyle(e, '::before').backgroundColor") == "rgb(255, 255, 255)"
          and "rgb(255, 59, 59)" in live.evaluate("e => getComputedStyle(e, '::after').backgroundImage"))

    # ---------- the sources' height: dragged on their top edge, kept, back to the usual on a double-click
    hs = lambda: ev("(() => { const l = document.querySelector('.left').getBoundingClientRect(), s = document.querySelector('.left .sources').getBoundingClientRect(); return s.height / l.height; })()")
    before = hs(); g = pg.locator("#srcGrip").bounding_box(); gx, gy = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    pg.mouse.move(gx, gy); pg.mouse.down(); pg.mouse.move(gx, gy - 200, steps=6); pg.mouse.up(); settle(0.2)
    check("the sources get taller when their top edge is dragged up", hs() > before + 0.15 and abs(ev("ui.srcH") - hs()) < 0.03, (before, hs(), ev("ui.srcH")))
    check("and the list shows more of them", ev("document.querySelector('.left .sources .pbody, .left .sources ul, #srcList').clientHeight") > 300, ev("document.querySelector('.left .sources .pbody, .left .sources ul, #srcList').clientHeight"))
    check("their height is kept", abs(ev("store.get('noupix.ui', {}).srcH") - ev("ui.srcH")) < 1e-9)
    pg.mouse.move(gx, gy - 200); pg.mouse.down(); pg.mouse.move(gx, 890, steps=6); pg.mouse.up(); settle(0.2)
    check("never smaller than a few rows", ev("ui.srcH") >= 0.15 and ev("document.querySelector('.left .fixtures').getBoundingClientRect().height") > 60, ev("ui.srcH"))
    pg.locator("#srcGrip").dblclick(); settle(0.2)
    check("a double-click gives the usual height", abs(ev("ui.srcH") - 0.42) < 1e-9 and abs(hs() - before) < 0.02, (ev("ui.srcH"), hs(), before))

    # ---------- what openLedMapper kept in this browser carries over
    ev("(() => { for (const k of ['ui', 'remote', 'colors']) localStorage.removeItem('noupix.' + k); localStorage.setItem('openledmapper.colors', JSON.stringify(['#123456'])); localStorage.setItem('openledmapper.remote', JSON.stringify({ on: false, port: 8099, password: 'x' })); })()")
    pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); settle(0.5)
    check("openLedMapper's saved settings carry over, once", ev("store.get('noupix.colors', [])") == ["#123456"] and ev("store.get('noupix.remote', {}).port") == 8099
          and ev("localStorage.getItem('openledmapper.colors') === null"))

    check("no errors", not errs, errs[:5])
    br.close()
finally:
  bridge.terminate()
print("FAILED:", fails or "none")
