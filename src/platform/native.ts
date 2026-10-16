// Everything that touches Windows goes through this file: the SQLite bridge,
// native Open/Save dialogs, opening links in the browser, and window placement.
//
// Outside the desktop app (only during development, in a plain browser) the
// database falls back to a local dev bridge; the shipped app never uses it.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import type { SqlDriver, SqlValue, Statement } from "../db/driver.ts";

export const inDesktopApp = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

function tauriDriver(): SqlDriver {
  return {
    select: (sql, params) => invoke("db_select", { sql, params: params ?? [] }),
    execute: (sql, params) => invoke("db_execute", { sql, params: params ?? [] }),
    batch: (statements) => invoke("db_batch", { statements }),
  };
}

/** Development only: talks to tools/dev-server.mjs, which runs the same SQL on node:sqlite. */
function devBridgeDriver(): SqlDriver {
  const call = async (op: string, body: unknown) => {
    const r = await fetch(`/__rewind_dev/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "dev bridge error");
    return j.result;
  };
  return {
    select: (sql: string, params?: SqlValue[]) => call("select", { sql, params }),
    execute: (sql: string, params?: SqlValue[]) => call("execute", { sql, params }),
    batch: (statements: Statement[]) => call("batch", { statements }),
  };
}

export function createDriver(): SqlDriver {
  return inDesktopApp() ? tauriDriver() : devBridgeDriver();
}

const JSON_FILTER = [{ name: "REWIND backup (JSON)", extensions: ["json"] }];

/** Native Open dialog for a JSON file. Returns null if the user cancels. */
export async function pickJsonFile(title: string): Promise<{ path: string; text: string } | null> {
  if (!inDesktopApp()) return browserPick();
  const path = await openDialog({ title, multiple: false, directory: false, filters: JSON_FILTER });
  if (!path || Array.isArray(path)) return null;
  const text = await invoke<string>("read_text_file", { path });
  return { path, text };
}

/** Native Save dialog. Returns the saved path, or null if the user cancels. */
export async function saveJsonFile(title: string, defaultName: string, text: string): Promise<string | null> {
  if (!inDesktopApp()) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = defaultName;
    a.click();
    return defaultName;
  }
  const path = await saveDialog({ title, defaultPath: defaultName, filters: JSON_FILTER });
  if (!path) return null;
  await invoke("write_text_file", { path, contents: text });
  return path;
}

/** Writes an automatic safety snapshot to the app's backups folder. */
export async function writeSafetySnapshot(name: string, text: string): Promise<string> {
  if (!inDesktopApp()) return `(dev) ${name}`;
  return invoke<string>("write_safety_backup", { name, contents: text });
}

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
  backupsDir: string;
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!inDesktopApp()) return { version: "dev", dataDir: "(browser preview)", dbPath: "(dev bridge)", backupsDir: "(none)" };
  return invoke<AppInfo>("app_info");
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Only web links can be opened.");
  if (!inDesktopApp()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await openUrl(url);
}

/**
 * If the saved window position no longer overlaps any monitor (a screen was
 * unplugged or rearranged), move the window back to the centre of a screen.
 */
export async function ensureWindowOnScreen(): Promise<void> {
  if (!inDesktopApp()) return;
  try {
    const win = getCurrentWindow();
    const [pos, size, monitors] = await Promise.all([win.outerPosition(), win.outerSize(), availableMonitors()]);
    if (!monitors.length) return;
    const minVisible = 120; // physical pixels of the window that must be on some screen
    const visible = monitors.some((m) => {
      const x1 = Math.max(pos.x, m.position.x);
      const y1 = Math.max(pos.y, m.position.y);
      const x2 = Math.min(pos.x + size.width, m.position.x + m.size.width);
      const y2 = Math.min(pos.y + size.height, m.position.y + m.size.height);
      return x2 - x1 >= minVisible && y2 - y1 >= 40 && pos.y >= m.position.y - 8;
    });
    if (!visible) await win.center();
  } catch {
    // Window APIs are best-effort; never block startup on them.
  }
}

function browserPick(): Promise<{ path: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { path: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}
