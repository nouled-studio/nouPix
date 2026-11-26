# Patching a controller as its device is set up, through the Patch tab as it is drawn: the patch mode (Unis, Pix, Man)
# on the device's line; by universes per output (Same for all, or each output its own; each output's start universe and
# channel typed, the ones after following it), by pixels per output (Next ch, Next uni, or each start typed, with Follow
# and New U; an Advatek's whole table), manual (one list of fixtures, each with its own universe and channel; one moved,
# the others stay; a clash said; the next free address; the Inspector). Dropping on an output (above or below a fixture,
# at the end), on a controller in the list; the bin on a controller's name; Skip ch 511–512 always there; Counts from in
# Output settings; makers set up when Discovery adds them (Advatek, ENTTEC, WLED by pixels only); the pixel type asked
# when it doesn't match; tunable white to the bytes; files and their repair; the help; DDP; a narrow window.
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
    ev("(() => { olm.loadProject(demoProject()); ui.dockTab = 'patch'; ui.dockH = 460; ui.dockCollapsed = false; ui.patchHelped = true; renderAll(); })()")
    time.sleep(0.4)
    C = "project.controllers[0]"
    outs = lambda c=C: ev(f"ctrlOuts({c}).map(L => L.list ? L.list.join('/') : L.base + '+' + L.upo)")
    starts = lambda c=C: ev(f"ctrlOuts({c}).map(L => L.base + '.' + (L.start + 1))")
    addr = lambda name: ev(f"(() => {{ ensurePatch(); const f = project.fixtures.find(f => f.name === {json.dumps(name)}); return f && f._patch ? addrText(f._patch) : ''; }})()")
    first = lambda name: ev(f"(() => {{ ensurePatch(); const p = project.fixtures.find(f => f.name === {json.dumps(name)})._patch; return p.base * 512 + p.first; }})()")
    chain = lambda o=0, c=C: ev(f"{c}.chains[{o}].map(id => fxById(id).name)")
    fill = lambda sel, v: (pg.locator(sel).first.fill(str(v)), pg.locator(sel).first.press("Enter"), time.sleep(0.15))
    modeBtn = lambda word: pg.locator(f".ctrl-fields button[aria-label='{word}']")

    # ---------- nothing changes for a project from before
    saved = ev(f"JSON.parse(serialize()).controllers[0]")
    check("a project from before: its outputs as before, and none of the new fields written",
          outs() == ['0+4', '4+4', '8+4', '12+4'] and not any(k in saved for k in ('same', 'upos', 'pxOuts', 'uniPlace', 'pxPlace', 'outStarts', 'outUnis', 'uniAt', 'outAt', 'from1', 'maker')), (outs(), list(saved)))
    check("the device's line: on, name, address, protocol and the patch mode (Unis, Pix, Man) with its i",
          modeBtn("Universes").count() == 1 and modeBtn("Pixels").count() == 1 and modeBtn("Manual").count() == 1 and "on" in (modeBtn("Universes").get_attribute("class") or "")
          and [t.strip() for t in pg.locator(".ctrl-fields .seg.icons button").all_inner_texts()] == ["Unis", "Pix", "Man"] and pg.locator(".ctrl-fields .pinfo").count() == 1)
    check("…the outputs as a sentence: 4 outputs × 4 universes, Same for all ticked; Skip ch 511–512 there; no Counts from here",
          pg.locator("input[aria-label='Outputs']").input_value() == "4" and pg.locator("input[aria-label='Universes per output']").input_value() == "4"
          and pg.locator("#ctrlSame").is_checked() and pg.locator("#ctrlSkip").count() == 1 and "Counts from" not in pg.locator("#dockBody").inner_text())
    check("…the bin on the controller's name in the list, not on its settings", pg.locator(".ctrl .cdel").count() == 1 and pg.locator(".ctrl-edit .trash").count() == 0)

    # ---------- Universes, each output its own count (DiGidot: 4, 4, 3, 3)
    pg.click("#ctrlSame"); time.sleep(0.2)
    check("Same for all off: each output's own count on its line, starting from the one for all; the count for all shown empty",
          ev(f"{C}.same") is False and ev(f"{C}.upos") == [4, 4, 4, 4] and pg.locator("input[aria-label='OUT 4 universes']").count() == 1
          and pg.locator("input[aria-label='Universes per output']").count() == 0)
    fill("input[aria-label='OUT 3 universes']", 3); fill("input[aria-label='OUT 4 universes']", 3)
    check("OUT 3 with 3 universes: OUT 4 starts on 11, as on the DiGidot", outs() == ['0+4', '4+4', '8+3', '11+3'], outs())
    check("…and the Rings (OUT 3) and Wave (OUT 4) follow", addr("Ring 1").startswith("U 8") and addr("Wave").startswith("U 11"), (addr("Ring 1"), addr("Wave")))
    h0 = ev("hist.idx")
    pg.click("#ctrlSame"); time.sleep(0.2)
    check("Same for all on again: the one for all as it was, one step of undo", outs() == ['0+4', '4+4', '8+4', '12+4'] and ev("hist.idx") == h0 + 1, outs())
    pg.click("#ctrlSame"); time.sleep(0.2)
    check("…and off again: each output's own counts as they were, nothing lost", outs() == ['0+4', '4+4', '8+3', '11+3'], outs())

    # ---------- Universes: each output's start typed (ENTTEC), the ones after following it
    check("each output's start universe and channel on its head, with ▴ ▾", pg.locator("input[aria-label='OUT 2 start universe']").input_value() == "4"
          and pg.locator("button[aria-label='Up: OUT 2 start universe']").count() == 1)
    fill("input[aria-label='OUT 2 start universe']", 20)
    check("OUT 2 from universe 20: the Strips go there, OUT 3 and 4 follow it, OUT 1 stays", outs() == ['0+4', '20+4', '24+3', '27+3'] and addr("Strip 1").startswith("U 20"), (outs(), addr("Strip 1")))
    pg.click("button[aria-label='Up: OUT 3 start universe']"); time.sleep(0.2)
    check("▴ on OUT 3: 25, and OUT 4 follows it", outs() == ['0+4', '20+4', '25+3', '28+3'], outs())
    fill("input[aria-label='OUT 2 start channel']", 100)
    check("a start channel typed: OUT 2 starts at U 20 ch 100", starts()[1] == '20.100', starts())
    fill("input[aria-label='OUT 1 start universe']", 2)
    check("OUT 1's start is the controller's own", ev(f"{C}.startUniverse") == 2 and outs()[0] == '2+4', outs())
    ev(f"(() => {{ const c = {C}; delete c.uniAt; c.startUniverse = 0; delete c.same; delete c.upos; markPatch(); commit(); renderAll(); }})()"); time.sleep(0.2)

    # ---------- dropping on an output: above a fixture, below it, at the end
    ev("(() => { const c = project.controllers[0]; for (const n of ['Ring 2', 'Ring 3']) unassign(project.fixtures.find(f => f.name === n).id); markPatch(); commit(); renderAll(); })()"); time.sleep(0.2)
    def drop(fname, row_name, frac):
        return ev("""([fname, row_name, frac]) => {
          const id = project.fixtures.find(f => f.name === fname).id, row = [...document.querySelectorAll('#dockBody .prow')].find(r => fxById(r.dataset.id).name === row_name);
          const r = row.getBoundingClientRect(), dt = new DataTransfer(); dt.setData('text/plain', 'fx:' + id);
          const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 60, clientY: r.top + r.height * frac };
          row.dispatchEvent(new DragEvent('dragover', o)); const mark = row.classList.contains('dropafter') ? 'after' : row.classList.contains('dropat') ? 'before' : '';
          row.dispatchEvent(new DragEvent('drop', o)); return mark; }""", [fname, row_name, frac])
    out3 = chain(2)
    m = drop("Ring 2", out3[-1], 0.8); time.sleep(0.4)
    check("dropped on the lower half of an output's last fixture: the line under it, and it goes at the end", m == "after" and chain(2) == out3 + ["Ring 2"], (m, chain(2)))
    m = drop("Ring 3", out3[0], 0.2); time.sleep(0.4)
    check("…on the upper half of the first: the line over it, and it goes first", m == "before" and chain(2)[0] == "Ring 3", (m, chain(2)))

    # ---------- Pixels: Next ch, Next uni (SpiNode, a DiGidot by pixels)
    modeBtn("Pixels").click(); time.sleep(0.2)
    check("Pix: the pixel type beside the count, and Next out: Next ch, Next uni, Manual", pg.locator("select[aria-label='Pixel type']").count() == 1
          and [t.strip() for t in pg.locator(".ctrl-line .seg button").filter(has_text="Next").all_inner_texts()][:2] == ["Next ch", "Next uni"])
    ev(f"(() => {{ const c = {C}; c.chPx = 4; c.same = false; c.pxOuts = [437, 437, 331, 331]; markPatch(); commit(); renderDock(); }})()"); time.sleep(0.2)
    check("Next ch (as before): RGBW 437 px take 3 universes and 212 channels, the next going on in that universe", starts() == ['0.1', '3.213', '6.425', '9.213'], starts())
    pg.locator(".ctrl-line .seg button", has_text="Next uni").click(); time.sleep(0.2)
    check("Next uni: each output on channel 1 of a new one, the DiGidot's 0, 4, 8, 11", starts() == ['0.1', '4.1', '8.1', '11.1'], starts())
    check("Skip ch 511–512 still there with RGBW pixels", pg.locator("#ctrlSkip").count() == 1)

    # ---------- the pixel type asked when fixtures don't match
    ev("(() => { const c = project.controllers[0]; const f = project.fixtures.find(f => f.name === 'Wave'); unassign(f.id); markPatch(); commit(); renderAll(); })()"); time.sleep(0.2)
    pg.drag_and_drop("#fxList li:has-text('Wave')", ".outrow .outhead >> nth=0"); time.sleep(0.4)
    pt = pg.locator(".modal[aria-label='Pixel type']")
    check("an RGB fixture dropped on an RGBW output: asked which to change", pt.count() == 1 and "RGBW" in pt.inner_text(), pt.inner_text() if pt.count() else "")
    if pt.count(): pt.locator("button", has_text="Leave").first.click(); time.sleep(0.2)

    # ---------- Pixels, typed (Advatek without Automatic Sequential Channels), counting from 1
    ev("""(() => { const c = newController({ name: 'PixLite 16', ip: '10.0.0.40', mode: 'pixels', outputs: 16, chPx: 3, startUniverse: 0, from1: true }); project.controllers.push(c);
      ui.selCtrl = c.id; markPatch(); commit(); renderAll(); })()"""); time.sleep(0.3)
    P = "ctrlById(ui.selCtrl)"
    pg.click("#ctrlSame"); time.sleep(0.2)
    for i, v in enumerate([209, 302, 396, 491, 583] + [400] * 11):
        fill(f"input[aria-label='OUT {i + 1} pixels']", v)
    ends = lambda: ev(f"ctrlOuts({P}).map(L => (L.base + 1) + '.' + (L.start + 1) + '-' + (L.base + Math.floor((L.end - 1) / 512) + 1) + '.' + ((L.end - 1) % 512 + 1))")
    check("Next ch (Automatic Sequential Channels): the Advatek's own start and end of outputs 1 to 5, counted from 1",
          ends()[:5] == ['1.1-2.117', '2.118-4.3', '4.4-6.171', '6.172-9.114', '9.115-12.333'] and pg.locator("input[aria-label='Start universe']").input_value() == "1", ends()[:5])
    pg.locator(".ctrl-line .seg button", has_text="Manual").click(); time.sleep(0.2)
    check("Next out Manual: each output's start on its line, filled from where it was; Follow and New U from OUT 2 on",
          ends()[:5] == ['1.1-2.117', '2.118-4.3', '4.4-6.171', '6.172-9.114', '9.115-12.333']
          and pg.locator(".outrow").nth(1).locator(".octl button", has_text="Follow").count() == 1 and pg.locator(".outrow").nth(0).locator(".octl button").count() == 0)
    fill("input[aria-label='OUT 6 start universe']", 16); fill("input[aria-label='OUT 6 start channel']", 1)
    for o in range(6, 16):
        pg.locator(".outrow").nth(o).locator(".octl button", has_text="New U").click(); time.sleep(0.03)
    time.sleep(0.2)
    adv = ['1.1-2.117', '2.118-4.3', '4.4-6.171', '6.172-9.114', '9.115-12.333'] + [f"{u}.1-{u + 2}.180" for u in range(16, 47, 3)]
    check("OUT 6 typed at 16 and New U on the rest: the Advatek's whole table, as it shows it", ends() == adv, ends())
    pg.locator(".outrow").nth(1).locator(".octl button", has_text="Follow").click(); time.sleep(0.1)
    check("Follow: right where the output before ends", ends()[1] == '2.118-4.3', ends()[1])

    # ---------- Counts from, in Output settings
    pg.click("#btnOutSet"); time.sleep(0.3)
    un = pg.locator(".modal .outset .unum")
    check("Output settings: Universe numbers, From 0 or From 1 for each Art-Net controller", un.count() == 2 and "PixLite 16" in un.nth(1).inner_text()
          and "on" in (un.nth(1).locator("button", has_text="From 1").get_attribute("class") or ""))
    un.nth(1).locator("button", has_text="From 0").click(); time.sleep(0.2)
    check("…From 0: shown from 0, nothing sent moves", ev(f"{P}.from1") is None and pg.locator("input[aria-label='OUT 6 start universe']").input_value() == "15" and ends()[5] == '16.1-18.180', ends()[5])
    pg.locator(".modal .outset .unum").nth(1).locator("button", has_text="From 1").click(); time.sleep(0.2)
    pg.locator(".modal footer button", has_text="Done").click(); time.sleep(0.2)

    # ---------- dropping a fixture on a controller in the list
    ev("(() => { unassign(project.fixtures.find(f => f.name === 'Wave').id); markPatch(); commit(); renderAll(); })()"); time.sleep(0.2)
    pg.drag_and_drop("#fxList li:has-text('Wave')", ".ctrl-list .ctrl >> nth=1"); time.sleep(0.3)
    check("a fixture dropped on a controller in the list: at the end of its OUT 1", ev("(() => { const p = project.fixtures.find(f => f.name === 'Wave')._patch; return p.ctrl.name + ' ' + p.out; })()") == "PixLite 16 0")
    ev("document.querySelectorAll('.modal-bg').forEach(b => b.remove())")

    # ---------- Manual
    ev(f"(() => {{ const c = {C}; c.mode = 'universes'; c.chPx = 3; delete c.same; delete c.pxOuts; delete c.pxPlace; ensureChains(c); ui.selCtrl = c.id; markPatch(); commit(); renderAll(); }})()"); time.sleep(0.3)
    before = {n: addr(n) for n in ("Panel A", "Strip 2", "Ring 3")}
    modeBtn("Manual").click(); time.sleep(0.3)
    check("into Manual: every fixture keeps its address, and is listed with its own universe and channel",
          all(addr(n) == before[n] for n in before) and pg.locator(".ctrl-edit .prow.man").count() == ev(f"{C}.chains[0].length")
          and pg.locator("input[aria-label='Strip 2 universe']").count() == 1 and "kept their addresses" in pg.locator(".toast").last.inner_text(), ({n: addr(n) for n in before}, before))
    check("…one list: no outputs, no universe blocks to unfold, no Address all in sequence, no Same for all",
          pg.locator(".outhead").count() == 0 and pg.locator("#ctrlSame").count() == 0 and pg.locator("#dockBody button", has_text="sequence").count() == 0)
    check("…every fixture has an address of its own", ev(f"{C}.chains[0].every(id => fxById(id).addr)"))
    check("…its badges show the address", ev("(() => { ensurePatch(); renderFxList(); return document.querySelector('#fxList li[data-id=\"' + project.fixtures.find(f => f.name === 'Strip 2').id + '\"] .badge').textContent; })()").startswith("A U"))
    others = {n: first(n) for n in ("Strip 3", "Strip 4", "Ring 1", "Ring 3")}
    fill("input[aria-label='Strip 2 universe']", 40)
    check("Strip 2 moved to U 40 on its row: it goes there, and no other fixture moves", addr("Strip 2").startswith("U 40") and {n: first(n) for n in others} == others, ({n: first(n) for n in others}, others))
    ch0 = ev("project.fixtures.find(f => f.name === 'Strip 2').addr.ch")
    pg.click("button[aria-label='Up: Strip 2 channel']"); time.sleep(0.2)
    check("…▴ on its channel: one channel on", ev("project.fixtures.find(f => f.name === 'Strip 2').addr.ch") == ch0 + 1, ev("project.fixtures.find(f => f.name === 'Strip 2').addr"))
    pa = ev("project.fixtures.find(f => f.name === 'Panel A').addr")
    fill("input[aria-label='Strip 3 universe']", pa["u"]); fill("input[aria-label='Strip 3 channel']", pa["ch"])
    check("Strip 3 typed onto Panel A's channels: a short warning, both red, nothing else moves",
          "shares channels with Panel A" in pg.locator(".toast").last.inner_text() and pg.locator(".ctrl-edit .prow.ovf").count() >= 2 and first("Ring 3") == others["Ring 3"])
    # a new one comes to the next free address
    ev("(() => { const f = newFixture('line', { id: 'NEW', name: 'Extra', x1: 100, y1: 600, x2: 300, y2: 600, pixels: 100 }); project.fixtures.push(f); markGeom(); commit(); })()"); time.sleep(0.2)
    pg.drag_and_drop("#fxList li:has-text('Extra')", ".outrow.mlist1"); time.sleep(0.3)
    nf = ev("fxById('NEW').addr")
    top = ev("Math.max(...project.controllers[0].chains[0].filter(id => id !== 'NEW').map(id => { const p = fxById(id)._patch; return p.base * 512 + p.last; }))")
    nxt = top + 1 if (top + 1) % 512 + 300 <= 512 else ((top + 1) // 512 + 1) * 512
    check("a fixture dropped on the list takes the next free address: right after the last channel used (on the next universe when it wouldn't fit)",
          nf and nf['u'] * 512 + nf['ch'] - 1 == nxt, (nf, top))
    # the Inspector: its address, Next free
    ev("(() => { ui.sel = new Set(['NEW']); onSelection(); renderRight(); })()"); time.sleep(0.3)
    ins = pg.locator("#rightBody")
    check("the Inspector on a manual fixture: no Output, its universe and channel, Next free", ins.locator("select[aria-label='Output']").count() == 0
          and ins.locator("input[aria-label='Universe']").count() == 1 and ins.locator("button", has_text="Next free").count() == 1)
    u = ins.locator("input[aria-label='Universe']"); u.fill("300"); u.press("Enter"); time.sleep(0.2)
    check("…a universe typed there moves it, and nothing else", ev("fxById('NEW').addr.u") == 300 and first("Ring 3") == others["Ring 3"])
    # out and back
    pg.click(".ctrl-fields button[aria-label='Universes']"); time.sleep(0.3)
    check("out of Manual: all on OUT 1 in the order of their addresses, with a word on it", ev("project.controllers[0].chains.slice(1).every(c => !c.length)")
          and "order of their addresses" in pg.locator(".toast").last.inner_text() and ev("project.fixtures.every(f => !f.addr)"))
    ev("undo()"); time.sleep(0.3); ev("(() => { ensurePatch(); renderAll(); })()")
    check("…undone: manual again, the addresses back", ev("project.controllers[0].mode") == "manual" and ev("fxById('NEW').addr.u") == 300)

    # ---------- the bin on a controller's name
    pg.locator(".ctrl").nth(1).hover(); pg.locator(".ctrl").nth(1).locator(".cdel").click(); time.sleep(0.2)
    dm = pg.locator(".modal:has-text('Delete')")
    check("the bin on a controller's name asks first", dm.count() == 1 and ev("project.controllers.length") == 2)
    dm.locator("button.danger").click(); time.sleep(0.2)
    check("…and deletes that one", ev("project.controllers.length") == 1 and ev("project.controllers[0].name") != "PixLite 16")
    ev("undo()"); time.sleep(0.2)

    # ---------- makers, as Discovery adds them
    ev("addNodeAsController({ ip: '10.0.0.77', shortName: 'Pixelator', longName: 'ENTTEC Pixelator Mini', universes: [0, 1, 2, 3] })"); time.sleep(0.3)
    ways = pg.locator(".modal.choose .way b").all_inner_texts()
    check("an ENTTEC added: asked Unis or Pix · Next uni, no Counts from 1", [w.upper() for w in ways] == ["UNIS", "PIX · NEXT UNI"] and not ev("project.controllers.at(-1).from1"), ways)
    pg.locator(".modal.choose .way").nth(1).click(); time.sleep(0.2)
    check("…Pix · Next uni chosen", ev("(() => { const c = project.controllers.at(-1); return c.mode + ' ' + c.pxPlace; })()") == "pixels universe")
    ev("addWledAsController({ ip: '10.0.0.78', shortName: 'WLED-Strip', universes: [], wled: { proto: 'sacn', leds: 120, chPx: 3, universe: 0, address: 1, receiving: true, pixels: true } })"); time.sleep(0.3)
    check("a WLED: by pixels, and Pix its only patch mode", ev("project.controllers.at(-1).mode") == "pixels" and pg.locator(".ctrl-fields .seg.icons button").count() == 1)
    ev("(() => { const c = project.controllers.at(-1); c.mode = 'universes'; fixOutputPlan(c); })()")
    check("…a file with a WLED on universes is put back on pixels", ev("project.controllers.at(-1).mode") == "pixels")

    # ---------- tunable white, to the bytes
    ev("""(() => { const c = project.controllers.at(-1); c.protocol = 'artnet'; c.chPx = 2;
      const f = newFixture('line', { id: 'TW', name: 'Tunable', x1: 20, y1: 30, x2: 200, y2: 30, pixels: 4, order: 'WC' }); project.fixtures.push(f);
      assign('TW', c, 0); markGeom(); markPatch(); commit(); })()"""); time.sleep(0.3)
    tw = lambda rgb: ev(f"""(() => {{ ensurePatch(); const f = fxById('TW'); f._col.set([].concat(...Array(4).fill({rgb}))); buildOutput(); const o = f._out, L = o.lin[0]; return [o.unis[L >> 9].data[L & 511], o.unis[(L + 1) >> 9].data[(L + 1) & 511]]; }})()""")
    check("tunable white: white lights warm and cold full, red the warm alone, blue the cold alone",
          tw("[255, 255, 255]") == [255, 255] and tw("[255, 0, 0]")[1] == 0 and tw("[255, 0, 0]")[0] == 255 and tw("[0, 0, 255]")[0] == 0 and tw("[0, 0, 255]")[1] == 255,
          [tw("[255, 255, 255]"), tw("[255, 0, 0]"), tw("[0, 0, 255]")])

    # ---------- files: kept, and repaired
    data = ev("serialize()")
    ev(f"olm.loadProject(hydrate(JSON.parse({json.dumps(data)})))"); time.sleep(0.3)
    px16 = ev("project.controllers.find(c => c.name === 'PixLite 16')")
    check("a file keeps each controller's mode, counts, starts and Counts from", ev("project.controllers[0].mode") == "manual" and px16["pxPlace"] == "typed"
          and px16["outAt"][5] == {"u": 15, "ch": 1} and px16["from1"] is True and px16["pxOuts"][4] == 583 and ev("fxById('NEW').addr.u") == 300, px16.get("outAt"))
    bad = json.loads(data)
    k = next(i for i, c in enumerate(bad['controllers']) if c['name'] == 'PixLite 16')
    bad['controllers'][k].update({'pxPlace': 'sideways', 'outAt': 'nope', 'same': 'maybe', 'upos': [0, 200, 'x'], 'outUnis': [[1, -4, 99999, 'q', 3]], 'uniPlace': 'each', 'mode': 'weird', 'maker': 'acme'})
    ev(f"olm.loadProject(hydrate({json.dumps(bad)}))"); time.sleep(0.3)
    c1 = ev(f"JSON.parse(JSON.stringify(project.controllers[{k}], replacer))")
    check("a file with nonsense in them: repaired (an unknown mode is Universes, wrong values go or come in range)",
          c1['mode'] == 'universes' and 'pxPlace' not in c1 and 'outAt' not in c1 and 'same' not in c1 and c1['upos'] == [1, 64, c1['upo']] and c1.get('uniPlace') in (None, 'order') and 'maker' not in c1, c1)

    # ---------- the help
    ev("(() => { ui.selCtrl = project.controllers[0].id; ui.patchHelped = false; renderDock(); })()"); time.sleep(0.2)
    check("the three steps until Got it", pg.locator(".pcoach").count() == 1 and "Drag fixtures" in pg.locator(".pcoach").inner_text())
    pg.locator(".ctrl-fields .pinfo").click(); time.sleep(0.2)
    hp = pg.locator(".modal.phelp")
    check("the i: Patch mode, the three modes with examples of devices", hp.count() == 1 and hp.locator(".pmode").count() == 3 and "Advatek" in hp.inner_text() and "WLED" in hp.inner_text() and "Output settings" in hp.inner_text())
    hp.locator(".btn.primary").click(); time.sleep(0.1)
    pg.locator(".pcoach button", has_text="Got it").click(); time.sleep(0.2)
    check("Got it: gone, and kept for next time", pg.locator(".pcoach").count() == 0 and ev("JSON.parse(localStorage.getItem('noupix.ui')).patchHelped") is True)
    pg.hover(".skiprow .info"); time.sleep(0.6)
    check("Skip ch 511–512's i explains it on pointing", "511 and 512" in ev("[...document.querySelectorAll('.tip')].filter(t => !t.hidden).map(t => t.textContent).join(' ')"))

    # ---------- DDP
    ev("(() => { const c = project.controllers.find(c => c.name === 'PixLite 16'); c.protocol = 'ddp'; ensureChains(c); ui.selCtrl = c.id; markPatch(); commit(); renderAll(); })()"); time.sleep(0.2)
    check("DDP: Pix or Man (it has no universes), no Next ch, no Skip", modeBtn("Universes").count() == 0 and modeBtn("Manual").count() == 1
          and pg.locator(".ctrl-line .seg button", has_text="Next ch").count() == 0 and pg.locator("#ctrlSkip").count() == 0)

    # ---------- a narrow window
    for w in (1200, 900):
        pg.set_viewport_size({"width": w, "height": 900}); time.sleep(0.4)
        for cid in ev("project.controllers.map(c => c.id)"):
            ev(f"(() => {{ ui.selCtrl = {json.dumps(cid)}; renderDock(); }})()"); time.sleep(0.15)
            over = ev("(() => { const e = document.querySelector('.ctrl-edit'); return [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > e.getBoundingClientRect().right + 1 && x.offsetParent).map(x => x.className || x.tagName).slice(0, 3); })()")
            if over: break
        check(f"{w} px wide: nothing in the controller's settings runs past its edge", not over, over)

    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
  bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
