# Makes the example projects in examples/ with the app itself (so they are always in the current file format),
# then opens each one again and checks it: no page errors, every fixture patched without conflicts, every scene
# plays, the output has light in it, and every playlist plays its steps.   python3 make_examples.py [port] [--check]   (--check: don't rewrite them)
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
args = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = int(args[0]) if args else 8154
CHECK = '--check' in sys.argv
EX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'examples')
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

# Each builder runs in the page and returns the project; helpers: F (add a fixture), C (add a controller), L (a layer),
# S (a scene), Z (a zone, its first scene on), P (a playlist of a zone's scenes, by name: [scene, play time, own fade]).
HELPERS = """
  const F = (t, p) => { const f = newFixture(t, p); project.fixtures.push(f); return f; };
  const C = p => { const c = newController(p); project.controllers.push(c); return c; };
  const G = (name, tag, list) => { const g = { id: uid(), name, tag, open: true }; list.forEach(f => { f.group = g.id; }); project.groups.push(g); return g; };
  const L = (src, o = {}) => Object.assign(newLayer(src), o, { params: o.params ? { [src]: o.params } : {} });
  const S = (name, tag, fade, layers) => ({ id: uid(), name, tag, fade, layers });
  const Z = p => { const z = newZone(p); z.scene = z.scenes[0].id; z.layers = cloneLayers(z.scenes[0].layers); return z; };
  const P = (z, name, steps, o = {}) => { const pl = newPlaylist(Object.assign({ name, steps: steps.map(([n, t, f]) => newStep(z.scenes.find(s => s.name === n).id, t, f ?? null)) }, o)); z.playlists.push(pl); return pl; };
"""
EXAMPLES = {
  '01-led-bars.json': """
    project = blankProject('LED bars');
    // twelve 1 m bars, 60 pixels each, standing on a 1000 × 640 stage; even bars are wired from the top
    const bars = []; for (let i = 0; i < 12; i++) bars.push(F('line', { name: 'Bar ' + (i + 1), x1: 115 + i * 70, y1: 560, x2: 115 + i * 70, y2: 80, pixels: 60, reverse: i % 2 === 1, tag: TAGS[i < 6 ? 0 : 1] }));
    G('Left', TAGS[0], bars.slice(0, 6)); G('Right', TAGS[1], bars.slice(6));
    const c = C({ name: 'Bar controller', ip: '10.0.0.50', outputs: 4, upo: 2, startUniverse: 0 });
    c.chains = [bars.slice(0, 3), bars.slice(3, 6), bars.slice(6, 9), bars.slice(9)].map(l => l.map(f => f.id));
    project.zones = [Z({ name: 'Bars', tag: TAGS[1], scenes: [
      S('Scanner', TAGS[0], 1, [L('b-scanner', { params: { count: 2, angle: 0, rainbow: true } })]),
      S('Rain', TAGS[5], 2, [L('b-rain', { params: { angle: 90, color: [0.3, 0.7, 1, 1] } })]),
      S('Equalizer', TAGS[4], 0.5, [L('b-equalizer', { params: { count: 12, angle: 90 } })]),
      S('Fire', TAGS[1], 3, [L('b-fire')]),
      S('Strobe hit', TAGS[6], 0, [L('b-strobe', { params: { rate: 6 } })]),
    ] })];
    // a show that runs by itself when the project opens
    P(project.zones[0], 'Show', [['Scanner', 30], ['Rain', 30], ['Equalizer', 20], ['Fire', 30], ['Strobe hit', 3, 0]], { autoplay: true });
  """,
  '02-matrix-wall.json': """
    project = blankProject('Matrix wall');
    project.settings.compW = 1280; project.settings.compH = 640;
    // four 32 × 32 panels side by side, snaking rows, on two controllers
    const panels = [0, 1, 2, 3].map(i => F('matrix', { name: 'Panel ' + 'ABCD'[i], cx: 160 + i * 320, cy: 320, w: 300, h: 300, cols: 32, rows: 32, start: i % 2 ? 'TR' : 'TL', dir: 'H', snake: true, tag: TAGS[i] }));
    G('Wall', TAGS[2], panels);
    const a = C({ name: 'Left controller', ip: '10.0.0.60', outputs: 2, upo: 8, startUniverse: 0 });
    const b = C({ name: 'Right controller', ip: '10.0.0.61', outputs: 2, upo: 8, startUniverse: 16 });
    a.chains = [[panels[0].id], [panels[1].id]]; b.chains = [[panels[2].id], [panels[3].id]];
    project.zones = [
      Z({ name: 'Whole wall', tag: TAGS[2], w: 1280, h: 640, scenes: [
        S('Spiral', TAGS[4], 2, [L('b-spiral', { params: { rainbow: true, arms: 3 } })]),
        S('Mirror ball', TAGS[6], 2, [L('b-mirrorball')]),
        S('Lava', TAGS[1], 3, [L('b-lava')]),
        S('Plasma + stars', TAGS[0], 2, [L('b-plasma'), L('b-stars', { blend: 'add', opacity: 0.8 })]),
      ] }),
      Z({ name: 'Panel B only', tag: TAGS[1], x: 330, y: 170, w: 300, h: 300, opacity: 0, scenes: [
        S('Checker', TAGS[3], 1, [L('b-checker', { params: { size: 0.25 } })]),
      ] }),
    ];
  """,
  '03-rings-and-arcs.json': """
    project = blankProject('Rings and arcs');
    // full rings, half-ring arcs, an oval and a ring wired the other way round
    const rings = [0, 1, 2].map(i => F('circle', { name: 'Ring ' + (i + 1), cx: 200 + i * 300, cy: 220, r: 120, pixels: 72, tag: TAGS[2] }));
    const arcs = [0, 1].map(i => F('circle', { name: 'Arc ' + (i + 1), cx: 350 + i * 300, cy: 460, r: 110, pixels: 40, start: 270, sweep: 180, ccw: i === 1, tag: TAGS[3] }));
    const oval = F('circle', { name: 'Oval', cx: 500, cy: 560, r: 200, ry: 50, pixels: 90, tag: TAGS[4] });
    const back = F('circle', { name: 'Ring CCW', cx: 900, cy: 520, r: 70, pixels: 48, ccw: true, order: 'GRB', tag: TAGS[5] });
    G('Rings', TAGS[2], rings); G('Arcs', TAGS[3], arcs);
    const c = C({ name: 'Ring controller', ip: '10.0.0.70', outputs: 4, upo: 2, startUniverse: 0 });
    c.chains = [rings.map(f => f.id), arcs.map(f => f.id), [oval.id], [back.id]];
    project.zones = [Z({ name: 'All', tag: TAGS[2], scenes: [
      S('Pulse rings', TAGS[0], 1, [L('b-pulse', { params: { frequency: 6 } })]),
      S('Radar', TAGS[2], 1.5, [L('b-sweep', { params: { arms: 2 } })]),
      S('Comets', TAGS[4], 1, [L('b-comet', { params: { mode: 2, count: 4 } })]),
      S('Aurora', TAGS[5], 4, [L('b-aurora')]),
    ] })];
  """,
  '04-stage-mixed.json': """
    project = blankProject('Stage, mixed fixtures');
    project.settings.gamma = 2.2; project.settings.fps = 44; project.settings.fade = 1.5;
    // a back truss of RGBW strips, a floor path, a centre matrix, side rings; advanced patch and trims
    const truss = [0, 1, 2, 3].map(i => F('line', { name: 'Truss ' + (i + 1), x1: 60 + i * 230, y1: 60, x2: 270 + i * 230, y2: 60, pixels: 72, order: 'GRBW', tag: TAGS[0], gamma: 2.2 }));
    const pts = []; for (let i = 0; i <= 30; i++) pts.push(80 + i * 28, 590 - Math.sin(i / 30 * Math.PI) * 60);
    const floor = F('path', { name: 'Floor curve', pts, pixels: 150, tag: TAGS[3], gamma: 2.2 });
    const centre = F('matrix', { name: 'Centre panel', cx: 500, cy: 300, w: 240, h: 240, rot: 45, cols: 16, rows: 16, start: 'BL', dir: 'V', snake: true, tag: TAGS[2], gamma: 2.2 });
    // the rings are 16-bit: the left one dims on a square-law curve, the right one on a steeper S curve (strength 150 %)
    const sides = [0, 1].map(i => F('circle', { name: (i ? 'Right' : 'Left') + ' ring', cx: 170 + i * 660, cy: 320, r: 90, pixels: 60, dimmer: 0.8, trim: [1, 0.85, 0.7, 1], tag: TAGS[1], gamma: 2.2, bits: 16, curve: i ? 'scurve' : 'square', strength: i ? 1.5 : 1 }));
    const spare = F('line', { name: 'Spare strip (locked, off)', x1: 400, y1: 470, x2: 600, y2: 470, pixels: 30, enabled: false, locked: true, tag: TAGS[6] });
    G('Truss', TAGS[0], truss); G('Rings', TAGS[1], sides);
    const c = C({ name: 'Main controller', ip: '10.0.0.80', outputs: 4, upo: 4, startUniverse: 0, split: true });
    c.chains = [truss.map(f => f.id), [floor.id], [centre.id], sides.map(f => f.id).concat(spare.id)];
    sides[1].addr = { u: c.startUniverse + 3 * c.upo + 1, ch: 1 };   // the right ring starts on the second universe of its output (advanced patch)
    project.zones = [
      Z({ name: 'Everything', tag: TAGS[1], scenes: [
        S('Warm wash', TAGS[1], 3, [L('b-breathe', { params: { colorA: [1, 0.5, 0.15, 1], colorB: [1, 0.85, 0.5, 1] } })]),
        S('Clouds', TAGS[5], 4, [L('b-clouds')]),
        S('Confetti', TAGS[4], 0.5, [L('b-confetti')]),
      ] }),
      Z({ name: 'Truss', tag: TAGS[0], x: 40, y: 30, w: 940, h: 60, scenes: [
        S('Wipe', TAGS[0], 1, [L('b-wipe', { params: { mode: 1 } })]),
        S('Hits', TAGS[6], 0, [L('b-hits', { params: { bpm: 128 } })]),
      ] }),
      Z({ name: 'Centre', tag: TAGS[2], x: 330, y: 130, w: 340, h: 340, opacity: 0.85, scenes: [
        S('Shape over noise', TAGS[2], 2, [L('b-noise'), L('b-shape', { blend: 'multiply', params: { shape: 1 } })]),
        S('Disco', TAGS[4], 0.5, [L('b-discodots', { params: { bpm: 124 } })]),
      ] }),
    ];
    // two playlists on the whole stage, Party handing back to Evening; the truss alternates on its own
    const [whole, trussZone] = project.zones;
    const evening = P(whole, 'Evening', [['Warm wash', 90], ['Clouds', 60], ['Warm wash', 90, 8]]);
    P(whole, 'Party', [['Confetti', 20], ['Clouds', 10], ['Confetti', 20]], { fade: 0.5, end: evening.id });
    P(trussZone, 'Hits', [['Wipe', 8], ['Hits', 4, 0]]);
  """,
}

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    if not CHECK:
        for name, body in EXAMPLES.items():
            data = pg.evaluate("() => { const saved = project; try {" + HELPERS + body + " return JSON.parse(JSON.stringify(project, replacer)); } finally { project = saved; } }")
            with open(os.path.join(EX, name), 'w', encoding='utf-8') as fh: json.dump(data, fh, indent=1); fh.write('\n')
            print('wrote', name)
    for name in sorted(n for n in os.listdir(EX) if n.endswith('.json')):
        data = json.load(open(os.path.join(EX, name), encoding='utf-8'))
        r = pg.evaluate("""p => { olm.loadProject(p); const P = olm.project; olm.computePatch();
          const unpatched = P.fixtures.filter(f => f.enabled && !f._patch).map(f => f.name);
          const bad = P.fixtures.filter(f => f._patch && (f._patch.overflow || f._patch.overlap || f._patch.outside)).map(f => f.name);
          return { n: P.fixtures.length, unpatched, bad, scenes: P.zones.reduce((a, z) => a + z.scenes.length, 0), unis: olm.universes().length }; }""", data)
        check(f"{name}: opens, {r['n']} fixtures, {r['unis']} universes, all patched", r['n'] > 0 and not r['unpatched'] and not r['bad'], r)
        lit = []
        for zi, z in enumerate(data['zones']):
            for s in z['scenes']:
                pg.evaluate("([zi, id]) => { const z = olm.project.zones[zi]; olm.goScene(z, z.scenes.find(s => s.id === id), true); }", [zi, s['id']])
                light = 0
                for _ in range(30):   # a strobe is dark between flashes: look often (faster than it flashes)
                    time.sleep(0.03); light = max(light, pg.evaluate("olm.universes().reduce((a, u) => a + u.data.reduce((x, v) => x + v, 0), 0)"))
                lit.append((s['name'], light))
        check(f"{name}: every scene plays and lights the pixels", all(v > 0 for _, v in lit), [n for n, v in lit if not v])
        lists = sum(len(z.get('playlists', [])) for z in data['zones'])
        if lists:
            r = pg.evaluate("""() => olm.project.zones.flatMap(z => z.playlists.map(pl => { playPlaylist(z, pl.id); const ok = [];
              for (let i = 0; i < pl.steps.length; i++) { stepPlaylist(z, i ? 1 : 0); ok.push(z.scene === pl.steps[i].scene); } stopPlaylist(z); return [pl.name, ok.every(Boolean)]; }))""")
            check(f"{name}: its {lists} playlist{'s' if lists > 1 else ''} play their steps", all(ok for _, ok in r), r)
    # the other example files: an SVG layout, a custom ISF shader, a short video
    pg.evaluate("olm.loadProject(JSON.parse(JSON.stringify(blankProject('Imports'))))")
    pg.set_input_files("#fileSvg", os.path.join(EX, "05-facade.svg")); pg.click(".modal button:has-text('Import')"); time.sleep(0.8)
    names = pg.evaluate("olm.project.fixtures.map(f => f.name + ':' + f.type)")
    want = ["Roof", "Edge left", "Edge right", "Rose window", "Window 1", "Window 5", "Door arch", "Fountain"]
    check("05-facade.svg imports its 11 shapes as named fixtures, with the guide", len(names) == 11 and all(any(n.startswith(w + ':') for n in names) for w in want) and pg.evaluate("!!olm.project.guide"), names)
    check("its circle is a circle and its ellipse an oval", any(n == "Rose window:circle" for n in names) and pg.evaluate("olm.project.fixtures.some(f => f.name === 'Fountain' && f.type === 'circle' && f.ry > 0 && f.ry !== f.r)"), names)
    n0 = pg.evaluate("olm.project.sources.length")
    pg.set_input_files("#fileIsf", os.path.join(EX, "06-GradientBounce.fs")); time.sleep(0.8)
    src = pg.evaluate("(() => { const s = olm.project.sources.at(-1); return { kind: s.kind, name: s.name, ins: isfInputs(s).map(i => i.NAME) }; })()")
    check("06-GradientBounce.fs adds a shader source with its six controls", pg.evaluate("olm.project.sources.length") == n0 + 1 and src["ins"] == ["colorA", "colorB", "speed", "softness", "angle", "mirror"], src)
    pg.evaluate("(() => { const z = olm.project.zones[0]; z.layers = [newLayer(olm.project.sources.at(-1).id)]; })()"); time.sleep(0.5)
    check("and it renders without shader errors", not [e for e in errs if 'shader' in e.lower() or 'isf' in e.lower()], errs[:3])
    pg.set_input_files("#fileMedia", os.path.join(EX, "07-test-clip.webm")); time.sleep(3)
    check("07-test-clip.webm adds a video source", pg.evaluate("olm.project.sources.at(-1).kind") == "video", pg.evaluate("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')"))
    check("no page errors", not errs, errs[:5])
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
