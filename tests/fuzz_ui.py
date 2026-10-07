# Random UI actions on the demo project; any uncaught page error or logged app error is a finding
import os, sys, time, random, subprocess, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge
from playwright.sync_api import sync_playwright
PORT, SEED, STEPS = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
rnd = random.Random(SEED)
bridge = start_bridge(PORT)
PICK = """(seed) => {
  // interactive, visible elements
  const sel = 'button:not([disabled]), [role=button], input[type=checkbox], input[type=range], input[type=number], input[type=text], select, #fxList li, .zones li, .layers li, .ulist > div, .ctrl, .scene, .tile, .chip';
  const els = [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && !e.closest('[hidden]') && e.id !== 'btnImportSvg' && e.getAttribute('aria-label') !== 'Bridge address'; });
  const e = els[Math.floor(seed * els.length)];
  if (!e) return null;
  const r = e.getBoundingClientRect();
  document.querySelectorAll('[data-fz]').forEach(x => x.removeAttribute('data-fz'));
  e.setAttribute('data-fz', '1');
  return { tag: e.tagName, type: e.type || '', text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 40), x: r.x + r.width / 2, y: r.y + r.height / 2 };
}"""
DND_SEL_JS = "#fxList li, .list.zones li, .layers li, .scenerow .zhead, .scenerow, .scene, .prow, .outrow"
DND_SEL = DND_SEL_JS
DND_COUNT = "document.querySelectorAll(" + repr(DND_SEL_JS) + ").length"
log = []
with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(("pageerror", str(e)[:300], len(log))))
    pg.on("console", lambda m: errs.append(("console", m.text[:300], len(log))) if m.type == "error" and "fonts.googleapis" not in m.text and "ERR_TUNNEL" not in m.text and "net::" not in m.text else None)
    pg.on("filechooser", lambda fc: None)
    pg.on("dialog", lambda d: d.dismiss())
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    pg.evaluate("localStorage.clear(); olm.loadProject(olm.project)")
    for step in range(STEPS):
        try:
            kind = rnd.random()
            if kind < 0.12:   # stage interaction with some tool
                box = pg.locator("#view").bounding_box()
                tool = rnd.choice(["v", "l", "m", "c", "z", "v", "v", "n", "p"])
                pg.keyboard.press(tool)
                x0, y0 = box["x"] + rnd.uniform(20, box["width"] - 20), box["y"] + rnd.uniform(20, box["height"] - 20)
                x1, y1 = x0 + rnd.uniform(-150, 150), y0 + rnd.uniform(-100, 100)
                pg.mouse.move(x0, y0); pg.mouse.down(); pg.mouse.move(x1, y1, steps=3); pg.mouse.up()
                log.append(f"stage drag tool={tool}")
            elif kind < 0.17:  # a handle of the frame around the selection: resize or turn it
                if rnd.random() < 0.3: pg.keyboard.press(rnd.choice(["Control+a", "Escape"]))
                hs = pg.evaluate("(() => { const r = cv.getBoundingClientRect(); return selHandles().map(h => { const p = toS(h.x, h.y); return [r.left + p[0], r.top + p[1], h.id]; }); })()")
                if not hs: continue
                x0, y0, hid = rnd.choice(hs)
                shift = rnd.random() < 0.3
                pg.mouse.move(x0, y0); pg.mouse.down()
                if shift: pg.keyboard.down("Shift")
                pg.mouse.move(x0 + rnd.uniform(-200, 200), y0 + rnd.uniform(-200, 200), steps=4); pg.mouse.up()
                if shift: pg.keyboard.up("Shift")
                log.append(f"handle {hid}{' shift' if shift else ''}")
            elif kind < 0.24:  # keyboard shortcut
                k = rnd.choice(["Escape", "Delete", "1", "2", "3", "Shift+1", "b", "i", "f", "g", "ArrowLeft", "Control+z", "Control+y", "Control+d", "Control+a", "Enter", "p", "Space",
                                "r", "Shift+R", "Alt+ArrowUp", "Alt+ArrowDown", "Control+c", "Control+v", "Control+l"])
                pg.keyboard.press(k); log.append(f"key {k}")
            elif kind < 0.28:  # wheel zoom on the stage
                box = pg.locator("#view").bounding_box()
                pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2); pg.mouse.wheel(0, rnd.choice([-300, 300])); log.append("wheel")
            elif kind < 0.36:  # drag one list item onto another
                n = pg.evaluate(DND_COUNT)
                if n < 2: continue
                a, b = rnd.randrange(n), rnd.randrange(n)
                src, dst = pg.locator(DND_SEL).nth(a), pg.locator(DND_SEL).nth(b)
                bb = dst.bounding_box()
                if not bb: continue
                src.drag_to(dst, target_position={"x": min(30, bb["width"] / 2), "y": rnd.uniform(1, max(1.5, bb["height"] - 1))}, timeout=2000)
                log.append("drag " + pg.evaluate("([a, b]) => { const l = [...document.querySelectorAll(" + repr(DND_SEL_JS) + ")]; return (l[a] ? l[a].className + ' ' + l[a].textContent.trim().slice(0, 12) : '?') + ' -> ' + (l[b] ? l[b].className + ' ' + l[b].textContent.trim().slice(0, 12) : '?'); }", [a, b]))
            else:
                el = pg.evaluate(PICK, rnd.random())
                if not el: continue
                loc = pg.locator("[data-fz]")
                if el["tag"] == "INPUT" and el["type"] == "range":
                    loc.evaluate("(e, v) => { e.value = e.min + (e.max - e.min) * v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }", rnd.random())
                    log.append(f"range {el['text']}")
                elif el["tag"] == "INPUT" and el["type"] in ("number", "text"):
                    v = rnd.choice(["0", "1", "-5", "999999", "12.5", "", "abc", "10.0.0.1", "7"])
                    loc.fill(v); loc.press("Enter"); log.append(f"fill {el['text']!r} = {v!r}")
                elif el["tag"] == "SELECT":
                    opts = loc.evaluate("e => [...e.options].map(o => o.value)")
                    if opts: loc.select_option(rnd.choice(opts)); log.append(f"select {el['text'][:20]!r}")
                else:
                    mods = ["Shift"] if rnd.random() < 0.1 else []
                    pg.mouse.click(el["x"], el["y"]) if not mods else loc.click(modifiers=mods, timeout=2000)
                    log.append(f"click {el['tag']} {el['text']!r}")
            if rnd.random() < 0.05: pg.mouse.move(5, 5)  # close menus by moving away
            time.sleep(0.03)
        except Exception as e:
            log.append(f"(action failed: {str(e)[:80]})")
    time.sleep(1.5)
    alive = pg.evaluate("() => new Promise(r => { const f0 = olm.frameIndex; setTimeout(() => r(olm.frameIndex > f0), 800); })")
    integ = pg.evaluate("""() => { const P = olm.project, u = a => a.length - new Set(a).size, fx = new Set(P.fixtures.map(f => f.id));
      return { fixtures: P.fixtures.length, zones: P.zones.length, scenes: P.zones.reduce((n, z) => n + z.scenes.length, 0),
        dupFixtures: u(P.fixtures.map(f => f.id)), dupZones: u(P.zones.map(z => z.id)), dupScenes: u(P.zones.flatMap(z => z.scenes.map(s => s.id))),
        currentSceneMissing: P.zones.filter(z => z.scene && !z.scenes.some(s => s.id === z.scene)).length,
        patchedTwice: u(P.controllers.flatMap(c => c.chains.flat())), patchedMissing: P.controllers.flatMap(c => c.chains.flat()).filter(id => !fx.has(id)).length,
        patchedBadGeometry: P.fixtures.filter(f => ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'ry', 'w', 'h', 'rot', 'start'].some(k => k in f && !(f.type === 'matrix' && k === 'start') && !Number.isFinite(f[k])) || (f.pts && f.pts.some(v => !Number.isFinite(v))) || !(f._pts && Array.from(f._pts).every(Number.isFinite))).length }; }""")
    br.close()
bridge.terminate(); bridge.communicate()
drags = sum(1 for l in log if l.startswith("drag ")); failed = sum(1 for l in log if l.startswith("(action failed"))
bad = {k: v for k, v in integ.items() if k.startswith(("dup", "current", "patched")) and v}
print(f"seed {SEED}: {STEPS} steps ({drags} drags, {failed} actions failed), errors {len(errs)}, still ticking {alive}, project {'OK' if not bad else 'BROKEN ' + str(bad)} {integ['fixtures']} fx / {integ['zones']} zones / {integ['scenes']} scenes")
for kind, msg, at in errs[:8]:
    print(f"  [{kind}] after step {at}: {log[max(0, at - 3):at]} -> {msg}")
