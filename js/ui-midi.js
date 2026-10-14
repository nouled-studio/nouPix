// openLedMapper · js/ui-midi.js
// MIDI in the interface: the top-bar button (its light blinks with each message, it turns yellow while learning),
// the MIDI window (MIDI on or off, Learn, the controllers, the mappings, the monitor), the bar that says what to do
// while learning, and the marks on what a control drives: a thin yellow line on a slider where its fader is, and the
// control's name while the MIDI window is open or while learning. While learning, touching anything marked data-midi
// picks it.

/* ---------- what MIDI can drive ---------- */
// A slider: the line and the tag go over it
function midiSlot(input, t, width) {
  const el = h('span', { class: 'mslot', 'data-midi': t }, input, h('i', { class: 'fline', hidden: true }), h('span', { class: 'ftag', hidden: true }));
  if (width) el.style.width = width + 'px';
  return el;
}
// A button or a tile (a scene, a playlist): the tag goes in it
function midiButton(el, t) {
  el.dataset.midi = t;
  el.prepend(h('span', { class: 'ftag', hidden: true }));
  return el;
}
// Where the control of a mapping is: its own, or the same control on another port (see midiMapsFor)
function midiControlOf(w) {
  const c = midi.controls.get(w.key);
  if (c) return c;
  const k = midiKeyParts(w.key);
  for (const [key, o] of midi.controls) { const x = midiKeyParts(key); if (x.ch === k.ch && x.type === k.type && x.num === k.num && !midiPortLive(k.port)) return o; }
  return null;
}
function markMidi() {
  if (!project) return;
  const maps = project.midi.maps, L = midi.learn;
  for (const el of $$('[data-midi]')) {
    const t = el.dataset.midi, ws = maps.filter(w => w.to === t);
    el.classList.toggle('midi-mapped', !!ws.length);
    el.classList.toggle('midi-pick', L.on && L.target === t);
    const tag = el.querySelector(':scope > .ftag');
    if (tag) { tag.hidden = !ws.length; tag.textContent = ws.length ? midiKeyLabel(ws[0].key) + (ws.length > 1 ? ' +' + (ws.length - 1) : '') : ''; }
    const line = el.querySelector(':scope > .fline');
    if (line) {
      const w = ws.find(x => midiKeyParts(x.key).type === 'cc'), c = w && midiControlOf(w);
      line.hidden = !c;
      if (c) { line.style.left = `calc(8px + ${c.last} * (100% - 16px))`; line.classList.toggle('away', !midiPicked(w)); }
    }
  }
}

/* ---------- the MIDI window ---------- */
// MIDI has a window of its own, big, to put beside the main one or on another screen. This page draws it (the
// engine stays here), so it closes with this page.
let midiWin = null;
const midiWinOpen = () => !!(midiWin && !midiWin.closed);
const midiDoc = () => (midiWinOpen() ? midiWin.document : null);
function openMidiWindow() {
  if (midiWinOpen()) { midiWin.focus(); return; }
  const w = window.open('', 'olm-midi', 'popup,width=1180,height=760');
  if (!w) { toast('The MIDI window could not open: allow pop-up windows for this page.', 'err'); return; }
  midiWin = w;
  const d = w.document;
  // the same fonts and styles as this page
  d.head.replaceChildren(...$$('head link[rel=stylesheet], head link[rel=preconnect], head link[rel=icon]').map(l => { const c = d.createElement('link'); c.rel = l.rel; c.href = l.href; return c; }));
  d.title = 'MIDI · openLedMapper';
  d.body.className = 'midiwin';
  d.body.replaceChildren();
  w.addEventListener('keydown', e => {
    if (e.key === 'Escape' && midi.learn.on) midiSetLearn(false);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  });
  w.addEventListener('pagehide', () => { if (midiWin === w) { midiWin = null; updateMidiUI(); } });
  midiSig = '';
  updateMidiUI();
}
// The MIDI window doesn't outlive this page; a window closed by its own button is noticed
addEventListener('pagehide', () => { if (midiWinOpen()) midiWin.close(); });
setInterval(() => { if (midiWin && midiWin.closed) { midiWin = null; updateMidiUI(); } }, 1000);

/* ---------- redrawing ---------- */
// The engine calls this after any change, and with the message for each message: at most once a frame, the button,
// the learn bar, the marks, and the MIDI window when it is open
let midiQueued = false, midiBlinkT = 0, midiSig = '', midiLogShown = null;
function updateMidiUI(msg) {
  if (msg) midiBlink();
  if (midiQueued) return;
  midiQueued = true;
  requestAnimationFrame(() => { midiQueued = false; midiRedraw(); });
  // a window in the background gets no animation frames: the MIDI window is drawn anyway
  setTimeout(() => { if (midiQueued && document.hidden) { midiQueued = false; midiRedraw(); } }, 100);
}
function midiBlink() {
  const l = $('#midiLed');
  if (!l) return;
  l.classList.add('on'); clearTimeout(midiBlinkT); midiBlinkT = setTimeout(() => l.classList.remove('on'), 90);
}
// What to do next while learning (and how to start)
function midiHint() {
  const L = midi.learn;
  return !L.on ? ['Press Learn, move a control on your controller, then click what it should move in the main window.']
    : L.pending ? [h('b', null, midiKeyFull(L.pending)), ' moved: now click what it should move in the main window.']
      : L.target ? ['Now move the control for ', h('b', null, midiTargetLabel(L.target)), '.']
        : ['Move a control on your controller, then click what it should move in the main window: Master, Blackout, a zone\'s level, a scene, a playlist. Or the other way round.'];
}
function midiRedraw() {
  if (!project || REMOTE_CLIENT) return;
  const b = $('#btnMidi'), open = midiWinOpen(), L = midi.learn;
  document.body.classList.toggle('midi-open', open);
  document.body.classList.toggle('midi-learning', L.on);
  b.classList.toggle('on', midi.status === 'ok'); b.classList.toggle('learning', L.on); b.classList.toggle('warn', midi.status === 'blocked');
  b.setAttribute('aria-pressed', String(open));
  const n = midi.ports.filter(p => p.state !== 'disconnected').length, m = project.midi.maps.length;
  b.title = L.on ? 'MIDI: learning. Esc stops.' : midi.status === 'ok' ? `MIDI: ${n} controller${n === 1 ? '' : 's'}, ${m} mapping${m === 1 ? '' : 's'}` : 'MIDI: play this project from a MIDI controller';
  const bar = $('#midiLearnBar');
  bar.hidden = !L.on;
  if (L.on) bar.firstChild.replaceChildren(...midiHint());
  markMidi();
  const D = midiDoc();
  if (!D) return;
  if (midiTabSig() !== midiSig || !$('.midipanel', D)) renderMidiWindow(D);
  else midiTabUpdate(D);
}
// What the MIDI window is built from; when it changes, it is built again
const midiTabSig = () => JSON.stringify([ui.midiOn, midi.status, midi.ports, ui.midiOff, ui.midiMon, midi.learn,
  project.midi.maps.map(w => [w.id, w.key, w.to, w.takeover, w.mode, midiTargetLabel(w.to)]),
  project.zones.map(z => [z.id, z.name, z.scenes.map(s => [s.id, s.name]), z.playlists.map(p => [p.id, p.name])])]);

/* ---------- what the MIDI window shows ---------- */
function renderMidiWindow(D) {
  midiSig = midiTabSig(); midiLogShown = null;
  const L = midi.learn, n = midi.ports.filter(p => p.state !== 'disconnected').length;
  const head = h('header', { class: 'mwhead' },
    h('span', { class: 'mwtitle', html: $('#btnMidi svg').outerHTML }, 'MIDI'),
    ui.midiOn ? h('button', { class: 'btn learn' + (L.on ? ' on' : ''), type: 'button', 'aria-pressed': String(L.on), title: 'Learn: move a control, then click what it should move in the main window. Esc stops.', onclick: () => midiSetLearn(!L.on) }, L.on ? 'Learning' : 'Learn') : null,
    ui.midiOn ? h('span', { class: 'mwhint' + (L.on ? ' on' : '') }, midiHint()) : h('span', { class: 'fill' }),
    ui.midiOn && midi.status === 'ok' ? h('span', { class: 'pill' + (n ? ' ok' : ' warn') }, h('span', { class: 'dot' }), `${n} controller${n === 1 ? '' : 's'}`) : null,
    ui.midiOn ? h('button', { class: 'btn sm ghost', type: 'button', title: 'Stop listening to MIDI on this computer', onclick: () => setMidiOn(false) }, 'Turn off') : null);
  let body;
  if (!ui.midiOn) {
    body = h('div', { class: 'midipanel off' }, h('div', { class: 'moff' },
      h('p', null, 'Play this project from a MIDI controller: its faders, knobs and pads can move the master, blackout and the zones\' levels, and play their scenes and playlists.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => setMidiOn(true) }, 'Turn MIDI on'),
      h('p', { class: 'note' }, 'The browser may ask whether openLedMapper can use your MIDI devices.')));
  } else body = h('div', { class: 'midipanel' + (ui.midiMon ? '' : ' monshut') }, midiPorts(), midiMaps(), midiMonitor());
  D.body.replaceChildren(head, body);
  midiTabUpdate(D);
}
function midiPorts() {
  const known = midi.ports.map(p => p.name);
  for (const w of project.midi.maps) { const k = midiKeyParts(w.key); if (k && !known.includes(k.port)) known.push(k.port); }
  const note = { asking: 'Asking for your MIDI devices… The browser may show a question at the top of the main window.',
    none: 'This browser has no MIDI: use Chrome or Edge, or the openLedMapper app.',
    blocked: 'MIDI was refused, or this computer has none. In Chrome, allow MIDI devices for this page (its site settings), then turn MIDI off and on again.',
    ok: midi.ports.length ? 'Plug controllers in or out at any time: each is found again by its name. On Windows a MIDI port works in one program at a time.' : 'No MIDI controller found: plug one in and it shows here.' }[midi.status] || '';
  return h('div', { class: 'mcol mports' }, h('h3', null, 'Controllers'),
    ...known.map(name => {
      const live = midiPortLive(name), on = midiPortOn(name);
      return h('label', { class: 'mport' + (live ? '' : ' gone'), title: on ? 'Listening. Untick to ignore it.' : 'Ignored. Tick to listen to it.' },
        h('span', { class: 'led', 'data-led': name }), h('span', { class: 'nm', title: name }, name, live ? null : h('small', null, 'not plugged in')),
        h('input', { type: 'checkbox', checked: on, 'aria-label': 'Listen to ' + name,
          onchange: e => { const off = new Set(ui.midiOff || []); if (e.target.checked) off.delete(name); else off.add(name); ui.midiOff = [...off]; savePrefs(); updateMidiUI(); } }));
    }),
    note ? h('p', { class: 'note' + (midi.status === 'blocked' || midi.status === 'none' ? ' warn' : '') }, note) : null,
    midi.status === 'blocked' && midi.error ? h('p', { class: 'note' }, 'The browser says: ' + midi.error) : null);
}
// What a mapping can drive, as a list: Master, Blackout, then each zone's level, scenes, next scene and playlists
function midiTargetSelect(w) {
  const opt = (t, label) => h('option', { value: t, selected: w.to === t }, label);
  return h('select', { class: 'mtarget', 'aria-label': `What ${midiKeyFull(w.key)} drives`, title: 'What it drives', onchange: e => midiSetMap(w.id, { to: e.target.value }) },
    midiTarget(w.to) ? null : h('option', { value: w.to, selected: true }, 'Missing: it was deleted'),
    opt('master', 'Master'), opt('blackout', 'Blackout'),
    project.zones.slice().reverse().map(z => h('optgroup', { label: z.name },
      opt('z:' + z.id, z.name + ' level'),
      z.scenes.map(sc => opt(`sc:${z.id}:${sc.id}`, `${z.name} · ${sc.name}`)),
      z.scenes.length ? opt('nx:' + z.id, z.name + ' · next scene') : null,
      z.playlists.map(pl => opt(`pl:${z.id}:${pl.id}`, `${z.name} · ${pl.name} (playlist)`)))));
}
function midiMaps() {
  const maps = project.midi.maps;
  const ports = new Set(maps.map(w => midiKeyParts(w.key).port));
  const rows = maps.map(w => {
    const k = midiKeyParts(w.key), T = midiTarget(w.to);
    const seg = (key, opts) => h('span', { class: 'seg mini' }, opts.map(([v, label, tip]) => h('button', { type: 'button', class: w[key] === v ? 'on' : '', title: tip, onclick: () => midiSetMap(w.id, { [key]: v }) }, label)));
    const how = !T ? h('span') : T.kind === 'fader' ? seg('takeover', [['pickup', 'Pickup', 'It follows once the fader reaches it'], ['jump', 'Jump', 'It goes where the fader is at once']])
      : T.kind === 'toggle' ? seg('mode', [['toggle', 'Toggle', 'Each press turns it on or off'], ['hold', 'Hold', 'On while held']])
        : h('span', { class: 'muted', title: 'A press plays it' }, 'On a press');
    return h('div', { class: 'mmap' + (T ? '' : ' missing'), 'data-map': w.id, title: k.port },
      h('span', { class: 'mk' }, midiKeyFull(w.key), ports.size > 1 ? h('small', null, k.port) : null),
      midiTargetSelect(w),
      how,
      h('span', { class: 'cval' }, h('i', { class: 'cbar' })),
      h('button', { class: 'x', type: 'button', title: 'Remove this mapping', 'aria-label': `Remove ${midiKeyFull(w.key)} to ${T ? T.label : 'missing'}`, onclick: () => midiDisconnect(w.id) }, icon('x')));
  });
  return h('div', { class: 'mcol mmaps' }, h('h3', null, maps.length ? `Mappings · ${maps.length}` : 'Mappings'),
    h('div', { class: 'mlist' }, ...rows, maps.length ? null : h('p', { class: 'note' }, 'None yet. Press Learn, move a fader, knob or pad, then click what it should move in the main window.')));
}
// The monitor folds to its heading
function midiMonitor() {
  const open = !!ui.midiMon;
  return h('div', { class: 'mcol mmoncol' },
    h('h3', null, h('button', { class: 'mfold' + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open), title: open ? 'Fold the monitor' : 'Show every message', onclick: () => { ui.midiMon = !open; savePrefs(); updateMidiUI(); } }, icon('chev'), 'Monitor'),
      h('span', { class: 'fill' }), open ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { midi.log = []; midiLogShown = null; updateMidiUI(); } }, 'Clear') : null),
    open ? h('div', { class: 'mmon', id: 'midiMon' }) : null);
}
// What changes with each message: the bars of the mapped controls, the controllers' lights, the monitor
function midiTabUpdate(D) {
  for (const el of $$('.mmap', D)) {
    const w = project.midi.maps.find(x => x.id === el.dataset.map), c = w && midiControlOf(w), bar = el.querySelector('.cbar');
    if (bar) bar.style.width = c ? c.last * 100 + '%' : '0';
    el.classList.toggle('hit', !!(w && w._hit && performance.now() - w._hit < 200));
  }
  const e0 = midi.log[0];
  if (e0 && e0 !== midiLogShown) { const led = $(`.led[data-led="${CSS.escape(e0.port)}"]`, D); if (led) { led.classList.add('on'); clearTimeout(led._t); led._t = setTimeout(() => led.classList.remove('on'), 90); } }
  const mon = $('#midiMon', D);
  if (!mon || midiLogShown === e0) { midiLogShown = e0; return; }
  midiLogShown = e0;
  mon.replaceChildren(...(midi.log.length ? midi.log.slice(0, 60).map(e => h('div', { class: 'mrow' },
    h('span', { class: 't' }, e.time.toFixed(2)), h('span', { class: 'm', title: e.port }, e.text), h('span', { class: 'v' }, e.val),
    h('span', { class: 'd' + (e.to.length ? ' go' : e.note === 'learnt' ? ' learnt' : '') }, e.to.length ? '→ ' + e.to.join(', ') : e.note)))
    : [h('p', { class: 'note' }, 'Every message from your controllers shows here, with what it moves.')]));
}

/* ---------- learning, the button ---------- */
// While learning, a touch on something MIDI can drive picks it, and does nothing else (a scene doesn't play, a
// slider doesn't move)
const midiPickEl = e => midi.learn.on && e.target.closest && e.target.closest('[data-midi]');
function initMidiUI() {
  if (ui.dockTab === 'midi') ui.dockTab = 'scenes';   // MIDI was a tab of the dock before it had its window
  if (REMOTE_CLIENT) return;
  $('#btnMidi').addEventListener('click', () => {
    const first = !ui.midiOn;
    openMidiWindow();
    if (first) setMidiOn(true);
  });
  document.body.append(h('div', { class: 'midibar', id: 'midiLearnBar', hidden: true, role: 'status' }, h('span'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => midiSetLearn(false) }, 'Stop learning')));
  document.addEventListener('pointerdown', e => {
    const el = midiPickEl(e);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (e.target.type === 'range') e.target._midiKeep = e.target.value;
    midiLearnTarget(el.dataset.midi);
  }, true);
  for (const t of ['click', 'dblclick', 'input', 'change']) document.addEventListener(t, e => {
    if (!midiPickEl(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.target._midiKeep != null) e.target.value = e.target._midiKeep;   // a slider touched stays where it was
  }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape' && midi.learn.on && !typingIn(e.target) && !$('.menu')) midiSetLearn(false); });
}
