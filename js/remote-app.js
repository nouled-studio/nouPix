// openLedMapper · js/remote-app.js
// The remote page for phones, tablets and computers: each zone with what plays in it, a dimmer, and its scenes.
// The programmer makes the zones and scenes in openLedMapper; this page only plays and dims them.
'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'style') for (const [p, x] of Object.entries(v)) { if (p.startsWith('--')) e.style.setProperty(p, x); else e.style[p] = x; }
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
    return e;
  };
  let ws = null, token = sessionStorage.getItem('olm.remote.token'), role = null, state = null, hostOn = false, bye = '', retry = null, relogged = false;
  const dragging = new Map();   // zone id -> the level being dragged here (the main computer's echo waits)

  function wait(text) { $('#wait').hidden = !text; if (text) $('#waitMsg').textContent = text; $('#wait').querySelector('.spin').hidden = !!bye; }
  function conn(ok, text) { $('#conn').classList.toggle('ok', ok); $('#conn span').textContent = text; $('#conn').title = text; $('#conn').setAttribute('aria-label', text); }
  function status() {
    if (bye) { wait(bye); conn(false, 'Disconnected'); return; }
    if (!ws || ws.readyState !== 1) { wait('Connecting to openLedMapper…'); conn(false, 'Connecting'); return; }
    if (!hostOn) { wait('Waiting for openLedMapper on the main computer.'); conn(false, 'Waiting'); return; }
    wait(state ? '' : 'Loading…'); conn(true, 'Live');
  }
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  async function login() {
    const r = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'remote' }) });
    const d = await r.json();
    if (!d.token) throw new Error(d.error || 'no token');
    token = d.token; sessionStorage.setItem('olm.remote.token', token);
  }
  async function connect() {
    clearTimeout(retry);
    try { if (!token) await login(); } catch (e) { status(); retry = setTimeout(connect, 2000); return; }
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rws?token=${encodeURIComponent(token)}`);
    ws.onopen = status;
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'hello') { role = m.role; hostOn = m.host; relogged = false; status(); }
      else if (m.t === 'denied') { token = null; sessionStorage.removeItem('olm.remote.token'); if (!relogged) { relogged = true; ws.onclose = null; ws.close(); connect(); } }
      else if (m.t === 'host') { hostOn = m.on; status(); }
      else if (m.t === 'bye') { bye = m.reason || 'Disconnected.'; token = null; sessionStorage.removeItem('olm.remote.token'); status(); }
      else if (m.t === 'state') { hostOn = true; state = m; render(); status(); }
    };
    ws.onclose = () => { status(); if (!bye) retry = setTimeout(connect, 2000); };
  }

  // ---- the page
  function render() {
    $('#pname').textContent = state.name || 'openLedMapper';
    document.title = (state.name ? state.name + ' · ' : '') + 'openLedMapper Remote';
    $('#bo').hidden = !state.blackout;
    const zones = $('#zones');
    const cards = new Map([...zones.children].map(c => [c.dataset.id, c]));
    const order = [];
    for (const z of state.zones) {
      const card = cards.get(z.id) || makeCard(z);
      updateCard(card, z);
      order.push(card);
    }
    if (!state.zones.length) order.push(el('p', { class: 'empty' }, 'No zones in this project yet. The programmer adds them in openLedMapper.'));
    // cards move only when the zones change order: moving a card would stop a finger dragging its dimmer
    if (order.length !== zones.children.length || order.some((c, i) => zones.children[i] !== c)) zones.replaceChildren(...order);
  }
  function makeCard(z) {
    const range = el('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': z.name + ' level' });
    const pc = el('span', { class: 'pc' });
    let last = 0, pending = null;
    const out = () => { pending = null; last = Date.now(); send({ op: 'opacity', zone: card.dataset.id, value: dragging.get(card.dataset.id) }); };
    range.addEventListener('input', () => {
      const v = range.value / 100;
      dragging.set(card.dataset.id, v);
      paintLevel(card, v);
      if (Date.now() - last > 60) out(); else if (!pending) pending = setTimeout(out, 60);   // live, about 15 times a second
    });
    const done = () => { if (!dragging.has(card.dataset.id)) return; clearTimeout(pending); out(); setTimeout(() => dragging.delete(card.dataset.id), 400); };
    range.addEventListener('change', done);
    range.addEventListener('pointerup', done);
    const card = el('section', { class: 'zone', 'data-id': z.id },
      el('div', { class: 'zhead' }, el('b'), el('div', { class: 'now' })),
      el('div', { class: 'dim' }, range, pc),
      el('div', { class: 'scenes' }));
    return card;
  }
  function paintLevel(card, v) {
    const r = card.querySelector('.dim input');
    r.style.setProperty('--p', Math.round(v * 100) + '%');
    card.querySelector('.pc').textContent = Math.round(v * 100) + '%';
  }
  function updateCard(card, z) {
    card.style.setProperty('--zt', z.tag || 'var(--accent)');
    card.querySelector('.zhead b').textContent = z.name;
    const sc = z.scenes.find(s => s.id === z.scene);
    const now = card.querySelector('.now');
    now.replaceChildren(sc ? el('em', null, '▶ ' + sc.name) : el('em', null, 'Live look'), z.content.length ? ' · ' + z.content.join(' + ') : ' · Black');
    if (!dragging.has(z.id)) { card.querySelector('.dim input').value = Math.round(z.opacity * 100); paintLevel(card, z.opacity); }
    const box = card.querySelector('.scenes');
    // the buttons are made again only when the scenes change, so a tap is never lost; otherwise the playing one moves
    const key = JSON.stringify(z.scenes.map(s => [s.id, s.name, s.tag, s.fade]));
    if (box.dataset.key === key) {
      box.querySelectorAll('.scene').forEach(b => { const on = b.dataset.id === z.scene; b.classList.toggle('live', on); b.setAttribute('aria-pressed', String(on)); });
      return;
    }
    box.dataset.key = key;
    box.replaceChildren(...(z.scenes.length ? z.scenes.map(s => el('button', { 'data-id': s.id,
      class: 'scene' + (s.id === z.scene ? ' live' : ''), type: 'button', style: { '--st': s.tag || '' }, 'aria-pressed': String(s.id === z.scene),
      title: s.fade ? `Fades in ${s.fade} s` : 'Cuts straight to it',
      onclick: e => {
        send({ op: 'scene', zone: z.id, scene: s.id });
        box.querySelectorAll('.scene').forEach(b => { b.classList.toggle('live', b === e.currentTarget); });
      } }, el('b', null, s.name), el('span', null, s.fade ? s.fade + ' s' : 'cut'))) : [el('p', { class: 'empty' }, 'No scenes stored for this zone.')]));
  }
  $('#out').addEventListener('click', () => { sessionStorage.removeItem('olm.remote.token'); location.href = '/'; });

  // ---- an app on the phone
  // Installed (from Chrome's menu, or the Install button when Chrome offers it) it opens without the browser's bars.
  // Chrome only installs pages it counts as secure; until then Full screen hides the bars while the page is open.
  const standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  const full = $('#full'), root = document.documentElement;
  const canFull = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const pref = v => { try { if (v === undefined) return localStorage.getItem('olm.remote.full') === '1'; localStorage.setItem('olm.remote.full', v ? '1' : '0'); } catch (e) { return false; } };
  const goFull = () => { const f = root.requestFullscreen || root.webkitRequestFullscreen; const p = f && f.call(root, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); };
  const leaveFull = () => { const f = document.exitFullscreen || document.webkitExitFullscreen; if (f) f.call(document); };
  const showFull = () => { full.hidden = !canFull || standalone(); full.classList.toggle('on', isFull()); full.setAttribute('aria-pressed', String(isFull())); full.title = isFull() ? 'Leave full screen' : 'Full screen'; };
  full.addEventListener('click', () => { if (isFull()) { pref(false); leaveFull(); } else { pref(true); goFull(); } });
  // Left by switching apps or a reload, full screen comes back with the next tap; left on purpose (Back), it stays off
  let leaving = false;   // the page went to the background: full screen ended by itself
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leaving = true; });
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { if (!isFull() && document.visibilityState === 'visible' && !leaving) pref(false); leaving = false; showFull(); });
  addEventListener('pointerdown', e => { if (pref() && canFull && !isFull() && !standalone() && !e.target.closest('#full, #out')) goFull(); }, true);
  showFull();
  let installEvent = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; $('#install').hidden = false; });
  $('#install').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; $('#install').hidden = true; });
  addEventListener('appinstalled', () => { $('#install').hidden = true; });
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/remote-sw.js').catch(() => {});
  status();
  connect();
})();
