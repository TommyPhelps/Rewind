// "Beyond your library": games you don't own, found through IGDB (free Twitch developer
// keys, the same ones used for metadata). Nothing here runs without your keys, and the
// results are cached so Discover keeps working offline.
//
// Where candidates come from, in plain terms:
//   - similar:  IGDB's own "similar games" list for games you rated highly / listed as enjoyed
//   - era:      games released in your nostalgia years on the platforms you picked
//   - rpg:      role-playing games
//   - short:    games whose player-submitted "normally" time to beat is short
// For the era/rpg pools IGDB is asked for games with a reasonable number of player ratings,
// only so there's enough information to judge them. Ratings themselves are never fetched,
// shown or used for ranking: candidates are ranked by your taste, like everything else.

import { canon } from "../lib/canon.ts";
import type { Game, Multiplayer } from "../lib/types.ts";
import { autoPick } from "../meta/match.ts";
import { NetError, type Net } from "../meta/http.ts";
import type { IgdbCreds, IgdbToken } from "../meta/igdb.ts";
import { parseTimeToBeat } from "../meta/igdb.ts";
import { igdbToRewind } from "../meta/mapping.ts";
import type { MetaData } from "../meta/types.ts";
import type { TasteModel } from "../rec/taste.ts";
import { ERA_PLATFORMS, type DiscoverPrefs } from "./prefs.ts";

export type Pool = "similar" | "era" | "rpg" | "short";

export interface ExtGame {
  igdbId: number;
  name: string;
  releaseDate?: string;
  year?: number;
  summary?: string;
  genres: string[];
  themes: string[];
  modes: string[];
  perspectives: string[];
  platforms: string[];
  developers: string[];
  publishers: string[];
  coverId?: string;
  pageUrl?: string;
  steamAppId?: number;
  ttb?: { main?: number; extras?: number; complete?: number; count?: number };
  pools: Pool[];
  /** Library game ids whose IGDB "similar games" list this came from. */
  similarTo: string[];
}

export interface BeyondCache {
  version: 1;
  fetchedAt: string;
  /** Library games used as starting points, and the IGDB entry each was matched to. */
  seeds: { gameId: string; title: string; igdbId: number | null }[];
  items: ExtGame[];
  /** Settings the pools were fetched with (a change means a refresh is due). */
  basis: { eraFrom: number; eraTo: number; eraPlatforms: string[]; shortMaxHours: number };
  notes: string[];
}

export const BEYOND_CACHE_KEY = "discover_beyond_v1";
export const BEYOND_MAX_AGE_DAYS = 14;
export const IGDB_IMG = "https://images.igdb.com/igdb/image/upload";

const API = "https://api.igdb.com/v4";
const FIELDS =
  "fields name,first_release_date,summary,url,genres.name,themes.name,game_modes.name,player_perspectives.name,platforms.name," +
  "involved_companies.company.name,involved_companies.developer,involved_companies.publisher,cover.image_id,external_games.*,parent_game,version_parent;";
/** IGDB theme 42 is "Erotic": never part of suggestions. */
const SAFE = "themes != (42) & parent_game = null & version_parent = null";
const RPG_GENRE = 12;
const MIN_RATINGS = 25;

export interface BeyondDeps {
  net: Net;
  creds: IgdbCreds;
  token: () => Promise<IgdbToken>;
  /** Small persistent cache for seed lookups (title -> IGDB id). */
  getCache<T>(key: string, maxAgeDays: number): Promise<T | null>;
  setCache(key: string, value: unknown): Promise<void>;
}

export interface BeyondProgress {
  step: string;
  done: number;
  total: number;
}

async function q<T>(d: BeyondDeps, endpoint: string, body: string, signal?: AbortSignal): Promise<T> {
  const tok = await d.token();
  return d.net.json<T>(
    {
      method: "POST",
      url: `${API}/${endpoint}`,
      headers: [
        ["Client-ID", d.creds.clientId.trim()],
        ["Authorization", `Bearer ${tok.token}`],
        ["Accept", "application/json"],
        ["Content-Type", "text/plain"],
      ],
      body,
    },
    { signal },
  );
}

const ids = (xs: number[]) => `(${xs.map((x) => Math.trunc(x)).join(",")})`;
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const unixYear = (y: number) => Math.floor(Date.UTC(y, 0, 1) / 1000);

/** Games you clearly enjoyed (ratings, favourites, your lists — never playtime alone), best first. */
export function pickSeeds(games: Game[], taste: TasteModel, max = 12): Game[] {
  return games
    .filter((g) => {
      const ev = taste.evidence.get(g.id);
      return ev && !ev.playtimeOnly && ev.value >= 0.5 && !g.tags.some((t) => t.tag === "tool");
    })
    .sort((a, b) => {
      const ea = taste.evidence.get(a.id)!;
      const eb = taste.evidence.get(b.id)!;
      return eb.value * eb.weight - ea.value * ea.weight || a.title.localeCompare(b.title);
    })
    .slice(0, max);
}

export function parseExt(g: Record<string, any>): Omit<ExtGame, "pools" | "similarTo" | "ttb"> {
  const names = (xs: unknown) => (Array.isArray(xs) ? [...new Set(xs.map((x: any) => (typeof x?.name === "string" ? x.name : "")).filter(Boolean))] : []);
  const companies: any[] = Array.isArray(g.involved_companies) ? g.involved_companies : [];
  const co = (flag: "developer" | "publisher") => [...new Set(companies.filter((c) => c?.[flag] && c.company?.name).map((c) => String(c.company.name)))];
  const date = g.first_release_date ? new Date(Number(g.first_release_date) * 1000).toISOString().slice(0, 10) : undefined;
  const ext: any[] = Array.isArray(g.external_games) ? g.external_games : [];
  const steam = ext.find((e) => e?.external_game_source === 1 || e?.category === 1 || (typeof e?.url === "string" && /store\.steampowered\.com\/app\/\d+/.test(e.url)));
  const steamId = steam ? Number(steam.uid ?? /app\/(\d+)/.exec(String(steam.url))?.[1]) : NaN;
  return {
    igdbId: Number(g.id),
    name: String(g.name ?? ""),
    releaseDate: date,
    year: date ? Number(date.slice(0, 4)) : undefined,
    summary: typeof g.summary === "string" ? g.summary.trim().slice(0, 1200) : undefined,
    genres: names(g.genres),
    themes: names(g.themes),
    modes: names(g.game_modes),
    perspectives: names(g.player_perspectives),
    platforms: names(g.platforms),
    developers: co("developer"),
    publishers: co("publisher"),
    coverId: typeof g.cover?.image_id === "string" ? g.cover.image_id : undefined,
    pageUrl: typeof g.url === "string" && /^https:\/\/www\.igdb\.com\//.test(g.url) ? g.url : undefined,
    steamAppId: Number.isInteger(steamId) && steamId > 0 ? steamId : undefined,
  };
}

/**
 * Asks IGDB for candidates. Throws NetError on auth / offline problems so the caller can
 * keep showing the previous cache.
 */
export async function fetchBeyond(
  d: BeyondDeps,
  games: Game[],
  taste: TasteModel,
  prefs: DiscoverPrefs,
  opts: { signal?: AbortSignal; onProgress?: (p: BeyondProgress) => void } = {},
): Promise<BeyondCache> {
  const { signal } = opts;
  const prog = (step: string, done: number, total: number) => opts.onProgress?.({ step, done, total });
  const notes: string[] = [];
  // Fail fast on bad keys (one cheap call) before doing anything else.
  await d.token();

  // 1. Seeds: your favourites, matched to IGDB (linked metadata first, else an exact title search).
  const seedGames = pickSeeds(games, taste);
  const seeds: BeyondCache["seeds"] = [];
  for (const [i, g] of seedGames.entries()) {
    prog("Matching your favourites on IGDB", i, seedGames.length);
    let id: number | null = null;
    const linked = g.meta.igdb?.status === "linked" ? Number(g.meta.igdb.providerId) : NaN;
    if (Number.isInteger(linked) && linked > 0) id = linked;
    else {
      const ck = `igdb_seed:${canon(g.title)}`;
      const cached = await d.getCache<{ id: number | null }>(ck, 60);
      if (cached) id = cached.id;
      else {
        const term = g.title.replace(/[™®©]/g, "").replace(/\s+[-–—:]\s+(remastered|enhanced edition|goty edition|game of the year edition|definitive edition|complete edition)$/i, "").trim();
        const found = await q<Record<string, any>[]>(d, "games", `search "${term.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"; fields name; limit 10;`, signal);
        const pick = autoPick(g.title, found.map((f) => ({ id: Number(f.id), name: String(f.name ?? "") })));
        id = pick && Number.isInteger(pick.item.id) ? pick.item.id : null;
        await d.setCache(ck, { id });
      }
    }
    seeds.push({ gameId: g.id, title: g.title, igdbId: id });
  }
  const seedIds = seeds.filter((s) => s.igdbId != null);
  if (seedGames.length === 0) notes.push("No favourites yet (rate a few games 4–5★ or add them to your profile), so there's no 'similar to' list.");
  else if (seedIds.length < seedGames.length) notes.push(`${seedGames.length - seedIds.length} of your favourites couldn't be matched on IGDB with certainty and were left out.`);

  // 2. IGDB's similar-games lists.
  const similar = new Map<number, string[]>();
  if (seedIds.length) {
    prog("Reading IGDB's similar-games lists", 0, 1);
    const rows = await q<{ id: number; similar_games?: number[] }[]>(d, "games", `fields similar_games; where id = ${ids(seedIds.map((s) => s.igdbId!))}; limit 50;`, signal);
    for (const r of rows) {
      const seed = seedIds.find((s) => s.igdbId === r.id);
      for (const sid of r.similar_games ?? []) {
        if (!similar.has(sid)) similar.set(sid, []);
        if (seed && !similar.get(sid)!.includes(seed.gameId)) similar.get(sid)!.push(seed.gameId);
      }
    }
  }

  // 3. Pools by era, genre and length.
  const byId = new Map<number, Record<string, any>>();
  const pools = new Map<number, Set<Pool>>();
  const addPool = (id: number, p: Pool) => (pools.get(id) ?? pools.set(id, new Set()).get(id)!).add(p);
  const plats = ERA_PLATFORMS.filter((p) => prefs.eraPlatforms.includes(p.id)).map((p) => p.igdb);
  prog("Looking up older games for your nostalgia years", 0, 3);
  const era = await q<Record<string, any>[]>(
    d,
    "games",
    `${FIELDS} where first_release_date >= ${unixYear(prefs.eraFrom)} & first_release_date < ${unixYear(prefs.eraTo + 1)} & platforms = ${ids(plats.length ? plats : [6])} & total_rating_count >= ${MIN_RATINGS} & ${SAFE}; sort total_rating_count desc; limit 200;`,
    signal,
  );
  for (const g of era) {
    byId.set(Number(g.id), g);
    addPool(Number(g.id), "era");
  }
  prog("Looking up role-playing games", 1, 3);
  const rpg = await q<Record<string, any>[]>(d, "games", `${FIELDS} where genres = (${RPG_GENRE}) & total_rating_count >= ${MIN_RATINGS * 2} & ${SAFE}; sort total_rating_count desc; limit 200;`, signal);
  for (const g of rpg) {
    byId.set(Number(g.id), g);
    addPool(Number(g.id), "rpg");
  }
  prog("Looking up short games", 2, 3);
  const short = await q<Record<string, any>[]>(
    d,
    "game_time_to_beats",
    `fields game_id,hastily,normally,completely,count; where normally > 0 & normally <= ${prefs.shortMaxHours * 3600} & count >= 8; sort count desc; limit 200;`,
    signal,
  );
  const ttb = new Map<number, ExtGame["ttb"]>();
  for (const t of short) {
    const id = Number(t.game_id);
    const parsed = parseTimeToBeat(t);
    if (parsed) ttb.set(id, parsed);
    addPool(id, "short");
  }
  for (const id of similar.keys()) addPool(id, "similar");

  // 4. Details for candidates not fetched yet.
  const missing = [...pools.keys()].filter((id) => !byId.has(id));
  const parts = chunk(missing, 400);
  for (const [i, part] of parts.entries()) {
    prog("Reading game details", i, parts.length);
    const rows = await q<Record<string, any>[]>(d, "games", `${FIELDS} where id = ${ids(part)} & ${SAFE}; limit 500;`, signal);
    for (const g of rows) byId.set(Number(g.id), g);
  }

  // 5. Player-submitted completion times for everything.
  const needTtb = [...byId.keys()].filter((id) => !ttb.has(id));
  const tparts = chunk(needTtb, 400);
  for (const [i, part] of tparts.entries()) {
    prog("Reading completion times", i, tparts.length);
    const rows = await q<Record<string, any>[]>(d, "game_time_to_beats", `fields game_id,hastily,normally,completely,count; where game_id = ${ids(part)}; limit 500;`, signal);
    for (const t of rows) {
      const parsed = parseTimeToBeat(t);
      if (parsed) ttb.set(Number(t.game_id), parsed);
    }
  }

  const items: ExtGame[] = [];
  for (const [id, g] of byId) {
    const base = parseExt(g);
    if (!base.name) continue;
    items.push({ ...base, ttb: ttb.get(id), pools: [...(pools.get(id) ?? [])], similarTo: similar.get(id) ?? [] });
  }
  prog("Done", 1, 1);
  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    seeds,
    items,
    basis: { eraFrom: prefs.eraFrom, eraTo: prefs.eraTo, eraPlatforms: [...prefs.eraPlatforms], shortMaxHours: prefs.shortMaxHours },
    notes,
  };
}

/** True when the cached pools were fetched with different settings than the current ones. */
export function basisChanged(c: BeyondCache, p: DiscoverPrefs): boolean {
  const b = c.basis;
  return b.eraFrom !== p.eraFrom || b.eraTo !== p.eraTo || b.shortMaxHours !== p.shortMaxHours || [...b.eraPlatforms].sort().join() !== [...p.eraPlatforms].sort().join();
}

// ---------- from IGDB data to something the recommender understands ----------

function playersFrom(modes: string[]): Multiplayer {
  const m = modes.map((x) => x.toLowerCase());
  const solo = m.includes("single player");
  const multi = m.some((x) => /multiplayer|co-operative|split screen|massively|battle royale/.test(x));
  if (solo && multi) return "solo_and_mp";
  if (solo) return "solo";
  if (multi) return m.some((x) => /co-operative/.test(x)) && !m.some((x) => /massively|battle royale/.test(x)) ? "coop_focused" : "mp_required";
  return "unknown";
}

export function extMeta(e: ExtGame): MetaData {
  return {
    name: e.name,
    releaseDate: e.releaseDate,
    releaseYear: e.year,
    description: e.summary,
    developers: e.developers,
    publishers: e.publishers,
    genres: e.genres,
    tags: [...e.themes, ...e.perspectives].map((name) => ({ name })),
    features: e.modes,
    platforms: e.platforms,
    storeUrl: e.steamAppId ? `https://store.steampowered.com/app/${e.steamAppId}/` : undefined,
    pageUrl: e.pageUrl,
    timeToBeat: e.ttb,
    art: e.coverId ? { cover: { url: `${IGDB_IMG}/t_cover_big/${e.coverId}.jpg`, kind: "portrait" } } : {},
    attribution: "IGDB.com",
  };
}

/** A stand-in Game for scoring and display. It is never saved to your library. */
export function extToGame(e: ExtGame, nowIso = new Date().toISOString()): Game {
  const meta = extMeta(e);
  const tags = igdbToRewind(meta).map((tag) => ({ tag, source: "igdb" }));
  const lengths = (
    [
      ["main", e.ttb?.main],
      ["main_extras", e.ttb?.extras],
      ["completionist", e.ttb?.complete],
    ] as const
  )
    .filter(([, h]) => h != null && h > 0)
    .map(([kind, hours]) => ({ gameId: `igdb:${e.igdbId}`, kind, hours: hours!, source: "igdb", updatedAt: nowIso }));
  const multiplayer = playersFrom(e.modes);
  return {
    id: `igdb:${e.igdbId}`,
    title: e.name,
    canon: canon(e.name),
    legacyId: null,
    platform: e.platforms.some((p) => /windows|pc/i.test(p)) ? "PC" : e.platforms[0] ?? "Unknown",
    storefront: e.steamAppId ? "Steam" : null,
    steamAppId: e.steamAppId ?? null,
    coverPath: null,
    description: e.summary ?? null,
    releaseYear: null,
    developer: null,
    publisher: null,
    ownership: "not_owned",
    installStatus: "unknown",
    status: "backlog",
    rating: null,
    favorite: false,
    notes: "",
    importedPlaytimeMin: null,
    playtimeSource: null,
    steamPlaytimeMin: null,
    steamLastPlayed: null,
    steamSyncedAt: null,
    lastPlayed: null,
    dateCompleted: null,
    dateDropped: null,
    multiplayer,
    endless: null,
    scale: null,
    refVersion: null,
    recPref: "normal",
    metaSource: multiplayer === "unknown" ? {} : { multiplayer: "igdb_modes" },
    legacy: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    tags,
    lengths,
    meta: { igdb: { gameId: `igdb:${e.igdbId}`, provider: "igdb", providerId: String(e.igdbId), status: "linked", method: "discover", confidence: 1, data: meta, candidates: [], rejected: [], error: null, fetchedAt: nowIso, updatedAt: nowIso } },
  };
}

/** Which library game (if any) an IGDB candidate already is: by Steam app id, linked IGDB id, or exact title. */
export function libraryMatch(e: ExtGame, idx: LibraryIndex): Game | null {
  if (e.steamAppId && idx.bySteam.has(e.steamAppId)) return idx.bySteam.get(e.steamAppId)!;
  if (idx.byIgdb.has(e.igdbId)) return idx.byIgdb.get(e.igdbId)!;
  return idx.byCanon.get(canon(e.name)) ?? null;
}

export interface LibraryIndex {
  bySteam: Map<number, Game>;
  byIgdb: Map<number, Game>;
  byCanon: Map<string, Game>;
}

export function libraryIndex(games: Game[]): LibraryIndex {
  const bySteam = new Map<number, Game>();
  const byIgdb = new Map<number, Game>();
  const byCanon = new Map<string, Game>();
  for (const g of games) {
    if (g.steamAppId) bySteam.set(g.steamAppId, g);
    const ig = g.meta.igdb?.status === "linked" ? Number(g.meta.igdb.providerId) : NaN;
    if (Number.isInteger(ig)) byIgdb.set(ig, g);
    if (!byCanon.has(g.canon)) byCanon.set(g.canon, g);
  }
  return { bySteam, byIgdb, byCanon };
}

export function describeBeyondError(e: unknown): string {
  if (e instanceof NetError) {
    if (e.kind === "auth") return "IGDB (Twitch) refused your Client ID or Secret. Check them under Steam & metadata → Connections.";
    if (e.kind === "offline") return "You're offline. Showing the last results REWIND saved.";
    if (e.kind === "rate_limited") return "IGDB asked REWIND to slow down. Try again in a minute.";
    if (e.kind === "cancelled") return "Stopped.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
