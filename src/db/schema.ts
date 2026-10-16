import type { SqlDriver } from "./driver.ts";

/**
 * Versioned schema. Each entry upgrades the database by one version and runs
 * inside a single transaction. Never edit a shipped migration: append a new one.
 */
export const MIGRATIONS: { version: number; name: string; sql: string[] }[] = [
  {
    version: 1,
    name: "initial library",
    sql: [
      `CREATE TABLE games (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        canon TEXT NOT NULL,
        legacy_id TEXT,
        platform TEXT NOT NULL DEFAULT 'PC',
        storefront TEXT,
        steam_app_id INTEGER,
        cover_path TEXT,
        description TEXT,
        release_year INTEGER,
        developer TEXT,
        publisher TEXT,
        ownership TEXT NOT NULL DEFAULT 'owned'
          CHECK (ownership IN ('owned','wishlist','not_owned','unknown')),
        install_status TEXT NOT NULL DEFAULT 'unknown'
          CHECK (install_status IN ('installed','not_installed','unknown')),
        status TEXT NOT NULL DEFAULT 'backlog'
          CHECK (status IN ('backlog','playing','paused','completed','dropped','replay','not_interested')),
        rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
        favorite INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        imported_playtime_min INTEGER,
        playtime_source TEXT,
        last_played TEXT,
        date_completed TEXT,
        date_dropped TEXT,
        multiplayer TEXT NOT NULL DEFAULT 'unknown'
          CHECK (multiplayer IN ('solo','solo_and_mp','coop_focused','mp_required','unknown')),
        endless INTEGER,
        rec_pref TEXT NOT NULL DEFAULT 'normal' CHECK (rec_pref IN ('normal','boost','never')),
        meta_source TEXT NOT NULL DEFAULT '{}',
        legacy_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX games_canon ON games(canon)`,
      `CREATE UNIQUE INDEX games_steam ON games(steam_app_id) WHERE steam_app_id IS NOT NULL`,
      `CREATE TABLE game_lengths (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('main','main_extras','completionist')),
        hours REAL NOT NULL CHECK (hours >= 0),
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (game_id, kind, source)
      )`,
      `CREATE TABLE game_tags (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        PRIMARY KEY (game_id, tag)
      )`,
      `CREATE INDEX game_tags_tag ON game_tags(tag)`,
      `CREATE TABLE collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE collection_games (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL,
        PRIMARY KEY (collection_id, game_id)
      )`,
      `CREATE TABLE playthroughs (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        started_at TEXT,
        ended_at TEXT,
        outcome TEXT NOT NULL DEFAULT 'in_progress'
          CHECK (outcome IN ('in_progress','paused','completed','dropped')),
        notes TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL,
        minutes INTEGER,
        source TEXT NOT NULL DEFAULT 'manual',
        note TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        game_id TEXT,
        data TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE INDEX events_ts ON events(ts)`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Tables included in backups, in insert order (parents before children). */
export const BACKUP_TABLES = [
  "games",
  "game_lengths",
  "game_tags",
  "collections",
  "collection_games",
  "playthroughs",
  "sessions",
  "events",
  "settings",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export async function currentVersion(db: SqlDriver): Promise<number> {
  await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const rows = await db.select<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
  return rows.length ? Number(rows[0].value) || 0 : 0;
}

/** Brings the database up to SCHEMA_VERSION. Returns the versions applied. */
export async function migrate(db: SqlDriver): Promise<number[]> {
  const from = await currentVersion(db);
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `This database was created by a newer REWIND (schema ${from}). Update the app before opening it.`,
    );
  }
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    await db.batch([
      ...m.sql.map((sql) => ({ sql })),
      {
        sql: `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        params: [String(m.version)],
      },
    ]);
    applied.push(m.version);
  }
  return applied;
}
