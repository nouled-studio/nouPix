# nouPix 1.2.0

<img src="icons/noupix-256.png" alt="" width="96" align="right">

A pixel-mapping tool for LED installations, by nouled studio. It was called openLedMapper until 1.0. Draw or import your LED fixtures, play generators, shaders, images, video or a screen capture on them, store looks as scenes, play them in playlists, and send it all out over Art-Net.

## Download

Get the app from the [Releases](https://github.com/nouled-studio/openLEDmapper/releases) page. Nothing else to install.

| Computer | File | Needs |
|---|---|---|
| Windows | `…-windows-setup.exe` (installs it and adds it to the Start menu) | Windows 10 or newer |
| Mac with Apple silicon (M1 or newer) | `…-macos-apple-silicon.dmg` | macOS 12 or newer |
| Mac with an Intel processor | `…-macos-intel.dmg` | macOS 12 or newer |
| Linux (or any computer) | no app: run it from the source, `python3 noupix.py` ([below](#run-from-the-source-linux-raspberry-pi-any-computer)) | Python 3.8 or newer, and Chrome, Edge or Chromium |

On a Mac, open the `.dmg` and drag nouPix onto Applications.

The apps aren't signed yet, so the first time:

- **Windows:** SmartScreen says it protected your PC. Click **More info → Run anyway**.
- **macOS:** click **Done** on the warning, then **System Settings → Privacy & Security → Open Anyway**.

On Windows, allow nouPix through the firewall on private networks when asked, or node discovery won't work.

## Run from the source (Linux, Raspberry Pi, any computer)

You need Python 3.8 or newer and Chrome, Edge or Chromium. Then run:

```
python3 noupix.py
```

On Windows or macOS you can also double-click `start-noupix.bat` or `start-noupix.command`. Keep the terminal open: closing it stops the output. `python3 noupix.py --help` lists the options, for example `--bind-ip 2.0.0.10` to send from a specific network card.

## Quick start

New to nouPix? The **[Getting started guide (PDF)](docs/nouPix-getting-started.pdf)** walks you from an empty project to a running show, step by step, with pictures.

1. **Fixtures:** draw them on the stage with `L` line, `M` matrix, `C` circle/oval, `P` path or `N` pen, or import an SVG. Set pixel count, colour order and direction in the Inspector.
2. **Patch:** add your controller in the Patch panel (IP, outputs, universes per output), or find it with **Nodes → Discover**. Drag fixtures onto its outputs; ↑ ↓ (or Alt ↑ ↓) change their order, which sets their addresses.
3. **Content:** click a source to play it. Use zones and layers (Content tab) to play different things on different parts.
4. **Scenes:** press **+ Store** to save a look, and click it to fade back to it. Drag its fade time to change it. The playlist button next to **+ Store** makes a playlist of scenes that plays by itself. With two zones over the whole canvas, **X-Fader** (bottom left of the Scenes panel) mixes one into the other with a single fader.
5. Art-Net goes out from the start; the status bar shows it. **Settings → Art-Net connection** switches it off.

Right-click anything for its options.

To see it working before you build anything, open one of the [examples](examples/) (**Project ▾ → Open project…**), or **Project ▾ → Load demo layout**.

## What it does

- Fixtures: lines, matrices, circles and ovals, straight or curved paths. Fixtures can be grouped, locked, aligned, rotated and resized together, copied and pasted.
- Content: 53 built-in generators, from very smooth ones for architecture (Color drift, Soft clouds, Color wash, Cascade, Marble, Embers) and ambient ones (Caustics, Nebula, Fireflies, Bokeh) to disco ones (Disco dots, Kaleidoscope, Laser fan, Tunnel, Lightning, Mirror ball), and light-art ones, plus your own ISF shaders, images, video (play, pause, trim with the mouse, loop or once, with or without its sound) window capture and **NDI or OMT streams** from other programs and computers (Resolume, TouchDesigner, OBS…; NDI needs NDI Tools installed, OMT its libomt), in zones with layers and blend modes. Colours are picked on a colour wheel, with RGB or HSV sliders, lighting presets and recent colours. Any slider's value can be typed (double-click it) or stepped with Shift + scroll, and angles have buttons for 0°, 45°, 90°… Sources are sorted by **mood, use, look and motion** (Calm · Architectural · Organic · Drift, Party · Show · Particles · Beat…), with a search box.
- **16-bit fixtures** (a coarse and a fine channel per colour) and **dimming curves**: gamma, linear, square law, inverse square and S curve (each but linear with its own slider: gamma, or strength), with a graph of the curve in the Inspector that moves as you drag it. 8-bit and 16-bit fixtures mix freely.
- Scenes per zone, with crossfades; the fade time is on each scene's button. A scene or a playlist can play when the project opens, and a project can open when nouPix starts (Settings → Startup, or `noupix.py --project FILE`): for computers that run a show by themselves.
- **X-Fader:** one fader between two zones, A and B, like the crossfader of a DJ or video mixer. Turn it on at the bottom left of the Scenes panel; its strip shows a live preview of each zone (even the one faded out, so you see what comes next) and lists to choose them. Three modes, each drawn as a small graph: **Mix** fades A into B, as bright in the middle as at the ends where both cover the same lights; **Dip** goes through black; **Cut** switches at the middle. While it is on it alone sets A's and B's levels. Give it a fader on your MIDI controller, and, for special occasions, put it on the phones' Remote page too.
- **Playlists:** several per zone, each a list of scenes with play times, played by itself in a loop, once, or followed by another playlist. Fades come from each scene, one for the whole playlist, or a step's own.
- Art-Net output with automatic addressing, node discovery and a DMX monitor. **Highlight** (💡) lights fixtures on site to check them: Trace, Flood, Color check, Spotlight, and Pixel finder for single pixels. Gamma and colour trims are set per fixture, and RGBW is supported.
- The output keeps running when the window is minimised or covered.
- **Black or white:** the interface is black, so the light on the stage is the brightest thing on screen; one click in the top bar (or Settings → Interface) turns it white for daylight. Groups and zones can be given a colour, which their fixtures and scenes show; nothing gets one unless you choose it.
- Works offline: the fonts and everything else come with the app. Online, it tells you when a new version is out (once a day, from GitHub; Settings → Updates turns it off).
- **Macros:** in the MIDI window, Speed, Intensity, Saturation, Color 1 and 2, and the controls most effects share (Angle, Width, Softness…), for every effect at once, over each one's own values: scenes keep theirs. Each effect can take a control out of its macro, or have it follow another.
- **MIDI:** the faders, knobs and pads of a MIDI controller move the master, blackout, the X-Fader, the groups' dimmers, the zones' levels, the macros and any control of an effect, and play scenes and playlists. Press Learn, move a control, then choose what it should move from its list, or click it. Faders pick up where the slider is, and a thin yellow line on the slider shows where the fader is. See every mapping as wires in the patch bay (draw new ones by dragging; see and change which effects follow each macro), or as a list. No controller at hand? The MIDI window has a virtual one on screen.
- **Remote control:** phones, tablets and other computers on the network log in as Programmer (everything, with a password), Operator (content, scenes and playlists; the mapping is locked) or Remote, a simple page that plays the playlists and scenes of each zone and dims the zones (and, when you choose, moves the X-Fader).
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

- **Full reference:** every feature in detail is in [docs/user-guide.md](docs/user-guide.md); the [Getting started guide (PDF)](docs/nouPix-getting-started.pdf) is the short way in.
- **Media library and packages:** images and videos are copied once into nouPix's library, so projects open with them without relinking; **Export package…** writes one `.noupixpkg` file with the project and its media, to open on another computer.
- **Limits:** Art-Net only (no sACN yet). No Syphon or Spout; use NDI, OMT or window capture instead.

## For developers

- **Interface:** `index.html` (markup), `css/app.css`, and the scripts in `js/`, one per responsibility (model, geometry, patch, sources, render, output, project files, actions, and the panels). [CLAUDE.md](CLAUDE.md) describes the architecture and the conventions. Plain scripts, no build step: the page also opens straight from disk.
- **Art-Net bridge:** `noupix.py` (Python, standard library only). With remote control on it also serves `login.html` and `remote.html` (the phone page) to the network.
- **Desktop app:** an Electron window in `desktop/`, around the interface, with the bridge packed inside.
  - Run it from source with `cd desktop && npm install && npm start`.
- **Tests:** `python tests/run_tests.py --quick` (about 10 minutes), or without `--quick` for everything, including the byte-for-byte Art-Net comparison, a soak test and the UI fuzzer.
- **Examples:** `examples/`; `python tests/make_examples.py` rebuilds the example projects.
- **Release:** set `VERSION` in `noupix.py`, then push a matching tag (`git tag v1.0.0 && git push origin v1.0.0`). GitHub builds the Windows and Mac apps and attaches them to a release (`.github/workflows/release.yml`).

## Licence and credits

GNU Affero General Public License 3.0 (AGPL-3.0, see `LICENSE`), © 2026 nouled studio. Anyone may use, change and share nouPix, and sell it too, but whoever passes it on, changed or not, or lets people use a changed copy over a network, must give them its full source under the same licence. Until 17 October 2026 the code was under GPL-3.0; copies taken before then keep that licence. The look and the logo are described in [docs/brand.md](docs/brand.md), and with pictures, for designers and anyone making content for nouPix, in the [brand guide (PDF)](docs/nouPix-brand-guide.pdf). The fonts are Saira, Chakra Petch and JetBrains Mono (SIL Open Font License, `css/OFL.txt`). The ISF renderer is [interactive-shader-format](https://github.com/Vidvox/interactive-shader-format-js) by VIDVOX (ISC licence).
