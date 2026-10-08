// openLedMapper · js/playlists.js
// Playlists: a zone plays some of its scenes one after another by itself. Each step is a scene and a play time,
// which counts from the moment the step starts (its fade in included) until the next step starts. One playlist
// plays per zone; at its end it loops, stops, or plays another playlist of the zone. The main window runs them on
// the frame clock (tick); devices see where they are and send play, pause and next.

/* ---------- looking up ---------- */
const playlistOf = (z, id) => z.playlists.find(p => p.id === id) || null;
// The playlist that is the zone's current one (playing, paused, or stopped at its end), if any
const playingList = z => z._play ? playlistOf(z, z._play.list) : null;
const sceneOfStep = (z, st) => z.scenes.find(s => s.id === st.scene) || null;
const playlistLength = pl => pl.steps.reduce((a, st) => a + st.time, 0);
// The fade a step fades in with: its own, else the playlist's one for all, else its scene's. Never longer than the
// step's play time. from says which of the three it is.
function stepFade(z, pl, st) {
  const sc = sceneOfStep(z, st);
  const own = st.fade != null, all = pl.fade != null;
  const want = own ? st.fade : all ? pl.fade : sc ? sc.fade : 0;
  return { v: Math.min(want, st.time), want, from: own ? 'step' : all ? 'playlist' : 'scene', clipped: want > st.time };
}
// How long the current step has played, in seconds
function playElapsed(z) {
  const p = z._play;
  if (!p || p.i < 0) return 0;
  return p.on ? Math.max(0, clockT - p.start) : p.done;
}
// What comes after the step playing: a step of this playlist, the first step of another one, or nothing
function nextStepOf(z, pl, i) {
  if (i + 1 < pl.steps.length) return { pl, st: pl.steps[i + 1] };
  if (pl.end === 'loop') return { pl, st: pl.steps[0] };
  const nx = pl.end !== 'stop' && playlistOf(z, pl.end);
  return nx && nx.steps.length ? { pl: nx, st: nx.steps[0] } : null;
}

/* ---------- playing ---------- */
// Go to step i of the zone's current playlist now, with that step's fade. Playing or paused stays as it was.
function playStep(z, i) {
  const p = z._play, pl = playingList(z);
  if (!p || !pl || !pl.steps.length) { stopPlaylist(z); return; }
  const n = pl.steps.length;
  i = ((i % n) + n) % n;
  const st = pl.steps[i], sc = sceneOfStep(z, st);
  Object.assign(p, { i, start: clockT, done: 0, manual: null, ended: false });
  if (sc) recallScene(z, sc, stepFade(z, pl, st).v);
  if (ui.zone === z.id && !z.layers.some(L => L.id === ui.layer)) ui.layer = null;
  syncMedia(); saveSoon();
  playlistChanged(z, true);
}
// Start a playlist of the zone from step i (the first by default). Whatever played in the zone before stops.
function playPlaylist(z, id, i = 0) {
  const pl = playlistOf(z, id);
  if (!pl || !pl.steps.length) return false;
  z._play = { list: id, on: true, i: 0, start: clockT, done: 0, manual: null, ended: false };
  playStep(z, i);
  return true;
}
function pausePlaylist(z) {
  const p = z._play;
  if (!p || !p.on) return;
  p.done = playElapsed(z); p.on = false;
  playlistChanged(z);
}
// Carry on: after a scene picked by hand, back to the step it was on (with its fade); after the end, from the start
function resumePlaylist(z) {
  const p = z._play, pl = playingList(z);
  if (!p || p.on || !pl || !pl.steps.length) return;
  if (p.ended || p.i < 0 || p.i >= pl.steps.length) { playPlaylist(z, pl.id); return; }
  p.on = true; p.start = clockT - p.done;
  if (p.manual) {
    p.manual = null;
    const st = pl.steps[p.i], sc = sceneOfStep(z, st);
    if (sc) { recallScene(z, sc, stepFade(z, pl, st).v); syncMedia(); }
    playlistChanged(z, true);
  } else playlistChanged(z);
}
function stopPlaylist(z) { if (!z._play) return; z._play = null; playlistChanged(z); }
// The play button of a playlist: pause it or carry on if it is the zone's current one, else start it
function togglePlaylist(z, id) {
  const p = z._play;
  if (p && p.list === id && playingList(z)) { if (p.on) pausePlaylist(z); else resumePlaylist(z); }
  else playPlaylist(z, id);
}
// A playlist chosen on a phone: start it, or carry on if it is the paused one; nothing if it already plays
function startPlaylist(z, id) {
  const p = z._play;
  if (p && p.list === id && playingList(z)) { if (!p.on) resumePlaylist(z); }
  else playPlaylist(z, id);
}
// Previous and next step of the current playlist; a paused one stays paused on the new step
function stepPlaylist(z, d) {
  const p = z._play;
  if (!p || !playingList(z)) return;
  playStep(z, (p.ended ? (d > 0 ? -1 : 0) : p.i) + d);
}
// A scene picked by hand (a click, a key, a phone) pauses the zone's playlist; Play comes back to the step
function playlistManual(z, sceneId) {
  const p = z._play;
  if (!p || p.ended || !playingList(z)) return;
  if (p.on) { p.done = playElapsed(z); p.on = false; }
  p.manual = sceneId;
  playlistChanged(z);
}
// Every frame on the main window: steps whose play time is up move on
function playlistTick() {
  for (const z of project.zones) {
    const p = z._play;
    if (!p) continue;
    const pl = playingList(z);
    if (!pl || !pl.steps.length) { stopPlaylist(z); continue; }
    if (p.i < 0) { playStep(z, 0); continue; }   // set to play when the project opened
    if (p.i >= pl.steps.length) { playStep(z, pl.steps.length - 1); continue; }
    if (!p.on || clockT - p.start < pl.steps[p.i].time) continue;
    if (p.i + 1 < pl.steps.length) { playStep(z, p.i + 1); continue; }
    const nx = pl.end !== 'loop' && pl.end !== 'stop' && playlistOf(z, pl.end);
    if (pl.end === 'loop') playStep(z, 0);
    else if (nx && nx.steps.length) {
      if (ui.playlistOpen[z.id] === pl.id) ui.playlistOpen[z.id] = nx.id;   // the open playlist follows
      playPlaylist(z, nx.id);
    } else { Object.assign(p, { on: false, ended: true, done: pl.steps[p.i].time }); playlistChanged(z); }
  }
}
// After a playlist's steps change: the current step keeps playing where it is in the list, or the playlist stops
function playlistEdited(z, pl, keepId) {
  const p = z._play;
  if (!p || p.list !== pl.id) return;
  if (!pl.steps.length) { stopPlaylist(z); return; }
  const i = keepId != null ? pl.steps.findIndex(st => st.id === keepId) : -1;
  if (i >= 0) p.i = i;
  else if (p.i >= pl.steps.length) p.i = pl.steps.length - 1;
}
// Something about a zone's playlists changed: the Scenes panel and the other devices hear of it (scene changes
// by the playlist are not undo steps)
function playlistChanged(z, scene = false) {
  refreshScenes();
  if (scene) { renderSrcList(); if ((ui.rightTab === 'content' || ui.tool === 'zone') && ui.zone === z.id && !document.activeElement.closest?.('#rightBody')) renderRight(); }
  remoteLiveChanged();
}
// What every device needs to show the playlists: for each zone with a current playlist, where it is
function playState() {
  const out = {};
  for (const z of project.zones) {
    const p = z._play;
    if (p && playingList(z)) out[z.id] = { list: p.list, on: p.on, i: p.i, el: playElapsed(z), manual: p.manual, ended: p.ended };
  }
  return out;
}
// For the phones: a zone's current playlist, the step playing and the next one, in words
function playForPhone(z) {
  const p = z._play, pl = playingList(z);
  if (!pl || p.i < 0) return null;
  const st = pl.steps[p.i], sc = st && sceneOfStep(z, st), nx = st && nextStepOf(z, pl, p.i), nsc = nx && sceneOfStep(z, nx.st);
  return { list: pl.id, name: pl.name, on: p.on, ended: p.ended, manual: !!p.manual, i: p.i, n: pl.steps.length,
    step: sc ? sc.name : '', time: st ? st.time : 0, el: playElapsed(z), next: !nx ? null : nx.pl !== pl ? nx.pl.name : nsc ? nsc.name : '' };
}
// On a device: where the main computer's playlists are
function applyPlayState(st) {
  for (const z of project.zones) {
    const s = isObj(st) ? st[z.id] : null;
    z._play = isObj(s) ? { list: s.list, on: !!s.on, i: s.i, start: clockT - numOr(s.el, 0), done: numOr(s.el, 0), manual: s.manual || null, ended: !!s.ended } : null;
  }
  refreshScenes();
}
