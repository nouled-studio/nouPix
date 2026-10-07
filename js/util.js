// openLedMapper · js/util.js
// Small helpers used everywhere: page elements ($, $$, h, svgEl), numbers and text (clamp, wrap180, fmtN, pct…),
// local storage (store), toast messages, error reports, file download and the icon set. Uses nothing else.

/* ---------- utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'draggable') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const svgEl = markup => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const rad = d => d * Math.PI / 180;
const wrap180 = a => ((a % 360) + 540) % 360 - 180;   // an angle in degrees, as -180 to 180
const wrap360 = a => ((a % 360) + 360) % 360;         // an angle in degrees, as 0 to 360
const fmtN = n => Math.round(n).toLocaleString('en-US');
const fmtV = v => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
function parseIP(s) {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(s || '');
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every(x => x <= 255) ? b : null;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; } catch (e) { return false; } },
  remove(k) { try { localStorage.removeItem(k); } catch (e) { /* storage off */ } },
};
// This app was called Weft before: what it kept in the browser carries over (once, and only where nothing newer is kept)
function carryOverStorage() {
  for (const k of ['project', 'ui', 'guide', 'project.unopened']) {
    try {
      const v = localStorage.getItem('weft.' + k);
      if (v == null || localStorage.getItem('openledmapper.' + k) != null) continue;
      localStorage.removeItem('weft.' + k); // makes room for the copy
      try { localStorage.setItem('openledmapper.' + k, v); } catch (e) { localStorage.setItem('weft.' + k, v); }
    } catch (e) { /* storage off */ }
  }
}
function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}
function debounce(fn, ms) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }
// An error in one part of a frame (a shader, the stage) must not stop the output or the stage: it is logged once
const reported = new Set();
function report(where, e) {
  const key = where + ': ' + ((e && e.message) || e);
  if (reported.has(key)) return;
  reported.add(key);
  console.error('openLedMapper, ' + key, e);
}
function download(name, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const ICONS = {
  line: '<svg viewBox="0 0 16 16"><path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.5"/><circle cx="2.5" cy="13.5" r="1.6" fill="currentColor"/><circle cx="13.5" cy="2.5" r="1.6" fill="currentColor"/></svg>',
  matrix: '<svg viewBox="0 0 16 16"><g fill="currentColor"><rect x="2" y="2" width="3" height="3"/><rect x="6.5" y="2" width="3" height="3"/><rect x="11" y="2" width="3" height="3"/><rect x="2" y="6.5" width="3" height="3"/><rect x="6.5" y="6.5" width="3" height="3"/><rect x="11" y="6.5" width="3" height="3"/><rect x="2" y="11" width="3" height="3"/><rect x="6.5" y="11" width="3" height="3"/><rect x="11" y="11" width="3" height="3"/></g></svg>',
  circle: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="2.5" r="1.6" fill="currentColor"/></svg>',
  path: '<svg viewBox="0 0 16 16"><path d="M2 12c3-7 4 1 7-3s4-5 5-5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  isf: '<svg viewBox="0 0 16 16"><path d="M5 4L2 8l3 4M11 4l3 4-3 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  image: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 12l3.5-4 2.5 3 1.5-1.5L13 12" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  video: '<svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 6v4l3.5-2z" fill="currentColor"/></svg>',
  screen: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 14h4M8 11v3" stroke="currentColor" stroke-width="1.4"/></svg>',
  eye: '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16"><path d="M2 2l12 12M6.2 4A7 7 0 018 3.5C12 3.5 14.5 8 14.5 8a12 12 0 01-2 2.6M9.9 12.2A6 6 0 018 12.5C4 12.5 1.5 8 1.5 8a12 12 0 012.4-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  bulb: '<svg viewBox="0 0 16 16"><path d="M8 1.8a4.3 4.3 0 00-2.6 7.7c.5.4.8 1 .8 1.6v.6h3.6v-.6c0-.6.3-1.2.8-1.6A4.3 4.3 0 008 1.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.3 13.2h3.4M6.8 14.8h2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  unlock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 014.9-.7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  zone: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.5 1.8"/><rect x="1" y="2" width="3" height="3" fill="currentColor"/><rect x="12" y="11" width="3" height="3" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 12 12" width="11" height="11"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5"/></svg>',
  alignL: '<svg viewBox="0 0 16 16"><path d="M2.5 1.5v13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><g fill="currentColor"><rect x="4.5" y="4" width="9" height="3" rx=".6"/><rect x="4.5" y="9" width="5.5" height="3" rx=".6"/></g></svg>',
  alignCX: '<svg viewBox="0 0 16 16"><path d="M8 1.5v13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><g fill="currentColor"><rect x="3" y="4" width="10" height="3" rx=".6"/><rect x="5" y="9" width="6" height="3" rx=".6"/></g></svg>',
  alignR: '<svg viewBox="0 0 16 16"><path d="M13.5 1.5v13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><g fill="currentColor"><rect x="2.5" y="4" width="9" height="3" rx=".6"/><rect x="6" y="9" width="5.5" height="3" rx=".6"/></g></svg>',
  alignT: '<svg viewBox="0 0 16 16"><path d="M1.5 2.5h13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><g fill="currentColor"><rect x="4" y="4.5" width="3" height="9" rx=".6"/><rect x="9" y="4.5" width="3" height="5.5" rx=".6"/></g></svg>',
  alignCY: '<svg viewBox="0 0 16 16"><path d="M1.5 8h13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><g fill="currentColor"><rect x="4" y="3" width="3" height="10" rx=".6"/><rect x="9" y="5" width="3" height="6" rx=".6"/></g></svg>',
  alignB: '<svg viewBox="0 0 16 16"><path d="M1.5 13.5h13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><g fill="currentColor"><rect x="4" y="2.5" width="3" height="9" rx=".6"/><rect x="9" y="6" width="3" height="5.5" rx=".6"/></g></svg>',
  distH: '<svg viewBox="0 0 16 16"><path d="M1.5 2v12M14.5 2v12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".55"/><g fill="currentColor"><rect x="3.6" y="4" width="2.2" height="8" rx=".5"/><rect x="6.9" y="4" width="2.2" height="8" rx=".5"/><rect x="10.2" y="4" width="2.2" height="8" rx=".5"/></g></svg>',
  distV: '<svg viewBox="0 0 16 16"><path d="M2 1.5h12M2 14.5h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".55"/><g fill="currentColor"><rect x="4" y="3.6" width="8" height="2.2" rx=".5"/><rect x="4" y="6.9" width="8" height="2.2" rx=".5"/><rect x="4" y="10.2" width="8" height="2.2" rx=".5"/></g></svg>',
  centre: '<svg viewBox="0 0 16 16"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="5.5" y="5.5" width="5" height="5" rx=".6" fill="currentColor"/></svg>',
  group: '<svg viewBox="0 0 16 16"><path d="M1.75 4.25a1 1 0 011-1h3.2l1.5 1.5h5.8a1 1 0 011 1v6.5a1 1 0 01-1 1H2.75a1 1 0 01-1-1z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/></svg>',
  groupAdd: '<svg viewBox="0 0 16 16"><path d="M1.75 4.25a1 1 0 011-1h3.2l1.5 1.5h5.8a1 1 0 011 1v6.5a1 1 0 01-1 1H2.75a1 1 0 01-1-1z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M8 7.2v4M6 9.2h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  ungroup: '<svg viewBox="0 0 16 16"><path d="M1.75 4.25a1 1 0 011-1h3.2l1.5 1.5h5.8a1 1 0 011 1v6.5a1 1 0 01-1 1H2.75a1 1 0 01-1-1z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" stroke-dasharray="2.2 1.6"/><path d="M6 9.2h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  panel: '<svg viewBox="0 0 16 16"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 3v10" stroke="currentColor" stroke-width="1.3"/><rect x="10.6" y="3.4" width="3" height="9.2" fill="currentColor" opacity=".45"/></svg>',
  chev: '<svg viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const icon = name => svgEl(ICONS[name]);

/* ---------- checking values ---------- */
// Project files can be older, partial or edited by hand. Missing or unreadable values get their defaults,
// so the file opens instead of stopping the app; complete files come through unchanged.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = v => (typeof v === 'string' && v !== '') || (typeof v === 'number' && isFinite(v));
// a finite number, or a string holding one; anything else gets the default
const numOr = (v, d) => (typeof v === 'number' ? (isFinite(v) ? v : d) : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : d);

/* ---------- formats ---------- */
const pct = v => Math.round(v * 100) + '%';
// For JSON.stringify: leaves out the keys starting with _ (worked out at run time, never saved)
const replacer = (k, v) => (k.startsWith('_') ? undefined : v);
// Several fixtures align to the box around all of them, a single one to the canvas. Locked fixtures stay put,
// but still count for the box, so the others can be lined up with one that is locked.
// With one whole group selected, its fixtures are lined up with each other. Otherwise each whole group in the
// selection moves as one block (a block holding a locked fixture stays put), and the other fixtures one by one.
const r3 = v => Math.round(v * 1000) / 1000;
const fmtDur = d => !isFinite(d) ? 'live' : `${Math.floor(d / 60)}:${(d % 60).toFixed(1).padStart(4, '0')}`;

/* ---------- keys ---------- */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl ';
const typingIn = t => t && t.closest && t.closest('input:not([type=checkbox]):not([type=range]):not([type=color]), textarea, select, [contenteditable="true"]');
