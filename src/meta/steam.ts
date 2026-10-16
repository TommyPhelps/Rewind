// Steam: your owned games (official Steam Web API, needs your own free key) and store
// metadata + artwork (Steam's public store endpoints, no key). Every parser below is
// defensive: a missing field stays missing, it is never filled with a guess.

import { NetError, qs, type Net } from "./http.ts";
import type { MetaData } from "./types.ts";

const API = "https://api.steampowered.com";
const STORE = "https://store.steampowered.com";
const ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/";

// ---------- who you are ----------

export type SteamIdInput = { kind: "steamid"; id: string } | { kind: "vanity"; name: string } | { kind: "invalid"; reason: string };

/** Accepts a 17-digit SteamID64, a profile link (/profiles/… or /id/…), or a custom URL name. */
export function parseSteamIdInput(raw: string): SteamIdInput {
  const s = raw.trim();
  if (!s) return { kind: "invalid", reason: "Enter your SteamID or profile link." };
  const prof = /steamcommunity\.com\/profiles\/(\d{17})/i.exec(s);
  if (prof) return { kind: "steamid", id: prof[1] };
  const vanity = /steamcommunity\.com\/id\/([^/?#\s]+)/i.exec(s);
  if (vanity) return { kind: "vanity", name: decodeURIComponent(vanity[1]) };
  if (/^7656119\d{10}$/.test(s)) return { kind: "steamid", id: s };
  if (/^\d+$/.test(s)) return { kind: "invalid", reason: "A SteamID64 has 17 digits and starts with 7656119." };
  if (/^[A-Za-z0-9_-]{2,32}$/.test(s)) return { kind: "vanity", name: s };
  return { kind: "invalid", reason: "That doesn't look like a SteamID, profile link or custom URL name." };
}

export function isValidApiKey(k: string): boolean {
  return /^[A-F0-9]{32}$/i.test(k.trim());
}

export async function resolveVanity(net: Net, key: string, name: string, signal?: AbortSignal): Promise<string> {
  const j = await net.json<{ response?: { success?: number; steamid?: string; message?: string } }>(
    { method: "GET", url: `${API}/ISteamUser/ResolveVanityURL/v1/?${qs({ key, vanityurl: name })}` },
    { signal },
  );
  if (j.response?.success === 1 && j.response.steamid) return j.response.steamid;
  throw new NetError("not_found", `Steam has no profile with the custom URL "${name}".`);
}

// ---------- owned games ----------

export interface OwnedGame {
  appid: number;
  name: string;
  playtimeMin: number;
  lastPlayed: string | null; // YYYY-MM-DD
}

export function parseOwnedGames(j: unknown): { games: OwnedGame[]; privateOrEmpty: boolean } {
  const resp = (j as { response?: { game_count?: number; games?: unknown[] } })?.response;
  if (!resp || !Array.isArray(resp.games)) return { games: [], privateOrEmpty: true };
  const games: OwnedGame[] = [];
  for (const raw of resp.games) {
    const g = raw as Record<string, unknown>;
    const appid = Number(g.appid);
    if (!Number.isInteger(appid) || appid <= 0) continue;
    const name = typeof g.name === "string" && g.name.trim() ? g.name.trim() : "";
    if (!name) continue; // include_appinfo=1 gives names; an app without one can't be matched honestly
    const pt = Number(g.playtime_forever);
    const lp = Number(g.rtime_last_played);
    games.push({
      appid,
      name,
      playtimeMin: Number.isFinite(pt) && pt > 0 ? Math.round(pt) : 0,
      lastPlayed: Number.isFinite(lp) && lp > 0 ? new Date(lp * 1000).toISOString().slice(0, 10) : null,
    });
  }
  return { games, privateOrEmpty: games.length === 0 };
}

export async function getOwnedGames(net: Net, key: string, steamid: string, signal?: AbortSignal) {
  const j = await net.json<unknown>(
    {
      method: "GET",
      url: `${API}/IPlayerService/GetOwnedGames/v1/?${qs({ key, steamid, include_appinfo: 1, include_played_free_games: 1, format: "json" })}`,
      timeoutMs: 60_000,
    },
    { signal },
  );
  return parseOwnedGames(j);
}

// ---------- store search (no key) ----------

export interface SearchHit {
  appid: number;
  name: string;
  thumb: string | null;
}

export function parseStoreSearch(j: unknown): SearchHit[] {
  const items = (j as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((x) => x as Record<string, unknown>)
    .filter((x) => (x.type === "app" || x.type === undefined) && Number.isInteger(Number(x.id)) && typeof x.name === "string")
    .map((x) => ({ appid: Number(x.id), name: String(x.name), thumb: typeof x.tiny_image === "string" ? x.tiny_image : null }));
}

export async function storeSearch(net: Net, term: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const j = await net.json<unknown>({ method: "GET", url: `${STORE}/api/storesearch/?${qs({ term, l: "english", cc: "US" })}` }, { signal });
  return parseStoreSearch(j);
}

// ---------- store items: metadata + artwork in batches (no key) ----------

/** Steam's own player-mode category ids (stable, used across the store). */
const PLAYER_CATEGORIES: Record<number, string> = {
  2: "Single-player",
  1: "Multi-player",
  9: "Co-op",
  38: "Online co-op",
  48: "LAN co-op",
  39: "Shared/split-screen co-op",
  49: "PvP",
  36: "Online PvP",
  47: "LAN PvP",
  37: "Shared/split-screen PvP",
  24: "Shared/split-screen",
  20: "MMO",
  27: "Cross-platform multiplayer",
};

export type TagNames = Map<number, string>;

export function parseTagList(j: unknown): TagNames {
  const tags = (j as { response?: { tags?: { tagid: number; name: string }[] } })?.response?.tags;
  const m: TagNames = new Map();
  for (const t of tags ?? []) if (Number.isInteger(t.tagid) && typeof t.name === "string") m.set(t.tagid, t.name);
  return m;
}

export async function getTagList(net: Net, signal?: AbortSignal): Promise<TagNames> {
  return parseTagList(await net.json<unknown>({ method: "GET", url: `${API}/IStoreService/GetTagList/v1/?language=english` }, { signal }));
}

const isoDay = (sec: unknown): string | undefined => {
  const n = Number(sec);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : undefined;
};

/** Returns one MetaData per appid that Steam knows; unknown or hidden apps are simply absent. */
export function parseStoreItems(j: unknown, tagNames: TagNames): Map<number, MetaData> {
  const out = new Map<number, MetaData>();
  const items = (j as { response?: { store_items?: unknown[] } })?.response?.store_items;
  for (const raw of items ?? []) {
    const it = raw as Record<string, any>;
    const appid = Number(it.appid ?? it.id);
    if (!Number.isInteger(appid) || it.success !== 1 || typeof it.name !== "string") continue;
    const basic = (it.basic_info ?? {}) as Record<string, any>;
    const names = (xs: unknown): string[] =>
      Array.isArray(xs) ? [...new Set(xs.map((x: any) => (typeof x?.name === "string" ? x.name.trim() : "")).filter(Boolean))] : [];
    const tags = (Array.isArray(it.tags) ? it.tags : [])
      .map((t: any) => ({ name: tagNames.get(Number(t.tagid)) ?? "", weight: Number(t.weight) || 0 }))
      .filter((t: { name: string }) => t.name);
    const playerIds: number[] = Array.isArray(it.categories?.supported_player_categoryids) ? it.categories.supported_player_categoryids.map(Number) : [];
    const features = playerIds.map((id) => PLAYER_CATEGORIES[id]).filter(Boolean);
    const plat = (it.platforms ?? {}) as Record<string, unknown>;
    const platforms = [plat.windows ? "Windows" : "", plat.mac ? "macOS" : "", plat.steamos_linux || plat.linux ? "Linux" : ""].filter(Boolean);
    const rel = (it.release ?? {}) as Record<string, unknown>;
    const releaseDate = isoDay(rel.original_release_date) ?? isoDay(rel.steam_release_date);
    const a = (it.assets ?? {}) as Record<string, string>;
    const fmt = typeof a.asset_url_format === "string" ? a.asset_url_format : `steam/apps/${appid}/\${FILENAME}`;
    const asset = (f?: string) => (f ? ASSETS + fmt.replace("${FILENAME}", f) : undefined);
    const art: MetaData["art"] = {};
    // 600×900 is sharp enough for any tile; the 2x file is four times the size.
    const cover = asset(a.library_capsule) ?? asset(a.library_capsule_2x);
    if (cover) art.cover = { url: cover, kind: "portrait" };
    const header = asset(a.header);
    if (header) art.header = { url: header, kind: "landscape" };
    const hero = asset(a.library_hero) ?? asset(a.library_hero_2x);
    if (hero) art.hero = { url: hero, kind: "landscape" };
    out.set(appid, {
      name: it.name.trim(),
      releaseDate,
      releaseYear: releaseDate ? Number(releaseDate.slice(0, 4)) : undefined,
      description: typeof basic.short_description === "string" ? cleanText(basic.short_description) : undefined,
      developers: names(basic.developers),
      publishers: names(basic.publishers),
      franchises: names(basic.franchises),
      genres: [],
      tags,
      features,
      playerCategoryIds: playerIds,
      platforms,
      storeUrl: `https://store.steampowered.com/app/${appid}/`,
      comingSoon: Boolean(rel.is_coming_soon),
      art,
      attribution: "Steam store",
    });
  }
  return out;
}

export async function getStoreItems(net: Net, appids: number[], tagNames: TagNames, signal?: AbortSignal): Promise<Map<number, MetaData>> {
  const input = {
    ids: appids.map((appid) => ({ appid })),
    context: { language: "english", country_code: "US" },
    data_request: { include_assets: true, include_basic_info: true, include_tag_count: 20, include_release: true, include_platforms: true },
  };
  const j = await net.json<unknown>(
    { method: "GET", url: `${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, timeoutMs: 40_000 },
    { signal },
  );
  return parseStoreItems(j, tagNames);
}

/** Older games sometimes have no library cover listed; Steam still serves the classic paths. */
export function fallbackArt(appid: number): { cover: string; header: string } {
  return {
    cover: `${ASSETS}steam/apps/${appid}/library_600x900.jpg`,
    header: `${ASSETS}steam/apps/${appid}/header.jpg`,
  };
}

/** Plain text from Steam's short descriptions (they occasionally contain HTML entities). */
export function cleanText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
