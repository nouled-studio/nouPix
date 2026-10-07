// openLedMapper · js/ui-forms.js
// Form building blocks for the panels: rows, number and slider inputs, selects, segmented buttons, lists that
// reorder by dragging, and the animation of rows that move.

/* ---------- form helpers ---------- */
let binders = [];
function syncInspector() { for (const b of binders) b(); }
const row = (label, ...ctl) => h('div', { class: 'row' }, typeof label === 'string' ? h('span', { class: 'lbl' }, label) : label, ctl.length > 1 ? h('div', { class: 'pair' }, ctl) : ctl[0]);
const sec = (title, ...kids) => h('div', { class: 'sec' }, title ? h('h3', null, title) : null, kids);
function numInput(obj, key, o = {}) {
  const inp = h('input', { type: 'number', step: o.step ?? 1, value: fmtV(obj[key]), id: o.id, 'aria-label': o.aria || o.prefix || key });
  const set = v => { if (!isFinite(v)) return; if (o.int) v = Math.round(v); obj[key] = clamp(v, o.min ?? -1e9, o.max ?? 1e9); if (o.onInput) o.onInput(obj[key]); };
  inp.addEventListener('input', () => set(parseFloat(inp.value)));
  inp.addEventListener('change', () => { inp.value = fmtV(obj[key]); if (o.onCommit) o.onCommit(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  binders.push(() => { if (document.activeElement !== inp) inp.value = fmtV(obj[key]); });
  return o.prefix ? h('div', { class: 'inp' }, h('b', null, o.prefix), inp) : inp;
}
function scrub(text, obj, key, o = {}) {
  const lab = h('label', { class: 'scrub', title: 'Drag sideways to adjust (Shift = ×10)' }, text);
  lab.addEventListener('pointerdown', e => {
    e.preventDefault(); lab.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = obj[key]; let moved = false;
    const mv = ev => {
      moved = true;
      let v = v0 + (ev.clientX - x0) * (o.step ?? 1) * (ev.shiftKey ? 10 : 1);
      if (o.int) v = Math.round(v);
      obj[key] = clamp(v, o.min ?? -1e9, o.max ?? 1e9);
      if (o.onInput) o.onInput(obj[key]);
      syncInspector();
    };
    const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); if (moved && o.onCommit) o.onCommit(); };
    lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
  });
  return lab;
}
const numRow = (text, obj, key, o = {}) => row(scrub(text, obj, key, o), numInput(obj, key, Object.assign({ aria: text }, o)));
function textInput(obj, key, o = {}) {
  const inp = h('input', { type: 'text', value: obj[key] ?? '', id: o.id, placeholder: o.placeholder || '', spellcheck: 'false', 'aria-label': o.aria || key });
  inp.addEventListener('input', () => { obj[key] = inp.value; if (o.onInput) o.onInput(inp.value, inp); });
  inp.addEventListener('change', () => { if (o.onCommit) o.onCommit(inp.value, inp); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  return inp;
}
function selectEl(options, value, onChange, o = {}) {
  const s = h('select', { id: o.id, 'aria-label': o.aria || '' }, options.map(([v, l]) => h('option', { value: String(v) }, l)));
  s.value = String(value);
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function checkRow(text, obj, key, onChange) {
  const id = 'c_' + uid();
  const c = h('input', { type: 'checkbox', id, checked: !!obj[key] });
  c.addEventListener('change', () => { obj[key] = c.checked; onChange && onChange(c.checked); });
  binders.push(() => { c.checked = !!obj[key]; });
  return h('label', { class: 'checkrow', for: id }, c, text);
}
function sliderRow(text, obj, key, o = {}) {
  const fmt = o.fmt || (v => fmtV(v));
  const val = h('span', { class: 'mono' }, fmt(obj[key]));
  const r = h('input', { type: 'range', min: o.min ?? 0, max: o.max ?? 1, step: o.step ?? 0.01, value: obj[key], 'aria-label': text });
  r.addEventListener('input', () => { obj[key] = parseFloat(r.value); val.textContent = fmt(obj[key]); if (o.onInput) o.onInput(obj[key]); });
  r.addEventListener('change', () => { if (o.onCommit) o.onCommit(); });
  binders.push(() => { if (document.activeElement !== r) { r.value = obj[key]; val.textContent = fmt(obj[key]); } });
  return row(text, h('div', { class: 'slider' }, r, val));
}
function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' });
  for (const [v, l] of options) {
    const b = h('button', { type: 'button', class: String(v) === String(value) ? 'on' : '' }, l);
    b.addEventListener('click', () => { $$('button', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(v); });
    el.append(b);
  }
  return el;
}

// The colour tag swatches of a fixture, group or zone
function tagSwatches(o, label) {
  return h('div', { class: 'swatches' }, TAGS.map(c => h('button', { type: 'button', class: o.tag === c ? 'on' : '', style: { background: c }, 'aria-label': label + ' ' + c, onclick: () => { o.tag = c; commit(); renderRight(); } })));
}
// The row a list shows when it is empty
function emptyRow(text) { return h('li', { class: 'empty', style: { display: 'block', height: 'auto', cursor: 'default' } }, text); }
// How a source fits its zone
const FIT_OPTIONS = [['fit', 'Fit'], ['fill', 'Fill'], ['stretch', 'Stretch']];
// Highlight, Duplicate and Delete, under the inspector of one or more fixtures
function selectionActions() {
  return h('div', { class: 'actions' },
    h('button', { class: 'btn', type: 'button', onclick: toggleIdentify }, ui.outputMode !== 'content' ? 'Stop highlight' : 'Highlight'),
    h('button', { class: 'btn', type: 'button', onclick: duplicateSel }, 'Duplicate'),
    h('button', { class: 'btn danger-t', type: 'button', onclick: deleteSel }, 'Delete'));
}

/* ---------- drag to reorder ---------- */
// Items of a list are dragged to put them in another order: the dragged item goes above or below the one it
// is dropped on, by which half of that item the pointer is over. Sliders and buttons inside an item keep
// working. The drag can start on one element (a zone's header) and be dropped on a bigger one (its row).
const dragType = kind => 'application/x-openledmapper-' + kind;
function reorderable(handle, target, kind, ids, onDrop) {
  const locked = () => kind === 'zone' && mappingLocked();   // the order of zones is part of the mapping
  handle.draggable = !locked();
  handle.addEventListener('pointerdown', e => { handle.draggable = !locked() && !e.target.closest('input, button, select'); });
  handle.addEventListener('dragstart', e => {
    if (e.target !== handle) return;
    e.dataTransfer.setData(dragType(kind), ids().join(','));
    e.dataTransfer.effectAllowed = 'move';
    handle.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => handle.classList.remove('dragging'));
  const after = e => { const r = target.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  const clear = () => target.classList.remove('drop-before', 'drop-after');
  target.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes(dragType(kind))) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const a = after(e);
    target.classList.toggle('drop-before', !a); target.classList.toggle('drop-after', a);
  });
  target.addEventListener('dragleave', e => { if (!target.contains(e.relatedTarget)) clear(); });
  target.addEventListener('drop', e => {
    const d = e.dataTransfer.getData(dragType(kind));
    clear();
    if (!d) return;
    e.preventDefault();
    onDrop(d.split(','), after(e));
  });
}

/* ---------- rows that move ---------- */
// Rows that change place glide from where they were to where they are now, so a move is easy to follow, and the
// moved ones flash. change() rebuilds the rows; rows are matched by data-id. A panel rebuilt again while they
// glide (the patch panel is, a frame later) picks the motion up where it was: see replayFlip.
let lastFlip = null;
const FLIP_MS = 280, FLASH_MS = 900;
function flipRows(sel, change, moved = []) {
  const before = new Map($$(sel).map(el => [el.dataset.id, el.getBoundingClientRect().top]));
  change();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const set = new Set(moved), items = new Map();
  for (const el of $$(sel)) {
    const t0 = before.get(el.dataset.id);
    if (t0 == null || el.hidden) continue;
    const dy = t0 - el.getBoundingClientRect().top, mine = set.has(el.dataset.id);
    if (Math.abs(dy) > 0.5 || mine) items.set(el.dataset.id, { dy, mine });
  }
  lastFlip = { sel, items, t0: performance.now() };
  replayFlip();
}
function replayFlip() {
  if (!lastFlip) return;
  const t = performance.now() - lastFlip.t0;
  if (t > FLASH_MS) { lastFlip = null; return; }
  for (const el of $$(lastFlip.sel)) {
    const it = lastFlip.items.get(el.dataset.id);
    if (!it || el.getAnimations().length) continue;
    if (Math.abs(it.dy) > 0.5 && t < FLIP_MS) {
      if (it.mine) { el.style.position = 'relative'; el.style.zIndex = 2; }
      el.animate([{ transform: `translateY(${it.dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, delay: -t, easing: 'cubic-bezier(.2,.75,.25,1)' })
        .finished.then(() => { el.style.zIndex = ''; el.style.position = ''; }, () => {});
    }
    if (it.mine) el.animate([{ boxShadow: '0 0 0 1px #3cc8ff, 0 0 14px rgba(60,200,255,.55)' }, { boxShadow: '0 0 0 1px rgba(60,200,255,0), 0 0 14px rgba(60,200,255,0)' }], { duration: FLASH_MS, delay: -t, easing: 'ease-out' });
  }
}
