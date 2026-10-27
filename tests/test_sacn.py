# sACN (E1.31) out instead of Art-Net, one at a time, chosen in Settings → Output. Checked on the wire with a receiver
# that reads the packets by the standard (not with the bridge's code): every layer's fields and lengths, the CID and the
# source name, priority, sequence numbers per universe, the universes one higher than Art-Net's (0 goes out as 1), unicast
# to each controller and multicast to each universe's group, the universe discovery packets, streams ended with three
# Stream_Terminated packets (back to Art-Net, multicast switched, output off, the window closed). In the interface: the
# universes shown as sACN counts them (patch, First uni typed from 1, the menus, the DMX monitor, the status bar, CSV),
# conflicts with multicast, undo, files and their repair. A packet is also checked byte for byte against one built here.
import os, sys, time, json, socket, struct, threading, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import FakeNode, start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8220
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

be = lambda b: int.from_bytes(b, "big")
def parse(d):
    """An E1.31 packet read by the standard. Raises on anything out of place."""
    assert d[:16] == b"\x00\x10\x00\x00ASC-E1.17\x00\x00\x00", "root preamble"
    assert d[16] >> 4 == 7 and be(d[16:18]) & 0xFFF == len(d) - 16, "root flags and length"
    vec, cid = be(d[18:22]), d[22:38]
    assert d[38] >> 4 == 7 and be(d[38:40]) & 0xFFF == len(d) - 38, "framing flags and length"
    name = d[44:108].split(b"\x00")[0].decode("utf-8")
    if vec == 4:
        assert be(d[40:44]) == 2, "framing vector"
        assert d[115] >> 4 == 7 and be(d[115:117]) & 0xFFF == len(d) - 115, "DMP flags and length"
        assert d[117] == 2 and d[118] == 0xA1 and be(d[119:121]) == 0 and be(d[121:123]) == 1, "DMP vector, types, address"
        data = d[126:]
        assert be(d[123:125]) == len(data) + 1 and d[125] == 0 and len(data) <= 512, "property count and start code"
        return {"kind": "data", "cid": cid, "name": name, "priority": d[108], "sync": be(d[109:111]), "seq": d[111], "options": d[112],
                "universe": be(d[113:115]), "data": data}
    if vec == 8:
        assert be(d[40:44]) == 2 and d[108:112] == b"\x00" * 4, "discovery framing"
        assert d[112] >> 4 == 7 and be(d[112:114]) & 0xFFF == len(d) - 112 and be(d[114:118]) == 1, "discovery layer"
        unis = [be(d[i:i + 2]) for i in range(120, len(d), 2)]
        return {"kind": "discovery", "cid": cid, "name": name, "page": d[118], "last": d[119], "universes": unis}
    raise AssertionError("root vector %d" % vec)

class Rx:
    """Listens on UDP 5568 at one address: 127.0.0.1 for unicast, or a multicast group it joins."""
    def __init__(self, addr="127.0.0.1"):
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.s.bind((addr, 5568)); self.s.settimeout(0.2)
        if addr.startswith("239."):
            self.s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(addr) + socket.inet_aton("0.0.0.0"))
        self.log, self.bad, self.lock, self.alive = [], [], threading.Lock(), True
        self.t = threading.Thread(target=self.loop, daemon=True); self.t.start()
    def loop(self):
        while self.alive:
            try: d, a = self.s.recvfrom(2048)
            except OSError: continue
            try: p = parse(d); p["t"], p["raw"] = time.time(), d
            except AssertionError as e: self.bad.append(str(e)); continue
            with self.lock: self.log.append(p)
    def since(self, t0, kind="data", **kw):
        with self.lock: return [p for p in self.log if p["t"] >= t0 and p["kind"] == kind and all(p.get(k) == v for k, v in kw.items())]
    def close(self): self.alive = False; self.t.join(1); self.s.close()

def project(ctrls=None):
    red, blue = [1, 0, 0], [0, 0, 1]
    line = lambda fid, y, n: {"id": fid, "type": "line", "name": fid, "order": "RGB", "x1": 20, "y1": y, "x2": 380, "y2": y, "pixels": n}
    return {"name": "S", "settings": {"compW": 400, "compH": 200, "transition": 0, "fps": 30},
            "fixtures": [line("a", 50, 10), line("b", 150, 10)],
            "controllers": ctrls or [{"id": "c1", "name": "C", "ip": "127.0.0.1", "enabled": True, "outputs": 2, "upo": 1, "startUniverse": 0, "split": False, "chains": [["a"], ["b"]]}],
            "zones": [{"id": "z1", "name": "Zone 1", "x": 0, "y": 0, "w": 400, "h": 100, "opacity": 1, "layers": [{"id": "l1", "src": "b-solid", "params": {"b-solid": {"color": red + [1]}}, "opacity": 1, "blend": "alpha", "on": True}], "scenes": [], "scene": None},
                      {"id": "z2", "name": "Zone 2", "x": 0, "y": 100, "w": 400, "h": 100, "opacity": 1, "layers": [{"id": "l2", "src": "b-solid", "params": {"b-solid": {"color": blue + [1]}}, "opacity": 1, "blend": "alpha", "on": True}], "scenes": [], "scene": None}]}

# ---------- a packet byte for byte, against one built here from the standard
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import noupix
cid = uuid.uuid5(uuid.NAMESPACE_DNS, "noupix." + socket.gethostname()).bytes
src = ("nouPix " + socket.gethostname()).encode()[:63].ljust(64, b"\x00")
data = bytes([255, 0, 0] * 10) + bytes(482)
want = (bytes([0, 0x10, 0, 0]) + b"ASC-E1.17" + bytes(3) + bytes([0x72, 0x6E, 0, 0, 0, 4]) + cid
        + bytes([0x72, 0x58, 0, 0, 0, 2]) + src + bytes([100, 0, 0, 9, 0, 0, 1])
        + bytes([0x72, 0x0B, 2, 0xA1, 0, 0, 0, 1, 0x02, 0x01, 0]) + data)
check("an sACN packet is exactly as E1.31 lays it out (638 bytes for 512 channels)", noupix.sacn_packet(1, data, 9, 100) == want and len(want) == 638)
check("the discovery packet too", parse(noupix.sacn_discovery([1, 2, 300]))["universes"] == [1, 2, 300] and len(noupix.sacn_discovery([1, 2, 300])) == 126)
check("multicast groups: 239.255 and the universe's two bytes", noupix.sacn_group(1) == "239.255.0.1" and noupix.sacn_group(300) == "239.255.1.44")

# multicast on this machine? (a container may have no route for it)
probe = Rx("239.255.0.9")
t = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); t.sendto(noupix.sacn_packet(9, b"\x00", 0), ("239.255.0.9", 5568)); t.close()
mcast_ok = bool(wait(lambda: probe.since(0), 1.5)); probe.close()

node = FakeNode()
uni_rx = Rx("127.0.0.1")
groups = {g: Rx(g) for g in ("239.255.0.1", "239.255.0.2", "239.255.250.214")} if mcast_ok else {}
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
    E("p => olm.loadProject(p)", project()); time.sleep(1)
    wait(lambda: E("olm.ui.outputOn"))

    # ---------- Art-Net, as before
    check("a project starts on Art-Net", E("olm.project.settings.protocol") == "artnet" and E("blankProject().settings.protocol") == "artnet")
    t0 = time.time(); time.sleep(0.6)
    check("Art-Net goes out (universes 0 and 1), no sACN", node.count(t0, time.time()) > 5 and node.last(0)[:3] == bytes([255, 0, 0]) and node.last(1)[:3] == bytes([0, 0, 255]) and not uni_rx.since(t0), (node.count(t0, time.time()), len(uni_rx.since(t0))))
    art0, art1 = node.last(0), node.last(1)

    # ---------- switched to sACN in Settings
    E("showRight(true); ui.rightTab = 'settings'; renderRight()")
    seg = lambda label: pg.locator("#rightBody .seg button", has_text=label)
    check("Settings → Output offers Art-Net and sACN, Art-Net on", seg("Art-Net").count() == 1 and "on" in (seg("Art-Net").get_attribute("class") or "") and pg.get_by_text("Send ArtSync after each frame").count() == 1)
    t0 = time.time(); seg("sACN").click(); time.sleep(1.0)
    check("choosing sACN sets the project's protocol, and the sACN rows show (no ArtSync)", E("olm.project.settings.protocol") == "sacn" and pg.locator("#rightBody input[aria-label='Priority']").count() == 1 and pg.get_by_text("Send ArtSync after each frame").count() == 0)
    t1 = time.time(); time.sleep(0.6)
    p1, p2 = uni_rx.since(t1, universe=1), uni_rx.since(t1, universe=2)
    check("sACN goes out instead: universe 0 as sACN universe 1, 1 as 2, to the controller's address", len(p1) > 5 and len(p2) > 5 and node.count(t1, time.time()) == 0, (len(p1), len(p2), node.count(t1, time.time())))
    check("with the same channels Art-Net had", p1 and p1[-1]["data"] == art0 and p2[-1]["data"] == art1)
    check("from nouPix, its CID kept, priority 100, no sync, no options", all(p["name"].startswith("nouPix") and p["cid"] == cid and p["priority"] == 100 and p["sync"] == 0 and p["options"] == 0 for p in p1 + p2))
    seqs = [p["seq"] for p in uni_rx.since(t0, universe=1)]
    check("each universe counts its own sequence, one by one", len(seqs) > 5 and all((b - a) % 256 == 1 for a, b in zip(seqs, seqs[1:])), seqs[:12])
    check("nothing on the wire breaks the standard", not uni_rx.bad, uni_rx.bad[:3])
    check("the status bar says sACN", "Sending" in pg.text_content("#bridgePill") and "sACN" in (pg.get_attribute("#bridgePill", "title") or ""))

    # ---------- the universes shown as sACN counts them
    E("ui.dockTab = 'patch'; ui.dockCollapsed = false; renderDock()"); time.sleep(0.3)
    ur = pg.eval_on_selector_all(".outs .ur", "els => els.map(e => e.textContent)")
    first = pg.locator("input[aria-label='First universe']")
    check("the Patch panel shows the outputs' universes as sACN's: U 1 and U 2", ur == ["U 1", "U 2"], ur)
    check("First uni shows 1", first.input_value() == "1")
    check("fixtures show their addresses as sACN's", E("addrText(olm.project.fixtures[0]._patch)") == "U 1 · ch 1  →  U 1 · ch 30" and E("pixelAddrText(olm.project.fixtures[1], 0)") == "U 2 ch 1–3")
    first.fill("5"); first.press("Enter"); time.sleep(0.8)
    t1 = time.time(); time.sleep(0.5)
    check("First uni typed as 5 is sACN universe 5 (4 inside, as Art-Net counts)", E("olm.project.controllers[0].startUniverse") == 4 and uni_rx.since(t1, universe=5) and uni_rx.since(t1, universe=6) and not uni_rx.since(t1, universe=1), E("olm.project.controllers[0].startUniverse"))
    first.fill("0"); first.press("Enter"); time.sleep(0.5)
    check("and 0 isn't an sACN universe: it becomes 1", E("olm.project.controllers[0].startUniverse") == 0 and first.input_value() == "1", first.input_value())
    E("ui.dockTab = 'monitor'; ui.monitorKey = null; renderDock()"); time.sleep(0.3)
    mon = pg.locator(".bar .mono").first.text_content()
    check("the DMX monitor names the sACN universe", "sACN universe 1" in mon and "127.0.0.1" in mon, mon)
    menu = E("patchToItems(olm.project.fixtures.slice(0, 1)).filter(i => Array.isArray(i)).map(i => i[0])")
    check("the Patch to menu uses the same numbers", [m.split("·")[-1].strip() for m in menu] == ["U 1", "U 2"], menu)
    csv = E("(() => { let out = null; const d = download; download = (n, t) => { out = t; }; exportCSV(); download = d; return out; })()")
    check("the CSV says sACN universe, counted from 1", csv.splitlines()[0].count("sACN universe") == 2 and csv.splitlines()[1].split(",")[9] == "1", csv.splitlines()[:2])

    # ---------- priority
    E("ui.rightTab = 'settings'; renderRight()")
    pr = pg.locator("#rightBody input[aria-label='Priority']")
    pr.fill("150"); pr.press("Enter"); time.sleep(0.5)
    t1 = time.time(); time.sleep(0.5)
    check("the priority set goes out", E("olm.project.settings.sacnPriority") == 150 and all(p["priority"] == 150 for p in uni_rx.since(t1)) and uni_rx.since(t1))
    pr.fill("500"); pr.press("Enter"); time.sleep(0.3)
    check("kept between 0 and 200", E("olm.project.settings.sacnPriority") == 200)
    pr.fill("100"); pr.press("Enter"); time.sleep(0.3)

    # ---------- multicast
    E("ui.dockTab = 'patch'; renderDock()")
    added = """(() => { const p = olm.project, f = newFixture('line', { x1: 20, y1: 60, x2: 380, y2: 60, pixels: 4 }); f.id = 'cx'; p.fixtures.push(f);
      p.controllers.push({ id: 'c2', name: 'D', ip: '127.0.0.2', enabled: true, outputs: 1, upo: 1, startUniverse: 0, split: false, chains: [['cx']] });
      markGeom(); markPatch(); ensurePatch(); return patchConflicts.length; })()"""
    check("two controllers with the same universes: no conflict sending to each", E(added) == 0, E("patchConflicts"))
    t0 = time.time()
    seg("Multicast").click(); time.sleep(0.8)
    check("with multicast they clash: a universe is one for the whole network", any("sACN universe 1" in c for c in E("patchConflicts")), E("patchConflicts"))
    E("(() => { const p = olm.project; p.controllers.pop(); p.fixtures = p.fixtures.filter(f => f.id !== 'cx'); markGeom(); markPatch(); commit(); })()"); time.sleep(0.5)
    ended = [p for p in uni_rx.since(t0) if p["options"] & 0x40]
    check("the streams to the controller's address end: three Stream_Terminated packets each", sorted(p["universe"] for p in ended) == [1, 1, 1, 2, 2, 2], [(p["universe"], p["options"]) for p in ended])
    if mcast_ok:
        t1 = time.time(); time.sleep(0.6)
        g1, g2 = groups["239.255.0.1"].since(t1, universe=1), groups["239.255.0.2"].since(t1, universe=2)
        check("each universe goes to its multicast group", len(g1) > 5 and len(g2) > 5 and g1[-1]["data"] == art0 and not uni_rx.since(t1 + 0.2), (len(g1), len(g2)))
        disc = wait(lambda: groups["239.255.250.214"].since(t0, kind="discovery"), 11)
        check("and the universes sent are listed on the discovery group", disc and disc[-1]["universes"] == [1, 2] and disc[-1]["page"] == 0 and disc[-1]["last"] == 0, [d["universes"] for d in disc])
        mon = (E("ui.dockTab = 'monitor'; renderDock()"), pg.locator(".bar .mono").first.text_content())[1]
        check("the DMX monitor names the group", "multicast 239.255.0.1" in mon, mon)
    else:
        print("PASS multicast doesn't reach this machine's receivers: the groups aren't checked here")
    E("ui.rightTab = 'settings'; renderRight()")
    t0 = time.time(); seg("Unicast").click(); time.sleep(0.8)
    if mcast_ok:
        ended = [p for p in groups["239.255.0.1"].since(t0) if p["options"] & 0x40]
        check("back to each controller: the multicast streams end", len(ended) == 3, len(ended))
    check("and it goes to the address again", uni_rx.since(time.time() - 0.3, universe=1))

    # ---------- undo, files, repair
    E("undo()"); time.sleep(0.5)
    check("undo takes back a protocol setting", E("olm.project.settings.sacnMulticast") is True)
    E("redo()"); time.sleep(0.3)
    saved = E("JSON.parse(serialize())")["settings"]
    check("saved with the project", saved["protocol"] == "sacn" and saved["sacnPriority"] == 100 and saved["sacnMulticast"] is False, saved)
    r = E("(() => { const s = hydrate({ settings: { protocol: 'dmx', sacnPriority: 999, sacnMulticast: 'yes' } }).settings; const t = hydrate({}).settings; return [s.protocol, s.sacnPriority, s.sacnMulticast, t.protocol, t.sacnPriority, t.sacnMulticast]; })()")
    check("files: an unknown protocol is Art-Net, the priority kept in range, multicast only when true; old files are Art-Net", r == ["artnet", 200, False, "artnet", 100, False], r)

    # ---------- back to Art-Net
    t0 = time.time(); seg("Art-Net").click(); time.sleep(0.8)
    ended = [p for p in uni_rx.since(t0) if p["options"] & 0x40]
    check("back to Art-Net: the sACN streams end at once (three Stream_Terminated packets each)", sorted(p["universe"] for p in ended) == [1, 1, 1, 2, 2, 2], [(p["universe"], p["options"]) for p in ended])
    t1 = time.time(); time.sleep(0.5)
    check("and Art-Net goes out again, universes as before", node.count(t1, time.time()) > 5 and node.last(0) == art0 and not uni_rx.since(t1 + 0.1), node.count(t1, time.time()))
    E("ui.dockTab = 'patch'; renderDock()"); time.sleep(0.2)
    check("the Patch panel counts from 0 again", pg.eval_on_selector_all(".outs .ur", "els => els.map(e => e.textContent)") == ["U 0", "U 1"])

    # ---------- output off, and the window closing
    seg("sACN").click(); time.sleep(0.6)
    t0 = time.time(); E("olm.setOutput(false)"); time.sleep(0.5)
    ended = [p for p in uni_rx.since(t0) if p["options"] & 0x40]
    check("output switched off: the streams end", sorted(p["universe"] for p in ended) == [1, 1, 1, 2, 2, 2] and "sACN off" in pg.text_content("#bridgePill"), [(p["universe"], p["options"]) for p in ended])
    E("olm.setOutput(true)"); time.sleep(0.6)
    check("on again: sACN again", uni_rx.since(time.time() - 0.3, universe=1))
    check("no errors", not errs, errs[:3])
    t0 = time.time(); pg.close(); time.sleep(1.0)
    ended = [p for p in uni_rx.since(t0) if p["options"] & 0x40]
    check("the window closed: the streams end", sorted(p["universe"] for p in ended) == [1, 1, 1, 2, 2, 2], [(p["universe"], p["options"]) for p in ended])
    br.close()
finally:
    bridge.terminate()
    for r in [uni_rx, *groups.values()]: r.close()
    node.close()
print("FAILED:", fails or "none")
