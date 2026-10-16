// The Phase 3 parts of the details panel: banner art, "About" (facts with their sources),
// playtime by source, and where the data comes from (links you can change or remove).

import { useEffect, useState } from "react";
import { useApp } from "../state/store.tsx";
import { Icon } from "../ui/Icon.tsx";
import { fmtDate } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { fmtPlaytime } from "../lib/library.ts";
import type { Game } from "../lib/types.ts";
import { artSrc, openExternal, pickCoverImage } from "../platform/native.ts";
import { DEFAULT_SYNC, markNoMatch, resetLink } from "../meta/sync.ts";
import { resetCoverStatements } from "../meta/apply.ts";
import { PROVIDER_LABEL, type MetaData, type Provider } from "../meta/types.ts";
import { STEAM_SOURCE_LABEL, type SteamSource } from "../meta/steamImport.ts";
import { igdbCreds, net, startSync, useSyncState } from "../state/metaSync.ts";
import { MatchPicker } from "./MatchPicker.tsx";

/** Wide header art (Steam's library hero, else the store header), downloaded once and cached. */
export function Banner({ game }: { game: Game }) {
  const { repo, reloadAll } = useApp();
  const s = game.meta.steam?.status === "linked" ? game.meta.steam : null;
  const art = s?.data?.art;
  const file = art?.hero?.file ?? art?.header?.file;
  const [bad, setBad] = useState(false);

  // The hero image is large, so it's only fetched for games you actually open.
  useEffect(() => {
    if (!s || !art?.hero || art.hero.file || !s.providerId) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const f = await net.download(art.hero!.url, `steam-${s.providerId}-hero`);
        if (!alive) return;
        const data: MetaData = { ...s.data!, art: { ...s.data!.art, hero: { ...art.hero!, file: f.file } } };
        await repo.saveMeta([{ ...s, data, updatedAt: new Date().toISOString() }]);
        await reloadAll();
      } catch {
        // Offline or no hero image: the store header (or nothing) is shown instead.
      }
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [s?.providerId, art?.hero?.url, art?.hero?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  const src = artSrc(file);
  if (!src || bad) return null;
  return (
    <div className="dbanner" aria-hidden="true">
      <img src={src} alt="" onError={() => setBad(true)} />
    </div>
  );
}

const firstData = (g: Game): { d: MetaData; p: Provider } | null => {
  if (g.meta.steam?.status === "linked" && g.meta.steam.data) return { d: g.meta.steam.data, p: "steam" };
  if (g.meta.igdb?.status === "linked" && g.meta.igdb.data) return { d: g.meta.igdb.data, p: "igdb" };
  return null;
};

function Src({ p }: { p: Provider | "user" }) {
  return <span className={"srcmark s-" + p} title={p === "user" ? "Your value" : p === "steam" ? "Steam store" : "IGDB.com"}>{p === "user" ? "you" : p === "steam" ? "Steam" : "IGDB"}</span>;
}

export function AboutSection({ game: g }: { game: Game }) {
  const s = g.meta.steam?.status === "linked" ? g.meta.steam.data : null;
  const i = g.meta.igdb?.status === "linked" ? g.meta.igdb.data : null;
  const first = firstData(g);
  const [more, setMore] = useState(false);
  if (!first) {
    return (
      <details className="sec" open>
        <summary>About</summary>
        <div className="body">
          <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
            No store details yet. {g.steamAppId ? "Run “Update details & covers” on the Steam & metadata screen." : "Link this game under “Sources & artwork” below, or run a sync from the Steam & metadata screen."}
          </div>
        </div>
      </details>
    );
  }
  const desc = s?.description ?? i?.description;
  const descSrc: Provider = s?.description ? "steam" : "igdb";
  const date = s?.releaseDate ?? i?.releaseDate;
  const devs = s?.developers.length ? s.developers : i?.developers ?? [];
  const pubs = s?.publishers.length ? s.publishers : i?.publishers ?? [];
  const platforms = s?.platforms.length ? s.platforms : i?.platforms ?? [];
  const features = s?.features.length ? s.features : i?.features ?? [];
  const tags = (s?.tags ?? []).slice().sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 12);
  const genres = i?.genres ?? [];
  const ttb = i?.timeToBeat;
  const appid = g.meta.steam?.providerId;
  return (
    <details className="sec" open>
      <summary>
        About <span className="right dim mono" style={{ fontSize: "var(--fs-xs)" }}>from {[s && "Steam", i && "IGDB"].filter(Boolean).join(" + ")}</span>
      </summary>
      <div className="body">
        {desc && (
          <p className={"about-desc" + (more ? " open" : "")} onClick={() => setMore(true)}>
            {desc} <Src p={descSrc} />
          </p>
        )}
        <dl className="kv facts">
          {(g.releaseYear || date) && (
            <>
              <dt>Released</dt>
              <dd>{g.releaseYear && g.metaSource.releaseYear === "user" ? <>{g.releaseYear} <Src p="user" /></> : <>{date ? fmtDate(date) : g.releaseYear} <Src p={s?.releaseDate ? "steam" : "igdb"} /></>}</dd>
            </>
          )}
          {(g.developer || devs.length > 0) && (
            <>
              <dt>Developer</dt>
              <dd>{g.developer ? <>{g.developer} <Src p="user" /></> : <>{devs.join(", ")} <Src p={s?.developers.length ? "steam" : "igdb"} /></>}</dd>
            </>
          )}
          {(g.publisher || pubs.length > 0) && (
            <>
              <dt>Publisher</dt>
              <dd>{g.publisher ? <>{g.publisher} <Src p="user" /></> : <>{pubs.join(", ")} <Src p={s?.publishers.length ? "steam" : "igdb"} /></>}</dd>
            </>
          )}
          {s?.franchises && s.franchises.length > 0 && (
            <>
              <dt>Franchise</dt>
              <dd>{s.franchises.join(", ")} <Src p="steam" /></dd>
            </>
          )}
          {features.length > 0 && (
            <>
              <dt>Players</dt>
              <dd>{features.join(" · ")} <Src p={s?.features.length ? "steam" : "igdb"} /></dd>
            </>
          )}
          {platforms.length > 0 && (
            <>
              <dt>Platforms</dt>
              <dd>{platforms.join(", ")} <Src p={s?.platforms.length ? "steam" : "igdb"} /></dd>
            </>
          )}
          {genres.length > 0 && (
            <>
              <dt>Genres</dt>
              <dd>{genres.join(", ")} <Src p="igdb" /></dd>
            </>
          )}
          {ttb && (
            <>
              <dt>Time to beat</dt>
              <dd>
                {[ttb.main && `rushed ~${ttb.main}h`, ttb.extras && `normal ~${ttb.extras}h`, ttb.complete && `100% ~${ttb.complete}h`].filter(Boolean).join(" · ")}{" "}
                <span className="dim" style={{ fontSize: "var(--fs-xs)" }}>({ttb.count ?? "a few"} players reported, IGDB)</span>
              </dd>
            </>
          )}
        </dl>
        {tags.length > 0 && (
          <div className="steamtags" aria-label="Steam user tags">
            <span className="mono dim" style={{ fontSize: "var(--fs-xs)" }}>Steam user tags</span>
            <div className="chips">
              {tags.map((t) => (
                <span key={t.name} className="chip stag" title={t.weight ? `${t.weight} votes` : undefined}>{t.name}</span>
              ))}
            </div>
          </div>
        )}
        <div className="row links">
          {appid && <button className="btn sm" onClick={() => void openExternal(`https://store.steampowered.com/app/${appid}/`)}>Steam store ↗</button>}
          {i?.pageUrl && /^https:\/\/www\.igdb\.com\//.test(i.pageUrl) && <button className="btn sm" onClick={() => void openExternal(i.pageUrl!)}>IGDB ↗</button>}
          <button className="btn sm ghost" onClick={() => void openExternal(`https://howlongtobeat.com/?q=${encodeURIComponent(cleanTitle(g.title))}`)}>HowLongToBeat ↗</button>
        </div>
        <div className="dim attrib">
          {s && <>Store data: Steam{g.meta.steam?.fetchedAt ? `, ${fmtDate(g.meta.steam.fetchedAt)}` : ""}. </>}
          {i && <>Game data from IGDB.com{g.meta.igdb?.fetchedAt ? `, ${fmtDate(g.meta.igdb.fetchedAt)}` : ""}. </>}
          Shown as provided; your own edits always win.
        </div>
      </div>
    </details>
  );
}

/** Steam's figure and the old app's figure, side by side with where each came from. */
export function PlaytimeRows({ game: g }: { game: Game }) {
  const src = g.metaSource.steamPlaytime as SteamSource | undefined;
  return (
    <>
      <dt>Steam playtime</dt>
      <dd className="num">
        {g.steamPlaytimeMin != null ? (
          <>
            {fmtPlaytime(g.steamPlaytimeMin)}{" "}
            <span className="dim" style={{ fontSize: "var(--fs-s)" }}>
              ({src ? STEAM_SOURCE_LABEL[src] : "Steam"}{g.steamSyncedAt ? `, ${fmtDate(g.steamSyncedAt)}` : ""}{g.steamLastPlayed ? `; last played ${g.steamLastPlayed}` : ""})
            </span>
          </>
        ) : (
          <span className="dim">not imported</span>
        )}
      </dd>
      <dt>Old REWIND playtime</dt>
      <dd className="num">{g.importedPlaytimeMin != null ? fmtPlaytime(g.importedPlaytimeMin) : <span className="dim">—</span>}</dd>
    </>
  );
}

export function SourcesSection({ game: g }: { game: Game }) {
  const { repo, run, reloadAll, toast, updateGame } = useApp();
  const sync = useSyncState();
  const [picking, setPicking] = useState<Provider | null>(null);
  const [hasIgdb, setHasIgdb] = useState(false);
  useEffect(() => {
    void igdbCreds(repo).then((c) => setHasIgdb(Boolean(c)));
  }, [repo]);

  const refresh = async () => {
    const creds = await igdbCreds(repo);
    const r = await startSync(repo, { ...DEFAULT_SYNC, gameIds: [g.id], refreshDays: 0, igdb: creds }, reloadAll);
    if (r) toast(r.outcome === "complete" ? `${cleanTitle(g.title)}: ${r.message}` : r.message, r.outcome === "error");
  };

  const ownCover = async () => {
    const f = await run(() => pickCoverImage(`user-${g.id.slice(0, 18)}-${Date.now().toString(36)}`));
    if (f) {
      await updateGame(g.id, { coverPath: f.file });
      toast("Your cover is used for this game. Syncs won't replace it.");
    }
  };

  const providers: Provider[] = hasIgdb || g.meta.igdb ? ["steam", "igdb"] : ["steam"];
  const coverMine = g.metaSource.coverPath === "user";
  return (
    <details className="sec" open={!g.meta.steam || g.meta.steam.status !== "linked"}>
      <summary>Sources &amp; artwork</summary>
      <div className="body">
        {providers.map((p) => {
          const m = g.meta[p];
          const status = !m ? "not looked up yet" : m.status === "linked" ? `linked${m.providerId ? ` (${p === "steam" ? "app" : "id"} ${m.providerId})` : ""}` : m.status === "review" ? "needs you to pick a match" : m.status === "none" ? (m.method === "user" ? "you said it isn't there" : "not found") : "couldn't be fetched";
          const how = m?.status === "linked" ? ({ steam_import: "from your Steam library", steam_id: "by Steam app id", search: "exact title match", exact_title: "exact title match", user: "chosen by you" } as Record<string, string>)[m.method ?? ""] ?? "" : "";
          return (
            <div key={p} className="srcrow">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <b>{PROVIDER_LABEL[p]}</b> <span className="dim">· {status}{how ? ` · ${how}` : ""}</span>
                  {m?.status === "linked" && m.data?.name && cleanTitle(m.data.name) !== cleanTitle(g.title) && <span className="dim"> · listed as “{cleanTitle(m.data.name)}”</span>}
                </span>
              </div>
              {m?.error && <div className="note" style={{ fontSize: "var(--fs-s)" }}>{m.error}</div>}
              <div className="row">
                <button className="btn sm" onClick={() => setPicking(picking === p ? null : p)} aria-expanded={picking === p}>
                  {m?.status === "linked" ? "Change match…" : "Find match…"}
                </button>
                {m?.status === "linked" && (
                  <button
                    className="btn sm ghost"
                    onClick={async () => {
                      await run(async () => {
                        await markNoMatch(repo, g, p);
                        await reloadAll();
                      });
                      toast(`Unlinked from ${PROVIDER_LABEL[p]}. Its tags and cover were removed; your own data is unchanged.`);
                    }}
                  >
                    Unlink
                  </button>
                )}
                {m && m.status !== "linked" && (
                  <button
                    className="btn sm ghost"
                    title="Forget this result so the next sync looks it up again"
                    onClick={async () => {
                      await run(async () => {
                        await resetLink(repo, g, p);
                        await reloadAll();
                      });
                    }}
                  >
                    Look up again
                  </button>
                )}
              </div>
              {picking === p && <MatchPicker game={g} provider={p} compact onDone={() => setPicking(null)} />}
            </div>
          );
        })}
        <div className="row">
          <button className="btn sm" disabled={sync.running} onClick={() => void refresh()} title="Fetch this game's store details and cover again">
            <Icon name="download" /> {sync.running && sync.scope === "games" ? "Refreshing…" : "Refresh details & cover"}
          </button>
        </div>
        <div className="srcrow">
          <div>
            <b>Cover</b>{" "}
            <span className="dim">
              · {coverMine ? "your own picture" : g.metaSource.cover ? `${g.metaSource.cover.startsWith("steam") ? "Steam" : "IGDB"}${g.metaSource.cover.endsWith("landscape") ? " store header (no portrait cover exists)" : ""}` : "none yet"}
            </span>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => void ownCover()}>Use my own image…</button>
            {coverMine && (
              <button
                className="btn sm ghost"
                onClick={async () => {
                  await run(async () => {
                    await repo.batch(resetCoverStatements(g));
                    await reloadAll();
                  });
                }}
              >
                Use the store cover again
              </button>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
