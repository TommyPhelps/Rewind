// Recommendations once Steam metadata is in: the earlier touchstones must still hold,
// store tags must not outweigh your own signals, and explanations say where data came from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, rank, pos, top } from "./helpers.ts";
import { fakeTransport } from "./fakeServices.ts";
import { Net } from "../src/meta/http.ts";
import { DEFAULT_SYNC, MetaSync } from "../src/meta/sync.ts";
import { tagWeight, similarity, buildTaste } from "../src/rec/taste.ts";
import { DEFAULT_PROFILE } from "../src/data/profileDefaults.ts";

async function synced() {
  const repo = await setup();
  await new MetaSync(repo, new Net(fakeTransport(), { now: () => 0, sleep: async () => undefined }), DEFAULT_SYNC).run();
  return repo;
}

test("touchstones still hold with Steam data loaded", async () => {
  const games = await (await synced()).loadGames();
  const story = rank(games, { experience: "story", energy: "medium", commitment: "long" });
  const t10 = top(story, 10);
  for (const bad of ["Kenshi", "Project Zomboid", "The Elder Scrolls V: Skyrim", "Valheim", "7 Days to Die"]) assert.ok(!t10.includes(bad), `${bad} not in top 10: ${t10.join(", ")}`);
  assert.ok(t10.includes("Persona 4 Golden"));
  const mastery = rank(games, { experience: "mastery", energy: "high" });
  for (const x of mastery.results.slice(0, 3)) assert.ok(x.game.tags.some((t) => ["souls", "mastery", "punishing"].includes(t.tag)), x.game.title);
  const cozy = rank(games, { experience: "cozy", energy: "low", time: "lt30" });
  for (const x of cozy.results.slice(0, 5)) assert.ok(!x.game.tags.some((t) => ["souls", "horror", "tense", "punishing", "survival"].includes(t.tag)), x.game.title);
  assert.ok(pos(cozy, "Kenshi") > 20 && pos(cozy, "Project Zomboid") > 20);
  // Steam's "multiplayer required" category keeps PvP games out (your profile excludes them).
  assert.equal(pos(story, "Counter-Strike 2"), -1);
  assert.equal(pos(story, "Marvel Rivals"), -1);
});

test("store-derived tags count less than your own", async () => {
  assert.equal(tagWeight("user"), 1);
  assert.equal(tagWeight("steam_tags"), 0.6);
  const repo = await synced();
  const games = await repo.loadGames();
  const er = games.find((g) => g.title === "ELDEN RING")!;
  const ds = games.find((g) => g.title === "DARK SOULS™ III")!;
  const asUser = { ...ds, tags: ds.tags.map((t) => ({ ...t, source: "user" })) };
  const asStore = { ...ds, tags: ds.tags.map((t) => ({ ...t, source: "steam_tags" })) };
  const taste = buildTaste(games, DEFAULT_PROFILE, []);
  assert.ok(similarity(er, asUser, taste.idf) >= similarity(er, asStore, taste.idf));
});

test("a 1★ rating outweighs every store label", async () => {
  const repo = await synced();
  let games = await repo.loadGames();
  const base = rank(games, { experience: "story" });
  const bg3 = games.find((g) => g.title === "Baldur's Gate 3")!;
  await repo.updateGame(bg3.id, { rating: 1 });
  games = await repo.loadGames();
  const after = rank(games, { experience: "story" });
  assert.ok(pos(after, "Baldur's Gate 3") > pos(base, "Baldur's Gate 3") + 5, `${pos(base, "Baldur's Gate 3")} → ${pos(after, "Baldur's Gate 3")}`);
});

test("explanations name the developer link and the metadata source", async () => {
  const games = await (await synced()).loadGames();
  const r = rank(games, { experience: "story" });
  const me = r.results[pos(r, "Mass Effect™ Legendary Edition")];
  const all = [...me.pros, ...me.cons].map((f) => f.text).join(" | ");
  assert.ok(me.sources.includes("Details: Steam store"), me.sources.join(" | "));
  assert.ok(me.sources.some((s) => /Steam user tags|REWIND reference|old REWIND/.test(s)));
  // BioWare also made KOTOR, which is on your enjoyed list.
  const taste = buildTaste(games, DEFAULT_PROFILE, []);
  assert.ok(taste.devAff.get("BioWare")?.titles.some((t) => t.startsWith("STAR WARS™ Knights")), "BioWare learned from KOTOR");
  assert.ok(me.components.length > 0);
  assert.ok(/Made by BioWare, who also made STAR WARS Knights of the Old Republic, which you enjoyed/.test(all), all);
});
