// Applies the bundled REWIND reference estimates (src/data/referenceTraits.ts).
//
// Rules:
//  - only fills what is still unknown (no tags yet, players "unknown", no length class, endless unknown);
//  - supplement lines only ADD trait tags, never remove anything;
//  - every value is stored with source "reference" so the UI labels it as an estimate;
//  - each game is offered a given reference version once (games.ref_version), so if you
//    delete or change something it is never put back.

import type { Statement } from "../db/driver.ts";
import type { Repo } from "../db/repo.ts";
import { canon } from "../lib/canon.ts";
import { parseReference, REFERENCE_VERSION, type ReferenceEntry } from "../data/referenceTraits.ts";

const PLAYERS: Record<string, string> = { S: "solo", O: "solo_and_mp", C: "coop_focused", M: "mp_required" };
const SCALE: Record<string, string> = { S: "short", M: "medium", L: "long", E: "endless" };

let INDEX: { main: Map<string, ReferenceEntry>; supp: Map<string, ReferenceEntry> } | null = null;
export function referenceIndex() {
  if (INDEX) return INDEX;
  const main = new Map<string, ReferenceEntry>();
  const supp = new Map<string, ReferenceEntry>();
  for (const e of parseReference()) (e.supplement ? supp : main).set(canon(e.title), e);
  INDEX = { main, supp };
  return INDEX;
}

export async function applyReferenceData(repo: Repo): Promise<{ games: number; filled: number }> {
  const rows = await repo.driver.select<Record<string, unknown>>(
    `SELECT g.id, g.canon, g.multiplayer, g.endless, g.scale, g.meta_source,
            (SELECT COUNT(*) FROM game_tags t WHERE t.game_id = g.id) AS ntags
       FROM games g WHERE g.ref_version IS NULL OR g.ref_version < ?`,
    [REFERENCE_VERSION],
  );
  if (!rows.length) return { games: 0, filled: 0 };
  const { main, supp } = referenceIndex();
  const stmts: Statement[] = [];
  let filled = 0;
  for (const r of rows) {
    const id = String(r.id);
    const key = String(r.canon);
    const e = main.get(key);
    const s = supp.get(key);
    let meta: Record<string, string> = {};
    try {
      meta = JSON.parse(String(r.meta_source || "{}"));
    } catch {
      meta = {};
    }
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (e) {
      filled++;
      const tags = e.players === "T" ? ["tool", ...e.tags] : e.tags;
      if (Number(r.ntags) === 0) {
        for (const t of tags) stmts.push({ sql: `INSERT OR IGNORE INTO game_tags (game_id, tag, source) VALUES (?, ?, 'reference')`, params: [id, t] });
        if (tags.length) meta.tags = "reference";
      }
      if (r.multiplayer === "unknown" && PLAYERS[e.players]) {
        sets.push("multiplayer = ?");
        params.push(PLAYERS[e.players]);
        meta.multiplayer = "reference";
      }
      if (r.scale == null && SCALE[e.scale]) {
        sets.push("scale = ?");
        params.push(SCALE[e.scale]);
        meta.scale = "reference";
      }
      if (r.endless == null && SCALE[e.scale]) {
        sets.push("endless = ?");
        params.push(e.scale === "E" ? 1 : 0);
        meta.endless = "reference";
      }
    }
    if (s) {
      filled++;
      for (const t of s.tags) stmts.push({ sql: `INSERT OR IGNORE INTO game_tags (game_id, tag, source) VALUES (?, ?, 'reference')`, params: [id, t] });
    }
    sets.push("ref_version = ?", "meta_source = ?");
    params.push(REFERENCE_VERSION, JSON.stringify(meta));
    stmts.push({ sql: `UPDATE games SET ${sets.join(", ")} WHERE id = ?`, params: [...params, id] });
  }
  await repo.driver.batch(stmts);
  return { games: rows.length, filled };
}
