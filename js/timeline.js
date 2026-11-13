// nouPix · js/timeline.js
// Timelines (beta): one plays at a time on the frame clock. Each zone with clips on it follows the clip under the
// playhead: its scene (cut when jumped to, crossfaded over the clip's fade-in from the clip just before it) and its
// level (rising over the fade-in from a gap, falling over the fade-out into one; dark where there is no clip); zones
// with no clips are left alone. A clip's keyframes (c.curves) move its level and its scene's effects' controls while it
// shows. The audio plays with it, kept in step. Loop: the whole timeline or a region.
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
// The beat of the audio, worked out from the whole file once (no browser needed: tests give it made-up music): the rise
// in energy of every 11.6 ms, in the kick's band (below 150 Hz) and in all of it, each against its recent average;
// its autocorrelation scored at every tempo from 60 to 200 BPM (with its multiples, preferring those near 125), a tempo
// within 0.15 of a whole number taken as that number; then where the beats fall (the offset whose beats land on the
// most onsets) and which of four is the bar's first (the one whose bars land on the most kicks).
function tlDetectBeat(buf) {
  const sr = buf.sampleRate, hop = Math.max(64, Math.round(sr / 86.13)), ch = buf.numberOfChannels || 1, len = buf.length || buf.getChannelData(0).length;
  const data = [...Array(ch).keys()].map(c => buf.getChannelData(c));
  const N = Math.floor(len / hop), fps = sr / hop;
  if (N < fps * 4) return null;
  const a = 1 - Math.exp(-2 * Math.PI * 150 / sr), ek = new Float32Array(N), ef = new Float32Array(N), kl = new Float32Array(N);
  let y = 0;
  for (let i = 0; i < N; i++) {
    let sk = 0, sf = 0;
    for (let j = i * hop, e = j + hop; j < e; j++) {
      let x = 0;
      for (let c = 0; c < ch; c++) x += data[c][j];
      x /= ch; y += a * (x - y); sk += y * y; sf += x * x;
    }
    kl[i] = sk; ek[i] = Math.log(1e-10 + sk); ef[i] = Math.log(1e-10 + sf);
  }
  const onset = e => {
    const o = new Float32Array(N), W = Math.round(fps * 0.4);
    for (let i = 1; i < N; i++) o[i] = Math.max(0, e[i] - e[i - 1]);
    // less its local average, so a loud passage counts no more than a quiet one
    const r = new Float32Array(N);
    let acc = 0;
    for (let i = 0; i < N; i++) { acc += o[i]; if (i >= W) acc -= o[i - W]; r[i] = Math.max(0, o[i] - acc / Math.min(i + 1, W)); }
    return r;
  };
  const ok = onset(ek), of = onset(ef), o = new Float32Array(N);
  for (let i = 0; i < N; i++) o[i] = ok[i] + 0.5 * of[i];
  const maxLag = Math.ceil(fps * 60 / 60 * 4) + 2, ac = new Float32Array(maxLag + 1);
  for (let L = 1; L <= maxLag && L < N; L++) { let sum = 0; for (let i = 0; i + L < N; i++) sum += o[i] * o[i + L]; ac[L] = sum / (N - L); }
  const at = x => { const i = Math.floor(x), f = x - i; return i + 1 <= maxLag ? ac[i] * (1 - f) + ac[i + 1] * f : 0; };
  let best = 0, bpm = 120, sum = 0, n = 0;
  for (let b = 60; b <= 200; b += 0.05) {
    const L = fps * 60 / b, w = Math.exp(-0.5 * Math.pow(Math.log2(b / 125) / 0.7, 2));
    const sc = (at(L) + 0.5 * at(2 * L) + 0.33 * at(3 * L) + 0.25 * at(4 * L)) * w;
    sum += sc; n++;
    if (sc > best) { best = sc; bpm = b; }
  }
  if (!(best > 0)) return null;
  // the onsets near each beat (a frame either side), over the whole file: the tempo whose beats stay on them longest
  const near = (src, x) => { const i = Math.floor(x), f = x - i, g = j => src[j] || 0; return g(i) * (1 - f) + g(i + 1) * f + 0.5 * (g(i - 1) * (1 - f) + g(i + 2) * f); };
  const comb = (src, ph, step) => { let s2 = 0; for (let x = ph; x < N; x += step) s2 += near(src, x); return s2; };
  const fit = b => { const P = fps * 60 / b; let bp = -1, ph = 0; for (let x = 0; x < P; x += 0.5) { const v = comb(o, x, P); if (v > bp) { bp = v; ph = x; } } return [bp, ph]; };
  let fine = bpm, fb = -1;
  for (let b = bpm - 0.6; b <= bpm + 0.6; b += 0.02) { const [v] = fit(b); if (v > fb) { fb = v; fine = b; } }
  bpm = Math.abs(fine - Math.round(fine)) < 0.15 ? Math.round(fine) : Math.round(fine * 100) / 100;
  const P = fps * 60 / bpm;
  // where the beats fall: on the onsets, and most on the kick's real rise in energy (on a log scale a bass note's rise
  // looks as big as the kick's)
  const kr = new Float32Array(N);
  let mo = 0, mk = 0;
  for (let i = 1; i < N; i++) { kr[i] = Math.max(0, kl[i] - kl[i - 1]); mk += kr[i]; mo += o[i]; }
  mo = mo || 1; mk = mk || 1;
  let ph = 0, bp = -1;
  for (let x = 0; x < P; x += 0.25) { const v = comb(o, x, P) / mo + 2 * comb(kr, x, P) / mk; if (v > bp) { bp = v; ph = x; } }
  // the bar's first beat: the loudest kicks
  const peak = x => { const i = Math.round(x); return Math.max(kl[i] || 0, kl[i + 1] || 0, kl[i + 2] || 0, kl[i + 3] || 0); };
  let j0 = 0, bj = -1;
  for (let j = 0; j < 4; j++) { let v = 0; for (let x = ph + j * P; x < N; x += 4 * P) v += peak(x); if (v > bj) { bj = v; j0 = j; } }
  const bar = 4 * 60 / bpm, t0 = (((ph + j0 * P) / fps) % bar + bar) % bar;
  return { bpm, t0: Math.round(t0 * 1000) / 1000, conf: best / (sum / n) };
}
// The grid in bars: beats from the timeline's first downbeat (beat0), 4 to the bar
const tlBeat = T => 60 / T.bpm;
const tlBarOf = (T, t) => Math.floor((t - (T.beat0 || 0)) / (4 * tlBeat(T)) + 1e-6);
// Keyframes: a clip's curves, each the clip's level ({ kind: 'level' }) or a control of an effect of its scene
// ({ kind: 'param', src, ctl }), with keys { t (seconds from the clip's start), v, ease: 'linear' | 'ease' | 'hold' }.
// Numbers, colours and points move from key to key (straight, or eased in and out); switches and lists step at each key,
// as does a key on Hold. Before the first key and after the last, the curve stays at their values.
const TL_EASES = ['linear', 'ease', 'hold'];
const TL_LEVEL = { NAME: 'level', LABEL: 'Level', TYPE: 'float', MIN: 0, MAX: 1, DEFAULT: 1 };
const tlCurveInput = cv => (cv.kind === 'level' ? TL_LEVEL : cueInput(cv.src, cv.ctl));
const tlStepped = inp => !inp || !['float', 'int', 'color', 'point2D'].includes(inp.TYPE);
function tlCurveAt(cv, t, inp = tlCurveInput(cv)) {
  const K = cv.keys;
  if (!K.length) return undefined;
  if (t <= K[0].t) return K[0].v;
  const n = K.length - 1;
  if (t >= K[n].t) return K[n].v;
  let i = 0;
  while (i < n - 1 && K[i + 1].t <= t) i++;
  const a = K[i], b = K[i + 1];
  if (a.ease === 'hold' || tlStepped(inp) || b.t - a.t < 1e-6) return a.v;
  let f = (t - a.t) / (b.t - a.t);
  if (a.ease === 'ease') f = f * f * (3 - 2 * f);
  const mix = (x, y) => x + (y - x) * f;
  if (Array.isArray(a.v) && Array.isArray(b.v)) return a.v.map((x, k) => mix(x, b.v[k] ?? x));
  if (typeof a.v === 'number' && typeof b.v === 'number') return inp && inp.TYPE === 'int' ? Math.round(mix(a.v, b.v)) : mix(a.v, b.v);
  return a.v;
}
const tlSortKeys = cv => cv.keys.sort((a, b) => a.t - b.t);
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
    // its keyframes: the level within its fades, the controls of its scene's effects (only when they change)
    if (c && c.curves && c.curves.length) {
      const t = p - c.start;
      for (const cv of c.curves) {
        const inp = tlCurveInput(cv), v = inp ? tlCurveAt(cv, t, inp) : undefined;
        if (v === undefined) continue;
        if (cv.kind === 'level') lv *= clamp(+v || 0, 0, 1);
        else if (!sameVal(cueParamNow(z, cv.src, cv.ctl), v)) { cueParamSet(z, cv.src, cv.ctl, v); z._tlAnim = true; }
      }
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
