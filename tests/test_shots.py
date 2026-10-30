# Snapshots on scenes: a scene's ⋯ menu takes a snapshot of its zone as it shows now, on the scene's button;
# with Settings → Scenes → Auto snapshot, storing or updating a scene takes one too (off by default). Undo,
# removing it, files (kept, bad ones dropped) and the setting.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8232
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 950})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    ev("""(() => { const p = blankProject('Shots'); p.fixtures.push(newFixture('line', { x1: 100, y1: 300, x2: 900, y2: 300, pixels: 20 }));
      p.zones[0].layers = [newLayer('b-rainbow')]; olm.loadProject(JSON.parse(JSON.stringify(p, replacer)));
      ui.dockTab = 'scenes'; ui.dockCollapsed = false; renderDock(); })()""")
    time.sleep(0.8)
    Z = "olm.project.zones[0]"
    # how bright a picture is, from its data URL (0 to 255)
    def bright(url_expr):
        return ev(f"""(async () => {{ const u = {url_expr}; if (!u) return -1; const im = new Image(); im.src = u; await im.decode();
          const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4); }})()""")

    check("Auto snapshot is off by default", ev("project.settings.sceneShots") is False)
    ev(f"storeScene({Z})"); time.sleep(0.3)
    check("off: a scene stored has no picture", ev(f"{Z}.scenes[0].thumb") is None)
    sid = ev(f"{Z}.scenes[0].id")
    tile = pg.locator(f"#dockBody .scene[data-id='{sid}'], .scene[data-id='{sid}']").first
    tile.locator(".x").click(); time.sleep(0.2)
    item = pg.locator(".menu :text-is('Take snapshot')")
    check("its ⋯ menu offers a picture", item.count() == 1)
    h0 = ev("hist.idx"); item.click(); time.sleep(0.3)
    thumb = ev(f"{Z}.scenes[0].thumb") or ""
    check("the picture is taken: a small JPEG, one step of undo", thumb.startswith("data:image/jpeg;base64,") and len(thumb) < 60000 and ev("hist.idx") == h0 + 1, (thumb[:40], len(thumb)))
    check("it shows what plays (a lit picture, not black)", bright(f"{Z}.scenes[0].thumb") > 40, bright(f"{Z}.scenes[0].thumb"))
    tile = pg.locator(f".scene[data-id='{sid}']").first
    check("the scene's button shows it", "shot" in tile.get_attribute("class") and "data:image/jpeg" in tile.evaluate("t => t.style.getPropertyValue('--shot')")
          and "data:image/jpeg" in tile.evaluate("t => getComputedStyle(t, '::after').backgroundImage"))
    ev("undo()"); time.sleep(0.3)
    check("undo takes the picture away", ev(f"{Z}.scenes[0].thumb") is None and "shot" not in (pg.locator(f".scene[data-id='{sid}']").first.get_attribute("class") or ""))
    ev("redo()"); time.sleep(0.3)
    pg.locator(f".scene[data-id='{sid}'] .x").first.click(); time.sleep(0.2)
    check("with a picture, the menu offers a new one and removing it", pg.locator(".menu :text-is('Retake snapshot')").count() == 1 and pg.locator(".menu :text-is('Remove snapshot')").count() == 1)
    pg.locator(".menu :text-is('Remove snapshot')").click(); time.sleep(0.2)
    check("Remove its picture removes it", ev(f"{Z}.scenes[0].thumb") is None)

    # the setting
    ev("ui.rightTab = 'settings'; renderRight()"); time.sleep(0.2)
    box = pg.locator("#rightBody label:has-text('Auto snapshot') input")
    box.scroll_into_view_if_needed(); box.check(); time.sleep(0.2)
    check("Settings → Scenes → Auto snapshot turns it on", ev("project.settings.sceneShots") is True)
    ev(f"storeScene({Z})"); time.sleep(0.3)
    check("on: a scene stored gets a picture", (ev(f"{Z}.scenes[1].thumb") or "").startswith("data:image/jpeg"))
    first = ev(f"{Z}.scenes[1].thumb")
    ev(f"{Z}.layers[0].src = 'b-bars'; {Z}.layers[0].opacity = 1; markGeom()"); time.sleep(0.8)
    pg.locator(f".scene[data-id='{ev(Z + '.scenes[1].id')}'] .x").first.click(); time.sleep(0.2)
    pg.locator(".menu :text('Update with Zone 1')").click(); time.sleep(0.3)
    check("on: updating a scene takes a new picture", ev(f"{Z}.scenes[1].thumb") != first and ev(f"{Z}.scenes[1].layers[0].src") == "b-bars")
    ev(f"{Z}.layers = []"); time.sleep(0.5)
    ev(f"takeSceneShot({Z}, {Z}.scenes[0])"); time.sleep(0.2)
    check("a zone that shows nothing gives a dark picture, no error", bright(f"{Z}.scenes[0].thumb") < 5, bright(f"{Z}.scenes[0].thumb"))

    # a zone hidden under another (not drawn for the output) is drawn for its picture
    ev(f"""(() => {{ const low = newZone({{ name: 'Low', x: 0, y: 0, w: project.settings.compW, h: project.settings.compH }}); low.layers = [newLayer('b-rainbow')];
      project.zones.unshift(low); {Z.replace('[0]', '[1]')}.layers = [newLayer('b-bars')]; {Z.replace('[0]', '[1]')}.opacity = 1; commit(); }})()"""); time.sleep(0.6)
    check("the lower zone is hidden under the other", ev("hiddenZone(0)"))
    ev("storeScene(olm.project.zones[0])"); time.sleep(0.3)
    check("a hidden zone's scene gets a lit picture all the same", bright("olm.project.zones[0].scenes[0].thumb") > 40, bright("olm.project.zones[0].scenes[0].thumb"))
    ev("olm.project.zones.shift(); commit()"); time.sleep(0.2)

    # files
    saved = json.loads(ev("serialize()"))
    check("pictures and the setting are saved", saved["settings"]["sceneShots"] is True and saved["zones"][0]["scenes"][1]["thumb"].startswith("data:image/jpeg"))
    ev("""(() => { const p = blankProject('Bad'); p.zones[0].scenes = [{ id: 'a', name: 'A', layers: [], thumb: 'javascript:alert(1)' }, { id: 'b', name: 'B', layers: [], thumb: 42 },
        { id: 'c', name: 'C', layers: [], thumb: 'data:image/png;base64,iVBORw0KGgo=' }]; p.settings.sceneShots = 'yes';
      olm.loadProject(JSON.parse(JSON.stringify(p))); })()"""); time.sleep(0.3)
    check("a bad picture is dropped when opened, a good one kept; the setting repaired",
          ev(f"{Z}.scenes.map(s => !!s.thumb)") == [False, False, True] and ev("project.settings.sceneShots") is False)
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
