// nouPix · js/touch.js
// Interactive content: effects that follow a finger (or the mouse) on a pad, TouchDesigner style. The pad is the
// Interact window of the main window (ui-touch.js), or the Remote page's full screen pad on a phone; both say where the
// fingers are on a zone (touchInput), as 0..1 across and down the pad, which stands for the whole zone. Nothing moves
// until someone touches: the effects drift by themselves and the fingers stir them.
//
// The fingers stir a small fluid (stable fluids, after Jos Stam): a finger's movement pushes the flow and leaves a
// little smoke in it; the flow curls (vorticity), carries itself and the smoke along, and settles over a few seconds,
// so a swipe keeps swirling after the finger lifts, the way air or water would. Worked out once a frame per zone, and
// only while something moves.
//
// What an effect gets (float inputs, like the music's, no controls): touchX, touchY (where the first finger is, or was
// last, 0..1 with y up, smoothed), touchDown (0..1, easing in when a finger is down and slowly out after it lifts), and
// an image input touchField: the fluid (red and green: the flow across and up, 0.5 still, ±1 about a pad's width a
// second; blue: the smoke). Effects push, gather, swirl and light with it.

const TOUCH_INPUTS = new Set(['touchX', 'touchY', 'touchDown', 'touchField']);
const isTouchInput = inp => TOUCH_INPUTS.has(inp.NAME) && (inp.NAME === 'touchField' ? inp.TYPE === 'image' : inp.TYPE === 'float');
const TOUCH_W = 80, TOUCH_H = 50;             // the fluid's grid, stretched smoothly over the zone by the effects
const TOUCH_HOLD = 1.5;                       // a finger not heard of for this long (a phone gone quiet) is let go
const FLUID = { settle: 2.2, smokeFade: 3.2, curl: 9, iters: 10, radius: 0.075, rise: 5 };   // seconds, strengths, sizes
const touches = new Map();                    // zone id (or '' for every zone) -> its fingers and fluid

function fluidNew() {
  const n = TOUCH_W * TOUCH_H, c = document.createElement('canvas');
  c.width = TOUCH_W; c.height = TOUCH_H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(TOUCH_W, TOUCH_H);
  for (let i = 0; i < n; i++) { img.data[i * 4] = img.data[i * 4 + 1] = 128; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const F = () => new Float32Array(n);
  return { u: F(), v: F(), u2: F(), v2: F(), d: F(), d2: F(), p: F(), div: F(), w: F(), canvas: c, ctx, img, still: true };
}
function touchOf(key) {
  let T = touches.get(key);
  if (!T) { T = Object.assign(fluidNew(), { fingers: new Map(), at: 0, x: 0.5, y: 0.5, down: 0, frame: -1, t: 0 }); touches.set(key, T); }
  return T;
}
// Where the fingers of one pad (from: this window '', or a device) are on a zone now: [[id, x, y], …] with x, y 0..1
// (y down); none: its fingers lifted. Other pads' fingers stay. zone null: every zone (a pad not tied to one).
function touchInput(zoneId, pts, from = '') {
  const T = touchOf(zoneId == null ? '' : String(zoneId)), now = performance.now() / 1000, seen = new Set(), mine = String(from) + '|';
  for (const p of Array.isArray(pts) ? pts.slice(0, 5) : []) {
    if (!Array.isArray(p) || !isFinite(p[1]) || !isFinite(p[2])) continue;
    const id = mine + String(p[0]).slice(0, 40), x = clamp(+p[1], 0, 1), y = clamp(+p[2], 0, 1), f = T.fingers.get(id);
    seen.add(id);
    if (f) { const dt = Math.max(now - f.t, 0.008); f.vx = f.vx * 0.5 + (x - f.x) / dt * 0.5; f.vy = f.vy * 0.5 + (y - f.y) / dt * 0.5; f.x = x; f.y = y; f.t = now; }
    else T.fingers.set(id, { x, y, px: x, py: y, vx: 0, vy: 0, t: now });
  }
  for (const id of [...T.fingers.keys()]) if (id.startsWith(mine) && !seen.has(id)) T.fingers.delete(id);
  T.at = now;
}

/* ---------- the fluid ---------- */
const fIdx = (i, j) => clamp(j, 0, TOUCH_H - 1) * TOUCH_W + clamp(i, 0, TOUCH_W - 1);
// a field read between cells
function fSample(a, x, y) {
  x = clamp(x, 0, TOUCH_W - 1.001); y = clamp(y, 0, TOUCH_H - 1.001);
  const i = x | 0, j = y | 0, s = x - i, t = y - j, k = j * TOUCH_W + i;
  return (a[k] * (1 - s) + a[k + 1] * s) * (1 - t) + (a[k + TOUCH_W] * (1 - s) + a[k + TOUCH_W + 1] * s) * t;
}
// A finger from (x0, y0) to (x1, y1) (0..1), moving at (vx, vy) a second: the flow nearby takes its movement, softly,
// and a little smoke is left, more for a quick stroke
function fSplat(S, x0, y0, x1, y1, vx, vy, dt) {
  const R = FLUID.radius * TOUCH_H, cu = vx * TOUCH_W, cv = vy * TOUCH_H, speed = Math.hypot(vx, vy);
  const steps = Math.max(1, Math.ceil(Math.hypot((x1 - x0) * TOUCH_W, (y1 - y0) * TOUCH_H) / (R * 0.5)));
  const smoke = Math.min(1, dt * (0.12 + 7 * speed)) / steps;   // a stroke leaves smoke; a finger resting, a little
  for (let s = 1; s <= steps; s++) {
    const cx = (x0 + (x1 - x0) * s / steps) * TOUCH_W, cy = (y0 + (y1 - y0) * s / steps) * TOUCH_H;
    for (let j = Math.max(0, Math.floor(cy - 2 * R)); j <= Math.min(TOUCH_H - 1, Math.ceil(cy + 2 * R)); j++)
      for (let i = Math.max(0, Math.floor(cx - 2 * R)); i <= Math.min(TOUCH_W - 1, Math.ceil(cx + 2 * R)); i++) {
        const dx = i + 0.5 - cx, dy = j + 0.5 - cy, w = Math.exp(-(dx * dx + dy * dy) / (R * R));
        if (w < 0.01) continue;
        const k = j * TOUCH_W + i, b = Math.min(1, w * 0.55 / steps * 3);
        S.u[k] += (cu - S.u[k]) * b; S.v[k] += (cv - S.v[k]) * b;
        S.d[k] = Math.min(1, S.d[k] + w * smoke);
      }
  }
}
function fStep(S, dt) {
  const W = TOUCH_W, H = TOUCH_H, { u, v, u2, v2, d, d2, p, div, w } = S;
  // the curl, and a push that keeps the eddies turning (vorticity confinement)
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const k = j * W + i; w[k] = 0.5 * ((v[k + 1] - v[k - 1]) - (u[k + W] - u[k - W])); }
  for (let j = 2; j < H - 2; j++) for (let i = 2; i < W - 2; i++) {
    const k = j * W + i, gx = 0.5 * (Math.abs(w[k + 1]) - Math.abs(w[k - 1])), gy = 0.5 * (Math.abs(w[k + W]) - Math.abs(w[k - W])), l = Math.hypot(gx, gy) + 1e-5;
    u[k] += FLUID.curl * dt * (gy / l) * w[k]; v[k] -= FLUID.curl * dt * (gx / l) * w[k];
  }
  // smoke is warm: it rises a little, and curls as it does
  for (let k = 0, n = W * H; k < n; k++) v[k] -= FLUID.rise * d[k] * dt;
  // the flow carries itself, and settles
  const keep = Math.exp(-dt / FLUID.settle);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, x = i - dt * u[k], y = j - dt * v[k];
    u2[k] = fSample(u, x, y) * keep; v2[k] = fSample(v, x, y) * keep;
  }
  // it neither gathers nor thins (incompressible): a swirl, not a splash
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; div[k] = -0.5 * (u2[fIdx(i + 1, j)] - u2[fIdx(i - 1, j)] + v2[fIdx(i, j + 1)] - v2[fIdx(i, j - 1)]); p[k] = 0; }
  for (let it = 0; it < FLUID.iters; it++)
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; p[k] = (div[k] + p[fIdx(i - 1, j)] + p[fIdx(i + 1, j)] + p[fIdx(i, j - 1)] + p[fIdx(i, j + 1)]) / 4; }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    u[k] = u2[k] - 0.5 * (p[fIdx(i + 1, j)] - p[fIdx(i - 1, j)]);
    v[k] = v2[k] - 0.5 * (p[fIdx(i, j + 1)] - p[fIdx(i, j - 1)]);
  }
  // the smoke goes with the flow and thins away
  const fade = Math.exp(-dt / FLUID.smokeFade);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; d2[k] = fSample(d, i - dt * u[k], j - dt * v[k]) * fade; }
  S.d = d2; S.d2 = d;
}
// Into the picture the effects read; tells whether anything still moves
function fPaint(S) {
  const a = S.img.data, d = S.d, sx = 100 / TOUCH_W, sy = 100 / TOUCH_H;
  let most = 0;
  for (let k = 0, n = TOUCH_W * TOUCH_H; k < n; k++) {
    const u = S.u[k], v = S.v[k];
    a[k * 4] = 128 + u * sx; a[k * 4 + 1] = 128 - v * sy; a[k * 4 + 2] = d[k] * 255;
    most = Math.max(most, Math.abs(u) + Math.abs(v), d[k] * 40);
  }
  S.ctx.putImageData(S.img, 0, 0);
  return most > 0.3;
}
function fRun(S, fingers, dt) {
  for (const f of fingers) { fSplat(S, f.px, f.py, f.x, f.y, f.vx, f.vy, dt); f.px = f.x; f.py = f.y; }
  // a long frame in two steps, so a fast flow doesn't skip cells
  const n = dt > 0.04 ? 2 : 1;
  for (let i = 0; i < n; i++) fStep(S, dt / n);
  return fPaint(S);
}

// A zone's touch, brought up to date once a frame: the fingers' smoothed place, and the fluid, while it moves
function touchFeatures(zoneId) {
  const own = touches.get(String(zoneId)), all = touches.get('');
  const T = own && (own.fingers.size || !all || !all.fingers.size || own.at >= all.at) ? own : all;
  if (!T) return null;
  if (T.frame === frameIndex) return T;
  const now = performance.now() / 1000, dt = T.t ? clamp(now - T.t, 0, 0.1) : 0.025;
  T.frame = frameIndex; T.t = now;
  for (const [id, f] of T.fingers) if (now - f.t > TOUCH_HOLD) T.fingers.delete(id);   // its pad went quiet
  const first = T.fingers.values().next().value;
  if (first) { const k = 1 - Math.exp(-dt / 0.12); T.x += (first.x - T.x) * k; T.y += (first.y - T.y) * k; }
  T.down += ((T.fingers.size ? 1 : 0) - T.down) * (1 - Math.exp(-dt / (T.fingers.size ? 0.15 : 1.2)));
  if (T.fingers.size || !T.still) T.still = !fRun(T, [...T.fingers.values()], dt) && !T.fingers.size;
  for (const f of T.fingers.values()) { f.vx *= Math.exp(-dt / 0.15); f.vy *= Math.exp(-dt / 0.15); }   // held still, it stops pushing
  return T;
}
// A thumbnail's touch: a finger going round in a fluid of its own, run on from the thumbnail's time
const touchFake = { S: null, t: 0 };
function touchFakeAt(t) {
  const at = s => ({ x: 0.5 + 0.3 * Math.cos(s * 1.6), y: 0.5 + 0.25 * Math.sin(s * 2.1) });
  const F = touchFake;
  if (!F.S || t < F.t || t - F.t > 1) { F.S = fluidNew(); F.t = t - 1.2; }   // a still one: 1.2 s of stirring first
  while (F.t < t - 1e-6) {
    const dt = Math.min(0.04, t - F.t), a = at(F.t), b = at(F.t + dt);
    fRun(F.S, [{ px: a.x, py: a.y, x: b.x, y: b.y, vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt }], dt);
    F.t += dt;
  }
  const p = at(t);
  return { x: p.x, y: p.y, canvas: F.S.canvas };
}
// A touch input's value for an effect drawn in zone z (a zone object, or null); t: a thumbnail's time, or null
function touchInputValue(name, t, z) {
  if (t != null) {
    const f = touchFakeAt(t);
    return { touchX: f.x, touchY: 1 - f.y, touchDown: 1, touchField: f.canvas }[name];
  }
  const T = touchFeatures(z ? z.id : '');
  if (name === 'touchField') return T ? T.canvas : touchOf('').canvas;
  if (!T) return name === 'touchDown' ? 0 : 0.5;
  return { touchX: T.x, touchY: 1 - T.y, touchDown: T.down }[name] ?? 0;
}
// Where a zone's pixels are, for a pad to show them faintly: [x, y, x, y, …], 0..1 across and down the zone (as the
// pad stands for it); at most about 3000, every so many of a long fixture
function touchMap(z) {
  if (!z) return [];
  const all = [];
  for (const f of project.fixtures) {
    const P = f._pts;
    if (!P || f.enabled === false) continue;
    for (let i = 0; i < P.length; i += 2) if (P[i] >= z.x && P[i] <= z.x + z.w && P[i + 1] >= z.y && P[i + 1] <= z.y + z.h) all.push((P[i] - z.x) / z.w, (P[i + 1] - z.y) / z.h);
  }
  const every = Math.max(1, Math.ceil(all.length / 2 / 3000)), out = [];
  for (let i = 0; i < all.length; i += 2 * every) out.push(Math.round(all[i] * 1000) / 1000, Math.round(all[i + 1] * 1000) / 1000);
  return out;
}
// Whether a source follows touch, and whether a zone plays one now (for the Remote page's Interact)
const isTouchSource = src => !!(src && src.kind === 'isf' && (headerOf(src)?.INPUTS || []).some(isTouchInput));
const zoneTouches = z => z.layers.some(L => L.on && L.src && isTouchSource(srcById(L.src)));
