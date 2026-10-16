// Imports a backup from the old REWIND Game Picker artifact.
//
// The artifact stored its data as documents: { state, lib0, lib1, ... } where
// each libN holds { g: [games] }. Its "Download backup" button produced exactly
// that JSON, so the same parser handles both.
//
// Nothing is written until the user has seen the preview and confirmed it, and
// the whole import runs as one transaction.

import { canon } from "../lib/canon.ts";
import type { Statement } from "../db/driver.ts";
import { newId, nowIso, type Repo } from "../db/repo.ts";
import type { LengthKind, Multiplayer, Status } from "../lib/types.ts";
import { LEGACY_GAMES, type LegacyGameRow } from "./legacyReference.ts";
import { DEFAULT_PROFILE } from "../data/profileDefaults.ts";

/** One game as the artifact stored it. Short keys are the artifact's own. */
export interface ArtifactGame {
  id: string; // canonical key
  n: string; // title
  p?: number; // hours played (imported)
  st?: string; // "" | a (accepted into a slot) | q (queued behind a series prerequisite) | d (done)
  k?: string; // slot kind
  h?: number; // user's own length override (hours)
  e?: number | boolean; // user: endless yes/no
  s?: number | boolean; // user: solo-playable yes/no
  f?: boolean; // user: always/never allow in short slot
  hd?: number; // hidden from picks
  r?: number; // rating -2..2
  nt?: string; // notes
  pv?: string; // previous game in series override
  da?: number; // date finished (ms)
  ai?: { main?: number; plus?: number; e?: boolean; solo?: boolean; tags?: string[]; unk?: number };
  [key: string]: unknown;
}

export interface ArtifactBackup {
  state: Record<string, unknown>;
  games: ArtifactGame[];
}

/** Recognizes the artifact format without throwing. */
export function isArtifactBackup(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return !!o.state && typeof o.state === "object" && "lib0" in o;
}

export function parseArtifactBackup(obj: unknown): ArtifactBackup {
  if (!isArtifactBackup(obj)) {
    throw new Error("This file is not a REWIND artifact backup (expected 'state' and 'lib0' sections).");
  }
  const o = obj as Record<string, unknown>;
  const games: ArtifactGame[] = [];
  for (let i = 0; o["lib" + i]; i++) {
    const chunk = o["lib" + i] as { g?: unknown };
    if (!Array.isArray(chunk.g)) throw new Error(`Section lib${i} is damaged (no game list).`);
    for (const g of chunk.g) {
      if (!g || typeof g !== "object") continue;
      const rec = g as ArtifactGame;
      if (typeof rec.n !== "string" || !rec.n.trim()) continue;
      games.push(rec);
    }
  }
  return { state: o.state as Record<string, unknown>, games };
}

// ---------- legacy reference lookup (same rules as the artifact) ----------

let LEGACY_INDEX: Map<string, LegacyGameRow> | null = null;
function legacyIndex(): Map<string, LegacyGameRow> {
  if (LEGACY_INDEX) return LEGACY_INDEX;
  LEGACY_INDEX = new Map();
  for (const row of LEGACY_GAMES) {
    for (const n of row[0]) {
      const k = canon(n);
      if (!LEGACY_INDEX.has(k)) LEGACY_INDEX.set(k, row);
    }
  }
  return LEGACY_INDEX;
}

export function lookupLegacy(title: string): LegacyGameRow | null {
  const idx = legacyIndex();
  const k = canon(title);
  if (idx.has(k)) return idx.get(k)!;
  const pre = canon(String(title).split(/:| - /)[0]);
  if (pre !== k && pre.split(" ").length >= 2 && idx.has(pre) && !/\d/.test(k.replace(pre, ""))) return idx.get(pre)!;
  return null;
}

// ---------- plan ----------

const SUSPICIOUS_TITLES = new Set(["game", "games", "title", "name", "titles", "names"]);

export type PlanAction = "add" | "merge" | "skip";

export interface PlannedGame {
  key: string; // stable key within the plan (artifact id)
  title: string;
  canonKey: string;
  action: PlanAction;
  reason?: string; // why it is skipped or flagged
  suspicious: boolean;
  existingId?: string;
  status: Status;
  playtimeMin: number | null;
  legacyMatch: boolean;
  upNextPosition: number | null;
  source: ArtifactGame;
}

export interface ArtifactPlan {
  games: PlannedGame[];
  upNext: string[]; // plan keys in order
  logEntries: { t: number; x: string }[];
  settings: Record<string, unknown>;
  state: Record<string, unknown>;
  counts: {
    inFile: number;
    add: number;
    merge: number;
    skip: number;
    withPlaytime: number;
    legacyMatches: number;
    completed: number;
    hidden: number;
    withNotes: number;
    withRating: number;
  };
  statusMap: { from: string; to: Status; count: number }[];
}

const ST_LABEL: Record<string, string> = {
  "": "No status",
  a: "In a pick slot (accepted)",
  q: "Queued behind a series entry",
  d: "Finished",
};

function mapStatus(st: string | undefined): Status {
  return st === "d" ? "completed" : "backlog";
}

export function buildArtifactPlan(
  backup: ArtifactBackup,
  existingByCanon: Map<string, string> = new Map(),
): ArtifactPlan {
  const state = backup.state;
  const slots = (state.slots ?? {}) as Record<string, { queue?: string[] } | null>;
  const queueOrder: string[] = [];
  for (const kind of ["long", "short"]) {
    for (const id of slots[kind]?.queue ?? []) if (!queueOrder.includes(id)) queueOrder.push(id);
  }
  // Games accepted or queued but somehow not in the slot queues still belong in Up Next.
  for (const g of backup.games) if ((g.st === "a" || g.st === "q") && !queueOrder.includes(g.id)) queueOrder.push(g.id);

  const seen = new Set<string>();
  const games: PlannedGame[] = [];
  const statusCounts = new Map<string, number>();

  for (const g of backup.games) {
    const title = g.n.trim();
    const canonKey = canon(title) || title.toLowerCase();
    const key = String(g.id || canonKey);
    const suspicious = SUSPICIOUS_TITLES.has(title.toLowerCase());
    let action: PlanAction = "add";
    let reason: string | undefined;
    const existingId = existingByCanon.get(canonKey);
    if (seen.has(canonKey)) {
      action = "skip";
      reason = "Duplicate of another entry in this backup";
    } else if (suspicious) {
      action = "skip";
      reason = "Looks like a spreadsheet header row, not a game";
    } else if (existingId) {
      action = "merge";
      reason = "Already in your REWIND library: only empty fields are filled in";
    }
    seen.add(canonKey);
    const st = g.st ?? "";
    statusCounts.set(st, (statusCounts.get(st) ?? 0) + 1);
    const qi = queueOrder.indexOf(g.id);
    games.push({
      key,
      title,
      canonKey,
      action,
      reason,
      suspicious,
      existingId,
      status: mapStatus(g.st),
      playtimeMin: typeof g.p === "number" && g.p > 0 ? Math.round(g.p * 60) : null,
      legacyMatch: !!lookupLegacy(title),
      upNextPosition: qi >= 0 ? qi : null,
      source: g,
    });
  }

  const active = games.filter((x) => x.action !== "skip");
  return {
    games,
    upNext: queueOrder.filter((id) => games.some((x) => x.key === id && x.action !== "skip")),
    logEntries: Array.isArray(state.log) ? (state.log as { t: number; x: string }[]) : [],
    settings: (state.settings ?? {}) as Record<string, unknown>,
    state,
    counts: {
      inFile: games.length,
      add: games.filter((x) => x.action === "add").length,
      merge: games.filter((x) => x.action === "merge").length,
      skip: games.filter((x) => x.action === "skip").length,
      withPlaytime: active.filter((x) => x.playtimeMin != null).length,
      legacyMatches: active.filter((x) => x.legacyMatch).length,
      completed: active.filter((x) => x.status === "completed").length,
      hidden: active.filter((x) => x.source.hd).length,
      withNotes: active.filter((x) => typeof x.source.nt === "string" && x.source.nt.trim()).length,
      withRating: active.filter((x) => typeof x.source.r === "number" && x.source.r !== 0).length,
    },
    statusMap: [...statusCounts.entries()].map(([from, count]) => ({
      from: ST_LABEL[from] ?? `Status "${from}"`,
      to: mapStatus(from),
      count,
    })),
  };
}

/** Lets the user include a skipped row (e.g. a flagged title that really is a game). */
export function setPlanAction(plan: ArtifactPlan, key: string, include: boolean): ArtifactPlan {
  const games = plan.games.map((g) =>
    g.key === key ? { ...g, action: (include ? (g.existingId ? "merge" : "add") : "skip") as PlanAction } : g,
  );
  return { ...plan, games, counts: { ...plan.counts, add: games.filter((g) => g.action === "add").length, merge: games.filter((g) => g.action === "merge").length, skip: games.filter((g) => g.action === "skip").length } };
}

// ---------- apply ----------

const RATING_MAP: Record<string, number> = { "2": 5, "1": 4, "-1": 2, "-2": 1 };

function toDate(ms: unknown): string | null {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString().slice(0, 10);
}

interface Derived {
  multiplayer: Multiplayer;
  endless: number | null;
  metaSource: Record<string, string>;
  lengths: { kind: LengthKind; hours: number; source: string }[];
  tags: { tag: string; source: string }[];
}

function derive(g: ArtifactGame, basis: string): Derived {
  const ref = lookupLegacy(g.n);
  const metaSource: Record<string, string> = {};
  let multiplayer: Multiplayer = "unknown";
  let endless: number | null = null;

  if (g.s != null) {
    multiplayer = g.s ? "solo" : "mp_required";
    metaSource.multiplayer = "user";
  } else if (ref) {
    multiplayer = ref[3].includes("M") ? "mp_required" : ref[3].includes("C") ? "coop_focused" : "solo";
    metaSource.multiplayer = "legacy_table";
  } else if (g.ai && !g.ai.unk && g.ai.solo != null) {
    multiplayer = g.ai.solo === false ? "mp_required" : "solo";
    metaSource.multiplayer = "ai_estimate";
  }

  if (g.e != null) {
    endless = g.e ? 1 : 0;
    metaSource.endless = "user";
  } else if (ref) {
    endless = ref[3].includes("E") ? 1 : 0;
    metaSource.endless = "legacy_table";
  } else if (g.ai && !g.ai.unk && g.ai.e != null) {
    endless = g.ai.e ? 1 : 0;
    metaSource.endless = "ai_estimate";
  }

  const lengths: Derived["lengths"] = [];
  if (typeof g.h === "number" && g.h >= 0) {
    lengths.push({ kind: basis === "main" ? "main" : "main_extras", hours: g.h, source: "user" });
  }
  if (ref) {
    if (ref[1] > 0) lengths.push({ kind: "main", hours: ref[1], source: "legacy_table" });
    if (ref[2] > 0) lengths.push({ kind: "main_extras", hours: ref[2], source: "legacy_table" });
  } else if (g.ai && !g.ai.unk) {
    if (Number(g.ai.main) > 0) lengths.push({ kind: "main", hours: Number(g.ai.main), source: "ai_estimate" });
    if (Number(g.ai.plus) > 0) lengths.push({ kind: "main_extras", hours: Number(g.ai.plus), source: "ai_estimate" });
  }

  const tags: Derived["tags"] = [];
  const tagSrc = ref ? ref[4] : g.ai && !g.ai.unk && Array.isArray(g.ai.tags) ? g.ai.tags : [];
  for (const t of tagSrc) {
    const tag = String(t).trim().toLowerCase();
    if (tag && !tags.some((x) => x.tag === tag)) tags.push({ tag, source: ref ? "legacy" : "ai_estimate" });
  }
  if (ref) metaSource.tags = "legacy_table";
  return { multiplayer, endless, metaSource, lengths, tags };
}

export interface ApplyResult {
  added: number;
  merged: number;
  skipped: number;
  upNextCollectionId: string | null;
}

export async function applyArtifactPlan(repo: Repo, plan: ArtifactPlan): Promise<ApplyResult> {
  const t = nowIso();
  const basis = String(plan.settings.basis ?? "plus");
  const stmts: Statement[] = [];
  const idByKey = new Map<string, string>();
  let added = 0;
  let merged = 0;

  for (const pg of plan.games) {
    if (pg.action === "skip") continue;
    const g = pg.source;
    const d = derive(g, basis);
    const rating = g.r != null ? RATING_MAP[String(g.r)] ?? null : null;
    const notes = typeof g.nt === "string" ? g.nt : "";
    const { n: _title, ...legacyRest } = g;

    if (pg.action === "merge" && pg.existingId) {
      const id = pg.existingId;
      idByKey.set(pg.key, id);
      // Fill only fields that are still empty; never overwrite what is already there.
      stmts.push({
        sql: `UPDATE games SET
          imported_playtime_min = COALESCE(imported_playtime_min, ?),
          playtime_source = COALESCE(playtime_source, ?),
          notes = CASE WHEN notes = '' THEN ? ELSE notes END,
          rating = COALESCE(rating, ?),
          legacy_id = COALESCE(legacy_id, ?),
          legacy_json = COALESCE(legacy_json, ?),
          updated_at = ?
          WHERE id = ?`,
        params: [
          pg.playtimeMin,
          pg.playtimeMin != null ? "rewind_artifact" : null,
          notes,
          rating,
          g.id,
          JSON.stringify(legacyRest),
          t,
          id,
        ],
      });
      for (const l of d.lengths) {
        stmts.push({
          sql: `INSERT OR IGNORE INTO game_lengths (game_id, kind, hours, source, updated_at) VALUES (?, ?, ?, ?, ?)`,
          params: [id, l.kind, l.hours, l.source, t],
        });
      }
      for (const tg of d.tags) {
        stmts.push({ sql: `INSERT OR IGNORE INTO game_tags (game_id, tag, source) VALUES (?, ?, ?)`, params: [id, tg.tag, tg.source] });
      }
      merged++;
      continue;
    }

    const id = newId();
    idByKey.set(pg.key, id);
    stmts.push(
      repo.insertStatement("games", {
        id,
        title: pg.title,
        canon: pg.canonKey,
        legacy_id: g.id,
        platform: "PC",
        ownership: "owned",
        install_status: "unknown",
        status: pg.status,
        rating,
        favorite: 0,
        notes,
        imported_playtime_min: pg.playtimeMin,
        playtime_source: pg.playtimeMin != null ? "rewind_artifact" : null,
        date_completed: pg.status === "completed" ? toDate(g.da) : null,
        multiplayer: d.multiplayer,
        endless: d.endless,
        rec_pref: g.hd ? "never" : "normal",
        meta_source: JSON.stringify(d.metaSource),
        legacy_json: JSON.stringify(legacyRest),
        created_at: t,
        updated_at: t,
      }),
    );
    for (const l of d.lengths) {
      stmts.push({
        sql: `INSERT INTO game_lengths (game_id, kind, hours, source, updated_at) VALUES (?, ?, ?, ?, ?)`,
        params: [id, l.kind, l.hours, l.source, t],
      });
    }
    for (const tg of d.tags) {
      stmts.push({ sql: `INSERT OR IGNORE INTO game_tags (game_id, tag, source) VALUES (?, ?, ?)`, params: [id, tg.tag, tg.source] });
    }
    if (pg.status === "completed") {
      stmts.push({
        sql: `INSERT INTO playthroughs (id, game_id, started_at, ended_at, outcome, notes) VALUES (?, ?, NULL, ?, 'completed', '')`,
        params: [newId(), id, toDate(g.da)],
      });
    }
    added++;
  }

  // "Up Next": the games that were sitting in the old pick slots, in queue order.
  let upNextCollectionId: string | null = null;
  const upNextIds = plan.upNext.map((k) => idByKey.get(k)).filter((x): x is string => !!x);
  if (upNextIds.length) {
    const existing = await repo.driver.select<{ id: string }>(`SELECT id FROM collections WHERE name = 'Up Next' COLLATE NOCASE`);
    upNextCollectionId = existing[0]?.id ?? newId();
    if (!existing.length) {
      stmts.push({
        sql: `INSERT INTO collections (id, name, description, sort_order, created_at) VALUES (?, 'Up Next', ?, 0, ?)`,
        params: [upNextCollectionId, "Carried over from the old REWIND pick slots, in queue order.", t],
      });
    }
    const max = existing.length
      ? await repo.driver.select<{ m: number | null }>(`SELECT MAX(position) AS m FROM collection_games WHERE collection_id = ?`, [upNextCollectionId])
      : [{ m: -1 }];
    let pos = Number(max[0]?.m ?? -1);
    for (const gid of upNextIds) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO collection_games (collection_id, game_id, position, added_at) VALUES (?, ?, ?, ?)`,
        params: [upNextCollectionId, gid, ++pos, t],
      });
    }
  }

  // Activity: keep the old log with its original timestamps, then note the import itself.
  for (const e of plan.logEntries) {
    if (!e || typeof e.x !== "string") continue;
    const ts = Number(e.t) > 0 ? new Date(Number(e.t)).toISOString() : t;
    stmts.push(repo.eventStatement("legacy_log", null, { text: e.x }, ts));
  }
  stmts.push(repo.eventStatement("import", null, { from: "REWIND artifact", added, merged, skipped: plan.counts.skip }, t));

  // Settings: the profile starts from the brief; the old "solo only" switch carries over.
  const hasProfile = await repo.driver.select(`SELECT key FROM settings WHERE key = 'profile'`);
  if (!hasProfile.length) {
    const profile = { ...DEFAULT_PROFILE, excludeMultiplayerDependent: plan.settings.solo !== false };
    stmts.push({ sql: `INSERT INTO settings (key, value) VALUES ('profile', ?)`, params: [JSON.stringify(profile)] });
  }
  // The full old state (slots, stats, settings) is kept verbatim for reference, minus the log already imported.
  const { log: _log, ...rest } = plan.state;
  stmts.push({
    sql: `INSERT INTO settings (key, value) VALUES ('legacy_rewind_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    params: [JSON.stringify({ importedAt: t, state: rest })],
  });

  await repo.driver.batch(stmts);
  return { added, merged, skipped: plan.counts.skip, upNextCollectionId };
}
