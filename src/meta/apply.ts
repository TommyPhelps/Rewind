// Turns linked metadata into small, reversible changes to a game:
//  - REWIND tags implied by Steam user tags / IGDB genres (source "steam_tags" / "igdb")
//  - player modes from Steam, replacing only estimates (never your own choice)
//  - IGDB time-to-beat as lengths (source "igdb"; your own lengths still win)
//  - the cached cover, unless you picked your own
// Your title, status, rating, notes, favourites, own tags and lengths are never touched.

import type { Statement } from "../db/driver.ts";
import { nowIso } from "../db/repo.ts";
import type { Game } from "../lib/types.ts";
import { canReplace, igdbToRewind, steamPlayers, steamTagsToRewind } from "./mapping.ts";
import type { Art, MetaRecord } from "./types.ts";

const META_TAG_SOURCES = ["steam_tags", "igdb"];

/** The best cached cover: Steam portrait, then IGDB portrait, then Steam's landscape header. */
export function bestCover(g: Pick<Game, "meta">): { art: Art; provider: "steam" | "igdb" } | null {
  const s = g.meta.steam?.status === "linked" ? g.meta.steam.data?.art : undefined;
  const i = g.meta.igdb?.status === "linked" ? g.meta.igdb.data?.art : undefined;
  if (s?.cover?.file) return { art: s.cover, provider: "steam" };
  if (i?.cover?.file) return { art: i.cover, provider: "igdb" };
  if (s?.header?.file) return { art: s.header, provider: "steam" };
  return null;
}

export function applyStatements(g: Game): Statement[] {
  const stmts: Statement[] = [];
  const steam = linked(g.meta.steam);
  const igdb = linked(g.meta.igdb);
  const ms = { ...g.metaSource };
  let msChanged = false;
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  // Tags: recompute the metadata-sourced ones; never remove or relabel tags from any other source.
  const hidden = new Set((ms.hiddenTags ?? "").split(",").filter(Boolean));
  const want = new Map<string, string>();
  if (steam?.data) for (const t of steamTagsToRewind(steam.data)) want.set(t, "steam_tags");
  if (igdb?.data) for (const t of igdbToRewind(igdb.data)) if (!want.has(t)) want.set(t, "igdb");
  const current = new Map(g.tags.map((t) => [t.tag, t.source]));
  for (const [tag, source] of current) {
    if (META_TAG_SOURCES.includes(source) && want.get(tag) !== source) stmts.push({ sql: `DELETE FROM game_tags WHERE game_id = ? AND tag = ? AND source = ?`, params: [g.id, tag, source] });
  }
  for (const [tag, source] of want) {
    if (hidden.has(tag) || current.has(tag)) continue;
    stmts.push({ sql: `INSERT OR IGNORE INTO game_tags (game_id, tag, source) VALUES (?, ?, ?)`, params: [g.id, tag, source] });
  }

  // Player modes: Steam's categories are facts; they replace estimates but not your own choice.
  if (steam?.data) {
    const p = steamPlayers(steam.data);
    if (p && canReplace(g, "multiplayer") && (p !== g.multiplayer || ms.multiplayer !== "steam")) {
      sets.push("multiplayer = ?");
      params.push(p);
      ms.multiplayer = "steam";
      msChanged = true;
    }
  }

  // Lengths: IGDB's player-submitted completion times, labelled as such.
  const ttb = igdb?.data?.timeToBeat;
  stmts.push({ sql: `DELETE FROM game_lengths WHERE game_id = ? AND source = 'igdb'`, params: [g.id] });
  if (ttb) {
    const t = nowIso();
    for (const [kind, h] of [["main", ttb.main], ["main_extras", ttb.extras], ["completionist", ttb.complete]] as const) {
      if (h && h > 0 && h < 5000) stmts.push({ sql: `INSERT INTO game_lengths (game_id, kind, hours, source, updated_at) VALUES (?, ?, ?, 'igdb', ?)`, params: [g.id, kind, h, t] });
    }
  }

  // Cover: the cached file, unless you chose your own picture.
  if (ms.coverPath !== "user") {
    const best = bestCover(g);
    const file = best?.art.file ?? null;
    if (file !== g.coverPath) {
      sets.push("cover_path = ?");
      params.push(file);
    }
    const src = best ? `${best.provider}:${best.art.kind}` : undefined;
    if (ms.cover !== src) {
      if (src) ms.cover = src;
      else delete ms.cover;
      msChanged = true;
    }
  }

  if (msChanged) {
    sets.push("meta_source = ?");
    params.push(JSON.stringify(ms));
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    params.push(nowIso());
    stmts.push({ sql: `UPDATE games SET ${sets.join(", ")} WHERE id = ?`, params: [...params, g.id] });
  }
  return stmts;
}

/** Statements that remove everything a provider contributed (used by "Unlink"). */
export function unlinkStatements(g: Game, provider: "steam" | "igdb"): Statement[] {
  const out: Statement[] = [];
  if (provider === "steam") {
    out.push({ sql: `DELETE FROM game_tags WHERE game_id = ? AND source = 'steam_tags'`, params: [g.id] });
    const ms = { ...g.metaSource };
    const sets = ["steam_app_id = NULL"];
    if (ms.multiplayer === "steam") {
      delete ms.multiplayer;
      sets.push("multiplayer = 'unknown'");
    }
    if (ms.cover?.startsWith("steam")) {
      delete ms.cover;
      sets.push("cover_path = NULL");
    }
    out.push({ sql: `UPDATE games SET ${sets.join(", ")}, meta_source = ?, updated_at = ? WHERE id = ?`, params: [JSON.stringify(ms), nowIso(), g.id] });
  } else {
    out.push({ sql: `DELETE FROM game_tags WHERE game_id = ? AND source = 'igdb'`, params: [g.id] });
    out.push({ sql: `DELETE FROM game_lengths WHERE game_id = ? AND source = 'igdb'`, params: [g.id] });
    if (g.metaSource.cover?.startsWith("igdb")) {
      const ms = { ...g.metaSource };
      delete ms.cover;
      out.push({ sql: `UPDATE games SET cover_path = NULL, meta_source = ?, updated_at = ? WHERE id = ?`, params: [JSON.stringify(ms), nowIso(), g.id] });
    }
  }
  return out;
}

function linked(m: MetaRecord | undefined): MetaRecord | null {
  return m && m.status === "linked" ? m : null;
}

/** "Use the Steam / IGDB cover again" after you picked your own picture. */
export function resetCoverStatements(g: Game): Statement[] {
  const ms = { ...g.metaSource };
  delete ms.coverPath;
  const best = bestCover(g);
  if (best) ms.cover = `${best.provider}:${best.art.kind}`;
  else delete ms.cover;
  return [{ sql: `UPDATE games SET cover_path = ?, meta_source = ?, updated_at = ? WHERE id = ?`, params: [best?.art.file ?? null, JSON.stringify(ms), nowIso(), g.id] }];
}
