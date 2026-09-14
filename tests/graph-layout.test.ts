import test from "node:test";
import assert from "node:assert/strict";
import cytoscape from "cytoscape";
import { layoutGraph } from "../src/graphLayout";

test("47 mostly isolated hosts form compact, non-overlapping groups", () => {
  const graph = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: [
      ...Array.from({ length: 47 }, (_, i) => ({ data: { id: `host-${i}` } })),
      { data: { id: "relationship", source: "host-0", target: "host-1" } },
    ],
    style: [{ selector: "node", style: { width: 225, height: 104 } }],
  });
  try {
    layoutGraph(graph, 2.2);
    const bounds = graph.elements().boundingBox();
    assert.ok(bounds.w / bounds.h < 3, "must not produce a single wide row");
    assert.ok(bounds.w < 2500);
    const nodes = graph.nodes().toArray();
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].boundingBox(),
          b = nodes[j].boundingBox();
        assert.ok(
          a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1,
          "nodes must not overlap",
        );
      }
    assert.ok(
      graph.getElementById("host-1").position("y") >
        graph.getElementById("host-0").position("y"),
    );
    assert.equal(graph.edges().length, 1);
  } finally {
    graph.destroy();
  }
});
