import test from "node:test";
import assert from "node:assert/strict";
import { freshInventory, type Component, type Suggestion } from "../src/model";
import {
  defaultImportTarget,
  importMatch,
  prepareImport,
} from "../src/importPlan";
const suggestion = (name = "renamed", user = "ops"): Suggestion => ({
  id: `ssh:${name}`,
  source: "test",
  name,
  component_type_id: "server",
  properties: {
    hostname: name,
    source_ssh_alias: name,
    source_resolved_hostname: "EXAMPLE.org.",
    source_ssh_port: 2222,
    source_ssh_user: user,
    source_ssh_identity_files: '["~/.ssh/id"]',
    source_ssh_proxy_jump: "none",
    source_ssh_resolution: "static-v1",
  },
});
function inventory() {
  const d = freshInventory();
  d.environments = [
    {
      id: "env",
      name: "Prod",
      description: "",
      color: "#123456",
      icon: "server",
      parent_id: null,
    },
  ];
  const old = suggestion("old");
  const c: Component = {
    id: "stable-id",
    environment_id: "env",
    component_type_id: "server",
    name: "My authored name",
    properties: {
      ...old.properties,
      source_resolved_hostname: "example.org",
      notes: "Keep me",
      team: "SRE",
    },
    launch_action: null,
    updated_at: "old",
  };
  d.components = [c];
  d.diagram_views = {
    env: {
      nodes: { "stable-id": { x: 123, y: 456, locked: true } },
      groups: [],
    },
  };
  return d;
}
test("SSH alias refresh preserves authored data and distinguishes connection uncertainty", () => {
  const d = inventory(),
    before = structuredClone(d),
    s = suggestion();
  assert.equal(importMatch(d, s, "env").kind, "update");
  assert.equal(defaultImportTarget(d, s, "env"), "stable-id");
  const plan = prepareImport(
    d,
    [{ suggestion: s, target: "stable-id" }],
    "env",
  );
  assert.equal(plan.document.components.length, 1);
  assert.equal(plan.updated, 1);
  const c = plan.document.components[0];
  assert.equal(c.id, "stable-id");
  assert.equal(c.name, "My authored name");
  assert.equal(c.properties.notes, "Keep me");
  assert.equal(c.properties.hostname, "renamed");
  assert.deepEqual(plan.document.diagram_views, d.diagram_views);
  assert.deepEqual(d, before);
  assert.equal(importMatch(plan.document, s, "env").kind, "existing");
  assert.equal(
    importMatch(d, suggestion("another", "root"), "env").kind,
    "new",
  );
  assert.equal(
    importMatch(
      d,
      {
        ...s,
        properties: { ...s.properties, source_ssh_proxy_jump: "bastion" },
      },
      "env",
    ).kind,
    "review",
  );
  d.components[0].properties.ssh_user = "manual";
  assert.equal(importMatch(d, s, "env").kind, "new");
  // Same alias with overrides still demands review, and explicit refresh keeps overrides.
  assert.equal(importMatch(d, suggestion("old"), "env").kind, "review");
  const manual = prepareImport(
    d,
    [{ suggestion: suggestion("old"), target: "stable-id" }],
    "env",
  );
  assert.equal(manual.document.components[0].properties.ssh_user, "manual");
});
test("ambiguous imports, batch alias collisions and failed plans never mutate inventory", () => {
  const d = inventory(),
    s = suggestion();
  d.components.push({ ...structuredClone(d.components[0]), id: "second" });
  assert.equal(importMatch(d, s, "env").kind, "review");
  assert.equal(defaultImportTarget(d, s, "env"), "");
  const before = structuredClone(d);
  assert.throws(
    () => prepareImport(d, [{ suggestion: s, target: "" }], "env"),
    /Choose/,
  );
  assert.throws(
    () =>
      prepareImport(
        d,
        [
          { suggestion: s, target: "stable-id" },
          { suggestion: suggestion("third"), target: "stable-id" },
        ],
        "env",
      ),
    /Two aliases/,
  );
  assert.throws(
    () =>
      prepareImport(
        d,
        [
          { suggestion: s, target: "new" },
          { suggestion: suggestion("third"), target: "new" },
        ],
        "env",
      ),
    /overlaps/,
  );
  assert.deepEqual(d, before);
  d.components[0].properties.source_ssh_resolution = "review";
  d.components.pop();
  assert.equal(importMatch(d, s, "env").kind, "review");
  delete d.components[0].properties.source_ssh_resolution;
  assert.equal(importMatch(d, s, "env").kind, "review");
});
