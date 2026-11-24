# Camera input, Video input and the Ambilight (videoin.js, ui-videoin.js): a camera opened from Chrome's stand-in
# device, its state and the Content tab; a picture we know (a canvas: red left, blue right) as its video to check the
# processing (flip, rotate, invert, brightness, contrast, saturation, crop, fit); a device that isn't there; closing
# when nothing shows it and opening again; capture cards told apart by their names; the add menu and the source list;
# files and their repair; the Ambilight around that picture (each side's light, the middle as picture, glow or black,
# the picture's size, depth, segments, smoothing over time, an effect as its source, a source removed), its settings in
# the Content tab, undo and files.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8268
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS + ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    pg = br.new_page(viewport={"width": 1440, "height": 1000})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    ev = pg.evaluate
    def settle(t=0.4): time.sleep(t)
    # a strip across the middle (8 pixels, outside a 70 % picture at both ends) and one along the top edge
    ev("""(() => { const p = blankProject('Video'); p.fixtures.push(newFixture('line', { x1: 50, y1: 320, x2: 950, y2: 320, pixels: 8 }));
      p.fixtures.push(newFixture('line', { x1: 20, y1: 15, x2: 980, y2: 15, pixels: 8 }));
      p.zones[0].layers = []; olm.loadProject(JSON.parse(JSON.stringify(p, replacer))); })()"""); settle()
    col = lambda f, i: ev(f"Array.from(olm.project.fixtures[{f}]._col.slice({i * 3}, {i * 3 + 3}))")
    ends = lambda: (col(0, 0), col(0, 7))
    cam = lambda: "project.sources.find(s => s.kind === 'camera')"

    # ---------- a camera
    pg.click("#btnAddSrc"); settle(0.3)
    items = pg.locator(".menu button[role=menuitem]").all_inner_texts()
    check("the add menu has Camera input and Video input", any("Camera input" in i for i in items) and any("Video input" in i for i in items), items)
    pg.keyboard.press("Escape")
    ev("addDeviceSource('camera')"); pg.wait_for_function(f"!!mediaEls.get({cam()}.id)", timeout=10000); settle(0.6)
    s = ev(f"(() => {{ const s = {cam()}; return [s.name, s.label, s.device ? 'id' : '', devState(s).size]; }})()")
    check("a camera input opens the first camera, and keeps its name and id", s[0] == "Camera" and s[1] == "fake_device_0" and s[2] == "id" and s[3] == [640, 480], s)
    check("its picture plays on the fixtures", any(sum(col(0, i)) > 30 for i in range(8)), [col(0, i) for i in range(8)])
    heads = [x.split("\n")[0].strip().lower() for x in pg.locator("#rightBody .sec h3").all_inner_texts()]
    check("the Content tab shows Camera input and Image", "camera input" in heads and "image" in heads, heads)
    check("…its device, its state and size", pg.locator("#rightBody select[aria-label=Device]").input_value() == ev(f"{cam()}.device")
          and "640 × 480" in pg.locator("#rightBody").inner_text(), pg.locator("#rightBody").inner_text()[:200])
    tile = pg.locator("#srcList .tile", has_text="Camera")
    check("the source list tags it CAM", tile.count() >= 1 and "CAM" in tile.first.inner_text(), tile.first.inner_text() if tile.count() else "")

    # ---------- its processing, on a picture we know: red on the left, blue on the right
    ev(f"""(() => {{ const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
      const paint = () => {{ x.fillStyle = '#f00'; x.fillRect(0, 0, 160, 180); x.fillStyle = '#00f'; x.fillRect(160, 0, 160, 180); x.fillStyle = '#fff'; x.fillRect(0, 0, 320, 20); }};
      paint(); window._painter = setInterval(paint, 40);
      const s = {cam()}; devState(s).off = true; releaseMedia(s.id);
      const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(30); v.play(); mediaEls.set(s.id, v); s.fit = 'stretch'; commit(); }})()""")
    settle(1)
    proc = lambda js: ev(f"(() => {{ const p = {cam()}.proc; {js}; }})()") or settle()
    check("as it is: red left, blue right", ends() == ([255, 0, 0], [0, 0, 255]), ends())
    proc("p.flipH = true"); check("flipped horizontally: blue left, red right", ends() == ([0, 0, 255], [255, 0, 0]), ends())
    proc("p.flipH = false; p.flipV = true"); check("flipped vertically: the sides stay", ends() == ([255, 0, 0], [0, 0, 255]), ends())
    proc("p.flipV = false; p.rotate = 180"); check("turned 180°: the sides swap", ends() == ([0, 0, 255], [255, 0, 0]), ends())
    proc("p.rotate = 90"); a, b = ends()
    check("turned 90° clockwise: the white band along its top comes to the right", b == [255, 255, 255] and a != b, (a, b))
    proc("p.rotate = 270"); a, b = ends()
    check("turned 270°: to the left", a == [255, 255, 255] and a != b, (a, b))
    proc("p.rotate = 0; p.invert = true"); check("inverted: cyan and yellow", ends() == ([0, 255, 255], [255, 255, 0]), ends())
    proc("p.invert = false; p.brightness = 0.5"); a, b = ends()
    check("brightness at 50 %: half as bright", abs(a[0] - 128) <= 2 and abs(b[2] - 128) <= 2, (a, b))
    proc("p.brightness = 1; p.saturation = 0"); a, b = ends()
    check("saturation at 0: grey", a[0] == a[1] == a[2] and b[0] == b[1] == b[2], (a, b))
    proc("p.saturation = 1; p.contrast = 0"); a, b = ends()
    check("contrast at 0: the same mid grey everywhere", a == b and 100 < a[0] < 160, (a, b))
    proc("p.contrast = 1; p.cropL = 0.45"); a, b = col(0, 1), col(0, 7)
    check("cropped from the left: the red nearly gone, the second pixel already blue", a == [0, 0, 255] and b == [0, 0, 255], (a, b))
    proc("p.cropL = 0; p.cropR = 0.45"); a, b = col(0, 0), col(0, 6)
    check("cropped from the right: the second last pixel already red", a == [255, 0, 0] and b == [255, 0, 0], (a, b))
    proc("p.cropR = 0")
    ev("(() => { ui.rightTab = 'content'; renderRight(); })()"); settle(0.3)
    pg.locator("#rightBody label.checkrow", has_text="Flip horizontally").click(); settle()
    check("the Content tab's Flip horizontally flips it, one step of undo", ends() == ([0, 0, 255], [255, 0, 0]) and ev(f"{cam()}.proc.flipH"), ends())
    ev("undo()"); settle()
    check("undo flips it back", ends() == ([255, 0, 0], [0, 0, 255]) and not ev(f"{cam()}.proc.flipH"), ends())
    pg.locator("#rightBody .seg button", has_text="180°").click(); settle()
    check("Rotate 180° from the Content tab", ev(f"{cam()}.proc.rotate") == 180 and ends() == ([0, 0, 255], [255, 0, 0]))
    pg.locator("#rightBody button", has_text="Reset image").click(); settle()
    check("Reset image", ev(f"{cam()}.proc.rotate") == 0 and ends() == ([255, 0, 0], [0, 0, 255]))

    # ---------- files, and a device that isn't there
    data = ev("JSON.parse(serialize())")
    s = next(x for x in data["sources"] if x.get("kind") == "camera")
    check("a file keeps the camera's device, name, size, rate, fit and image", s["label"] == "fake_device_0" and s["res"] == "auto" and s["fit"] == "stretch" and s["proc"]["rotate"] == 0, s)
    s.update({"res": "8k", "fps": 999, "fit": "x", "proc": {"rotate": 450, "brightness": 9, "cropL": -1, "flipH": "yes"}, "device": 5})
    data["sources"].append({"id": "cap1", "kind": "capture", "name": "HDMI", "label": "Cam Link 4K", "device": "gone"})
    ev("d => olm.loadProject(d)", data); settle()
    s = ev(f"{cam()}")
    check("a file's camera is repaired", s["res"] == "auto" and s["fps"] == "auto" and s["fit"] == "fill" and s["device"] == "" and s["proc"]["rotate"] == 90
          and s["proc"]["brightness"] == 2 and s["proc"]["cropL"] == 0 and s["proc"]["flipH"] is False, s)
    ev("(() => { const z = project.zones[0]; z.layers = [Object.assign(newLayer('cap1'))]; ui.layer = z.layers[0].id; ui.rightTab = 'content'; commit(); renderRight(); })()")
    pg.wait_for_function("devState(srcById('cap1')).err", timeout=10000)
    check("a video input whose card isn't connected says so, and plays nothing", "isn’t connected" in ev("devState(srcById('cap1')).err") and not ev("mediaEls.has('cap1')")
          and "isn’t connected" in pg.locator("#rightBody").inner_text(), ev("devState(srcById('cap1')).err"))
    check("…its device listed as not connected", "Cam Link 4K (not connected)" in pg.locator("#rightBody select[aria-label=Device]").inner_text())
    check("the source list tags it OFF", "OFF" in pg.locator("#srcList .tile", has_text="HDMI").first.inner_text())
    check("capture cards told apart by their names", ev("['Cam Link 4K', 'USB Video', 'Magewell USB Capture HDMI', 'Blackmagic Design', 'FaceTime HD Camera', 'Logitech BRIO', 'fake_device_0'].map(isCaptureLabel)")
          == [True, True, True, True, False, False, False])
    ev("(() => { const s = srcById('cap1'); setSourceDevice(s, devices.list[0].deviceId); })()")
    pg.wait_for_function("mediaEls.has('cap1')", timeout=10000)
    check("another device chosen for it: it opens on that one", ev("srcById('cap1').label") == "fake_device_0" and not ev("devState(srcById('cap1')).err"))
    ev("(() => { project.zones[0].layers = []; commit(); })()")
    pg.wait_for_function("!mediaEls.has('cap1')", timeout=12000)
    check("nothing shows it: it closes a few seconds later", True)
    ev("(() => { const z = project.zones[0]; z.layers = [newLayer('cap1')]; commit(); })()")
    pg.wait_for_function("mediaEls.has('cap1')", timeout=12000)
    check("shown again: it opens again by itself", True)
    pg.locator("#srcList .tile", has_text="HDMI").first.click(); settle(0.3)
    pg.locator("#rightBody button", has_text="Stop").click(); settle(0.3)
    check("Stop closes it and it stays closed while shown", not ev("mediaEls.has('cap1')") and ev("devState(srcById('cap1')).off"))
    settle(6)
    check("…for good, until Start", not ev("mediaEls.has('cap1')"))
    pg.locator("#rightBody button", has_text="Start").click()
    pg.wait_for_function("mediaEls.has('cap1')", timeout=10000)
    check("Start opens it again", True)

    # ---------- the Ambilight, around the picture we know
    ev(f"""(() => {{ const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
      const paint = () => {{ x.fillStyle = '#f00'; x.fillRect(0, 0, 160, 180); x.fillStyle = '#00f'; x.fillRect(160, 0, 160, 180); }};
      paint(); setInterval(paint, 40);
      project.sources.push(fixDeviceSource({{ id: 'pic', kind: 'camera', name: 'Picture', fit: 'stretch' }}));
      devState(srcById('pic')).off = true;
      const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(30); v.play(); mediaEls.set('pic', v);
      const z = project.zones[0], L = newLayer('b-ambilight'); z.layers = [L]; ui.layer = L.id; ui.rightTab = 'content'; commit(); renderRight(); }})()""")
    settle(0.5)
    check("the Ambilight is a built-in source", ev("!!srcById('b-ambilight') && srcById('b-ambilight').kind === 'ambilight'") and pg.locator("#srcList .tile", has_text="Ambilight").count() >= 1)
    check("following nothing yet, it shows nothing and asks for a source", ends() == ([0, 0, 0], [0, 0, 0]) and "Choose the picture it follows" in pg.locator("#rightBody").inner_text(), ends())
    pg.locator("#rightBody select[aria-label='What the Ambilight follows']").select_option("pic"); settle(1.2)
    check("chosen from the Content tab, a step of undo", ev("project.zones[0].layers[0].params['b-ambilight'].from") == "pic")
    a, b = ends()
    check("the light left of the picture is its left edge's red, right of it its right edge's blue", a[0] > 200 and a[2] < 40 and b[2] > 200 and b[0] < 40, (a, b))
    top = [col(1, i) for i in range(8)]
    check("along the top, the light follows the edge above it: red over the left half, blue over the right", top[1][0] > top[1][2] and top[6][2] > top[6][0], top)
    put = lambda js: ev(f"(() => {{ const P = project.zones[0].layers[0].params['b-ambilight']; {js}; }})()") or settle(0.6)
    put("P.gain = 1; P.saturation = 1; P.smooth = 0; P.falloff = 0"); a1, b1 = ends()
    put("P.gain = 0.5"); a, b = ends()
    check("Brightness at 50 %: the light half as bright", abs(a[0] / a1[0] - 0.5) < 0.06 and abs(b[2] / b1[2] - 0.5) < 0.06, (a1, a, b1, b))
    put("P.gain = 1; P.falloff = 1"); a2, b2 = ends()
    check("Fall-off: the light dims towards the zone's outer edge", a2[0] < a1[0] - 20 and b2[2] < b1[2] - 20, (a1, a2, b1, b2))
    put("P.falloff = 0; P.width = 1; P.height = 1; P.middle = 'black'"); a, b = ends()
    check("a picture filling the zone with Middle: Black leaves no light", a == [0, 0, 0] and b == [0, 0, 0], (a, b))
    put("P.middle = 'picture'"); a, b = ends()
    check("…and Middle: Picture shows the picture itself", a == [255, 0, 0] and b == [0, 0, 255], (a, b))
    put("P.width = 0.7; P.height = 0.7; P.middle = 'glow'"); settle(0.3)
    # smoothing: the picture swapped, the light follows over the smoothing time
    put("P.smooth = 2")
    ev("srcById('pic').proc.flipH = true"); time.sleep(0.25); a, b = ends()
    check("with Smoothing, the light eases towards a new picture instead of jumping", 30 < a[2] < 235 and 30 < a[0] < 235, (a, b))
    time.sleep(6); a, b = ends()
    check("…and gets there", a[2] > 200 and b[0] > 200, (a, b))
    put("P.smooth = 0; P.segments = 2")
    check("Segments and Depth are kept in range", ev("ambiParams({ params: { x: { segments: 999, depth: -1, middle: 'no', from: 3 } } }, { id: 'x' })")
          == {"from": "", "width": 0.7, "height": 0.7, "depth": 0.02, "segments": 64, "softness": 0.5, "falloff": 0.3, "gain": 1.2, "saturation": 1.3, "smooth": 0.25, "middle": "picture"})
    # an effect as its source
    put("P.from = 'b-solid'; P.segments = 16"); ev("(() => { project.zones[0].layers.unshift(Object.assign(newLayer('b-solid'), { on: false, params: { 'b-solid': { color: [0, 1, 0, 1] } } })); })()"); settle(0.8)
    a, b = ends()
    check("an effect as its source, with its layer's settings in the zone", a[1] > 200 and b[1] > 200 and a[0] < 40, (a, b))
    ev("(() => { project.zones[0].layers.shift(); const P = project.zones[0].layers[0].params['b-ambilight']; P.from = 'pic'; commit(); })()"); settle(0.6)
    sl = pg.locator("#rightBody .row", has=pg.locator(".lbl", has_text="Picture width")).locator("input[type=range]")
    ev("renderRight()"); settle(0.3)
    sl.fill("0.4"); sl.dispatch_event("input"); sl.dispatch_event("change"); settle(0.4)
    check("Picture width from the Content tab", abs(ev("project.zones[0].layers[0].params['b-ambilight'].width") - 0.4) < 1e-9)
    labels = [x.strip() for x in pg.locator("#rightBody .sec:has(h3:text-is('Ambilight')) .lbl").all_inner_texts()]
    check("its settings: source, picture size, middle, depth, segments, softness, fall-off, brightness, saturation, smoothing",
          all(k in labels for k in ["Source", "Picture width", "Picture height", "Middle", "Depth", "Segments", "Softness", "Fall-off", "Brightness", "Saturation", "Smoothing"]), labels)
    data = ev("JSON.parse(serialize())")
    check("a file keeps its settings on the layer", data["zones"][0]["layers"][0]["params"]["b-ambilight"]["from"] == "pic")
    ev("removeSource(srcById('pic'))"); settle(0.5)
    check("its source removed: nothing shows, and the Content tab says so", ends() == ([0, 0, 0], [0, 0, 0]) and "Missing: it was removed" in pg.locator("#rightBody").inner_text(), ends())
    ev("undo()"); settle(0.3)
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
  bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
