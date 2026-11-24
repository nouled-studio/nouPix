#!/usr/bin/env python3
# What a controller says about itself, byte by byte: sends ArtPoll and prints every ArtPollReply, with the fields
# nouPix reads to tell Art-Net from sACN (GoodOutputA bit 0 per port, Status2 bit 4) and nouPix's verdict. With
# --watch it polls every 2 s and prints a line each time a device's answer changes: switch the protocol on the
# device meanwhile and see which bytes follow. Standard library only; quit nouPix first (both want port 6454).
#
#   python3 tests/poll_dump.py                      broadcast, then print what answered
#   python3 tests/poll_dump.py --net 10             only the network card(s) whose address starts 10.
#   python3 tests/poll_dump.py --ip 192.168.1.50    ask that device directly (also works across subnets)
#   python3 tests/poll_dump.py --ip 192.168.1.50 --watch
#   python3 tests/poll_dump.py --raw                the whole reply in hex as well
#   python3 tests/poll_dump.py --net 10 --brief     one line per reply, every 2 s: a timeline while you switch
import argparse, os, socket, struct, sys, time

PORT = 6454
POLL = b"Art-Net\x00" + struct.pack("<H", 0x2000) + bytes([0, 14, 0x02, 0])   # ProtVer 14, reply on change

GOOD_OUT_A = ["sACN bit", "merge LTP", "short", "merging", "text", "SIPs", "test packets", "sending"]
GOOD_OUT_B = ["", "", "", "", "background discovery off", "discovery not running", "continuous output", "RDM off"]
GOOD_IN = ["", "", "receive errors", "input disabled", "text", "SIPs", "test packets", "data received"]
STATUS2 = ["web config", "DHCP on", "DHCP capable", "15-bit addresses", "can switch Art-Net/sACN", "squawking",
           "output style switchable", "RDM switchable"]
STATUS3 = ["background discovery programmable", "background queue", "RDMnet", "port direction switchable", "LLRP",
           "failover", "failsafe bit 6", "failsafe bit 7"]


def bits(v, names):
    on = [names[i] or "bit %d" % i for i in range(8) if v & (1 << i)]
    return "0x%02x %s" % (v, "(" + ", ".join(on) + ")" if on else "")


def text(b):
    return b.split(b"\x00")[0].decode("latin-1", "replace").strip()


def describe(d, addr, raw=False):
    if len(d) < 197 or d[:8] != b"Art-Net\x00" or struct.unpack("<H", d[8:10])[0] != 0x2100:
        return None, "%s: not an ArtPollReply (%d bytes)" % (addr[0], len(d))
    at = lambda i: d[i] if len(d) > i else 0
    nports = min(d[173], 4)
    types, gin, goa, swout = d[174:178], d[178:182], d[182:186], d[190:194]
    gob = d[213:217] if len(d) >= 217 else b"\x00" * 4
    outs = [i for i in range(nports) if types[i] & 0x80]
    # nouPix's own reading (noupix.py, reply_sacn; here as it was before 1.6.4 when noupix.py can't be found)
    nx = noupix_module()
    sacn = nx.reply_sacn(d) if nx and hasattr(nx, "reply_sacn") else (all(goa[i] & 1 for i in outs) if outs else any(goa[i] & 1 for i in range(nports)))
    quirk = nx and getattr(nx, "NO_PORTS_ON_SACN", {}).get(struct.unpack(">H", d[20:22])[0])
    L = []
    L.append("=" * 78)
    L.append("%s  %r  (%s)" % (addr[0], text(d[26:44]), text(d[44:108])))
    L.append("  report      %r" % text(d[108:172]))
    L.append("  IP in reply %s   bind IP %s   bind index %d   MAC %s" % (
        socket.inet_ntoa(d[10:14]), socket.inet_ntoa(d[207:211]) if len(d) >= 211 else "-", at(211),
        ":".join("%02x" % b for b in d[201:207]) if len(d) >= 207 else "-"))
    L.append("  firmware %d.%d   OEM 0x%04x   ESTA 0x%04x   style %d   %d bytes" % (
        d[16], d[17], struct.unpack(">H", d[20:22])[0], struct.unpack("<H", d[24:26])[0], at(200), len(d)))
    L.append("  net %d  sub %d  ports %d (outputs: %s)" % (d[18] & 0x7F, d[19] & 0x0F, nports, ", ".join(str(i + 1) for i in outs) or "none")
             + (("   (no ports: a %s on sACN answers like this)" % quirk if quirk else "   (no ports: a device on sACN, or restarting after a change, may answer like this)") if not nports else ""))
    for i in range(nports):
        L.append("  port %d: type %s  universe %d" % (i + 1, "0x%02x" % types[i] + (" out" if types[i] & 0x80 else "") + (" in" if types[i] & 0x40 else ""),
                                                      ((d[18] & 0x7F) << 8) | ((d[19] & 0x0F) << 4) | (swout[i] & 0x0F)))
        # the sACN bit as this device means it: a DiGidot sets it on Art-Net too, and tells by its ports
        L.append("          GoodOutputA %s" % bits(goa[i], ["sACN bit: unused on a %s" % quirk if quirk else GOOD_OUT_A[0]] + GOOD_OUT_A[1:]))
        L.append("          GoodOutputB %s" % bits(gob[i], GOOD_OUT_B))
        L.append("          GoodInput   %s" % bits(gin[i], GOOD_IN))
    L.append("  Status1  0x%02x" % d[23])
    L.append("  Status2  %s" % bits(at(212), STATUS2))
    L.append("  Status3  %s" % bits(at(217), STATUS3))
    L.append("  sACN priority %d" % at(194))
    L.append("  -> nouPix reads it as: %s%s" % ("sACN" if sacn else "Art-Net", "  (a %s: sACN when it lists no ports)" % quirk if quirk else ""))
    if raw:
        for o in range(0, len(d), 16):
            L.append("  %04x  %s" % (o, " ".join("%02x" % b for b in d[o:o + 16])))
    key = (addr[0], at(211))
    sig = (bytes(goa), bytes(gob), at(212), at(217), bytes(types), bytes(swout), d[18], d[19], text(d[108:172]))
    return (key, sig, sacn), "\n".join(L)


def sock():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "SO_REUSEPORT"):
        try: s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except OSError: pass
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        s.bind(("", PORT))
    except OSError as e:
        sys.exit("Can't listen on UDP %d (%s). Quit nouPix (or anything else using Art-Net) and try again." % (PORT, e))
    s.settimeout(0.2)
    return s


def poll(s, targets):
    for t in targets:
        for _ in range(2):   # twice: some firewalls drop the first packet to a new address
            try: s.sendto(POLL, (t, PORT))
            except OSError as e: print("  (couldn't send to %s: %s)" % (t, e))


def noupix_module():
    """nouPix's bridge (noupix.py, beside tests/), for its own reading of the replies and its list of networks."""
    if noupix_module.m is None:
        try:
            sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            import noupix
            noupix_module.m = noupix
        except Exception as e:
            pass   # on its own: the reading as Art-Net 4 describes it, and the networks guessed
            noupix_module.m = False
    return noupix_module.m


noupix_module.m = None


def networks():
    """This computer's networks (address, mask, broadcast), as nouPix's bridge lists them for its Discover; without
    noupix.py beside it, this computer's addresses with the usual masks (255.0.0.0 for 2.x and 10.x, else /24)."""
    nx = noupix_module()
    try:
        if nx:
            return nx.network_interfaces()
    except Exception as e:
        print("  (couldn't list the network cards: %s)" % e)
    ips = set()
    try: ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError: pass
    for probe in ("10.255.255.255", "2.255.255.255", "192.168.255.255", "8.8.8.8"):
        try:
            u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.connect((probe, 9)); ips.add(u.getsockname()[0]); u.close()
        except OSError: pass
    out = []
    for ip in sorted(i for i in ips if not i.startswith("127.") and i != "0.0.0.0"):
        mask = "255.0.0.0" if ip.split(".")[0] in ("2", "10") else "255.255.255.0"
        a, m = (struct.unpack("!I", socket.inet_aton(x))[0] for x in (ip, mask))
        out.append({"name": "", "ip": ip, "mask": mask, "prefix": bin(m).count("1"), "broadcast": socket.inet_ntoa(struct.pack("!I", (a & m) | (~m & 0xFFFFFFFF)))})
    return out


def inside(ip, net):
    a, n, m = (struct.unpack("!I", socket.inet_aton(x))[0] for x in (ip, net["ip"], net["mask"]))
    return a & m == n & m


def main():
    ap = argparse.ArgumentParser(description="Dump ArtPollReply packets and how nouPix reads them.")
    ap.add_argument("--ip", action="append", default=[], help="a device's address to ask directly (repeatable)")
    ap.add_argument("--net", help="only the network card(s) whose address starts so (10, 10.0, 2…): asked on their broadcast, other answers left out")
    ap.add_argument("--watch", action="store_true", help="poll every 2 s and print each change")
    ap.add_argument("--raw", action="store_true", help="also print every reply in hex")
    ap.add_argument("--brief", action="store_true", help="poll every 2 s and print one line per reply (time, ports, the sACN bits, nouPix's reading)")
    ap.add_argument("--wait", type=float, default=3.0, help="seconds to wait for answers (default 3)")
    a = ap.parse_args()
    a.watch = a.watch or a.brief
    # Each network card's own broadcast, as nouPix asks: 255.255.255.255 goes out of one card only (the one with the
    # default route), so a device on another card's network never hears it
    nets = networks()
    if a.net:
        pre = a.net.rstrip(".") + "."
        nets = [n for n in nets if n["ip"].startswith(pre)]
        if not nets:
            sys.exit("No network card here has an address starting %s. This computer's: %s" % (pre, ", ".join("%s/%d (%s)" % (n["ip"], n["prefix"], n["name"]) for n in networks()) or "none found"))
        for n in nets: print("Network card %s %s/%d, broadcast %s" % (n["name"], n["ip"], n["prefix"], n["broadcast"]))
    targets = list(dict.fromkeys(a.ip + [n["broadcast"] for n in nets] + ([] if a.net else ["255.255.255.255"])))
    s = sock()
    print("Asking %s ..." % ", ".join(targets))
    seen, last_poll, stop = {}, 0, time.time() + a.wait
    try:
        while a.watch or time.time() < stop:
            if a.watch and time.time() - last_poll > 2:
                poll(s, targets); last_poll = time.time()
            elif not last_poll:
                poll(s, targets); last_poll = time.time()
            try:
                d, addr = s.recvfrom(2048)
            except socket.timeout:
                continue
            if d[:8] != b"Art-Net\x00" or len(d) < 10 or struct.unpack("<H", d[8:10])[0] != 0x2100:
                continue   # our own poll coming back, or other Art-Net traffic
            if a.net and addr[0] not in a.ip and not any(inside(addr[0], n) for n in nets):
                continue   # a device on another network card's network
            got, out = describe(d, addr, a.raw)
            if not got:
                print(out); continue
            key, sig, sacn = got
            if a.brief:
                n = min(d[173], 4)
                print("%s  %-15s %-18s ports %d  GoodOutputA %-12s -> %s" % (time.strftime("%H:%M:%S"), addr[0], repr(text(d[26:44]))[:18], n,
                      " ".join("%02x" % d[182 + i] for i in range(n)) or "-", "sACN" if sacn else "Art-Net"))
                seen[key] = sig
                continue
            if seen.get(key) == sig:
                continue
            if key in seen:
                print("\n%s  CHANGED  ->  nouPix now reads %s" % (time.strftime("%H:%M:%S"), "sACN" if sacn else "Art-Net"))
            seen[key] = sig
            print(out)
    except KeyboardInterrupt:
        pass
    if not seen:
        print("No ArtPollReply came back. Is the device on this network, and is Art-Net discovery (ArtPoll) on in it?"
              "\nA device set wholly to sACN may stop answering ArtPoll: then nothing here can tell, and nouPix keeps"
              "\nthe protocol you choose (a device's right-click menu in Discovery: Use sACN).")


if __name__ == "__main__":
    main()
