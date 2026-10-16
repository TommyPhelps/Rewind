import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVdf, vdfGet } from "../src/meta/vdf.ts";
import { localOwnedGames, parseLocalScan, steamId64 } from "../src/meta/steamLocal.ts";
import { parseOwnedGames, parseSteamIdInput, parseStoreItems, parseStoreSearch, parseTagList, cleanText } from "../src/meta/steam.ts";
import { autoPick, coreKey, titleScore } from "../src/meta/match.ts";
import { steamPlayers, steamTagsToRewind } from "../src/meta/mapping.ts";
import { parseSteamAppInput, searchTerm, keepFiles } from "../src/meta/sync.ts";
import { parseTimeToBeat, hasSteamId } from "../src/meta/igdb.ts";
import { Net, toNetError, type Clock } from "../src/meta/http.ts";
import { buildSteamPlan, planProblems, steamPlanStatements } from "../src/meta/steamImport.ts";
import { fakeSteamFolder, fakeTransport, FAKE_APPS } from "./fakeServices.ts";
import { setup } from "./helpers.ts";

// ---------- VDF ----------

test("VDF: nested sections, escapes, comments, case-insensitive lookup", () => {
  const v = parseVdf(`// comment\n"Root"\n{\n  "Name" "A \\"quoted\\" \\\\ path"\n  "Sub" { "X" "1" }\n}\n`);
  assert.equal(vdfGet(v, "root", "name"), 'A "quoted" \\ path');
  assert.equal(vdfGet(v, "ROOT", "sub", "x"), "1");
  assert.equal(vdfGet(v, "root", "missing"), undefined);
});

test("local Steam files: launched games with playtime, installed games, tools left out", () => {
  const lib = parseLocalScan(fakeSteamFolder());
  assert.equal(lib.accounts.length, 1);
  const acc = lib.accounts[0];
  assert.equal(acc.persona, "Tommy (test)");
  assert.equal(acc.steamId64, steamId64("39734314"));
  assert.equal(acc.steamId64, "76561198000000042");
  assert.equal(acc.apps.get(32370)?.playtimeMin, 2460);
  assert.equal(acc.apps.get(32370)?.lastPlayed, "2026-10-15");
  assert.ok(!acc.apps.has(620), "an app with only cloud settings was never launched");
  const names = new Map([[1245620, "ELDEN RING"], [233860, "Kenshi"], [1145360, "Hades"]]);
  const { games, unnamed } = localOwnedGames(lib, acc, names);
  const titles = games.map((g) => g.name);
  assert.ok(titles.includes("STAR WARS™ Knights of the Old Republic™"));
  assert.ok(titles.includes("Stardew Valley"), "installed but never launched is still offered");
  assert.ok(!titles.some((t) => /Redistributables/.test(t)), "Steamworks runtime is not a game");
  assert.deepEqual(unnamed, [999999], "no store name: reported, not guessed");
  assert.equal(games.find((g) => g.appid === 413150)?.installed, true);
});

// ---------- Steam parsers (shapes recorded from the real endpoints) ----------

const REAL_GETITEMS = {
  response: {
    store_items: [
      {
        item_type: 0, id: 32370, success: 1, visible: true, name: "STAR WARS™ Knights of the Old Republic™", appid: 32370, type: 0,
        tagids: [122, 3942], categories: { supported_player_categoryids: [2], feature_categoryids: [23, 62] },
        basic_info: { short_description: "It is four thousand years before the Galactic Empire&nbsp;&amp; more.", publishers: [{ name: "LucasArts" }, { name: "Aspyr (Mac)", creator_clan_account_id: 31936442 }], developers: [{ name: "BioWare" }, { name: "Aspyr (Mac)" }], franchises: [{ name: "Star Wars" }] },
        tags: [{ tagid: 122, weight: 1542 }, { tagid: 3942, weight: 860 }, { tagid: 9999, weight: 10 }],
        assets: { asset_url_format: "steam/apps/32370/${FILENAME}?t=1681144833", header: "header.jpg", library_capsule: "library_600x900.jpg", library_capsule_2x: "library_600x900_2x.jpg", library_hero: "library_hero.jpg" },
        release: { steam_release_date: 1252146600, original_release_date: 1069228800, mac_release_date: 1337012880 },
        platforms: { windows: true, mac: true, vr_support: {} },
      },
      { item_type: 0, id: 5, success: 3 },
    ],
  },
};

test("Steam store items: facts kept, nothing invented", () => {
  const names = parseTagList({ response: { tags: [{ tagid: 122, name: "RPG" }, { tagid: 3942, name: "Sci-fi" }] } });
  const m = parseStoreItems(REAL_GETITEMS, names);
  assert.equal(m.size, 1, "unknown/hidden apps are absent, not blank");
  const k = m.get(32370)!;
  assert.equal(k.releaseDate, "2003-11-19", "original release date, not the Steam re-release");
  assert.deepEqual(k.developers, ["BioWare", "Aspyr (Mac)"]);
  assert.deepEqual(k.tags.map((t) => t.name), ["RPG", "Sci-fi"], "tags without a known name are dropped");
  assert.deepEqual(k.features, ["Single-player"]);
  assert.deepEqual(k.platforms, ["Windows", "macOS"]);
  assert.equal(k.art.cover?.url, "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/32370/library_600x900.jpg?t=1681144833");
  assert.equal(k.art.cover?.kind, "portrait");
  assert.match(k.description!, /Galactic Empire & more\./);
  assert.equal(k.genres.length, 0, "Steam's GetItems has no genre list; none is made up");
});

test("Steam search, owned games and id parsing", () => {
  const hits = parseStoreSearch({ total: 2, items: [{ type: "app", name: "Portal", id: 400, tiny_image: "x" }, { type: "sub", name: "Bundle", id: 1 }] });
  assert.deepEqual(hits.map((h) => h.appid), [400]);
  const owned = parseOwnedGames({ response: { game_count: 2, games: [{ appid: 400, name: "Portal", playtime_forever: 144, rtime_last_played: 1557057600 }, { appid: 7, playtime_forever: 5 }] } });
  assert.deepEqual(owned.games, [{ appid: 400, name: "Portal", playtimeMin: 144, lastPlayed: "2019-05-05" }]);
  assert.equal(parseOwnedGames({ response: {} }).privateOrEmpty, true, "private profile = empty response, explained to you");
  assert.deepEqual(parseSteamIdInput("https://steamcommunity.com/profiles/76561198000000042/"), { kind: "steamid", id: "76561198000000042" });
  assert.deepEqual(parseSteamIdInput("steamcommunity.com/id/tommy"), { kind: "vanity", name: "tommy" });
  assert.equal(parseSteamIdInput("12345").kind, "invalid");
  assert.equal(parseSteamAppInput("https://store.steampowered.com/app/32370/STAR_WARS/"), 32370);
  assert.equal(parseSteamAppInput("32370"), 32370);
  assert.equal(parseSteamAppInput("kotor"), null);
  assert.equal(cleanText("A&amp;B<br>C"), "A&B\nC");
});

test("player modes come straight from Steam's categories", () => {
  const base = { name: "x", developers: [], publishers: [], genres: [], tags: [], features: [], platforms: [], art: {}, attribution: "" };
  assert.equal(steamPlayers({ ...base, playerCategoryIds: [2] }), "solo");
  assert.equal(steamPlayers({ ...base, playerCategoryIds: [2, 1, 9, 38] }), "solo_and_mp");
  assert.equal(steamPlayers({ ...base, playerCategoryIds: [1, 49, 36] }), "mp_required");
  assert.equal(steamPlayers({ ...base, playerCategoryIds: [9, 38] }), "coop_focused");
  assert.equal(steamPlayers({ ...base, playerCategoryIds: [] }), null, "Steam doesn't say: unknown stays unknown");
});

test("Steam user tags: only well-voted, meaningful tags become REWIND tags", () => {
  const base = { name: "x", developers: [], publishers: [], genres: [], features: [], platforms: [], art: {}, attribution: "" };
  const t = steamTagsToRewind({ ...base, tags: [{ name: "RPG", weight: 1000 }, { name: "Story Rich", weight: 800 }, { name: "Indie", weight: 700 }, { name: "Souls-like", weight: 100 }] });
  assert.deepEqual(t.sort(), ["rpg", "story"], "Indie ignored; a barely-voted tag ignored");
});

test("IGDB: time to beat in hours, Steam cross-check", () => {
  assert.deepEqual(parseTimeToBeat({ hastily: 90000, normally: 147600, completely: 0, count: 12 }), { main: 25, extras: 41, complete: undefined, count: 12 });
  assert.equal(parseTimeToBeat({ count: 3 }), undefined);
  assert.ok(hasSteamId({ external_games: [{ uid: "32370", external_game_source: 1 }] }, 32370));
  assert.ok(hasSteamId({ external_games: [{ url: "https://store.steampowered.com/app/32370" }] }, 32370));
  assert.ok(!hasSteamId({ external_games: [{ url: "https://store.steampowered.com/app/323700" }] }, 32370));
});

// ---------- matching ----------

test("title matching: editions match, sequels never do", () => {
  assert.equal(titleScore("STAR WARS™ Knights of the Old Republic™", "STAR WARS Knights of the Old Republic").reason, "exact");
  assert.ok(["exact", "edition"].includes(titleScore("The Witcher 3: Wild Hunt — Remastered", "The Witcher 3: Wild Hunt").reason));
  assert.equal(titleScore("Sekiro™: Shadows Die Twice - GOTY Edition", "Sekiro: Shadows Die Twice — Deluxe").score >= 0.9, true);
  assert.equal(titleScore("Portal", "Portal 2").reason, "different_number");
  assert.equal(titleScore("DARK SOULS™ II: Scholar of the First Sin", "DARK SOULS™ III").reason, "different_number");
  assert.ok(titleScore("Knights of the Old Republic", "Knights of the Old Republic II - The Sith Lords").score < 0.75);
  assert.equal(coreKey("Sekiro™: Shadows Die Twice - GOTY Edition"), coreKey("Sekiro: Shadows Die Twice"));
  // Two near-identical names: never guessed.
  assert.equal(autoPick("Hard Reset", [{ name: "Hard Reset" }, { name: "Hard Reset Redux" }])?.item.name, "Hard Reset", "the literal title breaks a tie");
  assert.equal(autoPick("Hard Reset Redux", [{ name: "Hard Reset" }, { name: "Hard Reset Redux" }])?.item.name, "Hard Reset Redux");
  assert.equal(autoPick("Hard Reset Classic", [{ name: "Hard Reset" }, { name: "Hard Reset Redux" }]), null, "no literal match: you choose");
  assert.equal(autoPick("Kenshi", [{ name: "Kenshi" }, { name: "Kenshi Soundtrack Extra" }])?.item.name, "Kenshi");
  assert.equal(autoPick("Hard Reset Extended Edition", [{ name: "Hard Reset" }, { name: "Hard Reset Redux" }]), null);
  assert.equal(searchTerm("Batman: Arkham City - Game of the Year Edition"), "Batman: Arkham City");
});

test("art cache: an unchanged image keeps its downloaded file", () => {
  const out = keepFiles(
    { cover: { url: "https://x/a/library_600x900.jpg?t=1", kind: "portrait", file: "artwork/steam-1-cover.jpg" } },
    { cover: { url: "https://x/a/library_600x900.jpg?t=2", kind: "portrait" }, header: { url: "https://x/a/header.jpg", kind: "landscape" } },
  );
  assert.equal(out.cover?.file, "artwork/steam-1-cover.jpg");
  assert.equal(out.header?.file, undefined);
});

// ---------- network layer ----------

test("network errors become plain-language kinds; rate limits wait and retry", async () => {
  assert.equal(toNetError(new Error("offline: dns error")).kind, "offline");
  assert.equal(toNetError(new Error("blocked: REWIND only contacts Steam and IGDB, not evil.com")).kind, "blocked");
  assert.equal(toNetError(new Error("http 404")).kind, "not_found");
  let t = 0;
  const waits: number[] = [];
  const clock: Clock = { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } };
  const net = new Net(fakeTransport({ rateLimitOnce: true }), clock);
  const url = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=" + encodeURIComponent(JSON.stringify({ ids: [{ appid: 400 }] }));
  const j = await net.json<{ response: { store_items: unknown[] } }>({ method: "GET", url });
  assert.equal(j.response.store_items.length, 1);
  assert.ok(waits.some((w) => w >= 1000), "honoured Retry-After");
});

// ---------- Steam import plan ----------

test("Steam import plan: exact, edition, new, tools; nothing personal touched", async () => {
  const repo = await setup();
  let games = await repo.loadGames();
  const kotor = games.find((g) => g.title === "STAR WARS™ Knights of the Old Republic™")!;
  await repo.updateGame(kotor.id, { rating: 5, notes: "my notes", status: "playing" });
  games = await repo.loadGames();
  const owned = parseOwnedGames({ response: { games: FAKE_APPS.filter((a) => [32370, 292030, 409710, 1145360, 1222140, 228980, 400].includes(a.appid)).map((a) => ({ appid: a.appid, name: a.name, playtime_forever: a.appid === 32370 ? 2460 : 60, rtime_last_played: 1790000000 })) } }).games;
  const plan = buildSteamPlan(owned, games);
  const by = (n: string) => plan.rows.find((r) => r.owned.name.startsWith(n))!;
  assert.equal(by("STAR WARS").kind, "exact");
  assert.ok(["exact", "edition"].includes(by("The Witcher 3").kind), "Witcher 3 vs '— Remastered'");
  assert.equal(by("The Witcher 3").action.type, "link");
  assert.ok(["exact", "edition"].includes(by("BioShock").kind), "Remastered vs the original entry: same game");
  assert.equal(by("Hades").kind, "new");
  assert.equal(by("Hades").action.type, "add");
  assert.equal(by("Hunt").action.type, "skip", "test server not ticked");
  assert.equal(by("Steamworks").action.type, "skip");
  assert.equal(by("Portal").kind, "exact");
  assert.deepEqual(planProblems(plan), []);

  const before = games.length;
  const { stmts, summary } = steamPlanStatements(repo, plan, games, { markOwned: true });
  await repo.batch(stmts);
  const after = await repo.loadGames();
  assert.equal(after.length, before + 1, "only Hades added; no duplicates");
  const k = after.find((g) => g.id === kotor.id)!;
  assert.equal(k.steamAppId, 32370);
  assert.equal(k.rating, 5);
  assert.equal(k.notes, "my notes");
  assert.equal(k.status, "playing");
  assert.equal(k.steamPlaytimeMin, 2460);
  assert.equal(k.importedPlaytimeMin, Math.round(37.4 * 60), "the old app's figure is kept separately");
  assert.equal(k.metaSource.steamPlaytime, "steam_api");
  assert.equal(summary.added, 1);

  // Running it again changes nothing and adds nothing.
  const again = buildSteamPlan(owned, after);
  assert.ok(again.rows.filter((r) => r.action.type === "link").every((r) => r.kind === "linked"));
  const res2 = steamPlanStatements(repo, again, after, { markOwned: true });
  await repo.batch(res2.stmts);
  assert.equal((await repo.loadGames()).length, before + 1);
});

test("Steam import: a smaller playtime from this PC never lowers Steam's figure", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const g = games.find((x) => x.title === "ELDEN RING")!;
  const first = buildSteamPlan([{ appid: 1245620, name: "ELDEN RING", playtimeMin: 9700, lastPlayed: "2026-08-02" }], games, "steam_api");
  await repo.batch(steamPlanStatements(repo, first, games, { markOwned: false }).stmts);
  const g2 = await repo.loadGames();
  const second = buildSteamPlan([{ appid: 1245620, name: "ELDEN RING", playtimeMin: 100, lastPlayed: "2026-09-01" }], g2, "steam_local");
  await repo.batch(steamPlanStatements(repo, second, g2, { markOwned: false }).stmts);
  const e = (await repo.loadGames()).find((x) => x.id === g.id)!;
  assert.equal(e.steamPlaytimeMin, 9700);
  assert.equal(e.steamLastPlayed, "2026-09-01");
});

test("Steam import conflicts: two REWIND entries with one title must be resolved by you", async () => {
  const repo = await setup();
  await repo.addGame({ title: "Portal" });
  const games = await repo.loadGames();
  const plan = buildSteamPlan([{ appid: 400, name: "Portal", playtimeMin: 10, lastPlayed: null }], games);
  assert.equal(plan.rows[0].kind, "conflict");
  assert.equal(plan.rows[0].action.type, "skip");
  assert.equal(plan.rows[0].candidates.length, 2);
  // Choosing the same REWIND game for two Steam apps is flagged before anything is saved.
  const p2 = buildSteamPlan([{ appid: 400, name: "Portal", playtimeMin: 1, lastPlayed: null }, { appid: 401, name: "Portal Demo", playtimeMin: 1, lastPlayed: null }], games);
  p2.rows[0].action = { type: "link", gameId: games.find((g) => g.title === "Portal")!.id };
  p2.rows[1].action = { type: "link", gameId: games.find((g) => g.title === "Portal")!.id };
  assert.equal(planProblems(p2).length, 1);
});
