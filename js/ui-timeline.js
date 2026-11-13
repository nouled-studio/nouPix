// nouPix · js/ui-timeline.js
// The timelines' panel, in the bottom panel's Timeline tab or the side column's: the timelines as tabs (+ New
// timeline), the transport (play or pause, stop, the time, the loop: off, all or a region, the ruler in seconds or bars,
// snap, zoom, the audio), and under the ruler an audio track (its waveform) and a track per zone, top zone first. Scenes
// are dragged onto their zone's track as clips (or picked with a double-click there); a clip is moved by dragging,
// made longer or shorter by its edges, its fade-in and fade-out by the handles at its top corners; the ruler is
// clicked or dragged to move the playhead; the loop's region by its two markers on the ruler. A clip unfolds (its ▸, or a
// double-click) to show its keyframes: a row per curve (its level, a control of its scene's effects) with its line and
// keys; a key is dragged in time and value, added with a double-click or ◆ (at the playhead), right-clicked for its ease
// (Linear, Ease, Hold), its value or Delete; + Control adds a curve.

const shownTimeline = () => tlOf(ui.tlId) || project.timelines[0] || null;
const tlRoots = () => [panelRoot('timeline')].filter(Boolean);
const timelineShown = () => tlRoots().length > 0;
const TL_LABEL = 132, TL_KROW = 26;
// a track's height: zoomed with its slider or Alt + scroll
const tlRow = () => clamp(Math.round(ui.tlRowH) || 50, 30, 160);
const tlKeys = new Set();   // the keys picked (Delete takes them; dragged together)
const tlIsOpen = c => ui.tlOpen.includes(c.id);
function tlToggleOpen(c) { ui.tlOpen = tlIsOpen(c) ? ui.tlOpen.filter(x => x !== c.id) : ui.tlOpen.concat(c.id); refreshTimeline(); }
let tlDrag = false, tlPending = false, tlSnap = true;
function refreshTimeline() {
  if (!timelineShown()) return;
  const a = document.activeElement;
  if (tlDrag || (a && a.matches('input[type=text], input[type=number]') && tlRoots().some(r => r.contains(a)))) { tlPending = true; return; }
  tlPending = false;
  for (const r of tlRoots()) keepScroll(r, () => { r.replaceChildren(); renderTimeline(r); });
}
document.addEventListener('focusout', e => { if (tlPending && e.target.closest && e.target.closest('.tlpanel')) setTimeout(() => { if (!tlDrag) refreshTimeline(); }); }, true);
// m:ss.cc
const fmtTime = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(2).padStart(5, '0'); };
// The ruler's steps: labelled ones about 80px apart, and finer ones between (seconds, or bars and beats)
function tlSteps(T) {
  const z = ui.tlZoom;
  if (T.grid === 'bars') {
    // from the first downbeat (beat0), so the bars fall on the music
    const beat = 60 / T.bpm, bar = beat * 4, k = [1, 2, 4, 8, 16, 32].find(n => n * bar * z >= 70) || 64, b0 = T.beat0 || 0, minor = bar * k >= bar * 2 ? bar : beat;
    return { major: bar * k, minor, off: ((b0 % minor) + minor) % minor, b0, label: t => String(Math.round((t - b0) / bar) + 1), snap: beat };
  }
  const s = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(n => n * z >= 70) || 1200;
  return { major: s, minor: s / (s >= 10 ? 5 : 2), off: 0, b0: 0, label: t => fmtTime(t).replace(/\.00$/, ''), snap: s / (s >= 10 ? 5 : 2) };
}
// A time snapped to the grid, the playhead and other clips' edges, when within 8px of one
function tlSnapT(T, t, skip) {
  if (!tlSnap) return t;
  const lim = 8 / ui.tlZoom, st = tlSteps(T), b0 = st.b0 % st.snap, pts = [Math.round((t - b0) / st.snap) * st.snap + b0, tlPos(), ...(T.markers || []).map(m => m.t)];
  for (const cs of Object.values(T.tracks)) for (const c of cs) if (c !== skip) pts.push(c.start, c.start + c.dur);
  for (const A of T.audios) if (A !== skip) pts.push(A.start, A.start + A.dur);
  let best = t, d = lim;
  for (const q of pts) if (Math.abs(q - t) < d) { d = Math.abs(q - t); best = q; }
  return best;
}

function renderTimeline(body) {
  const T = shownTimeline();
  // (text selected anywhere on the page would start a drag of it under a slider or a clip, cancelling theirs)
  const panel = h('div', { class: 'tlpanel', onpointerdown: e => { if (!e.target.matches('input[type=text], input[type=number]')) { const sel = e.target.ownerDocument.getSelection(); if (sel && !sel.isCollapsed) sel.removeAllRanges(); } } });
  body.append(panel);
  panel.append(h('div', { class: 'cuetabs' },
    project.timelines.map(K => h('button', { type: 'button', class: 'cltab' + (K === T ? ' on' : ''), title: K === T ? 'Right-click for its menu' : 'Show ' + K.name,
      onclick: () => { ui.tlId = K.id; ui.tlSel = null; refreshTimeline(); }, oncontextmenu: e => { e.preventDefault(); timelineMenu(e.currentTarget, K); } }, K.name)),
    h('button', { type: 'button', class: 'btn sm', title: 'A new timeline: scenes on a track per zone, with an audio file', onclick: () => addTimeline() }, '+ New timeline'),
    h('span', { class: 'fill' }),
    T ? h('button', { type: 'button', class: 'btn sm icon', title: T.name + ': rename, length, delete', 'aria-label': T.name + ' menu', onclick: e => timelineMenu(e.currentTarget, T) }, '⋯') : null));
  if (!T) {
    panel.append(h('div', { class: 'cueempty' }, h('p', null, 'No timelines yet. A timeline plays scenes on a track per zone, in time with an audio file.'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => addTimeline() }, '+ New timeline')));
    return;
  }
  const mine = tl.id === T.id, playing = mine && tl.playing;
  const segBtns = (opts, val, set, label) => h('span', { class: 'tlseg', role: 'group', 'aria-label': label },
    opts.map(([v, t, tip]) => h('button', { type: 'button', class: v === val ? 'on' : '', 'aria-pressed': String(v === val), title: tip || t, onclick: () => set(v) }, t)));
  const fileIn = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: e => { const f = e.target.files[0]; if (f) addTimelineAudio(T, f, T.audios.length && mine ? tlPos() : 0); } });
  panel.append(h('div', { class: 'tlbar' },
    h('button', { type: 'button', class: 'tlplay' + (playing ? ' on' : ''), 'aria-label': playing ? 'Pause' : 'Play', title: (playing ? 'Pause' : 'Play') + ' (Space, with the mouse off the stage)',
      onclick: () => (playing ? tlPause() : tlPlay(T)), html: playing ? '<svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 16 16"><path d="M4 2.5l9 5.5-9 5.5z" fill="currentColor"/></svg>' }),
    h('button', { type: 'button', class: 'tlplay', 'aria-label': 'Stop', title: 'Stop: back to the start (of the loop)', onclick: () => tlStop(T), html: '<svg viewBox="0 0 16 16"><path d="M3.5 3.5h9v9h-9z" fill="currentColor"/></svg>' }),
    h('span', { class: 'tltime mono', 'data-tl-time': '' }, fmtTime(mine ? tlPos() : 0), h('span', { class: 'muted' }, ' / ' + fmtTime(T.length))),
    h('span', { class: 'lbl' }, 'Loop'),
    segBtns([['off', 'Off'], ['all', 'All', 'Loop the whole timeline'], ['region', 'Region', 'Loop between the two markers on the ruler']], T.loop.mode, v => { T.loop.mode = v; commit({ lists: false }); refreshTimeline(); }, 'Loop'),
    h('span', { class: 'lbl' }, 'Grid'),
    segBtns([['sec', 'Seconds'], ['bars', 'Bars', 'Bars and beats at the tempo given']], T.grid, v => { T.grid = v; commit({ lists: false }); refreshTimeline(); }, 'Grid'),
    T.grid === 'bars' ? h('label', { class: 'tlbpm', title: 'The tempo the bars follow' }, h('input', { type: 'number', min: 20, max: 300, step: 0.1, value: fmtV(T.bpm), 'aria-label': 'BPM',
      onchange: e => { T.bpm = clamp(+e.target.value || 120, 20, 300); commit({ lists: false }); refreshTimeline(); }, onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } }), 'BPM') : null,
    T.grid === 'bars' ? h('span', { class: 'tlseg', role: 'group', 'aria-label': 'Tempo twice or half' },
      h('button', { type: 'button', title: 'Half the tempo (it counts twice too fast)', 'aria-label': 'Half the tempo', onclick: () => tlTempoTimes(T, 0.5) }, '÷2'),
      h('button', { type: 'button', title: 'Twice the tempo (it counts half too slow)', 'aria-label': 'Twice the tempo', onclick: () => tlTempoTimes(T, 2) }, '×2')) : null,
    T.audios.length ? h('button', { type: 'button', class: 'btn sm', title: 'Find the tempo and bar 1 in the first audio track (or in another, from its menu): the bars follow the music', onclick: () => tlDetect(T, true) }, 'Detect') : null,
    h('label', { class: 'tlsnap', title: 'Clips and markers snap to the grid, the playhead and other clips' }, h('input', { type: 'checkbox', checked: tlSnap, onchange: e => { tlSnap = e.target.checked; } }), 'Snap'),
    h('span', { class: 'fill' }),
    // the zoom: these sliders, or the bars under and beside the tracks (their ends dragged)
    h('span', { class: 'tlzlbl', title: 'Zoom in time' }, '↔'),
    h('input', { type: 'range', class: 'tlzoom', min: 4, max: 240, step: 1, value: ui.tlZoom, 'aria-label': 'Zoom', title: 'Zoom in time (or the bar under the tracks, or Ctrl + scroll)',
      oninput: e => tlZoomTo(+e.target.value), onchange: () => savePrefs() }),
    h('span', { class: 'tlzlbl', title: 'Track height' }, '↕'),
    h('input', { type: 'range', class: 'tlzoom tlvzoom', min: 30, max: 160, step: 1, value: tlRow(), 'aria-label': 'Track height', title: 'Track height (or the bar beside the tracks, or Alt + scroll)',
      oninput: e => tlRowTo(+e.target.value), onchange: () => savePrefs() }),
    h('button', { type: 'button', class: 'btn sm', title: 'Zoom to fit: every clip in view, the tracks filling the panel', onclick: () => tlFit(T) }, 'Fit'),
    h('button', { type: 'button', class: 'btn sm', title: 'A marker at the playhead: Drop, Break, Build up… (M)', onclick: () => markerDialog(T, null, mine ? tlPos() : 0) }, '+ Marker'),
    h('button', { type: 'button', class: 'btn sm', title: T.audios.length ? 'One more audio track, at the playhead' : 'An audio file that plays with the timeline', onclick: () => fileIn.click() }, '+ Audio'),
    fileIn));
  // the tracks, with a bar under them and one beside them: their middle scrolls, their ends zoom (in time, in height)
  const hbar = zoomBar(T, 'h'), vbar = zoomBar(T, 'v');
  panel.append(h('div', { class: 'tlview' }, tlTracks(T, mine), vbar, hbar, h('span', { class: 'tlcorner' })));
  requestAnimationFrame(() => tlBarsSync(true));
}
// The tracks: a ruler, the audio, the zones (top zone first); drawn again alone when zooming, so the bar and its
// slider stay as they are while dragged
function tlTracks(T, mine) {
  // the tracks: a ruler, the audio, the zones (top zone first)
  const W = Math.max(1, T.length * ui.tlZoom), st = tlSteps(T);
  // in bars, faint lines on every beat and stronger ones on every bar, from the first downbeat
  const beatW = 60 / T.bpm * ui.tlZoom, beats = T.grid === 'bars' && beatW >= 5;
  const laneStyle = () => (beats ? { width: W + 'px', '--beat': beatW + 'px', '--bar': beatW * 4 + 'px', '--b0': ((T.beat0 || 0) % (60 / T.bpm * 4)) * ui.tlZoom + 'px' } : { width: W + 'px' });
  const grid = h('div', { class: 'tlgrid', style: { width: TL_LABEL + W + 'px', '--tlrow': tlRow() + 'px' } });
  const scroll = h('div', { class: 'tlscroll', 'data-keep': 'tlscroll:' + T.id }, grid);
  scroll.addEventListener('wheel', e => {
    if (e.altKey) { e.preventDefault(); tlRowTo(tlRow() * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); savePrefs(); return; }
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    tlZoomTo(ui.tlZoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - scroll.getBoundingClientRect().left);
    savePrefs();
  }, { passive: false });
  // the ruler: ticks, labels, the loop's region and markers; clicked or dragged, the playhead goes there
  const ruler = h('div', { class: 'tllane tlruler', style: { width: W + 'px' }, title: 'Click or drag to move the playhead' });
  for (let t = st.off; t <= T.length + 1e-6; t += st.minor) {
    const q = (t - st.b0) / st.major, major = Math.abs(q - Math.round(q)) < 1e-6;
    ruler.append(h('span', { class: 'tltick' + (major ? ' major' : ''), style: { left: t * ui.tlZoom + 'px' } }, major ? st.label(t) : null));
    if (st.minor * ui.tlZoom < 3) break;
  }
  if (T.loop.mode === 'region') {
    ruler.append(h('span', { class: 'tlloop', style: { left: T.loop.a * ui.tlZoom + 'px', width: (T.loop.b - T.loop.a) * ui.tlZoom + 'px' } }));
    for (const k of ['a', 'b']) {
      const m = h('span', { class: 'tlmark ' + k, style: { left: T.loop[k] * ui.tlZoom + 'px' }, title: (k === 'a' ? 'Loop start' : 'Loop end') + ': drag', 'aria-label': k === 'a' ? 'Loop start' : 'Loop end' });
      m.addEventListener('pointerdown', e => { e.stopPropagation(); dragMark(e, T, k, m, ruler); });
      ruler.append(m);
    }
  }
  // right-click: bar 1 starts here (on the beat nearest), the grid in bars from it
  onRightClick(ruler, e => {
    const t = clamp((e.clientX - ruler.getBoundingClientRect().left) / ui.tlZoom, 0, T.length), beat = 60 / T.bpm, b0 = T.beat0 || 0;
    const on = T.grid === 'bars' ? b0 + Math.round((t - b0) / beat) * beat : t;
    menu(e, [{ head: fmtTime(on) }, ['Bar 1 starts here', () => { T.beat0 = Math.round(Math.max(0, on % (beat * 4)) * 1000) / 1000; T.grid = 'bars'; commit({ lists: false }); refreshTimeline(); }],
      ['Add a marker here…', () => markerDialog(T, null, on)]]);
  });
  ruler.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); ruler.setPointerCapture(e.pointerId); tlDrag = true;
    const at = ev => tlSeek(T, (ev.clientX - ruler.getBoundingClientRect().left) / ui.tlZoom);
    at(e);
    const mv = ev => at(ev), up = () => { ruler.removeEventListener('pointermove', mv); ruler.removeEventListener('pointerup', up); ruler.removeEventListener('pointercancel', up); tlDrag = false; refreshTimeline(); };
    ruler.addEventListener('pointermove', mv); ruler.addEventListener('pointerup', up); ruler.addEventListener('pointercancel', up);
  });
  grid.append(h('div', { class: 'tlrow tlhead-row' }, h('div', { class: 'tllabel' }), ruler));
  const section = name => h('div', { class: 'tlrow tlsec' }, h('div', { class: 'tllabel' }, name), h('div', { class: 'tllane', style: { width: W + 'px' } }));
  // the audio's section folds it to a thin line (its markers still on it)
  const fold = ui.tlAudioFold;
  grid.append(h('div', { class: 'tlrow tlsec' }, h('div', { class: 'tllabel' },
    h('button', { type: 'button', class: 'tlfold', 'aria-expanded': String(!fold), title: fold ? 'Show the audio track' : 'Fold the audio track (its markers stay)',
      onclick: () => { ui.tlAudioFold = !ui.tlAudioFold; savePrefs(); refreshTimeline(); } }, fold ? '▸' : '▾', ' Audio')), h('div', { class: 'tllane', style: { width: W + 'px' } })));
  // the audio tracks, one a row (the markers on the first); folded, one thin line with the markers
  const rows = fold ? [null] : T.audios.length ? T.audios : [null];
  rows.forEach((A, i) => {
    const alane = h('div', { class: 'tllane tlaudio' + (beats ? ' beats' : '') + (fold ? ' folded' : ''), style: laneStyle(), 'data-audio-lane': A ? A.id : '',
      title: 'Drop an audio file here: a track of its own from there. Right-click for a marker' });
    alane.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); alane.classList.add('drop'); } });
    alane.addEventListener('dragleave', () => alane.classList.remove('drop'));
    alane.addEventListener('drop', e => {
      alane.classList.remove('drop');
      const f = [...e.dataTransfer.files].find(f => /^audio\//.test(f.type) || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac)$/i.test(f.name));
      if (!f) return;
      e.preventDefault();
      addTimelineAudio(T, f, T.audios.length ? tlSnapT(T, (e.clientX - alane.getBoundingClientRect().left) / ui.tlZoom) : 0);
    });
    if (A) alane.append(audioEl(T, A));
    else if (!fold) alane.append(h('span', { class: 'tlhint' }, 'Drop an audio file here, or + Audio'));
    if (i === 0) for (const m of T.markers || []) alane.append(markerEl(T, m));
    onRightClick(alane, e => {
      if (e.target.closest && e.target.closest('.tlflag, .tlaclip')) return;
      const t = tlSnapT(T, (e.clientX - alane.getBoundingClientRect().left) / ui.tlZoom);
      menu(e, [{ head: fmtTime(t) }, ['Add a marker here…', () => markerDialog(T, null, t)]]);
    });
    // a track's volume and mute beside its name
    const volBox = A ? h('span', { class: 'tlvol' },
      h('button', { type: 'button', class: 'tllb tlmute' + (A.mute ? ' on' : ''), title: A.mute ? 'Sound on' : 'Mute', 'aria-label': (A.mute ? 'Unmute ' : 'Mute ') + A.name, 'aria-pressed': String(!!A.mute),
        html: A.mute ? '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.4"/></svg>'
          : '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 010 5M12.5 3.5a6 6 0 010 9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
        onclick: () => tlAudioMute(T, A) }),
      h('input', { type: 'range', class: 'tlvolr', min: 0, max: 1, step: 0.01, value: numOr(A.vol, 1), 'aria-label': 'Volume of ' + A.name, title: 'Volume (its keys, on its waveform, go up to this)',
        oninput: e => { A.vol = +e.target.value; tlAudioSync(T, tlPos(), tl.playing && tl.id === T.id, false); }, onchange: () => commit({ lists: false }) })) : null;
    const label = h('div', { class: 'tllabel tlalabel' }, h('span', { class: 'tlz', title: A ? A.name : '' }, fold ? '' : A ? A.name.replace(/\.[a-z0-9]+$/i, '') : 'No audio'), volBox);
    if (A) onRightClick(label, e => audioMenu(e, T, A));
    grid.append(h('div', { class: 'tlrow' + (fold ? ' afold' : '') + (i ? ' sub' : '') }, label, alane));
  });
  grid.append(section('Zones'));
  // the zones
  // a zone's lanes, the highest on top: where clips overlap, the highest shows
  for (const z of project.zones.slice().reverse()) {
    const n = (T.lanes && T.lanes[z.id]) || 1, clips = T.tracks[z.id] || [];
    for (let k = n - 1; k >= 0; k--) {
      const lane = h('div', { class: 'tllane tltrack' + (beats ? ' beats' : ''), style: laneStyle(), 'data-zone': z.id, 'data-lane': k,
        title: 'Drag a scene of ' + z.name + ' here, or double-click to pick one' + (n > 1 ? '. Where clips overlap, the highest lane\'s shows.' : '') });
      for (const c of clips) if ((c.lane || 0) === k) lane.append(clipEl(T, z, c));
      lane.addEventListener('dragover', e => { if (e.dataTransfer.types.includes(dragType('scene'))) { e.preventDefault(); lane.classList.add('drop'); } });
      lane.addEventListener('dragleave', () => lane.classList.remove('drop'));
      lane.addEventListener('drop', e => {
        lane.classList.remove('drop');
        const d = e.dataTransfer.getData(dragType('scene'));
        if (!d) return;
        e.preventDefault();
        const [zid, sid] = d.split(':');
        if (zid !== z.id) { toast(`That scene is ${(zoneById(zid) || {}).name}'s: drop it on its own track.`, 'warn'); return; }
        addClip(T, z, sid, tlSnapT(T, (e.clientX - lane.getBoundingClientRect().left) / ui.tlZoom), k);
      });
      lane.addEventListener('dblclick', e => {
        if (e.target !== lane) return;
        const t = tlSnapT(T, (e.clientX - lane.getBoundingClientRect().left) / ui.tlZoom);
        if (!z.scenes.length) { toast(`${z.name} has no scenes yet: store one first.`, 'warn'); return; }
        menu({ x: e.clientX, y: e.clientY }, [{ head: `${z.name} at ${fmtTime(t)}` }, ...z.scenes.map(sc => [sc.name, () => addClip(T, z, sc.id, t, k)])]);
      });
      const top = k === n - 1;
      // a lane with a clip unfolded is as tall as its keyframes need
      const rows = clips.filter(c => (c.lane || 0) === k && tlIsOpen(c)).reduce((m, c) => Math.max(m, tlParamCurves(c).length || 1), 0);
      const label = h('div', { class: 'tllabel' + (top ? '' : ' sub'), style: z.tag ? { '--tag': z.tag } : null },
        h('span', { class: 'tlz' }, top ? z.name : ''),
        n > 1 ? h('span', { class: 'tlln mono', title: 'Lane ' + (k + 1) + (top ? ': shows over the lanes below' : '') }, String(k + 1)) : null,
        top ? h('span', { class: 'tllbtns' },
          h('button', { type: 'button', class: 'tllb', title: 'A lane on top: its clips show over the ones below, and hand back to them as they end', 'aria-label': 'Add a lane to ' + z.name, onclick: () => addLane(T, z) }, '+'),
          n > 1 ? h('button', { type: 'button', class: 'tllb', title: 'Remove the top lane (when it has no clips)', 'aria-label': 'Remove a lane from ' + z.name, onclick: () => removeLane(T, z) }, '−') : null) : null);
      grid.append(h('div', { class: 'tlrow' + (top ? '' : ' sub'), style: rows ? { height: tlRow() + rows * TL_KROW + 'px' } : null }, label, lane));
    }
  }
  // over all of it: the loop's region and the playhead
  // the markers' lines through the zones
  for (const m of T.markers || []) grid.append(h('div', { class: 'tlmline', 'data-marker': m.id, style: { left: TL_LABEL + m.t * ui.tlZoom + 'px', '--tag': m.color || null } }));
  if (T.loop.mode === 'region') grid.append(h('div', { class: 'tlloopcol', style: { left: TL_LABEL + T.loop.a * ui.tlZoom + 'px', width: (T.loop.b - T.loop.a) * ui.tlZoom + 'px' } }));
  grid.append(h('div', { class: 'tlhead', 'data-tl-head': '', style: { left: TL_LABEL + (mine ? tlPos() : 0) * ui.tlZoom + 'px' } }));
  return scroll;
}
// Zoom: the tracks drawn again at the new scale, the time under the mouse (or the middle of the view) kept where it is
function tlZoomTo(z, at) {
  const T = shownTimeline();
  if (!T) return;
  z = Math.round(clamp(z, 4, 240) * 100) / 100;
  if (z === ui.tlZoom) return;
  const old = ui.tlZoom;
  ui.tlZoom = z;
  for (const r of tlRoots()) {
    const sc = $('.tlscroll', r);
    if (!sc) continue;
    const x = at ?? TL_LABEL + (sc.clientWidth - TL_LABEL) / 2, t = (sc.scrollLeft + x - TL_LABEL) / old;
    const n = tlTracks(T, tl.id === T.id);
    sc.replaceWith(n);
    n.scrollLeft = Math.max(0, t * z - x + TL_LABEL);
  }
  tlBarsSync(true);
}
// A clip: where and how long, its scene's name, its fades drawn as the level's line, handles to change each
// A clip: the logo's two cuts, like a scene's tile; a header with its scene's name over a filmstrip of the scene's
// snapshot (or a quiet hatch), the strip fading in and out over the clip's fades (a mask), the fades' handles on its top
function paintClip(el, c) {
  const z = ui.tlZoom, w = Math.max(4, c.dur * z), fi = Math.min(c.fadeIn * z, w), fo = Math.min(c.fadeOut * z, w);
  el.style.left = c.start * z + 'px'; el.style.width = w + 'px';
  el.style.setProperty('--fi', fi + 'px'); el.style.setProperty('--fo', fo + 'px');
  el.querySelector('.tlfin').style.left = fi + 'px';
  el.querySelector('.tlfout').style.left = w - fo + 'px';
}
function clipEl(T, z, c) {
  const sc = z.scenes.find(s => s.id === c.scene);
  const open = tlIsOpen(c), keyed = !!(c.curves && c.curves.length), level = tlLevelCurve(c);
  const el = h('div', { class: 'tlclip' + (ui.tlSel === c.id ? ' sel' : '') + (open ? ' open' : '') + (keyed ? ' keyed' : ''), 'data-clip': c.id, style: z.tag ? { '--tag': z.tag } : null,
    title: `${sc ? sc.name : '?'}: ${fmtTime(c.start)} for ${fmtV(Math.round(c.dur * 100) / 100)} s. Drag to move, its edges to resize, the top corners for its fades, double-click for its keyframes. Right-click for more.` },
    h('span', { class: 'tlin' }, h('span', { class: 'tlhdr' }, sc ? sc.name : '?'),
      h('span', { class: 'tlstrip' + (sc && sc.thumb ? ' shot' : ''), style: sc && sc.thumb ? { backgroundImage: `url("${sc.thumb}")` } : null }),
      open || level ? h('span', { class: 'tllevel' }) : null,
      open ? h('span', { class: 'tlkeys' }) : null),
    h('span', { class: 'tledge l' }), h('span', { class: 'tledge r' }),
    h('span', { class: 'tlfin', title: 'Fade in: drag' }), h('span', { class: 'tlfout', title: 'Fade out: drag' }),
    h('button', { type: 'button', class: 'tlunf', 'aria-expanded': String(open), 'aria-label': (open ? 'Fold ' : 'Unfold ') + (sc ? sc.name : 'the clip') + '\'s keyframes',
      title: open ? 'Fold its keyframes' : keyed ? 'Its keyframes (' + c.curves.length + ')' : 'Keyframes: animate its level and its effects\' controls',
      onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); tlToggleOpen(c); } }, keyed ? '◆' : ''),
    open ? h('button', { type: 'button', class: 'tlkplus', title: 'Animate a control of its effects, or its level', 'aria-label': 'Add a control to animate',
      onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); curveMenu(e.currentTarget, T, z, c); } }, '+') : null);
  paintClip(el, c);
  paintLevel(el, T, z, c);
  if (open) paintKeys(el, T, z, c);
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const part = e.target.classList.contains('tlfin') ? 'fin' : e.target.classList.contains('tlfout') ? 'fout' : e.target.classList.contains('tledge') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
    if (ui.tlSel !== c.id) { ui.tlSel = c.id; for (const o of $$('.tlclip.sel', el.ownerDocument)) o.classList.remove('sel'); el.classList.add('sel'); }
    // its neighbours on its lane bound it; dragged up or down onto another lane with room, it goes there
    const clips = T.tracks[z.id], x0 = e.clientX, y0 = e.clientY, o = { start: c.start, dur: c.dur, fadeIn: c.fadeIn, fadeOut: c.fadeOut, lane: c.lane || 0 };
    // its keys stay where they are in time when its start is trimmed
    const kt = (c.curves || []).map(cv => cv.keys.map(k => k.t));
    tlKeys.clear();
    let lo = 0, hi = T.length;
    const bounds = () => {
      const mine = clips.filter(x => x !== c && (x.lane || 0) === (c.lane || 0));
      lo = mine.filter(x => x.start < c.start).reduce((m, x) => Math.max(m, x.start + x.dur), 0);
      hi = mine.filter(x => x.start >= c.start).reduce((m, x) => Math.min(m, x.start), T.length);
    };
    bounds();
    const lanes = [...el.ownerDocument.querySelectorAll('.tltrack[data-zone="' + z.id + '"]')];
    const fits = k => !clips.some(x => x !== c && (x.lane || 0) === k && x.start < c.start + c.dur - 1e-6 && c.start < x.start + x.dur - 1e-6);
    el.setPointerCapture(e.pointerId); tlDrag = true;
    let moved = false;
    const mv = ev => {
      const d = (ev.clientX - x0) / ui.tlZoom;
      if (Math.abs(ev.clientX - x0) > 2 || Math.abs(ev.clientY - y0) > 4) moved = true;
      if (!moved) return;
      if (part === 'move') {
        const to = lanes.find(L => { const r = L.getBoundingClientRect(); return ev.clientY >= r.top && ev.clientY < r.bottom; });
        const k = to ? +to.dataset.lane : c.lane || 0;
        if (k !== (c.lane || 0) && fits(k)) { c.lane = k; to.append(el); bounds(); }
        c.start = clamp(tlSnapT(T, o.start + d, c), lo, hi - c.dur); const e2 = tlSnapT(T, c.start + c.dur, c); if (e2 !== c.start + c.dur && e2 - c.dur >= lo && e2 <= hi) c.start = e2 - c.dur;
      }
      else if (part === 'l') {
        const s = clamp(tlSnapT(T, o.start + d, c), lo, o.start + o.dur - 0.1); c.dur = o.start + o.dur - s; c.start = s;
        (c.curves || []).forEach((cv, i) => cv.keys.forEach((k, j) => { k.t = kt[i][j] - (s - o.start); }));
      }
      else if (part === 'r') { const en = clamp(tlSnapT(T, o.start + o.dur + d, c), o.start + 0.1, hi); c.dur = en - o.start; }
      else if (part === 'fin') c.fadeIn = clamp(o.fadeIn + d, 0, c.dur - c.fadeOut);
      else c.fadeOut = clamp(o.fadeOut - d, 0, c.dur - c.fadeIn);
      c.fadeIn = Math.min(c.fadeIn, c.dur); c.fadeOut = Math.min(c.fadeOut, c.dur - c.fadeIn);
      paintClip(el, c);
      if (part !== 'move') paintLevel(el, T, z, c);
      if ((part === 'l' || part === 'r') && tlIsOpen(c)) paintKeys(el, T, z, c);
    };
    const up = () => {
      for (const t of ['pointermove', 'pointerup', 'pointercancel']) win.removeEventListener(t, t === 'pointermove' ? mv : up);
      tlDrag = false;
      // a click alone only picks it (drawn already): drawn again, a double-click would land on another element
      if (moved) { tl.clips[z.id] = undefined; commit({ lists: false }); refreshTimeline(); }
      else if (tlPending) refreshTimeline();
    };
    // on the window: moved to another lane, the clip leaves its place in the page and the browser lets go of it
    const win = el.ownerDocument.defaultView;
    win.addEventListener('pointermove', mv); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up);
  });
  // (the clip holds the pointer once pressed, so a double-click on its picture comes here: a level key, when unfolded)
  el.addEventListener('dblclick', e => {
    e.stopPropagation();
    if (e.target.closest('.tlkeys')) return;
    const ov = el.querySelector('.tllevel'), r = ov && ov.getBoundingClientRect();
    if (tlIsOpen(c) && r && e.clientY >= r.top && e.clientY <= r.bottom && ov._dbl) { ov._dbl(e); return; }
    tlToggleOpen(c);
  });
  onRightClick(el, e => clipMenu(e, T, z, c));
  return el;
}
// An audio track's block: its name over its waveform, from its start for as long as it plays; dragged to move it, by
// its edges to trim the file's start or end (its keys staying put in time); its volume a line on the waveform, keys
// added by a double-click there and dragged as a clip's level
function paintAudio(el, A) {
  const z = ui.tlZoom;
  el.style.left = A.start * z + 'px'; el.style.width = Math.max(4, A.dur * z) + 'px';
  const wv = el.querySelector('.tlwave');
  if (wv) wv.style.marginLeft = -A.trim * z + 'px';
}
function audioEl(T, A) {
  // a file shorter than the track was thought (an older project): the track ends with the file
  if (tlAudioFile(A) && A.dur > tlAudioLen(A) + 1e-3) A.dur = tlAudioLen(A);
  const el = h('div', { class: 'tlclip tlaclip' + (ui.tlSel === A.id ? ' sel' : '') + (A.mute ? ' muted' : ''), 'data-audio': A.id,
    title: `${A.name}: ${fmtTime(A.start)} for ${fmtV(Math.round(A.dur * 100) / 100)} s${A.trim ? ', from ' + fmtTime(A.trim) + ' into the file' : ''}. Drag to move, its edges to trim, double-click the line for a volume key. Right-click for more.` },
    h('span', { class: 'tlin' }, h('span', { class: 'tlhdr' }, A.name), h('span', { class: 'tlstrip' }, waveform(A)), h('span', { class: 'tllevel' })),
    h('span', { class: 'tledge l', title: 'Trim its start: drag' }), h('span', { class: 'tledge r', title: 'Trim its end: drag' }));
  paintAudio(el, A);
  paintLevel(el, T, null, A);
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const part = e.target.classList.contains('tledge') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
    if (ui.tlSel !== A.id) { ui.tlSel = A.id; for (const o of $$('.tlclip.sel', el.ownerDocument)) o.classList.remove('sel'); el.classList.add('sel'); }
    tlKeys.clear();
    const x0 = e.clientX, o = { start: A.start, trim: A.trim, dur: A.dur }, file = tlAudioFile(A), kt = (A.curves || []).map(cv => cv.keys.map(k => k.t));
    let moved = false;
    tlDrag = true;
    const mv = ev => {
      const d = (ev.clientX - x0) / ui.tlZoom;
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      if (!moved) return;
      if (part === 'move') {
        A.start = clamp(tlSnapT(T, o.start + d, A), 0, T.length - 0.1);
        const e2 = tlSnapT(T, A.start + A.dur, A);
        if (e2 !== A.start + A.dur && e2 - A.dur >= 0) A.start = e2 - A.dur;
      } else if (part === 'l') {
        // no further back than the file's start, nor before the timeline's
        const s = clamp(tlSnapT(T, o.start + d, A), Math.max(0, o.start - o.trim), o.start + o.dur - 0.1), dd = s - o.start;
        A.start = s; A.trim = Math.max(0, o.trim + dd); A.dur = o.dur - dd;
        (A.curves || []).forEach((cv, i) => cv.keys.forEach((k, j) => { k.t = kt[i][j] - dd; }));
      } else {
        const en = clamp(tlSnapT(T, o.start + o.dur + d, A), o.start + 0.1, file ? o.start + file - o.trim : Infinity);
        A.dur = en - o.start;
      }
      paintAudio(el, A);
      if (part !== 'move') paintLevel(el, T, null, A);
    };
    const up = () => {
      for (const t of ['pointermove', 'pointerup', 'pointercancel']) win.removeEventListener(t, t === 'pointermove' ? mv : up);
      tlDrag = false;
      if (moved) { commit({ lists: false }); if (tl.id === T.id) tlAudioSync(T, tlPos(), tl.playing); refreshTimeline(); }
      else if (tlPending) refreshTimeline();
    };
    const win = el.ownerDocument.defaultView;
    win.addEventListener('pointermove', mv); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', e => {
    e.stopPropagation();
    const ov = el.querySelector('.tllevel');
    if (ov && ov._dbl) ov._dbl(e);
  });
  onRightClick(el, e => audioMenu(e, T, A));
  return el;
}
function tlAudioMute(T, A) {
  if (A.mute) delete A.mute; else A.mute = true;
  tlAudioSync(T, tlPos(), tl.playing && tl.id === T.id, false);
  commit({ lists: false }); refreshTimeline();
}
function audioMenu(anchor, T, A) {
  ui.tlSel = A.id;
  const fileIn = h('input', { type: 'file', accept: 'audio/*', onchange: e => { const f = e.target.files[0]; if (f) addTimelineAudio(T, f, 0, A); } });
  menu(anchor, [
    { head: A.name },
    ['Play from here', () => { tlSeek(T, A.start); tlPlay(T); }],
    [A.mute ? 'Sound on' : 'Mute', () => tlAudioMute(T, A)],
    ['Find the tempo in it', () => tlDetect(T, true, A)],
    ['Volume keys: remove all', () => { delete A.curves; commit({ lists: false }); tlKeysChanged(T); }, { disabled: !(A.curves && A.curves.length) }],
    ['Another file in its place…', () => fileIn.click()],
    ['Remove', () => removeTimelineAudio(T, A), { key: 'Del' }],
  ]);
}
function clipMenu(anchor, T, z, c) {
  ui.tlSel = c.id;
  menu(anchor, [
    { head: (z.scenes.find(s => s.id === c.scene) || { name: '?' }).name + ' · ' + z.name },
    ['Play from here', () => { tlSeek(T, c.start); tlPlay(T); }],
    [tlIsOpen(c) ? 'Fold keyframes' : 'Keyframes', () => tlToggleOpen(c)],
    ['Scene', null, { sub: z.scenes.map(sc => [sc.name, () => { c.scene = sc.id; tl.clips[z.id] = undefined; commit({ lists: false }); refreshTimeline(); }, { key: sc.id === c.scene ? '✓' : '' }]) }],
    ['Duplicate after it', () => duplicateClip(T, z, c)],
    ['Delete', () => deleteClip(T, z, c), { key: 'Del' }],
  ]);
}
// A loop marker dragged on the ruler
function dragMark(e, T, k, m, ruler) {
  e.preventDefault(); m.setPointerCapture(e.pointerId); tlDrag = true;
  const mv = ev => {
    const t = tlSnapT(T, (ev.clientX - ruler.getBoundingClientRect().left) / ui.tlZoom);
    T.loop[k] = k === 'a' ? clamp(t, 0, T.loop.b - 0.1) : clamp(t, T.loop.a + 0.1, T.length);
    m.style.left = T.loop[k] * ui.tlZoom + 'px';
    const band = ruler.querySelector('.tlloop');
    if (band) { band.style.left = T.loop.a * ui.tlZoom + 'px'; band.style.width = (T.loop.b - T.loop.a) * ui.tlZoom + 'px'; }
  };
  const up = () => { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); m.removeEventListener('pointercancel', up); tlDrag = false; commit({ lists: false }); refreshTimeline(); };
  m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up); m.addEventListener('pointercancel', up);
}
// An audio track's waveform: its peaks worked out once per file (in the background), drawn at the zoom (the whole
// file, moved left by its trim)
const tlPeaks = new Map();
function waveform(A) {
  const a = tlAudio(A), key = A.media || A._url;
  // read once: stored in the library meanwhile (or while it is read), it keeps what is worked out from the file
  if (!tlPeaks.has(key) && A._url && tlPeaks.get(A._url)) tlPeaks.set(key, tlPeaks.get(A._url));
  const P = tlPeaks.get(key);
  const dur = P && P.dur ? P.dur : (a && isFinite(a.duration) ? a.duration : 0);
  if (!P && key) {
    tlPeaks.set(key, { loading: true });
    fetch(A.media ? mediaUrl(A.media) : A._url).then(r => r.arrayBuffer())
      .then(b => new OfflineAudioContext(1, 1, 44100).decodeAudioData(b))
      .then(buf => {
        const d = buf.getChannelData(0), N = 4000, n = Math.max(1, Math.floor(d.length / N)), pk = new Float32Array(N);
        for (let i = 0; i < N; i++) { let m = 0; for (let j = i * n, e = Math.min(d.length, j + n); j < e; j++) { const v = Math.abs(d[j]); if (v > m) m = v; } pk[i] = m; }
        const R = { pk, dur: buf.duration, beat: tlDetectBeat(buf) };
        for (const k of [key, A.media, A._url]) if (k) tlPeaks.set(k, R);
        // a file just added: its tempo found by itself
        for (const K of project.timelines) for (const B of K.audios) if (B._detect && (B.media === key || B._url === key)) { delete B._detect; tlDetect(K, false, B); }
        refreshTimeline();
      }).catch(() => tlPeaks.set(key, { failed: true }));
  }
  if (!P || !P.pk) return h('span', { class: 'tlhint in' }, (P && P.failed ? 'Can\'t read ' : 'Reading ') + A.name + (P && P.failed ? '' : '…'));
  const w = Math.max(1, Math.min(16000, Math.round(dur * ui.tlZoom))), H = Math.max(8, tlRow() - 26), c = h('canvas', { class: 'tlwave', width: w, height: H, style: { width: dur * ui.tlZoom + 'px', height: H + 'px', marginLeft: -A.trim * ui.tlZoom + 'px' } });
  const g = c.getContext('2d');
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fader').trim() || '#999';
  for (let x = 0; x < w; x++) { const v = P.pk[Math.min(P.pk.length - 1, Math.floor(x / w * P.pk.length))], hh = Math.max(1, v * H); g.fillRect(x, (H - hh) / 2, 1, hh); }
  return c;
}
function timelineMenu(anchor, T) {
  menu(anchor, [
    ['Rename…', () => timelineDialog(T)],
    ['Length…', () => timelineDialog(T)],
    ['Delete', () => confirmBox(`Delete ${T.name}?`, `Its clips go with it. ${MOD}Z brings it back.`, 'Delete', () => deleteTimeline(T))],
  ]);
}
function timelineDialog(T) {
  const tmp = { name: T.name, length: T.length };
  const close = () => bg.remove();
  const save = () => { T.name = tmp.name.trim() || T.name; setTimelineLength(T, tmp.length); close(); commit({ lists: false }); refreshTimeline(); };
  const nameIn = textInput(tmp, 'name', { aria: 'Timeline name' });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Timeline' },
      h('header', null, 'Timeline'),
      h('div', { class: 'mb' }, row('Name', nameIn), numRow('Length (s)', tmp, 'length', { min: 1, max: 36000, step: 1 })),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'))));
  uiDocNow().body.append(bg);
  nameIn.focus(); nameIn.select();
}
// Once a frame: the playhead and the time, the view following the playhead while it plays
function drawTimelineHead() {
  if (!timelineShown()) return;
  const T = shownTimeline();
  if (!T) return;
  const p = tl.id === T.id ? tlPos() : 0, x = TL_LABEL + p * ui.tlZoom;
  for (const r of tlRoots()) {
    const hd = $('[data-tl-head]', r), tm = $('[data-tl-time]', r), sc = $('.tlscroll', r);
    if (hd && hd.style.left !== x + 'px') hd.style.left = x + 'px';
    if (tm && tm.firstChild && tm.firstChild.nodeType === 3) { const s = fmtTime(p); if (tm.firstChild.nodeValue !== s) tm.firstChild.nodeValue = s; }
    if (sc && tl.playing && tl.id === T.id && !tlDrag) {
      const vis = sc.clientWidth - TL_LABEL;
      if (x - sc.scrollLeft > TL_LABEL + vis - 20 || x - sc.scrollLeft < TL_LABEL) sc.scrollLeft = Math.max(0, x - TL_LABEL - 40);
    }
  }
  tlBarsSync();
  // the clips showing now: a white edge and a small red square, as a scene playing
  const live = tl.id === T.id ? Object.values(tl.clips).filter(Boolean).join(' ') : '';
  for (const r of tlRoots()) if (r._tlLive !== live) { r._tlLive = live; for (const el of $$('.tlclip', r)) el.classList.toggle('live', live.includes(el.dataset.clip)); }
  // the play button follows a timeline that stopped by itself
  const pb = tlRoots().map(r => $('.tlplay', r)).find(Boolean);
  if (pb && pb.classList.contains('on') !== (tl.playing && tl.id === T.id)) refreshTimeline();
}
// The clip picked goes with Delete or Backspace while the timeline shows
document.addEventListener('keydown', e => {
  if (!(ui.tlSel || tlKeys.size) || !timelineShown() || typingIn(e.target) || !(e.key === 'Delete' || e.key === 'Backspace')) return;
  const T = shownTimeline();
  // the keys picked go before their clip
  if (tlKeys.size && T) {
    const items = [];
    for (const c of Object.values(T.tracks).flat().concat(T.audios)) for (const cv of c.curves || []) for (const k of cv.keys) if (tlKeys.has(k)) items.push({ c, cv, k });
    tlKeys.clear();
    if (items.length) { e.preventDefault(); e.stopPropagation(); deleteKeys(T, items); return; }
  }
  const A = T && T.audios.find(x => x.id === ui.tlSel);
  if (A) { e.preventDefault(); e.stopPropagation(); removeTimelineAudio(T, A); return; }
  for (const [zid, cs] of Object.entries((T && T.tracks) || {})) {
    const c = cs.find(x => x.id === ui.tlSel);
    if (c) { e.preventDefault(); e.stopPropagation(); deleteClip(T, zoneById(zid), c); return; }
  }
}, true);

/* ---------- keyframes ---------- */
// A value as a share of its control's range (0 to 1), and back; colours and points have no one height
function tlRange(inp, k) {
  const at = (m, d) => (Array.isArray(m) ? m[k] : m) ?? d;
  const lo = at(inp.MIN, 0), hi = at(inp.MAX, 1);
  return isFinite(lo) && isFinite(hi) && hi > lo ? [lo, hi] : [0, 1];
}
function tlNorm(inp, v, k = 0) {
  if (!inp) return 0.5;
  if (inp.TYPE === 'bool' || inp.TYPE === 'event') return v ? 1 : 0;
  if (inp.TYPE === 'long' && inp.VALUES) { const i = inp.VALUES.indexOf(v); return inp.VALUES.length > 1 ? Math.max(0, i) / (inp.VALUES.length - 1) : 0.5; }
  const [lo, hi] = tlRange(inp, k), x = Array.isArray(v) ? v[k] : v, n = clamp(((+x || 0) - lo) / (hi - lo), 0, 1);
  return inp._flip ? 1 - n : n;
}
function tlFromNorm(inp, f) {
  if (!inp || inp.TYPE === 'color' || inp.TYPE === 'point2D') return undefined;
  f = clamp(f, 0, 1);
  if (inp._flip) f = 1 - f;
  if (inp.TYPE === 'bool' || inp.TYPE === 'event') return f >= 0.5;
  if (inp.TYPE === 'long' && inp.VALUES) return inp.VALUES[Math.round(f * (inp.VALUES.length - 1))];
  const [lo, hi] = tlRange(inp, 0);
  let v = lo + f * (hi - lo);
  // a range across zero: a small magnet there, so a still or centred value is easy to land on
  if (lo < 0 && hi > 0 && Math.abs(v) < (hi - lo) * 0.03) v = 0;
  return inp.TYPE === 'int' ? Math.round(v) : Math.round(v * 1000) / 1000;
}
// What a row draws and drags: the control as it is, but an effect's Speed as the Content tab shows it, from still at the
// bottom to full at the top, in its own direction (a curve whose keys all run in reverse: full reverse at the top), so
// pulling a key up always makes it faster and never crosses into the other direction
function tlRowInput(cv) {
  const inp = tlCurveInput(cv), src = cv.kind === 'param' && srcById(cv.src);
  if (!inp || !src || !isSpeedInput(src, inp)) return inp;
  const top = speedTop(inp), rev = (inp.MIN ?? 0) < 0 && cv.keys.length > 0 && cv.keys.every(k => +k.v <= 0) && cv.keys.some(k => +k.v < 0);
  return Object.assign({}, inp, rev ? { MIN: -top, MAX: 0, _flip: true, LABEL: (inp.LABEL || inp.NAME) + ' (reverse)' } : { MIN: 0, MAX: top });
}
const tlCurveName = (cv, inp) => (cv.kind === 'level' ? 'Level' : inp ? inp.LABEL || inp.NAME : cv.ctl);
const tlLevelCurve = c => (c.curves || []).find(cv => cv.kind === 'level') || null;
const tlParamCurves = c => (c.curves || []).filter(cv => cv.kind !== 'level');
// Where a share of a range is drawn in a row (or the picture) H high
const tlYOf = (f, H) => 3 + (1 - f) * (H - 7);
const tlFOf = (y, H) => 1 - (y - 3) / (H - 7);
const tlStripH = () => tlRow() - 25;
const tlRgb = v => 'rgb(' + [0, 1, 2].map(i => Math.round(clamp((v || [])[i] ?? 0, 0, 1) * 255)).join(',') + ')';
// A curve's value at about every 2px through the clip, and on each side of every key (a step shows as a step)
function tlSamples(c, cv) {
  const z = ui.tlZoom, w = Math.max(4, c.dur * z), ts = new Set(), step = Math.max(2, w / 1500) / z;
  for (let t = 0; t <= c.dur + 1e-9; t += step) ts.add(+t.toFixed(4));
  ts.add(+c.dur.toFixed(4));
  for (const k of cv.keys) if (k.t >= 0 && k.t <= c.dur) { ts.add(k.t); ts.add(Math.max(0, k.t - 0.0005)); }
  return [...ts].sort((a, b) => a - b);
}
function keyEl(c, cv, k, x, y) {
  const inp = tlCurveInput(cv);
  const el = h('span', { class: 'tlkey ' + k.ease + (tlKeys.has(k) ? ' sel' : '') + (cv.kind === 'level' ? ' lvl' : ''), style: { left: x + 'px', top: y + 'px' },
    title: tlCurveName(cv, inp) + ' at ' + fmtTime(c.start + k.t) + ' · ' + (cv.kind === 'level' ? Math.round(k.v * 100) + '%' : inp ? valueText(inp, k.v) : '') +
      '. Drag it (Shift-click or drag a box for several); right-click for its ease or value' });
  el._key = k; el._cv = cv;
  return el;
}
// A clip's keyframe rows (its effects' controls), drawn again after its size or a key changes
function paintKeys(el, T, z, c) {
  const box = el.querySelector('.tlkeys');
  if (!box) return;
  const cvs = tlParamCurves(c);
  box.replaceChildren(...(cvs.length ? cvs.map(cv => keyRow(T, z, c, cv, el)) : [hintRow(T, z, c)]));
}
// The level: a line on the clip's picture (full at the top), its keys on it; the picture as bright as fades × level
function paintLevel(el, T, z, c) {
  const ov = el.querySelector('.tllevel'), strip = el.querySelector('.tlstrip');
  const cv = tlLevelCurve(c), w = Math.max(4, c.dur * ui.tlZoom), H = tlStripH();
  if (strip) {
    if (cv) {
      const n = Math.max(8, Math.min(120, Math.round(w / 4))), stops = [];
      for (let i = 0; i <= n; i++) {
        const t = c.dur * i / n, f = Math.min(1, c.fadeIn > 0 ? t / c.fadeIn : 1, c.fadeOut > 0 ? (c.dur - t) / c.fadeOut : 1);
        stops.push(`rgba(0,0,0,${(clamp(f, 0, 1) * clamp(+tlCurveAt(cv, t, TL_LEVEL) || 0, 0, 1)).toFixed(3)}) ${(i / n * 100).toFixed(2)}%`);
      }
      strip.style.maskImage = strip.style.webkitMaskImage = 'linear-gradient(to right,' + stops.join(',') + ')';
    } else strip.style.maskImage = strip.style.webkitMaskImage = '';
  }
  if (!ov) return;
  const path = cv ? tlSamples(c, cv).map((t, i) => (i ? 'L' : 'M') + (t * ui.tlZoom).toFixed(1) + ' ' + tlYOf(clamp(+tlCurveAt(cv, t, TL_LEVEL) || 0, 0, 1), H).toFixed(1)).join('')
    : `M0 ${tlYOf(1, H)}L${w} ${tlYOf(1, H)}`;
  ov.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}"><path d="${path}" class="${cv ? '' : 'none'}"/></svg>`;
  ov.title = el.classList.contains('tlaclip') ? 'Volume: double-click the waveform to add a key, drag the line between two keys up or down'
    : tlIsOpen(c) ? 'Level: double-click the picture to add a key, drag the line between two keys up or down' : '';
  if (cv) for (const k of cv.keys) if (k.t >= -1e-6 && k.t <= c.dur + 1e-6) ov.append(keyEl(c, cv, k, k.t * ui.tlZoom, tlYOf(clamp(k.v, 0, 1), H)));
  if (!ov._wired) { ov._wired = true; wireLevel(ov, T, z, c, el); }
}
// On the picture: a key dragged (with the others picked), the line between two keys dragged up or down, a
// double-click adding a key; elsewhere the clip moves as before
function wireLevel(ov, T, z, c, el) {
  const tAt = ev => clamp(tlSnapT(T, c.start + (ev.clientX - ov.getBoundingClientRect().left) / ui.tlZoom, null) - c.start, 0, c.dur);
  const fAt = ev => clamp(tlFOf(ev.clientY - ov.getBoundingClientRect().top, tlStripH()), 0, 1);
  const ensure = () => tlLevelCurve(c) || addCurve(T, z, c, { kind: 'level' }, true);
  ov.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !(tlIsOpen(c) || el.classList.contains('tlaclip'))) return;
    const kel = e.target.closest('.tlkey');
    if (kel) { e.stopPropagation(); e.preventDefault(); pressKey(e, T, z, c, el, kel); return; }
    const t = (e.clientX - ov.getBoundingClientRect().left) / ui.tlZoom, cv = tlLevelCurve(c);
    const y = tlYOf(cv ? clamp(+tlCurveAt(cv, t, TL_LEVEL) || 0, 0, 1) : 1, tlStripH());
    if (Math.abs(e.clientY - ov.getBoundingClientRect().top - y) > 5) return;
    // the line: the two keys either side of the mouse move up or down together
    e.stopPropagation(); e.preventDefault();
    const L = ensure(), K = L.keys, i = K.findIndex(k => k.t > t);
    const moving = i < 0 ? [K[K.length - 1]] : i === 0 ? [K[0]] : [K[i - 1], K[i]];
    dragKeys(e, T, z, c, el, moving.map(k => ({ k, cv: L })), false);
  });
  ov._dbl = e => {
    if (e.target.closest && e.target.closest('.tlkey')) return;
    const L = ensure(), k = setKey(T, c, L, tAt(e), Math.round(fAt(e) * 1000) / 1000);
    tlKeys.clear(); tlKeys.add(k); refreshTimeline();
  };
}
function keyRow(T, z, c, cv, el) {
  const inp = tlRowInput(cv), name = tlCurveName(cv, inp), isCol = !!inp && inp.TYPE === 'color';
  const graph = h('span', { class: 'tlkgraph', title: isCol ? 'Click a key to pick its colour, drag it to move it in time; double-click the band to add a key'
    : 'Double-click to add a key; drag a box to pick several' });
  const row = h('span', { class: 'tlkrow' + (inp ? '' : ' gone') + (isCol ? ' color' : ''), 'data-curve': cv.src + '|' + cv.ctl }, graph,
    h('span', { class: 'tlklab', title: (srcById(cv.src) || { name: 'Missing effect' }).name + ' · ' + name + (inp ? '' : ': not in this clip\'s scene') },
      h('span', { class: 'tlkname' }, name),
      h('button', { type: 'button', class: 'tlkb', title: 'A key at the playhead', 'aria-label': 'Add a key to ' + name + ' at the playhead',
        onclick: () => { const t = (tl.id === T.id ? tlPos() : 0) - c.start; if (t < 0 || t > c.dur) { toast('Put the playhead over the clip first.', 'warn'); return; } const k = setKey(T, c, cv, t, tlCurveAt(cv, t, inp)); tlKeys.clear(); tlKeys.add(k); refreshTimeline(); } }, '◆'),
      h('button', { type: 'button', class: 'tlkb', title: 'Remove this curve', 'aria-label': 'Remove the curve of ' + name, onclick: () => removeCurve(T, c, cv) }, '×')));
  for (const b of row.querySelectorAll('.tlkb')) b.addEventListener('pointerdown', e => e.stopPropagation());
  paintCurve(graph, c, cv, inp);
  const tAt = ev => clamp(tlSnapT(T, c.start + (ev.clientX - graph.getBoundingClientRect().left) / ui.tlZoom, null) - c.start, 0, c.dur);
  const fAt = ev => tlFOf(ev.clientY - graph.getBoundingClientRect().top, TL_KROW);
  let down = null;
  graph.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    const kel = e.target.closest('.tlkey');
    down = kel ? { x: e.clientX, y: e.clientY, k: kel._key } : null;
    if (kel) pressKey(e, T, z, c, el, kel); else boxSelect(e, el);
  });
  if (isCol) graph.addEventListener('click', e => {
    const kel = e.target.closest('.tlkey');
    if (!kel || !down || down.k !== kel._key || e.shiftKey || Math.abs(e.clientX - down.x) > 3 || Math.abs(e.clientY - down.y) > 3) return;
    colorKeyPicker(T, z, c, cv, kel._key, kel);
  });
  graph.addEventListener('dblclick', e => {
    e.stopPropagation();
    if (!inp) return;
    const kel = e.target.closest('.tlkey');
    if (kel) { if (isCol) colorKeyPicker(T, z, c, cv, kel._key, kel); else keyDialog(T, c, cv, kel._key); return; }
    const t = tAt(e), v = tlFromNorm(inp, fAt(e)), k = setKey(T, c, cv, t, v !== undefined ? v : tlCurveAt(cv, t, inp));
    tlKeys.clear(); tlKeys.add(k); refreshTimeline();
  });
  return row;
}
// A key pressed: picked (Shift adds or takes it from the keys picked), then dragged with every key picked in its clip
function pressKey(e, T, z, c, el, kel) {
  const k = kel._key;
  if (e.shiftKey) { if (tlKeys.has(k)) tlKeys.delete(k); else tlKeys.add(k); }
  else if (!tlKeys.has(k)) { tlKeys.clear(); tlKeys.add(k); }
  for (const o of $$('.tlkey', el)) o.classList.toggle('sel', tlKeys.has(o._key));
  if (!tlKeys.has(k)) return;
  const items = (c.curves || []).flatMap(cv => cv.keys.filter(x => tlKeys.has(x)).map(x => ({ k: x, cv })));
  dragKeys(e, T, z, c, el, items, true, k);
}
// Keys dragged together: in time by the same amount (snapped by the one held, none past the clip's ends), in value
// by the same share of each one's range (colours and points keep theirs)
function dragKeys(e, T, z, c, el, items, inTime, held) {
  const x0 = e.clientX, y0 = e.clientY, o = items.map(({ k, cv }) => ({ k, cv, t: k.t, inp: tlRowInput(cv), f: tlNorm(tlRowInput(cv), k.v), H: cv.kind === 'level' ? tlStripH() : TL_KROW }));
  const lo = -Math.min(...o.map(x => x.t)), hi = c.dur - Math.max(...o.map(x => x.t));
  const h0 = held && o.find(x => x.k === held);
  let moved = false;
  tlDrag = true;
  const win = el.ownerDocument.defaultView;
  const mv = ev => {
    if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
    moved = true;
    let dt = 0;
    if (inTime) {
      dt = (ev.clientX - x0) / ui.tlZoom;
      if (h0) dt = tlSnapT(T, c.start + h0.t + dt, null) - c.start - h0.t;
      dt = clamp(dt, lo, hi);
    }
    for (const x of o) {
      x.k.t = x.t + dt;
      const v = tlFromNorm(x.inp, x.f - (ev.clientY - y0) / (x.H - 7));
      if (v !== undefined) x.k.v = v;
    }
    for (const cv of new Set(o.map(x => x.cv))) tlSortKeys(cv);
    paintLevel(el, T, z, c);
    if (tlIsOpen(c)) paintKeys(el, T, z, c);
    if (tl.id === T.id) tlApply(T, tlPos(), false);
  };
  const up = () => {
    for (const t of ['pointermove', 'pointerup', 'pointercancel']) win.removeEventListener(t, t === 'pointermove' ? mv : up);
    tlDrag = false;
    if (moved) { commit({ lists: false }); tlKeysChanged(T); }
  };
  win.addEventListener('pointermove', mv); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up);
}
// A box dragged over a clip's keys picks the ones in it (with Shift, as well as those picked); a click alone lets go
function boxSelect(e, el) {
  const D = el.ownerDocument, win = D.defaultView, x0 = e.clientX, y0 = e.clientY, add = e.shiftKey, before = new Set(tlKeys);
  const band = h('div', { class: 'tlband' });
  D.body.append(band);
  const mv = ev => {
    const l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY), r = Math.max(x0, ev.clientX), b = Math.max(y0, ev.clientY);
    Object.assign(band.style, { left: l + 'px', top: t + 'px', width: r - l + 'px', height: b - t + 'px' });
    tlKeys.clear();
    if (add) for (const k of before) tlKeys.add(k);
    for (const k of $$('.tlkey', el)) {
      const q = k.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2;
      if (cx >= l && cx <= r && cy >= t && cy <= b) tlKeys.add(k._key);
    }
    for (const k of $$('.tlkey', el)) k.classList.toggle('sel', tlKeys.has(k._key));
  };
  const up = () => { band.remove(); for (const t of ['pointermove', 'pointerup', 'pointercancel']) win.removeEventListener(t, t === 'pointermove' ? mv : up); };
  mv(e);
  win.addEventListener('pointermove', mv); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up);
}
// A curve's line (numbers, switches, lists; a point's two) or its colours as a band, and its keys
function paintCurve(graph, c, cv, inp) {
  const z = ui.tlZoom, w = Math.max(4, c.dur * z), H = TL_KROW, T2 = tlSamples(c, cv);
  let svg = '';
  if (inp && inp.TYPE === 'color') {
    const stops = T2.filter((t, i) => i % Math.max(1, Math.floor(T2.length / 120)) === 0 || cv.keys.some(k => Math.abs(k.t - t) < 0.001 || Math.abs(k.t - 0.0005 - t) < 0.001));
    // the band under the row's name, so the name never covers a key
    graph.style.background = 'linear-gradient(to right,' + stops.map(t => tlRgb(tlCurveAt(cv, t, inp)) + ' ' + (t / c.dur * 100).toFixed(3) + '%').join(',') + `) left bottom / 100% ${TL_BAND}px no-repeat`;
  } else {
    graph.style.background = '';
    for (const k of inp && inp.TYPE === 'point2D' ? [0, 1] : [0]) {
      const d = T2.map((t, i) => (i ? 'L' : 'M') + (t * z).toFixed(1) + ' ' + tlYOf(tlNorm(inp, tlCurveAt(cv, t, inp), k), H).toFixed(1)).join('');
      svg += `<path d="${d}" class="${k ? 'y' : ''}"/>`;
    }
  }
  graph.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${svg}</svg>`;
  for (const k of cv.keys) {
    if (k.t < -1e-6 || k.t > c.dur + 1e-6) continue;
    const col = inp && inp.TYPE === 'color';
    const y = col ? H - TL_BAND / 2 - 1 : inp && inp.TYPE !== 'point2D' ? tlYOf(tlNorm(inp, k.v), H) : H / 2 - 1;
    const ke = keyEl(c, cv, k, k.t * z, y);
    if (col) { ke.classList.add('col'); ke.style.setProperty('--kc', tlRgb(k.v)); }
    graph.append(ke);
  }
}
// A colour key's colour, in nouPix's colour picker beside the key: the band and the light follow as it is picked, one step
// of undo when let go
const TL_BAND = 14;
function colorKeyPicker(T, z, c, cv, k, anchor) {
  const inp = tlCurveInput(cv);
  const repaint = () => {
    for (const r of tlRoots()) { const el = $(`.tlclip[data-clip="${c.id}"]`, r); if (el) paintKeys(el, T, z, c); }
    if (tl.id === T.id) tlApply(T, tlPos(), false);
  };
  openColorPicker(anchor, { label: tlCurveName(cv, inp) + ' at ' + fmtTime(c.start + k.t), key: 'tlkey:' + c.id + ':' + cv.src + ':' + cv.ctl,
    get: () => (Array.isArray(k.v) ? [0, 1, 2, 3].map(i => k.v[i] ?? 1) : [1, 1, 1, 1]),
    set: v => { k.v = v.slice(0, 4); repaint(); },
    done: () => { commit({ lists: false }); if (tl.id === T.id) tlApply(T, tlPos(), false); } });
}
// A key's menu: its ease (for every key picked), its value, Delete
document.addEventListener('contextmenu', e => {
  const kel = e.target.closest && e.target.closest('.tlclip .tlkey');
  if (!kel) return;
  e.preventDefault(); e.stopPropagation();
  const T = shownTimeline(), k = kel._key, cv = kel._cv;
  let c = null, zc = null;
  for (const [zid, cs] of Object.entries((T && T.tracks) || {})) for (const x of cs) if ((x.curves || []).includes(cv)) { c = x; zc = zoneById(zid); }
  if (!c) return;
  if (!tlKeys.has(k)) { tlKeys.clear(); tlKeys.add(k); }
  const picked = (c.curves || []).flatMap(v => v.keys.filter(x => tlKeys.has(x)).map(x => ({ c, cv: v, k: x })));
  const ease = v => () => { for (const p of picked) p.k.ease = v; commit({ lists: false }); tlKeysChanged(T); };
  const all = picked.every(p => p.k.ease === k.ease) ? k.ease : '';
  menu(e, [
    { head: picked.length > 1 ? picked.length + ' keys' : tlCurveName(cv, tlCurveInput(cv)) + ' at ' + fmtTime(c.start + k.t) },
    ['Linear', ease('linear'), { key: all === 'linear' ? '✓' : '' }],
    ['Ease in and out', ease('ease'), { key: all === 'ease' ? '✓' : '' }],
    ['Hold', ease('hold'), { key: all === 'hold' ? '✓' : '' }],
    picked.length === 1 ? (tlCurveInput(cv) && tlCurveInput(cv).TYPE === 'color' ? ['Colour…', () => colorKeyPicker(T, zc, c, cv, k, kel)] : ['Value…', () => keyDialog(T, c, cv, k)]) : null,
    ['Delete', () => { tlKeys.clear(); deleteKeys(T, picked); }, { key: 'Del' }],
  ]);
}, true);
// + Control: a control of the clip's scene's effects (or its level), from the header's + or the empty row
function curveMenu(anchor, T, z, c) {
  const has = key => (c.curves || []).some(cv => (cv.kind === 'level' ? 'level' : cv.src + '|' + cv.ctl) === key);
  const sc = z.scenes.find(s => s.id === c.scene), srcs = sc ? [...new Set(sc.layers.map(L => L.src))].map(srcById).filter(s => s && s.kind === 'isf') : [];
  const items = [{ head: 'Animate in this clip' }];
  if (!has('level')) items.push(['Level', () => addCurve(T, z, c, { kind: 'level' })]);
  for (const s of srcs) {
    const sub = controlsOf(s).filter(inp => !has(s.id + '|' + inp.NAME)).map(inp => [inp.LABEL || inp.NAME, () => addCurve(T, z, c, { kind: 'param', src: s.id, ctl: inp.NAME })]);
    if (sub.length) items.push([s.name, null, { sub }]);
  }
  if (items.length === 1) items.push(['Nothing more to animate', null, { disabled: true }]);
  menu(anchor, items);
}
function hintRow(T, z, c) {
  const b = h('button', { type: 'button', class: 'tlkadd', title: 'Animate a control of its effects', onclick: e => curveMenu(e.currentTarget, T, z, c) }, '+ Control');
  b.addEventListener('pointerdown', e => e.stopPropagation());
  return h('span', { class: 'tlkrow add' }, b, h('span', { class: 'tlkhint' }, 'The level: double-click the picture'));
}
// A key's value typed or chosen, as its control takes it
function keyDialog(T, c, cv, k) {
  const tmp = { src: cv.kind === 'level' ? '' : cv.src, ctl: cv.kind === 'level' ? '' : cv.ctl, value: Array.isArray(k.v) ? k.v.slice() : k.v };
  const close = () => bg.remove();
  const save = () => { k.v = cv.kind === 'level' ? clamp(+tmp.value || 0, 0, 1) : tmp.value; close(); commit({ lists: false }); tlKeysChanged(T); };
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Key' },
      h('header', null, tlCurveName(cv, tlCurveInput(cv)) + ' at ' + fmtTime(c.start + k.t)),
      h('div', { class: 'mb' }, row('Value', valueEditor(tmp, fn => e => fn(e.target)))),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'))));
  uiDocNow().body.append(bg);
}
// The audio's tempo and first downbeat (worked out with its waveform): the grid in bars from them
function tlDetect(T, asked, A = T.audios[0]) {
  if (!A) return;
  const P = tlPeakOf(A);
  if (!P || !P.pk) { if (asked) { A._detect = true; toast('Reading the audio first…'); } return; }
  const b = P.beat;
  // said either way, asked or not: what was found, or that nothing was
  if (!b || b.weak) { toast('No steady beat found in ' + A.name + '. Type its BPM instead.', 'warn'); return; }
  // bar 1 where the file's falls on the timeline (from where the track starts, less its trim), the first one after 0
  const bar = 60 / b.bpm * 4;
  let t0 = A.start - A.trim + b.t0;
  while (t0 < 0) t0 += bar;
  T.bpm = b.bpm; T.beat0 = Math.round(t0 * 1000) / 1000; T.grid = 'bars';
  commit({ lists: false }); refreshTimeline();
  toast(`${fmtV(b.bpm)} BPM, bar 1 at ${fmtTime(b.t0)}: the grid follows the beat. If it counts twice too fast or slow, ×2 or ÷2; to move bar 1, right-click the ruler.`);
}
// The audio's peaks and beat: under its name in the media library, or the file's own address until it is stored there
function tlPeakOf(A) {
  const a = A && tlPeaks.get(A.media), b = A && tlPeaks.get(A._url);
  return a && a.pk ? a : b && b.pk ? b : a || b || null;
}
// Twice or half the tempo (half-time and double-time count the same music), bar 1 where it was
function tlTempoTimes(T, k) {
  T.bpm = clamp(Math.round(T.bpm * k * 100) / 100, 20, 300);
  commit({ lists: false }); refreshTimeline();
}

/* ---------- markers ---------- */
const MARKER_NAMES = ['Intro', 'Build up', 'Drop', 'Break', 'Outro'];
// A flag on the audio track: clicked, the playhead goes there; dragged, it moves (snapped); double-click to rename;
// right-click for its colour and Delete
function markerEl(T, m) {
  const el = h('div', { class: 'tlflag', 'data-marker': m.id, style: { left: m.t * ui.tlZoom + 'px', '--tag': m.color || null },
    title: `${m.name} at ${fmtTime(m.t)}. Click to go there, drag to move it, double-click to rename it, right-click for more.` },
    h('span', { class: 'tlflagname' }, m.name));
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const lane = el.parentNode, x0 = e.clientX, t0 = m.t;
    let moved = false;
    tlDrag = true;
    const win = el.ownerDocument.defaultView;
    const mv = ev => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      m.t = clamp(tlSnapT(T, t0 + (ev.clientX - x0) / ui.tlZoom), 0, T.length);
      el.style.left = m.t * ui.tlZoom + 'px';
      const line = lane.closest('.tlgrid').querySelector(`.tlmline[data-marker="${m.id}"]`);
      if (line) line.style.left = TL_LABEL + m.t * ui.tlZoom + 'px';
    };
    const up = () => {
      for (const t of ['pointermove', 'pointerup', 'pointercancel']) win.removeEventListener(t, t === 'pointermove' ? mv : up);
      tlDrag = false;
      if (moved) { T.markers.sort((a, b) => a.t - b.t); commit({ lists: false }); refreshTimeline(); }
      else tlSeek(T, m.t);
    };
    win.addEventListener('pointermove', mv); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', e => { e.stopPropagation(); markerDialog(T, m); });
  onRightClick(el, e => menu(e, [
    { head: m.name + ' · ' + fmtTime(m.t) },
    ['Go there', () => { tlSeek(T, m.t); refreshTimeline(); }],
    ['Rename…', () => markerDialog(T, m)],
    ['Colour', null, { sub: [['None', () => { m.color = ''; commit({ lists: false }); refreshTimeline(); }, { key: m.color ? '' : '✓' }],
      ...TAGS.map(c => [h('span', { class: 'swatchdot', style: { background: c } }), () => { m.color = c; commit({ lists: false }); refreshTimeline(); }, { key: m.color === c ? '✓' : '' }])] }],
    ['Delete', () => deleteMarker(T, m)],
  ]));
  return el;
}
// A marker's name (or one of the usual ones) and colour; a new one at a time
function markerDialog(T, m, t) {
  const tmp = { name: m ? m.name : '', tag: m ? m.color : '' };
  const close = () => bg.remove();
  const save = () => {
    const name = tmp.name.trim();
    if (m) { m.name = name || m.name; m.color = tmp.tag; commit({ lists: false }); refreshTimeline(); }
    else addMarker(T, t, name, tmp.tag);
    close();
  };
  const nameIn = textInput(tmp, 'name', { aria: 'Marker name' });
  nameIn.placeholder = 'Marker ' + ((T.markers || []).length + 1);
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(); });
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Marker' },
      h('header', null, m ? 'Marker' : 'New marker at ' + fmtTime(t)),
      h('div', { class: 'mb' }, row('Name', nameIn),
        h('div', { class: 'tlpresets' }, MARKER_NAMES.map(n => h('button', { type: 'button', class: 'btn sm', onclick: () => { tmp.name = n; nameIn.value = n; nameIn.focus(); } }, n))),
        row('Colour', tagSwatches(tmp, 'Marker colour', () => {}))),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, m ? 'Save' : 'Add'))));
  uiDocNow().body.append(bg);
  nameIn.focus(); nameIn.select();
}
// M: a marker at the playhead while the timeline shows
document.addEventListener('keydown', e => {
  if (e.key !== 'm' && e.key !== 'M') return;
  if (e.ctrlKey || e.metaKey || e.altKey || !timelineShown() || typingIn(e.target) || $('.modal-bg')) return;
  const T = shownTimeline();
  if (!T) return;
  e.preventDefault(); e.stopPropagation();
  markerDialog(T, null, tl.id === T.id ? tlPos() : 0);
}, true);

/* ---------- zoom ---------- */
// The tracks' height: drawn again alone, the slider under the mouse staying
function tlRowTo(v) {
  const T = shownTimeline();
  v = clamp(Math.round(v), 30, 160);
  if (!T || v === tlRow()) return;
  ui.tlRowH = v;
  for (const r of tlRoots()) {
    const sc = $('.tlscroll', r);
    if (!sc) continue;
    const x = sc.scrollLeft, y = sc.scrollTop, n = tlTracks(T, tl.id === T.id);
    sc.replaceWith(n); n.scrollLeft = x; n.scrollTop = y;
  }
  tlBarsSync(true);
}
// Fit: from the start to the end of what is on it (clips, markers, the audio, at least 4 s) across the view, and the
// tracks sharing the panel's height
function tlFit(T) {
  const sc = tlRoots().map(r => $('.tlscroll', r)).find(Boolean);
  if (!sc) return;
  let end = 4;
  for (const cs of Object.values(T.tracks)) for (const c of cs) end = Math.max(end, c.start + c.dur);
  for (const m of T.markers || []) end = Math.max(end, m.t + 1);
  for (const A of T.audios) end = Math.max(end, Math.min(A.start + tlAudioLen(A), T.length));
  end = Math.min(end * 1.03, T.length);
  const rows = project.zones.reduce((n, z) => n + ((T.lanes && T.lanes[z.id]) || 1), 0) + (ui.tlAudioFold ? 0 : Math.max(1, T.audios.length));
  const fixed = 24 + 22 * 2 + (ui.tlAudioFold ? 22 : 0) + 4;
  ui.tlRowH = clamp(Math.floor((sc.clientHeight - fixed) / Math.max(1, rows)), 30, 160);
  ui.tlZoom = clamp((sc.clientWidth - TL_LABEL - 12) / end, 4, 240);
  savePrefs(); refreshTimeline();
  for (const r of tlRoots()) { const s2 = $('.tlscroll', r); if (s2) { s2.scrollLeft = 0; s2.scrollTop = 0; } }
}

/* ---------- the zoom bars ---------- */
// As in video editors: under the tracks a bar for time, beside them one for their height. Its thumb is the part in
// view: dragged by its middle it scrolls, by an end it zooms, the other end staying where it is.
function zoomBar(T, dir) {
  const thumb = h('span', { class: 'tlthumb' }, h('span', { class: 'tlend a' }), h('span', { class: 'tlend b' }));
  const bar = h('div', { class: 'tlzbar ' + dir, role: 'scrollbar', 'aria-orientation': dir === 'h' ? 'horizontal' : 'vertical',
    'aria-label': dir === 'h' ? 'Time in view: drag to scroll, its ends to zoom' : 'Tracks in view: drag to scroll, its ends to change their height',
    title: dir === 'h' ? 'Drag to scroll; drag an end to zoom in time (also Ctrl + scroll)' : 'Drag to scroll; drag an end to make the tracks taller or shorter (also Alt + scroll)' }, thumb);
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const sc = bar.parentNode.querySelector('.tlscroll');
    if (!sc) return;
    const part = e.target.closest('.tlend') ? (e.target.classList.contains('a') ? 'a' : 'b') : e.target.closest('.tlthumb') ? 'mid' : 'track';
    const len = () => (dir === 'h' ? bar.clientWidth : bar.clientHeight), pos = ev => (dir === 'h' ? ev.clientX - bar.getBoundingClientRect().left : ev.clientY - bar.getBoundingClientRect().top);
    // (zooming draws the tracks again: the scroll in view now, not the one pressed on)
    const now = () => bar.parentNode.querySelector('.tlscroll') || sc;
    const view = () => (dir === 'h' ? now().clientWidth - TL_LABEL : now().clientHeight), total = () => (dir === 'h' ? T.length * ui.tlZoom : now().scrollHeight);
    // a click on the bar beside the thumb pages there
    if (part === 'track') { const f = pos(e) / len(); if (dir === 'h') sc.scrollLeft = f * total() - view() / 2; else sc.scrollTop = f * total() - view() / 2; tlBarsSync(true); return; }
    const p0 = pos(e), L = len(), s0 = dir === 'h' ? sc.scrollLeft : sc.scrollTop, z0 = ui.tlZoom, r0 = tlRow();
    // in time: the edges of what is in view, in seconds; in height: the thumb's length
    const tA = s0 / z0, tB = (s0 + view()) / z0, len0 = Math.min(1, view() / total()) * L;
    bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); tlDrag = true;
    const mv = ev => {
      const d = pos(ev) - p0, cur = now();
      if (part === 'mid') {
        const v = s0 + d / L * total();
        if (dir === 'h') cur.scrollLeft = v; else cur.scrollTop = v;
      } else if (dir === 'h') {
        // an end dragged: what is in view from the other end to where this one is now
        let a = tA, b = tB;
        if (part === 'a') a = clamp(tA + d / L * T.length, 0, tB - 0.5); else b = clamp(tB + d / L * T.length, tA + 0.5, T.length * 2);
        tlZoomSet(view() / Math.max(0.1, b - a), a);
      } else {
        // longer thumb: shorter tracks; the end dragged up or down by as much as it moved
        const want = Math.max(12, len0 + (part === 'a' ? -d : d));
        tlRowTo(r0 * len0 / want);
      }
      tlBarsSync(true);
    };
    const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); bar.classList.remove('drag'); tlDrag = false; savePrefs(); };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  });
  return bar;
}
// The zoom in time with a given time at the left edge of the view
function tlZoomSet(z, left) {
  const T = shownTimeline();
  if (!T) return;
  tlZoomTo(z);
  for (const r of tlRoots()) { const sc = $('.tlscroll', r); if (sc) sc.scrollLeft = Math.max(0, left * ui.tlZoom); }
}
// The thumbs where the view is (once a frame, and at once after a change)
function tlBarsSync(now) {
  const T = shownTimeline();
  if (!T) return;
  for (const r of tlRoots()) {
    const sc = $('.tlscroll', r);
    if (!sc) continue;
    const key = [sc.scrollLeft, sc.scrollTop, sc.clientWidth, sc.clientHeight, sc.scrollHeight, ui.tlZoom, T.length].join();
    if (!now && sc._barKey === key) continue;
    sc._barKey = key;
    // the sliders follow too (not the one being dragged: it is already there)
    const zs = $('.tlzoom:not(.tlvzoom)', r), vs = $('.tlvzoom', r);
    if (zs && Math.abs(+zs.value - ui.tlZoom) > 0.5) zs.value = Math.round(ui.tlZoom);
    if (vs && +vs.value !== tlRow()) vs.value = tlRow();
    for (const dir of ['h', 'v']) {
      const bar = $('.tlzbar.' + dir, r), th = bar && bar.firstChild;
      if (!th) continue;
      const L = dir === 'h' ? bar.clientWidth : bar.clientHeight, view = dir === 'h' ? sc.clientWidth - TL_LABEL : sc.clientHeight;
      const total = dir === 'h' ? T.length * ui.tlZoom : sc.scrollHeight, s0 = dir === 'h' ? sc.scrollLeft : sc.scrollTop;
      const size = Math.max(24, Math.min(1, view / Math.max(1, total)) * L), at = Math.min(L - size, s0 / Math.max(1, total) * L);
      if (dir === 'h') { th.style.left = at + 'px'; th.style.width = size + 'px'; } else { th.style.top = at + 'px'; th.style.height = size + 'px'; }
    }
  }
}
