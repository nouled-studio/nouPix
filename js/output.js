// nouPix · js/output.js
// Output: gamma, turning sampled colours into DMX channels (buildOutput), the outgoing frame, the clock that
// renders and sends every tick, and the WebSocket to the bridge (noupix.py), which sends Art-Net.

/* ---------- DMX frame ---------- */
// One lookup table per gamma value in use (fixtures have their own)
const gammaLUTs = new Map();
function gammaLUT(g) {
  let t = gammaLUTs.get(g);
  if (!t) {
    if (gammaLUTs.size > 64) gammaLUTs.clear();   // dragging a slider makes many values
    t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) t[i] = Math.round(255 * Math.pow(i / 255, g));
    gammaLUTs.set(g, t);
  }
  return t;
}
// The dimming curves of 16-bit fixtures, level 0–1 in, 0–1 out. A table of 4096 steps with interpolation between
// them keeps every frame quick and still gives each 16-bit value its own place.
// Each curve with a strength has its classic form (strength 1) and a stronger one (strength 2): a cube for the square
// law, the S curve applied twice. Strength 0–1 goes from a straight line to the classic form, 1–2 on to the stronger;
// every step between is a mix of two rising curves, so the output always rises with the level.
const smoothStep = x => x * x * (3 - 2 * x);
const CURVE_FORMS = {
  square: [x => x * x, x => x * x * x],
  invsquare: [x => 1 - (1 - x) * (1 - x), x => 1 - (1 - x) * (1 - x) * (1 - x)],
  scurve: [smoothStep, x => smoothStep(smoothStep(x))],
};
// k: the curve's setting, the gamma for gamma and the strength for the others
function curveValue(curve, k, x) {
  x = x <= 0 ? 0 : x >= 1 ? 1 : x;
  if (curve === 'linear') return x;
  const forms = CURVE_FORMS[curve];
  if (!forms) return Math.pow(x, k);
  const a = forms[0](x);
  return k <= 1 ? x + (a - x) * k : a + (forms[1](x) - a) * (k - 1);
}
const curveLUTs = new Map();
function curveLUT(curve, k) {
  const key = curve + k;
  let t = curveLUTs.get(key);
  if (!t) {
    if (curveLUTs.size > 64) curveLUTs.clear();   // dragging a slider makes many values
    t = new Float32Array(4097);
    for (let i = 0; i <= 4096; i++) t[i] = curveValue(curve, k, i / 4096);
    curveLUTs.set(key, t);
  }
  return t;
}
const curveAt = (t, x) => { if (!(x > 0)) return 0; if (x >= 1) return t[4096]; const p = x * 4096, i = p | 0; return t[i] + (t[i + 1] - t[i]) * (p - i); };
// A 16-bit fixture: each colour is worked out as a fraction (nothing rounded to 256 steps), put through the fixture's
// dimming curve, and sent as two channels: the coarse one (the high byte) first, then the fine one (the low byte).
function output16(f, o, kr, kg, kb, kw, wm) {
  const col = f._col, disp = f._disp, n = f._n, lut = curveLUT(fxCurve(f), curveParam(f));
  const lins = o.lin, oi = o.oi, nc = oi.length, unis = o.unis;
  const white = nc === 4 && wm !== 'off', sub = wm === 'sub';
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const r = col[j] * kr, g = col[j + 1] * kg, b = col[j + 2] * kb;
    disp[j] = r; disp[j + 1] = g; disp[j + 2] = b;
    const lin = lins[i];
    if (lin < 0) continue;
    let R = curveAt(lut, r >= 255 ? 1 : r / 255), G = curveAt(lut, g >= 255 ? 1 : g / 255), B = curveAt(lut, b >= 255 ? 1 : b / 255);
    let W = 0;
    if (white) { W = R < G ? (R < B ? R : B) : (G < B ? G : B); if (sub) { R -= W; G -= W; B -= W; } }
    for (let k = 0; k < nc; k++) {
      const c = oi[k];
      let v = c === 0 ? R : c === 1 ? G : c === 2 ? B : c === 3 ? W * kw : (0.2126 * R + 0.7152 * G + 0.0722 * B) * kw;
      v = v <= 0 ? 0 : v >= 1 ? 65535 : Math.round(v * 65535);
      const L = lin + 2 * k, M = L + 1;
      unis[L >> 9].data[L & 511] = v >> 8;
      unis[M >> 9].data[M & 511] = v & 255;
    }
  }
}
function buildOutput() {
  const s = project.settings;
  for (const U of universes) U.data.fill(0);
  const m = ui.blackout ? 0 : s.master;
  const wm = s.whiteMode, groups = new Map(project.groups.map(g => [g.id, groupLevel(g)]));
  for (const f of project.fixtures) {
    const col = f._col, disp = f._disp, n = f._n, tr = f.trim;
    const dim = f.enabled ? m * f.dimmer * (f.group != null ? groups.get(f.group) ?? 1 : 1) : 0;   // and its group's dimmer
    const kr = dim * tr[0], kg = dim * tr[1], kb = dim * tr[2], kw = tr[3];
    const o = f._out;
    if (!o) { for (let j = 0; j < 3 * n; j += 3) { disp[j] = col[j] * kr; disp[j + 1] = col[j + 1] * kg; disp[j + 2] = col[j + 2] * kb; } continue; }
    if (f.bits === 16) { output16(f, o, kr, kg, kb, kw, wm); continue; }
    const lins = o.lin, oi = o.oi, nc = oi.length, unis = o.unis, lut = gammaLUT(f.gamma);
    const white = nc === 4 && wm !== 'off', sub = wm === 'sub';
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      disp[j] = col[j] * kr; disp[j + 1] = col[j + 1] * kg; disp[j + 2] = col[j + 2] * kb;
      const lin = lins[i];
      if (lin < 0) continue;
      let R = lut[disp[j]], G = lut[disp[j + 1]], B = lut[disp[j + 2]], W = 0;
      if (white) { W = Math.min(R, G, B); if (sub) { R -= W; G -= W; B -= W; } }
      for (let k = 0; k < nc; k++) {
        const c = oi[k], L = lin + k;
        unis[L >> 9].data[L & 511] = c === 0 ? R : c === 1 ? G : c === 2 ? B : c === 3 ? (kw === 1 ? W : Math.round(W * kw)) : Math.round((0.2126 * R + 0.7152 * G + 0.0722 * B) * kw);
      }
    }
  }
}
// The frame sent to the bridge: [u8 type=1][u8 flags][u16 count], then per universe [4 ip][u16 universe][u16 512][512 channels].
// It is laid out once per patch, and the channels of each universe that is sent live in it, so a frame is sent as is.
let outFrame = null;
function layoutFrame() {
  const list = universes.filter(u => u.enabled);
  const buf = new ArrayBuffer(4 + list.length * 520), u8 = new Uint8Array(buf), dv = new DataView(buf);
  u8[0] = 1; dv.setUint16(2, list.length, true);
  let off = 4;
  for (const U of list) {
    u8.set(U.ipb, off); dv.setUint16(off + 4, U.uni, true); dv.setUint16(off + 6, 512, true);
    const data = new Uint8Array(buf, off + 8, 512);
    data.set(U.data); U.data = data;
    off += 520;
  }
  outFrame = { buf, u8, count: list.length };
}
const outStats = { frames: 0, fps: 0, lastT: performance.now(), lastFrames: 0, dropped: 0, universes: 0 };
function sendFrame(black = false) {
  if (!bridge.connected || !outFrame) return;
  if (bridge.ws.bufferedAmount > 2e6) { outStats.dropped++; return; }
  outFrame.u8[1] = project.settings.artSync ? 1 : 0;
  let buf = outFrame.buf;
  if (black) { const b = outFrame.u8.slice(); for (let off = 4; off < b.length; off += 520) b.fill(0, off + 8, off + 520); buf = b.buffer; }
  outStats.universes = outFrame.count;
  try { bridge.ws.send(buf); outStats.frames++; } catch (e) { /* socket closing */ } // send copies the frame
}

/* ---------- clock ---------- */
let lastTick = performance.now();
let ticker = null;
let tickPeriod = 25, tickCost = 0, lastTickEnd = 0, lastTickTook = 0, mediaChecked = 0;
function tick() {
  const now = performance.now();
  // A frame that took longer than its period (a slow GPU, a huge project) would leave the page no time before the
  // next: then the next waits half a period, so the interface has time to answer. Frames that fit their period
  // follow each other on time, up to 100 a second.
  if (lastTickTook > tickPeriod && now - lastTickEnd < tickPeriod * 0.5) return;
  clockDT = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now; clockT += clockDT; frameIndex++;
  if (!project) return;
  if (geomDirty) rebuildGeometry();
  ensurePatch();
  if (!REMOTE_CLIENT) try { playlistTick(); } catch (e) { report('playlists', e); }   // on a device the main computer plays them
  sizeContent();
  if (ui.outputMode === 'content' || ui.showContent) try { renderContent(); } catch (e) { report('content', e); }
  if (ui.outputMode !== 'content') testPattern(ui.outputMode);
  try { updateThumbs(); } catch (e) { report('thumbnails', e); }
  if (now - mediaChecked > 1000) { mediaChecked = now; syncMedia(); syncStreams(); }
  try { videoTick(); } catch (e) { report('video', e); }
  buildOutput();
  if (ui.outputOn) sendFrame();
  lastTickEnd = performance.now(); lastTickTook = lastTickEnd - now;
  tickCost = tickCost * 0.9 + lastTickTook * 0.1;
  const el = now - outStats.lastT;
  if (el > 1000) { outStats.fps = (outStats.frames - outStats.lastFrames) * 1000 / el; outStats.lastFrames = outStats.frames; outStats.lastT = now; }
}
// The frames are timed in a worker, whose timers keep going while the window is in the background. It sends one
// frame at a time: the next waits until this page has taken the last one, so frames can't pile up behind a slow
// one, and the page takes each as it starts it, so a frame that needs most of its period still leaves the next on
// time. Deadlines keep the rate even; after a long stall the clock goes on a period from now instead of catching up.
const CLOCK_WORKER = `let timer = null, period = 25, next = 0, waiting = false;
const arm = () => { clearTimeout(timer); timer = setTimeout(() => { waiting = true; postMessage(0); }, Math.max(0, next - performance.now())); };
onmessage = e => {
  const now = performance.now();
  if (e.data === 'took') { waiting = false; next += period; if (next < now - 2 * period) next = now + period; arm(); }
  else { period = e.data; next = now + period; if (!waiting) arm(); }
};`;
function startClock() {
  const period = 1000 / clamp(project.settings.fps, 1, 100);
  tickPeriod = period;
  if (!ticker) {
    try {
      const url = URL.createObjectURL(new Blob([CLOCK_WORKER], { type: 'text/javascript' }));
      ticker = new Worker(url);
      URL.revokeObjectURL(url);
      ticker.onmessage = () => { ticker.postMessage('took'); tick(); };
    } catch (e) {
      // no worker: the same deadlines on this page's own timer
      ticker = { postMessage(p) {
        clearTimeout(this.t); let next = performance.now() + p;
        const run = () => { try { tick(); } finally { next += p; const now = performance.now(); if (next < now - 2 * p) next = now + p; this.t = setTimeout(run, Math.max(0, next - now)); } };
        this.t = setTimeout(run, p);
      } };
    }
  }
  ticker.postMessage(period);
}

/* ---------- bridge (WebSocket to noupix.py) ---------- */
const bridge = { ws: null, connected: false, started: false, state: 'idle', hello: null, stats: null, nodes: new Map(), retry: null, lastError: '' };
function bridgeUrl() {
  if (project.settings.bridgeUrl) return project.settings.bridgeUrl.trim();
  if (/^https?:$/.test(location.protocol) && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname)) return `ws://${location.host}/ws`;
  if (location.protocol === 'file:') return 'ws://127.0.0.1:8080/ws';
  if (/^https?:$/.test(location.protocol) && location.port && !/claude/.test(location.hostname)) return `ws://${location.host}/ws`;
  return null;
}
function connectBridge() {
  if (REMOTE_CLIENT) { connectRemote(); return; }   // a device: it talks to the main computer, not to Art-Net
  clearTimeout(bridge.retry);
  if (bridge.ws) { try { bridge.ws.onclose = null; bridge.ws.close(); } catch (e) {} bridge.ws = null; }
  bridge.connected = false;
  const url = bridgeUrl();
  if (!url) { bridge.state = 'none'; updateBridgeUI(); return; }
  bridge.state = 'connecting'; bridge.since = Date.now(); updateBridgeUI();
  setTimeout(updateBridgeUI, 1600);   // only a connection that takes longer than a moment is shown
  let ws;
  try { ws = new WebSocket(url); } catch (e) { bridge.state = 'none'; updateBridgeUI(); return; }
  ws.binaryType = 'arraybuffer';
  bridge.ws = ws;
  ws.onopen = () => {
    bridge.connected = true; bridge.state = 'ok'; bridgeSend({ t: 'output', on: ui.outputOn }); updateBridgeUI();
    // Art-Net is on from the start: the first time this page reaches its bridge, it starts sending
    if (!bridge.started && !REMOTE_CLIENT) { bridge.started = true; setOutput(true); }
  };
  ws.onmessage = ev => {
    if (typeof ev.data !== 'string') { streamFrame(ev.data); return; }   // a frame of an NDI or OMT stream (streams.js)
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'hello') { bridge.hello = m; showVersion(m.version); (m.nodes || []).forEach(n => bridge.nodes.set(n.ip + '#' + n.bindIndex, n)); updateBridgeUI(); if (ui.dockTab === 'nodes') renderDock(); remoteHello(m.remote); if (m.startupProject) openStartupProject(m.startupProject); }
    else if (m.t === 'stats') { bridge.stats = m; updateBridgeUI(); }
    else if (m.t === 'node') { bridge.nodes.set(m.node.ip + '#' + m.node.bindIndex, m.node); if (ui.dockTab === 'nodes') renderDock(); }
    else if (m.t === 'polled') {
      if (bridge.hello && Array.isArray(m.nets)) bridge.hello.nets = m.nets;
      toast(m.targets.length ? 'ArtPoll sent to ' + m.targets.join(', ') : 'ArtPoll not sent: no network to send it on', m.targets.length ? '' : 'warn');
      if (ui.dockTab === 'nodes') renderDock();
    }
    else if (m.t === 'error') { toast(m.msg, 'warn'); }
    else if (m.t === 'vin') streamMessage(m);
    else if (m.t === 'takeover' && ui.outputOn) { ui.outputOn = false; keepAwake(false); updateBridgeUI(); toast('Art-Net was switched on in another nouPix window, so this window stopped sending.', 'warn'); }
    else remoteHostMessage(m);
  };
  ws.onclose = () => {
    const was = bridge.connected;
    bridge.connected = false; bridge.state = 'connecting'; bridge.ws = null;
    if (was) toast('Lost the connection to the Art-Net output. Retrying…', 'warn');
    remote.status = null; remote.clients.clear();
    updateBridgeUI(); updateRemoteUI();
    bridge.retry = setTimeout(connectBridge, 2000);
  };
}
function bridgeSend(obj) { if (bridge.connected) bridge.ws.send(JSON.stringify(obj)); }
