// The modding companion's built-in knowledge: which games it has presets for, the usual
// mod managers and official mod sites for each (links only), and starter backup
// checklists made of general, safe steps. It makes no compatibility claims: those are
// your own notes, optionally with a link to where you read them.

import { canon } from "../lib/canon.ts";
import { literalKey } from "../meta/match.ts";
import type { Game } from "../lib/types.ts";

export interface Link {
  label: string;
  url: string;
}

export interface GamePreset {
  id: string;
  label: string;
  /** Library titles this preset recognises (compared after normalising). */
  titles: string[];
  managers: string[];
  managerLinks: Link[];
  sites: Link[];
  tools: Link[];
  checklist: string[];
  /** Where the game version matters (script extenders, Minecraft versions…). */
  versionHint: string;
}

const NEXUS = (game: string, label = "Nexus Mods"): Link => ({ label, url: `https://www.nexusmods.com/${game}` });
const MO2: Link = { label: "Mod Organizer 2", url: "https://github.com/ModOrganizer2/modorganizer" };
const VORTEX: Link = { label: "Vortex", url: "https://www.nexusmods.com/about/vortex" };
const LOOT: Link = { label: "LOOT (load order)", url: "https://loot.github.io" };
const WRYE: Link = { label: "Wrye Bash", url: "https://github.com/wrye-bash/wrye-bash" };
const XEDIT: Link = { label: "xEdit", url: "https://github.com/TES5Edit/TES5Edit" };

const BETHESDA_CHECKLIST = (savesHint: string) => [
  `Back up your save files (${savesHint})`,
  "Export or copy your mod manager profile / mod list",
  "Write down the game version you're on",
  "In Steam, set the game to 'Only update this game when I launch it' so an update can't surprise you",
  "Back up the game's .ini settings files",
  "Note your load order (or save LOOT's report)",
  "Make one change at a time and test before adding more",
];

export const GAME_PRESETS: GamePreset[] = [
  {
    id: "skyrim_se",
    label: "Skyrim Special / Anniversary Edition",
    titles: ["The Elder Scrolls V: Skyrim Special Edition", "The Elder Scrolls V: Skyrim Anniversary Edition", "Skyrim Special Edition", "Skyrim Anniversary Edition"],
    managers: ["Mod Organizer 2", "Vortex", "Other / manual"],
    managerLinks: [MO2, VORTEX],
    sites: [NEXUS("skyrimspecialedition"), { label: "Bethesda.net Creations", url: "https://creations.bethesda.net" }],
    tools: [LOOT, XEDIT, { label: "SKSE64", url: "https://skse.silverlock.org" }],
    checklist: BETHESDA_CHECKLIST("Documents\\My Games\\Skyrim Special Edition\\Saves"),
    versionHint: "Script-extender mods depend on the exact game version (e.g. 1.6.1170).",
  },
  {
    id: "skyrim_le",
    label: "Skyrim (2011 / Legendary Edition)",
    titles: ["The Elder Scrolls V: Skyrim", "The Elder Scrolls V: Skyrim Legendary Edition", "Skyrim"],
    managers: ["Mod Organizer 2", "Vortex", "Wrye Bash", "Other / manual"],
    managerLinks: [MO2, VORTEX, WRYE],
    sites: [NEXUS("skyrim")],
    tools: [LOOT, XEDIT, { label: "SKSE", url: "https://skse.silverlock.org" }],
    checklist: BETHESDA_CHECKLIST("Documents\\My Games\\Skyrim\\Saves"),
    versionHint: "",
  },
  {
    id: "oblivion",
    label: "Oblivion",
    titles: ["The Elder Scrolls IV: Oblivion", "The Elder Scrolls IV: Oblivion Game of the Year Edition", "The Elder Scrolls IV: Oblivion GOTY Edition Deluxe", "Oblivion"],
    managers: ["Mod Organizer 2", "Wrye Bash", "Vortex", "Other / manual"],
    managerLinks: [MO2, WRYE, VORTEX],
    sites: [NEXUS("oblivion")],
    tools: [LOOT, XEDIT],
    checklist: BETHESDA_CHECKLIST("Documents\\My Games\\Oblivion\\Saves"),
    versionHint: "",
  },
  {
    id: "oblivion_remastered",
    label: "Oblivion Remastered",
    titles: ["The Elder Scrolls IV: Oblivion Remastered", "Oblivion Remastered"],
    managers: ["Mod Organizer 2", "Vortex", "Other / manual"],
    managerLinks: [MO2, VORTEX],
    sites: [NEXUS("oblivionremastered")],
    tools: [],
    checklist: BETHESDA_CHECKLIST("your Oblivion Remastered save folder"),
    versionHint: "",
  },
  {
    id: "morrowind",
    label: "Morrowind",
    titles: ["The Elder Scrolls III: Morrowind", "The Elder Scrolls III: Morrowind Game of the Year Edition", "Morrowind"],
    managers: ["OpenMW Launcher", "Mod Organizer 2", "Wrye Mash", "Other / manual"],
    managerLinks: [{ label: "OpenMW", url: "https://openmw.org" }, MO2],
    sites: [NEXUS("morrowind"), { label: "Modding-OpenMW.com (mod lists & guides)", url: "https://modding-openmw.com" }],
    tools: [],
    checklist: ["Back up your save files", "Back up openmw.cfg / Morrowind.ini (whichever you use)", "Write down your data paths and content-file order", "Make one change at a time and test before adding more"],
    versionHint: "OpenMW or the original engine? Many mods only work with one of them.",
  },
  {
    id: "warband",
    label: "Mount & Blade: Warband",
    titles: ["Mount & Blade: Warband", "Mount and Blade: Warband", "Mount & Blade Warband"],
    managers: ["Modules folder (manual)", "Steam Workshop", "Other"],
    managerLinks: [],
    sites: [NEXUS("mbwarband"), { label: "ModDB", url: "https://www.moddb.com/games/mount-blade-warband" }, { label: "Steam Workshop", url: "https://steamcommunity.com/app/48700/workshop/" }],
    tools: [],
    checklist: ["Back up your save files (Documents\\Mount&Blade Warband Savegames)", "Keep a copy of each mod's module folder before updating it", "Note which module each campaign uses — saves don't move between mods", "Write down the mod's version"],
    versionHint: "Each total-conversion mod is its own module; note its version.",
  },
  {
    id: "fallout3",
    label: "Fallout 3",
    titles: ["Fallout 3", "Fallout 3: Game of the Year Edition", "Fallout 3 GOTY"],
    managers: ["Mod Organizer 2", "Vortex", "Other / manual"],
    managerLinks: [MO2, VORTEX],
    sites: [NEXUS("fallout3")],
    tools: [LOOT, XEDIT],
    checklist: BETHESDA_CHECKLIST("Documents\\My Games\\Fallout3\\Saves"),
    versionHint: "",
  },
  {
    id: "fallout_nv",
    label: "Fallout: New Vegas",
    titles: ["Fallout: New Vegas", "Fallout New Vegas", "Fallout: New Vegas Ultimate Edition"],
    managers: ["Mod Organizer 2", "Vortex", "Other / manual"],
    managerLinks: [MO2, VORTEX],
    sites: [NEXUS("newvegas"), { label: "Viva New Vegas (guide)", url: "https://vivanewvegas.moddinglinked.com" }],
    tools: [LOOT, XEDIT, { label: "xNVSE", url: "https://github.com/xNVSE/NVSE" }],
    checklist: BETHESDA_CHECKLIST("Documents\\My Games\\FalloutNV\\Saves"),
    versionHint: "",
  },
  {
    id: "fallout4",
    label: "Fallout 4",
    titles: ["Fallout 4", "Fallout 4: Game of the Year Edition"],
    managers: ["Mod Organizer 2", "Vortex", "Other / manual"],
    managerLinks: [MO2, VORTEX],
    sites: [NEXUS("fallout4"), { label: "Bethesda.net Creations", url: "https://creations.bethesda.net" }],
    tools: [LOOT, XEDIT, { label: "F4SE", url: "https://f4se.silverlock.org" }],
    checklist: BETHESDA_CHECKLIST("Documents\\My Games\\Fallout4\\Saves"),
    versionHint: "Script-extender mods depend on the exact game version.",
  },
  {
    id: "minecraft",
    label: "Minecraft (Java)",
    titles: ["Minecraft", "Minecraft: Java Edition", "Minecraft Java Edition", "Minecraft: Java & Bedrock Edition"],
    managers: ["Prism Launcher", "Modrinth App", "CurseForge app", "ATLauncher", "FTB App", "Other"],
    managerLinks: [
      { label: "Prism Launcher", url: "https://prismlauncher.org" },
      { label: "Modrinth App", url: "https://modrinth.com/app" },
      { label: "CurseForge app", url: "https://www.curseforge.com/download/app" },
      { label: "ATLauncher", url: "https://atlauncher.com" },
    ],
    sites: [{ label: "Modrinth", url: "https://modrinth.com/modpacks" }, { label: "CurseForge", url: "https://www.curseforge.com/minecraft/modpacks" }],
    tools: [],
    checklist: ["Back up the instance's saves folder", "Export the instance from your launcher (most can export a zip)", "Write down the Minecraft version, loader and pack version", "Don't update a pack mid-world without a backup", "Note how much memory (RAM) the instance is given"],
    versionHint: "Minecraft version + loader (Fabric, Forge, NeoForge, Quilt) + pack version.",
  },
  {
    id: "other",
    label: "Other game",
    titles: [],
    managers: ["Mod Organizer 2", "Vortex", "Steam Workshop", "Manual", "Other"],
    managerLinks: [MO2, VORTEX],
    sites: [{ label: "Nexus Mods", url: "https://www.nexusmods.com" }, { label: "ModDB", url: "https://www.moddb.com" }],
    tools: [],
    checklist: ["Back up your save files", "Write down the game version", "Keep a copy of your mod list", "Make one change at a time and test before adding more"],
    versionHint: "",
  },
];

export const presetById = (id: string): GamePreset => GAME_PRESETS.find((p) => p.id === id) ?? GAME_PRESETS[GAME_PRESETS.length - 1];

/** The preset a library game belongs to, by its title. */
export function presetForGame(g: Pick<Game, "title" | "canon">): GamePreset | null {
  // The exact title first: "Skyrim" and "Skyrim Special Edition" share a normalised title.
  const lit = literalKey(g.title);
  for (const p of GAME_PRESETS) if (p.titles.some((t) => literalKey(t) === lit)) return p;
  const k = g.canon || canon(g.title);
  for (const p of GAME_PRESETS) if (p.titles.some((t) => canon(t) === k)) return p;
  return null;
}

/** Library games that have a preset (offered first when creating a profile). */
export function moddableGames(games: Game[]): { game: Game; preset: GamePreset }[] {
  const out: { game: Game; preset: GamePreset }[] = [];
  for (const g of games) {
    const p = presetForGame(g);
    if (p) out.push({ game: g, preset: p });
  }
  return out.sort((a, b) => a.game.title.localeCompare(b.game.title));
}

// ---------------- mod lists ----------------

export interface ParsedMod {
  name: string;
  url: string;
  enabled: boolean;
  version: string;
}

export interface ParseResult {
  format: "mo2" | "plugins" | "links" | "lines";
  mods: ParsedMod[];
  skipped: number;
}

function nameFromUrl(u: URL): string {
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.host.endsWith("modrinth.com") && parts.length >= 2) return prettySlug(parts[1]);
  if (u.host.endsWith("curseforge.com") && parts.length >= 3) return prettySlug(parts[parts.length - 1]);
  if (u.host.endsWith("nexusmods.com") && parts.length >= 3 && parts[1] === "mods") return `Nexus mod #${parts[2]} (${parts[0]})`;
  return `${u.host}${u.pathname}`.replace(/\/$/, "");
}
const prettySlug = (s: string) => decodeURIComponent(s).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Reads a pasted or opened mod list. Understands:
 *  - Mod Organizer 2 modlist.txt ("+Enabled", "-Disabled", "*Unmanaged" lines)
 *  - plugins.txt / loadorder.txt ("*Plugin.esp" active, "Plugin.esp" inactive)
 *  - lists of links (Nexus, Modrinth, CurseForge…), optionally "Name - https://…"
 *  - plain lines, one mod per line
 * The file is only read. Nothing on disk is changed.
 */
export function parseModList(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  let skipped = 0;
  const isPlugins = lines.length > 0 && lines.filter((l) => /\.(esp|esm|esl)$/i.test(l.replace(/^\*/, ""))).length >= Math.ceil(lines.length * 0.6);
  const isMo2 = !isPlugins && lines.length > 0 && lines.filter((l) => /^[+\-*]\S/.test(l)).length >= Math.ceil(lines.length * 0.6);
  const mods: ParsedMod[] = [];
  const seen = new Set<string>();
  const push = (m: ParsedMod) => {
    const k = (m.url || m.name).toLowerCase();
    if (!m.name || seen.has(k)) {
      skipped++;
      return;
    }
    seen.add(k);
    mods.push(m);
  };
  if (isPlugins) {
    for (const l of lines) push({ name: l.replace(/^\*/, ""), url: "", enabled: l.startsWith("*"), version: "" });
    return { format: "plugins", mods, skipped };
  }
  if (isMo2) {
    for (const l of lines) {
      if (/_separator$/i.test(l)) {
        skipped++;
        continue;
      }
      const flag = l[0];
      const name = l.slice(1).trim();
      if (flag === "*") {
        skipped++; // DLC / unmanaged files: not mods you installed
        continue;
      }
      push({ name, url: "", enabled: flag === "+", version: "" });
    }
    return { format: "mo2", mods, skipped };
  }
  let links = 0;
  for (const l of lines) {
    const m = /(https?:\/\/\S+)/.exec(l);
    if (m) {
      links++;
      let url: URL | null = null;
      try {
        url = new URL(m[1].replace(/[),.]+$/, ""));
      } catch {
        url = null;
      }
      const label = l.replace(m[1], "").replace(/^[\s\-–—:|*•]+|[\s\-–—:|]+$/g, "").trim();
      if (!url || !/^https?:$/.test(url.protocol)) {
        skipped++;
        continue;
      }
      push({ name: label || nameFromUrl(url), url: url.toString(), enabled: true, version: "" });
    } else {
      const vm = /^(.*?)\s+(?:v|version\s*)?(\d+(?:\.\d+){1,3}[a-z0-9.-]*)$/i.exec(l.replace(/^[-*•]\s*/, ""));
      push({ name: (vm ? vm[1] : l.replace(/^[-*•]\s*/, "")).trim(), url: "", enabled: true, version: vm ? vm[2] : "" });
    }
  }
  return { format: links >= Math.ceil(lines.length / 2) ? "links" : "lines", mods, skipped };
}

/** A readable, shareable mod list (Markdown). */
export function exportModList(profile: { name: string; gameTitle: string; manager: string; gameVersion: string; entries: { name: string; url: string; version: string; enabled: boolean; category: string; notes: string }[] }): string {
  const lines = [`# ${profile.name}`, "", `- Game: ${profile.gameTitle || "—"}`, `- Mod manager: ${profile.manager || "—"}`, `- Game version: ${profile.gameVersion || "—"}`, `- Exported from REWIND: ${new Date().toISOString().slice(0, 10)}`, "", "| # | On | Mod | Version | Category | Link | Notes |", "|---|---|---|---|---|---|---|"];
  profile.entries.forEach((e, i) => {
    const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${i + 1} | ${e.enabled ? "✓" : ""} | ${esc(e.name)} | ${esc(e.version)} | ${esc(e.category)} | ${e.url} | ${esc(e.notes)} |`);
  });
  return lines.join("\n") + "\n";
}

/** Mod-site links in a mod list that aren't ones REWIND recognises (shown with a caution). */
export function isKnownModSite(url: string): boolean {
  try {
    const h = new URL(url).host.toLowerCase();
    return /(^|\.)(nexusmods\.com|modrinth\.com|curseforge\.com|moddb\.com|steamcommunity\.com|github\.com|bethesda\.net)$/.test(h);
  } catch {
    return false;
  }
}
