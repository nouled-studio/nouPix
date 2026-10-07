# openLedMapper: architecture and conventions

A pixel-mapping tool for LED installations. The interface is a web page; a small Python program, the bridge,
serves it and turns its frames into Art-Net. The desktop apps are an Electron window around the page, with the
bridge packed inside.

```
index.html, css/, js/  ── the interface (browser): fixtures, content, scenes, patch; renders and builds DMX
        │  WebSocket /ws: JSON messages + binary frames of universes
openledmapper.py       ── the bridge (Python 3.8+, standard library only): serves the page, sends Art-Net
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
| `model.js` | The project and its parts: constants, defaults, the `project` and `ui` state, factories, groups, selection, look-ups by id | `project` `ui` `blankProject` `newFixture` `newZone` `newLayer` `newController` `selected` `selUnits` `fxById` `markGeom` `markPatch` |
| `geometry.js` | Mapping math: each fixture's pixel positions, lengths, bounds, distances; moving, turning, scaling a fixture and the frame around several | `computePoints` `rebuildGeometry` `computeBB` `rotateFixture` `scaleFixture` `frameOf` `snap45` |
| `patch.js` | Addressing: universe and channels of every pixel on its controller output, conflicts | `computePatch` `ensurePatch` `universes` `addrOf` `assign` `unassign` |
| `sources.js` | Content sources: WebGL canvas, ISF runtimes, parameters and speeds, images and videos (trim, loop, sound), the media format check, source thumbnails | `runtimeOf` `renderSource` `applyParams` `probeMedia` `attachMedia` `syncMedia` `videoTick` |
| `render.js` | The GPU mixer (zones, layers, blend modes), looks and fades, sampling the composition at every pixel, highlight and test patterns | `mixer` `renderContent` `loadSource` `startFade` `sampleMix` `testPattern` `setHighlight` |
| `output.js` | Gamma, sampled colours to DMX channels, the outgoing frame, the clock, the bridge connection | `buildOutput` `layoutFrame` `sendFrame` `tick` `startClock` `connectBridge` `bridge` |
| `project-io.js` | Project files: repairing what is opened, undo history, autosave, open/save, CSV, SVG import, the demo | `hydrate` `serialize` `commit` `commitSoft` `undo` `redo` `loadProject` `importSvg` `demoProject` |
| `actions.js` | What the user can do, whichever button, key or menu asks: fixtures, selection, align/turn/resize, copy and paste, zones, layers, scenes, controllers, adding sources from files | `addFixture` `deleteSel` `duplicateSel` `groupSel` `alignSel` `rotateSel` `pasteFixtures` `addZone` `addLayer` `goScene` `storeScene` `deleteController` |
| `ui-forms.js` | Building blocks for the panels: rows, inputs, segmented buttons, lists that reorder by dragging and their move animation | `row` `numRow` `sliderRow` `seg` `checkRow` `reorderable` `flipRows` |
| `ui-color.js` | The colour picker for shader colour controls: wheel and intensity, RGB, HSV, colour temperature, hex, lighting presets, recent colours | `colorRow` `openColorPicker` `hsvToRgb` `rgbToHsv` `kelvinToRgb` |
| `ui-stage.js` | The stage canvas: view and zoom, drawing, zones on the stage, hit testing, handles, tools, pointer, pixel finder, guide image | `drawView` `fitView` `setTool` `hitFixture` `dragHandle` `endDrag` `defaultFixtureAt` |
| `ui-lists.js` | The left column: fixture list (groups, badges, drag and drop) and source list (categories, search) | `renderFxList` `renderSrcList` |
| `ui-inspector.js` | The right panel: fixture, multi-selection, group and zone inspectors, Content tab, video controls, Settings | `renderRight` `onSelection` `showRight` |
| `ui-dock.js` | The bottom dock: scenes, patch and controller editor, Art-Net nodes, DMX monitor | `renderDock` `onPatchChanged` `refreshScenes` `autoPatch` |
| `ui-menus.js` | The menu system and every menu, the SVG import dialog, copy/cut/paste keys | `menu` `fixtureMenu` `canvasMenu` `projectMenu` … |
| `app.js` | Top bar and status bar, wiring buttons and keys, the frame loop, `boot()`, and `window.olm` | `initUI` `onKey` `renderAll` `boot` |

### How the files fit together

- **Plain scripts, one shared scope.** No modules, no bundler, no build step: the page must also open straight
  from disk (file://), where browsers refuse JavaScript modules. Every top-level `function`, `const` and `let`
  is visible to every file, exactly as when the app was one script. A name is defined once, in one file.
- **Load order.** Code that runs while the page loads (constants, the WebGL canvas, the mixer, listeners on the
  stage canvas and the document, the autosave timer) may only use what earlier files define. Everything else runs
  later, after `boot()` at the end of `app.js`, when all files are there. A function used at load time from an
  earlier file doesn't exist yet: functions are only hoisted within their own file.
- **Layers.** The engine is `util → model → geometry → patch → sources → render → output → project-io`; each
  uses only the ones before it, with one exception: `computePatch` ends with `layoutFrame` (output.js) so the
  outgoing frame matches the new patch. The UI is `actions → ui-forms → ui-color, ui-stage, ui-lists, ui-inspector,
  ui-dock, ui-menus → app`; UI files use any engine file and each other.
- **The engine calls the UI only to redraw**, through these: `renderAll`, `renderRight`, `renderDock`,
  `onPatchChanged`, `renderFxList`, `renderSrcList`, `refreshScenes`, `updateUndoButtons`, `updateBridgeUI`,
  `updateHighlightUI`, `showVersion`, `keepAwake`, `loadGuide`. Keep it to that list.
- **Not strict mode.** The scripts run without `'use strict'`, as the app always has. Don't add the directive to a
  file without testing everything: it changes what some code does.

### Each frame

`startClock` runs `tick()` at the project's fps (in a worker timer, so it keeps going in the background):
`rebuildGeometry` if `geomDirty` → `ensurePatch` if `patchDirty` → `renderContent` (or `testPattern` while
highlighting) → `updateThumbs`, `syncMedia`, `videoTick` → `buildOutput` → `sendFrame` when Art-Net is on.
Drawing the stage is separate: `frameLoop` in app.js redraws on `requestAnimationFrame` when something changed.

### Changing the project

- Edit `project`, then call `markGeom()` if any pixel moved and `markPatch()` if addressing may have changed;
  the next tick recomputes.
- Then `commit()` (a step of undo, autosave, redraw the lists and dock) for discrete edits, or `commitSoft()`
  (debounced) while dragging or typing. Redraw the panel you changed (`renderRight()`, …) yourself.
- Keys starting with `_` (`f._pts`, `f._patch`, `f._out`, `f._col`…) are worked out at run time and never saved
  (`replacer` leaves them out of every file and copy).
- Files: `{ format: 'openledmapper-project', version: 3, … }`. `hydrate` (project-io.js) repairs anything opened
  (older versions, Weft files, hand edits) so the rest of the code can trust the project. A new field gets its
  default there.
- `ui` holds view and selection state; the part listed in `UI_PREFS` is kept between sessions (`savePrefs`).

## The bridge (openledmapper.py)

Python standard library only. Serves `/` and `/index.html`, plain-named files in `css/`, `js/` and `js/vendor/`
(nothing else), and the WebSocket at `/ws`. The page sends binary frames (`layoutFrame` in output.js describes
the layout) that the bridge turns into Art-Net packets, plus JSON messages (discovery polls, settings). `VERSION`
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
`examples/` with the app itself and checks every example file.
