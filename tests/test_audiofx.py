# The music on the content: the effects that follow the beat and the sound (they compile, their music inputs follow
# the beat clock and are not shown as controls, they say where their beat comes from), Beat Steps lighting columns in
# turn, and the Fixture Chase source: groups or single fixtures lit one after the other on the beat (every, order,
# one or fill, fade, colour, ones left out), drawn per zone, as a mask with Multiply, its settings in the Content tab,
# kept by scenes, undo and files.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8238
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

AUDIO = ["beatpulse", "beatsteps", "spectrumbars", "spectrumring", "bassbloom", "kickrings", "beatstrobe", "levelmeter",
         "bassblobs", "spectrumveil", "inkdrops", "soundtide"]
bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 950})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate

    # ---------- the effects
    r = ev("ids => ids.map(id => { const s = srcById('b-' + id), rt = runtimeOf(s); return [id, !!rt.R && !rt.error, (rt.audio || []).length, isfInputs(s).some(i => AUDIO_INPUTS.has(i.NAME))]; })", AUDIO)
    check("12 effects follow the music, and all compile", all(x[1] for x in r) and all(x[2] > 0 for x in r), r)
    check("their music inputs are not shown as controls", not any(x[3] for x in r), r)
    check("the Fixture Chase is in the library", ev("srcById('b-fxchase') && srcById('b-fxchase').kind") == "chase")
    tags = ev("['b-beatpulse', 'b-fxchase'].map(id => srcFacets(srcById(id)).motion)")
    check("all found under Beat", tags == ["beat", "beat"], tags)

    # each drawn with the music quiet and loud: lit both ways, and different (Bass Bloom much bigger when loud)
    r = ev("""ids => { const keep = audioInputValue, out = {};
      for (const id of ids) { const src = srcById('b-' + id), rt = runtimeOf(src), sums = [];
        for (const lv of [0.05, 0.95]) {
          audioInputValue = n => n === 'audioSpectrum' ? tempoSpectrumCanvas(i => lv * (1 - 0.7 * i / 64)) : ({ audioBand: lv, audioBass: lv, audioMid: lv, audioHigh: lv, audioLevel: lv, audioKick: lv, beatCount: 7.3, beatPhase: 0.3, bpm: 120, beatsPerBar: 4 })[n] ?? 0;
          isfTime = 2; applyParams(rt, { params: {} }, src); rt.R.draw({ width: 96, height: 64 }); rt.R.draw({ width: 96, height: 64 }); isfTime = null;
          const c2 = document.createElement('canvas'); c2.width = 96; c2.height = 64; const x2 = c2.getContext('2d');
          x2.drawImage(glCanvas, 0, glCanvas.height - 64, 96, 64, 0, 0, 96, 64); const d = x2.getImageData(0, 0, 96, 64).data;
          let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; sums.push(Math.round(s / (96 * 64)));
        }
        out[id] = sums; }
      audioInputValue = keep; return out; }""", AUDIO[4:6] + AUDIO[8:])
    check("the atmospheric ones change with the music", all(v[1] > v[0] + 5 and v[1] > 20 for k, v in r.items() if k != "inkdrops"), r)
    check("Bass Bloom: a spark when quiet, filling the space when loud", r["bassbloom"][0] < 5 and r["bassbloom"][1] > 150, r["bassbloom"])
    ev("ids => ids.forEach(id => drawThumb(srcById('b-' + id), true))", AUDIO)
    time.sleep(1.5)
    r = ev("ids => ids.map(id => { const c = thumbs.get('b-' + id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s > 0; })", AUDIO)
    check("every one has a lit thumbnail", all(r), list(zip(AUDIO, r)))
    # Bass Bloom and Kick Rings listen to a range chosen on the layer
    r = ev("""(() => { const keep = audioInputValue, got = []; audioInputValue = (n, t, still, band) => { if (n === 'audioBand') got.push(band); return 0; };
      for (const [id, band] of [['b-bassbloom', null], ['b-kickrings', null], ['b-kickrings', 6]]) { const src = srcById(id), L = newLayer(id); if (band != null) L.params = { [id]: { band } }; applyParams(runtimeOf(src), L, src); }
      audioInputValue = keep;
      return [got, controlsOf(srcById('b-kickrings')).find(i => i.NAME === 'band').LABELS, AUDIO_BANDS.map(b => b[0])]; })()""")
    check("Bass Bloom listens to the bass, Kick Rings to the beat band, until another range is chosen", r[0] == [2, 0, 6], r[0])
    check("the ranges offered are the ones the app knows", r[1] == r[2], r[1:])
    r = ev("""(() => { const F = tempoFeat, keep = F.bands.slice(), A = tempo.analyser; tempo.analyser = { _fake: 1 }; const out = [];
      for (let i = 0; i < 200; i++) { F.frame = -5; F.custom = F.custom || {}; for (const k in F.custom) F.custom[k].frame = -2;
        F.bands.fill(0.5); const hi = i % 10 < 2; for (let b = 52; b < 64; b++) F.bands[b] = hi ? 0.9 : 0.5; F.frame = frameIndex; F.dt = 0.025;
        const v = [audioBandValue(6), audioBandValue(2)]; if (i > 150) out.push(v); }
      tempo.analyser = A; F.bands.set(keep); F.frame = -1;
      return [Math.max(...out.map(v => v[0])), Math.max(...out.map(v => v[1]))]; })()""")
    check("a hit in the highs moves Highs and hats, not Bass", r[0] > 0.8 and r[1] < 0.2, r)
    # the levels follow the music's own range: quiet music still swings fully, near silence stays dark
    r = ev("""(() => { for (const k in tempoRanges) delete tempoRanges[k]; const out = [];
      for (let i = 0; i < 400; i++) { const v = 0.3 + (i % 20 < 3 ? 0.15 : 0); const x = tempoRange('t', v, 0.025); if (i > 300) out.push(x); }
      let q = 0; for (let i = 0; i < 400; i++) q = Math.max(q, tempoRange('s', 0.01 + (i % 20 < 3 ? 0.02 : 0), 0.025));
      return [Math.min(...out), Math.max(...out), q]; })()""")
    check("quiet music (15% swing) still goes from dark to full", r[0] < 0.05 and r[1] > 0.95, r)
    check("near silence isn't blown up", r[2] < 0.25, r)

    # a zone of four bars side by side (columns), in four groups
    ev("""(() => { const p = blankProject('Chase'); p.zones[0].layers = [];
      p.groups = [1, 2, 3, 4].map(i => ({ id: 'g' + i, name: 'Bar ' + i }));
      for (let i = 0; i < 4; i++) { const f = newFixture('line', { x1: 125 + i * 250, y1: 100, x2: 125 + i * 250, y2: 540, pixels: 10 }); f.name = 'Bar ' + (i + 1); f.group = 'g' + (i + 1); f.id = 'f' + i; p.fixtures.push(f); }
      olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); })()""")
    time.sleep(0.4)
    Z = "olm.project.zones[0]"
    # the beat clock set: 30 BPM (2 s a beat), at beat k + phase
    at = lambda k, ph=0.1: ev(f"(() => {{ tempo.bpm = 30; tempo.anchor = performance.now() - ({k} + {ph}) * 2000; }})()")
    lit = lambda: ev("olm.project.fixtures.map(f => { let s = 0; for (const v of f._col) s += v; return Math.round(s / f._col.length); })")
    # the beat clock held at beat k + phase while a few frames go out
    def look(k, ph=0.1):
        ev(f"tempo.fixed = {k} + {ph}"); time.sleep(0.25); return lit()

    # ---------- Beat Steps: the columns in turn
    ev(f"{Z}.layers = [newLayer('b-beatsteps')]; commit()"); time.sleep(0.3)
    seq = [look(k) for k in range(4)]
    check("Beat Steps lights the columns one beat each", all(seq[k][k] > 150 and sum(v for i, v in enumerate(seq[k]) if i != k) < 20 for k in range(4)), seq)
    ev(f"setParam({Z}.layers[0], srcById('b-beatsteps'), 'order', 1); commit()")
    check("backward, beat 0 is the last column", look(0)[3] > 150 and look(1)[2] > 150)
    ev(f"setParam({Z}.layers[0], srcById('b-beatsteps'), 'every', 3); setParam({Z}.layers[0], srcById('b-beatsteps'), 'order', 0); setParam({Z}.layers[0], srcById('b-beatsteps'), 'decay', 0); commit()")
    check("every 2 beats: beats 2 and 3 on the second column", look(2)[1] > 150 and look(3, 0.05)[1] > 50)
    ev("ui.rightTab = 'content'; ui.layer = olm.project.zones[0].layers[0].id; showRight(true); renderRight()"); time.sleep(0.3)
    check("its Parameters say it follows the beat", "Follows the beat" in pg.inner_text("#rightBody .tnote"), pg.inner_text("#rightBody .tnote"))

    # ---------- Fixture Chase
    ev(f"{Z}.layers = [newLayer('b-fxchase')]; ui.layer = {Z}.layers[0].id; commit(); renderRight()"); time.sleep(0.3)
    seq = [look(k) for k in range(5)]
    check("by groups: Bar 1 on beat 1, Bar 2 on beat 2, Bar 3 on beat 3, Bar 4 on beat 4, then Bar 1 again",
          all(seq[k][k % 4] > 150 and sum(v for i, v in enumerate(seq[k]) if i != k % 4) < 10 for k in range(5)), seq)
    look(0, 0.0)
    check("white by default, full at the beat", ev("Array.from(olm.project.fixtures[0]._col.slice(0, 3)).join()") == "255,255,255")
    sec = pg.locator("#rightBody .sec", has_text="Chase")
    check("the Content tab has its settings: the groups ticked in order", sec.count() == 1 and sec.locator(".chstep").all_inner_texts() == ["1Bar 1", "2Bar 2", "3Bar 3", "4Bar 4"] or [t.replace("\n", "") for t in sec.locator(".chstep").all_inner_texts()] == ["1Bar 1", "2Bar 2", "3Bar 3", "4Bar 4"], sec.locator(".chstep").all_inner_texts())
    h0 = ev("hist.idx")
    sec.locator(".chstep", has_text="Bar 2").locator("input").uncheck(); time.sleep(0.3)
    check("unticking Bar 2 leaves it out: a step of undo", ev(f"{Z}.layers[0].params['b-fxchase'].skip") == ["g2"] and ev("hist.idx") == h0 + 1)
    seq = [look(k) for k in range(3)]
    check("the chase goes Bar 1, Bar 3, Bar 4", seq[0][0] > 150 and seq[1][2] > 150 and seq[2][3] > 150 and all(s[1] < 10 for s in seq), seq)
    ev("undo()"); time.sleep(0.3)
    check("undo puts it back", "skip" not in ev(f"{Z}.layers[0].params['b-fxchase'] || {{}}") or ev(f"{Z}.layers[0].params['b-fxchase'].skip") == [])
    sec = pg.locator("#rightBody .sec", has_text="Chase")
    sec.locator(".seg button", has_text="Fixtures").click(); time.sleep(0.3)
    check("by fixtures: one step per fixture", ev(f"chaseParams({Z}.layers[0], srcById('b-fxchase')).by") == "fixtures" and pg.locator("#rightBody .chstep").count() == 4)
    pg.locator("#rightBody .sec", has_text="Chase").locator(".seg button", has_text="Fill").click(); time.sleep(0.3)
    check("Fill: the steps add up through the round", [v > 150 for v in look(2)] == [True, True, True, False], look(2))
    pg.locator("#rightBody .sec", has_text="Chase").locator(".seg button", has_text="One").click(); time.sleep(0.2)
    pg.locator("#rightBody select[aria-label='Chase order']").select_option("pingpong"); time.sleep(0.2)
    pp = [max(range(4), key=lambda i: look(k)[i]) for k in range(7)]
    check("Ping-pong: 1 2 3 4 3 2 1", pp == [0, 1, 2, 3, 2, 1, 0], pp)
    pg.locator("#rightBody select[aria-label='Chase order']").select_option("forward"); time.sleep(0.2)
    pg.locator("#rightBody .sec", has_text="Chase").locator(".seg button", has_text="½").click(); time.sleep(0.2)
    check("every half beat: two steps a beat", max(range(4), key=lambda i: look(1, 0.05)[i]) == 2 and max(range(4), key=lambda i: look(1, 0.55)[i]) == 3)
    pg.locator("#rightBody .sec", has_text="Chase").locator(".seg button", has_text="1").first.click(); time.sleep(0.2)
    ev(f"(() => {{ const q = {Z}.layers[0].params['b-fxchase']; q.fade = 0.5; commit(); }})()")
    check("Fade: lit at the step's start, dark after half of it", look(0, 0.05)[0] > 150 and look(0, 0.7)[0] < 10)
    ev(f"(() => {{ const q = {Z}.layers[0].params['b-fxchase']; q.fade = 0; q.color = [1, 0, 0, 1]; commit(); }})()")
    c = (look(0, 0.9), ev("Array.from(olm.project.fixtures[0]._col.slice(0, 3))"))
    check("Fade 0: lit the whole step; its colour", c[0][0] > 50 and c[1][0] > 200 and c[1][1] < 10 and c[1][2] < 10, c)

    # ---------- a mask over other content
    ev(f"""(() => {{ const z = {Z}; z.layers = [Object.assign(newLayer('b-rainbow'), {{ params: {{ 'b-rainbow': {{ angle: 90 }} }} }}), Object.assign(newLayer('b-fxchase'), {{ blend: 'multiply', params: {{ 'b-fxchase': {{ color: [1, 1, 1, 1], fade: 0 }} }} }})]; commit(); }})()""")
    time.sleep(0.3)
    m = look(2, 0.3)
    cols = ev("Array.from(olm.project.fixtures[2]._col.slice(0, 30))")
    check("with Multiply it masks: the content shows only on the lit bar", m[2] > 40 and sum(v for i, v in enumerate(m) if i != 2) < 10, m)
    check("and it is the content's colours, not white", len({tuple(cols[i:i + 3]) for i in range(0, 30, 3)}) > 2, cols[:9])

    # ---------- per zone
    ev(f"""(() => {{ const z = {Z}; z.w = 500; z.layers = [Object.assign(newLayer('b-fxchase'), {{ params: {{ 'b-fxchase': {{ by: 'fixtures', fade: 0 }} }} }})]; markGeom(); commit(); }})()""")
    time.sleep(0.3)
    zs = [look(k) for k in range(3)]
    check("in a zone: only its fixtures take turns", [max(range(4), key=lambda i: s[i]) for s in zs] == [0, 1, 0] and all(s[2] < 10 and s[3] < 10 for s in zs), zs)

    # ---------- scenes, files
    ev(f"storeScene({Z})"); time.sleep(0.2)
    check("a scene keeps the chase's settings", ev(f"{Z}.scenes[0].layers[0].params['b-fxchase'].by") == "fixtures")
    saved = json.loads(ev("serialize()"))
    check("saved with the project", saved["zones"][0]["layers"][0]["params"]["b-fxchase"]["by"] == "fixtures")
    ev("olm.loadProject(JSON.parse(serialize()))"); time.sleep(0.3)
    check("and opened again", ev(f"{Z}.layers[0].src") == "b-fxchase" and [max(range(4), key=lambda i: s[i]) for s in [look(1)]] == [1])
    ev("tempo.fixed = null")
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
