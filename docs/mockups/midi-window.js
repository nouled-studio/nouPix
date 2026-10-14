// openLedMapper · docs/mockups/midi-window.js
// The mapping window: devices (MIDI in and out with their activity LEDs, OSC), the macros and other targets in tabs,
// Color 1 and Color 2, the bindings, a monitor of what comes in, and a virtual controller for trying it all without
// hardware. Learn: click a target and move a control, or move a control and click a target. The engine runs in the
// main window (connectEngine); this window shows its state and sends it what the user does.

let S = null;                        // the engine's latest state
const ui = { tab: 'colour', monPaused: false, showSent: false, vcShut: false, drawer: null, hotBinding: null, pending: false };
const ups = { bank: [], table: [], vc: [] };   // what to refresh in place when only values change
const E = connectEngine(onEvent);
if (E.local) startWebMidi(E.engine);
const op = (name, ...a) => E.op(name, ...a);
const learning = () => !!S && (S.learn.on || !!S.learn.target);

/* ---------- targets, as this window sees them ---------- */
const zoneShim = { zone: id => { const z = S.zones.find(x => x.id === id); return z && { name: z.name, scenes: z.scenes.map(name => ({ name })) }; } };
const TI = id => targetInfo(zoneShim, id);
function valueOf(id) {
  const c = /^macro:(color[12])\.(h|s|v|on)$/.exec(id);
  if (c) return S.colors[c[1]][c[2]];
  if (id.startsWith('macro:')) return S.macros[id.slice(6)];
  if (id === 'master') return S.master;
  if (id === 'blackout') return S.blackout;
  const p = id.split(':'), z = S.zones.find(x => x.id === p[1]);
  if (!z) return 0;
  if (p[2] === 'opacity') return z.opacity;
  if (p[2] === 'scene') return z.scene === +p[3] - 1 ? 1 : 0;
  if (p[2] === 'layer') { const L = z.layers[+p[3] - 1]; return L ? L.opacity : 0; }
  return 0;
}
// A target: while learning, a click picks it (instead of moving it)
function tgt(target, el) {
  el.classList.add('tgt');
  el.dataset.target = target;
  el.addEventListener('click', e => {
    if (!learning() || e.target.closest('.bbadge')) return;
    e.preventDefault(); e.stopImmediatePropagation();   // a pad is a target itself: its own click must not run
    op('learnTarget', target);
  }, true);
  return el;
}
// Learn for one target: the next control moved is bound to it. compact: an icon, for the rows of a colour card
const LEARN_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const learnBtn = (target, compact = false) => h('button', { class: 'btn ghost sm lrn' + (compact ? ' icon' : ''), type: 'button', title: 'Learn: move a control to bind it here', 'aria-label': 'Learn ' + TI(target).label,
  onclick: e => { e.stopPropagation(); op('learnTarget', target, true); } }, compact ? svgEl(LEARN_ICON) : 'Learn');
function badge(b) {
  const osc = b.key.startsWith('osc:');
  return h('span', { class: 'bbadge' + (osc ? ' osc' : '') + (b.offline ? ' off' : ''), 'data-bid': b.id, 'data-key': b.key,
    title: `${keyPort(b.key)}: ${keyLabel(b.key)}${b.offline ? ' (unplugged: kept for when it comes back)' : ''}. Click to find it in the bindings.`,
    onclick: e => { e.stopPropagation(); showBinding(b.id); } },
  keyLabel(b.key), h('span', { class: 'x', role: 'button', tabindex: 0, 'aria-label': 'Remove this binding', title: 'Remove this binding', onclick: e => { e.stopPropagation(); op('unbind', b.id); } }, icon('x')));
}
const badges = target => h('span', { class: 'bbadges' }, S.bindings.filter(b => b.target === target).map(badge));
const affectsBtn = role => {
  const b = h('button', { class: 'affects', type: 'button', onclick: e => { e.stopPropagation(); openAffects(role); } });
  ups.bank.push(() => { b.textContent = `Affects ${S.affects[role]} ▸`; });
  return b;
};

/* ---------- the macro bank ---------- */
const TABS = [['motion', 'Motion'], ['colour', 'Colour'], ['intensity', 'Intensity'], ['zones', 'Zones']];
function strip(target, o) {
  const t = TI(target), val = h('span', { class: 'mval mono' });
  const r = h('input', { type: 'range', min: t.min, max: t.max, step: o.step || (t.max - t.min) / 200, 'aria-label': o.name || t.label, oninput: e => op('set', target, +e.target.value) });
  const el = tgt(target, h('div', { class: 'mstrip' },
    h('div', { class: 'mhead' }, h('span', { class: 'mname' }, o.name || t.label), val, learnBtn(target)),
    o.detent ? h('div', { class: 'detent' }, r) : r,
    h('div', { class: 'mfoot' }, badges(target), h('span', { class: 'fill' }), o.role ? affectsBtn(o.role) : null, o.extra || null)));
  ups.bank.push(() => { const v = valueOf(target); if (document.activeElement !== r) r.value = v; val.textContent = t.fmt(v); });
  return el;
}
// A button as a target: blackout, freeze, a scene
function padTarget(target, name, cls = '') {
  const t = TI(target);
  const el = tgt(target, h('button', { class: 'ptgt ' + cls, type: 'button', onclick: () => op('set', target, t.kind === 'trigger' ? 1 : valueOf(target) ? 0 : 1) },
    h('span', { class: 'pn' }, name), h('span', { class: 'pk' }, t.kind === 'trigger' ? 'Plays it' : 'On or off'), badges(target)));
  ups.bank.push(() => el.classList.toggle('on', !!valueOf(target)));
  return el;
}
function colorCard(k) {
  const n = k.slice(-1), c = () => S.colors[k], sw = h('div', { class: 'bigswatch' });
  const on = h('input', { type: 'checkbox', 'aria-label': `Color ${n} override`, onchange: e => op('set', `macro:${k}.on`, e.target.checked ? 1 : 0) });
  const css = (hh, s, v) => cssRgb(hsvRgb(hh, s, v));
  const tracks = {
    h: x => `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(hh => css(hh, x.s, Math.max(x.v, 0.25))).join(',')})`,
    s: x => `linear-gradient(to right, ${css(x.h, 0, x.v)}, ${css(x.h, 1, x.v)})`,
    v: x => `linear-gradient(to right, #000, ${css(x.h, x.s, 1)})`,
  };
  const sub = (p, label, max, step, fmt) => {
    const target = `macro:${k}.${p}`, val = h('span', { class: 'val' });
    const r = h('input', { type: 'range', class: 'grad', min: 0, max, step, 'aria-label': `${label} ${n}`, oninput: e => op('set', target, +e.target.value) });
    ups.bank.push(() => { const v = c()[p]; if (document.activeElement !== r) r.value = v; val.textContent = fmt(v); r.style.background = tracks[p](c()); });
    return tgt(target, h('div', { class: 'subf' }, h('span', { class: 'lbl' }, label), r, val, learnBtn(target, true), badges(target)));
  };
  const slew = h('input', { type: 'range', min: 0, max: 2, step: 0.05, 'aria-label': `Color ${n} slew`, oninput: e => op('setSlew', k, +e.target.value) }), slewV = h('span', { class: 'mono' });
  const card = h('div', { class: 'ccard' + (c().on ? '' : ' off') },
    h('div', { class: 'cchead' }, h('b', null, 'Color ' + n),
      tgt(`macro:${k}.on`, h('label', { class: 'switch', title: `On: the layers that follow Color ${n} take this colour. Off: they keep their own.` }, on, 'Override')),
      badges(`macro:${k}.on`), h('span', { class: 'fill' }), affectsBtn(k)),
    h('div', { class: 'ccbody' }, sw, h('div', null, sub('h', 'Hue', 360, 1, v => Math.round(v) + '°'), sub('s', 'Sat', 1, 0.01, pct), sub('v', 'Value', 1, 0.01, pct))),
    h('div', { class: 'row' }, h('span', { class: 'lbl', title: 'How long it takes to reach a new colour: smooths a fast fader' }, 'Slew'), h('div', { class: 'slider' }, slew, slewV)));
  ups.bank.push(() => {
    on.checked = !!c().on; card.classList.toggle('off', !c().on);
    sw.style.background = css(c().h, c().s, c().v); sw.classList.toggle('off', !c().on);
    if (document.activeElement !== slew) slew.value = c().slew; slewV.textContent = c().slew.toFixed(2) + ' s';
  });
  return card;
}
function renderBank() {
  ups.bank = [];
  $('#bankTabs').replaceChildren(...TABS.map(([id, label]) => h('button', { type: 'button', role: 'tab', class: ui.tab === id ? 'on' : '', 'aria-selected': String(ui.tab === id), onclick: () => { ui.tab = id; bankSig = ''; render(); } }, label)));
  const B = [];
  if (ui.tab === 'motion') {
    B.push(h('div', { class: 'bankrow' }, strip('macro:speed', { detent: true, role: 'speed', extra: h('button', { class: 'btn sm', type: 'button', onclick: () => op('set', 'macro:speed', 1) }, '1×') }),
      h('div', { class: 'mstrip' }, h('div', { class: 'mhead' }, h('span', { class: 'mname' }, 'Hold still')), h('div', { class: 'ptgts' }, padTarget('macro:freeze', 'Freeze')),
        h('p', { class: 'note' }, 'Speed 0× while it is on, without moving the Speed fader.'))));
    B.push(h('p', { class: 'banknote' }, h('b', null, 'Speed multiplies'), ' each layer\'s own speed: 1× in the middle keeps them as they are set, 0× holds them still, 2× doubles them. Direction stays. Clocks follow too: the tempo of Disco dots and Color hits, the rate of Strobe and Breathe.'));
  } else if (ui.tab === 'colour') {
    B.push(h('div', { class: 'bankrow' }, colorCard('color1'), colorCard('color2')));
    B.push(h('div', { class: 'bankrow' }, strip('macro:sat', { role: 'saturation' })));
    B.push(h('p', { class: 'banknote' }, h('b', null, 'One fader on both hues: '), 'learn it on Hue 1, then on Hue 2. Two faders on one hue work too: the last one moved wins, and the other picks it up again.'));
  } else if (ui.tab === 'intensity') {
    B.push(h('div', { class: 'bankrow' }, strip('macro:intensity', { role: 'intensity' }), strip('master', { name: 'Master' }),
      h('div', { class: 'mstrip' }, h('div', { class: 'mhead' }, h('span', { class: 'mname' }, 'Output')), h('div', { class: 'ptgts' }, padTarget('blackout', 'Blackout', 'bo')))));
    B.push(h('p', { class: 'banknote' }, h('b', null, 'Intensity scales'), ' each layer\'s level; Master is the one in the top bar, after everything.'));
  } else {
    for (const z of S.zones) B.push(h('div', { class: 'zonebank' },
      h('header', null, h('span', { class: 'ztag', style: { borderColor: z.tag } }), z.name),
      h('div', { class: 'bankrow' }, strip(`zone:${z.id}:opacity`, { name: 'Level' }),
        ...z.layers.map((L, i) => strip(`zone:${z.id}:layer:${i + 1}:opacity`, { name: `Layer ${i + 1} · ${L.name}` }))),
      h('div', { class: 'ptgts' }, z.scenes.map((name, i) => padTarget(`zone:${z.id}:scene:${i + 1}`, name)))));
    B.push(h('p', { class: 'banknote' }, 'Layers are bound by their place in the zone (layer 1, 2…), so the binding stays when a scene brings other layers.'));
  }
  $('#bank').replaceChildren(...B);
}

/* ---------- the bindings ---------- */
const unitK = t => (t.fmt === pct ? 100 : 1);
function renderTable() {
  ups.table = [];
  $('#bindMeta').textContent = `${S.bindings.length} · saved with the project · controller moves make no undo steps`;
  if (!S.bindings.length) { $('#btable').replaceChildren(h('div', { class: 'empty' }, 'No bindings yet. Press Learn, click a target, then move a fader, a knob or a pad.')); return; }
  const rows = S.bindings.map(b => {
    const t = TI(b.target), k = unitK(t), range = t.kind === 'range', cont = range && !b.button;
    const num = (key, v) => h('input', { type: 'number', step: k === 100 || t.max > 10 ? 1 : 0.01, value: Math.round(v * k * 100) / 100, 'aria-label': (key === 'min' ? 'From' : 'To') + ' for ' + b.label,
      onchange: e => op('updateBinding', b.id, { [key]: +e.target.value / k }) });
    const sel = (opts, value, key, aria) => h('select', { 'aria-label': aria, onchange: e => op('updateBinding', b.id, { [key]: e.target.value }) },
      Object.entries(opts).map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    const status = h('small');
    if (cont) ups.table.push(() => {
      const live = S.bindings.find(x => x.id === b.id);
      if (!live) return;
      const wait = live.takeover === 'pickup' && !live._picked && live._wait;
      status.className = wait ? 'wait' : live._picked ? 'ok' : '';
      status.textContent = wait ? `move ${live._wait} to ${t.fmt(valueOf(b.target))} ${live._wait === 'up' ? '↑' : '↓'}` : live._picked ? 'in step' : live.takeover === 'pickup' ? 'waits for the fader' : '';
    });
    const tr = h('tr', { 'data-bid': b.id, class: b.offline ? 'off' : '', onmouseenter: () => hotTarget(b.target, true), onmouseleave: () => hotTarget(b.target, false) },
      h('td', null, h('div', { class: 'ctl' }, badge(b), h('small', { title: keyPort(b.key) }, keyPort(b.key) + (b.offline ? ' · unplugged' : '')))),
      h('td', null, h('span', { class: 'tg', title: 'Show it', onclick: () => goTarget(b.target) }, b.label)),
      h('td', null, range ? h('span', { class: 'rng' }, num('min', b.min), '–', num('max', b.max), k === 100 ? '%' : t.max === 360 ? '°' : '') : h('span', { class: 'muted' }, '—')),
      h('td', null, t.kind === 'trigger' ? h('span', { class: 'muted' }, 'Trigger') : cont ? sel(Object.fromEntries(Object.entries(CURVES).map(([v, c]) => [v, c[0]])), b.curve, 'curve', 'Curve')
        : sel({ toggle: BUTTON_MODES.toggle, flash: BUTTON_MODES.flash }, b.mode, 'mode', 'Button')),
      h('td', null, cont ? h('div', { class: 'tk' }, sel(TAKEOVER, b.takeover, 'takeover', 'Takeover'), status) : h('span', { class: 'muted' }, '—')),
      h('td', null, h('input', { type: 'checkbox', checked: b.feedback, title: 'Send the value back: lights pads, moves motor faders, updates OSC', 'aria-label': 'Feedback', onchange: e => op('updateBinding', b.id, { feedback: e.target.checked }) })),
      h('td', null, h('button', { class: 'btn ghost sm icon trash', type: 'button', title: 'Remove', 'aria-label': 'Remove this binding', onclick: () => op('unbind', b.id) }, icon('trash'))));
    return tr;
  });
  $('#btable').replaceChildren(h('table', { class: 'table' },
    h('thead', null, h('tr', null, ...['Control', 'Target', 'Range', 'Curve', 'Takeover', 'Feedback', ''].map(x => h('th', null, x)))),
    h('tbody', null, rows)),
  h('p', { class: 'note', style: { padding: '8px 12px' } }, 'Takeover, for faders that can\'t move by themselves. Pickup: nothing happens until the fader reaches the value. Jump: it goes there at once. Scale: it moves part of the way, so both reach the end together.'));
}
function hotTarget(target, on) { for (const el of $$(`#bank [data-target="${CSS.escape(target)}"]`)) el.classList.toggle('hot', on); }
function goTarget(target) {
  const tab = target.startsWith('zone:') ? 'zones' : /color|sat/.test(target) ? 'colour' : /speed|freeze/.test(target) ? 'motion' : 'intensity';
  if (ui.tab !== tab) { ui.tab = tab; bankSig = ''; render(); }
  const el = $(`#bank [data-target="${CSS.escape(target)}"]`);
  if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.add('hot'); setTimeout(() => el.classList.remove('hot'), 900); }
}
function showBinding(id) {
  const tr = $(`#btable tr[data-bid="${id}"]`);
  if (!tr) return;
  tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  tr.classList.add('hit'); setTimeout(() => tr.classList.remove('hit'), 900);
}

/* ---------- devices ---------- */
function devRow(d, dir) {
  const sw = h('input', { type: 'checkbox', checked: d.on, 'aria-label': `${d.name} on`, onchange: e => op('setPort', dir, d.name, e.target.checked) });
  const sub = d.virtual ? 'on screen, below' : d.sim ? (d.state === 'connected' ? 'simulated' : 'simulated · unplugged') : d.state === 'connected' ? '' : 'unplugged';
  return h('div', { class: 'dev' + (d.state === 'connected' ? '' : ' gone') },
    h('span', { class: 'led' + (dir === 'outputs' ? ' out' : ''), 'data-led': d.name, 'data-dir': dir === 'outputs' ? 'out' : 'in' }),
    h('span', { class: 'nm', title: d.name }, d.name, sub ? h('small', null, sub) : null),
    h('label', { class: 'switch' }, sw));
}
function renderDevices() {
  const d = S.devices, sim = d.inputs.find(x => x.sim);
  const wm = { checking: 'Looking for MIDI ports…', none: 'This browser has no Web MIDI: the virtual controller stands in for one. Chrome, Edge and the app have it.',
    blocked: 'MIDI access was refused here: the virtual controller stands in.', empty: 'No MIDI ports yet: plug one in and it appears here.', ok: 'Plug a controller in or out at any time: it is found by its name, and its bindings come back with it.' }[d.webmidi];
  const o = d.osc;
  const num = (key, v, aria) => h('input', { type: 'number', class: 'port', value: v, min: 1, max: 65535, 'aria-label': aria, onchange: e => op('setOsc', { [key]: +e.target.value }) });
  const tryIn = h('input', { type: 'text', value: '/olm/speed 0.5', 'aria-label': 'OSC message to try', spellcheck: 'false' });
  const sendTry = () => {
    const [path, v] = tryIn.value.trim().split(/\s+/);
    if (!path || !path.startsWith('/') || !isFinite(+v)) { toast('Write an address and a value from 0 to 1, like /olm/speed 0.5', 'warn'); return; }
    op('input', { src: 'osc', path, val: +v });
  };
  tryIn.addEventListener('keydown', e => { if (e.key === 'Enter') sendTry(); });
  $('#devices').replaceChildren(
    h('div', { class: 'devsec' }, h('h3', null, 'MIDI in'), ...d.inputs.map(x => devRow(x, 'inputs')),
      h('button', { class: 'btn sm', type: 'button', title: 'Pretend to plug the nanoKONTROL2 in or out', onclick: () => op('plugSimulated') }, sim.state === 'connected' ? `Unplug the ${SIMULATED}` : `Plug in a ${SIMULATED}`),
      h('p', { class: 'note' }, wm),
      h('p', { class: 'note' }, 'On Windows a MIDI port works in one program at a time: close it in Resolume or MadMapper first.')),
    h('div', { class: 'devsec' }, h('h3', null, 'MIDI out · feedback'), ...d.outputs.map(x => devRow(x, 'outputs')),
      h('p', { class: 'note' }, 'Lights the pads and moves motor faders on the controller of the same name.')),
    h('div', { class: 'devsec' }, h('h3', null, 'OSC'),
      h('div', { class: 'oscrow' }, h('span', { class: 'led', 'data-led': 'OSC', 'data-dir': 'in' }), h('span', { class: 'lbl' }, 'Receive'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: o.on, 'aria-label': 'Receive OSC', onchange: e => op('setOsc', { on: e.target.checked }) })),
        h('div', { class: 'pair' }, h('span', { class: 'muted' }, 'on port'), num('inPort', o.inPort, 'OSC receive port'))),
      h('div', { class: 'oscrow' }, h('span', { class: 'led out', 'data-led': 'OSC', 'data-dir': 'out' }), h('span', { class: 'lbl' }, 'Send feedback to'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: o.outOn, 'aria-label': 'Send OSC', onchange: e => op('setOsc', { outOn: e.target.checked }) })),
        h('div', { class: 'pair' }, h('input', { type: 'text', value: o.outHost, 'aria-label': 'OSC send address', spellcheck: 'false', onchange: e => op('setOsc', { outHost: e.target.value }) }), h('span', { class: 'muted' }, ':'), num('outPort', o.outPort, 'OSC send port'))),
      h('div', { class: 'trymsg' }, tryIn, h('button', { class: 'btn sm', type: 'button', onclick: sendTry }, 'Send in')),
      h('p', { class: 'note' }, 'OSC goes through openledmapper.py, on this computer\'s network. Values from 0 to 1; 1 and 0 press and release a button. Try the message above, or learn it.')));
}

/* ---------- the monitor ---------- */
let monCount = 0;
function addMonitor(e, quiet) {
  if (ui.monPaused || (quiet && !ui.showSent)) return;
  const mon = $('#mon');
  if (mon.querySelector('.empty')) mon.replaceChildren();
  const d = e.targets && e.targets.length ? h('div', { class: 'd go' }, '→ ' + e.targets.join(', ')) : e.note ? h('div', { class: 'd' + (e.note === 'learnt' ? ' learnt' : '') }, e.note === 'learnt' ? 'learnt' : e.note) : e.dir === 'out' ? h('div', { class: 'd' }, 'feedback') : null;
  const row = h('div', { class: 'mrow new' + (e.dir === 'out' ? ' out' : '') }, h('span', { class: 't' }, e.time), h('span', { class: 'm', title: e.port + ' · ' + e.text }, (e.dir === 'out' ? '↗ ' : '') + e.port + ' · ' + e.text), h('span', { class: 'v' }, e.val), d);
  mon.prepend(row);
  setTimeout(() => row.classList.remove('new'), 400);
  while (mon.childElementCount > 160) mon.lastChild.remove();
  $('#monMeta').textContent = `${++monCount} messages`;
}
function initMonitor() {
  $('#mon').replaceChildren(h('div', { class: 'empty' }, 'Move a fader, press a pad or send OSC: each message shows here, with what it drives.'));
  $('#monPause').addEventListener('click', e => { ui.monPaused = !ui.monPaused; e.target.classList.toggle('rev', true); e.target.classList.toggle('on', ui.monPaused); e.target.setAttribute('aria-pressed', String(ui.monPaused)); e.target.textContent = ui.monPaused ? 'Paused' : 'Pause'; });
  $('#monClear').addEventListener('click', () => { monCount = 0; $('#monMeta').textContent = ''; initMonitor.empty(); });
  initMonitor.empty = () => $('#mon').replaceChildren(h('div', { class: 'empty' }, 'Cleared.'));
  $('#monSent').addEventListener('change', e => { ui.showSent = e.target.checked; });
}

/* ---------- the virtual controller ---------- */
// A MIDI port on screen: 8 faders (CC 21 to 28) and 8 pads (notes 36 to 43) on channel 1. With Motor faders on, it
// takes feedback the way a motorised controller does; without, the takeover of each binding shows on its fader.
const VF = [21, 22, 23, 24, 25, 26, 27, 28], VP = [36, 37, 38, 39, 40, 41, 42, 43];
const vf = new Map(VF.map(n => [n, 0])), lit = new Map();
const vkey = (type, n) => `midi:${VIRTUAL}:1:${type}:${n}`;
const boundTo = key => S.bindings.filter(b => b.key === key).map(b => b.label).join(', ');
function sendCC(n, v) {
  v = clamp(Math.round(v), 0, 127);
  if (v === vf.get(n)) return;
  vf.set(n, v);
  op('input', { src: 'midi', port: VIRTUAL, ch: 1, type: 'cc', num: n, val: v });
  refreshVC();
}
function fader(n, i) {
  const fill = h('div', { class: 'vfill' }), cap = h('div', { class: 'vcap' }), ghost = h('div', { class: 'vghost', hidden: true });
  const track = h('div', { class: 'vtrack', tabindex: 0, role: 'slider', 'aria-label': `Fader ${i + 1}, CC ${n}`, 'aria-valuemin': 0, 'aria-valuemax': 127 }, fill, ghost, cap);
  const v = h('span', { class: 'v' }), tg = h('span', { class: 'tg' });
  const at = y => { const r = track.getBoundingClientRect(); return (1 - clamp((y - r.top - 8) / (r.height - 16), 0, 1)) * 127; };
  track.addEventListener('pointerdown', e => { track.setPointerCapture(e.pointerId); track.focus(); sendCC(n, at(e.clientY)); track.onpointermove = ev => sendCC(n, at(ev.clientY)); });
  track.addEventListener('pointerup', () => { track.onpointermove = null; });
  track.addEventListener('wheel', e => { e.preventDefault(); sendCC(n, vf.get(n) + (e.deltaY < 0 ? 2 : -2)); }, { passive: false });
  track.addEventListener('keydown', e => { const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); sendCC(n, vf.get(n) + d * (e.shiftKey ? 10 : 1)); } });
  const el = h('div', { class: 'vf', 'data-key': vkey('cc', n) }, v, track, h('span', { class: 'nm' }, 'F' + (i + 1)), tg);
  ups.vc.push(() => {
    const x = vf.get(n) / 127, pos = `calc(8px + ${x} * (100% - 16px))`;
    cap.style.bottom = pos; fill.style.height = `calc(${x} * (100% - 16px))`;
    v.textContent = vf.get(n); track.setAttribute('aria-valuenow', vf.get(n));
    tg.textContent = boundTo(vkey('cc', n)) || '—'; tg.title = tg.textContent;
    // where a binding waiting for pickup wants the fader to go
    const w = S.bindings.find(b => b.key === vkey('cc', n) && b.takeover === 'pickup' && !b._picked && b.kind === 'range');
    ghost.hidden = !w;
    if (w) { ghost.style.bottom = `calc(8px + ${w.pos} * (100% - 16px))`; ghost.dataset.dir = w.pos > x ? '↑' : '↓'; ghost.title = `${w.label} is at ${TI(w.target).fmt(valueOf(w.target))}: move the fader there to pick it up`; }
  });
  return el;
}
function pad(n, i) {
  const tg = h('span', { class: 'tg' });
  const press = on => { el.classList.toggle('down', on); op('input', { src: 'midi', port: VIRTUAL, ch: 1, type: on ? 'on' : 'off', num: n, val: on ? 100 : 0 }); };
  const el = h('button', { class: 'vpad', type: 'button', 'data-key': vkey('note', n), 'aria-label': `Pad ${i + 1}, note ${n}` }, h('span', { class: 'nm' }, 'P' + (i + 1)), tg);
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); press(true); });
  el.addEventListener('pointerup', () => press(false));
  el.addEventListener('pointercancel', () => press(false));
  el.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(true); } });
  el.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') press(false); });
  ups.vc.push(() => { tg.textContent = boundTo(vkey('note', n)) || '—'; tg.title = tg.textContent; el.classList.toggle('lit', !!lit.get(n)); });
  return el;
}
function renderVC() {
  ups.vc = [];
  const motor = h('input', { type: 'checkbox', checked: S.devices.motor, 'aria-label': 'Motor faders', onchange: e => op('setMotor', e.target.checked) });
  $('#vc').classList.toggle('shut', ui.vcShut);
  $('#vc').replaceChildren(
    h('div', { class: 'vchead' }, h('h2', null, 'Virtual controller'), h('span', { class: 'meta' }, 'channel 1 · faders CC 21–28 · pads notes 36–43'), h('span', { class: 'fill' }),
      h('label', { class: 'switch', title: 'Takes feedback like motorised faders: no pickup needed' }, motor, 'Motor faders'),
      h('button', { class: 'btn ghost sm', type: 'button', title: ui.vcShut ? 'Show the virtual controller' : 'Hide the virtual controller', onclick: () => { ui.vcShut = !ui.vcShut; renderVC(); refreshVC(); } }, ui.vcShut ? '▴' : '▾')),
    h('div', { class: 'vcbody' }, h('div', { class: 'vfaders' }, VF.map(fader)), h('div', { class: 'vpads' }, VP.map(pad)),
      h('p', { class: 'vcnote' }, 'A MIDI port on screen, for trying this without hardware. Drag a fader (or scroll on it), press a pad. A dashed line on a fader is where its target is: move there to pick it up.')));
}
const refreshVC = () => { for (const f of ups.vc) f(); };

/* ---------- the Affects drawer ---------- */
const ROLE_TITLES = { speed: 'Speed', color1: 'Color 1', color2: 'Color 2', saturation: 'Saturation', intensity: 'Intensity' };
function openAffects(role) { ui.drawer = role; renderDrawer(); }
function closeAffects() { ui.drawer = null; renderDrawer(); }
let drawerOpen = new Set(['z1:now', 'z2:now', 'z3:now']);
function renderDrawer() {
  $$('.drawer, .drawer-bg').forEach(x => x.remove());
  const role = ui.drawer;
  if (!role) return;
  const items = S.params.filter(p => p.role === role);
  // inputs with no role that could follow this macro: link them in the Content tab
  const loose = S.params.filter(p => !p.role && p.where === 'now' && (role === 'color1' || role === 'color2' ? p.type === 'color' : (role === 'speed' || role === 'saturation') && p.custom && p.type === 'float'));
  const on = items.filter(p => !p.excluded).length;
  const zones = [...new Set(items.map(p => p.zone))];
  const groups = zones.map(zid => {
    const zi = items.filter(p => p.zone === zid), z = S.zones.find(x => x.id === zid), wheres = [...new Set(zi.map(p => p.where))];
    return wheres.map(w => {
      const list = zi.filter(p => p.where === w), id = zid + ':' + w;
      const det = h('details', { open: drawerOpen.has(id) },
        h('summary', null, h('span', { class: 'chev' }, icon('chev')), h('span', { class: 'ztag', style: { borderColor: z.tag } }), `${z.name} · ${list[0].whereLabel}`,
          h('span', { class: 'cnt' }, `${list.filter(p => !p.excluded).length} of ${list.length}`)),
        list.map(p => h('label', { class: 'arow' + (p.excluded ? ' out' : '') },
          h('input', { type: 'checkbox', checked: !p.excluded, onchange: e => op('setExcluded', p.zone, p.layer, p.input, !e.target.checked) }),
          h('span', { class: 'nm', title: `${p.shader} · ${p.label}` }, `Layer ${p.layerN} · ${p.shader} · `, h('small', null, p.label)),
          h('span', { class: 'how ' + (p.how || ''), title: { header: "Linked by the shader's header (OLM_ROLES)", name: 'Linked by its name', hand: 'Linked by hand, in the Content tab', layer: 'Every layer' }[p.how] }, HOW_LABEL[p.how]))));
      det.addEventListener('toggle', () => { if (det.open) drawerOpen.add(id); else drawerOpen.delete(id); });
      return det;
    });
  });
  const looseBox = loose.length ? h('details', { open: true }, h('summary', null, h('span', { class: 'chev' }, icon('chev')), 'Not linked, could follow', h('span', { class: 'cnt' }, String(loose.length))),
    loose.map(p => h('div', { class: 'arow', style: { cursor: 'default' } }, h('span'), h('span', { class: 'nm' }, `${S.zones.find(z => z.id === p.zone).name} · ${p.shader} · `, h('small', null, p.label)),
      h('button', { class: 'btn sm', type: 'button', onclick: () => op('setHandRole', p.zone, p.layer, p.input, role) }, 'Link')))) : null;
  const bg = h('div', { class: 'drawer-bg', onclick: closeAffects });
  const dr = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': `${ROLE_TITLES[role]} affects` },
    h('header', null, h('div', { class: 'tt' }, `${ROLE_TITLES[role]} affects ${on} ${role === 'intensity' ? 'layers' : 'parameters'}`, h('span', { class: 'fill' }),
      h('button', { class: 'btn ghost sm icon', type: 'button', 'aria-label': 'Close', onclick: closeAffects }, icon('x'))),
      h('p', { class: 'note' }, `In the layers playing now and in every scene${items.length > on ? `, with ${items.length - on} left out` : ''}. A layer that a scene brings in, or that you add later, follows by itself. Untick one to leave it out.`)),
    h('div', { class: 'dbody' }, ...groups.flat(), looseBox),
    h('footer', null, 'Built-in shaders say what follows which macro in their header. Your own shaders are linked by their input names (speed, rate, color, background…), or by hand in the Content tab.'));
  document.body.append(bg, dr);
}

/* ---------- header ---------- */
function renderHead() {
  const L = S.learn, on = L.on || !!L.target;
  $('#mw').classList.toggle('learning', on);
  const b = $('#learn');
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Learning' : 'Learn';
  const tl = L.target && TI(L.target).label;
  $('#hint').replaceChildren(...(!on ? [] : L.target ? ['Move a fader, a knob or a pad for ', h('b', null, tl), '…'] : L.pending ? [h('b', null, keyLabel(L.pending)), ' moved: click a target to bind it.']
    : ['Click a target, then move a control. Or the other way round. Esc stops.']));
  for (const el of $$('#bank .tgt')) el.classList.toggle('pick', el.dataset.target === L.target);
  const d = S.devices, live = d.inputs.filter(x => x.on && x.state === 'connected');
  $('#pillMidi').className = 'pill' + (live.length ? ' ok' : ' warn');
  $('#pillMidi').lastChild.textContent = `MIDI: ${live.length} in`;
  $('#pillOsc').className = 'pill' + (d.osc.on ? ' ok' : '');
  $('#pillOsc').lastChild.textContent = d.osc.on ? `OSC: port ${d.osc.inPort}` : 'OSC off';
}

/* ---------- state and events ---------- */
let bankSig = '', tableSig = '', devSig = '', vcSig = '', drawerSig = '';
function render() {
  const bsig = b => [b.id, b.key, b.target, b.offline];
  const nb = JSON.stringify([ui.tab, S.bindings.map(bsig), S.zones.map(z => [z.name, z.scenes, z.layers.map(L => L.name)])]);
  if (nb !== bankSig) { bankSig = nb; renderBank(); }
  const nt = JSON.stringify(S.bindings.map(b => [bsig(b), b.min, b.max, b.curve, b.takeover, b.feedback, b.mode]));
  const typing = $('#btable').contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number';
  if (nt !== tableSig && !typing) { tableSig = nt; renderTable(); }
  const nd = JSON.stringify(S.devices), ae = document.activeElement;
  if (nd !== devSig && !($('#devices').contains(ae) && ae.tagName === 'INPUT' && ae.type !== 'checkbox')) { devSig = nd; renderDevices(); }
  const nv = JSON.stringify([S.devices.motor, ui.vcShut]);
  if (nv !== vcSig) { vcSig = nv; renderVC(); }
  const nr = JSON.stringify([ui.drawer, ui.drawer && S.params.filter(p => p.role === ui.drawer || !p.role)]);
  if (nr !== drawerSig) { drawerSig = nr; renderDrawer(); }
  renderHead();
  for (const f of [...ups.bank, ...ups.table]) f();
  for (const b of S.bindings) { const el = $(`#bank .bbadge[data-bid="${b.id}"]`); if (el) el.classList.toggle('wait', b.takeover === 'pickup' && !b._picked && !!b._wait); }
  refreshVC();
}
function flashKey(key) {
  for (const el of $$(`.bbadge[data-key="${CSS.escape(key)}"]`)) { el.classList.add('hit'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('hit'), 160); }
  for (const b of S.bindings.filter(x => x.key === key)) {
    const tr = $(`#btable tr[data-bid="${b.id}"]`);
    if (tr) { tr.classList.add('hit'); clearTimeout(tr._t); tr._t = setTimeout(() => tr.classList.remove('hit'), 220); }
  }
}
function onEvent(ev) {
  if (ev.t === 'state') { S = ev.s; render(); return; }
  if (!S) return;
  if (ev.t === 'msg') { addMonitor(ev.e, ev.quiet); if (ev.e.dir === 'in') flashKey(ev.e.key); }
  else if (ev.t === 'led') { for (const el of $$(`.led[data-led="${CSS.escape(ev.port)}"][data-dir="${ev.dir}"]`)) { el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 80); } }
  else if (ev.t === 'fb') {
    const k = keyParts(ev.key);
    if (k.port !== VIRTUAL) return;
    if (k.type === 'cc' && S.devices.motor) vf.set(k.num, Math.round(ev.c * 127));
    if (k.type === 'note') lit.set(k.num, ev.c > 0.5);
    refreshVC();
  } else if (ev.t === 'toast') { toast(ev.text); if (ev.bound) setTimeout(() => goTarget(ev.bound.target), 60); }
}

/* ---------- start ---------- */
$('#learn').addEventListener('click', () => op('setLearn', !learning()));
$('#btnExport').addEventListener('click', () => toast('Export and import of bindings: a file per controller, for another project. Not in this mockup.'));
$('#btnImport').addEventListener('click', () => toast('Export and import of bindings: a file per controller, for another project. Not in this mockup.'));
addEventListener('keydown', e => {
  if (typingIn(e.target)) return;
  if (e.key === 'Escape') { if (ui.drawer) closeAffects(); else if (learning()) op('setLearn', false); }
  else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) op('setLearn', !learning());
});
initMonitor();
if (!E.local) setTimeout(() => { if (!S) toast('The main window does not answer: open this from its MIDI and OSC button.', 'warn'); }, 1500);
