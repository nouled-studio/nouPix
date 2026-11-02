# Tempo: the BPM found by listening to a sound input (Chrome's stand-in microphone plays a beat made here: a kick on
# every beat at 128 BPM, a hi-hat between), the beat clock (steady, the bar's beats counting, 4/4 or 2/4, Downbeat),
# tapping (the button, the beat following the taps, a MIDI pad mapped to Tap tempo), Settings (the readout, the
# input, the trim and its meter), what this computer keeps, and devices not offered it.
import os, sys, time, math, random, struct, wave, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error, FAKE_MIDI
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8236
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

def beat_file(bpm, secs=40, sr=48000):
    n = sr * secs; buf = [0.0] * n; P = 60.0 / bpm; rnd = random.Random(1); t = 0.0
    while t < secs:
        i0 = int(t * sr)
        for k in range(min(int(0.25 * sr), n - i0)):
            tt = k / sr
            buf[i0 + k] += 0.8 * math.sin(2 * math.pi * (50 + 90 * math.exp(-tt * 30)) * tt) * math.exp(-tt * 9)
        j0 = int((t + P / 2) * sr)
        for k in range(max(0, min(int(0.04 * sr), n - j0))):
            buf[j0 + k] += 0.15 * (rnd.random() * 2 - 1) * math.exp(-k / sr * 80)
        t += P
    path = os.path.join(tempfile.mkdtemp(prefix="noupix-beat-"), "beat.wav")
    w = wave.open(path, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 30000)) for x in buf)); w.close()
    return path

wav = beat_file(128)
bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS + ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                                                "--use-file-for-fake-audio-capture=" + wav, "--autoplay-policy=no-user-gesture-required"])
    ctx = br.new_context(viewport={"width": 1440, "height": 950}); ctx.add_init_script(FAKE_MIDI)
    ctx.grant_permissions(["microphone"], origin=f"http://127.0.0.1:{PORT}")
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    ev("ui.rightTab = 'settings'; showRight(true); renderRight()"); time.sleep(0.3)
    sec = pg.locator("#tempoSec")
    check("Settings has a Tempo section: the BPM, the dot, the bar's four beats", sec.count() == 1 and sec.locator(".tbpm").count() == 1 and sec.locator(".tdot").count() == 1
          and sec.locator(".tbar i").count() == 4)
    check("off at first, the beat from Audio", not ev("tempo.on") and "OFF" in sec.locator(".onsw").inner_text() and ev("ui.tempoSrc || 'audio'") == "audio")

    # ---------- listening
    sec.locator(".onsw").click()
    pg.wait_for_function("tempo.on", timeout=8000)
    check("Listen on: it listens, and names the input", ev("tempo.on") and pg.locator("#tempoSec select[aria-label='Sound input'] option").count() >= 1
          and "OFF" not in pg.locator("#tempoSec .onsw").inner_text())
    pg.wait_for_function("tempo.locked && Math.abs(tempo.bpm - 128) < 1", timeout=20000)
    time.sleep(3)
    bpm = ev("tempo.bpm")
    check("it finds the beat: 128 BPM, within half a beat a minute", abs(bpm - 128) < 0.5, bpm)
    check("the readout says so", pg.locator("#tempoSec .tbpm").inner_text() == f"{bpm:.1f}" or abs(float(pg.locator('#tempoSec .tbpm').inner_text()) - 128) < 0.5, pg.locator("#tempoSec .tbpm").inner_text())
    lv = ev("tempo.level")
    check("the meter reads the input", lv > -40, lv)
    # steady: where the beats fall moves less than a tenth of a beat over 3 s
    grid = lambda: ev("(() => { const P = 60000 / tempo.bpm; return ((tempo.anchor % P) + P) % P / P; })()")
    g0 = grid(); time.sleep(3); g1 = grid()
    drift = min(abs(g1 - g0), 1 - abs(g1 - g0))
    check("the beat stays where it is", drift < 0.1, (g0, g1))
    # the dot lights on each beat, and the lines count the bar
    seen, lit = set(), 0
    for _ in range(60):
        r = ev("(() => { const s = document.querySelector('#tempoSec'); return [[...s.querySelectorAll('.tbar i')].findIndex(i => /on|one/.test(i.className)), s.querySelector('.tdot').className]; })()")
        seen.add(r[0]); lit += 1 if ("on" in r[1] or "one" in r[1]) else 0
        time.sleep(0.05)
    check("the bar's lines count 1 2 3 4", seen >= {0, 1, 2, 3}, seen)
    check("the dot blinks with the beat", 0 < lit < 60, lit)

    # ---------- the trim
    ev("tempoTrim(-12)"); time.sleep(1.5)
    lv2 = ev("tempo.level")
    check("the trim turns the input down", ev("ui.tempoTrim") == -12 and ev("tempo.gain.gain.value") < 0.3, (lv, lv2))
    ev("tempoTrim(0)")

    # ---------- 2/4 and Downbeat
    pg.locator("#tempoSec .seg button", has_text="2/4").click(); time.sleep(0.2)
    check("2/4: two lines", pg.locator("#tempoSec .tbar i").count() == 2 and ev("tempoBpb()") == 2)
    pg.locator("#tempoSec .seg button", has_text="4/4").click(); time.sleep(0.2)
    ev("tempoDownbeat()")
    check("Downbeat: the beat nearest now is 1", ev("(() => { const a = tempoAt(); return a.inBar === 0 || (a.inBar === 3 && a.phase > 0.5) || (a.inBar === 0 && a.phase < 0.5); })()"))

    # ---------- tapping
    r = ev("""(() => { const t = performance.now() - 2000; [0, 500, 1000, 1500, 2000].forEach(d => tempoTap(t + d)); return [tempo.bpm, ui.tempoSrc, tempoAt(t).inBar, tempoAt(t + 500).inBar, +tempoAt(t + 2000).phase.toFixed(3)]; })()""")
    check("taps half a second apart: 120 BPM, the first tap is beat 1, the beat on the taps", abs(r[0] - 120) < 0.01 and r[1] == "tap" and r[2] == 0 and r[3] == 1 and (r[4] < 0.01 or r[4] > 0.99), r)
    check("tapping while listening switches to Tap, and the analysis leaves the beat alone", ev("(() => { const b = tempo.bpm; tempoAnalyse(); return tempo.bpm === b; })()"))
    r = ev("""(() => { const t = performance.now(); [0, 600, 1210, 1790, 2400].forEach(d => tempoTap(t + 5000 + d)); return tempo.bpm; })()""")
    check("a pause starts a new run; uneven taps give their average", abs(r - 100) < 1, r)
    pg.click("#tempoSec .btn:text-is('Tap')"); time.sleep(0.1)
    check("the Tap button taps", ev("tempo.taps.length") >= 1)
    check("the tapped BPM is kept for next time", abs(ev("ui.tempoBpm") - 100) < 1.5 and ev("store.get('noupix.ui').tempoSrc") == "tap", ev("ui.tempoBpm"))

    # ---------- a MIDI pad onto Tap tempo
    ev("setMidiOn(true)"); time.sleep(0.5)
    check("Tap tempo is a target MIDI can drive", ev("midiTargetLabel('tap')") == "Tap tempo")
    ev("project.midi.maps.push(newMidiMap('midi:Fake Controller:1:note:40', 'tap')); commit()")
    ev("tempo.taps.length = 0")
    for i in range(4):
        ev("midiIn({ port: 'Fake Controller', ch: 1, type: 'on', num: 40, val: 100 }); midiIn({ port: 'Fake Controller', ch: 1, type: 'off', num: 40, val: 0 })")
        time.sleep(0.4)
    check("each press of the pad is a tap", ev("tempo.taps.length") == 4 and abs(ev("tempo.bpm") - 150) < 15, (ev("tempo.taps.length"), ev("tempo.bpm")))

    # ---------- off, kept, devices
    pg.locator("#tempoSec .seg button", has_text="Audio").click(); time.sleep(0.2)
    pg.locator("#tempoSec .onsw").click(); time.sleep(0.5)
    check("Listen off: it stops listening", not ev("tempo.on") and ev("ui.tempoOn") is False)
    check("this computer's settings are kept, not in the project", "tempo" not in ev("serialize()").lower())
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
