// nouPix · js/ui-tempo.js
// Tempo in Settings: the BPM with a dot on every beat and the beats of the bar counting, where the beat comes from
// (listening to a sound card, or tapping), the input and its trim with a level meter, 4/4 or 2/4, Tap and Downbeat.
// What moves is drawn once a frame (tempoFrame, from the frame loop), the rest when something changes (updateTempoUI).

let tempoSecEl = null, tempoLive = null;

function tempoSection() {
  const src = ui.tempoSrc === 'tap' ? 'tap' : 'audio', listening = tempo.on || tempo.starting, per = tempoBpb();
  // the readout: a dot lighting red on each beat, the BPM, the beats of the bar
  const dot = h('i', { class: 'tdot', 'aria-hidden': 'true' }), num = h('span', { class: 'tbpm' }, tempo.bpm.toFixed(1)), bars = h('span', { class: 'tbar' }, Array.from({ length: per }, () => h('i'))),
    state = h('span', { class: 'tstate' });
  const meter = h('div', { class: 'tmeter', 'aria-hidden': 'true' }, h('i', { class: 'lv' }), h('i', { class: 'rest' }), h('i', { class: 'pk' }));
  const spec = h('canvas', { class: 'tspec', 'aria-label': 'Spectrum with the beat band: drag its edges, or the band itself; double-click for 40 to 150 Hz',
    title: 'The beat band: what the beat is found in. Drag its edges (or the band) onto the kick drum. Double-click: 40–150 Hz.' });
  const trace = h('canvas', { class: 'ttrace', 'aria-label': 'What the beat band hears, and where the beats fall', title: 'The last 4 seconds: the hits in the beat band, and a tick on every beat (red on 1)' });
  bandDrag(spec);
  tempoLive = { dot, num, bars: [...bars.children], state, meter, spec, trace, lastN: null, drawn: 0 };
  const readout = h('div', { class: 'tempo-read' }, dot, h('span', { class: 'tnum' }, num, h('small', null, 'BPM')), bars, state);
  const kids = [readout,
    tipRow(row('Beat from', seg([['audio', 'Audio'], ['tap', 'Tap']], src, v => { ui.tempoSrc = v; savePrefs(); updateTempoUI(); })),
      'Audio: nouPix listens to a sound card and finds the beat. Tap: you give it, with Tap or a MIDI pad.')];
  if (src === 'audio') {
    if (!tempoUsable()) kids.push(h('p', { class: 'note warn' }, 'This browser can’t listen to a sound card here.'));
    else {
      const sw = h('button', { class: 'onsw' + (listening ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(listening), disabled: tempo.starting,
        onclick: () => tempoListen(!listening) }, h('i'), listening ? 'ON' : 'OFF');
      const devs = tempo.devices.length ? tempo.devices : [{ id: 'default', name: 'Default input' }];
      // long names (a sound card's are) are cut short with … ; the whole name shows on the list's tip
      const short = n => (n.length > 26 ? n.slice(0, 25).trimEnd() + '…' : n), cur = devs.find(d => d.id === ui.tempoIn) || devs[0];
      const pick = selectEl(devs.map(d => [d.id, short(d.name)]), cur.id, v => tempoInput(v), { aria: 'Sound input' });
      pick.title = cur.name;
      const trim = { v: +ui.tempoTrim || 0 };
      kids.push(row('Listen', sw),
        tipRow(row('Input', pick), 'The sound card nouPix listens to. Their names show once it was allowed to listen.'),
        tipRow(sliderRow('Trim', trim, 'v', { min: -24, max: 24, step: 0.5, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB', onInput: () => tempoTrim(trim.v), onCommit: () => tempoTrim(trim.v) }),
          'The input level. Aim for the meter in the upper part on the loud beats, short of red.'),
        h('div', { class: 'tmrow' }, meter),
        listening ? h('div', { class: 'tsig' }, h('div', { class: 'tspecw' }, spec,
          h('button', { class: 'tbreset', type: 'button', title: 'The beat band back to the kick drum: 40–150 Hz', onclick: () => tempoBand(TEMPO_BAND[0], TEMPO_BAND[1], true) }, 'Reset')), trace) : null);
      if (tempo.err) kids.push(h('p', { class: 'note warn' }, tempo.err));
    }
  }
  kids.push(tipRow(row('Bar', seg([[4, '4/4'], [2, '2/4']], per, v => { ui.tempoBpb = +v; savePrefs(); updateTempoUI(); })), 'Beats in a bar: the lines count them, 1 on the downbeat.'),
    h('div', { class: 'actions' },
      midiButton(h('button', { class: 'btn', type: 'button', title: 'Tap on every beat. The first tap is beat 1. A MIDI pad can tap too.', onpointerdown: e => { e.preventDefault(); tempoTap(); } }, 'Tap'), 'tap'),
      h('button', { class: 'btn', type: 'button', title: 'The beat nearest now becomes beat 1 of the bar', onclick: () => tempoDownbeat() }, 'Downbeat')));
  const el = h('div', { class: 'sec tempo', id: 'tempoSec' }, h('h3', null, 'Tempo'), kids);
  tempoSecEl = el;
  tempoFrame(performance.now(), true);
  return el;
}
// Drawn again in place when something changes (an input found, listening started, a tap)
function updateTempoUI() {
  // the notes on effects that follow the music say where their beat comes from now
  for (const n of $$('.tnote[data-sound]')) n.replaceWith(tempoNote(n.dataset.sound === '1'));   // not touch effects' note
  if (!tempoSecEl || !tempoSecEl.isConnected) return;
  const old = tempoSecEl;
  old.replaceWith(tempoSection());
  markMidi();
}
// How lit a beat's dot is: full at the beat, fading over the first half of it (a little less on beats other than 1)
const tempoGlow = at => Math.pow(Math.max(0, 1 - at.phase / 0.45), 2) * (at.inBar === 0 ? 1 : 0.7);
// Once a frame while Settings shows it: the dot on each beat, the bar's lines, the BPM, the meter
function tempoFrame(now, force) {
  const L = tempoLive;
  if (!L || !tempoSecEl || !tempoSecEl.isConnected) return;
  const at = tempoAt(now), sure = ui.tempoSrc === 'tap' ? tempo.taps.length > 1 || !!ui.tempoBpm : tempo.locked;
  const o = sure ? (0.18 + 0.82 * tempoGlow(at)).toFixed(2) : '';
  if (L.dot.style.opacity !== o) L.dot.style.opacity = o;
  L.dot.classList.toggle('idle', !sure);
  // the bar's lines every frame (a Downbeat or a tap can move them without a new beat)
  L.bars.forEach((b, i) => { const c = sure && i === at.inBar ? (i === 0 ? 'one' : 'on') : sure && i < at.inBar ? 'past' : ''; if (b.className !== c) b.className = c; });
  if (at.n !== L.lastN || force) {
    L.lastN = at.n;
    L.num.textContent = tempo.bpm.toFixed(1);
    L.state.textContent = ui.tempoSrc === 'tap' ? (tempo.taps.length ? `${tempo.taps.length} tap${tempo.taps.length === 1 ? '' : 's'}` : 'Tap the beat')
      : !tempo.on ? 'Not listening' : !tempo.locked ? 'Listening…' : tempo.holding ? 'Holding: no clear beat' : 'Following';
  }
  if (L.spec.isConnected && tempo.on && now - L.drawn > 33) { L.drawn = now; drawSpectrum(L.spec); drawTrace(L.trace, now); }
  if (L.meter.isConnected) {
    const w = db => clamp((db + 60) / 60, 0, 1) * 100;
    L.meter.children[1].style.left = w(tempo.on ? tempo.level : -100) + '%';   // the scale shows up to the level
    L.meter.lastChild.style.left = w(tempo.on ? tempo.peak : -100) + '%';
    L.meter.classList.toggle('clip', tempo.on && tempo.peak > -1);
  }
}

/* ---------- the spectrum and the beat band ---------- */
// x on the spectrum for a frequency: 20 Hz to 16 kHz on a log scale
const SPEC_LO = 20, SPEC_HI = 16000;
const specX = (f, w) => Math.log(f / SPEC_LO) / Math.log(SPEC_HI / SPEC_LO) * w;
const specF = (x, w) => SPEC_LO * Math.pow(SPEC_HI / SPEC_LO, clamp(x / w, 0, 1));
// a canvas sized to how it shows, for sharp lines
function fitCanvas(c) {
  const r = devicePixelRatio || 1, w = Math.round(c.clientWidth * r), hh = Math.round(c.clientHeight * r);
  if (w && (c.width !== w || c.height !== hh)) { c.width = w; c.height = hh; }
  return r;
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function drawSpectrum(c) {
  const r = fitCanvas(c), W = c.width, H = c.height, g = c.getContext('2d'), A = tempo.analyser;
  g.clearRect(0, 0, W, H);
  g.fillStyle = cssVar('--bg2'); g.fillRect(0, 0, W, H);
  const [lo, hi] = tempoBandNow(), x0 = specX(lo, W), x1 = specX(hi, W), acc = cssVar('--accent');
  // the band, under the bars
  g.fillStyle = acc; g.globalAlpha = 0.16; g.fillRect(x0, 0, x1 - x0, H); g.globalAlpha = 1;
  // the bars: 56 bands, each its loudest bin, -95 to -25 dB
  if (A) {
    const bins = A._buf || (A._buf = new Float32Array(A.frequencyBinCount)), hz = tempo.ctx.sampleRate / A.fftSize, n = 56, bw = W / n;
    A.getFloatFrequencyData(bins);
    const fad = cssVar('--fader'), mut = cssVar('--line3');
    for (let i = 0; i < n; i++) {
      const fa = specF(i * bw, W), fb = specF((i + 1) * bw, W);
      let v = -140;
      for (let k = Math.floor(fa / hz); k <= Math.ceil(fb / hz) && k < bins.length; k++) v = Math.max(v, bins[k]);
      const y = clamp((v + 95) / 70, 0, 1) * (H - 2 * r), mid = (fa + fb) / 2;
      g.fillStyle = mid >= lo && mid <= hi ? fad : mut;
      g.fillRect(i * bw + r, H - y, bw - 2 * r, y);
    }
  }
  // the band's edges, and what it is
  g.fillStyle = acc; g.fillRect(x0 - r, 0, 2 * r, H); g.fillRect(x1 - r, 0, 2 * r, H);
  g.font = `${9 * r}px ${FONT_MONO || 'monospace'}`; g.textBaseline = 'top'; g.fillStyle = cssVar('--text2');
  const label = `${lo}–${hi} Hz`, tw = g.measureText(label).width;
  g.fillText(label, clamp(x0 + 4 * r, 3 * r, W - tw - 3 * r), 3 * r);
}
// The last 4 s of the band's hits (as the tracker hears them), and the beats the clock counts: a tick on each, red on
// the bar's 1; dimmed while it holds
function drawTrace(c, now) {
  const r = fitCanvas(c), W = c.width, H = c.height, g = c.getContext('2d'), T = tempo.tracker;
  g.clearRect(0, 0, W, H);
  g.fillStyle = cssVar('--bg2'); g.fillRect(0, 0, W, H);
  if (!T || !T.x.length || !tempo.envT.length) return;
  const span = 4000, endT = tempoPerfTime(tempo.envT[tempo.envT.length - 1]), n = Math.min(T.x.length, Math.round(T.rate * 4));
  const xs = T.x.slice(T.x.length - n), top = Math.max(1e-6, ...xs), xOf = t => W - (endT - t) / span * W;
  // the beats, as the lights follow them
  const P = 60000 / tempo.bpm, per = tempoBpb(), first = Math.ceil((endT - span - tempo.anchor) / P);
  const live = ui.tempoSrc !== 'tap' && !tempo.holding;
  for (let k = first; tempo.anchor + k * P <= endT; k++) {
    const x = xOf(tempo.anchor + k * P), one = ((k % per) + per) % per === 0;
    g.fillStyle = one ? cssVar('--accent') : cssVar('--text2');
    g.globalAlpha = live ? 1 : 0.35;
    g.fillRect(x - r / 2, 0, r, H);
  }
  g.globalAlpha = 1;
  // the hits
  g.strokeStyle = cssVar('--fader'); g.lineWidth = 1.2 * r; g.beginPath();
  xs.forEach((v, i) => { const x = W - (n - 1 - i) / (T.rate * 4) * W, y = H - 2 * r - v / top * (H - 4 * r); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
}
// Dragging on the spectrum: an edge near the pointer moves that edge, inside the band moves the band; double-click
// gives the kick drum's 40 to 150 Hz back
function bandDrag(c) {
  c.addEventListener('pointermove', e => {
    if (c._drag) return;
    const W = c.clientWidth, [lo, hi] = tempoBandNow(), x = e.offsetX;
    c.style.cursor = Math.abs(x - specX(lo, W)) < 7 || Math.abs(x - specX(hi, W)) < 7 ? 'ew-resize' : x > specX(lo, W) && x < specX(hi, W) ? 'grab' : 'default';
  });
  c.addEventListener('pointerdown', e => {
    const W = c.clientWidth, [lo, hi] = tempoBandNow(), x = e.offsetX, xl = specX(lo, W), xh = specX(hi, W);
    const what = Math.abs(x - xl) < 7 ? 'lo' : Math.abs(x - xh) < 7 ? 'hi' : x > xl && x < xh ? 'band' : null;
    if (!what) return;
    e.preventDefault(); c.setPointerCapture(e.pointerId);
    c._drag = { what, x, lo, hi };
  });
  c.addEventListener('pointermove', e => {
    const d = c._drag; if (!d) return;
    const W = c.clientWidth;
    if (d.what === 'lo') tempoBand(clamp(specF(e.offsetX, W), 20, d.hi / 1.25), d.hi);
    else if (d.what === 'hi') tempoBand(d.lo, clamp(specF(e.offsetX, W), d.lo * 1.25, 16000));
    else {
      // the band keeps its width (in octaves) as it moves
      const k = specF(specX(d.lo, W) + e.offsetX - d.x, W) / d.lo, lo = clamp(d.lo * k, 20, 16000 / (d.hi / d.lo));
      tempoBand(lo, lo * d.hi / d.lo);
    }
  });
  const end = () => { if (c._drag) { c._drag = null; savePrefs(); } };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('dblclick', () => tempoBand(TEMPO_BAND[0], TEMPO_BAND[1], true));
}

/* ---------- the beat in the top bar ---------- */
// A small white dot by the master, lighting on each beat while there is one; a click opens Tempo in Settings
let beatDotEl = null;
function beatDotFrame(now) {
  const d = beatDotEl && beatDotEl.isConnected ? beatDotEl : (beatDotEl = $('#beatDot'));
  if (!d) return;
  const on = tempoActive();
  if (d.hidden === on) d.hidden = !on;
  if (!on) return;
  const o = (0.15 + 0.85 * tempoGlow(tempoAt(now))).toFixed(2);
  if (d.style.opacity !== o) d.style.opacity = o;   // still between beats: nothing to restyle
}
function showTempoSettings() {
  showRight(true); ui.rightTab = 'settings'; renderRight();
  requestAnimationFrame(() => { const s = $('#tempoSec'); if (s) s.scrollIntoView({ block: 'start' }); });
}


/* ---------- effects that follow the music ---------- */
// Above an effect's controls: where its beat comes from, and a way to Tempo when there is none yet (sound: it also
// needs listening, for the levels)
function tempoNote(sound) {
  const go = h('button', { class: 'btn sm', type: 'button', onclick: showTempoSettings }, 'Tempo…');
  const ok = tempoActive() && (!sound || tempo.on);
  const txt = ok ? `Follows the beat${sound ? ' and the sound' : ''} (${tempo.bpm.toFixed(1)} BPM).`
    : sound ? 'Follows the sound: turn on listening in Settings → Tempo.' : 'Follows the beat: tap it, or let nouPix listen, in Settings → Tempo.';
  return h('div', { class: 'tnote' + (ok ? '' : ' warn'), 'data-sound': sound ? '1' : '0' }, h('span', null, txt), go);
}

/* ---------- Fixture chase, in the Content tab ---------- */
// What it chases (groups or single fixtures, each ticked or left out, in the fixture list's order), how long each step
// lasts, the order, one at a time or adding up, the fade and the colour; all the layer's (scenes keep them)
function chaseSection(L, src) {
  const p = chaseParams(L, src), z = selZone();
  // a setting changed: kept on the layer, a step of undo, and the panel drawn again (wr: while dragging, kept only)
  const wr = (k, v) => { (L.params[src.id] = Object.assign({}, L.params[src.id] || {}))[k] = v; };
  const put = (k, v, redraw = true) => { wr(k, v); commit(); if (redraw) renderRight(); };
  const all = chaseSteps(Object.assign({}, p, { skip: [] }), z);
  const name = s => (p.by === 'groups' && project.groups.length ? groupName(groupById(s.id)) : s.fx[0].name);
  const list = h('div', { class: 'chlist', 'data-keep': 'chase' }, all.length ? all.map((s, i) => {
    const on = !p.skip.includes(s.id);
    const box = h('input', { type: 'checkbox', checked: on, onchange: e => put('skip', e.target.checked ? p.skip.filter(x => x !== s.id) : p.skip.concat(s.id)) });
    return h('label', { class: 'checkrow chstep' + (on ? '' : ' off') }, box, h('span', { class: 'mono ix' }, String(i + 1)), h('span', { class: 'nm' }, name(s)));
  }) : h('p', { class: 'note' }, p.by === 'groups' ? 'No groups in this zone yet: group fixtures (G), or chase single fixtures.' : 'No fixtures in this zone yet.'));
  const cr = colorRow('Color', () => chaseParams(L, src).color, c => wr('color', c), () => commit(), `${L.id}:${src.id}:color`);
  const kids = [tempoNote(false),
    tipRow(row('Steps', seg([['groups', 'Groups'], ['fixtures', 'Fixtures']], p.by, v => { const q = (L.params[src.id] = Object.assign({}, L.params[src.id] || {})); q.by = v; q.skip = []; commit(); renderRight(); })),
      'What lights in turn: each group, or each fixture, in the fixture list’s order. Untick one to leave it out.'),
    list,
    row('Every', seg([[0.25, '¼'], [0.5, '½'], [1, '1'], [2, '2'], [4, '4']], p.every, v => put('every', +v))),
    row('Order', selectEl([['forward', 'Forward'], ['back', 'Backward'], ['pingpong', 'Ping-pong'], ['random', 'Random']], p.order, v => put('order', v), { aria: 'Chase order' })),
    tipRow(row('Mode', seg([['one', 'One'], ['fill', 'Fill']], p.mode, v => put('mode', v))), 'One: a step at a time. Fill: the steps add up until the round starts again.'),
    tipRow(sliderRow('Fade', { get v() { return chaseParams(L, src).fade; }, set v(x) { wr('fade', x); } }, 'v', { min: 0, max: 1, step: 0.01, fmt: pct, onCommit: () => commit() }),
      '0: each step stays lit until the next. More: it fades out over its step.'),
    cr,
    h('p', { class: 'note' }, 'As a mask: put it above other content with Blend: Multiply, so that content shows only on the lit fixtures.')];
  return sec('Chase', kids);
}
