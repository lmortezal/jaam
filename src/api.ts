import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Inventory, Scan } from "./model";
export const native = isTauri();
export async function exportBackup(password: string): Promise<number[]> {
  if (!native)
    throw new Error("Encrypted backups require the authenticated desktop app.");
  return invoke("export_backup", { password });
}
export async function decryptBackup(
  bytes: number[],
  password: string,
): Promise<Inventory> {
  if (!native)
    throw new Error("Encrypted backups require the authenticated desktop app.");
  return invoke("decrypt_backup", { bytes, password });
}
export const demo =
  import.meta.env.DEV && import.meta.env.MODE === "demo" && !native;
let demoData: Inventory | undefined;
let demoUnlocked = false;
export async function unlock(): Promise<Inventory> {
  if (native) return invoke("unlock");
  if (!demo)
    throw new Error(
      "Open the native OpsPortal app to authenticate. The web preview cannot access your vault.",
    );
  demoData ??= (await import("./demo")).demoInventory();
  demoUnlocked = true;
  return structuredClone(demoData);
}
export async function lock() {
  if (native) await invoke("lock");
  demoUnlocked = false;
}
export async function save(document: Inventory): Promise<Inventory> {
  if (native) return invoke("save_inventory", { document });
  if (!demo || !demoUnlocked) throw new Error("LOCKED");
  demoData = structuredClone({ ...document, revision: document.revision + 1 });
  return structuredClone(demoData);
}
export async function launch(id: string) {
  if (!native)
    throw new Error(
      "Launch actions are available only in the authenticated desktop app.",
    );
  await invoke("launch_component", { id });
}
export async function preview(id: string): Promise<string> {
  return native
    ? invoke("preview_launch", { id })
    : "Demo only · no commands will be executed";
}
export async function scan(): Promise<Scan> {
  if (native) return invoke("scan_configs");
  if (!demo || !demoUnlocked) throw new Error("LOCKED");
  return {
    suggestions: [
      {
        id: "ssh:demo-host",
        source: "~/.ssh/config (example)",
        name: "demo-host",
        component_type_id: "server",
        properties: {
          hostname: "demo-host",
          source_ssh_alias: "demo-host",
          source_resolved_hostname: "demo.example",
          source_ssh_user: "ops",
          source_ssh_port: 22,
          source_ssh_identity_files: "[]",
          source_ssh_proxy_jump: "none",
          source_ssh_resolution: "static-v1",
        },
      },
      {
        id: "kube:demo-cluster",
        source: "~/.kube/config (example)",
        name: "demo-cluster",
        component_type_id: "kubernetes",
        properties: {
          kube_context: "demo-cluster",
          hostname: "https://127.0.0.1:6443",
        },
      },
    ],
    warnings: [
      "These are example suggestions. Browser preview never reads local configuration files.",
    ],
  };
}
export async function activity() {
  if (native) await invoke("activity");
}
export async function status(): Promise<boolean> {
  return native ? invoke("session_status") : demoUnlocked;
}
export async function onLock(handler: () => void) {
  return native ? listen("vault-locked", handler) : () => {};
}
