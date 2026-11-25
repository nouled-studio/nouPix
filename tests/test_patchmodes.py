# Patching a controller as its device is set up: by universes per output (one count for all, or each output its own;
# in order, each output's first universe typed, or every universe typed), by pixels per output (on from the channel
# the last one ends at, on a new universe, or each start typed, with Follow and New U), or manual (no outputs: each
# fixture its own universe and channel, the next free one when it comes, Address in sequence, clashes found by
# channel). A device that counts from 1, the help, dropping on a controller, files and undo.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8270
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 950})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    time.sleep(0.3)
    # strips of 57 RGB pixels (171 channels), a 256-pixel panel, rings of 60: the demo's fixtures, on one controller
    ev("(() => { olm.loadProject(demoProject()); ui.dockTab = 'patch'; ui.dockH = 420; ui.dockCollapsed = false; renderAll(); })()")
    time.sleep(0.4)
    C = "project.controllers[0]"
    outs = lambda c=C: ev(f"ctrlOuts({c}).map(L => L.list ? L.list.join('/') : L.base + '+' + L.upo)")
    addr = lambda name: ev(f"(() => {{ const f = project.fixtures.find(f => f.name === {json.dumps(name)}); return f && f._patch ? addrText(f._patch) : ''; }})()")
    refresh = lambda: ev("(() => { ensurePatch(); renderAll(); })()")

    # ---------- nothing changes for a project from before
    saved = ev(f"JSON.parse(serialize()).controllers[0]")
    check("a project from before: its outputs as before, and none of the new fields written",
          outs() == ['0+4', '4+4', '8+4', '12+4'] and not any(k in saved for k in ('same', 'upos', 'pxOuts', 'uniPlace', 'pxPlace', 'outStarts', 'outUnis', 'outAt', 'from1')), (outs(), list(saved)))
    check("the Patch tab: Patch by Universes, Pixels, Manual; Same for all; the line saying what the mode is for",
          pg.locator(".ctrl-fields .seg button", has_text="Manual").count() == 1 and pg.locator("#ctrlSame").is_checked()
          and "Universes per output" in (pg.locator(".pinfo").get_attribute("data-tip") or ""))

    # ---------- Universes, each output its own count (DiGidot: 4, 4, 3, 3)
    pg.click("#ctrlSame"); time.sleep(0.2)
    check("Same for all off: each output's own count on its line, starting from the one for all",
          ev(f"{C}.same") is False and ev(f"{C}.upos") == [4, 4, 4, 4] and pg.locator(".outhead .octl input").count() == 4)
    for i, v in ((2, '3'), (3, '3')):
        inp = pg.locator(".outhead .octl input").nth(i); inp.fill(v); inp.press("Enter")
    time.sleep(0.2)
    check("OUT 3 with 3 universes: OUT 4 starts on 11, as on the DiGidot", outs() == ['0+4', '4+4', '8+3', '11+3'], outs())
    check("…and the Rings (OUT 3) and Wave (OUT 4) follow", addr("Ring 1").startswith("U 8") and addr("Wave").startswith("U 11"), (addr("Ring 1"), addr("Wave")))
    h0 = ev("hist.idx")
    pg.click("#ctrlSame"); time.sleep(0.2)
    check("Same for all on again: the one for all as it was, one step of undo", outs() == ['0+4', '4+4', '8+4', '12+4'] and ev("hist.idx") == h0 + 1, outs())
    pg.click("#ctrlSame"); time.sleep(0.2)
    check("…and off again: each output's own counts as they were, nothing lost", outs() == ['0+4', '4+4', '8+3', '11+3'], outs())

    # ---------- Start typed (ENTTEC): the first universe of each output
    pg.click(".ctrl-fields .seg button:has-text('Start typed')"); time.sleep(0.2)
    check("Start typed: each output's first universe on its line, filled from where it was (nothing moves)", outs() == ['0+4', '4+4', '8+3', '11+3'] and ev(f"{C}.outStarts") == [0, 4, 8, 11]
          and pg.locator(".ctrl-fields label:has-text('Start uni')").count() == 0)
    st = pg.locator(".outrow").nth(1).locator(".octl input").nth(1); st.fill("20"); st.press("Enter"); time.sleep(0.2)
    check("OUT 2 from universe 20: the Strips go there, the others stay", outs() == ['0+4', '20+4', '8+3', '11+3'] and addr("Strip 1").startswith("U 20"), (outs(), addr("Strip 1")))

    # ---------- Each typed (MADRIX NEBULA): every universe, in any order
    pg.click(".ctrl-fields .seg button:has-text('Each typed')"); time.sleep(0.2)
    lst = pg.locator(".outrow").nth(1).locator(".octl input.ulist")
    check("Each typed: each output's universes as a list, filled from where they were", lst.input_value() == "20, 21, 22, 23", lst.input_value())
    lst.fill("9, 7, 12, 13"); lst.press("Enter"); time.sleep(0.2); refresh()
    check("OUT 2 on 9, 7, 12, 13: its universes in that order", outs()[1] == '9/7/12/13', outs())
    # Strips: 57 px each, 170 a universe: Strip 3 starts on 9 and its last pixels go on the next one of the list, 7
    s3 = ev("(() => { const f = project.fixtures.find(f => f.name === 'Strip 3'); return [...new Set(Array.from(f._out.lin).filter(l => l >= 0).map(l => f._out.unis[l >> 9].uni))]; })()")
    check("…a strip past the end of 9 goes on in 7, not 10", s3 == [9, 7], s3)
    check("…and 7 and 9 go out to the device", ev("universes.filter(U => U.ctrl === project.controllers[0]).map(U => U.uni).includes(7)"))
    lst = pg.locator(".outrow").nth(1).locator(".octl input.ulist"); lst.fill("4, 5, 6, 7"); lst.press("Enter"); time.sleep(0.2)
    pg.click(".ctrl-fields .seg button:has-text('In order')"); time.sleep(0.2)
    check("back to In order: each after the one before, from Start uni", outs() == ['0+4', '4+4', '8+3', '11+3'] and pg.locator(".ctrl-fields label:has-text('Start uni')").count() == 1, outs())

    # ---------- Pixels: new universe per output (SpiNode, a DiGidot by pixels)
    pg.click(".ctrl-fields .seg button:has-text('Pixels')"); time.sleep(0.2)
    ev(f"(() => {{ const c = {C}; c.chPx = 4; c.pxOuts = [437, 437, 331, 331]; markPatch(); commit(); renderDock(); }})()"); time.sleep(0.2)
    check("Pixels, Next channel (as before): RGBW 437 px take 3 universes and 212 channels, the next going on in that universe",
          ev(f"ctrlOuts({C}).map(L => L.base + '.' + (L.start + 1))") == ['0.1', '3.213', '6.425', '9.213'], ev(f"ctrlOuts({C}).map(L => L.base + '.' + (L.start + 1))"))
    pg.click(".ctrl-fields .seg button:has-text('Next uni')"); time.sleep(0.2)
    check("New universe: each output on channel 1 of a new one, the DiGidot's 0, 4, 8, 11", ev(f"ctrlOuts({C}).map(L => L.base + '.' + (L.start + 1))") == ['0.1', '4.1', '8.1', '11.1'],
          ev(f"ctrlOuts({C}).map(L => L.base + '.' + (L.start + 1))"))

    # ---------- Pixels, typed (Advatek without Automatic Sequential Channels), counting from 1
    ev("""(() => { const c = newController({ name: 'PixLite 16', ip: '10.0.0.40', mode: 'pixels', outputs: 16, chPx: 3, startUniverse: 0 }); project.controllers.push(c);
      ui.selCtrl = c.id; markPatch(); commit(); renderAll(); })()"""); time.sleep(0.3)
    P = "ctrlById(ui.selCtrl)"
    pg.click(".ctrl-fields .seg button:has-text('1')"); time.sleep(0.2)
    check("Counts from 1: Start uni shows 1 for universe 0, and nothing that is sent moves", ev(f"{P}.from1") is True and ev(f"{P}.startUniverse") == 0
          and pg.locator(".ctrl-fields label:has-text('Start uni') input").input_value() == "1")
    pg.click("#ctrlSame"); time.sleep(0.2)
    for i, v in enumerate([209, 302, 396, 491, 583] + [400] * 11):
        inp = pg.locator(".outhead .octl input").nth(i); inp.fill(str(v)); inp.press("Enter")
    time.sleep(0.2)
    ends = lambda: ev(f"ctrlOuts({P}).map(L => (L.base + 1) + '.' + (L.start + 1) + '-' + (L.base + Math.floor((L.end - 1) / 512) + 1) + '.' + ((L.end - 1) % 512 + 1))")
    check("Next channel (Automatic Sequential Channels): the Advatek's own start and end of outputs 1 to 5",
          ends()[:5] == ['1.1-2.117', '2.118-4.3', '4.4-6.171', '6.172-9.114', '9.115-12.333'], ends()[:5])
    pg.click(".ctrl-fields .seg button:has-text('Manual') >> nth=1"); time.sleep(0.2)
    check("Typed: each output's start on its line, filled from where it was", ends()[:5] == ['1.1-2.117', '2.118-4.3', '4.4-6.171', '6.172-9.114', '9.115-12.333']
          and pg.locator(".outrow").nth(1).locator(".octl button", has_text="Follow").count() == 1 and pg.locator(".outrow").nth(0).locator(".octl button").count() == 0)
    o6 = pg.locator(".outrow").nth(5).locator(".octl input"); o6.nth(1).fill("16"); o6.nth(1).press("Enter"); time.sleep(0.1)
    o6 = pg.locator(".outrow").nth(5).locator(".octl input"); o6.nth(2).fill("1"); o6.nth(2).press("Enter"); time.sleep(0.1)
    for o in range(6, 16):
        pg.locator(".outrow").nth(o).locator(".octl button", has_text="New U").click(); time.sleep(0.03)
    time.sleep(0.2)
    adv = ['1.1-2.117', '2.118-4.3', '4.4-6.171', '6.172-9.114', '9.115-12.333'] + [f"{u}.1-{u + 2}.180" for u in range(16, 47, 3)]
    check("OUT 6 typed at 16 and New U on the rest: the Advatek's whole table, as it shows it", ends() == adv, ends())
    pg.locator(".outrow").nth(1).locator(".octl button", has_text="Follow").click(); time.sleep(0.1)
    check("Follow: right where the output before ends", ends()[1] == '2.118-4.3', ends()[1])

    # ---------- dropping a fixture on a controller in the list
    pg.drag_and_drop("#fxList li:has-text('Wave')", ".ctrl-list .ctrl >> nth=1"); time.sleep(0.3)
    check("a fixture dropped on a controller in the list: at the end of its OUT 1", ev("(() => { const p = project.fixtures.find(f => f.name === 'Wave')._patch; return p.ctrl.name + ' ' + p.out; })()") == "PixLite 16 0")

    # ---------- Manual
    ev(f"(() => {{ ui.selCtrl = project.controllers[0].id; renderDock(); }})()"); time.sleep(0.2)
    pg.click(".ctrl-fields .seg button:has-text('Universes')"); time.sleep(0.2)
    before = {n: addr(n) for n in ("Panel A", "Strip 2", "Ring 3")}
    pg.click(".ctrl-fields .seg button:has-text('Manual')"); time.sleep(0.3)
    check("into Manual: every fixture keeps its address, and is listed with its universe and channel",
          all(addr(n) == before[n] for n in before) and pg.locator(".ctrl-edit .prow").count() == 8 and "kept their addresses" in pg.locator(".toast").last.inner_text(), ({n: addr(n) for n in before}, before))
    check("…no outputs, Same for all or Start uni for a manual controller: a block per universe instead", pg.locator(".outhead .on", has_text="OUT").count() == 0 and pg.locator("#ctrlSame").count() == 0
          and pg.locator(".ctrl-fields label:has-text('Start uni')").count() == 0 and "Manual" in (pg.locator(".pinfo").get_attribute("data-tip") or "") and pg.locator(".outhead .on", has_text="U 0").count() == 1)
    check("…its badges show the address", ev("(() => { ensurePatch(); renderFxList(); return document.querySelector('#fxList li[data-id=\"' + project.fixtures.find(f => f.name === 'Strip 2').id + '\"] .badge').textContent; })()").startswith("A U"))
    # a new one comes to the next free address
    ev("(() => { const f = newFixture('line', { id: 'NEW', name: 'Extra', x1: 100, y1: 600, x2: 300, y2: 600, pixels: 100 }); project.fixtures.push(f); markGeom(); commit(); })()"); time.sleep(0.2)
    pg.drag_and_drop("#fxList li:has-text('Extra')", ".outrow.mfree"); time.sleep(0.3)
    nf = ev("fxById('NEW').addr")
    top = ev("Math.max(...project.controllers[0].chains[0].filter(id => id !== 'NEW').map(id => { const p = fxById(id)._patch; return p.base * 512 + p.last; }))")
    check("a fixture dropped on the list takes the next free address: right after the last channel used, as it fits there",
          nf and nf['u'] * 512 + nf['ch'] - 1 == top + 1, (nf, top))
    ev("(() => { const f = newFixture('line', { id: 'BIG', name: 'Big', x1: 100, y1: 620, x2: 300, y2: 620, pixels: 165 }); project.fixtures.push(f); markGeom(); commit(); })()"); time.sleep(0.2)
    pg.drag_and_drop("#fxList li:has-text('Big')", ".outrow.mfree"); time.sleep(0.3)
    nb = ev("fxById('BIG').addr")
    check("…and on a new universe when it would not fit in what is left of that one (495 channels)", nb == {'u': nf['u'] + 1, 'ch': 1}, (nb, nf))
    ev("(() => { unassign('BIG'); project.fixtures = project.fixtures.filter(f => f.id !== 'BIG'); markGeom(); markPatch(); commit(); })()"); time.sleep(0.2)
    # a clash: two fixtures on the same address
    ev("(() => { fxById('NEW').addr = { u: 0, ch: 1 }; markPatch(); commit(); ensurePatch(); renderAll(); })()"); time.sleep(0.2)
    check("two fixtures on the same channels: said, both marked, red in the list", any("share channels" in x for x in ev("patchConflicts"))
          and ev("fxById('NEW')._clash && fxById('NEW')._clash.name") == "Panel A" and pg.locator(".ctrl-edit .prow.ovf").count() == 2, ev("patchConflicts"))
    # the Inspector: its address, Next free
    ev("(() => { ui.sel = new Set(['NEW']); onSelection(); renderRight(); })()"); time.sleep(0.3)
    ins = pg.locator("#rightBody")
    check("the Inspector on a manual fixture: no Output, its universe and channel, Next free, the clash said",
          ins.locator("select[aria-label='Output']").count() == 0 and ins.locator("input[aria-label='Universe']").count() == 1 and ins.locator("button", has_text="Next free").count() == 1
          and "shares channels with Panel A" in ins.inner_text())
    u = ins.locator("input[aria-label='Universe']"); u.fill("30"); u.press("Enter"); time.sleep(0.2)
    check("…a universe typed there moves it", ev("fxById('NEW').addr.u") == 30 and not ev("fxById('NEW')._clash"))
    ins.locator("button", has_text="Next free").click(); time.sleep(0.2)
    check("…Next free puts it after the others", ev("fxById('NEW').addr.u * 512 + fxById('NEW').addr.ch - 1") > top, ev("fxById('NEW').addr"))
    # Address in sequence
    ev("(() => { ui.sel = new Set(); onSelection(); renderAll(); })()"); time.sleep(0.2)
    pg.locator(".outbar button", has_text="Address all in sequence").click(); time.sleep(0.2)
    seq = ev("project.controllers[0].chains[0].map(id => fxById(id)).filter(Boolean).map(f => [f.name, f._patch.base * 512 + f._patch.first, f._patch.base * 512 + f._patch.last])")
    seq.sort(key=lambda r: r[1])
    gaps = all(seq[i + 1][1] > seq[i][2] for i in range(len(seq) - 1))
    check("Address all in sequence: one after another, none sharing channels", gaps and not ev("patchConflicts.length"), seq)
    # back to Universes
    h0 = ev("hist.idx")
    pg.click(".ctrl-fields .seg button:has-text('Universes')"); time.sleep(0.3)
    check("out of Manual: all on OUT 1 in the order of their addresses, with a word on it", ev("project.controllers[0].chains[0].length") == 9 and ev("project.controllers[0].chains.slice(1).every(c => !c.length)")
          and "order of their addresses" in pg.locator(".toast").last.inner_text() and ev("project.fixtures.every(f => !f.addr)"))
    ev("undo()"); time.sleep(0.3); refresh()
    check("…undone: manual again, the addresses back", ev("project.controllers[0].mode") == "manual" and ev("fxById('NEW').addr") is not None)

    # ---------- files: kept, and repaired
    data = ev("serialize()")
    ev(f"olm.loadProject(hydrate(JSON.parse({json.dumps(data)})))"); time.sleep(0.3)
    check("a file keeps each controller's mode, counts, starts and Counts from", ev("project.controllers[0].mode") == "manual" and ev("project.controllers[1].pxPlace") == "typed"
          and ev("project.controllers[1].outAt[5]") == {"u": 15, "ch": 1} and ev("project.controllers[1].from1") is True and ev("project.controllers[1].pxOuts[4]") == 583, ev("project.controllers[1].outAt"))
    bad = json.loads(data)
    bad['controllers'][1].update({'pxPlace': 'sideways', 'outAt': 'nope', 'same': 'maybe', 'upos': [0, 200, 'x'], 'outUnis': [[1, -4, 99999, 'q', 3]], 'uniPlace': 'each', 'mode': 'weird'})
    ev(f"olm.loadProject(hydrate({json.dumps(bad)}))"); time.sleep(0.3)
    c1 = ev("JSON.parse(JSON.stringify(project.controllers[1], replacer))")
    check("a file with nonsense in them: repaired (an unknown mode is Universes, wrong values go or come in range)",
          c1['mode'] == 'universes' and 'pxPlace' not in c1 and 'outAt' not in c1 and 'same' not in c1 and c1['upos'] == [1, 64, c1['upo']] and c1['outUnis'] == [[1, 3]], c1)

    # ---------- the help
    ev("(() => { ui.patchHelped = false; renderDock(); })()"); time.sleep(0.2)
    check("the three steps until Got it", pg.locator(".pcoach").count() == 1 and "Drag fixtures" in pg.locator(".pcoach").inner_text())
    pg.locator(".pcoach button", has_text="How patching works").click(); time.sleep(0.2)
    hp = pg.locator(".modal.phelp")
    check("How patching works: the steps, and a table from what the device's page looks like to the mode", hp.count() == 1 and hp.locator(".pways tr").count() == 8 and "Pixels · Manual" in hp.inner_text() and "Advatek (Automatic Sequential Channels off)" in hp.inner_text())
    hp.locator(".btn.primary").click(); time.sleep(0.1)
    pg.locator(".pcoach button", has_text="Got it").click(); time.sleep(0.2)
    check("Got it: gone, and kept for next time", pg.locator(".pcoach").count() == 0 and ev("JSON.parse(localStorage.getItem('noupix.ui')).patchHelped") is True)

    # ---------- DDP
    ev("(() => { const c = project.controllers[1]; c.protocol = 'ddp'; ensureChains(c); ui.selCtrl = c.id; markPatch(); commit(); renderAll(); })()"); time.sleep(0.2)
    check("DDP: Pixels or Manual (it has no universes)", pg.locator(".ctrl-fields .seg button", has_text="Universes").count() == 0 and pg.locator(".ctrl-fields .seg button", has_text="Manual").count() == 1
          and pg.locator(".ctrl-fields .seg button", has_text="Next ch").count() == 0)

    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
  bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
