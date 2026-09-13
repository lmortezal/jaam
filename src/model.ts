import defaults from "../src-tauri/defaults.json";
import { nodeIcon } from "./nodeIcons";
export type Properties = Record<string, string | number | boolean | null>;
export interface Environment {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  parent_id: string | null;
}
export interface Field {
  key: string;
  label: string;
  field_type: "text" | "number" | "bool" | "enum";
  options: string[];
}
export interface LaunchAction {
  action_type: "open_url" | "ssh_terminal" | "custom_command" | "none";
  template: string;
}
export interface ComponentType {
  id: string;
  name: string;
  icon: string;
  color: string;
  fields: Field[];
  launch_action: LaunchAction | null;
}
export interface Component {
  id: string;
  environment_id: string;
  component_type_id: string;
  name: string;
  properties: Properties;
  launch_action: LaunchAction | null;
  updated_at: string;
}
export interface Relationship {
  id: string;
  source_component_id: string;
  target_component_id: string;
  relation_type: string;
  label: string;
}
export interface Inventory {
  version: number;
  revision: number;
  environments: Environment[];
  component_types: ComponentType[];
  components: Component[];
  relationships: Relationship[];
  settings: { auto_lock_minutes: number; terminal: string };
}
export interface Suggestion {
  id: string;
  source: string;
  name: string;
  component_type_id: string;
  properties: Properties;
}
export interface Scan {
  suggestions: Suggestion[];
  warnings: string[];
}
export const freshInventory = () => structuredClone(defaults) as Inventory;
export const uid = () => crypto.randomUUID();
export const typeOf = (d: Inventory, c: Component) =>
  d.component_types.find((t) => t.id === c.component_type_id)!;
export const actionOf = (d: Inventory, c: Component) =>
  c.launch_action ?? typeOf(d, c)?.launch_action;
export const summaryOf = (c: Component) =>
  String(
    c.properties.hostname ||
      c.properties.url ||
      c.properties.kube_context ||
      c.properties.engine ||
      "No endpoint",
  );
export const versionOf = (c: Component) =>
  String(
    c.properties.os_version ||
      c.properties.version ||
      c.properties.engine ||
      "",
  );
export const criticalityOf = (c: Component) =>
  String(c.properties.criticality || "low");
export function removeComponent(d: Inventory, id: string): Inventory {
  return {
    ...d,
    components: d.components.filter((c) => c.id !== id),
    relationships: d.relationships.filter(
      (r) => r.source_component_id !== id && r.target_component_id !== id,
    ),
  };
}
export function removeEnvironment(d: Inventory, id: string): Inventory {
  if (d.environments.some((e) => e.parent_id === id))
    throw new Error("Move or delete nested environments first.");
  const ids = new Set(
    d.components.filter((c) => c.environment_id === id).map((c) => c.id),
  );
  return {
    ...d,
    environments: d.environments.filter((e) => e.id !== id),
    components: d.components.filter((c) => !ids.has(c.id)),
    relationships: d.relationships.filter(
      (r) => !ids.has(r.source_component_id) && !ids.has(r.target_component_id),
    ),
  };
}
export interface Filters {
  search: string;
  type: string;
  criticality: string;
  internet: boolean;
  cross: boolean;
}
export const emptyFilters = (): Filters => ({
  search: "",
  type: "",
  criticality: "",
  internet: false,
  cross: false,
});
export function filteredComponents(
  d: Inventory,
  env: string,
  f: Filters,
): Component[] {
  const byId = new Map(d.components.map((c) => [c.id, c]));
  const crossIds = new Set(
    d.relationships
      .filter(
        (r) =>
          byId.get(r.source_component_id)?.environment_id !==
          byId.get(r.target_component_id)?.environment_id,
      )
      .flatMap((r) => [r.source_component_id, r.target_component_id]),
  );
  return d.components.filter(
    (c) =>
      c.environment_id === env &&
      (!f.type || c.component_type_id === f.type) &&
      (!f.criticality || criticalityOf(c) === f.criticality) &&
      (!f.internet || c.properties.internet_facing === true) &&
      (!f.cross || crossIds.has(c.id)) &&
      `${c.name} ${summaryOf(c)} ${versionOf(c)}`
        .toLowerCase()
        .includes(f.search.toLowerCase()),
  );
}
export function graphElements(d: Inventory, env: string, filters: Filters) {
  const visible = filteredComponents(d, env, filters);
  const local = new Set(visible.map((c) => c.id));
  const byId = new Map(d.components.map((c) => [c.id, c]));
  const edges = d.relationships.filter((r) => {
    const a = byId.get(r.source_component_id),
      b = byId.get(r.target_component_id);
    if (!a || !b) return false;
    const cross = a.environment_id !== b.environment_id;
    return (
      (!filters.cross || cross) &&
      ((local.has(a.id) && (local.has(b.id) || b.environment_id !== env)) ||
        (local.has(b.id) && a.environment_id !== env))
    );
  });
  const ids = new Set([
    ...local,
    ...edges.flatMap((r) => [r.source_component_id, r.target_component_id]),
  ]);
  return [
    ...d.components
      .filter((c) => ids.has(c.id))
      .map((c) => {
        const t = typeOf(d, c),
          external = c.environment_id !== env;
        const envName = d.environments.find(
          (e) => e.id === c.environment_id,
        )?.name;
        const badges = [
          c.properties.internet_facing === true ? "↗ PUBLIC" : "",
          `● ${criticalityOf(c).toUpperCase()}`,
        ]
          .filter(Boolean)
          .join("   ");
        return {
          data: {
            id: c.id,
            label: `${c.name}\n${t?.name || "Component"}${versionOf(c) ? ` · ${versionOf(c)}` : ""}\n${badges}${external ? `\n↗ ${envName}` : ""}`,
            color: t?.color || "#9a9db5",
            icon: nodeIcon(t?.icon || "box", t?.color || "#9a9db5"),
            environment: c.environment_id,
          },
          classes: `${external ? "external" : ""} ${criticalityOf(c) === "high" ? "critical" : ""}`,
        };
      }),
    ...edges.map((r) => ({
      data: {
        id: `edge-${r.id}`,
        source: r.source_component_id,
        target: r.target_component_id,
        label: r.label || r.relation_type.replaceAll("_", " "),
        targetEnvironment:
          byId.get(r.target_component_id)?.environment_id === env
            ? byId.get(r.source_component_id)?.environment_id
            : byId.get(r.target_component_id)?.environment_id,
      },
      classes:
        byId.get(r.source_component_id)?.environment_id !==
        byId.get(r.target_component_id)?.environment_id
          ? "cross"
          : "",
    })),
  ];
}
export function parseBackup(value: unknown): Inventory {
  if (!value || typeof value !== "object")
    throw new Error("Expected an inventory object.");
  const d = value as Inventory;
  if (
    d.version !== 1 ||
    !["environments", "components", "component_types", "relationships"].every(
      (k) => Array.isArray((d as unknown as Record<string, unknown>)[k]),
    ) ||
    !d.settings
  )
    throw new Error("Invalid or unsupported OpsPortal backup.");
  if (d.components.length > 20000 || d.relationships.length > 50000)
    throw new Error("Backup is too large.");
  for (const items of [
    d.environments,
    d.component_types,
    d.components,
    d.relationships,
  ]) {
    const ids = items.map((x) => x.id);
    if (
      ids.some((id) => typeof id !== "string" || !id) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Backup contains missing or duplicate IDs.");
  }
  const envs = new Set(d.environments.map((e) => e.id)),
    types = new Set(d.component_types.map((t) => t.id)),
    comps = new Set(d.components.map((c) => c.id));
  if (
    d.components.some(
      (c) =>
        !envs.has(c.environment_id) ||
        !types.has(c.component_type_id) ||
        !c.properties ||
        typeof c.name !== "string",
    )
  )
    throw new Error("Backup contains invalid components.");
  if (
    d.relationships.some(
      (r) =>
        !comps.has(r.source_component_id) || !comps.has(r.target_component_id),
    )
  )
    throw new Error("Backup contains broken relationships.");
  return d;
}
