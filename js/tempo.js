// nouPix · js/tempo.js
// Tempo: the beat of the music, from a sound card's input (its BPM found by listening) or tapped (a button, a MIDI
// pad). A beat clock the rest can read: tempoAt(t) says which beat it is, how far into it, and where in the bar.
// This computer's (ui.tempo*): the input, its trim, the source, beats per bar; not part of the project.

const TEMPO_MIN = 60, TEMPO_MAX = 200;
const tempo = {
  bpm: 120,           // beats per minute
  anchor: 0,          // performance.now() of a downbeat (beat 1 of a bar); beats count from it
  conf: 0,            // how sure the listening is, 0 to 1 (0 while silent or still listening)
  locked: false,      // listening has found a beat
  // the input
  on: false, starting: false, err: '', ctx: null, stream: null, gain: null, node: null, devices: [],
  level: -100, peak: -100, peakAt: 0,   // the input after its trim, in dB (peak held for a moment)
  // what listening keeps: the onset strength of each hop of audio, and when it was (audio time, seconds)
  env: [], envT: [], rate: 0, cand: 0, candN: 0, timer: 0,
  taps: [],
};
tempo.anchor = performance.now();

// The beat clock at time t (ms, as performance.now()): beats since the anchor, the beat's number in its bar (0 is
// the downbeat), and the phase within the beat (0 to 1)
function tempoAt(t = performance.now()) {
  const b = (t - tempo.anchor) / (60000 / tempo.bpm), n = Math.floor(b), per = tempoBpb();
  return { beat: b, n, inBar: ((n % per) + per) % per, phase: b - n, bpm: tempo.bpm };
}
const tempoBpb = () => (ui.tempoBpb === 2 ? 2 : 4);
// A new BPM, keeping where in the beat and in the bar the clock is now, so nothing jumps
function tempoSetBpm(bpm, t = performance.now()) {
  bpm = clamp(bpm, 20, 400);
  const b = (t - tempo.anchor) / (60000 / tempo.bpm);
  tempo.bpm = bpm;
  tempo.anchor = t - b * (60000 / bpm);
}
// The beat nearest to now becomes beat 1 of a bar
function tempoDownbeat(t = performance.now()) {
  const b = (t - tempo.anchor) / (60000 / tempo.bpm);
  tempo.anchor += Math.round(b) * (60000 / tempo.bpm);
  updateTempoUI();
}

/* ---------- tap ---------- */
// Each tap is a beat; the first of a run is beat 1. From the second on, the BPM and the beat follow the taps (a straight
// line through them, so one tap a little early or late doesn't throw it). A pause of 2 s starts a new run. Tapping
// while listening switches to tapping: the two would fight.
function tempoTap(t = performance.now()) {
  const T = tempo.taps;
  if (T.length && t - T[T.length - 1] > 2000) { T.length = 0; tempo.tapN = 0; }
  T.push(t); tempo.tapN = (tempo.tapN || 0) + 1;
  if (T.length > 8) T.shift();
  if (ui.tempoSrc !== 'tap') { ui.tempoSrc = 'tap'; savePrefs(); }
  if (T.length === 1) {
    tempo.anchor = t;   // beat 1, at the BPM it had
  } else {
    // least squares: tap k at a + k·p
    const n = T.length, mx = (n - 1) / 2, my = T.reduce((a, x) => a + x, 0) / n;
    let sxy = 0, sxx = 0;
    T.forEach((x, k) => { sxy += (k - mx) * (x - my); sxx += (k - mx) * (k - mx); });
    const p = sxy / sxx;
    if (p > 60000 / 400 && p < 60000 / 20) {
      tempo.bpm = 60000 / p;
      tempo.anchor = my - mx * p - (tempo.tapN - n) * p;   // the run's first tap is beat 1, also once the oldest are let go
      ui.tempoBpm = Math.round(tempo.bpm * 10) / 10; savePrefs();
    }
  }
  tempo.locked = true;
  updateTempoUI();
}

/* ---------- listening ---------- */
// The sound card's input goes through the trim (a gain), then to a worklet that measures, for every 512 samples,
// how much the sound's energy rose: a kick drum (the bass, below about 150 Hz) counts most, the whole band a little.
// Those rises (onsets) come back here; every 200 ms the last 8 seconds of them are compared with themselves shifted
// by one beat's length for every tempo from 60 to 200 BPM (autocorrelation): the shift where they match best is the
// beat. Where the beats fall is found the same way, by adding up the onsets one beat apart for every start.
const ONSET_WORKLET = `
class NoupixOnset extends AudioWorkletProcessor {
  constructor() { super(); this.hop = 512; this.n = 0; this.lo = 0; this.eLo = 0; this.eAll = 0; this.pLo = 0; this.pAll = 0;
    this.k = 1 - Math.exp(-2 * Math.PI * 150 / sampleRate); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      this.lo += this.k * (x - this.lo);
      this.eLo += this.lo * this.lo; this.eAll += x * x;
      if (++this.n === this.hop) {
        const lo = Math.log(1 + 1e4 * this.eLo / this.hop), all = Math.log(1 + 1e3 * this.eAll / this.hop);
        const v = Math.max(0, lo - this.pLo) + 0.4 * Math.max(0, all - this.pAll);
        this.port.postMessage([currentTime + (i + 1 - ch.length) / sampleRate, v, this.eAll / this.hop]);
        this.pLo = lo; this.pAll = all; this.n = 0; this.eLo = 0; this.eAll = 0;
      }
    }
    return true;
  }
}
registerProcessor('noupix-onset', NoupixOnset);`;

const tempoUsable = () => !REMOTE_CLIENT && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorkletNode);
// The sound cards' inputs; their names only once the browser was allowed to listen
async function tempoDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    tempo.devices = all.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, name: d.label || `Input ${i + 1}` }));
  } catch (e) { tempo.devices = []; }
  updateTempoUI();
}
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => tempoDevices());

async function tempoListen(on) {
  if (!tempoUsable()) return;
  if (!on) { tempoStop(); ui.tempoOn = false; savePrefs(); updateTempoUI(); return; }
  if (tempo.on || tempo.starting) return;
  tempo.starting = true; tempo.err = '';
  updateTempoUI();
  try {
    const want = ui.tempoIn && ui.tempoIn !== 'default' ? { exact: ui.tempoIn } : undefined;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: want, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      if (!want || e.name !== 'OverconstrainedError') throw e;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });   // that card is gone: the default one
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const url = URL.createObjectURL(new Blob([ONSET_WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = ctx.createMediaStreamSource(stream), gain = ctx.createGain(), node = new AudioWorkletNode(ctx, 'noupix-onset');
    gain.gain.value = tempoGain();
    src.connect(gain); gain.connect(node); node.connect(ctx.destination);   // silent: it writes nothing; connected so it runs
    node.port.onmessage = e => tempoOnset(e.data);
    Object.assign(tempo, { ctx, stream, gain, node, on: true, env: [], envT: [], rate: ctx.sampleRate / 512, cand: 0, candN: 0, conf: 0, locked: false });
    tempo.timer = setInterval(tempoAnalyse, 200);
    // an audio context made without a click waits for one (the browser's rule for sound)
    if (ctx.state === 'suspended') addEventListener('pointerdown', () => ctx.resume(), { once: true, capture: true });
    ui.tempoOn = true; savePrefs();
    tempoDevices();
  } catch (e) {
    tempoStop();
    tempo.err = e.name === 'NotAllowedError' ? 'nouPix isn’t allowed to listen: allow the microphone for it.'
      : e.name === 'NotFoundError' ? 'No sound input found.' : 'Can’t listen: ' + (e.message || e.name);
  }
  tempo.starting = false;
  updateTempoUI();
}
function tempoStop() {
  clearInterval(tempo.timer);
  if (tempo.stream) tempo.stream.getTracks().forEach(t => t.stop());
  if (tempo.ctx) tempo.ctx.close().catch(() => {});
  Object.assign(tempo, { on: false, ctx: null, stream: null, gain: null, node: null, level: -100, peak: -100, conf: 0, locked: false });
}
// Another input: listening starts again on it
function tempoInput(id) {
  ui.tempoIn = id; savePrefs();
  if (tempo.on) { tempoStop(); tempoListen(true); }
}
const tempoGain = () => Math.pow(10, clamp(+ui.tempoTrim || 0, -24, 24) / 20);
function tempoTrim(db) {
  ui.tempoTrim = clamp(Math.round(db * 2) / 2, -24, 24); savePrefs();
  if (tempo.gain) tempo.gain.gain.setTargetAtTime(tempoGain(), tempo.ctx.currentTime, 0.02);
}

const TEMPO_KEEP = 8;   // seconds of onsets kept and looked at
function tempoOnset([t, v, e]) {
  tempo.env.push(v); tempo.envT.push(t);
  if (tempo.env.length > TEMPO_KEEP * tempo.rate) { tempo.env.shift(); tempo.envT.shift(); }
  const db = 10 * Math.log10(e + 1e-12), now = performance.now();
  tempo.level = Math.max(db, tempo.level - 0.4);   // a meter: up at once, down about 35 dB a second
  if (db > tempo.peak || now - tempo.peakAt > 1200) { tempo.peak = db; tempo.peakAt = now; }
}
// performance.now() of an audio time
function tempoPerfTime(at) {
  const ts = tempo.ctx.getOutputTimestamp ? tempo.ctx.getOutputTimestamp() : null;
  return ts && ts.performanceTime ? ts.performanceTime + (at - ts.contextTime) * 1000 : performance.now() - (tempo.ctx.currentTime - at) * 1000;
}
function tempoAnalyse() {
  if (!tempo.on || ui.tempoSrc === 'tap') return;
  const rate = tempo.rate, raw = tempo.env, N = raw.length;
  if (N < rate * 4) return;   // 4 seconds before a first guess
  if (tempo.level < -70) { tempo.conf = 0; return; }   // silence: the beat goes on as it was
  // the onsets above their local average (a quarter of a second), so a steady loud part doesn't count
  const w = Math.max(2, Math.round(rate * 0.25)), x = new Float32Array(N);
  let run = 0;
  for (let i = 0; i < N; i++) {
    run += raw[i] - (i >= w ? raw[i - w] : 0);
    x[i] = Math.max(0, raw[i] - run / Math.min(i + 1, w));
  }
  const ac = L => { let s = 0; for (let i = L; i < N; i++) s += x[i] * x[i - L]; return s / (N - L); };
  const a0 = ac(0);
  if (a0 <= 0) { tempo.conf = 0; return; }
  const lo = Math.floor(60 * rate / TEMPO_MAX), hi = Math.ceil(60 * rate / TEMPO_MIN);
  const A = new Float32Array(2 * hi + 2);
  for (let L = lo; L <= Math.min(2 * hi + 1, N - 1); L++) A[L] = ac(L);
  // a tempo's score: its own beat, and helped by the bar's half (two beats); tempos near 120 are preferred a little,
  // so a song isn't heard at half or double its speed
  const score = L => (A[L] + 0.5 * (2 * L < A.length ? A[2 * L] : 0)) * Math.exp(-0.5 * Math.pow(Math.log2(60 * rate / L / 120) / 1.0, 2));
  let best = lo, bs = -1;
  for (let L = lo; L <= hi; L++) { const s = score(L); if (s > bs) { bs = s; best = L; } }
  // finer than one hop: the beat's length that best matches 1, 2, 3 and 4 beats later together (the further, the finer)
  const far = new Map(), acAt = L => { if (!far.has(L)) far.set(L, L < N ? ac(L) : 0); return far.get(L); };
  const acF = L => { const j = Math.floor(L), f = L - j; return acAt(j) * (1 - f) + acAt(j + 1) * f; };
  let lag = best, lv = -1;
  for (let L = best - 0.6; L <= best + 0.6; L += 0.02) {
    let s = 0;
    for (let m = 1; m <= 4 && m * L < N - rate; m++) s += acF(m * L) * m;
    if (s > lv) { lv = s; lag = L; }
  }
  const cand = 60 * rate / lag, y1 = A[best];
  tempo.conf = clamp(y1 / a0 * 2, 0, 1);
  if (tempo.conf < 0.15) return;
  // the BPM follows a close guess smoothly; a far one only once it has come three times
  const cur = tempo.locked ? tempo.bpm : 0;
  if (cur && Math.abs(cand - cur) / cur < 0.03) tempoSetBpm(cur + (cand - cur) * 0.3);
  else {
    if (tempo.cand && Math.abs(cand - tempo.cand) / tempo.cand < 0.03) tempo.candN++; else { tempo.cand = cand; tempo.candN = 1; }
    // half or double the beat is the usual mistake: it has to come many times more
    const octave = cur && [0.5, 2].some(r => Math.abs(cand / cur - r) < 0.04);
    if (tempo.candN >= (!cur ? 2 : octave ? 15 : 3)) { tempoSetBpm(cand); tempo.locked = true; tempo.candN = 0; }
    else if (!cur) return;
  }
  // where the beats fall: the start whose onsets, one beat apart going back, add up the most (recent ones count more)
  const P = 60 * rate / tempo.bpm, at = i => { const j = Math.floor(i), f = i - j; return j < 0 || j + 1 >= N ? 0 : x[j] * (1 - f) + x[j + 1] * f; };
  let bo = 0, bv = -1;
  for (let o = 0; o < P; o += 0.5) {
    let s = 0, wk = 1;
    for (let i = N - 2 - o; i >= 0; i -= P) { s += at(i) * wk; wk *= 0.92; }
    if (s > bv) { bv = s; bo = o; }
  }
  const beatT = tempoPerfTime(tempo.envT[N - 1] - bo / rate);
  // the clock moves a quarter of the way toward it each time, so it locks without jumping
  const b = (beatT - tempo.anchor) / (60000 / tempo.bpm), err = b - Math.round(b);
  tempo.anchor += err * (60000 / tempo.bpm) * 0.25;
}

// At start: the tapped BPM kept from last time, and listening again if it was on
function initTempo() {
  if (ui.tempoBpm) tempo.bpm = clamp(+ui.tempoBpm, 20, 400);
  if (ui.tempoOn && tempoUsable()) tempoListen(true);
}
