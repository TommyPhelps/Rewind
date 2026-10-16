// Where you are with a game, from its status and imported hours.
import type { Game } from "../lib/types.ts";

export function playtimeHours(g: Game): number {
  return (g.importedPlaytimeMin ?? 0) / 60;
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
 */
export function progressState(g: Game, allowUnverified = true): ProgressState {
  if (g.status === "completed" || g.status === "replay") return "finished";
  if (g.status === "playing" || g.status === "paused") return "in_progress";
  if (g.status === "dropped") return "dropped";
  const p = progressRatio(g, allowUnverified);
  if (p.ratio != null && p.ratio >= 1) return "likely_finished";
  if (p.hours >= 1) return "started";
  return "not_started";
}

/** "37h of ~40h main story" — the one wording used everywhere hours meet an estimate. */
export function progressText(g: Game, allowUnverified = true): string {
  const p = progressRatio(g, allowUnverified);
  if (p.hours < 1) return p.hours > 0 ? "under 1h played" : "not started";
  return p.est ? `${Math.round(p.hours)}h of ~${p.est}h main story` : `${Math.round(p.hours)}h played`;
}
