# The timeline's tools around the clips (timeline.js, ui-timeline.js) and a few things in the Scenes panel (ui-dock.js):
# the tempo found in the audio (made-up music at known tempos and downbeats; a file added found by itself, the grid in
# bars from its first downbeat, beat lines on the tracks, Detect), markers on the audio (+ Marker and M, the usual names,
# a colour, dragged and snapped, clicked to go there, renamed, deleted, a line through the zones, files and their
# repair), the audio track folded, the tracks' height (the bar beside them, Alt + scroll, kept), Fit; the scenes' three sizes per
# place; a zone stopped (■, its menu, a device: faded to black over the default fade, its playlist stopped, undo); the
# tick box drawn in the look.
import os, sys, time, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8264
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

# music made in the page: a kick on every beat (louder on the bar's first), hats between, at a tempo and a first downbeat
MUSIC = """(bpm, off, secs, sr = 22050) => {
  const d = new Float32Array(sr * secs), beat = 60 / bpm; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; ; k++) { const t = off + k * beat; if (t >= secs) break; const i0 = Math.floor(t * sr), acc = k % 4 === 0 ? 1 : 0.6;
    for (let j = 0; j < sr * 0.25 && i0 + j < d.length; j++) { const tt = j / sr; d[i0 + j] += acc * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12); }
    const h0 = Math.floor((t + beat / 2) * sr); for (let j = 0; j < sr * 0.04 && h0 + j < d.length; j++) d[h0 + j] += 0.15 * (rnd() * 2 - 1) * Math.exp(-j / sr * 80); }
  return { sampleRate: sr, numberOfChannels: 1, length: d.length, getChannelData: () => d, data: d };
}"""
# the same as a WAV file (16-bit mono)
WAV = """(m, name) => { const d = m.data, b = new DataView(new ArrayBuffer(44 + d.length * 2)), w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, m.sampleRate, true); b.setUint32(28, m.sampleRate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] * 0.8)) * 32767, true);
  return new File([b.buffer], name, { type: 'audio/wav' }); }"""

bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = br.new_page(viewport={"width": 1500, "height": 950})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    E = pg.evaluate
    E("localStorage.clear()")
    E(f"window.music = {MUSIC}; window.wav = {WAV}; true")

    # ---------- the tempo of made-up music
    res = E("[[128, 0.3], [174, 1.1], [95.5, 0.05], [140, 0.9]].map(([b, o]) => { const r = tlDetectBeat(music(b, o, 40)), bar = 240 / b; return [b, +(o % bar).toFixed(3), r && r.bpm, r && r.t0]; })")
    check("the tempo and the first downbeat of music at 128, 174, 95.5 and 140 BPM", all(r[2] and abs(r[2] - r[0]) < 0.05 and abs(r[3] - r[1]) < 0.03 for r in res), res)
    check("no beat in silence", E("tlDetectBeat({ sampleRate: 22050, numberOfChannels: 1, length: 22050 * 10, getChannelData: () => new Float32Array(22050 * 10) })") is None)
    nz = E("(() => { const d = new Float32Array(44100 * 20); let s = 9; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647 - 0.5) * 0.3; } const r = tlDetectBeat({ sampleRate: 44100, numberOfChannels: 1, length: d.length, getChannelData: () => d }); return !r || r.weak; })()")
    check("…nor in noise", nz)

    E("""(() => { olm.loadProject(demoProject()); for (const z of project.zones) while (z.scenes.length < 3) storeScene(z);
      const T = newTimeline(); project.timelines.push(T); ui.tlId = T.id; ui.dockTab = 'timeline'; ui.dockCollapsed = false; ui.dockH = 460; ui.tlZoom = 40; ui.tlRowH = 50; ui.tlAudioFold = false; commit(); renderDock(); })()""")
    time.sleep(0.4)
    T = "project.timelines[0]"
    E(f"addTimelineAudio({T}, wav(music(124, 0.6, 30), 'track.wav'))")
    try: pg.wait_for_function(f"{T}.grid === 'bars'", timeout=20000)
    except Exception: print(E("(() => { const K = project.timelines[0], A = K.audios[0]; return [A && [A.media, A._url, A._detect], [...tlPeaks.entries()].map(([k, v]) => [k && k.slice(-12), Object.keys(v), v.beat]), [...document.querySelectorAll('.toast')].map(t => t.textContent)]; })()"), errs); raise
    time.sleep(0.3)
    check("an audio file added: its tempo found by itself, the grid in bars from its first downbeat", E(f"[{T}.bpm, Math.abs({T}.beat0 - 0.6) < 0.03]") == [124, True], E(f"[{T}.bpm, {T}.beat0]"))
    check("…said in a message", "124 BPM" in E("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ')"))
    lbl = E("[...$$('#dockBody .tltick.major')].slice(0, 2).map(e => [e.textContent, parseFloat(e.style.left)])")
    check("…the ruler's first bar at the downbeat", lbl[0][0] == "1" and abs(lbl[0][1] - 0.6 * 40) < 1, lbl)
    check("…faint beat lines on the tracks", pg.locator("#dockBody .tltrack.beats").count() == E("project.zones.length") and pg.locator("#dockBody .tlaudio.beats").count() == 1)
    b0 = E(f"{T}.beat0")
    check("…clips snap to the beats", abs(E(f"tlSnapT({T}, {b0} + 60 / 124 * 3 + 0.05)") - (b0 + 60 / 124 * 3)) < 1e-6)
    E(f"{T}.bpm = 100; {T}.beat0 = 0; commit({{ lists: false }}); refreshTimeline()"); time.sleep(0.2)
    pg.locator("#dockBody .tlbar button:has-text('Detect')").click(); time.sleep(0.3)
    check("Detect finds them again", E(f"[{T}.bpm, Math.abs({T}.beat0 - 0.6) < 0.03]") == [124, True])
    E("undo()"); time.sleep(0.2)
    check("…a step of undo", E(f"{T}.bpm") == 100)
    E("redo()"); time.sleep(0.2)
    pg.locator("#dockBody button[aria-label='Twice the tempo']").click(); time.sleep(0.2)
    check("×2 doubles the tempo, bar 1 where it was", E(f"[{T}.bpm, Math.abs({T}.beat0 - 0.6) < 0.03]") == [248, True])
    pg.locator("#dockBody button[aria-label='Half the tempo']").click(); time.sleep(0.2)
    check("÷2 halves it", E(f"{T}.bpm") == 124)
    rb = pg.locator("#dockBody .tlruler").bounding_box(); b0 = E(f"{T}.beat0")
    pg.mouse.click(rb["x"] + (b0 + 60 / 124 * 2 + 0.05) * 40, rb["y"] + 12, button="right"); time.sleep(0.2)
    pg.locator(".menu button:has-text('Bar 1 starts here')").click(); time.sleep(0.2)
    check("the ruler's menu: bar 1 on the beat nearest", abs(E(f"{T}.beat0") - (b0 + 60 / 124 * 2)) < 2e-3, (b0, E(f"{T}.beat0")))
    lbl = E("[...$$('#dockBody .tltick.major')].slice(0, 1).map(e => [e.textContent, parseFloat(e.style.left)])")
    check("…the ruler's bars from there", abs(lbl[0][1] / 40 - E(f"{T}.beat0")) < 0.03, lbl)
    E("undo()"); time.sleep(0.2)
    # a file with no beat: said so, the grid left alone
    E(f"(() => {{ const d = new Float32Array(22050 * 12); let s = 3; for (let i = 0; i < d.length; i++) {{ s = (s * 16807) % 2147483647; d[i] = (s / 2147483647 - 0.5) * 0.3; }} const K = newTimeline({{ name: 'Noise' }}); project.timelines.push(K); ui.tlId = K.id; commit({{ lists: false }}); refreshTimeline(); addTimelineAudio(K, wav({{ sampleRate: 22050, data: d }}, 'noise.wav')); }})()")
    try: pg.wait_for_function("[...document.querySelectorAll('.toast')].some(t => /No steady beat/.test(t.textContent))", timeout=45000)
    except Exception: print(E("(() => { const K = project.timelines.at(-1), A = K.audios[0]; return [ui.tlId === K.id, A && [A.media, A._url, A._detect], [...tlPeaks.entries()].map(([k, v]) => [k && k.slice(-12), Object.keys(v), v.beat]), [...document.querySelectorAll('.toast')].map(t => t.textContent)]; })()")); raise
    check("a file with no beat: said so, the grid left in seconds", E("project.timelines.at(-1).grid") == "sec")
    E(f"ui.tlId = {T}.id; refreshTimeline()"); time.sleep(0.2)

    # ---------- the audio's volume and mute
    A0 = f"{T}.audios[0]"
    vr = pg.locator("#dockBody input[aria-label='Volume of track.wav']")
    vr.evaluate("e => { e.value = 0.4; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }"); time.sleep(0.2)
    check("the audio's volume beside its name: the player follows, kept in the project", abs(E(f"tlAudio({A0}).volume") - 0.4) < 1e-3 and E(f"{A0}.vol") == 0.4)
    pg.locator("#dockBody button[aria-label='Mute track.wav']").click(); time.sleep(0.2)
    check("…mute: silent, the volume kept", E(f"tlAudio({A0}).volume") == 0 and E(f"{A0}.mute") is True and E(f"{A0}.vol") == 0.4)
    pg.locator("#dockBody button[aria-label='Unmute track.wav']").click(); time.sleep(0.2)
    check("…unmuted: back at 40%", abs(E(f"tlAudio({A0}).volume") - 0.4) < 1e-3)
    check("…files keep them, repaired", E(f"(() => {{ const p = JSON.parse(serialize()); p.timelines[0].audios[0].vol = 7; return hydrate(p).timelines[0].audios[0].vol; }})()") == 1)
    E(f"{A0}.vol = 1; tlAudioSync({T}, 0, false); commit({{ lists: false }}); refreshTimeline()")

    # ---------- several audio tracks: trimmed, moved, their volume's keys
    E("tlSnap = false")
    E(f"addTimelineAudio({T}, wav(music(100, 0.2, 10), 'second.wav'), 5)"); time.sleep(1.5)
    A1 = f"{T}.audios[1]"
    check("a second audio track, on a row of its own from where it was put, as long as its file",
          pg.locator("#dockBody .tlaclip").count() == 2 and pg.locator("#dockBody .tlaudio").count() == 2 and E(f"[{A1}.start, {A1}.trim, Math.round({A1}.dur)]") == [5, 0, 10], E(f"{A1}"))
    blk = lambda: pg.locator("#dockBody .tlaclip[data-audio='" + E(f"{A1}.id") + "']")
    drag = lambda part, dx: (lambda b: (pg.mouse.move(b["x"] + (2 if part == "l" else b["width"] - 2 if part == "r" else b["width"] / 2), b["y"] + 6), pg.mouse.down(),
                                       pg.mouse.move(b["x"] + (2 if part == "l" else b["width"] - 2 if part == "r" else b["width"] / 2) + dx, b["y"] + 6, steps=6), pg.mouse.up()))(blk().bounding_box())
    drag("l", 80); time.sleep(0.3)
    check("its start trimmed by its left edge: later on the timeline, as far into the file, shorter", E(f"[{A1}.start, {A1}.trim, {A1}.dur].map(v => Math.round(v * 10) / 10)") == [7, 2, 8], E(f"{A1}"))
    drag("r", 200); time.sleep(0.3)
    check("…its end by its right edge, never past the file's end", abs(E(f"{A1}.trim + {A1}.dur") - 10) < 0.05, E(f"{A1}"))
    drag("r", -80); time.sleep(0.3)
    check("…and shorter", abs(E(f"{A1}.dur") - 6) < 0.05, E(f"{A1}"))
    drag("m", 40); time.sleep(0.3)
    check("dragged by its middle, it moves, the trim kept", E(f"[{A1}.start, {A1}.trim].map(v => Math.round(v * 10) / 10)") == [8, 2], E(f"{A1}"))
    E(f"undo()"); time.sleep(0.2)
    check("…a step of undo", abs(E(f"{A1}.start") - 7) < 0.05)
    E(f"tlSeek({T}, 9); tlPlay({T})"); time.sleep(0.8)
    st = E(f"(() => {{ const a = tlAudios.get({A1}.id), b = tlAudios.get({T}.audios[0].id); return [a.paused, a.currentTime, b.paused, b.currentTime, tlPos()]; }})()")
    check("playing: each track from where it is, the second from its trim on", not st[0] and abs(st[1] - (st[4] - 7 + 2)) < 0.3 and not st[2] and abs(st[3] - st[4]) < 0.3, st)
    E(f"tlSeek({T}, 2)"); time.sleep(0.5)
    check("…silent before it starts, the first one playing", E(f"[tlAudios.get({A1}.id).paused, tlAudios.get({T}.audios[0].id).paused]") == [True, False])
    E("tlPause()")
    # its volume's keys: a line on its waveform; a double-click there adds one
    lv = blk().locator(".tllevel")
    check("its volume a line on its waveform (dashed: no keys yet)", lv.locator("path.none").count() == 1)
    b = lv.bounding_box(); pg.mouse.dblclick(b["x"] + b["width"] / 2, b["y"] + b["height"] * 0.75); time.sleep(0.3)
    K = E(f"({A1}.curves || [])[0]")
    check("…a double-click adds a key there (and the ends at full)", K and K["kind"] == "level" and len(K["keys"]) == 3 and 0.1 < K["keys"][1]["v"] < 0.45, K)
    E(f"{A1}.curves = [{{ kind: 'level', keys: [{{ t: 0, v: 0, ease: 'linear' }}, {{ t: 6, v: 1, ease: 'linear' }}] }}]; {A1}.vol = 0.8; commit({{ lists: false }}); refreshTimeline(); tlSeek({T}, 10); tlPlay({T})"); time.sleep(0.4)
    vv = E(f"[tlAudios.get({A1}.id).volume, tlPos()]")
    check("…the volume follows its keys as it plays, times its own volume", abs(vv[0] - 0.8 * (vv[1] - 7) / 6) < 0.05, vv)
    E("tlPause()")
    check("…its keys drawn on the line", blk().locator(".tlkey").count() == 2)
    check("both go into packages", {"second.wav", "track.wav"} <= set(n for n, m in E("packageMedia().map(s => [s.name, s.media])") if m), E("packageMedia().map(s => [s.name, s.media])"))
    sv = json.loads(E("serialize()"))["timelines"][0]["audios"]
    check("files keep each track: start, trim, length, volume, its keys", len(sv) == 2 and sv[1]["trim"] == 2 and sv[1]["curves"][0]["keys"][1]["v"] == 1 and "_url" not in sv[1], sv[1])
    old = E("""(() => { const p = JSON.parse(serialize()); delete p.timelines[0].audios; p.timelines[0].audio = { name: 'old.wav', media: '0123456789abcdef0123456789abcdef.wav', vol: 0.5, mute: true };
      return hydrate(p).timelines[0].audios.map(A => [A.name, A.media, A.start, A.trim, A.vol, A.mute]); })()""")
    check("a file from before (one audio): its track, from the start", old == [["old.wav", "0123456789abcdef0123456789abcdef.wav", 0, 0, 0.5, True]], old)
    # its menu, and Delete
    blk().click(button="right"); time.sleep(0.2)
    check("its menu: mute, the tempo in it, another file, remove", all(pg.locator(".menu button", has_text=re.compile("^" + t)).count() == 1 for t in ["Mute", "Find the tempo in it", "Another file in its place", "Remove(?! all)"]))
    pg.keyboard.press("Escape")
    blk().click(); pg.mouse.move(5, 5); pg.keyboard.press("Delete"); time.sleep(0.3)
    check("Delete removes the track picked", E(f"{T}.audios.length") == 1 and pg.locator("#dockBody .tlaclip").count() == 1)
    E("tlSnap = true")

    # ---------- the bar: buttons without boxes; the loop around everything
    look = E("""(() => { const bs = [...$$('#dockBody .tlbar .gbtn')], cs = bs.map(b => getComputedStyle(b));
      return [bs.length > 10, cs.every(c => c.borderTopWidth === '0px' && (c.backgroundColor === 'rgba(0, 0, 0, 0)' || c.backgroundColor === 'transparent')),
        ['Off', 'All', 'Region', 'Loop around everything', 'Fit', '+ Marker', '+ Audio', 'Snap'].every(l => $(`#dockBody .tlbar button[aria-label='${l}']`))]; })()""")
    check("the timeline's bar: its buttons without boxes, an icon each for the loop, Fit, + Marker, + Audio and Snap", look == [True, True, True], look)
    pg.locator("#dockBody .tlbar button[aria-label='Loop around everything']").click(); time.sleep(0.3)
    lp = E(f"[{T}.loop.mode, {T}.loop.a, {T}.loop.b, Math.min(...{T}.audios.map(A => A.start)), Math.max(...{T}.audios.map(A => A.start + tlAudioLen(A)))]")
    check("…loop around everything: the region from the first thing on the timeline to the last, Region on", lp[0] == "region" and abs(lp[1] - lp[3]) < 0.01 and abs(lp[2] - min(lp[4], E(f"{T}.length"))) < 0.01
          and E("$('#dockBody .tlbar button[aria-label=Region]').classList.contains('on')"), lp)
    E("undo()"); time.sleep(0.2)
    pg.locator("#dockBody .tlbar button[aria-label='Snap']").click(); time.sleep(0.1)
    check("…Snap a magnet that turns off and on", E("tlSnap") is False and E("$('#dockBody .tlbar button[aria-label=Snap]').getAttribute('aria-pressed')") == "false")
    pg.locator("#dockBody .tlbar button[aria-label='Snap']").click(); time.sleep(0.1)
    check("…the stage's Fit the same icon", E("!!$('#btnFit svg.li') && $('#btnFit').classList.contains('gbtn')"))

    # ---------- markers
    E(f"tlSeek({T}, 4); refreshTimeline()"); time.sleep(0.2)
    pg.mouse.move(700, 120); pg.keyboard.press("m"); time.sleep(0.3)
    check("M asks for a marker at the playhead, with the usual names", pg.locator(".modal[aria-label=Marker]").count() == 1 and pg.locator(".modal .tlpresets button").count() == 5)
    pg.locator(".modal .tlpresets button:has-text('Drop')").click()
    pg.locator(".modal[aria-label=Marker] .swatches button").nth(3).click()
    pg.locator(".modal[aria-label=Marker] .btn.primary").click(); time.sleep(0.3)
    m = E(f"{T}.markers")
    check("…named Drop, coloured, at 4 s", len(m) == 1 and m[0]["name"] == "Drop" and abs(m[0]["t"] - 4) < 1e-6 and m[0]["color"] == E("TAGS[2]"), m)
    check("…a flag on the audio with its name, a line through the zones", pg.locator("#dockBody .tlaudio .tlflag").text_content() == "Drop" and pg.locator("#dockBody .tlmline").count() == 1)
    pg.locator("#dockBody .tlbar button[aria-label='+ Marker']").click(); time.sleep(0.2)
    pg.locator(".modal[aria-label=Marker] input").fill("Break"); pg.keyboard.press("Enter"); time.sleep(0.3)
    check("+ Marker, a name typed and Enter", [x["name"] for x in E(f"{T}.markers")] == ["Drop", "Break"] or [x["name"] for x in E(f"{T}.markers")] == ["Break", "Drop"])
    E(f"{T}.markers.find(x => x.name === 'Break').t = 10; commit({{ lists: false }}); refreshTimeline()"); time.sleep(0.2)
    f = pg.locator("#dockBody .tlflag[data-marker='" + E(f"{T}.markers.find(x => x.name === 'Break').id") + "']"); fb = f.bounding_box()
    x, y = fb["x"] + 4, fb["y"] + 6
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 2 * 40 + 3, y, steps=5); pg.mouse.up(); time.sleep(0.3)
    bt = E(f"{T}.markers.find(x => x.name === 'Break').t")
    b0 = E(f"{T}.beat0")
    check("a marker dragged moves, snapped to the beat", abs((bt - b0) / (60 / 124) - round((bt - b0) / (60 / 124))) < 1e-3 and abs(bt - 12.07) < 0.3, bt)
    pg.locator("#dockBody .tlflag").first.click(); time.sleep(0.2)
    check("a marker clicked: the playhead goes there", abs(E(f"tlPos()") - E(f"{T}.markers[0].t")) < 1e-6)
    pg.locator("#dockBody .tlflag").first.dblclick(); time.sleep(0.2)
    pg.locator(".modal[aria-label=Marker] input").fill("Big drop"); pg.keyboard.press("Enter"); time.sleep(0.3)
    check("a double-click renames it", E(f"{T}.markers[0].name") == "Big drop")
    pg.locator("#dockBody .tlflag").first.click(button="right"); time.sleep(0.2)
    pg.locator(".menu button:has-text('Delete')").click(); time.sleep(0.3)
    check("its menu deletes it", len(E(f"{T}.markers")) == 1)
    rep = E(f"(() => {{ const p = JSON.parse(serialize()); p.timelines[0].markers.push({{ t: 999, name: 5 }}, {{ t: 'x' }}, 'y', {{ t: 2, name: 'Intro', color: 'red' }}); return hydrate(p).timelines[0].markers.map(m => [m.t, m.name, m.color]); }})()")
    check("files keep the markers, repaired (in the timeline, a name, a known colour)", rep[0] == [2, "Intro", ""] and rep[-1][0] == 60 and len(rep) == 3, rep)

    # ---------- the audio folded, the height, Fit
    h0 = pg.locator("#dockBody .tlaudio").bounding_box()["height"]
    pg.locator("#dockBody .tlfold").click(); time.sleep(0.3)
    check("the audio folds to a thin line, its markers still on it", pg.locator("#dockBody .tlaudio").bounding_box()["height"] < 20 < h0 and pg.locator("#dockBody .tlaudio .tlflag").count() == 1 and pg.locator("#dockBody .tlwave").count() == 0)
    check("…kept", E("JSON.parse(localStorage.getItem('noupix.ui')).tlAudioFold") is True)
    pg.locator("#dockBody .tlfold").click(); time.sleep(0.3)
    check("…and opens again", pg.locator("#dockBody .tlaudio").bounding_box()["height"] > 40)
    trk = lambda: pg.locator("#dockBody .tltrack").first.bounding_box()["height"]
    t0 = trk(); eb = pg.locator("#dockBody .tlzbar.v .tlend.b").bounding_box(); x, y = eb["x"] + eb["width"] / 2, eb["y"] + eb["height"] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x, y - 60, steps=5); pg.mouse.up(); time.sleep(0.3)
    check("the bar beside the tracks, its end dragged in: the tracks taller, kept", trk() > t0 + 10 and E("JSON.parse(localStorage.getItem('noupix.ui')).tlRowH") == E("ui.tlRowH"), (t0, trk()))
    t1 = trk(); sb = pg.locator("#dockBody .tlscroll").bounding_box()
    pg.mouse.move(sb["x"] + 400, sb["y"] + 120); pg.keyboard.down("Alt"); pg.mouse.wheel(0, 200); pg.keyboard.up("Alt"); time.sleep(0.3)
    check("Alt + scroll makes them shorter", trk() < t1 - 2, (t1, trk()))
    E(f"(() => {{ const z = project.zones[0]; addClip({T}, z, z.scenes[0].id, 2); {T}.tracks[z.id][0].dur = 20; commit({{ lists: false }}); refreshTimeline(); }})()"); time.sleep(0.2)
    pg.locator("#dockBody .tlbar button[aria-label='Fit']").click(); time.sleep(0.4)
    vw = pg.locator("#dockBody .tlscroll").bounding_box()
    endx = E("(() => { const c = $$('#dockBody .tlclip').at(-1).getBoundingClientRect(); return c.right; })()")
    check("Fit: the clips across the view", endx <= vw["x"] + vw["width"] and endx > vw["x"] + vw["width"] * 0.6, (endx, vw))
    gh = E("$('#dockBody .tlgrid').scrollHeight")
    check("…the tracks filling its height", gh <= vw["height"] + 2 and gh > vw["height"] * 0.8, (gh, vw["height"]))

    # ---------- the scenes' sizes
    E("ui.dockTab = 'scenes'; renderDock()"); time.sleep(0.3)
    w = lambda: pg.locator("#dockBody .scene").first.bounding_box()["width"]
    check("three sizes at the scenes' foot, medium at first", E("[...$$('#dockBody .ssize button')].map(b => b.dataset.size + (b.classList.contains('on') ? '*' : ''))") == ["s", "m*", "l"])
    wm = w(); pg.locator("#dockBody .ssize button[data-size=l]").click(); time.sleep(0.3); wl = w()
    pg.locator("#dockBody .ssize button[data-size=s]").click(); time.sleep(0.3); ws = w()
    check("large and small", wl > wm > ws, (ws, wm, wl))
    E("setXfadeOn(true)"); time.sleep(0.3); pg.keyboard.press("Escape")
    cols = lambda: E("(() => { const t = $$('#dockBody .xfpair .zoneblock')[0].querySelectorAll('.scene'); return new Set([...t].map(e => Math.round(e.getBoundingClientRect().top))).size ? getComputedStyle($('#dockBody .xfpair .stiles')).gridTemplateColumns.split(' ').length : 0; })()")
    c_s = cols(); pg.locator("#dockBody .ssize button[data-size=m]").click(); time.sleep(0.3); c_m = cols()
    check("A and B side by side: 4 to a row in medium, more in small", c_m == 4 and c_s == 5, (c_s, c_m))
    E("setXfadeOn(false)"); time.sleep(0.2)
    E("setPanelPlace('scenes', 'right')"); time.sleep(0.4)
    check("each place has its own: medium on the right while small at the bottom", E("ui.sceneSize.right") == "m" and E("ui.sceneSize.bottom") == "m" and pg.locator("#rightHost .ssize button.on").get_attribute("data-size") == "m")
    pg.locator("#rightHost .ssize button[data-size=l]").click(); time.sleep(0.3)
    check("…large there, kept", E("JSON.parse(localStorage.getItem('noupix.ui')).sceneSize.right") == "l" and pg.locator("#rightHost .scenepanel.ss-l").count() == 1)
    E("setPanelPlace('scenes', 'bottom')"); time.sleep(0.4)

    # ---------- a zone stopped
    Z = E("project.zones.at(-1).id")
    E(f"(() => {{ const z = zoneById('{Z}'); goScene(z, z.scenes[1], true); }})()"); time.sleep(0.3)
    pl = E(f"(() => {{ const z = zoneById('{Z}'); addPlaylist(z, {{ steps: z.scenes.map(s => newStep(s.id, 5)) }}); playlistDo(z, z.playlists[0], 'start'); return !!z._play; }})()")
    time.sleep(0.6); n0 = E("hist.idx")   # (after the scene's own step, saved 350 ms after it)
    btn = pg.locator(f"#dockBody .zoneblock[data-zone='{Z}'] .zstop")
    check("■ on the zone's head", btn.count() == 1 and btn.is_enabled())
    btn.click(); time.sleep(0.15)
    st = E(f"(() => {{ const z = zoneById('{Z}'); return [z.layers.length, z.scene, !!z._fade, z._fade && z._fade.dur, !!z._play]; }})()")
    check("■ fades it to black over the fade for new scenes, its playlist stopped", st[0] == 0 and st[1] is None and st[2] and st[3] == E("project.settings.fade") and not st[4], (pl, st))
    check("…a step of undo; the button now off", E("hist.idx") == n0 + 1 and pg.locator(f"#dockBody .zoneblock[data-zone='{Z}'] .zstop").is_disabled())
    E("undo()"); time.sleep(0.3)
    check("undo brings its content back", E(f"zoneById('{Z}').layers.length") > 0)
    E(f"remoteFromDevice('x', 'remote', {{ op: 'stop', zone: '{Z}' }})"); time.sleep(0.2)
    check("a device stops it too", E(f"zoneById('{Z}').layers.length") == 0)
    E("undo()"); time.sleep(0.3)
    pg.locator(f"#dockBody .zoneblock[data-zone='{Z}'] .zhead").click(button="right"); time.sleep(0.2)
    pg.locator(".menu button:has-text('Stop')").click(); time.sleep(0.2)
    check("…and its menu", E(f"zoneById('{Z}').layers.length") == 0)

    # ---------- the tick box
    tb = E("(() => { const i = document.createElement('input'); i.type = 'checkbox'; document.body.append(i); const a = getComputedStyle(i), o0 = getComputedStyle(i, '::before').opacity; i.checked = true; const o1 = getComputedStyle(i, '::before').opacity; const r = [a.appearance, a.width, o0, o1]; i.remove(); return r; })()")
    time.sleep(0.2)
    check("the tick box: a thin square drawn by the look, its thin red tick shown only when ticked", tb[0] == "none" and tb[1] == "14px" and tb[2] == "0", tb)
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
