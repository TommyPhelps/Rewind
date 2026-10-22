// Discover: personal categories over your library (and, if you connect IGDB, games you
// don't own). Every category says in plain words what qualifies a game for it, and every
// suggestion reuses the same explainable scoring as Pick for me: your ratings, your
// profile, your passes and answers. Popularity is never a reason something is shown.

import { cleanTitle } from "../lib/canon.ts";
import { effectiveLength, fmtHours, releaseYear } from "../lib/library.ts";
import type { Game, GamingProfile } from "../lib/types.ts";
import { DEFAULT_WEIGHTS, EMPTY_SESSION, recommend, type Factor, type Rec } from "../rec/engine.ts";
import { progressRatio, progressState, recentlyPlayed } from "../rec/progress.ts";
import type { SeriesInfo } from "../rec/series.ts";
import { similarity, type RecEvent, type TasteModel } from "../rec/taste.ts";
import { deriveTraits, type Traits } from "../rec/traits.ts";
import { extToGame, libraryIndex, libraryMatch, type BeyondCache, type ExtGame, type Pool } from "./beyond.ts";
import { gameKey, hiddenUntil, igdbKey, isHidden, type Mark } from "./marks.ts";
import type { CategoryId, DiscoverPrefs } from "./prefs.ts";

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** One line under the title. */
  blurb: string;
  /** Exactly what qualifies a game, shown under "How this works". */
  how: string;
  /** IGDB pools this category may draw on for games you don't own (none = library only). */
  pools: Pool[];
}

export const CATEGORIES: Record<CategoryId, CategoryDef> = {
  similar: {
    id: "similar",
    label: "Like your favourites",
    blurb: "Close to the games you rated highest or listed as enjoyed",
    how: "Library games that share rare tags with a favourite (rated 4–5★, marked favourite, or on your 'enjoyed' list), that you haven't really played. Outside your library: games on IGDB's own 'similar games' list for those favourites.",
    pools: ["similar"],
  },
  gems: {
    id: "gems",
    label: "Forgotten gems in your library",
    blurb: "Games you own and never got to, that fit your taste",
    how: "Owned games with under an hour played, still in your backlog, ranked by how well they match your taste. Library only.",
    pools: [],
  },
  finish: {
    id: "finish",
    label: "Finish what you started",
    blurb: "Started but not finished — closest to the end first",
    how: "Paused games and backlog games with an hour or more played that aren't finished, dropped or endless. Ranked by how far in you are (against the main-story estimate) and your taste. Library only.",
    pools: [],
  },
  rpg: {
    id: "rpg",
    label: "Deep RPG adventures",
    blurb: "Long role-playing games with real progression",
    how: "Games tagged RPG that are long: main + extras of at least your 'long' threshold, or a long length class. Outside your library: IGDB role-playing games with a long player-submitted time to beat (or unknown length, flagged).",
    pools: ["rpg"],
  },
  era: {
    id: "era",
    label: "Early-2000s nostalgia",
    blurb: "Older PC and PS2/PS3-era games",
    how: "Games released in your nostalgia years (release year from your own entry, Steam or IGDB), plus games tagged retro with no known year. Finished favourites can appear as replays if you allow it. Outside your library: IGDB games from those years on the platforms you picked.",
    pools: ["era"],
  },
  short: {
    id: "short",
    label: "Short and unforgettable",
    blurb: "Finishable in a few evenings",
    how: "Games whose main story is at most your 'short' threshold (your own hours first, then verified data, then estimates, labelled). Outside your library: IGDB games with a short player-submitted time to beat.",
    pools: ["short"],
  },
  mastery: {
    id: "mastery",
    label: "Games worth mastering",
    blurb: "Skill-driven games that reward practice",
    how: "Games whose tags point to mechanical mastery (souls-likes, precision platformers, roguelikes, tactics…). Traits come from tags, so they're inferred, and labelled that way.",
    pools: ["similar", "rpg", "era", "short"],
  },
  cozy: {
    id: "cozy",
    label: "Cozy but purposeful",
    blurb: "Relaxing games that still give you clear goals",
    how: "Games whose tags point to a relaxed, low-tension feel AND some structure (not aimless sandboxes), with little grind.",
    pools: ["similar", "short", "era"],
  },
  respect: {
    id: "respect",
    label: "Games that respect your time",
    blurb: "Little grind, little setup, clear endings",
    how: "Short or medium games whose tags suggest little grinding and little setup, or that work well in short sessions. Endless games are left out.",
    pools: ["short", "similar"],
  },
  atmosphere: {
    id: "atmosphere",
    label: "Strong atmosphere",
    blurb: "Places that stay with you",
    how: "Games tagged atmospheric, or strong on exploration with some tension, by their tags (inferred).",
    pools: ["similar", "era", "rpg", "short"],
  },
  different: {
    id: "different",
    label: "Something completely different",
    blurb: "Outside your usual genres, without the things you dislike",
    how: "Games that share little with your favourites and recent picks, but still respect your stated dislikes (grind, aimless sandboxes, setup…). Unknown-taste games are labelled as a gamble.",
    pools: ["similar", "era", "rpg", "short"],
  },
};

export interface DiscoverItem {
  key: string;
  game: Game;
  /** In your library (owned, wishlist or not-owned entry) or found on IGDB. */
  inLibrary: boolean;
  ext: ExtGame | null;
  score: number;
  band: Rec["band"];
  pros: Factor[];
  cons: Factor[];
  /** Short facts with their source: "2003 · Steam", "~8h main (IGDB)". */
  facts: string[];
  sources: string[];
  confidence: Rec["confidence"];
  commitment: string;
  mark: Mark | null;
  /** For "Like your favourites": the favourite(s) it resembles. */
  seeds: string[];
  rec: Rec;
}

export interface CategoryResult {
  def: CategoryDef;
  library: DiscoverItem[];
  beyond: DiscoverItem[];
  /** Items left out because you hid them ("Not interested") — they come back later. */
  hiddenCount: number;
  notes: string[];
}

export interface DiscoverInput {
  games: Game[];
  taste: TasteModel;
  events: RecEvent[];
  profile: GamingProfile;
  series: Map<string, SeriesInfo>;
  prefs: DiscoverPrefs;
  marks: Map<string, Mark>;
  beyond: BeyondCache | null;
  allowUnverified: boolean;
  now?: Date;
}

/** Everything Discover needs, computed once per change of library, answers or IGDB cache. */
export interface DiscoverModel {
  input: DiscoverInput;
  /** Library games and IGDB candidates (minus ones already in your library), scored once. */
  recs: Map<string, Rec>;
  extById: Map<string, ExtGame>;
  traits: Map<string, Traits>;
  loved: Game[];
  /** IGDB candidates that turned out to be in your library already. */
  alreadyOwned: number;
  markAff: Map<string, { v: number; titles: string[] }>;
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const hasTag = (g: Game, t: string) => g.tags.some((x) => x.tag === t);

export function buildDiscover(input: DiscoverInput): DiscoverModel {
  const now = input.now ?? new Date();
  const idx = libraryIndex(input.games);
  const extById = new Map<string, ExtGame>();
  const pseudo: Game[] = [];
  let alreadyOwned = 0;
  if (input.beyond && input.prefs.scope !== "library") {
    const nowIso = now.toISOString();
    for (const e of input.beyond.items) {
      if (libraryMatch(e, idx)) {
        alreadyOwned++;
        continue;
      }
      const g = extToGame(e, nowIso);
      extById.set(g.id, e);
      pseudo.push(g);
    }
  }
  const traitsAll = new Map(input.taste.traits);
  for (const g of pseudo) traitsAll.set(g.id, deriveTraits(g, input.allowUnverified));
  const taste: TasteModel = { ...input.taste, traits: traitsAll };
  const markByGame = new Map<string, { kind: string }>();
  for (const m of input.marks.values()) if (m.gameId) markByGame.set(m.gameId, m);
  const all = [...input.games, ...pseudo];
  const base = recommend({
    games: all,
    taste,
    events: input.events,
    session: { ...EMPTY_SESSION, allowSequels: !input.prefs.seriesOrder },
    weights: DEFAULT_WEIGHTS,
    profile: input.profile,
    series: input.series,
    allowUnverified: input.allowUnverified,
    now,
    includeNotOwned: true,
    marks: markByGame,
  });
  const recs = new Map(base.results.map((r) => [r.game.id, r]));
  // Finished games only appear as replays in the nostalgia shelf: score them with a replay session.
  if (input.prefs.includeReplays) {
    const done = input.games.filter((g) => g.status === "completed" || g.status === "replay");
    const rep = recommend({ games: done, taste, events: input.events, session: { ...EMPTY_SESSION, intent: "replay" }, weights: DEFAULT_WEIGHTS, profile: input.profile, series: input.series, allowUnverified: input.allowUnverified, now, marks: markByGame });
    for (const r of rep.results) if (!recs.has(r.game.id)) recs.set(r.game.id, r);
  }
  const loved = input.games.filter((g) => {
    const ev = input.taste.evidence.get(g.id);
    return ev && !ev.playtimeOnly && ev.value >= 0.5;
  });
  // What your Discover answers say about tags: a light, fading nudge (90 days).
  const markAff = new Map<string, { v: number; titles: string[] }>();
  for (const m of input.marks.values()) {
    const age = (now.getTime() - Date.parse(m.updatedAt)) / 86_400_000;
    const fade = Math.max(0, 1 - age / 90);
    if (fade <= 0 || m.key.startsWith("mr:") || m.key.startsWith("cf:")) continue;
    const dir = m.kind === "not_interested" ? -0.6 : m.kind === "want" || m.kind === "wishlist" ? 1 : m.kind === "interested" ? 0.8 : 0;
    if (!dir) continue;
    const g = m.gameId ? input.games.find((x) => x.id === m.gameId) : null;
    const tags = g ? g.tags.map((t) => t.tag) : Array.isArray(m.snapshot.tags) ? (m.snapshot.tags as string[]) : [];
    for (const t of tags) {
      const cur = markAff.get(t) ?? { v: 0, titles: [] };
      cur.v = clamp(cur.v + dir * fade * 0.5);
      if (cur.titles.length < 3 && dir > 0) cur.titles.push(m.title);
      markAff.set(t, cur);
    }
  }
  return { input, recs, extById, traits: new Map([...traitsAll].map(([k, v]) => [k, v.values])), loved, alreadyOwned, markAff };
}

interface Eligible {
  fit: number; // 0..1, how squarely it belongs in the category
  pros: string[];
  cons: string[];
  facts: string[];
  seeds?: string[];
}

function lenFact(g: Game, allowUnverified: boolean): { hours: number; text: string } | null {
  const main = effectiveLength(g, "main", allowUnverified);
  const extra = effectiveLength(g, "main_extras", allowUnverified);
  const best = main ?? extra;
  if (!best) return null;
  const src = best.source === "user" ? "you" : best.source === "igdb" ? "IGDB, player-submitted" : best.verified ? best.source : "estimate";
  return { hours: best.hours, text: `~${fmtHours(best.hours)} ${main ? "main story" : "main + extras"} (${src})` };
}

function yearFact(g: Game, ext: ExtGame | null): { year: number; text: string } | null {
  if (ext?.year) return { year: ext.year, text: `${ext.year} (IGDB)` };
  const y = releaseYear(g);
  if (!y) return null;
  const src = g.releaseYear ? "your entry" : g.meta.steam?.data?.releaseYear ? "Steam" : "IGDB";
  return { year: y, text: `${y} (${src})` };
}

function newToYou(g: Game, mark: Mark | undefined, allowUnverified: boolean): boolean {
  if (mark?.kind === "played") return false;
  if (g.status === "completed" || g.status === "replay" || g.status === "dropped" || g.status === "playing") return false;
  return progressRatio(g, allowUnverified).hours < 1;
}

function eligible(cat: CategoryId, g: Game, m: DiscoverModel, ext: ExtGame | null, mark: Mark | undefined): Eligible | null {
  const { prefs, allowUnverified } = m.input;
  const now = (m.input.now ?? new Date()).getTime();
  const v = m.traits.get(g.id);
  if (!v) return null;
  const fresh = newToYou(g, mark, allowUnverified);
  const len = lenFact(g, allowUnverified);
  const pr = progressRatio(g, allowUnverified);
  const state = progressState(g, allowUnverified, now);
  const tr = m.input.taste.traits.get(g.id) ?? null;
  const scale = tr?.scale ?? (len ? (len.hours < 12 ? "short" : len.hours < 35 ? "medium" : "long") : null);
  const facts: string[] = [];
  const y = yearFact(g, ext);
  if (y) facts.push(y.text);
  if (len) facts.push(len.text);
  switch (cat) {
    case "similar": {
      if (!fresh) return null;
      if (ext) {
        if (!ext.pools.includes("similar")) return null;
        const names = ext.similarTo.map((id) => m.input.games.find((x) => x.id === id)).filter((x): x is Game => !!x).map((x) => cleanTitle(x.title));
        if (!names.length) return null;
        return { fit: Math.min(1, 0.7 + 0.1 * names.length), pros: [`IGDB lists it as similar to ${names.slice(0, 2).join(" and ")}${names.length > 2 ? ` (+${names.length - 2})` : ""}, which you loved`], cons: [], facts, seeds: names };
      }
      let best = 0;
      const seeds: { n: string; s: number }[] = [];
      for (const o of m.loved) {
        if (o.id === g.id) continue;
        const s = similarity(g, o, m.input.taste.idf);
        if (s >= 0.32) seeds.push({ n: cleanTitle(o.title), s });
        best = Math.max(best, s);
      }
      if (best < 0.32) return null;
      seeds.sort((a, b) => b.s - a.s);
      return { fit: Math.min(1, best * 1.4), pros: [], cons: [], facts, seeds: seeds.slice(0, 3).map((x) => x.n) };
    }
    case "gems": {
      if (ext || g.ownership !== "owned" || !fresh || g.status !== "backlog") return null;
      return { fit: 0.6, pros: [pr.hours > 0 ? "In your library, barely touched (under 1h)" : "In your library and never played"], cons: [], facts };
    }
    case "finish": {
      if (ext || mark?.kind === "played" || g.endless || scale === "endless") return null;
      if (g.status === "dropped" || g.status === "completed" || g.status === "replay") return null;
      const paused = g.status === "paused";
      const playing = g.status === "playing";
      if (!(paused || playing || (g.status === "backlog" && state === "started"))) return null;
      if (hasTag(g, "mmo") || g.multiplayer === "mp_required") return null;
      const ratio = pr.ratio;
      const pros: string[] = [];
      const cons: string[] = [];
      if (ratio != null && pr.est) {
        const pct = Math.min(99, Math.round(ratio * 100));
        pros.push(ratio >= 0.6 ? `About ${pct}% through by the estimate (${Math.round(pr.hours)}h of ~${pr.est}h)` : `${Math.round(pr.hours)}h in, of ~${pr.est}h main story`);
      } else if (pr.hours >= 1) pros.push(`${Math.round(pr.hours)}h in (length unknown)`);
      if (paused) pros.push("Paused — your save is waiting");
      if (playing) cons.push("You're already playing it — it's here so the list is complete");
      if (recentlyPlayed(g, now)) pros.push("Played recently");
      const fit = ratio != null ? clamp(0.35 + Math.min(1, ratio) * 0.6, 0, 1) : 0.45;
      return { fit: playing ? fit * 0.6 : paused ? Math.min(1, fit + 0.1) : fit, pros, cons, facts };
    }
    case "rpg": {
      if (!hasTag(g, "rpg")) return null;
      if (!fresh && !(state === "started" || g.status === "paused")) return null;
      const extra = effectiveLength(g, "main_extras", allowUnverified)?.hours ?? null;
      const long = (extra != null && extra >= prefs.longMinHours) || scale === "long";
      if (ext) {
        if (!ext.pools.includes("rpg") && !hasTag(g, "rpg")) return null;
        if (!long && (extra != null || (len && len.hours < prefs.longMinHours * 0.6))) return null;
        return { fit: long ? 0.85 : 0.55, pros: long ? ["A long role-playing game"] : [], cons: long ? [] : ["Length unknown — IGDB has no completion times for it yet"], facts };
      }
      if (!long) return null;
      return { fit: 0.85, pros: ["A long role-playing game"], cons: [], facts };
    }
    case "era": {
      const inRange = y && y.year >= prefs.eraFrom && y.year <= prefs.eraTo;
      const retroNoYear = !y && hasTag(g, "retro");
      if (!inRange && !retroNoYear) return null;
      if (ext && !ext.pools.includes("era") && !inRange) return null;
      const replay = g.status === "completed" || g.status === "replay" || state === "likely_finished";
      if (replay && !prefs.includeReplays) return null;
      if (replay) {
        const ev = m.input.taste.evidence.get(g.id);
        if (!ev || ev.value < 0.4) return null;
        return { fit: 0.75, pros: [`Released ${y?.year ?? "back then"} — a favourite worth revisiting`], cons: [], facts };
      }
      if (mark?.kind === "played") return null;
      const pros = [inRange ? `Released in ${y!.year}` : "Tagged retro (release year unknown)"];
      if (ext) {
        const plats = ext.platforms.filter((p) => /playstation 2|playstation 3|pc \(microsoft windows\)|xbox|gamecube|wii|^playstation$/i.test(p));
        if (plats.length) pros.push(`On ${plats.slice(0, 3).join(", ")}`);
      }
      return { fit: inRange ? 0.8 : 0.5, pros, cons: [], facts };
    }
    case "short": {
      if (!fresh || g.endless || scale === "endless") return null;
      const main = effectiveLength(g, "main", allowUnverified);
      const h = main?.hours ?? (scale === "short" ? null : undefined);
      if (h === undefined) return null;
      if (h != null && h > prefs.shortMaxHours) return null;
      if (h == null && scale !== "short") return null;
      const fit = h != null ? clamp(1 - h / (prefs.shortMaxHours * 2), 0.4, 1) : 0.5;
      return { fit, pros: [h != null ? `A short one: about ${fmtHours(h)} for the main story` : "Short by its length class"], cons: [], facts };
    }
    case "mastery": {
      if (!fresh && state !== "started") return null;
      if ((v.mastery ?? 0) < 0.6) return null;
      return { fit: clamp((v.mastery ?? 0) * 1.05, 0, 1), pros: ["Rewards skill and practice (from its tags)"], cons: (v.difficulty ?? 0) >= 0.9 ? ["Known for being very hard"] : [], facts };
    }
    case "cozy": {
      if (!fresh && state !== "started") return null;
      if ((v.cozy ?? 0) < 0.55 || (v.tension ?? 0) > 0.5) return null;
      if (v.structure != null && v.structure < 0.4) return null;
      if ((v.grind ?? 0) > 0.75) return null;
      const pros = ["Relaxed and low-tension (from its tags)"];
      if (v.structure != null && v.structure >= 0.55) pros.push("Has clear goals to work towards");
      return { fit: clamp((v.cozy ?? 0) * 0.7 + (v.structure ?? 0.5) * 0.3, 0, 1), pros, cons: v.structure == null ? ["How structured it is isn't known"] : [], facts };
    }
    case "respect": {
      if (!fresh && state !== "started") return null;
      if (g.endless || scale === "endless" || scale === "long") return null;
      if ((v.grind ?? 0.5) > 0.45 || (v.setup ?? 0.5) > 0.55) return null;
      const quick = (v.quick ?? 0) >= 0.6;
      if (!(scale === "short" || scale === "medium" || quick)) return null;
      const pros = [`Little grind or setup${len ? `, done in ${len.text.replace(/^~/, "about ")}` : ""}`];
      if (quick) pros.push("Works in short sessions");
      return { fit: 0.7 + (quick ? 0.15 : 0) + (scale === "short" ? 0.1 : 0), pros, cons: [], facts };
    }
    case "atmosphere": {
      if (!fresh && state !== "started") return null;
      const atmos = hasTag(g, "atmospheric");
      const expl = (v.exploration ?? 0) >= 0.7 && (v.tension ?? 0) >= 0.4;
      if (!atmos && !expl) return null;
      return { fit: atmos ? 0.85 : 0.6, pros: [atmos ? "Tagged atmospheric" : "Exploration with an edge of tension (from its tags)"], cons: [], facts };
    }
    case "different": {
      if (!fresh) return null;
      if (!g.tags.length) return null;
      let maxSim = 0;
      for (const o of m.loved) if (o.id !== g.id) maxSim = Math.max(maxSim, similarity(g, o, m.input.taste.idf));
      const recent = m.input.events.filter((e) => e.kind === "accept" && e.gameId && now - Date.parse(e.ts) < 30 * 86_400_000).map((e) => m.input.games.find((x) => x.id === e.gameId)).filter((x): x is Game => !!x);
      for (const o of recent) if (o.id !== g.id) maxSim = Math.max(maxSim, similarity(g, o, m.input.taste.idf));
      if (maxSim > 0.22) return null;
      const known = m.input.taste.tagAff.size > 0 && g.tags.some((t) => m.input.taste.tagAff.has(t.tag));
      return { fit: clamp(0.9 - maxSim * 2, 0.3, 1), pros: ["Shares little with your favourites and recent picks"], cons: known ? [] : ["A gamble: none of its tags appear in games you've rated"], facts };
    }
  }
}

const BAND = (s: number): Rec["band"] => (s >= 0.42 ? "excellent" : s >= 0.26 ? "good" : s >= 0.1 ? "fair" : "weak");

/** One category, best first. Library and outside-the-library results are kept apart. */
export function discoverCategory(m: DiscoverModel, cat: CategoryId, limits = { library: 60, beyond: 40 }): CategoryResult {
  const def = CATEGORIES[cat];
  const { prefs } = m.input;
  const now = m.input.now ?? new Date();
  const lib: DiscoverItem[] = [];
  const out: DiscoverItem[] = [];
  let hiddenCount = 0;
  const notes: string[] = [];
  for (const r of m.recs.values()) {
    const g = r.game;
    const ext = m.extById.get(g.id) ?? null;
    if (ext && (!def.pools.length || prefs.scope === "library")) continue;
    if (ext && !ext.pools.some((p) => def.pools.includes(p)) && cat !== "similar") continue;
    const key = ext ? igdbKey(ext.igdbId) : gameKey(g.id);
    const mark = m.input.marks.get(key);
    const el = eligible(cat, g, m, ext, mark);
    if (!el) continue;
    if (isHidden(mark, now, prefs.hideDays)) {
      hiddenCount++;
      continue;
    }
    if (r.heldBack && cat !== "finish") continue;
    // Your answers: a light nudge from tags you said yes / no to.
    let aff = 0;
    const affTitles = new Set<string>();
    let affN = 0;
    for (const t of g.tags) {
      const a = m.markAff.get(t.tag);
      if (!a) continue;
      aff += a.v;
      affN++;
      if (a.v > 0) a.titles.filter((x) => x !== g.title).forEach((x) => affTitles.add(x));
    }
    const affScore = affN ? clamp(aff / affN) * 0.08 : 0;
    const scopeAdj = ext ? (prefs.scope === "library_first" ? -0.06 : 0) : 0.02;
    const markAdj = mark?.kind === "want" ? 0.08 : mark?.kind === "interested" || mark?.kind === "wishlist" ? 0.05 : 0;
    const score = r.score * 0.75 + (el.fit - 0.5) * 0.3 + affScore + scopeAdj + markAdj;
    const pros: Factor[] = el.pros.map((text) => ({ text, v: 0.5 }));
    if (el.seeds?.length && !ext) pros.unshift({ text: `Similar to ${el.seeds.slice(0, 2).join(" and ")}, which you loved`, v: 0.6 });
    if (affScore > 0.02 && affTitles.size) pros.push({ text: `Shares tags with games you saved in Discover (${[...affTitles].slice(0, 2).map(cleanTitle).join(", ")})`, v: affScore });
    const seen = new Set(pros.map((p) => p.text));
    for (const p of r.pros) if (!seen.has(p.text) && !(el.seeds?.length && p.text.startsWith("Similar to "))) pros.push(p);
    const cons: Factor[] = el.cons.map((text) => ({ text, v: -0.3 }));
    if (affScore < -0.02) cons.push({ text: "Shares tags with things you marked Not interested", v: affScore });
    for (const c of r.cons) {
      if (cons.some((x) => x.text === c.text)) continue;
      // Resuming is the whole point of "Finish what you started".
      if (cat === "finish" && c.text.startsWith("You started this before")) continue;
      cons.push(c);
    }
    const until = hiddenUntil(mark, prefs.hideDays);
    if (mark?.kind === "not_interested" && until) cons.push({ text: `You said 'Not interested' before; it came back on ${until}`, v: -0.05 });
    const item: DiscoverItem = {
      key,
      game: g,
      inLibrary: !ext,
      ext,
      score,
      band: BAND(score),
      pros: pros.slice(0, 4),
      cons: cons.slice(0, 3),
      facts: el.facts,
      sources: ext ? [...r.sources.filter((s) => !s.startsWith("Enjoyment")), ...(ext.similarTo.length ? ["Similar-games list: IGDB.com"] : []), ...(ext.ttb ? ["Completion times: IGDB (player-submitted)"] : [])] : r.sources,
      confidence: ext ? { level: r.confidence.level === "high" ? "medium" : r.confidence.level, notes: [...r.confidence.notes, "Not in your library: judged from IGDB genres and themes only"] } : r.confidence,
      commitment: r.commitment,
      mark: mark ?? null,
      seeds: el.seeds ?? [],
      rec: r,
    };
    (ext ? out : lib).push(item);
  }
  const order = (a: DiscoverItem, b: DiscoverItem) => b.score - a.score || a.game.title.localeCompare(b.game.title);
  lib.sort(order);
  out.sort(order);
  if (def.pools.length && prefs.scope !== "library" && !m.input.beyond) notes.push("Connect IGDB (free Twitch keys) to also see games you don't own here.");
  return { def, library: lib.slice(0, limits.library), beyond: out.slice(0, limits.beyond), hiddenCount, notes };
}

/** Counts per category, for the category list (cheap enough to run for all of them). */
export function categoryCounts(m: DiscoverModel, ids: CategoryId[]): Record<string, { library: number; beyond: number }> {
  const out: Record<string, { library: number; beyond: number }> = {};
  for (const id of ids) {
    const r = discoverCategory(m, id, { library: 9999, beyond: 9999 });
    out[id] = { library: r.library.length, beyond: r.beyond.length };
  }
  return out;
}

/** Items you've saved (Interested / Want to try / Wishlisted), newest first, with live data when available. */
export function savedItems(m: DiscoverModel): { key: string; mark: Mark; game: Game | null; ext: ExtGame | null; rec: Rec | null }[] {
  const out: { key: string; mark: Mark; game: Game | null; ext: ExtGame | null; rec: Rec | null }[] = [];
  const byId = new Map(m.input.games.map((g) => [g.id, g]));
  for (const mark of m.input.marks.values()) {
    if (mark.key.startsWith("mr:") || mark.key.startsWith("cf:")) continue;
    if (mark.kind !== "interested" && mark.kind !== "want" && mark.kind !== "wishlist") continue;
    const game = mark.gameId ? byId.get(mark.gameId) ?? null : null;
    const ext = mark.key.startsWith("igdb:") ? m.extById.get(mark.key) ?? null : null;
    const rec = m.recs.get(game?.id ?? mark.key) ?? null;
    out.push({ key: mark.key, mark, game, ext, rec });
  }
  const rank = { want: 0, wishlist: 1, interested: 2 } as Record<string, number>;
  return out.sort((a, b) => rank[a.mark.kind] - rank[b.mark.kind] || b.mark.updatedAt.localeCompare(a.mark.updatedAt));
}

/** Snapshot stored with an answer, so saved items still show offline. */
export function snapshotOf(item: { game: Game; ext: ExtGame | null }): Record<string, unknown> {
  const e = item.ext;
  const g = item.game;
  return {
    title: g.title,
    year: e?.year ?? releaseYear(g) ?? null,
    coverUrl: e?.coverId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${e.coverId}.jpg` : null,
    storeUrl: e?.steamAppId ? `https://store.steampowered.com/app/${e.steamAppId}/` : g.steamAppId ? `https://store.steampowered.com/app/${g.steamAppId}/` : null,
    pageUrl: e?.pageUrl ?? null,
    genres: e?.genres ?? [],
    tags: g.tags.map((t) => t.tag),
    developers: e?.developers ?? [],
    summary: e?.summary ?? null,
    ttb: e?.ttb ?? null,
    steamAppId: e?.steamAppId ?? g.steamAppId ?? null,
    igdbId: e?.igdbId ?? null,
    savedAt: new Date().toISOString(),
  };
}
