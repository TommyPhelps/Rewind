// CurseForge's official API (https://docs.curseforge.com/rest-api/). It needs an API key,
// which CurseForge gives out through its developer console (console.curseforge.com) after
// you accept their terms. REWIND never ships a key: if you don't add your own, CurseForge
// search is simply off and Modrinth is used alone.
//
// What CurseForge's API does NOT give: the list of mods inside a pack. So CurseForge packs
// are judged on their categories, files and description only, and labelled that way.

import { NetError, qs, type Net } from "../meta/http.ts";
import { sortVersions, toPlainText } from "./modrinth.ts";
import type { PackDetail, PackSearch, PackSummary, PackVersion } from "./packTypes.ts";

const API = "https://api.curseforge.com/v1";
export const MINECRAFT_GAME_ID = 432;
export const MODPACK_CLASS_ID = 4471;

const LOADER_ID: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const LOADER_NAME: Record<number, string> = { 1: "forge", 4: "fabric", 5: "quilt", 6: "neoforge" };
const SORT: Record<PackSearch["sort"], number> = { relevance: 2, downloads: 6, follows: 2, updated: 3, newest: 11 };

/** Modrinth-style category ids → CurseForge modpack category names (from /v1/categories?classId=4471). */
export const CF_CATEGORY_FOR: Record<string, string[]> = {
  quests: ["Quests"],
  adventure: ["Adventure and RPG", "Exploration"],
  technology: ["Tech"],
  magic: ["Magic"],
  "kitchen-sink": ["Extra Large"],
  lightweight: ["Small / Light"],
  challenging: ["Hardcore"],
  combat: ["Combat / PvP"],
  multiplayer: ["Multiplayer"],
};

function headers(key: string): [string, string][] {
  return [
    ["x-api-key", key.trim()],
    ["Accept", "application/json"],
  ];
}

const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
const httpsOrNull = (x: unknown): string | null => (typeof x === "string" && /^https:\/\//.test(x) ? x : null);

export function cfToSummary(m: Record<string, any>): PackSummary {
  const idx: any[] = Array.isArray(m.latestFilesIndexes) ? m.latestFilesIndexes : [];
  const files: any[] = Array.isArray(m.latestFiles) ? m.latestFiles : [];
  const loaders = new Set<string>();
  for (const i of idx) if (LOADER_NAME[Number(i?.modLoader)]) loaders.add(LOADER_NAME[Number(i.modLoader)]);
  for (const f of files) for (const v of strs(f?.gameVersions)) if (/^(forge|fabric|neoforge|quilt)$/i.test(v)) loaders.add(v.toLowerCase());
  const mc = sortVersions([...idx.map((i) => String(i?.gameVersion ?? "")), ...files.flatMap((f) => strs(f?.gameVersions))].filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)));
  const id = String(m.id);
  const slug = String(m.slug ?? id);
  return {
    key: `cf:${id}`,
    source: "curseforge",
    id,
    slug,
    title: String(m.name ?? slug),
    author: Array.isArray(m.authors) && m.authors[0]?.name ? String(m.authors[0].name) : "",
    description: String(m.summary ?? ""),
    categories: (Array.isArray(m.categories) ? m.categories : []).map((c: any) => String(c?.name ?? "")).filter(Boolean),
    loaders: [...loaders],
    mcVersions: mc,
    downloads: typeof m.downloadCount === "number" ? Math.round(m.downloadCount) : null,
    follows: null,
    iconUrl: httpsOrNull(m.logo?.thumbnailUrl) ?? httpsOrNull(m.logo?.url),
    imageUrl: httpsOrNull((Array.isArray(m.screenshots) ? m.screenshots : [])[0]?.url),
    created: typeof m.dateCreated === "string" ? m.dateCreated : null,
    updated: typeof m.dateReleased === "string" ? m.dateReleased : typeof m.dateModified === "string" ? m.dateModified : null,
    latestVersionId: m.mainFileId != null ? String(m.mainFileId) : null,
    pageUrl: httpsOrNull(m.links?.websiteUrl) ?? `https://www.curseforge.com/minecraft/modpacks/${encodeURIComponent(slug)}`,
    disclosures: [],
  };
}

export async function searchCurse(net: Net, key: string, s: PackSearch, categoryIds: Map<string, number>, signal?: AbortSignal): Promise<{ hits: PackSummary[]; total: number }> {
  const cat = s.categories.map((c) => CF_CATEGORY_FOR[c]?.[0]).map((n) => (n ? categoryIds.get(n) : undefined)).find((x) => x != null);
  const j = await net.json<{ data?: Record<string, any>[]; pagination?: { totalCount?: number } }>(
    {
      method: "GET",
      url: `${API}/mods/search?${qs({
        gameId: MINECRAFT_GAME_ID,
        classId: MODPACK_CLASS_ID,
        searchFilter: s.query.trim() || undefined,
        sortField: SORT[s.sort],
        sortOrder: "desc",
        gameVersion: s.mcVersion || undefined,
        modLoaderType: s.loader ? LOADER_ID[s.loader] : undefined,
        categoryId: cat,
        index: s.offset,
        pageSize: 20,
      })}`,
      headers: headers(key),
    },
    { signal },
  );
  if (!Array.isArray(j.data)) throw new NetError("bad_response", "CurseForge sent an unexpected search answer.");
  return { hits: j.data.filter((m) => m?.isAvailable !== false).map(cfToSummary), total: Number(j.pagination?.totalCount) || j.data.length };
}

/** CurseForge's modpack category names → ids (this endpoint answers without a key too). */
export async function curseCategories(net: Net, key: string | null, signal?: AbortSignal): Promise<Map<string, number>> {
  const j = await net.json<{ data?: { id: number; name: string }[] }>(
    { method: "GET", url: `${API}/categories?${qs({ gameId: MINECRAFT_GAME_ID, classId: MODPACK_CLASS_ID })}`, headers: key ? headers(key) : [["Accept", "application/json"]] },
    { signal },
  );
  return new Map((j.data ?? []).map((c) => [String(c.name), Number(c.id)]));
}

export async function getCursePack(net: Net, key: string, id: string, opts: { signal?: AbortSignal; now?: Date } = {}): Promise<PackDetail> {
  const now = opts.now ?? new Date();
  const signal = opts.signal;
  const m = await net.json<{ data?: Record<string, any> }>({ method: "GET", url: `${API}/mods/${encodeURIComponent(id)}`, headers: headers(key) }, { signal });
  if (!m.data) throw new NetError("not_found", "CurseForge doesn't have that pack any more.");
  if (Number(m.data.classId) !== MODPACK_CLASS_ID) throw new NetError("not_found", "That CurseForge project isn't a modpack.");
  const desc = await net.json<{ data?: string }>({ method: "GET", url: `${API}/mods/${encodeURIComponent(id)}/description`, headers: headers(key) }, { signal }).catch(() => ({ data: "" }));
  const files = await net
    .json<{ data?: Record<string, any>[] }>({ method: "GET", url: `${API}/mods/${encodeURIComponent(id)}/files?${qs({ pageSize: 50 })}`, headers: headers(key) }, { signal })
    .catch(() => ({ data: [] as Record<string, any>[] }));
  const vs: PackVersion[] = (files.data ?? [])
    .map((f) => ({
      id: String(f.id),
      name: String(f.displayName ?? f.fileName ?? ""),
      number: String(f.displayName ?? ""),
      mcVersions: sortVersions(strs(f.gameVersions).filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v))),
      loaders: strs(f.gameVersions).filter((v) => /^(forge|fabric|neoforge|quilt)$/i.test(v)).map((v) => v.toLowerCase()),
      date: typeof f.fileDate === "string" ? f.fileDate : null,
      type: Number(f.releaseType) === 1 ? "release" : Number(f.releaseType) === 2 ? "beta" : "alpha",
      fileName: typeof f.fileName === "string" ? f.fileName : null,
      fileSize: typeof f.fileLength === "number" ? f.fileLength : null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  const s = cfToSummary(m.data);
  const link = (x: unknown) => httpsOrNull(x) ?? undefined;
  return {
    ...s,
    fetchedAt: now.toISOString(),
    status: m.data.isAvailable === false ? "unavailable" : "available",
    bodyText: toPlainText(String(desc.data ?? "")),
    links: { website: link(m.data.links?.websiteUrl), wiki: link(m.data.links?.wikiUrl), issues: link(m.data.links?.issuesUrl), source: link(m.data.links?.sourceUrl) },
    gallery: (Array.isArray(m.data.screenshots) ? m.data.screenshots : []).map((x: any) => httpsOrNull(x?.url)).filter((x: string | null): x is string => !!x).slice(0, 8),
    // CurseForge only returns the latest 50 files here, so the count is "at least".
    versionCount: vs.length || null,
    releasesLastYear: vs.length ? vs.filter((v) => (v.date ?? "") >= yearAgo).length : null,
    latest: vs[0] ?? null,
    mods: null,
    modsNote: "CurseForge's API doesn't list the mods inside a pack, so REWIND can't check what's in it. Facts below come from the pack's categories and description.",
  };
}
