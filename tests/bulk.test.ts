import test from "node:test";
import assert from "node:assert/strict";
import { demoInventory } from "../src/demo";
import { bulkEdit, keep, mixedValue } from "../src/bulk";
test("bulk patch preserves unspecified data, distinguishes mixed values and fails as one operation", () => {
  const d = demoInventory(),
    original = structuredClone(d),
    ids = new Set(d.components.slice(0, 2).map((c) => c.id));
  const result = bulkEdit(d, ids, {
    environment: keep(),
    type: keep(),
    properties: {
      team: { mode: "set", value: "platform" },
      notes: { mode: "clear" },
      internet_facing: keep(),
    },
  });
  for (const c of result.document.components) {
    const old = d.components.find((x) => x.id === c.id)!;
    if (ids.has(c.id)) {
      assert.equal(c.properties.team, "platform");
      assert.equal(c.properties.notes, undefined);
      assert.equal(c.properties.hostname, old.properties.hostname);
      assert.equal(
        c.properties.internet_facing,
        old.properties.internet_facing,
      );
    } else assert.deepEqual(c, old);
  }
  assert.deepEqual(result.document.relationships, d.relationships);
  assert.deepEqual(d, original);
  assert.equal(mixedValue([false, undefined]), "Mixed");
  assert.equal(mixedValue([0, 0]), "0");
  assert.throws(
    () =>
      bulkEdit(d, ids, {
        environment: keep(),
        type: keep(),
        properties: { criticality: { mode: "set", value: "invalid" } },
      }),
    /incompatible/,
  );
  assert.deepEqual(d, original);
  assert.throws(
    () =>
      bulkEdit(d, ids, {
        environment: keep(),
        type: keep(),
        properties: { hostname: { mode: "clear" } },
      }),
    /not supported/,
  );
});

test("moving a component previews group removal and changes in relationship scope", () => {
  const d = demoInventory(),
    c = d.components.find((c) => c.id === "f5")!;
  d.diagram_views[c.environment_id] = {
    nodes: {},
    groups: [
      {
        id: "g",
        name: "Edge",
        members: [c.id],
        x: 0,
        y: 0,
        width: 400,
        height: 240,
      },
    ],
  };
  const result = bulkEdit(d, new Set([c.id]), {
    environment: { mode: "set", value: "dc-b" },
    type: keep(),
    properties: {},
  });
  assert.ok(
    result.changes.some(
      (c) => c.field === "Diagram group membership" && c.before === "Edge",
    ),
  );
  assert.ok(result.changes.some((c) => c.field === "Relationship scope"));
  assert.deepEqual(result.document.diagram_views["dc-a"].groups[0].members, []);
  assert.deepEqual(result.document.relationships, d.relationships);
});
