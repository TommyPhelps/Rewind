// Turns a recommendation into a short explanation about *this* game: the engine's specific
// reasons (similar games you enjoyed, the series, your own answers) plus facts that come
// from the game's own data (genres or tags, length, developer). Nothing is invented: when
// REWIND knows little about a game, the explanation says less rather than padding it out.

import { cleanTitle } from "../lib/canon.ts";
import { companies, displayLength, fmtHours, genresOf } from "../lib/library.ts";
import type { Game } from "../lib/types.ts";
import type { Rec } from "./engine.ts";

/** Reasons that would fit almost any game, so they're never shown as "why this one". */
const GENERIC = [/^Already in your library$/, /^Works in a short session$/, /^Rewards a high-energy session$/, /^Easy-going enough/];

export interface Explanation {
  reasons: string[];
  caveat: string | null;
  facts: string;
}

export function gameFacts(g: Game, allowUnverified = true): string {
  const bits: string[] = [];
  const genres = genresOf(g).slice(0, 2);
  if (genres.length) bits.push(genres.join(", "));
  else {
    const tags = [...g.tags].sort((a, b) => Number(b.source === "user") - Number(a.source === "user")).slice(0, 2).map((t) => t.tag);
    if (tags.length) bits.push(tags.join(", "));
  }
  if (g.endless) bits.push("no set ending");
  else {
    const len = displayLength(g, allowUnverified);
    if (len) bits.push(`${len.verified ? "" : "about "}${fmtHours(len.hours)} ${len.kind === "main" ? "main story" : "with extras"}`);
  }
  const dev = g.developer ?? companies(g)[0];
  if (dev) bits.push(dev);
  const out = bits.join(" · ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function explain(rec: Rec, allowUnverified = true, max = 3): Explanation {
  const reasons = rec.pros
    .map((p) => p.text)
    .filter((t) => !GENERIC.some((r) => r.test(t)))
    .slice(0, max);
  const caveat = rec.cons[0]?.text ?? null;
  return { reasons, caveat, facts: gameFacts(rec.game, allowUnverified) };
}

/** One line for small cards: the most specific reason, else the game's facts. */
export function oneLine(rec: Rec, allowUnverified = true): string {
  const e = explain(rec, allowUnverified, 1);
  return e.reasons[0] ?? e.facts ?? cleanTitle(rec.game.title);
}
