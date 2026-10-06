# Bridge robustness: malformed JSON messages and malformed frames must not drop the connection or send bad packets
import socket, struct, base64, os, json, time, sys, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import FakeNode, start_bridge
node = FakeNode("127.0.0.1")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8096
p = start_bridge(PORT)
class WS:
    def __init__(s, port):
        s.s = socket.create_connection(("127.0.0.1", port))
        s.s.sendall(("GET /ws HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (port, base64.b64encode(os.urandom(16)).decode())).encode())
        s.msgs = []; s.closed = False
        hdr = b""
        while b"\r\n\r\n" not in hdr: hdr += s.s.recv(1)
        threading.Thread(target=s.reader, daemon=True).start()
    def reader(s):
        f = s.s.makefile("rb")
        while True:
            try:
                h2 = f.read(2)
                if len(h2) < 2: s.closed = True; return
                b0, b1 = h2; n = b1 & 0x7f
                if n == 126: n = struct.unpack(">H", f.read(2))[0]
                elif n == 127: n = struct.unpack(">Q", f.read(8))[0]
                d = f.read(n)
                if b0 & 0x0f == 1: s.msgs.append(json.loads(d))
            except Exception: s.closed = True; return
    def send(s, payload, op=2):
        if isinstance(payload, str): payload, op = payload.encode("utf-8", "surrogatepass"), 1
        mask = os.urandom(4); n = len(payload)
        hdr = bytes((0x80 | op,)) + (bytes((0x80 | n,)) if n < 126 else bytes((0x80 | 126,)) + struct.pack(">H", n))
        s.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
ok = True
def check(name, cond):
    global ok
    ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name)
try:
    a = WS(PORT); time.sleep(0.3)
    for bad in ['[]', '"x"', '5', 'null', '{"t": 7}', '{"t":"poll","broadcast":["x"]}', 'not json', '[{"t":"output","on":true}]']:
        a.send(bad)
    a.send(b"\xff\xfe\xfd", op=1)  # invalid UTF-8 in a text frame
    time.sleep(0.4)
    check("connection survives malformed JSON messages", not a.closed)
    a.send('{"t":"output","on":true}'); time.sleep(0.2)
    # a frame claiming 600 channels for universe 3, followed by a normal universe 4
    fr = struct.pack("<BBH", 1, 0, 2) + socket.inet_aton("127.0.0.1") + struct.pack("<HH", 3, 600) + bytes([9]) * 600 \
         + socket.inet_aton("127.0.0.1") + struct.pack("<HH", 4, 512) + bytes([7]) * 512
    t0 = time.time(); a.send(fr); time.sleep(0.5)
    d3, d4 = node.last(3), node.last(4)
    check("oversized universe is clamped to 512 channels", d3 is not None and len(d3) == 512 and set(d3) == {9})
    check("the universe after it is parsed correctly", d4 is not None and len(d4) == 512 and set(d4) == {7})
    # truncated frame: header says 3 universes, only 1 present
    fr2 = struct.pack("<BBH", 1, 0, 3) + socket.inet_aton("127.0.0.1") + struct.pack("<HH", 5, 512) + bytes([5]) * 512
    a.send(fr2); time.sleep(0.4)
    check("truncated frame sends what it has", node.last(5) is not None and set(node.last(5)) == {5})
    check("connection still open", not a.closed)
finally:
    p.terminate(); out = p.communicate()[0]
    check("no tracebacks in the bridge log", "Traceback" not in out and "Exception" not in out)
    node.close()
# Discovery: ArtPoll goes to the broadcast address of each network the page ticks, plus one typed address
from harness import ROOT
sys.path.insert(0, ROOT)
import openledmapper as olm
class FakeArt:
    discovery = True
    def __init__(s): s.sent = []
    def poll(s, address): s.sent.append(address)
class FakeWS:
    def __init__(s): s.out = []
    def send_json(s, o): s.out.append(o)
def poll(msg):
    art, ws = FakeArt(), FakeWS()
    olm.Handler.handle_message(art, ws, json.dumps(msg).encode())
    return art.sent, ws.out
nets = olm.network_interfaces()
check("networks have an address, mask and broadcast address", all({"ip", "mask", "prefix", "broadcast"} <= set(n) and not n["ip"].startswith("127.") for n in nets))
if nets:
    sent, out = poll({"t": "poll", "ifaces": [nets[0]["ip"]], "broadcast": ""})
    check("a ticked network gets ArtPoll on its broadcast address", sent == [nets[0]["broadcast"]] and out and out[0]["t"] == "polled" and out[0]["nets"] == nets)
check("no network ticked: nothing sent", poll({"t": "poll", "ifaces": [], "broadcast": ""})[0] == [])
check("a typed address is used too", poll({"t": "poll", "ifaces": [], "broadcast": " 2.255.255.255 "})[0] == ["2.255.255.255"])
check("a typed address must be an IPv4 address", poll({"t": "poll", "ifaces": [], "broadcast": "example.com"})[0] == [])
check("a page from before network choice: 255.255.255.255", poll({"t": "poll", "broadcast": ""})[0] == ["255.255.255.255"])
print("ALL PASS" if ok else "SOME FAILED")
