// nouPix · js/ui-midi.js
// MIDI in the interface: the top-bar button (its light blinks with each message, it turns yellow while learning),
// the MIDI window (MIDI on or off, Learn, the controllers, the mappings, the monitor, a virtual controller), the bar that says what to do
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
  const maps = project.midi.maps, L = midi.learn, D = midiDoc(), S = scenesDoc();
  for (const el of $$('[data-midi]').concat(D ? $$('[data-midi]', D) : [], S ? $$('[data-midi]', S) : [])) {
    const t = el.dataset.midi, ws = maps.filter(w => w.to === t);
    el.classList.toggle('midi-mapped', !!ws.length);
    el.classList.toggle('midi-pick', L.on && L.target === t);
    const tag = el.querySelector(':scope > .ftag, :scope > .t > .ftag');
    // on a scene's button, short (N58, CC21), so it leaves the name its room
    const short = el.classList.contains('scene'), label = key => (short ? midiKeyLabel(key).replace('Note ', 'N').replace('CC ', 'CC') : midiKeyLabel(key));
    if (tag) { tag.hidden = !ws.length; tag.textContent = ws.length ? label(ws[0].key) + (ws.length > 1 ? ' +' + (ws.length - 1) : '') : ''; tag.title = ws.map(w => midiKeyFull(w.key)).join(', '); }
    const line = el.querySelector(':scope > .fline');
    if (line) {
      const w = ws.find(x => midiKeyParts(x.key).type === 'cc'), c = w && midiControlOf(w);
      line.hidden = !c;
      // over the middle of the slider's handle: a 3 px bar (14 px round on the colour picker's)
      const half = el.querySelector(':scope > input.grad') ? 7 : 1.5;
      if (c) { line.style.left = `calc(${half}px + ${c.last} * (100% - ${2 * half}px))`; line.classList.toggle('away', !midiPicked(w)); }
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
  if (midiWinOpen()) { raiseWindow(midiWin); return; }
  const w = window.open('', 'olm-midi', 'popup,width=1180,height=760');
  if (!w) { toast('The MIDI window could not open: allow pop-up windows for this page.', 'err'); return; }
  midiWin = w;
  const d = dressWindow(w, 'MIDI · nouPix', 'midiwin');
  w.addEventListener('keydown', e => {
    if (e.key === 'Escape' && midi.learn.on) midiSetLearn(false);
    // the patch bay: Delete removes the wire picked, Esc lets it go
    if (bay.sel && !typingIn(e.target) && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); bayRemoveSel(); }
    if ((bay.sel || bay.pin) && e.key === 'Escape') { bay.sel = null; bay.pin = null; bayWires(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    // keys 1 to 8 play the virtual controller's pads
    const pad = /^[1-8]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && ui.midiOn && ui.midiVc && !typingIn(e.target) && VC_PADS[+e.key - 1];
    if (pad) { e.preventDefault(); if (!e.repeat) vcPad(pad, true); }
  });
  w.addEventListener('keyup', e => { const pad = /^[1-8]$/.test(e.key) && VC_PADS[+e.key - 1]; if (pad) vcPad(pad, false); });
  w.addEventListener('pagehide', () => { if (midiWin === w) { midiWin = null; updateMidiUI(); } });
  w.addEventListener('resize', () => bayWires());
  midiCapture(d);   // learning picks the macros drawn there, as in the main window
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
  return !L.on ? ['Press Learn, move a control on your controller, then choose what it should move.']
    : L.pending ? [h('b', null, midiKeyFull(L.pending)), ' moved: choose what it should move in its list, or click it here or in the main window.']
      : L.target ? ['Now move the control for ', h('b', null, midiTargetLabel(L.target)), '.']
        : ['Move a control on your controller, then choose what it should move: in its list, a macro here, or anything in the main window (Master, Blackout, a zone\'s level, a scene, a playlist, an effect\'s control). Or the other way round. While learning, controls learn instead of playing, but the one just learnt plays; Esc stops learning.'];
}
function midiRedraw() {
  if (!project || REMOTE_CLIENT) return;
  const b = $('#btnMidi'), open = midiWinOpen(), L = midi.learn;
  for (const d of [document, scenesDoc()]) if (d) { d.body.classList.toggle('midi-open', open); d.body.classList.toggle('midi-learning', L.on); }
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
  D.body.classList.toggle('midi-open', true);
  D.body.classList.toggle('midi-learning', L.on);
  if ((midiTabSig() !== midiSig || !$('.midipanel, .bay', D)) && !vcHeld && !bayDragging) renderMidiWindow(D);
  else midiTabUpdate(D);
  markMidi();   // again, for what the MIDI window has just drawn
}
// What the MIDI window is built from; when it changes, it is built again
const midiTabSig = () => JSON.stringify([ui.midiOn, midi.status, midi.ports, ui.midiOff, ui.midiMon, ui.midiVc, midi.learn,
  project.midi.maps.map(w => [w.id, w.key, w.to, w.takeover, w.mode, midiTargetLabel(w.to)]), project.midi.order,
  project.zones.map(z => [z.id, z.name, z.scenes.map(s => [s.id, s.name]), z.playlists.map(p => [p.id, p.name])]),
  project.macros.color1.mode, project.macros.color2.mode, midiEffects(), ui.macroOpen, ui.midiView, ui.midiView === 'bay' ? baySig() : 0]);
// The effects in the project: in a zone's layers or in its scenes (so a playlist moving on doesn't change the list)
const midiEffects = () => [...new Set(project.zones.flatMap(z => z.layers.concat(...z.scenes.map(sc => sc.layers)).map(L => L.src)))].filter(id => { const s = id && srcById(id); return s && s.kind === 'isf'; }).sort();

/* ---------- what the MIDI window shows ---------- */
function renderMidiWindow(D) {
  midiSig = midiTabSig(); midiLogShown = null;
  const L = midi.learn, n = midi.ports.filter(p => p.state !== 'disconnected').length;
  const head = h('header', { class: 'mwhead' },
    h('span', { class: 'mwtitle', html: $('#btnMidi svg').outerHTML }, 'MIDI'),
    ui.midiOn ? h('button', { class: 'btn learn' + (L.on ? ' on' : ''), type: 'button', 'aria-pressed': String(L.on), title: 'Learn: move a control, then choose what it should move. Esc stops.', onclick: () => midiSetLearn(!L.on) }, L.on ? 'Learning' : 'Learn') : null,
    ui.midiOn ? h('span', { class: 'mwhint' + (L.on ? ' on' : '') }, midiHint()) : h('span', { class: 'fill' }),
    ui.midiOn ? seg([['list', 'List'], ['bay', 'Patch bay']], ui.midiView === 'bay' ? 'bay' : 'list', v => { ui.midiView = v; bay.sel = null; savePrefs(); updateMidiUI(); }) : null,
    ui.midiOn && midi.status === 'ok' ? h('span', { class: 'pill' + (n ? ' ok' : ' warn') }, h('span', { class: 'dot' }), `${n} controller${n === 1 ? '' : 's'}`) : null,
    ui.midiOn ? h('button', { class: 'btn sm ghost', type: 'button', title: 'Stop listening to MIDI on this computer', onclick: () => setMidiOn(false) }, 'Turn off') : null);
  let body;
  if (!ui.midiOn) {
    body = h('div', { class: 'midipanel off' }, h('div', { class: 'moff' },
      h('p', null, 'Play this project from a MIDI controller: its faders, knobs and pads can move the master, blackout and the zones\' levels, and play their scenes and playlists.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => setMidiOn(true) }, 'Turn MIDI on'),
      h('p', { class: 'note' }, 'The browser may ask whether nouPix can use your MIDI devices.')));
  } else if (ui.midiView === 'bay') body = bayView();
  else body = h('div', { class: 'midipanel' + (ui.midiMon ? '' : ' monshut') }, midiPorts(), midiMaps(), midiMonitor());
  // every column keeps where it was scrolled to (the list, the bay's columns, the monitor): built again after a
  // change or a message, the row under the pointer stays under it
  const where = c => (c.id ? '#' + c.id : '.' + [...c.classList].join('.'));
  const scrolled = $$('.bcol, .mcol, .mmon', D).map(c => [where(c), c.scrollTop]);
  // the messages showing stay: one said just now (Removed…, a mapping learnt) isn't lost to the change it tells of
  D.body.replaceChildren(head, body, ui.midiOn ? midiVc() : '', $('#toasts', D) || h('div', { class: 'toasts', id: 'toasts' }));
  for (const [k, top] of scrolled) { const c = $(k, D); if (c) c.scrollTop = top; }
  midiTabUpdate(D);
  if (ui.midiView === 'bay') midiWin.requestAnimationFrame(() => bayWires());   // once it is laid out
}
function midiPorts() {
  const known = (ui.midiVc ? [MIDI_VIRTUAL] : []).concat(midi.ports.map(p => p.name));
  for (const w of project.midi.maps) { const k = midiKeyParts(w.key); if (k && !known.includes(k.port)) known.push(k.port); }
  const note = { asking: 'Asking for your MIDI devices… The browser may show a question at the top of the main window.',
    none: 'This browser has no MIDI: use Chrome or Edge, or the nouPix app.',
    blocked: 'MIDI was refused, or this computer has none. In Chrome, allow MIDI devices for this page (its site settings), then turn MIDI off and on again.',
    ok: midi.ports.length ? 'Plug controllers in or out at any time: each is found again by its name. On Windows a MIDI port works in one program at a time.' : 'No MIDI controller found: plug one in and it shows here.' }[midi.status] || '';
  return h('div', { class: 'mcol mports' }, h('h3', null, 'Controllers'),
    ...known.map(name => {
      const live = midiPortLive(name), on = midiPortOn(name);
      return h('label', { class: 'mport' + (live ? '' : ' gone'), title: on ? 'Listening. Untick to ignore it.' : 'Ignored. Tick to listen to it.' },
        h('span', { class: 'led', 'data-led': name }), h('span', { class: 'nm', title: name }, name,
          name === MIDI_VIRTUAL ? h('small', null, 'on screen') : live ? null : h('small', null, 'not plugged in')),
        h('input', { type: 'checkbox', checked: on, 'aria-label': 'Listen to ' + name,
          onchange: e => { const off = new Set(ui.midiOff || []); if (e.target.checked) off.delete(name); else off.add(name); ui.midiOff = [...off]; savePrefs(); updateMidiUI(); } }));
    }),
    note ? h('p', { class: 'note' + (midi.status === 'blocked' || midi.status === 'none' ? ' warn' : '') }, note) : null,
    midi.status === 'blocked' && midi.error ? h('p', { class: 'note' }, 'The browser says: ' + midi.error) : null,
    (midi.status === 'blocked' || midi.status === 'none') ? h('p', { class: 'note' }, 'The virtual controller, at the bottom of this window, works anyway.') : null,
    h('h3', { class: 'mmhead' }, 'Macros'), macrosPanel());
}
// What a mapping can drive, as a list: Master, Blackout, the crossfader, then each zone's level, scenes, next scene and playlists
// What a mapping drives, as a list; pick: what choosing does (by default the mapping drives that instead)
function midiTargetSelect(w, pick = to => midiSetMap(w.id, { to })) {
  const opt = (t, label) => h('option', { value: t, selected: w.to === t }, label);
  // the effects of the project (and the one this mapping drives), with the controls a MIDI control can move
  const ids = new Set(midiEffects());
  if (w.to.startsWith('p:')) ids.add(w.to.slice(2, w.to.indexOf(':', 2)));
  const fx = [...ids].map(srcById).filter(src => src && src.kind === 'isf');
  return h('select', { class: 'mtarget', 'aria-label': `What ${midiKeyFull(w.key)} drives`, title: 'What it drives', onchange: e => { if (e.target.value) pick(e.target.value); } },
    !w.to ? h('option', { value: '', selected: true }, 'Choose what it moves…') : midiTarget(w.to) ? null : h('option', { value: w.to, selected: true }, 'Missing: it was deleted'),
    opt('master', 'Master'), opt('blackout', 'Blackout'), opt('xf', 'X-Fader'),
    h('optgroup', { label: 'Macros' }, MACROS.map(d => d.kind === 'color'
      ? MACRO_PARTS[project.macros[d.id].mode].map(([, name], i) => opt(`m:${d.id}.${i}`, `${d.label} · ${name}`))
      : opt('m:' + d.id, d.label))),
    project.groups.length ? h('optgroup', { label: 'Groups' }, project.groups.map(g => opt('gr:' + g.id, groupName(g) + ' dimmer'))) : null,
    project.zones.slice().reverse().map(z => h('optgroup', { label: z.name },
      opt('z:' + z.id, z.name + ' level'),
      z.scenes.map(sc => opt(`sc:${z.id}:${sc.id}`, `${z.name} · ${sc.name}`)),
      z.scenes.length ? opt('nx:' + z.id, z.name + ' · next scene') : null,
      z.playlists.map(pl => opt(`pl:${z.id}:${pl.id}`, `${z.name} · ${pl.name} (playlist)`)))),
    fx.map(src => h('optgroup', { label: src.name + ' (effect)' }, controlsOf(src).map(i => `p:${src.id}:${i.NAME}`).filter(t => midiTarget(t)).map(t => opt(t, midiTargetLabel(t))))));
}
// How a mapping moves what it drives, as buttons: Pickup or Jump for a fader or knob on a fader; Toggle (full, then
// off) or Hold (full while held) for a pad on a fader, and for anything on or off (Follow for a fader or knob); for
// what a press plays, nothing to choose. Null for a mapping whose target is gone.
function midiHow(w) {
  const T = midiTarget(w.to), k = midiKeyParts(w.key);
  if (!T) return null;
  const seg = (key, opts) => h('span', { class: 'seg mini' }, opts.map(([v, label, tip]) => h('button', { type: 'button', class: w[key] === v ? 'on' : '', title: tip, onclick: () => midiSetMap(w.id, { [key]: v }) }, label)));
  if (T.kind === 'fader' && k.type === 'cc') return seg('takeover', [['pickup', 'Pickup', 'It follows once the fader reaches it'], ['jump', 'Jump', 'It goes where the fader is at once']]);
  if (T.kind === 'fader') return seg('mode', [['toggle', 'Toggle', 'Each press: full, then off'], ['hold', 'Hold', 'Full while held, off when let go'], ['flash', 'Flash', 'Full while held, back where it was when let go']]);
  if (T.kind === 'toggle') return seg('mode', [['toggle', 'Toggle', 'Each press turns it on or off'], k.type === 'cc' ? ['hold', 'Follow', 'On while the control is up: a fader past the middle, a button held or latched'] : ['hold', 'Hold', 'On while held'],
    ['flash', 'Flash', 'On while held, back as it was when let go']]);
  return seg('mode', [['toggle', 'Press', 'A press plays it'], ['flash', 'Flash', 'Plays while held (with its fade); let go and what played before comes back']]);
}
function midiMaps() {
  const maps = project.midi.maps;
  const ports = new Set(maps.map(w => midiKeyParts(w.key).port));
  const keyAt = new Map(midiKeyOrder(maps.map(w => w.key)).map((k, i) => [k, i]));   // in the controls' order
  const rows = maps.slice().sort((a, b) => keyAt.get(a.key) - keyAt.get(b.key)).map(w => {
    const k = midiKeyParts(w.key), T = midiTarget(w.to);
    return h('div', { class: 'mmap' + (T ? '' : ' missing'), 'data-map': w.id, title: k.port },
      h('span', { class: 'mk' }, midiKeyFull(w.key), ports.size > 1 ? h('small', null, k.port) : null),
      midiTargetSelect(w),
      midiHow(w) || h('span'),
      // the control's value, and on Pickup, until it has picked up: the mark it has to reach
      h('span', { class: 'cval' }, h('i', { class: 'cbar' }), h('i', { class: 'cpick', hidden: true })),
      h('button', { class: 'x', type: 'button', title: 'Remove this mapping', 'aria-label': `Remove ${midiKeyFull(w.key)} to ${T ? T.label : 'missing'}`, onclick: () => midiDisconnect(w.id) }, icon('x')));
  });
  // learning: the control just moved, at the top, with its list to choose what it moves
  const key = midi.learn.on && midi.learn.pending;
  const fresh = key ? h('div', { class: 'mmap new', title: midiKeyParts(key).port }, h('span', { class: 'mk' }, midiKeyFull(key), h('small', null, 'new')),
    midiTargetSelect({ key, to: '' }, to => midiConnect(key, to)), h('span', { class: 'muted' }, 'or click it')) : null;
  return h('div', { class: 'mcol mmaps' }, h('h3', null, maps.length ? `Mappings · ${maps.length}` : 'Mappings'),
    h('div', { class: 'mlist' }, fresh, ...rows, maps.length || key ? null : h('p', { class: 'note' }, 'None yet. Press Learn, move a fader, knob or pad, then choose what it should move.')));
}
// The monitor folds to its heading
function midiMonitor() {
  const open = !!ui.midiMon;
  return h('div', { class: 'mcol mmoncol' },
    h('h3', null, h('button', { class: 'mfold' + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open), title: open ? 'Fold the monitor' : 'Show every message', onclick: () => { ui.midiMon = !open; savePrefs(); updateMidiUI(); } }, icon('chev'), 'Monitor'),
      h('span', { class: 'fill' }), open ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { midi.log = []; midiLogShown = null; updateMidiUI(); } }, 'Clear') : null),
    open ? h('div', { class: 'mmon', id: 'midiMon' }) : null);
}
// How lit a mapping is: 1 while its control moves, fading to 0 over half a second after it stops. While any is still
// fading, the MIDI window is brought up to date again, so it fades smoothly.
let midiFadeT = 0;
function midiHeat(w) {
  const age = performance.now() - (w._hit || -1e9), heat = age < 120 ? 1 : Math.max(0, 1 - (age - 120) / 500);
  if (heat > 0 && !midiFadeT) midiFadeT = setTimeout(() => { midiFadeT = 0; updateMidiUI(); }, 40);
  return heat;
}
// What changes with each message: the bars of the mapped controls, the controllers' lights, the monitor
function midiTabUpdate(D) {
  for (const b of macroBinders) b();
  if ($('.bay', D)) bayUpdate(D);
  for (const el of $$('.mmap', D)) {
    const w = project.midi.maps.find(x => x.id === el.dataset.map), c = w && midiControlOf(w), bar = el.querySelector('.cbar'), pick = el.querySelector('.cpick');
    if (bar) bar.style.width = c ? c.last * 100 + '%' : '0';
    if (pick) {
      const T = w && midiTarget(w.to), wait = !!(T && T.kind === 'fader' && w.takeover === 'pickup' && midiKeyParts(w.key).type === 'cc' && !midiPicked(w));
      pick.hidden = !wait;
      if (wait) { pick.style.left = T.get() * 100 + '%'; el.title = `Pickup: ${T.label} is at ${Math.round(T.get() * 100)} %. Move the control to the white mark and it follows from there.`; }
      else if (el.title.startsWith('Pickup')) el.title = midiKeyParts(w.key).port;
    }
    el.style.setProperty('--heat', w ? midiHeat(w).toFixed(2) : 0);
  }
  for (const t of $$('.vtrack', D)) {
    const v = vcVals.get(+t.dataset.cc), x = v / 127;
    t.querySelector('.vcap').style.bottom = `calc(8px + ${x} * (100% - 16px))`; t.querySelector('.vfill').style.height = `calc(${x} * (100% - 16px))`;
    t.setAttribute('aria-valuenow', v); t.parentElement.querySelector('.v').textContent = v;
  }
  for (const p of $$('.vpad', D)) p.classList.toggle('down', vcDown.has(+p.dataset.note));
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

/* ---------- the virtual controller ---------- */
// A controller on screen, for trying MIDI without one: 8 faders (CC 21 to 28) and 8 pads (notes 36 to 43, also keys
// 1 to 8 in the MIDI window), on channel 1 of a port called Virtual controller. It folds to its heading.
const VC_FADERS = [21, 22, 23, 24, 25, 26, 27, 28], VC_PADS = [36, 37, 38, 39, 40, 41, 42, 43];
const vcVals = new Map(VC_FADERS.map(n => [n, 0])), vcDown = new Set();
let vcHeld = false;   // a fader held: the MIDI window isn't built again under the pointer
const vcKey = (type, n) => `midi:${MIDI_VIRTUAL}:1:${type}:${n}`;
const vcLabel = key => midiMapsFor(key).map(w => midiTargetLabel(w.to)).join(', ') || '—';
function vcFader(n, v) {
  v = clamp(Math.round(v), 0, 127);
  if (v === vcVals.get(n)) return;
  vcVals.set(n, v);
  midiIn({ port: MIDI_VIRTUAL, ch: 1, type: 'cc', num: n, val: v });
}
function vcPad(n, on) {
  if (vcDown.has(n) === on) return;
  if (on) vcDown.add(n); else vcDown.delete(n);
  midiIn({ port: MIDI_VIRTUAL, ch: 1, type: on ? 'on' : 'off', num: n, val: on ? 100 : 0 });
}
function midiVc() {
  const open = !!ui.midiVc;
  const head = h('div', { class: 'vchead' },
    h('button', { class: 'mfold' + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open), title: open ? 'Fold the virtual controller' : 'Show the virtual controller',
      onclick: () => { ui.midiVc = !open; savePrefs(); updateMidiUI(); } }, icon('chev'), 'Virtual controller'),
    h('span', { class: 'note' }, open ? 'Faders send CC 21 to 28, pads notes 36 to 43 (keys 1 to 8). Learn them like a real controller.' : 'Faders and pads on screen, to try MIDI without a controller.'));
  if (!open) return h('section', { class: 'vc' }, head);
  const faders = VC_FADERS.map((n, i) => {
    const track = h('div', { class: 'vtrack', tabindex: 0, role: 'slider', 'aria-label': `Fader ${i + 1}, CC ${n}`, 'aria-valuemin': 0, 'aria-valuemax': 127, 'data-cc': n },
      h('i', { class: 'vfill' }), h('i', { class: 'vcap' }));
    const at = y => { const r = track.getBoundingClientRect(); return (1 - clamp((y - r.top - 8) / (r.height - 16), 0, 1)) * 127; };
    const up = () => { if (vcHeld) { vcHeld = false; updateMidiUI(); } };
    track.addEventListener('pointerdown', e => { vcHeld = true; track.setPointerCapture(e.pointerId); vcFader(n, at(e.clientY)); });
    track.addEventListener('pointermove', e => { if (vcHeld && track.hasPointerCapture(e.pointerId)) vcFader(n, at(e.clientY)); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(t, up);
    track.addEventListener('wheel', e => { e.preventDefault(); vcFader(n, vcVals.get(n) + (e.deltaY < 0 ? 4 : -4)); }, { passive: false });
    track.addEventListener('keydown', e => { const d = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key]; if (d) { e.preventDefault(); vcFader(n, vcVals.get(n) + d * (e.shiftKey ? 10 : 1)); } });
    const tg = vcLabel(vcKey('cc', n));
    return h('div', { class: 'vf' }, h('span', { class: 'v' }), track, h('span', { class: 'nm' }, 'CC ' + n), h('span', { class: 'tg', title: tg }, tg));
  });
  // a pad sounds while held; its release is heard wherever the pointer goes (the window may be built again meanwhile)
  const pads = VC_PADS.map((n, i) => {
    const tg = vcLabel(vcKey('note', n));
    const el = h('button', { class: 'vpad', type: 'button', 'data-note': n, 'aria-label': `Pad ${i + 1}, note ${n}` }, h('span', { class: 'nm' }, `${i + 1} · Note ${n}`), h('span', { class: 'tg', title: tg }, tg));
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      vcPad(n, true);
      const win = el.ownerDocument.defaultView, off = () => { vcPad(n, false); win.removeEventListener('pointerup', off); win.removeEventListener('pointercancel', off); };
      win.addEventListener('pointerup', off); win.addEventListener('pointercancel', off);
    });
    return el;
  });
  return h('section', { class: 'vc open' }, head, h('div', { class: 'vcbody' }, h('div', { class: 'vfaders' }, faders), h('div', { class: 'vpads' }, pads)));
}

/* ---------- learning, the button ---------- */
// While learning, a touch on something MIDI can drive picks it, and does nothing else (a scene doesn't play, a
// slider doesn't move)
const midiPickEl = e => midi.learn.on && e.target.closest && !e.target.closest('.mfold') && e.target.closest('[data-midi]');
// While learning, a touch on anything marked data-midi picks it, and does nothing else (a slider stays where it was)
function midiCapture(doc) {
  doc.addEventListener('pointerdown', e => {
    const el = midiPickEl(e);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (e.target.type === 'range') e.target._midiKeep = e.target.value;
    midiLearnTarget(el.dataset.midi, e.altKey);
  }, true);
  for (const t of ['click', 'dblclick', 'input', 'change']) doc.addEventListener(t, e => {
    if (!midiPickEl(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.target._midiKeep != null) e.target.value = e.target._midiKeep;
  }, true);
}
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
  midiCapture(document);
  addEventListener('keydown', e => { if (e.key === 'Escape' && midi.learn.on && !typingIn(e.target) && !$('.menu')) midiSetLearn(false); });
}
