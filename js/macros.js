// nouPix · js/macros.js
// Macros: a few controls that move the same kind of control in every effect at once. Speed (0 to 2×: the effects'
// clocks run slower or faster), Intensity (every layer's level), Saturation, Color 1 and Color 2 (a colour, set as
// hue, saturation and value), and the controls most built-in effects share (Angle, Softness, Scale, Count, Size,
// Width, Density, Fade): switched on, each sets that control of every effect to the same point of its own range.
// They apply as each layer is drawn (applyParams in sources.js, renderLook in render.js), over the layers' own values,
// which they never change: scenes keep working, and a macro switched off gives each effect its own value back. An
// effect's control follows a macro by its name, or as the user chose for that effect (project.macroLinks). The macros
// live in project.macros; like the master, they are live controls, not steps of undo. Uses util.

// kind: 'mult' multiplies (Speed, 1× in the middle), 'scale' scales (100 % leaves things as they are), 'color' sets a
// colour when on, 'abs' sets a control to the same point of its range when on
const MACROS = [
  { id: 'speed', label: 'Speed', kind: 'mult' },
  { id: 'intensity', label: 'Intensity', kind: 'scale' },
  { id: 'saturation', label: 'Saturation', kind: 'scale' },
  { id: 'color1', label: 'Color 1', kind: 'color' },
  { id: 'color2', label: 'Color 2', kind: 'color' },
  { id: 'angle', label: 'Angle', kind: 'abs' },
  { id: 'softness', label: 'Softness', kind: 'abs' },
  { id: 'scale', label: 'Scale', kind: 'abs' },
  { id: 'count', label: 'Count', kind: 'abs' },
  { id: 'size', label: 'Size', kind: 'abs' },
  { id: 'width', label: 'Width', kind: 'abs' },
  { id: 'density', label: 'Density', kind: 'abs' },
  { id: 'decay', label: 'Fade', kind: 'abs' },
];
const MACRO_BY_ID = Object.fromEntries(MACROS.map(d => [d.id, d]));
const macroDef = id => MACRO_BY_ID[id] || null;
const macroMax = d => (d.kind === 'mult' ? 2 : 1);
// The parts of a colour macro a slider or a MIDI control moves, in its mode
const MACRO_PARTS = { hsv: [['h', 'Hue'], ['s', 'Saturation'], ['v', 'Value']], rgb: [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] };

function defaultMacro(d) {
  if (d.kind === 'color') return { on: false, mode: 'hsv', h: d.id === 'color1' ? 200 : 320, s: 1, v: 1 };
  if (d.kind === 'abs') return { on: false, v: 0.5 };
  return { v: 1 };
}
const defaultMacros = () => Object.fromEntries(MACROS.map(d => [d.id, defaultMacro(d)]));
// The macros of a file, or of a change from a device: every macro there, with its values in range
function fixMacros(m) {
  const out = defaultMacros();
  if (!isObj(m)) return out;
  for (const d of MACROS) {
    const o = m[d.id], x = out[d.id];
    if (!isObj(o)) continue;
    if ('on' in x) x.on = !!o.on;
    if (d.kind === 'color') {
      x.mode = o.mode === 'rgb' ? 'rgb' : 'hsv';
      // 360° stays 360°: the same colour as 0°, but a hue fader at the top stays at the top
      const hue = numOr(o.h, x.h);
      x.h = hue >= 0 && hue <= 360 ? hue : wrap360(hue); x.s = clamp(numOr(o.s, x.s), 0, 1); x.v = clamp(numOr(o.v, x.v), 0, 1);
    } else x.v = clamp(numOr(o.v, x.v), 0, macroMax(d));
  }
  return out;
}

/* ---------- colours ---------- */
function macroHsvRgb(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
function macroRgbHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [wrap360(h * 60), mx ? d / mx : 0, mx];
}
const macroRgb = m => macroHsvRgb(m.h, m.s, m.v);
// Part i of a colour macro, from 0 to 1 (the hue too: 0 to 360° as 0 to 1)
function macroPart(m, i) {
  const k = MACRO_PARTS[m.mode][i][0];
  return k === 'h' ? m.h / 360 : 'sv'.includes(k) ? m[k] : macroRgb(m)['rgb'.indexOf(k)];
}
// The change that sets part i of a colour macro to x (0 to 1). Red, green and blue go through HSV; a grey keeps the
// hue it had, so turning the colour back up doesn't jump to red.
function macroPartPatch(m, i, x) {
  const k = MACRO_PARTS[m.mode][i][0];
  if (k === 'h') return { h: x * 360 };
  if ('sv'.includes(k)) return { [k]: x };
  const rgb = macroRgb(m);
  rgb['rgb'.indexOf(k)] = x;
  const [h, s, v] = macroRgbHsv(...rgb);
  return { h: s > 0 && v > 0 ? h : m.h, s, v };
}

/* ---------- what follows what ---------- */
// Which macro each control of an effect follows, by its name: colours by their usual names, Speed through the
// effect's clocks (its speed control, or the rate a clock runs at), the others by their own name
function macroRoles(rt) {
  const roles = {}, clockRates = new Set(Object.values(rt.clocks || {}).map(c => c.from));
  for (const inp of rt.hdr.INPUTS || []) {
    const n = String(inp.NAME).toLowerCase();
    let id = null;
    if (inp.TYPE === 'color') id = /^(color|colora|color1|tint)$/.test(n) ? 'color1' : /^(colorb|color2|background)$/.test(n) ? 'color2' : null;
    else if (inp.TYPE === 'float' || inp.TYPE === 'int') {
      if (inp === rt.speed || clockRates.has(inp)) id = 'speed';
      else if (MACRO_BY_ID[n] && ['scale', 'abs'].includes(MACRO_BY_ID[n].kind) && n !== 'intensity') id = n;
    }
    if (id) roles[inp.NAME] = id;
  }
  return roles;
}
// Which macros a control of an effect can follow: a colour, Color 1 or Color 2; its speed (or the rate a clock runs
// at), Speed; another number, Saturation or one of the shared controls
function macroChoices(rt, inp) {
  if (inp.TYPE === 'color') return ['color1', 'color2'];
  if (inp.TYPE !== 'float' && inp.TYPE !== 'int') return [];
  if (rt.roles && rt.roles[inp.NAME] === 'speed') return ['speed'];
  return MACROS.filter(d => d.kind === 'abs' || d.id === 'saturation').map(d => d.id);
}
// The macro each control of an effect follows: by its name (macroRoles), or as the user chose for that effect
// (project.macroLinks[source]: a macro's id, or '' for none). Worked out again when that choice is a new object.
function macroRolesOf(src, rt) {
  const o = project.macroLinks[src.id];
  if (rt.eff && rt.effFor === o) return rt.eff;
  const out = Object.assign({}, rt.roles);
  if (isObj(o)) for (const inp of rt.hdr.INPUTS || []) {
    const id = o[inp.NAME];
    if (id === '') delete out[inp.NAME];
    else if (typeof id === 'string' && macroChoices(rt, inp).includes(id)) out[inp.NAME] = id;
  }
  rt.eff = out; rt.effFor = o;
  return out;
}
// The links of a file: for each effect there, its controls' choices ('' for none, or a macro an effect can follow)
function fixMacroLinks(l, known) {
  const out = {}, ok = new Set(MACROS.filter(d => d.id !== 'intensity').map(d => d.id).concat(''));
  if (!isObj(l)) return out;
  for (const [src, o] of Object.entries(l)) {
    if (!known.has(src) || !isObj(o)) continue;
    const c = {};
    for (const [name, id] of Object.entries(o)) if (typeof id === 'string' && ok.has(id) && name.length < 100) c[name] = id;
    if (Object.keys(c).length) out[src] = c;
  }
  return out;
}
// The macros and MIDI onto effects' controls act on stored scenes only: a zone playing one of its scenes (also while
// it is edited) follows them; content put in a zone that plays none shows its own values, as the source is
const zoneFollows = z => !!(z && z.scene && z.scenes.some(sc => sc.id === z.scene));
// A layer that keeps its own value for one of an effect's controls instead of following its macro (a colour picked for
// that layer alone while its macro was on): L.own[source] lists them
const ownsCtl = (L, srcId, name) => !!(L && L.own && Array.isArray(L.own[srcId]) && L.own[srcId].includes(name));
function setOwnCtl(L, srcId, name, on) {
  const list = (L.own && Array.isArray(L.own[srcId]) ? L.own[srcId] : []).filter(n => n !== name);
  if (on) list.push(name);
  if (list.length) (L.own || (L.own = {}))[srcId] = list;
  else if (L.own) { delete L.own[srcId]; if (!Object.keys(L.own).length) delete L.own; }
}
// Each zone has its own macros (z.macros), which its content follows; All zones' (project.macros) are what the All
// zones sliders show, and moving one writes it into every zone (setMacro). The set of a zone, or All zones' for none.
const macrosOf = z => (z && z.macros) || project.macros;
// A scope's set: '' for All zones, or a zone's id
const macroScopeSet = S => (S ? macrosOf(zoneById(S)) : project.macros);
// Whether a macro changes anything now: a colour or a shared control when on, the others away from their neutral value
function macroActive(id, M = project && project.macros) {
  const d = macroDef(id), m = M && M[id];
  if (!d || !m) return false;
  return d.kind === 'color' || d.kind === 'abs' ? !!m.on : m.v !== 1;
}
// A control's value with its macro on it (not Speed, which works through the clocks)
function macroOver(id, inp, v, M = project.macros) {
  const d = macroDef(id), m = M[id];
  if (!d || !m) return v;
  if (d.kind === 'color') return m.on ? macroRgb(m).concat(Array.isArray(v) && v.length > 3 ? v[3] : 1) : v;
  if (d.kind === 'scale') return typeof v === 'number' ? v * m.v : v;
  if (d.kind === 'abs' && m.on) {
    const lo = inp.MIN ?? 0, hi = inp.MAX ?? 1, x = lo + (hi - lo) * m.v;
    return inp.TYPE === 'int' ? Math.round(x) : x;
  }
  return v;
}
// How a macro reads, for the panels: 1.25×, 80 %, a colour's hue, saturation and value
function macroText(id, M = project.macros) {
  const d = macroDef(id), m = M[id];
  if (d.kind === 'mult') return m.v.toFixed(2) + '×';
  if (d.kind === 'color') return `${Math.round(m.h)}° · ${pct(m.s)} · ${pct(m.v)}`;
  return pct(m.v);
}
