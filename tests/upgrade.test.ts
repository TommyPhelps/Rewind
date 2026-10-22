// REWIND 4 → 5: the database upgrade, what happens to removed sections' data, and backups.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.ts";
import { nodeDriver } from "./nodeDriver.ts";
import { Repo } from "../src/db/repo.ts";
import { MIGRATIONS, BACKUP_TABLES, SCHEMA_VERSION } from "../src/db/schema.ts";
import { applyRestore, createBackup, validateBackup } from "../src/backup/backup.ts";
import { hasLegacyModding, legacyModdingMarkdown, loadLegacyModding } from "../src/legacy/export.ts";
import { launchTarget } from "../src/launchers/launch.ts";

async function v4Database() {
  const db = nodeDriver();
  await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  for (const m of MIGRATIONS.filter((x) => x.version <= 4)) {
    await db.batch([...m.sql.map((sql) => ({ sql })), { sql: `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, params: [String(m.version)] }]);
  }
  const t = "2026-10-16T09:00:00.000Z";
  const g = (id: string, title: string, extra = "") => db.execute(`INSERT INTO games (id, title, canon, created_at, updated_at${extra ? ", " + extra.split("=")[0] : ""}) VALUES (?, ?, ?, ?, ?${extra ? ", ?" : ""})`, [id, title, title.toLowerCase(), t, t, ...(extra ? [extra.split("=")[1]] : [])]);
  await g("kotor", "STAR WARS™ Knights of the Old Republic™");
  await db.execute(`UPDATE games SET steam_app_id = 32370, steam_playtime_min = 2244, storefront = 'Steam', rating = 5, notes = 'Revan spoilers!', status = 'playing', favorite = 1 WHERE id = 'kotor'`);
  await g("deusex", "Deus Ex: Game of the Year Edition");
  // A Steam id set by a metadata lookup only (not from your Steam library): not proof of ownership.
  await db.execute(`UPDATE games SET steam_app_id = 6910 WHERE id = 'deusex'`);
  await g("skyrim", "The Elder Scrolls V: Skyrim");
  await db.execute(`INSERT INTO game_tags (game_id, tag, source) VALUES ('skyrim', 'rpg', 'user')`);
  await db.execute(`INSERT INTO collections (id, name, sort_order, created_at) VALUES ('c1', 'Up Next', 0, ?), ('c2', 'Couch Co-op', 1, ?)`, [t, t]);
  await db.execute(`INSERT INTO collection_games (collection_id, game_id, position, added_at) VALUES ('c1', 'kotor', 0, ?), ('c1', 'skyrim', 1, ?), ('c2', 'skyrim', 0, ?)`, [t, t, t]);
  await db.execute(`INSERT INTO sessions (id, game_id, started_at, minutes, source, note) VALUES ('s1', 'kotor', '2026-10-15', 90, 'manual', 'Dantooine')`);
  await db.execute(`INSERT INTO rec_events (ts, kind, game_id, reason) VALUES (?, 'pass', 'skyrim', 'burned_out')`, [t]);
  await db.execute(`INSERT INTO discover_marks (item_key, kind, title, game_id, created_at, updated_at) VALUES ('game:deusex', 'want', 'Deus Ex', 'deusex', ?, ?)`, [t, t]);
  // REWIND 4 modding companion and saved modpacks.
  await db.execute(`INSERT INTO mod_profiles (id, name, game_key, game_id, game_title, manager, notes, created_at, updated_at) VALUES ('p1', 'Survival run', 'skyrim_le', 'skyrim', '', 'Mod Organizer 2', 'Use Campfire', ?, ?)`, [t, t]);
  await db.execute(`INSERT INTO mod_entries (id, profile_id, position, name, url, enabled, added_at) VALUES ('e1', 'p1', 0, 'SkyUI', 'https://www.nexusmods.com/skyrim/mods/3863', 1, ?), ('e2', 'p1', 1, 'Frostfall', '', 0, ?)`, [t, t]);
  await db.execute(`INSERT INTO mod_notes (id, profile_id, kind, title, body, mods, created_at, updated_at) VALUES ('n1', 'p1', 'compat', 'Frostfall needs Campfire', 'Read on the mod page', '["Frostfall"]', ?, ?)`, [t, t]);
  await db.execute(`INSERT INTO mod_checklist (id, profile_id, position, text, done_at) VALUES ('k1', 'p1', 0, 'Back up saves', ?)`, [t]);
  await db.execute(`INSERT INTO discover_marks (item_key, kind, title, snapshot, created_at, updated_at) VALUES ('mr:abc', 'wishlist', 'Some Pack', '{"pageUrl":"https://modrinth.com/modpack/some-pack"}', ?, ?)`, [t, t]);
  await db.execute(`INSERT INTO secrets (key, value) VALUES ('steam_api_key', 'abc')`);
  await db.execute(`INSERT INTO settings (key, value) VALUES ('app_settings', '{"theme":"amber","density":"compact","uiScale":1.1}')`);
  return db;
}

test("v4 → v5 keeps every game and personal field, records Steam ownership, and turns collections into tags", async () => {
  const db = await v4Database();
  const before = await db.select<Record<string, unknown>>(`SELECT * FROM games ORDER BY id`);
  const repo = new Repo(db);
  assert.deepEqual(await repo.init(), [5]);
  assert.equal(SCHEMA_VERSION, 5);
  const after = await db.select<Record<string, unknown>>(`SELECT * FROM games ORDER BY id`);
  assert.deepEqual(after, before, "the games table is untouched");
  const games = await repo.loadGames();
  const kotor = games.find((g) => g.id === "kotor")!;
  assert.equal(kotor.rating, 5);
  assert.equal(kotor.notes, "Revan spoilers!");
  assert.equal(kotor.status, "playing");
  assert.equal(kotor.favorite, true);
  assert.deepEqual(kotor.sources.map((s) => [s.source, s.externalId, s.method, s.playtimeMin]), [["steam", "32370", "migrated", 2244]]);
  assert.equal(launchTarget(kotor)?.uri, "steam://rungameid/32370");
  // A Steam id from a metadata lookup alone doesn't make it "owned on Steam".
  assert.deepEqual(games.find((g) => g.id === "deusex")!.sources, []);
  assert.equal(launchTarget(games.find((g) => g.id === "deusex")!), null);
  // Collections: Up Next stays as the queue; "Couch Co-op" becomes a tag (and the collection itself is kept).
  const skyrim = games.find((g) => g.id === "skyrim")!;
  assert.ok(skyrim.tags.some((t) => t.tag === "couch co-op" && t.source === "user"));
  assert.ok(skyrim.tags.some((t) => t.tag === "rpg"));
  const cols = await repo.loadCollections();
  assert.deepEqual(cols.find((c) => c.name === "Up Next")!.gameIds, ["kotor", "skyrim"]);
  assert.ok(cols.some((c) => c.name === "Couch Co-op"));
  // Sessions, answers, recommendation history, settings and keys survive.
  assert.equal((await repo.loadSessions()).length, 1);
  assert.equal((await repo.loadMarks()).find((m) => m.key === "game:deusex")!.kind, "want");
  assert.equal((await repo.loadRecEvents()).length, 1);
  assert.equal(await repo.getSecret("steam_api_key"), "abc");
  // Running the upgrade again changes nothing.
  assert.deepEqual(await new Repo(db).init(), []);
});

test("modding records from REWIND 4 are kept and can be exported", async () => {
  const db = await v4Database();
  const repo = new Repo(db);
  await repo.init();
  const l = await loadLegacyModding(repo);
  assert.ok(hasLegacyModding(l));
  assert.equal(l.profiles.length, 1);
  assert.equal(l.packs.length, 1);
  const md = legacyModdingMarkdown(l, (id) => (id === "skyrim" ? "The Elder Scrolls V: Skyrim" : null), new Date("2026-10-22T00:00:00Z"));
  for (const s of ["## Survival run", "Game: The Elder Scrolls V: Skyrim", "Mod Organizer 2", "| 1 | ✓ | SkyUI |", "| 2 |  | Frostfall |", "Frostfall needs Campfire", "- [x] Back up saves", "Some Pack", "https://modrinth.com/modpack/some-pack", "Use Campfire"]) {
    assert.ok(md.includes(s), `missing: ${s}`);
  }
  // Saved modpacks never show up as Discover suggestions.
  const fresh = await setup();
  assert.equal(hasLegacyModding(await loadLegacyModding(fresh)), false);
});

test("backups: v5 round trip with launcher rows and old modding data; v4 and v3 backups still restore", async () => {
  const db = await v4Database();
  const repo = new Repo(db);
  await repo.init();
  await repo.setSource("skyrim", { source: "epic", externalId: "Ginger", title: "Skyrim (Epic)", installed: true, launch: null, method: "local_scan" });
  const b = await createBackup(repo, "5.0.0");
  for (const t of BACKUP_TABLES) assert.ok(Array.isArray(b.data[t]), t);
  assert.equal(b.data.game_sources.length, 2);
  assert.equal(b.data.mod_profiles.length, 1);
  assert.ok(!JSON.stringify(b).includes("steam_api_key"), "keys are never in backups");
  const v = validateBackup(JSON.parse(JSON.stringify(b)));
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const fresh = new Repo(nodeDriver());
  await fresh.init();
  if (v.ok) await applyRestore(fresh, v.backup, "replace");
  const games = await fresh.loadGames();
  assert.equal(games.length, 3);
  assert.deepEqual(games.find((g) => g.id === "skyrim")!.sources.map((s) => s.source), ["epic"]);
  assert.equal((await fresh.loadModProfiles())[0].entries.length, 2);
  // Merge into a library that already has the games: nothing duplicates, launcher rows join.
  await applyRestore(fresh, b, "merge");
  assert.equal((await fresh.loadGames()).length, 3);
  // An older (schema 4) backup without launcher rows restores without complaint.
  const old = JSON.parse(JSON.stringify(b));
  old.schemaVersion = 4;
  delete old.data.game_sources;
  const v4 = validateBackup(old);
  assert.ok(v4.ok);
  if (v4.ok) assert.ok(!v4.warnings.some((w) => /game_sources/.test(w)));
  const fresh2 = new Repo(nodeDriver());
  await fresh2.init();
  if (v4.ok) await applyRestore(fresh2, v4.backup, "replace");
  assert.equal((await fresh2.loadGames()).length, 3);
  // A schema 3 backup (no discover answers, no modding tables).
  const v3 = JSON.parse(JSON.stringify(old));
  v3.schemaVersion = 3;
  for (const t of ["discover_marks", "mod_profiles", "mod_entries", "mod_notes", "mod_checklist", "mod_runs"]) delete v3.data[t];
  const r3 = validateBackup(v3);
  assert.ok(r3.ok);
  const fresh3 = new Repo(nodeDriver());
  await fresh3.init();
  if (r3.ok) await applyRestore(fresh3, r3.backup, "replace");
  assert.equal((await fresh3.loadGames()).find((g) => g.id === "kotor")!.notes, "Revan spoilers!");
});

test("the upgrade copies the database first, and refuses to upgrade if the copy fails", async () => {
  const calls: [number, number][] = [];
  const db = await v4Database();
  assert.deepEqual(await new Repo(db, { beforeMigrate: async (a, b) => void calls.push([a, b]) }).init(), [5]);
  assert.deepEqual(calls, [[4, 5]]);
  // Already up to date: no copy needed.
  await new Repo(db, { beforeMigrate: async (a, b) => void calls.push([a, b]) }).init();
  assert.equal(calls.length, 1);
  // A brand-new database has nothing to copy.
  await new Repo(nodeDriver(), { beforeMigrate: async (a, b) => void calls.push([a, b]) }).init();
  assert.equal(calls.length, 1);
  // Copy failed: the library stays at version 4, untouched.
  const db2 = await v4Database();
  await assert.rejects(new Repo(db2, { beforeMigrate: async () => { throw new Error("disk full"); } }).init(), /disk full/);
  assert.equal((await db2.select<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`))[0].value, "4");
});

test("stored keys: plain-text keys from REWIND 4 are encrypted; nothing readable stays in the database", async () => {
  // Stand-in for Windows DPAPI (the real one is tested in the Rust tests on Windows).
  const sealer = {
    seal: async (p: string) => "dpapi:" + Buffer.from(p).toString("hex"),
    open: async (s: string) => Buffer.from(s.slice(6), "hex").toString(),
  };
  const db = await v4Database();
  const repo = new Repo(db, { sealer });
  await repo.init();
  assert.equal(await repo.getSecret("steam_api_key"), "abc", "old plain key still readable before sealing");
  assert.equal(await repo.sealSecrets(), 1);
  assert.equal(await repo.sealSecrets(), 0);
  await repo.setSecret("igdb_client_secret", "s3cret");
  const raw = await db.select<{ key: string; value: string }>(`SELECT key, value FROM secrets ORDER BY key`);
  assert.ok(raw.every((r) => r.value.startsWith("dpapi:")));
  assert.ok(!raw.some((r) => r.value.includes("abc") || r.value.includes("s3cret")));
  assert.equal(await repo.getSecret("steam_api_key"), "abc");
  assert.equal(await repo.getSecret("igdb_client_secret"), "s3cret");
  // Outside the app an encrypted key can't be read, and says so.
  await assert.rejects(new Repo(db).getSecret("steam_api_key"), /desktop app/);
});
