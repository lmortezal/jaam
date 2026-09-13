# OpsPortal

A personal, offline infrastructure knowledge base and launcher for macOS and Linux. Built with Tauri 2, Rust, React, SQLCipher, and bundled Cytoscape/Dagre. The installed application starts with an empty, locked vault.

## Run

Requires Node.js 22.12+ (Node 24 recommended), Rust stable, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). On macOS, install Xcode Command Line Tools. The launch scripts also recognize a workspace-local Rust installation in `.toolchain/`.

```sh
npm ci
npm run desktop
```

Open the native app and select **Unlock OpsPortal**. macOS uses a new `LAContext` with `deviceOwnerAuthentication`, zero biometric reuse duration, and system password fallback. Authentication is never replaced by an application password or a browser dialog.

To explore the interface without touching the key store, database, or local configs:

```sh
npm run demo
```

Visit `http://127.0.0.1:1420`. This explicitly labeled demo uses example data **only in memory**. It cannot launch terminals, open infrastructure URLs, or read config files. Its fixture module is excluded from production builds. Ordinary `npm run dev` in a browser cannot unlock anything; it needs the Tauri backend.

## Build

```sh
# macOS .app (on macOS)
npm run bundle -- --bundles app

# Linux packages (on Linux, with Tauri dependencies installed)
npm run bundle -- --bundles deb rpm
```

Outputs are under `src-tauri/target/release/bundle/`. macOS bundles are ad-hoc signed for local use, not Developer ID signed/notarized for public distribution. Build on each target platform; the macOS build does not validate Linux behavior. Windows is intentionally not a supported compilation target yet.

### Linux system integration

Linux needs a graphical session, polkit, a desktop polkit authentication agent, and a Secret Service implementation exposing `org.freedesktop.secrets` (for example GNOME Keyring; KWallet only if Secret Service support is enabled). A locked or unavailable key store fails closed. There is no plaintext key fallback.

The `.deb`/`.rpm` bundles install `src-tauri/linux/dev.opsportal.unlock.policy`. For source development or an AppImage, install this policy once:

```sh
sudo install -m 644 src-tauri/linux/dev.opsportal.unlock.policy \
  /usr/share/polkit-1/actions/dev.opsportal.unlock.policy
```

The app uses `pkcheck` with the current PID, process start time, and UID. Its dedicated policy requires **`auth_self`**, with no retained authorization. It never executes a privileged helper. Generic `pkexec true` would not provide the intended account-level gate.

Fingerprint availability and password fallback depend on the distribution's polkit PAM stack and enrolled hardware. Test both paths on each supported desktop. The app cannot force a biometric option or restore password fallback in a misconfigured PAM stack. Do not add a local polkit rule that grants this action without authentication or retains its authorization.

## Using the workspace

- Create environments, optionally nested under another environment. Cards and sidebar counts refer to directly owned components.
- Add components using an editable type schema. Extra scalar text, number, and boolean fields are always available. Common starter types are editable defaults, not a fixed inventory schema.
- Add outgoing relationships in the component editor. Incoming relationships are shown in details; edit their source component to change them. Relationship names and descriptions are free text.
- Switch between a sortable/filterable list and an automatically arranged diagram. Graph nodes show type, version, criticality, and public exposure. Remote endpoints have dashed borders; dashed edges navigate to the other environment. Click a node for details, or double-click to launch.
- Use a row's launch button or the detail panel to launch. Only `http://`/`https://` browser URLs and SSH terminal sessions are enabled in v1. A component can inherit, replace, or disable its type's action.
- Read local configs in Import assist, select suggestions and an environment, then explicitly add them. Nothing is imported automatically.
- Manage component types and launch templates, select a 1–120 minute idle timeout, and import/export whole-workspace JSON or YAML in Settings. Restore validates and atomically replaces the inventory. Export asks for confirmation because the file is **unencrypted**.
- `⌘K` / `Ctrl+K` searches all environments and components. `⇧⌘L` / `Ctrl+Shift+L` locks immediately. List view provides keyboard-accessible alternatives to canvas interactions.

### Launch templates

Browser: `{url}`, `https://{hostname}`, or a complete URL containing property placeholders. Embedded URL credentials and non-HTTP(S) schemes are rejected.

SSH: `ssh {hostname}` is the default. `ssh_user`, `ssh_port`, and `ssh_identity_file` apply automatically when set. Templates may explicitly use `-l`, `-p`, or `-i`, for example `ssh {ssh_user}@{hostname} -p {ssh_port}`. Tokens are split **before** substitution. Host/user/port values are validated; there must be one destination and no remote command. Other SSH options belong in the user's existing SSH config.

macOS safely quotes each argument, passes the finished command as an AppleScript argument, and asks Terminal.app or iTerm2 to execute it. The first launch may require the OS Automation permission. Linux spawns a terminal with an argument vector and no shell. A recognized `$TERMINAL` name is preferred, then `gnome-terminal`, `konsole`, `alacritty`, `kitty`, and `xterm`. Arbitrary `$TERMINAL` command strings are not evaluated.

SSH suggestions retain the literal alias as `hostname`, so OpenSSH remains authoritative for Include, Match, ProxyJump, identity selection, and first-value-wins semantics. Parsed metadata is prefixed with `source_` and is informational. The reader does not follow Includes, evaluate wildcard/Match rules, or run `ssh -G` (which could execute `Match exec`). Kubernetes imports whitelist context name, cluster name, namespace, and API endpoint; users, tokens, certificate data, and exec plugins are discarded.

## Storage and security boundaries

- Database: `~/Library/Application Support/dev.opsportal.desktop/inventory.db` on macOS; `$XDG_DATA_HOME/dev.opsportal.desktop/inventory.db` or `~/.local/share/dev.opsportal.desktop/inventory.db` on Linux.
- Key: a random 256-bit key, stored as `database-key-v1` under service `dev.opsportal.desktop` in the OS key store. It is retrieved only after successful system authentication. Missing keys never trigger regeneration over an existing database.
- SQLCipher and OpenSSL are bundled. The backend checks `cipher_version`, uses memory-only temporary storage, and enables SQLCipher memory security. No unencrypted SQLite fallback exists. Directory/file modes are 0700/0600. A process-lifetime file lock prevents simultaneous first-run key generation.
- The encrypted SQLite row contains a versioned inventory document. Whole-document transactions keep relationship edits and component deletion atomic; revision checks reject stale writes. This is deliberately a single-user design, capped at 20,000 components, 50,000 relationships, and 16 MB. It does not need a background indexing service.
- Every inventory, scan, preview, and launch command requires a live backend session. Idle expiry closes the connection and clears React inventory, editor, graph, search, and import state. Both monotonic and wall-clock checks cover suspend and clock rollback. Late asynchronous results cannot reopen a locked UI. Already launched terminals remain open after locking.
- The webview has a restrictive production CSP, bundled assets, no HTTP/updater/shell plugins, and no analytics or discovery tasks. Browser/SSH launches are the only intentional external actions. Development uses a local Vite server; OS authentication/key-store services and applications you launch have their own behavior.
- This gate protects the application and encrypted files. The generic keyring API does **not** provide per-item hardware authentication binding, especially with an already unlocked Linux Secret Service. It is not a defense against root, a compromised OS, or arbitrary code running as your user. JavaScript inventory strings are cleared from application state but cannot be guaranteed physically overwritten in managed memory.
- Credential storage is not implemented. Known credential property names are rejected, and kube credential material is never imported. Free-form notes cannot be reliably classified as secrets, so do not paste credentials into them. An unused Rust `SecretRef` provides the requested extension point; any future secrets module needs its own per-item native access controls.

## Verification

```sh
npm run build
npm test
npm run test:native
npm exec -- playwright install chromium
npm run test:e2e
```

Rust tests cover encrypted reopen, wrong-key rejection, stale revisions, authentication/expiry guards, unsafe launch inputs, model validation, and config whitelisting. Frontend tests cover graph boundaries, filters, deletion, and backup references. Browser tests exercise CRUD, custom fields, cross-environment relationships, graph rendering, import selection, custom types, export, locking, and absence of remote requests during those flows.

The automated browser suite uses the explicitly separate demo; it does not simulate successful native authentication. Complete the [platform acceptance checks](docs/ACCEPTANCE.md) on macOS and Linux before treating this as a security-validated release.

API references: [Apple device-owner authentication](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication), [polkit authorization policies](https://polkit.pages.freedesktop.org/polkit/polkit.8.html), [rusqlite SQLCipher features](https://github.com/rusqlite/rusqlite), [Tauri CSP](https://v2.tauri.app/security/csp/).

# jaam
