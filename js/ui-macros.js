// nouPix · js/ui-macros.js
// The macros, in the MIDI window (under the controllers): Speed, Intensity and Saturation; Color 1 and Color 2 (on
// or off, their swatch, and opened, a slider for each part, HSV or RGB); and the shared controls (Angle, Softness…),
// folded. Every slider can be learnt by a MIDI control. In the Content tab: under an effect's control, a note says
// which macro it follows while that macro changes it, a colour that follows one shows it, and in its Parameters,
// which macro each control follows can be chosen for that effect.

// The parts of the macros the user has opened: 'color1', 'color2', 'shared', and 'links' (in an effect's Parameters)
const macroOpen = () => new Set(Array.isArray(ui.macroOpen) ? ui.macroOpen : []);
function toggleMacroOpen(key) {
  const s = macroOpen();
  if (s.has(key)) s.delete(key); else s.add(key);
  ui.macroOpen = [...s]; savePrefs(); renderRight(); updateMidiUI();
}
// A binder runs at once too, so what it shows is right from the start, then on each sync (of the Content tab, or of
// the MIDI window for the macros drawn there)
const bind = f => { binders.push(f); f(); };
const foldBtn = (open, label, onclick, title) => h('button', { class: 'mfold' + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open), title, onclick }, icon('chev'), label);
// Which macros the panel shows: All zones' ('') or a zone's (its id), while that zone is there
const macroScope = () => (ui.macroScope && project.zones.length > 1 && zoneById(ui.macroScope) ? ui.macroScope : '');
// All zones, then each zone (the top one first, as in the Scenes panel), as tabs over the macros (with two zones or
// more): moving All zones' sets every zone's, a zone's only that zone's
function macroScopeTabs() {
  if (project.zones.length < 2) return null;
  const zs = project.zones.slice().reverse();
  const el = seg([['', 'All zones'], ...zs.map(z => [z.id, z.name])], macroScope(), v => { ui.macroScope = v; updateMidiUI(); });
  el.classList.add('mscope');
  $$('button', el).forEach((b, i) => {
    const z = zs[i - 1];
    b.dataset.mscope = z ? z.id : '';
    b.title = z ? `${z.name}'s own: only its content follows them` : 'Moving one sets it in every zone';
  });
  return el;
}
// A label with a tick that switches a colour or a shared control on and off (S: the scope, '' or a zone's id)
function macroSwitch(id, label, S = '') {
  const d = macroDef(id), box = h('input', { type: 'checkbox', 'aria-label': d.label + ' on', title: 'On: the effects follow it. Off: each keeps its own.', onchange: e => setMacro(id, { on: e.target.checked }, S) });
  bind(() => { box.checked = !!macroScopeSet(S)[id].on; });
  return h('span', { class: 'lbl mlbl' }, box, label);
}
// A macro's slider: moving it (or its MIDI control) turns a shared control on
function macroSlider(id, S = '') {
  const d = macroDef(id), M = () => macroScopeSet(S), holder = { get v() { return M()[id].v; }, set v(x) { setMacro(id, { v: x }, S); } };
  const r = sliderRow(d.label, holder, 'v', { min: 0, max: macroMax(d), step: 0.01, fmt: d.kind === 'mult' ? v => v.toFixed(2) + '×' : pct, midi: macroTarget(id, S),
    label: d.kind === 'abs' ? macroSwitch(id, d.label, S) : null });
  if (d.kind === 'abs') bind(() => r.classList.toggle('off', !M()[id].on));
  const what = d.kind === 'mult' ? 'Every effect\'s speed: 1× leaves them as they are.' : id === 'intensity' ? 'The level of every layer: 100 % leaves them as they are.'
    : id === 'saturation' ? 'Every effect\'s saturation: 100 % leaves them as they are.' : `Sets the ${d.label.toLowerCase()} of every effect that has one, each in its own range.`;
  macroMixedMark(r, id, S, what);
  return r;
}
// On All zones' sliders: a small ≠ after the name while some zone is elsewhere (its own was moved since), and why
const MIXED_NOTE = 'Some zones have their own value now: moving this sets them all.';
function macroMixedMark(r, id, S, what = '') {
  if (S) { r.title = what; return; }
  bind(() => { const mixed = macroMixed(id); if (r.classList.contains('mixed') !== mixed || !r.title) { r.classList.toggle('mixed', mixed); r.title = (what + (mixed ? ' ' + MIXED_NOTE : '')).trim(); } });
}
// A colour macro: its switch and its swatch; opened, a slider for each part, which a MIDI fader can drive
function macroColor(id, S = '') {
  const d = macroDef(id), open = macroOpen().has(id), M = () => macroScopeSet(S), m = M()[id];
  const fill = h('i'), hex = h('span', { class: 'mono' });
  const r = row(macroSwitch(id, foldBtn(open, d.label, () => toggleMacroOpen(id), open ? 'Fold its parts' : 'Its hue, saturation and value, for MIDI faders'), S),
    h('span', { class: 'cswatch still', title: 'The colour the effects follow while it is on' }, fill, hex));
  r.classList.add('mcolor');
  r.dataset.midi = macroTarget(id, S, 0);   // learnt as its first part (Hue, or Red in RGB); opened, each part has its slider
  bind(() => { const c = toHex(macroRgb(M()[id])); fill.style.background = c; hex.textContent = c; r.classList.toggle('off', !M()[id].on); });
  macroMixedMark(r, id, S);
  if (!open) return [r];
  const mode = seg([['hsv', 'HSV'], ['rgb', 'RGB']], m.mode, v => { setMacro(id, { mode: v }, S); renderRight(); });
  const parts = MACRO_PARTS[m.mode].map(([k, name], i) => {
    const hue = k === 'h', holder = { get v() { return macroPart(M()[id], i) * (hue ? 360 : 1); }, set v(x) { setMacroPart(id, i, hue ? x / 360 : x, S); } };
    return sliderRow(name, holder, 'v', { min: 0, max: hue ? 360 : 1, step: hue ? 1 : 0.01, fmt: hue ? v => Math.round(v) + '°' : pct, midi: macroTarget(id, S, i) });
  });
  return [r, h('div', { class: 'msub' }, row('Sliders', mode), ...parts)];
}
// The macros, for the MIDI window. Its binders are its own (macroBinders), run each time it is brought up to date, so
// a fader moving a macro moves its slider there.
let macroBinders = [];
function macrosPanel() {
  const shared = macroOpen().has('shared'), abs = MACROS.filter(d => d.kind === 'abs'), keep = binders, S = macroScope();
  binders = [];
  const nOn = h('span', { class: 'msum' });
  bind(() => { const n = abs.filter(d => macroScopeSet(S)[d.id].on).length; nOn.textContent = n ? `${n} on` : ''; });
  const el = h('div', { class: 'mmacros' }, macroScopeTabs(),
    macroSlider('speed', S), macroSlider('intensity', S), macroSlider('saturation', S),
    ...macroColor('color1', S), ...macroColor('color2', S),
    h('div', { class: 'row mshared' }, foldBtn(shared, 'Shared controls', () => toggleMacroOpen('shared'), shared ? 'Fold them' : 'Angle, Softness, Scale, Count, Size, Width, Density, Fade'), nOn),
    shared ? h('div', { class: 'msub' }, abs.map(d => macroSlider(d.id, S))) : null);
  macroBinders = binders; binders = keep;
  return el;
}
// In an effect's Parameters, folded to one line: which macro each of its controls follows, for that effect wherever it
// plays. A control follows the macro its name says, unless the user chooses another, or none.
function macroLinksFold(src, rt) {
  const inps = isfInputs(src).filter(i => macroChoices(rt, i).length);
  if (!inps.length) return [];
  const open = macroOpen().has('links'), roles = macroRolesOf(src, rt), mine = project.macroLinks[src.id] || {};
  const n = inps.filter(i => roles[i.NAME]).length;
  const head = h('div', { class: 'row mshared mlinks' }, foldBtn(open, 'Macros it follows', () => toggleMacroOpen('links'), open ? 'Fold them' : `Which macro each control of ${src.name} follows`),
    h('span', { class: 'msum' }, `${n} of ${inps.length}`));
  if (!open) return [head];
  const rows = inps.map(inp => {
    const label = inp.LABEL || inp.NAME, usual = rt.roles[inp.NAME];
    const r = row(label, selectEl([['', 'Its own value'], ...macroChoices(rt, inp).map(id => [id, macroDef(id).label])], roles[inp.NAME] || '', v => setMacroLink(src, inp.NAME, v), { aria: `What ${label} follows` }));
    if ((roles[inp.NAME] || '') !== (usual || '')) { r.classList.add('mchg'); r.title = `Chosen here. By its name it would follow ${usual ? macroDef(usual).label : 'none'}.`; }
    return r;
  });
  const sub = h('div', { class: 'msub' }, h('p', { class: 'note' }, `For ${src.name} wherever it plays.`), ...rows,
    Object.keys(mine).length ? h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', title: 'Each control follows the macro its name says', onclick: () => resetMacroLinks(src) }, 'As their names say')) : null);
  if (mappingLocked()) lockPanel(sub, 'Operator: you can see what follows the macros but not change it.');
  return [head, sub];
}
// An effect's control that follows a macro: no text in the panel, a thin yellow line (as MIDI's) under its name while that macro
// changes it, what it follows told on pointing at the name. A colour picked for this layer alone (own: the layer, its
// source and the control): the line dashed, and a link to follow the macro again. z: the zone, whose macros it follows
function macroMark(rowEl, id, own, z) {
  const d = macroDef(id), lbl = rowEl && (rowEl.querySelector('.lbl') || (rowEl.classList.contains('checkrow') ? rowEl : null));
  if (!lbl) return;
  const again = own ? h('button', { type: 'button', class: 'relink', title: `Follow ${d.label} again`, 'aria-label': `Follow ${d.label} again`, html: lineIcon('link'),
    onclick: e => { e.stopPropagation(); setOwnCtl(own.L, own.src.id, own.name, false); commit(); renderRight(); } }) : null;
  if (again) lbl.append(again);
  bind(() => {
    const M = macrosOf(z), mine = !!own && ownsCtl(own.L, own.src.id, own.name), on = macroActive(id, M);
    lbl.classList.toggle('mac', on && !mine);
    lbl.classList.toggle('own', mine);
    if (again) again.hidden = !mine;
    if (mine) lbl.dataset.tip = `Its own colour|This layer only, until ${d.label} moves. The link follows ${d.label} again.`;
    else if (on) lbl.dataset.tip = `Follows ${d.label}` + (d.kind === 'color' || d.kind === 'abs' ? '' : ` (${macroText(id, M)})`) + (d.kind === 'color' ? '|A colour picked here is for this layer only.' : '');
    else delete lbl.dataset.tip;
  });
}
// The values shown in the Content tab and in an open colour picker, after something else moved them (a macro, a MIDI
// control), at most once a frame
let contentQueued = false;
function syncContentSoon() {
  if (contentQueued) return;
  contentQueued = true;
  requestAnimationFrame(() => {
    contentQueued = false;
    if (ui.rightTab === 'content' && !ui.rightHidden) syncInspector();
    if (colorPop && colorPop.sync) colorPop.sync();
  });
}
// After a macro moves: its sliders in the MIDI window, the notes and the swatches of the Content tab, and the MIDI marks
function updateMacrosUI() { updateMidiUI(); syncContentSoon(); }
