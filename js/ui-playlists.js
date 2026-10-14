// openLedMapper · js/ui-playlists.js
// Playlists in the Scenes panel. Under a zone's scenes, one line holds its playlists as tabs, with the one playing
// and its time left. Clicking a tab opens that playlist (its steps, the step editor, + Add, its settings); clicking
// it again, or Close, folds it back to the one line. Also the New playlist window and the playlist menu.

/* ---------- times ---------- */
const fmtClock = s => { s = Math.max(0, Math.ceil(s - 1e-6)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtPlayTime = t => (t < 10 && !Number.isInteger(t) ? fmtV(Math.round(t * 10) / 10) + ' s' : fmtClock(t));
const fmtFade = v => (v > 0 ? fmtV(Math.round(v * 10) / 10) + ' s' : 'cut');
// "90", "1:30", "2.5", "2.5 s" → seconds
function parsePlayTime(txt) {
  const m = /^\s*(?:(\d+):)?(\d+(?:[.,]\d+)?)\s*s?\s*$/.exec(String(txt));
  return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2].replace(',', '.')) : null;
}

/* ---------- what a playlist is doing, in words ---------- */
function playlistStatus(z, pl) {
  if (!pl.steps.length) return `Empty. Drag scenes onto it, or + Add.`;
  const p = z._play, cur = playingList(z);
  if (cur !== pl) return !cur ? 'Not playing.' : `Not playing: ${cur.name} is ${p.on ? 'playing' : p.ended ? 'stopped' : 'paused'} in ${z.name}. ▶ switches to ${pl.name}.`;
  if (p.i < 0) return 'Starting…';
  const st = pl.steps[p.i], sc = st && sceneOfStep(z, st), n = pl.steps.length;
  if (!st) return '';
  if (p.manual) { const m = z.scenes.find(s => s.id === p.manual); return `Paused: ${m ? m.name : 'a scene'} was picked by hand. ▶ fades back to step ${p.i + 1}, ${sc ? sc.name : ''}.`; }
  if (p.ended) return 'Stopped at the end. ▶ plays it again from step 1.';
  const left = fmtClock(st.time - playElapsed(z));
  if (!p.on) return `Paused on step ${p.i + 1} of ${n}, ${left} left.`;
  const nx = nextStepOf(z, pl, p.i), nsc = nx && sceneOfStep(z, nx.st);
  return `Playing step ${p.i + 1} of ${n} · ${left} left · ` + (!nx ? 'then it stops' : nx.pl !== pl ? `then ${nx.pl.name}` : `next: ${nsc ? nsc.name : ''}`);
}
// The one-line version, beside the tabs of a folded zone
function playlistBrief(z) {
  const p = z._play, pl = playingList(z);
  if (!pl) return '';
  const st = pl.steps[p.i], sc = st && sceneOfStep(z, st);
  if (!st) return pl.name;
  if (p.manual) return `${pl.name} paused · a scene picked by hand`;
  if (p.ended) return `${pl.name} stopped at the end`;
  return `${pl.name} · ${sc ? sc.name : ''} · ${p.i + 1}/${pl.steps.length} · ${fmtClock(st.time - playElapsed(z))} left${p.on ? '' : ', paused'}`;
}

/* ---------- the playlists of a zone ---------- */
function playlistArea(z) {
  if (!z.playlists.length) return null;
  let open = playlistOf(z, ui.playlistOpen[z.id]);
  if (!open) delete ui.playlistOpen[z.id];
  const tabs = h('div', { class: 'ptabs' + (open ? '' : ' folded'), role: 'tablist', 'aria-label': z.name + ' playlists' },
    z.playlists.map(pl => playlistTab(z, pl, open)),
    h('button', { class: 'ptab add', type: 'button', title: 'Make another playlist for ' + z.name, onclick: () => newPlaylistDialog(z) }, open ? '+ New playlist' : '+'),
    open ? h('span', { class: 'fill' }) : h('span', { class: 'pbrief', 'data-pl-brief': z.id }, playlistBrief(z)),
    open ? h('button', { class: 'btn sm pclose', type: 'button', title: 'Fold it back to one line', onclick: () => { delete ui.playlistOpen[z.id]; ui.playlistStep = null; ui.playlistAdd = null; renderDock(); } }, '▴ Close') : null);
  const box = h('div', { class: 'plist' + (open ? ' open' : ''), 'data-zone': z.id }, tabs);
  if (open) {
    box.append(playlistLane(z, open));
    if (ui.playlistAdd === z.id) box.append(h('div', { class: 'paddbar' }, `Add a step to ${open.name}:`,
      z.scenes.map(sc => h('button', { class: 'btn sm', type: 'button', style: { borderLeft: '3px solid ' + sc.tag }, onclick: () => addToPlaylist(z, open, sc.id) }, sc.name)),
      h('span', { class: 'muted' }, z.scenes.length ? '· or drag a scene onto the playlist' : 'Store some scenes first.')));
    const ed = stepEditor(z, open);
    if (ed) box.append(ed);
  }
  return box;
}
function playlistTab(z, pl, open) {
  const p = z._play, cur = playingList(z) === pl, on = cur && p.on, paused = cur && !p.on && !p.ended, isOpen = open === pl;
  if (ui.playlistRename === pl.id) {
    let cancel = false, done = false;
    const inp = h('input', { type: 'text', value: pl.name, 'aria-label': 'Playlist name', spellcheck: 'false' });
    const finish = () => { if (done) return; done = true; ui.playlistRename = null; const v = inp.value.trim(); if (!cancel && v && v !== pl.name) { pl.name = v; commit(); } else renderDock(); };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(); if (e.key === 'Escape') { cancel = true; finish(); } });
    inp.addEventListener('blur', finish);
    setTimeout(() => { inp.focus(); inp.select(); });
    return h('div', { class: 'ptab open' }, inp);
  }
  const tip = `${pl.name} · ${pl.steps.length} step${pl.steps.length === 1 ? '' : 's'} · ${fmtClock(playlistLength(pl))}` + (on ? ' · playing' : paused ? ' · paused' : '') +
    `\n${isOpen ? 'Click to fold it back to one line' : 'Click to see its steps'}. Double-click to rename. Right-click for more.`;
  const t = h('div', { class: 'ptab' + (isOpen ? ' open' : '') + (on ? ' on' : paused ? ' paused' : ''), role: 'tab', tabindex: 0, 'aria-selected': String(isOpen), 'data-pl': pl.id, title: tip },
    h('button', { class: 'pb', type: 'button', html: ICONS[on ? 'pause' : 'play'], 'aria-label': (on ? 'Pause ' : 'Play ') + pl.name,
      title: on ? 'Pause' : paused ? 'Play: carry on' : 'Play from the start', disabled: !pl.steps.length,
      onclick: e => { e.stopPropagation(); playlistDo(z, pl, 'toggle'); }, ondblclick: e => e.stopPropagation() }),
    h('span', { class: 'nm' }, pl.name),
    pl.autoplay ? h('span', { class: 'au', title: 'Plays when the project opens', html: ICONS.power }) : null,
    h('span', { class: 'tm' }, fmtClock(playlistLength(pl))),
    isOpen ? h('button', { class: 'x', type: 'button', title: 'Rename, duplicate, at the end, delete…', 'aria-label': 'Options for ' + pl.name,
      onclick: e => { e.stopPropagation(); playlistMenu(e.currentTarget, z, pl); }, ondblclick: e => e.stopPropagation() }, '⋯') : null,
    cur ? h('i', { class: 'tprog' }) : null);
  const toggleOpen = () => {
    if (isOpen) delete ui.playlistOpen[z.id]; else ui.playlistOpen[z.id] = pl.id;
    ui.playlistStep = null; ui.playlistAdd = null;
    if (ui.zone !== z.id) selectZone(z); else renderDock();
  };
  midiButton(t, `pl:${z.id}:${pl.id}`);   // a MIDI pad can play and pause it
  t.addEventListener('click', toggleOpen);
  t.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === t) { e.preventDefault(); toggleOpen(); } });
  t.addEventListener('dblclick', () => { ui.playlistRename = pl.id; ui.playlistOpen[z.id] = pl.id; renderDock(); });
  onRightClick(t, e => playlistMenu(at(e), z, pl));
  return t;
}
const ptb = (name, title, fn, o = {}) => h('button', { class: 'ptb' + (o.cls ? ' ' + o.cls : ''), type: 'button', html: ICONS[name], title, 'aria-label': title, disabled: !!o.disabled, onclick: fn });
function playlistLane(z, pl) {
  const p = z._play, cur = playingList(z) === pl;
  const trans = h('div', { class: 'ptrans' },
    ptb('restart', 'Previous step', () => playlistDo(z, pl, 'prev'), { disabled: !cur }),
    cur && p.on ? ptb('pause', 'Pause', () => playlistDo(z, pl, 'pause'), { cls: 'playing' }) : ptb('play', cur ? 'Play' : 'Play ' + pl.name, () => playlistDo(z, pl, 'toggle'), { disabled: !pl.steps.length }),
    ptb('next', 'Next step', () => playlistDo(z, pl, 'next'), { disabled: !cur }));
  const steps = h('div', { class: 'psteps' }, pl.steps.map((st, i) => stepTile(z, pl, st, i)),
    h('button', { class: 'pstep add' + (ui.playlistAdd === z.id ? ' on' : ''), type: 'button', title: 'Add a scene as a step', onclick: () => { ui.playlistAdd = ui.playlistAdd === z.id ? null : z.id; ui.playlistStep = null; renderDock(); } }, '+ Add'));
  const fadeMode = seg([['scene', "Each scene's own"], ['all', 'One for all']], pl.fade == null ? 'scene' : 'all', v => {
    pl.fade = v === 'all' ? (pl.fade != null ? pl.fade : project.settings.fade) : null; commit();
  });
  fadeMode.title = "Each step fades in with its scene's own fade, or all with the same one. A step can still have its own.";
  const fadeAll = pl.fade != null ? numInput(pl, 'fade', { min: 0, max: 60, step: 0.1, aria: 'Fade for all steps', onCommit: commit }) : null;
  const end = selectEl([['loop', 'Loop'], ['stop', 'Stop'], ...z.playlists.filter(o => o !== pl).map(o => [o.id, 'Then play ' + o.name])], pl.end, v => { pl.end = v; commit(); }, { aria: 'At the end' });
  const auto = h('input', { type: 'checkbox', checked: pl.autoplay, 'aria-label': 'Play when the project opens', onchange: e => setPlaylistAutoplay(z, pl, e.target.checked) });
  const lane = h('div', { class: 'plane' },
    h('div', { class: 'plrow' }, trans, steps),
    h('div', { class: 'pfoot' },
      h('span', { class: 'pstatus' + (cur && !p.on ? ' paused' : ''), 'data-pl-status': z.id + ':' + pl.id }, playlistStatus(z, pl)),
      h('span', { class: 'grp' }, 'Fades', fadeMode, fadeAll, fadeAll ? 's' : null),
      h('span', { class: 'grp' }, 'At the end', end),
      h('label', { class: 'checkrow', title: 'Start this playlist when the project opens or the app starts (one per zone)' }, auto, 'Play on open'),
      h('span', { class: 'mono muted' }, `${pl.steps.length} step${pl.steps.length === 1 ? '' : 's'} · ${fmtClock(playlistLength(pl))}`)));
  // scenes of this zone dropped on the playlist are added at the end; steps dropped here go last
  lane.addEventListener('dragover', e => { if (!dropKind(e)) return; e.preventDefault(); lane.classList.add('drop-in'); });
  lane.addEventListener('dragleave', e => { if (!lane.contains(e.relatedTarget)) lane.classList.remove('drop-in'); });
  lane.addEventListener('drop', e => { lane.classList.remove('drop-in'); if (e.defaultPrevented || !dropKind(e)) return; e.preventDefault(); dropOnPlaylist(e, z, pl, pl.steps.length); });
  return lane;
}
const dropKind = e => (e.dataTransfer.types.includes(dragType('step')) ? 'step' : e.dataTransfer.types.includes(dragType('scene')) ? 'scene' : null);
function dropOnPlaylist(e, z, pl, at) {
  const step = e.dataTransfer.getData(dragType('step')), scene = e.dataTransfer.getData(dragType('scene'));
  if (step) { const [zid, pid, sid] = step.split(':'), st = pl.steps.find(x => String(x.id) === sid); if (zid === String(z.id) && pid === String(pl.id) && st) moveStep(z, pl, st.id, at); return; }
  if (!scene) return;
  const [zid, sid] = scene.split(':'), sc = z.scenes.find(s => String(s.id) === sid);
  if (zid !== String(z.id) || !sc) { const o = project.zones.find(x => String(x.id) === zid); toast(`A playlist plays its own zone's scenes: that scene is in ${o ? o.name : 'another zone'}.`, 'warn'); return; }
  addToPlaylist(z, pl, sc.id, at);
}
function stepTile(z, pl, st, i) {
  const sc = sceneOfStep(z, st), f = stepFade(z, pl, st), p = z._play, live = playingList(z) === pl && p.i === i;
  const t = h('div', { class: 'pstep' + (live ? ' live' + (p.on ? '' : ' paused') : '') + (ui.playlistStep === st.id ? ' sel' : ''), role: 'button', tabindex: 0, draggable: true,
    'data-step': st.id, title: `${sc ? sc.name : 'A scene that is gone'} · plays ${fmtPlayTime(st.time)} · fades in ${fmtFade(f.v)} (${f.from === 'step' ? 'its own' : f.from === 'playlist' ? "the playlist's" : "the scene's"})\nClick to edit. Drag, or Alt ← →, to move it.` },
    h('div', { class: 't' }, h('span', { class: 'k' }, i + 1), h('span', { class: 'nm' }, sc ? sc.name : '?')),
    h('div', { class: 's' }, h('span', null, fmtPlayTime(st.time))),
    h('div', { class: 'pbar' }, h('i', { class: 'ramp', style: { width: (st.time ? Math.min(1, f.v / st.time) * 100 : 0) + '%' } }), h('i', { class: 'fill' })));
  t.style.setProperty('--tag', sc ? sc.tag : 'var(--line2)');
  // the step's fade: its own (blue) once it is changed here, whatever the scene's; typing nothing goes back to automatic
  const from = () => { const g = stepFade(z, pl, st); return g.from === 'step' ? 'its own, in this playlist only' : g.from === 'playlist' ? "the playlist's (One for all)" : `the scene's own (${sc ? sc.name : ''})`; };
  $('.s', t).append(fadeControl(t, { name: `Step ${i + 1}`,
    get: () => stepFade(z, pl, st).want, set: v => { st.fade = v; }, auto: () => st.fade == null, clear: () => { st.fade = null; },
    text: () => { const g = stepFade(z, pl, st); return g.v > 0 ? '◢ ' + fmtFade(g.v) : 'cut'; },
    cls: () => { const g = stepFade(z, pl, st); return g.clipped ? 'clip' : g.from === 'step' ? 'own' : ''; },
    tip: () => `Fade in: ${fmtFade(stepFade(z, pl, st).v)}, ${from()}. Changing it here doesn't change the scene; type nothing to go back to automatic` }));
  const pick = () => { ui.playlistStep = ui.playlistStep === st.id ? null : st.id; ui.playlistAdd = null; renderDock(); };
  t.addEventListener('click', pick);
  t.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); pick(); }
    else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); shiftStep(z, pl, st, e.key === 'ArrowLeft' ? -1 : 1); }
  });
  onRightClick(t, e => menu(at(e), [
    { head: `Step ${i + 1} · ${sc ? sc.name : ''}` },
    ['Play from here', () => playlistDo(z, pl, 'play', i)],
    ['Edit…', pick],
    ['Move earlier', () => shiftStep(z, pl, st, -1), { key: 'Alt ←', disabled: i === 0 }],
    ['Move later', () => shiftStep(z, pl, st, 1), { key: 'Alt →', disabled: i === pl.steps.length - 1 }],
    ['Duplicate', () => { const keep = playingStepId(z, pl); pl.steps.splice(i + 1, 0, Object.assign({}, st, { id: uid() })); playlistEdited(z, pl, keep); commit(); }],
    '-',
    ['Remove', () => removeStep(z, pl, st), { danger: true }],
  ]));
  t.addEventListener('dragstart', e => { e.dataTransfer.setData(dragType('step'), `${z.id}:${pl.id}:${st.id}`); e.dataTransfer.effectAllowed = 'move'; t.classList.add('dragging'); });
  t.addEventListener('dragend', () => t.classList.remove('dragging'));
  t.addEventListener('dragover', e => { if (!dropKind(e)) return; e.preventDefault(); t.classList.add('drop'); });
  t.addEventListener('dragleave', () => t.classList.remove('drop'));
  t.addEventListener('drop', e => { t.classList.remove('drop'); if (!dropKind(e)) return; e.preventDefault(); dropOnPlaylist(e, z, pl, i); });
  return t;
}
// A step one place earlier or later. The step, or the editor's button, keeps the focus for the next press.
function shiftStep(z, pl, st, d, fromEditor = false) {
  const i = pl.steps.indexOf(st);
  if (i + d < 0 || i + d >= pl.steps.length) return;
  moveStep(z, pl, st.id, i + d);
  const box = $(`#dockBody .plist[data-zone="${z.id}"]`);
  if (!box) return;
  const btn = fromEditor && $(`.peditor button[data-mv="${d}"]`, box), t = $(`.pstep[data-step="${st.id}"]`, box);
  if (btn && !btn.disabled) btn.focus(); else if (t) t.focus();
}
function stepEditor(z, pl) {
  const st = pl.steps.find(s => s.id === ui.playlistStep);
  if (!st) return null;
  const i = pl.steps.indexOf(st), sc = sceneOfStep(z, st), f = stepFade(z, pl, st);
  const startsAt = pl.steps.slice(0, i).reduce((a, x) => a + x.time, 0);
  const time = h('input', { type: 'text', class: 'ptime', value: fmtPlayTime(st.time), 'aria-label': 'Play time', title: 'Seconds (90), or minutes:seconds (1:30)' });
  time.addEventListener('keydown', e => { if (e.key === 'Enter') time.blur(); });
  time.addEventListener('change', () => { const v = parsePlayTime(time.value); if (v > 0) { st.time = clamp(Math.round(v * 10) / 10, 0.1, 86400); commit(); } else { time.value = fmtPlayTime(st.time); toast('Type the play time in seconds (90) or minutes:seconds (1:30).', 'warn'); } });
  const scene = selectEl(z.scenes.map(s => [s.id, s.name]), st.scene, v => { const s = z.scenes.find(x => String(x.id) === v); if (s) { st.scene = s.id; commit(); } }, { aria: 'Scene' });
  const auto = pl.fade != null ? `Auto · ${fmtFade(pl.fade)}, the playlist's` : `Auto · ${fmtFade(sc ? sc.fade : 0)}, the scene's`;
  const fadeMode = seg([['auto', auto], ['own', 'Its own']], st.fade == null ? 'auto' : 'own', v => { st.fade = v === 'auto' ? null : f.want; commit(); });
  fadeMode.title = "Its own: a fade for this step only, whatever the scene's (the scene keeps its own when clicked)";
  return h('div', { class: 'peditor' },
    h('div', { class: 'pedhead' }, h('b', null, `${pl.name} · step ${i + 1}`), h('span', { class: 'muted' }, `of ${pl.steps.length} · starts at ${fmtClock(startsAt)}`)),
    h('label', { class: 'pfield' }, h('span', null, 'Scene'), scene),
    h('label', { class: 'pfield' }, h('span', null, 'Play time'), time),
    h('div', { class: 'pfield' }, h('span', null, 'Fade in'), h('div', { class: 'pair' }, fadeMode,
      st.fade != null ? numInput(st, 'fade', { min: 0, max: 60, step: 0.1, aria: 'Fade of this step', onCommit: commit }) : null, st.fade != null ? 's' : null)),
    h('div', { class: 'pact' },
      h('button', { class: 'btn sm', type: 'button', 'data-mv': -1, title: 'One place earlier (Alt ← on the step)', disabled: i === 0, onclick: () => shiftStep(z, pl, st, -1, true) }, '← Earlier'),
      h('button', { class: 'btn sm', type: 'button', 'data-mv': 1, title: 'One place later (Alt → on the step)', disabled: i === pl.steps.length - 1, onclick: () => shiftStep(z, pl, st, 1, true) }, 'Later →'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => playlistDo(z, pl, 'play', i) }, '▶ Play from here'),
      h('button', { class: 'btn sm danger-t', type: 'button', onclick: () => removeStep(z, pl, st) }, 'Remove'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { ui.playlistStep = null; renderDock(); } }, 'Done')),
    h('p', { class: 'note' + (f.clipped ? ' warn' : '') }, f.clipped
      ? `The fade (${fmtFade(f.want)}) is longer than the play time, so it is cut to ${fmtFade(f.v)}.`
      : `Fades in for ${f.v > 0 ? fmtFade(f.v) : '0 s (a cut)'}, then holds for ${fmtPlayTime(Math.max(0, st.time - f.v))}. The next step starts at ${fmtClock(startsAt + st.time)}.`));
}

/* ---------- the playlist menu ---------- */
function playlistMenu(anchor, z, pl) {
  const p = z._play, on = playingList(z) === pl && p.on, others = z.playlists.filter(o => o !== pl);
  const end = v => () => { pl.end = v; commit(); };
  menu(anchor, [
    !(anchor instanceof Element) && { head: `${pl.name} · ${z.name}` },
    [on ? 'Pause' : 'Play', () => playlistDo(z, pl, 'toggle'), { disabled: !pl.steps.length }],
    ['Rename', () => { ui.playlistRename = pl.id; ui.playlistOpen[z.id] = pl.id; renderDock(); }],
    ['Duplicate', () => duplicatePlaylist(z, pl)],
    '-',
    ['At the end', null, { sub: [
      [(pl.end === 'loop' ? '✓ ' : '') + 'Loop', end('loop')],
      [(pl.end === 'stop' ? '✓ ' : '') + 'Stop on the last step', end('stop')],
      ...others.map(o => [(pl.end === o.id ? '✓ ' : '') + 'Then play ' + o.name, end(o.id)]),
    ] }],
    [(pl.autoplay ? '✓ ' : '') + 'Play when the project opens', () => setPlaylistAutoplay(z, pl, !pl.autoplay)],
    '-',
    ['Delete playlist', () => deletePlaylist(z, pl), { danger: true }],
  ]);
}

/* ---------- the New playlist window ---------- */
// Tick some of the zone's scenes, put them in order (↑ ↓, or Alt ↑ ↓) and give them play times: they become the steps
function newPlaylistDialog(z, only = null) {
  if (!z.scenes.length) { toast(`${z.name} has no scenes yet. Set up its layers in the Content tab, then + Store, and make a playlist of them.`, 'warn'); return; }
  const picks = z.scenes.map(sc => ({ sc, on: only == null || sc.id === only, time: 30, fade: null }));   // fade null: automatic
  const o = { name: nextPlaylistName(z), fade: project.settings.fade, all: 30 };
  let mode = 'scene', endV = 'loop';
  const close = () => bg.remove();
  const list = h('div', { class: 'ppicks' });
  // move a scene one place earlier or later; the control used keeps the focus, for the next press
  const move = (pk, d, keep) => {
    const i = picks.indexOf(pk), j = i + d;
    if (j < 0 || j >= picks.length) return;
    picks.splice(i, 1); picks.splice(j, 0, pk);
    paint();
    const row = list.children[j + 1], f = row.querySelector(keep);
    (f && !f.disabled ? f : row.querySelector(d < 0 ? '.dn' : '.up')).focus();
    row.scrollIntoView({ block: 'nearest' });
  };
  const paint = () => {
    let n = 0;
    const auto = pk => (mode === 'all' ? fmtFade(clamp(numOr(o.fade, 2), 0, 60)) : fmtFade(pk.sc.fade));
    list.replaceChildren(h('div', { class: 'ppick head' }, h('span', null, '#'), h('span', null, 'Scene'), h('span', null, 'Fade in'), h('span', null, 'Play time'), h('span')), ...picks.map((pk, i) => {
      const time = h('input', { type: 'text', value: fmtPlayTime(pk.time), disabled: !pk.on, 'aria-label': pk.sc.name + ' play time', title: 'Seconds (90), or minutes:seconds (1:30)' });
      time.addEventListener('change', () => { const v = parsePlayTime(time.value); if (v > 0) pk.time = clamp(Math.round(v * 10) / 10, 0.1, 86400); time.value = fmtPlayTime(pk.time); });
      // the step's own fade, in this playlist only: empty follows the scene's (or the playlist's One for all)
      const fade = h('input', { type: 'text', class: 'pfade' + (pk.fade != null ? ' own' : ''), value: pk.fade != null ? fmtV(pk.fade) : '', placeholder: auto(pk), disabled: !pk.on, 'aria-label': pk.sc.name + ' fade in',
        title: `Its own fade in this playlist, in seconds (0 cuts). Empty: ${mode === 'all' ? 'the playlist\'s One for all' : 'the scene\'s own'}, ${auto(pk)}. The scene itself keeps its fade.` });
      fade.addEventListener('change', () => { const t = fade.value.trim().replace(',', '.'), v = parseFloat(t); pk.fade = t === '' || !isFinite(v) ? null : clamp(Math.round(v * 10) / 10, 0, 60); fade.value = pk.fade != null ? fmtV(pk.fade) : ''; fade.classList.toggle('own', pk.fade != null); });
      const mv = (cls, txt, d, label) => h('button', { class: cls, type: 'button', disabled: !picks[i + d], title: label + ' (Alt ' + txt + ')', 'aria-label': `${label}: ${pk.sc.name}`, onclick: () => move(pk, d, '.' + cls) }, txt);
      const row = h('div', { class: 'ppick' + (pk.on ? '' : ' off') },
        h('span', { class: 'ix', title: pk.on ? 'Step ' + (n + 1) : 'Not in the playlist' }, pk.on ? ++n : ''),
        h('label', { class: 'pick' },
          h('input', { type: 'checkbox', checked: pk.on, 'aria-label': pk.sc.name, onchange: e => { pk.on = e.target.checked; paint(); list.children[picks.indexOf(pk) + 1].querySelector('input[type=checkbox]').focus(); } }),
          h('i', { style: { background: pk.sc.tag } }), h('span', { class: 'nm' }, pk.sc.name)),
        fade, time,
        h('span', { class: 'mv' }, mv('up', '↑', -1, 'Move earlier'), mv('dn', '↓', 1, 'Move later')));
      row.addEventListener('keydown', e => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault(); e.stopPropagation();
        const t = e.target, keep = t.matches('input[type=checkbox]') ? 'input[type=checkbox]' : t.matches('.pfade') ? '.pfade' : t.matches('input[type=text]') ? 'input[type=text]:not(.pfade)' : t.matches('.dn') ? '.dn' : '.up';
        if (t.matches('input[type=text]')) t.dispatchEvent(new Event('change'));   // keep what was typed
        move(pk, e.key === 'ArrowUp' ? -1 : 1, keep);
      });
      return row;
    }));
  };
  paint();
  const name = textInput(o, 'name', { aria: 'Playlist name' });
  const allTime = h('input', { type: 'text', value: fmtPlayTime(o.all), class: 'ptime', 'aria-label': 'Play time for the ticked scenes' });
  const fadeAll = numInput(o, 'fade', { min: 0, max: 60, step: 0.1, aria: 'Fade for all steps', onCommit: paint });
  fadeAll.disabled = true;
  const save = () => {
    const chosen = picks.filter(pk => pk.on);
    if (!chosen.length) { toast('Tick at least one scene.', 'warn'); return; }
    close();
    const pl = addPlaylist(z, { name: o.name.trim() || nextPlaylistName(z), steps: chosen.map(pk => newStep(pk.sc.id, pk.time, pk.fade)), fade: mode === 'all' ? clamp(numOr(o.fade, 2), 0, 60) : null, end: endV, autoplay: auto.checked });
    toast(`${pl.name} made in ${z.name}. ▶ on its tab plays it.`);
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  const auto = h('input', { type: 'checkbox' });
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal pmodal', role: 'dialog', 'aria-label': 'New playlist' },
      h('header', null, `New playlist · ${z.name}`),
      h('div', { class: 'mb' },
        row('Name', name),
        list,
        row('Play time', h('div', { class: 'pair' }, allTime, h('button', { class: 'btn sm', type: 'button', title: 'Give every ticked scene this play time',
          onclick: () => { const v = parsePlayTime(allTime.value); if (!(v > 0)) return; picks.forEach(pk => { if (pk.on) pk.time = clamp(Math.round(v * 10) / 10, 0.1, 86400); }); paint(); } }, 'Set for the ticked ones'))),
        row('Fades', h('div', { class: 'pair' }, seg([['scene', "Each scene's own"], ['all', 'One for all']], mode, v => { mode = v; fadeAll.disabled = v !== 'all'; paint(); }), fadeAll)),
        row('At the end', selectEl([['loop', 'Loop'], ['stop', 'Stop on the last step'], ...z.playlists.map(x => [x.id, 'Then play ' + x.name])], endV, v => { endV = v; }, { aria: 'At the end' })),
        h('label', { class: 'checkrow' }, auto, 'Play when the project opens'),
        h('p', { class: 'note' }, 'The ticked scenes are the steps, in this order: ↑ ↓ (or Alt ↑ ↓) move a scene earlier or later. A fade typed here is the step\'s own, in this playlist only: the scene keeps its fade. Left empty, the step fades like the scene (or with One for all). A play time counts from the moment a step starts, its fade in included, until the next step starts.')),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Create playlist'))));
  document.body.append(bg);
  name.focus(); name.select();
}

/* ---------- every frame ---------- */
// How far the playing steps are: their bars, the playing tab's line, and the words that count down
function drawPlaylistProgress() {
  for (const el of $$('#dockBody .plist')) {
    const z = zoneById(el.dataset.zone), pl = z && playingList(z), p = z && z._play;
    if (!pl) continue;
    const st = pl.steps[p.i], el2 = st ? Math.min(1, playElapsed(z) / st.time) : 0;
    const bar = $('.pstep.live .fill', el);
    if (bar) bar.style.width = (el2 * 100).toFixed(1) + '%';
    const tp = $(`.ptab[data-pl="${pl.id}"] .tprog`, el);
    if (tp && st) tp.style.width = (Math.min(1, (pl.steps.slice(0, p.i).reduce((a, x) => a + x.time, 0) + playElapsed(z)) / (playlistLength(pl) || 1)) * 100).toFixed(1) + '%';
    const brief = $('[data-pl-brief]', el);
    if (brief) { const t = playlistBrief(z); if (brief.textContent !== t) brief.textContent = t; }
    const stat = $(`[data-pl-status="${z.id}:${pl.id}"]`, el);
    if (stat) { const t = playlistStatus(z, pl); if (stat.textContent !== t) stat.textContent = t; }
  }
}
