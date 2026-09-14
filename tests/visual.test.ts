import test from "node:test";
import assert from "node:assert/strict";
import { iconMarkup, nodeIcon } from "../src/nodeIcons";
import { shortLabel } from "../src/visual";
test("all component icons share the same bounded offline markup", () => {
  for (const name of ["server", "globe", "network", "boxes", "database", "building", "flask", "box"]) {
    assert.ok(decodeURIComponent(nodeIcon(name, "#123456")).includes(iconMarkup(name)));
    if (name !== "box") assert.notEqual(iconMarkup(name), iconMarkup("box"));
  }
  assert.equal(iconMarkup("__proto__"), iconMarkup("box"));
  assert.ok(!nodeIcon("box", '\" onload="bad').includes("onload"));
  assert.equal(shortLabel("a".repeat(256)).length, 31);
});
