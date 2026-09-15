import { useState } from "react";
import { Modal } from "./ui";
import { displayValue } from "./bulk";
import { defaultImportTarget, importMatch, prepareImport } from "./importPlan";
import type { Inventory, Suggestion } from "./model";
export function ImportReview({
  data,
  suggestions,
  environment,
  onSave,
  onClose,
}: {
  data: Inventory;
  suggestions: Suggestion[];
  environment: string;
  onSave: (d: Inventory) => Promise<unknown>;
  onClose: () => void;
}) {
  const [selection] = useState(suggestions);
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(
      selection.map((s) => [s.id, defaultImportTarget(data, s, environment)]),
    ),
  );
  const [preview, setPreview] = useState<ReturnType<
      typeof prepareImport
    > | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Review config import" onClose={onClose} wide>
      <p>
        {selection.length} suggestions selected. New components go into{" "}
        {data.environments.find((e) => e.id === environment)?.name}. Refreshing
        an SSH alias preserves the existing component’s name, ID, type,
        environment, relationships, launch overrides and authored fields.
      </p>
      {selection.map((s) => {
        const match = importMatch(data, s, environment);
        return (
          <div className="import-choice" key={s.id}>
            <label>
              {s.name}
              <select
                aria-label={`Import decision for ${s.name}`}
                value={choices[s.id]}
                onChange={(e) => {
                  setChoices({ ...choices, [s.id]: e.target.value });
                  setPreview(null);
                }}
              >
                <option value="">Choose after review</option>
                <option value="skip">Skip</option>
                <option value="new">Add a separate component</option>
                {s.component_type_id === "server" &&
                  match.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      Refresh SSH alias on {c.name} ·{" "}
                      {
                        data.environments.find((e) => e.id === c.environment_id)
                          ?.name
                      }
                    </option>
                  ))}
              </select>
            </label>
            <p className="muted">{match.reason}</p>
            <small>
              Resolved endpoint:{" "}
              {String(
                s.properties.source_resolved_hostname ??
                  s.properties.hostname ??
                  "unknown",
              )}{" "}
              · port {String(s.properties.source_ssh_port ?? "default")} · user{" "}
              {String(s.properties.source_ssh_user ?? "unknown")}
            </small>
            {choices[s.id] && !["new", "skip"].includes(choices[s.id]) && (
              <p className="warning-note">
                This changes the stored launch alias. Existing manual SSH
                options stay in place and may override the imported connection
                details.
              </p>
            )}
          </div>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="bulk-preview">
          <p>
            {preview.added} to add; {preview.updated} to refresh;{" "}
            {preview.changes.length} changes. Unlisted fields remain unchanged.
          </p>
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Property</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {preview.changes.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td>{c.field}</td>
                  <td>{displayValue(c.before)}</td>
                  <td>{displayValue(c.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.document.revision !== data.revision && (
            <p className="error">Inventory changed. Preview again.</p>
          )}
        </div>
      )}
      <footer className="modal-footer">
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="secondary"
          onClick={() => {
            try {
              setPreview(
                prepareImport(
                  data,
                  selection.map((s) => ({
                    suggestion: s,
                    target: choices[s.id],
                  })),
                  environment,
                ),
              );
              setError("");
            } catch (e) {
              setPreview(null);
              setError(String(e));
            }
          }}
        >
          Preview import
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            !preview?.changes.length ||
            preview.document.revision !== data.revision
          }
          onClick={async () => {
            if (!preview) return;
            setBusy(true);
            try {
              await onSave(preview.document);
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Apply import
        </button>
      </footer>
    </Modal>
  );
}
