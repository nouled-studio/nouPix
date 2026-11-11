// nouPix · js/ui-timeline.js
// The timelines' panel, in the bottom panel's Timeline tab or the side column's: the timelines as tabs (+ New
// timeline), the transport (play or pause, stop, the time, the loop: off, all or a region, the ruler in seconds or bars,
// snap, zoom, the audio), and under the ruler an audio track (its waveform) and a track per zone, top zone first. Scenes
// are dragged onto their zone's track as clips (or picked with a double-click there); a clip is moved by dragging,
// made longer or shorter by its edges, its fade-in and fade-out by the handles at its top corners; the ruler is
// clicked or dragged to move the playhead; the loop's region by its two markers on the ruler.

const shownTimeline = () => tlOf(ui.tlId) || project.timelines[0] || null;
const tlRoots = () => [panelRoot('timeline')].filter(Boolean);
const timelineShown = () => tlRoots().length > 0;
const TL_LABEL = 132, TL_ROW = 50;
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
    const beat = 60 / T.bpm, bar = beat * 4, k = [1, 2, 4, 8, 16, 32].find(n => n * bar * z >= 70) || 64;
    return { major: bar * k, minor: bar * k >= bar * 2 ? bar : beat, label: t => String(Math.round(t / bar) + 1), snap: beat };
  }
  const s = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(n => n * z >= 70) || 1200;
  return { major: s, minor: s / (s >= 10 ? 5 : 2), label: t => fmtTime(t).replace(/\.00$/, ''), snap: s / (s >= 10 ? 5 : 2) };
}
// A time snapped to the grid, the playhead and other clips' edges, when within 8px of one
function tlSnapT(T, t, skip) {
  if (!tlSnap) return t;
  const lim = 8 / ui.tlZoom, st = tlSteps(T), pts = [Math.round(t / st.snap) * st.snap, tlPos()];
  for (const cs of Object.values(T.tracks)) for (const c of cs) if (c !== skip) pts.push(c.start, c.start + c.dur);
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
    h('span', { class: 'fill' }), panelPlaces('timeline'),
    T ? h('button', { type: 'button', class: 'btn sm icon', title: T.name + ': rename, length, delete', 'aria-label': T.name + ' menu', onclick: e => timelineMenu(e.currentTarget, T) }, '⋯') : null));
  if (!T) {
    panel.append(h('div', { class: 'cueempty' }, h('p', null, 'No timelines yet. A timeline plays scenes on a track per zone, in time with an audio file.'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => addTimeline() }, '+ New timeline')));
    return;
  }
  const mine = tl.id === T.id, playing = mine && tl.playing;
  const segBtns = (opts, val, set, label) => h('span', { class: 'tlseg', role: 'group', 'aria-label': label },
    opts.map(([v, t, tip]) => h('button', { type: 'button', class: v === val ? 'on' : '', 'aria-pressed': String(v === val), title: tip || t, onclick: () => set(v) }, t)));
  const fileIn = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: e => { const f = e.target.files[0]; if (f) setTimelineAudio(T, f); } });
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
    h('label', { class: 'tlsnap', title: 'Clips and markers snap to the grid, the playhead and other clips' }, h('input', { type: 'checkbox', checked: tlSnap, onchange: e => { tlSnap = e.target.checked; } }), 'Snap'),
    h('span', { class: 'fill' }),
    h('input', { type: 'range', class: 'tlzoom', min: 4, max: 240, step: 1, value: ui.tlZoom, 'aria-label': 'Zoom', title: 'Zoom (Ctrl + scroll on the tracks)',
      oninput: e => tlZoomTo(+e.target.value), onchange: () => savePrefs() }),
    T.audio ? h('span', { class: 'tlaudioname', title: T.audio.name }, '♪ ' + T.audio.name) : null,
    h('button', { type: 'button', class: 'btn sm', title: T.audio ? 'Another audio file for this timeline' : 'An audio file that plays with the timeline', onclick: () => fileIn.click() }, T.audio ? 'Audio…' : '+ Audio'),
    T.audio ? h('button', { type: 'button', class: 'btn sm icon', title: 'Remove the audio', 'aria-label': 'Remove the audio', onclick: () => { tlHalt(); T.audio = null; commit({ lists: false }); refreshTimeline(); } }, '×') : null,
    fileIn));
  panel.append(tlTracks(T, mine));
}
// The tracks: a ruler, the audio, the zones (top zone first); drawn again alone when zooming, so the bar and its
// slider stay as they are while dragged
function tlTracks(T, mine) {
  // the tracks: a ruler, the audio, the zones (top zone first)
  const W = Math.max(1, T.length * ui.tlZoom), st = tlSteps(T);
  const grid = h('div', { class: 'tlgrid', style: { width: TL_LABEL + W + 'px' } });
  const scroll = h('div', { class: 'tlscroll', 'data-keep': 'tlscroll:' + T.id }, grid);
  scroll.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    tlZoomTo(ui.tlZoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - scroll.getBoundingClientRect().left);
    savePrefs();
  }, { passive: false });
  // the ruler: ticks, labels, the loop's region and markers; clicked or dragged, the playhead goes there
  const ruler = h('div', { class: 'tllane tlruler', style: { width: W + 'px' }, title: 'Click or drag to move the playhead' });
  for (let t = 0; t <= T.length + 1e-6; t += st.minor) {
    const major = Math.abs(t / st.major - Math.round(t / st.major)) < 1e-6;
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
  grid.append(section('Audio'));
  // the audio
  const alane = h('div', { class: 'tllane tlaudio', style: { width: W + 'px' }, title: 'Drop an audio file here' });
  alane.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); alane.classList.add('drop'); } });
  alane.addEventListener('dragleave', () => alane.classList.remove('drop'));
  alane.addEventListener('drop', e => { alane.classList.remove('drop'); const f = [...e.dataTransfer.files].find(f => /^audio\//.test(f.type) || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac)$/i.test(f.name)); if (!f) return; e.preventDefault(); setTimelineAudio(T, f); });
  if (T.audio) {
    const a = tlAudio(T), P = tlPeaks.get(T.audio.media || T.audio._url), dur = P && P.dur ? P.dur : (a && isFinite(a.duration) ? a.duration : T.length);
    alane.append(h('div', { class: 'tlablock', style: { width: Math.min(dur, T.length) * ui.tlZoom + 'px' } },
      h('span', { class: 'tlin' }, h('span', { class: 'tlhdr' }, T.audio.name), h('span', { class: 'tlstrip' }, waveform(T)))));
  } else alane.append(h('span', { class: 'tlhint' }, 'Drop an audio file here, or + Audio'));
  grid.append(h('div', { class: 'tlrow' }, h('div', { class: 'tllabel' }, h('span', { class: 'tlz' }, T.audio ? T.audio.name.replace(/\.[a-z0-9]+$/i, '') : 'No audio')), alane));
  grid.append(section('Zones'));
  // the zones
  // a zone's lanes, the highest on top: where clips overlap, the highest shows
  for (const z of project.zones.slice().reverse()) {
    const n = (T.lanes && T.lanes[z.id]) || 1, clips = T.tracks[z.id] || [];
    for (let k = n - 1; k >= 0; k--) {
      const lane = h('div', { class: 'tllane tltrack', style: { width: W + 'px' }, 'data-zone': z.id, 'data-lane': k,
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
      const label = h('div', { class: 'tllabel' + (top ? '' : ' sub'), style: z.tag ? { '--tag': z.tag } : null },
        h('span', { class: 'tlz' }, top ? z.name : ''),
        n > 1 ? h('span', { class: 'tlln mono', title: 'Lane ' + (k + 1) + (top ? ': shows over the lanes below' : '') }, String(k + 1)) : null,
        top ? h('span', { class: 'tllbtns' },
          h('button', { type: 'button', class: 'tllb', title: 'A lane on top: its clips show over the ones below, and hand back to them as they end', 'aria-label': 'Add a lane to ' + z.name, onclick: () => addLane(T, z) }, '+'),
          n > 1 ? h('button', { type: 'button', class: 'tllb', title: 'Remove the top lane (when it has no clips)', 'aria-label': 'Remove a lane from ' + z.name, onclick: () => removeLane(T, z) }, '−') : null) : null);
      grid.append(h('div', { class: 'tlrow' + (top ? '' : ' sub') }, label, lane));
    }
  }
  // over all of it: the loop's region and the playhead
  if (T.loop.mode === 'region') grid.append(h('div', { class: 'tlloopcol', style: { left: TL_LABEL + T.loop.a * ui.tlZoom + 'px', width: (T.loop.b - T.loop.a) * ui.tlZoom + 'px' } }));
  grid.append(h('div', { class: 'tlhead', 'data-tl-head': '', style: { left: TL_LABEL + (mine ? tlPos() : 0) * ui.tlZoom + 'px' } }));
  return scroll;
}
// Zoom: the tracks drawn again at the new scale, the time under the mouse (or the middle of the view) kept where it is
function tlZoomTo(z, at) {
  const T = shownTimeline();
  if (!T) return;
  z = clamp(Math.round(z), 4, 240);
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
    const sl = $('.tlzoom', r);
    if (sl && +sl.value !== z) sl.value = z;
  }
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
  const el = h('div', { class: 'tlclip' + (ui.tlSel === c.id ? ' sel' : ''), 'data-clip': c.id, style: z.tag ? { '--tag': z.tag } : null,
    title: `${sc ? sc.name : '?'}: ${fmtTime(c.start)} for ${fmtV(Math.round(c.dur * 100) / 100)} s. Drag to move, its edges to resize, the top corners for its fades. Right-click for more.` },
    h('span', { class: 'tlin' }, h('span', { class: 'tlhdr' }, sc ? sc.name : '?'),
      h('span', { class: 'tlstrip' + (sc && sc.thumb ? ' shot' : ''), style: sc && sc.thumb ? { backgroundImage: `url("${sc.thumb}")` } : null })),
    h('span', { class: 'tledge l' }), h('span', { class: 'tledge r' }),
    h('span', { class: 'tlfin', title: 'Fade in: drag' }), h('span', { class: 'tlfout', title: 'Fade out: drag' }));
  paintClip(el, c);
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const part = e.target.classList.contains('tlfin') ? 'fin' : e.target.classList.contains('tlfout') ? 'fout' : e.target.classList.contains('tledge') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
    if (ui.tlSel !== c.id) { ui.tlSel = c.id; for (const o of $$('.tlclip.sel', el.ownerDocument)) o.classList.remove('sel'); el.classList.add('sel'); }
    // its neighbours on its lane bound it; dragged up or down onto another lane with room, it goes there
    const clips = T.tracks[z.id], x0 = e.clientX, y0 = e.clientY, o = { start: c.start, dur: c.dur, fadeIn: c.fadeIn, fadeOut: c.fadeOut, lane: c.lane || 0 };
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
      else if (part === 'l') { const s = clamp(tlSnapT(T, o.start + d, c), lo, o.start + o.dur - 0.1); c.dur = o.start + o.dur - s; c.start = s; }
      else if (part === 'r') { const en = clamp(tlSnapT(T, o.start + o.dur + d, c), o.start + 0.1, hi); c.dur = en - o.start; }
      else if (part === 'fin') c.fadeIn = clamp(o.fadeIn + d, 0, c.dur - c.fadeOut);
      else c.fadeOut = clamp(o.fadeOut - d, 0, c.dur - c.fadeIn);
      c.fadeIn = Math.min(c.fadeIn, c.dur); c.fadeOut = Math.min(c.fadeOut, c.dur - c.fadeIn);
      paintClip(el, c);
    };
    const up = () => {
      for (const t of ['pointermove', 'pointerup', 'pointercancel']) win.removeEventListener(t, t === 'pointermove' ? mv : up);
      tlDrag = false;
      if (moved) { tl.clips[z.id] = undefined; commit({ lists: false }); }
      refreshTimeline();
    };
    // on the window: moved to another lane, the clip leaves its place in the page and the browser lets go of it
    const win = el.ownerDocument.defaultView;
    win.addEventListener('pointermove', mv); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', e => { e.stopPropagation(); tlSeek(T, c.start); refreshTimeline(); });
  onRightClick(el, e => clipMenu(e, T, z, c));
  return el;
}
function clipMenu(anchor, T, z, c) {
  ui.tlSel = c.id;
  menu(anchor, [
    { head: (z.scenes.find(s => s.id === c.scene) || { name: '?' }).name + ' · ' + z.name },
    ['Play from here', () => { tlSeek(T, c.start); tlPlay(T); }],
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
// The audio's waveform: its peaks worked out once per file (in the background), drawn at the zoom
const tlPeaks = new Map();
function waveform(T) {
  const a = tlAudio(T), key = T.audio.media || T.audio._url, P = tlPeaks.get(key);
  const dur = P && P.dur ? P.dur : (a && isFinite(a.duration) ? a.duration : 0);
  if (!P && key) {
    tlPeaks.set(key, { loading: true });
    fetch(T.audio.media ? mediaUrl(T.audio.media) : T.audio._url).then(r => r.arrayBuffer())
      .then(b => new OfflineAudioContext(1, 1, 44100).decodeAudioData(b))
      .then(buf => {
        const d = buf.getChannelData(0), N = 4000, n = Math.max(1, Math.floor(d.length / N)), pk = new Float32Array(N);
        for (let i = 0; i < N; i++) { let m = 0; for (let j = i * n, e = Math.min(d.length, j + n); j < e; j++) { const v = Math.abs(d[j]); if (v > m) m = v; } pk[i] = m; }
        tlPeaks.set(key, { pk, dur: buf.duration });
        refreshTimeline();
      }).catch(() => tlPeaks.set(key, { failed: true }));
  }
  if (!P || !P.pk) return h('span', { class: 'tlhint in' }, (P && P.failed ? 'Can\'t read ' : 'Reading ') + T.audio.name + (P && P.failed ? '' : '…'));
  const w = Math.max(1, Math.min(16000, Math.round(dur * ui.tlZoom))), H = TL_ROW - 26, c = h('canvas', { class: 'tlwave', width: w, height: H, style: { width: dur * ui.tlZoom + 'px', height: H + 'px' } });
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
  // the clips showing now: a white edge and a small red square, as a scene playing
  const live = tl.id === T.id ? Object.values(tl.clips).filter(Boolean).join(' ') : '';
  for (const r of tlRoots()) if (r._tlLive !== live) { r._tlLive = live; for (const el of $$('.tlclip', r)) el.classList.toggle('live', live.includes(el.dataset.clip)); }
  // the play button follows a timeline that stopped by itself
  const pb = tlRoots().map(r => $('.tlplay', r)).find(Boolean);
  if (pb && pb.classList.contains('on') !== (tl.playing && tl.id === T.id)) refreshTimeline();
}
// The clip picked goes with Delete or Backspace while the timeline shows
document.addEventListener('keydown', e => {
  if (!ui.tlSel || !timelineShown() || typingIn(e.target) || !(e.key === 'Delete' || e.key === 'Backspace')) return;
  const T = shownTimeline();
  for (const [zid, cs] of Object.entries((T && T.tracks) || {})) {
    const c = cs.find(x => x.id === ui.tlSel);
    if (c) { e.preventDefault(); e.stopPropagation(); deleteClip(T, zoneById(zid), c); return; }
  }
}, true);
