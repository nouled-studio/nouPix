// nouPix · js/ui-tempo.js
// Tempo in Settings: the BPM with a dot on every beat and the beats of the bar counting, where the beat comes from
// (listening to a sound card, or tapping), the input and its trim with a level meter, 4/4 or 2/4, Tap and Downbeat.
// What moves is drawn once a frame (tempoFrame, from the frame loop), the rest when something changes (updateTempoUI).

let tempoSecEl = null, tempoLive = null;
// The nouPix mark without its square: the LED's circle, its diode and its two arrows, all in one colour
const TEMPO_MARK = '<svg viewBox="0 0 64 64" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="miter">'
  + '<circle cx="32" cy="32" r="25"/><path d="M2,32 H21 M39,32 H62 M21,21 L39,32 L21,43 Z M39,21 V43"/>'
  + '<path d="M28.32,21.15 L30.83,16.44 M33.72,24.45 L36.23,19.74"/>'
  + '<path d="M33.25,11.88 L32.88,17.53 L28.78,15.35 Z M38.65,15.18 L38.28,20.83 L34.18,18.65 Z" fill="currentColor" stroke="none"/></svg>';
function tempoSection() {
  const src = ui.tempoSrc === 'tap' ? 'tap' : 'audio', listening = tempo.on || tempo.starting, per = tempoBpb();
  // the readout: the nouPix mark lighting on each beat, the BPM, the beats of the bar
  const dot = h('span', { class: 'tmark', html: TEMPO_MARK, 'aria-hidden': 'true' }), num = h('span', { class: 'tbpm' }, tempo.bpm.toFixed(1)), bars = h('span', { class: 'tbar' }, Array.from({ length: per }, () => h('i'))),
    state = h('span', { class: 'tstate' });
  const meter = h('div', { class: 'tmeter', 'aria-hidden': 'true' }, h('i', { class: 'lv' }), h('i', { class: 'rest' }), h('i', { class: 'pk' }));
  tempoLive = { dot, num, bars: [...bars.children], state, meter, lastN: null };
  const readout = h('div', { class: 'tempo-read' }, dot, h('span', { class: 'tnum' }, num, h('small', null, 'BPM')), bars, state);
  const kids = [readout,
    tipRow(row('Beat from', seg([['audio', 'Audio'], ['tap', 'Tap']], src, v => { ui.tempoSrc = v; savePrefs(); updateTempoUI(); })),
      'Audio: nouPix listens to a sound card and finds the beat. Tap: you give it, with Tap or a MIDI pad.')];
  if (src === 'audio') {
    if (!tempoUsable()) kids.push(h('p', { class: 'note warn' }, 'This browser can’t listen to a sound card here.'));
    else {
      const sw = h('button', { class: 'onsw' + (listening ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(listening), disabled: tempo.starting,
        onclick: () => tempoListen(!listening) }, h('i'), listening ? 'ON' : 'OFF');
      const devs = tempo.devices.length ? tempo.devices : [{ id: 'default', name: 'Default input' }];
      // long names (a sound card's are) are cut short with … ; the whole name shows on the list's tip
      const short = n => (n.length > 26 ? n.slice(0, 25).trimEnd() + '…' : n), cur = devs.find(d => d.id === ui.tempoIn) || devs[0];
      const pick = selectEl(devs.map(d => [d.id, short(d.name)]), cur.id, v => tempoInput(v), { aria: 'Sound input' });
      pick.title = cur.name;
      const trim = { v: +ui.tempoTrim || 0 };
      kids.push(row('Listen', sw),
        tipRow(row('Input', pick), 'The sound card nouPix listens to. Their names show once it was allowed to listen.'),
        tipRow(sliderRow('Trim', trim, 'v', { min: -24, max: 24, step: 0.5, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB', onInput: () => tempoTrim(trim.v), onCommit: () => tempoTrim(trim.v) }),
          'The input level. Aim for the meter in the upper part on the loud beats, short of red.'),
        h('div', { class: 'tmrow' }, meter));
      if (tempo.err) kids.push(h('p', { class: 'note warn' }, tempo.err));
    }
  }
  kids.push(tipRow(row('Bar', seg([[4, '4/4'], [2, '2/4']], per, v => { ui.tempoBpb = +v; savePrefs(); updateTempoUI(); })), 'Beats in a bar: the lines count them, 1 on the downbeat.'),
    h('div', { class: 'actions' },
      midiButton(h('button', { class: 'btn', type: 'button', title: 'Tap on every beat. The first tap is beat 1. A MIDI pad can tap too.', onpointerdown: e => { e.preventDefault(); tempoTap(); } }, 'Tap'), 'tap'),
      h('button', { class: 'btn', type: 'button', title: 'The beat nearest now becomes beat 1 of the bar', onclick: () => tempoDownbeat() }, 'Downbeat')));
  const el = h('div', { class: 'sec tempo', id: 'tempoSec' }, h('h3', null, 'Tempo'), kids);
  tempoSecEl = el;
  tempoFrame(performance.now(), true);
  return el;
}
// Drawn again in place when something changes (an input found, listening started, a tap)
function updateTempoUI() {
  if (!tempoSecEl || !tempoSecEl.isConnected) return;
  const old = tempoSecEl;
  old.replaceWith(tempoSection());
  markMidi();
}
// Once a frame while Settings shows it: the mark lights from red to white on each beat and fades back (fully on the
// downbeat, a little less on the others), the bar's lines, the BPM, the meter
function tempoFrame(now, force) {
  const L = tempoLive;
  if (!L || !tempoSecEl || !tempoSecEl.isConnected) return;
  const at = tempoAt(now), sure = ui.tempoSrc === 'tap' ? tempo.taps.length > 1 || !!ui.tempoBpm : tempo.locked;
  const k = sure ? Math.pow(Math.max(0, 1 - at.phase / 0.45), 2) * (at.inBar === 0 ? 1 : 0.75) : 0;
  L.dot.style.color = sure ? `color-mix(in srgb, var(--live) ${Math.round(k * 100)}%, var(--accent))` : '';
  L.dot.classList.toggle('idle', !sure);
  // the bar's lines every frame (a Downbeat or a tap can move them without a new beat)
  L.bars.forEach((b, i) => { const c = sure && i === at.inBar ? (i === 0 ? 'one' : 'on') : sure && i < at.inBar ? 'past' : ''; if (b.className !== c) b.className = c; });
  if (at.n !== L.lastN || force) {
    L.lastN = at.n;
    L.num.textContent = tempo.bpm.toFixed(1);
    L.state.textContent = ui.tempoSrc === 'tap' ? (tempo.taps.length ? `${tempo.taps.length} tap${tempo.taps.length === 1 ? '' : 's'}` : 'Tap the beat')
      : !tempo.on ? 'Not listening' : !tempo.locked ? 'Listening…' : tempo.holding ? 'Holding: no clear beat' : 'Following';
  }
  if (L.meter.isConnected) {
    const w = db => clamp((db + 60) / 60, 0, 1) * 100;
    L.meter.children[1].style.left = w(tempo.on ? tempo.level : -100) + '%';   // the scale shows up to the level
    L.meter.lastChild.style.left = w(tempo.on ? tempo.peak : -100) + '%';
    L.meter.classList.toggle('clip', tempo.on && tempo.peak > -1);
  }
}
