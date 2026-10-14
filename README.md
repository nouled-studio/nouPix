# openLedMapper 0.8.3

<img src="icons/openledmapper-256.png" alt="" width="96" align="right">

A pixel-mapping tool for LED installations. Draw or import your LED fixtures, play generators, shaders, images, video or a screen capture on them, store looks as scenes, play them in playlists, and send it all out over Art-Net.

## Download

Get the app from the [Releases](https://github.com/nouled-studio/openLEDmapper/releases) page. Nothing else to install.

| Computer | File | Needs |
|---|---|---|
| Windows | `…-windows-setup.exe` (installs it and adds it to the Start menu) | Windows 10 or newer |
| Mac with Apple silicon (M1 or newer) | `…-macos-apple-silicon.dmg` | macOS 12 or newer |
| Mac with an Intel processor | `…-macos-intel.dmg` | macOS 12 or newer |

On a Mac, open the `.dmg` and drag openLedMapper onto Applications.

The apps aren't signed yet, so the first time:

- **Windows:** SmartScreen says it protected your PC. Click **More info → Run anyway**.
- **macOS:** click **Done** on the warning, then **System Settings → Privacy & Security → Open Anyway**.

On Windows, allow openLedMapper through the firewall on private networks when asked, or node discovery won't work.

## Run from the source (Linux, Raspberry Pi, any computer)

You need Python 3.8 or newer and Chrome, Edge or Chromium. Then run:

```
python3 openledmapper.py
```

On Windows or macOS you can also double-click `start-openledmapper.bat` or `start-openledmapper.command`. Keep the terminal open: closing it stops the output. `python3 openledmapper.py --help` lists the options, for example `--bind-ip 2.0.0.10` to send from a specific network card.

## Quick start

1. **Fixtures:** draw them on the stage with `L` line, `M` matrix, `C` circle/oval, `P` path or `N` pen, or import an SVG. Set pixel count, colour order and direction in the Inspector.
2. **Patch:** add your controller in the Patch panel (IP, outputs, universes per output), or find it with **Nodes → Discover**. Drag fixtures onto its outputs; ↑ ↓ (or Alt ↑ ↓) change their order, which sets their addresses.
3. **Content:** click a source to play it. Use zones and layers (Content tab) to play different things on different parts.
4. **Scenes:** press **+ Store** to save a look, and click it to fade back to it. Drag its fade time to change it. The playlist button next to **+ Store** makes a playlist of scenes that plays by itself.
5. Press **Art-Net ON**.

Right-click anything for its options.

To see it working before you build anything, open one of the [examples](examples/) (**Project ▾ → Open project…**), or **Project ▾ → Load demo layout**.

## What it does

- Fixtures: lines, matrices, circles and ovals, straight or curved paths. Fixtures can be grouped, locked, aligned, rotated and resized together, copied and pasted.
- Content: 32 built-in generators, from very smooth ones for architecture (Color drift, Soft clouds, Horizon, Slow waves) to disco ones (Disco dots, Scanner, Confetti, Color hits, Mirror ball, Equalizer), plus your own ISF shaders, images, video (play, pause, trim with the mouse, loop or once, with or without its sound) and window capture (for example Resolume's output), in zones with layers and blend modes. Colours are picked on a colour wheel, with RGB or HSV sliders, lighting presets and recent colours. Any slider's value can be typed (double-click it) or stepped with Shift + scroll, and angles have buttons for 0°, 45°, 90°… Sources are sorted by **mood, use, look and motion** (Calm · Architectural · Organic · Drift, Party · Show · Particles · Beat…), with a search box.
- **16-bit fixtures** (a coarse and a fine channel per colour) and **dimming curves**: gamma, linear, square law, inverse square and S curve (each but linear with its own slider: gamma, or strength), with a graph of the curve in the Inspector that moves as you drag it. 8-bit and 16-bit fixtures mix freely.
- Scenes per zone, with crossfades; the fade time is on each scene's button.
- **Playlists:** several per zone, each a list of scenes with play times, played by itself in a loop, once, or followed by another playlist. Fades come from each scene, one for the whole playlist, or a step's own.
- Art-Net output with automatic addressing, node discovery and a DMX monitor. **Highlight** (💡) lights fixtures on site to check them: Trace, Flood, Color check, Spotlight, and Pixel finder for single pixels. Gamma and colour trims are set per fixture, and RGBW is supported.
- The output keeps running when the window is minimised or covered.
- **Remote control:** phones, tablets and other computers on the network log in as Programmer (everything, with a password), Operator (content, scenes and playlists; the mapping is locked) or Remote, a simple page that plays the playlists and scenes of each zone and dims the zones.
- Projects save to a file. You can also export a CSV patch list for the install crew.

## Shortcuts

| Key | Action |
|---|---|
| `V` `L` `M` `C` `P` `N` `Z` | Select, line, matrix, circle, path, pen, zone tools |
| `Ctrl C` / `X` / `V` | Copy, cut, paste fixtures |
| `Ctrl D` · `Del` | Duplicate · delete |
| `Ctrl G` · `Ctrl Shift G` | Group · ungroup |
| `R` · `Shift R` | Rotate the selection 90° clockwise · counter-clockwise |
| `Ctrl L` | Lock or unlock |
| `Ctrl Z` · `Ctrl S` | Undo · save project |
| `1`–`9` | Scenes of the selected zone (`Shift` cuts) |
| `I` · `B` · `F` · `H` | Highlight · blackout · fit view · hide the side panel |

## More

- **Full reference:** every feature in detail is in [docs/user-guide.md](docs/user-guide.md). A PDF guide is coming.
- **Limits:** Art-Net only (no sACN yet). No Syphon, Spout or NDI; use window capture instead.

## For developers

- **Interface:** `index.html` (markup), `css/app.css`, and the scripts in `js/`, one per responsibility (model, geometry, patch, sources, render, output, project files, actions, and the panels). [CLAUDE.md](CLAUDE.md) describes the architecture and the conventions. Plain scripts, no build step: the page also opens straight from disk.
- **Art-Net bridge:** `openledmapper.py` (Python, standard library only). With remote control on it also serves `login.html` and `remote.html` (the phone page) to the network.
- **Desktop app:** an Electron window in `desktop/`, around the interface, with the bridge packed inside.
  - Run it from source with `cd desktop && npm install && npm start`.
- **Tests:** `python tests/run_tests.py --quick` (about 10 minutes), or without `--quick` for everything, including the byte-for-byte Art-Net comparison, a soak test and the UI fuzzer.
- **Examples:** `examples/`; `python tests/make_examples.py` rebuilds the example projects.
- **Release:** set `VERSION` in `openledmapper.py`, then push a matching tag (`git tag v0.8.3 && git push origin v0.8.3`). GitHub builds the Windows and Mac apps and attaches them to a release (`.github/workflows/release.yml`).

## Licence and credits

GPL-3.0 (see `LICENSE`). The ISF renderer is [interactive-shader-format](https://github.com/Vidvox/interactive-shader-format-js) by VIDVOX (ISC licence).
