// nouPix · js/midi.js
// MIDI in: the faders, knobs, buttons and pads of MIDI controllers drive the master, blackout, the crossfader, the zones' levels,
// their scenes and their playlists, the macros, and the controls of the effects. The mappings are part of the project
// (project.midi.maps, see newMidiMap); whether MIDI is on and which ports are switched off belong to this computer
// (ui.midiOn, ui.midiOff). Learn: move a control, then touch what it should move, or the other way round. Only the
// main window listens: a device on the network (REMOTE_CLIENT) doesn't.

/* ---------- state ---------- */
// status: 'off' (not asked for), 'asking', 'none' (no Web MIDI in this browser), 'blocked' (refused), 'ok'
const midi = {
  status: 'off', access: null,
  ports: [],               // the inputs there are now: { name, state }
  controls: new Map(),     // every control moved: key -> { last: 0–1, t, range: whether it sent a value between the ends }
  learn: { on: false, target: null, pending: null },
  log: [],                 // the monitor: the latest messages first
  learnt: null,            // the control learnt last
  t0: performance.now(),
};
function midiKeyParts(key) { const m = MIDI_KEY.exec(key); return m ? { port: m[1], ch: +m[2], type: m[3], num: +m[4] } : null; }
const midiKeyLabel = key => { const k = midiKeyParts(key); return k ? `${k.type === 'cc' ? 'CC' : 'Note'} ${k.num}` : '?'; };
const midiKeyFull = key => { const k = midiKeyParts(key); return k ? `${midiKeyLabel(key)} · ch${k.ch}` : '?'; };
// The virtual controller (on screen, in the MIDI window) is a port too, there while it is shown
const MIDI_VIRTUAL = 'Virtual controller';
const midiPortLive = name => (name === MIDI_VIRTUAL ? !!(ui.midiOn && ui.midiVc) : midi.ports.some(p => p.name === name && p.state !== 'disconnected'));
const midiPortOn = name => !(ui.midiOff || []).includes(name);

/* ---------- targets ---------- */
// What a mapping drives, from its target: a fader (0 to 1), a toggle (on or off) or a trigger (a press does it).
// Null when it is gone: a zone, scene or playlist deleted. m:<macro> is a macro (m:color1.0 to .2: the parts of a
// colour, as its mode has them); p:<source>:<control> a control of an effect.
function midiTarget(t) {
  if (t.startsWith('p:')) return effectTarget(t);
  if (t.startsWith('m:')) {
    const [id, i] = t.slice(2).split('.'), d = macroDef(id);
    if (!d || (d.kind === 'color') !== (i != null)) return null;
    if (i == null) return { kind: 'fader', label: d.label, get: () => project.macros[id].v / macroMax(d), set: x => setMacro(id, { v: x * macroMax(d) }) };
    const part = MACRO_PARTS[project.macros[id].mode][+i];
    return part ? { kind: 'fader', label: `${d.label} · ${part[1]}`, get: () => macroPart(project.macros[id], +i), set: x => setMacroPart(id, +i, x) } : null;
  }
  if (t === 'master') return { kind: 'fader', label: 'Master', get: () => project.settings.master, set: midiSetMaster };
  if (t === 'blackout') return { kind: 'toggle', label: 'Blackout', get: () => (ui.blackout ? 1 : 0), set: v => { if (!!v !== ui.blackout) toggleBlackout(); } };
  // there whether the crossfader is on or off: a fader mapped to it stays mapped
  if (t === 'xf') return { kind: 'fader', label: 'X-Fader', get: () => project.xfade.x, set: v => { setXfade(v); remoteChanged(); commitSoft(); } };
  if (t.startsWith('gr:')) {   // a group's dimmer
    const g = groupById(t.slice(3));
    return g ? { kind: 'fader', label: groupName(g) + ' dimmer', get: () => groupLevel(g), set: v => { setGroupLevel(g, v); remoteChanged(); commitSoft(); } } : null;
  }
  const [k, zid, id] = t.split(':'), z = zid ? zoneById(zid) : null;
  if (!z) return null;
  // while the crossfader drives the zone, a control mapped to its level does nothing
  if (k === 'z') return { kind: 'fader', label: z.name + ' level' + (xfDriven(z) ? ' (on the X-Fader)' : ''), get: () => z.opacity,
    set: v => { if (xfDriven(z)) return; setZoneOpacity(z, v); remoteChanged(); commitSoft(); } };
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
// p:<source>:<control>: one control of an effect, in every layer that plays it now; a scene played afterwards brings
// its own value (a fader on Pickup then waits until it gets there). A number is a fader (a speed from still to full,
// its direction kept; a list steps through its choices), a tick is on or off, an event plays on a press. Colours and
// points are driven through the macros.
function effectTarget(t) {
  const i = t.indexOf(':', 2), src = i > 2 ? srcById(t.slice(2, i)) : null, name = t.slice(i + 1);
  const inp = src && src.kind === 'isf' && controlsOf(src).find(x => x.NAME === name);
  if (!inp) return null;
  const label = `${src.name} · ${inp.LABEL || inp.NAME}`, layers = () => project.zones.flatMap(z => z.layers.filter(L => L.src === src.id));
  const now = () => paramValue(layers()[0] || { params: {} }, src, inp);
  const put = v => setEffectControl(src, inp.NAME, v);
  if (inp.TYPE === 'bool') return { kind: 'toggle', label, get: () => (now() ? 1 : 0), set: v => put(!!v) };
  if (inp.TYPE === 'event') {   // a moment on, as its Trigger button does: not a change to keep
    const fire = v => { for (const L of layers()) setParam(L, src, inp.NAME, v); };
    return { kind: 'trigger', label, get: () => 0, set: () => { fire(true); setTimeout(() => fire(false), 80); } };
  }
  if (inp.TYPE === 'long') {
    const vals = inp.VALUES || [], n = vals.length - 1;
    return n > 0 ? { kind: 'fader', label, get: () => Math.max(0, vals.indexOf(now())) / n, set: x => put(vals[Math.round(x * n)]) } : null;
  }
  if (inp.TYPE !== 'float' && inp.TYPE !== 'int') return null;
  if (isSpeedInput(src, inp)) {
    const M = speedMax(inp);
    return { kind: 'fader', label, get: () => Math.min(1, Math.abs(now()) / M), set: x => put((now() < 0 ? -1 : 1) * x * M) };
  }
  const lo = inp.MIN ?? 0, hi = inp.MAX ?? 1;
  return { kind: 'fader', label, get: () => (hi > lo ? clamp((now() - lo) / (hi - lo), 0, 1) : 0),
    set: x => { const v = lo + x * (hi - lo); put(inp.TYPE === 'int' ? Math.round(v) : v); } };
}
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
  if (m.type !== 'off') {
    const was = midi.controls.get(key);
    midi.controls.set(key, { last: m.type === 'on' ? 1 : c, t: performance.now(), range: !!(was && was.range) || (m.type === 'cc' && m.val > 0 && m.val < 127) });
  }
  if (midi.learn.on) {
    // A note off or a CC at 0 (a button let go, a fader at its bottom) never starts learning. The control learnt last
    // is done: its release or the rest of its move doesn't start it again, so the next click waits for a new control.
    // It goes to something clicked first, though.
    const start = m.type !== 'off' && !(m.type === 'cc' && m.val === 0);
    if (start && midi.learn.target) { midiConnect(key, midi.learn.target); entry.note = 'learnt'; }
    else if (start && midi.learnt !== key) { midi.learn.pending = key; entry.note = 'learning: choose what it should move'; }
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
  w._last = c; w._picked = true;
  T.set(c);
  w._set = T.get();   // where it went: a list or whole numbers go in steps
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
// the MIDI window, from a mapping's list). A fader or knob learnt onto something that is on or off follows it (Hold:
// on while it is past the middle); a button toggles it.
function midiConnect(key, to) {
  midi.learn.pending = null; midi.learn.target = null;
  midi.learnt = key;
  if (project.midi.maps.some(w => w.key === key && w.to === to)) { toast(`${midiKeyLabel(key)} already does that.`); updateMidiUI(); return; }
  const old = project.midi.maps.filter(w => w.to === to), w = midiNewMap(key, to);
  project.midi.maps = project.midi.maps.filter(x => x.to !== to);
  project.midi.maps.push(w);
  commit();
  toast(`${midiKeyFull(key)} → ${midiTargetLabel(to)}` + (old.length ? ` (instead of ${[...new Set(old.map(w => midiKeyLabel(w.key)))].join(', ')})` : ''));
  updateMidiUI();
}
// A new mapping: a control that moved like a fader, onto something on or off, follows it (Hold)
function midiNewMap(key, to) {
  const w = newMidiMap(key, to), T = midiTarget(to), c = midi.controls.get(key);
  if (T && T.kind === 'toggle' && c && c.range) w.mode = 'hold';
  return w;
}
// A mapping made by hand (a wire drawn in the patch bay): another control on the same thing stays
function midiAddMap(key, to) {
  if (!midiTarget(to)) return;
  if (project.midi.maps.some(w => w.key === key && w.to === to)) { toast(`${midiKeyLabel(key)} already does that.`); return; }
  project.midi.maps.push(midiNewMap(key, to));
  commit();
  toast(`${midiKeyFull(key)} → ${midiTargetLabel(to)}`);
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
// A control not wanted any more: its mappings go, and it is forgotten until it moves again
function midiForget(key) {
  project.midi.maps = project.midi.maps.filter(w => w.key !== key);
  project.midi.order = project.midi.order.filter(k => k !== key);
  midi.controls.delete(key);
  if (midi.learn.pending === key) midi.learn.pending = null;
  commit(); updateMidiUI();
}
// The controls in order: as the user put them, then the others by port, type, channel and number
function midiKeyOrder(keys) {
  const at = new Map(project.midi.order.map((k, i) => [k, i])), parts = k => { const p = midiKeyParts(k); return [p.port, p.type, p.ch, p.num]; };
  return [...new Set(keys)].filter(k => midiKeyParts(k)).sort((a, b) => {
    const x = at.has(a) ? at.get(a) : Infinity, y = at.has(b) ? at.get(b) : Infinity;
    if (x !== y) return x - y;
    const p = parts(a), q = parts(b);
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
    return 0;
  });
}
// The controls put in this order (dragged in the patch bay); the mappings in the list follow it
function midiSetOrder(keys) {
  project.midi.order = [...new Set(keys)];
  const at = new Map(project.midi.order.map((k, i) => [k, i]));
  project.midi.maps = project.midi.maps.slice().sort((a, b) => (at.get(a.key) ?? 1e9) - (at.get(b.key) ?? 1e9));
  commit(); updateMidiUI();
}
