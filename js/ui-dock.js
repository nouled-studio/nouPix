// openLedMapper · js/ui-dock.js
// The bottom dock: scenes, the patch table and controller editor, Art-Net nodes, and the DMX monitor.

/* ---------- bottom dock ---------- */
function renderDock() {
  $$('#dockTabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.dockTab));
  const dock = $('#dock');
  dock.classList.toggle('collapsed', ui.dockCollapsed);
  dock.style.setProperty('--bottom-h', ui.dockH + 'px');
  $('#btnDock').textContent = ui.dockCollapsed ? '▴' : '▾';
  $('#btnDock').title = ui.dockCollapsed ? 'Expand panel' : 'Collapse panel';
  const body = $('#dockBody');
  const keep = body.firstElementChild && body.querySelector('.ctrl-edit') ? body.querySelector('.ctrl-edit').scrollTop : 0;
  body.replaceChildren();
  if (ui.dockCollapsed) return;
  if (ui.dockTab === 'scenes') renderScenes(body);
  else if (ui.dockTab === 'patch') {
    renderPatch(body);
    if (mappingLocked()) { const ce = body.querySelector('.ctrl-edit'); if (ce) lockPanel(ce, 'Operator: you can see the patch but not change it.'); body.querySelectorAll('.ctrl-list .foot button').forEach(b => { b.disabled = true; }); }
  }
  else if (ui.dockTab === 'nodes') renderNodes(body);
  else renderMonitor(body);
  replayFlip();
  const ce = body.querySelector('.ctrl-edit'); if (ce) ce.scrollTop = keep;
}
function onPatchChanged() { schedulePanels(); }
let panelsQueued = false;
function schedulePanels() {
  if (panelsQueued) return;
  panelsQueued = true;
  requestAnimationFrame(() => {
    panelsQueued = false;
    renderFxList();
    if (ui.dockTab !== 'nodes' && !document.activeElement.closest?.('#dockBody')) renderDock();
    syncInspector();
  });
}

/* ---------- scenes ---------- */
// While a slider or a fade is dragged, something is dragged and dropped, or a field is typed in, in the Scenes panel,
// a redraw from elsewhere (a playlist moving on, another device) waits until it is over
let scenesHeld = false, scenesDragging = false, scenesPending = false;
const scenesBusy = () => scenesHeld || scenesDragging || !!(typingIn(document.activeElement) && document.activeElement.closest('#dockBody'));
function refreshScenes() {
  if (ui.dockTab !== 'scenes' || ui.dockCollapsed) return;
  if (scenesBusy()) { scenesPending = true; return; }
  scenesPending = false;
  renderDock();
}
const scenesLetGo = () => { if (scenesPending) setTimeout(() => { if (scenesPending && !scenesBusy()) refreshScenes(); }); };
document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('#dockBody input[type=range], #dockBody .fd')) scenesHeld = true; }, true);
document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('#dockBody')) scenesDragging = true; }, true);
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { if (scenesHeld) { scenesHeld = false; scenesLetGo(); } }, true);
for (const t of ['dragend', 'drop']) document.addEventListener(t, () => { if (scenesDragging) { scenesDragging = false; scenesLetGo(); } }, true);
document.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('#dockBody')) scenesLetGo(); }, true);
function sceneMenu(anchor, z, sc) {
  const n = pl => pl.steps.filter(st => st.scene === sc.id).length;
  menu(anchor, [
    !(anchor instanceof Element) && { head: `${sc.name} · ${z.name}` },
    !(anchor instanceof Element) && ['Go to it' + (sc.fade > 0 ? ` (fade ${fmtV(sc.fade)} s)` : ''), () => goScene(z, sc)],
    !(anchor instanceof Element) && sc.fade > 0 && ['Cut to it', () => goScene(z, sc, true), { key: '⇧click' }],
    !(anchor instanceof Element) && '-',
    ['Add to playlist', null, { sub: [
      ...z.playlists.map(pl => [pl.name, () => { addToPlaylist(z, pl, sc.id); ui.playlistOpen[z.id] = pl.id; renderDock(); toast(`${sc.name} added to ${pl.name}.`); }, { key: n(pl) ? `in it ×${n(pl)}` : '' }]),
      z.playlists.length && '-',
      ['New playlist with it…', () => newPlaylistDialog(z, sc.id)],
    ] }],
    [`Update with ${z.name}'s current layers`, () => { sc.layers = snapshotLayers(z); z.scene = sc.id; commit(); toast(`${sc.name} updated`); }],
    ['Rename, fade time, color…', () => editScene(sc)],
    ['Duplicate', () => { const c = Object.assign(JSON.parse(JSON.stringify(sc)), { id: uid(), name: nextCopyName(sc.name, new Set(z.scenes.map(x => x.name))) }); z.scenes.splice(z.scenes.indexOf(sc) + 1, 0, c); commit(); }],
    '-',
    ['Delete', () => { z.scenes = z.scenes.filter(x => x !== sc); if (z.scene === sc.id) z.scene = null; dropSceneSteps(z, sc.id); commit(); toast(`${sc.name} deleted. Ctrl Z brings it back.`); }, { danger: true }],
  ]);
}
function editScene(sc) {
  const tmp = { name: sc.name, fade: sc.fade, tag: sc.tag };
  const close = () => bg.remove();
  const save = () => { sc.name = tmp.name.trim() || sc.name; sc.fade = tmp.fade; sc.tag = tmp.tag; close(); commit(); };
  const sw = h('div', { class: 'swatches' });
  for (const c of TAGS) {
    const b = h('button', { type: 'button', class: tmp.tag === c ? 'on' : '', style: { background: c }, 'aria-label': 'Color ' + c, onclick: () => { tmp.tag = c; $$('button', sw).forEach(x => x.classList.toggle('on', x === b)); } });
    sw.append(b);
  }
  const nameIn = textInput(tmp, 'name', { aria: 'Scene name' });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Edit scene' },
      h('header', null, 'Scene'),
      h('div', { class: 'mb' },
        row('Name', nameIn),
        numRow('Fade (s)', tmp, 'fade', { min: 0, max: 60, step: 0.1 }),
        row('Color', sw),
        h('p', { class: 'note' }, 'The fade is how long the zone takes to change to this scene when you click it. 0 cuts straight to it. It can also be changed on the scene\'s button: drag its fade time sideways, or click it to type one.')),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'))));
  document.body.append(bg);
  nameIn.focus(); nameIn.select();
}
// A fade time on a button (a scene's, a playlist step's): drag it sideways to change it (Shift = ×10), click it to type
// one, or use the arrow keys. 0 cuts. It works the same while that scene plays, so a fade can be tried and changed at
// once. o: get() and set(v) the value; text() and tip() what it shows; clear(), if typing nothing goes back to automatic.
function fadeControl(tile, o) {
  const label = () => o.text ? o.text() : (o.get() > 0 ? '◢ ' + fmtV(Math.round(o.get() * 10) / 10) + ' s' : 'cut');
  const tip = () => (o.tip ? o.tip() : `Fade in: ${o.get() > 0 ? fmtV(o.get()) + ' s' : 'none, it cuts'}`) + '. Drag sideways to change it (Shift = ×10), click to type, or ↑ ↓.';
  const el = h('span', { class: 'fd' + (o.get() > 0 ? '' : ' cut') + (o.cls ? ' ' + o.cls() : ''), role: 'button', tabindex: 0, title: tip(), 'aria-label': o.name + ' fade time' }, label());
  const show = () => { el.textContent = label(); el.className = 'fd' + (o.get() > 0 ? '' : ' cut') + (o.cls ? ' ' + o.cls() : '') + (el.classList.contains('scrub') ? ' scrub' : ''); el.title = tip(); };
  const set = v => { o.set(clamp(Math.round(v * 10) / 10, 0, 60)); show(); };
  const type = () => {
    let done = false;
    const inp = h('input', { type: 'text', class: 'fdin', value: o.clear && o.auto && o.auto() ? '' : fmtV(o.get()), placeholder: o.clear ? 'auto' : '', 'aria-label': o.name + ' fade time',
      title: 'Seconds; 0 cuts' + (o.clear ? '; empty: automatic' : '') });
    const finish = ok => {
      if (done) return; done = true;
      const txt = inp.value.trim().replace(',', '.'), v = parseFloat(txt);
      if (ok && txt === '' && o.clear) { o.clear(); commit(); }
      else if (ok && isFinite(v) && (clamp(v, 0, 60) !== o.get() || (o.auto && o.auto()))) { set(v); commit(); }
      else renderDock();
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('pointerdown', e => e.stopPropagation());
    el.replaceWith(inp);
    inp.focus(); inp.select();
  };
  el.addEventListener('click', e => e.stopPropagation());
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    tile.draggable = false;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = o.get(), a0 = !!(o.auto && o.auto());
    let moved = false;
    const mv = ev => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true; el.classList.add('scrub');
      set(v0 + (ev.clientX - x0) * 0.05 * (ev.shiftKey ? 10 : 1));
    };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      tile.draggable = true; el.classList.remove('scrub');
      if (!moved) type(); else if (o.get() !== v0 || a0 !== !!(o.auto && o.auto())) commit(); else renderDock();
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); type(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); set(o.get() + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1)); commitSoft(); }
  });
  return el;
}
function sceneTile(z, sc, i, keys, look) {
  const live = z.scene === sc.id;
  const edited = live && lookOf(sc.layers) !== look;
  const inLists = z.playlists.filter(pl => pl.steps.some(st => st.scene === sc.id)).length;
  const tile = h('div', { class: 'scene' + (live ? ' live' : ''), role: 'button', tabindex: 0, draggable: true, 'data-zone': z.id, 'data-id': sc.id,
    title: `${sc.name} · ${sc.layers.length} layer${sc.layers.length === 1 ? '' : 's'} · ${sc.fade > 0 ? 'fades in over ' + fmtV(sc.fade) + ' s' : 'cuts in'}` +
      (inLists ? ` · in ${inLists} playlist${inLists === 1 ? '' : 's'}` : '') + '\nDrag to reorder, or onto a playlist to add it' },
    h('div', { class: 't' }, keys && i < 9 ? h('span', { class: 'k' }, i + 1) : null, h('span', { class: 'nm' }, sc.name),
      h('button', { class: 'x', type: 'button', title: 'Add to playlist, update, rename, delete…', 'aria-label': 'Options for ' + sc.name, onclick: e => { e.stopPropagation(); sceneMenu(e.currentTarget, z, sc); } }, '⋯')),
    h('div', { class: 's' }, null, h('span', { class: 'fill' }),
      edited ? h('span', { class: 'badge warn', title: 'The layers have changed since this scene was recalled. ⋯ → Update saves the changes into it.' }, 'edited') : null),
    h('i', { class: 'prog' }));
  tile.querySelector('.s').prepend(fadeControl(tile, { name: sc.name, get: () => sc.fade, set: v => { sc.fade = v; } }));
  tile.style.setProperty('--tag', sc.tag);
  tile.addEventListener('click', e => goScene(z, sc, e.shiftKey));
  onRightClick(tile, e => sceneMenu(at(e), z, sc));
  tile.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === tile) { e.preventDefault(); goScene(z, sc, e.shiftKey); } });
  tile.addEventListener('dragstart', e => { e.dataTransfer.setData(dragType('scene'), z.id + ':' + sc.id); e.dataTransfer.effectAllowed = 'copyMove'; tile.classList.add('dragging'); });
  tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
  tile.addEventListener('dragover', e => { if (!e.dataTransfer.types.includes(dragType('scene'))) return; e.preventDefault(); tile.classList.add('drop'); });
  tile.addEventListener('dragleave', () => tile.classList.remove('drop'));
  tile.addEventListener('drop', e => {  // drop onto a scene: take its place (also moves scenes between zones)
    const d = e.dataTransfer.getData(dragType('scene'));
    tile.classList.remove('drop');
    if (!d) return;
    e.preventDefault();
    moveScene(d, z, z.scenes.indexOf(sc));
  });
  return tile;
}
function renderScenes(body) {
  const fadeIn = numInput(project.settings, 'fade', { min: 0, max: 60, step: 0.1, aria: 'Fade time for new scenes', onCommit: commit });
  fadeIn.style.width = '56px';
  const bar = h('div', { class: 'bar' },
    h('label', { class: 'checkrow', title: 'Fade time given to scenes you store from now on' }, 'New scenes fade in', fadeIn, 's'),
    h('span', { class: 'fill' }),
    h('span', { class: 'muted' }, 'Click: fade · Shift-click: cut · Drag a fade time to change it · Keys 1–9: scenes of the selected zone · Upper zones cover lower ones'));
  const rows = h('div', { class: 'zonerows' });
  const sel = selZone();
  for (const z of project.zones.slice().reverse()) {
    const look = lookOf(z.layers);
    const p = z._play, cur = playingList(z), state = cur && p.on ? ' playing' : cur && !p.ended ? ' paused' : '';
    const lists = h('button', { class: 'btn sm icon plbtn' + state + (ui.playlistOpen[z.id] ? ' on' : ''), type: 'button', html: ICONS.playlist,
      title: !z.playlists.length ? `New playlist for ${z.name}…` : (cur ? `${cur.name} is ${p.on ? 'playing' : p.ended ? 'stopped' : 'paused'}. ` : '') + (ui.playlistOpen[z.id] ? 'Fold the playlist' : 'Open the playlist'),
      'aria-label': z.name + ' playlists',
      onclick: e => {
        e.stopPropagation();
        if (!z.playlists.length) { newPlaylistDialog(z); return; }
        if (ui.playlistOpen[z.id]) delete ui.playlistOpen[z.id]; else ui.playlistOpen[z.id] = (cur || z.playlists[0]).id;
        ui.playlistStep = null; ui.playlistAdd = null;
        if (ui.zone !== z.id) selectZone(z); else renderDock();
      } });
    const head = h('div', { class: 'zhead' + (z === sel ? ' sel' : ''), title: `${z.name}: click to select. The slider is the zone's opacity, its master.`, onclick: () => selectZone(z) },
      h('div', { class: 'zt' }, zoneTag(z), h('span', { class: 'nm' }, z.name), h('span', { class: 'mono muted', 'data-zone-pct': z.id }, pct(z.opacity)), lists),
      h('div', { class: 'zc' }, zoneOpacityInput(z, 80),
        h('button', { class: 'btn sm', type: 'button', title: `Store ${z.name}'s current layers as a new scene`, onclick: e => { e.stopPropagation(); storeScene(z); } }, '+ Store')));
    const r = h('div', { class: 'scenerow' + (z === sel ? ' sel' : '') }, head);
    head.title += '\nDrag it to change the order of the zones.';
    reorderable(head, r, 'zone', () => [z.id], ([id], after) => moveZoneTo(id, z, after));
    onRightClick(head, e => zoneMenu(e, z));
    // a scene dropped on the row, but not on a scene, goes to the end of this zone's scenes
    r.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes(dragType('scene'))) return;
      const onTile = !!e.target.closest('.scene');   // a scene tile shows its own drop frame
      r.classList.toggle('drop-in', !onTile);
      if (!onTile) e.preventDefault();
    });
    r.addEventListener('dragleave', e => { if (!r.contains(e.relatedTarget)) r.classList.remove('drop-in'); });
    r.addEventListener('drop', e => { r.classList.remove('drop-in'); const d = e.dataTransfer.getData(dragType('scene')); if (!d || e.defaultPrevented) return; e.preventDefault(); moveScene(d, z); });
    z.scenes.forEach((sc, i) => r.append(sceneTile(z, sc, i, z === sel, look)));
    if (!z.scenes.length) r.append(h('span', { class: 'rowhint' }, `No scenes yet. Set up ${z.name}'s layers in the Content tab, then + Store.`));
    rows.append(h('div', { class: 'zoneblock' + (z === sel ? ' sel' : ''), 'data-zone': z.id }, r, playlistArea(z)));
  }
  if (!project.zones.length) rows.append(h('div', { class: 'empty' }, 'No zones. Add one in the Content tab, or draw one with the Zone tool (Z).'));
  body.append(h('div', { class: 'scenepanel' }, bar, rows));
}
function drawSceneProgress() {
  for (const el of $$('#dockBody .scene')) {
    const z = zoneById(el.dataset.zone), f = z && z._fade;
    const w = f && f.scene === el.dataset.id ? (clamp((clockT - f.start) / f.dur, 0, 1) * 100).toFixed(1) + '%' : '0px';
    if (el.lastChild.style.width !== w) el.lastChild.style.width = w;
  }
  drawPlaylistProgress();
}

/* ---------- patch ---------- */
function ctrlSummary(c) {
  const outs = c._outs || [];
  const used = outs.reduce((a, o) => a + (o ? Math.ceil(o.ch / 512) : 0), 0);
  const px = outs.reduce((a, o) => a + (o ? o.pixels : 0), 0);
  const ovf = outs.reduce((a, o) => a + (o ? o.overflow : 0), 0);
  return { used, px, ovf, cap: c.outputs * c.upo };
}
function renderPatch(body) {
  ensurePatch();
  if (!ui.selCtrl || !ctrlById(ui.selCtrl)) ui.selCtrl = project.controllers[0] ? project.controllers[0].id : null;
  const items = h('div', { class: 'items' });
  for (const c of project.controllers) {
    const s = ctrlSummary(c);
    const ipOk = !!parseIP(c.ip);
    const badge = !ipOk ? h('span', { class: 'badge err' }, 'IP?') : !c.enabled ? h('span', { class: 'badge' }, 'OFF') : s.ovf ? h('span', { class: 'badge err' }, 'OVERFLOW') : h('span', { class: 'badge ok' }, 'ON');
    const item = h('div', { class: 'ctrl' + (c.id === ui.selCtrl ? ' sel' : ''), onclick: () => { ui.selCtrl = c.id; renderDock(); } },
      h('div', { class: 't' }, h('span', { class: 'badge' }, ctrlLetter(c)), h('span', { class: 'nm' }, c.name), badge),
      h('div', { class: 's mono' }, h('span', null, c.ip), h('span', null, `${s.used}/${s.cap} U · ${fmtN(s.px)} px`)));
    onRightClick(item, e => controllerMenu(e, c));
    items.append(item);
  }
  if (!project.controllers.length) items.append(h('div', { class: 'empty' }, 'No controllers yet. Add one for each Art-Net node or pixel controller on your network.'));
  const list = h('div', { class: 'ctrl-list' }, items, h('div', { class: 'foot' },
    h('button', { class: 'btn sm', type: 'button', onclick: () => { const c = newController(); project.controllers.push(c); ui.selCtrl = c.id; markPatch(); commit(); renderRight(); } }, '+ Controller'),
    h('button', { class: 'btn sm', type: 'button', title: 'Put the selected fixtures (or all unpatched ones) on the outputs of this controller, filling each output in turn', onclick: autoPatch, disabled: !ui.selCtrl }, 'Auto-patch')));
  const c = ctrlById(ui.selCtrl);
  const edit = h('div', { class: 'ctrl-edit' });
  if (c) renderCtrlEditor(edit, c);
  else edit.append(h('div', { class: 'empty' }, 'Controllers are the Art-Net devices your LEDs are wired to. Each controller has an IP address and a number of physical outputs; every output gets a block of universes, and the fixtures you chain on it are addressed automatically in order.'));
  body.append(h('div', { class: 'patch' }, list, edit));
}
function renderCtrlEditor(edit, c) {
  const f = (label, el, title) => h('label', { class: 'f', title }, h('span', null, label), el);
  const small = (el, w) => { el.style.width = w + 'px'; return el; };
  const ipIn = textInput(c, 'ip', { aria: 'IP address', onInput: (v, el) => { el.classList.toggle('bad', !parseIP(v)); markPatch(); }, onCommit: () => { commit(); } });
  ipIn.classList.toggle('bad', !parseIP(c.ip));
  // Delete takes a double-click, so a stray click can't remove a controller and its patch
  const del = h('button', { class: 'btn icon trash', type: 'button', title: 'Delete this controller (double-click)', 'aria-label': 'Delete controller ' + c.name }, icon('trash'));
  del.addEventListener('click', e => { if (e.detail === 1) toast(`Double-click the bin to delete ${c.name}. ${MOD}Z brings it back.`); });
  del.addEventListener('dblclick', () => deleteController(c));
  const onStruct = () => {
    const before = c.chains.flat().length;
    ensureChains(c);
    const lost = before - c.chains.flat().length;
    if (lost > 0) toast(`${lost} fixture${lost > 1 ? 's' : ''} unpatched because the output was removed`, 'warn');
    markPatch(); commit();
  };
  // Output on or off: a switch, as it is a state rather than a setting
  const en = h('button', { class: 'onsw' + (c.enabled ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(!!c.enabled),
    title: c.enabled ? 'This controller gets Art-Net. Click to stop sending to it.' : 'Nothing is sent to this controller. Click to send to it again.',
    onclick: () => { c.enabled = !c.enabled; markPatch(); commit(); } }, h('i'), c.enabled ? 'ON' : 'OFF');
  // Whole pixels: a universe ends at channel 510 for RGB, so no pixel is split between two universes
  const skip = h('input', { type: 'checkbox', checked: !c.split, id: 'ctrlSkip' });
  skip.addEventListener('change', () => { c.split = !skip.checked; markPatch(); commit(); });
  const SKIP_INFO = 'A universe has 512 channels, but 512 is not a multiple of 3: an RGB pixel takes 3 channels, so 170 pixels fill channels 1 to 510.\n\n'
    + 'On (standard): channels 511 and 512 stay empty and the 171st pixel starts at channel 1 of the next universe, so no pixel is split between two universes. This is what nearly every pixel controller expects (PixLite, Falcon, Advatek, WLED…): keep it on.\n\n'
    + 'Off: all 512 channels are used, and the 171st pixel gets red and green on 511–512 and blue on channel 1 of the next universe. Only for controllers set to continuous addressing, or for plain DMX channels.\n\n'
    + 'If colours look shifted from the second universe on, this setting does not match the controller.\n'
    + 'RGBW pixels take 4 channels: 128 fill a universe exactly, so nothing is skipped either way.\n'
    + '16-bit fixtures take two channels per colour (coarse, then fine): 6 for RGB, so 85 pixels fill channels 1 to 510; 8 for RGBW, so 64 fill a universe.';
  edit.append(h('div', { class: 'ctrl-fields' },
    f('Output', en),
    f('Name', small(textInput(c, 'name', { aria: 'Controller name', onInput: () => {}, onCommit: () => { commit(); renderRight(); } }), 150)),
    f('IP address', small(ipIn, 120)),
    f('Outputs', small(numInput(c, 'outputs', { int: true, min: 1, max: 128, aria: 'Outputs', onCommit: onStruct }), 64)),
    f('Unis / output', small(numInput(c, 'upo', { int: true, min: 1, max: 64, aria: 'Universes per output', onCommit: onStruct }), 64), 'Universes per output'),
    f('First uni', small(numInput(c, 'startUniverse', { int: true, min: 0, max: 32767, aria: 'First universe', onCommit: onStruct }), 64), 'First universe: the universe of output 1'),
    c.discovered && c.discovered.length ? f('ArtPoll', h('span', { class: 'reported' }, 'U ' + universeList(c.discovered)),
      `Universes this device reported when discovered (${c.discovered.length}). Set Outputs and Unis / output to how the device is set up.`) : null,
    h('div', { class: 'skiprow' }, h('label', { class: 'checkrow', for: 'ctrlSkip' }, skip, 'Skip ch 511–512'),
      h('span', { class: 'info', tabindex: 0, role: 'img', 'aria-label': SKIP_INFO, title: SKIP_INFO }, 'i')),
    h('span', { style: { flex: 1 } }), del));
  if (patchConflicts.length) edit.append(h('div', { class: 'conflict' }, 'Universe clash: ' + patchConflicts[0] + (patchConflicts.length > 1 ? ` (+${patchConflicts.length - 1} more)` : '')));
  const folds = ui.foldOuts || (ui.foldOuts = new Set());
  const foldAll = shut => { c.chains.forEach((_, o) => { const k = c.id + ':' + o; shut ? folds.add(k) : folds.delete(k); }); renderDock(); };
  edit.append(h('div', { class: 'outbar' },
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn sm', type: 'button', onclick: () => foldAll(true) }, 'Fold all'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => foldAll(false) }, 'Unfold all')));
  const outs = h('div', { class: 'outs' });
  c.chains.forEach((chain, o) => {
    const info = (c._outs && c._outs[o]) || { base: c.startUniverse + o * c.upo, pixels: 0, overflow: 0, ch: 0 };
    const usedU = Math.ceil(info.ch / 512), key = c.id + ':' + o, n = chain.filter(fxById).length;
    const pct = Math.min(100, info.ch / (c.upo * 512) * 100);
    const usage = h('div', { class: 'usage' + (info.overflow ? ' ovf' : pct > 92 ? ' full' : '') },
      h('div', { class: 'bar' }, h('i', { style: { width: (info.overflow ? 100 : pct) + '%' } })),
      h('div', { class: 'lbl' }, h('span', null, `${fmtN(info.pixels)} px`), h('span', null, info.overflow ? `${info.overflow} px over` : `${usedU}/${c.upo} U`)));
    const head = h('div', { class: 'outhead', title: 'Click to fold or unfold. Drop fixtures here to add them at the end.' },
      h('span', { class: 'fold' }, folds.has(key) ? '▸' : '▾'),
      h('span', { class: 'on' }, 'OUT ' + (o + 1)),
      h('span', { class: 'ur' }, c.upo > 1 ? `U ${info.base}–${info.base + c.upo - 1}` : `U ${info.base}`),
      h('span', { class: 'sum' }, n ? `${n} fixture${n === 1 ? '' : 's'} · ${fmtN(info.ch)} ch` : 'empty'),
      usage);
    head.addEventListener('click', () => { folds.has(key) ? folds.delete(key) : folds.add(key); renderDock(); });
    const list = h('div', { class: 'outlist' });
    chain.forEach((fid, k) => {
      const fx = fxById(fid);
      if (!fx) return;
      const p = fx._patch;
      let ad = '—';
      if (p && p.first >= 0) {
        const a = addrOf(p.base, p.first), b = addrOf(p.base, p.last);
        ad = a.u === b.u ? `U${a.u} · ch ${a.ch}–${b.ch}` : `U${a.u}.${a.ch} – U${b.u}.${b.ch}`;
      }
      if (p && p.overflow) ad = p.first >= 0 ? `${ad} · ${p.overflow} px over` : `${p.overflow} px don't fit`;
      const mv = (txt, d, off, label) => h('button', { type: 'button', disabled: off, title: label, 'aria-label': `${label}: ${fx.name}`, onclick: e => { e.stopPropagation(); moveOnOutput([fid], d); } }, txt);
      const row = h('div', { class: 'prow' + (ui.sel.has(fid) ? ' sel' : '') + (p && p.overflow ? ' ovf' : ''), draggable: true, 'data-id': fid, 'data-name': fx.name.toLowerCase(),
        title: `${fx.name} · ${pixelCount(fx)} px ${fx.order}${p && p.first >= 0 ? '\n' + addrText(p) : ''}${p && p.overflow ? `\n${p.overflow} pixels overflow` : ''}\n↑ ↓ or Alt ↑ ↓ move it on the output; drag to reorder` },
        h('span', { class: 'pgrip', 'aria-hidden': 'true' }), h('span', { class: 'ix' }, k + 1), h('span', { class: 'tag', style: { background: fx.tag } }), h('span', { class: 'nm' }, fx.name),
        h('span', { class: 'px' }, pixelCount(fx) + ' px'), h('span', { class: 'ad' }, ad),
        h('span', { class: 'mv' }, mv('↑', -1, k === 0, 'Move earlier'), mv('↓', 1, k === chain.length - 1, 'Move later')),
        h('button', { class: 'x', type: 'button', title: 'Unpatch', 'aria-label': 'Unpatch ' + fx.name, onclick: e => { e.stopPropagation(); unassign(fid); markPatch(); commit(); renderRight(); } }, icon('x')));
      row.addEventListener('click', e => { if (e.shiftKey || e.metaKey || e.ctrlKey) ui.sel.has(fid) ? ui.sel.delete(fid) : ui.sel.add(fid); else ui.sel = new Set([fid]); onSelection(); });
      onRightClick(row, e => chipMenu(e, fid, c, o));
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'fx:' + (ui.sel.has(fid) ? chain.filter(id => ui.sel.has(id)) : [fid]).join(',')); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', () => { $$('.prow.dropat', outs).forEach(x => x.classList.remove('dropat')); row.classList.add('dropat'); });
      list.append(row);
    });
    if (!n) list.append(h('div', { class: 'ph' }, 'Drop fixtures here, or right-click a fixture → Patch to'));
    const rowEl = h('div', { class: 'outrow' + (folds.has(key) ? ' shut' : ''), 'data-key': key }, head, list);
    rowEl.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; rowEl.classList.add('drop'); });
    rowEl.addEventListener('dragleave', e => { if (!rowEl.contains(e.relatedTarget)) { rowEl.classList.remove('drop'); $$('.prow.dropat', rowEl).forEach(x => x.classList.remove('dropat')); } });
    rowEl.addEventListener('drop', e => {   // onto a fixture: before it; anywhere else on the output: at the end
      e.preventDefault(); rowEl.classList.remove('drop'); $$('.prow.dropat', rowEl).forEach(x => x.classList.remove('dropat'));
      const d = e.dataTransfer.getData('text/plain');
      if (!d.startsWith('fx:')) return;
      const ids = d.slice(3).split(',').filter(fxById);
      const target = e.target.closest('.prow');
      flipRows('#dockBody .prow', () => {
        let idx = target ? chain.indexOf(target.dataset.id) : -1;
        for (const id of ids) { if (id === (target && target.dataset.id)) continue; assign(id, c, o, idx); if (idx >= 0) idx = chain.indexOf(id) + 1; }
        commit(); renderRight();
      }, ids);
    });
    outs.append(rowEl);
  });
  edit.append(outs);
}
// One place earlier (-1) or later (+1) on their outputs. Several on one output move together, keeping their order;
// one already at the start (or end) stays.
function moveOnOutput(ids, d) {
  let moved = 0;
  flipRows('#dockBody .prow', () => { moved = moveOnOutputNow(ids, d); }, ids);
  return moved;
}
function moveOnOutputNow(ids, d) {
  const set = new Set(ids);
  let moved = 0;
  for (const c of project.controllers) for (const chain of c.chains) {
    const at = chain.map((id, i) => set.has(id) ? i : -1).filter(i => i >= 0);
    for (const i of d < 0 ? at : at.reverse()) {
      const j = i + d;
      if (j < 0 || j >= chain.length || set.has(chain[j])) continue;
      [chain[i], chain[j]] = [chain[j], chain[i]];
      moved++;
    }
  }
  if (!moved) return false;
  markPatch(); commit(); renderRight(); revealInPatch();
  return true;
}
// To the start or the end of their outputs, keeping their order
function moveToOutputEdge(ids, end) {
  flipRows('#dockBody .prow', () => moveToOutputEdgeNow(ids, end), ids);
}
function moveToOutputEdgeNow(ids, end) {
  const set = new Set(ids);
  for (const c of project.controllers) c.chains.forEach((chain, o) => {
    if (!chain.some(id => set.has(id))) return;
    const mine = chain.filter(id => set.has(id)), rest = chain.filter(id => !set.has(id));
    c.chains[o] = end ? rest.concat(mine) : mine.concat(rest);
  });
  markPatch(); commit(); renderRight(); revealInPatch();
}
// The Patch panel follows the selection: the controller of a selected fixture, its output unfolded, its row in view
function revealInPatch() {
  if (ui.dockTab !== 'patch' || ui.dockCollapsed || ui.sel.size !== 1) return;
  ensurePatch();
  const f = fxById([...ui.sel][0]), p = f && f._patch;
  if (!p) return;
  const key = p.ctrl.id + ':' + p.out;
  if (ui.selCtrl !== p.ctrl.id || (ui.foldOuts && ui.foldOuts.has(key))) { ui.selCtrl = p.ctrl.id; if (ui.foldOuts) ui.foldOuts.delete(key); renderDock(); }
  requestAnimationFrame(() => { const r = $(`#dockBody .prow[data-id="${CSS.escape(f.id)}"]`); if (r) r.scrollIntoView({ block: 'center' }); });
}
function autoPatch() {
  const c = ctrlById(ui.selCtrl);
  if (!c) return;
  if (geomDirty) rebuildGeometry();
  let list = selected();
  if (!list.length) list = project.fixtures.filter(f => !f._patch);
  if (!list.length) { toast('Nothing to patch: select fixtures, or leave some unpatched.'); return; }
  let o = 0, placed = 0, over = 0;
  for (const f of list) {
    unassign(f.id);
    while (o < c.outputs - 1 && simulateChannels(c, c.chains[o], f) > c.upo * 512) o++;
    if (simulateChannels(c, c.chains[o], f) > c.upo * 512) over++;
    c.chains[o].push(f.id); placed++;
  }
  markPatch(); commit(); renderRight();
  toast(over ? `Patched ${placed} fixtures; ${over} do not fully fit. Add universes per output or outputs.` : `Patched ${placed} fixtures onto ${c.name}`, over ? 'warn' : '');
}

/* ---------- nodes ---------- */
// The networks of this computer that discovery uses: all of them, except the ones turned off in the Nodes tab
// (kept per computer, by address)
const ipNum = ip => ip.split('.').reduce((a, b) => a * 256 + (+b), 0);
const netOf = (ip, nets) => nets.find(n => Math.floor(ipNum(ip) / 2 ** (32 - n.prefix)) === Math.floor(ipNum(n.ip) / 2 ** (32 - n.prefix)));
const scanNets = () => ((bridge.hello && bridge.hello.nets) || []).filter(n => !(ui.scanOff || []).includes(n.ip));
function discover() {
  const nets = (bridge.hello && bridge.hello.nets) || [], ifaces = scanNets().map(n => n.ip), extra = project.settings.broadcast.trim();
  if (nets.length && !ifaces.length && !extra) { toast('Turn on a network to scan, or type an address to send ArtPoll to.', 'warn'); return; }
  bridgeSend(nets.length ? { t: 'poll', ifaces, broadcast: extra } : { t: 'poll', broadcast: extra });
}
function renderNodes(body) {
  const s = project.settings;
  const hello = bridge.hello, nets = (hello && hello.nets) || [], off = new Set(ui.scanOff || []);
  const bc = textInput(s, 'broadcast', { aria: 'Also send ArtPoll to this address', placeholder: 'e.g. 2.255.255.255', onCommit: commit });
  bc.style.width = '130px';
  const info = !bridge.connected ? h('span', { class: 'badge warn' }, 'Not connected')
    : hello && !hello.discovery ? h('span', { class: 'badge warn', title: hello.discoveryNote || '' }, 'Discovery off: ' + (hello.discoveryNote || 'UDP 6454 in use'))
    : h('span', { class: 'badge ok' }, 'Listening on 6454');
  const chip = n => h('label', { class: 'netchip' + (off.has(n.ip) ? '' : ' on'),
    title: `${n.name ? n.name + '\n' : ''}${n.ip} / ${n.mask}\nArtPoll goes to ${n.broadcast}${n.guessed ? '\n(mask guessed: the system did not say)' : ''}` },
    h('input', { type: 'checkbox', checked: !off.has(n.ip), onchange: e => {
      ui.scanOff = e.target.checked ? (ui.scanOff || []).filter(ip => ip !== n.ip) : [...(ui.scanOff || []), n.ip];
      savePrefs(); renderDock(); } }),
    n.name ? h('span', { class: 'nn' }, n.name) : null, h('span', { class: 'mono' }, `${n.ip}/${n.prefix}`));
  const bar = h('div', { class: 'bar' },
    h('button', { class: 'btn primary', type: 'button', disabled: !bridge.connected, onclick: discover }, 'Discover'),
    nets.length ? h('span', null, 'on') : null, ...nets.map(chip),
    h('span', null, nets.length ? 'Also' : 'Send to'), bc, info);
  // Nodes on a network turned off for scans are left out; the network column shows where each one answered
  const all = nodeDevices(), nodes = all.filter(n => { const k = netOf(n.ip, nets); return !k || !off.has(k.ip); });
  const scroll = h('div', { class: 'scroll' });
  if (!nodes.length) {
    scroll.append(h('div', { class: 'empty' }, bridge.connected
      ? (all.length ? `${all.length} node${all.length === 1 ? ' is' : 's are'} on networks turned off for scans.` : nets.length
        ? 'No nodes found yet. Press Discover: ArtPoll goes out on the networks ticked above, and Art-Net devices on them reply. A device on a network with another address range (a 2.x.x.x node while this computer has 192.168.x.x) needs an address in its range on this computer.'
        : 'No nodes found yet. Press Discover. Nodes reply to ArtPoll on the broadcast address of their network: 2.255.255.255 for a 2.x.x.x Art-Net network, 10.255.255.255 for 10.x.x.x.')
      : 'Node discovery needs openLedMapper running on this computer (the app, or openledmapper.py): a web page on its own cannot send or receive Art-Net.'));
  } else {
    scroll.append(h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['IP', 'Name', 'Network', 'Output ports', 'Universes', 'MAC', 'Status', ''].map(t => h('th', null, t)))),
      h('tbody', null, nodes.map(n => {
        const known = project.controllers.find(c => c.ip === n.ip);
        return withRightClick(h('tr', null,
          h('td', { class: 'mono' }, n.ip),
          h('td', null, h('div', null, n.shortName || '—'), h('div', { class: 'muted', style: { fontSize: '11px' } }, n.longName)),
          h('td', { class: 'mono muted' }, (k => k ? k.name || k.ip : '—')(netOf(n.ip, nets))),
          h('td', { class: 'mono' }, n.universes.length || '—'),
          h('td', { class: 'mono' }, n.universes.length ? n.universes.join(', ') : '—'),
          h('td', { class: 'mono' }, n.mac || '—'),
          h('td', { class: 'muted', style: { fontSize: '11px', maxWidth: '260px' } }, n.report || ''),
          h('td', null, h('button', { class: 'btn sm', type: 'button', disabled: !n.universes.length, title: n.universes.length ? (known ? `Refresh the universes ${known.name} shows as reported by the device, in the Patch tab` : '') : 'This device reports no output ports',
            onclick: () => addNodeAsController(n) }, known ? 'Refresh universes' : 'Add as controller'))), e => nodeMenu(e, n));
      }))));
  }
  const hidden = all.length - nodes.length;
  if (nodes.length && hidden) scroll.append(h('p', { class: 'note', style: { padding: '6px 12px' } }, `${hidden} more on networks turned off for scans.`));
  body.append(h('div', { class: 'nodes' }, bar, scroll));
}
// One device per IP. A node with several ports answers ArtPoll once per port (or per group of ports), each reply
// with its own bind index; together they are one device: one IP, all their output universes.
function nodeDevices() {
  const byIp = new Map();
  for (const n of bridge.nodes.values()) { if (!byIp.has(n.ip)) byIp.set(n.ip, []); byIp.get(n.ip).push(n); }
  const pick = (list, k) => (list.find(n => n[k]) || {})[k] || '';
  return [...byIp].map(([ip, list]) => {
    list.sort((a, b) => (a.bindIndex || 0) - (b.bindIndex || 0));
    const universes = [...new Set(list.flatMap(n => Array.isArray(n.outUniverses) ? n.outUniverses : []))].sort((a, b) => a - b);
    return { ip, replies: list.length, universes, shortName: pick(list, 'shortName'), longName: pick(list, 'longName'), mac: pick(list, 'mac'), report: pick(list, 'report') };
  }).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}
// ArtPoll says which universes a device listens on, not how they are split over its physical outputs (2 outputs
// of 3 universes, 3 of 2…): only the operator knows. So a device becomes a controller with its IP, its name and
// the universes it reported, kept as a reminder in the Patch tab; one output from its first universe is just a
// starting point. Adding a device that is already a controller only refreshes that reminder.
function addNodeAsController(n) {
  const u = n.universes;
  if (!u.length) return;
  const range = universeList(u);
  const same = project.controllers.find(c => c.ip === n.ip);
  if (same) {
    same.discovered = u.slice();
    ui.selCtrl = same.id; ui.dockTab = 'patch';
    commit();
    toast(`${same.name}: the device reports ${u.length} universe${u.length === 1 ? '' : 's'} (${range}). Its outputs and universes per output are as you set them.`);
    return;
  }
  const c = newController({ name: n.shortName || n.ip, ip: n.ip, outputs: 1, upo: Math.min(u[u.length - 1] - u[0] + 1, 64), startUniverse: u[0], discovered: u.slice() });
  project.controllers.push(c);
  ui.selCtrl = c.id; ui.dockTab = 'patch';
  markPatch(); commit();
  toast(`Added ${c.name}. It reports ${u.length} universe${u.length === 1 ? '' : 's'} (${range}): set its outputs and universes per output to match how the device is set up.`);
}
// 0, 1, 2, 3, 7 → "0–3, 7"
function universeList(u) {
  const parts = [];
  for (let i = 0; i < u.length; i++) {
    let j = i;
    while (j + 1 < u.length && u[j + 1] === u[j] + 1) j++;
    parts.push(j > i ? `${u[i]}–${u[j]}` : String(u[i]));
    i = j;
  }
  return parts.join(', ');
}

/* ---------- DMX monitor ---------- */
let monCanvas = null, monMap = null, monMapKey = '';
function renderMonitor(body) {
  ensurePatch();
  if (!universes.find(u => u.key === ui.monitorKey)) ui.monitorKey = universes[0] ? universes[0].key : null;
  const ul = h('div', { class: 'ulist' }, universes.length ? universes.map(u => h('div', { class: u.key === ui.monitorKey ? 'sel' : '', onclick: () => { ui.monitorKey = u.key; renderDock(); } },
    h('span', null, `${u.ip} · U ${u.uni}`), h('span', { class: 'muted' }, u.used + ' ch'))) : h('div', { class: 'empty', style: { fontFamily: 'var(--ui)', cursor: 'default' } }, 'No universes yet. Patch fixtures to a controller.'));
  monCanvas = h('canvas', { width: 32 * 26, height: 16 * 20, 'aria-label': 'DMX channel values' });
  const read = h('div', { class: 'readout' }, 'Hover a channel to see what drives it.');
  monCanvas.addEventListener('mousemove', e => {
    const r = monCanvas.getBoundingClientRect();
    const cx = Math.floor((e.clientX - r.left) / r.width * 32), cy = Math.floor((e.clientY - r.top) / r.height * 16);
    const ch = cy * 32 + cx;
    if (ch < 0 || ch > 511) return;
    const U = universes.find(u => u.key === ui.monitorKey);
    if (!U) return;
    const m = monitorMap(U)[ch];
    read.textContent = `ch ${ch + 1} = ${U.data[ch]}` + (m ? ` · ${m.f.name} · pixel ${m.i + 1} · ${m.c}${m.coarse ? ' coarse' : m.fine ? ' fine' : ''}` : ' · unused');
  });
  const U = universes.find(u => u.key === ui.monitorKey);
  const bar = h('div', { class: 'bar' }, U ? h('span', { class: 'mono' }, `${U.ip} · universe ${U.uni} (net ${U.uni >> 8}, subnet ${(U.uni >> 4) & 15}, universe ${U.uni & 15}) · ${U.ctrl.name} OUT ${U.out + 1}`) : h('span', null, 'DMX values being sent'),
    U && !U.enabled ? h('span', { class: 'badge warn' }, 'not sent: controller off or IP invalid') : null,
    h('span', { class: 'muted' }, ui.outputOn ? '' : 'Art-Net output is off; values shown are what would be sent.'));
  body.append(h('div', { class: 'monitor' }, bar, h('div', { class: 'mbody' }, ul, h('div', { class: 'grid' }, monCanvas, read))));
}
function monitorMap(U) {
  const key = U.key + '#' + patchVersion;
  if (monMapKey === key) return monMap;
  monMap = new Array(512).fill(null);
  for (const f of project.fixtures) {
    const o = f._out; if (!o) continue;
    for (let i = 0; i < f._n; i++) {
      const lin = o.lin[i]; if (lin < 0) continue;
      // a 16-bit fixture has two channels per colour: the coarse one, then the fine one
      const per = f.bits === 16 ? 2 : 1;
      for (let k = 0; k < f.order.length * per; k++) { const L = lin + k; if (o.unis[L >> 9] === U) monMap[L & 511] = { f, i, c: f.order[(k / per) | 0], fine: per === 2 && k % 2 === 1, coarse: per === 2 && k % 2 === 0 }; }
    }
  }
  monMapKey = key;
  return monMap;
}
let monLast = 0;
function drawMonitor(now) {
  if (!monCanvas || !monCanvas.isConnected || now - monLast < 66) return;
  monLast = now;
  const U = universes.find(u => u.key === ui.monitorKey);
  const c = monCanvas.getContext('2d');
  const cw = 26, chh = 20;
  c.fillStyle = '#0a0b0e'; c.fillRect(0, 0, monCanvas.width, monCanvas.height);
  if (!U) return;
  const map = monitorMap(U);
  c.font = '9px ' + (FONT_MONO || 'monospace'); c.textAlign = 'center'; c.textBaseline = 'middle';
  const tint = { R: [255, 80, 90], G: [70, 224, 140], B: [80, 150, 255], W: [235, 235, 235] };
  for (let ch = 0; ch < 512; ch++) {
    const x = (ch % 32) * cw, y = Math.floor(ch / 32) * chh, v = U.data[ch], m = map[ch];
    if (!m) { c.fillStyle = '#111318'; c.fillRect(x + 1, y + 1, cw - 2, chh - 2); continue; }
    const t = tint[m.c] || tint.W, k = 0.12 + 0.88 * v / 255;
    c.fillStyle = `rgb(${t[0] * k | 0},${t[1] * k | 0},${t[2] * k | 0})`;
    c.fillRect(x + 1, y + 1, cw - 2, chh - 2);
    c.fillStyle = v > 150 ? '#05070a' : '#c9ced6';
    c.fillText(String(v), x + cw / 2, y + chh / 2 + 0.5);
  }
}
