# The pitch lock and a strip's angle: a strip or circle with its pitch locked keeps the spacing between its pixels,
# and its length sets how many it has (dragging an end, typing a length, a radius or a sweep, resizing a selection);
# its pixel count sets its length. Strips show their length and absolute angle, and the relative Rotate still works.
# Unlocked fixtures behave as before. The lock is saved, repaired when opened, and undone.
import os, sys, time, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8224
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
near = lambda a, b, e=0.01: abs(a - b) <= e

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 1000})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    ev("""(() => { const p = blankProject('Pitch');
      p.fixtures.push(newFixture('line', { id: 'a', x1: 100, y1: 300, x2: 290, y2: 300, pixels: 20 }));
      p.fixtures.push(newFixture('line', { id: 'b', x1: 100, y1: 500, x2: 290, y2: 500, pixels: 20 }));
      p.fixtures.push(newFixture('circle', { id: 'c', cx: 700, cy: 300, r: 60, pixels: 36 }));
      p.fixtures.push(newFixture('circle', { id: 'd', cx: 700, cy: 600, r: 100, sweep: 90, pixels: 10 }));
      olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); olm.ui.rightTab = 'inspector'; olm.ui.snap = false; })()""")
    time.sleep(0.3)
    F = lambda i: ev(f"(() => {{ const f = fxById('{i}'); return JSON.parse(JSON.stringify(f, replacer)); }})()")
    pitch = lambda i: ev(f"fixturePitch(fxById('{i}'))")
    hidx = lambda: ev("hist.idx")
    def sel(*ids):
        ev("ids => { olm.ui.sel = new Set(ids); onSelection(); }", list(ids)); time.sleep(0.2)
    row = lambda label: pg.locator(f"#rightBody .row:has(> :text-is('{label}'))")
    def typed(label, text, n=0):
        inp = row(label).locator("input").nth(n); inp.scroll_into_view_if_needed()
        inp.fill(text); inp.press("Enter"); time.sleep(0.2)
    shown = lambda label, n=0: row(label).locator("input").nth(n).input_value()
    lockb = lambda: pg.locator("#rightBody .pitchlock")
    def screen(x, y):
        return ev(f"(() => {{ const r = cv.getBoundingClientRect(), [sx, sy] = toS({x}, {y}); return [r.left + sx, r.top + sy]; }})()")
    def drag(fx, fy, tx, ty, shift=False):
        a, b = screen(fx, fy), screen(tx, ty)
        pg.mouse.move(*a); pg.mouse.down()
        if shift: pg.keyboard.down("Shift")
        for k in range(1, 9): pg.mouse.move(a[0] + (b[0] - a[0]) * k / 8, a[1] + (b[1] - a[1]) * k / 8); time.sleep(0.02)
        pg.mouse.up()
        if shift: pg.keyboard.up("Shift")
        time.sleep(0.25)

    # ---------- unlocked, as before
    sel('a')
    check("a strip shows Start, Length, Angle °, End, and Pitch with its lock under Pixels",
          row("Length").count() == 1 and row("Angle °").count() == 1 and row("Pitch").count() == 1 and lockb().count() == 1 and lockb().get_attribute("aria-pressed") == "false"
          and shown("Length") == "190" and shown("Angle °") == "0" and shown("Pitch") == "10")
    typed("Pixels", "39")
    check("unlocked, more pixels squeeze into the same length", F('a')['x2'] == 290 and F('a')['pixels'] == 39 and near(pitch('a'), 5), F('a'))
    ev("undo()"); time.sleep(0.2); sel('a')
    drag(290, 300, 390, 300)
    check("unlocked, dragging an end spreads the same pixels", F('a')['pixels'] == 20 and near(F('a')['x2'], 390, 1), F('a'))
    ev("undo()"); time.sleep(0.2); sel('a')

    # ---------- the lock
    h0 = hidx(); lockb().click(); time.sleep(0.2)
    check("the lock keeps the spacing it has, lights up, one step of undo",
          F('a').get('pitchLock') == 10 and lockb().get_attribute("aria-pressed") == "true" and "on" in lockb().get_attribute("class") and hidx() == h0 + 1, F('a'))
    typed("Pixels", "30")
    check("locked, more pixels make it longer along its direction", F('a')['pixels'] == 30 and F('a')['x2'] == 390 and F('a')['y2'] == 300 and shown("Length") == "290", F('a'))
    h0 = hidx(); drag(390, 300, 503.7, 300)
    a = F('a')
    check("locked, dragging an end adds whole pixels and the end lands on the last one", a['pixels'] == 41 and a['x2'] == 500 and near(pitch('a'), 10, 1e-6), a)
    check("the drag is one step of undo, and the list shows the new count",
          hidx() == h0 + 1 and pg.locator("#fxList li[data-id='a'] .meta").inner_text() == "41px", (hidx() - h0, pg.locator("#fxList li[data-id='a'] .meta").inner_text()))
    check("the patch follows: the fixture has 41 pixels after the next frame", ev("(olm.tick(), fxById('a')._n)") == 41)
    drag(500, 300, 112, 300)
    check("dragging it shorter removes pixels, down to two", F('a')['pixels'] == 2 and near(pitch('a'), 10, 1e-6), F('a'))
    ev("undo()"); time.sleep(0.2)
    check("undo gives the count and the end back", F('a')['pixels'] == 41 and F('a')['x2'] == 500, F('a'))
    sel('a')
    drag(100, 300, 50, 300)
    a = F('a')
    check("dragging the start keeps the end and snaps the start", a['x2'] == 500 and a['x1'] == 50 and a['pixels'] == 46, a)
    ev("undo()"); time.sleep(0.2); sel('a')
    drag(500, 300, 400, 0, shift=True)
    a = F('a')
    check("Shift snaps the end to 45°, the pitch stays and the Angle shows it",
          near(pitch('a'), 10, 1e-3) and shown("Angle °") == "315" and abs(math.hypot(a['x2'] - 100, a['y2'] - 300) / 10 - (a['pixels'] - 1)) < 1e-3, (a, shown("Angle °")))
    ev("undo()"); time.sleep(0.2); sel('a')

    # ---------- angle and length
    h0 = hidx(); typed("Angle °", "30")
    a = F('a')
    check("typing an angle turns the strip around its start, keeping its length", a['x1'] == 100 and a['y1'] == 300 and near(a['x2'], 100 + 400 * math.cos(math.radians(30)), 0.002)
          and near(a['y2'], 300 + 400 * math.sin(math.radians(30)), 0.002) and a['pixels'] == 41 and hidx() == h0 + 1, a)
    typed("Length", "254")
    a = F('a')
    check("typing a length moves the end along the angle; locked, it snaps to whole pixels", a['pixels'] == 26 and near(math.hypot(a['x2'] - 100, a['y2'] - 300), 250, 0.003) and shown("Angle °") == "30" and shown("Length") == "250", (a, shown("Length")))
    typed("Pitch", "5")
    a = F('a')
    check("typing a pitch keeps the count and moves the end", a['pixels'] == 26 and a['pitchLock'] == 5 and near(math.hypot(a['x2'] - 100, a['y2'] - 300), 125, 0.003), a)
    h0 = hidx(); pg.locator("#rightBody button[aria-label='Pitch up']").click(); time.sleep(0.2)
    a = F('a')
    check("▴ steps the pitch up half a unit, the count stays, one step of undo", a['pitchLock'] == 5.5 and a['pixels'] == 26 and shown("Pitch") == "5.5" and hidx() == h0 + 1, (a, hidx() - h0))
    pg.locator("#rightBody button[aria-label='Pitch down']").click(modifiers=["Shift"]); time.sleep(0.2)
    check("Shift ▾ steps it down five", F('a')['pitchLock'] == 0.5, F('a'))
    inp = row("Pitch").locator("input"); inp.focus()
    for _ in range(9): inp.press("ArrowUp")
    time.sleep(0.6)
    check("the arrow keys in the field step it too", F('a')['pitchLock'] == 5 and inp.input_value() == "5" and near(math.hypot(F('a')['x2'] - 100, F('a')['y2'] - 300), 125, 0.003), F('a'))
    inp.press("Shift+ArrowDown"); time.sleep(0.2)
    check("Shift ↓ in the field never goes to zero or below", F('a')['pitchLock'] == 0.01, F('a'))
    inp.press("Shift+ArrowUp"); time.sleep(0.6); pg.locator("#rightBody h3").first.click()
    check("Shift ↑ steps it back up five", near(F('a')['pitchLock'], 5, 0.02), F('a'))
    ev("(() => { const f = fxById('a'); setPitch(f, 5); setLineAngle(f, 30); markGeom(); commit(); renderRight(); })()"); time.sleep(0.2)
    pg.locator("#rightBody button[title^='Turn 15° clockwise']").click(); time.sleep(0.2)
    check("Rotate still turns it by an amount, and the Angle shows where it ends", shown("Angle °") == "45" and F('a')['pixels'] == 26 and near(pitch('a'), 5, 1e-3), shown("Angle °"))
    pg.locator("#rightBody button[title^='Turn 90° counter']").click(); time.sleep(0.2)
    check("turning past 0° shows the angle from 0 to 360", shown("Angle °") == "315", shown("Angle °"))
    sel('b'); typed("Length", "300")
    check("unlocked, a typed length keeps the pixel count", F('b')['pixels'] == 20 and F('b')['x2'] == 400, F('b'))
    typed("Angle °", "90")
    check("an unlocked strip turns to an exact angle too", near(F('b')['x2'], 100, 0.002) and near(F('b')['y2'], 800, 0.002), F('b'))
    ev("undo(); undo();"); time.sleep(0.2)

    # ---------- circles and arcs
    sel('c'); lockb().click(); time.sleep(0.2)
    p0 = F('c')['pitchLock']
    typed("Radius", "100")
    c = F('c')
    check("a locked ring: a bigger radius adds pixels and the radius snaps so it closes evenly",
          c['pixels'] == round(2 * math.pi * 100 / p0) and near(c['r'], c['pixels'] * p0 / (2 * math.pi), 0.001) and near(pitch('c'), p0, 0.001), c)
    typed("Pixels", "30")
    check("a locked ring: fewer pixels make it smaller", F('c')['pixels'] == 30 and near(F('c')['r'], 30 * p0 / (2 * math.pi), 0.001), F('c'))
    sel('d'); lockb().click(); time.sleep(0.2)
    p0 = F('d')['pitchLock']
    typed("Pixels", "19")
    d = F('d')
    check("a locked arc: more pixels grow its sweep, its radius stays", d['r'] == 100 and d['pixels'] == 19 and near(d['sweep'], 180, 0.01) and near(pitch('d'), p0, 0.001), d)
    typed("Sweep °", "270")
    d = F('d')
    check("a locked arc: a bigger sweep adds pixels, the sweep snaps to them", d['pixels'] == round(math.radians(270) * 100 / p0) + 1 and near(pitch('d'), p0, 0.001), d)
    typed("Pixels", "200")
    d = F('d')
    check("a locked arc never closes past 359°", d['sweep'] <= 359 and near(pitch('d'), p0, 0.001) and d['pixels'] < 200, d)
    ev("(() => { const f = fxById('d'); f.ry = 50; markGeom(); commit(); renderRight(); })()"); time.sleep(0.2)
    check("an oval keeps its lock but doesn't use it, and says so", lockb().count() == 0 and "round circles" in pg.locator("#rightBody").inner_text() and F('d').get('pitchLock') == p0)
    ev("undo()"); time.sleep(0.2)

    # ---------- resizing a selection
    ev("(() => { const f = fxById('a'); Object.assign(f, { x1: 100, y1: 300, x2: 290, y2: 300, pixels: 20, pitchLock: 10 }); const g = fxById('b'); Object.assign(g, { x1: 100, y1: 500, x2: 290, y2: 500, pixels: 20 }); markGeom(); commit(); })()")
    sel('a', 'b')
    ev("resizeSel(380, selFrame(rotatable()).h)"); time.sleep(0.2)
    a, b = F('a'), F('b')
    check("resizing several: the locked strip gets more pixels at its spacing, the unlocked one spreads",
          a['pixels'] == 39 and near(pitch('a'), 10, 1e-3) and b['pixels'] == 20 and near(b['x2'] - b['x1'], 380, 0.01), (a, b))
    typed("Pixels each", "11"); time.sleep(0.2)
    check("pixels for several: the locked one changes its length, the other its spacing", F('a')['pixels'] == 11 and near(pitch('a'), 10, 1e-3) and F('b')['pixels'] == 11 and near(F('b')['x2'] - F('b')['x1'], 380, 0.01), (F('a'), F('b')))
    sel('a'); lockb().click(); time.sleep(0.2)
    check("unlocking removes the lock from the fixture", 'pitchLock' not in F('a') and lockb().get_attribute("aria-pressed") == "false")
    ev("undo()"); time.sleep(0.2)

    # ---------- files
    saved = json.loads(ev("serialize()"))
    byid = {f['id']: f for f in saved['fixtures']}
    check("the lock is saved with the fixture, and only where it's on", byid['a'].get('pitchLock') == 10 and 'pitchLock' not in byid['b'], (byid['a'].get('pitchLock'), byid['b'].get('pitchLock')))
    ev("""(() => { const p = blankProject('Bad');
      p.fixtures.push(Object.assign(newFixture('line', { id: 'x' }), { pitchLock: 'abc' }), Object.assign(newFixture('line', { id: 'y' }), { pitchLock: -3 }),
        Object.assign(newFixture('line', { id: 'z' }), { pitchLock: '7.5' }), Object.assign(newFixture('matrix', { id: 'm' }), { pitchLock: 5 }), newFixture('circle', { id: 'w' }));
      olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); })()"""); time.sleep(0.2)
    check("a bad lock is dropped when opened, a number kept, none where it doesn't apply",
          'pitchLock' not in F('x') and 'pitchLock' not in F('y') and F('z')['pitchLock'] == 7.5 and 'pitchLock' not in F('m') and 'pitchLock' not in F('w'))
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
