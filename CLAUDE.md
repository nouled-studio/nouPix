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
desktop/               ── Electron window that starts the bridge and loads http://127.0.0.1:<port>/; owns .noupix and
                          .noupixpkg (icons in desktop/resources, made by icons/make_file_icons.py from the two SVGs):
                          a file double-clicked goes to the page's openPath, which has the bridge read it (POST /open-path)
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
| `geometry.js` | Mapping math: each fixture's pixel positions, lengths, bounds, distances; moving, turning, scaling a fixture and the frame around several; the pitch lock (`lockedPitch`, `fitPitch`: the count from the length, the length snapped; `setPixelsAtPitch`, `setPitch`) and a strip's absolute angle and length (`lineAngle`, `setLineAngle`, `setLineLength`) | `computePoints` `rebuildGeometry` `computeBB` `rotateFixture` `scaleFixture` `frameOf` `snap45` `fitPitch` `lineAngle` |
| `patch.js` | Addressing: universe and channels of every pixel on its controller output (`BPP`: channels per pixel, doubled on 16-bit fixtures), conflicts; each controller's outputs (`ctrlOuts`: by universes, or by pixels with each output going on from where the one before ends) and what fits on one (`fitsOn`); its protocol (`isSacn(c)`, `protoName`; `usesSacn`, `usesArtnet`, `outName` for the whole project) and universes as it counts them (`uniLabel(u, c)`: sACN's one higher; with multicast, `sacnMulticast(c)`, a universe is one for every sACN controller) | `computePatch` `ensurePatch` `universes` `ctrlOuts` `fitsOn` `addrOf` `BPP` `assign` `unassign` `isSacn` `uniLabel` `outName` |
| `sources.js` | Content sources (images and videos played from the bridge's media library, `src.media`, `loadLibraryMedia`, `libraryPut`): WebGL canvas, ISF runtimes (compiled when first played or drawn as a thumbnail; `headerOf` reads a header without compiling, `controlsOf` an effect's controls from it, `effectRt` what `macroRolesOf` needs from it), parameters and speeds, images and videos (trim, loop, sound), the media format check, source thumbnails | `runtimeOf` `effectRt` `headerOf` `controlsOf` `isSpeedInput` `renderSource` `applyParams` `probeMedia` `attachMedia` `syncMedia` `videoTick` |
| `render.js` | The GPU mixer (zones, layers, blend modes; the crossfader's even mix; a zone's picture made small for a preview, `mixer.thumb`, read back on WebGL2 through a buffer and a fence so the page never waits for the GPU), looks and fades, recalling a scene, sampling the composition at every pixel, highlight and test patterns | `mixer` `renderContent` `loadSource` `startFade` `recallScene` `sampleMix` `testPattern` `setHighlight` |
| `streams.js` | NDI and OMT in: the streams the project's stream sources want (`syncStreams`, asked of the bridge), frames from the bridge into a canvas per stream that `mediaEls` holds for its sources (`streamFrame`), the sources found and each stream's state | `streams` `syncStreams` `findStreams` `streamFrame` `streamMessage` `streamState` `streamKey` `isStream` `STREAM_PROTOS` |
| `output.js` | Gamma, sampled colours to DMX channels (each fixture's dimmer × its group's (`groupLevel`) × the master; 8-bit; 16-bit through `output16`: dimming curves shaped by gamma or strength, coarse then fine), the outgoing frame (each universe marked Art-Net or sACN, its flags say ArtSync and multicast, `frameFlags`; `oldFrame` for a bridge before 1.4), the clock, the bridge connection | `buildOutput` `output16` `curveValue` `layoutFrame` `sendFrame` `frameFlags` `tick` `startClock` `connectBridge` `bridge` |
| `project-io.js` | Project files: repairing what is opened, undo history, autosave, open/save, packages (`exportPackage`, `openPackage`), CSV, SVG import, the demo | `hydrate` `serialize` `commit` `commitSoft` `undo` `redo` `loadProject` `importSvg` `demoProject` |
| `remote.js` | Remote control: the host side (configure the bridge, send the project and the phones' state, apply devices' changes by role) and the client side (this page opened on a device at `/app`) | `remote` `REMOTE_CLIENT` `mappingLocked` `remoteChanged` `remoteFromDevice` `contentOf` `connectRemote` `remoteOp` |
| `playlists.js` | Playlists: a zone plays some of its scenes in turn on the frame clock; which fade a step uses; play, pause, next, the end; the state devices see | `playlistTick` `playPlaylist` `togglePlaylist` `pausePlaylist` `resumePlaylist` `stepPlaylist` `playlistManual` `stepFade` `playingList` `playElapsed` `playState` |
| `midi.js` | MIDI in: Web MIDI and its ports, messages, the mappings' targets (master, blackout, the crossfader `xf`, group dimmer `gr:<group>`, zone level, scene, next scene, playlist, macro, a control of an effect), pickup and jump, toggle and hold (Follow for a fader, the default when one is learnt onto something on or off), Flash (`mode: 'flash'`: on while held, back as it was when let go; a scene comes back through `zoneBack`, its playlist carrying on), learn | `midi` `startMidi` `setMidiOn` `midiMessage` `midiIn` `midiTarget` `effectTarget` `midiApply` `midiSetLearn` `midiLearnTarget` `midiConnect` `midiSetMap` `midiDisconnect` |
| `actions.js` | What the user can do, whichever button, key or menu asks: fixtures, selection, align/turn/resize, copy and paste, zones and their levels, the crossfader, layers, scenes, playlists, controllers, macros and what an effect follows, an effect's control set everywhere it plays, adding sources from files | `addFixture` `deleteSel` `duplicateSel` `groupSel` `alignSel` `rotateSel` `pasteFixtures` `addZone` `setZoneOpacity` `setXfade` `setXfadeOn` `setXfadeZone` `addLayer` `goScene` `storeScene` `playlistDo` `addPlaylist` `addToPlaylist` `moveStep` `deleteController` `setMacro` `setMacroLink` `setEffectControl` |
| `ui-forms.js` | Building blocks for the panels: rows, inputs, sliders (a value typed on double-click, Shift + scroll in notches; the track filled up to the value, `rangeFill`, kept by the value setter and input events), a group's or zone's colour (`tagSwatches`), segmented buttons, lists that reorder by dragging and their move animation, rows that scroll sideways with ‹ › (`hscroller`), scroll positions kept when a panel is drawn anew (`keepScroll`, `data-keep`), a window this page draws into dressed like it (`dressWindow`) and brought to the front (`raiseWindow`: focus, and `#raise…` for the app to restore it), a short explanation under anything marked `data-tip` ("Title|What it does", `initTips`) | `row` `numRow` `sliderRow` `shiftWheel` `notchFrom` `seg` `checkRow` `reorderable` `flipRows` `hscroller` `keepScroll` `dressWindow` `initTips` |
| `ui-color.js` | The colour picker for shader colour controls: wheel and intensity, RGB, HSV, hex, lighting presets, recent colours | `colorRow` `openColorPicker` `hsvToRgb` `rgbToHsv` |
| `ui-stage.js` | The stage canvas: view and zoom, drawing (its fonts and colours read from the page's, `stageLook`, again when the look changes; the pixels, with 800 or more on screen, as the content seen through a mask of their circles, `dotsMasked`, else each dot in its colour, `drawDots`), zones on the stage, hit testing, handles, tools, pointer, pixel finder, guide image | `drawView` `stageLook` `dotsMasked` `drawDots` `fitView` `setTool` `hitFixture` `dragHandle` `endDrag` `defaultFixtureAt` |
| `ui-lists.js` | The left column: fixture list (groups, badges, drag and drop) and source list (categories, search; its height, `ui.srcH`, dragged on its top edge, `#srcGrip` in app.js) | `renderFxList` `renderSrcList` |
| `ui-inspector.js` | The right panel: fixture (with resolution, dimming curve, its Gamma or Strength slider and the graph, which follows the slider live), multi-selection, group and zone inspectors, Content tab (shader angles with buttons every 45°), video controls, Settings | `renderRight` `onSelection` `showRight` `dimmingRows` `strengthRow` `curveGraph` `isAngle` `anglePresets` |
| `ui-dock.js` | The bottom dock: scenes (with the fade time on each scene's button; the crossfader's strip, `xfadeStrip`, and its previews, `drawXfPreviews`), patch and controller editor (controllers selected with Ctrl or Shift, `selCtrls`, deleted with Delete after asking), the Discovery window (`openDiscovery`, `renderNodes`, a filter by protocol, `ui.discFilter`), the Channel monitor (`openMonitor`: its own window, `olm-monitor`, that this page draws into like the MIDI window; from the button next to Output settings), each output's start and end (`outSpan`); the Scenes window (the scenes and playlists in a popup this page draws into, `olm-scenes`; the Scenes tab says where they are meanwhile) | `renderDock` `onPatchChanged` `refreshScenes` `fadeControl` `openDiscovery` `updateDiscoveryUI` `openMonitor` `updateMonitorUI` `openScenesWindow` `drawScenesWindow` `scenesDoc` `scenesRoots` |
| `ui-playlists.js` | The playlists in the Scenes panel: tabs folded to one line or open, steps (with their own fades, moved by dragging or Alt ← →), step editor, + Add, the New playlist window (order with ↑ ↓, a fade per step), the playlist menu | `playlistArea` `newPlaylistDialog` `playlistMenu` `shiftStep` `drawPlaylistProgress` |
| `ui-menus.js` | The menu system and every menu, the SVG import dialog, copy/cut/paste keys | `menu` `fixtureMenu` `canvasMenu` `projectMenu` … |
| `ui-remote.js` | Remote control in the interface: the top-bar button and menu, the Settings section, the waiting screen on devices, `lockPanel` for operators | `updateRemoteUI` `remoteMenu` `remoteSection` `remoteOverlay` `lockPanel` |
| `ui-macros.js` | The macros panel of the MIDI window (colour parts in HSV or RGB, the shared controls folded; its own binders, `macroBinders`), the "Follows Speed" note under an effect's control, "Macros it follows" in an effect's Parameters (what each control follows, for that effect), the Content tab's values and an open colour picker refreshed once a frame | `macrosPanel` `macroFollows` `macroLinksFold` `syncContentSoon` `updateMacrosUI` |
| `ui-midi.js` | MIDI in the interface: the top-bar button, the MIDI window (a popup this page draws into: Learn, controllers and the macros under them, mappings (while learning, the control just moved at the top with a list to choose its target), monitor, the virtual controller: on-screen faders and pads sent through `midiIn` as port `MIDI_VIRTUAL`), the learn bar, learning by touching anything marked `data-midi` in either window (`midiCapture`; Alt: only that; never a group's arrow), the yellow line and tags on what a control drives, how a mapping moves its target (`midiHow`: Pickup or Jump, Toggle or Hold), the mark a fader on Pickup has to reach | `updateMidiUI` `openMidiWindow` `renderMidiWindow` `midiHow` `midiSlot` `midiButton` `markMidi` `initMidiUI` |
| `ui-bay.js` | The patch bay, the MIDI window's second view (`ui.midiView`: 'list' or 'bay'): controls, targets (output, zones, macros) and effects' controls (colours too) in three columns, a yellow wire per mapping and aluminium wires from a macro to the effect controls that follow it (`bayLinks`, shown for the macro pointed at or pinned; SVG over the columns; dashed into a folded group or past a column's edge), wires drawn by dragging from a dot (`bayDrawStart`, `bayDropAt`: `midiAddMap`, `setMacroLink`), a wire picked with its settings and Remove (Delete, `bayRemoveSel`), rows that move their target, folding (`ui.bayOpen`), controls forgotten (×, `midiForget`) and put in order by dragging (`project.midi.order`, `midiSetOrder`; the list follows) | `bay` `bayView` `bayWires` `bayUpdate` `bayKeys` `bayLinks` `bayDrawStart` |
| `app.js` | Top bar and status bar, the look (black or white: `ui.theme`, the top bar's button and Settings), wiring buttons and keys, the frame loop, `boot()`, and `window.olm`; looking for a new version (the latest release on GitHub, at every start and once a day, a window with Download, Later, Skip this version) | `initUI` `setTheme` `applyTheme` `onKey` `renderAll` `boot` `checkUpdates` `newerVersion` |

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
  `onPatchChanged`, `renderFxList`, `renderSrcList`, `refreshScenes`, `updateUndoButtons`, `updateBridgeUI`, `updateDiscoveryUI`,
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
it, at least 10 or once every 4 frames; fewer when drawing is slow; in the gap after an output frame). A new size clears the stage's canvas: `resizeView` puts the last picture back at once, so resizing a panel never flashes it empty before the next drawing. While the bottom panel's edge is dragged, its height goes on once per drawn frame and the canvas keeps one size, as tall as the window (`holdStage`), taking the stage's size again when the drag ends: a new canvas on every step stalled the output. The pixels on the stage cost the same however many there are: with 800 or more on screen (`MASK_MIN_DOTS`), `dotsMasked` keeps two
layers drawn once, the rings with the dark "off" dots and a mask of the circles (each fixture's as opaque as its dimmer × its
group's level, none for a disabled one), and each redraw draws the content through the mask, dimmed by the master and blackout.
The layers are drawn again when the layout, the look or a level changes, and when the view stays still 200 ms after a zoom or pan
(meanwhile they're scaled). Fewer pixels, or Highlight, draw each dot in the colour it sends (`drawDots`): gamma, curves and
trims show on the real lights only. Moving the mouse redraws the stage only
while dragging, or when the fixture or pixel under it changes (`hoverPixel` looks only through fixtures near it).

### Changing the project

- Edit `project`, then call `markGeom()` if any pixel moved and `markPatch()` if addressing may have changed;
  the next tick recomputes.
- Then `commit()` (a step of undo, autosave, redraw the lists and dock; `commit({ lists: false })` when they show nothing
  of the change, as for fixtures moved, turned or resized) for discrete edits, or `commitSoft()`
  (debounced) while dragging or typing. Redraw the panel you changed (`renderRight()`, …) yourself.
- Keys starting with `_` (`f._pts`, `f._patch`, `f._out`, `f._col`…) are worked out at run time and never saved
  (`replacer` leaves them out of every file and copy).
- A Dot (`type: 'dot'`: `cx`, `cy`, `size`) is a fixture of one pixel, drawn as big as its size (`fixturePitch` is its size, so
  `dotRadius` draws it that big); no pixel count, direction or pitch lock. The Dot tool (D) stays on after each click.
- A scene may have a picture (`sc.thumb`: a small JPEG as a data URL, `SHOT_RE` in `hydrate`): `sceneShot` reads its zone as it
  looks now (`zonePicture` in render.js, which draws a zone the output leaves out first; `mixer.grab`), from the scene's ⋯
  menu, or on storing and updating with `settings.sceneShots` (off by default). The scene's button shows it (`.scene.shot`).
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
- Each controller has its protocol, `c.protocol` (`'artnet'`, the default, or `'sacn'`; files before 1.4 had one for the
  project, `settings.protocol`, which `hydrate` gives every controller and drops); Art-Net and sACN go out together. The
  sACN options are the project's: `sacnPriority` (0 to 200, 100) and `sacnMulticast`. Universes are counted from 0 inside,
  as Art-Net counts them; on an sACN controller every number the interface shows or takes is one higher (`uniLabel(u, c)`;
  Start uni is typed from 1) and the bridge adds the one on the wire, so switching never moves the patch. The frame marks
  each universe sACN with the top bit of its length; its flags are 8 (marked per universe), 1 ArtSync (to Art-Net
  controllers only), 4 multicast; a bridge before 1.4 (no `mixed` in `hello.protocols`) gets the old frame, `oldFrame`.
  The priority goes as `{t: 'sacn', priority}` when it changes. Changing a controller's protocol or multicast is
  `markPatch` (multicast changes what clashes). These options, sending on or off and the frame rate are in the Output
  settings window (`openOutputSettings`, the cog at the right of the Patch tab); the frame rate also in Settings → Output.
- A controller's outputs (`c.mode`): `'universes'`, `c.upo` each, or `'pixels'`, `c.pxOut` pixels of `c.chPx` channels
  each (`CH_PER_PX`), the universes they need worked out (`ctrlOuts`); a fixture past an output's pixels overflows. It
  starts at `c.startUniverse` and `c.startCh`; by universes each next output starts on a new universe at channel 1, by
  pixels on the channel after the last one of the output before it (two outputs can share a universe).
- A strip's or a round circle's pitch can be locked: `f.pitchLock` is the spacing it keeps (absent when unlocked; `hydrate`
  drops anything but a positive number, and keeps none on a matrix or path). Wherever a locked fixture's shape changes
  (an end dragged, a length, radius or sweep typed, `scaleFixture`), `fitPitch` sets its pixel count from its length
  and snaps the length to it; its pixel count typed moves its end (`setPixelsAtPitch`). An oval keeps the lock unused.
- A group's dimmer is `g.level` (0 to 1; absent at 1, so files without dimmed groups don't change): `setGroupLevel`
  sets it and every slider showing it; `buildOutput` multiplies it in.
- Colours: a group (`g.tag`), a zone (`z.tag`) or a scene (`sc.tag`) may have one, a hex from `TAGS`; none (`''`, or no
  `tag` on a scene) is the default: nothing gets one unless the user gives it. Fixtures show their group's (`fxTag`);
  a zone's is its scenes' edge, a scene's its corner mark (`--mark`; red without one), dim and bright while it plays. `hydrate` drops fixtures' colours, and
  the others from files before version 4 (they were given automatically then).
- Files: `{ format: 'noupix-project', version: 4, id, … }`, saved as `.noupix` (JSON; `.json` opens too). Save writes over the file opened or saved (`projectFile`, where the browser lets pages write files; in the app `projectPath`: the file opened by its path, or the place a project download went, which the app tells, `savedToPath`; written by the bridge, `POST /save-path`, only a project, only to a `.noupix` or `.json`; `setProjectFile` sets one and forgets the other), Save as asks, and `ui.autosave` writes every change to it. The project's name follows its file (`nameFromFile` on Save as, the file's name on opening). A scene with `onOpen` (one per zone) is recalled by `loadProject` where no playlist plays on open. The project that opens when nouPix starts (Settings → Startup, `setStartupProject`) is kept by the bridge (`Startup`, `~/.noupix/startup.noupix`, `NOUPIX_STARTUP_FILE`), kept current while it is open (`keepStartupProject`), and sent in `hello` as `startupProject` to the first window after the bridge starts (`--project FILE` gives another); `openStartupProject` opens it. Images and videos are copied into the bridge's media library when added (`storeMedia`, actions.js) and refer to it by name (`src.media`); a package (`.noupixpkg`) is the project and those files, made and read by the bridge. A video with `volFollow` plays at its volume × its zone's level × its layer's opacity (`videoVolume`). `hydrate` (project-io.js) repairs
  anything opened (older versions, openLedMapper and Weft files, hand edits) so the rest of the code can trust the
  project. A new field gets its default there.
- `ui` holds view and selection state; the part listed in `UI_PREFS` is kept between sessions (`savePrefs`, under
  `noupix.ui`; that includes `ui.theme`, which a script in `index.html`'s head applies before anything is drawn).
  What the browser kept under `openledmapper.*` (or `weft.*`) moves to `noupix.*` once (`carryOverStorage`).
- New versions: once the bridge says which version runs (`showVersion`), the main window asks GitHub's API for the latest
  release (`checkUpdates`, from the page, so the browser's own certificates are used), every time it starts (`checkUpdates(false, true)`) and at most once a day while it runs (`ui.updateAt`),
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
- **HTTP triggers:** with remote control on and `remote.cfg.http` (this computer's, sent with the rest of the config), the
  network server answers `GET /trigger/...` (`Remote.trigger`): the bridge asks the main window (`{t: 'rhttp', id, path}`),
  which carries it out through `remoteFromDevice` as the role `http` (`httpTrigger`: scenes, zone levels, master, blackout)
  and answers (`{t: 'rhttp', id, status, body}`, JSON to the caller; no answer in 3 s is a 504). `httpTriggers()` lists
  them, for `/trigger` and the window (`httpDialog`, ui-remote.js).
- **The remote as an app:** `remote.html` links `remote.webmanifest` (start `/remote`, standalone, icons
  `icons/remote-*.png` made from `icons/noupix.svg`) and registers `remote-sw.js` (network first, a cached copy
  of the page and its files when the computer can't be reached). The network server serves them (`REMOTE_FILES`).
  Chrome installs only from a secure address: plain http on the network needs its "insecure origins treated as
  secure" setting; the page's full screen button covers the rest.
- **MIDI** is read by the main window only: a device (`REMOTE_CLIENT`) has no MIDI button and ignores MIDI. The MIDI window
  is a popup (`window.open('', 'olm-midi')`) that the main window draws into with its own code, so the engine stays in
  one place; it closes with the main window. So are the Scenes window (`olm-scenes`) and the Channel monitor (`olm-monitor`). The desktop app lets those
  popups open (`setWindowOpenHandler`). Elements moved into a popup belong to its window: test them with `isEl`, not
  `instanceof Element`; anything that looks things up in the Scenes panel goes through `scenesRoots()`.
- **The operator's lock** is in the interface (`mappingLocked()`: stage, keys, menus, lists, `lockPanel`) for
  convenience, and in `contentOf` for real.

## The bridge (noupix.py)

Python standard library only. Serves `/` and `/index.html`, plain-named `.css`, `.js` and `.woff2` files in `css/`,
`js/` and `js/vendor/` (nothing else), and the WebSocket at `/ws`; with remote control on, the network server described above. The
page sends binary frames (`layoutFrame` in output.js describes the layout) that the bridge turns into Art-Net
packets, or sACN ones (`sacn_packet`, port 5568, universe + 1, to the controller or to `sacn_group`; the sequence per stream,
the CID the same on this computer, `SACN_SOURCE`; `send_sacn_discovery` every 10 s; a stream that ends gets three
Stream_Terminated packets, `_end_stream`, also when its window lets go, `ArtNet.release`), plus JSON messages (discovery polls, settings, remote control). A node's ArtPollReply says what it receives (`parse_poll_reply`: `sacn` from GoodOutputA bit 0, `canSwitch` from Status2 bit 4); the Discovery window tags each device with it, filters by it, and adds a device as a controller on its protocol (a device on sACN even with no Art-Net universes). The page's frame marks each universe Art-Net or sACN (flag 8), so both go out together. **NDI and OMT in** (`VideoIn`, `Ndi`, `Omt`): the bridge loads
the library the user installed (NDI Tools, `--ndi-lib` or `NOUPIX_NDI_LIB`; libomt with libvmx, in `~/.noupix/omt`, `--omt-lib`
or `NOUPIX_OMT_LIB`; nothing bundled) with ctypes, lists the sources (`{t: 'vin', op: 'find'}`) and receives the ones a window asks for (`op: 'sub'`), each on its
own thread, frames cut down to 640 wide (Light, the preview stream) or 1920 (Full) by `shrink_rgba` (OMT's BGRA turned to RGBA), sent to the window
as binary messages starting `VIN1`, newest frame only. libomt is .NET compiled to native code and ends its process when its runtime fails, so the bridge never loads it:
`OmtProcess` runs it in a helper process (this program with `--omt-helper`, `omt_helper`; frames come back cut down and in RGBA), and if
the helper dies the bridge says why in the stream window (its last error lines) and starts a new one 10 s later. **Media library and packages** (`MediaHandler`, mixed into the local
`Handler` only): `POST /media?name=` stores a file in `MEDIA_DIR` (`~/.noupix/media`, `NOUPIX_MEDIA_DIR`) named by its content
(32 hex digits of SHA-256 and its extension, `MEDIA_NAME`), `GET /media/<name>` serves it with ranges, `/media-info` gives
sizes, `POST /media/clean` keeps a list; `POST /package` then `GET /package/<token>/<file>` streams a zip (stored, zip64,
in chunks: `ChunkedWriter`) of `project.noupix` and `media/<name>`, and `POST /package/open` takes one back into the library. Posts from another
site's page are refused (`origin_ok`). **The bridge never ends a connection it could keep:** some firewalls on Windows
(Avast's) turn a connection the server closes into a reset, and the reply is lost. Every reply has a `Content-Length` or
comes in chunks; errors go through `Handler.send_error`, which keeps the connection (Python's own closes it; a body not
read yet is read first, `drain_body`); each ArtPoll goes out twice (`POLL_AGAIN`), as those firewalls also drop the first
UDP packet between two addresses. They can lose a window's close too, so the bridge pings each window every second
(browsers answer by themselves) and lets go of one silent for `WS_SILENT` (`WebSocket.drop`): it never drives the lights
for a window that is gone. A stream source is `{ kind: 'stream', proto: 'ndi' | 'omt', stream:
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
  What's new goes in `docs/releases/<version>.md` (Markdown, before the tag): the release workflow puts it at the top of
  the release page, above the downloads and the list of merged pull requests.

## Tests

`python3 tests/run_tests.py --quick` before every push (about 10 minutes); for a change to MIDI, the macros or the
MIDI window only, `python3 tests/run_tests.py --midi` (static, midi, macros, links, bay, midirep, flash: about 6 minutes) before a push,
and `--quick` (plus `golden`) before merging into main; `python3 tests/run_tests.py` for
everything, including `golden` (the Art-Net bytes of fixed projects must stay identical), the soak test and the UI
fuzzer. Tests drive the page with Playwright through the bridge, and use the global functions and `window.olm`
(app.js), so keep those names working. Each suite is a script in `tests/` that prints PASS/FAIL lines and
`FAILED: none`; add new ones to `SUITES` in `run_tests.py`. `tests/make_examples.py` rebuilds the projects in
`examples/` with the app itself and checks every example file. `test_remote.py` checks remote control end to end
(roles, permissions, phone page, disconnects); `test_remote_app.py` the remote as an installable app and over the
computer's network address; `test_remote_soak.py` (full run only) runs 400 mixed changes from
several devices while every zone plays a playlist, and checks they all end equal. `test_16bit.py` checks 16-bit fixtures down to the Art-Net bytes on the wire (coarse before fine, packing, curves,
strengths, the graph following the sliders, mixed with 8-bit). `test_values.py` checks typed values, Shift + scroll and the angle buttons. `test_pitch.py` checks the pitch lock (strips: ends dragged, pixels, lengths, pitches typed; rings and arcs; resizing several; unlocked as before; files and undo) and a strip's absolute Angle and Length next to the relative Rotate. `test_midi.py` checks MIDI with a controller
simulated in the page (Web MIDI replaced): turning it on, the MIDI window, ports, learn in either order, pickup and jump, toggle and
hold, scenes, next scene, playlists, ignored ports, another port name, saving, undo, missing targets, the line and tags,
the virtual controller. `test_macros.py` checks the macros: what follows what, Speed through the clocks, Intensity,
Saturation, the colours, the shared controls, scenes and thumbnails, files and undo, the Macros section, MIDI onto a
macro and a colour's part, devices. `test_flash.py` checks Flash: a scene while held with its fade and what played before back (its layers as they were, a playlist carrying on), the next scene, levels, master and blackout, a CC button, the MIDI window's choices, undo and files. `test_dot.py` checks the Dot (the tool, the stage, the Inspector, turning and scaling with others, patching, files). `test_shots.py` checks snapshots on scenes (the menu, the button, the setting, a hidden zone, undo, files). `test_http.py` checks HTTP triggers (off by default, the menu and window, scenes by name or id with fade or cut, levels, master, blackout, errors, the X-Fader, the phones following, Settings, the main window gone). `test_links.py` checks what an effect follows as chosen (engine, files, undo, the
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
the window (notes as plain text, Download, Later, Skip this version), at every start and once a day, nothing by itself in a test browser, when off or
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
mouse, the stage never shown empty while the bottom panel is resized, and many pixels drawn through the mask (dimmers, group levels, disabled fixtures, master, blackout; exact dots while highlighting or zoomed in). `test_drag.py` checks dragging 270 fixtures (mostly turned ovals): an oval's arc kept per shape and exact,
no list redraws for a press on the selection or a finished move, one step of undo, no long output gap, undo giving back
the upright frame of a turned selection. `test_profile_move.py` checks the window profile moving from `~/.openledmapper` or `~/.weft` to `~/.noupix`.
`test_scenes_window.py` checks the Scenes window (opening, playing, levels both ways, menus,
dialogs and messages there, keys, MIDI learn and tags, closing every way). `test_bay.py` checks the patch bay
(the switch, columns, wires, folding, a wire's settings, Remove and Delete, undo, learn, the rows, forgetting and ordering
controls, drawing wires either way, the macros' aluminium wires: pointed at, pinned, picked, removed, drawn, refused). `test_midi_report.py` checks the findings of a MIDI test session, fixed: the MIDI window raised (#raise), the list and bay
keeping their scroll, an effect's control showing where its macro takes it, Ctrl+S writing the file by its path, a colour's
swatch following live, the control just learnt playing, as well or (Alt) instead, a group's arrow, a colour's row learnt
as its first part, the Pickup mark, a pad on a fader (Toggle, Hold), removing with undo, a pad's bar let go. The simulated Web MIDI
is `FAKE_MIDI` in `harness.py`. `test_ndi.py` checks NDI in with a test source sent through the NDI library (`ndi_sender.py`; skipped where the
library isn't installed, `NOUPIX_NDI_LIB` points at one): found, chosen, its picture on the fixtures and following,
about 30 frames a second, Light and Full, files and undo, the source stopping and coming back, choosing another,
removing it, a bridge without NDI. `test_omt.py` checks OMT in against `omt_fake.c`, a stand-in library built from the real
`libomt.h` (needs a C compiler): found, BGRA rows padded past their width arriving as RGBA, preview and full, following,
stopping and coming back, and the library ending its process (`FAKE_OMT_ABORT`: the bridge goes on, says why, and starts a new helper). `test_sacn.py` checks sACN out against a receiver that reads E1.31 by the standard (every layer, CID, name, priority,
sequence, universe + 1, unicast and multicast, the discovery packets, three Stream_Terminated packets whenever a stream
ends), one packet byte for byte, and the interface's numbers (Patch, Start uni from 1, menus, monitor, CSV), the Output settings window, multicast
clashes, Art-Net and sACN at once, the Discovery window and its filter, undo, files and their repair (an old project on sACN). `test_startup.py` checks the name following the file, the scene that plays on open, the startup
project (Settings, kept by the bridge, only the first window, following changes, `--project`) and a video's volume following
its zone. The harness gives each test bridge its own (empty) startup project and media library. Tests ask the bridge for
files with `fetch` (harness.py), a kept-open connection as the browser uses, never `urllib` (it asks the server to close
the connection); their WebSocket clients answer the bridge's pings, as browsers do. `test_bridge` checks a window that goes
silent being let go, `test_static` errors keeping their connection, `test_media` the package coming in chunks. `test_media.py` checks the media
library and packages (copied once by content, ranges and seeking, a new session without relinking, the export window and its
sizes, the package streamed or downloaded, opened with an empty library, a project alone asking to relink, cleaning, refusing
other sites). `test_playlist.py` checks playlists
(files, the panel folding and opening, timing and fades, the end, pause and resume, undo, editing while playing, the
fade on a scene's button, play on open, the phone).
