export type Status =
  | "backlog"
  | "playing"
  | "paused"
  | "completed"
  | "dropped"
  | "replay"
  | "not_interested";

export const STATUSES: { id: Status; label: string; short: string }[] = [
  { id: "backlog", label: "Backlog", short: "BKLG" },
  { id: "playing", label: "Playing", short: "PLAY" },
  { id: "paused", label: "Paused", short: "PAUS" },
  { id: "completed", label: "Completed", short: "DONE" },
  { id: "dropped", label: "Dropped", short: "DROP" },
  { id: "replay", label: "Replay candidate", short: "RPLY" },
  { id: "not_interested", label: "Not interested", short: "SKIP" },
];

export type Ownership = "owned" | "wishlist" | "not_owned" | "unknown";
export const OWNERSHIP: { id: Ownership; label: string }[] = [
  { id: "owned", label: "Owned" },
  { id: "wishlist", label: "Wishlist" },
  { id: "not_owned", label: "Not owned" },
  { id: "unknown", label: "Unknown" },
];

export type Install = "installed" | "not_installed" | "unknown";
export const INSTALL: { id: Install; label: string }[] = [
  { id: "installed", label: "Installed" },
  { id: "not_installed", label: "Not installed" },
  { id: "unknown", label: "Unknown" },
];

export type Multiplayer = "solo" | "solo_and_mp" | "coop_focused" | "mp_required" | "unknown";
export const MULTIPLAYER: { id: Multiplayer; label: string }[] = [
  { id: "solo", label: "Single-player" },
  { id: "solo_and_mp", label: "Single-player + online" },
  { id: "coop_focused", label: "Co-op focused" },
  { id: "mp_required", label: "Multiplayer required" },
  { id: "unknown", label: "Unknown" },
];

export type RecPref = "normal" | "boost" | "never";
export const REC_PREFS: { id: RecPref; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "boost", label: "Suggest more often" },
  { id: "never", label: "Never suggest" },
];

export type Scale = "short" | "medium" | "long" | "endless";
export const SCALES: { id: Scale; label: string; hint: string }[] = [
  { id: "short", label: "Short", hint: "under ~12h" },
  { id: "medium", label: "Medium", hint: "~12–35h" },
  { id: "long", label: "Long", hint: "35h+" },
  { id: "endless", label: "Endless", hint: "no real ending" },
];

export type LengthKind = "main" | "main_extras" | "completionist";
export const LENGTH_KINDS: { id: LengthKind; label: string }[] = [
  { id: "main", label: "Main story" },
  { id: "main_extras", label: "Main + extras" },
  { id: "completionist", label: "Completionist" },
];

/** Where a value came from. Only "user" is personal; everything else is shown with its source. */
export type ValueSource = "user" | "legacy_table" | "ai_estimate" | "rewind_artifact" | "steam" | "import";

export const SOURCE_LABEL: Record<string, string> = {
  user: "You",
  legacy_table: "Old REWIND table (unverified estimate)",
  ai_estimate: "Old REWIND AI lookup (unverified)",
  rewind_artifact: "REWIND artifact import",
  steam: "Steam store (verified)",
  steam_tags: "Steam user tags",
  igdb: "IGDB time to beat (player-submitted)",
  import: "Backup import",
  reference: "REWIND reference (unverified estimate)",
  inferred: "Inferred from tags",
  igdb_modes: "IGDB game modes",
};

export interface GameLength {
  gameId: string;
  kind: LengthKind;
  hours: number;
  source: string;
  updatedAt: string;
}

export interface GameTag {
  tag: string;
  source: string;
}

export interface Game {
  id: string;
  title: string;
  canon: string;
  legacyId: string | null;
  platform: string;
  storefront: string | null;
  steamAppId: number | null;
  coverPath: string | null;
  description: string | null;
  releaseYear: number | null;
  developer: string | null;
  publisher: string | null;
  ownership: Ownership;
  installStatus: Install;
  status: Status;
  rating: number | null; // 1-5
  favorite: boolean;
  notes: string;
  importedPlaytimeMin: number | null;
  playtimeSource: string | null;
  /** Minutes Steam reports (from a Steam library import). Kept apart from the old imported value. */
  steamPlaytimeMin: number | null;
  steamLastPlayed: string | null;
  steamSyncedAt: string | null;
  lastPlayed: string | null;
  dateCompleted: string | null;
  dateDropped: string | null;
  multiplayer: Multiplayer;
  endless: boolean | null;
  scale: Scale | null;
  refVersion: number | null;
  recPref: RecPref;
  metaSource: Record<string, string>;
  legacy: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  tags: GameTag[];
  lengths: GameLength[];
  /** Outside metadata (Steam / IGDB), if any has been looked up. */
  meta: Partial<Record<import("../meta/types.ts").Provider, import("../meta/types.ts").MetaRecord>>;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  gameIds: string[];
}

export interface EventRow {
  id: number;
  ts: string;
  type: string;
  gameId: string | null;
  data: Record<string, unknown>;
}

export type ThemeId = "midnight" | "classic" | "amber" | "gothic" | "mono";
export const THEMES: { id: ThemeId; label: string; note: string }[] = [
  { id: "midnight", label: "Midnight 2003", note: "Dark navy, steel blue, silver" },
  { id: "classic", label: "Nook Classic", note: "Near-black, muted green, charcoal" },
  { id: "amber", label: "CRT Amber", note: "Black, charcoal, amber" },
  { id: "gothic", label: "Gothic Library", note: "Dark brown, burgundy, antique gold" },
  { id: "mono", label: "Monochrome", note: "Black, gray, white" },
];

export interface GamingProfile {
  enjoyed: string[];
  values: string[];
  dislikes: string[];
  struggled: string[];
  excludeMultiplayerDependent: boolean;
}

export type Density = "compact" | "comfortable" | "spacious";
export const DENSITIES: { id: Density; label: string; note: string }[] = [
  { id: "compact", label: "Compact", note: "More rows on screen" },
  { id: "comfortable", label: "Comfortable", note: "Default" },
  { id: "spacious", label: "Spacious", note: "Bigger text and targets" },
];

export interface AppSettings {
  theme: ThemeId;
  density: Density;
  uiScale: number; // 0.9 - 1.5
  sidebarCollapsed: boolean;
  libraryView: "table" | "grid";
  /** Cover size in the grid. */
  gridSize: "s" | "m" | "l";
  /** Small cover thumbnails in table rows. */
  listCovers: boolean;
  detailWidth: number;
  useUnverifiedLengths: boolean;
  lowStimulation: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "midnight",
  density: "comfortable",
  uiScale: 1,
  sidebarCollapsed: false,
  libraryView: "table",
  gridSize: "m",
  listCovers: true,
  detailWidth: 400,
  useUnverifiedLengths: true,
  lowStimulation: false,
};
