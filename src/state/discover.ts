// Discover's "beyond your library" lookup runs in the background (like the metadata sync):
// one run at a time, cancellable, and its results are saved so Discover works offline.

import { useSyncExternalStore } from "react";
import type { Repo } from "../db/repo.ts";
import type { Game } from "../lib/types.ts";
import type { TasteModel } from "../rec/taste.ts";
import { igdbToken } from "../meta/sync.ts";
import { BEYOND_CACHE_KEY, describeBeyondError, fetchBeyond, type BeyondCache, type BeyondProgress } from "../discover/beyond.ts";
import { normalizePrefs, type DiscoverPrefs } from "../discover/prefs.ts";
import { igdbCreds, net } from "./metaSync.ts";

export interface BeyondState {
  loaded: boolean;
  running: boolean;
  progress: BeyondProgress | null;
  cache: BeyondCache | null;
  error: string | null;
  hasCreds: boolean | null;
}

let state: BeyondState = { loaded: false, running: false, progress: null, cache: null, error: null, hasCreds: null };
let ctrl: AbortController | null = null;
const listeners = new Set<() => void>();
const emit = (patch: Partial<BeyondState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export function useBeyond(): BeyondState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export async function loadBeyond(repo: Repo): Promise<void> {
  const [entry, creds] = await Promise.all([repo.getCacheEntry<BeyondCache>(BEYOND_CACHE_KEY), igdbCreds(repo)]);
  emit({ loaded: true, cache: entry?.value?.version === 1 ? entry.value : state.cache, hasCreds: !!creds });
}

export async function runBeyond(repo: Repo, games: Game[], taste: TasteModel, prefs: DiscoverPrefs): Promise<void> {
  if (state.running) return;
  const creds = await igdbCreds(repo);
  if (!creds) {
    emit({ hasCreds: false, error: "Add your IGDB (Twitch) Client ID and Secret in Settings → Connections → IGDB first." });
    return;
  }
  ctrl = new AbortController();
  emit({ running: true, error: null, progress: { step: "Connecting to IGDB", done: 0, total: 1 }, hasCreds: true });
  try {
    const cache = await fetchBeyond(
      {
        net,
        creds,
        token: () => igdbToken(repo, net, creds, ctrl?.signal),
        getCache: (k, d) => repo.getCache(k, d),
        setCache: (k, v) => repo.setCache(k, v),
      },
      games,
      taste,
      prefs,
      { signal: ctrl.signal, onProgress: (p) => emit({ progress: p }) },
    );
    await repo.setCache(BEYOND_CACHE_KEY, cache);
    await repo.batch([repo.eventStatement("discover_lookup", null, { games: cache.items.length, seeds: cache.seeds.length })]);
    emit({ cache, running: false, progress: null });
  } catch (e) {
    emit({ running: false, progress: null, error: describeBeyondError(e) });
  } finally {
    ctrl = null;
  }
}

export function cancelBeyond(): void {
  ctrl?.abort();
}

export async function loadDiscoverPrefs(repo: Repo): Promise<DiscoverPrefs> {
  return normalizePrefs(await repo.getSetting<unknown>("discover_prefs", {}));
}

export async function saveDiscoverPrefs(repo: Repo, p: DiscoverPrefs): Promise<void> {
  await repo.setSetting("discover_prefs", p);
}
