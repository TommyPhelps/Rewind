import type { SqlDriver, SqlValue, Statement } from "./driver.ts";
import { BACKUP_TABLES, migrate, type BackupTable } from "./schema.ts";
import { canon } from "../lib/canon.ts";
import type { RecEvent } from "../rec/taste.ts";
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

export function rowToGame(r: Row, tags: GameTag[] = [], lengths: GameLength[] = []): Game {
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
    const [rows, tags, lengths] = await Promise.all([
      this.db.select<Row>(`SELECT * FROM games`),
      this.db.select<Row>(`SELECT game_id, tag, source FROM game_tags ORDER BY tag`),
      this.db.select<Row>(`SELECT game_id, kind, hours, source, updated_at FROM game_lengths`),
    ]);
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
    return rows.map((r) => rowToGame(r, tagMap.get(String(r.id)) ?? [], lenMap.get(String(r.id)) ?? []));
  }

  async loadGame(id: string): Promise<Game | null> {
    const rows = await this.db.select<Row>(`SELECT * FROM games WHERE id = ?`, [id]);
    if (!rows.length) return null;
    const tags = await this.db.select<Row>(`SELECT tag, source FROM game_tags WHERE game_id = ? ORDER BY tag`, [id]);
    const lengths = await this.db.select<Row>(
      `SELECT game_id, kind, hours, source, updated_at FROM game_lengths WHERE game_id = ?`,
      [id],
    );
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
    for (const f of ["multiplayer", "endless", "scale", "releaseYear", "developer", "publisher", "description"]) {
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
    for (const t of haveSet) if (!want.has(t)) stmts.push({ sql: `DELETE FROM game_tags WHERE game_id = ? AND tag = ?`, params: [gameId, t] });
    for (const t of want) if (!haveSet.has(t)) stmts.push({ sql: `INSERT INTO game_tags (game_id, tag, source) VALUES (?, ?, 'user')`, params: [gameId, t] });
    if (stmts.length) {
      stmts.push({ sql: `UPDATE games SET updated_at = ? WHERE id = ?`, params: [nowIso(), gameId] });
      await this.db.batch(stmts);
    }
  }

  async bulkTag(ids: string[], tag: string, add: boolean): Promise<void> {
    const t = normalizeTag(tag);
    if (!t || !ids.length) return;
    await this.db.batch(
      ids.map((id) =>
        add
          ? { sql: `INSERT OR IGNORE INTO game_tags (game_id, tag, source) VALUES (?, ?, 'user')`, params: [id, t] }
          : { sql: `DELETE FROM game_tags WHERE game_id = ? AND tag = ?`, params: [id, t] },
      ),
    );
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
