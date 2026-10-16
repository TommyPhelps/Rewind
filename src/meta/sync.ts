// Metadata sync: links games to Steam (and optionally IGDB), fetches store data in
// batches, caches artwork, then turns the result into small, reversible changes
// (see apply.ts). Nothing here changes your title, status, rating, notes or own tags.
//
// Safety and honesty rules:
//  - A game is linked automatically only on an exact (or same-core-title) match with no
//    equally good rival. Everything else goes to the review queue with its candidates.
//  - Progress is saved game by game, so cancelling, closing the app or losing the
//    connection never loses what was already fetched.
//  - If the internet is unreachable, the run stops with status "offline"; no game is
//    marked as failed because of it.

import type { Statement } from "../db/driver.ts";
import { nowIso, type Repo } from "../db/repo.ts";
import { cleanTitle } from "../lib/canon.ts";
import type { Game } from "../lib/types.ts";
import { applyStatements, unlinkStatements } from "./apply.ts";
import { NetError, toNetError, type Net } from "./http.ts";
import * as igdb from "./igdb.ts";
import { autoPick, literalKey, rankCandidates } from "./match.ts";
import { fallbackArt, getStoreItems, getTagList, storeSearch, type TagNames } from "./steam.ts";
import type { Art, Candidate, MetaData, MetaRecord, Provider } from "./types.ts";

export type SyncPhase = "prepare" | "link" | "steam" | "igdb" | "art" | "apply" | "done";
export type SyncOutcome = "complete" | "cancelled" | "offline" | "rate_limited" | "error";

export interface SyncCounts {
  linked: number;
  review: number;
  noMatch: number;
  fetched: number;
  igdbLinked: number;
  covers: number;
  failed: number;
}

export interface SyncProgress {
  phase: SyncPhase;
  done: number;
  total: number;
  current: string;
  counts: SyncCounts;
}

export interface SyncResult {
  outcome: SyncOutcome;
  message: string;
  counts: SyncCounts;
  touched: string[];
  finishedAt: string;
}

export interface SyncOptions {
  /** Only these games (e.g. "Refresh" on one game). Default: the whole library. */
  gameIds?: string[];
  /** Look up Steam app ids by title for games that don't have one. */
  searchSteam: boolean;
  /** Re-fetch store data older than this many days. 0 = always. */
  refreshDays: number;
  downloadArt: boolean;
  igdb: igdb.IgdbCreds | null;
}

export const DEFAULT_SYNC: SyncOptions = { searchSteam: true, refreshDays: 30, downloadArt: true, igdb: null };

export interface ArtFs {
  /** Which cached files are missing on disk. */
  missing(files: string[]): Promise<string[]>;
}

const BATCH = 25;
const ART_CONCURRENCY = 4;

const emptyCounts = (): SyncCounts => ({ linked: 0, review: 0, noMatch: 0, fetched: 0, igdbLinked: 0, covers: 0, failed: 0 });

export function blankMeta(gameId: string, provider: Provider, patch: Partial<MetaRecord> = {}): MetaRecord {
  return {
    gameId,
    provider,
    providerId: null,
    status: "none",
    method: null,
    confidence: null,
    data: null,
    candidates: [],
    rejected: [],
    error: null,
    fetchedAt: null,
    updatedAt: nowIso(),
    ...patch,
  };
}

/** Stops a whole run (as opposed to one game failing). */
const fatalKinds = new Set(["offline", "cancelled", "rate_limited"]);

export class MetaSync {
  private counts = emptyCounts();
  private touched = new Set<string>();
  private phase: SyncPhase = "prepare";
  private repo: Repo;
  private net: Net;
  private opts: SyncOptions;
  private onProgress: (p: SyncProgress) => void;
  private signal?: AbortSignal;
  private artFs?: ArtFs;

  constructor(
    repo: Repo,
    net: Net,
    opts: SyncOptions,
    onProgress: (p: SyncProgress) => void = () => undefined,
    signal?: AbortSignal,
    artFs?: ArtFs,
  ) {
    this.repo = repo;
    this.net = net;
    this.opts = opts;
    this.onProgress = onProgress;
    this.signal = signal;
    this.artFs = artFs;
  }

  private report(done: number, total: number, current = "") {
    this.onProgress({ phase: this.phase, done, total, current, counts: { ...this.counts } });
  }

  private checkCancel() {
    if (this.signal?.aborted) throw new NetError("cancelled", "Cancelled.");
  }

  private async games(): Promise<Game[]> {
    const all = await this.repo.loadGames();
    if (!this.opts.gameIds) return all;
    const want = new Set(this.opts.gameIds);
    return all.filter((g) => want.has(g.id));
  }

  async run(): Promise<SyncResult> {
    let outcome: SyncOutcome = "complete";
    let message = "";
    try {
      await this.ensureSteamRecords();
      if (this.opts.searchSteam) await this.linkSteam();
      await this.fetchSteam();
      if (this.opts.igdb) {
        try {
          await this.runIgdb(this.opts.igdb);
        } catch (e) {
          const err = toNetError(e);
          if (err.kind !== "auth") throw err;
          message = "IGDB refused the Client ID or Secret, so IGDB was skipped. ";
        }
      }
      if (this.opts.downloadArt) await this.fetchArt();
    } catch (e) {
      const err = toNetError(e);
      outcome = err.kind === "cancelled" ? "cancelled" : err.kind === "offline" || err.kind === "timeout" ? "offline" : err.kind === "rate_limited" ? "rate_limited" : "error";
      message +=
        outcome === "cancelled"
          ? "Stopped. Everything fetched so far is saved."
          : outcome === "offline"
            ? "Couldn't reach the internet. Everything fetched so far is saved; run it again when you're online."
            : outcome === "rate_limited"
              ? "Steam asked REWIND to slow down. Everything so far is saved; try again in a few minutes."
              : err.message;
    } finally {
      // Whatever happened, turn what was fetched into tags, player modes, lengths and covers.
      this.phase = "apply";
      await this.applyTouched();
    }
    this.phase = "done";
    this.report(1, 1);
    const result: SyncResult = { outcome, message: message.trim() || summary(this.counts), counts: { ...this.counts }, touched: [...this.touched], finishedAt: nowIso() };
    await this.repo.batch([this.repo.eventStatement("metadata_sync", null, { outcome, ...this.counts })]).catch(() => undefined);
    return result;
  }

  // ---------- Steam ----------

  /** Games that already carry a Steam app id (from an import or a backup) get a linked record. */
  private async ensureSteamRecords() {
    this.phase = "prepare";
    const games = await this.games();
    const recs: MetaRecord[] = [];
    for (const g of games) {
      if (g.steamAppId == null) continue;
      const m = g.meta.steam;
      if (m && m.providerId === String(g.steamAppId) && m.status === "linked") continue;
      recs.push(blankMeta(g.id, "steam", { ...(m ?? {}), providerId: String(g.steamAppId), status: "linked", method: m?.method ?? "steam_id", confidence: 1, candidates: [], error: null }));
    }
    await this.repo.saveMeta(recs);
  }

  private async linkSteam() {
    this.phase = "link";
    const games = await this.games();
    const used = new Map<number, string>();
    for (const g of await this.repo.loadGames()) if (g.steamAppId != null) used.set(g.steamAppId, g.id);
    // Titles that normalise to the same thing in your library ("GTA V Legacy" / "GTA V Enhanced")
    // are only linked automatically on a literal title match.
    const canonCount = new Map<string, number>();
    for (const g of await this.repo.loadGames()) canonCount.set(g.canon, (canonCount.get(g.canon) ?? 0) + 1);
    const todo = games.filter((g) => {
      if (g.steamAppId != null) return false;
      const m = g.meta.steam;
      if (!m) return true;
      if (m.method === "user" || m.status === "linked" || m.status === "review") return false; // your decision, or waiting for it
      return m.status === "error" || Boolean(this.opts.gameIds); // retry failures; "not found" only when you refresh that game
    });
    for (let i = 0; i < todo.length; i++) {
      this.checkCancel();
      const g = todo[i];
      this.report(i, todo.length, cleanTitle(g.title));
      let hits;
      try {
        hits = await storeSearch(this.net, searchTerm(g.title), this.signal);
      } catch (e) {
        const err = toNetError(e);
        if (fatalKinds.has(err.kind) || err.kind === "timeout") throw err;
        this.counts.failed++;
        await this.repo.saveMeta([blankMeta(g.id, "steam", { status: "error", error: err.message })]);
        continue;
      }
      let pick = autoPick(g.title, hits);
      if (pick && (canonCount.get(g.canon) ?? 0) > 1 && literalKey(pick.item.name) !== literalKey(g.title)) pick = null;
      const ranked = rankCandidates(g.title, hits).slice(0, 5);
      const candidates: Candidate[] = ranked.map((r) => ({ id: String(r.item.appid), name: r.item.name, score: r.match.score, thumb: r.item.thumb }));
      if (pick && !used.has(pick.item.appid)) {
        used.set(pick.item.appid, g.id);
        await this.repo.saveMeta(
          [blankMeta(g.id, "steam", { providerId: String(pick.item.appid), status: "linked", method: "search", confidence: pick.match.score, candidates })],
          [{ sql: `UPDATE games SET steam_app_id = ?, updated_at = ? WHERE id = ? AND steam_app_id IS NULL`, params: [pick.item.appid, nowIso(), g.id] }],
        );
        this.counts.linked++;
        this.touched.add(g.id);
      } else if (candidates.length && candidates[0].score >= 0.5) {
        const note = pick && used.has(pick.item.appid) ? "The best match is already linked to another game in your library." : null;
        await this.repo.saveMeta([blankMeta(g.id, "steam", { status: "review", candidates, error: note })]);
        this.counts.review++;
      } else {
        await this.repo.saveMeta([blankMeta(g.id, "steam", { status: "none", method: "search", candidates })]);
        this.counts.noMatch++;
      }
    }
    this.report(todo.length, todo.length);
  }

  private async tagNames(): Promise<TagNames> {
    const cached = await this.repo.getCache<[number, string][]>("steam_tag_names", 30);
    if (cached?.length) return new Map(cached);
    const names = await getTagList(this.net, this.signal);
    if (names.size) await this.repo.setCache("steam_tag_names", [...names]);
    return names;
  }

  private stale(m: MetaRecord | undefined): boolean {
    if (!m || !m.data || !m.fetchedAt) return true;
    if (this.opts.refreshDays <= 0 || this.opts.gameIds) return true;
    return Date.now() - Date.parse(m.fetchedAt) > this.opts.refreshDays * 86_400_000;
  }

  private async fetchSteam() {
    this.phase = "steam";
    const games = (await this.games()).filter((g) => g.steamAppId != null && g.meta.steam?.status === "linked" && this.stale(g.meta.steam));
    if (!games.length) return;
    const names = await this.tagNames();
    for (let i = 0; i < games.length; i += BATCH) {
      this.checkCancel();
      const chunk = games.slice(i, i + BATCH);
      this.report(i, games.length, cleanTitle(chunk[0].title));
      const items = await getStoreItems(this.net, chunk.map((g) => g.steamAppId!), names, this.signal);
      const recs: MetaRecord[] = [];
      for (const g of chunk) {
        const m = g.meta.steam!;
        const data = items.get(g.steamAppId!);
        if (data) {
          data.art = keepFiles(m.data?.art, data.art);
          recs.push({ ...m, data, error: null, fetchedAt: nowIso(), updatedAt: nowIso() });
          this.counts.fetched++;
          this.touched.add(g.id);
        } else {
          // Linked, but Steam has no visible store page (delisted, tool, or region-locked). Keep any older data.
          recs.push({ ...m, error: "Steam has no store page for this app right now (it may have been removed from sale).", fetchedAt: nowIso(), updatedAt: nowIso() });
          this.counts.failed++;
        }
      }
      await this.repo.saveMeta(recs);
    }
    this.report(games.length, games.length);
  }

  // ---------- IGDB (optional) ----------

  private igdbToken(c: igdb.IgdbCreds): Promise<igdb.IgdbToken> {
    return igdbToken(this.repo, this.net, c, this.signal);
  }

  private async runIgdb(c: igdb.IgdbCreds) {
    this.phase = "igdb";
    const games = (await this.games()).filter((g) => {
      const m = g.meta.igdb;
      if (!m) return true;
      if (m.method === "user" && m.status !== "linked") return false; // you said "no match"
      if (m.status === "review") return false;
      if (m.status === "linked") return this.stale(m);
      return Boolean(this.opts.gameIds); // "none"/"error": only retried when you refresh that game
    });
    if (!games.length) return;
    const tok = await this.igdbToken(c);
    for (let i = 0; i < games.length; i++) {
      this.checkCancel();
      const g = games[i];
      this.report(i, games.length, cleanTitle(g.title));
      try {
        await this.igdbOne(c, tok, g);
      } catch (e) {
        const err = toNetError(e);
        if (fatalKinds.has(err.kind) || err.kind === "auth" || err.kind === "timeout") throw err;
        this.counts.failed++;
        await this.repo.saveMeta([blankMeta(g.id, "igdb", { ...(g.meta.igdb ?? {}), status: "error", error: err.message, updatedAt: nowIso() })]);
      }
    }
    this.report(games.length, games.length);
  }

  private async igdbOne(c: igdb.IgdbCreds, tok: igdb.IgdbToken, g: Game) {
    const prev = g.meta.igdb;
    let id: number | null = prev?.status === "linked" && prev.providerId ? Number(prev.providerId) : null;
    let method = prev?.method ?? null;
    let confidence = prev?.confidence ?? null;
    let found: Record<string, unknown> | null = null;
    let candidates: Candidate[] = [];
    if (id == null) {
      const hits = await igdb.searchGames(this.net, c, tok, g.title, this.signal);
      const rejected = new Set(prev?.rejected ?? []);
      const usable = hits.filter((h) => !rejected.has(String(h.id)));
      const ranked = rankCandidates(g.title, usable.map((h) => ({ name: String(h.name ?? ""), h })));
      candidates = ranked.slice(0, 5).map((r) => igdb.toCandidate(r.item.h, r.match.score));
      // Strongest evidence: IGDB lists this game's own Steam app id.
      const bySteam = g.steamAppId != null ? usable.find((h) => igdb.hasSteamId(h, g.steamAppId!)) : undefined;
      const pick = bySteam ? null : autoPick(g.title, usable.map((h) => ({ name: String(h.name ?? ""), h })));
      if (bySteam) {
        found = bySteam;
        method = "steam_id";
        confidence = 1;
      } else if (pick) {
        found = pick.item.h;
        method = "exact_title";
        confidence = pick.match.score;
      }
      if (!found) {
        const status = candidates.length && candidates[0].score >= 0.5 ? "review" : "none";
        await this.repo.saveMeta([blankMeta(g.id, "igdb", { status, method: "search", candidates, rejected: prev?.rejected ?? [] })]);
        if (status === "review") this.counts.review++;
        else this.counts.noMatch++;
        return;
      }
      id = Number(found.id);
    } else {
      found = await igdb.gameById(this.net, c, tok, id, this.signal);
      if (!found) {
        await this.repo.saveMeta([{ ...prev!, error: "IGDB no longer has this game.", updatedAt: nowIso() }]);
        this.counts.failed++;
        return;
      }
    }
    const data = igdb.parseGame(found as Record<string, any>);
    data.timeToBeat = await igdb.timeToBeat(this.net, c, tok, id, this.signal);
    data.art = keepFiles(prev?.data?.art, data.art);
    await this.repo.saveMeta([
      blankMeta(g.id, "igdb", { providerId: String(id), status: "linked", method, confidence, data, candidates, rejected: prev?.rejected ?? [], fetchedAt: nowIso() }),
    ]);
    this.counts.igdbLinked++;
    this.touched.add(g.id);
  }

  // ---------- artwork ----------

  private async fetchArt() {
    this.phase = "art";
    const games = await this.games();
    // Files that should exist but don't (e.g. a backup restored on another PC) are fetched again.
    const referenced = games.flatMap((g) => [g.meta.steam, g.meta.igdb].flatMap((m) => Object.values(m?.data?.art ?? {}).flatMap((a) => (a?.file ? [a.file] : []))));
    const missing = new Set(this.artFs && referenced.length ? await this.artFs.missing(referenced) : []);
    type Job = { g: Game; provider: Provider; slot: "cover" | "header"; art: Art; name: string; fallback?: string };
    const jobs: Job[] = [];
    for (const g of games) {
      const s = g.meta.steam;
      const i = g.meta.igdb;
      const sArt = s?.status === "linked" ? s.data?.art : undefined;
      const iArt = i?.status === "linked" ? i.data?.art : undefined;
      const need = (a?: Art) => a && (!a.file || missing.has(a.file));
      const appid = s?.providerId;
      if (sArt && appid) {
        if (need(sArt.cover)) jobs.push({ g, provider: "steam", slot: "cover", art: sArt.cover!, name: `steam-${appid}-cover`, fallback: fallbackArt(Number(appid)).cover });
        if (need(sArt.header)) jobs.push({ g, provider: "steam", slot: "header", art: sArt.header!, name: `steam-${appid}-header` });
      } else if (appid && s?.status === "linked" && !s.data) {
        // Linked but Steam gave no store data: the classic image paths often still work.
        const fb = fallbackArt(Number(appid));
        jobs.push({ g, provider: "steam", slot: "cover", art: { url: fb.cover, kind: "portrait" }, name: `steam-${appid}-cover` });
      }
      // IGDB's cover only when Steam has no portrait cover for this game.
      if (iArt?.cover && need(iArt.cover) && !(sArt?.cover && (sArt.cover.file || need(sArt.cover)))) {
        jobs.push({ g, provider: "igdb", slot: "cover", art: iArt.cover, name: `igdb-${i!.providerId}-cover` });
      }
    }
    let done = 0;
    const results = new Map<string, { provider: Provider; slot: "cover" | "header"; art: Art | null }[]>();
    const worker = async (queue: Job[]) => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        this.checkCancel();
        this.report(done, jobs.length, cleanTitle(j.g.title));
        let art: Art | null = null;
        for (const url of [j.art.url, j.fallback].filter(Boolean) as string[]) {
          try {
            const f = await this.net.download(url, j.name, this.signal);
            art = { url, kind: j.art.kind, file: f.file };
            break;
          } catch (e) {
            const err = toNetError(e);
            if (fatalKinds.has(err.kind)) throw err;
            // 404 or not an image: try the fallback, otherwise leave this slot empty.
          }
        }
        if (art && j.slot === "cover") this.counts.covers++;
        if (!results.has(j.g.id)) results.set(j.g.id, []);
        results.get(j.g.id)!.push({ provider: j.provider, slot: j.slot, art });
        done++;
      }
    };
    const queue = [...jobs];
    try {
      await Promise.all(Array.from({ length: Math.min(ART_CONCURRENCY, queue.length) }, () => worker(queue)));
    } finally {
      await this.saveArt(results);
    }
    this.report(jobs.length, jobs.length);
  }

  private async saveArt(results: Map<string, { provider: Provider; slot: "cover" | "header"; art: Art | null }[]>) {
    if (!results.size) return;
    const current = new Map((await this.repo.loadGames()).map((g) => [g.id, g]));
    const recs: MetaRecord[] = [];
    for (const [gameId, list] of results) {
      const g = current.get(gameId);
      if (!g) continue;
      for (const provider of ["steam", "igdb"] as Provider[]) {
        const m = g.meta[provider];
        const mine = list.filter((x) => x.provider === provider);
        if (!m || !mine.length) continue;
        const data: MetaData = m.data ?? emptyData(provider, g.title);
        const art = { ...data.art };
        for (const x of mine) {
          if (x.art) art[x.slot] = x.art;
          else if (art[x.slot]) art[x.slot] = { ...art[x.slot]!, file: undefined };
        }
        recs.push({ ...m, data: { ...data, art }, updatedAt: nowIso() });
      }
      this.touched.add(gameId);
    }
    await this.repo.saveMeta(recs);
  }

  // ---------- apply ----------

  private async applyTouched() {
    if (!this.touched.size) return;
    const games = (await this.repo.loadGames()).filter((g) => this.touched.has(g.id));
    let stmts: Statement[] = [];
    for (let i = 0; i < games.length; i++) {
      stmts.push(...applyStatements(games[i]));
      if (stmts.length > 400) {
        await this.repo.batch(stmts);
        stmts = [];
      }
      this.report(i, games.length);
    }
    if (stmts.length) await this.repo.batch(stmts);
  }
}

/** A cached Twitch app token (kept in the local secrets table), or a fresh one. */
export async function igdbToken(repo: Repo, net: Net, c: igdb.IgdbCreds, signal?: AbortSignal): Promise<igdb.IgdbToken> {
  const raw = await repo.getSecret("igdb_token");
  if (raw) {
    try {
      const t = JSON.parse(raw) as igdb.IgdbToken & { clientId?: string };
      if (t.expiresAt > Date.now() + 60_000 && t.clientId === c.clientId.trim()) return t;
    } catch {
      // fall through to a fresh token
    }
  }
  const t = await igdb.getToken(net, c, signal);
  await repo.setSecret("igdb_token", JSON.stringify({ ...t, clientId: c.clientId.trim() }));
  return t;
}

function emptyData(provider: Provider, title: string): MetaData {
  return { name: title, developers: [], publishers: [], genres: [], tags: [], features: [], platforms: [], art: {}, attribution: provider === "steam" ? "Steam store" : "IGDB.com" };
}

/** Keeps already-downloaded files when the image URL hasn't changed. */
export function keepFiles(old: MetaData["art"] | undefined, fresh: MetaData["art"]): MetaData["art"] {
  const out: MetaData["art"] = { ...fresh };
  for (const k of ["cover", "header", "hero"] as const) {
    const o = old?.[k];
    const n = fresh[k];
    if (o?.file && n && sameImage(o.url, n.url)) out[k] = { ...n, file: o.file };
    else if (o?.file && !n) out[k] = o; // provider stopped listing it: keep the copy you have
  }
  return out;
}

/** Same image if only the cache-busting "?t=" differs. */
function sameImage(a: string, b: string): boolean {
  return a.split("?")[0] === b.split("?")[0];
}

export function searchTerm(title: string): string {
  return cleanTitle(title)
    .replace(/\((19|20)\d\d\)/g, "")
    .replace(/\s*-\s*(Game of the Year|GOTY|Definitive|Enhanced|Complete|Collector's|Anniversary)( Edition)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function summary(c: SyncCounts): string {
  const parts = [
    c.linked && `${c.linked} newly linked to Steam`,
    c.fetched && `${c.fetched} updated from the Steam store`,
    c.igdbLinked && `${c.igdbLinked} from IGDB`,
    c.covers && `${c.covers} covers downloaded`,
    c.review && `${c.review} need you to pick a match`,
    c.noMatch && `${c.noMatch} not found`,
    c.failed && `${c.failed} couldn't be fetched`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") + "." : "Everything was already up to date.";
}

// ---------- your decisions in the review queue ----------

/** Link a game to a provider entry you chose. Clears any automatic tags from an earlier link. */
export async function linkManually(repo: Repo, g: Game, provider: Provider, providerId: string, candidates: Candidate[] = []): Promise<void> {
  const t = nowIso();
  const extra: Statement[] = [];
  if (provider === "steam") {
    const appid = Number(providerId);
    const owner = (await repo.driver.select<{ id: string; title: string }>(`SELECT id, title FROM games WHERE steam_app_id = ? AND id <> ?`, [appid, g.id]))[0];
    if (owner) throw new Error(`Steam app ${appid} is already linked to "${cleanTitle(owner.title)}". Unlink it there first.`);
    extra.push({ sql: `UPDATE games SET steam_app_id = ?, updated_at = ? WHERE id = ?`, params: [appid, t, g.id] });
  }
  const same = g.meta[provider]?.providerId === providerId;
  await repo.saveMeta(
    [blankMeta(g.id, provider, { providerId, status: "linked", method: "user", confidence: 1, candidates, rejected: g.meta[provider]?.rejected ?? [], data: same ? g.meta[provider]!.data : null, fetchedAt: same ? g.meta[provider]!.fetchedAt : null, updatedAt: t })],
    extra,
  );
}

/** "None of these": remembered, so the automatic search won't link it again. */
export async function markNoMatch(repo: Repo, g: Game, provider: Provider): Promise<void> {
  const m = g.meta[provider];
  const rejected = [...new Set([...(m?.rejected ?? []), ...(m?.candidates ?? []).map((c) => c.id), ...(m?.providerId ? [m.providerId] : [])])];
  await repo.saveMeta([blankMeta(g.id, provider, { status: "none", method: "user", rejected, candidates: m?.candidates ?? [] })], m?.status === "linked" ? unlinkStatements(g, provider) : []);
}

/** Forget a provider for this game entirely (it will be looked up again on the next sync). */
export async function resetLink(repo: Repo, g: Game, provider: Provider): Promise<void> {
  await repo.batch([...(g.meta[provider]?.status === "linked" ? unlinkStatements(g, provider) : []), { sql: `DELETE FROM game_meta WHERE game_id = ? AND provider = ?`, params: [g.id, provider] }]);
}

/** Accepts "32370", "https://store.steampowered.com/app/32370/…" or "steam://…/32370". */
export function parseSteamAppInput(raw: string): number | null {
  const s = raw.trim();
  const m = /store\.steampowered\.com\/app\/(\d+)/i.exec(s) ?? /steamcommunity\.com\/app\/(\d+)/i.exec(s) ?? /^(\d{1,9})$/.exec(s) ?? /steam:\/\/\w+\/(\d+)/i.exec(s);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
