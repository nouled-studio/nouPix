#!/usr/bin/env python3
"""Run openLedMapper's test suites, one after the other, and print one line per suite.

    python tests/run_tests.py            everything (about 12 minutes)
    python tests/run_tests.py --quick    skip the golden output, soak and fuzz runs (about 5 minutes)
    python tests/run_tests.py groups v05 only the suites named (see SUITES)

Needs: pip install playwright && playwright install chromium
The tests listen on UDP 6454 like an Art-Net node, so quit other Art-Net software first.
The golden output test also uses 127.0.0.2 and 127.0.0.3; on macOS add them once per boot with
    sudo ifconfig lo0 alias 127.0.0.2 up && sudo ifconfig lo0 alias 127.0.0.3 up
"""
import json, os, re, socket, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
OUT = tempfile.mkdtemp(prefix="olm-tests-")

def run(args, timeout, env=None):
    """Run a test script; its output goes to a log file. Returns the log's text."""
    run.n = getattr(run, "n", 0) + 1
    log = os.path.join(OUT, "%02d_%s.log" % (run.n, re.sub(r"\W+", "_", args[0])))
    e = dict(os.environ, **(env or {}))
    with open(log, "w") as f:
        try: subprocess.run([PY, "-u"] + args, cwd=HERE, stdout=f, stderr=subprocess.STDOUT, timeout=timeout, env=e)
        except subprocess.TimeoutExpired: f.write("\nFAILED: timed out after %d s\n" % timeout)
    return open(log).read()

def counted(text):
    passes = len(re.findall(r"^PASS", text, re.M))
    failed = re.search(r"^FAILED: (.*)$", text, re.M)
    ok = failed is not None and failed.group(1).strip() == "none"
    return ok, "%d pass, failed: %s" % (passes, failed.group(1) if failed else "? (did not finish, see the log)")

def loopbacks_ok():
    for ip in ("127.0.0.2", "127.0.0.3"):
        try: s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind((ip, 0)); s.close()
        except OSError: return False
    return True

def golden():
    if not loopbacks_ok():
        return None, "skipped: 127.0.0.2 / 127.0.0.3 are not available (see the top of this file)"
    ref = os.path.join(HERE, "golden")
    new = os.path.join(OUT, "golden_ABC.json")
    run(["golden.py", os.path.dirname(HERE), new, "8140"], 900)
    t = subprocess.run([PY, "gcompare.py", os.path.join(ref, "golden_A-C.json"), new], cwd=HERE, capture_output=True, text=True).stdout.strip().splitlines()
    abc = t[-1] if t else "no result"
    new_de = os.path.join(OUT, "golden_DE.json")
    run(["golden.py", os.path.dirname(HERE), new_de, "8142"], 900, {"ONLY": "DE", "MORE": "1", "EXTRA": "--disable-accelerated-2d-canvas"})
    try:
        a = dict(json.load(open(os.path.join(ref, "golden_D.json"))), **json.load(open(os.path.join(ref, "golden_E.json"))))
        b = json.load(open(new_de))
        de = "ALL IDENTICAL" if a == b else "DIFFERENT " + str([k for k in a if a.get(k) != b.get(k)])
    except Exception as e: de = "no result (%s)" % e
    return abc == "ALL IDENTICAL" and de == "ALL IDENTICAL", "A-C: %s · D-E: %s" % (abc, de)

def simple(script, port, timeout=900, extra=()):
    return lambda: counted(run([script, str(port), *extra], timeout))

def last_line(script, args, timeout, good):
    def f():
        t = run([script, *args], timeout).strip().splitlines()
        line = t[-1] if t else "no output"
        return good(line), line
    return f

def bridge():
    t = run(["test_bridge.py"], 300)
    want = ["frame without output-on sent: 0", "owner frame sent: 1", "A got takeover: True", "old owner frame dropped: True",
            "after output off, frames: 0", "after owner disconnect, frames: 0"]
    held = re.search(r"held frames in 3 s after stall: (\d+)", t)
    missing = [w for w in want if w not in t] + ([] if held and int(held.group(1)) >= 3 else ["held frames after a stall"])
    return not missing, "output only when on, takeover, frame hold, stop on disconnect" if not missing else "not as expected: " + "; ".join(missing)

def fuzz():
    t = run(["fuzz_ui.py", "8147", "7", "200"], 1200)
    m = re.search(r"^seed.*$", t, re.M)
    line = m.group(0) if m else "did not finish"
    return bool(m) and "errors 0" in line and "still ticking True" in line and "project OK" in line, line

SUITES = [   # name, function, part of --quick
    ("golden", golden, False),
    ("zones", simple("test_zones.py", 8060), True),
    ("e2e", lambda: counted(run(["test_e2e.py"], 900)), True),
    ("fade", last_line("test_fade.py", [], 600, lambda l: l.startswith("PASS")), True),
    ("ui", simple("test_ui.py", 8143, 600), True),
    ("robust", simple("test_robust.py", 8144, 1200), True),
    ("bridge", bridge, True),
    ("bridge2", last_line("test_bridge2.py", ["8145"], 300, lambda l: "ALL PASS" in l), True),
    ("soak", simple("test_soak.py", 8146, 1500, ("30",)), False),
    ("fuzz", fuzz, False),
    ("arrange", simple("test_arrange.py", 8148, 600), True),
    ("groups", simple("test_groups.py", 8149, 900), True),
    ("v05", simple("test_v05.py", 8150, 600), True),
    ("v06", simple("test_v06.py", 8152, 600), True),
    ("video", simple("test_video.py", 8153, 600), True),
    ("examples", simple("make_examples.py", 8154, 600, ("--check",)), True),
    ("options", simple("test_options.py", 8155, 1500), True),
    ("static", simple("test_static.py", 8156, 120), True),
    ("color", simple("test_color.py", 8157, 300), True),
    ("remote", simple("test_remote.py", 8160, 1200), True),
    ("rapp", simple("test_remote_app.py", 8164, 400), True),
    ("rsoak", simple("test_remote_soak.py", 8162, 2400), False),
    ("playlist", simple("test_playlist.py", 8170, 600), True),
    ("16bit", simple("test_16bit.py", 8174, 600), True),
    ("values", simple("test_values.py", 8178, 300), True),
    ("midimock", simple("test_midi_mockup.py", 8180, 300), True),
    ("profile", last_line("test_profile_move.py", [], 60, lambda l: "ALL PASS" in l), True),
]

if __name__ == "__main__":
    args = sys.argv[1:]
    quick = "--quick" in args
    names = [a for a in args if not a.startswith("--")]
    todo = [s for s in SUITES if (s[0] in names if names else (s[2] or not quick))]
    print("Logs in", OUT)
    bad = 0
    for name, fn, _ in todo:
        t0 = time.time()
        ok, line = fn()
        bad += ok is False
        print("%-8s %-4s %5.0f s  %s" % (name, "ok" if ok else "SKIP" if ok is None else "FAIL", time.time() - t0, line[:220]), flush=True)
    print("ALL PASS" if not bad else "%d suite(s) failed" % bad)
    sys.exit(1 if bad else 0)
