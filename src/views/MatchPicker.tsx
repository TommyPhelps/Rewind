import { useState } from "react";
import { useApp } from "../state/store.tsx";
import { cleanTitle } from "../lib/canon.ts";
import type { Game } from "../lib/types.ts";
import type { Candidate, Provider } from "../meta/types.ts";
import { PROVIDER_LABEL } from "../meta/types.ts";
import { titleScore } from "../meta/match.ts";
import { getStoreItems, storeSearch } from "../meta/steam.ts";
import * as igdb from "../meta/igdb.ts";
import { DEFAULT_SYNC, igdbToken, linkManually, markNoMatch, parseSteamAppInput } from "../meta/sync.ts";
import { toNetError } from "../meta/http.ts";
import { igdbCreds, net, startSync } from "../state/metaSync.ts";

/**
 * Choose what a game is on Steam (or IGDB): one of the candidates, a fresh search,
 * a pasted store link, or "none of these". Nothing is linked until you click.
 */
export function MatchPicker({ game, provider, onDone, compact }: { game: Game; provider: Provider; onDone?(): void; compact?: boolean }) {
  const { repo, run, reloadAll, toast } = useApp();
  const m = game.meta[provider];
  const [cands, setCands] = useState<Candidate[]>(m?.candidates ?? []);
  const [term, setTerm] = useState(cleanTitle(game.title));
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async (ids: string[]) => {
    const creds = await igdbCreds(repo);
    await startSync(repo, { ...DEFAULT_SYNC, gameIds: ids, searchSteam: false, refreshDays: 0, igdb: provider === "igdb" ? creds : null }, reloadAll);
  };

  const choose = async (id: string, name: string) => {
    setBusy("link");
    const ok = await run(async () => {
      await linkManually(repo, game, provider, id, cands);
      await reloadAll();
      return true;
    });
    if (ok) {
      toast(`${cleanTitle(game.title)} linked to ${PROVIDER_LABEL[provider]}: ${cleanTitle(name)}. Fetching details…`);
      onDone?.();
      void refresh([game.id]);
    }
    setBusy(null);
  };

  const search = async () => {
    setBusy("search");
    setErr(null);
    try {
      if (provider === "steam") {
        const hits = await storeSearch(net, term);
        // Every hit is shown (you searched for it), best title match first.
        setCands(
          hits
            .map((h) => ({ id: String(h.appid), name: h.name, score: titleScore(game.title, h.name).score, thumb: h.thumb }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 8),
        );
      } else {
        const c = await igdbCreds(repo);
        if (!c) throw new Error("Add your IGDB Client ID and Secret under Connections first.");
        const tok = await igdbToken(repo, net, c);
        const hits = await igdb.searchGames(net, c, tok, term);
        setCands(hits.map((h) => igdb.toCandidate(h, titleScore(game.title, String(h.name ?? "")).score)).sort((a, b) => b.score - a.score).slice(0, 8));
      }
    } catch (e) {
      setErr(e instanceof Error && !("kind" in e) ? e.message : toNetError(e).message);
    }
    setBusy(null);
  };

  const linkManual = async () => {
    setErr(null);
    if (provider === "steam") {
      const appid = parseSteamAppInput(manual);
      if (!appid) {
        setErr("Paste a Steam store link (store.steampowered.com/app/…) or an app number.");
        return;
      }
      setBusy("manual");
      let name = `Steam app ${appid}`;
      try {
        const items = await getStoreItems(net, [appid], new Map());
        const hit = items.get(appid);
        if (hit) name = hit.name;
      } catch {
        // Offline: link by number anyway; details are fetched on the next sync.
      }
      setBusy(null);
      await choose(String(appid), name);
    } else {
      const id = Number(/(\d+)/.exec(manual)?.[1]);
      if (!Number.isInteger(id) || id <= 0) {
        setErr("Enter the IGDB game id (a number).");
        return;
      }
      await choose(String(id), `IGDB game ${id}`);
    }
  };

  const none = async () => {
    setBusy("none");
    const ok = await run(async () => {
      await markNoMatch(repo, game, provider);
      await reloadAll();
      return true;
    });
    if (ok) {
      toast(`Noted: ${cleanTitle(game.title)} isn't on ${PROVIDER_LABEL[provider]}. It won't be matched automatically.`);
      onDone?.();
    }
    setBusy(null);
  };

  return (
    <div className={"mpick" + (compact ? " compact" : "")}>
      {m?.error && <div className="note" style={{ fontSize: "var(--fs-meta)" }}>{m.error}</div>}
      {cands.length > 0 ? (
        <div className="mp-cands" role="list" aria-label={`${PROVIDER_LABEL[provider]} candidates`}>
          {cands.map((c) => (
            <div key={c.id} className="mp-cand" role="listitem">
              {c.thumb ? <img src={c.thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <span className="nothumb" />}
              <span className="t2">
                <span className="t">{cleanTitle(c.name)}</span>
                <span className="sub mono">
                  {provider === "steam" ? `app ${c.id}` : `igdb ${c.id}`}
                  {c.year ? ` · ${c.year}` : ""} · title match {Math.round(c.score * 100)}%
                </span>
              </span>
              <button className="btn sm" disabled={!!busy} onClick={() => void choose(c.id, c.name)}>This one</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="dim" style={{ fontSize: "var(--fs-meta)" }}>No candidates yet. Search by a different name, or paste a store link.</div>
      )}
      <div className="mp-tools">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className="field grow" value={term} onChange={(e) => setTerm(e.target.value)} aria-label={`Search ${PROVIDER_LABEL[provider]}`} />
          <button className="btn sm" type="submit" disabled={!!busy || !term.trim()}>{busy === "search" ? "Searching…" : "Search"}</button>
        </form>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void linkManual();
          }}
        >
          <input className="field grow" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={provider === "steam" ? "…or paste a Steam store link / app id" : "…or an IGDB game id"} aria-label="Link manually" />
          <button className="btn sm" type="submit" disabled={!!busy || !manual.trim()}>Link</button>
        </form>
        <button className="btn sm ghost" disabled={!!busy} onClick={() => void none()} title="Remembered: it won't be matched automatically again">
          None of these
        </button>
      </div>
      {err && <div className="note bad" style={{ fontSize: "var(--fs-meta)" }}>{err}</div>}
    </div>
  );
}
