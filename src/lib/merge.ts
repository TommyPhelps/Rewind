// Combining two library entries that turned out to be the same game (found by the library
// check-up, or chosen by you in the Library). One transaction; nothing of yours is lost:
// the kept entry's own values win, empty ones are filled from the other, notes are joined,
// and everything attached to the other entry (sessions, tags, launchers, history, Up Next
// place, Discover answers, store links) moves over before it is removed.

import type { Statement } from "../db/driver.ts";
import { nowIso, type Repo } from "../db/repo.ts";
import { cleanTitle } from "./canon.ts";
import type { Game, Status } from "./types.ts";

const RANK: Record<Status, number> = { not_interested: 0, backlog: 1, replay: 2, paused: 3, playing: 4, dropped: 5, completed: 6 };

const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
const laterOf = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Which entry to keep by default: the one with more of your own data (then the older one). */
export function preferredKeeper(a: Game, b: Game): [keep: Game, drop: Game] {
  const weight = (g: Game) =>
    (g.rating != null ? 3 : 0) + (g.notes.trim() ? 3 : 0) + (g.favorite ? 1 : 0) + (g.status !== "backlog" ? 2 : 0) + g.tags.filter((t) => t.source === "user").length + g.sources.length + (g.coverPath ? 1 : 0) + (g.steamAppId != null ? 1 : 0);
  const wa = weight(a);
  const wb = weight(b);
  if (wa !== wb) return wa > wb ? [a, b] : [b, a];
  return a.createdAt <= b.createdAt ? [a, b] : [b, a];
}

export interface MergePreview {
  status: Status;
  rating: number | null;
  notes: string;
  moved: string[];
}

/** What the kept entry will look like, in words, for the confirmation dialog. */
export function mergePreview(keep: Game, drop: Game): MergePreview {
  const moved: string[] = [];
  if (drop.sources.length) moved.push(`${drop.sources.length} launcher record${drop.sources.length > 1 ? "s" : ""}`);
  const newTags = drop.tags.filter((t) => !keep.tags.some((k) => k.tag === t.tag));
  if (newTags.length) moved.push(`${newTags.length} tag${newTags.length > 1 ? "s" : ""}`);
  if (drop.rating != null && keep.rating == null) moved.push("its rating");
  if (drop.notes.trim()) moved.push("its notes");
  moved.push("its play sessions and history");
  return { status: mergedStatus(keep, drop), rating: keep.rating ?? drop.rating, notes: mergedNotes(keep, drop), moved };
}

function mergedStatus(keep: Game, drop: Game): Status {
  // Keep yours unless it's the default and the other says more (playing, finished…).
  return keep.status === "backlog" && RANK[drop.status] > RANK.backlog ? drop.status : keep.status;
}

function mergedNotes(keep: Game, drop: Game): string {
  const a = keep.notes.trim();
  const b = drop.notes.trim();
  if (!b || a.includes(b)) return keep.notes;
  if (!a) return drop.notes;
  return `${keep.notes.trimEnd()}\n\n— from “${cleanTitle(drop.title)}” —\n${b}`;
}

export function mergeStatements(repo: Repo, keep: Game, drop: Game, now = nowIso()): Statement[] {
  if (keep.id === drop.id) throw new Error("Those are the same entry.");
  const K = keep.id;
  const D = drop.id;
  const ownership = keep.ownership === "owned" || drop.ownership === "owned" ? "owned" : keep.ownership === "unknown" ? drop.ownership : keep.ownership;
  const install = keep.installStatus === "installed" || drop.installStatus === "installed" ? "installed" : keep.installStatus === "unknown" ? drop.installStatus : keep.installStatus;
  const steamId = keep.steamAppId ?? drop.steamAppId;
  const metaSource = JSON.stringify({ ...drop.metaSource, ...keep.metaSource });
  const s: Statement[] = [];
  // The Steam app id is unique across the library, so it's released from the other entry first.
  if (drop.steamAppId != null) s.push({ sql: `UPDATE games SET steam_app_id = NULL WHERE id = ?`, params: [D] });
  s.push({
    sql: `UPDATE games SET status = ?, rating = ?, favorite = ?, notes = ?, ownership = ?, install_status = ?, steam_app_id = ?,
            storefront = COALESCE(storefront, ?), cover_path = COALESCE(cover_path, ?), description = COALESCE(description, ?),
            release_year = COALESCE(release_year, ?), developer = COALESCE(developer, ?), publisher = COALESCE(publisher, ?),
            imported_playtime_min = ?, playtime_source = COALESCE(playtime_source, ?), steam_playtime_min = ?, steam_last_played = ?,
            steam_synced_at = COALESCE(steam_synced_at, ?), last_played = ?, date_completed = COALESCE(date_completed, ?),
            date_dropped = COALESCE(date_dropped, ?), multiplayer = CASE WHEN multiplayer = 'unknown' THEN ? ELSE multiplayer END,
            endless = COALESCE(endless, ?), scale = COALESCE(scale, ?), meta_source = ?, updated_at = ?
          WHERE id = ?`,
    params: [
      mergedStatus(keep, drop),
      keep.rating ?? drop.rating,
      keep.favorite || drop.favorite ? 1 : 0,
      mergedNotes(keep, drop),
      ownership,
      install,
      steamId,
      drop.storefront,
      drop.coverPath,
      drop.description,
      drop.releaseYear,
      drop.developer,
      drop.publisher,
      maxOf(keep.importedPlaytimeMin, drop.importedPlaytimeMin),
      drop.playtimeSource,
      maxOf(keep.steamPlaytimeMin, drop.steamPlaytimeMin),
      laterOf(keep.steamLastPlayed, drop.steamLastPlayed),
      drop.steamSyncedAt,
      laterOf(keep.lastPlayed, drop.lastPlayed),
      drop.dateCompleted,
      drop.dateDropped,
      drop.multiplayer,
      drop.endless == null ? null : drop.endless ? 1 : 0,
      drop.scale,
      metaSource,
      now,
      K,
    ],
  });
  // Rows keyed by game: copy what the kept entry doesn't have yet; the rest goes with the other entry.
  s.push({ sql: `INSERT OR IGNORE INTO game_tags (game_id, tag, source) SELECT ?, tag, source FROM game_tags WHERE game_id = ?`, params: [K, D] });
  s.push({ sql: `INSERT OR IGNORE INTO game_lengths (game_id, kind, hours, source, updated_at) SELECT ?, kind, hours, source, updated_at FROM game_lengths WHERE game_id = ?`, params: [K, D] });
  s.push({ sql: `UPDATE OR IGNORE game_sources SET game_id = ? WHERE game_id = ?`, params: [K, D] });
  s.push({ sql: `UPDATE OR IGNORE game_meta SET game_id = ? WHERE game_id = ?`, params: [K, D] });
  s.push({ sql: `UPDATE OR IGNORE collection_games SET game_id = ? WHERE game_id = ?`, params: [K, D] });
  s.push({ sql: `UPDATE OR IGNORE discover_marks SET item_key = 'game:' || ?, game_id = ? WHERE item_key = 'game:' || ?`, params: [K, K, D] });
  for (const t of ["sessions", "playthroughs", "events", "rec_events"]) s.push({ sql: `UPDATE ${t} SET game_id = ? WHERE game_id = ?`, params: [K, D] });
  s.push({ sql: `UPDATE mod_profiles SET game_id = ? WHERE game_id = ?`, params: [K, D] });
  s.push({ sql: `DELETE FROM games WHERE id = ?`, params: [D] });
  s.push(repo.eventStatement("games_merged", K, { kept: keep.title, merged: drop.title }, now));
  return s;
}
