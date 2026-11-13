// nouPix · js/actions.js
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
  for (let j = zs.length - 1; j > i; j--) { const o = zs[j]; if (zoneLevel(o) > 0 && o.x < z.x + z.w && z.x < o.x + o.w && o.y < z.y + z.h && z.y < o.y + o.h) return o; }
  return null;
}
// New zones go under the others: zones higher in the list cover the ones below
function addZone(rect) {
  const z = newZone(Object.assign({ name: nextZoneName() }, rect));
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
  const ids = new Map();
  c.scenes.forEach(sc => { const id = uid(); ids.set(sc.id, id); sc.id = id; });
  c.playlists.forEach(pl => pl.steps.forEach(st => { st.id = uid(); st.scene = ids.get(st.scene); }));   // the copy's playlists play the copy's scenes
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
// The opacity of a zone is its master. Every slider for it (Content tab, Scenes tab, Inspector) stays in step. On the
// X-Fader's zones it is the most the zone reaches: the fader mixes within it (zoneLevel).
function setZoneOpacity(z, v, from) {
  z.opacity = v;
  if (REMOTE_CLIENT && from) remoteOp({ op: 'opacity', zone: z.id, value: v });   // live on the main computer while it moves
  showZoneOpacity(z, from);
}
function showZoneOpacity(z, from) {
  for (const d of [document, scenesDoc()]) if (d) {   // here and in the Scenes window
    for (const el of $$(`[data-zone-op="${z.id}"]`, d)) if (el !== from) el.value = z.opacity;
    for (const el of $$(`[data-zone-pct="${z.id}"]`, d)) el.textContent = pct(z.opacity);
    for (const el of $$(`[data-zone-eff="${z.id}"]`, d)) el.textContent = pct(zoneLevel(z));   // on the X-Fader's strip: as it shows
  }
}
// The crossfader's position, from its slider, a MIDI control or a device: 0 is all A, 1 all B. It moves even while
// the crossfader is off (a MIDI fader stays mapped), and sets the zones only while it is on.
function setXfade(x, from) {
  const X = project.xfade;
  X.x = clamp(x, 0, 1);
  if (REMOTE_CLIENT && from) remoteOp({ op: 'xfade', value: X.x });   // live on the main computer while it moves
  xfApply();
  for (const d of [document, scenesDoc()]) if (d) for (const el of $$('[data-xf]', d)) if (el !== from) el.value = X.x;
}
// The X-Fader moved, or its zones or mode changed: A and B show through it (zoneLevel), their own levels untouched;
// what shows them is redrawn
function xfApply() {
  const p = xfZones();
  if (!p) return;
  showZoneOpacity(p[0]); showZoneOpacity(p[1]);
}
// On or off. On needs two zones: A and B are the first two unless two others were chosen. Off, A and B show at their
// own levels again.
function setXfadeOn(on) {
  const X = project.xfade, zs = project.zones;
  if (on) {
    if (zs.length < 2) { toast('The X-Fader needs two zones. Add another in the Content tab.'); return; }
    if (!zoneById(X.a)) X.a = zs.find(z => z.id !== X.b).id;
    if (!zoneById(X.b) || X.b === X.a) X.b = zs.find(z => z.id !== X.a).id;
  }
  X.on = !!on;
  xfApply();
  commit(); renderRight();
  if (on) xfFitAdvice();
}
// The crossfader works best when A and B both cover the whole canvas, so each lights every fixture: if they don't,
// say so, with a way to do it now
function xfFitAdvice() {
  const p = xfZones(), s = project.settings;
  const part = p && p.filter(z => z.x !== 0 || z.y !== 0 || z.w !== s.compW || z.h !== s.compH);
  if (!part || !part.length) return;
  const close = () => bg.remove();
  const fill = () => { close(); for (const z of p) Object.assign(z, { x: 0, y: 0, w: s.compW, h: s.compH }); commit(); renderRight(); toast(`${p[0].name} and ${p[1].name} cover the whole canvas. ${MOD}Z undoes.`); };
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'X-Fader' },
      h('header', null, 'X-Fader'),
      h('div', { class: 'mb' },
        h('p', null, 'The X-Fader mixes two zones with one fader: A on the left, B on the right. Live, it fades from one look to the next (a DJ set, a concert).'),
        h('p', null, `Make ${p[0].name} (A) and ${p[1].name} (B) full size, so the fade reaches every light?`)),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Not now'),
        mappingLocked() ? null : h('button', { class: 'btn primary', type: 'button', onclick: fill }, 'Make both full size'))));
  uiDocNow().body.append(bg);   // in the window it was asked for from
}
// How it fades: mix, dip or cut (XF_MODES)
function setXfadeMode(mode) {
  if (!XF_MODES.some(m => m[0] === mode) || project.xfade.mode === mode) return;
  project.xfade.mode = mode;
  xfApply();
  commit();
}
// Which zone is A or B (which: 'a' or 'b'); the zone already on the other side swaps over
function setXfadeZone(which, id) {
  const X = project.xfade, other = which === 'a' ? 'b' : 'a';
  if (!zoneById(id) || X[which] === id) return;
  if (X[other] === id) X[other] = X[which];
  X[which] = id;
  xfApply();
  commit(); renderRight();
}
// A group's dimmer, from its slider or a MIDI control; every slider showing it follows
function setGroupLevel(g, v, from) {
  v = clamp(v, 0, 1);
  if (v < 1) g.level = v; else delete g.level;
  for (const el of $$(`[data-group-lv="${g.id}"]`)) if (el !== from) el.value = v;
  for (const el of $$(`[data-group-pct="${g.id}"]`)) { el.textContent = pct(v); if (el.classList.contains('gdim')) el.hidden = v >= 1; }
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
  const src = srcById(L.src);
  z.layers = z.layers.filter(x => x !== L);
  ui.layer = null;
  syncMedia(); commit(); renderRight(); renderSrcList();
  toast(`${src ? src.name + ' layer' : 'Empty layer'} removed from ${z.name}. ${MOD}Z brings it back.`);
}

/* ---------- controllers ---------- */
// The fixtures on it become unpatched; undo brings it back
function deleteController(c) { deleteControllers([c]); }
function deleteControllers(list) {
  const gone = new Set(list);
  if (!gone.size) return;
  project.controllers = project.controllers.filter(x => !gone.has(x));
  ui.selCtrl = null; ui.selCtrls = new Set(); markPatch(); commit(); renderRight();
  toast(`${gone.size === 1 ? list[0].name : gone.size + ' controllers'} deleted. ${MOD}Z brings ${gone.size === 1 ? 'it' : 'them'} back.`);
}
// Asks first: deleting controllers unpatches their fixtures
function askDeleteControllers(list) {
  if (!list.length) return;
  const n = list.reduce((a, c) => a + c.chains.flat().filter(fxById).length, 0);
  confirmBox(list.length === 1 ? `Delete ${list[0].name}?` : `Delete ${list.length} controllers?`,
    n ? `Their ${n} patched fixture${n === 1 ? '' : 's'} become unpatched. ${MOD}Z brings everything back.` : `${MOD}Z brings ${list.length === 1 ? 'it' : 'them'} back.`,
    'Delete', () => deleteControllers(list));
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
  const g = { id: uid(), name: nextGroupName(), tag: '', open: true };
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
// Locks a strip's or circle's pitch at its spacing now (snapped to whole pixels), or unlocks it
function setPitchLock(f, on) {
  if (on) { f.pitchLock = r3(fixturePitch(f)); fitPitch(f); } else delete f.pitchLock;
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

/* ---------- timelines ---------- */
function addTimeline() {
  let n = project.timelines.length + 1;
  while (project.timelines.some(T => T.name === 'Timeline ' + n)) n++;
  const T = newTimeline({ name: 'Timeline ' + n });
  project.timelines.push(T);
  ui.tlId = T.id; ui.tlSel = null;
  commit({ lists: false }); refreshTimeline();
  return T;
}
function deleteTimeline(T) {
  if (tl.id === T.id) { tlHalt(); tl.id = null; }
  project.timelines = project.timelines.filter(o => o !== T);
  if (ui.tlId === T.id) ui.tlId = null;
  commit({ lists: false }); refreshTimeline();
  toast(`${T.name} deleted. ${MOD}Z brings it back.`);
}
// Its length: never shorter than its clips; the loop's region kept inside
function setTimelineLength(T, len) {
  const ends = Object.values(T.tracks).flat().reduce((m, c) => Math.max(m, c.start + c.dur), 0);
  T.length = clamp(Math.max(+len || T.length, ends), 1, 36000);
  T.loop.b = Math.min(T.loop.b, T.length); T.loop.a = Math.min(T.loop.a, T.loop.b - 0.1);
}
// An audio file plays with it, on a track of its own from a time (or in place of a track's file): copied into the
// media library (played from the file meanwhile); as long as the file, and the timeline at least as long as it
function addTimelineAudio(T, file, start = 0, A = null) {
  tlHalt();
  const props = { name: file.name, _url: URL.createObjectURL(file) };
  if (A) { delete A.media; Object.assign(A, props, { trim: 0 }); }
  else { A = newTlAudio(Object.assign(props, { start: clamp(start, 0, T.length - 0.1) })); T.audios.push(A); }
  // its tempo found once it is read (ui-timeline.js), when it is the timeline's only audio
  if (T.audios.length === 1) A._detect = true;
  ui.tlSel = A.id;
  storeMedia(A, file);
  const a = new Audio(A._url);
  a.addEventListener('loadedmetadata', () => {
    if (!isFinite(a.duration)) return;
    A.dur = Math.round(Math.max(0.1, a.duration - A.trim) * 1000) / 1000;
    if (A.start + A.dur > T.length) setTimelineLength(T, Math.ceil(A.start + A.dur));
    commit({ lists: false }); refreshTimeline();
  });
  commit({ lists: false }); refreshTimeline();
  return A;
}
function removeTimelineAudio(T, A) {
  T.audios = T.audios.filter(x => x !== A);
  if (ui.tlSel === A.id) ui.tlSel = null;
  tlAudioSync(T, tlPos(), tl.playing && tl.id === T.id);
  commit({ lists: false }); refreshTimeline();
}
// A clip of one of a zone's scenes at a time: as long as there is room before the next clip (8 s at most)
function addClip(T, z, sceneId, t, lane = 0) {
  const clips = T.tracks[z.id] || (T.tracks[z.id] = []), mine = clips.filter(c => (c.lane || 0) === lane);
  t = clamp(t, 0, T.length - 0.1);
  if (mine.some(c => c.start <= t && t < c.start + c.dur)) { toast('There is a clip there already: drop it on an empty part of the lane, or on another lane.', 'warn'); return null; }
  const next = mine.filter(c => c.start > t).reduce((m, c) => Math.min(m, c.start), T.length);
  const sc = z.scenes.find(s => s.id === sceneId), dur = Math.min(8, next - t);
  if (!sc || dur < 0.1) return null;
  const c = newClip(sceneId, t, dur, { fadeIn: Math.min(1, dur / 4), fadeOut: Math.min(1, dur / 4), lane });
  clips.push(c); clips.sort((a, b) => a.start - b.start);
  ui.tlSel = c.id; tl.clips[z.id] = undefined;
  commit({ lists: false }); refreshTimeline();
  return c;
}
// Lanes: one more on top of a zone's track; the top one taken off when it has no clips
function addLane(T, z) {
  const lanes = T.lanes || (T.lanes = {}), n = lanes[z.id] || 1;
  if (n >= 16) return;
  lanes[z.id] = n + 1;
  commit({ lists: false }); refreshTimeline();
}
function removeLane(T, z) {
  const lanes = T.lanes || (T.lanes = {}), n = lanes[z.id] || 1;
  if (n <= 1) return;
  if ((T.tracks[z.id] || []).some(c => (c.lane || 0) === n - 1)) { toast('Its top lane has clips: move or delete them first.', 'warn'); return; }
  if (n - 1 > 1) lanes[z.id] = n - 1; else delete lanes[z.id];
  commit({ lists: false }); refreshTimeline();
}
function deleteClip(T, z, c) {
  const clips = T.tracks[z.id] || [];
  T.tracks[z.id] = clips.filter(o => o !== c);
  if (!T.tracks[z.id].length) delete T.tracks[z.id];
  if (ui.tlSel === c.id) ui.tlSel = null;
  tl.clips[z.id] = undefined;
  commit({ lists: false }); refreshTimeline();
}
function duplicateClip(T, z, c) {
  const d = addClip(T, z, c.scene, c.start + c.dur, c.lane || 0);
  if (d) {
    d.dur = Math.min(c.dur, d.dur); d.fadeIn = Math.min(c.fadeIn, d.dur); d.fadeOut = Math.min(c.fadeOut, d.dur - d.fadeIn);
    if (c.curves) d.curves = JSON.parse(JSON.stringify(c.curves));
    commit({ lists: false }); refreshTimeline();
  }
}
// Markers on the audio: a flag at a time with a name ("Drop", "Break"…) and a colour
function addMarker(T, t, name, color = '') {
  const m = { id: uid(), t: clamp(t, 0, T.length), name: name || 'Marker ' + ((T.markers || []).length + 1), color };
  (T.markers || (T.markers = [])).push(m); T.markers.sort((a, b) => a.t - b.t);
  commit({ lists: false }); refreshTimeline();
  return m;
}
function deleteMarker(T, m) {
  T.markers = T.markers.filter(x => x !== m);
  commit({ lists: false }); refreshTimeline();
}
// Keyframes on a clip: a curve added (the level, or a control of its scene's effects, from where it is in the scene),
// removed; a key set at a time (where a key is, it takes the value), removed
function addCurve(T, z, c, cv, quiet) {
  const sc = z && z.scenes.find(s => s.id === c.scene), L = sc && cv.kind === 'param' && sc.layers.find(l => l.src === cv.src);
  const s = cv.kind === 'param' && srcById(cv.src), inp = tlCurveInput(cv);
  if (!inp) return null;
  const v = cv.kind === 'level' ? 1 : L && s ? paramValue(L, s, inp) : paramValue({ params: {} }, s, inp);
  const k = v => (Array.isArray(v) ? v.slice() : v);
  const curve = Object.assign({}, cv, { keys: [{ t: 0, v: k(v), ease: 'linear' }, { t: c.dur, v: k(v), ease: 'linear' }] });
  (c.curves || (c.curves = [])).push(curve);
  if (!quiet) { commit({ lists: false }); tlKeysChanged(T); }
  return curve;
}
function removeCurve(T, c, cv) {
  c.curves = (c.curves || []).filter(x => x !== cv);
  if (!c.curves.length) delete c.curves;
  commit({ lists: false }); tlKeysChanged(T);
}
function setKey(T, c, cv, t, v, ease) {
  t = clamp(t, 0, c.dur);
  let k = cv.keys.find(x => Math.abs(x.t - t) < 0.01);
  if (k) k.v = v; else { k = { t, v, ease: ease || 'linear' }; cv.keys.push(k); tlSortKeys(cv); }
  commit({ lists: false }); tlKeysChanged(T);
  return k;
}
function deleteKey(T, c, cv, k) {
  cv.keys = cv.keys.filter(x => x !== k);
  if (!cv.keys.length) c.curves = c.curves.filter(x => x !== cv);
  if (c.curves && !c.curves.length) delete c.curves;
  commit({ lists: false }); tlKeysChanged(T);
}
// Several keys at once (each { c, cv, k }): a curve left with none goes
function deleteKeys(T, items) {
  for (const { c, cv, k } of items) {
    cv.keys = cv.keys.filter(x => x !== k);
    if (!cv.keys.length) c.curves = (c.curves || []).filter(x => x !== cv);
    if (c.curves && !c.curves.length) delete c.curves;
  }
  commit({ lists: false }); tlKeysChanged(T);
}
// What shows follows at once when the timeline is the one playing or paused
function tlKeysChanged(T) {
  if (tl.id === T.id) { tlApply(T, tlPos(), false); tlAudioSync(T, tlPos(), tl.playing, false); }
  refreshTimeline();
}

/* ---------- cue lists ---------- */
function addCueList() {
  let n = project.cueLists.length + 1;
  while (project.cueLists.some(L => L.name === 'Cue list ' + n)) n++;
  const L = newCueList({ name: 'Cue list ' + n });
  project.cueLists.push(L);
  ui.cueList = L.id; ui.cueSel = null;
  commit({ lists: false }); refreshCues();
  return L;
}
function deleteCueList(L) {
  project.cueLists = project.cueLists.filter(o => o !== L);
  cueRun.delete(L.id);
  if (ui.cueList === L.id) ui.cueList = null;
  commit({ lists: false }); refreshCues();
  toast(`${L.name} deleted. ${MOD}Z brings it back.`);
}
// The number after the highest whole number in the list
const nextCueNum = L => String(Math.floor(L.cues.reduce((m, c) => Math.max(m, parseFloat(c.num) || 0), 0)) + 1);
// A new cue after the one picked (or at the end), picked and on standby
function insertCue(L, c) {
  // after the cue open, or else the one on standby
  const at = L.cues.findIndex(o => o.id === (ui.cueSel || (cueRun.get(L.id) || {}).standby));
  L.cues.splice(at >= 0 ? at + 1 : L.cues.length, 0, c);
  ui.cueSel = c.id;
  commit({ lists: false }); cueStandby(L, c);
  return c;
}
const addCue = L => insertCue(L, newCue({ num: nextCueNum(L) }));
// What every zone shows now: its scene and its level
const actionsNow = () => project.zones.slice().reverse().map(z => newCueAction(z.id, { scene: z.scene || '', level: z.opacity, fade: project.settings.fade }));
function recordCue(L) {
  const c = insertCue(L, newCue({ num: nextCueNum(L), actions: actionsNow() }));
  toast(`Cue ${c.num}: what every zone shows now. Click it to change its actions and fades.`);
  return c;
}
// Its zones as they show now (their scene and level), keeping each action's fade
function updateCueFromNow(c) {
  for (const a of c.actions) { const z = zoneById(a.zone); if (z) { a.scene = z.scene || ''; a.level = z.opacity; } }
  commit({ lists: false }); refreshCues();
}
function moveCue(L, c, d) {
  const i = L.cues.indexOf(c), j = i + d;
  if (i < 0 || j < 0 || j >= L.cues.length) return;
  L.cues.splice(i, 1); L.cues.splice(j, 0, c);
  commit({ lists: false }); refreshCues();
}
function duplicateCue(L, c) {
  const d = JSON.parse(JSON.stringify(c));
  d.id = uid(); d.num = nextCueNum(L);
  ui.cueSel = c.id;
  insertCue(L, d);
}
function deleteCue(L, c) {
  L.cues = L.cues.filter(o => o !== c);
  for (const o of L.cues) if (o.then === 'goto' && o.target === c.id) { o.then = 'wait'; o.target = ''; }
  if (ui.cueSel === c.id) ui.cueSel = null;
  commit({ lists: false }); refreshCues();
  toast(`Cue ${c.num} deleted. ${MOD}Z brings it back.`);
}

/* ---------- scenes ---------- */
// Each zone has its own scenes. A scene is a copy of the zone's layers; recalling it crossfades that zone to it.
const lookOf = layers => JSON.stringify(layers.map(L => [L.src, L.on, L.opacity, L.blend, L.params[L.src] || {}]));
const snapshotLayers = z => cloneLayers(z.layers).map(L => Object.assign(L, { params: L.src && L.params[L.src] ? { [L.src]: L.params[L.src] } : {} }));
// A scene picked by hand: the zone fades to it over the scene's own fade, and its playlist pauses
function goScene(z, sc, cut = false) {
  if (REMOTE_CLIENT) remoteOp({ op: 'scene', zone: z.id, scene: sc.id, cut });   // the main computer fades its output too
  else playlistManual(z, sc.id);
  recallScene(z, sc, cut ? 0 : sc.fade);
  if (ui.zone !== z.id || !z.layers.some(L => L.id === ui.layer)) ui.layer = null;
  ui.zone = z.id;
  syncMedia(); renderSrcList(); renderDock();
  if (ui.rightTab === 'content' || ui.tool === 'zone') renderRight();
  commitSoft();
}
// A zone's content stopped: it fades to black over the fade for new scenes (Settings), its playlist stops; a step of undo
function stopZone(z) {
  if (REMOTE_CLIENT) remoteOp({ op: 'stop', zone: z.id }); else stopPlaylist(z);
  if (!z.layers.length && !z.scene) return;
  startFade(z, project.settings.fade, null);
  z.layers = []; z.scene = null; z._tlAnim = false;
  if (ui.zone === z.id) ui.layer = null;
  syncMedia(); renderSrcList();
  if (ui.rightTab === 'content') renderRight();
  commit();
}
function storeScene(z) {
  let n = z.scenes.length + 1;
  while (z.scenes.some(s => s.name === 'Scene ' + n)) n++;
  const sc = { id: uid(), name: 'Scene ' + n, fade: project.settings.fade, layers: snapshotLayers(z) };
  z.scenes.push(sc);
  if (project.settings.sceneShots) sceneShot(z, sc);
  z.scene = sc.id; ui.zone = z.id;
  commit();
  toast(`Stored ${sc.name} in ${z.name}. Use ⋯ on its button to rename it or change its fade time.`);
}
// A scene's picture: its zone as it looks now, small (160 wide), kept with the scene and shown on its button.
// False when the zone shows nothing yet.
function sceneShot(z, sc) {
  const w = 160, hh = clamp(Math.round(w * z.h / Math.max(1, z.w)), 24, 160);
  const c = zonePicture(z, w, hh);
  if (!c) return false;
  sc.thumb = c.toDataURL('image/jpeg', 0.8);
  return true;
}
function takeSceneShot(z, sc) {
  if (!sceneShot(z, sc)) { toast(`${z.name} shows nothing yet: no snapshot taken.`); return; }
  commit();
  toast(`${sc.name} has a snapshot now.`);
}
// What is changed in a zone's layers as it plays a scene, with the same contents (a speed, a colour, a layer's opacity,
// from the Content tab or MIDI), goes into that scene, so recalling it brings it back as it was left. Other contents
// (a source swapped, a layer added or removed) don't: the scene shows "edited", and is saved only from there or
// ⋯ → Update; recalled meanwhile, it comes back as it was stored. Run before each step of undo is taken, so the scene
// and its zone change together. Not while the zone fades to it, and only on the main window (a device's copy comes
// from it).
const sameContents = (a, b) => a.length === b.length && a.every((L, i) => (L.src || null) === (b[i].src || null));
function keepScenes() {
  if (REMOTE_CLIENT) return;
  for (const z of project.zones) {
    // (not what a timeline's keyframes move: they would end up in the scene)
    const sc = z.scene && !z._fade && !z._tlAnim && z.scenes.find(s => s.id === z.scene);
    if (sc && sameContents(sc.layers, z.layers) && lookOf(sc.layers) !== lookOf(z.layers)) sc.layers = snapshotLayers(z);
  }
}
// Updating a scene with the zone's layers (and its picture, with Settings → Scenes → Pictures on)
function updateScene(z, sc) {
  sc.layers = snapshotLayers(z); z.scene = sc.id;
  if (project.settings.sceneShots) sceneShot(z, sc);
  commit();
  toast(`${sc.name} updated`);
}
// Move a scene ('zoneId:sceneId') into a zone: onto a scene it takes that scene's place, onto the row it goes last
function moveScene(d, z, to = z.scenes.length) {
  const [zid, sid] = d.split(':');
  const fz = zoneById(zid), moving = fz && fz.scenes.find(s => s.id === sid);
  if (!moving || (fz === z && fz.scenes[to] === moving)) return;
  fz.scenes.splice(fz.scenes.indexOf(moving), 1);
  z.scenes.splice(to, 0, moving);
  if (fz !== z && fz.scene === moving.id) fz.scene = null;
  if (fz !== z) dropSceneSteps(fz, moving.id);
  commit();
}

/* ---------- macros ---------- */
// A macro moved: from its slider, a MIDI control or a device. Moving a colour or a shared control that is off turns
// it on. Like the master, it is saved but not a step of undo, and the devices hear it at once.
function setMacro(id, patch) {
  const d = macroDef(id), m = project.macros[id];
  if (!d || !m || !isObj(patch)) return;
  if (REMOTE_CLIENT) remoteOp({ op: 'macro', id, patch });   // the main computer has the last word, and tells every device
  const next = Object.assign({}, m, patch);
  if ('on' in m && !('on' in patch)) next.on = true;
  project.macros[id] = fixMacros({ [id]: next })[id];
  saveSoon(); remoteLiveChanged(); updateMacrosUI();
}
// Part i of a colour macro (hue, saturation, value; or red, green, blue) set to x, from 0 to 1
function setMacroPart(id, i, x) { const m = project.macros[id]; if (m && macroDef(id).kind === 'color') setMacro(id, macroPartPatch(m, i, clamp(x, 0, 1))); }
// Which macro a control of an effect follows (a macro's id, or '' for none), for that effect wherever it plays. What
// its name makes it follow is the default, and isn't kept.
function setMacroLink(src, name, id) {
  const rt = effectRt(src), o = Object.assign({}, project.macroLinks[src.id]);
  if (id === ((rt.roles && rt.roles[name]) || '')) delete o[name]; else o[name] = id;
  project.macroLinks = Object.assign({}, project.macroLinks, { [src.id]: o });
  if (!Object.keys(o).length) delete project.macroLinks[src.id];
  commit(); renderRight(); updateMidiUI();
}
function resetMacroLinks(src) {
  const all = Object.assign({}, project.macroLinks);
  delete all[src.id];
  project.macroLinks = all;
  commit(); renderRight(); updateMidiUI();
}

/* ---------- effects ---------- */
// One control of an effect, set in every layer that plays it now (a MIDI fader on it). A scene played afterwards
// brings its own value back.
function setEffectControl(src, name, v) {
  let n = 0;
  for (const z of project.zones) for (const L of z.layers) if (L.src === src.id) { setParam(L, src, name, v); n++; }
  if (!n) return;
  remoteChanged(); commitSoft(); syncContentSoon();
}

/* ---------- playlists ---------- */
// Play, pause, next… of a playlist, from any button, menu or key. On a device they go to the main computer, which
// plays the playlists.
function playlistDo(z, pl, what, i = 0) {
  if (REMOTE_CLIENT) { remoteOp({ op: 'playlist', zone: z.id, list: pl ? pl.id : null, do: what, i }); return; }
  if (what === 'toggle') togglePlaylist(z, pl.id);
  else if (what === 'start') startPlaylist(z, pl.id);
  else if (what === 'play') playPlaylist(z, pl.id, i);
  else if (what === 'pause') pausePlaylist(z);
  else if (what === 'resume') resumePlaylist(z);
  else if (what === 'next') stepPlaylist(z, 1);
  else if (what === 'prev') stepPlaylist(z, -1);
  else if (what === 'stop') stopPlaylist(z);
}
function nextPlaylistName(z) { let n = 1; while (z.playlists.some(p => p.name === 'Playlist ' + n)) n++; return 'Playlist ' + n; }
// A new playlist opens in the Scenes panel. One playlist per zone plays when the project opens.
function addPlaylist(z, props = {}) {
  const pl = newPlaylist(Object.assign({ name: nextPlaylistName(z) }, props));
  if (pl.autoplay) z.playlists.forEach(o => { o.autoplay = false; });
  z.playlists.push(pl);
  ui.playlistOpen[z.id] = pl.id;
  if (ui.zone !== z.id) { ui.zone = z.id; ui.layer = null; renderRight(); renderSrcList(); }
  commit();
  return pl;
}
function duplicatePlaylist(z, pl) {
  const c = Object.assign(JSON.parse(JSON.stringify(pl)), { id: uid(), name: nextCopyName(pl.name, new Set(z.playlists.map(p => p.name))), autoplay: false });
  c.steps.forEach(st => { st.id = uid(); });
  z.playlists.splice(z.playlists.indexOf(pl) + 1, 0, c);
  ui.playlistOpen[z.id] = c.id;
  commit();
  toast(`${pl.name} copied as ${c.name}.`);
}
function deletePlaylist(z, pl) {
  z.playlists = z.playlists.filter(p => p !== pl);
  for (const p of z.playlists) if (p.end === pl.id) p.end = 'stop';   // one that led to it stops at its end instead
  if (z._play && z._play.list === pl.id) stopPlaylist(z);
  if (ui.playlistOpen[z.id] === pl.id) delete ui.playlistOpen[z.id];
  commit();
  toast(`${pl.name} deleted. ${MOD}Z brings it back.`);
}
// One playlist per zone plays when the project opens: turning one on turns the others off
function setPlaylistAutoplay(z, pl, on, save = true) { if (on) z.playlists.forEach(o => { o.autoplay = false; }); pl.autoplay = !!on; if (save) commit(); }
// The id of the step playing, when pl is the zone's current playlist: it stays the one playing when steps move
const playingStepId = (z, pl) => { const p = z._play; return p && p.list === pl.id && pl.steps[p.i] ? pl.steps[p.i].id : null; };
function addToPlaylist(z, pl, sceneId, at = pl.steps.length, time = 30) {
  const keep = playingStepId(z, pl);
  pl.steps.splice(clamp(at, 0, pl.steps.length), 0, newStep(sceneId, time));
  playlistEdited(z, pl, keep);
  commit();
}
// A step dropped on another takes its place
function moveStep(z, pl, id, to) {
  const keep = playingStepId(z, pl), from = pl.steps.findIndex(st => st.id === id);
  if (from < 0 || from === to) return;
  const [st] = pl.steps.splice(from, 1);
  pl.steps.splice(clamp(to, 0, pl.steps.length), 0, st);
  playlistEdited(z, pl, keep);
  commit();
}
function removeStep(z, pl, st) {
  const keep = playingStepId(z, pl);
  pl.steps = pl.steps.filter(x => x !== st);
  playlistEdited(z, pl, keep === st.id ? null : keep);
  commit();
}
// A scene that leaves its zone (deleted, or moved to another zone) leaves the zone's playlists too
function dropSceneSteps(z, sceneId) {
  for (const pl of z.playlists) {
    const keep = playingStepId(z, pl), n = pl.steps.length;
    pl.steps = pl.steps.filter(st => st.scene !== sceneId);
    if (pl.steps.length !== n) playlistEdited(z, pl, keep);
  }
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
  storeMedia(src, file);
  if (isNew) loadSource(src.id);
  syncMedia(); ui.rightTab = 'content';
  commit(); renderSrcList(); renderRight();
  if (probe.kind === 'video') toast(`${src.name}: ${probe.w} × ${probe.h}, ${fmtDur(probe.duration)}`);
}
// A file added: copied into the media library (sources.js), so it opens again by itself
function storeMedia(src, file) {
  if (!libraryOk()) return;
  const big = file.size > 50e6;
  if (big) toast(`Copying ${file.name} into the media library, so it opens again by itself…`);
  libraryPut('/media?name=' + encodeURIComponent(file.name), file)
    .then(r => { src.media = r.name; delete src._mediaGone; commitSoft(); if (big) toast(`${file.name} is in the media library.`); })
    .catch(e => toast(`${file.name} couldn't go into the media library (${e.message}): relink it next time.`, 'warn'));
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
    toast(e && e.name === 'NotAllowedError' ? 'Screen capture was blocked or cancelled. It works when nouPix is opened from noupix.py in a desktop browser.' : 'Screen capture is not available in this browser.', 'warn');
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

// A stream from the network (NDI or OMT): a new source, or another stream for one already there
function setStreamSource(src, proto, name) {
  if (!src) {
    src = { id: uid(), kind: 'stream', proto, stream: name, name: name.replace(/^.*\((.*)\)$/, '$1') || name, hq: false, fit: 'stretch' };
    project.sources.push(src);
    loadSource(src.id);
  } else Object.assign(src, { proto, stream: name });
  syncStreams(); markThumb(src); ui.rightTab = 'content';
  commit(); renderSrcList(); renderRight();
  return src;
}
function setStreamQuality(src, hq) {
  if (!!src.hq === hq) return;
  src.hq = hq; syncStreams(); commit(); renderRight();
}

// The scene a zone plays when the project opens (one per zone; a playlist set to play on open goes first)
function setSceneOnOpen(z, sc, on) {
  for (const x of z.scenes) delete x.onOpen;
  if (on) sc.onOpen = true;
  commit();
  toast(on ? `${sc.name} plays when the project opens.` : `${z.name} plays no scene by itself when the project opens.`);
}

// Emptying the media library of all but this project's files (other projects that use them then ask to relink)
function cleanLibraryDialog() {
  const keep = [...new Set(project.sources.map(s => s.media).concat(project.timelines.flatMap(T => T.audios.map(A => A.media))).filter(Boolean))];
  const close = () => bg.remove();
  const go = async () => {
    close();
    try {
      const r = await (await fetch('/media/clean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keep }) })).json();
      toast(`Removed ${r.removed} file${r.removed === 1 ? '' : 's'} from the media library (${fmtBytes(r.freed)}).`); renderRight();
    } catch (e) { toast('Could not clean the media library: ' + e.message, 'err'); }
  };
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Clean the media library' },
      h('header', null, 'Clean the media library'),
      h('div', { class: 'mb' }, h('p', null, `This removes every image and video in the library that ${project.name} doesn't use. Other projects that use them will ask to relink them (or open from their package). Your original files aren't touched.`)),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn danger-t', type: 'button', onclick: go }, 'Remove'))));
  uiDocNow().body.append(bg);
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
// Copied fixtures go on the system clipboard as text, so they paste into another project, another nouPix
// window, or the desktop app; they are also kept here for "Paste here" when the clipboard can't be read.
let clip = store.get('noupix.clip', null);
const isClip = d => isObj(d) && (d.noupix === 'fixtures' || d.openledmapper === 'fixtures') && Array.isArray(d.fixtures);   // and copies from before the name
function clipOfSel() {
  const sel = selected();
  if (!sel.length) return null;
  const groups = selUnits(sel).filter(u => u.g).map(u => ({ id: u.g.id, name: u.g.name, tag: u.g.tag, ...(u.g.rot ? { rot: u.g.rot } : {}) }));
  const whole = new Set(groups.map(g => g.id));
  const fixtures = sel.map(f => { const c = JSON.parse(JSON.stringify(snapshotGeom(f))); if (!whole.has(c.group)) delete c.group; delete c.addr; return c; });
  return { noupix: 'fixtures', version: 1, fixtures, groups };
}
function copySel(e) {
  const d = clipOfSel();
  if (!d) return false;
  clip = d; store.set('noupix.clip', d);
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
    { id: uid(), name: typeof g.name === 'string' && g.name ? (gnames.has(g.name) ? nextCopyName(g.name, gnames) : g.name) : nextGroupName(), tag: isTag(g.tag) ? g.tag : '', open: true,
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
