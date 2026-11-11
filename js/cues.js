// nouPix · js/cues.js
// Cue lists: GO plays the cue on standby (each of its actions: a zone's scene, its level, over the action's fade) and
// puts the next on standby; a cue can go on by itself after a wait (to the next cue or to another); levels fade on the
// frame clock. Only the main window plays them. Nothing of it is saved but the lists themselves.

// Each list's state while it runs, by its id: the cue played last (cur), the one on standby, when the last GO was
// (at, on the frame clock), and a cue to go by itself (auto: { cue, at })
const cueRun = new Map();
const cueListOf = id => project.cueLists.find(L => L.id === id) || null;
const cueOf = (L, id) => (L ? L.cues.find(c => c.id === id) || null : null);
function cueState(L) {
  let r = cueRun.get(L.id);
  if (!r) cueRun.set(L.id, r = { cur: null, standby: null, at: 0, auto: null });
  // cues deleted meanwhile: forget them; nothing on standby is the first cue
  if (r.cur && !cueOf(L, r.cur)) r.cur = null;
  if (r.standby && !cueOf(L, r.standby)) r.standby = null;
  if (!r.standby && !r.cur && L.cues.length) r.standby = L.cues[0].id;
  if (r.auto && !cueOf(L, r.auto.cue)) r.auto = null;
  return r;
}
// The cue after c in its list (null after the last)
const cueAfter = (L, c) => L.cues[L.cues.indexOf(c) + 1] || null;
// How long a cue takes: its longest fade
const cueLength = c => c.actions.reduce((m, a) => Math.max(m, a.fade), 0);
// GO: the cue on standby (or the one given) plays, the next one goes on standby
function cueGo(L, c) {
  if (REMOTE_CLIENT || !L) return;
  const r = cueState(L);
  c = c || cueOf(L, r.standby);
  if (!c) return;
  r.cur = c.id; r.at = clockT; r.auto = null;
  const next = c.then === 'goto' ? cueOf(L, c.target) : cueAfter(L, c);
  r.standby = next ? next.id : null;
  if (c.then !== 'wait' && next) r.auto = { cue: next.id, at: clockT + c.wait };
  playCue(c);
  refreshCues();
}
// Its actions: scenes fade in over their action's fade, levels move there over it
function playCue(c) {
  let scenes = false;
  for (const a of c.actions) {
    const z = zoneById(a.zone);
    if (!z) continue;
    const sc = a.scene && z.scenes.find(s => s.id === a.scene);
    if (sc) { playlistManual(z, sc.id); recallScene(z, sc, a.fade); scenes = true; }
    if (a.level != null) {
      if (a.fade > 0.01) z._lvl = { from: z.opacity, to: a.level, start: clockT, dur: a.fade, set: z.opacity };
      else { z._lvl = null; setZoneOpacity(z, a.level); }
    }
  }
  if (scenes) { syncMedia(); refreshScenes(); renderSrcList(); }
  remoteLiveChanged();
}
// Back: the cue before the one on standby goes on standby (nothing plays)
function cueBack(L) {
  if (!L) return;
  const r = cueState(L), s = cueOf(L, r.standby), i = s ? L.cues.indexOf(s) : L.cues.length;
  const prev = L.cues[Math.max(0, i - 1)];
  r.standby = prev ? prev.id : null; r.auto = null;
  refreshCues();
}
// Put a cue on standby without playing it
function cueStandby(L, c) { const r = cueState(L); r.standby = c ? c.id : null; r.auto = null; refreshCues(); }
// Stop: nothing goes on by itself, the levels stop where they are (the scenes' fades finish)
function cueStop(L) {
  const r = L && cueState(L);
  if (r) r.auto = null;
  for (const z of project.zones) z._lvl = null;
  refreshCues();
}
// Every frame on the main window: levels fading, cues going on by themselves
function cueTick() {
  for (const z of project.zones) {
    const f = z._lvl;
    if (!f) continue;
    // moved by hand (a slider, MIDI, a device) meanwhile: the hand wins
    if (Math.abs(z.opacity - f.set) > 1e-6) { z._lvl = null; continue; }
    const k = clamp((clockT - f.start) / f.dur, 0, 1);
    f.set = f.from + (f.to - f.from) * k;
    setZoneOpacity(z, f.set);
    if (k >= 1) z._lvl = null;
  }
  for (const L of project.cueLists) {
    const r = cueRun.get(L.id);
    if (r && r.auto && clockT >= r.auto.at) { const c = cueOf(L, r.auto.cue); r.auto = null; if (c) cueGo(L, c); }
  }
}
// What the panel shows of a list: the cue playing and how far (0..1), the one on standby, and a cue to come by itself
function cueProgress(L) {
  const r = cueState(L), c = cueOf(L, r.cur), len = c ? cueLength(c) : 0;
  return { cur: c, standby: cueOf(L, r.standby), k: c ? (len > 0 ? clamp((clockT - r.at) / len, 0, 1) : 1) : 0,
    auto: r.auto ? { cue: cueOf(L, r.auto.cue), left: Math.max(0, r.auto.at - clockT) } : null };
}
