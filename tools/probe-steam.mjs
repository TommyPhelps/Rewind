// Live check of the public, key-free Steam endpoints REWIND uses (run in CI, not by the app).
// Writes a short report of status codes and response shapes to stdout.
const UA = "REWIND/3 (personal game library; +https://github.com/TommyPhelps/Rewind)";
const out = [];
const log = (...a) => out.push(a.join(" "));
async function probe(label, url, { head = false, show = 1200 } = {}) {
  try {
    const r = await fetch(url, { method: head ? "HEAD" : "GET", headers: { "User-Agent": UA }, redirect: "follow" });
    const ct = r.headers.get("content-type");
    let body = "";
    if (!head) body = await r.text();
    log(`\n## ${label}\n${r.status} ${ct ?? ""} final=${r.url}${head ? " len=" + r.headers.get("content-length") : ""}`);
    if (body) log(body.slice(0, show));
    return { status: r.status, body };
  } catch (e) {
    log(`\n## ${label}\nERROR ${e.message}`);
    return { status: 0, body: "" };
  }
}
const items = (ids, req) =>
  "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=" +
  encodeURIComponent(JSON.stringify({ ids: ids.map((appid) => ({ appid })), context: { language: "english", country_code: "US" }, data_request: req }));

await probe("appdetails KOTOR", "https://store.steampowered.com/api/appdetails?appids=32370&l=english&cc=us", { show: 4000 });
await probe("appdetails Elden Ring filters", "https://store.steampowered.com/api/appdetails?appids=1245620&l=english&cc=us&filters=basic,genres,categories,developers,publishers,release_date,platforms", { show: 2500 });
await probe("appdetails multi (expect error)", "https://store.steampowered.com/api/appdetails?appids=32370,400&l=english", { show: 300 });
await probe("storesearch", "https://store.steampowered.com/api/storesearch/?term=" + encodeURIComponent("Knights of the Old Republic") + "&l=english&cc=US", { show: 2000 });
await probe("GetItems assets", items([32370, 1245620, 2215430, 730], { include_assets: true, include_basic_info: true, include_tag_count: 12, include_release: true, include_platforms: true }), { show: 6000 });
await probe("GetTagList (no key)", "https://api.steampowered.com/IStoreService/GetTagList/v1/?language=english", { show: 600 });
await probe("GetAppList v2 (no key)", "https://api.steampowered.com/ISteamApps/GetAppList/v2/", { show: 300 });
await probe("IStoreService GetAppList (no key)", "https://api.steampowered.com/IStoreService/GetAppList/v1/?max_results=5", { show: 300 });
await probe("ResolveVanityURL (no key)", "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?vanityurl=gabelogannewell", { show: 300 });
await probe("GetOwnedGames (no key)", "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?steamid=76561197960287930&include_appinfo=1", { show: 300 });
for (const [n, id] of [["KOTOR", 32370], ["Elden Ring", 1245620], ["Ghost of Tsushima", 2215430], ["Portal", 400]]) {
  await probe(`legacy cdn library_600x900 ${n}`, `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`, { head: true });
  await probe(`shared store_item_assets library_600x900 ${n}`, `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`, { head: true });
  await probe(`legacy header ${n}`, `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`, { head: true });
}
await probe("IGDB without credentials (expect 401)", "https://api.igdb.com/v4/games", { show: 300 });
console.log(out.join("\n"));
