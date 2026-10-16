import type { SqlDriver, SqlValue, Statement } from "./driver.ts";
import { BACKUP_TABLES, migrate, type BackupTable } from "./schema.ts";
import { canon } from "../lib/canon.ts";
import type { RecEvent } from "../rec/taste.ts";
import type { MetaRecord, Provider } from "../meta/types.ts";
import type { Mark, MarkKind } from "../discover/marks.ts";
import type { CheckItem, ModEntry, ModNote, ModProfile, ModRun, NoteKind, ProfilePatch, ProfileStatus, RunStatus } from "../mods/companionTypes.ts";
import type {
  Collection,
  EventRow,
  Game,
  GameLength,
  GameTag,
  LengthKind,
  Status,
} from "../lib/types.ts";

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
export const todayIso = () => new Date().toISOString().slice(0, 10);

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
function json<T>(v: unknown, fallback: T): T {
  if (v == null || v === "") return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

export function rowToMeta(r: Row): MetaRecord {
  return {
    gameId: String(r.game_id),
    provider: r.provider as Provider,
    providerId: str(r.provider_id),
    status: r.status as MetaRecord["status"],
    method: str(r.method),
    confidence: num(r.confidence),
    data: json<MetaRecord["data"]>(r.data, null),
    candidates: json<MetaRecord["candidates"]>(r.candidates, []),
    rejected: json<string[]>(r.rejected, []),
    error: str(r.error),
    fetchedAt: str(r.fetched_at),
    updatedAt: String(r.updated_at),
  };
}

export function metaStatement(m: MetaRecord): Statement {
  return {
    sql: `INSERT INTO game_meta (game_id, provider, provider_id, status, method, confidence, data, candidates, rejected, error, fetched_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(game_id, provider) DO UPDATE SET provider_id = excluded.provider_id, status = excluded.status, method = excluded.method,
            confidence = excluded.confidence, data = excluded.data, candidates = excluded.candidates, rejected = excluded.rejected,
            error = excluded.error, fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`,
    params: [
      m.gameId,
      m.provider,
      m.providerId,
      m.status,
      m.method,
      m.confidence,
      m.data ? JSON.stringify(m.data) : null,
      JSON.stringify(m.candidates ?? []),
      JSON.stringify(m.rejected ?? []),
      m.error,
      m.fetchedAt,
      m.updatedAt,
    ],
  };
}

export function rowToMark(r: Row): Mark {
  return {
    key: String(r.item_key),
    kind: r.kind as MarkKind,
    title: String(r.title),
    gameId: str(r.game_id),
    snapshot: json<Record<string, unknown>>(r.snapshot, {}),
    times: Number(r.times ?? 1),
    note: String(r.note ?? ""),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function rowToGame(r: Row, tags: GameTag[] = [], lengths: GameLength[] = [], meta: Game["meta"] = {}): Game {
  return {
    id: String(r.id),
    title: String(r.title),
    canon: String(r.canon),
    legacyId: str(r.legacy_id),
    platform: String(r.platform ?? "PC"),
    storefront: str(r.storefront),
    steamAppId: num(r.steam_app_id),
    coverPath: str(r.cover_path),
    description: str(r.description),
    releaseYear: num(r.release_year),
    developer: str(r.developer),
    publisher: str(r.publisher),
    ownership: (r.ownership as Game["ownership"]) ?? "unknown",
    installStatus: (r.install_status as Game["installStatus"]) ?? "unknown",
    status: (r.status as Status) ?? "backlog",
    rating: num(r.rating),
    favorite: Number(r.favorite) === 1,
    notes: String(r.notes ?? ""),
    importedPlaytimeMin: num(r.imported_playtime_min),
    playtimeSource: str(r.playtime_source),
    steamPlaytimeMin: num(r.steam_playtime_min),
    steamLastPlayed: str(r.steam_last_played),
    steamSyncedAt: str(r.steam_synced_at),
    lastPlayed: str(r.last_played),
    dateCompleted: str(r.date_completed),
    dateDropped: str(r.date_dropped),
    multiplayer: (r.multiplayer as Game["multiplayer"]) ?? "unknown",
    endless: r.endless == null ? null : Number(r.endless) === 1,
    scale: (r.scale as Game["scale"]) ?? null,
    refVersion: num(r.ref_version),
    recPref: (r.rec_pref as Game["recPref"]) ?? "normal",
    metaSource: json<Record<string, string>>(r.meta_source, {}),
    legacy: json<Record<string, unknown> | null>(r.legacy_json, null),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    tags,
    lengths,
    meta,
  };
}

/** Editable game fields and the column each one maps to. */
const FIELD_COLUMNS = {
  title: "title",
  platform: "platform",
  storefront: "storefront",
  steamAppId: "steam_app_id",
  coverPath: "cover_path",
  description: "description",
  releaseYear: "release_year",
  developer: "developer",
  publisher: "publisher",
  ownership: "ownership",
  installStatus: "install_status",
  status: "status",
  rating: "rating",
  favorite: "favorite",
  notes: "notes",
  lastPlayed: "last_played",
  dateCompleted: "date_completed",
  dateDropped: "date_dropped",
  multiplayer: "multiplayer",
  endless: "endless",
  scale: "scale",
  recPref: "rec_pref",
} as const;
export type GamePatch = Partial<Pick<Game, keyof typeof FIELD_COLUMNS>>;

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return String(v);
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
}

export class Repo {
  private db: SqlDriver;
  private columns = new Map<string, Set<string>>();
  private initPromise: Promise<number[]> | null = null;

  constructor(db: SqlDriver) {
    this.db = db;
  }

  get driver(): SqlDriver {
    return this.db;
  }

  /** Safe to call more than once: every caller shares the same run. */
  init(): Promise<number[]> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<number[]> {
    const applied = await migrate(this.db);
    for (const t of BACKUP_TABLES) {
      const cols = await this.db.select<{ name: string }>(`PRAGMA table_info(${t})`);
      this.columns.set(t, new Set(cols.map((c) => c.name)));
    }
    return applied;
  }

  /** Column whitelist for a table; protects INSERTs built from backup files. */
  columnsOf(table: BackupTable): Set<string> {
    const c = this.columns.get(table);
    if (!c) throw new Error(`Unknown table ${table}`);
    return c;
  }

  insertStatement(table: BackupTable, row: Row, mode: "insert" | "ignore" | "replace" = "insert"): Statement {
    const allowed = this.columnsOf(table);
    const keys = Object.keys(row).filter((k) => allowed.has(k));
    const verb = mode === "ignore" ? "INSERT OR IGNORE" : mode === "replace" ? "INSERT OR REPLACE" : "INSERT";
    return {
      sql: `${verb} INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      params: keys.map((k) => toSql(row[k])),
    };
  }

  async countGames(): Promise<number> {
    const r = await this.db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM games`);
    return Number(r[0]?.n ?? 0);
  }

  // ---------- games ----------

  async loadGames(): Promise<Game[]> {
    const [rows, tags, lengths, metas] = await Promise.all([
      this.db.select<Row>(`SELECT * FROM games`),
      this.db.select<Row>(`SELECT game_id, tag, source FROM game_tags ORDER BY tag`),
      this.db.select<Row>(`SELECT game_id, kind, hours, source, updated_at FROM game_lengths`),
      this.db.select<Row>(`SELECT * FROM game_meta`),
    ]);
    const metaMap = new Map<string, Game["meta"]>();
    for (const m of metas) {
      const rec = rowToMeta(m);
      const cur = metaMap.get(rec.gameId) ?? {};
      cur[rec.provider] = rec;
      metaMap.set(rec.gameId, cur);
    }
    const tagMap = new Map<string, GameTag[]>();
    for (const t of tags) {
      const id = String(t.game_id);
      if (!tagMap.has(id)) tagMap.set(id, []);
      tagMap.get(id)!.push({ tag: String(t.tag), source: String(t.source) });
    }
    const lenMap = new Map<string, GameLength[]>();
    for (const l of lengths) {
      const id = String(l.game_id);
      if (!lenMap.has(id)) lenMap.set(id, []);
      lenMap.get(id)!.push({
        gameId: id,
        kind: l.kind as LengthKind,
        hours: Number(l.hours),
        source: String(l.source),
        updatedAt: String(l.updated_at),
      });
    }
    return rows.map((r) => rowToGame(r, tagMap.get(String(r.id)) ?? [], lenMap.get(String(r.id)) ?? [], metaMap.get(String(r.id)) ?? {}));
  }

  async loadGame(id: string): Promise<Game | null> {
    const rows = await this.db.select<Row>(`SELECT * FROM games WHERE id = ?`, [id]);
    if (!rows.length) return null;
    const tags = await this.db.select<Row>(`SELECT tag, source FROM game_tags WHERE game_id = ? ORDER BY tag`, [id]);
    const lengths = await this.db.select<Row>(
      `SELECT game_id, kind, hours, source, updated_at FROM game_lengths WHERE game_id = ?`,
      [id],
    );
    const metas = await this.db.select<Row>(`SELECT * FROM game_meta WHERE game_id = ?`, [id]);
    const meta: Game["meta"] = {};
    for (const m of metas) {
      const rec = rowToMeta(m);
      meta[rec.provider] = rec;
    }
    return rowToGame(
      rows[0],
      tags.map((t) => ({ tag: String(t.tag), source: String(t.source) })),
      lengths.map((l) => ({
        gameId: id,
        kind: l.kind as LengthKind,
        hours: Number(l.hours),
        source: String(l.source),
        updatedAt: String(l.updated_at),
      })),
      meta,
    );
  }

  async findByCanon(title: string): Promise<{ id: string; title: string }[]> {
    return this.db.select(`SELECT id, title FROM games WHERE canon = ?`, [canon(title)]);
  }

  async addGame(input: { title: string } & GamePatch & { tags?: string[] }): Promise<Game> {
    const id = newId();
    const t = nowIso();
    const title = input.title.trim();
    if (!title) throw new Error("A title is required.");
    const row: Row = {
      id,
      title,
      canon: canon(title),
      created_at: t,
      updated_at: t,
      meta_source: "{}",
    };
    for (const [field, col] of Object.entries(FIELD_COLUMNS)) {
      const v = (input as Record<string, unknown>)[field];
      if (v !== undefined && field !== "title") row[col] = v;
    }
    const stmts: Statement[] = [this.insertStatement("games", row)];
    for (const tag of new Set((input.tags ?? []).map(normalizeTag).filter(Boolean))) {
      stmts.push({ sql: `INSERT INTO game_tags (game_id, tag, source) VALUES (?, ?, 'user')`, params: [id, tag] });
    }
    stmts.push(this.eventStatement("game_added", id, { title }));
    await this.db.batch(stmts);
    return (await this.loadGame(id))!;
  }

  /** Builds the statements for a patch, including status side effects and an activity event. */
  private patchStatements(before: Game, patch: GamePatch): Statement[] {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    const p: GamePatch = { ...patch };
    if (p.title !== undefined) {
      p.title = p.title.trim() || before.title;
    }
    if (p.status && p.status !== before.status) {
      if (p.status === "completed" && !before.dateCompleted && p.dateCompleted === undefined) p.dateCompleted = todayIso();
      if (p.status === "dropped" && !before.dateDropped && p.dateDropped === undefined) p.dateDropped = todayIso();
    }
    for (const [field, value] of Object.entries(p)) {
      const col = FIELD_COLUMNS[field as keyof typeof FIELD_COLUMNS];
      if (!col) continue;
      sets.push(`${col} = ?`);
      params.push(toSql(value));
    }
    if (p.title !== undefined) {
      sets.push(`canon = ?`);
      params.push(canon(p.title));
    }
    if (!sets.length) return [];
    // Hand-edited metadata becomes the user's value.
    const ms = { ...before.metaSource };
    for (const f of ["multiplayer", "endless", "scale", "releaseYear", "developer", "publisher", "description", "coverPath"]) {
      if ((p as Record<string, unknown>)[f] !== undefined) ms[f] = "user";
    }
    sets.push(`meta_source = ?`, `updated_at = ?`);
    params.push(JSON.stringify(ms), nowIso());
    const out: Statement[] = [{ sql: `UPDATE games SET ${sets.join(", ")} WHERE id = ?`, params: [...params, before.id] }];
    if (p.status && p.status !== before.status) {
      out.push(this.eventStatement("status", before.id, { from: before.status, to: p.status }));
    }
    if (p.rating !== undefined && p.rating !== before.rating) {
      out.push(this.eventStatement("rating", before.id, { from: before.rating, to: p.rating }));
    }
    return out;
  }

  async updateGame(id: string, patch: GamePatch): Promise<Game> {
    const before = await this.loadGame(id);
    if (!before) throw new Error("That game no longer exists.");
    const stmts = this.patchStatements(before, patch);
    if (stmts.length) await this.db.batch(stmts);
    return (await this.loadGame(id))!;
  }

  async bulkUpdate(ids: string[], patch: GamePatch): Promise<void> {
    const stmts: Statement[] = [];
    for (const id of ids) {
      const g = await this.loadGame(id);
      if (g) stmts.push(...this.patchStatements(g, patch));
    }
    if (stmts.length) await this.db.batch(stmts);
  }

  async deleteGames(ids: string[]): Promise<void> {
    const stmts: Statement[] = [];
    for (const id of ids) {
      for (const t of ["game_lengths", "game_tags", "collection_games", "playthroughs", "sessions"]) {
        stmts.push({ sql: `DELETE FROM ${t} WHERE game_id = ?`, params: [id] });
      }
      stmts.push({ sql: `DELETE FROM games WHERE id = ?`, params: [id] });
    }
    if (stmts.length) await this.db.batch(stmts);
  }

  // ---------- lengths ----------

  async setUserLength(gameId: string, kind: LengthKind, hours: number | null): Promise<void> {
    const stmts: Statement[] = [
      { sql: `DELETE FROM game_lengths WHERE game_id = ? AND kind = ? AND source = 'user'`, params: [gameId, kind] },
    ];
    if (hours != null && Number.isFinite(hours) && hours >= 0) {
      stmts.push({
        sql: `INSERT INTO game_lengths (game_id, kind, hours, source, updated_at) VALUES (?, ?, ?, 'user', ?)`,
        params: [gameId, kind, Math.round(hours * 10) / 10, nowIso()],
      });
    }
    stmts.push({ sql: `UPDATE games SET updated_at = ? WHERE id = ?`, params: [nowIso(), gameId] });
    await this.db.batch(stmts);
  }

  // ---------- tags ----------

  async setTags(gameId: string, tags: string[]): Promise<void> {
    const want = new Set(tags.map(normalizeTag).filter(Boolean));
    const have = await this.db.select<{ tag: string }>(`SELECT tag FROM game_tags WHERE game_id = ?`, [gameId]);
    const haveSet = new Set(have.map((h) => h.tag));
    const stmts: Statement[] = [];
    const removed: string[] = [];
    for (const t of haveSet)
      if (!want.has(t)) {
        stmts.push({ sql: `DELETE FROM game_tags WHERE game_id = ? AND tag = ?`, params: [gameId, t] });
        removed.push(t);
      }
    const added: string[] = [];
    for (const t of want)
      if (!haveSet.has(t)) {
        stmts.push({ sql: `INSERT INTO game_tags (game_id, tag, source) VALUES (?, ?, 'user')`, params: [gameId, t] });
        added.push(t);
      }
    if (stmts.length) {
      stmts.push(await this.hiddenTagsStatement(gameId, removed, added));
      await this.db.batch(stmts);
    }
  }

  /**
   * Tags you remove are remembered, so a later metadata sync doesn't quietly put them back.
   * Adding a tag yourself takes it off that list again.
   */
  private async hiddenTagsStatement(gameId: string, removed: string[], added: string[]): Promise<Statement> {
    const r = await this.db.select<Row>(`SELECT meta_source FROM games WHERE id = ?`, [gameId]);
    const ms = json<Record<string, string>>(r[0]?.meta_source, {});
    const hidden = new Set((ms.hiddenTags ?? "").split(",").filter(Boolean));
    for (const t of removed) hidden.add(t);
    for (const t of added) hidden.delete(t);
    if (hidden.size) ms.hiddenTags = [...hidden].join(",");
    else delete ms.hiddenTags;
    return { sql: `UPDATE games SET meta_source = ?, updated_at = ? WHERE id = ?`, params: [JSON.stringify(ms), nowIso(), gameId] };
  }

  async bulkTag(ids: string[], tag: string, add: boolean): Promise<void> {
    const t = normalizeTag(tag);
    if (!t || !ids.length) return;
    const stmts: Statement[] = [];
    for (const id of ids) {
      stmts.push(
        add
          ? { sql: `INSERT OR IGNORE INTO game_tags (game_id, tag, source) VALUES (?, ?, 'user')`, params: [id, t] }
          : { sql: `DELETE FROM game_tags WHERE game_id = ? AND tag = ?`, params: [id, t] },
      );
      stmts.push(await this.hiddenTagsStatement(id, add ? [] : [t], add ? [t] : []));
    }
    await this.db.batch(stmts);
  }

  // ---------- collections ----------

  async loadCollections(): Promise<Collection[]> {
    const cols = await this.db.select<Row>(`SELECT * FROM collections ORDER BY sort_order, name`);
    const members = await this.db.select<Row>(`SELECT collection_id, game_id FROM collection_games ORDER BY position, added_at`);
    const m = new Map<string, string[]>();
    for (const r of members) {
      const k = String(r.collection_id);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(String(r.game_id));
    }
    return cols.map((c) => ({
      id: String(c.id),
      name: String(c.name),
      description: String(c.description ?? ""),
      sortOrder: Number(c.sort_order ?? 0),
      createdAt: String(c.created_at),
      gameIds: m.get(String(c.id)) ?? [],
    }));
  }

  async createCollection(name: string, description = ""): Promise<string> {
    const n = name.trim();
    if (!n) throw new Error("Give the collection a name.");
    const existing = await this.db.select(`SELECT id FROM collections WHERE name = ? COLLATE NOCASE`, [n]);
    if (existing.length) throw new Error(`A collection named "${n}" already exists.`);
    const id = newId();
    const order = await this.db.select<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM collections`);
    await this.db.execute(
      `INSERT INTO collections (id, name, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, n, description, Number(order[0]?.m ?? 0) + 1, nowIso()],
    );
    return id;
  }

  async updateCollection(id: string, patch: { name?: string; description?: string }): Promise<void> {
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) throw new Error("Give the collection a name.");
      const clash = await this.db.select(`SELECT id FROM collections WHERE name = ? COLLATE NOCASE AND id <> ?`, [n, id]);
      if (clash.length) throw new Error(`A collection named "${n}" already exists.`);
      await this.db.execute(`UPDATE collections SET name = ? WHERE id = ?`, [n, id]);
    }
    if (patch.description !== undefined) {
      await this.db.execute(`UPDATE collections SET description = ? WHERE id = ?`, [patch.description, id]);
    }
  }

  async deleteCollection(id: string): Promise<void> {
    await this.db.batch([
      { sql: `DELETE FROM collection_games WHERE collection_id = ?`, params: [id] },
      { sql: `DELETE FROM collections WHERE id = ?`, params: [id] },
    ]);
  }

  async addToCollection(collectionId: string, gameIds: string[]): Promise<number> {
    const max = await this.db.select<{ m: number | null }>(
      `SELECT MAX(position) AS m FROM collection_games WHERE collection_id = ?`,
      [collectionId],
    );
    let pos = Number(max[0]?.m ?? -1);
    const t = nowIso();
    return this.db.batch(
      gameIds.map((g) => ({
        sql: `INSERT OR IGNORE INTO collection_games (collection_id, game_id, position, added_at) VALUES (?, ?, ?, ?)`,
        params: [collectionId, g, ++pos, t],
      })),
    );
  }

  async removeFromCollection(collectionId: string, gameIds: string[]): Promise<void> {
    await this.db.batch(
      gameIds.map((g) => ({ sql: `DELETE FROM collection_games WHERE collection_id = ? AND game_id = ?`, params: [collectionId, g] })),
    );
  }

  /** Rewrites positions to match the given order. */
  async reorderCollection(collectionId: string, orderedGameIds: string[]): Promise<void> {
    await this.db.batch(
      orderedGameIds.map((g, i) => ({
        sql: `UPDATE collection_games SET position = ? WHERE collection_id = ? AND game_id = ?`,
        params: [i, collectionId, g],
      })),
    );
  }

  /** Moves games from one collection to the end of another, in one step. */
  async moveBetweenCollections(fromId: string, toId: string, gameIds: string[]): Promise<void> {
    const max = await this.db.select<{ m: number | null }>(`SELECT MAX(position) AS m FROM collection_games WHERE collection_id = ?`, [toId]);
    let pos = Number(max[0]?.m ?? -1);
    const t = nowIso();
    const stmts: Statement[] = [];
    for (const g of gameIds) {
      stmts.push({ sql: `DELETE FROM collection_games WHERE collection_id = ? AND game_id = ?`, params: [fromId, g] });
      stmts.push({ sql: `INSERT OR IGNORE INTO collection_games (collection_id, game_id, position, added_at) VALUES (?, ?, ?, ?)`, params: [toId, g, ++pos, t] });
    }
    await this.db.batch(stmts);
  }

  // ---------- play sessions (only what you log) ----------

  async addSession(gameId: string, date: string, minutes: number | null, note = ""): Promise<string> {
    const id = newId();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIso();
    await this.db.batch([
      { sql: `INSERT INTO sessions (id, game_id, started_at, minutes, source, note) VALUES (?, ?, ?, ?, 'manual', ?)`, params: [id, gameId, day, minutes, note] },
      { sql: `UPDATE games SET last_played = CASE WHEN last_played IS NULL OR last_played < ? THEN ? ELSE last_played END, updated_at = ? WHERE id = ?`, params: [day, day, nowIso(), gameId] },
      this.eventStatement("session", gameId, { date: day, minutes }),
    ]);
    return id;
  }

  async loadSessions(limit = 200): Promise<{ id: string; gameId: string; date: string; minutes: number | null; note: string }[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT ?`, [limit]);
    return rows.map((r) => ({ id: String(r.id), gameId: String(r.game_id), date: String(r.started_at), minutes: num(r.minutes), note: String(r.note ?? "") }));
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM sessions WHERE id = ?`, [id]);
  }

  // ---------- settings ----------

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const r = await this.db.select<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key]);
    if (!r.length) return fallback;
    return json<T>(r[0].value, fallback);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.execute(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }

  // ---------- secrets (API keys; never in backups) ----------

  async getSecret(key: string): Promise<string | null> {
    const r = await this.db.select<{ value: string }>(`SELECT value FROM secrets WHERE key = ?`, [key]);
    return r.length ? String(r[0].value) : null;
  }

  async setSecret(key: string, value: string | null): Promise<void> {
    if (value == null || value === "") await this.db.execute(`DELETE FROM secrets WHERE key = ?`, [key]);
    else await this.db.execute(`INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  }

  // ---------- re-downloadable lookups ----------

  async getCache<T>(key: string, maxAgeDays: number): Promise<T | null> {
    const r = await this.db.select<Row>(`SELECT value, fetched_at FROM http_cache WHERE key = ?`, [key]);
    if (!r.length) return null;
    const age = (Date.now() - Date.parse(String(r[0].fetched_at))) / 86_400_000;
    if (!(age <= maxAgeDays)) return null;
    return json<T | null>(r[0].value, null);
  }

  /** A cached lookup of any age, with when it was fetched (for "as of" labels and offline use). */
  async getCacheEntry<T>(key: string): Promise<{ value: T; fetchedAt: string } | null> {
    const r = await this.db.select<Row>(`SELECT value, fetched_at FROM http_cache WHERE key = ?`, [key]);
    if (!r.length) return null;
    const value = json<T | null>(r[0].value, null);
    return value == null ? null : { value, fetchedAt: String(r[0].fetched_at) };
  }

  async setCache(key: string, value: unknown): Promise<void> {
    await this.db.execute(
      `INSERT INTO http_cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
      [key, JSON.stringify(value), nowIso()],
    );
  }

  // ---------- outside metadata ----------

  async loadMeta(provider?: Provider): Promise<MetaRecord[]> {
    const rows = provider
      ? await this.db.select<Row>(`SELECT * FROM game_meta WHERE provider = ?`, [provider])
      : await this.db.select<Row>(`SELECT * FROM game_meta`);
    return rows.map(rowToMeta);
  }

  async saveMeta(records: MetaRecord[], extra: Statement[] = []): Promise<void> {
    if (!records.length && !extra.length) return;
    await this.db.batch([...records.map(metaStatement), ...extra]);
  }

  /** Runs several statements as one all-or-nothing transaction. */
  async batch(stmts: Statement[]): Promise<void> {
    if (stmts.length) await this.db.batch(stmts);
  }

  async deleteMeta(gameId: string, provider: Provider): Promise<void> {
    await this.db.execute(`DELETE FROM game_meta WHERE game_id = ? AND provider = ?`, [gameId, provider]);
  }

  // ---------- activity ----------

  eventStatement(type: string, gameId: string | null, data: Record<string, unknown> = {}, ts = nowIso()): Statement {
    return {
      sql: `INSERT INTO events (ts, type, game_id, data) VALUES (?, ?, ?, ?)`,
      params: [ts, type, gameId, JSON.stringify(data)],
    };
  }

  async recentEvents(limit = 50): Promise<EventRow[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM events ORDER BY ts DESC, id DESC LIMIT ?`, [limit]);
    return rows.map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      type: String(r.type),
      gameId: str(r.game_id),
      data: json<Record<string, unknown>>(r.data, {}),
    }));
  }

  // ---------- recommendation history ----------

  async addRecEvent(kind: string, gameId: string | null, reason: string | null = null, context: Record<string, unknown> = {}, ts = nowIso()): Promise<void> {
    await this.db.execute(`INSERT INTO rec_events (ts, kind, game_id, reason, context) VALUES (?, ?, ?, ?, ?)`, [
      ts,
      kind,
      gameId,
      reason,
      JSON.stringify(context),
    ]);
  }

  async loadRecEvents(sinceIso = "1970-01-01"): Promise<RecEvent[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM rec_events WHERE ts >= ? ORDER BY ts, id`, [sinceIso]);
    return rows.map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      kind: String(r.kind),
      gameId: str(r.game_id),
      reason: str(r.reason),
      context: json<Record<string, unknown>>(r.context, {}),
    }));
  }

  // ---------- Discover answers ----------

  async loadMarks(): Promise<Mark[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM discover_marks ORDER BY updated_at DESC`);
    return rows.map(rowToMark);
  }

  /**
   * Records your answer to a suggestion. Saying the same thing again counts up (a second
   * "Not interested" hides it for longer); a different answer replaces the old one.
   * Also logged in the recommendation history so Pick for me can use it.
   */
  async setMark(input: { key: string; kind: MarkKind; title: string; gameId?: string | null; snapshot?: Record<string, unknown>; note?: string }): Promise<Mark> {
    const now = nowIso();
    const cur = (await this.db.select<Row>(`SELECT * FROM discover_marks WHERE item_key = ?`, [input.key]))[0];
    const times = cur && cur.kind === input.kind ? Number(cur.times) + 1 : 1;
    const snapshot = input.snapshot ?? (cur ? json<Record<string, unknown>>(cur.snapshot, {}) : {});
    await this.db.batch([
      {
        sql: `INSERT INTO discover_marks (item_key, kind, title, game_id, snapshot, times, note, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(item_key) DO UPDATE SET kind = excluded.kind, title = excluded.title, game_id = excluded.game_id,
                snapshot = excluded.snapshot, times = excluded.times, note = excluded.note, updated_at = excluded.updated_at`,
        params: [input.key, input.kind, input.title, input.gameId ?? null, JSON.stringify(snapshot), times, input.note ?? (cur ? String(cur.note ?? "") : ""), cur ? String(cur.created_at) : now, now],
      },
      {
        sql: `INSERT INTO rec_events (ts, kind, game_id, reason, context) VALUES (?, ?, ?, ?, ?)`,
        params: [now, "discover", input.gameId ?? null, input.kind, JSON.stringify({ key: input.key, title: input.title })],
      },
      // A "Not interested" on a library game also counts as a pass in Pick for me (it fades the same way).
      ...(input.kind === "not_interested" && input.gameId
        ? [{ sql: `INSERT INTO rec_events (ts, kind, game_id, reason, context) VALUES (?, ?, ?, ?, ?)`, params: [now, "pass", input.gameId, "not_interested", JSON.stringify({ from: "discover" })] }]
        : []),
    ]);
    return rowToMark((await this.db.select<Row>(`SELECT * FROM discover_marks WHERE item_key = ?`, [input.key]))[0]);
  }

  async updateMarkSnapshot(key: string, snapshot: Record<string, unknown>): Promise<void> {
    await this.db.execute(`UPDATE discover_marks SET snapshot = ? WHERE item_key = ?`, [JSON.stringify(snapshot), key]);
  }

  async clearMark(key: string): Promise<void> {
    const cur = (await this.db.select<Row>(`SELECT * FROM discover_marks WHERE item_key = ?`, [key]))[0];
    if (!cur) return;
    await this.db.batch([
      { sql: `DELETE FROM discover_marks WHERE item_key = ?`, params: [key] },
      {
        sql: `INSERT INTO rec_events (ts, kind, game_id, reason, context) VALUES (?, ?, ?, ?, ?)`,
        params: [nowIso(), "discover", str(cur.game_id), "cleared", JSON.stringify({ key, was: cur.kind })],
      },
    ]);
  }

  // ---------- modding companion ----------

  async loadModProfiles(): Promise<ModProfile[]> {
    const [ps, es, ns, cs, rs] = await Promise.all([
      this.db.select<Row>(`SELECT * FROM mod_profiles ORDER BY sort_order, created_at`),
      this.db.select<Row>(`SELECT * FROM mod_entries ORDER BY position, added_at`),
      this.db.select<Row>(`SELECT * FROM mod_notes ORDER BY created_at`),
      this.db.select<Row>(`SELECT * FROM mod_checklist ORDER BY position`),
      this.db.select<Row>(`SELECT * FROM mod_runs ORDER BY COALESCE(started_at, '9999')`),
    ]);
    const group = <T extends { profileId: string }>(xs: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of xs) (m.get(x.profileId) ?? m.set(x.profileId, []).get(x.profileId)!).push(x);
      return m;
    };
    const entries = group(es.map((r): ModEntry => ({ id: String(r.id), profileId: String(r.profile_id), position: Number(r.position), name: String(r.name), url: String(r.url ?? ""), version: String(r.version ?? ""), category: String(r.category ?? ""), enabled: Number(r.enabled) === 1, notes: String(r.notes ?? ""), addedAt: String(r.added_at) })));
    const notes = group(ns.map((r): ModNote => ({ id: String(r.id), profileId: String(r.profile_id), kind: r.kind as NoteKind, title: String(r.title ?? ""), body: String(r.body ?? ""), mods: json<string[]>(r.mods, []), sourceUrl: String(r.source_url ?? ""), status: r.status === "resolved" ? "resolved" : "open", createdAt: String(r.created_at), updatedAt: String(r.updated_at) })));
    const checks = group(cs.map((r): CheckItem => ({ id: String(r.id), profileId: String(r.profile_id), position: Number(r.position), text: String(r.text), doneAt: str(r.done_at) })));
    const runs = group(rs.map((r): ModRun => ({ id: String(r.id), profileId: String(r.profile_id), name: String(r.name ?? ""), startedAt: str(r.started_at), endedAt: str(r.ended_at), status: r.status as RunStatus, notes: String(r.notes ?? "") })));
    return ps.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      gameKey: String(r.game_key ?? "other"),
      gameId: str(r.game_id),
      gameTitle: String(r.game_title ?? ""),
      manager: String(r.manager ?? ""),
      gameVersion: String(r.game_version ?? ""),
      status: r.status as ProfileStatus,
      packKey: str(r.pack_key),
      notes: String(r.notes ?? ""),
      sortOrder: Number(r.sort_order ?? 0),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      entries: entries.get(String(r.id)) ?? [],
      modNotes: notes.get(String(r.id)) ?? [],
      checklist: checks.get(String(r.id)) ?? [],
      runs: runs.get(String(r.id)) ?? [],
    }));
  }

  async createModProfile(p: { name: string; gameKey: string; gameId?: string | null; gameTitle?: string; manager?: string; packKey?: string | null; checklist?: string[]; entries?: { name: string; url?: string; version?: string; category?: string; enabled?: boolean }[] }): Promise<string> {
    const id = newId();
    const now = nowIso();
    const order = Number((await this.db.select<Row>(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM mod_profiles`))[0]?.n ?? 0);
    const stmts: Statement[] = [
      {
        sql: `INSERT INTO mod_profiles (id, name, game_key, game_id, game_title, manager, pack_key, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, p.name.trim() || "New profile", p.gameKey, p.gameId ?? null, p.gameTitle ?? "", p.manager ?? "", p.packKey ?? null, order, now, now],
      },
      ...(p.checklist ?? []).map((text, i) => ({ sql: `INSERT INTO mod_checklist (id, profile_id, position, text) VALUES (?, ?, ?, ?)`, params: [newId(), id, i, text] as SqlValue[] })),
      ...this.entryStatements(id, p.entries ?? [], 0, now),
      this.eventStatement("mod_profile_created", p.gameId ?? null, { name: p.name, game: p.gameKey }),
    ];
    await this.db.batch(stmts);
    return id;
  }

  private entryStatements(profileId: string, entries: { name: string; url?: string; version?: string; category?: string; enabled?: boolean; notes?: string }[], start: number, now = nowIso()): Statement[] {
    return entries.map((e, i) => ({
      sql: `INSERT INTO mod_entries (id, profile_id, position, name, url, version, category, enabled, notes, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [newId(), profileId, start + i, e.name.slice(0, 300), (e.url ?? "").slice(0, 600), (e.version ?? "").slice(0, 80), (e.category ?? "").slice(0, 60), e.enabled === false ? 0 : 1, e.notes ?? "", now],
    }));
  }

  async updateModProfile(id: string, patch: ProfilePatch): Promise<void> {
    const cols: Record<keyof ProfilePatch, string> = { name: "name", gameKey: "game_key", gameId: "game_id", gameTitle: "game_title", manager: "manager", gameVersion: "game_version", status: "status", packKey: "pack_key", notes: "notes", sortOrder: "sort_order" };
    const keys = (Object.keys(patch) as (keyof ProfilePatch)[]).filter((k) => k in cols);
    if (!keys.length) return;
    await this.db.execute(`UPDATE mod_profiles SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => toSql(patch[k])), nowIso(), id]);
  }

  async deleteModProfile(id: string): Promise<void> {
    const p = (await this.db.select<Row>(`SELECT name, game_id FROM mod_profiles WHERE id = ?`, [id]))[0];
    if (!p) return;
    await this.db.batch([{ sql: `DELETE FROM mod_profiles WHERE id = ?`, params: [id] }, this.eventStatement("mod_profile_deleted", str(p.game_id), { name: p.name })]);
  }

  /** Adds mods at the end of a profile's list. Returns how many were added. */
  async addModEntries(profileId: string, entries: { name: string; url?: string; version?: string; category?: string; enabled?: boolean; notes?: string }[]): Promise<number> {
    const clean = entries.filter((e) => e.name.trim());
    if (!clean.length) return 0;
    const start = Number((await this.db.select<Row>(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM mod_entries WHERE profile_id = ?`, [profileId]))[0]?.n ?? 0);
    await this.db.batch([...this.entryStatements(profileId, clean, start), { sql: `UPDATE mod_profiles SET updated_at = ? WHERE id = ?`, params: [nowIso(), profileId] }]);
    return clean.length;
  }

  async updateModEntry(id: string, patch: Partial<Pick<ModEntry, "name" | "url" | "version" | "category" | "enabled" | "notes">>): Promise<void> {
    const cols = { name: "name", url: "url", version: "version", category: "category", enabled: "enabled", notes: "notes" } as const;
    const keys = (Object.keys(patch) as (keyof typeof cols)[]).filter((k) => k in cols);
    if (!keys.length) return;
    await this.db.execute(`UPDATE mod_entries SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => toSql(patch[k])), id]);
  }

  async deleteModEntries(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db.batch(ids.map((id) => ({ sql: `DELETE FROM mod_entries WHERE id = ?`, params: [id] })));
  }

  async reorderModEntries(profileId: string, orderedIds: string[]): Promise<void> {
    await this.db.batch(orderedIds.map((id, i) => ({ sql: `UPDATE mod_entries SET position = ? WHERE id = ? AND profile_id = ?`, params: [i, id, profileId] })));
  }

  async saveModNote(n: Partial<ModNote> & { profileId: string }): Promise<string> {
    const now = nowIso();
    const id = n.id ?? newId();
    await this.db.execute(
      `INSERT INTO mod_notes (id, profile_id, kind, title, body, mods, source_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, body = excluded.body, mods = excluded.mods,
         source_url = excluded.source_url, status = excluded.status, updated_at = excluded.updated_at`,
      [id, n.profileId, n.kind ?? "compat", n.title ?? "", n.body ?? "", JSON.stringify(n.mods ?? []), n.sourceUrl ?? "", n.status ?? "open", n.createdAt ?? now, now],
    );
    return id;
  }

  async deleteModNote(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM mod_notes WHERE id = ?`, [id]);
  }

  async addCheckItems(profileId: string, texts: string[]): Promise<void> {
    const clean = texts.map((t) => t.trim()).filter(Boolean);
    if (!clean.length) return;
    const start = Number((await this.db.select<Row>(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM mod_checklist WHERE profile_id = ?`, [profileId]))[0]?.n ?? 0);
    await this.db.batch(clean.map((text, i) => ({ sql: `INSERT INTO mod_checklist (id, profile_id, position, text) VALUES (?, ?, ?, ?)`, params: [newId(), profileId, start + i, text] })));
  }

  async setCheckDone(id: string, done: boolean): Promise<void> {
    await this.db.execute(`UPDATE mod_checklist SET done_at = ? WHERE id = ?`, [done ? nowIso() : null, id]);
  }

  async updateCheckText(id: string, text: string): Promise<void> {
    await this.db.execute(`UPDATE mod_checklist SET text = ? WHERE id = ?`, [text, id]);
  }

  async deleteCheckItem(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM mod_checklist WHERE id = ?`, [id]);
  }

  /** Unticks every item, for the next time you change your setup. */
  async resetChecklist(profileId: string): Promise<void> {
    await this.db.execute(`UPDATE mod_checklist SET done_at = NULL WHERE profile_id = ?`, [profileId]);
  }

  async saveModRun(r: Partial<ModRun> & { profileId: string }): Promise<string> {
    const id = r.id ?? newId();
    await this.db.execute(
      `INSERT INTO mod_runs (id, profile_id, name, started_at, ended_at, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, started_at = excluded.started_at, ended_at = excluded.ended_at,
         status = excluded.status, notes = excluded.notes`,
      [id, r.profileId, r.name ?? "", r.startedAt ?? null, r.endedAt ?? null, r.status ?? "active", r.notes ?? ""],
    );
    return id;
  }

  async deleteModRun(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM mod_runs WHERE id = ?`, [id]);
  }

  // ---------- backup support ----------

  async dumpTables(): Promise<Record<BackupTable, Row[]>> {
    const out = {} as Record<BackupTable, Row[]>;
    for (const t of BACKUP_TABLES) out[t] = await this.db.select<Row>(`SELECT * FROM ${t}`);
    return out;
  }

  /** Deletes every user row (children first). Only used inside a confirmed replace. */
  wipeStatements(): Statement[] {
    return [...BACKUP_TABLES].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
  }
}
