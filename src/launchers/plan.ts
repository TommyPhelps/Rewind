// Turning launcher scans into library changes, safely.
//
// The rules (shown on the import preview, too):
//   1. Already known  — a game already has this launcher's id: just refresh "installed" and the path.
//   2. Same title     — the exact same title (ignoring ™, ®, case and punctuation): the launcher is
//                       added to that ONE library entry. A game on Steam and Epic is one game.
//   3. Maybe an edition — titles that only differ by edition words ("Skyrim" vs "Skyrim Special
//                       Edition", "… Remastered", "… Definitive Edition"): kept SEPARATE unless you
//                       choose to combine them. Different editions are often different games.
//   4. New            — added to your library as owned, with this launcher.
// Your rating, notes, status, tags, playtime and favourites are never changed by an import.

import type { Statement } from "../db/driver.ts";
import { newId, nowIso, sourceStatement, type Repo } from "../db/repo.ts";
import { canon } from "../lib/canon.ts";
import { LAUNCHER_LABEL, type Game, type LauncherId } from "../lib/types.ts";
import { literalKey } from "../meta/match.ts";
import type { LauncherScan, ScannedGame } from "./scan.ts";

export type PlanAction =
  | { type: "known"; gameId: string }
  | { type: "link"; gameId: string }
  | { type: "maybe"; gameIds: string[] }
  | { type: "add" }
  | { type: "skip"; why: string };

export interface PlanRow {
  scanned: ScannedGame;
  action: PlanAction;
  /** What you chose (defaults follow the rules above). */
  choice: "link" | "add" | "skip";
  /** For "maybe": which library game to combine with when you choose "link". */
  target: string | null;
}

export interface LauncherPlan {
  rows: PlanRow[];
  /** Library games on these launchers that the scan no longer found installed. */
  noLongerInstalled: { gameId: string; source: LauncherId }[];
  counts: { known: number; link: number; maybe: number; add: number; skip: number };
}

/** Names a library game goes by: its title plus every launcher's name for it. */
function namesOf(g: Game): string[] {
  return [g.title, ...g.sources.map((s) => s.title).filter(Boolean), ...(g.meta.steam?.data?.name ? [g.meta.steam.data.name] : [])];
}

export function buildLauncherPlan(games: Game[], scans: LauncherScan[]): LauncherPlan {
  const byExt = new Map<string, Game>();
  const byLiteral = new Map<string, Game[]>();
  const byCanon = new Map<string, Game[]>();
  for (const g of games) {
    for (const s of g.sources) if (s.externalId) byExt.set(`${s.source}:${s.externalId.toLowerCase()}`, g);
    for (const n of new Set(namesOf(g).map(literalKey))) (byLiteral.get(n) ?? byLiteral.set(n, []).get(n)!).push(g);
    const c = canon(g.title);
    (byCanon.get(c) ?? byCanon.set(c, []).get(c)!).push(g);
  }
  const rows: PlanRow[] = [];
  const found = new Set<string>();
  const claimed = new Set<string>(); // one scanned title per game and launcher
  for (const scan of scans) {
    for (const sg of scan.games) {
      let action: PlanAction;
      const known = byExt.get(`${sg.source}:${sg.externalId.toLowerCase()}`);
      const lit = (byLiteral.get(literalKey(sg.title)) ?? []).filter((g, i, a) => a.indexOf(g) === i);
      const can = (byCanon.get(canon(sg.title)) ?? []).filter((g) => !lit.includes(g));
      if (!sg.isGame) action = { type: "skip", why: "Looks like a tool or launcher, not a game" };
      else if (known) action = { type: "known", gameId: known.id };
      else if (lit.length === 1) action = { type: "link", gameId: lit[0].id };
      else if (lit.length > 1) action = { type: "maybe", gameIds: lit.map((g) => g.id) };
      else if (can.length) action = { type: "maybe", gameIds: can.map((g) => g.id) };
      else action = { type: "add" };
      // Never attach two different scanned titles from one launcher to the same game.
      const gid = action.type === "known" || action.type === "link" ? action.gameId : null;
      if (gid && action.type === "link") {
        const k = `${sg.source}:${gid}`;
        if (claimed.has(k) || games.find((g) => g.id === gid)?.sources.some((s) => s.source === sg.source && s.externalId && s.externalId.toLowerCase() !== sg.externalId.toLowerCase())) {
          action = { type: "maybe", gameIds: [gid] };
        } else claimed.add(k);
      }
      if (gid) found.add(`${sg.source}:${gid}`);
      const choice = action.type === "skip" ? "skip" : action.type === "maybe" ? "add" : action.type === "add" ? "add" : "link";
      rows.push({ scanned: sg, action, choice, target: action.type === "maybe" ? action.gameIds[0] : gid });
    }
  }
  const scanned = new Set(scans.filter((s) => s.detected && !s.error).map((s) => s.source));
  const noLongerInstalled: LauncherPlan["noLongerInstalled"] = [];
  for (const g of games) for (const s of g.sources) if (scanned.has(s.source) && s.installed && !found.has(`${s.source}:${g.id}`)) noLongerInstalled.push({ gameId: g.id, source: s.source });
  return { rows, noLongerInstalled, counts: countRows(rows) };
}

export function countRows(rows: PlanRow[]): LauncherPlan["counts"] {
  const c = { known: 0, link: 0, maybe: 0, add: 0, skip: 0 };
  for (const r of rows) c[r.action.type]++;
  return c;
}

export interface ApplySummary {
  linked: number;
  added: number;
  refreshed: number;
  skipped: number;
  uninstalled: number;
}

/** Everything in one transaction. Only launcher rows and new games are written. */
export function launcherStatements(repo: Repo, plan: LauncherPlan, now = nowIso()): { stmts: Statement[]; summary: ApplySummary } {
  const stmts: Statement[] = [];
  const sum: ApplySummary = { linked: 0, added: 0, refreshed: 0, skipped: 0, uninstalled: 0 };
  for (const r of plan.rows) {
    const sg = r.scanned;
    const src = { source: sg.source, externalId: sg.externalId, title: sg.title, installed: true, installPath: sg.installPath, launch: sg.launch, method: "local_scan", lastSeenAt: now };
    if (r.choice === "skip") {
      sum.skipped++;
      continue;
    }
    if (r.choice === "link" && r.target) {
      stmts.push(sourceStatement(r.target, src, now));
      if (r.action.type === "known") sum.refreshed++;
      else sum.linked++;
      continue;
    }
    const id = newId();
    stmts.push(
      repo.insertStatement("games", {
        id,
        title: sg.title,
        canon: canon(sg.title),
        platform: "PC",
        storefront: LAUNCHER_LABEL[sg.source],
        ownership: "owned",
        install_status: "installed",
        status: "backlog",
        meta_source: "{}",
        created_at: now,
        updated_at: now,
      }),
    );
    stmts.push(sourceStatement(id, src, now));
    stmts.push(repo.eventStatement("game_added", id, { title: sg.title, from: sg.source }, now));
    sum.added++;
  }
  for (const n of plan.noLongerInstalled) {
    stmts.push({ sql: `UPDATE game_sources SET installed = 0 WHERE game_id = ? AND source = ?`, params: [n.gameId, n.source] });
    sum.uninstalled++;
  }
  stmts.push(repo.eventStatement("launcher_import", null, { ...sum, sources: [...new Set(plan.rows.map((r) => r.scanned.source))] }, now));
  return { stmts, summary: sum };
}
