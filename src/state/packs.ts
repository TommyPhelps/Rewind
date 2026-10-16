// Modpack lookups with a local cache, so Mods & Modpacks keeps working offline (showing
// when each fact was fetched). Searches are kept for a day, pack details for a week.

import type { Repo } from "../db/repo.ts";
import { NetError } from "../meta/http.ts";
import { canon } from "../lib/canon.ts";
import { autoPick } from "../meta/match.ts";
import { LEGACY_MODPACKS } from "../migrate/legacyReference.ts";
import { getPack, searchPacks } from "../mods/modrinth.ts";
import { curseCategories, getCursePack, searchCurse } from "../mods/curseforge.ts";
import { normalizePackPrefs, type PackPrefs } from "../mods/evidence.ts";
import type { PackDetail, PackSearch, PackSummary } from "../mods/packTypes.ts";
import { net } from "./metaSync.ts";

export const CF_SECRET = "curseforge_api_key";
const DAY = 86_400_000;

export interface Fetched<T> {
  value: T;
  fetchedAt: string;
  /** Served from the cache because the service couldn't be reached. */
  offline: boolean;
}

/** Fresh enough cache → use it; else fetch; if the fetch fails for network reasons, fall back to any cached copy. */
async function cached<T>(repo: Repo, key: string, maxAgeDays: number, fetcher: () => Promise<T>, force = false): Promise<Fetched<T>> {
  const entry = await repo.getCacheEntry<T>(key);
  if (entry && !force && Date.now() - Date.parse(entry.fetchedAt) < maxAgeDays * DAY) return { value: entry.value, fetchedAt: entry.fetchedAt, offline: false };
  try {
    const value = await fetcher();
    await repo.setCache(key, value);
    return { value, fetchedAt: new Date().toISOString(), offline: false };
  } catch (e) {
    if (entry && e instanceof NetError && (e.kind === "offline" || e.kind === "timeout" || e.kind === "server" || e.kind === "rate_limited")) {
      return { value: entry.value, fetchedAt: entry.fetchedAt, offline: true };
    }
    throw e;
  }
}

export async function cfKey(repo: Repo): Promise<string | null> {
  return repo.getSecret(CF_SECRET);
}

let cfCats: Map<string, number> | null = null;
async function cfCategoryIds(repo: Repo, key: string | null): Promise<Map<string, number>> {
  if (cfCats) return cfCats;
  const r = await cached(repo, "cf:categories", 30, async () => [...(await curseCategories(net, key))]);
  cfCats = new Map(r.value);
  return cfCats;
}

const searchKey = (source: string, s: PackSearch) => `${source}:search:${JSON.stringify([s.query.trim().toLowerCase(), [...s.categories].sort(), s.loader, s.mcVersion, s.sort, s.offset])}`;

export async function searchModrinth(repo: Repo, s: PackSearch, force = false): Promise<Fetched<{ hits: PackSummary[]; total: number }>> {
  return cached(repo, searchKey("mr", s), 1, () => searchPacks(net, s), force);
}

export async function searchCurseForge(repo: Repo, s: PackSearch, force = false): Promise<Fetched<{ hits: PackSummary[]; total: number }>> {
  const key = await cfKey(repo);
  if (!key) throw new NetError("auth", "Add a CurseForge API key to search CurseForge.");
  const cats = await cfCategoryIds(repo, key).catch(() => new Map<string, number>());
  return cached(repo, searchKey("cf", s), 1, () => searchCurse(net, key, s, cats), force);
}

/**
 * Details for one pack. If the pack has disappeared (removed or made private), any copy
 * REWIND kept is returned marked "unavailable" instead of an error.
 */
export async function packDetail(repo: Repo, key: string, opts: { hint?: PackSummary | null; force?: boolean; fallback?: PackDetail | null } = {}): Promise<Fetched<PackDetail>> {
  const [src, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  try {
    if (src === "mr") return await cached(repo, `mr:pack:${id}`, 7, () => getPack(net, id, { hint: opts.hint }), opts.force);
    if (src === "cf") {
      const k = await cfKey(repo);
      if (!k) {
        const old = opts.fallback ?? (await repo.getCacheEntry<PackDetail>(`cf:pack:${id}`))?.value;
        if (old) return { value: old, fetchedAt: old.fetchedAt, offline: true };
        throw new NetError("auth", "This is a CurseForge pack: add a CurseForge API key to load its details.");
      }
      return await cached(repo, `cf:pack:${id}`, 7, () => getCursePack(net, k, id), opts.force);
    }
    throw new Error("Unknown pack source");
  } catch (e) {
    if (e instanceof NetError && e.kind === "not_found") {
      const old = opts.fallback ?? (await repo.getCacheEntry<PackDetail>(`${src}:pack:${id}`))?.value ?? null;
      if (old) {
        const value: PackDetail = { ...old, unavailable: old.unavailable ?? { since: new Date().toISOString(), reason: `No longer found on ${src === "mr" ? "Modrinth" : "CurseForge"} (removed or made private).` } };
        await repo.setCache(`${src}:pack:${id}`, value);
        return { value, fetchedAt: old.fetchedAt, offline: false };
      }
    }
    throw e;
  }
}

/** Packs in the styles you like, as candidates. Ranked afterwards by fit, never by downloads. */
export async function suggestedPacks(repo: Repo, prefs: PackPrefs, force = false): Promise<Fetched<PackSummary[]>> {
  const wanted = (
    [
      ["quests", prefs.weights.quests],
      ["adventure", Math.max(prefs.weights.exploration, prefs.weights.adventure)],
      ["technology", prefs.weights.tech],
      ["magic", prefs.weights.magic],
      ["lightweight", prefs.weights.lightweight],
    ] as [string, number][]
  )
    .filter(([, w]) => w > 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([c]) => c);
  const out = new Map<string, PackSummary>();
  let fetchedAt = new Date().toISOString();
  let offline = false;
  for (const c of wanted.length ? wanted : ["quests"]) {
    const r = await searchModrinth(repo, { query: "", categories: [c], loader: prefs.loader, mcVersion: prefs.mcVersion, sort: "downloads", offset: 0 }, force);
    if (r.offline) offline = true;
    if (r.fetchedAt < fetchedAt) fetchedAt = r.fetchedAt;
    for (const h of r.value.hits) if (!out.has(h.key)) out.set(h.key, h);
  }
  return { value: [...out.values()], fetchedAt, offline };
}

export interface LegacyMatch {
  id: string;
  name: string;
  tags: string[];
  blurb: string;
  pack: PackSummary | null;
}

/** Your old REWIND modpack list, matched to Modrinth by exact name (nothing is guessed). */
export async function matchLegacy(repo: Repo, force = false, onProgress?: (done: number, total: number) => void): Promise<Fetched<LegacyMatch[]>> {
  return cached(
    repo,
    "legacy_packs_v1",
    14,
    async () => {
      const out: LegacyMatch[] = [];
      for (const [i, m] of LEGACY_MODPACKS.entries()) {
        onProgress?.(i, LEGACY_MODPACKS.length);
        const r = await searchPacks(net, { query: m.name, categories: [], loader: "", mcVersion: "", sort: "relevance", offset: 0 });
        const pick = autoPick(m.name, r.hits.map((h) => ({ ...h, name: h.title.replace(/™|®/g, "") })));
        const pack = pick?.item ?? r.hits.find((h) => canon(h.title) === canon(m.name)) ?? null;
        out.push({ ...m, pack: pack ? { ...pack } : null });
      }
      onProgress?.(LEGACY_MODPACKS.length, LEGACY_MODPACKS.length);
      return out;
    },
    force,
  );
}

export async function loadPackPrefs(repo: Repo): Promise<PackPrefs> {
  return normalizePackPrefs(await repo.getSetting<unknown>("modpack_prefs", {}));
}
export async function savePackPrefs(repo: Repo, p: PackPrefs): Promise<void> {
  await repo.setSetting("modpack_prefs", p);
}

export async function loadCompare(repo: Repo): Promise<string[]> {
  const v = await repo.getSetting<unknown>("compare_packs", []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^(mr|cf):/.test(x)).slice(0, 4) : [];
}
export async function saveCompare(repo: Repo, keys: string[]): Promise<void> {
  await repo.setSetting("compare_packs", keys.slice(0, 4));
}
