// nouPix · js/videoin.js
// Live video from this computer's own inputs, and the Ambilight.
// Camera input (kind 'camera': a webcam) and Video input (kind 'capture': a capture card, HDMI or SDI in) open a video
// device of the browser (getUserMedia) into a <video> in mediaEls, as screen capture does, and drawMedia draws it
// through the source's processing (src.proc: crop, rotate, flip, invert, brightness, contrast, saturation). A device
// opens while a layer shows its source (or an Ambilight takes its picture) and closes a few seconds after nothing does.
// The Ambilight (kind 'ambilight', a built-in) shows another source as a picture in the middle of its zone and spreads
// the colours of that picture's edges outward over the rest of it, softened: the fixtures patched around the picture
// light as the light around a television does. Its settings are the layer's (L.params, as the Fixture Chase's).
// Uses util, model, sources (mediaEls, mediaCanvas, mctx, renderSource).

/* ---------- camera and video inputs ---------- */
// What a camera or video input does to its picture before it is drawn
const VIDEO_PROC = { flipH: false, flipV: false, rotate: 0, invert: false, brightness: 1, contrast: 1, saturation: 1, cropL: 0, cropR: 0, cropT: 0, cropB: 0 };
const VIDEO_RES = [['auto', 'Auto'], ['720', '720p'], ['1080', '1080p'], ['2160', '4K']];
const VIDEO_FPS = [['auto', 'Auto'], ['30', '30'], ['60', '60']];
const isDeviceSource = s => !!s && (s.kind === 'camera' || s.kind === 'capture');
// The names capture cards give themselves (the cheap HDMI to USB ones say "USB Video"); anything else is a camera
const CAPTURE_RE = /capture|cam ?link|elgato|magewell|blackmagic|decklink|ultrastudio|intensity|web presenter|aja|u-tap|hdmi|sdi|usb video|av\.io|epiphan|avermedia|live gamer|hauppauge|ripsaw|atomos|ezcap|mirabox|grabber/i;
const isCaptureLabel = label => CAPTURE_RE.test(label || '');
function fixVideoProc(p) {
  const o = isObj(p) ? p : {}, out = {};
  for (const [k, d] of Object.entries(VIDEO_PROC)) {
    if (typeof d === 'boolean') out[k] = o[k] === true;
    else out[k] = clamp(numOr(o[k], d), 0, k.startsWith('crop') ? 0.45 : 2);
  }
  out.rotate = ((Math.round(numOr(o.rotate, 0) / 90) % 4) + 4) % 4 * 90;
  return out;
}
// A camera or video input of a file, repaired: its device (its id in this browser and its name, for another computer),
// the size and rate asked of it, how it fits, its processing
function fixDeviceSource(s) {
  s.device = typeof s.device === 'string' && s.device.length < 300 ? s.device : '';
  s.label = typeof s.label === 'string' && s.label.length < 300 ? s.label : '';
  if (!VIDEO_RES.some(r => r[0] === s.res)) s.res = 'auto';
  if (!VIDEO_FPS.some(r => r[0] === s.fps)) s.fps = 'auto';
  if (!['fit', 'fill', 'stretch'].includes(s.fit)) s.fit = 'fill';
  s.proc = fixVideoProc(s.proc);
  return s;
}

// The video devices the browser lists (named once it may use them), and each device source's state: last used, an
// error, opening, stopped by hand, its size and rate
const devices = { list: [], state: new Map() };
function devState(src) {
  let st = devices.state.get(src.id);
  if (!st) devices.state.set(src.id, st = { at: 0, tried: -1e9, err: '', opening: false, off: false, size: null, fps: 0 });
  return st;
}
async function listVideoDevices() {
  try { devices.list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) { devices.list = []; }
  return devices.list;
}
// The device a source wants among those listed: its own (by id, else by name), or with none chosen yet, the first of
// its kind (a camera falls back to any)
function deviceFor(src, list) {
  if (src.device || src.label) return list.find(d => d.deviceId && d.deviceId === src.device) || list.find(d => src.label && d.label === src.label) || null;
  const cap = src.kind === 'capture';
  return list.find(d => d.label && isCaptureLabel(d.label) === cap) || (cap ? null : list.find(d => d.deviceId) || null);
}
async function startDevice(src) {
  if (REMOTE_CLIENT || !isDeviceSource(src)) return;
  const st = devState(src);
  if (st.opening) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { st.err = 'This browser can’t open cameras or video inputs.'; return; }
  st.opening = true; st.err = ''; st.off = false; st.tried = performance.now();
  const res = { 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] }[src.res];
  const want = Object.assign(res ? { width: { ideal: res[0] }, height: { ideal: res[1] } } : {}, src.fps !== 'auto' ? { frameRate: { ideal: +src.fps } } : {});
  const open = id => navigator.mediaDevices.getUserMedia({ video: Object.assign({}, want, id ? { deviceId: { exact: id } } : {}), audio: false });
  let stream = null;
  try {
    let list = await listVideoDevices();
    // the devices are named only once nouPix may use one: asked first (the browser asks the user), then chosen
    if (!list.some(d => d.label)) { stream = await open(null); list = await listVideoDevices(); }
    const d = deviceFor(src, list);
    if (!d) throw Object.assign(new Error('none'), { name: 'NotFoundError' });
    const got = stream && stream.getVideoTracks()[0];
    if (!got || got.getSettings().deviceId !== d.deviceId) { if (stream) stream.getTracks().forEach(t => t.stop()); stream = await open(d.deviceId); }
    if (!project.sources.includes(src)) { stream.getTracks().forEach(t => t.stop()); return; }   // removed meanwhile
    const track = stream.getVideoTracks()[0], set = track.getSettings();
    if (src.device !== set.deviceId || src.label !== track.label) { src.device = set.deviceId || d.deviceId; src.label = track.label || d.label; commitSoft(); }
    st.size = set.width && set.height ? [set.width, set.height] : null; st.fps = set.frameRate || 0;
    const el = document.createElement('video');
    Object.assign(el, { muted: true, playsInline: true, autoplay: true });
    el.srcObject = stream;
    await el.play().catch(() => {});
    // unplugged: off, and tried again when the devices change
    track.addEventListener('ended', () => { if (mediaEls.get(src.id) === el) { releaseMedia(src.id); st.err = 'It was disconnected.'; markThumb(src); renderSrcList(); renderRight(); } });
    releaseMedia(src.id);
    mediaEls.set(src.id, el);
    markThumb(src);
  } catch (e) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    const n = e && e.name;
    st.err = n === 'NotAllowedError' ? 'nouPix may not use cameras: allow it in the browser (or the system’s settings), then Start.'
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? (src.kind === 'capture' && !src.device && !src.label ? 'No video input found: connect one, or choose a device.' : 'Its device isn’t connected.')
      : n === 'NotReadableError' ? 'Its device is busy: another program may be using it.' : 'It couldn’t be opened.';
    if (n === 'NotAllowedError') st.off = true;   // not asked again by itself
  } finally {
    st.opening = false;
  }
  renderSrcList();
  if (ui.rightTab === 'content') renderRight();
}
// Stopped by hand: closed, and not opened by itself again until started
function stopDevice(src) {
  devState(src).off = true;
  releaseMedia(src.id); markThumb(src);
  renderSrcList(); renderRight();
}
function restartDevice(src) { if (mediaEls.has(src.id)) { releaseMedia(src.id); startDevice(src); } }
function forgetDevice(id) { devices.state.delete(id); }
// Once a frame (syncMedia): devices open while something shows them, tried again every 5 s while they fail, and
// close 5 s after nothing does
function syncDevices(used) {
  if (REMOTE_CLIENT) return;
  const now = performance.now();
  for (const s of project.sources) {
    if (!isDeviceSource(s)) continue;
    const st = devState(s), on = mediaEls.has(s.id), want = used.has(s.id);
    if (want) st.at = now;
    if (want && !on && !st.opening && !st.off && now - st.tried > 5000) startDevice(s);
    else if (on && !want && now - st.at > 5000) { releaseMedia(s.id); markThumb(s); renderSrcList(); }
  }
}
// A device plugged in or out: the list again, and the sources waiting for theirs try at once
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    listVideoDevices().then(() => {
      for (const st of devices.state.values()) st.tried = -1e9;
      if (ui.rightTab === 'content') renderRight();
    });
  });
}
// A camera's or video input's picture, processed, into the media canvas at w × h (its top at top)
function drawProcessed(el, src, w, h, top) {
  const p = src.proc, iw = el.videoWidth, ih = el.videoHeight;
  if (!iw || !ih) return false;
  const sx = iw * p.cropL, sy = ih * p.cropT, sw = Math.max(1, iw * (1 - p.cropL - p.cropR)), sh = Math.max(1, ih * (1 - p.cropT - p.cropB));
  const turned = p.rotate % 180 !== 0, pw = turned ? sh : sw, ph = turned ? sw : sh;   // the picture's size once turned
  let dw = w, dh = h;
  if (src.fit !== 'stretch') { const s = src.fit === 'fill' ? Math.max(w / pw, h / ph) : Math.min(w / pw, h / ph); dw = pw * s; dh = ph * s; }
  mctx.save(); mctx.beginPath(); mctx.rect(0, top, w, h); mctx.clip();
  // turned first, then flipped as it shows
  mctx.translate(w / 2, top + h / 2);
  mctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
  mctx.rotate(p.rotate * Math.PI / 180);
  const f = [];
  if (p.brightness !== 1) f.push(`brightness(${p.brightness})`);
  if (p.contrast !== 1) f.push(`contrast(${p.contrast})`);
  if (p.saturation !== 1) f.push(`saturate(${p.saturation})`);
  if (p.invert) f.push('invert(1)');
  mctx.filter = f.length ? f.join(' ') : 'none';
  const bw = turned ? dh : dw, bh = turned ? dw : dh;
  let ok = true;
  try { mctx.drawImage(el, sx, sy, sw, sh, -bw / 2, -bh / 2, bw, bh); } catch (e) { ok = false; }
  mctx.restore();
  return ok;
}

/* ---------- the Ambilight ---------- */
// Its settings, kept on the layer: the source it follows; the picture's width and height in the middle of the zone;
// how deep into the picture each edge's colour is taken; how many colours along each edge; the light's softness,
// fall-off towards the zone's outer edge, brightness and saturation; how slowly it follows (seconds); and what shows
// in the middle (the picture, its glow, or black)
const AMBI_DEFAULT = { from: '', width: 0.7, height: 0.7, depth: 0.12, segments: 16, softness: 0.5, falloff: 0.3, gain: 1.2, saturation: 1.3, smooth: 0.25, middle: 'picture' };
const AMBI_RANGES = { width: [0.1, 1], height: [0.1, 1], depth: [0.02, 0.5], segments: [2, 64], softness: [0, 1], falloff: [0, 1], gain: [0, 3], saturation: [0, 3], smooth: [0, 2] };
const AMBI_MIDDLE = [['picture', 'Picture'], ['glow', 'Glow'], ['black', 'Black']];
function ambiParams(L, src) {
  const p = Object.assign({}, AMBI_DEFAULT, (L && L.params && L.params[src.id]) || {});
  for (const [k, [lo, hi]] of Object.entries(AMBI_RANGES)) p[k] = clamp(numOr(p[k], AMBI_DEFAULT[k]), lo, hi);
  p.segments = Math.round(p.segments);
  if (!AMBI_MIDDLE.some(m => m[0] === p.middle)) p.middle = 'picture';
  if (typeof p.from !== 'string') p.from = '';
  return p;
}
// The sources an Ambilight can follow: any picture but another Ambilight
const ambiCanFollow = s => !!s && s.kind !== 'ambilight';
// The sources the zones' Ambilights follow, which play (and open) as if shown
function ambiUses(used) {
  for (const z of project.zones) for (const L of z.layers) {
    const s = L.on && srcById(L.src);
    if (s && s.kind === 'ambilight') { const f = ambiParams(L, s).from; if (f) used.add(f); }
  }
}
// Its canvases, made once and kept: the picture, the edges (each worked out in two steps, so they average), the light
const ambiCanvases = new Map();
function ambiCanvas(key, w, h) {
  let c = ambiCanvases.get(key);
  if (!c) { c = document.createElement('canvas'); ambiCanvases.set(key, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
// Each layer's edge colours as they were last shown, which the new ones approach over the smoothing time
const ambiPast = new Map();
// One edge: the part of the picture at (x, y, w, h) averaged into n colours along it ([r, g, b] each 0..255), as
// they were shown last eased towards them when smooth
function ambiEdge(key, pic, x, y, w, h, n, across, smooth, dt) {
  const big = ambiCanvas('e1' + across, across ? n * 8 : 8, across ? 8 : n * 8), bc = big.getContext('2d');
  const sm = ambiCanvas('e2' + across, across ? n : 1, across ? 1 : n), sc = sm.getContext('2d', { willReadFrequently: true });
  for (const c of [bc, sc]) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; }
  bc.clearRect(0, 0, big.width, big.height);
  bc.drawImage(pic, x, y, Math.max(1, w), Math.max(1, h), 0, 0, big.width, big.height);
  sc.clearRect(0, 0, sm.width, sm.height);
  sc.drawImage(big, 0, 0, sm.width, sm.height);
  const d = sc.getImageData(0, 0, sm.width, sm.height).data, now = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { now[i * 3] = d[i * 4]; now[i * 3 + 1] = d[i * 4 + 1]; now[i * 3 + 2] = d[i * 4 + 2]; }
  const was = key && ambiPast.get(key);
  if (was && was.length === now.length && smooth > 0) {
    const a = 1 - Math.exp(-dt / smooth);
    for (let i = 0; i < now.length; i++) now[i] = was[i] + (now[i] - was[i]) * a;
  }
  if (key) ambiPast.set(key, now);
  return now;
}
// The colours of one edge drawn as a strip of n pixels, to be stretched over its band
function ambiStrip(cols, n, across) {
  const c = ambiCanvas('s' + across + n, across ? n : 1, across ? 1 : n), x = c.getContext('2d');
  const img = x.createImageData(c.width, c.height);
  for (let i = 0; i < n; i++) { img.data[i * 4] = cols[i * 3]; img.data[i * 4 + 1] = cols[i * 3 + 1]; img.data[i * 4 + 2] = cols[i * 3 + 2]; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  return c;
}
const ambiRgb = (a, i, b, j) => `rgb(${Math.round((a[i] + b[j]) / 2)},${Math.round((a[i + 1] + b[j + 1]) / 2)},${Math.round((a[i + 2] + b[j + 2]) / 2)})`;
// Draw an Ambilight at w × h into the media canvas (for zone z; t: a thumbnail's moment, with colours going round
// for its picture when it follows nothing yet). Whether there is something to show.
function drawAmbilight(src, L, w, h, z, t) {
  const p = ambiParams(L, src), from = p.from ? srcById(p.from) : null, top = mediaCanvas.height - h;
  const pw = Math.max(2, Math.round(w * p.width)), ph = Math.max(2, Math.round(h * p.height));
  const px = Math.round((w - pw) / 2), py = Math.round((h - ph) / 2);
  // the picture: its source drawn at the middle's size (its own layer's settings where the zone plays it)
  const pic = ambiCanvas('pic', pw, ph), pc = pic.getContext('2d');
  pc.clearRect(0, 0, pw, ph);
  if (from && ambiCanFollow(from) && t == null) {
    const own = z && z.layers.find(x => x.src === from.id);
    const c = renderSource(from, { id: L.id + '|ambi', params: own ? own.params : {}, own: own && own.own }, pw, ph, z);
    if (!c) return false;
    pc.drawImage(c, 0, c.height - ph, pw, ph, 0, 0, pw, ph);
  } else if (t != null) {
    const g = pc.createLinearGradient(0, 0, pw, ph);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(t * 60 + i * 60) % 360},100%,50%)`);
    pc.fillStyle = g; pc.fillRect(0, 0, pw, ph);
  } else return false;
  // each edge's colours, averaged over the depth into the picture, eased over the smoothing time
  const n = p.segments, nv = Math.max(2, Math.round(n * ph / pw)), dx = Math.max(1, pw * p.depth), dy = Math.max(1, ph * p.depth);
  const key = t == null && L.id ? L.id : null, now = performance.now(), past = key && ambiPast.get(key + '|t');
  const dt = past ? Math.min(1, (now - past) / 1000) : 1;
  if (key) ambiPast.set(key + '|t', now);
  const T = ambiEdge(key && key + '|top', pic, 0, 0, pw, dy, n, true, p.smooth, dt);
  const B = ambiEdge(key && key + '|bottom', pic, 0, ph - dy, pw, dy, n, true, p.smooth, dt);
  const Lf = ambiEdge(key && key + '|left', pic, 0, 0, dx, ph, nv, false, p.smooth, dt);
  const R = ambiEdge(key && key + '|right', pic, pw - dx, 0, dx, ph, nv, false, p.smooth, dt);
  // the light, small (it is soft anyway): each edge's colours stretched outward over its band, the corners the mean of
  // the two edges meeting there, the middle the picture's own colours, fading towards the outer edge
  const gw = Math.max(8, Math.min(w, 240)), k = gw / w, gh = Math.max(8, Math.round(h * k));
  const gx = Math.round(px * k), gy = Math.round(py * k), gpw = Math.max(1, gw - 2 * gx), gph = Math.max(1, gh - 2 * gy);
  const G = ambiCanvas('glow', gw, gh), g = G.getContext('2d');
  g.imageSmoothingEnabled = true; g.filter = 'none';
  g.fillStyle = '#000'; g.fillRect(0, 0, gw, gh);
  g.drawImage(pic, gx, gy, gpw, gph);
  g.drawImage(ambiStrip(T, n, true), gx, 0, gpw, gy);
  g.drawImage(ambiStrip(B, n, true), gx, gy + gph, gpw, gh - gy - gph);
  g.drawImage(ambiStrip(Lf, nv, false), 0, gy, gx, gph);
  g.drawImage(ambiStrip(R, nv, false), gx + gpw, gy, gw - gx - gpw, gph);
  const e = 3 * (n - 1), ev = 3 * (nv - 1);
  g.fillStyle = ambiRgb(T, 0, Lf, 0); g.fillRect(0, 0, gx, gy);
  g.fillStyle = ambiRgb(T, e, R, 0); g.fillRect(gx + gpw, 0, gw - gx - gpw, gy);
  g.fillStyle = ambiRgb(B, 0, Lf, ev); g.fillRect(0, gy + gph, gx, gh - gy - gph);
  g.fillStyle = ambiRgb(B, e, R, ev); g.fillRect(gx + gpw, gy + gph, gw - gx - gpw, gh - gy - gph);
  if (p.falloff > 0) {
    const fade = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${p.falloff})`);
      g.fillStyle = gr; g.fillRect(rx, ry, rw, rh);
    };
    fade(0, gy, 0, 0, 0, 0, gw, gy);
    fade(0, gy + gph, 0, gh, 0, gy + gph, gw, gh - gy - gph);
    fade(gx, 0, 0, 0, 0, 0, gx, gh);
    fade(gx + gpw, 0, gw, 0, gx + gpw, 0, gw - gx - gpw, gh);
  }
  // softened: blurred with its own edges carried past the outside (so the outside doesn't darken), then brightened
  const r = p.softness * 0.2 * Math.min(gw, gh), pad = Math.ceil(r * 2) + 1;
  let light = G, lx = 0, ly = 0;
  if (r > 0.3) {
    const P = ambiCanvas('pad', gw + 2 * pad, gh + 2 * pad), q = P.getContext('2d');
    q.drawImage(G, pad, pad);
    q.drawImage(G, 0, 0, 1, gh, 0, pad, pad, gh); q.drawImage(G, gw - 1, 0, 1, gh, pad + gw, pad, pad, gh);
    q.drawImage(G, 0, 0, gw, 1, pad, 0, gw, pad); q.drawImage(G, 0, gh - 1, gw, 1, pad, pad + gh, gw, pad);
    q.drawImage(G, 0, 0, 1, 1, 0, 0, pad, pad); q.drawImage(G, gw - 1, 0, 1, 1, pad + gw, 0, pad, pad);
    q.drawImage(G, 0, gh - 1, 1, 1, 0, pad + gh, pad, pad); q.drawImage(G, gw - 1, gh - 1, 1, 1, pad + gw, pad + gh, pad, pad);
    const S = ambiCanvas('soft', P.width, P.height), s = S.getContext('2d');
    s.clearRect(0, 0, S.width, S.height);
    s.filter = `blur(${r.toFixed(2)}px)`; s.drawImage(P, 0, 0); s.filter = 'none';
    light = S; lx = pad; ly = pad;
  }
  mctx.save();
  mctx.clearRect(0, top, w, h);
  mctx.imageSmoothingEnabled = true;
  const f = [];
  if (p.saturation !== 1) f.push(`saturate(${p.saturation})`);
  if (p.gain !== 1) f.push(`brightness(${p.gain})`);
  mctx.filter = f.length ? f.join(' ') : 'none';
  mctx.drawImage(light, lx, ly, gw, gh, 0, top, w, h);
  mctx.filter = 'none';
  // the middle: the picture itself, or black (Glow leaves the picture's own colours, softened)
  if (p.middle === 'picture') mctx.drawImage(pic, px, top + py, pw, ph);
  else if (p.middle === 'black') { mctx.fillStyle = '#000'; mctx.fillRect(px, top + py, pw, ph); }
  mctx.restore();
  return true;
}
