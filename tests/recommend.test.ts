// Recommendation behaviour against Tommy's touchstone games. The fixture is a
// slice of his real library (titles + approximate hours) run through the same
// import -> reference data -> taste -> engine pipeline the app uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeDriver } from "./nodeDriver.ts";
import { Repo } from "../src/db/repo.ts";
import { applyArtifactPlan, buildArtifactPlan, parseArtifactBackup } from "../src/migrate/artifactImport.ts";
import { applyReferenceData } from "../src/migrate/reference.ts";
import { buildTaste, type RecEvent } from "../src/rec/taste.ts";
import { DEFAULT_WEIGHTS, diversify, EMPTY_SESSION, recommend, surprisePick, type Session } from "../src/rec/engine.ts";
import { buildSeriesIndex } from "../src/rec/series.ts";
import { DEFAULT_PROFILE } from "../src/data/profileDefaults.ts";
import type { Game } from "../src/lib/types.ts";

const LIB: [string, number][] = [
  ["STAR WARS™ Knights of the Old Republic™", 37.4],
  ["STAR WARS™ Knights of the Old Republic™ II - The Sith Lords™", 4.5],
  ["ELDEN RING", 161.3],
  ["ELDEN RING NIGHTREIGN", 22],
  ["The Witcher 3: Wild Hunt — Remastered", 210.9],
  ["The Witcher 2: Assassins of Kings Enhanced Edition", 52],
  ["Persona 4 Golden", 11.1],
  ["Kenshi", 32.6],
  ["The Elder Scrolls V: Skyrim", 42.3],
  ["Project Zomboid", 75.9],
  ["Cyberpunk 2077", 144],
  ["Portal", 2.4],
  ["Portal 2", 0],
  ["LEGO® Star Wars™: The Skywalker Saga", 15.8],
  ["DARK SOULS™: REMASTERED", 56.7],
  ["DARK SOULS™ III", 15.8],
  ["Sekiro™: Shadows Die Twice - GOTY Edition", 1],
  ["Nioh 2 – The Complete Edition", 0],
  ["Mass Effect™ Legendary Edition", 8],
  ["Baldur's Gate 3", 10],
  ["Disco Elysium - The Final Cut", 2],
  ["Clair Obscur: Expedition 33", 12.9],
  ["Tales of Berseria™", 0],
  ["Hidden Folks", 0],
  ["Old Man's Journey", 0],
  ["Minit", 0],
  ["Stardew Valley", 16],
  ["Valheim", 43],
  ["7 Days to Die", 11.4],
  ["Grand Theft Auto V Legacy", 242.1],
  ["Dead by Daylight", 88.7],
  ["Marvel Rivals", 40.6],
  ["Counter-Strike 2", 310],
  ["Wallpaper Engine", 21.4],
  ["Outlast", 0],
  ["Amnesia: The Dark Descent", 0],
  ["Factorio", 105],
  ["Hollow Knight", 10],
  ["BioShock™", 11],
  ["BioShock® 2", 2],
];

export async function setup() {
  const backup = {
    state: { v: 1, settings: { basis: "plus", solo: true }, slots: {}, log: [] },
    lib0: { g: LIB.map(([n, p]) => ({ id: n.toLowerCase(), n, ...(p ? { p } : {}) })) },
  };
  const repo = new Repo(nodeDriver());
  await repo.init();
  await applyArtifactPlan(repo, buildArtifactPlan(parseArtifactBackup(backup)));
  await applyReferenceData(repo);
  return repo;
}

const NOW = new Date("2026-10-20T20:00:00Z");
const series = buildSeriesIndex();

export function rank(games: Game[], s: Partial<Session> = {}, events: RecEvent[] = [], now = NOW) {
  const taste = buildTaste(games, DEFAULT_PROFILE, events, now);
  return recommend({ games, taste, events, session: { ...EMPTY_SESSION, ...s }, weights: DEFAULT_WEIGHTS, profile: DEFAULT_PROFILE, series, allowUnverified: true, now });
}
export const pos = (r: ReturnType<typeof rank>, title: string) => r.results.findIndex((x) => x.game.title.startsWith(title));
const top = (r: ReturnType<typeof rank>, n: number) => r.results.slice(0, n).map((x) => x.game.title);
const ev = (kind: string, title: string, games: Game[], reason: string | null, ts: string): RecEvent => ({
  id: 0,
  ts,
  kind,
  gameId: games.find((g) => g.title.startsWith(title))!.id,
  reason,
  context: {},
});

test("never suggests multiplayer-dependent games or tools when solo-only", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games);
  const titles = r.results.map((x) => x.game.title);
  for (const t of ["Dead by Daylight", "Marvel Rivals", "Counter-Strike 2", "ELDEN RING NIGHTREIGN", "Wallpaper Engine"]) assert.ok(!titles.includes(t), t);
  assert.ok(r.excluded.some((e) => e.reason === "Need other players" && e.count >= 4));
});

test("Kenshi, Project Zomboid and Skyrim are deprioritised but never banned", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games);
  const n = r.results.length;
  for (const t of ["Kenshi", "Project Zomboid", "The Elder Scrolls V: Skyrim"]) {
    const i = pos(r, t);
    assert.ok(i >= 0, `${t} is still a candidate`);
    assert.ok(i > n / 2, `${t} sits in the lower half (#${i + 1} of ${n})`);
  }
  const pz = r.results[pos(r, "Project Zomboid")];
  assert.ok(pz.cons.some((c) => /struggled/.test(c.text)), "says why");
});

test("time spent is not enjoyment", async () => {
  const games = await (await setup()).loadGames();
  const taste = buildTaste(games, DEFAULT_PROFILE, [], NOW);
  const get = (t: string) => taste.evidence.get(games.find((g) => g.title.startsWith(t))!.id)!;
  assert.ok(get("Project Zomboid").value < 0, "76h but struggled: negative");
  assert.ok(get("Grand Theft Auto V").playtimeOnly, "242h with no other evidence stays playtime-only");
  assert.ok(get("Grand Theft Auto V").weight <= 0.15, "and barely counts");
  assert.ok(get("The Witcher 3").value > 0.5, "listed as enjoyed: positive");
  assert.equal(taste.evidence.get(games.find((g) => g.title === "Counter-Strike 2")!.id), undefined, "multiplayer playtime is ignored");
});

test("burnout on Cyberpunk and Skyrim doesn't count against story RPGs", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { experience: "story" });
  for (const t of ["STAR WARS™ Knights of the Old Republic™ II", "Mass Effect", "Baldur's Gate 3"]) {
    const x = r.results[pos(r, t)];
    assert.ok(!x.cons.some((c) => /Cyberpunk|Skyrim/.test(c.text)), `${t}: ${x.cons.map((c) => c.text).join(" | ")}`);
  }
});

test("KOTOR II is offered as the natural follow-up to KOTOR", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { experience: "story", commitment: "long" });
  const i = pos(r, "STAR WARS™ Knights of the Old Republic™ II");
  assert.ok(i < 8, `top 8 for a long story session (#${i + 1})`);
  assert.ok(r.results[i].pros.some((p) => /follow-up to STAR WARS Knights of the Old Republic/.test(p.text)));
  const k1 = r.results[pos(r, "STAR WARS™ Knights of the Old Republic™")];
  assert.ok(k1.cons.some((c) => /replay/.test(c.text)), "KOTOR itself (37h of ~40h) is treated as a replay");
});

test("strong story + long-term favours story RPGs over sandboxes and replays", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { experience: "story", energy: "medium", commitment: "long" });
  const t10 = top(r, 10);
  for (const bad of ["Kenshi", "Project Zomboid", "The Elder Scrolls V: Skyrim", "ELDEN RING", "Valheim", "7 Days to Die"]) assert.ok(!t10.includes(bad), `${bad} not in top 10: ${t10.join(", ")}`);
  assert.ok(t10.includes("Persona 4 Golden"), "unfinished, enjoyed P4G is suggested");
});

test("mechanical mastery + high energy picks souls-likes you haven't finished", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { experience: "mastery", energy: "high" });
  const t3 = r.results.slice(0, 3);
  for (const x of t3) assert.ok(x.game.tags.some((t) => ["souls", "mastery", "punishing"].includes(t.tag)), x.game.title);
  assert.ok(!t3.some((x) => x.game.title === "ELDEN RING"), "161h Elden Ring is a replay, not a top pick");
  assert.ok(pos(r, "Sekiro") < 3);
});

test("cozy + low energy + under 30 minutes stays gentle", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { experience: "cozy", energy: "low", time: "lt30" });
  for (const x of r.results.slice(0, 5)) {
    assert.ok(!x.game.tags.some((t) => ["souls", "horror", "tense", "punishing", "survival"].includes(t.tag)), x.game.title);
  }
  assert.ok(pos(r, "Kenshi") > 20 && pos(r, "Project Zomboid") > 20);
  assert.ok(pos(r, "Outlast") > 15, "horror sinks");
});

test("avoid list: aimless sandbox and grinding push survival sandboxes down", async () => {
  const games = await (await setup()).loadGames();
  const base = rank(games, { experience: "building", time: "open" });
  const avoid = rank(games, { experience: "building", time: "open", avoid: ["aimless", "grind"] });
  assert.ok(pos(avoid, "Valheim") > pos(base, "Valheim") || pos(avoid, "Valheim") > 20);
  const v = avoid.results[pos(avoid, "7 Days to Die")];
  assert.ok(v.cons.some((c) => /aimless|grind/i.test(c.text)));
});

test("passing lowers a game temporarily, explains why, and fades", async () => {
  const games = await (await setup()).loadGames();
  const events = [
    ev("pass", "Sekiro", games, "too_hard", "2026-10-18T20:00:00Z"),
    ev("pass", "Sekiro", games, "too_hard", "2026-10-19T20:00:00Z"),
  ];
  const before = rank(games, { experience: "mastery", energy: "high" });
  const after = rank(games, { experience: "mastery", energy: "high" }, events);
  assert.ok(pos(after, "Sekiro") > pos(before, "Sekiro"), "drops after two passes");
  const x = after.results[pos(after, "Sekiro")];
  assert.ok(x.deprioritized && /2× recently \(too hard/.test(x.deprioritized.text));
  assert.equal(x.deprioritized!.until, "2026-11-02");
  const taste = buildTaste(games, DEFAULT_PROFILE, events, NOW);
  assert.ok(taste.learned.some((l) => l.trait === "difficulty" && l.delta < 0), "learned a temporary dislike of difficulty");
  const later = new Date("2026-12-31T00:00:00Z");
  const faded = rank(games, { experience: "mastery", energy: "high" }, events, later);
  assert.equal(faded.results[pos(faded, "Sekiro")].deprioritized, null, "gone after the cooldown");
  assert.equal(buildTaste(games, DEFAULT_PROFILE, events, later).learned.length, 0, "learning faded");
  const reset = buildTaste(games, DEFAULT_PROFILE, [...events, { ...events[0], kind: "reset_learning", gameId: null, ts: "2026-10-20T00:00:00Z" }], NOW);
  assert.equal(reset.learned.length, 0, "reset clears learning");
});

test("hide recently passed removes them for the week", async () => {
  const games = await (await setup()).loadGames();
  const events = [ev("pass", "Hidden Folks", games, "not_tonight", "2026-10-19T20:00:00Z")];
  const r = rank(games, { hideRejected: true }, events);
  assert.equal(pos(r, "Hidden Folks"), -1);
  assert.ok(r.excluded.some((e) => e.reason === "Passed on this week"));
});

test("your ratings change what's recommended", async () => {
  const repo = await setup();
  let games = await repo.loadGames();
  const before = rank(games, { experience: "story" });
  const p4 = games.find((g) => g.title === "Persona 4 Golden")!;
  await repo.updateGame(p4.id, { rating: 1 });
  games = await repo.loadGames();
  const after = rank(games, { experience: "story" });
  assert.ok(pos(after, "Persona 4 Golden") > pos(before, "Persona 4 Golden"));
  const score = (r: ReturnType<typeof rank>, t: string) => r.results[pos(r, t)].score;
  assert.ok(score(after, "Tales of Berseria") <= score(before, "Tales of Berseria"), "a similar JRPG doesn't gain from it");
  assert.ok(after.results[pos(after, "Persona 4 Golden")].cons.some((c) => /rated it ★$/.test(c.text) || /★/.test(c.text)), "the rating is cited");
});

test("owned games beat an equal wishlist game", async () => {
  const repo = await setup();
  const games = await repo.loadGames();
  const src = games.find((g) => g.title === "Tales of Berseria™")!;
  const twin: Game = { ...src, id: "twin", title: "Tales of Berseria (wishlist copy)", ownership: "wishlist" };
  const r = rank([...games, twin], { experience: "story", includeWishlist: true });
  assert.ok(pos(r, "Tales of Berseria™") < pos(r, "Tales of Berseria (wishlist copy)"));
  assert.ok(r.results[pos(r, "Tales of Berseria (wishlist")].cons.some((c) => /wishlist/.test(c.text)));
});

test("deterministic: same input, same ranking; Surprise me is seeded", async () => {
  const games = await (await setup()).loadGames();
  const a = top(rank(games, { experience: "immersive" }), 15);
  const b = top(rank(games, { experience: "immersive" }), 15);
  assert.deepEqual(a, b);
  const r = rank(games, { experience: "immersive" });
  assert.equal(surprisePick(r.results, 42)!.game.id, surprisePick(r.results, 42)!.game.id);
  const picks = new Set(Array.from({ length: 30 }, (_, i) => surprisePick(r.results, i)!.game.id));
  assert.ok(picks.size >= 4, "different seeds give variety");
  for (const id of picks) assert.notEqual(r.results.find((x) => x.game.id === id)!.band, "weak");
});

test("every result explains itself and labels estimates", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { experience: "story", energy: "low" });
  for (const x of r.results.slice(0, 10)) {
    assert.ok(x.pros.length >= 1, `${x.game.title} has reasons`);
    assert.ok(x.sources.some((s) => s.startsWith("Tags:")));
    assert.match(x.commitment, /est\.|you|unknown|Endless/i);
  }
  const t = buildTaste(games, DEFAULT_PROFILE, [], NOW);
  const div = diversify(r.results, 5, t.idf);
  assert.equal(div.length, 5);
  assert.equal(new Set(div.map((d) => d.game.id)).size, 5);
});

test("reference data never overwrites your own edits", async () => {
  const repo = new Repo(nodeDriver());
  await repo.init();
  const backup = { state: { settings: {}, slots: {}, log: [] }, lib0: { g: [{ id: "dead by daylight", n: "Dead by Daylight" }] } };
  await applyArtifactPlan(repo, buildArtifactPlan(parseArtifactBackup(backup)));
  const g = (await repo.loadGames())[0];
  await repo.updateGame(g.id, { multiplayer: "solo" });
  await repo.setTags(g.id, ["my-tag"]);
  await applyReferenceData(repo);
  const after = (await repo.loadGames())[0];
  assert.equal(after.multiplayer, "solo");
  assert.deepEqual(after.tags.map((t) => t.tag), ["my-tag"]);
  // …and is offered only once: a tag you remove stays removed.
  const repo2 = await setup();
  const k = (await repo2.loadGames()).find((x) => x.title === "Kenshi")!;
  await repo2.setTags(k.id, k.tags.map((t) => t.tag).filter((t) => t !== "grind"));
  await applyReferenceData(repo2);
  assert.ok(!(await repo2.loadGame(k.id))!.tags.some((t) => t.tag === "grind"));
});

test("'something completely different' avoids games you already know", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { different: true, energy: "low", time: "1to2" });
  for (const x of r.results.slice(0, 5)) {
    assert.ok(!["Portal", "Persona 4 Golden", "LEGO® Star Wars™: The Skywalker Saga"].includes(x.game.title), x.game.title);
    assert.ok(((x.game.importedPlaytimeMin ?? 0) / 60) < 3, `${x.game.title} is new to you`);
  }
});
