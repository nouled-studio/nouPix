# PyInstaller recipe for the Art-Net bridge inside the desktop app:  pip install pyinstaller && pyinstaller noupix.spec
# Builds dist/noupix-bridge/ (a folder: it starts faster than a one-file build and isn't unpacked on every
# launch). The Electron app in desktop/ bundles that folder and runs it with --embedded.
# .github/workflows/release.yml builds it, then the app, on GitHub for every version tag.

import re
import sys

a = Analysis(["noupix.py"], datas=[("index.html", "."), ("login.html", "."), ("remote.html", "."), ("remote.webmanifest", "."), ("remote-sw.js", "."), ("icons/remote-192.png", "icons"), ("icons/remote-512.png", "icons"), ("icons/remote-maskable-512.png", "icons"), ("css", "css"), ("js", "js"), ("icons/noupix.ico", "icons")])
pyz = PYZ(a.pure)

# On Windows the exe gets nouPix's icon and name, so Windows (Task Manager, the firewall) shows "nouPix
# bridge" rather than a nameless program.
win = {}
if sys.platform == "win32":
    from PyInstaller.utils.win32.versioninfo import (VSVersionInfo, FixedFileInfo, StringFileInfo, StringTable,
                                                     StringStruct, VarFileInfo, VarStruct)
    version = re.search(r'^VERSION = "(.+)"', open("noupix.py", encoding="utf-8").read(), re.M).group(1)
    nums = tuple((list(map(int, re.findall(r"\d+", version)))[:4] + [0, 0, 0, 0])[:4])
    win = dict(icon="icons/noupix.ico", version=VSVersionInfo(
        ffi=FixedFileInfo(filevers=nums, prodvers=nums),
        kids=[StringFileInfo([StringTable("040904B0", [
                  StringStruct("CompanyName", "nouled studio"),
                  StringStruct("FileDescription", "nouPix bridge"),
                  StringStruct("FileVersion", version),
                  StringStruct("InternalName", "noupix-bridge"),
                  StringStruct("LegalCopyright", "Copyright (c) 2026 nouled studio. AGPL-3.0"),
                  StringStruct("OriginalFilename", "noupix-bridge.exe"),
                  StringStruct("ProductName", "nouPix"),
                  StringStruct("ProductVersion", version)])]),
              VarFileInfo([VarStruct("Translation", [0x0409, 1200])])]))

# A console program, so the app can read its output; the app starts it without a console window.
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="noupix-bridge", console=True, **win)
coll = COLLECT(exe, a.binaries, a.datas, name="noupix-bridge")
