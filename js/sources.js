// openLedMapper · js/sources.js
// Content sources: the WebGL canvas, ISF shader runtimes, parameters and speeds, images and videos (play, trim,
// loop, sound), the format check for media files, and the small preview of each source. Uses util and model.

/* ---------- content sources ---------- */
// Sources draw into the bottom-left corner of these canvases, at the size of the zone they play in.
const glCanvas = document.createElement('canvas');
glCanvas.width = 16; glCanvas.height = 16;
let gl = null;
try { gl = glCanvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }); } catch (e) { gl = null; }
// After a GPU reset the browser restores the context without the shaders: compile them again as they are used
glCanvas.addEventListener('webglcontextlost', e => e.preventDefault());
glCanvas.addEventListener('webglcontextrestored', () => { runtimes.clear(); for (const c of thumbs.values()) c._stale = true; });
const mediaCanvas = document.createElement('canvas');
const mctx = mediaCanvas.getContext('2d');
const runtimes = new Map();   // source id -> { R, hdr, error }
const mediaEls = new Map();   // source id -> <img>/<video> (not saved in projects)
let clockT = 0, clockDT = 1 / 40, frameIndex = 0;
let isfTime = null;           // a fixed TIME while drawing still thumbnails
let layerTime = null;         // the TIME of the layer being drawn, when its shader has a speed input (see speedTime)
let readBuf = new Uint8Array(4);
function parseISFHeader(code) {
  const a = code.indexOf('/*'), b = code.indexOf('*/');
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(code.slice(a + 2, b)); } catch (e) { return null; }
}
function sourceCode(src) { return src.builtin ? (BUILTINS.find(b => b.id === src.builtin) || {}).code || '' : src.code || ''; }
function sizeContent() {
  const W = Math.max(project.settings.compW, THUMB), H = Math.max(project.settings.compH, THUMB);
  if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; }
  if (mediaCanvas.width !== W || mediaCanvas.height !== H) { mediaCanvas.width = W; mediaCanvas.height = H; }
}
function runtimeOf(src) {
  let rt = runtimes.get(src.id);
  if (rt) return rt;
  const code = src.kind === 'isf' ? sourceCode(src) : null;
  rt = { hdr: null, R: null, error: null, code };
  runtimes.set(src.id, rt);
  if (src.kind !== 'isf') return rt;
  rt.hdr = parseISFHeader(code);
  if (!rt.hdr) { rt.error = 'The JSON header between /* and */ could not be read. Check for trailing commas or missing quotes.'; return rt; }
  if (!gl) { rt.error = 'WebGL is turned off in this browser, so shaders cannot run.'; return rt; }
  const R = new interactiveShaderFormat.Renderer(gl);
  try { R.loadSource(code); } catch (e) { R.valid = false; R.error = e.message; }
  if (!R.valid) { rt.error = (R.errorLine ? 'Line ' + R.errorLine + ': ' : '') + String(R.error || 'Shader did not compile'); return rt; }
  rt.speed = (rt.hdr.INPUTS || []).find(i => i.TYPE === 'float' && /^speed$/i.test(i.NAME) && (src.builtin || SPEED_USE.test(code))) || null;
  // OLM_CLOCKS: { "phase": { "FROM": "rate", "SCALE": 1, "WRAP": 1024 } } makes the float input "phase" the running
  // total of rate × SCALE over time, per layer, so a rate slider speeds the pattern up or down without a jump
  // (as speed does through TIME), and a shader can have several such rates. WRAP keeps the total small for the GPU.
  rt.clocks = null;
  if (isObj(rt.hdr.OLM_CLOCKS)) for (const [name, c] of Object.entries(rt.hdr.OLM_CLOCKS)) {
    const from = isObj(c) && (rt.hdr.INPUTS || []).find(i => i.NAME === c.FROM && i.TYPE === 'float');
    if (from && (rt.hdr.INPUTS || []).some(i => i.NAME === name)) (rt.clocks = rt.clocks || {})[name] = { from, scale: numOr(c.SCALE, 1), wrap: Math.max(0, numOr(c.WRAP, 0)) };
  }
  R.setDateUniforms = function () { this.setValue('TIME', isfTime ?? layerTime ?? clockT); this.setValue('TIMEDELTA', clockDT); this.setValue('FRAMEINDEX', frameIndex); };
  rt.R = R;
  return rt;
}
// Free a source's compiled shader: its GPU programs, and the textures of its passes. Not its vertex buffers:
// the ISF renderers share one context and all draw with the vertex buffer set up last, which may be this one.
function dropRuntime(id) {
  const rt = runtimes.get(id);
  if (!rt) return;
  runtimes.delete(id);
  const c = thumbs.get(id);
  if (c) c._stale = true;
  if (!rt.R || gl.isContextLost()) return;
  try {
    rt.R.cleanup();
    for (const p of [rt.R.program, rt.R.paintProgram]) if (p) { gl.deleteShader(p.vShader); gl.deleteShader(p.fShader); gl.deleteProgram(p.program); }
  } catch (e) { /* already gone */ }
}
// After a project is opened: keep the compiled shaders of sources that are unchanged, free the others
function pruneRuntimes() {
  const code = new Map(project.sources.map(s => [s.id, s.kind === 'isf' ? sourceCode(s) : null]));
  for (const [id, rt] of [...runtimes]) if (!code.has(id) || code.get(id) !== rt.code) dropRuntime(id);
  for (const id of [...thumbs.keys()]) if (!code.has(id)) thumbs.delete(id);
}
// Stop a source's media and let the browser free it: a video that is only dropped keeps playing in the
// background, and a screen capture keeps capturing
function releaseMedia(id) {
  const el = mediaEls.get(id);
  if (!el) return;
  mediaEls.delete(id);
  if (el.srcObject) { el.srcObject.getTracks().forEach(t => t.stop()); el.srcObject = null; }
  const url = el.src;
  if (el instanceof HTMLVideoElement) { el.pause(); el.removeAttribute('src'); el.load(); }
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}
const PARAM_TYPES = ['float', 'long', 'bool', 'color', 'point2D', 'event', 'int'];
function isfInputs(src) { const rt = runtimeOf(src); return (rt.hdr && rt.hdr.INPUTS || []).filter(i => PARAM_TYPES.includes(i.TYPE) && !(rt.clocks && i.NAME in rt.clocks)); }
function paramValue(L, src, inp) {
  const p = L.params[src.id];
  if (p && inp.NAME in p) return p[inp.NAME];
  let v = inp.DEFAULT;
  if (inp.TYPE === 'float' || inp.TYPE === 'int') v = v ?? inp.MIN ?? 0;
  if (inp.TYPE === 'long') v = v ?? (inp.VALUES ? inp.VALUES[0] : 0);
  if (inp.TYPE === 'bool' || inp.TYPE === 'event') v = !!v;
  if (inp.TYPE === 'color') v = v ?? [1, 1, 1, 1];
  if (inp.TYPE === 'point2D') v = v ?? [0, 0];
  return v;
}
function setParam(L, src, name, v) { (L.params[src.id] = L.params[src.id] || {})[name] = v; }
// Speed. A shader's "speed" input is set from 0 to 100 % of its range, forwards or in reverse. A shader moves by
// TIME × speed, and TIME is large, so changing speed directly would make the picture jump on every step of the
// slider. Instead each layer keeps its own clock that runs at the chosen fraction of the full speed: the shader
// gets that clock as TIME and the full speed (with its sign) as speed, so the product changes smoothly.
// A layer that always ran at one speed shows exactly what it showed before.
const SPEED_USE = /\bTIME\s*\*\s*(abs\s*\(\s*)?speed\b|\bspeed\s*\*\s*TIME\b/;
const speedMax = inp => Math.max(Math.abs(inp.MIN ?? 0), Math.abs(inp.MAX ?? 1)) || 1;
const speedClocks = new Map();   // layer id | source id -> { tau, t }
function speedTime(key, rate) {
  let c = speedClocks.get(key);
  if (!c) speedClocks.set(key, c = { tau: clockT * rate, t: clockT });
  else { if (clockT > c.t) c.tau += (clockT - c.t) * rate; c.t = clockT; }
  return c.tau;
}
// Layers can share a shader with different settings, so each layer's values are applied before it draws.
function applyParams(rt, L, src) {
  layerTime = null;
  for (const inp of rt.hdr.INPUTS || []) {
    if (!PARAM_TYPES.includes(inp.TYPE) || (rt.clocks && inp.NAME in rt.clocks)) continue;
    let v = paramValue(L, src, inp);
    if (inp === rt.speed && L.id != null && isfTime == null) {
      const M = speedMax(inp);
      layerTime = speedTime(L.id + '|' + src.id, Math.abs(v) / M);
      v = v < 0 ? -M : M;
    }
    try { rt.R.setValue(inp.NAME, typeof v === 'boolean' ? (v ? 1 : 0) : v); } catch (e) { /* input not used by the shader */ }
  }
  if (rt.clocks) for (const [name, c] of Object.entries(rt.clocks)) {
    const r = numOr(paramValue(L, src, c.from), 0) * c.scale;
    let ph = isfTime != null ? isfTime * r : L.id != null ? speedTime(L.id + '|' + src.id + '|' + name, r) : clockT * r;
    if (c.wrap) ph = ((ph % c.wrap) + c.wrap) % c.wrap;
    try { rt.R.setValue(name, ph); } catch (e) { /* not used */ }
  }
}
function drawMedia(src, w, h) {
  const top = mediaCanvas.height - h;
  mctx.clearRect(0, top, w, h);
  const el = mediaEls.get(src.id);
  if (!el) return false;
  if (el._done && src.kind === 'video' && src.endHold === false) return false;   // played once, then black
  const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight;
  if (!iw || !ih) return false;
  let dw = w, dh = h;
  if (src.fit !== 'stretch') {
    const s = src.fit === 'fill' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    dw = iw * s; dh = ih * s;
  }
  mctx.save(); mctx.beginPath(); mctx.rect(0, top, w, h); mctx.clip();
  let ok = true;
  try { mctx.drawImage(el, (w - dw) / 2, top + (h - dh) / 2, dw, dh); } catch (e) { ok = false; }
  mctx.restore();
  return ok;
}
// Draw one layer's source at w × h; returns the canvas holding it, or null if there is nothing to show
function renderSource(src, L, w, h) {
  if (!src) return null;
  if (src.kind === 'isf') {
    const rt = runtimeOf(src);
    if (!rt.R) return null;
    applyParams(rt, L, src);
    rt.R.draw({ width: w, height: h });
    layerTime = null;
    return glCanvas;
  }
  return drawMedia(src, w, h) ? mediaCanvas : null;
}
// Play the videos that some layer shows (also restarts ones the browser paused in the background),
// pause the ones nothing shows.
function syncMedia() {
  const used = new Set();
  for (const z of project.zones) for (const L of z.layers.concat(z._fade && z._fade.from || [])) if (L.on && L.src) used.add(L.src);
  for (const [id, el] of mediaEls) {
    if (!(el instanceof HTMLVideoElement)) continue;
    const src = srcById(id), shown = used.has(id), was = el._shown;
    el._shown = shown;
    if (!shown) { if (videoPlaying(el) && !el.srcObject) pauseVideo(el); continue; }
    if (src && src.kind === 'video' && !was && src.restart) restartVideo(src, el, false);   // just came on: from its start
    if (!videoPlaying(el) && !el._held && !el._done) playVideo(src, el);
  }
}
// ---------- video files: their options, the formats that play, trimming, once or loop, audio
const VIDEO_DEFAULTS = { trimIn: 0, trimOut: 0, loop: true, endHold: true, restart: false, audio: false, volume: 1, reverse: false };
function fixVideoOptions(s) {
  for (const [k, d] of Object.entries(VIDEO_DEFAULTS)) {
    if (typeof d === 'number') s[k] = numOr(s[k], d); else if (typeof s[k] !== 'boolean') s[k] = d;
  }
  s.trimIn = Math.max(0, s.trimIn); s.trimOut = Math.max(0, s.trimOut); s.volume = clamp(s.volume, 0, 1);
  return s;
}
// The part of a video that plays: from trimIn to trimOut (0 = to its end), within its length
function videoSpan(src, el) {
  const d = el && isFinite(el.duration) ? el.duration : Infinity;
  const a = clamp(numOr(src.trimIn, 0), 0, isFinite(d) ? Math.max(0, d - 0.05) : 1e9);
  const b = src.trimOut > a ? Math.min(src.trimOut, d) : d;
  return [a, b];
}
// The browser's own loop is seamless, so it loops a whole video; a trimmed one is looped by videoTick
function applyVideoOptions(src, el) {
  if (!el || !(el instanceof HTMLVideoElement) || el.srcObject) return;
  el.loop = src.loop !== false && !(src.trimIn > 0) && !(src.trimOut > 0) && !src.reverse;
  el.muted = !src.audio;
  el.volume = clamp(numOr(src.volume, 1), 0, 1);
  el.playbackRate = src.rate || 1;
}
// Browsers only play forwards: a video set to play backwards stays paused, and videoTick steps it back each frame
// (el._rev while it does, el._revT the moment it is at, kept apart from currentTime while a seek is under way).
function playVideo(src, el) {
  if (src && src.reverse) { el._rev = true; el._revT = null; if (!el.paused) el.pause(); return; }
  el._rev = false;
  el.play().catch(e => {   // browsers may refuse sound before a click: play it silent, say so once
    if (e && e.name === 'NotAllowedError' && !el.muted) {
      el.muted = true; el.play().catch(() => {});
      if (!el._audioWarned) { el._audioWarned = true; toast(`${src ? src.name : 'Video'}: the browser blocked its sound until you click in openLedMapper. It plays silent for now.`, 'warn'); }
    }
  });
}
function pauseVideo(el) { el._rev = false; el.pause(); }
// Whether the video is moving, either way
const videoPlaying = el => !el.paused || !!el._rev;
function restartVideo(src, el, play = true) {
  const [a, b] = videoSpan(src, el);
  el._done = false; el._revT = null;
  try { el.currentTime = src.reverse && isFinite(b) ? Math.max(a, b - 0.02) : a; } catch (e) { /* not seekable yet */ }
  if (play && el._shown !== false) playVideo(src, el);
}
// Each frame: keep playing videos within their trim, loop them or stop them at the end
function videoTick() {
  for (const [id, el] of mediaEls) {
    if (!(el instanceof HTMLVideoElement) || el.srcObject || el.readyState < 1) continue;
    const src = srcById(id);
    if (!src || src.kind !== 'video') continue;
    const [a, b] = videoSpan(src, el), t = el.currentTime;
    if (t < a - 0.05 && !el.seeking && !el._done) { el.currentTime = a; continue; }
    if (src.reverse) { reverseTick(src, el, a, b); continue; }
    const atEnd = el.ended || (isFinite(b) && t >= b - 0.01);
    if (!atEnd || el.loop) continue;
    if (src.loop !== false) { if (!el.seeking) { el.currentTime = a; if (el._shown && !el._held && el.paused) playVideo(src, el); } }
    else if (!el._done) { el._done = true; el.pause(); if (isFinite(b) && !el.ended) el.currentTime = b; refreshMediaPanel(); }
  }
}
// One frame backwards, at the video's speed; at its start it goes round to its end, or stops there when it plays once
function reverseTick(src, el, a, b) {
  if (!el._rev || el._held || el._done || el._shown === false) return;
  if (!el.paused) el.pause();
  if (el._revT == null) el._revT = el.currentTime;
  if (isFinite(b) && el._revT > b) el._revT = b;
  el._revT -= clockDT * (src.rate || 1);
  if (el._revT <= a) {
    if (src.loop !== false) el._revT = isFinite(b) ? Math.max(a, b - 0.02) : a;
    else { el._done = true; el._rev = false; if (!el.seeking) el.currentTime = a; refreshMediaPanel(); return; }
  }
  if (!el.seeking) el.currentTime = el._revT;
}
const refreshMediaPanel = () => { if (ui.rightTab === 'content' && $('#rightBody .vtl')) renderRight(); };
// The formats openLedMapper takes. What really plays depends on the browser's codecs: a file is tried before it
// is accepted (probeMedia), so one that cannot play gets a clear message instead of a black layer.
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'], IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'];
const MEDIA_FORMATS = 'Videos: MP4 or MOV with H.264, WebM (VP8, VP9 or AV1), MKV with those codecs. Images: PNG, JPEG, GIF, WebP, AVIF, BMP.';
function mediaKindOf(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if ((file.type || '').startsWith('video/') || VIDEO_EXT.includes(ext)) return 'video';
  if ((file.type || '').startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image';
  return null;
}
// Loads a file into a hidden player and resolves once a first frame decodes, or rejects with what is wrong
function probeMedia(file, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const kind = mediaKindOf(file);
    if (!kind) return reject(new Error(`${file.name} is not a video or image file openLedMapper can play. ${MEDIA_FORMATS}`));
    const url = URL.createObjectURL(file);
    let el, timer = null;
    const end = (ok, v) => {
      clearTimeout(timer);
      if (ok) return resolve(v);
      if (el instanceof HTMLVideoElement) { el.removeAttribute('src'); el.load(); }
      URL.revokeObjectURL(url); reject(v);
    };
    timer = setTimeout(() => end(false, new Error(`${file.name} did not load. ${MEDIA_FORMATS}`)), timeout);
    if (kind === 'video') {
      el = document.createElement('video');
      Object.assign(el, { muted: true, playsInline: true, preload: 'auto' });
      el.addEventListener('loadeddata', () => el.videoWidth > 0
        ? end(true, { kind, url, el, w: el.videoWidth, h: el.videoHeight, duration: el.duration })
        : end(false, new Error(`${file.name} has no picture (only sound?). ${MEDIA_FORMATS}`)), { once: true });
      el.addEventListener('error', () => {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        end(false, new Error(`${file.name} can't be played here: its video codec isn't supported${['mp4', 'mov', 'm4v', 'mkv'].includes(ext) ? ' (H.265/HEVC and ProRes are not; export it as H.264 MP4 or as WebM)' : ''}. ${MEDIA_FORMATS}`));
      }, { once: true });
      el.src = url;
    } else {
      el = new Image();
      el.onload = () => el.naturalWidth > 0 ? end(true, { kind, url, el, w: el.naturalWidth, h: el.naturalHeight }) : end(false, new Error(`${file.name} is empty.`));
      el.onerror = () => end(false, new Error(`${file.name} can't be opened as an image. ${MEDIA_FORMATS}`));
      el.src = url;
    }
  });
}

/* ---------- source thumbnails ---------- */
// A still frame of each source, drawn once with default settings; the one under the pointer plays.
const THUMB = 96, THUMB_TIME = 1.3;
const thumbs = new Map(); // source id -> canvas
function thumbOf(src) {
  let c = thumbs.get(src.id);
  if (!c) { c = h('canvas', { width: THUMB, height: THUMB }); c._stale = true; thumbs.set(src.id, c); }
  return c;
}
function drawThumb(src, still) {
  const c = thumbs.get(src.id);
  let img = null;
  if (src.kind === 'isf') {
    const rt = runtimeOf(src);
    if (rt.R) {
      isfTime = still ? THUMB_TIME : null;
      applyParams(rt, { params: {} }, src);
      rt.R.draw({ width: THUMB, height: THUMB });
      isfTime = null;
      img = glCanvas;
    }
  } else if (drawMedia(src, THUMB, THUMB)) img = mediaCanvas;
  c._stale = !img && src.kind !== 'isf' && mediaEls.has(src.id); // media still loading: try again next frame
  if (!img) return;
  const x = c.getContext('2d');
  x.clearRect(0, 0, THUMB, THUMB);
  x.drawImage(img, 0, img.height - THUMB, THUMB, THUMB, 0, 0, THUMB, THUMB);
}
function updateThumbs() {
  if (!gl || gl.isContextLost()) return;
  const hov = ui.hoverSrc && srcById(ui.hoverSrc);
  if (hov && thumbs.has(hov.id)) drawThumb(hov, false);
  let n = 0;
  for (const s of project.sources) {
    const c = thumbs.get(s.id);
    if (c && c._stale && s !== hov && n++ < 3) drawThumb(s, true);
  }
}
function markThumb(src) { const c = thumbs.get(src.id); if (c) c._stale = true; }

/* ---------- media files ---------- */
// A file that played in probeMedia becomes the source's picture
function attachMedia(src, probe) {
  releaseMedia(src.id); // the file it replaces
  const el = probe.el;
  src.kind = probe.kind;
  if (probe.kind === 'video') {
    fixVideoOptions(src);
    Object.assign(el, { playsInline: true });
    applyVideoOptions(src, el);
    el._shown = false; el._done = false;
    restartVideo(src, el, false);
  }
  mediaEls.set(src.id, el);
  markThumb(src);
}
