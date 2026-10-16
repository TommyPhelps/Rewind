import { cleanTitle, searchKey } from "./canon.ts";
import type { Game, LengthKind, Ownership, Status } from "./types.ts";
import { lastPlayedAny, playtimeMin, progressState } from "../rec/progress.ts";

const UNVERIFIED = new Set(["legacy_table", "ai_estimate"]);
const PRIORITY = (source: string) => (source === "user" ? 0 : UNVERIFIED.has(source) ? (source === "legacy_table" ? 2 : 3) : 1);

export interface EffectiveLength {
  hours: number;
  source: string;
  verified: boolean;
}

/** Your own value wins, then verified sources, then old unverified estimates (if allowed). */
export function effectiveLength(g: Game, kind: LengthKind, allowUnverified: boolean): EffectiveLength | null {
  const cands = g.lengths
    .filter((l) => l.kind === kind && (allowUnverified || !UNVERIFIED.has(l.source)))
    .sort((a, b) => PRIORITY(a.source) - PRIORITY(b.source));
  const best = cands[0];
  return best ? { hours: best.hours, source: best.source, verified: !UNVERIFIED.has(best.source) } : null;
}

/** The single length shown in lists: main + extras, falling back to main story. */
export function displayLength(g: Game, allowUnverified: boolean): (EffectiveLength & { kind: LengthKind }) | null {
  const me = effectiveLength(g, "main_extras", allowUnverified);
  if (me) return { ...me, kind: "main_extras" };
  const m = effectiveLength(g, "main", allowUnverified);
  return m ? { ...m, kind: "main" } : null;
}

export type LengthBucket = "short" | "medium" | "long" | "endless" | "unknown";

export function lengthBucket(g: Game, allowUnverified: boolean): LengthBucket {
  if (g.endless) return "endless";
  const l = displayLength(g, allowUnverified);
  if (!l) return "unknown";
  if (l.hours < 12) return "short";
  if (l.hours < 35) return "medium";
  return "long";
}

export const LENGTH_FILTERS: { id: LengthBucket | "all"; label: string }[] = [
  { id: "all", label: "Any length" },
  { id: "short", label: "Under 12h" },
  { id: "medium", label: "12-35h" },
  { id: "long", label: "35h+" },
  { id: "endless", label: "Endless" },
  { id: "unknown", label: "Unknown" },
];

export interface LibraryFilters {
  query: string;
  status: Status | "all" | "open";
  ownership: Ownership | "all";
  length: LengthBucket | "all";
  tag: string;
  favorite: boolean;
  collectionId: string;
  hideMultiplayer: boolean;
  progress: "any" | "not_started" | "started" | "finished";
  needsInfo: boolean;
  /** Artwork / outside metadata state. */
  meta: MetaFilter;
}

export type MetaFilter = "any" | "has_cover" | "no_cover" | "linked" | "review" | "not_found" | "not_linked";

export const META_FILTERS: { id: MetaFilter; label: string }[] = [
  { id: "any", label: "Any artwork / match" },
  { id: "has_cover", label: "Has a cover" },
  { id: "no_cover", label: "No cover yet" },
  { id: "linked", label: "Linked to Steam" },
  { id: "not_linked", label: "Not linked to Steam" },
  { id: "review", label: "Match needs review" },
  { id: "not_found", label: "Not found on Steam" },
];

export function metaFilterMatch(g: Game, f: MetaFilter): boolean {
  switch (f) {
    case "any":
      return true;
    case "has_cover":
      return Boolean(g.coverPath);
    case "no_cover":
      return !g.coverPath;
    case "linked":
      return g.steamAppId != null;
    case "not_linked":
      return g.steamAppId == null;
    case "review":
      return g.meta.steam?.status === "review" || g.meta.igdb?.status === "review";
    case "not_found":
      return g.steamAppId == null && g.meta.steam?.status === "none";
  }
}

export const PROGRESS_FILTERS: { id: LibraryFilters["progress"]; label: string }[] = [
  { id: "any", label: "Any progress" },
  { id: "not_started", label: "Not started" },
  { id: "started", label: "Started, not finished" },
  { id: "finished", label: "Finished / played through" },
];

export const DEFAULT_FILTERS: LibraryFilters = {
  query: "",
  status: "all",
  ownership: "all",
  length: "all",
  tag: "",
  favorite: false,
  collectionId: "",
  hideMultiplayer: false,
  progress: "any",
  needsInfo: false,
  meta: "any",
};

const OPEN: Status[] = ["backlog", "playing", "paused", "replay"];

export function filterGames(
  games: Game[],
  f: LibraryFilters,
  allowUnverified: boolean,
  collectionMembers?: Set<string>,
): Game[] {
  const terms = searchKey(f.query).split(" ").filter(Boolean);
  return games.filter((g) => {
    if (f.status === "open" ? !OPEN.includes(g.status) : f.status !== "all" && g.status !== f.status) return false;
    if (f.ownership !== "all" && g.ownership !== f.ownership) return false;
    if (f.favorite && !g.favorite) return false;
    if (f.hideMultiplayer && (g.multiplayer === "mp_required" || g.multiplayer === "coop_focused")) return false;
    if (f.tag && !g.tags.some((t) => t.tag === f.tag)) return false;
    if (collectionMembers && !collectionMembers.has(g.id)) return false;
    if (f.length !== "all" && lengthBucket(g, allowUnverified) !== f.length) return false;
    if (f.needsInfo && g.tags.length > 0 && displayLength(g, allowUnverified)) return false;
    if (f.progress !== "any") {
      const st = progressState(g, allowUnverified);
      const bucket = st === "not_started" ? "not_started" : st === "finished" || st === "likely_finished" ? "finished" : st === "dropped" ? "dropped" : "started";
      if (bucket !== f.progress) return false;
    }
    if (f.meta !== "any" && !metaFilterMatch(g, f.meta)) return false;
    if (terms.length) {
      const people = [g.developer, g.publisher, ...companies(g)].filter(Boolean).join(" ");
      const hay = searchKey(g.title) + " " + g.tags.map((t) => t.tag).join(" ") + " " + searchKey(g.notes) + " " + searchKey(people);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

/** Developers and publishers from linked metadata (Steam first). */
export function companies(g: Game): string[] {
  const d = g.meta.steam?.data ?? g.meta.igdb?.data;
  return d ? [...new Set([...d.developers, ...d.publishers])] : [];
}

/** Release year: your own value, else Steam's, else IGDB's. */
export function releaseYear(g: Game): number | null {
  return g.releaseYear ?? g.meta.steam?.data?.releaseYear ?? g.meta.igdb?.data?.releaseYear ?? null;
}

export type SortKey = "title" | "status" | "length" | "playtime" | "rating" | "updated" | "added" | "lastPlayed" | "fit" | "released";

export const SORTS: { id: SortKey; label: string; dir: 1 | -1 }[] = [
  { id: "title", label: "Title", dir: 1 },
  { id: "fit", label: "Pick-for-me fit", dir: -1 },
  { id: "status", label: "Status", dir: 1 },
  { id: "lastPlayed", label: "Last played", dir: -1 },
  { id: "released", label: "Release year", dir: -1 },
  { id: "playtime", label: "Time played", dir: -1 },
  { id: "length", label: "Length", dir: -1 },
  { id: "rating", label: "Your rating", dir: -1 },
  { id: "added", label: "Recently added", dir: -1 },
  { id: "updated", label: "Recently changed", dir: -1 },
];

const STATUS_ORDER: Record<Status, number> = {
  playing: 0,
  paused: 1,
  replay: 2,
  backlog: 3,
  completed: 4,
  dropped: 5,
  not_interested: 6,
};

export function sortTitle(t: string): string {
  return cleanTitle(t).toLowerCase().replace(/^the\s+/, "");
}

export function sortGames(games: Game[], key: SortKey, dir: 1 | -1, allowUnverified: boolean, fit?: Map<string, number>): Game[] {
  const val = (g: Game): number | string | null => {
    switch (key) {
      case "title":
        return sortTitle(g.title);
      case "status":
        return STATUS_ORDER[g.status];
      case "length":
        return g.endless ? 9999 : displayLength(g, allowUnverified)?.hours ?? null;
      case "playtime":
        return playtimeMin(g);
      case "rating":
        return g.rating;
      case "updated":
        return g.updatedAt;
      case "added":
        return g.createdAt;
      case "lastPlayed":
        return lastPlayedAny(g);
      case "fit":
        return fit?.get(g.id) ?? null;
      case "released":
        return releaseYear(g);
    }
  };
  const decorated = games.map((g) => ({ g, v: val(g), t: sortTitle(g.title) }));
  decorated.sort((a, b) => {
    // Unknown values always sort last, whichever direction.
    if (a.v == null && b.v != null) return 1;
    if (b.v == null && a.v != null) return -1;
    if (a.v != null && b.v != null && a.v !== b.v) {
      const c = typeof a.v === "string" ? a.v.localeCompare(String(b.v)) : (a.v as number) - (b.v as number);
      return c * dir;
    }
    return a.t.localeCompare(b.t);
  });
  return decorated.map((d) => d.g);
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null) return "—";
  if (h < 10 && h % 1) return h.toFixed(1) + "h";
  return Math.round(h) + "h";
}

export function fmtPlaytime(min: number | null): string {
  if (min == null) return "—";
  const h = min / 60;
  return h < 1 ? `${min}m` : fmtHours(h);
}

export function allTags(games: Game[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const g of games) for (const t of g.tags) m.set(t.tag, (m.get(t.tag) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
