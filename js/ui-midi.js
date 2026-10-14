// openLedMapper · js/ui-midi.js
// MIDI in the interface: the top-bar button (its light blinks with each message, it turns yellow while learning),
// the MIDI tab of the bottom dock (MIDI on or off, Learn, the controllers, the mappings, the monitor), the bar that
// says what to do while learning, and the marks on what a control drives: a thin yellow line on a slider where its
// fader is, and the control's name while the MIDI tab is open or while learning. While learning, touching anything
// marked data-midi picks it.

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

/* ---------- redrawing ---------- */
// The engine calls this after any change, and with the message for each message: at most once a frame, the button,
// the learn bar, the marks, and the MIDI tab when it shows
let midiQueued = false, midiBlinkT = 0, midiSig = '', midiLogShown = null;
function updateMidiUI(msg) {
  if (msg) midiBlink();
  if (midiQueued) return;
  midiQueued = true;
  requestAnimationFrame(() => { midiQueued = false; midiRedraw(); });
}
function midiBlink() {
  const l = $('#midiLed');
  if (!l) return;
  l.classList.add('on'); clearTimeout(midiBlinkT); midiBlinkT = setTimeout(() => l.classList.remove('on'), 90);
}
const midiTabOpen = () => ui.dockTab === 'midi' && !ui.dockCollapsed && !REMOTE_CLIENT;
// What to do next while learning (and how to start)
function midiHint() {
  const L = midi.learn;
  return !L.on ? ['Press Learn, move a control on your controller, then click what it should move.']
    : L.pending ? [h('b', null, midiKeyFull(L.pending)), ' moved: now click what it should move.']
      : L.target ? ['Now move the control for ', h('b', null, midiTargetLabel(L.target)), '.']
        : ['Move a control on your controller, then click what it should move: Master, Blackout, a zone\'s level, a scene, a playlist. Or the other way round.'];
}
function midiRedraw() {
  if (!project || REMOTE_CLIENT) return;
  const b = $('#btnMidi'), open = midiTabOpen(), L = midi.learn;
  document.body.classList.toggle('midi-open', open);
  document.body.classList.toggle('midi-learning', L.on);
  b.classList.toggle('on', midi.status === 'ok'); b.classList.toggle('learning', L.on); b.classList.toggle('warn', midi.status === 'blocked');
  const n = midi.ports.filter(p => p.state !== 'disconnected').length, m = project.midi.maps.length;
  b.title = L.on ? 'MIDI: learning. Esc stops.' : midi.status === 'ok' ? `MIDI: ${n} controller${n === 1 ? '' : 's'}, ${m} mapping${m === 1 ? '' : 's'}` : 'MIDI: play this project from a MIDI controller';
  const bar = $('#midiLearnBar');
  bar.hidden = !L.on;
  if (L.on) bar.firstChild.replaceChildren(...midiHint());
  markMidi();
  if (!open) return;
  if (midiTabSig() !== midiSig || !$('#dockBody .midipanel')) renderDock();
  else midiTabUpdate();
}
// What the MIDI tab is built from; when it changes, the tab is built again
const midiTabSig = () => JSON.stringify([ui.midiOn, midi.status, midi.ports, ui.midiOff, ui.midiMon, midi.learn,
  project.midi.maps.map(w => [w.id, w.key, w.to, w.takeover, w.mode, midiTargetLabel(w.to)])]);

/* ---------- the MIDI tab ---------- */
function renderMidiTab(body) {
  midiSig = midiTabSig(); midiLogShown = null;
  if (!ui.midiOn) {
    body.append(h('div', { class: 'midipanel off' }, h('div', { class: 'moff' },
      h('p', null, 'Play this project from a MIDI controller: its faders, knobs and pads can move the master, blackout and the zones\' levels, and play their scenes and playlists.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => setMidiOn(true) }, 'Turn MIDI on'),
      h('p', { class: 'note' }, 'The browser may ask whether openLedMapper can use your MIDI devices.'))));
    return;
  }
  const L = midi.learn;
  const left = h('div', { class: 'mcol mleft' },
    h('div', { class: 'learnrow' },
      h('button', { class: 'btn learn' + (L.on ? ' on' : ''), type: 'button', 'aria-pressed': String(L.on), title: 'Learn: move a control, then click what it should move. Esc stops.', onclick: () => midiSetLearn(!L.on) }, L.on ? 'Learning' : 'Learn'),
      h('span', { class: 'fill' }),
      h('button', { class: 'btn sm ghost', type: 'button', title: 'Stop listening to MIDI on this computer', onclick: () => setMidiOn(false) }, 'Turn off')),
    h('p', { class: 'note' + (L.on ? ' learnhint' : '') }, midiHint()),
    midiPorts());
  body.append(h('div', { class: 'midipanel' + (ui.midiMon ? '' : ' monshut') }, left, midiMaps(), midiMonitor()));
  midiTabUpdate();
}
function midiPorts() {
  const known = midi.ports.map(p => p.name);
  for (const w of project.midi.maps) { const k = midiKeyParts(w.key); if (k && !known.includes(k.port)) known.push(k.port); }
  const note = { asking: 'Asking for your MIDI devices… The browser may show a question at the top of the window.',
    none: 'This browser has no MIDI: use Chrome or Edge, or the openLedMapper app.',
    blocked: 'MIDI was refused. Allow it for this page in the browser (the icon left of the address), then turn MIDI off and on again.',
    ok: midi.ports.length ? 'Plug controllers in or out at any time: each is found again by its name. On Windows a MIDI port works in one program at a time.' : 'No MIDI controller found: plug one in and it shows here.' }[midi.status] || '';
  return h('div', { class: 'mports' }, h('h3', null, 'Controllers'),
    ...known.map(name => {
      const live = midiPortLive(name), on = midiPortOn(name);
      return h('label', { class: 'mport' + (live ? '' : ' gone'), title: on ? 'Listening. Untick to ignore it.' : 'Ignored. Tick to listen to it.' },
        h('span', { class: 'led', 'data-led': name }), h('span', { class: 'nm', title: name }, name, live ? null : h('small', null, 'not plugged in')),
        h('input', { type: 'checkbox', checked: on, 'aria-label': 'Listen to ' + name,
          onchange: e => { const off = new Set(ui.midiOff || []); if (e.target.checked) off.delete(name); else off.add(name); ui.midiOff = [...off]; savePrefs(); updateMidiUI(); } }));
    }),
    note ? h('p', { class: 'note' + (midi.status === 'blocked' || midi.status === 'none' ? ' warn' : '') }, note) : null);
}
function midiMaps() {
  const maps = project.midi.maps;
  const ports = new Set(maps.map(w => midiKeyParts(w.key).port));
  const rows = maps.map(w => {
    const k = midiKeyParts(w.key), T = midiTarget(w.to);
    const seg = (key, opts) => h('span', { class: 'seg mini' }, opts.map(([v, label, tip]) => h('button', { type: 'button', class: w[key] === v ? 'on' : '', title: tip, onclick: () => midiSetMap(w.id, { [key]: v }) }, label)));
    const how = !T ? h('span') : T.kind === 'fader' ? seg('takeover', [['pickup', 'Pickup', 'It follows once the fader reaches it'], ['jump', 'Jump', 'It goes where the fader is at once']])
      : T.kind === 'toggle' ? seg('mode', [['toggle', 'Toggle', 'Each press turns it on or off'], ['hold', 'Hold', 'On while held']])
        : h('span', { class: 'muted', title: 'A press plays it' }, 'Press');
    return h('div', { class: 'mmap' + (T ? '' : ' missing'), 'data-map': w.id, title: k.port },
      h('span', { class: 'mk' }, midiKeyFull(w.key), ports.size > 1 ? h('small', null, k.port) : null),
      h('button', { class: 'btn sm mtarget', type: 'button', title: 'Change what it drives', onclick: e => midiTargetMenu(e.currentTarget, w) }, h('span', null, '→ ' + (T ? T.label : 'Missing: it was deleted')), ' ▾'),
      how,
      h('span', { class: 'cval' }, h('i', { class: 'cbar' })),
      h('button', { class: 'x', type: 'button', title: 'Remove this mapping', 'aria-label': `Remove ${midiKeyFull(w.key)} to ${T ? T.label : 'missing'}`, onclick: () => midiDisconnect(w.id) }, icon('x')));
  });
  return h('div', { class: 'mcol mmaps' }, h('h3', null, maps.length ? `Mappings · ${maps.length}` : 'Mappings'),
    h('div', { class: 'mlist' }, ...rows, maps.length ? null : h('p', { class: 'note' }, 'None yet. Press Learn, move a fader, knob or pad, then click what it should move.')));
}
function midiTargetMenu(anchor, w) {
  const item = (label, t) => [(w.to === t ? '✓ ' : '') + label, () => midiSetMap(w.id, { to: t })];
  const zones = project.zones.slice().reverse().map(z => [z.name, null, { sub: [
    item('Level', 'z:' + z.id),
    z.scenes.length && '-',
    ...z.scenes.map(sc => item('Play ' + sc.name, `sc:${z.id}:${sc.id}`)),
    z.scenes.length && item('Next scene', 'nx:' + z.id),
    z.playlists.length && '-',
    ...z.playlists.map(pl => item('Play or pause ' + pl.name, `pl:${z.id}:${pl.id}`)),
  ] }]);
  menu(anchor, [{ head: midiKeyFull(w.key) + ' drives' }, item('Master', 'master'), item('Blackout', 'blackout'), zones.length && '-', ...zones]);
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
function midiTabUpdate() {
  for (const el of $$('#dockBody .mmap')) {
    const w = project.midi.maps.find(x => x.id === el.dataset.map), c = w && midiControlOf(w), bar = el.querySelector('.cbar');
    if (bar) bar.style.width = c ? c.last * 100 + '%' : '0';
    el.classList.toggle('hit', !!(w && w._hit && performance.now() - w._hit < 200));
  }
  const e0 = midi.log[0];
  if (e0 && e0 !== midiLogShown) { const led = $(`#dockBody .led[data-led="${CSS.escape(e0.port)}"]`); if (led) { led.classList.add('on'); clearTimeout(led._t); led._t = setTimeout(() => led.classList.remove('on'), 90); } }
  const mon = $('#midiMon');
  if (!mon || midiLogShown === e0) { midiLogShown = e0; return; }
  midiLogShown = e0;
  mon.replaceChildren(...(midi.log.length ? midi.log.slice(0, 40).map(e => h('div', { class: 'mrow' },
    h('span', { class: 't' }, e.time.toFixed(2)), h('span', { class: 'm', title: e.port }, e.text), h('span', { class: 'v' }, e.val),
    h('span', { class: 'd' + (e.to.length ? ' go' : e.note === 'learnt' ? ' learnt' : '') }, e.to.length ? '→ ' + e.to.join(', ') : e.note)))
    : [h('p', { class: 'note' }, 'Every message from your controllers shows here, with what it moves.')]));
}

/* ---------- learning, the button ---------- */
// While learning, a touch on something MIDI can drive picks it, and does nothing else (a scene doesn't play, a
// slider doesn't move)
const midiPickEl = e => midi.learn.on && e.target.closest && e.target.closest('[data-midi]');
function initMidiUI() {
  if (REMOTE_CLIENT) { if (ui.dockTab === 'midi') ui.dockTab = 'patch'; return; }
  // The MIDI tab opens first, whatever the browser then says about MIDI
  $('#btnMidi').addEventListener('click', () => {
    const first = !ui.midiOn;
    ui.dockTab = 'midi'; ui.dockCollapsed = false; savePrefs(); renderDock();
    if (first) { setMidiOn(true); toast('MIDI is on. Its tab is in the bottom panel, next to DMX Monitor.'); }
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
