import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "./state/store.tsx";
import { Icon, Logo } from "./ui/Icon.tsx";
import { ConfirmHost, Toasts } from "./ui/Overlays.tsx";
import { HomeView } from "./views/Home.tsx";
import { LibraryView } from "./views/Library.tsx";
import { CollectionsView } from "./views/Collections.tsx";
import { SettingsView } from "./views/Settings.tsx";
import { ActivityView } from "./views/Activity.tsx";
import { PlannedView } from "./views/Planned.tsx";
import { GameDetail } from "./views/GameDetail.tsx";
import { FirstRun } from "./views/FirstRun.tsx";
import { ImportFlow, type ImportRequest } from "./views/ImportFlow.tsx";
import { PickView, type PickRequest } from "./views/Pick.tsx";
import { FeedbackDialog } from "./views/Feedback.tsx";
import { LogSessionDialog } from "./views/LogSession.tsx";
import { MetadataView } from "./views/Metadata.tsx";
import { PHASE_LABEL, useSyncState } from "./state/metaSync.ts";
import type { Session } from "./rec/engine.ts";
import type { LibraryFilters } from "./lib/library.ts";

export type ViewId = "home" | "library" | "discover" | "pick" | "mods" | "activity" | "collections" | "metadata" | "settings";

const NAV: { id: ViewId; label: string; icon: string; phase?: number }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "library", label: "Library", icon: "library" },
  { id: "discover", label: "Discover", icon: "discover", phase: 4 },
  { id: "pick", label: "Pick for me", icon: "pick" },
  { id: "mods", label: "Mods & Modpacks", icon: "mods", phase: 4 },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "collections", label: "Collections", icon: "collections" },
  { id: "metadata", label: "Steam & metadata", icon: "download" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export interface Nav {
  go(view: ViewId): void;
  openGame(id: string, view?: ViewId): void;
  startImport(r: ImportRequest): void;
  librarySearch(q: string): void;
  /** Opens the Library with these filters. */
  library(filters: Partial<LibraryFilters>): void;
  /** Opens Pick for me with a ready-made session (and optionally an instant Surprise). */
  pick(session?: Partial<Session>, surprise?: boolean): void;
}

export function App() {
  const store = useApp();
  const { ready, fatal, games, settings, setSettings, firstRun, collections } = store;
  const [view, setView] = useState<ViewId>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importReq, setImportReq] = useState<ImportRequest | null>(null);
  const [pendingFilters, setPendingFilters] = useState<Partial<LibraryFilters> | null>(null);
  const [pickReq, setPickReq] = useState<PickRequest | null>(null);
  const sync = useSyncState();

  const clearPending = useCallback(() => setPendingFilters(null), []);
  const nav: Nav = useMemo(
    () => ({
      go: (v) => setView(v),
      openGame: (id, v) => {
        setSelectedId(id);
        if (v) setView(v);
      },
      startImport: (r) => setImportReq(r),
      librarySearch: (q) => {
        setPendingFilters({ query: q });
        setView("library");
      },
      library: (filters) => {
        setPendingFilters(filters);
        setView("library");
      },
      pick: (session, surprise) => {
        setPickReq({ session, surprise, nonce: Date.now() });
        setView("pick");
      },
    }),
    [],
  );

  // Global shortcuts: Ctrl+1..8 navigate, Ctrl+B sidebar, Ctrl+F search the library.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= NAV.length) {
        e.preventDefault();
        setView(NAV[n - 1].id);
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        setView("library");
        window.setTimeout(() => document.getElementById("lib-search")?.focus(), 0);
      }
    },
    [settings.sidebarCollapsed, setSettings],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // Selected game disappears (deleted, restored over) -> close the panel.
  useEffect(() => {
    if (selectedId && !store.gameById.has(selectedId)) setSelectedId(null);
  }, [selectedId, store.gameById]);

  if (fatal) {
    return (
      <div className="welcome">
        <div className="note bad">
          <b>REWIND could not open its database.</b>
          <div className="mono" style={{ marginTop: 6 }}>{fatal}</div>
          <div style={{ marginTop: 6 }}>Your data has not been changed. Restart the app; if this keeps happening, keep the error text above.</div>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="welcome">
        <span className="led ok"><i /> Opening library…</span>
      </div>
    );
  }

  const cur = NAV.find((n) => n.id === view)!;
  const showDetail = !!selectedId && (view === "library" || view === "home" || view === "collections" || view === "activity" || view === "metadata");
  const upNext = collections.find((c) => c.name.toLowerCase() === "up next");
  const playing = games.filter((g) => g.status === "playing").length;

  return (
    <div className="app">
      <aside className={"side" + (settings.sidebarCollapsed ? " collapsed" : "")}>
        <div className="brand">
          <Logo />
          <div className="txt">
            <b>REWIND</b>
            <small>game companion</small>
          </div>
        </div>
        <nav aria-label="Sections">
          <div className="grp">Navigate</div>
          {NAV.map((n, i) => (
            <button
              key={n.id}
              aria-current={view === n.id ? "page" : undefined}
              onClick={() => setView(n.id)}
              title={`${n.label}  (Ctrl+${i + 1})`}
            >
              <Icon name={n.icon} />
              <span className="lbl">{n.label}</span>
              {n.id === "library" && <span className="cnt num">{games.length}</span>}
              {n.phase && <span className="soon">P{n.phase}</span>}
            </button>
          ))}
        </nav>
        <div className="foot">
          <button className="btn ghost sm" onClick={() => setSettings({ sidebarCollapsed: !settings.sidebarCollapsed })} title="Collapse sidebar (Ctrl+B)">
            <Icon name={settings.sidebarCollapsed ? "right" : "left"} />
            <span className="lbl">Collapse</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="titlebar">
          <h1>{cur.label}</h1>
          <span className="sub">{subtitle(view)}</span>
          <div className="right">
            <span className="led ok" title="Everything is stored on this PC">
              <i /> local
            </span>
          </div>
        </header>
        <div className="workspace">
          {firstRun && (view === "home" || view === "library") ? (
            <div className="content pad">
              <FirstRun nav={nav} />
            </div>
          ) : (
            <>
              {view === "home" && <HomeView nav={nav} />}
              {view === "library" && (
                <LibraryView nav={nav} selectedId={selectedId} onSelect={setSelectedId} pendingFilters={pendingFilters} clearPending={clearPending} />
              )}
              {view === "collections" && <CollectionsView nav={nav} selectedId={selectedId} />}
              {view === "activity" && <ActivityView nav={nav} />}
              {view === "settings" && <SettingsView nav={nav} />}
              {view === "metadata" && <MetadataView nav={nav} />}
              {view === "pick" && <PickView nav={nav} request={pickReq} />}
              {(view === "discover" || view === "mods") && <PlannedView view={view} />}
            </>
          )}
          {showDetail && selectedId && <GameDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} />}
        </div>
      </main>

      <footer className="statusbar">
        <span className="led ok">
          <i /> SQLite ok
        </span>
        <span className="sep" />
        <span>{games.length} games</span>
        {sync.running && (
          <button className="sbtn" onClick={() => setView("metadata")} title="Metadata sync in progress">
            <span className="led ok blink"><i /></span> {sync.progress ? `${PHASE_LABEL[sync.progress.phase]} ${sync.progress.total ? `${sync.progress.done}/${sync.progress.total}` : ""}` : "Starting sync…"}
          </button>
        )}
        <span>{playing} playing</span>
        {upNext && <span>{upNext.gameIds.length} up next</span>}
        <div className="right">
          <span>offline-ready</span>
          <span className="sep" />
          <span>v{store.info?.version ?? "?"}</span>
        </div>
      </footer>

      {importReq && <ImportFlow req={importReq} onClose={() => setImportReq(null)} nav={nav} />}
      <FeedbackDialog />
      <LogSessionDialog />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}

function subtitle(v: ViewId): string {
  switch (v) {
    case "home":
      return "what's going on in your library";
    case "library":
      return "everything you own, track and plan to play";
    case "collections":
      return "your own lists, in your own order";
    case "activity":
      return "a record of real changes only";
    case "settings":
      return "themes, profile, data and backups";
    case "metadata":
      return "your Steam library, covers and game details";
    case "pick":
      return "explainable suggestions from your own library";
    case "discover":
      return "beyond your library — later phase";
    case "mods":
      return "modpacks and modding companion — later phase";
  }
}
