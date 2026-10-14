// openLedMapper · docs/mockups/midi-window.js
// The mapping window, as a patch bay. Left to right: the MIDI controls, the macros, the effects; wires join them.
// A wire from a control drives a macro, an effect's control, Master or a zone's level; wires from a macro go to the
// effect controls it moves. Draw a wire from a dot to a dot, or press Learn, move a MIDI control and touch what it
// should move (here or in the main window). Click a wire to remove it. The engine runs in the main window
// (connectEngine): this window shows it and sends it what the user does.

let S = null;
const ui = { sel: null, hoverMac: null, hoverPar: null, showAll: new Set(), drag: null, vcShut: false };
const E = connectEngine(onEvent);
if (E.local) startWebMidi(E.engine);
const op = (name, ...a) => E.op(name, ...a);
const sliders = [];   // the sliders that show where their MIDI fader is (mappedSlider)

/* ---------- the three columns ---------- */
const dot = (dir, id) => h('span', { class: 'port ' + dir, ['data-' + dir]: id, title: dir === 'out' ? 'Drag from here to what it should move' : 'Drag a wire here' });
const zoneShim = { zone: id => S.zones.find(z => z.id === id), get macros() { return S.macros; } };
const TI = t => targetInfo(zoneShim, t);
const wiresTo = t => S.wires.filter(w => w.to === t);
const takeoverChip = t => {
  const ws = wiresTo(t);
  if (!ws.length || TI(t).toggle) return null;
  const mode = ws[0].takeover;
  return h('button', { class: 'tko', type: 'button', title: mode === 'pickup' ? 'Pickup: it follows once the fader reaches it. Click for Jump.' : 'Jump: it goes where the fader is at once. Click for Pickup.',
    onclick: e => { e.stopPropagation(); op('setTakeover', t, mode === 'pickup' ? 'jump' : 'pickup'); } }, mode === 'pickup' ? 'Pickup' : 'Jump');
};
// A row that is a target: while learning, touching it picks it
function target(t, el) {
  el.dataset.target = t;
  el.addEventListener('pointerdown', e => {
    if (!S.learn.on || e.target.closest('.port, .tko, .x')) return;
    e.preventDefault(); e.stopPropagation(); op('learnTarget', t);
  }, true);
  return el;
}
function slider(t, min, max, step) {
  const r = h('input', { type: 'range', min, max, step, 'aria-label': TI(t).label, oninput: e => op('set', t, +e.target.value) });
  const s = mappedSlider(r, t);
  s.sync = () => { if (document.activeElement !== r) r.value = valueOf(t); s.mark(S); };
  sliders.push(s);
  return s;
}
function valueOf(t) {
  if (t === 'master') return S.master;
  if (t === 'blackout') return S.blackout;
  if (t.startsWith('z:')) return S.zones.find(z => z.id === t.slice(2)).opacity;
  if (t.startsWith('m:')) {
    const [id, c] = t.slice(2).split('.'), m = S.macros[id];
    if (c == null) return m.v;
    const k = COMPONENTS[m.mode][+c][0];
    return 'hsv'.includes(k) ? m[k] : hsvRgb(m.h, m.s, m.v)['rgb'.indexOf(k)];
  }
  for (const f of S.effects) for (const p of f.params) if (p.key === t) return p.value;
  return 0;
}
function renderControls() {
  const cs = S.controls.slice().sort((a, b) => keyParts(a.key).num - keyParts(b.key).num);
  $('#colCtl').replaceChildren(h('h3', { class: 'colh' }, 'MIDI controls'),
    ...cs.map(c => {
      const wired = S.wires.some(w => w.key === c.key), k = keyParts(c.key);
      const bar = h('i', { class: 'cbar' });
      bar.style.width = c.last == null ? '0' : c.last * 100 + '%';
      return h('div', { class: 'ctl' + (wired ? '' : ' loose') + (c.offline ? ' off' : ''), 'data-key': c.key, title: `${k.port}: ${keyLabel(c.key)}` },
        h('span', { class: 'pillk' }, keyLabel(c.key)), h('small', null, k.port === VIRTUAL ? 'virtual' : k.port + (c.offline ? ' · unplugged' : '')), h('span', { class: 'cval' }, bar),
        h('button', { class: 'x', type: 'button', title: 'Forget this control and its wires', 'aria-label': 'Forget ' + keyLabel(c.key), onclick: () => op('forget', c.key) }, icon('x')),
        dot('out', 'k:' + c.key));
    }),
    h('p', { class: 'colnote' }, S.controls.length ? 'Move a control on your controller and it shows here. Drag from its dot to a macro or an effect. Point at a macro to see the effects it moves.' : 'Move a fader, knob or pad on your controller: it shows here.'));
}
function renderMacros() {
  const rows = [h('h3', { class: 'colh' }, 'Macros')];
  for (const d of MACROS) {
    const m = S.macros[d.id], t = 'm:' + d.id, n = S.effects.reduce((k, f) => k + f.params.filter(p => p.macros.includes(d.id)).length, 0);
    const out = h('span', { class: 'fan' }, n ? '→ ' + n : '');
    const onSw = d.kind === 'abs' || d.kind === 'color' ? h('label', { class: 'switch', title: m.on ? 'On: the effects follow it' : 'Off: the effects keep their own value' },
      h('input', { type: 'checkbox', checked: !!m.on, 'aria-label': d.label + ' on', onchange: e => op('setMacroOn', d.id, e.target.checked) })) : null;
    if (d.kind === 'color') {
      const sw = h('i', { class: 'csw', style: { background: cssRgb(hsvRgb(m.h, m.s, m.v)) } });
      const mode = h('span', { class: 'seg mini' }, ['hsv', 'rgb'].map(x => h('button', { type: 'button', class: m.mode === x ? 'on' : '', onclick: () => op('setMode', d.id, x) }, x.toUpperCase())));
      rows.push(h('div', { class: 'mac color' + (m.on ? '' : ' dim') + (ui.hoverMac === d.id ? ' hov' : ''), 'data-mac': d.id, onmouseenter: () => hoverMac(d.id), onmouseleave: () => hoverMac(null) },
        h('div', { class: 'mrow1' }, sw, h('b', null, d.label), mode, h('span', { class: 'fill' }), onSw, out), dot('out', t)));
      COMPONENTS[m.mode].forEach(([k, name], i) => {
        const tc = `${t}.${i}`;
        rows.push(target(tc, h('div', { class: 'mac sub', 'data-mac': d.id }, dot('in', tc), h('span', { class: 'nm' }, name),
          slider(tc, 0, k === 'h' ? 360 : 1, k === 'h' ? 1 : 0.01), takeoverChip(tc))));
      });
      continue;
    }
    const fmt = d.kind === 'mult' ? fmtX : pct;
    const val = h('span', { class: 'mono vv' }, fmt(m.v));
    rows.push(target(t, h('div', { class: 'mac' + (m.on ? '' : ' dim') + (ui.hoverMac === d.id ? ' hov' : ''), 'data-mac': d.id, onmouseenter: () => hoverMac(d.id), onmouseleave: () => hoverMac(null),
      title: d.kind === 'abs' ? `Sets the ${d.label.toLowerCase()} of every effect it is wired to, each in its own range. Shared by ${d.shared} effects.` : d.kind === 'mult' ? 'Multiplies the speed of every effect it is wired to: 1× in the middle.' : '' },
    dot('in', t), h('div', { class: 'mrow1' }, h('b', null, d.label), val, h('span', { class: 'fill' }), takeoverChip(t), onSw, out),
    slider(t, 0, d.kind === 'mult' ? 2 : 1, 0.01), dot('out', t))));
  }
  rows.push(h('h3', { class: 'colh sub' }, 'Output'));
  for (const [t, label] of [['master', 'Master'], ...S.zones.map(z => ['z:' + z.id, z.name + ' level'])])
    rows.push(target(t, h('div', { class: 'mac' }, dot('in', t), h('div', { class: 'mrow1' }, h('b', null, label), h('span', { class: 'fill' }), takeoverChip(t)), slider(t, 0, 1, 0.01))));
  rows.push(target('blackout', h('div', { class: 'mac' }, dot('in', 'blackout'), h('div', { class: 'mrow1' }, h('b', null, 'Blackout'), h('span', { class: 'fill' }),
    h('button', { class: 'btn sm' + (S.blackout ? ' bo-on' : ''), type: 'button', onclick: () => op('set', 'blackout', S.blackout ? 0 : 1) }, S.blackout ? 'On' : 'Off')))));
  $('#colMac').replaceChildren(...rows);
}
function renderEffects() {
  const cards = S.effects.map(f => {
    const linked = p => p.macros.length || wiresTo(p.key).length;
    const all = ui.showAll.has(f.src), shown = f.params.filter(p => all || linked(p)), hidden = f.params.length - shown.length;
    return h('div', { class: 'fxc' },
      h('div', { class: 'fxh' }, h('b', null, f.name), h('small', null, f.where.join(', '))),
      ...shown.map(p => {
        const val = p.type === 'color' ? h('i', { class: 'csw', style: { background: cssRgb(p.value) } }) : h('span', { class: 'mono vv' }, p.type === 'level' ? pct(p.value) : TI(p.key).fmt(p.value));
        const marks = p.macros.map(id => h('span', { class: 'mk', title: `Follows ${macroDef(id).label}` }, macroDef(id).label));
        return target(p.key, h('div', { class: 'par' + (linked(p) ? '' : ' loose'), onmouseenter: () => hoverPar(p.key), onmouseleave: () => hoverPar(null) }, dot('in', p.key), h('span', { class: 'nm', title: p.label }, p.label), ...marks, h('span', { class: 'fill' }), takeoverChip(p.key), val));
      }),
      hidden || all ? h('button', { class: 'more', type: 'button', onclick: () => { if (all) ui.showAll.delete(f.src); else ui.showAll.add(f.src); render(true); } }, all ? 'Show the linked ones' : `${hidden} more`) : null);
  });
  $('#colFx').replaceChildren(h('h3', { class: 'colh' }, 'Effects'), ...cards);
}
// A macro's wires show while its macro, or an effect control it reaches, is under the pointer (or one is picked)
function hoverMac(id) { if (ui.hoverMac === id) return; ui.hoverMac = id; drawWires(); }
function hoverPar(k) { if (ui.hoverPar === k) return; ui.hoverPar = k; drawWires(); }

/* ---------- wires ---------- */
// Every wire, from the dot on the right of a control or macro to the dot on the left of what it moves. Ends that
// are scrolled out of their column stop at its edge.
function allWires() {
  const out = S.wires.map(w => ({ id: 'w:' + w.id, from: 'k:' + w.key, to: w.to, kind: 'ctl', w }));
  for (const f of S.effects) for (const p of f.params) for (const m of p.macros) out.push({ id: `l:${m}|${p.key}`, from: 'm:' + m, to: p.key, kind: 'mac', m, p: p.key });
  return out;
}
function portXY(sel, box) {
  const el = $(sel, $('#patch'));
  if (!el) return null;
  const r = el.getBoundingClientRect(), col = el.closest('.pcol').getBoundingClientRect();
  const y = r.top + r.height / 2, cy = clamp(y, col.top + 26, col.bottom - 4);
  return { x: r.left + r.width / 2 - box.left, y: cy - box.top, edge: cy !== y };
}
const curve = (a, b) => { const dx = Math.max(40, (b.x - a.x) * 0.5); return `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`; };
function drawWires() {
  if (!S) return;
  const svg = $('#wires'), box = $('#patch').getBoundingClientRect(), paths = [];
  let selMid = null;
  for (const w of allWires()) {
    if (w.kind === 'mac' && ui.hoverMac !== w.m && ui.hoverPar !== w.p && ui.sel !== w.id) continue;
    const a = portXY(`[data-out="${CSS.escape(w.from)}"]`, box), b = portXY(`[data-in="${CSS.escape(w.to)}"]`, box);
    if (!a || !b) continue;
    const d = curve(a, b), sel = ui.sel === w.id;
    const faint = false, lit = w.kind === 'mac';
    const hot = w.kind === 'ctl' && performance.now() - (w.w._hit || 0) < 250;
    paths.push(`<path class="hit" data-wid="${w.id}" d="${d}"/><path class="wire ${w.kind}${sel ? ' sel' : ''}${faint ? ' faint' : ''}${lit ? ' lit' : ''}${hot ? ' hot' : ''}${a.edge || b.edge ? ' edge' : ''}" d="${d}"/>`);
    if (sel) selMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (ui.drag && ui.drag.a) paths.push(`<path class="wire drag" d="${curve(ui.drag.a, ui.drag.b)}"/>`);
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = paths.join('');
  const x = $('#wx');
  x.hidden = !selMid;
  if (selMid) { x.style.left = selMid.x - 11 + 'px'; x.style.top = selMid.y - 11 + 'px'; }
}
function removeWire(id) {
  if (!id) return;
  if (id.startsWith('w:')) op('disconnect', id.slice(2));
  else { const [m, pk] = id.slice(2).split('|'); op('linkMacro', m, pk, false); }
  ui.sel = null;
  drawWires();
}
// Dragging a wire: from a dot to a dot, either way round
function connectPorts(a, b) {
  const [out, inn] = a.dataset.out ? [a.dataset.out, b && b.dataset.in] : [b && b.dataset.out, a.dataset.in];
  if (!out || !inn) return;
  if (out.startsWith('k:')) { op('connect', out.slice(2), inn); return; }
  const m = out.slice(2), d = macroDef(m);
  if (!inn.startsWith('p:')) { toast('A macro wires to the controls of the effects.', 'warn'); return; }
  const p = S.effects.flatMap(f => f.params).find(x => x.key === inn);
  if (!p) return;
  if ((d.kind === 'color') !== (p.type === 'color')) { toast(d.kind === 'color' ? `${d.label} goes to a colour.` : `${d.label} goes to a number, not a colour.`, 'warn'); return; }
  if (m === 'intensity' && p.type !== 'level') { toast('Intensity goes to the level of an effect.', 'warn'); return; }
  op('linkMacro', m, inn, true);
}
function initWires() {
  const patch = $('#patch');
  patch.addEventListener('pointerdown', e => {
    const port = e.target.closest('.port');
    if (!port) return;
    e.preventDefault();
    const box = patch.getBoundingClientRect(), r = port.getBoundingClientRect();
    const start = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    ui.drag = { port, start, a: start, b: start };
    patch.setPointerCapture(e.pointerId);
    patch.classList.add('dragging', port.dataset.out ? 'to-in' : 'to-out');
  });
  patch.addEventListener('pointermove', e => {
    if (!ui.drag) return;
    const box = patch.getBoundingClientRect(), b = { x: e.clientX - box.left, y: e.clientY - box.top };
    // drawn from its out end, left to right, whichever end it started from
    if (ui.drag.port.dataset.out) { ui.drag.a = ui.drag.start; ui.drag.b = b; } else { ui.drag.a = b; ui.drag.b = ui.drag.start; }
    drawWires();
  });
  patch.addEventListener('pointerup', e => {
    if (!ui.drag) return;
    const d = ui.drag;
    ui.drag = null;
    patch.classList.remove('dragging', 'to-in', 'to-out');
    const under = document.elementFromPoint(e.clientX, e.clientY), port = under && under.closest('.port');
    if (port && port !== d.port) connectPorts(d.port, port);
    drawWires();
  });
  // the click stops here: redrawing takes the clicked path out of the page, and the patch would take it as a click elsewhere
  $('#wires').addEventListener('click', e => { e.stopPropagation(); const p = e.target.closest('[data-wid]'); ui.sel = p ? p.dataset.wid : null; drawWires(); });
  $('#wires').addEventListener('dblclick', e => { const p = e.target.closest('[data-wid]'); if (p) removeWire(p.dataset.wid); });
  patch.addEventListener('click', e => { if (!e.target.closest('#wires, #wx') && ui.sel) { ui.sel = null; drawWires(); } });
  $('#wx').addEventListener('click', e => { e.stopPropagation(); removeWire(ui.sel); });
  for (const c of $$('.pcol')) c.addEventListener('scroll', () => drawWires(), { passive: true });
  addEventListener('resize', () => drawWires());
}

/* ---------- devices, monitor ---------- */
function renderDevices() {
  const d = S.devices, sim = d.inputs.find(x => x.sim);
  const note = { checking: 'Looking for MIDI ports…', none: 'This browser has no Web MIDI: try the virtual controller below. Chrome, Edge and the app have it.',
    blocked: 'MIDI access was refused: try the virtual controller below.', empty: 'No MIDI ports yet: plug one in and it shows here.', ok: 'Plug a controller in or out at any time: it is found again by its name.' }[d.webmidi];
  $('#devices').replaceChildren(h('div', { class: 'devsec' }, h('h3', null, 'MIDI in'),
    ...d.inputs.map(x => h('div', { class: 'dev' + (x.state === 'connected' ? '' : ' gone') },
      h('span', { class: 'led', 'data-led': x.name }), h('span', { class: 'nm', title: x.name }, x.name, x.virtual ? h('small', null, 'on screen, below') : x.state !== 'connected' ? h('small', null, 'unplugged') : x.sim ? h('small', null, 'simulated') : null),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: x.on, 'aria-label': x.name + ' on', onchange: e => op('setPort', x.name, e.target.checked) })))),
    h('button', { class: 'btn sm', type: 'button', onclick: () => op('plugSimulated') }, sim.state === 'connected' ? `Unplug the ${SIMULATED}` : `Plug in a ${SIMULATED}`),
    h('p', { class: 'note' }, note),
    h('p', { class: 'note' }, 'On Windows a MIDI port works in one program at a time: close it in Resolume or MadMapper first.')));
  const live = d.inputs.filter(x => x.on && x.state === 'connected').length;
  $('#pillMidi').className = 'pill' + (live ? ' ok' : ' warn');
  $('#pillMidi').lastChild.textContent = `${live} MIDI in`;
}
let monCount = 0;
function addMonitor(e) {
  const mon = $('#mon');
  if (mon.querySelector('.empty')) mon.replaceChildren();
  const d = e.targets && e.targets.length ? h('div', { class: 'd go' }, '→ ' + e.targets.join(', ')) : h('div', { class: 'd' + (e.note === 'learnt' ? ' learnt' : '') }, e.note || '');
  const row = h('div', { class: 'mrow new' }, h('span', { class: 't' }, e.time), h('span', { class: 'm', title: e.port + ' · ' + e.text }, e.text), h('span', { class: 'v' }, e.val), d);
  mon.prepend(row);
  setTimeout(() => row.classList.remove('new'), 400);
  while (mon.childElementCount > 120) mon.lastChild.remove();
  $('#monMeta').textContent = `${++monCount}`;
}
const monEmpty = () => $('#mon').replaceChildren(h('div', { class: 'empty' }, 'Every message from your controllers shows here, with what it moves.'));

/* ---------- the virtual controller ---------- */
// A MIDI port on screen, for trying this without hardware: 8 faders (CC 21 to 28) and 8 pads (notes 36 to 43).
const VF = [21, 22, 23, 24, 25, 26, 27, 28], VP = [36, 37, 38, 39, 40, 41, 42, 43], vf = new Map(VF.map(n => [n, 0]));
const vkey = (type, n) => `midi:${VIRTUAL}:1:${type}:${n}`;
const vupd = [];
function sendCC(n, v) { v = clamp(Math.round(v), 0, 127); if (v === vf.get(n)) return; vf.set(n, v); op('input', { port: VIRTUAL, ch: 1, type: 'cc', num: n, val: v }); for (const f of vupd) f(); }
function renderVC() {
  vupd.length = 0;
  const faders = VF.map((n, i) => {
    const fill = h('div', { class: 'vfill' }), cap = h('div', { class: 'vcap' }), v = h('span', { class: 'v' }), tg = h('span', { class: 'tg' });
    const track = h('div', { class: 'vtrack', tabindex: 0, role: 'slider', 'aria-label': `Fader ${i + 1}, CC ${n}` }, fill, cap);
    const at = y => { const r = track.getBoundingClientRect(); return (1 - clamp((y - r.top - 8) / (r.height - 16), 0, 1)) * 127; };
    track.addEventListener('pointerdown', e => { track.setPointerCapture(e.pointerId); sendCC(n, at(e.clientY)); track.onpointermove = ev => sendCC(n, at(ev.clientY)); });
    track.addEventListener('pointerup', () => { track.onpointermove = null; });
    track.addEventListener('wheel', e => { e.preventDefault(); sendCC(n, vf.get(n) + (e.deltaY < 0 ? 2 : -2)); }, { passive: false });
    track.addEventListener('keydown', e => { const d = { ArrowUp: 1, ArrowDown: -1 }[e.key]; if (d) { e.preventDefault(); sendCC(n, vf.get(n) + d * (e.shiftKey ? 10 : 1)); } });
    vupd.push(() => {
      const x = vf.get(n) / 127;
      cap.style.bottom = `calc(8px + ${x} * (100% - 16px))`; fill.style.height = `calc(${x} * (100% - 16px))`; v.textContent = vf.get(n);
      tg.textContent = S ? S.wires.filter(w => w.key === vkey('cc', n)).map(w => w.label).join(', ') || '—' : '—'; tg.title = tg.textContent;
    });
    return h('div', { class: 'vf' }, v, track, h('span', { class: 'nm' }, 'F' + (i + 1)), tg);
  });
  const pads = VP.map((n, i) => {
    const tg = h('span', { class: 'tg' });
    const press = on => { el.classList.toggle('down', on); op('input', { port: VIRTUAL, ch: 1, type: on ? 'on' : 'off', num: n, val: on ? 100 : 0 }); };
    const el = h('button', { class: 'vpad', type: 'button', 'aria-label': `Pad ${i + 1}, note ${n}` }, h('span', { class: 'nm' }, 'P' + (i + 1)), tg);
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); press(true); });
    el.addEventListener('pointerup', () => press(false));
    vupd.push(() => { tg.textContent = S ? S.wires.filter(w => w.key === vkey('note', n)).map(w => w.label).join(', ') || '—' : '—'; });
    return el;
  });
  $('#vc').classList.toggle('shut', ui.vcShut);
  $('#vc').replaceChildren(h('div', { class: 'vchead' }, h('h2', null, 'Virtual controller'), h('span', { class: 'meta' }, 'for trying it without hardware · faders CC 21–28 · pads notes 36–43'), h('span', { class: 'fill' }),
    h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { ui.vcShut = !ui.vcShut; renderVC(); for (const f of vupd) f(); requestAnimationFrame(drawWires); } }, ui.vcShut ? 'Show ▴' : 'Hide ▾')),
  h('div', { class: 'vcbody' }, h('div', { class: 'vfaders' }, faders), h('div', { class: 'vpads' }, pads)));
}

/* ---------- state ---------- */
let sig = '';
function render(force = false) {
  const busy = !!ui.drag;
  const n = JSON.stringify([S.controls.map(c => [c.key, c.offline]), S.wires.map(w => [w.id, w.key, w.to, w.takeover]), S.effects.map(f => f.params.map(p => p.macros)),
    MACROS.map(d => [S.macros[d.id].on, S.macros[d.id].mode]), [...ui.showAll], S.devices, S.zones.map(z => z.name), S.blackout]);
  if ((n !== sig || force) && !busy) {
    sig = n;
    const keep = $$('.pcol').map(c => c.scrollTop);
    sliders.length = 0;
    renderControls(); renderMacros(); renderEffects(); renderDevices();
    $$('.pcol').forEach((c, i) => { c.scrollTop = keep[i]; });
  } else update();
  for (const s of sliders) s.sync();
  const L = S.learn;
  $('#mw').classList.toggle('learning', L.on);
  $('#learn').classList.toggle('on', L.on); $('#learn').textContent = L.on ? 'Learning' : 'Learn'; $('#learn').setAttribute('aria-pressed', String(L.on));
  $('#hint').replaceChildren(...(!L.on ? [] : L.pending ? [h('b', null, keyLabel(L.pending)), ' moved: now touch what it should move, here or in the main window.']
    : L.target ? ['Now move a MIDI control for ', h('b', null, TI(L.target).label), '…'] : ['Move a MIDI control, then touch what it should move. Or the other way round. Esc stops.']));
  for (const el of $$('#patch [data-target]')) el.classList.toggle('pick', el.dataset.target === L.target);
  for (const f of vupd) f();
  drawWires();
}
// Values only: the bars of the controls, the values of the macros and effects
function update() {
  for (const c of S.controls) { const el = $(`.ctl[data-key="${CSS.escape(c.key)}"] .cbar`); if (el) el.style.width = c.last == null ? '0' : c.last * 100 + '%'; }
  for (const d of MACROS) {
    const el = $(`.mac[data-mac="${d.id}"] .vv`), m = S.macros[d.id];
    if (el) el.textContent = d.kind === 'mult' ? fmtX(m.v) : pct(m.v);
    const sw = $(`.mac.color[data-mac="${d.id}"] .csw`); if (sw) sw.style.background = cssRgb(hsvRgb(m.h, m.s, m.v));
  }
  for (const f of S.effects) for (const p of f.params) {
    const el = $(`.par[data-target="${CSS.escape(p.key)}"] .vv, .par[data-target="${CSS.escape(p.key)}"] .csw`);
    if (!el) continue;
    if (p.type === 'color') el.style.background = cssRgb(p.value); else el.textContent = p.type === 'level' ? pct(p.value) : TI(p.key).fmt(p.value);
  }
}
function onEvent(ev) {
  if (ev.t === 'state') { S = ev.s; render(); return; }
  if (!S) return;
  if (ev.t === 'msg') { addMonitor(ev.e); const ctl = $(`.ctl[data-key="${CSS.escape(ev.e.key)}"]`); if (ctl) { ctl.classList.add('hit'); clearTimeout(ctl._t); ctl._t = setTimeout(() => { ctl.classList.remove('hit'); drawWires(); }, 200); } }
  else if (ev.t === 'led') { for (const el of $$(`.led[data-led="${CSS.escape(ev.port)}"]`)) { el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 80); } }
  else if (ev.t === 'toast') toast(ev.text);
}

/* ---------- start ---------- */
$('#learn').addEventListener('click', () => op('setLearn', !S.learn.on));
$('#monClear').addEventListener('click', () => { monCount = 0; $('#monMeta').textContent = ''; monEmpty(); });
addEventListener('keydown', e => {
  if (typingIn(e.target)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sel) { e.preventDefault(); removeWire(ui.sel); }
  else if (e.key === 'Escape') { if (ui.sel) { ui.sel = null; drawWires(); } else if (S && S.learn.on) op('setLearn', false); }
  else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey && S) op('setLearn', !S.learn.on);
});
monEmpty();
initWires();
renderVC();
if (!E.local) setTimeout(() => { if (!S) toast('The main window does not answer: open this from its MIDI button.', 'warn'); }, 1500);
