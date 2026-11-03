// nouPix · js/ui-touch.js
// The Interact window: a black pad in a window of its own (olm-touch, drawn by this page like the MIDI window) where
// the mouse, or fingers on a touch screen, move the interactive content of a zone (touch.js). Opened from the
// Parameters of an effect that follows touch; on a device (programmer, operator) the fingers go to the main window.
// The Remote page has its own pad (remote-app.js).

let touchWin = null, touchZoneId = null;
const touchWinOpen = () => !!(touchWin && !touchWin.closed);
// Where the fingers are: to this page's touch, or the main window's from a device
function touchSend(zoneId, pts) {
  if (REMOTE_CLIENT) remoteOp({ op: 'touch', zone: zoneId, pts });
  else touchInput(zoneId, pts);
}
function openTouchPad(z) {
  if (!z) return;
  if (touchWinOpen()) { if (touchZoneId !== z.id) { touchSend(touchZoneId, []); touchZoneId = z.id; drawTouchPad(); } raiseWindow(touchWin); return; }
  const w = window.open('', 'olm-touch', 'popup,width=900,height=560');
  if (!w) { toast('The Interact window could not open: allow pop-up windows for this page.', 'err'); return; }
  touchWin = w; touchZoneId = z.id;
  dressWindow(w, 'Interact · nouPix', 'touchwin');
  w.addEventListener('pagehide', () => { if (touchWin === w) { touchSend(touchZoneId, []); touchWin = null; } });
  drawTouchPad();
}
addEventListener('pagehide', () => { if (touchWinOpen()) touchWin.close(); });
setInterval(() => { if (touchWin && touchWin.closed) { touchSend(touchZoneId, []); touchWin = null; } }, 500);
// The pad: the whole window black, the fingers shown as soft rings, the zone's name in a corner
function drawTouchPad() {
  if (!touchWinOpen()) return;
  const d = touchWin.document, z = zoneById(touchZoneId);
  const cv = h('canvas'), label = h('div', { class: 'tlabel' }, `Interact · ${z ? z.name : ''}`, h('span', null, 'Drag here: with the mouse, or fingers on a touch screen'));
  const pad = h('div', { class: 'tpad' }, cv, label);
  d.body.replaceChildren(pad);
  const fingers = new Map(), win = touchWin;
  let keep = 0, last = 0, pending = 0;
  const send = () => {
    pending = 0; last = performance.now();
    // the window gone (closed while a finger was down): its fingers lift, and nothing more is sent
    if (!touchWinOpen() || touchWin !== win || !cv.isConnected) { if (!fingers.size) return; fingers.clear(); clearInterval(keep); keep = 0; }
    const r = cv.getBoundingClientRect();
    touchSend(touchZoneId, [...fingers].map(([id, f]) => [id, clamp(f.x / r.width, 0, 1), clamp(f.y / r.height, 0, 1)]));
  };
  // at most about 60 a second; and while a finger is held still, now and then, so it isn't taken as gone
  const soon = () => { if (performance.now() - last > 16) send(); else if (!pending) pending = setTimeout(send, 16); };
  const at = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); fingers.set(e.pointerId, at(e)); label.classList.add('gone'); soon();
    if (!keep) keep = setInterval(() => { if (fingers.size) send(); else { clearInterval(keep); keep = 0; } }, 500);
  });
  cv.addEventListener('pointermove', e => { if (!fingers.has(e.pointerId)) return; fingers.set(e.pointerId, at(e)); soon(); });
  const up = e => { if (!fingers.delete(e.pointerId)) return; clearTimeout(pending); send(); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  // the rings, drawn while the window is open
  const g = cv.getContext('2d');
  let map = [], mapAt = -1;
  const paint = () => {
    if (!touchWinOpen() || touchWin !== win || !cv.isConnected) return;
    const r = cv.getBoundingClientRect(), dpr = win.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, r.width, r.height);
    // the zone's fixtures, faintly, so the finger knows where they are (again when they move)
    if (mapAt !== geomVersion) { mapAt = geomVersion; map = touchMap(zoneById(touchZoneId)); }
    const dot = Math.max(1.5, Math.min(3, Math.sqrt(r.width * r.height / Math.max(1, map.length / 2)) * 0.25));
    g.fillStyle = 'rgba(255,255,255,0.28)';
    for (let i = 0; i < map.length; i += 2) g.fillRect(map[i] * r.width - dot / 2, map[i + 1] * r.height - dot / 2, dot, dot);
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5;
    for (const f of fingers.values()) { g.beginPath(); g.arc(f.x, f.y, 22, 0, Math.PI * 2); g.stroke(); }
    win.requestAnimationFrame(paint);
  };
  win.requestAnimationFrame(paint);
}
// In an effect's Parameters: that it follows touch, and the button that opens the pad for the layer's zone
function touchNote(z) {
  return h('div', { class: 'tnote' }, h('span', null, 'Interactive: follows a finger or the mouse on a pad.'),
    h('button', { class: 'btn sm', type: 'button', title: 'Open a pad to drag on; on a phone, Interact on the Remote page', onclick: () => openTouchPad(z) }, 'Interact'));
}
