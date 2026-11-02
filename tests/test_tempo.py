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
# Music made up in the page, run through ONSET_WORKLET and TempoTracker hop by hop: per second, [bpm, holding, the beat's
# offset from the nearest true beat in beats]
BENCH = r"""(() => {
  const SR = 48000; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const kick = (b, t, a = 0.8) => { const i0 = Math.round(t * SR); for (let k = 0; k < 0.25 * SR && i0 + k < b.length; k++) { const tt = k / SR; b[i0 + k] += a * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 9); } };
  const hat = (b, t, a = 0.2) => { const i0 = Math.round(t * SR); for (let k = 0; k < 0.04 * SR && i0 + k < b.length; k++) b[i0 + k] += a * (rnd() * 2 - 1) * Math.exp(-k / SR * 80); };
  const clap = (b, t, a = 0.3) => { const i0 = Math.round(t * SR); for (let k = 0; k < 0.15 * SR && i0 + k < b.length; k++) { const tt = k / SR; b[i0 + k] += a * ((rnd() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * 190 * tt)) * Math.exp(-tt * 25); } };
  const note = (b, t, f, d, a = 0.25) => { const i0 = Math.round(t * SR); for (let k = 0; k < d * SR && i0 + k < b.length; k++) { const tt = k / SR; b[i0 + k] += a * Math.sin(2 * Math.PI * f * tt) * Math.min(1, tt * 200) * Math.exp(-tt * 3); } };
  const scen = {
    hats: () => { const b = new Float32Array(30 * SR), beats = []; for (let t = 0.3; t < 30; t += 60 / 128) { kick(b, t); beats.push(t); } for (let i = 0; i < 180; i++) hat(b, rnd() * 30, 0.15 + rnd() * 0.2); return { b, beats }; },
    break: () => { const b = new Float32Array(34 * SR), P = 60 / 124, beats = []; for (let t = 0.3; t < 34; t += P) { beats.push(t); if (t < 12 || t > 19) { kick(b, t); hat(b, t + P / 2); } }
      for (let t = 12; t < 19; t += 0.15 + rnd() * 0.4) note(b, t, [220, 262, 330, 392, 440, 523][Math.floor(rnd() * 6)], 0.4);
      for (let t = 12.1; t < 19; t += 0.3 + rnd() * 0.6) note(b, t, [82, 98, 110][Math.floor(rnd() * 3)], 0.3, 0.5); return { b, beats }; },
    synco: () => { const b = new Float32Array(30 * SR), P = 60 / 126, beats = []; for (let t = 0.3; t < 30; t += P) { kick(b, t); beats.push(t); if (rnd() < 0.7) note(b, t + P * (rnd() < 0.5 ? 0.5 : 0.75), 65, 0.2, 0.6); hat(b, t + P / 2, 0.1); } return { b, beats }; },
    change: () => { const b = new Float32Array(40 * SR), beats = []; for (let t = 0.3; t < 18; t += 0.5) { kick(b, t); beats.push(t); } for (let t = 18.13; t < 40; t += 60 / 128) { kick(b, t); beats.push(t); } return { b, beats }; },
    // a DJ's high-pass: the kick 30 dB down for 32 beats under busy hi-hats and stray claps, then back
    filter: () => { const b = new Float32Array(36 * SR), P = 60 / 142, beats = []; for (let t = 0.3; t < 36; t += P) { beats.push(t); const f = t > 12 && t < 25.5;
      kick(b, t, f ? 0.024 : 0.8); for (let q = 0; q < 4; q++) hat(b, t + q * P / 4, f ? 0.25 : 0.1); if (f && rnd() < 0.5) clap(b, t + P * (0.25 + rnd() * 0.5)); } return { b, beats }; },
    noise: () => { const b = new Float32Array(20 * SR); let y = 0; for (let i = 0; i < b.length; i++) { y = 0.98 * y + 0.02 * (rnd() * 2 - 1); b[i] = y * 3 + (rnd() * 2 - 1) * 0.05; } return { b, beats: [] }; },
  };
  const out = {};
  for (const [name, f] of Object.entries(scen)) {
    seed = 7; const { b, beats } = f(); let Cls; const ons = [];
    const AWP = class { constructor() { this.port = { postMessage: m => ons.push(m) }; } };
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', ONSET_WORKLET)(AWP, (n, c) => { Cls = c; }, SR, 0);
    const p = new Cls(); for (let i = 0; i + 128 <= b.length; i += 128) p.process([[b.subarray(i, i + 128)]]);
    const rate = SR / 512, T = new TempoTracker(rate), rows = [];
    ons.forEach((m, i) => { T.push(m[1], m[2]);
      if (i % Math.round(rate) === 0) {
        let pe = null;
        if (T.beatHop != null && beats.length) { const bt = (T.beatHop + 1) * 512 / SR, near = beats.reduce((a, x) => Math.abs(x - bt) < Math.abs(a - bt) ? x : a, beats[0]); pe = (bt - near) / (60 / T.bpm); }
        rows.push([T.bpm, T.hold, pe]);
      } });
    out[name] = rows;
  }
  return out;
})()"""
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
    check("Settings has a Tempo section: the BPM, the nouPix mark, the bar's four beats", sec.count() == 1 and sec.locator(".tbpm").count() == 1 and sec.locator(".tmark svg").count() == 1
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
    # the mark lights on each beat (from red to white) and fades back; the lines count the bar
    seen, mixes = set(), set()
    for _ in range(60):
        r = ev("(() => { const s = document.querySelector('#tempoSec'); return [[...s.querySelectorAll('.tbar i')].findIndex(i => /on|one/.test(i.className)), s.querySelector('.tmark').style.color]; })()")
        seen.add(r[0]); mixes.add(r[1])
        time.sleep(0.05)
    check("the bar's lines count 1 2 3 4", seen >= {0, 1, 2, 3}, seen)
    lit = [m for m in mixes if "var(--live) " in m and " 0%" not in m]
    check("the mark lights with the beat and fades back to red", lit and any(" 0%" in m for m in mixes), sorted(mixes)[:4])

    # ---------- the trim
    ev("tempoTrim(-12)"); time.sleep(1.5)
    lv2 = ev("tempo.level")
    check("the trim turns the input down", ev("ui.tempoTrim") == -12 and ev("tempo.gain.gain.value") < 0.3, (lv, lv2))
    ev("tempoTrim(0)")

    # ---------- the spectrum and the beat band
    spec = pg.locator("#tempoSec .tspec")
    check("listening shows the spectrum and the beat trace", spec.count() == 1 and pg.locator("#tempoSec .ttrace").count() == 1 and spec.bounding_box()["height"] > 30)
    time.sleep(0.3)
    lit = ev("(() => { const c = document.querySelector('#tempoSec .tspec'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) n++; return n; })()")
    check("the spectrum is drawn", lit > 50, lit)
    check("the beat band starts on the kick drum, 40 to 150 Hz", ev("tempoBandNow()") == [40, 150])
    box = spec.bounding_box(); W = box["width"]
    import math as _m
    xf = lambda f: box["x"] + _m.log(f / 20) / _m.log(16000 / 20) * W
    pg.mouse.move(xf(150), box["y"] + 20); pg.mouse.down(); pg.mouse.move(xf(110), box["y"] + 20, steps=4); pg.mouse.up(); time.sleep(0.2)
    hi = ev("tempoBandNow()[1]")
    check("its top edge is dragged down", 100 < hi < 125 and ev("store.get('noupix.ui').tempoHi") == hi, hi)
    pg.mouse.move(xf(60), box["y"] + 20); pg.mouse.down(); pg.mouse.move(xf(240), box["y"] + 20, steps=6); pg.mouse.up(); time.sleep(0.2)
    lo2, hi2 = ev("tempoBandNow()")
    check("dragging inside moves the whole band, keeping its width", lo2 > 120 and abs(hi2 / lo2 - hi / 40) < 0.15, (lo2, hi2))
    ev("tempoBand(40, 150)"); time.sleep(1.5)
    lv_kick = ev("tempo.peak")
    ev("tempoBand(4000, 12000)"); time.sleep(1.5)
    lv_hats = ev("tempo.peak")
    check("the meter reads the band: the kick's band much louder than the hi-hat's", lv_hats < lv_kick - 6, (lv_kick, lv_hats))
    spec.dblclick(); time.sleep(0.2)
    check("a double-click gives 40 to 150 Hz back", ev("tempoBandNow()") == [40, 150])

    # ---------- 2/4 and Downbeat
    pg.locator("#tempoSec .seg button", has_text="2/4").click(); time.sleep(0.2)
    check("2/4: two lines", pg.locator("#tempoSec .tbar i").count() == 2 and ev("tempoBpb()") == 2)
    pg.locator("#tempoSec .seg button", has_text="4/4").click(); time.sleep(0.2)
    ev("tempoDownbeat()")
    check("Downbeat: the beat nearest now is 1", ev("(() => { const a = tempoAt(); return a.inBar === 0 || (a.inBar === 3 && a.phase > 0.5) || (a.inBar === 0 && a.phase < 0.5); })()"))

    # ---------- tapping
    r = ev("""(() => { const t = performance.now() - 2000; [0, 500, 1000, 1500, 2000].forEach(d => tempoTap(t + d)); return [tempo.bpm, ui.tempoSrc, tempoAt(t).inBar, tempoAt(t + 500).inBar, +tempoAt(t + 2000).phase.toFixed(3)]; })()""")
    check("taps half a second apart: 120 BPM, the first tap is beat 1, the beat on the taps", abs(r[0] - 120) < 0.01 and r[1] == "tap" and r[2] == 0 and r[3] == 1 and (r[4] < 0.01 or r[4] > 0.99), r)
    b0 = ev("tempo.bpm"); time.sleep(1.0)
    check("tapping while listening switches to Tap, and the listening leaves the beat alone", ev("tempo.bpm") == b0 and ev("tempo.on"))
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
    check("each press of the pad is a tap", ev("tempo.taps.length") == 4 and 80 < ev("tempo.bpm") < 170, (ev("tempo.taps.length"), ev("tempo.bpm")))

    # ---------- the tracker on made-up music (the app's own worklet and tracker, faster than real time)
    res = ev(BENCH)
    def rows(name): return res[name]
    r = rows("hats")
    check("kick with random hi-hats: 128, the beat on the kick", all(abs(b - 128) < 0.5 for b, h, p in r[6:]) and all(p is not None and abs(p) < 0.08 for b, h, p in r[8:]), r[4:10])
    r = rows("break")
    check("a 7 s break (melody and a bass riff, no kick): the BPM stays, then the kick is followed again",
          all(abs(b - 124) < 1 for b, h, p in r[5:]) and any(h for b, h, p in r[13:21]) and all(abs(p) < 0.08 for b, h, p in r[25:]), [x for x in r[10:26]])
    check("while it holds, the beat stays where it was", all(abs(p) < 0.15 for b, h, p in r[10:24] if p is not None), [round(p, 2) for b, h, p in r[10:24]])
    r = rows("synco")
    check("a syncopated bass line doesn't move the beat off the kick", all(abs(b - 126) < 0.5 for b, h, p in r[6:]) and all(abs(p) < 0.08 for b, h, p in r[8:]), r[6:12])
    r = rows("change")
    check("a new track at another tempo is followed within 9 s (a settled tempo gives way only to one that holds 3 s)", all(abs(b - 120) < 0.6 for b, h, p in r[3:26]) and all(abs(b - 128) < 0.5 for b, h, p in r[27:]) and all(abs(p) < 0.08 for b, h, p in r[29:]), [round(b, 1) for b, h, p in r[18:30]])
    r = rows("filter")
    check("a filtered build-up (the kick gone, busy hi-hats and claps): the BPM holds, and it says it is holding", all(abs(b - 142) < 0.6 for b, h, p in r[5:]) and all(h for b, h, p in r[18:26]), [(round(b, 1), h) for b, h, p in r[12:29]])
    check("when the kick comes back the beat is where it was", all(abs(p) < 0.12 for b, h, p in r[27:]) and all(abs(p) < 0.08 for b, h, p in r[30:]), [round(p, 2) for b, h, p in r[26:]])
    r = rows("noise")
    check("noise without a beat: it never claims one", all(h for b, h, p in r))

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
