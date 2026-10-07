// openLedMapper · js/ui-color.js
// The colour picker for the colour controls of shaders: a swatch in the panel opens a picker with a colour wheel and
// intensity, RGB and HSV sliders, colour temperature for whites, a hex box, lighting presets and recent colours.

/* ---------- colour math (0–1, hue in degrees) ---------- */
function hsvToRgb(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
// A white of a colour temperature in kelvin, as LED fixtures mix it: Tanner Helland's fit of the black-body curve
function kelvinToRgb(k) {
  const t = clamp(k, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map(x => clamp(x, 0, 255) / 255);
}
const toHex = c => '#' + c.slice(0, 3).map(x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
function fromHex(s) {
  let m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) { const t = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s.trim()); if (t) m = [0, t[1] + t[1] + t[2] + t[2] + t[3] + t[3]]; }
  return m ? [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16) / 255) : null;
}

/* ---------- presets and recent colours ---------- */
// Saturated colours as lighting people name them (gel and console names), and the usual whites
const LIGHT_COLORS = [['Red', '#FF0000'], ['Orange', '#FF6000'], ['Amber', '#FFB000'], ['Yellow', '#FFFF00'], ['Lime', '#A0FF00'], ['Green', '#00FF00'], ['Mint', '#00FF90'],
  ['Cyan', '#00FFFF'], ['Sky blue', '#0090FF'], ['Blue', '#0000FF'], ['Congo blue', '#4000FF'], ['Lavender', '#A060FF'], ['Magenta', '#FF00FF'], ['Pink', '#FF3C82'], ['White', '#FFFFFF'], ['Off', '#000000']];
const WHITE_KELVIN = [2700, 3200, 4300, 5600, 6500];
const RECENT_MAX = 8;
const recentColors = () => { const r = store.get('openledmapper.colors', []); return Array.isArray(r) ? r.filter(x => fromHex(String(x))).slice(0, RECENT_MAX) : []; };
function rememberColor(hex) { store.set('openledmapper.colors', [hex, ...recentColors().filter(x => x !== hex)].slice(0, RECENT_MAX)); }

/* ---------- the swatch in the panel ---------- */
// get() gives the colour [r, g, b, a], set(c) changes it live, done() makes it one undo step; key names the control,
// so the picker can find its swatch again when the panel is drawn anew
function colorRow(label, get, set, done, key) {
  const fill = h('i'), hex = h('span', { class: 'mono' });
  const b = h('button', { class: 'cswatch', type: 'button', 'data-cp': key, 'aria-label': label + ': choose a colour', 'aria-haspopup': 'dialog' }, fill, hex);
  const show = c => { fill.style.background = toHex(c); hex.textContent = toHex(c); };
  show(get());
  b._show = show;
  b.addEventListener('click', () => (colorPop && colorPop.key === key ? closeColorPicker() : openColorPicker(b, { label, get, set, done, key })));
  return row(label, b);
}

/* ---------- the picker ---------- */
let colorPop = null;
function closeColorPicker() {
  if (!colorPop) return;
  colorPop.close();
  colorPop = null;
}
const COLOR_MODES = [['wheel', 'Wheel'], ['rgb', 'RGB'], ['hsv', 'HSV'], ['white', 'White']];
const WHEEL = 168;
let wheelImage = null;   // the colour wheel at full intensity, drawn once
function drawWheelImage(px) {
  const img = new ImageData(px, px), R = px / 2;
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const dx = x + 0.5 - R, dy = y + 0.5 - R, d = Math.hypot(dx, dy) / R, i = 4 * (y * px + x);
    if (d > 1.01) continue;
    const [r, g, b] = hsvToRgb((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, Math.min(1, d), 1);
    img.data.set([r * 255, g * 255, b * 255, d > 1 ? (1.01 - d) * 25500 : 255], i);
  }
  return img;
}

function openColorPicker(anchor, o) {
  closeColorPicker();
  const before = o.get().slice(), alpha = before[3] ?? 1;
  let rgb = before.slice(0, 3), hsv = rgbToHsv(...rgb), kelvin = 5600;
  if (!COLOR_MODES.some(([m]) => m === ui.colorMode)) ui.colorMode = 'wheel';

  // A change from anywhere: keep both RGB and HSV (hue stays put on greys and black), show it, send it to the layer
  const apply = () => {
    o.set([...rgb, alpha]);
    const sw = anchor.isConnected ? anchor : document.querySelector(`.cswatch[data-cp="${CSS.escape(o.key)}"]`);
    if (sw && sw._show) sw._show(rgb);
    refresh();
  };
  const fromRGB = c => { rgb = c.map(x => clamp(x, 0, 1)); const n = rgbToHsv(...rgb); hsv = [n[1] ? n[0] : hsv[0], n[2] ? n[1] : hsv[1], n[2]]; apply(); };
  const fromHSV = c => { hsv = [((c[0] % 360) + 360) % 360, clamp(c[1], 0, 1), clamp(c[2], 0, 1)]; rgb = hsvToRgb(...hsv); apply(); };
  const done = () => { o.done(); rememberColor(toHex(rgb)); showRecent(); };

  // a slider with its range painted in, and a number box; scale turns 0–1 into what is shown (0–255, %, °, K)
  const gslider = (label, min, max, step, get, put, track, unit = '') => {
    const r = h('input', { type: 'range', class: 'grad', min, max, step, 'aria-label': label });
    const n = h('input', { type: 'number', min, max, step, 'aria-label': label });
    r.addEventListener('input', () => put(parseFloat(r.value)));
    r.addEventListener('change', done);
    n.addEventListener('change', () => { const v = parseFloat(n.value); if (isFinite(v)) { put(clamp(v, min, max)); done(); } });
    const el = h('div', { class: 'cpslider' }, h('span', { class: 'cpl' }, label), r, h('label', { class: 'cpn' }, n, unit ? h('span', null, unit) : null));
    el._sync = () => { const v = get(); if (document.activeElement !== r) r.value = v; if (document.activeElement !== n) n.value = step >= 1 ? Math.round(v) : Math.round(v * 10) / 10; r.style.background = track(); };
    return el;
  };
  const css = c => `rgb(${c.map(x => Math.round(x * 255)).join(',')})`;
  const grad = (n, f) => 'linear-gradient(to right,' + Array.from({ length: n }, (_, i) => css(f(i / (n - 1)))).join(',') + ')';

  // ---- the parts
  const was = h('button', { class: 'cpwas', type: 'button', title: 'Before: click to go back to it', 'aria-label': 'Back to the colour before', onclick: () => { fromRGB(before.slice(0, 3)); done(); } });
  const now = h('div', { class: 'cpnow' });
  const hexIn = h('input', { type: 'text', class: 'mono', 'aria-label': 'Hex colour', spellcheck: false, maxlength: 7 });
  hexIn.addEventListener('change', () => { const c = fromHex(hexIn.value); if (c) { fromRGB(c); done(); } else hexIn.value = toHex(rgb); });

  const dpr = Math.min(2, window.devicePixelRatio || 1), px = Math.round(WHEEL * dpr);
  const wheel = h('canvas', { class: 'cpwheel', width: px, height: px, 'aria-label': 'Colour wheel: hue around, saturation from the middle out' });
  wheel.style.width = wheel.style.height = WHEEL + 'px';
  const pickWheel = e => {
    const r = wheel.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    fromHSV([(Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, Math.min(1, Math.hypot(dx, dy) / (r.width / 2)), hsv[2] || 1]);
  };
  wheel.addEventListener('pointerdown', e => { wheel.setPointerCapture(e.pointerId); pickWheel(e); wheel.onpointermove = pickWheel; });
  wheel.addEventListener('pointerup', () => { wheel.onpointermove = null; done(); });
  const drawWheel = () => {
    const x = wheel.getContext('2d'), R = px / 2;
    if (!wheelImage || wheelImage.width !== px) wheelImage = drawWheelImage(px);
    x.putImageData(wheelImage, 0, 0);
    if (hsv[2] < 1) { x.fillStyle = `rgba(0,0,0,${1 - hsv[2]})`; x.beginPath(); x.arc(R, R, R + 1, 0, 2 * Math.PI); x.fill(); }
    const a = hsv[0] * Math.PI / 180, cx = R + Math.sin(a) * hsv[1] * R * 0.985, cy = R - Math.cos(a) * hsv[1] * R * 0.985;
    x.lineWidth = 2 * dpr; x.strokeStyle = hsv[2] > 0.55 ? '#111' : '#fff';
    x.beginPath(); x.arc(cx, cy, 6 * dpr, 0, 2 * Math.PI); x.fillStyle = css(rgb); x.fill(); x.stroke();
  };

  const intensity = () => gslider('Intensity', 0, 100, 1, () => hsv[2] * 100, v => fromHSV([hsv[0], hsv[1], v / 100]), () => grad(2, t => hsvToRgb(hsv[0], hsv[1], t)), '%');
  const parts = {
    wheel: [h('div', { class: 'cpwheelbox' }, wheel), intensity()],
    rgb: ['Red', 'Green', 'Blue'].map((l, k) => gslider(l, 0, 255, 1, () => rgb[k] * 255, v => { const c = rgb.slice(); c[k] = v / 255; fromRGB(c); },
      () => grad(2, t => { const c = rgb.slice(); c[k] = t; return c; }))),
    hsv: [gslider('Hue', 0, 360, 1, () => hsv[0], v => fromHSV([v, hsv[1], hsv[2]]), () => grad(7, t => hsvToRgb(t * 360, 1, 1)), '°'),
      gslider('Saturation', 0, 100, 1, () => hsv[1] * 100, v => fromHSV([hsv[0], v / 100, hsv[2]]), () => grad(2, t => hsvToRgb(hsv[0], t, hsv[2] || 1)), '%'),
      intensity()],
    white: [gslider('Temperature', 1800, 10000, 50, () => kelvin, v => { kelvin = v; const w = kelvinToRgb(v); fromRGB(w.map(x => x * (hsv[2] || 1))); },
      () => grad(8, t => kelvinToRgb(1800 + t * 8200)), 'K'),
      intensity(),
      h('div', { class: 'cpchips' }, WHITE_KELVIN.map(k => h('button', { class: 'cpchip k', type: 'button', title: k + ' K', style: { background: css(kelvinToRgb(k)) },
        onclick: () => { kelvin = k; fromRGB(kelvinToRgb(k)); done(); } }, k / 1000 + 'K')))],
  };
  const body = h('div', { class: 'cpbody' });
  const tabs = seg(COLOR_MODES, ui.colorMode, v => { ui.colorMode = v; savePrefs(); showMode(); });
  const showMode = () => { body.replaceChildren(...parts[ui.colorMode]); refresh(); };

  const chip = (name, hex) => h('button', { class: 'cpchip', type: 'button', title: name, 'aria-label': name, style: { background: hex }, onclick: () => { fromRGB(fromHex(hex)); done(); } });
  const recentBox = h('div', { class: 'cpchips grid' });
  const showRecent = () => { const r = recentColors(); recentBox.replaceChildren(...(r.length ? r.map(x => chip(x, x)) : [h('span', { class: 'muted', style: { gridColumn: '1 / -1' } }, 'Colours you pick show here.')])); };

  function refresh() {
    was.style.background = toHex(before); now.style.background = toHex(rgb);
    if (document.activeElement !== hexIn) hexIn.value = toHex(rgb);
    if (ui.colorMode === 'wheel') drawWheel();
    for (const el of body.children) if (el._sync) el._sync();
  }

  const pop = h('div', { class: 'cpop', role: 'dialog', 'aria-label': 'Colour: ' + o.label },
    h('div', { class: 'cphead' }, h('span', { class: 'cpt' }, o.label), h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: closeColorPicker }, '×')),
    h('div', { class: 'cptop' }, h('div', { class: 'cpcmp' }, was, now), hexIn),
    tabs, body,
    h('div', { class: 'cplbl' }, 'Presets'), h('div', { class: 'cpchips grid' }, LIGHT_COLORS.map(([n, x]) => chip(n, x))),
    h('div', { class: 'cplbl' }, 'Recent'), recentBox);
  document.body.append(pop);
  showMode(); showRecent();

  // beside the swatch: below it, or above when there is no room, always inside the window
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, ht = pop.offsetHeight;
  pop.style.left = clamp(r.right - w, 8, innerWidth - w - 8) + 'px';
  pop.style.top = (r.bottom + 6 + ht < innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - ht - 6)) + 'px';

  const off = e => { if (!pop.contains(e.target) && !e.target.closest('.cswatch')) closeColorPicker(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); closeColorPicker(); } };
  setTimeout(() => { document.addEventListener('pointerdown', off, true); addEventListener('keydown', esc, true); }, 0);
  anchor.classList.add('open');
  colorPop = { key: o.key, pop, close: () => {
    pop.remove(); anchor.classList.remove('open');
    document.removeEventListener('pointerdown', off, true); removeEventListener('keydown', esc, true);
  } };
}
