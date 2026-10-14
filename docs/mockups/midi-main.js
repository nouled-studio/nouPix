// openLedMapper · docs/mockups/midi-main.js
// The main window of the mockup. The app's top bar, with the new MIDI and OSC button next to remote control; a stage
// that draws three zones from the macros, applied as the frame is drawn (the layers' own values never change); the
// Scenes dock; and the Content tab, where each parameter shows its link to a macro. The control engine runs here, as
// planned for the app. The button opens the mapping window: a window of its own where the browser allows one, or
// a floating one inside the page, which can be moved aside or minimised.

const eng = new Engine();
serveEngine(eng);
startWebMidi(eng);
let S = eng.snapshot();
const view = { zone: 'z2', layer: null };

/* ---------- the mapping window ---------- */
let popup = null, floatWin = null;
const mapOpen = () => (popup && !popup.closed) || (floatWin && floatWin.isConnected);
function openMapping() {
  $('.newtip')?.remove();
  if (popup && !popup.closed) { popup.focus(); return; }
  if (floatWin && floatWin.isConnected) { floatWin.classList.remove('min'); return; }
  try { popup = window.open('midi-window.html', 'olm-midi', 'popup,width=1220,height=820'); } catch (e) { popup = null; }
  if (!popup) openFloating();
  syncTop();
}
// A window inside the page, for browsers (and viewers) that refuse a new one: drag it by its bar, resize it from
// its corner, minimise it to the bar
function openFloating() {
  const w = Math.min(1180, innerWidth - 40), ht = Math.min(800, innerHeight - 70);
  const frame = h('iframe', { src: 'midi-window.html', title: 'MIDI and OSC mapping' });
  const bar = h('div', { class: 'fbar' }, 'MIDI & OSC', h('span', { class: 'muted' }, 'drag me aside to watch the stage'), h('span', { class: 'fill' }),
    h('button', { class: 'btn ghost sm', type: 'button', title: 'Minimise', 'aria-label': 'Minimise', onclick: () => floatWin.classList.toggle('min') }, '—'),
    h('button', { class: 'btn ghost sm', type: 'button', title: 'Open as a window of its own', onclick: () => { const p = window.open('midi-window.html', 'olm-midi', 'popup,width=1220,height=820'); if (p) { popup = p; floatWin.remove(); syncTop(); } else toast('This browser keeps it inside the page.'); } }, '↗'),
    h('button', { class: 'btn ghost sm', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: () => { floatWin.remove(); syncTop(); } }, icon('x')));
  floatWin = h('div', { class: 'fwin', style: { left: Math.max(10, innerWidth - w - 20) + 'px', top: '58px', width: w + 'px', height: ht + 'px' } }, bar, frame);
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = floatWin.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    bar.setPointerCapture(e.pointerId);
    frame.style.pointerEvents = 'none';
    bar.onpointermove = ev => { floatWin.style.left = clamp(ev.clientX - dx, 40 - r.width, innerWidth - 60) + 'px'; floatWin.style.top = clamp(ev.clientY - dy, 0, innerHeight - 34) + 'px'; };
    bar.onpointerup = () => { bar.onpointermove = null; frame.style.pointerEvents = ''; };
  });
  document.body.append(floatWin);
}

/* ---------- top bar ---------- */
function blinkMidi() {
  const l = $('#midiLed');
  l.classList.add('on'); clearTimeout(l._t); l._t = setTimeout(() => l.classList.remove('on'), 90);
}
function syncTop() {
  const b = $('#btnMidi');
  b.classList.toggle('on', !!mapOpen());
  b.classList.toggle('learning', S.learn.on || !!S.learn.target);
  b.setAttribute('aria-pressed', String(!!mapOpen()));
  const m = $('#master');
  if (document.activeElement !== m) m.value = S.master;
  $('#masterVal').textContent = pct(S.master);
  $('#btnBlackout').classList.toggle('on', !!S.blackout);
  const n = S.bindings.length, wm = { checking: 'checking…', none: 'not in this browser', blocked: 'refused', empty: 'no ports', ok: 'on' }[S.devices.webmidi];
  $('#status').replaceChildren(h('span', null, 'Mockup of the MIDI and OSC mapping: nothing here changes the app'), h('span', { class: 'fill' }),
    h('span', null, 'Bindings ', h('b', null, n)), h('span', null, 'Web MIDI ', h('b', null, wm)), h('span', null, 'Speed ', h('b', null, fmtX(S.macros.speed))));
}
function initTop() {
  $('#appVer').textContent = 'mockup';
  $('#projName').value = 'Bar & stage, MIDI mockup';
  $('#bridgePill').classList.add('ok'); $('#bridgeText').textContent = 'Art-Net bridge';
  $('#btnHl').append(icon('bulb'), h('span', null, 'Highlight'));
  $('#btnMidi').addEventListener('click', openMapping);
  $('#btnRemote').addEventListener('click', () => toast('Remote control is as it is now; the MIDI and OSC button is the new one beside it.'));
  for (const id of ['btnFile', 'btnUndo', 'btnRedo', 'btnHl', 'btnHlMode', 'btnOutput']) $('#' + id).addEventListener('click', () => toast('Not part of this mockup.'));
  $('#master').addEventListener('input', e => eng.set('master', +e.target.value));
  $('#btnBlackout').addEventListener('click', () => eng.set('blackout', S.blackout ? 0 : 1));
  // the new button, pointed out once
  const r = $('#btnMidi').getBoundingClientRect();
  const tip = h('div', { class: 'newtip', role: 'note', style: { left: clamp(r.left - 20, 8, innerWidth - 260) + 'px', top: r.bottom + 10 + 'px', '--arrow': clamp(r.left - clamp(r.left - 20, 8, innerWidth - 260) + 8, 10, 230) + 'px' } },
    h('b', null, 'New: MIDI and OSC. '), 'It opens the mapping in a window of its own: move it aside to watch this one while you map.',
    h('div', null, h('button', { class: 'btn sm primary', type: 'button', onclick: openMapping }, 'Open it'), ' ', h('button', { class: 'btn sm', type: 'button', onclick: () => tip.remove() }, 'Got it')));
  document.body.append(tip);
}

/* ---------- the stage ---------- */
// What each zone looks like, drawn from its layers as the app would draw them: each layer's own values, with the
// macros applied on top as the frame is drawn. A recalled scene brings new layers; the macros apply to them at once.
const FAMILY = { aurora: 'grad', waves: 'grad', gradient: 'grad', clouds: 'grad', water: 'grad', noise: 'grad', horizon: 'grad', lava: 'blobs', breathe: 'breathe',
  wipe: 'grad', checker: 'checker', shape: 'grad', bars: 'bars', rain: 'bars', scanner: 'bars', comet: 'bars', sweep: 'bars', equalizer: 'bars', pulse: 'rings', spiral: 'rings',
  tunnel: 'rings', rainbow: 'hue', plasma: 'hue', drift: 'hue', fire: 'hue', stars: 'dots', twinkle: 'dots', confetti: 'dots', mirrorball: 'dots', discodots: 'beat', hits: 'beat',
  strobe: 'strobe', solid: 'solid' };
const phases = new Map();
const shown = { color1: null, color2: null };   // the override colours as shown, slewing towards the set ones
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
// A layer's values as the frame uses them: its own, or the macro where it follows one
function layerLook(L) {
  const P = { speedK: 1, sat: 1, A: [1, 1, 1], B: [0, 0, 0], level: L.opacity };
  let A = null, B = null, rate = null, unit = 1;
  for (const inp of inputsOf(L.src)) {
    const r = roleOf(L, inp), on = r && !L.unlink.includes(inp.NAME), own = inp.DEFAULT;
    if (r && r.role === 'speed' && rate == null) {
      rate = Math.abs(own ?? 1) * (on ? (eng.macros.freeze ? 0 : eng.macros.speed) : 1);
      unit = /bpm|tempo/i.test(inp.NAME) ? 1 / 60 : /min/i.test(inp.LABEL || '') ? 1 / 60 : 1;
    }
    if (inp.TYPE === 'color') {
      const role = r && r.role, col = on && (role === 'color1' || role === 'color2') && eng.colors[role].on ? shown[role] : own;
      if (role === 'color1' || (!A && role !== 'color2')) A = A || col; else B = B || col;
    }
    if (r && r.role === 'saturation') P.sat = (own ?? 1) * (on ? eng.macros.sat : 1);
  }
  P.A = A || [1, 1, 1]; P.B = B || [0, 0, 0];
  P.rate = (rate ?? 0.3) * unit;
  if (!L.unlink.includes('@intensity')) P.level *= eng.macros.intensity;
  return P;
}
function pattern(fam, x, y, ph, P, seed) {
  const { A, B } = P, s = P.sat;
  const hueRGB = hh => mix([1, 1, 1], hsvRgb(((hh % 1) + 1) % 1 * 360, 1, 1), s);
  switch (fam) {
    case 'grad': return mix(A, B, 0.5 + 0.5 * Math.sin((x * 1.6 - ph * 0.5) * 2 * Math.PI + 1.5 * Math.sin(y * 3 + ph)));
    case 'blobs': { const d = Math.hypot(x - 0.5 - 0.3 * Math.sin(ph * 1.3), y - 0.5 - 0.3 * Math.cos(ph)); return mix(B, A, clamp(1.4 - d * 4, 0, 1)); }
    case 'breathe': return mix(B, A, 0.5 + 0.5 * Math.sin(ph * 2 * Math.PI));
    case 'checker': return ((Math.floor(x * 8 + ph) + Math.floor(y * 4)) & 1) ? A : B;
    case 'bars': { const f = ((x * 5 - ph) % 1 + 1) % 1; return f < 0.35 ? A : B; }
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
  for (const k of ['color1', 'color2']) {   // the colours slew: they take a moment to reach a new setting
    const c = eng.colors[k], to = hsvRgb(c.h, c.s, c.v);
    shown[k] = !shown[k] || c.slew <= 0 ? to : mix(shown[k], to, 1 - Math.exp(-dt / c.slew));
  }
  const cv = $('#view'), box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(box.width * dpr) || cv.height !== Math.round(box.height * dpr)) { cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr); }
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#06070a'; g.fillRect(0, 0, W, H);
  const pad = 22 * dpr, gap = 18 * dpr, zw = (W - pad * 2 - gap * 2) / 3, zh = Math.min(H - pad * 2 - 20 * dpr, zw * 0.62), top = (H - zh) / 2 + 6 * dpr;
  const master = eng.blackout ? 0 : eng.master;
  eng.zones.forEach((z, zi) => {
    const x0 = pad + zi * (zw + gap), cols = 30, rows = Math.max(6, Math.round(cols * zh / zw)), cw = zw / cols, chh = zh / rows;
    const looks = z.layers.map(L => {
      const P = layerLook(L), ph = (phases.get(L.id) || 0) + dt * P.rate;
      phases.set(L.id, ph);
      return { P, ph, fam: FAMILY[L.src] || 'grad', seed: zi * 7 };
    });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols, y = (r + 0.5) / rows;
      let rgb = [0, 0, 0];
      for (const lk of looks) { const p = pattern(lk.fam, x, y, lk.ph, lk.P, lk.seed), a = lk.P.level; rgb = [rgb[0] + p[0] * a, rgb[1] + p[1] * a, rgb[2] + p[2] * a]; }
      const k = z.opacity * master;
      g.fillStyle = cssRgb(rgb.map(v => Math.min(1, v) * k));
      g.beginPath(); g.arc(x0 + (c + 0.5) * cw, top + (r + 0.5) * chh, Math.min(cw, chh) * 0.34, 0, Math.PI * 2); g.fill();
    }
    g.setLineDash([5 * dpr, 4 * dpr]); g.strokeStyle = z.tag; g.lineWidth = dpr; g.strokeRect(x0 - 4 * dpr, top - 4 * dpr, zw + 8 * dpr, zh + 8 * dpr); g.setLineDash([]);
    g.fillStyle = z.tag; g.font = `600 ${11 * dpr}px Barlow, sans-serif`;
    g.fillText(`${z.name} · ${z.scenes[z.scene].name}`, x0 - 4 * dpr, top - 10 * dpr);
  });
  $('#stageNote').textContent = `Speed ${fmtX(eng.macros.freeze ? 0 : eng.macros.speed)} · intensity ${pct(eng.macros.intensity)} · saturation ${pct(eng.macros.sat)} · Color 1 ${eng.colors.color1.on ? 'on' : 'off'} · Color 2 ${eng.colors.color2.on ? 'on' : 'off'}`;
  requestAnimationFrame(drawStage);
}

/* ---------- the Scenes dock ---------- */
let dockSig = '';
const badgeFor = target => S.bindings.filter(b => b.target === target).map(b => h('span', { class: 'badge', title: `Bound: ${keyPort(b.key)}, ${keyLabel(b.key)}` }, keyLabel(b.key).split(' · ')[0]));
function renderDock() {
  const sig = JSON.stringify([view.zone, S.zones.map(z => [z.scene, z.layers.map(L => L.id)]), S.bindings.map(b => b.key + b.target)]);
  if (sig !== dockSig) {
    dockSig = sig;
    const rows = h('div', { class: 'zonerows' });
    for (const z of S.zones) {
      const lvl = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: z.opacity, 'aria-label': z.name + ' level', 'data-zone-level': z.id,
        oninput: e => eng.set(`zone:${z.id}:opacity`, +e.target.value), onclick: e => e.stopPropagation() });
      const head = h('div', { class: 'zhead' + (z.id === view.zone ? ' sel' : ''), onclick: () => { view.zone = z.id; view.layer = null; renderDock(); renderRight(); } },
        h('div', { class: 'zt' }, h('span', { class: 'ztag', style: { borderColor: z.tag } }), h('span', { class: 'nm' }, z.name), h('span', { class: 'mono muted', 'data-zone-pct': z.id }, pct(z.opacity))),
        h('div', { class: 'zc' }, lvl, ...badgeFor(`zone:${z.id}:opacity`)));
      const r = h('div', { class: 'scenerow' + (z.id === view.zone ? ' sel' : '') }, head);
      z.scenes.forEach((name, i) => r.append(h('div', { class: 'scene' + (z.scene === i ? ' live' : ''), role: 'button', tabindex: 0, style: { '--tag': z.tag },
        onclick: () => eng.set(`zone:${z.id}:scene:${i + 1}`, 1) },
        h('div', { class: 't' }, h('span', { class: 'nm' }, name), h('span', { class: 'k' }, String(i + 1))),
        h('div', { class: 's' }, ...badgeFor(`zone:${z.id}:scene:${i + 1}`), h('span', { class: 'fill' }), '◢ 2 s'))));
      rows.append(h('div', { class: 'zoneblock' + (z.id === view.zone ? ' sel' : '') }, r));
    }
    $('#dockBody').replaceChildren(h('div', { class: 'scenepanel' },
      h('div', { class: 'bar' }, h('span', null, 'Click a scene to play it. The macros carry on through every scene: they are applied as the frame is drawn, never stored in the layers.')), rows));
  }
  for (const z of S.zones) {
    const i = $(`[data-zone-level="${z.id}"]`);
    if (i && document.activeElement !== i) i.value = z.opacity;
    const p = $(`[data-zone-pct="${z.id}"]`); if (p) p.textContent = pct(z.opacity);
  }
}

/* ---------- the Content tab ---------- */
const ROLE_NAMES = { speed: 'Speed', color1: 'Color 1', color2: 'Color 2', saturation: 'Saturation', intensity: 'Intensity' };
const LINK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.8 2.8 0 014 4L11 8.5M9 11.5l-1.2 1.2a2.8 2.8 0 01-4-4L5 7.5"/></svg>';
let rightSig = '';
function renderRight() {
  const z = eng.zone(view.zone);
  if (!view.layer || !z.layers.some(L => L.id === view.layer)) view.layer = z.layers[0] && z.layers[0].id;
  const L = z.layers.find(x => x.id === view.layer);
  const sig = JSON.stringify([view, z.layers.map(x => [x.id, x.unlink, x.hand]), eng.colors.color1.on, eng.colors.color2.on]);
  if (sig !== rightSig) {
    rightSig = sig;
    const roleInputs = X => inputsOf(X.src).filter(i => roleOf(X, i)).map(i => i.NAME).concat('@intensity');
    const list = h('ul', { class: 'list layerlist' }, z.layers.map((X, i) => {
      const all = roleInputs(X), out = all.filter(n => X.unlink.includes(n)).length;
      const sw = h('input', { type: 'checkbox', checked: out < all.length, title: 'Follows the macros', 'aria-label': 'Layer follows the macros', onclick: e => e.stopPropagation(),
        onchange: e => { for (const n of all) eng.setExcluded(z.id, X.id, n, !e.target.checked); } });
      sw.indeterminate = out > 0 && out < all.length;
      return h('li', { class: X.id === view.layer ? 'sel' : '', onclick: () => { view.layer = X.id; renderRight(); } },
        h('span', { class: 'mono muted' }, String(z.layers.length - i)), h('span', { class: 'nm' }, SHADERS.get(X.src).name), h('span', { class: 'mono muted' }, pct(X.opacity)),
        h('label', { class: 'switch', title: 'Follows the macros' }, sw));
    }));
    const secL = h('div', { class: 'sec' }, h('h3', null, 'Layers · ', h('span', { style: { color: z.tag } }, z.name), h('span', { class: 'fill' }), h('span', { class: 'mono' }, z.scenes[z.scene].name)), list,
      h('p', { class: 'note' }, 'The switch on each layer: it follows the macros. Each parameter has its own link below.'));
    const ps = [];
    if (L) {
      // inputs a clock fills (OLM_CLOCKS) are hidden, as in the app
      const clocks = SHADERS.get(L.src).hdr.OLM_CLOCKS || {};
      for (const inp of inputsOf(L.src)) if (!(inp.NAME in clocks)) ps.push(paramRow(z, L, inp));
      ps.push(paramRow(z, L, { NAME: '@intensity', LABEL: 'Layer level', TYPE: 'layer' }));
    }
    $('#rightBody').replaceChildren(secL,
      h('div', { class: 'sec' }, h('h3', null, 'Parameters · ', L ? SHADERS.get(L.src).name : ''), ...ps,
        h('p', { class: 'note' }, 'A link takes the parameter to its macro as the frame is drawn; the value set here stays as it is. Links are kept with each layer, so a scene keeps its own.')));
  }
  for (const el of $$('#rightBody [data-eff]')) el._upd();
}
function paramRow(z, L, inp) {
  const r = inp.TYPE === 'layer' ? { role: 'intensity', how: 'header' } : roleOf(L, inp), on = r && !L.unlink.includes(inp.NAME);
  const eff = h('span', { class: 'eff', 'data-eff': 1 });
  eff._upd = () => {
    const own = inp.DEFAULT;
    if (inp.TYPE === 'color') {
      const over = on && (r.role === 'color1' || r.role === 'color2') && eng.colors[r.role].on;
      eff.replaceChildren(h('i', { style: { background: cssRgb(own) } }), ...(over ? ['→', h('i', { style: { background: cssRgb(shown[r.role] || hsvRgb(eng.colors[r.role].h, eng.colors[r.role].s, eng.colors[r.role].v)) } })] : []));
    } else if (inp.TYPE === 'layer') eff.textContent = on ? `${pct(L.opacity)} × ${pct(eng.macros.intensity)}` : pct(L.opacity);
    else {
      const k = !on ? null : r.role === 'speed' ? (eng.macros.freeze ? 0 : eng.macros.speed) : r.role === 'saturation' ? eng.macros.sat : null;
      eff.textContent = k == null ? fmtV(own) : `${fmtV(own)} × ${k.toFixed(2)} = ${fmtV(Math.round(own * k * 100) / 100)}`;
    }
  };
  let chip;
  if (!r && !SHADERS.get(L.src).custom && inp.TYPE !== 'color') chip = h('span', { class: 'muted', title: 'Follows no macro' }, '—');
  else if (!r) {
    chip = h('select', { 'aria-label': `Link ${inp.LABEL || inp.NAME} to a macro`, title: 'Not linked by its header or its name: link it by hand',
      onchange: e => eng.setHandRole(z.id, L.id, inp.NAME, e.target.value || null) },
      h('option', { value: '' }, 'Link…'), ...(inp.TYPE === 'color' ? ['color1', 'color2'] : ['speed', 'saturation']).map(k => h('option', { value: k }, ROLE_NAMES[k])));
  } else if (r.how === 'hand') {
    chip = h('button', { class: 'linkchip', type: 'button', title: 'Linked by hand. Click to take the link off.', onclick: () => eng.setHandRole(z.id, L.id, inp.NAME, null) }, svgEl(LINK_ICON), ROLE_NAMES[r.role], ' · by hand');
  } else {
    const from = r.how === 'header' ? (inp.TYPE === 'layer' ? 'every layer' : "the shader's header") : `its name (${inp.NAME})`;
    chip = h('button', { class: 'linkchip' + (on ? '' : ' off'), type: 'button', 'aria-pressed': String(on),
      title: `${on ? 'Follows' : 'Left out of'} ${ROLE_NAMES[r.role]}, linked by ${from}. Click to ${on ? 'leave it out' : 'link it again'}.`,
      onclick: () => eng.setExcluded(z.id, L.id, inp.NAME, on) }, svgEl(LINK_ICON), ROLE_NAMES[r.role]);
  }
  return h('div', { class: 'prow' }, h('span', { class: 'lbl', title: inp.LABEL || inp.NAME }, inp.LABEL || inp.NAME), eff, chip);
}

/* ---------- start ---------- */
eng.on(ev => {
  if (ev.t === 'state') { S = ev.s; renderDock(); renderRight(); syncTop(); }
  else if (ev.t === 'led' && ev.dir === 'in') blinkMidi();
  else if (ev.t === 'toast' && !mapOpen()) toast(ev.text);
});
addEventListener('message', ev => { if (ev.data && ev.data.olm === 'midi-bye') setTimeout(syncTop, 50); });
setInterval(() => { if (popup && popup.closed) { popup = null; syncTop(); } }, 800);
initTop();
renderDock(); renderRight(); syncTop();
requestAnimationFrame(drawStage);
setInterval(() => { for (const el of $$('#rightBody [data-eff]')) el._upd(); }, 120);
