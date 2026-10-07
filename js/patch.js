// openLedMapper · js/patch.js
// Addressing: which universe and channels each fixture uses on its controller output (computePatch), conflicts,
// assigning fixtures to outputs. Uses util, model and geometry; computePatch ends with layoutFrame (output.js).

/* ---------- patch / addressing ---------- */
const BPP = o => o.length;
let universes = [];
let patchConflicts = [];
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
    c.chains.forEach((chain, o) => {
      const base = c.startUniverse + o * c.upo;
      const cap = c.upo * 512;
      const unis = new Array(c.upo).fill(null);
      const info = { base, pixels: 0, overflow: 0, ch: 0, fixtures: 0 };
      let lin = 0;
      const getUni = u => {
        if (unis[u]) return unis[u];
        const num = base + u;
        const key = c.ip.trim() + '|' + num;
        let U = byKey.get(key);
        if (U) { if (U.ctrl !== c || U.out !== o) patchConflicts.push(`${c.name} OUT ${o + 1} and ${U.ctrl.name} OUT ${U.out + 1} both use ${c.ip} universe ${num}`); }
        else {
          U = { key, ip: c.ip.trim(), ipb, uni: num, ctrl: c, out: o, data: new Uint8Array(512), enabled: !!(c.enabled && ipb && num <= 32767), used: 0 };
          byKey.set(key, U); universes.push(U);
        }
        unis[u] = U;
        return U;
      };
      for (const fid of chain) {
        const f = map.get(fid);
        if (!f) continue;
        const bpp = BPP(f.order), n = f._n;
        const L = new Int32Array(n).fill(-1);
        let first = -1, last = -1, ovf = 0, manual = false, overlap = false, outside = false;
        // advanced patch: this fixture starts at a set universe and channel of its output; the ones after it follow on
        if (f.addr) {
          const u = f.addr.u - base;
          if (u >= 0 && u < c.upo) { const at = u * 512 + f.addr.ch - 1; manual = true; overlap = at < lin; lin = at; }
          else outside = true;
        }
        if (overlap) patchConflicts.push(`${f.name} is set to start at U ${f.addr.u} ch ${f.addr.ch}, on channels the fixture before it on ${c.name} OUT ${o + 1} already uses`);
        for (let i = 0; i < n; i++) {
          if (!c.split) { const w = lin % 512; if (w + bpp > 512) lin += 512 - w; }
          const end = lin + bpp;
          if (end > cap) { ovf++; lin = end; continue; }
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
  return `U ${a.u} · ch ${a.ch}  →  U ${b.u} · ch ${b.ch}`;
}
// A pixel's address, as U 1 ch 4–6, or '' when it isn't patched
function pixelAddrText(f, i) {
  const p = f._patch;
  if (!(p && f._out && f._out.lin[i] >= 0)) return '';
  const a = addrOf(p.base, f._out.lin[i]);
  return `U ${a.u} ch ${a.ch}–${a.ch + f.order.length - 1}`;
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
function simulateChannels(c, chain, extra) {
  let lin = 0;
  for (const f of [...chain.map(fxById).filter(Boolean), extra]) {
    if (!f) continue;
    const bpp = BPP(f.order);
    for (let i = 0; i < f._n; i++) { if (!c.split) { const w = lin % 512; if (w + bpp > 512) lin += 512 - w; } lin += bpp; }
  }
  return lin;
}
