// nouPix · js/ui-cues.js
// The cue lists' panel, in the bottom panel's Cues tab or the column beside the stage: the lists as tabs (+ New cue
// list), GO with the cue on standby, Back and Stop, a row per cue (the one playing with its progress, the one on
// standby), the picked cue's editor under it (number, name, its actions on zones, what comes after), + Cue (what every
// zone shows now) and + Empty cue.

// The list the panel shows: the one picked, or the first
const shownCueList = () => cueListOf(ui.cueList) || project.cueLists[0] || null;
// Where the cues show now: the bottom panel's tab, the column's
const cueRoots = () => [ui.dockTab === 'cues' && !ui.dockCollapsed && $('#dockBody'), scenesSide() && !scenesWinOpen() && ui.colTab === 'cues' && $('#scenesBody')].filter(Boolean);
const cuesShown = () => cueRoots().length > 0;
// While something in the panel is typed in, a redraw waits for it to be done
let cuesPending = false;
// (a list picked from redraws at once: only text and numbers being typed hold it)
const cuesBusy = () => { const a = document.activeElement; return !!a && a.matches('input[type=text], input[type=number]') && cueRoots().some(r => r.contains(a)); };
function refreshCues() {
  if (!cuesShown()) return;
  if (cuesBusy()) { cuesPending = true; return; }
  cuesPending = false;
  for (const r of cueRoots()) keepScroll(r, () => { r.replaceChildren(); renderCues(r); });
}
document.addEventListener('focusout', e => { if (cuesPending && e.target.closest && e.target.closest('.cuepanel')) setTimeout(() => { if (!cuesBusy()) refreshCues(); }); }, true);

// How a cue's actions read: "Strips ▸ Blue ▲100%" each
function actionText(a) {
  const z = zoneById(a.zone), sc = z && z.scenes.find(s => s.id === a.scene);
  return [z ? z.name : '?', sc ? '▸ ' + sc.name : '', a.level != null ? (a.level > 0 ? '▲' : '▼') + pct(a.level) : ''].filter(Boolean).join(' ');
}
function thenText(L, c) {
  if (c.then === 'wait') return 'GO';
  const t = c.then === 'goto' ? cueOf(L, c.target) : cueAfter(L, c);
  return '→ ' + (t ? t.num : 'end') + (c.wait > 0 ? ' · ' + fmtV(c.wait) + ' s' : '');
}
const cueTitle = c => c.name || c.actions.map(a => { const z = zoneById(a.zone), sc = z && z.scenes.find(s => s.id === a.scene); return sc ? sc.name : ''; }).filter(Boolean).join(' · ') || 'Cue ' + c.num;

function renderCues(body) {
  const L = shownCueList();
  const panel = h('div', { class: 'cuepanel' });
  body.append(panel);
  const tabs = h('div', { class: 'cuetabs' },
    project.cueLists.map(K => h('button', { type: 'button', class: 'cltab' + (K === L ? ' on' : ''), title: K === L ? 'Right-click for its menu' : 'Show ' + K.name,
      onclick: () => { ui.cueList = K.id; ui.cueSel = null; refreshCues(); }, oncontextmenu: e => { e.preventDefault(); cueListMenu(e.currentTarget, K); } }, K.name)),
    h('button', { type: 'button', class: 'btn sm', title: 'A new cue list: cues that go one after the other, by GO or by themselves', onclick: () => addCueList() }, '+ New cue list'),
    h('span', { class: 'fill' }),
    L ? h('button', { type: 'button', class: 'btn sm icon', title: L.name + ': rename, delete', 'aria-label': L.name + ' menu', onclick: e => cueListMenu(e.currentTarget, L) }, '⋯') : null);
  panel.append(tabs);
  // the zones its new cues act on, ticked
  if (L) panel.append(h('div', { class: 'cuezones', title: 'What + Cue records: these zones\' scenes and levels' }, h('span', { class: 'lbl' }, 'New cues'),
    zoneTicks(id => L.zones.includes(id), id => toggleCueZone(L, id), 'New cues act on')));
  if (!L) {
    panel.append(h('div', { class: 'cueempty' }, h('p', null, 'No cue lists yet. A cue list plays scenes and zone levels one cue after the other, by GO.'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => addCueList() }, '+ New cue list')));
    return;
  }
  const st = cueProgress(L);
  // GO, and what it plays; Back and Stop
  const go = h('button', { type: 'button', class: 'cuegobtn', disabled: !st.standby, title: 'GO: plays the cue on standby (Space, with the mouse off the stage)', 'aria-label': 'GO',
    onclick: () => cueGo(L) }, 'GO');
  panel.append(h('div', { class: 'cuego' }, go,
    h('div', { class: 'cuenext' },
      h('div', { class: 'cnl' }, h('span', { class: 'lbl' }, 'Standby'), st.standby ? h('b', null, st.standby.num + ' · ' + cueTitle(st.standby)) : h('span', { class: 'muted' }, 'the end of the list')),
      h('div', { class: 'cnl', 'data-cue-auto': '' }, st.cur ? [h('span', { class: 'lbl' }, 'Playing'), h('span', null, st.cur.num + ' · ' + cueTitle(st.cur))] : h('span', { class: 'muted' }, 'Nothing played yet'))),
    h('div', { class: 'cuebtns' },
      h('button', { type: 'button', class: 'btn sm', title: 'Back: the cue before goes on standby (nothing plays)', onclick: () => cueBack(L) }, 'Back'),
      h('button', { type: 'button', class: 'btn sm', title: 'Stop: nothing goes on by itself, the levels stop where they are', onclick: () => cueStop(L) }, 'Stop'))));
  // the cues
  const rows = h('div', { class: 'cuerows', 'data-keep': 'cuerows' });
  if (!L.cues.length) rows.append(h('p', { class: 'rowhint' }, 'No cues yet. Set the list\'s zones as the first cue should show them (scenes and levels), then + Cue.'));
  for (const c of L.cues) {
    const live = st.cur === c, sb = st.standby === c, sel = ui.cueSel === c.id;
    const r = h('div', { class: 'cue' + (live ? ' live' : '') + (sb ? ' standby' : '') + (sel ? ' sel' : ''), 'data-cue': c.id, tabindex: 0,
      title: 'Click: put it on standby and edit it. Double-click: GO from it.',
      onclick: () => { ui.cueSel = sel ? null : c.id; cueStandby(L, c); },
      ondblclick: () => { ui.cueSel = c.id; cueGo(L, c); } },
      h('span', { class: 'cmark' }, live ? '▶' : sb ? '●' : ''),
      h('span', { class: 'cnum' }, c.num),
      h('span', { class: 'cname' }, cueTitle(c)),
      h('span', { class: 'cacts' }, c.actions.length ? c.actions.map(a => h('span', { class: 'cact', title: actionText(a) + ' · ' + fmtFade(a.fade) }, actionText(a))) : h('span', { class: 'muted' }, 'no actions')),
      h('span', { class: 'cfade mono muted' }, fmtFade(cueLength(c))),
      h('span', { class: 'cthen mono' + (c.then === 'wait' ? ' muted' : '') }, thenText(L, c)),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Cue ' + c.num + ' menu', onclick: e => { e.stopPropagation(); cueMenu(e.currentTarget, L, c); } }, '⋯'),
      h('span', { class: 'prog' }));
    onRightClick(r, e => cueMenu(e, L, c));
    rows.append(r);
    if (sel) rows.append(cueEditor(L, c));
  }
  panel.append(rows, h('div', { class: 'cuefoot' },
    h('button', { type: 'button', class: 'btn sm', title: 'A cue of what the list\'s zones show now: each its scene and its level', onclick: () => recordCue(L) }, '+ Cue'),
    h('button', { type: 'button', class: 'btn sm', title: 'A cue with no actions, to fill in', onclick: () => addCue(L) }, '+ Empty cue')));
}
// A tick box per zone (top zone first), in its colour
const zoneTicks = (on, flip, what) => project.zones.slice().reverse().map(z => h('label', { class: 'czone' + (on(z.id) ? ' on' : ''), style: z.tag ? { '--tag': z.tag } : null, title: what + ' ' + z.name },
  h('input', { type: 'checkbox', checked: on(z.id), 'aria-label': what + ' ' + z.name, onchange: () => flip(z.id) }), z.name));
// The picked cue's settings, under its row
function cueEditor(L, c) {
  const ch = (fn, soft) => e => { fn(e.target); if (soft) commitSoft(); else { commit({ lists: false }); refreshCues(); } };
  const zs = project.zones.slice().reverse();
  // one action per zone ticked, top zone first
  const acts = zs.map(z => c.actions.find(a => a.zone === z.id)).filter(Boolean).map(a => {
    const z = zoneById(a.zone);
    return h('div', { class: 'caction' },
      h('span', { class: 'czname', style: z.tag ? { '--tag': z.tag } : null }, z.name),
      h('select', { 'aria-label': 'Scene', title: 'The scene it plays (Keep: what plays stays)', onchange: ch(t => { a.scene = t.value; }) },
        h('option', { value: '', selected: !a.scene }, 'Keep scene'), (z ? z.scenes : []).map(sc => h('option', { value: sc.id, selected: sc.id === a.scene }, sc.name))),
      h('label', { class: 'clevel', title: 'Its level goes to this (off: the level stays)' },
        h('input', { type: 'checkbox', checked: a.level != null, onchange: ch(t => { a.level = t.checked ? 1 : null; }) }), 'Level',
        h('input', { type: 'number', min: 0, max: 100, step: 1, value: a.level != null ? Math.round(a.level * 100) : '', disabled: a.level == null, 'aria-label': 'Level %',
          onchange: ch(t => { a.level = clamp((+t.value || 0) / 100, 0, 1); }) }), '%'),
      h('label', { class: 'cfadein', title: 'How long it takes: the scene fades in, the level moves over this' }, 'Fade',
        h('input', { type: 'number', min: 0, max: 3600, step: 0.1, value: fmtV(a.fade), 'aria-label': 'Fade (s)', onchange: ch(t => { a.fade = clamp(+t.value || 0, 0, 3600); }) }), 's'));
  });
  const others = L.cues.filter(o => o !== c);
  // Enter takes what was typed (and leaves the field, so the panel shows it)
  const enter = e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); };
  return h('div', { class: 'cueedit', onkeydown: enter },
    h('div', { class: 'cerow' },
      h('label', null, 'Number', h('input', { type: 'text', class: 'cnumin', value: c.num, 'aria-label': 'Cue number', onchange: ch(t => { c.num = t.value.trim() || c.num; }) })),
      h('label', { class: 'grow' }, 'Name', h('input', { type: 'text', value: c.name, placeholder: cueTitle(Object.assign({}, c, { name: '' })), 'aria-label': 'Cue name', onchange: ch(t => { c.name = t.value.trim(); }) }))),
    h('div', { class: 'cerow cuezones', title: 'Tick a zone and the cue acts on it: what it shows now, to change below' }, h('span', { class: 'lbl' }, 'Zones'),
      zoneTicks(id => c.actions.some(a => a.zone === id), id => toggleCueAction(c, id), 'This cue acts on')),
    h('div', { class: 'cacts-ed' }, acts.length ? acts : h('p', { class: 'muted' }, 'No zone ticked: it changes nothing.')),
    h('div', { class: 'cerow' },
      h('span', { class: 'fill' }),
      h('label', null, 'Then',
        h('select', { 'aria-label': 'Then', onchange: ch(t => { c.then = t.value; if (c.then === 'goto' && !cueOf(L, c.target)) c.target = (others[0] || {}).id || ''; if (c.then === 'goto' && !c.target) c.then = 'wait'; }) },
          [['wait', 'Wait for GO'], ['next', 'Next cue by itself'], ['goto', 'Go to a cue']].map(([v, t]) => h('option', { value: v, selected: c.then === v }, t)))),
      c.then === 'goto' ? h('select', { 'aria-label': 'Go to cue', onchange: ch(t => { c.target = t.value; }) }, others.map(o => h('option', { value: o.id, selected: o.id === c.target }, o.num + ' · ' + cueTitle(o)))) : null,
      c.then !== 'wait' ? h('label', { title: 'Seconds after this cue starts' }, 'after',
        h('input', { type: 'number', min: 0, max: 86400, step: 0.1, value: fmtV(c.wait), 'aria-label': 'Wait (s)', onchange: ch(t => { c.wait = clamp(+t.value || 0, 0, 86400); }) }), 's') : null));
}
function cueMenu(anchor, L, c) {
  const i = L.cues.indexOf(c);
  menu(anchor, [
    !isEl(anchor) && { head: 'Cue ' + c.num + ' · ' + cueTitle(c) },
    ['GO from here', () => cueGo(L, c)],
    ['Put on standby', () => cueStandby(L, c)],
    ['Update from what shows now', () => { updateCueFromNow(c); }, { title: 'Its zones: the scene and level each shows now' }],
    '-',
    ['Move up', () => moveCue(L, c, -1), { disabled: i === 0 }],
    ['Move down', () => moveCue(L, c, 1), { disabled: i === L.cues.length - 1 }],
    ['Duplicate', () => duplicateCue(L, c)],
    ['Delete', () => deleteCue(L, c)],
  ]);
}
function cueListMenu(anchor, L) {
  menu(anchor, [
    ['Rename…', () => renameCueList(L)],
    ['Delete', () => confirmBox(`Delete ${L.name}?`, `Its ${L.cues.length} cue${L.cues.length === 1 ? '' : 's'} go with it. ${MOD}Z brings it back.`, 'Delete', () => deleteCueList(L))],
  ]);
}
function renameCueList(L) {
  const tmp = { name: L.name };
  const close = () => bg.remove();
  const save = () => { L.name = tmp.name.trim() || L.name; close(); commit({ lists: false }); refreshCues(); };
  const nameIn = textInput(tmp, 'name', { aria: 'Cue list name' });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Rename cue list' },
      h('header', null, 'Cue list'),
      h('div', { class: 'mb' }, row('Name', nameIn)),
      h('footer', null, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'))));
  uiDocNow().body.append(bg);
  nameIn.focus(); nameIn.select();
}
// The fade of the cue playing on its row, and the time left before one goes by itself, once a frame
function drawCueProgress() {
  if (!cuesShown()) return;
  const L = shownCueList();
  if (!L) return;
  const st = cueProgress(L);
  for (const r of cueRoots()) {
    for (const el of $$('.cue', r)) {
      const w = st.cur && el.dataset.cue === st.cur.id && st.k < 1 ? (st.k * 100).toFixed(1) + '%' : '0px';
      const p = el.querySelector('.prog');
      if (p && p.style.width !== w) p.style.width = w;
    }
    const a = $('[data-cue-auto]', r);
    if (a) {
      const t = st.auto && st.auto.cue ? `${st.auto.cue.num} by itself in ${fmtV(Math.ceil(st.auto.left * 10) / 10)} s` : '';
      let el = a.querySelector('.cauto');
      if (t && !el) a.append(el = h('span', { class: 'cauto mono' }));
      if (el && el.textContent !== t) el.textContent = t;
    }
  }
}
