// Add a game: type its name, REWIND searches Steam (and IGDB when connected), you pick the
// right entry — the edition matters, so several close matches are never guessed between —
// and its details and artwork are filled in. Offline, it's added by title and can be
// looked up later. Your own fields are never overwritten by store data.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { Icon } from "../ui/Icon.tsx";
import { canon, cleanTitle } from "../lib/canon.ts";
import { LAUNCHERS, OWNERSHIP, STATUSES, type LauncherId, type Ownership, type Status } from "../lib/types.ts";
import { titleScore } from "../meta/match.ts";
import { storeSearch } from "../meta/steam.ts";
import * as igdb from "../meta/igdb.ts";
import { DEFAULT_SYNC, igdbToken, linkManually } from "../meta/sync.ts";
import { toNetError } from "../meta/http.ts";
import type { Candidate, Provider } from "../meta/types.ts";
import { igdbCreds, net, startSync } from "../state/metaSync.ts";
import { steamLaunch } from "../launchers/launch.ts";

interface Hit extends Candidate {
  provider: Provider;
}

const SEARCH_DAYS = 7;

export function AddGameDialog({ initialTitle, onClose, onAdded, onOpenExisting }: { initialTitle: string; onClose(): void; onAdded(id: string): void; onOpenExisting(id: string): void }) {
  const { repo, games, run, reloadAll, toast } = useApp();
  const [term, setTerm] = useState(initialTitle);
  const [title, setTitle] = useState(initialTitle);
  const [titleEdited, setTitleEdited] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null); // "steam:400" | "igdb:123" | "none"
  const [status, setStatus] = useState<Status>("backlog");
  const [ownership, setOwnership] = useState<Ownership>("owned");
  const [where, setWhere] = useState<LauncherId | "">("");
  const [busy, setBusy] = useState(false);
  const [hasIgdb, setHasIgdb] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    void igdbCreds(repo).then((c) => setHasIgdb(!!c));
  }, [repo]);

  // Search as you type (paced; results are cached for a week so retyping costs nothing).
  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) {
      setHits([]);
      setErr(null);
      return;
    }
    const my = ++seq.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setErr(null);
      const out: Hit[] = [];
      const problems: string[] = [];
      try {
        const key = `search:steam:${t.toLowerCase()}`;
        let steam = await repo.getCache<{ appid: number; name: string; thumb: string | null }[]>(key, SEARCH_DAYS);
        if (!steam) {
          steam = await storeSearch(net, t);
          await repo.setCache(key, steam);
        }
        for (const h of steam.slice(0, 10)) out.push({ provider: "steam", id: String(h.appid), name: h.name, score: titleScore(t, h.name).score, thumb: h.thumb });
      } catch (e) {
        problems.push(`Steam: ${toNetError(e).message}`);
      }
      const c = await igdbCreds(repo);
      if (c) {
        try {
          const key = `search:igdb:${t.toLowerCase()}`;
          let found = await repo.getCache<Candidate[]>(key, SEARCH_DAYS);
          if (!found) {
            const tok = await igdbToken(repo, net, c);
            found = (await igdb.searchGames(net, c, tok, t)).map((g) => igdb.toCandidate(g, 0));
            await repo.setCache(key, found);
          }
          for (const h of found.slice(0, 8)) out.push({ ...h, provider: "igdb", score: titleScore(t, h.name).score });
        } catch (e) {
          problems.push(`IGDB: ${toNetError(e).message}`);
        }
      }
      if (my !== seq.current) return;
      out.sort((a, b) => b.score - a.score || (a.provider === "steam" ? -1 : 1));
      setHits(out);
      setErr(problems.length && !out.length ? problems.join(" · ") : null);
      setSearching(false);
      // Pre-select only when exactly one result is an exact match; otherwise you choose.
      const exact = out.filter((h) => h.score >= 0.999);
      const exactSteam = exact.filter((h) => h.provider === "steam");
      setPick((cur) => (cur && cur !== "none" && out.some((h) => `${h.provider}:${h.id}` === cur) ? cur : exactSteam.length === 1 ? `steam:${exactSteam[0].id}` : exact.length === 1 ? `${exact[0].provider}:${exact[0].id}` : null));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [term, repo]);

  const chosen = pick && pick !== "none" ? hits.find((h) => `${h.provider}:${h.id}` === pick) ?? null : null;
  useEffect(() => {
    if (!titleEdited) setTitle(chosen ? cleanTitle(chosen.name) : term);
  }, [chosen, term, titleEdited]);

  const close = hits.filter((h) => h.score >= 0.9);
  const editions = close.length > 1;
  const dup = useMemo(() => {
    const k = canon(title);
    return k ? games.find((g) => g.canon === k) : undefined;
  }, [title, games]);
  const steamOwner = chosen?.provider === "steam" ? games.find((g) => g.steamAppId === Number(chosen.id)) : undefined;

  const add = async () => {
    const t = title.trim();
    if (!t || steamOwner) return;
    setBusy(true);
    const id = await run(async () => {
      const g = await repo.addGame({ title: t, status, ownership, platform: "PC", storefront: where ? LAUNCHERS.find((l) => l.id === where)!.label : null });
      if (chosen) await linkManually(repo, g, chosen.provider, chosen.id, hits.filter((h) => h.provider === chosen.provider));
      if (where) {
        const appid = chosen?.provider === "steam" ? chosen.id : "";
        await repo.setSource(g.id, { source: where, externalId: where === "steam" ? appid : "", title: t, launch: where === "steam" && appid ? steamLaunch(appid) : null, method: "manual" });
      }
      return g.id;
    });
    if (!id) {
      setBusy(false);
      return;
    }
    await reloadAll();
    onAdded(id);
    if (chosen) {
      const creds = await igdbCreds(repo);
      const r = await startSync(repo, { ...DEFAULT_SYNC, gameIds: [id], searchSteam: chosen.provider !== "steam", refreshDays: 0, igdb: creds }, reloadAll);
      toast(r ? (r.outcome === "complete" ? `Added ${t} with its details and artwork.` : `Added ${t}. ${r.message}`) : `Added ${t}. Details will be fetched when the current lookup finishes.`);
    } else toast(`Added ${t}.`);
  };

  return (
    <Modal
      title="Add a game"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="meta">{chosen ? `Details and artwork from ${chosen.provider === "steam" ? "Steam" : "IGDB"}` : "Added by title only"}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void add()} disabled={!title.trim() || busy || !!steamOwner || (hits.length > 0 && pick == null)}>
            {busy ? "Adding…" : "Add game"}
          </button>
        </>
      }
    >
      <div className="search lg">
        <Icon name="search" />
        <input className="field" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Game name" aria-label="Search for a game" autoFocus />
      </div>

      {dup && (
        <div className="note info row">
          <span className="grow">
            <b>{cleanTitle(dup.title)}</b> is already in your library. Add this only if it's a different game or edition.
          </span>
          <button className="btn sm" onClick={() => onOpenExisting(dup.id)}>
            Open it
          </button>
        </div>
      )}

      {term.trim().length >= 2 && (
        <div className="stack tight">
          <div className="row">
            <span className="meta">{searching ? "Searching…" : hits.length ? `${hits.length} results from Steam${hasIgdb ? " and IGDB" : ""}` : err ? "" : "No results"}</span>
            {editions && <span className="meta">· several close matches — pick the edition you have</span>}
          </div>
          {err && <div className="note">Couldn't search right now ({err}). You can still add it by title; details can be looked up later.</div>}
          {hits.length > 0 && (
            <div className="mp-cands" role="radiogroup" aria-label="Which game is it?" style={{ maxHeight: "21rem", overflowY: "auto" }}>
              {hits.map((h) => {
                const key = `${h.provider}:${h.id}`;
                return (
                  <label key={key} className={"mp-cand" + (h.provider === "igdb" ? " portrait" : "")} aria-selected={pick === key} style={{ cursor: "pointer" }}>
                    {h.thumb ? <img src={h.thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <span className="nothumb" />}
                    <span className="t2">
                      <span className="t">{cleanTitle(h.name)}</span>
                      <span className="sub">
                        {h.provider === "steam" ? `Steam · app ${h.id}` : `IGDB${h.year ? ` · ${h.year}` : ""}`}
                        {h.score >= 0.999 ? " · exact title" : h.score >= 0.9 ? " · same title, other edition wording" : ""}
                      </span>
                    </span>
                    <input type="radio" name="pick" checked={pick === key} onChange={() => setPick(key)} aria-label={`${cleanTitle(h.name)} on ${h.provider}`} />
                  </label>
                );
              })}
              <label className="mp-cand" aria-selected={pick === "none"} style={{ cursor: "pointer" }}>
                <span className="nothumb" />
                <span className="t2">
                  <span className="t">None of these</span>
                  <span className="sub">Add it by title; you can link a store page later</span>
                </span>
                <input type="radio" name="pick" checked={pick === "none"} onChange={() => setPick("none")} aria-label="None of these" />
              </label>
            </div>
          )}
          {steamOwner && <div className="note bad">That Steam game is already in your library as “{cleanTitle(steamOwner.title)}”.</div>}
        </div>
      )}

      <div className="form2">
        <label className="lbl">
          Title in your library
          <input
            className="field"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleEdited(true);
            }}
          />
        </label>
        <label className="lbl">
          Status
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Ownership
          <select className="select" value={ownership} onChange={(e) => setOwnership(e.target.value as Ownership)}>
            {OWNERSHIP.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Where you have it
          <select className="select" value={where} onChange={(e) => setWhere(e.target.value as LauncherId | "")}>
            <option value="">Not sure / doesn't matter</option>
            {LAUNCHERS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
      </div>
      {where === "steam" && chosen?.provider === "steam" && <span className="meta">“Play” will start it through Steam.</span>}
    </Modal>
  );
}
