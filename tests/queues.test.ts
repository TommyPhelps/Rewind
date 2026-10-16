import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.ts";
import { buildSeriesIndex } from "../src/rec/series.ts";
import { findUpNext, resumeCandidates, reviewUpNext, seriesFollowUps } from "../src/lib/queues.ts";
import { progressState } from "../src/rec/progress.ts";
import { buildTaste } from "../src/rec/taste.ts";
import { DEFAULT_PROFILE } from "../src/data/profileDefaults.ts";
import type { Repo } from "../src/db/repo.ts";

const series = buildSeriesIndex();
const byTitle = async (repo: Repo, t: string) => (await repo.loadGames()).find((g) => g.title.startsWith(t))!;

async function withUpNext() {
  const repo = await setup();
  const id = await repo.createCollection("Up Next");
  for (const t of ["STAR WARS™ Knights of the Old Republic™", "STAR WARS™ Knights of the Old Republic™ II", "Kenshi"]) {
    await repo.addToCollection(id, [(await byTitle(repo, t)).id]);
  }
  return { repo, colId: id };
}

test("Up Next review on the imported queue: suggestions only, nothing changes", async () => {
  const { repo } = await withUpNext();
  const games = await repo.loadGames();
  const cols = await repo.loadCollections();
  const struggled = new Set([...buildTaste(games, DEFAULT_PROFILE, []).evidence].filter(([, e]) => e.value < 0).map(([id]) => id));
  const items = reviewUpNext(findUpNext(cols), games, series, { struggled });
  const kinds = Object.fromEntries(items.map((i) => [games.find((g) => g.id === i.gameId)!.title, i.kind]));
  assert.equal(kinds["STAR WARS™ Knights of the Old Republic™"], "progress_unknown", "37h of ~40h: asks if playing or finished");
  assert.equal(kinds["STAR WARS™ Knights of the Old Republic™ II - The Sith Lords™"], "sequel_waiting");
  assert.ok(kinds["Kenshi"] === "progress_unknown" || kinds["Kenshi"] === "struggled");
  // Nothing was modified by reviewing.
  assert.equal((await repo.loadCollections())[0].gameIds.length, 3);
  assert.equal((await byTitle(repo, "STAR WARS™ Knights of the Old Republic™")).status, "backlog");
});

test("after marking KOTOR Playing the review suggests removing it; dismissals are remembered", async () => {
  const { repo } = await withUpNext();
  const k = await byTitle(repo, "STAR WARS™ Knights of the Old Republic™");
  await repo.updateGame(k.id, { status: "playing" });
  const games = await repo.loadGames();
  const items = reviewUpNext(findUpNext(await repo.loadCollections()), games, series);
  const kotor = items.find((i) => i.gameId === k.id)!;
  assert.equal(kotor.kind, "playing");
  assert.ok(kotor.actions.some((a) => a.op === "remove"));
  const again = reviewUpNext(findUpNext(await repo.loadCollections()), games, series, { dismissed: new Set([kotor.key]) });
  assert.ok(!again.some((i) => i.key === kotor.key));
});

test("series follow-ups: waiting while playing, ready once finished", async () => {
  const repo = await setup();
  const k = await byTitle(repo, "STAR WARS™ Knights of the Old Republic™");
  await repo.updateGame(k.id, { status: "playing" });
  let f = seriesFollowUps(await repo.loadGames(), series).find((x) => x.game.title.startsWith("STAR WARS™ Knights of the Old Republic™ II"))!;
  assert.equal(f.ready, false);
  assert.match(f.text, /Waiting: you're playing/);
  await repo.updateGame(k.id, { status: "completed" });
  f = seriesFollowUps(await repo.loadGames(), series).find((x) => x.game.title.startsWith("STAR WARS™ Knights of the Old Republic™ II"))!;
  assert.equal(f.ready, true);
  const all = seriesFollowUps(await repo.loadGames(), series);
  assert.ok(all.some((x) => x.game.title === "DARK SOULS™ III"), "Dark Souls III follows Dark Souls II, which is part-played");
});

test("statuses, dates and sessions persist", async () => {
  const repo = await setup();
  const g = await byTitle(repo, "Hollow Knight");
  await repo.updateGame(g.id, { status: "paused" });
  await repo.addSession(g.id, "2026-10-15", 45, "Got to City of Tears");
  await repo.addSession(g.id, "2026-10-12", null);
  const after = (await repo.loadGame(g.id))!;
  assert.equal(after.status, "paused");
  assert.equal(after.lastPlayed, "2026-10-15", "last played follows the newest session");
  const sessions = await repo.loadSessions();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].note, "Got to City of Tears");
  assert.equal(sessions[1].minutes, null, "unknown minutes stay unknown");
  await repo.deleteSession(sessions[1].id);
  assert.equal((await repo.loadSessions()).length, 1);
  await repo.updateGame(g.id, { status: "completed" });
  assert.match((await repo.loadGame(g.id))!.dateCompleted!, /^\d{4}-\d{2}-\d{2}$/);
});

test("collections: move between, reorder, remove", async () => {
  const { repo, colId } = await withUpNext();
  const later = await repo.createCollection("Later");
  const kenshi = await byTitle(repo, "Kenshi");
  await repo.moveBetweenCollections(colId, later, [kenshi.id]);
  let cols = await repo.loadCollections();
  assert.equal(cols.find((c) => c.id === colId)!.gameIds.length, 2);
  assert.deepEqual(cols.find((c) => c.id === later)!.gameIds, [kenshi.id]);
  const up = cols.find((c) => c.id === colId)!;
  await repo.reorderCollection(colId, [...up.gameIds].reverse());
  cols = await repo.loadCollections();
  assert.deepEqual(cols.find((c) => c.id === colId)!.gameIds, [...up.gameIds].reverse());
  // moving into a collection that already has the game doesn't duplicate it
  await repo.addToCollection(colId, [kenshi.id]);
  await repo.moveBetweenCollections(later, colId, [kenshi.id]);
  cols = await repo.loadCollections();
  assert.equal(cols.find((c) => c.id === colId)!.gameIds.filter((x) => x === kenshi.id).length, 1);
  assert.equal(cols.find((c) => c.id === later)!.gameIds.length, 0);
});

test("imported KOTOR (37h of ~40h, still Backlog) is unfinished: KOTOR II waits in follow-ups", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const k1 = games.find((g) => g.title === "STAR WARS™ Knights of the Old Republic™")!;
  assert.equal(progressState(k1), "started", "close to an estimate is not finished");
  const f = seriesFollowUps(games, series).find((x) => x.game.title.startsWith("STAR WARS™ Knights of the Old Republic™ II"))!;
  assert.equal(f.ready, false);
  assert.match(f.text, /Waiting: .*37h in, not finished/);
  assert.equal(k1.status, "backlog", "nothing was changed to work this out");
});

test("Continue where you left off skips endless and multiplayer-only games", async () => {
  const repo = await setup();
  const hk = await byTitle(repo, "Hollow Knight");
  await repo.updateGame(hk.id, { status: "paused" });
  const list = resumeCandidates(await repo.loadGames()).map((g) => g.title);
  assert.equal(list[0], "Hollow Knight", "paused games first");
  assert.ok(list.includes("STAR WARS™ Knights of the Old Republic™"));
  assert.ok(list.includes("Persona 4 Golden"));
  for (const t of ["Counter-Strike 2", "Marvel Rivals", "Dead by Daylight", "Wallpaper Engine", "Hidden Folks"]) assert.ok(!list.includes(t), t);
});
