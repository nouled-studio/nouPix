# nouPix: architecture and conventions

A pixel-mapping tool for LED installations (called openLedMapper until 1.0). The interface is a web page; a small Python program, the bridge,
serves it and turns its frames into Art-Net. The desktop apps are an Electron window around the page, with the
bridge packed inside.

```
index.html, css/, js/  ── the interface (browser): fixtures, content, scenes, playlists, patch; renders and builds DMX
        │  WebSocket /ws: JSON messages + binary frames of universes
noupix.py              ── the bridge (Python 3.8+, standard library only): serves the page, sends Art-Net
        │  with remote control on: a second web server on the network (default port 8090)
login.html, remote.html── what other devices open: the login page, and the phone page; /app is index.html
desktop/               ── Electron window that starts the bridge and loads http://127.0.0.1:<port>/
```

## The interface

`index.html` is markup only. `css/app.css` is all the styles. The code is plain scripts in `js/`, loaded in this
order by `<script src>` tags at the end of `index.html`:

| File | Role | Main names |
|---|---|---|
| `vendor/isf.js` | ISF shader renderer by VIDVOX (third party, unchanged) | `interactiveShaderFormat` |
| `builtins.js` | The 53 built-in effects, as ISF code and categories (data). The 21 added after 1.1.0 share one convention: `speed` from −1 (full, reverse) through 0 (still) to 1, used only as `TIME * speed`; their colours `colorA`/`colorB` (or `color`/`background`) for the Color 1 and 2 macros; other controls named for the macros (`scale`, `count`, `width`, `softness`, `angle`, `density`, `decay`, `size`); a good picture at the thumbnails' moment (`THUMB_TIME`) | `BUILTINS` |
| `util.js` | Helpers used everywhere: elements, numbers and text, local storage, toasts, error reports, icons; the window the user works in (`uiDoc`: this page, or the MIDI or Scenes window), where toasts, menus and dialogs show | `$` `$$` `h` `isEl` `clamp` `wrap180` `wrap360` `pct` `fmtN` `store` `toast` `uiDocNow` `watchDoc` `debounce` `report` `replacer` `MOD` |
| `model.js` | The project and its parts: constants (`CURVES`, `CURVE_STRENGTH`, `TAGS`: the colours a group or zone can be given), defaults, the `project` and `ui` state, factories, groups, selection, look-ups by id, a fixture's colour (its group's), the crossfader's two zones | `project` `ui` `blankProject` `newFixture` `fxBits` `fxCurve` `curveParam` `newZone` `newLayer` `newPlaylist` `newStep` `newController` `selected` `selUnits` `fxById` `fxTag` `isTag` `markGeom` `markPatch` `xfZones` `xfDriven` |
| `macros.js` | Macros: their list (`MACROS`: Speed, Intensity, Saturation, Color 1 and 2, the shared controls), defaults and repair, which control of an effect follows which (by name, or as chosen for that effect in `project.macroLinks`), a value with its macro on it, colour parts | `MACROS` `macroDef` `defaultMacros` `fixMacros` `macroRoles` `macroChoices` `macroRolesOf` `fixMacroLinks` `macroActive` `macroOver` `macroPart` `macroPartPatch` |
| `geometry.js` | Mapping math: each fixture's pixel positions, lengths, bounds, distances; moving, turning, scaling a fixture and the frame around several | `computePoints` `rebuildGeometry` `computeBB` `rotateFixture` `scaleFixture` `frameOf` `snap45` |
| `patch.js` | Addressing: universe and channels of every pixel on its controller output (`BPP`: channels per pixel, doubled on 16-bit fixtures), conflicts | `computePatch` `ensurePatch` `universes` `addrOf` `BPP` `assign` `unassign` |
| `sources.js` | Content sources: WebGL canvas, ISF runtimes (compiled when first played or drawn as a thumbnail; `headerOf` reads a header without compiling, `controlsOf` an effect's controls from it, `effectRt` what `macroRolesOf` needs from it), parameters and speeds, images and videos (trim, loop, sound), the media format check, source thumbnails | `runtimeOf` `effectRt` `headerOf` `controlsOf` `isSpeedInput` `renderSource` `applyParams` `probeMedia` `attachMedia` `syncMedia` `videoTick` |
| `render.js` | The GPU mixer (zones, layers, blend modes; the crossfader's even mix; a zone's picture made small for a preview, `mixer.thumb`), looks and fades, recalling a scene, sampling the composition at every pixel, highlight and test patterns | `mixer` `renderContent` `loadSource` `startFade` `recallScene` `sampleMix` `testPattern` `setHighlight` |
| `streams.js` | NDI and OMT in: the streams the project's stream sources want (`syncStreams`, asked of the bridge), frames from the bridge into a canvas per stream that `mediaEls` holds for its sources (`streamFrame`), the sources found and each stream's state | `streams` `syncStreams` `findStreams` `streamFrame` `streamMessage` `streamState` `streamKey` `isStream` `STREAM_PROTOS` |
| `output.js` | Gamma, sampled colours to DMX channels (each fixture's dimmer × its group's (`groupLevel`) × the master; 8-bit; 16-bit through `output16`: dimming curves shaped by gamma or strength, coarse then fine), the outgoing frame, the clock, the bridge connection | `buildOutput` `output16` `curveValue` `layoutFrame` `sendFrame` `tick` `startClock` `connectBridge` `bridge` |
| `project-io.js` | Project files: repairing what is opened, undo history, autosave, open/save, CSV, SVG import, the demo | `hydrate` `serialize` `commit` `commitSoft` `undo` `redo` `loadProject` `importSvg` `demoProject` |
| `remote.js` | Remote control: the host side (configure the bridge, send the project and the phones' state, apply devices' changes by role) and the client side (this page opened on a device at `/app`) | `remote` `REMOTE_CLIENT` `mappingLocked` `remoteChanged` `remoteFromDevice` `contentOf` `connectRemote` `remoteOp` |
| `playlists.js` | Playlists: a zone plays some of its scenes in turn on the frame clock; which fade a step uses; play, pause, next, the end; the state devices see | `playlistTick` `playPlaylist` `togglePlaylist` `pausePlaylist` `resumePlaylist` `stepPlaylist` `playlistManual` `stepFade` `playingList` `playElapsed` `playState` |
| `midi.js` | MIDI in: Web MIDI and its ports, messages, the mappings' targets (master, blackout, the crossfader `xf`, group dimmer `gr:<group>`, zone level, scene, next scene, playlist, macro, a control of an effect), pickup and jump, toggle and hold (Follow for a fader, the default when one is learnt onto something on or off), learn | `midi` `startMidi` `setMidiOn` `midiMessage` `midiIn` `midiTarget` `effectTarget` `midiApply` `midiSetLearn` `midiLearnTarget` `midiConnect` `midiSetMap` `midiDisconnect` |
| `actions.js` | What the user can do, whichever button, key or menu asks: fixtures, selection, align/turn/resize, copy and paste, zones and their levels, the crossfader, layers, scenes, playlists, controllers, macros and what an effect follows, an effect's control set everywhere it plays, adding sources from files | `addFixture` `deleteSel` `duplicateSel` `groupSel` `alignSel` `rotateSel` `pasteFixtures` `addZone` `setZoneOpacity` `setXfade` `setXfadeOn` `setXfadeZone` `addLayer` `goScene` `storeScene` `playlistDo` `addPlaylist` `addToPlaylist` `moveStep` `deleteController` `setMacro` `setMacroLink` `setEffectControl` |
| `ui-forms.js` | Building blocks for the panels: rows, inputs, sliders (a value typed on double-click, Shift + scroll in notches; the track filled up to the value, `rangeFill`, kept by the value setter and input events), a group's or zone's colour (`tagSwatches`), segmented buttons, lists that reorder by dragging and their move animation, rows that scroll sideways with ‹ › (`hscroller`), scroll positions kept when a panel is drawn anew (`keepScroll`, `data-keep`), a window this page draws into dressed like it (`dressWindow`), a short explanation under anything marked `data-tip` ("Title|What it does", `initTips`) | `row` `numRow` `sliderRow` `shiftWheel` `notchFrom` `seg` `checkRow` `reorderable` `flipRows` `hscroller` `keepScroll` `dressWindow` `initTips` |
| `ui-color.js` | The colour picker for shader colour controls: wheel and intensity, RGB, HSV, hex, lighting presets, recent colours | `colorRow` `openColorPicker` `hsvToRgb` `rgbToHsv` |
| `ui-stage.js` | The stage canvas: view and zoom, drawing (its fonts and colours read from the page's, `stageLook`, again when the look changes), zones on the stage, hit testing, handles, tools, pointer, pixel finder, guide image | `drawView` `stageLook` `fitView` `setTool` `hitFixture` `dragHandle` `endDrag` `defaultFixtureAt` |
| `ui-lists.js` | The left column: fixture list (groups, badges, drag and drop) and source list (categories, search; its height, `ui.srcH`, dragged on its top edge, `#srcGrip` in app.js) | `renderFxList` `renderSrcList` |
| `ui-inspector.js` | The right panel: fixture (with resolution, dimming curve, its Gamma or Strength slider and the graph, which follows the slider live), multi-selection, group and zone inspectors, Content tab (shader angles with buttons every 45°), video controls, Settings | `renderRight` `onSelection` `showRight` `dimmingRows` `strengthRow` `curveGraph` `isAngle` `anglePresets` |
| `ui-dock.js` | The bottom dock: scenes (with the fade time on each scene's button; the crossfader's strip, `xfadeStrip`, and its previews, `drawXfPreviews`), patch and controller editor, Art-Net nodes, DMX monitor; the Scenes window (the scenes and playlists in a popup this page draws into, `olm-scenes`; the Scenes tab says where they are meanwhile) | `renderDock` `onPatchChanged` `refreshScenes` `fadeControl` `autoPatch` `openScenesWindow` `drawScenesWindow` `scenesDoc` `scenesRoots` |
| `ui-playlists.js` | The playlists in the Scenes panel: tabs folded to one line or open, steps (with their own fades, moved by dragging or Alt ← →), step editor, + Add, the New playlist window (order with ↑ ↓, a fade per step), the playlist menu | `playlistArea` `newPlaylistDialog` `playlistMenu` `shiftStep` `drawPlaylistProgress` |
| `ui-menus.js` | The menu system and every menu, the SVG import dialog, copy/cut/paste keys | `menu` `fixtureMenu` `canvasMenu` `projectMenu` … |
| `ui-remote.js` | Remote control in the interface: the top-bar button and menu, the Settings section, the waiting screen on devices, `lockPanel` for operators | `updateRemoteUI` `remoteMenu` `remoteSection` `remoteOverlay` `lockPanel` |
| `ui-macros.js` | The macros panel of the MIDI window (colour parts in HSV or RGB, the shared controls folded; its own binders, `macroBinders`), the "Follows Speed" note under an effect's control, "Macros it follows" in an effect's Parameters (what each control follows, for that effect), the Content tab's values and an open colour picker refreshed once a frame | `macrosPanel` `macroFollows` `macroLinksFold` `syncContentSoon` `updateMacrosUI` |
| `ui-midi.js` | MIDI in the interface: the top-bar button, the MIDI window (a popup this page draws into: Learn, controllers and the macros under them, mappings (while learning, the control just moved at the top with a list to choose its target), monitor, the virtual controller: on-screen faders and pads sent through `midiIn` as port `MIDI_VIRTUAL`), the learn bar, learning by touching anything marked `data-midi` in either window (`midiCapture`), the yellow line and tags on what a control drives | `updateMidiUI` `openMidiWindow` `renderMidiWindow` `midiSlot` `midiButton` `markMidi` `initMidiUI` |
| `ui-bay.js` | The patch bay, the MIDI window's second view (`ui.midiView`: 'list' or 'bay'): controls, targets (output, zones, macros) and effects' controls (colours too) in three columns, a yellow wire per mapping and aluminium wires from a macro to the effect controls that follow it (`bayLinks`, shown for the macro pointed at or pinned; SVG over the columns; dashed into a folded group or past a column's edge), wires drawn by dragging from a dot (`bayDrawStart`, `bayDropAt`: `midiAddMap`, `setMacroLink`), a wire picked with its settings and Remove (Delete, `bayRemoveSel`), rows that move their target, folding (`ui.bayOpen`), controls forgotten (×, `midiForget`) and put in order by dragging (`project.midi.order`, `midiSetOrder`; the list follows) | `bay` `bayView` `bayWires` `bayUpdate` `bayKeys` `bayLinks` `bayDrawStart` |
| `app.js` | Top bar and status bar, the look (black or white: `ui.theme`, the top bar's button and Settings), wiring buttons and keys, the frame loop, `boot()`, and `window.olm`; looking for a new version (the latest release on GitHub, once a day, a window with Download, Later, Skip this version) | `initUI` `setTheme` `applyTheme` `onKey` `renderAll` `boot` `checkUpdates` `newerVersion` |

### How the files fit together

- **Plain scripts, one shared scope.** No modules, no bundler, no build step: the page must also open straight
  from disk (file://), where browsers refuse JavaScript modules. Every top-level `function`, `const` and `let`
  is visible to every file, exactly as when the app was one script. A name is defined once, in one file.
- **Load order.** Code that runs while the page loads (constants, the WebGL canvas, the mixer, listeners on the
  stage canvas and the document, the autosave timer) may only use what earlier files define. Everything else runs
  later, after `boot()` at the end of `app.js`, when all files are there. A function used at load time from an
  earlier file doesn't exist yet: functions are only hoisted within their own file.
- **Layers.** The engine is `util → model → macros → geometry → patch → sources → render → output → streams → project-io → remote →
  playlists → midi`; each uses only the ones before it, with these exceptions: `computePatch` ends with `layoutFrame` (output.js)
  so the outgoing frame matches the new patch; `tick` (output.js) calls `playlistTick`; `restore` (project-io.js) uses
  `playlistOf`/`playingList` to carry playlists through an undo; `connectBridge` (output.js) hands NDI frames and messages to `streamFrame`/`streamMessage` (streams.js); remote.js reads the playlists' state (`playState`,
  `playForPhone`) for the devices; `hydrate` repairs the MIDI mappings with `MIDI_KEY` (model.js); `applyParams`
  (sources.js) and `renderLook` (render.js) put the macros on each layer as it draws, from `project.macros`. The UI is `actions → ui-forms → ui-color, ui-stage, ui-lists, ui-inspector,
  ui-dock, ui-menus → app`; UI files use any engine file and each other.
- **The engine calls the UI only to redraw**, through these: `renderAll`, `renderRight`, `renderDock`,
  `onPatchChanged`, `renderFxList`, `renderSrcList`, `refreshScenes`, `updateUndoButtons`, `updateBridgeUI`,
  `updateHighlightUI`, `showVersion`, `keepAwake`, `loadGuide`, and for remote control `updateRemoteUI`,
  `remoteOverlay`, `redrawStage`, for MIDI `updateMidiUI`, and for the macros `updateMacrosUI`. Keep it to that list. (`remote.js` and `midi.js` also call
  the actions they carry out for devices and controllers: `goScene`, `setZoneOpacity`, `setXfade`, `toggleBlackout`, `playlistDo`, `setMacro`, `setEffectControl`.) `refreshScenes` waits while something in the
  Scenes panel is dragged or typed in, so a playlist moving on doesn't break the user's drag.
- **Not strict mode.** The scripts run without `'use strict'`, as the app always has. Don't add the directive to a
  file without testing everything: it changes what some code does.

### Each frame

`startClock` runs `tick()` at the project's fps (in a worker timer, so it keeps going in the background):
`rebuildGeometry` if `geomDirty` → `ensurePatch` if `patchDirty` → `playlistTick` (main window only: steps whose play
time is up move on, through `recallScene`) → `renderContent` (or `testPattern` while
highlighting) → `updateThumbs`, `syncMedia`, `videoTick` → `buildOutput` → `sendFrame` when Art-Net is on.
The clock is a worker that sends one frame at a time: the page takes it as the frame starts (`'took'`), so a frame
that needs most of its period still leaves the next on time, and frames never pile up; after a long stall it goes on
from now. A frame that took longer than its period makes the next wait half a period, so a slow machine
keeps an interface that answers. Drawing the stage is separate: `frameLoop` in app.js redraws on `requestAnimationFrame` when something
changed, and only as often as leaves the output its time (at most 30 a second for moving content, 60 while working on
it, at least 10 or once every 4 frames; fewer when drawing is slow; in the gap after an output frame). A new size clears the stage's canvas: `resizeView` puts the last picture back at once, so resizing a panel never flashes it empty before the next drawing. Moving the mouse redraws the stage only
while dragging, or when the fixture or pixel under it changes (`hoverPixel` looks only through fixtures near it).

### Changing the project

- Edit `project`, then call `markGeom()` if any pixel moved and `markPatch()` if addressing may have changed;
  the next tick recomputes.
- Then `commit()` (a step of undo, autosave, redraw the lists and dock; `commit({ lists: false })` when they show nothing
  of the change, as for fixtures moved, turned or resized) for discrete edits, or `commitSoft()`
  (debounced) while dragging or typing. Redraw the panel you changed (`renderRight()`, …) yourself.
- Keys starting with `_` (`f._pts`, `f._patch`, `f._out`, `f._col`…) are worked out at run time and never saved
  (`replacer` leaves them out of every file and copy).
- Playlists live in each zone (`z.playlists`, steps pointing at the zone's scenes); where one plays is `z._play`, never
  saved. Steps that play by themselves change `z.layers`/`z.scene` without an undo step; `restore` keeps a playing
  zone's step over an older copy (an undo, a device a step behind).
- MIDI mappings live in `project.midi.maps` (`newMidiMap`: a control's key, what it drives, pickup or jump, toggle or
  hold); their working state (`w._picked`, `w._last`…) is never saved. Whether MIDI is on and which ports are ignored
  are this computer's (`ui.midiOn`, `ui.midiOff`). Anything MIDI can drive in the interface is marked `data-midi`
  (`midiSlot` for a slider, `midiButton` for a button or tile): learning picks it, `markMidi` gives it its line and tag.
- Macros live in `project.macros` (`fixMacros` keeps every one, in range). They are live controls, like the master:
  `setMacro` saves them soon and tells the devices (in `remoteLive`), it is not a step of undo, and `restore` keeps the
  current ones (an undo, or a device's copy, doesn't move them). They apply as each layer draws and never change the
  layers' own values; an effect's control follows a macro by its name (`macroRoles`, kept as `rt.roles`), or as chosen
  for that effect: `project.macroLinks[source][control]` is a macro's id or `''` for none (only what differs from the
  name is kept; part of the project and of undo; an operator's copy keeps the main window's). `macroRolesOf` merges
  the two, worked out again when that effect's object of choices is a new one (so `setMacroLink` replaces it). The
  macros' sliders are in the MIDI window only (devices can still send `{op: 'macro'}`, but show none); in the Content
  tab, an effect's colour that follows a colour macro that is on shows and sets that macro.
- A MIDI mapping can drive a control of an effect (`p:<source>:<control>`, `effectTarget`): `setEffectControl` sets it
  in every layer that plays that effect now (a step of undo, like a zone level); scenes keep their own values. The
  Content tab's controls read the layer's value on each sync, so they follow.
- The crossfader ("X-Fader" on screen) is `project.xfade` (`{ on, a, b, x, mode, phone }`: two zones' ids, the fader (0 all A,
  1 all B), its mode (`XF_MODES`: mix, dip through black, cut at the middle) and whether the Remote page shows it). Its button
  (bottom left, with a button for the mode next to it that opens a list of the three, each a small graph, `xfGraph`) and strip (bottom middle) are at the bottom of the Scenes panel; the fade for new scenes is in Settings. While it is on
  (`xfZones()`), `xfApply` sets A's and B's levels (`xfLevels`: in mix 1 − x and x), and only it: `setZoneOpacity` ignores those two (sliders,
  MIDI on their levels, devices), and their sliders are disabled. `setXfade` moves it (from its slider, MIDI's `xf`, a
  device's `{op: 'xfade'}`, from the Remote page only with `phone`, which shows it on or off but can't switch it), on or off; turning it on suggests making A and B
  cover the canvas (`xfFitAdvice`); turning it on or off and choosing a zone are steps of undo. `renderContent`
  lays the lower of the two on whole where the upper covers it, so the upper's level alone mixes them there and the
  light stays even, and draws both even when one is faded out, for their previews.
- A group's dimmer is `g.level` (0 to 1; absent at 1, so files without dimmed groups don't change): `setGroupLevel`
  sets it and every slider showing it; `buildOutput` multiplies it in.
- Colours: a group (`g.tag`), a zone (`z.tag`) or a scene (`sc.tag`) may have one, a hex from `TAGS`; none (`''`, or no
  `tag` on a scene) is the default: nothing gets one unless the user gives it. Fixtures show their group's (`fxTag`);
  a zone's is its scenes' edge, a scene's its corner mark (`--mark`; red without one), dim and bright while it plays. `hydrate` drops fixtures' colours, and
  the others from files before version 4 (they were given automatically then).
- Files: `{ format: 'noupix-project', version: 4, … }`, saved as `.noupix` (JSON; `.json` opens too). Save writes over the file opened or saved (`projectFile`, where the browser lets pages write files), Save as asks, and `ui.autosave` writes every change to it. `hydrate` (project-io.js) repairs
  anything opened (older versions, openLedMapper and Weft files, hand edits) so the rest of the code can trust the
  project. A new field gets its default there.
- `ui` holds view and selection state; the part listed in `UI_PREFS` is kept between sessions (`savePrefs`, under
  `noupix.ui`; that includes `ui.theme`, which a script in `index.html`'s head applies before anything is drawn).
  What the browser kept under `openledmapper.*` (or `weft.*`) moves to `noupix.*` once (`carryOverStorage`).
- New versions: once the bridge says which version runs (`showVersion`), the main window asks GitHub's API for the latest
  release (`checkUpdates`, from the page, so the browser's own certificates are used), at most once a day (`ui.updateAt`),
  with Settings → Updates on (`ui.updates`); a version skipped (`ui.updateSkip`) isn't told of again by itself. A browser
  driven by tests (`navigator.webdriver`) never looks by itself, so the suites stay offline.

## Remote control

- **Servers:** the local server (`/`, `/ws`) is only reachable from this computer. With remote control on, the
  bridge's `Remote` class opens a second server on all network cards that serves `login.html` (`/`), `index.html`
  (`/app`), `remote.html` (`/remote`), the css/js files, `POST /login`, `/info`, and the devices' WebSocket `/rws`.
- **Roles:** `POST /login` gives a token for a role: `programmer` (password, compared in constant time, wrong ones
  slowed and locked out per address), `operator` or `remote`. The bridge passes every device message to the main
  window as `{t: 'rmsg', cid, role, m}`. The role comes from the token, never from the device.
- **The main window decides** (`remoteFromDevice`): `remote` may only play scenes and playlists, set zone levels and move the crossfader (when the Remote page shows it);
  `operator` and `programmer` also the master and blackout, and send their whole project. An operator's project goes
  through `contentOf`, which keeps everything but the zones' layers, scenes, levels and playlists, the crossfader and the shaders. A programmer's
  replaces the project. The main window then sends the result to every device (`remoteChanged`, after every
  `pushHistory` and `restore`).
- **A device** (`REMOTE_CLIENT`, the page at `/app`) loads nothing from local storage and saves nothing. It sends its
  project after changes, with a sequence number. It applies the main window's copy only when that copy has its last
  change (`acks`), and not while the user drags or types. Scene changes and zone levels also go as small operations
  (`remoteOp`), so the main window fades and dims live; so do play, pause and next of playlists (`playlistDo`), which
  only the main window plays: devices show where they are from the `live` message (`play`). A device never sends
  Art-Net (`setOutput` does nothing), and can't add files or screen capture.
- **The remote as an app:** `remote.html` links `remote.webmanifest` (start `/remote`, standalone, icons
  `icons/remote-*.png` made from `icons/noupix.svg`) and registers `remote-sw.js` (network first, a cached copy
  of the page and its files when the computer can't be reached). The network server serves them (`REMOTE_FILES`).
  Chrome installs only from a secure address: plain http on the network needs its "insecure origins treated as
  secure" setting; the page's full screen button covers the rest.
- **MIDI** is read by the main window only: a device (`REMOTE_CLIENT`) has no MIDI button and ignores MIDI. The MIDI window
  is a popup (`window.open('', 'olm-midi')`) that the main window draws into with its own code, so the engine stays in
  one place; it closes with the main window. So is the Scenes window (`olm-scenes`). The desktop app lets those two
  popups open (`setWindowOpenHandler`). Elements moved into a popup belong to its window: test them with `isEl`, not
  `instanceof Element`; anything that looks things up in the Scenes panel goes through `scenesRoots()`.
- **The operator's lock** is in the interface (`mappingLocked()`: stage, keys, menus, lists, `lockPanel`) for
  convenience, and in `contentOf` for real.

## The bridge (noupix.py)

Python standard library only. Serves `/` and `/index.html`, plain-named `.css`, `.js` and `.woff2` files in `css/`,
`js/` and `js/vendor/` (nothing else), and the WebSocket at `/ws`; with remote control on, the network server described above. The
page sends binary frames (`layoutFrame` in output.js describes the layout) that the bridge turns into Art-Net
packets, plus JSON messages (discovery polls, settings, remote control). **NDI and OMT in** (`VideoIn`, `Ndi`, `Omt`): the bridge loads
the library the user installed (NDI Tools, `--ndi-lib` or `NOUPIX_NDI_LIB`; libomt with libvmx, in `~/.noupix/omt`, `--omt-lib`
or `NOUPIX_OMT_LIB`; nothing bundled) with ctypes, lists the sources (`{t: 'vin', op: 'find'}`) and receives the ones a window asks for (`op: 'sub'`), each on its
own thread, frames cut down to 640 wide (Light, the preview stream) or 1920 (Full) by `shrink_rgba` (OMT's BGRA turned to RGBA), sent to the window
as binary messages starting `VIN1`, newest frame only. A stream source is `{ kind: 'stream', proto: 'ndi' | 'omt', stream:
its name on the network, name, hq, fit }`. `VERSION`
is the app's version; it shows next to the name in the top bar. `noupix.spec` packs the bridge and the
interface files for the desktop apps; `.github/workflows/release.yml` builds them when a `v<VERSION>` tag is
pushed.

## Conventions

- **Code style:** match the file around you: two-space indents, single quotes, semicolons, `camelCase`,
  `UPPER_CASE` for constant tables. Elements are built with `h(tag, attrs, ...children)`; small helpers over
  classes. Comments are plain sentences that say why or what for, above the code they describe.
- **The look:** described in `docs/brand.md`. Every colour is a variable in `css/app.css`'s `:root`, redefined for the
  white look under `:root[data-theme="light"]`; anything new uses them (or `color-mix` of them), never a literal, so
  both looks keep working. Red (`--accent`) marks what acts, in small doses: an edge, a line, a dot, text, never a
  large red area. What is selected is white (`--sel`; a selected row is `--sel-soft` with that edge). White (`--live`) means a light
  is on, yellow (`--midi`) is MIDI's alone, aluminium (`--fader`) is what you move. Corners are square (`--r: 0`),
  except what is really round (status dots, the colour wheel, switch knobs); no drop shadows. Running text is Saira
  300, labels (panel heads, tabs, buttons) Chakra Petch uppercase (`--label`), numbers JetBrains Mono; the fonts are
  in `css/` (`fonts.css`, `OFL.txt`), so the app needs no internet.
- **Interface text:** short plain sentences, sentence case, no jargon where a word will do. Messages to the user go
  through `toast()`. Shortcuts are shown with `MOD` (⌘ on a Mac, Ctrl elsewhere).
- **No dependencies** in the interface or the bridge. Third-party code goes in `js/vendor/` unchanged, with its
  licence noted.
- **A new file in js/:** add its `<script src>` tag in the right place in `index.html` (nothing else needed: the
  bridge serves it and the desktop build packs the whole folder), and add it to the table above.
- **Versions:** bump `VERSION` in `noupix.py`, `desktop/package.json` (and its lock file), the README
  title and the user guide's first line together.

## Tests

`python3 tests/run_tests.py --quick` before every push (about 10 minutes); for a change to MIDI, the macros or the
MIDI window only, `python3 tests/run_tests.py --midi` (static, midi, macros, links, bay: about 5 minutes) before a push,
and `--quick` (plus `golden`) before merging into main; `python3 tests/run_tests.py` for
everything, including `golden` (the Art-Net bytes of fixed projects must stay identical), the soak test and the UI
fuzzer. Tests drive the page with Playwright through the bridge, and use the global functions and `window.olm`
(app.js), so keep those names working. Each suite is a script in `tests/` that prints PASS/FAIL lines and
`FAILED: none`; add new ones to `SUITES` in `run_tests.py`. `tests/make_examples.py` rebuilds the projects in
`examples/` with the app itself and checks every example file. `test_remote.py` checks remote control end to end
(roles, permissions, phone page, disconnects); `test_remote_app.py` the remote as an installable app and over the
computer's network address; `test_remote_soak.py` (full run only) runs 400 mixed changes from
several devices while every zone plays a playlist, and checks they all end equal. `test_16bit.py` checks 16-bit fixtures down to the Art-Net bytes on the wire (coarse before fine, packing, curves,
strengths, the graph following the sliders, mixed with 8-bit). `test_values.py` checks typed values, Shift + scroll and the angle buttons. `test_midi.py` checks MIDI with a controller
simulated in the page (Web MIDI replaced): turning it on, the MIDI window, ports, learn in either order, pickup and jump, toggle and
hold, scenes, next scene, playlists, ignored ports, another port name, saving, undo, missing targets, the line and tags,
the virtual controller. `test_macros.py` checks the macros: what follows what, Speed through the clocks, Intensity,
Saturation, the colours, the shared controls, scenes and thumbnails, files and undo, the Macros section, MIDI onto a
macro and a colour's part, devices. `test_links.py` checks what an effect follows as chosen (engine, files, undo, the
fold, the operator's lock), MIDI onto an effect's controls (learn, pickup and jump, every layer, scenes, speed, lists,
ticks, events, the MIDI window's list) and Follow for a fader learnt onto something on or off. `test_look.py` checks the look and the name: the fonts served and nothing fetched from outside, black by default,
white from the top bar and Settings (kept, from the start, the windows and the stage following), colours only on
groups and zones (none at first, shown by their fixtures and scenes, undo), files (old colours dropped, the old
format opened, `.noupix`, Save, Save as and autosave), the sliders' fill, the scene tiles' cuts, openLedMapper's stored data carried over.
`test_xfade.py` checks the crossfader: the levels and the even mix (same place, either way up, overlapping in part),
nothing else setting A's and B's levels while it is on (sliders, devices, MIDI), MIDI onto it on or off, the Scenes
panel (button at the bottom left that stays put, the modes, strip in the middle, short fader, greyed sliders, A and B tags, previews filling their frames,
choosing zones, the zone menu), the fade for new scenes in Settings, undo, files, the advice to make both zones full size, and the
Remote page (the option, the card, moving it both ways).
`test_update.py` checks looking for a new version, with GitHub's answer simulated (never asked for real): versions compared,
the window (notes as plain text, Download, Later, Skip this version), once a day, nothing by itself in a test browser, when off or
offline, Settings → Updates and Check now.
`test_effects.py` checks the 21 effects added after 1.1.0: they compile, Speed −1..1 on the Speed macro (still at 0, moving at 1, reverse the same
movement backwards), nothing moving but by speed, colours on Color 1 and 2, the filters, a lit thumbnail; and Rainbow's and Plasma's
Colors: Rainbow as before, Color A to B between their two colours (on Color 1 and 2).
`test_stability.py` (full run only, 5 minutes; `test_stability.py <port> <minutes>` for longer) is a show night of
everything at once: scenes, a playlist, every effect, the X-Fader, MIDI, macros, undo, panels resized, the look, the
Scenes window, projects reopened, a phone tapping and fading. A node receives the Art-Net: no gap over 2 s; the JS heap,
GPU objects, compiled effects and the page's elements stay bounded; the same show runs as fast at the end as at the start.
`test_frames.py` checks that the frame rate holds while the interface works: the clock with frames that take most of
their period, the stage's redraws (content, the mouse over panels and stage, hover, dragging) and the pixel under the
mouse, and the stage never shown empty while the bottom panel is resized. `test_drag.py` checks dragging 270 fixtures (mostly turned ovals): an oval's arc kept per shape and exact,
no list redraws for a press on the selection or a finished move, one step of undo, no long output gap, undo giving back
the upright frame of a turned selection. `test_profile_move.py` checks the window profile moving from `~/.openledmapper` or `~/.weft` to `~/.noupix`.
`test_scenes_window.py` checks the Scenes window (opening, playing, levels both ways, menus,
dialogs and messages there, keys, MIDI learn and tags, closing every way). `test_bay.py` checks the patch bay
(the switch, columns, wires, folding, a wire's settings, Remove and Delete, undo, learn, the rows, forgetting and ordering
controls, drawing wires either way, the macros' aluminium wires: pointed at, pinned, picked, removed, drawn, refused). The simulated Web MIDI
is `FAKE_MIDI` in `harness.py`. `test_ndi.py` checks NDI in with a test source sent through the NDI library (`ndi_sender.py`; skipped where the
library isn't installed, `NOUPIX_NDI_LIB` points at one): found, chosen, its picture on the fixtures and following,
about 30 frames a second, Light and Full, files and undo, the source stopping and coming back, choosing another,
removing it, a bridge without NDI. `test_omt.py` checks OMT in against `omt_fake.c`, a stand-in library built from the real
`libomt.h` (needs a C compiler): found, BGRA rows padded past their width arriving as RGBA, preview and full, following,
stopping and coming back. `test_playlist.py` checks playlists
(files, the panel folding and opening, timing and fades, the end, pause and resume, undo, editing while playing, the
fade on a scene's button, play on open, the phone).
