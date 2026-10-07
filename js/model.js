// openLedMapper · js/model.js
// The project and its parts: constants and defaults, the project and ui state, factories (newFixture, newZone,
// newController…), groups, the selection, look-ups by id, saved preferences. Uses util.

/* ---------- constants, state, factories ---------- */
const TAGS = ['#3cc8ff', '#ffb341', '#b58cff', '#46e08c', '#ff6f86', '#6fe3e3', '#e8d56a', '#ff9657'];
const ORDERS = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR', 'RGBW', 'GRBW', 'WRGB', 'W'];
const TYPE_LABEL = { line: 'Line', circle: 'Circle', matrix: 'Matrix', path: 'Path' };
const DEFAULT_SETTINGS = {
  compW: 1000, compH: 640, fps: 40, gamma: 1, master: 1, whiteMode: 'off',
  artSync: false, grid: 10, broadcast: '', bridgeUrl: '', transition: 0.5, fade: 2,
};
// Blend modes, in the order the mixer shader numbers them
const BLENDS = [['alpha', 'Alpha'], ['add', 'Add'], ['screen', 'Screen'], ['multiply', 'Multiply'], ['subtract', 'Subtract'], ['lighten', 'Lighten'], ['darken', 'Darken'], ['difference', 'Difference']];
const BLEND_IDX = Object.fromEntries(BLENDS.map(([k], i) => [k, i]));
const BLEND_NOTES = {
  alpha: 'Covers the layers below as far as its opacity (and the source\'s own transparency) goes.',
  add: 'Adds its light to the layers below; black is invisible. Good for chases, comets and sparkles on top.',
  screen: 'Like Add, but brightens more gently where both are already bright.',
  multiply: 'White keeps what is below, black hides it. Put a Shape mask here to show the layers below only inside a shape.',
  subtract: 'Takes its light away from the layers below.',
  lighten: 'Keeps whichever is brighter: this layer or the layers below.',
  darken: 'Keeps whichever is darker: this layer or the layers below.',
  difference: 'Inverts the layers below where this layer is bright.',
};
let project = null;
const ui = {
  sel: new Set(), tool: 'select', view: { zoom: 1, x: 0, y: 0 }, fitted: false,
  outputOn: false, blackout: false, outputMode: 'content', hlMode: 'trace', pickPx: null, zone: null, layer: null, hoverSrc: null,
  showContent: true, contentOp: 0.35, showGuide: true, guideOp: 0.5, showGrid: true, snap: true, showLabels: true, showWiring: false, showZones: true,
  dockTab: 'patch', rightTab: 'inspector', rightHidden: false, scanOff: [], selCtrl: null, monitorKey: null, dockH: 250, dockCollapsed: false,
  hoverFx: null, hoverGroup: null, hoverPx: null, cursor: null,
};
const UI_PREFS = ['hlMode', 'contentOp', 'showContent', 'guideOp', 'showGuide', 'showGrid', 'snap', 'showLabels', 'showWiring', 'showZones', 'dockTab', 'rightTab', 'dockH', 'dockCollapsed', 'rightHidden', 'scanOff'];
let geomDirty = true, patchDirty = true;
const markGeom = () => { geomDirty = true; };
const markPatch = () => { patchDirty = true; };
function blankProject(name = 'Untitled') {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  return {
    format: 'openledmapper-project', version: 3, name, settings,
    fixtures: [], groups: [], controllers: [], sources: builtinSources(), zones: [newZone({ w: settings.compW, h: settings.compH, layers: [newLayer('b-rainbow')] })], guide: null,
  };
}
// A group is a named set of fixtures. Its fixtures stay next to each other in the list (and so in drawing and
// Auto-patch order), where its first one is. One level only: no groups inside groups.
const groupById = id => project.groups.find(g => g.id === id);
const membersOf = (g, p = project) => p.fixtures.filter(f => f.group === g.id);
function normalizeGroups(p = project) {
  const known = new Set(p.groups.map(g => g.id)), placed = new Set(), out = [];
  for (const f of p.fixtures) if (f.group != null && !known.has(f.group)) delete f.group;
  for (const f of p.fixtures) {
    if (f.group == null) { out.push(f); continue; }
    if (placed.has(f.group)) continue;
    placed.add(f.group);
    for (const x of p.fixtures) if (x.group === f.group) out.push(x);
  }
  p.fixtures = out;
  p.groups = p.groups.filter(g => placed.has(g.id));   // a group with no fixtures left is gone
}
const groupName = g => g.name.trim() || 'Group';
function nextGroupName() { let n = 1; while (project.groups.some(g => g.name === 'Group ' + n)) n++; return 'Group ' + n; }
// Selected groups whose fixtures are all selected count as one unit; the other selected fixtures one each
function selUnits(sel = selected()) {
  const units = [], seen = new Set(), inSel = new Set(sel.map(f => f.id)), groups = new Map(project.groups.map(g => [g.id, g])), members = new Map();
  for (const f of project.fixtures) if (f.group != null) { const m = members.get(f.group); if (m) m.push(f); else members.set(f.group, [f]); }
  for (const f of sel) {
    const g = f.group != null && groups.get(f.group);
    if (g) {
      if (seen.has(g.id)) continue;
      const m = members.get(g.id);
      if (m.every(x => inSel.has(x.id))) { seen.add(g.id); units.push({ g, list: m }); continue; }
    }
    units.push({ g: null, list: [f] });
  }
  return units;
}
// Clicking a fixture on the stage selects its whole group, unless the selection is already inside that group
// (after a double-click on one of its fixtures): then just the fixture clicked
function stagePick(f) {
  const g = f.group != null ? groupById(f.group) : null;
  if (!g) return [f.id];
  const ids = membersOf(g).map(x => x.id), mine = new Set(ids), n = ids.filter(id => ui.sel.has(id)).length;
  const inside = n > 0 && n < ids.length && [...ui.sel].every(id => mine.has(id));
  return inside ? [f.id] : ids;
}
// The group, when the selection is exactly one whole group of two or more fixtures
function wholeGroup(sel = selected()) { const u = selUnits(sel); return u.length === 1 && u[0].g && u[0].list.length > 1 ? u[0].g : null; }
function builtinSources() {
  return BUILTINS.map(b => ({ id: 'b-' + b.id, kind: 'isf', builtin: b.id, name: b.name }));
}
// A layer plays one source. Parameters are kept per source, so switching back restores them.
function newLayer(src = null) { return { id: uid(), src, params: {}, opacity: 1, blend: 'alpha', on: true }; }
const cloneLayers = layers => JSON.parse(JSON.stringify(layers));
// A zone is a rectangle of the canvas with its own layers and scenes; content is drawn to fit it.
// Zones later in the list are higher up and cover the ones below, as far as their opacity goes.
function newZone(props = {}) { return Object.assign({ id: uid(), name: 'Zone 1', tag: TAGS[1], x: 0, y: 0, w: 1000, h: 640, opacity: 1, layers: [], scenes: [], scene: null }, props); }
function clampZone(z, s = project.settings) {
  z.w = clamp(Math.round(z.w) || 1, 1, s.compW); z.h = clamp(Math.round(z.h) || 1, 1, s.compH);
  z.x = clamp(Math.round(z.x) || 0, 0, s.compW - z.w); z.y = clamp(Math.round(z.y) || 0, 0, s.compH - z.h);
}
// When the composition is resized, zones that covered all of it keep covering all of it
function fitZonesToCanvas(oldW, oldH) {
  for (const z of project.zones) {
    if (z.x === 0 && z.y === 0 && z.w === oldW && z.h === oldH) { z.w = project.settings.compW; z.h = project.settings.compH; }
    clampZone(z);
  }
}
// The fields of each fixture type and their defaults
const FIXTURE_FIELDS = {
  line: { x1: 0, y1: 0, x2: 200, y2: 0, pixels: 20 },
  circle: { cx: 0, cy: 0, r: 60, pixels: 36, start: 0, sweep: 360, ccw: false },
  matrix: { cx: 0, cy: 0, w: 160, h: 160, rot: 0, cols: 16, rows: 16, start: 'TL', dir: 'H', snake: true },
  path: { pts: [0, 0, 100, 0], closed: false, pixels: 20 },
};
function newFixture(type, props = {}) {
  const f = {
    id: uid(), type, name: nextName(type), enabled: true, locked: false,
    tag: TAGS[project.fixtures.length % TAGS.length], order: 'RGB', reverse: false, dimmer: 1, trim: [1, 1, 1, 1], gamma: clampGamma(project.settings.gamma),
  };
  if (FIXTURE_FIELDS[type]) Object.assign(f, JSON.parse(JSON.stringify(FIXTURE_FIELDS[type])));
  return Object.assign(f, props);
}
// The name of a copy: a number at the end goes up to the next one not taken ("Matrix 1" → "Matrix 2",
// "Matrix 10" → "Matrix 11", past any already used, keeping leading zeros); a name without one gets " 2".
function nextCopyName(name, taken) {
  const m = /^(.*?)(\d{1,15})$/.exec(name);
  const base = m ? m[1] : (name.trim() ? name.trimEnd() + ' ' : '');
  const width = m && m[2].length > 1 && m[2][0] === '0' ? m[2].length : 0;
  const mk = k => base + String(k).padStart(width, '0');
  let n = m ? parseInt(m[2], 10) + 1 : 2;
  while (taken.has(mk(n))) n++;
  return mk(n);
}
function nextName(type) {
  const label = TYPE_LABEL[type] || 'Fixture';
  const names = new Set(project.fixtures.map(f => f.name));
  let n = 1;
  while (names.has(label + ' ' + n)) n++;
  return label + ' ' + n;
}
function newController(props = {}) {
  const n = project.controllers.length;
  const c = { id: uid(), name: 'Controller ' + String.fromCharCode(65 + (n % 26)), ip: '10.0.0.' + (50 + n), enabled: true, outputs: 4, upo: 4, startUniverse: n * 16, split: false, chains: [] };
  Object.assign(c, props);
  ensureChains(c);
  return c;
}
function ensureChains(c) {
  c.outputs = clamp(Math.round(c.outputs) || 1, 1, 128);
  c.upo = clamp(Math.round(c.upo) || 1, 1, 64);
  c.startUniverse = clamp(Math.round(c.startUniverse) || 0, 0, 32767);
  if (!Array.isArray(c.chains)) c.chains = [];
  while (c.chains.length < c.outputs) c.chains.push([]);
  if (c.chains.length > c.outputs) c.chains.length = c.outputs;
}
const fxById = id => project.fixtures.find(f => f.id === id);
const ctrlById = id => project.controllers.find(c => c.id === id);
const srcById = id => project.sources.find(s => s.id === id);
const selected = () => project.fixtures.filter(f => ui.sel.has(f.id));
const ctrlLetter = c => String.fromCharCode(65 + (project.controllers.indexOf(c) % 26));

/* ---------- gamma ---------- */
const clampGamma = v => clamp(numOr(v, 1), 1, 3);

/* ---------- look-ups ---------- */
const zoneById = id => project.zones.find(z => z.id === id);
const selZone = () => zoneById(ui.zone) || project.zones[project.zones.length - 1] || null;
const selLayer = () => { const z = selZone(); return z ? z.layers.find(L => L.id === ui.layer) || z.layers[z.layers.length - 1] || null : null; };

/* ---------- preferences ---------- */
function savePrefs() { const o = {}; for (const k of UI_PREFS) o[k] = ui[k]; store.set('openledmapper.ui', o); }
