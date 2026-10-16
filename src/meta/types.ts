// Metadata from outside sources, kept apart from your own data. A game's own fields
// (title, status, rating, notes, your tags and lengths…) are never overwritten by it.

export type Provider = "steam" | "igdb";

export interface Art {
  url: string;
  /** Cached copy, relative to the app data folder ("artwork/…"). Missing = not downloaded yet. */
  file?: string;
  kind: "portrait" | "landscape";
}

export interface MetaData {
  name: string;
  releaseDate?: string; // YYYY-MM-DD
  releaseYear?: number;
  description?: string;
  developers: string[];
  publishers: string[];
  franchises?: string[];
  genres: string[];
  /** Steam user tags (with vote weight) or IGDB themes/keywords. */
  tags: { name: string; weight?: number }[];
  /** Player modes as the provider lists them ("Single-player", "Online co-op", …). */
  features: string[];
  playerCategoryIds?: number[];
  platforms: string[];
  storeUrl?: string;
  website?: string;
  pageUrl?: string;
  comingSoon?: boolean;
  /** Player-submitted completion times in hours (IGDB time to beat). */
  timeToBeat?: { main?: number; extras?: number; complete?: number; count?: number };
  art: { cover?: Art; header?: Art; hero?: Art };
  attribution: string;
}

export interface Candidate {
  id: string;
  name: string;
  year?: number;
  score: number; // 0..1 title match
  thumb?: string | null;
}

export type MetaStatus = "linked" | "review" | "none" | "error";

export interface MetaRecord {
  gameId: string;
  provider: Provider;
  providerId: string | null;
  status: MetaStatus;
  /** How the link was made: steam_import, steam_id, exact_title, search, user. */
  method: string | null;
  confidence: number | null;
  data: MetaData | null;
  candidates: Candidate[];
  rejected: string[];
  error: string | null;
  fetchedAt: string | null;
  updatedAt: string;
}

export const PROVIDER_LABEL: Record<Provider, string> = { steam: "Steam", igdb: "IGDB" };
