import type { SqlDriver, SqlValue, Statement } from "./driver.ts";
import { BACKUP_TABLES, SCHEMA_VERSION, currentVersion, migrate, type BackupTable } from "./schema.ts";
import { canon } from "../lib/canon.ts";
import type { RecEvent } from "../rec/taste.ts";
import type { MetaRecord, Provider } from "../meta/types.ts";
import type { Mark, MarkKind } from "../discover/marks.ts";
import type { CheckItem, ModEntry, ModNote, ModProfile, ModRun, NoteKind, ProfileStatus, RunStatus } from "../legacy/moddingTypes.ts";
import type {
  Collection,
  EventRow,
  Game,
  GameLength,
  GameSource,
  GameTag,
  LauncherId,
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

export function rowToSource(r: Row): GameSource {
  return {
    source: r.source as LauncherId,
    externalId: String(r.external_id ?? ""),
    title: String(r.title ?? ""),
    installed: r.installed == null ? null : Number(r.installed) === 1,
    installPath: str(r.install_path),
    launch: str(r.launch),
    method: String(r.method ?? "manual"),
    playtimeMin: num(r.playtime_min),
    lastSeenAt: str(r.last_seen_at),
    createdAt: String(r.created_at),
  };
}

/** Insert-or-update one launcher row for a game. Fields you pass as undefined keep their old value. */
export function sourceStatement(gameId: string, s: Partial<GameSource> & { source: LauncherId }, now = nowIso()): Statement {
  return {
    sql: `INSERT INTO game_sources (game_id, source, external_id, title, installed, install_path, launch, method, playtime_min, last_seen_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(game_id, source) DO UPDATE SET
            external_id = CASE WHEN excluded.external_id <> '' THEN excluded.external_id ELSE game_sources.external_id END,
            title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE game_sources.title END,
            installed = COALESCE(excluded.installed, game_sources.installed),
            install_path = COALESCE(excluded.install_path, game_sources.install_path),
            launch = COALESCE(excluded.launch, game_sources.launch),
            playtime_min = COALESCE(excluded.playtime_min, game_sources.playtime_min),
            last_seen_at = COALESCE(excluded.last_seen_at, game_sources.last_seen_at)`,
    params: [
      gameId,
      s.source,
      s.externalId ?? "",
      s.title ?? "",
      s.installed == null ? null : s.installed ? 1 : 0,
      s.installPath ?? null,
      s.launch ?? null,
      s.method ?? "manual",
      s.playtimeMin ?? null,
      s.lastSeenAt ?? null,
      now,
    ],
  };
}

export function rowToGame(r: Row, tags: GameTag[] = [], lengths: GameLength[] = [], meta: Game["meta"] = {}, sources: GameSource[] = []): Game {
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
    sources,
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

/** Encrypts stored keys (Windows DPAPI in the app). Without one, keys are stored as typed (tests, preview). */
export interface Sealer {
  seal(plain: string): Promise<string>;
  open(stored: string): Promise<string>;
}

export interface RepoOptions {
  /** Runs before an existing database is upgraded (the app copies the whole file first). */
  beforeMigrate?(from: number, to: number): Promise<void>;
  sealer?: Sealer;
}

const SEALED = "dpapi:";

export class Repo {
  private db: SqlDriver;
  private columns = new Map<string, Set<string>>();
  private initPromise: Promise<number[]> | null = null;
  private opts: RepoOptions;

  constructor(db: SqlDriver, opts: RepoOptions = {}) {
    this.db = db;
    this.opts = opts;
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
    const from = await currentVersion(this.db);
    // An existing library about to be upgraded: copy it first. If the copy fails, don't upgrade.
    if (from > 0 && from < SCHEMA_VERSION && this.opts.beforeMigrate) await this.opts.beforeMigrate(from, SCHEMA_VERSION);
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
    const [rows, tags, lengths, metas, srcs] = await Promise.all([
      this.db.select<Row>(`SELECT * FROM games`),
      this.db.select<Row>(`SELECT game_id, tag, source FROM game_tags ORDER BY tag`),
      this.db.select<Row>(`SELECT game_id, kind, hours, source, updated_at FROM game_lengths`),
      this.db.select<Row>(`SELECT * FROM game_meta`),
      this.db.select<Row>(`SELECT * FROM game_sources ORDER BY source`),
    ]);
    const srcMap = new Map<string, GameSource[]>();
    for (const r of srcs) {
      const id = String(r.game_id);
      if (!srcMap.has(id)) srcMap.set(id, []);
      srcMap.get(id)!.push(rowToSource(r));
    }
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
    return rows.map((r) => rowToGame(r, tagMap.get(String(r.id)) ?? [], lenMap.get(String(r.id)) ?? [], metaMap.get(String(r.id)) ?? {}, srcMap.get(String(r.id)) ?? []));
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
    const srcs = await this.db.select<Row>(`SELECT * FROM game_sources WHERE game_id = ? ORDER BY source`, [id]);
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
      srcs.map(rowToSource),
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

  /** "manual" = you typed it in; "timed" = REWIND timed it from Play until you pressed Stop. */
  async addSession(gameId: string, date: string, minutes: number | null, note = "", source: "manual" | "timed" = "manual"): Promise<string> {
    const id = newId();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIso();
    await this.db.batch([
      { sql: `INSERT INTO sessions (id, game_id, started_at, minutes, source, note) VALUES (?, ?, ?, ?, ?, ?)`, params: [id, gameId, day, minutes, source, note] },
      { sql: `UPDATE games SET last_played = CASE WHEN last_played IS NULL OR last_played < ? THEN ? ELSE last_played END, updated_at = ? WHERE id = ?`, params: [day, day, nowIso(), gameId] },
      this.eventStatement("session", gameId, { date: day, minutes }),
    ]);
    return id;
  }

  async loadSessions(limit = 200): Promise<{ id: string; gameId: string; date: string; minutes: number | null; note: string; source: string }[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT ?`, [limit]);
    return rows.map((r) => ({ id: String(r.id), gameId: String(r.game_id), date: String(r.started_at), minutes: num(r.minutes), note: String(r.note ?? ""), source: String(r.source ?? "manual") }));
  }

  /** Corrects a logged session (date, minutes, note). */
  async updateSession(id: string, patch: { date?: string; minutes?: number | null; note?: string }): Promise<void> {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (patch.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) throw new Error("Use a date like 2026-10-22.");
      sets.push("started_at = ?");
      params.push(patch.date);
    }
    if (patch.minutes !== undefined) {
      if (patch.minutes != null && !(patch.minutes >= 1 && patch.minutes < 24 * 60)) throw new Error("Minutes must be between 1 and 1439.");
      sets.push("minutes = ?");
      params.push(patch.minutes);
    }
    if (patch.note !== undefined) {
      sets.push("note = ?");
      params.push(patch.note.trim());
    }
    if (sets.length) await this.db.execute(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
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
    if (!r.length) return null;
    const v = String(r[0].value);
    if (!v.startsWith(SEALED)) return v; // stored by an older version; sealSecrets() encrypts it
    if (!this.opts.sealer) throw new Error("This key was encrypted by Windows and can only be read in the desktop app.");
    return this.opts.sealer.open(v);
  }

  async setSecret(key: string, value: string | null): Promise<void> {
    if (value == null || value === "") return void (await this.db.execute(`DELETE FROM secrets WHERE key = ?`, [key]));
    const stored = this.opts.sealer ? await this.opts.sealer.seal(value) : value;
    await this.db.execute(`INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, stored]);
  }

  /** Encrypts keys saved in plain text by REWIND 4 and earlier. Returns how many were sealed. */
  async sealSecrets(): Promise<number> {
    if (!this.opts.sealer) return 0;
    const rows = await this.db.select<{ key: string; value: string }>(`SELECT key, value FROM secrets`);
    let n = 0;
    for (const r of rows) {
      if (String(r.value).startsWith(SEALED)) continue;
      const sealed = await this.opts.sealer.seal(String(r.value));
      if (!sealed.startsWith(SEALED)) continue;
      await this.db.execute(`UPDATE secrets SET value = ? WHERE key = ? AND value = ?`, [sealed, r.key, r.value]);
      n++;
    }
    return n;
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

  // ---------- launchers ----------

  async setSource(gameId: string, src: Partial<GameSource> & { source: LauncherId }): Promise<void> {
    await this.db.batch([sourceStatement(gameId, src), { sql: `UPDATE games SET updated_at = ? WHERE id = ?`, params: [nowIso(), gameId] }]);
  }

  async removeSource(gameId: string, source: LauncherId): Promise<void> {
    await this.db.execute(`DELETE FROM game_sources WHERE game_id = ? AND source = ?`, [gameId, source]);
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

  // ---------- modding records (REWIND 4; kept read-only for export) ----------

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
