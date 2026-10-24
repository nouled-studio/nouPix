// nouPix · js/ui-stage.js
// The stage: view and zoom, drawing fixtures, wiring, zones and the selection frame, hit testing, dragging
// handles, the drawing tools and the pointer, the pixel finder and the guide image.

/* ---------- pixel finder ---------- */
// Pixel finder: a pixel picked on the stage, with its address
function pickPixel(f, i) {
  ui.pickPx = { fid: f.id, i };
  const a = pixelAddrText(f, i);
  toast(`${f.name} · pixel ${i + 1} of ${f._n}` + (a ? ` · ${a}` : ' · not patched'));
}

/* ---------- stage view ---------- */
const cv = $('#view');
const ctx = cv.getContext('2d');
const stageEl = $('#stage');
let VW = 0, VH = 0, DPR = 1;
let drag = null;          // active pointer interaction
let draft = null;         // shape being created
let pathDraft = null;     // a path being drawn: its points, and with the pen tool their curve handles (ctl)
let marquee = null;
let spaceHeld = false;
let guideImg = null;
const toS = (x, y) => [x * ui.view.zoom + ui.view.x, y * ui.view.zoom + ui.view.y];
const toC = (sx, sy) => [(sx - ui.view.x) / ui.view.zoom, (sy - ui.view.y) / ui.view.zoom];
function snapV(v, e) { const g = project.settings.grid; return ui.snap && !(e && e.altKey) && g > 0 ? Math.round(v / g) * g : v; }
function resizeView() {
  const r = stageEl.getBoundingClientRect();
  DPR = window.devicePixelRatio || 1;
  VW = Math.max(1, r.width); VH = Math.max(1, r.height);
  let w = Math.round(VW * DPR), hh = Math.round(VH * DPR);
  // While a panel is dragged the canvas keeps its size, as large as the stage has been (the part past the stage is
  // cut off): a new size every step of the drag means a new canvas each time, which stalls the output
  if (stageHeld) { w = Math.max(w, cv.width); hh = Math.max(hh, cv.height); }
  if (cv.width === w && cv.height === hh) return keepFit();
  // A new size clears the canvas, and the next drawing may be a few frames away (it waits for the output's
  // time): the last picture is put back meanwhile, where it was, so the stage doesn't flash empty while a
  // panel is resized
  const old = cv.width > 1 && cv.height > 1 && SC ? stageCopy() : null;
  cv.width = w; cv.height = hh;
  if (stageHeld) { cv.style.width = w / DPR + 'px'; cv.style.height = hh / DPR + 'px'; }
  if (old && SC) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = SC.out; ctx.fillRect(0, 0, w, hh); ctx.drawImage(old, 0, 0); }
  keepFit();
}
// Holding the canvas's size while a panel is dragged: from the start it is as tall as the window, so the drag
// needn't make it bigger; when the drag ends it takes the stage's size again
let stageHeld = false;
function holdStage(on) {
  if (on === stageHeld) return;
  stageHeld = on;
  if (on) {
    const old = cv.width > 1 && cv.height > 1 && SC ? stageCopy() : null, r = stageEl.getBoundingClientRect();
    const w = Math.max(cv.width, Math.round(r.width * DPR)), hh = Math.max(cv.height, Math.round(innerHeight * DPR));
    if (w !== cv.width || hh !== cv.height) {
      cv.width = w; cv.height = hh;
      if (old) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = SC.out; ctx.fillRect(0, 0, w, hh); ctx.drawImage(old, 0, 0); }
    }
    cv.style.width = w / DPR + 'px'; cv.style.height = hh / DPR + 'px';
  } else {
    cv.style.width = cv.style.height = '';
    resizeView();
  }
  redrawStage();
}
// The stage's picture, copied before a resize clears it (one canvas, kept for the next time)
let stageKept = null;
function stageCopy() {
  if (!stageKept) stageKept = document.createElement('canvas');
  if (stageKept.width !== cv.width || stageKept.height !== cv.height) { stageKept.width = cv.width; stageKept.height = cv.height; }
  const k = stageKept.getContext('2d');
  k.clearRect(0, 0, cv.width, cv.height); k.drawImage(cv, 0, 0);
  return stageKept;
}
function keepFit() {
  if (!ui.fitted && VW > 50) { fitView(); ui.fitted = true; }
}
function fitView() {
  const W = project.settings.compW, H = project.settings.compH;
  const z = Math.min((VW - 90) / W, (VH - 50) / H);
  ui.view.zoom = clamp(z, 0.05, 40);
  ui.view.x = (VW - W * ui.view.zoom) / 2 + 22;
  ui.view.y = (VH - H * ui.view.zoom) / 2;
}
function zoomAt(sx, sy, factor) {
  const z0 = ui.view.zoom, z1 = clamp(z0 * factor, 0.05, 40);
  ui.view.x = sx - (sx - ui.view.x) * z1 / z0;
  ui.view.y = sy - (sy - ui.view.y) * z1 / z0;
  ui.view.zoom = z1;
}

/* ---------- drawing ---------- */
function outlinePath(f, c) {
  c.beginPath();
  if (f.type === 'line') { c.moveTo(...toS(f.x1, f.y1)); c.lineTo(...toS(f.x2, f.y2)); }
  else if (f.type === 'circle') {
    const [sx, sy] = toS(f.cx, f.cy), rx = f.r * ui.view.zoom, ry = ryOf(f) * ui.view.zoom, t = rad(ovalRot(f));
    if (f.sweep >= 359.99) c.ellipse(sx, sy, rx, ry, t, 0, Math.PI * 2);
    else { const a0 = rad(f.start - 90), a1 = rad(f.start - 90 + (f.ccw ? -f.sweep : f.sweep)); c.ellipse(sx, sy, rx, ry, t, a0, a1, !!f.ccw); }
  } else if (f.type === 'matrix') {
    matrixCorners(f).forEach((p, i) => (i ? c.lineTo : c.moveTo).call(c, ...toS(p[0], p[1])));
    c.closePath();
  } else if (f.type === 'path') {
    const P = pathPoly(f);
    for (let i = 0; i < P.length; i += 2) (i ? c.lineTo : c.moveTo).call(c, ...toS(P[i], P[i + 1]));
    if (f.closed) c.closePath();
  }
}
// How big a fixture's dots are on screen: about a third of the pixel pitch, at least 1.1 px so a sparse fixture far
// away stays visible, but never more than ~half the pitch, so dense pixels zoomed out make a thin line, not a thick band
function dotRadius(f, zoom = ui.view.zoom) {
  const s = f._pitch * zoom;
  return clamp(s * 0.36, clamp(s * 0.45, 0.6, 1.1), 10);
}
function drawDots(f, dispOverride) {
  const P = f._pts, n = f._n, D = dispOverride || f._disp, z = ui.view.zoom, ox = ui.view.x, oy = ui.view.y;
  const r = dotRadius(f), d = r * 2;
  // Below a pixel and a half across a dot can't look round anyway: squares are drawn, faster
  const small = r < 0.75, xmax = VW + 10, ymax = VH + 10;
  // Each dot shows what it sends, black when off, inside a thin grey ring that keeps the fixture easy to find on the
  // black stage; with the content shown strongly behind them, a dark rim outside that, so they stand out from it.
  // Rings and rims follow the dot's size, so small dots don't drown in them
  const e = clamp(r * 0.3, 0.5, 1.5), rims = [[SC.dotEdge, e]], blur = ctx.shadowBlur;
  ctx.shadowBlur = 0;
  if (ui.showContent && ui.contentOp > 0.4) rims.unshift(['rgba(0,0,0,0.8)', e + Math.min(1.5, r * 0.6)]);
  for (const [col, w] of rims) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const sx = P[2 * i] * z + ox, sy = P[2 * i + 1] * z + oy;
      if (sx < -10 || sy < -10 || sx > xmax || sy > ymax) continue;
      if (small) ctx.rect(sx - r - w, sy - r - w, d + 2 * w, d + 2 * w); else { ctx.moveTo(sx + r + w, sy); ctx.arc(sx, sy, r + w, 0, 6.2832); }
    }
    ctx.fill();
  }
  // Big projects draw tens of thousands of dots: dots of one colour in a row go in one path, filled when it changes
  let key = -2, open = false;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const sx = P[2 * i] * z + ox, sy = P[2 * i + 1] * z + oy;
    if (sx < -10 || sy < -10 || sx > xmax || sy > ymax) continue;
    const R = D ? D[j] : 0, G = D ? D[j + 1] : 0, B = D ? D[j + 2] : 0;
    const lit = R + G + B > 6, k = lit ? (R << 16) | (G << 8) | B : -1;
    if (k !== key) { if (open) { ctx.fill(); open = false; } key = k; ctx.fillStyle = lit ? `rgb(${R},${G},${B})` : SC.dot; }
    if (!open) { ctx.beginPath(); open = true; }
    if (small) ctx.rect(sx - r, sy - r, d, d); else { ctx.moveTo(sx + r, sy); ctx.arc(sx, sy, r, 0, 6.2832); }
  }
  if (open) ctx.fill();
  ctx.shadowBlur = blur;
  return r;
}
/* ---------- the pixels as a mask over the content ---------- */
// Drawing every pixel as its own circle in its own colour (drawDots) costs a separate fill per colour: thousands for
// moving content, and the browser draws them all on one thread, which also delays the output. Here the pixels'
// circles are drawn once into a mask, again only when the view, the layout or a dimmer changes; each frame the
// content is drawn through that mask, which costs the same however many pixels there are. A fixture's circles are as
// opaque as its level (its dimmer × its group's), the master and blackout dim the whole layer, a disabled fixture is
// left out. What the stage doesn't show (gamma and curves, trims, the white channel) is checked on the real LEDs.
const MASK_MIN_DOTS = 800;   // fewer pixels on screen than this: each drawn as its own dot, which is exact and cheap then
const MASK_SETTLE = 200;   // ms the view stays still before its layers are drawn again at the new zoom
const dotLayers = { base: null, mask: null, tmp: null, baseKey: '', levels: '', view: null, seen: '', movedAt: 0, timer: 0 };
function layerCanvas(name) {
  let c = dotLayers[name];
  if (!c) c = dotLayers[name] = document.createElement('canvas');
  if (c.width !== cv.width || c.height !== cv.height) { c.width = cv.width; c.height = cv.height; dotLayers.baseKey = ''; }
  return c;
}
// Draws the pixels masked when that's the way, and says whether it did
function dotsMasked() {
  if (!mixer.ok || ui.outputMode !== 'content') return false;
  const z = ui.view.zoom, ox = ui.view.x, oy = ui.view.y, xmax = VW + 10, ymax = VH + 10;
  let seen = 0;
  for (const f of project.fixtures) {
    const P = f._pts;
    for (let i = 0; i < f._n && seen < MASK_MIN_DOTS; i++) {
      const sx = P[2 * i] * z + ox, sy = P[2 * i + 1] * z + oy;
      if (sx >= -10 && sy >= -10 && sx <= xmax && sy <= ymax) seen++;
    }
    if (seen >= MASK_MIN_DOTS) break;
  }
  if (seen < MASK_MIN_DOTS) return false;
  const base = layerCanvas('base'), mask = layerCanvas('mask'), tmp = layerCanvas('tmp'), now = performance.now();
  const levels = new Map(project.groups.map(g => [g.id, groupLevel(g)]));
  const lv = f => (f.enabled ? clamp(numOr(f.dimmer, 1), 0, 1) * (f.group != null ? levels.get(f.group) ?? 1 : 1) : 0);
  const rimmed = ui.showContent && ui.contentOp > 0.4;
  const baseKey = [cv.width, cv.height, DPR, geomVersion, ui.theme, rimmed].join('|'), lvKey = project.fixtures.map(lv).join();
  // While the view moves (zoom, pan), the layers drawn for where it was are scaled to where it is, and drawn again
  // once it stays still: drawing them is the slow part, drawing them scaled is as cheap as one picture
  const view = `${z}|${ox}|${oy}`;
  if (view !== dotLayers.seen) { dotLayers.seen = view; dotLayers.movedAt = now; }
  const v0 = dotLayers.view, moving = now - dotLayers.movedAt < MASK_SETTLE;
  const stale = baseKey !== dotLayers.baseKey || !v0;
  if (stale || (!moving && (v0.z !== z || v0.ox !== ox || v0.oy !== oy))) {
    dotLayers.baseKey = baseKey; dotLayers.levels = ''; dotLayers.view = { z, ox, oy };
    drawDotLayer(base, false, z, ox, oy, lv, rimmed);
  } else if (moving && (v0.z !== z || v0.ox !== ox || v0.oy !== oy)) {
    clearTimeout(dotLayers.timer);
    dotLayers.timer = setTimeout(redrawStage, MASK_SETTLE + 20);
  }
  const at = dotLayers.view;
  if (lvKey !== dotLayers.levels) { dotLayers.levels = lvKey; drawDotLayer(mask, true, at.z, at.ox, at.oy, lv, rimmed); }
  // the layers as drawn for `at`, placed for the view now (device pixels)
  const s = z / at.z, place = x => x.setTransform(s, 0, 0, s, DPR * (ox - at.ox * s), DPR * (oy - at.oy * s));
  // each frame: the content, kept only inside the circles, over the rings and off dots
  const t = tmp.getContext('2d'), W = project.settings.compW, H = project.settings.compH;
  t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, tmp.width, tmp.height);
  t.setTransform(DPR, 0, 0, DPR, 0, 0); t.imageSmoothingEnabled = true;
  t.drawImage(mixer.canvas, ox, oy, W * z, H * z);
  place(t); t.globalCompositeOperation = 'destination-in'; t.drawImage(mask, 0, 0); t.globalCompositeOperation = 'source-over';
  ctx.save();
  place(ctx); ctx.shadowBlur = 0;
  ctx.drawImage(base, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = ui.blackout ? 0 : clamp(project.settings.master, 0, 1);
  if (ctx.globalAlpha > 0) ctx.drawImage(tmp, 0, 0);
  ctx.restore();
  return true;
}
// One of the two layers, for the view (z, ox, oy): the rings and the dark "off" dot under each pixel, or the mask,
// each fixture's circles as opaque as its level
function drawDotLayer(c, isMask, z, ox, oy, lv, rimmed) {
  const x = c.getContext('2d'), xmax = VW + 10, ymax = VH + 10;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.setTransform(DPR, 0, 0, DPR, 0, 0);
  const circles = (f, grow) => {
    const P = f._pts, r0 = dotRadius(f, z), r = r0 + grow, sq = r0 < 0.75;
    for (let i = 0; i < f._n; i++) {
      const sx = P[2 * i] * z + ox, sy = P[2 * i + 1] * z + oy;
      if (sx < -10 || sy < -10 || sx > xmax || sy > ymax) continue;
      if (sq) x.rect(sx - r, sy - r, 2 * r, 2 * r); else { x.moveTo(sx + r, sy); x.arc(sx, sy, r, 0, 6.2832); }
    }
  };
  if (isMask) {
    let alpha = -1;
    for (const f of project.fixtures) {
      const a = lv(f);
      if (a <= 0) continue;
      if (a !== alpha) { if (alpha >= 0) x.fill(); alpha = a; x.fillStyle = `rgba(255,255,255,${a})`; x.beginPath(); }
      circles(f, 0);
    }
    if (alpha >= 0) x.fill();
    return;
  }
  const edge = f => clamp(dotRadius(f, z) * 0.3, 0.5, 1.5);
  if (rimmed) { x.fillStyle = 'rgba(0,0,0,0.8)'; x.beginPath(); for (const f of project.fixtures) circles(f, edge(f) + Math.min(1.5, dotRadius(f, z) * 0.6)); x.fill(); }
  x.fillStyle = SC.dotEdge; x.beginPath(); for (const f of project.fixtures) circles(f, edge(f)); x.fill();
  x.fillStyle = SC.dot; x.beginPath(); for (const f of project.fixtures) circles(f, 0); x.fill();
}
function drawWiring(f, color) {
  const P = f._pts, n = f._n;
  if (n < 1) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.75;
  ctx.beginPath();
  for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...toS(P[2 * i], P[2 * i + 1]));
  ctx.stroke();
  ctx.globalAlpha = 1;
  const [x0, y0] = toS(P[0], P[1]);
  const r = dotRadius(f) + 4;
  ctx.beginPath(); ctx.arc(x0, y0, r, 0, 6.2832); ctx.strokeStyle = SC.first; ctx.lineWidth = 2; ctx.stroke();
  if (n > 1) { // direction arrow
    const [x1, y1] = toS(P[2], P[3]);
    const a = Math.atan2(y1 - y0, x1 - x0), L = r + 9;
    const ax = x0 + Math.cos(a) * L, ay = y0 + Math.sin(a) * L;
    ctx.beginPath(); ctx.moveTo(ax + Math.cos(a) * 5, ay + Math.sin(a) * 5);
    ctx.lineTo(ax + Math.cos(a + 2.5) * 5, ay + Math.sin(a + 2.5) * 5); ctx.lineTo(ax + Math.cos(a - 2.5) * 5, ay + Math.sin(a - 2.5) * 5);
    ctx.closePath(); ctx.fillStyle = SC.first; ctx.fill();
  }
  ctx.font = '600 10px ' + FONT_MONO;
  ctx.fillStyle = SC.first; ctx.fillText('1', x0 - r - 8, y0 - r);
  ctx.restore();
}
// With Wiring on: the data cable between fixtures chained on one output, from the last pixel of one to the
// first pixel of the next, as a thin dashed line
function drawDataLinks() {
  ctx.save();
  ctx.strokeStyle = withAlpha(SC.text, 0.55); ctx.fillStyle = withAlpha(SC.text, 0.7); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  for (const c of project.controllers) for (const chain of c.chains) {
    let prev = null;
    for (const id of chain) {
      const f = fxById(id);
      if (!f || !f._pts || !f._n) continue;
      if (prev) {
        const P = prev._pts, n = prev._n, [ax, ay] = toS(P[2 * n - 2], P[2 * n - 1]), [bx, by] = toS(f._pts[0], f._pts[1]);
        const d = Math.hypot(bx - ax, by - ay);
        if (d > 2) {
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          const a = Math.atan2(by - ay, bx - ax), mx = (ax + bx) / 2, my = (ay + by) / 2;   // which way the data runs
          ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * 4, my + Math.sin(a) * 4);
          ctx.lineTo(mx + Math.cos(a + 2.5) * 4, my + Math.sin(a + 2.5) * 4); ctx.lineTo(mx + Math.cos(a - 2.5) * 4, my + Math.sin(a - 2.5) * 4); ctx.fill();
        }
      }
      prev = f;
    }
  }
  ctx.restore();
}
function handlesOf(f) {
  if (f.type === 'line') return [{ id: 'p1', x: f.x1, y: f.y1 }, { id: 'p2', x: f.x2, y: f.y2 }];
  if (f.type === 'circle') return [];   // resized and turned with the frame around it (selHandles)
  if (f.type === 'matrix') {
    const hs = matrixCorners(f).map((p, i) => ({ id: 'k' + i, x: p[0], y: p[1] }));
    const up = 22 / ui.view.zoom, a = rad(f.rot);
    hs.push({ id: 'rot', x: f.cx + Math.sin(a) * (f.h / 2 + up), y: f.cy - Math.cos(a) * (f.h / 2 + up), round: true, rot: true });
    return hs;
  }
  const hs = [], H = f.ctl;
  for (let i = 0; i < f.pts.length; i += 2) hs.push({ id: 'v' + i / 2, x: f.pts[i], y: f.pts[i + 1] });
  // the curve handles of a pen path, drawn on top of its points
  if (H) for (let k = 0; k < f.pts.length / 2; k++) for (const [s, o] of [['i', 0], ['o', 2]]) {
    if (H[4 * k + o] || H[4 * k + o + 1]) hs.push({ id: s + k, x: f.pts[2 * k] + H[4 * k + o], y: f.pts[2 * k + 1] + H[4 * k + o + 1], round: true, ctl: true, ax: f.pts[2 * k], ay: f.pts[2 * k + 1] });
  }
  return hs;
}
function drawGrid() {
  const g = project.settings.grid, z = ui.view.zoom;
  if (!(g > 0)) return;
  let step = g;
  while (step * z < 8) step *= 5;
  const W = project.settings.compW, H = project.settings.compH;
  ctx.save();
  ctx.beginPath();
  for (let x = 0; x <= W; x += step) { const sx = Math.round(x * z + ui.view.x) + 0.5; ctx.moveTo(sx, ui.view.y); ctx.lineTo(sx, ui.view.y + H * z); }
  for (let y = 0; y <= H; y += step) { const sy = Math.round(y * z + ui.view.y) + 0.5; ctx.moveTo(ui.view.x, sy); ctx.lineTo(ui.view.x + W * z, sy); }
  ctx.strokeStyle = 'rgba(142,142,142,0.12)'; ctx.lineWidth = 1; ctx.stroke();   // over the black canvas in both looks
  ctx.restore();
}
function drawView() {
  stageLook();
  resizeView();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = SC.out; ctx.fillRect(0, 0, VW, VH);
  const W = project.settings.compW, H = project.settings.compH, z = ui.view.zoom;
  const [ox, oy] = [ui.view.x, ui.view.y];
  ctx.fillStyle = SC.canvas; ctx.fillRect(ox, oy, W * z, H * z);
  if (ui.showContent && mixer.ok) {
    ctx.globalAlpha = ui.contentOp; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mixer.canvas, ox, oy, W * z, H * z);
    ctx.globalAlpha = 1;
  }
  if (ui.showGrid) drawGrid();
  if (ui.showGuide && guideImg && guideImg.complete && guideImg.naturalWidth) {
    const iw = guideImg.naturalWidth, ih = guideImg.naturalHeight, s = Math.min(W / iw, H / ih);
    ctx.globalAlpha = ui.guideOp;
    ctx.drawImage(guideImg, ox + (W - iw * s) / 2 * z, oy + (H - ih * s) / 2 * z, iw * s * z, ih * s * z);
    ctx.globalAlpha = 1;
  }
  // In the white look, dark lines and names cross the black canvas: a light halo keeps them readable there
  ctx.shadowColor = SC.halo || 'transparent'; ctx.shadowBlur = SC.halo ? 3 : 0;
  if (ui.showZones || ui.tool === 'zone') drawZones();
  ctx.strokeStyle = SC.line2; ctx.lineWidth = 1; ctx.strokeRect(Math.round(ox) - 0.5, Math.round(oy) - 0.5, Math.round(W * z) + 1, Math.round(H * z) + 1);
  ctx.font = '10px ' + FONT_MONO; ctx.fillStyle = SC.muted; ctx.fillText(`${W} × ${H}`, ox, oy - 6);

  if (!project.fixtures.length || !project.fixtures[0]._pts) { drawOverlays(); ctx.shadowBlur = 0; return; }
  for (const f of project.fixtures) {
    const isSel = ui.sel.has(f.id), hov = ui.hoverFx === f.id, col = isSel ? SC.sel : fxTag(f) || SC.muted;   // its group's colour, or grey
    ctx.save();
    outlinePath(f, ctx);
    ctx.strokeStyle = col;
    ctx.globalAlpha = isSel ? 0.95 : hov ? 0.8 : f.enabled ? 0.35 : 0.2;
    ctx.lineWidth = isSel ? 1.5 : 1;
    if (!f.enabled) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }
  // The pixels: with many on screen, the content seen through their circles (dotsMasked); with few (zoomed in), or
  // while Highlight shows its patterns, each dot in the colour it sends
  if (!dotsMasked()) for (const f of project.fixtures) drawDots(f);
  for (const f of project.fixtures) {
    const isSel = ui.sel.has(f.id), hov = ui.hoverFx === f.id, col = isSel ? SC.sel : fxTag(f) || SC.muted;
    if (((isSel && ui.sel.size <= 6) || ui.showWiring) && f._n > 1) drawWiring(f, col);
    if (ui.showLabels && (z > 0.35 || isSel) && (!isSel || ui.sel.size <= 6 || hov)) {
      const b = fixtureBounds(f);
      const [lx, ly] = toS(b.x0, b.y0);
      // over the black canvas a name is light, as in the black look; outside it, in the white look, dark
      const onCanvas = lx >= ox && lx <= ox + W * z && ly - 7 >= oy && ly - 7 <= oy + H * z;
      ctx.save(); ctx.shadowBlur = 0;
      ctx.font = (isSel ? '600 ' : '500 ') + '11px ' + FONT_UI;
      ctx.fillStyle = isSel ? (onCanvas ? SC.canvasSel : SC.sel) : fxTag(f) || (onCanvas ? SC.canvasInk : SC.text2); ctx.globalAlpha = f.enabled ? 0.95 : 0.5;
      ctx.fillText(f.name + (f.locked ? '  (locked)' : ''), lx, ly - 7);
      ctx.restore();
    }
  }
  if (ui.showWiring) drawDataLinks();
  drawGroups();
  drawSelRotate();
  const sel = selected();
  if (sel.length === 1 && !sel[0].locked && ui.tool === 'select') {
    const f = sel[0];
    for (const hd of handlesOf(f)) {
      const [sx, sy] = toS(hd.x, hd.y);
      if (hd.ctl) { ctx.beginPath(); ctx.moveTo(...toS(hd.ax, hd.ay)); ctx.lineTo(sx, sy); ctx.strokeStyle = SC.sel; ctx.lineWidth = 1; ctx.stroke(); ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, 6.2832); ctx.fillStyle = SC.sel; ctx.fill(); continue; }
      if (hd.rot) { const a = rad(f.rot), e = toS(f.cx + Math.sin(a) * f.h / 2, f.cy - Math.cos(a) * f.h / 2); ctx.beginPath(); ctx.moveTo(...e); ctx.lineTo(sx, sy); ctx.strokeStyle = SC.sel; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.beginPath();
      if (hd.round) ctx.arc(sx, sy, 5, 0, 6.2832); else ctx.rect(sx - 4.5, sy - 4.5, 9, 9);
      ctx.fillStyle = hd.id === 'c' ? SC.sel : SC.handle; ctx.fill(); ctx.strokeStyle = SC.sel; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  drawOverlays();
  ctx.shadowBlur = 0;
}
// The corners of a frame on screen, padded by pad pixels
function frameCorners(F, pad) {
  const z = ui.view.zoom, hw = F.w / 2 + pad / z, hh = F.h / 2 + pad / z;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toS(...frameAt(F, a * hw, b * hh)));
}
function drawSelRotate() {
  const hs = selHandles();
  if (!hs.length) return;
  const list = rotatable();
  ctx.save();
  ctx.strokeStyle = SC.sel; ctx.lineWidth = 1;
  if ((list.length > 1 || framed(list[0])) && !wholeGroup(list)) {   // a group draws its own frame
    ctx.globalAlpha = 0.8; ctx.setLineDash([4, 3]);
    ctx.beginPath(); frameCorners(selFrame(list), 10).forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...p)); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  for (const hd of hs) {
    const [sx, sy] = toS(hd.x, hd.y);
    if (hd.selscale) { ctx.beginPath(); ctx.rect(sx - 4, sy - 4, 8, 8); ctx.fillStyle = SC.handle; ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke(); continue; }
    const [bx, by] = toS(hd.bx, hd.by);
    if (drag && drag.kind === 'rotsel') {   // the pivot, and the angle so far
      const [px, py] = toS(drag.px, drag.py);
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px - 6, py); ctx.lineTo(px + 6, py); ctx.moveTo(px, py - 6); ctx.lineTo(px, py + 6); ctx.stroke();
      ctx.font = '600 11px ' + FONT_MONO; ctx.fillStyle = SC.sel;
      ctx.fillText((drag.deg > 0 ? '+' : '') + Math.round(drag.deg) + '°', sx + 12, sy + 4);
    }
    const L = Math.hypot(sx - bx, sy - by) || 1;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(sx - (sx - bx) / L * 6, sy - (sy - by) / L * 6); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 6.2832); ctx.fillStyle = SC.handle; ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 3, -0.4, 4.4); ctx.lineWidth = 1.2; ctx.stroke();   // a small turning arrow
  }
  if (drag && drag.kind === 'scalesel') {
    const F = selFrame(list), [lx, ly] = frameCorners(F, 10)[2];
    ctx.font = '600 11px ' + FONT_MONO; ctx.fillStyle = SC.sel;
    ctx.fillText(`${fmtV(F.w)} × ${fmtV(F.h)}`, lx + 10, ly + 14);
  }
  ctx.restore();
}
// A selected group gets a frame around its fixtures with its name under it. A group with only some of its
// fixtures selected, or with one under the pointer, gets a fainter dashed frame.
function drawGroups() {
  if (!project.groups.length || ui.tool !== 'select') return;
  const hov = ui.hoverFx != null ? fxById(ui.hoverFx) : null, hovG = ui.hoverGroup != null ? ui.hoverGroup : hov && hov.group;
  if (!ui.sel.size && hovG == null) return;
  const info = new Map();   // group id → its fixtures and how many of them are selected
  for (const f of project.fixtures) {
    if (f.group == null) continue;
    let a = info.get(f.group);
    if (!a) info.set(f.group, a = { list: [], sel: 0 });
    a.list.push(f);
    if (ui.sel.has(f.id)) a.sel++;
  }
  for (const g of project.groups) {
    const a = info.get(g.id);
    if (!a || (!a.sel && g.id !== hovG)) continue;
    const whole = a.sel === a.list.length;
    // the frame turns with the group (see rotateSel), so it keeps hugging its fixtures
    const C = frameCorners(frameOf(a.list, numOr(g.rot, 0)), 10);
    ctx.save();
    ctx.strokeStyle = SC.sel; ctx.lineWidth = 1;
    ctx.globalAlpha = whole ? 0.9 : 0.5; ctx.setLineDash(whole ? [] : [4, 3]);
    ctx.beginPath(); C.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, p[0], p[1])); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.font = '600 11px ' + FONT_UI;
    const t = groupName(g), lw = Math.round(ctx.measureText(t).width + 30);
    const lx = Math.round((C[0][0] + C[1][0] + C[2][0] + C[3][0]) / 4 - lw / 2), ly = Math.round(Math.max(...C.map(p => p[1])) + 5);
    ctx.beginPath(); ctx.rect(lx, ly, lw, 18);
    if (whole) { ctx.fillStyle = SC.sel; ctx.fill(); } else { ctx.fillStyle = withAlpha(SC.bg1, 0.85); ctx.fill(); ctx.strokeStyle = withAlpha(SC.sel, 0.6); ctx.stroke(); }
    // a small folder, as in the list
    ctx.beginPath(); ctx.moveTo(lx + 7, ly + 5.5); ctx.lineTo(lx + 10.5, ly + 5.5); ctx.lineTo(lx + 12, ly + 7); ctx.lineTo(lx + 18, ly + 7); ctx.lineTo(lx + 18, ly + 13.5); ctx.lineTo(lx + 7, ly + 13.5); ctx.closePath();
    ctx.strokeStyle = whole ? SC.selInk : SC.sel; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = whole ? SC.selInk : SC.sel; ctx.fillText(t, lx + 23, ly + 13);
    ctx.restore();
  }
}
function drawOverlays() {
  if (ui.tool === 'zone') drawZoneEdit();
  const pk = ui.outputMode === 'pixel' && ui.pickPx && fxById(ui.pickPx.fid);
  if (pk && pk._pts && ui.pickPx.i < pk._n) {
    const [sx, sy] = toS(pk._pts[2 * ui.pickPx.i], pk._pts[2 * ui.pickPx.i + 1]);
    ctx.save(); ctx.strokeStyle = SC.pick; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (draft) {
    prepDraft(draft);
    ctx.save(); ctx.setLineDash([5, 4]); outlinePath(draft, ctx); ctx.strokeStyle = SC.sel; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
    drawDots(draft, null);
  }
  if (pathDraft && pathDraft.pts.length) {
    ctx.save(); ctx.beginPath();
    const d = pathDraft, P = d.pts, c = d.cursor;
    // the path so far, and on to the pointer
    const line = pathPoly({ pts: c ? P.concat(c) : P, ctl: d.pen ? (c ? d.ctl.concat(0, 0, 0, 0) : d.ctl) : null, closed: false });
    for (let i = 0; i < line.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...toS(line[i], line[i + 1]));
    ctx.strokeStyle = SC.sel; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke();
    ctx.setLineDash([]);
    if (d.pen) { // the handles of the last point
      const k = P.length / 2 - 1, [ax, ay] = toS(P[2 * k], P[2 * k + 1]);
      for (const o of [0, 2]) {
        const hx = d.ctl[4 * k + o], hy = d.ctl[4 * k + o + 1];
        if (!hx && !hy) continue;
        const [sx, sy] = toS(P[2 * k] + hx, P[2 * k + 1] + hy);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(sx, sy); ctx.strokeStyle = SC.sel; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, 6.2832); ctx.fillStyle = SC.sel; ctx.fill();
      }
    }
    for (let i = 0; i < P.length; i += 2) { const [sx, sy] = toS(P[i], P[i + 1]); ctx.fillStyle = SC.text; ctx.fillRect(sx - 3.5, sy - 3.5, 7, 7); }
    ctx.restore();
  }
  if (marquee) {
    const [a, b] = [toS(marquee.x0, marquee.y0), toS(marquee.x1, marquee.y1)];
    ctx.fillStyle = withAlpha(SC.sel, 0.08); ctx.strokeStyle = withAlpha(SC.sel, 0.7); ctx.lineWidth = 1;
    ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    ctx.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  }
}
function prepDraft(d) { d._pts = computePoints(d); d._n = pixelCount(d); d._pitch = fixturePitch(d); }
// The stage's fonts and colours are the page's (css/app.css), read once and again when the look changes (setTheme).
// The canvas stays black in both looks (it shows light); in the white look the stage around it is white.
let FONT_MONO = null, FONT_UI = null, SC = null;
function stageLook(again = false) {
  if (SC && !again) return;
  const cs = getComputedStyle(stageEl), v = n => cs.getPropertyValue(n).trim();
  FONT_MONO = v('--mono'); FONT_UI = v('--ui');
  SC = { sel: v('--sel'), selInk: v('--sel-ink'), first: v('--danger'), pick: v('--warn'), text: v('--text'), text2: v('--text2'), muted: v('--muted'),
    line2: v('--line2'), bg0: v('--bg0'), bg1: v('--bg1'), canvas: v('--canvas'), dot: v('--dot'), dotEdge: v('--dot-edge'), handle: v('--bg1'),
    out: v('--stage-out'), halo: v('--stage-halo') === 'none' ? '' : v('--stage-halo'), canvasInk: v('--canvas-ink'), canvasSel: v('--canvas-sel') };
}
// #rrggbb at an opacity
const withAlpha = (c, a) => /^#[0-9a-f]{6}$/i.test(c) ? `rgba(${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)},${a})` : c;

/* ---------- zones on the stage ---------- */
let zoneDraft = null, zoneLabels = [];
const ZONE_CURSORS = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };
function zoneHandlePoints(z) {
  const x0 = z.x, y0 = z.y, x1 = z.x + z.w, y1 = z.y + z.h, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  return { nw: [x0, y0], n: [xm, y0], ne: [x1, y0], e: [x1, ym], se: [x1, y1], s: [xm, y1], sw: [x0, y1], w: [x0, ym] };
}
function drawZones() {
  const sel = selZone(), editing = ui.tool === 'zone', zm = ui.view.zoom;
  zoneLabels = [];
  ctx.save();
  project.zones.forEach((z, i) => {
    const [sx, sy] = toS(z.x, z.y), on = editing && z === sel;
    ctx.setLineDash(on ? [] : [6, 4]);
    ctx.lineWidth = on ? 1.5 : 1.2;
    ctx.strokeStyle = on ? SC.sel : z.tag || SC.muted;
    ctx.globalAlpha = editing ? 1 : 0.8;
    ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.max(1, Math.round(z.w * zm) - 1), Math.max(1, Math.round(z.h * zm) - 1));
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // label: name, and what covers it or its opacity
    const over = zoneAbove(i);
    const extra = over ? `under ${over.name} ${pct(over.opacity)}` : z.opacity < 1 ? pct(z.opacity) : '';
    ctx.font = '600 11px ' + FONT_UI; const nw = ctx.measureText(z.name).width;
    ctx.font = '400 11px ' + FONT_UI; const ew = extra ? ctx.measureText(extra).width + 6 : 0;
    const lx = Math.round(sx), ly = z.y * zm >= 22 ? Math.round(sy) - 21 : Math.round(sy) + 5, lw = Math.round(nw + ew + 14);
    ctx.fillStyle = withAlpha(SC.bg1, 0.85); ctx.fillRect(lx, ly, lw, 18);
    ctx.strokeStyle = on ? SC.sel : z.tag || SC.muted; ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, ly + 0.5, lw - 1, 17);
    ctx.font = '600 11px ' + FONT_UI; ctx.fillStyle = z.tag || SC.text2; ctx.fillText(z.name, lx + 7, ly + 13);
    if (extra) { ctx.font = '400 11px ' + FONT_UI; ctx.fillStyle = SC.text2; ctx.fillText(extra, lx + 13 + nw, ly + 13); }
    zoneLabels.push({ z, x: lx, y: ly, w: lw, h: 18 });
  });
  ctx.restore();
}
function drawZoneEdit() {
  const z = selZone();
  ctx.save();
  if (z) for (const [x, y] of Object.values(zoneHandlePoints(z))) {
    const [sx, sy] = toS(x, y);
    ctx.fillStyle = SC.handle; ctx.fillRect(sx - 4.5, sy - 4.5, 9, 9);
    ctx.strokeStyle = SC.sel; ctx.lineWidth = 1.5; ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9);
  }
  if (zoneDraft) {
    const [sx, sy] = toS(zoneDraft.x, zoneDraft.y), w = zoneDraft.w * ui.view.zoom, hh = zoneDraft.h * ui.view.zoom;
    ctx.fillStyle = withAlpha(SC.sel, 0.08); ctx.fillRect(sx, sy, w, hh);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = SC.sel; ctx.lineWidth = 1.2; ctx.strokeRect(sx + 0.5, sy + 0.5, w, hh); ctx.setLineDash([]);
    ctx.font = '10px ' + FONT_MONO; ctx.fillStyle = SC.sel;
    ctx.fillText(`${Math.round(zoneDraft.w)} × ${Math.round(zoneDraft.h)}`, sx, sy - 6);
  }
  ctx.restore();
}
function hitZoneHandle(sx, sy) {
  const z = selZone();
  if (!z) return null;
  for (const [k, [x, y]] of Object.entries(zoneHandlePoints(z))) { const [hx, hy] = toS(x, y); if (Math.abs(sx - hx) <= 6 && Math.abs(sy - hy) <= 6) return k; }
  return null;
}
function hitZoneLabel(sx, sy) {
  for (let i = zoneLabels.length - 1; i >= 0; i--) { const l = zoneLabels[i]; if (sx >= l.x && sx <= l.x + l.w && sy >= l.y && sy <= l.y + l.h) return l.z; }
  return null;
}
// The smallest zone under the point, so zones under a big one stay reachable
function hitZone(x, y) {
  let best = null;
  for (const z of project.zones) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h && (!best || z.w * z.h < best.w * best.h)) best = z;
  return best;
}
function resizeZone(z, o, hd, x, y) {
  let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
  if (hd.includes('w')) x0 = Math.min(x, x1 - 4);
  if (hd.includes('e')) x1 = Math.max(x, x0 + 4);
  if (hd.includes('n')) y0 = Math.min(y, y1 - 4);
  if (hd.includes('s')) y1 = Math.max(y, y0 + 4);
  const W = project.settings.compW, H = project.settings.compH;
  x0 = clamp(x0, 0, W); x1 = clamp(x1, 0, W); y0 = clamp(y0, 0, H); y1 = clamp(y1, 0, H);
  Object.assign(z, { x: Math.round(x0), y: Math.round(y0), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(y1 - y0)) });
}
const rectOf = (x0, y0, x1, y1) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });

/* ---------- hit testing ---------- */
function hitFixture(x, y) {
  const tol = 7 / ui.view.zoom;
  let best = null, bd = Infinity;
  for (let i = project.fixtures.length - 1; i >= 0; i--) {
    const f = project.fixtures[i];
    if (f.locked) continue;
    const d = distFixture(f, x, y, tol);
    if (d < tol && d < bd) { best = f; bd = d; }
  }
  return best;
}
// Handles of the frame around the selection: eight on the frame to resize and a round one above it to turn, all
// turning with the frame. Several fixtures (or a whole group) get them, and so does one circle, oval or path
// (a path keeps its point handles too). A matrix has its own; a line resizes and turns by its ends.
function selHandles() {
  if (ui.tool !== 'select') return [];
  const list = rotatable();
  if (!list.length || (list.length === 1 && (list[0].type === 'matrix' || list[0].type === 'line'))) return [];
  const F = selFrame(list), z = ui.view.zoom, pad = 10 / z, hw = F.w / 2 + pad, hh = F.h / 2 + pad, hs = [];
  if (list.length > 1 || framed(list[0])) [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].forEach(([gx, gy], k) => {
    if ((gx && F.w < 1e-6) || (gy && F.h < 1e-6)) return;   // nothing to stretch that way (fixtures in one line)
    const [x, y] = frameAt(F, gx * hw, gy * hh);
    hs.push({ id: 'ss' + k, selscale: true, gx, gy, x, y });
  });
  const [x, y] = frameAt(F, 0, -hh - 26 / z), [bx, by] = frameAt(F, 0, -hh);
  hs.push({ id: 'selrot', selrot: true, rot: true, x, y, bx, by });
  return hs;
}
// The cursor for a frame handle: the resize arrows nearest to its direction, turned with the frame
function selCursor(hd) {
  const a = ((Math.atan2(hd.gy, hd.gx) * 180 / Math.PI + selAngle(rotatable()) + 360) % 180), k = Math.round(a / 45) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][k];
}
function hitHandle(sx, sy) {
  if (!drag) for (const hd of selHandles().reverse()) { const [hx, hy] = toS(hd.x, hd.y); if (Math.abs(hx - sx) <= 7 && Math.abs(hy - sy) <= 7) return hd; }
  const sel = selected();
  if (sel.length !== 1 || sel[0].locked) return null;
  for (const hd of handlesOf(sel[0]).reverse()) { const [hx, hy] = toS(hd.x, hd.y); if (Math.abs(hx - sx) <= 7 && Math.abs(hy - sy) <= 7) return hd; }
  return null;
}
function hoverPixel(x, y) {
  const tol = 8 / ui.view.zoom;
  let best = null, bd = tol * tol; // squared distances: this runs on each pointer move
  for (const f of project.fixtures) {
    const P = f._pts; if (!P) continue;
    // only fixtures whose pixels come near the pointer are looked through (their frame, kept with their points)
    if (f._pbOf !== P) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < f._n; i++) { const px = P[2 * i], py = P[2 * i + 1]; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
      f._pb = [x0, y0, x1, y1]; f._pbOf = P;
    }
    const b = f._pb;
    if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
    for (let i = 0; i < f._n; i++) { const dx = P[2 * i] - x, dy = P[2 * i + 1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = { f, i }; } }
  }
  return best;
}

/* ---------- geometry edits ---------- */
function dragHandle(f, o, hd, x, y, e) {
  if (f.type === 'line') {
    const [ox, oy] = hd.id === 'p1' ? [o.x2, o.y2] : [o.x1, o.y1];
    let px = snapV(x, e), py = snapV(y, e);
    if (e.shiftKey) [px, py] = snap45(ox, oy, x, y);
    if (hd.id === 'p1') { f.x1 = px; f.y1 = py; } else { f.x2 = px; f.y2 = py; }
  } else if (f.type === 'circle') {
    const t = rad(ovalRot(f)), lx = (x - f.cx) * Math.cos(t) + (y - f.cy) * Math.sin(t), ly = -(x - f.cx) * Math.sin(t) + (y - f.cy) * Math.cos(t);   // along its own axes
    if (hd.id === 'c') { f.cx = snapV(x, e); f.cy = snapV(y, e); }
    else if (hd.id === 'ry') f.ry = Math.max(1, snapV(Math.abs(ly), e));   // the top handle stretches it into an oval
    else if (isOval(f)) f.r = Math.max(1, snapV(Math.abs(lx), e));        // an oval's side handle: its width only
    else f.r = Math.max(1, snapV(Math.hypot(x - f.cx, y - f.cy), e));
  } else if (f.type === 'matrix') {
    if (hd.rot) {
      let a = Math.atan2(y - o.cy, x - o.cx) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      f.rot = wrap180(a);
    } else {
      const k = +hd.id[1], sgn = [[-1, -1], [1, -1], [1, 1], [-1, 1]][k];
      const c = Math.cos(rad(o.rot)), s = Math.sin(rad(o.rot));
      const Ox = o.cx - (sgn[0] * o.w / 2) * c + (sgn[1] * o.h / 2) * s, Oy = o.cy - (sgn[0] * o.w / 2) * s - (sgn[1] * o.h / 2) * c;
      const px = o.rot === 0 ? snapV(x, e) : x, py = o.rot === 0 ? snapV(y, e) : y;
      const vx = px - Ox, vy = py - Oy;
      const lx = vx * c + vy * s, ly = -vx * s + vy * c;
      f.w = Math.max(2, sgn[0] * lx); f.h = Math.max(2, sgn[1] * ly);
      if (e.shiftKey) { const m = Math.max(f.w, f.h); f.w = f.h = m; }
      f.cx = Ox + (sgn[0] * f.w / 2) * c - (sgn[1] * f.h / 2) * s; f.cy = Oy + (sgn[0] * f.w / 2) * s + (sgn[1] * f.h / 2) * c;
    }
  } else if (f.type === 'path') {
    const i = +hd.id.slice(1);
    if (hd.ctl) {   // a curve handle; the other handle of the point turns with it (a smooth point), unless Alt is held
      const o = hd.id[0] === 'o' ? 2 : 0, q = 2 - o, H = f.ctl, dx = x - f.pts[2 * i], dy = y - f.pts[2 * i + 1];
      H[4 * i + o] = dx; H[4 * i + o + 1] = dy;
      const L = Math.hypot(H[4 * i + q], H[4 * i + q + 1]), d = Math.hypot(dx, dy);
      if (!e.altKey && L > 0 && d > 0) { H[4 * i + q] = -dx / d * L; H[4 * i + q + 1] = -dy / d * L; }
    } else { f.pts[2 * i] = snapV(x, e); f.pts[2 * i + 1] = snapV(y, e); }
  }
  markGeom();
}
function draftFrom(type, x0, y0, x1, y1, e) {
  const d = newFixture(type);
  if (type === 'line') Object.assign(d, { x1: x0, y1: y0, x2: x1, y2: y1, pixels: Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 10) + 1) });
  if (type === 'circle') { const r = Math.max(4, Math.hypot(x1 - x0, y1 - y0)); Object.assign(d, { cx: x0, cy: y0, r, pixels: Math.max(3, Math.round(2 * Math.PI * r / 10)) }); }
  if (type === 'matrix') {
    let w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
    if (e && e.shiftKey) w = hh = Math.max(w, hh);
    Object.assign(d, { cx: x0 + Math.sign(x1 - x0 || 1) * w / 2, cy: y0 + Math.sign(y1 - y0 || 1) * hh / 2, w: Math.max(2, w), h: Math.max(2, hh), cols: Math.max(1, Math.round(w / 10)), rows: Math.max(1, Math.round(hh / 10)) });
  }
  return d;
}
// A fixture of the default size centred on x, y: a line 200 long, a circle of radius 60, a 160 × 160 matrix
function defaultFixtureAt(type, x, y) {
  return type === 'line' ? draftFrom('line', x - 100, y, x + 100, y) : type === 'circle' ? draftFrom('circle', x, y, x + 60, y) : draftFrom('matrix', x - 80, y - 80, x + 80, y + 80);
}

/* ---------- pointer ---------- */
function evPos(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  cv.focus({ preventScroll: true });
  const [sx, sy] = evPos(e), [x, y] = toC(sx, sy);
  cv.setPointerCapture(e.pointerId);
  if (e.button === 1 || e.button === 2 || spaceHeld) { drag = { kind: 'pan', sx, sy, vx: ui.view.x, vy: ui.view.y, button: e.button, space: spaceHeld }; cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (ui.outputMode === 'pixel' && !spaceHeld) { const hp = hoverPixel(x, y); if (hp) { pickPixel(hp.f, hp.i); return; } }
  if (mappingLocked()) {   // an operator selects to look; nothing moves
    const f = hitFixture(x, y);
    if (f) ui.sel = new Set(stagePick(f)); else ui.sel.clear();
    onSelection();
    return;
  }
  const tool = ui.tool;
  if (tool === 'zone') {
    // handles resize the selected zone, a label moves its zone, a drag anywhere else draws a new zone, a click selects
    const hd = hitZoneHandle(sx, sy), sz = selZone();
    if (hd) { drag = { kind: 'zoneSize', z: sz, hd, o: { x: sz.x, y: sz.y, w: sz.w, h: sz.h }, changed: false }; return; }
    const lz = hitZoneLabel(sx, sy);
    if (lz) { if (ui.zone !== lz.id) selectZone(lz); drag = { kind: 'zoneMove', z: lz, x0: x, y0: y, o: { x: lz.x, y: lz.y }, changed: false }; return; }
    drag = { kind: 'zoneNew', x0: snapV(x, e), y0: snapV(y, e), sx, sy, pick: hitZone(x, y) };
    return;
  }
  if (tool === 'line' || tool === 'circle' || tool === 'matrix') {
    const px = snapV(x, e), py = snapV(y, e);
    drag = { kind: 'create', type: tool, x0: px, y0: py, moved: false };
    draft = draftFrom(tool, px, py, px, py, e);
    return;
  }
  if (tool === 'path' || tool === 'pen') {
    if (!pathDraft) pathDraft = { pts: [], ctl: [], pen: tool === 'pen' };
    if (e.detail >= 2 && pathDraft.pts.length >= 4) { finishPath(); return; }
    if (pathDraft.pen && pathDraft.pts.length >= 4) { // a click on the first point closes the path
      const [fx, fy] = toS(pathDraft.pts[0], pathDraft.pts[1]);
      if (Math.hypot(sx - fx, sy - fy) <= 8) { pathDraft.closed = true; finishPath(); return; }
    }
    pathDraft.pts.push(snapV(x, e), snapV(y, e)); pathDraft.ctl.push(0, 0, 0, 0);
    if (pathDraft.pen) drag = { kind: 'pen', k: pathDraft.pts.length / 2 - 1, sx, sy };   // dragging pulls out its handles
    return;
  }
  const hd = hitHandle(sx, sy);
  if (hd && hd.selrot) {
    const list = rotatable(), F = selFrame(list);
    drag = { kind: 'rotsel', list, origs: new Map(list.map(f => [f.id, snapshotGeom(f)])), px: F.cx, py: F.cy, fa: selAngle(list), a0: Math.atan2(y - F.cy, x - F.cx), deg: 0, changed: false };
    cv.style.cursor = 'grabbing';
    return;
  }
  if (hd && hd.selscale) {
    const list = rotatable(), F = selFrame(list);
    drag = { kind: 'scalesel', list, origs: new Map(list.map(f => [f.id, snapshotGeom(f)])), F, gx: hd.gx, gy: hd.gy, changed: false };
    return;
  }
  if (hd) { const f = selected()[0]; drag = { kind: 'handle', f, hd, o: snapshotGeom(f), changed: false }; return; }
  const f = hitFixture(x, y);
  if (f) {
    const pick = stagePick(f);   // the whole group, or inside a group just this fixture
    const had = ui.sel.size;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      if (ui.sel.has(f.id)) { pick.forEach(id => ui.sel.delete(id)); onSelection(); return; }
      pick.forEach(id => ui.sel.add(id));
    } else if (!ui.sel.has(f.id)) ui.sel = new Set(pick);
    // a press on what is already selected starts a drag: the lists and the Inspector stay as they are (a few hundred
    // fixtures take long to draw), the Inspector only comes forward from another tab
    if (ui.sel.size !== had || !ui.sel.has(f.id) || pick.some(id => !ui.sel.has(id)) || e.shiftKey || e.metaKey || e.ctrlKey) onSelection();
    else if (ui.rightTab !== 'inspector') onSelection();
    const origs = new Map(selected().filter(g => !g.locked).map(g => [g.id, snapshotGeom(g)]));
    drag = { kind: 'move', x0: x, y0: y, origs, changed: false };
    return;
  }
  if (!(e.shiftKey || e.metaKey || e.ctrlKey)) { if (ui.sel.size) { ui.sel.clear(); onSelection(); } }
  drag = { kind: 'marquee', base: new Set(ui.sel) };
  marquee = { x0: x, y0: y, x1: x, y1: y };
});
cv.addEventListener('pointermove', e => {
  const [sx, sy] = evPos(e), [x, y] = toC(sx, sy);
  ui.cursor = [x, y];
  if (!drag) {
    const was = [ui.hoverFx, ui.hoverPx && ui.hoverPx.f, ui.hoverPx && ui.hoverPx.i];
    if (pathDraft) { pathDraft.cursor = [snapV(x, e), snapV(y, e)]; redrawStage(); }
    if (ui.tool === 'zone' && !spaceHeld) {
      const hd = hitZoneHandle(sx, sy);
      cv.style.cursor = hd ? ZONE_CURSORS[hd] : hitZoneLabel(sx, sy) ? 'move' : 'crosshair';
    } else if (ui.tool === 'select' && !spaceHeld) {
      const hd = hitHandle(sx, sy);
      const f = hd ? null : hitFixture(x, y);
      ui.hoverFx = f ? f.id : null;
      cv.style.cursor = hd ? (hd.rot ? 'grab' : hd.selscale ? selCursor(hd) : 'crosshair') : f ? 'move' : 'default';
    } else cv.style.cursor = spaceHeld ? 'grab' : 'crosshair';
    ui.hoverPx = hoverPixel(x, y);
    if (was[0] !== ui.hoverFx || was[1] !== (ui.hoverPx && ui.hoverPx.f) || was[2] !== (ui.hoverPx && ui.hoverPx.i)) redrawStage();
    return;
  }
  if (drag.kind === 'pen') {   // a point just added with the pen: dragging pulls out its two handles, in line
    const d = pathDraft, k = drag.k;
    if (d && Math.hypot(sx - drag.sx, sy - drag.sy) > 3) { const ox = x - d.pts[2 * k], oy = y - d.pts[2 * k + 1]; d.ctl.splice(4 * k, 4, -ox, -oy, ox, oy); }
    if (d) d.cursor = null;
    return;
  }
  if (drag.kind === 'pan') { ui.view.x = drag.vx + sx - drag.sx; ui.view.y = drag.vy + sy - drag.sy; return; }
  if (drag.kind === 'zoneMove') { Object.assign(drag.z, { x: drag.o.x + snapV(x - drag.x0, e), y: drag.o.y + snapV(y - drag.y0, e) }); clampZone(drag.z); drag.changed = true; syncInspector(); return; }
  if (drag.kind === 'zoneSize') { resizeZone(drag.z, drag.o, drag.hd, snapV(x, e), snapV(y, e)); drag.changed = true; syncInspector(); return; }
  if (drag.kind === 'zoneNew') { if (zoneDraft || Math.hypot(sx - drag.sx, sy - drag.sy) > 4) zoneDraft = rectOf(drag.x0, drag.y0, snapV(x, e), snapV(y, e)); return; }
  if (drag.kind === 'create') {
    drag.moved = drag.moved || Math.hypot(x - drag.x0, y - drag.y0) * ui.view.zoom > 4;
    let px = snapV(x, e), py = snapV(y, e);
    if (drag.type === 'line' && e.shiftKey) [px, py] = snap45(drag.x0, drag.y0, x, y);
    draft = draftFrom(drag.type, drag.x0, drag.y0, px, py, e);
    return;
  }
  if (drag.kind === 'handle') { dragHandle(drag.f, drag.o, drag.hd, x, y, e); drag.changed = true; syncInspector(); return; }
  if (drag.kind === 'rotsel') {   // Shift: in steps of 15°
    let deg = (Math.atan2(y - drag.py, x - drag.px) - drag.a0) * 180 / Math.PI;
    deg = wrap180(deg);
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    drag.deg = deg;
    for (const [id, o] of drag.origs) { const f = fxById(id); if (f) rotateFixture(f, o, drag.px, drag.py, deg); }
    setSelAngle(drag.list, drag.fa + deg);
    drag.changed = true; markGeom(); syncInspector();
    return;
  }
  if (drag.kind === 'scalesel') {   // from the opposite side of the frame; Shift keeps the proportions
    const { F, gx, gy } = drag, t = rad(F.angle), dx = x - F.cx, dy = y - F.cy;
    const u = dx * Math.cos(t) + dy * Math.sin(t), v = -dx * Math.sin(t) + dy * Math.cos(t), pad = 10 / ui.view.zoom;
    const ax = -gx * F.w / 2, ay = -gy * F.h / 2;
    let sx = gx ? Math.max(0.01, ((u - ax) * gx - pad) / F.w) : 1, sy = gy ? Math.max(0.01, ((v - ay) * gy - pad) / F.h) : 1;
    if (e.shiftKey) { const k = !gy ? sx : !gx ? sy : Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy; sx = sy = k; }
    drag.sx = sx; drag.sy = sy;
    for (const [id, o] of drag.origs) { const f = fxById(id); if (f) scaleFixture(f, o, F, ax, ay, sx, sy); }
    drag.changed = true; markGeom(); syncInspector();
    return;
  }
  if (drag.kind === 'move') {
    let dx = x - drag.x0, dy = y - drag.y0;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    dx = snapV(dx, e); dy = snapV(dy, e);
    for (const [id, o] of drag.origs) { const f = fxById(id); if (f) moveFixture(f, o, dx, dy); }
    drag.changed = drag.changed || dx !== 0 || dy !== 0;
    markGeom(); syncInspector();
    return;
  }
  if (drag.kind === 'marquee') {
    marquee.x1 = x; marquee.y1 = y;
    const r = { x0: Math.min(marquee.x0, x), y0: Math.min(marquee.y0, y), x1: Math.max(marquee.x0, x), y1: Math.max(marquee.y0, y) };
    const s = new Set(drag.base), groups = new Set();
    for (const f of project.fixtures) {
      if (f.locked) continue;
      const b = fixtureBounds(f);
      if (b.x1 >= r.x0 && b.x0 <= r.x1 && b.y1 >= r.y0 && b.y0 <= r.y1) { s.add(f.id); if (f.group != null) groups.add(f.group); }
    }
    if (groups.size) for (const f of project.fixtures) if (groups.has(f.group)) s.add(f.id);   // groups are taken whole
    ui.sel = s;
  }
});
function endDrag(e) {
  if (!drag) return;
  const d = drag; drag = null;
  cv.style.cursor = '';
  if (d.kind === 'create') {
    let f = draft; draft = null;
    if (!d.moved) { // click without drag: default size centred on the click
      const x = d.x0, y = d.y0;
      f = defaultFixtureAt(d.type, x, y);
    }
    f.name = nextName(f.type);
    addFixture(f);
    setTool('select');
    toast(`${f.name} added: ${pixelCount(f)} pixels`);
  } else if (d.kind === 'handle' || d.kind === 'move' || d.kind === 'rotsel' || d.kind === 'scalesel' || d.kind === 'zoneMove' || d.kind === 'zoneSize') {
    // fixtures moved, turned or resized: the fixture list and the dock show nothing of that (zones: the dock does)
    if (d.changed) { commit({ lists: d.kind === 'zoneMove' || d.kind === 'zoneSize' ? true : false }); renderRight(); }
  } else if (d.kind === 'zoneNew') {
    const r = zoneDraft; zoneDraft = null;
    if (r && r.w * ui.view.zoom >= 8 && r.h * ui.view.zoom >= 8) addZone(r);
    else if (!r && d.pick) selectZone(d.pick);
  } else if (d.kind === 'marquee') {
    marquee = null; onSelection();
  } else if (d.kind === 'pan' && d.button === 2 && !d.space && e.type === 'pointerup') {
    const [sx, sy] = evPos(e);
    if (Math.hypot(sx - d.sx, sy - d.sy) < 4) stageMenu(e, sx, sy);   // a right-click, not a right-drag
  }
}
// What was right-clicked on the stage: a zone (with the Zone tool), a fixture, or empty canvas
function stageMenu(e, sx, sy) {
  const [x, y] = toC(sx, sy);
  if (pathDraft || mappingLocked()) return;
  if (ui.tool === 'zone') { const z = hitZoneLabel(sx, sy) || hitZone(x, y); return z ? zoneMenu(e, z) : canvasMenu(e, x, y); }
  const f = hitFixture(x, y);
  if (f) return fixtureMenu(e, f, stagePick(f));
  canvasMenu(e, x, y);
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('pointerleave', () => { if (!drag) { ui.hoverFx = null; ui.hoverPx = null; ui.cursor = null; redrawStage(); } });
cv.addEventListener('dblclick', e => {
  if (ui.tool === 'zone') {
    const [sx, sy] = evPos(e), [x, y] = toC(sx, sy), z = hitZoneLabel(sx, sy) || hitZone(x, y);
    if (z) { selectZone(z); ui.rightTab = 'content'; renderRight(); }
    return;
  }
  if (ui.tool !== 'select') return;
  const hd = hitHandle(...evPos(e)), one = selected()[0];
  if (hd && one && one.type === 'path' && hd.id[0] === 'v') { toggleSmooth(one, +hd.id.slice(1)); return; }
  const [x, y] = toC(...evPos(e));
  const f = hitFixture(x, y);
  if (!f) return;
  if (f.group != null && !(ui.sel.size === 1 && ui.sel.has(f.id))) { ui.sel = new Set([f.id]); onSelection(); }   // into its group: just this one
  focusName('fxName');
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const [sx, sy] = evPos(e);
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  else { ui.view.x -= e.deltaX; }
}, { passive: false });
// The path being drawn becomes a fixture (a pen path keeps its curve handles), with about one pixel per 10 units
function pathFromDraft() {
  const d = pathDraft, f = newFixture('path', { pts: d.pts.slice(), closed: !!d.closed });
  if (d.pen && d.ctl.some(v => v)) f.ctl = d.ctl.slice();
  f.pixels = Math.max(2, Math.round(pathLength(f) / 10) + (f.closed ? 0 : 1));
  pathDraft = null;
  addFixture(f);
  return f;
}
// A point of a path becomes smooth, with handles along the line through its neighbours (a third of the way to each),
// or, if it has handles, a corner again
function toggleSmooth(f, k) {
  const P = f.pts, n = P.length / 2, H = f.ctl ? f.ctl.slice() : new Array(n * 4).fill(0);
  if (H[4 * k] || H[4 * k + 1] || H[4 * k + 2] || H[4 * k + 3]) H.fill(0, 4 * k, 4 * k + 4);
  else {
    const prev = k > 0 ? k - 1 : f.closed ? n - 1 : -1, next = k < n - 1 ? k + 1 : f.closed ? 0 : -1;
    const x = P[2 * k], y = P[2 * k + 1], px = prev < 0 ? x : P[2 * prev], py = prev < 0 ? y : P[2 * prev + 1], nx = next < 0 ? x : P[2 * next], ny = next < 0 ? y : P[2 * next + 1];
    const tl = Math.hypot(nx - px, ny - py) || 1, tx = (nx - px) / tl, ty = (ny - py) / tl;
    const din = Math.hypot(x - px, y - py) / 3, dout = Math.hypot(nx - x, ny - y) / 3;
    H.splice(4 * k, 4, -tx * din, -ty * din, tx * dout, ty * dout);
  }
  if (H.some(v => v)) f.ctl = H; else delete f.ctl;
  markGeom(); commit(); renderRight();
}
function finishPath() {
  if (pathDraft && pathDraft.pts.length >= 4) { const f = pathFromDraft(); toast(`${f.name} added: ${f.pixels} pixels`); }
  else pathDraft = null;
  setTool('select');
}
function setTool(t) {
  if (mappingLocked()) t = 'select';
  if (pathDraft && t !== ui.tool) { if (pathDraft.pts.length >= 4) pathFromDraft(); else pathDraft = null; }
  ui.tool = t;
  $$('#rail button').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  const hints = {
    line: 'Drag to draw a strip · Shift snaps to 45° · click for a default strip',
    matrix: 'Drag a rectangle · Shift for a square · click for a 16 × 16 default',
    circle: 'Drag from the centre outwards · click for a default ring',
    path: 'Click to add points · double-click or Enter to finish · Backspace removes a point · Esc cancels',
    pen: 'Click for a corner, drag for a curve · click the first point to close · double-click or Enter to finish · Backspace removes a point · Esc cancels',
    zone: 'Drag to draw a zone · click to select · drag a label to move, handles to resize · double-click to edit its layers',
  };
  const hint = $('#hint');
  hint.hidden = !hints[t];
  hint.textContent = hints[t] || '';
  cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  if (project && ui.rightTab === 'inspector') renderRight();
}

/* ---------- guide image ---------- */
function loadGuide() {
  guideImg = null;
  if (project.guide && project.guide.src) { guideImg = new Image(); guideImg.src = project.guide.src; }
}
async function setGuideFile(file) {
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  project.guide = { src, name: file.name };
  loadGuide(); ui.showGuide = true; $('#vGuide').checked = true;
  commit(); renderRight();
  toast('Guide image loaded: ' + file.name);
}
