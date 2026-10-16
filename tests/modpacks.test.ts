import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeTransport, FAKE_CF_KEY } from "./fakeServices.ts";
import { Net, NetError, type Clock } from "../src/meta/http.ts";
import { getPack, searchPacks, toPlainText, sortVersions } from "../src/mods/modrinth.ts";
import { curseCategories, getCursePack, searchCurse } from "../src/mods/curseforge.ts";
import { compareRows, compareVerdict, DEFAULT_PACK_PREFS, normalizePackPrefs, packFit, readPack } from "../src/mods/evidence.ts";
import { DEFAULT_PACK_SEARCH } from "../src/mods/packTypes.ts";

const NOW = new Date("2026-10-16T12:00:00Z");
let waited = 0;
const instant: Clock = { now: () => 0, sleep: async (ms) => void (waited += ms) };
const mk = (opts: Parameters<typeof fakeTransport>[0] = {}) => {
  const t = fakeTransport(opts);
  return { t, net: new Net(t, instant) };
};

test("Modrinth search: filters, loaders split from categories, empty results", async () => {
  const { net } = mk();
  const r = await searchPacks(net, { ...DEFAULT_PACK_SEARCH, categories: ["quests"] });
  assert.deepEqual(r.hits.map((h) => h.title).sort(), ["Gearworks Expert (TEST)", "Lantern Valley (TEST)"]);
  const lantern = r.hits.find((h) => h.title.startsWith("Lantern"))!;
  assert.deepEqual(lantern.loaders, ["fabric"]);
  assert.ok(!lantern.categories.includes("fabric"));
  assert.equal(lantern.key, "mr:p_lantern");
  assert.equal(lantern.pageUrl, "https://modrinth.com/modpack/lantern-valley-test");
  const none = await searchPacks(net, { ...DEFAULT_PACK_SEARCH, query: "zzqqxxyy" });
  assert.equal(none.total, 0);
  assert.deepEqual(none.hits, []);
});

test("Modrinth details: mod list is evidence; quest book verified, quality never claimed", async () => {
  const { net } = mk();
  const d = await getPack(net, "lantern-valley-test", { now: NOW });
  assert.equal(d.mods!.length, 8, "duplicate dependencies are counted once");
  assert.match(d.modsNote, /listed on Modrinth/);
  assert.equal(d.releasesLastYear, 3);
  assert.equal(d.latest!.number, "3.0.0");
  // The description is plain text: no HTML or scripts survive.
  assert.ok(!/<|alert/.test(d.bodyText), d.bodyText);
  // Unsafe links are dropped.
  assert.equal(d.links.discord, undefined);
  const r = readPack(d, NOW);
  assert.equal(r.quests.state, "verified");
  assert.match(r.quests.why, /FTB Quests/);
  assert.match(r.quests.quality, /not how good/);
  assert.equal(r.shaders.state, "included");
  assert.equal(r.difficulty.level, "beginner");
  assert.ok(r.labels.some((l) => l.label === "Quest-driven" && l.evidence === "verified"));
  assert.ok(r.authorClaims.some((c) => /250\+ quests/.test(c)));
  const fit = packFit(d, DEFAULT_PACK_PREFS, NOW, r);
  assert.ok(fit.band === "excellent" || fit.band === "good", fit.band);
  assert.ok(fit.pros.some((p) => /quest book/i.test(p.text)));
});

test("kitchen sink with no quest book reads as aimless; stale packs and disclosures are flagged", async () => {
  const { net } = mk();
  const sink = await getPack(net, "kitchen-chaos-test", { now: NOW, hint: (await searchPacks(net, { ...DEFAULT_PACK_SEARCH, query: "kitchen" })).hits[0] });
  const r = readPack(sink, NOW);
  assert.equal(r.quests.state, "none_found");
  assert.equal(r.complexity.level, "heavy");
  assert.equal(r.maintenance.state, "stale");
  assert.match(r.maintenance.why, /may be abandoned/);
  const fit = packFit(sink, DEFAULT_PACK_PREFS, NOW, r);
  assert.ok(fit.cons.some((c) => /aimless/.test(c.text)), JSON.stringify(fit.cons));
  assert.ok(fit.cons.some((c) => /discloses: advertisements/.test(c.text)));
  // Popular is not the same as good: 5M downloads doesn't beat a maintained quest pack.
  const lantern = await getPack(net, "lantern-valley-test", { now: NOW });
  assert.ok(packFit(lantern, DEFAULT_PACK_PREFS, NOW).score > fit.score);
});

test("expert and archived packs are labelled from evidence", async () => {
  const { net } = mk();
  const gears = readPack(await getPack(net, "gearworks-expert-test", { now: NOW }), NOW);
  assert.equal(gears.difficulty.level, "expert");
  assert.ok(gears.labels.some((l) => l.label === "Technical"));
  const gone = await getPack(net, "archived-adventure-test", { now: NOW });
  const rg = readPack(gone, NOW);
  assert.equal(rg.maintenance.state, "archived");
  assert.ok(packFit(gone, DEFAULT_PACK_PREFS, NOW, rg).cons[0].text.match(/Archived/));
});

test("unavailable packs and service errors", async () => {
  const { net } = mk();
  await assert.rejects(getPack(net, "nonexistent-pack-zz9"), (e: unknown) => e instanceof NetError && e.kind === "not_found");
  const down = mk({ modrinthDown: true });
  await assert.rejects(searchPacks(down.net, DEFAULT_PACK_SEARCH), (e: unknown) => e instanceof NetError && e.kind === "server");
  const off = mk({ failAfter: 0 });
  await assert.rejects(searchPacks(off.net, DEFAULT_PACK_SEARCH), (e: unknown) => e instanceof NetError && e.kind === "offline");
});

test("Modrinth rate limit: waits as told, then carries on", async () => {
  waited = 0;
  const { net, t } = mk({ modrinthRateLimitOnce: true });
  const r = await searchPacks(net, DEFAULT_PACK_SEARCH);
  assert.ok(r.hits.length > 0);
  assert.equal(t.log.filter((l) => l.includes("/v2/search")).length, 2);
  assert.ok(waited >= 1000, `waited ${waited}ms`);
});

test("CurseForge: no key or a wrong key is a clear 'auth' error; with a key, packs load without a mod list", async () => {
  const { net } = mk();
  const cats = await curseCategories(net, null);
  assert.equal(cats.get("Quests"), 4478);
  await assert.rejects(searchCurse(net, "wrong-key", DEFAULT_PACK_SEARCH, cats), (e: unknown) => e instanceof NetError && e.kind === "auth");
  const r = await searchCurse(net, FAKE_CF_KEY, { ...DEFAULT_PACK_SEARCH, categories: ["quests"] }, cats);
  assert.equal(r.hits[0].title, "Stoneheart Quests (TEST)");
  assert.deepEqual(r.hits[0].loaders, ["forge"]);
  assert.deepEqual(r.hits[0].mcVersions, ["1.20.1"]);
  const d = await getCursePack(net, FAKE_CF_KEY, "900001", { now: NOW });
  assert.equal(d.mods, null);
  assert.match(d.modsNote, /doesn't list the mods/);
  const read = readPack(d, NOW);
  assert.equal(read.quests.state, "author");
  assert.ok(read.authorClaims.some((c) => /400 quests/.test(c)));
  await assert.rejects(getCursePack(net, FAKE_CF_KEY, "123"), (e: unknown) => e instanceof NetError && e.kind === "not_found");
});

test("comparison: same rows for every pack, unknowns stay unknown, verdict explains", async () => {
  const { net } = mk();
  const a = await getPack(net, "lantern-valley-test", { now: NOW });
  const b = await getPack(net, "kitchen-chaos-test", { now: NOW });
  const c = (await searchPacks(net, { ...DEFAULT_PACK_SEARCH, query: "featherlight" })).hits[0]; // summary only
  const { rows, fits } = compareRows([a, b, c], DEFAULT_PACK_PREFS, NOW);
  for (const r of rows) assert.equal(r.cells.length, 3, r.label);
  const mods = rows.find((r) => r.label === "Mods")!;
  assert.equal(mods.cells[2].text, "load details");
  assert.ok(fits[2].partial);
  const v = compareVerdict([a, b, c], fits);
  assert.match(v, /Lantern Valley \(TEST\) fits you best/);
  assert.match(v, /details aren't loaded/);
  const shaders = rows.find((r) => r.label === "Shaders")!;
  assert.match(shaders.cells[1].text, /compatibility unknown/);
});

test("pack prefs: version and loader wishes count; bad saved values fall back", async () => {
  const { net } = mk();
  const a = await getPack(net, "lantern-valley-test", { now: NOW });
  const pref = normalizePackPrefs({ weights: { quests: 5, tech: "x" }, mcVersion: "1.21.1", loader: "neoforge" });
  assert.equal(pref.weights.quests, 1);
  assert.equal(pref.weights.tech, DEFAULT_PACK_PREFS.weights.tech);
  const fit = packFit(a, pref, NOW);
  assert.ok(fit.cons.some((c) => /Not available for Minecraft 1\.21\.1/.test(c.text)));
  assert.ok(fit.cons.some((c) => /not neoforge/.test(c.text)));
});

test("helpers: plain text and version order", () => {
  assert.equal(toPlainText("<p>Hi &amp; <i>welcome</i></p><style>x{}</style>![img](a.png) [link](https://x)"), "Hi & welcome\nlink");
  assert.deepEqual(sortVersions(["1.7.10", "1.21.1", "1.20.4", "1.21.1", "26.1"]), ["26.1", "1.21.1", "1.20.4", "1.7.10"]);
});
