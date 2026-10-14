# Examples

Files to open or import in openLedMapper, to see what it does without building a layout first.
The projects have no real network behind them: their controllers use made-up 10.0.0.x addresses, so point them
at your own controllers (in the Patch tab of the dock) before sending.

| File | What it is | How to open it |
|---|---|---|
| `01-led-bars.json` | Twelve 1 m vertical bars, 60 pixels each, in two groups, on one 4-output controller; bars wired alternately from the top. Scenes: scanner, rain, equalizer, fire, strobe, and a Show playlist of them that starts when the project opens. | Project menu > Open project… |
| `02-matrix-wall.json` | Four 32 × 32 panels with snaking rows on two controllers, 28 universes. A second zone over one panel, at opacity 0: raise it to play a checkerboard there. | Project menu > Open project… |
| `03-rings-and-arcs.json` | Full rings, half-ring arcs drawn both ways, an oval and a ring wired anticlockwise in GRB. | Project menu > Open project… |
| `04-stage-mixed.json` | Everything together: RGBW strips (GRBW), a curved path, a matrix turned 45°, 16-bit rings (square law, and an S curve at 150 % strength) with trims and dimmer, a locked and disabled spare, gamma 2.2, pixels split across universes, an advanced patch start address, three zones with blend modes, playlists (Evening, and Party that hands back to Evening; the truss alternating on its own). | Project menu > Open project… |
| `05-facade.svg` | A building front drawn as lines, a circle, an ellipse, rectangles and paths, with names. | Project menu > Import SVG… (or SVG… above the fixture list), then Import |
| `06-GradientBounce.fs` | A small custom ISF shader with colour, number and on/off controls, commented, to start your own from. | Sources: + Add > ISF shader file (.fs)… |
| `07-test-clip.webm` | A 6-second 320 × 180 test video with sound, to try trim, loop or once, and sound. | Sources: + Add > Image or video file… |

The four projects are made by `tests/make_examples.py`, which builds them with the app itself so they stay in
the current file format, then opens every example file and checks it (also part of `tests/run_tests.py`).
