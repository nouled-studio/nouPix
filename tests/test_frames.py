# The output's frame rate holds while the interface works: a frame that takes most of its period still leaves the
# next on time (the clock); moving the mouse over the panels draws nothing, over the stage only when it reaches
# another fixture or pixel; the stage is drawn at most about 30 times a second for moving content; the pixel under
# the mouse is the nearest one, as before; resizing the bottom panel never shows the stage empty; many pixels on screen
# are drawn as the content through a mask of their circles, dimmed by dimmers, group levels, master and blackout.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8201
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    ev("(() => { olm.loadProject(demoProject()); olm.project.settings.fps = 100; startClock(); fitView(); })()"); time.sleep(1)
    # what a frame costs depends on the machine (these tests may run with no GPU): rendering the content is replaced
    # by a fixed amount of work, so the clock and the stage's timing are what is measured
    ev("(() => { window._render = renderContent; renderContent = () => {}; })()")
    # counts the frames and the stage's drawings over a while
    ev("(() => { window._draws = 0; const d = drawView; drawView = function () { window._draws++; return d.apply(this, arguments); }; })()")
    def rate(secs, during=None):
        f0, d0, t0 = ev("olm.frameIndex"), ev("window._draws"), time.time()
        if during: during(secs)
        else: time.sleep(secs)
        el = time.time() - t0
        return (ev("olm.frameIndex") - f0) / el, (ev("window._draws") - d0) / el

    # ---------- the clock: a frame of 6 ms at 100 a second still leaves the next on time
    ev("(() => { renderContent = () => { const t = performance.now(); while (performance.now() - t < 6); }; })()"); time.sleep(1)   # past the last real frame
    fps, _ = rate(3)
    check("frames of 6 ms keep 100 a second (the old clock dropped every other one)", fps > 75, (round(fps, 1), round(ev("olm.tickCost"), 1)))
    ev("renderContent = () => {}")
    ev("(() => { olm.project.settings.fps = 40; startClock(); })()"); time.sleep(0.5)
    fps, _ = rate(2)
    check("and 40 a second when set to 40", 36 < fps < 44, round(fps, 1))
    ev("(() => { olm.project.settings.fps = 100; startClock(); })()"); time.sleep(0.5)

    # ---------- the stage: drawn at most about 30 times a second for moving content
    _, draws = rate(3)
    check("moving content redraws the stage about 30 times a second at most", draws < 36, round(draws, 1))

    # ---------- the mouse over the panels: no redraw of the stage for it
    # one frame a second now: what redraws the stage beyond that comes from the mouse
    ev("(() => { olm.project.settings.fps = 1; startClock(); })()"); time.sleep(1.2)
    box = pg.locator("#rightBody").bounding_box()
    def wiggle(sel_box):
        def run(secs):
            end = time.time() + secs; k = 0
            while time.time() < end:
                pg.mouse.move(sel_box["x"] + 20 + (k * 7) % (sel_box["width"] - 40), sel_box["y"] + 20 + (k * 5) % (sel_box["height"] - 40)); k += 1
        return run
    _, draws = rate(2, wiggle(box))
    check("moving the mouse over the side panel doesn't redraw the stage", draws < 3, round(draws, 1))
    # over an empty part of the stage: nothing under it changes, so nothing is drawn
    st = pg.locator("#view").bounding_box()
    ev("(() => { ui.view.x = -5000; ui.view.y = -5000; redrawStage(); })()"); time.sleep(0.3)   # the fixtures far off screen
    _, draws = rate(2, wiggle(st))
    check("moving over empty stage doesn't redraw it either", draws < 3, round(draws, 1))
    ev("fitView()"); time.sleep(0.3)
    # onto a fixture's pixel: the hover changes, and the stage shows it
    f = ev("(() => { const f = olm.project.fixtures[0]; const s = toS(f._pts[0], f._pts[1]); return { x: s[0], y: s[1], id: f.id }; })()")
    pg.mouse.move(st["x"] + 2, st["y"] + 2); time.sleep(0.2)
    d0 = ev("window._draws")
    pg.mouse.move(st["x"] + f["x"], st["y"] + f["y"]); time.sleep(0.3)
    check("reaching a fixture's pixel shows it: hover set, stage redrawn", ev("ui.hoverFx") == f["id"] and ev("ui.hoverPx && ui.hoverPx.i") == 0 and ev("window._draws") > d0, (ev("ui.hoverFx"), f["id"]))
    # dragging still redraws on each move
    d0 = ev("window._draws")
    pg.mouse.move(st["x"] + 300, st["y"] + 300); pg.mouse.down(button="right")
    for k in range(20): pg.mouse.move(st["x"] + 300 + k * 5, st["y"] + 300); time.sleep(0.02)
    pg.mouse.up(button="right")
    check("dragging (panning) redraws as it goes", ev("window._draws") - d0 >= 5, ev("window._draws") - d0)

    # ---------- the pixel under the mouse: the nearest, the same as looking through every pixel
    same = ev("""(() => { let bad = 0;
      const brute = (x, y) => { const tol = 8 / ui.view.zoom; let best = null, bd = tol * tol;
        for (const f of olm.project.fixtures) { const P = f._pts; for (let i = 0; i < f._n; i++) { const dx = P[2*i] - x, dy = P[2*i+1] - y, d = dx*dx + dy*dy; if (d < bd) { bd = d; best = { f, i }; } } } return best; };
      for (let k = 0; k < 3000; k++) { const x = Math.random() * 1100 - 50, y = Math.random() * 740 - 50, a = hoverPixel(x, y), b = brute(x, y);
        if ((a && a.f) !== (b && b.f) || (a && a.i) !== (b && b.i)) bad++; }
      return bad; })()""")
    check("the pixel under the mouse is the nearest one, as looking through all of them finds", same == 0, same)
    ev("(() => { const f = olm.project.fixtures[0]; f.x1 = (f.x1 || 0) + 40; markGeom(); rebuildGeometry(); })()")
    moved = ev("(() => { const f = olm.project.fixtures[0], P = f._pts, h = hoverPixel(P[0], P[1]); return h && h.f === f && h.i === 0; })()")
    check("and it follows a fixture that moved", moved)
    # ---------- resizing the bottom panel: the stage never shows empty, the output keeps going
    ev("(() => { olm.project.settings.fps = 100; startClock(); fitView(); redrawStage(); })()"); time.sleep(0.6)
    ev("""(() => { window._blank = 0; window._seen = 0; const c = document.querySelector('#view'), x = c.getContext('2d');
      // after the page's own handling of each new size, as the browser would then paint it
      window._probe = new ResizeObserver(() => { window._seen++; if (x.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data[3] === 0) window._blank++; }); window._probe.observe(document.querySelector('#stage')); })()""")
    g = pg.locator("#dockGrip").bounding_box(); gx, gy = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    sizes = []
    def drag(up, watch=False):
        pg.mouse.move(gx, gy); pg.mouse.down()
        for k in range(30):
            pg.mouse.move(gx, gy - 6 * k if up else gy - 180 + 6 * k); time.sleep(0.02)
            if watch: sizes.append(ev("[document.querySelector('#view').width, document.querySelector('#view').height]"))
        pg.mouse.up()
    dock0 = ev("ui.dockH")
    drag(True, True); time.sleep(0.3)
    check("while it is dragged the stage's canvas keeps one size (no new canvas each step)", len(set(map(tuple, sizes))) == 1, sorted(set(map(tuple, sizes))))
    check("the panel follows the drag", ev("ui.dockH") > dock0 + 120, (dock0, ev("ui.dockH")))
    check("and when it ends the canvas fits the stage again", ev("(() => { const c = document.querySelector('#view'), r = document.querySelector('#stage').getBoundingClientRect(); return c.width === Math.round(r.width * devicePixelRatio) && c.height === Math.round(r.height * devicePixelRatio) && !c.style.height; })()"))
    check("resizing the bottom panel: the stage never shows empty (it flashed)", ev("window._seen") >= 20 and ev("window._blank") == 0, (ev("window._seen"), ev("window._blank")))
    ev("window._probe.disconnect()")   # reading the stage back is slow here: the output is timed without it
    g = pg.locator("#dockGrip").bounding_box(); gx, gy = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2 + 180
    f0 = ev("olm.frameIndex"); t0 = time.time(); drag(False); el = time.time() - t0; time.sleep(0.3)
    check("and the output keeps going meanwhile", (ev("olm.frameIndex") - f0) / el > 30, round((ev("olm.frameIndex") - f0) / el, 1))
    ev("(() => { renderContent = window._render; olm.project.settings.fps = 40; startClock(); })()")

    # ---------- many pixels: the content through a mask of their circles
    ev("""(() => { const p = blankProject('M'); p.settings.compW = 1000; p.settings.compH = 600;
      p.zones = [newZone({ w: 1000, h: 600, layers: [newLayer('b-solid')] })];
      p.zones[0].layers[0].params = { 'b-solid': { color: [1, 1, 1, 1] } };
      p.fixtures = Array.from({ length: 40 }, (_, i) => newFixture('line', { x1: 20, y1: 15 + i * 14, x2: 980, y2: 15 + i * 14, pixels: 100 }));
      p.groups = [{ id: 'g1', name: 'G', open: true }]; p.fixtures[1].group = 'g1';
      olm.loadProject(p); fitView(); })()"""); time.sleep(1)
    # the brightness of a fixture's middle pixel on the stage, drawn once the view is settled
    probe = lambda i: ev(f"""(() => {{ dotLayers.seen = ui.view.zoom + '|' + ui.view.x + '|' + ui.view.y; dotLayers.movedAt = -1e9; drawView();
      const f = olm.project.fixtures[{i}], k = f._n >> 1, x = document.querySelector('#view').getContext('2d');
      const d = x.getImageData(Math.round((f._pts[2 * k] * ui.view.zoom + ui.view.x) * DPR), Math.round((f._pts[2 * k + 1] * ui.view.zoom + ui.view.y) * DPR), 1, 1).data;
      return d[0] + d[1] + d[2]; }})()""")
    lit = probe(0)
    check("4,000 pixels on screen are drawn through the mask, showing the content", ev("!!dotLayers.view") and lit > 600, lit)
    ev("olm.project.fixtures[0].dimmer = 0")
    check("a fixture's dimmer at 0 makes its pixels dark, the others stay lit", probe(0) < 60 and probe(2) > 600, (probe(0), probe(2)))
    ev("olm.project.fixtures[0].dimmer = 1; olm.project.groups[0].level = 0.5")
    check("its group's level dims a fixture of the group", 250 < probe(1) < 500 and probe(0) > 600, (probe(1), probe(0)))
    ev("olm.project.groups[0].level = 1; olm.project.fixtures[0].enabled = false")
    check("a disabled fixture shows dark", probe(0) < 60, probe(0))
    ev("olm.project.fixtures[0].enabled = true; olm.project.settings.master = 0.5")
    check("the master dims them all", 250 < probe(0) < 500 and 250 < probe(2) < 500, (probe(0), probe(2)))
    ev("olm.project.settings.master = 1; ui.blackout = true")
    check("and blackout puts them all out", probe(0) < 60 and probe(2) < 60, (probe(0), probe(2)))
    ev("ui.blackout = false; dotLayers.view = null; ui.outputMode = 'fixtures'; drawView()")
    check("while highlighting, each dot is drawn in its colour instead", ev("dotLayers.view === null"))
    ev("ui.outputMode = 'content'; fitView(); zoomAt(VW / 2, VH / 2, 12 / ui.view.zoom); dotLayers.view = null; drawView()")
    check("and so when zoomed in to few pixels", ev("dotLayers.view === null"))
    ev("fitView()")
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED:", fails or "none")
