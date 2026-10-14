// openLedMapper · docs/mockups/midi-mock.js
// The model behind the MIDI mapping mockup, shared by its two windows. A sample project made of the real built-in
// effects; the macros, worked out from the controls the effects have in common; and the control engine: which MIDI
// control drives what (wires), learn, and pickup. As planned for the app, the engine runs in the main window and the
// mapping window shows it (connectEngine). Nothing here touches the app's code.
// Uses util.js (h, clamp, uid, pct) and builtins.js (BUILTINS).

/* ---------- effects ---------- */
const parseHeader = code => { const a = code.indexOf('/*'), b = code.indexOf('*/'); try { return JSON.parse(code.slice(a + 2, b)); } catch (e) { return {}; } };
// An effect of your own, with no roles in its header: its inputs are linked by their names
const CUSTOM_SHADER = { id: 'tunnel', name: 'Tunnel', custom: true, code: '/*{"INPUTS":[{"NAME":"rate","TYPE":"float","LABEL":"Rate","MIN":0,"MAX":4,"DEFAULT":1},{"NAME":"tint","TYPE":"color","LABEL":"Tint","DEFAULT":[0.2,0.5,1,1]},{"NAME":"glow","TYPE":"color","LABEL":"Glow","DEFAULT":[1,0.4,0.1,1]}]}*/' };
const SHADERS = new Map([...BUILTINS, CUSTOM_SHADER].map(b => [b.id, { id: b.id, name: b.name, custom: !!b.custom, hdr: parseHeader(b.code) }]));
// An effect's controls, without the ones a clock fills (OLM_CLOCKS), as in the app
const inputsOf = id => { const hd = SHADERS.get(id).hdr, clocks = hd.OLM_CLOCKS || {}; return (hd.INPUTS || []).filter(i => (i.TYPE === 'float' || i.TYPE === 'color') && !(i.NAME in clocks)); };

/* ---------- macros ---------- */
// Which macro an effect's control follows: colour and speed by their usual names, the others by their own name.
// Built-in effects will say it in their header (OLM_ROLES); effects of your own get these rules.
function roleOf(inp) {
  if (inp.TYPE === 'color') return /^(color|colorA|color1|tint)$/i.test(inp.NAME) ? 'color1' : /^(colorB|color2|background)$/i.test(inp.NAME) ? 'color2' : null;
  if (/^(speed|rate|scroll|bpm|tempo)$/i.test(inp.NAME)) return 'speed';
  return MACRO_IDS.has(inp.NAME.toLowerCase()) ? inp.NAME.toLowerCase() : null;
}
// The macros: the controls at least four built-in effects share (positions and pixel spacings left out), with
// Intensity for every layer's level. kind: 'mult' multiplies (Speed 0–2×), 'scale' scales (0–100 %), 'abs' sets
// each effect's control to the same point of its own range, 'color' sets a colour (HSV or RGB).
const MACROS = (() => {
  const count = new Map(), skip = /^(centerX|centerY|cells|cell)$/;
  for (const b of BUILTINS) {
    const hd = parseHeader(b.code), seen = new Set();
    for (const inp of hd.INPUTS || []) {
      if ((hd.OLM_CLOCKS || {})[inp.NAME] || skip.test(inp.NAME) || (inp.TYPE !== 'float' && inp.TYPE !== 'color')) continue;
      const n = inp.TYPE === 'color' ? (/^(color|colorA)$/i.test(inp.NAME) ? 'color1' : /^(colorB|background)$/i.test(inp.NAME) ? 'color2' : null)
        : /^(speed|rate|scroll|bpm)$/i.test(inp.NAME) ? 'speed' : inp.NAME.toLowerCase();
      if (n && !seen.has(n)) { seen.add(n); count.set(n, (count.get(n) || 0) + 1); }
    }
  }
  const LABEL = { speed: 'Speed', color1: 'Color 1', color2: 'Color 2', saturation: 'Saturation', decay: 'Fade' };
  const KIND = { speed: 'mult', saturation: 'scale', color1: 'color', color2: 'color' };
  const ORDER = ['speed', 'color1', 'color2', 'saturation'];
  const ids = [...count].filter(([, n]) => n >= 4).map(([id]) => id).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || count.get(b) - count.get(a));
  const list = ids.map(id => ({ id, label: LABEL[id] || id[0].toUpperCase() + id.slice(1), kind: KIND[id] || 'abs', shared: count.get(id) }));
  list.splice(4, 0, { id: 'intensity', label: 'Intensity', kind: 'scale', shared: 0 });
  return list;
})();
const MACRO_IDS = new Set(MACROS.map(m => m.id));
const macroDef = id => MACROS.find(m => m.id === id);
const COMPONENTS = { hsv: [['h', 'Hue'], ['s', 'Sat'], ['v', 'Value']], rgb: [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] };

/* ---------- the sample project ---------- */
// Three zones of the real built-ins and one effect of your own. A scene recalled brings its own layers; macros and
// direct links apply to them as the frame is drawn, so nothing has to be done again.
function sampleProject() {
  let n = 0;
  const L = (src, opacity = 1) => ({ id: 'L' + (++n), src, opacity, params: {} });
  // a playlist plays some of the zone's scenes in turn: [scene, seconds]
  const Z = (id, name, tag, scenes, playlist) => ({ id, name, tag, opacity: 1, scene: 0, scenes, layers: scenes[0].layers.map(cloneLayer), playlists: [playlist], play: null });
  return [
    Z('z1', 'Façade', '#3cc8ff', [{ name: 'Dusk', layers: [L('aurora'), L('waves', 0.55)] }, { name: 'Night', layers: [L('stars'), L('clouds', 0.5)] }, { name: 'Warm', layers: [L('breathe')] }],
      { name: 'Evening', steps: [[0, 8], [2, 6], [1, 8]] }),
    Z('z2', 'Bar', '#ffb341', [{ name: 'Groove', layers: [L('discodots'), L('hits', 0.7)] }, { name: 'Chill', layers: [L('lava')] }, { name: 'Peak', layers: [L('strobe', 0.8), L('scanner')] }],
      { name: 'Party', steps: [[0, 6], [2, 3], [0, 6], [1, 5]] }),
    Z('z3', 'Stage', '#b58cff', [{ name: 'Open', layers: [L('bars'), L('rainbow', 0.45), L('tunnel', 0.8)] }, { name: 'Sweep', layers: [L('wipe'), L('sweep', 0.8)] }, { name: 'Hit', layers: [L('strobe')] }],
      { name: 'Show', steps: [[0, 5], [1, 5], [2, 2]] }),
  ];
}
let layerCopies = 0;
const cloneLayer = L => Object.assign({}, L, { id: L.id + '.' + (++layerCopies), params: Object.assign({}, L.params) });

/* ---------- colours, keys ---------- */
const hsvRgb = (h, s, v) => { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
function rgbHsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0; if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(hh * 60 + 360) % 360, mx ? d / mx : 0, mx]; }
const cssRgb = c => `rgb(${c.slice(0, 3).map(x => Math.round(clamp(x, 0, 1) * 255)).join(',')})`;
const fmtX = v => v.toFixed(2) + '×';
// Keys: midi:<port>:<ch>:cc:<n>, midi:<port>:<ch>:note:<n>. Read from the end: port names can have colons in them.
function keyParts(key) { const p = key.split(':'), num = +p.pop(), type = p.pop(), ch = +p.pop(); return { port: p.slice(1).join(':'), ch, type, num }; }
const keyLabel = key => { const k = keyParts(key); return `${k.type === 'cc' ? 'CC' : 'Note'} ${k.num} · ch${k.ch}`; };
const VIRTUAL = 'Virtual controller';

/* ---------- targets ---------- */
// What a wire from a control can drive: m:<macro> (m:color1.0 to .2: its components), p:<effect>:<control> (an
// effect's control, wherever it plays; p:<effect>:@level is its layers' level), master, blackout, z:<zone> (a level),
// sc:<zone>:<n> (play its scene n), nx:<zone> (its next scene), pl:<zone>:<n> (play or stop its playlist n).
// A target is a fader (min, max), a toggle (on and off) or a trigger (a press does it).
function targetInfo(eng, t) {
  if (t === 'master') return { label: 'Master', min: 0, max: 1, fmt: pct };
  if (t === 'blackout') return { label: 'Blackout', toggle: true };
  const zp = t.split(':'), z = ['z', 'sc', 'nx', 'pl'].includes(zp[0]) && eng.zone(zp[1]), zn = z ? z.name : '';
  if (zp[0] === 'z') return { label: zn + ' level', min: 0, max: 1, fmt: pct };
  if (zp[0] === 'sc') { const sc = z && z.scenes[+zp[2] - 1]; return { label: `${zn} · ${sc ? sc.name : 'scene ' + zp[2]}`, trigger: true }; }
  if (zp[0] === 'nx') return { label: zn + ' · next scene', trigger: true };
  if (zp[0] === 'pl') { const pl = z && z.playlists[+zp[2] - 1]; return { label: `${zn} · ${pl ? pl.name : 'playlist'}`, toggle: true }; }
  if (t.startsWith('m:')) {
    const [id, c] = t.slice(2).split('.'), m = macroDef(id);
    if (m.kind === 'color') {
      const [k, name] = COMPONENTS[eng.macros[id].mode][+c];
      return k === 'h' ? { label: `${m.label} · ${name}`, min: 0, max: 360, fmt: v => Math.round(v) + '°' } : { label: `${m.label} · ${name}`, min: 0, max: 1, fmt: pct };
    }
    return m.kind === 'mult' ? { label: m.label, min: 0, max: 2, fmt: fmtX } : { label: m.label, min: 0, max: 1, fmt: pct };
  }
  const [, src, name] = t.split(':'), sh = SHADERS.get(src);
  if (name === '@level') return { label: `${sh.name} · Level`, min: 0, max: 1, fmt: pct };
  const inp = inputsOf(src).find(i => i.NAME === name) || {};
  const mn = inp.MIN ?? 0, mx = inp.MAX ?? 1;
  return { label: `${sh.name} · ${inp.LABEL || name}`, min: mn, max: mx, fmt: v => (Math.abs(mx - mn) >= 10 ? String(Math.round(v)) : v.toFixed(2)) };
}

/* ---------- the engine ---------- */
// on(fn) gets {t: 'state'} (coalesced), {t: 'msg', e} for the monitor, {t: 'led', port}, {t: 'toast', text, wire}.
class Engine {
  constructor() {
    this.zones = sampleProject();
    this.macros = {};
    for (const m of MACROS) this.macros[m.id] = m.kind === 'color' ? { on: m.id === 'color1', mode: 'hsv', h: m.id === 'color1' ? 200 : 320, s: 0.85, v: 1 }
      : { v: m.kind === 'mult' || m.kind === 'scale' ? 1 : 0.5, on: m.kind !== 'abs' };
    this.direct = {};         // p:… → value set by a control or by hand, over the effect's own value
    this.master = 1; this.blackout = 0;
    this.wires = [];          // from a control: {id, key, to, takeover: pickup | jump, mode: toggle | hold}
    this.cut = new Set();     // macro links taken away: 'speed|p:strobe:rate'
    this.added = new Set();   // macro links drawn by hand
    this.controls = new Map();   // every control moved, in the order of the list: key → {key, last 0–1, t}
    this.learn = { on: false, target: null, pending: null };
    this.devices = { inputs: [{ name: VIRTUAL, on: true, virtual: true, state: 'connected' }], webmidi: 'checking' };
    const V = (n, type = 'cc') => `midi:${VIRTUAL}:1:${type}:${n}`;
    for (const [key, to] of [[V(21), 'm:speed'], [V(22), 'm:color1.0'], [V(23), 'p:bars:width'], [V(28), 'master'], [V(36, 'note'), 'blackout'],
      [V(37, 'note'), 'sc:z2:1'], [V(38, 'note'), 'sc:z2:3'], [V(39, 'note'), 'pl:z1:1']]) this.connect(key, to, true);
    this.cut.add('speed|p:strobe:rate');   // a strobe faster with Speed would be harsh
    this.subs = new Set(); this.t0 = performance.now(); this.timer = 0;
  }
  on(fn) { this.subs.add(fn); }
  emit(ev) { for (const f of this.subs) f(ev); }
  changed() { if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.emit({ t: 'state', s: this.snapshot() }); }, 30); }
  zone(id) { return this.zones.find(z => z.id === id); }

  /* --- effects and their links to the macros */
  // The effects of the project (playing now or in a scene), in the order they first appear
  effects() { const out = []; for (const z of this.zones) for (const ls of [z.layers, ...z.scenes.map(s => s.layers)]) for (const L of ls) if (!out.includes(L.src)) out.push(L.src); return out; }
  params(src) { return [...inputsOf(src).map(i => ({ key: `p:${src}:${i.NAME}`, name: i.NAME, label: i.LABEL || i.NAME, type: i.TYPE, role: roleOf(i), def: i.DEFAULT, min: i.MIN ?? 0, max: i.MAX ?? 1 })),
    { key: `p:${src}:@level`, name: '@level', label: 'Level', type: 'level', role: 'intensity', def: 1, min: 0, max: 1 }]; }
  // The macros a control of an effect follows: by its role, unless cut; and the ones drawn by hand
  macrosOf(p) { return MACROS.filter(m => (p.role === m.id && !this.cut.has(m.id + '|' + p.key)) || this.added.has(m.id + '|' + p.key)).map(m => m.id); }
  linkMacro(m, pk, on) {
    const src = pk.split(':')[1], p = this.params(src).find(x => x.key === pk), id = m + '|' + pk;
    if (on) { if (p && p.role === m) this.cut.delete(id); else this.added.add(id); }
    else { this.added.delete(id); if (p && p.role === m) this.cut.add(id); }
    this.changed();
  }
  // An effect control's value as the frame uses it: its own (or a layer's), then a direct link, then its macros
  value(p, own) {
    let v = this.direct[p.key] ?? own ?? p.def;
    for (const id of this.macrosOf(p)) {
      const m = this.macros[id], d = macroDef(id);
      if (d.kind === 'color') { if (m.on && p.type === 'color') v = hsvRgb(m.h, m.s, m.v); }
      else if (d.kind === 'mult' || d.kind === 'scale') { if (m.on && typeof v === 'number') v *= m.v; }
      else if (m.on && typeof v === 'number') v = p.min + (p.max - p.min) * m.v;
    }
    return v;
  }

  /* --- target values */
  get(t) {
    if (t === 'master') return this.master;
    if (t === 'blackout') return this.blackout;
    const zp = t.split(':'), z = ['z', 'sc', 'nx', 'pl'].includes(zp[0]) && this.zone(zp[1]);
    if (zp[0] === 'z') return z ? z.opacity : 0;
    if (zp[0] === 'sc') return z && z.scene === +zp[2] - 1 && !z.play ? 1 : 0;
    if (zp[0] === 'nx') return 0;
    if (zp[0] === 'pl') return z && z.play && z.play.pl === +zp[2] - 1 ? 1 : 0;
    if (t.startsWith('m:')) {
      const [id, c] = t.slice(2).split('.'), m = this.macros[id];
      if (c == null) return m.v;
      const k = COMPONENTS[m.mode][+c][0];
      return 'hsv'.includes(k) ? m[k] : hsvRgb(m.h, m.s, m.v)['rgb'.indexOf(k)];
    }
    const src = t.split(':')[1], p = this.params(src).find(x => x.key === t);
    return this.direct[t] ?? (p ? p.def : 0);
  }
  // from: the wire that moved it, or null (the mouse). Other wires to the same target have to pick it up again.
  set(t, v, from = null) {
    const info = targetInfo(this, t);
    if (!info.toggle && !info.trigger) v = clamp(+v, info.min, info.max);
    const zp = t.split(':'), z = ['z', 'sc', 'nx', 'pl'].includes(zp[0]) && this.zone(zp[1]);
    if (t === 'master') this.master = v;
    else if (t === 'blackout') this.blackout = v ? 1 : 0;
    else if (zp[0] === 'z') { if (z) z.opacity = v; }
    // a scene played by hand stops the zone's playlist
    else if (zp[0] === 'sc') { if (z && v) { z.play = null; this.recall(z.id, +zp[2] - 1); } }
    else if (zp[0] === 'nx') { if (z && v) { z.play = null; this.recall(z.id, (z.scene + 1) % z.scenes.length); } }
    else if (zp[0] === 'pl') { if (z) this.playPlaylist(z, v ? +zp[2] - 1 : null); }
    else if (t.startsWith('m:')) {
      const [id, c] = t.slice(2).split('.'), m = this.macros[id];
      if (c == null) m.v = v;
      else {
        const k = COMPONENTS[m.mode][+c][0];
        if ('hsv'.includes(k)) m[k] = v;
        else { const rgb = hsvRgb(m.h, m.s, m.v); rgb['rgb'.indexOf(k)] = v; [m.h, m.s, m.v] = rgbHsv(...rgb); }
      }
    } else this.direct[t] = v;
    for (const w of this.wires) if (w.to === t && w !== from && w.takeover === 'pickup') w._picked = w._last != null && Math.abs(w._last - this.pos(w)) < 0.02;
    this.changed();
  }
  // Where a target is, from 0 to 1: where its fader has to be to pick it up
  pos(w) { const i = targetInfo(this, w.to); return i.toggle || i.trigger ? this.get(w.to) : (this.get(w.to) - i.min) / (i.max - i.min); }
  // A playlist plays its steps in turn, in a loop; null stops it
  playPlaylist(z, i) {
    const pl = i == null ? null : z.playlists[i];
    z.play = pl ? { pl: i, step: 0, t: 0 } : null;
    if (pl) this.recall(z.id, pl.steps[0][0]);
    this.changed();
  }
  tick(dt) {
    for (const z of this.zones) {
      if (!z.play) continue;
      const pl = z.playlists[z.play.pl];
      z.play.t += dt;
      if (z.play.t >= pl.steps[z.play.step][1]) { z.play.step = (z.play.step + 1) % pl.steps.length; z.play.t = 0; this.recall(z.id, pl.steps[z.play.step][0]); }
    }
  }
  setMacroOn(id, on) { this.macros[id].on = on ? 1 : 0; this.changed(); }
  setMode(id, mode) { this.macros[id].mode = mode; this.changed(); }
  setOwn(zoneId, layerId, name, v) { const z = this.zone(zoneId), L = z && z.layers.find(x => x.id === layerId); if (L) L.params[name] = +v; this.changed(); }
  recall(zoneId, i) { const z = this.zone(zoneId); if (!z || !z.scenes[i]) return; z.scene = i; z.layers = z.scenes[i].layers.map(cloneLayer); this.changed(); }

  /* --- MIDI in */
  // m: {port, ch, type: 'cc' | 'on' | 'off', num, val 0–127}
  input(m) {
    const dev = this.devices.inputs.find(d => d.name === m.port), key = `midi:${m.port}:${m.ch}:${m.type === 'cc' ? 'cc' : 'note'}:${m.num}`, c = m.val / 127;
    this.emit({ t: 'led', port: m.port });
    const text = m.type === 'cc' ? `CC ${m.num} · ch${m.ch}` : `Note ${m.type === 'off' ? 'off' : 'on'} ${m.num} · ch${m.ch}`;
    const entry = { port: m.port, text, val: String(m.val), key };
    if (dev && !dev.on) return this.log(Object.assign(entry, { note: 'port off' }));
    if (m.type !== 'off') { const known = this.controls.has(key); this.controls.set(key, { key, last: m.type === 'on' ? 1 : c, t: performance.now() }); if (!known) this.changed(); }
    if (this.learn.on) {
      if (m.type === 'off') return this.log(entry);
      if (this.learn.target) { this.connect(key, this.learn.target); entry.note = 'learnt'; } else { this.learn.pending = key; entry.note = 'now touch what it should move'; this.changed(); }
      return this.log(entry);
    }
    const hit = this.wires.filter(w => w.key === key);
    for (const w of hit) this.apply(w, c, m.type);
    entry.targets = hit.map(w => targetInfo(this, w.to).label);
    if (!hit.length) entry.note = 'no wire';
    this.log(entry);
    this.changed();
  }
  apply(w, c, type) {
    const info = targetInfo(this, w.to);
    w._hit = performance.now();
    // a button (a note, or a control on a toggle or a trigger). A trigger goes on a press; a toggle turns over on
    // each press, or with Hold is on while held; a fader goes from one end to the other
    if (info.toggle || info.trigger || type !== 'cc') {
      const press = type === 'cc' ? c >= 0.5 : type === 'on', was = !!w._down;
      w._down = press;
      if (info.trigger) { if (press && !was) this.set(w.to, 1, w); }
      else if (info.toggle && w.mode === 'hold') { if (press !== was) this.set(w.to, press ? 1 : 0, w); }
      else if (press && !was) this.set(w.to, info.toggle ? (this.get(w.to) ? 0 : 1) : (this.pos(w) > 0.5 ? info.min : info.max), w);
      return;
    }
    const p = this.pos(w);
    // Pickup: nothing happens until the fader reaches the value (or passes it). Jump: it goes there at once.
    if (w.takeover === 'pickup' && !w._picked) {
      w._picked = Math.abs(c - p) < 0.02 || (w._last != null && (w._last - p) * (c - p) <= 0);
      if (!w._picked) { w._last = c; return; }
    }
    w._last = c; w._picked = true;
    this.set(w.to, info.min + (info.max - info.min) * c, w);
  }
  log(e) { e.time = ((performance.now() - this.t0) / 1000).toFixed(2); this.emit({ t: 'msg', e }); }

  /* --- wires and learn */
  connect(key, to, silent = false) {
    if (this.wires.some(w => w.key === key && w.to === to)) { if (!silent) this.emit({ t: 'toast', text: 'That wire is there already.' }); }
    else {
      const w = { id: uid(), key, to, takeover: this.wires.find(x => x.to === to)?.takeover || 'pickup', mode: 'toggle', _picked: false, _last: null };
      this.wires.push(w);
      if (to.startsWith('m:')) { const id = to.slice(2).split('.')[0]; if (macroDef(id).kind !== 'mult' && macroDef(id).kind !== 'scale') this.macros[id].on = 1; }
      // where a control is shows once it moves; the faders on screen are known from the start
      const kp = keyParts(key);
      if (!this.controls.has(key)) this.controls.set(key, { key, last: kp.port === VIRTUAL && kp.type === 'cc' ? 0 : null, t: 0 });
      if (!silent) this.emit({ t: 'toast', text: `${keyLabel(key)} → ${targetInfo(this, to).label}`, wire: w.id });
    }
    this.learn.target = null; this.learn.pending = null;
    this.changed();
  }
  disconnect(id) { this.wires = this.wires.filter(w => w.id !== id); this.changed(); }
  // A wire's own settings: takeover (pickup, jump) for a fader, mode (toggle, hold) for a button
  setWire(id, patch) { const w = this.wires.find(x => x.id === id); if (!w) return; Object.assign(w, patch); w._picked = false; this.changed(); }
  forget(key) { this.wires = this.wires.filter(w => w.key !== key); this.controls.delete(key); this.changed(); }
  // The order of the controls in the list: key goes just before the control `before` (null: at the end)
  moveControl(key, before) {
    const c = this.controls.get(key);
    if (!c || key === before) return;
    const rest = [...this.controls].filter(([k]) => k !== key), i = before == null ? -1 : rest.findIndex(([k]) => k === before);
    rest.splice(i < 0 ? rest.length : i, 0, [key, c]);
    this.controls = new Map(rest);
    this.changed();
  }
  setLearn(on) { this.learn = { on: !!on, target: null, pending: null }; this.changed(); }
  // Something touched in the app while learning: wire the control moved last to it, or wait for one
  learnTarget(t) {
    if (!this.learn.on) return;
    if (this.learn.pending) this.connect(this.learn.pending, t);
    else { this.learn.target = this.learn.target === t ? null : t; this.changed(); }
  }

  /* --- devices */
  setPort(name, on) { const d = this.devices.inputs.find(x => x.name === name); if (d) d.on = !!on; this.changed(); }
  setWebMidi(status, ports = []) {
    this.devices.webmidi = status;
    const keep = this.devices.inputs.filter(d => d.virtual || ports.some(p => p.name === d.name) || this.wires.some(w => keyParts(w.key).port === d.name));
    for (const d of keep) if (!d.virtual) d.state = ports.some(p => p.name === d.name && p.state === 'connected') ? 'connected' : 'disconnected';
    for (const p of ports) if (!keep.some(d => d.name === p.name)) keep.push({ name: p.name, on: true, state: p.state });
    this.devices.inputs = keep;
    this.changed();
  }
  snapshot() {
    const effects = this.effects().map(src => ({ src, name: SHADERS.get(src).name,
      where: this.zones.filter(z => [z.layers, ...z.scenes.map(s => s.layers)].some(ls => ls.some(L => L.src === src))).map(z => z.name),
      params: this.params(src).map(p => Object.assign({}, p, { macros: this.macrosOf(p), value: this.get(p.key), direct: p.key in this.direct })) }));
    return {
      macros: JSON.parse(JSON.stringify(this.macros)), master: this.master, blackout: this.blackout, learn: Object.assign({}, this.learn),
      devices: JSON.parse(JSON.stringify(this.devices)), effects,
      zones: this.zones.map(z => ({ id: z.id, name: z.name, tag: z.tag, opacity: z.opacity, scene: z.scene, scenes: z.scenes.map(s => ({ name: s.name })),
        playlists: z.playlists.map(p => ({ name: p.name, steps: p.steps.length })), play: z.play && Object.assign({}, z.play) })),
      controls: [...this.controls.values()].map(c => Object.assign({}, c, { offline: (this.devices.inputs.find(d => d.name === keyParts(c.key).port) || {}).state === 'disconnected' })),
      wires: this.wires.map(w => { const i = targetInfo(this, w.to); return Object.assign({}, w, { label: i.label, kind: i.trigger ? 'trigger' : i.toggle ? 'toggle' : 'fader', pos: this.pos(w) }); }),
    };
  }
}
// The calls the mapping window may make
const ENGINE_OPS = ['set', 'setMacroOn', 'setMode', 'connect', 'disconnect', 'setWire', 'forget', 'setLearn', 'learnTarget', 'linkMacro', 'input', 'setPort', 'moveControl', 'recall'];

/* ---------- the two windows ---------- */
// In the main window: answer the mapping window (a popup, or the floating one in the page) and pass it the news
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
// Real ports, where the browser has Web MIDI. Ports that come and go are found again by name (onstatechange).
function startWebMidi(eng) {
  if (!navigator.requestMIDIAccess) { eng.setWebMidi('none'); return; }
  navigator.requestMIDIAccess({ sysex: false }).then(access => {
    const list = () => {
      const ins = [...access.inputs.values()];
      for (const p of ins) p.onmidimessage = e => {
        const [st, a, b] = e.data, type = st & 0xF0, ch = (st & 0x0F) + 1;
        if (type === 0xB0) eng.input({ port: p.name, ch, type: 'cc', num: a, val: b });
        else if (type === 0x90 || type === 0x80) eng.input({ port: p.name, ch, type: type === 0x90 && b > 0 ? 'on' : 'off', num: a, val: b });
      };
      eng.setWebMidi(ins.length ? 'ok' : 'empty', ins.map(p => ({ name: p.name, state: p.state })));
    };
    access.onstatechange = list;
    list();
  }, () => eng.setWebMidi('blocked'));
}

/* ---------- a slider a control drives ---------- */
// A thin yellow line shows where the MIDI fader is (faint until the slider picks it up: with pickup, the slider moves
// once the fader reaches it), and a tag names the control (shown while the mapping window is open). The slider
// keeps its colour. mark(s) brings both up to date from the engine's state s.
function mappedSlider(input, target) {
  const line = h('i', { class: 'fline', hidden: true }), tag = h('span', { class: 'ftag', hidden: true });
  const el = h('span', { class: 'mslider' }, input, line, tag);
  el.mark = s => {
    const ws = s.wires.filter(w => w.to === target), c = ws.length && s.controls.find(x => x.key === ws[0].key);
    el.classList.toggle('mapped', !!ws.length);
    tag.hidden = !ws.length;
    tag.textContent = ws.length ? keyLabel(ws[0].key).split(' · ')[0] + (ws.length > 1 ? ' +' + (ws.length - 1) : '') : '';
    el.title = ws.length ? `Driven by ${ws.map(w => keyLabel(w.key)).join(', ')}. The yellow line is where the fader is${ws[0].takeover === 'pickup' ? ': the slider follows once the fader reaches it' : ''}.` : '';
    const on = !!(c && c.last != null);
    line.hidden = !on;
    if (on) { line.style.left = `calc(8px + ${c.last} * (100% - 16px))`; line.classList.toggle('away', !ws[0]._picked && ws[0].takeover === 'pickup'); }
  };
  return el;
}
// The same tag, for a button a control plays (a scene, a playlist, Blackout)
function midiTag(target) {
  const tag = h('span', { class: 'ftag', hidden: true });
  tag.mark = s => {
    const ws = s.wires.filter(w => w.to === target);
    tag.hidden = !ws.length;
    tag.textContent = ws.length ? keyLabel(ws[0].key).split(' · ')[0] + (ws.length > 1 ? ' +' + (ws.length - 1) : '') : '';
  };
  return tag;
}
