// nouPix · js/ui-tempo.js
// Tempo in Settings: the BPM with a dot on every beat and the beats of the bar counting, where the beat comes from
// (listening to a sound card, or tapping), the input and its trim with a level meter, 4/4 or 2/4, Tap and Downbeat.
// What moves is drawn once a frame (tempoFrame, from the frame loop), the rest when something changes (updateTempoUI).

let tempoSecEl = null, tempoLive = null;
// The nouPix mark without its square: the LED's circle, its diode and its two arrows, all in one colour
const TEMPO_MARK = '<svg viewBox="0 0 64 64" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="miter">'
  + '<circle cx="32" cy="32" r="25"/><path d="M2,32 H21 M39,32 H62 M21,21 L39,32 L21,43 Z M39,21 V43"/>'
  + '<path d="M28.32,21.15 L30.83,16.44 M33.72,24.45 L36.23,19.74"/>'
  + '<path d="M33.25,11.88 L32.88,17.53 L28.78,15.35 Z M38.65,15.18 L38.28,20.83 L34.18,18.65 Z" fill="currentColor" stroke="none"/></svg>';
function tempoSection() {
  const src = ui.tempoSrc === 'tap' ? 'tap' : 'audio', listening = tempo.on || tempo.starting, per = tempoBpb();
  // the readout: the nouPix mark lighting on each beat, the BPM, the beats of the bar
  const dot = h('span', { class: 'tmark', html: TEMPO_MARK, 'aria-hidden': 'true' }), num = h('span', { class: 'tbpm' }, tempo.bpm.toFixed(1)), bars = h('span', { class: 'tbar' }, Array.from({ length: per }, () => h('i'))),
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
        listening ? h('div', { class: 'tsig' }, spec, trace) : null);
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
  if (!tempoSecEl || !tempoSecEl.isConnected) return;
  const old = tempoSecEl;
  old.replaceWith(tempoSection());
  markMidi();
}
// Once a frame while Settings shows it: the mark lights from red to white on each beat and fades back (fully on the
// downbeat, a little less on the others), the bar's lines, the BPM, the meter
function tempoFrame(now, force) {
  const L = tempoLive;
  if (!L || !tempoSecEl || !tempoSecEl.isConnected) return;
  const at = tempoAt(now), sure = ui.tempoSrc === 'tap' ? tempo.taps.length > 1 || !!ui.tempoBpm : tempo.locked;
  const k = sure ? Math.pow(Math.max(0, 1 - at.phase / 0.45), 2) * (at.inBar === 0 ? 1 : 0.75) : 0;
  L.dot.style.color = sure ? `color-mix(in srgb, var(--live) ${Math.round(k * 100)}%, var(--accent))` : '';
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

