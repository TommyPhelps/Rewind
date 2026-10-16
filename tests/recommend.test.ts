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
import { diversify, surprisePick } from "../src/rec/engine.ts";
import { DEFAULT_PROFILE } from "../src/data/profileDefaults.ts";
import type { Game } from "../src/lib/types.ts";
import { NOW, pos, rank, setup, top } from "./helpers.ts";

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

test("KOTOR at 37h of ~40h counts as unfinished, so KOTOR II waits for it", async () => {
  // Tommy is still playing KOTOR. Hours just short of a rough estimate never mean "finished".
  const games = await (await setup()).loadGames();
  const r = rank(games, { experience: "story", commitment: "long" });
  const k2 = r.results[pos(r, "STAR WARS™ Knights of the Old Republic™ II")];
  assert.ok(k2.heldBack, "sequel held back while KOTOR is unfinished");
  assert.ok(k2.cons.some((c) => /Follow-up to STAR WARS Knights of the Old Republic/.test(c.text)), k2.cons.map((c) => c.text).join(" | "));
  const k1 = r.results[pos(r, "STAR WARS™ Knights of the Old Republic™")];
  assert.ok(!k1.cons.some((c) => /would be a replay/.test(c.text)), "KOTOR itself is not treated as a replay");
  assert.ok(k1.pros.some((p) => /Close to the end/.test(p.text)), k1.pros.map((p) => p.text).join(" | "));
  const resume = rank(games, { intent: "resume" });
  assert.ok(top(resume, 100).includes("STAR WARS™ Knights of the Old Republic™"), "KOTOR is something to continue");
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
  const r = rank(games, { intent: "different", energy: "low", time: "1to2" });
  for (const x of r.results.slice(0, 5)) {
    assert.ok(!["Portal", "Persona 4 Golden", "LEGO® Star Wars™: The Skywalker Saga"].includes(x.game.title), x.game.title);
    assert.ok(((x.game.importedPlaytimeMin ?? 0) / 60) < 3, `${x.game.title} is new to you`);
  }
});

// ---------- v2.5: session intent and series follow-ups ----------

import { normalizeSession } from "../src/rec/engine.ts";

async function withStatus(changes: [string, import("../src/lib/types.ts").Status][]) {
  const repo = await setup();
  for (const [title, status] of changes) {
    const g = (await repo.loadGames()).find((x) => x.title.startsWith(title))!;
    await repo.updateGame(g.id, { status });
  }
  return { repo, games: await repo.loadGames() };
}

test("Continue: only the game(s) you're playing", async () => {
  const { games } = await withStatus([["STAR WARS™ Knights of the Old Republic™", "playing"]]);
  const r = rank(games, { intent: "continue" });
  assert.deepEqual(r.results.map((x) => x.game.title), ["STAR WARS™ Knights of the Old Republic™"]);
  assert.ok(r.results[0].pros.some((p) => /currently playing/.test(p.text)));
});

test("a sequel waits while you're still playing the game before it", async () => {
  const { games } = await withStatus([["STAR WARS™ Knights of the Old Republic™", "playing"]]);
  for (const intent of ["any", "new"] as const) {
    const r = rank(games, { intent, experience: "story", commitment: "long" });
    const i = pos(r, "STAR WARS™ Knights of the Old Republic™ II");
    if (i === -1) {
      assert.equal(intent, "new", "only 'Start new' may leave it out entirely (it's 4.5h in)");
      continue;
    }
    const x = r.results[i];
    assert.ok(x.heldBack, `${intent}: held back`);
    assert.ok(i >= 10, `${intent}: not a top-10 starting point (#${i + 1})`);
    assert.ok(x.cons.some((c) => /still playing STAR WARS Knights of the Old Republic/.test(c.text)), x.cons.map((c) => c.text).join(" | "));
  }
  // …unless you ask for it.
  const allowed = rank(games, { intent: "any", experience: "story", commitment: "long", allowSequels: true });
  assert.equal(allowed.results[pos(allowed, "STAR WARS™ Knights of the Old Republic™ II")].heldBack, false);
});

test("once the first game is finished, the sequel becomes the natural follow-up", async () => {
  const { games } = await withStatus([["STAR WARS™ Knights of the Old Republic™", "completed"]]);
  const r = rank(games, { experience: "story", commitment: "long" });
  const x = r.results[pos(r, "STAR WARS™ Knights of the Old Republic™ II")];
  assert.ok(!x.heldBack);
  assert.ok(x.pros.some((p) => /follow-up to STAR WARS Knights of the Old Republic, which you've finished/.test(p.text)));
  assert.ok(pos(r, "STAR WARS™ Knights of the Old Republic™ II") < 8);
});

test("Resume: paused and part-played games only", async () => {
  const { games } = await withStatus([["Hollow Knight", "paused"]]);
  const r = rank(games, { intent: "resume" });
  const titles = r.results.map((x) => x.game.title);
  assert.ok(titles.includes("Hollow Knight"));
  assert.ok(titles.includes("Persona 4 Golden"), "11h in, never finished");
  assert.ok(!titles.includes("Hidden Folks"), "never started");
  assert.ok(!titles.includes("ELDEN RING"), "played through, that's a replay");
});

test("Start new: nothing you've already started", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { intent: "new" });
  for (const x of r.results) assert.ok((x.game.importedPlaytimeMin ?? 0) < 60, x.game.title);
});

test("Replay: familiar games you loved come first", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { intent: "replay" });
  const t5 = top(r, 5);
  assert.ok(t5.some((t) => ["ELDEN RING", "The Witcher 3: Wild Hunt — Remastered", "STAR WARS™ Knights of the Old Republic™", "DARK SOULS™: REMASTERED"].includes(t)), t5.join(", "));
  for (const x of r.results) assert.ok((x.game.importedPlaytimeMin ?? 0) >= 60 * 1, `${x.game.title} is familiar`);
  assert.ok(!r.results[0].cons.some((c) => /would be a replay/.test(c.text)), "no replay penalty when you asked for one");
});

test("long dialogue-heavy RPGs are not treated as low-energy picks", async () => {
  const games = await (await setup()).loadGames();
  const r = rank(games, { energy: "low", experience: "story", commitment: "long" });
  const p4 = r.results[pos(r, "Persona 4 Golden")];
  assert.ok(p4.cons.some((c) => /concentration|dialogue/i.test(c.text)), p4.cons.map((c) => c.text).join(" | "));
  const disco = r.results[pos(r, "Disco Elysium")];
  assert.ok(disco.cons.some((c) => /concentration|dialogue/i.test(c.text)));
});

test("saved v2.1 sessions are read correctly", () => {
  assert.equal(normalizeSession({ progress: "continue" }).intent, "resume");
  assert.equal(normalizeSession({ progress: "new" }).intent, "new");
  assert.equal(normalizeSession({ different: true }).intent, "different");
  assert.equal(normalizeSession({ intent: "bogus" }).intent, "any");
  const s = normalizeSession({ energy: "low", avoid: ["grind"] });
  assert.equal(s.energy, "low");
  assert.deepEqual(s.avoid, ["grind"]);
  assert.equal(s.allowSequels, false);
  assert.ok(!("progress" in s) && !("different" in s));
});
