/* ---------- Import a MadMapper 6 project (beta) ----------
   A .mad file is Qt's binary stream (QDataStream, version 18): a magic number, then nested maps of named values. Its
   'surfaces' hold the fixtures (fixturecircle, fixtureline, and grids of pixels): each its four corners in MadMapper's
   space (y up), its pixels (width × height), their type (RGB…), the channel each pixel starts at, its universe and start
   channel. Its project settings hold the Art-Net devices MadMapper found (artNetRoutingTables: their addresses and the
   universes each listens to). nouPix makes the fixtures on the stage, fitted to the canvas, and one Manual controller per
   device, each fixture at its universe and channel. A zipped .madproject works too (the .mad inside it is read). */

// The binary stream: big-endian; strings in UTF-16
function madDecode(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let p = 0;
  const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
  const i32 = () => { const v = dv.getInt32(p); p += 4; return v; };
  const f64 = () => { const v = dv.getFloat64(p); p += 8; return v; };
  const byte = () => u8[p++];
  const qstr = () => {
    const n = u32();
    if (n === 0xFFFFFFFF) return null;
    let s = '';
    for (let i = 0; i < n; i += 2) s += String.fromCharCode(dv.getUint16(p + i));
    p += n;
    return s;
  };
  const qbytes = () => { const n = u32(); if (n === 0xFFFFFFFF) return null; const b = u8.subarray(p, p + n); p += n; return b; };
  const list = f => { const n = u32(), a = []; for (let i = 0; i < n; i++) a.push(f()); return a; };
  const vmap = () => { const n = u32(), o = {}; for (let i = 0; i < n; i++) { const k = qstr(); o[k] = variant(); } return o; };
  function user() {
    const name = String.fromCharCode(...qbytes()).replace(/\0+$/, '');
    if (name === 'MadColor') { const spec = qstr(); return spec === 'p' ? (i32(), f64(), null) : (f64(), f64(), f64(), f64(), null); }
    if (name === 'FilePath') return qstr();
    if (name === 'IndexFloatMap') return list(() => [i32(), f64()]);
    if (name === 'IndexVariantMap') return list(() => [i32(), variant()]);
    const m = /^(?:QList|QVector)<(.+)>$/.exec(name);
    const el = m && { float: f64, double: f64, int: i32, uint: u32, QString: qstr, QPointF: () => [f64(), f64()], QVariant: variant }[m[1]];
    if (el) return list(el);
    throw new Error(`a value of type ${name} at byte ${p}`);
  }
  function variant() {
    const t = u32(); byte();   // its type, then whether it is null
    switch (t) {
      case 0: qstr(); return null;   // nothing (written with an empty string after it)
      case 1: return !!byte();
      case 2: return i32();
      case 3: return u32();
      case 4: case 5: { const v = Number(dv.getBigInt64(p)); p += 8; return v; }
      case 6: case 38: case 135: return f64();
      case 7: p += 2; return null;
      case 8: return vmap();
      case 9: return list(variant);
      case 10: case 17: return qstr();
      case 11: return list(qstr);
      case 12: case 145: return qbytes();
      case 19: case 23: return [i32(), i32(), i32(), i32()];
      case 20: case 24: return [f64(), f64(), f64(), f64()];
      case 21: case 25: return [i32(), i32()];
      case 22: case 26: return [f64(), f64()];
      case 28: { const n = u32(), o = {}; for (let i = 0; i < n; i++) { const k = qstr(); o[k] = variant(); } return o; }
      case 67: byte(); p += 10; return null;   // a colour
      case 70: {   // an image: 0, or 1 and a PNG to its end
        if (u32() === 0) return null;
        let i = p;
        while (i < u8.length - 4 && !(u8[i] === 0x49 && u8[i + 1] === 0x45 && u8[i + 2] === 0x4E && u8[i + 3] === 0x44)) i++;
        p = i + 8; return null;
      }
      case 81: { const m = []; for (let i = 0; i < 9; i++) m.push(f64()); return m; }
      case 134: return byte();
      case 127: return user();
    }
    throw new Error(`a value of type ${t} at byte ${p - 5}`);
  }
  if (u32() !== 0x0BADBABE) throw new Error('not a MadMapper project');
  u32();   // the stream's version
  return vmap();
}

// The .mad inside a zipped .madproject (the project itself, not a backup)
async function madFromZip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip file');
  const n = dv.getUint16(e + 10, true), files = [];
  let off = dv.getUint32(e + 16, true);
  for (let k = 0; k < n && dv.getUint32(off, true) === 0x02014b50; k++) {
    const nl = dv.getUint16(off + 28, true);
    files.push({ name: new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nl)), method: dv.getUint16(off + 10, true), size: dv.getUint32(off + 20, true), at: dv.getUint32(off + 42, true) });
    off += 46 + nl + dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true);
  }
  const f = files.filter(f => /\.mad$/i.test(f.name) && !/(^|\/)(Backup|__MACOSX)\//i.test(f.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  if (!f) throw new Error('no MadMapper project (.mad) in that zip');
  const start = f.at + 30 + dv.getUint16(f.at + 26, true) + dv.getUint16(f.at + 28, true), data = u8.slice(start, start + f.size);
  if (f.method === 0) return data.buffer;
  if (f.method !== 8) throw new Error('that zip is packed in a way nouPix does not read');
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
}

// MadMapper's pixel types as nouPix's colour orders (unknown ones as RGB, said)
function madOrder(t) {
  const s = String(t || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (ORDERS.includes(s) && !isTunable(s)) return s;
  if (/^(W|WHITE|MONO|SINGLE|DIMMER|L|LUMINANCE)$/.test(s)) return 'W';
  return null;
}

// What nouPix needs from a MadMapper project: its fixtures, each with its pixels where MadMapper places them (in the
// order they are wired, by the channel each starts at), its patch, and the devices MadMapper found
function madRig(top) {
  const S = Array.isArray(top.surfaces) ? top.surfaces : [], rel = Array.isArray(top.surfacesRelations) ? top.surfacesRelations : [];
  const fixtures = [], notes = [];
  S.forEach((s, i) => {
    if (!s || !/^fixture/.test(s.type) || !s.fixture) return;
    const fx = s.fixture, W = Math.max(1, fx.width | 0), H = Math.max(1, fx.height | 0), n = W * H;
    const q = s.positions instanceof Uint8Array && s.positions.length >= 4 ? s.positions : null;
    if (!q) { notes.push(`${s.name}: no position, left out.`); return; }
    const qv = new DataView(q.buffer, q.byteOffset, q.byteLength), c = [];
    for (let k = 0; k < Math.min(4, qv.getUint32(0)); k++) c.push([qv.getFloat64(4 + 16 * k), qv.getFloat64(12 + 16 * k)]);
    if (c.length < 4) { notes.push(`${s.name}: its shape is not one nouPix reads, left out.`); return; }
    // a point of the fixture's box (u along its first edge, v along its last), as MadMapper maps its box
    const at = (u, v) => [0, 1].map(d => c[0][d] + u * (c[1][d] - c[0][d]) + v * (c[3][d] - c[0][d]) + u * v * (c[2][d] - c[3][d] - c[1][d] + c[0][d]));
    const local = [];
    let kind = 'grid', arc = 360;
    if (s.type === 'fixturecircle') {
      kind = 'circle'; arc = clamp(+s.circleArc || 360, 1, 360);
      const full = arc >= 359.99, step = full ? arc / n : (n > 1 ? arc / (n - 1) : 0);
      // the pixels on the middle of the ring's band
      const r = 0.5 * (1 - clamp(+s.circleThickness || 0, 0, 1) / 2);
      for (let k = 0; k < n; k++) { const a = k * step * Math.PI / 180; local.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]); }
    } else if (W === 1 || H === 1) {
      kind = 'line';
      for (let k = 0; k < n; k++) local.push(W >= H ? [(k + 0.5) / n, 0.5] : [0.5, (k + 0.5) / n]);
    } else for (let k = 0; k < n; k++) local.push([(k % W + 0.5) / W, (Math.floor(k / W) + 0.5) / H]);
    // the order they are wired in: by the channel each pixel starts at
    const map = String(fx.pixelMapping || '').trim().split(/\s+/).map(Number);
    const wired = map.length === n && map.every(isFinite) ? [...local.keys()].sort((a, b) => map[a] - map[b]) : [...local.keys()];
    if (map.length !== n) notes.push(`${s.name}: its channels per pixel not found, wired in order.`);
    let order = madOrder(fx.type);
    if (!order) { notes.push(`${s.name}: pixel type ${fx.type || '?'} imported as RGB.`); order = 'RGB'; }
    const step = map.length > 1 ? map[wired[1]] - map[wired[0]] : 0;
    if (step && step !== order.length) notes.push(`${s.name}: ${step} channels a pixel in MadMapper, ${order.length} for ${order}.`);
    const parent = S[rel[i]];
    fixtures.push({
      name: s.name || fx.product || 'Fixture', kind, arc, cols: W, rows: H, n, order, pts: wired.map(k => at(...local[k])),
      grid: kind === 'grid' ? { o: at(0.5 / W, 0.5 / H), x: at((W - 0.5) / W, 0.5 / H), y: at(0.5 / W, (H - 0.5) / H) } : null,
      proto: /sacn|e1\.?31/i.test(s.dmxtype || '') ? 'sacn' : 'artnet', universe: Math.max(0, s.artnetUniverse | 0), ch: clamp(s.startChannel | 0 || 1, 1, 512),
      split: fx.avoidCrossUniversePixels === false, group: parent && parent.type === 'group' ? parent.name : '',
    });
  });
  // the devices MadMapper found on each network card: one per address, the universes it listens to
  const devs = new Map(), tables = (top.projectSettings && top.projectSettings.artNetRoutingTables) || {};
  for (const rows of Object.values(tables)) for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.ip || r.active === 0) continue;
    const d = devs.get(r.ip) || { ip: r.ip, name: r.shortName || r.longName || r.ip, longName: r.longName || '', unis: new Set(), remap: new Map() };
    d.unis.add(r.universe | 0);
    if (r.remapped) d.remap.set(r.universe | 0, r.remappedUniverse | 0);
    devs.set(r.ip, d);
  }
  return { fixtures, devices: [...devs.values()], notes, unicast: !!(top.projectSettings && top.projectSettings.artNetOutputUnicast) };
}

// A file picked or dropped: its project read, then a short window saying what it holds before anything is added
async function importMadDialog(file) {
  let rig;
  try {
    let buf = await file.arrayBuffer();
    if (new DataView(buf).getUint32(0, true) === 0x04034b50) buf = await madFromZip(buf);
    rig = madRig(madDecode(buf));
  } catch (err) { toast(`${file.name}: not a MadMapper 6 project nouPix can read (${err.message}).`, 'err'); return; }
  if (!rig.fixtures.length) { toast(`${file.name}: no fixtures in it.`, 'warn'); return; }
  const kinds = { circle: 0, line: 0, grid: 0 };
  rig.fixtures.forEach(f => kinds[f.kind]++);
  const what = [kinds.circle && `${kinds.circle} ring${kinds.circle > 1 ? 's' : ''}`, kinds.line && `${kinds.line} line${kinds.line > 1 ? 's' : ''}`, kinds.grid && `${kinds.grid} matri${kinds.grid > 1 ? 'ces' : 'x'}`].filter(Boolean).join(', ');
  const px = rig.fixtures.reduce((a, f) => a + f.n, 0);
  const opt = { patch: true, flip: false };
  const D = uiDocNow(), close = () => bg.remove();
  const tick = (key, text, tip) => { const i = h('input', { type: 'checkbox', checked: opt[key], id: 'mad_' + key }); i.addEventListener('change', () => { opt[key] = i.checked; }); return h('label', { class: 'checkrow', for: 'mad_' + key, 'data-tip': tip }, i, text); };
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal madimp', role: 'dialog', 'aria-label': 'Import MadMapper' },
      h('header', null, 'Import MadMapper 6 (beta)'),
      h('div', { class: 'mb' },
        h('p', null, `${file.name}: ${rig.fixtures.length} fixtures (${what}), ${fmtN(px)} pixels.`),
        rig.devices.length ? h('div', { class: 'maddevs' }, h('p', { class: 'note' }, 'Devices MadMapper found:'),
          ...rig.devices.map(d => h('div', { class: 'mono' }, `${d.name} · ${d.ip} · U ${universeList([...d.unis].sort((a, b) => a - b))}`)))
          : h('p', { class: 'note' }, 'No devices in it: the controllers come without an address, to type in the Patch tab.'),
        tick('patch', 'Patch: a Manual controller per device, each fixture at its universe and channel', 'Patch|As MadMapper sends it. Off: only the fixtures.'),
        tick('flip', 'Flip upside down', 'Flip|If the layout comes in upside down.'),
        rig.notes.length ? h('details', { class: 'madnotes' }, h('summary', null, `${rig.notes.length} note${rig.notes.length > 1 ? 's' : ''}`), ...rig.notes.map(t => h('div', null, t))) : null),
      h('footer', null,
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); importMad(rig, opt); } }, 'Import'))));
  D.body.append(bg);
  bg.querySelector('.btn.primary').focus();
}

// The fixtures made on the stage, fitted to the canvas; the patch as Manual controllers; one step of undo
function importMad(rig, opt) {
  const all = rig.fixtures.flatMap(f => f.pts);
  const fy = opt.flip ? 1 : -1;   // MadMapper's y goes up, the stage's down
  const xs = all.map(p => p[0]), ys = all.map(p => fy * p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = project.settings.compW, H = project.settings.compH;
  const k = Math.min(W * 0.9 / Math.max(1e-9, x1 - x0), H * 0.9 / Math.max(1e-9, y1 - y0));
  const T = p => [W / 2 + (p[0] - (x0 + x1) / 2) * k, H / 2 + (fy * p[1] - (y0 + y1) / 2) * k];
  const made = [], groups = new Map();
  for (const m of rig.fixtures) {
    const P = m.pts.map(T), f = madFixture(m, P, m.grid && { o: T(m.grid.o), x: T(m.grid.x), y: T(m.grid.y) });
    f.name = m.name; f.order = m.order; f._mad = m;
    if (m.group) {
      if (!groups.has(m.group)) groups.set(m.group, { id: uid(), name: m.group, tag: '', open: true });
      f.group = groups.get(m.group).id;
    }
    made.push(f);
  }
  project.fixtures.push(...made);
  project.groups.push(...groups.values());
  normalizeGroups();
  let ctrls = [];
  if (opt.patch) ctrls = madPatch(rig, made);
  for (const f of made) delete f._mad;
  ui.sel = new Set(made.map(f => f.id));
  // the Patch tab on the controller that has the most of them
  if (ctrls.length) ui.selCtrl = ctrls.reduce((a, c) => (c.chains[0].length > a.chains[0].length ? c : a)).id;
  markGeom(); markPatch(); rebuildGeometry(); commit(); renderAll();
  if (typeof fitView === 'function') fitView();
  const adv = ctrls.some(c => c.from1);
  toast(`Imported ${made.length} fixtures from MadMapper` + (ctrls.length ? ` and ${ctrls.length} Manual controller${ctrls.length > 1 ? 's' : ''}` : '') + '.'
    + (adv ? ' Advatek universes shown from 1, as it counts them (Output settings).' : '') + ' Beta: check them against MadMapper.');
}

// One fixture: a ring, a line, a matrix (the corner it starts at and its rows as MadMapper wires them), or a dot
function madFixture(m, P, g) {
  const n = P.length, cx = P.reduce((a, p) => a + p[0], 0) / n, cy = P.reduce((a, p) => a + p[1], 0) / n;
  if (n === 1) return newFixture('dot', { cx: P[0][0], cy: P[0][1], size: 24 });
  if (m.kind === 'circle' && n >= 3) {
    const d = P.map(p => Math.hypot(p[0] - cx, p[1] - cy)), r = d.reduce((a, b) => a + b, 0) / n;
    if (m.arc >= 359.99 && d.every(x => Math.abs(x - r) < r * 0.03)) {
      const start = (Math.atan2(P[0][0] - cx, -(P[0][1] - cy)) * 180 / Math.PI + 360) % 360;
      const cross = (P[0][0] - cx) * (P[1][1] - cy) - (P[0][1] - cy) * (P[1][0] - cx);
      return newFixture('circle', { cx, cy, r, pixels: n, start, sweep: 360, ccw: cross < 0 });
    }
    return newFixture('path', { pts: P.flat(), closed: m.arc >= 359.99, pixels: n });
  }
  if (m.kind === 'line') return newFixture('line', { x1: P[0][0], y1: P[0][1], x2: P[n - 1][0], y2: P[n - 1][1], pixels: n });
  // a matrix: its frame from the grid's first row and column, then the wiring nouPix offers that lands its pixels where MadMapper has them
  const ux = g ? [g.x[0] - g.o[0], g.x[1] - g.o[1]] : [1, 0], uy = g ? [g.y[0] - g.o[0], g.y[1] - g.o[1]] : [0, 1];
  const w = Math.hypot(...ux) * m.cols / Math.max(1, m.cols - 1), hh = Math.hypot(...uy) * m.rows / Math.max(1, m.rows - 1);
  const rot = Math.atan2(ux[1], ux[0]) * 180 / Math.PI;
  let best = null;
  for (const start of ['TL', 'TR', 'BL', 'BR']) for (const dir of ['H', 'V']) for (const snake of [false, true]) {
    const f = newFixture('matrix', { cx, cy, w, h: hh, rot, cols: m.cols, rows: m.rows, start, dir, snake });
    const q = computePoints(f);
    let err = 0;
    for (let i = 0; i < n; i++) err += Math.hypot(q[2 * i] - P[i][0], q[2 * i + 1] - P[i][1]);
    if (!best || err < best.err) best = { f, err };
  }
  return best.f;
}

// The patch: a Manual controller per device MadMapper found, each fixture on the one that listens to its universes
function madPatch(rig, made) {
  const ctrls = new Map(), byIp = new Map(), names = {};
  rig.devices.forEach(d => { names[d.name] = (names[d.name] || 0) + 1; });
  const ctrlFor = (d, proto) => {
    const key = (d ? d.ip : '') + '|' + proto;
    if (ctrls.has(key)) return ctrls.get(key);
    const name = d ? (names[d.name] > 1 ? `${d.name} ${d.ip.split('.').pop()}` : d.name) : `MadMapper ${proto === 'sacn' ? 'sACN' : 'Art-Net'}`;
    const c = newController({ name, ip: d ? d.ip : '', protocol: proto, mode: 'manual', outputs: 1, startUniverse: 0, startCh: 1 });
    c.chains = [[]];
    if (d) {
      c.discovered = [...d.unis].sort((a, b) => a - b);
      const mk = typeof makerOf === 'function' ? makerOf({ shortName: d.name, longName: d.longName }) : null;
      if (mk) { c.maker = mk.id; if (mk.from1 && proto !== 'sacn') c.from1 = true; }
    }
    project.controllers.push(c); ctrls.set(key, c);
    return c;
  };
  // every device, even one no fixture uses, so its address is there
  for (const d of rig.devices) byIp.set(d.ip, ctrlFor(d, 'artnet'));
  made.forEach(f => {
    const m = f._mad, bpp = m.order.length;
    // the universes it takes, as MadMapper sends it (no pixel split between two universes unless set so)
    const per = m.split ? 512 / bpp : Math.floor(512 / bpp), inFirst = Math.floor((513 - m.ch) / bpp);
    const span = 1 + Math.ceil(Math.max(0, m.n - inFirst) / per);
    const want = Array.from({ length: span }, (_, i) => m.universe + i);
    const fits = m.proto === 'artnet' ? rig.devices.filter(d => d.unis.has(m.universe)) : [];
    fits.sort((a, b) => want.filter(u => b.unis.has(u)).length - want.filter(u => a.unis.has(u)).length || b.unis.size - a.unis.size);
    const d = fits[0] || null, c = d ? byIp.get(d.ip) : ctrlFor(null, m.proto);
    const u = d && d.remap.has(m.universe) ? d.remap.get(m.universe) : m.proto === 'sacn' ? Math.max(0, m.universe - 1) : m.universe;
    f.addr = { u, ch: m.ch };
    c.chains[0].push(f.id);
    if (m.split) c.split = true;
  });
  for (const c of ctrls.values()) ensureChains(c);
  const twice = rig.devices.length > 1 && [...new Set(rig.devices.flatMap(d => [...d.unis]))].some(u => rig.devices.filter(d => d.unis.has(u)).length > 1);
  if (twice) rig.notes.push('Some universes are listened to by more than one device: each fixture went on the one that has all of its universes.');
  return [...ctrls.values()];
}
