# WLED found without ArtPoll: a WLED set to E1.31 listens on 5568 only and never hears ArtPoll, so Discover also asks
# mDNS for _wled._tcp and reads each WLED's JSON API. A stand-in WLED answers here: an mDNS responder (legacy unicast,
# NOUPIX_MDNS points the bridge at it) and an HTTP server with /json/info and /json/cfg. Checked: the DNS reading
# (compression, SRV, A), the node made of WLED's settings (sACN one lower, Art-Net as is, DDP, RGBW, the dimmer mode,
# receiving off), the Discovery window (sACN, its LEDs and universe), Add as controller filled in by pixels, Refresh,
# DDP refused, the filter, and a Discover with no WLED.
import os, sys, time, json, socket, struct, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
import noupix
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8242
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

# ---------- the stand-in WLED
WLED = {"info": {"ver": "0.15.0", "name": "Kitchen", "mac": "a1b2c3d4e5f6", "leds": {"count": 300}},
        "cfg": {"if": {"live": {"en": True, "port": 5568, "mc": False, "dmx": {"uni": 1, "addr": 1, "mode": 4}}}}}
asked = {"mdns": 0, "http": []}
class Api(BaseHTTPRequestHandler):
    def do_GET(self):
        asked["http"].append(self.path)
        body = json.dumps(WLED["info"] if self.path == "/json/info" else WLED["cfg"] if self.path == "/json/cfg" else {}).encode()
        self.send_response(200 if self.path in ("/json/info", "/json/cfg") else 404)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
api = ThreadingHTTPServer(("127.0.0.1", 0), Api)
threading.Thread(target=api.serve_forever, daemon=True).start()
HTTP_PORT = api.server_address[1]

def name(n, ptrs=None):
    return b"".join(bytes([len(p)]) + p.encode() for p in n.split(".")) + b"\x00"
def answer(qid, question, on=True):
    # PTR _wled._tcp.local -> Kitchen._wled._tcp.local; SRV -> wled-kitchen.local:HTTP_PORT; A -> 127.0.0.1.
    # The SRV's and A's names point back into the packet (compression), as real responders do.
    hdr = struct.pack(">HHHHHH", qid, 0x8400, 1, 1, 0, 2)
    q = question
    svc_at = 12   # the question's name: _wled._tcp.local
    inst = b"\x07Kitchen" + struct.pack(">H", 0xC000 | svc_at)
    ptr = struct.pack(">H", 0xC000 | svc_at) + struct.pack(">HHIH", 12, 1, 120, len(inst)) + inst
    inst_at = 12 + len(q) + 2 + 10
    host = b"\x0cwled-kitchen\x05local\x00"
    srv_rd = struct.pack(">HHH", 0, 0, HTTP_PORT) + host
    srv = struct.pack(">H", 0xC000 | inst_at) + struct.pack(">HHIH", 33, 0x8001, 120, len(srv_rd)) + srv_rd
    host_at = 12 + len(q) + len(ptr) + 2 + 10 + 6
    a = struct.pack(">H", 0xC000 | host_at) + struct.pack(">HHIH", 1, 0x8001, 120, 4) + socket.inet_aton("127.0.0.1")
    return hdr + q + ptr + srv + a
mdns = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); mdns.bind(("127.0.0.1", 0))
MDNS_PORT = mdns.getsockname()[1]
present = {"on": True}
def responder():
    while True:
        try: d, addr = mdns.recvfrom(2048)
        except OSError: return
        asked["mdns"] += 1
        if not present["on"] or len(d) < 12: continue
        qid = struct.unpack(">H", d[:2])[0]
        mdns.sendto(answer(qid, d[12:]), addr)   # legacy unicast: straight back to the asking port
threading.Thread(target=responder, daemon=True).start()

# ---------- the bridge's reading of DNS and of WLED's settings
q = noupix.mdns_query("_wled._tcp.local")
rec = noupix.parse_mdns(answer(7, q[12:]))
check("an mDNS answer is read: PTR, SRV (through compressed names) and A",
      rec["ptr"].get("_wled._tcp.local") == ["kitchen._wled._tcp.local"] and rec["srv"].get("kitchen._wled._tcp.local") == ("wled-kitchen.local", HTTP_PORT)
      and rec["a"].get("wled-kitchen.local") == "127.0.0.1", rec)
check("junk is no answer, and doesn't throw", noupix.parse_mdns(b"\x00" * 5) == {"ptr": {}, "srv": {}, "a": {}} and isinstance(noupix.parse_mdns(b"\x00\x00\x84\x00\x00\x00\x00\x05" + b"\xc0" * 30), dict))
n = noupix.wled_node("10.0.0.9", WLED["info"], WLED["cfg"])
check("a WLED on E1.31 universe 1: sACN, nouPix's universe 0, 300 RGB LEDs on 2 universes", n["sacn"] and n["outUniverses"] == [0, 1] and n["wled"]["leds"] == 300 and n["wled"]["chPx"] == 3 and n["wled"]["universe"] == 0 and n["bindIndex"] == -1, n)
check("its name, version, MAC and what it says", n["shortName"] == "Kitchen" and n["longName"] == "WLED 0.15.0" and n["mac"] == "a1:b2:c3:d4:e5:f6" and "300 LEDs, RGB, sACN universe 1 from channel 1" in n["report"], n["report"])
cfg = lambda **k: {"if": {"live": dict({"en": True, "port": 5568, "dmx": {"uni": 1, "addr": 1, "mode": 4}}, **k)}}
n = noupix.wled_node("x", {"leds": {"count": 200}}, cfg(port=6454, dmx={"uni": 3, "addr": 1, "mode": 6}))
check("on Art-Net universe 3, RGBW: Art-Net, universes 3 and 4 (128 LEDs each)", not n["sacn"] and n["outUniverses"] == [3, 4] and n["wled"]["chPx"] == 4, n["outUniverses"])
n = noupix.wled_node("x", {"leds": {"count": 170}}, cfg(dmx={"uni": 1, "addr": 10, "mode": 4}))
check("from channel 10, 170 LEDs no longer fit one universe", n["outUniverses"] == [0, 1] and n["wled"]["address"] == 10, n["outUniverses"])
n = noupix.wled_node("x", {"leds": {"count": 10}}, cfg(dmx={"uni": 1, "addr": 1, "mode": 5}))
check("Dimmer + Multi RGB: the LEDs start a channel later, and it says why", n["wled"]["address"] == 2 and "dimmer" in n["report"], n["report"])
n = noupix.wled_node("x", {"leds": {"count": 10}}, cfg(port=4048, dmx={"uni": 1, "addr": 1, "mode": 1}))
check("DDP: no universes, its DMX mode doesn't matter, and it says DDP", n["wled"]["proto"] == "ddp" and n["outUniverses"] == [] and "DDP" in n["report"]
      and "Multi RGB" not in n["report"] and n["wled"]["pixels"] and n["wled"]["chPx"] == 3, n["report"])
n = noupix.wled_node("x", {"leds": {"count": 10, "rgbw": True}}, cfg(port=4048))
check("DDP with RGBW LEDs: 4 channels each", n["wled"]["chPx"] == 4)
n = noupix.wled_node("x", {"leds": {"count": 10}}, cfg(en=False, dmx={"uni": 1, "addr": 1, "mode": 1}))
check("receiving off, or one colour for all: it says so", "Receiving is off" in n["report"] and "Multi RGB" in n["report"] and not n["wled"]["pixels"], n["report"])

# ---------- through the bridge and the page
os.environ["NOUPIX_MDNS"] = "127.0.0.1:%d" % MDNS_PORT
bridge = start_bridge(PORT)
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 950})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    ev("(() => { olm.project.controllers = []; olm.ui.dockTab = 'patch'; olm.ui.scanOff = []; olm.ui.discFilter = 'both'; renderDock(); })()")
    pg.click("text=Discovery…")
    ok = True
    try: pg.wait_for_function("[...olm.bridge.nodes.values()].some(n => n.wled)", timeout=8000)
    except Exception: ok = False
    check("Discover asks mDNS and reads the WLED's JSON API, though ArtPoll can't reach it", ok and asked["mdns"] >= 1 and "/json/info" in asked["http"] and "/json/cfg" in asked["http"], asked)
    time.sleep(0.3)
    row = pg.locator(".modal[aria-label='Discovery'] tbody tr", has_text="Kitchen")
    check("the Discovery window lists it: sACN, its name, WLED's version, its LEDs and universe", row.count() == 1 and row.locator(".badge").inner_text() == "sACN" and "WLED 0.15.0" in row.inner_text() and "300 LEDs" in row.inner_text(), row.inner_text() if row.count() else "")
    pg.locator(".modal[aria-label='Discovery'] .seg button", has_text="Art-Net").click(); time.sleep(0.2)
    check("the Art-Net filter leaves it out", pg.locator(".modal[aria-label='Discovery'] tbody tr", has_text="Kitchen").count() == 0)
    pg.locator(".modal[aria-label='Discovery'] .seg button", has_text="sACN").click(); time.sleep(0.2)
    row.locator("button", has_text="Add as controller").click(); time.sleep(0.3)
    c = ev("(() => { const c = olm.project.controllers[0]; return c && { name: c.name, ip: c.ip, protocol: c.protocol, mode: c.mode, pxOut: c.pxOut, chPx: c.chPx, startUniverse: c.startUniverse, startCh: c.startCh, outputs: c.outputs, split: c.split }; })()")
    check("Add as controller fills it in: sACN, by pixels, 300 RGB pixels from universe 1 channel 1, whole pixels per universe",
          c == {"name": "Kitchen", "ip": "127.0.0.1", "protocol": "sacn", "mode": "pixels", "pxOut": 300, "chPx": 3, "startUniverse": 0, "startCh": 1, "outputs": 1, "split": False}, c)
    check("…and it is a step of undo", ev("hist.idx") > 0)
    # WLED changed on the device: Discover again and Refresh
    WLED["cfg"] = cfg(port=6454, dmx={"uni": 5, "addr": 4, "mode": 6}); WLED["info"]["leds"]["count"] = 144
    ev("olm.bridge.nodes.clear()")
    pg.locator(".modal[aria-label='Discovery'] .seg button", has_text="All").click()
    pg.locator(".modal[aria-label='Discovery'] button", has_text="Discover").first.click()
    try: pg.wait_for_function("[...olm.bridge.nodes.values()].some(n => n.wled && n.wled.leds === 144)", timeout=8000)
    except Exception: pass
    time.sleep(0.3)
    pg.locator(".modal[aria-label='Discovery'] tbody tr", has_text="Kitchen").locator("button", has_text="Refresh").click(); time.sleep(0.3)
    c = ev("(() => { const c = olm.project.controllers[0]; return [olm.project.controllers.length, c.protocol, c.pxOut, c.chPx, c.startUniverse, c.startCh]; })()")
    check("Refresh takes the WLED's new settings: Art-Net universe 5, channel 4, 144 RGBW", c == [1, "artnet", 144, 4, 5, 4], c)
    # DDP
    WLED["cfg"] = cfg(port=4048); ev("olm.bridge.nodes.clear()")
    pg.locator(".modal[aria-label='Discovery'] button", has_text="Discover").first.click()
    try: pg.wait_for_function("[...olm.bridge.nodes.values()].some(n => n.wled && n.wled.proto === 'ddp')", timeout=8000)
    except Exception: pass
    time.sleep(0.3)
    row = pg.locator(".modal[aria-label='Discovery'] tbody tr", has_text="Kitchen")
    check("a WLED on DDP shows DDP", row.locator(".badge").inner_text() == "DDP" and not row.locator("button").is_disabled(), row.inner_text())
    row.locator("button").click(); time.sleep(0.3)
    c = ev("(() => { const c = olm.project.controllers[0]; return [olm.project.controllers.length, c.protocol, c.mode, c.pxOut, c.split, c.startUniverse]; })()")
    check("…and Refresh makes it a DDP controller of its LEDs, by pixels, none skipped", c[:3] == [1, "ddp", "pixels"] and c[4:] == [True, 0], c)
    pg.locator(".modal[aria-label='Discovery'] .seg button", has_text="DDP").click(); time.sleep(0.2)
    check("the filter shows it under DDP", pg.locator(".modal[aria-label='Discovery'] tbody tr", has_text="Kitchen").count() == 1)
    pg.locator(".modal[aria-label='Discovery'] .seg button", has_text="sACN").click(); time.sleep(0.2)
    check("…and not under sACN", pg.locator(".modal[aria-label='Discovery'] tbody tr", has_text="Kitchen").count() == 0)
    pg.locator(".modal[aria-label='Discovery'] .seg button", has_text="All").click(); time.sleep(0.2)
    # Discover pressed again during a search: searched once more when it ends (several presses: once)
    time.sleep(2); m0 = asked["mdns"]
    pg.locator(".modal[aria-label='Discovery'] button", has_text="Discover").first.click(); time.sleep(0.2)
    pg.locator(".modal[aria-label='Discovery'] button", has_text="Discover").first.click(); time.sleep(4)
    check("Discover pressed during a search asks again once it ends", asked["mdns"] == m0 + 2, (m0, asked["mdns"]))
    # no WLED on the network
    present["on"] = False; ev("olm.bridge.nodes.clear()"); n0 = len(asked["http"])
    pg.locator(".modal[aria-label='Discovery'] button", has_text="Discover").first.click(); time.sleep(2.5)
    check("with no WLED, nothing is found and nothing breaks", ev("olm.bridge.nodes.size") == 0 and len(asked["http"]) == n0 and bridge.poll() is None)
    check("no errors on the page", not errs, errs[:3])
    br.close()
finally:
    bridge.terminate()
print("FAILED: " + (", ".join(fails) if fails else "none"))
