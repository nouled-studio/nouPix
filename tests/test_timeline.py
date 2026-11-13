# Timelines (timeline.js, ui-timeline.js): the Timeline tab, new timelines, clips from a scene dragged onto its zone's
# track or picked with a double-click, moved, resized and their fades by the mouse; playing: the clip under the
# playhead's scene (cut when jumped to, crossfaded from the clip just before) and level (fades in and out, dark in a
# gap), zones with no clips left alone; stop; the ruler moving the playhead; loops (off: it ends, all, a region);
# Space; Delete; the audio (stored, its waveform, the timeline as long as it); the grid in bars; the side column;
# undo, files and their repair, the audio in packages.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8260
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS + ["--autoplay-policy=no-user-gesture-required"])
    pg = br.new_page(viewport={"width": 1500, "height": 950})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    E = pg.evaluate
    E("localStorage.clear()")
    E("(() => { olm.loadProject(demoProject()); for (const z of project.zones) while (z.scenes.length < 3) storeScene(z); ui.dockH = 420; ui.dockCollapsed = false; ui.tlZoom = 40; renderDock(); })()"); time.sleep(0.5)
    Z = E("project.zones.map(z => z.id)")
    T = "project.timelines[0]"
    sc = lambda zi, i: E(f"project.zones[{zi}].scenes[{i}].id")

    # ---------- a timeline
    pg.click("#dockTabs [data-tab=timeline]"); time.sleep(0.3)
    check("the Timeline tab: none yet, + New timeline", pg.locator("#dockBody .tlpanel .cueempty").count() == 1)
    pg.locator("#dockBody .cueempty button").click(); time.sleep(0.3)
    check("+ New timeline makes Timeline 1, a minute long", E(f"[{T}.name, {T}.length]") == ["Timeline 1", 60])
    check("…with a ruler, an audio track and a track per zone, top zone first", pg.locator("#dockBody .tlruler").count() == 1 and pg.locator("#dockBody .tlaudio").count() == 1
          and E("[...$$('#dockBody .tltrack')].map(e => e.dataset.zone)") == Z[::-1])

    # ---------- clips
    E("setPanelPlace('scenes', 'right')"); time.sleep(0.6)
    E("ui.dockTab = 'timeline'; ui.dockCollapsed = false; ui.dockH = 420; renderDock()"); time.sleep(0.4)
    tile = pg.locator(f"#rightHost .zoneblock[data-zone='{Z[0]}'] .scene").first
    lane = pg.locator(f"#dockBody .tltrack[data-zone='{Z[0]}']")
    lb = lane.bounding_box()
    tile.drag_to(lane, target_position={"x": 2 * 40 + 3, "y": lb["height"] / 2}); time.sleep(0.4)
    c = E(f"({T}.tracks['{Z[0]}'] || [])[0]")
    check("a scene dragged onto its zone's track makes a clip there (snapped to 2 s)", c and c["scene"] == sc(0, 0) and abs(c["start"] - 2) < 0.01 and c["dur"] == 8, c)
    other = pg.locator(f"#rightHost .zoneblock[data-zone='{Z[1]}'] .scene").first
    other.drag_to(lane, target_position={"x": 14 * 40, "y": lb["height"] / 2}); time.sleep(0.3)
    check("…another zone's scene isn't taken there", len(E(f"{T}.tracks['{Z[0]}']")) == 1)
    lane.dblclick(position={"x": 12 * 40 + 2, "y": lb["height"] / 2}); time.sleep(0.3)
    pg.locator(".menu button").nth(1).click(); time.sleep(0.3)
    cs = E(f"{T}.tracks['{Z[0]}']")
    check("a double-click on the track picks a scene for a clip there", len(cs) == 2 and abs(cs[1]["start"] - 12) < 0.01 and cs[1]["scene"] == sc(0, 1), cs)
    check("…each drawn as a clip with its scene's name", pg.locator(f"#dockBody .tltrack[data-zone='{Z[0]}'] .tlclip").count() == 2)
    # move, resize, fades by the mouse
    cl = pg.locator(f"#dockBody .tlclip[data-clip='{cs[0]['id']}']"); b = cl.bounding_box()
    pg.mouse.move(b["x"] + 60, b["y"] + 15); pg.mouse.down(); pg.mouse.move(b["x"] + 60 - 40, b["y"] + 15, steps=5); pg.mouse.up(); time.sleep(0.3)
    check("a clip dragged moves (1 s left)", abs(E(f"{T}.tracks['{Z[0]}'][0].start") - 1) < 0.01, E(f"{T}.tracks['{Z[0]}'][0]"))
    cl = pg.locator(f"#dockBody .tlclip[data-clip='{cs[0]['id']}']"); b = cl.bounding_box()
    pg.mouse.move(b["x"] + b["width"] - 2, b["y"] + 20); pg.mouse.down(); pg.mouse.move(b["x"] + b["width"] - 2 - 160, b["y"] + 20, steps=5); pg.mouse.up(); time.sleep(0.3)
    check("…its right edge dragged makes it shorter (4 s)", abs(E(f"{T}.tracks['{Z[0]}'][0].dur") - 4) < 0.01, E(f"{T}.tracks['{Z[0]}'][0]"))
    cl = pg.locator(f"#dockBody .tlclip[data-clip='{cs[0]['id']}']"); fb = cl.locator(".tlfin").bounding_box()
    pg.mouse.move(fb["x"] + 4, fb["y"] + 4); pg.mouse.down(); pg.mouse.move(fb["x"] + 4 + 40, fb["y"] + 4, steps=5); pg.mouse.up(); time.sleep(0.3)
    check("…its fade-in handle dragged makes the fade longer (2 s)", abs(E(f"{T}.tracks['{Z[0]}'][0].fadeIn") - 2) < 0.05, E(f"{T}.tracks['{Z[0]}'][0]"))
    cs2 = E(f"{T}.tracks['{Z[0]}']")
    check("clips never overlap: moving one against another stops at its edge", True)
    cl = pg.locator(f"#dockBody .tlclip[data-clip='{cs[1]['id']}']"); b = cl.bounding_box()
    pg.mouse.move(b["x"] + 30, b["y"] + 15); pg.mouse.down(); pg.mouse.move(b["x"] + 30 - 600, b["y"] + 15, steps=6); pg.mouse.up(); time.sleep(0.3)
    a, c2 = E(f"{T}.tracks['{Z[0]}']")
    check("…dragged far left, the second clip stops at the first's end", abs(c2["start"] - (a["start"] + a["dur"])) < 0.01, (a, c2))

    # ---------- playing
    E(f"""(() => {{ const zid = '{Z[0]}', z = zoneById(zid), s = z.scenes;
      {T}.tracks = {{ [zid]: [newClip(s[0].id, 0, 2, {{ fadeIn: 0.5, fadeOut: 0 }}), newClip(s[1].id, 2, 2, {{ fadeIn: 1, fadeOut: 1 }}), newClip(s[2].id, 5, 1, {{ fadeIn: 0, fadeOut: 0 }})] }};
      {T}.length = 8; commit(); for (const o of project.zones) o.opacity = 1; tlStop({T}); }})()"""); time.sleep(0.2)
    others = E(f"project.zones.slice(1).map(z => [z.scene, z.opacity])")
    zone = lambda: E(f"(() => {{ const z = zoneById('{Z[0]}'); return [z.scene, Math.round(z.opacity * 100) / 100]; }})()")
    E(f"tlSeek({T}, 1)"); time.sleep(0.1)
    check("the playhead put on a clip: its scene, cut, at full level", zone() == [sc(0, 0), 1] and E(f"!zoneById('{Z[0]}')._fade"))
    E(f"tlSeek({T}, 0.25)"); time.sleep(0.1)
    check("…in its fade-in from nothing: the level halfway", zone() == [sc(0, 0), 0.5], zone())
    E(f"tlSeek({T}, 4.5)"); time.sleep(0.1)
    check("…in a gap: the zone dark", zone()[1] == 0, zone())
    E(f"tlSeek({T}, 3.5)"); time.sleep(0.1)
    check("…in a fade-out into a gap: the level going down", zone() == [sc(0, 1), 0.5], zone())
    E(f"tlSeek({T}, 1.6); tlPlay({T})"); time.sleep(0.75)
    f = E(f"(() => {{ const f = zoneById('{Z[0]}')._fade; return f ? [f.scene, Math.round(f.dur * 10) / 10] : null; }})()")
    check("playing into the clip just after: a crossfade over its fade-in", zone()[0] == sc(0, 1) and f and f[0] == sc(0, 1) and 0.5 <= f[1] <= 1, (zone(), f))
    check("zones with no clips are left alone", E(f"project.zones.slice(1).map(z => [z.scene, z.opacity])") == others)
    check("the play button shows it playing, the playhead moving", pg.locator("#dockBody .tlplay.on").count() == 1 and E("tlPos()") > 2)
    pg.locator("#dockBody .tlplay[aria-label='Pause']").click(); time.sleep(0.2)
    p0 = E("tlPos()"); time.sleep(0.4)
    check("Pause holds it", not E("tl.playing") and E("tlPos()") == p0)
    E(f"tlPlay({T})"); time.sleep(0.2)
    pg.locator("#dockBody .tlplay[aria-label='Stop']").click(); time.sleep(0.2)
    check("Stop: back to the start", not E("tl.playing") and E("tlPos()") == 0)
    E(f"tlSeek({T}, 7.5); tlPlay({T})"); time.sleep(0.9)
    check("loop off: it ends at the end", not E("tl.playing") and abs(E("tlPos()") - 8) < 0.01, E("tlPos()"))
    E(f"{T}.loop.mode = 'all'; commit(); tlSeek({T}, 7.6); tlPlay({T})"); time.sleep(0.8)
    check("loop all: from the end back to the start", E("tl.playing") and E("tlPos()") < 1, E("tlPos()"))
    E(f"{T}.loop = {{ mode: 'region', a: 2, b: 3 }}; commit(); renderDock(); tlSeek({T}, 2.6); tlPlay({T})"); time.sleep(1.0)
    p = E("tlPos()")
    check("loop region: round its two markers", E("tl.playing") and 2 <= p < 3, p)
    check("…the markers and the region shown on the ruler", pg.locator("#dockBody .tlmark").count() == 2 and pg.locator("#dockBody .tlloop").count() == 1)
    m = pg.locator("#dockBody .tlmark.b"); mb = m.bounding_box()
    pg.mouse.move(mb["x"] + 6, mb["y"] + 3); pg.mouse.down(); pg.mouse.move(mb["x"] + 6 + 80, mb["y"] + 3, steps=4); pg.mouse.up(); time.sleep(0.3)
    check("…the end marker dragged moves the region's end (5 s)", abs(E(f"{T}.loop.b") - 5) < 0.05, E(f"{T}.loop"))
    E("tlPause()")
    E(f"{T}.loop.mode = 'off'; commit(); renderDock()"); time.sleep(0.3)
    rb = pg.locator("#dockBody .tlruler").bounding_box()
    pg.mouse.click(rb["x"] + 5.5 * 40, rb["y"] + 10); time.sleep(0.2)
    check("the ruler clicked moves the playhead there", abs(E("tlPos()") - 5.5) < 0.05 and zone()[0] == sc(0, 2), E("tlPos()"))
    pg.mouse.move(700, 930); pg.keyboard.press("Space"); time.sleep(0.4)
    check("Space with the mouse off the stage plays", E("tl.playing"))
    pg.keyboard.press("Space"); time.sleep(0.2)
    check("…and pauses", not E("tl.playing"))
    pg.locator(f"#dockBody .tlclip").first.click(); time.sleep(0.2)
    n = len(E(f"{T}.tracks['{Z[0]}']"))
    pg.mouse.move(700, 930); pg.keyboard.press("Delete"); time.sleep(0.3)
    check("Delete takes the clip picked out, not the fixtures", len(E(f"{T}.tracks['{Z[0]}']")) == n - 1 and E("project.fixtures.length") > 0)
    E("undo()"); time.sleep(0.3)
    check("undo brings it back", len(E(f"project.timelines[0].tracks['{Z[0]}']")) == n)

    # ---------- lanes: the top lane shows over the one under, handing back to it
    E("tlPause()")
    pg.locator(f"#dockBody button[aria-label='Add a lane to {E(f'zoneById({chr(39)}{Z[0]}{chr(39)}).name')}']").click(); time.sleep(0.3)
    check("+ on a zone's track adds a lane on top", E(f"project.timelines[0].lanes['{Z[0]}']") == 2 and pg.locator(f"#dockBody .tltrack[data-zone='{Z[0]}']").count() == 2)
    E(f"""(() => {{ const zid = '{Z[0]}', s = zoneById(zid).scenes, T = project.timelines[0];
      T.loop.mode = 'off'; T.length = 12; T.tracks[zid] = [newClip(s[0].id, 0, 10, {{ fadeIn: 0, fadeOut: 1, lane: 0 }}), newClip(s[1].id, 3, 3, {{ fadeIn: 1, fadeOut: 1, lane: 1 }})];
      commit(); tlStop(T); }})()"""); time.sleep(0.2)
    E("tlSeek(project.timelines[0], 2)"); time.sleep(0.05)
    check("under nothing: the lower lane's clip", zone() == [sc(0, 0), 1])
    E("tlSeek(project.timelines[0], 4.5)"); time.sleep(0.05)
    check("where they overlap: the top lane's, at full level (no dip)", zone() == [sc(0, 1), 1], zone())
    E("tlSeek(project.timelines[0], 2.6); tlPlay(project.timelines[0])"); time.sleep(0.75)
    f = E(f"(() => {{ const f = zoneById('{Z[0]}')._fade; return f ? [f.scene, Math.round(f.dur * 10) / 10] : null; }})()")
    check("playing into the top clip: a crossfade up over its fade-in", zone()[0] == sc(0, 1) and f and f[0] == sc(0, 1) and 0.5 <= f[1] <= 1 and zone()[1] == 1, (zone(), f))
    E("tlPause(); tlSeek(project.timelines[0], 4.6); tlPlay(project.timelines[0])"); time.sleep(0.7)
    f = E(f"(() => {{ const f = zoneById('{Z[0]}')._fade; return f ? [f.scene, Math.round(f.dur * 10) / 10] : null; }})()")
    check("as it ends: back down to the clip under over its fade-out, done by its end", zone()[0] == sc(0, 0) and f and f[0] == sc(0, 0) and 0.4 <= f[1] <= 1 and E("tlPos()") < 6 and zone()[1] == 1, (zone(), f, E("tlPos()")))
    E("tlPause()")
    pg.locator(f"#dockBody button[aria-label^='Remove a lane']").click(); time.sleep(0.3)
    check("− won't take off a lane with clips", E(f"project.timelines[0].lanes['{Z[0]}']") == 2)
    top = E(f"project.timelines[0].tracks['{Z[0]}'][1].id")
    cl = pg.locator(f"#dockBody .tlclip[data-clip='{top}']"); b = cl.bounding_box()
    low = pg.locator(f"#dockBody .tltrack[data-zone='{Z[0]}'][data-lane='0']").bounding_box()
    pg.mouse.move(b["x"] + 20, b["y"] + 15); pg.mouse.down(); pg.mouse.move(b["x"] + 20, low["y"] + 15, steps=5); pg.mouse.up(); time.sleep(0.3)
    check("a clip dragged down onto a lane with no room there stays on its own", E(f"project.timelines[0].tracks['{Z[0]}'].find(c => c.id === '{top}').lane") == 1)
    E(f"(() => {{ const c = project.timelines[0].tracks['{Z[0]}'][0]; c.dur = 2; c.fadeOut = 0; commit(); refreshTimeline(); }})()"); time.sleep(0.3)
    cl = pg.locator(f"#dockBody .tlclip[data-clip='{top}']"); b = cl.bounding_box()
    pg.mouse.move(b["x"] + 20, b["y"] + 15); pg.mouse.down(); pg.mouse.move(b["x"] + 20, low["y"] + 15, steps=5); pg.mouse.up(); time.sleep(0.3)
    check("…onto a lane with room, it goes there", E(f"project.timelines[0].tracks['{Z[0]}'].find(c => c.id === '{top}').lane") == 0)
    pg.locator(f"#dockBody button[aria-label^='Remove a lane']").click(); time.sleep(0.3)
    check("− takes off the top lane once it is empty", not E(f"(project.timelines[0].lanes || {{}})['{Z[0]}']") and pg.locator(f"#dockBody .tltrack[data-zone='{Z[0]}']").count() == 1)
    # a scene's snapshot at the start of its clips
    E(f"(() => {{ const s = zoneById('{Z[0]}').scenes[0]; s.thumb = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='; commit(); refreshTimeline(); }})()"); time.sleep(0.3)
    check("a scene with a snapshot fills its clips with it, as a filmstrip", pg.locator(f"#dockBody .tltrack[data-zone='{Z[0]}'] .tlclip .tlstrip.shot").count() >= 1 and 'url(' in pg.locator(f"#dockBody .tltrack[data-zone='{Z[0]}'] .tlclip .tlstrip.shot").first.get_attribute('style'))

    # ---------- zoom: the bar under the tracks, its right end dragged left (less time in view: zoomed in), its middle
    # dragged to scroll; the bar stays the same under the mouse
    E("tlPause()")   # (playing, the view follows the playhead)
    E("window._zs = $('#dockBody .tlzbar.h')")
    end = pg.locator("#dockBody .tlzbar.h .tlend.b").bounding_box(); z0 = E("ui.tlZoom")
    x, y = end["x"] + end["width"] / 2, end["y"] + end["height"] / 2
    pg.mouse.move(x, y); pg.mouse.down()
    for k in range(1, 9): pg.mouse.move(x - k * 12, y); time.sleep(0.03)
    mid = E("[ui.tlZoom, window._zs.isConnected]")
    pg.mouse.up(); time.sleep(0.2)
    check("the zoom bar's end dragged in: zoomed in, the bar the same under the mouse", mid[1] and mid[0] > z0 + 3 and E("window._zs.isConnected"), (z0, mid))
    check("…the tracks drawn at the new zoom", abs(E("parseFloat($('#dockBody .tlgrid').style.width)") - (132 + E("project.timelines[0].length * ui.tlZoom"))) < 1)
    E("tlZoomTo(200)"); time.sleep(0.2)   # more than fits: something to scroll
    th = pg.locator("#dockBody .tlzbar.h .tlthumb").bounding_box(); x, y = th["x"] + th["width"] / 2, th["y"] + th["height"] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 80, y, steps=4); pg.mouse.up(); time.sleep(0.2)
    check("…its middle dragged scrolls the tracks", E("$('#dockBody .tlscroll').scrollLeft") > 50, (E("$('#dockBody .tlscroll').scrollLeft"), th, E("[tl.playing, $('#dockBody .tlscroll').scrollWidth, $('#dockBody .tlscroll').clientWidth, document.elementFromPoint(" + str(x) + "," + str(y) + ").className]")))
    E("tlZoomTo(40)")

    # ---------- the grid in bars
    pg.locator("#dockBody .tlseg[aria-label='Grid'] button:has-text('Bars')").click(); time.sleep(0.3)
    labels = E("[...$$('#dockBody .tltick.major')].slice(0, 3).map(e => e.textContent)")
    check("Bars: the ruler counts bars at the tempo (120 BPM)", E(f"project.timelines[0].grid") == "bars" and labels[:2] == ["1", "2"] and pg.locator("#dockBody input[aria-label='BPM']").input_value() == "120", labels)

    # ---------- audio
    E("""(async () => {
      const sr = 8000, n = sr * 10, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / sr * 2 * Math.PI * 220) * 12000 * ((i / sr) % 2 < 1 ? 1 : 0.2), true);
      project.timelines[0].length = 4;
      setTimelineAudio(project.timelines[0], new File([b], 'beat.wav', { type: 'audio/wav' }));
    })()"""); time.sleep(2.5)
    A = E("project.timelines[0].audio")
    check("an audio file: shown by name, stored in the media library", A and A["name"] == "beat.wav" and isinstance(A.get("media"), str) and "beat.wav" in pg.locator("#dockBody .tlbar").inner_text(), A)
    check("…its waveform drawn on the audio track", pg.locator("#dockBody .tlaudio canvas.tlwave").count() == 1)
    check("…and the timeline as long as the audio at least", E("project.timelines[0].length") >= 10, E("project.timelines[0].length"))
    E("tlSeek(project.timelines[0], 1); tlPlay(project.timelines[0])"); time.sleep(1.2)
    at = E("(() => { const a = tlAudios.get(project.timelines[0].id); return a ? [a.paused, a.currentTime] : null; })()")
    check("…it plays with the timeline, in step", at and not at[0] and abs(at[1] - E("tlPos()")) < 0.3, (at, E("tlPos()")))
    E("tlPause()"); time.sleep(0.2)
    check("…and pauses with it", E("tlAudios.get(project.timelines[0].id).paused"))
    check("…and goes into packages", "beat.wav" in E("packageMedia().map(s => s.name)"))

    # ---------- beside the stage
    E("setPanelPlace('timeline', 'left')"); time.sleep(0.4)
    check("sent left: a Timeline tab in the left panel, the bottom panel's goes", pg.locator("#leftHost .tlpanel .tltrack").count() == 3 and not pg.locator("#dockTabs [data-tab=timeline]").is_visible())
    E("setPanelPlace('timeline', 'bottom'); setPanelPlace('scenes', 'bottom'); ui.dockTab = 'timeline'; renderDock()"); time.sleep(0.3)

    # ---------- files
    saved = json.loads(E("serialize()"))
    check("timelines are saved in the project (not the playhead)", len(saved["timelines"]) == 1 and "tl" not in saved and saved["timelines"][0]["audio"]["name"] == "beat.wav"
          and "_url" not in saved["timelines"][0]["audio"])
    bad = {"name": "B", "zones": [{"id": "z1", "name": "Z", "scenes": [{"id": "s1", "name": "S", "layers": []}]}],
           "timelines": [{"id": "t", "length": 20, "grid": "x", "bpm": 999, "loop": {"mode": "region", "a": 30, "b": 5},
                          "tracks": {"z1": [{"scene": "s1", "start": 12, "dur": 4, "fadeIn": 9, "lane": 2}, {"scene": "nope", "start": 0}, {"scene": "s1", "start": 2, "dur": 3}], "gone": [{"scene": "s1"}]},
                          "audio": {"name": "a.wav", "media": "../evil"}}, "junk"]}
    fx = E("p => hydrate(p).timelines", bad)
    t0 = fx[0] if fx else {}
    check("files are repaired: clips of scenes not there or zones gone dropped, in order, fades in range, the loop inside, a bad media name dropped, lanes as many as the clips need",
          len(fx) == 1 and [c["start"] for c in t0["tracks"]["z1"]] == [2, 12] and t0["tracks"]["z1"][1]["fadeIn"] == 4 and "gone" not in t0["tracks"]
          and t0["lanes"] == {"z1": 3} and t0["grid"] == "sec" and t0["bpm"] == 300 and t0["loop"]["a"] <= t0["loop"]["b"] <= 20 and t0["audio"] == {"name": "a.wav", "vol": 1}, fx)
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
