// Playing / Up Next / Series follow-ups / Paused / Replay are different things:
//  - Playing, Paused, Replay candidate are statuses you set.
//  - Up Next is your own hand-ordered collection.
//  - Series follow-ups is AUTOMATIC: sequels to games you're playing or have finished.
// The Up Next review only ever SUGGESTS changes; nothing happens until you click.

import type { Collection, Game, Status } from "./types.ts";
import { cleanTitle } from "./canon.ts";
import { progressRatio, progressState, type ProgressState } from "../rec/progress.ts";
import { seriesNeighbours, seriesNext, type SeriesInfo } from "../rec/series.ts";

export const UP_NEXT = "up next";
export const findUpNext = (cols: Collection[]) => cols.find((c) => c.name.toLowerCase() === UP_NEXT) ?? null;

export interface FollowUp {
  game: Game;
  after: Game;
  afterState: ProgressState;
  ready: boolean; // the earlier game is finished
  text: string;
}

/** Sequels you own whose earlier entry you're playing, have started, or have finished. */
export function seriesFollowUps(games: Game[], index: Map<string, SeriesInfo>, allowUnverified = true): FollowUp[] {
  const byCanon = new Map(games.map((g) => [g.canon, g]));
  const out: FollowUp[] = [];
  const seen = new Set<string>();
  for (const g of games) {
    const st = progressState(g, allowUnverified);
    if (st === "not_started" || st === "dropped") continue;
    const next = seriesNext(g, index, byCanon);
    if (!next || seen.has(next.id)) continue;
    if (next.ownership === "not_owned" || next.status === "completed" || next.status === "not_interested") continue;
    if (next.status === "playing" || next.status === "paused") continue;
    const ready = st === "finished" || st === "likely_finished";
    const p = progressRatio(g, allowUnverified);
    const t = cleanTitle(g.title);
    const text = ready
      ? st === "finished"
        ? `Ready: you've finished ${t}`
        : `Probably ready: ${t} looks finished (${Math.round(p.hours)}h, past the ~${p.est}h main story)`
      : g.status === "playing"
        ? `Waiting: you're playing ${t}`
        : g.status === "paused"
          ? `Waiting: ${t} is paused`
          : `Waiting: ${t} is ${Math.round(p.hours)}h in, not finished`;
    seen.add(next.id);
    out.push({ game: next, after: g, afterState: st, ready, text });
  }
  return out.sort((a, b) => Number(b.ready) - Number(a.ready) || a.game.title.localeCompare(b.game.title));
}

/**
 * "Continue where you left off": paused games first, then backlog games you've put real time
 * into but haven't finished. Endless, multiplayer-only, MMO and non-game tools are left out — there is no
 * "where you left off" in Counter-Strike.
 */
export function resumeCandidates(games: Game[], allowUnverified = true): Game[] {
  return games
    .filter((g) => {
      if (g.status === "paused") return true;
      if (g.status !== "backlog" || g.endless || g.multiplayer === "mp_required" || g.multiplayer === "coop_focused") return false;
      if (g.scale === "endless" || g.tags.some((t) => t.tag === "tool" || t.tag === "mmo")) return false;
      if (progressState(g, allowUnverified) !== "started") return false;
      const p = progressRatio(g, allowUnverified);
      if (p.hours < 2) return false;
      // Only games that have somewhere to get to: a known length, or at least a known scale.
      if (p.ratio != null) return p.ratio >= 0.1;
      return g.scale === "short" || g.scale === "medium" || g.scale === "long" ? p.hours >= 3 : false;
    })
    .sort((a, b) => {
      const pa = progressRatio(a, allowUnverified);
      const pb = progressRatio(b, allowUnverified);
      return (
        Number(b.status === "paused") - Number(a.status === "paused") ||
        (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "") ||
        Number(pb.ratio != null) - Number(pa.ratio != null) ||
        (pb.ratio ?? 0) - (pa.ratio ?? 0) ||
        pb.hours - pa.hours
      );
    });
}

export type ReviewAction = { label: string; op: "remove" | "keep" | `status:${Status}` };

export interface ReviewItem {
  gameId: string;
  key: string; // gameId:kind — used to remember "keep as is"
  kind: "playing" | "finished" | "sequel_waiting" | "progress_unknown" | "struggled";
  text: string;
  actions: ReviewAction[];
}

/** Suggestions for tidying Up Next. One per game, most important first. Never applied automatically. */
export function reviewUpNext(
  upNext: Collection | null,
  games: Game[],
  index: Map<string, SeriesInfo>,
  opts: { dismissed?: Set<string>; struggled?: Set<string>; allowUnverified?: boolean } = {},
): ReviewItem[] {
  if (!upNext) return [];
  const byId = new Map(games.map((g) => [g.id, g]));
  const dismissed = opts.dismissed ?? new Set<string>();
  const out: ReviewItem[] = [];
  const keep: ReviewAction = { label: "Keep as is", op: "keep" };
  const remove: ReviewAction = { label: "Remove from Up Next", op: "remove" };
  upNext.gameIds.forEach((id, idx) => {
    const g = byId.get(id);
    if (!g) return;
    const t = cleanTitle(g.title);
    const push = (kind: ReviewItem["kind"], text: string, actions: ReviewAction[]) => {
      const key = `${id}:${kind}`;
      if (!dismissed.has(key)) out.push({ gameId: id, key, kind, text, actions });
    };
    if (g.status === "playing") return push("playing", `You're playing ${t} now, so it doesn't need a spot in Up Next.`, [remove, keep]);
    if (g.status === "completed" || g.status === "dropped" || g.status === "not_interested") {
      return push("finished", `${t} is marked ${g.status.replace("_", " ")}.`, [remove, keep]);
    }
    const prev = seriesNeighbours(g, index, byId)?.previous;
    if (prev) {
      const ps = progressState(prev, opts.allowUnverified ?? true);
      const prevQueued = upNext.gameIds.indexOf(prev.id);
      if (ps === "in_progress" || ps === "started" || (prevQueued >= 0 && prevQueued < idx && ps !== "finished")) {
        return push(
          "sequel_waiting",
          `${t} follows ${cleanTitle(prev.title)}, which isn't finished. It will show under Series follow-ups automatically, so it doesn't need to sit in Up Next.`,
          [remove, keep],
        );
      }
    }
    if (g.status === "backlog") {
      const p = progressRatio(g, opts.allowUnverified ?? true);
      const st = progressState(g, opts.allowUnverified ?? true);
      if (st === "likely_finished") {
        return push("progress_unknown", `${t} has ${Math.round(p.hours)}h played (main story is ~${p.est}h). Are you playing it, or is it finished?`, [
          { label: "Mark Playing", op: "status:playing" },
          { label: "Mark Completed", op: "status:completed" },
          keep,
        ]);
      }
      if (p.hours >= 3) {
        return push("progress_unknown", `${t} already has ${Math.round(p.hours)}h played. Are you playing it?`, [
          { label: "Mark Playing", op: "status:playing" },
          { label: "Mark Paused", op: "status:paused" },
          keep,
        ]);
      }
    }
    if (opts.struggled?.has(id)) push("struggled", `${t} is on your "struggled to stay interested" list.`, [remove, keep]);
  });
  return out;
}
