// nouPix · js/ui-videoin.js
// In the Content tab: a camera's or video input's device, its state, size and rate, fit (deviceSections) and what it
// does to its picture (Image: flip, rotate, invert, brightness, contrast, saturation, crop); and the Ambilight's
// settings (ambilightSection). The engine is videoin.js.

function deviceSections(src) {
  const st = devState(src), el = mediaEls.get(src.id), cap = src.kind === 'capture';
  // its kind's devices first, then the others (a capture card that names itself oddly can still be picked)
  const named = devices.list.filter(d => d.deviceId);
  const mine = named.filter(d => isCaptureLabel(d.label) === cap), other = named.filter(d => isCaptureLabel(d.label) !== cap);
  const opts = mine.concat(other).map((d, i) => [d.deviceId, d.label || `${cap ? 'Video input' : 'Camera'} ${i + 1}`]);
  if (src.device && !opts.some(o => o[0] === src.device)) opts.unshift([src.device, `${src.label || 'Its device'} (not connected)`]);
  const pick = opts.length ? selectEl(opts, src.device || opts[0][0], v => setSourceDevice(src, v), { aria: 'Device' })
    : h('span', { class: 'note' }, devices.list.length ? 'Start to see their names' : 'None found yet');
  const say = el ? `Receiving${st.size ? `, ${st.size[0]} × ${st.size[1]}` : ''}${st.fps ? ` at ${Math.round(st.fps)} fps` : ''}.`
    : st.opening ? 'Opening…' : st.err || (REMOTE_CLIENT ? 'It plays on the main computer.' : 'Off: it opens while a layer shows it.');
  const k = [row('Device', pick),
    h('p', { class: 'note' + (st.err && !el ? ' warn' : '') }, say),
    REMOTE_CLIENT ? null : h('div', { class: 'actions' },
      el ? h('button', { class: 'btn', type: 'button', onclick: () => stopDevice(src) }, 'Stop')
        : h('button', { class: 'btn primary', type: 'button', onclick: () => startDevice(src) }, 'Start'),
      h('button', { class: 'btn', type: 'button', title: 'Look again for cameras and video inputs', onclick: () => listVideoDevices().then(() => renderRight()) }, 'Refresh list')),
    tipRow(row('Resolution', seg(VIDEO_RES, src.res, v => setDeviceFormat(src, 'res', v))), 'What it is asked for: it gives the nearest it can. Auto: its own.'),
    row('Frame rate', seg(VIDEO_FPS, src.fps, v => setDeviceFormat(src, 'fps', v))),
    row('Fit', seg(FIT_OPTIONS, src.fit || 'fill', v => { src.fit = v; markThumb(src); commit(); }))];
  if (!named.length && !REMOTE_CLIENT) listVideoDevices().then(l => { if (l.some(d => d.deviceId)) renderRight(); });
  return [sec(cap ? 'Video input' : 'Camera input', k), videoProcSection(src)];
}
// What it does to its picture: live as it is moved, one step of undo when let go
function videoProcSection(src) {
  const p = src.proc, live = () => markThumb(src), done = () => { markThumb(src); commit(); };
  const sl = (label, key, max, tip) => tipRow(sliderRow(label, p, key, { min: 0, max, step: 0.01, fmt: pct, onInput: live, onCommit: done }), tip);
  const crop = (label, key) => sliderRow(label, p, key, { min: 0, max: 0.45, step: 0.01, fmt: pct, onInput: live, onCommit: done });
  const open = macroOpen().has('crop');
  return sec('Image',
    checkRow('Flip horizontally', p, 'flipH', done),
    checkRow('Flip vertically', p, 'flipV', done),
    row('Rotate', seg([[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']], p.rotate, v => { p.rotate = +v; done(); })),
    checkRow('Invert', p, 'invert', done),
    sl('Brightness', 'brightness', 2, '100 % leaves it as it is.'),
    sl('Contrast', 'contrast', 2, '100 % leaves it as it is.'),
    sl('Saturation', 'saturation', 2, '0 % is grey, 100 % as it is.'),
    h('div', { class: 'row mshared' }, foldBtn(open, 'Crop', () => toggleMacroOpen('crop'), open ? 'Fold it' : 'Cut its edges off: black bars, a part of the picture'),
      h('span', { class: 'msum' }, ['cropL', 'cropR', 'cropT', 'cropB'].some(k => p[k] > 0) ? 'on' : '')),
    open ? h('div', { class: 'msub' }, crop('Left', 'cropL'), crop('Right', 'cropR'), crop('Top', 'cropT'), crop('Bottom', 'cropB')) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { src.proc = fixVideoProc(); done(); renderRight(); } }, 'Reset image')));
}
// The Ambilight: the source it follows and how its light spreads around the picture
function ambilightSection(L, src) {
  const p = ambiParams(L, src);
  // kept on the layer: while dragging (wr), and as a step of undo with the panel drawn again (put)
  const wr = (k, v) => { (L.params[src.id] = Object.assign({}, L.params[src.id] || {}))[k] = v; };
  const put = (k, v) => { wr(k, v); commit(); renderRight(); };
  const holder = k => ({ get v() { return ambiParams(L, src)[k]; }, set v(x) { wr(k, x); } });
  const sl = (label, k, fmt, tip, more = {}) => tipRow(sliderRow(label, holder(k), 'v', Object.assign({ min: AMBI_RANGES[k][0], max: AMBI_RANGES[k][1], step: 0.01, fmt, onCommit: () => commit() }, more)), tip);
  // pictures first (videos, images, cameras, inputs, captures, streams), then effects
  const can = project.sources.filter(s => ambiCanFollow(s) && s.id !== src.id);
  const opts = can.filter(s => s.kind !== 'isf' && s.kind !== 'chase').concat(can.filter(s => s.kind === 'isf' || s.kind === 'chase')).map(s => [s.id, s.name]);
  const known = !p.from || can.some(s => s.id === p.from);
  return sec('Ambilight',
    row('Source', selectEl([['', 'Choose a source…'], ...(known ? [] : [[p.from, 'Missing: it was removed']]), ...opts], p.from, v => put('from', v), { aria: 'What the Ambilight follows' })),
    p.from && known ? null : h('p', { class: 'note' }, 'Choose the picture it follows: a video, a camera, a video input, a screen capture, a stream or an effect.'),
    sl('Picture width', 'width', pct, 'The picture’s width in the middle of the zone. Patch the fixtures around it.'),
    sl('Picture height', 'height', pct, 'The picture’s height in the middle of the zone.'),
    tipRow(row('Middle', seg(AMBI_MIDDLE, p.middle, v => put('middle', v))), 'Picture: the source itself. Glow: its colours, softened. Black: only the light around it.'),
    sl('Depth', 'depth', pct, 'How far into the picture each edge’s colour is taken from.'),
    sl('Segments', 'segments', v => String(Math.round(v)), 'How many colours along each edge: few for broad washes, many for detail.', { step: 1, int: true }),
    sl('Softness', 'softness', pct, 'How much the light is blurred.'),
    sl('Fall-off', 'falloff', pct, 'How much the light fades towards the zone’s outer edge.'),
    sl('Brightness', 'gain', pct, '100 % leaves the colours as they are.'),
    sl('Saturation', 'saturation', pct, 'Above 100 % the colours are stronger than the picture’s.'),
    sl('Smoothing', 'smooth', v => v.toFixed(2) + ' s', 'How slowly the light follows the picture: less flicker on fast cuts.'),
    h('p', { class: 'note' }, 'Patch your fixtures around the picture: each one lights with the colour of the edge nearest it.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { L.params[src.id] = { from: p.from }; commit(); renderRight(); } }, 'Reset to defaults')));
}
