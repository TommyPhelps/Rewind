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
  {
    version: 2,
    name: "recommendations",
    sql: [
      // Coarse length class: 'short' | 'medium' | 'long' | 'endless'. Source kept in meta_source.scale.
      `ALTER TABLE games ADD COLUMN scale TEXT`,
      // Which version of the bundled reference data has been offered to this game (never re-applied).
      `ALTER TABLE games ADD COLUMN ref_version INTEGER`,
      `CREATE TABLE rec_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        game_id TEXT,
        reason TEXT,
        context TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE INDEX rec_events_game ON rec_events(game_id, ts)`,
      `CREATE INDEX rec_events_ts ON rec_events(ts)`,
    ],
  },
  {
    version: 3,
    name: "metadata, Steam and artwork",
    sql: [
      // Steam's own numbers, kept apart from the playtime imported from the old app.
      `ALTER TABLE games ADD COLUMN steam_playtime_min INTEGER`,
      `ALTER TABLE games ADD COLUMN steam_last_played TEXT`,
      `ALTER TABLE games ADD COLUMN steam_synced_at TEXT`,
      // One row per game and provider. Never overwrites your fields; shown alongside them.
      `CREATE TABLE game_meta (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('steam','igdb')),
        provider_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('linked','review','none','error')),
        method TEXT,
        confidence REAL,
        data TEXT,
        candidates TEXT NOT NULL DEFAULT '[]',
        rejected TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        fetched_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (game_id, provider)
      )`,
      `CREATE INDEX game_meta_status ON game_meta(provider, status)`,
      // API keys and tokens: stored on this PC only, never written to backups.
      `CREATE TABLE secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      // Re-downloadable lookups (e.g. Steam's tag names). Not part of backups.
      `CREATE TABLE http_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at TEXT NOT NULL)`,
    ],
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Tables included in backups, in insert order (parents before children). */
export const BACKUP_TABLES = [
  "games",
  "game_lengths",
  "game_tags",
  "game_meta",
  "collections",
  "collection_games",
  "playthroughs",
  "sessions",
  "events",
  "settings",
  "rec_events",
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
