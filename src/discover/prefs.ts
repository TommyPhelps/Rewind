// Your Discover settings. Saved in the database (setting "discover_prefs") and in backups.

export type CategoryId =
  | "similar"
  | "gems"
  | "finish"
  | "era"
  | "rpg"
  | "mastery"
  | "cozy"
  | "short"
  | "different"
  | "respect"
  | "atmosphere";

export const CATEGORY_IDS: CategoryId[] = ["similar", "gems", "finish", "rpg", "era", "short", "mastery", "cozy", "respect", "atmosphere", "different"];

/** How much room games you don't own get. */
export type Scope = "library" | "library_first" | "mixed";
export const SCOPE_LABEL: Record<Scope, string> = {
  library: "Only my library",
  library_first: "My library first",
  mixed: "Mix in games I don't own",
};

/** Platforms considered for "Early-2000s nostalgia" outside your library (IGDB platform ids). */
export const ERA_PLATFORMS: { id: string; label: string; igdb: number }[] = [
  { id: "pc", label: "PC", igdb: 6 },
  { id: "ps2", label: "PlayStation 2", igdb: 8 },
  { id: "ps3", label: "PlayStation 3", igdb: 9 },
  { id: "ps1", label: "PlayStation", igdb: 7 },
  { id: "xbox", label: "Xbox", igdb: 11 },
  { id: "x360", label: "Xbox 360", igdb: 12 },
  { id: "gc", label: "GameCube", igdb: 21 },
  { id: "wii", label: "Wii", igdb: 5 },
];

export interface DiscoverPrefs {
  /** Category order on the overview; categories in `hidden` aren't shown. */
  order: CategoryId[];
  hidden: CategoryId[];
  scope: Scope;
  eraFrom: number;
  eraTo: number;
  eraPlatforms: string[];
  /** "Short" means a main story up to this many hours. */
  shortMaxHours: number;
  /** "Deep RPG" means main + extras of at least this many hours (or a long length class). */
  longMinHours: number;
  /** Show finished games you loved in Early-2000s nostalgia, as replays. */
  includeReplays: boolean;
  /** Base number of days a "Not interested" answer hides something. */
  hideDays: number;
}

export const DEFAULT_DISCOVER_PREFS: DiscoverPrefs = {
  order: CATEGORY_IDS,
  hidden: [],
  scope: "library_first",
  eraFrom: 1998,
  eraTo: 2008,
  eraPlatforms: ["pc", "ps2", "ps3"],
  shortMaxHours: 12,
  longMinHours: 35,
  includeReplays: true,
  hideDays: 90,
};

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** Reads saved prefs defensively (older or hand-edited values fall back to defaults). */
export function normalizePrefs(raw: unknown): DiscoverPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DiscoverPrefs>;
  const d = DEFAULT_DISCOVER_PREFS;
  const known = new Set<string>(CATEGORY_IDS);
  const order = Array.isArray(r.order) ? r.order.filter((x): x is CategoryId => known.has(x)) : [];
  for (const id of CATEGORY_IDS) if (!order.includes(id)) order.push(id);
  const eraFrom = clampInt(r.eraFrom, 1970, 2030, d.eraFrom);
  const eraTo = Math.max(eraFrom, clampInt(r.eraTo, 1970, 2030, d.eraTo));
  const plats = new Set(ERA_PLATFORMS.map((p) => p.id));
  const eraPlatforms = Array.isArray(r.eraPlatforms) ? r.eraPlatforms.filter((x) => plats.has(x)) : d.eraPlatforms;
  return {
    order,
    hidden: Array.isArray(r.hidden) ? r.hidden.filter((x): x is CategoryId => known.has(x)) : [],
    scope: r.scope === "library" || r.scope === "mixed" || r.scope === "library_first" ? r.scope : d.scope,
    eraFrom,
    eraTo,
    eraPlatforms: eraPlatforms.length ? eraPlatforms : d.eraPlatforms,
    shortMaxHours: clampInt(r.shortMaxHours, 2, 30, d.shortMaxHours),
    longMinHours: clampInt(r.longMinHours, 15, 150, d.longMinHours),
    includeReplays: typeof r.includeReplays === "boolean" ? r.includeReplays : d.includeReplays,
    hideDays: clampInt(r.hideDays, 7, 365, d.hideDays),
  };
}
