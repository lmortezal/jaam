import { useState, type FormEvent } from "react";
import { Modal } from "./ui";
export function BackupPassword({
  restoring,
  onSubmit,
  onClose,
}: {
  restoring: boolean;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!restoring && password !== repeat) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(password);
      setPassword("");
      setRepeat("");
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={restoring ? "Decrypt backup" : "Export encrypted backup"}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p>
          This backup password is separate from your system password. It is
          never saved. Keep it safe: there is no password recovery.
        </p>
        <label>
          Backup password
          <input
            autoFocus
            type="password"
            autoComplete={restoring ? "current-password" : "new-password"}
            required
            minLength={restoring ? 1 : 12}
            maxLength={1024}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {!restoring && (
          <label>
            Confirm backup password
            <input
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary">
            {busy ? "Working…" : restoring ? "Decrypt" : "Encrypt and export"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
