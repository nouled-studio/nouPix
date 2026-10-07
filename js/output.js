// openLedMapper · js/output.js
// Output: gamma, turning sampled colours into DMX channels (buildOutput), the outgoing frame, the clock that
// renders and sends every tick, and the WebSocket to the bridge (openledmapper.py), which sends Art-Net.

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
function buildOutput() {
  const s = project.settings;
  for (const U of universes) U.data.fill(0);
  const m = ui.blackout ? 0 : s.master;
  const wm = s.whiteMode;
  for (const f of project.fixtures) {
    const col = f._col, disp = f._disp, n = f._n, tr = f.trim;
    const dim = f.enabled ? m * f.dimmer : 0;
    const kr = dim * tr[0], kg = dim * tr[1], kb = dim * tr[2], kw = tr[3];
    const o = f._out;
    if (!o) { for (let j = 0; j < 3 * n; j += 3) { disp[j] = col[j] * kr; disp[j + 1] = col[j + 1] * kg; disp[j + 2] = col[j + 2] * kb; } continue; }
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
let tickPeriod = 25, tickCost = 0, lastTickEnd = 0, mediaChecked = 0;
function tick() {
  const now = performance.now();
  // Worker ticks queue up if a frame takes longer than the period (slow GPU, huge composition).
  // Drop the backlog so the interface stays responsive; the frame rate then degrades gracefully.
  if (now - lastTickEnd < tickPeriod * 0.5) return;
  clockDT = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now; clockT += clockDT; frameIndex++;
  if (!project) return;
  if (geomDirty) rebuildGeometry();
  ensurePatch();
  sizeContent();
  if (ui.outputMode === 'content' || ui.showContent) try { renderContent(); } catch (e) { report('content', e); }
  if (ui.outputMode !== 'content') testPattern(ui.outputMode);
  try { updateThumbs(); } catch (e) { report('thumbnails', e); }
  if (now - mediaChecked > 1000) { mediaChecked = now; syncMedia(); }
  try { videoTick(); } catch (e) { report('video', e); }
  buildOutput();
  if (ui.outputOn) sendFrame();
  lastTickEnd = performance.now();
  tickCost = tickCost * 0.9 + (lastTickEnd - now) * 0.1;
  const el = now - outStats.lastT;
  if (el > 1000) { outStats.fps = (outStats.frames - outStats.lastFrames) * 1000 / el; outStats.lastFrames = outStats.frames; outStats.lastT = now; }
}
function startClock() {
  const period = 1000 / clamp(project.settings.fps, 1, 100);
  tickPeriod = period;
  if (!ticker) {
    try {
      const url = URL.createObjectURL(new Blob(['let iv=null;onmessage=e=>{clearInterval(iv);iv=setInterval(()=>postMessage(0),e.data)}'], { type: 'text/javascript' }));
      ticker = new Worker(url);
      ticker.onmessage = tick;
    } catch (e) {
      ticker = { postMessage(p) { clearInterval(this.iv); this.iv = setInterval(tick, p); } };
    }
  }
  ticker.postMessage(period);
}

/* ---------- bridge (WebSocket to openledmapper.py) ---------- */
const bridge = { ws: null, connected: false, state: 'idle', hello: null, stats: null, nodes: new Map(), retry: null, lastError: '' };
function bridgeUrl() {
  if (project.settings.bridgeUrl) return project.settings.bridgeUrl.trim();
  if (/^https?:$/.test(location.protocol) && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname)) return `ws://${location.host}/ws`;
  if (location.protocol === 'file:') return 'ws://127.0.0.1:8080/ws';
  if (/^https?:$/.test(location.protocol) && location.port && !/claude/.test(location.hostname)) return `ws://${location.host}/ws`;
  return null;
}
function connectBridge() {
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
  ws.onopen = () => { bridge.connected = true; bridge.state = 'ok'; bridgeSend({ t: 'output', on: ui.outputOn }); updateBridgeUI(); };
  ws.onmessage = ev => {
    if (typeof ev.data !== 'string') return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'hello') { bridge.hello = m; showVersion(m.version); (m.nodes || []).forEach(n => bridge.nodes.set(n.ip + '#' + n.bindIndex, n)); updateBridgeUI(); if (ui.dockTab === 'nodes') renderDock(); }
    else if (m.t === 'stats') { bridge.stats = m; updateBridgeUI(); }
    else if (m.t === 'node') { bridge.nodes.set(m.node.ip + '#' + m.node.bindIndex, m.node); if (ui.dockTab === 'nodes') renderDock(); }
    else if (m.t === 'polled') {
      if (bridge.hello && Array.isArray(m.nets)) bridge.hello.nets = m.nets;
      toast(m.targets.length ? 'ArtPoll sent to ' + m.targets.join(', ') : 'ArtPoll not sent: no network to send it on', m.targets.length ? '' : 'warn');
      if (ui.dockTab === 'nodes') renderDock();
    }
    else if (m.t === 'error') { toast(m.msg, 'warn'); }
    else if (m.t === 'takeover' && ui.outputOn) { ui.outputOn = false; keepAwake(false); updateBridgeUI(); toast('Art-Net was switched on in another openLedMapper window, so this window stopped sending.', 'warn'); }
  };
  ws.onclose = () => {
    const was = bridge.connected;
    bridge.connected = false; bridge.state = 'connecting'; bridge.ws = null;
    if (was) toast('Lost the connection to the Art-Net output. Retrying…', 'warn');
    updateBridgeUI();
    bridge.retry = setTimeout(connectBridge, 2000);
  };
}
function bridgeSend(obj) { if (bridge.connected) bridge.ws.send(JSON.stringify(obj)); }
