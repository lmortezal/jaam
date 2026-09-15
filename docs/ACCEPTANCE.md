# Platform acceptance

## Earlier native verification (2026-09-13)

- macOS release app builds; its local ad-hoc signature verifies successfully.
- System authentication was completed by the user; the rebuilt native app reopened the existing inventory and displayed 47 components in its list.
- Ordinary SQLite rejected the native database without its key.
- A native diagram check exposed Dagre's single-row layout for mostly disconnected components. The layout now packs disconnected groups separately; a synthetic 47-host regression checks compact bounds, node separation, and relationship direction.
- Existing infrastructure data was not edited or launched during these native checks.
- Linux build and desktop verification are explicitly deferred to the user.

## Incremental implementation checks (2026-09-15)

The current changes add inventory v2, encrypted age backups, shared visual primitives, saved diagram positions/locks, atomic bulk editing, directed multi-selection relationships, visual containers, and safe SSH import review. Automated tests use synthetic inventories and temporary config files; they do not open or modify the user's live vault. Current automated results: 13 frontend tests, 10 native tests (including backup authentication), and 5 browser workflows passed. The final macOS `.app` build and strict ad-hoc signature verification passed; TypeScript/Vite and `git diff --check` passed. Build advisories remain for the frontend chunk size and the transitive `proc-macro-error2` future-compatibility warning. The earlier hardware authentication check above does not validate these new native file flows.

## Manual checklist

These require a real graphical login and human authentication. They are not replaced by the demo tests, and have not been claimed as passing solely because compilation succeeds.

Run on both macOS and Linux:

- [ ] Open the packaged app. Only the unlock screen is visible; cancel authentication and confirm the inventory remains inaccessible.
- [ ] Authenticate using the enrolled biometric. Lock and immediately unlock again; a new system challenge appears.
- [ ] Exercise the account-password path without biometrics. On Linux verify a non-administrator account authenticates as itself and that the desktop's PAM setup provides password fallback.
- [ ] Create an environment, several different component types, extra fields, and local/cross-environment relationships. Restart the app and authenticate; all changes remain.
- [ ] Attempt to read a copy of `inventory.db` with ordinary SQLite; it must fail. Never modify the live vault for this check.
- [ ] Add a safe URL, then explicitly launch it from list and diagram. Verify the system browser opens it. Do not use real production endpoints for unattended tests.
- [ ] Add a test SSH host and explicitly launch it. Verify the correct terminal, user, port, and identity-path behavior. macOS must request Automation permission if not already granted. Test both Terminal.app and iTerm2 if installed.
- [ ] Read SSH/kube suggestions. Compare source-file hashes before and after scanning/importing; both must be unchanged. Confirm credential plugins are not executed.
- [ ] Choose a one-minute timeout, leave the app idle, and verify the UI clears and backend operations require reauthentication. Repeat across system sleep longer than the timeout.
- [ ] Export an encrypted `.json.age` backup with a new password. Restart/unlock, restore with that password, and verify the preview and all inventory/diagram data. Wrong passwords, truncated or modified backups must leave the inventory unchanged. Confirm no plaintext export is available and legacy JSON/YAML remains importable.
- [ ] Move and lock nodes, apply filters, switch views, restart/unlock, and confirm their saved positions. Explicit Arrange must preserve locked connected regions. If a diagram save fails, verify the error and retry affordance.
- [ ] Ctrl/Cmd-select multiple nodes or use list checkboxes. Preview Keep / Set / Clear patches with mixed values; verify untouched fields and atomic failure behavior. Preview both directions of a multi-node relationship operation.
- [ ] Create, move, resize, rename and reopen a visual group. Verify membership survives restart, relations do not change, and locked members prevent moving their container.
- [ ] Rename only a fixture SSH alias, rescan and preview its confident refresh. Confirm component ID, authored name, notes, relationships and diagram position survive. Verify different users remain distinct and legacy/incomplete/proxied/ambiguous matches require review.
- [ ] Observe the packaged process's network activity while browsing, editing, scanning, and locking. No app-originated external connections should occur. Separately exercise the two explicit launch actions.
- [ ] On Linux, verify missing policy, absent authentication agent, locked Secret Service, and unavailable Secret Service all fail closed with a useful error.

Local build/test outcomes should be recorded in the delivery message. Linux desktop verification, hardware authentication, and successful terminal/browser launches remain manual until exercised on actual target machines.
