// nouPix · js/ui-playlists.js
// Playlists in the Scenes panel, kept quiet: under a zone's scenes, one line holds its playlists as tabs (play or
// pause, the name, the length, a line for how far it is). Clicking a tab opens its steps, each with its fade and play
// time to drag or type, moved by dragging; clicking it again, or Close, folds it. Everything else is in the playlist
// window, the same for a new playlist and for Edit playlist (⋯ on the tab).

/* ---------- times ---------- */
const fmtClock = s => { s = Math.max(0, Math.ceil(s - 1e-6)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtPlayTime = t => (t < 10 && !Number.isInteger(t) ? fmtV(Math.round(t * 10) / 10) + ' s' : fmtClock(t));
const fmtFade = v => (v > 0 ? fmtV(Math.round(v * 10) / 10) + ' s' : 'cut');
// "90", "1:30", "2.5", "2.5 s" → seconds
function parsePlayTime(txt) {
  const m = /^\s*(?:(\d+):)?(\d+(?:[.,]\d+)?)\s*s?\s*$/.exec(String(txt));
  return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2].replace(',', '.')) : null;
}

/* ---------- the playlists of a zone ---------- */
function playlistArea(z) {
  if (!z.playlists.length) return null;
  let open = playlistOf(z, ui.playlistOpen[z.id]);
  if (!open) delete ui.playlistOpen[z.id];
  const tabs = h('div', { class: 'ptabs' + (open ? '' : ' folded'), role: 'tablist', 'aria-label': z.name + ' playlists' },
    z.playlists.map(pl => playlistTab(z, pl, open)),
    h('button', { class: 'ptab add', type: 'button', title: 'New playlist for ' + z.name, 'aria-label': 'New playlist for ' + z.name, onclick: () => newPlaylistDialog(z) }, '+'),
    h('span', { class: 'fill' }),
    open ? h('button', { class: 'btn sm pclose', type: 'button', title: 'Fold it back to one line', onclick: () => { delete ui.playlistOpen[z.id]; renderDock(); } }, '▴ Close') : null);
  const box = h('div', { class: 'plist' + (open ? ' open' : ''), 'data-zone': z.id }, tabs);
  if (open) box.append(playlistLane(z, open));
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
    `\n${isOpen ? 'Click to fold it back to one line' : 'Click to see its steps'}. Double-click to rename. ⋯ to edit.`;
  const t = h('div', { class: 'ptab' + (isOpen ? ' open' : '') + (on ? ' on' : paused ? ' paused' : ''), role: 'tab', tabindex: 0, 'aria-selected': String(isOpen), 'data-pl': pl.id, title: tip },
    h('button', { class: 'pb', type: 'button', html: ICONS[on ? 'pause' : 'play'], 'aria-label': (on ? 'Pause ' : 'Play ') + pl.name,
      title: on ? 'Pause' : paused ? 'Play: carry on' : 'Play from the start', disabled: !pl.steps.length,
      onclick: e => { e.stopPropagation(); playlistDo(z, pl, 'toggle'); }, ondblclick: e => e.stopPropagation() }),
    h('span', { class: 'nm' }, pl.name),
    pl.autoplay ? h('span', { class: 'au', title: 'Plays when the project opens', html: ICONS.power }) : null,
    h('span', { class: 'tm' }, fmtClock(playlistLength(pl))),
    h('button', { class: 'x', type: 'button', title: 'Edit, rename, duplicate, delete…', 'aria-label': 'Options for ' + pl.name,
      onclick: e => { e.stopPropagation(); playlistMenu(e.currentTarget, z, pl); }, ondblclick: e => e.stopPropagation() }, '⋯'),
    cur ? h('i', { class: 'tprog' }) : null);
  const toggleOpen = () => {
    if (isOpen) delete ui.playlistOpen[z.id]; else ui.playlistOpen[z.id] = pl.id;
    if (ui.zone !== z.id) selectZone(z); else renderDock();
  };
  midiButton(t, `pl:${z.id}:${pl.id}`);   // a MIDI pad can play and pause it
  // Folding an open tab waits out a double-click: folding shrinks the panel, which can scroll, and the second click
  // would land on whatever moved under it.
  let foldSoon = 0;
  t.addEventListener('click', e => {
    if (!isOpen) return toggleOpen();
    if (e.detail > 1) return;
    foldSoon = setTimeout(toggleOpen, 260);
  });
  t.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === t) { e.preventDefault(); toggleOpen(); } });
  t.addEventListener('dblclick', () => { clearTimeout(foldSoon); ui.playlistRename = pl.id; ui.playlistOpen[z.id] = pl.id; renderDock(); });
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
  const steps = h('div', { class: 'psteps' }, pl.steps.length ? pl.steps.map((st, i) => stepTile(z, pl, st, i)) : h('span', { class: 'pempty' }, 'Drag scenes here'));
  const lane = h('div', { class: 'plane' }, h('div', { class: 'plrow' }, trans, hscroller(steps, `steps:${z.id}:${pl.id}`)));
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
  const t = h('div', { class: 'pstep' + (live ? ' live' + (p.on ? '' : ' paused') : ''), role: 'button', tabindex: 0, draggable: true,
    'data-step': st.id, title: `${sc ? sc.name : 'A scene that is gone'} · fades in ${fmtFade(f.v)}, plays ${fmtPlayTime(st.time)}\nDouble-click to play from here. Drag, or Alt ← →, to move it.` },
    h('div', { class: 't' }, h('span', { class: 'k' }, i + 1), h('span', { class: 'nm' }, sc ? sc.name : '?')),
    h('div', { class: 's' }),
    h('div', { class: 'pbar' }, h('i', { class: 'ramp', style: { width: (st.time ? Math.min(1, f.v / st.time) * 100 : 0) + '%' } }), h('i', { class: 'fill' })));
  if (z.tag) t.style.setProperty('--tag', z.tag);   // its zone's colour, when it has one
  // the step's fade: its own (red) once it is changed here, whatever the scene's; typing nothing goes back to automatic
  const from = () => { const g = stepFade(z, pl, st); return g.from === 'step' ? 'its own, in this playlist only' : g.from === 'playlist' ? "the playlist's" : `the scene's own (${sc ? sc.name : ''})`; };
  $('.s', t).append(fadeControl(t, { name: `Step ${i + 1}`,
    get: () => stepFade(z, pl, st).want, set: v => { st.fade = v; }, auto: () => st.fade == null, clear: () => { st.fade = null; },
    text: () => { const g = stepFade(z, pl, st); return g.v > 0 ? '◢ ' + fmtFade(g.v) : 'cut'; },
    cls: () => { const g = stepFade(z, pl, st); return g.clipped ? 'clip' : g.from === 'step' ? 'own' : ''; },
    tip: () => `Fade in: ${fmtFade(stepFade(z, pl, st).v)}, ${from()}. Changing it here doesn't change the scene; type nothing to go back to automatic` }),
  fadeControl(t, { name: `Step ${i + 1}`, what: 'play time', cls: () => 'tm', min: 0.1, max: 86400, rate: 0.2,
    get: () => st.time, set: v => { st.time = v; }, text: () => fmtPlayTime(st.time), input: () => fmtPlayTime(st.time), parse: parsePlayTime,
    tip: () => `Plays ${fmtPlayTime(st.time)}, its fade included` }));
  t.addEventListener('dblclick', () => playlistDo(z, pl, 'play', i));
  t.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); playlistDo(z, pl, 'play', i); }
    else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); shiftStep(z, pl, st, e.key === 'ArrowLeft' ? -1 : 1); }
  });
  onRightClick(t, e => menu(at(e), [
    { head: `Step ${i + 1} · ${sc ? sc.name : ''}` },
    ['Play from here', () => playlistDo(z, pl, 'play', i)],
    ['Move earlier', () => shiftStep(z, pl, st, -1), { key: 'Alt ←', disabled: i === 0 }],
    ['Move later', () => shiftStep(z, pl, st, 1), { key: 'Alt →', disabled: i === pl.steps.length - 1 }],
    ['Duplicate', () => { const keep = playingStepId(z, pl); pl.steps.splice(i + 1, 0, Object.assign({}, st, { id: uid() })); playlistEdited(z, pl, keep); commit(); }],
    ['Edit playlist…', () => newPlaylistDialog(z, null, pl)],
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
// A step one place earlier or later; the step keeps the focus, for the next press
function shiftStep(z, pl, st, d) {
  const i = pl.steps.indexOf(st);
  if (i + d < 0 || i + d >= pl.steps.length) return;
  moveStep(z, pl, st.id, i + d);
  const t = scenesRoots().map(r => $(`.plist[data-zone="${z.id}"] .pstep[data-step="${st.id}"]`, r)).find(Boolean);
  if (t) t.focus();
}

/* ---------- the playlist menu ---------- */
function playlistMenu(anchor, z, pl) {
  const on = playingList(z) === pl && z._play.on;
  menu(anchor, [
    !isEl(anchor) && { head: `${pl.name} · ${z.name}` },
    ['Edit playlist…', () => newPlaylistDialog(z, null, pl)],
    [on ? 'Pause' : 'Play', () => playlistDo(z, pl, 'toggle'), { disabled: !pl.steps.length }],
    ['Rename', () => { ui.playlistRename = pl.id; ui.playlistOpen[z.id] = pl.id; renderDock(); }],
    ['Duplicate', () => duplicatePlaylist(z, pl)],
    '-',
    ['Delete playlist', () => deletePlaylist(z, pl), { danger: true }],
  ]);
}

/* ---------- the playlist window ---------- */
// Tick some of the zone's scenes, put them in order (↑ ↓, or Alt ↑ ↓) and give them play times: they become the steps.
// The same window edits a playlist (edit): its steps first, ticked, then the zone's other scenes.
function newPlaylistDialog(z, only = null, edit = null) {
  if (!z.scenes.length) { toast(`${z.name} has no scenes yet. Set up its layers in the Content tab, then + Store, and make a playlist of them.`, 'warn'); return; }
  const picks = edit
    ? [...edit.steps.filter(st => sceneOfStep(z, st)).map(st => ({ sc: sceneOfStep(z, st), on: true, time: st.time, fade: st.fade, st })),
      ...z.scenes.filter(sc => !edit.steps.some(st => st.scene === sc.id)).map(sc => ({ sc, on: false, time: 30, fade: null }))]
    : z.scenes.map(sc => ({ sc, on: only == null || sc.id === only, time: 30, fade: null }));   // fade null: automatic
  const o = { name: edit ? edit.name : nextPlaylistName(z), fade: edit && edit.fade != null ? edit.fade : project.settings.fade, all: 30 };
  let mode = edit && edit.fade != null ? 'all' : 'scene', endV = edit ? edit.end : 'loop';
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
          h('i', { style: { background: z.tag || 'var(--line2)' } }), h('span', { class: 'nm' }, pk.sc.name)),
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
  fadeAll.disabled = mode !== 'all';
  const save = () => {
    const chosen = picks.filter(pk => pk.on);
    if (!chosen.length) { toast('Tick at least one scene.', 'warn'); return; }
    close();
    const fade = mode === 'all' ? clamp(numOr(o.fade, 2), 0, 60) : null;
    if (!edit) {
      addPlaylist(z, { name: o.name.trim() || nextPlaylistName(z), steps: chosen.map(pk => newStep(pk.sc.id, pk.time, pk.fade)), fade, end: endV, autoplay: auto.checked });
      return;
    }
    // the steps kept stay the same steps, so the one playing goes on
    const keep = playingStepId(z, edit);
    Object.assign(edit, { name: o.name.trim() || edit.name, fade, end: endV,
      steps: chosen.map(pk => (pk.st ? Object.assign(pk.st, { time: pk.time, fade: pk.fade }) : newStep(pk.sc.id, pk.time, pk.fade))) });
    setPlaylistAutoplay(z, edit, auto.checked, false);
    playlistEdited(z, edit, keep);
    commit();
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  const auto = h('input', { type: 'checkbox', checked: !!(edit && edit.autoplay) });
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal pmodal', role: 'dialog', 'aria-label': edit ? 'Edit playlist' : 'New playlist' },
      h('header', null, `${edit ? 'Edit playlist' : 'New playlist'} · ${z.name}`),
      h('div', { class: 'mb' },
        row('Name', name),
        list,
        row('Play time', h('div', { class: 'pair' }, allTime, h('button', { class: 'btn sm', type: 'button', title: 'Give every ticked scene this play time',
          onclick: () => { const v = parsePlayTime(allTime.value); if (!(v > 0)) return; picks.forEach(pk => { if (pk.on) pk.time = clamp(Math.round(v * 10) / 10, 0.1, 86400); }); paint(); } }, 'Set for the ticked ones'))),
        row('Fades', h('div', { class: 'pair' }, seg([['scene', "Each scene's own"], ['all', 'One for all']], mode, v => { mode = v; fadeAll.disabled = v !== 'all'; paint(); }), fadeAll)),
        row('At the end', selectEl([['loop', 'Loop'], ['stop', 'Stop on the last step'], ...z.playlists.filter(x => x !== edit).map(x => [x.id, 'Then play ' + x.name])], endV, v => { endV = v; }, { aria: 'At the end' })),
        h('label', { class: 'checkrow' }, auto, 'Play when the project opens')),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, edit ? 'Save' : 'Create playlist'))));
  uiDocNow().body.append(bg);   // in the window it was asked for from
  name.focus(); name.select();
}

/* ---------- every frame ---------- */
// How far the playing steps are: their bars and the playing tab's line
function drawPlaylistProgress() {
  for (const el of scenesRoots().flatMap(r => $$('.plist', r))) {
    const z = zoneById(el.dataset.zone), pl = z && playingList(z), p = z && z._play;
    if (!pl) continue;
    const st = pl.steps[p.i], el2 = st ? Math.min(1, playElapsed(z) / st.time) : 0;
    const bar = $('.pstep.live .fill', el);
    if (bar) bar.style.width = (el2 * 100).toFixed(1) + '%';
    const tp = $(`.ptab[data-pl="${pl.id}"] .tprog`, el);
    if (tp && st) tp.style.width = (Math.min(1, (pl.steps.slice(0, p.i).reduce((a, x) => a + x.time, 0) + playElapsed(z)) / (playlistLength(pl) || 1)) * 100).toFixed(1) + '%';
  }
}
