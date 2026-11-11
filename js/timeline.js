// nouPix · js/timeline.js
// Timelines (alpha): one plays at a time on the frame clock. Each zone with clips on it follows the clip under the
// playhead: its scene (cut when jumped to, crossfaded over the clip's fade-in from the clip just before it) and its
// level (rising over the fade-in from a gap, falling over the fade-out into one; dark where there is no clip); zones
// with no clips are left alone. The audio plays with it, kept in step. Loop: the whole timeline or a region.
// Nothing of it is saved but the timelines; only the main window plays them.

// Where it is: the timeline (id), playing or not, the position (pos, seconds) when it last started or stopped and the
// clock then (at), the clip each zone shows (clips: zone id -> clip id or null)
const tl = { id: null, playing: false, pos: 0, at: 0, clips: {} };
const tlOf = id => project.timelines.find(T => T.id === id) || null;
const tlClip = (T, id) => { for (const cs of Object.values(T.tracks)) { const c = cs.find(x => x.id === id); if (c) return c; } return null; };
const tlEnd = T => (T.loop.mode === 'region' ? T.loop.b : T.length);
const tlStart = T => (T.loop.mode === 'region' ? T.loop.a : 0);
function tlPos() { return tl.playing ? tl.pos + (clockT - tl.at) : tl.pos; }
// Its audio: one element per timeline, from the media library (or the file dropped, until it is stored)
const tlAudios = new Map();
function tlAudio(T) {
  if (!T || !T.audio) return null;
  const url = T.audio.media ? mediaUrl(T.audio.media) : T.audio._url;
  if (!url) return null;
  let a = tlAudios.get(T.id);
  if (!a || a._src !== url) { if (a) a.pause(); a = new Audio(url); a._src = url; a.preload = 'auto'; tlAudios.set(T.id, a); }
  return a;
}
function tlAudioSync(T, p, play) {
  const a = tlAudio(T);
  if (!a) return;
  if (!play) { a.pause(); return; }
  if (p >= (a.duration || Infinity)) { a.pause(); return; }
  if (Math.abs(a.currentTime - p) > 0.12) { try { a.currentTime = p; } catch (e) { /* not loaded yet */ } }
  if (a.paused) a.play().catch(() => {});
}
function tlPlay(T) {
  if (REMOTE_CLIENT || !T) return;
  if (tl.id !== T.id) { tlHalt(); tl.id = T.id; tl.clips = {}; tl.pos = tlStart(T); }
  if (tl.pos >= tlEnd(T) - 0.01) tl.pos = tlStart(T);
  tl.playing = true; tl.at = clockT;
  tlApply(T, tl.pos, true);
  tlAudioSync(T, tl.pos, true);
  refreshTimeline();
}
function tlPause() {
  if (!tl.playing) return;
  tl.pos = tlPos(); tl.playing = false;
  tlAudioSync(tlOf(tl.id), tl.pos, false);
  refreshTimeline();
}
// Stop: back to the start (or the loop's), the zones left as they are
function tlStop(T) {
  tlPause();
  if (T) { tl.id = T.id; tl.pos = tlStart(T); tl.clips = {}; }
  refreshTimeline();
}
function tlHalt() { for (const a of tlAudios.values()) a.pause(); tl.playing = false; }
// The playhead put somewhere (the ruler clicked or dragged): what is there shows at once
function tlSeek(T, t) {
  if (!T || REMOTE_CLIENT) return;
  if (tl.id !== T.id) { tlHalt(); tl.id = T.id; tl.clips = {}; }
  tl.pos = clamp(t, 0, T.length); tl.at = clockT;
  tlApply(T, tl.pos, true);
  if (tl.playing) tlAudioSync(T, tl.pos, true);
}
// A zone's track can have several lanes (clip.lane, 0 the lowest): where clips overlap, the highest lane's shows. A
// clip lying over another hands back to it over its own fade-out, so the clip under shows fully by the time it ends.
const tlEndOf = c => c.start + c.dur;
const tlOver = (clips, t, skip) => clips.some(x => x !== skip && x.start <= t + 1e-6 && t < tlEndOf(x) - 1e-6);
const tlHandEnd = (clips, c) => (clips.some(x => x !== c && x.lane < c.lane && x.start < tlEndOf(c) - 1e-6 && tlEndOf(x) >= tlEndOf(c) - 1e-6) ? tlEndOf(c) - c.fadeOut : tlEndOf(c));
function tlWinner(clips, p) {
  let w = null;
  for (const c of clips) if (c.start <= p && p < tlHandEnd(clips, c) && (!w || c.lane > w.lane || (c.lane === w.lane && c.start > w.start))) w = c;
  return w;
}
// Each zone with clips: the clip showing at the playhead, its scene and its level
function tlApply(T, p, jump) {
  let scenes = false;
  for (const [zid, clips] of Object.entries(T.tracks)) {
    const z = zoneById(zid);
    if (!z || !clips.length) continue;
    const c = tlWinner(clips, p), prevId = tl.clips[zid] ?? undefined;
    if ((c ? c.id : null) !== prevId) {
      const sc = c && z.scenes.find(s => s.id === c.scene), old = prevId ? clips.find(x => x.id === prevId) : null;
      if (sc) {
        // from the clip that showed: up a lane over this one's fade-in, back down over that one's fade-out, along a
        // lane over this one's fade-in; jumped to, or from nothing: a cut
        const d = !jump && old ? (c.lane < old.lane ? Math.max(0, tlEndOf(old) - p) : c.fadeIn) : 0;
        playlistManual(z, sc.id); recallScene(z, sc, Math.min(d, Math.max(0, tlEndOf(c) - p))); scenes = true;
      }
      tl.clips[zid] = c ? c.id : null;
    }
    // the level fades only where nothing else is: in from a gap, out into one; dark in a gap
    let lv = 0;
    if (c) {
      lv = 1;
      if (c.fadeIn > 0 && !tlOver(clips, c.start - 0.001, c)) lv = Math.min(lv, (p - c.start) / c.fadeIn);
      if (c.fadeOut > 0 && !tlOver(clips, tlEndOf(c), c)) lv = Math.min(lv, (tlEndOf(c) - p) / c.fadeOut);
      lv = clamp(lv, 0, 1);
    }
    if (Math.abs(z.opacity - lv) > 1e-4) setZoneOpacity(z, lv);
  }
  if (scenes) { syncMedia(); refreshScenes(); renderSrcList(); remoteLiveChanged(); }
}
// Every frame on the main window: the playing timeline moves on, loops or ends
function tlTick() {
  if (!tl.playing) return;
  const T = tlOf(tl.id);
  if (!T) { tlHalt(); return; }
  let p = tlPos();
  const end = tlEnd(T);
  if (p >= end) {
    if (T.loop.mode === 'off') { tl.pos = Math.min(p, T.length); tl.playing = false; tlApply(T, tl.pos, false); tlAudioSync(T, 0, false); refreshTimeline(); return; }
    p = tlStart(T) + (p - end) % Math.max(0.1, end - tlStart(T));
    tl.pos = p; tl.at = clockT;
    tlApply(T, p, true);
    tlAudioSync(T, p, true);
    return;
  }
  tlApply(T, p, false);
  // the audio kept in step with the clock (it drifts, and starts late)
  if (Math.round(clockT * 4) !== Math.round((clockT - 1 / project.settings.fps) * 4)) tlAudioSync(T, p, true);
}
