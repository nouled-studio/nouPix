# openLedMapper: architecture and conventions

A pixel-mapping tool for LED installations. The interface is a web page; a small Python program, the bridge,
serves it and turns its frames into Art-Net. The desktop apps are an Electron window around the page, with the
bridge packed inside.

```
index.html, css/, js/  ── the interface (browser): fixtures, content, scenes, playlists, patch; renders and builds DMX
        │  WebSocket /ws: JSON messages + binary frames of universes
openledmapper.py       ── the bridge (Python 3.8+, standard library only): serves the page, sends Art-Net
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
| `builtins.js` | The 32 built-in effects, as ISF code and categories (data) | `BUILTINS` |
| `util.js` | Helpers used everywhere: elements, numbers and text, local storage, toasts, error reports, icons | `$` `$$` `h` `clamp` `wrap180` `wrap360` `pct` `fmtN` `store` `toast` `debounce` `report` `replacer` `MOD` |
| `model.js` | The project and its parts: constants (`CURVES`, `CURVE_STRENGTH`), defaults, the `project` and `ui` state, factories, groups, selection, look-ups by id | `project` `ui` `blankProject` `newFixture` `fxBits` `fxCurve` `curveParam` `newZone` `newLayer` `newPlaylist` `newStep` `newController` `selected` `selUnits` `fxById` `markGeom` `markPatch` |
| `geometry.js` | Mapping math: each fixture's pixel positions, lengths, bounds, distances; moving, turning, scaling a fixture and the frame around several | `computePoints` `rebuildGeometry` `computeBB` `rotateFixture` `scaleFixture` `frameOf` `snap45` |
| `patch.js` | Addressing: universe and channels of every pixel on its controller output (`BPP`: channels per pixel, doubled on 16-bit fixtures), conflicts | `computePatch` `ensurePatch` `universes` `addrOf` `BPP` `assign` `unassign` |
| `sources.js` | Content sources: WebGL canvas, ISF runtimes (compiled when first played or drawn as a thumbnail; `headerOf` reads a header without compiling), parameters and speeds, images and videos (trim, loop, sound), the media format check, source thumbnails | `runtimeOf` `headerOf` `renderSource` `applyParams` `probeMedia` `attachMedia` `syncMedia` `videoTick` |
| `render.js` | The GPU mixer (zones, layers, blend modes), looks and fades, recalling a scene, sampling the composition at every pixel, highlight and test patterns | `mixer` `renderContent` `loadSource` `startFade` `recallScene` `sampleMix` `testPattern` `setHighlight` |
| `output.js` | Gamma, sampled colours to DMX channels (8-bit; 16-bit through `output16`: dimming curves shaped by gamma or strength, coarse then fine), the outgoing frame, the clock, the bridge connection | `buildOutput` `output16` `curveValue` `layoutFrame` `sendFrame` `tick` `startClock` `connectBridge` `bridge` |
| `project-io.js` | Project files: repairing what is opened, undo history, autosave, open/save, CSV, SVG import, the demo | `hydrate` `serialize` `commit` `commitSoft` `undo` `redo` `loadProject` `importSvg` `demoProject` |
| `remote.js` | Remote control: the host side (configure the bridge, send the project and the phones' state, apply devices' changes by role) and the client side (this page opened on a device at `/app`) | `remote` `REMOTE_CLIENT` `mappingLocked` `remoteChanged` `remoteFromDevice` `contentOf` `connectRemote` `remoteOp` |
| `playlists.js` | Playlists: a zone plays some of its scenes in turn on the frame clock; which fade a step uses; play, pause, next, the end; the state devices see | `playlistTick` `playPlaylist` `togglePlaylist` `pausePlaylist` `resumePlaylist` `stepPlaylist` `playlistManual` `stepFade` `playingList` `playElapsed` `playState` |
| `midi.js` | MIDI in: Web MIDI and its ports, messages, the mappings' targets (master, blackout, zone level, scene, next scene, playlist), pickup and jump, toggle and hold, learn | `midi` `startMidi` `setMidiOn` `midiMessage` `midiIn` `midiTarget` `midiApply` `midiSetLearn` `midiLearnTarget` `midiConnect` `midiSetMap` `midiDisconnect` |
| `actions.js` | What the user can do, whichever button, key or menu asks: fixtures, selection, align/turn/resize, copy and paste, zones, layers, scenes, playlists, controllers, adding sources from files | `addFixture` `deleteSel` `duplicateSel` `groupSel` `alignSel` `rotateSel` `pasteFixtures` `addZone` `addLayer` `goScene` `storeScene` `playlistDo` `addPlaylist` `addToPlaylist` `moveStep` `deleteController` |
| `ui-forms.js` | Building blocks for the panels: rows, inputs, sliders (a value typed on double-click, Shift + scroll in notches), segmented buttons, lists that reorder by dragging and their move animation | `row` `numRow` `sliderRow` `shiftWheel` `notchFrom` `seg` `checkRow` `reorderable` `flipRows` |
| `ui-color.js` | The colour picker for shader colour controls: wheel and intensity, RGB, HSV, hex, lighting presets, recent colours | `colorRow` `openColorPicker` `hsvToRgb` `rgbToHsv` |
| `ui-stage.js` | The stage canvas: view and zoom, drawing, zones on the stage, hit testing, handles, tools, pointer, pixel finder, guide image | `drawView` `fitView` `setTool` `hitFixture` `dragHandle` `endDrag` `defaultFixtureAt` |
| `ui-lists.js` | The left column: fixture list (groups, badges, drag and drop) and source list (categories, search) | `renderFxList` `renderSrcList` |
| `ui-inspector.js` | The right panel: fixture (with resolution, dimming curve, its Gamma or Strength slider and the graph, which follows the slider live), multi-selection, group and zone inspectors, Content tab (shader angles with buttons every 45°), video controls, Settings | `renderRight` `onSelection` `showRight` `dimmingRows` `strengthRow` `curveGraph` `isAngle` `anglePresets` |
| `ui-dock.js` | The bottom dock: scenes (with the fade time on each scene's button), patch and controller editor, Art-Net nodes, DMX monitor | `renderDock` `onPatchChanged` `refreshScenes` `fadeControl` `autoPatch` |
| `ui-playlists.js` | The playlists in the Scenes panel: tabs folded to one line or open, steps (with their own fades, moved by dragging or Alt ← →), step editor, + Add, the New playlist window (order with ↑ ↓, a fade per step), the playlist menu | `playlistArea` `newPlaylistDialog` `playlistMenu` `shiftStep` `drawPlaylistProgress` |
| `ui-menus.js` | The menu system and every menu, the SVG import dialog, copy/cut/paste keys | `menu` `fixtureMenu` `canvasMenu` `projectMenu` … |
| `ui-remote.js` | Remote control in the interface: the top-bar button and menu, the Settings section, the waiting screen on devices, `lockPanel` for operators | `updateRemoteUI` `remoteMenu` `remoteSection` `remoteOverlay` `lockPanel` |
| `ui-midi.js` | MIDI in the interface: the top-bar button, the MIDI window (a popup this page draws into: Learn, controllers, mappings, monitor), the learn bar, learning by touching anything marked `data-midi`, the yellow line and tags on what a control drives | `updateMidiUI` `openMidiWindow` `renderMidiWindow` `midiSlot` `midiButton` `markMidi` `initMidiUI` |
| `app.js` | Top bar and status bar, wiring buttons and keys, the frame loop, `boot()`, and `window.olm` | `initUI` `onKey` `renderAll` `boot` |

### How the files fit together

- **Plain scripts, one shared scope.** No modules, no bundler, no build step: the page must also open straight
  from disk (file://), where browsers refuse JavaScript modules. Every top-level `function`, `const` and `let`
  is visible to every file, exactly as when the app was one script. A name is defined once, in one file.
- **Load order.** Code that runs while the page loads (constants, the WebGL canvas, the mixer, listeners on the
  stage canvas and the document, the autosave timer) may only use what earlier files define. Everything else runs
  later, after `boot()` at the end of `app.js`, when all files are there. A function used at load time from an
  earlier file doesn't exist yet: functions are only hoisted within their own file.
- **Layers.** The engine is `util → model → geometry → patch → sources → render → output → project-io → remote →
  playlists → midi`; each uses only the ones before it, with these exceptions: `computePatch` ends with `layoutFrame` (output.js)
  so the outgoing frame matches the new patch; `tick` (output.js) calls `playlistTick`; `restore` (project-io.js) uses
  `playlistOf`/`playingList` to carry playlists through an undo; remote.js reads the playlists' state (`playState`,
  `playForPhone`) for the devices; `hydrate` repairs the MIDI mappings with `MIDI_KEY` (model.js). The UI is `actions → ui-forms → ui-color, ui-stage, ui-lists, ui-inspector,
  ui-dock, ui-menus → app`; UI files use any engine file and each other.
- **The engine calls the UI only to redraw**, through these: `renderAll`, `renderRight`, `renderDock`,
  `onPatchChanged`, `renderFxList`, `renderSrcList`, `refreshScenes`, `updateUndoButtons`, `updateBridgeUI`,
  `updateHighlightUI`, `showVersion`, `keepAwake`, `loadGuide`, and for remote control `updateRemoteUI`,
  `remoteOverlay`, `redrawStage`, and for MIDI `updateMidiUI`. Keep it to that list. (`remote.js` and `midi.js` also call
  the actions they carry out for devices and controllers: `goScene`, `setZoneOpacity`, `toggleBlackout`, `playlistDo`.) `refreshScenes` waits while something in the
  Scenes panel is dragged or typed in, so a playlist moving on doesn't break the user's drag.
- **Not strict mode.** The scripts run without `'use strict'`, as the app always has. Don't add the directive to a
  file without testing everything: it changes what some code does.

### Each frame

`startClock` runs `tick()` at the project's fps (in a worker timer, so it keeps going in the background):
`rebuildGeometry` if `geomDirty` → `ensurePatch` if `patchDirty` → `playlistTick` (main window only: steps whose play
time is up move on, through `recallScene`) → `renderContent` (or `testPattern` while
highlighting) → `updateThumbs`, `syncMedia`, `videoTick` → `buildOutput` → `sendFrame` when Art-Net is on.
Drawing the stage is separate: `frameLoop` in app.js redraws on `requestAnimationFrame` when something changed.

### Changing the project

- Edit `project`, then call `markGeom()` if any pixel moved and `markPatch()` if addressing may have changed;
  the next tick recomputes.
- Then `commit()` (a step of undo, autosave, redraw the lists and dock) for discrete edits, or `commitSoft()`
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
- Files: `{ format: 'openledmapper-project', version: 3, … }`. `hydrate` (project-io.js) repairs anything opened
  (older versions, Weft files, hand edits) so the rest of the code can trust the project. A new field gets its
  default there.
- `ui` holds view and selection state; the part listed in `UI_PREFS` is kept between sessions (`savePrefs`).

## Remote control

- **Servers:** the local server (`/`, `/ws`) is only reachable from this computer. With remote control on, the
  bridge's `Remote` class opens a second server on all network cards that serves `login.html` (`/`), `index.html`
  (`/app`), `remote.html` (`/remote`), the css/js files, `POST /login`, `/info`, and the devices' WebSocket `/rws`.
- **Roles:** `POST /login` gives a token for a role: `programmer` (password, compared in constant time, wrong ones
  slowed and locked out per address), `operator` or `remote`. The bridge passes every device message to the main
  window as `{t: 'rmsg', cid, role, m}`. The role comes from the token, never from the device.
- **The main window decides** (`remoteFromDevice`): `remote` may only play scenes and playlists and set zone levels;
  `operator` and `programmer` also the master and blackout, and send their whole project. An operator's project goes
  through `contentOf`, which keeps everything but the zones' layers, scenes, levels and playlists and the shaders. A programmer's
  replaces the project. The main window then sends the result to every device (`remoteChanged`, after every
  `pushHistory` and `restore`).
- **A device** (`REMOTE_CLIENT`, the page at `/app`) loads nothing from local storage and saves nothing. It sends its
  project after changes, with a sequence number. It applies the main window's copy only when that copy has its last
  change (`acks`), and not while the user drags or types. Scene changes and zone levels also go as small operations
  (`remoteOp`), so the main window fades and dims live; so do play, pause and next of playlists (`playlistDo`), which
  only the main window plays: devices show where they are from the `live` message (`play`). A device never sends
  Art-Net (`setOutput` does nothing), and can't add files or screen capture.
- **The remote as an app:** `remote.html` links `remote.webmanifest` (start `/remote`, standalone, icons
  `icons/remote-*.png` made from `icons/openledmapper.svg`) and registers `remote-sw.js` (network first, a cached copy
  of the page and its files when the computer can't be reached). The network server serves them (`REMOTE_FILES`).
  Chrome installs only from a secure address: plain http on the network needs its "insecure origins treated as
  secure" setting; the page's full screen button covers the rest.
- **MIDI** is read by the main window only: a device (`REMOTE_CLIENT`) has no MIDI button and ignores MIDI. The MIDI window
  is a popup (`window.open('', 'olm-midi')`) that the main window draws into with its own code, so the engine stays in
  one place; it closes with the main window. The desktop app lets that one popup open (`setWindowOpenHandler`).
- **The operator's lock** is in the interface (`mappingLocked()`: stage, keys, menus, lists, `lockPanel`) for
  convenience, and in `contentOf` for real.

## The bridge (openledmapper.py)

Python standard library only. Serves `/` and `/index.html`, plain-named files in `css/`, `js/` and `js/vendor/`
(nothing else), and the WebSocket at `/ws`; with remote control on, the network server described above. The
page sends binary frames (`layoutFrame` in output.js describes the layout) that the bridge turns into Art-Net
packets, plus JSON messages (discovery polls, settings, remote control). `VERSION`
is the app's version; it shows next to the name in the top bar. `openledmapper.spec` packs the bridge and the
interface files for the desktop apps; `.github/workflows/release.yml` builds them when a `v<VERSION>` tag is
pushed.

## Conventions

- **Code style:** match the file around you: two-space indents, single quotes, semicolons, `camelCase`,
  `UPPER_CASE` for constant tables. Elements are built with `h(tag, attrs, ...children)`; small helpers over
  classes. Comments are plain sentences that say why or what for, above the code they describe.
- **Interface text:** short plain sentences, sentence case, no jargon where a word will do. Messages to the user go
  through `toast()`. Shortcuts are shown with `MOD` (⌘ on a Mac, Ctrl elsewhere).
- **No dependencies** in the interface or the bridge. Third-party code goes in `js/vendor/` unchanged, with its
  licence noted.
- **A new file in js/:** add its `<script src>` tag in the right place in `index.html` (nothing else needed: the
  bridge serves it and the desktop build packs the whole folder), and add it to the table above.
- **Versions:** bump `VERSION` in `openledmapper.py`, `desktop/package.json` (and its lock file), the README
  title and the user guide's first line together.

## Tests

`python3 tests/run_tests.py --quick` before every push (about 10 minutes); `python3 tests/run_tests.py` for
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
hold, scenes, next scene, playlists, ignored ports, another port name, saving, undo, missing targets, the line and tags. `test_playlist.py` checks playlists
(files, the panel folding and opening, timing and fades, the end, pause and resume, undo, editing while playing, the
fade on a scene's button, play on open, the phone).
