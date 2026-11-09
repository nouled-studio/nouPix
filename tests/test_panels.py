# The side panels folded for room on the stage: the left one (fixtures and sources) from its « in the Fixtures head,
# the stage bar's button or Shift H, as the right one folds; the stage takes the room; both at once; kept between
# sessions.
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, CHROME_ARGS, app_error
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8254
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

bridge = start_bridge(PORT)
errs = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=CHROME_ARGS)
    pg = br.new_page(viewport={"width": 1400, "height": 900})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if app_error(m) else None)
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    E = pg.evaluate
    E("localStorage.clear()")
    stage = lambda: round(pg.locator("#stage").bounding_box()["width"])
    left = lambda: pg.locator("aside.left").is_visible()
    w0 = stage()
    check("the left panel shows at first, with a « in its head and a button in the stage bar", left() and pg.locator("#btnHideLeft").is_visible() and pg.locator("#btnLeft svg").count() == 1)
    lit = lambda sel: E(f"getComputedStyle($('{sel}')).borderColor") == E("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() && getComputedStyle($('#btnRight')).borderColor")
    check("both stage-bar buttons are outlined alike while their panels show", E("$('#btnLeft').classList.contains('on')") and lit('#btnLeft'))
    gaps = E("(() => { const bar = $('.stagebar').getBoundingClientRect(), l = $('#btnLeft').getBoundingClientRect(), r = $('#btnRight').getBoundingClientRect(); return [Math.round(l.left - bar.left), Math.round(bar.right - r.right)]; })()")
    check("…each at its end of the bar, the same distance in", gaps[0] == gaps[1], gaps)
    pg.click("#btnHideLeft"); time.sleep(0.4)
    w1 = stage()
    check("folded, the left button is plain, and stays at the bar's left end", not E("$('#btnLeft').classList.contains('on')") and E("Math.round($('#btnLeft').getBoundingClientRect().left - $('.stagebar').getBoundingClientRect().left)") == gaps[0])
    check("« folds it, and the stage takes its room", not left() and w1 > w0 + 200, (w0, w1))
    check("…the stage bar's button shows it is folded", pg.locator("#btnLeft").get_attribute("aria-pressed") == "false")
    pg.click("#btnLeft"); time.sleep(0.4)
    check("the stage bar's button brings it back", left() and abs(stage() - w0) <= 1, stage())
    pg.click("#stage", position={"x": 300, "y": 300}); pg.keyboard.press("Shift+H"); time.sleep(0.4)
    check("Shift H folds it", not left())
    pg.keyboard.press("h"); time.sleep(0.4)
    check("H folds the right one too: the stage takes the whole width", not left() and not pg.locator("aside.right").is_visible() and stage() > 1300, stage())
    pg.reload(); pg.wait_for_function("window.olm && olm.bridge.connected"); time.sleep(0.5)
    check("both stay folded after a reload", not left() and not pg.locator("aside.right").is_visible())
    pg.keyboard.press("Shift+H"); pg.keyboard.press("h"); time.sleep(0.4)
    check("and come back the same way", left() and pg.locator("aside.right").is_visible() and abs(stage() - w0) <= 1, stage())
    check("no errors in the page", not errs, errs[:3])
    br.close()
finally:
    bridge.kill()
print("FAILED: " + (", ".join(fails) if fails else "none"))
sys.exit(1 if fails else 0)
