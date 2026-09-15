import test from "node:test";
import assert from "node:assert/strict";
import cytoscape from "cytoscape";
import { demoInventory } from "../src/demo";
import {
  syncDiagram,
  diagramSnapshot,
  pruneDiagramViews,
} from "../src/diagram";
import { layoutGraph } from "../src/graphLayout";
import { NODE } from "../src/visual";
test("saved positions and locks survive graph synchronization and reopening", (t) => {
  const d = demoInventory();
  const make = () =>
    cytoscape({
      headless: true,
      styleEnabled: true,
      style: [
        { selector: "node", style: { width: NODE.width, height: NODE.height } },
      ],
    });
  const g = make();
  t.after(() => g.destroy());
  syncDiagram(g, d, "dc-a");
  const node = g.getElementById("f5");
  node.position({ x: 450, y: 900 });
  node.lock();
  const before = { ...node.position() };
  d.diagram_views["dc-a"] = diagramSnapshot(g);
  d.components.find((c) => c.id === "f5")!.name = "renamed";
  syncDiagram(g, d, "dc-a");
  layoutGraph(g);
  assert.deepEqual(node.position(), before);
  const reopened = make();
  t.after(() => reopened.destroy());
  syncDiagram(reopened, d, "dc-a");
  assert.deepEqual(reopened.getElementById("f5").position(), before);
  assert.equal(reopened.getElementById("f5").locked(), true);
  d.components = d.components.filter((c) => c.id !== "f5");
  assert.equal(pruneDiagramViews(d).diagram_views["dc-a"].nodes.f5, undefined);
  g.destroy();
  reopened.destroy();
});
test("visual containers preserve graph relations and membership through moving, filtering and ungrouping", (t) => {
  const d = demoInventory(),
    before = structuredClone(d.relationships);
  const g = cytoscape({
    headless: true,
    styleEnabled: true,
    style: [
      { selector: "node", style: { width: 240, height: 132 } },
      {
        selector: ".group",
        style: { padding: "25px", "min-width": "400px", "min-height": "240px" },
      },
    ],
  });
  t.after(() => g.destroy());
  syncDiagram(g, d, "dc-a");
  d.diagram_views["dc-a"] = {
    ...diagramSnapshot(g),
    groups: [
      {
        id: "test",
        name: "Cluster",
        members: ["worker-1", "worker-2"],
        x: 0,
        y: 0,
        width: 400,
        height: 240,
      },
    ],
  };
  // Use the fixture's actual server IDs.
  const members = d.components
    .filter(
      (c) => c.environment_id === "dc-a" && c.component_type_id === "server",
    )
    .map((c) => c.id);
  d.diagram_views["dc-a"].groups[0].members = members;
  syncDiagram(g, d, "dc-a");
  const parent = g.getElementById("__group__test"),
    child = g.getElementById(members[0]),
    old = { ...child.position() };
  assert.equal(parent.children().length, members.length);
  parent.shift({ x: 40, y: 60 });
  assert.deepEqual(child.position(), { x: old.x + 40, y: old.y + 60 });
  assert.deepEqual(d.relationships, before);
  assert.equal(g.edges().length, before.length);
  child.lock();
  syncDiagram(g, d, "dc-a");
  assert.equal(parent.grabbable(), false);
  const snapshot = diagramSnapshot(g);
  assert.equal(snapshot.groups.length, 1);
  assert.ok(!snapshot.nodes.__group__test);
  d.diagram_views["dc-a"] = { ...snapshot, groups: [] };
  syncDiagram(g, d, "dc-a");
  assert.equal(child.parent().length, 0);
  assert.ok(g.getElementById(members[0]).length);
});

test("late geometry snapshots cannot undo group metadata edits or resurrect removed groups", async () => {
  const { mergeDiagramGeometry } = await import("../src/diagram");
  const old = {
    nodes: { a: { x: 1, y: 2, locked: false } },
    groups: [
      {
        id: "g",
        name: "Old",
        members: ["a"],
        x: 0,
        y: 0,
        width: 400,
        height: 240,
      },
    ],
  };
  const edited = structuredClone(old);
  edited.groups[0].name = "Edited";
  edited.groups[0].members = [];
  old.groups[0].x = 300;
  const merged = mergeDiagramGeometry(edited, old);
  assert.equal(merged.groups[0].name, "Edited");
  assert.deepEqual(merged.groups[0].members, []);
  assert.equal(merged.groups[0].x, 300);
  assert.deepEqual(
    mergeDiagramGeometry({ ...edited, groups: [] }, old).groups,
    [],
  );
});
