// Shared fixture: a slice of Tommy's real library (titles + approximate hours),
// imported through the same pipeline as the app.
import { nodeDriver } from "./nodeDriver.ts";
import { Repo } from "../src/db/repo.ts";
import { applyArtifactPlan, buildArtifactPlan, parseArtifactBackup } from "../src/migrate/artifactImport.ts";
import { applyReferenceData } from "../src/migrate/reference.ts";
import { buildTaste, type RecEvent } from "../src/rec/taste.ts";
import { DEFAULT_WEIGHTS, EMPTY_SESSION, recommend, type Session } from "../src/rec/engine.ts";
import { buildSeriesIndex } from "../src/rec/series.ts";
import { DEFAULT_PROFILE } from "../src/data/profileDefaults.ts";
import type { Game } from "../src/lib/types.ts";

const LIB: [string, number][] = [
  ["STAR WARS™ Knights of the Old Republic™", 37.4],
  ["STAR WARS™ Knights of the Old Republic™ II - The Sith Lords™", 4.5],
  ["ELDEN RING", 161.3],
  ["ELDEN RING NIGHTREIGN", 22],
  ["The Witcher 3: Wild Hunt — Remastered", 210.9],
  ["The Witcher 2: Assassins of Kings Enhanced Edition", 52],
  ["Persona 4 Golden", 11.1],
  ["Kenshi", 32.6],
  ["The Elder Scrolls V: Skyrim", 42.3],
  ["Project Zomboid", 75.9],
  ["Cyberpunk 2077", 144],
  ["Portal", 2.4],
  ["Portal 2", 0],
  ["LEGO® Star Wars™: The Skywalker Saga", 15.8],
  ["DARK SOULS™: REMASTERED", 56.7],
  ["DARK SOULS™ III", 15.8],
  ["Sekiro™: Shadows Die Twice - GOTY Edition", 1],
  ["Nioh 2 – The Complete Edition", 0],
  ["Mass Effect™ Legendary Edition", 8],
  ["Baldur's Gate 3", 10],
  ["Disco Elysium - The Final Cut", 2],
  ["Clair Obscur: Expedition 33", 12.9],
  ["Tales of Berseria™", 0],
  ["Hidden Folks", 0],
  ["Old Man's Journey", 0],
  ["Minit", 0],
  ["Stardew Valley", 16],
  ["Valheim", 43],
  ["7 Days to Die", 11.4],
  ["Grand Theft Auto V Legacy", 242.1],
  ["Dead by Daylight", 88.7],
  ["Marvel Rivals", 40.6],
  ["Counter-Strike 2", 310],
  ["Wallpaper Engine", 21.4],
  ["Outlast", 0],
  ["Amnesia: The Dark Descent", 0],
  ["Factorio", 105],
  ["Hollow Knight", 10],
  ["BioShock™", 11],
  ["BioShock® 2", 2],
];

export async function setup() {
  const backup = {
    state: { v: 1, settings: { basis: "plus", solo: true }, slots: {}, log: [] },
    lib0: { g: LIB.map(([n, p]) => ({ id: n.toLowerCase(), n, ...(p ? { p } : {}) })) },
  };
  const repo = new Repo(nodeDriver());
  await repo.init();
  await applyArtifactPlan(repo, buildArtifactPlan(parseArtifactBackup(backup)));
  await applyReferenceData(repo);
  return repo;
}

export const NOW = new Date("2026-10-20T20:00:00Z");
const series = buildSeriesIndex();

export function rank(games: Game[], s: Partial<Session> = {}, events: RecEvent[] = [], now = NOW) {
  const taste = buildTaste(games, DEFAULT_PROFILE, events, now);
  return recommend({ games, taste, events, session: { ...EMPTY_SESSION, ...s }, weights: DEFAULT_WEIGHTS, profile: DEFAULT_PROFILE, series, allowUnverified: true, now });
}
export const pos = (r: ReturnType<typeof rank>, title: string) => r.results.findIndex((x) => x.game.title.startsWith(title));
export const top = (r: ReturnType<typeof rank>, n: number) => r.results.slice(0, n).map((x) => x.game.title);
