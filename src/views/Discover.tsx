// Discover answers one question: what interesting games are there for me?
// Choose a shelf; covers carry no labels. Select one to see why it's there and answer.
// Games you've finished, dropped or turned down aren't pushed again, and series stay in order.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import { useTaste } from "../state/recs.ts";
import { cancelBeyond, loadBeyond, loadDiscoverPrefs, runBeyond, saveDiscoverPrefs, useBeyond } from "../state/discover.ts";
import { net } from "../state/metaSync.ts";
import { cleanTitle } from "../lib/canon.ts";
import { OWNERSHIP, STATUSES, type Ownership, type Status } from "../lib/types.ts";
import { releaseYear } from "../lib/library.ts";
import { buildDiscover, CATEGORIES, categoryCounts, discoverCategory, savedItems, snapshotOf, type DiscoverItem, type DiscoverModel } from "../discover/engine.ts";
import { BEYOND_MAX_AGE_DAYS, basisChanged, IGDB_IMG, type ExtGame } from "../discover/beyond.ts";
import { DEFAULT_DISCOVER_PREFS, ERA_PLATFORMS, SCOPE_LABEL, type CategoryId, type DiscoverPrefs, type Scope } from "../discover/prefs.ts";
import { gameKey, hiddenUntil, isHidden, MARK_LABEL, MARKS, type Mark, type MarkKind } from "../discover/marks.ts";
import { addExtToLibrary } from "../discover/addToLibrary.ts";
import { BAND_LABEL } from "../rec/engine.ts";
import { Cover, fmtDate, fmtDay, StatusPill } from "../ui/bits.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { artSrc, openExternal } from "../platform/native.ts";
import type { Nav } from "../App.tsx";

type Shelf = "foryou" | CategoryId | "outside" | "saved" | "hidden";

const coverUrl = (e: ExtGame | null) => (e?.coverId ? `${IGDB_IMG}/t_cover_big/${e.coverId}.jpg` : null);

/** Your cached art for library games; IGDB's image (or a saved copy) for games you don't own. */
function DCover({ item, eager }: { item: { game: DiscoverItem["game"]; ext: ExtGame | null; snapshot?: Record<string, unknown> }; eager?: boolean }) {
  const [bad, setBad] = useState(false);
  if (!item.ext && !item.snapshot) return <Cover game={item.game} eager={eager} />;
  const file = typeof item.snapshot?.coverFile === "string" ? artSrc(item.snapshot.coverFile) : null;
  const url = file ?? coverUrl(item.ext) ?? (typeof item.snapshot?.coverUrl === "string" ? item.snapshot.coverUrl : null);
  if (url && !bad) {
    return (
      <div className="cover">
        <img src={url} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBad(true)} />
      </div>
    );
  }
  return <Cover game={{ ...item.game, coverPath: null }} eager={eager} />;
}

function Card({ item, selected, onSelect }: { item: DiscoverItem; selected: boolean; onSelect(): void }) {
  return (
    <button className="tile-btn" aria-pressed={selected} onClick={onSelect} data-key={item.key} title={cleanTitle(item.game.title)}>
      <DCover item={item} />
      <span className="tb-t">{cleanTitle(item.game.title)}</span>
    </button>
  );
}

/** "For you": the best of every shelf, each game once, alternating shelves so it isn't all one kind. */
function forYou(model: DiscoverModel, shelves: CategoryId[], scope: Scope, limit = 30): DiscoverItem[] {
  const lists = shelves.map((id) => {
    const r = discoverCategory(model, id, { library: 12, beyond: 8 });
    return scope === "mixed" ? [...r.library, ...r.beyond].sort((a, b) => b.score - a.score) : [...r.library, ...r.beyond];
  });
  const seen = new Set<string>();
  const out: DiscoverItem[] = [];
  for (let round = 0; out.length < limit && lists.some((l) => l.length > round); round++) {
    for (const l of lists) {
      const x = l[round];
      if (x && !seen.has(x.key)) {
        seen.add(x.key);
        out.push(x);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

/** "Outside my library": everything from IGDB across shelves, once each, best first. */
function outside(model: DiscoverModel, shelves: CategoryId[]): DiscoverItem[] {
  const m = new Map<string, DiscoverItem>();
  for (const id of shelves) for (const x of discoverCategory(model, id).beyond) if (!m.has(x.key) || m.get(x.key)!.score < x.score) m.set(x.key, x);
  return [...m.values()].sort((a, b) => b.score - a.score);
}

export function DiscoverView({ nav }: { nav: Nav }) {
  const app = useApp();
  const { repo, games, profile, recEvents, marks, settings, setMark, clearMark, run, toast } = app;
  const { taste, series } = useTaste();
  const beyond = useBeyond();
  const [prefs, setPrefsState] = useState<DiscoverPrefs>(DEFAULT_DISCOVER_PREFS);
  const [shelf, setShelf] = useState<Shelf>("foryou");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [editPrefs, setEditPrefs] = useState(false);
  const [adding, setAdding] = useState<{ ext: ExtGame; title: string } | null>(null);
  const allowEst = settings.useUnverifiedLengths;

  useEffect(() => {
    void loadDiscoverPrefs(repo).then(setPrefsState);
    void loadBeyond(repo);
    void repo.getSetting<Shelf>("discover_shelf", "foryou").then((p) => setShelf(p));
  }, [repo]);
  const choose = (p: Shelf) => {
    setShelf(p);
    setSelKey(null);
    void repo.setSetting("discover_shelf", p).catch(() => undefined);
  };
  const setPrefs = (p: DiscoverPrefs) => {
    setPrefsState(p);
    void run(() => saveDiscoverPrefs(repo, p));
  };

  const model = useMemo(
    () => buildDiscover({ games, taste, events: recEvents, profile, series, prefs, marks, beyond: beyond.cache, allowUnverified: allowEst }),
    [games, taste, recEvents, profile, series, prefs, marks, beyond.cache, allowEst],
  );
  const visible = useMemo(() => prefs.order.filter((id) => !prefs.hidden.includes(id)), [prefs]);
  const counts = useMemo(() => categoryCounts(model, visible), [model, visible]);
  const saved = useMemo(() => savedItems(model), [model]);
  const hidden = useMemo(() => [...marks.values()].filter((m) => m.kind === "not_interested" && !m.key.startsWith("mr:") && !m.key.startsWith("cf:")), [marks]);
  const showBeyond = prefs.scope !== "library";

  const current = useMemo(() => {
    if (shelf === "foryou") return { lib: forYou(model, visible, prefs.scope), ext: [] as DiscoverItem[], notes: [] as string[], blurb: "The best of every shelf, one of each" };
    if (shelf === "outside") return { lib: [] as DiscoverItem[], ext: outside(model, visible), notes: [] as string[], blurb: "Games you don't own that fit your taste, from IGDB" };
    if (shelf === "saved" || shelf === "hidden") return null;
    const r = discoverCategory(model, shelf);
    return { lib: r.library, ext: showBeyond ? r.beyond : [], notes: r.notes, blurb: r.def.blurb, how: r.def.how };
  }, [shelf, model, visible, prefs.scope, showBeyond]);

  const flat = current ? [...current.lib, ...current.ext] : [];
  const selected: DiscoverItem | null = useMemo(() => {
    if (!selKey) return null;
    const hit = flat.find((x) => x.key === selKey);
    if (hit) return hit;
    const sv = saved.find((x) => x.key === selKey);
    if (sv?.rec) return { key: sv.key, game: sv.rec.game, inLibrary: !!sv.game, ext: sv.ext, score: sv.rec.score, band: sv.rec.band, pros: sv.rec.pros, cons: sv.rec.cons, facts: [], sources: sv.rec.sources, confidence: sv.rec.confidence, commitment: sv.rec.commitment, mark: sv.mark, seeds: [], rec: sv.rec };
    return null;
  }, [selKey, flat, saved]);

  const answer = useCallback(
    async (item: { key: string; game: DiscoverItem["game"]; ext: ExtGame | null; inLibrary: boolean }, kind: MarkKind) => {
      const cur = marks.get(item.key);
      if (cur?.kind === kind) {
        await clearMark(item.key);
        toast(`Cleared your answer for ${cleanTitle(item.game.title)}.`);
        return;
      }
      const snapshot = item.inLibrary ? {} : snapshotOf(item);
      // Saved games you don't own keep a cached cover so they still show offline.
      if (!item.inLibrary && kind !== "not_interested" && typeof snapshot.coverUrl === "string") {
        try {
          const f = await net.download(snapshot.coverUrl, `igdb-${item.ext?.igdbId}-cover`);
          snapshot.coverFile = f.file;
        } catch {
          /* offline: the link is kept and tried again later */
        }
      }
      await setMark({ key: item.key, kind, title: item.game.title, gameId: item.inLibrary ? item.game.id : null, snapshot });
      const until = kind === "not_interested" ? hiddenUntil({ ...(cur ?? ({} as Mark)), kind, times: cur?.kind === kind ? cur.times + 1 : 1, updatedAt: new Date().toISOString() } as Mark, prefs.hideDays) : null;
      toast(kind === "not_interested" ? `Hidden until ${until}. Bring it back any time under Hidden.` : `${MARK_LABEL[kind]}: ${cleanTitle(item.game.title)}`);
    },
    [marks, setMark, clearMark, toast, prefs.hideDays],
  );

  // Keyboard: ← → move between covers, I/T/W/P/N answer, Esc closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.ctrlKey || e.altKey || e.metaKey || document.querySelector(".shade, .menu")) return;
      if (e.key === "Escape" && selKey) return setSelKey(null);
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && flat.length) {
        const i = Math.max(0, flat.findIndex((x) => x.key === selKey));
        const next = flat[Math.max(0, Math.min(flat.length - 1, selKey ? i + (e.key === "ArrowRight" ? 1 : -1) : 0))];
        if (next) {
          e.preventDefault();
          setSelKey(next.key);
          window.setTimeout(() => (document.querySelector(`[data-key="${CSS.escape(next.key)}"]`) as HTMLElement | null)?.focus(), 0);
        }
        return;
      }
      if (selected) {
        const m = MARKS.find((x) => x.key === e.key.toLowerCase());
        if (m && !(m.id === "wishlist" && selected.inLibrary)) {
          e.preventDefault();
          void answer(selected, m.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selKey, selected, answer]);

  const stale = beyond.cache ? (Date.now() - Date.parse(beyond.cache.fetchedAt)) / 86_400_000 > BEYOND_MAX_AGE_DAYS || basisChanged(beyond.cache, prefs) : false;
  const outsideCount = useMemo(() => (showBeyond ? outside(model, visible).length : 0), [model, visible, showBeyond]);
  const shelves: { id: Shelf; label: string; n?: number }[] = [
    { id: "foryou", label: "For you" },
    ...visible.map((id) => ({ id, label: CATEGORIES[id].label, n: (counts[id]?.library ?? 0) + (showBeyond ? counts[id]?.beyond ?? 0 : 0) })),
    ...(showBeyond ? [{ id: "outside" as Shelf, label: "Outside my library", n: outsideCount }] : []),
    { id: "saved", label: "Saved", n: saved.length },
    { id: "hidden", label: "Hidden", n: hidden.length },
  ];

  return (
    <div className="page fill">
      <div className="fill-head">
        <header className="page-head">
          <h1>Discover</h1>
          <div className="acts">
            {showBeyond && <BeyondButton stale={stale} onRun={() => void runBeyond(repo, games, taste, prefs)} onConnect={() => nav.settings("connections")} />}
            <button className="btn ghost" onClick={() => setEditPrefs(true)}>
              <Icon name="settings" /> Shelves and preferences
            </button>
          </div>
        </header>
        <div className="shelf-tabs" role="tablist" aria-label="Shelves">
          {shelves.map((s) => (
            <button key={s.id} role="tab" aria-selected={shelf === s.id} onClick={() => choose(s.id)}>
              {s.label}
              {s.n != null && <span className="n">{s.n}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="disc">
        <section className="disc-main">
          <div style={{ padding: "0 var(--s6) var(--s6)" }}>
            {beyond.error && <div className="note bad" style={{ marginBottom: "var(--s4)" }}>{beyond.error}</div>}
            {current && (
              <div className="stack loose">
                <div className="stack tight">
                  <span className="dim">{current.blurb}</span>
                  {current.notes.map((n) => (
                    <span key={n} className="meta">{n}</span>
                  ))}
                </div>
                {current.lib.length > 0 && (
                  <div className="dgrid">
                    {current.lib.map((it) => (
                      <Card key={it.key} item={it} selected={selKey === it.key} onSelect={() => setSelKey(it.key)} />
                    ))}
                  </div>
                )}
                {shelf !== "foryou" && shelf !== "outside" && current.lib.length === 0 && (
                  <div className="empty">
                    <b>Nothing in your library fits this shelf</b>
                    <span className="hint">Shelves fill as games get tags and lengths. The Library check-up can look those up.</span>
                  </div>
                )}
                {current.ext.length > 0 && (
                  <div className="stack">
                    {shelf !== "outside" && (
                      <div className="sec-h" style={{ marginBottom: 0 }}>
                        <h2>Not in your library</h2>
                        <span className="count">{current.ext.length} · game data from IGDB.com</span>
                      </div>
                    )}
                    <div className="dgrid">
                      {current.ext.map((it) => (
                        <Card key={it.key} item={it} selected={selKey === it.key} onSelect={() => setSelKey(it.key)} />
                      ))}
                    </div>
                  </div>
                )}
                {shelf === "outside" && current.ext.length === 0 && (
                  <div className="empty">
                    <b>Nothing from outside your library yet</b>
                    <span className="hint">{beyond.hasCreds === false ? "Connect IGDB (free Twitch developer keys) in Settings → Connections, then look beyond your library." : "Use “Look beyond my library” above. It needs the internet once; results are kept for offline use."}</span>
                  </div>
                )}
                {shelf === "foryou" && current.lib.length === 0 && (
                  <div className="empty">
                    <b>Nothing to suggest yet</b>
                    <span className="hint">Discover works from your ratings, favourites and tags. Rate a few games you've played, or run the Library check-up to fill in details.</span>
                  </div>
                )}
              </div>
            )}
            {shelf === "saved" && <SavedPane items={saved} selKey={selKey} onSelect={setSelKey} />}
            {shelf === "hidden" && <HiddenPane marks={hidden} hideDays={prefs.hideDays} onBringBack={(k) => void clearMark(k)} />}
          </div>
        </section>

        {selected && (
          <DetailPane
            item={selected}
            onClose={() => setSelKey(null)}
            onAnswer={(k) => void answer(selected, k)}
            onOpenGame={() => nav.openGame(selected.game.id, "library")}
            onAdd={() => selected.ext && setAdding({ ext: selected.ext, title: selected.game.title })}
          />
        )}
        {!selected && selKey && saved.find((x) => x.key === selKey) && <SavedDetail entry={saved.find((x) => x.key === selKey)!} onClose={() => setSelKey(null)} onClear={() => void clearMark(selKey)} />}
      </div>

      {editPrefs && <PrefsDialog prefs={prefs} onClose={() => setEditPrefs(false)} onSave={(p) => setPrefs(p)} />}
      {adding && (
        <AddDialog
          title={cleanTitle(adding.title)}
          onClose={() => setAdding(null)}
          onAdd={async (ownership, status) => {
            const ext = adding.ext;
            const g = await run(() => addExtToLibrary(repo, ext, { ownership, status, download: (u, n) => net.download(u, n) }), `${ext.name} added to your library.`);
            setAdding(null);
            if (g) {
              await app.reloadAll();
              setSelKey(gameKey(g.id));
            }
          }}
        />
      )}
    </div>
  );
}

function BeyondButton({ stale, onRun, onConnect }: { stale: boolean; onRun(): void; onConnect(): void }) {
  const b = useBeyond();
  if (b.hasCreds === false)
    return (
      <button className="btn ghost" onClick={onConnect} title="Games you don't own come from IGDB, which needs free Twitch developer keys">
        Connect IGDB to look beyond your library
      </button>
    );
  if (b.running)
    return (
      <span className="row nowrap">
        <span className="led ok blink">
          <i /> {b.progress?.step ?? "Looking"}
          {b.progress && b.progress.total > 1 ? ` ${b.progress.done}/${b.progress.total}` : "…"}
        </span>
        <button className="btn sm" onClick={cancelBeyond}>
          Stop
        </button>
      </span>
    );
  return (
    <button className="btn" onClick={onRun} title={b.cache ? `Checked ${fmtDate(b.cache.fetchedAt)}${stale ? " — out of date" : ""}` : "Find games you don't own that fit your taste (needs the internet once)"}>
      <Icon name="refresh" /> {b.cache ? (stale ? "Refresh outside games" : "Look again outside my library") : "Look beyond my library"}
    </button>
  );
}

function DetailPane({ item, onClose, onAnswer, onOpenGame, onAdd }: { item: DiscoverItem; onClose(): void; onAnswer(k: MarkKind): void; onOpenGame(): void; onAdd(): void }) {
  const g = item.game;
  const e = item.ext;
  const store = e?.steamAppId ? `https://store.steampowered.com/app/${e.steamAppId}/` : item.inLibrary && g.steamAppId ? `https://store.steampowered.com/app/${g.steamAppId}/` : null;
  const until = hiddenUntil(item.mark ?? undefined);
  const year = e?.year ?? releaseYear(g);
  const facts = [year, item.inLibrary ? (g.ownership === "owned" ? "In your library" : OWNERSHIP.find((o) => o.id === g.ownership)?.label) : "Not owned", item.commitment].filter(Boolean).join(" · ");
  return (
    <aside className="dside" aria-label={`About ${cleanTitle(g.title)}`}>
      <div className="drawer-head">
        <span className="meta">{BAND_LABEL[item.band]}</span>
        <button className="btn ghost icon sm" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="drawer-body">
        <div className="d-top">
          <DCover item={item} eager />
          <div className="d-id">
            <span className="d-title" style={{ border: 0, margin: 0, padding: 0 }}>{cleanTitle(g.title)}</span>
            <span className="d-meta">{facts}</span>
            {item.inLibrary && <StatusPill status={g.status} />}
          </div>
        </div>
        <div className="d-acts">
          {item.inLibrary ? (
            <button className="btn" onClick={onOpenGame}>
              Open in Library
            </button>
          ) : (
            <button className="btn primary" onClick={onAdd} title="Nothing is added unless you press this">
              <Icon name="plus" /> Add to library…
            </button>
          )}
          {store && (
            <button className="btn ghost" onClick={() => void openExternal(store)}>
              Steam page <Icon name="external" />
            </button>
          )}
          {e?.pageUrl && (
            <button className="btn ghost" onClick={() => void openExternal(e.pageUrl!)}>
              IGDB <Icon name="external" />
            </button>
          )}
        </div>
        <div style={{ padding: "0 var(--s4) var(--s4)" }} className="stack tight">
          <span className="meta">Your answer (keys {MARKS.filter((m) => !(m.id === "wishlist" && item.inLibrary)).map((m) => m.key.toUpperCase()).join(" ")})</span>
          <div className="answers" role="group" aria-label="Your answer">
            {MARKS.filter((m) => !(m.id === "wishlist" && item.inLibrary)).map((m) => (
              <button key={m.id} className="btn sm" aria-pressed={item.mark?.kind === m.id} onClick={() => onAnswer(m.id)} title={`${m.hint}${item.mark?.kind === m.id ? " — press again to clear" : ""}`}>
                {m.short}
              </button>
            ))}
          </div>
          {item.mark?.kind === "not_interested" && until && <span className="meta">Hidden until {until}.</span>}
          {item.mark?.kind === "played" && item.inLibrary && g.status !== "completed" && (
            <span className="meta">You said you've played it; its status is still {STATUSES.find((s) => s.id === g.status)?.label}. Change it in the Library if you like.</span>
          )}
        </div>
        <details className="dsec" open>
          <summary>Why it's here</summary>
          <div className="body">
            {item.pros.filter((p) => !/^Already in your library$/.test(p.text)).length > 0 ? (
              <ul className="why">
                {item.pros
                  .filter((p) => !/^Already in your library$/.test(p.text))
                  .slice(0, 4)
                  .map((p) => (
                    <li key={p.text}>{p.text}</li>
                  ))}
              </ul>
            ) : (
              <span className="dim">It fits the shelf, but nothing about your own history stands out for it.</span>
            )}
            {item.cons.length > 0 && (
              <ul className="why cons">
                {item.cons.slice(0, 2).map((p) => (
                  <li key={p.text}>{p.text}</li>
                ))}
              </ul>
            )}
            <span className="meta">
              {item.confidence.level} confidence · {item.sources.join(", ")}. Popularity and review scores are never used.
            </span>
          </div>
        </details>
        {e && (
          <details className="dsec">
            <summary>Details from IGDB</summary>
            <div className="body">
              {e.summary && <p className="about open" style={{ margin: 0 }}>{e.summary}</p>}
              <dl className="kv">
                {e.developers.length > 0 && (
                  <>
                    <dt>Developer</dt>
                    <dd>{e.developers.join(", ")}</dd>
                  </>
                )}
                {e.genres.length > 0 && (
                  <>
                    <dt>Genres</dt>
                    <dd>{e.genres.join(", ")}</dd>
                  </>
                )}
                {e.themes.length > 0 && (
                  <>
                    <dt>Themes</dt>
                    <dd>{e.themes.join(", ")}</dd>
                  </>
                )}
                {e.platforms.length > 0 && (
                  <>
                    <dt>Platforms</dt>
                    <dd>{e.platforms.slice(0, 6).join(", ")}</dd>
                  </>
                )}
                {e.modes.length > 0 && (
                  <>
                    <dt>Modes</dt>
                    <dd>{e.modes.join(", ")}</dd>
                  </>
                )}
                <dt>Time to beat</dt>
                <dd>
                  {e.ttb ? (
                    <>
                      {[e.ttb.main && `~${e.ttb.main}h main`, e.ttb.extras && `~${e.ttb.extras}h with extras`, e.ttb.complete && `~${e.ttb.complete}h complete`].filter(Boolean).join(" · ")}{" "}
                      <span className="muted">({e.ttb.count ?? "some"} players reported)</span>
                    </>
                  ) : (
                    <span className="muted">unknown</span>
                  )}
                </dd>
              </dl>
              {!item.inLibrary && <span className="meta">Prices aren't shown: REWIND doesn't track them.</span>}
            </div>
          </details>
        )}
      </div>
    </aside>
  );
}

function SavedPane({ items, selKey, onSelect }: { items: ReturnType<typeof savedItems>; selKey: string | null; onSelect(k: string): void }) {
  if (!items.length)
    return (
      <div className="empty">
        <b>Nothing saved yet</b>
        <span className="hint">Answer Interested, Want to try or Wishlist on any game and it lands here. Games you don't own are saved with their details so they work offline.</span>
      </div>
    );
  const groups: [MarkKind, string][] = [
    ["want", "Want to try"],
    ["wishlist", "Wishlist"],
    ["interested", "Interested"],
  ];
  return (
    <div className="stack loose">
      {groups.map(([k, label]) => {
        const xs = items.filter((x) => x.mark.kind === k);
        if (!xs.length) return null;
        return (
          <section key={k} className="stack">
            <div className="sec-h" style={{ marginBottom: 0 }}>
              <h2>{label}</h2>
              <span className="count">{xs.length}</span>
            </div>
            <div className="dgrid">
              {xs.map((x) => {
                const title = x.game?.title ?? x.ext?.name ?? x.mark.title;
                return (
                  <button key={x.key} className="tile-btn" aria-pressed={selKey === x.key} onClick={() => onSelect(x.key)} data-key={x.key}>
                    {x.game ? <Cover game={x.game} /> : <DCover item={{ game: { ...(x.rec?.game ?? ({} as DiscoverItem["game"])), title, coverPath: null, favorite: false } as DiscoverItem["game"], ext: x.ext, snapshot: x.mark.snapshot }} />}
                    <span className="tb-t">{cleanTitle(title)}</span>
                    <span className="tb-s">saved {fmtDay(x.mark.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A saved game that isn't in the current IGDB list, shown from what was saved. */
function SavedDetail({ entry, onClose, onClear }: { entry: ReturnType<typeof savedItems>[number]; onClose(): void; onClear(): void }) {
  const s = entry.mark.snapshot;
  const store = typeof s.storeUrl === "string" ? s.storeUrl : null;
  const page = typeof s.pageUrl === "string" ? s.pageUrl : null;
  return (
    <aside className="dside" aria-label={`Saved: ${entry.mark.title}`}>
      <div className="drawer-head">
        <span className="meta">{MARK_LABEL[entry.mark.kind]}</span>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="drawer-body">
        <div className="d-top">
          <DCover item={{ game: { title: entry.mark.title, coverPath: null, favorite: false } as DiscoverItem["game"], ext: null, snapshot: s }} eager />
          <div className="d-id">
            <span className="d-title" style={{ border: 0, margin: 0, padding: 0 }}>{cleanTitle(entry.mark.title)}</span>
            <span className="d-meta">
              {typeof s.year === "number" ? `${s.year} · ` : ""}
              {Array.isArray(s.genres) ? (s.genres as string[]).slice(0, 3).join(", ") : ""}
            </span>
          </div>
        </div>
        <div className="d-acts">
          {store && (
            <button className="btn ghost" onClick={() => void openExternal(store)}>
              Steam page <Icon name="external" />
            </button>
          )}
          {page && (
            <button className="btn ghost" onClick={() => void openExternal(page)}>
              IGDB <Icon name="external" />
            </button>
          )}
          <button className="btn danger" onClick={onClear}>
            Remove from Saved
          </button>
        </div>
        <div style={{ padding: "0 var(--s4) var(--s4)" }} className="stack tight">
          <span className="meta">
            Saved {fmtDay(entry.mark.updatedAt)}. Shown from what REWIND kept then — look beyond your library again for current details.
          </span>
          {typeof s.summary === "string" && <p className="about open" style={{ margin: 0 }}>{s.summary}</p>}
        </div>
      </div>
    </aside>
  );
}

function HiddenPane({ marks, hideDays, onBringBack }: { marks: Mark[]; hideDays: number; onBringBack(k: string): void }) {
  if (!marks.length)
    return (
      <div className="empty">
        <b>Nothing hidden</b>
        <span className="hint">“Not interested” hides a suggestion for {hideDays} days ({hideDays * 2} if you say it twice). Nothing is hidden forever.</span>
      </div>
    );
  return (
    <div className="rows">
      {marks.map((m) => {
        const until = hiddenUntil(m, hideDays);
        const active = isHidden(m, new Date(), hideDays);
        return (
          <div className="r-item no-lead" key={m.key}>
            <span className="r-main">
              <span className="r-title">{cleanTitle(m.title)}</span>
              <span className="r-sub">
                {m.times > 1 ? `said ${m.times} times · ` : ""}
                {active ? `back on ${until}` : `came back ${until}`}
              </span>
            </span>
            <button className="btn sm" onClick={() => onBringBack(m.key)}>
              Bring back now
            </button>
          </div>
        );
      })}
    </div>
  );
}

function AddDialog({ title, onClose, onAdd }: { title: string; onClose(): void; onAdd(o: Ownership, s: Status): Promise<void> }) {
  const [own, setOwn] = useState<Ownership>("wishlist");
  const [status, setStatus] = useState<Status>("backlog");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Add ${title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onAdd(own, status);
            }}
          >
            Add to library
          </button>
        </>
      }
    >
      <p className="dim">It's added with IGDB's details and cover, labelled with their source. Nothing else changes.</p>
      <div className="stack tight">
        <span className="meta">Ownership</span>
        <div className="seg">
          {(["wishlist", "owned", "not_owned"] as Ownership[]).map((o) => (
            <button key={o} aria-pressed={own === o} onClick={() => setOwn(o)}>
              {OWNERSHIP.find((x) => x.id === o)!.label}
            </button>
          ))}
        </div>
      </div>
      <div className="stack tight">
        <span className="meta">Status</span>
        <div className="seg">
          {(["backlog", "completed", "dropped"] as Status[]).map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {STATUSES.find((x) => x.id === s)!.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function PrefsDialog({ prefs, onClose, onSave }: { prefs: DiscoverPrefs; onClose(): void; onSave(p: DiscoverPrefs): void }) {
  const [p, setP] = useState<DiscoverPrefs>(prefs);
  const move = (id: CategoryId, d: -1 | 1) => {
    const o = [...p.order];
    const i = o.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setP({ ...p, order: o });
  };
  const num = (k: "eraFrom" | "eraTo" | "shortMaxHours" | "longMinHours" | "hideDays", v: string) => setP({ ...p, [k]: Number(v) || 0 });
  return (
    <Modal
      title="Shelves and preferences"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => setP(DEFAULT_DISCOVER_PREFS)}>
            Reset
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onSave({ ...p, eraTo: Math.max(p.eraFrom, p.eraTo) });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="grid2">
        <div className="stack">
          <div className="stack tight">
            <b>Games you don't own</b>
            <div className="seg sm">
              {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                <button key={s} aria-pressed={p.scope === s} onClick={() => setP({ ...p, scope: s })}>
                  {SCOPE_LABEL[s]}
                </button>
              ))}
            </div>
            <span className="meta">“My library first” keeps your own games ahead of ones you'd have to buy.</span>
          </div>
          <label className="check">
            <input type="checkbox" checked={p.seriesOrder} onChange={(e) => setP({ ...p, seriesOrder: e.target.checked })} />
            Keep series in order (a sequel waits until you've played the earlier game)
          </label>
          <div className="stack tight">
            <b>Early-2000s nostalgia</b>
            <div className="row">
              From <input className="field sm" type="number" min={1970} max={2030} value={p.eraFrom} onChange={(e) => num("eraFrom", e.target.value)} style={{ width: "5.5rem" }} aria-label="From year" />
              to <input className="field sm" type="number" min={1970} max={2030} value={p.eraTo} onChange={(e) => num("eraTo", e.target.value)} style={{ width: "5.5rem" }} aria-label="To year" />
            </div>
            <div className="chips">
              {ERA_PLATFORMS.map((pl) => (
                <button key={pl.id} className="chip" aria-pressed={p.eraPlatforms.includes(pl.id)} onClick={() => setP({ ...p, eraPlatforms: p.eraPlatforms.includes(pl.id) ? p.eraPlatforms.filter((x) => x !== pl.id) : [...p.eraPlatforms, pl.id] })}>
                  {pl.label}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={p.includeReplays} onChange={(e) => setP({ ...p, includeReplays: e.target.checked })} /> Include finished favourites as replays
            </label>
          </div>
          <div className="stack tight">
            <b>Lengths and hiding</b>
            <label className="row">
              “Short” means a main story up to <input className="field sm" type="number" min={2} max={30} value={p.shortMaxHours} onChange={(e) => num("shortMaxHours", e.target.value)} style={{ width: "4.5rem" }} /> hours
            </label>
            <label className="row">
              “Deep RPG” means at least <input className="field sm" type="number" min={15} max={150} value={p.longMinHours} onChange={(e) => num("longMinHours", e.target.value)} style={{ width: "4.5rem" }} /> hours
            </label>
            <label className="row">
              “Not interested” hides for <input className="field sm" type="number" min={7} max={365} value={p.hideDays} onChange={(e) => num("hideDays", e.target.value)} style={{ width: "4.5rem" }} /> days
            </label>
          </div>
        </div>
        <div className="stack tight">
          <b>Shelves</b>
          <div className="rows boxed">
            {p.order.map((id, i) => (
              <div key={id} className="r-item no-lead" style={{ minHeight: "2.4rem", padding: "var(--s1) var(--s3)" }}>
                <label className="check">
                  <input type="checkbox" checked={!p.hidden.includes(id)} onChange={(e) => setP({ ...p, hidden: e.target.checked ? p.hidden.filter((x) => x !== id) : [...p.hidden, id] })} />
                  {CATEGORIES[id].label}
                </label>
                <span className="r-acts">
                  <button className="btn ghost icon sm" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move ${CATEGORIES[id].label} up`}>
                    <Icon name="up" />
                  </button>
                  <button className="btn ghost icon sm" disabled={i === p.order.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${CATEGORIES[id].label} down`}>
                    <Icon name="down" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
