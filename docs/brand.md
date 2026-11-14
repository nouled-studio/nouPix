# nouPix: the look

The look of the interface, the login page and the phone remote, and the logo. It began as the restyle brief of the
nouPix brand kit; this is what the app does (checked against 1.6.2), with the choices made while mocking it up. `css/app.css` and
`css/remote.css` are the source of truth for the values; this page says what they mean.

The same rules with pictures, for designers, video and web (logo use, colour, type, icons, controls, writing), are in the
[brand guide (PDF)](nouPix-brand-guide.pdf) (v1.2: the icon set and the line icons as of 1.6.2, and pages on the parts added since 1.0). If the two ever disagree, the CSS wins. Where this page still marks something "today", the app doesn't follow the rule yet.

## 1. The idea in four colours

Pure black, so the light on the stage is the brightest thing on screen.

| Colour | Means | Used for |
|---|---|---|
| **Red** `#FF3B3B` (`--accent`) | acts | the active tool, the tab underline, the chosen half of a grouped button (a line under it), focus, the primary button, Blackout, every scene's small mark (unless the user gives it another colour; dim, bright while it plays), the red dot of the i and the arrows in the logo |
| **White** `#FFFFFF` (`--live`) | a light is on | Art-Net on (with the app's one glow), the playing scene's edge, the playlist playing (its tab's name, play button and progress line), the source playing, the beat dot by the master and the beat lit in the Tempo bar |
| **Yellow** `#FFD23F` (`--midi`) | MIDI, and nothing else | learn, the fader lines, CC / Note tags, MIDI wires (Tap tempo learnt onto a pad too) |
| **Aluminium** `#DCE1E6` (`--fader`) | something you move | sliders and their fill, levels, the X-Fader, the macros' links in the patch bay, the beat band's bars and the hits under it in Tempo |

What is selected (fixtures and groups on the stage and in the lists, patch rows, the selected zone and step) is
outlined in white (`--sel`; black in the white look), so red is left for what acts.

Everything else is a grey on black. **Red comes in small doses:** an edge, a line, a dot, text. Never a red area: a
selected row is a neutral fill (`--sel-soft`) with a white edge, the chosen part of a grouped button is raised with a
red line under it. The only red area is Blackout
while it is on. No gradients as decoration and no drop shadows; floating things (menus, dialogs, messages) are set
apart by their borders. Corners are square (`--r: 0`), except what is really round: status dots, the colour wheel
and its thumbs, switch knobs, the patch bay's wire ends.

## 2. Two looks: black and white

Black is the default. One click (the sun or moon in the top bar, or Settings → Interface) turns the interface white,
for daylight. It is the computer's choice (`ui.theme`), not the project's; the MIDI and Scenes windows follow. Every
colour is a variable in `:root`, redefined for white under `:root[data-theme="light"]`, so the meanings stay:

| | Black | White |
|---|---|---|
| window, stage (`--bg0`) | `#000000` | `#e8e8e8` |
| panels (`--bg1`) | `#0a0a0a` | `#f5f5f5` |
| text, secondary, muted | `#f0f0f0`, `#bdbdbd`, `#8e8e8e` | `#111111`, `#3d3d3d`, `#666666` |
| red (`--accent`) | `#ff3b3b` | `#c8141a` |
| lit (`--live`) | `#ffffff` | `#000000` |
| MIDI (`--midi`) | `#ffd23f` | `#8a6400` |
| aluminium (`--fader`) | `#dce1e6` | `#4f5861` |

Contrast rule for anything new: text at least 4.5:1 on its background. `--muted` is the darkest grey allowed for text;
darker greys are for lines and fills. The canvas stays black in both looks: it shows light, and each pixel shows what it
sends (black when off) inside a grey ring (`--dot-edge`) that keeps fixtures easy to find. In the white look the stage
around the canvas is white (`--stage-out`); fixtures' names over the canvas stay light (`--canvas-ink`), and lines that cross it get a light halo (`--stage-halo`);
`stageLook` in `ui-stage.js` reads these. With the content shown strongly behind them, the fixtures' pixels get a dark
rim, so they stand out from it. The login page and the phone remote are black.

## 3. Type

| Voice | Font | Where |
|---|---|---|
| Body | Saira 300 (`--ui`) | all running text, 13.5 px in the interface. List rows, inputs and values use 400, so they stay readable on any screen. Never below 300. |
| Labels | Chakra Petch 600, uppercase, letter-spacing .12–.16em, 10–11 px (`--label`) | panel heads, section titles, tabs, buttons, the Master label. Short labels only, never sentences (names the user typed keep their case). |
| Numbers | JetBrains Mono 300–400 (`--mono`) | every number a person patches. |

The fonts come with the app (`css/fonts.css`, the `.woff2` files beside it, latin and latin-ext), so it looks the
same without the internet; the bridge serves them. They are under the SIL Open Font License (`css/OFL.txt`).

## 4. Components

- **Buttons:** square, a `--line2` border, the label voice. The primary one is red with black text and the logo's two
  45° cuts, drawn with a background gradient so an outline around it (MIDI learn, focus) isn't clipped.
- **Buttons without a box** (`gbtn`, `.cltab`): where many buttons sit together and the content is the point (the
  timeline's bar, the Scenes panel, the cue lists), buttons have no border and no fill. An icon and/or a word in the
  label voice, grey (`--muted`), white when pointed at, and white with a short 2 px red line under it while on (a
  playing playlist's button white, a paused one orange). Settings, dialogs, Patch and the side panels keep their boxes.
- **Art-Net on:** white border and text, a faint white glow. **Blackout:** red text; on, red with black text.
- **The bridge pill:** a square dot, white and glowing while Art-Net goes out.
- **Scenes and playlist steps:** the logo's two cuts, top left and bottom right: the edge and the fill are two
  layers clipped to that shape (`::before`, `::after`), so tags and outlines around the tile aren't clipped. The
  playing one has a white edge and one small red square in its top right corner; the fade bar is white. A zone's
  colour, when it has one, is a line on the left. While learning MIDI, a tile's edge turns yellow along the cut.
- **Timeline clips** (and the audio's block): the same two cuts and layers as a scene's tile, the zone's colour a line on
  the left. A slim header carries the scene's name; under it a filmstrip of the scene's snapshot, over and over (a quiet
  hatch without one), masked to nothing over the clip's fade-in and fade-out. The clip's level is a thin aluminium line
  on its picture (dashed while it has no keys), and the picture fades with it. The fade handles are small aluminium
  squares. Selected: a white edge; playing: a white edge and the small red square, as a scene. The playhead is a red
  line with a small square; the loop's region a neutral tint between two red markers, never a red area. Sections
  (Audio, Zones) in the label voice; the waveform aluminium.
- **Keyframes:** a clip unfolded shows a row per control under its picture: the curve an aluminium line, each key a
  small diamond (a square on Hold, hollow when eased), the picked ones white. A colour's curve is a band of its
  colours, each key a diamond in its own colour. An audio track's volume is the same line on its waveform, which dims
  with it.
- **Markers:** a small flag on the audio track in the marker's colour (aluminium without one), its name in the label
  voice in the bg colour, cut at 45° on its right, and a faint dashed line down through the zones.
- **Zoom bars** (under the tracks for time, beside them for their height): a thin track with an aluminium thumb that
  is what is in view; its ends zoom, its middle scrolls.
- **Cue lists:** GO is a large boxed button; Standby and Playing in the label voice with the cue's number and name. A
  row per cue: the cue on standby (what GO fires next) has a red edge, the cue playing a white edge with its ▶ and a
  white progress line; its actions sit in small boxed tags; a countdown to a cue going by itself is red text.
- **Sliders:** a 2 px track, aluminium up to the value and dark after it, and a 3 × 14 px bar as the handle (the
  phone: 3 px and 6 × 30 px, for fingers). The colour picker's gradient sliders keep their round thumbs.
- **Tick boxes:** a thin square (14 px, a 1 px `--line3` border, no fill), ticked a thin red tick; a lighter border when
  pointed at. Drawn by the look (`appearance: none`), so they are the same on every system.
- **MIDI:** yellow, as before. In the patch bay the macros' links to effect controls, their dots and their counts are
  aluminium, so red never means MIDI or a link.
- **Side panels:** both fold, for a bigger stage: the left one (fixtures and sources) with « in its head, the first
  button of the stage bar (`side-panel-left`) or Shift H; the right one with » in its tabs, the last button of the stage
  bar (`side-panel`) or H. The two stage-bar buttons are mirror images, outlined in red while their panel shows, each
  at its end of the bar.
- **Playlists:** tabs kept quiet, no status words: a small square play button, the name, the length in mono. Playing:
  the name and the button white, a 2 px white progress line along the tab's top. Paused: the same in orange (`--warn`).
  The tab that adds one is dashed. Each step is a small scene tile with its fade and play time in mono.
- **X-Fader:** its button has a small round dot, red while it is on (and a white edge); the mode button next to it
  shows its curve as a small line graph (Mix an X, Dip a V, Cut a step). The strip: the two zones' live previews with
  a tag **A** and **B** (small boxed letters, also at the head of each zone), their names, the fader (aluminium) and the
  share each gets in mono. While it is on, A's and B's scenes sit side by side; the zone selected keeps its white
  outline.
- **Tempo:** the BPM in mono with a small dot that lights red on each beat, the bar's beats as four short lines (the
  current one white, beat 1 red). The spectrum is grey, the beat band's bars aluminium; under it the band's hits are an
  aluminium line with a grey tick on each beat (red on 1). The band's two edges are what you drag, so they are
  aluminium (white while one is dragged or pointed at), and its range (40–150 Hz) sits on a small dark tag so it reads
  over the bars. The white dot next to the master blinks with the beat while
  there is one.
- **Interact:** the pad is black and empty but for the zone's fixtures, drawn faintly in white, so the light under a
  finger is the only colour. The phone's Interact button carries the `touch` icon in red; Done brings the zone back.
- **Windows of their own** (MIDI, Scenes, Cue lists, Timeline, Channel monitor, Interact) are dressed like the main
  window (`dressWindow`): the same tokens, fonts and look, the window's name then "· nouPix".
- **Where a panel goes:** four small place icons (bottom, left, right, a window of its own: a frame with the part it
  takes filled grey), always in the same spot: at the right of the bottom panel's tab row, or after the open tab beside
  the stage. The place in use is white with the short red line under it.
- **A zone's head:** its stop is a small white square with no box, red when pointed at; + Store at the head's right
  end. A scene edited since it was stored shows a small orange pencil (white when pointed at): it saves what plays into
  the scene, after asking.
- **Scene sizes:** three small squares at the foot of the Scenes panel (small, medium, large), the size in use white
  with the red line.
- **Protocol tags** (Discovery, Patch): Art-Net, sACN, DDP in mono in a small 1 px box. Protocol names keep their case
  even where the label voice sets text in capitals: **sACN** never becomes SACN (`.pname`, `text-transform: none` on
  the name).
- **Messages** (`toast()`): a 3 px line on the left: grey (`--line3`) for news, orange (`--warn`) for a warning, red
  (`--danger`) for an error, so red still means something.
- **One primary button per view:** the window's main action (Discover in Discovery). Done, and any button that only
  closes a window, is a plain button.

## 5. Colours the user gives

A group, a zone or a scene can have a colour, only when the user gives it one (the Inspector, or the scene's dialog;
the first swatch is none). A group's shows on its fixtures in the list and on the stage, a zone's on its scenes'
left edge, a scene's on its small mark, dim and bright while it plays (red when it has none). Fixtures have none of their own. The
eight choices are saturated, and none is red or yellow: `#2f7bff` `#00c2ff` `#00d68f` `#8fe000` `#ff8a00` `#ff2fd1`
`#9b5cff` `#ff5c8a` (`TAGS` in `model.js`).

## 6. Icons and signs

Icons are inline SVG in `currentColor` (`ICONS` in `util.js`, and the buttons in `index.html`), on a 16 × 16 grid (18 × 18
in the tool rail and the stage bar), 1.3–1.6 lines. The set has 67: the 58 of the brand guide v1.0 and, since,
`tool-dot` and `dot` (the Dot), `stream` (NDI and OMT), `monitor` (Channel monitor), `output` (Output settings),
`side-panel-left` and `touch` (Interact, on the phone), and the two Rotate arrows `rotL`, `rotR`.

**Line icons** (`LINE_ICONS`, `lineIcon` in `util.js`) are for buttons without a box: the same 16 × 16 grid with a
thinner 1.2 line and square ends, so they sit quietly beside the label voice. They are play, pause, stop, back, the
loop's three states (once, loop, region) and loop around everything (`loopfit`), fit (also the stage's Fit), marker,
audio, snap (a magnet), plus, more (⋯), the two zoom arrows (`hzoom`, `vzoom`), edit (the pencil) and the length fitted
to the contents (`lenfit`). A line icon and a boxed icon never mean two things: Fit is the same picture everywhere. The phone remote draws its own play, pause, next, playlist and
`touch` larger, on a 24 grid for fingers.

Text signs that every font draws the same are fine: × · – → ← ↑ ↓ ° ✓ ⇧ ⌘ « » ‹ › ⋯ ▾ ▴. Signs that phones and some systems
turn into coloured emoji are not: ▶ ⏸ ⚙ ☀ ★ ⚠ ✔ (use the icon, or a word). Signs the app's fonts lack (↺ ↻ ◢ ❚) come out in
another font: use an icon.

## 7. The name

**nouPix**: lowercase n, capital P. It is the app's name everywhere: the windows, the bridge (`noupix.py`,
`noupix.spec`), the desktop app (`studio.nouled.noupix`), the phone app, files (`.noupix`, format
`noupix-project`), the browser's storage (`noupix.*`) and the settings folder (`~/.noupix`). What openLedMapper kept
carries over once (its files open, its storage and window profile move, the desktop app's data folder is renamed).
`window.olm` and the popups' window names (`olm-midi`, `olm-scenes`) are internal and stay.

## 8. Logo and icons

Wordmark: monoline square letters with 45° cuts on the top-left and bottom-right corners (like PCB traces). The x is
nine rounded pixels, and the dot of the i is the one red "lit" pixel. The letters are low and wide: x-height 10.5
units, letters 11.5 wide with 3.5 between them; the P rises 4.5 above the x-height, its bowl closing just below the
x-height's top, and the i's dot is level with the top of the P (about 4.4 : 1 overall). Icon: the LED schematic symbol (circle, wire,
diode, cathode bar) in white, with two red light arrows. The tile has the same two 45° corner cuts.

### 8a. Icon, master (64 px and up)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M0.5,8 L8,0.5 L63.5,0.5 L63.5,56 L56,63.5 L0.5,63.5 Z" fill="#000000" stroke="#2C2C2C" stroke-width="0.6"/>
  <circle cx="32" cy="32" r="20" fill="none" stroke="#F0F0F0" stroke-width="1.2"/>
  <path d="M3,32 H25 M39,32 H61 M25,24 L39,32 L25,40 Z M39,24 V40" fill="none" stroke="#F0F0F0" stroke-width="1.2" stroke-linejoin="miter"/>
  <path d="M30.79,23.62 L34.19,17.23 M34.71,25.86 L38.11,19.47" fill="none" stroke="#FF3B3B" stroke-width="1.2"/>
  <path d="M35.48,14.79 L35.28,17.81 L33.09,16.65 Z M39.4,17.03 L39.2,20.05 L37.01,18.89 Z" fill="#FF3B3B"/>
</svg>
```

At 32 px, use stroke-width 1.8 for the circle and diode, and these arrows:
`M30.94,23.36 L33.69,18.19 M34.86,25.6 L37.61,20.43` (stroke 1.8) and heads
`M35.63,14.53 L35.33,19.06 L32.04,17.31 Z M39.55,16.77 L39.25,21.3 L35.96,19.55 Z`.

### 8b. Icon, small (24–28 px: the top bar)

At this size the symbol is larger in the tile and the lines are heavier.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M0.5,8 L8,0.5 L63.5,0.5 L63.5,56 L56,63.5 L0.5,63.5 Z" fill="#000000" stroke="#2C2C2C" stroke-width="1.6"/>
  <circle cx="32" cy="32" r="25" fill="none" stroke="#F0F0F0" stroke-width="2.58"/>
  <path d="M2,32 H21 M39,32 H62 M21,21 L39,32 L21,43 Z M39,21 V43" fill="none" stroke="#F0F0F0" stroke-width="2.58" stroke-linejoin="miter"/>
  <path d="M28.32,21.15 L30.83,16.44 M33.72,24.45 L36.23,19.74" fill="none" stroke="#FF3B3B" stroke-width="2.58"/>
  <path d="M33.25,11.88 L32.88,17.53 L28.78,15.35 Z M38.65,15.18 L38.28,20.83 L34.18,18.65 Z" fill="#FF3B3B"/>
</svg>
```

### 8c. Favicon (16 px)

Same as 8b, with stroke-width **4.2** for the circle and diode, and these arrows:
`M28.03,20.02 L29.01,18.17 M34.87,24.2 L35.85,22.35` (stroke 4.2, red) and heads
`M32.96,10.75 L32.35,19.94 L25.67,16.39 Z M39.8,14.93 L39.19,24.12 L32.51,20.57 Z`.

### 8d. Wordmark on dark, master (40 px tall and up)

Aspect ratio 77.5 : 17.5. Stroke 1.25, pixels 1.85.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.25 7.75 77.5 17.5" role="img" aria-label="nouPix">
<path fill="none" stroke="#F0F0F0" stroke-width="1.25" stroke-linejoin="miter" d="M0,24 L0,16 L2.5,13.5 L11.5,13.5 L11.5,24 M15,16 L17.5,13.5 L26.5,13.5 L26.5,21.5 L24,24 L15,24 Z M30,13.5 L30,24 L39,24 L41.5,21.5 L41.5,13.5 M45,24 L45,11.5 L47.5,9 L56.5,9 L56.5,15.5 L54,18 L45,18 M60,13.5 L60,24"/><rect x="59.075" y="9.2" width="1.85" height="1.85" rx="0.74" fill="#FF3B3B"/><g fill="#F0F0F0"><rect x="62.575" y="12.575" width="1.85" height="1.85" rx="0.74"/><rect x="65.45" y="15.2" width="1.85" height="1.85" rx="0.74"/><rect x="68.325" y="17.825" width="1.85" height="1.85" rx="0.74"/><rect x="71.2" y="20.45" width="1.85" height="1.85" rx="0.74"/><rect x="74.075" y="23.075" width="1.85" height="1.85" rx="0.74"/><rect x="74.075" y="12.575" width="1.85" height="1.85" rx="0.74"/><rect x="71.2" y="15.2" width="1.85" height="1.85" rx="0.74"/><rect x="65.45" y="20.45" width="1.85" height="1.85" rx="0.74"/><rect x="62.575" y="23.075" width="1.85" height="1.85" rx="0.74"/></g>
</svg>
```

### 8e. Wordmark on dark, small (the top bar, 15 px tall)

Aspect ratio 78.6 : 18.6 (about 4.2 : 1). Heavier line (1.8) and larger pixels (2.3) so it stays crisp. The top bar and
the login page draw it inline at 63.4 × 15 px, in the page's colours (`currentColor`, `var(--accent)`).

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.8 7.2 78.6 18.6" role="img" aria-label="nouPix">
<path fill="none" stroke="#F0F0F0" stroke-width="1.8" stroke-linejoin="miter" d="M0,24 L0,16 L2.5,13.5 L11.5,13.5 L11.5,24 M15,16 L17.5,13.5 L26.5,13.5 L26.5,21.5 L24,24 L15,24 Z M30,13.5 L30,24 L39,24 L41.5,21.5 L41.5,13.5 M45,24 L45,11.5 L47.5,9 L56.5,9 L56.5,15.5 L54,18 L45,18 M60,13.5 L60,24"/><rect x="58.85" y="9.2" width="2.3" height="2.3" rx="0.92" fill="#FF3B3B"/><g fill="#F0F0F0"><rect x="62.35" y="12.35" width="2.3" height="2.3" rx="0.92"/><rect x="65.225" y="14.975" width="2.3" height="2.3" rx="0.92"/><rect x="68.1" y="17.6" width="2.3" height="2.3" rx="0.92"/><rect x="70.975" y="20.225" width="2.3" height="2.3" rx="0.92"/><rect x="73.85" y="22.85" width="2.3" height="2.3" rx="0.92"/><rect x="73.85" y="12.35" width="2.3" height="2.3" rx="0.92"/><rect x="70.975" y="14.975" width="2.3" height="2.3" rx="0.92"/><rect x="65.225" y="20.225" width="2.3" height="2.3" rx="0.92"/><rect x="62.35" y="22.85" width="2.3" height="2.3" rx="0.92"/></g>
</svg>
```

### 8f. Wordmark on light (docs, website, print)

Aspect ratio 77.9 : 17.9. Ink `#0A0A0A`, red `#C8141A` (5.3:1 on `#F2F2F2`), stroke 1.45, pixels 2.0.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.45 7.55 77.9 17.9" role="img" aria-label="nouPix">
<path fill="none" stroke="#0A0A0A" stroke-width="1.45" stroke-linejoin="miter" d="M0,24 L0,16 L2.5,13.5 L11.5,13.5 L11.5,24 M15,16 L17.5,13.5 L26.5,13.5 L26.5,21.5 L24,24 L15,24 Z M30,13.5 L30,24 L39,24 L41.5,21.5 L41.5,13.5 M45,24 L45,11.5 L47.5,9 L56.5,9 L56.5,15.5 L54,18 L45,18 M60,13.5 L60,24"/><rect x="59" y="9.2" width="2.0" height="2.0" rx="0.8" fill="#C8141A"/><g fill="#0A0A0A"><rect x="62.5" y="12.5" width="2.0" height="2.0" rx="0.8"/><rect x="65.375" y="15.125" width="2.0" height="2.0" rx="0.8"/><rect x="68.25" y="17.75" width="2.0" height="2.0" rx="0.8"/><rect x="71.125" y="20.375" width="2.0" height="2.0" rx="0.8"/><rect x="74" y="23" width="2.0" height="2.0" rx="0.8"/><rect x="74" y="12.5" width="2.0" height="2.0" rx="0.8"/><rect x="71.125" y="15.125" width="2.0" height="2.0" rx="0.8"/><rect x="65.375" y="20.375" width="2.0" height="2.0" rx="0.8"/><rect x="62.5" y="23" width="2.0" height="2.0" rx="0.8"/></g>
</svg>
```

### Where they are

- `icons/noupix.svg` (8a), `noupix-32.svg` (the 32 px cut of 8a), `noupix-small.svg` (8b), `noupix-favicon.svg` (8c),
  `noupix-wordmark.svg` (8d), `noupix-wordmark-small.svg` (8e), `noupix-wordmark-light.svg` (8f), `noupix-lockup.svg`.
- The top bar draws 8b and 8e inline, in the page's colours (`currentColor`, `--accent`, `--bg0`), so they follow the
  look; the login page and the phone remote the same. The browser tab icon is 8c.
- Raster: `noupix-256.png`, `noupix.ico` (16 from 8c, 32 from the 32 px cut, 48 and 256 from 8a), `noupix.icns`, and the
  phone app's `remote-192.png`, `remote-512.png` and `remote-maskable-512.png` (black square, the symbol at 70%, inside
  the maskable safe zone). If an SVG changes, export these again.
