// Everything that touches Windows goes through this file: the SQLite bridge,
// native Open/Save dialogs, opening links in the browser, and window placement.
//
// Outside the desktop app (only during development, in a plain browser) the
// database falls back to a local dev bridge; the shipped app never uses it.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import type { SqlDriver, SqlValue, Statement } from "../db/driver.ts";
import type { ArtFile, HttpRequest, HttpResponse, Transport } from "../meta/http.ts";
import type { RawLauncherScan } from "../launchers/scan.ts";
import type { LauncherId } from "../lib/types.ts";

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

/** Save dialog for a text export (e.g. the old modding records as Markdown). */
export async function saveTextFile(title: string, defaultName: string, text: string, filterName: string, ext: string): Promise<string | null> {
  if (!inDesktopApp()) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = defaultName;
    a.click();
    return defaultName;
  }
  const path = await saveDialog({ title, defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
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

// ---------- network (Steam / IGDB) and the artwork cache ----------

/** In the app: Rust makes the request (HTTPS to Steam and IGDB hosts only). In a dev preview: the dev bridge. */
export function createTransport(): Transport {
  if (inDesktopApp()) {
    return {
      request: (req: HttpRequest) => invoke<HttpResponse>("http_request", { req }),
      download: (url: string, name: string) => invoke<ArtFile>("download_art", { url, name }),
    };
  }
  const call = async <T>(op: string, body: unknown): Promise<T> => {
    let r: Response;
    try {
      r = await fetch(`/__rewind_dev/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new Error("offline: dev bridge unreachable");
    }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "network: dev bridge error");
    return j.result as T;
  };
  return {
    request: (req) => call<HttpResponse>("http", { req }),
    download: (url, name) => call<ArtFile>("art", { url, name }),
  };
}

let artBase: string | null = null;
let artSep = "/";

/** Called once the app's data folder is known. */
export function setArtBase(dataDir: string): void {
  artBase = dataDir;
  artSep = dataDir.includes("\\") ? "\\" : "/";
}

/** A displayable URL for a cached image ("artwork/…", relative to the app data folder). */
export function artSrc(file: string | null | undefined): string | null {
  if (!file || !/^artwork\/[A-Za-z0-9._-]+$/.test(file)) return null;
  if (!inDesktopApp()) return `/${file}`;
  if (!artBase) return null;
  return convertFileSrc(artBase + artSep + file.replace("/", artSep));
}

export async function artMissing(files: string[]): Promise<string[]> {
  if (!files.length) return [];
  if (!inDesktopApp()) {
    const r = await fetch("/__rewind_dev/art_missing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files }) });
    return (await r.json()).result as string[];
  }
  return invoke<string[]>("art_missing", { files });
}

export async function artStats(): Promise<{ files: number; bytes: number; dir: string }> {
  if (!inDesktopApp()) return { files: 0, bytes: 0, dir: "(browser preview)" };
  return invoke("art_stats");
}

export async function deleteArt(files: string[]): Promise<number> {
  if (!inDesktopApp() || !files.length) return 0;
  return invoke<number>("delete_art", { files });
}

const IMAGE_FILTER = [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }];

/** Lets you pick your own cover picture; it is copied into REWIND's artwork folder. */
export async function pickCoverImage(name: string): Promise<ArtFile | null> {
  if (!inDesktopApp()) return null;
  const path = await openDialog({ title: "Choose a cover image", multiple: false, directory: false, filters: IMAGE_FILTER });
  if (!path || Array.isArray(path)) return null;
  return invoke<ArtFile>("import_art", { path, name });
}

export async function pickFolder(title: string): Promise<string | null> {
  if (!inDesktopApp()) return null;
  const path = await openDialog({ title, multiple: false, directory: true });
  return !path || Array.isArray(path) ? null : path;
}

export interface SteamLocalScan {
  root: string;
  libraries: string[];
  manifests: string[];
  accounts: { id: string; localConfig: string; modified: number }[];
}

/** Reads the Steam client's files on this PC (no password, no key, no network). */
export async function steamLocalScan(dir?: string): Promise<SteamLocalScan> {
  if (!inDesktopApp()) {
    const r = await fetch("/__rewind_dev/steam_local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j.result as SteamLocalScan;
  }
  return invoke<SteamLocalScan>("steam_local_scan", { dir: dir ?? null });
}

async function devCall<T>(op: string, body: unknown): Promise<T> {
  const r = await fetch(`/__rewind_dev/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "dev bridge error");
  return j.result as T;
}

// ---------- other launchers (only after you allowed it in Settings → Connections) ----------

/** Reads what Epic / Ubisoft Connect / Rockstar keep on this PC about installed games. Read-only. */
export async function launcherScan(which: Exclude<LauncherId, "steam">[]): Promise<RawLauncherScan> {
  if (!which.length) throw new Error("No launchers chosen.");
  if (!inDesktopApp()) return devCall<RawLauncherScan>("launchers", { which });
  return invoke<RawLauncherScan>("launcher_scan", { which });
}

/** Asks Windows to open a launcher link; the launcher starts the game. */
export async function launchGame(uri: string): Promise<void> {
  if (!inDesktopApp()) return void (await devCall("launch", { uri }));
  await invoke("launch_game", { uri });
}

/** A full copy of the database file in the backups folder (used before upgrades). */
export async function snapshotDatabase(label: string): Promise<string> {
  if (!inDesktopApp()) return devCall<string>("snapshot", { label });
  return invoke<string>("db_snapshot", { label });
}

/** Windows DPAPI: encrypts a stored key so only your Windows account can read it. */
export async function protectSecret(value: string): Promise<string> {
  if (!inDesktopApp()) return value;
  return invoke<string>("secret_protect", { plain: value });
}

export async function unprotectSecret(value: string): Promise<string> {
  if (!inDesktopApp()) return value;
  return invoke<string>("secret_unprotect", { stored: value });
}

/** CI start-up check; does nothing unless the app was started for one. */
export async function smokeReport(report: Record<string, unknown>): Promise<void> {
  if (!inDesktopApp()) return;
  try {
    await invoke("smoke_report", { report });
  } catch {
    // never matters outside CI
  }
}
