// REWIND 5 library tools: new filters, combining duplicates, the check-up and session corrections.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.ts";
import { DEFAULT_FILTERS, activeFilters, filterGames, genresOf, launchersOf } from "../src/lib/library.ts";
import { mergePreview, mergeStatements, preferredKeeper } from "../src/lib/merge.ts";
import { auditLibrary } from "../src/lib/audit.ts";
import { blankMeta } from "../src/meta/sync.ts";

test("filters: launcher, genre, playtime, rating and Up Next; active filters are listed for clearing", async () => {
  const repo = await setup();
  let games = await repo.loadGames();
  const kotor = games.find((g) => g.title.startsWith("STAR WARS™ Knights of the Old Republic™") && !g.title.includes("II"))!;
  const portal = games.find((g) => g.title === "Portal")!;
  await repo.setSource(kotor.id, { source: "epic", externalId: "x", title: kotor.title, installed: true, launch: null, method: "local_scan" });
  await repo.updateGame(portal.id, { rating: 5 });
  await repo.saveMeta([blankMeta(portal.id, "steam", { providerId: "400", status: "linked", method: "steam_id", data: { name: "Portal", developers: [], publishers: [], genres: ["Action", "Puzzle"], tags: [], features: [], platforms: [], art: {}, attribution: "Steam" } })]);
  games = await repo.loadGames();
  const f = (patch: Partial<typeof DEFAULT_FILTERS>, up?: Set<string>) => filterGames(games, { ...DEFAULT_FILTERS, ...patch }, true, up).map((g) => g.id);

  assert.deepEqual(f({ launcher: "epic" }), [kotor.id]);
  assert.ok(f({ launcher: "none" }).includes(portal.id));
  assert.deepEqual(launchersOf(games.find((g) => g.id === kotor.id)!), ["epic"]);
  assert.deepEqual(genresOf(games.find((g) => g.id === portal.id)!), ["Action", "Puzzle"]);
  assert.deepEqual(f({ genre: "puzzle" }), [portal.id]);
  assert.ok(f({ query: "puzzle" }).includes(portal.id), "search also finds genres");
  assert.deepEqual(f({ rating: "5" }), [portal.id]);
  assert.ok(!f({ rating: "unrated" }).includes(portal.id));
  // Playtime buckets follow the imported hours (Portal: 2.4h, Portal 2: never played).
  assert.ok(f({ playtime: "2to10" }).includes(portal.id));
  assert.ok(f({ playtime: "none" }).includes(games.find((g) => g.title === "Portal 2")!.id));
  assert.deepEqual(f({ upNext: true }, new Set([portal.id])), [portal.id]);
  assert.deepEqual(activeFilters({ ...DEFAULT_FILTERS, query: "x", status: "playing", genre: "RPG", favorite: true }).sort(), ["favorite", "genre"]);
});

test("combining two entries keeps all your data on one game and removes the other", async () => {
  const repo = await setup();
  const a = await repo.addGame({ title: "Deus Ex", status: "completed", rating: 5, notes: "First run: pacifist" });
  const b = await repo.addGame({ title: "Deus Ex: Game of the Year Edition", notes: "GOTY copy", favorite: true, tags: ["immersive sim"] });
  await repo.setTags(a.id, ["rpg"]);
  await repo.setSource(b.id, { source: "steam", externalId: "6910", title: b.title, launch: "steam://rungameid/6910", method: "steam_import", playtimeMin: 600 });
  await repo.updateGame(b.id, { steamAppId: 6910 });
  await repo.addSession(b.id, "2026-10-01", 45, "Liberty Island");
  await repo.setMark({ key: `game:${b.id}`, kind: "interested", title: b.title, gameId: b.id });
  const [A, B] = [await repo.loadGame(a.id), await repo.loadGame(b.id)];
  const [keep, drop] = preferredKeeper(A!, B!);
  assert.equal(keep.id, a.id, "the entry with your rating and status is kept");
  const pv = mergePreview(keep, drop);
  assert.equal(pv.status, "completed");
  assert.match(pv.notes, /pacifist[\s\S]*GOTY copy/);
  const before = (await repo.loadGames()).length;
  await repo.batch(mergeStatements(repo, keep, drop));
  const after = await repo.loadGames();
  assert.equal(after.length, before - 1);
  const k = after.find((g) => g.id === a.id)!;
  assert.equal(k.rating, 5);
  assert.equal(k.status, "completed");
  assert.equal(k.favorite, true);
  assert.equal(k.steamAppId, 6910);
  assert.deepEqual(k.tags.map((t) => t.tag).sort(), ["immersive sim", "rpg"]);
  assert.deepEqual(k.sources.map((s) => [s.source, s.playtimeMin]), [["steam", 600]]);
  assert.ok(k.notes.includes("pacifist") && k.notes.includes("GOTY copy"));
  const sessions = await repo.loadSessions();
  assert.equal(sessions.find((s) => s.note === "Liberty Island")!.gameId, a.id);
  assert.ok((await repo.loadMarks()).some((m) => m.key === `game:${a.id}`));
  assert.ok(!after.some((g) => g.id === b.id));
  assert.ok((await repo.recentEvents(5)).some((e) => e.type === "games_merged"));
  assert.throws(() => mergeStatements(repo, k, k), /same entry/);
});

test("library check-up: gaps, duplicates, possible editions and suspicious store links", async () => {
  const repo = await setup();
  await repo.addGame({ title: "Hades" });
  await repo.addGame({ title: "HADES" });
  await repo.addGame({ title: "The Elder Scrolls V: Skyrim Special Edition" });
  let games = await repo.loadGames();
  const kenshi = games.find((g) => g.title === "Kenshi")!;
  await repo.saveMeta([blankMeta(kenshi.id, "steam", { providerId: "233860", status: "linked", method: "search", data: { name: "Kenshi Soundtrack", developers: [], publishers: [], genres: [], tags: [], features: [], platforms: [], art: {}, attribution: "Steam" } })]);
  games = await repo.loadGames();
  const a = auditLibrary(games);
  assert.ok(a.duplicates.some((d) => d.kind === "same" && d.a.title.toLowerCase() === "hades" && d.b.title.toLowerCase() === "hades"));
  assert.ok(a.duplicates.some((d) => d.kind === "edition" && [d.a.title, d.b.title].includes("The Elder Scrolls V: Skyrim Special Edition")));
  assert.deepEqual(a.mismatches.map((m) => [m.game.title, m.listedAs]), [["Kenshi", "Kenshi Soundtrack"]]);
  assert.equal(a.gapCounts.cover, games.length, "no art in the fixture");
  assert.ok(a.lookupIds.length > 0 && a.lookupIds.length <= games.length);
  // Dismissed findings stay dismissed.
  const d = auditLibrary(games, new Set([...a.duplicates.map((x) => "dup:" + x.key), ...a.mismatches.map((m) => m.key)]));
  assert.equal(d.duplicates.length, 0);
  assert.equal(d.mismatches.length, 0);
  // "Not on Steam" (your answer) isn't looked up again by the check-up.
  await repo.saveMeta([blankMeta(kenshi.id, "steam", { status: "none", method: "user" })]);
  assert.ok(!auditLibrary(await repo.loadGames()).lookupIds.includes(kenshi.id));
});

test("sessions: timed sessions are labelled, and any session can be corrected", async () => {
  const repo = await setup();
  const g = (await repo.loadGames())[0];
  const id = await repo.addSession(g.id, "2026-10-20", 95, "", "timed");
  let s = (await repo.loadSessions()).find((x) => x.id === id)!;
  assert.equal(s.source, "timed");
  await repo.updateSession(id, { minutes: 80, note: "forgot to stop", date: "2026-10-19" });
  s = (await repo.loadSessions()).find((x) => x.id === id)!;
  assert.deepEqual([s.minutes, s.note, s.date], [80, "forgot to stop", "2026-10-19"]);
  await assert.rejects(repo.updateSession(id, { minutes: 5000 }), /Minutes/);
  await assert.rejects(repo.updateSession(id, { date: "yesterday" }), /date/);
});

test("explanations are about the game: generic reasons are dropped and facts come only from its data", async () => {
  const { explain, gameFacts } = await import("../src/rec/explain.ts");
  const repo = await setup();
  const g = (await repo.loadGames()).find((x) => x.title === "Hollow Knight")!;
  await repo.updateGame(g.id, { developer: "Team Cherry" });
  const game = (await repo.loadGame(g.id))!;
  const rec = {
    game,
    pros: [{ text: "Already in your library", v: 0.1 }, { text: "Similar to DARK SOULS III, which you enjoyed", v: 0.5 }],
    cons: [{ text: "Probably harder than you want right now", v: -0.3 }],
  } as unknown as Parameters<typeof explain>[0];
  const e = explain(rec);
  assert.deepEqual(e.reasons, ["Similar to DARK SOULS III, which you enjoyed"]);
  assert.equal(e.caveat, "Probably harder than you want right now");
  assert.match(e.facts, /Team Cherry/);
  // A game REWIND knows nothing about gets no invented facts.
  const bare = await repo.addGame({ title: "Unknown Thing" });
  assert.equal(gameFacts(bare), "");
});
