# Keyframes on timeline clips (timeline.js, ui-timeline.js): a clip unfolds (its button, a double-click, its menu) to a
# row per curve; + Control adds the clip's level or a control of its scene's effects (two keys at the scene's value);
# curves played: a number straight or eased between keys, Hold and lists stepping, colours blended, the level within the
# fades; a key added by double-click and ◆ at the playhead, dragged in time and value, its ease and value from its menu,
# deleted with Delete; the curve removed; keys moving with their clip, staying put when its start is trimmed, copied
# with it; the scene playing never taking what the keys move; undo, files and their repair.
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8262
SHOT = os.environ.get("TL_KEYS_SHOT")
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

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
    # a zone whose first scene plays an effect with a number, a colour and a list among its controls
    info = E("""(() => {
      olm.loadProject(demoProject());
      const s = project.sources.find(s => s.kind === 'isf' && controlsOf(s).some(i => i.TYPE === 'float' && !/^speed$/i.test(i.NAME)) && controlsOf(s).some(i => i.TYPE === 'color'));
      const z = project.zones[0]; z.layers = [Object.assign(newLayer(), { src: s.id })]; storeScene(z); storeScene(z);
      const T = newTimeline(); project.timelines.push(T); ui.tlId = T.id;
      T.tracks[z.id] = [newClip(z.scenes.at(-2).id, 2, 8, { fadeIn: 0, fadeOut: 0 })];
      ui.dockTab = 'timeline'; ui.dockCollapsed = false; ui.dockH = 460; ui.tlZoom = 60; commit(); renderDock();
      const f = controlsOf(s).find(i => i.TYPE === 'float' && !/^speed$/i.test(i.NAME)), c = controlsOf(s).find(i => i.TYPE === 'color');
      return { z: z.id, src: s.id, f: f.NAME, fmin: f.MIN ?? 0, fmax: f.MAX ?? 1, col: c.NAME };
    })()""")
    time.sleep(0.5)
    Z, S, F, COL = info["z"], info["src"], info["f"], info["col"]
    C = f"project.timelines[0].tracks['{Z}'][0]"
    clip = lambda: pg.locator("#dockBody .tlclip").first

    # ---------- unfolding
    check("a clip has no keyframes at first; it is as tall as before", E(f"!{C}.curves") and abs(clip().bounding_box()["height"] - 42) < 2, clip().bounding_box())
    clip().hover(); pg.locator("#dockBody .tlclip .tlunf").first.click(); time.sleep(0.3)
    check("its ▸ unfolds it: + Control under its strip, its lane taller", pg.locator("#dockBody .tlclip.open .tlkadd").count() == 1 and clip().bounding_box()["height"] > 60)
    pg.locator("#dockBody .tlkadd").click(); time.sleep(0.2)
    items = E("[...document.querySelectorAll('.menu button, .menu .mi')].map(b => b.textContent.trim())")
    check("+ Control offers the Level and the scene's effect", any("Level" in t for t in items) and any(E(f"srcById('{S}').name") in t for t in items), items)
    pg.keyboard.press("Escape")
    E(f"(() => {{ const T = project.timelines[0], z = zoneById('{Z}'); addCurve(T, z, {C}, {{ kind: 'level' }}); addCurve(T, z, {C}, {{ kind: 'param', src: '{S}', ctl: '{F}' }}); addCurve(T, z, {C}, {{ kind: 'param', src: '{S}', ctl: '{COL}' }}); }})()"); time.sleep(0.3)
    cv = E(f"{C}.curves.map(c => [c.kind, c.ctl || '', c.keys.length, c.keys[0].t, c.keys[1].t])")
    check("a curve added has two keys, at the clip's start and end", cv == [["level", "", 2, 0, 8], ["param", F, 2, 0, 8], ["param", COL, 2, 0, 8]], cv)
    check("…a row each, plus + Control, each with its name", pg.locator("#dockBody .tlclip.open .tlkrow").count() == 4 and pg.locator("#dockBody .tlkrow .tlkname").first.text_content() == "Level")

    # ---------- the curves played
    lo, hi = info["fmin"], info["fmax"]
    E(f"""(() => {{ const c = {C};
      c.curves[1].keys = [{{ t: 0, v: {lo}, ease: 'linear' }}, {{ t: 4, v: {hi}, ease: 'linear' }}];
      c.curves[2].keys = [{{ t: 0, v: [1, 0, 0, 1], ease: 'linear' }}, {{ t: 8, v: [0, 0, 1, 1], ease: 'linear' }}];
      c.curves[0].keys = [{{ t: 0, v: 1, ease: 'linear' }}, {{ t: 6, v: 1, ease: 'linear' }}, {{ t: 8, v: 0, ease: 'linear' }}];
      commit({{ lists: false }}); }})()""")
    at = lambda t: E(f"""(() => {{ tlSeek(project.timelines[0], {t}); const z = zoneById('{Z}'); return [cueParamNow(z, '{S}', '{F}'), cueParamNow(z, '{S}', '{COL}'), z.opacity]; }})()""")
    v = at(2 + 2)
    check("a number half way between two keys is half way", abs(v[0] - (lo + hi) / 2) < 1e-3 * max(1, hi - lo), v)
    check("…a colour blended a quarter of the way", abs(v[1][0] - 0.75) < 1e-3 and abs(v[1][2] - 0.25) < 1e-3, v[1])
    check("…the level at full before its keys fall", abs(v[2] - 1) < 1e-3, v[2])
    v = at(2 + 7)
    check("the level half down between 6 s and 8 s; the number held after its last key", abs(v[2] - 0.5) < 1e-3 and abs(v[0] - hi) < 1e-6, v)
    E(f"{C}.curves[1].keys[0].ease = 'ease'"); v = at(2 + 1)
    check("Ease: slower at first than straight (a quarter of the way: 15.6%)", abs((v[0] - lo) / (hi - lo) - 0.15625) < 1e-3, v[0])
    E(f"{C}.curves[1].keys[0].ease = 'hold'"); v = at(2 + 3.9)
    check("Hold: the value stays until the next key", abs(v[0] - lo) < 1e-6, v[0])
    E(f"{C}.curves[1].keys[0].ease = 'linear'; commit({{ lists: false }})")
    check("the zone shows the clip's scene", E(f"zoneById('{Z}').scene") == E(f"{C}.scene"))
    at(2 + 2); E("pushHistory && commit({ lists: false })")
    keep = E(f"(() => {{ const z = zoneById('{Z}'), sc = z.scenes.find(s => s.id === z.scene), L = sc.layers.find(l => l.src === '{S}'); return [L.params['{S}'] && L.params['{S}']['{F}'], z._tlAnim]; }})()")
    check("the scene playing doesn't take what its keys move (a step of undo after)", keep[0] is None or abs(keep[0] - (lo + hi) / 2) > 1e-6, keep)

    # ---------- the mouse
    E("tlSeek(project.timelines[0], 0); refreshTimeline()"); time.sleep(0.3)
    row = pg.locator("#dockBody .tlkrow").nth(1); g = row.locator(".tlkgraph"); gb = g.bounding_box()
    g.dblclick(position={"x": 6 * 60, "y": gb["height"] / 2}); time.sleep(0.3)
    ks = E(f"{C}.curves[1].keys.map(k => [k.t, k.v])")
    check("a double-click on a row adds a key there (6 s), at the height clicked", len(ks) == 3 and abs(ks[2][0] - 6) < 0.05 and lo < ks[2][1] < hi, ks)
    n0 = E("hist.idx")
    key = pg.locator("#dockBody .tlkrow").nth(1).locator(".tlkey").nth(2); kb = key.bounding_box()
    x, y = kb["x"] + kb["width"] / 2, kb["y"] + kb["height"] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 60, y + 4, steps=4); pg.mouse.move(x - 60, gb["y"] + gb["height"], steps=3); pg.mouse.up(); time.sleep(0.3)
    ks2 = E(f"{C}.curves[1].keys.map(k => [k.t, k.v])")
    check("a key dragged: a second earlier, to the bottom of the range; one step of undo", abs(ks2[2][0] - 5) < 0.05 and abs(ks2[2][1] - lo) < 1e-6 and E("hist.idx") == n0 + 1, (ks2, E("hist.idx") - n0))
    check("…picked: white", pg.locator("#dockBody .tlkey.sel").count() == 1)
    pg.locator("#dockBody .tlkrow").nth(1).locator(".tlkey").nth(2).click(button="right"); time.sleep(0.2)
    pg.locator(".menu").get_by_text("Hold", exact=True).click(); time.sleep(0.2)
    check("its menu: Hold", E(f"{C}.curves[1].keys[2].ease") == "hold" and pg.locator("#dockBody .tlkey.hold").count() == 1)
    pg.locator("#dockBody .tlkrow").nth(1).locator(".tlkey").nth(2).click(); pg.mouse.move(700, 120); pg.keyboard.press("Delete"); time.sleep(0.3)
    check("Delete takes the key picked, not its clip", E(f"{C}.curves[1].keys.length") == 2 and E(f"!!{C}"))
    E("tlSeek(project.timelines[0], 2 + 3); refreshTimeline()"); time.sleep(0.2)
    pg.locator("#dockBody .tlkrow").nth(1).locator(".tlkb").first.click(); time.sleep(0.2)
    ks = E(f"{C}.curves[1].keys.map(k => [k.t, k.v])")
    check("◆ adds a key at the playhead with the value there", len(ks) == 3 and abs(ks[1][0] - 3) < 1e-6 and abs(ks[1][1] - (lo + (hi - lo) * 0.75)) < 1e-3 * max(1, hi - lo), ks)
    pg.locator("#dockBody .tlkrow").nth(1).locator(".tlkey").nth(1).dblclick(); time.sleep(0.3)
    check("a double-click on a key asks its value", pg.locator(".modal[aria-label=Key] input[type=number]").count() == 1)
    pg.locator(".modal[aria-label=Key] input[type=number]").fill(str(lo)); pg.locator(".modal[aria-label=Key] input[type=number]").dispatch_event("change")
    pg.locator(".modal[aria-label=Key] .btn.primary").click(); time.sleep(0.2)
    check("…and takes it", abs(E(f"{C}.curves[1].keys[1].v") - lo) < 1e-6)
    if SHOT: pg.screenshot(path=SHOT)

    # ---------- with the clip
    t0 = E(f"{C}.curves[1].keys.map(k => k.t)")
    cb = clip().locator(".tlhdr").bounding_box(); x, y = cb["x"] + 60, cb["y"] + cb["height"] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 60, y, steps=4); pg.mouse.up(); time.sleep(0.3)
    check("the clip moved: its keys go with it", abs(E(f"{C}.start") - 3) < 0.01 and E(f"{C}.curves[1].keys.map(k => k.t)") == t0, (E(f"{C}.start"), E(f"{C}.curves[1].keys.map(k => k.t)")))
    eb = clip().locator(".tledge.l").bounding_box(); x, y = eb["x"] + 2, eb["y"] + 10
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 60, y, steps=4); pg.mouse.up(); time.sleep(0.3)
    t1 = E(f"{C}.curves[1].keys.map(k => k.t)")
    check("its start trimmed a second: the keys stay where they were in time", abs(E(f"{C}.start") - 4) < 0.01 and all(abs(a - 1 - b) < 1e-6 for a, b in zip(t0, t1)), (t0, t1))
    E(f"duplicateClip(project.timelines[0], zoneById('{Z}'), {C})"); time.sleep(0.2)
    d = E(f"project.timelines[0].tracks['{Z}'][1]")
    check("a copy of the clip has its keyframes", d and len(d.get("curves", [])) == 3 and d["curves"][1]["keys"] == E(f"{C}.curves[1].keys"))
    E(f"deleteClip(project.timelines[0], zoneById('{Z}'), project.timelines[0].tracks['{Z}'][1])")
    pg.locator("#dockBody .tlkrow").nth(2).locator(".tlkb").nth(1).click(); time.sleep(0.2)
    check("× removes a curve", E(f"{C}.curves.map(c => c.ctl || c.kind)") == ["level", F])
    E("undo()"); time.sleep(0.3)
    check("undo brings it back", E(f"{C}.curves.length") == 3)
    check("the clip stays unfolded through undo", pg.locator("#dockBody .tlclip.open").count() == 1)
    clip().dblclick(position={"x": 30, "y": 8}); time.sleep(0.3)
    check("a double-click on the clip folds it; its ◆ says it has keyframes", pg.locator("#dockBody .tlclip.open").count() == 0 and pg.locator("#dockBody .tlclip.keyed").count() == 1 and abs(clip().bounding_box()["height"] - 42) < 2)

    # ---------- files
    saved = E(f"JSON.parse(serialize()).timelines[0].tracks['{Z}'][0].curves")
    check("files keep the curves", len(saved) == 3 and saved[2]["keys"][0]["v"] == [1, 0, 0, 1])
    rep = E(f"""(() => {{ const p = JSON.parse(serialize()), c = p.timelines[0].tracks['{Z}'][0];
      c.curves.push({{ kind: 'level', keys: [{{ t: 1, v: 0.5 }}] }}, {{ kind: 'param', src: 5, keys: [] }}, {{ kind: 'nope' }}, 'x');
      c.curves[1].keys.push({{ t: 'a', v: 'b' }}, {{ t: 2, v: 0.3, ease: 'bounce' }});
      const q = hydrate(p).timelines[0].tracks['{Z}'][0].curves;
      return [q.length, q[1].keys.length, q[1].keys.find(k => k.t === 2).ease, q.map(c => c.kind)]; }})()""")
    check("…and their repair (one per control, keys with a value, a known ease)", rep[0] == 3 and rep[2] == "linear" and rep[3] == ["level", "param", "param"], rep)
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
