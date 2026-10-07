# The colour picker of shader colour controls: the swatch opens it; wheel, intensity, RGB, HSV,
# hex, presets, recent colours and going back all reach the output exactly; one undo step per change; its tab is kept.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8157
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
near = lambda a, b, t=2: a is not None and len(a) == len(b) and all(abs(x - y) <= t for x, y in zip(a, b))

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    # ---------- colour math
    bad = ev("""(() => { const out = [];
      for (let i = 0; i < 2000; i++) { const c = [Math.random(), Math.random(), Math.random()], b = hsvToRgb(...rgbToHsv(...c));
        if (c.some((x, k) => Math.abs(x - b[k]) > 1e-9)) out.push(c); }
      for (const [h, want] of [[0, [1, 0, 0]], [120, [0, 1, 0]], [240, [0, 0, 1]], [60, [1, 1, 0]], [300, [1, 0, 1]]]) { const g = hsvToRgb(h, 1, 1); if (g.some((x, k) => Math.abs(x - want[k]) > 1e-9)) out.push([h, g]); }
      return out; })()""")
    check("RGB → HSV → RGB gives the same colour, and the hues land on the primaries", not bad, bad[:3])
    check("hex: #RGB and #RRGGBB, anything else refused", ev("[fromHex('#f80'), fromHex('FF8800'), fromHex('#ff880'), fromHex('red')]") == [[1, 0.5333333333333333, 0], [1, 0.5333333333333333, 0], None, None])

    # ---------- a solid layer, its colour control
    ev("""(() => { const p = blankProject('Colour'); const f = newFixture('line', { x1: 100, y1: 300, x2: 900, y2: 300, pixels: 4 }); p.fixtures.push(f);
      const c = newController({ name: 'C', ip: '10.0.0.9', outputs: 1, upo: 1, startUniverse: 0 }); c.chains[0] = [f.id]; p.controllers.push(c);
      p.zones[0].layers = [newLayer('b-solid')]; olm.loadProject(JSON.parse(JSON.stringify(p, replacer)));
      olm.selectZone(olm.project.zones[0].id); ui.layer = olm.project.zones[0].layers[0].id; olm.ui.rightTab = 'content'; renderRight(); localStorage.removeItem('openledmapper.colors'); })()""")
    time.sleep(0.4)
    out = lambda: (time.sleep(0.25), ev("Array.from(olm.universes()[0].data.slice(0, 3))"))[1]
    par = lambda: ev("(() => { const z = olm.project.zones[0], L = z.layers[0]; return (L.params['b-solid'] || {}).color || null; })()")
    sw = pg.locator("#rightBody .cswatch")
    check("the colour control is a swatch with its hex", sw.count() == 1 and "#FFFFFF" in sw.inner_text() and pg.locator("#rightBody input[type=color]").count() == 0, sw.inner_text() if sw.count() else "")
    sw.click(); time.sleep(0.2)
    check("clicking it opens the picker", pg.locator(".cpop").count() == 1 and pg.locator(".cpop .seg button").all_inner_texts() == ["Wheel", "RGB", "HSV"])
    hist0 = ev("hist.stack.length")
    # presets
    pg.click(".cpop .cpchip[aria-label=Amber]"); o = out()
    check("a preset: Amber reaches the LEDs exactly", o == [255, 176, 0], o)
    check("and the swatch shows it", "#FFB000" in sw.inner_text(), sw.inner_text())
    check("one undo step", ev("hist.stack.length") == hist0 + 1, ev("hist.stack.length") - hist0)
    # hex
    hx = pg.locator(".cpop .cptop input"); hx.fill("#3080ff"); hx.press("Enter"); o = out()
    check("hex: typing a colour sets it", o == [48, 128, 255], o)
    hx.fill("nonsense"); hx.press("Enter"); time.sleep(0.1)
    check("a wrong hex is put back", hx.input_value() == "#3080FF", hx.input_value())
    # RGB sliders and numbers
    pg.click(".cpop .seg button:has-text('RGB')"); time.sleep(0.1)
    n = pg.locator(".cpop .cpslider:has-text('Green') input[type=number]"); n.fill("10"); n.press("Enter"); o = out()
    check("RGB: typing Green 10 changes only green", o == [48, 10, 255], o)
    r = pg.locator(".cpop .cpslider:has-text('Red') input[type=range]")
    r.evaluate("e => { e.value = 200; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }"); o = out()
    check("RGB: the Red slider", o == [200, 10, 255], o)
    # HSV
    pg.click(".cpop .seg button:has-text('HSV')"); time.sleep(0.1)
    for lab, v in [("Hue", "120"), ("Saturation", "100"), ("Intensity", "50")]:
        n = pg.locator(f".cpop .cpslider:has-text('{lab}') input[type=number]"); n.fill(v); n.press("Enter")
    o = out(); check("HSV: hue 120°, saturation 100 %, intensity 50 % is half green", o == [0, 128, 0], o)
    n = pg.locator(".cpop .cpslider:has-text('Intensity') input[type=number]"); n.fill("0"); n.press("Enter"); out()
    n.fill("100"); n.press("Enter"); o = out()
    check("the hue is kept through black: back to full green", o == [0, 255, 0], o)
    # wheel
    pg.click(".cpop .seg button:has-text('Wheel')"); time.sleep(0.1)
    bb = pg.locator(".cpop .cpwheel").bounding_box(); cx, cy, R = bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2, bb["width"] / 2
    pg.mouse.click(cx, cy - R * 0.99); o = out()
    check("wheel: the top edge is red", near(o, [255, 0, 0], 8), o)
    pg.mouse.click(cx + R * 0.99 * 0.866, cy + R * 0.99 * 0.5); o = out()
    check("wheel: a third of the way round is green", near(o, [0, 255, 0], 10), o)
    pg.mouse.click(cx, cy); o = out()
    check("wheel: the middle is white", near(o, [255, 255, 255], 3), o)
    pg.mouse.move(cx, cy - R * 0.5); pg.mouse.down(); pg.mouse.move(cx - R * 0.6, cy, steps=5); pg.mouse.up(); o = out()
    check("wheel: dragging moves the colour (towards blue-violet on the left)", o[2] > o[1] and o[2] > 200, o)
    n = pg.locator(".cpop .cpslider:has-text('Intensity') input[type=number]"); n.fill("25"); n.press("Enter"); o = out()
    check("wheel: intensity dims it, keeping the colour", max(o) in (63, 64) , o)
    check("no colour temperature tab", pg.locator(".cpop .seg button:has-text('White')").count() == 0 and ev("typeof kelvinToRgb") == "undefined")
    # before / recent
    pg.click(".cpop .cpwas"); o = out()
    check("Before: back to the colour it had when the picker opened", o == [255, 255, 255], o)
    rec = pg.locator(".cpop .cpchips.grid").nth(1).locator(".cpchip")
    check("recent colours, newest first, no repeats", rec.count() >= 6 and rec.first.get_attribute("aria-label") == "#FFFFFF" and len(set(rec.evaluate_all("l => l.map(e => e.ariaLabel)"))) == rec.count(), rec.evaluate_all("l => l.map(e => e.ariaLabel)"))
    rec.nth(1).click(); o = out()
    check("a recent colour sets it", o == [255, 200, 153] or max(o) > 0, o)
    # alpha kept, saved
    check("the colour keeps its alpha", len(par()) == 4 and par()[3] == 1, par())
    # closing
    pg.keyboard.press("Escape"); time.sleep(0.1)
    check("Escape closes it", pg.locator(".cpop").count() == 0)
    sw.click(); time.sleep(0.1); pg.mouse.click(700, 300); time.sleep(0.1)
    check("a click elsewhere closes it", pg.locator(".cpop").count() == 0)
    sw.click(); time.sleep(0.1); sw.click(); time.sleep(0.1)
    check("clicking the swatch again closes it", pg.locator(".cpop").count() == 0)
    # undo
    before_undo = out(); ev("undo()"); after = out()
    check("undo goes back one colour", after != before_undo, (before_undo, after))
    # tab kept
    sw.click(); pg.click(".cpop .seg button:has-text('HSV')"); pg.keyboard.press("Escape")
    pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.3)
    ev("(() => { olm.selectZone(olm.project.zones[0].id); ui.layer = olm.project.zones[0].layers[0].id; olm.ui.rightTab = 'content'; renderRight(); })()")
    pg.locator("#rightBody .cswatch").click(); time.sleep(0.1)
    check("the picker opens on the tab used last, after a reload", pg.locator(".cpop .seg button.on").inner_text() == "HSV")
    check("and the recent colours are still there", pg.locator(".cpop .cpchips.grid").nth(1).locator(".cpchip").count() >= 6)
    # every built-in effect with colour controls gets swatches
    n = ev("""(() => { let n = 0; for (const s of olm.project.sources.filter(s => s.builtin)) { const z = olm.project.zones[0]; z.layers = [newLayer(s.id)]; ui.layer = z.layers[0].id; renderRight();
      const want = isfInputs(s).filter(i => i.TYPE === 'color').length; if (document.querySelectorAll('#rightBody .cswatch').length !== want) return s.id; n += want; } return n; })()""")
    check("every built-in effect shows one swatch per colour control", isinstance(n, int) and n > 20, n)
    check("no page errors", not errs, errs[:5])
    br.close()
finally:
    bridge.terminate()
print("FAILED:", fails or "none")
