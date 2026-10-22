// Your answers to Discover suggestions ("marks"), and what REWIND does with them.
//
//  - Interested / Want to try: shown in Saved, and nudge similar suggestions up a little.
//  - Wishlisted: kept in your wishlist (with a snapshot so it works offline). Never added
//    to your library unless you press "Add to library" yourself.
//  - Already played: taken out of "new to you" suggestions. For a game in your library,
//    REWIND offers to update its status but never changes it on its own.
//  - Not interested: hidden for a while (90 days the first time, longer if you say it
//    again), then it may come back. Nothing is suppressed forever unless you choose
//    "Never suggest" on the game itself.

export type MarkKind = "interested" | "not_interested" | "played" | "want" | "wishlist";

export const MARKS: { id: MarkKind; label: string; short: string; key: string; hint: string }[] = [
  { id: "interested", label: "Interested", short: "Interested", key: "i", hint: "Keep it in Saved; similar suggestions rise a little" },
  { id: "want", label: "Want to try", short: "Want to try", key: "t", hint: "Top of Saved; Pick for me favours it too (library games)" },
  { id: "wishlist", label: "Wishlisted", short: "Wishlist", key: "w", hint: "For games you don't own: saved with its details for offline" },
  { id: "played", label: "Already played", short: "Played", key: "p", hint: "Taken out of 'new to you' suggestions" },
  { id: "not_interested", label: "Not interested", short: "Not for me", key: "n", hint: "Hidden for a while, then it may come back" },
];
export const MARK_LABEL: Record<MarkKind, string> = Object.fromEntries(MARKS.map((m) => [m.id, m.label])) as Record<MarkKind, string>;

export interface Mark {
  key: string;
  kind: MarkKind;
  title: string;
  gameId: string | null;
  /** What was shown when you marked it (cover, year, store link, modpack facts…). */
  snapshot: Record<string, unknown>;
  /** How many times in a row you've given this same answer. */
  times: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** Days a "Not interested" answer hides an item: 90, then 180, then a year. */
export function hideDays(times: number, baseDays = 90): number {
  return Math.min(365, baseDays * Math.max(1, Math.min(4, times)));
}

/** The date a "Not interested" item may come back, or null if it isn't hidden. */
export function hiddenUntil(m: Mark | undefined, baseDays = 90): string | null {
  if (!m || m.kind !== "not_interested") return null;
  const t = Date.parse(m.updatedAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t + hideDays(m.times, baseDays) * 86_400_000).toISOString().slice(0, 10);
}

export function isHidden(m: Mark | undefined, now = new Date(), baseDays = 90): boolean {
  const until = hiddenUntil(m, baseDays);
  return until != null && until > now.toISOString().slice(0, 10);
}

/** Saved = something you said yes (or "later") to. */
export const isSaved = (m: Mark | undefined) => !!m && (m.kind === "interested" || m.kind === "want" || m.kind === "wishlist");

export const gameKey = (gameId: string) => `game:${gameId}`;
export const igdbKey = (id: number | string) => `igdb:${id}`;
/** Saved modpacks from REWIND 4 ("mr:…", "cf:…") are kept in the database and exports, not shown. */
export type KeySource = "game" | "igdb" | "mr" | "cf";
export function keySource(key: string): KeySource | null {
  const s = key.split(":")[0];
  return s === "game" || s === "igdb" || s === "mr" || s === "cf" ? s : null;
}
