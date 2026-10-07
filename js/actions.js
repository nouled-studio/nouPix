// openLedMapper · js/actions.js
// What the user can do to the project, whichever button, key or menu asks: add, delete, duplicate, group, lock,
// nudge, align, turn and resize fixtures; copy and paste; zones, layers and scenes; adding sources from files.

/* ---------- adding fixtures ---------- */
function addFixture(f, { select = true } = {}) {
  project.fixtures.push(f);
  markGeom();
  if (select) ui.sel = new Set([f.id]);
  rebuildGeometry();
  commit();
  renderRight();
}

/* ---------- zones ---------- */
// Zones are listed top first: dropping a zone above another puts it over that one
function moveZoneTo(id, target, after) {
  const z = zoneById(id);
  if (!z || z === target) return;
  flipRows('.zones li[data-id]', () => {
    const shown = project.zones.slice().reverse().filter(x => x !== z);
    shown.splice(shown.indexOf(target) + (after ? 1 : 0), 0, z);
    project.zones = shown.reverse();
    commit(); renderRight();
  }, [z.id]);
}

/* ---------- groups and locks ---------- */
// The Group button in the Fixtures header: Group with two or more fixtures selected, Ungroup when the selection is
// a group or one fixture inside a group, dimmed otherwise
function groupAction(sel = selected()) {
  if (wholeGroup(sel) || (sel.length === 1 && sel[0].group != null)) return 'ungroup';
  return sel.length >= 2 ? 'group' : null;
}
// The Lock button beside Group: locks the selection (fixtures, or whole groups), or unlocks it when all of it is
// locked already. Locked fixtures can't be moved, nudged, aligned or deleted.
function lockAction(sel = selected()) { return !sel.length ? null : sel.every(f => f.locked) ? 'unlock' : 'lock'; }
function toggleLockSel() {
  const sel = selected(), a = lockAction(sel), g = wholeGroup(sel);
  if (!a) return;
  sel.forEach(f => { f.locked = a === 'lock'; });
  commit(); renderRight();
  const what = g ? groupName(g) : sel.length === 1 ? sel[0].name : `${sel.length} fixtures`;
  toast(a === 'lock' ? `${what} locked: ${g || sel.length > 1 ? 'they' : 'it'} can't be moved or deleted until unlocked.` : `${what} unlocked.`);
}

/* ---------- sources ---------- */
function removeSource(s) {
  releaseMedia(s.id); dropRuntime(s.id); thumbs.delete(s.id);
  project.sources = project.sources.filter(x => x !== s);
  for (const z of project.zones) for (const L of z.layers.concat(...z.scenes.map(sc => sc.layers))) if (L.src === s.id) L.src = null;
  renderSrcList(); renderRight(); commit();
}

/* ---------- zones ---------- */
const lookEdited = () => { commitSoft(); refreshScenes(); };
function nextZoneName() { let n = 1; while (project.zones.some(z => z.name === 'Zone ' + n)) n++; return 'Zone ' + n; }
function selectZone(z) {
  if (ui.zone !== z.id) { ui.zone = z.id; ui.layer = null; }
  renderRight(); renderSrcList(); refreshScenes();
}
// The first zone above zones[i] that overlaps it and shows: it covers zones[i] there
function zoneAbove(i) {
  const zs = project.zones, z = zs[i];
  for (let j = zs.length - 1; j > i; j--) { const o = zs[j]; if (o.opacity > 0 && o.x < z.x + z.w && z.x < o.x + o.w && o.y < z.y + z.h && z.y < o.y + o.h) return o; }
  return null;
}
// New zones go under the others: zones higher in the list cover the ones below
function addZone(rect) {
  const z = newZone(Object.assign({ name: nextZoneName(), tag: TAGS[(project.zones.length + 1) % TAGS.length] }, rect));
  clampZone(z);
  project.zones.unshift(z);
  ui.zone = z.id; ui.layer = null;
  commit(); renderRight(); renderSrcList();
  const over = zoneAbove(0);
  toast(over ? `${z.name} added under ${over.name}. Lower ${over.name}'s opacity in the Scenes tab to see it, or move ${z.name} up.` : `${z.name} added`);
  return z;
}
function fixtureRect(list, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of list) { const P = f._pts || computePoints(f); for (let i = 0; i < P.length; i += 2) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); } }
  return x1 < x0 ? null : { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + 2 * pad), h: Math.ceil(y1 - y0 + 2 * pad) };
}
function newZoneFromUI() {
  const r = fixtureRect(selected(), 6) || { x: 0, y: 0, w: project.settings.compW, h: project.settings.compH };
  addZone(r);
  setTool('zone');
}
function fitZone(z) { const r = fixtureRect(selected(), 6); if (!r) return; Object.assign(z, r); clampZone(z); commit(); renderRight(); }
function moveZone(z, d) {
  const i = project.zones.indexOf(z), j = i + d;
  if (j < 0 || j >= project.zones.length) return;
  flipRows('.zones li[data-id]', () => { project.zones.splice(i, 1); project.zones.splice(j, 0, z); commit(); renderRight(); }, [z.id]);
}
function duplicateZone(z) {
  const c = Object.assign(JSON.parse(JSON.stringify(z, replacer)), { id: uid(), name: nextCopyName(z.name, new Set(project.zones.map(x => x.name))), scene: null });
  c.scenes.forEach(sc => { sc.id = uid(); });
  const off = Math.max(project.settings.grid, 10) * 2;
  if (c.x + c.w + off <= project.settings.compW && c.y + c.h + off <= project.settings.compH) { c.x += off; c.y += off; }
  project.zones.splice(project.zones.indexOf(z), 0, c);
  ui.zone = c.id; ui.layer = null;
  commit(); renderRight(); renderSrcList();
}
function deleteZone(z) {
  if (!z) return;
  project.zones = project.zones.filter(x => x !== z);
  if (mixer.ok) mixer.prune(new Set(project.zones.map(x => x.id)));
  if (ui.zone === z.id) { ui.zone = null; ui.layer = null; }
  syncMedia(); commit(); renderRight(); renderSrcList();
  toast(`${z.name} deleted. Ctrl Z brings it back.`);
}
// The opacity of a zone is its master. Every slider for it (Content tab, Scenes tab, Inspector) stays in step.
function setZoneOpacity(z, v, from) {
  z.opacity = v;
  for (const el of $$(`[data-zone-op="${z.id}"]`)) if (el !== from) el.value = v;
  for (const el of $$(`[data-zone-pct="${z.id}"]`)) el.textContent = pct(v);
}
function fixturesInZone(z) {
  const out = [];
  let px = 0;
  for (const f of project.fixtures) {
    const P = f._pts; let k = 0;
    if (P) for (let i = 0; i < P.length; i += 2) if (P[i] >= z.x && P[i] <= z.x + z.w && P[i + 1] >= z.y && P[i + 1] <= z.y + z.h) k++;
    if (k) { out.push(f); px += k; }
  }
  return { list: out, px };
}

/* ---------- layers ---------- */
function addLayer(z) {
  const L = newLayer(), cur = selLayer();
  z.layers.splice(cur ? z.layers.indexOf(cur) + 1 : z.layers.length, 0, L);
  ui.layer = L.id; ui.rightTab = 'content';
  commit(); renderRight(); renderSrcList();
}
function moveLayer(z, L, d) {
  const i = z.layers.indexOf(L), j = i + d;
  if (j < 0 || j >= z.layers.length) return;
  flipRows('.layers li[data-id]', () => {
    z.layers.splice(i, 1); z.layers.splice(j, 0, L);
    commit(); renderRight(); renderSrcList();
  }, [L.id]);
}
// A layer dropped on another one in the list (shown top first): it goes just above or below it
function moveLayerTo(z, id, target, after) {
  const L = z.layers.find(x => x.id === id);
  if (!L || L === target) return;
  flipRows('.layers li[data-id]', () => {
    const shown = z.layers.slice().reverse().filter(x => x !== L);
    shown.splice(shown.indexOf(target) + (after ? 1 : 0), 0, L);
    z.layers = shown.reverse();
    commit(); renderRight(); renderSrcList();
  }, [L.id]);
}
function duplicateLayer(z, L) {
  const c = Object.assign(cloneLayers([L])[0], { id: uid() });
  z.layers.splice(z.layers.indexOf(L) + 1, 0, c);
  ui.layer = c.id;
  commit(); renderRight(); renderSrcList();
}
function removeLayer(z, L) {
  z.layers = z.layers.filter(x => x !== L);
  ui.layer = null;
  syncMedia(); commit(); renderRight(); renderSrcList();
}

/* ---------- controllers ---------- */
// The fixtures on it become unpatched; undo brings it back
function deleteController(c) {
  project.controllers = project.controllers.filter(x => x !== c);
  ui.selCtrl = null; markPatch(); commit(); renderRight();
  toast(`${c.name} deleted. ${MOD}Z brings it back.`);
}

/* ---------- the selection ---------- */
function deleteSel() {
  const ids = new Set(ui.sel);
  if (!ids.size) return;
  const keep = selected().filter(f => f.locked).length;
  if (keep === ids.size) { toast(`Locked, so not deleted. Unlock ${keep === 1 ? 'it' : 'them'} first (${MOD}L).`, 'warn'); return; }
  if (keep) toast(`${keep} locked fixture${keep === 1 ? '' : 's'} kept. Unlock ${keep === 1 ? 'it' : 'them'} to delete ${keep === 1 ? 'it' : 'them'} too.`, 'warn');
  project.fixtures = project.fixtures.filter(f => !ids.has(f.id) || f.locked);
  normalizeGroups();   // a group with nothing left goes too
  for (const id of ids) if (!fxById(id)) unassign(id);
  ui.sel.clear();
  markGeom(); markPatch(); computeBB();
  commit(); renderRight();
}
// A whole group is copied as a new group. A fixture of a group copied on its own joins that group.
// When the originals are on one output, the copies go on it after the fixtures already there, while they fit
// (one that doesn't fit is left unpatched). When the originals are spread over several outputs, the copies are
// left unpatched: there is no telling which outputs they are meant for.
function duplicateSel() {
  ensurePatch();
  const out = [], pairs = [];
  const off = Math.max(project.settings.grid, 10) * 2, names = new Set(project.fixtures.map(f => f.name));
  for (const u of selUnits()) {
    const ng = u.g && { id: uid(), name: nextCopyName(groupName(u.g), new Set(project.groups.map(x => groupName(x)))), tag: u.g.tag, open: true, ...(u.g.rot ? { rot: u.g.rot } : {}) };   // a turned group's copy keeps its frame
    if (ng) project.groups.push(ng);
    for (const f of u.list) {
      const g = JSON.parse(JSON.stringify(snapshotGeom(f)));
      g.id = uid(); g.name = nextCopyName(f.name, names); names.add(g.name); g.locked = false; delete g.addr;
      if (ng) g.group = ng.id;
      moveFixture(g, JSON.parse(JSON.stringify(g)), off, off);
      project.fixtures.push(g); out.push(g.id); pairs.push([f._patch, g]);
    }
  }
  if (!out.length) return;
  normalizeGroups(); markGeom(); rebuildGeometry();
  let placed = 0, left = 0;
  const outs = new Set(pairs.filter(([p]) => p).map(([p]) => p.ctrl.id + ':' + p.out));
  for (const [p, g] of pairs) {
    if (!p || outs.size > 1) continue;
    const chain = p.ctrl.chains[p.out];
    chain.push(g.id); markPatch(); computePatch();
    if (g._patch && g._patch.first >= 0 && !g._patch.overflow) placed++;
    else { chain.pop(); markPatch(); computePatch(); left++; }
  }
  onPatchChanged();
  ui.sel = new Set(out);
  commit(); renderRight();
  if (outs.size > 1) toast(`The copies aren't patched: the originals use ${outs.size} outputs. Right-click → Patch to.`);
  else if (placed || left) toast((placed ? `${placed === 1 ? 'The copy is' : placed + ' copies are'} patched after the others on the same output.` : '') +
    (left ? ` ${left === 1 ? 'One copy does' : left + ' copies do'} not fit on the output and ${left === 1 ? 'is' : 'are'} not patched.` : ''));
}
// The selected fixtures go into a new group, where the first of them is in the list
function groupSel() {
  const sel = selected(), same = wholeGroup(sel);
  if (sel.length < 2) { toast('Select two or more fixtures to group them.'); return; }
  if (same) { toast(`${groupName(same)} is a group already.`); return; }
  const g = { id: uid(), name: nextGroupName(), tag: TAGS[(project.groups.length + 2) % TAGS.length], open: true };
  const before = project.fixtures.slice(0, project.fixtures.indexOf(sel[0])).filter(f => !ui.sel.has(f.id)).length;
  const rest = project.fixtures.filter(f => !ui.sel.has(f.id));
  rest.splice(before, 0, ...sel);
  const a = selAngle(sel);
  if (a) g.rot = a;   // a selection turned before grouping keeps its frame
  sel.forEach(f => { f.group = g.id; });
  project.fixtures = rest; project.groups.push(g);
  normalizeGroups(); markGeom(); commit(); renderRight();
  toast(`${g.name}: ${sel.length} fixtures. Rename it in the Inspector.`);
}
// The selected fixtures leave their groups; they stay where they are in the list, after what is left of the group
function ungroupSel() {
  const leaving = new Set(selected().filter(f => f.group != null).map(f => f.id));
  if (!leaving.size) return;
  const out = [], done = new Set();
  for (const f of project.fixtures) {
    if (f.group == null) { out.push(f); continue; }
    if (done.has(f.group)) continue;
    done.add(f.group);
    const m = project.fixtures.filter(x => x.group === f.group);
    out.push(...m.filter(x => !leaving.has(x.id)), ...m.filter(x => leaving.has(x.id)));
  }
  for (const f of out) if (leaving.has(f.id)) delete f.group;
  project.fixtures = out;
  normalizeGroups(); markGeom(); commit(); renderRight();
}
// Into a group (after its last fixture), or out of one (right after it)
function setFixtureGroup(f, gid) {
  if ((f.group ?? '') === gid) return;
  const old = f.group, rest = project.fixtures.filter(x => x !== f);
  if (gid) f.group = gid; else delete f.group;
  const last = rest.map(x => x.group).lastIndexOf(gid || old);
  rest.splice(last >= 0 ? last + 1 : rest.length, 0, f);
  project.fixtures = rest;
  normalizeGroups(); markGeom(); commit(); renderRight();
}
function toggleIdentify() { toggleHighlight(); }
function nudge(dx, dy) {
  const sel = selected().filter(f => !f.locked);
  if (!sel.length) return;
  for (const f of sel) moveFixture(f, snapshotGeom(f), dx, dy);
  markGeom(); syncInspector(); commitSoft();
}

/* ---------- align, distribute, turn and resize ---------- */
function boxAround(bs) {
  const o = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const b of bs) { o.x0 = Math.min(o.x0, b.x0); o.y0 = Math.min(o.y0, b.y0); o.x1 = Math.max(o.x1, b.x1); o.y1 = Math.max(o.y1, b.y1); }
  return o;
}
const boxOf = list => boxAround(list.map(fixtureBounds));
function arrangeUnits(sel = selected()) {
  const lists = wholeGroup(sel) ? sel.map(f => [f]) : selUnits(sel).map(u => u.list);
  return lists.map(list => ({ list, locked: list.some(f => f.locked), b: boxOf(list) }));
}
const shiftUnit = (u, dx, dy) => u.list.forEach(f => shiftFixture(f, dx, dy));
const arranged = () => { markGeom(); commit(); syncInspector(); };
function alignSel(edge) { // l, cx, r: left edges, centres, right edges; t, cy, b likewise vertically
  const units = arrangeUnits(), free = units.filter(u => !u.locked);
  if (!free.length) return;
  const box = units.length > 1 ? boxAround(units.map(u => u.b)) : { x0: 0, y0: 0, x1: project.settings.compW, y1: project.settings.compH };
  for (const u of free) {
    const b = u.b;
    const dx = { l: box.x0 - b.x0, cx: (box.x0 + box.x1 - b.x0 - b.x1) / 2, r: box.x1 - b.x1 }[edge] || 0;
    const dy = { t: box.y0 - b.y0, cy: (box.y0 + box.y1 - b.y0 - b.y1) / 2, b: box.y1 - b.y1 }[edge] || 0;
    shiftUnit(u, dx, dy);
  }
  arranged();
}
// The first and last stay; the ones between get the same spacing between centres
function distributeSel(axis) {
  const free = arrangeUnits().filter(u => !u.locked);
  if (free.length < 3) return;
  const mid = b => (axis === 'x' ? b.x0 + b.x1 : b.y0 + b.y1) / 2;
  const items = free.map(u => ({ u, c: mid(u.b) })).sort((a, b) => a.c - b.c);
  const first = items[0].c, step = (items[items.length - 1].c - first) / (items.length - 1);
  items.forEach((it, i) => { const d = first + i * step - it.c; shiftUnit(it.u, axis === 'x' ? d : 0, axis === 'y' ? d : 0); });
  arranged();
}
// Move the selection as a group, so that together they sit in the middle of the canvas
function centreSel() {
  const free = arrangeUnits().filter(u => !u.locked);
  if (!free.length) return;
  const b = boxAround(free.map(u => u.b)), dx = project.settings.compW / 2 - (b.x0 + b.x1) / 2, dy = project.settings.compH / 2 - (b.y0 + b.y1) / 2;
  free.forEach(u => shiftUnit(u, dx, dy));
  arranged();
}
// Several fixtures selected have a frame that turns with them: a whole group keeps its angle (in the project),
// any other selection until the selection changes. Locked fixtures stay where they are.
const rotatable = () => selected().filter(f => !f.locked);
const selKey = list => list.map(f => f.id).sort().join(',');
// One circle or oval: its frame follows the oval's own axes
const framed = f => f.type === 'circle' || f.type === 'path';
function selAngle(list) {
  if (list.length === 1 && list[0].type === 'circle') return ovalRot(list[0]);
  const g = wholeGroup(list);
  if (g) return numOr(g.rot, 0);
  return ui.selRot && ui.selRot.key === selKey(list) ? ui.selRot.a : 0;
}
function setSelAngle(list, a) {
  if (list.length === 1 && list[0].type === 'circle') return;
  a = r3(wrap180(a));
  const g = wholeGroup(list);
  if (g) { if (a) g.rot = a; else delete g.rot; }
  else ui.selRot = { key: selKey(list), a };
}
const selFrame = list => frameOf(list, selAngle(list));
function rotateSel(deg) {
  const list = rotatable();
  if (!list.length || !deg) return;
  const F = selFrame(list), a = selAngle(list);
  for (const f of list) rotateFixture(f, snapshotGeom(f), F.cx, F.cy, deg);
  setSelAngle(list, a + deg);
  markGeom(); commit(); renderRight();
}
// Resizes the selection to w × h along its frame, from its centre
function resizeSel(w, h) {
  const list = rotatable();
  if (!list.length) return;
  const F = selFrame(list), sx = F.w > 1e-6 && w > 0 ? w / F.w : 1, sy = F.h > 1e-6 && h > 0 ? h / F.h : 1;
  if (sx === 1 && sy === 1) return;
  for (const f of list) scaleFixture(f, snapshotGeom(f), F, 0, 0, sx, sy);
  markGeom(); commit(); renderRight();
}

/* ---------- scenes ---------- */
// Each zone has its own scenes. A scene is a copy of the zone's layers; recalling it crossfades that zone to it.
const lookOf = layers => JSON.stringify(layers.map(L => [L.src, L.on, L.opacity, L.blend, L.params[L.src] || {}]));
const snapshotLayers = z => cloneLayers(z.layers).map(L => Object.assign(L, { params: L.src && L.params[L.src] ? { [L.src]: L.params[L.src] } : {} }));
function goScene(z, sc, cut = false) {
  startFade(z, cut ? 0 : sc.fade, sc.id);
  z.layers = cloneLayers(sc.layers).map(L => Object.assign(L, { src: srcById(L.src) ? L.src : null }));
  z.scene = sc.id;
  if (ui.zone !== z.id || !z.layers.some(L => L.id === ui.layer)) ui.layer = null;
  ui.zone = z.id;
  syncMedia(); renderSrcList(); renderDock();
  if (ui.rightTab === 'content' || ui.tool === 'zone') renderRight();
  commitSoft();
}
function storeScene(z) {
  let n = z.scenes.length + 1;
  while (z.scenes.some(s => s.name === 'Scene ' + n)) n++;
  const sc = { id: uid(), name: 'Scene ' + n, fade: project.settings.fade, tag: TAGS[z.scenes.length % TAGS.length], layers: snapshotLayers(z) };
  z.scenes.push(sc);
  z.scene = sc.id; ui.zone = z.id;
  commit();
  toast(`Stored ${sc.name} in ${z.name}. Use ⋯ on its button to rename it or change its fade time.`);
}
// Move a scene ('zoneId:sceneId') into a zone: onto a scene it takes that scene's place, onto the row it goes last
function moveScene(d, z, to = z.scenes.length) {
  const [zid, sid] = d.split(':');
  const fz = zoneById(zid), moving = fz && fz.scenes.find(s => s.id === sid);
  if (!moving || (fz === z && fz.scenes[to] === moving)) return;
  fz.scenes.splice(fz.scenes.indexOf(moving), 1);
  z.scenes.splice(to, 0, moving);
  if (fz !== z && fz.scene === moving.id) fz.scene = null;
  commit();
}

/* ---------- adding sources from files and screens ---------- */
async function addIsfFile(file) {
  const code = await file.text();
  const src = { id: uid(), kind: 'isf', name: file.name.replace(/\.(fs|glsl|txt)$/i, ''), code };
  project.sources.push(src);
  const rt = runtimeOf(src);
  loadSource(src.id);
  ui.rightTab = 'content';
  commit(); renderSrcList(); renderRight();
  toast(rt.error ? 'Shader loaded with an error: see the Content tab' : `Loaded ${src.name}`, rt.error ? 'err' : '');
}
let mediaTarget = null;
function pickMedia(src) { mediaTarget = src || null; $('#fileMedia').click(); }
async function addMediaFile(file) {
  const target = mediaTarget;
  mediaTarget = null;
  let probe;
  try { probe = await probeMedia(file); } catch (e) { toast(e.message, 'err'); return; }
  let src = target && project.sources.includes(target) ? target : null;
  const isNew = !src;
  if (isNew) { src = { id: uid(), kind: probe.kind, name: file.name, fit: 'fit', rate: 1 }; project.sources.push(src); }
  attachMedia(src, probe);
  if (isNew) loadSource(src.id);
  syncMedia(); ui.rightTab = 'content';
  commit(); renderSrcList(); renderRight();
  if (probe.kind === 'video') toast(`${src.name}: ${probe.w} × ${probe.h}, ${fmtDur(probe.duration)}`);
}
async function startCapture(src) {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('not supported');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
    const el = document.createElement('video');
    Object.assign(el, { muted: true, playsInline: true, autoplay: true });
    el.srcObject = stream;
    await el.play().catch(() => {});
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (mediaEls.get(src.id) === el) releaseMedia(src.id); renderSrcList(); if (ui.rightTab === 'content') renderRight(); });
    releaseMedia(src.id); // a capture started twice
    mediaEls.set(src.id, el);
    markThumb(src);
    renderSrcList(); renderRight();
  } catch (e) {
    toast(e && e.name === 'NotAllowedError' ? 'Screen capture was blocked or cancelled. It works when openLedMapper is opened from openledmapper.py in a desktop browser.' : 'Screen capture is not available in this browser.', 'warn');
  }
}
function stopCapture(src) {
  releaseMedia(src.id);
  markThumb(src);
  renderSrcList(); renderRight();
}
function addScreenSource() {
  const src = { id: uid(), kind: 'screen', name: 'Screen capture', fit: 'stretch' };
  project.sources.push(src);
  loadSource(src.id); ui.rightTab = 'content';
  commit(); renderSrcList(); renderRight();
  startCapture(src);
}

/* ---------- stacking order ---------- */
// The fixtures are drawn in list order, the last on top. A whole group moves as one; fixtures picked out of a
// group move to the top or bottom of their group.
function restackSel(front) {
  const ids = new Set(ui.sel), units = selUnits();
  const move = (arr, pick) => { const a = arr.filter(pick), b = arr.filter(f => !pick(f)); return front ? b.concat(a) : a.concat(b); };
  let F = project.fixtures.slice();
  for (const gid of new Set(units.filter(u => !u.g && u.list[0].group != null).map(u => u.list[0].group))) {
    const at0 = F.findIndex(f => f.group === gid), members = F.filter(f => f.group === gid);
    F.splice(at0, members.length, ...move(members, f => ids.has(f.id)));
  }
  const whole = new Set(units.filter(u => u.g || u.list[0].group == null).flatMap(u => u.list.map(f => f.id)));
  if (whole.size) F = move(F, f => whole.has(f.id));
  project.fixtures = F;
  normalizeGroups(); markGeom(); commit(); renderRight();
}

/* ---------- copy and paste ---------- */
// Copied fixtures go on the system clipboard as text, so they paste into another project, another openLedMapper
// window, or the desktop app; they are also kept here for "Paste here" when the clipboard can't be read.
let clip = store.get('openledmapper.clip', null);
const isClip = d => isObj(d) && d.openledmapper === 'fixtures' && Array.isArray(d.fixtures);
function clipOfSel() {
  const sel = selected();
  if (!sel.length) return null;
  const groups = selUnits(sel).filter(u => u.g).map(u => ({ id: u.g.id, name: u.g.name, tag: u.g.tag, ...(u.g.rot ? { rot: u.g.rot } : {}) }));
  const whole = new Set(groups.map(g => g.id));
  const fixtures = sel.map(f => { const c = JSON.parse(JSON.stringify(snapshotGeom(f))); if (!whole.has(c.group)) delete c.group; delete c.addr; return c; });
  return { openledmapper: 'fixtures', version: 1, fixtures, groups };
}
function copySel(e) {
  const d = clipOfSel();
  if (!d) return false;
  clip = d; store.set('openledmapper.clip', d);
  const text = JSON.stringify(d);
  if (e && e.clipboardData) e.clipboardData.setData('text/plain', text);
  else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  toast(d.fixtures.length === 1 ? `Copied ${d.fixtures[0].name}` : `Copied ${d.fixtures.length} fixtures`);
  return true;
}
// Ctrl V: where they were, moved down and right while that place is taken. Paste here: centred on the point.
function pasteFixtures(d, point) {
  if (!isClip(d)) return;
  const ids = new Set(project.fixtures.map(f => f.id)), names = new Set(project.fixtures.map(f => f.name));
  const gnames = new Set(project.groups.map(g => groupName(g)));
  const gmap = new Map((Array.isArray(d.groups) ? d.groups : []).filter(g => isObj(g) && isId(g.id)).map((g, i) => [String(g.id),
    { id: uid(), name: typeof g.name === 'string' && g.name ? (gnames.has(g.name) ? nextCopyName(g.name, gnames) : g.name) : nextGroupName(), tag: typeof g.tag === 'string' ? g.tag : TAGS[(project.groups.length + 2 + i) % TAGS.length], open: true,
      ...(Number.isFinite(g.rot) && g.rot ? { rot: wrap180(g.rot) } : {}) }]));
  const list = d.fixtures.filter(f => isObj(f) && TYPE_LABEL[f.type]).map((f0, i) => {
    const f = JSON.parse(JSON.stringify(f0));
    delete f.id; delete f.addr; f.locked = false;
    if (typeof f.gamma !== 'number') f.gamma = project.settings.gamma;
    const g = isId(f.group) && gmap.get(String(f.group));
    if (g) f.group = g.id; else delete f.group;
    fixFixture(f, i, ids);
    let n = f.name;
    if (names.has(n)) n = nextCopyName(f.name, names);
    f.name = n; names.add(n);
    return f;
  });
  if (!list.length) return;
  const b = boxOf(list);
  let dx = 0, dy = 0;
  if (point) { dx = point[0] - (b.x0 + b.x1) / 2; dy = point[1] - (b.y0 + b.y1) / 2; }
  else {
    const near = (a, b) => typeof a === 'number' ? typeof b === 'number' && Math.abs(a - b) < 0.01 : Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((v, i) => near(v, b[i])) : a === b;
    const at = (f, ox, oy) => { const c = JSON.parse(JSON.stringify(f)); moveFixture(c, JSON.parse(JSON.stringify(f)), ox, oy); return c; };
    const taken = g => project.fixtures.some(f => f.type === g.type && Object.keys(FIXTURE_FIELDS[g.type]).every(k => near(f[k], g[k])));
    const off = Math.max(project.settings.grid, 10) * 2;
    for (let k = 0; k < 50 && taken(at(list[0], dx, dy)); k++) { dx += off; dy += off; }
  }
  for (const f of list) shiftFixture(f, dx, dy);
  project.groups.push(...[...gmap.values()].filter(g => list.some(f => f.group === g.id)));
  project.fixtures.push(...list);
  ui.sel = new Set(list.map(f => f.id));
  normalizeGroups(); markGeom(); rebuildGeometry();
  commit(); onSelection();
  toast(`Pasted ${list.length === 1 ? list[0].name : list.length + ' fixtures'}. Patch ${list.length === 1 ? 'it' : 'them'} with right-click → Patch to.`);
}
function pasteFromClipboard(point) {
  const fallback = () => clip ? pasteFixtures(clip, point) : toast('Nothing to paste: copy fixtures first (right-click → Copy, or ' + MOD + 'C).');
  if (!navigator.clipboard || !navigator.clipboard.readText) return fallback();
  navigator.clipboard.readText().then(t => { let d = null; try { d = JSON.parse(t); } catch (e) { /* not ours */ } isClip(d) ? pasteFixtures(d, point) : fallback(); }, fallback);
}
