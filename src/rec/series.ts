// Series order from the old REWIND lists (release order). Phase 3 replaces this
// with a proper series navigator; here it only powers "natural follow-up to …".
import { canon } from "../lib/canon.ts";
import type { Game } from "../lib/types.ts";
import { LEGACY_SERIES } from "../migrate/legacyReference.ts";

export interface SeriesInfo {
  series: number;
  position: number;
  /** canon keys of every entry, in order (each entry may have aliases) */
  entries: string[][];
}

export function buildSeriesIndex(): Map<string, SeriesInfo> {
  const map = new Map<string, SeriesInfo>();
  LEGACY_SERIES.forEach((list, si) => {
    const entries = list.map((e) => (Array.isArray(e) ? e : [e]).map((t) => canon(t)));
    entries.forEach((keys, pos) => keys.forEach((k) => { if (!map.has(k)) map.set(k, { series: si, position: pos, entries }); }));
  });
  return map;
}

/** The closest earlier entry of the same series that is in the library, if any. */
export function seriesNeighbours(g: Game, index: Map<string, SeriesInfo>, byId: Map<string, Game>): { previous: Game | null } | null {
  const info = index.get(g.canon);
  if (!info || info.position === 0) return null;
  const byCanon = new Map<string, Game>();
  for (const x of byId.values()) byCanon.set(x.canon, x);
  for (let p = info.position - 1; p >= 0; p--) {
    for (const k of info.entries[p]) {
      const hit = byCanon.get(k);
      if (hit) return { previous: hit };
    }
  }
  return { previous: null };
}
