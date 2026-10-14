// openLedMapper · docs/mockups/midi-main.js
// The main window of the mockup: the app's top bar with the new MIDI button next to remote control; a stage that
// draws three zones as the app would, with the macros and MIDI applied as the frame is drawn; the Scenes dock; and
// the Content tab. A slider a MIDI control drives has a yellow mark, and a thin yellow line where the MIDI fader is,
// so pickup can be seen. While learning, touching a slider picks it. The control engine runs here, as planned for
// the app; the MIDI button opens the mapping window (a window of its own, or a floating one in the page).

const eng = new Engine();
serveEngine(eng);
startWebMidi(eng);
let S = eng.snapshot();
const view = { zone: 'z2', layer: null };
const marks = [];   // the sliders with a MIDI mark (mappedSlider), brought up to date with each state

/* ---------- the mapping window ---------- */
let popup = null, floatWin = null;
const mapOpen = () => (popup && !popup.closed) || (floatWin && floatWin.isConnected);
function openMapping() {
  $('.newtip')?.remove();
  if (popup && !popup.closed) { popup.focus(); return; }
  if (floatWin && floatWin.isConnected) { floatWin.classList.remove('min'); return; }
  try { popup = window.open('midi-window.html', 'olm-midi', 'popup,width=1240,height=820'); } catch (e) { popup = null; }
  if (!popup) openFloating();
  syncTop();
}
// A window inside the page, where the browser (or the viewer) refuses a new one: drag it by its bar, resize it from
// its corner, minimise it to its bar
function openFloating() {
  const w = Math.min(1180, innerWidth - 40), ht = Math.min(780, innerHeight - 70);
  const frame = h('iframe', { src: 'midi-window.html', title: 'MIDI mapping' });
  const bar = h('div', { class: 'fbar' }, 'MIDI', h('span', { class: 'muted' }, 'drag it aside to watch this window'), h('span', { class: 'fill' }),
    h('button', { class: 'btn ghost sm', type: 'button', title: 'Minimise', 'aria-label': 'Minimise', onclick: () => floatWin.classList.toggle('min') }, '—'),
    h('button', { class: 'btn ghost sm', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: () => { floatWin.remove(); syncTop(); } }, icon('x')));
  floatWin = h('div', { class: 'fwin', style: { left: Math.max(10, innerWidth - w - 20) + 'px', top: '58px', width: w + 'px', height: ht + 'px' } }, bar, frame);
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = floatWin.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    bar.setPointerCapture(e.pointerId); frame.style.pointerEvents = 'none';
    bar.onpointermove = ev => { floatWin.style.left = clamp(ev.clientX - dx, 40 - r.width, innerWidth - 60) + 'px'; floatWin.style.top = clamp(ev.clientY - dy, 0, innerHeight - 34) + 'px'; };
    bar.onpointerup = () => { bar.onpointermove = null; frame.style.pointerEvents = ''; };
  });
  document.body.append(floatWin);
}

/* ---------- sliders MIDI can drive ---------- */
// A slider for target t. While learning, touching it picks it as what the next MIDI control moves.
function midiSlider(t, attrs, onInput) {
  const r = h('input', Object.assign({ type: 'range' }, attrs, { oninput: e => onInput(+e.target.value) }));
  r.addEventListener('pointerdown', e => { if (S.learn.on) { e.preventDefault(); eng.learnTarget(t); } });
  const s = mappedSlider(r, t);
  s.input = r;
  marks.push(s);
  return s;
}

/* ---------- top bar ---------- */
function blinkMidi() { const l = $('#midiLed'); l.classList.add('on'); clearTimeout(l._t); l._t = setTimeout(() => l.classList.remove('on'), 90); }
let masterS;
function syncTop() {
  const b = $('#btnMidi');
  b.classList.toggle('on', !!mapOpen()); b.classList.toggle('learning', S.learn.on); b.setAttribute('aria-pressed', String(!!mapOpen()));
  if (document.activeElement !== masterS.input) masterS.input.value = S.master;
  $('#masterVal').textContent = pct(S.master);
  $('#btnBlackout').classList.toggle('on', !!S.blackout);
  document.body.classList.toggle('learning-main', S.learn.on);
  const wm = { checking: 'checking…', none: 'not in this browser', blocked: 'refused', empty: 'no ports', ok: 'on' }[S.devices.webmidi];
  $('#status').replaceChildren(h('span', null, S.learn.on ? 'Learning: move a MIDI control, then touch a slider (or the other way round)' : 'Mockup of the MIDI mapping: nothing here changes the app'), h('span', { class: 'fill' }),
    h('span', null, 'Wires ', h('b', null, S.wires.length)), h('span', null, 'Web MIDI ', h('b', null, wm)));
}
function initTop() {
  $('#appVer').textContent = 'mockup';
  $('#projName').value = 'Bar & stage, MIDI mockup';
  $('#bridgePill').classList.add('ok'); $('#bridgeText').textContent = 'Art-Net bridge';
  $('#btnHl').append(icon('bulb'), h('span', null, 'Highlight'));
  $('#btnMidi').addEventListener('click', openMapping);
  $('#btnRemote').addEventListener('click', () => toast('Remote control is as it is now; the MIDI button is the new one beside it.'));
  for (const id of ['btnFile', 'btnUndo', 'btnRedo', 'btnHl', 'btnHlMode', 'btnOutput']) $('#' + id).addEventListener('click', () => toast('Not part of this mockup.'));
  masterS = midiSlider('master', { min: 0, max: 1, step: 0.01, id: 'master', 'aria-label': 'Master' }, v => eng.set('master', v));
  $('#master').replaceWith(masterS);
  $('#btnBlackout').addEventListener('click', () => { if (S.learn.on) eng.learnTarget('blackout'); else eng.set('blackout', S.blackout ? 0 : 1); });
  const r = $('#btnMidi').getBoundingClientRect(), left = clamp(r.left - 20, 8, innerWidth - 270);
  const tip = h('div', { class: 'newtip', role: 'note', style: { left: left + 'px', top: r.bottom + 10 + 'px', '--arrow': clamp(r.left - left + 8, 10, 240) + 'px' } },
    h('b', null, 'New: MIDI. '), 'It opens the mapping in a window of its own: move it aside to watch this one while you map.',
    h('div', null, h('button', { class: 'btn sm primary', type: 'button', onclick: openMapping }, 'Open it'), ' ', h('button', { class: 'btn sm', type: 'button', onclick: () => tip.remove() }, 'Got it')));
  document.body.append(tip);
}

/* ---------- the stage ---------- */
// Each zone drawn from its layers: every effect control as the frame uses it (its own value, a MIDI wire straight
// to it, then its macros). The layers' own values never change.
const FAMILY = { aurora: 'grad', waves: 'grad', gradient: 'grad', clouds: 'grad', water: 'grad', noise: 'grad', horizon: 'grad', lava: 'blobs', breathe: 'breathe', wipe: 'grad', checker: 'checker',
  shape: 'grad', bars: 'bars', rain: 'bars', scanner: 'bars', comet: 'bars', sweep: 'bars', equalizer: 'bars', pulse: 'rings', spiral: 'rings', tunnel: 'rings', rainbow: 'hue', plasma: 'hue',
  drift: 'hue', fire: 'hue', stars: 'dots', twinkle: 'dots', confetti: 'dots', mirrorball: 'dots', discodots: 'beat', hits: 'beat', strobe: 'strobe', solid: 'solid' };
const phases = new Map();
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
function layerLook(L) {
  const ps = eng.params(L.src), P = { sat: 1, num: {}, level: L.opacity };
  let A = null, B = null, rate = null, unit = 1;
  for (const p of ps) {
    const v = eng.value(p, L.params[p.name]);
    if (p.type === 'level') { P.level *= v; continue; }
    if (p.type === 'color') { if (p.role === 'color2') B = B || v; else if (!A) A = v; else B = B || v; continue; }
    P.num[p.name] = (v - p.min) / ((p.max - p.min) || 1);
    if (p.role === 'speed' && rate == null) { rate = Math.abs(v); unit = /bpm|tempo/i.test(p.name) || /min/i.test(p.label) ? 1 / 60 : 1; }
    if (p.role === 'saturation') P.sat = v;
  }
  P.A = A || [1, 1, 1]; P.B = B || [0, 0, 0]; P.rate = (rate ?? 0.3) * unit;
  return P;
}
function pattern(fam, x, y, ph, P, seed) {
  const { A, B } = P, s = P.sat, n = (k, d) => P.num[k] ?? d;
  const hueRGB = hh => mix([1, 1, 1], hsvRgb(((hh % 1) + 1) % 1 * 360, 1, 1), s);
  switch (fam) {
    case 'grad': return mix(A, B, 0.5 + 0.5 * Math.sin((x * (0.6 + 3 * n('scale', 0.3)) - ph * 0.5) * 2 * Math.PI + 1.5 * Math.sin(y * 3 + ph)));
    case 'blobs': { const d = Math.hypot(x - 0.5 - 0.3 * Math.sin(ph * 1.3), y - 0.5 - 0.3 * Math.cos(ph)); return mix(B, A, clamp(1.4 - d * 4, 0, 1)); }
    case 'breathe': return mix(B, A, 0.5 + 0.5 * Math.sin(ph * 2 * Math.PI));
    case 'checker': return ((Math.floor(x * 8 + ph) + Math.floor(y * 4)) & 1) ? A : B;
    case 'bars': { const f = ((x * (1 + 9 * n('count', 0.3)) - ph) % 1 + 1) % 1; return f < 0.1 + 0.8 * n('width', 0.4) ? A : B; }
    case 'rings': { const f = ((Math.hypot(x - 0.5, (y - 0.5) * 0.6) * 6 - ph) % 1 + 1) % 1; return mix(A, B, f); }
    case 'hue': return hueRGB(x * 0.8 + ph * 0.25);
    case 'dots': { const tw = 0.5 + 0.5 * Math.sin(ph * 4 + hash(x * 50, y * 50 + seed) * 20); return mix(B, A, tw > 0.9 ? (tw - 0.9) * 10 : 0); }
    case 'beat': { const b = ((ph % 1) + 1) % 1, cell = hash(Math.floor(x * 10), Math.floor(y * 4) + Math.floor(ph) + seed); return cell > 0.4 ? hueRGB(cell * 3).map(v => v * Math.max(0.15, 1 - b * 1.1)) : [0, 0, 0]; }
    case 'strobe': return ((ph % 1) + 1) % 1 < 0.12 ? A : [0, 0, 0];
    default: return A;
  }
}
let lastT = performance.now();
function drawStage(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const cv = $('#view'), box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(box.width * dpr) || cv.height !== Math.round(box.height * dpr)) { cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr); }
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#06070a'; g.fillRect(0, 0, W, H);
  const pad = 22 * dpr, gap = 18 * dpr, zw = (W - pad * 2 - gap * 2) / 3, zh = Math.min(H - pad * 2 - 20 * dpr, zw * 0.62), top = (H - zh) / 2 + 6 * dpr;
  const master = eng.blackout ? 0 : eng.master;
  eng.zones.forEach((z, zi) => {
    const x0 = pad + zi * (zw + gap), cols = 30, rows = Math.max(6, Math.round(cols * zh / zw)), cw = zw / cols, chh = zh / rows;
    const looks = z.layers.map(L => { const P = layerLook(L), ph = (phases.get(L.id) || 0) + dt * P.rate; phases.set(L.id, ph); return { P, ph, fam: FAMILY[L.src] || 'grad', seed: zi * 7 }; });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols, y = (r + 0.5) / rows;
      let rgb = [0, 0, 0];
      for (const lk of looks) { const p = pattern(lk.fam, x, y, lk.ph, lk.P, lk.seed), a = lk.P.level; rgb = [rgb[0] + p[0] * a, rgb[1] + p[1] * a, rgb[2] + p[2] * a]; }
      g.fillStyle = cssRgb(rgb.map(v => Math.min(1, v) * z.opacity * master));
      g.beginPath(); g.arc(x0 + (c + 0.5) * cw, top + (r + 0.5) * chh, Math.min(cw, chh) * 0.34, 0, Math.PI * 2); g.fill();
    }
    g.setLineDash([5 * dpr, 4 * dpr]); g.strokeStyle = z.tag; g.lineWidth = dpr; g.strokeRect(x0 - 4 * dpr, top - 4 * dpr, zw + 8 * dpr, zh + 8 * dpr); g.setLineDash([]);
    g.fillStyle = z.tag; g.font = `600 ${11 * dpr}px Barlow, sans-serif`;
    g.fillText(`${z.name} · ${z.scenes[z.scene].name}`, x0 - 4 * dpr, top - 10 * dpr);
  });
  $('#stageNote').textContent = `Speed ${fmtX(eng.macros.speed.v)} · intensity ${pct(eng.macros.intensity.v)} · Color 1 ${eng.macros.color1.on ? 'on' : 'off'} · Color 2 ${eng.macros.color2.on ? 'on' : 'off'}`;
  requestAnimationFrame(drawStage);
}

/* ---------- the Scenes dock ---------- */
let dockSig = '';
function renderDock() {
  const sig = JSON.stringify([view.zone, S.zones.map(z => z.scene)]);
  if (sig !== dockSig) {
    dockSig = sig;
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].dock) marks.splice(i, 1);
    const rows = h('div', { class: 'zonerows' });
    for (const z of S.zones) {
      const lvl = midiSlider('z:' + z.id, { min: 0, max: 1, step: 0.01, value: z.opacity, 'aria-label': z.name + ' level', onclick: e => e.stopPropagation() }, v => eng.set('z:' + z.id, v));
      lvl.dock = z.id;
      const head = h('div', { class: 'zhead' + (z.id === view.zone ? ' sel' : ''), onclick: () => { view.zone = z.id; view.layer = null; renderDock(); renderRight(true); } },
        h('div', { class: 'zt' }, h('span', { class: 'ztag', style: { borderColor: z.tag } }), h('span', { class: 'nm' }, z.name), h('span', { class: 'mono muted', 'data-zone-pct': z.id }, pct(z.opacity))),
        h('div', { class: 'zc' }, lvl));
      const r = h('div', { class: 'scenerow' + (z.id === view.zone ? ' sel' : '') }, head);
      z.scenes.forEach((name, i) => r.append(h('div', { class: 'scene' + (z.scene === i ? ' live' : ''), role: 'button', tabindex: 0, style: { '--tag': z.tag }, onclick: () => eng.recall(z.id, i) },
        h('div', { class: 't' }, h('span', { class: 'nm' }, name), h('span', { class: 'k' }, String(i + 1))), h('div', { class: 's' }, h('span', { class: 'fill' }), '◢ 2 s'))));
      rows.append(h('div', { class: 'zoneblock' + (z.id === view.zone ? ' sel' : '') }, r));
    }
    $('#dockBody').replaceChildren(h('div', { class: 'scenepanel' }, h('div', { class: 'bar' }, h('span', null, 'Click a scene to play it. MIDI wires and macros carry on through every scene: they apply as the frame is drawn.')), rows));
  }
  for (const z of S.zones) { const p = $(`[data-zone-pct="${z.id}"]`); if (p) p.textContent = pct(z.opacity); }
}

/* ---------- the Content tab ---------- */
let rightSig = '';
function renderRight(force = false) {
  const z = eng.zone(view.zone);
  if (!view.layer || !z.layers.some(L => L.id === view.layer)) view.layer = z.layers[0] && z.layers[0].id;
  const L = z.layers.find(x => x.id === view.layer);
  const sig = JSON.stringify([view, z.layers.map(x => x.id)]);
  if (sig === rightSig && !force) return;
  rightSig = sig;
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i].param) marks.splice(i, 1);
  const list = h('ul', { class: 'list layerlist' }, z.layers.map((X, i) => h('li', { class: X.id === view.layer ? 'sel' : '', onclick: () => { view.layer = X.id; renderRight(true); } },
    h('span', { class: 'mono muted' }, String(z.layers.length - i)), h('span', { class: 'nm' }, SHADERS.get(X.src).name), h('span', { class: 'mono muted' }, pct(X.opacity)))));
  const rows = [];
  if (L) for (const p of eng.params(L.src)) {
    if (p.type === 'level') continue;
    const val = h('span', { class: 'val' });
    let ctl;
    if (p.type === 'color') ctl = h('i', { class: 'csw' });
    else {
      // a control a MIDI wire goes to straight is set over the layers' own value; any other moves this layer's own
      const step = (p.max - p.min) / 200;
      ctl = midiSlider(p.key, { min: p.min, max: p.max, step, 'aria-label': p.label }, v => {
        if (eng.wires.some(w => w.to === p.key) || p.key in eng.direct) eng.set(p.key, v); else eng.setOwn(z.id, L.id, p.name, v);
      });
      ctl.param = p.key;
    }
    const via = h('div', { class: 'via' });
    const row = h('div', { class: 'prow', 'data-param': p.key }, h('span', { class: 'lbl', title: p.label }, p.label), ctl, val, via);
    row.sync = () => {
      const own = L.params[p.name], wired = eng.wires.some(w => w.to === p.key) || p.key in eng.direct;
      const shown = wired ? eng.get(p.key) : own ?? p.def, eff = eng.value(p, own), ms = eng.macrosOf(p).filter(id => eng.macros[id].on);
      if (p.type === 'color') { ctl.style.background = cssRgb(eff); val.textContent = ''; }
      else { if (document.activeElement !== ctl.input) ctl.input.value = shown; val.textContent = fmtV(Math.round(eff * 100) / 100); }
      via.textContent = ms.length ? 'Follows ' + ms.map(id => macroDef(id).label).join(', ') : '';
      via.hidden = !ms.length;
    };
    rows.push(row);
  }
  $('#rightBody').replaceChildren(
    h('div', { class: 'sec' }, h('h3', null, 'Layers · ', h('span', { style: { color: z.tag } }, z.name), h('span', { class: 'fill' }), h('span', { class: 'mono' }, z.scenes[z.scene].name)), list),
    h('div', { class: 'sec' }, h('h3', null, 'Parameters · ', L ? SHADERS.get(L.src).name : ''), ...rows,
      h('p', { class: 'note' }, 'A yellow slider is driven by a MIDI control: the thin line is where its fader is. With pickup, the slider follows once the fader reaches it. On the right, the value the effect gets.')));
  syncRight();
}
const syncRight = () => { for (const r of $$('#rightBody .prow')) r.sync(); };

/* ---------- start ---------- */
function refresh() { renderDock(); renderRight(); syncTop(); syncRight(); for (const m of marks) if (m.isConnected) { m.mark(S); if (m.dock && document.activeElement !== m.input) m.input.value = S.zones.find(z => z.id === m.dock).opacity; } }
eng.on(ev => {
  if (ev.t === 'state') { S = ev.s; refresh(); }
  else if (ev.t === 'led') blinkMidi();
  else if (ev.t === 'toast' && !mapOpen()) toast(ev.text);
});
addEventListener('message', ev => { if (ev.data && ev.data.olm === 'midi-bye') setTimeout(syncTop, 50); });
setInterval(() => { if (popup && popup.closed) { popup = null; syncTop(); } }, 800);
addEventListener('keydown', e => { if (e.key === 'Escape' && S.learn.on) eng.setLearn(false); });
initTop();
refresh();
requestAnimationFrame(drawStage);
