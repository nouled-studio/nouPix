# Playlists: a zone plays some of its scenes in turn. Files are repaired; the New playlist window; a zone's playlists
# fold to one line and open again; steps move on with the right fade (the step's, the playlist's, the scene's) and
# a play time that includes the fade; loop, stop, and then another playlist; pause, carry on, next, previous; a scene
# picked by hand pauses; one playlist per zone; undo and devices don't pull the show back a step; editing steps while
# one plays; the step editor and + Add; the fade time on a scene's button; play when the project opens; the phone.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8172
RP = PORT + 1
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

HELP = """(() => {
  window.Z = () => olm.project.zones[olm.project.zones.length - 1];   // the demo's top zone, All
  window.PL = name => Z().playlists.find(p => p.name === name);
  // jump to just before the end of the step playing: the next frame moves on
  window.FF = (z = Z(), left = 0.02) => { const p = z._play, pl = playingList(z); p.start = clockT - (pl.steps[p.i].time - left); };
  window.ST = (z = Z()) => { const p = z._play, pl = playingList(z); return p ? { list: pl && pl.name, on: p.on, i: p.i, manual: p.manual, ended: p.ended, scene: z.scene, fade: z._fade ? Math.round(z._fade.dur * 100) / 100 : 0 } : null; };
})()"""

bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = br.new_page(viewport={"width": 1500, "height": 950})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    pg.evaluate("(() => { const p = demoProject(); p.settings.fps = 20; olm.loadProject(p); ui.dockTab = 'scenes'; ui.dockCollapsed = false; ui.dockH = 380; renderDock(); })()")
    pg.evaluate(HELP)
    E = pg.evaluate
    wait = lambda s=0.35: time.sleep(s)

    # ---------- files
    r = E("""(() => {
      const p = hydrate({ zones: [{ id: 'z', scenes: [{ id: 'a', name: 'A', layers: [] }, { id: 'b', name: 'B', layers: [] }], playlists: [
        { id: 'p1', name: 'X', steps: [{ scene: 'a', time: '5' }, { scene: 'gone', time: 3 }, { scene: 'b', time: -1, fade: 99 }], end: 'p9', autoplay: true },
        { id: 'p2', steps: [], end: 'p2', autoplay: true, fade: 'x' }, 'junk', { id: 'p1', name: 'Y', steps: [{ scene: 'a', id: 's', time: 2 }, { scene: 'b', id: 's', time: 2 }], end: 'p2' }] }] });
      const z = p.zones[0];
      return { n: z.playlists.length, ids: z.playlists.map(x => x.id), steps: z.playlists[0].steps.map(s => [s.scene, s.time, s.fade]), ends: z.playlists.map(x => x.end),
        auto: z.playlists.map(x => x.autoplay), fade1: z.playlists[1].fade, stepIds: z.playlists[2].steps.map(s => s.id), old: hydrate({ zones: [{ id: 'q', scenes: [] }] }).zones[0].playlists };
    })()""")
    check("a file's playlists are repaired: steps of missing scenes go, times and fades are kept in range", r["n"] == 3 and r["steps"] == [["a", 5, None], ["b", 0.1, 60]], r)
    check("playlist and step ids are made unique", len(set(r["ids"])) == 3 and len(set(r["stepIds"])) == 2, r)
    check("an end that leads nowhere (or to itself) loops; an end to another playlist is kept", r["ends"] == ["loop", "loop", "p2"] and r["ids"][:2] == ["p1", "p2"], r)
    check("only one playlist per zone plays when the project opens", r["auto"] == [True, False, False], r)
    check("an older file gets no playlists", r["old"] == [], r)

    # ---------- the New playlist window
    pg.click(".zoneblock >> nth=0 >> .plbtn"); wait(0.2)
    check("a zone without playlists: its playlist button opens the New playlist window", pg.locator(".pmodal").count() == 1)
    pg.fill(".pmodal .row input[type=text] >> nth=0", "Evening")
    pg.locator(".pmodal .ppick input[type=checkbox]").nth(2).uncheck()
    pg.fill(".pmodal .ptime", "1"); pg.click(".pmodal button:has-text('Set for the ticked ones')")
    pg.click(".pmodal .btn.primary"); wait()
    r = E("(() => { const pl = PL('Evening'); return pl && { n: pl.steps.length, times: pl.steps.map(s => s.time), scenes: pl.steps.map(s => Z().scenes.findIndex(x => x.id === s.scene)), fade: pl.fade, end: pl.end }; })()")
    check("Create makes the playlist from the ticked scenes, in their order, with the play time set", r and r["n"] == 3 and r["times"] == [1, 1, 1] and r["scenes"] == [0, 1, 3] and r["fade"] is None and r["end"] == "loop", r)
    check("the new playlist opens under the zone's scenes, with its steps", pg.locator(".zoneblock >> nth=0 >> .plane .pstep:not(.add)").count() == 3 and pg.locator(".zoneblock >> nth=0 >> .ptab.open").count() == 1)

    # ---------- folding and opening (the playlist playing)
    pg.click(".zoneblock >> nth=0 >> .ptab.open .pb"); wait()
    s = E("ST()")
    check("▶ on the tab plays it from step 1", s and s["on"] and s["i"] == 0 and s["list"] == "Evening", s)
    pg.click(".zoneblock >> nth=0 >> .ptab.open .nm"); wait(0.2)
    check("clicking the open playlist's tab folds it back to one line", pg.locator(".zoneblock >> nth=0 >> .plane").count() == 0 and pg.locator(".zoneblock >> nth=0 >> .ptabs.folded").count() == 1)
    check("folded, the line says what plays and how long is left", "Evening" in pg.inner_text(".zoneblock >> nth=0 >> .pbrief") and "left" in pg.inner_text(".zoneblock >> nth=0 >> .pbrief"), pg.inner_text(".zoneblock >> nth=0 >> .pbrief"))
    check("folded, the playlist keeps playing", E("ST().on"))
    pg.click(".zoneblock >> nth=0 >> .ptab .nm"); wait(0.2)
    check("clicking a tab opens it again", pg.locator(".zoneblock >> nth=0 >> .plane").count() == 1)
    pg.click(".zoneblock >> nth=0 >> .pclose"); wait(0.2)
    check("Close folds it too", pg.locator(".zoneblock >> nth=0 >> .plane").count() == 0)
    pg.click(".zoneblock >> nth=0 >> .plbtn"); wait(0.2)
    check("the zone's playlist button opens the one playing", pg.locator(".zoneblock >> nth=0 >> .ptab.open.on").count() == 1)
    check("the zone's playlist button shows that one plays (green)", "playing" in pg.get_attribute(".zoneblock >> nth=0 >> .plbtn", "class"))
    pg.click(".zoneblock >> nth=0 >> .plbtn"); wait(0.2)
    check("and folds it again", pg.locator(".zoneblock >> nth=0 >> .plane").count() == 0)
    pg.click(".zoneblock >> nth=0 >> .plbtn"); wait(0.2)

    # ---------- steps move on, with the right fade
    E("(() => { const z = Z(), pl = PL('Evening'); pl.steps.forEach(s => s.time = 30); z.scenes[1].fade = 3; z.scenes[3].fade = 4; playPlaylist(z, pl.id); })()"); wait(0.2)
    s = E("ST()")
    check("step 1 plays its scene, fading in with the scene's own fade", s["scene"] == E("Z().scenes[0].id") and s["fade"] == E("Z().scenes[0].fade"), s)
    E("FF()"); wait()
    s = E("ST()")
    check("when its play time is up, the next step plays (its scene's fade)", s["i"] == 1 and s["scene"] == E("Z().scenes[1].id") and s["fade"] == 3, s)
    E("(() => { PL('Evening').fade = 0.7; })()"); E("FF()"); wait()
    check("One for all: the playlist's fade wins over the scene's", E("ST()")["fade"] == 0.7, E("ST()"))
    E("(() => { const pl = PL('Evening'); pl.steps[0].fade = 0.3; })()"); E("FF()"); wait()
    check("a step's own fade wins over the playlist's (and it loops back to step 1)", E("ST()")["i"] == 0 and E("ST()")["fade"] == 0.3, E("ST()"))
    E("(() => { const pl = PL('Evening'); pl.steps[1].fade = 9; pl.steps[1].time = 2; })()"); E("FF()"); wait()
    r = E("(() => { const z = Z(), pl = PL('Evening'); return { st: ST(), f: stepFade(z, pl, pl.steps[1]) }; })()")
    check("a fade longer than the play time is cut to it", r["st"]["fade"] == 2 and r["f"]["clipped"], r)
    t0 = E("Z()._play.start")
    time.sleep(1.0); E("(() => {})()")
    r = E("(() => ({ i: Z()._play.i, el: playElapsed(Z()) }))()")
    check("the play time counts from the step's start, fade included (2 s step, 9 s fade: still step 2 after 1 s)", r["i"] == 1 and 0.8 < r["el"] < 1.6, r)
    time.sleep(1.4)
    check("…and the next step starts when its play time is up, though the fade had not finished", E("ST()")["i"] == 2, E("ST()"))
    E("(() => { const pl = PL('Evening'); pl.fade = null; pl.steps.forEach(s => { s.fade = null; s.time = 30; }); })()")

    # ---------- the end: loop, stop, then another playlist
    E("(() => { const pl = PL('Evening'); pl.end = 'stop'; playPlaylist(Z(), pl.id, 2); })()"); E("FF()"); wait()
    s = E("ST()")
    check("Stop: at the end it stops on the last step", s["ended"] and not s["on"] and s["i"] == 2 and s["scene"] == E("PL('Evening').steps[2].scene"), s)
    pg.click(".zoneblock >> nth=0 >> .ptab.open .pb"); wait()
    check("▶ after the end plays it again from step 1", E("ST()")["i"] == 0 and E("ST()")["on"], E("ST()"))
    E("(() => { const z = Z(); addPlaylist(z, { name: 'Party', steps: [newStep(z.scenes[2].id, 30), newStep(z.scenes[3].id, 30, 0)], fade: 0.5 }); ui.playlistOpen[z.id] = PL('Evening').id; PL('Evening').end = PL('Party').id; playPlaylist(z, PL('Evening').id, 2); renderDock(); })()"); E("FF()"); wait()
    s = E("ST()")
    check("Then play Party: at the end, Party plays from its first step", s["list"] == "Party" and s["i"] == 0 and s["on"] and s["fade"] == 0.5, s)
    check("the open playlist follows to Party", E("ui.playlistOpen[Z().id] === PL('Party').id"))
    check("one playlist plays per zone: Evening's tab is no longer playing", pg.locator(".zoneblock >> nth=0 >> .ptab.on").count() == 1 and "Party" in pg.inner_text(".zoneblock >> nth=0 >> .ptab.on"))
    E("(() => { PL('Evening').end = 'loop'; })()")

    # ---------- pause, carry on, next, previous
    E("(() => { ui.playlistOpen[Z().id] = PL('Evening').id; playPlaylist(Z(), PL('Evening').id); })()"); time.sleep(0.6)
    E("pausePlaylist(Z())"); a = E("playElapsed(Z())"); time.sleep(0.6); b = E("playElapsed(Z())")
    check("Pause stops the step's time", not E("ST()")["on"] and abs(a - b) < 0.01 and a > 0.3, (a, b))
    check("paused, the step's tile and the tab turn orange", pg.locator(".zoneblock >> nth=0 >> .pstep.live.paused").count() == 1 and pg.locator(".zoneblock >> nth=0 >> .ptab.paused").count() == 1)
    E("resumePlaylist(Z())"); time.sleep(0.5); c = E("playElapsed(Z())")
    check("Play carries on with the rest of the step", E("ST()")["on"] and c > b + 0.3 and E("ST()")["i"] == 0, (b, c))
    pg.click(".zoneblock >> nth=0 >> .ptb[title='Next step']"); wait()
    check("Next goes to the next step", E("ST()")["i"] == 1)
    pg.click(".zoneblock >> nth=0 >> .ptb[title='Previous step']"); wait()
    check("Previous goes back", E("ST()")["i"] == 0)
    E("pausePlaylist(Z())"); E("stepPlaylist(Z(), 1)")
    check("paused, Next moves to the next step and stays paused", E("ST()")["i"] == 1 and not E("ST()")["on"] and E("ST()")["scene"] == E("PL('Evening').steps[1].scene"))
    E("resumePlaylist(Z())")

    # ---------- a scene picked by hand
    E("(() => olm.goScene(Z(), Z().scenes[3]))()"); wait(0.2)
    s = E("ST()")
    check("a scene picked by hand pauses the playlist", not s["on"] and s["manual"] == E("Z().scenes[3].id") and s["scene"] == E("Z().scenes[3].id"), s)
    check("the status says so", "picked by hand" in pg.inner_text(".zoneblock >> nth=0 >> .pstatus"), pg.inner_text(".zoneblock >> nth=0 >> .pstatus"))
    E("resumePlaylist(Z())"); wait(0.2)
    s = E("ST()")
    check("Play fades back to the step it was on", s["on"] and not s["manual"] and s["i"] == 1 and s["scene"] == E("PL('Evening').steps[1].scene"), s)
    pg.keyboard.press("Escape"); pg.click("#stage", position={"x": 5, "y": 5}) if pg.locator("#stage").count() else None
    E("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press("Digit1"); wait(0.2)
    check("keys 1–9 are a pick by hand too", E("ST()")["manual"] == E("Z().scenes[0].id"), E("ST()"))
    E("resumePlaylist(Z())")

    # ---------- undo, history
    time.sleep(0.6)   # the pick by hand above is one undo step, written a moment later
    n0 = E("hist.stack.length")
    for _ in range(3): E("FF()"); wait(0.25)
    check("steps that play by themselves are not undo steps", E("hist.stack.length") == n0, (n0, E("hist.stack.length")))
    E("(() => { olm.project.name = 'Renamed'; commit(); })()")
    E("FF()"); wait()
    before = E("ST()")
    E("undo()"); wait(0.2)
    after = E("ST()")
    check("an undo while it plays doesn't take the zone back to an earlier step", after["on"] and after["scene"] == before["scene"] and after["i"] == before["i"] and E("olm.project.name") != "Renamed", (before, after))

    # ---------- editing while it plays
    E("(() => { const z = Z(); playPlaylist(z, PL('Evening').id, 1); })()"); wait(0.2)
    cur = E("PL('Evening').steps[1].id")
    E("(() => { const pl = PL('Evening'); moveStep(Z(), pl, pl.steps[1].id, 0); })()")
    check("moving the step playing: it stays the one playing", E("PL('Evening').steps[Z()._play.i].id") == cur and E("Z()._play.i") == 0)
    E("(() => { const z = Z(), pl = PL('Evening'); addToPlaylist(z, pl, z.scenes[2].id, 0); })()")
    check("adding a step before it: still the one playing", E("PL('Evening').steps[Z()._play.i].id") == cur and E("PL('Evening').steps.length") == 4)
    E("(() => { const z = Z(), pl = PL('Evening'); removeStep(z, pl, pl.steps[0]); })()")
    check("removing another step: still the one playing", E("PL('Evening').steps[Z()._play.i].id") == cur)
    r = E("""(() => { const z = Z(), sc = z.scenes[3]; const n = z.playlists.map(p => p.steps.filter(s => s.scene === sc.id).length);
      z.scenes = z.scenes.filter(x => x !== sc); dropSceneSteps(z, sc.id); commit();
      return { n, after: z.playlists.map(p => p.steps.filter(s => s.scene === sc.id).length) }; })()""")
    check("deleting a scene takes its steps out of every playlist", sum(r["n"]) >= 2 and r["after"] == [0, 0], r)
    E("(() => { const z = Z(); PL('Party').end = PL('Evening').id; deletePlaylist(z, PL('Evening')); })()"); wait(0.2)
    check("deleting a playlist: one that led to it stops at its end instead; if it played, nothing plays", E("PL('Party').end") == "stop" and E("Z()._play") is None)
    E("undo()"); wait(0.2)
    check("undo brings it back", E("!!PL('Evening')"))
    r = E("""(() => { const z = Z(); duplicateZone(z); const c = olm.project.zones[olm.project.zones.indexOf(z) - 1];
      const ok = c.playlists.every(pl => pl.steps.every(s => c.scenes.some(x => x.id === s.scene))); const n = c.playlists.length; deleteZone(c); return { ok, n }; })()""")
    check("a duplicated zone's playlists play the copy's own scenes", r["ok"] and r["n"] == 2, r)

    # ---------- the step editor and + Add
    E("(() => { const z = Z(); ui.zone = z.id; ui.playlistOpen[z.id] = PL('Evening').id; ui.playlistStep = null; playPlaylist(z, PL('Evening').id); renderDock(); })()"); wait(0.2)
    pg.click(".zoneblock >> nth=0 >> .pstep:not(.add) >> nth=1"); wait(0.2)
    check("clicking a step opens its editor", pg.locator(".zoneblock >> nth=0 >> .peditor").count() == 1)
    pg.fill(".peditor .ptime", "1:30"); pg.press(".peditor .ptime", "Enter"); wait(0.2)
    check("its play time takes minutes:seconds", E("PL('Evening').steps[1].time") == 90, E("PL('Evening').steps[1].time"))
    pg.click(".peditor .seg button:has-text('Its own')"); wait(0.2)
    check("Its own fade: the step gets its own, starting from the one it used", E("PL('Evening').steps[1].fade") is not None and pg.locator(".peditor input[type=number]").count() == 1)
    pg.fill(".peditor input[type=number]", "1.5"); pg.press(".peditor input[type=number]", "Enter"); wait(0.2)
    check("…and it can be typed", E("PL('Evening').steps[1].fade") == 1.5)
    pg.click(".peditor button:has-text('Play from here')"); wait(0.2)
    check("Play from here plays that step", E("ST()")["i"] == 1 and E("ST()")["on"] and E("ST()")["fade"] == 1.5)
    n = E("PL('Evening').steps.length")
    pg.click(".zoneblock >> nth=0 >> .pstep.add"); wait(0.2)
    pg.click(".zoneblock >> nth=0 >> .paddbar .btn >> nth=0"); wait(0.2)
    check("+ Add lists the zone's scenes; a click adds one at the end", E("PL('Evening').steps.length") == n + 1 and E("PL('Evening').steps.at(-1).scene") == E("Z().scenes[0].id"))
    # a scene tile dragged onto the playlist
    src = pg.locator(".zoneblock >> nth=0 >> .scenerow .scene >> nth=2")
    dst = pg.locator(".zoneblock >> nth=0 >> .plane")
    dt = pg.evaluate_handle("new DataTransfer()")
    src.dispatch_event("dragstart", {"dataTransfer": dt}); dst.dispatch_event("dragover", {"dataTransfer": dt}); dst.dispatch_event("drop", {"dataTransfer": dt}); src.dispatch_event("dragend", {"dataTransfer": dt}); wait(0.2)
    check("a scene dragged onto the playlist is added", E("PL('Evening').steps.length") == n + 2 and E("PL('Evening').steps.at(-1).scene") == E("Z().scenes[2].id"))
    ost = pg.locator(".zoneblock >> nth=1 >> .scenerow .scene >> nth=0")
    dt = pg.evaluate_handle("new DataTransfer()")
    ost.dispatch_event("dragstart", {"dataTransfer": dt}); dst.dispatch_event("dragover", {"dataTransfer": dt}); dst.dispatch_event("drop", {"dataTransfer": dt}); ost.dispatch_event("dragend", {"dataTransfer": dt}); wait(0.2)
    check("another zone's scene is not added (a playlist plays its own zone's scenes)", E("PL('Evening').steps.length") == n + 2)
    # the menu
    pg.click(".zoneblock >> nth=0 >> .ptab.open .x"); wait(0.2)
    items = pg.eval_on_selector_all(".menu button", "els => els.map(e => e.textContent)")
    check("the playlist's menu: play, rename, duplicate, at the end, play on open, delete", all(any(w in t for t in items) for w in ["Rename", "Duplicate", "At the end", "Play when the project opens", "Delete playlist"]), items)
    pg.click(".menu button:has-text('Duplicate')"); wait(0.2)
    check("Duplicate makes a copy and opens it", E("Z().playlists.length") == 3 and E("Z().playlists[1].name") == "Evening 2" and E("ui.playlistOpen[Z().id] === Z().playlists[1].id"), E("Z().playlists.map(p => p.name)"))
    pg.dblclick(".zoneblock >> nth=0 >> .ptab.open .nm"); wait(0.2)
    pg.fill(".zoneblock >> nth=0 >> .ptab.open input", "Late"); pg.press(".zoneblock >> nth=0 >> .ptab.open input", "Enter"); wait(0.2)
    check("double-click a tab renames it", E("Z().playlists[1].name") == "Late")
    pg.click(".zoneblock >> nth=0 >> .scenerow .scene >> nth=1 >> .x"); wait(0.2)
    pg.hover(".menu button:has-text('Add to playlist')"); wait(0.2)
    sub = pg.eval_on_selector_all(".menu >> nth=1 >> button", "els => els.map(e => e.textContent)")
    check("a scene's menu: Add to playlist lists the zone's playlists", any("Late" in t for t in sub) and any("New playlist with it" in t for t in sub), sub)
    n = E("PL('Late').steps.length")
    pg.click(".menu >> nth=1 >> button:has-text('Late')"); wait(0.2)
    check("…and adds it", E("PL('Late').steps.length") == n + 1)

    # ---------- the fade time on a scene's button
    E("(() => { Z().scenes[1].fade = 2; renderDock(); })()"); wait(0.2)
    fd = pg.locator(".zoneblock >> nth=0 >> .scenerow .scene >> nth=1 >> .fd")
    bb = fd.bounding_box(); n0 = E("hist.stack.length"); scene0 = E("Z().scene")
    pg.mouse.move(bb["x"] + 6, bb["y"] + 5); pg.mouse.down(); pg.mouse.move(bb["x"] + 46, bb["y"] + 5, steps=6); pg.mouse.up(); wait(0.2)
    v = E("Z().scenes[1].fade")
    check("dragging a scene's fade time to the right makes it longer (one undo step)", 3.6 <= v <= 4.4 and E("hist.stack.length") == n0 + 1, v)
    check("…and doesn't go to the scene", E("Z().scene") == scene0)
    pg.click(".zoneblock >> nth=0 >> .scenerow .scene >> nth=1 >> .fd"); wait(0.2)
    check("clicking it lets you type one", pg.locator(".zoneblock >> nth=0 >> .scenerow .scene >> nth=1 >> .fdin").count() == 1)
    pg.keyboard.type("0"); pg.keyboard.press("Enter"); wait(0.2)
    check("0 cuts: the button says cut", E("Z().scenes[1].fade") == 0 and pg.inner_text(".zoneblock >> nth=0 >> .scenerow .scene >> nth=1 >> .fd") == "cut")
    live = E("Z().scenes.findIndex(s => s.id === Z().scene)"); f0 = E(f"Z().scenes[{live}].fade")
    pg.focus(f".zoneblock >> nth=0 >> .scenerow .scene >> nth={live} >> .fd"); pg.keyboard.press("ArrowUp"); pg.keyboard.press("Shift+ArrowUp"); wait(0.5)
    f1 = E(f"Z().scenes[{live}].fade")
    check("on the scene playing too: ↑ adds 0.1 s, Shift ↑ a second", abs(f1 - (f0 + 1.1)) < 1e-6 and "live" in pg.get_attribute(f".zoneblock >> nth=0 >> .scenerow .scene >> nth={live}", "class"), (f0, f1))
    E("document.activeElement && document.activeElement.blur()")

    # ---------- saving and opening; play when the project opens
    r = E("(() => { const s = serialize(false); return { play: s.includes('_play'), lists: JSON.parse(s).zones.at(-1).playlists.length }; })()")
    check("playlists are saved with the project, where they are playing is not", not r["play"] and r["lists"] == 3, r)
    E("(() => { setPlaylistAutoplay(Z(), PL('Party'), true); olm.loadProject(JSON.parse(serialize(false))); window.Z = () => olm.project.zones[olm.project.zones.length - 1]; })()"); wait(0.4)
    s = E("ST()")
    check("a playlist set to play when the project opens starts with it", s and s["list"] == "Party" and s["on"] and s["i"] == 0, s)
    check("its tab shows the power sign", pg.locator(".zoneblock >> nth=0 >> .ptab .au").count() == 1)
    E("(() => { const p = JSON.parse(serialize(false)); p.zones.at(-1).playlists.forEach(x => { x.autoplay = false; }); olm.loadProject(p); })()"); wait(0.3)
    check("without it, the project opens with nothing playing", E("Z()._play") is None)

    # ---------- devices
    E(f"(() => {{ remote.cfg = {{ on: true, port: {RP}, password: 'pw' }}; remoteConfigure(); }})()")
    pg.wait_for_function("remote.status && remote.status.on")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    ph = ctx.new_page(); ph.on("pageerror", lambda e: errs.append("phone: " + str(e)))
    ph.goto(f"http://127.0.0.1:{RP}/remote"); ph.wait_for_function("document.querySelectorAll('.zone').length > 0", timeout=15000); wait(0.5)
    zi = 0   # the phone lists zones top first: All
    check("the phone shows a zone's playlists", ph.locator(".zone >> nth=0 >> .ppill").count() == 3 and ph.locator(".zone >> nth=1 >> .ppill").count() == 0)
    ph.click(".zone >> nth=0 >> .ppill:has-text('Evening')"); wait(0.6)
    check("tapping a playlist plays it on the main computer", E("ST() && ST().list") == "Evening" and E("ST().on") and E("ST().i") == 0)
    check("the phone shows it playing, with its step and time left", ph.locator(".zone >> nth=0 >> .ppill.on").count() == 1 and not ph.locator(".zone >> nth=0 >> .pplay").is_hidden() and "left" in ph.inner_text(".zone >> nth=0 >> .pnow span"), ph.inner_text(".zone >> nth=0 >> .pplay"))
    ph.click(".zone >> nth=0 >> .pnext"); wait(0.6)
    check("Next on the phone", E("ST().i") == 1)
    ph.click(".zone >> nth=0 >> .pbig"); wait(0.6)
    check("Pause on the phone", not E("ST().on") and ph.locator(".zone >> nth=0 >> .ppill.paused").count() == 1)
    ph.click(".zone >> nth=0 >> .ppill:has-text('Evening')"); wait(0.6)
    check("tapping the paused playlist carries on (not from the start)", E("ST().on") and E("ST().i") == 1)
    ph.click(".zone >> nth=0 >> .scene >> nth=0"); wait(0.6)
    check("a scene tapped on the phone pauses the playlist, like a click", not E("ST().on") and E("ST().manual"))
    # a programmer's copy from a step ago doesn't pull it back; a change to the scene playing does come in
    E("(() => { resumePlaylist(Z()); })()"); wait(0.2)
    older = E("serialize(false)")
    E("FF()"); wait(0.35)
    now = E("ST()")
    E("(o => remoteFromDevice('dev1', 'programmer', { op: 'project', data: o, seq: 1 }))", older); wait(0.2)
    check("a device's copy from a step ago doesn't take the zone back a step", E("ST().scene") == now["scene"] and E("ST().i") == now["i"], (now, E("ST()")))
    r = E("""(() => { const d = JSON.parse(serialize(false)); const z = d.zones.at(-1); z.layers.forEach(L => { L.opacity = 0.42; }); z.playlists[0].name = 'Evening (operator)';
      remoteFromDevice('dev2', 'operator', { op: 'project', data: JSON.stringify(d), seq: 1 });
      return { op: Z().layers.every(L => L.opacity === 0.42), name: Z().playlists[0].name, on: ST().on }; })()""")
    check("an operator's change to the scene playing and to a playlist does come in, and it keeps playing", r["op"] and r["name"] == "Evening (operator)" and r["on"], r)
    ctx.close()
    E("(() => { remote.cfg.on = false; remoteConfigure(); })()")
    br.close()
finally:
    bridge.terminate()
errs = [e for e in errs if "googleapis" not in e and "ERR_CERT" not in e]
check("no page errors", not errs, errs[:5])
print("FAILED:", fails or "none")
