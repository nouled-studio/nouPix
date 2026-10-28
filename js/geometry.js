// nouPix · js/geometry.js
// Mapping math: where each pixel of a fixture is (computePoints, rebuildGeometry), lengths, bounds and distances,
// and moving, turning and scaling a fixture or the frame around several. Uses util and model.

/* ---------- pixels of each fixture ---------- */
function matrixOrder(cols, rows, start, dir, snake) {
  const out = [];
  const fromR = start[1] === 'R', fromB = start[0] === 'B';
  if (dir === 'H') {
    for (let r = 0; r < rows; r++) {
      const rr = fromB ? rows - 1 - r : r;
      const flip = snake && r % 2 === 1;
      for (let c = 0; c < cols; c++) { const lr = fromR !== flip; out.push(lr ? cols - 1 - c : c, rr); }
    }
  } else {
    for (let c = 0; c < cols; c++) {
      const cc = fromR ? cols - 1 - c : c;
      const flip = snake && c % 2 === 1;
      for (let r = 0; r < rows; r++) { const bt = fromB !== flip; out.push(cc, bt ? rows - 1 - r : r); }
    }
  }
  return out;
}
function matrixCorners(f) {
  const c = Math.cos(rad(f.rot)), s = Math.sin(rad(f.rot));
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = sx * f.w / 2, ly = sy * f.h / 2;
    return [f.cx + lx * c - ly * s, f.cy + lx * s + ly * c];
  });
}
// The line a path runs along. Without handles its points are joined straight; a path drawn with the pen has two
// handles per point (ctl: in x, in y, out x, out y, relative to the point) and runs along cubic curves between them.
// For a closed path the closing curve is included, but not its end (which is the first point again).
function pathPoly(f) {
  const P = f.pts, H = f.ctl;
  if (!H) return P;
  const n = P.length / 2, segs = f.closed ? n : n - 1, out = [P[0], P[1]];
  for (let k = 0; k < segs; k++) {
    const b = (k + 1) % n, x0 = P[2 * k], y0 = P[2 * k + 1], x3 = P[2 * b], y3 = P[2 * b + 1];
    const x1 = x0 + H[4 * k + 2], y1 = y0 + H[4 * k + 3], x2 = x3 + H[4 * b], y2 = y3 + H[4 * b + 1];
    const steps = x1 === x0 && y1 === y0 && x2 === x3 && y2 === y3 ? 1 : 32;
    const last = f.closed && k === segs - 1 ? steps - 1 : steps;
    for (let i = 1; i <= last; i++) {
      const t = i / steps, u = 1 - t, a = u * u * u, bb = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push(a * x0 + bb * x1 + c * x2 + d * x3, a * y0 + bb * y1 + c * y2 + d * y3);
    }
  }
  return out;
}
function resamplePath(src, closed, n) {
  const P = src.slice();
  if (closed && P.length >= 4) P.push(P[0], P[1]);
  const m = P.length / 2;
  const out = new Float32Array(n * 2);
  if (m < 2) { for (let i = 0; i < n; i++) { out[2 * i] = P[0] || 0; out[2 * i + 1] = P[1] || 0; } return out; }
  const cum = [0];
  for (let k = 1; k < m; k++) cum.push(cum[k - 1] + Math.hypot(P[2 * k] - P[2 * k - 2], P[2 * k + 1] - P[2 * k - 1]));
  const L = cum[m - 1];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = closed ? i * L / n : (n > 1 ? i * L / (n - 1) : L / 2);
    while (k < m - 2 && cum[k + 1] < s) k++;
    const seg = cum[k + 1] - cum[k] || 1;
    const t = clamp((s - cum[k]) / seg, 0, 1);
    out[2 * i] = P[2 * k] + (P[2 * k + 2] - P[2 * k]) * t;
    out[2 * i + 1] = P[2 * k + 1] + (P[2 * k + 3] - P[2 * k + 1]) * t;
  }
  return out;
}
function pathLength(f) {
  let L = 0; const P = pathPoly(f);
  for (let k = 2; k < P.length; k += 2) L += Math.hypot(P[k] - P[k - 2], P[k + 1] - P[k - 1]);
  if (f.closed && P.length >= 4) L += Math.hypot(P[0] - P[P.length - 2], P[1] - P[P.length - 1]);
  return L;
}
// Circles can be stretched into ovals: r is the horizontal radius, ry the vertical one. An oval can be turned by
// rot degrees (clockwise), as a matrix; a circle turns by its start angle instead. A circle has no ry (it
// follows r), so projects from before ovals open unchanged.
const ryOf = f => typeof f.ry === 'number' ? f.ry : f.r;
const isOval = f => f.type === 'circle' && typeof f.ry === 'number' && Math.abs(f.ry - f.r) > 1e-6;
const ovalRot = f => isOval(f) ? numOr(f.rot, 0) : 0;
// Fine points along an oval's arc with their running length, to space pixels evenly along it as on a real strip
// (equal angles would bunch them up at the narrow ends)
function ovalSamples(f) {
  // kept with the fixture until its shape changes: selection frames, hit tests and redraws ask for it many times
  const key = `${f.cx},${f.cy},${f.r},${f.ry},${f.rot},${f.start},${f.sweep},${f.ccw}`;
  if (f._oval && f._ovalKey === key) return f._oval;
  f._ovalKey = key;
  return (f._oval = sampleOval(f));
}
function sampleOval(f) {
  const sweep = clamp(f.sweep, 1, 360), dir = f.ccw ? -1 : 1, rx = f.r, ry = ryOf(f);
  const M = Math.max(64, Math.ceil(sweep * 4));
  const xs = new Float64Array(M + 1), ys = new Float64Array(M + 1), L = new Float64Array(M + 1);
  const c = Math.cos(rad(ovalRot(f))), s = Math.sin(rad(ovalRot(f)));
  for (let k = 0; k <= M; k++) {
    const a = rad(f.start + dir * sweep * k / M), lx = rx * Math.sin(a), ly = -ry * Math.cos(a);
    xs[k] = f.cx + lx * c - ly * s; ys[k] = f.cy + lx * s + ly * c;
    if (k) L[k] = L[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
  }
  return { xs, ys, L, M };
}
function fixtureLength(f) {
  if (f.type === 'line') return Math.hypot(f.x2 - f.x1, f.y2 - f.y1);
  if (f.type === 'circle') { if (isOval(f)) { const o = ovalSamples(f); return o.L[o.M]; } return 2 * Math.PI * f.r * Math.min(360, f.sweep) / 360; }
  if (f.type === 'path') return pathLength(f);
  return 0;
}
function pixelCount(f) {
  return f.type === 'matrix' ? Math.max(1, f.cols | 0) * Math.max(1, f.rows | 0) : Math.max(1, f.pixels | 0);
}
function computePoints(f) {
  const n = pixelCount(f);
  let pts = new Float32Array(n * 2);
  if (f.type === 'line') {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      pts[2 * i] = f.x1 + (f.x2 - f.x1) * t; pts[2 * i + 1] = f.y1 + (f.y2 - f.y1) * t;
    }
  } else if (isOval(f)) {
    const o = ovalSamples(f), T = o.L[o.M], full = clamp(f.sweep, 1, 360) >= 359.99;
    const gap = full ? T / n : (n > 1 ? T / (n - 1) : 0);
    for (let i = 0, k = 1; i < n; i++) {
      const d = i * gap;
      while (k < o.M && o.L[k] < d) k++;
      const t = o.L[k] > o.L[k - 1] ? clamp((d - o.L[k - 1]) / (o.L[k] - o.L[k - 1]), 0, 1) : 0;
      pts[2 * i] = o.xs[k - 1] + (o.xs[k] - o.xs[k - 1]) * t; pts[2 * i + 1] = o.ys[k - 1] + (o.ys[k] - o.ys[k - 1]) * t;
    }
  } else if (f.type === 'circle') {
    const sweep = clamp(f.sweep, 1, 360), full = sweep >= 359.99;
    const step = full ? sweep / n : (n > 1 ? sweep / (n - 1) : 0);
    const dir = f.ccw ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const a = rad(f.start + dir * i * step);
      pts[2 * i] = f.cx + f.r * Math.sin(a); pts[2 * i + 1] = f.cy - f.r * Math.cos(a);
    }
  } else if (f.type === 'matrix') {
    const cols = Math.max(1, f.cols | 0), rows = Math.max(1, f.rows | 0);
    const ord = matrixOrder(cols, rows, f.start, f.dir, f.snake);
    const c = Math.cos(rad(f.rot)), s = Math.sin(rad(f.rot));
    for (let i = 0; i < n; i++) {
      const lx = -f.w / 2 + (ord[2 * i] + 0.5) * f.w / cols, ly = -f.h / 2 + (ord[2 * i + 1] + 0.5) * f.h / rows;
      pts[2 * i] = f.cx + lx * c - ly * s; pts[2 * i + 1] = f.cy + lx * s + ly * c;
    }
  } else if (f.type === 'path') {
    pts = resamplePath(pathPoly(f), f.closed, n);
  }
  if (f.reverse && f.type !== 'matrix') {
    for (let i = 0, j = n - 1; i < j; i++, j--) {
      const ax = pts[2 * i], ay = pts[2 * i + 1];
      pts[2 * i] = pts[2 * j]; pts[2 * i + 1] = pts[2 * j + 1]; pts[2 * j] = ax; pts[2 * j + 1] = ay;
    }
  }
  return pts;
}
function fixturePitch(f) {
  if (f.type === 'matrix') return Math.min(f.w / Math.max(1, f.cols), f.h / Math.max(1, f.rows));
  const n = pixelCount(f);
  const L = fixtureLength(f);
  return n > 1 ? L / (f.type === 'circle' && f.sweep >= 359.99 ? n : n - 1) : 20;
}
// A fixture with its pitch locked keeps the spacing between its pixels (f.pitchLock): its pixel count follows its
// length, and its length snaps to whole pixels. Strips, circles and arcs; on an oval the lock waits, unused.
const MAX_FX_PIXELS = 20000;
function lockedPitch(f) {
  return f.pitchLock > 0 && (f.type === 'line' || (f.type === 'circle' && !isOval(f))) ? f.pitchLock : 0;
}
// After a locked fixture's shape changed: its pixel count from its length, then its length snapped to that count.
// A strip keeps its start ('start', the default), its end ('end') or its middle ('mid') and its direction; a circle
// its radius, but a full one snaps its radius so the ring closes evenly; an arc keeps its radius and snaps its sweep.
function fitPitch(f, keep = 'start') {
  const p = lockedPitch(f);
  if (!p) return;
  if (f.type === 'line') {
    const dx = f.x2 - f.x1, dy = f.y2 - f.y1, L = Math.hypot(dx, dy), ux = L ? dx / L : 1, uy = L ? dy / L : 0;
    const n = clamp(Math.round(L / p) + 1, 2, MAX_FX_PIXELS), L2 = p * (n - 1);
    if (keep === 'end') { f.x1 = r3(f.x2 - ux * L2); f.y1 = r3(f.y2 - uy * L2); }
    else if (keep === 'mid') {
      const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
      f.x1 = r3(mx - ux * L2 / 2); f.y1 = r3(my - uy * L2 / 2); f.x2 = r3(mx + ux * L2 / 2); f.y2 = r3(my + uy * L2 / 2);
    } else { f.x2 = r3(f.x1 + ux * L2); f.y2 = r3(f.y1 + uy * L2); }
    f.pixels = n;
  } else if (clamp(f.sweep, 1, 360) >= 359.99) {
    const n = clamp(Math.round(2 * Math.PI * f.r / p), 3, MAX_FX_PIXELS);
    f.r = r3(n * p / (2 * Math.PI));
    f.pixels = n;
  } else {
    // an arc reaches at most 359°: past that it would be a ring
    const most = Math.max(2, Math.floor(2 * Math.PI * f.r * 359 / 360 / p) + 1);
    const n = clamp(Math.round(fixtureLength(f) / p) + 1, 2, Math.min(most, MAX_FX_PIXELS));
    f.sweep = r3(clamp((n - 1) * p / f.r * 180 / Math.PI, 1, 359));
    f.pixels = n;
  }
}
// n pixels at the fixture's pitch (locked or not): a strip's end moves along its direction, a full circle's radius
// changes, an arc's sweep grows or shrinks from its end. A locked fixture then snaps to whole pixels.
function setPixelsAtPitch(f, n, p = lockedPitch(f) || fixturePitch(f)) {
  n = clamp(Math.round(n), 1, MAX_FX_PIXELS);
  if (!(p > 0)) return;
  if (f.type === 'line') {
    const a = Math.atan2(f.y2 - f.y1, f.x2 - f.x1), L = p * Math.max(1, n - 1);
    f.x2 = r3(f.x1 + Math.cos(a) * L); f.y2 = r3(f.y1 + Math.sin(a) * L);
  } else if (f.type === 'circle' && !isOval(f)) {
    if (clamp(f.sweep, 1, 360) >= 359.99) f.r = r3(Math.max(0.5, Math.max(3, n) * p / (2 * Math.PI)));
    else f.sweep = r3(clamp(Math.max(1, n - 1) * p / f.r * 180 / Math.PI, 1, 359));
  } else return;
  f.pixels = n;
  fitPitch(f);
}
// A new pitch, keeping the pixel count: the strip's end, the ring's radius or the arc's sweep moves. A locked
// fixture keeps the new pitch.
function setPitch(f, p) {
  if (!(p > 0)) return;
  if (f.pitchLock > 0) f.pitchLock = p;
  setPixelsAtPitch(f, pixelCount(f), p);
}
// A strip's direction in degrees, 0 to the right and clockwise on the stage (y grows downwards), from 0 to 360
function lineAngle(f) { return f.x2 === f.x1 && f.y2 === f.y1 ? 0 : wrap360(Math.atan2(f.y2 - f.y1, f.x2 - f.x1) * 180 / Math.PI); }
// Turns a strip around its start to deg degrees, keeping its length
function setLineAngle(f, deg) {
  const L = fixtureLength(f);
  f.x2 = r3(f.x1 + Math.cos(rad(deg)) * L); f.y2 = r3(f.y1 + Math.sin(rad(deg)) * L);
}
// Moves a strip's end along its direction to make it L long (a locked strip snaps to whole pixels)
function setLineLength(f, L) {
  const a = rad(lineAngle(f));
  L = Math.max(0, L);
  f.x2 = r3(f.x1 + Math.cos(a) * L); f.y2 = r3(f.y1 + Math.sin(a) * L);
  fitPitch(f);
}
function fixtureBounds(f) {
  let xs, ys;
  if (f.type === 'line') { xs = [f.x1, f.x2]; ys = [f.y1, f.y2]; }
  else if (f.type === 'circle' && ovalRot(f)) { const o = ovalSamples(f); xs = Array.from(o.xs); ys = Array.from(o.ys); }
  else if (f.type === 'circle') { xs = [f.cx - f.r, f.cx + f.r]; ys = [f.cy - ryOf(f), f.cy + ryOf(f)]; }
  else if (f.type === 'matrix') { const c = matrixCorners(f); xs = c.map(p => p[0]); ys = c.map(p => p[1]); }
  else { const P = pathPoly(f); xs = P.filter((_, i) => i % 2 === 0); ys = P.filter((_, i) => i % 2 === 1); }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function rebuildGeometry() {
  for (const f of project.fixtures) {
    const n = pixelCount(f);
    f._pts = computePoints(f);
    if (f._n !== n) patchDirty = true;
    f._n = n;
    f._pitch = fixturePitch(f);
    if (!f._col || f._col.length !== n * 3) { f._col = new Uint8ClampedArray(n * 3); f._disp = new Uint8ClampedArray(n * 3); }
  }
  geomDirty = false;
  computeBB();
}

/* ---------- bounds of all the pixels ---------- */
let fixtureBB = null, geomVersion = 0; // the version changes whenever pixel positions or the canvas change
function computeBB() {
  geomVersion++;
  const W = project.settings.compW, H = project.settings.compH;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of project.fixtures) {
    const P = f._pts;
    for (let i = 0; i < P.length; i += 2) {
      const x = P[i], y = P[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W - 1, Math.floor(x1)); y1 = Math.min(H - 1, Math.floor(y1));
  fixtureBB = x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1 } : null;
}

// The point x, y turned around ox, oy to the nearest multiple of 45° (Shift while drawing or dragging a line end)
function snap45(ox, oy, x, y) {
  const a = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(x - ox, y - oy);
  return [ox + Math.cos(a) * L, oy + Math.sin(a) * L];
}

/* ---------- distances ---------- */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function distFixture(f, x, y, tol) {
  if (f.type === 'line') return distSeg(x, y, f.x1, f.y1, f.x2, f.y2);
  if (f.type === 'circle') {
    const t = -rad(ovalRot(f)), ux = (x - f.cx) * Math.cos(t) - (y - f.cy) * Math.sin(t), uy = (x - f.cx) * Math.sin(t) + (y - f.cy) * Math.cos(t);
    const rx = f.r, ry = ryOf(f), d = Math.abs(Math.hypot(ux / rx, uy / ry) - 1) * Math.min(rx, ry);
    if (f.sweep >= 359.99) return d;
    let best = Infinity; const P = f._pts;
    for (let i = 0; i < P.length; i += 2) best = Math.min(best, Math.hypot(x - P[i], y - P[i + 1]));
    return Math.min(best, d + (best > tol * 2 ? 1e9 : 0));
  }
  if (f.type === 'matrix') {
    const a = -rad(f.rot), dx = x - f.cx, dy = y - f.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= f.w / 2 && Math.abs(ly) <= f.h / 2) return tol * 0.9; // weak hit: lines on top win
    const ex = Math.max(0, Math.abs(lx) - f.w / 2), ey = Math.max(0, Math.abs(ly) - f.h / 2);
    return Math.hypot(ex, ey);
  }
  let best = Infinity; const P = pathPoly(f);
  for (let i = 2; i < P.length; i += 2) best = Math.min(best, distSeg(x, y, P[i - 2], P[i - 1], P[i], P[i + 1]));
  if (f.closed && P.length >= 4) best = Math.min(best, distSeg(x, y, P[P.length - 2], P[P.length - 1], P[0], P[1]));
  return best;
}

/* ---------- moving a fixture ---------- */
function snapshotGeom(f) { return JSON.parse(JSON.stringify(f, replacer)); }
function moveFixture(f, o, dx, dy) {
  if (f.type === 'line') { f.x1 = o.x1 + dx; f.y1 = o.y1 + dy; f.x2 = o.x2 + dx; f.y2 = o.y2 + dy; }
  else if (f.type === 'path') f.pts = o.pts.map((v, i) => v + (i % 2 ? dy : dx));
  else { f.cx = o.cx + dx; f.cy = o.cy + dy; }
}

/* ---------- turning, scaling and framing fixtures ---------- */
function shiftFixture(f, dx, dy) {
  if (!dx && !dy) return;
  moveFixture(f, snapshotGeom(f), dx, dy);
  for (const k of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy']) if (typeof f[k] === 'number') f[k] = r3(f[k]);
  if (f.type === 'path') f.pts = f.pts.map(r3);
}
// Turns a fixture by deg degrees (clockwise on the stage) around the point px, py; o is its geometry before.
// A line or path turns its points; a matrix or an oval its rotation; a circle its start angle (where pixel 1 is).
function rotateFixture(f, o, px, py, deg) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  const P = (x, y) => [r3(px + (x - px) * c - (y - py) * s), r3(py + (x - px) * s + (y - py) * c)];
  const turn = a => r3(wrap180(a + deg));
  if (f.type === 'line') { [f.x1, f.y1] = P(o.x1, o.y1); [f.x2, f.y2] = P(o.x2, o.y2); }
  else if (f.type === 'path') {
    const pts = [];
    for (let i = 0; i < o.pts.length; i += 2) pts.push(...P(o.pts[i], o.pts[i + 1]));
    f.pts = pts;
    if (o.ctl) f.ctl = o.ctl.map((v, i, H) => i % 2 ? r3(H[i - 1] * s + v * c) : r3(v * c - H[i + 1] * s));   // handles are relative
  } else {
    [f.cx, f.cy] = P(o.cx, o.cy);
    if (f.type === 'matrix') f.rot = turn(numOr(o.rot, 0));
    else if (isOval(o)) { const r = turn(numOr(o.rot, 0)); if (r) f.rot = r; else delete f.rot; }
    else f.start = turn(numOr(o.start, 0));
  }
}
// Stretches a fixture by sx, sy along the axes of frame F (turned by F.angle), away from the point ax, ay of the
// frame (from its centre, along its axes); o is its geometry before. Pixel counts stay: the pixels spread out, but a
// fixture with its pitch locked keeps its spacing and gets more or fewer pixels.
// A matrix or an oval stretched across its own axes keeps its shape as near as it can (no slanting).
function scaleFixture(f, o, F, ax, ay, sx, sy) {
  const t = rad(F.angle), c = Math.cos(t), s = Math.sin(t);
  const local = (x, y) => [x * c + y * s, -x * s + y * c], world = (u, v) => [u * c - v * s, u * s + v * c];
  const P = (x, y) => { const [u, v] = local(x - F.cx, y - F.cy), [X, Y] = world(ax + (u - ax) * sx, ay + (v - ay) * sy); return [r3(F.cx + X), r3(F.cy + Y)]; };
  const V = (x, y) => { const [u, v] = local(x, y); return world(u * sx, v * sy); };   // a direction or offset
  const axis = deg => { const [X, Y] = V(Math.cos(rad(deg)), Math.sin(rad(deg))); return [Math.hypot(X, Y), Math.atan2(Y, X) * 180 / Math.PI]; };
  if (f.type === 'line') { [f.x1, f.y1] = P(o.x1, o.y1); [f.x2, f.y2] = P(o.x2, o.y2); }
  else if (f.type === 'path') {
    const pts = [];
    for (let i = 0; i < o.pts.length; i += 2) pts.push(...P(o.pts[i], o.pts[i + 1]));
    f.pts = pts;
    if (o.ctl) { const H = []; for (let i = 0; i < o.ctl.length; i += 2) H.push(...V(o.ctl[i], o.ctl[i + 1]).map(r3)); f.ctl = H; }
  } else if (f.type === 'matrix') {
    [f.cx, f.cy] = P(o.cx, o.cy);
    const r = numOr(o.rot, 0), [kw, a] = axis(r), [kh] = axis(r + 90);
    f.w = r3(Math.max(1, o.w * kw)); f.h = r3(Math.max(1, o.h * kh)); f.rot = r3(wrap180(a));
  } else if (f.type === 'circle') {
    [f.cx, f.cy] = P(o.cx, o.cy);
    const r0 = ovalRot(o), [kx, a] = axis(r0), [ky] = axis(r0 + 90), rx = Math.max(0.5, o.r * kx), ry = Math.max(0.5, ryOf(o) * ky);
    if (Math.abs(rx - ry) < 1e-3) { f.r = r3(rx); delete f.ry; delete f.rot; f.start = r3(wrap180(numOr(o.start, 0) + r0)); }
    else {   // an oval turned by rot: its start angle is along its own axes, so pixel 1 stays where it was
      const r1 = r3(wrap180(a));
      f.r = r3(rx); f.ry = r3(ry);
      if (r1) f.rot = r1; else delete f.rot;
      f.start = r3(wrap180(numOr(o.start, 0) + r0 - r1));
    }
  }
  fitPitch(f, 'mid');   // a locked fixture gets more or fewer pixels, not a new spacing
}
// Points around a fixture's outline, for the frame around a selection
function outlinePts(f) {
  if (f.type === 'line') return [[f.x1, f.y1], [f.x2, f.y2]];
  if (f.type === 'matrix') return matrixCorners(f);
  if (f.type === 'circle') {
    if (isOval(f)) { const o = ovalSamples(f), out = []; for (let k = 0; k <= o.M; k += Math.max(1, o.M >> 6)) out.push([o.xs[k], o.ys[k]]); return out; }
    const out = [], sweep = clamp(f.sweep, 1, 360), dir = f.ccw ? -1 : 1;
    for (let k = 0; k <= 64; k++) { const a = rad(f.start + dir * sweep * k / 64); out.push([f.cx + f.r * Math.sin(a), f.cy - f.r * Math.cos(a)]); }
    return out;
  }
  const P = pathPoly(f), out = [];
  for (let i = 0; i < P.length; i += 2) out.push([P[i], P[i + 1]]);
  return out;
}
// The frame around fixtures, turned by angle degrees: its centre, its size along its own axes, its angle
function frameOf(list, angle = 0) {
  const t = rad(angle), c = Math.cos(t), s = Math.sin(t);
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const f of list) for (const [x, y] of outlinePts(f)) {
    const u = x * c + y * s, v = -x * s + y * c;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  return { cx: um * c - vm * s, cy: um * s + vm * c, w: u1 - u0, h: v1 - v0, angle };
}
// A point of a frame, from its centre along its axes
function frameAt(F, lx, ly) { const t = rad(F.angle), c = Math.cos(t), s = Math.sin(t); return [F.cx + lx * c - ly * s, F.cy + lx * s + ly * c]; }
