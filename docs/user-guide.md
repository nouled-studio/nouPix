# openLedMapper: detailed reference

Everything openLedMapper 0.8.3 does, in detail (the version shows next to the app name, top left). This is the source text for the PDF guide; the [README](../README.md) has the essentials.

A basic pixel-mapping tool: draw or import LED fixtures (lines, matrices, circles, free paths), split the canvas into zones, layer generators, ISF shaders, images, video or a screen capture in each zone, store looks as scenes to play live or in playlists, patch the fixtures to Art-Net controller outputs, and send it out.

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
5. **Scenes.** When a zone's look is right, press **+ Store** on its row in the Scenes panel. Put scenes in a **playlist** to have the zone play them one after another by itself.
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

A shader is placed by its ISF `CATEGORIES`. The built-ins list one value per facet, then keywords: `["calm","architectural","organic","drift","sky","nature"]`. Your own shaders are placed from the same values, or from common words in their categories (disco, smooth, dots, nature, strobe, bpm…).

The built-in generators include very smooth ones for architecture (**Color drift**, **Soft clouds**, **Horizon**, **Slow waves**, **Breathe**, **Gradient**, **Aurora**, **Water**), atmospheric ones (**Starfield**, **Twinkle**, **Lava lamp**, **Noise**), and disco ones (**Disco dots** and **Color hits** on a tempo in BPM, **Scanner**, **Confetti**, **Mirror ball**, **Equalizer**, **Strobe**, **Bars**, **Comet chase**, **Spiral**).

Every speed, rate and tempo slider changes how fast a pattern moves without making it jump: each layer keeps its own clock for it. A custom ISF shader gets this for a float input named `speed` used as `TIME * speed`, and for any other rate with an `OLM_CLOCKS` entry in its header: `"OLM_CLOCKS": {"phase": {"FROM": "rate", "SCALE": 1, "WRAP": 1024}}` with a float input `phase`, used instead of `TIME * rate`. The app fills `phase` with the running total of rate × SCALE and hides it from the parameters.

**Colours.** A colour control shows as a swatch with its hex code; click it for the colour picker. **Wheel**: hue around, saturation from the middle out, with **Intensity** below. **RGB** and **HSV**: sliders with exact values (0–255, degrees, %). Type a hex code at the top, or pick a **preset** (lighting colours such as Amber, Congo blue, Lavender, plus White and Off). Your last 8 colours are under **Recent**, for every control. The left half of the top swatch is the colour before you opened the picker: click it to go back. Each change is one undo step; Escape or a click elsewhere closes the picker, and it opens on the tab you used last.

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
- **The fade time** shows on each scene's button (◢ 2 s, or **cut**). Drag it sideways to change it (**Shift** for bigger steps), click it to type one, or select it and use **↑ ↓**. It works on the scene playing too, so you can try a fade and change it straight away. 0 cuts.
- **⋯** on a scene: add it to a playlist, update it with the zone's current layers, rename it, change its fade time or colour, duplicate or delete it. Drag scenes to reorder them, or onto another zone's row (even one with no scenes yet) to move them there.
- **edited** on the current scene means the layers changed since you recalled it.
- New scenes get the fade time set in the panel. Scenes are saved in the project; **Ctrl Z** undoes a delete.

## Playlists

A playlist plays some of a zone's scenes one after another, by itself: Evening, Party, Closing… A zone can have as many as you like; one plays at a time (a zone shows one look).

**Making one.** The playlist button on a zone's row (next to its name) opens **New playlist**: name it, tick the scenes you want and put them in order with **↑ ↓** (or **Alt ↑ ↓** on a row), as with fixtures on an output. Give each a play time and, if it should fade differently in this playlist, its own fade (left empty, it fades like the scene). Then choose the fades and what happens at the end. A zone that already has playlists shows **+ New playlist** after its tabs. A scene's **⋯ → Add to playlist** adds it to one of them, or starts a new one with it.

**On the Scenes panel.** Under a zone's scenes, one line holds its playlists as tabs, with the one playing and its time left. The tab playing is green (orange when paused), with a thin line that fills as the whole playlist plays.

- **▶ on a tab** plays that playlist from its first step (or pauses the one playing, or carries on with the paused one). Starting another playlist fades the zone over to it.
- **Click a tab** to open it: its steps, with the step playing filling up as it plays. **Click the tab again**, or **▴ Close**, to fold it back to one line; it keeps playing. The zone's playlist button opens and folds it too, and is green while a playlist plays.
- In the open playlist: previous, play/pause and next; the steps; **+ Add** to add a scene at the end (or drag a scene's button onto the playlist). Drag steps to reorder them, or select one and press **Alt ← →**.
- **A step's fade** shows on the step. Drag it sideways, click it to type one, or use **↑ ↓**, as on a scene's button: that gives the step its own fade, in this playlist only (it shows blue); the scene keeps its own. Type nothing to go back to the scene's.
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

- The openLedMapper window keeps rendering when minimised or covered (see Start). While Art-Net is on, the page also holds a browser lock that stops Chrome from freezing it, and videos the browser pauses in the background are restarted.
- If the page still stops sending, the bridge repeats the last frame every half second so the LEDs hold their look. The terminal (or the app's log file) shows when that starts and when frames come back.
- Only one openLedMapper window sends at a time. Switching Art-Net on in a second window switches it off in the first.
- If the graphics driver resets (after a driver update, or when a laptop switches graphics chips), the output holds its last colours until the browser restores the GPU, then openLedMapper carries on by itself.
- On very large projects, or with a slow GPU, the stage preview is redrawn less often than the output is sent, so the Art-Net frame rate holds. The status bar shows the output frame rate.

## How addressing works

- Controller output *n* (counting from 0) starts at `first universe + n × universes per output`.
- In the Patch panel each output lists its fixtures one per row, in address order, with each one's universe and channel range. The order on an output sets the addresses: the first fixture starts at the output's first channel and each next one carries on from the previous one. To change it without dragging, use **↑ ↓** on the selected (or hovered) row, **Alt ↑ / Alt ↓**, the **Order** buttons in the Inspector's Output section (↑ Earlier, ↓ Later, To start, To end), or right-click a row. Several selected fixtures on one output move together. Dragging rows still works: drop on a row to go before it, on the output's header to go last.
- Click an output's header to fold it to one line; **Fold all / Unfold all** sit above the outputs. Selecting a patched fixture anywhere brings its row into view.
- **Skip ch 511–512** (on by default) never splits a pixel across universes: 170 RGB pixels per universe, channels 511 and 512 left empty, as nearly every pixel controller expects (the ⓘ beside it explains). Turn it off only for a controller set to continuous addressing: then all 512 channels are used. RGBW pixels fill a universe exactly (128), so nothing is skipped either way. 16-bit pixels take twice the channels (85 RGB or 64 RGBW per universe).
- The **ON** switch beside a controller's name stops or starts sending to it. The red bin deletes it, on a double-click (Ctrl Z brings it back).
- Pixels that don't fit in an output's universes are not sent. They show in red in the Patch panel and Inspector.
- Universe numbers are Art-Net 15-bit port addresses, starting at 0. The DMX Monitor also shows them as net / subnet / universe.
- **Advanced patch** (Inspector → Output, one fixture): set the universe and channel the fixture starts at, inside its output's universes, for example to leave a gap of channels on purpose. The fixtures after it on that output carry on from its last channel. A start that overlaps the fixture before it is flagged, and a set start is dropped when the fixture moves to another output.
- Every packet is a full 512-channel ArtDmx packet with a sequence number, sent unicast to the controller's IP. ArtSync is optional (Settings).
- **Frame rate** (Settings): 40 frames a second by default, up to 100. Above 44, frames come faster than a DMX line refreshes; pixel controllers take them, but some DMX nodes skip frames.
- **Master**, each fixture's **gamma** and **colour trims** (red, green, blue, and white for orders with W; Inspector → Pixels) and **RGBW white extraction** are applied to the output. Projects from before 0.5 had one trim for all fixtures: each fixture starts from it. The stage preview shows the colours before gamma. **Gamma** is per fixture (Inspector → Pixels) because LED types differ: about 2.2–2.8 suits most addressable pixels, 1 means none. Copies keep it. **Settings → Gamma for new fixtures** is the value new fixtures start from, and **Apply to all fixtures** sets it everywhere. Projects from before had one gamma for all fixtures: each fixture starts from it, so they send exactly what they did.

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
- **Speed** from 0.1× to 4×. **Play its sound** (off by default) with **Volume**. If the browser blocks the sound until you click in the page, the video plays silent and says so.
- A video plays only while a layer shows it.

## Remote control

Phones, tablets and other computers on the same network can use openLedMapper too, while this computer keeps sending the Art-Net.

**Switching it on.** In **Settings → Remote control**: set a **password** for programmers, choose a **port** if 8090 is taken, and switch it **ON**. Settings then shows the address to open on the other devices (for example `http://192.168.1.20:8090/`), and so does the remote button in the top bar (the phone icon, with the number of devices connected). It switches itself on again the next time openLedMapper starts. On a Mac, allow openLedMapper to accept incoming connections if macOS asks.

**Logging in.** The address opens a page that asks who you are:

- **Programmer** (needs the password): the whole interface, as on this computer. Fixtures, patch, zones, content, scenes, settings.
- **Operator** (no password): the interface with the mapping locked. You see the fixtures, the patch and the zones, but can't move, add or delete fixtures, change the patch, the zones' areas or the settings. You can change the content: layers, sources, parameters, blend modes, zone levels, scenes (play, store, edit), playlists (play, make, edit), the master and blackout.
- **Remote** (no password): a simple page for phones, tablets or a computer. Each zone shows its name, what plays in it, a dimmer, its playlists and its scenes: tap a playlist to play it (pause, play and next are under it, with the step playing and its time left), tap a scene to play it (with its fade; it pauses the playlist), drag the dimmer to set the zone's level. It is the programmer who makes the zones, scenes and playlists; the remote only plays and dims them.

**How it works.** This computer stays in charge: every change made on a device comes here, and is shared with every other device. What a device may change depends on how it logged in, checked here, not on the device. Devices never send Art-Net, and can't switch it on or off. Undo works on every device: it goes back one step of what that device has seen (on an operator's device, only the content goes back).

**The remote as an app on a phone.** The Remote page can be installed like an app: an icon on the home screen that opens without the browser's address bar.

- **Android (Chrome):** Chrome only installs pages from a secure address, and openLedMapper's address on your network is plain `http://`. Tell Chrome to trust it, once per phone: open `chrome://flags`, search for **Insecure origins treated as secure**, enable it, type the address from Settings (for example `http://192.168.1.20:8090`) and tap **Relaunch**. Then open the address, choose **Remote**, and use **Install** on the page or **⋮ → Install app** in Chrome. The app is called **LED Remote**.
- **Without that setting**, **⋮ → Add to Home screen** still adds an icon, but it opens in Chrome with the address bar. Tap the **full screen** button at the top of the Remote page to hide the bars; after switching to another app, the next tap brings full screen back. The Back gesture leaves it.
- **iPhone and iPad (Safari):** **Share → Add to Home Screen**.
- The app opens the address it was installed from, so give the computer a fixed address on the network (a DHCP reservation in the router), or install it again when the address changes.

**Good to know.**

- Wrong programmer passwords are slowed down, and after 8 in a row that device waits a minute. A new password logs every programmer out.
- Switching remote control off disconnects every device. If this window closes, the devices wait and carry on when it is back.
- Videos, images and screen capture play on this computer: add them here, not from a device. The guide image isn't shown on devices.
- The devices render the content too, to show it: an old phone is happier on the Remote page than with the whole interface.
- Anyone on the network can open the Operator and Remote pages. Use it on a network you trust (the show network, not public Wi-Fi).

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

- **Projects** (Project ▾ → Open project…): `01-led-bars.json` (twelve vertical bars), `02-matrix-wall.json` (four 32 × 32 panels on two controllers), `03-rings-and-arcs.json` (rings, arcs, an oval), `04-stage-mixed.json` (most options together: RGBW, a turned matrix, trims, gamma, 16-bit rings with the square-law and a steeper S curve, a locked spare, an advanced patch start address, blend modes).
- **An SVG layout** to import: `05-facade.svg`.
- **An ISF shader** to add as a source: `06-GradientBounce.fs` (small and commented, a starting point for your own).
- **A test video** with sound, for trim, loop or once and sound: `07-test-clip.webm`.

Their controllers have made-up 10.0.0.x addresses: set your own in the Patch panel before sending.

## Limits of this version

Art-Net only (no sACN/E1.31 yet). No Syphon, Spout or NDI: use window capture instead. Rendering lives in the openLedMapper window, so closing it stops the output. It's been tested in Chromium; Firefox and Safari should work but are less tested and don't get the keep-running switches.

## Building the apps

The apps are an [Electron](https://www.electronjs.org/) window (`desktop/`) around the interface, with the Art-Net bridge (`openledmapper.py`, packed with PyInstaller by `openledmapper.spec`) running inside: the app starts it with `--embedded` and it stops when the app quits. GitHub builds them (`.github/workflows/release.yml`) on Windows, an Apple silicon Mac and an Intel Mac. To publish a version:

1. Set `VERSION` in `openledmapper.py` (and the README title), and commit.
2. Tag it with the same version and push the tag: `git tag v0.8.3 && git push origin v0.8.3`.

The three apps are built, started once to check that they start the bridge and stop it again, and attached to a new release on the Releases page, in about 10 minutes. The app's version comes from `VERSION`; a tag that doesn't match it fails the build. To build without releasing, run **Build apps** from the Actions tab: the apps are kept as downloads of that run.

To work on the app: `cd desktop && npm install && npm start` runs it from the source, with `python3 ../openledmapper.py` as the bridge. To build it yourself: `pyinstaller openledmapper.spec` in the top folder, then `npm run dist` in `desktop/` (it lands in `desktop/dist/`).

The logo is `icons/openledmapper.svg`. The app icons made from it are `openledmapper.ico` (Windows, and the browser tab icon), `openledmapper.icns` (macOS) and `openledmapper-256.png`. If you change the SVG, export these again.

## Credits

The ISF renderer is [interactive-shader-format](https://github.com/Vidvox/interactive-shader-format-js) by VIDVOX (ISC licence), bundled as `js/vendor/isf.js`.
