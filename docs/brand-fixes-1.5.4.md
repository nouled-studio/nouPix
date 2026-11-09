# Brand fixes for nouPix 1.5.4

A checklist for Claude Code, from a review of nouPix 1.5.4 against `docs/brand.md` (updated in the same pass) and the
brand guide v1.1. Each item says what is wrong, where it is, and what done looks like. They are small, independent
fixes to the look only: no behaviour changes. Work through them in order; the first ones matter most.

Ground rules (from `CLAUDE.md` and `docs/brand.md`):
- Colours only as tokens (`var(--accent)`, `cssVar('--fader')`…), never a hex. Check every change in the black and in
  the white look.
- Red acts, white is lit, yellow is MIDI only, aluminium is what you move. Red in small doses: a line, an edge, a dot,
  text. Never a red area.
- One primary (red) button per view.
- No emojis, and no text signs that phones turn into emojis or that the app's fonts don't have: use an icon from
  `ICONS` (util.js) or a word.
- Interface text: short, plain, sentence case. `toast()` for messages.
- After the changes, run `python3 tests/run_tests.py --quick`; the suites that touch these parts are `look`, `tempo`,
  `xfade`, `playlist`, `sacn`, `wled`, `remote`, `panels`, `frames`. Update a test only where it checked the old look
  on purpose.
- When an item is done, take its "(today …)" note out of `docs/brand.md` so the doc describes the app again.

## 1. The left panel's button doesn't light (the new button)

`#btnLeft` gets the class `on` while the left panel shows (`showLeft`, ui-inspector.js), but only `#btnRight.on` has a
style (css/app.css, line 119). So the two buttons at the ends of the stage bar don't match: the right one is outlined
in red while its panel shows, the left one never is.

Done: `#btnLeft.on, #btnRight.on { color: var(--accent); border-color: var(--accent); }`. Both buttons look the same
in both looks, red while their panel shows and plain while it is folded.

## 2. Tempo's spectrum: a red area, red handles, a label lost in the bars

`drawSpectrum` (js/ui-tempo.js, around lines 100–126):
- the beat band is filled red at 16% (line 107): a red area;
- its two edges are drawn red (line 123), but they are what the user drags, which is aluminium (`--fader`);
- the range ("40–150 Hz") is written straight over the bars (line 124–126) and can't be read when they are high.

Done:
- No red fill under the band. Mark it with a faint neutral fill instead (`--fader` at about 8%, or `--bg4`), or none:
  its bars are already aluminium and the others grey.
- The edges in `--fader`, 2 px as now, and `--text` while one is dragged or under the pointer.
- The label on a small tag: a `--bg2` rectangle a little larger than the text, then the text in `--text2`, so it
  reads over any bar. Keep it inside the canvas as now.
- Check the trace under it is unchanged (aluminium line, grey ticks, red on beat 1).

## 3. Messages: news looks like an error

`.toast` (css/app.css, line 863) has a red left edge (`--accent`), and `.toast.err` uses `--danger`, which is the same
red. So "Patched 7 fixtures onto Left controller" looks exactly like "Could not open the file."

Done: plain news gets `border-left: 3px solid var(--line3)`; `warn` stays orange, `err` stays red. Check both looks.
Update the brand guide's writing page note when the guide is next rebuilt ("a grey line for news").

## 4. Two primary buttons in Discovery

The Discovery window (js/ui-dock.js) has **Discover** (line 644) and **Done** (line 622) both as `btn primary`.

Done: Discover stays primary; Done becomes a plain `btn`. Do the same where a window's only button just closes it:
Output settings (js/ui-inspector.js, line 713) and the HTTP triggers window (js/ui-remote.js, line 101). Leave Done
focused by default where it is today.

## 5. "SACN" in the Output settings window

The section heads `h4` in Output settings are set uppercase by `.modal .mb.outset h4` (css/app.css, line 855), so
"sACN" (js/ui-inspector.js, line 627) shows as SACN. Protocol names keep their case.

Done: in that window the head reads **sACN** (lowercase s). For example wrap the name in a span with
`text-transform: none`, or give the h4 a class that keeps case and set the label voice's letter-spacing on it. Look
for other places where Art-Net, sACN or DDP sit inside an uppercased label (menus, the Patch tab's heads, the
Discovery table's "Art-Net universes" header) and do the same.

## 6. Signs that turn into emojis, or come out in another font

- `▶ ` before the scene's name on the phone (js/remote-app.js, line 206): iOS and Android may draw it as a coloured
  emoji. Use the `play` icon (the phone's `ICON.play`) at the text's size, or no sign: the card already shows it plays.
- `▶ ` and `❚❚ ` before a playlist's name in the zone's menu (js/ui-menus.js, line 289): use the `play` / `pause` icons
  from `ICONS`, as the playlist tabs do.
- `⚙` in the bridge pill's tooltip (js/app.js, line 104): write "Output settings" without the sign (there is no gear
  icon in the app; the button uses `output`). Also fix the comment at js/ui-inspector.js, line 697.
- `◢` before fade times (js/ui-dock.js, line 168; js/ui-playlists.js, line 108): Saira has no such glyph, so it comes
  from a system font and looks different on each computer. Draw it as a small inline SVG triangle (`currentColor`),
  or a CSS `::before` with a clip-path triangle, the size it is now.
- `↺` `↻` on the Rotate buttons (js/ui-inspector.js, line 760): same problem. Add two icons to `ICONS`
  (`rotL`, `rotR`, 16 × 16, 1.4 stroke, round caps, an open arc with an arrowhead) and use them before "90°" and "15°".

Done: `grep -nP "[▶❚⚙◢↺↻]" js/*.js remote.html index.html` finds nothing, and the places look the same on macOS,
Windows and a phone.

## 7. The X-Fader's mode menu: pictures without words

The mode list (js/ui-dock.js, line 263) shows only the three small graphs; their names are only in `title`. A symbol
where a word is clearer is one of the brand's don'ts.

Done: each item shows its graph and then its name, **Mix**, **Dip**, **Cut**, in the menu's usual text; the short
explanation stays as the tooltip. The button itself keeps only the graph.

## 8. Small things

- The password field in Settings → Remote control shows "Needed for prograi…" (placeholder cut off,
  js/ui-remote.js, line 49). Shorten it to "For programmers".
- `tool-dot` (index.html, line 85) and the `dot` icon in `ICONS` are drawn differently but mean the same: make them one
  drawing (the 18 × 18 tool version scaled for 16 × 16), so one icon has one meaning.
- `.ptab:focus-visible` (css/app.css, line 595) uses a 1 px outline inside the tab; the brand's focus is a 2 px red
  outline 1 px away. Use `outline: 2px solid var(--accent); outline-offset: 1px` (or `-2px` if the tab row clips it).
- The phone remote draws its own play, pause, next and list icons (js/remote-app.js, lines 20–26) on a 24 grid; keep
  them, but make their shapes match `ICONS` (the pause bars with the same .5 corner, the list with the playlist
  icon's triangle) so the two read as one set.

## Not to change

- Source thumbnails and the content on the stage are the user's colours: the brand rules don't apply to them.
- The Channel monitor's cells in their channel's colour, and its ink chosen by brightness (js/ui-dock.js, line 848):
  that is data, fine as is.
- The colour picker's lighting presets (js/ui-color.js, lines 25–26): colours to choose from, fine.
- The rings drawn with `box-shadow` (MIDI learn, a pinned row in the patch bay, the drop target): outlines, not drop
  shadows. Fine.

## When done

- `docs/brand.md`: remove the "(today …)" notes of the items fixed (Tempo, messages, primary buttons, sACN, the left
  button).
- Release notes for the next version: one line, "The look: the left panel's button lights like the right one, clearer
  messages, the beat band's handles in aluminium, no emoji-like signs."
