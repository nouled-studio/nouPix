// openLedMapper · js/ui-remote.js
// Remote control in the interface: the top-bar button and its menu, the Remote control section of Settings, the
// screen a device shows while it waits for the main computer, and how the mapping is shown locked to operators.

const ROLE_NAMES = { programmer: 'Programmer', operator: 'Operator', remote: 'Remote (phone)' };

/* ---------- the top-bar button ---------- */
function updateRemoteUI() {
  const b = $('#btnRemote');
  if (!b) return;
  const badge = $('#remoteCount');
  if (REMOTE_CLIENT) {
    const ok = bridge.connected && remote.hostOn;
    b.classList.toggle('on', ok); b.classList.toggle('warn', !ok);
    b.title = (ROLE_NAMES[remote.role] || 'Remote') + (ok ? ': connected to the main computer' : ': not connected to the main computer');
    badge.textContent = remote.role ? ROLE_NAMES[remote.role] : '';
    badge.hidden = !remote.role;
    return;
  }
  const st = remote.status, on = !!(st && st.on), n = remote.clients.size;
  b.classList.toggle('on', on); b.classList.remove('warn');
  b.title = on ? `Remote control on: ${n} device${n === 1 ? '' : 's'} connected. Click for the address.` : 'Remote control: let phones, tablets and other computers use openLedMapper';
  badge.textContent = n; badge.hidden = !on || !n;
}
function remoteMenu(anchor) {
  if (REMOTE_CLIENT) {
    return menu(anchor, [
      { head: `${ROLE_NAMES[remote.role] || 'Remote'} · ${remote.hostOn ? 'connected' : 'waiting for the main computer'}` },
      ['Log in as someone else', remoteLogout],
    ]);
  }
  const st = remote.status, on = !!(st && st.on);
  const copy = u => () => navigator.clipboard.writeText(u).then(() => toast('Copied ' + u), () => toast(u));
  menu(anchor, [
    { head: on ? `Remote control on · ${remote.clients.size} connected` : 'Remote control off' },
    ...(on ? st.urls.map(u => [u, copy(u), { title: 'Open this address on a phone, tablet or computer on the same network. Click to copy it.' }]) : []),
    ...(on ? [...remote.clients.values()].map(c => ({ head: `${ROLE_NAMES[c.role] || c.role} · ${c.addr}` })) : []),
    '-',
    [on ? 'Switch remote control off' : 'Switch remote control on', () => { remote.cfg.on = !on; remoteConfigure(); if (ui.rightTab === 'settings') renderRight(); }, { disabled: !bridge.connected }],
    ['Remote control settings…', () => { showRight(true); ui.rightTab = 'settings'; renderRight(); const s = $('#remoteSec'); if (s) s.scrollIntoView({ block: 'start' }); }],
  ]);
}

/* ---------- Settings: the Remote control section (on the main computer) ---------- */
function remoteSection() {
  const cfg = remote.cfg, st = remote.status, on = !!(st && st.on);
  const apply = () => { remoteConfigure(); renderRight(); };
  const pw = h('input', { type: 'password', value: cfg.password, placeholder: 'Needed for programmers', autocomplete: 'new-password', 'aria-label': 'Programmer password' });
  pw.addEventListener('change', () => { cfg.password = pw.value; if (cfg.on) remoteConfigure(); else remoteSaveCfg(); renderRight(); });
  const show = h('label', { class: 'checkrow' }, h('input', { type: 'checkbox', onchange: e => { pw.type = e.target.checked ? 'text' : 'password'; } }), 'Show');
  const port = { v: cfg.port };
  const parts = [
    h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Remote control'),
      h('button', { class: 'onsw' + (cfg.on ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(cfg.on), disabled: !bridge.connected,
        title: bridge.connected ? '' : 'Needs openLedMapper running on this computer (the app, or openledmapper.py)',
        onclick: () => { cfg.on = !cfg.on; apply(); } }, h('i'), cfg.on ? 'ON' : 'OFF')),
    row('Port', numInput(port, 'v', { int: true, min: 1024, max: 65535, aria: 'Remote control port', onCommit: () => { cfg.port = port.v; if (cfg.on) remoteConfigure(); else remoteSaveCfg(); renderRight(); } })),
    row('Password', h('div', { class: 'pwrow' }, pw, show)),
    h('p', { class: 'note' }, 'Phones, tablets and computers on the same network open the address below and choose who they are: a Programmer (everything, with this password), an Operator (content, layers, scenes and zone levels; the mapping is locked), or Remote, a page for phones that plays the scenes of each zone and dims the zones. Without a password nobody can log in as a programmer.'),
  ];
  if (on) {
    parts.push(h('div', { class: 'rurls' }, st.urls.map(u => h('div', { class: 'rurl' }, h('span', { class: 'mono' }, u),
      h('button', { class: 'btn sm', type: 'button', onclick: () => navigator.clipboard.writeText(u).then(() => toast('Copied ' + u), () => toast(u)) }, 'Copy')))));
    const list = [...remote.clients.values()];
    parts.push(h('p', { class: 'note' }, list.length ? 'Connected: ' + list.map(c => `${ROLE_NAMES[c.role] || c.role} (${c.addr})`).join(', ') : 'No device connected yet.'));
    if (/Mac/.test(navigator.platform)) parts.push(h('p', { class: 'note' }, 'If macOS asks whether openLedMapper may accept incoming connections, allow it, or devices cannot reach it.'));
    parts.push(h('p', { class: 'note' }, 'The Remote page installs as an app on phones (LED Remote). On Android, Chrome first needs this address in chrome://flags, "Insecure origins treated as secure"; without it, the page\'s full screen button hides the browser\'s bars. The user guide has the steps.'));
  } else if (st && st.error) parts.push(h('p', { class: 'note err' }, st.error));
  const s = sec('Remote control', parts);
  s.id = 'remoteSec';
  return s;
}

/* ---------- a device: waiting, disconnected ---------- */
function remoteOverlay() {
  if (!REMOTE_CLIENT) return;
  let ov = $('#remoteWait');
  const msg = remote.bye ? remote.bye : !bridge.connected ? 'Connecting to openLedMapper…' : !remote.hostOn ? 'Waiting for openLedMapper on the main computer. Keep its window open with Remote control on.' : !remote.loaded ? 'Loading the project…' : '';
  if (!msg) { if (ov) ov.remove(); return; }
  if (!ov) { ov = h('div', { id: 'remoteWait', class: 'rwait', role: 'status' }); document.body.append(ov); }
  ov.replaceChildren(h('div', { class: 'rwbox' }, h('div', { class: 'rwspin', hidden: !!remote.bye }), h('p', null, msg),
    remote.bye ? h('button', { class: 'btn primary', type: 'button', onclick: remoteLogout }, 'Log in again') : null));
}

/* ---------- the mapping, locked for operators ---------- */
// Everything in el is shown but cannot be changed; a note says why
function lockPanel(el, note = 'Operator: you can see the mapping but not change it.') {
  for (const c of el.querySelectorAll('input, select, textarea, button')) c.disabled = true;
  for (const c of el.querySelectorAll('[draggable]')) c.draggable = false;
  for (const c of [...el.children]) c.classList.add('ro');
  el.prepend(h('p', { class: 'note ronote' }, note));
}
