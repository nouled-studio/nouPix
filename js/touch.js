// nouPix · js/touch.js
// Interactive content: effects that follow a finger (or the mouse) on a pad, TouchDesigner style. The pad is the
// Interact window of the main window (ui-touch.js), or the Remote page's full screen pad on a phone; both say where the
// fingers are on a zone (touchInput), as 0..1 across and down the pad, which stands for the whole zone. Nothing moves
// until someone touches: the effects drift by themselves and stir where the fingers pass.
//
// What an effect gets (float inputs, like the music's, no controls): touchX, touchY (where the first finger is, or was
// last, 0..1 with y up, smoothed), touchDown (0..1, easing in when a finger is down and out after it lifts), and an
// image input touchField: the fingers' trail, fading, drawn once a frame per zone (red and green: the speed across
// and up, 0.5 still; blue: how fresh). Stirring, pushing and lighting are all read from that picture.

const TOUCH_INPUTS = new Set(['touchX', 'touchY', 'touchDown', 'touchField']);
const isTouchInput = inp => TOUCH_INPUTS.has(inp.NAME) && (inp.NAME === 'touchField' ? inp.TYPE === 'image' : inp.TYPE === 'float');
const TOUCH_W = 128, TOUCH_H = 80;           // the trail picture: small, as the effects blur it anyway
const TOUCH_HOLD = 1.5;                       // a finger not heard of for this long (a phone gone quiet) is let go
const touches = new Map();                    // zone id (or '' for every zone) -> its fingers and trail

function touchOf(key) {
  let T = touches.get(key);
  if (!T) {
    const c = document.createElement('canvas'); c.width = TOUCH_W; c.height = TOUCH_H;
    const x = c.getContext('2d'); x.fillStyle = 'rgb(128,128,0)'; x.fillRect(0, 0, TOUCH_W, TOUCH_H);
    T = { fingers: new Map(), at: 0, x: 0.5, y: 0.5, down: 0, canvas: c, ctx: x, frame: -1, t: 0 };
    touches.set(key, T);
  }
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
// A zone's touch, brought up to date once a frame: the fingers' smoothed place and the trail, fading
function touchFeatures(zoneId) {
  const own = touches.get(String(zoneId)), all = touches.get('');
  const T = own && (own.fingers.size || !all || !all.fingers.size || own.at >= all.at) ? own : all;
  if (!T) return null;
  if (T.frame === frameIndex) return T;
  const now = performance.now() / 1000, dt = T.t ? clamp(now - T.t, 0, 0.25) : 0.025;
  T.frame = frameIndex; T.t = now;
  for (const [id, f] of T.fingers) if (now - f.t > TOUCH_HOLD) T.fingers.delete(id);   // its pad went quiet
  const x = T.ctx, first = T.fingers.values().next().value;
  if (first) { const k = 1 - Math.exp(-dt / 0.06); T.x += (first.x - T.x) * k; T.y += (first.y - T.y) * k; }
  T.down += ((T.fingers.size ? 1 : 0) - T.down) * (1 - Math.exp(-dt / (T.fingers.size ? 0.08 : 0.6)));
  // the trail fades towards still and dark over about two seconds
  x.globalCompositeOperation = 'source-over';
  x.fillStyle = `rgba(128,128,0,${1 - Math.exp(-dt / 0.8)})`;
  x.fillRect(0, 0, TOUCH_W, TOUCH_H);
  for (const f of T.fingers.values()) {
    // a soft dot from where the finger was to where it is, carrying its speed
    const r = TOUCH_H * 0.09, vr = clamp(128 + f.vx * 90, 0, 255), vg = clamp(128 - f.vy * 90, 0, 255);
    const n = Math.max(1, Math.ceil(Math.hypot((f.x - f.px) * TOUCH_W, (f.y - f.py) * TOUCH_H) / (r * 0.5)));
    for (let i = 1; i <= n; i++) {
      const cx = (f.px + (f.x - f.px) * i / n) * TOUCH_W, cy = (f.py + (f.y - f.py) * i / n) * TOUCH_H;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${vr | 0},${vg | 0},255,0.55)`); g.addColorStop(1, `rgba(${vr | 0},${vg | 0},255,0)`);
      x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    f.px = f.x; f.py = f.y;
    f.vx *= Math.exp(-dt / 0.15); f.vy *= Math.exp(-dt / 0.15);   // held still, it stops pushing
  }
  return T;
}
// A thumbnail's touch: a finger going round, its trail behind it
const touchFake = { canvas: null };
function touchFakeAt(t) {
  const a = t * 1.6, x = 0.5 + 0.3 * Math.cos(a), y = 0.5 + 0.25 * Math.sin(a * 1.3);
  if (!touchFake.canvas) { touchFake.canvas = document.createElement('canvas'); touchFake.canvas.width = TOUCH_W; touchFake.canvas.height = TOUCH_H; }
  const c = touchFake.canvas.getContext('2d');
  c.fillStyle = 'rgb(128,128,0)'; c.fillRect(0, 0, TOUCH_W, TOUCH_H);
  for (let i = 12; i >= 0; i--) {
    const b = a - i * 0.12, px = (0.5 + 0.3 * Math.cos(b)) * TOUCH_W, py = (0.5 + 0.25 * Math.sin(b * 1.3)) * TOUCH_H, r = TOUCH_H * 0.09;
    const vx = -Math.sin(b), vy = Math.cos(b * 1.3), g = c.createRadialGradient(px, py, 0, px, py, r), k = 1 - i / 13;
    g.addColorStop(0, `rgba(${128 + vx * 90 | 0},${128 - vy * 90 | 0},${255 * k | 0},0.8)`); g.addColorStop(1, `rgba(128,128,${255 * k | 0},0)`);
    c.fillStyle = g; c.fillRect(px - r, py - r, r * 2, r * 2);
  }
  return { x, y, canvas: touchFake.canvas };
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
// Whether a source follows touch, and whether a zone plays one now (for the Remote page's Interact)
const isTouchSource = src => !!(src && src.kind === 'isf' && (headerOf(src)?.INPUTS || []).some(isTouchInput));
const zoneTouches = z => z.layers.some(L => L.on && L.src && isTouchSource(srcById(L.src)));
