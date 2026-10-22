// Epic / Ubisoft Connect / Rockstar: parsing what the launchers keep on a PC, and turning it
// into safe library changes. The fixtures below are shaped like real launcher data (Epic .item
// manifests, Ubisoft and Rockstar registry values); titles and ids are representative examples.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.ts";
import { parseAll, parseEpic, parseRockstar, parseUbisoft, type RawLauncherScan } from "../src/launchers/scan.ts";
import { FAKE_LAUNCHERS as RAW } from "./fixtures/launchers.ts";
import { buildLauncherPlan, launcherStatements } from "../src/launchers/plan.ts";
import { epicLaunch, isAllowedLaunch, launchTarget, steamLaunch, ubisoftLaunch } from "../src/launchers/launch.ts";

test("Epic manifests: games with launch links; DLC, broken installs, tools and unreadable files skipped", () => {
  const e = parseEpic(RAW.epic);
  const titles = e.games.filter((g) => g.isGame).map((g) => g.title);
  assert.deepEqual(titles, ["Hades", "STAR WARS™ Knights of the Old Republic™", "The Elder Scrolls V: Skyrim Special Edition"]);
  assert.ok(!e.games.some((g) => /Soundtrack|Alan Wake/.test(g.title)));
  assert.equal(e.games.find((g) => g.title === "Unreal Engine")?.isGame, false);
  const hades = e.games.find((g) => g.title === "Hades")!;
  assert.equal(hades.launch, "com.epicgames.launcher://apps/min%3Afb39bac8278a4126989f0fe12e7353af%3AMin?action=launch&silent=true");
  assert.ok(isAllowedLaunch(hades.launch!));
  assert.match(e.error ?? "", /couldn't be read/);
});

test("Ubisoft Connect and Rockstar: names from Windows' installed-programs list, launcher itself skipped", () => {
  const u = parseUbisoft(RAW.ubisoft);
  assert.deepEqual(u.games.map((g) => [g.title, g.externalId, g.titleFrom]), [
    ["Assassin's Creed® Valhalla", "5059", "Windows uninstall entry"],
    ["Far Cry 3", "635", "folder name"],
  ]);
  assert.equal(u.games[0].launch, "uplay://launch/5059/0");
  const r = parseRockstar(RAW.rockstar);
  assert.deepEqual(r.games.filter((g) => g.isGame).map((g) => g.title), ["Red Dead Redemption 2"]);
  assert.equal(r.games.find((g) => g.title === "Red Dead Redemption 2")!.launch, null, "no documented launch link for Rockstar");
  assert.ok(r.games.filter((g) => !g.isGame).every((g) => /Launcher|Social Club/.test(g.title)));
});

test("launch links: only well-formed launcher links are allowed", () => {
  assert.equal(steamLaunch(400), "steam://rungameid/400");
  assert.equal(ubisoftLaunch("12;calc"), null);
  assert.equal(epicLaunch("a/b", "c", "d"), null);
  for (const bad of ["steam://install/400", "file:///C:/x.exe", "uplay://launch/1/1", "https://example.com", "com.epicgames.launcher://apps/a%3Ab?action=launch&silent=true"]) assert.equal(isAllowedLaunch(bad), false, bad);
});

test("import plan: same title joins the existing entry, editions stay separate unless you combine them", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const plan = buildLauncherPlan(games, parseAll(RAW));
  const row = (t: string) => plan.rows.find((r) => r.scanned.title === t)!;
  // Exact title (ignoring ™/®): one library entry, now also on Epic.
  const kotor = row("STAR WARS™ Knights of the Old Republic™");
  assert.equal(kotor.action.type, "link");
  assert.equal(kotor.choice, "link");
  // "Skyrim Special Edition" vs the library's "The Elder Scrolls V: Skyrim": maybe the same game, kept separate by default.
  const sse = row("The Elder Scrolls V: Skyrim Special Edition");
  assert.equal(sse.action.type, "maybe");
  assert.equal(sse.choice, "add");
  // Genuinely new games are added.
  assert.equal(row("Hades").action.type, "add");
  assert.equal(row("Red Dead Redemption 2").action.type, "add");
  // Tools are skipped.
  assert.equal(plan.rows.some((r) => r.scanned.title === "Ubisoft Connect"), false);
  assert.equal(row("Unreal Engine").choice, "skip");

  const before = games.find((g) => g.title.startsWith("STAR WARS™ Knights of the Old Republic™"))!;
  await repo.updateGame(before.id, { rating: 5, notes: "mine", status: "playing", favorite: true });
  const { stmts, summary } = launcherStatements(repo, plan);
  await repo.batch(stmts);
  assert.equal(summary.linked, 1);
  assert.ok(summary.added >= 5);
  const after = await repo.loadGames();
  const k = after.find((g) => g.id === before.id)!;
  assert.equal(k.rating, 5);
  assert.equal(k.notes, "mine");
  assert.equal(k.status, "playing");
  assert.equal(k.favorite, true);
  assert.deepEqual(k.sources.map((s) => s.source), ["epic"]);
  assert.equal(k.sources[0].installed, true);
  assert.equal(launchTarget(k)?.source, "epic");
  // Separate editions really are separate entries.
  assert.ok(after.some((g) => g.title === "The Elder Scrolls V: Skyrim Special Edition" && g.sources[0]?.source === "epic"));
  assert.ok(after.some((g) => g.title === "The Elder Scrolls V: Skyrim" && g.sources.length === 0));
  const rdr2 = after.find((g) => g.title === "Red Dead Redemption 2")!;
  assert.equal(rdr2.ownership, "owned");
  assert.equal(rdr2.storefront, "Rockstar Games");
  assert.equal(launchTarget(rdr2), null);

  // Scanning again: nothing duplicates; the same games are just "already known".
  const again = buildLauncherPlan(after, parseAll(RAW));
  assert.equal(again.rows.filter((r) => r.choice !== "skip").every((r) => r.action.type === "known"), true);
  const { summary: s2 } = launcherStatements(repo, again);
  assert.equal(s2.added, 0);

  // A scan with an unreadable manifest never marks anything uninstalled (that file could be the game).
  const withBroken: RawLauncherScan = { ...RAW, epic: { ...RAW.epic, manifests: RAW.epic.manifests.filter((m) => !m.includes("Hades\"")) } };
  assert.equal(buildLauncherPlan(after, parseAll(withBroken)).noLongerInstalled.length, 0);
  // Uninstalled since the last scan: marked not installed, nothing removed.
  const less: RawLauncherScan = { ...RAW, epic: { ...RAW.epic, manifests: RAW.epic.manifests.filter((m) => !m.includes("Hades\"") && !m.startsWith("{ this")) } };
  const p3 = buildLauncherPlan(after, parseAll(less));
  const { stmts: st3, summary: s3 } = launcherStatements(repo, p3);
  await repo.batch(st3);
  assert.equal(s3.uninstalled, 1);
  const hades = (await repo.loadGames()).find((g) => g.title === "Hades")!;
  assert.equal(hades.sources[0].installed, false);
});

test("a game you choose to combine gets both launchers on one entry", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const plan = buildLauncherPlan(games, parseAll(RAW));
  const sse = plan.rows.find((r) => r.scanned.title === "The Elder Scrolls V: Skyrim Special Edition")!;
  sse.choice = "link"; // you said: same game
  const skyrim = games.find((g) => g.title === "The Elder Scrolls V: Skyrim")!;
  assert.equal(sse.target, skyrim.id);
  await repo.setSource(skyrim.id, { source: "steam", externalId: "72850", title: "The Elder Scrolls V: Skyrim", launch: steamLaunch(72850), method: "steam_import" });
  await repo.batch(launcherStatements(repo, plan).stmts);
  const s = (await repo.loadGames()).find((g) => g.id === skyrim.id)!;
  assert.deepEqual(s.sources.map((x) => x.source).sort(), ["epic", "steam"]);
  assert.equal((await repo.loadGames()).filter((g) => /Skyrim/.test(g.title)).length, 1);
});
