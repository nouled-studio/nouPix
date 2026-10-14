// openLedMapper · docs/mockups/midi-window.js
// The mapping window, as a patch bay. Left to right: the MIDI controls, the macros (with the output and the zones),
// the effects; wires join them. A wire from a control drives a macro, an effect's control, Master, Blackout, a
// zone's level, a scene or a playlist; wires from a macro go to the effect controls it moves. Draw a wire from a dot
// to a dot, or press Learn, move a MIDI control and touch what it should move (here or in the main window). Click a
// wire for its settings and to remove it. The engine runs in the main window (connectEngine): this window shows it
// and sends it what the user does.

let S = null;
// open: the groups unfolded ('color1', 'color2', 'zone:z1'…); everything else starts folded, to keep it short.
// pickMac: the macro clicked, whose wires stay drawn. move: a control dragged to another place in the list.
const ui = { sel: null, hoverMac: null, hoverPar: null, pickMac: null, showAll: new Set(), open: new Set(), drag: null, move: null, vcShut: false, monShut: false };
const saved = k => { try { return localStorage.getItem('olm-midi-' + k); } catch (e) { return null; } };
const save = (k, v) => { try { localStorage.setItem('olm-midi-' + k, v); } catch (e) { /* not kept */ } };
const E = connectEngine(onEvent);
if (E.local) startWebMidi(E.engine);
const op = (name, ...a) => E.op(name, ...a);
const sliders = [];   // the sliders that show where their MIDI fader is (mappedSlider)
const shim = { zone: id => S.zones.find(z => z.id === id), get macros() { return S.macros; } };
const TI = t => targetInfo(shim, t);
const wiresTo = t => S.wires.filter(w => w.to === t);

/* ---------- pieces of a row ---------- */
const dot = (dir, id) => h('span', { class: 'port ' + dir, ['data-' + dir]: id, title: dir === 'out' ? 'Drag from here to what it should move' : 'Drag a wire here' });
// The button that folds a group or opens it
const chev = (id, label) => h('button', { class: 'fold' + (ui.open.has(id) ? ' open' : ''), type: 'button', 'aria-expanded': String(ui.open.has(id)), 'aria-label': (ui.open.has(id) ? 'Fold ' : 'Open ') + label,
  onclick: e => { e.stopPropagation(); if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id); render(true); } }, icon('chev'));
// A row that is a target: while learning, touching it picks it (and does nothing else: its button doesn't play)
function target(t, el) {
  el.dataset.target = t;
  const learning = e => S.learn.on && !e.target.closest('.port, .fold, .seg, .switch');
  el.addEventListener('pointerdown', e => { if (learning(e)) { e.preventDefault(); e.stopPropagation(); op('learnTarget', t); } }, true);
  el.addEventListener('click', e => { if (learning(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  return el;
}
function valueOf(t) {
  if (t === 'master') return S.master;
  if (t === 'blackout') return S.blackout;
  if (t.startsWith('z:')) return shim.zone(t.slice(2)).opacity;
  if (t.startsWith('m:')) {
    const [id, c] = t.slice(2).split('.'), m = S.macros[id];
    if (c == null) return m.v;
    const k = COMPONENTS[m.mode][+c][0];
    return 'hsv'.includes(k) ? m[k] : hsvRgb(m.h, m.s, m.v)['rgb'.indexOf(k)];
  }
  for (const f of S.effects) for (const p of f.params) if (p.key === t) return p.value;
  return 0;
}
function slider(t, min, max, step) {
  const r = h('input', { type: 'range', min, max, step, 'aria-label': TI(t).label, oninput: e => { if (S.learn.on) r.value = valueOf(t); else op('set', t, +e.target.value); } });
  const s = mappedSlider(r, t);
  s.sync = () => { if (document.activeElement !== r) r.value = valueOf(t); s.mark(S); };
  sliders.push(s);
  return s;
}
// How many effect controls a macro moves
const fanOf = id => S.effects.reduce((k, f) => k + f.params.filter(p => p.macros.includes(id)).length, 0);
const onSwitch = (id, label) => {
  const m = S.macros[id];
  return h('label', { class: 'switch', title: m.on ? 'On: the effects follow it' : 'Off: the effects keep their own value' },
    h('input', { type: 'checkbox', checked: !!m.on, 'aria-label': label + ' on', onchange: e => op('setMacroOn', id, e.target.checked) }));
};

/* ---------- MIDI controls ---------- */
function renderControls() {
  $('#colCtl').replaceChildren(...S.controls.map(c => {
    const ws = S.wires.filter(w => w.key === c.key), k = keyParts(c.key);
    const bar = h('i', { class: 'cbar' });
    bar.style.width = c.last == null ? '0' : c.last * 100 + '%';
    return h('div', { class: 'ctl' + (ws.length ? '' : ' loose') + (c.offline ? ' off' : ''), 'data-key': c.key, title: `${k.port}: ${keyLabel(c.key)}. Drag it up or down to put it in another place.` },
      h('div', { class: 'ctop' }, h('span', { class: 'pillk' }, keyLabel(c.key).split(' · ')[0]), h('small', null, `ch${k.ch}` + (k.port === VIRTUAL ? '' : ` · ${k.port}${c.offline ? ' · unplugged' : ''}`)),
        h('button', { class: 'x', type: 'button', title: 'Forget this control and its wires', 'aria-label': 'Forget ' + keyLabel(c.key), onclick: () => op('forget', c.key) }, icon('x'))),
      h('span', { class: 'cval' }, bar),
      ws.length ? h('div', { class: 'tgts' }, ws.map(w => h('button', { type: 'button', title: 'Show it', onclick: () => reveal(w.to) }, '→ ' + w.label))) : null,
      dot('out', 'k:' + c.key));
  }),
  h('p', { class: 'colnote' }, S.controls.length ? 'Move a control on your controller and it shows here. Drag from its dot to what it should move; drag the control itself to put it in another place.' : 'Move a fader, knob or pad on your controller: it shows here.'));
}

/* ---------- macros, output, zones ---------- */
// Clicking a macro picks it: its wires to the effects stay drawn while the effects scroll. Again (or Esc) lets it go.
const pickMac = id => e => {
  if (S.learn.on || e.target.closest('input, label, button, .port')) return;
  ui.pickMac = ui.pickMac === id ? null : id;
  render(true);
};
const macClass = (d, m) => (m.on ? '' : ' dim') + (ui.hoverMac === d.id ? ' hov' : '') + (ui.pickMac === d.id ? ' picked' : '');
const PICK_TIP = ' Click it to keep its wires to the effects drawn.';
function macroRow(d) {
  const m = S.macros[d.id], t = 'm:' + d.id, n = fanOf(d.id), fmt = d.kind === 'mult' ? fmtX : pct;
  const val = h('span', { class: 'vv' }, fmt(m.v));
  const el = target(t, h('div', { class: 'mac' + macClass(d, m), 'data-mac': d.id, onmouseenter: () => hoverMac(d.id), onmouseleave: () => hoverMac(null), onclick: pickMac(d.id),
    title: (d.kind === 'abs' ? `Sets the ${d.label.toLowerCase()} of every effect it is wired to, each in its own range. Shared by ${d.shared} effects.`
      : d.kind === 'mult' ? 'Multiplies the speed of every effect it is wired to: 1× in the middle.' : d.id === 'intensity' ? 'Scales the level of every effect it is wired to.' : 'Scales every effect control it is wired to.') + PICK_TIP },
  dot('in', t), h('span', { class: 'nm' }, d.label), slider(t, 0, d.kind === 'mult' ? 2 : 1, 0.01), val,
  d.kind === 'abs' ? onSwitch(d.id, d.label) : h('span'), h('span', { class: 'fan', title: `Moves ${n} effect control${n === 1 ? '' : 's'}` }, n ? '→ ' + n : ''), dot('out', t)));
  el.upd = () => { val.textContent = fmt(S.macros[d.id].v); };
  return el;
}
// A colour macro folds to one line: its swatch. Open, it shows a slider for each component, HSV or RGB, each one
// a target of its own. Folded, a wire dropped on it opens it.
function colorGroup(d) {
  const m = S.macros[d.id], t = 'm:' + d.id, open = ui.open.has(d.id), n = fanOf(d.id);
  const sw = h('i', { class: 'csw' }); sw.style.background = cssRgb(hsvRgb(m.h, m.s, m.v));
  const mode = open ? h('span', { class: 'seg mini' }, ['hsv', 'rgb'].map(x => h('button', { type: 'button', class: m.mode === x ? 'on' : '', title: x === 'hsv' ? 'Hue, saturation and value' : 'Red, green and blue', onclick: () => op('setMode', d.id, x) }, x.toUpperCase())))
    : h('span', { class: 'k' }, m.mode.toUpperCase());
  const head = h('div', { class: 'mac grp' + macClass(d, m), 'data-mac': d.id, 'data-fold': t, onmouseenter: () => hoverMac(d.id), onmouseleave: () => hoverMac(null), onclick: pickMac(d.id), title: d.label + '.' + PICK_TIP },
    h('span', { class: 'port in alias', 'data-alias': t, title: 'Open it to wire a control to a part of the colour' }),
    chev(d.id, d.label), sw, h('span', { class: 'nm' }, d.label), mode, onSwitch(d.id, d.label), h('span', { class: 'fan' }, n ? '→ ' + n : ''), dot('out', t));
  head.upd = () => { const c = S.macros[d.id]; sw.style.background = cssRgb(hsvRgb(c.h, c.s, c.v)); };
  const subs = open ? COMPONENTS[m.mode].map(([k, name], i) => {
    const tc = `${t}.${i}`, val = h('span', { class: 'vv' });
    const row = target(tc, h('div', { class: 'mac sub' }, dot('in', tc), h('span', { class: 'nm' }, name), slider(tc, 0, k === 'h' ? 360 : 1, k === 'h' ? 1 : 0.01), val));
    row.upd = () => { const v = valueOf(tc); val.textContent = k === 'h' ? Math.round(v) + '°' : pct(v); };
    row.upd();
    return row;
  }) : [];
  return h('div', { class: 'group' + (open ? ' open' : '') }, head, ...subs);
}
// A zone folds to its level. Open: its scenes and its next scene (a press plays them), and its playlists (a press
// plays or stops one), for pads and buttons.
function zoneGroup(z) {
  const id = 'zone:' + z.id, open = ui.open.has(id), lv = 'z:' + z.id, val = h('span', { class: 'vv' }, pct(z.opacity));
  const head = target(lv, h('div', { class: 'mac grp zone', 'data-fold': id },
    dot('in', lv), chev(id, z.name), h('span', { class: 'ztag', style: { borderColor: z.tag } }), h('span', { class: 'nm', title: z.name + ' level' }, z.name), slider(lv, 0, 1, 0.01), val));
  head.upd = () => { val.textContent = pct(shim.zone(z.id).opacity); };
  if (!open) return h('div', { class: 'group' }, head);
  const btn = (t, on, label, onLabel) => h('button', { class: 'btn sm' + (on ? ' live' : ''), type: 'button', onclick: () => op('set', t, on && t.startsWith('pl:') ? 0 : 1) }, on ? onLabel : label);
  const rows = [];
  z.scenes.forEach((sc, i) => {
    const t = `sc:${z.id}:${i + 1}`, on = z.scene === i && !z.play;
    rows.push(target(t, h('div', { class: 'mac sub btnrow' + (z.scene === i ? ' cur' : '') }, dot('in', t), h('span', { class: 'nm' }, sc.name), h('span', { class: 'k' }, 'scene ' + (i + 1)), btn(t, on, 'Play', 'Playing'))));
  });
  const nx = 'nx:' + z.id;
  rows.push(target(nx, h('div', { class: 'mac sub btnrow' }, dot('in', nx), h('span', { class: 'nm' }, 'Next scene'), h('span', { class: 'k' }), btn(nx, false, 'Next'))));
  z.playlists.forEach((pl, i) => {
    const t = `pl:${z.id}:${i + 1}`, on = !!(z.play && z.play.pl === i);
    rows.push(target(t, h('div', { class: 'mac sub btnrow pl' }, dot('in', t), h('span', { class: 'nm' }, icon('playlist'), pl.name), h('span', { class: 'k' }, on ? `step ${z.play.step + 1} of ${pl.steps}` : pl.steps + ' steps'), btn(t, on, 'Play', 'Stop'))));
  });
  return h('div', { class: 'group open' }, head, ...rows);
}
function renderMacros() {
  const rows = MACROS.map(d => d.kind === 'color' ? colorGroup(d) : macroRow(d));
  rows.push(h('h4', { class: 'colsub' }, 'Output'));
  const mv = h('span', { class: 'vv' }, pct(S.master)), master = target('master', h('div', { class: 'mac' }, dot('in', 'master'), h('span', { class: 'nm' }, 'Master'), slider('master', 0, 1, 0.01), mv));
  master.upd = () => { mv.textContent = pct(S.master); };
  rows.push(master);
  rows.push(target('blackout', h('div', { class: 'mac btnrow' }, dot('in', 'blackout'), h('span', { class: 'nm' }, 'Blackout'), h('span', { class: 'k' }),
    h('button', { class: 'btn sm' + (S.blackout ? ' bo-on' : ''), type: 'button', onclick: () => op('set', 'blackout', S.blackout ? 0 : 1) }, S.blackout ? 'On' : 'Off'))));
  rows.push(h('h4', { class: 'colsub' }, 'Zones · scenes and playlists'));
  for (const z of S.zones) rows.push(zoneGroup(z));
  $('#colMac').replaceChildren(...rows);
}

/* ---------- effects ---------- */
function renderEffects() {
  const cards = S.effects.map(f => {
    const linked = p => p.macros.length || wiresTo(p.key).length;
    const all = ui.showAll.has(f.src), shown = f.params.filter(p => all || linked(p)), hidden = f.params.length - shown.length;
    return h('div', { class: 'fxc', 'data-fx': f.src },
      h('div', { class: 'fxh' }, h('b', null, f.name), h('small', null, f.where.join(', '))),
      ...shown.map(p => {
        const val = p.type === 'color' ? h('i', { class: 'csw' }) : h('span', { class: 'vv' });
        const row = target(p.key, h('div', { class: 'par' + (linked(p) ? '' : ' loose') + (p.macros.includes(ui.pickMac) ? ' lit' : ''), onmouseenter: () => hoverPar(p.key), onmouseleave: () => hoverPar(null) },
          dot('in', p.key), h('span', { class: 'nm', title: p.label }, p.label), ...p.macros.map(id => h('span', { class: 'mk', title: `Follows ${macroDef(id).label}` }, macroDef(id).label)), h('span', { class: 'fill' }), val));
        row.upd = q => { if (q.type === 'color') val.style.background = cssRgb(q.value); else val.textContent = q.type === 'level' ? pct(q.value) : TI(q.key).fmt(q.value); };
        row.upd(p);
        return row;
      }),
      hidden || all ? h('button', { class: 'more', type: 'button', onclick: () => { if (all) ui.showAll.delete(f.src); else ui.showAll.add(f.src); render(true); } }, all ? 'Show the linked ones' : `${hidden} more`) : null);
  });
  $('#colFx').replaceChildren(...cards);
}
// A macro's wires show while it, or an effect control it reaches, is under the pointer (or one is picked)
function hoverMac(id) { if (ui.hoverMac === id) return; ui.hoverMac = id; drawWires(); }
function hoverPar(k) { if (ui.hoverPar === k) return; ui.hoverPar = k; drawWires(); }
// Bring a target into view: open its group or its effect's hidden controls, scroll to it, and flash it
function reveal(t) {
  if (t.startsWith('m:color')) ui.open.add(t.slice(2).split('.')[0]);
  const zp = t.split(':');
  if (['sc', 'nx', 'pl'].includes(zp[0])) ui.open.add('zone:' + zp[1]);
  if (t.startsWith('p:')) ui.showAll.add(zp[1]);
  render(true);
  const el = $(`#patch [data-target="${CSS.escape(t)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* ---------- wires ---------- */
// Every wire: the ones from the controls, and each macro's links to the effect controls it moves
function allWires() {
  const out = S.wires.map(w => ({ id: 'w:' + w.id, from: 'k:' + w.key, to: w.to, kind: 'ctl', w }));
  for (const f of S.effects) for (const p of f.params) for (const m of p.macros) out.push({ id: `l:${m}|${p.key}`, from: 'm:' + m, to: p.key, kind: 'mac', m, p: p.key });
  return out;
}
// Where a dot is, in the patch bay. A dot scrolled out of its column stops at the column's edge (edge).
function portXY(el, box) {
  const r = el.getBoundingClientRect(), col = el.closest('.pscroll').getBoundingClientRect();
  const y = r.top + r.height / 2, cy = clamp(y, col.top + 4, col.bottom - 4);
  return { x: r.left + r.width / 2 - box.left, y: cy - box.top, edge: cy !== y };
}
// The dot a wire goes to; in a folded group, the group's own dot (folded)
function inXY(t, box) {
  const el = $(`#patch [data-in="${CSS.escape(t)}"]`);
  if (el) return portXY(el, box);
  const zp = t.split(':');
  const alias = t.startsWith('m:color') ? $(`#patch [data-alias="${CSS.escape(t.split('.')[0])}"]`)
    : ['sc', 'nx', 'pl'].includes(zp[0]) ? $(`#patch [data-fold="zone:${CSS.escape(zp[1])}"] .port.in`) : null;
  return alias ? Object.assign(portXY(alias, box), { folded: true }) : null;
}
const curve = (a, b) => { const dx = Math.max(30, (b.x - a.x) * 0.5); return `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`; };
// A wire with an end scrolled out of its column: a short stub at the end that shows, turned the way the other is
function stub(a, b) {
  if (b.edge) { const dy = b.y < a.y ? -8 : 8; return { d: `M${a.x} ${a.y} H${a.x + 16} V${a.y + dy} M${a.x + 13} ${a.y + dy - Math.sign(dy) * 3} L${a.x + 16} ${a.y + dy} L${a.x + 19} ${a.y + dy - Math.sign(dy) * 3}`, mid: { x: a.x + 16, y: a.y } }; }
  const dy = a.y < b.y ? -8 : 8;
  return { d: `M${b.x - 16} ${b.y + dy} V${b.y} H${b.x}`, mid: { x: b.x - 16, y: b.y } };
}
function drawWires() {
  if (!S) return;
  const svg = $('#wires'), box = $('#patch').getBoundingClientRect(), paths = [];
  let mid = null;
  for (const w of allWires()) {
    const sel = ui.sel === w.id;
    if (w.kind === 'mac' && ui.hoverMac !== w.m && ui.pickMac !== w.m && ui.hoverPar !== w.p && !sel) continue;
    const ao = $(`#patch [data-out="${CSS.escape(w.from)}"]`), a = ao && portXY(ao, box), b = inXY(w.to, box);
    if (!a || !b || (a.edge && b.edge)) continue;
    const st = (a.edge || b.edge) && stub(a, b), d = st ? st.d : curve(a, b), hot = w.kind === 'ctl' && performance.now() - (w.w._hit || 0) < 250;
    const cls = ['wire', w.kind, sel && 'sel', hot && 'hot', st && 'edge', b.folded && 'folded'].filter(Boolean).join(' ');
    paths.push(`<path class="hit" data-wid="${w.id}" d="${d}"/><path class="${cls}" d="${d}"/>`);
    if (sel) mid = st ? st.mid : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (ui.drag && ui.drag.a) paths.push(`<path class="wire drag" d="${curve(ui.drag.a, ui.drag.b)}"/>`);
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = paths.join('');
  const pop = $('#wpop');
  if (!mid) { if (ui.sel && !ui.drag) { ui.sel = null; } pop.hidden = true; return; }
  if (pop.hidden) renderPop();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = clamp(mid.x - pw / 2, 6, box.width - pw - 6) + 'px';
  pop.style.top = clamp(mid.y + 12, 6, box.height - ph - 6) + 'px';
}
// The picked wire's settings, under its middle: pickup or jump for a fader, toggle or hold for a button
function renderPop() {
  const pop = $('#wpop'), id = ui.sel;
  if (!id) { pop.hidden = true; return; }
  const rm = h('button', { class: 'btn sm danger-t', type: 'button', onclick: () => removeWire(id) }, icon('trash'), 'Remove');
  let body;
  if (id.startsWith('w:')) {
    const w = S.wires.find(x => x.id === id.slice(2));
    if (!w) { ui.sel = null; pop.hidden = true; return; }
    const seg = (key, opts) => h('span', { class: 'seg mini' }, opts.map(([v, label, tip]) => h('button', { type: 'button', class: w[key] === v ? 'on' : '', title: tip, onclick: () => op('setWire', w.id, { [key]: v }) }, label)));
    const how = w.kind === 'fader' ? seg('takeover', [['pickup', 'Pickup', 'It follows once the fader reaches it'], ['jump', 'Jump', 'It goes where the fader is at once']])
      : w.kind === 'toggle' ? seg('mode', [['toggle', 'Toggle', 'Each press turns it on or off'], ['hold', 'Hold', 'On while held']])
        : h('span', { class: 'muted' }, 'A press plays it');
    body = [h('div', { class: 'wph' }, h('b', { class: 'mono' }, keyLabel(w.key)), ' → ', w.label), h('div', { class: 'wpr' }, how, h('span', { class: 'fill' }), rm)];
  } else {
    const [m, pk] = id.slice(2).split('|');
    body = [h('div', { class: 'wph' }, h('b', null, macroDef(m).label), ' → ', TI(pk).label), h('div', { class: 'wpr' }, h('span', { class: 'muted' }, 'It follows the macro'), h('span', { class: 'fill' }), rm)];
  }
  pop.replaceChildren(...body);
  pop.hidden = false;
}
function select(id) { ui.sel = id; renderPop(); drawWires(); }
function removeWire(id) {
  if (!id) return;
  if (id.startsWith('w:')) op('disconnect', id.slice(2));
  else { const [m, pk] = id.slice(2).split('|'); op('linkMacro', m, pk, false); }
  select(null);
}
// Dragging a wire: from a dot to a dot, either way round
function connectPorts(a, b) {
  const alias = a.dataset.alias || b.dataset.alias;
  if (alias) {
    ui.open.add(alias.slice(2)); render(true);
    toast('Now drop it on a part of the colour.');
    return;
  }
  const [out, inn] = a.dataset.out ? [a.dataset.out, b.dataset.in] : [b.dataset.out, a.dataset.in];
  if (!out || !inn) return;
  if (out.startsWith('k:')) { op('connect', out.slice(2), inn); return; }
  const m = out.slice(2), d = macroDef(m);
  if (!inn.startsWith('p:')) { toast('A macro wires to the controls of the effects.', 'warn'); return; }
  const p = S.effects.flatMap(f => f.params).find(x => x.key === inn);
  if (!p) return;
  if ((d.kind === 'color') !== (p.type === 'color')) { toast(d.kind === 'color' ? `${d.label} goes to a colour.` : `${d.label} goes to a number, not a colour.`, 'warn'); return; }
  if ((m === 'intensity') !== (p.type === 'level')) { toast(m === 'intensity' ? 'Intensity goes to the level of an effect.' : `${d.label} goes to a control, not a level.`, 'warn'); return; }
  op('linkMacro', m, inn, true);
}
function initWires() {
  const patch = $('#patch');
  patch.addEventListener('pointerdown', e => {
    const port = e.target.closest('.port');
    if (!port || port.classList.contains('alias')) return;
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
  $('#wires').addEventListener('click', e => { e.stopPropagation(); const p = e.target.closest('[data-wid]'); select(p ? p.dataset.wid : null); });
  $('#wires').addEventListener('dblclick', e => { const p = e.target.closest('[data-wid]'); if (p) removeWire(p.dataset.wid); });
  patch.addEventListener('click', e => { if (!e.target.closest('#wires, #wpop') && ui.sel) select(null); });
  for (const c of $$('.pscroll')) c.addEventListener('scroll', () => drawWires(), { passive: true });
  addEventListener('resize', () => drawWires());
}

/* ---------- devices, monitor ---------- */
function renderDevices() {
  const d = S.devices;
  const note = { checking: 'Looking for MIDI ports…', none: 'This browser has no Web MIDI: try the virtual controller below. Chrome, Edge and the app have it.',
    blocked: 'MIDI access was refused: try the virtual controller below.', empty: 'No MIDI ports yet: plug one in and it shows here.', ok: 'Plug a controller in or out at any time: it is found again by its name.' }[d.webmidi];
  $('#devices').replaceChildren(h('div', { class: 'devsec' }, h('h3', null, 'MIDI in'),
    ...d.inputs.map(x => h('div', { class: 'dev' + (x.state === 'connected' ? '' : ' gone') },
      h('span', { class: 'led', 'data-led': x.name }), h('span', { class: 'nm', title: x.name }, x.name, x.virtual ? h('small', null, 'on screen, below') : x.state !== 'connected' ? h('small', null, 'unplugged') : null),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: x.on, 'aria-label': x.name + ' on', onchange: e => op('setPort', x.name, e.target.checked) })))),
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
// The monitor folds to a thin strip on the right (kept for next time); the patch bay takes the room
function foldMonitor(shut) {
  ui.monShut = shut;
  $('#mw').classList.toggle('monshut', shut);
  const b = $('#monFold');
  b.setAttribute('aria-expanded', String(!shut)); b.title = shut ? 'Show the monitor' : 'Fold the monitor'; b.setAttribute('aria-label', b.title);
  $('#monitor').title = shut ? 'Show the monitor' : '';
  save('monitor', shut ? 'shut' : 'open');
  requestAnimationFrame(drawWires);
}

/* ---------- the order of the controls ---------- */
// Drag a control up or down its list (anywhere but its dot and its buttons): a line shows where it goes. The list
// scrolls when the pointer nears its top or bottom.
function initReorder() {
  const col = $('#colCtl'), line = h('i', { class: 'dropline', hidden: true });
  const place = y => {
    const m = ui.move, rows = $$('.ctl', col).filter(r => r !== m.row);
    m.before = rows.find(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; }) || null;
    const last = rows[rows.length - 1], at = m.before ? m.before.offsetTop - 3 : last ? last.offsetTop + last.offsetHeight + 1 : 0;
    line.style.top = at + 'px'; line.hidden = false;
  };
  col.addEventListener('pointerdown', e => {
    const row = e.target.closest('.ctl');
    if (!row || e.button !== 0 || e.target.closest('.port, button')) return;
    ui.move = { row, key: row.dataset.key, y0: e.clientY, s0: col.scrollTop, on: false, id: e.pointerId, before: null };
  });
  col.addEventListener('pointermove', e => {
    const m = ui.move;
    if (!m) return;
    if (!m.on) {
      if (Math.abs(e.clientY - m.y0) < 5) return;
      m.on = true; col.setPointerCapture(m.id); m.row.classList.add('lifted'); col.classList.add('sorting');
      if (!line.isConnected) col.append(line);
    }
    const r = col.getBoundingClientRect();
    if (e.clientY < r.top + 28) col.scrollTop -= 8; else if (e.clientY > r.bottom - 28) col.scrollTop += 8;
    m.row.style.transform = `translateY(${e.clientY - m.y0 + col.scrollTop - m.s0}px)`;
    place(e.clientY);
    drawWires();
  });
  const end = () => {
    const m = ui.move;
    ui.move = null;
    if (!m || !m.on) return;
    m.row.classList.remove('lifted'); m.row.style.transform = ''; col.classList.remove('sorting'); line.hidden = true;
    const next = m.row.nextElementSibling, before = m.before ? m.before.dataset.key : null;
    // dropped where it was: nothing to do
    if ((m.before || null) === (next && next.classList.contains('ctl') ? next : null)) { drawWires(); return; }
    op('moveControl', m.key, before);
  };
  col.addEventListener('pointerup', end);
  col.addEventListener('pointercancel', end);
}

/* ---------- the virtual controller ---------- */
// A MIDI port on screen, for trying this without hardware: 8 faders (CC 21 to 28) and 8 pads (notes 36 to 43). Keys
// 1 to 8 play the pads.
const VF = [21, 22, 23, 24, 25, 26, 27, 28], VP = [36, 37, 38, 39, 40, 41, 42, 43], vf = new Map(VF.map(n => [n, 0]));
const vkey = (type, n) => `midi:${VIRTUAL}:1:${type}:${n}`;
const vupd = [], vpads = [];
const vtargets = key => (S ? S.wires.filter(w => w.key === key).map(w => w.label).join(', ') : '') || '—';
function sendCC(n, v) { v = clamp(Math.round(v), 0, 127); if (v === vf.get(n)) return; vf.set(n, v); op('input', { port: VIRTUAL, ch: 1, type: 'cc', num: n, val: v }); for (const f of vupd) f(); }
function renderVC() {
  vupd.length = 0; vpads.length = 0;
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
      tg.textContent = vtargets(vkey('cc', n)); tg.title = tg.textContent;
    });
    return h('div', { class: 'vf' }, v, track, h('span', { class: 'nm' }, 'F' + (i + 1)), tg);
  });
  const pads = VP.map((n, i) => {
    const tg = h('span', { class: 'tg' });
    const el = h('button', { class: 'vpad', type: 'button', 'aria-label': `Pad ${i + 1}, note ${n}` }, h('span', { class: 'nm' }, 'P' + (i + 1)), tg);
    el.press = on => { if (el.classList.contains('down') === on) return; el.classList.toggle('down', on); op('input', { port: VIRTUAL, ch: 1, type: on ? 'on' : 'off', num: n, val: on ? 100 : 0 }); };
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.press(true); });
    el.addEventListener('pointerup', () => el.press(false));
    el.addEventListener('pointercancel', () => el.press(false));
    vupd.push(() => { tg.textContent = vtargets(vkey('note', n)); tg.title = tg.textContent; });
    vpads.push(el);
    return el;
  });
  $('#vc').classList.toggle('shut', ui.vcShut);
  $('#vc').replaceChildren(h('div', { class: 'vchead' }, h('h2', null, 'Virtual controller'), h('span', { class: 'meta' }, 'for trying it without hardware · faders CC 21–28 · pads notes 36–43, keys 1–8'), h('span', { class: 'fill' }),
    h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { ui.vcShut = !ui.vcShut; renderVC(); for (const f of vupd) f(); requestAnimationFrame(drawWires); } }, ui.vcShut ? 'Show ▴' : 'Hide ▾')),
  h('div', { class: 'vcbody' }, h('div', { class: 'vfaders' }, faders), h('div', { class: 'vpads' }, pads)));
}

/* ---------- state ---------- */
let sig = '';
function render(force = false) {
  if (!S) return;
  const n = JSON.stringify([S.controls.map(c => [c.key, c.offline]), S.wires.map(w => [w.id, w.key, w.to, w.takeover, w.mode]), S.effects.map(f => f.params.map(p => p.macros)),
    MACROS.map(d => [S.macros[d.id].on, S.macros[d.id].mode]), [...ui.showAll], [...ui.open], S.devices, S.zones.map(z => [z.name, z.scene, z.play && [z.play.pl, z.play.step]]), S.blackout]);
  if ((n !== sig || force) && !ui.drag && !(ui.move && ui.move.on)) {
    sig = n;
    const keep = $$('.pscroll').map(c => c.scrollTop);
    sliders.length = 0;
    renderControls(); renderMacros(); renderEffects(); renderDevices();
    $$('.pscroll').forEach((c, i) => { c.scrollTop = keep[i]; });
    // the popover is built again only when the wires change, so a click on it isn't lost while a fader moves
    renderPop();
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
// Values only: the bars of the controls, the values of the macros, zones and effects
function update() {
  for (const c of S.controls) { const el = $(`.ctl[data-key="${CSS.escape(c.key)}"] .cbar`); if (el) el.style.width = c.last == null ? '0' : c.last * 100 + '%'; }
  for (const el of $$('#colMac .mac')) if (el.upd) el.upd();
  for (const f of S.effects) for (const p of f.params) { const el = $(`.par[data-target="${CSS.escape(p.key)}"]`); if (el) el.upd(p); }
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
$('#monFold').append(icon('chev'));
$('#monFold').addEventListener('click', e => { e.stopPropagation(); foldMonitor(!ui.monShut); });
$('#monitor').addEventListener('click', () => { if (ui.monShut) foldMonitor(false); });
foldMonitor(saved('monitor') === 'shut');
addEventListener('keydown', e => {
  if (typingIn(e.target)) return;
  const pad = /^[1-8]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && vpads[+e.key - 1];
  if (pad) { e.preventDefault(); if (!e.repeat) pad.press(true); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sel) { e.preventDefault(); removeWire(ui.sel); }
  else if (e.key === 'Escape') { if (ui.sel) select(null); else if (ui.pickMac) { ui.pickMac = null; render(true); } else if (S && S.learn.on) op('setLearn', false); }
  else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey && S) op('setLearn', !S.learn.on);
});
addEventListener('keyup', e => { const pad = /^[1-8]$/.test(e.key) && vpads[+e.key - 1]; if (pad) pad.press(false); });
monEmpty();
initWires();
initReorder();
renderVC();
if (!E.local) setTimeout(() => { if (!S) toast('The main window does not answer: open this from its MIDI button.', 'warn'); }, 1500);
