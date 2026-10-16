// Records kept by the modding companion. All of it is your own information: REWIND
// never reads or writes game folders or mod-manager files on its own.

export type ProfileStatus = "planning" | "active" | "paused" | "finished" | "retired";
export const PROFILE_STATUSES: { id: ProfileStatus; label: string }[] = [
  { id: "planning", label: "Planning" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "finished", label: "Finished" },
  { id: "retired", label: "Retired" },
];

export type NoteKind = "compat" | "setup" | "issue" | "tip";
export const NOTE_KINDS: { id: NoteKind; label: string }[] = [
  { id: "compat", label: "Compatibility" },
  { id: "setup", label: "Setup step" },
  { id: "issue", label: "Problem / fix" },
  { id: "tip", label: "Tip" },
];

export type RunStatus = "active" | "paused" | "finished" | "abandoned";
export const RUN_STATUSES: { id: RunStatus; label: string }[] = [
  { id: "active", label: "Playing" },
  { id: "paused", label: "Paused" },
  { id: "finished", label: "Finished" },
  { id: "abandoned", label: "Abandoned" },
];

export interface ModEntry {
  id: string;
  profileId: string;
  position: number;
  name: string;
  url: string;
  version: string;
  category: string;
  enabled: boolean;
  notes: string;
  addedAt: string;
}

export interface ModNote {
  id: string;
  profileId: string;
  kind: NoteKind;
  title: string;
  body: string;
  mods: string[];
  sourceUrl: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
}

export interface CheckItem {
  id: string;
  profileId: string;
  position: number;
  text: string;
  doneAt: string | null;
}

export interface ModRun {
  id: string;
  profileId: string;
  name: string;
  startedAt: string | null;
  endedAt: string | null;
  status: RunStatus;
  notes: string;
}

export interface ModProfile {
  id: string;
  name: string;
  /** Which game preset this follows (skyrim_se, minecraft, …, or "other"). */
  gameKey: string;
  /** The game in your library, if linked. */
  gameId: string | null;
  /** Shown when the game isn't linked to your library. */
  gameTitle: string;
  manager: string;
  gameVersion: string;
  status: ProfileStatus;
  /** A saved modpack this profile is based on (e.g. "mr:abc123"). */
  packKey: string | null;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  entries: ModEntry[];
  modNotes: ModNote[];
  checklist: CheckItem[];
  runs: ModRun[];
}

export type ProfilePatch = Partial<Pick<ModProfile, "name" | "gameKey" | "gameId" | "gameTitle" | "manager" | "gameVersion" | "status" | "packKey" | "notes" | "sortOrder">>;
