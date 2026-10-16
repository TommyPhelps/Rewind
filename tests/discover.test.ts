import { test } from "node:test";
import assert from "node:assert/strict";
import { NOW, setup } from "./helpers.ts";
import { fakeTransport } from "./fakeServices.ts";
import { Net, NetError, type Clock } from "../src/meta/http.ts";
import { buildTaste } from "../src/rec/taste.ts";
import { buildSeriesIndex } from "../src/rec/series.ts";
import { DEFAULT_PROFILE } from "../src/data/profileDefaults.ts";
import { buildDiscover, categoryCounts, discoverCategory, savedItems, snapshotOf } from "../src/discover/engine.ts";
import { DEFAULT_DISCOVER_PREFS, normalizePrefs, CATEGORY_IDS, type DiscoverPrefs } from "../src/discover/prefs.ts";
import { fetchBeyond, describeBeyondError, basisChanged, type BeyondDeps, type BeyondCache } from "../src/discover/beyond.ts";
import { getToken } from "../src/meta/igdb.ts";
import { gameKey, hiddenUntil, hideDays, igdbKey, isHidden, type Mark } from "../src/discover/marks.ts";
import { DEFAULT_WEIGHTS, EMPTY_SESSION, recommend } from "../src/rec/engine.ts";
import type { Repo } from "../src/db/repo.ts";
import type { Game } from "../src/lib/types.ts";

const instant: Clock = { now: () => 0, sleep: async () => undefined };
const series = buildSeriesIndex();
const byTitle = (games: Game[], t: string) => games.find((g) => g.title.startsWith(t))!;

async function model(repo: Repo, opts: { prefs?: Partial<DiscoverPrefs>; beyond?: BeyondCache | null; now?: Date } = {}) {
  const games = await repo.loadGames();
  const events = await repo.loadRecEvents();
  const marks = new Map((await repo.loadMarks()).map((m) => [m.key, m] as const));
  const now = opts.now ?? NOW;
  const taste = buildTaste(games, DEFAULT_PROFILE, events, now);
  return buildDiscover({ games, taste, events, profile: DEFAULT_PROFILE, series, prefs: { ...DEFAULT_DISCOVER_PREFS, ...opts.prefs }, marks, beyond: opts.beyond ?? null, allowUnverified: true, now });
}

function deps(repo: Repo, opts: Parameters<typeof fakeTransport>[0] = {}, creds = { clientId: "testclient", clientSecret: "testsecret" }): BeyondDeps & { t: ReturnType<typeof fakeTransport> } {
  const t = fakeTransport(opts);
  const net = new Net(t, instant);
  return {
    t,
    net,
    creds,
    token: () => getToken(net, creds),
    getCache: (k, d) => repo.getCache(k, d),
    setCache: (k, v) => repo.setCache(k, v),
  };
}

test("library categories: each explains itself and only uses your library without IGDB", async () => {
  const repo = await setup();
  const m = await model(repo);
  const counts = categoryCounts(m, CATEGORY_IDS);
  for (const id of CATEGORY_IDS) assert.equal(counts[id].beyond, 0, id);
  const finish = discoverCategory(m, "finish");
  const titles = finish.library.map((x) => x.game.title);
  // KOTOR (37h of ~40h) is the obvious one to finish; untouched games never appear here.
  assert.ok(titles.some((t) => t.startsWith("STAR WARS™ Knights of the Old Republic™")), titles.join(" | "));
  assert.ok(!titles.includes("Hidden Folks"));
  // Gems are owned, untouched backlog games.
  const gems = discoverCategory(m, "gems");
  assert.ok(gems.library.length > 0);
  for (const it of gems.library) {
    assert.equal(it.game.ownership, "owned");
    assert.ok(it.pros.length > 0);
    assert.match(it.pros[0].text, /never played|barely touched/);
  }
  // Without IGDB, categories that could look further say how.
  assert.match(discoverCategory(m, "rpg").notes.join(" "), /Connect IGDB/);
});

test("short category respects your threshold and never lists endless games", async () => {
  const repo = await setup();
  const m = await model(repo, { prefs: { shortMaxHours: 6 } });
  const short = discoverCategory(m, "short");
  for (const it of short.library) {
    assert.ok(!it.game.endless);
    const main = it.game.lengths.filter((l) => l.kind === "main").map((l) => l.hours);
    if (main.length) assert.ok(Math.min(...main) <= 6, `${it.game.title} ${main}`);
  }
});

test("'Not interested' hides an item for a while, longer each time, then it comes back", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const hf = byTitle(games, "Hidden Folks");
  const before = discoverCategory(await model(repo), "short").library.map((x) => x.game.id);
  assert.ok(before.includes(hf.id), "Hidden Folks is short and untouched");
  const m1 = await repo.setMark({ key: gameKey(hf.id), kind: "not_interested", title: hf.title, gameId: hf.id });
  assert.equal(m1.times, 1);
  assert.equal(hideDays(1), 90);
  let r = discoverCategory(await model(repo, { now: new Date() }), "short");
  assert.ok(!r.library.some((x) => x.game.id === hf.id));
  assert.ok(r.hiddenCount >= 1);
  // Saying it again doubles the time.
  const m2 = await repo.setMark({ key: gameKey(hf.id), kind: "not_interested", title: hf.title, gameId: hf.id });
  assert.equal(m2.times, 2);
  assert.equal(hideDays(2), 180);
  // 200 days later it's back, with a note that you passed on it.
  const later = new Date(Date.now() + 200 * 86_400_000);
  assert.ok(!isHidden(m2, later));
  r = discoverCategory(await model(repo, { now: later }), "short");
  const back = r.library.find((x) => x.game.id === hf.id);
  assert.ok(back, "came back after the hide period");
  assert.ok(back!.cons.some((c) => /Not interested/.test(c.text)));
  // It also counted as a pass in Pick for me (which fades the same way).
  const passes = (await repo.loadRecEvents()).filter((e) => e.kind === "pass" && e.gameId === hf.id);
  assert.equal(passes.length, 2);
  assert.equal(passes[0].reason, "not_interested");
});

test("answers never change your library: wishlist / played are only remembered", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const g = byTitle(games, "Minit");
  await repo.setMark({ key: gameKey(g.id), kind: "played", title: g.title, gameId: g.id });
  const after = (await repo.loadGames()).find((x) => x.id === g.id)!;
  assert.equal(after.status, g.status);
  assert.equal(after.ownership, g.ownership);
  assert.equal((await repo.loadGames()).length, games.length);
  // "Already played" takes it out of new-to-you shelves.
  const m = await model(repo);
  for (const id of ["gems", "short", "similar", "different"] as const) assert.ok(!discoverCategory(m, id).library.some((x) => x.game.id === g.id), id);
  // An unowned wishlist item is stored with a snapshot, not added to the library.
  await repo.setMark({ key: igdbKey(2001), kind: "wishlist", title: "Ashen Crown (TEST)", snapshot: { title: "Ashen Crown (TEST)", year: 2005 } });
  assert.equal((await repo.loadGames()).length, games.length);
  const saved = savedItems(await model(repo));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].mark.snapshot.year, 2005);
});

test("Want to try lifts a game in Pick for me and says why", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const taste = buildTaste(games, DEFAULT_PROFILE, [], NOW);
  const g = byTitle(games, "Tales of Berseria");
  const run = (marks?: Map<string, { kind: string }>) => recommend({ games, taste, events: [], session: EMPTY_SESSION, weights: DEFAULT_WEIGHTS, profile: DEFAULT_PROFILE, series, allowUnverified: true, now: NOW, marks });
  const base = run().results.find((r) => r.game.id === g.id)!;
  const want = run(new Map([[g.id, { kind: "want" }]])).results.find((r) => r.game.id === g.id)!;
  assert.ok(want.score > base.score);
  assert.ok(want.pros.some((p) => /Want to try/.test(p.text)));
});

test("beyond the library: IGDB candidates, owned games recognised, adult content filtered", async () => {
  const repo = await setup();
  // Rate Elden Ring and KOTOR 5★ so they become seeds.
  const games = await repo.loadGames();
  await repo.updateGame(byTitle(games, "ELDEN RING").id, { rating: 5 });
  await repo.updateGame(byTitle(games, "STAR WARS™ Knights of the Old Republic™").id, { rating: 5 });
  const g2 = await repo.loadGames();
  const taste = buildTaste(g2, DEFAULT_PROFILE, [], NOW);
  const d = deps(repo);
  const cache = await fetchBeyond(d, g2, taste, DEFAULT_DISCOVER_PREFS);
  const names = cache.items.map((i) => i.name);
  assert.ok(names.includes("Iron Vow (TEST)"));
  assert.ok(names.includes("Ashen Crown (TEST)"));
  assert.ok(!names.some((n) => /adult/i.test(n)), "erotic theme is never fetched");
  const iron = cache.items.find((i) => i.name === "Iron Vow (TEST)")!;
  assert.equal(iron.steamAppId, 777001);
  assert.ok(iron.pools.includes("similar"));
  assert.ok(iron.similarTo.length >= 1);
  const m = await model(repo, { beyond: cache });
  // Hollow Knight is on IGDB's similar list but already in the library (by Steam app id): never shown as not owned.
  assert.ok(m.alreadyOwned >= 1);
  const sim = discoverCategory(m, "similar");
  assert.ok(!sim.beyond.some((x) => x.game.title === "Hollow Knight"));
  const ironItem = sim.beyond.find((x) => x.game.title === "Iron Vow (TEST)");
  assert.ok(ironItem, sim.beyond.map((x) => x.game.title).join(", "));
  assert.equal(ironItem!.inLibrary, false);
  assert.match(ironItem!.pros[0].text, /IGDB lists it as similar to/);
  assert.ok(ironItem!.cons.some((c) => /don't own/.test(c.text)));
  assert.ok(ironItem!.sources.some((s) => /IGDB/.test(s)));
  // No made-up numbers: no prices or scores anywhere in what's shown.
  const shown = JSON.stringify({ pros: ironItem!.pros, cons: ironItem!.cons, facts: ironItem!.facts, sources: ironItem!.sources });
  assert.ok(!/\$|score|rating|price/i.test(shown), shown);
  // Era pool: PS2-era RPG.
  const era = discoverCategory(m, "era");
  assert.ok(era.beyond.some((x) => x.game.title === "Ashen Crown (TEST)"));
  // "My library first" keeps library results in their own list.
  assert.ok(era.library.every((x) => x.inLibrary));
  // Only my library: nothing from IGDB.
  const lib = await model(repo, { beyond: cache, prefs: { scope: "library" } });
  assert.equal(discoverCategory(lib, "similar").beyond.length, 0);
  // Snapshots keep enough to show a wishlist item offline.
  const snap = snapshotOf(ironItem!);
  assert.equal(snap.storeUrl, "https://store.steampowered.com/app/777001/");
  assert.match(String(snap.coverUrl), /^https:\/\/images\.igdb\.com\//);
});

test("beyond the library: wrong keys and offline are handled with clear messages", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const taste = buildTaste(games, DEFAULT_PROFILE, [], NOW);
  // Wrong secret: a clear message, nothing cached.
  const bad = deps(repo, {}, { clientId: "testclient", clientSecret: "wrong" });
  await assert.rejects(fetchBeyond(bad, games, taste, DEFAULT_DISCOVER_PREFS), (e: unknown) => {
    assert.ok(e instanceof NetError);
    assert.match(describeBeyondError(e), /refused your Client ID or Secret/);
    return true;
  });
  // Offline.
  const off = deps(repo, { failAfter: 0 });
  await assert.rejects(fetchBeyond(off, games, taste, DEFAULT_DISCOVER_PREFS), (e: unknown) => e instanceof NetError && e.kind === "offline" && /offline/i.test(describeBeyondError(e)));
  // Settings changes are noticed so the cache can be refreshed.
  const ok = await fetchBeyond(deps(repo), games, taste, DEFAULT_DISCOVER_PREFS);
  assert.equal(basisChanged(ok, DEFAULT_DISCOVER_PREFS), false);
  assert.equal(basisChanged(ok, { ...DEFAULT_DISCOVER_PREFS, eraTo: 2012 }), true);
});

test("Discover prefs: bad saved values fall back safely", () => {
  const p = normalizePrefs({ order: ["era", "nope"], hidden: ["gems", 5], scope: "weird", eraFrom: 2010, eraTo: 1990, shortMaxHours: 900, eraPlatforms: ["ps2", "n64"] });
  assert.deepEqual(p.order.slice(0, 1), ["era"]);
  assert.equal(p.order.length, CATEGORY_IDS.length);
  assert.deepEqual(p.hidden, ["gems"]);
  assert.equal(p.scope, "library_first");
  assert.ok(p.eraTo >= p.eraFrom);
  assert.equal(p.shortMaxHours, 30);
  assert.deepEqual(p.eraPlatforms, ["ps2"]);
});

test("hiddenUntil reads the date from your last answer", () => {
  const m: Mark = { key: "game:x", kind: "not_interested", title: "X", gameId: "x", snapshot: {}, times: 1, note: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  assert.equal(hiddenUntil(m), "2026-04-01");
  assert.equal(hiddenUntil({ ...m, kind: "interested" }), null);
});
