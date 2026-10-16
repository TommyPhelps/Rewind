// The metadata sync runs in the background, independent of which screen is open.
// One controller for the whole app: one run at a time, cancellable, progress observable.

import { useSyncExternalStore } from "react";
import type { Repo } from "../db/repo.ts";
import { Net, realClock, type Clock } from "../meta/http.ts";
import { MetaSync, type SyncOptions, type SyncProgress, type SyncResult } from "../meta/sync.ts";
import { artMissing, createTransport, inDesktopApp } from "../platform/native.ts";

// Browser preview only (fake services): waits are shortened so a test run takes seconds.
const devClock: Clock = { now: () => Date.now(), sleep: (ms, signal) => realClock.sleep(Math.min(ms, 40), signal) };

/** Shared by every lookup, so the per-host pacing applies across the whole app. */
export const net = new Net(createTransport(), inDesktopApp() ? realClock : devClock);

export interface SyncState {
  running: boolean;
  progress: SyncProgress | null;
  last: SyncResult | null;
  scope: "library" | "games" | null;
}

let state: SyncState = { running: false, progress: null, last: null, scope: null };
let ctrl: AbortController | null = null;
const listeners = new Set<() => void>();
const emit = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export async function loadLastSync(repo: Repo): Promise<void> {
  if (state.last) return;
  const last = await repo.getSetting<SyncResult | null>("meta_last_sync", null);
  if (last && !state.last) emit({ last });
}

/**
 * Starts a sync unless one is running. `onChange` is called when a phase finishes
 * (so covers appear as they arrive) and at the end.
 */
export async function startSync(repo: Repo, opts: SyncOptions, onChange: () => Promise<void> | void): Promise<SyncResult | null> {
  if (state.running) return null;
  ctrl = new AbortController();
  emit({ running: true, progress: null, scope: opts.gameIds ? "games" : "library" });
  let lastPhase = "";
  let lastEmit = 0;
  const sync = new MetaSync(
    repo,
    net,
    opts,
    (p) => {
      if (p.phase !== lastPhase) {
        if (lastPhase && lastPhase !== "prepare") void onChange();
        lastPhase = p.phase;
      }
      const now = Date.now();
      if (now - lastEmit > 120 || p.done === p.total) {
        lastEmit = now;
        emit({ progress: p });
      }
    },
    ctrl.signal,
    { missing: artMissing },
  );
  try {
    const result = await sync.run();
    if (!opts.gameIds) await repo.setSetting("meta_last_sync", result).catch(() => undefined);
    emit({ running: false, progress: null, last: opts.gameIds ? state.last : result, scope: null });
    await onChange();
    return result;
  } catch (e) {
    const result: SyncResult = { outcome: "error", message: e instanceof Error ? e.message : String(e), counts: { linked: 0, review: 0, noMatch: 0, fetched: 0, igdbLinked: 0, covers: 0, failed: 0 }, touched: [], finishedAt: new Date().toISOString() };
    emit({ running: false, progress: null, last: result, scope: null });
    await onChange();
    return result;
  } finally {
    ctrl = null;
  }
}

export function cancelSync(): void {
  ctrl?.abort();
}

/** API keys live in the local `secrets` table (never in backups). */
export async function igdbCreds(repo: Repo): Promise<{ clientId: string; clientSecret: string } | null> {
  const [clientId, clientSecret] = await Promise.all([repo.getSecret("igdb_client_id"), repo.getSecret("igdb_client_secret")]);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const PHASE_LABEL: Record<string, string> = {
  prepare: "Getting ready",
  link: "Finding games on Steam",
  steam: "Reading Steam store details",
  igdb: "Checking IGDB",
  art: "Downloading covers",
  apply: "Updating your library",
  done: "Finishing",
};
