// Reading a modpack: what kind of pack it is, and how well it fits you — with the evidence
// for every claim. REWIND only says a pack "has a quest book" when a quest mod is in its
// file list, or labels it "the author says" when only the author's categories or
// description say so. Quest QUALITY is never claimed: REWIND can't play the pack.

import { EVIDENCE_LABEL, type Evidence, type PackDetail, type PackMod, type PackSummary } from "./packTypes.ts";

export type Signal =
  | "quests"
  | "guidance"
  | "exploration"
  | "cozy"
  | "tech"
  | "magic"
  | "adventure"
  | "shaders"
  | "lightweight"
  | "kitchen_sink"
  | "expert"
  | "hardcore"
  | "maintained"
  | "adoption";

export const SIGNAL_LABEL: Record<Signal, string> = {
  quests: "Quest book",
  guidance: "In-game guidance (recipe viewer, guide books)",
  exploration: "Exploration & world generation",
  cozy: "Cozy: building, decoration, farming, food",
  tech: "Technology & automation",
  magic: "Magic",
  adventure: "Adventure / RPG / bosses",
  shaders: "Shader support",
  lightweight: "Lightweight / performance",
  kitchen_sink: "Kitchen sink (a bit of everything)",
  expert: "Expert progression",
  hardcore: "Hardcore survival",
  maintained: "Actively maintained",
  adoption: "Community adoption (downloads)",
};

export interface Finding {
  signal: Signal;
  /** 0..1 how strongly it shows. */
  strength: number;
  evidence: Evidence;
  text: string;
}

// ---- mods that are evidence of something (Modrinth slugs; prefixes end with "-") ----

const KNOWN: Record<Exclude<Signal, "maintained" | "adoption" | "kitchen_sink" | "expert" | "lightweight">, string[]> & { perf: string[]; viewer: string[] } = {
  quests: ["ftb-quests", "ftb-quests-forge", "ftb-quests-fabric", "heracles", "better-questing", "odyssey-quests", "questbook"],
  guidance: ["patchouli", "lavender", "guideme", "akashic-tome", "modonomicon", "ponder"],
  viewer: ["jei", "emi", "rei", "roughly-enough-items"],
  exploration: ["terralith", "tectonic", "yungs-", "when-dungeons-arise", "towns-and-towers", "explorify", "dungeons-and-taverns", "biomes-o-plenty", "oh-the-biomes-weve-gone", "oh-the-biomes-youll-go", "regions-unexplored", "repurposed-structures", "ctov", "integrated-dungeons-and-structures", "the-aether", "twilight-forest", "blue-skies", "alexs-caves", "incendium", "nullscape", "natures-compass", "explorers-compass"],
  cozy: ["farmers-delight", "supplementaries", "handcrafted", "macaws-", "chipped", "rechiseled", "another-furniture", "comforts", "croptopia", "decorative-blocks", "storage-drawers", "farmers-", "fast-paced-", "serene-seasons", "friends-and-foes", "beautify"],
  tech: ["create", "create-", "mekanism", "ae2", "applied-energistics-2", "refined-storage", "immersive-engineering", "thermal-", "industrial-foregoing", "powah", "modern-industrialization", "tech-reborn", "oritech", "pipez", "gregtech", "integrated-dynamics", "ender-io", "mekanism-"],
  magic: ["ars-nouveau", "ars-", "botania", "irons-spells-n-spellbooks", "occultism", "blood-magic", "bloodmagic", "forbidden-arcanus", "hexcasting", "malum", "eidolon", "electroblobs-wizardry", "spectrum", "mana-and-artifice", "theurgy", "goety"],
  adventure: ["pufferfish-skills", "levelz", "spell-engine", "simply-skills", "cataclysm", "l_ender-s-cataclysm", "bosses-of-mass-destruction", "mowzies-mobs", "better-combat", "epic-fight", "ice-and-fire", "irons-spells-n-spellbooks"],
  hardcore: ["tough-as-nails", "thirst-was-taken", "first-aid", "cold-sweat", "spice-of-life-", "scaling-health", "in-control", "hardcore-"],
  shaders: ["iris", "oculus"],
  perf: ["sodium", "embeddium", "rubidium", "lithium", "ferrite-core", "modernfix", "entityculling", "immediatelyfast", "c2me-fabric", "krypton", "starlight", "moreculling", "dynamic-fps", "radium", "canary", "memoryleakfix", "noisium", "clumps", "smooth-boot-reloaded", "lazydfu", "fastload", "exordium", "nvidium"],
};

function matches(mod: PackMod, list: string[]): boolean {
  const s = mod.slug.toLowerCase();
  return list.some((k) => (k.endsWith("-") ? s.startsWith(k) : s === k));
}
const names = (ms: PackMod[]) => ms.slice(0, 3).map((m) => m.title).join(", ") + (ms.length > 3 ? ` +${ms.length - 3} more` : "");

export interface Reading {
  findings: Finding[];
  /** Short style labels with their evidence: "Quest-driven", "Expert", "Beginner-friendly"… */
  labels: { label: string; evidence: Evidence; why: string }[];
  difficulty: { level: "beginner" | "standard" | "expert" | "hardcore" | "unknown"; evidence: Evidence; why: string };
  complexity: { level: "light" | "medium" | "heavy" | "unknown"; why: string };
  performance: string[];
  shaders: { state: "included" | "not_included" | "unknown"; why: string };
  quests: { state: "verified" | "author" | "none_found" | "unknown"; why: string; quality: string };
  maintenance: { state: "active" | "recent" | "slow" | "stale" | "archived" | "unknown"; why: string };
  progression: string;
  modCount: number | null;
  modsBy: { label: string; count: number }[];
  authorClaims: string[];
}

const DAY = 86_400_000;
const ago = (iso: string | null, now: Date) => (iso ? Math.floor((now.getTime() - Date.parse(iso)) / DAY) : null);
export function agoText(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return "unknown";
  if (days < 1) return "today";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")} years ago`;
}

/** Reads a pack from whatever is known: full details (mod list) if fetched, else the search summary. */
export function readPack(p: PackSummary | PackDetail, now = new Date()): Reading {
  const d = "fetchedAt" in p ? (p as PackDetail) : null;
  const mods = d?.mods ?? null;
  const cats = new Set(p.categories.map((c) => c.toLowerCase()));
  const title = p.title.toLowerCase();
  const body = (d?.bodyText ?? "") + "\n" + p.description;
  const findings: Finding[] = [];
  const add = (signal: Signal, strength: number, evidence: Evidence, text: string) => findings.push({ signal, strength: Math.max(0, Math.min(1, strength)), evidence, text });
  const pick = (list: string[]) => (mods ? mods.filter((m) => matches(m, list)) : []);
  const byCat = (c: string) => (mods ? mods.filter((m) => m.categories.includes(c)) : []);

  // Quests
  const questMods = pick(KNOWN.quests);
  const questClaim = /(\d[\d,]*)\+?\s*(hand[- ]?(made|written|crafted)\s+)?quests/i.exec(body);
  const authorClaims: string[] = [];
  if (questClaim) authorClaims.push(`"${questClaim[0].trim()}"`);
  let quests: Reading["quests"];
  if (questMods.length) {
    quests = { state: "verified", why: `${names(questMods)} is in the pack's mod list`, quality: "REWIND can confirm a quest book exists, not how good or well-paced it is." };
    add("quests", 1, "verified", `Has a quest book (${names(questMods)} in its mod list)`);
  } else if (cats.has("quests") || cats.has("quests ") || [...cats].some((c) => /^quests?$/.test(c)) || /quest ?book|questline|quest line|chapters? of quests/i.test(body)) {
    quests = { state: "author", why: cats.has("quests") ? "The author tagged it 'Quests'" : "The author's description mentions a quest book", quality: "Not checked: REWIND couldn't see the pack's mod list." };
    add("quests", 0.75, "author", quests.why);
  } else if (mods && mods.length) {
    quests = { state: "none_found", why: "No quest mod found in its Modrinth mod list", quality: "" };
  } else quests = { state: "unknown", why: "Not known", quality: "" };

  // Guidance
  const viewer = pick(KNOWN.viewer);
  const guides = pick(KNOWN.guidance);
  if (viewer.length || guides.length) add("guidance", Math.min(1, 0.5 * (viewer.length ? 1 : 0) + 0.5 * (guides.length ? 1 : 0) + (questMods.length ? 0.2 : 0)), "verified", `In-game help: ${[...viewer, ...guides].map((m) => m.title).slice(0, 3).join(", ")}`);

  // Content areas: known mods first, then each mod's own Modrinth categories, then the author's tags.
  const area = (signal: Signal, known: string[], modCats: string[], authorCats: string[], noun: string) => {
    const k = pick(known);
    const c = mods ? mods.filter((m) => modCats.some((x) => m.categories.includes(x))) : [];
    if (k.length || c.length >= 6) {
      const strength = Math.min(1, k.length * 0.25 + c.length / 30);
      add(signal, strength, "verified", k.length ? `${noun}: ${names(k)}${c.length > k.length ? ` and ${c.length} mods tagged ${modCats.join("/")}` : ""}` : `${c.length} ${modCats.join("/")} mods`);
    } else if (authorCats.some((a) => cats.has(a))) add(signal, 0.6, "author", `The author tagged it ${authorCats.filter((a) => cats.has(a)).map((x) => `'${x}'`).join(", ")}`);
  };
  area("tech", KNOWN.tech, ["technology"], ["technology", "tech"], "Tech mods");
  area("magic", KNOWN.magic, ["magic"], ["magic"], "Magic mods");
  area("exploration", KNOWN.exploration, ["worldgen"], ["exploration", "adventure and rpg"], "World generation & structures");
  area("cozy", KNOWN.cozy, ["decoration", "food"], ["vanilla+"], "Building, farming & decoration");
  area("adventure", KNOWN.adventure, ["adventure", "equipment", "mobs"], ["adventure", "adventure and rpg", "combat"], "Adventure & combat");
  area("hardcore", KNOWN.hardcore, [], ["hardcore"], "Survival-pressure mods");

  // Shaders
  const shaderMods = pick(KNOWN.shaders);
  let shaders: Reading["shaders"];
  if (shaderMods.length) {
    shaders = { state: "included", why: `${names(shaderMods)} is included, so shader packs can be used` };
    add("shaders", 1, "verified", `Shaders ready (${names(shaderMods)} included)`);
  } else if (/shader/i.test(body) && /support|compatible|works with|ready/i.test(body)) {
    shaders = { state: "unknown", why: "The description mentions shaders, but no shader loader is in the Modrinth mod list" };
    add("shaders", 0.4, "author", "The author's description mentions shader support");
  } else shaders = { state: mods && mods.length ? "not_included" : "unknown", why: mods && mods.length ? "No shader loader (Iris/Oculus) in the mod list — compatibility unknown" : "Not known" };

  // Size and performance
  const modCount = mods && mods.length ? mods.length : null;
  const perf = pick(KNOWN.perf);
  const performance: string[] = [];
  if (perf.length) performance.push(`Includes ${perf.length} performance mod${perf.length === 1 ? "" : "s"} (${names(perf)})`);
  if (cats.has("lightweight") || cats.has("small / light")) performance.push("The author tagged it lightweight");
  if (cats.has("optimization")) performance.push("The author tagged it optimization");
  let complexity: Reading["complexity"];
  if (modCount != null) {
    const level = modCount < 90 ? "light" : modCount < 230 ? "medium" : "heavy";
    complexity = { level, why: `${modCount} mods listed on Modrinth (REWIND's estimate: ${level === "light" ? "small" : level === "medium" ? "mid-sized" : "large"} pack)` };
    if (level === "heavy") performance.push("A large pack: big packs generally load slower and need more memory (a rule of thumb, not measured)");
  } else complexity = { level: cats.has("kitchen-sink") || cats.has("extra large") ? "heavy" : cats.has("lightweight") || cats.has("small / light") ? "light" : "unknown", why: cats.has("kitchen-sink") || cats.has("extra large") ? "The author tagged it as a big kitchen-sink pack" : cats.has("lightweight") || cats.has("small / light") ? "The author tagged it lightweight" : "Mod count unknown" };
  if ((cats.has("lightweight") || cats.has("small / light") || cats.has("optimization") || (modCount != null && modCount < 90)) && !(modCount != null && modCount >= 230)) {
    add("lightweight", modCount != null && modCount < 90 ? 0.9 : 0.6, modCount != null ? "verified" : "author", modCount != null && modCount < 90 ? `Small: ${modCount} mods` : "Tagged lightweight / optimized by the author");
  }
  if (cats.has("kitchen-sink") || cats.has("extra large") || (modCount != null && modCount >= 250)) add("kitchen_sink", modCount != null && modCount >= 250 ? 1 : 0.7, modCount != null && modCount >= 250 ? "verified" : "author", modCount != null && modCount >= 250 ? `${modCount} mods — a bit of everything` : "The author calls it a kitchen-sink pack");

  // Difficulty
  const expertName = /\b(expert|gregtech|greg|terrafirma|tfg|sevtech|hard ?mode)\b/i.test(title);
  const challenging = cats.has("challenging") || cats.has("hardcore");
  let difficulty: Reading["difficulty"];
  if (expertName || (challenging && (quests.state === "verified" || quests.state === "author") && (findings.some((f) => f.signal === "tech")))) {
    difficulty = { level: "expert", evidence: expertName ? "author" : "inferred", why: expertName ? "Its name marks it as an expert / long-progression pack" : "Tagged challenging, with quests and tech: likely expert-style progression" };
    add("expert", 0.8, difficulty.evidence, difficulty.why);
  } else if (challenging || findings.some((f) => f.signal === "hardcore" && f.strength >= 0.5)) {
    difficulty = { level: "hardcore", evidence: challenging ? "author" : "verified", why: challenging ? "The author tagged it challenging / hardcore" : "Includes survival-pressure mods (thirst, temperature, injuries)" };
  } else if ((quests.state === "verified" || quests.state === "author") && (viewer.length || guides.length) && (modCount == null || modCount < 250)) {
    difficulty = { level: "beginner", evidence: "inferred", why: "Has a quest book and in-game help, and isn't tagged challenging — likely approachable" };
  } else if (mods || p.categories.length) difficulty = { level: "standard", evidence: "inferred", why: "Nothing points to an especially easy or hard pack" };
  else difficulty = { level: "unknown", evidence: "inferred", why: "Not enough information" };

  // Maintenance
  const last = d?.latest?.date ?? p.updated;
  const days = ago(last, now);
  let maintenance: Reading["maintenance"];
  if (d?.status === "archived") maintenance = { state: "archived", why: "Archived by its author: no more updates" };
  else if (days == null) maintenance = { state: "unknown", why: "Update date unknown" };
  else {
    const rel = d?.releasesLastYear;
    const relText = rel != null ? `; ${rel} release${rel === 1 ? "" : "s"} in the past year` : "";
    const state = days <= 90 ? "active" : days <= 365 ? "recent" : days <= 730 ? "slow" : "stale";
    maintenance = { state, why: `Last updated ${agoText(days)}${relText}` + (state === "stale" ? " — may be abandoned" : "") };
    add("maintained", state === "active" ? 1 : state === "recent" ? 0.7 : state === "slow" ? 0.3 : 0, "verified", maintenance.why);
  }
  if (p.downloads != null) add("adoption", Math.min(1, Math.log10(Math.max(1, p.downloads)) / 7), "verified", `${p.downloads.toLocaleString("en-US")} downloads on ${p.source === "modrinth" ? "Modrinth" : "CurseForge"}`);

  // Progression style, in words
  const has = (s: Signal) => findings.some((f) => f.signal === s && f.strength >= 0.4);
  const progression = has("quests")
    ? has("expert")
      ? "Long, gated progression guided by a quest book"
      : has("tech")
        ? "Quest-guided, building up to automation"
        : has("adventure") || has("exploration")
          ? "Quest-guided adventure"
          : "Guided by a quest book"
    : has("kitchen_sink")
      ? "Open-ended: set your own goals (no quest book found)"
      : has("adventure") || has("exploration")
        ? "Explore-at-your-own-pace adventure"
        : has("tech")
          ? "Self-directed tech progression"
          : "Not clear from the available data";

  // Labels
  const labels: Reading["labels"] = [];
  const lab = (label: string, s: Signal) => {
    const f = findings.filter((x) => x.signal === s).sort((a, b) => b.strength - a.strength)[0];
    if (f && f.strength >= 0.5) labels.push({ label, evidence: f.evidence, why: f.text });
  };
  lab("Quest-driven", "quests");
  if (difficulty.level === "beginner") labels.push({ label: "Beginner-friendly", evidence: "inferred", why: difficulty.why });
  if (difficulty.level === "expert") labels.push({ label: "Expert", evidence: difficulty.evidence, why: difficulty.why });
  if (difficulty.level === "hardcore") labels.push({ label: "Hardcore", evidence: difficulty.evidence, why: difficulty.why });
  lab("Technical", "tech");
  lab("Magical", "magic");
  lab("Exploration", "exploration");
  lab("Adventure", "adventure");
  lab("Cozy", "cozy");
  lab("Kitchen sink", "kitchen_sink");
  lab("Lightweight", "lightweight");
  lab("Shaders", "shaders");

  // Mods by area (their own Modrinth categories)
  const modsBy: Reading["modsBy"] = [];
  if (mods && mods.length) {
    const L: [string, string][] = [["technology", "Tech"], ["magic", "Magic"], ["worldgen", "World gen"], ["adventure", "Adventure"], ["decoration", "Decoration"], ["food", "Food"], ["storage", "Storage"], ["optimization", "Performance"], ["library", "Libraries"]];
    for (const [c, label] of L) {
      const n = byCat(c).length;
      if (n) modsBy.push({ label, count: n });
    }
  }
  return { findings, labels, difficulty, complexity, performance, shaders, quests, maintenance, progression, modCount, modsBy, authorClaims };
}

// ---------------- fit for you ----------------

export interface PackPrefs {
  /** -1 (avoid) … +1 (want). */
  weights: Record<Signal, number>;
  /** Prefer this Minecraft version / loader (empty = any). */
  mcVersion: string;
  loader: string;
}

/** From your profile: quest books, clear progression, exploration, cozy building, shaders, tech and magic; occasional expert; no aimless kitchen sinks or abandoned packs. */
export const DEFAULT_PACK_PREFS: PackPrefs = {
  weights: {
    quests: 1,
    guidance: 0.8,
    exploration: 0.7,
    cozy: 0.6,
    tech: 0.5,
    magic: 0.5,
    adventure: 0.4,
    shaders: 0.5,
    lightweight: 0.2,
    kitchen_sink: -0.3,
    expert: 0.1,
    hardcore: -0.4,
    maintained: 0.8,
    adoption: 0.15,
  },
  mcVersion: "",
  loader: "",
};

export function normalizePackPrefs(raw: unknown): PackPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PackPrefs>;
  const w = { ...DEFAULT_PACK_PREFS.weights };
  for (const k of Object.keys(w) as Signal[]) {
    const v = Number(r.weights?.[k]);
    if (Number.isFinite(v)) w[k] = Math.max(-1, Math.min(1, v));
  }
  return { weights: w, mcVersion: typeof r.mcVersion === "string" ? r.mcVersion : "", loader: typeof r.loader === "string" ? r.loader : "" };
}

export interface PackFit {
  score: number; // -1..1
  band: "excellent" | "good" | "fair" | "weak";
  pros: { text: string; evidence: Evidence }[];
  cons: { text: string; evidence: Evidence }[];
  unknown: string[];
  /** True when only the search summary was available (no mod list yet). */
  partial: boolean;
}

const CONF: Record<Evidence, number> = { verified: 1, author: 0.7, inferred: 0.5 };

export function packFit(p: PackSummary | PackDetail, prefs: PackPrefs, now = new Date(), reading = readPack(p, now)): PackFit {
  const pros: PackFit["pros"] = [];
  const cons: PackFit["cons"] = [];
  const unknown: string[] = [];
  let num = 0;
  let den = 0;
  const best = new Map<Signal, Finding>();
  for (const f of reading.findings) {
    const cur = best.get(f.signal);
    if (!cur || f.strength * CONF[f.evidence] > cur.strength * CONF[cur.evidence]) best.set(f.signal, f);
  }
  const hasQuests = reading.quests.state === "verified" || reading.quests.state === "author";
  for (const [signal, w] of Object.entries(prefs.weights) as [Signal, number][]) {
    if (!w) continue;
    const f = best.get(signal);
    // A kitchen sink with no quest book is the "hundreds of unrelated objectives" case.
    let weight = w;
    if (signal === "kitchen_sink" && f && !hasQuests && reading.quests.state === "none_found") weight = Math.min(w, -0.9);
    if (signal === "kitchen_sink" && f && hasQuests) weight = w / 3;
    // Adoption is capped: popular is not the same as good.
    if (signal === "adoption") weight = Math.min(Math.abs(w), 0.2) * Math.sign(w);
    den += Math.abs(weight);
    if (!f) {
      if (Math.abs(w) >= 0.5 && signal !== "kitchen_sink" && signal !== "hardcore") unknown.push(SIGNAL_LABEL[signal]);
      continue;
    }
    const c = f.strength * CONF[f.evidence] * weight;
    num += c;
    if (signal === "maintained") {
      if (f.strength >= 0.7) pros.push({ text: `Maintained: ${reading.maintenance.why.toLowerCase()}`, evidence: "verified" });
      else cons.push({ text: reading.maintenance.why, evidence: "verified" });
      continue;
    }
    if (signal === "adoption") continue;
    if (c > 0.05) pros.push({ text: f.text, evidence: f.evidence });
    else if (c < -0.05) cons.push({ text: signal === "kitchen_sink" && !hasQuests ? `${f.text}, and no quest book found — may feel aimless` : f.text, evidence: f.evidence });
  }
  if (reading.maintenance.state === "archived") {
    num -= 0.6;
    cons.unshift({ text: reading.maintenance.why, evidence: "verified" });
  }
  if (reading.quests.state === "none_found" && prefs.weights.quests > 0.4) {
    num -= prefs.weights.quests * 0.5;
    cons.push({ text: "No quest book found in its mod list", evidence: "verified" });
  }
  // Not updated in years: you said you dislike broken or abandoned packs.
  if (reading.maintenance.state === "stale" && prefs.weights.maintained > 0) num -= prefs.weights.maintained * 0.6;
  const disc = (p.disclosures ?? []).filter((x) => /advert|paid|telemetry|ai_content/.test(x));
  if (disc.length) cons.push({ text: `The pack discloses: ${disc.map((x) => x.replace(/_/g, " ")).join(", ")}`, evidence: "verified" });
  if (prefs.mcVersion && p.mcVersions.length && !p.mcVersions.includes(prefs.mcVersion)) {
    num -= 0.3;
    cons.push({ text: `Not available for Minecraft ${prefs.mcVersion}`, evidence: "verified" });
  }
  if (prefs.loader && p.loaders.length && !p.loaders.includes(prefs.loader)) {
    num -= 0.2;
    cons.push({ text: `Uses ${p.loaders.join("/")}, not ${prefs.loader}`, evidence: "verified" });
  }
  const score = den ? Math.max(-1, Math.min(1, (num / den) * 1.8)) : 0;
  const order = (a: { evidence: Evidence }, b: { evidence: Evidence }) => CONF[b.evidence] - CONF[a.evidence];
  return {
    score,
    band: score >= 0.45 ? "excellent" : score >= 0.25 ? "good" : score >= 0.08 ? "fair" : "weak",
    pros: pros.sort(order).slice(0, 6),
    cons: cons.slice(0, 5),
    unknown,
    partial: !("fetchedAt" in p) || (p as PackDetail).mods == null,
  };
}

export { EVIDENCE_LABEL };

// ---------------- comparison ----------------

export interface CompareRow {
  label: string;
  cells: { text: string; evidence?: Evidence; good?: boolean; bad?: boolean }[];
}

const fmtN = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));
const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** Side-by-side rows for 2–4 packs. Missing facts say "unknown", never a guess. */
export function compareRows(packs: (PackSummary | PackDetail)[], prefs: PackPrefs, now = new Date()): { rows: CompareRow[]; fits: PackFit[]; readings: Reading[] } {
  const readings = packs.map((p) => readPack(p, now));
  const fits = packs.map((p, i) => packFit(p, prefs, now, readings[i]));
  const detail = (p: PackSummary | PackDetail) => ("fetchedAt" in p ? (p as PackDetail) : null);
  const bestFit = Math.max(...fits.map((f) => f.score));
  const rows: CompareRow[] = [
    { label: "Fit for you", cells: fits.map((f) => ({ text: `${f.band === "excellent" ? "Excellent" : f.band === "good" ? "Good" : f.band === "fair" ? "Possible" : "Weak"} fit${f.partial ? " (details not loaded)" : ""}`, good: f.score === bestFit && packs.length > 1, evidence: "inferred" as Evidence })) },
    { label: "Source", cells: packs.map((p) => ({ text: p.source === "modrinth" ? "Modrinth" : "CurseForge" })) },
    { label: "Minecraft", cells: packs.map((p) => ({ text: (detail(p)?.latest?.mcVersions ?? p.mcVersions).slice(0, 3).join(", ") || "unknown" })) },
    { label: "Loader", cells: packs.map((p) => ({ text: (detail(p)?.latest?.loaders ?? p.loaders).join(", ") || "unknown" })) },
    { label: "Pack version", cells: packs.map((p) => ({ text: detail(p)?.latest?.number || "load details" })) },
    { label: "Last updated", cells: packs.map((p, i) => ({ text: `${date(detail(p)?.latest?.date ?? p.updated)} · ${readings[i].maintenance.state === "unknown" ? "unknown" : readings[i].maintenance.why.replace(/^Last updated /, "")}`, good: readings[i].maintenance.state === "active", bad: readings[i].maintenance.state === "stale" || readings[i].maintenance.state === "archived" })) },
    { label: "Downloads", cells: packs.map((p) => ({ text: fmtN(p.downloads) })) },
    { label: "Mods", cells: packs.map((p, i) => ({ text: readings[i].modCount != null ? `${readings[i].modCount} on Modrinth` : p.source === "curseforge" ? "not listed by CurseForge" : "load details" })) },
    { label: "Progression", cells: readings.map((r) => ({ text: r.progression, evidence: "inferred" as Evidence })) },
    { label: "Quest book", cells: readings.map((r) => ({ text: r.quests.state === "verified" ? `Yes — ${r.quests.why}` : r.quests.state === "author" ? `Author says yes (${r.quests.why.toLowerCase()})` : r.quests.state === "none_found" ? "None found" : "Unknown", evidence: r.quests.state === "verified" || r.quests.state === "none_found" ? ("verified" as Evidence) : ("author" as Evidence), good: r.quests.state === "verified", bad: r.quests.state === "none_found" })) },
    { label: "Quest quality", cells: readings.map((r) => ({ text: r.authorClaims.length ? `Not judged. Author claims ${r.authorClaims.join(", ")}` : "Not judged (REWIND can't play the pack)", evidence: "author" as Evidence })) },
    { label: "Difficulty", cells: readings.map((r) => ({ text: `${r.difficulty.level === "beginner" ? "Beginner-friendly" : r.difficulty.level[0].toUpperCase() + r.difficulty.level.slice(1)} — ${r.difficulty.why}`, evidence: r.difficulty.evidence })) },
    { label: "Complexity", cells: readings.map((r) => ({ text: r.complexity.level === "unknown" ? r.complexity.why : `${r.complexity.level[0].toUpperCase() + r.complexity.level.slice(1)} — ${r.complexity.why}`, evidence: "inferred" as Evidence })) },
    { label: "Performance", cells: readings.map((r) => ({ text: r.performance.join("; ") || "Nothing known", evidence: "verified" as Evidence })) },
    { label: "Shaders", cells: readings.map((r) => ({ text: r.shaders.why, evidence: r.shaders.state === "included" ? ("verified" as Evidence) : ("inferred" as Evidence), good: r.shaders.state === "included" })) },
    { label: "Style", cells: readings.map((r) => ({ text: r.labels.map((l) => l.label).join(", ") || "—", evidence: "inferred" as Evidence })) },
    { label: "Official page", cells: packs.map((p) => ({ text: p.pageUrl })) },
  ];
  return { rows, fits, readings };
}

/** One or two sentences: which pack fits best, and why. */
export function compareVerdict(packs: (PackSummary | PackDetail)[], fits: PackFit[]): string {
  if (packs.length < 2) return "";
  const order = packs.map((p, i) => ({ p, f: fits[i] })).sort((a, b) => b.f.score - a.f.score);
  const [a, b] = order;
  const why = a.f.pros.slice(0, 2).map((x) => x.text.replace(/\s*\(.*?\)\s*$/, "").toLowerCase());
  const gap = a.f.score - b.f.score;
  const lead = gap < 0.06 ? `${a.p.title} and ${b.p.title} are close.` : `${a.p.title} fits you best.`;
  const tail = why.length ? ` ${a.p.title} ${gap < 0.06 ? "edges ahead on" : "stands out for"}: ${why.join("; ")}.` : "";
  const weak = b.f.cons[0] ? ` ${b.p.title}: ${b.f.cons[0].text.toLowerCase()}.` : "";
  const partial = order.some((x) => x.f.partial) ? " (Some packs' details aren't loaded yet, so this may change.)" : "";
  return lead + tail + weak + partial;
}
