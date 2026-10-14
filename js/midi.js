// openLedMapper · js/midi.js
// MIDI in: the faders, knobs, buttons and pads of MIDI controllers drive the master, blackout, the zones' levels,
// their scenes and their playlists. The mappings are part of the project (project.midi.maps, see newMidiMap); whether
// MIDI is on and which ports are switched off belong to this computer (ui.midiOn, ui.midiOff). Learn: move a control,
// then touch what it should move, or the other way round. Only the main window listens: a device on the network
// (REMOTE_CLIENT) doesn't.

/* ---------- state ---------- */
// status: 'off' (not asked for), 'asking', 'none' (no Web MIDI in this browser), 'blocked' (refused), 'ok'
const midi = {
  status: 'off', access: null,
  ports: [],               // the inputs there are now: { name, state }
  controls: new Map(),     // every control moved: key -> { last: 0–1, t }
  learn: { on: false, target: null, pending: null },
  log: [],                 // the monitor: the latest messages first
  learnt: null,            // the control learnt last
  t0: performance.now(),
};
function midiKeyParts(key) { const m = MIDI_KEY.exec(key); return m ? { port: m[1], ch: +m[2], type: m[3], num: +m[4] } : null; }
const midiKeyLabel = key => { const k = midiKeyParts(key); return k ? `${k.type === 'cc' ? 'CC' : 'Note'} ${k.num}` : '?'; };
const midiKeyFull = key => { const k = midiKeyParts(key); return k ? `${midiKeyLabel(key)} · ch${k.ch}` : '?'; };
const midiPortLive = name => midi.ports.some(p => p.name === name && p.state !== 'disconnected');
const midiPortOn = name => !(ui.midiOff || []).includes(name);

/* ---------- targets ---------- */
// What a mapping drives, from its target: a fader (0 to 1), a toggle (on or off) or a trigger (a press does it).
// Null when it is gone: a zone, scene or playlist deleted.
function midiTarget(t) {
  if (t === 'master') return { kind: 'fader', label: 'Master', get: () => project.settings.master, set: midiSetMaster };
  if (t === 'blackout') return { kind: 'toggle', label: 'Blackout', get: () => (ui.blackout ? 1 : 0), set: v => { if (!!v !== ui.blackout) toggleBlackout(); } };
  const [k, zid, id] = t.split(':'), z = zid ? zoneById(zid) : null;
  if (!z) return null;
  if (k === 'z') return { kind: 'fader', label: z.name + ' level', get: () => z.opacity, set: v => { setZoneOpacity(z, v); remoteChanged(); commitSoft(); } };
  if (k === 'sc') {
    const sc = z.scenes.find(s => s.id === id);
    return sc ? { kind: 'trigger', label: `${z.name} · ${sc.name}`, get: () => (z.scene === sc.id ? 1 : 0), set: () => goScene(z, sc) } : null;
  }
  if (k === 'nx') return { kind: 'trigger', label: z.name + ' · next scene', get: () => 0, set: () => midiNextScene(z) };
  if (k === 'pl') {
    const pl = z.playlists.find(p => String(p.id) === id);
    return pl ? { kind: 'toggle', label: `${z.name} · ${pl.name}`, get: () => (playingList(z) === pl && z._play.on ? 1 : 0), set: v => { if (pl.steps.length) playlistDo(z, pl, v ? 'start' : 'pause'); } } : null;
  }
  return null;
}
const midiTargetLabel = t => { const T = midiTarget(t); return T ? T.label : 'Missing'; };
function midiSetMaster(v) {
  project.settings.master = v;
  $('#master').value = v; $('#masterVal').textContent = pct(v);
  saveSoon(); remoteLiveChanged();
}
// The scene after the one playing, back to the first after the last
function midiNextScene(z) {
  if (!z.scenes.length) return;
  const i = z.scenes.findIndex(s => s.id === z.scene);
  goScene(z, z.scenes[(i + 1) % z.scenes.length]);
}

/* ---------- MIDI in ---------- */
// Web MIDI: asked for once MIDI is on (the browser may ask the user). Ports that come and go are found again by name.
function startMidi() {
  if (REMOTE_CLIENT || midi.status === 'asking' || midi.status === 'ok') return;
  if (!navigator.requestMIDIAccess) { midi.status = 'none'; updateMidiUI(); return; }
  midi.status = 'asking'; updateMidiUI();
  let asked;
  try { asked = navigator.requestMIDIAccess({ sysex: false }); } catch (e) { asked = Promise.reject(e); }
  asked.then(access => {
    if (!ui.midiOn) return;   // switched off while the browser asked
    midi.access = access; midi.status = 'ok';
    const list = () => {
      const ins = [...access.inputs.values()];
      for (const p of ins) p.onmidimessage = e => midiMessage(p.name, e.data);
      midi.ports = ins.map(p => ({ name: p.name, state: p.state }));
      updateMidiUI();
    };
    access.onstatechange = list;
    list();
  }, e => { midi.status = 'blocked'; midi.error = (e && e.message) || ''; updateMidiUI(); });
}
function stopMidi() {
  if (midi.access) { for (const p of midi.access.inputs.values()) p.onmidimessage = null; midi.access.onstatechange = null; }
  midi.access = null; midi.status = 'off'; midi.ports = [];
  midiSetLearn(false);
}
function setMidiOn(on) {
  ui.midiOn = !!on; savePrefs();
  if (on) startMidi(); else stopMidi();
  updateMidiUI();
}
// Control change, note on and note off; everything else (clock, sysex…) is left alone
function midiMessage(port, data) {
  const st = data[0], type = st & 0xF0, ch = (st & 0x0F) + 1;
  if (type === 0xB0) midiIn({ port, ch, type: 'cc', num: data[1], val: data[2] });
  else if (type === 0x90 || type === 0x80) midiIn({ port, ch, type: type === 0x90 && data[2] > 0 ? 'on' : 'off', num: data[1], val: data[2] });
}
// The mappings of a control: the ones made on its port; if there are none, the ones made on a port that isn't plugged
// in now (the same controller under another name, on another computer)
function midiMapsFor(key) {
  const maps = project.midi.maps, mine = maps.filter(w => w.key === key);
  if (mine.length) return mine;
  const k = midiKeyParts(key);
  return maps.filter(w => { const o = midiKeyParts(w.key); return o && o.ch === k.ch && o.type === k.type && o.num === k.num && !midiPortLive(o.port); });
}
// m: { port, ch, type: 'cc' | 'on' | 'off', num, val 0–127 }
function midiIn(m) {
  if (REMOTE_CLIENT || !project) return;
  const key = `midi:${m.port}:${m.ch}:${m.type === 'cc' ? 'cc' : 'note'}:${m.num}`, c = clamp(m.val / 127, 0, 1);
  const entry = { time: (performance.now() - midi.t0) / 1000, port: m.port, key, val: m.val, to: [], note: '',
    text: m.type === 'cc' ? `CC ${m.num} · ch${m.ch}` : `Note ${m.type === 'off' ? 'off' : 'on'} ${m.num} · ch${m.ch}` };
  if (!midiPortOn(m.port)) { entry.note = 'port off'; midiLog(entry); return; }
  if (m.type !== 'off') midi.controls.set(key, { last: m.type === 'on' ? 1 : c, t: performance.now() });
  if (midi.learn.on) {
    // A note off or a CC at 0 (a button let go, a fader at its bottom) never starts learning. The control learnt last
    // is done: its release or the rest of its move doesn't start it again, so the next click waits for a new control.
    // It goes to something clicked first, though.
    const start = m.type !== 'off' && !(m.type === 'cc' && m.val === 0);
    if (start && midi.learn.target) { midiConnect(key, midi.learn.target); entry.note = 'learnt'; }
    else if (start && midi.learnt !== key) { midi.learn.pending = key; entry.note = 'learning: click what it should move'; }
    else if (midi.learnt === key) entry.note = 'just learnt';
  } else {
    const ws = midiMapsFor(key);
    for (const w of ws) midiApply(w, c, m.type);
    entry.to = ws.map(w => midiTargetLabel(w.to));
    if (!ws.length) entry.note = 'not mapped';
  }
  midiLog(entry);
}
function midiLog(e) {
  midi.log.unshift(e);
  if (midi.log.length > 80) midi.log.length = 80;
  updateMidiUI(e);
}
// One message on one mapping. A button (a note, or a control mapped to something that is on or off) plays a trigger
// on a press; turns a toggle over on each press, or with Hold keeps it on while held; sends a fader from one end to
// the other. A fader or knob on a fader: with Pickup, nothing happens until it reaches the value (or passes it);
// with Jump, the value goes where it is at once.
function midiApply(w, c, type) {
  const T = midiTarget(w.to);
  if (!T) return;
  w._hit = performance.now();
  if (T.kind !== 'fader' || type !== 'cc') {
    const press = type === 'cc' ? c >= 0.5 : type === 'on', was = !!w._down;
    w._down = press;
    if (T.kind === 'trigger') { if (press && !was) T.set(1); }
    else if (T.kind === 'toggle' && w.mode === 'hold') { if (press !== was) T.set(press ? 1 : 0); }
    else if (press && !was) T.set(T.get() > 0.5 ? 0 : 1);
    return;
  }
  const p = T.get();
  if (w.takeover === 'pickup') {
    // moved by something else since (the mouse, a phone, another control): it has to be picked up again
    if (w._picked && Math.abs(p - w._set) > 0.01) w._picked = false;
    if (!w._picked) {
      w._picked = Math.abs(c - p) < 0.02 || (w._last != null && (w._last - p) * (c - p) <= 0);
      if (!w._picked) { w._last = c; return; }
    }
  }
  w._last = c; w._picked = true; w._set = c;
  T.set(c);
}
// Whether a fader mapped to t has picked it up: a slider shows the fader's line faint until it has
function midiPicked(w) {
  const T = midiTarget(w.to);
  return w.takeover === 'jump' || !T || (!!w._picked && Math.abs(T.get() - w._set) <= 0.01);
}

/* ---------- learn and mappings ---------- */
function midiSetLearn(on) {
  midi.learn = { on: !!on && !REMOTE_CLIENT, target: null, pending: null };
  midi.learnt = null;
  updateMidiUI();
}
// Something touched while learning: the control moved last goes to it, or it waits for a control
function midiLearnTarget(t) {
  if (!midi.learn.on) return;
  if (midi.learn.pending) midiConnect(midi.learn.pending, t);
  else { midi.learn.target = midi.learn.target === t ? null : t; updateMidiUI(); }
}
// Learning a control onto something another control drives replaces that control (two on the same thing are set in
// the MIDI window, from a mapping's list)
function midiConnect(key, to) {
  midi.learn.pending = null; midi.learn.target = null;
  midi.learnt = key;
  if (project.midi.maps.some(w => w.key === key && w.to === to)) { toast(`${midiKeyLabel(key)} already does that.`); updateMidiUI(); return; }
  const old = project.midi.maps.filter(w => w.to === to);
  project.midi.maps = project.midi.maps.filter(w => w.to !== to);
  project.midi.maps.push(newMidiMap(key, to));
  commit();
  toast(`${midiKeyFull(key)} → ${midiTargetLabel(to)}` + (old.length ? ` (instead of ${[...new Set(old.map(w => midiKeyLabel(w.key)))].join(', ')})` : ''));
  updateMidiUI();
}
function midiSetMap(id, patch) {
  const w = project.midi.maps.find(x => x.id === id);
  if (!w) return;
  Object.assign(w, patch);
  w._picked = false;
  commit(); updateMidiUI();
}
function midiDisconnect(id) {
  project.midi.maps = project.midi.maps.filter(w => w.id !== id);
  commit(); updateMidiUI();
}
