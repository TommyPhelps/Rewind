// Where you are with a game, from its status and imported hours.
import type { Game } from "../lib/types.ts";

/**
 * Minutes played. Steam's figure (from a Steam import) and the value carried over from the
 * old app are kept separately; the larger is used, so a fresh Steam sync never loses hours.
 */
export function playtimeMin(g: Pick<Game, "steamPlaytimeMin" | "importedPlaytimeMin">): number | null {
  const a = g.steamPlaytimeMin;
  const b = g.importedPlaytimeMin;
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

export function playtimeHours(g: Game): number {
  return (playtimeMin(g) ?? 0) / 60;
}

/** Most recent play date we know of: the one REWIND recorded or the one Steam reported. */
export function lastPlayedAny(g: Pick<Game, "lastPlayed" | "steamLastPlayed">): string | null {
  const a = g.lastPlayed;
  const b = g.steamLastPlayed;
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** Played (per REWIND or Steam) within the last `days` days. */
export function recentlyPlayed(g: Pick<Game, "lastPlayed" | "steamLastPlayed">, now = Date.now(), days = 45): boolean {
  const lp = lastPlayedAny(g);
  if (!lp) return false;
  const t = Date.parse(lp.length === 10 ? lp + "T12:00:00Z" : lp);
  return Number.isFinite(t) && now - t <= days * 86_400_000 && t <= now + 86_400_000;
}

/** Hours played against the main-story estimate, if one exists. */
export function progressRatio(g: Game, allowUnverified = true): { hours: number; est: number | null; ratio: number | null } {
  const hours = playtimeHours(g);
  const main = g.lengths.filter((l) => l.kind === "main" && (allowUnverified || l.source === "user"));
  const est = main.length ? Math.min(...main.map((l) => l.hours)) : null;
  return { hours, est, ratio: est ? hours / est : null };
}

export type ProgressState = "finished" | "likely_finished" | "in_progress" | "started" | "dropped" | "not_started";

/**
 * Your status always wins. Hours only fill in when the status is still Backlog:
 * past the estimated main-story length counts as "likely finished", some hours as "started".
 * Deliberately cautious: 37h into a ~40h game is "started", not finished, because
 * estimates are rough and nobody should be told they've finished a game they're still in.
 * For the same reason a game played recently is never "likely finished", whatever the hours.
 */
export function progressState(g: Game, allowUnverified = true, now = Date.now()): ProgressState {
  if (g.status === "completed" || g.status === "replay") return "finished";
  if (g.status === "playing" || g.status === "paused") return "in_progress";
  if (g.status === "dropped") return "dropped";
  const p = progressRatio(g, allowUnverified);
  // Past the estimate but played in the last few weeks: you're most likely still in it.
  if (p.ratio != null && p.ratio >= 1 && !recentlyPlayed(g, now)) return "likely_finished";
  if (p.hours >= 1) return "started";
  return "not_started";
}

/** "37h of ~40h main story" — the one wording used everywhere hours meet an estimate. */
export function progressText(g: Game, allowUnverified = true): string {
  const p = progressRatio(g, allowUnverified);
  if (p.hours < 1) return p.hours > 0 ? "under 1h played" : "not started";
  return p.est ? `${Math.round(p.hours)}h of ~${p.est}h main story` : `${Math.round(p.hours)}h played`;
}
