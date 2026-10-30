# Fixture groups: list, selection on the stage, dragging in and out, patching, ungroup, duplicate, delete,
# Arrange with groups, save and load; a group's dimmer (Inspector, list, output, file, undo, MIDI)
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import CHROME_ARGS, start_bridge
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8198
bridge = start_bridge(PORT)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:400] if detail != "" else ""), flush=True); ok or fails.append(name)

with sync_playwright() as p:
    br = p.chromium.launch(args=CHROME_ARGS); pg = br.new_page(viewport={"width": 1440, "height": 1000})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_function("window.olm && olm.bridge.connected")
    ev = pg.evaluate
    def demo():
        ev("localStorage.clear(); olm.loadProject(demoProject()); olm.ui.sel = new Set(); onSelection(); setTool('select')"); time.sleep(0.5)
    # the list as text: [G] for a group's header (+ if folded), '  ' before a fixture inside a group
    rows = lambda: ev("[...document.querySelectorAll('#fxList li')].map(li => (li.classList.contains('grp') ? '[' + li.querySelector('.nm').firstChild.textContent + (li.classList.contains('shut') ? '+' : '') + ']' : (li.classList.contains('in') ? ' ' : '') + li.querySelector('.nm').firstChild.textContent)).join(',')")
    order = lambda: ev("olm.project.fixtures.map(f => f.name + (f.group ? '@' + olm.project.groups.find(g => g.id === f.group).name : '')).join(',')")
    sel = lambda: ev("olm.project.fixtures.filter(f => olm.ui.sel.has(f.id)).map(f => f.name).join(',')")
    li_fx = lambda name: pg.locator(f"#fxList li[data-id='{ev('n => olm.project.fixtures.find(f => f.name === n).id', name)}']")
    li_grp = lambda name: pg.locator(f"#fxList li[data-group='{ev('n => olm.project.groups.find(g => g.name === n).id', name)}']")
    def drop_on(src, dst, part):   # part: 'top' or 'bottom' half of the target row, or 'end' (under the list)
        if part == "end":
            b = pg.locator("#fxList").bounding_box()
            src.drag_to(pg.locator("#fxList"), target_position={"x": 40, "y": b["height"] - 8})
        else:
            b = dst.bounding_box()
            src.drag_to(dst, target_position={"x": 60, "y": 5 if part == "top" else b["height"] - 5})
        time.sleep(0.3)
    def stage_xy(name, t=0.5):     # a point on a fixture, in page coordinates
        return ev("""([n, t]) => { const f = olm.project.fixtures.find(f => f.name === n), r = document.querySelector('#view').getBoundingClientRect();
          let x, y; if (f.type === 'line') { x = f.x1 + (f.x2 - f.x1) * t; y = f.y1 + (f.y2 - f.y1) * t; } else if (f.type === 'circle') { x = f.cx + f.r; y = f.cy; } else { x = f.cx; y = f.cy; }
          const [sx, sy] = toS(x, y); return [r.left + sx, r.top + sy]; }""", [name, t])

    # ---- the demo has two groups; the list shows headers and indented fixtures
    demo()
    check("demo list shows the Strips and Rings groups", rows() == "Panel A,[Strips], Strip 1, Strip 2, Strip 3, Strip 4,[Rings], Ring 1, Ring 2, Ring 3,Wave", rows())
    # ---- clicking a group's name selects all of it; the Inspector shows the group
    li_grp("Strips").click(); time.sleep(0.3)
    check("clicking a group's name selects all its fixtures", sel() == "Strip 1,Strip 2,Strip 3,Strip 4", sel())
    check("the Inspector shows the group", ev("document.querySelector('#grpName')?.value") == "Strips" and ev("[...document.querySelectorAll('#rightBody h3')].some(h => h.textContent.startsWith('Group'))"))
    check("the header is highlighted, its fixtures lightly", ev("(() => { const l = [...document.querySelectorAll('#fxList li')]; return l[1].classList.contains('sel') && l.slice(2, 6).every(x => x.classList.contains('insel') && !x.classList.contains('sel')); })()"))
    # rename in the Inspector
    pg.fill("#grpName", "Top strips"); pg.press("#grpName", "Enter"); time.sleep(0.3)
    check("renaming in the Inspector renames the group in the list", "[Top strips]" in rows(), rows())
    pg.keyboard.press("Escape"); pg.click("#view", position={"x": 5, "y": 5}); pg.keyboard.press("Control+z"); time.sleep(0.3)
    check("Ctrl Z undoes the rename", "[Strips]" in rows(), rows())
    # fold; folding survives undo and redo
    li_grp("Rings").locator(".chev").click(); time.sleep(0.2)
    check("the arrow folds a group", rows() == "Panel A,[Strips], Strip 1, Strip 2, Strip 3, Strip 4,[Rings+],Wave" and sel() == "", (rows(), sel()))
    ev("() => { olm.project.fixtures.find(f => f.name === 'Wave').name = 'Wave 2'; commit(); }"); pg.keyboard.press("Control+z"); time.sleep(0.3)
    check("undo leaves a folded group folded", "[Rings+]" in rows() and "Wave" in rows(), rows())
    li_grp("Rings").locator(".chev").click(); time.sleep(0.2)

    # ---- stage: a click selects the whole group, a double-click one fixture, then clicks stay inside the group
    demo()
    x, y = stage_xy("Strip 2"); pg.mouse.click(x, y); time.sleep(0.3)
    check("clicking a fixture of a group on the stage selects the whole group", sel() == "Strip 1,Strip 2,Strip 3,Strip 4", sel())
    pg.mouse.dblclick(x, y); time.sleep(0.3)
    check("double-clicking selects just that fixture", sel() == "Strip 2" and ev("document.querySelector('#fxName')?.value") == "Strip 2", sel())
    check("the single fixture's Inspector shows its group", ev("document.querySelector('select[aria-label=Group]')?.selectedOptions[0].textContent") == "Strips")
    x3, y3 = stage_xy("Strip 3"); pg.mouse.click(x3, y3); time.sleep(0.3)
    check("inside a group, clicking another of its fixtures selects just that one", sel() == "Strip 3", sel())
    ev("() => { olm.ui.sel = new Set(); onSelection(); }")
    pg.mouse.click(x3, y3); time.sleep(0.2)
    xr, yr = stage_xy("Ring 2"); pg.keyboard.down("Shift"); pg.mouse.click(xr, yr); pg.keyboard.up("Shift"); time.sleep(0.3)
    check("Shift-click adds a whole group", sel() == "Strip 1,Strip 2,Strip 3,Strip 4,Ring 1,Ring 2,Ring 3", sel())
    pg.keyboard.down("Shift"); pg.mouse.click(xr, yr); pg.keyboard.up("Shift"); time.sleep(0.3)
    check("Shift-click again takes the whole group out", sel() == "Strip 1,Strip 2,Strip 3,Strip 4", sel())
    # dragging on the stage moves the whole group
    ev("() => { olm.ui.sel = new Set(); onSelection(); }")
    before = ev("olm.project.fixtures.map(f => f.type === 'line' ? [f.x1, f.y1] : [f.cx, f.cy])")
    x1, y1 = stage_xy("Strip 1", 0.3); z = ev("olm.ui.view.zoom")
    pg.mouse.move(x1, y1); pg.mouse.down(); pg.mouse.move(x1 + 40 * z, y1 + 20 * z, steps=6); pg.mouse.up(); time.sleep(0.3)
    after = ev("olm.project.fixtures.map(f => f.type === 'line' ? [f.x1, f.y1] : [f.cx, f.cy])")
    moved = [i for i in range(len(before)) if before[i] != after[i]]
    deltas = {(round(after[i][0] - before[i][0], 3), round(after[i][1] - before[i][1], 3)) for i in moved}
    check("dragging a fixture of a group on the stage moves the whole group together", moved == [1, 2, 3, 4] and len(deltas) == 1, (moved, deltas))
    pg.keyboard.press("Control+z"); time.sleep(0.3)
    # marquee touching one strip takes the whole group
    ev("() => { olm.ui.sel = new Set(); onSelection(); }")
    a = stage_xy("Strip 1", 0.95); pg.mouse.move(a[0] + 12, a[1] - 12); pg.mouse.down(); pg.mouse.move(a[0] - 8, a[1] + 6, steps=5); pg.mouse.up(); time.sleep(0.3)
    check("a marquee touching one fixture of a group selects the whole group", sel() == "Strip 1,Strip 2,Strip 3,Strip 4", sel())

    # ---- dragging in the list
    demo()
    src, dst = li_fx("Wave"), li_fx("Strip 2")
    # the drop line inside a group starts at the indent (checked while dragging)
    sb, db = src.bounding_box(), dst.bounding_box()
    tx, ty = db["x"] + 60, db["y"] + db["height"] - 5
    pg.mouse.move(sb["x"] + 60, sb["y"] + 14); pg.mouse.down(); pg.mouse.move(tx, ty, steps=8); time.sleep(0.2)
    pg.mouse.move(tx + 2, ty); time.sleep(0.2); pg.mouse.move(tx, ty); time.sleep(0.3)
    mid = ev("[...document.querySelectorAll('#fxList li')].filter(li => /drop-/.test(li.className)).map(li => li.querySelector('.nm').firstChild.textContent + ':' + [...li.classList].filter(c => c.startsWith('drop')).join(' '))")
    pg.mouse.up(); time.sleep(0.3)
    check("while dragging between a group's fixtures, the line is inside the group", mid == ["Strip 2:drop-after-in"], mid)
    check("a fixture dropped between a group's fixtures joins the group there", order() == "Panel A,Strip 1@Strips,Strip 2@Strips,Wave@Strips,Strip 3@Strips,Strip 4@Strips,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings", order())
    drop_on(li_fx("Wave"), li_grp("Rings"), "top")
    check("dropped above the next group, it leaves its group", order() == "Panel A,Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Wave,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings", order())
    drop_on(li_fx("Panel A"), li_grp("Rings"), "bottom")
    check("dropped on a group's name, it joins that group at the end", order() == "Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Wave,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Panel A@Rings", order())
    drop_on(li_fx("Ring 1"), None, "end")
    check("dropped under the list, it goes to the end, in no group", order() == "Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Wave,Ring 2@Rings,Ring 3@Rings,Panel A@Rings,Ring 1", order())
    pg.keyboard.press("Control+z"); time.sleep(0.3)
    check("Ctrl Z undoes a drop", order() == "Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Wave,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Panel A@Rings", order())
    # a folded group still takes fixtures dropped on its name
    li_grp("Strips").locator(".chev").click(); time.sleep(0.2)
    drop_on(li_fx("Wave"), li_grp("Strips"), "bottom")
    check("dropped on a folded group's name, it joins it", order().startswith("Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Wave@Strips,"), order())
    # the last fixture out of a group: the group goes
    demo()
    for n in ["Ring 1", "Ring 2", "Ring 3"]:
        drop_on(li_fx(n), None, "end")
    check("taking every fixture out of a group removes the group", ev("olm.project.groups.map(g => g.name).join(',')") == "Strips" and rows().endswith("Wave,Ring 1,Ring 2,Ring 3"), (ev("olm.project.groups.map(g => g.name)"), rows()))
    # a group dragged by its name moves as a whole, never into another group
    demo()
    drop_on(li_grp("Rings"), li_fx("Panel A"), "top")
    check("a group dragged by its name moves as a whole", order() == "Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Panel A,Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Wave", order())
    drop_on(li_grp("Rings"), li_fx("Strip 2"), "top")
    check("a group dropped on another group's fixture goes after that group", order() == "Panel A,Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Wave", order())
    drop_on(li_grp("Strips"), li_grp("Rings"), "bottom")
    check("a group dropped on the lower half of another group's name goes after it", order() == "Panel A,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Wave", order())
    # with a whole group selected, a fixture's row takes only that fixture out
    demo()
    li_grp("Strips").click(); time.sleep(0.2)
    drop_on(li_fx("Strip 3"), li_fx("Wave"), "bottom")
    check("with its group selected, dragging a fixture's row takes just that fixture out", order() == "Panel A,Strip 1@Strips,Strip 2@Strips,Strip 4@Strips,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Wave,Strip 3", order())
    # a group onto a patch output patches all of it, in list order
    demo()
    pg.click("#dockTabs button[data-tab=patch]"); ev("() => { olm.ui.dockH = 420; renderDock(); }"); time.sleep(0.4)
    li_grp("Rings").drag_to(pg.locator(".outrow").nth(0)); time.sleep(0.4)
    chains = ev("olm.project.controllers[0].chains.map(ch => ch.map(id => olm.project.fixtures.find(f => f.id === id).name))")
    check("a group dropped on a patch output patches all of it there, in order", chains[0] == ["Panel A", "Ring 1", "Ring 2", "Ring 3"] and chains[2] == [], chains)
    time.sleep(0.6); badge = ev("[...document.querySelectorAll('#fxList li.grp')].map(li => li.querySelector('.badge').textContent)")
    check("the group's header shows its output", badge == ["OUT 2", "OUT 1"], badge)
    # with a whole group selected, dragging one of its rows moves only that one, which is then selected
    li_grp("Strips").click(); time.sleep(0.2)
    drop_on(li_fx("Strip 1"), None, "end"); drop_on(li_fx("Strip 2"), None, "end")
    check("after a drop, what was dragged is selected, so the next drag takes one row again", order().endswith("Wave,Strip 1,Strip 2") and sel() == "Strip 2", (order(), sel()))

    # ---- Group, Ungroup, the Group menu, Ctrl G / Ctrl Shift G
    demo()
    li_fx("Panel A").click(); time.sleep(0.2)
    b1 = ev("({ d: document.querySelector('#btnGroup').disabled, r: document.querySelector('#btnGroup').classList.contains('ready') })")
    li_fx("Wave").click(modifiers=["Control"]); time.sleep(0.2)
    b2 = ev("({ d: document.querySelector('#btnGroup').disabled, r: document.querySelector('#btnGroup').classList.contains('ready'), t: document.querySelector('#btnGroup').title })")
    check("the Group button in the Fixtures header is dimmed with one fixture, lit with two", b1 == {"d": True, "r": False} and not b2["d"] and b2["r"] and b2["t"].startswith("Group"), (b1, b2))
    check("the Inspector has no Group button any more", ev("[...document.querySelectorAll('#rightBody button')].every(b => !/^(Group|Ungroup)$/.test(b.textContent.trim()))"))
    pg.click("#btnGroup"); time.sleep(0.3)
    check("Group puts the selection in a new group, where the first of them was", order() == "Panel A@Group 1,Wave@Group 1,Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings", order())
    check("the new group is selected", ev("document.querySelector('#grpName')?.value") == "Group 1")
    pg.keyboard.press("Control+g"); time.sleep(0.3)
    check("Ctrl G on a group changes nothing", ev("olm.project.groups.length") == 3, ev("olm.project.groups.map(g => g.name)"))
    check("with a group selected the button says Ungroup", ev("document.querySelector('#btnGroup').title").startswith("Ungroup"))
    pg.click("#btnGroup"); time.sleep(0.3)
    check("Ungroup keeps the fixtures where they are", order() == "Panel A,Wave,Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings", order())
    li_fx("Panel A").click(); li_fx("Wave").click(modifiers=["Control"]); pg.keyboard.press("Control+g"); time.sleep(0.3)
    check("Ctrl G groups", order().startswith("Panel A@Group 1,Wave@Group 1,"), order())
    li_fx("Strip 2").click(); pg.keyboard.press("Control+Shift+g"); time.sleep(0.3)
    check("Ctrl Shift G on a fixture inside a group takes it out, just after the group", order() == "Panel A@Group 1,Wave@Group 1,Strip 1@Strips,Strip 3@Strips,Strip 4@Strips,Strip 2,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings", order())
    # the Group menu of one fixture
    li_fx("Strip 2").click(); time.sleep(0.2)
    pg.select_option("select[aria-label=Group]", label="Rings"); time.sleep(0.3)
    check("the Group menu moves a fixture into a group, at its end", order().endswith("Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Strip 2@Rings"), order())
    pg.select_option("select[aria-label=Group]", label="None"); time.sleep(0.3)
    check("Group: None takes it out, just after the group", order().endswith("Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Strip 2"), order())

    # ---- duplicate and delete
    demo()
    li_grp("Strips").click(); pg.keyboard.press("Control+d"); time.sleep(0.4)
    check("Ctrl D on a group makes a new group of copies", ev("olm.project.groups.map(g => g.name).join(',')") == "Strips,Rings,Strips 2" and ev("document.querySelector('#grpName')?.value") == "Strips 2" and order().endswith("Strip 5@Strips 2,Strip 6@Strips 2,Strip 7@Strips 2,Strip 8@Strips 2"), (ev("olm.project.groups.map(g => g.name)"), order()))
    li_fx("Ring 2").click(); pg.keyboard.press("Control+d"); time.sleep(0.4)
    check("a fixture of a group copied on its own joins that group", "Ring 3@Rings,Ring 4@Rings" in order(), order())
    demo()
    li_grp("Rings").click(); pg.keyboard.press("Delete"); time.sleep(0.3)
    check("Delete on a group deletes its fixtures and the group", order() == "Panel A,Strip 1@Strips,Strip 2@Strips,Strip 3@Strips,Strip 4@Strips,Wave" and ev("olm.project.groups.map(g => g.name).join(',')") == "Strips" and ev("olm.project.controllers[0].chains[2].length") == 0, order())
    pg.keyboard.press("Control+z"); time.sleep(0.3)
    check("Ctrl Z brings the group back, patched as before", "Ring 3@Rings" in order() and ev("olm.project.controllers[0].chains[2].length") == 3, order())

    # ---- Arrange with groups
    ev("""() => { olm.loadProject({ name: 'A', settings: { compW: 400, compH: 200, transition: 0 },
      groups: [{ id: 'g1', name: 'G1' }, { id: 'g2', name: 'G2' }],
      fixtures: [
        { id: 'a', type: 'line', name: 'A', x1: 20, y1: 50, x2: 120, y2: 50, pixels: 4, group: 'g1' },
        { id: 'b', type: 'line', name: 'B', x1: 50, y1: 70, x2: 90, y2: 70, pixels: 4, group: 'g1' },
        { id: 'c', type: 'line', name: 'C', x1: 200, y1: 120, x2: 260, y2: 120, pixels: 4, group: 'g2' },
        { id: 'd', type: 'line', name: 'D', x1: 230, y1: 150, x2: 250, y2: 150, pixels: 4, group: 'g2' },
        { id: 'e', type: 'line', name: 'E', x1: 330, y1: 30, x2: 380, y2: 30, pixels: 4 } ],
      controllers: [], zones: [] }); setTool('select'); }"""); time.sleep(0.5)
    geo = lambda: ev("Object.fromEntries(olm.project.fixtures.map(f => { const b = fixtureBounds(f); return [f.id, [b.x0, b.y0, b.x1, b.y1]]; }))")
    g0 = geo()
    li_grp("G1").click(); time.sleep(0.2)
    note = ev("[...document.querySelectorAll('#rightBody h3')].find(h => h.textContent.trim() === 'Arrange').parentElement.querySelector('.note')?.textContent || ''")
    check("with one group selected, Arrange shows no explanation", note == "", note)
    pg.click("button[aria-label='Align left']"); time.sleep(0.2)
    g = geo(); check("one group: Align left lines up its fixtures with each other", g["a"][0] == 20 and g["b"][0] == 20 and g["c"] == g0["c"], g)
    pg.keyboard.press("Control+z"); time.sleep(0.3)
    li_grp("G1").click(); li_grp("G2").click(modifiers=["Control"]); time.sleep(0.2)
    pg.click("button[aria-label='Align top']"); time.sleep(0.2)
    g = geo()
    check("two groups: Align top moves each group as one block", g["a"][1] == 50 and g["b"][1] == 70 and g["c"][1] == 50 and g["d"][1] == 80 and g["c"][0] == 200, g)
    pg.keyboard.press("Control+z"); time.sleep(0.3)
    li_grp("G1").click(); li_grp("G2").click(modifiers=["Control"]); li_fx("E").click(modifiers=["Control"]); time.sleep(0.2)
    pg.click("button[aria-label='Distribute horizontally: the same spacing between centres']"); time.sleep(0.2)
    g = geo(); cx = lambda b: (b[0] + b[2]) / 2
    c1, c2, c3 = (min(g["a"][0], g["b"][0]) + max(g["a"][2], g["b"][2])) / 2, (min(g["c"][0], g["d"][0]) + max(g["c"][2], g["d"][2])) / 2, cx(g["e"])
    check("two groups and a fixture: Distribute spaces the three blocks evenly, the outermost stay", abs((c2 - c1) - (c3 - c2)) < 1e-6 and c1 == 70 and c3 == 355 and g["d"][0] - g["c"][0] == 30, (c1, c2, c3, g))
    pg.keyboard.press("Control+z"); time.sleep(0.3)
    ev("() => { olm.project.fixtures.find(f => f.id === 'd').locked = true; commit(); }")
    li_grp("G1").click(); li_grp("G2").click(modifiers=["Control"]); time.sleep(0.2)
    pg.click("button[aria-label='Align right']"); time.sleep(0.2)
    g = geo()
    check("a group with a locked fixture stays put, and the others line up with it", g["c"] == g0["c"] and g["d"] == g0["d"] and max(g["a"][2], g["b"][2]) == 260 and g["b"][2] - g["a"][2] == g0["b"][2] - g0["a"][2], g)

    # ---- save and load; projects with broken groups open cleaned up
    demo()
    ev("() => { olm.project.groups[0].name = 'Top'; commit(); }")
    saved = ev("serialize()")
    ev("s => olm.loadProject(JSON.parse(s))", saved); time.sleep(0.3)
    check("groups are saved and opened with the project", order() == "Panel A,Strip 1@Top,Strip 2@Top,Strip 3@Top,Strip 4@Top,Ring 1@Rings,Ring 2@Rings,Ring 3@Rings,Wave", order())
    ev("""() => olm.loadProject({ name: 'Broken', groups: [{ id: 'x', name: 'X' }, { id: 'x', name: 'Dup' }, { id: 'e', name: 'Empty' }, { name: 'NoId' }],
      fixtures: [
        { id: 'a', type: 'line', name: 'A', group: 'x' }, { id: 'b', type: 'line', name: 'B' },
        { id: 'c', type: 'line', name: 'C', group: 'x' }, { id: 'd', type: 'line', name: 'D', group: 'nope' } ] })"""); time.sleep(0.3)
    check("a project with scattered, unknown or empty groups opens tidied", order() == "A@X,C@X,B,D" and ev("olm.project.groups.map(g => g.name).join(',')") == "X", (order(), ev("olm.project.groups.map(g => g.name)")))
    ev("() => olm.loadProject({ name: 'Old', fixtures: [{ id: 'a', type: 'line', name: 'A' }] })"); time.sleep(0.2)
    check("a project from before groups opens with none", ev("JSON.stringify(olm.project.groups)") == "[]" and rows() == "A")
    # a group of one fixture can still be renamed and ungrouped; Ctrl G with one fixture says why nothing happens
    demo()
    li_fx("Wave").click(); pg.keyboard.press("Control+g"); time.sleep(0.3)
    check("Ctrl G with one fixture explains that two are needed", "two or more" in ev("[...document.querySelectorAll('#toasts > *')].map(t => t.textContent).join(' ')"))
    for n in ["Ring 1", "Ring 2"]: drop_on(li_fx(n), None, "end")
    li_grp("Rings").click(); time.sleep(0.3)
    check("a group of one: the Inspector shows the group above the fixture", ev("document.querySelector('#grpName')?.value") == "Rings" and ev("document.querySelector('#fxName')?.value") == "Ring 3")
    pg.fill("#grpName", "Solo"); pg.press("#grpName", "Enter"); time.sleep(0.3)
    check("a group of one can be renamed", "[Solo]" in rows(), rows())
    ch = li_grp("Solo").locator(".chev")
    check("the fold arrow is a button that says whether the group is open", ev("() => { const b = document.querySelector('#fxList li.grp[data-group] .chev'); return b.tagName === 'BUTTON' && b.getAttribute('aria-expanded') === 'true' && b.getAttribute('aria-label').startsWith('Fold'); }"))
    # hand-edited files with number ids: dragging still works
    ev("""() => olm.loadProject({ name: 'N', groups: [{ id: 7, name: 'Seven' }], fixtures: [
      { id: 1, type: 'line', name: 'One', group: 7 }, { id: 2, type: 'line', name: 'Two', group: 7 }, { id: 3, type: 'line', name: 'Three' }],
      controllers: [{ id: 9, name: 'C', ip: '127.0.0.1', outputs: 1, upo: 1, chains: [[1, 2]] }] })"""); time.sleep(0.3)
    check("number ids from a hand-edited file are read as text", ev("JSON.stringify([olm.project.fixtures.map(f => [f.id, f.group ?? null]), olm.project.groups.map(g => g.id), olm.project.controllers[0].chains])") == '[[["1","7"],["2","7"],["3",null]],["7"],[["1","2"]]]', ev("JSON.stringify([olm.project.fixtures.map(f => [f.id, f.group ?? null]), olm.project.groups.map(g => g.id), olm.project.controllers[0].chains])"))
    drop_on(li_fx("Three"), li_fx("One"), "bottom")
    check("and dragging in the list works on them", order() == "One@Seven,Three@Seven,Two@Seven", order())
    # ---- the right panel can be hidden
    pg.click("#btnHideRight"); time.sleep(0.3)
    w = ev("({ hidden: getComputedStyle(document.querySelector('aside.right')).display === 'none', stage: document.querySelector('#stage').getBoundingClientRect().width })")
    check("» hides the right panel and the stage gets wider", w["hidden"] and w["stage"] > 1100, w)
    pg.keyboard.press("h"); time.sleep(0.3)
    check("H shows it again", ev("getComputedStyle(document.querySelector('aside.right')).display") != "none")
    demo(); pg.click("#btnRight"); time.sleep(0.2)
    li_fx("Panel A").dblclick(); time.sleep(0.3)
    check("double-clicking a fixture to rename it opens the hidden panel", ev("getComputedStyle(document.querySelector('aside.right')).display") != "none" and ev("document.activeElement.id") == "fxName")
    # ---- a group's dimmer: in the Inspector, over its fixtures' own, saved, undone, driven by MIDI
    demo()
    G = ev("olm.project.groups[0].id"); GN = ev("olm.project.groups[0].name")
    inG = ev(f"olm.project.fixtures.find(f => f.group === '{G}').id"); out = ev(f"olm.project.fixtures.find(f => f.group !== '{G}').id")
    ev("(() => { const p = olm.project; p.zones = [p.zones.at(-1)]; p.zones[0].layers = [newLayer('b-solid')]; p.zones[0].layers[0].params['b-solid'] = { color: [1, 1, 1, 1] }; commit(); })()")
    ev(f"olm.ui.sel = new Set(olm.project.fixtures.filter(f => f.group === '{G}').map(f => f.id)); onSelection(); olm.ui.rightTab = 'inspector'; showRight(true); renderRight()"); time.sleep(0.5)
    disp = lambda fid: ev(f"Math.max(...olm.project.fixtures.find(f => f.id === '{fid}')._disp.slice(0, 3))")
    d0, o0 = disp(inG), disp(out)
    row = pg.locator("#rightBody .row", has=pg.locator(".lbl", has_text="Dimmer"))
    check("the group's Inspector has a Dimmer, at 100 %", row.count() == 1 and row.locator(".sval").inner_text() == "100%" and d0 > 200, (row.count(), d0))
    r = row.locator("input[type=range]"); r.fill("0.5"); r.dispatch_event("input"); r.dispatch_event("change"); time.sleep(0.5)
    check("at 50 % its fixtures give half, the others don't change", abs(disp(inG) - d0 * 0.5) <= 1 and disp(out) == o0, (d0, disp(inG), o0, disp(out)))
    check("the list shows the group dimmed", li_grp(GN).locator(".gdim").inner_text() == "50%" and li_grp(GN).locator(".gdim").is_visible())
    saved = ev("JSON.parse(serialize()).groups")
    check("saved in the project", any(g.get("level") == 0.5 for g in saved), saved)
    ev("undo()"); time.sleep(0.4)
    check("undo brings it back to 100 %, and the file has no level then", ev(f"groupLevel(groupById('{G}'))") == 1 and all("level" not in g for g in ev("JSON.parse(serialize()).groups")) and abs(disp(inG) - d0) <= 1)
    ev("redo()"); time.sleep(0.3)
    # MIDI: learnt by clicking the Dimmer slider, then a fader drives it
    ev(f"olm.ui.sel = new Set(olm.project.fixtures.filter(f => f.group === '{G}').map(f => f.id)); onSelection(); renderRight()"); time.sleep(0.3)
    ev("ui.midiOn = true; midiSetLearn(true)"); ev("midiIn({ port: 'K', ch: 1, type: 'cc', num: 9, val: 40 })"); time.sleep(0.2)
    pg.locator("#rightBody .row:has(.lbl:text-is('Dimmer')) .mslot").click(); time.sleep(0.3)
    check("learning: a fader goes onto the group's dimmer (named after the group)", ev(f"project.midi.maps.some(w => w.to === 'gr:{G}')") and ev(f"midiTargetLabel('gr:{G}')") == GN + " dimmer")
    ev(f"midiSetLearn(false); project.midi.maps.find(w => w.to === 'gr:{G}').takeover = 'jump'")
    ev("midiIn({ port: 'K', ch: 1, type: 'cc', num: 9, val: 127 })"); time.sleep(0.4)
    check("the fader moves it, and the slider and the list follow", ev(f"groupLevel(groupById('{G}'))") == 1 and row.locator(".sval").inner_text() == "100%" and li_grp(GN).locator(".gdim").is_hidden())
    ev("midiIn({ port: 'K', ch: 1, type: 'cc', num: 9, val: 0 })"); time.sleep(0.4)
    check("down to 0: its fixtures are dark", disp(inG) == 0 and disp(out) == o0 and row.locator(".sval").inner_text() == "0%")
    ev(f"(() => {{ const g = groupById('{G}'); project.groups = project.groups.filter(x => x !== g); for (const f of project.fixtures) if (f.group === g.id) delete f.group; commit(); }})()"); time.sleep(0.3)
    check("a mapping to a group that is gone is missing", ev(f"midiTarget('gr:{G}')") is None and ev(f"midiTargetLabel('gr:{G}')") == "Missing")

    check("no page errors", not errs, errs[:3])
    br.close()
bridge.terminate(); bridge.communicate()
print("FAILED:", fails or "none")
