// nouPix · js/ui-tempo.js
// Tempo in Settings: the BPM with a dot on every beat and the beats of the bar counting, where the beat comes from
// (listening to a sound card, or tapping), the input and its trim with a level meter, 4/4 or 2/4, Tap and Downbeat.
// What moves is drawn once a frame (tempoFrame, from the frame loop), the rest when something changes (updateTempoUI).

let tempoSecEl = null, tempoLive = null;
function tempoSection() {
  const src = ui.tempoSrc === 'tap' ? 'tap' : 'audio', listening = tempo.on || tempo.starting, per = tempoBpb();
  // the readout: the dot, the BPM, the beats of the bar
  const dot = h('i', { class: 'tdot' }), num = h('span', { class: 'tbpm' }, tempo.bpm.toFixed(1)), bars = h('span', { class: 'tbar' }, Array.from({ length: per }, () => h('i'))),
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
      const pick = selectEl(devs.map(d => [d.id, d.name]), devs.some(d => d.id === ui.tempoIn) ? ui.tempoIn : devs[0].id, v => tempoInput(v), { aria: 'Sound input' });
      const trim = { v: +ui.tempoTrim || 0 };
      kids.push(row('Listen', sw),
        tipRow(row('Input', pick), 'The sound card nouPix listens to. Their names show once it was allowed to listen.'),
        tipRow(sliderRow('Trim', trim, 'v', { min: -24, max: 24, step: 0.5, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB', onInput: () => tempoTrim(trim.v), onCommit: () => tempoTrim(trim.v) }),
          'The input level. Aim for the meter in the upper part on the loud beats, short of red.'),
        row('', meter));
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
// Once a frame while Settings shows it: the dot on each beat (red on the downbeat), the bar's lines, the BPM, the meter
function tempoFrame(now, force) {
  const L = tempoLive;
  if (!L || !tempoSecEl || !tempoSecEl.isConnected) return;
  const at = tempoAt(now), sure = ui.tempoSrc === 'tap' ? tempo.taps.length > 1 || !!ui.tempoBpm : tempo.locked;
  const hit = at.phase < 0.15 && sure;
  L.dot.className = 'tdot' + (hit ? (at.inBar === 0 ? ' one' : ' on') : '');
  if (at.n !== L.lastN || force) {
    L.lastN = at.n;
    L.bars.forEach((b, i) => { b.className = sure && i === at.inBar ? (i === 0 ? 'one' : 'on') : sure && i < at.inBar ? 'past' : ''; });
    L.num.textContent = tempo.bpm.toFixed(1);
    L.state.textContent = ui.tempoSrc === 'tap' ? (tempo.taps.length ? `${tempo.taps.length} tap${tempo.taps.length === 1 ? '' : 's'}` : 'Tap the beat')
      : !tempo.on ? 'Not listening' : !tempo.locked ? 'Listening…' : tempo.conf < 0.15 ? 'Holding the beat' : 'Following';
  }
  if (L.meter.isConnected) {
    const w = db => clamp((db + 60) / 60, 0, 1) * 100;
    L.meter.children[1].style.left = w(tempo.on ? tempo.level : -100) + '%';   // the scale shows up to the level
    L.meter.lastChild.style.left = w(tempo.on ? tempo.peak : -100) + '%';
    L.meter.classList.toggle('clip', tempo.on && tempo.peak > -1);
  }
}
