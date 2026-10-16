// The personal taste model.
//
// Enjoyment and time spent are deliberately separate:
//   - ENJOYMENT evidence comes from things you told REWIND: ratings, favorites, your
//     profile's "enjoyed" / "struggled with" lists, finishing or dropping a game,
//     and your answers to recommendations.
//   - PLAYTIME is only a weak hint, used when there is no other evidence, never for
//     multiplayer games, and always labelled "time spent, not proof you liked it".
//
// From that evidence it learns which tags and traits you lean towards, and it adds
// what your profile text says ("I dislike aimless sandboxes"). Pass/drop reasons
// adjust traits temporarily and fade out.

import { canon, cleanTitle } from "../lib/canon.ts";
import type { Game, GamingProfile } from "../lib/types.ts";
import { deriveTraits, pole, TRAITS, type GameTraits, type Trait } from "./traits.ts";

export interface RecEvent {
  id: number;
  ts: string;
  kind: string; // accept | pass | drop | surprise | mood_skip | break | reset_learning
  gameId: string | null;
  reason: string | null;
  context: Record<string, unknown>;
}

export interface ReasonDef {
  label: string;
  cooldownDays: number;
  weight: number;
  trait?: Trait;
  delta?: number;
}

/** Why you passed on (or dropped) a game, and what REWIND does with it. */
export const REASONS: Record<string, ReasonDef> = {
  not_tonight: { label: "Not tonight", cooldownDays: 2, weight: 0.25 },
  too_long: { label: "Too long a commitment", cooldownDays: 10, weight: 0.5 },
  too_hard: { label: "Too hard / punishing", cooldownDays: 14, weight: 0.5, trait: "difficulty", delta: -0.12 },
  too_grindy: { label: "Too grindy / busywork", cooldownDays: 21, weight: 0.6, trait: "grind", delta: -0.12 },
  too_much_setup: { label: "Too much setup", cooldownDays: 21, weight: 0.6, trait: "setup", delta: -0.12 },
  too_much_reading: { label: "Too much dialogue / reading", cooldownDays: 14, weight: 0.5, trait: "dialogue", delta: -0.1 },
  too_stressful: { label: "Too tense / stressful", cooldownDays: 14, weight: 0.5, trait: "tension", delta: -0.12 },
  aimless: { label: "Too aimless, no clear goal", cooldownDays: 21, weight: 0.6, trait: "structure", delta: 0.12 },
  burned_out: { label: "Played it too recently / burned out", cooldownDays: 30, weight: 0.7 },
  lost_interest: { label: "Lost interest", cooldownDays: 30, weight: 0.6 },
  story_didnt_grab: { label: "Story didn't grab me", cooldownDays: 21, weight: 0.5, trait: "story", delta: -0.06 },
  already_finished: { label: "Already finished it", cooldownDays: 60, weight: 1 },
  not_interested: { label: "Not interested any more", cooldownDays: 90, weight: 1 },
};
export const PASS_REASONS = Object.keys(REASONS);
export const DROP_REASONS = ["lost_interest", "too_grindy", "aimless", "too_hard", "too_long", "too_much_setup", "story_didnt_grab", "too_stressful", "too_much_reading", "burned_out"];

export interface EvidencePart {
  label: string;
  value: number; // -1..1 enjoyment
  weight: number; // how much it counts
  kind: "rating" | "favorite" | "profile" | "status" | "drop" | "playtime";
}

export interface Evidence {
  value: number; // weighted enjoyment, -1..1
  weight: number; // 0..1 strength of evidence
  parts: EvidencePart[];
  playtimeHours: number;
  /** True when the only thing we know is time spent. */
  playtimeOnly: boolean;
}

export interface PrefPart {
  label: string;
  value: number;
  source: "your games" | "profile" | "recent passes";
  fades?: string;
}

export interface TasteModel {
  evidence: Map<string, Evidence>;
  tagAff: Map<string, { aff: number; n: number }>;
  idf: Map<string, number>;
  traitPref: Record<Trait, { value: number; parts: PrefPart[] }>;
  structureTarget: number | null;
  profileMatches: { entry: string; list: "enjoyed" | "struggled"; gameId: string | null; title: string | null }[];
  profileRules: { entry: string; list: "values" | "dislikes"; effect: string | null }[];
  learned: { trait: Trait; delta: number; reason: string; count: number; fades: string }[];
  traits: Map<string, GameTraits>;
  /** Games you burned out on: they don't count against similar games. */
  burnout: Set<string>;
  lastReset: string | null;
}

const RATING_E: Record<number, number> = { 5: 1, 4: 0.6, 3: 0, 2: -0.6, 1: -1 };
const isGroupGame = (g: Game) => g.multiplayer === "mp_required" || g.multiplayer === "coop_focused";

// ---------- profile text ----------

interface Rule {
  re: RegExp;
  effect: string;
  traits?: Partial<Record<Trait, number>>;
  tags?: Record<string, number>;
  structureTarget?: number;
}

/** How profile lines feed the engine. Lines that match nothing are shown as "not used yet". */
const VALUE_RULES: Rule[] = [
  { re: /single-?player|solo/i, effect: "games that need other players are left out (setting below)" },
  { re: /mechanical mastery|mastery|skill/i, effect: "more weight on mastery", traits: { mastery: 0.45 } },
  { re: /meaningful progression|progression/i, effect: "favours clear progression", traits: { structure: 0.2 } },
  { re: /immersive|world/i, effect: "favours exploration and atmosphere", traits: { exploration: 0.3 }, tags: { atmospheric: 0.3 } },
  { re: /characters|story|narrative|writing/i, effect: "favours story and characters", traits: { story: 0.35, dialogue: 0.1 } },
  { re: /discovery|explor/i, effect: "favours exploration", traits: { exploration: 0.3 } },
  { re: /freedom.*goals|understandable goals/i, effect: "aims for open-but-directed games", structureTarget: 0.7 },
  { re: /sustained engagement|long/i, effect: "slightly favours longer, deeper games", traits: { quick: -0.1 } },
  { re: /atmosphere/i, effect: "favours atmospheric games", tags: { atmospheric: 0.4 }, traits: { unusual: 0.1 } },
  { re: /systems/i, effect: "favours systemic games", traits: { strategy: 0.2, mastery: 0.1 } },
  { re: /quest/i, effect: "favours well-structured quests", traits: { structure: 0.25 } },
  { re: /cozy|relax/i, effect: "favours cozy games", traits: { cozy: 0.4 } },
  { re: /strateg|tactic/i, effect: "favours strategy", traits: { strategy: 0.4 } },
  { re: /horror|scary/i, effect: "favours tense games", traits: { tension: 0.3 } },
  { re: /build|creat/i, effect: "favours building", traits: { building: 0.4 } },
];
const DISLIKE_RULES: Rule[] = [
  { re: /hand-?holding|tutorial/i, effect: "very easy, over-guided games score a little lower", traits: { difficulty: 0.1 } },
  { re: /aimless|sandbox/i, effect: "aimless games score lower", traits: { structure: 0.45 }, tags: { aimless: -0.4 } },
  { re: /survival busywork|survival/i, effect: "survival busywork scores lower", tags: { survival: -0.35 }, traits: { grind: -0.15 } },
  { re: /grind/i, effect: "grindy games score lower", traits: { grind: -0.5 } },
  { re: /checklist/i, effect: "checklist open worlds score a little lower", tags: { openworld: -0.1 }, traits: { grind: -0.15 } },
  { re: /setup|complicated|mod/i, effect: "setup-heavy games score lower", traits: { setup: -0.45 } },
  { re: /obligation/i, effect: "MMO-style obligations score lower", tags: { mmo: -0.5 }, traits: { grind: -0.15 } },
  { re: /poorly explained/i, effect: "opaque games score a little lower", traits: { setup: -0.15, structure: 0.1 } },
  { re: /horror|scary|tension/i, effect: "tense games score lower", traits: { tension: -0.4 } },
  { re: /difficult|hard|punish/i, effect: "punishing games score lower", traits: { difficulty: -0.4 } },
  { re: /dialogue|reading|text/i, effect: "text-heavy games score lower", traits: { dialogue: -0.35 } },
  { re: /intro|restart/i, effect: "restarting games you've partly played scores lower (resume instead)" },
];

/** Finds the library game a profile line refers to ("The Witcher 3" -> "The Witcher 3: Wild Hunt — Remastered"). */
export function matchProfileTitle(entry: string, games: Game[]): Game | null {
  const k = canon(entry.replace(/\(.*?\)/g, " "));
  if (!k) return null;
  const exact = games.find((g) => g.canon === k);
  if (exact) return exact;
  const prefix = games.filter((g) => g.canon.startsWith(k + " ") && !/^\d/.test(g.canon.slice(k.length + 1)));
  if (prefix.length) return prefix.sort((a, b) => a.canon.length - b.canon.length)[0];
  const contains = games.filter((g) => (" " + g.canon + " ").includes(" " + k + " ") && !/^\d/.test(g.canon.split(k)[1]?.trim() ?? ""));
  if (contains.length) return contains.sort((a, b) => a.canon.length - b.canon.length)[0];
  return null;
}

// ---------- the model ----------

export { playtimeHours } from "./progress.ts";
import { playtimeHours } from "./progress.ts";

export function buildTaste(games: Game[], profile: GamingProfile, events: RecEvent[], now = new Date(), allowUnverified = true): TasteModel {
  const traits = new Map(games.map((g) => [g.id, deriveTraits(g, allowUnverified)]));
  const lastReset = events.filter((e) => e.kind === "reset_learning").map((e) => e.ts).sort().pop() ?? null;

  // Profile titles.
  const profileMatches: TasteModel["profileMatches"] = [];
  const enjoyed = new Set<string>();
  const struggled = new Set<string>();
  // "Skyrim (after many restarts)" is burnout on that one game, not a dislike of its genre.
  const burnout = new Map<string, string>();
  for (const [list, entries] of [["enjoyed", profile.enjoyed], ["struggled", profile.struggled]] as const) {
    for (const entry of entries) {
      const g = matchProfileTitle(entry, games);
      profileMatches.push({ entry, list, gameId: g?.id ?? null, title: g ? cleanTitle(g.title) : null });
      if (!g) continue;
      const q = /\(([^)]*)\)/.exec(entry)?.[1] ?? "";
      if (list === "struggled" && /restart|replay|burn|again|too many times/i.test(q)) burnout.set(g.id, q);
      else (list === "enjoyed" ? enjoyed : struggled).add(g.id);
    }
  }

  // Drop reasons per game (from your answers when you dropped something).
  const dropReasons = new Map<string, string[]>();
  for (const e of events) {
    if (e.kind === "drop" && e.gameId && e.reason) {
      if (!dropReasons.has(e.gameId)) dropReasons.set(e.gameId, []);
      dropReasons.get(e.gameId)!.push(e.reason);
    }
  }

  // Per-game enjoyment evidence.
  const evidence = new Map<string, Evidence>();
  for (const g of games) {
    const parts: EvidencePart[] = [];
    if (g.rating != null) parts.push({ label: `You rated it ${"★".repeat(g.rating)}`, value: RATING_E[g.rating] ?? 0, weight: 1, kind: "rating" });
    if (g.favorite) parts.push({ label: "Marked as a favorite", value: 1, weight: 0.8, kind: "favorite" });
    if (enjoyed.has(g.id)) parts.push({ label: "On your 'games I've enjoyed' list", value: 0.9, weight: 0.9, kind: "profile" });
    if (struggled.has(g.id)) parts.push({ label: "On your 'struggled to stay interested' list", value: -0.6, weight: 0.7, kind: "profile" });
    if (burnout.has(g.id)) parts.push({ label: `You've said you burned out on it (${burnout.get(g.id)})`, value: -0.35, weight: 0.6, kind: "profile" });
    if (g.status === "replay") parts.push({ label: "Marked as a replay candidate", value: 0.6, weight: 0.5, kind: "status" });
    if (g.status === "completed" && g.rating == null) parts.push({ label: "You finished it", value: 0.35, weight: 0.35, kind: "status" });
    if (g.status === "dropped") {
      const rs = dropReasons.get(g.id) ?? [];
      parts.push({
        label: rs.length ? `You dropped it (${rs.map((r) => REASONS[r]?.label.toLowerCase() ?? r).join(", ")})` : "You dropped it",
        value: -0.5,
        weight: 0.5,
        kind: "drop",
      });
    }
    const h = playtimeHours(g);
    const playtimeOnly = parts.length === 0;
    if (playtimeOnly && h >= 2 && !isGroupGame(g)) {
      parts.push({
        label: `${Math.round(h)}h played — time spent, not proof you liked it`,
        value: Math.min(0.25, 0.08 * Math.log2(1 + h)),
        weight: 0.15,
        kind: "playtime",
      });
    }
    if (!parts.length) continue;
    const sw = parts.reduce((s, p) => s + p.weight, 0);
    const value = parts.reduce((s, p) => s + p.value * p.weight, 0) / sw;
    evidence.set(g.id, { value, weight: Math.min(1, sw), parts, playtimeHours: h, playtimeOnly });
  }

  // Tag rarity, so a rare shared tag says more than "action".
  const df = new Map<string, number>();
  for (const g of games) for (const t of g.tags) df.set(t.tag, (df.get(t.tag) ?? 0) + 1);
  const N = Math.max(1, games.length);
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + N / n));

  // Tag affinity from evidence.
  const tagSum = new Map<string, { s: number; w: number; n: number }>();
  for (const g of games) {
    const ev = evidence.get(g.id);
    if (!ev) continue;
    for (const { tag } of g.tags) {
      const a = tagSum.get(tag) ?? { s: 0, w: 0, n: 0 };
      a.s += ev.value * ev.weight;
      a.w += ev.weight;
      a.n += 1;
      tagSum.set(tag, a);
    }
  }
  const tagAff = new Map<string, { aff: number; n: number }>();
  for (const [t, a] of tagSum) tagAff.set(t, { aff: a.s / (a.w + 2), n: a.n });

  // Trait preferences: your games…
  const traitPref = {} as TasteModel["traitPref"];
  for (const T of TRAITS) {
    let s = 0;
    let w = 0;
    for (const g of games) {
      const ev = evidence.get(g.id);
      const v = traits.get(g.id)!.values[T];
      if (!ev || v == null || ev.playtimeOnly || burnout.has(g.id)) continue;
      const p = pole(v);
      s += ev.value * ev.weight * p;
      w += ev.weight * Math.abs(p);
    }
    const value = w > 0 ? (s / (w + 1.5)) * 0.6 : 0;
    traitPref[T] = { value, parts: Math.abs(value) >= 0.05 ? [{ label: "learned from games you rated, finished, dropped or listed", value, source: "your games" }] : [] };
  }

  // …plus your profile text…
  const profileRules: TasteModel["profileRules"] = [];
  let structureTarget: number | null = null;
  const applyRule = (entry: string, list: "values" | "dislikes", rules: Rule[]) => {
    const r = rules.find((x) => x.re.test(entry));
    profileRules.push({ entry, list, effect: r?.effect ?? null });
    if (!r) return;
    for (const [T, v] of Object.entries(r.traits ?? {}) as [Trait, number][]) {
      traitPref[T].value += v;
      traitPref[T].parts.push({ label: `"${entry}"`, value: v, source: "profile" });
    }
    for (const [t, v] of Object.entries(r.tags ?? {})) {
      const a = tagAff.get(t) ?? { aff: 0, n: 0 };
      tagAff.set(t, { aff: a.aff + v, n: a.n });
    }
    if (r.structureTarget != null) structureTarget = r.structureTarget;
  };
  for (const e of profile.values) applyRule(e, "values", VALUE_RULES);
  for (const e of profile.dislikes) applyRule(e, "dislikes", DISLIKE_RULES);

  // …plus recent pass/drop reasons, fading over 60 days.
  const learnedMap = new Map<string, { trait: Trait; delta: number; reason: string; count: number; latest: number }>();
  for (const e of events) {
    if ((e.kind !== "pass" && e.kind !== "drop") || !e.reason) continue;
    if (lastReset && e.ts <= lastReset) continue;
    const def = REASONS[e.reason];
    if (!def?.trait || !def.delta) continue;
    const ageDays = (now.getTime() - Date.parse(e.ts)) / 86400000;
    const fade = Math.max(0, 1 - ageDays / 60);
    if (fade <= 0) continue;
    const key = def.trait + "|" + e.reason;
    const cur = learnedMap.get(key) ?? { trait: def.trait, delta: 0, reason: e.reason, count: 0, latest: 0 };
    cur.delta += def.delta * fade;
    cur.count += 1;
    cur.latest = Math.max(cur.latest, Date.parse(e.ts));
    learnedMap.set(key, cur);
  }
  const learned: TasteModel["learned"] = [];
  for (const l of learnedMap.values()) {
    const delta = Math.max(-0.4, Math.min(0.4, l.delta));
    const fades = new Date(l.latest + 60 * 86400000).toISOString().slice(0, 10);
    traitPref[l.trait].value += delta;
    traitPref[l.trait].parts.push({ label: `you passed ${l.count}× ("${REASONS[l.reason].label.toLowerCase()}")`, value: delta, source: "recent passes", fades });
    learned.push({ trait: l.trait, delta, reason: l.reason, count: l.count, fades });
  }
  for (const T of TRAITS) traitPref[T].value = Math.max(-1, Math.min(1, traitPref[T].value));
  for (const [t, a] of tagAff) tagAff.set(t, { aff: Math.max(-1, Math.min(1, a.aff)), n: a.n });

  return { evidence, tagAff, idf, traitPref, structureTarget, profileMatches, profileRules, learned, traits, burnout: new Set(burnout.keys()), lastReset };
}

/** Tag overlap weighted by rarity (0..1). */
export function similarity(a: Game, b: Game, idf: Map<string, number>): number {
  const ta = new Set(a.tags.map((t) => t.tag).filter((t) => t !== "tool"));
  const tb = new Set(b.tags.map((t) => t.tag).filter((t) => t !== "tool"));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  let union = 0;
  for (const t of new Set([...ta, ...tb])) {
    const w = idf.get(t) ?? 1;
    union += w;
    if (ta.has(t) && tb.has(t)) inter += w;
  }
  return union ? inter / union : 0;
}
