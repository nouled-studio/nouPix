// openLedMapper · js/remote.js
// Remote control: other devices on the network use this project through the main window. The main window (the host)
// keeps the project and sends Art-Net; devices log in as programmer, operator or remote (phones), send it changes,
// and get the project back. This page is either the host or, opened from a device at /app, a client.

/* ---------- state ---------- */
const REMOTE_PORT = 8090;
const REMOTE_CLIENT = /^\/app\/?$/.test(location.pathname);   // this page was opened from another device
const remote = {
  role: null,        // as a client: 'programmer' or 'operator'
  token: null, cid: null, hostOn: false, loaded: false, applying: false, bye: '',
  // as the host: what the user set (kept in this browser) and what the bridge reports
  cfg: { on: false, port: REMOTE_PORT, password: '' },
  status: null,      // { on, port, urls, error, clients, hasPassword }
  clients: new Map(),   // cid -> { role, addr }
  acks: {},             // cid -> the number of the last project change from that device that was applied here
  seq: 0,               // as a client: the number of the last project change sent
};
// The operator sees the mapping but cannot change it: fixtures, patch, controllers, zone areas, settings
const mappingLocked = () => remote.role === 'operator';
const isRemoteClient = () => REMOTE_CLIENT;
function remoteLoadCfg() {
  const c = store.get('openledmapper.remote', {});
  remote.cfg = { on: !!(c && c.on), port: clamp(Math.round(numOr(c && c.port, REMOTE_PORT)), 1024, 65535), password: typeof (c && c.password) === 'string' ? c.password : '' };
}
function remoteSaveCfg() { store.set('openledmapper.remote', remote.cfg); }

/* ---------- the host ---------- */
// Switches remote control on or off (or changes its port or password) on the bridge
function remoteConfigure() {
  remoteSaveCfg();
  if (bridge.connected) bridgeSend(Object.assign({ t: 'remote' }, remote.cfg));
  updateRemoteUI();
}
// The bridge (re)connected: it says whether remote control is on; switch it on if it was on when this window closed
function remoteHello(st) {
  remote.status = st || null;
  if (remote.cfg.on) remoteConfigure(); else updateRemoteUI();
}
// Messages from the bridge about remote control, on the host
function remoteHostMessage(m) {
  if (m.t === 'remote') {
    remote.status = m;
    remote.clients = new Map((m.clients || []).map(c => [c.cid, c]));
    if (m.error) toast('Remote control: ' + m.error, 'err');
    updateRemoteUI();
  } else if (m.t === 'rjoin') {
    remote.clients.set(m.cid, { cid: m.cid, role: m.role, addr: m.addr });
    remoteWelcome(m.cid, m.role);
    updateRemoteUI();
  } else if (m.t === 'rleave') {
    remote.clients.delete(m.cid); delete remote.acks[m.cid];
    updateRemoteUI();
  } else if (m.t === 'rmsg') { remoteFromDevice(m.cid, m.role, m.m); return true; }
  else return false;
  if (ui.rightTab === 'settings' && !document.activeElement.closest?.('#rightBody')) renderRight();   // its address and devices
  return true;
}
const remoteSend = (to, roles, m) => bridgeSend({ t: 'rout', to, roles, m });
const FULL_ROLES = ['programmer', 'operator'];
const PLAYLIST_DO = ['toggle', 'start', 'play', 'pause', 'resume', 'next', 'prev', 'stop'];   // every role may play the playlists
const hasClients = roles => [...remote.clients.values()].some(c => roles.includes(c.role));
// What every device shows besides the project: the master level, blackout, and where the playlists are, which live
// outside the project
const remoteLive = () => ({ t: 'live', master: project.settings.master, blackout: ui.blackout, output: ui.outputOn, play: playState() });
// What the phones show: each zone (top first) with its scenes, the scene playing, its level, its content, its
// playlists and the one playing
function remoteState() {
  const name = id => { const s = srcById(id); return s ? s.name : null; };
  return { t: 'state', name: project.name, master: project.settings.master, blackout: ui.blackout,
    zones: project.zones.slice().reverse().map(z => ({ id: z.id, name: z.name, tag: z.tag, opacity: z.opacity, scene: z.scene,
      scenes: z.scenes.map(sc => ({ id: sc.id, name: sc.name, tag: sc.tag, fade: sc.fade })),
      content: z.layers.filter(L => L.on && L.src && name(L.src)).map(L => name(L.src)),
      playlists: z.playlists.map(pl => ({ id: pl.id, name: pl.name, length: playlistLength(pl), steps: pl.steps.length })),
      play: playForPhone(z) })) };
}
function remoteWelcome(cid, role) {
  if (FULL_ROLES.includes(role)) remoteSend(cid, null, { t: 'project', data: serialize(false), live: remoteLive(), acks: remote.acks });
  else remoteSend(cid, null, remoteState());
}
// After every change on the host: the project to the programmers and operators, the state to the phones.
// Several changes in a row go out once, a moment after the first.
let remoteTimer = null, remoteLast = '';
function remoteChanged() {
  if (REMOTE_CLIENT) return remoteClientChanged();
  if (!remote.clients.size || remoteTimer) return;
  remoteTimer = setTimeout(() => {
    remoteTimer = null;
    if (!bridge.connected) return;
    if (hasClients(FULL_ROLES)) {
      const data = serialize(false), key = data + JSON.stringify(remote.acks);
      if (key !== remoteLast) { remoteLast = key; remoteSend(null, FULL_ROLES, { t: 'project', data, acks: remote.acks }); }
    }
    if (hasClients(['remote'])) remoteSend(null, ['remote'], remoteState());
  }, 80);
}
function remoteLiveChanged() {
  if (REMOTE_CLIENT || !remote.clients.size || !bridge.connected) return;
  remoteSend(null, FULL_ROLES, remoteLive());
  remoteChanged();
}
// A change from a device. What it may change depends on its role, which the bridge gives (not the device).
function remoteFromDevice(cid, role, m) {
  if (!isObj(m)) return;
  const z = typeof m.zone === 'string' ? zoneById(m.zone) : null;
  if (m.op === 'scene' && z) {
    const sc = z.scenes.find(s => s.id === m.scene);
    if (sc) goScene(z, sc, !!m.cut);
  } else if (m.op === 'playlist' && z && PLAYLIST_DO.includes(m.do)) {
    const pl = z.playlists.find(p => String(p.id) === String(m.list)) || null;
    if (pl || !['toggle', 'start', 'play'].includes(m.do)) playlistDo(z, pl, m.do, clamp(Math.round(numOr(m.i, 0)), 0, 1e6));
  } else if (m.op === 'opacity' && z && isFinite(m.value)) {
    setZoneOpacity(z, clamp(+m.value, 0, 1));
    remoteChanged(); commitSoft();
  } else if (m.op === 'master' && role !== 'remote' && isFinite(m.value)) {
    project.settings.master = clamp(+m.value, 0, 1);
    $('#master').value = project.settings.master; $('#masterVal').textContent = pct(project.settings.master);
    saveSoon(); remoteLiveChanged();
  } else if (m.op === 'blackout' && role !== 'remote') {
    if (!!m.on !== ui.blackout) toggleBlackout();
  } else if (m.op === 'project' && typeof m.data === 'string' && FULL_ROLES.includes(role)) {
    if (isFinite(m.seq)) remote.acks[cid] = Math.max(remote.acks[cid] || 0, +m.seq);   // that device's change is in from now on
    let data = m.data;
    try { data = role === 'operator' ? contentOf(data) : keepLocal(data); } catch (e) { return; }
    if (data === serialize(false)) { remoteWelcome(cid, role); return; }   // nothing new: just put that device right
    try { restore(data); } catch (e) { report('a change from a remote device', e); remoteWelcome(cid, role); return; }
    pushHistory(); remoteChanged();   // the others get it, and that device hears its change is in
  }
}
// Where this window finds its Art-Net bridge stays this window's own, whatever a device sends
function keepLocal(data) {
  const d = JSON.parse(data);
  if (!isObj(d)) throw new Error('not a project');
  if (isObj(d.settings)) d.settings.bridgeUrl = project.settings.bridgeUrl;
  return JSON.stringify(d);
}
// From an operator's project, only the content goes in: each zone's layers, scenes, scene playing, level and
// playlists, and the shaders. Everything else (fixtures, groups, patch, controllers, zone areas and names, settings,
// files) stays.
function contentOf(data) {
  const d = JSON.parse(data), p = JSON.parse(serialize(false));
  if (!isObj(d)) throw new Error('not a project');
  const theirs = new Map((Array.isArray(d.zones) ? d.zones : []).filter(isObj).map(z => [z.id, z]));
  for (const z of p.zones) {
    const o = theirs.get(z.id);
    if (!o) continue;
    for (const k of ['layers', 'scenes', 'scene', 'opacity', 'playlists']) if (k in o) z[k] = o[k];
  }
  const shaders = (Array.isArray(d.sources) ? d.sources : []).filter(s => isObj(s) && !s.builtin && s.kind === 'isf');
  p.sources = p.sources.filter(s => s.builtin || s.kind !== 'isf').concat(shaders);
  return JSON.stringify(p);
}

/* ---------- a client (this page opened from another device) ---------- */
function connectRemote() {
  clearTimeout(bridge.retry);
  remote.token = sessionStorage.getItem('olm.remote.token');
  if (!remote.token) { location.replace('/'); return; }
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rws?token=${encodeURIComponent(remote.token)}`);
  bridge.ws = ws; bridge.state = 'connecting';
  ws.onopen = () => { bridge.connected = true; bridge.state = 'ok'; };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'hello') {
      remote.role = m.role; remote.cid = m.cid; remote.hostOn = m.host; showVersion(m.version);
      document.body.classList.toggle('ro-map', mappingLocked());
      remoteOverlay(); updateRemoteUI();
    } else if (m.t === 'denied') { sessionStorage.removeItem('olm.remote.token'); location.replace('/'); }
    else if (m.t === 'bye') { remote.bye = m.reason || 'Disconnected.'; remoteOverlay(); }
    else if (m.t === 'host') { remote.hostOn = m.on; remoteOverlay(); updateRemoteUI(); }
    else if (m.t === 'project') { remote.hostOn = true; remoteApply(m.data, m.acks && m.acks[remote.cid]); if (m.live) remoteApplyLive(m.live); remoteOverlay(); }
    else if (m.t === 'live') remoteApplyLive(m);
  };
  ws.onclose = () => {
    bridge.connected = false; bridge.ws = null; bridge.state = 'connecting';
    updateRemoteUI();
    if (!remote.bye) { remote.hostOn = false; remoteOverlay(); bridge.retry = setTimeout(connectRemote, 2000); }
  };
}
// The project from the host replaces this one; selection and view stay, and it is one step of undo here.
// A copy made before the host had this device's last change (ack is the number of the last one it had) is a step
// behind: it is skipped, a newer one follows. While the user drags or types, the newest copy waits until that is over,
// so nothing jumps under the pointer.
let remoteDown = false, remoteHeld = null, remoteHeldTimer = null;
function remoteApply(data, ack) {
  if (remote.loaded && (ack || 0) < remote.seq) return;
  remoteHeld = { data, ack };
  clearTimeout(remoteHeldTimer);
  const busy = remote.loaded && (remoteDown || remoteOut || typingIn(document.activeElement));
  if (busy) { remoteHeldTimer = setTimeout(() => { const h = remoteHeld; if (h) remoteApply(h.data, h.ack); }, 200); return; }
  remoteHeld = null;
  if (remote.loaded && data === serialize(false)) return;
  remote.applying = true;
  try {
    if (!remote.loaded) { loadProject(JSON.parse(data)); remote.loaded = true; }
    else { restore(data); pushHistory(); }
  } finally { remote.applying = false; }
  redrawStage();
}
if (REMOTE_CLIENT) {
  addEventListener('pointerdown', () => { remoteDown = true; }, true);
  addEventListener('pointerup', () => { remoteDown = false; }, true);
  addEventListener('pointercancel', () => { remoteDown = false; }, true);
  // sliders and fields reach the host while they move, not only when let go
  addEventListener('input', () => remoteClientChanged(), true);
}
function remoteApplyLive(m) {
  if (isObj(m.play)) applyPlayState(m.play);
  if (isFinite(m.master)) { project.settings.master = m.master; $('#master').value = m.master; $('#masterVal').textContent = pct(m.master); }
  if (!!m.blackout !== ui.blackout) { ui.blackout = !!m.blackout; $('#btnBlackout').classList.toggle('on', ui.blackout); $('#btnBlackout').setAttribute('aria-pressed', ui.blackout); }
}
// A change made here goes to the host: at most about ten times a second while it goes on, and once at the end
let remoteOut = null;
function remoteClientChanged() {
  if (remote.applying || !remote.loaded || remoteOut) return;
  remoteOut = setTimeout(() => { remoteOut = null; remoteOp({ op: 'project', data: serialize(false), seq: ++remote.seq }); }, 80);
}
function remoteOp(m) { if (bridge.connected && bridge.ws) bridge.ws.send(JSON.stringify(m)); }
function remoteLogout() { sessionStorage.removeItem('olm.remote.token'); location.replace('/'); }
