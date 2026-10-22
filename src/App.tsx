import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "./state/store.tsx";
import { Icon, Logo } from "./ui/Icon.tsx";
import { ConfirmHost, Toasts } from "./ui/Overlays.tsx";
import { HomeView } from "./views/Home.tsx";
import { LibraryView } from "./views/Library.tsx";
import { SettingsView, type SettingsTab } from "./views/Settings.tsx";
import { ActivityView } from "./views/Activity.tsx";
import { DiscoverView } from "./views/Discover.tsx";
import { GameDetail } from "./views/GameDetail.tsx";
import { FirstRun } from "./views/FirstRun.tsx";
import { ImportFlow, type ImportRequest } from "./views/ImportFlow.tsx";
import { PickView, type PickRequest } from "./views/Pick.tsx";
import { FeedbackDialog } from "./views/Feedback.tsx";
import { LogSessionDialog } from "./views/LogSession.tsx";
import { AddGameDialog } from "./views/AddGame.tsx";
import { PHASE_LABEL, cancelSync, useSyncState } from "./state/metaSync.ts";
import { useBeyond } from "./state/discover.ts";
import type { Session } from "./rec/engine.ts";
import type { LibraryFilters } from "./lib/library.ts";

export type ViewId = "home" | "library" | "discover" | "pick" | "activity" | "settings";

const NAV: { id: ViewId; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "library", label: "Library", icon: "library" },
  { id: "discover", label: "Discover", icon: "discover" },
  { id: "pick", label: "Pick for me", icon: "pick" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export interface Nav {
  go(view: ViewId): void;
  openGame(id: string, view?: ViewId): void;
  startImport(r: ImportRequest): void;
  librarySearch(q: string): void;
  /** Opens the Library with these filters. */
  library(filters: Partial<LibraryFilters>): void;
  /** Opens Pick for me with a ready-made session (and optionally an instant pick). */
  pick(session?: Partial<Session>, surprise?: boolean): void;
  /** Opens a Settings tab (e.g. Connections). */
  settings(tab: SettingsTab): void;
  /** The Add game dialog (optionally with a title already typed). */
  addGame(title?: string): void;
}

export function App() {
  const store = useApp();
  const { ready, fatal, games, settings, setSettings, firstRun } = store;
  const [view, setView] = useState<ViewId>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importReq, setImportReq] = useState<ImportRequest | null>(null);
  const [pendingFilters, setPendingFilters] = useState<Partial<LibraryFilters> | null>(null);
  const [pickReq, setPickReq] = useState<PickRequest | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [adding, setAdding] = useState<{ title: string } | null>(null);
  const sync = useSyncState();
  const beyond = useBeyond();

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
      settings: (tab) => {
        setSettingsTab(tab);
        setView("settings");
      },
      addGame: (title = "") => setAdding({ title }),
    }),
    [],
  );

  // Ctrl+1..6 sections, Ctrl+F search the library, Ctrl+N add a game, Ctrl+B narrow sidebar.
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
      } else if (e.key.toLowerCase() === "n" && !document.querySelector(".shade")) {
        e.preventDefault();
        setAdding({ title: "" });
      }
    },
    [settings.sidebarCollapsed, setSettings],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // The selected game disappears (removed, combined, restored over): close its panel.
  useEffect(() => {
    if (selectedId && !store.gameById.has(selectedId)) setSelectedId(null);
  }, [selectedId, store.gameById]);

  if (fatal) {
    return (
      <div className="welcome">
        <h1>REWIND couldn't open its database</h1>
        <div className="note bad mono">{fatal}</div>
        <p className="dim">
          Nothing has been changed. If an upgrade was about to run, a full copy of your library was saved in the backups folder first. Restart the app; if
          this keeps happening, keep the error text above.
        </p>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="welcome">
        <span className="led ok blink">
          <i /> Opening your library…
        </span>
      </div>
    );
  }

  const showDetail = !!selectedId && view !== "discover" && view !== "pick";

  return (
    <div className={"app" + (settings.sidebarCollapsed ? " collapsed" : "")}>
      <aside className="side">
        <div className="brand">
          <Logo />
          <b>REWIND</b>
        </div>
        <nav aria-label="Sections">
          {NAV.map((n, i) => (
            <button key={n.id} className="nav-i" aria-current={view === n.id ? "page" : undefined} onClick={() => setView(n.id)} title={`${n.label}  (Ctrl+${i + 1})`}>
              <Icon name={n.icon} />
              <span className="lbl">{n.label}</span>
              {n.id === "library" && <span className="n">{games.length}</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {sync.running && (
            <div className="task" role="status">
              <span className="led ok blink">
                <i /> <span className="txt">{sync.progress ? PHASE_LABEL[sync.progress.phase] : "Looking up details"}</span>
              </span>
              {sync.progress && sync.progress.total > 0 && (
                <div className="bar thin">
                  <i style={{ width: `${Math.round((sync.progress.done / sync.progress.total) * 100)}%` }} />
                </div>
              )}
              <span className="txt">
                {sync.progress && sync.progress.total ? `${sync.progress.done} of ${sync.progress.total} · ` : ""}
                <button className="linkish" onClick={cancelSync}>
                  Stop
                </button>
              </span>
            </div>
          )}
          {beyond.running && (
            <div className="task" role="status">
              <span className="led ok blink">
                <i /> <span className="txt">Discover: {beyond.progress?.step ?? "looking"}</span>
              </span>
            </div>
          )}
          <span className="txt">v{store.info?.version ?? "?"} · on this PC</span>
        </div>
      </aside>

      <main className="main">
        <div className="workspace">
          {firstRun && games.length === 0 && (view === "home" || view === "library") ? (
            <div className="page">
              <FirstRun nav={nav} />
            </div>
          ) : (
            <>
              {view === "home" && <HomeView nav={nav} />}
              {view === "library" && <LibraryView nav={nav} selectedId={selectedId} onSelect={setSelectedId} pendingFilters={pendingFilters} clearPending={clearPending} />}
              {view === "activity" && <ActivityView nav={nav} />}
              {view === "settings" && <SettingsView nav={nav} tab={settingsTab} onTab={setSettingsTab} />}
              {view === "pick" && <PickView nav={nav} request={pickReq} />}
              {view === "discover" && <DiscoverView nav={nav} />}
            </>
          )}
          {showDetail && selectedId && <GameDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} nav={nav} />}
        </div>
      </main>

      {importReq && <ImportFlow req={importReq} onClose={() => setImportReq(null)} nav={nav} />}
      {adding && (
        <AddGameDialog
          initialTitle={adding.title}
          onClose={() => setAdding(null)}
          onAdded={(id) => {
            setAdding(null);
            setSelectedId(id);
            if (view !== "library" && view !== "home") setView("library");
          }}
          onOpenExisting={(id) => {
            setAdding(null);
            setSelectedId(id);
            setView("library");
          }}
        />
      )}
      <FeedbackDialog />
      <LogSessionDialog />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
