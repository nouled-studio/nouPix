# Video and image files: the formats are checked before a file is taken; trim, loop or once, hold or black at
# the end, restart when shown, sound and volume, and that the options are saved. Test files are made with ffmpeg.
import os, sys, time, shutil, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8153
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
if not shutil.which("ffmpeg"):
    print("SKIP: needs ffmpeg to make the test videos"); print("FAILED: none"); sys.exit(0)
D = tempfile.mkdtemp(prefix="olm-media-")
def ff(*a):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *a], check=True)
SRC = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=6"]
ff(*SRC, "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus", "-shortest", f"{D}/clip-vp9.webm")
ff(*SRC, "-c:v", "libvpx", "-b:v", "200k", f"{D}/clip-vp8.webm")
ff("-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "libopus", f"{D}/sound-only.webm")
ff("-f", "lavfi", "-i", "testsrc2=size=64x64", "-frames:v", "1", f"{D}/still.png")
try: ff(*SRC, "-t", "2", "-c:v", "libx265", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", f"{D}/clip-hevc.mp4")
except Exception: pass
open(f"{D}/broken.mp4", "wb").write(os.urandom(20000))
open(f"{D}/notes.txt", "w").write("not media")

bridge = start_bridge(PORT)
with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS + ["--autoplay-policy=no-user-gesture-required"]); pg = br.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    toasts = lambda: ev("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')")
    nsrc = lambda: ev("olm.project.sources.length")
    def add(name, wait=3.0):
        ev("document.querySelectorAll('.toast').forEach(t => t.remove())")
        pg.set_input_files("#fileMedia", f"{D}/{name}")
        t0 = time.time()
        while time.time() - t0 < wait and not ev("document.querySelectorAll('.toast').length"): time.sleep(0.1)
        time.sleep(0.2)
    vid = lambda: ev("""(() => { const s = olm.project.sources[olm.project.sources.length - 1], el = olm.mediaEl(s.id);
      return { s, t: el && el.currentTime, paused: el && el.paused, muted: el && el.muted, vol: el && el.volume, loop: el && el.loop, done: el && !!el._done, dur: el && el.duration }; })()""")

    # ---------- which files are taken
    check("the file picker lists the video and image formats", all(x in pg.get_attribute("#fileMedia", "accept") for x in [".mp4", ".mov", ".webm", ".mkv", ".png", ".jpg"]))
    n0 = nsrc()
    add("notes.txt"); check("a text file is refused, with the formats", nsrc() == n0 and "not a video or image" in toasts() and "WebM" in toasts(), toasts())
    add("broken.mp4", 8); check("a broken video is refused", nsrc() == n0 and "can't be played" in toasts(), toasts())
    add("sound-only.webm", 8); check("a file with only sound is refused", nsrc() == n0 and "no picture" in toasts(), toasts())
    if os.path.exists(f"{D}/clip-hevc.mp4"):
        add("clip-hevc.mp4", 8)
        check("H.265 is taken only where the browser plays it, else explained", nsrc() == n0 + 1 or "H.265/HEVC" in toasts(), toasts())
        if nsrc() > n0: ev("removeSource(olm.project.sources[olm.project.sources.length - 1])")
    add("still.png"); check("an image is taken", nsrc() == n0 + 1 and ev("olm.project.sources.at(-1).kind") == "image")
    add("clip-vp8.webm", 8); check("a VP8 WebM is taken", nsrc() == n0 + 2 and ev("olm.project.sources.at(-1).kind") == "video", toasts())
    add("clip-vp9.webm", 8); check("a VP9 WebM with sound is taken", nsrc() == n0 + 3, toasts())
    check("and says its size and length", "320 × 180, 0:06.0" in toasts(), toasts())
    v = vid()
    check("a new video loops whole, silent, as before", v["s"]["loop"] is True and v["loop"] is True and v["muted"] is True and v["s"]["trimIn"] == 0 and v["s"]["trimOut"] == 0, v)
    time.sleep(0.6); check("and plays", vid()["t"] > 0.2, vid()["t"])

    # ---------- the Content tab shows the options
    ev("olm.ui.rightTab = 'content'; renderRight()")
    body = pg.inner_text("#rightBody")
    check("Content tab: timeline, trim, play mode, sound", pg.locator("#rightBody .vtl").count() == 1 and all(x in body for x in ["Start (s)", "End (s)", "Loop", "Once", "Play its sound", "Restart each time it is shown", "320 × 180"]), body[-400:])

    endbox = pg.locator("#rightBody .row:has-text('End (s)') input")
    check("End shows the real end, not 0", abs(float(endbox.input_value()) - 6) < 0.1, endbox.input_value())
    endbox.fill("4"); endbox.press("Enter"); time.sleep(0.1)
    check("typing an end trims there", ev("olm.project.sources.at(-1).trimOut") == 4)
    endbox = pg.locator("#rightBody .row:has-text('End (s)') input"); endbox.fill("6"); endbox.press("Enter"); time.sleep(0.1)
    check("an end at the video's end means the whole video", ev("olm.project.sources.at(-1).trimOut") == 0)
    # ---------- trim and loop
    ev("(() => { const s = olm.project.sources.at(-1); s.trimIn = 2; s.trimOut = 3; applyVideoOptions(s, olm.mediaEl(s.id)); restartVideo(s, olm.mediaEl(s.id)); })()")
    ts = []
    for _ in range(14): time.sleep(0.2); ts.append(round(vid()["t"], 2))
    check("a trimmed video plays only between its start and end", all(1.95 <= t <= 3.08 for t in ts), ts)
    check("and loops back to its start", any(b < a for a, b in zip(ts, ts[1:])), ts)
    check("the browser's own loop is off when trimmed", vid()["loop"] is False)

    # ---------- once: hold or black
    ev("(() => { const s = olm.project.sources.at(-1); s.loop = false; s.trimIn = 4; s.trimOut = 0; applyVideoOptions(s, olm.mediaEl(s.id)); restartVideo(s, olm.mediaEl(s.id)); })()")
    time.sleep(3.0); v = vid()
    check("Once: stops at the end", v["done"] and v["paused"], v)
    check("and holds its last frame", ev("drawMedia(olm.project.sources.at(-1), 64, 36)") is True)
    ev("olm.project.sources.at(-1).endHold = false")
    check("or goes black", ev("drawMedia(olm.project.sources.at(-1), 64, 36)") is False)
    ev("olm.ui.rightTab = 'content'; renderRight()")
    check("the panel says it played once", "Played once" in pg.inner_text("#rightBody"))
    pg.click("#rightBody .transport button[aria-label=Restart]"); time.sleep(0.5); v = vid()
    check("Restart plays it again from its start", not v["done"] and not v["paused"] and 4 <= v["t"] < 5.5, v)

    # ---------- restart when shown
    ev("(() => { const s = olm.project.sources.at(-1); s.loop = true; s.restart = true; s.trimIn = 1; applyVideoOptions(s, olm.mediaEl(s.id)); })()")
    time.sleep(1.2)
    ev("loadSource('b-solid')"); time.sleep(0.9); ev("syncMedia()")   # after the crossfade
    check("not shown: paused", vid()["paused"])
    ev("loadSource(olm.project.sources.at(-1).id); syncMedia()"); time.sleep(0.3)
    v = vid(); check("shown again: from its start", not v["paused"] and 1 <= v["t"] < 1.6, v)

    # ---------- sound
    ev("olm.ui.rightTab = 'content'; renderRight()")
    pg.click("#rightBody label:has-text('Play its sound')"); time.sleep(0.2)
    v = vid(); check("Play its sound unmutes it", v["s"]["audio"] is True and v["muted"] is False, v)
    sl = pg.locator("#rightBody .row:has-text('Volume') input[type=range]")
    sl.evaluate("e => { e.value = 0.25; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }")
    v = vid(); check("Volume sets it", abs(v["vol"] - 0.25) < 0.01 and v["s"]["volume"] == 0.25, v)

    # ---------- the timeline seeks
    box = pg.locator("#rightBody .vtl").bounding_box()
    pg.mouse.click(box["x"] + box["width"] * 0.75, box["y"] + box["height"] / 2); time.sleep(0.1)
    check("clicking the timeline goes there", 4.2 <= vid()["t"] <= 5.4, vid()["t"])

    # ---------- play, pause, restart
    ev("(() => { const s = olm.project.sources.at(-1); s.loop = true; s.restart = false; s.trimIn = 1; s.trimOut = 5; s.audio = false; applyVideoOptions(s, olm.mediaEl(s.id)); })()")
    ev("olm.ui.rightTab = 'content'; renderRight()")
    tr = lambda label: pg.click(f"#rightBody .transport button[aria-label={label}]")
    check("three buttons: Restart, Play, Pause, as icons", pg.locator("#rightBody .transport button").count() == 3 and pg.locator("#rightBody .transport button svg").count() == 3)
    check("Play shows it is on while it plays", "on" in (pg.get_attribute("#rightBody .transport button[aria-label=Play]", "class") or ""))
    ev("olm.mediaEl(olm.project.sources.at(-1).id).currentTime = 2"); time.sleep(0.2)   # well before its end (5), so it won't loop round
    tr("Pause"); t1 = vid()["t"]; time.sleep(0.6); v = vid()
    check("Pause stops it where it is", abs(v["t"] - t1) < 0.05 and v["paused"], (t1, v["t"]))
    time.sleep(0.3); ev("syncMedia()"); time.sleep(0.3)
    check("and it stays paused", abs(vid()["t"] - t1) < 0.05)
    check("Pause shows it is on", "on" in (pg.get_attribute("#rightBody .transport button[aria-label=Pause]", "class") or ""))
    tr("Play"); ts = []
    for _ in range(6): time.sleep(0.2); ts.append(round(vid()["t"], 2))
    check("Play plays on from there", ts[-1] > ts[0] and not vid()["paused"], ts)
    ev("(() => { const s = olm.project.sources.at(-1); s.loop = false; applyVideoOptions(s, olm.mediaEl(s.id)); restartVideo(s, olm.mediaEl(s.id)); })()")
    time.sleep(4.6); check("played once to its end", vid()["done"])
    ev("olm.ui.rightTab = 'content'; renderRight()"); tr("Play"); time.sleep(0.4); v = vid()
    check("Play after the end plays it again from its start", not v["done"] and not v["paused"] and 1 <= v["t"] < 2, v)
    tr("Pause"); tr("Restart"); time.sleep(0.4); v = vid()
    check("Restart plays from its start, even when paused", not v["paused"] and 1 <= v["t"] < 2, v)
    ev("(() => { const s = olm.project.sources.at(-1); s.loop = true; s.trimIn = 0; s.trimOut = 0; applyVideoOptions(s, olm.mediaEl(s.id)); restartVideo(s, olm.mediaEl(s.id)); })()")

    # ---------- trimming with the mouse
    ev("olm.ui.rightTab = 'content'; renderRight()"); time.sleep(0.2)
    box = pg.locator("#rightBody .vtl").bounding_box(); y = box["y"] + box["height"] / 2
    def drag(sel, frac):
        hb = pg.locator(f"#rightBody .vtl {sel}").bounding_box()
        pg.mouse.move(hb["x"] + hb["width"] / 2, y); pg.mouse.down(); pg.mouse.move(box["x"] + box["width"] * frac, y, steps=6); pg.mouse.up(); time.sleep(0.2)
    drag(".trim.in", 0.3); s1 = ev("olm.project.sources.at(-1).trimIn")
    check("dragging the start handle trims the start", abs(s1 - 1.8) < 0.15, s1)
    drag(".trim.out", 0.8); s2 = ev("olm.project.sources.at(-1).trimOut")
    check("dragging the end handle trims the end", abs(s2 - 4.8) < 0.15, s2)
    check("the Start and End boxes show them", abs(float(pg.locator("#rightBody .row:has-text('Start (s)') input").input_value()) - s1) < 0.01 and abs(float(pg.locator("#rightBody .row:has-text('End (s)') input").input_value()) - s2) < 0.01)
    drag(".trim.in", 0.95); s3 = ev("[olm.project.sources.at(-1).trimIn, olm.project.sources.at(-1).trimOut]")
    check("the start can't pass the end", s3[0] <= s3[1] - 0.09, s3)
    drag(".trim.out", 0.0); s5 = ev("olm.project.sources.at(-1).trimIn")
    check("handles on top of each other: dragging left moves the start", s5 < 0.2, s5)
    drag(".trim.out", 1.0); s4 = ev("[olm.project.sources.at(-1).trimIn, olm.project.sources.at(-1).trimOut]")
    check("dragged to the ends: the whole video", s4 == [0, 0], s4)
    ev("undo()"); check("a trim is one undo step", ev("olm.project.sources.at(-1).trimOut") > 0)
    ev("(() => { const s = olm.project.sources.at(-1); s.trimIn = 1; s.trimOut = 0; s.restart = true; s.audio = true; })()")

    # ---------- saved with the project; old projects get the defaults
    saved = ev("JSON.parse(serialize(false)).sources.at(-1)")
    check("the options are saved", all(saved.get(k) == v for k, v in {"loop": True, "restart": True, "audio": True, "volume": 0.25, "trimIn": 1}.items()) and "reverse" not in saved, saved)
    old = ev("""(() => { const p = JSON.parse(serialize(false)); const s = p.sources.at(-1); for (const k of ['trimIn', 'trimOut', 'loop', 'endHold', 'restart', 'audio', 'volume']) delete s[k]; s.reverse = true;
      olm.loadProject(p); return olm.project.sources.at(-1); })()""")
    check("a video from an older project loops whole and silent", old["loop"] is True and old["audio"] is False and old["trimIn"] == 0 and old["trimOut"] == 0 and old["volume"] == 1, old)
    check("a project saved with backward playback opens playing forwards", "reverse" not in old and ev("olm.mediaEl(olm.project.sources.at(-1).id).playbackRate") > 0, old)
    check("no page errors", not errs, errs)
    br.close()
bridge.terminate()
shutil.rmtree(D, ignore_errors=True)
print("FAILED:", fails or "none")
