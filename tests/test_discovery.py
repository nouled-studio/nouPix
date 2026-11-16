# Discovery keeping one row per device: a device that answers from a new address (a new IP, one from DHCP) leaves
# its old one behind no more, a device that really answers on two addresses keeps both, devices without a MAC are
# never joined, and a Discover lets go of the devices on the networks it asked that didn't answer it (others stay).
# Checked in the bridge itself, then end to end: a stand-in PixLite sends ArtPollReplies to the bridge, which tells
# the page. And the note when an Advatek device is added on Art-Net (its Assistant counts universes from 1).
import os, sys, time, socket
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import CHROME_ARGS, start_bridge, app_error
from playwright.sync_api import sync_playwright
import noupix
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8266
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + " ".join(str(detail).split())[:300] if detail != "" else ""), flush=True); ok or fails.append(name)

MAC = bytes.fromhex("e0b6f5e0a6e4")
def packet(ip, mac=MAC, unis=(0, 1, 2, 3), bind=1, short=b"PixLite MkII", long=b"PixLite MkII Vortexis"):
    d = bytearray(239); d[0:8] = b"Art-Net\x00"; d[8:10] = (0x2100).to_bytes(2, "little"); d[10:14] = socket.inet_aton(ip)
    d[26:26 + len(short)] = short; d[44:44 + len(long)] = long; d[108:126] = b"#0001 [0090] OK"
    d[18] = unis[0] >> 8; d[19] = (unis[0] >> 4) & 15; d[173] = len(unis)
    for i, u in enumerate(unis): d[174 + i] = 0x80; d[190 + i] = u & 15
    d[201:207] = mac; d[211] = bind
    return bytes(d)
def reply(ip, mac=MAC, frm=None, **kw):
    return noupix.parse_poll_reply(packet(ip, mac, **kw), (frm or ip, 6454))

# ---------- in the bridge
art = noupix.ArtNet.__new__(noupix.ArtNet)
art.nodes, told = {}, []
art.listeners = {told.append}
art.found(reply("192.168.0.50"))
art.nodes["192.168.0.50#1"]["seen"] -= 60   # it answered a minute ago, then its address changed
art.found(reply("192.168.0.100"))
check("a device answering from a new address: its old one is let go, and the windows are told",
      sorted(art.nodes) == ["192.168.0.100#1"] and {"t": "nodegone", "keys": ["192.168.0.50#1"]} in told, (sorted(art.nodes), told[-2:]))
art.found(reply("192.168.0.100", bind=2, unis=(4, 5, 6, 7)))
check("its other replies (bind indexes) on the same address stay", sorted(art.nodes) == ["192.168.0.100#1", "192.168.0.100#2"], sorted(art.nodes))
art.found(reply("10.0.0.7"))
check("a device that really answers on two addresses at once keeps both", sorted(art.nodes) == ["10.0.0.7#1", "192.168.0.100#1", "192.168.0.100#2"], sorted(art.nodes))
art.nodes = {}
art.found(reply("2.0.0.1", mac=bytes(6))); art.nodes["2.0.0.1#1"]["seen"] -= 60
art.found(reply("2.0.0.2", mac=bytes(6)))
check("devices without a MAC (all zeros) are never taken for one", sorted(art.nodes) == ["2.0.0.1#1", "2.0.0.2#1"], sorted(art.nodes))
art.nodes, told[:] = {}, []
since = time.time()
for ip in ("192.168.0.50", "192.168.0.60", "10.0.0.9"):
    art.found(reply(ip, mac=os.urandom(6)))
    art.nodes[ip + "#1"]["seen"] = since - 30   # answered an earlier Discover
art.found(reply("192.168.0.70", mac=os.urandom(6)))   # answered this one
art.found(reply("192.168.0.80", mac=os.urandom(6), frm="10.0.0.80"))   # says one address, answers from another network
art.nodes["192.168.0.80#1"]["seen"] = since - 30
art.prune([{"ip": "192.168.0.101", "mask": "255.255.255.0"}], since)
check("a Discover lets go of the devices on the network it asked that didn't answer it, and keeps the rest",
      sorted(art.nodes) == ["10.0.0.9#1", "192.168.0.70#1", "192.168.0.80#1"] and told[-1] == {"t": "nodegone", "keys": ["192.168.0.50#1", "192.168.0.60#1"]},
      (sorted(art.nodes), told[-1:]))

# ---------- end to end, and the note
bridge = start_bridge(PORT)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 900})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
        pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
        ev = pg.evaluate
        to = ("127.0.0.1", ev("olm.bridge.hello.bindPort"))
        unis = list(range(0, 12)) + list(range(15, 48))
        # a reply's ports share their net and subnet: up to 4 universes of one block of 16 each
        groups = [[u for u in unis if u // 16 == blk][i:i + 4] for blk in range(3) for i in range(0, 16, 4)]
        groups = [g for g in groups if g]
        def send(ip):
            for b, g in enumerate(groups): sock.sendto(packet(ip, unis=tuple(g), bind=b + 1), to)
        send("192.168.0.50")
        wait_rows = lambda ip: pg.wait_for_function(f"nodeDevices().some(d => d.ip === '{ip}' && d.universes.length === 45) && nodeDevices().length === 1", timeout=5000)
        try: wait_rows("192.168.0.50")
        except Exception: pass
        rows = ev("nodeDevices().map(d => d.ip + ' ' + d.universes.length)")
        check("a stand-in PixLite answering: one device in Discovery, with its 45 universes", rows == ["192.168.0.50 45"], rows)
        time.sleep(noupix.MOVED_AFTER + 0.3)
        send("192.168.0.100")
        try: wait_rows("192.168.0.100")
        except Exception: pass
        rows = ev("nodeDevices().map(d => d.ip + ' ' + d.universes.length)")
        check("it answers from a new address: still one device, at the new address", rows == ["192.168.0.100 45"], rows)
        ev("openDiscovery()"); time.sleep(0.3)
        check("and the Discovery window lists it once", pg.locator(".modal .nodes tbody tr").count() == 1 if pg.locator(".modal .nodes tbody tr").count() else pg.locator(".modal .nodes").inner_text().count("192.168.0.") == 1,
              pg.locator(".modal .nodes").inner_text()[:200])
        pg.keyboard.press("Escape"); ev("document.querySelectorAll('.modal-bg').forEach(b => b.remove())")

        # adding it on Art-Net: the note on Advatek's numbers
        ev("addNodeAsController(nodeDevices()[0])"); time.sleep(0.3)
        note = pg.locator(".modal.note")
        text = note.inner_text() if note.count() else ""
        check("adding an Advatek device on Art-Net explains that its Assistant counts universes from 1",
              note.count() == 1 and "Advatek counts universes from 1" in text and "subtract 1" in text and "0–11, 15–47" in text and "1–12, 16–48" in text, text)
        pg.keyboard.press("Enter"); time.sleep(0.2)
        check("OK or Enter closes it, the controller added on Art-Net from universe 0",
              pg.locator(".modal.note").count() == 0 and ev("(() => { const c = olm.project.controllers.at(-1); return c.protocol + ' ' + c.ip + ' ' + c.startUniverse; })()") == "artnet 192.168.0.100 0")
        ev("addNodeAsController(nodeDevices()[0])"); time.sleep(0.3)
        check("adding it again (Refresh) says nothing more", pg.locator(".modal.note").count() == 0 and ev("olm.project.controllers.filter(c => c.ip === '192.168.0.100').length") == 1,
              (pg.locator(".modal.note").count(), ev("olm.project.controllers.map(c => c.ip)")))
        ev("olm.project.controllers = []; addNodeAsController(nodeDevices()[0], 'sacn')"); time.sleep(0.3)
        check("on sACN (both count from 1) there is no note", pg.locator(".modal.note").count() == 0 and ev("olm.project.controllers[0].protocol") == "sacn")
        ev("addNodeAsController({ ip: '10.0.0.5', shortName: 'Node', longName: 'Some node', universes: [0, 1] })"); time.sleep(0.3)
        check("nor for another maker's device", pg.locator(".modal.note").count() == 0 and ev("olm.project.controllers.length") == 2)
        check("no page errors", not errs, errs[:3])
        br.close()
finally:
    sock.close(); bridge.terminate()
print("FAILED:", fails or "none")
