// Title matching with an honest confidence score. Used for Steam imports and metadata
// lookups. "Exact" means the normalised titles are identical; anything less is shown
// to you before it is used, and sequels / different numbers never count as a match.

import { canon } from "../lib/canon.ts";

/** canon() plus a few extra edition words, for "same game, different edition" checks. */
export function coreKey(title: string): string {
  return canon(title)
    .replace(/\b(the complete|complete|definitive|enhanced|remastered|remaster|directors cut|game of the year|goty|deluxe|ultimate|anniversary|classic|legacy|hd|vr)\b( edition)?/g, " ")
    .replace(/\b(edition|collection)\b$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const numbers = (s: string) => (s.match(/\b\d+\b/g) ?? []).filter((n) => !/^(19|20)\d\d$/.test(n)).join(",");

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity of character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [k, n] of A) {
    inter += Math.min(n, B.get(k) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

export interface TitleMatch {
  score: number; // 0..1
  reason: "exact" | "edition" | "similar" | "different_number" | "weak";
}

export function titleScore(a: string, b: string): TitleMatch {
  const ca = canon(a);
  const cb = canon(b);
  if (ca && ca === cb) return { score: 1, reason: "exact" };
  const ka = coreKey(a);
  const kb = coreKey(b);
  // A sequel number that differs ("Dark Souls 2" vs "Dark Souls 3", or "Portal" vs "Portal 2") is a different game.
  if (numbers(ka) !== numbers(kb)) return { score: Math.min(0.45, dice(ka, kb) * 0.5), reason: "different_number" };
  if (ka && ka === kb) return { score: 0.93, reason: "edition" };
  const d = dice(ka, kb);
  // One title containing the other with extra words ("Hitman" vs "Hitman: Absolution") is risky.
  const s = d >= 0.9 ? d * 0.95 : d * 0.85;
  return { score: Math.round(s * 1000) / 1000, reason: s >= 0.75 ? "similar" : "weak" };
}

export type Confidence = "exact" | "high" | "medium" | "low";

export function confidenceOf(score: number): Confidence {
  return score >= 0.999 ? "exact" : score >= 0.9 ? "high" : score >= 0.75 ? "medium" : "low";
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  exact: "Exact title match",
  high: "Same title, different edition wording",
  medium: "Similar title — please check",
  low: "Weak match",
};

/** Best candidates for a title, highest first, with a flag when the top two are too close to call. */
export function rankCandidates<T extends { name: string }>(title: string, items: T[]): { item: T; match: TitleMatch }[] {
  return items
    .map((item) => ({ item, match: titleScore(title, item.name) }))
    .filter((x) => x.match.score > 0.3)
    .sort((a, b) => b.match.score - a.match.score);
}

/** The title as written, minus ™/®, punctuation and case: "GTA V Legacy" ≠ "GTA V Enhanced" here. */
export function literalKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Auto-link only when the best candidate is exact (or same core title) and nothing else is as good. */
export function autoPick<T extends { name: string }>(title: string, items: T[]): { item: T; match: TitleMatch } | null {
  const r = rankCandidates(title, items);
  if (!r.length) return null;
  const [best, second] = r;
  if (best.match.score < 0.9) return null;
  if (second && second.match.score >= best.match.score - 0.02) {
    // Two equally good names (e.g. "Hard Reset" and "Hard Reset Redux"): only the literal title breaks the tie.
    const lit = literalKey(title);
    const tied = r.filter((x) => x.match.score >= best.match.score - 0.02);
    const literal = tied.filter((x) => literalKey(x.item.name) === lit);
    if (literal.length === 1) return literal[0];
    if (!(best.match.reason === "exact" && second.match.reason !== "exact")) return null;
  }
  return best;
}
