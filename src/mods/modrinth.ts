// Modrinth's public API (https://docs.modrinth.com/api/). No key needed; Modrinth asks
// for an identifying User-Agent (set by the desktop app) and allows 300 requests a
// minute, which REWIND stays well under (one request every 250 ms at most).

import { NetError, qs, type Net } from "../meta/http.ts";
import { isLoader, type PackDetail, type PackMod, type PackSearch, type PackSummary, type PackVersion } from "./packTypes.ts";

const API = "https://api.modrinth.com/v2";
const SITE = "https://modrinth.com";

const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
const numOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const httpsOrNull = (x: unknown): string | null => (typeof x === "string" && /^https:\/\//.test(x) ? x : null);

export function hitToSummary(h: Record<string, any>): PackSummary {
  const cats = strs(h.categories);
  const id = String(h.project_id ?? h.id ?? "");
  const slug = String(h.slug ?? id);
  return {
    key: `mr:${id}`,
    source: "modrinth",
    id,
    slug,
    title: String(h.title ?? slug),
    author: String(h.author ?? ""),
    description: String(h.description ?? ""),
    categories: cats.filter((c) => !isLoader(c)),
    loaders: cats.filter((c) => isLoader(c)),
    mcVersions: sortVersions(strs(h.versions ?? h.game_versions)),
    downloads: numOrNull(h.downloads),
    follows: numOrNull(h.follows ?? h.followers),
    iconUrl: httpsOrNull(h.icon_url),
    imageUrl: httpsOrNull(h.featured_gallery) ?? httpsOrNull(strs(h.gallery)[0]),
    created: typeof h.date_created === "string" ? h.date_created : null,
    updated: typeof h.date_modified === "string" ? h.date_modified : null,
    latestVersionId: typeof h.latest_version === "string" ? h.latest_version : null,
    pageUrl: `${SITE}/modpack/${encodeURIComponent(slug)}`,
    disclosures: strs(h.disclosure_types),
  };
}

/** "1.21.1" > "1.20.4" > "1.7.10"; snapshot-style names sort last. */
export function sortVersions(vs: string[]): string[] {
  const key = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split(".").map((n) => n.padStart(4, "0")).join(".") : "0000." + v);
  return [...new Set(vs)].sort((a, b) => key(b).localeCompare(key(a)));
}

export async function searchPacks(net: Net, s: PackSearch, signal?: AbortSignal): Promise<{ hits: PackSummary[]; total: number }> {
  const facets: string[][] = [["project_type:modpack"]];
  for (const c of s.categories) facets.push([`categories:${c}`]);
  if (s.loader) facets.push([`categories:${s.loader}`]);
  if (s.mcVersion) facets.push([`versions:${s.mcVersion}`]);
  const index = s.sort === "updated" ? "updated" : s.sort;
  const j = await net.json<{ hits?: Record<string, any>[]; total_hits?: number }>(
    { method: "GET", url: `${API}/search?${qs({ query: s.query.trim() || undefined, facets: JSON.stringify(facets), index, offset: s.offset, limit: 20 })}` },
    { signal },
  );
  if (!Array.isArray(j.hits)) throw new NetError("bad_response", "Modrinth sent an unexpected search answer.");
  return { hits: j.hits.map(hitToSummary), total: Number(j.total_hits) || 0 };
}

/** Plain text from a pack description (HTML or Markdown). Nothing from it is ever rendered as HTML. */
export function toPlainText(body: string, max = 4000): string {
  return body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`~]{1,3}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, max);
}

function parseVersion(v: Record<string, any>): PackVersion {
  const files: any[] = Array.isArray(v.files) ? v.files : [];
  const primary = files.find((f) => f?.primary) ?? files[0];
  return {
    id: String(v.id),
    name: String(v.name ?? v.version_number ?? ""),
    number: String(v.version_number ?? ""),
    mcVersions: sortVersions(strs(v.game_versions)),
    loaders: strs(v.loaders),
    date: typeof v.date_published === "string" ? v.date_published : null,
    type: String(v.version_type ?? "release"),
    fileName: primary?.filename ? String(primary.filename) : null,
    fileSize: numOrNull(primary?.size),
  };
}

/**
 * Full details: the project, its versions (for maintenance), and the Modrinth-hosted mods
 * its newest version lists. Throws NetError("not_found") if the pack is gone.
 */
export async function getPack(net: Net, idOrSlug: string, opts: { signal?: AbortSignal; now?: Date; hint?: PackSummary | null } = {}): Promise<PackDetail> {
  const { signal, hint } = opts;
  const now = opts.now ?? new Date();
  const p = await net.json<Record<string, any>>({ method: "GET", url: `${API}/project/${encodeURIComponent(idOrSlug)}` }, { signal });
  if (p.project_type && p.project_type !== "modpack") throw new NetError("not_found", "That Modrinth project isn't a modpack.");
  const versions = await net.json<Record<string, any>[]>({ method: "GET", url: `${API}/project/${encodeURIComponent(String(p.id))}/version?include_changelog=false` }, { signal });
  const vs = (Array.isArray(versions) ? versions : []).map(parseVersion).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const latestRaw = (Array.isArray(versions) ? versions : []).find((v) => String(v.id) === vs[0]?.id);
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  // Mods inside the pack: Modrinth lists the ones it hosts as "embedded" dependencies of the version.
  let mods: PackMod[] | null = null;
  let modsNote = "";
  const depIds = [...new Set((Array.isArray(latestRaw?.dependencies) ? latestRaw.dependencies : []).map((d: any) => d?.project_id).filter((x: unknown): x is string => typeof x === "string"))];
  if (latestRaw) {
    mods = [];
    for (let i = 0; i < depIds.length; i += 100) {
      const part = depIds.slice(i, i + 100);
      const rows = await net.json<Record<string, any>[]>({ method: "GET", url: `${API}/projects?${qs({ ids: JSON.stringify(part) })}` }, { signal });
      for (const r of Array.isArray(rows) ? rows : []) mods.push({ id: String(r.id), slug: String(r.slug ?? ""), title: String(r.title ?? r.slug ?? ""), categories: strs(r.categories) });
    }
    mods.sort((a, b) => a.title.localeCompare(b.title));
    modsNote = depIds.length
      ? `${mods.length} mods listed on Modrinth for version ${vs[0]?.number ?? "?"}. Packs can also include mods from other sites, so the real total may be higher.`
      : "This version doesn't list its mods on Modrinth, so REWIND can't check what's inside.";
  }
  const summary = hitToSummary({
    ...p,
    project_id: p.id,
    author: "",
    versions: p.game_versions,
    follows: p.followers,
    date_created: p.published,
    date_modified: p.updated,
    featured_gallery: (Array.isArray(p.gallery) ? p.gallery : []).find((g: any) => g?.featured)?.url ?? (Array.isArray(p.gallery) ? p.gallery[0]?.url : null),
    latest_version: vs[0]?.id ?? null,
    categories: [...strs(p.categories), ...strs(p.additional_categories), ...strs(p.loaders)],
  });
  const link = (x: unknown) => httpsOrNull(x) ?? undefined;
  // The project endpoint has no author name or disclosures; the search result does.
  if (hint && hint.id === summary.id) {
    summary.author = hint.author;
    if (!summary.disclosures.length) summary.disclosures = hint.disclosures;
  }
  return {
    ...summary,
    fetchedAt: now.toISOString(),
    status: typeof p.status === "string" ? p.status : null,
    bodyText: toPlainText(String(p.body ?? "")),
    links: { issues: link(p.issues_url), source: link(p.source_url), wiki: link(p.wiki_url), discord: link(p.discord_url) },
    gallery: (Array.isArray(p.gallery) ? p.gallery : []).map((g: any) => httpsOrNull(g?.url)).filter((x: string | null): x is string => !!x).slice(0, 8),
    versionCount: vs.length,
    releasesLastYear: vs.filter((v) => (v.date ?? "") >= yearAgo).length,
    latest: vs[0] ?? null,
    mods,
    modsNote,
  };
}
