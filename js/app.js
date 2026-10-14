// openLedMapper · js/app.js
// The app: top bar and status bar, wiring buttons and keys (initUI, onKey), the frame loop, boot, and window.olm,
// the handle the browser console and the tests use. Loaded last; boot() runs at its end.

/* ---------- top bar + status ---------- */
function updateHighlightUI() {
  const on = ui.outputMode !== 'content', m = HL_MODES.find(x => x[0] === ui.hlMode) || HL_MODES[0];
  $('#hl').classList.toggle('on', on);
  $('#btnHl').replaceChildren(icon('bulb'), h('span', null, on ? m[1] : 'Highlight'));
  $('#btnHl').title = on ? `Highlight on: ${m[1]} (${m[2]}). Click or press I to go back to the content.` : `Highlight with ${m[1]}: ${m[2]} (I)`;
  $('#btnHl').setAttribute('aria-pressed', String(on));
}
// The version comes from the bridge (VERSION in openledmapper.py), so the page always shows the one it runs with
function showVersion(v) {
  $('#appVer').textContent = v ? 'v' + v : '';
  $('.brand').title = v ? 'openLedMapper ' + v : 'openLedMapper';
}
function updateUndoButtons() { $('#btnUndo').disabled = hist.idx <= 0; $('#btnRedo').disabled = hist.idx >= hist.stack.length - 1; }
// The status pill only shows what matters: Art-Net going out, or something wrong. With everything fine and
// Art-Net off it is hidden.
function updateBridgeUI() {
  const pill = $('#bridgePill'), txt = $('#bridgeText');
  pill.className = 'pill';
  const st = bridge.stats, hl = bridge.hello;
  const from = hl ? `Sending from ${hl.bindIp === '0.0.0.0' ? 'all network cards' : hl.bindIp}, port ${hl.bindPort}${hl.discovery ? '' : ' · node discovery off: ' + (hl.discoveryNote || '')}` : '';
  let show = true;
  if (bridge.state === 'none') { pill.classList.add('warn'); txt.textContent = 'Preview only'; pill.title = 'This page can\'t send Art-Net on its own. Start openLedMapper (the app, or openledmapper.py) and use the window it opens.'; }
  else if (!bridge.connected) {
    show = Date.now() - (bridge.since || 0) > 1500;
    pill.classList.add('warn'); txt.textContent = 'Output not connected'; pill.title = 'Reconnecting to the part of openLedMapper that sends Art-Net…';
  }
  else if (st && st.errors && st.lastError) { pill.classList.add('err'); txt.textContent = ui.outputOn ? `Send error · ${fmtN(st.pps)} pkt/s` : 'Send error'; pill.title = 'Last send error: ' + st.lastError + (from ? '\n' + from : ''); }
  else if (ui.outputOn) { pill.classList.add('ok'); txt.textContent = `Sending · ${fmtN(st ? st.pps : 0)} pkt/s`; pill.title = 'Art-Net packets sent per second. ' + from; }
  else show = false;
  pill.hidden = !show;
  const ob = $('#btnOutput');
  ob.classList.toggle('on', ui.outputOn);
  ob.textContent = ui.outputOn ? 'Art-Net ON' : 'Art-Net OFF';
  ob.setAttribute('aria-pressed', ui.outputOn);
}
function setOutput(on) {
  if (REMOTE_CLIENT) return;   // only the main computer sends Art-Net
  if (on && !bridge.connected) {
    toast(bridge.state === 'none' ? 'This page can\'t send Art-Net on its own: start openLedMapper (the app, or openledmapper.py) and use the window it opens.' : 'The Art-Net output isn\'t connected yet. Try again in a moment.', 'warn');
    return;
  }
  if (on) bridgeSend({ t: 'output', on: true });
  if (!on && ui.outputOn) { sendFrame(true); setTimeout(() => { sendFrame(true); if (!ui.outputOn) bridgeSend({ t: 'output', on: false }); }, 60); }
  ui.outputOn = on;
  keepAwake(on);
  updateBridgeUI();
  remoteLiveChanged();
}
// While Art-Net is on, hold a Web Lock: Chrome does not freeze a background page that holds one.
let releaseLock = null;
function keepAwake(on) {
  if (on && !releaseLock && navigator.locks) navigator.locks.request('openledmapper-output-' + uid(), () => ui.outputOn ? new Promise(r => { releaseLock = r; }) : null).catch(() => {});
  else if (!on && releaseLock) { releaseLock(); releaseLock = null; }
}
function updateStatus() {
  const px = project.fixtures.reduce((a, f) => a + (f._n || 0), 0);
  const unp = project.fixtures.filter(f => !f._patch).length;
  const parts = [];
  parts.push(ui.cursor ? `x ${fmtV(Math.round(ui.cursor[0] * 10) / 10)}  y ${fmtV(Math.round(ui.cursor[1] * 10) / 10)}` : 'x –  y –');
  parts.push(`zoom ${Math.round(ui.view.zoom * 100)}%`);
  parts.push(`<b>${project.fixtures.length}</b> fixtures · <b>${fmtN(px)}</b> px` + (unp ? ` · <span style="color:var(--warn)">${unp} unpatched</span>` : ''));
  parts.push(`<b>${universes.length}</b> universes`);
  const z = selZone(), sc = z && z.scenes.find(x => x.id === z.scene);
  if (z) parts.push(`${esc(z.name)}` + (sc ? ` · <b>${esc(sc.name)}</b>` + (z._fade && z._fade.scene === sc.id ? ' (fading)' : '') : ''));
  parts.push(ui.outputOn && bridge.connected ? `out <b>${outStats.fps.toFixed(1)}</b> fps · ${outStats.universes} U/frame` : `render ${project.settings.fps} fps`);
  let hov = '';
  const hp = ui.hoverPx;
  if (hp && hp.f && fxById(hp.f.id)) {
    const f = hp.f, ad = pixelAddrText(f, hp.i), a = ad ? ` · ${ad}` : '';
    const d = f._disp;
    hov = `<span class="hov">${esc(f.name)} · px ${hp.i + 1}/${f._n}${a} · rgb ${d[3 * hp.i]},${d[3 * hp.i + 1]},${d[3 * hp.i + 2]}</span>`;
  }
  const html = parts.join('<span class="muted">  │  </span>') + '<span class="fill"></span>' + hov;
  if (html !== updateStatus.last) { updateStatus.last = html; $('#status').innerHTML = html; }
  const zl = pct(ui.view.zoom);
  if ($('#zoomLbl').textContent !== zl) $('#zoomLbl').textContent = zl;
}
function renderAll() {
  $('#projName').value = project.name;
  renderFxList(); renderSrcList(); renderRight(); renderDock(); updateUndoButtons(); updateBridgeUI();
  $('#master').value = project.settings.master;
  $('#masterVal').textContent = pct(project.settings.master);
}

/* ---------- wiring the UI ---------- */
function initUI() {
  const prefs = store.get('openledmapper.ui', {});
  for (const k of UI_PREFS) if (k in prefs) ui[k] = prefs[k];
  remoteLoadCfg();
  document.body.classList.toggle('remote-client', REMOTE_CLIENT);
  if (REMOTE_CLIENT && ui.dockTab === 'nodes') ui.dockTab = 'patch';
  $('#btnRemote').addEventListener('click', e => remoteMenu(e.currentTarget));
  initMidiUI();
  $('#projName').addEventListener('change', e => { project.name = e.target.value.trim() || 'Untitled'; commit(); });
  $('#btnFile').addEventListener('click', e => projectMenu(e.currentTarget));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnAddFx').addEventListener('click', e => addFixtureMenu(e.currentTarget));
  initFxListDrop();
  $('#btnImportSvg').addEventListener('click', () => $('#fileSvg').click());
  $('#btnAddSrc').addEventListener('click', e => addSourceMenu(e.currentTarget));
  $('#srcFind').addEventListener('input', e => { ui.srcFilter = e.target.value; renderSrcList(); });
  $('#srcFind').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ui.srcFilter = ''; renderSrcList(); } });
  $('#btnOutput').addEventListener('click', () => setOutput(!ui.outputOn));
  $('#btnBlackout').addEventListener('click', toggleBlackout);
  $('#btnHl').addEventListener('click', toggleHighlight);
  $('#btnHlMode').addEventListener('click', e => highlightMenu(e.currentTarget.parentElement));
  updateHighlightUI();
  $('#master').addEventListener('input', e => { project.settings.master = parseFloat(e.target.value); $('#masterVal').textContent = pct(project.settings.master); if (REMOTE_CLIENT) remoteOp({ op: 'master', value: project.settings.master }); else remoteLiveChanged(); });
  $('#master').addEventListener('change', () => { saveSoon(); });
  const bindView = (id, key, isRange) => {
    const el = $(id);
    if (isRange) el.value = ui[key]; else el.checked = ui[key];
    el.addEventListener('input', () => { ui[key] = isRange ? parseFloat(el.value) : el.checked; savePrefs(); });
  };
  bindView('#vContent', 'showContent'); bindView('#vContentOp', 'contentOp', true);
  bindView('#vGuide', 'showGuide'); bindView('#vGuideOp', 'guideOp', true);
  bindView('#vGrid', 'showGrid'); bindView('#vSnap', 'snap'); bindView('#vLabels', 'showLabels'); bindView('#vWiring', 'showWiring'); bindView('#vZones', 'showZones');
  $('#btnFit').addEventListener('click', fitView);
  $$('#rail button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $$('#rightTabs button').forEach(b => b.addEventListener('click', () => { ui.rightTab = b.dataset.tab; savePrefs(); renderRight(); }));
  $$('#dockTabs button[data-tab]').forEach(b => b.addEventListener('click', () => { ui.dockTab = b.dataset.tab; ui.dockCollapsed = false; savePrefs(); renderDock(); }));
  $('#btnGroup').addEventListener('click', () => { groupAction() === 'ungroup' ? ungroupSel() : groupSel(); });
  $('#btnLock').addEventListener('click', toggleLockSel);
  $('#btnRight').replaceChildren(icon('panel'));
  $('#btnRight').addEventListener('click', () => showRight(ui.rightHidden));
  $('#btnHideRight').addEventListener('click', () => showRight(false));
  showRight(!ui.rightHidden);
  $('#btnDock').addEventListener('click', () => { ui.dockCollapsed = !ui.dockCollapsed; savePrefs(); renderDock(); });
  const grip = $('#dockGrip');
  grip.addEventListener('pointerdown', e => {
    grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = ui.dockH;
    const mv = ev => { ui.dockH = clamp(h0 - (ev.clientY - y0), 120, Math.round(innerHeight * 0.7)); ui.dockCollapsed = false; $('#dock').classList.remove('collapsed'); $('#dock').style.setProperty('--bottom-h', ui.dockH + 'px'); };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); savePrefs(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
  });
  const onFile = (id, fn) => $(id).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) fn(f); });
  onFile('#fileOpen', openProjectFile);
  onFile('#fileIsf', addIsfFile);
  onFile('#fileMedia', addMediaFile);
  onFile('#fileSvg', importSvgDialog);
  onFile('#fileGuide', setGuideFile);
  // drop files anywhere
  document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    const n = f.name.toLowerCase();
    if (n.endsWith('.svg')) importSvgDialog(f);
    else if (n.endsWith('.fs') || n.endsWith('.glsl')) addIsfFile(f);
    else if (n.endsWith('.json')) openProjectFile(f);
    else if (mediaKindOf(f)) { mediaTarget = null; addMediaFile(f); }
    else toast(`${f.name}: openLedMapper opens projects (.json), shaders (.fs), SVG layouts, videos and images. ${MEDIA_FORMATS}`, 'warn');
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceHeld = false; cv.style.cursor = ''; } });
  window.addEventListener('beforeunload', e => { if (ui.outputOn) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', () => { if (ui.outputOn) sendFrame(true); });
}
function toggleBlackout() {
  if (REMOTE_CLIENT) remoteOp({ op: 'blackout', on: !ui.blackout });   // the main computer blacks out; it says so back
  ui.blackout = !ui.blackout;
  $('#btnBlackout').classList.toggle('on', ui.blackout);
  $('#btnBlackout').setAttribute('aria-pressed', ui.blackout);
  remoteLiveChanged();
}
function onKey(e) {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' && !['checkbox', 'range', 'color'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProjectFile(); return; }
  if (typing) return;
  if ($('.modal-bg')) { if (e.key === 'Escape') $('.modal-bg').remove(); return; }
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  // an operator can't change the mapping: no keys that edit fixtures or switch to a drawing tool
  if (mappingLocked() && ((mod && 'dglv'.includes(k)) || (!mod && ('rlmcpnz'.includes(k) || ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))))) { if (mod) e.preventDefault(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
  if (mod && k === 'l') { e.preventDefault(); toggleLockSel(); return; }
  if (mod && k === 'a') { e.preventDefault(); ui.sel = new Set(project.fixtures.filter(f => !f.locked).map(f => f.id)); onSelection(); return; }
  if (mod) return;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) { const z = selZone(), sc = z && z.scenes[+digit[1] - 1]; if (sc) goScene(z, sc, e.shiftKey); return; }
  if (e.code === 'Space') { spaceHeld = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
  if ((ui.tool === 'path' || ui.tool === 'pen') && pathDraft) {
    if (e.key === 'Enter') { finishPath(); return; }
    if (e.key === 'Backspace') { pathDraft.pts.splice(-2); pathDraft.ctl.splice(-4); e.preventDefault(); return; }
    if (e.key === 'Escape') { pathDraft = null; setTool('select'); return; }
  }
  if (k === 'r' && ui.sel.size) { rotateSel(e.shiftKey ? -90 : 90); return; }
  const tools = { v: 'select', l: 'line', m: 'matrix', c: 'circle', p: 'path', n: 'pen', z: 'zone' };
  if (tools[k]) { setTool(tools[k]); return; }
  if (e.key === 'Escape') { if (ui.tool !== 'select') setTool('select'); else if (ui.sel.size) { ui.sel.clear(); onSelection(); } return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (ui.tool === 'zone') deleteZone(selZone()); else deleteSel(); return; }
  if (k === 'f') { fitView(); return; }
  if (k === 'h') { showRight(ui.rightHidden); return; }
  if (k === 'g') { ui.snap = !ui.snap; $('#vSnap').checked = ui.snap; savePrefs(); toast('Snap ' + (ui.snap ? 'on' : 'off')); return; }
  if (k === 'b') { toggleBlackout(); return; }
  if (k === 'i') { toggleIdentify(); return; }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && ui.sel.size) { e.preventDefault(); if (!moveOnOutput([...ui.sel], e.key === 'ArrowUp' ? -1 : 1)) toast('Not moved: patch it first, or it is already first or last on its output.'); return; }
  if (ui.outputMode === 'pixel' && ui.pickPx && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const f = fxById(ui.pickPx.fid);
    if (f) { e.preventDefault(); pickPixel(f, clamp(ui.pickPx.i + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, f._n - 1)); return; }
  }
  const step = e.shiftKey ? 10 : 1;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key] && ui.sel.size) { e.preventDefault(); nudge(...arrows[e.key]); }
}

/* ---------- boot ---------- */
// The stage is drawn when something may have changed: after each new frame of content, and on any input.
// When drawing it after every frame would leave too little time to render the output (very large projects
// or a slow GPU), it is drawn after every few frames instead, so the Art-Net frame rate holds.
let stageDirty = true, drawnFrame = -1, drawCost = 0;
function frameLoop(now) {
  requestAnimationFrame(frameLoop);
  if (!project) return;
  try {
    if (geomDirty) rebuildGeometry();
    const spare = tickPeriod * 0.85 - tickCost;
    const every = spare <= 0 ? 4 : clamp(Math.ceil(drawCost / spare), 1, 4);
    if (stageDirty || frameIndex - drawnFrame >= every) {
      stageDirty = false; drawnFrame = frameIndex;
      const t0 = performance.now();
      drawView();
      drawCost = drawCost * 0.8 + (performance.now() - t0) * 0.2;
    }
  } catch (e) { report('stage', e); }
  try {
    if (ui.dockTab === 'monitor' && !ui.dockCollapsed) drawMonitor(now);
    if (ui.dockTab === 'scenes' && !ui.dockCollapsed) drawSceneProgress();
    if (now - (frameLoop.last || 0) > 200) { frameLoop.last = now; updateStatus(); }
  } catch (e) { report('panels', e); }
}
const redrawStage = () => { stageDirty = true; };
function boot() {
  carryOverStorage();
  initUI();
  const saved = REMOTE_CLIENT ? null : store.get('openledmapper.project', null);   // a device gets the project from the main computer
  let p = REMOTE_CLIENT ? blankProject('Connecting…') : null;
  if (saved && Array.isArray(saved.fixtures)) p = saved;
  if (p && p.guide && !p.guide.src) { // the guide image is saved on its own (see saveSoon)
    const g = store.get('openledmapper.guide', null);
    if (g && g.name === p.guide.name && typeof g.src === 'string') { p.guide.src = g.src; guideKept = g.src; }
  }
  try { loadProject(p || demoProject()); }
  catch (e) { // keep a copy of what could not be opened, and start from the demo instead of not starting at all
    report('opening the saved project', e);
    store.set('openledmapper.project.unopened', saved);
    loadProject(demoProject());
    toast('The project kept in this browser could not be opened, so the demo layout is loaded.', 'err');
  }
  setTool('select');
  connectBridge();
  remoteOverlay(); updateRemoteUI();
  if (ui.midiOn && !REMOTE_CLIENT) startMidi();
  new ResizeObserver(() => { resizeView(); redrawStage(); }).observe(stageEl);
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'input', 'change', 'click', 'drop']) window.addEventListener(t, redrawStage, { capture: true, passive: true });
  requestAnimationFrame(frameLoop);
  // a handle for the browser console and for tests (olm = openLedMapper)
  window.olm = { get project() { return project; }, get tickCost() { return tickCost; }, get drawCost() { return drawCost; }, get frameIndex() { return frameIndex; }, get clockT() { return clockT; }, glCanvas, samplePick, loadProject, ui, universes: () => universes, computePatch, setOutput, bridge, tick, mixer, goScene, storeScene, loadSource, selectZone, addZone, setTool, mediaEl: id => mediaEls.get(id) };
}
boot();
