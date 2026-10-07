# PyInstaller recipe for the Art-Net bridge inside the desktop app:  pip install pyinstaller && pyinstaller openledmapper.spec
# Builds dist/openledmapper-bridge/ (a folder: it starts faster than a one-file build and isn't unpacked on every
# launch). The Electron app in desktop/ bundles that folder and runs it with --embedded.
# .github/workflows/release.yml builds it, then the app, on GitHub for every version tag.

a = Analysis(["openledmapper.py"], datas=[("index.html", "."), ("css", "css"), ("js", "js"), ("icons/openledmapper.ico", "icons")])
pyz = PYZ(a.pure)
# A console program, so the app can read its output; the app starts it without a console window.
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="openledmapper-bridge", console=True)
coll = COLLECT(exe, a.binaries, a.datas, name="openledmapper-bridge")
