// Export of what REWIND 4's Mods & Modpacks section held: modding profiles (mod lists,
// notes, checklists, playthroughs) and saved modpacks. Nothing here is shown in the app any
// more, so this is how you take it with you. It's also always included in full backups.

import type { Repo } from "../db/repo.ts";
import type { Mark } from "../discover/marks.ts";
import type { ModProfile } from "./moddingTypes.ts";

export interface LegacyModding {
  profiles: ModProfile[];
  packs: Mark[];
}

export async function loadLegacyModding(repo: Repo): Promise<LegacyModding> {
  const [profiles, marks] = await Promise.all([repo.loadModProfiles(), repo.loadMarks()]);
  return { profiles, packs: marks.filter((m) => m.key.startsWith("mr:") || m.key.startsWith("cf:")) };
}

export const hasLegacyModding = (l: LegacyModding) => l.profiles.length > 0 || l.packs.length > 0;

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const ANSWER: Record<string, string> = { interested: "Interested", want: "Want to try", wishlist: "Wishlisted", played: "Played", not_interested: "Not interested" };

/** A readable Markdown document with everything, in your own words. */
export function legacyModdingMarkdown(l: LegacyModding, gameTitle: (id: string | null) => string | null, now = new Date()): string {
  const out: string[] = [`# REWIND modding records`, "", `Exported ${now.toISOString().slice(0, 10)} from REWIND. These came from the Mods & Modpacks section of REWIND 4.`, ""];
  for (const p of l.profiles) {
    out.push(`## ${p.name}`, "");
    out.push(`- Game: ${gameTitle(p.gameId) ?? (p.gameTitle || "—")}`);
    if (p.manager) out.push(`- Mod manager / launcher: ${p.manager}`);
    if (p.gameVersion) out.push(`- Game version: ${p.gameVersion}`);
    out.push(`- Status: ${p.status}`);
    if (p.packKey) out.push(`- Based on modpack: ${p.packKey}`);
    out.push("");
    if (p.notes.trim()) out.push("### Setup notes", "", p.notes.trim(), "");
    if (p.entries.length) {
      out.push("### Mods", "", "| # | On | Mod | Version | Category | Link | Notes |", "|---|---|---|---|---|---|---|");
      p.entries.forEach((e, i) => out.push(`| ${i + 1} | ${e.enabled ? "✓" : ""} | ${esc(e.name)} | ${esc(e.version)} | ${esc(e.category)} | ${e.url} | ${esc(e.notes)} |`));
      out.push("");
    }
    if (p.modNotes.length) {
      out.push("### Notes", "");
      for (const n of p.modNotes) {
        out.push(`- **${n.title || n.kind}** (${n.kind}, ${n.status})${n.mods.length ? ` — ${n.mods.join(", ")}` : ""}`);
        if (n.body.trim()) out.push(`  ${n.body.trim().replace(/\n/g, "\n  ")}`);
        if (n.sourceUrl) out.push(`  Source: ${n.sourceUrl}`);
      }
      out.push("");
    }
    if (p.checklist.length) {
      out.push("### Backup checklist", "");
      for (const c of p.checklist) out.push(`- [${c.doneAt ? "x" : " "}] ${c.text}`);
      out.push("");
    }
    if (p.runs.length) {
      out.push("### Playthroughs", "");
      for (const r of p.runs) out.push(`- ${r.name || "(unnamed)"} — ${r.status}${r.startedAt ? `, started ${r.startedAt}` : ""}${r.endedAt ? `, ended ${r.endedAt}` : ""}${r.notes ? `: ${r.notes}` : ""}`);
      out.push("");
    }
  }
  if (l.packs.length) {
    out.push("## Saved modpacks", "", "| Pack | Your answer | Saved | Page |", "|---|---|---|---|");
    for (const m of l.packs) {
      const url = typeof m.snapshot.pageUrl === "string" ? m.snapshot.pageUrl : "";
      out.push(`| ${esc(m.title)} | ${ANSWER[m.kind] ?? m.kind} | ${m.updatedAt.slice(0, 10)} | ${url} |`);
    }
    out.push("");
  }
  return out.join("\n");
}
