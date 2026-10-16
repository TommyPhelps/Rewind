// REWIND's recommendation engine. Deterministic: the same library, history and
// session settings always give the same ranking. No AI service is involved.
//
// Each game gets a handful of component scores in -1..+1 (mood fit, energy, time,
// commitment, your taste, your history with it, structure, difficulty, things to
// avoid, recent passes, series order, ownership and progress). Only components you
// actually set take part; their weights are normalised before combining. Every
// component also produces plain-language reasons, which become the "why it fits"
// and "why it might not" lists.

import { cleanTitle } from "../lib/canon.ts";
import { displayLength, fmtHours } from "../lib/library.ts";
import { SOURCE_LABEL, type Game, type GamingProfile, type Scale } from "../lib/types.ts";
import { pole, TRAIT_LABEL, NOT_A_GAME, type Trait } from "./traits.ts";
import { developersOf, REASONS, similarity, tagWeight, type RecEvent, type TasteModel } from "./taste.ts";
import { seriesNeighbours, type SeriesInfo } from "./series.ts";
import { progressRatio, progressState, recentlyPlayed } from "./progress.ts";

// ---------- session ----------

export type Experience = "immersive" | "story" | "mastery" | "cozy" | "exploration" | "building" | "strategy" | "nostalgic" | "unusual";
export type Energy = "low" | "medium" | "high";
export type TimeAvail = "lt30" | "30to60" | "1to2" | "2to4" | "open";
export type Commitment = "one" | "few" | "medium" | "long";
export type StructurePref = "guided" | "balanced" | "open";
export type DifficultyPref = "gentle" | "moderate" | "challenging";
export type AvoidKey = "setup" | "difficulty" | "grind" | "dialogue" | "aimless" | "tutorials" | "commitment" | "horror" | "multiplayer";
/** What you want to do this session. */
export type Intent = "any" | "continue" | "resume" | "new" | "replay" | "different";
export const INTENT_LABEL: Record<Intent, string> = {
  any: "Anything",
  continue: "Continue my current game",
  resume: "Resume something paused",
  new: "Start something new",
  replay: "Replay something familiar",
  different: "Something completely different",
};

export interface Session {
  experience: Experience | null;
  energy: Energy | null;
  time: TimeAvail | null;
  commitment: Commitment | null;
  structure: StructurePref | null;
  difficulty: DifficultyPref | null;
  avoid: AvoidKey[];
  intent: Intent;
  includeWishlist: boolean;
  hideRejected: boolean;
  /** Suggest a sequel even while an earlier game in the series is unfinished. */
  allowSequels: boolean;
}

export const EMPTY_SESSION: Session = {
  experience: null,
  energy: null,
  time: null,
  commitment: null,
  structure: null,
  difficulty: null,
  avoid: [],
  intent: "any",
  includeWishlist: false,
  hideRejected: false,
  allowSequels: false,
};

/** Reads a saved session, including ones saved by v2.1 (progress/different fields). */
export function normalizeSession(raw: Record<string, unknown> | null | undefined): Session {
  const r = { ...(raw ?? {}) } as Record<string, unknown>;
  let intent = (r.intent as Intent) ?? "any";
  if (!r.intent) {
    if (r.different) intent = "different";
    else if (r.progress === "continue") intent = "resume";
    else if (r.progress === "new") intent = "new";
  }
  delete r.progress;
  delete r.different;
  const s = { ...EMPTY_SESSION, ...(r as Partial<Session>), intent };
  if (!Object.prototype.hasOwnProperty.call(INTENT_LABEL, s.intent)) s.intent = "any";
  if (!Array.isArray(s.avoid)) s.avoid = [];
  return s;
}

export const EXPERIENCE_LABEL: Record<Experience, string> = {
  immersive: "Immersive adventure",
  story: "Strong story",
  mastery: "Mechanical mastery",
  cozy: "Cozy relaxation",
  exploration: "Exploration",
  building: "Creative building",
  strategy: "Strategic thinking",
  nostalgic: "Something nostalgic",
  unusual: "Something unusual",
};
export const ENERGY_LABEL: Record<Energy, string> = { low: "Low", medium: "Medium", high: "High" };
export const TIME_LABEL: Record<TimeAvail, string> = { lt30: "Under 30 min", "30to60": "30–60 min", "1to2": "1–2 hours", "2to4": "2–4 hours", open: "Open-ended" };
export const COMMIT_LABEL: Record<Commitment, string> = { one: "One session", few: "A few evenings", medium: "A medium-length game", long: "A long-term game" };
export const STRUCTURE_LABEL: Record<StructurePref, string> = { guided: "Guided", balanced: "Balanced", open: "Open / sandbox" };
export const DIFFICULTY_LABEL: Record<DifficultyPref, string> = { gentle: "Gentle", moderate: "Moderate", challenging: "Challenging" };
export const AVOID_LABEL: Record<AvoidKey, string> = {
  setup: "Complicated setup",
  difficulty: "High difficulty",
  grind: "Repetitive grinding",
  dialogue: "Long dialogue",
  aimless: "Aimless sandbox",
  tutorials: "Excessive tutorials",
  commitment: "Large time commitment",
  horror: "Horror / high tension",
  multiplayer: "Multiplayer dependency",
};

// ---------- weights ----------

export interface Weights {
  mood: number;
  energyTime: number;
  commitment: number;
  taste: number;
  structure: number;
  variety: number;
  library: number;
}
export const DEFAULT_WEIGHTS: Weights = { mood: 1, energyTime: 1, commitment: 1, taste: 1, structure: 1, variety: 1, library: 1 };
export const WEIGHT_LABEL: Record<keyof Weights, string> = {
  mood: "Matches the mood you picked",
  energyTime: "Fits your energy and time",
  commitment: "Fits the commitment you want",
  taste: "Matches your taste and history",
  structure: "Structure and difficulty",
  variety: "Variety (passes, series order)",
  library: "Owned and in-progress games",
};

type CompKey = "mood" | "energy" | "time" | "commitment" | "taste" | "history" | "structure" | "difficulty" | "avoid" | "passes" | "series" | "novelty" | "ownership" | "progress";
const COMPONENTS: Record<CompKey, { label: string; base: number; group: keyof Weights | null }> = {
  mood: { label: "Mood", base: 1.6, group: "mood" },
  energy: { label: "Energy", base: 0.9, group: "energyTime" },
  time: { label: "Time", base: 0.7, group: "energyTime" },
  commitment: { label: "Commitment", base: 0.8, group: "commitment" },
  taste: { label: "Your taste", base: 1.3, group: "taste" },
  history: { label: "Your history with it", base: 0.8, group: "taste" },
  structure: { label: "Structure", base: 0.5, group: "structure" },
  difficulty: { label: "Difficulty", base: 0.6, group: "structure" },
  avoid: { label: "Things to avoid", base: 1.6, group: null },
  passes: { label: "Recent passes", base: 0.9, group: "variety" },
  series: { label: "Series order", base: 0.8, group: "variety" },
  novelty: { label: "Something different", base: 1.4, group: null },
  ownership: { label: "Ownership", base: 0.5, group: "library" },
  progress: { label: "Progress", base: 0.7, group: "library" },
};

// ---------- results ----------

export interface Factor {
  text: string;
  v: number; // weighted, signed contribution
}

export interface Rec {
  game: Game;
  score: number;
  band: "excellent" | "good" | "fair" | "weak";
  confidence: { level: "high" | "medium" | "low"; notes: string[] };
  pros: Factor[];
  cons: Factor[];
  components: { key: CompKey; label: string; score: number; weight: number }[];
  commitment: string;
  sources: string[];
  deprioritized: { text: string; until: string } | null;
  /** A sequel waiting for an unfinished earlier game. */
  heldBack: boolean;
}

export interface RecResult {
  results: Rec[];
  excluded: { reason: string; count: number }[];
  considered: number;
}

export interface RecInput {
  games: Game[];
  taste: TasteModel;
  events: RecEvent[];
  session: Session;
  weights: Weights;
  profile: GamingProfile;
  series: Map<string, SeriesInfo>;
  allowUnverified: boolean;
  now?: Date;
  /** Discover only: also score games outside your library (built from IGDB data). */
  includeNotOwned?: boolean;
  /** Your Discover answers for library games, by game id ("Want to try", "Already played"…). */
  marks?: Map<string, { kind: string }>;
}

export const BAND_LABEL: Record<Rec["band"], string> = { excellent: "Excellent fit", good: "Good fit", fair: "Possible fit", weak: "Weak fit" };

// ---------- helpers ----------

/** Signed match of a game's traits against a list of (trait, direction) wishes. */
function traitMatch(v: Record<Trait, number | null>, wishes: [Trait, number][]): { s: number; known: number; hits: { t: Trait; c: number }[] } {
  let s = 0;
  let w = 0;
  let known = 0;
  const hits: { t: Trait; c: number }[] = [];
  for (const [t, dir] of wishes) {
    const x = v[t];
    if (x == null) continue;
    known++;
    const c = pole(x) * dir;
    s += c;
    w += Math.abs(dir);
    hits.push({ t, c });
  }
  return { s: w ? s / w : 0, known, hits: hits.sort((a, b) => Math.abs(b.c) - Math.abs(a.c)) };
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const hasTag = (g: Game, t: string) => g.tags.some((x) => x.tag === t);
const isGroupGame = (g: Game) => g.multiplayer === "mp_required" || g.multiplayer === "coop_focused";

const MOOD: Record<Experience, { wishes: [Trait, number][]; tags?: Record<string, number>; want: string; lack: string }> = {
  immersive: { wishes: [["exploration", 1], ["story", 0.6]], tags: { atmospheric: 0.25, openworld: 0.15, rpg: 0.15, adventure: 0.15 }, want: "an immersive world", lack: "Not especially immersive" },
  story: { wishes: [["story", 1.2], ["dialogue", 0.3]], tags: { narrative: 0.2 }, want: "a strong story", lack: "Light on story" },
  mastery: { wishes: [["mastery", 1.2], ["difficulty", 0.5]], tags: { souls: 0.2 }, want: "mechanical mastery", lack: "Not much of a skill challenge" },
  cozy: { wishes: [["cozy", 1.2], ["tension", -0.8], ["difficulty", -0.6]], want: "something cozy", lack: "Not especially cozy or relaxing" },
  exploration: { wishes: [["exploration", 1.2]], tags: { metroidvania: 0.15 }, want: "exploration", lack: "Not much to explore" },
  building: { wishes: [["building", 1.2]], want: "creative building", lack: "Little or no building" },
  strategy: { wishes: [["strategy", 1.2]], want: "strategic thinking", lack: "Not much strategy" },
  nostalgic: { wishes: [["retro", 1]], want: "something nostalgic", lack: "Not especially nostalgic" },
  unusual: { wishes: [["unusual", 1]], want: "something unusual", lack: "Fairly conventional" },
};

/**
 * For a game that HAS tags, a "presence" trait no tag mentions most likely isn't a
 * big part of it (a tagged RPG with no building tag isn't a building game).
 * Untagged games stay unknown.
 */
const ABSENT: Partial<Record<Trait, number>> = { building: 0.2, strategy: 0.25, exploration: 0.3, story: 0.3, cozy: 0.3, mastery: 0.35, unusual: 0.2, retro: 0.15, quick: 0.4 };
function withAbsent(v: Record<Trait, number | null>, tagged: boolean): Record<Trait, number | null> {
  if (!tagged) return v;
  const o = { ...v };
  for (const [t, d] of Object.entries(ABSENT) as [Trait, number][]) if (o[t] == null) o[t] = d;
  return o;
}

const ENERGY_WISH: Record<Energy, [Trait, number][]> = {
  // Tired evenings: not just "no reflexes" — long reading and heavy concentration are tiring too.
  low: [["energy", -1], ["difficulty", -0.7], ["tension", -0.6], ["focus", -0.6], ["setup", -0.5], ["dialogue", -0.35], ["grind", -0.2]],
  medium: [],
  high: [["energy", 0.6], ["mastery", 0.4], ["difficulty", 0.2]],
};
const TIME_WISH: Record<TimeAvail, [Trait, number][]> = {
  lt30: [["quick", 1.2], ["setup", -0.8], ["story", -0.3], ["dialogue", -0.3], ["focus", -0.3]],
  "30to60": [["quick", 0.6], ["setup", -0.4]],
  "1to2": [["quick", 0.15]],
  "2to4": [["quick", -0.2], ["story", 0.15]],
  open: [],
};
const COMMIT_FIT: Record<Commitment, Record<Scale, number>> = {
  one: { short: 1, medium: -0.3, long: -0.8, endless: 0.2 },
  few: { short: 0.8, medium: 0.5, long: -0.6, endless: -0.1 },
  medium: { short: 0.1, medium: 1, long: -0.2, endless: -0.3 },
  long: { short: -0.5, medium: 0.2, long: 1, endless: 0.3 },
};
const SCALE_TEXT: Record<Scale, string> = { short: "Short", medium: "Medium length", long: "Long", endless: "Endless / sandbox" };
const STRUCTURE_TARGET: Record<StructurePref, number> = { guided: 0.85, balanced: 0.6, open: 0.3 };

function srcLabel(s: string | null | undefined): string {
  if (!s) return "unknown";
  if (s === "legacy" || s === "legacy_table") return "old REWIND table, est.";
  if (s === "reference") return "REWIND reference, est.";
  if (s === "ai_estimate") return "old AI lookup, est.";
  if (s === "user") return "you";
  return SOURCE_LABEL[s] ?? s;
}


function passPenalty(gameId: string, events: RecEvent[], now: Date): { pen: number; count: number; until: string | null; reasons: string[] } {
  let pen = 0;
  let count = 0;
  let until = 0;
  const reasons: string[] = [];
  for (const e of events) {
    if (e.kind !== "pass" || e.gameId !== gameId) continue;
    const def = REASONS[e.reason ?? "not_tonight"] ?? REASONS.not_tonight;
    const t = Date.parse(e.ts);
    const age = (now.getTime() - t) / 86400000;
    if (age >= def.cooldownDays) continue;
    pen += def.weight * (1 - age / def.cooldownDays);
    count++;
    until = Math.max(until, t + def.cooldownDays * 86400000);
    reasons.push(def.label.toLowerCase());
  }
  return { pen: Math.min(1, pen), count, until: until ? new Date(until).toISOString().slice(0, 10) : null, reasons };
}

// ---------- main ----------

export function recommend(input: RecInput): RecResult {
  const { games, taste, events, session: S, weights, profile, series, allowUnverified } = input;
  const now = input.now ?? new Date();
  const excluded = new Map<string, number>();
  const ex = (r: string) => excluded.set(r, (excluded.get(r) ?? 0) + 1);
  const solo = profile.excludeMultiplayerDependent || S.avoid.includes("multiplayer");
  const dislikesRestart = profile.dislikes.some((d) => /intro|restart/i.test(d));
  const recentAccepts = events.filter((e) => e.kind === "accept" && e.gameId && now.getTime() - Date.parse(e.ts) < 14 * 86400000);
  const recentlyPassed = new Set(events.filter((e) => e.kind === "pass" && e.gameId && now.getTime() - Date.parse(e.ts) < 7 * 86400000).map((e) => e.gameId!));
  const loved = games.filter((g) => (taste.evidence.get(g.id)?.value ?? 0) >= 0.5 && !taste.evidence.get(g.id)!.playtimeOnly);
  const disliked = games.filter((g) => (taste.evidence.get(g.id)?.value ?? 0) <= -0.3 && !taste.burnout.has(g.id));
  const byId = new Map(games.map((g) => [g.id, g]));

  const out: Rec[] = [];
  for (const g of games) {
    // Hard filters: things you've said never to suggest.
    if (g.tags.some((t) => NOT_A_GAME.has(t.tag))) { ex("Tools and test clients"); continue; }
    if (g.status === "not_interested") { ex("Marked not interested"); continue; }
    if (g.recPref === "never") { ex("Set to never suggest"); continue; }
    if (solo && isGroupGame(g)) { ex("Need other players"); continue; }
    if (g.ownership === "not_owned" && !input.includeNotOwned) { ex("Not owned"); continue; }
    if (g.ownership === "wishlist" && !S.includeWishlist) { ex("Wishlist (not owned)"); continue; }
    const replayMood = S.intent === "replay" || S.experience === "nostalgic";
    if (g.status === "completed" && !replayMood) { ex("Finished (choose 'Replay something familiar' to include)"); continue; }
    if (S.hideRejected && recentlyPassed.has(g.id)) { ex("Passed on this week"); continue; }
    const pr = progressRatio(g, allowUnverified);
    const recent = recentlyPlayed(g, now.getTime());
    const started = pr.hours >= 1 && (pr.ratio == null || pr.ratio < 1 || recent);
    const inProgress = g.status === "playing" || g.status === "paused";
    const state = progressState(g, allowUnverified, now.getTime());
    if (S.intent === "continue" && g.status !== "playing") { ex("Not marked Playing"); continue; }
    if (S.intent === "resume" && !(g.status === "paused" || (state === "started" && g.status === "backlog"))) {
      ex(g.status === "playing" ? "Currently playing (choose 'Continue')" : "Not paused or part-played");
      continue;
    }
    if (S.intent === "new" && (inProgress || pr.hours >= 1 || g.status === "replay")) { ex("Already started"); continue; }
    if (S.intent === "replay" && !(state === "finished" || state === "likely_finished" || (pr.hours >= 20 && !g.endless))) {
      ex("Not something you've played through");
      continue;
    }

    const tr = taste.traits.get(g.id)!;
    const v = tr.values;
    const comps: { key: CompKey; s: number; factors: { text: string; c: number }[] }[] = [];
    const add = (key: CompKey, s: number, factors: { text: string; c: number }[] = []) => comps.push({ key, s: clamp(s), factors });
    const notes: string[] = [];

    // Mood
    if (S.experience) {
      const m = MOOD[S.experience];
      const tm = traitMatch(withAbsent(v, tr.tagSource !== "none"), m.wishes);
      let tagBonus = 0;
      for (const [t, b] of Object.entries(m.tags ?? {})) if (hasTag(g, t)) tagBonus += b;
      let s = tm.s + Math.min(0.4, tagBonus);
      const f: { text: string; c: number }[] = [];
      if (S.experience === "nostalgic") {
        const ev = taste.evidence.get(g.id);
        if (ev && ev.value >= 0.5 && (g.status === "completed" || g.status === "replay" || pr.hours >= 10)) {
          s += 0.6;
          f.push({ text: `A game you loved, worth revisiting`, c: 0.6 });
        }
      }
      if (tm.known === 0 && tagBonus === 0) {
        notes.push("Not enough data to judge the mood fit");
      } else if (s >= 0.25) f.push({ text: `Good match for ${m.want}`, c: s });
      else if (s <= -0.2) f.push({ text: m.lack, c: s });
      add("mood", tm.known || tagBonus ? s : 0, f);
    }

    // Energy
    if (S.energy && S.energy !== "medium") {
      const tm = traitMatch(v, ENERGY_WISH[S.energy]);
      const f: { text: string; c: number }[] = [];
      let es = tm.s;
      if (S.energy === "low") {
        // Not twitchy isn't the same as restful: long reading and heavy thinking wear you out too.
        const conc = Math.max(v.focus ?? 0, v.dialogue ?? 0);
        const reading = (v.dialogue ?? 0) >= 0.7;
        if (conc >= 0.65) {
          const c = -(conc - 0.5) * 0.9;
          es += c * 0.6;
          f.push({ text: `Needs steady concentration (${reading ? "lots of dialogue and reading" : "thinking-heavy"}) — tiring on a low-energy night`, c });
        }
        if (es >= 0.25) f.push({ text: "Easy-going enough for a low-energy night", c: es });
        else if (es <= -0.2 && conc < 0.65) {
          const worst = tm.hits.filter((h) => h.c < 0).map((h) => TRAIT_LABEL[h.t].toLowerCase()).slice(0, 2);
          f.push({ text: `Demanding for a low-energy night (${worst.join(", ")})`, c: es });
        }
      } else {
        if (tm.s >= 0.25) f.push({ text: "Rewards a high-energy session", c: tm.s });
        else if (tm.s <= -0.25) f.push({ text: "Pretty low-key for how much energy you have", c: tm.s });
      }
      add("energy", es, f);
    } else if (S.energy === "medium") {
      let s = 0.1;
      const f: { text: string; c: number }[] = [];
      if ((v.energy ?? 0) > 0.85 || (v.difficulty ?? 0) > 0.9) {
        s = -0.3;
        f.push({ text: "Quite intense for a medium-energy session", c: s });
      }
      add("energy", s, f);
    }

    // Time
    if (S.time && S.time !== "open") {
      const tm = traitMatch(withAbsent(v, tr.tagSource !== "none"), TIME_WISH[S.time]);
      const f: { text: string; c: number }[] = [];
      if (S.time === "lt30" || S.time === "30to60") {
        if (tm.s >= 0.25) f.push({ text: "Works in a short session", c: tm.s });
        else if (tm.s <= -0.2) f.push({ text: `Hard to get much done in ${TIME_LABEL[S.time].toLowerCase()}`, c: tm.s });
      }
      add("time", tm.s, f);
    }

    // Commitment
    if (S.commitment) {
      const f: { text: string; c: number }[] = [];
      let s = 0;
      if (inProgress) {
        s = 0.6;
        f.push({ text: "You're already into it, so no new commitment", c: s });
      } else if (tr.scale) {
        s = COMMIT_FIT[S.commitment][tr.scale];
        if (s >= 0.5) f.push({ text: `${SCALE_TEXT[tr.scale]}, which suits ${COMMIT_LABEL[S.commitment].toLowerCase()}`, c: s });
        else if (s <= -0.3) f.push({ text: `${SCALE_TEXT[tr.scale]}: more than ${COMMIT_LABEL[S.commitment].toLowerCase()}`.replace("more than a long-term game", "shorter than you wanted"), c: s });
      } else notes.push("Length unknown");
      add("commitment", s, f);
    }

    // Avoid list
    if (S.avoid.filter((a) => a !== "multiplayer").length) {
      let s = 0;
      const f: { text: string; c: number }[] = [];
      const chk = (k: AvoidKey, t: Trait, text: string, invert = false) => {
        if (!S.avoid.includes(k)) return;
        const x = v[t];
        if (x == null) {
          s -= 0.08;
          return;
        }
        const level = invert ? 1 - x : x;
        if (level > 0.6) {
          const p = (level - 0.5) * 2;
          s -= p;
          f.push({ text, c: -p });
        }
      };
      chk("setup", "setup", "Has a steep setup / learning curve");
      chk("difficulty", "difficulty", "Known for being hard");
      chk("grind", "grind", "Involves a lot of grinding");
      chk("dialogue", "dialogue", "Heavy on dialogue and reading");
      chk("aimless", "structure", "Can feel aimless", true);
      chk("horror", "tension", "Tense or scary");
      if (S.avoid.includes("tutorials") && (v.structure ?? 0) > 0.85 && (v.difficulty ?? 1) < 0.2) {
        s -= 0.5;
        f.push({ text: "Very guided and easy — may feel hand-holdy", c: -0.5 });
      }
      if (S.avoid.includes("commitment") && !inProgress && (tr.scale === "long" || tr.scale === "endless")) {
        s -= tr.scale === "long" ? 1 : 0.6;
        f.push({ text: `${SCALE_TEXT[tr.scale]} — a big time commitment`, c: tr.scale === "long" ? -1 : -0.6 });
      }
      add("avoid", Math.max(-1, s), f);
    }

    // Structure / difficulty (only when you set them)
    if (S.structure && v.structure != null) {
      const t = STRUCTURE_TARGET[S.structure];
      const s = 1 - Math.abs(v.structure - t) * 3;
      add("structure", s, s <= -0.3 ? [{ text: v.structure < t ? "Less structured than you asked for" : "More linear than you asked for", c: s }] : s >= 0.6 ? [{ text: `${STRUCTURE_LABEL[S.structure]} structure, as asked`, c: s * 0.5 }] : []);
    }
    if (S.difficulty && v.difficulty != null) {
      const d = v.difficulty;
      const s = S.difficulty === "gentle" ? -pole(d) : S.difficulty === "challenging" ? pole(d) : 1 - Math.abs(d - 0.5) * 2.5;
      const f: { text: string; c: number }[] = [];
      if (S.difficulty === "challenging" && d >= 0.85) f.push({ text: "Properly challenging", c: s });
      if (S.difficulty === "gentle" && d >= 0.75) f.push({ text: "Probably harder than you want right now", c: s });
      add("difficulty", s, f);
    }

    // Taste: tags you lean towards, traits you prefer, and similarity to games you loved/struggled with.
    {
      const f: { text: string; c: number }[] = [];
      let tagS = 0;
      let tagW = 0;
      for (const { tag, source } of g.tags) {
        const a = taste.tagAff.get(tag);
        if (!a) continue;
        const w = (taste.idf.get(tag) ?? 1) * tagWeight(source);
        tagS += a.aff * w;
        tagW += w;
      }
      const tagScore = tagW ? tagS / tagW : 0;
      let trS = 0;
      let trW = 0;
      for (const [T, p] of Object.entries(taste.traitPref) as [Trait, { value: number }][]) {
        const x = v[T];
        if (x == null || Math.abs(p.value) < 0.05 || T === "structure") continue;
        trS += p.value * pole(x);
        trW += Math.abs(p.value);
      }
      // Structure is a sweet spot ("freedom with understandable goals"), not "more is better".
      const sTarget = taste.structureTarget;
      if (sTarget != null && v.structure != null && !S.structure) {
        const fit = 1 - Math.abs(v.structure - sTarget) * 3;
        trS += fit * 0.5;
        trW += 0.5;
        if (v.structure < 0.25) f.push({ text: "Open-ended with little direction, which you've said you dislike", c: -0.35 });
      }
      const traitScore = trW ? trS / trW : 0;
      // Nearest loved and struggled-with games.
      let posSim = 0;
      let negSim = 0;
      const posNames: { n: string; s: number }[] = [];
      const negNames: { n: string; s: number }[] = [];
      for (const o of loved) {
        if (o.id === g.id) continue;
        const sim = similarity(g, o, taste.idf);
        if (sim < 0.3) continue;
        posSim = Math.max(posSim, sim * taste.evidence.get(o.id)!.value);
        posNames.push({ n: cleanTitle(o.title), s: sim });
      }
      for (const o of disliked) {
        if (o.id === g.id) continue;
        const sim = similarity(g, o, taste.idf);
        if (sim < 0.4) continue;
        negSim = Math.min(negSim, sim * taste.evidence.get(o.id)!.value);
        negNames.push({ n: cleanTitle(o.title), s: sim });
      }
      posNames.sort((a, b) => b.s - a.s);
      negNames.sort((a, b) => b.s - a.s);
      // A resemblance to a game you struggled with matters less when it resembles games you love even more.
      if (posSim > -negSim) negSim *= 0.35;
      const simScore = clamp(posSim * 1.3 + negSim * 1.1);
      // Same developer as games you rated or listed (from store data or your own entry).
      let devScore = 0;
      let devNote: { text: string; c: number } | null = null;
      for (const d of developersOf(g)) {
        const a = taste.devAff.get(d);
        if (!a) continue;
        const others = a.titles.filter((t) => t !== g.title);
        if (!others.length) continue;
        if (a.value > devScore && a.value >= 0.3) {
          devScore = Math.min(0.6, a.value);
          devNote = { text: `Made by ${d}, who also made ${others.slice(0, 2).map(cleanTitle).join(" and ")}, which you enjoyed`, c: devScore * 0.5 };
        } else if (a.value <= -0.3 && devScore === 0) {
          devScore = Math.max(-0.4, a.value * 0.6);
          devNote = { text: `Made by ${d}, like ${cleanTitle(others[0])}, which didn't work for you`, c: devScore * 0.5 };
        }
      }
      const parts = [tagW ? [tagScore, 0.35] : null, trW ? [traitScore, 0.35] : null, posSim || negSim ? [simScore, 0.3] : null, devScore ? [devScore, 0.15] : null].filter(Boolean) as [number, number][];
      const s = parts.length ? parts.reduce((a, [x, w]) => a + x * w, 0) / parts.reduce((a, [, w]) => a + w, 0) : 0;
      if (devNote) f.push(devNote);
      if (posNames.length) f.push({ text: `Similar to ${posNames.slice(0, 2).map((x) => x.n).join(" and ")}, which you enjoyed`, c: posSim });
      if (negNames.length && negSim <= -0.15) f.push({ text: `Shares a lot with ${negNames[0].n}, which you struggled to stay interested in`, c: negSim });
      const liked = g.tags.map((t) => ({ t: t.tag, a: taste.tagAff.get(t.tag)?.aff ?? 0 })).filter((x) => x.a >= 0.2 && !["guided", "dialogue", "mastery"].includes(x.t)).sort((a, b) => b.a - a.a);
      if (liked.length && !posNames.length) f.push({ text: `You tend to enjoy ${liked.slice(0, 2).map((x) => x.t).join(" and ")} games`, c: liked[0].a * 0.6 });
      const disl = g.tags.map((t) => ({ t: t.tag, a: taste.tagAff.get(t.tag)?.aff ?? 0 })).filter((x) => x.a <= -0.2).sort((a, b) => a.a - b.a);
      if (disl.length && !negNames.length) f.push({ text: `${disl[0].t[0].toUpperCase() + disl[0].t.slice(1)} games haven't tended to work for you`, c: disl[0].a * 0.6 });
      const prefHits = (Object.entries(taste.traitPref) as [Trait, { value: number }][])
        .filter(([T, p]) => v[T] != null && Math.abs(p.value) >= 0.25 && T !== "structure")
        .map(([T, p]) => ({ T, c: p.value * pole(v[T]!) }))
        .sort((a, b) => a.c - b.c);
      const worst = prefHits[0];
      if (worst && worst.c <= -0.3) f.push({ text: `${TRAIT_LABEL[worst.T]}: ${pole(v[worst.T]!) > 0 ? "high" : "low"}, which works against your preferences`, c: worst.c * 0.5 });
      const best = prefHits[prefHits.length - 1];
      if (best && best.c >= 0.35 && !posNames.length) f.push({ text: `Strong on ${TRAIT_LABEL[best.T].toLowerCase()}, which you value`, c: best.c * 0.5 });
      if (!tagW && !trW) notes.push("No tags yet, so taste can't be judged");
      add("taste", s, f);
    }

    // History with this specific game.
    {
      const ev = taste.evidence.get(g.id);
      const f: { text: string; c: number }[] = [];
      let s = 0;
      if (ev && !ev.playtimeOnly) {
        s = ev.value * Math.min(1, ev.weight + 0.2);
        const main = [...ev.parts].sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))[0];
        f.push({ text: main.value < 0 && !main.label.startsWith("You") ? `You've struggled with it before (${main.label.toLowerCase().replace(/^on your /, "it's on your ")})` : main.label, c: s });
      }
      if (replayMood && ev && !ev.playtimeOnly && ev.value >= 0.4) {
        s += 0.3;
        f.push({ text: "A favourite worth revisiting", c: 0.3 });
      }
      if (!inProgress && g.status !== "replay") {
        if (pr.ratio != null && pr.ratio >= 0.7 && started && (pr.ratio < 1 || recent)) {
          // Close to (or past) the estimate but not marked finished: estimates are rough, so this
          // is a game to wrap up, not a replay.
          s += 0.3;
          f.push({
            text:
              pr.ratio < 1
                ? `Close to the end (${Math.round(pr.hours)}h of ~${pr.est}h main story) — a good one to wrap up`
                : `Played recently, ${Math.round(pr.hours)}h in (past the ~${pr.est}h estimate) — looks like you're still on it`,
            c: 0.6,
          });
        } else if (pr.ratio != null && pr.ratio >= 1) {
          // Enjoying it before doesn't make it a fresh pick: it's a replay unless you asked for one.
          if (!replayMood) {
            s = Math.min(s, 0) - 0.6;
            f.length = 0;
            f.push({ text: `Already played ~through (${Math.round(pr.hours)}h of ~${pr.est}h est.) — this would be a replay`, c: -0.6 });
          }
        } else if (pr.ratio == null && pr.hours >= 30 && !g.endless) {
          if (!replayMood) {
            s = Math.min(s, 0) - 0.4;
            f.length = 0;
            f.push({ text: `Already ${Math.round(pr.hours)}h in — probably well explored`, c: -0.4 });
          }
        } else if (started && pr.hours >= 2) {
          const pct = pr.ratio != null ? ` (${Math.round(pr.hours)}h of ~${pr.est}h est.)` : ` (${Math.round(pr.hours)}h)`;
          if (dislikesRestart) {
            s -= 0.1;
            f.push({ text: `You started this before${pct}: resume your save rather than replaying the opening`, c: -0.1 });
          } else f.push({ text: `You started this before${pct}`, c: 0.05 });
        }
      }
      // Asking for something different: liking a game you already know well doesn't help it.
      if (S.intent === "different" && (pr.hours >= 3 || (pr.ratio != null && pr.ratio >= 0.5)) && s > 0) s = 0;
      if (f.length) add("history", s, f);
    }

    // Recent passes (temporary; fades by itself).
    let deprioritized: Rec["deprioritized"] = null;
    {
      const pp = passPenalty(g.id, events, now);
      if (pp.count) {
        const uniq = [...new Set(pp.reasons)];
        const text = `You passed on this ${pp.count === 1 ? "recently" : `${pp.count}× recently`} (${uniq.join(", ")})`;
        deprioritized = { text, until: pp.until! };
        add("passes", -pp.pen, [{ text: `${text} — shown less until ${pp.until}`, c: -pp.pen }]);
      }
      const acc = recentAccepts.filter((e) => e.gameId === g.id);
      if (acc.length && !inProgress) add("passes", -0.3, [{ text: "You picked this recently and didn't start it", c: -0.3 }]);
    }

    // Series order: a sequel waits until the game before it is finished (unless you say otherwise).
    let heldBack = false;
    {
      const sn = seriesNeighbours(g, series, byId);
      const prev = sn?.previous;
      if (prev && !inProgress && state !== "finished" && state !== "likely_finished") {
        const ps = progressState(prev, allowUnverified);
        const pp = progressRatio(prev, allowUnverified);
        const pt = cleanTitle(prev.title);
        if (ps === "finished") {
          add("series", 0.6, [{ text: `Natural follow-up to ${pt}, which you've finished`, c: 0.6 }]);
        } else if (ps === "likely_finished") {
          add("series", 0.5, [{ text: `Natural follow-up to ${pt} (looks finished: ${Math.round(pp.hours)}h of ~${pp.est}h est.)`, c: 0.5 }]);
        } else if (ps === "in_progress" || ps === "started") {
          const why = prev.status === "playing" ? `you're still playing ${pt}` : prev.status === "paused" ? `${pt} is paused, not finished` : `you haven't finished ${pt} (${Math.round(pp.hours)}h in)`;
          if (S.allowSequels) add("series", 0, [{ text: `Sequel to ${pt} — included because you allowed sequels`, c: 0 }]);
          else {
            heldBack = true;
            add("series", -0.9, [{ text: `Follow-up to ${pt}: waiting because ${why} — it's in Series follow-ups`, c: -0.9 }]);
          }
        } else if (ps === "not_started" && pr.hours < 1 && !S.allowSequels) {
          add("series", -0.4, [{ text: `${pt} comes first in the series and you haven't played it`, c: -0.4 }]);
        }
      }
    }

    // Something completely different: away from what you usually play and recently picked.
    if (S.intent === "different") {
      let maxSim = 0;
      for (const o of loved) if (o.id !== g.id) maxSim = Math.max(maxSim, similarity(g, o, taste.idf));
      for (const e of recentAccepts) {
        const o = byId.get(e.gameId!);
        if (o && o.id !== g.id) maxSim = Math.max(maxSim, similarity(g, o, taste.idf));
      }
      let s = 0.6 - maxSim * 2;
      const f: { text: string; c: number }[] = [];
      const own = taste.evidence.get(g.id);
      if ((own && !own.playtimeOnly) || pr.hours >= 3 || (pr.ratio != null && pr.ratio >= 0.5)) {
        s -= 0.7;
        f.push({ text: "You already know this one well — not exactly something different", c: -0.7 });
      } else if (s >= 0.3) f.push({ text: "Different from what you usually play", c: s });
      else if (s <= -0.4) f.push({ text: "Close to what you usually play", c: s });
      add("novelty", s, f);
    }

    // Ownership and progress.
    if (g.ownership === "owned") add("ownership", 0.4, [{ text: "Already in your library", c: 0.15 }]);
    else if (g.ownership === "wishlist") add("ownership", -0.4, [{ text: "On your wishlist — you don't own it yet", c: -0.4 }]);
    else if (g.ownership === "not_owned") add("ownership", -0.3, [{ text: "You don't own it", c: -0.3 }]);
    // Your answers in Discover.
    const mark = input.marks?.get(g.id)?.kind;
    if (mark === "want") add("progress", 0.5, [{ text: "You marked it 'Want to try' in Discover", c: 0.5 }]);
    else if (mark === "interested") add("progress", 0.3, [{ text: "You marked it 'Interested' in Discover", c: 0.3 }]);
    else if (mark === "played" && !replayMood) add("history", -0.5, [{ text: "You said you've already played it", c: -0.5 }]);
    if (g.status === "playing") add("progress", S.intent === "continue" ? 1 : 0.7, [{ text: "You're currently playing it", c: 0.7 }]);
    else if (g.status === "paused") add("progress", 0.35, [{ text: "Paused — a chance to pick it back up", c: 0.35 }]);
    else if (g.status === "replay") add("progress", 0.3, [{ text: "Marked as a replay candidate", c: 0.3 }]);
    else if (g.status === "dropped") add("progress", -0.5, [{ text: "You dropped this before", c: -0.5 }]);

    // Combine.
    let num = 0;
    let den = 0;
    const components: Rec["components"] = [];
    const factors: Factor[] = [];
    for (const c of comps) {
      const def = COMPONENTS[c.key];
      const w = def.base * (def.group ? weights[def.group] : 1);
      if (w <= 0) continue;
      num += c.s * w;
      den += w;
      components.push({ key: c.key, label: def.label, score: c.s, weight: w });
      for (const f of c.factors) factors.push({ text: f.text, v: f.c * w });
    }
    const score = den ? num / den : 0;

    // Confidence: how much of this rests on known, preferably personal, data.
    const relevant = new Set<Trait>(["story", "structure", "difficulty", "energy"]);
    if (S.experience) for (const [t] of MOOD[S.experience].wishes) relevant.add(t);
    if (S.energy && S.energy !== "medium") for (const [t] of ENERGY_WISH[S.energy]) relevant.add(t);
    if (S.time) for (const [t] of TIME_WISH[S.time]) relevant.add(t);
    const knownFrac = [...relevant].filter((t) => v[t] != null).length / relevant.size;
    const srcFactor = tr.tagSource === "user" ? 1 : tr.tagSource === "estimate" ? 0.6 : 0;
    const ev = taste.evidence.get(g.id);
    const conf = 0.45 * knownFrac * srcFactor + 0.2 * (tr.scale ? (tr.scaleSource === "user" ? 1 : 0.7) : 0) + 0.35 * (ev && !ev.playtimeOnly ? 1 : 0.3);
    if (tr.tagSource === "estimate") notes.push("Game traits come from estimated tags");
    if (!tr.scale) notes.push("Length unknown");
    const level = conf >= 0.62 ? "high" : conf >= 0.35 ? "medium" : "low";

    // Commitment line and data sources.
    const len = displayLength(g, allowUnverified);
    let commitment = "Length unknown";
    if (tr.scale === "endless") commitment = `Endless / sandbox (${srcLabel(tr.scaleSource)})`;
    else if (len) {
      const main = g.lengths.find((l) => l.kind === "main" && l.source === len.source);
      const range = main && main.hours !== len.hours ? `${fmtHours(main.hours)}–${fmtHours(len.hours)}` : fmtHours(len.hours);
      commitment = `${SCALE_TEXT[tr.scale ?? "medium"]} · ~${range} (${srcLabel(len.source)})`;
    } else if (tr.scale) commitment = `${SCALE_TEXT[tr.scale]} (${srcLabel(tr.scaleSource)})`;
    const tagSrc = [...new Set(g.tags.map((t) => t.source))];
    const sources = [
      `Tags: ${tagSrc.length ? tagSrc.map((t) => (t === "igdb" ? "IGDB genres" : srcLabel(t))).join(" + ") : "none"}`,
      ...(g.meta?.steam?.status === "linked" && g.meta.steam.data ? ["Details: Steam store"] : []),
      ...(g.meta?.igdb?.status === "linked" && g.meta.igdb.data ? ["Details: IGDB.com"] : []),
      `Players: ${g.multiplayer === "unknown" ? "unknown" : srcLabel(g.metaSource.multiplayer ?? "user")}`,
      `Enjoyment: ${ev ? (ev.playtimeOnly ? "only playtime, no real evidence" : ev.parts.map((p) => p.kind).filter((k, i, a) => a.indexOf(k) === i).join(", ")) : "no data"}`,
    ];

    const pros = factors.filter((f) => f.v > 0.02).sort((a, b) => b.v - a.v).slice(0, 4);
    const cons = factors.filter((f) => f.v < -0.02).sort((a, b) => a.v - b.v).slice(0, 3);
    out.push({
      game: g,
      score,
      band: score >= 0.38 ? "excellent" : score >= 0.22 ? "good" : score >= 0.08 ? "fair" : "weak",
      confidence: { level, notes: [...new Set(notes)] },
      pros,
      cons,
      components,
      commitment,
      sources,
      deprioritized,
      heldBack,
    });
  }

  out.sort((a, b) => b.score - a.score || a.game.title.localeCompare(b.game.title));
  return {
    results: out,
    excluded: [...excluded.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    considered: games.length,
  };
}

// ---------- presentation ----------

/**
 * Picks a top list that isn't five near-identical games: each next pick pays a
 * small penalty for resembling games already chosen. Order stays deterministic.
 */
export function diversify(results: Rec[], k: number, idf: Map<string, number>, skip: Set<string> = new Set()): Rec[] {
  const pool = results.filter((r) => !skip.has(r.game.id)).slice(0, 60);
  const chosen: Rec[] = [];
  while (chosen.length < k && pool.length) {
    let best = 0;
    let bestVal = -Infinity;
    pool.forEach((r, i) => {
      const maxSim = chosen.reduce((m, c) => Math.max(m, similarity(r.game, c.game, idf)), 0);
      const val = r.score - 0.18 * Math.max(0, maxSim - 0.5) * 2;
      if (val > bestVal) {
        bestVal = val;
        best = i;
      }
    });
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}

// ---------- Surprise me ----------

/** Small deterministic PRNG so "Surprise me" is repeatable for the same day and press count. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Picks among the stronger matches, weighted towards the best, skipping ones already shown. */
export function surprisePick(results: Rec[], seed: number, skip: Set<string> = new Set()): Rec | null {
  const pool = results.filter((r) => !skip.has(r.game.id) && r.band !== "weak" && !r.deprioritized && !r.heldBack).slice(0, 15);
  const list = pool.length ? pool : results.filter((r) => !skip.has(r.game.id)).slice(0, 15);
  if (!list.length) return null;
  const min = Math.min(...list.map((r) => r.score));
  const w = list.map((r) => (r.score - min + 0.05) ** 2);
  const total = w.reduce((a, b) => a + b, 0);
  let x = mulberry32(seed)() * total;
  for (let i = 0; i < list.length; i++) {
    x -= w[i];
    if (x <= 0) return list[i];
  }
  return list[list.length - 1];
}
