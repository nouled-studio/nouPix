// nouPix · js/ui-dock.js
// The bottom dock: scenes, the patch table and controller editor; the Discovery window and the Channel monitor.

/* ---------- bottom dock ---------- */
function renderDock() {
  // a panel moved to a side leaves the bottom panel's tabs
  for (const k of Object.keys(PANELS)) $(`#dockTabs button[data-tab="${k}"]`).hidden = placeOf(k) !== 'bottom';
  if (PANELS[ui.dockTab] && placeOf(ui.dockTab) !== 'bottom') ui.dockTab = Object.keys(PANELS).find(k => placeOf(k) === 'bottom') || 'patch';
  $$('#dockTabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.dockTab));
  renderSides();
  const dock = $('#dock');
  dock.classList.toggle('collapsed', ui.dockCollapsed);
  dock.style.setProperty('--bottom-h', ui.dockH + 'px');
  $('#btnDock').textContent = ui.dockCollapsed ? '▴' : '▾';
  const gear = $('#btnOutSet');   // the Output settings, at the right of the Patch tab
  gear.hidden = ui.dockTab !== 'patch' || REMOTE_CLIENT;
  if (!gear.firstChild) gear.append(h('span', { class: 'ic', html: ICONS.out }), 'Output settings');
  const mon = $('#btnMon');   // the Channel monitor, next to it
  mon.hidden = ui.dockTab !== 'patch';
  if (!mon.firstChild) mon.append(h('span', { class: 'ic', html: ICONS.monitor }), 'Channel monitor');
  $('#btnDock').title = ui.dockCollapsed ? 'Expand panel' : 'Collapse panel';
  const body = $('#dockBody');
  const keep = body.firstElementChild && body.querySelector('.ctrl-edit') ? body.querySelector('.ctrl-edit').scrollTop : 0;
  keepScroll(body, () => {
    body.replaceChildren();
    if (ui.dockCollapsed) return;
    if (ui.dockTab === 'scenes' && scenesWinOpen()) renderScenesAway(body);
    else if (ui.dockTab === 'scenes') renderScenes(body);
    else if (ui.dockTab === 'cues') renderCues(body);
    else if (ui.dockTab === 'timeline') renderTimeline(body);
    else if (ui.dockTab === 'patch') {
      renderPatch(body);
      if (mappingLocked()) { const ce = body.querySelector('.ctrl-edit'); if (ce) lockPanel(ce, 'Operator: you can see the patch but not change it.'); body.querySelectorAll('.ctrl-list .foot button').forEach(b => { b.disabled = true; }); }
    }
  });
  if (ui.dockCollapsed) { drawScenesWindow(); return; }
  replayFlip();
  const ce = body.querySelector('.ctrl-edit'); if (ce) ce.scrollTop = keep;
  drawScenesWindow();
  updateMidiUI();
}
function onPatchChanged() { schedulePanels(); }
let panelsQueued = false;
function schedulePanels() {
  if (panelsQueued) return;
  panelsQueued = true;
  requestAnimationFrame(() => {
    panelsQueued = false;
    renderFxList();
    if (!document.activeElement.closest?.('#dockBody')) renderDock();
    updateMonitorUI();
    syncInspector();
  });
}

/* ---------- scenes ---------- */
// While a slider or a fade is dragged, something is dragged and dropped, or a field is typed in, in the Scenes panel,
// a redraw from elsewhere (a playlist moving on, another device) waits until it is over
let scenesHeld = false, scenesDragging = false, scenesPending = false;
const scenesBusy = () => scenesHeld || scenesDragging || [document, scenesDoc()].some(d => d && typingIn(d.activeElement) && d.activeElement.closest('#dockBody, .panelhost'));
function refreshScenes() {
  const root = panelRoot('scenes'), here = root && root.id === 'dockBody';
  if (!root && !scenesWinOpen()) return;
  if (scenesBusy()) { scenesPending = true; return; }
  scenesPending = false;
  if (here) renderDock();
  else { if (root) keepScroll(root, () => { root.replaceChildren(); renderScenes(root, 'side'); }); drawScenesWindow(); }
}
const scenesLetGo = () => { if (scenesPending) setTimeout(() => { if (scenesPending && !scenesBusy()) refreshScenes(); }); };
// in this page, and in the Scenes window when it opens
function watchScenes(d) {
  d.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest(':is(#dockBody, .panelhost) :is(input[type=range], .fd)')) scenesHeld = true; }, true);
  d.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('#dockBody, .panelhost')) scenesDragging = true; }, true);
  for (const t of ['pointerup', 'pointercancel']) d.addEventListener(t, () => { if (scenesHeld) { scenesHeld = false; scenesLetGo(); } }, true);
  for (const t of ['dragend', 'drop']) d.addEventListener(t, () => { if (scenesDragging) { scenesDragging = false; scenesLetGo(); } }, true);
  d.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('#dockBody, .panelhost')) scenesLetGo(); }, true);
}
watchScenes(document);

/* ---------- the Scenes window ---------- */
// The scenes and playlists can have a window of their own, to put on another screen. This page draws it, as it does
// the MIDI window: it closes with this page, and meanwhile the Scenes tab of the bottom panel says where they are.
let scenesWin = null;
const scenesWinOpen = () => !!(scenesWin && !scenesWin.closed);
const scenesDoc = () => (scenesWinOpen() ? scenesWin.document : null);
// Where the scenes are drawn now: the bottom panel's, a side's, the Scenes window's
const scenesRoots = () => [$('#dockBody'), placeOf('scenes') !== 'bottom' && panelRoot('scenes'), scenesDoc() && $('#dockBody', scenesDoc())].filter(Boolean);
// Whether the scenes show in this page now (for the fades' progress)
const scenesHere = () => !scenesWinOpen() && !!panelRoot('scenes');
function openScenesWindow() {
  if (scenesWinOpen()) { raiseWindow(scenesWin); return; }
  const w = window.open('', 'olm-scenes', 'popup,width=1180,height=460');
  if (!w) { toast('The Scenes window could not open: allow pop-up windows for this page.', 'err'); return; }
  scenesWin = w;
  const d = dressWindow(w, 'Scenes · nouPix', 'sceneswin');
  d.body.append(h('div', { class: 'dockbody', id: 'dockBody' }), h('div', { class: 'toasts', id: 'toasts' }));
  watchScenes(d);
  midiCapture(d);   // learning picks a scene or a playlist there too
  // the keys that play: 1–9 the selected zone's scenes (Shift cuts), B blackout; and undo, redo, save
  w.addEventListener('keydown', e => {
    if ($('.modal-bg', d) && e.key === 'Escape') { $('.modal-bg', d).remove(); return; }   // a dialog there, even from its field
    if (typingIn(e.target) || $('.modal-bg', d)) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), digit = /^Digit([1-9])$/.exec(e.code);
    if (e.key === 'Escape' && midi.learn.on) midiSetLearn(false);
    else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 's') { e.preventDefault(); saveProjectFile(e.shiftKey); }
    else if (!mod && digit) { const z = selZone(), sc = z && z.scenes[+digit[1] - 1]; if (sc) goScene(z, sc, e.shiftKey); }
    else if (!mod && k === 'b') toggleBlackout();
  });
  w.addEventListener('pagehide', () => { if (scenesWin === w) { scenesWin = null; renderDock(); } });
  // With this page minimized or behind another, the browser stops its frames (frameLoop): the Scenes window's own
  // frames then draw the X-Fader's previews and the fades' progress there
  const frame = () => {
    if (scenesWin !== w || w.closed) return;
    w.requestAnimationFrame(frame);
    if (!document.hidden || !project) return;
    try {
      if (project.xfade.on) drawXfPreviews();
      drawSceneProgress();
    } catch (e) { report('scenes window', e); }
  };
  w.requestAnimationFrame(frame);
  renderDock();
}
function closeScenesWindow() { if (scenesWinOpen()) scenesWin.close(); scenesWin = null; renderDock(); }
// The Scenes window doesn't outlive this page; one closed by its own button is noticed
addEventListener('pagehide', () => { if (scenesWinOpen()) scenesWin.close(); });
setInterval(() => { if (scenesWin && scenesWin.closed) { scenesWin = null; renderDock(); } }, 1000);
function drawScenesWindow() {
  const D = scenesDoc(), root = D && $('#dockBody', D);
  if (!root) return;
  keepScroll(root, () => { root.replaceChildren(); renderScenes(root, 'window'); });
}
// Where the bottom panel's Scenes, Cue list and Timeline are: at the bottom, or one more tab in the left or right panel
// (next to the side's own: Inspector, Content, Settings on the right; Fixtures on the left), with a ✕ that sends it back
// to the bottom; the scenes also in a window of their own. Each panel's head has the same place buttons.
// (their icons one set: the window's frame, square, with the part the panel takes shaded)
const placeIcon = inner => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">${inner}</svg>`;
const PLACE_ICONS = {
  bottom: placeIcon('<rect x="2" y="3" width="12" height="10"/><rect x="2.65" y="9" width="10.7" height="3.35" fill="currentColor" stroke="none" opacity=".55"/><path d="M2 9h12"/>'),
  left: placeIcon('<rect x="2" y="3" width="12" height="10"/><rect x="2.65" y="3.65" width="3.35" height="8.7" fill="currentColor" stroke="none" opacity=".55"/><path d="M6 3v10"/>'),
  right: placeIcon('<rect x="2" y="3" width="12" height="10"/><rect x="10" y="3.65" width="3.35" height="8.7" fill="currentColor" stroke="none" opacity=".55"/><path d="M10 3v10"/>'),
  window: placeIcon('<rect x="2" y="5" width="9" height="8"/><path d="M5 5V2.5h9V10h-3"/>'),
};
// (the cue lists and the timeline are betas, and say so)
const PANELS = { scenes: 'Scenes', cues: 'Cue lists (Beta)', timeline: 'Timeline (Beta)' };
const PANEL_DRAW = { scenes: b => renderScenes(b, 'side'), cues: b => renderCues(b), timeline: b => renderTimeline(b) };
const placeOf = k => { const p = (ui.places || {})[k]; return p === 'left' || p === 'right' ? p : 'bottom'; };
const movedTo = side => Object.keys(PANELS).filter(k => placeOf(k) === side);
const sideShown = side => !(side === 'left' ? ui.leftHidden : ui.rightHidden);
// The side's moved tab open now, or null (its own)
const sideOpen = side => { const k = (ui.sideOpen || {})[side]; return k && placeOf(k) === side && !(k === 'scenes' && scenesWinOpen()) ? k : null; };
// Where a panel shows now (the bottom panel's body or a side's), or null
function panelRoot(k) {
  const p = placeOf(k);
  if (p === 'bottom') return ui.dockTab === k && !ui.dockCollapsed ? $('#dockBody') : null;
  return sideShown(p) && sideOpen(p) === k ? $('#' + p + 'Host') : null;
}
function panelPlaces(k) {
  const now = k === 'scenes' && scenesWinOpen() ? 'window' : placeOf(k), n = PANELS[k];
  const list = [['bottom', `${n} at the bottom`, 'In the bottom panel'], ['left', `${n} in the left panel`, 'One more tab there; its ✕ brings it back'],
    ['right', `${n} in the right panel`, 'One more tab there, next to Inspector, Content and Settings; its ✕ brings it back']];
  if (k === 'scenes') list.push(['window', 'Open in a window', 'The scenes and playlists in a window of their own, to put on another screen']);
  return h('div', { class: 'spos', role: 'group', 'aria-label': 'Where the ' + n.toLowerCase() + ' are' },
    list.map(([p, name, what]) => h('button', { type: 'button', class: p === now ? 'on' : '', html: PLACE_ICONS[p], 'data-place': p,
      'aria-label': name, 'aria-pressed': String(p === now), 'data-tip': name + '|' + what, onclick: () => setPanelPlace(k, p) })));
}
function setPanelPlace(k, p) {
  if (k === 'scenes' && p === 'window') { openScenesWindow(); renderDock(); return; }
  ui.places = Object.assign({}, ui.places, { [k]: p });
  if (p === 'bottom') { ui.dockTab = k; ui.dockCollapsed = false; }
  else {
    ui.sideOpen = Object.assign({}, ui.sideOpen, { [p]: k });
    if (!sideShown(p)) (p === 'left' ? showLeft : showRight)(true);
  }
  savePrefs();
  if (k === 'scenes' && scenesWinOpen()) closeScenesWindow(); else renderDock();
  // the stage has another size: the whole canvas in view again
  requestAnimationFrame(() => { resizeView(); fitView(); redrawStage(); });
}
// A side's tab picked: a moved one, or (null) the side's own
function openSideTab(side, k) {
  ui.sideOpen = Object.assign({}, ui.sideOpen, { [side]: k });
  savePrefs(); renderSides();
  requestAnimationFrame(() => { resizeView(); redrawStage(); });
}
// The side panels: their moved tabs (each with its ✕), the one open drawn in the side's own body for it, the side as
// wide as set for it meanwhile (the side's own content stays as it was, under)
function renderSides() {
  const ws = $('.workspace');
  for (const side of ['left', 'right']) {
    const moved = movedTo(side), open = sideOpen(side), host = $('#' + side + 'Host'), aside = $('aside.' + side);
    if (!host) continue;
    const tab = k => h('button', { type: 'button', class: 'mtab' + (k === open ? ' on' : ''), 'data-panel': k, title: PANELS[k] + ' (moved here from the bottom panel)',
      onclick: () => openSideTab(side, k) }, PANELS[k],
      h('span', { class: 'mx', role: 'button', tabindex: 0, 'aria-label': 'Close ' + PANELS[k] + ' here', title: 'Close it here: back to the bottom panel',
        onclick: e => { e.stopPropagation(); setPanelPlace(k, 'bottom'); } }, '✕'));
    if (side === 'right') {
      $('#rightMoved').replaceChildren(...moved.map(tab));
      $$('#rightTabs button[data-tab]').forEach(b => b.classList.toggle('on', !open && b.dataset.tab === ui.rightTab));
      $('#rightBody').hidden = !!open;
      tabsInView($('#rightTabs'));
    } else {
      const tabs = $('#leftTabs');
      tabs.hidden = !moved.length;
      // the tab row stands for the Fixtures head meanwhile: its « at the end
      aside.classList.toggle('tabbed', moved.length > 0);
      tabs.replaceChildren(tabStrip(h('span', { class: 'tabstrip' }, h('button', { type: 'button', class: 'mtab' + (open ? '' : ' on'), onclick: () => openSideTab('left', null) }, 'Fixtures'), ...moved.map(tab))),
        h('span', { class: 'fill' }), h('span', { class: 'tabtools' }, h('button', { class: 'btn ghost sm', type: 'button', title: 'Hide this panel (Shift H)', 'aria-label': 'Hide the left panel', onclick: () => showLeft(false) }, '\u00ab')));
      for (const sec of $$('aside.left > section')) sec.hidden = !!open;
      tabsInView(tabs);
    }
    host.hidden = !open;
    aside.classList.toggle('wide', !!open);
    if (open) ws.style.setProperty(side === 'left' ? '--lw' : '--rw', ((ui.sideW || {})[side] || (side === 'left' ? 480 : 520)) + 'px');
    else ws.style.removeProperty(side === 'left' ? '--lw' : '--rw');
    if (open) keepScroll(host, () => { host.replaceChildren(); PANEL_DRAW[open](host); });
    else if (host.firstChild) host.replaceChildren();
  }
}
// A panel's tabs that don't all fit: a row that scrolls sideways, ‹ › at an end with more past it, the wheel scrolling
// it, the open tab brought into view
function tabStrip(strip) {
  strip.addEventListener('wheel', e => { if (strip.scrollWidth > strip.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); strip.scrollLeft += e.deltaY; } }, { passive: false });
  return hscroller(strip);
}
function tabsInView(row) {
  const strip = row && row.querySelector('.tabstrip'), on = strip && strip.querySelector('.on');
  if (!strip) return;
  requestAnimationFrame(() => {
    if (on) { const a = on.offsetLeft - strip.offsetLeft, b = a + on.offsetWidth; if (a < strip.scrollLeft) strip.scrollLeft = a - 24; else if (b > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = b - strip.clientWidth + 24; }
    if (strip._hshow) strip._hshow();
  });
}
// A side's inner edge dragged sets its width while a moved tab is open (the stage at least 240px), once per drawn
// frame, the stage's canvas keeping its size until the drag ends (holdStage)
function initSides() {
  // the right panel's tabs (its own and the ones moved there) in a row that scrolls sideways when they don't fit
  const rt = $('#rightTabs'), strip = h('span', { class: 'tabstrip' }, ...$$('#rightTabs > button[data-tab]'), $('#rightMoved'));
  rt.insertBefore(tabStrip(strip), rt.querySelector('.fill'));
  for (const side of ['left', 'right']) {
    const grip = $('#' + side + 'Grip'), aside = $('aside.' + side);
    if (!grip) continue;
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId); grip.classList.add('on');
      const w0 = aside.getBoundingClientRect().width, stage = $('.center').getBoundingClientRect().width, x0 = e.clientX;
      let x = x0, raf = 0;
      const apply = () => {
        raf = 0;
        const w = Math.round(clamp(w0 + (side === 'right' ? x0 - x : x - x0), 260, Math.max(260, w0 + stage - 240)));
        ui.sideW = Object.assign({}, ui.sideW, { [side]: w });
        $('.workspace').style.setProperty(side === 'left' ? '--lw' : '--rw', w + 'px');
      };
      const mv = ev => { x = ev.clientX; if (!raf) raf = requestAnimationFrame(apply); };
      const up = () => {
        for (const t of ['pointermove', 'pointerup', 'pointercancel']) grip.removeEventListener(t, t === 'pointermove' ? mv : up);
        if (raf) { cancelAnimationFrame(raf); apply(); }
        grip.classList.remove('on'); holdStage(false); savePrefs();
      };
      holdStage(true, true);
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
  }
}
// The Scenes tab while the scenes have their own window
function renderScenesAway(body) {
  body.append(h('div', { class: 'scenesaway' },
    h('p', null, 'The scenes and playlists are in their own window.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: openScenesWindow }, 'Show the window'),
      h('button', { class: 'btn', type: 'button', onclick: closeScenesWindow }, 'Back here'))));
}
function sceneMenu(anchor, z, sc) {
  const n = pl => pl.steps.filter(st => st.scene === sc.id).length;
  menu(anchor, [
    !isEl(anchor) && { head: `${sc.name} · ${z.name}` },
    !isEl(anchor) && ['Go to it' + (sc.fade > 0 ? ` (fade ${fmtV(sc.fade)} s)` : ''), () => goScene(z, sc)],
    !isEl(anchor) && sc.fade > 0 && ['Cut to it', () => goScene(z, sc, true), { key: '⇧click' }],
    !isEl(anchor) && '-',
    ['Add to playlist', null, { sub: [
      ...z.playlists.map(pl => [pl.name, () => { addToPlaylist(z, pl, sc.id); ui.playlistOpen[z.id] = pl.id; renderDock(); toast(`${sc.name} added to ${pl.name}.`); }, { key: n(pl) ? `in it ×${n(pl)}` : '' }]),
      z.playlists.length && '-',
      ['New playlist with it…', () => newPlaylistDialog(z, sc.id)],
    ] }],
    [`Update with ${z.name}'s current layers`, () => updateScene(z, sc)],
    [sc.thumb ? 'Retake snapshot' : 'Take snapshot', () => takeSceneShot(z, sc), { title: `What ${z.name} shows now, on the scene's button` }],
    sc.thumb && ['Remove snapshot', () => { delete sc.thumb; commit(); }],
    ['Rename, fade time, colour…', () => editScene(sc)],
    [(sc.onOpen ? '✓ ' : '') + 'Play when the project opens', () => setSceneOnOpen(z, sc, !sc.onOpen), { title: 'One scene per zone; a playlist set to play on open goes first' }],
    ['Duplicate', () => { const c = Object.assign(JSON.parse(JSON.stringify(sc)), { id: uid(), name: nextCopyName(sc.name, new Set(z.scenes.map(x => x.name))) }); z.scenes.splice(z.scenes.indexOf(sc) + 1, 0, c); commit(); }],
    '-',
    ['Delete', () => { z.scenes = z.scenes.filter(x => x !== sc); if (z.scene === sc.id) z.scene = null; dropSceneSteps(z, sc.id); commit(); toast(`${sc.name} deleted. Ctrl Z brings it back.`); }, { danger: true }],
  ]);
}
function editScene(sc) {
  const tmp = { name: sc.name, fade: sc.fade, tag: sc.tag || '' };
  const close = () => bg.remove();
  const save = () => { sc.name = tmp.name.trim() || sc.name; sc.fade = tmp.fade; if (tmp.tag) sc.tag = tmp.tag; else delete sc.tag; close(); commit(); };
  const nameIn = textInput(tmp, 'name', { aria: 'Scene name' });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Edit scene' },
      h('header', null, 'Scene'),
      h('div', { class: 'mb' },
        row('Name', nameIn),
        numRow('Fade (s)', tmp, 'fade', { min: 0, max: 60, step: 0.1 }),
        row('Colour', tagSwatches(tmp, 'Scene colour', () => {}))),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'))));
  uiDocNow().body.append(bg);   // in the window it was asked for from
  nameIn.focus(); nameIn.select();
}
// A fade time on a button (a scene's, a playlist step's): drag it sideways to change it (Shift = ×10), click it to type
// one, or use the arrow keys. 0 cuts. It works the same while that scene plays, so a fade can be tried and changed at
// once. o: get() and set(v) the value; text() and tip() what it shows; clear(), if typing nothing goes back to automatic.
// Also a step's play time: o.what names it, o.min, o.max and o.rate (per pixel dragged) bound it, o.input and o.parse
// write and read it as typed
function fadeControl(tile, o) {
  const what = o.what || 'fade time', lo = o.min ?? 0, hi = o.max ?? 60, rate = o.rate ?? 0.05;
  // what it shows: a fade's time has a small triangle before it (.tri, drawn by CSS), a cut or a play time none;
  // o.text may give [true, text] for the triangle
  const label = () => { const t = o.text ? o.text() : o.get() > 0 ? [true, fmtV(Math.round(o.get() * 10) / 10) + ' s'] : 'cut'; return Array.isArray(t) ? t : [false, t]; };
  const paint = () => { const [tri, t] = label(); el.textContent = t; el.classList.toggle('tri', tri); };
  const tip = () => (o.tip ? o.tip() : `Fade in: ${o.get() > 0 ? fmtV(o.get()) + ' s' : 'none, it cuts'}`) + '. Drag sideways to change it (Shift = ×10), click to type, or ↑ ↓.';
  const el = h('span', { class: 'fd' + (o.get() > 0 ? '' : ' cut') + (o.cls ? ' ' + o.cls() : ''), role: 'button', tabindex: 0, title: tip(), 'aria-label': o.name + ' ' + what });
  paint();
  const show = () => { el.className = 'fd' + (o.get() > 0 ? '' : ' cut') + (o.cls ? ' ' + o.cls() : '') + (el.classList.contains('scrub') ? ' scrub' : ''); paint(); el.title = tip(); };
  const set = v => { o.set(clamp(Math.round(v * 10) / 10, lo, hi)); show(); };
  const type = () => {
    let done = false;
    const inp = h('input', { type: 'text', class: 'fdin', value: o.clear && o.auto && o.auto() ? '' : o.input ? o.input() : fmtV(o.get()), placeholder: o.clear ? 'auto' : '', 'aria-label': o.name + ' ' + what,
      title: o.parse ? 'Seconds (90), or minutes:seconds (1:30)' : 'Seconds; 0 cuts' + (o.clear ? '; empty: automatic' : '') });
    const finish = ok => {
      if (done) return; done = true;
      const txt = inp.value.trim().replace(',', '.'), v = o.parse ? o.parse(txt) : parseFloat(txt);
      if (ok && txt === '' && o.clear) { o.clear(); commit(); }
      else if (ok && isFinite(v) && v != null && (clamp(v, lo, hi) !== o.get() || (o.auto && o.auto()))) { set(v); commit(); }
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
      set(v0 + (ev.clientX - x0) * rate * (ev.shiftKey ? 10 : 1));
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
  const edited = live && !sameContents(sc.layers, z.layers);   // other contents: changes to the same ones go in by themselves (keepScenes)
  const inLists = z.playlists.filter(pl => pl.steps.some(st => st.scene === sc.id)).length;
  const tile = h('div', { class: 'scene' + (live ? ' live' : ''), role: 'button', tabindex: 0, draggable: true, 'data-zone': z.id, 'data-id': sc.id,
    title: `${sc.name} · ${sc.layers.length} layer${sc.layers.length === 1 ? '' : 's'} · ${sc.fade > 0 ? 'fades in over ' + fmtV(sc.fade) + ' s' : 'cuts in'}` +
      (inLists ? ` · in ${inLists} playlist${inLists === 1 ? '' : 's'}` : '') + '\nDrag to reorder, or onto a playlist to add it' },
    h('div', { class: 't' }, keys && i < 9 ? h('span', { class: 'k' }, i + 1) : null, h('span', { class: 'nm' }, sc.name),
      sc.onOpen ? h('span', { class: 'au', title: 'Plays when the project opens', html: ICONS.power }) : null,
      h('button', { class: 'x', type: 'button', title: 'Add to playlist, update, rename, delete…', 'aria-label': 'Options for ' + sc.name, onclick: e => { e.stopPropagation(); sceneMenu(e.currentTarget, z, sc); } }, '⋯')),
    h('div', { class: 's' }, null, h('span', { class: 'fill' }),
      edited ? h('button', { class: 'badge warn edited', type: 'button', title: 'Other contents are playing than this scene has. Click to save them into it; recalled without saving, it comes back as it was.',
        onclick: e => { e.stopPropagation(); updateScene(z, sc); } }, 'edited') : null),
    h('i', { class: 'prog' }));
  tile.querySelector('.s').prepend(fadeControl(tile, { name: sc.name, get: () => sc.fade, set: v => { sc.fade = v; } }));
  if (z.tag) tile.style.setProperty('--tag', z.tag);   // its zone's colour, when it has one
  if (sc.tag) tile.style.setProperty('--mark', sc.tag);   // its own, on its mark while it plays
  if (sc.thumb) { tile.classList.add('shot'); tile.style.setProperty('--shot', `url("${sc.thumb}")`); }   // its picture, behind its name
  midiButton(tile, `sc:${z.id}:${sc.id}`);   // a MIDI pad can play it
  tile.querySelector('.t').insertBefore(tile.querySelector(':scope > .ftag'), tile.querySelector('.t > .x'));   // its tag on the top line, before ⋯
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
// The scenes' size where they are (bottom, left, right, the window): small, medium (4 to a row for A and B) or large
const SCENE_SIZES = [['s', 'Small scenes', 5], ['m', 'Medium scenes', 8], ['l', 'Large scenes', 11]];
const sceneSizeAt = place => ({ s: 's', m: 'm', l: 'l' })[(ui.sceneSize || {})[place]] || 'm';
function sceneSizes(place) {
  const now = sceneSizeAt(place);
  return h('div', { class: 'ssize', role: 'group', 'aria-label': 'Size of the scenes' }, SCENE_SIZES.map(([k, name, n]) =>
    h('button', { type: 'button', class: k === now ? 'on' : '', 'data-size': k, 'aria-label': name, 'aria-pressed': String(k === now), title: name,
      html: `<svg viewBox="0 0 14 14" width="14" height="14"><rect x="${(14 - n) / 2}" y="${13 - n}" width="${n}" height="${n}" fill="currentColor"/></svg>`,
      onclick: () => { ui.sceneSize = Object.assign({}, ui.sceneSize, { [place]: k }); savePrefs(); renderDock(); if (scenesWinOpen()) drawScenesWindow(); } })));
}
function renderScenes(body, where = 'dock') {
  const inWindow = where === 'window', place = inWindow ? 'window' : where === 'side' ? placeOf('scenes') : 'bottom';
  // along the bottom: on the left the X-Fader's button (where it stays, on or off) and its mode, its strip in the
  // middle while it is on, the window button on the right
  const X = project.xfade, mode = XF_MODES.find(m => m[0] === X.mode) || XF_MODES[0];
  const foot = h('div', { class: 'sfoot' },
    h('div', { class: 'sleft' },
      h('button', { class: 'btn sm xfbtn' + (X.on ? ' on' : ''), type: 'button', 'aria-pressed': String(X.on),
        title: X.on ? 'X-Fader on: it sets the levels of zones A and B. Click to turn it off.' : 'X-Fader: one fader between two zones, A and B',
        onclick: () => setXfadeOn(!X.on) }, h('i', { class: 'dot' }), 'X-Fader'),
      X.on ? h('button', { class: 'btn sm xfmode', type: 'button', title: mode[2] + '. Click to choose another mode.', 'aria-label': 'X-Fader mode: ' + mode[1], 'aria-haspopup': 'menu',
        onclick: e => menu(e.currentTarget, XF_MODES.map(m => [h('span', { class: 'xfmi' }, xfGraph(m), m[1]), () => setXfadeMode(m[0]), { title: m[2] }])) }, xfGraph(mode), h('span', { class: 'car' }, '▾')) : null),
    X.on ? xfadeStrip() : h('span'),
    h('div', { class: 'sbtns' }, sceneSizes(place), panelPlaces('scenes')));
  const rows = h('div', { class: 'zonerows', 'data-keep': 'zonerows' });
  const sel = selZone();
  // with the X-Fader on, its zones A and B side by side at the top (A on the left, B on the right, as on the fader),
  // each with a one-line head (its level slider the most it reaches) and its scenes in 4 columns; the other zones in
  // rows below
  const xf = xfZones(), pair = [null, null];
  for (const z of project.zones.slice().reverse()) {
    const side = xf ? xf.indexOf(z) : -1;
    const look = lookOf(z.layers);
    const p = z._play, cur = playingList(z), state = cur && p.on ? ' playing' : cur && !p.ended ? ' paused' : '';
    const lists = h('button', { class: 'btn sm icon plbtn' + state + (ui.playlistOpen[z.id] ? ' on' : ''), type: 'button', html: ICONS.playlist,
      title: !z.playlists.length ? `New playlist for ${z.name}…` : (cur ? `${cur.name} is ${p.on ? 'playing' : p.ended ? 'stopped' : 'paused'}. ` : '') + (ui.playlistOpen[z.id] ? 'Fold the playlist' : 'Open the playlist'),
      'aria-label': z.name + ' playlists',
      onclick: e => {
        e.stopPropagation();
        if (!z.playlists.length) { newPlaylistDialog(z); return; }
        if (ui.playlistOpen[z.id]) delete ui.playlistOpen[z.id]; else ui.playlistOpen[z.id] = (cur || z.playlists[0]).id;
        if (ui.zone !== z.id) selectZone(z); else renderDock();
      } });
    // ■: what it plays fades to black
    const stop = () => h('button', { class: 'btn sm icon zstop', type: 'button', disabled: !z.layers.length && !z.scene, 'aria-label': 'Stop ' + z.name,
      title: `Stop ${z.name}: its content fades to black over ${fmtV(project.settings.fade)} s (the fade for new scenes, in Settings)`, html: '<svg viewBox="0 0 12 12" width="10" height="10"><rect x="1" y="1" width="10" height="10" fill="currentColor"/></svg>',
      onclick: e => { e.stopPropagation(); stopZone(z); } });
    const head = side >= 0 ? h('div', { class: 'zhead compact' + (z === sel ? ' sel' : ''), title: `${z.name}: click to select. Its slider is the most it reaches; the X-Fader mixes within it.`, onclick: () => selectZone(z) },
      h('div', { class: 'zt' }, zoneTag(z), h('span', { class: 'xftag' }, side ? 'B' : 'A'), h('span', { class: 'nm' }, z.name),
        zoneOpacityInput(z, 110), h('span', { class: 'mono muted', 'data-zone-pct': z.id }, pct(z.opacity)), lists, stop(),
        h('button', { class: 'btn sm', type: 'button', title: `Store ${z.name}'s current layers as a new scene`, onclick: e => { e.stopPropagation(); storeScene(z); } }, '+ Store')))
    : h('div', { class: 'zhead' + (z === sel ? ' sel' : ''), title: `${z.name}: click to select. The slider is the zone's opacity, its master.`, onclick: () => selectZone(z) },
      h('div', { class: 'zt' }, zoneTag(z), h('span', { class: 'nm' }, z.name),
        xfDriven(z) ? h('span', { class: 'xftag', title: 'On the X-Fader: it mixes within this level' }, z.id === project.xfade.a ? 'A' : 'B') : null,
        h('span', { class: 'mono muted', 'data-zone-pct': z.id }, pct(z.opacity)), lists, stop()),
      h('div', { class: 'zc' }, zoneOpacityInput(z, 80),
        h('button', { class: 'btn sm', type: 'button', title: `Store ${z.name}'s current layers as a new scene`, onclick: e => { e.stopPropagation(); storeScene(z); } }, '+ Store')));
    // the zone's head stays put; its scenes scroll sideways beside it
    const tiles = h('div', { class: 'stiles' });
    // beside the stage they wrap in a grid instead
    const wrap = where === 'side' && side < 0;
    const r = h('div', { class: 'scenerow' + (z === sel ? ' sel' : '') + (side >= 0 ? ' xfcol' : '') + (wrap ? ' wrap' : '') }, head, side >= 0 || wrap ? tiles : hscroller(tiles, 'scenes:' + z.id));
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
    z.scenes.forEach((sc, i) => tiles.append(sceneTile(z, sc, i, z === sel, look)));
    if (!z.scenes.length) tiles.append(h('span', { class: 'rowhint' }, `No scenes yet. Set up ${z.name}'s layers in the Content tab, then + Store.`));
    const block = h('div', { class: 'zoneblock' + (z === sel ? ' sel' : ''), 'data-zone': z.id }, r, playlistArea(z));
    if (side >= 0) pair[side] = block; else rows.append(block);
  }
  if (xf) rows.prepend(h('div', { class: 'xfpair' }, pair[0], pair[1]));
  if (!project.zones.length) rows.append(h('div', { class: 'empty' }, 'No zones yet.'));
  body.append(h('div', { class: 'scenepanel ss-' + sceneSizeAt(place) }, rows, foot));
}
// The crossfader, while it is on: A's preview and zone, the fader, B's zone and preview
function xfadeStrip() {
  const X = project.xfade, zs = project.zones.slice().reverse();
  const side = which => {
    const z = zoneById(X[which]), L = which.toUpperCase();
    const pick = h('select', { class: 'xfsel', 'aria-label': 'Zone ' + L, title: `Zone ${L}: the X-Fader sets its level`, onchange: e => setXfadeZone(which, e.target.value) },
      z ? null : h('option', { value: '', selected: true, disabled: true }, 'Choose a zone'),
      zs.map(o => h('option', { value: o.id, selected: o === z }, o.name)));
    const c = h('canvas', { 'data-xf-pv': which });
    if (z) xfPvSize(c, z);
    return h('div', { class: 'xfside ' + which },
      h('div', { class: 'xfpv', title: z ? z.name : '' }, c, h('b', null, L)),
      h('div', { class: 'xfwho' }, pick, z ? h('span', { class: 'mono muted', 'data-zone-eff': z.id, title: 'The level it shows: its own × the X-Fader' }, pct(zoneLevel(z))) : null));
  };
  const r = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: X.x, 'data-xf': '', 'aria-label': 'X-Fader', title: 'X-Fader: A on the left, B on the right' });
  r.addEventListener('input', () => setXfade(parseFloat(r.value), r));
  // the step of undo (the whole project copied, saved, sent to the devices) waits for a quiet moment after the fader stops
  r.addEventListener('change', () => (window.requestIdleCallback ? requestIdleCallback(() => commitSoft(), { timeout: 1000 }) : commitSoft()));
  return h('div', { class: 'xfade' }, side('a'),
    h('div', { class: 'xfmid' }, h('span', { class: 'xfend' }, 'A'), midiSlot(r, 'xf'), h('span', { class: 'xfend' }, 'B')),
    side('b'));
}
// A mode's small graph: A's level and B's, from the fader's left to its right
const xfGraph = m => h('span', { class: 'xfg', html: `<svg viewBox="0 0 22 15" aria-hidden="true"><path class="b" d="${m[4]}"/><path d="${m[3]}"/></svg>` });
// A preview: the zone's shape within 80 × 45 on screen, its frame around it exactly; twice the pixels on a sharp
// screen
function xfPvSize(c, z) {
  const k = Math.min(80 / z.w, 45 / z.h), w = Math.max(1, Math.round(z.w * k)), hh = Math.max(1, Math.round(z.h * k));
  const d = (c.ownerDocument.defaultView || window).devicePixelRatio > 1 ? 2 : 1;
  if (c.width !== w * d || c.height !== hh * d) { c.width = w * d; c.height = hh * d; }
  if (c.style.width !== w + 'px' || c.style.height !== hh + 'px') { c.style.width = w + 'px'; c.style.height = hh + 'px'; }
}
// The previews of A and B, on the view frames (viewEvery), as the stage and the other previews
let xfShownFrame = -1;
function drawXfPreviews(force) {
  if (!mixer.ok || (!force && (frameIndex === xfShownFrame || !viewFrame()))) return;
  xfShownFrame = frameIndex;
  for (const c of scenesRoots().flatMap(r => $$('canvas[data-xf-pv]', r))) {
    const z = zoneById(project.xfade[c.dataset.xfPv]);
    if (!z) continue;
    xfPvSize(c, z);
    mixer.thumb(z, c);
  }
  mixer.forgetGone();
}
function drawSceneProgress() {
  for (const el of scenesRoots().flatMap(r => $$('.scene', r))) {
    const z = zoneById(el.dataset.zone), f = z && z._fade;
    const w = f && f.scene === el.dataset.id ? (clamp((clockT - f.start) / f.dur, 0, 1) * 100).toFixed(1) + '%' : '0px';
    if (el.lastChild.style.width !== w) el.lastChild.style.width = w;
  }
  drawPlaylistProgress();
}

/* ---------- patch ---------- */
function ctrlSummary(c) {
  const outs = c._outs || [];
  // universes counted once each: in Pixels mode, two outputs can share the one where the first ends
  const span = new Set();
  for (const o of outs.length ? outs : ctrlOuts(c)) if (o) for (let u = 0; u < o.upo; u++) span.add(o.base + u);
  const used = universes.filter(U => U.ctrl === c).length;
  const px = outs.reduce((a, o) => a + (o ? o.pixels : 0), 0);
  const ovf = outs.reduce((a, o) => a + (o ? o.overflow : 0), 0);
  return { used, px, ovf, cap: span.size };
}
// The controllers selected in the Patch list: the one shown (ui.selCtrl), and others added with Ctrl or Shift
const selCtrls = () => project.controllers.filter(c => c.id === ui.selCtrl || (ui.selCtrls && ui.selCtrls.has(c.id)));
function pickCtrl(c, e) {
  const all = project.controllers, set = ui.selCtrls || (ui.selCtrls = new Set());
  const anchor = ctrlById(ui.selCtrl);
  if (e.shiftKey && anchor) {
    const [a, b] = [all.indexOf(anchor), all.indexOf(c)].sort((x, y) => x - y);
    all.slice(a, b + 1).forEach(x => set.add(x.id));
  } else if (e.ctrlKey || e.metaKey) {
    if (set.has(c.id) || c.id === ui.selCtrl) { set.delete(c.id); if (c.id === ui.selCtrl) { ui.selCtrl = [...set][0] || null; renderDock(); return; } }
    else { if (anchor) set.add(anchor.id); set.add(c.id); }
  } else set.clear();
  ui.selCtrl = c.id;
  renderDock();
  const it = $(`#dockBody .ctrl[data-id="${CSS.escape(c.id)}"]`); if (it) it.focus();
}
function renderPatch(body) {
  ensurePatch();
  if (!ui.selCtrl || !ctrlById(ui.selCtrl)) ui.selCtrl = project.controllers[0] ? project.controllers[0].id : null;
  const chosen = new Set(selCtrls().map(c => c.id));
  const items = h('div', { class: 'items' });
  for (const c of project.controllers) {
    const s = ctrlSummary(c);
    const ipOk = !!parseIP(c.ip);
    // a badge only when something is wrong; a controller that is off shows dimmed
    const badge = !ipOk ? h('span', { class: 'badge err' }, 'IP?') : s.ovf ? h('span', { class: 'badge err' }, 'OVERFLOW') : null;
    const item = h('div', { class: 'ctrl' + (chosen.has(c.id) ? ' sel' : '') + (c.enabled ? '' : ' off'), tabindex: 0, 'data-id': c.id, onclick: e => pickCtrl(c, e),
      title: `${c.name} · ${protoName(c)}\nCtrl or Shift to select several; Delete removes them` },
      h('div', { class: 't' }, h('span', { class: 'badge' }, ctrlLetter(c)), h('span', { class: 'nm' }, c.name), badge),
      h('div', { class: 's mono' }, h('span', null, c.ip + ' · ' + protoName(c))));
    onRightClick(item, e => controllerMenu(e, c));
    items.append(item);
  }
  if (!project.controllers.length) items.append(h('div', { class: 'empty' }, 'No controllers yet.'));
  // Delete (or Backspace) on the list removes the selected controllers, after asking
  items.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mappingLocked()) { e.preventDefault(); e.stopPropagation(); askDeleteControllers(selCtrls()); }
  });
  const list = h('div', { class: 'ctrl-list' }, items, h('div', { class: 'foot' },
    h('button', { class: 'btn sm', type: 'button', onclick: () => { const c = newController(); project.controllers.push(c); ui.selCtrl = c.id; ui.selCtrls = new Set(); markPatch(); commit(); renderRight(); } }, '+ Controller'),
    REMOTE_CLIENT ? null : h('button', { class: 'btn sm', type: 'button', title: 'Find the Art-Net and sACN devices on the network', onclick: openDiscovery }, 'Discovery…')));
  const c = ctrlById(ui.selCtrl);
  const edit = h('div', { class: 'ctrl-edit' });
  if (c) renderCtrlEditor(edit, c);
  else edit.append(h('div', { class: 'empty' }, 'Add a controller for each Art-Net or sACN device your LEDs are wired to.'));
  body.append(h('div', { class: 'patch' }, list, edit));
}
function renderCtrlEditor(edit, c) {
  const f = (label, el, title) => h('label', { class: 'f', title }, h('span', null, label), el);
  const small = (el, w) => { el.style.width = w + 'px'; return el; };
  const ipIn = textInput(c, 'ip', { aria: 'IP address', onInput: (v, el) => { el.classList.toggle('bad', !parseIP(v)); markPatch(); }, onCommit: () => { commit(); } });
  ipIn.classList.toggle('bad', !parseIP(c.ip));
  // Delete asks first, so a stray click can't remove a controller and its patch
  const del = h('button', { class: 'btn icon trash', type: 'button', title: 'Delete this controller', 'aria-label': 'Delete controller ' + c.name, onclick: () => askDeleteControllers([c]) }, icon('trash'));
  const onStruct = () => {
    const before = c.chains.flat().length;
    ensureChains(c);
    const lost = before - c.chains.flat().length;
    if (lost > 0) toast(`${lost} fixture${lost > 1 ? 's' : ''} unpatched because the output was removed`, 'warn');
    markPatch(); commit();
  };
  // Output on or off: a switch, as it is a state rather than a setting
  const en = h('button', { class: 'onsw' + (c.enabled ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(!!c.enabled),
    title: c.enabled ? `This controller gets ${protoName(c)}. Click to stop sending to it.` : 'Nothing is sent to this controller. Click to send to it again.',
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
  const ddp = isDdp(c);
  edit.append(h('div', { class: 'ctrl-fields' },
    f('Output', en),
    f('Name', small(textInput(c, 'name', { aria: 'Controller name', onInput: () => {}, onCommit: () => { commit(); renderRight(); } }), 150)),
    f('IP address', small(ipIn, 120)),
    f('Protocol', seg([['artnet', 'Art-Net'], ['sacn', 'sACN'], ['ddp', 'DDP']], c.protocol, v => { c.protocol = v; ensureChains(c); markPatch(); commit(); }),
      'What this controller receives. sACN counts universes from 1. DDP has no universes: the pixels are one run of channels from 1, none skipped.'),
    f('Outputs', small(numInput(c, 'outputs', { int: true, min: 1, max: 128, aria: 'Outputs', onCommit: onStruct }), 64)),
    ddp ? null : f('Per output', seg([['universes', 'Universes'], ['pixels', 'Pixels']], c.mode, v => { c.mode = v; markPatch(); commit(); }),
      'Size each output by a number of universes, or by its pixels: nouPix works out the universes they need'),
    c.mode === 'pixels'
      ? f('Pixels', small(numInput(c, 'pxOut', { int: true, min: 1, max: 10000, aria: 'Pixels per output', onCommit: onStruct }), 72), 'Pixels per output')
      : f('Universes', small(numInput(c, 'upo', { int: true, min: 1, max: 64, aria: 'Universes per output', onCommit: onStruct }), 64), 'Universes per output'),
    c.mode === 'pixels' ? f('Pixel', selectEl(CH_PER_PX.map(n => [n, { 1: 'Mono · 1 ch', 3: 'RGB · 3 ch', 4: 'RGBW · 4 ch', 6: 'RGB 16-bit · 6 ch', 8: 'RGBW 16-bit · 8 ch' }[n]]), c.chPx,
      v => { c.chPx = +v; markPatch(); commit(); }, { aria: 'Channels per pixel' }), 'The pixels the controller drives: how many channels each takes') : null,
    // with sACN the first universe is typed and shown as sACN counts it, from 1 (kept from 0 inside, as Art-Net counts)
    ddp ? null : f('Start uni', small(isSacn(c)
      ? numInput({ get v() { return c.startUniverse + 1; }, set v(x) { c.startUniverse = x - 1; } }, 'v', { int: true, min: 1, max: 32768, aria: 'Start universe', onCommit: onStruct })
      : numInput(c, 'startUniverse', { int: true, min: 0, max: 32767, aria: 'Start universe', onCommit: onStruct }), 64), 'The universe output 1 starts on; each next output starts on a new universe'),
    f('Start ch', small(numInput(c, 'startCh', { int: true, min: 1, max: 512, aria: 'Start channel', onCommit: onStruct }), 56),
      ddp ? 'The channel output 1 starts at, counted from 1; each next output goes on from where the one before it ends' : 'The channel output 1 starts at; the next outputs start at channel 1'),
    !ddp && c.discovered && c.discovered.length ? f('ArtPoll', h('span', { class: 'reported' }, 'U ' + universeList(c.discovered)),
      `Universes this device reported when discovered (${c.discovered.length}). Set the outputs to how the device is set up.`) : null,
    ddp ? null : h('div', { class: 'skiprow' }, h('label', { class: 'checkrow', for: 'ctrlSkip' }, skip, 'Skip ch 511–512'),
      h('span', { class: 'info', tabindex: 0, role: 'img', 'aria-label': SKIP_INFO, title: SKIP_INFO }, 'i')),
    ddp && bridge.hello && !bridgeDdp() ? h('span', { class: 'note warn' }, 'This version of the bridge does not send DDP.') : null,
    h('span', { style: { flex: 1 } }), del));
  if (patchConflicts.length) edit.append(h('div', { class: 'conflict' }, (usesDdp() ? 'Clash: ' : 'Universe clash: ') + patchConflicts[0] + (patchConflicts.length > 1 ? ` (+${patchConflicts.length - 1} more)` : '')));
  const folds = ui.foldOuts || (ui.foldOuts = new Set());
  const foldAll = shut => { c.chains.forEach((_, o) => { const k = c.id + ':' + o; shut ? folds.add(k) : folds.delete(k); }); renderDock(); };
  edit.append(h('div', { class: 'outbar' },
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn sm', type: 'button', onclick: () => foldAll(true) }, 'Fold all'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => foldAll(false) }, 'Unfold all')));
  const outs = h('div', { class: 'outs' });
  c.chains.forEach((chain, o) => {
    const info = (c._outs && c._outs[o]) || Object.assign({ pixels: 0, overflow: 0, ch: 0 }, ctrlOuts(c)[o]);
    const usedU = Math.ceil(info.ch / 512), key = c.id + ':' + o, n = chain.filter(fxById).length;
    // how full it is: its pixels in Pixels mode, else its channels
    const pct = Math.min(100, info.px ? info.pixels / info.px * 100 : info.ch / (info.upo * 512) * 100);
    const usage = h('div', { class: 'usage' + (info.overflow ? ' ovf' : pct > 92 ? ' full' : '') },
      h('div', { class: 'bar' }, h('i', { style: { width: (info.overflow ? 100 : pct) + '%' } })),
      h('div', { class: 'lbl' }, h('span', null, info.px ? `${fmtN(info.pixels)}/${fmtN(info.px)} px` : `${fmtN(info.pixels)} px`), h('span', null, info.overflow ? `${info.overflow} px over` : ddp ? `${fmtN(info.ch - info.start)} ch` : `${usedU}/${info.upo} U`)));
    const head = h('div', { class: 'outhead', title: 'Click to fold or unfold. Drop fixtures here to add them at the end.' },
      h('span', { class: 'fold' }, folds.has(key) ? '▸' : '▾'),
      h('span', { class: 'on' }, 'OUT ' + (o + 1)),
      outSpan(c, info),
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
        ad = ddp ? `ch ${a.u * 512 + a.ch}–${b.u * 512 + b.ch}` : a.u === b.u ? `U${uniLabel(a.u, c)} · ch ${a.ch}–${b.ch}` : `U${uniLabel(a.u, c)}.${a.ch} – U${uniLabel(b.u, c)}.${b.ch}`;
      }
      if (p && p.overflow) ad = p.first >= 0 ? `${ad} · ${p.overflow} px over` : `${p.overflow} px don't fit`;
      const mv = (txt, d, off, label) => h('button', { type: 'button', disabled: off, title: label, 'aria-label': `${label}: ${fx.name}`, onclick: e => { e.stopPropagation(); moveOnOutput([fid], d); } }, txt);
      const row = h('div', { class: 'prow' + (ui.sel.has(fid) ? ' sel' : '') + (p && p.overflow ? ' ovf' : ''), draggable: true, 'data-id': fid, 'data-name': fx.name.toLowerCase(),
        title: `${fx.name} · ${pixelCount(fx)} px ${fx.order}${p && p.first >= 0 ? '\n' + addrText(p) : ''}${p && p.overflow ? `\n${p.overflow} pixels overflow` : ''}\n↑ ↓ or Alt ↑ ↓ move it on the output; drag to reorder` },
        h('span', { class: 'pgrip', 'aria-hidden': 'true' }), h('span', { class: 'ix' }, k + 1), h('span', { class: 'tag', style: { background: fxTag(fx) || 'transparent' } }), h('span', { class: 'nm' }, fx.name),
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

/* ---------- nodes ---------- */
// The networks of this computer that discovery uses: all of them, except the ones turned off in the Discovery window
// (kept per computer, by address)
const ipNum = ip => ip.split('.').reduce((a, b) => a * 256 + (+b), 0);
const netOf = (ip, nets) => nets.find(n => Math.floor(ipNum(ip) / 2 ** (32 - n.prefix)) === Math.floor(ipNum(n.ip) / 2 ** (32 - n.prefix)));
const scanNets = () => ((bridge.hello && bridge.hello.nets) || []).filter(n => !(ui.scanOff || []).includes(n.ip));
function discover() {
  const nets = (bridge.hello && bridge.hello.nets) || [], ifaces = scanNets().map(n => n.ip);
  if (nets.length && !ifaces.length) { toast('Tick a network to scan.', 'warn'); return; }
  bridgeSend(nets.length ? { t: 'poll', ifaces } : { t: 'poll' });
}
/* ---------- discovery: the devices found on the network, in a window ---------- */
let discoveryEl = null;
function openDiscovery() {
  if (discoveryEl && discoveryEl.isConnected) return;
  const close = () => { bg.remove(); discoveryEl = null; };
  const body = h('div', { class: 'mb nodes' });
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal xwide', role: 'dialog', 'aria-label': 'Discovery' },
      h('header', null, 'Discovery'), body,
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Done'))));
  discoveryEl = body;
  uiDocNow().body.append(bg);
  updateDiscoveryUI();
  if (bridge.connected && !bridge.nodes.size) discover();   // a first look at once
}
// Drawn again when a device answers, or the networks change
function updateDiscoveryUI() {
  if (discoveryEl && discoveryEl.isConnected) renderNodes(discoveryEl);
}
function renderNodes(body) {
  const hello = bridge.hello, nets = (hello && hello.nets) || [], off = new Set(ui.scanOff || []), want = ui.discFilter || 'both';
  const chip = n => h('label', { class: 'netchip' + (off.has(n.ip) ? '' : ' on'),
    title: `${n.name ? n.name + '\n' : ''}${n.ip} / ${n.mask}\nArtPoll goes to ${n.broadcast}${n.guessed ? '\n(mask guessed: the system did not say)' : ''}` },
    h('input', { type: 'checkbox', checked: !off.has(n.ip), onchange: e => {
      ui.scanOff = e.target.checked ? (ui.scanOff || []).filter(ip => ip !== n.ip) : [...(ui.scanOff || []), n.ip];
      savePrefs(); updateDiscoveryUI(); } }),
    n.name ? h('span', { class: 'nn' }, n.name) : null, h('span', { class: 'mono' }, `${n.ip}/${n.prefix}`));
  // only when something stops it working: not connected, or the Art-Net port taken
  const trouble = !bridge.connected ? 'Discovery needs nouPix running on this computer (the app, or noupix.py).'
    : hello && !hello.discovery ? 'Discovery is off: ' + (hello.discoveryNote || 'UDP 6454 is in use') : '';
  const bar = h('div', { class: 'bar' },
    h('button', { class: 'btn primary', type: 'button', disabled: !bridge.connected, onclick: discover }, 'Discover'),
    nets.length ? h('span', null, 'on') : null, ...nets.map(chip),
    h('span', { class: 'fill' }),
    seg([['both', 'All'], ['artnet', 'Art-Net'], ['sacn', 'sACN'], ['ddp', 'DDP']], want, v => { ui.discFilter = v; savePrefs(); updateDiscoveryUI(); }));
  // Devices on a network turned off for scans, or of the other protocol, are left out
  const all = nodeDevices().filter(n => { const k = netOf(n.ip, nets); return !k || !off.has(k.ip); });
  const protoOf = n => (n.ddp ? 'ddp' : n.sacn ? 'sacn' : 'artnet'), wantName = { artnet: 'Art-Net', sacn: 'sACN', ddp: 'DDP' }[want];
  const nodes = all.filter(n => want === 'both' || protoOf(n) === want);
  const scroll = h('div', { class: 'scroll' });
  if (trouble) scroll.append(h('p', { class: 'note warn', style: { padding: '6px 12px' } }, trouble));
  if (!nodes.length) { if (!trouble) scroll.append(h('div', { class: 'empty' }, all.length ? `No ${wantName} devices found (${all.length} on the others).` : 'No devices found yet: press Discover.')); }
  else {
    scroll.append(h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['IP', 'Name', 'Network', 'Protocol', [h('span', { class: 'pname' }, 'Art-Net'), ' universes'], 'MAC', 'Status', ''].map(t => h('th', null, ...[].concat(t))))),   // ArtPoll tells the universes, not the outputs
      h('tbody', null, nodes.map(n => {
        const known = project.controllers.find(c => c.ip === n.ip);
        return withRightClick(h('tr', null,
          h('td', { class: 'mono' }, n.ip),
          h('td', null, h('div', null, n.shortName || '—'), h('div', { class: 'muted', style: { fontSize: '11px' } }, n.longName)),
          h('td', { class: 'mono muted' }, (k => k ? k.name || k.ip : '—')(netOf(n.ip, nets))),
          h('td', null, h('span', { class: 'badge' }, n.ddp ? 'DDP' : n.sacn ? 'sACN' : 'Art-Net'),
            n.canSwitch ? h('span', { class: 'muted', style: { fontSize: '11px', marginLeft: '6px' }, title: 'The device can be set to Art-Net or sACN in its own settings' }, 'can switch') : null),
          h('td', { class: 'mono' }, n.universes.length ? n.universes.join(', ') : '—'),
          h('td', { class: 'mono' }, n.mac || '—'),
          h('td', { class: 'muted', style: { fontSize: '11px', maxWidth: '260px' } }, n.report || ''),
          h('td', null, h('button', { class: 'btn sm', type: 'button', title: known ? `Refresh ${known.name} from what the device reports` : `Add it as a controller on ${n.ddp ? 'DDP' : n.sacn ? 'sACN' : 'Art-Net'}`,
            onclick: () => addNodeAsController(n) }, known ? 'Refresh' : 'Add as controller'))), e => nodeMenu(e, n));
      }))));
  }
  const hidden = all.length - nodes.length;
  if (nodes.length && hidden) scroll.append(h('p', { class: 'note', style: { padding: '6px 12px' } }, `${hidden} more on other protocols.`));
  body.replaceChildren(bar, scroll);
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
    // a WLED found by mDNS (bind index −1) knows its settings exactly: its protocol wins over an ArtPoll reply's
    const wled = (list.find(n => n.wled) || {}).wled || null;
    return { ip, replies: list.length, universes, shortName: pick(list, 'shortName'), longName: pick(list, 'longName'), mac: pick(list, 'mac'), report: pick(list, 'report'),
      sacn: wled ? wled.proto === 'sacn' : list.some(n => n.sacn), ddp: !!wled && wled.proto === 'ddp', canSwitch: list.some(n => n.canSwitch), wled };
  }).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}
// ArtPoll says which universes a device listens on, not how they are split over its physical outputs (2 outputs
// of 3 universes, 3 of 2…): only the operator knows. So a device becomes a controller with its IP, its name and
// the universes it reported, kept as a reminder in the Patch tab; one output from its first universe is just a
// starting point. Adding a device that is already a controller only refreshes that reminder.
function addNodeAsController(n) {
  const u = n.universes, proto = n.sacn ? 'sacn' : 'artnet';
  const same = project.controllers.find(c => c.ip === n.ip);
  if (n.wled) return addWledAsController(n, same);
  if (same) {
    if (!isDdp(same)) same.protocol = proto;   // a device set to DDP by hand (Advatek, Falcon…) stays on DDP: ArtPoll can't tell
    if (u.length) same.discovered = u.slice();
    ui.selCtrl = same.id; ui.dockTab = 'patch';
    markPatch(); commit(); updateDiscoveryUI();
    toast(`${same.name}: ${protoName(same)}` + (u.length ? `, reporting ${u.length} universe${u.length === 1 ? '' : 's'} (${universeList(u)}).` : '.') + ' Its outputs are as you set them.');
    return;
  }
  // ArtPoll's universes are a starting point: one output from the first; a device that reports none (one set to
  // sACN often doesn't) starts with one output of one universe. Either way, set it as the device is set up.
  const c = newController({ name: n.shortName || n.ip, ip: n.ip, protocol: proto, outputs: 1, upo: u.length ? Math.min(u[u.length - 1] - u[0] + 1, 64) : 1, startUniverse: u.length ? u[0] : 0 });
  if (u.length) c.discovered = u.slice();
  project.controllers.push(c);
  ui.selCtrl = c.id; ui.selCtrls = new Set(); ui.dockTab = 'patch';
  markPatch(); commit(); updateDiscoveryUI();   // its row now offers Refresh
  toast(`Added ${c.name} on ${protoName(c)}. Set its outputs to match how the device is set up.`);
}
// A WLED tells exactly how it receives (its JSON API): one output of its LEDs, by pixels, from its universe and
// address, whole pixels per universe as WLED expects; refreshing a known one sets all that again
function addWledAsController(n, same) {
  const w = n.wled;
  const set = w.proto === 'ddp' ? { protocol: 'ddp', mode: 'pixels', outputs: 1, pxOut: Math.max(1, w.leds), chPx: w.chPx, startUniverse: 0, startCh: 1, split: true }
    : { protocol: w.proto, mode: 'pixels', outputs: 1, pxOut: Math.max(1, w.leds), chPx: w.chPx, startUniverse: w.universe, startCh: w.address, split: false };
  let c = same;
  if (c) Object.assign(c, set);
  else { c = newController(Object.assign({ name: n.shortName || n.ip, ip: n.ip }, set)); project.controllers.push(c); }
  ensureChains(c);
  if (n.universes.length) c.discovered = n.universes.slice();
  ui.selCtrl = c.id; ui.selCtrls = new Set(); ui.dockTab = 'patch';
  markPatch(); commit(); updateDiscoveryUI();
  const warn = !w.receiving ? ' Its receiving is off: turn it on in WLED.' : !w.pixels ? " Set WLED's DMX mode to Multi RGB (or RGBW)." : '';
  toast(`${same ? 'Refreshed' : 'Added'} ${c.name}: WLED on ${protoName(c)}, ${w.leds} LEDs` + (w.proto === 'ddp' ? '.' : ` from universe ${uniLabel(w.universe, c)}, channel ${w.address}.`) + warn, warn ? 'warn' : undefined);
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

// Where an output starts and ends: universe and channel of its first and last channel, on two short lines
function outSpan(c, L) {
  const a = addrOf(L.base, L.start), b = addrOf(L.base, Math.max(L.start, (L.end ?? L.upo * 512) - 1));
  if (isDdp(c)) {
    const x = a.u * 512 + a.ch, y = b.u * 512 + b.ch;
    return h('span', { class: 'ur', title: `Channels ${x} to ${y} of what ${c.name} receives over DDP` }, h('span', { class: 'from' }, h('b', null, 'DDP'), ' ch ' + x), h('span', { class: 'to' }, ' ch ' + y));
  }
  const at = (x, cls) => h('span', { class: cls }, h('b', null, 'U ' + uniLabel(x.u, c)), ' ch ' + x.ch);
  return h('span', { class: 'ur', title: `Starts at universe ${uniLabel(a.u, c)}, channel ${a.ch}\nEnds at universe ${uniLabel(b.u, c)}, channel ${b.ch}` },
    at(a, 'from'), at(b, 'to'));
}

/* ---------- Channel monitor ---------- */
// Its own window, like the MIDI window (the Channel monitor button at the right of the Patch tab): this page draws into it,
// so it can sit on another screen while the work goes on here
let monCanvas = null, monMap = null, monMapKey = '', monEl = null, monWin = null;
const monWinOpen = () => !!(monWin && !monWin.closed);
function openMonitor() {
  if (monWinOpen()) { raiseWindow(monWin); return; }
  const w = window.open('', 'olm-monitor', 'popup,width=1000,height=480');
  if (!w) { toast('The Channel monitor could not open: allow pop-up windows for this page.', 'err'); return; }
  monWin = w;
  const d = dressWindow(w, 'Channel monitor · nouPix', 'monwin');
  w.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); } });
  w.addEventListener('pagehide', () => { if (monWin === w) monClosed(); });
  monEl = d.body;
  $('#btnMon').classList.add('on');
  updateMonitorUI();
}
function monClosed() { monWin = null; monEl = null; monCanvas = null; $('#btnMon').classList.remove('on'); }
// It doesn't outlive this page; a window closed by its own button is noticed. While this page is hidden (no animation
// frames), the values are drawn by a timer.
addEventListener('pagehide', () => { if (monWinOpen()) monWin.close(); });
setInterval(() => {
  if (monWin && monWin.closed) monClosed();
  else if (monCanvas && document.hidden) drawMonitor(performance.now());
}, 100);
function updateMonitorUI() { if (monWinOpen() && monEl) renderMonitor(monEl); }
function renderMonitor(body) {
  ensurePatch();
  if (!universes.find(u => u.key === ui.monitorKey)) ui.monitorKey = universes[0] ? universes[0].key : null;
  const ul = h('div', { class: 'ulist' }, universes.length ? universes.map(u => h('div', { class: u.key === ui.monitorKey ? 'sel' : '', onclick: () => { ui.monitorKey = u.key; updateMonitorUI(); } },
    h('span', null, u.ddp ? `${u.ip} · DDP ch ${u.uni * 512 + 1}–${u.uni * 512 + u.used}` : `${u.mcast ? 'sACN' : u.ip} · U ${uniLabel(u.uni, u.ctrl)}`), h('span', { class: 'muted' }, u.used + ' ch'))) : h('div', { class: 'empty', style: { fontFamily: 'var(--ui)', cursor: 'default' } }, 'No universes yet. Patch fixtures to a controller.'));
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
    // on DDP the channel as the controller counts it: its place in the whole run, not on this page of 512
    read.textContent = `ch ${(U.ddp ? U.uni * 512 : 0) + ch + 1} = ${U.data[ch]}` + (m ? ` · ${m.f.name} · pixel ${m.i + 1} · ${m.c}${m.coarse ? ' coarse' : m.fine ? ' fine' : ''}` : ' · unused');
  });
  const U = universes.find(u => u.key === ui.monitorKey);
  // DDP has no universes: a page of 512 channels of the controller's run
  const where = !U ? '' : U.ddp ? `${U.ip} · DDP · channels ${U.uni * 512 + 1}–${U.uni * 512 + 512} of what it receives`
    : U.sacn
    ? `${U.mcast ? 'multicast ' + sacnGroup(U.uni + 1) : U.ip} · sACN universe ${U.uni + 1}`
    : `${U.ip} · universe ${U.uni} (net ${U.uni >> 8}, subnet ${(U.uni >> 4) & 15}, universe ${U.uni & 15})`;
  const bar = h('div', { class: 'bar' }, U ? h('span', { class: 'mono' }, `${where} · ${U.ctrl.name} OUT ${U.out + 1}`) : h('span', null, 'The values being sent, channel by channel'),
    U && !U.enabled ? h('span', { class: 'badge warn' }, 'not sent: controller off or IP invalid') : null,
    h('span', { class: 'muted' }, ui.outputOn ? '' : 'Output is off; values shown are what would be sent.'));
  body.replaceChildren(h('div', { class: 'monitor' }, bar, h('div', { class: 'mbody' }, ul, h('div', { class: 'grid' }, monCanvas, read))));
  monLast = 0;
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
  const cs = getComputedStyle(document.documentElement);
  c.fillStyle = cs.getPropertyValue('--bg0').trim(); c.fillRect(0, 0, monCanvas.width, monCanvas.height);
  if (!U) return;
  const map = monitorMap(U);
  c.font = '9px ' + (FONT_MONO || 'monospace'); c.textAlign = 'center'; c.textBaseline = 'middle';
  const tint = { R: [255, 80, 90], G: [70, 224, 140], B: [80, 150, 255], W: [235, 235, 235] };
  for (let ch = 0; ch < 512; ch++) {
    const x = (ch % 32) * cw, y = Math.floor(ch / 32) * chh, v = U.data[ch], m = map[ch];
    if (!m) { c.fillStyle = cs.getPropertyValue('--bg3').trim(); c.fillRect(x + 1, y + 1, cw - 2, chh - 2); continue; }
    const t = tint[m.c] || tint.W, k = 0.12 + 0.88 * v / 255;
    c.fillStyle = `rgb(${t[0] * k | 0},${t[1] * k | 0},${t[2] * k | 0})`;
    c.fillRect(x + 1, y + 1, cw - 2, chh - 2);
    c.fillStyle = v > 150 ? '#000000' : '#dce1e6';   // on the channel's own colour, the same in either look
    c.fillText(String(v), x + cw / 2, y + chh / 2 + 0.5);
  }
}
