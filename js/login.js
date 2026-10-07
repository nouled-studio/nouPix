// openLedMapper · js/login.js
// The login page of remote control: choose programmer (with the password), operator or remote, then go to the
// interface (/app) or the page for phones (/remote). The token from logging in lives in this tab only.
'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const roles = [...document.querySelectorAll('.role')];
  const pwbox = $('#pwbox'), pw = $('#pw'), go = $('#go'), msg = $('#msg');
  let role = null, info = { hasPassword: true, host: true };

  const say = (text, err) => { msg.textContent = text; msg.classList.toggle('err', !!err); };
  function pick(r) {
    role = r;
    for (const b of roles) { const on = b.dataset.role === r; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    pwbox.hidden = r !== 'programmer';
    go.disabled = !r;
    go.textContent = r === 'remote' ? 'Open the remote' : r === 'programmer' ? 'Log in' : 'Continue';
    say(info.host ? '' : 'openLedMapper on the main computer is not connected right now. You can log in and wait.');
    try { localStorage.setItem('olm.remote.role', r); } catch (e) { /* private mode */ }
    if (r === 'programmer') pw.focus();
  }
  roles.forEach(b => b.addEventListener('click', () => { if (!b.disabled) pick(b.dataset.role); }));

  async function login() {
    if (!role) return;
    if (role === 'remote') { location.href = '/remote'; return; }   // the phone page logs itself in
    go.disabled = true; say('Logging in…');
    try {
      const r = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, password: role === 'programmer' ? pw.value : '' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) { say(d.error || 'Could not log in.', true); go.disabled = false; if (role === 'programmer') { pw.select(); pw.focus(); } return; }
      sessionStorage.setItem('olm.remote.token', d.token);
      location.href = '/app';
    } catch (e) { say('openLedMapper is not reachable. Check the address and the network.', true); go.disabled = false; }
  }
  go.addEventListener('click', login);
  pwbox.addEventListener('submit', e => { e.preventDefault(); login(); });
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); login(); } });

  fetch('/info').then(r => r.json()).then(d => {
    info = d;
    $('#ver').textContent = d.version ? ' v' + d.version : '';
    const prog = roles.find(b => b.dataset.role === 'programmer');
    if (!d.hasPassword) { prog.disabled = true; prog.querySelector('span').textContent = 'No password is set on the main computer yet (Settings, Remote control), so nobody can log in as programmer.'; }
    let last = null;
    try { last = localStorage.getItem('olm.remote.role'); } catch (e) { /* private mode */ }
    const lb = roles.find(b => b.dataset.role === last);
    if (!role && lb && !lb.disabled) pick(last);   // unless something was chosen already
    else if (!d.host) say('openLedMapper on the main computer is not connected right now. You can log in and wait.');
  }).catch(() => say('openLedMapper is not reachable. Check the address and the network.', true));
})();
