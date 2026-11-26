# Import MadMapper 6 (beta), against .mad files written here in MadMapper's binary format (Qt's QDataStream, version
# 18): a ring, a line and a matrix wired in a snake (RGBW), in a group; a quad that is no fixture; two devices in its
# Art-Net routing table. The window before importing (counts, devices, notes), the fixtures on the stage (kind, pixels,
# order, where pixel 0 is and which way they run), the group, a Manual controller per device with each fixture at its
# universe and channel (Advatek counting from 1), Flip upside down, the patch left out, a zipped .madproject (its
# backups ignored), a file that is no project, one step of undo.
import os, sys, time, json, struct, io, zipfile, tempfile, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8272
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

# ---------- writing MadMapper's format
def qstr(s): b = s.encode("utf-16-be"); return struct.pack(">I", len(b)) + b
def v(x):
    if x is None: return struct.pack(">IB", 0, 1) + struct.pack(">I", 0xFFFFFFFF)
    if isinstance(x, bool): return struct.pack(">IBB", 1, 0, int(x))
    if isinstance(x, int): return struct.pack(">IBi", 2, 0, x)
    if isinstance(x, float): return struct.pack(">IBd", 6, 0, x)
    if isinstance(x, str): return struct.pack(">IB", 10, 0) + qstr(x)
    if isinstance(x, bytes): return struct.pack(">IBI", 12, 0, len(x)) + x
    if isinstance(x, list): return struct.pack(">IBI", 9, 0, len(x)) + b"".join(v(i) for i in x)
    if isinstance(x, dict): return struct.pack(">IB", 8, 0) + vmap(x)
    if isinstance(x, tuple) and x[0] == "pointf": return struct.pack(">IBdd", 26, 0, x[1], x[2])
    if isinstance(x, tuple) and x[0] == "color": return struct.pack(">IBI", 127, 0, 9) + b"MadColor\0" + qstr("rgb") + struct.pack(">dddd", 1, 1, 1, 1)
    if isinstance(x, tuple) and x[0] == "image": return struct.pack(">IBI", 70, 0, 0)
    raise TypeError(x)
def vmap(d): return struct.pack(">I", len(d)) + b"".join(qstr(k) + v(val) for k, val in d.items())
def corners(pts): return struct.pack(">I", 4) + b"".join(struct.pack(">dd", x, y) for x, y in pts)
def mad(top): return struct.pack(">II", 0x0BADBABE, 18) + vmap(top)

def fixture(kind, name, quad, w, h, ptype, uni, ch, mapping):
    return {"type": kind, "name": name, "positions": corners(quad), "artnetUniverse": uni, "startChannel": ch, "dmxtype": "ArtNet",
            "circleArc": 360.0, "circleThickness": 0.0, "rotation": 0.0, "modulation": ("color",), "instanceThumbnail": ("image",), "nothing": None,
            "fixture": {"width": w, "height": h, "type": ptype, "pixelMapping": " ".join(str(m) for m in mapping) + " ", "product": name, "avoidCrossUniversePixels": True, "isValid": True}}
# a ring of 24 RGB pixels round (0, 0.4), the box 1 wide; a line of 10 below it; a 4 × 3 RGBW matrix wired in a snake
ring = fixture("fixturecircle", "Ring", [(-0.5, -0.1), (0.5, -0.1), (0.5, 0.9), (-0.5, 0.9)], 24, 1, "RGB", 0, 1, [1 + 3 * i for i in range(24)])
line = fixture("fixtureline", "Line", [(-1.0, -0.62), (1.0, -0.62), (1.0, -0.58), (-1.0, -0.58)], 10, 1, "RGB", 0, 73, [1 + 3 * i for i in range(10)])
snake = []
for k in range(12):   # grid index (row-major) → the channel it starts at, rows wired back and forth
    r, c = divmod(k, 4); i = r * 4 + (c if r % 2 == 0 else 3 - c); snake.append(1 + 4 * i)
grid = fixture("fixture", "Panel", [(1.2, -0.9), (2.0, -0.9), (2.0, -0.3), (1.2, -0.3)], 4, 3, "RGBW", 1, 1, snake)
quad = {"type": "quad", "name": "Quad-1", "positions": corners([(0, 0), (1, 0), (1, 1), (0, 1)])}
group = {"type": "group", "name": "Stage", "isFixtureGroup": True}
routing = {"Ethernet 5": [
    {"active": 1, "autodetected": 1, "ip": "10.0.0.9", "longName": "PixLite 4 Mk2", "shortName": "PixLite 4", "remapped": False, "remappedUniverse": 0, "universe": 0},
    {"active": 1, "autodetected": 1, "ip": "10.0.0.9", "longName": "PixLite 4 Mk2", "shortName": "PixLite 4", "remapped": False, "remappedUniverse": 1, "universe": 1},
    {"active": 1, "autodetected": 1, "ip": "10.0.0.20", "longName": "Some node", "shortName": "Node", "remapped": False, "remappedUniverse": 5, "universe": 5}]}
top = {"audioInputLevel": 1.0, "surfaces": [group, ring, line, grid, quad], "surfacesRelations": [-1, 0, 0, 0, -1],
       "projectSettings": {"artNetRoutingTables": routing, "artNetOutputUnicast": False}}

tmp = tempfile.mkdtemp(prefix="noupix-mad-")
MAD = os.path.join(tmp, "Show.mad"); open(MAD, "wb").write(mad(top))
ZIP = os.path.join(tmp, "Show.madproject.zip")
with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("Show.madproject/Backup/Show.20260101.backup.mad", b"not this one")
    z.writestr("Show.madproject/Show.mad", mad(top))
    z.writestr("Show.madproject/Media/x.txt", "x")
BAD = os.path.join(tmp, "Nope.mad"); open(BAD, "wb").write(b"hello, not a project")

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 950})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    blank = lambda: (ev("(() => { olm.loadProject(blankProject()); ui.patchHelped = true; renderAll(); })()"), time.sleep(0.3))
    def pick(path, go=True, **ticks):
        pg.set_input_files("#fileMad", path); time.sleep(0.8)
        for k, on in ticks.items():
            box = pg.locator(f"#mad_{k}")
            if box.count() and box.is_checked() != on: box.click()
        if go and pg.locator(".modal.madimp").count(): pg.locator(".modal.madimp .btn.primary").click(); time.sleep(0.6)
    fx = lambda name: ev(f"JSON.parse(JSON.stringify(project.fixtures.find(f => f.name === {json.dumps(name)}), replacer))")
    pts = lambda name: ev(f"(() => {{ rebuildGeometry(); return Array.from(project.fixtures.find(f => f.name === {json.dumps(name)})._pts); }})()")

    # ---------- the window before importing
    blank()
    check("Import MadMapper 6 (beta) in the project menu, under Import SVG", ev("(() => { projectMenu(document.body); const t = [...document.querySelectorAll('.menu button, .menu [role=menuitem], .menu li')].map(b => b.textContent); document.querySelectorAll('.menu').forEach(m => m.remove()); const i = t.findIndex(x => x.includes('Import SVG')); return i >= 0 && t[i + 1].includes('MadMapper'); })()"))
    pick(MAD, go=False)
    dlg = pg.locator(".modal.madimp")
    txt = dlg.inner_text() if dlg.count() else ""
    check("the window says what it holds: 3 fixtures (a ring, a line, a matrix), their pixels, the devices with their universes",
          "3 fixtures (1 ring, 1 line, 1 matrix), 46 pixels" in txt and "PixLite 4 · 10.0.0.9 · U 0–1" in txt and "Node · 10.0.0.20 · U 5" in txt, txt[:300])
    check("…Patch ticked, Flip upside down not", pg.locator("#mad_patch").is_checked() and not pg.locator("#mad_flip").is_checked())
    pg.locator(".modal.madimp .btn", has_text="Cancel").click(); time.sleep(0.2)
    check("Cancel adds nothing", ev("project.fixtures.length") == 0 and ev("project.controllers.length") == 0)

    # ---------- importing
    h0 = ev("hist.idx")
    pick(MAD)
    check("the three fixtures come in, the quad (no fixture) left out", ev("project.fixtures.map(f => f.name + ':' + f.type + ':' + pixelCount(f) + ':' + f.order)") == ["Ring:circle:24:RGB", "Line:line:10:RGB", "Panel:matrix:12:RGBW"],
          ev("project.fixtures.map(f => f.name + ':' + f.type + ':' + pixelCount(f) + ':' + f.order)"))
    check("…in a group named as in MadMapper", ev("project.groups.map(g => g.name)") == ["Stage"] and ev("project.fixtures.every(f => f.group === project.groups[0].id)"))
    r, l = fx("Ring"), fx("Line")
    check("…fitted to the canvas, MadMapper's up as the stage's up: the line under the ring", l["y1"] > r["cy"] + r["r"], (l["y1"], r["cy"], r["r"]))
    P = pts("Ring")
    # pixel 0 at the ring's right (MadMapper's angle 0), running anticlockwise as MadMapper's angles do (up first)
    check("the ring's pixel 0 at its right, the next ones going up", abs(P[1] - r["cy"]) < 1 and P[0] > r["cx"] and P[3] < P[1], P[:4])
    L = pts("Line")
    check("the line from left to right, as it is wired", L[0] < L[-2] and abs(L[1] - L[-1]) < 1, (L[:2], L[-2:]))
    G, m = pts("Panel"), fx("Panel")
    # the matrix: 4 across, 3 down; MadMapper's first row is its lowest (y up), wired in a snake
    xs = [G[2 * i] for i in range(12)]; ys = [G[2 * i + 1] for i in range(12)]
    row = lambda i: round((ys[i] - min(ys)) / ((max(ys) - min(ys)) / 2))
    col = lambda i: round((xs[i] - min(xs)) / ((max(xs) - min(xs)) / 3))
    order = [(row(i), col(i)) for i in range(12)]
    want = [(2, 0), (2, 1), (2, 2), (2, 3), (1, 3), (1, 2), (1, 1), (1, 0), (0, 0), (0, 1), (0, 2), (0, 3)]
    check("the matrix wired as in MadMapper: from its bottom left, along the row, back along the next (a snake)", order == want and m["snake"] is True, (order, m["start"], m["dir"], m["snake"]))
    check("one step of undo", ev("hist.idx") == h0 + 1)

    # ---------- the patch
    c = ev("project.controllers.map(c => [c.name, c.ip, c.protocol, c.mode, c.chains[0].length, !!c.from1, c.maker || '', c.discovered || []])")
    check("a Manual controller per device: PixLite 4 (Advatek, counting from 1) with the three, Node with none", c == [["PixLite 4", "10.0.0.9", "artnet", "manual", 3, True, "advatek", [0, 1]], ["Node", "10.0.0.20", "artnet", "manual", 0, False, "", [5]]], c)
    a = ev("project.fixtures.map(f => [f.name, f.addr.u, f.addr.ch])")
    check("each fixture at its universe and channel: Ring U 0 ch 1, Line U 0 ch 73, Panel U 1 ch 1", a == [["Ring", 0, 1], ["Line", 0, 73], ["Panel", 1, 1]], a)
    check("…no clashes, and universes 0 and 1 go to the PixLite", not ev("(() => { ensurePatch(); return patchConflicts.length; })()")
          and ev("universes.filter(u => u.enabled).map(u => u.ip + ':' + u.uni)") == ["10.0.0.9:0", "10.0.0.9:1"], ev("universes.map(u => u.ip + ':' + u.uni)"))
    check("…the Patch tab on the PixLite, its fixtures listed with their universe and channel", ev("ctrlById(ui.selCtrl).name") == "PixLite 4")
    check("…the message says it, and that Advatek counts from 1", "3 fixtures from MadMapper and 2 Manual controllers" in pg.locator(".toast").last.inner_text() and "from 1" in pg.locator(".toast").last.inner_text())
    ev("undo()"); time.sleep(0.3)
    check("undo takes it all back", ev("project.fixtures.length") == 0 and ev("project.controllers.length") == 0 and ev("project.groups.length") == 0)

    # ---------- the options
    blank(); pick(MAD, flip=True)
    r, l = fx("Ring"), fx("Line")
    check("Flip upside down: the line over the ring", l["y1"] < r["cy"] - r["r"], (l["y1"], r["cy"]))
    blank(); pick(MAD, patch=False)
    check("Patch off: the fixtures only, no controllers", ev("project.fixtures.length") == 3 and ev("project.controllers.length") == 0 and ev("project.fixtures.every(f => !f.addr)"))

    # ---------- a zipped .madproject, and a file that is none
    blank(); pick(ZIP)
    check("a zipped .madproject: its project read, its backups ignored", ev("project.fixtures.length") == 3 and ev("project.controllers.length") == 2)
    blank(); pick(BAD, go=False)
    check("a file that is no MadMapper project: said, nothing added", pg.locator(".modal.madimp").count() == 0 and "not a MadMapper 6 project" in pg.locator(".toast").last.inner_text() and ev("project.fixtures.length") == 0)

    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
  bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
