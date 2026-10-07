// openLedMapper · js/project-io.js
// Project files: repairing what is opened (hydrate), saving and autosave, undo and redo, project and CSV files,
// SVG import and the demo project. Uses the engine files above; after a change it redraws through renderAll and friends.

/* ---------- opening project files ---------- */
const uniqueId = (v, seen) => { const id = isId(v) && !seen.has(v) ? v : uid(); seen.add(id); return id; };
function fixSettings(given) {
  const s = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), isObj(given) ? given : {});
  for (const [k, d] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof d === 'number') s[k] = numOr(s[k], d);
    else if (typeof d === 'string' && typeof s[k] !== 'string') s[k] = d;
  }
  s.compW = clamp(Math.round(s.compW), 16, 8192); s.compH = clamp(Math.round(s.compH), 16, 8192);
  s.fps = clamp(s.fps, 1, 100);
  if (!['off', 'sub', 'add'].includes(s.whiteMode)) s.whiteMode = 'off';
  // 255.255.255.255 was the default address for ArtPoll; discovery now goes to the networks chosen in Nodes
  if (s.broadcast.trim() === '255.255.255.255') s.broadcast = '';
  delete s.trim;   // the colour trims are per fixture now (see hydrate)
  return s;
}
let legacyTrim = [1, 1, 1, 1];
// Gamma is set per fixture (LED types differ). Files from before had one gamma for all: each fixture starts from it.
let legacyGamma = 1;
function fixFixture(f, i, ids) {
  const fields = FIXTURE_FIELDS[f.type];
  for (const [k, d] of Object.entries(fields)) {
    if (typeof d === 'number') f[k] = numOr(f[k], d);
    else if (typeof d === 'string') { if (typeof f[k] !== 'string') f[k] = d; }
    else if (!(k in f)) f[k] = JSON.parse(JSON.stringify(d));
  }
  // at most a million pixels per fixture: a typo like 1e9 would not fit in memory
  if (f.type === 'matrix') {
    f.cols = Math.min(f.cols, 4096); f.rows = Math.min(f.rows, Math.floor(1e6 / Math.max(1, f.cols | 0)));
    if (!['TL', 'TR', 'BL', 'BR'].includes(f.start)) f.start = 'TL';
    if (f.dir !== 'H' && f.dir !== 'V') f.dir = 'H';
  } else f.pixels = Math.min(f.pixels, 1e6);
  if (f.type === 'circle' && 'ry' in f) { const ry = numOr(f.ry, NaN); if (ry > 0) f.ry = ry; else delete f.ry; }
  if (f.type === 'circle' && 'rot' in f) { const r = numOr(f.rot, 0); if (r) f.rot = r; else delete f.rot; }   // an oval turned
  if (f.type === 'path') {
    const P = Array.isArray(f.pts) && f.pts.every(v => typeof v === 'number' && isFinite(v)) ? f.pts : (Array.isArray(f.pts) ? f.pts : []).map(v => numOr(v, NaN)).filter(isFinite);
    if (P.length % 2) P.pop();
    f.pts = P.length >= 2 ? P : [0, 0, 100, 0];
    const H = f.ctl;
    if (!(Array.isArray(H) && H.length === f.pts.length * 2 && H.every(v => typeof v === 'number' && isFinite(v)) && H.some(v => v !== 0))) delete f.ctl;
  }
  f.id = uniqueId(isId(f.id) ? String(f.id) : null, ids);   // ids are text, as the list and patch panel hold them
  if (typeof f.name !== 'string') f.name = f.name != null ? String(f.name) : TYPE_LABEL[f.type] + ' ' + (i + 1);
  if (typeof f.tag !== 'string') f.tag = TAGS[i % TAGS.length];
  if (!ORDERS.includes(f.order)) { const o = String(f.order || '').toUpperCase(); f.order = ORDERS.includes(o) ? o : 'RGB'; }
  f.dimmer = numOr(f.dimmer, 1);
  if (isObj(f.addr)) f.addr = { u: clamp(Math.round(numOr(f.addr.u, 0)), 0, 32767), ch: clamp(Math.round(numOr(f.addr.ch, 1)), 1, 512) }; else delete f.addr;
  f.trim = [0, 1, 2, 3].map(i => clamp(numOr(Array.isArray(f.trim) ? f.trim[i] : undefined, legacyTrim[i]), 0, 1));
  f.gamma = clampGamma(numOr(f.gamma, legacyGamma));
  if (!('enabled' in f)) f.enabled = true;
  if (!('locked' in f)) f.locked = false;
  if (!('reverse' in f)) f.reverse = false;
  return f;
}
function fixController(c, i, ids) {
  c.id = uniqueId(c.id, ids);
  if (typeof c.name !== 'string') c.name = c.name != null ? String(c.name) : 'Controller ' + String.fromCharCode(65 + (i % 26));
  if (typeof c.ip !== 'string') c.ip = c.ip != null ? String(c.ip) : '';
  if (!('enabled' in c)) c.enabled = true;
  if (!('split' in c)) c.split = false;
  // the universes the device reported to discovery: a reminder for setting outputs and universes per output
  if ('discovered' in c) {
    const u = Array.isArray(c.discovered) ? [...new Set(c.discovered.map(v => Math.round(numOr(v, -1))).filter(v => v >= 0 && v <= 32767))].sort((a, b) => a - b) : [];
    if (u.length) c.discovered = u; else delete c.discovered;
  }
  if (Array.isArray(c.chains)) c.chains = c.chains.map(ch => (Array.isArray(ch) ? ch.filter(isId).map(String) : []));
  ensureChains(c);
  return c;
}
function hydrate(p) {
  if (!isObj(p)) p = {};
  const base = blankProject(typeof p.name === 'string' && p.name ? p.name : 'Untitled');
  const out = Object.assign(base, p);
  if (typeof out.name !== 'string') out.name = base.name;
  out.format = base.format; out.version = base.version; // the file's structure is brought up to date below
  if (out.guide != null && !isObj(out.guide)) out.guide = null;
  out.settings = fixSettings(p.settings);
  // up to 0.4 the red, green and blue trims were one setting for all fixtures: each fixture starts from it
  const gt = isObj(p.settings) && Array.isArray(p.settings.trim) ? p.settings.trim : [];
  legacyTrim = [0, 1, 2].map(i => clamp(numOr(gt[i], 1), 0, 1)).concat(1);
  legacyGamma = clampGamma(out.settings.gamma);
  const fxIds = new Set(), ctrlIds = new Set();
  out.fixtures = (Array.isArray(p.fixtures) ? p.fixtures : []).filter(f => isObj(f) && TYPE_LABEL[f.type]).map((f, i) => fixFixture(f, i, fxIds));
  out.controllers = (Array.isArray(p.controllers) ? p.controllers : []).filter(isObj).map((c, i) => fixController(c, i, ctrlIds));
  const grpIds = new Set();
  for (const f of out.fixtures) { if (isId(f.group)) f.group = String(f.group); else delete f.group; }
  out.groups = (Array.isArray(p.groups) ? p.groups : []).filter(isObj).map((g, i) => ({
    id: uniqueId(isId(g.id) ? String(g.id) : null, grpIds), name: typeof g.name === 'string' ? g.name : 'Group ' + (i + 1),
    tag: typeof g.tag === 'string' ? g.tag : TAGS[(i + 2) % TAGS.length], open: g.open !== false,
    ...(numOr(g.rot, 0) ? { rot: numOr(g.rot, 0) } : {}) }));
  normalizeGroups(out);
  const builtins = builtinSources(), srcIds = new Set(builtins.map(s => s.id));
  const custom = (Array.isArray(p.sources) ? p.sources : []).filter(s => isObj(s) && !s.builtin && isId(s.id) && !srcIds.has(s.id) && srcIds.add(s.id));
  for (const s of custom) {
    if (!['isf', 'image', 'video', 'screen'].includes(s.kind)) s.kind = 'image';
    if (typeof s.name !== 'string') s.name = s.name != null ? String(s.name) : 'Source';
    if (s.kind === 'isf' && typeof s.code !== 'string') s.code = '';
    if ('rate' in s) s.rate = numOr(s.rate, 1);
    if (s.kind === 'video') fixVideoOptions(s);
  }
  out.sources = builtins.concat(custom);
  if (!Array.isArray(p.zones)) { // 0.2 and older: one set of layers and scenes for the whole canvas
    let layers = p.layers;
    if (!Array.isArray(layers)) { // 0.1: one live source, parameters stored on the sources
      const L = newLayer(p.activeSource || 'b-rainbow');
      for (const s of Array.isArray(p.sources) ? p.sources : []) if (isObj(s) && isObj(s.params) && Object.keys(s.params).length) L.params[s.id] = s.params;
      layers = [L];
    }
    out.zones = [newZone({ w: out.settings.compW, h: out.settings.compH, layers, scenes: p.scenes || [] })];
  }
  for (const s of out.sources) delete s.params;
  delete out.activeSource; delete out.layers; delete out.scenes;
  const known = new Set(out.sources.map(s => s.id));
  const fixLayer = l => {
    const L = Object.assign(newLayer(), l);
    if (!isId(L.id)) L.id = uid();
    if (!known.has(L.src)) L.src = null;
    if (!BLENDS.some(b => b[0] === L.blend)) L.blend = 'alpha';
    L.opacity = isFinite(L.opacity) ? clamp(+L.opacity, 0, 1) : 1;
    if (!L.params || typeof L.params !== 'object') L.params = {};
    L.on = L.on !== false;
    return L;
  };
  const fixScenes = list => (Array.isArray(list) ? list : []).filter(isObj).map((sc, i) => Object.assign({ id: uid(), name: 'Scene ' + (i + 1), fade: 2, tag: TAGS[i % TAGS.length] }, sc, { layers: (Array.isArray(sc.layers) ? sc.layers : []).map(fixLayer) }));
  const zoneIds = new Set();
  out.zones = out.zones.map((zn, i) => {
    const z = Object.assign(newZone({ name: 'Zone ' + (i + 1) }), zn);
    z.id = uniqueId(z.id, zoneIds);
    if (typeof z.name !== 'string') z.name = 'Zone ' + (i + 1);
    if (typeof z.tag !== 'string') z.tag = TAGS[1];
    z.layers = (Array.isArray(z.layers) ? z.layers : []).map(fixLayer);
    z.scenes = fixScenes(z.scenes);
    z.opacity = isFinite(z.opacity) ? clamp(+z.opacity, 0, 1) : 1;
    if (!z.scenes.some(sc => sc.id === z.scene)) z.scene = null;
    clampZone(z, out.settings);
    return z;
  });
  return out;
}

/* ---------- history + persistence ---------- */
const hist = { stack: [], idx: -1 };
function serialize(withGuide = true) {
  return JSON.stringify(project, (k, v) => {
    if (k.startsWith('_')) return undefined;
    if (!withGuide && k === 'guide' && v) return Object.assign({}, v, { src: null });
    return v;
  });
}
function pushHistory() {
  const s = serialize(false);
  if (hist.stack[hist.idx] === s) return;
  hist.stack.splice(hist.idx + 1);
  hist.stack.push(s);
  if (hist.stack.length > 150) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
  updateUndoButtons();
}
function restore(s) {
  const guide = project.guide;
  const p = hydrate(JSON.parse(s));
  if (p.guide && !p.guide.src && guide) p.guide.src = guide.src;
  // zones that fade and that the undo does not change carry on fading
  const fading = new Map(project.zones.filter(z => z._fade).map(z => [z.id, z]));
  for (const z of p.zones) { const o = fading.get(z.id); if (o && JSON.stringify(o.layers) === JSON.stringify(z.layers)) z._fade = o._fade; }
  // folding a group in the list is not an edit: undo leaves groups folded or unfolded as they are
  for (const g of p.groups) { const o = project.groups.find(x => x.id === g.id); if (o) g.open = o.open; }
  project = p;
  ui.sel = new Set([...ui.sel].filter(id => fxById(id)));
  markGeom(); markPatch(); rebuildGeometry();
  renderAll(); saveSoon();
}
function undo() { if (hist.idx > 0) { hist.idx--; restore(hist.stack[hist.idx]); updateUndoButtons(); } }
function redo() { if (hist.idx < hist.stack.length - 1) { hist.idx++; restore(hist.stack[hist.idx]); updateUndoButtons(); } }
// The project is saved in the browser after every change. The guide image can be megabytes, so it is kept
// under its own key and written only when it changes, not with every edit or scene change.
let saveWarned = false, guideKept;
const saveSoon = debounce(() => {
  const g = project.guide && project.guide.src ? project.guide : null;
  if ((g && g.src) !== guideKept) {
    guideKept = g && g.src;
    if (g && !store.set('openledmapper.guide', { name: g.name, src: g.src })) {
      store.remove('openledmapper.guide');
      if (!saveWarned) { toast('The guide image is too large to keep between sessions; everything else is saved.', 'warn'); saveWarned = true; }
    } else if (!g) store.remove('openledmapper.guide');
  }
  store.set('openledmapper.project', serialize(false));
}, 400);
function commit() {
  pushHistory();
  renderFxList();
  renderDock();
  saveSoon();
}
const commitSoft = debounce(() => { pushHistory(); saveSoon(); renderFxList(); }, 350);
function loadProject(p, { resetView = true } = {}) {
  project = hydrate(p);
  pruneRuntimes();
  ui.sel.clear(); ui.selCtrl = null; ui.zone = null; ui.layer = null;
  if (mixer.ok) mixer.prune(new Set(project.zones.map(z => z.id)));
  loadGuide();
  markGeom(); markPatch(); rebuildGeometry(); computePatch();
  if (resetView) ui.fitted = false;
  hist.stack = []; hist.idx = -1; pushHistory();
  renderAll(); saveSoon(); startClock();
}

/* ---------- files ---------- */
function saveProjectFile() {
  const name = (project.name || 'openledmapper-project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'openledmapper-project';
  download(name + '.openledmapper.json', JSON.stringify(JSON.parse(serialize(true)), null, 1));
  toast('Project saved as ' + name + '.openledmapper.json');
}
async function openProjectFile(file) {
  try {
    const p = JSON.parse(await file.text());
    if (!p || !Array.isArray(p.fixtures)) throw new Error('not an openLedMapper project');
    loadProject(p);
    toast(`Opened ${project.name}: ${project.fixtures.length} fixtures`);
  } catch (e) { toast('Could not open that file: ' + e.message, 'err'); }
}
function exportCSV() {
  ensurePatch();
  const rows = [['Fixture', 'Type', 'Pixels', 'Color order', 'Controller', 'IP', 'Output', 'Position', 'Start universe', 'Start channel', 'End universe', 'End channel', 'Overflow pixels']];
  const order = [];
  for (const c of project.controllers) c.chains.forEach(ch => ch.forEach(id => { const f = fxById(id); if (f) order.push(f); }));
  for (const f of project.fixtures) if (!f._patch) order.push(f);
  for (const f of order) {
    const p = f._patch;
    const a = p && p.first >= 0 ? addrOf(p.base, p.first) : null, b = p && p.first >= 0 ? addrOf(p.base, p.last) : null;
    rows.push([f.name, TYPE_LABEL[f.type], pixelCount(f), f.order, p ? p.ctrl.name : '', p ? p.ctrl.ip : '', p ? p.out + 1 : '', p ? p.pos + 1 : '', a ? a.u : '', a ? a.ch : '', b ? b.u : '', b ? b.ch : '', p ? p.overflow : '']);
  }
  const csv = rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
  download((project.name || 'openledmapper').replace(/\s+/g, '-') + '-patch.csv', csv, 'text/csv');
  toast('Patch list exported');
}

/* ---------- SVG import ---------- */
async function importSvg(file, opt) {
  const text = await file.text();
  if (opt.guide) { project.guide = { src: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text))), name: file.name }; loadGuide(); ui.showGuide = true; $('#vGuide').checked = true; }
  if (!opt.fixtures) { commit(); return; }
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') { toast('That file is not a readable SVG.', 'err'); return; }
  const live = document.importNode(root, true);
  const vbAttr = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let vb = vbAttr.length === 4 && vbAttr.every(isFinite) ? { x: vbAttr[0], y: vbAttr[1], w: vbAttr[2], h: vbAttr[3] } : { x: 0, y: 0, w: parseFloat(root.getAttribute('width')) || 1000, h: parseFloat(root.getAttribute('height')) || 1000 };
  live.setAttribute('width', vb.w); live.setAttribute('height', vb.h);
  live.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const host = h('div', { style: { position: 'fixed', left: '-20000px', top: '0', width: '1px', height: '1px', overflow: 'hidden', visibility: 'hidden' } }, live);
  document.body.append(host);
  const W = project.settings.compW, H = project.settings.compH;
  const s = Math.min(W / vb.w, H / vb.h), ox = (W - vb.w * s) / 2, oy = (H - vb.h * s) / 2;
  const made = [];
  const counts = { circle: 0, line: 0, path: 0, dup: 0 };
  try {
    for (const el of live.querySelectorAll('path, circle, ellipse, line, polyline, polygon, rect')) {
      if (el.closest('defs, clipPath, mask, symbol, marker, pattern')) continue;
      let len = 0;
      try { len = el.getTotalLength(); } catch (e) { continue; }
      if (!(len > 0)) continue;
      const m = el.getCTM();
      const N = clamp(Math.round(len * s / 4), 24, 400);
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const p = el.getPointAtLength(len * i / N);
        const x = m ? m.a * p.x + m.c * p.y + m.e : p.x, y = m ? m.b * p.x + m.d * p.y + m.f : p.y;
        pts.push(ox + x * s, oy + y * s);
      }
      const lbl = el.getAttribute('inkscape:label') || el.id || '';
      const f = classifyShape(pts, opt.pitch, /^(path|circle|ellipse|line|polyline|polygon|rect|g)[-_]?\d*$/i.test(lbl) ? '' : lbl);
      if (!f) continue;
      if (made.some(g => sameShape(f, g))) { counts.dup++; continue; }
      made.push(f); counts[f.type]++;
      project.fixtures.push(f);
    }
  } finally { host.remove(); }
  if (!made.length) { toast('No usable shapes found in that SVG.', 'warn'); commit(); return; }
  ui.sel = new Set(made.map(f => f.id));
  markGeom(); rebuildGeometry(); commit(); renderRight();
  toast(`Imported ${made.length} fixtures: ${counts.circle} circles/arcs, ${counts.line} lines, ${counts.path} paths` + (counts.dup ? `. Skipped ${counts.dup} duplicate shape${counts.dup > 1 ? 's' : ''} drawn on top of another.` : ''));
}
function sameShape(a, b) {
  if (a.type !== b.type) return false;
  const e = 0.5;
  if (a.type === 'circle') return Math.abs(a.cx - b.cx) < e && Math.abs(a.cy - b.cy) < e && Math.abs(a.r - b.r) < e && Math.abs(ryOf(a) - ryOf(b)) < e && Math.abs(a.sweep - b.sweep) < 1 && Math.abs(ovalRot(a) - ovalRot(b)) < 0.5;
  if (a.type === 'line') {
    const same = (x1, y1, x2, y2) => Math.hypot(a.x1 - x1, a.y1 - y1) < e && Math.hypot(a.x2 - x2, a.y2 - y2) < e;
    return same(b.x1, b.y1, b.x2, b.y2) || same(b.x2, b.y2, b.x1, b.y1);
  }
  return a.pts.length === b.pts.length && a.pts.every((v, i) => Math.abs(v - b.pts[i]) < e);
}
function classifyShape(P, pitch, label) {
  const n = P.length / 2;
  const x0 = P[0], y0 = P[1], xN = P[P.length - 2], yN = P[P.length - 1];
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
  if (len < 1) return null;
  const closed = Math.hypot(xN - x0, yN - y0) < len * 0.01;
  // circle / arc: fit centre as the centroid for closed shapes, or circumcentre of start/mid/end for arcs
  let cx, cy;
  if (closed) { cx = 0; cy = 0; for (let i = 0; i < n - 1; i++) { cx += P[2 * i]; cy += P[2 * i + 1]; } cx /= n - 1; cy /= n - 1; }
  else {
    const mi = Math.floor(n / 2), ax = x0, ay = y0, bx = P[2 * mi], by = P[2 * mi + 1], qx = xN, qy = yN;
    const d = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    if (Math.abs(d) > 1e-6) {
      cx = ((ax * ax + ay * ay) * (by - qy) + (bx * bx + by * by) * (qy - ay) + (qx * qx + qy * qy) * (ay - by)) / d;
      cy = ((ax * ax + ay * ay) * (qx - bx) + (bx * bx + by * by) * (ax - qx) + (qx * qx + qy * qy) * (bx - ax)) / d;
    }
  }
  if (cx !== undefined) {
    let rs = 0, rmax = 0, rmin = Infinity;
    for (let i = 0; i < n; i++) { const r = Math.hypot(P[2 * i] - cx, P[2 * i + 1] - cy); rs += r; rmax = Math.max(rmax, r); rmin = Math.min(rmin, r); }
    const r = rs / n;
    if (r > 0.5 && (rmax - rmin) / r < 0.04) {
      const ang = i => Math.atan2(P[2 * i] - cx, -(P[2 * i + 1] - cy)) * 180 / Math.PI;
      let sweep = 0;
      for (let i = 1; i < n; i++) { let d = ang(i) - ang(i - 1); d = wrap180(d); sweep += d; }
      const full = closed || Math.abs(sweep) > 355;
      const f = newFixture('circle', { cx, cy, r, start: wrap360(ang(0)), sweep: full ? 360 : Math.abs(sweep), ccw: sweep < 0 });
      f.pixels = Math.max(3, Math.round(fixtureLength(f) / pitch) + (full ? 0 : 1));
      if (label) f.name = label;
      return f;
    }
    // a closed oval, upright (its axes horizontal and vertical): the half width and half height of its box
    if (closed) {
      let x0b = Infinity, x1b = -Infinity, y0b = Infinity, y1b = -Infinity;
      for (let i = 0; i < n; i++) { x0b = Math.min(x0b, P[2 * i]); x1b = Math.max(x1b, P[2 * i]); y0b = Math.min(y0b, P[2 * i + 1]); y1b = Math.max(y1b, P[2 * i + 1]); }
      const ox = (x0b + x1b) / 2, oy = (y0b + y1b) / 2, rx = (x1b - x0b) / 2, ry = (y1b - y0b) / 2;
      let worst = 0;
      if (rx > 0.5 && ry > 0.5) for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(Math.hypot((P[2 * i] - ox) / rx, (P[2 * i + 1] - oy) / ry) - 1));
      if (rx > 0.5 && ry > 0.5 && worst < 0.03) {
        const ang = i => Math.atan2((P[2 * i] - ox) / rx, -(P[2 * i + 1] - oy) / ry) * 180 / Math.PI;
        let turn = 0;
        for (let i = 1; i < n; i++) { let d = ang(i) - ang(i - 1); d = wrap180(d); turn += d; }
        const f = newFixture('circle', { cx: ox, cy: oy, r: rx, ry, start: wrap360(ang(0)), sweep: 360, ccw: turn < 0 });
        f.pixels = Math.max(3, Math.round(fixtureLength(f) / pitch));
        if (label) f.name = label;
        return f;
      }
    }
  }
  // straight line
  const chord = Math.hypot(xN - x0, yN - y0);
  if (!closed && chord > 0.5) {
    let dev = 0;
    for (let i = 0; i < n; i++) dev = Math.max(dev, distSeg(P[2 * i], P[2 * i + 1], x0, y0, xN, yN));
    if (dev < Math.max(0.5, chord * 0.01) && len < chord * 1.02) {
      const f = newFixture('line', { x1: x0, y1: y0, x2: xN, y2: yN });
      f.pixels = Math.max(2, Math.round(chord / pitch) + 1);
      if (label) f.name = label;
      return f;
    }
  }
  // free path: simplify to at most 120 points
  const step = Math.max(1, Math.ceil(n / 120));
  const pts = [];
  for (let i = 0; i < n - (closed ? 1 : 0); i += step) pts.push(P[2 * i], P[2 * i + 1]);
  if (!closed && (pts[pts.length - 2] !== xN || pts[pts.length - 1] !== yN)) pts.push(xN, yN);
  const f = newFixture('path', { pts, closed });
  f.pixels = Math.max(2, Math.round(len / pitch) + (closed ? 0 : 1));
  if (label) f.name = label;
  return f;
}

/* ---------- demo ---------- */
function demoProject() {
  const saved = project;
  project = blankProject('Demo layout');
  project.settings.compW = 1000; project.settings.compH = 640;
  const F = (t, p) => { const f = newFixture(t, p); project.fixtures.push(f); return f; };
  const panel = F('matrix', { name: 'Panel A', cx: 170, cy: 190, w: 240, h: 240, cols: 16, rows: 16, start: 'TL', dir: 'H', snake: true, tag: TAGS[0] });
  const strips = [0, 1, 2, 3].map(i => F('line', { name: 'Strip ' + (i + 1), x1: 380, y1: 90 + i * 45, x2: 940, y2: 90 + i * 45, pixels: 57, reverse: i % 2 === 1, tag: TAGS[1] }));
  const rings = [0, 1, 2].map(i => F('circle', { name: 'Ring ' + (i + 1), cx: 500 + i * 190, cy: 460, r: 80, pixels: 60, order: i === 1 ? 'GRB' : 'RGB', tag: TAGS[2] }));
  const pts = [];
  for (let i = 0; i <= 24; i++) { const x = 60 + i * 12; pts.push(x, 470 + Math.sin(i / 24 * Math.PI * 2) * 70); }
  const wave = F('path', { name: 'Wave', pts, pixels: 48, tag: TAGS[3] });
  const gStrips = { id: uid(), name: 'Strips', tag: TAGS[1], open: true }, gRings = { id: uid(), name: 'Rings', tag: TAGS[2], open: true };
  strips.forEach(s => { s.group = gStrips.id; }); rings.forEach(r => { r.group = gRings.id; });
  project.groups.push(gStrips, gRings);
  const c = newController({ name: 'Pixel controller A', ip: '10.0.0.50', outputs: 4, upo: 4, startUniverse: 0 });
  c.chains = [[panel.id], strips.map(s => s.id), rings.map(r => r.id), [wave.id]];
  project.controllers.push(c);
  const L = (src, o = {}) => Object.assign(newLayer(src), o, { params: o.params ? { [src]: o.params } : {} });
  const S = (name, tag, fade, layers) => ({ id: uid(), name, tag, fade, layers });
  const zAll = newZone({ name: 'All', tag: TAGS[1], scenes: [
    S('Plasma', TAGS[0], 2, [L('b-plasma')]),
    S('Fire and sparks', TAGS[1], 3, [L('b-fire'), L('b-twinkle', { blend: 'add', opacity: 0.7, params: { color: [1, 0.75, 0.3, 1], density: 0.15 } })]),
    S('Rainbow comets', TAGS[4], 1.5, [L('b-rainbow', { params: { mode: 1 } }), L('b-comet', { blend: 'multiply', params: { mode: 2, color: [1, 1, 1, 1], count: 3, tail: 0.6 } })]),
    S('Blue pool', TAGS[5], 4, [L('b-water')]),
  ] });
  const zRings = newZone({ name: 'Rings', tag: TAGS[2], x: 390, y: 360, w: 600, h: 210, scenes: [
    S('Comets', TAGS[2], 1.5, [L('b-comet', { params: { mode: 2, count: 3, tail: 0.55, color: [0.2, 0.85, 1, 1] } }), L('b-twinkle', { blend: 'add', opacity: 0.8, params: { color: [1, 0.8, 0.5, 1], density: 0.2, cells: 8 } })]),
    S('Color wipe', TAGS[4], 1, [L('b-wipe', { params: { mode: 2 } })]),
    S('Pulse', TAGS[0], 0.5, [L('b-pulse')]),
    S('Strobe hit', TAGS[6], 0, [L('b-strobe', { params: { rate: 8 } })]),
  ] });
  const zStrips = newZone({ name: 'Strips', tag: TAGS[3], x: 360, y: 60, w: 620, h: 190, scenes: [
    S('Rain', TAGS[5], 2, [L('b-rain', { params: { angle: 90 } })]),
    S('Bars', TAGS[0], 1, [L('b-bars', { params: { count: 6, angle: 0 } })]),
  ] });
  for (const z of [zAll, zRings, zStrips]) { z.scene = z.scenes[0].id; z.layers = cloneLayers(z.scenes[0].layers); }
  project.zones = [zStrips, zRings, zAll]; // All is on top: lower its opacity to see Rings and Strips
  const out = project;
  project = saved;
  return JSON.parse(JSON.stringify(out, replacer));
}
