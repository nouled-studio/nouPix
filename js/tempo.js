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
  // listening: the tracker, and when each hop of audio was (audio time, seconds)
  tracker: null, envT: [], holding: false, lastBeatHop: null,
  taps: [],
};
tempo.anchor = performance.now();

// The beat clock at time t (ms, as performance.now()): beats since the anchor, the beat's number in its bar (0 is
// the downbeat), and the phase within the beat (0 to 1)
// (tempo.fixed, set by tests only, holds the clock at that beat)
function tempoAt(t = performance.now()) {
  const b = tempo.fixed ?? (t - tempo.anchor) / (60000 / tempo.bpm), n = Math.floor(b), per = tempoBpb();
  return { beat: b, n, inBar: ((n % per) + per) % per, phase: b - n, bpm: tempo.bpm };
}
const tempoBpb = () => (ui.tempoBpb === 2 ? 2 : 4);
// Whether there is a beat to show: listening has found one, or it was tapped since nouPix started
const tempoActive = () => (ui.tempoSrc === 'tap' ? !!tempo.tapped : tempo.on && tempo.locked);
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
  T.push(t); tempo.tapN = (tempo.tapN || 0) + 1; tempo.tapped = true;
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
// The sound card's input goes through the trim (a gain) to a worklet that, for every 512 samples, measures how much
// the energy rose in the beat band (40 to 150 Hz at first, the kick drum; its edges are dragged on the spectrum in
// Settings; filters of the 4th order, so what is outside barely counts). Those rises (onsets) are what the beat is
// found in. The band's own level goes along, for the meter.
const TEMPO_BAND = [40, 150];
const ONSET_WORKLET = `
const bq = (hp, f) => { const w = 2 * Math.PI * f / sampleRate, c = Math.cos(w), a = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + a;
  const g = hp ? (1 + c) / 2 : (1 - c) / 2;
  return { b0: g / a0, b1: (hp ? -2 * g : 2 * g) / a0, b2: g / a0, a1: -2 * c / a0, a2: (1 - a) / a0, z1: 0, z2: 0 }; };
const run = (fs, x) => { for (const f of fs) { const y = f.b0 * x + f.z1; f.z1 = f.b1 * x - f.a1 * y + f.z2; f.z2 = f.b2 * x - f.a2 * y; x = y; } return x; };
class NoupixOnset extends AudioWorkletProcessor {
  constructor() { super(); this.hop = 512; this.n = 0; this.eb = 0; this.ea = 0; this.pb = 0; this.band(40, 150);
    this.port.onmessage = e => this.band(e.data[0], e.data[1]); }
  band(lo, hi) { this.filt = [bq(1, lo), bq(1, lo), bq(0, hi), bq(0, hi)]; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i], b = run(this.filt, x);
      this.eb += b * b; this.ea += x * x;
      if (++this.n === this.hop) {
        const lb = Math.log(1 + 1e4 * this.eb / this.hop);
        this.port.postMessage([currentTime + (i + 1 - ch.length) / sampleRate, Math.max(0, lb - this.pb), this.eb / this.hop, this.ea / this.hop]);
        this.pb = lb; this.n = 0; this.eb = 0; this.ea = 0;
      }
    }
    return true;
  }
}
registerProcessor('noupix-onset', NoupixOnset);`;
// The beat band's edges (Hz), this computer's
const tempoBandNow = () => { const lo = +ui.tempoLo || TEMPO_BAND[0], hi = +ui.tempoHi || TEMPO_BAND[1]; return [clamp(lo, 20, 8000), clamp(Math.max(hi, lo * 1.25), 30, 16000)]; };
function tempoBand(lo, hi, save) {
  ui.tempoLo = Math.round(lo); ui.tempoHi = Math.round(hi);
  if (tempo.node) tempo.node.port.postMessage(tempoBandNow());
  if (save) savePrefs();
}

// The beat tracker, after BTrack (Stark, Davies and Plumbley) and Davies' context-dependent tracking, on the onsets of
// each hop of audio (rate: hops a second). Three parts:
// - the tempo: every 0.2 s, the onsets of the last 6 s are compared with themselves shifted (autocorrelation), and a
//   bank of combs (1 to 4 beats on) scores every tempo from 60 to 200 BPM, those near 120 a little more. The scores
//   update a belief over the tempos that can only drift a little each time (a hidden Markov model): the tempo has
//   inertia, a real change wins after some seconds, half or double the beat rarely;
// - the beat: a cumulative score, each hop's onset plus 90% of the best score about one beat back, so the beat goes on
//   by its own momentum where there are no onsets, and stray hits barely move it; the beat is where it peaks;
// - holding: while the kick band is quiet or no tempo stands out (a break, a melody), nothing is learnt from the sound:
//   the tempo and the beat run on as they were, until a clear beat has been back for a second.
const TT_KEEP = 8, TT_ACF = 6, TT_STATES = 200, TT_ALPHA = 0.9, TT_TIGHT = 5;
function TempoTracker(rate) {
  this.rate = rate; this.o = []; this.x = []; this.C = []; this.n = 0;
  this.states = Array.from({ length: TT_STATES }, (_, i) => TEMPO_MIN * Math.pow(TEMPO_MAX / TEMPO_MIN, i / (TT_STATES - 1)));
  this.prior = this.states.map(b => Math.exp(-0.5 * Math.pow(Math.log2(b / 120) / 0.9, 2)));
  this.post = new Float64Array(TT_STATES).fill(1 / TT_STATES);
  this.bpm = 120; this.locked = false; this.hold = true; this.good = 0; this.strength = 0; this.usual = 0;
  this.act = 0; this.longAct = 0; this.eNow = 0; this.beatLvl = null; this.since = 0; this.cand = 0; this.candT = 0; this.beatHop = null; this.miss = 0; this.every = Math.max(1, Math.round(rate * 0.2));
}
// one hop: the beat band's onset k, and its energy e (for how loud the band is: a filter taking the kick away shows
// there, where the onsets, measured on a log scale, stay as big as ever)
TempoTracker.prototype.push = function (k, e = 0) {
  this.eNow += (e - this.eNow) / this.rate;   // over about a second
  const v = k, keep = Math.round(TT_KEEP * this.rate);
  this.o.push(v); if (this.o.length > keep) this.o.shift();
  // above its local average (a quarter of a second), so a steady loud part doesn't count
  const w = Math.max(2, Math.round(this.rate * 0.25)), from = Math.max(0, this.o.length - w);
  let mean = 0; for (let i = from; i < this.o.length; i++) mean += this.o[i];
  const x = Math.max(0, v - mean / (this.o.length - from));
  this.x.push(x); if (this.x.length > keep) this.x.shift();
  // how busy the kick band is: now (1.5 s) and over a long time (20 s)
  this.act += (k - this.act) / (1.5 * this.rate);
  this.longAct += (k - this.longAct) / (20 * this.rate);
  // the cumulative score: while holding it hears nothing and runs on its momentum
  const P = 60 * this.rate / this.bpm, C = this.C, n = C.length;
  let best = 0;
  for (let d = Math.round(2 * P); d >= Math.round(P / 2); d--) {
    if (d > n) continue;
    const wgt = Math.exp(-0.5 * Math.pow(TT_TIGHT * Math.log(d / P), 2)), c = C[n - d] * wgt;
    if (c > best) best = c;
  }
  C.push((1 - TT_ALPHA) * (this.hold ? 0 : x) + TT_ALPHA * best); if (C.length > keep) C.shift();
  this.n++;
  if (this.n % this.every === 0) this.analyse();
};
TempoTracker.prototype.analyse = function () {
  const rate = this.rate, x = this.x, N = Math.min(x.length, Math.round(TT_ACF * rate)), off = x.length - N;
  if (N < 4 * rate) return;
  const ac = new Float64Array(Math.ceil(4.2 * rate) + 4);
  for (let L = 0; L < ac.length && L < N; L++) { let s = 0; for (let i = off + L; i < x.length; i++) s += x[i] * x[i - L]; ac[L] = s / (N - L); }
  const acF = L => { const j = Math.floor(L), f = L - j; return j + 1 < ac.length ? ac[j] * (1 - f) + ac[j + 1] * f : 0; };
  // the comb bank: each tempo's beat, two, three and four beats on (each a little spread)
  const obs = new Float64Array(TT_STATES);
  let mx = 0, sum = 0;
  for (let i = 0; i < TT_STATES; i++) {
    const P = 60 * rate / this.states[i];
    let s = 0;
    for (let a = 1; a <= 4; a++) for (let b = 1 - a; b <= a - 1; b++) s += acF(a * P + b) / (2 * a - 1);
    obs[i] = s * this.prior[i]; sum += obs[i]; if (obs[i] > mx) mx = obs[i];
  }
  this.strength = sum > 0 ? mx / (sum / TT_STATES) : 0;
  // how clear the beat usually is (over about 20 s of beat; not while holding, so a long break or filtered build-up
  // doesn't lower the bar): a break, a riff or a melody is much less clear than the music around
  if (!this.usual) this.usual = this.strength;
  else if (!this.hold) this.usual += (this.strength - this.usual) * 0.01;
  // the band's level against how loud it is with the beat: 12 dB under is the kick gone (a filter, a break)
  const lvl = 10 * Math.log10(this.eNow + 1e-12);
  const gone = this.beatLvl != null && lvl < this.beatLvl - 12;
  const quiet = gone || this.act < 0.3 * this.longAct || this.longAct < 1e-4;
  const clear = !quiet && this.strength > Math.max(2.5, 0.45 * this.usual);
  this.good = clear ? this.good + 0.2 : 0;
  // holding: nothing is learnt, the tempo and the beat run on; a clear beat must be back a second first
  this.hold = !(this.good >= 1);
  if (this.locked) this.since += 0.2;
  if (this.hold) return;
  // the belief over tempos: it may drift a little (about 1% each time), and now and then jump anywhere (a new track)
  const pred = new Float64Array(TT_STATES), sig = 1.5, floor = 2e-4;
  for (let i = 0; i < TT_STATES; i++) {
    let s = 0;
    for (let d = -5; d <= 5; d++) { const j = i + d; if (j >= 0 && j < TT_STATES) s += this.post[j] * Math.exp(-0.5 * (d / sig) * (d / sig)); }
    pred[i] = s + floor;
  }
  let tot = 0;
  for (let i = 0; i < TT_STATES; i++) { this.post[i] = pred[i] * Math.pow(obs[i] / mx, 3); tot += this.post[i]; }
  let bi = 0;
  for (let i = 0; i < TT_STATES; i++) { this.post[i] /= tot; if (this.post[i] > this.post[bi]) bi = i; }
  // the tempo: the belief's peak, finer by its neighbours
  let wsum = 0, lsum = 0;
  for (let d = -2; d <= 2; d++) { const j = bi + d; if (j >= 0 && j < TT_STATES) { wsum += this.post[j]; lsum += this.post[j] * Math.log(this.states[j]); } }
  const est = Math.exp(lsum / wsum);
  // finer still: the comb's peak near it, measured over 1 to 4 beats on
  let lag = 60 * rate / est, bv = -1;
  for (let L = lag * 0.985; L <= lag * 1.015; L += 0.02) {
    let s = 0; for (let a = 1; a <= 4; a++) s += acF(a * L) * a;
    if (s > bv) { bv = s; lag = L; }
  }
  const bpm = 60 * rate / lag;
  // the tempo and the beat take only what comes while the beat is about as clear as usual: the start of a break
  // (the beat fading out) teaches them nothing
  const firm = this.strength >= 0.7 * this.usual;
  if (!this.locked) { this.bpm = bpm; this.locked = true; this.since = 0; }
  else if (firm) {
    if (Math.abs(bpm - this.bpm) / this.bpm < 0.03 || this.since < 10) { this.bpm += (bpm - this.bpm) * 0.35; this.cand = 0; this.candT = 0; }
    else {
      // a tempo settled for 10 s gives way only to another that holds, clear, for 3 s (a new track, not a build-up)
      if (this.cand && Math.abs(bpm - this.cand) / this.cand < 0.02) this.candT += 0.2; else { this.cand = bpm; this.candT = 0.2; }
      if (this.candT >= 3) { this.bpm = bpm; this.since = 0; this.cand = 0; this.candT = 0; }
    }
  }
  if (!firm) return;
  // how loud the band is with the beat in it
  this.beatLvl = this.beatLvl == null ? lvl : this.beatLvl + (lvl - this.beatLvl) * 0.05;
  // the beat: where the cumulative score peaks, one beat apart going back (recent ones count more)
  const C = this.C, M = C.length, P = 60 * rate / this.bpm, at = i => { const j = Math.floor(i), f = i - j; return j < 0 || j + 1 >= M ? 0 : C[j] * (1 - f) + C[j + 1] * f; };
  let bo = 0, bs = -1;
  for (let o = 0; o < P; o += 0.25) {
    let s = 0, wk = 1;
    for (let k = 0; k < 4; k++) { s += at(M - 1 - o - k * P) * wk; wk *= 0.7; }
    if (s > bs) { bs = s; bo = o; }
  }
  const measured = this.n - 1 - bo;
  if (this.beatHop == null) { this.beatHop = measured; return; }
  // the beat it expects there; a measure far from it is a stray (a fill, a syncopation) unless it keeps coming
  const k = Math.round((measured - this.beatHop) / P), expect = this.beatHop + k * P, err = measured - expect;
  if (Math.abs(err) < 0.25 * P) { this.beatHop = expect + 0.2 * err; this.miss = 0; }
  else if (++this.miss >= 8) { this.beatHop = measured; this.miss = 0; }
  else this.beatHop = expect;
};

const tempoUsable = () => !REMOTE_CLIENT && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorkletNode);
// The sound cards' inputs; their names only once the browser was allowed to listen, shortened (no "Default - ", no
// USB numbers)
async function tempoDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    tempo.devices = all.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId,
      name: (d.label || `Input ${i + 1}`).replace(/^(Default|Communications)\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') }));
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
    node.port.postMessage(tempoBandNow());
    // the spectrum Settings draws: the browser's own analyser, after the trim
    const analyser = ctx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.6; gain.connect(analyser);
    Object.assign(tempo, { ctx, stream, gain, node, analyser, on: true, envT: [], tracker: new TempoTracker(ctx.sampleRate / 512), conf: 0, locked: false, lastBeatHop: null });
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
  if (tempo.stream) tempo.stream.getTracks().forEach(t => t.stop());
  if (tempo.ctx) tempo.ctx.close().catch(() => {});
  Object.assign(tempo, { on: false, ctx: null, stream: null, gain: null, node: null, analyser: null, tracker: null, level: -100, peak: -100, conf: 0, locked: false, holding: false });
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

// Each hop from the worklet: the meter (the beat band's level), the tracker, and the beat clock following the tracker
function tempoOnset([t, k, e]) {
  const db = 10 * Math.log10(e + 1e-12), now = performance.now();
  tempo.level = Math.max(db, tempo.level - 0.4);   // a meter: up at once, down about 35 dB a second
  if (db > tempo.peak || now - tempo.peakAt > 1200) { tempo.peak = db; tempo.peakAt = now; }
  const T = tempo.tracker;
  if (!T) return;
  tempo.envT.push(t); if (tempo.envT.length > TT_KEEP * T.rate) tempo.envT.shift();
  T.push(k, e);
  tempo.holding = T.hold && T.locked;
  tempo.conf = T.hold ? 0 : clamp((T.strength - 1.6) / 2, 0, 1);
  if (ui.tempoSrc === 'tap' || !T.locked) return;
  if (!tempo.locked) { tempo.locked = true; tempoSetBpm(T.bpm); }
  else if (Math.abs(T.bpm - tempo.bpm) > 0.005) tempoSetBpm(T.bpm);
  // a beat the tracker placed: the clock moves onto it, keeping the bar's count
  if (T.beatHop != null && T.beatHop !== tempo.lastBeatHop && !T.hold) {
    tempo.lastBeatHop = T.beatHop;
    // its audio time, from the newest hop's (it can be a little ahead: the beat the tracker expects next)
    const at = tempo.envT[tempo.envT.length - 1] - (T.n - 1 - T.beatHop) / T.rate;
    // half way each time: the audio clock's mapping to this page's wobbles by a few milliseconds
    const beatT = tempoPerfTime(at), b = (beatT - tempo.anchor) / (60000 / tempo.bpm), err = b - Math.round(b);
    tempo.anchor += err * (60000 / tempo.bpm) * 0.5;
  }
}
// performance.now() of an audio time
function tempoPerfTime(at) {
  const ts = tempo.ctx.getOutputTimestamp ? tempo.ctx.getOutputTimestamp() : null;
  return ts && ts.performanceTime ? ts.performanceTime + (at - ts.contextTime) * 1000 : performance.now() - (tempo.ctx.currentTime - at) * 1000;
}

// At start: the tapped BPM kept from last time, and listening again if it was on
function initTempo() {
  if (ui.tempoBpm) tempo.bpm = clamp(+ui.tempoBpm, 20, 400);
  if (ui.tempoOn && tempoUsable()) tempoListen(true);
}

/* ---------- the music, for effects ---------- */
// An effect's float inputs with these names follow the music instead of a slider (they are not shown as controls):
// bpm, beatCount (beats since the clock's beat 1, going on), beatPhase (0 to 1 within the beat), barBeat (the beat's
// number in the bar, 0 to beatsPerBar - 1), barPhase (0 to 1 within the bar), beatsPerBar, and the sound's level
// in bands, 0 to 1, quick to rise and slower to fall: audioKick (the beat band), audioBass, audioMid, audioHigh,
// audioLevel (all of it). An image input called audioSpectrum is the spectrum, 64 bands from 30 Hz to 16 kHz on a log
// scale, left to right, the level in red. Without a sound input the beat still runs (at the tapped or last BPM) and
// the levels are 0; on a source's thumbnail they are made up, so it shows what it does.
const AUDIO_INPUTS = new Set(['bpm', 'beatCount', 'beatPhase', 'barBeat', 'barPhase', 'beatsPerBar', 'audioKick', 'audioBass', 'audioMid', 'audioHigh', 'audioLevel', 'audioBand', 'audioSpectrum']);
const isAudioInput = inp => AUDIO_INPUTS.has(inp.NAME) && (inp.NAME === 'audioSpectrum' ? inp.TYPE === 'image' : inp.TYPE === 'float');
const SPEC_BANDS = 64;
// the bands' edges and middles, 30 Hz to 16 kHz in equal steps of pitch (worked out once, not every frame)
const SPEC_EDGE = Array.from({ length: SPEC_BANDS + 1 }, (_, i) => 30 * Math.pow(16000 / 30, i / SPEC_BANDS));
const SPEC_MID = Array.from({ length: SPEC_BANDS }, (_, i) => 30 * Math.pow(16000 / 30, (i + 0.5) / SPEC_BANDS));
const tempoFeat = { frame: -1, kick: 0, bass: 0, mid: 0, high: 0, level: 0, bands: new Float32Array(SPEC_BANDS), spec: null, fakeSpec: null };
// The levels, worked out once a frame from the analyser
function tempoFeatures() {
  const F = tempoFeat;
  if (F.frame === frameIndex) return F;
  F.frame = frameIndex;
  const A = tempo.analyser, fall = 0.88;
  const ease = (k, v) => { F[k] = v > F[k] ? v : F[k] * fall + v * (1 - fall); };
  if (!A) { for (const k of ['kick', 'bass', 'mid', 'high', 'level']) F[k] *= fall; F.bands.fill(0); return F; }
  const bins = A._fx || (A._fx = new Float32Array(A.frequencyBinCount)), hz = tempo.ctx.sampleRate / A.fftSize;
  A.getFloatFrequencyData(bins);
  const db = v => clamp((v + 90) / 60, 0, 1);
  for (let i = 0; i < SPEC_BANDS; i++) {
    const fa = SPEC_EDGE[i], fb = SPEC_EDGE[i + 1];
    let v = -140;
    for (let k = Math.floor(fa / hz); k <= Math.ceil(fb / hz) && k < bins.length; k++) v = Math.max(v, bins[k]);
    const x = db(v); F.bands[i] = x > F.bands[i] ? x : F.bands[i] * fall + x * (1 - fall);
  }
  const avg = (f0, f1) => bandAvg(f0, f1);
  const now = performance.now(), dt = F.dt = clamp((now - (F.at || now)) / 1000, 0, 0.5); F.at = now;
  ease('bass', tempoRange('bass', avg(30, 150), dt)); ease('mid', tempoRange('mid', avg(150, 2000), dt));
  ease('high', tempoRange('high', avg(2000, 16000), dt)); ease('level', tempoRange('level', avg(30, 16000), dt));
  ease('kick', tempoRange('kick', clamp((tempo.level + 50) / 44, 0, 1), dt));
  return F;
}
// The spectrum's mean level from f0 to f1 Hz
function bandAvg(f0, f1) {
  let s = 0, n = 0;
  for (let i = 0; i < SPEC_BANDS; i++) { const f = SPEC_MID[i]; if (f >= f0 && f < f1) { s += tempoFeat.bands[i]; n++; } }
  return n ? s / n : 0;
}
// The frequency ranges an effect can listen to (its long input "band", with these labels, and the input audioBand):
// the first is the beat band as set in Tempo (audioKick), the others a part of the spectrum, in Hz
const AUDIO_BANDS = [['Beat band (Tempo)', 0, 0], ['Sub and kick', 30, 90], ['Bass', 60, 250], ['Low mids', 250, 800], ['Mids', 800, 2500],
  ['Snare and claps', 1500, 5000], ['Highs and hats', 5000, 16000], ['Everything', 30, 16000]];
// That range's level now, in the music's range like the others
function audioBandValue(k) {
  const F = tempoFeatures(), band = AUDIO_BANDS[k | 0] ? k | 0 : 0;
  if (!band) return F.kick;
  const b = F.custom || (F.custom = {}), e = b[band] || (b[band] = { frame: -1, v: 0 });
  if (e.frame !== F.frame) {
    e.frame = F.frame;
    const x = tempo.analyser ? tempoRange('band' + band, bandAvg(AUDIO_BANDS[band][1], AUDIO_BANDS[band][2]), F.dt || 0) : 0;
    e.v = x > e.v ? x : e.v * 0.88 + x * 0.12;
  }
  return e.v;
}
// A level placed between the music's recent quiet and loud moments, so an effect swings fully whatever the volume:
// the floor drops at once to a trough and creeps up over about 8 s; the ceiling jumps to a peak and sinks over about
// 8 s; at least 8 dB apart (0.13), so near silence isn't blown up into noise, and nothing at all below about −87 dB.
const tempoRanges = {};
function tempoRange(k, v, dt) {
  const r = tempoRanges[k] || (tempoRanges[k] = { lo: v, hi: v + 0.13 }), slow = 1 - Math.exp(-dt / 8), fast = 1 - Math.exp(-dt / 0.05);
  r.lo += (v - r.lo) * (v < r.lo ? fast : slow);
  r.hi += (v - r.hi) * (v > r.hi ? fast : slow);
  return clamp((v - r.lo) / Math.max(0.13, r.hi - r.lo), 0, 1) * clamp(v * 20, 0, 1);
}
// The spectrum as a 64 × 1 picture, for an effect's audioSpectrum: the real one drawn once a frame, however many
// effects show it; a thumbnail's made-up one (fake: band -> level) in a picture of its own
function tempoSpectrumCanvas(fake) {
  const F = tempoFeat, k = fake ? 'fakeSpec' : 'spec';
  let S = F[k];
  if (!S) { const c = document.createElement('canvas'); c.width = SPEC_BANDS; c.height = 1; const x = c.getContext('2d'); S = F[k] = { c, x, img: x.createImageData(SPEC_BANDS, 1), frame: -2 }; }
  if (!fake && S.frame === F.frame) return S.c;
  S.frame = F.frame;
  const d = S.img.data;
  for (let i = 0; i < SPEC_BANDS; i++) { const v = fake ? fake(i) : F.bands[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(clamp(v, 0, 1) * 255); d[i * 4 + 3] = 255; }
  S.x.putImageData(S.img, 0, 0);
  return S.c;
}
// An audio input's value now; t: a thumbnail's time (made-up music at 120 BPM; a still one just after a beat 1, so it
// shows lit), or null for the real thing; band: for audioBand, the range chosen (AUDIO_BANDS)
function audioInputValue(name, t, still, band) {
  if (t != null) {
    const b = still ? 4.08 : t * 2, ph = b - Math.floor(b), bpb = tempoBpb(), hit = Math.exp(-ph * 5);
    const lv = { audioKick: hit, audioBass: 0.3 + 0.6 * hit, audioBand: 0.3 + 0.6 * hit, audioMid: 0.4 + 0.2 * Math.sin(t * 3), audioHigh: 0.3 + 0.2 * Math.sin(t * 7), audioLevel: 0.5 + 0.3 * hit };
    if (name === 'audioSpectrum') return tempoSpectrumCanvas(i => (1 - i / SPEC_BANDS) * (0.5 + 0.4 * hit) + 0.15 * Math.sin(i * 0.7 + t * 4));
    return { bpm: 120, beatCount: b, beatPhase: ph, barBeat: Math.floor(b) % bpb, barPhase: ((b / bpb) % 1), beatsPerBar: bpb }[name] ?? lv[name] ?? 0;
  }
  if (name === 'audioSpectrum') { tempoFeatures(); return tempoSpectrumCanvas(); }
  if (name === 'audioBand') return audioBandValue(band);
  if (name.startsWith('audio')) return tempoFeatures()[name.slice(5).toLowerCase()] || 0;
  const at = tempoAt(), bpb = tempoBpb();
  return { bpm: tempo.bpm, beatCount: at.beat, beatPhase: at.phase, barBeat: at.inBar, barPhase: (at.inBar + at.phase) / bpb, beatsPerBar: bpb }[name] ?? 0;
}

/* ---------- Fixture chase ---------- */
// A built-in source (kind 'chase') that lights groups of fixtures, or single fixtures, one after the other on the
// beat: drawn as a dot at every pixel of the step's fixtures, on black, so it can play on its own or, above other
// content with Blend: Multiply, let that content through only where the chase is. Its settings are the layer's
// (L.params, kept by scenes): by ('groups' or 'fixtures'), skip (ids left out), every (beats a step lasts), order
// ('forward', 'back', 'pingpong', 'random'), mode ('one' lit at a time, or 'fill' adding up through the round),
// fade (0: lit the whole step; up to 1: fading out over the step), color.
const CHASE_DEFAULT = { by: 'groups', skip: [], every: 1, order: 'forward', mode: 'one', fade: 0.5, color: [1, 1, 1, 1] };
function chaseParams(L, src) {
  const p = Object.assign({}, CHASE_DEFAULT, (L.params && L.params[src.id]) || {});
  if (!['groups', 'fixtures'].includes(p.by)) p.by = 'groups';
  if (!Array.isArray(p.skip)) p.skip = [];
  p.every = [0.25, 0.5, 1, 2, 4].includes(+p.every) ? +p.every : 1;
  if (!['forward', 'back', 'pingpong', 'random'].includes(p.order)) p.order = 'forward';
  if (!['one', 'fill'].includes(p.mode)) p.mode = 'one';
  p.fade = clamp(numOr(p.fade, 0.5), 0, 1);
  if (!Array.isArray(p.color) || p.color.length < 3) p.color = [1, 1, 1, 1];
  return p;
}
// Its steps, in the fixture list's order: each a list of fixtures (a group's, or one); by groups with no groups,
// each fixture. Only those with a pixel in the zone, when there is one.
function chaseSteps(p, z) {
  const fx = project.fixtures.filter(f => f._pts && (!z || chaseInZone(z).has(f)));
  let steps;
  if (p.by === 'groups' && project.groups.length) {
    const seen = new Map();
    for (const f of fx) if (f.group && groupById(f.group)) { if (!seen.has(f.group)) seen.set(f.group, []); seen.get(f.group).push(f); }
    steps = [...seen].map(([id, list]) => ({ id, fx: list }));
  } else steps = fx.map(f => ({ id: f.id, fx: [f] }));
  return steps.filter(s => !p.skip.includes(s.id));
}
// The fixtures with a pixel in a zone: every pixel looked at only when the layout or the zone changes (z._chaseIn)
function chaseInZone(z) {
  const key = [geomVersion, z.x, z.y, z.w, z.h, project.fixtures.length].join('|');
  if (z._chaseIn && z._chaseIn.key === key) return z._chaseIn.set;
  const set = new Set();
  for (const f of project.fixtures) {
    const P = f._pts;
    if (!P) continue;
    for (let i = 0; i < P.length; i += 2) if (P[i] >= z.x && P[i] <= z.x + z.w && P[i + 1] >= z.y && P[i + 1] <= z.y + z.h) { set.add(f); break; }
  }
  z._chaseIn = { key, set };
  return set;
}
const chaseHash = k => { let x = (k * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; return (x ^ (x >>> 13)) >>> 0; };
// Which steps are lit, and how much, at a beat count b
function chaseLit(p, n, b) {
  const s = b / p.every, k = Math.floor(s), ph = s - k, glow = p.fade > 0 ? Math.pow(Math.max(0, 1 - ph / p.fade), 1.5) : 1;
  const round = p.order === 'pingpong' ? Math.max(1, 2 * n - 2) : n, m = ((k % round) + round) % round;
  const at = j => (p.order === 'back' ? n - 1 - j : p.order === 'pingpong' ? (j < n ? j : 2 * n - 2 - j) : p.order === 'random' ? (n > 1 ? (chaseHash(k) % n) : 0) : j);
  const out = new Map();
  if (p.mode === 'fill' && p.order !== 'random') for (let j = 0; j <= m; j++) out.set(at(j), 1);   // adding up through the round
  else out.set(at(m), glow);
  return out;
}
// Draws it into the media canvas at w × h for zone z (none: the whole canvas, as on its thumbnail); t: a thumbnail's
// beat count, or null for the beat clock
function drawChase(src, L, w, h, z, t) {
  const top = mediaCanvas.height - h, p = chaseParams(L, src), area = z || { x: 0, y: 0, w: project.settings.compW, h: project.settings.compH };
  mctx.save();
  mctx.fillStyle = '#000'; mctx.fillRect(0, top, w, h);
  const b = t != null ? t : tempoAt().beat, sx = w / area.w, sy = h / area.h, col = p.color.slice(0, 3).map(v => Math.round(clamp(v, 0, 1) * 255));
  const steps = chaseSteps(p, z);
  if (!steps.length && t != null) {
    // a thumbnail with nothing to chase yet: four bars taking turns
    const lit = chaseLit(p, 4, b);
    for (let i = 0; i < 4; i++) { const v = lit.get(i) || 0; mctx.fillStyle = `rgb(${col.map(c => Math.round(c * v)).join(',')})`; mctx.fillRect(w * (0.1 + i * 0.21), top + h * 0.2, w * 0.15, h * 0.6); }
  } else {
    const lit = chaseLit(p, steps.length, b);
    for (const [i, v] of lit) {
      const s = steps[i];
      if (!s || !(v > 0.002)) continue;
      mctx.fillStyle = `rgb(${col.map(c => Math.round(c * v)).join(',')})`;
      for (const f of s.fx) {
        const P = f._pts, d = Math.max(2, (f._pitch || 4) * Math.min(sx, sy));
        for (let i2 = 0; i2 < P.length; i2 += 2) mctx.fillRect((P[i2] - area.x) * sx - d / 2, top + (P[i2 + 1] - area.y) * sy - d / 2, d, d);
      }
    }
  }
  mctx.restore();
  return true;
}
