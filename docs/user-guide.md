# openLedMapper: detailed reference

Everything openLedMapper 0.6.0 does, in detail (the version shows next to the app name, top left). This is the source text for the PDF guide; the [README](../README.md) has the essentials.

A basic pixel-mapping tool: draw or import LED fixtures (lines, matrices, circles, free paths), split the canvas into zones, layer generators, ISF shaders, images, video or a screen capture in each zone, store looks as scenes to play live, patch the fixtures to Art-Net controller outputs, and send it out.

The interface runs in your browser. `openledmapper.py` is a small local server that sends the Art-Net packets, because browsers cannot send UDP.

## Start

**The app (Windows and macOS).** Download it from the [Releases](https://github.com/nouled-studio/openLEDmapper/releases) page. Nothing else to install, and you don't need Chrome. It needs Windows 10 or newer, or macOS 12 (Monterey) or newer.

- **Windows:** `…-windows-setup.exe`. Run it: it installs openLedMapper and adds it to the Start menu and the desktop.
- **Mac:** `…-macos-apple-silicon.dmg` (Macs with an M1 or newer) or `…-macos-intel.dmg`. Open it and drag openLedMapper onto Applications.

The apps aren't signed yet, so the first time you open one:

- **Windows:** SmartScreen says it protected your PC. Click **More info → Run anyway**.
- **macOS:** it says the app can't be checked. Click **Done**, then open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to openLedMapper.

The app is one window with the Art-Net bridge inside it. It keeps running when you minimise or cover it. Closing the window quits it (it asks first while Art-Net is on), and opening the app again while it runs brings its window to the front. The bridge's messages go to `~/.openledmapper/openledmapper.log` (on Windows, `C:\Users\<you>\.openledmapper\openledmapper.log`); **Help → Show log file** opens its folder. To send from a specific network card, start the app with `--bind-ip=2.0.0.10` (the other bridge options work the same way: `--port=`, `--bind-port=`, `--host=`).

The app keeps its own copy of the current project, separate from the browser window used when running from the source. To move a project between them, use **Project → Save project file** in one and open that file in the other.

**From the source (any system, including Linux).** You need Python 3.8 or newer. Nothing else to install.

- **Windows:** double-click `start-openledmapper.bat`
- **macOS:** double-click `start-openledmapper.command` (the first time, right-click → Open)
- **Any system:** `python3 openledmapper.py` (add `--background` to run it without a terminal: it then stops by itself about 10 seconds after its window closes, and logs to the file above)

openLedMapper opens in its own window at `http://127.0.0.1:8080/`, using Chrome or Edge (or Chromium or Brave) started with the switches that stop the browser from slowing down or pausing a hidden window. You can minimise it or cover it with other windows and the output keeps running. Run from the source, keep the terminal window open: closing it stops the Art-Net output. Closing the openLedMapper window stops it too, which is why it asks before it closes while Art-Net is on.

The openLedMapper window has its own browser profile (in `~/.openledmapper/browser-profile`), so it doesn't share settings or storage with your normal browser. The project kept by Weft, as this app was called before, carries over: the first time, its profile folder `~/.weft` is renamed to `~/.openledmapper`. If you have a project from an earlier version open in your normal browser, save it there with **Project → Save project file** and open that file in the openLedMapper window.

- `--default-browser` opens your normal browser instead (output can then slow down when that window is hidden).
- `--browser-path PATH` picks the browser if it isn't found automatically.

On Windows, allow openLedMapper (or Python) through the firewall on private networks when asked, otherwise node discovery won't receive replies.

## Workflow

1. **Settings → Composition.** Set the size of the canvas the content is rendered at. Fixture coordinates use these units.
2. **Fixtures.** Pick a tool on the stage: `L` line, `M` matrix, `C` circle/ring, `P` path (straight segments), `N` pen (curves). Drag to draw, or click for a default size. You can also bring fixtures in with **SVG…** (see below). Edit exact values in the Inspector, including pixel count, color order, wiring start and direction.
3. **Patch.** In the Patch panel, add a controller: IP address, number of outputs, universes per output and first universe. Then drag fixtures from the list onto an output. Fixtures chained on one output are addressed in order, automatically.
4. **Content.** Click a generator in Sources to play it in the selected layer of the selected zone. Add zones, layers, blend modes and parameters in the Content tab (see below). You can also add your own ISF shader, an image, a video, or a window capture (for example Resolume's output).
5. **Scenes.** When a zone's look is right, press **+ Store** on its row in the Scenes panel.
6. **Art-Net ON.**

**Ovals.** A circle stretches into an oval: drag the side handles of its frame on the stage, or set **Radius X** and **Y** in the Inspector (**Make it round** brings it back). Its pixels are spaced evenly along the curve, as on a real strip. Ellipses in an imported SVG become ovals.

**Pen** (`N`) draws curved strips as in Illustrator: click for a corner point, click and drag to pull out the handles of a smooth point, click the first point to close the shape, double-click or `Enter` to finish (`Backspace` removes the last point, `Esc` cancels). Pixels are spaced evenly along the curve. On a selected path, drag a handle to reshape the curve (the point's other handle turns with it; hold `Alt` to move one handle on its own), and double-click a point to switch it between smooth and corner.

With **Wiring** on, the stage also draws the data cable between fixtures chained on one output: a thin dashed line with an arrow from the last pixel of one to the first pixel of the next.

**Right-click** anything for its options: a fixture (patch it to an output, group, lock, reverse, bring to front…), the empty stage (add a fixture there, paste there), a zone, a layer, a scene, a source, a controller or a patched fixture in the Patch panel. A right-drag on the stage still pans.

**Ctrl C** / **Ctrl X** / **Ctrl V** copy, cut and paste fixtures, with their groups. They go through the system clipboard, so they also paste into another project or another openLedMapper window. A paste lands where the copies were, moved down and right if that place is taken; **Paste here** (right-click on the stage) puts them where you clicked. Pasted fixtures aren't patched: right-click → **Patch to**.

**Lock** (the padlock beside the Group button above the fixture list, or **Ctrl L**) locks everything selected: one fixture, several, or a whole group. Locked fixtures can't be moved, nudged, aligned or deleted, and the stage and Ctrl A skip them; a locked group shows a padlock on its row. With everything selected already locked, the same button (amber then) unlocks.

**Rotate** turns everything selected as one piece around the middle of the box around it: several fixtures, a whole group, or one. Drag the round handle above the selection on the stage (**Shift** for steps of 15°), use **Inspector → Arrange → Rotate** (90° and 15° either way, or any angle), or press **R** (90° clockwise) and **Shift R** (counter-clockwise). Lines and paths turn their points, a matrix or an oval its rotation, and a round circle its start angle, so pixel 1 moves with it. Locked fixtures stay where they are. An oval can also be turned on its own with **Rotation °** in the Inspector. The frame around the selection turns with it and keeps its size; a group keeps its frame's angle in the project.

**Resize** several fixtures, a whole group, or one circle, oval or path (pen curves included): drag one of the eight square handles on the frame around them. Each stretches from the opposite side, along the frame (so a turned group stretches along its own length); **Shift** keeps the proportions. **Inspector → Arrange → Size** sets the width and height exactly, from the middle, with **Keep proportions** on by default. Pixel counts stay as they are: the pixels spread out or move closer. A matrix or oval stretches along its own sides, and a circle stretched one way becomes an oval.

**Ctrl D** duplicates. Copies are numbered on from the original: Matrix 1 becomes Matrix 2, Matrix 10 becomes Matrix 11, skipping numbers already used; a name without a number gets 2 (Wave → Wave 2). The same goes for pasted fixtures and duplicated groups, zones and scenes. When the originals are on one output, the copies go on that output after the fixtures already there, while they fit; a copy that doesn't fit stays unpatched. When the originals are spread over several outputs (for example a group across two outputs), the copies stay unpatched: right-click → **Patch to**.

The Inspector / Content / Settings panel on the right can be hidden for a bigger stage: **»** in its tabs, the panel button at the right of the stage bar, or `H`. Double-clicking a fixture to rename it brings it back.

**Highlight** (💡 in the top bar, or `I`) shows a test on the LEDs instead of the content, to check the installation; ▾ next to it picks the mode. Trace, Flood and Color check light the selected fixtures, or all of them when none is selected.

- **Trace**: dim white, first pixel red, last pixel blue, and a green dot running in wiring order. Checks direction and patching.
- **Flood**: full white. Finds dead or missing pixels.
- **Color check**: red, green, blue and white in turn, a second each. Checks the colour order (RGB, GRB…).
- **Spotlight**: the selected fixtures yellow and all the others blue. Shows which fixture is which on site.
- **Pixel finder**: click a pixel on the stage and only that pixel lights; its fixture, number and universe/channel show. `←` `→` step to the next pixel (`Shift` ×10). Clicks on the stage pick pixels instead of selecting or moving fixtures while it is on.

**Arrange** in the Inspector lines fixtures up. With several selected: align their left edges, centres or right edges, or their tops, middles or bottoms, to the box around all of them; distribute 3 or more so their centres are evenly spaced (the outermost two stay where they are); or centre them together on the canvas. With one selected, the same buttons align it to the canvas. Locked fixtures stay put but still count for the box, so the others can line up with a locked one. **Ctrl Z** undoes.

Drag fixtures in the list to change their order: the last one is drawn on top, and **Auto-patch** fills the outputs in this order. Fixtures already patched keep their addresses; their order on an output is set in the Patch panel.

## Groups

A group keeps fixtures together, for example the strips of one sign or the rings of one piece. The demo layout has two, Strips and Rings.

- Select fixtures and press the **Group** button in the Fixtures header (`Ctrl G`); it lights up once two or more are selected, and becomes **Ungroup** when a group is selected. The group goes where the first of them is in the list. Rename it and change its colour in the Inspector; the arrow next to its name in the list folds it.
- Click a group's name in the list, or any of its fixtures on the stage, to select the whole group: it moves as one and gets a frame with its name. Double-click a fixture on the stage, or click it in the list, to select just that one.
- Drag in the list to change groups. Dropped between the fixtures of a group, a fixture joins that group there; dropped on a group's name, it joins it at the end; dropped above or below a group, or under the list, it is in no group. The drop line starts at the indent when the fixture lands inside a group.
- Drag a group by its name to move all of it, or onto an output in the Patch panel to patch all its fixtures there, in list order.
- **Ungroup** (the same button, or `Ctrl Shift G`) keeps the fixtures where they are. With one fixture selected, the Inspector's **Group** menu moves it into a group or out of one.
- **Ctrl D** on a group makes a new group of copies. **Delete** deletes its fixtures, and **Ctrl Z** brings them back. A group with no fixtures left disappears.
- **Arrange** with one group selected lines up its fixtures with each other. With several groups (and fixtures) selected, each group moves as one block, and a group with a locked fixture stays put.
- Grouping organises the list and the selection; on its own it doesn't change the patch or the output. There is one level: a fixture is in one group at most, and groups don't go inside other groups. Groups are saved in the project.

## Zones

A zone is a rectangle of the canvas with its own layers, its own scenes and one opacity slider, its master. Content is drawn to fit the zone, so a centred effect centres on the zone. Fixture pixels inside a zone take its content; pixels outside every zone stay black.

- Zones higher in the list cover the ones below, as far as their opacity goes. New zones go underneath the others, so a big zone on top can cover everything, and lowering its opacity reveals the zones under it.
- Drag a zone in the Content tab's list, or a zone's header in the Scenes panel, to change the order.
- Draw zones with the **Zone tool** (`Z`): drag on the stage to draw one, click to select, drag a zone's label to move it and its handles to resize it, double-click to edit its layers. The Inspector shows its exact position and size, which lights it covers, **Fit to selected fixtures**, and its order.
- **+ Zone** in the Content tab adds one around the selected fixtures, or over the whole canvas.
- Projects from earlier versions open as one zone covering the whole canvas.

## Layers

The Content tab lists the zones, then the layers of the selected zone (top layer first, each with an opacity slider and an eye to hide it). Change their order as in the Patch panel: drag a layer by its grip, or use its **↑ ↓** buttons; a moved layer slides into its new place, then the selected layer's settings with a live preview above its parameters. Clicking a source plays it in the selected layer, crossfading over the Crossfade time. Each layer has its own parameters, so two layers can run the same generator with different settings.

**Speed** goes from 0 to 100 % of a generator's full speed, with **Reverse** next to it. Each layer keeps its own clock for it, so dragging the slider speeds the animation up or down smoothly instead of making it jump. (Custom ISF shaders get this too when they have a float input named `speed` used as `TIME * speed`.)

**Finding a source.** Every source is sorted along four facets, each with a dropdown under the search box:

| Facet | Values |
|---|---|
| Mood | Calm, Lively, Party |
| Use | Architectural (façades, hotels, slow changes), Ambient (bars, lounges), Show (stage and club), Utility (masks, tools) |
| Look | Fill (the whole surface one colour), Gradient, Organic (fire, water, clouds, noise), Particles (dots, stars, sparks), Lines, Radial, Geometric |
| Motion | Still, Drift (slowly evolving), Flow (moving steadily), Chase, Flash, Beat (follows a BPM) |

A **Type** dropdown (generators, your own shaders, media) appears once you have added shaders or media. Facets combine: Calm + Architectural + Drift lists the slow façade looks. Each value shows how many sources it would leave, and **Clear** resets them all.

**Search** finds sources by name, description or keyword (sky, stars, fire, bpm…); several words narrow it down. Words for a mood or use also work: smooth → Calm, disco → Party, atmospheric → Ambient. Hover over a source to see its facets and keywords.

A shader is placed by its ISF `CATEGORIES`. The built-ins list one value per facet, then keywords: `["calm","architectural","organic","drift","sky","nature"]`. Your own shaders are placed from the same values, or from common words in their categories (disco, smooth, dots, nature, strobe, bpm…).

The built-in generators include very smooth ones for architecture (**Color drift**, **Soft clouds**, **Horizon**, **Slow waves**, **Breathe**, **Gradient**, **Aurora**, **Water**), atmospheric ones (**Starfield**, **Twinkle**, **Lava lamp**, **Noise**), and disco ones (**Disco dots** and **Color hits** on a tempo in BPM, **Scanner**, **Confetti**, **Mirror ball**, **Equalizer**, **Strobe**, **Bars**, **Comet chase**, **Spiral**).

Every speed, rate and tempo slider changes how fast a pattern moves without making it jump: each layer keeps its own clock for it. A custom ISF shader gets this for a float input named `speed` used as `TIME * speed`, and for any other rate with an `OLM_CLOCKS` entry in its header: `"OLM_CLOCKS": {"phase": {"FROM": "rate", "SCALE": 1, "WRAP": 1024}}` with a float input `phase`, used instead of `TIME * rate`. The app fills `phase` with the running total of rate × SCALE and hides it from the parameters.

Sources show a still preview of each generator; hover one to see it move. A green frame marks the source in the selected layer, a green dot one playing elsewhere.

The blend mode sets how a layer combines with the layers below it:

- **Alpha** covers them, as far as its opacity (and the source's own transparency) goes.
- **Add** and **Screen** add light, so black is invisible. Use them for chases, comets and sparkles over a background.
- **Multiply** keeps what is below where the layer is white and hides it where it's black. With the **Shape mask** generator this shows the layers below only inside a circle, ring, rectangle or band.
- **Subtract**, **Lighten**, **Darken** and **Difference** work as in image editors.

Layers are mixed on the GPU, and the stage preview shows the same mix that is sent out.

## Scenes

Each zone has its own scenes. A scene stores the zone's layers: sources, parameters, blend modes and opacity. The Scenes panel has one row per zone, with the zone's opacity slider (its master) and **+ Store** on the left:

- Click a scene to fade that zone to it over the scene's fade time; other zones carry on. **Shift**-click cuts straight to it. Keys **1–9** do the same for the first nine scenes of the selected zone.
- With a zone's master at 0 you can still recall its scenes; they just don't show until you bring the master up.
- The fade crossfades the zone's picture, so any two looks fade smoothly into each other. Starting another scene in the middle of a fade continues from what the zone shows at that moment.
- **⋯** on a scene: update it with the zone's current layers, rename it, change its fade time or colour, duplicate or delete it. Drag scenes to reorder them, or onto another zone's row (even one with no scenes yet) to move them there.
- **edited** on the current scene means the layers changed since you recalled it.
- New scenes get the fade time set in the panel. Scenes are saved in the project; **Ctrl Z** undoes a delete.

## Keeping the output running

- The openLedMapper window keeps rendering when minimised or covered (see Start). While Art-Net is on, the page also holds a browser lock that stops Chrome from freezing it, and videos the browser pauses in the background are restarted.
- If the page still stops sending, the bridge repeats the last frame every half second so the LEDs hold their look. The terminal (or the app's log file) shows when that starts and when frames come back.
- Only one openLedMapper window sends at a time. Switching Art-Net on in a second window switches it off in the first.
- If the graphics driver resets (after a driver update, or when a laptop switches graphics chips), the output holds its last colours until the browser restores the GPU, then openLedMapper carries on by itself.
- On very large projects, or with a slow GPU, the stage preview is redrawn less often than the output is sent, so the Art-Net frame rate holds. The status bar shows the output frame rate.

## How addressing works

- Controller output *n* (counting from 0) starts at `first universe + n × universes per output`.
- In the Patch panel each output lists its fixtures one per row, in address order, with each one's universe and channel range. The order on an output sets the addresses: the first fixture starts at the output's first channel and each next one carries on from the previous one. To change it without dragging, use **↑ ↓** on the selected (or hovered) row, **Alt ↑ / Alt ↓**, the **Order** buttons in the Inspector's Output section (↑ Earlier, ↓ Later, To start, To end), or right-click a row. Several selected fixtures on one output move together. Dragging rows still works: drop on a row to go before it, on the output's header to go last.
- Click an output's header to fold it to one line; **Fold all / Unfold all** sit above the outputs. Selecting a patched fixture anywhere brings its row into view.
- **Skip ch 511–512** (on by default) never splits a pixel across universes: 170 RGB pixels per universe, channels 511 and 512 left empty, as nearly every pixel controller expects (the ⓘ beside it explains). Turn it off only for a controller set to continuous addressing: then all 512 channels are used. RGBW pixels fill a universe exactly (128), so nothing is skipped either way.
- The **ON** switch beside a controller's name stops or starts sending to it. The red bin deletes it, on a double-click (Ctrl Z brings it back).
- Pixels that don't fit in an output's universes are not sent. They show in red in the Patch panel and Inspector.
- Universe numbers are Art-Net 15-bit port addresses, starting at 0. The DMX Monitor also shows them as net / subnet / universe.
- **Advanced patch** (Inspector → Output, one fixture): set the universe and channel the fixture starts at, inside its output's universes, for example to leave a gap of channels on purpose. The fixtures after it on that output carry on from its last channel. A start that overlaps the fixture before it is flagged, and a set start is dropped when the fixture moves to another output.
- Every packet is a full 512-channel ArtDmx packet with a sequence number, sent unicast to the controller's IP. ArtSync is optional (Settings).
- **Frame rate** (Settings): 40 frames a second by default, up to 100. Above 44, frames come faster than a DMX line refreshes; pixel controllers take them, but some DMX nodes skip frames.
- **Master**, each fixture's **gamma** and **colour trims** (red, green, blue, and white for orders with W; Inspector → Pixels) and **RGBW white extraction** are applied to the output. Projects from before 0.5 had one trim for all fixtures: each fixture starts from it. The stage preview shows the colours before gamma. **Gamma** is per fixture (Inspector → Pixels) because LED types differ: about 2.2–2.8 suits most addressable pixels, 1 means none. Copies keep it. **Settings → Gamma for new fixtures** is the value new fixtures start from, and **Apply to all fixtures** sets it everywhere. Projects from before had one gamma for all fixtures: each fixture starts from it, so they send exactly what they did.

## SVG import

Circles, arcs, lines and paths become fixtures, fitted into the composition. Circles keep the start point and drawing direction from the SVG. Shapes drawn exactly on top of each other are imported once. The SVG can also be kept as a guide image for tracing. Set the real pixel count per fixture afterwards; select several fixtures to set them all at once.

## Videos and images

Add one with **+ Add → Image or video file…** in Sources, or drop the file on the window.

- **Formats.** Videos: MP4 or MOV with H.264, WebM (VP8, VP9 or AV1), and MKV with those codecs. Images: PNG, JPEG, GIF, WebP, AVIF, BMP. A file is tried before it is added: one that can't play is refused with the reason instead of becoming a black layer. H.265 (HEVC) and ProRes don't play: export them as H.264 MP4 or WebM. A file with only sound is refused too.
- **Timeline.** The Content tab shows the video's size and length and a timeline: the lit part is what plays, the orange line is where it is now. Click or drag on it to go to a moment.
- **Start / End** trim the video, in seconds; **Start here** and **End here** take the current moment, **Whole video** removes the trim.
- **Play: Loop** plays the (trimmed) video over and over. **Once** plays it one time; **At the end** it keeps its **Last frame** or goes **Black**. **Restart** plays it again.
- **Restart each time it is shown**: the video starts from its Start whenever a layer or a scene shows it again, rather than where it stopped.
- **Speed** from 0.1× to 4×. **Play its sound** (off by default) with **Volume**. If the browser blocks the sound until you click in the page, the video plays silent and says so.
- A video plays only while a layer shows it.

## Network notes

- **Nodes → Discover** sends ArtPoll on each network of this computer, to that network's broadcast address (2.255.255.255 for a 2.0.0.10/8 card, 192.168.1.255 for 192.168.1.20/24). The networks are listed beside the button: untick one to leave it out of scans (Wi-Fi, a venue network you shouldn't flood), and its nodes are hidden from the list. The choice is kept on this computer. **Also** takes one more address to send ArtPoll to. The table shows which network each node answered on.

- To send from a specific network card (for example a 2.x.x.x Art-Net network), use `python3 openledmapper.py --bind-ip 2.0.0.10`.
- Discovery listens on UDP 6454. If another Art-Net program is running, openLedMapper still sends, but discovery is off. The Nodes tab says so.
- **Nodes → Discover** lists one row per device (one IP), with all the universes it reported, even when it answers once per port. **Add as controller** makes one controller for it with its IP and name. Discovery can't tell how a device spreads those universes over its physical outputs (2 outputs of 3 universes, 3 of 2…), so set **Outputs** and **Unis / output** (universes per output) yourself in the Patch tab: the controller's row shows the universes the device reported (**ArtPoll U 0–5**) as a reminder. For a device that is already a controller (same IP) the button is **Refresh universes**: it updates that reminder and nothing else.
- To reach the interface from a tablet on the same network: `python3 openledmapper.py --host 0.0.0.0`.
- Other options: `--port 9000` (web port), `--no-browser`, `--bind-port 0`.

## Files

- The current project is kept in the browser automatically.
- **Project → Save project file** writes a `.openledmapper.json` you can open again later or on another computer. Files from older versions (`.weft.json` files from Weft too), or edited by hand, open with defaults for anything missing or unreadable.
- **Project → Export patch list** writes a CSV with every fixture's controller, output and start/end universe and channel, for the install crew.
- Image and video files are not stored in projects. Browsers don't keep file access between sessions, so re-link them from the Content tab.

## Examples

The `examples/` folder has files to try without building a layout (each is described in its [README](../examples/README.md)):

- **Projects** (Project ▾ → Open project…): `01-led-bars.json` (twelve vertical bars), `02-matrix-wall.json` (four 32 × 32 panels on two controllers), `03-rings-and-arcs.json` (rings, arcs, an oval), `04-stage-mixed.json` (most options together: RGBW, a turned matrix, trims, gamma, a locked spare, an advanced patch start address, blend modes).
- **An SVG layout** to import: `05-facade.svg`.
- **ISF shaders** to add as sources: `06-GradientBounce.fs` (small and commented, a starting point for your own) and `FruitOfLife_CircleChase.fs`.
- **A test video** with sound, for trim, loop or once and sound: `07-test-clip.webm`.

Their controllers have made-up 10.0.0.x addresses: set your own in the Patch panel before sending.

## Limits of this version

Art-Net only (no sACN/E1.31 yet). No Syphon, Spout or NDI: use window capture instead. Rendering lives in the openLedMapper window, so closing it stops the output. It's been tested in Chromium; Firefox and Safari should work but are less tested and don't get the keep-running switches.

## Building the apps

The apps are an [Electron](https://www.electronjs.org/) window (`desktop/`) around the interface, with the Art-Net bridge (`openledmapper.py`, packed with PyInstaller by `openledmapper.spec`) running inside: the app starts it with `--embedded` and it stops when the app quits. GitHub builds them (`.github/workflows/release.yml`) on Windows, an Apple silicon Mac and an Intel Mac. To publish a version:

1. Set `VERSION` in `openledmapper.py` (and the README title), and commit.
2. Tag it with the same version and push the tag: `git tag v0.6.0 && git push origin v0.6.0`.

The three apps are built, started once to check that they start the bridge and stop it again, and attached to a new release on the Releases page, in about 10 minutes. The app's version comes from `VERSION`; a tag that doesn't match it fails the build. To build without releasing, run **Build apps** from the Actions tab: the apps are kept as downloads of that run.

To work on the app: `cd desktop && npm install && npm start` runs it from the source, with `python3 ../openledmapper.py` as the bridge. To build it yourself: `pyinstaller openledmapper.spec` in the top folder, then `npm run dist` in `desktop/` (it lands in `desktop/dist/`).

The logo is `icons/openledmapper.svg`. The app icons made from it are `openledmapper.ico` (Windows, and the browser tab icon), `openledmapper.icns` (macOS) and `openledmapper-256.png`. If you change the SVG, export these again.

## Credits

The ISF renderer is [interactive-shader-format](https://github.com/Vidvox/interactive-shader-format-js) by VIDVOX (ISC licence), bundled as `js/vendor/isf.js`.
