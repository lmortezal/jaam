import { pruneDiagramViews } from "./diagram";
import { actionOf, type Inventory, type Field, type Properties } from "./model";
export type Edit = {
  mode: "keep" | "set" | "clear";
  value?: Properties[string];
};
export interface BulkPatch {
  environment: Edit;
  type: Edit;
  properties: Record<string, Edit>;
}
export interface Change {
  id: string;
  name: string;
  field: string;
  before: unknown;
  after: unknown;
}
export const keep = (): Edit => ({ mode: "keep" });
export const displayValue = (v: unknown) =>
  v === undefined
    ? "Not set"
    : v === null
      ? "Null"
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
export function mixedValue(values: unknown[]) {
  return values.every((v) => Object.is(v, values[0]))
    ? displayValue(values[0])
    : "Mixed";
}
export function safeProperty(key: string) {
  return (
    !!key.trim() &&
    !/^(source_|ssh_|password$|private_key$|token$|secret$|access_token$|client[-_]key[-_]data$|hostname$|url$|kube_context$)/i.test(
      key,
    )
  );
}
export function bulkFields(d: Inventory, ids: Set<string>): Field[] {
  const selected = d.components.filter((c) => ids.has(c.id));
  const fields = new Map<string, Field>();
  for (const c of selected) {
    for (const f of d.component_types.find((t) => t.id === c.component_type_id)!
      .fields)
      fields.set(f.key, f);
    for (const [key, value] of Object.entries(c.properties))
      if (!fields.has(key) && value != null)
        fields.set(key, {
          key,
          label: key,
          field_type:
            typeof value === "number"
              ? "number"
              : typeof value === "boolean"
                ? "bool"
                : "text",
          options: [],
        });
  }
  return [...fields.values()].filter(
    (f) =>
      safeProperty(f.key) &&
      selected.every((c) => {
        const schema = d.component_types
          .find((t) => t.id === c.component_type_id)!
          .fields.find((x) => x.key === f.key);
        if (schema)
          return (
            schema.field_type === f.field_type &&
            (f.field_type !== "enum" ||
              JSON.stringify(schema.options) === JSON.stringify(f.options))
          );
        const value = c.properties[f.key];
        return (
          value == null ||
          typeof value ===
            (f.field_type === "bool"
              ? "boolean"
              : f.field_type === "number"
                ? "number"
                : "string")
        );
      }),
  );
}
export function bulkEdit(
  d: Inventory,
  ids: Set<string>,
  patch: BulkPatch,
): { document: Inventory; changes: Change[] } {
  if (
    !ids.size ||
    [...ids].some((id) => !d.components.some((c) => c.id === id))
  )
    throw new Error("The selection changed. Select the components again.");
  const next = structuredClone(d),
    changes: Change[] = [];
  const timestamp = new Date().toISOString();
  for (const c of next.components.filter((c) => ids.has(c.id))) {
    const old = d.components.find((x) => x.id === c.id)!;
    const change = (field: string, before: unknown, after: unknown) => {
      if (!Object.is(before, after))
        changes.push({ id: c.id, name: c.name, field, before, after });
    };
    for (const [key, op] of [
      ["environment_id", patch.environment],
      ["component_type_id", patch.type],
    ] as const) {
      if (op.mode === "clear")
        throw new Error("Environment and type cannot be cleared.");
      if (op.mode === "set") {
        const value = String(op.value || "");
        change(key, c[key], value);
        c[key] = value;
      }
    }
    if (!next.environments.some((e) => e.id === c.environment_id))
      throw new Error("Choose an existing environment.");
    const type = next.component_types.find((t) => t.id === c.component_type_id);
    if (!type) throw new Error("Choose an existing component type.");
    for (const [key, op] of Object.entries(patch.properties)) {
      if (op.mode === "keep") continue;
      if (!safeProperty(key) || key.length > 128)
        throw new Error(`Bulk editing ${key} is not supported.`);
      const value = op.mode === "clear" ? undefined : op.value;
      if (
        op.mode === "set" &&
        (value === undefined ||
          (typeof value === "number" && !Number.isFinite(value)))
      )
        throw new Error(`Enter a valid value for ${key}.`);
      change(key, c.properties[key], value);
      if (op.mode === "clear") delete c.properties[key];
      else c.properties[key] = value!;
    }
    for (const f of type.fields) {
      const v = c.properties[f.key];
      if (v == null) continue;
      if (
        !(f.field_type === "enum"
          ? typeof v === "string" && f.options.includes(v)
          : typeof v ===
            (f.field_type === "number"
              ? "number"
              : f.field_type === "bool"
                ? "boolean"
                : "string"))
      )
        throw new Error(
          `${c.name}: ${f.key} is incompatible with ${type.name}. Keep the type or explicitly fix/clear this field.`,
        );
    }
    if (old.environment_id !== c.environment_id) {
      const memberships =
        d.diagram_views[old.environment_id]?.groups
          .filter((g) => g.members.includes(c.id))
          .map((g) => g.name) || [];
      if (memberships.length)
        change("Diagram group membership", memberships.join(", "), undefined);
    }
    if (old.component_type_id !== c.component_type_id) {
      const before = actionOf(d, old),
        after = actionOf(next, c);
      if (JSON.stringify(before) !== JSON.stringify(after))
        changes.push({
          id: c.id,
          name: c.name,
          field: "Effective launch action",
          before,
          after,
        });
    }
    if (changes.some((x) => x.id === c.id)) c.updated_at = timestamp;
  }
  for (const relation of next.relationships) {
    if (
      !ids.has(relation.source_component_id) &&
      !ids.has(relation.target_component_id)
    )
      continue;
    const before =
      d.components.find((c) => c.id === relation.source_component_id)!
        .environment_id !==
      d.components.find((c) => c.id === relation.target_component_id)!
        .environment_id;
    const source = next.components.find(
        (c) => c.id === relation.source_component_id,
      )!,
      target = next.components.find(
        (c) => c.id === relation.target_component_id,
      )!;
    const after = source.environment_id !== target.environment_id;
    if (before !== after)
      changes.push({
        id: ids.has(source.id) ? source.id : target.id,
        name: `${source.name} → ${target.name}`,
        field: "Relationship scope",
        before: before ? "Cross-environment" : "Local",
        after: after ? "Cross-environment" : "Local",
      });
  }
  return { document: pruneDiagramViews(next), changes };
}
