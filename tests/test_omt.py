# OMT in (Open Media Transport): the bridge's binding of libomt checked against a stand-in library built from the real
# libomt.h (omt_fake.c, with a C compiler): the source found, chosen, its BGRA frames (rows padded past their width)
# turned into RGBA on the fixtures, the 1/8 preview for Light and the whole picture for Full, following its colours,
# the source stopping and coming back, and the window naming what isn't installed (NDI, here).
import os, sys, time, subprocess, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8214
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

cc = shutil.which("cc") or shutil.which("clang") or shutil.which("gcc")
if not cc or os.name == "nt":
    print("PASS no C compiler here: OMT not checked"); print("FAILED: none"); sys.exit(0)
tmp = tempfile.mkdtemp()
lib = os.path.join(tmp, "libomt.dylib" if sys.platform == "darwin" else "libomt.so")
subprocess.run([cc, "-shared", "-fPIC", "-O2", "-o", lib, os.path.join(HERE, "omt_fake.c")], check=True, cwd=HERE)
colors = os.path.join(tmp, "colors")
def put(*c): open(colors + ".new", "w").write(" ".join(map(str, c))); os.replace(colors + ".new", colors)
put(255, 0, 0, 0, 0, 255)
os.environ.update(NOUPIX_OMT_LIB=lib, FAKE_OMT_COLORS=colors, NOUPIX_NDI_LIB="/nowhere/libndi.so")

bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    ev = pg.evaluate
    ev("""(() => { const p = blankProject('O'); p.settings.compW = 200; p.settings.compH = 100; p.settings.transition = 0;
      p.zones = [newZone({ w: 200, h: 100, layers: [newLayer('b-rainbow')] })];
      p.fixtures = [newFixture('line', { x1: 40, y1: 50, x2: 160, y2: 50, pixels: 2 })];
      olm.loadProject(p); ui.selZone = olm.project.zones[0].id; renderAll(); })()"""); time.sleep(0.5)

    pg.click("#btnAddSrc"); pg.get_by_text("NDI or OMT stream…").click()
    row = pg.locator(".vrow", has_text="nouPix OMT")
    check("the window lists the OMT source", wait(lambda: row.count() == 1) and "OMT" in row.inner_text(), pg.locator(".vmodal").inner_text())
    check("and says NDI isn't installed", "NDI Tools" in pg.locator(".vmodal").inner_text())
    row.click()
    src = ev("olm.project.sources.at(-1)"); sid = src["id"]
    check("choosing it adds an OMT source", src["kind"] == "stream" and src["proto"] == "omt" and src["stream"] == "NOUPIX-TEST (nouPix OMT)" and src["name"] == "nouPix OMT", src)
    check("it's received, as the 1/8 preview for Light", wait(lambda: ev("Object.values(streams.status).some(s => s.state === 'ok' && s.size[0] === 40 && s.size[1] === 23)")), ev("streams.status"))
    col = lambda: ev("Array.from(olm.project.fixtures[0]._col)")
    check("its colours arrive the right way round (BGRA to RGBA), padded rows and all", wait(lambda: (lambda c: c[0] > 240 and c[2] < 15 and c[3] < 15 and c[5] > 240)(col())), col())
    check("the list tags it OMT", wait(lambda: ev("[...document.querySelectorAll('#srcList .tile')].some(t => t.textContent.includes('nouPix OMT') && t.querySelector('.tag').textContent === 'OMT')")))
    put(0, 255, 0, 255, 255, 0)
    check("it follows the source", wait(lambda: (lambda c: c[1] > 240 and c[0] < 15 and c[3] > 240 and c[4] > 240 and c[5] < 15)(col())), col())
    pg.get_by_role("button", name="Full").click()
    check("Full gets the whole picture", wait(lambda: ev("Object.values(streams.status).some(s => s.state === 'ok' && s.size[0] === 320 && s.size[1] === 180)")), ev("streams.status"))
    check("and the colours stay right", wait(lambda: (lambda c: c[1] > 240 and c[3] > 240)(col())), col())
    os.remove(colors)
    check("when it stops the source shows OFF", wait(lambda: ev(f"streamState(srcById('{sid}'))") == "waiting"))
    put(0, 0, 255, 0, 0, 255)
    check("and it comes back by itself", wait(lambda: (lambda c: c[2] > 240 and c[5] > 240)(col()), 15), col())
    saved = ev("JSON.parse(serialize())")
    check("saved as an OMT stream", any(s.get("proto") == "omt" and s.get("hq") is True for s in saved["sources"]))
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill(); shutil.rmtree(tmp, ignore_errors=True)
print("FAILED:", fails or "none")
