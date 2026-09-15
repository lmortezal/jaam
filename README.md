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
- Switch between a sortable/filterable list and a diagram with saved manual positions and position locks. Arrange runs initially for a new view and explicitly when requested; connected regions containing locked nodes stay in place. Graph nodes show type, version, criticality, and public exposure. Remote endpoints have dashed borders; dashed edges navigate to the other environment. Click a node for details, or double-click to launch.
- Use a row's launch button or the detail panel to launch. Only `http://`/`https://` browser URLs and SSH terminal sessions are enabled in v1. A component can inherit, replace, or disable its type's action.
- Use list checkboxes or Ctrl/Cmd-click in the diagram for shared selection. Bulk edits show Mixed values and Keep / Set / Clear operations, followed by an exact preview and one atomic save. Endpoint, SSH, and credential fields are excluded from bulk editing. Type changes retain compatible properties and preview changes to inherited launch actions.
- Link selected components with an explicit target and direction. The preview is a directed star, skips self-links and exact duplicates, and never creates an implicit all-to-all mesh.
- Add named visual groups, select their members, drag the container, and resize using its handle or minimum dimensions in the editor. Membership is diagram state, not a dependency relationship. Each local node can belong to one group per environment; nested groups are not supported. Containers always enclose their members and cannot be dragged when a member is position-locked.
- Read local configs in Import assist, select suggestions and an environment, then review and preview additions or SSH alias refreshes before applying them. Confident matches preserve IDs and authored fields. Ambiguous matches require an explicit decision. Nothing is imported automatically.
- Manage component types and launch templates, select a 1–120 minute idle timeout, and export password-encrypted `.json.age` backups in Settings. Use a separate password of at least 12 characters; it is required again on restore and is never stored by the app. Legacy plaintext JSON/YAML can still be imported, but plaintext export has been removed. Restore validates and previews the complete replacement before one atomic save.
- `⌘K` / `Ctrl+K` searches all environments and components. `⇧⌘L` / `Ctrl+Shift+L` locks immediately. List view provides keyboard-accessible alternatives to canvas interactions.

### Launch templates

Browser: `{url}`, `https://{hostname}`, or a complete URL containing property placeholders. Embedded URL credentials and non-HTTP(S) schemes are rejected.

SSH: `ssh {hostname}` is the default. `ssh_user`, `ssh_port`, and `ssh_identity_file` apply automatically when set. Templates may explicitly use `-l`, `-p`, or `-i`, for example `ssh {ssh_user}@{hostname} -p {ssh_port}`. Tokens are split **before** substitution. Host/user/port values are validated; there must be one destination and no remote command. Other SSH options belong in the user's existing SSH config.

macOS safely quotes each argument, passes the finished command as an AppleScript argument, and asks Terminal.app or iTerm2 to execute it. The first launch may require the OS Automation permission. Linux spawns a terminal with an argument vector and no shell. A recognized `$TERMINAL` name is preferred, then `gnome-terminal`, `konsole`, `alacritty`, `kitty`, and `xterm`. Arbitrary `$TERMINAL` command strings are not evaluated.

SSH suggestions retain the literal alias as `hostname`, so OpenSSH remains authoritative for Include, Match, ProxyJump, identity selection, and first-value-wins semantics. Parsed metadata is prefixed with `source_` and is informational. The reader follows `Include` (including nested includes, lexical globs, and conditional Host blocks), applies Host patterns/negations and first-value-wins defaults, and reads system SSH defaults after the user file. Relative include paths are rooted in `~/.ssh` or `/etc/ssh`, not the containing file's directory. Canonical-path cycle protection and file/depth/size/rule limits bound scanning. Only regular files are read, and no private-key contents are read. Dynamic include tokens, other-user tilde paths, conditional Match rules, canonicalization, proxy resolution, and unsupported connection options are not evaluated; those connections require review rather than a confident endpoint match. `Match exec`, `ssh -G`, shells, DNS resolution and config commands are never executed. Different known SSH users are separate connections; endpoint/port, alias, identity paths, route metadata and manual launch overrides determine whether a match is confident or needs review. Legacy imports without complete resolution metadata require review before refresh. Kubernetes imports whitelist context name, cluster name, namespace, and API endpoint; users, tokens, certificate data, and exec plugins are discarded.

## Storage and security boundaries

- Database: `~/Library/Application Support/dev.opsportal.desktop/inventory.db` on macOS; `$XDG_DATA_HOME/dev.opsportal.desktop/inventory.db` or `~/.local/share/dev.opsportal.desktop/inventory.db` on Linux.
- Key: a random 256-bit key, stored as `database-key-v1` under service `dev.opsportal.desktop` in the OS key store. It is retrieved only after successful system authentication. Missing keys never trigger regeneration over an existing database.
- SQLCipher and OpenSSL are bundled. The backend checks `cipher_version`, uses memory-only temporary storage, and enables SQLCipher memory security. No unencrypted SQLite fallback exists. Directory/file modes are 0700/0600. A process-lifetime file lock prevents simultaneous first-run key generation.
- Backup encryption uses the standard age v1 passphrase format: scrypt (export work factor 17, approximately 128 MiB) and authenticated encryption. Restore caps work factor at 18 and ciphertext at 17 MB, authenticates the final chunk before exposing data, and rejects wrong passwords, tampering, truncation, unsupported inventory versions and invalid references. The encrypted payload carries the inventory version. Rust password/plaintext buffers are zeroized; JavaScript password strings are cleared from UI state but cannot be physically zeroized. No backup password or plaintext backup is written to disk by the app.
- Inventory version 1 migrates to version 2 in memory, adding optional per-environment diagram views, node positions/locks and visual groups. IDs and revision are preserved; the next successful whole-document save persists the migration. Older version-2 documents missing groups receive an empty list. Unsupported future versions are rejected.
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

Rust tests cover SQLCipher reopen, wrong-key rejection, migrations, stale revisions/failed-save rollback, encrypted-backup authentication and corruption, authentication/expiry guards, unsafe launch inputs, diagram validation, and static config parsing. Frontend tests cover saved diagram positions/locks/groups, compact layout, bulk patch semantics and previews, deterministic relationships, SSH matching, and backup references. Browser tests exercise CRUD, shared selection, bulk previews, compound groups/resizing, config import previews, legacy restore, locking, and absence of remote requests during those flows. Native encrypted-file dialogs, hardware authentication, and Linux behavior still require platform acceptance checks.

The automated browser suite uses the explicitly separate demo; it does not simulate successful native authentication. Complete the [platform acceptance checks](docs/ACCEPTANCE.md) on macOS and Linux before treating this as a security-validated release.

API references: [Apple device-owner authentication](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication), [polkit authorization policies](https://polkit.pages.freedesktop.org/polkit/polkit.8.html), [rusqlite SQLCipher features](https://github.com/rusqlite/rusqlite), [Tauri CSP](https://v2.tauri.app/security/csp/).

# jaam
