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
// The beat of the audio, worked out from the whole file once (no browser needed: tests give it made-up music).
// 1. Onsets: the file mixed down to mono at about 22 kHz, its spectrum every 11.6 ms (an FFT of 1024 with a Hann
//    window); the rise of each band's loudness (log), summed: spectral flux, as music software reads onsets. The bass
//    (below 150 Hz) also on its own, for the bar's first beat. Each less its average over the second around it.
// 2. The tempo: the onsets' autocorrelation scored at every tempo from 60 to 200 BPM, with its multiples, preferring
//    those near 120 (a log-normal prior, as librosa's).
// 3. The beats: on the onsets and the kick's real rise in energy (the sub's loudness: on a log scale a bass note's
//    rise looks as big as a kick's); the tempo exactly where they stay on them longest over the whole file (within 1%,
//    a whole number when within 0.15), and where they fall. Half or double can't be told apart in every style (drum
//    and bass may read half): the timeline offers ×2 and ÷2.
// 4. The bar's first beat: of the four, where the music changes most from the beat before (chords, bass notes and
//    sections change on the bar), helped by the clap or snare on 2 and 4 and by the bass. (The least sure part: the
//    ruler's menu sets bar 1 by hand.)
// conf: how much stronger the onsets are on the beats than half a beat or so away; under 1.6, weak: no clear beat.
function tlDetectBeat(buf) {
  const sr0 = buf.sampleRate, ch = buf.numberOfChannels || 1, len0 = Math.min(buf.length || buf.getChannelData(0).length, Math.round(sr0 * 360));
  const data = [...Array(ch).keys()].map(c => buf.getChannelData(c));
  // mono, about 22 kHz (averaged down)
  const dec = Math.max(1, Math.round(sr0 / 22050)), sr = sr0 / dec, n = Math.floor(len0 / dec), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = 0; for (let j = i * dec, e = j + dec; j < e; j++) for (let c = 0; c < ch; c++) v += data[c][j]; x[i] = v / (dec * ch); }
  const N = 1024, hop = Math.max(64, Math.round(sr / 86.13)), F = Math.floor((n - N) / hop) + 1, fps = sr / hop;
  if (F < fps * 6) return null;
  // the FFT (radix 2, in place), its window and bins
  const lg = Math.log2(N), rev = new Uint16Array(N), cs = new Float32Array(N / 2), sn = new Float32Array(N / 2), win = new Float32Array(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < lg; b++) r |= ((i >> b) & 1) << (lg - 1 - b); rev[i] = r; win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); }
  for (let i = 0; i < N / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / N); sn[i] = -Math.sin(2 * Math.PI * i / N); }
  const re = new Float32Array(N), im = new Float32Array(N), B = 64;
  // bands: 64 on a log scale from 30 Hz to 11 kHz (each at least a bin)
  const bandOf = new Int16Array(N / 2).fill(-1), lowB = [], midB = [], subK = Math.max(1, Math.floor(100 * N / sr));
  for (let k = 1; k < N / 2; k++) {
    const f = k * sr / N;
    if (f < 30) continue;
    const b = Math.min(B - 1, Math.floor(Math.log(f / 30) / Math.log(11000 / 30) * B));
    bandOf[k] = b;
    if (f < 150) lowB[b] = true;
    if (f >= 200 && f < 4000) midB[b] = true;
  }
  let prev = new Float32Array(B), cur = new Float32Array(B);
  const flux = new Float32Array(F), bass = new Float32Array(F), mid = new Float32Array(F), sub = new Float32Array(F), spec = new Float32Array(F * B);
  for (let t = 0; t < F; t++) {
    const o = t * hop;
    for (let i = 0; i < N; i++) { re[rev[i]] = x[o + i] * win[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) for (let j = 0; j < half; j++) {
        const a = s + j, b = a + half, w = j * step, tr = re[b] * cs[w] - im[b] * sn[w], ti = re[b] * sn[w] + im[b] * cs[w];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    cur.fill(0);
    let sp = 0;
    for (let k = 1; k < N / 2; k++) { const p2 = re[k] * re[k] + im[k] * im[k], b = bandOf[k]; if (b >= 0) cur[b] += p2; if (k <= subK) sp += p2; }
    let fl = 0, bl = 0, ml = 0;
    for (let b = 0; b < B; b++) {
      cur[b] = Math.log(1 + 1000 * Math.sqrt(cur[b]));
      const d = cur[b] - prev[b];
      if (d > 0) { fl += d; if (lowB[b]) bl += d; if (midB[b]) ml += d; }
    }
    flux[t] = t ? fl : 0; bass[t] = t ? bl : 0; mid[t] = t ? ml : 0; sub[t] = Math.sqrt(sp);
    spec.set(cur, t * B);
    const sw = prev; prev = cur; cur = sw;
  }
  // each less its average over the second around it, and never below nothing
  const local = (a, W) => {
    const out = new Float32Array(F), half = W >> 1, cum = new Float64Array(F + 1);
    for (let i = 0; i < F; i++) cum[i + 1] = cum[i] + a[i];
    for (let i = 0; i < F; i++) { const lo = Math.max(0, i - half), hi = Math.min(F, i + half + 1); out[i] = Math.max(0, a[i] - (cum[hi] - cum[lo]) / (hi - lo)); }
    return out;
  };
  const o = local(flux, Math.round(fps)), ob = local(bass, Math.round(fps));
  let mean = 0;
  for (let i = 0; i < F; i++) mean += o[i];
  mean /= F;
  if (!(mean > 1e-6)) return null;
  // 2. the tempo
  const maxLag = Math.ceil(fps * 4) + 2, ac = new Float32Array(maxLag + 1);
  for (let L = 1; L <= maxLag && L < F; L++) { let s = 0; for (let i = 0; i + L < F; i++) s += o[i] * o[i + L]; ac[L] = s / (F - L); }
  const at = q => { const i = Math.floor(q), f = q - i; return i + 1 <= maxLag ? ac[i] * (1 - f) + ac[i + 1] * f : 0; };
  // (only where the onsets do repeat at that period: its multiples alone would make a tempo of 2/3 look good)
  let best = -1, bpm = 120, acMax = 0;
  for (let L = Math.floor(fps * 60 / 200); L <= Math.ceil(fps * 60 / 60) && L <= maxLag; L++) acMax = Math.max(acMax, ac[L]);
  for (let b = 60; b <= 200; b += 0.1) {
    const L = fps * 60 / b, prior = Math.exp(-0.5 * Math.pow(Math.log2(b / 120), 2));
    if (at(L) < 0.4 * acMax) continue;
    const sc = (at(L) + 0.5 * at(2 * L) + 0.33 * at(3 * L) + 0.25 * at(4 * L)) * prior;
    if (sc > best) { best = sc; bpm = b; }
  }
  // (half or double the tempo can't be told apart in every style: drum and bass may read as half; the timeline offers ×2 and ÷2)
  // 3. the beats: the kick's real rise (the sub's loudness, not its log: a bass note's rise looks as big as a kick's on
  // a log scale, but isn't), with the onsets, each over its average
  const kr = new Float32Array(F);
  for (let i = 1; i < F; i++) kr[i] = Math.max(0, sub[i] - sub[i - 1]);
  const krl = local(kr, Math.round(fps)), avg = a => { let s2 = 0; for (let i = 0; i < F; i++) s2 += a[i]; return s2 / F || 1; };
  const ma = avg(o), mk = avg(krl), beatOn = new Float32Array(F);
  for (let i = 0; i < F; i++) beatOn[i] = o[i] / ma + 1.5 * krl[i] / mk;
  const near = (src, q) => { const i = Math.floor(q), f = q - i, g = j => src[j] || 0; return Math.max(g(i) * (1 - f) + g(i + 1) * f, 0.6 * g(i - 1), 0.6 * g(i + 2)); };
  const comb = (src, ph, step) => { let s2 = 0, c = 0; for (let q = ph; q < F - 1; q += step) { s2 += near(src, q); c++; } return s2 / (c || 1); };
  // the tempo exactly: the one whose beats stay on them longest (within 1%), a whole number when within 0.15
  const fit = b => { const P = fps * 60 / b; let bp = -1, ph = 0; for (let q = 0; q < P; q += 0.5) { const v = comb(beatOn, q, P); if (v > bp) { bp = v; ph = q; } } return [bp, ph]; };
  // of the tempo found, half, two thirds, one and a half and twice it: the one whose every beat lands on onsets (a
  // tempo of 2/3 lands every third beat between two), gently preferring those near 120
  let cand = bpm, cb = -1;
  for (const k of [1, 0.5, 2 / 3, 1.5, 2]) {
    const b = bpm * k;
    if (b < 60 || b > 200) continue;
    const v = fit(b)[0] * Math.exp(-0.5 * Math.pow(Math.log2(b / 120) / 1.5, 2)) * (k === 1 ? 1.05 : 1);
    if (v > cb) { cb = v; cand = b; }
  }
  bpm = cand;
  let fine = bpm, fb = -1;
  for (let b = bpm * 0.99; b <= bpm * 1.01; b += 0.02) { const [v] = fit(b); if (v > fb) { fb = v; fine = b; } }
  fine = Math.abs(fine - Math.round(fine)) < 0.15 ? Math.round(fine) : Math.round(fine * 100) / 100;
  const P = fps * 60 / fine;
  // where they fall, and how much better than anywhere else (conf: the best phase against the average one)
  let ph = 0, bp = -1, all = 0, nph = 0;
  for (let q = 0; q < P; q += 0.25) { const v = comb(beatOn, q, P); all += v; nph++; if (v > bp) { bp = v; ph = q; } }
  const conf = bp / (all / nph);
  // 4. the bar's first beat: where the music changes most from the beat before (chords, bass notes and sections change
  // on the bar), helped by the clap or snare on 2 and 4 and by the bass
  const nb = Math.floor((F - ph) / P), nov = new Float32Array(nb), vec = new Float32Array(B), last = new Float32Array(B);
  for (let k = 0; k < nb; k++) {
    const a = Math.round(ph + k * P), e = Math.min(F, Math.round(ph + (k + 1) * P));
    vec.fill(0);
    for (let f = a; f < e; f++) for (let b = 0; b < B; b++) vec[b] += spec[f * B + b];
    let d = 0;
    for (let b = 0; b < B; b++) { vec[b] /= Math.max(1, e - a); if (k) d += Math.abs(vec[b] - last[b]); last[b] = vec[b]; }
    nov[k] = d;
  }
  const by4 = (arr, j) => { let s2 = 0, c = 0; for (let k = j; k < arr.length; k += 4) { s2 += arr[k]; c++; } return s2 / (c || 1); };
  const om = local(mid, Math.round(fps)), on = j => comb(om, ph + j * P, 4 * P), bs = j => comb(ob, ph + j * P, 4 * P) / (avg(ob) || 1) + comb(krl, ph + j * P, 4 * P) / mk;
  // each hint as how far each of the four stands out from their average (one that tells them apart counts; one that
  // doesn't adds nothing)
  const rel = v => { const m = (v[0] + v[1] + v[2] + v[3]) / 4 || 1; return v.map(x => x / m - 1); };
  const nv = rel([0, 1, 2, 3].map(j => by4(nov, j))), bsv = rel([0, 1, 2, 3].map(bs));
  const onv = [0, 1, 2, 3].map(on), onm = (onv[0] + onv[1] + onv[2] + onv[3]) / 4 || 1;
  const snr = [0, 1, 2, 3].map(j => (onv[(j + 1) % 4] + onv[(j + 3) % 4] - onv[j] - onv[(j + 2) % 4]) / (4 * onm));
  const total = j => nv[j] + 0.5 * snr[j] + bsv[j];
  let j0 = 0;
  for (let j = 1; j < 4; j++) if (total(j) > total(j0)) j0 = j;
  // a frame's time: the middle of its window
  const bar = 4 * 60 / fine, lat = (N / 2 - hop / 2) / sr, t0 = (((ph + j0 * P) * hop / sr + lat) % bar + bar) % bar;
  return { bpm: fine, t0: Math.round(t0 * 1000) / 1000, conf, weak: conf < 1.6 };
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
