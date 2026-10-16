// "Import from Steam on this PC": reads the Steam client's own files, so no password,
// API key or public profile is needed. What it can see:
//  - installed games (app id + name from each appmanifest), and
//  - every game this Steam account has launched, with playtime and last played
//    (from localconfig.vdf; Steam keeps these figures for the account).
// What it can't see: owned games that were never installed or played on any PC
// signed in to this account. The import preview says so.

import { parseVdf, vdfGet, vdfObj, vdfStr } from "./vdf.ts";
import type { OwnedGame } from "./steam.ts";

export interface LocalAccount {
  accountId: string;
  steamId64: string;
  persona: string | null;
  modified: number;
  apps: Map<number, { playtimeMin: number; lastPlayed: string | null }>;
}

export interface LocalLibrary {
  root: string;
  installed: Map<number, string>; // appid → name
  accounts: LocalAccount[];
}

/** SteamID64 from the 32-bit account id used for userdata folder names. */
export function steamId64(accountId: string): string {
  return (76561197960265728n + BigInt(accountId)).toString();
}

const day = (sec: string | undefined): string | null => {
  const n = Number(sec);
  return Number.isFinite(n) && n > 86400 ? new Date(n * 1000).toISOString().slice(0, 10) : null;
};

export function parseManifest(text: string): { appid: number; name: string } | null {
  const v = parseVdf(text);
  const st = vdfObj(vdfGet(v, "AppState"));
  const appid = Number(vdfStr(vdfGet(st, "appid")));
  const name = vdfStr(vdfGet(st, "name"))?.trim();
  return Number.isInteger(appid) && appid > 0 && name ? { appid, name } : null;
}

export function parseLocalConfig(accountId: string, text: string, modified = 0): LocalAccount {
  const v = parseVdf(text);
  const store = vdfObj(vdfGet(v, "UserLocalConfigStore"));
  const apps = new Map<number, { playtimeMin: number; lastPlayed: string | null }>();
  const appsNode = vdfObj(vdfGet(store, "Software", "Valve", "Steam", "apps"));
  for (const [k, raw] of Object.entries(appsNode ?? {})) {
    const id = Number(k);
    const a = vdfObj(raw);
    if (!Number.isInteger(id) || id <= 0 || !a) continue;
    const pt = Number(vdfStr(vdfGet(a, "Playtime")) ?? 0);
    const lp = day(vdfStr(vdfGet(a, "LastPlayed")));
    if (!(pt > 0) && !lp) continue; // never launched on this account: nothing to import
    apps.set(id, { playtimeMin: pt > 0 ? Math.round(pt) : 0, lastPlayed: lp });
  }
  const persona = vdfStr(vdfGet(store, "friends", "PersonaName")) ?? null;
  return { accountId, steamId64: steamId64(accountId), persona, modified, apps };
}

export function parseLocalScan(scan: { root: string; manifests: string[]; accounts: { id: string; localConfig: string; modified: number }[] }): LocalLibrary {
  const installed = new Map<number, string>();
  for (const m of scan.manifests) {
    const p = parseManifest(m);
    if (p) installed.set(p.appid, p.name);
  }
  const accounts = scan.accounts.map((a) => parseLocalConfig(a.id, a.localConfig, a.modified)).sort((a, b) => b.modified - a.modified);
  return { root: scan.root, installed, accounts };
}

/** Steam's own runtime / redistributable / tool apps that are never games. */
const NOT_GAMES = new Set([228980, 1070560, 1391110, 1628350, 1493710, 250820, 1826330, 2180100, 1161040, 1580130, 1887720, 2348590, 2805730, 3658110]);
const TOOL_NAME = /redistributable|dedicated server|\bsdk\b|proton|steam linux runtime|steamvr|steamworks|soundtrack|\bost\b|benchmark|test server|public test|playtest/i;

/** Runtimes, servers, soundtracks and test clients: offered, but not ticked for import. */
export function isProbablyNotAGame(appid: number, name: string): boolean {
  return NOT_GAMES.has(appid) || TOOL_NAME.test(name);
}

/**
 * The apps to offer for import from one account: launched games (with playtime) plus
 * installed ones. Names come from manifests or `names` (looked up from the Steam store).
 * Apps with no known name are returned separately so the preview can say so.
 */
export function localOwnedGames(lib: LocalLibrary, account: LocalAccount | null, names: Map<number, string>): { games: (OwnedGame & { installed: boolean })[]; unnamed: number[] } {
  const ids = new Set<number>([...lib.installed.keys(), ...(account?.apps.keys() ?? [])]);
  const games: (OwnedGame & { installed: boolean })[] = [];
  const unnamed: number[] = [];
  for (const id of ids) {
    const name = lib.installed.get(id) ?? names.get(id);
    if (!name) {
      unnamed.push(id);
      continue;
    }
    if (NOT_GAMES.has(id)) continue;
    const a = account?.apps.get(id);
    games.push({ appid: id, name, playtimeMin: a?.playtimeMin ?? 0, lastPlayed: a?.lastPlayed ?? null, installed: lib.installed.has(id) });
  }
  return { games: games.sort((a, b) => a.name.localeCompare(b.name)), unnamed: unnamed.sort((a, b) => a - b) };
}
