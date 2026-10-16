import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store.tsx";
import { useTaste } from "../state/recs.ts";
import { cancelBeyond, loadBeyond, loadDiscoverPrefs, runBeyond, saveDiscoverPrefs, useBeyond } from "../state/discover.ts";
import { net } from "../state/metaSync.ts";
import { cleanTitle } from "../lib/canon.ts";
import { OWNERSHIP, STATUSES, type Ownership, type Status } from "../lib/types.ts";
import { releaseYear } from "../lib/library.ts";
import { buildDiscover, CATEGORIES, categoryCounts, discoverCategory, savedItems, snapshotOf, type DiscoverItem } from "../discover/engine.ts";
import { BEYOND_MAX_AGE_DAYS, basisChanged, IGDB_IMG, type ExtGame } from "../discover/beyond.ts";
import { CATEGORY_IDS, DEFAULT_DISCOVER_PREFS, ERA_PLATFORMS, SCOPE_LABEL, type CategoryId, type DiscoverPrefs, type Scope } from "../discover/prefs.ts";
import { gameKey, hiddenUntil, isHidden, MARK_LABEL, MARKS, type Mark, type MarkKind } from "../discover/marks.ts";
import { addExtToLibrary } from "../discover/addToLibrary.ts";
import { BAND_LABEL } from "../rec/engine.ts";
import { Cover, StatusPill, Thumb, fmtDate } from "../ui/bits.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { artSrc, openExternal } from "../platform/native.ts";
import type { Nav } from "../App.tsx";

type Pane = "overview" | CategoryId | "saved" | "hidden";
type Show = "all" | "library" | "beyond";
type Sort = "fit" | "title" | "year" | "length";

const coverUrl = (e: ExtGame | null) => (e?.coverId ? `${IGDB_IMG}/t_cover_big/${e.coverId}.jpg` : null);

/** A cover for any Discover item: your cached art for library games, IGDB's image for others. */
function DCover({ item, eager }: { item: { game: DiscoverItem["game"]; ext: ExtGame | null; snapshot?: Record<string, unknown> }; eager?: boolean }) {
  const [bad, setBad] = useState(false);
  if (!item.ext && !item.snapshot) return <Cover game={item.game} eager={eager} />;
  const file = typeof item.snapshot?.coverFile === "string" ? artSrc(item.snapshot.coverFile) : null;
  const url = file ?? coverUrl(item.ext) ?? (typeof item.snapshot?.coverUrl === "string" ? item.snapshot.coverUrl : null);
  if (url && !bad) {
    return (
      <div className="cover has-art">
        <img src={url} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBad(true)} />
      </div>
    );
  }
  return <Cover game={{ ...item.game, coverPath: null }} eager={eager} />;
}

function OwnTag({ item }: { item: Pick<DiscoverItem, "game" | "inLibrary"> }) {
  if (!item.inLibrary) return <span className="own-tag not">Not owned</span>;
  const o = item.game.ownership;
  return <span className={"own-tag " + (o === "owned" ? "own" : "not")}>{o === "owned" ? "Owned" : o === "wishlist" ? "Wishlist" : OWNERSHIP.find((x) => x.id === o)?.label ?? o}</span>;
}

function DCard({ item, selected, onSelect }: { item: DiscoverItem; selected: boolean; onSelect(): void }) {
  return (
    <button className={"dcard" + (selected ? " sel" : "")} aria-pressed={selected} onClick={onSelect} data-key={item.key} title={cleanTitle(item.game.title)}>
      <div className="dc-art">
        <DCover item={item} />
        <span className={"dc-band b-" + item.band}>{BAND_LABEL[item.band]}</span>
        {item.mark && <span className={"dc-mark m-" + item.mark.kind}>{MARK_LABEL[item.mark.kind]}</span>}
      </div>
      <span className="dc-t">{cleanTitle(item.game.title)}</span>
      <span className="dc-m">
        <OwnTag item={item} />
        <span className="dim">{item.facts[0] ?? ""}</span>
      </span>
      {item.pros[0] && <span className="dc-why">{item.pros[0].text}</span>}
    </button>
  );
}

export function DiscoverView({ nav }: { nav: Nav }) {
  const app = useApp();
  const { repo, games, profile, recEvents, marks, settings, setMark, clearMark, run, toast } = app;
  const { taste, series } = useTaste();
  const beyond = useBeyond();
  const [prefs, setPrefsState] = useState<DiscoverPrefs>(DEFAULT_DISCOVER_PREFS);
  const [pane, setPane] = useState<Pane>("overview");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("fit");
  const [q, setQ] = useState("");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [editPrefs, setEditPrefs] = useState(false);
  const [adding, setAdding] = useState<{ ext: ExtGame; title: string } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const allowEst = settings.useUnverifiedLengths;

  useEffect(() => {
    void loadDiscoverPrefs(repo).then(setPrefsState);
    void loadBeyond(repo);
    void repo.getSetting<Pane>("discover_pane", "overview").then((p) => setPane(p));
  }, [repo]);
  const choosePane = (p: Pane) => {
    setPane(p);
    setSelKey(null);
    void repo.setSetting("discover_pane", p).catch(() => undefined);
  };
  const setPrefs = (p: DiscoverPrefs) => {
    setPrefsState(p);
    void run(() => saveDiscoverPrefs(repo, p));
  };

  const model = useMemo(
    () => buildDiscover({ games, taste, events: recEvents, profile, series, prefs, marks, beyond: beyond.cache, allowUnverified: allowEst }),
    [games, taste, recEvents, profile, series, prefs, marks, beyond.cache, allowEst],
  );
  const visible = prefs.order.filter((id) => !prefs.hidden.includes(id));
  const counts = useMemo(() => categoryCounts(model, visible), [model, visible.join()]);
  const current = useMemo(() => (pane !== "overview" && pane !== "saved" && pane !== "hidden" ? discoverCategory(model, pane) : null), [model, pane]);
  const saved = useMemo(() => savedItems(model), [model]);
  const hidden = useMemo(() => [...marks.values()].filter((m) => m.kind === "not_interested" && !m.key.startsWith("mr:") && !m.key.startsWith("cf:")), [marks]);

  const filterSort = useCallback(
    (items: DiscoverItem[]) => {
      const t = q.trim().toLowerCase();
      let out = t ? items.filter((x) => (x.game.title + " " + x.facts.join(" ")).toLowerCase().includes(t)) : items;
      const yr = (x: DiscoverItem) => x.ext?.year ?? releaseYear(x.game) ?? 0;
      const len = (x: DiscoverItem) => x.game.lengths.find((l) => l.kind === "main")?.hours ?? 9999;
      if (sort === "title") out = [...out].sort((a, b) => a.game.title.localeCompare(b.game.title));
      if (sort === "year") out = [...out].sort((a, b) => yr(a) - yr(b) || b.score - a.score);
      if (sort === "length") out = [...out].sort((a, b) => len(a) - len(b) || b.score - a.score);
      return out;
    },
    [q, sort],
  );
  const libItems = current ? (show === "beyond" ? [] : filterSort(current.library)) : [];
  const extItems = current ? (show === "library" ? [] : filterSort(current.beyond)) : [];
  const flat = [...libItems, ...extItems];

  // The selected item can come from the current list, the overview, or Saved.
  const overview = useMemo(() => {
    if (pane !== "overview") return [];
    return visible.map((id) => {
      const r = discoverCategory(model, id, { library: 12, beyond: 8 });
      const mixed = prefs.scope === "mixed" ? [...r.library, ...r.beyond].sort((a, b) => b.score - a.score) : [...r.library, ...r.beyond];
      return { r, items: mixed.slice(0, 14) };
    });
  }, [pane, model, visible.join(), prefs.scope]);
  const selected: DiscoverItem | null = useMemo(() => {
    if (!selKey) return null;
    for (const x of flat) if (x.key === selKey) return x;
    for (const s of overview) for (const x of s.items) if (x.key === selKey) return x;
    // Saved items: rebuild a minimal item from live data when we have it.
    const sv = saved.find((x) => x.key === selKey);
    if (sv?.rec) return { key: sv.key, game: sv.rec.game, inLibrary: !!sv.game, ext: sv.ext, score: sv.rec.score, band: sv.rec.band, pros: sv.rec.pros, cons: sv.rec.cons, facts: [], sources: sv.rec.sources, confidence: sv.rec.confidence, commitment: sv.rec.commitment, mark: sv.mark, seeds: [], rec: sv.rec };
    return null;
  }, [selKey, flat, overview, saved]);

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
      toast(kind === "not_interested" ? `Hidden until ${until}. You can bring it back under Hidden for now.` : `${MARK_LABEL[kind]}: ${cleanTitle(item.game.title)}`);
    },
    [marks, setMark, clearMark, toast, prefs.hideDays],
  );

  // Keyboard: arrows move through the cards, I/T/W/P/N answer, Esc closes the details.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector(".shade")) return;
      if (e.key === "Escape" && selKey) {
        setSelKey(null);
        return;
      }
      const list = pane === "overview" ? overview.flatMap((s) => s.items) : flat;
      if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) && list.length) {
        const i = Math.max(0, list.findIndex((x) => x.key === selKey));
        const cols = (() => {
          const g = gridRef.current?.querySelector(".dgrid");
          if (!g) return 1;
          return getComputedStyle(g).gridTemplateColumns.split(" ").length || 1;
        })();
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? (pane === "overview" ? 1 : cols) : pane === "overview" ? -1 : -cols;
        const next = list[Math.max(0, Math.min(list.length - 1, selKey ? i + step : 0))];
        if (next) {
          e.preventDefault();
          setSelKey(next.key);
          window.setTimeout(() => (document.querySelector(`.dcard[data-key="${CSS.escape(next.key)}"]`) as HTMLElement | null)?.focus(), 0);
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
  }, [pane, overview, flat, selKey, selected, answer]);

  const stale = beyond.cache ? (Date.now() - Date.parse(beyond.cache.fetchedAt)) / 86_400_000 > BEYOND_MAX_AGE_DAYS || basisChanged(beyond.cache, prefs) : false;

  return (
    <div className="disc">
      <aside className="disc-rail" aria-label="Discover categories">
        <div className="dr-list">
          <button className="dr-item" aria-current={pane === "overview" ? "page" : undefined} onClick={() => choosePane("overview")}>
            <span className="dr-l">For you</span>
            <small>Every shelf at a glance</small>
          </button>
          {visible.map((id) => (
            <button key={id} className="dr-item" aria-current={pane === id ? "page" : undefined} onClick={() => choosePane(id)}>
              <span className="dr-l">{CATEGORIES[id].label}</span>
              <small>{CATEGORIES[id].blurb}</small>
              <span className="dr-n num" title="In your library + games you don't own">
                {counts[id]?.library ?? 0}
                {counts[id]?.beyond ? <em> +{counts[id].beyond}</em> : null}
              </span>
            </button>
          ))}
          <div className="grp">Your answers</div>
          <button className="dr-item" aria-current={pane === "saved" ? "page" : undefined} onClick={() => choosePane("saved")}>
            <span className="dr-l">Saved</span>
            <small>Interested, want to try, wishlist</small>
            <span className="dr-n num">{saved.length}</span>
          </button>
          <button className="dr-item" aria-current={pane === "hidden" ? "page" : undefined} onClick={() => choosePane("hidden")}>
            <span className="dr-l">Hidden for now</span>
            <small>"Not interested" — comes back later</small>
            <span className="dr-n num">{hidden.length}</span>
          </button>
        </div>
        <BeyondBox
          stale={stale}
          onRun={() => void runBeyond(repo, games, taste, prefs)}
          onConnect={() => nav.go("metadata")}
          alreadyOwned={model.alreadyOwned}
          scope={prefs.scope}
        />
        <button className="btn sm" onClick={() => setEditPrefs(true)}>
          <Icon name="settings" /> Discover settings…
        </button>
      </aside>

      <section className="disc-main" ref={gridRef}>
        {pane === "overview" && (
          <div className="shelves">
            {overview.map(({ r, items }) => (
              <section key={r.def.id} className="panel shelf" aria-labelledby={`sh-${r.def.id}`}>
                <div className="hd" id={`sh-${r.def.id}`}>
                  {r.def.label}
                  <span className="count">{r.library.length}{r.beyond.length ? ` +${r.beyond.length}` : ""}</span>
                  <span className="right">
                    <button className="btn ghost sm" onClick={() => choosePane(r.def.id)}>
                      See all <Icon name="right" />
                    </button>
                  </span>
                </div>
                <div className="bd">
                  {items.length ? (
                    <div className="dgrid one-row">
                      {items.map((it) => (
                        <DCard key={it.key} item={it} selected={selKey === it.key} onSelect={() => setSelKey(it.key)} />
                      ))}
                    </div>
                  ) : (
                    <div className="dim" style={{ fontSize: "var(--fs-s)" }}>Nothing fits this shelf right now{r.hiddenCount ? ` (${r.hiddenCount} hidden for now)` : ""}.</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}

        {current && (
          <>
            <div className="panel dhead2">
              <div className="bd">
                <h2 className="dh-title">{current.def.label}</h2>
                <p className="dim" style={{ margin: 0 }}>{current.def.blurb}</p>
                <details className="dh-how">
                  <summary>How this works</summary>
                  <p>{current.def.how}</p>
                  <p className="dim">
                    Ranked by the same explainable scoring as Pick for me (your ratings, profile, passes and answers). Popularity and review scores are never used.
                  </p>
                </details>
                {current.notes.map((n) => (
                  <div key={n} className="note info" style={{ fontSize: "var(--fs-s)" }}>
                    {n}
                  </div>
                ))}
              </div>
            </div>
            <div className="toolbar dtool">
              <div className="seg" role="group" aria-label="Show">
                {(["all", "library", "beyond"] as Show[]).map((s) => (
                  <button key={s} aria-pressed={show === s} onClick={() => setShow(s)}>
                    {s === "all" ? "All" : s === "library" ? "Your library" : "Not owned"}
                    <span className="n">{s === "all" ? current.library.length + current.beyond.length : s === "library" ? current.library.length : current.beyond.length}</span>
                  </button>
                ))}
              </div>
              <input className="field" type="search" placeholder="Filter this shelf…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" style={{ width: "16rem" }} />
              <label className="row" style={{ gap: "0.4rem" }}>
                <span className="dim mono" style={{ fontSize: "var(--fs-xs)" }}>SORT</span>
                <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                  <option value="fit">Best fit</option>
                  <option value="title">Title</option>
                  <option value="year">Release year</option>
                  <option value="length">Shortest first</option>
                </select>
              </label>
              {current.hiddenCount > 0 && (
                <button className="btn ghost sm" onClick={() => choosePane("hidden")}>
                  {current.hiddenCount} hidden for now
                </button>
              )}
            </div>
            {show !== "beyond" && (
              <section aria-label="From your library">
                <h3 className="dsec">From your library <span className="dim num">{libItems.length}</span></h3>
                {libItems.length ? (
                  <div className="dgrid">
                    {libItems.map((it) => (
                      <DCard key={it.key} item={it} selected={selKey === it.key} onSelect={() => setSelKey(it.key)} />
                    ))}
                  </div>
                ) : (
                  <div className="empty">Nothing in your library fits this shelf{q ? " and your filter" : ""}.</div>
                )}
              </section>
            )}
            {show !== "library" && current.def.pools.length > 0 && prefs.scope !== "library" && (
              <section aria-label="Not in your library">
                <h3 className="dsec">
                  Not in your library <span className="dim num">{extItems.length}</span>
                  <span className="dim attrib-s">Game data from IGDB.com</span>
                </h3>
                {extItems.length ? (
                  <div className="dgrid">
                    {extItems.map((it) => (
                      <DCard key={it.key} item={it} selected={selKey === it.key} onSelect={() => setSelKey(it.key)} />
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    {beyond.cache ? "No games outside your library fit this shelf." : "Connect IGDB and press “Look beyond my library” to see games you don't own here."}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {pane === "saved" && <SavedPane items={saved} selKey={selKey} onSelect={setSelKey} />}
        {pane === "hidden" && <HiddenPane marks={hidden} hideDays={prefs.hideDays} onBringBack={(k) => void clearMark(k)} />}
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
      {!selected && selKey && saved.find((x) => x.key === selKey) && (
        <SavedDetail entry={saved.find((x) => x.key === selKey)!} onClose={() => setSelKey(null)} onClear={() => void clearMark(selKey)} />
      )}

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

function BeyondBox({ stale, onRun, onConnect, alreadyOwned, scope }: { stale: boolean; onRun(): void; onConnect(): void; alreadyOwned: number; scope: Scope }) {
  const b = useBeyond();
  return (
    <div className="panel beyond">
      <div className="hd">
        Beyond your library
        <span className="right">
          <span className={"led " + (b.running ? "ok blink" : b.cache ? (stale ? "warn" : "ok") : "info")}>
            <i />
          </span>
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: "0.45rem", fontSize: "var(--fs-s)" }}>
        {scope === "library" ? (
          <span className="dim">Set to “Only my library” in Discover settings.</span>
        ) : b.hasCreds === false ? (
          <>
            <span>Games you don't own come from IGDB. It needs free Twitch developer keys (no payment).</span>
            <button className="btn sm" onClick={onConnect}>
              Add IGDB keys…
            </button>
          </>
        ) : (
          <>
            {b.running ? (
              <>
                <span>
                  {b.progress?.step ?? "Working"}
                  {b.progress && b.progress.total > 1 ? ` ${b.progress.done}/${b.progress.total}` : "…"}
                </span>
                <button className="btn sm" onClick={cancelBeyond}>
                  Stop
                </button>
              </>
            ) : b.cache ? (
              <>
                <span>
                  {b.cache.items.length} games from IGDB, checked {fmtDate(b.cache.fetchedAt)}.
                  {alreadyOwned ? ` ${alreadyOwned} turned out to be in your library already and are shown as yours.` : ""}
                </span>
                {stale && <span className="warn-t">Your settings changed or the list is over {BEYOND_MAX_AGE_DAYS} days old.</span>}
                <button className="btn sm" onClick={onRun}>
                  ↻ Refresh from IGDB
                </button>
              </>
            ) : (
              <>
                <span>Look for games you don't own that fit your taste. Needs internet; results are saved for offline use.</span>
                <button className="btn sm primary" onClick={onRun}>
                  Look beyond my library
                </button>
              </>
            )}
            {b.cache?.notes.map((n) => (
              <span key={n} className="dim">
                {n}
              </span>
            ))}
          </>
        )}
        {b.error && <div className="note bad">{b.error}</div>}
      </div>
    </div>
  );
}

function AnswerBar({ mark, inLibrary, onAnswer }: { mark: Mark | null; inLibrary: boolean; onAnswer(k: MarkKind): void }) {
  return (
    <div className="answers" role="group" aria-label="Your answer">
      {MARKS.filter((m) => !(m.id === "wishlist" && inLibrary)).map((m) => (
        <button key={m.id} className={"btn sm ans a-" + m.id} aria-pressed={mark?.kind === m.id} onClick={() => onAnswer(m.id)} title={`${m.hint} (key: ${m.key.toUpperCase()})${mark?.kind === m.id ? " — click again to clear" : ""}`}>
          {m.short}
          <span className="kbd">{m.key.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}

function DetailPane({ item, onClose, onAnswer, onOpenGame, onAdd }: { item: DiscoverItem; onClose(): void; onAnswer(k: MarkKind): void; onOpenGame(): void; onAdd(): void }) {
  const g = item.game;
  const e = item.ext;
  const store = e?.steamAppId ? `https://store.steampowered.com/app/${e.steamAppId}/` : g.steamAppId ? `https://store.steampowered.com/app/${g.steamAppId}/` : null;
  const until = hiddenUntil(item.mark ?? undefined);
  const year = e?.year ?? releaseYear(g);
  return (
    <aside className="detail disc-detail" aria-label={`Details: ${cleanTitle(g.title)}`}>
      <div className="dd-head">
        <span className="dtitle">{cleanTitle(g.title)}</span>
        <button className="btn ghost icon sm" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="dd-body">
        <div className="dd-top">
          <div className="dd-cover">
            <DCover item={item} eager />
          </div>
          <div className="dd-chips">
            <span className={"band b-" + item.band}>{BAND_LABEL[item.band]}</span>
            <OwnTag item={item} />
            {item.inLibrary && <StatusPill status={g.status} />}
            <span className="chip" title="How much time this asks of you">{item.commitment}</span>
            {year && <span className="chip">{year}</span>}
            <span className={"conf c-" + item.confidence.level} title={item.confidence.notes.join("; ")}>
              confidence: {item.confidence.level}
            </span>
          </div>
        </div>
        <AnswerBar mark={item.mark} inLibrary={item.inLibrary} onAnswer={onAnswer} />
        {item.mark?.kind === "not_interested" && until && <div className="note" style={{ fontSize: "var(--fs-s)" }}>Hidden until {until}.</div>}
        {item.mark?.kind === "played" && item.inLibrary && g.status !== "completed" && (
          <div className="note info" style={{ fontSize: "var(--fs-s)" }}>
            You said you've played it. Its status is still {STATUSES.find((s) => s.id === g.status)?.label}; change it on the game page if you like — REWIND won't do it for you.
          </div>
        )}
        <div className="dd-why">
          <h3>Why it fits</h3>
          <ul className="pros">{item.pros.length ? item.pros.map((p) => <li key={p.text}>{p.text}</li>) : <li className="dim">Nothing stands out either way</li>}</ul>
          <h3>Why it might not</h3>
          <ul className="cons">{item.cons.length ? item.cons.map((p) => <li key={p.text}>{p.text}</li>) : <li className="dim">No obvious drawbacks</li>}</ul>
        </div>
        {e && (
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
                  {[e.ttb.main && `~${e.ttb.main}h main`, e.ttb.extras && `~${e.ttb.extras}h main + extras`, e.ttb.complete && `~${e.ttb.complete}h complete`].filter(Boolean).join(" · ")}{" "}
                  <span className="dim">(IGDB, {e.ttb.count ?? "some"} player submissions)</span>
                </>
              ) : (
                <span className="dim">unknown</span>
              )}
            </dd>
          </dl>
        )}
        {e?.summary && (
          <div className="dd-sum">
            <h3>Summary <span className="dim">(IGDB)</span></h3>
            <p>{e.summary}</p>
          </div>
        )}
        <div className="row" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
          {item.inLibrary ? (
            <button className="btn sm" onClick={onOpenGame}>
              Open in Library
            </button>
          ) : (
            <button className="btn sm primary" onClick={onAdd} title="Adds it to your library. Nothing is added unless you press this.">
              <Icon name="plus" /> Add to library…
            </button>
          )}
          {store && (
            <button className="btn sm" onClick={() => void openExternal(store)}>
              Steam store page
            </button>
          )}
          {e?.pageUrl && (
            <button className="btn sm" onClick={() => void openExternal(e.pageUrl!)}>
              IGDB page
            </button>
          )}
        </div>
        <div className="srcnotes">
          <span className="lbl2">Data</span> {item.sources.join(" · ")}
          {!item.inLibrary && <div className="dim">Prices aren't shown: REWIND doesn't track them. Store pages open in your browser.</div>}
        </div>
      </div>
    </aside>
  );
}

function SavedPane({ items, selKey, onSelect }: { items: ReturnType<typeof savedItems>; selKey: string | null; onSelect(k: string): void }) {
  if (!items.length)
    return (
      <div className="empty">
        <b>Nothing saved yet</b>
        <div>Press Interested, Want to try or Wishlist on any suggestion and it lands here. Games you don't own are saved with their details so they work offline.</div>
      </div>
    );
  const groups: [MarkKind, string][] = [
    ["want", "Want to try"],
    ["wishlist", "Wishlist"],
    ["interested", "Interested"],
  ];
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {groups.map(([k, label]) => {
        const xs = items.filter((x) => x.mark.kind === k);
        if (!xs.length) return null;
        return (
          <section key={k}>
            <h3 className="dsec">
              {label} <span className="dim num">{xs.length}</span>
            </h3>
            <div className="dgrid">
              {xs.map((x) => {
                const title = x.game?.title ?? x.ext?.name ?? x.mark.title;
                const snap = x.mark.snapshot;
                const yr = x.ext?.year ?? (typeof snap.year === "number" ? snap.year : x.game ? releaseYear(x.game) : null);
                return (
                  <button key={x.key} className={"dcard" + (selKey === x.key ? " sel" : "")} aria-pressed={selKey === x.key} onClick={() => onSelect(x.key)} data-key={x.key}>
                    <div className="dc-art">
                      {x.game ? <Cover game={x.game} /> : <DCover item={{ game: { ...(x.rec?.game ?? ({} as DiscoverItem["game"])), title, coverPath: null, favorite: false } as DiscoverItem["game"], ext: x.ext, snapshot: snap }} />}
                    </div>
                    <span className="dc-t">{cleanTitle(title)}</span>
                    <span className="dc-m">
                      <span className={"own-tag " + (x.game?.ownership === "owned" ? "own" : "not")}>{x.game ? (x.game.ownership === "owned" ? "Owned" : "In library") : "Not owned"}</span>
                      <span className="dim">{yr ?? ""}</span>
                    </span>
                    <span className="dc-why dim">Saved {fmtDate(x.mark.updatedAt)}</span>
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

/** Details for a saved game that isn't in the current IGDB list (shown from its snapshot). */
function SavedDetail({ entry, onClose, onClear }: { entry: ReturnType<typeof savedItems>[number]; onClose(): void; onClear(): void }) {
  const s = entry.mark.snapshot;
  const store = typeof s.storeUrl === "string" ? s.storeUrl : null;
  const page = typeof s.pageUrl === "string" ? s.pageUrl : null;
  return (
    <aside className="detail disc-detail" aria-label={`Saved: ${entry.mark.title}`}>
      <div className="dd-head">
        <span className="dtitle">{cleanTitle(entry.mark.title)}</span>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="dd-body">
        <div className="dd-cover">
          {typeof s.coverFile === "string" ? <Thumb file={s.coverFile} className="big" /> : typeof s.coverUrl === "string" ? <img src={s.coverUrl} alt="" style={{ width: "100%" }} /> : null}
        </div>
        <div className="note info" style={{ fontSize: "var(--fs-s)" }}>
          {MARK_LABEL[entry.mark.kind]} since {fmtDate(entry.mark.updatedAt)}. Shown from what REWIND saved then
          {s.savedAt ? ` (${fmtDate(String(s.savedAt))})` : ""} — refresh Beyond your library for current details.
        </div>
        <dl className="kv">
          {typeof s.year === "number" && (
            <>
              <dt>Released</dt>
              <dd>{s.year} (IGDB)</dd>
            </>
          )}
          {Array.isArray(s.genres) && s.genres.length > 0 && (
            <>
              <dt>Genres</dt>
              <dd>{(s.genres as string[]).join(", ")}</dd>
            </>
          )}
        </dl>
        {typeof s.summary === "string" && <p>{s.summary}</p>}
        <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
          {store && (
            <button className="btn sm" onClick={() => void openExternal(store)}>
              Steam store page
            </button>
          )}
          {page && (
            <button className="btn sm" onClick={() => void openExternal(page)}>
              IGDB page
            </button>
          )}
          <button className="btn sm danger" onClick={onClear}>
            Remove from Saved
          </button>
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
        <div>“Not interested” hides a suggestion for {hideDays} days ({hideDays * 2} if you say it twice). Nothing is hidden forever unless you set a game to “Never suggest”.</div>
      </div>
    );
  return (
    <div className="panel">
      <div className="hd">Hidden for now <span className="count">{marks.length}</span></div>
      <div className="bd flush list">
        {marks.map((m) => {
          const until = hiddenUntil(m, hideDays);
          const active = isHidden(m, new Date(), hideDays);
          return (
            <div className="li" key={m.key}>
              <span className="t" style={{ cursor: "default" }}>{cleanTitle(m.title)}</span>
              <span className="dim mono" style={{ fontSize: "var(--fs-xs)" }}>
                {m.times > 1 ? `said ${m.times}× · ` : ""}
                {active ? `back on ${until}` : `came back ${until}`}
              </span>
              <button className="btn sm" onClick={() => onBringBack(m.key)}>
                Bring back now
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddDialog({ title, onClose, onAdd }: { title: string; onClose(): void; onAdd(o: Ownership, s: Status): Promise<void> }) {
  const [own, setOwn] = useState<Ownership>("wishlist");
  const [status, setStatus] = useState<Status>("backlog");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Add ${title} to your library`}
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
      <p style={{ margin: 0 }}>It's added with IGDB's details and cover, labelled with their source. Nothing else in your library changes.</p>
      <div className="psec">
        <span className="psec-h">Ownership</span>
        <div className="seg">
          {(["wishlist", "owned", "not_owned"] as Ownership[]).map((o) => (
            <button key={o} aria-pressed={own === o} onClick={() => setOwn(o)}>
              {OWNERSHIP.find((x) => x.id === o)!.label}
            </button>
          ))}
        </div>
      </div>
      <div className="psec">
        <span className="psec-h">Status</span>
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
      title="Discover settings"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => setP(DEFAULT_DISCOVER_PREFS)}>
            Reset to defaults
          </button>
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
      <div className="form2">
        <div className="psec">
          <span className="psec-h">Games you don't own</span>
          <div className="seg">
            {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
              <button key={s} aria-pressed={p.scope === s} onClick={() => setP({ ...p, scope: s })}>
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
          <span className="dim" style={{ fontSize: "var(--fs-s)" }}>“My library first” keeps your own games ahead of ones you'd have to buy.</span>
        </div>
        <div className="psec">
          <span className="psec-h">Shelves (order and visibility)</span>
          <div className="prefcats">
            {p.order.map((id, i) => (
              <div key={id} className="prefcat">
                <label className="check">
                  <input type="checkbox" checked={!p.hidden.includes(id)} onChange={(e) => setP({ ...p, hidden: e.target.checked ? p.hidden.filter((x) => x !== id) : [...p.hidden, id] })} />
                  {CATEGORIES[id].label}
                </label>
                <span className="grow" />
                <button className="btn ghost icon sm" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move ${CATEGORIES[id].label} up`}>
                  <Icon name="up" />
                </button>
                <button className="btn ghost icon sm" disabled={i === p.order.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${CATEGORIES[id].label} down`}>
                  <Icon name="down" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="psec">
          <span className="psec-h">Early-2000s nostalgia</span>
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <label className="row" style={{ gap: "0.3rem" }}>
              From <input className="field" type="number" min={1970} max={2030} value={p.eraFrom} onChange={(e) => num("eraFrom", e.target.value)} style={{ width: "6rem" }} />
            </label>
            <label className="row" style={{ gap: "0.3rem" }}>
              to <input className="field" type="number" min={1970} max={2030} value={p.eraTo} onChange={(e) => num("eraTo", e.target.value)} style={{ width: "6rem" }} />
            </label>
          </div>
          <div className="checks">
            {ERA_PLATFORMS.map((pl) => (
              <label key={pl.id} className="check">
                <input type="checkbox" checked={p.eraPlatforms.includes(pl.id)} onChange={(e) => setP({ ...p, eraPlatforms: e.target.checked ? [...p.eraPlatforms, pl.id] : p.eraPlatforms.filter((x) => x !== pl.id) })} />
                {pl.label}
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={p.includeReplays} onChange={(e) => setP({ ...p, includeReplays: e.target.checked })} />
            Include finished favourites as replays
          </label>
        </div>
        <div className="psec">
          <span className="psec-h">Lengths</span>
          <label className="row" style={{ gap: "0.4rem" }}>
            “Short” = main story up to <input className="field" type="number" min={2} max={30} value={p.shortMaxHours} onChange={(e) => num("shortMaxHours", e.target.value)} style={{ width: "5rem" }} /> hours
          </label>
          <label className="row" style={{ gap: "0.4rem" }}>
            “Deep RPG” = at least <input className="field" type="number" min={15} max={150} value={p.longMinHours} onChange={(e) => num("longMinHours", e.target.value)} style={{ width: "5rem" }} /> hours (main + extras)
          </label>
        </div>
        <div className="psec">
          <span className="psec-h">“Not interested”</span>
          <label className="row" style={{ gap: "0.4rem" }}>
            Hide for <input className="field" type="number" min={7} max={365} value={p.hideDays} onChange={(e) => num("hideDays", e.target.value)} style={{ width: "5rem" }} /> days (twice as long if you say it again)
          </label>
        </div>
      </div>
    </Modal>
  );
}

export { CATEGORY_IDS };
