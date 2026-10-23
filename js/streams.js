/* ---------- video from the network: NDI and OMT ---------- */
// A browser can't receive NDI or OMT (Open Media Transport), so the bridge does (noupix.py, VideoIn) and sends each frame as a binary message:
//   'VIN1' | key length (1 byte) | key | width, height (2 bytes each, big-endian) | RGBA pixels
// A stream source ({ kind: 'stream', proto: 'ndi' or 'omt', stream: its name on the network, name: shown in the list, hq, fit }) shows its frames through a canvas in mediaEls,
// as a video shows its element, so zones, layers, scenes and thumbnails take it like any other media.
const STREAM_PROTOS = { ndi: 'NDI', omt: 'OMT' };
const streams = {
  found: [],          // [{ proto, name }]: what the bridge last saw on the network
  info: null,         // per protocol: { ok, note } (installed or not, and why)
  status: {},         // key -> { state: 'connecting' | 'waiting' | 'ok' | 'error', size }
  canvases: new Map(),  // key -> canvas with its newest frame
  keys: null, ws: null, onFound: null,
};
const streamKey = s => `${s.proto}|${String(s.stream).slice(0, 120)}|${s.hq ? 1 : 0}`;
const isStream = s => !!s && s.kind === 'stream';

// The streams this window wants: every stream source in the project. Asked for again when that list changes or the
// bridge reconnects; a device (REMOTE_CLIENT) never asks, the main computer plays them.
function syncStreams() {
  if (REMOTE_CLIENT || !bridge.connected) return;
  const want = project.sources.filter(s => isStream(s) && s.stream);
  const keys = [...new Set(want.map(streamKey))].sort().join('\n');
  if (keys === streams.keys && streams.ws === bridge.ws) return;
  streams.keys = keys; streams.ws = bridge.ws;
  const seen = new Set(), subs = [];
  for (const s of want) if (!seen.has(streamKey(s)) && seen.add(streamKey(s))) subs.push({ proto: s.proto, name: s.stream, hq: !!s.hq });
  bridgeSend({ t: 'vin', op: 'sub', subs });
  // a source whose stream changed (another name, quality) or that's gone lets go of the old picture
  for (const k of [...streams.canvases.keys()]) if (!seen.has(k)) streams.canvases.delete(k);
  for (const [id, el] of [...mediaEls]) if (el._streamKey) { const s = srcById(id); if (!isStream(s) || streamKey(s) !== el._streamKey) { mediaEls.delete(id); if (s) markThumb(s); } }
}
function findStreams() { bridgeSend({ t: 'vin', op: 'find' }); }

// A frame from the bridge: into its canvas, which every source of that stream shows
function streamFrame(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 9 || b[0] !== 86 || b[1] !== 73 || b[2] !== 78 || b[3] !== 49) return;   // 'VIN1'
  const n = b[4], key = new TextDecoder().decode(b.subarray(5, 5 + n)), dv = new DataView(buf, 5 + n, 4);
  const w = dv.getUint16(0), hh = dv.getUint16(2);
  if (!w || !hh || b.length < 9 + n + w * hh * 4 || !(streams.keys || '').split('\n').includes(key)) return;
  let c = streams.canvases.get(key), fresh = false;
  if (!c) { c = document.createElement('canvas'); c.width = c.height = 0; c._streamKey = key; streams.canvases.set(key, c); }
  if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; fresh = true; }
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf, 9 + n, w * hh * 4), w, hh), 0, 0);
  c._at = performance.now();
  c._frames = (c._frames || 0) + 1;
  for (const s of project.sources) if (isStream(s) && streamKey(s) === key && mediaEls.get(s.id) !== c) { mediaEls.set(s.id, c); fresh = true; markThumb(s); }
  if (fresh) renderSrcList();
  // the thumbnails follow a few times a second
  if (c._frames % 8 === 0) for (const s of project.sources) if (isStream(s) && streamKey(s) === key) markThumb(s);
}
// The bridge's answers: the sources found, and how each stream is doing
function streamMessage(m) {
  if (Array.isArray(m.sources)) {
    streams.found = m.sources.filter(s => isObj(s) && STREAM_PROTOS[s.proto] && typeof s.name === 'string');
    streams.info = isObj(m.info) ? m.info : null;
    if (streams.onFound) streams.onFound();
  }
  if (isObj(m.status)) {
    const was = JSON.stringify(streams.status);
    streams.status = m.status;
    if (JSON.stringify(m.status) !== was && project.sources.some(isStream)) { renderSrcList(); if (ui.rightTab === 'content') renderRight(); }
  }
}
// A stream source's state, for the list and the Content tab: 'ok', 'waiting' (no frames for a while), 'connecting',
// 'error', or 'off' (no bridge, or a device)
function streamState(s) {
  if (REMOTE_CLIENT || !bridge.connected) return 'off';
  const st = streams.status[streamKey(s)];
  return st ? st.state : 'connecting';
}
