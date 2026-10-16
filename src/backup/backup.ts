// REWIND 2 backups: one JSON file with every user table, versioned by schema.
//
// Restore always goes through validate -> preview -> confirm -> apply, and the
// apply step is a single transaction. "Merge" never overwrites existing values;
// "Replace" wipes the library first and is only offered behind a confirmation
// (the UI also saves an automatic safety snapshot before either one).

import type { Statement } from "../db/driver.ts";
import { BACKUP_TABLES, SCHEMA_VERSION, type BackupTable } from "../db/schema.ts";
import { nowIso, type Repo } from "../db/repo.ts";
import { canon } from "../lib/canon.ts";

export const BACKUP_FORMAT = "rewind-backup";

type Row = Record<string, unknown>;

export interface RewindBackup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  counts: Record<string, number>;
  data: Record<BackupTable, Row[]>;
}

export async function createBackup(repo: Repo, appVersion: string): Promise<RewindBackup> {
  const data = await repo.dumpTables();
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) counts[t] = data[t].length;
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, appVersion, exportedAt: nowIso(), counts, data };
}

export function backupFileName(prefix = "rewind-backup"): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

export type BackupKind = "rewind2" | "artifact" | "unknown";

export function detectBackupKind(obj: unknown): BackupKind {
  if (!obj || typeof obj !== "object") return "unknown";
  const o = obj as Record<string, unknown>;
  if (o.format === BACKUP_FORMAT) return "rewind2";
  if (o.state && typeof o.state === "object" && "lib0" in o) return "artifact";
  return "unknown";
}

const ENUMS: Record<string, Record<string, string[]>> = {
  games: {
    status: ["backlog", "playing", "paused", "completed", "dropped", "replay", "not_interested"],
    ownership: ["owned", "wishlist", "not_owned", "unknown"],
    install_status: ["installed", "not_installed", "unknown"],
    multiplayer: ["solo", "solo_and_mp", "coop_focused", "mp_required", "unknown"],
    rec_pref: ["normal", "boost", "never"],
    scale: ["short", "medium", "long", "endless"],
  },
  game_lengths: { kind: ["main", "main_extras", "completionist"] },
  playthroughs: { outcome: ["in_progress", "paused", "completed", "dropped"] },
};

const REQUIRED: Record<BackupTable, string[]> = {
  games: ["id", "title"],
  game_lengths: ["game_id", "kind", "hours", "source"],
  game_tags: ["game_id", "tag"],
  collections: ["id", "name"],
  collection_games: ["collection_id", "game_id"],
  playthroughs: ["id", "game_id"],
  sessions: ["id", "game_id", "started_at"],
  events: ["ts", "type"],
  settings: ["key", "value"],
  rec_events: ["ts", "kind"],
};

export type ValidationResult = { ok: true; backup: RewindBackup; warnings: string[] } | { ok: false; errors: string[] };

export function validateBackup(obj: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (detectBackupKind(obj) !== "rewind2") return { ok: false, errors: ["This is not a REWIND 2 backup file."] };
  const b = obj as Partial<RewindBackup>;
  if (typeof b.schemaVersion !== "number") errors.push("The backup has no schema version.");
  else if (b.schemaVersion > SCHEMA_VERSION)
    errors.push(`The backup was made by a newer REWIND (schema ${b.schemaVersion}; this app reads up to ${SCHEMA_VERSION}). Update REWIND first.`);
  if (!b.data || typeof b.data !== "object") return { ok: false, errors: [...errors, "The backup has no data section."] };

  const data = b.data as Record<string, unknown>;
  for (const t of BACKUP_TABLES) {
    if (data[t] === undefined) {
      warnings.push(`No "${t}" section; treated as empty.`);
      data[t] = [];
    }
    if (!Array.isArray(data[t])) {
      errors.push(`Section "${t}" is not a list.`);
      continue;
    }
    const rows = data[t] as unknown[];
    let bad = 0;
    rows.forEach((r, i) => {
      if (bad >= 5) return;
      if (!r || typeof r !== "object") {
        errors.push(`${t} row ${i + 1} is not an object.`);
        bad++;
        return;
      }
      const row = r as Row;
      for (const k of REQUIRED[t]) {
        if (row[k] === undefined || row[k] === null || row[k] === "") {
          errors.push(`${t} row ${i + 1} is missing "${k}".`);
          bad++;
        }
      }
      for (const [col, allowed] of Object.entries(ENUMS[t] ?? {})) {
        if (row[col] != null && !allowed.includes(String(row[col]))) {
          errors.push(`${t} row ${i + 1} has an unknown ${col} "${String(row[col])}".`);
          bad++;
        }
      }
      if (t === "games" && row.rating != null && !(Number(row.rating) >= 1 && Number(row.rating) <= 5)) {
        errors.push(`games row ${i + 1} has a rating outside 1-5.`);
        bad++;
      }
      if (t === "game_lengths" && !(Number(row.hours) >= 0)) {
        errors.push(`game_lengths row ${i + 1} has an invalid number of hours.`);
        bad++;
      }
    });
  }
  // Child rows must point at games in the same file.
  if (!errors.length) {
    const ids = new Set((data.games as Row[]).map((g) => String(g.id)));
    for (const t of ["game_lengths", "game_tags", "collection_games", "playthroughs", "sessions"] as const) {
      const orphans = (data[t] as Row[]).filter((r) => !ids.has(String(r.game_id))).length;
      if (orphans) warnings.push(`${orphans} ${t} row(s) refer to games not in the file and will be skipped.`);
    }
    const dupTitles = new Map<string, number>();
    for (const g of data.games as Row[]) {
      const k = canon(g.title);
      dupTitles.set(k, (dupTitles.get(k) ?? 0) + 1);
    }
    const dups = [...dupTitles.values()].filter((n) => n > 1).length;
    if (dups) warnings.push(`${dups} title(s) appear more than once inside the backup.`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, backup: b as RewindBackup, warnings };
}

export interface RestorePreview {
  counts: Record<string, number>;
  newGames: number;
  matchingGames: number;
  matchingSamples: { incoming: string; existing: string; by: "id" | "steam" | "title" }[];
  currentGames: number;
  exportedAt: string;
  appVersion: string;
}

interface Matching {
  map: Map<string, string>; // incoming id -> existing id
  samples: RestorePreview["matchingSamples"];
}

async function matchGames(repo: Repo, incoming: Row[]): Promise<Matching> {
  const existing = await repo.driver.select<Row>(`SELECT id, title, canon, steam_app_id FROM games`);
  const byId = new Map(existing.map((g) => [String(g.id), g]));
  const bySteam = new Map(existing.filter((g) => g.steam_app_id != null).map((g) => [String(g.steam_app_id), g]));
  const byCanon = new Map(existing.map((g) => [String(g.canon), g]));
  const map = new Map<string, string>();
  const samples: RestorePreview["matchingSamples"] = [];
  for (const g of incoming) {
    const id = String(g.id);
    let hit: Row | undefined;
    let by: "id" | "steam" | "title" = "id";
    if (byId.has(id)) hit = byId.get(id);
    else if (g.steam_app_id != null && bySteam.has(String(g.steam_app_id))) {
      hit = bySteam.get(String(g.steam_app_id));
      by = "steam";
    } else if (byCanon.has(canon(g.title))) {
      hit = byCanon.get(canon(g.title));
      by = "title";
    }
    if (hit) {
      map.set(id, String(hit.id));
      if (samples.length < 12) samples.push({ incoming: String(g.title), existing: String(hit.title), by });
    }
  }
  return { map, samples };
}

export async function previewRestore(repo: Repo, backup: RewindBackup): Promise<RestorePreview> {
  const m = await matchGames(repo, backup.data.games);
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) counts[t] = backup.data[t].length;
  return {
    counts,
    newGames: backup.data.games.length - m.map.size,
    matchingGames: m.map.size,
    matchingSamples: m.samples,
    currentGames: await repo.countGames(),
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
  };
}

export interface RestoreResult {
  mode: "merge" | "replace";
  gamesAdded: number;
  gamesMatched: number;
}

export async function applyRestore(repo: Repo, backup: RewindBackup, mode: "merge" | "replace"): Promise<RestoreResult> {
  const d = backup.data;
  const stmts: Statement[] = [];
  const gameIds = new Set(d.games.map((g) => String(g.id)));

  if (mode === "replace") {
    stmts.push(...repo.wipeStatements());
    for (const t of BACKUP_TABLES) {
      for (const row of d[t]) {
        if (row.game_id != null && t !== "events" && t !== "rec_events" && !gameIds.has(String(row.game_id))) continue;
        stmts.push(repo.insertStatement(t, row, t === "game_tags" || t === "collection_games" ? "ignore" : "insert"));
      }
    }
    stmts.push(repo.eventStatement("restore", null, { mode, from: backup.exportedAt }));
    await repo.driver.batch(stmts);
    return { mode, gamesAdded: d.games.length, gamesMatched: 0 };
  }

  // Merge: existing data always wins; only missing rows and empty fields are added.
  const m = await matchGames(repo, d.games);
  const remap = (id: unknown) => m.map.get(String(id)) ?? String(id);
  let added = 0;
  for (const g of d.games) {
    const target = m.map.get(String(g.id));
    if (!target) {
      stmts.push(repo.insertStatement("games", { ...g, canon: canon(g.title) }));
      added++;
    } else {
      stmts.push({
        sql: `UPDATE games SET
          steam_app_id = COALESCE(steam_app_id, ?), storefront = COALESCE(storefront, ?),
          description = COALESCE(description, ?), release_year = COALESCE(release_year, ?),
          developer = COALESCE(developer, ?), publisher = COALESCE(publisher, ?),
          rating = COALESCE(rating, ?), imported_playtime_min = COALESCE(imported_playtime_min, ?),
          notes = CASE WHEN notes = '' THEN COALESCE(?, '') ELSE notes END
          WHERE id = ?`,
        params: [
          (g.steam_app_id as number) ?? null,
          (g.storefront as string) ?? null,
          (g.description as string) ?? null,
          (g.release_year as number) ?? null,
          (g.developer as string) ?? null,
          (g.publisher as string) ?? null,
          (g.rating as number) ?? null,
          (g.imported_playtime_min as number) ?? null,
          (g.notes as string) ?? null,
          target,
        ],
      });
    }
  }
  for (const t of ["game_lengths", "game_tags", "playthroughs", "sessions"] as const) {
    for (const row of d[t]) {
      if (!gameIds.has(String(row.game_id))) continue;
      stmts.push(repo.insertStatement(t, { ...row, game_id: remap(row.game_id) }, "ignore"));
    }
  }
  // Collections match by id or by name.
  const existingCols = await repo.driver.select<Row>(`SELECT id, name FROM collections`);
  const colMap = new Map<string, string>();
  for (const c of d.collections) {
    const hit = existingCols.find((e) => e.id === c.id || String(e.name).toLowerCase() === String(c.name).toLowerCase());
    if (hit) colMap.set(String(c.id), String(hit.id));
    else stmts.push(repo.insertStatement("collections", c, "ignore"));
  }
  for (const cg of d.collection_games) {
    if (!gameIds.has(String(cg.game_id))) continue;
    stmts.push(
      repo.insertStatement(
        "collection_games",
        { ...cg, collection_id: colMap.get(String(cg.collection_id)) ?? cg.collection_id, game_id: remap(cg.game_id) },
        "ignore",
      ),
    );
  }
  // Events: skip ones already present (same time, type and game).
  const evs = await repo.driver.select<Row>(`SELECT ts, type, game_id FROM events`);
  const evKey = (e: Row) => `${e.ts}|${e.type}|${e.game_id ?? ""}`;
  const have = new Set(evs.map(evKey));
  for (const e of d.events) {
    const row: Row = { ...e, game_id: e.game_id == null ? null : remap(e.game_id) };
    if (have.has(evKey(row))) continue;
    const { id: _id, ...noId } = row;
    stmts.push(repo.insertStatement("events", noId));
  }
  // Recommendation history: same de-duplication as events.
  const recs = await repo.driver.select<Row>(`SELECT ts, kind, game_id FROM rec_events`);
  const recKey = (e: Row) => `${e.ts}|${e.kind}|${e.game_id ?? ""}`;
  const haveRec = new Set(recs.map(recKey));
  for (const e of d.rec_events ?? []) {
    const row: Row = { ...e, game_id: e.game_id == null ? null : remap(e.game_id) };
    if (haveRec.has(recKey(row))) continue;
    const { id: _rid, ...noId } = row;
    stmts.push(repo.insertStatement("rec_events", noId));
  }
  // Settings: only keys you don't have yet.
  for (const s of d.settings) stmts.push(repo.insertStatement("settings", s, "ignore"));
  stmts.push(repo.eventStatement("restore", null, { mode, from: backup.exportedAt, added, matched: m.map.size }));
  await repo.driver.batch(stmts);
  return { mode, gamesAdded: added, gamesMatched: m.map.size };
}
