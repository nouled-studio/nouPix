# NDI in: a test source sent with the NDI library (ndi_sender.py) is found by the bridge, chosen in the page, received
# and mapped onto the fixtures, and follows when its picture changes; Light and Full quality, the frame cut down to
# size, files and undo, the source going away and coming back, removing it, a device, and a bridge without NDI.
# Needs the NDI library (NDI Tools, or NOUPIX_NDI_LIB pointing at libndi); without it only the "not installed" part runs.
import os, sys, time, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
import noupix
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8212
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)
def wait(fn, t=8.0):
    end = time.time() + t
    while time.time() < end:
        v = fn()
        if v: return v
        time.sleep(0.2)
    return fn()

# the bridge cuts frames down by taking every n-th pixel and row, whatever the stride
d = bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 0]) * 3
check("frames are cut down to size, every n-th pixel and row", noupix.shrink_rgba(3, 3, 16, d, 2) == (2, 2, bytes([1, 2, 3, 4, 9, 10, 11, 12]) * 2)
      and noupix.shrink_rgba(3, 3, 16, d, 5) == (3, 3, bytes(range(1, 13)) * 3))
have = bool(noupix.Ndi().lib)
os.environ.setdefault("NOUPIX_NDI_EXTRA_IPS", "127.0.0.1")   # this computer's own sources, where multicast doesn't pass

with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    # ---------- a bridge without NDI: the window says how to get it
    env = os.environ.copy()
    os.environ["NOUPIX_NDI_LIB"] = "/nowhere/libndi.so"
    b0 = start_bridge(PORT + 1)
    if env.get("NOUPIX_NDI_LIB") is None: del os.environ["NOUPIX_NDI_LIB"]
    else: os.environ["NOUPIX_NDI_LIB"] = env["NOUPIX_NDI_LIB"]
    try:
        pg = br.new_page(viewport={"width": 1440, "height": 900})
        pg.goto(f"http://127.0.0.1:{PORT + 1}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.4)
        pg.click("#btnAddSrc"); pg.get_by_text("NDI or OMT stream…").click()
        note = wait(lambda: "NDI Tools" in pg.locator(".vmodal").inner_text() and pg.locator(".vmodal").inner_text())
        check("without NDI the window says to install NDI Tools", bool(note), pg.locator(".vmodal").inner_text())
        pg.get_by_role("button", name="Cancel").click()
        check("Cancel closes it", pg.locator(".vmodal").count() == 0)
        pg.close()
    finally:
        b0.kill()
    if not have:
        print("PASS NDI isn't installed here (set NOUPIX_NDI_LIB to the NDI library): the rest is skipped")
        br.close(); print("FAILED:", fails or "none"); sys.exit(0)

    import ndi_sender
    snd = ndi_sender.Sender("nouPix test", 320, 180)
    bridge = start_bridge(PORT)
    try:
        pg = br.new_page(viewport={"width": 1440, "height": 900})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
        pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
        ev = pg.evaluate
        ev("""(() => { const p = blankProject('N'); p.settings.compW = 200; p.settings.compH = 100; p.settings.transition = 0;
          p.zones = [newZone({ w: 200, h: 100, layers: [newLayer('b-rainbow')] })];
          p.fixtures = [newFixture('line', { x1: 40, y1: 50, x2: 160, y2: 50, pixels: 2 })];
          olm.loadProject(p); ui.selZone = olm.project.zones[0].id; renderAll(); })()"""); time.sleep(0.5)

        # ---------- found and chosen
        pg.click("#btnAddSrc"); pg.get_by_text("NDI or OMT stream…").click()
        row = pg.locator(".vrow", has_text="nouPix test")
        check("the window lists the NDI sources on the network", wait(lambda: row.count() == 1), pg.locator(".vmodal").inner_text())
        row.click()
        src = ev("olm.project.sources.at(-1)")
        check("choosing one adds a source that plays in the selected layer", src["kind"] == "stream" and src["stream"].endswith("(nouPix test)") and src["name"] == "nouPix test"
              and ev("olm.project.zones[0].layers[0].src") == src["id"], src)
        sid = src["id"]
        check("it's received", wait(lambda: ev(f"streamState(srcById('{sid}')) === 'ok' && mediaEls.has('{sid}')")), ev("streams.status"))
        col = lambda: ev("Array.from(olm.project.fixtures[0]._col)")
        red_blue = lambda c: c[0] > 200 and c[2] < 40 and c[3] < 40 and c[5] > 200
        check("its picture reaches the fixtures (red on the left, blue on the right)", wait(lambda: red_blue(col())), col())
        check("the list tags it NDI, with a picture", ev(f"(() => {{ const t = [...document.querySelectorAll('#srcList .tile')].find(e => e.textContent.includes('nouPix test')); return t && t.querySelector('.tag').textContent; }})()") == "NDI")
        check("the Content tab shows the stream and its size", "Receiving, 320 × 180" in pg.locator("#rightBody").inner_text() if pg.locator("#rightBody").count() else "Receiving, 320 × 180" in pg.inner_text("body"))

        # ---------- live: the picture changes
        snd.left, snd.right = (0, 255, 0), (255, 255, 0)
        check("it follows the source as it changes", wait(lambda: (lambda c: c[1] > 200 and c[0] < 40 and c[3] > 200 and c[4] > 200)(col()), 4), col())
        fps = ev(f"(() => {{ const c = mediaEls.get('{sid}'); const n = c._frames; return new Promise(r => setTimeout(() => r(c._frames - n), 2000)); }})()")
        check("frames keep coming (about the source's 30 a second)", fps >= 30, fps)

        # ---------- quality
        pg.get_by_role("button", name="Full").click()
        check("Full asks for the whole stream", ev(f"srcById('{sid}').hq") is True and wait(lambda: ev("Object.keys(streams.status).some(k => k.endsWith('|1') && streams.status[k].state === 'ok')")), ev("streams.status"))
        check("and the picture goes on", wait(lambda: (lambda c: c[1] > 200)(col())), col())
        ev("undo()")
        check("undo goes back to Light", ev(f"srcById('{sid}').hq") is False and wait(lambda: ev("Object.keys(streams.status).every(k => k.endsWith('|0'))")), ev("streams.status"))

        # ---------- files
        saved = ev("JSON.parse(serialize())")
        s2 = next(s for s in saved["sources"] if s["id"] == sid)
        check("saved with its stream, quality and fit, not its picture", s2["stream"] == src["stream"] and s2["proto"] == "ndi" and s2["hq"] is False and s2["fit"] == "stretch", s2)
        ev("olm.loadProject(JSON.parse(serialize()))")
        check("opened again, it's received again", wait(lambda: ev(f"streamState(srcById('{sid}')) === 'ok' && mediaEls.has('{sid}')")) and wait(lambda: col()[1] > 200), col())
        bad = ev("hydrate({ sources: [{ id: 'q', kind: 'stream', name: 5, proto: 'xyz', hq: 'yes' }] }).sources.find(s => s.id === 'q')")
        check("a hand-edited stream source is repaired", bad["proto"] == "ndi" and bad["stream"] == "" and bad["hq"] is False and bad["name"] == "5", bad)

        # ---------- the source goes away, and comes back
        snd.close()
        check("when it stops sending the list shows OFF", wait(lambda: ev(f"streamState(srcById('{sid}'))") == "waiting", 8)
              and wait(lambda: ev("[...document.querySelectorAll('#srcList .tile')].some(t => t.textContent.includes('nouPix test') && t.querySelector('.tag.warn'))")))
        snd = ndi_sender.Sender("nouPix test", 320, 180)
        snd.left = (0, 0, 255)
        check("and it comes back by itself", wait(lambda: col()[2] > 200, 15), col())

        # ---------- another source for it, from its menu
        snd2 = ndi_sender.Sender("Second", 160, 90); snd2.left = snd2.right = (255, 255, 255)
        pg.locator("#srcList .tile", has_text="nouPix test").click(button="right")
        pg.get_by_text("Choose stream…").click()
        r2 = pg.locator(".vrow", has_text="Second")
        check("the menu lets you choose another source for it", wait(lambda: r2.count() == 1) and pg.locator(".vrow.on").count() == 1)
        r2.click()
        check("which then plays in its place", wait(lambda: (lambda c: min(c[:6]) > 200)(col())) and ev(f"srcById('{sid}').stream").endswith("(Second)"), col())
        snd2.close()

        # ---------- removed
        ev(f"removeSource(srcById('{sid}'))"); time.sleep(1.5)
        check("removing it stops receiving", ev("streams.canvases.size") == 0 and ev("streams.keys") == "" and not ev(f"mediaEls.has('{sid}')"))
        check("no errors", not errs, errs[:3])
        pg.close()
    finally:
        bridge.kill()
        try: snd.close()
        except Exception: pass
    br.close()
print("FAILED:", fails or "none")
