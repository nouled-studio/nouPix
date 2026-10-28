# nouPix: detailed reference

Everything nouPix 1.2.2 does, in detail (the version shows next to the app name, top left). Up to 0.9 it was called openLedMapper. This is the source text for the PDF guide; the [README](../README.md) has the essentials.

A basic pixel-mapping tool: draw or import LED fixtures (lines, matrices, circles, free paths), split the canvas into zones, layer generators, ISF shaders, images, video or a screen capture in each zone, store looks as scenes to play live or in playlists, patch the fixtures to Art-Net controller outputs, and send it out.

The interface runs in your browser. `noupix.py` is a small local server that sends the Art-Net packets, because browsers cannot send UDP.

## Start

**The app (Windows and macOS).** Download it from the [Releases](https://github.com/nouled-studio/openLEDmapper/releases) page. Nothing else to install, and you don't need Chrome. It needs Windows 10 or newer, or macOS 12 (Monterey) or newer.

- **Windows:** `…-windows-setup.exe`. Run it: it installs nouPix and adds it to the Start menu and the desktop.
- **Mac:** `…-macos-apple-silicon.dmg` (Macs with an M1 or newer) or `…-macos-intel.dmg`. Open it and drag nouPix onto Applications.

The apps aren't signed yet, so the first time you open one:

- **Windows:** SmartScreen says it protected your PC. Click **More info → Run anyway**.
- **macOS:** it says the app can't be checked. Click **Done**, then open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to nouPix.

The app is one window with the Art-Net bridge inside it. It keeps running when you minimise or cover it. Closing the window quits it (it asks first while Art-Net is on), and opening the app again while it runs brings its window to the front. The bridge's messages go to `~/.noupix/noupix.log` (on Windows, `C:\Users\<you>\.noupix\noupix.log`); **Help → Show log file** opens its folder. To send from a specific network card, start the app with `--bind-ip=2.0.0.10` (the other bridge options work the same way: `--port=`, `--bind-port=`, `--host=`).

The app keeps its own copy of the current project, separate from the browser window used when running from the source. The openLedMapper app's copy carries over to nouPix the first time it starts. To move a project between them, use **Project → Save** in one and open that file in the other.

**From the source (any system, including Linux).** You need Python 3.8 or newer. Nothing else to install.

- **Windows:** double-click `start-noupix.bat`
- **macOS:** double-click `start-noupix.command` (the first time, right-click → Open)
- **Any system:** `python3 noupix.py` (add `--background` to run it without a terminal: it then stops by itself about 10 seconds after its window closes, and logs to the file above)

nouPix opens in its own window at `http://127.0.0.1:8080/`, using Chrome or Edge (or Chromium or Brave) started with the switches that stop the browser from slowing down or pausing a hidden window. You can minimise it or cover it with other windows and the output keeps running. Run from the source, keep the terminal window open: closing it stops the Art-Net output. Closing the nouPix window stops it too, which is why it asks before it closes while Art-Net is on.

The nouPix window has its own browser profile (in `~/.noupix/browser-profile`), so it doesn't share settings or storage with your normal browser. The project kept by openLedMapper (or Weft), as this app was called before, carries over: the first time, its profile folder `~/.openledmapper` (or `~/.weft`) is renamed to `~/.noupix`. If you have a project from an earlier version open in your normal browser, save it there with **Project → Save project file** and open that file in the nouPix window.

- `--default-browser` opens your normal browser instead (output can then slow down when that window is hidden).
- `--browser-path PATH` picks the browser if it isn't found automatically.

On Windows, allow nouPix (or Python) through the firewall on private networks when asked, otherwise node discovery won't receive replies.

## The look

The interface is black, so the light on the stage is the brightest thing on screen. A few colours mean the same everywhere: **red** marks what acts (the active tool, Blackout, the primary button), what you select is outlined in **white**, **white** means a light is on (Art-Net on, the scene playing, with a small red mark in its corner), **yellow** belongs to MIDI, and **aluminium** is anything you move (sliders, levels). Everything else is a grey.

- **Black or white:** the sun in the top bar (or **Settings → Interface**) turns the interface white, for daylight (the canvas stays black: it shows light; the stage around it turns white); the moon turns it black again. It is this computer's choice, not the project's, and the MIDI and Scenes windows follow it.
- **Colours of your own:** a group or a zone can be given one of eight colours (Inspector, **Colour**; the first swatch is none): a group's fixtures show it in the list and on the stage, a zone's scenes on their edge. A scene can have one too (**⋯ → Rename, fade time, colour…**): it is the small mark in the scene's corner, dim, and bright while the scene plays (red until you give it another). Nothing gets a colour unless you give it one.
- The fonts come with the app, so it looks the same without the internet.

## Workflow

1. **Settings → Composition.** Set the size of the canvas the content is rendered at. Fixture coordinates use these units.
2. **Fixtures.** Pick a tool on the stage: `L` line, `M` matrix, `C` circle/ring, `D` dot, `P` path (straight segments), `N` pen (curves). Drag to draw, or click for a default size. You can also bring fixtures in with **SVG…** (see below). Edit exact values in the Inspector, including pixel count, color order, wiring start and direction.
3. **Patch.** In the Patch panel, add a controller: IP address, number of outputs, universes per output and first universe. Then drag fixtures from the list onto an output. Fixtures chained on one output are addressed in order, automatically.
4. **Content.** Click a generator in Sources to play it in the selected layer of the selected zone. Add zones, layers, blend modes and parameters in the Content tab (see below). You can also add your own ISF shader, an image, a video, a window capture (for example Resolume's output) or an NDI or OMT stream.
5. **Scenes.** When a zone's look is right, press **+ Store** on its row in the Scenes panel. Put scenes in a **playlist** to have the zone play them one after another by itself.
6. **Art-Net** goes out from the start, every time nouPix opens (or **sACN**, if the project is set to it: see *Art-Net or sACN*). The status bar's right end shows how many packets go out each second, or what is wrong. **Settings → Art-Net / sACN → Send** switches it off (for example while another console drives the lights) and on again. **Blackout** (the slashed sun at the right of the top bar, or `B`) turns every light off at once; it breathes red until you press it again.

**Dots.** A **Dot** (`D`, or **+ Add → Dot**) is one pixel standing for a bigger light: a PAR, a wall washer, a big pixel module. Each click places one, until **Esc** or another tool. It is drawn as big as its **Size** (Inspector → Geometry, 24 by default), so it looks like the light it is, and takes the colour at its centre. It is patched as one pixel (3 channels, or 4 with white). It moves, aligns and turns with other fixtures, and keeps its size when they are resized.

**Pitch and its lock.** The pitch is the space between a fixture's pixels. A strip, circle or arc shows it under **Inspector → Pixels → Pitch**; type one, or step it with ▴ ▾ beside the field or the arrow keys in it (half a unit; **Shift** five), and the pixel count stays (the strip's end, the ring's radius or the arc's sweep moves). The padlock next to it **locks the pitch**, as on a real LED strip cut to length: the spacing then never changes and the length sets the pixel count. Drag a strip's end and it gets more or fewer pixels, the end landing on the last one; type more pixels and it gets longer along its direction. A locked ring snaps its radius so it closes evenly; a locked arc keeps its radius, and its sweep grows or shrinks with its pixels (up to 359°). Resizing several fixtures gives locked ones more or fewer pixels at their spacing, and the others spread out as before. On an oval the lock waits, unused, until it is made round again. The patch follows the new pixel counts as you drag.

**Length and angle.** A strip shows its **Length** and **Angle °** between Start and End. The angle is absolute: 0° points right and angles go clockwise. Typing one turns the strip around its start to that exact direction; typing a length moves the end along it. **Rotate** still turns by an amount (around the middle), and the Angle shows where it ends up.

**Ovals.** A circle stretches into an oval: drag the side handles of its frame on the stage, or set **Radius X** and **Y** in the Inspector (**Make it round** brings it back). Its pixels are spaced evenly along the curve, as on a real strip. Ellipses in an imported SVG become ovals.

**Pen** (`N`) draws curved strips as in Illustrator: click for a corner point, click and drag to pull out the handles of a smooth point, click the first point to close the shape, double-click or `Enter` to finish (`Backspace` removes the last point, `Esc` cancels). Pixels are spaced evenly along the curve. On a selected path, drag a handle to reshape the curve (the point's other handle turns with it; hold `Alt` to move one handle on its own), and double-click a point to switch it between smooth and corner.

With **Wiring** on, the stage also draws the data cable between fixtures chained on one output: a thin dashed line with an arrow from the last pixel of one to the first pixel of the next.

**Right-click** anything for its options: a fixture (patch it to an output, group, lock, reverse, bring to front…), the empty stage (add a fixture there, paste there), a zone, a layer, a scene, a source, a controller or a patched fixture in the Patch panel. A right-drag on the stage still pans.

**Ctrl C** / **Ctrl X** / **Ctrl V** copy, cut and paste fixtures, with their groups. They go through the system clipboard, so they also paste into another project or another nouPix window. A paste lands where the copies were, moved down and right if that place is taken; **Paste here** (right-click on the stage) puts them where you clicked. Pasted fixtures aren't patched: right-click → **Patch to**.

**Lock** (the padlock beside the Group button above the fixture list, or **Ctrl L**) locks everything selected: one fixture, several, or a whole group. Locked fixtures can't be moved, nudged, aligned or deleted, and the stage and Ctrl A skip them; a locked group shows a padlock on its row. With everything selected already locked, the same button (amber then) unlocks.

**Rotate** turns everything selected as one piece around the middle of the box around it: several fixtures, a whole group, or one. Drag the round handle above the selection on the stage (**Shift** for steps of 15°), use **Inspector → Arrange → Rotate** (90° and 15° either way, or any angle), or press **R** (90° clockwise) and **Shift R** (counter-clockwise). Lines and paths turn their points, a matrix or an oval its rotation, and a round circle its start angle, so pixel 1 moves with it. Locked fixtures stay where they are. An oval can also be turned on its own with **Rotation °** in the Inspector. The frame around the selection turns with it and keeps its size; a group keeps its frame's angle in the project.

**Resize** several fixtures, a whole group, or one circle, oval or path (pen curves included): drag one of the eight square handles on the frame around them. Each stretches from the opposite side, along the frame (so a turned group stretches along its own length); **Shift** keeps the proportions. **Inspector → Arrange → Size** sets the width and height exactly, from the middle, with **Keep proportions** on by default. Pixel counts stay as they are: the pixels spread out or move closer (a fixture with its pitch locked gets more or fewer pixels instead). A matrix or oval stretches along its own sides, and a circle stretched one way becomes an oval.

**Ctrl D** duplicates. Copies are numbered on from the original: Matrix 1 becomes Matrix 2, Matrix 10 becomes Matrix 11, skipping numbers already used; a name without a number gets 2 (Wave → Wave 2). The same goes for pasted fixtures and duplicated groups, zones and scenes. When the originals are on one output, the copies go on that output after the fixtures already there, while they fit; a copy that doesn't fit stays unpatched. When the originals are spread over several outputs (for example a group across two outputs), the copies stay unpatched: right-click → **Patch to**.

The stage bar shows the stage's options as icons: content (with its opacity), guide image, grid, snap, labels, wiring and zones; rest the mouse on one to see what it does. The guide image's opacity is in **Settings → Stage**, next to **Load guide image…**. With many pixels on screen, the stage shows the content through each pixel's circle, dimmed by its fixture's and group's dimmers, the master and blackout; zoomed in close, or while highlighting, each pixel shows exactly the colour it sends. Gamma, dimming curves and colour trims are seen on the real lights only. The status bar keeps to the frame rate, the pixels and universes, what isn't patched yet, and the pixel under the mouse.

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

- Select fixtures and press the **Group** button in the Fixtures header (`Ctrl G`); it lights up once two or more are selected, and becomes **Ungroup** when a group is selected. The group goes where the first of them is in the list. Rename it and give it a colour (it has none at first) in the Inspector; the arrow next to its name in the list folds it.
- Click a group's name in the list, or any of its fixtures on the stage, to select the whole group: it moves as one and gets a frame with its name. Double-click a fixture on the stage, or click it in the list, to select just that one.
- Drag in the list to change groups. Dropped between the fixtures of a group, a fixture joins that group there; dropped on a group's name, it joins it at the end; dropped above or below a group, or under the list, it is in no group. The drop line starts at the indent when the fixture lands inside a group.
- Drag a group by its name to move all of it, or onto an output in the Patch panel to patch all its fixtures there, in list order.
- **Ungroup** (the same button, or `Ctrl Shift G`) keeps the fixtures where they are. With one fixture selected, the Inspector's **Group** menu moves it into a group or out of one.
- **Ctrl D** on a group makes a new group of copies. **Delete** deletes its fixtures, and **Ctrl Z** brings them back. A group with no fixtures left disappears.
- **Arrange** with one group selected lines up its fixtures with each other. With several groups (and fixtures) selected, each group moves as one block, and a group with a locked fixture stays put.
- **The group's dimmer**, in the Inspector when a group is selected, dims all its fixtures at once, over each one's own dimmer and under the master. A dimmed group shows how far in the list (60%). A MIDI fader can drive it: learn it by clicking the Dimmer slider, or choose it under **Groups** in the MIDI window. It is saved in the project, and undo works on it.
- Apart from its dimmer, grouping organises the list and the selection; on its own it doesn't change the patch or the output. There is one level: a fixture is in one group at most, and groups don't go inside other groups. Groups are saved in the project.

## Zones

A zone is a rectangle of the canvas with its own layers, its own scenes and one opacity slider, its master. Content is drawn to fit the zone, so a centred effect centres on the zone. Fixture pixels inside a zone take its content; pixels outside every zone stay black.

- Zones higher in the list cover the ones below, as far as their opacity goes. New zones go underneath the others, so a big zone on top can cover everything, and lowering its opacity reveals the zones under it.
- Drag a zone in the Content tab's list, or a zone's header in the Scenes panel, to change the order.
- Draw zones with the **Zone tool** (`Z`): drag on the stage to draw one, click to select, drag a zone's label to move it and its handles to resize it, double-click to edit its layers. The Inspector shows its exact position and size, which lights it covers, **Fit to selected fixtures**, and its order.
- **+ Zone** in the Content tab adds one around the selected fixtures, or over the whole canvas.
- A zone can have a colour (Inspector, with the Zone tool): its scenes show it on their edge, here and on the phones.
- Projects from earlier versions open as one zone covering the whole canvas.

## Layers

The Content tab lists the zones, then the layers of the selected zone (top layer first, each with an opacity slider and an eye to hide it). Change their order as in the Patch panel: drag a layer by its grip, or use its **↑ ↓** buttons; a moved layer slides into its new place, then the selected layer's settings with a live preview above its parameters. Clicking a source plays it in the selected layer, crossfading over the Crossfade time. Each layer has its own parameters, so two layers can run the same generator with different settings.

**Speed** goes from 0 to 100 % of a generator's full speed, with **Reverse** next to it. Each layer keeps its own clock for it, so dragging the slider speeds the animation up or down smoothly instead of making it jump. (Custom ISF shaders get this too when they have a float input named `speed` used as `TIME * speed`.)

**Exact values.** Double-click the number next to any slider (or select it with Tab and press Enter) to type a value: Enter or a click elsewhere keeps it, Escape leaves it as it was. Percentages are typed as percentages (40 is 40 %), and a decimal comma works too. Hold **Shift** and scroll over a slider, a number box or a slider of the colour picker to change it a notch at a time, about a hundredth of its range; without Shift the panel scrolls as usual. All the notches of one scroll are one undo step. This works in every panel: parameters, opacity, dimmer, trims, gamma, settings.

**Angles.** A generator's **Angle** (Bars, Rainbow, Rain, Waves, Comet, Wipe, Scanner and others) has buttons for 0°, 45°, 90°, 135°, 180°, 225°, 270° and 315° under its slider; the one it is at is lit. Its slider moves in whole degrees, Shift + scroll in steps of 5°, and it goes round: past 360° it starts again at 5°, and a typed 450° is 90°, −45° is 315°. Any angle can be typed, 22.5° too. A custom ISF shader gets this for a float input named or labelled angle or rotation, in degrees (a range of 45° to 360°); one in radians stays a plain slider.

**Finding a source.** Every source is sorted along four facets, each with a dropdown under the search box:

| Facet | Values |
|---|---|
| Mood | Calm, Lively, Party |
| Use | Architectural (façades, hotels, slow changes), Ambient (bars, lounges), Show (stage and club), Utility (masks, tools) |
| Look | Fill (the whole surface one colour), Gradient, Organic (fire, water, clouds, noise), Particles (dots, stars, sparks), Lines, Radial, Geometric |
| Motion | Still, Drift (slowly evolving), Flow (moving steadily), Chase, Flash, Beat (follows a BPM) |

A **Type** dropdown (generators, your own shaders, media) appears once you have added shaders or media. Facets combine: Calm + Architectural + Drift lists the slow façade looks. Each value shows how many sources it would leave, and **Clear** resets them all.

**Search** finds sources by name, description or keyword (sky, stars, fire, bpm…); several words narrow it down. Words for a mood or use also work: smooth → Calm, disco → Party, atmospheric → Ambient. Hover over a source to see its facets and keywords.

To see more sources at once, drag the top edge of the Sources panel up (double-click it for the usual height); the height is kept for next time.

A shader is placed by its ISF `CATEGORIES`. The built-ins list one value per facet, then keywords: `["calm","architectural","organic","drift","sky","nature"]`. Your own shaders are placed from the same values, or from common words in their categories (disco, smooth, dots, nature, strobe, bpm…).

The built-in generators include very smooth ones for architecture (**Color drift**, **Soft clouds**, **Horizon**, **Slow waves**, **Breathe**, **Gradient**, **Aurora**, **Water**), atmospheric ones (**Starfield**, **Twinkle**, **Lava lamp**, **Noise**), and disco ones (**Disco dots** and **Color hits** on a tempo in BPM, **Scanner**, **Confetti**, **Mirror ball**, **Equalizer**, **Strobe**, **Bars**, **Comet chase**, **Spiral**). **Rainbow** and **Plasma** play every hue, or, with **Colors** set to **Color A to B**, go between two colours of your own (which follow Color 1 and Color 2).

New in 1.2.0, 21 more, all with the same **Speed**: −1 is full speed in reverse, 0 stands still, 1 is full speed; their two colours follow Color 1 and Color 2.
- **Architectural:** **Color wash** (the whole surface fading between two colours, or the fade travelling across), **Cascade** (columns lighting up one after another), **Orbit** (a gradient turning slowly), **Marble** (veins of light through stone), **Embers** (a warm, breathing glow).
- **Ambient:** **Nebula** (two coloured clouds swirling), **Caustics** (light at the bottom of a pool), **Fireflies**, **Bokeh** (soft circles drifting up).
- **Disco:** **Kaleidoscope**, **Laser fan**, **Tunnel** (rings rushing out, or in when reversed), **Chevrons**, **Lightning**, **Heartbeat**.
- **Light art:** **Turel** (a field of colour with a luminous opening), **Kusuma** (rows of small lights going on forever), **Elisun** (a huge sun in haze), **Flavine** (coloured tubes washing the wall), **Rilay** (bending bands that seem to move), **Villaray** (countless small lights in slow waves).

Every speed, rate and tempo slider changes how fast a pattern moves without making it jump: each layer keeps its own clock for it. A custom ISF shader gets this for a float input named `speed` used as `TIME * speed`, and for any other rate with an `OLM_CLOCKS` entry in its header: `"OLM_CLOCKS": {"phase": {"FROM": "rate", "SCALE": 1, "WRAP": 1024}}` with a float input `phase`, used instead of `TIME * rate`. The app fills `phase` with the running total of rate × SCALE and hides it from the parameters.

**Colours.** A colour control shows as a swatch with its hex code; click it for the colour picker. **Wheel**: hue around, saturation from the middle out, with **Intensity** below. **RGB** and **HSV**: sliders with exact values (0–255, degrees, %). Type a hex code at the top, or pick a **preset** (lighting colours such as Amber, Congo blue, Lavender, plus White and Off). Your last 8 colours are under **Recent**, for every control. The left half of the top swatch is the colour before you opened the picker: click it to go back. Each change is one undo step; Escape or a click elsewhere closes the picker, and it opens on the tab you used last.

Sources show a still preview of each generator; hover one to see it move. A white frame marks the source in the selected layer, a white dot one playing elsewhere.

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
- **The fade time** shows on each scene's button (◢ 2 s, or **cut**). Drag it sideways to change it (**Shift** for bigger steps), click it to type one, or select it and use **↑ ↓**. It works on the scene playing too, so you can try a fade and change it straight away. 0 cuts.
- **⋯** on a scene: add it to a playlist, update it with the zone's current layers, rename it, change its fade time or colour, duplicate or delete it. **Play when the project opens** (one scene per zone, marked with ⏻ on its button) plays it at once whenever the project opens, and when nouPix starts with it (see *Starting by itself*); a playlist set to play on open goes first. Drag scenes to reorder them, or onto another zone's row (even one with no scenes yet) to move them there.
- **edited** on the current scene means the layers changed since you recalled it.
- New scenes get the fade time set in **Settings → Scenes** (2 s at first). Scenes are saved in the project; **Ctrl Z** undoes a delete.
- When a zone has more scenes than fit, its row scrolls sideways (the zone stays on the left): **‹ ›** at its ends move it a few scenes at a time, and its edges fade where there are more. The same goes for a playlist's steps. Playing a scene leaves the panel where you scrolled it.
- **The X-Fader.** **X-Fader**, at the bottom left of the Scenes panel, turns it on: one fader between two zones, **A** and **B**, in the middle of the panel's bottom edge. A and B start as the first two zones; choose others in the lists next to the two previews, which show what each zone plays, even while it is faded out. Its mode is the small button next to it, which shows a graph of A's and B's levels from the fader's left to its right; click it to choose one of three: **Mix** (an X) fades A into B (left all A, the middle both at 50 %, right all B; where the two zones cover the same lights, as bright all the way, with no dip in the middle), **Dip** (a V) fades A to black by the middle and then B in, **Cut** (a step) shows A until the middle and then B. While it is on, it alone sets A's and B's levels: their own sliders are greyed, their rows say **A** and **B**, and a MIDI control mapped to their levels, or a phone, does nothing to them. Turning it off leaves the two zones at the levels it gave them. A MIDI fader can drive it (learn it by touching the fader, or choose **X-Fader** in a mapping's list), whether it is on or off. It is saved in the project, and Ctrl Z undoes turning it on or off and changing its mode. When you turn it on and A or B doesn't cover the whole canvas, nouPix suggests it, as the fade then goes from one to the other on every light: **Make both full size** does it (Ctrl Z undoes), or do it yourself with **Z** (the Zone tool): select the zone and set its area in the right panel, under Zones. For special occasions, the Remote page can show it too (Settings → Remote control → **X-Fader on the Remote page**).
- **Open in a window** (the ⧉ button, bottom right of the Scenes panel) puts the scenes and playlists in a window of their own, to put on another screen: everything works there as in the panel (its menus, dialogs and messages show in that window), keys **1–9** play the selected zone's scenes, **B** blacks out, and **Ctrl Z** undoes. Meanwhile the Scenes tab says where they are, with **Show the window** and **Back here**; **Back to the panel** in the window, or closing it, brings them back. It closes with nouPix.

**Pictures on scenes.** A scene's button can show a picture of what it plays: ⋯ → **Picture of (zone) as it looks now** takes one of its zone as it is on screen at that moment (so play the scene first), and ⋯ → **Remove its picture** takes it away. With **Settings → Scenes → Pictures on scenes** on (off by default), storing a scene, or ⋯ → **Update**, takes its picture too. Pictures are small and saved in the project.

## Playlists

A playlist plays some of a zone's scenes one after another, by itself: Evening, Party, Closing… A zone can have as many as you like; one plays at a time (a zone shows one look).

**Making one.** The playlist button on a zone's row (next to its name) opens **New playlist**: name it, tick the scenes you want and put them in order with **↑ ↓** (or **Alt ↑ ↓** on a row), as with fixtures on an output. Give each a play time and, if it should fade differently in this playlist, its own fade (left empty, it fades like the scene). Then choose the fades and what happens at the end. A zone that already has playlists shows **+ New playlist** after its tabs. A scene's **⋯ → Add to playlist** adds it to one of them, or starts a new one with it.

**On the Scenes panel.** Under a zone's scenes, one line holds its playlists as tabs, with the one playing and its time left. The tab playing is white (orange when paused), with a thin line that fills as the whole playlist plays.

- **▶ on a tab** plays that playlist from its first step (or pauses the one playing, or carries on with the paused one). Starting another playlist fades the zone over to it.
- **Click a tab** to open it: its steps, with the step playing filling up as it plays. **Click the tab again**, or **▴ Close**, to fold it back to one line; it keeps playing. The zone's playlist button opens and folds it too, and is white while a playlist plays.
- In the open playlist: previous, play/pause and next; the steps; **+ Add** to add a scene at the end (or drag a scene's button onto the playlist). Drag steps to reorder them, or select one and press **Alt ← →**.
- **A step's fade** shows on the step. Drag it sideways, click it to type one, or use **↑ ↓**, as on a scene's button: that gives the step its own fade, in this playlist only (it shows red); the scene keeps its own. Type nothing to go back to the scene's.
- **Click a step** to edit it: its scene, its **play time** (seconds, like 90, or minutes:seconds, like 1:30), its fade (**Auto** or **Its own**), **← Earlier** and **Later →**, **Play from here**, **Remove**.
- Right-click a tab, or **⋯** on the open one: play or pause, rename (or double-click the tab), duplicate, what happens at the end, play when the project opens, delete.
- The zone's right-click menu has **Playlists** too: click one to play it.

**Play time.** A step's play time counts from the moment it starts, its fade in included, until the next step starts, like a follow time on a lighting desk. So the playlist lasts the sum of its play times, and changing a fade never moves what comes after. A fade longer than its step's play time is cut short (the step shows it in orange).

**Fades.** A step fades in with its scene's own fade, unless the playlist is set to **One for all** (the same fade for each of its steps), unless the step has **its own** (set on the step, in the step editor or in the New playlist window, for the transitions that should be different). A step's own fade never changes the scene: the same scene can cut in one playlist and fade slowly in another. Each step shows the fade it will use: grey when it comes from the scene or the playlist, blue when it is its own. Picking a scene by hand always uses the scene's own fade.

**At the end** a playlist loops, stops on its last step, or plays another playlist of the zone (**Then play…**): Evening, then Party, then Closing.

**Playing.**

- Picking a scene by hand (a click, keys 1–9, a phone, an operator) pauses the zone's playlist. **▶** fades back to the step it was on and plays the rest of it.
- **Pause** stops the step's time; the zone keeps its look. Previous and next work paused too.
- Each zone plays its own playlist: the ceiling on Evening while the bar plays Happy hour.
- **Play when the project opens** (one playlist per zone) starts it as soon as the project is opened or the app starts, for installations that run by themselves. Its tab shows a small power sign.
- Playlists run on this computer's clock, also with the window in the background.
- Steps that play by themselves are not undo steps; editing playlists is. An undo while a playlist plays doesn't take the zone back to an earlier step.
- Deleting a scene takes its steps out of the playlists. Playlists are saved in the project; where they are playing is not.

## Keeping the output running

- The nouPix window keeps rendering when minimised or covered (see Start). While Art-Net is on, the page also holds a browser lock that stops Chrome from freezing it, and videos the browser pauses in the background are restarted.
- If the page still stops sending, the bridge repeats the last frame every half second so the LEDs hold their look. The terminal (or the app's log file) shows when that starts and when frames come back.
- Only one nouPix window sends at a time. A second nouPix window opened on this computer starts sending and the first one stops.
- If the graphics driver resets (after a driver update, or when a laptop switches graphics chips), the output holds its last colours until the browser restores the GPU, then nouPix carries on by itself.
- The stage preview is redrawn at most 30 times a second for moving content (60 while you drag or zoom), and less often on very large projects or with a slow GPU, so the Art-Net frame rate holds, up to 100 a second. Moving the mouse redraws it only when what is under the mouse changes. The status bar shows the output frame rate.

## How addressing works

- Controller output *n* (counting from 0) starts at `first universe + n × universes per output`.
- In the Patch panel each output lists its fixtures one per row, in address order, with each one's universe and channel range. The order on an output sets the addresses: the first fixture starts at the output's first channel and each next one carries on from the previous one. To change it without dragging, use **↑ ↓** on the selected (or hovered) row, **Alt ↑ / Alt ↓**, the **Order** buttons in the Inspector's Output section (↑ Earlier, ↓ Later, To start, To end), or right-click a row. Several selected fixtures on one output move together. Dragging rows still works: drop on a row to go before it, on the output's header to go last.
- Click an output's header to fold it to one line; **Fold all / Unfold all** sit above the outputs. Selecting a patched fixture anywhere brings its row into view.
- **Skip ch 511–512** (on by default) never splits a pixel across universes: 170 RGB pixels per universe, channels 511 and 512 left empty, as nearly every pixel controller expects (the ⓘ beside it explains). Turn it off only for a controller set to continuous addressing: then all 512 channels are used. RGBW pixels fill a universe exactly (128), so nothing is skipped either way. 16-bit pixels take twice the channels (85 RGB or 64 RGBW per universe).
- The **ON** switch beside a controller's name stops or starts sending to it. The red bin deletes it, on a double-click (Ctrl Z brings it back).
- Pixels that don't fit in an output's universes are not sent. They show in red in the Patch panel and Inspector.
- Universe numbers are Art-Net 15-bit port addresses, starting at 0. The DMX Monitor also shows them as net / subnet / universe. With sACN they are shown, typed and sent from 1 (see *Art-Net or sACN*).
- **Advanced patch** (Inspector → Output, one fixture): set the universe and channel the fixture starts at, inside its output's universes, for example to leave a gap of channels on purpose. The fixtures after it on that output carry on from its last channel. A start that overlaps the fixture before it is flagged, and a set start is dropped when the fixture moves to another output.
- Every packet is a full 512-channel ArtDmx packet with a sequence number, sent unicast to the controller's IP. ArtSync is optional (Settings).
- **Frame rate** (Settings): 40 frames a second by default, up to 100. Above 44, frames come faster than a DMX line refreshes; pixel controllers take them, but some DMX nodes skip frames.
- **Master**, each fixture's **gamma** and **colour trims** (red, green, blue, and white for orders with W; Inspector → Pixels) and **RGBW white extraction** are applied to the output. A new project starts with **Settings → White (RGBW)** on **W = min(RGB), subtract**: an RGBW pixel lights its white LED for the white in a colour, taken off red, green and blue; projects opened from a file keep their own setting. Projects from before 0.5 had one trim for all fixtures: each fixture starts from it. The stage preview shows the colours before gamma. **Gamma** is per fixture (Inspector → Pixels) because LED types differ: about 2.2–2.8 suits most addressable pixels, 1 means none. Copies keep it. **Settings → Gamma for new fixtures** is the value new fixtures start from, and **Apply to all fixtures** sets it everywhere. Projects from before had one gamma for all fixtures: each fixture starts from it, so they send exactly what they did.

## 16-bit fixtures and dimming curves

**Resolution** (Inspector → Pixels): **8-bit** sends one channel per colour, as most pixels expect. **16-bit** sends two per colour, the coarse one (the high byte) and then its fine one (the low byte): red, red fine, green, green fine, blue, blue fine. An RGB pixel then takes 6 channels, 85 to a universe (channels 511 and 512 stay empty, or carry the next pixel's red with Skip ch 511–512 off); RGBW takes 8, 64 to a universe. Use it only for fixtures and controllers set to 16-bit colour. 8-bit and 16-bit fixtures can share a project, a controller and an output: each takes the channels it needs, one after the other.

**What 16-bit adds.** The content (shaders, videos, images, the mix of layers and zones) is worked out with 8 bits per colour, 256 levels, as on any screen. What comes after it, for each pixel, is worked out exactly on a 16-bit fixture: its dimmer, trims, the master, and the dimming curve, before it is turned into 65,536 levels. That is where 8 bits fall short: with gamma 2.2, the bottom 10 % of a fade has only 3 different values at 8 bits, so slow fades and low levels step; at 16 bits it has hundreds. A fade with the master or a fixture's dimmer is smooth at 16 bits.

**Dimming curve** (16-bit fixtures; 8-bit ones use gamma): how a pixel's level becomes its output.

- **Gamma**: corrects the LEDs, with the gamma slider (2.2–2.8 for most pixels, 1 for none).
- **Linear**: the output follows the level exactly.
- **Square law**: a slow start, fine control at the low end.
- **Inverse square**: a fast start; low levels come up quickly.
- **S curve**: slow at both ends, quicker in the middle: smooth starts and finishes.

Square law, inverse square and S curve have a **Strength** slider: 100 % is the classic curve, lower brings it closer to a straight line (0 % is linear), and up to 200 % makes it stronger (the square law towards a cube, the S curve steeper). At every strength the output still rises steadily with the level. Linear has no slider.

The **graph** under the curve shows it: level in (left to right), output (bottom to top). It moves with the Gamma or Strength slider as you drag it (or type a value, or Shift + scroll), so you see the curve before you let go. **Low end** shows the first 10 %, where an 8-bit fixture draws its few steps and a 16-bit one a smooth line; under it, how many output steps that part has. A fixture saved with the tungsten curve of 0.8.0 opens with gamma. Changing a fixture back to 8-bit keeps its curve for later and uses gamma meanwhile. The DMX Monitor names each channel (R coarse, R fine…), and the patch CSV has a Bits column.

## SVG import

Circles, arcs, lines and paths become fixtures, fitted into the composition. Circles keep the start point and drawing direction from the SVG. Shapes drawn exactly on top of each other are imported once. The SVG can also be kept as a guide image for tracing. Set the real pixel count per fixture afterwards; select several fixtures to set them all at once.

## Videos and images

Add one with **+ Add → Image or video file…** in Sources, or drop the file on the window.

- **Formats.** Videos: MP4 or MOV with H.264, WebM (VP8, VP9 or AV1), and MKV with those codecs. Images: PNG, JPEG, GIF, WebP, AVIF, BMP. A file is tried before it is added: one that can't play is refused with the reason instead of becoming a black layer. H.265 (HEVC) and ProRes don't play: export them as H.264 MP4 or WebM. A file with only sound is refused too.
- **Timeline.** The Content tab shows the video's size and length and a timeline: the lit part is what plays, the orange line is where it is now. Click or drag on it to go to a moment. Drag the handles at the two ends of the lit part to trim the start and the end with the mouse; the video shows the frame you are at while you drag. (When the two handles are on top of each other, drag left to move the start, right to move the end.)
- **Restart, Play, Pause** under the timeline: Restart plays again from the Start; Play goes on from where it is (after a video played once to its end, it starts again); Pause holds the frame it is at, for now only (it isn't saved with the project).
- **Start / End** trim the video, in seconds (or drag the handles on the timeline); **Start here** and **End here** take the current moment, **Whole video** removes the trim.
- **Play: Loop** plays the (trimmed) video over and over. **Once** plays it one time; **At the end** it keeps its **Last frame** or goes **Black**. **Restart** plays it again.
- **Restart each time it is shown**: the video starts from its Start whenever a layer or a scene shows it again, rather than where it stopped.
- **Speed** from 0.1× to 4×. **Play its sound** (off by default) with **Volume**. **Volume follows its zone's level**: fading the zone (its fader, the X-Fader) or the layer fades the sound with the picture. If the browser blocks the sound until you click in the page, the video plays silent and says so.
- A video plays only while a layer shows it.

## NDI and OMT

Video from other programs and computers on the network: Resolume, TouchDesigner, OBS, vMix, NDI Tools' Screen Capture, cameras… sent with **NDI** or **OMT** (Open Media Transport, the open-source alternative). Add a stream with **+ Add → NDI or OMT stream…** in Sources: the window lists every source nouPix finds on the network (sources from other computers can take a few seconds to appear). Click one to add it; it plays in the selected layer like any other source.

- **NDI needs NDI Tools.** nouPix uses the NDI library that NDI Tools installs (free, from ndi.video) and doesn't include it. Without it, the window says so. Install NDI Tools and restart nouPix. To use a library somewhere else: `python3 noupix.py --ndi-lib /path/to/libndi.so` (or the environment variable `NOUPIX_NDI_LIB`).
- **OMT needs libomt.** Download the release of `libomtnet` from github.com/openmediatransport for your computer and put `libomt` and `libvmx` (`.dylib` on a Mac, `.dll` on Windows) in the folder `.noupix/omt` in your home folder, then restart nouPix. On a Mac, files downloaded from the internet are blocked until you run `xattr -dr com.apple.quarantine ~/.noupix/omt` in Terminal. Or name it: `--omt-lib /path/to/libomt.dylib` (or `NOUPIX_OMT_LIB`).
- **Quality.** **Light** (the default) takes the source's small preview stream (NDI's is about 640 pixels wide, OMT's 1/8 of the picture): little network and processor, and plenty for most fixtures. **Full** takes the whole picture, cut down to 1920 wide at most. Either way the picture is cut down by taking every n-th pixel, so a 4K source never costs 4K.
- **Fit** is **Stretch** by default, so an output made for the canvas (Resolume's output, a TouchDesigner window) lands on it exactly.
- **Choose source…** in the Content tab (or **Choose stream…** in the source's right-click menu) points it at another stream; layers and scenes that play it follow.
- When the source stops sending, the source shows **OFF** and nouPix keeps trying: it plays again as soon as the source is back.
- Streams are received by the bridge (`noupix.py`), on the main computer: devices on Remote control show them on the fixtures, not in their own window.

## Remote control

Phones, tablets and other computers on the same network can use nouPix too, while this computer keeps sending the Art-Net.

**Switching it on.** In **Settings → Remote control**: set a **password** for programmers, choose a **port** if 8090 is taken, and switch it **ON**. Settings then shows the address to open on the other devices (for example `http://192.168.1.20:8090/`), and so does the remote button in the top bar (the phone icon, with the number of devices connected). It switches itself on again the next time nouPix starts. On a Mac, allow nouPix to accept incoming connections if macOS asks.

**Logging in.** The address opens a page that asks who you are:

- **Programmer** (needs the password): the whole interface, as on this computer. Fixtures, patch, zones, content, scenes, settings.
- **Operator** (no password): the interface with the mapping locked. You see the fixtures, the patch and the zones, but can't move, add or delete fixtures, change the patch, the zones' areas or the settings. You can change the content: layers, sources, parameters, blend modes, zone levels, scenes (play, store, edit), playlists (play, make, edit), the master and blackout.
- **Remote** (no password): a simple page for phones, tablets or a computer. Each zone shows its name, what plays in it, a dimmer, its playlists and its scenes: tap a playlist to play it (pause, play and next are under it, with the step playing and its time left), tap a scene to play it (with its fade; it pauses the playlist), drag the dimmer to set the zone's level. It is the programmer who makes the zones, scenes and playlists; the remote only plays and dims them. When **X-Fader on the Remote page** is ticked in Settings, the X-Fader shows above the zones, saying whether it is on (it is turned on and off at the main computer only); while it is on, phones can move it between A's and B's names; A's and B's dimmers are greyed meanwhile.

**How it works.** This computer stays in charge: every change made on a device comes here, and is shared with every other device. What a device may change depends on how it logged in, checked here, not on the device. Devices never send Art-Net, and can't switch it on or off. Undo works on every device: it goes back one step of what that device has seen (on an operator's device, only the content goes back).

**The remote as an app on a phone.** The Remote page can be installed like an app: an icon on the home screen that opens without the browser's address bar.

- **Android (Chrome):** Chrome only installs pages from a secure address, and nouPix's address on your network is plain `http://`. Tell Chrome to trust it, once per phone: open `chrome://flags`, search for **Insecure origins treated as secure**, enable it, type the address from Settings (for example `http://192.168.1.20:8090`) and tap **Relaunch**. Then open the address, choose **Remote**, and use **Install** on the page or **⋮ → Install app** in Chrome. The app is called **LED Remote**.
- **Without that setting**, **⋮ → Add to Home screen** still adds an icon, but it opens in Chrome with the address bar. Tap the **full screen** button at the top of the Remote page to hide the bars; after switching to another app, the next tap brings full screen back. The Back gesture leaves it.
- **iPhone and iPad (Safari):** **Share → Add to Home Screen**.
- The app opens the address it was installed from, so give the computer a fixed address on the network (a DHCP reservation in the router), or install it again when the address changes.

**Good to know.**

- Wrong programmer passwords are slowed down, and after 8 in a row that device waits a minute. A new password logs every programmer out.
- Switching remote control off disconnects every device. If this window closes, the devices wait and carry on when it is back.
- Videos, images and screen capture play on this computer: add them here, not from a device. The guide image isn't shown on devices.
- The devices render the content too, to show it: an old phone is happier on the Remote page than with the whole interface.
- Anyone on the network can open the Operator and Remote pages. Use it on a network you trust (the show network, not public Wi-Fi).

**HTTP triggers.** Show control software (Companion, QLab), a Stream Deck or a script on the same network can play scenes and set levels with a plain GET on the remote control's address. Turn them on in the Remote control menu (the phone icon in the top bar) → **HTTP triggers…**, or in **Settings → Remote control**; remote control has to be on too. The window lists every trigger of the project with its address and a **Copy** button (**Copy all** for the whole list):

- `/trigger/scene/<zone>/<scene>` plays a scene with its fade; add `/cut` to cut to it.
- `/trigger/level/<zone>/<0–100>` sets a zone's level (not while the X-Fader drives it).
- `/trigger/master/<0–100>` sets the master.
- `/trigger/blackout/on`, `/off` or `/toggle`.
- `/trigger` lists them all.

Zones and scenes go by name, in any case (spaces as `%20`), or by id where two have the same name. Each answers in JSON: `{"ok": true, "did": "…"}`, or an error and why. Triggers do what a phone on the Remote page does, plus the master and blackout, and the phones and other devices follow. Anyone on the network can use them while they are on, as with the Remote page.

## Macros

Macros move the same kind of control in every effect at once. They are in the **MIDI window** (the MIDI button in the top bar), under the controllers, where a controller's faders are learnt onto them; their sliders work with the mouse too.

- **Speed** makes every effect faster or slower: 1× in the middle leaves them as they are, 0 stops them where they are, 2× is twice as fast. It changes smoothly, as an effect's own speed does, and it works on effects whose speed is a rate or a tempo (Strobe, Breathe, Checker, Disco dots, Color hits) too.
- **Intensity** is the level of every layer (100 % leaves them as they are). The master still comes after it.
- **Saturation** scales the saturation of the effects that have one: at 0 they are grey.
- **Color 1** and **Color 2**: tick one (or just move it) and every effect's first colour (Color 1) or second colour or background (Color 2) is that colour. The swatch shows it; the arrow opens a slider for each part of the colour, as hue, saturation and value, or as red, green and blue, which a MIDI fader can drive.
- **Shared controls** (folded): Angle, Softness, Scale, Count, Size, Width, Density and Fade. Ticked (or moved), each sets that control of every effect that has one to the same point of its own range: 50 % is the middle of each effect's range.

**They go over each effect's own values, and never change them.** Scenes keep their own settings: a scene played while Color 1 is on is in Color 1, and when Color 1 is off again each effect has its own colour back. Under an effect's control in the Content tab, a blue note says when it follows a macro ("Follows Speed (1.40×)"). While Color 1 or Color 2 is on, an effect's colour that follows it shows that colour (what goes to the lights), and moves with it, open colour picker included; a colour chosen there sets the macro. The effect's own colour comes back when the macro is off. A source's thumbnail in the Sources list keeps its own look.

**Like the master**, macros are saved in the project but are live controls: an undo leaves them where they are. Every slider of the macros can be learnt by a MIDI control (see MIDI). Devices logged in by remote control don't show the macros (yet), but they see their effect.

An effect's control follows a macro by its name: `color`, `colorA` or `tint` follow Color 1; `colorB` or `background` Color 2; `speed` (and the rates of an effect's clocks) Speed; `saturation`, `angle`, `softness`, `scale`, `count`, `size`, `width`, `density` and `decay` the macro of that name. Your own ISF shaders follow by the same names. For Speed, a shader's `speed` must move it through `TIME * speed`, as the built-in ones do.

**Choosing what an effect follows.** At the end of an effect's Parameters (in the Content tab), **Macros it follows** says how many of its controls follow a macro. Click it to open a list: each control that can follow one, with what it follows. Choose **Its own value** to take that control out of its macro (Plasma's speed stays where it is while Speed doubles the others), or another macro: a colour can follow Color 1 or Color 2, a speed only Speed, another number Saturation or one of the shared controls (Plasma's hue range can follow Width). A row you changed is blue; **As their names say** puts them all back. The choice is for that effect wherever it plays, is saved in the project, and undo works on it. An operator can see it but not change it.

## MIDI

A MIDI controller (faders, knobs, buttons, pads: a nanoKONTROL, an APC, a Launchpad…) can play the project: the master, blackout, the X-Fader, each zone's level, its scenes and its playlists, the macros, and any control of an effect.

**Turning it on.** The MIDI button in the top bar (three faders, next to the remote button) turns MIDI on and opens the **MIDI window**: a window of its own, big, to put beside the main one or on another screen. The browser may ask once whether nouPix can use your MIDI devices: allow it. MIDI stays on the next time nouPix starts; **Turn off** in the MIDI window stops it. The MIDI window closes with nouPix; the MIDI button opens it again, or brings it to the front, also when it is minimised or behind the main window. In the app, **Window → MIDI window** (`Ctrl Shift M`, `⌘⇧M` on a Mac) and **Window → Scenes window** do the same. MIDI works in Chrome, Edge and the nouPix app (Safari and Firefox have no MIDI).

**Learning.** Press **Learn** in the MIDI window. A bar at the top of the main window says what to do, and everything a control can drive is outlined in yellow, in both windows:

1. Move a fader or a knob, or press a pad, on your controller.
2. It shows at the top of the mappings, marked **new**, with a list: choose what it should move there. Or click what it should move: a **macro**'s slider in the MIDI window (Speed, Intensity, a part of Color 1…), or in the main window the **Master** slider, **Blackout**, a group's **Dimmer** (in the Inspector), a zone's level slider (in the Scenes panel, the Content tab or the Inspector), a **scene**, a **playlist's tab**, or a **control of an effect** in the Content tab's Parameters (a slider, a tick, a list, a Trigger button).

Or the other way round: click something first, then move the control. Clicking while learning only picks: the scene doesn't play and the slider doesn't move. Once a control is learnt it is done: letting go of a button, or the rest of a fader's move, doesn't start it again, so the next click waits for a new control. It already plays what it was learnt onto, so you can try it at once; the other controls learn instead of playing until learning stops. Learn stays on for the next one; **Esc** or **Stop learning** ends it.

A control can drive several things: to learn the same control onto a second thing, click that thing first, then move the control. It then does that as well, and the message says so; with **Alt** held on the click it does only that (its other mappings go). Learning a control onto something another control already drives replaces that control; to have two controls on the same thing, choose it in the second one's list in the MIDI window.

**What each does.**

- **Master**, **the X-Fader** and **a zone's level** follow a fader or knob (a zone's level does nothing while the X-Fader sets it). With **Pickup** (the default), the value waits until the fader reaches it (or passes it), so nothing jumps when you touch a fader that was somewhere else; until then its row in the list shows a white mark where it has to go. With **Jump** it goes where the fader is at once. A pad on a level (or on the master, the X-Fader, a macro): with **Toggle** each press turns it full on, then off; with **Hold** it is full while held.
- **Blackout**, **a playlist** and an effect's tick are on or off: with **Toggle**, each press turns it over (a playlist plays, then pauses); with **Hold**, it is on while the pad is held. A fader or knob learnt onto one of them starts on **Follow** (Hold, for a control that sends values in between): on while it is past the middle. A button that only sends on and off starts on Toggle.
- **Flash**, for a pad (or a button) on anything: while it is held, what it drives is on, and when you let go it goes back to how it was. A scene plays while held, with its own fade, and when you let go the zone goes back to what it played before (its scene, its layers as they were, or the playlist carrying on), over the same fade. A level, the master or the X-Fader go full while held and back where they were; Blackout or a playlist is on while held and back as it was. Choose it in the mapping's row (a scene: **Press** or **Flash**), or in the patch bay on its wire. Handy for a strobe scene kept under one pad.
- **A scene** plays on each press, with its own fade, and pauses the zone's playlist, as a click does. **Next scene** (chosen from a mapping's list) plays the zone's next scene, back to the first after the last.
- **A control of an effect** moves in every layer that plays that effect now, in every zone, and its slider in the Content tab moves with it. A speed goes from still to full, keeping its direction; a list steps through its choices; a Trigger button plays on a press. A scene played afterwards brings its own value back, and a fader on Pickup waits until it gets there again. Colours are driven through Color 1 and Color 2 (see Macros). A control of an effect that isn't playing does nothing until it plays.

**The MIDI window.** Along the top: **Learn** and what to do next, how many controllers are plugged in, and **Turn off**. On the left, your controllers, each with a light that blinks with its messages and a tick to ignore it, and under them the macros (see Macros). In the middle, the mappings: each control, what it drives (a list: Master, Blackout, the X-Fader, the macros, a zone's level, a scene, the next scene or a playlist, and the controls of the effects in the project), Pickup or Jump (Toggle, Hold or Follow, and Flash; a scene Press or Flash), where the control is, and **×** to remove it (**⌘Z** brings it back). The list stays where you scrolled it while messages come in. On the right, the **Monitor** (click its name to open it): every message, with what it moved. **Esc** stops learning and **⌘Z** undoes, in the MIDI window too.

**The patch bay.** **List** and **Patch bay**, at the top of the MIDI window, switch between two views of the same mappings. The patch bay shows them as wires: your mapped controls on the left (with where each one is; while learning, the control just moved too), what they can drive in the middle (Master and Blackout, the zones with their scenes and playlists, the macros), and the controls of your effects on the right. Each wire is a mapping; it glows while its control moves, and fades out once it stops. Click a wire to see its settings (Pickup or Jump; Toggle, and Hold or Follow) and to **Remove** it (or press **Delete**); click elsewhere to let it go. Zones and effects fold: a wire to a scene of a folded zone is dashed and ends at the zone, and an effect shows its mapped controls even when folded. Each row moves what it drives with the mouse too, and Learn works here as everywhere: move a control, then click a row (or the other way round). The arrow of a group only opens it, while learning too; **Color 1** and **Color 2**'s own rows learn their first part (Hue, or Red in RGB), and their swatches follow the colour live. An effect's control that follows a macro which is changing it shows a white mark where the macro takes it; its slider keeps the control's own value, which is what it sets. Drag a control up or down to put it in another place (the list follows the same order, and the project keeps it); **×** on a control forgets it and its mappings, until it moves again. **Drawing wires.** Drag from a control's dot (on its right) to a row, and it drives that row; or from a row's dot (on its left) to a control. A line follows the pointer and turns green over a row it fits. Another control on the same thing stays (Learn replaces it instead).

**The macros' aluminium wires.** A macro's row says how many effect controls follow it (→ 11). Point at it and aluminium wires go from it to each of them; click its name to keep them drawn (Esc lets it go); point at an effect's control to see the one it follows. An effect's controls show the macro they follow in blue, colours included. Click a blue wire to choose what that control follows, or **Remove** it (Delete): that control keeps its own value. Drag from a macro's right-hand dot to an effect's control (or from the control's dot to the macro) to make it follow; one that can't follow that macro (a colour can follow Color 1 or 2, a speed only Speed) says so. It is the same choice as **Macros it follows** in the Content tab, for that effect wherever it plays.

**The virtual controller.** At the bottom of the MIDI window, **Virtual controller** opens a controller on screen, to try MIDI without one: 8 faders (CC 21 to 28) and 8 pads (notes 36 to 43; keys **1** to **8** play them while the MIDI window is in front). It is listed with your controllers and learnt like them, and it works even where the browser has no MIDI. Under each fader and pad is what it drives. Click its name again to fold it away.

**On the sliders.** A slider a fader drives keeps its colour and gets a thin yellow line where the fader is: faint until the slider has been picked up, bright once it follows. While the MIDI window is open, or while learning, each slider, scene, playlist and Blackout a control drives shows the control's name in yellow (CC 21, Note 36).

**Good to know.**

- The mappings are saved in the project, and undo works on them. Whether MIDI is on, and which controllers are ignored, belong to this computer.
- Controllers are found by their name: plug them in or out at any time. A mapping learnt on a controller that isn't plugged in also answers the same control on another port, so a project made on a Mac works with the same controller on Windows, where its name is different.
- A mapping to a scene, playlist, zone or shader that has been deleted shows as **Missing** and does nothing. Point it at something else, or remove it.
- MIDI is read on this computer only: devices logged in by remote control don't listen to it. On Windows a MIDI port works in one program at a time: close it in other programs first.

## Art-Net or sACN

**Settings → Art-Net / sACN → Protocol** chooses what goes out: **Art-Net** (the default, and what every project opened from before uses) or **sACN** (ANSI E1.31, also called streaming ACN). One protocol at a time, for the whole project; the choice is saved with it, and undo takes it back.

- **Universe numbers.** sACN counts universes from 1, Art-Net from 0. With sACN every universe is shown as sACN counts it: the first universe, 0 in Art-Net, is sACN universe 1, the next is 2, and so on. The Patch panel, **First uni** (typed from 1), the menus, the Inspector, the DMX Monitor and the CSV all use these numbers, and they are the numbers on the wire. Switching protocol never moves the patch: only the numbers shown change by one. Controllers that speak both protocols usually count the same way (Art-Net 0 = sACN 1).
- **Priority** (0 to 200, 100 by default): a receiver that gets the same universe from two sources takes the higher priority. Give a lighting desk a higher one to let it take over.
- **Send to: Unicast** sends each universe to its controller's IP address, as Art-Net does. **Multicast** sends each universe to its multicast group (239.255.0.1 for universe 1, 239.255.0.2 for 2…), which any receiver on the network can join. With multicast a universe is one for the whole network, so two controllers using the same universe are flagged as a clash.
- Every packet is a full 512-channel E1.31 packet with a sequence number per universe, the source name *nouPix* and this computer's name, and the same source ID (CID) every time. Every 10 seconds nouPix also lists the universes it sends on the sACN discovery group, which tools like sACNView show.
- When nouPix stops sending a universe (output switched off, back to Art-Net, the window closed, a universe unpatched), it sends the three *stream terminated* packets E1.31 asks for, so receivers let go at once instead of after 2.5 seconds.
- **Nodes → Discover** still uses Art-Net's ArtPoll: sACN has no way to find controllers, and most sACN controllers also answer ArtPoll. The universes a node reports are Art-Net's (the table says so); **Add as controller** turns them into the same patch.
- ArtSync is Art-Net's: with sACN it doesn't apply, and its setting is hidden.

## Network notes

- **Nodes → Discover** sends ArtPoll on each network of this computer, to that network's broadcast address (2.255.255.255 for a 2.0.0.10/8 card, 192.168.1.255 for 192.168.1.20/24). The networks are listed beside the button: untick one to leave it out of scans (Wi-Fi, a venue network you shouldn't flood), and its nodes are hidden from the list. The choice is kept on this computer. **Also** takes one more address to send ArtPoll to. The table shows which network each node answered on.

- To send from a specific network card (for example a 2.x.x.x Art-Net network), use `python3 noupix.py --bind-ip 2.0.0.10`.
- Discovery listens on UDP 6454. If another Art-Net program is running, nouPix still sends, but discovery is off. The Nodes tab says so.
- **Nodes → Discover** lists one row per device (one IP), with all the universes it reported, even when it answers once per port. **Add as controller** makes one controller for it with its IP and name. Discovery can't tell how a device spreads those universes over its physical outputs (2 outputs of 3 universes, 3 of 2…), so set **Outputs** and **Unis / output** (universes per output) yourself in the Patch tab: the controller's row shows the universes the device reported (**ArtPoll U 0–5**) as a reminder. For a device that is already a controller (same IP) the button is **Refresh universes**: it updates that reminder and nothing else.
- To reach the interface from a tablet on the same network: `python3 noupix.py --host 0.0.0.0`.
- Other options: `--port 9000` (web port), `--no-browser`, `--bind-port 0`.

## New versions

Every time it starts, and once a day while it keeps running, nouPix asks GitHub for its latest release. If there is a newer version, a window says so, with what's new: **Download** opens the latest release's page (download the file for your computer and install it over this one; your projects and settings stay), **Later** tells you again the next time nouPix starts (or tomorrow), and **Skip this version** doesn't tell you of that one again. Nothing is installed by itself, and without internet nothing is said. **Settings → Updates** turns it off, and **Check now** looks straight away. Only the main computer looks; phones and other devices don't.

## Files

- The current project is kept in the browser automatically.
- **Project → Save** (`Ctrl S`, `⌘S` on a Mac) writes the project to a `.noupix` file you can open again later or on another computer. The first time it asks where; after that it writes over the same file without asking. **Save as…** (`Ctrl Shift S`) always asks, for a copy under another name. **Project → Autosave** (on or off, kept on this computer) writes every change to that file a moment later. Saving over the same file, and autosave, work in the app and in Chrome or Edge; other browsers download a copy each time. In the app, a project saved, or opened by a double-click, is written back to its file by `Ctrl S` without asking. A `.noupix` file is JSON inside: older `.json` and `.noupix.json` files open too. Files from older versions (`.openledmapper.json` files from openLedMapper and `.weft.json` files from Weft too), or edited by hand, open with defaults for anything missing or unreadable.
- **In the desktop app**, project files (`.noupix`) and packages (`.noupixpkg`) have their own icons on Mac and Windows, and double-clicking one opens it in nouPix (in the window already open, if there is one).
- **The project's name is its file's.** Saved as `name2.noupix` (Save as…), the project is called name2, in the top bar and in the file; a file opened takes the file's name. Saving under the name nouPix suggests keeps the name as it is.
- **Project → Export patch list** writes a CSV with every fixture's controller, output and start/end universe and channel, for the install crew.
- **The media library.** Images and videos you add are copied once into nouPix's media library (`.noupix/media` in your home folder) and play from there, so a project opens with them on this computer every time, without relinking. The same file added twice is kept once. **Settings → Media library** shows its size, and **Remove what this project doesn't use…** frees the space (other projects that used those files then ask to relink them; your original files aren't touched). This needs nouPix started from `noupix.py` or the app; a page opened straight from disk asks to relink each session, as before.
- **Project → Export package…** writes one file, `name.noupixpkg`, with the project and its images and videos, to take it to another computer. Before writing it shows what goes in, each file's size and the total, and names any file that isn't in the library (relink it first). Shaders and the guide image are inside the project anyway. **Open project…** (or dropping it on the window) opens a package too: its media go into that computer's library and the project opens with them, playing. Save then writes a plain `.noupix` (it asks where).
- Projects made before 1.2.0 ask to relink their files once; relinked, they go into the library.

## Starting by itself

For a computer that starts nouPix by itself and plays without anyone at it (a show computer, a Raspberry Pi in an installation):

- **Settings → Startup → Open this project when nouPix starts.** nouPix keeps a copy of the project (in `.noupix/startup.noupix` in your home folder) and opens it in the first window after it starts. Changes to it are kept as you work. Unticking it, or ticking it on another project, changes which one opens.
- In that project, choose what plays: a scene per zone with **⋯ → Play when the project opens**, or a playlist with **Play on open**. Without one, each zone shows the layers it had when the project was last changed.
- From a start-up script: `python3 noupix.py --project /path/to/show.noupix` opens that file instead (and `--background` runs it without a terminal).

## Examples

The `examples/` folder has files to try without building a layout (each is described in its [README](../examples/README.md)):

- **Projects** (Project ▾ → Open project…): `01-led-bars.json` (twelve vertical bars), `02-matrix-wall.json` (four 32 × 32 panels on two controllers), `03-rings-and-arcs.json` (rings, arcs, an oval), `04-stage-mixed.json` (most options together: RGBW, a turned matrix, trims, gamma, 16-bit rings with the square-law and a steeper S curve, a locked spare, an advanced patch start address, blend modes).
- **An SVG layout** to import: `05-facade.svg`.
- **An ISF shader** to add as a source: `06-GradientBounce.fs` (small and commented, a starting point for your own).
- **A test video** with sound, for trim, loop or once and sound: `07-test-clip.webm`.

Their controllers have made-up 10.0.0.x addresses: set your own in the Patch panel before sending.

## Limits of this version

One protocol at a time: Art-Net or sACN, for the whole project. No Syphon or Spout: use NDI or OMT, or window capture, instead. Rendering lives in the nouPix window, so closing it stops the output. It's been tested in Chromium; Firefox and Safari should work but are less tested and don't get the keep-running switches.

## Building the apps

The apps are an [Electron](https://www.electronjs.org/) window (`desktop/`) around the interface, with the Art-Net bridge (`noupix.py`, packed with PyInstaller by `noupix.spec`) running inside: the app starts it with `--embedded` and it stops when the app quits. GitHub builds them (`.github/workflows/release.yml`) on Windows, an Apple silicon Mac and an Intel Mac. To publish a version:

1. Set `VERSION` in `noupix.py` (and the README title), and commit.
2. Tag it with the same version and push the tag: `git tag v1.0.0 && git push origin v1.0.0`.

The three apps are built, started once to check that they start the bridge and stop it again, and attached to a new release on the Releases page, in about 10 minutes. The app's version comes from `VERSION`; a tag that doesn't match it fails the build. To build without releasing, run **Build apps** from the Actions tab: the apps are kept as downloads of that run.

To work on the app: `cd desktop && npm install && npm start` runs it from the source, with `python3 ../noupix.py` as the bridge. To build it yourself: `pyinstaller noupix.spec` in the top folder, then `npm run dist` in `desktop/` (it lands in `desktop/dist/`).

The logo is `icons/noupix.svg` (with its smaller cuts `noupix-small.svg`, `noupix-32.svg` and `noupix-favicon.svg`, and the wordmark `noupix-wordmark*.svg`); [brand.md](brand.md) describes it and the look. The app icons made from it are `noupix.ico` (Windows), `noupix.icns` (macOS), `noupix-256.png` and the phone app's `remote-*.png`. If you change the SVG, export these again.

## Licence and credits

nouPix is © 2026 nouled studio, under the GNU Affero General Public License 3.0 (`LICENSE`): you may use it, change it, share it and sell it; whoever passes it on, or lets others use a changed copy over the network, gives them its full source under the same licence.

The fonts are Saira (Omnibus-Type), Chakra Petch (Cadson Demak) and JetBrains Mono (JetBrains), under the SIL Open Font License (`css/OFL.txt`). The ISF renderer is [interactive-shader-format](https://github.com/Vidvox/interactive-shader-format-js) by VIDVOX (ISC licence), bundled as `js/vendor/isf.js`.
