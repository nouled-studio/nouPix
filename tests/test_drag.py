# Dragging many fixtures keeps the output going: an oval's arc is worked out once per shape (and stays exact); a press
# on what is already selected doesn't redraw the lists; finishing a move is a step of undo without redrawing the lists
# and the dock; undo after turning a selection gives back its upright frame; and dragging 270 fixtures, mostly turned
# ovals, leaves no long gap in the output.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8202
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1600, "height": 1000})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    # 270 fixtures as in the report: 200 turned ovals and 70 lines, about 21,000 pixels, at 100 frames a second.
    # Rendering the content is a fixed 6 ms (what it took on the reporter's GPU; these tests may have none).
    ev("""(() => { const p = demoProject(); p.fixtures = []; p.groups = [];
      for (let i = 0; i < 200; i++) p.fixtures.push(newFixture('circle', { name: 'Oval ' + i, cx: 60 + (i % 20) * 46, cy: 60 + Math.floor(i / 20) * 50, r: 20, ry: 12, rot: (i * 17) % 180, pixels: 80 }));
      for (let i = 0; i < 70; i++) p.fixtures.push(newFixture('line', { name: 'Line ' + i, x1: 40, y1: 560 + i, x2: 960, y2: 560 + i, pixels: 76 }));
      p.settings.fps = 100; olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); fitView();
      renderContent = () => { const t = performance.now(); while (performance.now() - t < 6); };
      window._t = []; const s = sendFrame; sendFrame = function () { window._t.push(performance.now()); return s.apply(this, arguments); };
      window._lists = 0; const r = renderFxList; renderFxList = function () { window._lists++; return r.apply(this, arguments); };
      window._dock = 0; const d = renderDock; renderDock = function () { window._dock++; return d.apply(this, arguments); }; })()""")
    time.sleep(1.5)
    # the sources' thumbnails compile their effects after the page opens, some taking most of a second each: done
    # before the drag is timed, so the gap measured is the drag's (and not which compile happens to land in it)
    pg.wait_for_function("[...thumbs.values()].every(c => !c._stale)", timeout=60000)

    # ---------- an oval's arc: kept until its shape changes, and the same as working it out afresh
    same = ev("""(() => { let bad = 0; const f = JSON.parse(JSON.stringify(olm.project.fixtures[3], replacer)), keys = ['cx', 'cy', 'r', 'ry', 'rot', 'start', 'sweep'];
      const eq = (a, b) => a.M === b.M && ['xs', 'ys', 'L'].every(k => a[k].every((v, i) => v === b[k][i]));
      for (let n = 0; n < 300; n++) {
        const k = keys[n % keys.length]; f[k] += (n % 3) - 1 + 0.25; if (n % 50 === 0) f.ccw = !f.ccw;
        const a = ovalSamples(f); if (!eq(a, sampleOval(f)) || ovalSamples(f) !== a) bad++; }
      return bad; })()""")
    check("an oval's arc is kept while its shape stays, and always the same as worked out afresh (300 changes)", same == 0, same)

    # ---------- a press on what is already selected: the lists stay as they are
    st = pg.locator("#view").bounding_box()
    ev("(() => { ui.sel = new Set(olm.project.fixtures.map(f => f.id)); onSelection(); })()"); time.sleep(0.5)
    pos = lambda: ev("(() => { const f = olm.project.fixtures[5]; return toS(f._pts[0], f._pts[1]); })()")
    p = pos(); x, y = st["x"] + p[0], st["y"] + p[1]
    lists0, dock0, hist0 = ev("window._lists"), ev("window._dock"), ev("hist.idx")
    cx0 = ev("olm.project.fixtures.map(f => f.cx || f.x1)")
    ev("window._t = []")
    pg.mouse.move(x, y); pg.mouse.down()
    check("a press on a fixture already selected keeps all 270 selected and doesn't redraw the lists", ev("ui.sel.size") == 270 and ev("window._lists") == lists0, ev("window._lists") - lists0)
    for k in range(1, 4): pg.mouse.move(x + 10 * k, y + 5 * k); time.sleep(0.05)
    pg.mouse.up(); time.sleep(0.6)
    moved = ev("olm.project.fixtures.map(f => f.cx || f.x1)")
    dx = moved[0] - cx0[0]
    check("dragging moves all 270, by the same amount", dx > 0 and all(abs(b - a - dx) < 1e-6 for a, b in zip(cx0, moved)), (cx0[0], moved[0]))
    check("finishing the move is one step of undo, without redrawing the fixture list and the dock", ev("hist.idx") == hist0 + 1 and ev("window._lists") == lists0 and ev("window._dock") == dock0, (ev("hist.idx") - hist0, ev("window._lists") - lists0, ev("window._dock") - dock0))
    t = ev("window._t"); gaps = sorted(b - a for a, b in zip(t, t[1:]))
    check("the output keeps going while 270 fixtures are dragged (no long gap)", gaps and gaps[-1] < 250, round(gaps[-1], 1) if gaps else None)
    ev("undo()"); time.sleep(0.4)
    back = ev("olm.project.fixtures.map(f => f.cx || f.x1)")
    check("undo puts them back", back == cx0, [(a, b) for a, b in zip(cx0, back) if a != b][:3])

    # ---------- from the Content tab, a press on the selection brings the Inspector forward
    ev("(() => { ui.rightTab = 'content'; renderRight(); })()"); time.sleep(0.2)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.up(); time.sleep(0.3)
    check("from the Content tab, a press on the selection brings the Inspector forward", ev("ui.rightTab") == "inspector")

    # ---------- undo after turning a selection: its frame is upright again, at its first size
    f0 = ev("(() => { const F = selFrame(rotatable()); return [Math.round(F.w), Math.round(F.h), selAngle(rotatable())]; })()")
    ev("rotateSel(30)"); time.sleep(0.3)
    check("turning the selection turns its frame", abs(ev("selAngle(rotatable())") - 30) < 1e-6)
    ev("undo()"); time.sleep(0.4)
    f1 = ev("(() => { const F = selFrame(rotatable()); return [Math.round(F.w), Math.round(F.h), selAngle(rotatable())]; })()")
    check("undo gives back the upright frame at its first size", f1 == f0, (f0, f1))

    # ---------- a zone moved still redraws the dock (its scenes show it)
    # counted in the same step as the commit, so nothing else redraws the dock in between
    n = ev("(() => { const d = window._dock; commit({ lists: true }); return window._dock - d; })()")
    check("other changes still redraw the lists and the dock", n == 1, n)
    n = ev("(() => { const d = window._dock; commit(); return window._dock - d; })()")
    check("and commit() on its own too", n == 1, n)
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED:", fails or "none")
