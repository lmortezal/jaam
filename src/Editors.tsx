import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "./ui";
import {
  uid,
  type Inventory,
  type Environment,
  type Component,
  type ComponentType,
  type Field,
  type LaunchAction,
  type Properties,
  type Relationship,
} from "./model";

function ActionEditor({
  value,
  onChange,
  inherit = false,
}: {
  value: LaunchAction | null;
  onChange: (v: LaunchAction | null) => void;
  inherit?: boolean;
}) {
  return (
    <div className="action-editor">
      <label>
        Launch action
        <select
          value={value?.action_type || ""}
          onChange={(e) =>
            onChange(
              e.target.value
                ? {
                    action_type: e.target.value as LaunchAction["action_type"],
                    template:
                      e.target.value === "ssh_terminal"
                        ? "ssh {hostname}"
                        : e.target.value === "open_url"
                          ? "{url}"
                          : "",
                  }
                : null,
            )
          }
        >
          <option value="">
            {inherit ? "Use component type default" : "No launch action"}
          </option>
          <option value="none">Disabled</option>
          <option value="open_url">Open in browser</option>
          <option value="ssh_terminal">SSH in terminal</option>
          <option value="custom_command" disabled>
            Custom command · future release
          </option>
        </select>
      </label>
      {value && ["open_url", "ssh_terminal"].includes(value.action_type) && (
        <label>
          Template
          <input
            value={value.template}
            onChange={(e) => onChange({ ...value, template: e.target.value })}
            required
          />
          <small>
            {value.action_type === "ssh_terminal"
              ? "Use ssh {hostname}. User, port, and identity path fields apply automatically. Optional template flags: -l, -p, -i."
              : "Use a full HTTP(S) URL or a property placeholder such as {url}."}
          </small>
        </label>
      )}
    </div>
  );
}
export function EnvironmentEditor({
  data,
  value,
  onSave,
  onClose,
}: {
  data: Inventory;
  value: Environment | null;
  onSave: (v: Environment) => Promise<void>;
  onClose: () => void;
}) {
  const [v, set] = useState<Environment>(
    value || {
      id: uid(),
      name: "",
      description: "",
      color: "#a395f6",
      icon: "building",
      parent_id: null,
    },
  );
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...v, name: v.name.trim() });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={value ? "Edit environment" : "New environment"}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label>
          Name
          <input
            autoFocus
            required
            maxLength={256}
            placeholder="e.g. Datacenter A"
            value={v.name}
            onChange={(e) => set({ ...v, name: e.target.value })}
          />
        </label>
        <label>
          Description
          <textarea
            rows={3}
            placeholder="What lives here?"
            value={v.description}
            onChange={(e) => set({ ...v, description: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Color
            <input
              type="color"
              value={v.color}
              onChange={(e) => set({ ...v, color: e.target.value })}
            />
          </label>
          <label>
            Icon
            <select
              value={v.icon}
              onChange={(e) => set({ ...v, icon: e.target.value })}
            >
              {["building", "server", "boxes", "globe", "flask", "box"].map(
                (x) => (
                  <option key={x}>{x}</option>
                ),
              )}
            </select>
          </label>
        </div>
        <label>
          Parent environment
          <select
            value={v.parent_id || ""}
            onChange={(e) => set({ ...v, parent_id: e.target.value || null })}
          >
            <option value="">None · top-level environment</option>
            {data.environments
              .filter((x) => x.id !== v.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : value ? "Save changes" : "Create environment"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function ComponentEditor({
  data,
  environment,
  value,
  onSave,
  onClose,
}: {
  data: Inventory;
  environment: string;
  value: Component | null;
  onSave: (v: Component, rels: Relationship[]) => Promise<void>;
  onClose: () => void;
}) {
  const [v, set] = useState<Component>(
    value
      ? structuredClone(value)
      : {
          id: uid(),
          environment_id: environment,
          component_type_id: data.component_types[0]?.id || "",
          name: "",
          properties: {},
          launch_action: null,
          updated_at: new Date().toISOString(),
        },
  );
  const [relations, setRelations] = useState(
    data.relationships
      .filter((r) => r.source_component_id === value?.id)
      .map((r) => ({ ...r })),
  );
  const initialType = data.component_types.find(
    (t) => t.id === v.component_type_id,
  );
  const [extras, setExtras] = useState(() =>
    Object.entries(v.properties)
      .filter(([k]) => !initialType?.fields.some((f) => f.key === k))
      .map(([key, value]) => ({
        key,
        value: String(value ?? ""),
        kind:
          typeof value === "boolean"
            ? "bool"
            : typeof value === "number"
              ? "number"
              : "text",
      })),
  );
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const type = data.component_types.find((t) => t.id === v.component_type_id);
  const property = (key: string, value: Properties[string]) =>
    set({ ...v, properties: { ...v.properties, [key]: value } });
  const switchType = (id: string) => {
    const t = data.component_types.find((t) => t.id === id)!;
    const all: Properties = Object.fromEntries(
      Object.entries(v.properties).filter(([key]) =>
        type?.fields.some((f) => f.key === key),
      ),
    );
    const seen = new Set(Object.keys(all));
    for (const x of extras) {
      if (!x.key.trim() || seen.has(x.key)) {
        setError(
          "Finish or remove duplicate/empty extra fields before changing type.",
        );
        return;
      }
      seen.add(x.key);
      if (
        x.kind === "number" &&
        (!x.value.trim() || !Number.isFinite(Number(x.value)))
      ) {
        setError(`${x.key} needs a number.`);
        return;
      }
      all[x.key] =
        x.kind === "number"
          ? Number(x.value)
          : x.kind === "bool"
            ? x.value === "true"
            : x.value;
    }
    setExtras(
      Object.entries(all)
        .filter(([key]) => !t.fields.some((f) => f.key === key))
        .map(([key, value]) => ({
          key,
          value: String(value ?? ""),
          kind:
            typeof value === "boolean"
              ? "bool"
              : typeof value === "number"
                ? "number"
                : "text",
        })),
    );
    set({ ...v, component_type_id: id, properties: all });
    setError("");
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (!type) throw new Error("Create a component type first.");
      const props: Properties = Object.fromEntries(
        Object.entries(v.properties).filter(
          ([k, val]) => type.fields.some((f) => f.key === k) && val !== "",
        ),
      );
      const seen = new Set<string>();
      for (const x of extras) {
        const key = x.key.trim();
        if (!key || seen.has(key) || type.fields.some((f) => f.key === key))
          throw new Error(
            "Extra property keys must be nonempty, unique, and outside the type schema.",
          );
        seen.add(key);
        if (
          x.kind === "number" &&
          (!x.value.trim() || !Number.isFinite(Number(x.value)))
        )
          throw new Error(`${key} needs a number.`);
        props[key] =
          x.kind === "number"
            ? Number(x.value)
            : x.kind === "bool"
              ? x.value === "true"
              : x.value;
      }
      if (
        relations.some((r) => !r.target_component_id || !r.relation_type.trim())
      )
        throw new Error(
          "Choose a target and relation type for every relationship.",
        );
      await onSave(
        {
          ...v,
          name: v.name.trim(),
          properties: props,
          updated_at: new Date().toISOString(),
        },
        relations,
      );
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={value ? "Edit component" : "New component"}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Name
            <input
              autoFocus
              required
              maxLength={256}
              placeholder="e.g. prod-worker-01"
              value={v.name}
              onChange={(e) => set({ ...v, name: e.target.value })}
            />
          </label>
          <label>
            Component type
            <select
              value={v.component_type_id}
              onChange={(e) => switchType(e.target.value)}
            >
              {data.component_types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Environment
          <select
            value={v.environment_id}
            onChange={(e) => set({ ...v, environment_id: e.target.value })}
          >
            {data.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <div className="section-label">PROPERTIES</div>
        <div className="form-grid">
          {type?.fields.map((f) => (
            <label key={f.key} className={f.key === "notes" ? "span-two" : ""}>
              {f.label || f.key}
              {f.field_type === "bool" ? (
                <select
                  value={
                    v.properties[f.key] === undefined
                      ? ""
                      : String(v.properties[f.key])
                  }
                  onChange={(e) =>
                    property(
                      f.key,
                      e.target.value === "" ? null : e.target.value === "true",
                    )
                  }
                >
                  <option value="">Not set</option>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              ) : f.field_type === "enum" ? (
                <select
                  value={String(v.properties[f.key] || "")}
                  onChange={(e) => property(f.key, e.target.value || null)}
                >
                  <option value="">Not set</option>
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.key === "notes" ? (
                <textarea
                  rows={3}
                  value={String(v.properties[f.key] ?? "")}
                  onChange={(e) => property(f.key, e.target.value)}
                  placeholder="Purpose, maintenance notes, runbooks…"
                />
              ) : (
                <input
                  type={f.field_type === "number" ? "number" : "text"}
                  step="any"
                  value={String(v.properties[f.key] ?? "")}
                  onChange={(e) =>
                    property(
                      f.key,
                      f.field_type === "number"
                        ? e.target.value === ""
                          ? null
                          : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              )}
            </label>
          ))}
        </div>
        <div className="section-heading">
          <span className="section-label">EXTRA FIELDS</span>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setExtras([...extras, { key: "", value: "", kind: "text" }])
            }
          >
            <Plus size={14} /> Add field
          </button>
        </div>
        {extras.map((x, i) => (
          <div className="extra-row" key={i}>
            <input
              aria-label={`Extra field ${i + 1} key`}
              placeholder="Field key"
              value={x.key}
              onChange={(e) =>
                setExtras(
                  extras.map((x, j) =>
                    i === j ? { ...x, key: e.target.value } : x,
                  ),
                )
              }
            />
            <select
              aria-label={`Extra field ${i + 1} type`}
              value={x.kind}
              onChange={(e) =>
                setExtras(
                  extras.map((x, j) =>
                    i === j
                      ? {
                          ...x,
                          kind: e.target.value,
                          value: e.target.value === "bool" ? "false" : x.value,
                        }
                      : x,
                  ),
                )
              }
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="bool">Boolean</option>
            </select>
            {x.kind === "bool" ? (
              <select
                aria-label={`Extra field ${i + 1} value`}
                value={x.value}
                onChange={(e) =>
                  setExtras(
                    extras.map((x, j) =>
                      i === j ? { ...x, value: e.target.value } : x,
                    ),
                  )
                }
              >
                <option value="false">False</option>
                <option value="true">True</option>
              </select>
            ) : (
              <input
                aria-label={`Extra field ${i + 1} value`}
                placeholder="Value"
                value={x.value}
                onChange={(e) =>
                  setExtras(
                    extras.map((x, j) =>
                      i === j ? { ...x, value: e.target.value } : x,
                    ),
                  )
                }
              />
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Remove extra field"
              onClick={() => setExtras(extras.filter((_, j) => j !== i))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <small>
          Inventory data only. Never enter passwords, tokens, or private keys.
        </small>
        <div className="section-heading">
          <span className="section-label">OUTGOING RELATIONSHIPS</span>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setRelations([
                ...relations,
                {
                  id: uid(),
                  source_component_id: v.id,
                  target_component_id: "",
                  relation_type: "connects_to",
                  label: "",
                },
              ])
            }
          >
            <Plus size={14} /> Add relationship
          </button>
        </div>
        {relations.map((r, i) => (
          <div className="relation-editor" key={r.id}>
            <div className="form-grid">
              <label>
                Relation
                <input
                  list="relations"
                  required
                  value={r.relation_type}
                  onChange={(e) =>
                    setRelations(
                      relations.map((r, j) =>
                        i === j ? { ...r, relation_type: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Target
                <select
                  required
                  value={r.target_component_id}
                  onChange={(e) =>
                    setRelations(
                      relations.map((r, j) =>
                        i === j
                          ? { ...r, target_component_id: e.target.value }
                          : r,
                      ),
                    )
                  }
                >
                  <option value="">Choose a component</option>
                  {data.components
                    .filter((c) => c.id !== v.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ·{" "}
                        {
                          data.environments.find(
                            (e) => e.id === c.environment_id,
                          )?.name
                        }
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="inline">
              <input
                aria-label="Relationship description"
                placeholder="Optional workflow description"
                value={r.label}
                onChange={(e) =>
                  setRelations(
                    relations.map((r, j) =>
                      i === j ? { ...r, label: e.target.value } : r,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Remove relationship"
                onClick={() =>
                  setRelations(relations.filter((_, j) => i !== j))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        <datalist id="relations">
          {[
            "points_to",
            "connects_to",
            "member_of",
            "load_balances",
            "routes_via",
            "replicates_to",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </datalist>
        <div className="section-label">LAUNCH</div>
        <ActionEditor
          inherit
          value={v.launch_action}
          onChange={(a) => set({ ...v, launch_action: a })}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={saving} className="primary">
            {saving ? "Saving…" : value ? "Save changes" : "Add component"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function TypeEditor({
  value,
  onSave,
  onClose,
}: {
  value: ComponentType | null;
  onSave: (v: ComponentType) => Promise<void>;
  onClose: () => void;
}) {
  const [v, set] = useState<ComponentType>(
    value
      ? structuredClone(value)
      : {
          id: uid(),
          name: "",
          icon: "box",
          color: "#a395f6",
          fields: [],
          launch_action: null,
        },
  );
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const field = (i: number, patch: Partial<Field>) =>
    set({
      ...v,
      fields: v.fields.map((f, j) => (i === j ? { ...f, ...patch } : f)),
    });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (new Set(v.fields.map((f) => f.key)).size !== v.fields.length)
        throw new Error("Field keys must be unique.");
      await onSave(v);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={value ? "Edit component type" : "New component type"}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Name
            <input
              autoFocus
              required
              maxLength={256}
              value={v.name}
              onChange={(e) => set({ ...v, name: e.target.value })}
            />
          </label>
          <label>
            Icon
            <select
              value={v.icon}
              onChange={(e) => set({ ...v, icon: e.target.value })}
            >
              {[
                "server",
                "globe",
                "network",
                "boxes",
                "database",
                "building",
                "flask",
                "box",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Color
          <input
            type="color"
            value={v.color}
            onChange={(e) => set({ ...v, color: e.target.value })}
          />
        </label>
        <div className="section-heading">
          <span className="section-label">FIELD SCHEMA</span>
          <button
            className="text-button"
            type="button"
            onClick={() =>
              set({
                ...v,
                fields: [
                  ...v.fields,
                  { key: "", label: "", field_type: "text", options: [] },
                ],
              })
            }
          >
            <Plus size={14} /> Add field
          </button>
        </div>
        {v.fields.map((f, i) => (
          <div className="schema-row" key={i}>
            <input
              aria-label={`Schema field ${i + 1} key`}
              required
              placeholder="key"
              value={f.key}
              onChange={(e) => field(i, { key: e.target.value })}
            />
            <input
              aria-label={`Schema field ${i + 1} label`}
              placeholder="Label"
              value={f.label}
              onChange={(e) => field(i, { label: e.target.value })}
            />
            <select
              aria-label={`Schema field ${i + 1} type`}
              value={f.field_type}
              onChange={(e) =>
                field(i, { field_type: e.target.value as Field["field_type"] })
              }
            >
              {["text", "number", "bool", "enum"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label="Remove schema field"
              onClick={() =>
                set({ ...v, fields: v.fields.filter((_, j) => i !== j) })
              }
            >
              <Trash2 size={15} />
            </button>
            {f.field_type === "enum" && (
              <input
                className="span-all"
                required
                aria-label="Enum options"
                placeholder="Options, separated, by commas"
                value={f.options.join(",")}
                onChange={(e) =>
                  field(i, {
                    options: e.target.value.split(",").map((v) => v.trim()),
                  })
                }
              />
            )}
          </div>
        ))}
        <ActionEditor
          value={v.launch_action}
          onChange={(a) => set({ ...v, launch_action: a })}
        />
        <small>
          Changes apply to every component using this type. Existing values must
          match the new schema.
        </small>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save component type"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
