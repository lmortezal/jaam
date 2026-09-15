import {
  actionOf,
  uid,
  type Component,
  type Inventory,
  type Properties,
  type Suggestion,
} from "./model";
import type { Change } from "./bulk";

export type ImportMatch = {
  kind: "new" | "existing" | "update" | "review";
  candidates: Component[];
  reason: string;
};
export type ImportChoice = { suggestion: Suggestion; target: string }; // new, skip, or existing component ID
const sourceKeys = [
  "source_ssh_alias",
  "source_resolved_hostname",
  "source_ssh_user",
  "source_ssh_port",
  "source_ssh_identity_file",
  "source_ssh_identity_files",
  "source_ssh_proxy_jump",
  "source_ssh_resolution",
];
const host = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
const endpoint = (p: Properties) => ({
  host: host(p.source_resolved_hostname ?? p.hostname),
  port: Number(p.ssh_port ?? p.source_ssh_port ?? 22),
  user: p.ssh_user ?? p.source_ssh_user,
});
const sameEndpoint = (a: Properties, b: Properties) => {
  const x = endpoint(a),
    y = endpoint(b);
  return (
    !!x.host &&
    x.host === y.host &&
    x.port === y.port &&
    x.user !== undefined &&
    x.user === y.user
  );
};
const sameRoute = (a: Properties, b: Properties) =>
  ["source_ssh_identity_files", "source_ssh_proxy_jump"].every(
    (k) => a[k] === b[k],
  );
const staticConnection = (p: Properties) =>
  p.source_ssh_resolution === "static-v1";
const unmodifiedLaunch = (d: Inventory, c: Component) =>
  !c.launch_action &&
  actionOf(d, c)?.action_type === "ssh_terminal" &&
  actionOf(d, c)?.template === "ssh {hostname}" &&
  !Object.keys(c.properties).some(
    (k) =>
      k.startsWith("ssh_") && c.properties[k] != null && c.properties[k] !== "",
  ) &&
  c.properties.hostname ===
    (c.properties.source_ssh_alias ?? c.properties.hostname);

export function importMatch(
  d: Inventory,
  suggestion: Suggestion,
  environment: string,
): ImportMatch {
  if (suggestion.component_type_id !== "server") {
    const candidates = d.components.filter(
      (c) =>
        c.component_type_id === suggestion.component_type_id &&
        c.properties.kube_context === suggestion.properties.kube_context,
    );
    return {
      kind: candidates.length ? "review" : "new",
      candidates,
      reason: candidates.length
        ? "An existing context matches. Review before adding another component."
        : "New context.",
    };
  }
  const p = suggestion.properties;
  const candidates = d.components.filter((c) => {
    if (
      c.component_type_id !== "server" &&
      c.properties.source_ssh_alias == null &&
      actionOf(d, c)?.action_type !== "ssh_terminal"
    )
      return false;
    const q = c.properties,
      x = endpoint(q),
      y = endpoint(p);
    const alias = q.source_ssh_alias ?? q.hostname;
    return (
      alias === p.hostname ||
      (x.host === y.host &&
        x.port === y.port &&
        (x.user == null || y.user == null || x.user === y.user))
    );
  });
  if (!candidates.length)
    return {
      kind: "new",
      candidates,
      reason:
        "New connection. Different known SSH users are separate connections.",
    };
  const confident =
    candidates.length === 1 &&
    candidates[0].environment_id === environment &&
    staticConnection(p) &&
    staticConnection(candidates[0].properties) &&
    sameEndpoint(p, candidates[0].properties) &&
    sameRoute(p, candidates[0].properties) &&
    unmodifiedLaunch(d, candidates[0]);
  if (confident) {
    const unchanged =
      candidates[0].properties.hostname === p.hostname &&
      sourceKeys.every((k) => candidates[0].properties[k] === p[k]);
    return {
      kind: unchanged ? "existing" : "update",
      candidates,
      reason: unchanged
        ? "This connection is already imported."
        : "Same resolved connection and launch settings. Refresh the alias while preserving the component ID and authored data.",
    };
  }
  return {
    kind: "review",
    candidates,
    reason:
      "Possible match: incomplete resolution, multiple records, another environment, or changed launch/identity settings. Choose explicitly; nothing is merged automatically.",
  };
}
export function defaultImportTarget(
  d: Inventory,
  s: Suggestion,
  environment: string,
) {
  const match = importMatch(d, s, environment);
  return match.kind === "new"
    ? "new"
    : match.kind === "update"
      ? match.candidates[0].id
      : match.kind === "existing"
        ? "skip"
        : "";
}
export function prepareImport(
  d: Inventory,
  choices: ImportChoice[],
  environment: string,
): { document: Inventory; changes: Change[]; added: number; updated: number } {
  if (!d.environments.some((e) => e.id === environment))
    throw new Error("Choose an existing environment.");
  const document = structuredClone(d),
    changes: Change[] = [],
    targets = new Set<string>();
  let added = 0,
    updated = 0;
  for (const { suggestion: s, target } of choices) {
    if (!target) throw new Error(`Choose how to handle ${s.name}.`);
    if (target === "skip") continue;
    if (target === "new") {
      if (!document.component_types.some((t) => t.id === s.component_type_id))
        throw new Error("Restore the component type before importing.");
      // Compare against additions in this same batch, not just the original inventory.
      const match = importMatch(document, s, environment);
      const addedCandidates = match.candidates.filter(
        (c) => !d.components.some((old) => old.id === c.id),
      );
      if (
        addedCandidates.some((c) => sameEndpoint(c.properties, s.properties)) ||
        addedCandidates.some(
          (c) => c.properties.hostname === s.properties.hostname,
        )
      ) {
        throw new Error(
          `${s.name} overlaps another new connection in this batch. Keep one alias, or import separately after review.`,
        );
      }
      const c: Component = {
        id: uid(),
        name: s.name,
        environment_id: environment,
        component_type_id: s.component_type_id,
        properties: structuredClone(s.properties),
        launch_action: null,
        updated_at: new Date().toISOString(),
      };
      document.components.push(c);
      added++;
      changes.push({
        id: c.id,
        name: c.name,
        field: "New component (all imported properties)",
        before: undefined,
        after: c.properties,
      });
      continue;
    }
    const match = importMatch(d, s, environment);
    if (!match.candidates.some((c) => c.id === target))
      throw new Error(`The match for ${s.name} changed. Review again.`);
    if (targets.has(target))
      throw new Error(
        "Two aliases cannot update the same component in one batch. Keep one alias or skip the extra suggestion.",
      );
    targets.add(target);
    const c = document.components.find((c) => c.id === target)!;
    if (s.component_type_id !== "server")
      throw new Error(
        "Existing Kubernetes contexts are preserved. Skip or explicitly add a separate component.",
      );
    // Only imported metadata and the explicitly reviewed launch alias are refreshed.
    // IDs, names, type, environment, overrides, relationships and arbitrary fields survive.
    for (const key of ["hostname", ...sourceKeys]) {
      const before = c.properties[key],
        after = s.properties[key];
      if (Object.is(before, after)) continue;
      changes.push({ id: c.id, name: c.name, field: key, before, after });
      if (after === undefined) delete c.properties[key];
      else c.properties[key] = after;
    }
    if (changes.some((change) => change.id === c.id)) {
      c.updated_at = new Date().toISOString();
      updated++;
    }
  }
  return { document, changes, added, updated };
}
