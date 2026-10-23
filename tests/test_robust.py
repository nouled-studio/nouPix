# Robustness and optimisation checks for Weft 0.3.1 (run against a build dir via WEFT=...)
import os, sys, time, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import FakeNode, start_bridge, CHROME_ARGS, WEFT
from test_e2e_lib import base_project, solid
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8101
ONLY = sys.argv[2].split(",") if len(sys.argv) > 2 else None
node = FakeNode("127.0.0.1")
bridge = start_bridge(PORT)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
FI = "(olm.frameIndex !== undefined ? olm.frameIndex : Math.round(olm.clockT * 1000))"
def want(name): return ONLY is None or name in ONLY
PROG_COUNTER = """(() => { const P = WebGLRenderingContext.prototype, cp = P.createProgram, dp = P.deleteProgram; window.__progs = 0;
  P.createProgram = function () { const p = cp.call(this); if (p) window.__progs++; return p; };
  P.deleteProgram = function (p) { if (p) window.__progs--; return dp.call(this, p); }; })();"""
def uni3():
    d = node.last(3)
    return list(d[:6]) if d else None
def wait_uni3(pred, secs=8):
    t = time.time()
    while time.time() - t < secs:
        v = uni3()
        if v and pred(v): return v
        time.sleep(0.1)
    return uni3()
with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS)
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); ctx.add_init_script(PROG_COUNTER)
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    logs = []; pg.on("console", lambda m: logs.append(m.text) if m.type == "error" else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")

    # ---------------------------------------------------------------- 1. malformed project files
    if want("files"):
      try:
          cases = {
              "matrix with no fields": {"fixtures": [{"type": "matrix"}]},
              "junk entries and text numbers": {"fixtures": [None, 5, "x", {"type": "line", "x1": "10", "y1": "abc", "pixels": "30"}]},
              "partial controllers": {"fixtures": [{"id": "f1", "type": "line"}], "controllers": [None, {"ip": 12345, "chains": [None, ["f1", None, {}]]}, {}]},
              "odd sources": {"sources": [None, {"id": "x", "kind": "weird", "code": 5}, {"builtin": "plasma"}, {"id": "i1", "kind": "isf", "code": 7}, {"id": "v1", "kind": "video", "rate": "fast"}]},
              "odd zones and scenes": {"zones": [None, {"layers": None, "scenes": [None, {"layers": [None]}]}]},
              "bad settings": {"settings": {"compW": 0, "compH": -5, "fps": "abc", "gamma": None, "trim": [1, "x", None], "whiteMode": "bogus"}},
              "bad matrix wiring, path points, colour order": {"fixtures": [{"type": "matrix", "start": "XY", "dir": 5, "cols": 4, "rows": 2}, {"type": "path", "pts": [1, "a", 3]}, {"type": "path", "pts": "bad"}, {"type": "line", "order": "grb"}, {"type": "circle", "order": "xyz", "sweep": None}]},
              "absurd pixel counts": {"fixtures": [{"type": "line", "pixels": 1e12}, {"type": "matrix", "cols": 1e9, "rows": 1e9}]},
              "duplicate ids": {"fixtures": [{"id": "a", "type": "line"}, {"id": "a", "type": "line"}], "zones": [{"id": "z"}, {"id": "z"}]},
              "not a project": None,
          }
          SUMMARY = """p => { try { const h = hydrate(p); return { ok: true,
              fx: h.fixtures.map(f => ({ type: f.type, id: f.id, x1: f.x1, y1: f.y1, pixels: f.pixels, cols: f.cols, rows: f.rows, start: f.start, dir: f.dir, pts: f.pts, order: f.order, enabled: f.enabled, sweep: f.sweep })),
              ctrl: h.controllers.map(c => ({ ip: c.ip, chains: c.chains, name: c.name, enabled: c.enabled })),
              src: h.sources.filter(s => !s.builtin).map(s => ({ id: s.id, kind: s.kind, code: s.code, rate: s.rate })),
              zones: h.zones.map(z => ({ id: z.id, layers: z.layers.length, scenes: z.scenes.map(s => s.layers.length) })),
              set: { compW: h.settings.compW, compH: h.settings.compH, fps: h.settings.fps, gamma: h.settings.gamma, trim: h.settings.trim, whiteMode: h.settings.whiteMode } }; }
            catch (e) { return { ok: false, err: String(e) }; } }"""
          res = {k: pg.evaluate(SUMMARY, v) for k, v in cases.items()}
          r = res["matrix with no fields"]
          check("file: matrix with no fields gets its defaults", r["ok"] and r["fx"][0]["cols"] == 16 and r["fx"][0]["start"] == "TL" and r["fx"][0]["enabled"] is True, r)
          r = res["junk entries and text numbers"]
          check("file: junk entries skipped, numbers written as text read as numbers", r["ok"] and len(r["fx"]) == 1 and r["fx"][0]["x1"] == 10 and r["fx"][0]["y1"] == 0 and r["fx"][0]["pixels"] == 30, r)
          r = res["partial controllers"]
          check("file: partial controllers get defaults", r["ok"] and len(r["ctrl"]) == 2 and r["ctrl"][0]["ip"] == "12345" and r["ctrl"][0]["enabled"] is True and all(isinstance(ch, list) for ch in r["ctrl"][0]["chains"]), r.get("ctrl", r))
          r = res["odd sources"]
          check("file: odd sources are made usable", r["ok"] and [s["id"] for s in r["src"]] == ["x", "i1", "v1"] and r["src"][0]["kind"] == "image" and r["src"][1]["code"] == "" and r["src"][2]["rate"] == 1, r.get("src", r))
          r = res["odd zones and scenes"]
          check("file: odd zones and scenes", r["ok"] and len(r["zones"]) == 2 and r["zones"][1]["scenes"] == [1], r.get("zones", r))
          r = res["bad settings"]
          check("file: bad settings fall back to defaults", r["ok"] and r["set"] == {"compW": 16, "compH": 16, "fps": 40, "gamma": 1, "trim": None, "whiteMode": "off"}, r.get("set", r))
          r = res["bad matrix wiring, path points, colour order"]
          ok = r["ok"] and r["fx"][0]["start"] == "TL" and r["fx"][0]["dir"] == "H" and r["fx"][1]["pts"] == [1, 3] and r["fx"][2]["pts"] == [0, 0, 100, 0] and r["fx"][3]["order"] == "GRB" and r["fx"][4]["order"] == "RGB" and r["fx"][4]["sweep"] == 360
          check("file: matrix wiring, path points, colour order", ok, r.get("fx", r))
          r = res["absurd pixel counts"]
          check("file: absurd pixel counts are capped", r["ok"] and r["fx"][0]["pixels"] == 1e6 and r["fx"][1]["cols"] * r["fx"][1]["rows"] <= 1e6, r.get("fx", r))
          r = res["duplicate ids"]
          check("file: duplicate ids are made unique", r["ok"] and len({f["id"] for f in r["fx"]}) == 2 and len({z["id"] for z in r["zones"]}) == 2, r)
          check("file: not a project opens as an empty one", res["not a project"]["ok"], res["not a project"])
          # the files that load must also run: load each (except the huge one) and let it render
          e0 = len(errs); bad = []
          for k, v in cases.items():
              if k == "absurd pixel counts": continue
              try:
                  pg.evaluate("p => olm.loadProject(p)", v); f0 = pg.evaluate(FI); time.sleep(0.6)
                  if pg.evaluate(FI) <= f0: bad.append(k + ": frames stopped")
              except Exception as e: bad.append(k + ": " + str(e)[:120])
          time.sleep(0.5)
          check("file: every one of them opens and keeps running", not bad and len(errs) == e0, bad or errs[e0:e0 + 3])

      except Exception as e: check("group ran to the end", False, str(e)[:200])
    # ---------------------------------------------------------------- 2. the stage keeps drawing after an error
    if want("stage"):
      try:
          pg.evaluate("p => { localStorage.clear(); olm.loadProject(p); }", base_project([solid([1, 0, 0])])); time.sleep(1)
          pg.evaluate("""() => { window.__sdraws = 0; const dv = window.drawView; window.drawView = function () { window.__sdraws++; return dv.apply(this, arguments); };
              const dz = window.drawZones; window.__armed = true; window.drawZones = function () { if (window.__armed) { window.__armed = false; throw new Error('test: stage draw failed'); } return dz.apply(this, arguments); }; }""")
          time.sleep(1.0); d1 = pg.evaluate("window.__sdraws"); time.sleep(2.5); d2 = pg.evaluate("window.__sdraws")
          check("stage keeps drawing after a drawing error", pg.evaluate("!window.__armed") and d2 > d1, (d1, d2))
          e0 = len(errs)
          check("the drawing error is reported once in the console, not thrown", sum("stage draw failed" in l for l in logs) == 1 and len(errs) == e0, [l for l in logs if "stage" in l][:3])

      except Exception as e: check("group ran to the end", False, str(e)[:200])
    # ---------------------------------------------------------------- 3. output keeps running if content rendering fails
    if want("content"):
      try:
          pg.evaluate("p => { olm.loadProject(p); olm.setOutput(true); }", base_project([solid([1, 0, 0])])); time.sleep(0.5)
          got = wait_uni3(lambda v: v[:3] == [255, 0, 0])
          pg.evaluate("""() => { window.__rl = window.renderLook; window.renderLook = function () { throw new Error('test: content failed'); }; }""")
          time.sleep(1.0); t0 = time.time(); c0 = node.count(t0, 1e12); time.sleep(2.0); n = node.count(t0, time.time())
          held = uni3()
          pg.evaluate("() => { window.renderLook = window.__rl; }")
          check("Art-Net keeps flowing while content rendering fails", n >= 8, f"{n / 2:.1f} packets/s, last {held}")
          check("...and holds the last colours", held and held[:3] == [255, 0, 0], held)
          pg.evaluate("() => { const z = olm.project.zones[0]; z.layers[0].params['b-solid'].color = [0, 1, 0, 1]; }")
          check("rendering recovers when the error goes away", wait_uni3(lambda v: v[:3] == [0, 255, 0])[:3] == [0, 255, 0], uni3())
          pg.evaluate("olm.setOutput(false)"); time.sleep(0.3)

      except Exception as e: check("group ran to the end", False, str(e)[:200])
    # ---------------------------------------------------------------- 4. GPU context loss and restore
    if want("gpu"):
      try:
          pg.evaluate("p => { olm.loadProject(p); olm.setOutput(true); }", base_project([solid([0, 0, 1])])); time.sleep(0.5)
          wait_uni3(lambda v: v[:3] == [0, 0, 255])
          for label, canvas in [("mixer", "olm.mixer.canvas"), ("shaders", "olm.glCanvas")]:
              pg.evaluate(f"() => {{ const c = {canvas}; window.__lc = (c.getContext('webgl2') || c.getContext('webgl')).getExtension('WEBGL_lose_context'); window.__lc.loseContext(); }}")
              time.sleep(1.2); t0 = time.time(); time.sleep(1.0)
              held, n = uni3(), node.count(t0, time.time())
              check(f"GPU reset ({label}): output keeps its last colours", held[:3] == [0, 0, 255] and n >= 4, (held, n))
              pg.evaluate("() => window.__lc.restoreContext()"); time.sleep(1.5)
              col = [1, 1, 0] if label == "mixer" else [0, 1, 1]
              pg.evaluate("c => { olm.project.zones[0].layers[0].params['b-solid'].color = c.concat([1]); }", col)
              exp = [255 * c for c in col]
              got = wait_uni3(lambda v: v[:3] == exp, 12)
              check(f"GPU reset ({label}): rendering comes back after the restore", got[:3] == exp and pg.evaluate("olm.mixer.sampling()"), got)
              pg.evaluate("() => { olm.project.zones[0].layers[0].params['b-solid'].color = [0, 0, 1, 1]; }"); wait_uni3(lambda v: v[:3] == [0, 0, 255])
          check("GPU reset: no page errors", not errs, errs[:3])
          pg.evaluate("olm.setOutput(false)"); time.sleep(0.3)

      except Exception as e: check("group ran to the end", False, str(e)[:200])
    # ---------------------------------------------------------------- 5. no GPU programs leak when projects are opened
    if want("leak"):
      try:
          A = base_project([solid([1, 0, 0]), dict(solid([0, 0, 1]), src="b-plasma", params={}, blend="add")])
          Bp = base_project([dict(solid([1, 0, 0]), src="b-noise", params={}), dict(solid([1, 0, 0]), src="b-bars", params={})])
          counts = []
          for i in range(5):
              for proj in (A, Bp):
                  pg.evaluate("p => olm.loadProject(p)", proj); time.sleep(1.2)
              counts.append(pg.evaluate("window.__progs"))
          check("opening projects again and again does not pile up GPU programs", counts[-1] <= counts[1] + 1, counts)

      except Exception as e: check("group ran to the end", False, str(e)[:200])
    # ---------------------------------------------------------------- 6. a hidden selected zone is only drawn when needed
    if want("hidden"):
      try:
          pr = base_project([solid([1, 0, 0])], [{"id": "s1", "name": "Blue", "fade": 2.0, "layers": [solid([0, 0, 1], id="L9")]}])
          top = {"id": "z2", "name": "Top", "tag": "#fff", "x": 0, "y": 0, "w": 400, "h": 200, "opacity": 1, "layers": [solid([0, 1, 0])], "scenes": [], "scene": None}
          pr["zones"].append(top)
          pg.evaluate("p => { olm.loadProject(p); olm.selectZone(olm.project.zones[0]); document.querySelector('#rightTabs button[data-tab=inspector]').click(); }", pr); time.sleep(0.8)
          pg.evaluate("""() => { window.__zr = {}; const mz = olm.mixer.zone; olm.mixer.__orig = mz; olm.mixer.zone = function (z, ...a) { window.__zr[z.id] = (window.__zr[z.id] || 0) + 1; return mz.call(this, z, ...a); }; }""")
          def renders(secs):
              pg.evaluate("window.__zr = {}"); f0 = pg.evaluate(FI); time.sleep(secs)
              return pg.evaluate("window.__zr.z1 || 0"), pg.evaluate(FI) - f0
          r1 = renders(1.5)
          check("hidden selected zone is not drawn while its preview is off screen", r1[0] == 0 and r1[1] > 3, r1)
          pg.evaluate("document.querySelector('#rightTabs button[data-tab=content]').click()"); time.sleep(0.3)
          r2 = renders(1.5)
          check("...it is drawn while its layer preview shows", r2[0] >= r2[1] - 2 and r2[0] > 3, r2)
          pg.evaluate("document.querySelector('#rightTabs button[data-tab=inspector]').click()"); time.sleep(0.3)
          pg.evaluate("() => olm.goScene(olm.project.zones[0], olm.project.zones[0].scenes[0])")
          r3 = renders(1.0)
          check("...and while it fades, so an interrupted fade starts from its picture", r3[0] >= r3[1] - 2 and r3[0] > 2, r3)
          pg.evaluate("() => { olm.mixer.zone = olm.mixer.__orig; }")

      except Exception as e: check("group ran to the end", False, str(e)[:200])
    # ---------------------------------------------------------------- 7. the stage redraws only when something changed
    if want("redraw"):
      try:
          pg.evaluate("p => { olm.loadProject(p); document.querySelector('#rightTabs button[data-tab=inspector]').click(); }", base_project([solid([1, 0, 0])])); time.sleep(1)
          pg.evaluate("""() => { window.__draws = 0; window.__raf = 0; const f = () => { window.__raf++; requestAnimationFrame(f); }; requestAnimationFrame(f);
              if (!window.__dv) { window.__dv = window.drawView; window.drawView = function () { window.__draws++; return window.__dv.apply(this, arguments); }; } }""")
          time.sleep(0.5)
          pg.evaluate("window.__draws = 0; window.__raf = 0; window.__f0 = (olm.frameIndex ?? 0)"); time.sleep(3)
          idle = pg.evaluate("({ draws: window.__draws, raf: window.__raf, ticks: (olm.frameIndex ?? 0) - window.__f0 })")
          check("idle: the stage is drawn once per output frame at most", idle["draws"] <= idle["ticks"] + 1, idle)
          box = pg.locator("#view").bounding_box()
          pg.evaluate("window.__draws = 0; window.__raf = 0; window.__f0 = (olm.frameIndex ?? 0)")
          t0 = time.time()
          while time.time() - t0 < 2: pg.mouse.move(box["x"] + 200 + (time.time() - t0) * 100, box["y"] + 200)
          moving = pg.evaluate("({ draws: window.__draws, raf: window.__raf, ticks: (olm.frameIndex ?? 0) - window.__f0 })")
          # since 1.0.2 the pointer doesn't force a redraw on every move (that dropped output frames): the stage keeps
          # being drawn, within its budget of about 30 a second for moving content
          check("moving the pointer: the stage keeps being drawn, within its budget", 0 < moving["draws"] <= 2 * 31, moving)

      except Exception as e: check("group ran to the end", False, str(e)[:200])
    # ---------------------------------------------------------------- 8. WebSocket.send copies the frame, so the frame can be reused
    if want("wscopy"):
      try:
          pg.evaluate("p => { olm.loadProject(p); olm.setOutput(false); }", base_project([solid([1, 0, 0])])); time.sleep(0.3)
          pg.evaluate(f"""async () => {{
              const ws = new WebSocket('ws://127.0.0.1:{PORT}/ws'); ws.binaryType = 'arraybuffer';
              await new Promise(r => ws.onopen = r); ws.send(JSON.stringify({{ t: 'output', on: true }}));
              await new Promise(r => setTimeout(r, 200));
              const buf = new ArrayBuffer(4 + 520), u8 = new Uint8Array(buf), dv = new DataView(buf);
              u8[0] = 1; dv.setUint16(2, 1, true); u8.set([127, 0, 0, 1], 4); dv.setUint16(8, 42, true); dv.setUint16(10, 512, true);
              u8.fill(11, 12); ws.send(buf); u8.fill(22, 12); ws.send(buf); u8.fill(33, 12);
              await new Promise(r => setTimeout(r, 400)); ws.close(); }}""")
          time.sleep(0.3)
          with node.lock: seen = [e[4][0] for e in node.log if e[1] == 0x5000 and e[2] == 42]
          check("WebSocket.send copies the data at the call", seen[:2] == [11, 22] and 33 not in seen, seen[:6])

      except Exception as e: check("group ran to the end", False, str(e)[:200])
    # ---------------------------------------------------------------- 9. undo does not cut other zones' fades short
    if want("undo"):
      try:
          pr = base_project([solid([1, 0, 0])], [{"id": "s1", "name": "Blue", "fade": 10.0, "layers": [solid([0, 0, 1], id="L9")]}])
          pr["zones"][0].update({"w": 200})
          pr["zones"].append({"id": "z2", "name": "Right", "tag": "#fff", "x": 200, "y": 0, "w": 200, "h": 200, "opacity": 1, "layers": [solid([0, 1, 0])], "scenes": [], "scene": None})
          pg.evaluate("p => { olm.loadProject(p); }", pr); time.sleep(1.0)
          pg.evaluate("() => olm.goScene(olm.project.zones[0], olm.project.zones[0].scenes[0])"); time.sleep(1.2)
          pg.evaluate("() => { setZoneOpacity(olm.project.zones[1], 0.5); commit(); }"); time.sleep(0.5)
          pg.evaluate("() => undo()"); time.sleep(0.8)
          st = pg.evaluate("() => ({ fading: !!olm.project.zones[0]._fade, px0: Array.from(olm.project.fixtures[0]._col.slice(0, 3)), op: olm.project.zones[1].opacity })")
          mid = 0 < st["px0"][0] < 255 and 0 < st["px0"][2] < 255
          check("undo of an edit elsewhere lets a zone's fade carry on", st["fading"] and mid and st["op"] == 1, st)
      except Exception as e: check("group ran to the end", False, str(e)[:200])

    # ---------------------------------------------------------------- 10. the guide image is kept between sessions, and not rewritten on every change
    if want("guide"):
      try:
          GUIDE = """() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d');
              const d = x.createImageData(300, 200); for (let i = 0; i < d.data.length; i++) d.data[i] = (i * 7919) % 251; x.putImageData(d, 0, 0); return c.toDataURL('image/png'); }"""
          pg.evaluate("p => { localStorage.clear(); olm.loadProject(p); }", base_project([solid([1, 0, 0])], [{"id": "s1", "name": "Blue", "fade": 0, "layers": [solid([0, 0, 1])]}])); time.sleep(0.8)
          url = pg.evaluate(GUIDE)
          pg.evaluate("u => { olm.project.guide = { src: u, name: 'g.png' }; loadGuide(); commit(); }", url); time.sleep(0.8)
          sizes = pg.evaluate("""async () => { const ls = Storage.prototype.setItem, out = [];
              Storage.prototype.setItem = function (k, v) { out.push([k, v.length]); return ls.call(this, k, v); };
              const z = olm.project.zones[0]; for (let i = 0; i < 3; i++) { olm.goScene(z, z.scenes[0], true); await new Promise(r => setTimeout(r, 600)); }
              Storage.prototype.setItem = ls; return out; }""")
          check("scene changes save the project without rewriting the guide image", sizes and all(k != "noupix.guide" and n < 20000 for k, n in sizes), sizes)
          pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
          check("the guide image comes back after a reload", pg.evaluate("olm.project.guide && olm.project.guide.src") == url)
          pg.evaluate("() => { olm.project.guide = null; commit(); }"); time.sleep(0.8)
          pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
          check("a removed guide stays removed", pg.evaluate("!olm.project.guide && localStorage.getItem('noupix.guide') === null"))
          # a project saved by 0.3.0 keeps its guide inside the project
          old = base_project([solid([1, 0, 0])]); old["guide"] = {"src": url, "name": "old.png"}
          pg.evaluate("p => { for (const k of ['project', 'guide']) localStorage.removeItem('noupix.' + k); localStorage.setItem('weft.project', JSON.stringify(p)); }", old)
          pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(1.2)
          st = pg.evaluate("() => ({ src: olm.project.guide && olm.project.guide.src, inProject: JSON.parse(localStorage.getItem('noupix.project')).guide.src, own: !!localStorage.getItem('noupix.guide'), oldGone: localStorage.getItem('weft.project') === null })")
          check("a project kept by Weft carries over, keeps its guide and moves it to its own key", st["src"] == url and st["inProject"] is None and st["own"] and st["oldGone"], {k: (v[:30] if isinstance(v, str) else v) for k, v in st.items()})
      except Exception as e: check("group ran to the end", False, str(e)[:200])

    # ---------------------------------------------------------------- 11. freeing a shader must not break the others (they share one GL context)
    if want("dropshader"):
      try:
          code = '/*{ "ISFVSN": "2", "INPUTS": [] }*/\nvoid main() { gl_FragColor = vec4(0.2, 0.4, 0.6, 1.0); }'
          SET = "c => { olm.project.zones[0].layers[0].params['b-solid'].color = c.concat([1]); }"
          pg.evaluate("p => { olm.loadProject(p); olm.setOutput(true); }", base_project([solid([1, 0, 0])])); time.sleep(1.0)
          wait_uni3(lambda v: v[:3] == [255, 0, 0])
          pg.wait_for_function("runtimes.size >= 21 && [...thumbs.values()].every(c => !c._stale)", timeout=120000)  # thumbnails done compiling
          time.sleep(0.5)
          # compile a custom shader (it is now the last one set up), then remove it
          pg.evaluate("c => { const src = { id: 'cust1', kind: 'isf', name: 'Cust', code: c }; olm.project.sources.push(src); runtimeOf(src); removeSource(src); }", code)
          pg.evaluate(SET, [0, 1, 0])
          got = wait_uni3(lambda v: v[:3] == [0, 255, 0], 5)
          check("removing a custom shader leaves the others rendering", got[:3] == [0, 255, 0], got)
          # compile one again, then open another project (which frees it) and come back
          pg.evaluate("c => { const src = { id: 'cust2', kind: 'isf', name: 'Cust2', code: c }; olm.project.sources.push(src); runtimeOf(src); }", code)
          pg.evaluate("p => olm.loadProject(p)", base_project([solid([0, 0, 1])])); time.sleep(0.5)
          pg.evaluate("olm.setOutput(true)")
          got = wait_uni3(lambda v: v[:3] == [0, 0, 255], 5)
          check("...and so does opening another project that frees it", got[:3] == [0, 0, 255], got)
          pg.evaluate("olm.setOutput(false)"); time.sleep(0.3)
      except Exception as e: check("group ran to the end", False, str(e)[:200])

    check("no page errors overall", not errs, errs[:3])
    br.close()
bridge.terminate(); out = bridge.communicate()[0]; node.close()
print("FAILED:", fails or "none")
