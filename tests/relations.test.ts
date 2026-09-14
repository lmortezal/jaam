import test from "node:test";
import assert from "node:assert/strict";
import { demoInventory } from "../src/demo";
import { relationBatch } from "../src/relations";
test("multi-node relations are directed stars, skip duplicates and preserve other links", () => {
  const d=demoInventory(), ids=new Set(["f5","domain-api","pg"]);
  const result=relationBatch(d,ids,"pg","maintained_by","step",false);
  assert.deepEqual(result.added.map(r=>[r.source_component_id,r.target_component_id]),[["domain-api","pg"],["f5","pg"]]);
  assert.equal(result.skipped,1);
  assert.deepEqual(result.document.relationships.slice(0,d.relationships.length),d.relationships);
  assert.equal(relationBatch(result.document,ids,"pg","maintained_by","step",false).added.length,0);
  assert.equal(relationBatch(result.document,ids,"pg","maintained_by","another step",false).added.length,2);
  assert.deepEqual(relationBatch(d,ids,"pg","connects_to","",true).added.map(r=>r.source_component_id),["pg","pg"]);
});
