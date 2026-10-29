// nouPix · js/ui-forms.js
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
  let before = null;
  shiftWheel(inp, n => { if (before === null) before = obj[key]; set(notchFrom(obj[key], n, o.step ?? 1)); inp.value = fmtV(obj[key]); syncInspector(); },
    () => { const was = before; before = null; if (was !== null && obj[key] !== was && o.onCommit) o.onCommit(); });
  binders.push(() => { if (document.activeElement !== inp) inp.value = fmtV(obj[key]); });
  return o.prefix ? h('div', { class: 'inp' }, h('b', null, o.prefix), inp) : inp;
}
// Shift + scroll over a slider or a number changes it a notch at a time; without Shift the panel scrolls as usual.
// A click of a mouse wheel is a notch (120 in wheelDelta). Anything finer (a trackpad, a Mac's mouse) adds up, a
// notch every WHEEL_PX, and the first move after a pause is always a notch. nudge(n) moves n notches (up is
// more); done() runs once the scrolling stops, to make it one step of undo.
const WHEEL_PX = 40;
function shiftWheel(el, nudge, done) {
  let acc = 0, last = 0, timer = 0;
  el.addEventListener('wheel', e => {
    if (!e.shiftKey || el.disabled) return;
    e.preventDefault();
    const now = performance.now(), fresh = now - last > 150;
    last = now;
    let n;
    const wd = e.wheelDeltaY || e.wheelDeltaX;   // with Shift, some systems scroll sideways
    if (wd && wd % 120 === 0) n = wd / 120;
    else {
      if (fresh) acc = 0;
      acc -= (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? WHEEL_PX / 3 : e.deltaMode === 2 ? WHEEL_PX * 3 : 1);
      n = Math.trunc(acc / WHEEL_PX);
      if (!n && fresh && acc) { n = Math.sign(acc); acc = 0; } else acc -= n * WHEEL_PX;
    }
    if (!n) return;
    nudge(clamp(n, -10, 10));
    clearTimeout(timer);
    timer = setTimeout(done, 400);
  }, { passive: false });
}
// A round step for a range: about a hundredth of it, as 1, 2 or 5 times a power of ten
function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
// n notches on from v, landing on whole notches (0.37 up by 0.05 is 0.4, then 0.45)
function notchFrom(v, n, notch) {
  const q = v / notch;
  return Math.round((n > 0 ? Math.floor(q + 1e-6) + n : Math.ceil(q - 1e-6) + n) * notch * 1e6) / 1e6;
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
// A short explanation of a row, shown on pointing at its label (faintly underlined), instead of text in the panel
function tipRow(el, text) {
  const lab = el.classList.contains('checkrow') ? el : el.firstElementChild;
  lab.dataset.tip = `${lab.textContent.trim()}|${text}`;
  lab.classList.add('hastip');
  return el;
}
function checkRow(text, obj, key, onChange) {
  const id = 'c_' + uid();
  const c = h('input', { type: 'checkbox', id, checked: !!obj[key] });
  c.addEventListener('change', () => { obj[key] = c.checked; onChange && onChange(c.checked); });
  binders.push(() => { c.checked = !!obj[key]; });
  return h('label', { class: 'checkrow', for: id }, c, text);
}
// A slider and its value. Double-click the value (or Enter on it, or start typing a number on it) to type one; the
// arrow keys on it, and Shift + scroll over the slider, move it a notch at a time (o.notch, or about a hundredth of
// the range). A value shown as a percentage is typed as one. o.wrap: the value goes round (angles), so 370 is 10 and
// a notch past the top starts again at the bottom. o.int: whole numbers only.
// A small explanation under anything marked data-tip ("Title|What it does"), after a short pause over it
function initTips(doc = document) {
  let el = null, on = null, timer = 0;
  const hide = () => { clearTimeout(timer); on = null; if (el) el.hidden = true; };
  doc.addEventListener('pointerover', e => {
    const t = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t === on) return;
    hide();
    if (!t) return;
    on = t;
    timer = setTimeout(() => {
      if (!el) { el = h('div', { class: 'tip', role: 'tooltip' }); doc.body.append(el); }
      const [head, text] = t.dataset.tip.split('|');
      el.replaceChildren(h('b', {}, head), text ? h('span', {}, text) : '');
      el.hidden = false;
      const r = t.getBoundingClientRect(), w = el.offsetWidth, vw = doc.documentElement.clientWidth;
      el.style.left = clamp(r.left + r.width / 2 - w / 2, 6, vw - w - 6) + 'px';
      el.style.top = r.bottom + 6 + 'px';
    }, 350);
  });
  doc.addEventListener('pointerout', e => { if (!e.relatedTarget) hide(); });
  doc.addEventListener('pointerdown', hide, true);
  doc.addEventListener('keydown', hide, true);
}
function sliderRow(text, obj, key, o = {}) {
  const fmt = o.fmt || (v => fmtV(v));
  const min = o.min ?? 0, max = o.max ?? 1, step = o.step ?? 0.01, k = o.fmt === pct ? 100 : 1;
  const notch = o.notch ?? Math.max(step, niceStep((max - min) / 100));
  const val = h('span', { class: 'mono sval', tabindex: 0, title: 'Double-click to type a value. Shift + scroll to change it.', 'aria-label': text + ': type a value' }, fmt(obj[key]));
  const r = h('input', { type: 'range', min, max, step, value: obj[key], 'aria-label': text });
  const show = () => { r.value = obj[key]; val.textContent = fmt(obj[key]); };
  // a typed or stepped value: kept in the range (or taken round it), whole on whole-number sliders, applied live
  const put = v => {
    if (!isFinite(v)) return;
    if (o.wrap && (v < min || v > max)) { const span = max - min; v = min + (((v - min) % span) + span) % span; }
    v = clamp(Math.round(v * 1e6) / 1e6, min, max);
    if (o.int) v = Math.round(v);
    obj[key] = v; show();
    if (o.onInput) o.onInput(v);
  };
  r.addEventListener('input', () => { obj[key] = parseFloat(r.value); val.textContent = fmt(obj[key]); if (o.onInput) o.onInput(obj[key]); });
  r.addEventListener('change', () => { if (o.onCommit) o.onCommit(); });
  // notches from the wheel or the arrow keys: one step of undo once they stop
  let before = null, timer = 0;
  const settle = () => { clearTimeout(timer); const was = before; before = null; if (was !== null && obj[key] !== was && o.onCommit) o.onCommit(); };
  const nudge = n => {
    if (r.disabled) return;
    if (before === null) before = obj[key];
    put(notchFrom(obj[key], n, notch));
    clearTimeout(timer); timer = setTimeout(settle, 400);
  };
  // typing a value; first: what the box starts with (a key typed on the value), else the value itself
  const edit = first => {
    if (r.disabled || !val.isConnected) return;
    settle();
    const was = obj[key], start = String(Math.round(was * k * 1e4) / 1e4);
    const inp = h('input', { type: 'text', class: 'mono sedit', inputmode: 'decimal', spellcheck: 'false', 'aria-label': text, value: first ?? start });
    let over = false;
    const finish = ok => {
      if (over) return;
      over = true;
      if (ok && inp.value.trim() !== start) put(parseFloat(inp.value.replace(',', '.')) / k);
      if (inp.isConnected) inp.replaceWith(val);
      show();
      if (obj[key] !== was && o.onCommit) o.onCommit();
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(e.key === 'Enter'); val.focus(); }
    });
    inp.addEventListener('blur', () => finish(true));
    val.replaceWith(inp);
    inp.focus();
    if (first == null) inp.select();
  };
  val.addEventListener('dblclick', () => edit());
  // keys on the value are for it: they don't reach the stage (digits would play scenes, arrows move fixtures)
  val.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (e.key === 'Enter' || e.key === 'F2') edit();
    else if (/^[0-9.,-]$/.test(e.key)) edit(e.key);
    else if (dir) nudge(dir * (e.shiftKey ? 10 : 1));
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  // o.midi: what a MIDI control drives through this slider (it gets the fader's line and tag, see ui-midi.js);
  // o.label: an element in place of the text, before the slider
  const wrap = h('div', { class: 'slider' }, o.midi ? midiSlot(r, o.midi) : r, val);
  shiftWheel(wrap, nudge, settle);
  binders.push(() => { if (document.activeElement !== r) show(); });
  return row(o.label || text, wrap);
}
// A row that scrolls sideways (scenes, a playlist's steps): no scroll bar, its edges fade where there is more, and
// ‹ › buttons there scroll it a few tiles at a time. keep: a name, so the row stays where it was when it is drawn
// anew (keepScroll).
function hscroller(el, keep) {
  el.classList.add('hsx');
  if (keep) el.dataset.keep = keep;
  const go = d => el.scrollBy({ left: d * Math.max(120, el.clientWidth * 0.75), behavior: 'smooth' });
  const left = h('button', { class: 'harrow l', type: 'button', tabindex: -1, title: 'Scroll left', 'aria-label': 'Scroll left', html: ICONS.chev, onclick: e => { e.stopPropagation(); go(-1); } });
  const right = h('button', { class: 'harrow r', type: 'button', tabindex: -1, title: 'Scroll right', 'aria-label': 'Scroll right', html: ICONS.chev, onclick: e => { e.stopPropagation(); go(1); } });
  const box = h('div', { class: 'hscroll' }, el, left, right);
  const show = () => {
    const max = el.scrollWidth - el.clientWidth;
    box.classList.toggle('canl', el.scrollLeft > 2);
    box.classList.toggle('canr', el.scrollLeft < max - 2);
  };
  el._hshow = show;
  el.addEventListener('scroll', show, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(show).observe(el);
  requestAnimationFrame(show);
  return box;
}
// One of those windows to the front. focus() does in a browser, though not from minimised; the app also restores it
// when its address changes to #raise… (desktop/main.js), a move inside the page that leaves what is drawn there alone
function raiseWindow(w) {
  try { w.focus(); w.location.hash = 'raise' + Date.now(); } catch (e) { /* closing */ }
}
// A window this page draws into (the MIDI window, the Scenes window): the same fonts and styles, its title and class;
// messages, menus and dialogs asked for there show there (watchDoc)
function dressWindow(w, title, cls) {
  const d = w.document;
  d.head.replaceChildren(...$$('head link[rel=stylesheet], head link[rel=icon]').map(l => { const c = d.createElement('link'); c.rel = l.rel; c.href = l.href; return c; }));
  d.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';   // its look follows this page's
  d.addEventListener('input', rangeInput, true);
  d.title = title;
  d.body.className = cls;
  d.body.replaceChildren();
  watchDoc(d);
  return d;
}
// The scrolling parts of a panel stay where they were when it is drawn anew (a scene played, a playlist moving on)
function keepScroll(root, draw) {
  const at = new Map($$('[data-keep]', root).map(el => [el.dataset.keep, [el.scrollLeft, el.scrollTop]]));
  draw();
  for (const el of $$('[data-keep]', root)) {
    const s = at.get(el.dataset.keep);
    if (s) { el.scrollLeft = s[0]; el.scrollTop = s[1]; }
    if (el._hshow) el._hshow();
  }
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

// The colour of a group, a zone or a scene: none (the first swatch), or one of TAGS
// (a scene's, in its dialog: onPick only marks the choice, Save keeps it)
function tagSwatches(o, label, onPick = () => { commit(); renderRight(); redrawStage(); }) {
  const pick = c => e => { o.tag = c; $$('button', e.currentTarget.parentNode).forEach(b => b.classList.toggle('on', b === e.currentTarget)); onPick(); };
  return h('div', { class: 'swatches' },
    h('button', { type: 'button', class: 'none' + (o.tag ? '' : ' on'), title: 'No colour', 'aria-label': label + ': none', onclick: pick('') }),
    TAGS.map(c => h('button', { type: 'button', class: o.tag === c ? 'on' : '', style: { background: c }, 'aria-label': label + ' ' + c, onclick: pick(c) })));
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
const dragType = kind => 'application/x-noupix-' + kind;
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
    if (it.mine) { const a = getComputedStyle(el).getPropertyValue('--accent').trim(); el.animate([{ boxShadow: `0 0 0 1px ${a}` }, { boxShadow: '0 0 0 1px transparent' }], { duration: FLASH_MS, delay: -t, easing: 'ease-out' }); }
  }
}

/* ---------- sliders: the track filled up to the value ---------- */
// css/app.css fills a slider's track up to --p. Code that moves a slider (MIDI, a fade, a device, undo) sets its
// value, so the value setter keeps --p; the user moves it with input events, caught here and in every window this
// page draws into (dressWindow). A slider built by h() gets min and max after its value: a microtask settles it.
function rangeFill(el) {
  const min = el.min === '' ? 0 : +el.min, max = el.max === '' ? 100 : +el.max;
  el.style.setProperty('--p', (max > min ? clamp((+el.value - min) / (max - min), 0, 1) * 100 : 0) + '%');
}
const rangeInput = e => { if (isEl(e.target) && e.target.type === 'range') rangeFill(e.target); };
(() => {
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(HTMLInputElement.prototype, 'value', { configurable: true, enumerable: d.enumerable, get() { return d.get.call(this); },
    set(v) { d.set.call(this, v); if (this.type === 'range') { rangeFill(this); queueMicrotask(() => rangeFill(this)); } } });
  document.addEventListener('input', rangeInput, true);
})();
