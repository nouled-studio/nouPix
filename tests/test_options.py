# Every option, one by one: the DMX bytes for every colour order and white mode, gamma, dimmer, trims, master and
# blackout; matrix start, direction and snake; circle start, direction, sweep and ovals; reversed fixtures;
# controller options (skip ch 511–512, outputs, universes per output, start universe, off); all blend modes;
# every built-in effect with its controls at their minimum, maximum and default; highlight modes; zone and layer
# opacity; every item of every menu; every key; and saving then opening gives the same project.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8155
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

# In the page: T.one(fixture props, controller props, layers) loads a project with one fixture on one controller
# output and the given layers in a full-size zone; T.bytes(f) is the fixture's channels as sent.
SETUP = """
window.T = {
  load(fixtures, ctrl = {}, layers = [['b-solid', { color: [1, 0.5, 0.25, 1] }]], settings = {}) {
    const saved = project; project = blankProject('options');
    Object.assign(project.settings, settings);
    const fs = fixtures.map(([t, p]) => { const f = newFixture(t, p); project.fixtures.push(f); return f; });
    const c = newController(Object.assign({ name: 'C', ip: '10.0.0.9', outputs: 4, upo: 4, startUniverse: 0 }, ctrl));
    c.chains[0] = fs.map(f => f.id);
    project.controllers.push(c);
    project.zones[0].layers = layers.map(([src, params, o]) => Object.assign(newLayer(src), o || {}, { params: params ? { [src]: params } : {} }));
    const p = JSON.parse(JSON.stringify(project, replacer)); project = saved;
    olm.loadProject(p);
  },
  bytes(i = 0) {
    const f = olm.project.fixtures[i], o = f._out; if (!o) return null;
    const out = [];
    for (let k = 0; k < f._n; k++) { const L = o.lin[k]; if (L < 0) { out.push(null); continue; } const px = []; for (let c = 0; c < o.oi.length; c++) { const x = L + c; px.push(o.unis[x >> 9].data[x & 511]); } out.push(px); }
    return out;
  },
  addr(i = 0) { const f = olm.project.fixtures[i]; return [...f._out.lin]; },
  pts(i = 0) { return [...olm.project.fixtures[i]._pts].map(v => Math.round(v * 10) / 10); },
};
"""
def near(a, b, tol=2): return a is not None and b is not None and len(a) == len(b) and all(abs(x - y) <= tol for x, y in zip(a, b))

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); ctx = br.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True); pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.on("filechooser", lambda fc: None); pg.on("dialog", lambda d: d.dismiss())
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate; ev(SETUP)
    settle = lambda t=0.25: time.sleep(t)
    def one(fx, ctrl=None, layers=None, settings=None):
        args = [[list(x) for x in fx], ctrl or {}]
        js = "([fx, c, l, s]) => T.load(fx, c, l === null ? undefined : l, s || {})"
        ev(js, [args[0], args[1], layers, settings]); settle()

    # ---------- colour orders and white modes: solid (1, 0.5, 0.25) → R 255, G 128, B 64
    R, G, B = 255, 128, 64
    W = min(R, G, B)
    exp = {'R': R, 'G': G, 'B': B}
    for order in ev("ORDERS"):
        for wm in (['off', 'sub', 'add'] if 'W' in order and len(order) == 4 else ['off']):
            one([('line', {'pixels': 4, 'order': order})], settings={'whiteMode': wm})
            got = ev("T.bytes()")
            if order == 'W': want = [round(0.2126 * R + 0.7152 * G + 0.0722 * B)]
            else:
                vals = dict(exp)
                if 'W' in order:
                    vals['W'] = 0 if wm == 'off' else W
                    if wm == 'sub': vals = {k: (v - W if k != 'W' else v) for k, v in vals.items()}
                want = [vals[c] for c in order]
            check(f"order {order}, white {wm}: bytes {want}", got and all(near(p, want) for p in got), got[:1] if got else got)

    # ---------- dimmer, trims, master, blackout, off, gamma
    one([('line', {'pixels': 4, 'dimmer': 0.5})]); check("dimmer 0.5 halves every channel", near(ev("T.bytes()")[0], [R / 2, G / 2, B / 2], 2), ev("T.bytes()")[0])
    one([('line', {'pixels': 4, 'trim': [1, 0, 0.5, 1]})]); check("trims scale R, G, B on their own", near(ev("T.bytes()")[0], [R, 0, B / 2], 2), ev("T.bytes()")[0])
    one([('line', {'pixels': 4, 'order': 'RGBW', 'trim': [1, 1, 1, 0.5]})], settings={'whiteMode': 'add'}); check("the W trim scales white", near(ev("T.bytes()")[0], [R, G, B, W / 2], 2), ev("T.bytes()")[0])
    one([('line', {'pixels': 4})], settings={'master': 0.25}); check("master 0.25", near(ev("T.bytes()")[0], [R / 4, G / 4, B / 4], 2), ev("T.bytes()")[0])
    ev("toggleBlackout()"); settle(); check("blackout sends zeros", ev("T.bytes()")[0] == [0, 0, 0]); ev("toggleBlackout()"); settle()
    check("and back after blackout", near(ev("T.bytes()")[0], [R / 4, G / 4, B / 4], 2), ev("T.bytes()")[0])
    one([('line', {'pixels': 4, 'enabled': False})]); check("a fixture turned off sends zeros, keeps its channels", ev("T.bytes()")[0] == [0, 0, 0])
    one([('line', {'pixels': 4, 'gamma': 2.2})]); g = ev("T.bytes()")[0]
    check("gamma 2.2: 255 stays, 128 → ~56, 64 → ~12", near(g, [255, round(255 * (128 / 255) ** 2.2), round(255 * (64 / 255) ** 2.2)], 3), g)
    for gm in [1, 1.8, 2.2, 2.8]:
        one([('line', {'pixels': 2, 'gamma': gm})], layers=[['b-solid', {'color': [0, 0, 0, 1]}]]); z = ev("T.bytes()")[0]
        one([('line', {'pixels': 2, 'gamma': gm})], layers=[['b-solid', {'color': [1, 1, 1, 1]}]]); f = ev("T.bytes()")[0]
        check(f"gamma {gm}: black stays 0, white stays 255", z == [0, 0, 0] and f == [255, 255, 255], (z, f))

    # ---------- reverse
    one([('line', {'pixels': 10, 'x1': 100, 'y1': 100, 'x2': 900, 'y2': 100})]); a = ev("T.pts()")
    one([('line', {'pixels': 10, 'x1': 100, 'y1': 100, 'x2': 900, 'y2': 100, 'reverse': True})]); b = ev("T.pts()")
    check("reverse: pixel 1 is at the other end", [b[i:i + 2] for i in range(0, 20, 2)] == [a[i:i + 2] for i in range(0, 20, 2)][::-1], (a[:4], b[:4]))

    # ---------- matrix wiring: start corner, direction, snake
    corners = {'TL': (0, 0), 'TR': (1, 0), 'BL': (0, 1), 'BR': (1, 1)}
    for st, (cx, cy) in corners.items():
        for d in ['H', 'V']:
            for snake in [True, False]:
                one([('matrix', {'cx': 500, 'cy': 300, 'w': 400, 'h': 300, 'cols': 5, 'rows': 4, 'start': st, 'dir': d, 'snake': snake})])
                P = ev("T.pts()"); A = ev("T.addr()")
                order = sorted(range(len(A)), key=lambda i: A[i])
                xs = [P[2 * i] for i in order]; ys = [P[2 * i + 1] for i in order]
                first_ok = (abs(xs[0] - (300 + 400 * cx * 0.8 + 40)) < 41) and (abs(ys[0] - (150 + 300 * cy * 0.75 + 37.5)) < 38)
                step = [(round(xs[i + 1] - xs[i]), round(ys[i + 1] - ys[i])) for i in range(len(xs) - 1)]
                along = (lambda s: s[1] == 0) if d == 'H' else (lambda s: s[0] == 0)
                run = 5 if d == 'H' else 4
                runs_ok = all(along(step[i]) for i in range(len(step)) if (i + 1) % run)
                if snake: jumps_ok = all(abs(step[i][0]) + abs(step[i][1]) < 110 for i in range(len(step)))
                else: jumps_ok = all(along(step[i]) or abs(step[i][0 if d == 'H' else 1]) > 200 for i in range(len(step)))
                check(f"matrix start {st}, {'rows' if d == 'H' else 'columns'}, {'snake' if snake else 'no snake'}: wired from that corner, along its lines",
                      first_ok and runs_ok and jumps_ok and len(set(A)) == 20, (xs[:6], ys[:6]))

    # ---------- circles: start, direction, sweep, ovals
    one([('circle', {'cx': 500, 'cy': 300, 'r': 100, 'pixels': 4, 'start': 0})]); P = ev("T.pts()")
    check("circle start 0: pixel 1 at the top, then clockwise (right)", abs(P[0] - 500) < 1 and abs(P[1] - 200) < 1 and abs(P[2] - 600) < 1, P)
    one([('circle', {'cx': 500, 'cy': 300, 'r': 100, 'pixels': 4, 'start': 90, 'ccw': True})]); P = ev("T.pts()")
    check("start 90 anticlockwise: pixel 1 at the right, then up", abs(P[0] - 600) < 1 and abs(P[1] - 300) < 1 and abs(P[3] - 200) < 1, P)
    one([('circle', {'cx': 500, 'cy': 300, 'r': 100, 'pixels': 5, 'start': 270, 'sweep': 180})]); P = ev("T.pts()")
    check("a half arc from the left ends at the right, over the top", abs(P[0] - 400) < 1 and abs(P[8] - 600) < 1 and min(P[1::2]) < 201, P)
    one([('circle', {'cx': 500, 'cy': 300, 'r': 200, 'ry': 50, 'pixels': 40})]); P = ev("T.pts()")
    check("an oval is 400 wide and 100 high", 395 < max(P[0::2]) - min(P[0::2]) <= 401 and 95 < max(P[1::2]) - min(P[1::2]) <= 101, (min(P[0::2]), max(P[0::2]), min(P[1::2]), max(P[1::2])))
    pts = [100, 100, 300, 300, 500, 100]
    one([('path', {'pts': pts, 'pixels': 9})]); P = ev("T.pts()")
    check("a path's pixels run from its first point to its last", abs(P[0] - 100) < 1 and abs(P[-2] - 500) < 1, P)
    one([('path', {'pts': pts, 'pixels': 9, 'closed': True})]); P = ev("T.pts()")
    check("a closed path goes back towards its start", abs(P[-2] - 100) < 120 and P[-1] < 260, P[-4:])

    # ---------- controller options
    one([('line', {'pixels': 171})], ctrl={'split': False}); A = ev("T.addr()")
    check("skip ch 511–512: pixel 171 starts the next universe", A[169] == 507 and A[170] == 512, A[168:171])
    one([('line', {'pixels': 171})], ctrl={'split': True}); A = ev("T.addr()")
    check("split across universes: pixel 171 uses ch 511, 512 and the next universe's ch 1", A[170] == 510, A[168:171])
    one([('line', {'pixels': 10})], ctrl={'startUniverse': 7}); u = ev("olm.universes().map(u => u.uni)")
    check("start universe 7: the fixture is on universe 7", u[:1] == [7], u)
    one([('line', {'pixels': 600})], ctrl={'upo': 1}); ov = ev("olm.project.fixtures[0]._patch.overflow")
    check("too many pixels for the output: reported as not fitting", ov and ov > 0, ov)
    one([('line', {'pixels': 10})], ctrl={'enabled': False}); u = ev("olm.universes().filter(u => u.enabled).length")
    check("a controller turned off sends no universes", u == 0, u)
    ev("""(() => { const p = JSON.parse(serialize(false)); p.controllers[0].enabled = true; const c = p.controllers[0];
      for (let o = 1; o < 4; o++) { const f = JSON.parse(JSON.stringify(p.fixtures[0])); f.id = 'fx' + o; f.name = 'F' + o; p.fixtures.push(f); c.chains[o] = [f.id]; }
      olm.loadProject(p); })()"""); settle()
    u = ev("olm.universes().map(u => u.uni)")
    check("four outputs, four universes each: outputs start at 0, 4, 8, 12", u == [0, 4, 8, 12], u)
    one([('line', {'pixels': 2, 'order': 'RGB', 'addr': {'u': 2, 'ch': 101}})]); A = ev("T.addr()")
    check("advanced patch: starts at universe 2 ch 101", A[0] == 2 * 512 + 100, A)

    # ---------- blend modes: base (0.8, 0.4, 0.2), top (0.5, 0.5, 0.5)
    base, top = (0.8, 0.4, 0.2), (0.5, 0.5, 0.5)
    F = {'alpha': lambda b, t: t, 'add': lambda b, t: b + t, 'screen': lambda b, t: 1 - (1 - b) * (1 - t), 'multiply': lambda b, t: b * t,
         'subtract': lambda b, t: b - t, 'lighten': max, 'darken': min, 'difference': lambda b, t: abs(b - t)}
    for mode, fn in F.items():
        for op in [1, 0.5]:
            one([('line', {'pixels': 4})], layers=[['b-solid', {'color': [*base, 1]}], ['b-solid', {'color': [*top, 1]}, {'blend': mode, 'opacity': op}]])
            want = [round(255 * ((1 - op) * b + op * min(1, max(0, fn(b, t))))) for b, t in zip(base, top)]
            got = ev("T.bytes()")[0]
            check(f"blend {mode} at opacity {op}", near(got, want, 3), (got, want))
    one([('line', {'pixels': 4})], layers=[['b-solid', {'color': [*base, 1]}], ['b-solid', {'color': [*top, 1]}, {'on': False}]])
    check("a layer turned off doesn't show", near(ev("T.bytes()")[0], [204, 102, 51], 3), ev("T.bytes()")[0])
    for op in [0, 0.5, 1]:
        one([('line', {'pixels': 4})]); ev(f"olm.project.zones[0].opacity = {op}"); settle()
        check(f"zone opacity {op}", near(ev("T.bytes()")[0], [R * op, G * op, B * op], 3), ev("T.bytes()")[0])

    # ---------- every built-in effect, its controls at minimum, maximum and default
    one([('matrix', {'cx': 500, 'cy': 320, 'w': 900, 'h': 560, 'cols': 24, 'rows': 16})], layers=[['b-rainbow', None]])
    srcs = ev("olm.project.sources.filter(s => s.builtin).map(s => s.id)")
    bad = []
    for sid in srcs:
        ins = ev("id => isfInputs(srcById(id)).map(i => ({ n: i.NAME, t: i.TYPE, min: i.MIN, max: i.MAX, def: i.DEFAULT, vals: i.VALUES }))", sid)
        variants = [{}]
        for want in ['min', 'max']:
            v = {}
            for i in ins:
                if i['t'] == 'float' and i[want] is not None: v[i['n']] = i[want]
                elif i['t'] == 'long' and i['vals']: v[i['n']] = i['vals'][0 if want == 'min' else -1]
                elif i['t'] == 'bool': v[i['n']] = want == 'max'
                elif i['t'] == 'color': v[i['n']] = [0, 0, 0, 1] if want == 'min' else [1, 1, 1, 1]
            variants.append(v)
        for v in variants:
            n0 = len(errs)
            ev("([id, v]) => { const z = olm.project.zones[0]; z.layers = [Object.assign(newLayer(id), { params: { [id]: v } })]; }", [sid, v]); time.sleep(0.12)
            ok = ev("olm.universes().every(u => u.data.every(x => x >= 0 && x <= 255))") and len(errs) == n0
            if not ok: bad.append((sid, v, errs[n0:][:2]))
    check(f"all {len(srcs)} built-in effects render with their controls at minimum, maximum and default", not bad and len(srcs) >= 30, bad[:4])

    # ---------- highlight modes
    ev("olm.loadProject(demoProject())"); settle(0.5)
    for mode in ev("HL_MODES.map(m => m[0])"):
        ev("m => { ui.sel = new Set([olm.project.fixtures[0].id]); setHighlight(true, m); }", mode); settle(0.2)
        lit = ev("olm.universes().reduce((a, u) => a + u.data.reduce((x, v) => x + v, 0), 0)")
        check(f"highlight {mode}: " + ("dark until a pixel is picked" if mode == 'pixel' else "lights the pixels"), (lit == 0) if mode == 'pixel' else lit > 0, lit)
    ev("pickPixel(olm.project.fixtures[0], 5)"); settle(0.2)
    lit = ev("olm.universes().reduce((a, u) => a + u.data.reduce((x, v) => x + (v > 0), 0), 0)")
    check("pixel finder: one pixel lit, three channels", lit == 3, lit)
    ev("setHighlight(false)"); settle(0.3)
    check("highlight off: content again", ev("ui.outputMode") == 'content' and ev("olm.universes().reduce((a, u) => a + u.data.reduce((x, v) => x + v, 0), 0)") > 0)

    # ---------- every item of every menu, on the demo project; each followed by undo
    OPENERS = {
      'fixture': "fixtureMenu(E, P.fixtures[0], [P.fixtures[0].id])",
      'several fixtures': "fixtureMenu(E, P.fixtures[0], [P.fixtures[0].id, P.fixtures[5].id, P.fixtures[8].id])",
      'group': "(() => { const g = P.groups[0]; groupMenu(E, g, P.fixtures.filter(f => f.group === g.id)); })()",
      'stage': "canvasMenu(E, 500, 320)",
      'zone': "zoneMenu(E, P.zones[0])",
      'layer': "layerMenu(E, P.zones[2], P.zones[2].layers[0])",
      'built-in source': "sourceMenu(E, P.sources[0], () => loadSource(P.sources[0].id))",
      'controller': "controllerMenu(E, P.controllers[0])",
      'patch chip': "chipMenu(E, P.controllers[0].chains[1][1], P.controllers[0], 1)",
      'node': "nodeMenu(E, { ip: '10.0.0.77', shortName: 'Node', universes: [{ uni: 0 }, { uni: 1 }] })",
      'scene': "sceneMenu(E, P.zones[2], P.zones[2].scenes[1])",
      'project': "projectMenu($('#btnFile'))",
      'add fixture': "addFixtureMenu($('#btnFile'))",
      'add source': "addSourceMenu($('#btnAddSrc'))",
      'highlight': "highlightMenu($('#btnHl'))",
    }
    SKIP = ['Screen / window capture', 'Copy IP address']   # need a screen to share / clipboard permission
    menu_bad, n_items = [], 0
    def open_menu(opener):
        ev("() => document.querySelectorAll('.menu').forEach(m => m.remove())")
        ev("o => { const P = olm.project, E = { clientX: 600, clientY: 300, x: 600, y: 300 }; (new Function('P', 'E', o))(P, E); }", opener)
    def leaves(opener, path=()):
        open_menu(opener)
        for i, k in enumerate(path):
            pg.locator(".menu").nth(i).locator("button[role=menuitem]").nth(k).click()
        m = pg.locator(".menu").nth(len(path)); out = []
        for k in range(m.locator("button[role=menuitem]").count()):
            b = m.locator("button[role=menuitem]").nth(k)
            label = b.inner_text().split('\n')[0].strip()
            if b.get_attribute("aria-haspopup") == "menu": out += leaves(opener, path + (k,)); open_menu(opener); [pg.locator(".menu").nth(i).locator("button[role=menuitem]").nth(kk).click() for i, kk in enumerate(path)]
            elif not b.is_disabled(): out.append((path + (k,), label))
        return out
    for name, opener in OPENERS.items():
        ev("olm.loadProject(demoProject())"); settle(0.3)
        for path, label in leaves(opener):
            if label in SKIP: continue
            ev("olm.loadProject(demoProject())"); settle(0.15)
            n0 = len(errs); n_items += 1
            try:
                open_menu(opener)
                for i, k in enumerate(path): pg.locator(".menu").nth(i).locator("button[role=menuitem]").nth(k).click(timeout=3000)
                settle(0.15)
                ev("() => document.querySelectorAll('.modal-bg').forEach(m => m.remove())")
                ev("undo()"); settle(0.1); ev("redo()"); settle(0.1)
            except Exception as e: errs.append(f"{name} > {label}: {e}")
            if len(errs) > n0: menu_bad.append((name, label, errs[n0:][:2]))
    check(f"every menu item ({n_items} in {len(OPENERS)} menus) works, with undo and redo after it", not menu_bad and n_items > 80, menu_bad[:5])

    # ---------- every key, with fixtures selected
    ev("olm.loadProject(demoProject())"); settle(0.3)
    keys = ["v", "l", "m", "c", "p", "n", "z", "v", "f", "h", "h", "g", "g", "b", "b", "i", "i", "r", "Shift+R", "ArrowLeft", "Shift+ArrowRight", "ArrowUp", "ArrowDown",
            "Alt+ArrowDown", "Alt+ArrowUp", "1", "2", "Shift+3", "Control+d", "Control+g", "Control+Shift+G", "Control+l", "Control+l", "Control+a", "Control+z", "Control+Shift+Z", "Control+y",
            "Escape", "Escape", "Delete", "Control+z", "Backspace", "Control+z"]
    k_bad = []
    for k in keys:
        ev("ui.sel = new Set(olm.project.fixtures.slice(1, 3).map(f => f.id)); onSelection()")
        n0 = len(errs); pg.locator("#view").hover(); pg.keyboard.press(k); settle(0.08)
        if len(errs) > n0: k_bad.append((k, errs[n0:][:2]))
    check(f"every key ({len(set(keys))}) works with fixtures selected", not k_bad, k_bad[:4])
    n0 = ev("olm.project.fixtures.length"); ev("ui.sel = new Set([olm.project.fixtures[0].id]); onSelection()"); pg.keyboard.press("Control+d"); settle(0.1)
    check("Ctrl D duplicates", ev("olm.project.fixtures.length") == n0 + 1)
    pg.keyboard.press("Delete"); settle(0.1); check("Delete deletes", ev("olm.project.fixtures.length") == n0)

    # ---------- saving then opening gives the same project, for the demo and every example
    rt_bad = []
    ex = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'examples')
    projects = [("demo", None)] + [(n, json.load(open(os.path.join(ex, n), encoding='utf-8'))) for n in sorted(os.listdir(ex)) if n.endswith('.json')]
    for name, p in projects:
        a = ev("p => { olm.loadProject(p || demoProject()); return serialize(false); }", p)
        b = ev("s => { olm.loadProject(JSON.parse(s)); return serialize(false); }", a)
        if a != b: rt_bad.append(name)
    check(f"save then open gives the same project ({len(projects)} projects)", not rt_bad, rt_bad)
    check("no page errors", not errs, errs[:6])
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
