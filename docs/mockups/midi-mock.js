// openLedMapper · docs/mockups/midi-mock.js
// The model behind the MIDI and OSC mockup, shared by its two windows: a sample project made of the real built-in
// shaders, the roles that link shader inputs to macros, the targets a control can drive, and the control engine
// (bindings, learn, soft takeover, feedback). As planned for the app, the engine runs in the main window; the
// mapping window shows it and sends it what the user does (connectEngine). Nothing here touches the app's code.
// Uses util.js (h, clamp, uid, pct) and builtins.js (BUILTINS).

/* ---------- shaders and roles ---------- */
const parseHeader = code => { const a = code.indexOf('/*'), b = code.indexOf('*/'); try { return JSON.parse(code.slice(a + 2, b)); } catch (e) { return {}; } };
// A third-party shader, with no OLM_ROLES in its header: its inputs get roles from their names, or by hand
const CUSTOM_SHADER = { id: 'tunnel', name: 'Tunnel', custom: true, code: '/*{"INPUTS":[{"NAME":"rate","TYPE":"float","LABEL":"Rate","MIN":0,"MAX":4,"DEFAULT":1},{"NAME":"tint","TYPE":"color","LABEL":"Tint","DEFAULT":[0.2,0.5,1,1]},{"NAME":"glow","TYPE":"color","LABEL":"Glow","DEFAULT":[1,0.4,0.1,1]}]}*/' };
const SHADERS = new Map([...BUILTINS, CUSTOM_SHADER].map(b => [b.id, { id: b.id, name: b.name, custom: !!b.custom, hdr: parseHeader(b.code) }]));
const inputsOf = id => (SHADERS.get(id).hdr.INPUTS || []).filter(i => i.TYPE === 'float' || i.TYPE === 'color');
// The name rules, for shaders without OLM_ROLES. The built-ins will list the same roles in their header; the inputs
// that feed an OLM_CLOCKS clock (rate, scroll, bpm) follow Speed too.
const ROLE_RULES = [
  ['speed', i => i.TYPE === 'float' && /^(speed|rate|scroll|bpm|tempo)$/i.test(i.NAME)],
  ['color1', i => i.TYPE === 'color' && /^(color|colorA|color1)$/i.test(i.NAME)],
  ['color2', i => i.TYPE === 'color' && /^(colorB|color2|background)$/i.test(i.NAME)],
  ['saturation', i => i.TYPE === 'float' && /^saturation$/i.test(i.NAME)],
];
// The role of a layer's input, and where it comes from: 'header' (OLM_ROLES), 'name' (the rules above) or 'hand'
// (the link toggle in the Content tab)
function roleOf(L, inp) {
  if (L.hand && L.hand[inp.NAME]) return { role: L.hand[inp.NAME], how: 'hand' };
  const r = ROLE_RULES.find(([, test]) => test(inp));
  if (!r) return null;
  return { role: r[0], how: SHADERS.get(L.src).custom ? 'name' : 'header' };
}
const HOW_LABEL = { header: 'header', name: 'name rule', hand: 'by hand', layer: 'every layer' };

/* ---------- the sample project ---------- */
// Three zones of the real built-ins and one shader of your own. Each scene keeps its own layers, and the layers
// playing now are a copy of one of them; a scene recalled later brings its own copies, which follow the macros too.
function sampleProject() {
  let n = 0;
  const L = (src, opacity = 1, more = {}) => Object.assign({ id: 'L' + (++n), src, opacity, unlink: [], hand: {} }, more);
  const Z = (id, name, tag, scenes) => ({ id, name, tag, opacity: 1, scene: 0, scenes, layers: scenes[0].layers.map(cloneLayer) });
  return [
    Z('z1', 'Façade', '#3cc8ff', [
      { name: 'Dusk', layers: [L('aurora'), L('waves', 0.55)] },
      { name: 'Night', layers: [L('stars'), L('clouds', 0.5)] },
      { name: 'Warm', layers: [L('breathe')] }]),
    Z('z2', 'Bar', '#ffb341', [
      { name: 'Groove', layers: [L('discodots'), L('hits', 0.7)] },
      { name: 'Chill', layers: [L('lava')] },
      // a strobe faster with Speed would be harsh: its rate is left out
      { name: 'Peak', layers: [L('strobe', 0.8, { unlink: ['rate'] }), L('scanner')] }]),
    Z('z3', 'Stage', '#b58cff', [
      { name: 'Open', layers: [L('bars'), L('rainbow', 0.45), L('tunnel', 0.8, { hand: { tint: 'color1' } })] },
      { name: 'Sweep', layers: [L('wipe'), L('sweep', 0.8)] },
      { name: 'Hit', layers: [L('strobe')] }]),
  ];
}
let layerCopies = 0;
const cloneLayer = L => Object.assign({}, L, { id: L.id + '.' + (++layerCopies), unlink: L.unlink.slice(), hand: Object.assign({}, L.hand) });

/* ---------- targets ---------- */
const hsvRgb = (h, s, v) => { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
const cssRgb = c => `rgb(${c.slice(0, 3).map(x => Math.round(clamp(x, 0, 1) * 255)).join(',')})`;
const COLOR_NAMES = { color1: 'Color 1', color2: 'Color 2' };
const fmtX = v => v.toFixed(2) + '×';
// Everything a control can drive, by id. kind: 'range' (a fader), 'toggle' (on and off) or 'trigger' (a press does it).
function targetInfo(eng, id) {
  const p = id.split(':'), z = p[0] === 'zone' && eng.zone(p[1]);
  if (id === 'macro:speed') return { kind: 'range', label: 'Speed', min: 0, max: 2, fmt: fmtX };
  if (id === 'macro:freeze') return { kind: 'toggle', label: 'Freeze' };
  if (id === 'macro:sat') return { kind: 'range', label: 'Saturation', min: 0, max: 1, fmt: pct };
  if (id === 'macro:intensity') return { kind: 'range', label: 'Intensity', min: 0, max: 1, fmt: pct };
  const c = /^macro:(color[12])\.(h|s|v|on)$/.exec(id);
  if (c) {
    const n = c[1].slice(-1);
    if (c[2] === 'on') return { kind: 'toggle', label: COLOR_NAMES[c[1]] + ' on' };
    if (c[2] === 'h') return { kind: 'range', label: 'Hue ' + n, min: 0, max: 360, fmt: v => Math.round(v) + '°' };
    return { kind: 'range', label: (c[2] === 's' ? 'Sat ' : 'Value ') + n, min: 0, max: 1, fmt: pct };
  }
  if (id === 'master') return { kind: 'range', label: 'Master', min: 0, max: 1, fmt: pct };
  if (id === 'blackout') return { kind: 'toggle', label: 'Blackout' };
  if (z && p[2] === 'opacity') return { kind: 'range', label: z.name + ' level', min: 0, max: 1, fmt: pct };
  if (z && p[2] === 'scene') { const sc = z.scenes[+p[3] - 1]; return { kind: 'trigger', label: z.name + ' · ' + (sc ? sc.name : 'scene ' + p[3]) }; }
  if (z && p[2] === 'layer') return { kind: 'range', label: `${z.name} · layer ${p[3]}`, min: 0, max: 1, fmt: pct };
  return { kind: 'range', label: id, min: 0, max: 1, fmt: v => String(v) };
}

/* ---------- controls ---------- */
// Keys: midi:<port>:<ch>:cc:<n>, midi:<port>:<ch>:note:<n>, osc:/path
function keyOf(m) { return m.src === 'osc' ? 'osc:' + m.path : `midi:${m.port}:${m.ch}:${m.type === 'cc' ? 'cc' : 'note'}:${m.num}`; }
function keyParts(key) {
  if (key.startsWith('osc:')) return { src: 'osc', path: key.slice(4) };
  // read from the end: port names can have colons in them
  const p = key.split(':'), num = +p.pop(), type = p.pop(), ch = +p.pop();
  return { src: 'midi', port: p.slice(1).join(':'), ch, type, num };
}
// As on the badges: "CC 21 · ch1", "Note 36 · ch1", "/olm/speed"
function keyLabel(key) { const k = keyParts(key); return k.src === 'osc' ? k.path : `${k.type === 'cc' ? 'CC' : 'Note'} ${k.num} · ch${k.ch}`; }
const keyPort = key => { const k = keyParts(key); return k.src === 'osc' ? 'OSC' : k.port; };
const isButtonKey = key => keyParts(key).type === 'note';

// Curves from the control (0–1) to the binding's range, and back for soft takeover
const CURVES = { linear: ['Linear', x => x, y => y], slow: ['Slow start', x => x * x, y => Math.sqrt(y)], fast: ['Fast start', x => 1 - (1 - x) * (1 - x), y => 1 - Math.sqrt(1 - y)],
  s: ['S curve', x => x * x * (3 - 2 * x), y => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (m * m * (3 - 2 * m) < y) lo = m; else hi = m; } return (lo + hi) / 2; }] };
const TAKEOVER = { pickup: 'Pickup', jump: 'Jump', scale: 'Scale' };
const BUTTON_MODES = { toggle: 'Toggle', flash: 'Flash', trigger: 'Trigger' };
const VIRTUAL = 'Virtual controller', SIMULATED = 'nanoKONTROL2';

/* ---------- the engine ---------- */
// Holds the macros, colours and bindings, takes MIDI and OSC messages in, moves the targets, and sends feedback.
// Controller moves make no undo steps. on(fn) gets: {t: 'state'} (coalesced), {t: 'msg', e} for the monitor,
// {t: 'led', port, dir}, {t: 'fb', key, c} for motor faders, {t: 'toast', text}.
class Engine {
  constructor() {
    this.zones = sampleProject();
    this.macros = { speed: 1, freeze: 0, sat: 1, intensity: 1 };
    this.colors = { color1: { on: 1, h: 200, s: 0.85, v: 1, slew: 0.3 }, color2: { on: 0, h: 320, s: 1, v: 0.7, slew: 0.3 } };
    this.master = 1; this.blackout = 0;
    this.learn = { on: false, target: null, pending: null, once: false };
    this.devices = {
      inputs: [{ name: VIRTUAL, on: true, virtual: true, state: 'connected' }, { name: SIMULATED, on: true, sim: true, state: 'disconnected' }],
      outputs: [{ name: VIRTUAL, on: true, virtual: true, state: 'connected' }, { name: SIMULATED, on: true, sim: true, state: 'disconnected' }],
      osc: { on: true, inPort: 9000, outOn: true, outHost: '192.168.1.20', outPort: 9001 },
      motor: false, webmidi: 'checking',
    };
    const V = (n, type = 'cc') => `midi:${VIRTUAL}:1:${type}:${n}`;
    this.bindings = [];
    for (const [key, target, more] of [[V(21), 'macro:speed'], [V(22), 'macro:color1.h'], [V(23), 'macro:color2.h'], [V(24), 'macro:intensity'],
      [V(28), 'master'], [V(36, 'note'), 'blackout', { mode: 'flash' }], [V(37, 'note'), 'zone:z2:scene:1'], [V(38, 'note'), 'zone:z2:scene:2'],
      [V(39, 'note'), 'zone:z2:scene:3'], ['osc:/olm/speed', 'macro:speed'], [`midi:${SIMULATED}:1:cc:0`, 'zone:z1:opacity']]) this.addBinding(key, target, more, true);
    this.subs = new Set(); this.t0 = performance.now(); this.timer = 0; this.sendMidi = null;
  }
  on(fn) { this.subs.add(fn); }
  emit(ev) { for (const f of this.subs) f(ev); }
  changed() { if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.emit({ t: 'state', s: this.snapshot() }); }, 30); }
  zone(id) { return this.zones.find(z => z.id === id); }

  /* --- target values */
  get(id) {
    const c = /^macro:(color[12])\.(h|s|v|on)$/.exec(id);
    if (c) return this.colors[c[1]][c[2]];
    if (id.startsWith('macro:')) return this.macros[id.slice(6)];
    if (id === 'master') return this.master;
    if (id === 'blackout') return this.blackout;
    const p = id.split(':'), z = this.zone(p[1]);
    if (!z) return 0;
    if (p[2] === 'opacity') return z.opacity;
    if (p[2] === 'scene') return z.scene === +p[3] - 1 ? 1 : 0;
    if (p[2] === 'layer') { const L = z.layers[+p[3] - 1]; return L ? L.opacity : 0; }
    return 0;
  }
  // from: the binding that moved it, or null (the mouse, a scene, the main window). Other controls on the same target
  // have to pick it up again; controls that take feedback are told where it is now.
  set(id, v, from = null) {
    const t = targetInfo(this, id);
    if (t.kind === 'range') v = clamp(+v, Math.min(t.min, t.max), Math.max(t.min, t.max));
    const c = /^macro:(color[12])\.(h|s|v|on)$/.exec(id), p = id.split(':'), z = p[0] === 'zone' && this.zone(p[1]);
    if (c) this.colors[c[1]][c[2]] = v;
    else if (id.startsWith('macro:')) this.macros[id.slice(6)] = v;
    else if (id === 'master') this.master = v;
    else if (id === 'blackout') this.blackout = v ? 1 : 0;
    else if (z && p[2] === 'opacity') z.opacity = v;
    else if (z && p[2] === 'scene') { if (v) this.recall(z, +p[3] - 1); return; }
    else if (z && p[2] === 'layer') { const L = z.layers[+p[3] - 1]; if (L) L.opacity = v; }
    for (const b of this.bindings) if (b.target === id) {
      const pos = this.toControl(b, this.get(id)), button = isButtonKey(b.key);
      if (b !== from && b.takeover === 'pickup' && !button) b._picked = b._last != null && Math.abs(b._last - pos) < 0.02;
      // a pad lights up from its own press too; a fader isn't told where it already is
      if (b.feedback && (b !== from || button)) this.feedback(b, pos);
    }
    this.changed();
  }
  // A scene replaces the zone's layers with copies of its own: the macros carry on, they were never written in
  recall(z, i) {
    if (!z.scenes[i]) return;
    z.scene = i; z.layers = z.scenes[i].layers.map(cloneLayer);
    for (const b of this.bindings) if (b.target.startsWith(`zone:${z.id}:scene:`) && b.feedback) this.feedback(b, this.get(b.target));
    this.changed();
  }
  toControl(b, v) { const n = b.max === b.min ? 0 : (v - b.min) / (b.max - b.min); return clamp(CURVES[b.curve][2](clamp(n, 0, 1)), 0, 1); }
  fromControl(b, c) { return b.min + (b.max - b.min) * CURVES[b.curve][1](clamp(c, 0, 1)); }
  feedback(b, c) {
    const k = keyParts(b.key);
    if (k.src === 'osc') { if (this.devices.osc.outOn) this.log({ dir: 'out', port: 'OSC', text: k.path, val: c.toFixed(2), key: b.key }, true); return; }
    const out = this.devices.outputs.find(o => o.name === k.port && o.on && o.state === 'connected');
    if (!out) return;
    const val = Math.round(c * 127);
    if (out.virtual) { if (this.devices.motor && !isButtonKey(b.key)) { b._last = c; b._picked = true; } this.emit({ t: 'fb', key: b.key, c }); }
    else if (this.sendMidi) this.sendMidi(k.port, k.type === 'cc' ? [0xB0 + k.ch - 1, k.num, val] : [(val ? 0x90 : 0x80) + k.ch - 1, k.num, val ? 127 : 0]);
    this.emit({ t: 'led', port: k.port, dir: 'out' });
  }

  /* --- messages in */
  // m: {src: 'midi', port, ch, type: 'cc' | 'on' | 'off', num, val 0–127} or {src: 'osc', path, val 0–1}
  input(m) {
    const key = keyOf(m), c = m.src === 'osc' ? clamp(+m.val, 0, 1) : m.val / 127;
    const dev = m.src === 'osc' ? { on: this.devices.osc.on } : this.devices.inputs.find(d => d.name === m.port);
    this.emit({ t: 'led', port: m.src === 'osc' ? 'OSC' : m.port, dir: 'in' });
    const text = m.src === 'osc' ? m.path : m.type === 'cc' ? `CC ${m.num} · ch${m.ch}` : `Note ${m.type === 'off' ? 'off' : 'on'} ${m.num} · ch${m.ch}`;
    const entry = { dir: 'in', port: m.src === 'osc' ? 'OSC' : m.port, text, val: m.src === 'osc' ? (+m.val).toFixed(2) : String(m.val), key };
    if (dev && !dev.on) return this.log(Object.assign(entry, { note: 'port off' }));
    if (this.learn.on || this.learn.target) {
      if (m.type === 'off') return this.log(entry);
      if (this.learn.target) { this.bind(key, this.learn.target); entry.note = 'learnt'; } else { this.learn.pending = key; entry.note = 'click a target'; this.changed(); }
      return this.log(entry);
    }
    const hit = this.bindings.filter(b => b.key === key);
    const press = m.src === 'osc' ? c >= 0.5 : m.type === 'cc' ? m.val >= 64 : m.type === 'on' && m.val > 0;
    for (const b of hit) this.apply(b, c, press, m.type === 'on' || m.type === 'off');
    entry.targets = hit.map(b => targetInfo(this, b.target).label);
    if (!hit.length) entry.note = 'not bound';
    this.log(entry);
  }
  apply(b, c, press, isNote) {
    const t = targetInfo(this, b.target);
    b._hit = performance.now();
    if (t.kind === 'trigger') { if (press && !b._down) this.set(b.target, 1, b); b._down = press; return; }
    if (t.kind === 'toggle' || isNote) {
      // a button: Flash is on while held; Toggle turns it over on each press
      const was = b._down, hi = t.kind === 'toggle' ? 1 : b.max, lo = t.kind === 'toggle' ? 0 : b.min;
      b._down = press;
      if (b.mode === 'flash') { if (press !== !!was) this.set(b.target, press ? hi : lo, b); }
      else if (press && !was) this.set(b.target, Math.abs(this.get(b.target) - hi) < 1e-6 ? lo : hi, b);
      return;
    }
    const pos = this.toControl(b, this.get(b.target));
    let to = c;
    if (b.takeover === 'pickup') {
      // picked up once the control reaches where the target is (or passes it)
      if (!b._picked) b._picked = Math.abs(c - pos) < 0.02 || (b._last != null && (b._last - pos) * (c - pos) <= 0);
      if (!b._picked) { b._wait = c < pos ? 'up' : 'down'; b._last = c; this.changed(); return; }
    } else if (b.takeover === 'scale' && b._last != null && Math.abs(c - pos) > 0.004) {
      // moves the target by the same share of the way that is left, so both reach the end together
      const d = c - b._last;
      to = clamp(pos + (d > 0 ? d * (1 - pos) / Math.max(1e-3, 1 - b._last) : d * pos / Math.max(1e-3, b._last)), 0, 1);
    }
    b._last = c; b._picked = true; b._wait = null;
    this.set(b.target, this.fromControl(b, to), b);
  }
  log(e, quiet = false) {
    e.time = ((performance.now() - this.t0) / 1000).toFixed(3);
    this.emit({ t: 'msg', e, quiet });
  }

  /* --- bindings and learn */
  addBinding(key, target, more = {}, silent = false) {
    if (this.bindings.some(b => b.key === key && b.target === target)) { if (!silent) this.emit({ t: 'toast', text: `${keyLabel(key)} already drives ${targetInfo(this, target).label}.` }); return null; }
    const t = targetInfo(this, target), button = isButtonKey(key);
    const b = Object.assign({ id: uid(), key, target, min: t.min ?? 0, max: t.max ?? 1, curve: 'linear', takeover: 'pickup', feedback: true,
      mode: t.kind === 'trigger' ? 'trigger' : button && t.kind === 'range' ? 'flash' : 'toggle', _picked: false, _last: null }, more);
    this.bindings.push(b);
    if (!silent) this.changed();
    return b;
  }
  bind(key, target) {
    const b = this.addBinding(key, target);
    if (b) this.emit({ t: 'toast', text: `${keyLabel(key)} → ${targetInfo(this, target).label}`, bound: { key, target } });
    this.learn.target = null; this.learn.pending = null;
    if (this.learn.once) { this.learn.once = false; this.learn.on = false; }
    this.changed();
  }
  // How long Color 1 or 2 takes to reach a new setting, in seconds
  setSlew(k, v) { if (this.colors[k]) this.colors[k].slew = clamp(+v, 0, 2); this.changed(); }
  setLearn(on) { this.learn = { on: !!on, target: null, pending: null, once: false }; this.changed(); }
  // A target clicked while learning: bind the control moved last, or wait for one. once: its own Learn button
  learnTarget(target, once = false) {
    if (this.learn.pending && !once) { this.bind(this.learn.pending, target); return; }
    if (this.learn.target === target) { this.learn.target = null; if (this.learn.once) this.learn.once = this.learn.on = false; }
    else { this.learn.target = target; if (once && !this.learn.on) { this.learn.on = true; this.learn.once = true; } }
    this.changed();
  }
  unbind(id) { this.bindings = this.bindings.filter(b => b.id !== id); this.changed(); }
  updateBinding(id, patch) {
    const b = this.bindings.find(x => x.id === id);
    if (!b) return;
    for (const k of ['min', 'max']) if (k in patch) patch[k] = +patch[k];
    Object.assign(b, patch); b._picked = false;
    this.changed();
  }

  /* --- devices */
  setPort(dir, name, on) { const d = this.devices[dir].find(x => x.name === name); if (d) d.on = !!on; this.changed(); }
  setOsc(patch) { Object.assign(this.devices.osc, patch); this.changed(); }
  setMotor(on) { this.devices.motor = !!on; if (on) for (const b of this.bindings) if (b.feedback) this.feedback(b, this.toControl(b, this.get(b.target))); this.changed(); }
  // The simulated controller comes and goes like a real one: its bindings stay, shown offline while it is away
  plugSimulated() {
    for (const dir of ['inputs', 'outputs']) { const d = this.devices[dir].find(x => x.sim); d.state = d.state === 'connected' ? 'disconnected' : 'connected'; }
    const now = this.devices.inputs.find(x => x.sim).state;
    this.emit({ t: 'toast', text: now === 'connected' ? `${SIMULATED} plugged in: its bindings work again.` : `${SIMULATED} unplugged: its bindings stay, shown offline.` });
    this.changed();
  }
  // Ports from Web MIDI, matched by name: hot-plug keeps their bindings
  setWebMidi(status, inputs = [], outputs = []) {
    this.devices.webmidi = status;
    const merge = (dir, ports) => {
      const keep = this.devices[dir].filter(d => d.virtual || d.sim || ports.some(p => p.name === d.name) || this.bindings.some(b => keyPort(b.key) === d.name));
      for (const d of keep) if (!d.virtual && !d.sim) d.state = ports.some(p => p.name === d.name && p.state === 'connected') ? 'connected' : 'disconnected';
      for (const p of ports) if (!keep.some(d => d.name === p.name)) keep.push({ name: p.name, on: true, state: p.state });
      this.devices[dir] = keep;
    };
    merge('inputs', inputs); merge('outputs', outputs);
    this.changed();
  }

  /* --- shader parameters each macro reaches */
  setExcluded(zoneId, layerId, input, out) {
    const z = this.zone(zoneId), L = z && [...z.layers, ...z.scenes.flatMap(s => s.layers)].find(x => x.id === layerId);
    if (!L) return;
    L.unlink = L.unlink.filter(n => n !== input);
    if (out) L.unlink.push(input);
    this.changed();
  }
  setHandRole(zoneId, layerId, input, role) {
    const z = this.zone(zoneId), L = z && [...z.layers, ...z.scenes.flatMap(s => s.layers)].find(x => x.id === layerId);
    if (!L) return;
    if (role) L.hand[input] = role; else delete L.hand[input];
    this.changed();
  }
  // Every shader input of every layer, now playing and in the scenes, with its role
  params() {
    const out = [];
    for (const z of this.zones) {
      const groups = [['now', 'Playing now', z.layers], ...z.scenes.map((s, i) => ['scene' + i, 'Scene ' + s.name, s.layers])];
      for (const [where, whereLabel, layers] of groups) layers.forEach((L, li) => {
        const base = { zone: z.id, zoneName: z.name, where, whereLabel, layer: L.id, layerN: li + 1, shader: SHADERS.get(L.src).name, custom: SHADERS.get(L.src).custom };
        for (const inp of inputsOf(L.src)) {
          const r = roleOf(L, inp);
          out.push(Object.assign({ input: inp.NAME, label: inp.LABEL || inp.NAME, type: inp.TYPE, role: r && r.role, how: r && r.how, excluded: L.unlink.includes(inp.NAME) }, base));
        }
        // Intensity reaches every layer: its level
        out.push(Object.assign({ input: '@intensity', label: 'Layer level', type: 'layer', role: 'intensity', how: 'layer', excluded: L.unlink.includes('@intensity') }, base));
      });
    }
    return out;
  }
  snapshot() {
    const params = this.params();
    const count = role => params.filter(p => p.role === role && !p.excluded).length;
    return {
      macros: Object.assign({}, this.macros), colors: JSON.parse(JSON.stringify(this.colors)), master: this.master, blackout: this.blackout,
      learn: Object.assign({}, this.learn), devices: JSON.parse(JSON.stringify(this.devices)),
      zones: this.zones.map(z => ({ id: z.id, name: z.name, tag: z.tag, opacity: z.opacity, scene: z.scene, scenes: z.scenes.map(s => s.name),
        layers: z.layers.map(L => ({ id: L.id, name: SHADERS.get(L.src).name, opacity: L.opacity })) })),
      bindings: this.bindings.map(b => Object.assign({}, b, { label: targetInfo(this, b.target).label, kind: targetInfo(this, b.target).kind,
        offline: (() => { const d = this.devices.inputs.find(x => x.name === keyPort(b.key)); return !!d && d.state !== 'connected'; })(),
        pos: this.toControl(b, this.get(b.target)), button: isButtonKey(b.key) })),
      params, affects: { speed: count('speed'), color1: count('color1'), color2: count('color2'), saturation: count('saturation'), intensity: count('intensity') },
    };
  }
}
// The calls the mapping window may make
const ENGINE_OPS = ['set', 'setSlew', 'setLearn', 'learnTarget', 'bind', 'unbind', 'updateBinding', 'input', 'setPort', 'setOsc', 'setMotor', 'plugSimulated', 'setExcluded', 'setHandRole'];

/* ---------- the two windows ---------- */
// In the main window: answer the mapping windows (a popup, or the floating one inside the page) and pass them the
// engine's news. In the app the same would go between two windows of one origin.
function serveEngine(eng) {
  const views = new Set();
  addEventListener('message', ev => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.olm === 'midi-hello') { views.add(ev.source); ev.source.postMessage({ olm: 'midi-ev', ev: { t: 'state', s: eng.snapshot() } }, '*'); }
    if (d.olm === 'midi-bye') views.delete(ev.source);
    if (d.olm === 'midi-op' && ENGINE_OPS.includes(d.name)) eng[d.name](...(d.args || []));
  });
  eng.on(ev => { for (const v of views) { try { v.postMessage({ olm: 'midi-ev', ev }, '*'); } catch (e) { views.delete(v); } } });
}
// In the mapping window: the engine of the window that opened it, or (opened on its own) one of its own
function connectEngine(onEvent) {
  const host = window.opener && !window.opener.closed ? window.opener : window.parent !== window ? window.parent : null;
  if (!host) {
    const eng = new Engine();
    eng.on(onEvent);
    setTimeout(() => onEvent({ t: 'state', s: eng.snapshot() }), 0);
    return { op: (name, ...a) => eng[name](...a), local: true, engine: eng };
  }
  addEventListener('message', ev => { if (ev.data && ev.data.olm === 'midi-ev') onEvent(ev.data.ev); });
  addEventListener('pagehide', () => host.postMessage({ olm: 'midi-bye' }, '*'));
  host.postMessage({ olm: 'midi-hello' }, '*');
  return { op: (name, ...a) => host.postMessage({ olm: 'midi-op', name, args: a }, '*'), local: false };
}

/* ---------- Web MIDI ---------- */
// Real MIDI ports, where the browser has Web MIDI: their messages go to the engine, feedback goes back out to the port
// of the same name. Ports that come and go (hot-plug) are picked up through onstatechange.
function startWebMidi(eng) {
  if (!navigator.requestMIDIAccess) { eng.setWebMidi('none'); return; }
  navigator.requestMIDIAccess({ sysex: false }).then(access => {
    const list = () => {
      const ins = [...access.inputs.values()], outs = [...access.outputs.values()];
      for (const p of ins) p.onmidimessage = e => {
        const [st, a, b] = e.data, type = st & 0xF0, ch = (st & 0x0F) + 1;
        if (type === 0xB0) eng.input({ src: 'midi', port: p.name, ch, type: 'cc', num: a, val: b });
        else if (type === 0x90 || type === 0x80) eng.input({ src: 'midi', port: p.name, ch, type: type === 0x90 && b > 0 ? 'on' : 'off', num: a, val: b });
      };
      eng.sendMidi = (name, bytes) => { const o = outs.find(x => x.name === name); if (o) try { o.send(bytes); } catch (e) { /* port gone */ } };
      eng.setWebMidi(ins.length || outs.length ? 'ok' : 'empty', ins.map(p => ({ name: p.name, state: p.state })), outs.map(p => ({ name: p.name, state: p.state })));
    };
    access.onstatechange = list;
    list();
  }, () => eng.setWebMidi('blocked'));
}
