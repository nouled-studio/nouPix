// nouPix · js/ui-menus.js
// Menus: the menu system, every right-click menu, the highlight menu, the SVG import dialog, and the
// copy, cut and paste keys.

/* ---------- highlight menu ---------- */
function highlightMenu(anchor) {
  const on = ui.outputMode !== 'content';
  menu(anchor, [
    { head: 'Highlight' },
    ...HL_MODES.map(([id, name, what]) => [(on && ui.hlMode === id ? '✓ ' : '') + name, () => setHighlight(true, id), { key: what }]),
    on && '-',
    on && ['Off: back to the content', () => setHighlight(false), { key: 'I' }],
  ]);
}

/* ---------- choosing an NDI or OMT stream ---------- */
// The sources the bridge finds on the network, asked for again every second and a half while the window is open.
// For a new source (src null) or another stream for one already there.
function streamPicker(src) {
  let timer = 0;
  const list = h('div', { class: 'vlist', role: 'listbox', 'aria-label': 'Streams' });
  const close = () => { clearInterval(timer); streams.onFound = null; bg.remove(); };
  const pick = s => { close(); setStreamSource(src, s.proto, s.name); };
  const draw = () => {
    const info = streams.info || {}, got = streams.found, ready = Object.keys(STREAM_PROTOS).filter(p => info[p] && info[p].ok);
    let empty = null;
    if (!bridge.connected) empty = 'nouPix isn’t connected to its bridge (noupix.py), which receives the streams.';
    else if (!streams.info) empty = 'Looking…';
    else if (!got.length) empty = ready.length ? `Looking… No ${ready.map(p => STREAM_PROTOS[p]).join(' or ')} source found on the network yet. Sources from other computers can take a few seconds to appear.` : null;
    // what isn't installed, and how to get it
    const missing = Object.keys(STREAM_PROTOS).filter(p => info[p] && !info[p].ok).map(p => h('p', { class: 'note' }, info[p].note));
    list.replaceChildren(...(empty ? [h('p', { class: 'note' }, empty)] : []), ...got.map(s => h('button', {
      class: 'vrow' + (src && src.stream === s.name ? ' on' : ''), type: 'button', role: 'option', onclick: () => pick(s) },
      h('span', { class: 'ic' }, icon('stream')), h('span', { class: 'nm' }, s.name), h('span', { class: 'meta' }, STREAM_PROTOS[s.proto]))), ...missing);
  };
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal vmodal', role: 'dialog', 'aria-label': 'Stream' },
      h('header', null, src ? 'Stream for ' + src.name : 'Add an NDI or OMT stream'),
      h('div', { class: 'mb' }, list,
        h('p', { class: 'note' }, 'Any program that sends NDI or OMT shows here: Resolume, TouchDesigner, OBS, vMix, NDI Tools’ Screen Capture…')),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'))));
  streams.onFound = draw;
  draw(); findStreams();
  timer = setInterval(() => { if (!bg.isConnected) close(); else findStreams(); }, 1500);
  uiDocNow().body.append(bg);
}

/* ---------- exporting a package ---------- */
// What goes in it, and how much it weighs, before it is written; media not in the library are named (relink them)
async function packageDialog() {
  if (!libraryOk()) { toast('Packages are made by nouPix started from noupix.py or the app, which keep the media.', 'warn'); return; }
  const list = packageMedia(), names = [...new Set(list.map(s => s.media).filter(Boolean))];
  let sizes = {};
  try { sizes = (await (await fetch('/media-info?names=' + encodeURIComponent(names.join(',')))).json()).sizes || {}; } catch (e) { /* bridge gone: all missing */ }
  const proj = new Blob([projectText()]).size, seen = new Set();
  let total = proj;
  const rows = list.map(s => {
    const n = sizes[s.media];
    if (n != null && !seen.has(s.media)) { seen.add(s.media); total += n; }
    return h('div', { class: 'pkrow' + (n == null ? ' miss' : '') }, h('span', { class: 'ic' }, icon(s.kind)), h('span', { class: 'nm' }, s.name),
      h('span', { class: 'meta' }, n == null ? 'not in the library' : fmtBytes(n)));
  });
  const missing = list.filter(s => sizes[s.media] == null);
  const fname = fileName().replace(/\.noupix$/, '.noupixpkg');
  const close = () => bg.remove();
  const go = async () => { btn.disabled = true; try { if (await exportPackage(fname)) close(); else btn.disabled = false; } catch (e) { toast('Could not export: ' + e.message, 'err'); btn.disabled = false; } };
  const btn = h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Export');
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal pkmodal', role: 'dialog', 'aria-label': 'Export package' },
      h('header', null, 'Export package'),
      h('div', { class: 'mb' },
        h('p', null, 'One file with the project and its images and videos, to open on another computer: ' + fname),
        h('div', { class: 'pklist' }, h('div', { class: 'pkrow' }, h('span', { class: 'ic' }, icon('isf')), h('span', { class: 'nm' }, 'The project, with its shaders'), h('span', { class: 'meta' }, fmtBytes(proj))), ...rows),
        h('div', { class: 'pkrow total' }, h('span'), h('span', { class: 'nm' }, 'Total'), h('span', { class: 'meta', 'data-total': '' }, fmtBytes(total))),
        missing.length ? h('p', { class: 'note warn' }, `${missing.map(s => s.name).join(', ')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} in the media library, so ${missing.length === 1 ? 'it doesn’t' : 'they don’t'} go in the package: relink ${missing.length === 1 ? 'it' : 'them'} first (right-click → Relink file…).`) : null),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), btn)));
  uiDocNow().body.append(bg);
}

/* ---------- SVG import dialog ---------- */
function importSvgDialog(file) {
  const opt = { fixtures: true, guide: true, pitch: 10 };
  const close = () => bg.remove();
  const go = async () => { close(); await importSvg(file, opt); };
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Import SVG' },
      h('header', null, 'Import ' + file.name),
      h('div', { class: 'mb' },
        h('p', { class: 'note' }, 'The drawing is fitted into the composition. Every circle, arc, line and path becomes a fixture; circles keep the start point and direction they were drawn with.'),
        checkRow('Create fixtures from the shapes', opt, 'fixtures'),
        checkRow('Also use the SVG as the guide image', opt, 'guide'),
        numRow('Pixel pitch', opt, 'pitch', { min: 0.5, max: 500, step: 0.5 }),
        h('p', { class: 'note' }, 'Pitch is the spacing between LEDs in composition units; it sets each fixture\'s starting pixel count. You can set exact counts afterwards (select several fixtures to set them all at once).')),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Import'))));
  document.body.append(bg);
}

/* ---------- menus ---------- */
// A menu under an element (a button), or at a point (a right-click: { x, y } in window pixels).
// Items: [label, action, { key, danger, disabled }], [label, null, { sub: items }] for a submenu, '-' for a line,
// { head: text } for a title; false is left out.
function menu(anchor, items) {
  // in the window it was opened from (this page, or the Scenes window)
  const D = isEl(anchor) ? anchor.ownerDocument : uiDocNow(), W = D.defaultView, innerWidth = W.innerWidth, innerHeight = W.innerHeight;
  for (const d of new Set([document, D])) $$('.menu', d).forEach(m => m.remove());
  const open = [];   // the menu and the submenus open from it, outermost first
  const close = () => { open.splice(0).forEach(m => m.remove()); D.removeEventListener('pointerdown', off, true); W.removeEventListener('keydown', esc, true); W.removeEventListener('blur', close); W.removeEventListener('resize', close); };
  const off = e => { if (!open.some(m => m.contains(e.target))) close(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const show = (items, level, from) => {
    open.splice(level).forEach(m => m.remove());
    const list = items.filter(Boolean).filter((it, i, a) => it !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-' && !a[i - 1].head));
    const m = h('div', { class: 'menu', role: 'menu' }, list.map(it => {
      if (it === '-') return h('hr');
      if (it.head) return h('div', { class: 'mh' }, it.head);
      const o = it[2] || {};
      const b = h('button', { type: 'button', role: 'menuitem', class: o.danger ? 'danger' : '', disabled: !!o.disabled, title: o.title, 'aria-haspopup': o.sub ? 'menu' : null },
        it[0], o.sub ? h('span', { class: 'sm' }, '▸') : o.key ? h('span', { class: 'mk' }, o.key) : null);
      const openSub = () => { $$('button.open', m).forEach(x => x.classList.remove('open')); b.classList.add('open'); show(o.sub, level + 1, b); };
      b.addEventListener('pointerenter', () => { if (o.sub) openSub(); else if (open.length > level + 1) { $$('button.open', m).forEach(x => x.classList.remove('open')); open.splice(level + 1).forEach(x => x.remove()); } });
      b.addEventListener('click', () => { if (o.sub) openSub(); else { close(); it[1](); } });
      return b;
    }));
    D.body.append(m);
    open.push(m);
    const w = m.offsetWidth, ht = m.offsetHeight;
    if (level > 0) {   // beside the item it opens from
      const r = from.getBoundingClientRect();
      m.style.left = (r.right + w - 2 > innerWidth - 8 ? Math.max(8, r.left - w + 2) : r.right - 2) + 'px';
      m.style.top = Math.max(8, Math.min(r.top - 5, innerHeight - ht - 8)) + 'px';
    } else if (!isEl(from)) {
      m.style.left = Math.max(8, Math.min(from.x, innerWidth - w - 8)) + 'px';
      m.style.top = Math.max(8, from.y + ht > innerHeight - 8 ? from.y - ht : from.y) + 'px';
    } else {
      const r = from.getBoundingClientRect();
      m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
      m.style.top = (r.bottom + 4 + ht > innerHeight - 8 ? Math.max(8, r.top - ht - 4) : r.bottom + 4) + 'px';
    }
  };
  show(items, 0, anchor);
  // At once, as the colour picker: what opened it (a click, a right-click, a key) is past its pointerdown and keydown
  D.addEventListener('pointerdown', off, true); W.addEventListener('keydown', esc, true); W.addEventListener('blur', close); W.addEventListener('resize', close);
}
// Right-click on el opens the menu fn(e) builds
function onRightClick(el, fn) {
  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); fn(e); });
}
const withRightClick = (el, fn) => { onRightClick(el, fn); return el; };
// Elsewhere, no browser menu (Back, Reload, Inspect…); text fields keep theirs for copy and paste
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, select, [contenteditable="true"]')) e.preventDefault(); });
const at = e => ({ x: e.clientX, y: e.clientY });

/* ---------- right-click menus ---------- */
function fixtureMenu(e, f, pick) {
  if (mappingLocked()) return;   // the operator's mapping is locked
  if (!ui.sel.has(f.id)) { ui.sel = new Set(pick); onSelection(); }
  const sel = selected(), one = sel.length === 1 ? sel[0] : null, ga = groupAction(sel);
  const allOn = sel.every(x => x.enabled), allLocked = sel.every(x => x.locked);
  const patched = sel.filter(x => x._patch), lines = sel.filter(x => x.type !== 'matrix'), g = wholeGroup(sel);
  menu(at(e), [
    { head: one ? one.name : g ? `${groupName(g)} · ${sel.length} fixtures` : `${sel.length} fixtures` },
    one && ['Rename…', () => focusName('fxName'), { key: 'double-click' }],
    g && ['Rename group…', () => focusName('grpName')],
    ['Copy', copySel, { key: MOD + 'C' }],
    ['Cut', () => { copySel(); deleteSel(); }, { key: MOD + 'X', disabled: allLocked }],
    ['Duplicate', duplicateSel, { key: MOD + 'D' }],
    ga === 'group' && ['Group', groupSel, { key: MOD + 'G' }],
    ga === 'ungroup' && ['Ungroup', ungroupSel, { key: MOD + '⇧G' }],
    '-',
    [allOn ? 'Disable' : 'Enable', () => { sel.forEach(x => { x.enabled = !allOn; }); commit(); renderRight(); }],
    [allLocked ? 'Unlock' : 'Lock', toggleLockSel, { key: MOD + 'L' }],
    lines.length && ['Reverse direction', () => { lines.forEach(x => { x.reverse = !x.reverse; }); markGeom(); commit(); renderRight(); }],
    [ui.outputMode !== 'content' ? 'Stop highlight' : 'Highlight', toggleIdentify, { key: 'I' }],
    '-',
    ['Bring to front', () => restackSel(true)],
    ['Send to back', () => restackSel(false)],
    [one ? 'New zone around it' : 'New zone around them', () => addZone(fixtureRect(sel, 6))],
    '-',
    ['Patch to', null, { sub: patchToItems(sel) }],
    patched.length && ['Show in Patch', () => showInPatch(patched[0])],
    patched.length && ['Earlier on its output', () => moveOnOutput(patched.map(x => x.id), -1), { key: 'Alt ↑' }],
    patched.length && ['Later on its output', () => moveOnOutput(patched.map(x => x.id), 1), { key: 'Alt ↓' }],
    patched.length && [patched.length === 1 ? 'Unpatch' : `Unpatch ${patched.length} fixtures`, () => { patched.forEach(x => unassign(x.id)); markPatch(); commit(); renderRight(); }],
    '-',
    ['Delete', deleteSel, { key: 'Del', danger: true, disabled: allLocked }],
  ]);
}
function groupMenu(e, g, m) {
  if (mappingLocked()) return;   // the operator's mapping is locked
  const ids = m.map(f => f.id);
  if (!ids.every(id => ui.sel.has(id)) || ui.sel.size !== ids.length) { ui.sel = new Set(ids); onSelection(); }
  menu(at(e), [
    { head: `${groupName(g)} · ${m.length} fixtures` },
    ['Rename…', () => focusName('grpName'), { key: 'double-click' }],
    ['Copy', copySel, { key: MOD + 'C' }],
    ['Duplicate group', duplicateSel, { key: MOD + 'D' }],
    ['Ungroup', ungroupSel, { key: MOD + '⇧G' }],
    [g.open ? 'Fold' : 'Unfold', () => { g.open = !g.open; renderFxList(); saveSoon(); }],
    [m.every(f => f.locked) ? 'Unlock group' : 'Lock group', toggleLockSel, { key: MOD + 'L' }],
    '-',
    ['Bring to front', () => restackSel(true)],
    ['Send to back', () => restackSel(false)],
    ['New zone around it', () => addZone(fixtureRect(m, 6))],
    ['Patch to', null, { sub: patchToItems(m) }],
    '-',
    ['Delete group and its fixtures', deleteSel, { key: 'Del', danger: true, disabled: m.every(f => f.locked) }],
  ]);
}

/* ---------- copy and paste keys ---------- */
document.addEventListener('copy', e => { if (typingIn(e.target) || $('.modal-bg') || !ui.sel.size) return; if (copySel(e)) e.preventDefault(); });
document.addEventListener('cut', e => { if (typingIn(e.target) || $('.modal-bg') || !ui.sel.size || mappingLocked()) return; if (copySel(e)) { e.preventDefault(); deleteSel(); } });
document.addEventListener('paste', e => {
  if (mappingLocked()) return;
  if (typingIn(e.target) || $('.modal-bg')) return;
  let d = null;
  try { d = JSON.parse(e.clipboardData.getData('text/plain')); } catch (err) { /* not fixtures */ }
  if (!isClip(d)) return;
  e.preventDefault();
  pasteFixtures(d, null);
});

/* ---------- patch to, and the other menus ---------- */
// The outputs of every controller, to put the fixtures on, after what is there already, in list order
function patchToItems(list) {
  if (!project.controllers.length) return [['No controllers yet: add one…', () => { ui.dockTab = 'patch'; ui.dockCollapsed = false; renderDock(); }]];
  if (geomDirty) rebuildGeometry();
  ensurePatch();
  const ids = list.map(f => f.id);
  const outs = c => c.chains.map((chain, o) => {
    const base = c.startUniverse + o * c.upo;
    const here = ids.every(id => chain.includes(id));
    const rest = chain.filter(id => !ids.includes(id));
    const fits = simulateChannels(c, rest.concat(ids)) <= c.upo * 512;
    const used = rest.reduce((a, id) => a + (fxById(id) ? pixelCount(fxById(id)) : 0), 0);
    return [`${here ? '✓ ' : ''}OUT ${o + 1}  ·  U ${base}${c.upo > 1 ? '–' + (base + c.upo - 1) : ''}`, () => patchTo(ids, c, o),
      { key: fits ? (used ? `${fmtN(used)} px on it` : 'empty') : "won't fit" }];
  });
  if (project.controllers.length === 1) { const c = project.controllers[0]; return [{ head: `${c.name} · ${c.ip}` }, ...outs(c)]; }
  return project.controllers.map(c => [`${ctrlLetter(c)} · ${c.name}`, null, { sub: [{ head: c.ip }, ...outs(c)] }]);
}
function patchTo(ids, c, o) {
  for (const id of ids) assign(id, c, o, -1);
  commit(); renderRight();
  ensurePatch();
  const over = ids.filter(id => { const f = fxById(id); return f && f._patch && f._patch.overflow; }).length;
  toast(`${ids.length === 1 ? fxById(ids[0]).name : ids.length + ' fixtures'} on ${c.name} OUT ${o + 1}` + (over ? `. ${over === 1 ? 'It does' : over + ' do'} not fully fit: add universes per output.` : ''), over ? 'warn' : '');
}
function showInPatch(f) {
  ui.dockTab = 'patch'; ui.dockCollapsed = false; ui.selCtrl = f._patch.ctrl.id;
  if (ui.foldOuts) ui.foldOuts.delete(f._patch.ctrl.id + ':' + f._patch.out);
  renderDock(); revealInPatch();
}
function canvasMenu(e, x, y) {
  if (mappingLocked()) return;   // the operator's mapping is locked
  const W = project.settings.compW, H = project.settings.compH;
  const px = clamp(Math.round(snapV(x)), 0, W), py = clamp(Math.round(snapV(y)), 0, H);
  const add = type => () => {
    const f = defaultFixtureAt(type, px, py);
    f.name = nextName(type);
    addFixture(f);
  };
  const z = hitZone(x, y);
  menu(at(e), [
    ['Paste here', () => pasteFromClipboard([px, py]), { key: MOD + 'V' }],
    '-',
    ['Add a strip here', add('line')],
    ['Add a matrix here', add('matrix')],
    ['Add a ring here', add('circle')],
    ['Draw a path', () => setTool('path'), { key: 'P' }],
    ['Draw with the pen', () => setTool('pen'), { key: 'N' }],
    '-',
    ['Select all', () => { ui.sel = new Set(project.fixtures.filter(f => !f.locked).map(f => f.id)); onSelection(); }, { key: MOD + 'A' }],
    ['Fit to view', fitView, { key: 'F' }],
    '-',
    z && [`Zone: ${z.name}…`, () => zoneMenu(e, z)],
    ['Import SVG…', () => $('#fileSvg').click()],
  ]);
}
function zoneMenu(e, z) {
  if (mappingLocked()) return;   // the operator's mapping is locked
  if (ui.zone !== z.id) selectZone(z);
  const i = project.zones.indexOf(z), last = project.zones.length - 1, hidden = z.opacity === 0;
  menu(at(e), [
    { head: z.name },
    ['Edit layers', () => { ui.rightTab = 'content'; showRight(true); renderRight(); }],
    ['Rename, color, area…', () => renameZone(z)],
    ['Store a scene', () => storeScene(z)],
    ['Playlists', null, { sub: [
      ...z.playlists.map(pl => { const p = z._play, cur = playingList(z) === pl; return [(cur && p.on ? '▶ ' : cur && !p.ended ? '❚❚ ' : '') + pl.name, () => playlistDo(z, pl, 'start'), { key: fmtClock(playlistLength(pl)), title: 'Play it' }]; }),
      z.playlists.length && '-',
      ['New playlist…', () => newPlaylistDialog(z)],
    ] }],
    '-',
    [hidden ? 'Show (opacity 100%)' : 'Hide (opacity 0)', () => { setZoneOpacity(z, hidden ? 1 : 0); commit(); }, { disabled: xfDriven(z), title: xfDriven(z) ? 'The X-Fader sets its level' : null }],
    ['Fit to selected fixtures', () => fitZone(z), { disabled: !ui.sel.size }],
    ['Cover the whole canvas', () => { Object.assign(z, { x: 0, y: 0, w: project.settings.compW, h: project.settings.compH }); commit(); renderRight(); }],
    '-',
    ['Move up', () => moveZone(z, 1), { disabled: i === last }],
    ['Move down', () => moveZone(z, -1), { disabled: i === 0 }],
    ['Duplicate', () => duplicateZone(z)],
    '-',
    ['Delete zone', () => deleteZone(z), { danger: true }],
  ]);
}
function renameZone(z) {
  ui.zone = z.id;
  if (ui.tool !== 'zone') setTool('zone');
  focusName('zoneName');
}
function layerMenu(e, z, L) {
  if (ui.layer !== L.id) { ui.layer = L.id; renderRight(); renderSrcList(); }
  const i = z.layers.indexOf(L), src = srcById(L.src);
  menu(at(e), [
    { head: `Layer ${i + 1} · ${src ? src.name : 'Empty'}` },
    [L.on ? 'Hide' : 'Show', () => { L.on = !L.on; syncMedia(); commit(); renderRight(); renderSrcList(); }],
    src && ['Clear its source', () => { L.src = null; syncMedia(); commit(); renderRight(); renderSrcList(); }],
    ['Add a layer above', () => addLayer(z)],
    ['Duplicate', () => duplicateLayer(z, L)],
    '-',
    ['Move up', () => moveLayer(z, L, 1), { disabled: i === z.layers.length - 1 }],
    ['Move down', () => moveLayer(z, L, -1), { disabled: i === 0 }],
    '-',
    ['Delete layer', () => removeLayer(z, L), { danger: true }],
  ]);
}
function sourceMenu(e, s, play) {
  const z = selZone(), L = selLayer(), n = z && L ? z.layers.indexOf(L) + 1 : 1;
  const media = s.kind === 'image' || s.kind === 'video';
  menu(at(e), [
    { head: s.name },
    ['Play in ' + (z ? `${z.name} layer ${n}` : 'a new layer'), play],
    z && ['Play in a new layer', () => { addLayer(z); play(); }],
    media && ['Relink file…', () => pickMedia(s)],
    isStream(s) && !REMOTE_CLIENT && ['Choose stream…', () => streamPicker(s)],
    !s.builtin && '-',
    !s.builtin && ['Remove source', () => removeSource(s), { danger: true }],
  ]);
}
function controllerMenu(e, c) {
  if (mappingLocked()) return;   // the operator's mapping is locked
  if (ui.selCtrl !== c.id) { ui.selCtrl = c.id; renderDock(); }
  const n = c.chains.flat().length;
  menu(at(e), [
    { head: `${ctrlLetter(c)} · ${c.name} · ${c.ip}` },
    ['Auto-patch onto it', autoPatch],
    [c.enabled ? 'Turn its output off' : 'Turn its output on', () => { c.enabled = !c.enabled; markPatch(); commit(); }],
    ['Unpatch all its fixtures', () => { c.chains = c.chains.map(() => []); markPatch(); commit(); renderRight(); toast(`${n} fixtures unpatched from ${c.name}. ${MOD}Z brings them back.`); }, { disabled: !n }],
    '-',
    ['Delete controller', () => deleteController(c), { danger: true }],
  ]);
}
function chipMenu(e, fid, c, o) {
  if (mappingLocked()) return;   // the operator's mapping is locked
  const fx = fxById(fid), chain = c.chains[o], k = chain.indexOf(fid);
  menu(at(e), [
    { head: `${fx.name} · OUT ${o + 1} · #${k + 1} of ${chain.length}` },
    ['Select it', () => { ui.sel = new Set([fid]); onSelection(); }],
    ['Move earlier', () => moveOnOutput([fid], -1), { key: 'Alt ↑', disabled: k === 0 }],
    ['Move later', () => moveOnOutput([fid], 1), { key: 'Alt ↓', disabled: k === chain.length - 1 }],
    ['Move to the start of the output', () => moveToOutputEdge([fid], false), { disabled: k === 0 }],
    ['Move to the end of the output', () => moveToOutputEdge([fid], true), { disabled: k === chain.length - 1 }],
    '-',
    ['Unpatch', () => { unassign(fid); markPatch(); commit(); renderRight(); }, { danger: true }],
  ]);
}
function nodeMenu(e, n) {
  if (mappingLocked()) return;   // the operator's mapping is locked
  menu(at(e), [
    { head: n.shortName || n.ip },
    [project.controllers.some(c => c.ip === n.ip) ? 'Refresh reported universes' : 'Add as controller', () => addNodeAsController(n), { disabled: !n.universes.length }],
    ['Copy IP address', () => { navigator.clipboard.writeText(n.ip).then(() => toast('Copied ' + n.ip), () => toast(n.ip)); }],
  ]);
}
function projectMenu(anchor) {
  const m = !mappingLocked();   // an operator can save a copy, not replace the project or its mapping
  menu(anchor, [
    m && ['New empty project', () => { loadProject(blankProject('Untitled')); projectFile = null; toast('New project'); }],
    m && ['Load demo layout', () => { loadProject(demoProject()); projectFile = null; toast('Demo layout loaded'); }],
    '-',
    m && ['Open project…', openProjectDialog],
    ['Save', () => saveProjectFile(), { key: MOD + 'S' }],
    ['Save as…', () => saveProjectFile(true), { key: MOD + '⇧S' }],
    window.showSaveFilePicker && !REMOTE_CLIENT && [ui.autosave ? 'Autosave: on' : 'Autosave: off', () => setAutosave(!ui.autosave), { title: 'Every change goes to the project file a moment later' }],
    !REMOTE_CLIENT && ['Export package…', packageDialog, { title: 'The project and its images and videos in one file, to take it to another computer' }],
    ['Export patch list (CSV)', exportCSV],
    '-',
    m && ['Import SVG…', () => $('#fileSvg').click()],
    m && ['Load guide image…', () => $('#fileGuide').click()],
  ]);
}
function addFixtureMenu(anchor) {
  const mk = type => () => {
    const W = project.settings.compW, H = project.settings.compH;
    const [cx, cy] = VW ? toC(VW / 2, VH / 2) : [W / 2, H / 2];
    const x = clamp(Math.round(cx), 0, W), y = clamp(Math.round(cy), 0, H);
    const f = defaultFixtureAt(type, x, y);
    f.name = nextName(type);
    addFixture(f);
  };
  menu(anchor, [['Line / strip', mk('line')], ['Matrix', mk('matrix')], ['Circle / ring', mk('circle')], ['Path (draw on stage)', () => setTool('path')], '-', ['Import from SVG…', () => $('#fileSvg').click()]]);
}
function addSourceMenu(anchor) {
  // files and screens play on the main computer: a device can't hand it a file of its own
  const here = REMOTE_CLIENT ? { disabled: true, title: 'Add videos, images, screen capture and streams on the main computer.' } : null;
  menu(anchor, [['ISF shader file (.fs)…', () => $('#fileIsf').click()], ['Image or video file…', () => pickMedia(null), here || { title: MEDIA_FORMATS }], ['Screen / window capture', addScreenSource, here],
    ['NDI or OMT stream…', () => streamPicker(null), here || { title: 'Video from another program or computer on the network, sent with NDI or OMT' }]]);
}
