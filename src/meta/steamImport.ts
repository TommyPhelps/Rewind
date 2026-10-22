// Steam library import: preview first, then one all-or-nothing transaction.
// Matching: already-linked app id → exact title → same title with different edition
// wording → similar title (shown, not applied unless you choose) → new game.
// Only Steam's own numbers are written (app id, Steam playtime, last played) plus,
// if you leave it ticked, "Owned". Ratings, notes, statuses and preferences are untouched.

import type { Statement } from "../db/driver.ts";
import { newId, nowIso, type Repo } from "../db/repo.ts";
import { canon, cleanTitle } from "../lib/canon.ts";
import type { Game } from "../lib/types.ts";
import { confidenceOf, rankCandidates, type Confidence } from "./match.ts";
import type { OwnedGame } from "./steam.ts";
import { isProbablyNotAGame } from "./steamLocal.ts";
import { sourceStatement } from "../db/repo.ts";
import { steamLaunch } from "../launchers/launch.ts";
import type { MetaRecord } from "./types.ts";

/** Where the Steam numbers came from: your account via the Web API, or the Steam client on this PC. */
export type SteamSource = "steam_api" | "steam_local";
export const STEAM_SOURCE_LABEL: Record<SteamSource, string> = {
  steam_api: "Steam account (Web API)",
  steam_local: "Steam client on this PC",
};

export type RowKind = "linked" | "exact" | "edition" | "similar" | "new" | "conflict";
export type RowAction = { type: "link"; gameId: string } | { type: "add" } | { type: "skip" };

export interface PlanRow {
  owned: OwnedGame & { installed?: boolean };
  kind: RowKind;
  confidence: Confidence | null;
  candidates: { gameId: string; title: string; score: number }[];
  action: RowAction;
  note: string;
}

export interface SteamPlan {
  source: SteamSource;
  rows: PlanRow[];
  notInSteam: number;
  counts: Record<RowKind, number>;
}

export const KIND_LABEL: Record<RowKind, string> = {
  linked: "Already linked",
  exact: "Exact match",
  edition: "Same game, edition wording differs",
  similar: "Similar title — check",
  new: "Not in REWIND yet",
  conflict: "Conflict",
};

export function buildSteamPlan(owned: (OwnedGame & { installed?: boolean })[], games: Game[], source: SteamSource = "steam_api"): SteamPlan {
  const byApp = new Map<number, Game>();
  for (const g of games) if (g.steamAppId != null) byApp.set(g.steamAppId, g);
  const byCanon = new Map<string, Game[]>();
  for (const g of games) {
    const k = canon(g.title);
    if (!byCanon.has(k)) byCanon.set(k, []);
    byCanon.get(k)!.push(g);
  }
  const claimed = new Set<string>();
  const rows: PlanRow[] = [];
  const list = [...owned].sort((a, b) => a.name.localeCompare(b.name));

  // Pass 1: app ids and exact titles first, so fuzzy matches can't steal them.
  const pending: OwnedGame[] = [];
  for (const o of list) {
    const hit = byApp.get(o.appid);
    if (hit) {
      claimed.add(hit.id);
      rows.push({ owned: o, kind: "linked", confidence: "exact", candidates: [{ gameId: hit.id, title: hit.title, score: 1 }], action: { type: "link", gameId: hit.id }, note: "" });
      continue;
    }
    const same = (byCanon.get(canon(o.name)) ?? []).filter((g) => !claimed.has(g.id));
    const free = same.filter((g) => g.steamAppId == null);
    if (free.length === 1) {
      claimed.add(free[0].id);
      rows.push({ owned: o, kind: "exact", confidence: "exact", candidates: [{ gameId: free[0].id, title: free[0].title, score: 1 }], action: { type: "link", gameId: free[0].id }, note: "" });
      continue;
    }
    if (free.length > 1) {
      rows.push({
        owned: o,
        kind: "conflict",
        confidence: null,
        candidates: free.map((g) => ({ gameId: g.id, title: g.title, score: 1 })),
        action: { type: "skip" },
        note: `${free.length} games in REWIND have this title. Choose which one is the Steam copy.`,
      });
      continue;
    }
    if (same.length) {
      const other = same[0];
      rows.push({
        owned: o,
        kind: "conflict",
        confidence: null,
        candidates: [{ gameId: other.id, title: other.title, score: 1 }],
        action: { type: "skip" },
        note: `"${cleanTitle(other.title)}" is already linked to a different Steam app (${other.steamAppId}). Usually a second edition — add it separately or skip.`,
      });
      continue;
    }
    pending.push(o);
  }

  // Pass 2: similar titles among games still unclaimed and not linked to another app.
  const open = () => games.filter((g) => !claimed.has(g.id) && g.steamAppId == null);
  for (const o of pending) {
    const ranked = rankCandidates(o.name, open().map((g) => ({ name: g.title, g }))).slice(0, 4);
    const best = ranked[0];
    if (best && best.match.score >= 0.75) {
      const conf = confidenceOf(best.match.score);
      const strong = best.match.reason === "edition" && (!ranked[1] || ranked[1].match.score < best.match.score - 0.02);
      if (strong) claimed.add(best.item.g.id);
      rows.push({
        owned: o,
        kind: strong ? "edition" : "similar",
        confidence: conf,
        candidates: ranked.map((r) => ({ gameId: r.item.g.id, title: r.item.g.title, score: r.match.score })),
        action: strong ? { type: "link", gameId: best.item.g.id } : { type: "skip" },
        note: strong ? "" : "Not imported unless you pick a match or choose Add as new.",
      });
    } else if (isProbablyNotAGame(o.appid, o.name)) {
      rows.push({ owned: o, kind: "new", confidence: null, candidates: [], action: { type: "skip" }, note: "Looks like a tool, server, soundtrack or test client, so it isn't ticked." });
    } else {
      rows.push({ owned: o, kind: "new", confidence: null, candidates: [], action: { type: "add" }, note: "" });
    }
  }

  const linkedIds = new Set(rows.flatMap((r) => (r.action.type === "link" ? [r.action.gameId] : [])));
  const counts = { linked: 0, exact: 0, edition: 0, similar: 0, new: 0, conflict: 0 } as Record<RowKind, number>;
  for (const r of rows) counts[r.kind]++;
  return { source, rows, counts, notInSteam: games.filter((g) => !linkedIds.has(g.id)).length };
}

/** Checks a plan after manual edits: one REWIND game can't take two Steam apps. */
export function planProblems(plan: SteamPlan): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const r of plan.rows) {
    if (r.action.type !== "link") continue;
    const prev = seen.get(r.action.gameId);
    if (prev) out.push(`"${cleanTitle(prev)}" and "${cleanTitle(r.owned.name)}" are both linked to the same REWIND game.`);
    else seen.set(r.action.gameId, r.owned.name);
  }
  return out;
}

export interface ApplySummary {
  linked: number;
  added: number;
  skipped: number;
  playtimeUpdated: number;
  markedOwned: number;
}

export function steamPlanStatements(repo: Repo, plan: SteamPlan, games: Game[], opts: { markOwned: boolean }): { stmts: Statement[]; summary: ApplySummary } {
  const byId = new Map(games.map((g) => [g.id, g]));
  const usedApps = new Set(games.flatMap((g) => (g.steamAppId != null ? [g.steamAppId] : [])));
  const t = nowIso();
  const stmts: Statement[] = [];
  const s: ApplySummary = { linked: 0, added: 0, skipped: 0, playtimeUpdated: 0, markedOwned: 0 };
  const metaRow = (gameId: string, appid: number, existing?: MetaRecord): MetaRecord => ({
    gameId,
    provider: "steam",
    providerId: String(appid),
    status: "linked",
    method: "steam_import",
    confidence: 1,
    data: existing?.providerId === String(appid) ? existing.data : null,
    candidates: [],
    rejected: existing?.rejected ?? [],
    error: null,
    fetchedAt: existing?.providerId === String(appid) ? existing.fetchedAt : null,
    updatedAt: t,
  });

  for (const r of plan.rows) {
    const o = r.owned;
    if (r.action.type === "skip") {
      s.skipped++;
      continue;
    }
    if (r.action.type === "link") {
      const g = byId.get(r.action.gameId);
      if (!g) continue;
      const setApp = g.steamAppId == null && !usedApps.has(o.appid);
      if (setApp) usedApps.add(o.appid);
      const own = opts.markOwned && g.ownership !== "owned";
      const ms = JSON.stringify({ ...g.metaSource, steamPlaytime: plan.source });
      // Steam's figures only ever grow; a smaller number (e.g. this PC knows less) never replaces a bigger one.
      const minutes = Math.max(o.playtimeMin, g.steamPlaytimeMin ?? 0);
      const last = [o.lastPlayed, g.steamLastPlayed].filter(Boolean).sort().pop() ?? null;
      stmts.push({
        sql: `UPDATE games SET ${setApp ? "steam_app_id = ?, " : ""}steam_playtime_min = ?, steam_last_played = ?, steam_synced_at = ?,
              storefront = COALESCE(storefront, 'Steam')${own ? ", ownership = 'owned'" : ""}, meta_source = ?, updated_at = ? WHERE id = ?`,
        params: [...(setApp ? [o.appid] : []), minutes, last, t, ms, t, g.id],
      });
      stmts.push(sourceStatement(g.id, { source: "steam", externalId: String(o.appid), title: o.name, method: plan.source === "steam_local" ? "local_scan" : "steam_import", playtimeMin: minutes, lastSeenAt: t, launch: steamLaunch(o.appid) }, t));
      if ((g.steamPlaytimeMin ?? null) !== minutes) s.playtimeUpdated++;
      if (own) s.markedOwned++;
      const appForMeta = setApp ? o.appid : g.steamAppId;
      if (appForMeta === o.appid && !(g.meta.steam?.rejected ?? []).includes(String(o.appid))) {
        const ex = g.meta.steam;
        if (!(ex?.status === "linked" && ex.providerId === String(o.appid))) {
          const m = metaRow(g.id, o.appid, ex);
          stmts.push(metaInsert(m));
        }
      }
      s.linked++;
      continue;
    }
    // Add as a new game.
    if (usedApps.has(o.appid)) {
      s.skipped++;
      continue;
    }
    usedApps.add(o.appid);
    const id = newId();
    stmts.push(
      repo.insertStatement("games", {
        id,
        title: o.name,
        canon: canon(o.name),
        platform: "PC",
        storefront: "Steam",
        steam_app_id: o.appid,
        ownership: "owned",
        status: "backlog",
        steam_playtime_min: o.playtimeMin,
        steam_last_played: o.lastPlayed,
        steam_synced_at: t,
        meta_source: JSON.stringify({ steamPlaytime: plan.source }),
        created_at: t,
        updated_at: t,
      }),
    );
    stmts.push(metaInsert(metaRow(id, o.appid)));
    stmts.push(sourceStatement(id, { source: "steam", externalId: String(o.appid), title: o.name, method: plan.source === "steam_local" ? "local_scan" : "steam_import", playtimeMin: o.playtimeMin, lastSeenAt: t, launch: steamLaunch(o.appid) }, t));
    stmts.push(repo.eventStatement("game_added", id, { title: o.name, from: plan.source }, t));
    s.added++;
  }
  stmts.push(repo.eventStatement("steam_import", null, { ...s, source: plan.source }, t));
  return { stmts, summary: s };
}

function metaInsert(m: MetaRecord): Statement {
  return {
    sql: `INSERT INTO game_meta (game_id, provider, provider_id, status, method, confidence, data, candidates, rejected, error, fetched_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(game_id, provider) DO UPDATE SET provider_id = excluded.provider_id, status = excluded.status, method = excluded.method,
            confidence = excluded.confidence, data = excluded.data, candidates = excluded.candidates, error = NULL,
            fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`,
    params: [m.gameId, m.provider, m.providerId, m.status, m.method, m.confidence, m.data ? JSON.stringify(m.data) : null, "[]", JSON.stringify(m.rejected), null, m.fetchedAt, m.updatedAt],
  };
}
