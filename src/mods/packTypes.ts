// Minecraft modpacks as REWIND shows them. Every fact keeps its source:
//   verified  — straight from Modrinth / CurseForge (numbers, dates, versions, the mod list)
//   author    — what the pack's author says (their chosen categories and description)
//   inferred  — REWIND's own reading of the above, always labelled as such

export type PackSource = "modrinth" | "curseforge";
export const PACK_SOURCE_LABEL: Record<PackSource, string> = { modrinth: "Modrinth", curseforge: "CurseForge" };

export type Evidence = "verified" | "author" | "inferred";
export const EVIDENCE_LABEL: Record<Evidence, string> = {
  verified: "verified",
  author: "the author says",
  inferred: "REWIND's estimate",
};

export interface PackSummary {
  key: string; // "mr:<id>" | "cf:<id>"
  source: PackSource;
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  /** Categories the author picked (loaders removed). */
  categories: string[];
  loaders: string[];
  mcVersions: string[];
  downloads: number | null;
  follows: number | null;
  iconUrl: string | null;
  imageUrl: string | null;
  created: string | null;
  updated: string | null;
  latestVersionId: string | null;
  pageUrl: string;
  /** Things the pack itself discloses on Modrinth (ads, telemetry, paid features, AI content…). */
  disclosures: string[];
}

export interface PackMod {
  id: string;
  slug: string;
  title: string;
  /** The mod's own Modrinth categories (technology, magic, worldgen…). */
  categories: string[];
}

export interface PackVersion {
  id: string;
  name: string;
  number: string;
  mcVersions: string[];
  loaders: string[];
  date: string | null;
  type: string;
  fileName: string | null;
  fileSize: number | null;
}

export interface PackDetail extends PackSummary {
  fetchedAt: string;
  status: string | null;
  /** The author's description as plain text (never rendered as HTML). */
  bodyText: string;
  links: { issues?: string; source?: string; wiki?: string; discord?: string; website?: string };
  gallery: string[];
  versionCount: number | null;
  releasesLastYear: number | null;
  latest: PackVersion | null;
  /** Mods hosted on Modrinth that the latest version lists. null = not available from this source. */
  mods: PackMod[] | null;
  modsNote: string;
  /** Set when the pack can no longer be found (removed, made private) — kept data is shown with this note. */
  unavailable?: { since: string; reason: string };
}

export interface PackSearch {
  query: string;
  categories: string[];
  loader: string;
  mcVersion: string;
  sort: "relevance" | "downloads" | "follows" | "updated" | "newest";
  offset: number;
}

export const DEFAULT_PACK_SEARCH: PackSearch = { query: "", categories: [], loader: "", mcVersion: "", sort: "relevance", offset: 0 };

export const LOADERS = ["fabric", "forge", "neoforge", "quilt"];
const LOADER_SET = new Set([...LOADERS, "liteloader", "rift", "modloader", "babric", "bta-babric", "java-agent", "legacy-fabric", "ornithe", "nilloader", "datapack", "minecraft"]);
export const isLoader = (c: string) => LOADER_SET.has(c.toLowerCase());

/** Modrinth's modpack categories (from /v2/tag/category, checked 2026-10). */
export const MODRINTH_PACK_CATEGORIES: { id: string; label: string }[] = [
  { id: "quests", label: "Quests" },
  { id: "adventure", label: "Adventure" },
  { id: "technology", label: "Technology" },
  { id: "magic", label: "Magic" },
  { id: "kitchen-sink", label: "Kitchen sink" },
  { id: "lightweight", label: "Lightweight" },
  { id: "optimization", label: "Optimization" },
  { id: "challenging", label: "Challenging" },
  { id: "combat", label: "Combat" },
  { id: "multiplayer", label: "Multiplayer" },
];
