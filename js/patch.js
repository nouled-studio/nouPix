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
const isSacn = c => !!c && c.protocol === 'sacn';
const sacnMulticast = c => isSacn(c) && project.settings.sacnMulticast;
const usesSacn = () => project.controllers.some(isSacn);
const usesArtnet = () => !project.controllers.length || project.controllers.some(c => !isSacn(c));
// What the project sends, in words: Art-Net, sACN, or both
const outName = () => (usesSacn() ? (usesArtnet() ? 'Art-Net and sACN' : 'sACN') : 'Art-Net');
const protoName = c => (isSacn(c) ? 'sACN' : 'Art-Net');
const uniLabel = (u, c) => u + (isSacn(c) ? 1 : 0);
// Where each output of a controller is: its first universe, how many universes it has, the channel it starts at (counted
// from its first universe) and, in Pixels mode, how many pixels it takes. The first output starts at the controller's
// start universe and start channel; each next one on the universe after the one before it ends, at channel 1. In
// Pixels mode an output has the universes its pixels need; in Universes mode, a set number.
function ctrlOuts(c) {
  const out = [];
  let base = c.startUniverse;
  for (let o = 0; o < c.outputs; o++) {
    const start = o === 0 ? c.startCh - 1 : 0;
    let upo = c.upo, px = 0;
    if (c.mode === 'pixels') {
      px = c.pxOut;
      if (c.split) upo = Math.ceil((start + px * c.chPx) / 512);
      else {   // whole pixels in each universe
        const per = Math.max(1, Math.floor(512 / c.chPx)), first = Math.max(0, Math.floor((512 - start) / c.chPx));
        upo = 1 + Math.ceil(Math.max(0, px - first) / per);
      }
      upo = clamp(upo, 1, 1024);
    }
    out.push({ base, upo, start, px });
    base += upo;
  }
  return out;
}
// The multicast group of an sACN universe (as the bridge sends to it): 239.255, then the universe's two bytes
const sacnGroup = u => `239.255.${u >> 8}.${u & 255}`;
let patchVersion = 0;
function computePatch() {
  if (geomDirty) rebuildGeometry();
  universes = []; patchConflicts = [];
  const byKey = new Map();
  for (const f of project.fixtures) { f._out = null; f._patch = null; }
  const map = new Map(project.fixtures.map(f => [f.id, f]));
  for (const c of project.controllers) {
    ensureChains(c);
    const ipb = parseIP(c.ip);
    c._outs = [];
    const sacn = isSacn(c), mcast = sacnMulticast(c), layout = ctrlOuts(c);
    c.chains.forEach((chain, o) => {
      const { base, upo, start, px } = layout[o];
      const cap = upo * 512;
      const unis = new Array(upo).fill(null);
      const info = { base, upo, start, px, pixels: 0, overflow: 0, ch: 0, fixtures: 0 };
      let lin = start, pxUsed = 0;
      const getUni = u => {
        if (unis[u]) return unis[u];
        const num = base + u;
        // a universe is Art-Net's or sACN's at an address; with sACN to multicast groups it is the same one for every
        // controller on sACN, and can be used once
        const key = (sacn ? 's|' : 'a|') + (mcast ? '*' : c.ip.trim()) + '|' + num;
        let U = byKey.get(key);
        if (U) { if (U.ctrl !== c || U.out !== o) patchConflicts.push(`${c.name} OUT ${o + 1} and ${U.ctrl.name} OUT ${U.out + 1} both use ${mcast ? 'sACN' : c.ip} universe ${uniLabel(num, c)}`); }
        else {
          U = { key, ip: c.ip.trim(), ipb, uni: num, ctrl: c, out: o, sacn, mcast, data: new Uint8Array(512), enabled: !!(c.enabled && ipb && num <= 32767), used: 0 };
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
        if (f.addr) {
          const u = f.addr.u - base;
          if (u >= 0 && u < upo) { const at = u * 512 + f.addr.ch - 1; manual = true; overlap = at < lin; lin = at; }
          else outside = true;
        }
        if (overlap) patchConflicts.push(`${f.name} is set to start at U ${uniLabel(f.addr.u, c)} ch ${f.addr.ch}, on channels the fixture before it on ${c.name} OUT ${o + 1} already uses`);
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
          lin = end;
        }
        const oi = [];
        for (const ch of f.order) oi.push(ch === 'R' ? 0 : ch === 'G' ? 1 : ch === 'B' ? 2 : f.order.length === 1 ? 4 : 3);
        f._out = { unis, lin: L, oi };
        f._patch = { ctrl: c, out: o, pos: info.fixtures, first, last, base, overflow: ovf, manual, overlap, outside };
        info.fixtures++; info.pixels += n - ovf; info.overflow += ovf;
      }
      info.ch = Math.min(lin, cap);
      c._outs[o] = info;
    });
  }
  universes.sort((a, b) => a.ip === b.ip ? a.uni - b.uni : a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  layoutFrame();
  patchDirty = false;
  patchVersion++;
}
// The patch is worked out again when something changed it; the list and panels then show the new addresses
function ensurePatch() { if (patchDirty) { computePatch(); onPatchChanged(); } }
const addrOf = (base, lin) => ({ u: base + (lin >> 9), ch: (lin & 511) + 1 });
function addrText(p) {
  if (!p || p.first < 0) return '';
  const a = addrOf(p.base, p.first), b = addrOf(p.base, p.last);
  return `U ${uniLabel(a.u, p.ctrl)} · ch ${a.ch}  →  U ${uniLabel(b.u, p.ctrl)} · ch ${b.ch}`;
}
// A pixel's address, as U 1 ch 4–6, or '' when it isn't patched
function pixelAddrText(f, i) {
  const p = f._patch;
  if (!(p && f._out && f._out.lin[i] >= 0)) return '';
  const a = addrOf(p.base, f._out.lin[i]);
  return `U ${uniLabel(a.u, p.ctrl)} ch ${a.ch}–${a.ch + BPP(f) - 1}`;
}
// The output a patch is on, as shown on the badges: 1, 2… or A1, B2… with more than one controller
function outLabel(p) { return (project.controllers.length > 1 ? ctrlLetter(p.ctrl) : '') + (p.out + 1); }
function unassign(fid) {
  for (const c of project.controllers) for (const ch of c.chains) { const i = ch.indexOf(fid); if (i >= 0) ch.splice(i, 1); }
}
function assign(fid, ctrl, out, index = -1) {
  const chain = ctrl.chains[out];
  const cur = chain.indexOf(fid), f = fxById(fid);
  if (cur < 0 && f) delete f.addr;   // a start address set by hand belongs to the output it was set on
  unassign(fid);
  if (index < 0 || index > chain.length) index = chain.length;
  else if (cur >= 0 && cur < index) index--;
  chain.splice(index, 0, fid);
  markPatch();
}
// channels an output would use with an extra fixture appended (for auto-patch)
// Whether fixtures (a chain, and one more) fit on a controller's output: in its universes, from its start channel,
// and in Pixels mode within its pixels
function fitsOn(c, o, chain, extra) {
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
// An output's universes as shown: U 1, or U 1–4 (sACN's one higher)
const uniRange = (c, L) => (L.upo > 1 ? `U ${uniLabel(L.base, c)}–${uniLabel(L.base + L.upo - 1, c)}` : `U ${uniLabel(L.base, c)}`);
