// nouPix · js/patch.js
// Addressing: which universe and channels each fixture uses on its controller output (computePatch), conflicts,
// assigning fixtures to outputs. Uses util, model and geometry; computePatch ends with layoutFrame (output.js).

/* ---------- patch / addressing ---------- */
// Channels per pixel: one per colour, two (coarse, then fine) on a 16-bit fixture
const BPP = f => f.order.length * (f.bits === 16 ? 2 : 1);
let universes = [];
let patchConflicts = [];
// What goes out, per controller: Art-Net, or sACN (E1.31). The universes are counted from 0 inside, as Art-Net counts
// them; sACN counts from 1, so a controller on sACN shows (and the bridge sends) every universe one higher: 0 is sACN
// universe 1. sACN to multicast groups, and its priority, are the project's, for every controller on sACN.
// DDP has no universes: a controller takes one run of channels (bytes) from 0. Inside it is kept as universes of 512
// from 0, as the others are, with no channels skipped, so a channel's place in that run is its universe × 512 + its
// channel; the bridge sends the run in DDP packets.
const isSacn = c => !!c && c.protocol === 'sacn';
const isDdp = c => !!c && c.protocol === 'ddp';
const sacnMulticast = c => isSacn(c) && project.settings.sacnMulticast;
const usesSacn = () => project.controllers.some(isSacn);
const usesDdp = () => project.controllers.some(isDdp);
const usesArtnet = () => !project.controllers.length || project.controllers.some(c => !isSacn(c) && !isDdp(c));
// What the project sends, in words: Art-Net, sACN, DDP, or several
const outName = () => [usesArtnet() && 'Art-Net', usesSacn() && 'sACN', usesDdp() && 'DDP'].filter(Boolean).join(' and ').replace(/ and (?=.* and )/, ', ');
const protoName = c => (isSacn(c) ? 'sACN' : isDdp(c) ? 'DDP' : 'Art-Net');
// How many a universe is shown higher than it is inside: sACN counts from 1, and some devices show Art-Net's 0 as 1
const uniOff = c => (isSacn(c) || (!!c && !!c.from1 && !isDdp(c)) ? 1 : 0);
const uniLabel = (u, c) => u + uniOff(c);
// An address as shown: U 1 · ch 4, or on DDP the channel in the controller's run, ch 516
const chLabel = (a, c, sep = ' · ') => (isDdp(c) ? 'ch ' + (a.u * 512 + a.ch) : `U ${uniLabel(a.u, c)}${sep}ch ${a.ch}`);
// Where each output of a controller is: its first universe, how many universes it has, the channel it starts at (counted
// from its first universe) and, in Pixels mode, how many pixels it takes; list: its universes when they were typed one
// by one (then not one after another). The first output starts at the controller's start universe and start channel.
// Universes mode: each output a number of universes (the same for all, or its own), after the one before, from its
// first universe typed, or every universe typed. Pixels mode: each output the universes its pixels need, on from the
// channel where the one before ends, on a new universe, or from a universe and channel typed. Manual: no outputs, one
// run over every universe from 0, where each fixture has its own address.
const MANUAL_UNIS = 32768;
const upoOf = (c, o) => (c.same === false && c.upos && c.upos[o] ? c.upos[o] : c.upo);
const pxOutOf = (c, o) => (c.same === false && c.pxOuts && c.pxOuts[o] ? c.pxOuts[o] : c.pxOut);
// The channels px pixels of w channels take from channel s of a universe (whole pixels in each universe, unless split):
// where they end, one past the last, counted from that universe's channel 1
function pixelRun(s, px, w, split) {
  if (split) return s + px * w;
  const per = Math.max(1, Math.floor(512 / w)), first = Math.floor((512 - s) / w);
  if (px <= first) return s + px * w;
  const rem = px - first, full = Math.floor(rem / per), r = rem % per;
  return r ? (1 + full) * 512 + r * w : full * 512 + per * w;
}
function ctrlOuts(c) {
  const out = [];
  if (c.mode === 'manual') return [{ base: 0, upo: MANUAL_UNIS, start: 0, end: MANUAL_UNIS * 512, px: 0, manual: true }];
  if (c.mode === 'pixels') {
    const place = c.pxPlace || 'channel', w = c.chPx;
    let abs = c.startUniverse * 512 + c.startCh - 1;   // channels from universe 0's first
    for (let o = 0; o < c.outputs; o++) {
      const px = pxOutOf(c, o), at = place === 'typed' && c.outAt && c.outAt[o];
      if (at) abs = at.u * 512 + at.ch - 1;
      else if (place === 'universe' && o > 0 && abs % 512) abs += 512 - abs % 512;
      let s = abs % 512;
      if (!c.split && s + w > 512) { abs += 512 - s; s = 0; }   // whole pixels: the first one on the next universe
      const end = pixelRun(s, px, w, c.split);
      const base = Math.floor(abs / 512), upo = clamp(Math.ceil(end / 512), 1, 1024);
      // end: where its channels end (one past the last), counted from its first universe's channel 1
      out.push({ base, upo, start: s, end, px });
      abs = base * 512 + end;
    }
    return out;
  }
  const place = c.uniPlace || 'order';
  let base = c.startUniverse;
  for (let o = 0; o < c.outputs; o++) {
    const n = upoOf(c, o), start = o === 0 ? c.startCh - 1 : 0;
    const list = place === 'each' && c.outUnis && c.outUnis[o] && c.outUnis[o].length ? c.outUnis[o] : null;
    if (list) {
      const L = { base: list[0], upo: list.length, start, end: list.length * 512, px: 0 };
      // one after another from the first: as any other output; else the universes as typed
      if (list.some((u, i) => u !== list[0] + i)) L.list = list;
      out.push(L);
      base = Math.max(...list) + 1;
      continue;
    }
    const b = place === 'start' && c.outStarts && Number.isInteger(c.outStarts[o]) ? c.outStarts[o] : base;
    out.push({ base: b, upo: n, start, end: n * 512, px: 0 });
    base = b + n;
  }
  return out;
}
// The universe of an output's k-th universe
const uniAt = (L, k) => (L.list ? L.list[k] : L.base + k);
// The multicast group of an sACN universe (as the bridge sends to it): 239.255, then the universe's two bytes
const sacnGroup = u => `239.255.${u >> 8}.${u & 255}`;
let patchVersion = 0;
// Two fixtures on the same channels of a device: said once per pair, and both marked
function clash(f, g, U, j) {
  const key = f.id < g.id ? f.id + '|' + g.id : g.id + '|' + f.id;
  if (clashSeen.has(key)) return;
  clashSeen.add(key);
  f._clash = g; g._clash = f;
  patchConflicts.push(`${f.name} and ${g.name} share channels on ${U.ctrl.name}, from ${chLabel({ u: U.uni, ch: j + 1 }, U.ctrl, ' ')}`);
}
let clashSeen = new Set();
function computePatch() {
  if (geomDirty) rebuildGeometry();
  universes = []; patchConflicts = []; clashSeen = new Set();
  const byKey = new Map();
  for (const f of project.fixtures) { f._out = null; f._patch = null; f._clash = null; }
  const map = new Map(project.fixtures.map(f => [f.id, f]));
  for (const c of project.controllers) {
    ensureChains(c);
    const ipb = parseIP(c.ip);
    c._outs = [];
    const sacn = isSacn(c), ddp = isDdp(c), mcast = sacnMulticast(c), layout = ctrlOuts(c);
    c.chains.forEach((chain, o) => {
      const L = layout[o], { base, upo, start, end, px } = L, manualMode = !!L.manual;
      const cap = upo * 512;
      const unis = manualMode ? [] : new Array(upo).fill(null);
      const info = { base, upo, start, end, px, list: L.list, manual: manualMode, pixels: 0, overflow: 0, ch: 0, fixtures: 0 };
      let lin = start, pxUsed = 0;
      const getUni = u => {
        if (unis[u]) return unis[u];
        const num = uniAt(L, u);
        // a universe is Art-Net's or sACN's at an address; with sACN to multicast groups it is the same one for every
        // controller on sACN, and can be used once
        const key = (sacn ? 's|' : ddp ? 'd|' : 'a|') + (mcast ? '*' : c.ip.trim()) + '|' + num;
        let U = byKey.get(key);
        // (in Pixels mode, one output goes on in the universe where the one before it ends)
        if (U) { if (U.ctrl !== c || (U.out !== o && c.mode === 'universes')) patchConflicts.push(ddp ? `${c.name} and ${U.ctrl.name} both send DDP to ${c.ip}` : `${c.name} OUT ${o + 1} and ${U.ctrl.name} OUT ${U.out + 1} both use ${mcast ? 'sACN' : c.ip} universe ${uniLabel(num, c)}`); }
        else {
          // (DDP only to a bridge that sends it: an older one would read the frame wrong)
          U = { key, ip: c.ip.trim(), ipb, uni: num, ctrl: c, out: o, sacn, ddp, rgbw: ddp && c.chPx % 4 === 0, mcast, data: new Uint8Array(512),
            enabled: !!(c.enabled && ipb && num <= 32767 && (!ddp || bridgeDdp())), used: 0 };
          byKey.set(key, U); universes.push(U);
        }
        unis[u] = U;
        return U;
      };
      for (const fid of chain) {
        const f = map.get(fid);
        if (!f) continue;
        const bpp = BPP(f), n = f._n;
        const L = new Int32Array(n).fill(-1);
        let first = -1, last = -1, ovf = 0, manual = false, overlap = false, outside = false;
        // advanced patch: this fixture starts at a set universe and channel of its output; the ones after it follow on
        if (f.addr && manualMode) { lin = f.addr.u * 512 + f.addr.ch - 1; manual = true; }
        else if (f.addr) {
          const u = L.list ? L.list.indexOf(f.addr.u) : f.addr.u - base;
          if (u >= 0 && u < upo) { const at = u * 512 + f.addr.ch - 1; manual = true; overlap = at < lin; lin = at; }
          else outside = true;
        }
        if (overlap) patchConflicts.push(`${f.name} is set to start at ${chLabel(f.addr, c, ' ')}, on channels the fixture before it on ${c.name} OUT ${o + 1} already uses`);
        for (let i = 0; i < n; i++) {
          if (!c.split) { const w = lin % 512; if (w + bpp > 512) lin += 512 - w; }
          const end = lin + bpp;
          // past the output's universes, or (Pixels mode) past its pixels: overflow
          if (end > cap || (px && pxUsed >= px)) { ovf++; lin = end; continue; }
          pxUsed++;
          L[i] = lin;
          if (first < 0) first = lin;
          last = end - 1;
          for (let u = lin >> 9; u <= (end - 1) >> 9; u++) { const U = getUni(u); U.used = Math.max(U.used, Math.min(512, end - u * 512)); }
          // where fixtures are placed by address (Manual, Pixels with starts typed), two can land on the same channels
          if (c.mode !== 'universes') for (let k = lin; k < end; k++) {
            const U = unis[k >> 9], j = k & 511, owner = (U.owners || (U.owners = []))[j];
            if (owner && owner !== f) clash(f, owner, U, j); else U.owners[j] = f;
          }
          lin = end;
        }
        const oi = [];
        for (const ch of f.order) oi.push(ch === 'R' ? 0 : ch === 'G' ? 1 : ch === 'B' ? 2 : f.order.length === 1 ? 4 : 3);
        f._out = { unis, lin: L, oi };
        f._patch = { ctrl: c, out: o, pos: info.fixtures, first, last, base, list: L.list, overflow: ovf, manual, overlap, outside };
        info.fixtures++; info.pixels += n - ovf; info.overflow += ovf;
      }
      info.ch = Math.min(lin, cap);
      c._outs[o] = info;
    });
  }
  for (const U of universes) delete U.owners;
  universes.sort((a, b) => a.ip === b.ip ? a.uni - b.uni : a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  layoutFrame();
  patchDirty = false;
  patchVersion++;
}
// The patch is worked out again when something changed it; the list and panels then show the new addresses
function ensurePatch() { if (patchDirty) { computePatch(); onPatchChanged(); } }
// A channel of an output as a universe and channel: base, or the output's (or patch's) layout with its typed list
const addrOf = (base, lin) => (typeof base === 'object' && base
  ? { u: base.list ? base.list[lin >> 9] : base.base + (lin >> 9), ch: (lin & 511) + 1 }
  : { u: base + (lin >> 9), ch: (lin & 511) + 1 });
function addrText(p) {
  if (!p || p.first < 0) return '';
  const a = addrOf(p, p.first), b = addrOf(p, p.last);
  return `${chLabel(a, p.ctrl)}  →  ${chLabel(b, p.ctrl)}`;
}
// A pixel's address, as U 1 ch 4–6, or '' when it isn't patched
function pixelAddrText(f, i) {
  const p = f._patch;
  if (!(p && f._out && f._out.lin[i] >= 0)) return '';
  const a = addrOf(p, f._out.lin[i]);
  return isDdp(p.ctrl) ? `ch ${a.u * 512 + a.ch}–${a.u * 512 + a.ch + BPP(f) - 1}` : `U ${uniLabel(a.u, p.ctrl)} ch ${a.ch}–${a.ch + BPP(f) - 1}`;
}
// The output a patch is on, as shown on the badges: 1, 2… or A1, B2… with more than one controller; on a manual
// controller its address instead, U 3.010
function outLabel(p) {
  const who = project.controllers.length > 1 ? ctrlLetter(p.ctrl) : '';
  if (p.ctrl.mode === 'manual') {
    if (p.first < 0) return who + ' —';
    const a = addrOf(p, p.first);
    return (who ? who + ' ' : '') + (isDdp(p.ctrl) ? 'ch ' + (a.u * 512 + a.ch) : `U${uniLabel(a.u, p.ctrl)}.${String(a.ch).padStart(3, '0')}`);
  }
  return who + (p.out + 1);
}
function unassign(fid) {
  for (const c of project.controllers) for (const ch of c.chains) { const i = ch.indexOf(fid); if (i >= 0) ch.splice(i, 1); }
}
function assign(fid, ctrl, out, index = -1) {
  if (ctrl.mode === 'manual') out = 0;
  const chain = ctrl.chains[out];
  const cur = chain.indexOf(fid), f = fxById(fid);
  if (cur < 0 && f) delete f.addr;   // a start address set by hand belongs to the output it was set on
  // on a manual controller each fixture has an address: one coming from elsewhere takes the next free one
  if (cur < 0 && f && ctrl.mode === 'manual') f.addr = manualNextFree(ctrl, f);
  unassign(fid);
  if (index < 0 || index > chain.length) index = chain.length;
  else if (cur >= 0 && cur < index) index--;
  chain.splice(index, 0, fid);
  markPatch();
}
// The next free address on a manual controller for a fixture: after the last channel its fixtures use, on a new
// universe when the fixture would not fit in what is left of that one (or a whole pixel would not)
function manualNextFree(c, f) {
  let lin = 0, top = -1;
  for (const id of c.chains[0] || []) {
    const g = fxById(id);
    if (!g || g === f) continue;
    if (g.addr) lin = g.addr.u * 512 + g.addr.ch - 1;
    const s = lin % 512, end = Math.floor(lin / 512) * 512 + pixelRun(s, g._n || pixelCount(g), BPP(g), c.split);
    top = Math.max(top, end); lin = end;
  }
  if (top < 0) return { u: c.startUniverse, ch: 1 };
  const w = BPP(f), need = (f._n || pixelCount(f)) * w, s = top % 512;
  let at = top;
  if (s && (s + w > 512 || (need <= 512 && s + need > 512))) at += 512 - s;
  return { u: Math.floor(at / 512), ch: at % 512 + 1 };
}
// channels an output would use with an extra fixture appended (for Patch to)
// Whether fixtures (a chain, and one more) fit on a controller's output: in its universes, from its start channel,
// and in Pixels mode within its pixels
function fitsOn(c, o, chain, extra) {
  if (c.mode === 'manual') return true;
  const L = ctrlOuts(c)[o];
  let lin = L.start, n = 0;
  for (const f of [...chain.map(fxById).filter(Boolean), extra]) {
    if (!f) continue;
    const bpp = BPP(f);
    n += f._n;
    for (let i = 0; i < f._n; i++) { if (!c.split) { const w = lin % 512; if (w + bpp > 512) lin += 512 - w; } lin += bpp; }
  }
  return lin <= L.upo * 512 && (!L.px || n <= L.px);
}
// An output's universes as shown: U 1, or U 1–4 (sACN's one higher); on DDP its channels, ch 1–900
const uniRange = (c, L) => (L.manual ? 'its own addresses' : isDdp(c) ? `ch ${L.base * 512 + L.start + 1}–${L.base * 512 + Math.max(L.start + 1, L.end)}`
  : L.list ? 'U ' + L.list.map(u => uniLabel(u, c)).join(', ')
  : L.upo > 1 ? `U ${uniLabel(L.base, c)}–${uniLabel(L.base + L.upo - 1, c)}` : `U ${uniLabel(L.base, c)}`);
