// openLedMapper · js/ui-inspector.js
// The right panel: fixture, multi-selection, group and zone inspectors, the Content tab (zones, layers,
// parameters, video controls) and Settings.

/* ---------- right panel ---------- */
function renderRight() {
  binders = []; preview = null;
  $$('#rightTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.rightTab));
  const body = $('#rightBody');
  const keep = body.scrollTop;
  body.replaceChildren();
  if (ui.rightTab === 'inspector') renderInspector(body);
  else if (ui.rightTab === 'content') renderContentTab(body);
  else renderSettings(body);
  if (mappingLocked() && ui.rightTab !== 'content') lockPanel(body);
  body.scrollTop = keep;
  replayFlip();
  updateMidiUI();
}
const geoIn = () => markGeom();
const geo = (extra = {}) => Object.assign({ onInput: geoIn, onCommit: commit }, extra);
function renderInspector(body) {
  if (ui.tool === 'zone') return renderZoneInspector(body);
  const sel = selected();
  if (!sel.length) {
    const px = project.fixtures.reduce((a, f) => a + pixelCount(f), 0);
    body.append(
      sec('Nothing selected',
        h('p', { class: 'note' }, `${project.fixtures.length} fixtures · ${fmtN(px)} pixels · ${project.controllers.length} controller${project.controllers.length === 1 ? '' : 's'}.`),
        h('p', { class: 'note' }, 'Click a fixture on the stage or in the list to edit it. Drag fixtures from the list onto a controller output in the Patch panel to address them.')),
      sec('Shortcuts', h('div', { class: 'note', html:
        '<code>V</code> select · <code>L</code> line · <code>M</code> matrix · <code>C</code> circle · <code>P</code> path · <code>N</code> pen<br>' +
        '<code>Space</code>-drag or right-drag to pan · wheel to zoom · <code>F</code> fit<br>' +
        '<code>Alt</code> while dragging turns snapping off · <code>Shift</code> constrains<br>' +
        '<code>Ctrl C</code> / <code>Ctrl X</code> / <code>Ctrl V</code> copy, cut, paste fixtures (also into another project) · <code>Ctrl D</code> duplicate · <code>Del</code> delete · arrows nudge (<code>Shift</code> ×10) · <code>R</code> / <code>Shift R</code> rotate 90°<br>' +
        'Right-click anything for its options: patch to an output, paste here, delete a zone or a scene…<br>' +
        '<code>H</code> hides this panel · <code>Ctrl G</code> group · <code>Ctrl Shift G</code> ungroup · <code>Ctrl L</code> lock or unlock · double-click a fixture of a group to select just it<br>' +
        '<code>Ctrl Z</code> undo · <code>Ctrl S</code> save · <code>B</code> blackout · <code>I</code> highlight on/off (💡 in the top bar picks the mode)<br>' +
        '<code>Z</code> zones · <code>1</code>–<code>9</code> scenes of the selected zone (<code>Shift</code> cuts)<br>' +
        'Double-click a slider\'s value to type one · <code>Shift</code> + scroll over a slider or a number to step it' })));
    return;
  }
  if (sel.length > 1) return renderMulti(body, sel);
  const f = sel[0], alone = f.group != null && groupById(f.group);
  if (alone && project.fixtures.filter(x => x.group === f.group).length === 1) body.append(groupSection(alone, [f]));   // a group of one
  const nameIn = textInput(f, 'name', { id: 'fxName', aria: 'Fixture name', onInput: () => renderFxList(), onCommit: commit });
  const sw = tagSwatches(f, 'Tag colour');
  body.append(sec(null,
    h('h3', null, h('span', { class: 'ty', style: { display: 'flex', color: 'var(--text2)' } }, icon(f.type)), isOval(f) ? 'Oval' : TYPE_LABEL[f.type], h('span', { class: 'fill' }), h('span', { class: 'mono muted', style: { letterSpacing: 0, textTransform: 'none' } }, pixelCount(f) + ' px')),
    row('Name', nameIn), row('Tag', sw),
    project.groups.length ? row('Group', selectEl([['', 'None'], ...project.groups.map(g => [g.id, groupName(g)])], f.group ?? '', v => setFixtureGroup(f, v), { aria: 'Group' })) : null,
    h('div', { style: { display: 'flex', gap: '16px' } }, checkRow('Enabled', f, 'enabled', () => { commit(); }), checkRow('Locked', f, 'locked', () => { commit(); renderRight(); }))));
  body.append(arrangeSection([f]));

  const G = [];
  if (f.type === 'line') {
    G.push(row('Start', numInput(f, 'x1', geo({ prefix: 'X' })), numInput(f, 'y1', geo({ prefix: 'Y' }))));
    G.push(row('End', numInput(f, 'x2', geo({ prefix: 'X' })), numInput(f, 'y2', geo({ prefix: 'Y' }))));
  } else if (f.type === 'circle') {
    G.push(row('Centre', numInput(f, 'cx', geo({ prefix: 'X' })), numInput(f, 'cy', geo({ prefix: 'Y' }))));
    const oval = isOval(f), R = { get ry() { return ryOf(f); }, set ry(v) { f.ry = v; } };
    const live = () => { markGeom(); syncInspector(); };   // a circle's Y follows its X
    G.push(row('Radius', numInput(f, 'r', geo({ prefix: 'X', min: 1, step: 0.5, aria: 'Horizontal radius', onInput: live })),
      numInput(R, 'ry', geo({ prefix: 'Y', min: 1, step: 0.5, aria: 'Vertical radius', onInput: live, onCommit: () => { commit(); renderRight(); } }))));
    if (oval) G.push(numRow('Rotation °', f, 'rot', geo({ min: -180, max: 180, step: 1 })));
    G.push(oval ? h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => { f.start = numOr(f.start, 0) + numOr(f.rot, 0); delete f.rot; delete f.ry; markGeom(); commit(); renderRight(); } }, 'Make it round'))
      : h('p', { class: 'note' }, 'Give Y a different value, or drag a side handle of its frame on the stage, to stretch it into an oval.'));
    G.push(numRow('Start °', f, 'start', geo({ min: -360, max: 360, step: 1 })));
    G.push(numRow('Sweep °', f, 'sweep', geo({ min: 1, max: 360, step: 1 })));
    G.push(row('Direction', seg([[false, 'Clockwise'], [true, 'Counter-CW']], f.ccw, v => { f.ccw = v === true || v === 'true'; markGeom(); commit(); })));
  } else if (f.type === 'matrix') {
    G.push(row('Centre', numInput(f, 'cx', geo({ prefix: 'X' })), numInput(f, 'cy', geo({ prefix: 'Y' }))));
    G.push(row('Size', numInput(f, 'w', geo({ prefix: 'W', min: 1 })), numInput(f, 'h', geo({ prefix: 'H', min: 1 }))));
    G.push(numRow('Rotation °', f, 'rot', geo({ min: -180, max: 180, step: 1 })));
    G.push(row('Pixels', numInput(f, 'cols', geo({ prefix: 'C', int: true, min: 1, max: 1024, aria: 'Columns' })), numInput(f, 'rows', geo({ prefix: 'R', int: true, min: 1, max: 1024, aria: 'Rows' }))));
    const wiring = h('div', { class: 'wiring' }, ['TL', 'TR', 'BL', 'BR'].map(k => h('button', { type: 'button', class: f.start === k ? 'on' : '', title: 'First pixel ' + { TL: 'top-left', TR: 'top-right', BL: 'bottom-left', BR: 'bottom-right' }[k], onclick: () => { f.start = k; markGeom(); commit(); renderRight(); } }, k)));
    G.push(row('First pixel', wiring));
    G.push(row('Runs along', seg([['H', 'Rows'], ['V', 'Columns']], f.dir, v => { f.dir = v; markGeom(); commit(); })));
    G.push(checkRow('Zigzag (snake) wiring', f, 'snake', () => { markGeom(); commit(); }));
  } else if (f.type === 'path') {
    G.push(row('Shape', h('span', { class: 'readonly' }, `${f.pts.length / 2} points${f.ctl ? ', curved' : ''} · drag them on the stage`)));
    G.push(h('p', { class: 'note' }, 'Double-click a point on the stage to make it smooth (with handles) or a corner. Drag a handle to shape the curve; hold Alt to move it on its own.'));
    G.push(checkRow('Closed loop', f, 'closed', () => { markGeom(); commit(); }));
  }
  const lenTxt = h('span', { class: 'readonly' });
  const upd = () => { lenTxt.textContent = f.type === 'matrix' ? `${f.cols} × ${f.rows} · pitch ${fmtV(fixturePitch(f))}` : `length ${fmtV(fixtureLength(f))} · pitch ${fmtV(fixturePitch(f))}`; };
  upd(); binders.push(upd);
  G.push(row('Measure', lenTxt));
  body.append(sec('Geometry', G));

  const P = [];
  if (f.type !== 'matrix') P.push(numRow('Pixels', f, 'pixels', geo({ int: true, min: 1, max: 20000 })));
  P.push(row('Color order', selectEl(ORDERS.map(o => [o, o + (o.length === 4 ? '  (RGBW)' : o === 'W' ? '  (mono)' : '')]), f.order, v => { f.order = v; markPatch(); commit(); renderRight(); }, { aria: 'Color order' })));
  P.push(...trimRows([f]));
  P.push(...dimmingRows([f]));
  if (f.type !== 'matrix') P.push(checkRow('Reverse direction', f, 'reverse', () => { markGeom(); commit(); }));
  P.push(sliderRow('Dimmer', f, 'dimmer', { min: 0, max: 1, step: 0.01, fmt: pct, onCommit: commit }));
  body.append(sec('Pixels', P));

  body.append(outputSection([f]));
  body.append(sec(null, selectionActions()));
}
// Red, green and blue trims (and white, for colour orders with W) scale that colour of the fixture's output, to
// match fixtures that look different. With several fixtures, moving a slider sets it for all of them.
// Gamma suits the LED type: about 2.2 to 2.8 for most addressable pixels, 1 for none. With several fixtures the
// slider sets it for all of them.
// onChange runs as it moves (the curve graph follows it).
function gammaRow(list, onChange) {
  const one = list.length === 1, tmp = { gamma: list[0].gamma }, mixed = !one && list.some(f => f.gamma !== list[0].gamma);
  return sliderRow('Gamma', one ? list[0] : tmp, 'gamma', { min: 1, max: 3, step: 0.05, fmt: v => v.toFixed(2) + (mixed && v === list[0].gamma ? ' (mixed)' : ''),
    onInput: v => { if (!one) list.forEach(f => { f.gamma = v; }); if (onChange) onChange(v); }, onCommit: commit });
}
// The strength of a square law, inverse square or S curve: 100 % the classic curve, 0 % a straight line, up to 200 %
// stronger. Like gamma, it sets all the fixtures in the list, and onChange runs as it moves.
function strengthRow(list, onChange) {
  const one = list.length === 1, tmp = { strength: list[0].strength }, mixed = !one && list.some(f => f.strength !== list[0].strength);
  return sliderRow('Strength', one ? list[0] : tmp, 'strength', { min: 0, max: 2, step: 0.01, fmt: v => pct(v) + (mixed && v === list[0].strength ? ' (mixed)' : ''),
    onInput: v => { if (!one) list.forEach(f => { f.strength = v; }); if (onChange) onChange(v); }, onCommit: commit });
}
// Resolution and dimming curve. An 8-bit fixture has one channel per colour and uses gamma; a 16-bit one has two
// (coarse, then fine) and can use the other curves too. With one fixture, a graph shows its curve.
function dimmingRows(list) {
  const one = list.length === 1, f = list[0], all16 = list.every(x => x.bits === 16);
  const bitsMixed = list.some(x => fxBits(x) !== fxBits(f)), curveMixed = list.some(x => fxCurve(x) !== fxCurve(f));
  const out = [row('Resolution', seg([[8, '8-bit'], [16, '16-bit']], bitsMixed ? '' : fxBits(f), v => { list.forEach(x => { x.bits = +v; }); markPatch(); commit(); renderRight(); }))];
  const per = BPP(f);
  out.push(h('p', { class: 'note' }, bitsMixed ? 'Mixed: some are 8-bit, some 16-bit.'
    : fxBits(f) === 16 ? `${per} channels per pixel: each colour has a coarse channel and then its fine one. Only for fixtures and controllers that take 16-bit colour.`
      : `${per} channel${per === 1 ? '' : 's'} per pixel, one per colour.`));
  const curve = selectEl([...(curveMixed ? [['', 'Mixed / keep']] : []), ...CURVES], curveMixed ? '' : fxCurve(f),
    v => { if (!v) return; list.forEach(x => { x.curve = v; }); commit(); renderRight(); }, { aria: 'Dimming curve' });
  if (!all16) { curve.disabled = true; curve.title = 'Gamma only: the other curves need 16-bit'; }
  out.push(row('Curve', curve));
  out.push(h('p', { class: 'note' }, !all16 ? (one ? 'The other curves (linear, square law, inverse square, S curve) need 16-bit: switch Resolution to 16-bit.' : 'The other curves need all of them to be 16-bit.')
    : curveMixed ? '' : CURVE_NOTES[fxCurve(f)] + (CURVE_STRENGTH.has(fxCurve(f)) ? ' Strength: 100\u00a0% is the classic curve, 0\u00a0% a straight line, 200\u00a0% stronger.' : '')));
  const graph = one ? curveGraph(f) : null, redraw = () => graph && graph._draw();
  if (list.some(x => fxCurve(x) === 'gamma')) out.push(gammaRow(list.filter(x => fxCurve(x) === 'gamma'), redraw));
  if (list.some(x => CURVE_STRENGTH.has(fxCurve(x)))) out.push(strengthRow(list.filter(x => CURVE_STRENGTH.has(fxCurve(x))), redraw));
  if (graph) out.push(graph);
  return out;
}
// The dimming curve as a graph: the level coming in (left to right) against the output (bottom to top). Low end
// shows the first 10 %, where 8 bits have only a few steps and 16 bits hundreds. draw() draws it from the fixture as
// it is now, so it follows the gamma or strength slider while it moves.
function curveGraph(f) {
  const W = 240, H = 132, low = ui.curveZoom === 'low', xmax = low ? 0.1 : 1;
  const grid = [0.25, 0.5, 0.75].map(t => `<path class="gl" d="M${(t * W).toFixed(1)} 0V${H}M0 ${(H - t * H).toFixed(1)}H${W}"/>`).join('');
  const svg = svgEl(`<svg class="cgraph" viewBox="-1 -1 ${W + 2} ${H + 2}" role="img" aria-label="Dimming curve">${grid}<path class="ax" d="M0 0V${H}H${W}"/><path class="cv"/></svg>`);
  const cv = svg.querySelector('.cv'), ylab = h('span', { class: 'cgy' }), cap = h('p', { class: 'note' });
  const draw = () => {
    const curve = fxCurve(f), k = curveParam(f), bits = fxBits(f), lut = gammaLUT(f.gamma);
    // the output at level x, 0–1, as the fixture sends it
    const out = x => (bits === 8 ? lut[Math.round(x * 255)] / 255 : Math.round(curveValue(curve, k, x) * 65535) / 65535);
    const ymax = low ? Math.max(1e-4, out(xmax)) * 1.08 : 1;
    const X = x => (x / xmax * W).toFixed(2), Y = y => (H - Math.min(1, y / ymax) * H).toFixed(2);
    let d = '';
    if (bits === 8) {   // 256 steps in, 256 out: a staircase
      for (let i = 0; i <= Math.round(xmax * 255); i++) { const x0 = i / 255, x1 = Math.min(xmax, (i + 1) / 255), y = out(x0); d += (i ? 'L' : 'M') + X(x0) + ' ' + Y(y) + 'L' + X(x1) + ' ' + Y(y); }
    } else for (let i = 0; i <= 240; i++) { const x = i / 240 * xmax; d += (i ? 'L' : 'M') + X(x) + ' ' + Y(out(x)); }
    cv.setAttribute('d', d);
    ylab.textContent = low ? fmtV(Math.round(ymax / 1.08 * 1000) / 10) + ' %' : '100 %';
    // how many different output values the bottom 10 % of the level has, with this curve at 8 and at 16 bits: what
    // 16-bit is for
    const steps8 = new Set();
    for (let i = 0; i <= 25; i++) steps8.add(Math.round(curveValue(curve, k, i / 255) * 255));
    const steps16 = fmtN(Math.round(curveValue(curve, k, 0.1) * 65535) + 1), n8 = `${steps8.size} step${steps8.size === 1 ? '' : 's'}`;
    cap.textContent = bits === 16 ? `Bottom 10 % of the level: ${steps16} output steps. At 8-bit this curve would have ${n8} there.`
      : `Bottom 10 % of the level: ${n8} at 8-bit. At 16-bit the same curve has ${steps16}.`;
  };
  draw();
  const zoom = seg([['full', 'Full range'], ['low', 'Low end (0–10 %)']], low ? 'low' : 'full', v => { ui.curveZoom = v; renderRight(); });
  const el = h('div', { class: 'cgwrap' },
    h('div', { class: 'cghead' }, h('span', { class: 'lbl' }, 'Graph'), zoom),
    h('div', { class: 'cgbox' }, svg, ylab, h('span', { class: 'cgx' }, low ? 'level 10 %' : 'level 100 %')),
    cap);
  el._draw = draw;
  return el;
}
function trimRows(list) {
  const hasW = list.some(f => f.order.includes('W')), one = list.length === 1, tmp = list[0].trim.slice();
  return [['Red trim', 0], ['Green trim', 1], ['Blue trim', 2], ['White trim', 3]].filter(([, i]) => i < 3 || hasW).map(([label, i]) =>
    sliderRow(label, one ? list[0].trim : tmp, i, { min: 0, max: 1, step: 0.01, fmt: pct, onInput: v => { if (!one) list.forEach(f => { f.trim[i] = v; }); }, onCommit: commit }));
}
function outputSection(list) {
  const f = list[0];
  // one fixture, or several all on the same output: show where they are
  const cur = f._patch && list.every(x => x._patch && x._patch.ctrl === f._patch.ctrl && x._patch.out === f._patch.out) ? f._patch : null;
  const ctrlOpts = [['', 'Not patched'], ...project.controllers.map(c => [c.id, `${ctrlLetter(c)} · ${c.name}`])];
  let ctrlId = cur ? cur.ctrl.id : (list.length > 1 && project.controllers[0] ? '' : '');
  const outSel = h('select', { 'aria-label': 'Output' });
  const fillOuts = () => {
    const c = ctrlById(ctrlId);
    outSel.replaceChildren(...(c ? c.chains.map((_, i) => h('option', { value: String(i) }, 'OUT ' + (i + 1))) : [h('option', { value: '' }, '—')]));
    outSel.disabled = !c;
    if (cur && c === cur.ctrl) outSel.value = String(cur.out);
  };
  const apply = () => {
    const c = ctrlById(ctrlId);
    if (!c) { list.forEach(x => unassign(x.id)); markPatch(); commit(); renderRight(); return; }
    const o = +outSel.value || 0;
    list.forEach(x => assign(x.id, c, o));
    commit(); renderRight();
  };
  const cs = selectEl(ctrlOpts, ctrlId, v => { ctrlId = v; fillOuts(); if (list.length === 1 || !v) apply(); }, { aria: 'Controller' });
  fillOuts();
  outSel.addEventListener('change', () => { if (list.length === 1) apply(); });
  const kids = [row('Controller', cs), row('Output', outSel)];
  if (cur) {   // the order on the output sets the addresses: move without dragging
    const chain = cur.ctrl.chains[cur.out], ids = list.map(x => x.id), pos = ids.map(id => chain.indexOf(id)).sort((a, b) => a - b);
    const first = pos[0], last = pos[pos.length - 1], b = (txt, title, fn, off) => h('button', { class: 'btn', type: 'button', title, disabled: off, onclick: fn }, txt);
    kids.push(row('Order', h('span', { class: 'readonly' }, list.length === 1 ? `#${first + 1} of ${chain.length} on OUT ${cur.out + 1}` : `#${first + 1}–${last + 1} of ${chain.length} on OUT ${cur.out + 1}`)),
      h('div', { class: 'actions' },
        b('↑ Earlier', 'One place earlier on the output (Alt ↑)', () => moveOnOutput(ids, -1), first === 0),
        b('↓ Later', 'One place later on the output (Alt ↓)', () => moveOnOutput(ids, 1), last === chain.length - 1),
        b('To start', 'First on the output', () => moveToOutputEdge(ids, false), first === 0 && last === ids.length - 1),
        b('To end', 'Last on the output', () => moveToOutputEdge(ids, true), last === chain.length - 1 && first === chain.length - ids.length)));
  }
  if (list.length > 1) kids.push(h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: apply }, `Patch ${list.length} fixtures in list order`)));
  if (list.length === 1) {
    const box = h('div', { class: 'addr' });
    const upd = () => {
      const p = f._patch;
      box.className = 'addr';
      if (!project.controllers.length) { box.className = 'addr warn'; box.textContent = 'Add a controller in the Patch panel first.'; return; }
      if (!p) { box.className = 'addr warn'; box.textContent = 'Not patched. Choose a controller and output, or drag the fixture onto an output in the Patch panel.'; return; }
      const lines = [`${p.ctrl.name} · ${p.ctrl.ip} · OUT ${p.out + 1} · #${p.pos + 1} in chain`];
      if (p.first >= 0) lines.push(addrText(p));
      if (p.overflow) { box.className = 'addr err'; lines.push(`${p.overflow} pixels do not fit in this output's ${p.ctrl.upo} universes and are not sent.`); }
      if (p.overlap) { box.className = 'addr warn'; lines.push('Its set start overlaps the channels of the fixture before it on this output.'); }
      if (p.outside) { box.className = 'addr warn'; lines.push(`Its set start, U ${f.addr.u}, is outside this output's universes, so it is not used.`); }
      box.textContent = lines.join('\n');
      box.style.whiteSpace = 'pre-wrap';
    };
    upd(); binders.push(upd);
    kids.push(box);
    if (f._patch) kids.push(...advancedPatch(f));
  }
  return sec('Output', kids);
}
// Advanced patch: the fixture starts at a universe and channel set by hand, inside its output's universes, for
// example to leave a gap of channels on purpose. The fixtures after it on the output follow on from its end.
function advancedPatch(f) {
  const p = f._patch, c = p.ctrl, base = c.startUniverse + p.out * c.upo, on = { v: !!f.addr };
  const redo = () => { markPatch(); commit(); renderRight(); };
  const out = [checkRow('Advanced patch: set where it starts', on, 'v', v => {
    if (v) { const a = p.first >= 0 ? addrOf(p.base, p.first) : { u: base, ch: 1 }; f.addr = { u: a.u, ch: a.ch }; } else delete f.addr;
    redo();
  })];
  if (f.addr) {
    const us = Array.from({ length: c.upo }, (_, i) => [String(base + i), 'U ' + (base + i)]);
    out.push(row('Universe', selectEl(us, String(f.addr.u), v => { f.addr.u = +v; redo(); }, { aria: 'Start universe' })));
    out.push(numRow('Channel', f.addr, 'ch', { int: true, min: 1, max: 512, onCommit: redo }));
    out.push(h('p', { class: 'note' }, `Universes ${base}–${base + c.upo - 1} belong to OUT ${p.out + 1}. The fixtures after this one on the output carry on from its last channel.` +
      (c.split ? '' : ' With whole pixels, a pixel that would be split across two universes starts at the next one.')));
  }
  return out;
}
function groupSection(g, sel) {
  const px = sel.reduce((a, f) => a + pixelCount(f), 0);
  const nameIn = textInput(g, 'name', { id: 'grpName', aria: 'Group name', onInput: () => renderFxList(), onCommit: commit });
  const sw = tagSwatches(g, 'Group colour');
  return sec(null,
    h('h3', null, h('span', { class: 'ty', style: { display: 'flex', color: g.tag } }, icon('group')), 'Group'),
    row('Name', nameIn), row('Colour', sw),
    h('p', { class: 'note' }, sel.length === 1 ? `1 fixture · ${fmtN(px)} pixels. Drop fixtures on the group's name in the list to add them.`
      : `${sel.length} fixtures · ${fmtN(px)} pixels. To edit just one of them, double-click it on the stage or click it in the list.`));
}
function renderMulti(body, sel) {
  const px = sel.reduce((a, f) => a + pixelCount(f), 0), g = wholeGroup(sel);
  const tmp = { pixels: sel.find(f => f.type !== 'matrix') ? sel.find(f => f.type !== 'matrix').pixels : 0, order: sel[0].order };
  const pxIn = numInput(tmp, 'pixels', { int: true, min: 1, max: 20000, aria: 'Pixels for all', onCommit: () => { sel.forEach(f => { if (f.type !== 'matrix') f.pixels = tmp.pixels; }); markGeom(); commit(); renderRight(); } });
  body.append(...[
    g ? groupSection(g, sel) : null,
    sec(null,
      g ? h('h3', null, `All ${sel.length} fixtures`)
        : h('h3', null, `${sel.length} fixtures selected`),
      h('p', { class: 'note' }, g ? 'Changes here apply to each of them.' : `${fmtN(px)} pixels in total. Changes below apply to all of them.`),
      sel.some(f => f.type !== 'matrix') ? row('Pixels each', pxIn) : null,
      row('Color order', selectEl([['', 'Mixed / keep'], ...ORDERS.map(o => [o, o])], sel.every(f => f.order === sel[0].order) ? sel[0].order : '', v => { if (!v) return; sel.forEach(f => { f.order = v; }); markPatch(); commit(); renderRight(); }, { aria: 'Color order for all' })),
      ...trimRows(sel),
      ...dimmingRows(sel),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => { sel.forEach(f => { f.enabled = true; }); commit(); } }, 'Enable all'),
        h('button', { class: 'btn', type: 'button', onclick: () => { sel.forEach(f => { f.enabled = false; }); commit(); } }, 'Disable all'),
        h('button', { class: 'btn', type: 'button', onclick: () => { sel.forEach(f => { if (f.type !== 'matrix') f.reverse = !f.reverse; }); markGeom(); commit(); } }, 'Flip direction'),
        h('button', { class: 'btn', type: 'button', title: `${MOD}L, or the lock button above the fixture list`, onclick: toggleLockSel }, lockAction(sel) === 'unlock' ? (g ? 'Unlock group' : 'Unlock all') : (g ? 'Lock group' : 'Lock all')))),
    arrangeSection(sel),
    outputSection(sel),
    sec(null, selectionActions())].filter(Boolean));
}

/* ---------- zones ---------- */
function zoneOpacityInput(z, width) {
  const r = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: z.opacity, 'data-zone-op': z.id, title: z.name + ' opacity (its master)', 'aria-label': z.name + ' opacity' });
  r.addEventListener('input', () => setZoneOpacity(z, parseFloat(r.value), r));
  r.addEventListener('change', commitSoft);
  r.addEventListener('click', e => e.stopPropagation());
  return midiSlot(r, 'z:' + z.id, width);   // a MIDI fader can drive it
}
const zoneTag = z => h('span', { class: 'ztag', style: { borderColor: z.tag } });
function renderZoneInspector(body) {
  const z = selZone();
  if (!z) { body.append(sec('Zones', h('p', { class: 'note' }, 'No zones yet. Drag on the stage to draw one.'))); return; }
  const i = project.zones.indexOf(z);
  const sizeTxt = h('span', { class: 'mono muted', style: { letterSpacing: 0, textTransform: 'none' } });
  const upd = () => { sizeTxt.textContent = `${z.w} × ${z.h}`; };
  upd(); binders.push(upd);
  const g = o => Object.assign({ int: true, onInput: () => { clampZone(z); syncInspector(); }, onCommit: () => { clampZone(z); commit(); syncInspector(); } }, o);
  const sw = tagSwatches(z, 'Zone color');
  body.append(sec(null,
    h('h3', null, h('span', { class: 'ty', style: { display: 'flex', color: 'var(--text2)' } }, icon('zone')), 'Zone', h('span', { class: 'fill' }), sizeTxt),
    row('Name', textInput(z, 'name', { id: 'zoneName', aria: 'Zone name', onInput: () => refreshScenes(), onCommit: () => { commit(); renderSrcList(); } })),
    row('Color', sw),
    row('Opacity', h('div', { class: 'slider' }, zoneOpacityInput(z, 150), h('span', { class: 'mono', 'data-zone-pct': z.id }, pct(z.opacity))))));
  body.append(sec('Area',
    row('Position', numInput(z, 'x', g({ prefix: 'X', min: 0, aria: 'Zone X' })), numInput(z, 'y', g({ prefix: 'Y', min: 0, aria: 'Zone Y' }))),
    row('Size', numInput(z, 'w', g({ prefix: 'W', min: 1, aria: 'Zone width' })), numInput(z, 'h', g({ prefix: 'H', min: 1, aria: 'Zone height' }))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', disabled: !ui.sel.size, title: ui.sel.size ? '' : 'Select fixtures first (Select tool, V)', onclick: () => fitZone(z) }, 'Fit to selected fixtures'),
      h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(z, { x: 0, y: 0, w: project.settings.compW, h: project.settings.compH }); commit(); renderRight(); } }, 'Whole canvas'))));
  const inside = fixturesInZone(z), over = zoneAbove(i);
  body.append(sec('Lights in this zone',
    inside.list.length ? h('div', { class: 'chipsline' }, inside.list.map(f => h('span', { class: 'badge' }, f.name))) : h('p', { class: 'note' }, 'No fixtures inside this zone yet.'),
    h('p', { class: 'note' }, (inside.px ? `${fmtN(inside.px)} pixels take their color from this zone` + (over ? `, except where ${over.name} covers it (${over.name} is above it, at ${pct(over.opacity)}).` : '.') : '') +
      ' Content is drawn to fit the zone, so a shader\'s centre is the zone\'s centre.')));
  body.append(sec('Content and order',
    h('p', { class: 'note' }, `${z.layers.length} layer${z.layers.length === 1 ? '' : 's'}, ${z.scenes.length} scene${z.scenes.length === 1 ? '' : 's'}. Zones higher in the list cover the ones below.`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => { ui.rightTab = 'content'; renderRight(); } }, 'Edit layers'),
      h('button', { class: 'btn', type: 'button', disabled: i === project.zones.length - 1, onclick: () => moveZone(z, 1) }, 'Move up'),
      h('button', { class: 'btn', type: 'button', disabled: i === 0, onclick: () => moveZone(z, -1) }, 'Move down')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => duplicateZone(z) }, 'Duplicate'),
      h('button', { class: 'btn danger-t', type: 'button', onclick: () => deleteZone(z) }, 'Delete zone'))));
}

/* ---------- content tab ---------- */
function zonesSection() {
  const cur = selZone();
  const list = h('ul', { class: 'list zones' });
  for (const z of project.zones.slice().reverse()) {
    const names = z.layers.filter(L => L.on && L.src && srcById(L.src)).map(L => srcById(L.src).name);
    const li = h('li', { class: z === cur ? 'sel' : '', 'data-id': z.id, title: `${z.name} · ${z.w} × ${z.h} at ${z.x}, ${z.y}\nDrag to change the order: zones higher in the list cover the ones below`, onclick: () => selectZone(z) },
      zoneTag(z), h('span', { class: 'zn' }, h('span', { class: 'nm' }, z.name), h('span', { class: 'sub' }, names.join(' · ') || 'Empty')),
      zoneOpacityInput(z, 64));
    reorderable(li, li, 'zone', () => [z.id], ([id], after) => moveZoneTo(id, z, after));
    onRightClick(li, e => zoneMenu(e, z));
    list.append(li);
  }
  if (!project.zones.length) list.append(emptyRow('No zones, so the output is black. Add one to play content.'));
  return sec(null, h('h3', null, 'Zones', h('span', { class: 'fill' }),
    h('button', { class: 'btn sm map-only', type: 'button', title: 'Add a zone around the selected fixtures (or the whole canvas), under the others', onclick: newZoneFromUI }, '+ Zone')), list);
}
function layersSection(z) {
  const cur = selLayer();
  const list = h('ul', { class: 'list layers' });
  for (const L of z.layers.slice().reverse()) {
    const i = z.layers.indexOf(L) + 1, src = srcById(L.src);
    const op = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: L.opacity, title: 'Opacity', 'aria-label': `Layer ${i} opacity` });
    op.addEventListener('input', () => { L.opacity = parseFloat(op.value); syncInspector(); });
    op.addEventListener('change', lookEdited);
    op.addEventListener('click', e => e.stopPropagation());
    binders.push(() => { if (document.activeElement !== op) op.value = L.opacity; });
    const eye = h('button', { class: 'x eye', type: 'button', title: L.on ? 'Hide layer' : 'Show layer', 'aria-label': (L.on ? 'Hide' : 'Show') + ' layer ' + i,
      onclick: e => { e.stopPropagation(); L.on = !L.on; syncMedia(); commit(); renderRight(); renderSrcList(); } }, icon(L.on ? 'eye' : 'eyeOff'));
    const mv = (txt, d, off, label) => h('button', { type: 'button', disabled: off, title: label, 'aria-label': `${label}: layer ${i}`, onclick: e => { e.stopPropagation(); moveLayer(z, L, d); } }, txt);
    const li = h('li', { class: (L === cur ? 'sel ' : '') + (L.on ? '' : 'off ') + (src ? '' : 'nosrc'), 'data-id': L.id, title: 'Drag, or ↑ ↓, to change the order: layers higher in the list cover the ones below', onclick: () => { ui.layer = L.id; renderRight(); renderSrcList(); } },
      h('span', { class: 'pgrip', 'aria-hidden': 'true' }), eye, h('span', { class: 'meta' }, i), h('span', { class: 'nm' }, src ? src.name : 'Empty'),
      h('span', { class: 'meta' }, L.blend === 'alpha' ? '' : BLENDS[BLEND_IDX[L.blend]][1]),
      h('span', { class: 'mv' }, mv('↑', 1, i === z.layers.length, 'Move up'), mv('↓', -1, i === 1, 'Move down')), op);
    reorderable(li, li, 'layer', () => [L.id], ([id], after) => moveLayerTo(z, id, L, after));
    onRightClick(li, e => layerMenu(e, z, L));
    list.append(li);
  }
  if (!z.layers.length) list.append(emptyRow('No layers, so this zone is black. Add a layer, or click a source.'));
  return sec(null, h('h3', null, 'Layers', h('span', { style: { color: z.tag, letterSpacing: '.06em' } }, '· ' + z.name), h('span', { class: 'fill' }),
    h('button', { class: 'btn sm', type: 'button', title: 'Add an empty layer above the selected one', onclick: () => addLayer(z) }, '+ Layer')), list);
}
function renderContentTab(body) {
  if (!mixer.ok) body.append(sec('Content', h('div', { class: 'errbox' }, 'WebGL is off or unavailable in this browser, so content cannot be rendered. Use Chrome or Edge with hardware acceleration on.')));
  body.append(zonesSection());
  const z = selZone();
  if (!z) return;
  body.append(layersSection(z));
  const L = selLayer();
  if (!L) return;
  const n = z.layers.indexOf(L) + 1;
  const src = srcById(L.src);
  body.append(sec('Layer ' + n,
    row('Source', selectEl([['', 'Empty'], ...project.sources.map(s => [s.id, s.name])], L.src || '', v => { loadSource(v || null, L); commit(); renderRight(); renderSrcList(); }, { aria: 'Layer source' })),
    row('Blend', selectEl(BLENDS, L.blend, v => { L.blend = v; commit(); renderRight(); }, { aria: 'Blend mode' })),
    sliderRow('Opacity', L, 'opacity', { fmt: pct, onInput: () => syncInspector(), onCommit: lookEdited }),
    h('p', { class: 'note' }, n === 1 && L.blend !== 'alpha' ? 'This is the bottom layer, so it blends onto black.' : BLEND_NOTES[L.blend]),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', type: 'button', disabled: n === z.layers.length, onclick: () => moveLayer(z, L, 1) }, 'Move up'),
      h('button', { class: 'btn sm', type: 'button', disabled: n === 1, onclick: () => moveLayer(z, L, -1) }, 'Move down'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => duplicateLayer(z, L) }, 'Duplicate'),
      h('button', { class: 'btn sm danger-t', type: 'button', onclick: () => removeLayer(z, L) }, 'Remove'))));
  if (!src) { body.append(sec(null, h('p', { class: 'note' }, 'This layer is empty. Click a source in the Sources list to play it here.'))); return; }

  // live picture of this layer, in the zone's proportions
  const ar = z.w / z.h, ph = clamp(Math.round(276 / ar), 36, 110), pw = Math.min(276, Math.round(ph * ar));
  const pv = h('canvas', { class: 'lpreview', width: pw, height: ph, 'aria-label': 'Live preview of this layer' });
  preview = { layer: L, canvas: pv };
  const rt = src.kind === 'isf' ? runtimeOf(src) : null;
  const head = [pv];
  if (!L.on) head.push(h('p', { class: 'note' }, 'The layer is hidden, so the preview is paused.'));
  if (!src.builtin) head.push(row('Name', textInput(src, 'name', { aria: 'Source name', onInput: renderSrcList, onCommit: commit })));
  const desc = rt && rt.hdr && rt.hdr.DESCRIPTION;
  head.push(h('p', { class: 'note' }, (src.kind === 'isf' ? (src.builtin ? 'Built-in generator. ' : 'ISF shader. ') : '') + (desc ? desc.replace(/\.?$/, '.') : '')));
  body.append(sec(src.name, head));

  if (rt && rt.error) body.append(sec('Shader error', h('div', { class: 'errbox' }, rt.error)));
  if (src.kind === 'isf' && rt && rt.R) {
    const ctl = [];
    for (const inp of isfInputs(src)) {
      const label = inp.LABEL || inp.NAME;
      const holder = { v: paramValue(L, src, inp) };
      const set = v => setParam(L, src, inp.NAME, v);
      if (inp === rt.speed) {   // 0–100 % of the full speed, and a button for reverse
        const M = speedMax(inp), sp = { pct: Math.min(100, Math.abs(holder.v) / M * 100) };
        let dir = holder.v < 0 ? -1 : 1;
        const rev = h('button', { class: 'btn sm rev' + (dir < 0 ? ' on' : ''), type: 'button', title: 'Run it in reverse', 'aria-pressed': String(dir < 0), onclick: () => {
          dir = -dir; rev.classList.toggle('on', dir < 0); rev.setAttribute('aria-pressed', String(dir < 0)); set(dir * sp.pct / 100 * M); commit();
        } }, 'Reverse');
        const r = sliderRow('Speed', sp, 'pct', { min: 0, max: 100, step: 0.5, fmt: v => Math.round(v) + '%', onInput: v => set(dir * v / 100 * M), onCommit: commit });
        ctl.push(r, h('div', { class: 'row' }, h('span', { class: 'lbl' }), h('div', null, rev)));   // Reverse under the slider
      } else if (isAngle(inp)) {   // in degrees: whole degrees, notches of 5°, round the circle, and buttons every 45°
        const min = inp.MIN, max = inp.MAX;
        const pre = anglePresets(label, holder, min, max, v => { holder.v = v; set(v); syncInspector(); commit(); });
        ctl.push(sliderRow(label, holder, 'v', { min, max, step: 1, notch: 5, wrap: max - min === 360, fmt: v => fmtV(Math.round(v * 10) / 10) + '°', onInput: v => { set(v); pre._sync(); }, onCommit: commit }), pre);
      } else if (inp.TYPE === 'float' || inp.TYPE === 'int') {
        const min = inp.MIN ?? 0, max = inp.MAX ?? 1;
        ctl.push(sliderRow(label, holder, 'v', { min, max, step: inp.TYPE === 'int' ? 1 : (max - min) / 500, int: inp.TYPE === 'int', fmt: v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)), onInput: set, onCommit: commit }));
      } else if (inp.TYPE === 'long') {
        const vals = inp.VALUES || [], labs = inp.LABELS || vals;
        ctl.push(row(label, selectEl(vals.map((v, i) => [v, labs[i]]), holder.v, v => { set(parseInt(v, 10)); commit(); }, { aria: label })));
      } else if (inp.TYPE === 'bool') {
        ctl.push(checkRow(label, holder, 'v', v => { set(v); commit(); }));
      } else if (inp.TYPE === 'event') {
        ctl.push(row(label, h('button', { class: 'btn', type: 'button', onclick: () => { set(true); setTimeout(() => set(false), 80); } }, 'Trigger')));
      } else if (inp.TYPE === 'color') {
        ctl.push(colorRow(label, () => paramValue(L, src, inp), set, commit, `${L.id}:${src.id}:${inp.NAME}`));
      } else if (inp.TYPE === 'point2D') {
        const pt = { x: holder.v[0], y: holder.v[1] };
        const up = () => set([pt.x, pt.y]);
        ctl.push(row(label, numInput(pt, 'x', { prefix: 'X', step: 0.01, onInput: up, onCommit: commit }), numInput(pt, 'y', { prefix: 'Y', step: 0.01, onInput: up, onCommit: commit })));
      }
    }
    ctl.push(h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { delete L.params[src.id]; commit(); renderRight(); } }, 'Reset to defaults')));
    body.append(sec('Parameters', ctl));
  }
  if (src.kind === 'image' || src.kind === 'video') {
    const el = mediaEls.get(src.id);
    const k = [];
    if (!el) k.push(h('p', { class: 'note' }, 'This file is not loaded in this session (browsers do not keep file access between visits).'));
    k.push(h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => pickMedia(src) }, el ? 'Replace file…' : 'Load file…')));
    k.push(row('Fit', seg(FIT_OPTIONS, src.fit || 'fit', v => { src.fit = v; markThumb(src); commit(); })));
    if (src.kind === 'video') k.push(...videoControls(src, el));
    body.append(sec('Media', k));
  }
  if (src.kind === 'screen') {
    const el = mediaEls.get(src.id);
    body.append(sec('Screen capture',
      h('p', { class: 'note' }, 'Captures a window or screen, for example the output window of Resolume or TouchDesigner, and maps it onto the fixtures.'),
      h('div', { class: 'actions' }, el ? h('button', { class: 'btn', type: 'button', onclick: () => stopCapture(src) }, 'Stop capture') : h('button', { class: 'btn primary', type: 'button', onclick: () => startCapture(src) }, 'Choose window…')),
      row('Fit', seg(FIT_OPTIONS, src.fit || 'stretch', v => { src.fit = v; commit(); }))));
  }
  body.append(sec('Transition', sliderRow('Crossfade', project.settings, 'transition', { min: 0, max: 5, step: 0.1, fmt: v => v.toFixed(1) + ' s', onCommit: commit }),
    h('p', { class: 'note' }, 'Fade time when you click a source to play it in a layer. Scenes have their own fade time.')));
}
// A shader control that is an angle in degrees: a float named or labelled angle or rotation, with a range of 45° to 360°
// (one in radians, 0 to 6.28, stays a plain slider)
const isAngle = inp => inp.TYPE === 'float' && /angle|rotat/i.test(inp.NAME + ' ' + (inp.LABEL || '')) && isFinite(inp.MIN) && isFinite(inp.MAX) && inp.MAX - inp.MIN >= 45 && inp.MAX - inp.MIN <= 360;
// Buttons for the angles every 45° in the control's range, under its slider; the one it is at is lit
function anglePresets(label, holder, min, max, pick) {
  const vals = [];
  for (let a = Math.ceil(min / 45) * 45; a <= max && a < min + 360; a += 45) vals.push(a);
  const same = (v, a) => Math.abs(v - a) < 1e-6 || (max - min === 360 && Math.abs(Math.abs(v - a) - 360) < 1e-6);
  const btns = vals.map(a => h('button', { type: 'button', title: `Set ${label.toLowerCase()} to ${a}°`, onclick: () => pick(a) }, a + '°'));
  const sync = () => btns.forEach((b, i) => { const on = same(holder.v, vals[i]); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  sync();
  binders.push(sync);
  const el = h('div', { class: 'seg angles', role: 'group', 'aria-label': label + ': quick angles' }, btns);
  el._sync = sync;
  return el;
}
// The video options in the Content tab: a timeline with the trim, how it plays, speed and sound
function videoControls(src, el) {
  fixVideoOptions(src);
  const apply = () => applyVideoOptions(src, el);
  const changed = () => { apply(); commit(); renderRight(); };
  const k = [];
  const dur = el && isFinite(el.duration) ? el.duration : 0;
  if (el) k.push(h('p', { class: 'note mono' }, `${el.videoWidth} × ${el.videoHeight} · ${dur ? fmtDur(dur) : '…'}`));
  // timeline: the whole video, the trimmed part lit, the playhead. Click or drag on it to go to a moment; drag the
  // handles at the ends of the lit part to trim the start and the end.
  const span = h('i', { class: 'span' }), head = h('i', { class: 'head' });
  const hIn = h('i', { class: 'trim in', title: 'Drag to trim the start' }), hOut = h('i', { class: 'trim out', title: 'Drag to trim the end' });
  const tl = h('div', { class: 'vtl', title: 'Click or drag to go to a moment' }, span, head, hIn, hOut);
  const place = () => {
    if (!tl.isConnected) return;
    const d = el && isFinite(el.duration) ? el.duration : 0;
    if (d) {
      const [a, b] = videoSpan(src, el), e = Math.min(b, d);
      span.style.left = hIn.style.left = (a / d * 100) + '%'; span.style.width = ((e - a) / d * 100) + '%'; hOut.style.left = (e / d * 100) + '%';
      head.style.left = (el.currentTime / d * 100) + '%';
      pos.textContent = trimming ? `${trimming === 'in' ? 'Start' : 'End'} ${fmtDur(trimming === 'in' ? a : e)}` : `${fmtDur(el.currentTime)} / ${fmtDur(d)}`;
    }
    requestAnimationFrame(place);
  };
  const pos = h('span', { class: 'mono muted' }, '');
  let trimming = null;
  const timeAt = e => { const r = tl.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * el.duration; };
  const go = t => { el.currentTime = t; el._done = false; };
  const seek = e => { if (el && dur) go(timeAt(e)); };
  // Dragging a handle moves that end of the trim (at least 0.1 s of video stays) and shows the frame there
  const trim = e => {
    const t = Math.round(timeAt(e) * 100) / 100, [a, b] = videoSpan(src, el), end = Math.min(b, el.duration);
    if (trimming === 'in') { src.trimIn = clamp(t, 0, Math.max(0, end - 0.1)); go(src.trimIn); }
    else { const v = clamp(t, a + 0.1, el.duration); src.trimOut = v >= el.duration - 0.05 ? 0 : v; go(Math.min(v, el.duration - 0.01)); }
    apply();
  };
  tl.addEventListener('pointerdown', e => {
    if (!el || !dur) return;
    tl.setPointerCapture(e.pointerId);
    if (e.target !== hIn && e.target !== hOut) { seek(e); tl.onpointermove = seek; return; }
    tl.classList.add('trimming');
    // Handles on top of each other: dragging left moves the start, dragging right the end
    const x0 = e.clientX, close = Math.abs(hIn.getBoundingClientRect().left - hOut.getBoundingClientRect().left) < 12;
    trimming = close ? null : e.target === hIn ? 'in' : 'out';
    if (trimming) trim(e);
    tl.onpointermove = ev => { if (!trimming) { if (ev.clientX === x0) return; trimming = ev.clientX < x0 ? 'in' : 'out'; } trim(ev); };
  });
  tl.addEventListener('pointerup', () => { tl.onpointermove = null; if (tl.classList.contains('trimming')) { const did = trimming; trimming = null; tl.classList.remove('trimming'); if (did) { commit(); renderRight(); } } });
  if (el) { k.push(tl, h('div', { class: 'vtlpos' }, pos)); requestAnimationFrame(place); }
  // Restart, Play, Pause; a pause is for now only, it isn't saved
  const playing = el && !el.paused && !el._held && !el._done;
  const tb = (label, name, on, title, onclick) => h('button', { class: 'btn sm' + (on ? ' on' : ''), type: 'button', disabled: !el, title, 'aria-label': label, 'aria-pressed': on ? 'true' : 'false', onclick }, icon(name));
  k.push(h('div', { class: 'transport', role: 'group', 'aria-label': 'Play the video' },
    tb('Restart', 'restart', false, 'Restart: play again from its start', () => { el._held = false; restartVideo(src, el); renderRight(); }),
    tb('Play', 'play', playing, 'Play', () => { el._held = false; if (el._done) restartVideo(src, el); else playVideo(src, el); renderRight(); }),
    tb('Pause', 'pause', el && !playing, 'Pause here', () => { el._held = true; el.pause(); renderRight(); })));
  // End shows the real end time; at (or past) the video's end it means "to the end" (0)
  const out = { v: src.trimOut || dur };
  const trimIn = numInput(src, 'trimIn', { min: 0, max: dur || 1e6, step: 0.1, aria: 'Start of the video, in seconds', onCommit: changed });
  const trimOut = numInput(out, 'v', { min: 0, max: dur || 1e6, step: 0.1, aria: 'End of the video, in seconds', onCommit: () => { src.trimOut = dur && out.v >= dur - 0.05 ? 0 : out.v; changed(); } });
  k.push(row('Start (s)', trimIn), row('End (s)', trimOut));
  k.push(h('div', { class: 'actions' },
    h('button', { class: 'btn sm', type: 'button', disabled: !el, title: 'The video starts here', onclick: () => { src.trimIn = Math.round(el.currentTime * 10) / 10; if (src.trimOut && src.trimOut <= src.trimIn) src.trimOut = 0; changed(); } }, 'Start here'),
    h('button', { class: 'btn sm', type: 'button', disabled: !el, title: 'The video ends here', onclick: () => { const t = Math.round(el.currentTime * 10) / 10; if (t > src.trimIn) { src.trimOut = t; changed(); } } }, 'End here'),
    h('button', { class: 'btn sm', type: 'button', disabled: !(src.trimIn || src.trimOut), onclick: () => { src.trimIn = 0; src.trimOut = 0; changed(); } }, 'Whole video')));
  k.push(row('Play', seg([[true, 'Loop'], [false, 'Once']], src.loop !== false, v => { src.loop = v === true || v === 'true'; if (src.loop && el) { el._done = false; playVideo(src, el); } changed(); })));
  if (src.loop === false) k.push(row('At the end', seg([[true, 'Last frame'], [false, 'Black']], src.endHold !== false, v => { src.endHold = v === true || v === 'true'; changed(); })));
  k.push(checkRow('Restart each time it is shown', src, 'restart', () => commit()));
  k.push(sliderRow('Speed', src, 'rate', { min: 0.1, max: 4, step: 0.05, fmt: v => v.toFixed(2) + '×', onInput: v => { if (el) el.playbackRate = v; }, onCommit: commit }));
  k.push(checkRow('Play its sound', src, 'audio', () => { apply(); if (el && src.audio && !el.paused) playVideo(src, el); commit(); renderRight(); }));
  if (src.audio) k.push(sliderRow('Volume', src, 'volume', { min: 0, max: 1, step: 0.01, fmt: pct, onInput: apply, onCommit: commit }));
  if (el && el._done) k.push(h('p', { class: 'note' }, src.endHold !== false ? 'Played once: holding its last frame. Restart plays it again.' : 'Played once: black now. Restart plays it again.'));
  return k;
}

/* ---------- settings tab ---------- */
function renderSettings(body) {
  const s = project.settings;
  let before = [s.compW, s.compH];
  const onSize = () => { fitZonesToCanvas(...before); before = [s.compW, s.compH]; markGeom(); commit(); };
  body.append(sec('Composition',
    row('Size', numInput(s, 'compW', { prefix: 'W', int: true, min: 16, max: 8192, onCommit: onSize }), numInput(s, 'compH', { prefix: 'H', int: true, min: 16, max: 8192, onCommit: onSize })),
    h('p', { class: 'note' }, 'The canvas content is rendered at this size and sampled at each pixel position. Fixture coordinates are in these units.')));
  body.append(sec('Output',
    sliderRow('Frame rate', s, 'fps', { min: 1, max: 100, step: 1, int: true, fmt: v => v + ' fps', onCommit: () => { startClock(); commit(); } }),
    h('p', { class: 'note' }, 'Up to 100 frames a second; 40 is the default. Above 44, frames come faster than a DMX line can refresh: pixel controllers take them, but some DMX nodes skip frames.'),
    sliderRow('Gamma for new fixtures', s, 'gamma', { min: 1, max: 3, step: 0.05, fmt: v => v.toFixed(2), onCommit: commit }),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', disabled: !project.fixtures.length, onclick: () => {
      project.fixtures.forEach(f => { f.gamma = s.gamma; }); commit(); toast(`Gamma ${s.gamma.toFixed(2)} set on all ${project.fixtures.length} fixtures. ${MOD}Z undoes.`); } }, 'Apply to all fixtures')),
    h('p', { class: 'note' }, 'Each fixture has its own gamma (Inspector → Pixels), as LED types differ. New fixtures start from this value.'),
    row('White (RGBW)', selectEl([['off', 'Off: W stays 0'], ['sub', 'W = min(RGB), subtract'], ['add', 'W = min(RGB), keep RGB']], s.whiteMode, v => { s.whiteMode = v; commit(); }, { aria: 'White channel mode' })),
    h('p', { class: 'note' }, 'Colour trims and gamma are set per fixture, in the Inspector under Pixels.'),
    checkRow('Send ArtSync after each frame', s, 'artSync', commit),
    h('p', { class: 'note' }, 'ArtSync makes nodes that support it update all universes at the same moment. Leave it off if your controllers do not support it: some stop outputting while they wait for a sync.')));
  body.append(sec('Stage',
    numRow('Grid', s, 'grid', { min: 1, max: 500, step: 1, onCommit: commit }),
    checkRow('Snap to grid (hold Alt to override)', ui, 'snap', () => { $('#vSnap').checked = ui.snap; savePrefs(); }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => $('#fileGuide').click() }, 'Load guide image…'),
      project.guide ? h('button', { class: 'btn', type: 'button', onclick: () => { project.guide = null; guideImg = null; commit(); renderRight(); } }, 'Remove guide') : null),
    h('p', { class: 'note' }, 'A guide image (for example your layout SVG) is drawn over the stage, fitted to the composition, so you can trace fixtures over it.')));
  if (!REMOTE_CLIENT) body.append(remoteSection());
  // Where the page finds openledmapper.py. The desktop app always uses its own, so there is nothing to set there.
  if (!/Electron/.test(navigator.userAgent) && !REMOTE_CLIENT) {
    const auto = bridgeUrl();
    body.append(sec('Art-Net connection',
      row('Address', textInput(s, 'bridgeUrl', { placeholder: auto || 'ws://127.0.0.1:8080/ws', aria: 'Art-Net connection address', onCommit: () => { commit(); connectBridge(); } })),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: connectBridge }, 'Reconnect')),
      h('p', { class: 'note', html: 'Art-Net is sent by <code>openledmapper.py</code> running on this computer. Leave the address empty to use the one this page was opened from.' })));
  }
}

/* ---------- selection ---------- */
// The right panel (Inspector, Content, Settings) can be hidden to give the stage more room
function showRight(on) {
  ui.rightHidden = !on;
  $('.workspace').classList.toggle('noright', ui.rightHidden);
  $('#btnRight').classList.toggle('on', !ui.rightHidden);
  $('#btnRight').setAttribute('aria-pressed', String(!ui.rightHidden));
  savePrefs();
  updateMidiUI();
}
// Rename: open the Inspector (showing the panel if it is hidden) with the name selected
function focusName(id) { if (ui.rightHidden) showRight(true); ui.rightTab = 'inspector'; renderRight(); const i = $('#' + id); if (i) { i.focus(); i.select(); } }
function onSelection() {
  unfoldForSelection();
  renderFxList();
  if (ui.sel.size && ui.rightTab !== 'inspector') ui.rightTab = 'inspector';
  renderRight();
  if (ui.dockTab === 'patch') { renderDock(); revealInPatch(); }
}
// A fixture selected on its own inside a folded group: unfold the group, so that its row shows
function unfoldForSelection() {
  if (!ui.sel.size || project.groups.every(g => g.open)) return;
  const c = new Map();
  for (const f of project.fixtures) if (f.group != null) { const a = c.get(f.group) || [0, 0]; a[1]++; if (ui.sel.has(f.id)) a[0]++; c.set(f.group, a); }
  for (const g of project.groups) { const a = c.get(g.id); if (!g.open && a && a[0] && a[0] < a[1]) g.open = true; }
}

/* ---------- arrange rows ---------- */
function rotateRow(sel) {
  const off = !sel.some(f => !f.locked), tmp = { deg: 45 };
  const b = (txt, deg, title) => h('button', { class: 'btn', type: 'button', title, disabled: off, onclick: () => rotateSel(deg) }, txt);
  const inp = numInput(tmp, 'deg', { min: -360, max: 360, step: 1, aria: 'Angle to rotate by, in degrees (clockwise)' });
  inp.style.width = '64px';
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') rotateSel(numOr(tmp.deg, 0)); });
  return [
    row('Rotate', h('div', { class: 'rotbtns' }, b('↺90°', -90, 'Turn 90° counter-clockwise (Shift R)'), b('↺15°', -15, 'Turn 15° counter-clockwise'), b('↻15°', 15, 'Turn 15° clockwise'), b('↻90°', 90, 'Turn 90° clockwise (R)'))),
    row('By', h('div', { class: 'rotbtns' }, inp, h('span', { class: 'muted', style: { alignSelf: 'center' } }, '°'), h('button', { class: 'btn', type: 'button', disabled: off, onclick: () => rotateSel(numOr(tmp.deg, 0)) }, 'Rotate'))),
    ...sizeRows(sel)];
}
// Several fixtures: their size together, along their frame. With Keep proportions, one value sets both.
function sizeRows(sel) {
  const list = sel.filter(f => !f.locked);
  if (!list.length || (list.length === 1 && list[0].type !== 'path')) return [];   // a circle has its radii, a line and a matrix their own sizes
  const F = selFrame(list), tmp = { w: r3(F.w), h: r3(F.h) };
  const apply = which => {
    let { w, h: hh } = tmp;
    if (ui.keepRatio !== false) { const k = which === 'w' ? (F.w > 1e-6 ? w / F.w : 1) : (F.h > 1e-6 ? hh / F.h : 1); w = F.w * k; hh = F.h * k; }
    resizeSel(w, hh);
  };
  const sw = numInput(tmp, 'w', { prefix: 'W', min: 0.1, step: 1, aria: 'Width of the selection', onCommit: () => apply('w') });
  const sh = numInput(tmp, 'h', { prefix: 'H', min: 0.1, step: 1, aria: 'Height of the selection', onCommit: () => apply('h') });
  if (ui.keepRatio == null) ui.keepRatio = true;
  return [row('Size', sw, sh), checkRow('Keep proportions', ui, 'keepRatio')];
}
function arrangeSection(sel) {
  const units = arrangeUnits(sel), free = units.filter(u => !u.locked).length, many = units.length > 1;
  const g = wholeGroup(sel), blocks = !g && units.some(u => u.list.length > 1);
  const b = (ic, title, fn, off) => h('button', { class: 'btn icon', type: 'button', title, 'aria-label': title, disabled: !free || !!off, onclick: fn }, icon(ic));
  const align = [
    h('div', { class: 'grp' }, b('alignL', 'Align left', () => alignSel('l')), b('alignCX', 'Align centres horizontally', () => alignSel('cx')), b('alignR', 'Align right', () => alignSel('r'))),
    h('div', { class: 'grp' }, b('alignT', 'Align top', () => alignSel('t')), b('alignCY', 'Align centres vertically', () => alignSel('cy')), b('alignB', 'Align bottom', () => alignSel('b')))];
  const centre = h('div', { class: 'grp' }, b('centre', many ? 'Centre them together on the canvas' : 'Centre on the canvas', centreSel));
  const note = !free ? (many ? 'These are all locked. Unlock them to move them.' : 'Locked. Unlock it to move it.')
    : (g ? `Lines up the fixtures of ${groupName(g)} with each other. Centre moves the whole group to the middle of the canvas.`
      : many ? `Aligns to the edges of the selection${blocks ? ', each group as one block' : ''}. Distribute (3 or more) keeps the outermost two and spaces the centres evenly between them.`
      : 'Aligns to the edges of the canvas.') + (many ? ' Rotate turns them together around their middle; on the stage, drag the round handle above them.' : '') +
      (free < units.length ? (blocks ? ' Locked fixtures, and the groups they are in, stay where they are.' : ' Locked fixtures stay where they are.') : '');
  return sec('Arrange',
    ...rotateRow(sel),
    many ? [h('div', { class: 'arrange' }, align),   // aligning on the first row, spacing and centring on the second
      h('div', { class: 'arrange' }, h('div', { class: 'grp' },
        b('distH', 'Distribute horizontally: the same spacing between centres', () => distributeSel('x'), free < 3),
        b('distV', 'Distribute vertically: the same spacing between centres', () => distributeSel('y'), free < 3)), centre)]
      : h('div', { class: 'arrange' }, align, centre),
    h('p', { class: 'note' }, note));
}
