# 16-bit fixtures: two channels per colour, the coarse one first, then the fine one, checked in the Art-Net packets
# that leave the bridge. 8-bit and 16-bit fixtures on one output; universe packing (85 RGB pixels per universe, and a
# pixel split across two when Skip ch 511–512 is off); colour orders and RGBW; the dimming curves (16-bit only); old
# files; the inspector (resolution, curve, the graph following the gamma slider); the DMX monitor, CSV, copy and
# paste, undo.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import FakeNode, start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8174
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

def fx(fid, n, x0, y, **kw):
    return dict({"id": fid, "type": "line", "name": fid, "enabled": True, "locked": False, "tag": "#fff", "order": "RGB", "reverse": False,
                 "dimmer": 1, "x1": x0, "y1": y, "x2": x0 + 100, "y2": y, "pixels": n}, **kw)
def project(fixtures, chains, color, upo=2, split=False, gamma=1):
    return {"name": "T16", "settings": {"compW": 400, "compH": 200, "transition": 0, "gamma": gamma, "fps": 30},
            "fixtures": fixtures,
            "controllers": [{"id": "c1", "name": "C", "ip": "127.0.0.1", "enabled": True, "outputs": len(chains), "upo": upo, "startUniverse": 3, "split": split, "chains": chains}],
            "zones": [{"id": "z1", "name": "Zone 1", "tag": "#ffb341", "x": 0, "y": 0, "w": 400, "h": 200, "opacity": 1,
                       "layers": [{"id": "l1", "src": "b-solid", "params": {"b-solid": {"color": color + [1]}}, "opacity": 1, "blend": "alpha", "on": True}], "scenes": [], "scene": None}]}
D = 0x1234 / 65535   # a dimmer that makes full red exactly 0x1234: coarse 0x12, fine 0x34

node = FakeNode()
bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = br.new_page(viewport={"width": 1500, "height": 1000})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    E = pg.evaluate
    def load(p, settle=0.5):
        E("p => olm.loadProject(p)", p); time.sleep(settle)
    uni = lambda u, n=512: E(f"Array.from((olm.universes().find(U => U.uni === {u}) || {{ data: [] }}).data.slice(0, {n}))")
    col = lambda i=0, fi=0: E(f"Array.from(olm.project.fixtures[{fi}]._col.slice({3 * i}, {3 * i + 3}))")
    w16 = lambda v: [v >> 8, v & 255]
    q16 = lambda x: 0 if x <= 0 else 65535 if x >= 1 else int(x * 65535 + 0.5)

    # ---------- files
    r = E("""(() => { const p = hydrate({ fixtures: [
        { id: 'a', type: 'line', pixels: 2 }, { id: 'b', type: 'line', pixels: 2, bits: '16', curve: 'bogus' }, { id: 'c', type: 'line', pixels: 2, bits: 12, curve: 'scurve' },
        { id: 'd', type: 'line', pixels: 2, bits: 16, curve: 'tungsten', warm: false, lag: true }] });
      return p.fixtures.map(f => [f.bits, f.curve, 'warm' in f || 'lag' in f]); })()""")
    check("old files are 8-bit with gamma; 16 (also as text) is kept; anything else is 8; an unknown curve is gamma", r[:3] == [[8, "gamma", False], [16, "gamma", False], [8, "scurve", False]], r)
    check("a tungsten fixture from 0.8.0 opens as gamma, without its tungsten options", r[3] == [16, "gamma", False], r)
    check("new fixtures are 8-bit, gamma, strength 100 %", E("(() => { const f = newFixture('line'); return [f.bits, f.curve, f.strength]; })()") == [8, "gamma", 1])
    r = E("(() => hydrate({ fixtures: [{ id: 'a', type: 'line', pixels: 2 }, { id: 'b', type: 'line', pixels: 2, strength: 5 }, { id: 'c', type: 'line', pixels: 2, strength: 'x' }, { id: 'd', type: 'line', pixels: 2, strength: 0.4 }] }).fixtures.map(f => f.strength))()")
    check("strength: 100 % when missing or not a number, kept between 0 and 200 %", r == [1, 2, 1, 0.4], r)

    # ---------- an 8-bit and a 16-bit fixture on one output
    load(project([fx("f16", 5, 50, 50, bits=16, dimmer=D), fx("f8", 5, 50, 120)], [["f16", "f8"]], [1, 0.5, 0]))
    r = E("(() => { const [a, b] = olm.project.fixtures; return { a: addrText(a._patch), b: addrText(b._patch), pa: pixelAddrText(a, 1), bpp: [BPP(a), BPP(b)] }; })()")
    check("a 16-bit RGB pixel takes 6 channels, an 8-bit one 3", r["bpp"] == [6, 3] and r["pa"] == "U 3 ch 7–12", r)
    check("the 8-bit fixture after it starts right after its 30 channels", r["a"] == "U 3 · ch 1  →  U 3 · ch 30" and r["b"] == "U 3 · ch 31  →  U 3 · ch 45", r)
    c16, c8 = col(0, 0), col(0, 1)
    d = uni(3, 48)
    want = []
    for v in c16: want += w16(q16(v / 255 * D))
    check("16-bit channels: red coarse, red fine, green coarse, green fine, blue coarse, blue fine", d[0:6] == want and c16[0] == 255 and d[0:2] == [0x12, 0x34], (c16, d[0:6], want))
    check("…for every pixel", all(d[6 * i:6 * i + 6] == want for i in range(5)), d[0:30])
    check("the 8-bit fixture beside it sends its bytes as before", d[30:33] == c8 and all(d[30 + 3 * i:33 + 3 * i] == c8 for i in range(5)), (c8, d[30:45]))
    check("nothing after the last channel", not any(d[45:48]), d[45:48])
    E("olm.setOutput(true)"); time.sleep(0.8)
    wire = node.last(3)
    check("on the wire: the Art-Net packet carries the coarse byte first, then the fine one", wire is not None and list(wire[0:6]) == want and list(wire[30:33]) == c8, (list(wire[0:12]) if wire else None))
    E("olm.setOutput(false)")
    E("(() => { const f = olm.project.fixtures[0]; f.order = 'GRB'; markPatch(); commit(); })()"); time.sleep(0.3)
    d = uni(3, 12)
    check("colour order GRB: green's two channels first", d[0:6] == want[2:4] + want[0:2] + want[4:6], (d[0:6], want))
    E("(() => { const f = olm.project.fixtures[0]; f.order = 'RGBW'; f.dimmer = 1; markPatch(); commit(); project.settings.whiteMode = 'add'; })()"); time.sleep(0.3)
    d = uni(3, 16); c = col(0, 0)
    vals = [q16(v / 255) for v in c]; wv = min(vals)
    check("RGBW at 16-bit: 8 channels, white (the common part) as two channels too", d[0:8] == w16(vals[0]) + w16(vals[1]) + w16(vals[2]) + w16(wv) and E("BPP(olm.project.fixtures[0])") == 8, (c, d[0:8]))
    E("(() => { project.settings.whiteMode = 'sub'; })()"); time.sleep(0.3)
    d = uni(3, 16)
    check("RGBW, white taken out of RGB", d[0:8] == w16(vals[0] - wv) + w16(vals[1] - wv) + w16(vals[2] - wv) + w16(wv), d[0:8])
    E("(() => { project.settings.whiteMode = 'off'; const f = olm.project.fixtures[0]; f.order = 'W'; markPatch(); commit(); })()"); time.sleep(0.3)
    d = uni(3, 4); lum = 0.2126 * vals[0] / 65535 + 0.7152 * vals[1] / 65535 + 0.0722 * vals[2] / 65535
    check("a mono (W) 16-bit fixture: its brightness on two channels", d[0:2] == w16(q16(lum)) and E("BPP(olm.project.fixtures[0])") == 2, (d[0:4], w16(q16(lum))))

    # ---------- packing in universes
    load(project([fx("big", 100, 20, 60, bits=16)], [["big"]], [1, 1, 1]))
    r = E("(() => { const f = olm.project.fixtures[0]; return [pixelAddrText(f, 84), pixelAddrText(f, 85), addrText(f._patch)]; })()")
    check("85 16-bit RGB pixels fill channels 1–510; the 86th starts the next universe", r[0] == "U 3 ch 505–510" and r[1] == "U 4 ch 1–6", r)
    check("channels 511 and 512 stay empty", uni(3)[510:512] == [0, 0] and uni(3)[504:510] == [255] * 6, uni(3)[500:512])
    load(project([fx("big", 100, 20, 60, bits=16, dimmer=D)], [["big"]], [1, 1, 1], split=True))
    u3, u4 = uni(3), uni(4)
    check("Skip off: the 86th pixel's red is on 511–512, green and blue on the next universe", u3[510:512] == [0x12, 0x34] and u4[0:4] == [0x12, 0x34, 0x12, 0x34], (u3[508:512], u4[0:6]))

    # ---------- curves
    def curve_out(curve, color, **kw):
        load(project([fx("c", 2, 50, 50, bits=16, curve=curve, **kw)], [["c"]], color), 0.4)
        return col(0, 0), uni(3, 6)
    base = None
    for curve, fn in [("linear", lambda x: x), ("square", lambda x: x * x), ("invsquare", lambda x: 1 - (1 - x) ** 2), ("scurve", lambda x: x * x * (3 - 2 * x)), ("gamma", lambda x: x ** 2.2)]:
        c, d = curve_out(curve, [0.3, 0.5, 0.8], gamma=2.2)
        got = [d[0] << 8 | d[1], d[2] << 8 | d[3], d[4] << 8 | d[5]]
        exp = [q16(fn(v / 255)) for v in c]
        check(f"curve {curve}: the 16-bit output follows it", all(abs(g - e) <= 1 for g, e in zip(got, exp)), (c, got, exp))
    ss = lambda x: x * x * (3 - 2 * x)
    forms = {"square": (lambda x: x * x, lambda x: x ** 3), "invsquare": (lambda x: 1 - (1 - x) ** 2, lambda x: 1 - (1 - x) ** 3), "scurve": (ss, lambda x: ss(ss(x)))}
    for curve, (a, b) in forms.items():
        for k in (0, 0.5, 1.5, 2):
            fn = (lambda x, a=a, k=k: x + (a(x) - x) * k) if k <= 1 else (lambda x, a=a, b=b, k=k: a(x) + (b(x) - a(x)) * (k - 1))
            c, d = curve_out(curve, [0.3, 0.5, 0.8], strength=k)
            got = [d[0] << 8 | d[1], d[2] << 8 | d[3], d[4] << 8 | d[5]]
            exp = [q16(fn(v / 255)) for v in c]
            check(f"curve {curve} at strength {int(k * 100)} %: the output follows it", all(abs(g - e) <= 1 for g, e in zip(got, exp)), (c, got, exp))
    r = E("(() => { const out = {}; for (const c of ['square', 'invsquare', 'scurve']) for (const k of [0, 0.37, 1, 1.63, 2]) { let last = -1; for (let i = 0; i <= 1000; i++) { const y = curveValue(c, k, i / 1000); if (y < last - 1e-12 || y < 0 || y > 1) out[c + k] = i; last = y; } } return out; })()")
    check("at every strength each curve rises from 0 to 1 and never turns back", r == {}, r)
    c, d = curve_out("linear", [0.3, 0.5, 0.8], strength=2)
    check("linear has no strength: it stays a straight line", [d[0] << 8 | d[1], d[2] << 8 | d[3], d[4] << 8 | d[5]] == [q16(v / 255) for v in c], d)
    load(project([fx("c8", 2, 50, 50, curve="scurve", gamma=2.2)], [["c8"]], [0.3, 0.5, 0.8]), 0.4)
    c, d = col(0, 0), uni(3, 3)
    check("an 8-bit fixture keeps gamma, whatever curve it has stored", d == [round(255 * (v / 255) ** 2.2) for v in c] and E("fxCurve(olm.project.fixtures[0])") == "gamma", (c, d))

    # ---------- blackout
    load(project([fx("b", 2, 50, 50, bits=16)], [["b"]], [1, 1, 1]), 0.4)
    check("white at full: every channel 255", uni(3, 6) == [255] * 6, uni(3, 6))
    E("toggleBlackout()"); time.sleep(0.15)
    check("blackout: coarse and fine channels all 0", uni(3, 6) == [0] * 6, uni(3, 6))
    E("toggleBlackout()"); time.sleep(0.3)

    # ---------- the inspector
    load(project([fx("i16", 4, 50, 50, bits=16), fx("i8", 4, 50, 120)], [["i16", "i8"]], [1, 1, 1]), 0.3)
    E("(() => { ui.sel = new Set(['i16']); ui.rightTab = 'inspector'; ui.rightHidden = false; onSelection(); })()"); time.sleep(0.3)
    sel = "#rightBody select[aria-label='Dimming curve']"
    check("a 16-bit fixture: Resolution shows 16-bit, the curve can be chosen, and a graph shows it", pg.locator("#rightBody .seg button.on:has-text('16-bit')").count() == 1 and not pg.locator(sel).is_disabled() and pg.locator("#rightBody svg.cgraph path.cv").count() == 1)
    check("the curve list has no tungsten any more", "tungsten" not in E("[...document.querySelectorAll(\"#rightBody select[aria-label='Dimming curve'] option\")].map(o => o.value)"))
    # the graph follows the gamma slider while it moves: drawn again in place, before the change is committed
    gpath = "#rightBody svg.cgraph path.cv"
    E("document.querySelector('#rightBody .cgwrap')._mark = 1")
    d0 = pg.get_attribute(gpath, "d"); h0 = E("hist.idx")
    E("(() => { const r = document.querySelector(\"#rightBody input[type=range][aria-label='Gamma']\"); r.value = 1.5; r.dispatchEvent(new Event('input', { bubbles: true })); })()")
    d1 = pg.get_attribute(gpath, "d")
    check("moving the gamma slider moves the curve at once, in the same graph, before it is committed", d1 != d0 and E("document.querySelector('#rightBody .cgwrap')._mark") == 1 and E("hist.idx") == h0, (d0[:60], d1[:60]))
    E("(() => { const r = document.querySelector(\"#rightBody input[type=range][aria-label='Gamma']\"); r.value = 2.6; r.dispatchEvent(new Event('input', { bubbles: true })); })()")
    d2 = pg.get_attribute(gpath, "d")
    midy = lambda d: float(d.split("L")[120].split()[1])   # the curve at half the level (lower on the graph is a bigger y)
    check("…and on as it moves (gamma 2.6 bends it further down)", midy(d2) > midy(d1) > midy(d0) - 1e-9, (midy(d0), midy(d1), midy(d2)))
    E("(() => { const r = document.querySelector(\"#rightBody input[type=range][aria-label='Gamma']\"); r.dispatchEvent(new Event('change', { bubbles: true })); })()")
    check("letting go of the slider is one undo step", E("hist.idx") == h0 + 1 and E("olm.project.fixtures[0].gamma") == 2.6)
    v = pg.locator("#rightBody .row:has(> .lbl:text-is('Gamma')) .sval"); v.dblclick(); pg.keyboard.type("1"); pg.keyboard.press("Enter"); time.sleep(0.1)
    mid = pg.get_attribute(gpath, "d").split("L")[120]
    check("a typed gamma moves it too: at 1 the curve is a straight line (half the level, half the output)", mid.strip() == "120.00 66.00", mid)
    d3 = pg.get_attribute(gpath, "d")
    pg.select_option(sel, "scurve"); time.sleep(0.3)
    check("choosing S curve: stored, the graph changes, and the gamma slider goes", E("olm.project.fixtures[0].curve") == "scurve" and pg.get_attribute(gpath, "d") != d3 and pg.locator("#rightBody input[type=range][aria-label='Gamma']").count() == 0)
    srange = "#rightBody input[type=range][aria-label='Strength']"
    check("…and a Strength slider takes its place, at 100 %", pg.locator(srange).count() == 1 and pg.locator("#rightBody .row:has(> .lbl:text-is('Strength')) .sval").inner_text() == "100%")
    E("document.querySelector('#rightBody .cgwrap')._mark = 2")
    s0 = pg.get_attribute(gpath, "d"); h0 = E("hist.idx")
    slope = lambda d: float(d.split("L")[60].split()[1]) - float(d.split("L")[180].split()[1])   # how far it climbs between a quarter and three quarters
    E(f"(() => {{ const r = document.querySelector(\"{srange}\"); r.value = 1.8; r.dispatchEvent(new Event('input', {{ bubbles: true }})); }})()")
    s1 = pg.get_attribute(gpath, "d")
    check("moving Strength up makes the S steeper, at once, in the same graph, before it is committed", slope(s1) > slope(s0) and E("document.querySelector('#rightBody .cgwrap')._mark") == 2 and E("hist.idx") == h0, (slope(s0), slope(s1)))
    E(f"(() => {{ const r = document.querySelector(\"{srange}\"); r.value = 0.3; r.dispatchEvent(new Event('input', {{ bubbles: true }})); r.dispatchEvent(new Event('change', {{ bubbles: true }})); }})()")
    s2 = pg.get_attribute(gpath, "d")
    check("…and down makes it gentler; letting go is one undo step", slope(s2) < slope(s0) and E("hist.idx") == h0 + 1 and E("olm.project.fixtures[0].strength") == 0.3, (slope(s0), slope(s2)))
    v = pg.locator("#rightBody .row:has(> .lbl:text-is('Strength')) .sval"); v.dblclick(); pg.keyboard.type("0"); pg.keyboard.press("Enter"); time.sleep(0.1)
    mid = pg.get_attribute(gpath, "d").split("L")[120]
    check("a typed strength of 0 % makes it a straight line", mid.strip() == "120.00 66.00" and E("olm.project.fixtures[0].strength") == 0, mid)
    for c in ("square", "invsquare"):
        pg.select_option(sel, c); time.sleep(0.25)
        check(f"{c}: has the Strength slider too", pg.locator(srange).count() == 1)
    pg.select_option(sel, "linear"); time.sleep(0.25)
    check("linear: no slider (neither Gamma nor Strength)", pg.locator(srange).count() == 0 and pg.locator("#rightBody input[type=range][aria-label='Gamma']").count() == 0)
    E("(() => { olm.project.fixtures[0].strength = 1; })()")
    pg.select_option(sel, "scurve"); time.sleep(0.25)
    pg.click("#rightBody .seg button:has-text('Low end')"); time.sleep(0.2)
    check("Low end shows the first 10 %, with how many steps it has", "Bottom 10 %" in pg.inner_text("#rightBody .cgwrap") and "level 10 %" in pg.inner_text("#rightBody .cgwrap"))
    pg.click("#rightBody .seg button:has-text('8-bit')"); time.sleep(0.3)
    check("switching to 8-bit: 3 channels again, gamma only (the curve is kept for 16-bit)", E("[olm.project.fixtures[0].bits, BPP(olm.project.fixtures[0]), fxCurve(olm.project.fixtures[0]), olm.project.fixtures[0].curve]") == [8, 3, "gamma", "scurve"] and pg.locator(sel).is_disabled())
    check("…the graph shows 8-bit steps, and says the other curves need 16-bit", "need 16-bit" in pg.inner_text("#rightBody") and "at 8-bit" in pg.inner_text("#rightBody .cgwrap"))
    check("…and the patch follows: the next fixture moves up to channel 13", E("addrText(olm.project.fixtures[1]._patch)") == "U 3 · ch 13  →  U 3 · ch 24", E("addrText(olm.project.fixtures[1]._patch)"))
    E("undo()"); time.sleep(0.3)
    check("undo brings back 16-bit", E("olm.project.fixtures[0].bits") == 16 and E("addrText(olm.project.fixtures[1]._patch)") == "U 3 · ch 25  →  U 3 · ch 36")
    E("(() => { ui.sel = new Set(['i16', 'i8']); onSelection(); })()"); time.sleep(0.3)
    check("8-bit and 16-bit selected together: Resolution shows neither, the curve is gamma only", pg.locator("#rightBody .seg button.on:has-text('bit')").count() == 0 and pg.locator(sel).is_disabled() and "Mixed" in pg.inner_text("#rightBody"))
    pg.click("#rightBody .seg button:has-text('16-bit')"); time.sleep(0.3)
    check("…setting 16-bit sets both", E("olm.project.fixtures.map(f => f.bits)") == [16, 16] and not pg.locator(sel).is_disabled())
    E("(() => { const [a, b] = olm.project.fixtures; a.curve = 'scurve'; a.strength = 1; b.curve = 'square'; b.strength = 0.5; renderRight(); })()"); time.sleep(0.2)
    check("two fixtures with strengths: one Strength slider, marked mixed", pg.locator(srange).count() == 1 and "(mixed)" in pg.locator("#rightBody .row:has(> .lbl:text-is('Strength')) .sval").inner_text())
    E(f"(() => {{ const r = document.querySelector(\"{srange}\"); r.value = 1.4; r.dispatchEvent(new Event('input', {{ bubbles: true }})); r.dispatchEvent(new Event('change', {{ bubbles: true }})); }})()")
    check("…moving it sets both", E("olm.project.fixtures.map(f => f.strength)") == [1.4, 1.4], E("olm.project.fixtures.map(f => f.strength)"))
    E("(() => { ui.sel = new Set(['i16']); onSelection(); })()"); time.sleep(0.2)

    # ---------- the DMX monitor, CSV, copy and paste
    E("(() => { ui.dockTab = 'monitor'; ui.dockCollapsed = false; ui.monitorKey = olm.universes()[0].key; renderDock(); })()"); time.sleep(0.3)
    r = E("(() => { const m = monitorMap(olm.universes()[0]); return [0, 1, 2, 5].map(i => m[i] && (m[i].c + (m[i].coarse ? ' coarse' : m[i].fine ? ' fine' : ''))); })()")
    check("the DMX monitor names each channel: R coarse, R fine, G coarse … B fine", r == ["R coarse", "R fine", "G coarse", "B fine"], r)
    csv = E("(() => { let out = ''; const d = window.download; window.download = (n, t) => { out = t; }; exportCSV(); window.download = d; return out; })()")
    check("the patch CSV has a Bits column", csv.split("\n")[0].split(",")[4] == "Bits" and csv.split("\n")[1].split(",")[4] == "16", csv.split("\n")[:2])
    r = E("(() => { ui.sel = new Set(['i16']); const d = clipOfSel(); pasteFixtures(d); const f = olm.project.fixtures.at(-1); return [f.bits, f.curve, olm.project.fixtures.length]; })()")
    check("a pasted 16-bit fixture stays 16-bit with its curve", r[0] == 16 and r[1] == "scurve" and r[2] == 3, r)
    r = E("(() => { const s = serialize(false); const p = JSON.parse(s); return [p.fixtures[0].bits, p.fixtures[0].curve, 'warm' in p.fixtures[0] || 'lag' in p.fixtures[0]]; })()")
    check("saved with the project", r == [16, "scurve", False], r)
    br.close()
finally:
    bridge.terminate(); node.close()
errs = [e for e in errs if "googleapis" not in e and "ERR_CERT" not in e]
check("no page errors", not errs, errs[:5])
print("FAILED:", fails or "none")
