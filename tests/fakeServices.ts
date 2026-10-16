// A small, INVENTED stand-in for Steam and IGDB, shaped like their real responses
// (recorded with tools/probe-steam.mjs). Used by the tests and by the browser preview
// (tools/dev-server.mjs). None of these numbers are real Steam or IGDB data.

import type { HttpRequest, HttpResponse, Transport, ArtFile } from "../src/meta/http.ts";

interface FakeApp {
  appid: number;
  name: string;
  tags: [string, number][]; // [tag name, votes]
  devs: string[];
  pubs: string[];
  players: number[]; // Steam supported_player_categoryids
  released: string; // YYYY-MM-DD
  noCover?: boolean; // no library_600x900 asset (older store pages)
  hidden?: boolean; // GetItems says success != 1
  type?: number;
}

const T = (name: string, votes: number): [string, number] => [name, votes];

export const FAKE_APPS: FakeApp[] = [
  { appid: 32370, name: "STAR WARS™ Knights of the Old Republic™", tags: [T("RPG", 1542), T("Story Rich", 860), T("Sci-fi", 826), T("Singleplayer", 767), T("Party-Based RPG", 590), T("Classic", 466)], devs: ["BioWare"], pubs: ["LucasArts"], players: [2], released: "2003-11-19" },
  { appid: 208580, name: "STAR WARS™ Knights of the Old Republic™ II - The Sith Lords™", tags: [T("RPG", 1200), T("Story Rich", 700), T("Sci-fi", 500), T("Singleplayer", 450)], devs: ["Obsidian Entertainment"], pubs: ["LucasArts"], players: [2], released: "2005-02-08" },
  { appid: 1245620, name: "ELDEN RING", tags: [T("Souls-like", 1080), T("Open World", 790), T("Dark Fantasy", 753), T("RPG", 720), T("Difficult", 706), T("Action", 429)], devs: ["FromSoftware, Inc."], pubs: ["Bandai Namco Entertainment"], players: [2, 1, 49, 36, 9, 38], released: "2022-02-25" },
  { appid: 2622380, name: "ELDEN RING NIGHTREIGN", tags: [T("Souls-like", 600), T("Online Co-Op", 500), T("Roguelike", 400), T("Action", 300)], devs: ["FromSoftware, Inc."], pubs: ["Bandai Namco Entertainment"], players: [2, 1, 9, 38], released: "2025-05-30" },
  { appid: 292030, name: "The Witcher 3: Wild Hunt", tags: [T("Open World", 1500), T("RPG", 1400), T("Story Rich", 1300), T("Fantasy", 800)], devs: ["CD PROJEKT RED"], pubs: ["CD PROJEKT RED"], players: [2], released: "2015-05-18" },
  { appid: 20920, name: "The Witcher 2: Assassins of Kings Enhanced Edition", tags: [T("RPG", 900), T("Story Rich", 600), T("Fantasy", 500)], devs: ["CD PROJEKT RED"], pubs: ["CD PROJEKT RED"], players: [2], released: "2011-05-17" },
  { appid: 1113000, name: "Persona 4 Golden", tags: [T("JRPG", 1000), T("Story Rich", 800), T("Anime", 700), T("Turn-Based Combat", 400)], devs: ["ATLUS"], pubs: ["SEGA"], players: [2], released: "2020-06-13" },
  { appid: 233860, name: "Kenshi", tags: [T("Open World", 900), T("Sandbox", 850), T("Survival", 700), T("RPG", 600), T("Difficult", 500)], devs: ["Lo-Fi Games"], pubs: ["Lo-Fi Games"], players: [2], released: "2018-12-06" },
  { appid: 72850, name: "The Elder Scrolls V: Skyrim", tags: [T("Open World", 1800), T("RPG", 1600), T("Fantasy", 900)], devs: ["Bethesda Game Studios"], pubs: ["Bethesda Softworks"], players: [2], released: "2011-11-11" },
  { appid: 108600, name: "Project Zomboid", tags: [T("Survival", 1500), T("Zombies", 1200), T("Open World Survival Craft", 800), T("Sandbox", 700)], devs: ["The Indie Stone"], pubs: ["The Indie Stone"], players: [2, 1, 9, 38], released: "2013-11-08" },
  { appid: 1091500, name: "Cyberpunk 2077", tags: [T("Open World", 1400), T("RPG", 1300), T("Cyberpunk", 1200), T("Story Rich", 900)], devs: ["CD PROJEKT RED"], pubs: ["CD PROJEKT RED"], players: [2], released: "2020-12-10" },
  { appid: 400, name: "Portal", tags: [T("Puzzle", 1800), T("First-Person", 900), T("Comedy", 700), T("Sci-fi", 600)], devs: ["Valve"], pubs: ["Valve"], players: [2], released: "2007-10-10", noCover: true },
  { appid: 620, name: "Portal 2", tags: [T("Puzzle", 2000), T("Co-op", 1200), T("Comedy", 1000)], devs: ["Valve"], pubs: ["Valve"], players: [2, 1, 9, 38], released: "2011-04-18" },
  { appid: 920210, name: "LEGO® Star Wars™: The Skywalker Saga", tags: [T("LEGO", 900), T("Action", 600), T("Family Friendly", 500), T("Co-op", 400)], devs: ["TT Games"], pubs: ["Warner Bros. Games"], players: [2, 1, 9, 39], released: "2022-04-05" },
  { appid: 570940, name: "DARK SOULS™: REMASTERED", tags: [T("Souls-like", 1400), T("Difficult", 1200), T("Dark Fantasy", 900), T("RPG", 800)], devs: ["FromSoftware, Inc."], pubs: ["Bandai Namco Entertainment"], players: [2, 1, 49, 36, 9, 38], released: "2018-05-23" },
  { appid: 374320, name: "DARK SOULS™ III", tags: [T("Souls-like", 1500), T("Difficult", 1300), T("Dark Fantasy", 1000)], devs: ["FromSoftware, Inc."], pubs: ["Bandai Namco Entertainment"], players: [2, 1, 49, 36, 9, 38], released: "2016-04-11" },
  { appid: 814380, name: "Sekiro™: Shadows Die Twice - GOTY Edition", tags: [T("Souls-like", 1500), T("Difficult", 1400), T("Action", 900), T("Ninja", 600)], devs: ["FromSoftware, Inc."], pubs: ["Activision"], players: [2], released: "2019-03-21" },
  { appid: 1325200, name: "Nioh 2 – The Complete Edition", tags: [T("Souls-like", 900), T("Difficult", 800), T("Action RPG", 700)], devs: ["KOEI TECMO GAMES CO., LTD."], pubs: ["KOEI TECMO GAMES CO., LTD."], players: [2, 1, 9, 38], released: "2021-02-05" },
  { appid: 1328670, name: "Mass Effect™ Legendary Edition", tags: [T("RPG", 1200), T("Story Rich", 1100), T("Sci-fi", 1000), T("Choices Matter", 700)], devs: ["BioWare"], pubs: ["Electronic Arts"], players: [2], released: "2021-05-14" },
  { appid: 1086940, name: "Baldur's Gate 3", tags: [T("RPG", 1600), T("Choices Matter", 1300), T("Story Rich", 1200), T("Turn-Based Combat", 900), T("Co-op", 500)], devs: ["Larian Studios"], pubs: ["Larian Studios"], players: [2, 1, 9, 38], released: "2023-08-03" },
  { appid: 632470, name: "Disco Elysium - The Final Cut", tags: [T("RPG", 1100), T("Story Rich", 1000), T("Detective", 800), T("Dialogue", 500)], devs: ["ZA/UM"], pubs: ["ZA/UM"], players: [2], released: "2019-10-15" },
  { appid: 1903340, name: "Clair Obscur: Expedition 33", tags: [T("RPG", 1000), T("Turn-Based Combat", 900), T("Story Rich", 800)], devs: ["Sandfall Interactive"], pubs: ["Kepler Interactive"], players: [2], released: "2025-04-24" },
  { appid: 429660, name: "Tales of Berseria™", tags: [T("JRPG", 900), T("Anime", 800), T("Story Rich", 500)], devs: ["BANDAI NAMCO Studios Inc."], pubs: ["Bandai Namco Entertainment"], players: [2, 1, 24], released: "2017-01-26" },
  { appid: 435400, name: "Hidden Folks", tags: [T("Hidden Object", 800), T("Relaxing", 700), T("Cute", 500), T("Puzzle", 400)], devs: ["Adriaan de Jongh"], pubs: ["Adriaan de Jongh"], players: [2], released: "2017-02-15" },
  { appid: 581270, name: "Old Man's Journey", tags: [T("Puzzle", 500), T("Relaxing", 400), T("Atmospheric", 300)], devs: ["Broken Rules"], pubs: ["Broken Rules"], players: [2], released: "2017-05-18" },
  { appid: 609490, name: "Minit", tags: [T("Adventure", 600), T("Pixel Graphics", 500), T("Short", 400)], devs: ["JW, Kitty, Jukio, and Dom"], pubs: ["Devolver Digital"], players: [2], released: "2018-04-03" },
  { appid: 413150, name: "Stardew Valley", tags: [T("Farming Sim", 2000), T("Relaxing", 1500), T("Cozy", 1300), T("Multiplayer", 700)], devs: ["ConcernedApe"], pubs: ["ConcernedApe"], players: [2, 1, 9, 38], released: "2016-02-26" },
  { appid: 892970, name: "Valheim", tags: [T("Open World Survival Craft", 1600), T("Survival", 1400), T("Online Co-Op", 1000)], devs: ["Iron Gate AB"], pubs: ["Coffee Stain Publishing"], players: [2, 1, 9, 38], released: "2021-02-02" },
  { appid: 251570, name: "7 Days to Die", tags: [T("Open World Survival Craft", 1400), T("Zombies", 1300), T("Survival", 1200)], devs: ["The Fun Pimps"], pubs: ["The Fun Pimps Entertainment LLC"], players: [2, 1, 9, 38, 49, 36], released: "2013-12-13" },
  { appid: 271590, name: "Grand Theft Auto V Legacy", tags: [T("Open World", 2000), T("Action", 1500), T("Multiplayer", 1200)], devs: ["Rockstar North"], pubs: ["Rockstar Games"], players: [2, 1, 49, 36, 9, 38], released: "2015-04-13" },
  { appid: 381210, name: "Dead by Daylight", tags: [T("Horror", 1500), T("Multiplayer", 1400), T("PvP", 1000)], devs: ["Behaviour Interactive Inc."], pubs: ["Behaviour Interactive Inc."], players: [1, 49, 36], released: "2016-06-14" },
  { appid: 2767030, name: "Marvel Rivals", tags: [T("Hero Shooter", 1500), T("PvP", 1300), T("Free to Play", 1000)], devs: ["NetEase Games"], pubs: ["NetEase Games"], players: [1, 49, 36], released: "2024-12-06" },
  { appid: 730, name: "Counter-Strike 2", tags: [T("FPS", 2000), T("Shooter", 1800), T("Competitive", 1500), T("PvP", 1400)], devs: ["Valve"], pubs: ["Valve"], players: [1, 49, 36], released: "2012-08-21" },
  { appid: 431960, name: "Wallpaper Engine", tags: [T("Utilities", 900), T("Design & Illustration", 500)], devs: ["Wallpaper Engine Team"], pubs: ["Wallpaper Engine Team"], players: [], released: "2018-11-16", type: 6 },
  { appid: 238320, name: "Outlast", tags: [T("Horror", 1500), T("Survival Horror", 1300), T("Psychological Horror", 900)], devs: ["Red Barrels"], pubs: ["Red Barrels"], players: [2], released: "2013-09-04" },
  { appid: 57300, name: "Amnesia: The Dark Descent", tags: [T("Horror", 1400), T("Survival Horror", 1000), T("Atmospheric", 800)], devs: ["Frictional Games"], pubs: ["Frictional Games"], players: [2], released: "2010-09-08" },
  { appid: 427520, name: "Factorio", tags: [T("Automation", 2000), T("Base Building", 1500), T("Strategy", 900)], devs: ["Wube Software LTD."], pubs: ["Wube Software LTD."], players: [2, 1, 9, 38], released: "2020-08-14" },
  { appid: 367520, name: "Hollow Knight", tags: [T("Metroidvania", 2000), T("Souls-like", 1200), T("Difficult", 1100), T("Atmospheric", 900)], devs: ["Team Cherry"], pubs: ["Team Cherry"], players: [2], released: "2017-02-24" },
  { appid: 7670, name: "BioShock™", tags: [T("FPS", 1200), T("Story Rich", 1100), T("Atmospheric", 1000)], devs: ["2K Boston", "2K Australia"], pubs: ["2K"], players: [2], released: "2007-08-21", hidden: true },
  { appid: 8850, name: "BioShock® 2", tags: [T("FPS", 900), T("Story Rich", 700)], devs: ["2K Marin"], pubs: ["2K"], players: [2], released: "2010-02-09", hidden: true },
  { appid: 409710, name: "BioShock™ Remastered", tags: [T("FPS", 1200), T("Story Rich", 1100), T("Atmospheric", 1000)], devs: ["2K Boston", "2K Australia"], pubs: ["2K"], players: [2], released: "2016-09-15" },
  // Two games with nearly the same name, to exercise "too close to call".
  { appid: 98400, name: "Hard Reset", tags: [T("FPS", 300)], devs: ["Flying Wild Hog"], pubs: ["Flying Wild Hog"], players: [2], released: "2011-09-13" },
  { appid: 407810, name: "Hard Reset Redux", tags: [T("FPS", 500)], devs: ["Flying Wild Hog"], pubs: ["Gambitious Digital Entertainment"], players: [2], released: "2016-06-03" },
  // Owned on Steam but not in the REWIND fixture library.
  { appid: 1145360, name: "Hades", tags: [T("Roguelike", 2000), T("Action", 1500), T("Mythology", 900), T("Difficult", 800)], devs: ["Supergiant Games"], pubs: ["Supergiant Games"], players: [2], released: "2020-09-17" },
  { appid: 1222140, name: "Hunt: Showdown 1896 (Test Server)", tags: [T("PvP", 300)], devs: ["Crytek"], pubs: ["Crytek"], players: [1, 49, 36], released: "2018-02-22" },
  { appid: 228980, name: "Steamworks Common Redistributables", tags: [], devs: ["Valve"], pubs: ["Valve"], players: [], released: "2010-01-01", type: 13 },
];

const TAG_IDS = new Map<string, number>();
for (const a of FAKE_APPS) for (const [t] of a.tags) if (!TAG_IDS.has(t)) TAG_IDS.set(t, 1000 + TAG_IDS.size);

/** Owned games returned by the fake GetOwnedGames, with invented minutes and dates. */
export const FAKE_OWNED: { appid: number; minutes: number; last: string | null }[] = [
  { appid: 32370, minutes: 2400, last: "2026-10-14" },
  { appid: 208580, minutes: 270, last: "2025-12-01" },
  { appid: 1245620, minutes: 9700, last: "2026-08-02" },
  { appid: 292030, minutes: 12660, last: "2026-01-20" },
  { appid: 1113000, minutes: 700, last: "2026-03-03" },
  { appid: 233860, minutes: 1960, last: "2025-11-11" },
  { appid: 400, minutes: 144, last: "2019-05-05" },
  { appid: 409710, minutes: 30, last: "2024-04-04" }, // BioShock Remastered: REWIND has the original BioShock
  { appid: 1145360, minutes: 0, last: null },
  { appid: 1222140, minutes: 12, last: "2025-01-01" },
  { appid: 228980, minutes: 0, last: null },
  { appid: 98400, minutes: 0, last: null },
];

const IGDB_GAMES = [
  { id: 1001, name: "Star Wars: Knights of the Old Republic", first_release_date: 1069200000, summary: "Invented IGDB test summary.", genres: [{ name: "Role-playing (RPG)" }], themes: [{ name: "Science fiction" }], game_modes: [{ name: "Single player" }], platforms: [{ name: "PC (Microsoft Windows)" }], involved_companies: [{ company: { name: "BioWare" }, developer: true, publisher: false }], cover: { image_id: "kotor1" }, external_games: [{ uid: "32370", external_game_source: 1, url: "https://store.steampowered.com/app/32370" }], url: "https://www.igdb.com/games/star-wars-knights-of-the-old-republic", ttb: { hastily: 25 * 3600, normally: 41 * 3600, completely: 55 * 3600, count: 120 } },
  { id: 1002, name: "Star Wars: Knights of the Old Republic II - The Sith Lords", first_release_date: 1102300000, summary: "Invented.", genres: [{ name: "Role-playing (RPG)" }], themes: [{ name: "Science fiction" }], game_modes: [{ name: "Single player" }], platforms: [], involved_companies: [], cover: { image_id: "kotor2" }, external_games: [{ uid: "208580", category: 1 }], url: "https://www.igdb.com/games/kotor2", ttb: null },
  { id: 1003, name: "Hidden Folks", first_release_date: 1487100000, summary: "Invented.", genres: [{ name: "Puzzle" }], themes: [], game_modes: [{ name: "Single player" }], platforms: [], involved_companies: [], cover: { image_id: "hf" }, external_games: [], url: "https://www.igdb.com/games/hidden-folks", ttb: { hastily: 4 * 3600, normally: 5 * 3600, completely: 7 * 3600, count: 9 } },
];

export interface FakeOptions {
  /** Throw "offline" for every request after this many have succeeded. */
  failAfter?: number;
  /** Answer the first GetItems call with HTTP 429. */
  rateLimitOnce?: boolean;
  steamKey?: string;
}

export const FAKE_STEAM_KEY = "0123456789ABCDEF0123456789ABCDEF";
export const FAKE_STEAMID = "76561198000000042";

export function fakeTransport(opts: FakeOptions = {}): Transport & { log: string[]; downloads: string[] } {
  let calls = 0;
  let limited = false;
  const log: string[] = [];
  const downloads: string[] = [];
  const json = (status: number, body: unknown): HttpResponse => ({ status, body: typeof body === "string" ? body : JSON.stringify(body) });
  const gate = () => {
    calls++;
    if (opts.failAfter != null && calls > opts.failAfter) throw new Error("offline: error sending request (fake: no internet)");
  };
  return {
    log,
    downloads,
    async request(r: HttpRequest): Promise<HttpResponse> {
      gate();
      const u = new URL(r.url);
      log.push(`${r.method} ${u.host}${u.pathname}`);
      const key = opts.steamKey ?? FAKE_STEAM_KEY;
      if (u.pathname.startsWith("/api/storesearch")) {
        const term = (u.searchParams.get("term") ?? "").toLowerCase().replace(/[™®]/g, "");
        const words = term.split(/\W+/).filter((w) => w.length > 1);
        const items = FAKE_APPS.filter((a) => {
          const n = a.name.toLowerCase().replace(/[™®]/g, "");
          return words.length && words.filter((w) => n.includes(w)).length >= Math.ceil(words.length * 0.6);
        })
          .slice(0, 10)
          .map((a) => ({ type: "app", name: a.name, id: a.appid, tiny_image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${a.appid}/capsule_231x87.jpg?t=1` }));
        return json(200, { total: items.length, items });
      }
      if (u.pathname.startsWith("/IStoreService/GetTagList")) {
        return json(200, { response: { version_hash: "fake", tags: [...TAG_IDS].map(([name, tagid]) => ({ tagid, name })) } });
      }
      if (u.pathname.startsWith("/IStoreBrowseService/GetItems")) {
        if (opts.rateLimitOnce && !limited) {
          limited = true;
          return { status: 429, body: "Too Many Requests", retryAfter: "1" };
        }
        const input = JSON.parse(u.searchParams.get("input_json") ?? "{}");
        const store_items = (input.ids ?? []).map(({ appid }: { appid: number }) => {
          const a = FAKE_APPS.find((x) => x.appid === appid);
          if (!a || a.hidden) return { item_type: 0, id: appid, success: 3 };
          const sec = Date.parse(a.released + "T00:00:00Z") / 1000;
          return {
            item_type: 0,
            id: a.appid,
            success: 1,
            visible: true,
            name: a.name,
            appid: a.appid,
            type: a.type ?? 0,
            tagids: a.tags.map(([t]) => TAG_IDS.get(t)),
            categories: { supported_player_categoryids: a.players },
            basic_info: { short_description: `Invented test description for ${a.name}. &quot;Quoted&quot; text.`, publishers: a.pubs.map((name) => ({ name })), developers: a.devs.map((name) => ({ name })) },
            tags: a.tags.map(([t, weight]) => ({ tagid: TAG_IDS.get(t), weight })),
            assets: {
              asset_url_format: `steam/apps/${a.appid}/\${FILENAME}?t=1700000000`,
              header: "header.jpg",
              ...(a.noCover ? {} : { library_capsule: "library_600x900.jpg", library_capsule_2x: "library_600x900_2x.jpg" }),
              library_hero: "library_hero.jpg",
            },
            release: { steam_release_date: sec },
            platforms: { windows: true },
          };
        });
        return json(200, { response: { store_items } });
      }
      if (u.pathname.startsWith("/IPlayerService/GetOwnedGames")) {
        if (u.searchParams.get("key") !== key) return { status: 401, body: "<html>Unauthorized</html>" };
        if (u.searchParams.get("steamid") !== FAKE_STEAMID) return json(200, { response: {} }); // private profile
        const games = FAKE_OWNED.map((o) => ({ appid: o.appid, name: FAKE_APPS.find((a) => a.appid === o.appid)!.name, playtime_forever: o.minutes, rtime_last_played: o.last ? Date.parse(o.last + "T12:00:00Z") / 1000 : 0 }));
        return json(200, { response: { game_count: games.length, games } });
      }
      if (u.pathname.startsWith("/ISteamUser/ResolveVanityURL")) {
        if (u.searchParams.get("key") !== key) return { status: 403, body: "<html>Forbidden</html>" };
        return json(200, u.searchParams.get("vanityurl") === "tommy" ? { response: { steamid: FAKE_STEAMID, success: 1 } } : { response: { success: 42, message: "No match" } });
      }
      if (u.host === "id.twitch.tv") {
        if (u.searchParams.get("client_id") === "testclient" && u.searchParams.get("client_secret") === "testsecret") return json(200, { access_token: "faketoken", expires_in: 5_000_000, token_type: "bearer" });
        return json(403, { status: 403, message: "invalid client secret" });
      }
      if (u.host === "api.igdb.com") {
        const auth = (r.headers ?? []).find(([k]) => k === "Authorization")?.[1];
        if (auth !== "Bearer faketoken") return json(401, { message: "Authorization Failure" });
        const body = r.body ?? "";
        if (u.pathname.endsWith("/game_time_to_beats")) {
          const id = Number(/game_id = (\d+)/.exec(body)?.[1]);
          const g = IGDB_GAMES.find((x) => x.id === id);
          return json(200, g?.ttb ? [{ id: 9000 + id, game_id: id, ...g.ttb }] : []);
        }
        const byId = /where id = (\d+)/.exec(body);
        if (byId) return json(200, IGDB_GAMES.filter((g) => g.id === Number(byId[1])).map(({ ttb: _t, ...g }) => g));
        const term = (/search "([^"]*)"/.exec(body)?.[1] ?? "").toLowerCase();
        const words = term.split(/\W+/).filter((w) => w.length > 2);
        return json(200, IGDB_GAMES.filter((g) => words.length && words.every((w) => g.name.toLowerCase().includes(w))).map(({ ttb: _t, ...g }) => g));
      }
      return { status: 404, body: "Not Found" };
    },
    async download(url: string, name: string): Promise<ArtFile> {
      gate();
      const m = /apps\/(\d+)\/(library_600x900|header)/.exec(url);
      if (m) {
        const a = FAKE_APPS.find((x) => x.appid === Number(m[1]));
        if (!a || (m[2] === "library_600x900" && a.noCover)) throw new Error("http 404");
      }
      downloads.push(name);
      return { file: `artwork/${name}.jpg`, bytes: 1000 };
    },
  };
}

/** A pretend Steam folder for "Import from Steam on this PC" (localconfig.vdf + manifests). */
export function fakeSteamFolder(): { root: string; libraries: string[]; manifests: string[]; accounts: { id: string; localConfig: string; modified: number }[] } {
  const manifest = (appid: number, name: string) => `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"universe"\t\t"1"\n\t"name"\t\t"${name.replace(/"/g, '\\"')}"\n\t"StateFlags"\t\t"4"\n}\n`;
  const apps = [
    [32370, 2460, "2026-10-15"],
    [1245620, 9700, "2026-08-02"],
    [233860, 1960, "2025-11-11"],
    [1145360, 95, "2026-09-09"],
    [999999, 30, "2026-01-01"], // unknown to the store: stays unnamed
  ] as const;
  const appsVdf = apps.map(([id, pt, d]) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LastPlayed"\t\t"${Date.parse(d + "T12:00:00Z") / 1000}"\n\t\t\t\t\t\t"Playtime"\t\t"${pt}"\n\t\t\t\t\t\t"Playtime2wks"\t\t"0"\n\t\t\t\t\t}`).join("\n");
  const localConfig = `"UserLocalConfigStore"\n{\n\t"friends"\n\t{\n\t\t"PersonaName"\t\t"Tommy (test)"\n\t}\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n${appsVdf}\n\t\t\t\t\t"620"\n\t\t\t\t\t{\n\t\t\t\t\t\t"cloud"\t\t"1"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`;
  return {
    root: "C:\\\\Program Files (x86)\\\\Steam",
    libraries: ["C:\\\\Program Files (x86)\\\\Steam"],
    manifests: [manifest(32370, "STAR WARS™ Knights of the Old Republic™"), manifest(228980, "Steamworks Common Redistributables"), manifest(413150, "Stardew Valley")],
    accounts: [{ id: "39734314", localConfig, modified: 1_790_000_000 }],
  };
}
