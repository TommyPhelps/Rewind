// How outside metadata becomes REWIND's own vocabulary. Only well-understood labels are
// mapped; everything else stays visible on the game page but isn't used for scoring.
// Mapped tags are stored with their source ("steam_tags" / "igdb") so explanations can
// say where they came from, and the recommender counts them less than your own tags.

import type { Game, Multiplayer } from "../lib/types.ts";
import type { MetaData } from "./types.ts";

/** Steam user tag (lower-case) → REWIND tags. */
export const STEAM_TAG_MAP: Record<string, string[]> = {
  rpg: ["rpg"],
  "action rpg": ["rpg", "action"],
  jrpg: ["rpg"],
  crpg: ["rpg"],
  "party-based rpg": ["rpg"],
  "tactical rpg": ["tactics", "rpg"],
  "story rich": ["story"],
  "choices matter": ["story"],
  "visual novel": ["narrative", "dialogue"],
  "interactive fiction": ["narrative"],
  "text-based": ["dialogue"],
  "open world": ["openworld"],
  sandbox: ["sandbox"],
  survival: ["survival"],
  "open world survival craft": ["survival", "crafting", "openworld"],
  crafting: ["crafting"],
  "base building": ["building"],
  building: ["building"],
  "city builder": ["citybuilder"],
  "colony sim": ["management", "sim"],
  automation: ["building"],
  "souls-like": ["souls"],
  difficult: ["punishing"],
  action: ["action"],
  fps: ["fps"],
  shooter: ["shooter"],
  "third-person shooter": ["shooter"],
  "looter shooter": ["shooter", "grind"],
  horror: ["horror"],
  "survival horror": ["survivalhorror"],
  "psychological horror": ["horror"],
  atmospheric: ["atmospheric"],
  relaxing: ["relaxing"],
  cozy: ["cozy"],
  wholesome: ["cozy"],
  puzzle: ["puzzle"],
  platformer: ["platformer"],
  "2d platformer": ["platformer"],
  "3d platformer": ["platformer"],
  "precision platformer": ["platformer", "punishing"],
  metroidvania: ["metroidvania"],
  roguelike: ["roguelike"],
  roguelite: ["roguelike"],
  "action roguelike": ["roguelike", "action"],
  stealth: ["stealth"],
  strategy: ["strategy"],
  "grand strategy": ["strategy"],
  "4x": ["4x"],
  rts: ["rts"],
  "turn-based": ["turnbased"],
  "turn-based strategy": ["turnbased", "strategy"],
  "turn-based tactics": ["tactics", "turnbased"],
  "turn-based combat": ["turnbased"],
  tactical: ["tactics"],
  simulation: ["sim"],
  management: ["management"],
  "farming sim": ["farming"],
  driving: ["driving"],
  racing: ["racing"],
  comedy: ["comedy"],
  funny: ["comedy"],
  "card game": ["cards"],
  deckbuilding: ["cards"],
  "card battler": ["cards"],
  arcade: ["arcade"],
  exploration: ["exploration"],
  "walking simulator": ["walking"],
  mystery: ["mystery"],
  detective: ["detective"],
  adventure: ["adventure"],
  sports: ["sports"],
  "hack and slash": ["hack"],
  mmorpg: ["mmo"],
  "massively multiplayer": ["mmo"],
  pvp: ["pvp"],
  "online co-op": ["coop"],
  "co-op": ["coop"],
  "party game": ["party"],
  programming: ["programming"],
  retro: ["retro"],
  "old school": ["retro"],
  fantasy: ["fantasy"],
  "dark fantasy": ["fantasy"],
  "sci-fi": ["scifi"],
  space: ["space"],
  "post-apocalyptic": ["postapoc"],
  crime: ["crime"],
  western: ["western"],
  mechs: ["mech"],
  "dialogue heavy"/* not a real Steam tag; kept for IGDB-style keywords */: ["dialogue"],
};

/** IGDB genres / themes / perspectives → REWIND tags. */
export const IGDB_MAP: Record<string, string[]> = {
  "role-playing (rpg)": ["rpg"],
  shooter: ["shooter"],
  platform: ["platformer"],
  puzzle: ["puzzle"],
  racing: ["racing"],
  "real time strategy (rts)": ["rts", "strategy"],
  "turn-based strategy (tbs)": ["turnbased", "strategy"],
  tactical: ["tactics"],
  strategy: ["strategy"],
  simulator: ["sim"],
  adventure: ["adventure"],
  "hack and slash/beat 'em up": ["hack"],
  "card & board game": ["cards"],
  arcade: ["arcade"],
  "visual novel": ["narrative", "dialogue"],
  "point-and-click": ["adventure"],
  sport: ["sports"],
  action: ["action"],
  fantasy: ["fantasy"],
  "science fiction": ["scifi"],
  horror: ["horror"],
  survival: ["survival"],
  stealth: ["stealth"],
  sandbox: ["sandbox"],
  "open world": ["openworld"],
  mystery: ["mystery"],
  comedy: ["comedy"],
  "4x (explore, expand, exploit, and exterminate)": ["4x"],
  "first person": [],
};

/** Generic labels that say little about what a game is like; never mapped. */
const IGNORE = new Set(["indie", "casual", "singleplayer", "multiplayer", "early access", "free to play", "great soundtrack", "2d", "3d", "pixel graphics", "classic", "masterpiece", "beautiful", "colorful", "cute", "anime", "female protagonist"]);

/**
 * REWIND tags implied by Steam user tags. Only tags with real vote weight count:
 * at least a quarter of the game's strongest tag, and only the top 12.
 */
export function steamTagsToRewind(meta: MetaData): string[] {
  const tags = [...meta.tags].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 12);
  const top = tags[0]?.weight ?? 0;
  const out = new Set<string>();
  for (const t of tags) {
    const k = t.name.toLowerCase();
    if (IGNORE.has(k)) continue;
    if (top && (t.weight ?? 0) < top * 0.25) continue;
    for (const r of STEAM_TAG_MAP[k] ?? []) out.add(r);
  }
  return [...out];
}

export function igdbToRewind(meta: MetaData): string[] {
  const out = new Set<string>();
  for (const n of [...meta.genres, ...meta.tags.map((t) => t.name)]) for (const r of IGDB_MAP[n.toLowerCase()] ?? []) out.add(r);
  return [...out];
}

/** Player modes from Steam's own categories. Returns null when Steam doesn't say. */
export function steamPlayers(meta: MetaData): Multiplayer | null {
  const ids = new Set(meta.playerCategoryIds ?? []);
  if (!ids.size) return null;
  const solo = ids.has(2);
  const coop = [9, 38, 48, 39].some((i) => ids.has(i));
  const pvp = [49, 36, 47, 37].some((i) => ids.has(i));
  const mmo = ids.has(20);
  const mp = ids.has(1) || coop || pvp || mmo || ids.has(24) || ids.has(27);
  if (solo && mp) return "solo_and_mp";
  if (solo) return "solo";
  if (mmo || pvp) return "mp_required";
  if (coop) return "coop_focused";
  if (mp) return "mp_required";
  return null;
}

/** Sources that are guesses: verified data may replace them. Your own edits ("user") never are. */
export const ESTIMATE_SOURCES = new Set(["reference", "legacy_table", "ai_estimate", "inferred", "rewind_artifact"]);

export function canReplace(g: Game, field: string): boolean {
  const src = g.metaSource[field];
  if (src === "user") return false;
  return src == null || ESTIMATE_SOURCES.has(src) || src === "steam" || src === "igdb";
}
