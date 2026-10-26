# The media library and packages: a video and an image added are copied into the bridge's library once (by content),
# play from there with seeking, and load again in a new session without relinking; Export package shows what goes in
# and its weight, and writes the project with its media; opening the package on "another computer" (another bridge with
# an empty library) plays it; a project alone there asks to relink; cleaning the library keeps this project's files.
import os, sys, time, json, shutil, subprocess, tempfile, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, fetch
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8218
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)
def wait(fn, t=10.0):
    end = time.time() + t
    while time.time() < end:
        v = fn()
        if v: return v
        time.sleep(0.2)
    return fn()
if not shutil.which("ffmpeg"):
    print("SKIP: needs ffmpeg to make the test video"); print("FAILED: none"); sys.exit(0)
D = tempfile.mkdtemp(prefix="noupix-media-test-")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=160x90:rate=25:duration=4", "-c:v", "libvpx", "-b:v", "100k", f"{D}/red.webm"], check=True)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=64x32", "-frames:v", "1", f"{D}/blue.png"], check=True)
LIB_A, LIB_B = f"{D}/libA", f"{D}/libB"
lib = lambda d: sorted(os.listdir(d)) if os.path.isdir(d) else []
PROJ = """(() => { const p = blankProject('Media show'); p.settings.compW = 100; p.settings.compH = 50; p.settings.transition = 0;
  p.zones = [newZone({ w: 100, h: 50, layers: [newLayer('b-rainbow')] })]; p.fixtures = [newFixture('line', { x1: 20, y1: 25, x2: 80, y2: 25, pixels: 2 })];
  olm.loadProject(p); ui.selZone = olm.project.zones[0].id; renderAll(); })()"""
errs = []
def page(br, port):
    pg = br.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) and "404" not in m.text else None)   # a file not in the library is a 404, by design
    pg.goto(f"http://127.0.0.1:{port}/"); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    return pg
red = lambda ev: (lambda c: c[0] > 200 and c[1] < 40 and c[2] < 40)(ev("Array.from(olm.project.fixtures[0]._col)"))

os.environ["NOUPIX_MEDIA_DIR"] = LIB_A
bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = page(br, PORT); ev = pg.evaluate
    ev(PROJ); time.sleep(0.3)
    # ---------- into the library
    pg.set_input_files("#fileMedia", f"{D}/red.webm")
    vid = wait(lambda: ev("(project.sources.find(s => s.kind === 'video') || {}).media"))
    check("a video added goes into the media library, named by its content", bool(vid) and lib(LIB_A) == [vid] and vid.endswith(".webm"), (vid, lib(LIB_A)))
    check("and plays", wait(lambda: red(ev)), ev("Array.from(olm.project.fixtures[0]._col)"))
    with open(f"{D}/red.webm", "rb") as f: same = f.read() == open(os.path.join(LIB_A, vid), "rb").read()
    check("the copy is the file, byte for byte", same)
    r = fetch(f"http://127.0.0.1:{PORT}/media/{vid}", headers={"Range": "bytes=10-19"})
    check("the library serves ranges (a video can seek)", r.status == 206 and len(r.read()) == 10 and r.headers["Content-Range"].startswith("bytes 10-19/"))
    pg.set_input_files("#fileMedia", f"{D}/blue.png")
    img = wait(lambda: ev("(project.sources.find(s => s.kind === 'image') || {}).media"))
    pg.set_input_files("#fileMedia", f"{D}/red.webm"); time.sleep(1.5)
    check("an image too; the same file added twice is kept once", bool(img) and lib(LIB_A) == sorted([vid, img]) and ev("project.sources.filter(s => s.media === '%s').length" % vid) == 2, lib(LIB_A))
    ev("(() => { const z = project.zones[0]; z.layers[0].src = project.sources.find(s => s.kind === 'video').id; commit(); })()"); time.sleep(0.5)

    # ---------- a new session: no relinking
    pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); ev = pg.evaluate
    check("in a new session the video loads from the library by itself", wait(lambda: ev("[...mediaEls.values()].some(e => e instanceof HTMLVideoElement && e.src.includes('/media/'))")))
    check("and plays on the fixtures, no relinking", wait(lambda: red(ev)), ev("Array.from(olm.project.fixtures[0]._col)"))
    check("the list shows no RELINK", wait(lambda: ev("![...document.querySelectorAll('#srcList .tag')].some(t => t.textContent === 'RELINK')")))
    seek = ev("""(() => { const el = [...mediaEls.values()].find(e => e instanceof HTMLVideoElement); el.currentTime = 2.5;
      return new Promise(r => el.addEventListener('seeked', () => r(el.currentTime), { once: true })); })()""")
    check("it seeks", abs(seek - 2.5) < 0.2, seek)

    # ---------- export package
    ev("project.sources.push({ id: 'nofile', kind: 'video', name: 'Never stored.mp4', fit: 'fit' })")
    ev("packageDialog()")
    dlg = pg.locator(".pkmodal")
    check("Export package lists the project, each file with its size, and the total", wait(lambda: dlg.count() == 1) and "red.webm" in dlg.inner_text() and "blue.png" in dlg.inner_text() and "Total" in dlg.inner_text(), dlg.inner_text() if dlg.count() else "")
    check("and names what isn't in the library", "Never stored.mp4" in dlg.locator(".note.warn").inner_text())
    ev("project.sources = project.sources.filter(s => s.id !== 'nofile')")
    # where the browser can write files (Chrome, the app): asked where, then streamed straight into the file
    ev("""(() => { window._pkg = []; window._pkgName = null;
      window.showSaveFilePicker = async o => ({ name: o.suggestedName, createWritable: async () => new WritableStream({ write: c => { window._pkg.push(c.length); } }) }); })()""")
    dlg.get_by_role("button", name="Export").click()
    streamed = wait(lambda: dlg.count() == 0 and ev("window._pkg.reduce((a, b) => a + b, 0)"))
    check("with a file picker the package is written straight into the chosen file", streamed and streamed > os.path.getsize(f"{D}/red.webm"), streamed)
    ev("packageDialog()"); dlg = pg.locator(".pkmodal"); wait(lambda: dlg.count() == 1)
    ev("window.showSaveFilePicker = undefined")
    with pg.expect_download() as dl: dlg.get_by_role("button", name="Export").click()
    pkg = f"{D}/{dl.value.suggested_filename}"; dl.value.save_as(pkg)
    names = zipfile.ZipFile(pkg).namelist()
    check("it writes name.noupixpkg: the project and its media", dl.value.suggested_filename == "Media-show.noupixpkg" and sorted(names) == sorted(["project.noupix", "media/" + vid, "media/" + img]), (dl.value.suggested_filename, names))
    # the package comes in chunks, its end marked in the stream, and its connection carries the next request
    import http.client
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=15)
    c.request("POST", "/package", body=json.dumps({"project": "{}", "media": [vid]}), headers={"Content-Type": "application/json"})
    tok = json.loads(c.getresponse().read())["token"]
    c.request("GET", f"/package/{tok}/x.noupixpkg"); r = c.getresponse(); body = r.read()
    import io
    zipped = zipfile.ZipFile(io.BytesIO(body))
    chunked = r.getheader("Transfer-Encoding") == "chunked" and not r.will_close and zipped.testzip() is None and sorted(zipped.namelist()) == sorted(["project.noupix", "media/" + vid])
    c.request("GET", f"/package/{tok}/x.noupixpkg"); r = c.getresponse(); r.read()
    check("a package is sent in chunks, whole, on a connection that stays open (a firewall's reset can't cut it short unseen)", chunked and r.status == 404, (r.status,))
    c.close()
    pg.close(); bridge.kill()

    # ---------- another computer: an empty library
    os.environ["NOUPIX_MEDIA_DIR"] = LIB_B
    bridge = start_bridge(PORT)
    pg = page(br, PORT); ev = pg.evaluate
    plain = f"{D}/plain.noupix"; open(plain, "w").write(json.dumps(json.loads(zipfile.ZipFile(pkg).read("project.noupix"))))
    pg.set_input_files("#fileOpen", plain); time.sleep(2)
    check("there, the project alone asks to relink its video", wait(lambda: ev("[...document.querySelectorAll('#srcList .tag')].some(t => t.textContent === 'RELINK')")))
    pg.set_input_files("#fileOpen", pkg)
    check("opening the package puts its media into that library", wait(lambda: lib(LIB_B) == sorted([vid, img])), lib(LIB_B))
    check("and opens the project, named after the package", wait(lambda: ev("project.name") == "Media-show"), ev("project.name"))
    check("which plays its video at once", wait(lambda: red(ev)), ev("Array.from(olm.project.fixtures[0]._col)"))
    # ---------- cleaning the library
    ev("(() => { const s = project.sources.find(s => s.kind === 'image'); project.sources = project.sources.filter(x => x !== s); commit(); })()")
    ev("(() => { ui.rightTab = 'settings'; renderRight(); })()"); time.sleep(0.5)
    check("Settings shows the media library's size", wait(lambda: "kB in" in pg.inner_text("#rightBody") or "MB in" in pg.inner_text("#rightBody")))
    pg.get_by_role("button", name="Remove what this project doesn’t use…").click()
    pg.locator(".modal").get_by_role("button", name="Remove").click()
    check("cleaning it keeps only this project's files", wait(lambda: lib(LIB_B) == [vid]), lib(LIB_B))
    check("the video still plays", red(ev))
    # ---------- opened by its path (a double-click in the Finder or Explorer, passed on by the desktop app)
    shutil.rmtree(LIB_B, ignore_errors=True)
    ev("t => openPath(t)", pkg)
    check("a package opened by its path: its media into the library, the project open", wait(lambda: lib(LIB_B) == sorted([vid, img]) and ev("project.name") == "Media-show"), (lib(LIB_B), ev("project.name")))
    check("and its video plays", wait(lambda: red(ev)))
    ev("t => openPath(t)", plain)
    check("a project file by its path opens too, named after the file", wait(lambda: ev("project.name") == "plain"), ev("project.name"))
    ok = fetch(f"http://127.0.0.1:{PORT}/open-path", data=json.dumps({"path": "/etc/passwd"}).encode()).status == 400
    check("only nouPix files are opened by path", ok)
    # ---------- files
    bad = ev("hydrate({ sources: [{ id: 'q', kind: 'video', name: 'q', media: '../../etc/passwd' }, { id: 'r', kind: 'video', name: 'r', media: '%s' }] }).sources.filter(s => s.id === 'q' || s.id === 'r').map(s => s.media || null)" % vid)
    check("a project only keeps media names the library can have", bad == [None, vid], bad)
    ok = fetch(f"http://127.0.0.1:{PORT}/media/..%2Fx.webm").status == 404
    check("and the bridge serves nothing but library files", ok)
    ok = fetch(f"http://127.0.0.1:{PORT}/media?name=x.webm", data=b"x", headers={"Origin": "https://example.com"}).status == 403
    check("other websites can't put files in it", ok)
    check("no errors", not errs, errs[:3])
    br.close()
finally:
    bridge.kill(); shutil.rmtree(D, ignore_errors=True)
print("FAILED:", fails or "none")
