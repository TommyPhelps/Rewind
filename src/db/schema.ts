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
  {
    version: 4,
    name: "discovery feedback and modding companion",
    sql: [
      // Your answers to Discover suggestions: games in your library ("game:<id>"), games you
      // don't own ("igdb:<id>") and modpacks ("mr:<id>" Modrinth, "cf:<id>" CurseForge).
      // The snapshot keeps what was shown, so saved items still display offline.
      `CREATE TABLE discover_marks (
        item_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('interested','not_interested','played','want','wishlist')),
        title TEXT NOT NULL,
        game_id TEXT REFERENCES games(id) ON DELETE CASCADE,
        snapshot TEXT NOT NULL DEFAULT '{}',
        times INTEGER NOT NULL DEFAULT 1,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX discover_marks_kind ON discover_marks(kind)`,
      // Modding companion: your own records only. REWIND never touches game or mod-manager files.
      `CREATE TABLE mod_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        game_key TEXT NOT NULL DEFAULT 'other',
        game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
        game_title TEXT NOT NULL DEFAULT '',
        manager TEXT NOT NULL DEFAULT '',
        game_version TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','paused','finished','retired')),
        pack_key TEXT,
        notes TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE mod_entries (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES mod_profiles(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL
      )`,
      `CREATE INDEX mod_entries_profile ON mod_entries(profile_id, position)`,
      `CREATE TABLE mod_notes (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES mod_profiles(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'compat' CHECK (kind IN ('compat','setup','issue','tip')),
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        mods TEXT NOT NULL DEFAULT '[]',
        source_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE mod_checklist (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES mod_profiles(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL,
        done_at TEXT
      )`,
      `CREATE TABLE mod_runs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES mod_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','finished','abandoned')),
        notes TEXT NOT NULL DEFAULT ''
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
  "game_meta",
  "collections",
  "collection_games",
  "playthroughs",
  "sessions",
  "events",
  "settings",
  "rec_events",
  "discover_marks",
  "mod_profiles",
  "mod_entries",
  "mod_notes",
  "mod_checklist",
  "mod_runs",
] as const;

/** Schema version each backup section first appeared in (older backups simply lack it). */
export const TABLE_SINCE: Partial<Record<BackupTable, number>> = {
  rec_events: 2,
  game_meta: 3,
  discover_marks: 4,
  mod_profiles: 4,
  mod_entries: 4,
  mod_notes: 4,
  mod_checklist: 4,
  mod_runs: 4,
};
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
