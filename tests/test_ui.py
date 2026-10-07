# UI flows on the demo project (zones): scene dialog, edited badge, drag reorder, video source handling
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, CHROME_ARGS
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
bridge = start_bridge(PORT)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail) if detail else ""));  ok or fails.append(name)
MAKE_CLIP = """async (name) => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32; const x = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm' }); const parts = [];
  rec.ondataavailable = e => parts.push(e.data); rec.start();
  for (let i = 0; i < 20; i++) { x.fillStyle = i % 2 ? '#f00' : '#00f'; x.fillRect(0, 0, 64, 32); await new Promise(r => setTimeout(r, 50)); }
  rec.stop(); await new Promise(r => rec.onstop = r);
  window.__clip = new File(parts, name, { type: 'video/webm' });
}"""
with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    pg.evaluate("localStorage.clear(); olm.loadProject(olm.project)")
    pg.click("#dockTabs button[data-tab=scenes]")
    top = pg.locator(".scenerow").nth(0)   # the top zone (All) is the first row
    # edit dialog
    top.locator(".scene").nth(0).locator("button.x").click(); pg.click(".menu >> text=Rename, fade time, color…")
    pg.fill(".modal input[type=text]", "Opening"); pg.fill(".modal input[type=number]", "5")
    pg.locator(".modal .swatches button").nth(3).click(); pg.click(".modal >> text=Save"); time.sleep(0.1)
    sc = pg.evaluate("olm.project.zones[2].scenes[0]")
    check("edit dialog saves name, fade, colour", (sc["name"], sc["fade"], sc["tag"]) == ("Opening", 5, "#46e08c"), (sc["name"], sc["fade"], sc["tag"]))
    # edited badge, then Update clears it
    top.locator(".scene").nth(1).click(modifiers=["Shift"]); time.sleep(0.3)
    pg.evaluate("olm.project.zones[2].layers[0].opacity = 0.3; olm.loadSource('b-noise')"); time.sleep(0.3)
    has = pg.locator(".scene.live .badge").count()
    pg.locator(".scenerow").nth(0).locator(".scene.live button.x").click(); pg.click(".menu >> text=Update with All's current layers"); time.sleep(0.2)
    check("edited badge shows, Update clears it", has == 1 and pg.locator(".scenerow").nth(0).locator(".scene.live .badge").count() == 0, has)
    check("updated scene holds the new look", pg.evaluate("olm.project.zones[2].scenes[1].layers.some(l => l.src === 'b-noise')"))
    # drag reorder: drag scene 1 onto scene 3 in the top row
    names0 = pg.evaluate("olm.project.zones[2].scenes.map(s => s.name)")
    row = pg.locator(".scenerow").nth(0)
    row.locator(".scene").nth(0).drag_to(row.locator(".scene").nth(2)); time.sleep(0.3)
    names1 = pg.evaluate("olm.project.zones[2].scenes.map(s => s.name)")
    check("drag reorders scenes", names1 == [names0[1], names0[2], names0[0], names0[3]], names1)
    # video: make a short webm in the page, load it as a source through the file input
    pg.evaluate(MAKE_CLIP, "clip.webm")
    r = pg.evaluate("""async () => {
      const dt = new DataTransfer(); dt.items.add(window.__clip);
      const inp = document.getElementById('fileMedia'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 1500));
      const src = olm.project.sources.at(-1), L = olm.project.zones.flatMap(z => z.layers).find(l => l.src === src.id);
      return { kind: src.kind, inLayer: !!L };
    }""")
    check("video file loads into the selected layer", r == {"kind": "video", "inLayer": True}, r)
    st = pg.evaluate("""async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const src = olm.project.sources.at(-1), el = olm.mediaEl(src.id);
      const out = { playing: !el.paused };
      el.pause(); await wait(1600); out.resumedAfterBrowserPause = !el.paused;
      el._held = true; el.pause(); await wait(1600); out.staysPausedWhenUserPaused = el.paused; el._held = false;
      olm.loadSource('b-plasma'); await wait(1600); out.pausedWhenUnused = el.paused;
      return out; }""")
    check("video: plays, restarts after a browser pause, respects user pause, pauses when unused",
          st == {"playing": True, "resumedAfterBrowserPause": True, "staysPausedWhenUserPaused": True, "pausedWhenUnused": True}, st)
    # replacing the file releases the old video; removing the source releases its video
    pg.evaluate(MAKE_CLIP, "clip2.webm")
    rel = pg.evaluate("""async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const src = olm.project.sources.at(-1);
      olm.loadSource(src.id); await wait(800);
      const old = olm.mediaEl(src.id), oldUrl = old.src; const wasPlaying = !old.paused;
      mediaTarget = src; await addMediaFile(window.__clip); await wait(1200);   // as Replace file… does
      const cur = olm.mediaEl(src.id);
      const replaced = { wasPlaying, oldPaused: old.paused, oldReleased: !old.getAttribute('src'), newPlaying: !cur.paused, newIsOther: cur !== old };
      let urlRevoked = false; try { const r = await fetch(oldUrl); urlRevoked = !r.ok; } catch (e) { urlRevoked = true; }
      replaced.oldUrlRevoked = urlRevoked;
      removeSource(src); await wait(300);
      const removed = { paused: cur.paused, released: !cur.getAttribute('src'), gone: !olm.mediaEl(src.id) };
      return { replaced, removed };
    }""")
    check("replacing a video file stops and frees the old one", rel["replaced"] == {"wasPlaying": True, "oldPaused": True, "oldReleased": True, "newPlaying": True, "newIsOther": True, "oldUrlRevoked": True}, rel["replaced"])
    check("removing a video source stops and frees its video", rel["removed"] == {"paused": True, "released": True, "gone": True}, rel["removed"])
    check("no page errors", not errs, errs[:3])
    br.close()
bridge.terminate(); bridge.communicate()
print("FAILED:", fails or "none")
