// Live check of the endpoints REWIND's Discover and Mods & Modpacks screens use
// (run in CI, not by the app). Prints status codes, rate-limit headers and response shapes.
const UA = "TommyPhelps/Rewind/4.0 (personal desktop app; github.com/TommyPhelps/Rewind)";
const out = [];
const log = (...a) => out.push(a.join(" "));
async function probe(label, url, { show = 1500, headers = {}, method = "GET", body } = {}) {
  try {
    const r = await fetch(url, { method, body, headers: { "User-Agent": UA, ...headers }, redirect: "follow" });
    const ct = r.headers.get("content-type");
    const text = await r.text();
    const rl = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"].map((h) => `${h}=${r.headers.get(h)}`).join(" ");
    log(`\n## ${label}\n${r.status} ${ct ?? ""} ${rl}\nurl=${url}`);
    log(text.slice(0, show));
    return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  } catch (e) {
    log(`\n## ${label}\nERROR ${e.message}`);
    return { status: 0, text: "", json: null };
  }
}
const MR = "https://api.modrinth.com/v2";
const f = (x) => encodeURIComponent(JSON.stringify(x));

const s = await probe("modrinth search modpacks quests", `${MR}/search?limit=5&index=relevance&facets=${f([["project_type:modpack"], ["categories:quests"]])}`, { show: 3000 });
await probe("modrinth search modpacks query create, downloads", `${MR}/search?limit=3&index=downloads&query=create&facets=${f([["project_type:modpack"]])}`, { show: 1500 });
await probe("modrinth categories tags", `${MR}/tag/category`, { show: 200 });
const cats = await fetch(`${MR}/tag/category`, { headers: { "User-Agent": UA } }).then((r) => r.json()).catch(() => []);
log("\n## modrinth modpack categories\n" + JSON.stringify(cats.filter((c) => c.project_type === "modpack").map((c) => [c.name, c.header])));
await probe("modrinth loaders", `${MR}/tag/loader`, { show: 400 });

const hits = s.json?.hits ?? [];
const first = hits[0];
if (first) {
  const p = await probe(`modrinth project ${first.slug}`, `${MR}/project/${first.project_id}`, { show: 3500 });
  const v = await probe(`modrinth versions ${first.slug}`, `${MR}/project/${first.project_id}/version`, { show: 300 });
  const vs = v.json ?? [];
  log(`versions count=${vs.length}`);
  if (vs[0]) {
    const v0 = { ...vs[0] };
    log("first version keys=" + Object.keys(v0).join(","));
    log("first version summary=" + JSON.stringify({ name: v0.name, version_number: v0.version_number, game_versions: v0.game_versions, loaders: v0.loaders, date_published: v0.date_published, version_type: v0.version_type, files: (v0.files ?? []).map((x) => ({ filename: x.filename, size: x.size, primary: x.primary, url: x.url })), deps: (v0.dependencies ?? []).length, depSample: (v0.dependencies ?? []).slice(0, 4) }));
    const ids = [...new Set((v0.dependencies ?? []).map((d) => d.project_id).filter(Boolean))].slice(0, 6);
    if (ids.length) await probe("modrinth projects batch (deps)", `${MR}/projects?ids=${f(ids)}`, { show: 1200 });
    const vids = [...new Set((v0.dependencies ?? []).map((d) => d.version_id).filter(Boolean))].slice(0, 3);
    if (vids.length) await probe("modrinth versions batch (deps)", `${MR}/versions?ids=${f(vids)}`, { show: 800 });
  }
  log("project keys=" + Object.keys(p.json ?? {}).join(","));
}
// A few well-known packs by slug to see deps on mrpack versions.
for (const slug of ["fabulously-optimized", "cobblemon-fabric", "prominence-2-fabric", "better-mc-fabric-bmc1", "create-arcane-engineering", "nonexistent-pack-zz9"]) {
  const r = await probe(`modrinth project by slug ${slug}`, `${MR}/project/${slug}`, { show: 400 });
  if (r.json?.id) {
    const v = await fetch(`${MR}/project/${r.json.id}/version`, { headers: { "User-Agent": UA } }).then((x) => x.json());
    const v0 = v[0];
    log(`  versions=${v.length} latest=${v0?.version_number} mc=${JSON.stringify(v0?.game_versions)} loaders=${JSON.stringify(v0?.loaders)} deps=${v0?.dependencies?.length} depTypes=${JSON.stringify([...new Set((v0?.dependencies ?? []).map((d) => d.dependency_type))])} files=${JSON.stringify((v0?.files ?? []).map((x) => [x.filename, x.size]))}`);
  }
}
await probe("modrinth search typo / empty result", `${MR}/search?limit=3&query=zzqqxxyy-no-such-pack&facets=${f([["project_type:modpack"]])}`, { show: 400 });
await probe("modrinth bad facets (expect 400)", `${MR}/search?facets=notjson`, { show: 400 });

// CurseForge: requires an API key (x-api-key). Without one we expect 403.
await probe("curseforge search without key (expect 403)", "https://api.curseforge.com/v1/mods/search?gameId=432&classId=4471&pageSize=2", { show: 400 });
await probe("curseforge categories without key", "https://api.curseforge.com/v1/categories?gameId=432&classId=4471", { show: 300 });

// Steam store query (for discovery of games you don't own).
const ctx = { language: "english", country_code: "US" };
const q = (query, dr = { include_basic_info: true, include_tag_count: 8, include_release: true }) =>
  "https://api.steampowered.com/IStoreQueryService/Query/v1/?input_json=" + encodeURIComponent(JSON.stringify({ query, context: ctx, data_request: dr }));
await probe("steam IStoreQueryService/Query keyless (tag 1742 story rich)", q({ count: 5, start: 0, sort: 0, filters: { type_filters: { include_games: true }, tagids_must_match: [{ tagids: [1742] }] } }), { show: 2500 });
await probe("steam IStoreQueryService/Query keyless (no filters)", q({ count: 3 }), { show: 1200 });
await probe("steam GetItems include_related / reviews", "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=" + encodeURIComponent(JSON.stringify({ ids: [{ appid: 32370 }], context: ctx, data_request: { include_basic_info: true, include_reviews: true, include_ratings: true, include_included_items: true } })), { show: 2500 });
await probe("steam GetSimilarItems? (expect 404)", "https://api.steampowered.com/IStoreBrowseService/GetSimilarItems/v1/?input_json=" + encodeURIComponent(JSON.stringify({ appid: 32370, context: ctx })), { show: 400 });

// Image hosts.
const icon = first?.icon_url;
if (icon) await probe("modrinth icon", icon, { show: 0 });

console.log(out.join("\n"));
