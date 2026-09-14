# Platform acceptance

## Current verification (2026-09-13)

- macOS release app builds; its local ad-hoc signature verifies successfully.
- System authentication was completed by the user; the rebuilt native app reopened the existing inventory and displayed 47 components in its list.
- Ordinary SQLite rejected the native database without its key.
- A native diagram check exposed Dagre's single-row layout for mostly disconnected components. The layout now packs disconnected groups separately; a synthetic 47-host regression checks compact bounds, node separation, and relationship direction.
- Existing infrastructure data was not edited or launched during these native checks.
- Linux build and desktop verification are explicitly deferred to the user.

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
- [ ] Export JSON/YAML, restore into the app, and verify components, schemas, settings, and relationships. Keep exports private; they are intentionally plaintext.
- [ ] Observe the packaged process's network activity while browsing, editing, scanning, and locking. No app-originated external connections should occur. Separately exercise the two explicit launch actions.
- [ ] On Linux, verify missing policy, absent authentication agent, locked Secret Service, and unavailable Secret Service all fail closed with a useful error.

Local build/test outcomes should be recorded in the delivery message. Linux desktop verification, hardware authentication, and successful terminal/browser launches remain manual until exercised on actual target machines.
