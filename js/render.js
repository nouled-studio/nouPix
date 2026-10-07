// openLedMapper · js/render.js
// Rendering: the GPU mixer that composites zones and layers, looks and fades between them, sampling the
// composition at every pixel of the fixtures, and the highlight and test patterns. Uses util, model, geometry, sources.

/* ---------- mixer: composites zones and layers on the GPU ---------- */
// Its own WebGL context, separate from the shaders'. Each zone's layers are blended at the zone's size,
// crossfaded if the zone is fading, then laid onto the output canvas at the zone's place with its opacity.
// That canvas is what the stage shows and what the pixels are sampled from.
const mixer = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  let g = null;
  try { g = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: false, depth: false }); } catch (e) { g = null; }
  if (!g) return { ok: false, canvas };
  const VS = 'attribute vec2 p; varying vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  const BLEND = `precision mediump float; varying vec2 uv; uniform sampler2D base, top; uniform vec2 scale; uniform float opacity; uniform int mode;
vec3 blend(vec3 b, vec3 t) {
  if (mode == 1) return b + t;
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - t);
  if (mode == 3) return b * t;
  if (mode == 4) return b - t;
  if (mode == 5) return max(b, t);
  if (mode == 6) return min(b, t);
  if (mode == 7) return abs(b - t);
  return t;
}
void main() {
  vec4 b = texture2D(base, uv * scale), t = texture2D(top, uv * scale);
  gl_FragColor = vec4(mix(b.rgb, clamp(blend(b.rgb, t.rgb), 0.0, 1.0), t.a * opacity), 1.0);
}`;
  const MIX = 'precision mediump float; varying vec2 uv; uniform sampler2D a, b; uniform vec2 sa, sb; uniform float t;\nvoid main() { gl_FragColor = vec4(mix(texture2D(a, uv * sa).rgb, texture2D(b, uv * sb).rgb, t), 1.0); }';
  // Sampling: every fixture pixel is one point of a small target that reads the output at the pixel's position,
  // so only the pixels come back from the GPU, not the whole area the fixtures cover
  const SAMPLE_VS = 'attribute vec4 p; uniform vec2 dsz; varying highp vec2 uv;\nvoid main() { uv = p.zw; gl_Position = vec4((p.xy + 0.5) / dsz * 2.0 - 1.0, 0.0, 1.0); gl_PointSize = 1.0; }';
  const SAMPLE_FS = 'precision highp float; varying highp vec2 uv; uniform sampler2D frame;\nvoid main() { gl_FragColor = texture2D(frame, uv); }';
  const program = (vs, fs) => {
    const p = g.createProgram();
    for (const [type, code] of [[g.VERTEX_SHADER, vs], [g.FRAGMENT_SHADER, fs]]) { const s = g.createShader(type); g.shaderSource(s, code); g.compileShader(s); g.attachShader(p, s); }
    g.bindAttribLocation(p, 0, 'p');
    g.linkProgram(p);
    const u = {};
    for (const n of ['base', 'top', 'scale', 'opacity', 'mode', 'a', 'b', 'sa', 'sb', 't', 'dsz', 'frame']) u[n] = g.getUniformLocation(p, n);
    return { p, u, ok: !!g.getProgramParameter(p, g.LINK_STATUS) };
  };
  const texture = () => {
    const t = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, t);
    for (const k of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) g.texParameteri(g.TEXTURE_2D, k, g.NEAREST);
    for (const k of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T]) g.texParameteri(g.TEXTURE_2D, k, g.CLAMP_TO_EDGE);
    return t;
  };
  const target = () => ({ tex: texture(), fb: g.createFramebuffer(), w: 0, h: 0 });
  const size = (t, w, h) => {
    if (t.w === w && t.h === h) return;
    t.w = w; t.h = h;
    g.bindTexture(g.TEXTURE_2D, t.tex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.bindFramebuffer(g.FRAMEBUFFER, t.fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t.tex, 0);
  };
  // GPU resources. They are made again when the browser restores the context after losing it (a GPU reset).
  let blendP, mixP, quad, slots, cur, area, upload, zones, TW, TH, CW, CH, smp;
  function init() {
    blendP = program(VS, BLEND); mixP = program(VS, MIX);
    quad = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true); // textures upright in GL terms, like the canvas that is read back
    g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
    slots = [[target(), target()], [target(), target()]]; // ping-pong pairs: 0 = a zone's current look, 1 = the look it fades from
    cur = [0, 0]; area = [[1, 1], [1, 1]];                 // area = the zone size accumulated in each slot
    upload = texture();
    zones = new Map();                                      // zone id -> { out: its picture, frozen: a copy to fade from }
    TW = 1; TH = 1; CW = 0; CH = 0;
    // Exact sampling needs full float precision in fragment shaders; without it the area is read back instead.
    smp = null;
    const hp = g.getShaderPrecisionFormat(g.FRAGMENT_SHADER, g.HIGH_FLOAT);
    if (hp && hp.precision >= 23) {
      const prog = program(SAMPLE_VS, SAMPLE_FS), maxT = g.getParameter(g.MAX_TEXTURE_SIZE), maxV = g.getParameter(g.MAX_VIEWPORT_DIMS);
      if (prog.ok) smp = { prog, buf: g.createBuffer(), frame: texture(), fw: 0, fh: 0, dst: target(), W: Math.min(1024, maxT, maxV[0]), maxRows: Math.min(maxT, maxV[1]), rows: 0, count: 0, n: -1, version: -1, out: null };
    }
  }
  init();
  canvas.addEventListener('webglcontextlost', e => e.preventDefault()); // so the browser restores it
  canvas.addEventListener('webglcontextrestored', init);
  const bindTex = (unit, t, loc) => { g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, t); g.uniform1i(loc, unit); };
  const pass = (fb, x, y, w, h, prog, set) => { g.bindFramebuffer(g.FRAMEBUFFER, fb); g.viewport(x, y, w, h); g.useProgram(prog.p); set(prog.u); g.drawArrays(g.TRIANGLES, 0, 6); };
  return {
    ok: true, canvas,
    lost: () => g.isContextLost(),
    sampling: () => !!smp,
    // textures match the source canvases (tw × th); the output canvas is the composition (cw × ch)
    resize(tw, th, cw, ch) {
      if (tw !== TW || th !== TH) { TW = tw; TH = th; for (const pair of slots) for (const t of pair) size(t, tw, th); }
      if (cw !== CW || ch !== CH) { CW = canvas.width = cw; CH = canvas.height = ch; }
    },
    clear() { g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, CW, CH); g.clearColor(0, 0, 0, 1); g.clear(g.COLOR_BUFFER_BIT); },
    begin(slot, w, h) {
      cur[slot] = 0; area[slot] = [w, h];
      g.bindFramebuffer(g.FRAMEBUFFER, slots[slot][0].fb);
      g.clearColor(0, 0, 0, 1); g.clear(g.COLOR_BUFFER_BIT);
    },
    layer(slot, image, mode, opacity) {
      g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, upload);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
      const from = slots[slot][cur[slot]], to = slots[slot][1 - cur[slot]], [w, h] = area[slot];
      pass(to.fb, 0, 0, w, h, blendP, u => { bindTex(0, from.tex, u.base); bindTex(1, upload, u.top); g.uniform2f(u.scale, w / TW, h / TH); g.uniform1f(u.opacity, opacity); g.uniform1i(u.mode, mode); });
      cur[slot] = 1 - cur[slot];
    },
    // The zone's picture: its current look, crossfaded by t from slot 1 or from its frozen frame (from = null: no fade)
    zone(z, from, t) {
      let Z = zones.get(z.id);
      if (!Z) zones.set(z.id, Z = { out: target(), frozen: null });
      size(Z.out, z.w, z.h);
      const b = slots[0][cur[0]].tex, bw = area[0][0] / TW, bh = area[0][1] / TH;
      const [a, aw, ah] = from === 1 ? [slots[1][cur[1]].tex, area[1][0] / TW, area[1][1] / TH] : from === 'frozen' && Z.frozen ? [Z.frozen, 1, 1] : [b, bw, bh];
      pass(Z.out.fb, 0, 0, z.w, z.h, mixP, u => { bindTex(0, a, u.a); bindTex(1, b, u.b); g.uniform2f(u.sa, aw, ah); g.uniform2f(u.sb, bw, bh); g.uniform1f(u.t, from == null ? 1 : t); });
    },
    // Keep a copy of the zone's picture, to fade from when a fade is interrupted by another
    freeze(z) {
      const Z = zones.get(z.id);
      if (!Z || !Z.out.w) return false;
      if (!Z.frozen) Z.frozen = texture();
      g.bindFramebuffer(g.FRAMEBUFFER, Z.out.fb);
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, Z.frozen);
      g.copyTexImage2D(g.TEXTURE_2D, 0, g.RGBA, 0, 0, Z.out.w, Z.out.h, 0);
      return true;
    },
    // Lay the zone's picture onto the output at its place, over what is there, by its opacity
    composite(z, opacity) {
      const Z = zones.get(z.id);
      g.enable(g.BLEND); g.blendColor(0, 0, 0, opacity); g.blendFunc(g.CONSTANT_ALPHA, g.ONE_MINUS_CONSTANT_ALPHA);
      pass(null, z.x, CH - z.y - z.h, z.w, z.h, mixP, u => { bindTex(0, Z.out.tex, u.a); bindTex(1, Z.out.tex, u.b); g.uniform2f(u.sa, 1, 1); g.uniform2f(u.sb, 1, 1); g.uniform1f(u.t, 1); });
      g.disable(g.BLEND);
    },
    prune(ids) {
      for (const [id, Z] of zones) {
        if (ids.has(id)) continue;
        g.deleteTexture(Z.out.tex); g.deleteFramebuffer(Z.out.fb); if (Z.frozen) g.deleteTexture(Z.frozen);
        zones.delete(id);
      }
    },
    // The output's colour at every fixture pixel: 4 bytes per pixel, in fixture order, 0 for pixels outside the
    // area bb (in composition pixels, y down). The layout of points is rebuilt when the geometry version changes.
    // Returns null if this GPU can't sample exactly; the caller then reads the area back with read().
    sample(bb, list, version) {
      const S = smp;
      if (!S) return null;
      let n = 0;
      for (const f of list) n += f._n;
      const rw = bb.x1 - bb.x0 + 1, rh = bb.y1 - bb.y0 + 1;
      if (S.version !== version || S.n !== n) {
        const rows = Math.max(1, Math.ceil(n / S.W));
        if (rows > S.maxRows) return null;
        const pts = new Float32Array(n * 4);
        let q = 0, c = 0;
        for (const f of list) {
          const P = f._pts;
          for (let i = 0; i < f._n; i++, q++) {
            const x = Math.floor(P[2 * i]), y = Math.floor(P[2 * i + 1]);
            if (!(x >= bb.x0 && x <= bb.x1 && y >= bb.y0 && y <= bb.y1)) continue;
            pts[c++] = q % S.W; pts[c++] = Math.floor(q / S.W); pts[c++] = (x - bb.x0 + 0.5) / rw; pts[c++] = (bb.y1 - y + 0.5) / rh;
          }
        }
        g.bindBuffer(g.ARRAY_BUFFER, S.buf);
        g.bufferData(g.ARRAY_BUFFER, pts.subarray(0, c), g.STATIC_DRAW);
        g.bindBuffer(g.ARRAY_BUFFER, quad);
        Object.assign(S, { count: c / 4, rows, n, version, out: new Uint8Array(S.W * rows * 4) });
        size(S.dst, S.W, rows);
      }
      // copy the area out of the output canvas, then read it at each pixel
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, S.frame);
      if (S.fw !== rw || S.fh !== rh) { S.fw = rw; S.fh = rh; g.texImage2D(g.TEXTURE_2D, 0, g.RGB, rw, rh, 0, g.RGB, g.UNSIGNED_BYTE, null); }
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      g.copyTexSubImage2D(g.TEXTURE_2D, 0, 0, 0, bb.x0, CH - 1 - bb.y1, rw, rh);
      g.bindFramebuffer(g.FRAMEBUFFER, S.dst.fb);
      g.viewport(0, 0, S.W, S.rows);
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
      if (S.count) {
        g.useProgram(S.prog.p);
        g.uniform1i(S.prog.u.frame, 0); g.uniform2f(S.prog.u.dsz, S.W, S.rows);
        g.bindBuffer(g.ARRAY_BUFFER, S.buf); g.vertexAttribPointer(0, 4, g.FLOAT, false, 0, 0);
        g.drawArrays(g.POINTS, 0, S.count);
        g.bindBuffer(g.ARRAY_BUFFER, quad); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      }
      g.readPixels(0, 0, S.W, S.rows, g.RGBA, g.UNSIGNED_BYTE, S.out);
      return S.out;
    },
    read(x, y, w, h, buf) { g.bindFramebuffer(g.FRAMEBUFFER, null); g.readPixels(x, y, w, h, g.RGBA, g.UNSIGNED_BYTE, buf); },
  };
})();

/* ---------- zones, looks and fades ---------- */
// Crossfade a zone from what it shows now to whatever its layers become next
function startFade(z, dur, scene = null) {
  if (!(dur > 0.01) || !mixer.ok) { z._fade = null; return; }
  const frozen = !!z._fade && mixer.freeze(z); // a fade is already running: continue from exactly what the zone shows now
  z._fade = { from: frozen ? null : cloneLayers(z.layers), start: clockT, dur, scene };
}
// Play a source in a layer of the selected zone (the selected layer by default), crossfading over the transition time
function loadSource(id, L = selLayer()) {
  const z = selZone();
  if (!z) return;
  if (!L) { L = newLayer(); z.layers.push(L); }
  ui.layer = L.id;
  if (L.src !== id) { startFade(z, project.settings.transition); L.src = id; }
  syncMedia();
  refreshScenes();
}
// Zones fully covered by an opaque zone above them, or at zero opacity, cannot be seen and are not drawn
function hiddenZone(i) {
  const zs = project.zones, z = zs[i];
  if (!(z.opacity > 0)) return true;
  for (let j = i + 1; j < zs.length; j++) {
    const o = zs[j];
    if (o.opacity >= 1 && o.x <= z.x && o.y <= z.y && o.x + o.w >= z.x + z.w && o.y + o.h >= z.y + z.h) return true;
  }
  return false;
}
let preview = null; // { layer, canvas }: the Content tab's live picture of the selected layer
function renderLook(layers, slot, z) {
  mixer.begin(slot, z.w, z.h);
  for (const L of layers) {
    if (!L.on || !(L.opacity > 0)) continue;
    const c = renderSource(srcById(L.src), L, z.w, z.h);
    if (!c) continue;
    if (slot === 0 && preview && preview.layer === L) drawPreview(c, z);
    mixer.layer(slot, c, BLEND_IDX[L.blend] || 0, L.opacity);
  }
}
function drawPreview(c, z) {
  const p = preview.canvas;
  if (!p.isConnected) { preview = null; return; }
  p.getContext('2d').drawImage(c, 0, c.height - z.h, z.w, z.h, 0, 0, p.width, p.height);
}
function renderContent() {
  if (!mixer.ok) { for (const f of project.fixtures) f._col.fill(0); return; }
  if (mixer.lost() || (gl && gl.isContextLost())) return; // GPU reset: hold the last colours until the browser restores it
  const s = project.settings, sel = selZone(), pv = !!preview && preview.canvas.isConnected && !document.hidden;
  mixer.resize(glCanvas.width, glCanvas.height, s.compW, s.compH);
  mixer.clear();
  project.zones.forEach((z, i) => {
    let t = 1;
    if (z._fade) { t = (clockT - z._fade.start) / z._fade.dur; if (t >= 1) { z._fade = null; syncMedia(); } }
    const show = !hiddenZone(i);
    // Hidden zones are not drawn. The selected one still is while its layer preview is on screen, and while it
    // fades, so a fade interrupted by another scene continues from its current picture.
    if (!show && !(z === sel && (pv || z._fade))) return;
    const f = z._fade;
    renderLook(z.layers, 0, z);
    if (f && f.from) renderLook(f.from, 1, z);
    mixer.zone(z, f ? (f.from ? 1 : 'frozen') : null, t);
    if (show) mixer.composite(z, z.opacity);
  });
  sampleMix();
}

/* ---------- sampling, highlight and test patterns ---------- */
// Read the mixed frame at every fixture pixel and store the pixel's colour in f._col.
// There are two ways, with the same result: draw each pixel as a point into a small target and read that
// back (little data to transfer), or read back the whole area the fixtures cover. Which is faster depends
// on the GPU (software rendering draws points slowly), so they are timed against each other after the
// layout changes, at most every few seconds.
const samplePick = { gpu: true, version: -1, at: -1e9 };
function sampleMix() {
  const bb = fixtureBB;
  if (!bb) { for (const f of project.fixtures) f._col.fill(0); return; }
  if (mixer.sampling() && samplePick.version !== geomVersion && performance.now() - samplePick.at > 3000) pickSampling(bb);
  if (!(samplePick.gpu && sampleGpu(bb))) sampleArea(bb);
}
function sampleGpu(bb) {
  const got = mixer.sample(bb, project.fixtures, geomVersion);
  if (!got) return false;
  let k = 0;
  for (const f of project.fixtures) {
    const out = f._col, n = f._n;
    for (let i = 0, j = 0; i < n; i++, j += 3, k += 4) { out[j] = got[k]; out[j + 1] = got[k + 1]; out[j + 2] = got[k + 2]; }
  }
  return true;
}
function sampleArea(bb) {
  const H = project.settings.compH;
  const rw = bb.x1 - bb.x0 + 1, rh = bb.y1 - bb.y0 + 1;
  if (readBuf.length < rw * rh * 4) readBuf = new Uint8Array(rw * rh * 4);
  mixer.read(bb.x0, H - 1 - bb.y1, rw, rh, readBuf);
  for (const f of project.fixtures) {
    const out = f._col, P = f._pts, n = f._n;
    for (let i = 0; i < n; i++) {
      const x = Math.floor(P[2 * i]), y = Math.floor(P[2 * i + 1]);
      const j = 3 * i;
      if (x < bb.x0 || x > bb.x1 || y < bb.y0 || y > bb.y1) { out[j] = out[j + 1] = out[j + 2] = 0; continue; }
      const k = ((bb.y1 - y) * rw + (x - bb.x0)) * 4;
      out[j] = readBuf[k]; out[j + 1] = readBuf[k + 1]; out[j + 2] = readBuf[k + 2];
    }
  }
}
function pickSampling(bb) {
  samplePick.version = geomVersion; samplePick.at = performance.now();
  if (!sampleGpu(bb)) { samplePick.gpu = false; return; } // lays out the points; not timed
  const time = fn => { mixer.read(0, 0, 1, 1, readBuf); const t = performance.now(); fn(bb); return performance.now() - t; }; // after the frame's own work
  const gpu = Math.min(time(sampleGpu), time(sampleGpu)), area = Math.min(time(sampleArea), time(sampleArea));
  samplePick.gpu = gpu < area;
}
// Highlight: what the LEDs show instead of the content while it is on. Trace, Flood and Color check light the
// selected fixtures, or all of them when none is selected.
const HL_MODES = [
  ['trace', 'Trace', 'wiring: first red, last blue, a green runner'],
  ['flood', 'Flood', 'full white'],
  ['color', 'Color check', 'red, green, blue, white in turn'],
  ['spot', 'Spotlight', 'selected yellow, the rest blue'],
  ['pixel', 'Pixel finder', 'click a pixel on the stage'],
];
function testPattern(mode) {
  if (mode === 'white' || mode === 'black') { for (const f of project.fixtures) f._col.fill(mode === 'white' ? 255 : 0); return; }   // used by the tests
  if (mode === 'identify') mode = 'trace';   // its name before Highlight
  const all = !ui.sel.size, phase = Math.floor(clockT) % 4;
  const rgbw = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]][phase];
  const pick = ui.pickPx && fxById(ui.pickPx.fid) ? ui.pickPx : null;
  for (const f of project.fixtures) {
    const c = f._col, n = f._n;
    if (mode === 'spot') { const k = ui.sel.has(f.id) ? [255, 190, 0] : [0, 40, 255]; for (let i = 0; i < n; i++) c.set(k, 3 * i); continue; }
    if (mode === 'pixel') { c.fill(0); if (pick && pick.fid === f.id && pick.i < n) c.set([255, 255, 255], 3 * pick.i); continue; }
    if (!all && !ui.sel.has(f.id)) { c.fill(0); continue; }
    if (mode === 'flood') { c.fill(255); continue; }
    if (mode === 'color') { for (let i = 0; i < n; i++) c.set(rgbw, 3 * i); continue; }
    // trace: dim white, first pixel red, last pixel blue, a green runner shows the wiring direction
    c.fill(40);
    const run = Math.floor(clockT * 12) % n;
    c.set([0, 255, 0], 3 * run);
    c.set([0, 0, 255], 3 * (n - 1));
    c.set([255, 0, 0], 0);
  }
}
function setHighlight(on, mode = ui.hlMode) {
  ui.hlMode = mode;
  ui.outputMode = on ? mode : 'content';
  if (!on || mode !== 'pixel') ui.pickPx = null;
  updateHighlightUI(); savePrefs();
  if (ui.rightTab === 'inspector') renderRight();
  if (on && mode === 'pixel') toast('Pixel finder: click a pixel on the stage to light just that one. ← → step to the next pixel.');
}
const toggleHighlight = () => setHighlight(ui.outputMode === 'content');
