// nouPix · js/ui-bay.js
// The patch bay: the MIDI window's second view (the list is the first; both show the same mappings). Three columns
// joined by wires: the MIDI controls; what they can drive (the output, the zones with their scenes and playlists,
// the macros); and the controls of the project's effects. A yellow wire is a mapping, from a control to what it
// drives; a blue wire joins a macro to an effect's control that follows it (shown for the macro pointed at or
// clicked, or the control pointed at). Click a wire for its settings and to remove it (or Delete). Draw a wire by
// dragging from a dot to a row, either way round. Each row moves what it drives with the mouse too, and Learn works
// here as everywhere. Drawn into the MIDI window by ui-midi.js; the engine stays in midi.js and macros.js.

// sel: the wire picked (a mapping's id, or 'l:<source>|<control>' for a macro's link); hover: a control's key or a
// target, whose wires stand out; pin: the macro clicked, whose links stay drawn; drag: a wire being drawn
const bay = { sel: null, hover: null, pin: null, drag: null };
// The groups opened: 'z:<zone>', 'fx:<source>', 'color1', 'color2' (zones and effects start folded)
const bayOpen = () => new Set(Array.isArray(ui.bayOpen) ? ui.bayOpen : []);
function bayToggle(key) {
  const s = bayOpen();
  if (s.has(key)) s.delete(key); else s.add(key);
  ui.bayOpen = [...s]; savePrefs(); updateMidiUI();
}
// The controls in the bay, as in the list: the mapped ones, and while learning the one just moved; in the user's
// order (midiKeyOrder)
function bayKeys() {
  const keys = project.midi.maps.map(w => w.key);
  if (midi.learn.on && midi.learn.pending) keys.push(midi.learn.pending);
  return midiKeyOrder(keys);
}
const baySig = () => [ui.bayOpen, bayKeys(), project.macroLinks];
// The macro a target or a hover is about: 'm:speed' and 'm:color1.0' are Speed and Color 1
const bayMac = t => (typeof t === 'string' && t.startsWith('m:') ? t.slice(2).split('.')[0] : null);
// Every effect control that follows a macro: [{ src, name, t, mac }], from the effects of the project
function bayLinks() {
  const out = [];
  for (const src of midiEffects().map(srcById).filter(Boolean)) {
    const roles = macroRolesOf(src, effectRt(src));
    for (const [name, mac] of Object.entries(roles)) out.push({ src, name, t: `p:${src.id}:${name}`, mac, id: `l:${src.id}|${name}` });
  }
  return out;
}

/* ---------- rows ---------- */
const bayDot = (dir, id) => h('span', { class: 'bdot ' + dir, ['data-' + dir]: id });
// What a target row moves it with: a slider for a fader, a button for the rest (the row is what learning picks)
function bayWidget(t, T) {
  if (T.kind === 'fader') {
    const r = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: T.get(), 'aria-label': T.label, 'data-bv': t });
    r.addEventListener('input', () => { const X = midiTarget(t); if (X) X.set(parseFloat(r.value)); updateMidiUI(); });
    r.addEventListener('change', () => commit());
    return r;
  }
  const btn = h('button', { class: 'btn sm', type: 'button', 'data-bb': t, onclick: () => { const X = midiTarget(t); if (X) X.set(X.kind === 'trigger' ? 1 : X.get() > 0.5 ? 0 : 1); updateMidiUI(); } },
    T.kind === 'trigger' ? 'Play' : T.get() > 0.5 ? 'On' : 'Off');
  return btn;
}
// A row for something a control can drive: its dot, its name, how it moves; while learning, a click picks it
function bayRow(t, label, cls = '', ...extra) {
  const T = midiTarget(t);
  if (!T) return null;
  return h('div', { class: 'brow ' + cls, 'data-midi': t, 'data-t': t, onmouseenter: () => bayHover(t), onmouseleave: () => bayHover(null) },
    bayDot('in', t), h('span', { class: 'nm', title: T.label }, label || T.label, ...extra), bayWidget(t, T));
}
// A macro's row: also a dot on its right, from which its blue wires go to the effects' controls, and how many follow
// it. Clicking its name keeps those wires drawn.
function bayMacroRow(row, mac, n) {
  if (!row) return row;
  row.dataset.mac = mac;
  row.title = `${macroDef(mac).label}: ${n} effect control${n === 1 ? '' : 's'} follow it. Click its name to keep their wires drawn; drag from its right-hand dot to an effect's control to link one more.`;
  row.querySelector('.nm').append(h('span', { class: 'fan' }, n ? '→ ' + n : ''));
  row.append(h('span', { class: 'bdot out mac', 'data-mout': mac }));
  return row;
}
// A group that folds (a zone, a colour, an effect): its head, which is also where the wires of its folded rows end
function bayGroup(key, head, rows, n) {
  const open = bayOpen().has(key);
  const fold = h('button', { class: 'mfold' + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open), 'aria-label': (open ? 'Fold ' : 'Open ') + key, onclick: e => { e.stopPropagation(); bayToggle(key); } }, icon('chev'));
  head.classList.add('bhead');
  head.dataset.group = key;
  head.insertBefore(fold, head.querySelector('.nm'));
  if (!head.querySelector('.bdot.in')) head.prepend(h('span', { class: 'bdot in alias' }));
  return h('div', { class: 'bgroup' + (open ? ' open' : ''), 'data-g': key }, head, open ? h('div', { class: 'bsub' }, rows) : n ? h('div', { class: 'bmore' }, n) : null);
}

/* ---------- the three columns ---------- */
function bayControls() {
  const keys = bayKeys(), ports = new Set(keys.map(k => midiKeyParts(k).port)), L = midi.learn;
  return h('div', { class: 'bcol bctls', onscroll: bayWires },
    h('h3', null, 'Controls'),
    keys.length ? keys.map(key => {
      const k = midiKeyParts(key), ws = project.midi.maps.filter(w => w.key === key), lost = ws.filter(w => !midiTarget(w.to)).length;
      const row = h('div', { class: 'bctl' + (L.on && L.pending === key ? ' new' : '') + (ws.length ? '' : ' loose'), 'data-key': key, onmouseenter: () => bayHover(key), onmouseleave: () => bayHover(null), title: k.port + '. Drag it to put it in another place; drag from its dot to what it should move.' },
        h('span', { class: 'pgrip', 'aria-hidden': 'true' }), h('span', { class: 'mk' }, midiKeyLabel(key)), h('small', null, `ch${k.ch}` + (ports.size > 1 ? ' · ' + k.port : '') + (lost ? ` · ${lost} missing` : '')),
        h('button', { class: 'x', type: 'button', title: ws.length ? 'Forget this control and its mappings' : 'Forget this control', 'aria-label': 'Forget ' + midiKeyFull(key), onclick: e => { e.stopPropagation(); midiForget(key); } }, icon('x')),
        h('span', { class: 'cval' }, h('i', { class: 'cbar', 'data-cbar': key })), bayDot('out', key));
      bayDrag(row, key);
      return row;
    }) : h('p', { class: 'note' }, 'Press Learn and move a control: it shows here.'));
}
// Dragging a control up or down puts it in another place (in the list view too): it follows the pointer, the others
// slide out of its way, and let go, it glides into its place. Its wires follow it.
let bayDragging = false;
function bayDrag(row, key) {
  row.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button, .bdot') || midi.learn.on) return;
    const doc = row.ownerDocument, rows = $$('.bctl', row.closest('.bcol')), from = rows.indexOf(row), y0 = e.clientY;
    const tops = rows.map(r => r.getBoundingClientRect().top), step = rows.length > 1 ? tops[1] - tops[0] : 0;
    let moved = false, to = from;
    const move = ev => {
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      if (!moved) { moved = bayDragging = true; row.classList.add('dragging'); }
      const dy = clamp(ev.clientY - y0, tops[0] - tops[from], tops[rows.length - 1] - tops[from]);
      row.style.transform = `translateY(${dy}px)`;
      to = step ? clamp(from + Math.round(dy / step), 0, rows.length - 1) : from;
      rows.forEach((r, i) => { if (r !== row) r.style.transform = from < to && i > from && i <= to ? `translateY(${-step}px)` : to < from && i >= to && i < from ? `translateY(${step}px)` : ''; });
      bayWires();
    };
    const up = () => {
      doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up);
      if (!moved) return;
      // into its place, then the new order
      row.classList.add('settling'); row.style.transform = `translateY(${(to - from) * step}px)`;
      setTimeout(() => {
        bayDragging = false;
        if (to === from) { rows.forEach(r => { r.style.transform = ''; r.classList.remove('dragging', 'settling'); }); bayWires(); return; }
        const keys = rows.map(r => r.dataset.key).filter(k => k !== key);
        keys.splice(to, 0, key);
        midiSetOrder(keys.concat(bayKeys().filter(k => !keys.includes(k))));
      }, 140);
    };
    doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up);
  });
}
function bayTargets() {
  const open = bayOpen(), rows = [h('h3', null, 'Output')], fans = {};
  for (const l of bayLinks()) fans[l.mac] = (fans[l.mac] || 0) + 1;
  rows.push(bayRow('master', 'Master'), bayRow('blackout', 'Blackout'), bayRow('xf', 'X-Fader'));
  if (project.groups.length) rows.push(h('h3', null, 'Groups'), ...project.groups.map(g => bayRow('gr:' + g.id, groupName(g) + ' dimmer')));
  rows.push(h('h3', null, 'Zones'));
  for (const z of project.zones.slice().reverse()) {
    const head = bayRow('z:' + z.id, z.name + ' level');
    const subs = z.scenes.map(sc => bayRow(`sc:${z.id}:${sc.id}`, sc.name, 'sub'))
      .concat(z.scenes.length ? [bayRow('nx:' + z.id, 'Next scene', 'sub')] : [])
      .concat(z.playlists.map(pl => bayRow(`pl:${z.id}:${pl.id}`, pl.name + ' (playlist)', 'sub')));
    rows.push(bayGroup('z:' + z.id, head, subs, open.has('z:' + z.id) ? 0 : subs.length ? `${z.scenes.length} scene${z.scenes.length === 1 ? '' : 's'}, ${z.playlists.length} playlist${z.playlists.length === 1 ? '' : 's'}` : 0));
  }
  rows.push(h('h3', null, 'Macros'));
  for (const d of MACROS) {
    // Intensity is every layer's level: no control of an effect follows it, so it has no blue wires
    if (d.kind !== 'color') { const r = bayRow('m:' + d.id, d.label); rows.push(d.id === 'intensity' ? r : bayMacroRow(r, d.id, fans[d.id] || 0)); continue; }
    const m = project.macros[d.id], sw = h('i', { class: 'bsw', 'data-sw': d.id });
    sw.style.background = toHex(macroRgb(m));
    // learnt as its first part (Hue, or Red in RGB); its parts are opened with the arrow
    const first = `m:${d.id}.0`, firstName = MACRO_PARTS[m.mode][0][1];
    const head = h('div', { class: 'brow', 'data-t': 'm:' + d.id, 'data-midi': first, title: `Learn picks its ${firstName.toLowerCase()}; open it for each part.`, onmouseenter: () => bayHover('m:' + d.id), onmouseleave: () => bayHover(null) },
      h('span', { class: 'nm' }, d.label), sw, h('span', { class: 'k' }, m.mode.toUpperCase()));
    const parts = MACRO_PARTS[m.mode].map((p, i) => bayRow(`m:${d.id}.${i}`, p[1], 'sub'));
    rows.push(bayGroup(d.id, bayMacroRow(head, d.id, fans[d.id] || 0), parts));
  }
  return h('div', { class: 'bcol btgts', onscroll: bayWires }, rows);
}
// An effect's control: a row a MIDI control can drive (with its slider or button), or a colour, which only a macro
// drives; with the macro it follows, if any
function bayFxRow(src, inp, roles) {
  const t = `p:${src.id}:${inp.NAME}`, label = inp.LABEL || inp.NAME, mac = roles[inp.NAME];
  const tag = mac ? h('span', { class: 'mtag', title: `Follows ${macroDef(mac).label}` }, macroDef(mac).label) : null;
  if (midiTarget(t)) {
    const row = bayRow(t, label, 'sub', tag), r = mac && row.querySelector('input[type=range]');
    if (r) { const wrap = h('span', { class: 'bvw' }); r.replaceWith(wrap); wrap.append(r, h('i', { class: 'bmod', 'data-bmod': t, hidden: true })); }
    return row;
  }
  return h('div', { class: 'brow sub link', 'data-t': t, onmouseenter: () => bayHover(t), onmouseleave: () => bayHover(null) },
    bayDot('in', t), h('span', { class: 'nm', title: `${src.name} · ${label}` }, label, tag), h('span', { class: 'k' }, 'colour'));
}
function bayEffects() {
  const fx = midiEffects().map(srcById).filter(Boolean), mapped = new Set(project.midi.maps.map(w => w.to));
  return h('div', { class: 'bcol bfx', onscroll: bayWires },
    h('h3', null, 'Effects'),
    fx.length ? fx.map(src => {
      const rt = effectRt(src), roles = macroRolesOf(src, rt), key = 'fx:' + src.id;
      const inps = controlsOf(src).filter(i => midiTarget(`p:${src.id}:${i.NAME}`) || macroChoices(rt, i).length);
      const n = inps.filter(i => mapped.has(`p:${src.id}:${i.NAME}`)).length;
      const head = h('div', { class: 'brow' }, h('span', { class: 'nm' }, src.name), h('span', { class: 'k' }, n ? n + ' mapped' : ''));
      // folded, its mapped controls stay out, so their wires have somewhere to go
      const open = bayOpen().has(key), shown = open ? inps : inps.filter(i => mapped.has(`p:${src.id}:${i.NAME}`));
      const g = bayGroup(key, head, inps.map(i => bayFxRow(src, i, roles)), open ? 0 : inps.length - shown.length ? `${inps.length - shown.length} more` : 0);
      if (!open && shown.length) g.insertBefore(h('div', { class: 'bsub' }, shown.map(i => bayFxRow(src, i, roles))), g.querySelector('.bmore'));
      return g;
    }) : h('p', { class: 'note' }, 'No effects yet.'));
}
function bayView() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'bwires'); svg.id = 'bayWires'; svg.setAttribute('aria-hidden', 'true');
  const el = h('div', { class: 'bay' }, bayControls(), bayTargets(), bayEffects(), svg, h('div', { class: 'bpop', id: 'bayPop', hidden: true }));
  el.addEventListener('click', e => {
    if (bay.dragged) { bay.dragged = false; return; }   // the end of a wire drawn
    const w = e.target.closest && e.target.closest('[data-wire]');
    if (w) { bay.sel = bay.sel === w.dataset.wire ? null : w.dataset.wire; bayWires(); return; }
    const mac = e.target.closest('[data-mac] > .nm');
    if (mac) { const m = mac.parentElement.dataset.mac; bay.pin = bay.pin === m ? null : m; bay.sel = null; bayWires(); return; }
    if (!e.target.closest('.bpop')) { bay.sel = null; bayWires(); }
  });
  el.addEventListener('pointerdown', bayDrawStart);
  return el;
}

/* ---------- drawing a wire ---------- */
// From a control's dot to a row it should drive; from a target's dot to a control; from a macro's dot to an effect's
// control it should drive, or from that control's dot to a macro. Let go on a row it fits, and the wire is made.
function bayDrawStart(e) {
  const dot = e.button === 0 && !midi.learn.on && e.target.closest('.bdot:not(.alias)');
  if (!dot) return;
  e.preventDefault(); e.stopPropagation();
  const D = dot.ownerDocument, from = dot.dataset.out ? { kind: 'key', id: dot.dataset.out } : dot.dataset.mout ? { kind: 'mac', id: dot.dataset.mout } : { kind: 't', id: dot.dataset.in };
  bay.drag = { from, dot, x: e.clientX, y: e.clientY, drop: null };
  bay.sel = null;
  const move = ev => { bay.drag.x = ev.clientX; bay.drag.y = ev.clientY; bay.drag.drop = bayDropAt(D, ev.clientX, ev.clientY, from); bayWires(); };
  const up = ev => {
    D.removeEventListener('pointermove', move); D.removeEventListener('pointerup', up);
    const drop = bayDropAt(D, ev.clientX, ev.clientY, from);
    bay.drag = null; bay.dragged = true;
    setTimeout(() => { bay.dragged = false; }, 0);
    if (drop && drop.ok) drop.make();
    else if (drop && drop.why) toast(drop.why, 'err');
    bayWires();
  };
  D.addEventListener('pointermove', move); D.addEventListener('pointerup', up);
  bayWires();
}
// What letting go here would do: { el, ok, make } for a row the wire fits, { el, why } for one it doesn't
function bayDropAt(D, x, y, from) {
  const el = D.elementFromPoint(x, y), ctl = el && el.closest('.bay .bctl'), row = el && el.closest('.bay .brow[data-t]'), macRow = el && el.closest('.bay [data-mac]');
  const link = (t, mac, el) => {
    const i = t.indexOf(':', 2), src = srcById(t.slice(2, i)), name = t.slice(i + 1), inp = src && controlsOf(src).find(x => x.NAME === name);
    if (!inp) return null;
    const label = `${src.name} · ${inp.LABEL || inp.NAME}`;
    if (!macroChoices(effectRt(src), inp).includes(mac)) return { el, why: `${label} can't follow ${macroDef(mac).label}.` };
    return { el, ok: true, make: () => { setMacroLink(src, name, mac); toast(`${label} follows ${macroDef(mac).label}`); } };
  };
  if (from.kind === 'key') return row && midiTarget(row.dataset.t) ? { el: row, ok: true, make: () => midiAddMap(from.id, row.dataset.t) } : null;
  if (from.kind === 'mac') return row && row.dataset.t.startsWith('p:') ? link(row.dataset.t, from.id, row) : null;
  if (ctl) return midiTarget(from.id) ? { el: ctl, ok: true, make: () => midiAddMap(ctl.dataset.key, from.id) } : { el: ctl, why: 'A MIDI control can\'t drive a colour: link it to Color 1 or Color 2.' };
  if (macRow && from.id.startsWith('p:')) return link(from.id, macRow.dataset.mac, macRow);
  return null;
}

/* ---------- wires ---------- */
function bayHover(id) { if (bay.hover === id) return; bay.hover = id; bayWires(); }
// Where a dot is, in the bay; one scrolled out of its column stops at the column's edge
function bayXY(el, box) {
  const r = el.getBoundingClientRect(), col = el.closest('.bcol').getBoundingClientRect();
  const y = r.top + r.height / 2, cy = clamp(y, col.top + 28, col.bottom - 6);
  return { x: r.left + r.width / 2 - box.left, y: cy - box.top, edge: Math.abs(cy - y) > 0.5 };
}
// The dot a wire ends at: the target's, or in a folded group the group's head (the wire is dashed then)
function bayIn(D, t) {
  const el = $(`.bay [data-in="${CSS.escape(t)}"]`, D);
  if (el) return { el };
  const groups = t.startsWith('m:color') ? [t.split('.')[0].slice(2)] : /^(sc|nx|pl):/.test(t) ? ['z:' + t.split(':')[1]] : t.startsWith('p:') ? ['fx:' + t.slice(2, t.indexOf(':', 2))] : [];
  for (const g of groups) { const head = $(`.bay [data-group="${CSS.escape(g)}"] .bdot.in`, D); if (head) return { el: head, folded: true }; }
  return null;
}
const bayCurve = (a, b) => { const dx = Math.max(40, (b.x - a.x) * 0.45); return `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`; };
function bayWires() {
  const D = midiDoc(), bayEl = D && $('.bay', D), svg = D && $('#bayWires', D);
  if (!bayEl || !svg) return;
  const box = bayEl.getBoundingClientRect(), paths = [];
  let mid = null;
  const links = bayLinks();
  if (bay.sel && !(bay.sel.startsWith('l:') ? links.some(l => l.id === bay.sel) : project.midi.maps.some(w => w.id === bay.sel))) bay.sel = null;
  // the mappings, in yellow
  for (const w of project.midi.maps) {
    const ao = $(`.bay [data-out="${CSS.escape(w.key)}"]`, D), end = bayIn(D, w.to);
    if (!ao || !end) continue;
    const a = bayXY(ao, box), b = bayXY(end.el, box);
    if (a.edge && b.edge) continue;
    const sel = bay.sel === w.id, lit = sel || bay.hover === w.key || bay.hover === w.to, heat = midiHeat(w);
    const d = bayCurve(a, b), cls = ['wire', sel && 'sel', lit && 'lit', end.folded && 'folded', (a.edge || b.edge) && 'edge', w.to.startsWith('p:') && 'fx'].filter(Boolean).join(' ');
    // while its control moves it glows, and fades out once it stops (no blinking when several move at once)
    paths.push(`<path class="hit" data-wire="${w.id}" d="${d}"/>${heat ? `<path class="glow" d="${d}" style="opacity:${heat.toFixed(2)}"/>` : ''}<path class="${cls}" d="${d}"/>`);
    if (sel) mid = { x: a.x, y: a.y, side: 'left' };   // its settings open under the control, clear of what it drives
  }
  // the macros' links, in blue: for the macro pointed at or clicked, or the effect's control pointed at
  const hm = bayMac(bay.hover), pinned = bay.pin;
  for (const l of links) {
    const sel = bay.sel === l.id;
    if (!(sel || l.mac === hm || l.mac === pinned || bay.hover === l.t)) continue;
    const ao = $(`.bay [data-mout="${CSS.escape(l.mac)}"]`, D), end = bayIn(D, l.t);
    if (!ao || !end) continue;
    const a = bayXY(ao, box), b = bayXY(end.el, box);
    if (a.edge && b.edge) continue;
    const d = bayCurve(a, b), cls = ['wire', 'link', sel && 'sel', end.folded && 'folded', (a.edge || b.edge) && 'edge'].filter(Boolean).join(' ');
    paths.push(`<path class="hit" data-wire="${l.id}" d="${d}"/><path class="${cls}" d="${d}"/>`);
    if (sel) mid = { x: b.x, y: b.y, side: 'left' };
  }
  // a wire being drawn: from its dot to the pointer, green over a row it fits
  if (bay.drag) {
    const g = bay.drag, a = bayXY(g.dot, box), b = { x: g.x - box.left, y: g.y - box.top }, rev = g.from.kind === 't';
    paths.push(`<path class="wire draw${g.drop ? (g.drop.ok ? ' ok' : ' no') : ''}" d="${rev ? bayCurve(b, a) : bayCurve(a, b)}"/>`);
  }
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = paths.join('');
  const selW = bay.sel && !bay.sel.startsWith('l:') && project.midi.maps.find(w => w.id === bay.sel), selL = bay.sel && links.find(l => l.id === bay.sel);
  for (const el of $$('.bay [data-key], .bay [data-t]', D)) {
    const id = el.dataset.key || el.dataset.t;
    el.classList.toggle('lit', bay.hover === id || (!!selW && (selW.key === id || selW.to === id)) || (!!selL && (selL.t === id || bayMac(id) === selL.mac && el.dataset.mac)));
    el.classList.toggle('pinned', !!el.dataset.mac && el.dataset.mac === pinned);
    el.classList.toggle('dropok', !!(bay.drag && bay.drag.drop && bay.drag.drop.el === el && bay.drag.drop.ok));
    el.classList.toggle('dropno', !!(bay.drag && bay.drag.drop && bay.drag.drop.el === el && !bay.drag.drop.ok));
  }
  bayPop(D, mid, box, selW, selL);
}
// The picked wire's settings, beside it: for a mapping, what it drives (a list), Pickup or Jump (Toggle, Hold or
// Follow) and Remove; for a macro's link, what that control follows, and Remove (its own value)
function bayPop(D, mid, box, w, l) {
  const pop = $('#bayPop', D);
  if ((!w && !l) || !mid) { pop.hidden = true; pop.dataset.for = ''; return; }
  const sig = w ? w.id + w.to + w.takeover + w.mode : l.id + l.mac;
  if (pop.dataset.for !== sig) {
    pop.dataset.for = sig;
    const rm = h('button', { class: 'btn sm danger-t', type: 'button', title: 'Remove this wire (Delete)', onclick: bayRemoveSel }, icon('trash'), 'Remove');
    if (w) {
      const how = midiHow(w) || h('span', { class: 'muted' }, 'Missing');
      pop.replaceChildren(h('div', { class: 'bph' }, h('b', { class: 'mono' }, midiKeyFull(w.key)), ' drives'), midiTargetSelect(w), h('div', { class: 'bpr' }, how, h('span', { class: 'fill' }), rm));
    } else {
      const inp = controlsOf(l.src).find(i => i.NAME === l.name), rt = effectRt(l.src), label = `${l.src.name} · ${inp ? inp.LABEL || inp.NAME : l.name}`;
      const sel = selectEl([['', 'Its own value'], ...(inp ? macroChoices(rt, inp) : []).map(id => [id, macroDef(id).label])], l.mac, v => { bay.sel = v ? `l:${l.src.id}|${l.name}` : null; setMacroLink(l.src, l.name, v); }, { aria: `What ${label} follows` });
      pop.replaceChildren(h('div', { class: 'bph' }, h('b', null, label), ' follows'), sel, h('div', { class: 'bpr' }, h('span', { class: 'muted' }, `For ${l.src.name} wherever it plays`), h('span', { class: 'fill' }), rm));
    }
  }
  pop.hidden = false;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = clamp(mid.x - pw + 24, 6, box.width - pw - 6) + 'px';
  pop.style.top = clamp(mid.y + 20, 6, box.height - ph - 6) + 'px';
}
// Remove the wire picked: a mapping, or a macro's link (that control keeps its own value)
function bayRemoveSel() {
  const id = bay.sel;
  if (!id) return;
  bay.sel = null;
  if (!id.startsWith('l:')) { midiDisconnect(id); return; }
  const [sid, name] = id.slice(2).split('|'), src = srcById(sid);
  if (src) setMacroLink(src, name, '');
}
// With each message: where each control is, each slider and button, and the wires (a hot one shows the control moving)
// Where its macro takes an effect's control, 0 to 1 as its slider shows it, while that macro changes it (the slider
// keeps the control's own value, which is what it sets): { x, mac }, or null
function bayEffective(t) {
  const i = t.indexOf(':', 2), src = srcById(t.slice(2, i)), name = t.slice(i + 1);
  const inp = src && src.kind === 'isf' && controlsOf(src).find(x => x.NAME === name);
  if (!inp || (inp.TYPE !== 'float' && inp.TYPE !== 'int')) return null;
  const mac = macroRolesOf(src, effectRt(src))[name];
  const L = project.zones.flatMap(z => z.layers.filter(L => L.src === src.id))[0];
  if (!mac || !macroActive(mac) || !L) return null;
  const v = paramValue(L, src, inp);
  if (mac === 'speed' || isSpeedInput(src, inp)) return { x: clamp(Math.abs(v) / speedMax(inp) * (mac === 'speed' ? project.macros.speed.v : 1), 0, 1), mac };
  const lo = inp.MIN ?? 0, hi = inp.MAX ?? 1;
  return hi > lo ? { x: clamp((macroOver(mac, inp, v) - lo) / (hi - lo), 0, 1), mac } : null;
}
function bayUpdate(D) {
  if (bayDragging || bay.drag) return;
  for (const s of $$('.bay [data-sw]', D)) s.style.background = toHex(macroRgb(project.macros[s.dataset.sw]));
  for (const m of $$('.bay [data-bmod]', D)) {
    const e = bayEffective(m.dataset.bmod);
    m.hidden = !e;
    if (e) { m.style.left = `calc(${e.x} * (100% - 12px) + 6px)`; m.title = `With ${macroDef(e.mac).label}: ${Math.round(e.x * 100)} %. The slider is its own value.`; }
  }
  for (const b of $$('.bay [data-cbar]', D)) { const c = midi.controls.get(b.dataset.cbar); b.style.width = c ? c.last * 100 + '%' : '0'; }
  for (const r of $$('.bay [data-bv]', D)) { const T = midiTarget(r.dataset.bv); if (T && D.activeElement !== r) r.value = T.get(); }
  for (const b of $$('.bay [data-bb]', D)) { const T = midiTarget(b.dataset.bb); if (T && T.kind === 'toggle') { b.textContent = T.get() > 0.5 ? 'On' : 'Off'; b.classList.toggle('on', T.get() > 0.5); } }
  bayWires();
}
