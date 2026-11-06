# DDP out (Distributed Display Protocol, as WLED, Advatek and Falcon take it). Checked on the wire with a receiver that
# reads the packets by the protocol (not with the bridge's code): the 10-byte header (version 1, push on a frame's last
# packet, the sequence 1..15, RGB or RGBW, the display, the offset and length), a controller's outputs as one run of
# channels from 0 with none skipped, only the channels used, packets of at most 1440 bytes, nothing on Art-Net for it,
# Art-Net and DDP at once. In the interface: the protocol in the Patch tab, what it hides, addresses as channels of the run
# (outputs, rows, fixtures, the Inspector's start channel, the Channel monitor, CSV), a bridge that doesn't send DDP,
# undo and files.
import os, sys, time, socket, struct, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import FakeNode, start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8250
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)
def wait(fn, t=6.0):
    end = time.time() + t
    while time.time() < end:
        v = fn()
        if v: return v
        time.sleep(0.1)
    return fn()

def parse(d):
    """A DDP packet read by the protocol. Raises on anything out of place."""
    assert len(d) >= 10, "header"
    flags, seq, kind, dest = d[0], d[1], d[2], d[3]
    offset, n = struct.unpack(">IH", d[4:10])
    assert flags >> 6 == 1, "version 1"
    assert not flags & 0x10, "no timecode"
    assert len(d) == 10 + n and n <= 1440, "length"
    return {"push": bool(flags & 1), "seq": seq & 15, "kind": kind, "dest": dest, "offset": offset, "data": d[10:]}

class Rx:
    """Listens on UDP 4048 at 127.0.0.1, as a DDP controller does."""
    def __init__(self):
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.s.bind(("127.0.0.1", 4048)); self.s.settimeout(0.2)
        self.log, self.bad, self.lock, self.alive = [], [], threading.Lock(), True
        self.t = threading.Thread(target=self.loop, daemon=True); self.t.start()
    def loop(self):
        while self.alive:
            try: d, a = self.s.recvfrom(4096)
            except OSError: continue
            try: p = parse(d); p["t"] = time.time()
            except AssertionError as e: self.bad.append(str(e)); continue
            with self.lock: self.log.append(p)
    def since(self, t0):
        with self.lock: return [p for p in self.log if p["t"] >= t0]
    def frame(self, t0):
        """The last whole frame since t0: the packets up to a push, as one run of channels."""
        ps = self.since(t0)
        ends = [i for i, p in enumerate(ps) if p["push"]]
        if len(ends) < 2: return None
        part = ps[ends[-2] + 1:ends[-1] + 1]
        run = bytearray(max(p["offset"] + len(p["data"]) for p in part))
        for p in part: run[p["offset"]:p["offset"] + len(p["data"])] = p["data"]
        return {"run": bytes(run), "packets": part}
    def close(self): self.alive = False; self.t.join(1); self.s.close()

def project(ctrls, fixtures=None):
    red, blue = [1, 0, 0], [0, 0, 1]
    line = lambda fid, y, n, order="RGB": {"id": fid, "type": "line", "name": fid, "order": order, "x1": 20, "y1": y, "x2": 380, "y2": y, "pixels": n}
    return {"name": "D", "settings": {"compW": 400, "compH": 200, "transition": 0, "fps": 30},
            "fixtures": fixtures or [line("a", 50, 10), line("b", 150, 10)],
            "controllers": ctrls,
            "zones": [{"id": "z1", "name": "Zone 1", "x": 0, "y": 0, "w": 400, "h": 100, "opacity": 1, "layers": [{"id": "l1", "src": "b-solid", "params": {"b-solid": {"color": red + [1]}}, "opacity": 1, "blend": "alpha", "on": True}], "scenes": [], "scene": None},
                      {"id": "z2", "name": "Zone 2", "x": 0, "y": 100, "w": 400, "h": 100, "opacity": 1, "layers": [{"id": "l2", "src": "b-solid", "params": {"b-solid": {"color": blue + [1]}}, "opacity": 1, "blend": "alpha", "on": True}], "scenes": [], "scene": None}]}
DDP = lambda **kw: dict({"id": "c1", "name": "W", "ip": "127.0.0.1", "enabled": True, "protocol": "ddp", "mode": "pixels", "outputs": 2, "pxOut": 10, "chPx": 3, "chains": [["a"], ["b"]]}, **kw)

# ---------- a packet byte for byte, against one built here from the protocol
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import noupix
data = bytes([255, 0, 0] * 4)
check("a DDP packet: version 1 with push, sequence, RGB 8-bit, display 1, offset and length, then the channels",
      noupix.ddp_packet(1440, data, 7) == bytes([0x41, 7, 0x0B, 1, 0, 0, 0x05, 0xA0, 0, 12]) + data)
check("without push, and RGBW", noupix.ddp_packet(0, data, 15, noupix.DDP_RGBW, False)[:4] == bytes([0x40, 15, 0x1B, 1]))

node = FakeNode()
rx = Rx()
bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = br.new_page(viewport={"width": 1500, "height": 1000})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    E = pg.evaluate
    check("the bridge says it sends DDP", "ddp" in E("olm.bridge.hello.protocols"))
    E("p => olm.loadProject(p)", project([DDP()])); time.sleep(1)
    wait(lambda: E("olm.ui.outputOn"))
    C = "olm.project.controllers[0]"

    # ---------- on the wire
    t0 = time.time(); time.sleep(2.5)
    fr = wait(lambda: rx.frame(t0))
    check("DDP goes out to the controller's port 4048", fr is not None and len(rx.since(t0)) > 10, len(rx.since(t0)))
    check("its two outputs as one run from channel 0, none skipped: 10 red pixels, then 10 blue", fr and fr["run"] == bytes([255, 0, 0] * 10 + [0, 0, 255] * 10), fr and fr["run"].hex())
    check("only the channels used (60), in one packet with push, RGB, to the display", fr and len(fr["packets"]) == 1 and fr["packets"][0]["offset"] == 0
          and len(fr["packets"][0]["data"]) == 60 and fr["packets"][0]["kind"] == 0x0B and fr["packets"][0]["dest"] == 1)
    seqs = [p["seq"] for p in rx.since(t0)]
    check("the sequence counts 1 to 15 and starts again, one per frame", len(seqs) > 15 and all(s == a % 15 + 1 for a, s in zip(seqs, seqs[1:])) and 0 not in seqs, seqs[:20])
    check("nothing goes out as Art-Net for it", node.count(t0, time.time()) == 0, node.count(t0, time.time()))
    check("nothing on the wire breaks the protocol", not rx.bad, rx.bad[:3])

    # ---------- a long strip: packets of 1440 bytes, push on the last
    E("p => olm.loadProject(p)", project([DDP(outputs=1, pxOut=600, chains=[["a"]])], [{"id": "a", "type": "line", "name": "a", "order": "RGB", "x1": 20, "y1": 50, "x2": 380, "y2": 50, "pixels": 600}]))
    time.sleep(1); t0 = time.time(); time.sleep(0.8)
    fr = wait(lambda: rx.frame(t0))
    ps = fr["packets"] if fr else []
    check("600 RGB pixels (1800 channels, past a universe's 512) go in two packets: 1440 and 360", [(p["offset"], len(p["data"]), p["push"]) for p in ps] == [(0, 1440, False), (1440, 360, True)], [(p["offset"], len(p["data"]), p["push"]) for p in ps])
    check("…all red, no channel skipped at 511–512", fr and fr["run"] == bytes([255, 0, 0] * 600))
    seq = {p["seq"] for p in ps}
    check("a frame's packets share its sequence number", len(seq) == 1, seq)

    # ---------- RGBW
    E("p => olm.loadProject(p)", project([DDP(outputs=1, chPx=4, chains=[["a"]])], [{"id": "a", "type": "line", "name": "a", "order": "RGBW", "x1": 20, "y1": 50, "x2": 380, "y2": 50, "pixels": 10}]))
    time.sleep(1); t0 = time.time(); time.sleep(0.6)
    fr = wait(lambda: rx.frame(t0))
    check("RGBW pixels: the RGBW data type, 4 channels each", fr and fr["packets"][-1]["kind"] == 0x1B and len(fr["run"]) == 40 and fr["run"][:4] == bytes([255, 0, 0, 0]), fr and fr["run"][:8].hex())

    # ---------- Art-Net and DDP at once
    art = {"id": "c2", "name": "A", "ip": "127.0.0.1", "enabled": True, "outputs": 1, "upo": 1, "startUniverse": 0, "chains": [["b"]]}
    E("p => olm.loadProject(p)", project([DDP(outputs=1, chains=[["a"]]), art])); time.sleep(1)
    t0 = time.time(); time.sleep(0.8)
    fr = wait(lambda: rx.frame(t0))
    check("Art-Net and DDP go out together: a over DDP, b over Art-Net", fr and fr["run"] == bytes([255, 0, 0] * 10) and node.count(t0, time.time()) > 5 and node.last(0)[:3] == bytes([0, 0, 255]))
    check("the status bar names both", "DDP" in (pg.get_attribute("#bridgePill", "title") or "") or "DDP" in E("outName()"), E("outName()"))

    # ---------- the Patch tab
    E("p => olm.loadProject(p)", project([dict(DDP(), protocol="artnet", mode="universes", upo=1)])); time.sleep(0.8)
    E("ui.dockTab = 'patch'; ui.dockCollapsed = false; ui.selCtrl = 'c1'; renderDock()"); time.sleep(0.3)
    proto = lambda label: pg.locator(".ctrl-fields .seg button", has_text=label).first
    check("the Patch tab offers Art-Net, sACN and DDP", proto("DDP").count() == 1 and pg.locator("input[aria-label='Start universe']").count() == 1)
    proto("DDP").click(); time.sleep(0.8)
    c = E("(() => { const c = olm.project.controllers[0]; return [c.protocol, c.mode, c.split, c.startUniverse]; })()")
    check("choosing DDP: by pixels, no channels skipped, no universe to start on", c == ["ddp", "pixels", True, 0], c)
    check("…and the Patch tab hides what doesn't apply: Start uni, Per output, Skip ch 511–512", pg.locator("input[aria-label='Start universe']").count() == 0
          and pg.locator(".ctrl-fields .seg button", has_text="Universes").count() == 0 and pg.locator("#ctrlSkip").count() == 0)
    check("the controller's row says DDP", "DDP" in pg.locator(".ctrl .s").first.text_content())
    E("(() => { const c = olm.project.controllers[0]; c.pxOut = 10; markPatch(); commit(); })()"); time.sleep(0.5)
    ur = pg.eval_on_selector_all(".outs .ur", "els => els.map(e => e.textContent)")
    check("each output shows its channels in the run: ch 1 to 30, then 31 to 60", ur == ["DDP ch 1 ch 30", "DDP ch 31 ch 60"], ur)
    ad = pg.eval_on_selector_all(".outs .prow .ad", "els => els.map(e => e.textContent)")
    check("each fixture's row too", ad == ["ch 1–30", "ch 31–60"], ad)
    check("and the fixtures' addresses", E("addrText(olm.project.fixtures[1]._patch)") == "ch 31  →  ch 60" and E("pixelAddrText(olm.project.fixtures[1], 1)") == "ch 34–36")
    t0 = time.time(); time.sleep(0.6)
    fr = wait(lambda: rx.frame(t0))
    check("switched in the Patch tab, DDP goes out at once", fr and fr["run"] == bytes([255, 0, 0] * 10 + [0, 0, 255] * 10))

    # the Inspector: a fixture's start set as one channel of the run
    E("(() => { ui.sel = new Set(['b']); ui.rightTab = 'inspector'; onSelection(); })()"); time.sleep(0.3)
    pg.get_by_text("Set its channel").click(); time.sleep(0.4)
    ch = pg.locator("#rightBody input[aria-label='Channel']")
    check("the Inspector sets a fixture's start as a channel of the run", ch.count() == 1 and ch.input_value() == "31", ch.count() and ch.input_value())
    # one output of 1000 pixels with both on it, so its channels go past a universe's 512
    E("(() => { const c = olm.project.controllers[0]; c.outputs = 1; c.pxOut = 1000; ensureChains(c); c.chains[0] = ['a', 'b']; markPatch(); commit(); renderRight(); })()"); time.sleep(0.5)
    ch = pg.locator("#rightBody input[aria-label='Channel']")
    ch.fill("601"); ch.press("Enter"); time.sleep(0.8)
    check("…past a universe's 512 too: b starts at channel 601", E("addrText(olm.project.fixtures[1]._patch)") == "ch 601  →  ch 630", E("addrText(olm.project.fixtures[1]._patch)"))
    t0 = time.time(); time.sleep(0.6)
    fr = wait(lambda: rx.frame(t0))
    check("…and goes out there, the gap between left dark", fr and fr["run"][:30] == bytes([255, 0, 0] * 10) and fr["run"][30:600] == bytes(570) and fr["run"][600:630] == bytes([0, 0, 255] * 10), fr and len(fr["run"]))

    # the Channel monitor and CSV
    check("the Channel monitor lists DDP by channels", E("(() => { ensurePatch(); return universes.map(u => u.ddp) })()") == [True, True])
    E("ui.monitorKey = null; openMonitor(); updateMonitorUI()"); time.sleep(0.3)
    lst = E("[...monEl.querySelectorAll('.ulist > div > span:first-child')].map(e => e.textContent)")
    check("…in pages of 512 of the run, each up to the channels used: ch 1–30, ch 513–630", lst == ["127.0.0.1 · DDP ch 1–30", "127.0.0.1 · DDP ch 513–630"], lst)
    E("(() => { ui.monitorKey = universes[1].key; updateMonitorUI(); })()"); time.sleep(0.2)
    bar = E("monEl.querySelector('.bar .mono').textContent")
    check("its head says DDP and the channels of the run, no universe", "DDP · channels 513–1024" in bar and "universe" not in bar, bar)
    read = E("""(() => { const c = monCanvas, r = c.getBoundingClientRect(), w = r.width / 32, hh = r.height / 16;
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + (88 % 32 + 0.5) * w, clientY: r.top + (Math.floor(88 / 32) + 0.5) * hh }));
      return monEl.querySelector('.readout').textContent; })()""")
    check("hovering a channel names it as the controller counts it: ch 601, b's first pixel", read.startswith("ch 601 = ") and "b · pixel 1 · R" in read, read)
    E("monWin.close()"); time.sleep(0.2)
    csv = E("(() => { let out = ''; const d = window.download; window.download = (n, t) => { out = t; }; try { exportCSV(); } finally { window.download = d; } return out; })()")
    line = [l for l in csv.split("\n") if l.startswith("b,")]
    check("CSV: DDP, no universes, the channels of the run", line and ",DDP," in line[0] and line[0].split(",")[10:14] == ["", "601", "", "630"], line)

    # ---------- a bridge that doesn't send DDP: left out of the frame (it would read the frame wrong)
    E("(() => { olm.bridge.hello.protocols = ['artnet', 'sacn', 'mixed']; markPatch(); })()"); time.sleep(0.6)
    t0 = time.time(); time.sleep(0.6)
    check("a bridge that doesn't send DDP gets no DDP universes", not rx.since(t0 + 0.2) and E("universes.every(u => !u.enabled)"), len(rx.since(t0 + 0.2)))
    renderd = E("(() => { renderDock(); return !!document.querySelector('.ctrl-fields .note.warn'); })()")
    check("…and the Patch tab says so", renderd)
    E("(() => { olm.bridge.hello.protocols.push('ddp'); markPatch(); renderDock(); })()"); time.sleep(0.4)

    # ---------- undo and files
    E("(() => { const c = olm.project.controllers[0]; c.protocol = 'artnet'; ensureChains(c); markPatch(); commit(); })()")
    E("undo()"); time.sleep(0.3)
    check("undo brings DDP back", E(C + ".protocol") == "ddp")
    saved = E("JSON.parse(serialize())")
    check("a file keeps DDP", saved["controllers"][0]["protocol"] == "ddp")
    rep = E("p => { const q = hydrate(p); const c = q.controllers[0]; return [c.protocol, c.mode, c.split, c.startUniverse]; }",
            project([dict(DDP(), mode="universes", split=False, startUniverse=7)]))
    check("opening a file: a DDP controller is by pixels from 0, none skipped", rep == ["ddp", "pixels", True, 0], rep)
    check("an unknown protocol opens as Art-Net", E("p => hydrate(p).controllers[0].protocol", project([dict(DDP(), protocol="ddx")])) == "artnet")
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill(); rx.close(); node.close()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
