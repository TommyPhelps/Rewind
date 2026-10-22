// The library check-up: what's missing, what looks duplicated, and which store links look
// wrong. It only reports; every fix is something you choose (a lookup, combining two
// entries, or changing a match), and lookups only ever fill store data, never your fields.

import { canon } from "./canon.ts";
import { literalKey, titleScore } from "../meta/match.ts";
import { displayLength, genresOf } from "./library.ts";
import type { Game } from "./types.ts";

export type Gap = "cover" | "details" | "length" | "genre";

export const GAP_LABEL: Record<Gap, string> = {
  cover: "No cover",
  details: "No store details",
  length: "No length",
  genre: "No genre",
};

export interface DuplicatePair {
  key: string;
  a: Game;
  b: Game;
  /** "same": identical titles (or the same Steam app). "edition": same game, different edition wording — often really separate. */
  kind: "same" | "edition";
}

export interface Mismatch {
  key: string;
  game: Game;
  provider: "steam" | "igdb";
  listedAs: string;
}

export interface Audit {
  gaps: Map<string, Gap[]>;
  gapCounts: Record<Gap, number>;
  /** Games a store lookup could help: missing something and not ruled out ("not on Steam", never-suggest tools…). */
  lookupIds: string[];
  duplicates: DuplicatePair[];
  mismatches: Mismatch[];
  review: Game[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function auditLibrary(games: Game[], dismissed: Set<string> = new Set(), allowUnverified = true): Audit {
  const gaps = new Map<string, Gap[]>();
  const gapCounts: Record<Gap, number> = { cover: 0, details: 0, length: 0, genre: 0 };
  const lookupIds: string[] = [];
  for (const g of games) {
    const linked = g.meta.steam?.status === "linked" || g.meta.igdb?.status === "linked";
    const hasData = Boolean((g.meta.steam?.status === "linked" && g.meta.steam.data) || (g.meta.igdb?.status === "linked" && g.meta.igdb.data));
    const list: Gap[] = [];
    if (!g.coverPath) list.push("cover");
    if (!hasData) list.push("details");
    if (!g.endless && !displayLength(g, allowUnverified)) list.push("length");
    if (!genresOf(g).length) list.push("genre");
    if (list.length) {
      gaps.set(g.id, list);
      for (const x of list) gapCounts[x]++;
      // Worth a lookup: never looked up, linked but not fetched yet, or it failed last time.
      // "Not found" and "you said it isn't there" are left alone until you ask again.
      const steamRuledOut = g.meta.steam?.status === "none";
      const fetchable = !linked || !hasData || g.meta.steam?.status === "error" || g.meta.igdb?.status === "error";
      if (fetchable && !(steamRuledOut && !g.meta.igdb) && !(list.length === 1 && list[0] === "genre" && linked)) lookupIds.push(g.id);
    }
  }

  const duplicates: DuplicatePair[] = [];
  const seen = new Set<string>();
  const add = (a: Game, b: Game, kind: DuplicatePair["kind"]) => {
    const key = pairKey(a.id, b.id);
    if (seen.has(key) || dismissed.has("dup:" + key)) return;
    seen.add(key);
    duplicates.push({ key, a, b, kind });
  };
  const byLiteral = new Map<string, Game[]>();
  const byCanon = new Map<string, Game[]>();
  const bySteam = new Map<number, Game[]>();
  for (const g of games) {
    const lk = literalKey(g.title);
    if (lk) byLiteral.set(lk, [...(byLiteral.get(lk) ?? []), g]);
    const ck = canon(g.title);
    if (ck) byCanon.set(ck, [...(byCanon.get(ck) ?? []), g]);
    const sid = g.meta.steam?.status === "linked" ? Number(g.meta.steam.providerId) : null;
    if (sid) bySteam.set(sid, [...(bySteam.get(sid) ?? []), g]);
  }
  for (const xs of [...byLiteral.values(), ...bySteam.values()]) for (let i = 1; i < xs.length; i++) add(xs[0], xs[i], "same");
  for (const xs of byCanon.values()) for (let i = 1; i < xs.length; i++) add(xs[0], xs[i], "edition");

  const mismatches: Mismatch[] = [];
  for (const g of games) {
    for (const p of ["steam", "igdb"] as const) {
      const m = g.meta[p];
      if (m?.status !== "linked" || !m.data?.name || m.method === "user" || m.method === "steam_import") continue;
      const key = `mm:${g.id}:${p}`;
      if (dismissed.has(key)) continue;
      if (titleScore(g.title, m.data.name).score < 0.75) mismatches.push({ key, game: g, provider: p, listedAs: m.data.name });
    }
  }

  const review = games.filter((g) => g.meta.steam?.status === "review" || g.meta.igdb?.status === "review");
  return { gaps, gapCounts, lookupIds, duplicates, mismatches, review };
}
