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

/** Launchers / stores REWIND knows about. */
export type LauncherId = "steam" | "epic" | "ubisoft" | "rockstar" | "gog" | "other";
export const LAUNCHERS: { id: LauncherId; label: string }[] = [
  { id: "steam", label: "Steam" },
  { id: "epic", label: "Epic Games" },
  { id: "ubisoft", label: "Ubisoft Connect" },
  { id: "rockstar", label: "Rockstar Games" },
  { id: "gog", label: "GOG" },
  { id: "other", label: "Other" },
];
export const LAUNCHER_LABEL: Record<LauncherId, string> = Object.fromEntries(LAUNCHERS.map((l) => [l.id, l.label])) as Record<LauncherId, string>;

/** One place you own or have installed a game. */
export interface GameSource {
  source: LauncherId;
  /** The launcher's own id (Steam app id, Epic app name, Ubisoft install id…). */
  externalId: string;
  /** The name the launcher uses. */
  title: string;
  /** Installed as of the last scan (null = unknown). */
  installed: boolean | null;
  installPath: string | null;
  /** A launcher link REWIND may open to start the game (steam://, com.epicgames.launcher://, uplay://). */
  launch: string | null;
  /** How REWIND learned it: steam_import, local_scan, manual, migrated. */
  method: string;
  /** Minutes the launcher reports, only when it reports them. */
  playtimeMin: number | null;
  lastSeenAt: string | null;
  createdAt: string;
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
  /** Where you own or have installed it (one row per launcher). */
  sources: GameSource[];
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

export interface GamingProfile {
  enjoyed: string[];
  values: string[];
  dislikes: string[];
  struggled: string[];
  excludeMultiplayerDependent: boolean;
}

export type ScanLauncher = "epic" | "ubisoft" | "rockstar";

export interface AppSettings {
  /** Text size on top of Windows display scaling (0.9 – 1.3). */
  uiScale: number;
  sidebarCollapsed: boolean;
  libraryView: "table" | "grid";
  /** Cover size in the grid. */
  gridSize: "s" | "m" | "l";
  /** Small cover thumbnails in table rows. */
  listCovers: boolean;
  detailWidth: number;
  useUnverifiedLengths: boolean;
  /** Launchers you allowed REWIND to look at on this PC (asked once, changeable in Connections). */
  launcherAccess: Partial<Record<ScanLauncher, boolean>>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiScale: 1,
  sidebarCollapsed: false,
  libraryView: "table",
  gridSize: "m",
  listCovers: true,
  detailWidth: 440,
  useUnverifiedLengths: true,
  launcherAccess: {},
};

/** Saved settings from any version: unknown keys (old themes, density) are dropped. */
export function normalizeSettings(raw: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  const s = { ...DEFAULT_SETTINGS };
  if (typeof raw.uiScale === "number" && raw.uiScale >= 0.85 && raw.uiScale <= 1.5) s.uiScale = Math.min(1.3, raw.uiScale);
  if (typeof raw.sidebarCollapsed === "boolean") s.sidebarCollapsed = raw.sidebarCollapsed;
  if (raw.libraryView === "grid" || raw.libraryView === "table") s.libraryView = raw.libraryView;
  if (raw.gridSize === "s" || raw.gridSize === "m" || raw.gridSize === "l") s.gridSize = raw.gridSize;
  if (typeof raw.listCovers === "boolean") s.listCovers = raw.listCovers;
  if (typeof raw.detailWidth === "number") s.detailWidth = Math.max(340, Math.min(760, raw.detailWidth));
  if (typeof raw.useUnverifiedLengths === "boolean") s.useUnverifiedLengths = raw.useUnverifiedLengths;
  if (raw.launcherAccess && typeof raw.launcherAccess === "object") s.launcherAccess = { ...(raw.launcherAccess as AppSettings["launcherAccess"]) };
  return s;
}
