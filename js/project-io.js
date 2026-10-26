// nouPix · js/project-io.js
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
  if (!['artnet', 'sacn'].includes(s.protocol)) s.protocol = 'artnet';
  s.sacnPriority = clamp(Math.round(s.sacnPriority), 0, 200);
  s.sacnMulticast = s.sacnMulticast === true;
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
  delete f.tag;   // a fixture shows its group's colour; up to 0.9 each had one of its own
  if (!ORDERS.includes(f.order)) { const o = String(f.order || '').toUpperCase(); f.order = ORDERS.includes(o) ? o : 'RGB'; }
  f.dimmer = numOr(f.dimmer, 1);
  if (isObj(f.addr)) f.addr = { u: clamp(Math.round(numOr(f.addr.u, 0)), 0, 32767), ch: clamp(Math.round(numOr(f.addr.ch, 1)), 1, 512) }; else delete f.addr;
  f.trim = [0, 1, 2, 3].map(i => clamp(numOr(Array.isArray(f.trim) ? f.trim[i] : undefined, legacyTrim[i]), 0, 1));
  f.gamma = clampGamma(numOr(f.gamma, legacyGamma));
  // 8 or 16 bits per colour, and the dimming curve (16-bit only). A curve this version doesn't have (tungsten, from
  // 0.8) is gamma.
  f.bits = f.bits === 16 || f.bits === '16' ? 16 : 8;
  if (!CURVE_IDS.has(f.curve)) f.curve = 'gamma';
  f.strength = clamp(numOr(f.strength, 1), 0, 2);
  delete f.warm; delete f.lag;
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
// A playlist only plays its own zone's scenes: steps of scenes that are gone go, and an end that leads to a playlist
// that is gone becomes a loop. One playlist per zone plays when the project opens.
const fadeOrNull = v => (v == null || v === '' ? null : clamp(numOr(v, 0), 0, 60));
function fixPlaylists(list, scenes) {
  const ids = new Set(), sceneIds = new Set(scenes.map(sc => sc.id));
  const out = (Array.isArray(list) ? list : []).filter(isObj).map((pl, i) => {
    const stepIds = new Set();
    return {
      id: uniqueId(pl.id, ids), name: typeof pl.name === 'string' ? pl.name : 'Playlist ' + (i + 1),
      steps: (Array.isArray(pl.steps) ? pl.steps : []).filter(st => isObj(st) && sceneIds.has(st.scene)).map(st => ({
        id: uniqueId(st.id, stepIds), scene: st.scene, time: clamp(numOr(st.time, 30), 0.1, 86400), fade: fadeOrNull(st.fade) })),
      fade: fadeOrNull(pl.fade), end: pl.end, autoplay: pl.autoplay === true,
    };
  });
  let auto = false;
  for (const pl of out) {
    if (pl.end !== 'loop' && pl.end !== 'stop' && (pl.end === pl.id || !ids.has(pl.end))) pl.end = 'loop';
    if (pl.autoplay) { if (auto) pl.autoplay = false; auto = true; }
  }
  return out;
}
function hydrate(p) {
  if (!isObj(p)) p = {};
  const base = blankProject(typeof p.name === 'string' && p.name ? p.name : 'Untitled');
  const { name, format, version } = base;   // before the file's own are copied over them
  const out = Object.assign(base, p);
  if (typeof out.name !== 'string') out.name = name;
  out.id = isId(p.id) ? String(p.id) : uid();   // which project it is, for the one that opens when nouPix starts
  out.format = format; out.version = version; // the file's structure is brought up to date below
  // colours: from version 4 a group or a zone has one only when the user gave it one; before, every one got one
  const chosen = numOr(p.version, 0) >= 4, tagOf = c => (chosen && isTag(c) ? c : '');
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
    tag: tagOf(g.tag), open: g.open !== false,
    ...(numOr(g.rot, 0) ? { rot: numOr(g.rot, 0) } : {}),
    ...(numOr(g.level, 1) < 1 ? { level: clamp(numOr(g.level, 1), 0, 1) } : {}) }));   // its dimmer, kept only when down
  normalizeGroups(out);
  const builtins = builtinSources(), srcIds = new Set(builtins.map(s => s.id));
  const custom = (Array.isArray(p.sources) ? p.sources : []).filter(s => isObj(s) && !s.builtin && isId(s.id) && !srcIds.has(s.id) && srcIds.add(s.id));
  for (const s of custom) {
    if (!['isf', 'image', 'video', 'screen', 'stream'].includes(s.kind)) s.kind = 'image';
    if (typeof s.name !== 'string') s.name = s.name != null ? String(s.name) : 'Source';
    if (s.kind === 'isf' && typeof s.code !== 'string') s.code = '';
    if ('rate' in s) s.rate = numOr(s.rate, 1);
    if (s.kind === 'video') fixVideoOptions(s);
    if (!(typeof s.media === 'string' && /^[0-9a-f]{32}\.[a-z0-9]{1,5}$/.test(s.media)) || !['image', 'video'].includes(s.kind)) delete s.media;   // its file in the media library
    if (s.kind === 'stream') { if (!STREAM_PROTOS[s.proto]) s.proto = 'ndi'; s.stream = typeof s.stream === 'string' ? s.stream : ''; s.hq = s.hq === true; }
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
  const fixScenes = list => (Array.isArray(list) ? list : []).filter(isObj).map((sc, i) => { const o = Object.assign({ id: uid(), name: 'Scene ' + (i + 1), fade: 2 }, sc, { layers: (Array.isArray(sc.layers) ? sc.layers : []).map(fixLayer) }); if (tagOf(o.tag)) o.tag = tagOf(o.tag); else delete o.tag; return o; });   // its colour, if the user gave it one
  const zoneIds = new Set();
  out.zones = out.zones.map((zn, i) => {
    const z = Object.assign(newZone({ name: 'Zone ' + (i + 1) }), zn);
    z.id = uniqueId(z.id, zoneIds);
    if (typeof z.name !== 'string') z.name = 'Zone ' + (i + 1);
    z.tag = tagOf(z.tag);
    z.layers = (Array.isArray(z.layers) ? z.layers : []).map(fixLayer);
    z.scenes = fixScenes(z.scenes);
    let onOpen = false;   // one scene per zone plays when the project opens
    for (const sc of z.scenes) { if (sc.onOpen === true && !onOpen) onOpen = true; else delete sc.onOpen; }
    z.opacity = isFinite(z.opacity) ? clamp(+z.opacity, 0, 1) : 1;
    if (!z.scenes.some(sc => sc.id === z.scene)) z.scene = null;
    z.playlists = fixPlaylists(z.playlists, z.scenes);
    clampZone(z, out.settings);
    return z;
  });
  out.midi = fixMidi(p.midi);
  out.macros = fixMacros(p.macros);
  out.macroLinks = fixMacroLinks(p.macroLinks, known);
  const X = isObj(p.xfade) ? p.xfade : {};
  out.xfade = { on: X.on === true, a: isId(X.a) ? String(X.a) : '', b: isId(X.b) ? String(X.b) : '', x: clamp(numOr(X.x, 0), 0, 1),
    mode: XF_MODES.some(m => m[0] === X.mode) ? X.mode : 'mix', phone: X.phone === true };
  return out;
}
// The MIDI mappings: well-formed ones only, each with its own id. A mapping to a zone, scene or playlist that is gone
// stays (it shows as missing, and does nothing).
function fixMidi(m) {
  const ids = new Set();
  const maps = (isObj(m) && Array.isArray(m.maps) ? m.maps : []).filter(w => isObj(w) && typeof w.key === 'string' && MIDI_KEY.test(w.key) && typeof w.to === 'string' && w.to && w.to.length < 300);
  // order: the controls in the order the user put them (the others follow, by port, type and number)
  const order = [...new Set((isObj(m) && Array.isArray(m.order) ? m.order : []).filter(k => typeof k === 'string' && MIDI_KEY.test(k)))];
  return { maps: maps.map(w => ({ id: uniqueId(isId(w.id) ? String(w.id) : null, ids), key: w.key, to: w.to, takeover: w.takeover === 'jump' ? 'jump' : 'pickup', mode: w.mode === 'hold' ? 'hold' : 'toggle' })), order };
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
  remoteChanged();
}
function restore(s) {
  const guide = project.guide;
  const p = hydrate(JSON.parse(s));
  if (p.guide && !p.guide.src && guide) p.guide.src = guide.src;
  // Playlists carry on. While one plays, the zone's look is the playlist's: an older copy (an undo, a device a step
  // behind) doesn't take it back to an earlier scene. Changes to the layers of the scene playing do come in.
  const before = new Map(project.zones.map(z => [z.id, z]));
  for (const z of p.zones) {
    const o = before.get(z.id), q = o && o._play, pl = q && playlistOf(z, q.list);
    if (!pl || !pl.steps.length) continue;
    const was = playingList(o), st = was && was.steps[q.i], i = st ? pl.steps.findIndex(x => x.id === st.id) : -1;
    if (i >= 0) q.i = i; else if (q.i >= pl.steps.length) q.i = pl.steps.length - 1;   // the step playing stays the one playing
    z._play = q;
    if (!REMOTE_CLIENT && q.on && z.scene !== o.scene) { z.layers = o.layers; z.scene = o.scene; }
  }
  // zones that fade and that the undo does not change carry on fading
  const fading = new Map(project.zones.filter(z => z._fade).map(z => [z.id, z]));
  for (const z of p.zones) { const o = fading.get(z.id); if (o && JSON.stringify(o.layers) === JSON.stringify(z.layers)) z._fade = o._fade; }
  // folding a group in the list is not an edit: undo leaves groups folded or unfolded as they are
  for (const g of p.groups) { const o = project.groups.find(x => x.id === g.id); if (o) g.open = o.open; }
  // the macros are live controls, like the master on a desk: an undo, or a device's copy, leaves them where they are
  p.macros = project.macros;
  project = p;
  ui.selRot = null;   // a selection's turned frame belonged to the geometry being replaced
  ui.sel = new Set([...ui.sel].filter(id => fxById(id)));
  markGeom(); markPatch(); rebuildGeometry();
  renderAll(); saveSoon();
  remoteChanged();   // an undo is a change for the other devices too
}
function undo() { if (hist.idx > 0) { hist.idx--; restore(hist.stack[hist.idx]); updateUndoButtons(); } }
function redo() { if (hist.idx < hist.stack.length - 1) { hist.idx++; restore(hist.stack[hist.idx]); updateUndoButtons(); } }
// The project is saved in the browser after every change. The guide image can be megabytes, so it is kept
// under its own key and written only when it changes, not with every edit or scene change.
let saveWarned = false, guideKept;
const saveSoon = debounce(() => {
  if (REMOTE_CLIENT) return;   // on a device the project belongs to the main computer
  const g = project.guide && project.guide.src ? project.guide : null;
  if ((g && g.src) !== guideKept) {
    guideKept = g && g.src;
    if (g && !store.set('noupix.guide', { name: g.name, src: g.src })) {
      store.remove('noupix.guide');
      if (!saveWarned) { toast('The guide image is too large to keep between sessions; everything else is saved.', 'warn'); saveWarned = true; }
    } else if (!g) store.remove('noupix.guide');
  }
  store.set('noupix.project', serialize(false));
  autosaveFile();
  keepStartupProject();
}, 400);
// commit({ lists: false }): a change the fixture list and the dock don't show (fixtures moved). Anything else passed
// (it is also an event handler and a form's onCommit) redraws them.
function commit(o) {
  pushHistory();
  if (!(o && o.lists === false)) { renderFxList(); renderDock(); }
  saveSoon();
}
const commitSoft = debounce(() => { pushHistory(); saveSoon(); renderFxList(); }, 350);
function loadProject(p, { resetView = true } = {}) {
  project = hydrate(p);
  ui.selRot = null;
  pruneRuntimes();
  ui.sel.clear(); ui.selCtrl = null; ui.zone = null; ui.layer = null;
  if (mixer.ok) mixer.prune(new Set(project.zones.map(z => z.id)));
  loadGuide();
  markGeom(); markPatch(); rebuildGeometry(); computePatch();
  if (resetView) ui.fitted = false;
  hist.stack = []; hist.idx = -1; pushHistory();
  // a playlist set to play when the project opens starts with the first frame (on the main window)
  if (!REMOTE_CLIENT) for (const z of project.zones) { const pl = z.playlists.find(x => x.autoplay && x.steps.length); if (pl) z._play = { list: pl.id, on: true, i: -1, start: 0, done: 0, manual: null, ended: false }; }
  // and a scene set to play when the project opens, in a zone without such a playlist, at once
  if (!REMOTE_CLIENT) for (const z of project.zones) { const sc = !z._play && z.scenes.find(x => x.onOpen); if (sc) recallScene(z, sc, 0); }
  renderAll(); saveSoon(); startClock();
}

/* ---------- files ---------- */
// A project file is name.noupix (JSON inside; .json files open too). Where the browser lets the page write files
// (Chrome, Edge, the desktop app), the file opened or saved is remembered: Save writes over it without asking, Save
// as asks, and with autosave on every change goes to it a moment later. Elsewhere each save downloads a copy.
let projectFile = null;
// In the app, where the browser's file handles aren't there: the file the project was opened from (by its path) or
// saved to (a download, whose place the app tells, savedToPath). Save writes it through the bridge (POST /save-path).
let projectPath = null;
function setProjectFile(handle, path = null) { projectFile = handle; projectPath = handle ? null : path; }
const fileOfPath = p => String(p || '').split(/[\\/]/).pop();
async function writeProjectPath(quiet) {
  const r = await fetch('/save-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: projectPath, project: projectText() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'the bridge said ' + r.status);
  if (!quiet) toast('Saved ' + fileOfPath(projectPath));
}
// The app: a project downloaded (Save as) went to this file; Save writes it from now on
function savedToPath(path) {
  setProjectFile(null, path);
  nameFromFile(fileOfPath(path));
  if (ui.autosave) autosaveFile();
}
const PROJECT_TYPES = [{ description: 'nouPix project', accept: { 'application/json': ['.noupix', '.json'], 'application/zip': ['.noupixpkg'] } }];
const PACKAGE_TYPES = [{ description: 'nouPix package (the project and its media)', accept: { 'application/zip': ['.noupixpkg'] } }];
const isPackage = name => /\.noupixpkg$/i.test(name || '');
const projectText = () => JSON.stringify(JSON.parse(serialize(true)), null, 1);
const fileName = () => ((project.name || 'noupix-project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'noupix-project') + '.noupix';
async function writeProjectFile(handle, ask) {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if (!ask || (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  }
  const w = await handle.createWritable();
  await w.write(projectText()); await w.close();
  return true;
}
// The project's name is its file's: saved as name2.noupix, it is called name2 (and opened, it takes the file's name)
const nameOfFile = n => String(n || '').replace(/\.(noupix|json)$/i, '').trim();
function nameFromFile(n) {
  const name = nameOfFile(n);
  if (!name || name === project.name || name === nameOfFile(fileName())) return;   // the name it suggested (spaces as dashes): kept as it is
  project.name = name; pushHistory(); saveSoon(); renderAll();
}
async function saveProjectFile(as = false) {
  // the file it came from or went to, known by its path (the app): written over, without asking
  if (!as && projectPath && bridge.connected && !REMOTE_CLIENT) {
    try { await writeProjectPath(false); } catch (e) { toast(`Could not save ${fileOfPath(projectPath)}: ${e.message}. Save as… chooses another place.`, 'err'); }
    return;
  }
  if (!window.showSaveFilePicker) { download(fileName(), projectText()); toast('Project saved as ' + fileName()); return; }
  try {
    if (as || !projectFile) { setProjectFile(await showSaveFilePicker({ suggestedName: projectFile ? projectFile.name : fileName(), types: PROJECT_TYPES })); nameFromFile(projectFile.name); }
    if (await writeProjectFile(projectFile, true)) toast('Saved ' + projectFile.name);
  } catch (e) { if (e.name !== 'AbortError') toast('Could not save: ' + e.message, 'err'); }
}
// With autosave on, a change reaches the file a moment after the last one; quietly, and only once it may be written
const autosaveFile = debounce(() => {
  if (!ui.autosave || REMOTE_CLIENT) return;
  if (projectFile) writeProjectFile(projectFile, false).catch(() => {});
  else if (projectPath && bridge.connected) writeProjectPath(true).catch(() => {});
}, 1500);
function setAutosave(on) {
  ui.autosave = on; savePrefs();
  const file = projectFile ? projectFile.name : projectPath ? fileOfPath(projectPath) : '';
  toast(on ? (file ? 'Autosave on: changes go to ' + file : 'Autosave on: save the project once to choose its file') : 'Autosave off');
  if (on && !file) saveProjectFile();
  else autosaveFile();
}
async function openProjectDialog() {
  if (!window.showOpenFilePicker) { $('#fileOpen').click(); return; }
  try {
    const [handle] = await showOpenFilePicker({ types: PROJECT_TYPES });
    if (await openProjectFile(await handle.getFile()) && !isPackage(handle.name)) setProjectFile(handle);
  } catch (e) { if (e.name !== 'AbortError') toast('Could not open: ' + e.message, 'err'); }
}
async function openProjectFile(file) {
  if (isPackage(file.name)) return openPackage(file);
  try {
    const p = JSON.parse(await file.text());
    if (!p || !Array.isArray(p.fixtures)) throw new Error('not a nouPix project');
    if (nameOfFile(file.name)) p.name = nameOfFile(file.name);
    loadProject(p);
    setProjectFile(null);   // opened without a handle (dropped, or picked the old way): the next Save asks where
    toast(`Opened ${project.name}: ${project.fixtures.length} fixtures`);
    return true;
  } catch (e) { toast('Could not open that file: ' + e.message, 'err'); return false; }
}
/* ---------- the project that opens when nouPix starts ---------- */
// The bridge keeps a copy of it (~/.noupix/startup.noupix) and hands it to the first window after it starts, so a
// computer that starts nouPix by itself (a show computer, a Raspberry Pi) opens it, playing its scenes and playlists
// set to play on open. While it is the one open, every change goes to that copy too. noupix.py --project FILE opens
// that file instead.
const isStartupProject = () => !!(bridge.hello && bridge.hello.startup && bridge.hello.startup.id === project.id);
function setStartupProject(on) {
  if (REMOTE_CLIENT || !bridge.connected) return;
  bridgeSend(on ? { t: 'startup', op: 'set', project: JSON.parse(serialize(true)) } : { t: 'startup', op: 'clear' });
  bridge.hello.startup = on ? { id: project.id, name: project.name } : null;
  toast(on ? `${project.name} opens when nouPix starts.` : 'No project opens by itself when nouPix starts.');
}
const keepStartupProject = debounce(() => { if (isStartupProject() && bridge.connected) bridgeSend({ t: 'startup', op: 'set', project: JSON.parse(serialize(true)) }); }, 2000);
function openStartupProject(p) {
  if (REMOTE_CLIENT || !isObj(p) || !Array.isArray(p.fixtures) || openedByPath) return;   // a file double-clicked goes first
  try { loadProject(p); setProjectFile(null); toast(`Opened ${project.name}, the project nouPix opens when it starts.`); }
  catch (e) { report('opening the startup project', e); }
}
/* ---------- packages: the project and its media in one file ---------- */
// name.noupixpkg is a zip (made and read by the bridge) of project.noupix and the images and videos it uses, from the
// media library, to take a project to another computer. Opening one puts its media into this computer's library.
// Shaders and the guide image are inside the project already.
const packageMedia = () => project.sources.filter(s => (s.kind === 'image' || s.kind === 'video') && !s.builtin);
async function exportPackage(name) {
  const media = [...new Set(packageMedia().map(s => s.media).filter(Boolean))];
  const r = await fetch('/package', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectText(), media }) });
  if (!r.ok) throw new Error('the bridge said ' + r.status);
  const { token } = await r.json(), url = `/package/${token}/${encodeURIComponent(name)}`;
  if (window.showSaveFilePicker) {
    let handle;
    try { handle = await showSaveFilePicker({ suggestedName: name, types: PACKAGE_TYPES }); } catch (e) { if (e.name === 'AbortError') return false; throw e; }
    toast(`Writing ${handle.name}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error('the bridge said ' + res.status);
    await res.body.pipeTo(await handle.createWritable());   // straight to the file, however big
    toast(`Saved ${handle.name}: the project and ${media.length} media file${media.length === 1 ? '' : 's'}.`);
    return true;
  }
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  toast(`${name} is downloading: the project and ${media.length} media file${media.length === 1 ? '' : 's'}.`);
  return true;
}
async function openPackage(file) {
  if (!libraryOk()) { toast('Packages open in nouPix started from noupix.py or the app, which keep the media.', 'warn'); return false; }
  try {
    const big = file.size > 50e6;
    if (big) toast(`Opening ${file.name}: copying its media into this computer's library…`);
    const r = await libraryPut('/package/open', file);
    const p = r.project;
    if (!isObj(p) || !Array.isArray(p.fixtures)) throw new Error('no nouPix project in it');
    if (nameOfFile(file.name)) p.name = nameOfFile(file.name.replace(/\.noupixpkg$/i, ''));
    loadProject(p);
    setProjectFile(null);   // Save writes a .noupix: it asks where
    toast(`Opened ${project.name}, with ${r.media.length} media file${r.media.length === 1 ? '' : 's'}.`);
    return true;
  } catch (e) { toast('Could not open that package: ' + e.message, 'err'); return false; }
}
// A project or package by its path on this computer: one double-clicked in the Finder or Explorer, which the desktop
// app passes on (desktop/main.js). The bridge reads it.
let openedByPath = false;
async function openPath(path) {
  openedByPath = true;
  const name = String(path).split(/[\\/]/).pop();
  try {
    const r = await fetch('/open-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'the bridge said ' + r.status);
    if (!isObj(j.project) || !Array.isArray(j.project.fixtures)) throw new Error('not a nouPix project');
    const base = nameOfFile(name.replace(/\.noupixpkg$/i, ''));
    if (base) j.project.name = base;
    loadProject(j.project);
    setProjectFile(null, isPackage(name) ? null : path);   // Save writes the project back to its file; a package's asks where
    toast(isPackage(name) ? `Opened ${project.name}, with ${j.media.length} media file${j.media.length === 1 ? '' : 's'}.` : `Opened ${project.name}`);
  } catch (e) { toast(`Could not open ${name}: ${e.message}`, 'err'); }
}
function exportCSV() {
  ensurePatch();
  const uni = isSacn() ? 'sACN universe' : 'universe';   // the universes as they go out: sACN counts from 1
  const rows = [['Fixture', 'Type', 'Pixels', 'Color order', 'Bits', 'Controller', 'IP', 'Output', 'Position', 'Start ' + uni, 'Start channel', 'End ' + uni, 'End channel', 'Overflow pixels']];
  const order = [];
  for (const c of project.controllers) c.chains.forEach(ch => ch.forEach(id => { const f = fxById(id); if (f) order.push(f); }));
  for (const f of project.fixtures) if (!f._patch) order.push(f);
  for (const f of order) {
    const p = f._patch;
    const a = p && p.first >= 0 ? addrOf(p.base, p.first) : null, b = p && p.first >= 0 ? addrOf(p.base, p.last) : null;
    rows.push([f.name, TYPE_LABEL[f.type], pixelCount(f), f.order, fxBits(f), p ? p.ctrl.name : '', p ? p.ctrl.ip : '', p ? p.out + 1 : '', p ? p.pos + 1 : '', a ? uniLabel(a.u) : '', a ? a.ch : '', b ? uniLabel(b.u) : '', b ? b.ch : '', p ? p.overflow : '']);
  }
  const csv = rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
  download((project.name || 'noupix').replace(/\s+/g, '-') + '-patch.csv', csv, 'text/csv');
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
  const panel = F('matrix', { name: 'Panel A', cx: 170, cy: 190, w: 240, h: 240, cols: 16, rows: 16, start: 'TL', dir: 'H', snake: true });
  const strips = [0, 1, 2, 3].map(i => F('line', { name: 'Strip ' + (i + 1), x1: 380, y1: 90 + i * 45, x2: 940, y2: 90 + i * 45, pixels: 57, reverse: i % 2 === 1 }));
  const rings = [0, 1, 2].map(i => F('circle', { name: 'Ring ' + (i + 1), cx: 500 + i * 190, cy: 460, r: 80, pixels: 60, order: i === 1 ? 'GRB' : 'RGB' }));
  const pts = [];
  for (let i = 0; i <= 24; i++) { const x = 60 + i * 12; pts.push(x, 470 + Math.sin(i / 24 * Math.PI * 2) * 70); }
  const wave = F('path', { name: 'Wave', pts, pixels: 48 });
  const gStrips = { id: uid(), name: 'Strips', tag: '', open: true }, gRings = { id: uid(), name: 'Rings', tag: '', open: true };
  strips.forEach(s => { s.group = gStrips.id; }); rings.forEach(r => { r.group = gRings.id; });
  project.groups.push(gStrips, gRings);
  const c = newController({ name: 'Pixel controller A', ip: '10.0.0.50', outputs: 4, upo: 4, startUniverse: 0 });
  c.chains = [[panel.id], strips.map(s => s.id), rings.map(r => r.id), [wave.id]];
  project.controllers.push(c);
  const L = (src, o = {}) => Object.assign(newLayer(src), o, { params: o.params ? { [src]: o.params } : {} });
  const S = (name, fade, layers) => ({ id: uid(), name, fade, layers });
  const zAll = newZone({ name: 'All', scenes: [
    S('Plasma', 2, [L('b-plasma')]),
    S('Fire and sparks', 3, [L('b-fire'), L('b-twinkle', { blend: 'add', opacity: 0.7, params: { color: [1, 0.75, 0.3, 1], density: 0.15 } })]),
    S('Rainbow comets', 1.5, [L('b-rainbow', { params: { mode: 1 } }), L('b-comet', { blend: 'multiply', params: { mode: 2, color: [1, 1, 1, 1], count: 3, tail: 0.6 } })]),
    S('Blue pool', 4, [L('b-water')]),
  ] });
  const zRings = newZone({ name: 'Rings', x: 390, y: 360, w: 600, h: 210, scenes: [
    S('Comets', 1.5, [L('b-comet', { params: { mode: 2, count: 3, tail: 0.55, color: [0.2, 0.85, 1, 1] } }), L('b-twinkle', { blend: 'add', opacity: 0.8, params: { color: [1, 0.8, 0.5, 1], density: 0.2, cells: 8 } })]),
    S('Color wipe', 1, [L('b-wipe', { params: { mode: 2 } })]),
    S('Pulse', 0.5, [L('b-pulse')]),
    S('Strobe hit', 0, [L('b-strobe', { params: { rate: 8 } })]),
  ] });
  const zStrips = newZone({ name: 'Strips', x: 360, y: 60, w: 620, h: 190, scenes: [
    S('Rain', 2, [L('b-rain', { params: { angle: 90 } })]),
    S('Bars', 1, [L('b-bars', { params: { count: 6, angle: 0 } })]),
  ] });
  for (const z of [zAll, zRings, zStrips]) { z.scene = z.scenes[0].id; z.layers = cloneLayers(z.scenes[0].layers); }
  project.zones = [zStrips, zRings, zAll]; // All is on top: lower its opacity to see Rings and Strips
  const out = project;
  project = saved;
  return JSON.parse(JSON.stringify(out, replacer));
}
