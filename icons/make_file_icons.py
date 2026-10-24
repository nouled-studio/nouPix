# Makes the icons of nouPix's files from their SVGs: noupix-project.svg (.noupix) and noupix-package.svg (.noupixpkg)
# into .icns (macOS) and .ico (Windows) in desktop/resources, where the desktop app's build looks for them.
# Needs Playwright with Chromium (as the tests do) and Pillow: pip install pillow. Run it again after changing an SVG.
import io, os, sys
from PIL import Image
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "desktop", "resources")
ICONS = {"noupix": "noupix-project.svg", "noupixpkg": "noupix-package.svg"}   # named by the extension they're for
SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)

os.makedirs(OUT, exist_ok=True)
with sync_playwright() as pw:
    br = pw.chromium.launch()
    pg = br.new_page()
    for ext, svg in ICONS.items():
        src = open(os.path.join(HERE, svg)).read()
        imgs = {}
        for s in SIZES:
            pg.set_viewport_size({"width": s, "height": s})
            pg.set_content('<body style="margin:0;background:transparent">' + src.replace("<svg ", '<svg width="%d" height="%d" ' % (s, s), 1) + "</body>")
            imgs[s] = Image.open(io.BytesIO(pg.screenshot(omit_background=True))).convert("RGBA")
        big = imgs[1024]
        big.save(os.path.join(OUT, ext + ".icns"), append_images=[imgs[s] for s in (16, 32, 64, 128, 256, 512)])
        imgs[256].save(os.path.join(OUT, ext + ".ico"), sizes=[(s, s) for s in (16, 32, 48, 64, 128, 256)], append_images=[imgs[s] for s in (16, 32, 48, 64, 128)])
        print("made", ext + ".icns", ext + ".ico")
    br.close()
