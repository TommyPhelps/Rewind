import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nodeDriver } from "./nodeDriver.ts";
import { Repo } from "../src/db/repo.ts";
import { migrate, SCHEMA_VERSION } from "../src/db/schema.ts";
import { canon } from "../src/lib/canon.ts";
import {
  applyArtifactPlan,
  buildArtifactPlan,
  lookupLegacy,
  parseArtifactBackup,
  setPlanAction,
} from "../src/migrate/artifactImport.ts";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/artifact-backup.json", import.meta.url), "utf8"));

async function freshRepo() {
  const repo = new Repo(nodeDriver());
  await repo.init();
  return repo;
}

test("canon matches the artifact's rules", () => {
  assert.equal(canon("STAR WARS™ Knights of the Old Republic™ II - The Sith Lords™"), "star wars knights of the old republic 2 the sith lords");
  assert.equal(canon("The Elder Scrolls V: Skyrim Special Edition"), "elder scrolls 5 skyrim");
  assert.equal(canon("Mass Effect (2007)"), "mass effect");
  assert.equal(canon("Baldur's Gate 3"), "baldurs gate 3");
});

test("schema migrates once and is idempotent", async () => {
  const db = nodeDriver();
  const all = await migrate(db);
  assert.equal(all[all.length - 1], SCHEMA_VERSION);
  assert.deepEqual(all, [...all].sort((a, b) => a - b));
  assert.deepEqual(await migrate(db), []);
});

test("legacy table lookup finds aliases and edition suffixes", () => {
  assert.ok(lookupLegacy("KOTOR"));
  assert.ok(lookupLegacy("The Witcher 3: Wild Hunt - Complete Edition"));
  assert.equal(lookupLegacy("Definitely Not A Real Game 9000"), null);
});

test("artifact plan: header row flagged, statuses and Up Next mapped", () => {
  const plan = buildArtifactPlan(parseArtifactBackup(fixture()));
  assert.equal(plan.counts.inFile, 8);
  const header = plan.games.find((g) => g.title === "game")!;
  assert.equal(header.action, "skip");
  assert.ok(header.suspicious);
  assert.equal(plan.counts.add, 7);
  assert.equal(plan.counts.completed, 1);
  assert.deepEqual(plan.upNext, [
    "star wars knights of the old republic",
    "star wars knights of the old republic 2 the sith lords",
    "kenshi",
  ]);
  const back = setPlanAction(plan, "game", true);
  assert.equal(back.counts.add, 8);
});

test("artifact import writes everything in one transaction with sources", async () => {
  const repo = await freshRepo();
  const plan = buildArtifactPlan(parseArtifactBackup(fixture()));
  const res = await applyArtifactPlan(repo, plan);
  assert.equal(res.added, 7);
  const games = await repo.loadGames();
  assert.equal(games.length, 7);
  assert.ok(!games.some((g) => g.title === "game"), "header row was not imported");

  const portal = games.find((g) => g.title === "Portal")!;
  assert.equal(portal.status, "completed");
  assert.equal(portal.rating, 5);
  assert.equal(portal.notes, "Loved the ending");
  assert.equal(portal.dateCompleted, new Date(1790000000000).toISOString().slice(0, 10));
  assert.equal(portal.importedPlaytimeMin, 186);

  const w3 = games.find((g) => g.title.includes("Witcher 3"))!;
  assert.equal(w3.rating, 2);
  assert.ok(w3.lengths.some((l) => l.source === "legacy_table" && l.kind === "main"));
  assert.ok(w3.tags.some((t) => t.source === "legacy"));
  assert.equal(w3.metaSource.multiplayer, "legacy_table");

  const indie = games.find((g) => g.title === "My Obscure Indie")!;
  assert.deepEqual(
    indie.lengths.map((l) => [l.kind, l.hours, l.source]),
    [["main_extras", 6, "user"]],
  );
  assert.equal(indie.endless, false);
  assert.equal(indie.metaSource.endless, "user");
  assert.equal(indie.multiplayer, "solo");
  assert.equal(indie.tags.length, 0, "no tags invented for unknown games");

  const terraria = games.find((g) => g.title === "Terraria")!;
  assert.equal(terraria.recPref, "never");

  const kotor = games.find((g) => g.canon === "star wars knights of the old republic")!;
  assert.equal(kotor.status, "backlog");

  const cols = await repo.loadCollections();
  const upNext = cols.find((c) => c.name === "Up Next")!;
  assert.deepEqual(
    upNext.gameIds.map((id) => games.find((g) => g.id === id)!.canon),
    ["star wars knights of the old republic", "star wars knights of the old republic 2 the sith lords", "kenshi"],
  );

  const events = await repo.recentEvents(10);
  assert.equal(events.filter((e) => e.type === "legacy_log").length, 2);
  assert.equal(events.filter((e) => e.type === "import").length, 1);
  const legacyState = await repo.getSetting<{ state: Record<string, unknown> } | null>("legacy_rewind_state", null);
  assert.ok(legacyState?.state.slots);
  const profile = await repo.getSetting<{ excludeMultiplayerDependent: boolean } | null>("profile", null);
  assert.equal(profile?.excludeMultiplayerDependent, true);
});

test("re-importing merges instead of duplicating and keeps user edits", async () => {
  const repo = await freshRepo();
  await applyArtifactPlan(repo, buildArtifactPlan(parseArtifactBackup(fixture())));
  const portal = (await repo.loadGames()).find((g) => g.title === "Portal")!;
  await repo.updateGame(portal.id, { notes: "My edited note", rating: 3 });

  const existing = new Map((await repo.loadGames()).map((g) => [g.canon, g.id]));
  const plan2 = buildArtifactPlan(parseArtifactBackup(fixture()), existing);
  assert.equal(plan2.counts.add, 0);
  assert.equal(plan2.counts.merge, 7);
  await applyArtifactPlan(repo, plan2);

  const games = await repo.loadGames();
  assert.equal(games.length, 7);
  const p2 = games.find((g) => g.id === portal.id)!;
  assert.equal(p2.notes, "My edited note");
  assert.equal(p2.rating, 3);
  const cols = await repo.loadCollections();
  assert.equal(cols.filter((c) => c.name === "Up Next").length, 1);
  assert.equal(cols[0].gameIds.length, 3);
});

test("a failing statement rolls back the whole import", async () => {
  const repo = await freshRepo();
  const plan = buildArtifactPlan(parseArtifactBackup(fixture()));
  const driver = repo.driver;
  const original = driver.batch.bind(driver);
  driver.batch = async (stmts) => original([...stmts, { sql: "INSERT INTO games (id) VALUES (NULL)" }]);
  await assert.rejects(() => applyArtifactPlan(repo, plan));
  driver.batch = original;
  assert.equal(await repo.countGames(), 0);
});

// Runs only when a real artifact export is present locally (never committed).
const REAL = process.env.REWIND_REAL_EXPORT;
test("real library export imports completely", { skip: !REAL }, async () => {
  const raw = JSON.parse(readFileSync(REAL!, "utf8"));
  const backup = parseArtifactBackup(raw);
  const plan = buildArtifactPlan(backup);
  const repo = await freshRepo();
  const res = await applyArtifactPlan(repo, plan);
  const games = await repo.loadGames();
  assert.equal(games.length, res.added);
  assert.equal(res.added + plan.counts.skip, backup.games.length);
  const withPlaytime = backup.games.filter((g) => typeof g.p === "number" && g.p > 0 && plan.games.find((x) => x.key === g.id)?.action !== "skip").length;
  assert.equal(games.filter((g) => g.importedPlaytimeMin != null).length, withPlaytime);
  // Every source title survives exactly.
  const titles = new Set(games.map((g) => g.title));
  for (const pg of plan.games) if (pg.action !== "skip") assert.ok(titles.has(pg.title), pg.title);
  console.log(
    `real export: ${backup.games.length} in file, ${res.added} imported, ${plan.counts.skip} skipped (${plan.games.filter((g) => g.action === "skip").map((g) => g.title).join(", ")}), ` +
      `${plan.counts.legacyMatches} matched the legacy table, Up Next: ${plan.upNext.join(" > ")}`,
  );
});

test("concurrent init calls share one migration", async () => {
  const repo = new Repo(nodeDriver());
  const [a, b] = await Promise.all([repo.init(), repo.init()]);
  assert.deepEqual(a, b);
  assert.equal(await repo.countGames(), 0);
});

test("upgrading a Phase 1 (schema v1) library keeps every game, note and setting", async () => {
  const { MIGRATIONS } = await import("../src/db/schema.ts");
  const { applyReferenceData } = await import("../src/migrate/reference.ts");
  const db = nodeDriver();
  // Build a genuine v1 database the way Phase 1 did.
  await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  await db.batch([...MIGRATIONS[0].sql.map((sql) => ({ sql })), { sql: `INSERT INTO meta (key, value) VALUES ('schema_version', '1')` }]);
  const v1 = new Repo(db);
  (v1 as unknown as { initPromise: Promise<number[]> }).initPromise = Promise.resolve([]);
  for (const t of ["games", "game_lengths", "game_tags", "collections", "collection_games", "playthroughs", "sessions", "events", "settings"]) {
    const cols = await db.select<{ name: string }>(`PRAGMA table_info(${t})`);
    (v1 as unknown as { columns: Map<string, Set<string>> }).columns.set(t, new Set(cols.map((c) => c.name)));
  }
  await applyArtifactPlan(v1, buildArtifactPlan(parseArtifactBackup(fixture())));
  const before = await db.select<Record<string, unknown>>(`SELECT id, title, notes, rating, status, imported_playtime_min FROM games ORDER BY id`);
  await db.execute(`UPDATE games SET notes = 'keep me' WHERE title = 'Kenshi'`);
  await db.execute(`INSERT INTO settings (key, value) VALUES ('app_settings', '{"theme":"amber"}')`);

  // Open it with the current app.
  const repo = new Repo(db);
  const applied = await repo.init();
  assert.ok(applied.includes(2));
  await applyReferenceData(repo);
  const after = await db.select<Record<string, unknown>>(`SELECT id, title, notes, rating, status, imported_playtime_min FROM games ORDER BY id`);
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map((g) => [g.id, g.title, g.rating, g.status, g.imported_playtime_min]), before.map((g) => [g.id, g.title, g.rating, g.status, g.imported_playtime_min]));
  assert.equal(after.find((g) => g.title === "Kenshi")!.notes, "keep me");
  assert.equal((await repo.getSetting<{ theme: string }>("app_settings", { theme: "" })).theme, "amber");
  assert.equal((await repo.loadCollections())[0].gameIds.length, 3, "Up Next intact");
  await repo.addRecEvent("pass", null, "not_tonight");
  assert.equal((await repo.loadRecEvents()).length, 1);
});
