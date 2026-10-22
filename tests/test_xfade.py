# The crossfader: one fader sets the levels of two zones, A at 1 - x and B at x. The light stays even across the fade
# where the two overlap; nothing else sets those two levels while it is on (sliders, MIDI, devices); a MIDI control can
# drive it, on or off; the Scenes panel shows it with A's and B's previews; files, undo and devices keep it.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8204
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
rid = lambda: os.urandom(4).hex()
def solid(c): return {"id": rid(), "src": "b-solid", "params": {"b-solid": {"color": c + [1]}}, "opacity": 1, "blend": "alpha", "on": True}
def zone(zid, name, x, y, w, h, color, opacity=1):
    return {"id": zid, "name": name, "x": x, "y": y, "w": w, "h": h, "opacity": opacity, "layers": [solid(color)], "scenes": [], "scene": None}
def proj(zones, xfade=None):
    # a line of 5 pixels across the canvas, at x = 20, 110, 200, 290, 380
    fx = [{"id": "f1", "type": "line", "name": "L", "x1": 20, "y1": 100, "x2": 380, "y2": 100, "pixels": 5}]
    p = {"name": "X", "settings": {"compW": 400, "compH": 200, "transition": 0, "gamma": 1}, "fixtures": fx, "controllers": [], "zones": zones}
    if xfade: p["xfade"] = xfade
    return p

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    load = lambda p: (ev("p => olm.loadProject(p)", p), time.sleep(0.4))
    px = lambda i: ev(f"Array.from(olm.project.fixtures[0]._col.slice({3 * i}, {3 * i + 3}))")
    near = lambda a, b, t=2: all(abs(x - y) <= t for x, y in zip(a, b))
    def at(x): ev(f"setXfade({x})"); time.sleep(0.25)
    levels = lambda: ev("project.zones.map(z => Math.round(z.opacity * 1000) / 1000)")

    # ---------- the mix: two zones in the same place, red below and blue above
    load(proj([zone("zr", "Red", 0, 0, 400, 200, [1, 0, 0]), zone("zb", "Blue", 0, 0, 400, 200, [0, 0, 1])]))
    check("off at first, and nothing changes", ev("project.xfade.on") is False and levels() == [1, 1] and px(2) == [0, 0, 255], (ev("project.xfade"), levels(), px(2)))
    ev("project.xfade.x = 0; setXfadeOn(true)"); time.sleep(0.3)
    X = ev("project.xfade")
    check("on: A and B are the first two zones, A at 100% and B at 0%", X["on"] and X["a"] == "zr" and X["b"] == "zb" and levels() == [1, 0] and px(2) == [255, 0, 0], (X, levels(), px(2)))
    at(0.5)
    check("in the middle each is at 50%, and the light stays even (not darker)", levels() == [0.5, 0.5] and near(px(2), [128, 0, 127]), (levels(), px(2)))
    at(0.25)
    check("a quarter of the way: 75% red, 25% blue", levels() == [0.75, 0.25] and near(px(2), [191, 0, 64]), (levels(), px(2)))
    at(1)
    check("all the way: only B", levels() == [0, 1] and px(2) == [0, 0, 255], (levels(), px(2)))
    # A above B: the same mix
    ev("setXfadeZone('a', 'zb')"); time.sleep(0.2)
    X = ev("project.xfade")
    check("choosing B's zone for A swaps them", X["a"] == "zb" and X["b"] == "zr", X)
    at(0.25)
    check("with A the upper zone, the same even mix: A (blue) at 75%, B (red) at 25%", levels() == [0.25, 0.75] and near(px(2), [64, 0, 191]), (levels(), px(2)))

    # ---------- zones that overlap in part: even where they overlap, the lower one fades alone elsewhere
    load(proj([zone("za", "A", 0, 0, 400, 200, [1, 0, 0]), zone("zb", "B", 0, 0, 200, 200, [0, 0, 1])], {"on": True, "a": "za", "b": "zb", "x": 0.5}))
    check("a file with the crossfader on opens with it on", ev("project.xfade.on") is True and ev("!!xfZones()"))
    at(0.5)
    check("partial overlap: half and half where both are, A alone at 50% elsewhere", near(px(0), [128, 0, 127]) and near(px(4), [128, 0, 0]), (px(0), px(4)))

    # ---------- nothing else sets A's or B's level while it is on
    at(0.3)
    ev("setZoneOpacity(zoneById('za'), 1)")
    check("a zone's own slider can't set it", levels() == [0.7, 0.3], levels())
    ev("remoteFromDevice('c1', 'remote', { op: 'opacity', zone: 'za', value: 1 })")
    check("nor a device", levels() == [0.7, 0.3], levels())
    ev("remoteFromDevice('c1', 'operator', { op: 'xfade', value: 0.6 })")
    check("a device can move the crossfader", ev("project.xfade.x") == 0.6 and levels() == [0.4, 0.6], (ev("project.xfade.x"), levels()))
    ev("remoteFromDevice('c1', 'operator', { op: 'xfade', value: 7 })")
    check("and it stays in range", ev("project.xfade.x") == 1, ev("project.xfade.x"))
    st = ev("remoteState().zones.map(z => [z.id, z.xf])")
    check("the phones are told which levels the crossfader sets", sorted(st) == [["za", True], ["zb", True]], st)
    co = ev("JSON.parse(contentOf(JSON.stringify(Object.assign(JSON.parse(serialize(false)), { xfade: { on: false, a: 'za', b: 'zb', x: 0.2 } })))).xfade")
    check("an operator's copy brings its crossfader in", co["on"] is False and co["x"] == 0.2, co)

    # ---------- MIDI: a level mapped to A is ignored while it is on; the crossfader can be mapped, on or off
    ev("""(() => { project.midi.maps = [Object.assign(newMidiMap('midi:P:1:cc:7', 'z:za'), { takeover: 'jump' }), Object.assign(newMidiMap('midi:P:1:cc:8', 'xf'), { takeover: 'jump' })]; })()""")
    cc = lambda num, val: ev(f"midiIn({{ port: 'P', ch: 1, type: 'cc', num: {num}, val: {val} }})")
    at(0.5); cc(7, 127)
    check("a MIDI fader on A's level does nothing while the crossfader is on", levels() == [0.5, 0.5], levels())
    check("and says so", "crossfader" in ev("midiTargetLabel('z:za')"), ev("midiTargetLabel('z:za')"))
    cc(8, 0)
    check("a MIDI fader on the crossfader moves it and both levels", ev("project.xfade.x") == 0 and levels() == [1, 0], (ev("project.xfade.x"), levels()))
    cc(8, 127)
    check("all the way to B", ev("project.xfade.x") == 1 and levels() == [0, 1], levels())
    ev("setXfadeOn(false)"); time.sleep(0.2)
    check("off: the zones keep the levels it gave them", ev("project.xfade.on") is False and levels() == [0, 1], levels())
    cc(7, 127)
    check("off: the MIDI fader on A's level works again", levels() == [1, 1], levels())
    cc(8, 0)
    check("off: the crossfader still moves from MIDI, but sets no level", ev("project.xfade.x") == 0 and levels() == [1, 1], (ev("project.xfade.x"), levels()))
    sel = ev("(() => { const s = midiTargetSelect({ id: 'w', key: 'midi:P:1:cc:9', to: '' }); return [...s.options].some(o => o.value === 'xf' && o.textContent === 'Crossfader'); })()")
    check("the crossfader is in the list of what a MIDI control can drive, while off", sel and ev("midiTargetLabel('xf')") == "Crossfader")
    check("A's level is a target like before once it is off", ev("midiTargetLabel('z:za')") == "A level", ev("midiTargetLabel('z:za')"))

    # ---------- the Scenes panel
    load(proj([zone("z1", "Zone 1", 0, 0, 400, 200, [1, 0, 0]), zone("z2", "Zone 2", 0, 0, 400, 200, [0, 1, 0]), zone("z3", "Zone 3", 0, 0, 100, 100, [0, 0, 1])]))
    ev("(() => { ui.dockTab = 'scenes'; ui.dockCollapsed = false; renderDock(); })()"); time.sleep(0.2)
    check("the Crossfader button is at the bottom right of the Scenes panel, no strip while off", pg.locator("#dockBody .sfoot .sbtns .xfbtn").count() == 1 and pg.locator(".xfade").count() == 0)
    check("no hints and no fade field at the top of the panel any more", pg.locator("#dockBody .scenepanel .bar").count() == 0 and "Shift-click" not in pg.locator("#dockBody").inner_text())
    ev("(() => { ui.rightTab = 'settings'; showRight(true); renderRight(); })()"); time.sleep(0.2)
    fr = pg.locator("#rightBody .row:has-text('Fade for new scenes') input")
    check("the fade for new scenes is in Settings, under Scenes", fr.count() == 1 and float(fr.input_value()) == 2)
    fr.fill("3.5"); fr.press("Enter"); time.sleep(0.2)
    check("and sets it", ev("project.settings.fade") == 3.5, ev("project.settings.fade"))
    pg.click("#dockBody .xfbtn"); time.sleep(0.6)
    X = ev("project.xfade")
    check("the button turns it on and shows the strip", X["on"] and pg.locator(".xfade").count() == 1 and "on" in pg.get_attribute("#dockBody .xfbtn", "class"), X)
    check("both zones already cover the canvas: no advice", pg.locator(".modal[aria-label=Crossfader]").count() == 0)
    a, b = pg.locator("#dockBody .xfade").bounding_box(), pg.locator("#dockBody .scenepanel").bounding_box()
    check("the strip is in the middle of the panel", abs((a["x"] + a["width"] / 2) - (b["x"] + b["width"] / 2)) < 3, (a, b))
    dis = ev("[...$$('#dockBody [data-zone-op]')].map(r => [r.dataset.zoneOp, r.disabled])")
    check("A's and B's level sliders are greyed, the others not", sorted(dis) == [["z1", True], ["z2", True], ["z3", False]], dis)
    tags = ev("[...$$('#dockBody .xftag')].map(t => t.textContent).sort()")
    check("their zones show A and B", tags == ["A", "B"], tags)
    w = pg.locator("[data-xf]").bounding_box()
    check("the fader is short", w["width"] <= 200, w["width"])
    pg.mouse.click(w["x"] + w["width"] * 0.75, w["y"] + w["height"] / 2); time.sleep(0.3)
    x = ev("project.xfade.x")
    check("dragging the fader moves the levels", 0.6 < x < 0.9 and abs(levels()[0] - (1 - x)) < 1e-9 and abs(levels()[1] - x) < 1e-9, (x, levels()))
    pct = ev("[...$$('#dockBody .xfade [data-zone-pct]')].map(e => e.textContent)")
    check("the percentages under the zones follow", pct == [f"{round((1 - x) * 100)}%", f"{round(x * 100)}%"], pct)
    ev("setXfade(0.2)")
    check("the fader follows a MIDI control or a device", abs(float(pg.locator("[data-xf]").input_value()) - 0.2) < 1e-9)
    time.sleep(0.5)
    lit = ev("[...$$('#dockBody canvas[data-xf-pv]')].map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return [c.dataset.xfPv, c.width, c.height, d[0], d[1], d[2]]; })")
    check("the previews show A (red) and B (green), at their zone's shape", lit == [["a", 96, 48, 255, 0, 0], ["b", 96, 48, 0, 255, 0]], lit)
    fit = ev("[...$$('#dockBody .xfpv')].map(f => { const c = f.querySelector('canvas').getBoundingClientRect(), r = f.getBoundingClientRect(); return [r.width - c.width, r.height - c.height, c.left - r.left, c.top - r.top]; })")
    check("each preview fills its frame exactly (the frame's 1 px border around it)", fit == [[2, 2, 1, 1], [2, 2, 1, 1]], fit)
    ev("setXfade(0)"); time.sleep(0.4)
    lit = ev("(() => { const c = $('#dockBody canvas[data-xf-pv=b]'), d = c.getContext('2d').getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; })()")
    check("B's preview shows it while it is faded out", lit == [0, 255, 0], lit)
    pg.select_option(".xfside.b .xfsel", "z3"); time.sleep(0.3)
    X = ev("project.xfade")
    dis = ev("[...$$('#dockBody [data-zone-op]')].map(r => [r.dataset.zoneOp, r.disabled])")
    check("choosing another zone for B frees the old one, at the level it had", X["b"] == "z3" and sorted(dis) == [["z1", True], ["z2", False], ["z3", True]] and levels() == [1, 0, 0], (X, dis, levels()))
    check("the fader can be learnt by touching it", pg.locator(".xfade [data-midi=xf]").count() == 1)
    menu = ev("(() => { zoneMenu({ clientX: 300, clientY: 300, preventDefault() {} }, zoneById('z3')); const b = [...$$('.menu button')].find(b => /^(Hide|Show)/.test(b.textContent)); const d = b && b.disabled; $$('.menu').forEach(m => m.remove()); return d; })()")
    check("the zone menu's Hide is off for A and B", menu is True, menu)

    # ---------- undo, files
    h0 = ev("hist.idx")
    ev("setXfadeOn(false)"); time.sleep(0.2)
    check("turning it off is a step of undo", ev("hist.idx") == h0 + 1 and pg.locator(".xfade").count() == 0)
    ev("undo()"); time.sleep(0.3)
    check("undo turns it back on, with the strip", ev("project.xfade.on") is True and pg.locator(".xfade").count() == 1)
    saved = ev("JSON.parse(serialize(false)).xfade")
    check("it is saved in the project", saved == ev("project.xfade"), saved)
    ev("olm.loadProject(JSON.parse(serialize(false)))"); time.sleep(0.3)
    check("and opens again the same", ev("project.xfade") == saved, ev("project.xfade"))
    load(dict(proj([zone("z1", "Zone 1", 0, 0, 400, 200, [1, 0, 0])]), xfade={"on": "yes", "a": 5, "b": None, "x": "nine"}))
    X = ev("project.xfade")
    check("a broken crossfader in a file is repaired", X == {"on": False, "a": "5", "b": "", "x": 0, "phone": False}, X)
    ev("(() => { ui.dockTab = 'scenes'; renderDock(); })()"); time.sleep(0.2)
    pg.click("#dockBody .xfbtn"); time.sleep(0.3)
    check("with one zone it stays off and says why", ev("project.xfade.on") is False and pg.locator(".toast").filter(has_text="two zones").count() >= 1)
    load(proj([zone("z1", "Zone 1", 0, 0, 400, 200, [1, 0, 0])]))
    check("a project without one opens with it off", ev("project.xfade") == {"on": False, "a": "", "b": "", "x": 0, "phone": False}, ev("project.xfade"))

    # ---------- turning it on with zones that don't cover the canvas: the advice, and doing it at once
    load(proj([zone("z1", "Zone 1", 0, 0, 400, 200, [1, 0, 0]), zone("z2", "Zone 2", 0, 0, 200, 200, [0, 1, 0])]))
    ev("(() => { ui.dockTab = 'scenes'; renderDock(); })()"); time.sleep(0.2)
    pg.click("#dockBody .xfbtn"); time.sleep(0.3)
    m = pg.locator(".modal[aria-label=Crossfader]")
    check("the advice: both zones should cover the whole canvas, and how (Z, the zone, the right panel)", m.count() == 1 and "Zone 2 doesn't yet" in m.inner_text() and "press Z" in m.inner_text() and ev("project.xfade.on") is True, m.inner_text() if m.count() else "")
    m.locator("button", has_text="Not now").click(); time.sleep(0.2)
    check("Not now closes it and changes nothing", m.count() == 0 and ev("zoneById('z2').w") == 200)
    ev("setXfadeOn(false)"); pg.click("#dockBody .xfbtn"); time.sleep(0.3)
    h0 = ev("hist.idx")
    m.locator("button", has_text="Make both full size").click(); time.sleep(0.3)
    check("Make both full size: both cover the canvas, one step of undo", ev("project.zones.map(z => [z.x, z.y, z.w, z.h])") == [[0, 0, 400, 200], [0, 0, 400, 200]] and ev("hist.idx") == h0 + 1 and m.count() == 0)

    # ---------- the Remote page: the crossfader there only when chosen in Settings
    check("the phones don't get it unless chosen", ev("remoteState().xfade") is None)
    ev("setXfade(0.25)")
    ev("remoteFromDevice('c1', 'remote', { op: 'xfade', value: 0.9 })")
    check("and a phone can't move it then", ev("project.xfade.x") == 0.25)
    ev("remoteFromDevice('c1', 'operator', { op: 'xfade', value: 0.3 })")
    check("an operator can", ev("project.xfade.x") == 0.3)
    RP = PORT + 1
    ev(f"(() => {{ remote.cfg = {{ on: true, port: {RP}, password: 'x' }}; remoteConfigure(); ui.rightTab = 'settings'; renderRight(); }})()")
    pg.wait_for_function("remote.status && remote.status.on", timeout=8000)
    time.sleep(0.3)
    cb = pg.locator("#remoteSec .checkrow:has-text('Crossfader on the Remote page') input")
    check("Settings → Remote control: Crossfader on the Remote page, off at first", cb.count() == 1 and not cb.is_checked())
    cb.check(); time.sleep(0.3)
    check("ticking it is saved in the project", ev("project.xfade.phone") is True and ev("JSON.parse(serialize(false)).xfade.phone") is True)
    st = ev("remoteState().xfade")
    check("the phones get it: A's and B's names and where it is", st == {"a": "Zone 1", "b": "Zone 2", "x": 0.3}, st)
    ph = br.new_page(viewport={"width": 390, "height": 800})
    ph.on("pageerror", lambda e: errs.append("phone: " + str(e)))
    ph.goto(f"http://127.0.0.1:{RP}/remote")
    ph.wait_for_function("document.querySelectorAll('.zone').length === 2 && !document.querySelector('#xfade').hidden", timeout=10000)
    check("the Remote page shows it above the zones, with A and B", ph.locator("#xfade .xa").inner_text() == "Zone 1" and ph.locator("#xfade .xb").inner_text() == "Zone 2" and int(ph.locator("#xfade input").input_value()) == 300)
    check("its zones' dimmers are greyed there", ph.evaluate("[...document.querySelectorAll('.zone .dim input')].every(r => r.disabled)"))
    r = ph.locator("#xfade input").bounding_box()
    ph.mouse.click(r["x"] + r["width"] * 0.8, r["y"] + r["height"] / 2)
    ok = True
    try: pg.wait_for_function("Math.abs(project.xfade.x - 0.8) < 0.03", timeout=5000)
    except Exception: ok = False
    check("moving it on the phone moves it on the computer, and both levels", ok and abs(levels()[1] - ev("project.xfade.x")) < 1e-9, (ev("project.xfade.x"), levels()))
    ev("setXfade(0.1); remoteChanged()")
    ok = True
    try: ph.wait_for_function("document.querySelector('#xfade input').value === '100'", timeout=5000)
    except Exception: ok = False
    check("and the phone follows the computer", ok, ph.locator("#xfade input").input_value())
    ev("setXfadeOn(false)")
    ok = True
    try: ph.wait_for_function("document.querySelector('#xfade').hidden", timeout=5000)
    except Exception: ok = False
    check("turned off, it goes from the phone", ok)
    ph.close()
    ev("(() => { remote.cfg.on = false; remoteConfigure(); })()")

    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED:", fails or "none")
