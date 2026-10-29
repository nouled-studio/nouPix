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
// A label with a tick that switches a colour or a shared control on and off
function macroSwitch(id, label) {
  const d = macroDef(id), box = h('input', { type: 'checkbox', 'aria-label': d.label + ' on', title: 'On: the effects follow it. Off: each keeps its own.', onchange: e => setMacro(id, { on: e.target.checked }) });
  bind(() => { box.checked = !!project.macros[id].on; });
  return h('span', { class: 'lbl mlbl' }, box, label);
}
// A macro's slider: moving it (or its MIDI control) turns a shared control on
function macroSlider(id) {
  const d = macroDef(id), holder = { get v() { return project.macros[id].v; }, set v(x) { setMacro(id, { v: x }); } };
  const r = sliderRow(d.label, holder, 'v', { min: 0, max: macroMax(d), step: 0.01, fmt: d.kind === 'mult' ? v => v.toFixed(2) + '×' : pct, midi: 'm:' + id,
    label: d.kind === 'abs' ? macroSwitch(id, d.label) : null });
  if (d.kind === 'abs') bind(() => r.classList.toggle('off', !project.macros[id].on));
  r.title = d.kind === 'mult' ? 'Every effect\'s speed: 1× leaves them as they are.' : id === 'intensity' ? 'The level of every layer: 100 % leaves them as they are.'
    : id === 'saturation' ? 'Every effect\'s saturation: 100 % leaves them as they are.' : `Sets the ${d.label.toLowerCase()} of every effect that has one, each in its own range.`;
  return r;
}
// A colour macro: its switch and its swatch; opened, a slider for each part, which a MIDI fader can drive
function macroColor(id) {
  const d = macroDef(id), open = macroOpen().has(id), m = project.macros[id];
  const fill = h('i'), hex = h('span', { class: 'mono' });
  const r = row(macroSwitch(id, foldBtn(open, d.label, () => toggleMacroOpen(id), open ? 'Fold its parts' : 'Its hue, saturation and value, for MIDI faders')),
    h('span', { class: 'cswatch still', title: 'The colour the effects follow while it is on' }, fill, hex));
  r.classList.add('mcolor');
  r.dataset.midi = `m:${id}.0`;   // learnt as its first part (Hue, or Red in RGB); opened, each part has its slider
  bind(() => { const c = toHex(macroRgb(project.macros[id])); fill.style.background = c; hex.textContent = c; r.classList.toggle('off', !project.macros[id].on); });
  if (!open) return [r];
  const mode = seg([['hsv', 'HSV'], ['rgb', 'RGB']], m.mode, v => { setMacro(id, { mode: v, on: project.macros[id].on }); renderRight(); });
  const parts = MACRO_PARTS[m.mode].map(([k, name], i) => {
    const hue = k === 'h', holder = { get v() { return macroPart(project.macros[id], i) * (hue ? 360 : 1); }, set v(x) { setMacroPart(id, i, hue ? x / 360 : x); } };
    return sliderRow(name, holder, 'v', { min: 0, max: hue ? 360 : 1, step: hue ? 1 : 0.01, fmt: hue ? v => Math.round(v) + '°' : pct, midi: `m:${id}.${i}` });
  });
  return [r, h('div', { class: 'msub' }, row('Sliders', mode), ...parts)];
}
// The macros, for the MIDI window. Its binders are its own (macroBinders), run each time it is brought up to date, so
// a fader moving a macro moves its slider there.
let macroBinders = [];
function macrosPanel() {
  const shared = macroOpen().has('shared'), abs = MACROS.filter(d => d.kind === 'abs'), keep = binders;
  binders = [];
  const nOn = h('span', { class: 'msum' });
  bind(() => { const n = abs.filter(d => project.macros[d.id].on).length; nOn.textContent = n ? `${n} on` : ''; });
  const el = h('div', { class: 'mmacros' },
    macroSlider('speed'), macroSlider('intensity'), macroSlider('saturation'),
    ...macroColor('color1'), ...macroColor('color2'),
    h('div', { class: 'row mshared' }, foldBtn(shared, 'Shared controls', () => toggleMacroOpen('shared'), shared ? 'Fold them' : 'Angle, Softness, Scale, Count, Size, Width, Density, Fade'), nOn),
    shared ? h('div', { class: 'msub' }, abs.map(d => macroSlider(d.id))) : null);
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
// Under an effect's control: the macro it follows, while that macro changes it
function macroFollows(id) {
  const d = macroDef(id), el = h('p', { class: 'note via' });
  bind(() => { const on = macroActive(id); el.hidden = !on; if (on) el.textContent = `Follows ${d.label}` + (d.kind === 'color' || d.kind === 'abs' ? '' : ` (${macroText(id)})`); });
  return el;
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
