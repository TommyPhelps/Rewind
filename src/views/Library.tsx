// Library answers one question: what do I own, and how is it organised?
// Search and the key filters are always visible; everything else sits behind "More filters".

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ContextMenu, type MenuItem } from "../ui/Overlays.tsx";
import { Cover, StatusPill, Thumb } from "../ui/bits.tsx";
import { useRemPx, useViewport, visibleRange } from "../ui/useVirtual.ts";
import { cleanTitle } from "../lib/canon.ts";
import {
  activeFilters,
  allGenres,
  allTags,
  DEFAULT_FILTERS,
  displayLength,
  filterGames,
  fmtHours,
  fmtPlaytime,
  LENGTH_FILTERS,
  META_FILTERS,
  PLAYTIME_FILTERS,
  PROGRESS_FILTERS,
  RATING_FILTERS,
  SORTS,
  sortGames,
  type LibraryFilters,
  type SortKey,
} from "../lib/library.ts";
import { LAUNCHER_LABEL, LAUNCHERS, OWNERSHIP, STATUSES, type Game, type LauncherId, type Ownership, type Status } from "../lib/types.ts";
import { playtimeMin } from "../rec/progress.ts";
import { useTaste } from "../state/recs.ts";
import { DEFAULT_WEIGHTS, EMPTY_SESSION, recommend } from "../rec/engine.ts";
import { launchTarget } from "../launchers/launch.ts";
import { mergePreview, mergeStatements, preferredKeeper } from "../lib/merge.ts";
import { CheckUpDialog } from "./CheckUp.tsx";
import { backupFileName, createBackup } from "../backup/backup.ts";
import { writeSafetySnapshot } from "../platform/native.ts";

interface LibUi {
  filters: LibraryFilters;
  sort: SortKey;
  dir: 1 | -1;
}
// Survives switching sections during a session; also saved to the database.
let memo: LibUi | null = null;

const STATUS_TABS: (Status | "all" | "open")[] = ["all", "open", "playing", "backlog", "paused", "completed", "dropped", "replay", "not_interested"];

const FILTER_LABEL: Partial<Record<keyof LibraryFilters, (f: LibraryFilters) => string>> = {
  ownership: (f) => OWNERSHIP.find((o) => o.id === f.ownership)?.label ?? "",
  launcher: (f) => (f.launcher === "none" ? "No launcher" : LAUNCHER_LABEL[f.launcher as LauncherId]),
  genre: (f) => f.genre,
  playtime: (f) => PLAYTIME_FILTERS.find((x) => x.id === f.playtime)?.label ?? "",
  rating: (f) => RATING_FILTERS.find((x) => x.id === f.rating)?.label ?? "",
  favorite: () => "Favourites",
  upNext: () => "In Up Next",
  length: (f) => LENGTH_FILTERS.find((x) => x.id === f.length)?.label ?? "",
  progress: (f) => PROGRESS_FILTERS.find((x) => x.id === f.progress)?.label ?? "",
  tag: (f) => `Tag: ${f.tag}`,
  hideMultiplayer: () => "Solo only",
  needsInfo: () => "Missing tags or length",
  meta: (f) => META_FILTERS.find((x) => x.id === f.meta)?.label ?? "",
};

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
  const { games, settings, setSettings, repo, updateGame, bulkUpdate, run, confirm, reloadAll, profile, recEvents, upNextIds, toggleUpNext, play, toast, info } = useApp();
  const { taste, series, marksByGame } = useTaste();
  const allowEst = settings.useUnverifiedLengths;
  const [ui, setUi] = useState<LibUi>(memo ?? { filters: DEFAULT_FILTERS, sort: "title", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));
  const [anchor, setAnchor] = useState(-1);
  const [cursor, setCursor] = useState(-1);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [showAdv, setShowAdv] = useState(false);
  const [checkup, setCheckup] = useState(false);
  const [bulkTag, setBulkTag] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (memo) return;
    void repo.getSetting<LibUi | null>("library_ui", null).then((saved) => {
      if (saved && !memo) setUi({ sort: saved.sort ?? "title", dir: saved.dir ?? 1, filters: { ...DEFAULT_FILTERS, ...saved.filters, query: "" } });
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
  useEffect(() => {
    if (selectedId && !selected.has(selectedId)) setSelected(new Set([selectedId]));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = ui.filters;
  const setF = (patch: Partial<LibraryFilters>) => setUi((u) => ({ ...u, filters: { ...u.filters, ...patch } }));
  const active = activeFilters(f);
  const upSet = useMemo(() => new Set(upNextIds), [upNextIds]);

  const fit = useMemo(() => {
    if (ui.sort !== "fit") return undefined;
    const r = recommend({ games, taste, events: recEvents, session: EMPTY_SESSION, weights: DEFAULT_WEIGHTS, profile, series, allowUnverified: allowEst, marks: marksByGame });
    return new Map(r.results.map((x) => [x.game.id, x.score]));
  }, [ui.sort, games, taste, recEvents, profile, series, allowEst, marksByGame]);
  const rows = useMemo(() => sortGames(filterGames(games, f, allowEst, upSet), ui.sort, ui.dir, allowEst, fit), [games, f, allowEst, upSet, ui.sort, ui.dir, fit]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of games) m.set(g.status, (m.get(g.status) ?? 0) + 1);
    return m;
  }, [games]);
  const tags = useMemo(() => allTags(games), [games]);
  const genres = useMemo(() => allGenres(games), [games]);
  const presentLaunchers = useMemo(() => LAUNCHERS.filter((l) => games.some((g) => g.sources.some((s) => s.source === l.id) || (l.id === "steam" && /steam/i.test(g.storefront ?? "")))), [games]);

  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(games.map((g) => g.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [games]);

  // ---- layout numbers for the virtual list / grid ----
  const remPx = useRemPx(`${settings.uiScale}|${window.innerWidth >= 3200 ? 2 : window.innerWidth >= 2400 ? 1 : 0}`);
  const vp = useViewport(listRef);
  const grid = settings.libraryView === "grid";
  const compact = vp.width < 52 * remPx;
  const rowH = Math.round(3.15 * remPx);
  const thumbs = settings.listCovers;
  const COLS = compact
    ? `${thumbs ? "1.9rem " : ""}minmax(10rem, 1fr) 7.5rem 4.5rem`
    : `${thumbs ? "1.9rem " : ""}minmax(14rem, 1fr) 8.5rem 5rem 5rem 5.5rem`;
  const headH = Math.round(2.3 * remPx);
  const pad = Math.round((vp.width > 1180 ? 2.2857 : vp.width > 720 ? 1.7143 : 1.1429) * remPx);
  const tileW = Math.round((settings.gridSize === "s" ? 7.5 : settings.gridSize === "l" ? 13 : 10) * remPx);
  const gap = Math.round((settings.gridSize === "s" ? 0.75 : 1.1) * remPx);
  const inner = Math.max(100, vp.width - pad * 2);
  const perRow = Math.max(1, Math.floor((inner + gap) / (tileW + gap)));
  const colW = (inner - (perRow - 1) * gap) / perRow;
  const capH = 1.9 * remPx;
  const tileH = Math.round(colW * 1.5 + capH + gap);
  const totalH = grid ? Math.ceil(rows.length / perRow) * tileH + gap * 2 : rows.length * rowH + headH;

  const selectRow = (e: { ctrlKey: boolean; shiftKey: boolean; metaKey?: boolean }, idx: number) => {
    const id = rows[idx].id;
    setCursor(idx);
    if (e.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, idx), Math.max(anchor, idx)];
      setSelected(new Set(rows.slice(a, b + 1).map((g) => g.id)));
    } else if (e.ctrlKey || e.metaKey) {
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
    const top = grid ? Math.floor(idx / perRow) * tileH + gap : idx * rowH + headH;
    const h = grid ? tileH : rowH;
    if (top < el.scrollTop + (grid ? 0 : headH)) el.scrollTop = top - (grid ? 0 : headH);
    else if (top + h > el.scrollTop + el.clientHeight) el.scrollTop = top + h - el.clientHeight;
  };

  const ids = [...selected];
  const remove = useCallback(
    async (targets: string[]) => {
      if (!targets.length) return;
      const names = targets.slice(0, 5).map((id) => cleanTitle(games.find((g) => g.id === id)?.title ?? "?"));
      const ok = await confirm({
        title: "Remove from library",
        ok: `Remove ${targets.length === 1 ? "game" : targets.length + " games"}`,
        danger: true,
        body: (
          <>
            <p>
              Remove {targets.length === 1 ? <b>{names[0]}</b> : `${targets.length} games`} from REWIND, with their notes, tags, sessions and history?
            </p>
            {targets.length > 1 && <p className="dim">{names.join(", ")}{targets.length > 5 ? "…" : ""}</p>}
            <p className="dim">This only affects REWIND. Nothing is uninstalled, and your launchers aren't touched.</p>
          </>
        ),
      });
      if (!ok) return;
      await run(async () => {
        await repo.deleteGames(targets);
        await reloadAll();
        setSelected(new Set());
        onSelect(null);
      }, `Removed ${targets.length} game${targets.length === 1 ? "" : "s"}.`);
    },
    [games, confirm, run, repo, reloadAll, onSelect],
  );

  const combine = async (a: Game, b: Game) => {
    const [keep, drop] = preferredKeeper(a, b);
    const pv = mergePreview(keep, drop);
    const ok = await confirm({
      title: "Combine into one entry",
      ok: "Combine",
      body: (
        <>
          <p>
            Keep <b>{cleanTitle(keep.title)}</b> and move everything from <b>{cleanTitle(drop.title)}</b> into it: {pv.moved.join(", ")}.
          </p>
          <p className="dim">
            Your values on the kept entry win; empty ones are filled from the other, and notes are joined. Then “{cleanTitle(drop.title)}” is removed. A safety
            copy of your library is saved first.
          </p>
        </>
      ),
    });
    if (!ok) return;
    await run(async () => {
      await writeSafetySnapshot(backupFileName("before-combine"), JSON.stringify(await createBackup(repo, info?.version ?? "?")));
      await repo.batch(mergeStatements(repo, keep, drop));
      await reloadAll();
      setSelected(new Set([keep.id]));
      onSelect(keep.id);
    }, "Combined.");
  };

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
      void remove(ids);
    } else if (e.key === "Enter" && rows[cur]) {
      onSelect(rows[cur].id);
    } else if (e.key === "Escape") {
      setSelected(new Set());
      onSelect(null);
    }
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
    const t = launchTarget(g);
    const items: MenuItem[] = [
      { heading: many ? `${targets.length} games` : cleanTitle(g.title) },
      ...(many
        ? []
        : [
            { label: t ? `Launch with ${LAUNCHER_LABEL[t.source]}` : "Start a timed session", icon: "play", onClick: () => void play(g.id) },
            { label: "Details", icon: "right", onClick: () => onSelect(g.id) },
          ]),
      { heading: "Status" },
      ...STATUSES.map((s) => ({
        label: s.label,
        icon: !many && g.status === s.id ? "check" : undefined,
        onClick: () => (many ? bulkUpdate(targets, { status: s.id }) : updateGame(g.id, { status: s.id })),
      })),
      { separator: true },
      many
        ? { label: "Add to favourites", icon: "star", onClick: () => bulkUpdate(targets, { favorite: true }) }
        : { label: g.favorite ? "Remove from favourites" : "Add to favourites", icon: "star", onClick: () => updateGame(g.id, { favorite: !g.favorite }) },
      many
        ? { label: "Add to Up Next", icon: "queue", onClick: () => void addManyToUpNext(targets) }
        : { label: upSet.has(g.id) ? "Remove from Up Next" : "Add to Up Next", icon: "queue", onClick: () => void toggleUpNext(g.id) },
      ...(targets.length === 2
        ? [{ label: "Combine these two entries…", icon: "link", onClick: () => void combine(games.find((x) => x.id === targets[0])!, games.find((x) => x.id === targets[1])!) }]
        : []),
      { separator: true },
      { label: many ? `Remove ${targets.length} from library…` : "Remove from library…", icon: "trash", danger: true, onClick: () => void remove(targets) },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const addManyToUpNext = async (targets: string[]) => {
    const add = targets.filter((id) => !upSet.has(id));
    for (const id of add) await toggleUpNext(id, true);
    if (add.length > 1) toast(`Added ${add.length} games to Up Next.`);
  };

  const sortBy = (k: SortKey) => setUi((u) => ({ ...u, sort: k, dir: u.sort === k ? (u.dir === 1 ? -1 : 1) : SORTS.find((x) => x.id === k)!.dir }));
  const sortMark = (k: SortKey) => (ui.sort === k ? (ui.dir === 1 ? " ↑" : " ↓") : "");
  const ariaSort = (k: SortKey) => (ui.sort === k ? (ui.dir === 1 ? "ascending" : "descending") : undefined);
  const anyFilter = active.length > 0 || f.query.trim() !== "" || f.status !== "all";

  const { start, end } = grid ? visibleRange(Math.ceil(rows.length / perRow), tileH, vp.top, vp.height, 2) : visibleRange(rows.length, rowH, Math.max(0, vp.top - headH), vp.height);

  const sourceValue = f.launcher !== "all" ? `l:${f.launcher}` : f.ownership !== "all" ? `o:${f.ownership}` : "";
  const setSource = (v: string) => setF({ launcher: v.startsWith("l:") ? (v.slice(2) as LauncherId | "none") : "all", ownership: v.startsWith("o:") ? (v.slice(2) as Ownership) : "all" });
  const mergeTargets = ids.length === 2 ? [games.find((g) => g.id === ids[0]), games.find((g) => g.id === ids[1])] : [];

  return (
    <div className="page fill">
      <div className="fill-head">
        <header className="page-head">
          <h1>Library</h1>
          <span className="sub">{games.length} games</span>
          <div className="acts">
            <button className="btn" onClick={() => setCheckup(true)} title="Missing details, duplicates and store links to check">
              <Icon name="shield" /> Check-up
            </button>
            <button className="btn primary" onClick={() => nav.addGame(f.query.trim())} title="Add game (Ctrl+N)">
              <Icon name="plus" /> Add game
            </button>
          </div>
        </header>
      </div>

      <div className="lib-tools">
        <div className="top">
          <div className="search lg">
            <Icon name="search" />
            <input
              id="lib-search"
              className="field"
              type="search"
              placeholder="Search titles, tags, genres, notes, developers"
              value={f.query}
              onChange={(e) => setF({ query: e.target.value })}
              aria-label="Search the library (Ctrl+F)"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  listRef.current?.focus();
                }
              }}
            />
          </div>
          <span className="spacer" />
          <label className="row nowrap" style={{ gap: "var(--s1)" }}>
            <span className="meta">Sort</span>
            <select className="select" value={ui.sort} aria-label="Sort by" onChange={(e) => sortBy(e.target.value as SortKey)}>
              {SORTS.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
            <button className="btn icon" onClick={() => setUi((u) => ({ ...u, dir: u.dir === 1 ? -1 : 1 }))} title={ui.dir === 1 ? "Ascending" : "Descending"} aria-label="Reverse sort order">
              <Icon name={ui.dir === 1 ? "up" : "down"} />
            </button>
          </label>
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={!grid} onClick={() => setSettings({ libraryView: "table" })} title="List" aria-label="List view">
              <Icon name="list" />
            </button>
            <button aria-pressed={grid} onClick={() => setSettings({ libraryView: "grid" })} title="Covers" aria-label="Cover view">
              <Icon name="grid" />
            </button>
          </div>
          {grid && (
            <div className="seg" role="group" aria-label="Cover size">
              {(["s", "m", "l"] as const).map((z) => (
                <button key={z} aria-pressed={settings.gridSize === z} onClick={() => setSettings({ gridSize: z })} title={z === "s" ? "Small covers" : z === "m" ? "Medium covers" : "Large covers"}>
                  {z.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="seg sm" role="group" aria-label="Status">
          {STATUS_TABS.map((s) => (
            <button key={s} aria-pressed={f.status === s} onClick={() => setF({ status: s })}>
              {s === "all" ? "All" : s === "open" ? "Open" : STATUSES.find((x) => x.id === s)!.label}
              <span className="n">
                {s === "all" ? games.length : s === "open" ? ["backlog", "playing", "paused", "replay"].reduce((n, k) => n + (counts.get(k) ?? 0), 0) : counts.get(s) ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="filters">
          <select className="select sm" value={sourceValue} onChange={(e) => setSource(e.target.value)} aria-label="Ownership or launcher">
            <option value="">Any source</option>
            <optgroup label="Ownership">
              {OWNERSHIP.map((o) => (
                <option key={o.id} value={`o:${o.id}`}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Launcher">
              {presentLaunchers.map((l) => (
                <option key={l.id} value={`l:${l.id}`}>{l.label}</option>
              ))}
              <option value="l:none">No launcher recorded</option>
            </optgroup>
          </select>
          <select className="select sm" value={f.genre} onChange={(e) => setF({ genre: e.target.value })} aria-label="Genre" disabled={!genres.length} title={genres.length ? "" : "Genres appear once store details are looked up"}>
            <option value="">Any genre</option>
            {genres.map((x) => (
              <option key={x.genre} value={x.genre}>{x.genre} ({x.count})</option>
            ))}
          </select>
          <select className="select sm" value={f.playtime} onChange={(e) => setF({ playtime: e.target.value as LibraryFilters["playtime"] })} aria-label="Playtime">
            {PLAYTIME_FILTERS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
          <select className="select sm" value={f.rating} onChange={(e) => setF({ rating: e.target.value as LibraryFilters["rating"] })} aria-label="Rating">
            {RATING_FILTERS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
          <button className="btn sm" aria-pressed={f.favorite} onClick={() => setF({ favorite: !f.favorite })}>
            <Icon name="star" /> Favourites
          </button>
          <button className="btn sm ghost" aria-expanded={showAdv} onClick={() => setShowAdv((v) => !v)}>
            <Icon name="filter" /> More filters
          </button>
          <span className="spacer" />
          <span className="lib-count">{rows.length === games.length ? `${rows.length} games` : `${rows.length} of ${games.length}`}</span>
        </div>

        {showAdv && (
          <div className="adv" role="group" aria-label="More filters">
            <label className="lbl">
              Length
              <select className="select sm" value={f.length} onChange={(e) => setF({ length: e.target.value as LibraryFilters["length"] })}>
                {LENGTH_FILTERS.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </label>
            <label className="lbl">
              Progress
              <select className="select sm" value={f.progress} onChange={(e) => setF({ progress: e.target.value as LibraryFilters["progress"] })}>
                {PROGRESS_FILTERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="lbl">
              Tag
              <select className="select sm" value={f.tag} onChange={(e) => setF({ tag: e.target.value })}>
                <option value="">Any tag</option>
                {tags.map((t) => (
                  <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>
                ))}
              </select>
            </label>
            <label className="lbl">
              Artwork and store match
              <select className="select sm" value={f.meta} onChange={(e) => setF({ meta: e.target.value as LibraryFilters["meta"] })}>
                {META_FILTERS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
            <div className="checks" style={{ alignContent: "end" }}>
              <label className="check">
                <input type="checkbox" checked={f.upNext} onChange={(e) => setF({ upNext: e.target.checked })} /> Only Up Next
              </label>
              <label className="check">
                <input type="checkbox" checked={f.hideMultiplayer} onChange={(e) => setF({ hideMultiplayer: e.target.checked })} /> Hide games that need other players
              </label>
              <label className="check">
                <input type="checkbox" checked={f.needsInfo} onChange={(e) => setF({ needsInfo: e.target.checked })} /> Missing tags or length
              </label>
            </div>
            <label className="check" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={settings.listCovers} onChange={(e) => setSettings({ listCovers: e.target.checked })} /> Small covers in the list
            </label>
          </div>
        )}

        {anyFilter && (
          <div className="active-f" aria-label="Active filters">
            {f.query.trim() && (
              <span className="chip user">
                “{f.query.trim()}”
                <button aria-label="Clear search" onClick={() => setF({ query: "" })}>
                  <Icon name="x" />
                </button>
              </span>
            )}
            {f.status !== "all" && (
              <span className="chip user">
                {f.status === "open" ? "Open" : STATUSES.find((s) => s.id === f.status)?.label}
                <button aria-label="Show all statuses" onClick={() => setF({ status: "all" })}>
                  <Icon name="x" />
                </button>
              </span>
            )}
            {active.map((k) => (
              <span key={k} className="chip user">
                {FILTER_LABEL[k]?.(f) ?? k}
                <button aria-label={`Remove filter ${FILTER_LABEL[k]?.(f) ?? k}`} onClick={() => setF({ [k]: DEFAULT_FILTERS[k] } as Partial<LibraryFilters>)}>
                  <Icon name="x" />
                </button>
              </span>
            ))}
            <button className="btn sm ghost" onClick={() => setUi((u) => ({ ...u, filters: DEFAULT_FILTERS }))}>
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="lib-body">
        <div className="vlist" ref={listRef} tabIndex={0} onKeyDown={onListKey} aria-label="Games" role={grid ? "grid" : "table"}>
          {rows.length === 0 ? (
            <div className="empty" style={{ padding: `var(--s5) ${pad}px` }}>
              {games.length === 0 ? (
                <>
                  <b>No games yet</b>
                  <span className="hint">Add a game, or import from Steam and other launchers in Settings → Connections.</span>
                </>
              ) : (
                <>
                  <b>No games match</b>
                  <span className="hint">Try fewer filters.</span>
                  <div className="row">
                    <button className="btn sm" onClick={() => setUi((u) => ({ ...u, filters: DEFAULT_FILTERS }))}>
                      Clear filters
                    </button>
                    {f.query.trim() && (
                      <button className="btn sm" onClick={() => nav.addGame(f.query.trim())}>
                        <Icon name="plus" /> Add “{f.query.trim()}”
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : grid ? (
            <div style={{ height: totalH, position: "relative" }}>
              {Array.from({ length: end - start }, (_, i) => start + i).map((r) => (
                <div key={r} className="cgrid" style={{ top: r * tileH + gap, columnGap: gap, padding: `0 ${pad}px`, gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
                  {rows.slice(r * perRow, r * perRow + perRow).map((g, j) => {
                    const idx = r * perRow + j;
                    return (
                      <div
                        key={g.id}
                        role="gridcell"
                        aria-selected={selected.has(g.id)}
                        className={"tile" + (selected.has(g.id) ? " sel" : "")}
                        onClick={(e) => selectRow(e, idx)}
                        onDoubleClick={() => void play(g.id)}
                        onContextMenu={(e) => openMenu(e, idx)}
                        title={cleanTitle(g.title)}
                      >
                        <Cover game={g} />
                        <div className="cap">{cleanTitle(g.title)}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ height: totalH, position: "relative" }}>
              <div className="thead" style={{ gridTemplateColumns: COLS }} role="row">
                {thumbs && <span aria-hidden="true" />}
                <button onClick={() => sortBy("title")} aria-sort={ariaSort("title")}>Title{sortMark("title")}</button>
                <button onClick={() => sortBy("status")} aria-sort={ariaSort("status")}>Status{sortMark("status")}</button>
                <button className="r" onClick={() => sortBy("playtime")} aria-sort={ariaSort("playtime")} title="Time played (the launcher's figure or the old app's, whichever is higher)">Played{sortMark("playtime")}</button>
                {!compact && <button className="r" onClick={() => sortBy("length")} aria-sort={ariaSort("length")} title="Main story with extras when known">Length{sortMark("length")}</button>}
                {!compact && <button className="r" onClick={() => sortBy("rating")} aria-sort={ariaSort("rating")}>Rating{sortMark("rating")}</button>}
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
                    onDoubleClick={() => void play(g.id)}
                    onContextMenu={(e) => openMenu(e, idx)}
                  >
                    {thumbs && <Thumb file={g.coverPath} />}
                    <div className="tt" title={g.title}>
                      <span className="t">
                        {cleanTitle(g.title)}
                        {g.favorite && <span className="muted"> ★</span>}
                      </span>
                      {(() => {
                        const sub = subline(g, upNextIds);
                        return sub ? <span className="s">{sub}</span> : null;
                      })()}
                    </div>
                    <div><StatusPill status={g.status} /></div>
                    <div className="c r">{fmtPlaytime(playtimeMin(g))}</div>
                    {!compact && <div className="c r">{g.endless ? "∞" : len ? `${len.verified ? "" : "~"}${fmtHours(len.hours)}` : "—"}</div>}
                    {!compact && <div className="c r">{g.rating ? "★".repeat(g.rating) : "—"}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {ids.length > 1 && (
        <div className="bulkbar" role="toolbar" aria-label="Selected games">
          <b>{ids.length} selected</b>
          <select className="select sm" value="" onChange={(e) => e.target.value && bulkUpdate(ids, { status: e.target.value as Status })} aria-label="Set status">
            <option value="">Set status…</option>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <select className="select sm" value="" onChange={(e) => e.target.value && bulkUpdate(ids, { ownership: e.target.value as Ownership })} aria-label="Set ownership">
            <option value="">Ownership…</option>
            {OWNERSHIP.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <button className="btn sm" onClick={() => bulkUpdate(ids, { favorite: true })}>
            <Icon name="star" /> Favourite
          </button>
          <button className="btn sm" onClick={() => void addManyToUpNext(ids)}>
            <Icon name="queue" /> Up Next
          </button>
          <form
            className="row nowrap"
            style={{ gap: "var(--s1)" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!bulkTag.trim()) return;
              await run(() => repo.bulkTag(ids, bulkTag, true), `Tagged ${ids.length} games “${bulkTag.trim().toLowerCase()}”.`);
              setBulkTag("");
              await reloadAll();
            }}
          >
            <input className="field sm" style={{ width: "8rem" }} placeholder="Add a tag" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} aria-label="Tag to add" />
            <button className="btn sm icon" type="submit" aria-label="Add tag">
              <Icon name="tag" />
            </button>
          </form>
          {mergeTargets.length === 2 && mergeTargets[0] && mergeTargets[1] && (
            <button className="btn sm" onClick={() => void combine(mergeTargets[0]!, mergeTargets[1]!)} title="These are the same game: keep one entry">
              <Icon name="link" /> Combine
            </button>
          )}
          <span className="spacer" />
          <button className="btn sm danger" onClick={() => void remove(ids)}>
            <Icon name="trash" /> Remove
          </button>
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {checkup && <CheckUpDialog nav={nav} onClose={() => setCheckup(false)} onCombine={combine} />}
    </div>
  );
}

function subline(g: Game, upNext: string[]): string {
  const bits: string[] = [];
  const n = upNext.indexOf(g.id);
  if (n >= 0) bits.push(`Up Next #${n + 1}`);
  const t = launchTarget(g);
  const srcs = [...new Set(g.sources.map((s) => LAUNCHER_LABEL[s.source]))];
  if (srcs.length) bits.push(srcs.join(", ") + (t?.installed ? " · installed" : ""));
  else if (g.storefront) bits.push(g.storefront);
  if (g.status === "completed" && g.dateCompleted) bits.push(`finished ${g.dateCompleted}`);
  const genres = g.meta.steam?.data?.genres?.slice(0, 2) ?? g.meta.igdb?.data?.genres?.slice(0, 2) ?? [];
  if (genres.length) bits.push(genres.join(", "));
  return bits.join(" · ") || " ";
}
