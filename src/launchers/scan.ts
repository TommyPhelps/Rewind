// Installed games from Epic Games, Ubisoft Connect and Rockstar Games Launcher, read from
// the files and registry entries those launchers keep on this PC. The desktop app only
// READS them (src-tauri/src/launchers.rs), and only after you allow it; nothing is changed.
//
// What each launcher exposes locally (and what it doesn't):
//   Epic       installed games: manifests in ProgramData\Epic\EpicGamesLauncher\Data\Manifests.
//              Not exposed: games you own but haven't installed, playtime.
//   Ubisoft    installed games: registry Ubisoft\Launcher\Installs (+ uninstall entries for names).
//              Not exposed: owned-but-not-installed games, playtime.
//   Rockstar   installed games: registry "Rockstar Games" keys and uninstall entries.
//              Not exposed: owned games, playtime, a documented way to start a title.
// None of them offers an official, documented API for your whole owned library, so REWIND
// doesn't sign in to them and never asks for your passwords.

import type { LauncherId } from "../lib/types.ts";
import { epicLaunch, ubisoftLaunch } from "./launch.ts";

export interface ScannedGame {
  source: LauncherId;
  externalId: string;
  title: string;
  installPath: string | null;
  launch: string | null;
  /** False for things that look like tools or launchers themselves (skipped by default). */
  isGame: boolean;
  /** Where the title came from ("manifest", "registry", "folder name"). */
  titleFrom: string;
}

export interface LauncherScan {
  source: LauncherId;
  /** The launcher appears to be installed on this PC. */
  detected: boolean;
  location: string | null;
  games: ScannedGame[];
  error: string | null;
}

/** Raw data from the desktop app (see launchers.rs). */
export interface RawLauncherScan {
  epic: { detected: boolean; manifestsDir: string | null; manifests: string[]; error: string | null };
  ubisoft: { detected: boolean; launcherDir: string | null; installs: { id: string; installDir: string }[]; uninstall: RegEntry[]; error: string | null };
  rockstar: { detected: boolean; launcherDir: string | null; games: { key: string; installFolder: string }[]; uninstall: RegEntry[]; error: string | null };
}
export interface RegEntry {
  key: string;
  displayName: string;
  installLocation: string;
  publisher: string;
}

const clean = (s: string) => s.replace(/[\u0000-\u001f]/g, "").trim();
const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

const NOT_GAMES = /^(unreal engine|epic online services|epic games launcher|ubisoft connect|uplay|rockstar games launcher|rockstar games social club|social club|launcher|directx|microsoft visual c\+\+|easyanticheat|battleye)\b/i;

export function parseEpic(raw: RawLauncherScan["epic"]): LauncherScan {
  const games: ScannedGame[] = [];
  let bad = 0;
  for (const text of raw.manifests) {
    let m: Record<string, any>;
    try {
      m = JSON.parse(text);
    } catch {
      bad++;
      continue;
    }
    const appName = String(m.AppName ?? "");
    const title = clean(String(m.DisplayName ?? appName));
    if (!appName || !title) continue;
    if (m.bIsIncompleteInstall === true) continue;
    // DLC and add-ons point at their main game.
    if (m.MainGameAppName && m.MainGameAppName !== appName) continue;
    const cats: string[] = Array.isArray(m.AppCategories) ? m.AppCategories.map(String) : [];
    const isApp = cats.includes("applications") && !cats.includes("games");
    games.push({
      source: "epic",
      externalId: appName,
      title,
      installPath: typeof m.InstallLocation === "string" ? m.InstallLocation : null,
      launch: epicLaunch(String(m.CatalogNamespace ?? m.MainGameCatalogNamespace ?? ""), String(m.CatalogItemId ?? m.MainGameCatalogItemId ?? ""), appName),
      isGame: !isApp && !NOT_GAMES.test(title),
      titleFrom: "Epic manifest",
    });
  }
  return {
    source: "epic",
    detected: raw.detected,
    location: raw.manifestsDir,
    games: dedupe(games),
    error: raw.error ?? (bad ? `${bad} Epic manifest file(s) couldn't be read and were skipped.` : null),
  };
}

export function parseUbisoft(raw: RawLauncherScan["ubisoft"]): LauncherScan {
  const names = new Map<string, RegEntry>();
  for (const u of raw.uninstall) {
    const id = /^Uplay Install (\d+)$/i.exec(u.key)?.[1];
    if (id) names.set(id, u);
  }
  const games: ScannedGame[] = [];
  const seen = new Set<string>();
  for (const i of raw.installs) {
    if (!/^\d+$/.test(i.id) || !i.installDir) continue;
    seen.add(i.id);
    const u = names.get(i.id);
    const title = clean(u?.displayName || baseName(i.installDir));
    games.push({ source: "ubisoft", externalId: i.id, title, installPath: i.installDir, launch: ubisoftLaunch(i.id), isGame: !NOT_GAMES.test(title), titleFrom: u?.displayName ? "Windows uninstall entry" : "folder name" });
  }
  // Installed games the launcher's own list missed but Windows knows about.
  for (const [id, u] of names) {
    if (seen.has(id) || !u.displayName) continue;
    games.push({ source: "ubisoft", externalId: id, title: clean(u.displayName), installPath: u.installLocation || null, launch: ubisoftLaunch(id), isGame: !NOT_GAMES.test(u.displayName), titleFrom: "Windows uninstall entry" });
  }
  return { source: "ubisoft", detected: raw.detected, location: raw.launcherDir, games: dedupe(games), error: raw.error };
}

export function parseRockstar(raw: RawLauncherScan["rockstar"]): LauncherScan {
  const games: ScannedGame[] = [];
  for (const g of raw.games) {
    const title = clean(g.key);
    if (!title || !g.installFolder) continue;
    games.push({ source: "rockstar", externalId: title, title, installPath: g.installFolder, launch: null, isGame: !NOT_GAMES.test(title), titleFrom: "registry" });
  }
  for (const u of raw.uninstall) {
    if (!/rockstar/i.test(u.publisher) || !u.displayName) continue;
    const title = clean(u.displayName);
    games.push({ source: "rockstar", externalId: title, title, installPath: u.installLocation || null, launch: null, isGame: !NOT_GAMES.test(title), titleFrom: "Windows uninstall entry" });
  }
  return { source: "rockstar", detected: raw.detected, location: raw.launcherDir, games: dedupe(games), error: raw.error };
}

/** One row per title per launcher (the registry and uninstall list often both name a game). */
function dedupe(xs: ScannedGame[]): ScannedGame[] {
  const out = new Map<string, ScannedGame>();
  for (const g of xs) {
    const k = g.title.toLowerCase().replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
    const cur = out.get(k);
    out.set(k, cur ? { ...cur, installPath: cur.installPath ?? g.installPath, launch: cur.launch ?? g.launch, isGame: cur.isGame && g.isGame } : g);
  }
  return [...out.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function parseAll(raw: RawLauncherScan): LauncherScan[] {
  return [parseEpic(raw.epic), parseUbisoft(raw.ubisoft), parseRockstar(raw.rockstar)];
}

/** What each launcher can and can't do in REWIND, in plain words (shown on the Connections page). */
export const LAUNCHER_FACTS: Record<"steam" | "epic" | "ubisoft" | "rockstar", { can: string[]; cannot: string[] }> = {
  steam: {
    can: ["Import your owned games (Steam client on this PC, or the Web API with a free key)", "Import Steam's own playtime and last-played dates", "Start games through Steam"],
    cannot: ["See owned games this PC's Steam has never installed or launched (without the Web API key)"],
  },
  epic: {
    can: ["Find games installed through the Epic Games Launcher", "Start them through the Epic Games Launcher"],
    cannot: ["Import games you own but haven't installed (Epic has no public library API)", "Import playtime (Epic doesn't store it on your PC)"],
  },
  ubisoft: {
    can: ["Find games installed through Ubisoft Connect", "Start them through Ubisoft Connect"],
    cannot: ["Import games you own but haven't installed (no public library API)", "Import playtime"],
  },
  rockstar: {
    can: ["Find games installed through the Rockstar Games Launcher"],
    cannot: ["Start a specific game (Rockstar has no documented launch link: open the launcher yourself)", "Import owned-but-not-installed games or playtime"],
  },
};
