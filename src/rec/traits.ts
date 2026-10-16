// Turns a game's tags (plus its length data) into a small set of traits the
// recommender reasons about. Traits are always INFERRED: they are only as good
// as the tags underneath, and the UI says so. A trait no tag speaks to stays
// unknown (null) rather than defaulting to a made-up middle value.

import type { Game, Scale } from "../lib/types.ts";
import { displayLength } from "../lib/library.ts";

export const TRAITS = [
  "story",
  "dialogue",
  "structure",
  "difficulty",
  "tension",
  "grind",
  "setup",
  "energy",
  "quick",
  "exploration",
  "building",
  "strategy",
  "mastery",
  "cozy",
  "unusual",
  "retro",
  "focus",
] as const;
export type Trait = (typeof TRAITS)[number];
export type Traits = Record<Trait, number | null>;

export const TRAIT_LABEL: Record<Trait, string> = {
  story: "Story focus",
  dialogue: "Dialogue / reading",
  structure: "Clear goals (vs. aimless)",
  difficulty: "Difficulty",
  tension: "Tension / horror",
  grind: "Grind / busywork",
  setup: "Setup & learning curve",
  energy: "Energy needed",
  quick: "Works in short sessions",
  exploration: "Exploration",
  building: "Building / creating",
  strategy: "Strategic thinking",
  mastery: "Mechanical mastery",
  cozy: "Cozy / relaxing",
  unusual: "Unusual / offbeat",
  retro: "Older / retro",
  focus: "Needs concentration",
};

type TV = Partial<Record<Trait, number>>;

/** What each tag implies, on a 0–1 scale. Tags not listed carry theme only (used for taste). */
export const TAG_TRAITS: Record<string, TV> = {
  // genre tags
  story: { story: 0.9, structure: 0.75, dialogue: 0.55, focus: 0.55 },
  narrative: { story: 0.9, dialogue: 0.65, energy: 0.25, difficulty: 0.2, focus: 0.7 },
  rpg: { story: 0.65, dialogue: 0.55, grind: 0.45, structure: 0.6, quick: 0.2, setup: 0.35, focus: 0.6 },
  openworld: { exploration: 0.85, structure: 0.5, quick: 0.3, grind: 0.5 },
  sandbox: { structure: 0.15, building: 0.6, exploration: 0.6, grind: 0.6, quick: 0.45 },
  survival: { grind: 0.8, tension: 0.6, structure: 0.25, setup: 0.55, difficulty: 0.6 },
  crafting: { grind: 0.75, building: 0.6 },
  souls: { focus: 0.7, difficulty: 0.95, mastery: 0.95, energy: 0.85, tension: 0.7, story: 0.35, dialogue: 0.15, structure: 0.5, quick: 0.45 },
  action: { energy: 0.75, mastery: 0.55, dialogue: 0.2 },
  fps: { energy: 0.8, mastery: 0.6, quick: 0.55, dialogue: 0.15 },
  shooter: { energy: 0.8, mastery: 0.55, quick: 0.5, dialogue: 0.15 },
  horror: { tension: 0.95 },
  survivalhorror: { tension: 0.95, difficulty: 0.6, story: 0.55 },
  atmospheric: { exploration: 0.6, energy: 0.4 },
  relaxing: { cozy: 0.85, tension: 0.05, difficulty: 0.15, energy: 0.2, focus: 0.15 },
  cozy: { cozy: 0.95, tension: 0.05, difficulty: 0.1, energy: 0.15, focus: 0.2 },
  puzzle: { strategy: 0.55, quick: 0.7, energy: 0.3, mastery: 0.4, tension: 0.1, focus: 0.65 },
  platformer: { mastery: 0.65, energy: 0.65, quick: 0.7, difficulty: 0.55 },
  metroidvania: { exploration: 0.8, mastery: 0.7, difficulty: 0.6, structure: 0.6 },
  roguelike: { quick: 0.85, difficulty: 0.7, mastery: 0.8, energy: 0.7, structure: 0.6, grind: 0.4, story: 0.2 },
  stealth: { mastery: 0.6, tension: 0.55, structure: 0.65 },
  strategy: { strategy: 0.95, setup: 0.65, energy: 0.3, quick: 0.35, focus: 0.75 },
  "4x": { strategy: 0.95, setup: 0.85, quick: 0.1, grind: 0.5, focus: 0.9 },
  rts: { strategy: 0.9, energy: 0.7, mastery: 0.7, setup: 0.6 },
  turnbased: { strategy: 0.65, energy: 0.2, quick: 0.45, focus: 0.5 },
  tactics: { strategy: 0.9, difficulty: 0.6, energy: 0.25, focus: 0.8 },
  sim: { setup: 0.6, building: 0.45, energy: 0.25, structure: 0.35, focus: 0.5 },
  management: { strategy: 0.7, building: 0.6, grind: 0.55, setup: 0.6, energy: 0.2 },
  citybuilder: { building: 0.95, strategy: 0.6, structure: 0.3, energy: 0.15, cozy: 0.5 },
  building: { building: 0.95, structure: 0.3 },
  farming: { cozy: 0.8, grind: 0.65, building: 0.5, energy: 0.15 },
  driving: { quick: 0.65, energy: 0.5, story: 0.1 },
  racing: { quick: 0.7, energy: 0.7, mastery: 0.6, story: 0.05 },
  comedy: { cozy: 0.45, tension: 0.15, unusual: 0.55 },
  cards: { strategy: 0.8, quick: 0.75, energy: 0.2 },
  arcade: { quick: 0.9, energy: 0.7, story: 0.05, mastery: 0.55, focus: 0.3 },
  exploration: { exploration: 0.9 },
  walking: { story: 0.7, energy: 0.05, difficulty: 0.05, exploration: 0.6, quick: 0.5, focus: 0.3 },
  mystery: { story: 0.8, strategy: 0.5, dialogue: 0.7, energy: 0.2, focus: 0.8 },
  detective: { story: 0.8, strategy: 0.6, dialogue: 0.75, energy: 0.2, focus: 0.85 },
  adventure: { story: 0.7, exploration: 0.6, structure: 0.7 },
  sports: { quick: 0.7, energy: 0.55 },
  hack: { energy: 0.8, grind: 0.6, mastery: 0.45 },
  // trait tags (from the reference data, or your own tags)
  guided: { structure: 0.9 },
  aimless: { structure: 0.05 },
  grind: { grind: 0.9 },
  dialogue: { dialogue: 0.95, story: 0.7, focus: 0.85 },
  punishing: { difficulty: 0.95 },
  gentle: { difficulty: 0.1, tension: 0.15 },
  mastery: { mastery: 0.9 },
  quicksession: { quick: 0.95 },
  setup: { setup: 0.9 },
  tense: { tension: 0.85 },
  weird: { unusual: 0.95 },
  retro: { retro: 0.95 },
  social: { story: 0.55, cozy: 0.5, dialogue: 0.6 },
  programming: { strategy: 0.85, setup: 0.8, unusual: 0.7, energy: 0.2, focus: 0.95 },
  mmo: { grind: 0.95, setup: 0.6, structure: 0.4 },
};

/** Trait tags count double: they were chosen to describe exactly that trait. */
const TRAIT_TAGS = new Set(["guided", "aimless", "grind", "dialogue", "punishing", "gentle", "mastery", "quicksession", "setup", "tense", "weird", "retro"]);

/** Tags that mean "not a game you'd pick to play solo". */
export const NOT_A_GAME = new Set(["tool"]);

export interface GameTraits {
  values: Traits;
  /** How many traits are known (0..16). */
  known: number;
  /** Where the underlying tags came from: "user" beats estimates. */
  tagSource: "user" | "estimate" | "none";
  scale: Scale | null;
  scaleSource: string | null;
}

export function deriveTraits(g: Game, allowUnverified = true): GameTraits {
  const acc: Partial<Record<Trait, { sum: number; w: number }>> = {};
  for (const { tag } of g.tags) {
    const tv = TAG_TRAITS[tag];
    if (!tv) continue;
    const w = TRAIT_TAGS.has(tag) ? 2 : 1;
    for (const [k, v] of Object.entries(tv) as [Trait, number][]) {
      const a = (acc[k] ??= { sum: 0, w: 0 });
      a.sum += v * w;
      a.w += w;
    }
  }
  const values = {} as Traits;
  let known = 0;
  for (const t of TRAITS) {
    const a = acc[t];
    values[t] = a ? a.sum / a.w : null;
    if (a) known++;
  }
  const hasUser = g.tags.some((t) => t.source === "user");
  const { scale, source } = gameScale(g, allowUnverified);
  return {
    values,
    known,
    tagSource: g.tags.length === 0 ? "none" : hasUser ? "user" : "estimate",
    scale,
    scaleSource: source,
  };
}

/** Length class: your own lengths first, then the stored class, then old estimates. */
export function gameScale(g: Game, allowUnverified = true): { scale: Scale | null; source: string | null } {
  const user = displayLength({ ...g, lengths: g.lengths.filter((l) => l.source === "user") }, false);
  if (user) return { scale: bucket(user.hours), source: "user" };
  if (g.endless) return { scale: "endless", source: g.metaSource.endless ?? "inferred" };
  if (g.scale) return { scale: g.scale, source: g.metaSource.scale ?? "reference" };
  const est = displayLength(g, allowUnverified);
  if (est) return { scale: bucket(est.hours), source: est.source };
  return { scale: null, source: null };
}

function bucket(h: number): Scale {
  return h < 12 ? "short" : h < 35 ? "medium" : "long";
}

/** Signed position on a trait: -1 (none) … +1 (a lot). */
export const pole = (v: number) => (v - 0.5) * 2;
