# Opening and starting: the project's name follows its file (Save as, opening); a scene that plays when the project
# opens (one per zone, a playlist set to play on open first); the project that opens when nouPix starts (Settings,
# kept by the bridge, only the first window after it starts, following changes, --project FILE); a video's volume
# following its zone's level.
import os, sys, time, json, tempfile, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8216
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)
def wait(fn, t=6.0):
    end = time.time() + t
    while time.time() < end:
        v = fn()
        if v: return v
        time.sleep(0.2)
    return fn()

tmp = tempfile.mkdtemp()
os.environ["NOUPIX_STARTUP_FILE"] = os.path.join(tmp, "startup.noupix")
PROJ = """(() => { const p = blankProject('Show A'); p.settings.compW = 100; p.settings.compH = 50; p.settings.transition = 0;
  const z = newZone({ name: 'Z1', w: 100, h: 50, layers: [newLayer('b-rainbow')] });
  z.scenes = [{ id: 's1', name: 'Red', fade: 2, layers: [newLayer('b-solid')] }, { id: 's2', name: 'Plasma', fade: 2, layers: [newLayer('b-plasma')] }];
  p.zones = [z]; p.fixtures = [newFixture('line', { x1: 10, y1: 25, x2: 90, y2: 25, pixels: 4 })]; return p; })()"""
errs = []
def page(br, port):
    pg = br.new_page(viewport={"width": 1440, "height": 900})
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{port}/"); pg.wait_for_function("window.olm && olm.bridge.connected && olm.bridge.hello"); time.sleep(0.5)
    return pg

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = page(br, PORT); ev = pg.evaluate
    check("the first window of a bridge without a startup project opens its own", ev("!olm.bridge.hello.startup && !olm.bridge.hello.startupProject"))
    ev(f"olm.loadProject({PROJ})"); time.sleep(0.3)

    # ---------- the name follows the file
    ev("""(() => { window._written = [];
      const handle = name => ({ name, queryPermission: async () => 'granted', createWritable: async () => ({ write: async t => window._written.push(t), close: async () => {} }) });
      window.showSaveFilePicker = async o => window._next ? handle(window._next) : handle(o.suggestedName); projectFile = null; })()""")
    ev("saveProjectFile()"); time.sleep(0.4)
    check("saving under the name it suggests keeps the name as it is", ev("project.name") == "Show A" and ev("projectFile.name") == "Show-A.noupix", ev("project.name"))
    ev("window._next = 'name2.noupix'"); ev("saveProjectFile(true)"); time.sleep(0.4)
    check("Save as name2: the project is called name2, in the top bar and in the file", ev("project.name") == "name2" and pg.input_value("#projName") == "name2"
          and json.loads(ev("window._written.at(-1)"))["name"] == "name2", (ev("project.name"), pg.input_value("#projName")))
    ev("undo()")
    check("a step of undo", ev("project.name") == "Show A")
    ev("redo()")
    text = ev("projectText()")
    ev("t => openProjectFile(new File([t], 'Opened as this.noupix'))", text); time.sleep(0.4)
    check("opening a file takes its name", ev("project.name") == "Opened as this" and pg.input_value("#projName") == "Opened as this", ev("project.name"))

    # ---------- a scene that plays when the project opens
    ev(f"olm.loadProject({PROJ})"); time.sleep(0.3)
    ev("(() => { ui.dockTab = 'scenes'; ui.dockCollapsed = false; renderDock(); })()"); time.sleep(0.3)
    pg.locator(".scene[data-id=s2] .x").first.click()
    pg.get_by_text("Play when the project opens").click(); time.sleep(0.2)
    check("⋯ → Play when the project opens marks the scene", ev("project.zones[0].scenes.map(s => !!s.onOpen)") == [False, True]
          and pg.locator(".scene[data-id=s2] .au").count() >= 1)
    ev("setSceneOnOpen(project.zones[0], project.zones[0].scenes[0], true)")
    check("one per zone: choosing another moves it", ev("project.zones[0].scenes.map(s => !!s.onOpen)") == [True, False])
    ev("setSceneOnOpen(project.zones[0], project.zones[0].scenes[1], true)")
    ev("olm.loadProject(JSON.parse(serialize(true)))"); time.sleep(0.3)
    check("opening the project plays it at once", ev("project.zones[0].scene") == "s2" and ev("project.zones[0].layers[0].src") == "b-plasma")
    two = ev("hydrate({ zones: [{ scenes: [{ id: 'a', onOpen: true, layers: [] }, { id: 'b', onOpen: true, layers: [] }] }] }).zones[0].scenes.map(s => !!s.onOpen)")
    check("a file with two in one zone keeps the first", two == [True, False], two)
    ev("""(() => { const p = JSON.parse(serialize(true)), z = p.zones[0]; z.playlists = [newPlaylist({ autoplay: true, steps: [newStep('s1', 30)] })]; olm.loadProject(p); })()"""); time.sleep(0.5)
    check("a playlist set to play on open goes first", ev("project.zones[0].scene") == "s1", ev("project.zones[0].scene"))

    # ---------- the project that opens when nouPix starts
    ev(f"olm.loadProject({PROJ})"); ev("setSceneOnOpen(project.zones[0], project.zones[0].scenes[1], true)"); time.sleep(0.3)
    ev("(() => { ui.rightTab = 'settings'; renderRight(); })()"); time.sleep(0.2)
    box = pg.get_by_label("Open this project when nouPix starts")
    check("Settings has Open this project when nouPix starts, off", box.count() == 1 and not box.is_checked())
    box.check(); time.sleep(0.6)
    kept = lambda: json.load(open(os.environ["NOUPIX_STARTUP_FILE"]))
    check("ticking it gives the bridge a copy", wait(lambda: os.path.exists(os.environ["NOUPIX_STARTUP_FILE"]) and kept()["name"] == "Show A"))
    pid = ev("project.id")
    ev("(() => { project.name = 'Show A2'; commit(); })()")
    check("changes to it are kept as you work", wait(lambda: kept()["name"] == "Show A2"), kept()["name"])
    pg2 = page(br, PORT)
    check("another window (not the first since the bridge started) doesn't open it by itself", pg2.evaluate("!olm.bridge.hello.startupProject") and pg2.evaluate("olm.bridge.hello.startup.id") == pid)
    pg2.close(); pg.close()
    bridge.kill(); bridge.wait(); bridge = start_bridge(PORT)   # the old one gone first, its port free
    pg = page(br, PORT); ev = pg.evaluate
    check("after a restart the first window opens it", wait(lambda: ev("project.id") == pid and ev("project.name") == "Show A2"), ev("project.name"))
    check("playing the scene set to play on open", ev("project.zones[0].scene") == "s2")
    ev("(() => { ui.rightTab = 'settings'; renderRight(); })()"); time.sleep(0.2)
    box = pg.get_by_label("Open this project when nouPix starts")
    check("and Settings shows it ticked", box.is_checked())
    ev("olm.loadProject(demoProject())"); time.sleep(0.3); ev("renderRight()")
    check("another project: unticked, and it names the one that opens", not box.is_checked() and "Now Show A2 opens at start" in pg.inner_text("#rightBody"))
    box.check(); time.sleep(0.3); box.uncheck(); time.sleep(0.5)
    check("unticking it: none opens by itself", not os.path.exists(os.environ["NOUPIX_STARTUP_FILE"]))
    pg.close(); bridge.kill()
    # --project FILE
    given = os.path.join(tmp, "given.noupix")
    bridge = start_bridge(PORT, ("--project", given))
    pg = page(br, PORT); ev = pg.evaluate
    open(given, "w").write(ev(f"(() => {{ const p = {PROJ}; p.name = 'From the command line'; return JSON.stringify(p); }})()"))
    pg.close(); bridge.kill(); bridge.wait(); bridge = start_bridge(PORT, ("--project", given))
    pg = page(br, PORT); ev = pg.evaluate
    check("noupix.py --project FILE opens that file in the first window", wait(lambda: ev("project.name") == "From the command line"), ev("project.name"))

    # ---------- a video's volume follows its zone's level
    vol = ev("""(() => { const z = project.zones[0], src = { id: 'v1', kind: 'video', name: 'v', volume: 0.8, audio: true, volFollow: false };
      project.sources.push(src); z.layers = [newLayer('v1')]; z.layers[0].opacity = 0.5; z.opacity = 0.5;
      const a = videoVolume(src); src.volFollow = true; const b = videoVolume(src); z.opacity = 0; const c = videoVolume(src); z.layers[0].on = false; z.opacity = 1; const d = videoVolume(src);
      return [a, b, c, d]; })()""")
    check("a video's volume follows its zone's level and layer's opacity when asked (and only then)", vol == [0.8, 0.2, 0, 0], vol)
    check("the option is kept in files", ev("hydrate({ sources: [{ id: 'q', kind: 'video', name: 'q', volFollow: true }] }).sources.find(s => s.id === 'q').volFollow") is True
          and ev("hydrate({ sources: [{ id: 'q', kind: 'video', name: 'q' }] }).sources.find(s => s.id === 'q').volFollow") is False)
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill(); shutil.rmtree(tmp, ignore_errors=True)
print("FAILED:", fails or "none")
