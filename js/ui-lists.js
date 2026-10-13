// openLedMapper · js/ui-lists.js
// The left column: the fixture list (groups, badges, drag and drop) and the source list with its categories.

/* ---------- fixture list ---------- */
function patchBadge(f) {
  const p = f._patch;
  if (!p) return h('span', { class: 'badge warn', title: 'Not patched to a controller output' }, '—');
  const lbl = outLabel(p);
  const title = `${p.ctrl.name} · OUT ${p.out + 1}${p.first >= 0 ? ' · ' + addrText(p) : ''}`;
  if (p.overflow) return h('span', { class: 'badge err', title: title + ` · ${p.overflow} pixels do not fit` }, lbl + '!');
  if (p.overlap || p.outside) return h('span', { class: 'badge warn', title: title + (p.overlap ? ' · its set start address overlaps the fixture before it' : ' · its set start address is outside this output, so it is not used') }, 'OUT ' + lbl + '!');
  return h('span', { class: 'badge', title }, 'OUT ' + lbl);
}
// The outputs a group's fixtures are patched to, in one badge
function groupBadge(m) {
  const outs = [...new Set(m.filter(f => f._patch).map(f => outLabel(f._patch)))];
  const un = m.filter(f => !f._patch).length, ovf = m.some(f => f._patch && f._patch.overflow);
  if (!outs.length) return h('span', { class: 'badge warn', title: 'Not patched to a controller output' }, '—');
  const title = `OUT ${outs.join(', ')}` + (un ? ` · ${un} not patched` : '') + (ovf ? ' · some pixels do not fit' : '');
  return h('span', { class: 'badge' + (ovf ? ' err' : un ? ' warn' : ''), title }, 'OUT ' + (outs.length > 2 ? outs[0] + '…' + outs[outs.length - 1] : outs.join('+')));
}
function groupRow(g, m, whole) {
  const px = m.reduce((a, f) => a + pixelCount(f), 0);
  const chev = h('button', { class: 'chev', type: 'button', title: g.open ? 'Fold' : 'Unfold', 'aria-label': (g.open ? 'Fold ' : 'Unfold ') + groupName(g), 'aria-expanded': String(g.open), onclick: e => { e.stopPropagation(); g.open = !g.open; renderFxList(); saveSoon(); } }, icon('chev'));
  const li = h('li', { class: 'grp' + (whole ? ' sel' : '') + (g.open ? '' : ' shut'), draggable: true, 'data-group': g.id,
    title: `${groupName(g)} · group of ${m.length} · ${fmtN(px)} px\nClick to select all of it. Drag it to move it, or onto a patch output. Drop fixtures on it to add them.` },
    chev, h('span', { class: 'ty' }, icon('group')),
    h('span', { class: 'nm' }, groupName(g), h('span', { class: 'cnt' }, m.length), m.every(f => f.locked) ? h('span', { class: 'muted glock', title: 'Locked' }, icon('lock')) : null),
    h('span', { class: 'meta' }, fmtN(px) + 'px'), groupBadge(m));
  li.style.setProperty('--gtag', g.tag);
  li.addEventListener('click', e => {
    const ids = m.map(f => f.id);
    if (e.metaKey || e.ctrlKey || e.shiftKey) { if (whole) ids.forEach(id => ui.sel.delete(id)); else ids.forEach(id => ui.sel.add(id)); }
    else ui.sel = new Set(ids);
    onSelection();
  });
  li.addEventListener('dblclick', e => { if (e.target.closest('.chev')) return; focusName('grpName'); });
  onRightClick(li, e => groupMenu(e, g, m));
  li.addEventListener('mouseenter', () => { ui.hoverGroup = g.id; });
  li.addEventListener('mouseleave', () => { if (ui.hoverGroup === g.id) ui.hoverGroup = null; });
  listDraggable(li, () => membersOf(g).map(f => f.id), g.id);
  return li;
}
function renderFxList() {
  const ul = $('#fxList');
  if (!project.fixtures.length) {
    ul.replaceChildren(emptyRow('No fixtures yet. Pick a tool on the stage (L, M, C, P) and drag, or import an SVG.'));
    return;
  }
  const groups = new Map(project.groups.map(g => [g.id, { g, m: [], whole: false }]));
  for (const f of project.fixtures) { const x = f.group != null && groups.get(f.group); if (x) x.m.push(f); }
  for (const x of groups.values()) x.whole = x.m.length > 0 && x.m.every(f => ui.sel.has(f.id));
  const rows = [], F = project.fixtures;
  F.forEach((f, i) => {
    const x = f.group != null ? groups.get(f.group) : null;
    if (x && (i === 0 || F[i - 1].group !== f.group)) rows.push(groupRow(x.g, x.m, x.whole));
    if (x && !x.g.open) return;
    const li = fixtureRow(f);
    if (x) {
      li.classList.add('in'); li.style.setProperty('--gtag', x.g.tag);
      if (!F[i + 1] || F[i + 1].group !== f.group) li.classList.add('end');
      if (x.whole) { li.classList.remove('sel'); li.classList.add('insel'); }   // the group is selected: its header shows it
    }
    rows.push(li);
  });
  ul.replaceChildren(...rows);
  updateGroupButton();
  updateLockButton();
}
function updateGroupButton() {
  const b = $('#btnGroup'), a = groupAction();
  b.replaceChildren(icon(a === 'ungroup' ? 'ungroup' : 'groupAdd'));
  b.disabled = !a; b.classList.toggle('ready', !!a);
  b.title = a === 'ungroup' ? 'Ungroup: keep the fixtures, remove the group (Ctrl Shift G)' : a === 'group' ? 'Group the selected fixtures (Ctrl G)' : 'Group: select two or more fixtures (Ctrl G)';
  b.setAttribute('aria-label', a === 'ungroup' ? 'Ungroup' : 'Group');
}
function updateLockButton() {
  const b = $('#btnLock'), a = lockAction(), g = wholeGroup();
  const what = g ? 'the group' : 'the selected fixtures';
  b.replaceChildren(icon(a === 'unlock' ? 'lock' : 'unlock'));
  b.disabled = !a; b.classList.toggle('locked', a === 'unlock');
  b.title = a === 'unlock' ? `Locked. Click to unlock ${what} (${MOD}L)` : a === 'lock' ? `Lock ${what} so ${g ? 'it' : 'they'} can't be moved or deleted (${MOD}L)` : `Lock: select fixtures or a group first (${MOD}L)`;
  b.setAttribute('aria-label', a === 'unlock' ? 'Unlock' : 'Lock');
  b.setAttribute('aria-pressed', String(a === 'unlock'));
}
function fixtureRow(f) {
  const li = h('li', { class: (ui.sel.has(f.id) ? 'sel ' : '') + (f.enabled ? '' : 'off'), draggable: true, 'data-id': f.id, title: `${f.name} · ${TYPE_LABEL[f.type]} · ${pixelCount(f)} px · ${f.order}\nDrag to change the order, into or out of a group, or onto a patch output` },
    h('span', { class: 'tag', style: { background: f.tag } }),
    h('span', { class: 'ty' }, icon(f.type)),
    h('span', { class: 'nm' }, f.name, f.locked ? h('span', { class: 'muted', style: { marginLeft: '6px' } }, icon('lock')) : null),
    h('span', { class: 'meta' }, pixelCount(f) + 'px'),
    patchBadge(f));
  const lk = li.querySelector('.nm svg'); if (lk) { lk.style.width = '10px'; lk.style.height = '10px'; }
  li.addEventListener('click', e => {
    if (e.shiftKey && ui.lastClicked) {
      const ids = project.fixtures.map(x => x.id), a = ids.indexOf(ui.lastClicked), b = ids.indexOf(f.id);
      if (a >= 0) { ui.sel = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); onSelection(); return; }
    }
    if (e.metaKey || e.ctrlKey) { ui.sel.has(f.id) ? ui.sel.delete(f.id) : ui.sel.add(f.id); }
    else ui.sel = new Set([f.id]);
    ui.lastClicked = f.id;
    onSelection();
  });
  li.addEventListener('dblclick', () => focusName('fxName'));
  onRightClick(li, e => fixtureMenu(e, f, [f.id]));
  li.addEventListener('mouseenter', () => { ui.hoverFx = f.id; });
  li.addEventListener('mouseleave', () => { if (ui.hoverFx === f.id) ui.hoverFx = null; });
  // the selection moves together; but with its whole group selected, a fixture's row takes just that fixture (out of the group)
  listDraggable(li, () => {
    if (!ui.sel.has(f.id) || ui.sel.size < 2) return [f.id];
    const g = wholeGroup();
    if (g && f.group === g.id) return [f.id];
    return project.fixtures.filter(x => ui.sel.has(x.id)).map(x => x.id);
  }, null);
  return li;
}

/* ---------- dragging in the fixture list ---------- */
// A fixture dropped between the fixtures of a group joins that group there; dropped on a group's name, it joins it
// at the end; dropped anywhere else, or below the list, it is in no group. A group dragged by its name moves as a
// whole, before or after what it is dropped on, never into another group.
let listDrag = null, dropShown = [];   // what is being dragged ({ ids, gid }), and the rows showing where it lands
function listDraggable(li, ids, gid) {
  li.addEventListener('pointerdown', e => { li.draggable = !mappingLocked() && !e.target.closest('input, button, select, .chev'); });
  li.addEventListener('dragstart', e => {
    const list = ids();
    listDrag = { ids: list, gid };
    e.dataTransfer.setData('text/plain', 'fx:' + list.join(','));   // onto a patch output
    e.dataTransfer.setData(dragType('fixtures'), list.join(','));
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => { listDrag = null; li.classList.remove('dragging'); showListDrop(null); });
}
function listDropAt(e) {
  const li = e.target.closest('#fxList > li');
  if (!li || li.classList.contains('empty')) return { where: 'end' };
  const r = li.getBoundingClientRect(), low = e.clientY > r.top + r.height / 2;
  if (li.dataset.group) {
    const g = groupById(li.dataset.group);
    if (!g) return null;
    if (listDrag.gid) return listDrag.gid === g.id ? null : { where: low ? 'afterGroup' : 'beforeGroup', g };
    return { where: low ? 'into' : 'beforeGroup', g };
  }
  const f = fxById(li.dataset.id);
  if (!f || listDrag.ids.includes(f.id)) return null;
  const g = f.group != null ? groupById(f.group) : null;
  if (listDrag.gid && g) return g.id === listDrag.gid ? null : { where: 'afterGroup', g };
  return { where: low ? 'after' : 'before', f };
}
function showListDrop(t) {
  for (const [el, c] of dropShown) el.classList.remove(c);
  dropShown = [];
  if (!t) return;
  const ul = $('#fxList'), mark = (el, c) => { if (el) { el.classList.add(c); dropShown.push([el, c]); } };
  const head = g => ul.querySelector(`li[data-group="${CSS.escape(g.id)}"]`);
  if (t.where === 'end') mark(ul, 'drop-end');
  else if (t.where === 'into') mark(head(t.g), 'drop-into');
  else if (t.where === 'beforeGroup') mark(head(t.g), 'drop-before');
  else if (t.where === 'afterGroup') { let last = head(t.g); while (last && last.nextElementSibling && last.nextElementSibling.classList.contains('in')) last = last.nextElementSibling; mark(last, 'drop-after'); }
  else mark(ul.querySelector(`li[data-id="${CSS.escape(t.f.id)}"]`), (t.where === 'before' ? 'drop-before' : 'drop-after') + (t.f.group != null ? '-in' : ''));
}
function initFxListDrop() {
  const area = $('#fxList').parentElement;   // the list and the empty space under it
  area.addEventListener('dragover', e => {
    if (!listDrag || !e.dataTransfer.types.includes(dragType('fixtures'))) return;
    const t = listDropAt(e);
    showListDrop(t);
    if (t) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  area.addEventListener('dragleave', e => { if (!area.contains(e.relatedTarget)) showListDrop(null); });
  area.addEventListener('drop', e => {
    const d = listDrag, t = d && listDropAt(e);
    showListDrop(null);
    if (!t) return;
    e.preventDefault();
    if (d.gid) moveGroupTo(d.gid, t); else moveFixturesTo(d.ids, t);
  });
}
// Where a drop lands in the list without the fixtures being moved (rest)
function dropIndex(rest, t, moving) {
  const was = i => project.fixtures.slice(0, i).filter(f => !moving.has(f.id)).length;   // for a group that is all moving
  const first = g => { const i = rest.findIndex(f => f.group === g.id); return i >= 0 ? i : was(project.fixtures.findIndex(f => f.group === g.id)); };
  const after = g => { const i = rest.map(f => f.group).lastIndexOf(g.id); return i >= 0 ? i + 1 : first(g); };
  if (t.where === 'before') return rest.indexOf(t.f);
  if (t.where === 'after') return rest.indexOf(t.f) + 1;
  if (t.where === 'beforeGroup') return first(t.g);
  if (t.where === 'into' || t.where === 'afterGroup') return after(t.g);
  return rest.length;
}
// Fixtures are drawn in list order, the last on top; the group of the drop place becomes theirs
function moveFixturesTo(ids, t) {
  const moving = new Set(ids), list = project.fixtures.filter(f => moving.has(f.id));
  if (!list.length) return;
  const rest = project.fixtures.filter(f => !moving.has(f.id));
  const gid = t.where === 'into' ? t.g.id : t.where === 'before' || t.where === 'after' ? t.f.group : null;
  rest.splice(dropIndex(rest, t, moving), 0, ...list);
  for (const f of list) { if (gid != null) f.group = gid; else delete f.group; }
  project.fixtures = rest;
  ui.sel = new Set(ids);   // what was dragged is selected
  normalizeGroups(); markGeom(); commit(); onSelection();
}
function moveGroupTo(gid, t) {
  const moving = new Set(project.fixtures.filter(f => f.group === gid).map(f => f.id));
  if (!moving.size) return;
  const list = project.fixtures.filter(f => moving.has(f.id)), rest = project.fixtures.filter(f => !moving.has(f.id));
  rest.splice(dropIndex(rest, t, moving), 0, ...list);
  project.fixtures = rest;
  ui.sel = new Set(moving);
  normalizeGroups(); markGeom(); commit(); onSelection();
}

/* ---------- source list ---------- */
// Sources are sorted along independent facets: how energetic a source is, where it fits, what it looks like and
// how it moves, plus its type. A shader is placed by its ISF CATEGORIES (a built-in lists one value per facet,
// then free keywords); the common words other ISF shaders use are mapped onto the facets by SRC_ALIASES.
const SRC_FACETS = [
  { key: 'mood', label: 'Mood', values: [['calm', 'Calm'], ['lively', 'Lively'], ['party', 'Party']] },
  { key: 'use', label: 'Use', values: [['architectural', 'Architectural'], ['ambient', 'Ambient'], ['show', 'Show'], ['utility', 'Utility']] },
  { key: 'look', label: 'Look', values: [['fill', 'Fill'], ['gradient', 'Gradient'], ['organic', 'Organic'], ['particles', 'Particles'], ['lines', 'Lines'], ['radial', 'Radial'], ['geometric', 'Geometric']] },
  { key: 'motion', label: 'Motion', values: [['still', 'Still'], ['drift', 'Drift'], ['flow', 'Flow'], ['chase', 'Chase'], ['flash', 'Flash'], ['beat', 'Beat']] },
  { key: 'type', label: 'Type', values: [['generator', 'Generators'], ['shader', 'My shaders'], ['media', 'Media']] },
];
const SRC_ALIASES = {
  smooth: 'calm', slow: 'calm', soft: 'calm', relaxing: 'calm', energetic: 'lively', disco: ['party', 'show'], club: ['party', 'show'], party: 'party',
  architecture: 'architectural', facade: 'architectural', atmospheric: 'ambient', atmosphere: 'ambient', mood: 'ambient', stage: 'show', concert: 'show',
  mask: 'utility', solid: 'fill', colour: 'fill', color: 'fill', rainbow: 'gradient', nature: 'organic', noise: 'organic', water: 'organic', fire: 'organic', clouds: 'organic',
  dots: 'particles', stars: 'particles', sparkle: 'particles', bars: 'lines', stripes: 'lines', rings: 'radial', circles: 'radial', tunnel: 'radial',
  pattern: 'geometric', grid: 'geometric', static: 'still', scroll: 'flow', wave: 'flow', strobe: 'flash', bpm: 'beat', music: 'beat', audio: 'beat',
};
// Words people search for that name a facet value: they match by that value, not by text
const SRC_SEARCH = { smooth: 'calm', soft: 'calm', slow: 'calm', relaxing: 'calm', disco: 'party', club: 'party', atmospheric: 'ambient', atmosphere: 'ambient', architecture: 'architectural', facade: 'architectural', bpm: 'beat' };
const SRC_FACET_OF = new Map(SRC_FACETS.flatMap(f => f.values.map(([v]) => [v, f.key])));
function srcTags(s) {
  if (s.kind !== 'isf') return [s.kind === 'screen' ? 'capture' : s.kind];
  const hdr = headerOf(s), c = hdr && hdr.CATEGORIES;
  return Array.isArray(c) ? c.map(t => String(t).toLowerCase()) : [];
}
// The source's value in each facet; tags listed first win
function srcFacets(s) {
  const out = { type: s.builtin ? 'generator' : s.kind === 'isf' ? 'shader' : 'media' };
  for (const t of srcTags(s)) for (const v of [t, ...[].concat(SRC_ALIASES[t] || [])]) {
    const k = SRC_FACET_OF.get(v);
    if (k && !out[k]) out[k] = v;
  }
  return out;
}
function srcLabel(key, v) { const f = SRC_FACETS.find(x => x.key === key), e = f && f.values.find(x => x[0] === v); return e ? e[1] : v; }
// Every word must be found in the name, description, tags or facet names, or name one of its facet values (disco → party)
function srcMatches(s, q, skip) {
  const fs = srcFacets(s), want = ui.srcFacets || {};
  for (const k in want) if (k !== skip && want[k] && fs[k] !== want[k]) return false;
  if (!q) return true;
  const hdr = s.kind === 'isf' ? headerOf(s) : null;
  const hay = [s.name, hdr && hdr.DESCRIPTION, ...srcTags(s), ...Object.entries(fs).flatMap(([k, v]) => [v, srcLabel(k, v)])].join(' ').toLowerCase();
  const vals = Object.values(fs);
  return q.split(/\s+/).every(w => hay.includes(w) || vals.includes(SRC_SEARCH[w]));
}
function renderSrcFacets() {
  const want = ui.srcFacets || (ui.srcFacets = {}), q = (ui.srcFilter || '').trim().toLowerCase();
  // Type only appears once there is more than one kind of source
  const kinds = new Set(project.sources.map(s => srcFacets(s).type));
  const sel = SRC_FACETS.filter(f => f.key !== 'type' || kinds.size > 1 || want.type).map(f => {
    // How many sources each value would show, given the search and the other facets
    const n = new Map();
    for (const s of project.sources) if (srcMatches(s, q, f.key)) { const v = srcFacets(s)[f.key]; n.set(v, (n.get(v) || 0) + 1); }
    const el = h('select', { class: want[f.key] ? 'on' : '', title: f.label, 'aria-label': 'Filter by ' + f.label.toLowerCase() },
      h('option', { value: '' }, f.label + ': all'),
      ...f.values.filter(([v]) => n.get(v) || want[f.key] === v).map(([v, l]) => h('option', { value: v }, `${l} (${n.get(v) || 0})`)));
    el.value = want[f.key] || '';
    el.addEventListener('change', () => { want[f.key] = el.value; renderSrcList(); $('#srcFacets select[title="' + f.label + '"]').focus(); });
    return el;
  });
  const any = q || Object.values(want).some(Boolean);
  $('#srcFacets').replaceChildren(...sel, ...(any ? [h('button', { type: 'button', title: 'Show all sources', onclick: () => { ui.srcFacets = {}; ui.srcFilter = $('#srcFind').value = ''; renderSrcList(); $('#srcFind').focus(); } }, 'Clear') ] : []));
}
function renderSrcList() {
  renderSrcFacets();
  const grid = $('#srcList');
  const z = selZone(), L = selLayer(), n = z && L ? z.layers.indexOf(L) + 1 : 1;
  const where = z ? `${z.name} layer ${n}` : 'a new layer';
  $('#srcTarget').textContent = z ? `→ ${z.name} · L${n}` : '';
  $('#srcTarget').title = 'Clicking a source plays it in ' + where;
  const usedBy = new Map();
  for (const zz of project.zones) zz.layers.forEach((l, i) => { if (l.on && l.src && l !== L) usedBy.set(l.src, (usedBy.has(l.src) ? usedBy.get(l.src) + ', ' : '') + `${zz.name} layer ${i + 1}`); });
  const q = (ui.srcFilter || '').trim().toLowerCase();
  const shown = project.sources.filter(s => srcMatches(s, q));
  if (!shown.length) { grid.replaceChildren(h('div', { class: 'none' }, q ? `Nothing matches “${q}” with these filters.` : 'No source matches these filters.')); return; }
  grid.replaceChildren(...shown.map(s => {
    const kind = s.kind === 'isf' ? 'ISF' : s.kind === 'screen' ? 'CAP' : s.kind === 'video' ? 'VID' : 'IMG';
    const missing = (s.kind === 'image' || s.kind === 'video' || s.kind === 'screen') && !mediaEls.get(s.id);
    const rt = s.kind === 'isf' && runtimes.get(s.id);
    const live = L && L.src === s.id, used = usedBy.get(s.id);
    const tag = missing ? [s.kind === 'screen' ? 'OFF' : 'RELINK', 'warn'] : rt && rt.error ? ['ERROR', 'err'] : s.builtin ? null : [kind, ''];
    const fs = srcFacets(s), kw = srcTags(s).filter(t => !SRC_FACET_OF.has(t));
    const tags = [SRC_FACETS.filter(f => f.key !== 'type' && fs[f.key]).map(f => srcLabel(f.key, fs[f.key])).join(' · '), kw.join(', ')].filter(Boolean).join('\n');
    const tile = h('div', { class: 'tile' + (live ? ' live' : used ? ' used' : ''), role: 'button', tabindex: 0,
      title: (live ? `${s.name}: playing in ${where}` : `${s.name}${used ? ': playing in ' + used : ''}. Click to play it in ${where}`) + (tags ? `\n${tags}` : '') },
      h('div', { class: 'tb' }, h('span', { class: 'ic' }, icon(s.kind === 'isf' ? 'isf' : s.kind)), thumbOf(s),
        tag ? h('span', { class: 'tag ' + tag[1] }, tag[0]) : null,
        s.builtin ? null : h('button', { class: 'x', type: 'button', title: 'Remove source', 'aria-label': 'Remove ' + s.name, onclick: e => { e.stopPropagation(); removeSource(s); } }, icon('x'))),
      h('span', { class: 'nm' }, s.name));
    const go = () => { loadSource(s.id); renderSrcList(); ui.rightTab = 'content'; renderRight(); commitSoft(); };
    tile.addEventListener('click', go);
    tile.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    onRightClick(tile, e => sourceMenu(e, s, go));
    tile.addEventListener('mouseenter', () => { ui.hoverSrc = s.id; });
    tile.addEventListener('mouseleave', () => { if (ui.hoverSrc === s.id) ui.hoverSrc = null; markThumb(s); });
    return tile;
  }));
}
