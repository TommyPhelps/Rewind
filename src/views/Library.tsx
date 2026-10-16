import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ContextMenu, Modal, type MenuItem } from "../ui/Overlays.tsx";
import { Cover, SourceBadge, Stars, StatusPill, Thumb } from "../ui/bits.tsx";
import { useRemPx, useViewport, visibleRange } from "../ui/useVirtual.ts";
import { cleanTitle, canon } from "../lib/canon.ts";
import {
  allTags,
  DEFAULT_FILTERS,
  displayLength,
  filterGames,
  fmtHours,
  fmtPlaytime,
  LENGTH_FILTERS,
  sortGames,
  type LibraryFilters,
  type SortKey,
} from "../lib/library.ts";
import { OWNERSHIP, STATUSES, type Game, type Ownership, type Status } from "../lib/types.ts";
import { companies, META_FILTERS, PROGRESS_FILTERS, releaseYear, SORTS } from "../lib/library.ts";
import { findUpNext } from "../lib/queues.ts";
import { lastPlayedAny, playtimeMin, progressRatio, progressText } from "../rec/progress.ts";
import { useTaste } from "../state/recs.ts";
import { DEFAULT_WEIGHTS, EMPTY_SESSION, recommend } from "../rec/engine.ts";

interface LibUi {
  filters: LibraryFilters;
  sort: SortKey;
  dir: 1 | -1;
}
// Survives switching views during a session; also saved to the database.
let memo: LibUi | null = null;

const COLS_FULL = "2.1rem minmax(14rem, 1fr) 9rem 6.2rem 5.6rem 5.6rem minmax(7rem, 13rem)";
const COLS_COMPACT = "2.1rem minmax(10rem, 1fr) 7.6rem 5.4rem 4.8rem";

export function LibraryView({
  nav,
  selectedId,
  onSelect,
  pendingFilters,
  clearPending,
}: {
  nav: Nav;
  selectedId: string | null;
  onSelect(id: string | null): void;
  pendingFilters: Partial<LibraryFilters> | null;
  clearPending(): void;
}) {
  const { games, settings, setSettings, collections, repo, updateGame, bulkUpdate, run, confirm, reloadAll, reloadCollections, toast, profile, recEvents } = useApp();
  const { taste, series } = useTaste();
  const allowEst = settings.useUnverifiedLengths;
  const [ui, setUi] = useState<LibUi>(memo ?? { filters: DEFAULT_FILTERS, sort: "title", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));
  const [anchor, setAnchor] = useState<number>(-1);
  const [cursor, setCursor] = useState<number>(-1);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [bulkTag, setBulkTag] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Restore saved filters once per session.
  useEffect(() => {
    if (memo) return;
    void repo.getSetting<LibUi | null>("library_ui", null).then((saved) => {
      if (saved && !memo) setUi({ ...saved, filters: { ...DEFAULT_FILTERS, ...saved.filters, query: "" } });
    });
  }, [repo]);
  useEffect(() => {
    memo = ui;
    const t = window.setTimeout(() => void repo.setSetting("library_ui", ui).catch(() => undefined), 500);
    return () => window.clearTimeout(t);
  }, [ui, repo]);
  useEffect(() => {
    if (pendingFilters != null) {
      setUi((u) => ({ ...u, filters: { ...DEFAULT_FILTERS, ...pendingFilters } }));
      clearPending();
    }
  }, [pendingFilters, clearPending]);

  const setF = (patch: Partial<LibraryFilters>) => setUi((u) => ({ ...u, filters: { ...u.filters, ...patch } }));
  const f = ui.filters;
  const activeCount = [f.length !== "all", f.ownership !== "all", f.progress !== "any", f.meta !== "any", !!f.tag, !!f.collectionId, f.favorite, f.hideMultiplayer, f.needsInfo].filter(Boolean).length;

  const members = useMemo(() => {
    if (!f.collectionId) return undefined;
    const c = collections.find((x) => x.id === f.collectionId);
    return c ? new Set(c.gameIds) : undefined;
  }, [f.collectionId, collections]);

  // "Pick-for-me fit" sort uses the same engine with no session settings.
  const fit = useMemo(() => {
    if (ui.sort !== "fit") return undefined;
    const r = recommend({ games, taste, events: recEvents, session: EMPTY_SESSION, weights: DEFAULT_WEIGHTS, profile, series, allowUnverified: allowEst });
    return new Map(r.results.map((x) => [x.game.id, x.score]));
  }, [ui.sort, games, taste, recEvents, profile, series, allowEst]);
  const rows = useMemo(
    () => sortGames(filterGames(games, f, allowEst, members), ui.sort, ui.dir, allowEst, fit),
    [games, f, allowEst, members, ui.sort, ui.dir, fit],
  );
  const upNextPos = useMemo(() => {
    const u = findUpNext(collections);
    return new Map((u?.gameIds ?? []).map((id, i) => [id, i + 1]));
  }, [collections]);
  const subline = (g: Game): string => {
    const bits: string[] = [];
    const n = upNextPos.get(g.id);
    if (n) bits.push(`Up Next #${n}`);
    const p = progressRatio(g, allowEst);
    if (g.status === "completed") bits.push(g.dateCompleted ? `finished ${g.dateCompleted}` : "finished");
    else if (p.hours >= 1) bits.push(progressText(g, allowEst));
    else bits.push("not started");
    const lp = lastPlayedAny(g);
    if (lp) bits.push(`last played ${lp}`);
    if (!g.tags.length) bits.push("no info yet");
    return bits.join(" · ");
  };
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of games) m.set(g.status, (m.get(g.status) ?? 0) + 1);
    return m;
  }, [games]);
  const tags = useMemo(() => allTags(games), [games]);

  // Keep the selection to rows that still exist.
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(games.map((g) => g.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [games]);

  const remPx = useRemPx(`${settings.uiScale}|${settings.density}`);
  const vp = useViewport(listRef);
  const grid = settings.libraryView === "grid";
  // Narrow windows (or a wide details panel) drop the rating and tag columns.
  const compact = vp.width < 50 * remPx;
  const twoLine = settings.density !== "compact";
  const rowH = Math.round((settings.density === "compact" ? 2.25 : settings.density === "spacious" ? 3.5 : 3.1) * remPx);
  const thumbs = settings.listCovers && twoLine;
  const thumbW = Math.round(((rowH - 0.5 * remPx) * 2) / 3);
  const COLS = (compact ? COLS_COMPACT : COLS_FULL).replace(/^2\.1rem /, thumbs ? `2.1rem ${thumbW}px ` : "2.1rem ");
  const headH = Math.round(2.2 * remPx);
  const tileW = Math.round((settings.gridSize === "s" ? 8.5 : settings.gridSize === "l" ? 15 : 11.5) * remPx);
  const gap = Math.round((settings.gridSize === "s" ? 0.65 : 1) * remPx);
  const perRow = Math.max(1, Math.floor((vp.width - 2 * gap + gap) / (tileW + gap)));
  const capH = (settings.gridSize === "s" ? 2.6 : 3.4) * remPx;
  const tileH = Math.round(((vp.width - 2 * gap - (perRow - 1) * gap) / perRow) * 1.5 + capH + gap);
  const totalH = grid ? Math.ceil(rows.length / perRow) * tileH + gap : rows.length * rowH + headH;

  const selectRow = (e: { ctrlKey: boolean; shiftKey: boolean }, idx: number) => {
    const id = rows[idx].id;
    setCursor(idx);
    if (e.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, idx), Math.max(anchor, idx)];
      setSelected(new Set(rows.slice(a, b + 1).map((g) => g.id)));
    } else if (e.ctrlKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      setAnchor(idx);
    } else {
      setSelected(new Set([id]));
      setAnchor(idx);
      onSelect(id);
    }
  };

  const scrollToIndex = (idx: number) => {
    const el = listRef.current;
    if (!el) return;
    const top = grid ? Math.floor(idx / perRow) * tileH : idx * rowH + headH;
    const h = grid ? tileH : rowH;
    if (top < el.scrollTop + (grid ? 0 : headH)) el.scrollTop = top - (grid ? 0 : headH);
    else if (top + h > el.scrollTop + el.clientHeight) el.scrollTop = top + h - el.clientHeight;
  };

  const ids = [...selected];
  const deleteSelection = useCallback(
    async (targets: string[]) => {
      if (!targets.length) return;
      const names = targets.slice(0, 5).map((id) => cleanTitle(games.find((g) => g.id === id)?.title ?? "?"));
      const ok = await confirm({
        title: "Remove from library",
        ok: `Remove ${targets.length}`,
        danger: true,
        body: (
          <>
            <p style={{ marginTop: 0 }}>
              Remove {targets.length === 1 ? <b>{names[0]}</b> : `${targets.length} games`} from REWIND, with their notes, lengths, tags and history?
            </p>
            {targets.length > 1 && <p className="dim">{names.join(", ")}{targets.length > 5 ? "…" : ""}</p>}
            <p className="dim" style={{ marginBottom: 0 }}>This only affects REWIND. Nothing is uninstalled.</p>
          </>
        ),
      });
      if (!ok) return;
      await run(async () => {
        await repo.deleteGames(targets);
        await reloadAll();
        setSelected(new Set());
      }, `Removed ${targets.length} game${targets.length === 1 ? "" : "s"}.`);
    },
    [games, confirm, run, repo, reloadAll],
  );

  const onListKey = (e: RKeyboardEvent) => {
    if (!rows.length) return;
    const cur = cursor >= 0 && cursor < rows.length ? cursor : 0;
    const step = grid ? (e.key === "ArrowLeft" || e.key === "ArrowRight" ? 1 : perRow) : 1;
    let next = -1;
    if (e.key === "ArrowDown" || (grid && e.key === "ArrowRight")) next = Math.min(rows.length - 1, cur + step);
    if (e.key === "ArrowUp" || (grid && e.key === "ArrowLeft")) next = Math.max(0, cur - step);
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = rows.length - 1;
    if (next >= 0) {
      e.preventDefault();
      selectRow({ ctrlKey: false, shiftKey: e.shiftKey && anchor >= 0 }, next);
      scrollToIndex(next);
    } else if (e.key === "a" && e.ctrlKey) {
      e.preventDefault();
      setSelected(new Set(rows.map((g) => g.id)));
    } else if (e.key === "Delete") {
      e.preventDefault();
      void deleteSelection(ids);
    } else if (e.key === "Escape") {
      setSelected(new Set());
      onSelect(null);
    }
  };

  const addToCollection = async (cid: string, targets: string[]) => {
    const n = await run(() => repo.addToCollection(cid, targets));
    await reloadCollections();
    const c = collections.find((x) => x.id === cid);
    if (n !== undefined) toast(`Added ${n} to ${c?.name ?? "collection"}${n < targets.length ? ` (${targets.length - n} already there)` : ""}.`);
  };

  const openMenu = (e: RMouseEvent, idx: number) => {
    e.preventDefault();
    const g = rows[idx];
    let targets = ids;
    if (!selected.has(g.id)) {
      setSelected(new Set([g.id]));
      setAnchor(idx);
      onSelect(g.id);
      targets = [g.id];
    }
    const many = targets.length > 1;
    const items: MenuItem[] = [
      { heading: many ? `${targets.length} games` : cleanTitle(g.title) },
      ...(many ? [] : [{ label: "Open details", icon: "right", onClick: () => onSelect(g.id) }]),
      { heading: "Set status" },
      ...STATUSES.map((s) => ({
        label: s.label,
        icon: !many && g.status === s.id ? "check" : undefined,
        onClick: () => (many ? bulkUpdate(targets, { status: s.id }) : updateGame(g.id, { status: s.id })),
      })),
      { separator: true },
      many
        ? { label: "Mark as favorites", icon: "star", onClick: () => bulkUpdate(targets, { favorite: true }) }
        : { label: g.favorite ? "Remove favorite" : "Mark as favorite", icon: "star", onClick: () => updateGame(g.id, { favorite: !g.favorite }) },
      ...(collections.length ? [{ heading: "Add to collection" }] : []),
      ...collections.slice(0, 8).map((c) => ({ label: c.name, icon: "collections", onClick: () => void addToCollection(c.id, targets) })),
      { separator: true },
      { label: many ? `Remove ${targets.length} from library…` : "Remove from library…", icon: "trash", danger: true, onClick: () => void deleteSelection(targets) },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const sortBy = (k: SortKey) =>
    setUi((u) => ({ ...u, sort: k, dir: u.sort === k ? (u.dir === 1 ? -1 : 1) : k === "title" || k === "status" ? 1 : -1 }));
  const sortMark = (k: SortKey) => (ui.sort === k ? (ui.dir === 1 ? " ▲" : " ▼") : "");
  const filtersActive =
    JSON.stringify({ ...f, query: "" }) !== JSON.stringify({ ...DEFAULT_FILTERS, query: "" }) || f.query.trim() !== "";

  const { start, end } = grid
    ? visibleRange(Math.ceil(rows.length / perRow), tileH, vp.top, vp.height, 2)
    : visibleRange(rows.length, rowH, Math.max(0, vp.top - headH), vp.height);

  return (
    <div className="content fill">
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input
            id="lib-search"
            className="field"
            type="search"
            placeholder="Search titles, tags, notes, developers  (Ctrl+F)"
            value={f.query}
            onChange={(e) => setF({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                listRef.current?.focus();
              }
            }}
          />
        </div>
        <button className="btn sm filt-toggle" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
          Filters{activeCount ? ` (${activeCount})` : ""} {showFilters ? "▴" : "▾"}
        </button>
        <div className={"filt" + (showFilters ? " open" : "")}>
        <select className="select" value={f.length} onChange={(e) => setF({ length: e.target.value as LibraryFilters["length"] })} aria-label="Length">
          {LENGTH_FILTERS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <select className="select" value={f.ownership} onChange={(e) => setF({ ownership: e.target.value as Ownership | "all" })} aria-label="Ownership">
          <option value="all">Any ownership</option>
          {OWNERSHIP.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <select className="select" value={f.progress} onChange={(e) => setF({ progress: e.target.value as LibraryFilters["progress"] })} aria-label="Progress">
          {PROGRESS_FILTERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <select className="select" value={f.meta} onChange={(e) => setF({ meta: e.target.value as LibraryFilters["meta"] })} aria-label="Artwork and Steam match" style={{ maxWidth: "12rem" }}>
          {META_FILTERS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <select className="select" value={f.tag} onChange={(e) => setF({ tag: e.target.value })} aria-label="Tag" style={{ maxWidth: "11rem" }}>
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>
          ))}
        </select>
        <select className="select" value={f.collectionId} onChange={(e) => setF({ collectionId: e.target.value })} aria-label="Collection" style={{ maxWidth: "11rem" }}>
          <option value="">Any collection</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="btn icon" aria-pressed={f.favorite} onClick={() => setF({ favorite: !f.favorite })} title="Favorites only">
          <Icon name="star" />
        </button>
        <button className="btn sm" aria-pressed={f.hideMultiplayer} onClick={() => setF({ hideMultiplayer: !f.hideMultiplayer })} title="Hide games that need other players">
          solo only
        </button>
        <button className="btn sm" aria-pressed={f.needsInfo} onClick={() => setF({ needsInfo: !f.needsInfo })} title="Games with no tags or no length yet">
          needs info
        </button>
        </div>
        <span className="divider" />
        <label className="row" style={{ gap: 4 }}>
          <span className="mono dim" style={{ fontSize: "var(--fs-xs)" }}>Sort</span>
          <select
            className="select"
            value={ui.sort}
            aria-label="Sort by"
            onChange={(e) => {
              const k = e.target.value as SortKey;
              setUi((u) => ({ ...u, sort: k, dir: SORTS.find((x) => x.id === k)!.dir }));
            }}
          >
            {SORTS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
          <button className="btn icon sm" onClick={() => setUi((u) => ({ ...u, dir: u.dir === 1 ? -1 : 1 }))} title={ui.dir === 1 ? "Ascending" : "Descending"} aria-label="Reverse sort order">
            <Icon name={ui.dir === 1 ? "up" : "down"} />
          </button>
        </label>
        {filtersActive && (
          <button className="btn sm ghost" onClick={() => setUi((u) => ({ ...u, filters: DEFAULT_FILTERS }))}>
            clear
          </button>
        )}
        <span className="divider" />
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={!grid} onClick={() => setSettings({ libraryView: "table" })} title="Table">
            <Icon name="list" />
          </button>
          <button aria-pressed={grid} onClick={() => setSettings({ libraryView: "grid" })} title="Cover grid">
            <Icon name="grid" />
          </button>
        </div>
        {grid ? (
          <div className="seg" role="group" aria-label="Cover size">
            {(["s", "m", "l"] as const).map((z) => (
              <button key={z} aria-pressed={settings.gridSize === z} onClick={() => setSettings({ gridSize: z })} title={z === "s" ? "Small covers" : z === "m" ? "Medium covers" : "Large covers"}>
                {z.toUpperCase()}
              </button>
            ))}
          </div>
        ) : (
          <button className="btn sm" aria-pressed={settings.listCovers} onClick={() => setSettings({ listCovers: !settings.listCovers })} title="Small covers in the list">
            covers
          </button>
        )}
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add game
        </button>
      </div>

      <div className="subbar">
        <div className="seg" role="group" aria-label="Status">
          {(["all", "open", ...STATUSES.map((s) => s.id)] as (Status | "all" | "open")[]).map((s) => (
            <button key={s} aria-pressed={f.status === s} onClick={() => setF({ status: s })}>
              {s === "all" ? "All" : s === "open" ? "Open" : STATUSES.find((x) => x.id === s)!.label}
              <span className="n num">
                {s === "all"
                  ? games.length
                  : s === "open"
                    ? ["backlog", "playing", "paused", "replay"].reduce((n, k) => n + (counts.get(k) ?? 0), 0)
                    : counts.get(s) ?? 0}
              </span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="led info">
          <i /> {rows.length === games.length ? `${rows.length} games` : `${rows.length} of ${games.length}`}
        </span>
      </div>

      {ids.length > 1 && (
        <div className="bulkbar" role="toolbar" aria-label="Bulk edit">
          <b>{ids.length} selected</b>
          <select className="select" value="" onChange={(e) => e.target.value && bulkUpdate(ids, { status: e.target.value as Status })} aria-label="Set status">
            <option value="">Set status…</option>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <select className="select" value="" onChange={(e) => e.target.value && bulkUpdate(ids, { ownership: e.target.value as Ownership })} aria-label="Set ownership">
            <option value="">Ownership…</option>
            {OWNERSHIP.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <button className="btn sm" onClick={() => bulkUpdate(ids, { favorite: true })}>
            <Icon name="star" /> Favorite
          </button>
          <button className="btn sm" onClick={() => bulkUpdate(ids, { favorite: false })}>Unfavorite</button>
          {collections.length > 0 && (
            <select className="select" value="" onChange={(e) => e.target.value && void addToCollection(e.target.value, ids)} aria-label="Add to collection">
              <option value="">Add to collection…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <form
            className="row"
            style={{ gap: 4 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!bulkTag.trim()) return;
              await run(() => repo.bulkTag(ids, bulkTag, true), `Tagged ${ids.length} games "${bulkTag.trim().toLowerCase()}".`);
              setBulkTag("");
              await reloadAll();
            }}
          >
            <input className="field" style={{ width: "8rem", minHeight: "1.6rem" }} placeholder="add tag" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} />
            <button className="btn sm" type="submit">
              <Icon name="tag" />
            </button>
          </form>
          <button className="btn sm danger" onClick={() => void deleteSelection(ids)}>
            <Icon name="trash" /> Remove
          </button>
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="vlist" ref={listRef} tabIndex={0} onKeyDown={onListKey} aria-label="Game list" role={grid ? "grid" : "table"}>
        {rows.length === 0 ? (
          <div style={{ padding: "1.5rem" }}>
            <div className="empty">
              {games.length === 0 ? "Your library is empty. Import your old REWIND data from Settings, or add a game." : "No games match these filters."}
            </div>
          </div>
        ) : grid ? (
          <div style={{ height: totalH, position: "relative" }}>
            {Array.from({ length: end - start }, (_, i) => start + i).map((r) => (
              <div key={r} className={"cgrid sz-" + settings.gridSize} style={{ top: r * tileH + gap, gap, padding: `0 ${gap}px`, gridTemplateColumns: `repeat(${perRow}, 1fr)` }}>
                {rows.slice(r * perRow, r * perRow + perRow).map((g, j) => {
                  const idx = r * perRow + j;
                  const len = displayLength(g, allowEst);
                  const pt = playtimeMin(g);
                  const by = companies(g)[0] ?? g.developer;
                  const yr = releaseYear(g);
                  const n = upNextPos.get(g.id);
                  return (
                    <div
                      key={g.id}
                      role="gridcell"
                      aria-selected={selected.has(g.id)}
                      className={"tile" + (selected.has(g.id) ? " sel" : "") + (cursor === idx ? " cur" : "")}
                      onClick={(e) => selectRow(e, idx)}
                      onContextMenu={(e) => openMenu(e, idx)}
                      title={cleanTitle(g.title)}
                    >
                      <div className="tile-art">
                        <Cover game={g} />
                        <div className="tile-over">
                          <StatusPill status={g.status} />
                          {n && <span className="chip upn">#{n}</span>}
                          <span className="grow" />
                          {pt ? <span className="pt mono">{fmtPlaytime(pt)}</span> : null}
                        </div>
                      </div>
                      <div className="cap">{cleanTitle(g.title)}</div>
                      {settings.gridSize !== "s" && (
                        <div className="meta">
                          <span className="ellipsis dim">{[by, yr].filter(Boolean).join(" · ") || "\u00a0"}</span>
                          <span className="num dim">{g.endless ? <Endless game={g} /> : len ? fmtHours(len.hours) : ""}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ height: totalH, position: "relative", minWidth: compact ? "30rem" : "52rem" }}>
            <div className="thead" style={{ gridTemplateColumns: COLS }} role="row">
              <button onClick={() => setF({ favorite: !f.favorite })} title="Favorites" aria-label="Favorites">★</button>
              {thumbs && <span aria-hidden="true" />}
              <button onClick={() => sortBy("title")} aria-sort={ui.sort === "title" ? (ui.dir === 1 ? "ascending" : "descending") : undefined}>Title{sortMark("title")}</button>
              <button onClick={() => sortBy("status")} aria-sort={ui.sort === "status" ? "other" : undefined}>Status{sortMark("status")}</button>
              <button className="r" onClick={() => sortBy("length")} aria-sort={ui.sort === "length" ? "other" : undefined} title="Main + extras when known, otherwise main story">Length{sortMark("length")}</button>
              <button className="r" onClick={() => sortBy("playtime")} aria-sort={ui.sort === "playtime" ? "other" : undefined} title="Time played: Steam's figure or the old app's, whichever is higher">Played{sortMark("playtime")}</button>
              {!compact && <button onClick={() => sortBy("rating")} aria-sort={ui.sort === "rating" ? "other" : undefined}>Rating{sortMark("rating")}</button>}
              {!compact && <button onClick={() => sortBy("updated")} aria-sort={ui.sort === "updated" ? "other" : undefined} title="Sort by last change">Tags{ui.sort === "updated" ? sortMark("updated") : ""}</button>}
            </div>
            {rows.slice(start, end).map((g, i) => {
              const idx = start + i;
              const len = displayLength(g, allowEst);
              return (
                <div
                  key={g.id}
                  role="row"
                  className={"trow" + (selected.has(g.id) ? " sel" : "")}
                  style={{ top: headH + idx * rowH, height: rowH, gridTemplateColumns: COLS }}
                  onClick={(e) => selectRow(e, idx)}
                  onContextMenu={(e) => openMenu(e, idx)}
                >
                  <div>
                    <button
                      className={"star" + (g.favorite ? " on" : "")}
                      aria-label={g.favorite ? "Remove favorite" : "Mark favorite"}
                      onClick={(e) => {
                        e.stopPropagation();
                        void updateGame(g.id, { favorite: !g.favorite });
                      }}
                    >
                      <Icon name="star" />
                    </button>
                  </div>
                  {thumbs && <Thumb file={g.coverPath} />}
                  <div className="title" title={g.title}>
                    <span className="tt">{cleanTitle(g.title)}</span>
                    {twoLine && <span className="sub">{subline(g)}</span>}
                  </div>
                  <div><StatusPill status={g.status} /></div>
                  <div className="r num">
                    {g.endless ? <Endless game={g} /> : len ? (
                      <>
                        {fmtHours(len.hours)}
                        {!len.verified && <SourceBadge source={len.source} />}
                      </>
                    ) : <span className="dim">—</span>}
                  </div>
                  <div className="r num">{fmtPlaytime(playtimeMin(g))}</div>
                  {!compact && <div><Stars value={g.rating} /></div>}
                  {!compact && <div className="tags">{g.tags.slice(0, 4).map((t) => t.tag).join(" · ")}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {adding && (
        <AddGameDialog
          onClose={() => setAdding(false)}
          onAdded={(g) => {
            setAdding(false);
            setSelected(new Set([g.id]));
            onSelect(g.id);
            nav.go("library");
          }}
        />
      )}
    </div>
  );
}

function Endless({ game }: { game: Game }) {
  const mine = game.metaSource.endless === "user";
  return (
    <span className={mine ? undefined : "dim"} title={mine ? "Endless / sandbox (you)" : "Endless / sandbox (old REWIND table, unverified)"}>
      ∞
    </span>
  );
}

function AddGameDialog({ onClose, onAdded }: { onClose(): void; onAdded(g: Game): void }) {
  const { repo, run, reloadAll, games } = useApp();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("backlog");
  const [ownership, setOwnership] = useState<Ownership>("owned");
  const [platform, setPlatform] = useState("PC");
  const dup = useMemo(() => {
    const k = canon(title);
    return k ? games.find((g) => g.canon === k) : undefined;
  }, [title, games]);
  const save = async () => {
    if (!title.trim()) return;
    const g = await run(() => repo.addGame({ title, status, ownership, platform }), `Added ${title.trim()}.`);
    if (g) {
      await reloadAll();
      onAdded(g);
    }
  };
  return (
    <Modal
      title="Add a game"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!title.trim()}>Add game</button>
        </>
      }
    >
      <label className="lbl">
        Title
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} autoFocus />
      </label>
      {dup && (
        <div className="note">
          <b>{cleanTitle(dup.title)}</b> is already in your library. You can still add this if it's a different game or edition.
        </div>
      )}
      <div className="form2">
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
          Platform
          <input className="field" value={platform} onChange={(e) => setPlatform(e.target.value)} />
        </label>
      </div>
      <p className="dim" style={{ margin: 0, fontSize: "var(--fs-s)" }}>
        Length, tags and other details stay empty until you fill them in or a metadata source is connected (Phase 3). Nothing is guessed.
      </p>
    </Modal>
  );
}
