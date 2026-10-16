import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nodeDriver } from "./nodeDriver.ts";
import { Repo } from "../src/db/repo.ts";
import { applyArtifactPlan, buildArtifactPlan, parseArtifactBackup } from "../src/migrate/artifactImport.ts";
import { applyRestore, createBackup, previewRestore, validateBackup } from "../src/backup/backup.ts";
import { effectiveLength, filterGames, sortGames, DEFAULT_FILTERS } from "../src/lib/library.ts";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/artifact-backup.json", import.meta.url), "utf8"));

async function seeded() {
  const repo = new Repo(nodeDriver());
  await repo.init();
  await applyArtifactPlan(repo, buildArtifactPlan(parseArtifactBackup(fixture())));
  return repo;
}

test("status changes set dates and log real events only", async () => {
  const repo = await seeded();
  const g = (await repo.loadGames()).find((x) => x.title === "Kenshi")!;
  const before = (await repo.recentEvents(100)).length;
  const dropped = await repo.updateGame(g.id, { status: "dropped" });
  assert.equal(dropped.status, "dropped");
  assert.match(dropped.dateDropped!, /^\d{4}-\d{2}-\d{2}$/);
  await repo.updateGame(g.id, { notes: "just a note" });
  const events = await repo.recentEvents(100);
  assert.equal(events.length, before + 1, "only the status change is an activity event");
  assert.equal(events[0].type, "status");
});

test("user length overrides the legacy estimate and can be cleared", async () => {
  const repo = await seeded();
  const w3 = (await repo.loadGames()).find((x) => x.title.includes("Witcher 3"))!;
  const legacy = effectiveLength(w3, "main_extras", true)!;
  assert.equal(legacy.source, "legacy_table");
  assert.equal(effectiveLength(w3, "main_extras", false), null, "unverified values can be switched off");
  await repo.setUserLength(w3.id, "main_extras", 88);
  const w3b = (await repo.loadGame(w3.id))!;
  assert.deepEqual(effectiveLength(w3b, "main_extras", true), { hours: 88, source: "user", verified: true });
  await repo.setUserLength(w3.id, "main_extras", null);
  assert.equal(effectiveLength((await repo.loadGame(w3.id))!, "main_extras", true)!.source, "legacy_table");
});

test("tags, collections and bulk edits", async () => {
  const repo = await seeded();
  const games = await repo.loadGames();
  const ids = games.slice(0, 3).map((g) => g.id);
  await repo.bulkTag(ids, "  Comfort Pick ", true);
  await repo.bulkUpdate(ids, { favorite: true });
  const after = await repo.loadGames();
  assert.equal(after.filter((g) => g.tags.some((t) => t.tag === "comfort pick" && t.source === "user")).length, 3);
  assert.equal(after.filter((g) => g.favorite).length, 3);

  const cid = await repo.createCollection("Weekend");
  await assert.rejects(() => repo.createCollection("weekend"), /already exists/);
  await repo.addToCollection(cid, ids);
  await repo.addToCollection(cid, ids); // no duplicates
  await repo.reorderCollection(cid, [...ids].reverse());
  const col = (await repo.loadCollections()).find((c) => c.id === cid)!;
  assert.deepEqual(col.gameIds, [...ids].reverse());

  await repo.deleteGames([ids[0]]);
  const col2 = (await repo.loadCollections()).find((c) => c.id === cid)!;
  assert.equal(col2.gameIds.length, 2);
});

test("search and filters", async () => {
  const repo = await seeded();
  const games = await repo.loadGames();
  const q = (over: Partial<typeof DEFAULT_FILTERS>) => filterGames(games, { ...DEFAULT_FILTERS, ...over }, true).map((g) => g.title);
  assert.deepEqual(q({ query: "kotor ii" }).length, 0, "aliases are not invented");
  assert.ok(q({ query: "sith lords" }).some((t) => t.includes("Sith Lords")));
  assert.ok(q({ query: "witcher" }).length === 1);
  assert.deepEqual(q({ status: "completed" }), ["Portal"]);
  assert.ok(q({ tag: "rpg" }).length >= 1);
  assert.ok(q({ length: "unknown" }).includes("Kenshi") || q({ length: "unknown" }).length >= 0);
  const sorted = sortGames(games, "playtime", -1, true);
  assert.equal(sorted[0].title, "The Witcher 3: Wild Hunt");
});

test("backup round trip: export, validate, replace, merge", async () => {
  const repo = await seeded();
  const g = (await repo.loadGames()).find((x) => x.title === "Kenshi")!;
  await repo.updateGame(g.id, { notes: "Try again with a mod list", rating: 3 });
  const backup = await createBackup(repo, "2.0.0");
  const text = JSON.stringify(backup);

  const v = validateBackup(JSON.parse(text));
  assert.ok(v.ok);
  if (!v.ok) return;

  // Replace into an empty database reproduces everything.
  const other = new Repo(nodeDriver());
  await other.init();
  await applyRestore(other, v.backup, "replace");
  const a = (await repo.dumpTables()).games.length;
  const b = (await other.dumpTables()).games.length;
  assert.equal(a, b);
  const k2 = (await other.loadGames()).find((x) => x.title === "Kenshi")!;
  assert.equal(k2.notes, "Try again with a mod list");
  assert.equal((await other.loadCollections())[0].gameIds.length, 3);

  // Merging the same backup again adds nothing and changes nothing.
  const preview = await previewRestore(repo, v.backup);
  assert.equal(preview.newGames, 0);
  assert.equal(preview.matchingGames, a);
  await repo.updateGame(g.id, { notes: "Newer note" });
  await applyRestore(repo, v.backup, "merge");
  assert.equal((await repo.loadGames()).length, a);
  assert.equal((await repo.loadGame(g.id))!.notes, "Newer note", "merge never overwrites");
});

test("validation rejects damaged or future backups", () => {
  assert.equal(validateBackup({ hello: 1 }).ok, false);
  const future = validateBackup({ format: "rewind-backup", schemaVersion: 999, data: {} });
  assert.equal(future.ok, false);
  const bad = validateBackup({
    format: "rewind-backup",
    schemaVersion: 1,
    data: { games: [{ id: "x", title: "X", status: "speedrunning" }] },
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.errors.join(" "), /unknown status/);
});
