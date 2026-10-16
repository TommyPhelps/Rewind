import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setup } from "./helpers.ts";
import { fakeTransport } from "./fakeServices.ts";
import { nodeDriver } from "./nodeDriver.ts";
import { Repo } from "../src/db/repo.ts";
import { Net, type Clock } from "../src/meta/http.ts";
import { DEFAULT_SYNC, MetaSync, linkManually, markNoMatch, resetLink, type SyncOptions, type SyncProgress } from "../src/meta/sync.ts";
import { effectiveLength } from "../src/lib/library.ts";
import { createBackup, validateBackup, applyRestore } from "../src/backup/backup.ts";
import { applyArtifactPlan, buildArtifactPlan, parseArtifactBackup } from "../src/migrate/artifactImport.ts";
import { BACKUP_TABLES, MIGRATIONS } from "../src/db/schema.ts";
import { bestCover } from "../src/meta/apply.ts";

const instant: Clock = { now: () => 0, sleep: async () => undefined };
const net = (opts: Parameters<typeof fakeTransport>[0] = {}) => {
  const t = fakeTransport(opts);
  return { t, net: new Net(t, instant) };
};
const byTitle = async (repo: Repo, t: string) => (await repo.loadGames()).find((g) => g.title === t || g.title.startsWith(t))!;

async function sync(repo: Repo, n: Net, opts: Partial<SyncOptions> = {}, signal?: AbortSignal, onProgress?: (p: SyncProgress) => void) {
  return new MetaSync(repo, n, { ...DEFAULT_SYNC, ...opts }, onProgress, signal).run();
}

test("full sync: links by exact title, sends close calls to review, fetches data and covers", async () => {
  const repo = await setup();
  const { net: n, t } = net();
  const res = await sync(repo, n);
  assert.equal(res.outcome, "complete", res.message);
  const k = await byTitle(repo, "STAR WARS™ Knights of the Old Republic™");
  assert.equal(k.steamAppId, 32370);
  assert.equal(k.meta.steam?.status, "linked");
  assert.equal(k.meta.steam?.method, "search");
  assert.deepEqual(k.meta.steam?.data?.developers, ["BioWare"]);
  assert.equal(k.meta.steam?.data?.releaseYear, 2003);
  assert.equal(k.coverPath, "artwork/steam-32370-cover.jpg");
  assert.equal(bestCover(k)?.art.kind, "portrait");
  // KOTOR II is linked to its own app, never to KOTOR's.
  assert.equal((await byTitle(repo, "STAR WARS™ Knights of the Old Republic™ II")).steamAppId, 208580);
  // "Portal" has no library cover on Steam: the landscape header is used, honestly labelled.
  const p = await byTitle(repo, "Portal");
  assert.equal(p.coverPath, "artwork/steam-400-header.jpg");
  assert.equal(p.metaSource.cover, "steam:landscape");
  // BioShock's store page is hidden: linked by search? No — search finds the Remastered page only.
  const b = await byTitle(repo, "BioShock™");
  assert.notEqual(b.steamAppId, 8850);
  // Requests were batched: far fewer GetItems calls than games.
  const getItems = t.log.filter((l) => l.includes("GetItems")).length;
  assert.ok(getItems <= 3, `${getItems} batched store requests`);
  assert.ok(res.counts.covers > 20);
});

test("sync only fills estimates: your own player-mode choice, tags and lengths are never overwritten", async () => {
  const repo = await setup();
  const er = await byTitle(repo, "ELDEN RING");
  await repo.updateGame(er.id, { multiplayer: "solo" }); // your choice
  await repo.setTags(er.id, [...er.tags.map((t) => t.tag).filter((t) => t !== "openworld")]); // you removed "openworld"
  const ks = await byTitle(repo, "Kenshi");
  await repo.updateGame(ks.id, { rating: 2, notes: "too aimless", status: "dropped" });
  const { net: n } = net();
  await sync(repo, n);
  const er2 = await byTitle(repo, "ELDEN RING");
  assert.equal(er2.multiplayer, "solo", "your choice wins over Steam's categories");
  assert.equal(er2.metaSource.multiplayer, "user");
  assert.ok(!er2.tags.some((t) => t.tag === "openworld"), "a tag you removed is not put back");
  assert.ok(er2.tags.some((t) => t.tag === "souls" ), "existing tags kept");
  const ks2 = await byTitle(repo, "Kenshi");
  assert.equal(ks2.rating, 2);
  assert.equal(ks2.notes, "too aimless");
  assert.equal(ks2.status, "dropped");
  assert.equal(ks2.title, "Kenshi");
  // Dead by Daylight: the estimate is replaced by Steam's fact.
  const dbd = await byTitle(repo, "Dead by Daylight");
  assert.equal(dbd.multiplayer, "mp_required");
  assert.equal(dbd.metaSource.multiplayer, "steam");
  // New tags from Steam are labelled with their source.
  const all = await repo.loadGames();
  assert.ok(all.some((g) => g.tags.some((t) => t.source === "steam_tags")));
  // A tag that already existed keeps its original source (no relabelling).
  const p4 = all.find((g) => g.title === "Persona 4 Golden")!;
  assert.equal(p4.tags.find((t) => t.tag === "rpg")?.source, "legacy");
});

test("going offline mid-sync keeps everything fetched so far and marks nothing as failed", async () => {
  const repo = await setup();
  const { net: n } = net({ failAfter: 12 });
  const res = await sync(repo, n);
  assert.equal(res.outcome, "offline");
  assert.match(res.message, /saved/);
  const games = await repo.loadGames();
  const linked = games.filter((g) => g.meta.steam?.status === "linked");
  assert.ok(linked.length >= 8, `${linked.length} games linked before the connection dropped`);
  assert.equal(games.filter((g) => g.meta.steam?.status === "error").length, 0);
  // Back online: carries on from where it stopped.
  const { net: n2 } = net();
  const res2 = await sync(repo, n2);
  assert.equal(res2.outcome, "complete");
  assert.ok((await repo.loadGames()).filter((g) => g.meta.steam?.data).length > linked.length);
});

test("cancelling stops promptly and keeps progress", async () => {
  const repo = await setup();
  const ctrl = new AbortController();
  const { net: n } = net();
  let seen = 0;
  const res = await sync(repo, n, {}, ctrl.signal, (p) => {
    if (p.phase === "link" && p.done >= 5 && !ctrl.signal.aborted) ctrl.abort();
    seen++;
  });
  assert.equal(res.outcome, "cancelled");
  assert.ok(seen > 0);
  const linked = (await repo.loadGames()).filter((g) => g.meta.steam);
  assert.ok(linked.length >= 5 && linked.length < 20);
});

test("two library games with the same normalised title are never auto-linked to the other's Steam page", async () => {
  const repo = await setup();
  await repo.addGame({ title: "Grand Theft Auto V Enhanced" }); // the fake Steam only has "… Legacy"
  const { net: n } = net();
  await sync(repo, n);
  assert.equal((await byTitle(repo, "Grand Theft Auto V Legacy")).steamAppId, 271590);
  const enh = await byTitle(repo, "Grand Theft Auto V Enhanced");
  assert.equal(enh.steamAppId, null);
  assert.equal(enh.meta.steam?.status, "review");
});

test("a game played recently is still in progress even past its estimate (KOTOR, 41h of ~40h)", async () => {
  const { progressState } = await import("../src/rec/progress.ts");
  const repo = await setup();
  const k = await byTitle(repo, "STAR WARS™ Knights of the Old Republic™");
  await repo.batch([{ sql: `UPDATE games SET steam_playtime_min = 2460, steam_last_played = '2026-10-15' WHERE id = ?`, params: [k.id] }]);
  const k2 = await byTitle(repo, "STAR WARS™ Knights of the Old Republic™");
  assert.equal(progressState(k2, true, Date.parse("2026-10-20T12:00:00Z")), "started");
  assert.equal(progressState(k2, true, Date.parse("2027-06-01T12:00:00Z")), "likely_finished", "months later, past the estimate: probably finished");
  const { rank, pos } = await import("./helpers.ts");
  const r = rank(await repo.loadGames(), { experience: "story" });
  const x = r.results[pos(r, "STAR WARS™ Knights of the Old Republic™")];
  assert.ok(!x.cons.some((c) => /replay/.test(c.text)), x.cons.map((c) => c.text).join(" | "));
  assert.ok(x.pros.some((p) => /still on it/.test(p.text)));
  assert.ok(r.results[pos(r, "STAR WARS™ Knights of the Old Republic™ II")].heldBack, "KOTOR II still waits");
});

test("review queue: you pick, reject, or reset; links are never duplicated", async () => {
  const repo = await setup();
  await repo.addGame({ title: "Hard Reset Classic" });
  const { net: n } = net();
  await sync(repo, n);
  const hr = await byTitle(repo, "Hard Reset Classic");
  assert.equal(hr.meta.steam?.status, "review", "two equally good Steam names: you choose");
  assert.ok(hr.meta.steam!.candidates.length >= 2);
  await linkManually(repo, hr, "steam", "98400", hr.meta.steam!.candidates);
  await sync(repo, n, { gameIds: [hr.id] });
  const hr2 = await byTitle(repo, "Hard Reset Classic");
  assert.equal(hr2.steamAppId, 98400);
  assert.equal(hr2.meta.steam?.method, "user");
  assert.ok(hr2.meta.steam?.data);
  // The same Steam app can't be given to a second game.
  const other = await byTitle(repo, "Minit");
  await assert.rejects(linkManually(repo, other, "steam", "98400"), /already linked/);
  // "None of these" is remembered: a later sync won't link it again.
  await markNoMatch(repo, hr2, "steam");
  await sync(repo, n);
  const hr3 = await byTitle(repo, "Hard Reset Classic");
  assert.equal(hr3.steamAppId, null);
  assert.equal(hr3.meta.steam?.status, "none");
  assert.equal(hr3.coverPath, null, "its Steam cover is removed with the link");
  assert.ok(!hr3.tags.some((t) => t.source === "steam_tags"));
  // Reset: looked up again from scratch.
  await resetLink(repo, hr3, "steam");
  assert.equal((await byTitle(repo, "Hard Reset Classic")).meta.steam, undefined);
});

test("IGDB (optional): time to beat stored as labelled lengths; your own length still wins", async () => {
  const repo = await setup();
  const k = await byTitle(repo, "STAR WARS™ Knights of the Old Republic™");
  const { net: n } = net();
  await sync(repo, n, { igdb: { clientId: "testclient", clientSecret: "testsecret" } });
  const k2 = await byTitle(repo, "STAR WARS™ Knights of the Old Republic™");
  assert.equal(k2.meta.igdb?.status, "linked");
  assert.equal(k2.meta.igdb?.method, "steam_id", "confirmed by IGDB listing the same Steam app");
  const main = effectiveLength(k2, "main", false);
  assert.deepEqual([main?.hours, main?.source], [25, "igdb"], "IGDB's figure beats the old unverified table when estimates are hidden");
  await repo.setUserLength(k.id, "main", 33);
  assert.equal(effectiveLength(await byTitle(repo, "STAR WARS™ Knights of the Old Republic™"), "main", true)?.source, "user");
  // A secret is needed for the token, and the token is cached locally, never in backups.
  assert.ok(await repo.getSecret("igdb_token"));
  const b = await createBackup(repo, "test");
  assert.ok(!JSON.stringify(b).includes("faketoken"));
});

test("IGDB with a wrong secret: skipped with a clear message; Steam still syncs", async () => {
  const repo = await setup();
  const { net: n } = net();
  const res = await sync(repo, n, { igdb: { clientId: "testclient", clientSecret: "wrong" } });
  assert.equal(res.outcome, "complete");
  assert.match(res.message, /IGDB refused/);
  assert.ok((await byTitle(repo, "ELDEN RING")).meta.steam?.data);
});

test("artwork missing from disk (e.g. backup restored elsewhere) is downloaded again", async () => {
  const repo = await setup();
  const { net: n } = net();
  await sync(repo, n);
  const { net: n2, t: t2 } = net();
  await new MetaSync(repo, n2, { ...DEFAULT_SYNC }, undefined, undefined, { missing: async (files) => files.filter((f) => f.includes("32370")) }).run();
  assert.deepEqual(t2.downloads.sort(), ["steam-32370-cover", "steam-32370-header"]);
});

test("backups include links and metadata but never API keys; restore keeps them", async () => {
  const repo = await setup();
  const { net: n } = net();
  await sync(repo, n);
  await repo.setSecret("steam_api_key", "0123456789ABCDEF0123456789ABCDEF");
  const backup = await createBackup(repo, "test");
  assert.ok(BACKUP_TABLES.includes("game_meta"));
  assert.ok(!JSON.stringify(backup).includes("0123456789ABCDEF0123456789ABCDEF"));
  const v = validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(v.ok);
  const fresh = new Repo(nodeDriver());
  await fresh.init();
  await applyRestore(fresh, (v as { backup: typeof backup }).backup, "replace");
  const k = await byTitle(fresh, "STAR WARS™ Knights of the Old Republic™");
  assert.equal(k.steamAppId, 32370);
  assert.equal(k.meta.steam?.data?.developers[0], "BioWare");
  assert.equal(k.coverPath, "artwork/steam-32370-cover.jpg");
  assert.equal(await fresh.getSecret("steam_api_key"), null);
});

test("upgrading a 2.5 (schema v2) library to v3 keeps every game, note, queue and recommendation", async () => {
  const db = nodeDriver();
  await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  await db.batch([...MIGRATIONS[0].sql, ...MIGRATIONS[1].sql].map((sql) => ({ sql })).concat([{ sql: `INSERT INTO meta (key, value) VALUES ('schema_version', '2')` }]));
  const v2 = new Repo(db);
  (v2 as unknown as { initPromise: Promise<number[]> }).initPromise = Promise.resolve([]);
  for (const t of ["games", "game_lengths", "game_tags", "collections", "collection_games", "playthroughs", "sessions", "events", "settings", "rec_events"]) {
    const cols = await db.select<{ name: string }>(`PRAGMA table_info(${t})`);
    (v2 as unknown as { columns: Map<string, Set<string>> }).columns.set(t, new Set(cols.map((c) => c.name)));
  }
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/artifact-backup.json", import.meta.url), "utf8"));
  await applyArtifactPlan(v2, buildArtifactPlan(parseArtifactBackup(fixture)));
  await db.execute(`UPDATE games SET notes = 'keep me', rating = 4, status = 'playing' WHERE title = 'Kenshi'`);
  await db.execute(`INSERT INTO rec_events (ts, kind, game_id, reason, context) VALUES ('2026-10-01T00:00:00Z', 'pass', NULL, 'not_tonight', '{}')`);
  const before = await db.select<Record<string, unknown>>(`SELECT id, title, notes, rating, status, imported_playtime_min FROM games ORDER BY id`);

  const repo = new Repo(db);
  const applied = await repo.init();
  assert.deepEqual(applied, [3, 4]);
  const after = await db.select<Record<string, unknown>>(`SELECT id, title, notes, rating, status, imported_playtime_min FROM games ORDER BY id`);
  assert.deepEqual(after, before);
  const games = await repo.loadGames();
  assert.ok(games.every((g) => g.steamPlaytimeMin == null && Object.keys(g.meta).length === 0));
  assert.equal((await repo.loadRecEvents()).length, 1);
  assert.equal((await repo.loadCollections())[0].gameIds.length, 3, "Up Next intact");
});
