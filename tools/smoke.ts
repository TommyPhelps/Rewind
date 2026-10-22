// Windows CI start-up check for the built app.
//
//   node tools/smoke.ts make   <db file>                       creates a REWIND 4 (schema 4) library
//   node tools/smoke.ts verify <db file> <report.json> <backups dir>
//
// "make" writes a v4 database where the app keeps it. The app is then started with
// REWIND_SMOKE_OUT set; it opens the library (upgrading it), reports what it loaded and quits.
// "verify" checks the report and the database: upgraded to schema 5, a full copy saved before
// the upgrade, every game and personal field unchanged, and the stored key encrypted.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { nodeDriver } from "../tests/nodeDriver.ts";
import { MIGRATIONS } from "../src/db/schema.ts";

const [cmd, dbPath, reportPath, backupsDir] = process.argv.slice(2);
const T = "2026-10-01T12:00:00.000Z";
const N = 60;

function fail(msg: string): never {
  console.error("SMOKE FAIL: " + msg);
  process.exit(1);
}

if (cmd === "make") {
  mkdirSync(dirname(dbPath), { recursive: true });
  rmSync(dbPath, { force: true });
  const db = nodeDriver(dbPath);
  await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  for (const m of MIGRATIONS.filter((x) => x.version <= 4)) {
    await db.batch([...m.sql.map((sql) => ({ sql })), { sql: `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, params: [String(m.version)] }]);
  }
  for (let i = 0; i < N; i++) {
    await db.execute(
      `INSERT INTO games (id, title, canon, status, rating, favorite, notes, storefront, steam_app_id, steam_playtime_min, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`g${i}`, `Smoke Test Game ${i}`, `smoke test game ${i}`, ["backlog", "playing", "completed", "paused"][i % 4], i % 5 === 0 ? null : (i % 5) + 0, i % 7 === 0 ? 1 : 0, `note ${i}`, i % 2 ? "Steam" : null, i % 2 ? 100000 + i : null, i % 2 ? i * 10 : null, T, T],
    );
  }
  await db.execute(`INSERT INTO collections (id, name, sort_order, created_at) VALUES ('c1', 'Up Next', 0, ?), ('c2', 'Weekend', 1, ?)`, [T, T]);
  await db.execute(`INSERT INTO collection_games (collection_id, game_id, position, added_at) VALUES ('c1', 'g3', 0, ?), ('c1', 'g1', 1, ?), ('c2', 'g5', 0, ?)`, [T, T, T]);
  await db.execute(`INSERT INTO sessions (id, game_id, started_at, minutes, source, note) VALUES ('s1', 'g1', '2026-09-30', 45, 'manual', 'smoke')`);
  await db.execute(`INSERT INTO mod_profiles (id, name, game_key, game_id, game_title, manager, notes, created_at, updated_at) VALUES ('p1', 'Old modded run', 'skyrim_se', 'g2', '', '', '', ?, ?)`, [T, T]);
  await db.execute(`INSERT INTO secrets (key, value) VALUES ('steam_api_key', '0123456789ABCDEF0123456789ABCDEF')`);
  await db.execute(`INSERT INTO settings (key, value) VALUES ('first_run_done', 'true'), ('app_settings', '{"theme":"amber","density":"compact","uiScale":1.1}')`);
  console.log(`made a schema 4 library with ${N} games at ${dbPath}`);
} else if (cmd === "verify") {
  if (!existsSync(reportPath)) fail("the app didn't write its start-up report (it didn't start, or crashed before the library opened)");
  const r = JSON.parse(readFileSync(reportPath, "utf8"));
  console.log("report:", JSON.stringify(r));
  if (!r.ok) fail(`the app reported an error: ${r.error}`);
  if (r.schema !== 5) fail(`schema ${r.schema}, expected 5`);
  if (JSON.stringify(r.upgraded) !== "[5]") fail(`upgrades applied ${JSON.stringify(r.upgraded)}, expected [5]`);
  if (r.games !== N) fail(`${r.games} games after the upgrade, expected ${N}`);
  const copies = existsSync(backupsDir) ? readdirSync(backupsDir).filter((f) => /^rewind-before-v5-from-v4-\d+\.sqlite3$/.test(f)) : [];
  if (!copies.length) fail(`no pre-upgrade copy in ${backupsDir}`);
  const copy = nodeDriver(`${backupsDir}/${copies[0]}`);
  const cv = await copy.select<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
  if (cv[0]?.value !== "4") fail("the pre-upgrade copy isn't the schema 4 database");
  const db = nodeDriver(dbPath);
  const games = await db.select<Record<string, unknown>>(`SELECT id, status, rating, favorite, notes FROM games ORDER BY CAST(substr(id, 2) AS INTEGER)`);
  for (let i = 0; i < N; i++) {
    const g = games[i];
    const want = { id: `g${i}`, status: ["backlog", "playing", "completed", "paused"][i % 4], rating: i % 5 === 0 ? null : (i % 5) + 0, favorite: i % 7 === 0 ? 1 : 0, notes: `note ${i}` };
    if (JSON.stringify(g) !== JSON.stringify(want)) fail(`game ${i} changed: ${JSON.stringify(g)}`);
  }
  const src = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM game_sources WHERE source = 'steam'`);
  if (Number(src[0].n) !== N / 2) fail(`${src[0].n} Steam ownership rows, expected ${N / 2}`);
  const tag = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM game_tags WHERE tag = 'weekend'`);
  if (Number(tag[0].n) !== 1) fail("the 'Weekend' collection didn't become a tag");
  const up = await db.select<{ game_id: string }>(`SELECT game_id FROM collection_games WHERE collection_id = 'c1' ORDER BY position`);
  if (up.map((x) => x.game_id).join() !== "g3,g1") fail("Up Next order changed");
  const mods = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM mod_profiles`);
  if (Number(mods[0].n) !== 1) fail("REWIND 4 modding records were not kept");
  const sec = await db.select<{ value: string }>(`SELECT value FROM secrets WHERE key = 'steam_api_key'`);
  if (!sec[0]?.value.startsWith("dpapi:")) fail("the stored API key wasn't encrypted with DPAPI");
  if (sec[0].value.includes("0123456789ABCDEF")) fail("the API key is still readable in the database");
  console.log(`SMOKE OK: started, upgraded 4 → 5 with a safety copy (${copies[0]}), ${N} games intact, key encrypted`);
} else {
  fail("usage: node tools/smoke.ts make <db> | verify <db> <report.json> <backups dir>");
}
