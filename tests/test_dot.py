# The Dot: a fixture of one pixel, drawn as big as the light it stands for (a PAR, a big pixel module). The Dot tool
# (D) places one per click until Esc; it moves, turns and scales with others without changing its size; the
# Inspector has its centre and size; it is patched, sampled and sent as one pixel; files keep and repair it.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8228
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
    ev("""(() => { const p = blankProject('Dots'); p.fixtures.push(newFixture('line', { id: 'L', x1: 100, y1: 100, x2: 290, y2: 100, pixels: 20 }));
      olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); olm.ui.snap = false; fitView(); })()""")
    time.sleep(0.3)
    def screen(x, y):
        return ev(f"(() => {{ const r = cv.getBoundingClientRect(), [sx, sy] = toS({x}, {y}); return [r.left + sx, r.top + sy]; }})()")
    dots = lambda: ev("project.fixtures.filter(f => f.type === 'dot').map(f => JSON.parse(JSON.stringify(f, replacer)))")

    ev("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press("d"); time.sleep(0.1)
    check("D picks the Dot tool, and its button lights", ev("ui.tool") == "dot" and "on" in (pg.locator("[data-tool='dot']").get_attribute("class") or ""), ev("ui.tool"))
    h0 = ev("hist.idx")
    pg.mouse.click(*screen(500, 300)); time.sleep(0.2)
    pg.mouse.click(*screen(600, 300)); time.sleep(0.2)
    d = dots()
    check("each click places a dot of one pixel where it is clicked, and the tool stays", len(d) == 2 and abs(d[0]['cx'] - 500) < 1 and abs(d[1]['cx'] - 600) < 1
          and ev("project.fixtures.filter(f => f.type === 'dot').every(f => pixelCount(f) === 1)") and ev("ui.tool") == "dot" and ev("hist.idx") == h0 + 2, (d, ev("ui.tool")))
    check("dots are named Dot 1, Dot 2", [x['name'] for x in d] == ["Dot 1", "Dot 2"], [x['name'] for x in d])
    pg.keyboard.press("Escape"); time.sleep(0.1)
    check("Esc goes back to Select", ev("ui.tool") == "select")
    pg.mouse.move(*screen(400, 450)); pg.mouse.down(); pg.mouse.up()
    check("its dot is drawn as big as its size: much bigger than a strip's", ev("dotRadius(project.fixtures.find(f => f.type === 'dot')) > 2.5 * dotRadius(fxById('L'))"),
          (ev("dotRadius(project.fixtures.find(f => f.type === 'dot'))"), ev("dotRadius(fxById('L'))")))
    # the inspector
    did = d[0]['id']
    ev(f"olm.ui.sel = new Set(['{did}']); onSelection()"); time.sleep(0.2)
    body = pg.locator("#rightBody").inner_text()
    check("the Inspector shows its centre and size, no pixel count or direction", "Size" in body and "Centre" in body and "Reverse direction" not in body
          and pg.locator("#rightBody .row:has(> :text-is('Pixels'))").count() == 0, body[:200])
    inp = pg.locator("#rightBody .row:has(> :text-is('Size')) input"); inp.fill("60"); inp.press("Enter"); time.sleep(0.2)
    check("a new size draws it bigger", ev(f"fxById('{did}').size") == 60 and ev(f"(olm.tick(), fxById('{did}')._pitch)") == 60)
    ev("undo()"); time.sleep(0.2)
    check("undo gives the size back", ev(f"fxById('{did}').size") == 24)
    # click selects it on the stage, a drag moves it
    ev("olm.ui.sel = new Set(); onSelection()")
    pg.mouse.move(*screen(500, 300)); pg.mouse.down(); b = screen(520, 340); pg.mouse.move(b[0], b[1], steps=6); pg.mouse.up(); time.sleep(0.2)
    check("a drag moves it", abs(ev(f"fxById('{did}').cx") - 520) < 1 and abs(ev(f"fxById('{did}').cy") - 340) < 1, (ev(f"fxById('{did}').cx"), ev(f"fxById('{did}').cy")))
    # with others: turning and scaling move it but keep its size, and add nothing
    ev(f"olm.ui.sel = new Set(['L', '{did}']); onSelection(); rotateSel(90)"); time.sleep(0.2)
    dd = ev(f"JSON.parse(JSON.stringify(fxById('{did}'), replacer))")
    check("turned with others, it moves around them and keeps only its own fields", dd['size'] == 24 and 'start' not in dd and 'rot' not in dd and 'pixels' not in dd, dd)
    ev("resizeSel(selFrame(rotatable()).w * 2, selFrame(rotatable()).h * 2)"); time.sleep(0.2)
    check("scaled with others, it keeps its size", ev(f"fxById('{did}').size") == 24)
    # patched and sent as one pixel
    ev(f"""(() => {{ const c = newController({{ outputs: 1 }}); project.controllers.push(c); c.chains = [['{did}']]; markPatch(); commit(); olm.tick(); }})()""")
    check("patched as one pixel: three channels", ev(f"!!fxById('{did}')._patch && fxById('{did}')._patch.first >= 0") and ev(f"fxById('{did}')._col.length") == 3,
          ev(f"JSON.stringify(fxById('{did}')._patch, (k, v) => k === 'ctrl' ? undefined : v)"))
    # files
    saved = json.loads(ev("serialize()"))
    sd = [f for f in saved['fixtures'] if f['type'] == 'dot']
    check("saved with its centre and size", len(sd) == 2 and all('size' in f and 'cx' in f and 'pixels' not in f for f in sd), sd[:1])
    ev("""(() => { const p = blankProject('Bad'); p.fixtures.push(Object.assign(newFixture('dot', { id: 'x' }), { size: -4, pixels: 99 }), Object.assign(newFixture('dot', { id: 'y' }), { size: 'big', cx: '7' }));
      olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); })()"""); time.sleep(0.2)
    check("a bad size is repaired, extra fields dropped", ev("fxById('x').size") == 1 and ev("'pixels' in fxById('x')") is False and ev("fxById('y').size") == 24 and ev("fxById('y').cx") == 7)
    ev("olm.ui.sel = new Set(['x']); onSelection(); duplicateSel()"); time.sleep(0.2)
    check("a duplicate is a dot too", ev("project.fixtures.filter(f => f.type === 'dot').length") == 3)
    ev("olm.setTool('select'); olm.ui.sel = new Set(); onSelection()")
    pg.locator("#btnAddFx, #fxAdd, button:text-is('+ Add')").first.click(); time.sleep(0.2)
    check("the Add menu has Dot", pg.locator(".menu :text('Dot (one big pixel)')").count() == 1)
    pg.keyboard.press("Escape")
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
