import test from "node:test";
import assert from "node:assert/strict";
import { demoInventory } from "../src/demo";
import {
  emptyFilters,
  filteredComponents,
  graphElements,
  parseBackup,
  removeComponent,
  removeEnvironment,
} from "../src/model";

test("graph keeps remote endpoints and points cross-links at the other environment", () => {
  const d = demoInventory(),
    elements = graphElements(d, "dc-a", emptyFilters());
  assert.ok(
    elements.some(
      (e) => e.data.id === "replica" && e.classes.includes("external"),
    ),
  );
  assert.ok(
    elements.some(
      (e) =>
        "source" in e.data &&
        e.data.source === "pg" &&
        e.classes === "cross" &&
        e.data.targetEnvironment === "dc-b",
    ),
  );
  const cross = graphElements(d, "dc-b", { ...emptyFilters(), cross: true });
  assert.ok(
    cross.filter((e) => "source" in e.data).every((e) => e.classes === "cross"),
  );
  assert.ok(
    cross.some(
      (e) =>
        "targetEnvironment" in e.data && e.data.targetEnvironment === "dc-a",
    ),
  );
});
test("filters combine and deletion removes incoming and outgoing edges", () => {
  const d = demoInventory();
  assert.deepEqual(
    filteredComponents(d, "dc-a", {
      ...emptyFilters(),
      internet: true,
      type: "domain",
      search: "api",
      criticality: "high",
    }).map((c) => c.id),
    ["domain-api"],
  );
  const next = removeComponent(d, "f5");
  assert.ok(
    !next.relationships.some(
      (r) => r.source_component_id === "f5" || r.target_component_id === "f5",
    ),
  );
  const deleted = removeEnvironment(d, "dc-b");
  assert.ok(!deleted.components.some((c) => c.environment_id === "dc-b"));
  assert.ok(
    !deleted.relationships.some(
      (r) =>
        r.target_component_id === "replica" ||
        r.source_component_id === "bastion",
    ),
  );
  d.environments[1].parent_id = "dc-a";
  assert.throws(() => removeEnvironment(d, "dc-a"), /nested/);
});
test("backup roundtrip and broken references", () => {
  const d = demoInventory();
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(d))), d);
  d.relationships[0].target_component_id = "missing";
  assert.throws(() => parseBackup(d), /broken/);
  assert.throws(() => parseBackup({ version: 99 }), /unsupported/);
  assert.equal(parseBackup({ ...d, version: 1, relationships: [] }).version, 2);
});
