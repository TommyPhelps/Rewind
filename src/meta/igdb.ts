// IGDB (owned by Twitch): optional. Needs your own free Twitch developer Client ID and
// Secret. Used for games Steam doesn't cover, extra genres, and IGDB's player-submitted
// "time to beat" — the only documented, permitted source of completion times REWIND uses.
// Attribution: "Game data from IGDB.com".

import { NetError, qs, type Net } from "./http.ts";
import type { Candidate, MetaData } from "./types.ts";

const API = "https://api.igdb.com/v4";
const IMG = "https://images.igdb.com/igdb/image/upload";

export interface IgdbCreds {
  clientId: string;
  clientSecret: string;
}
export interface IgdbToken {
  token: string;
  expiresAt: number; // ms epoch
}

export async function getToken(net: Net, c: IgdbCreds, signal?: AbortSignal): Promise<IgdbToken> {
  const j = await net.json<{ access_token?: string; expires_in?: number }>(
    { method: "POST", url: `https://id.twitch.tv/oauth2/token?${qs({ client_id: c.clientId.trim(), client_secret: c.clientSecret.trim(), grant_type: "client_credentials" })}` },
    { signal, retries: 0 },
  );
  if (!j.access_token) throw new NetError("auth", "Twitch didn't return a token. Check the Client ID and Secret.");
  return { token: j.access_token, expiresAt: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 };
}

async function query<T>(net: Net, c: IgdbCreds, tok: IgdbToken, endpoint: string, body: string, signal?: AbortSignal): Promise<T> {
  return net.json<T>(
    {
      method: "POST",
      url: `${API}/${endpoint}`,
      headers: [
        ["Client-ID", c.clientId.trim()],
        ["Authorization", `Bearer ${tok.token}`],
        ["Accept", "application/json"],
        ["Content-Type", "text/plain"],
      ],
      body,
    },
    { signal },
  );
}

const FIELDS =
  "fields name,first_release_date,summary,url,genres.name,themes.name,game_modes.name,player_perspectives.name,platforms.name," +
  "involved_companies.company.name,involved_companies.developer,involved_companies.publisher,cover.image_id,external_games.*,websites.url;";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export async function searchGames(net: Net, c: IgdbCreds, tok: IgdbToken, title: string, signal?: AbortSignal): Promise<Record<string, any>[]> {
  const term = title.replace(/[™®©]/g, "").trim();
  return query<Record<string, any>[]>(net, c, tok, "games", `search "${esc(term)}"; ${FIELDS} limit 10;`, signal);
}

export async function gameById(net: Net, c: IgdbCreds, tok: IgdbToken, id: number, signal?: AbortSignal): Promise<Record<string, any> | null> {
  const r = await query<Record<string, any>[]>(net, c, tok, "games", `${FIELDS} where id = ${Math.trunc(id)};`, signal);
  return r[0] ?? null;
}

export async function timeToBeat(net: Net, c: IgdbCreds, tok: IgdbToken, id: number, signal?: AbortSignal): Promise<MetaData["timeToBeat"] | undefined> {
  const r = await query<Record<string, any>[]>(net, c, tok, "game_time_to_beats", `fields game_id,hastily,normally,completely,count; where game_id = ${Math.trunc(id)};`, signal);
  return parseTimeToBeat(r[0]);
}

export function parseTimeToBeat(t: Record<string, any> | undefined): MetaData["timeToBeat"] | undefined {
  if (!t) return undefined;
  const h = (s: unknown) => {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.round((n / 3600) * 10) / 10 : undefined;
  };
  const out = { main: h(t.hastily), extras: h(t.normally), complete: h(t.completely), count: Number(t.count) || undefined };
  return out.main || out.extras || out.complete ? out : undefined;
}

/** Does this IGDB game list the given Steam app id among its store links? */
export function hasSteamId(g: Record<string, any>, appid: number): boolean {
  const ext: any[] = Array.isArray(g.external_games) ? g.external_games : [];
  return ext.some(
    (e) =>
      (typeof e?.url === "string" && new RegExp(`store\\.steampowered\\.com/app/${appid}(\\D|$)`).test(e.url)) ||
      (String(e?.uid) === String(appid) && (e?.category === 1 || e?.external_game_source === 1)),
  );
}

export function toCandidate(g: Record<string, any>, score: number): Candidate {
  const year = g.first_release_date ? new Date(Number(g.first_release_date) * 1000).getUTCFullYear() : undefined;
  return { id: String(g.id), name: String(g.name ?? ""), year, score, thumb: g.cover?.image_id ? `${IMG}/t_thumb/${g.cover.image_id}.jpg` : null };
}

export function parseGame(g: Record<string, any>): MetaData {
  const names = (xs: unknown) => (Array.isArray(xs) ? [...new Set(xs.map((x: any) => (typeof x?.name === "string" ? x.name : "")).filter(Boolean))] : []);
  const companies: any[] = Array.isArray(g.involved_companies) ? g.involved_companies : [];
  const co = (flag: "developer" | "publisher") => [...new Set(companies.filter((c) => c?.[flag] && c.company?.name).map((c) => String(c.company.name)))];
  const date = g.first_release_date ? new Date(Number(g.first_release_date) * 1000).toISOString().slice(0, 10) : undefined;
  const art: MetaData["art"] = {};
  if (g.cover?.image_id) art.cover = { url: `${IMG}/t_cover_big_2x/${g.cover.image_id}.jpg`, kind: "portrait" };
  const steamUrl = (Array.isArray(g.external_games) ? g.external_games : []).map((e: any) => e?.url).find((u: unknown) => typeof u === "string" && /store\.steampowered\.com\/app\//.test(u));
  return {
    name: String(g.name ?? ""),
    releaseDate: date,
    releaseYear: date ? Number(date.slice(0, 4)) : undefined,
    description: typeof g.summary === "string" ? g.summary.trim() : undefined,
    developers: co("developer"),
    publishers: co("publisher"),
    genres: names(g.genres),
    tags: [...names(g.themes), ...names(g.player_perspectives)].map((name) => ({ name })),
    features: names(g.game_modes),
    platforms: names(g.platforms),
    storeUrl: steamUrl,
    pageUrl: typeof g.url === "string" ? g.url : undefined,
    art,
    attribution: "IGDB.com",
  };
}
