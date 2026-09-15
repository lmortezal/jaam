import { uid, type Inventory, type Relationship } from "./model";
export function relationBatch(
  data: Inventory,
  ids: Set<string>,
  target: string,
  relation: string,
  label: string,
  reverse: boolean,
) {
  if (
    !data.components.some((c) => c.id === target) ||
    [...ids].some((id) => !data.components.some((c) => c.id === id))
  )
    throw new Error("Choose existing components.");
  if (!relation.trim() || relation.trim().length > 256)
    throw new Error("Enter a relation type (1–256 characters).");
  const signature = (r: Relationship) =>
    JSON.stringify([
      r.source_component_id,
      r.target_component_id,
      r.relation_type,
      r.label,
    ]);
  const existing = new Set(data.relationships.map(signature));
  const added: Relationship[] = [];
  for (const id of [...ids].sort()) {
    if (id === target) continue;
    const r = {
      id: uid(),
      source_component_id: reverse ? target : id,
      target_component_id: reverse ? id : target,
      relation_type: relation.trim(),
      label: label.trim(),
    };
    if (!existing.has(signature(r))) {
      added.push(r);
      existing.add(signature(r));
    }
  }
  if (data.relationships.length + added.length > 50000)
    throw new Error("Too many relationships.");
  return {
    document: { ...data, relationships: [...data.relationships, ...added] },
    added,
    skipped: ids.size - added.length,
  };
}
