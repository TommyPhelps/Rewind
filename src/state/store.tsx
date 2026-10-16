import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Repo, type GamePatch } from "../db/repo.ts";
import { createDriver, ensureWindowOnScreen, getAppInfo, setArtBase, type AppInfo } from "../platform/native.ts";
import { DEFAULT_SETTINGS, type AppSettings, type Collection, type Game, type GamingProfile, type LengthKind } from "../lib/types.ts";
import { DEFAULT_PROFILE } from "../data/profileDefaults.ts";
import { applyReferenceData } from "../migrate/reference.ts";
import type { RecEvent } from "../rec/taste.ts";

export interface Toast {
  id: number;
  text: string;
  err?: boolean;
}

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  ok?: string;
  danger?: boolean;
}

interface Store {
  repo: Repo;
  ready: boolean;
  fatal: string | null;
  info: AppInfo | null;
  games: Game[];
  gameById: Map<string, Game>;
  collections: Collection[];
  settings: AppSettings;
  profile: GamingProfile;
  firstRun: boolean;
  /** Recommendation history: accepts, passes, drop reasons, resets. */
  recEvents: RecEvent[];
  addRecEvent(kind: string, gameId: string | null, reason?: string | null, context?: Record<string, unknown>): Promise<void>;
  /** Asks "why did you drop it?" / "how was it?" after a single game's status changes. */
  feedbackFor: { gameId: string; kind: "dropped" | "completed" } | null;
  setFeedbackFor(f: { gameId: string; kind: "dropped" | "completed" } | null): void;
  /** Opens the "Log a play session" dialog (gameId null = choose a game). */
  logFor: { gameId: string | null } | null;
  setLogFor(f: { gameId: string | null } | null): void;
  reloadAll(): Promise<void>;
  reloadCollections(): Promise<void>;
  updateGame(id: string, patch: GamePatch): Promise<void>;
  bulkUpdate(ids: string[], patch: GamePatch): Promise<void>;
  setLength(id: string, kind: LengthKind, hours: number | null): Promise<void>;
  setTags(id: string, tags: string[]): Promise<void>;
  setSettings(patch: Partial<AppSettings>): void;
  setProfile(p: GamingProfile): Promise<void>;
  finishFirstRun(): Promise<void>;
  toast(text: string, err?: boolean): void;
  toasts: Toast[];
  confirm(o: ConfirmOptions): Promise<boolean>;
  confirmState: (ConfirmOptions & { resolve(v: boolean): void }) | null;
  /** Runs an action and reports failures as a toast instead of crashing. */
  run<T>(fn: () => Promise<T>, okText?: string): Promise<T | undefined>;
}

const Ctx = createContext<Store | null>(null);

const LS_THEME = "rewind.theme";
const LS_SCALE = "rewind.scale";
const LS_DENSITY = "rewind.density";

/** Applied before React renders so the window never flashes the wrong theme. */
export function applyEarlyTheme() {
  try {
    const t = localStorage.getItem(LS_THEME);
    if (t) document.documentElement.dataset.skin = t;
    const s = localStorage.getItem(LS_SCALE);
    if (s) document.documentElement.style.setProperty("--scale", s);
    const d = localStorage.getItem(LS_DENSITY);
    if (d) document.documentElement.dataset.density = d;
  } catch {
    /* storage unavailable: defaults apply */
  }
}

function applyLook(s: AppSettings) {
  document.documentElement.dataset.skin = s.theme;
  document.documentElement.dataset.density = s.density;
  document.documentElement.style.setProperty("--scale", String(s.uiScale));
  try {
    localStorage.setItem(LS_THEME, s.theme);
    localStorage.setItem(LS_SCALE, String(s.uiScale));
    localStorage.setItem(LS_DENSITY, s.density);
  } catch {
    /* ignore */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => new Repo(createDriver()), []);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [profile, setProfileState] = useState<GamingProfile>(DEFAULT_PROFILE);
  const [firstRun, setFirstRun] = useState(false);
  const [recEvents, setRecEvents] = useState<RecEvent[]>([]);
  const [feedbackFor, setFeedbackFor] = useState<Store["feedbackFor"]>(null);
  const [logFor, setLogFor] = useState<Store["logFor"]>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<Store["confirmState"]>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const toastId = useRef(0);

  const toast = useCallback((text: string, err = false) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, err }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 7000 : 3500);
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (okText) toast(okText);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
        return undefined;
      }
    },
    [toast],
  );

  const reloadGames = useCallback(async () => setGames(await repo.loadGames()), [repo]);
  const reloadCollections = useCallback(async () => setCollections(await repo.loadCollections()), [repo]);
  const reloadRecEvents = useCallback(async () => setRecEvents(await repo.loadRecEvents()), [repo]);
  const reloadAll = useCallback(async () => {
    // Newly imported games get the bundled reference estimates (only where unknown).
    await applyReferenceData(repo).catch(() => undefined);
    await Promise.all([reloadGames(), reloadCollections(), reloadRecEvents()]);
    setProfileState(await repo.getSetting("profile", DEFAULT_PROFILE));
  }, [repo, reloadGames, reloadCollections, reloadRecEvents]);

  useEffect(() => {
    (async () => {
      try {
        await repo.init();
        const s = { ...DEFAULT_SETTINGS, ...(await repo.getSetting<Partial<AppSettings>>("app_settings", {})) };
        setSettingsState(s);
        applyLook(s);
        await reloadAll();
        const done = await repo.getSetting("first_run_done", false);
        setFirstRun(!done && (await repo.countGames()) === 0);
        const appInfo = await getAppInfo();
        setArtBase(appInfo.dataDir);
        setInfo(appInfo);
        setReady(true);
        void ensureWindowOnScreen();
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [repo, reloadAll]);

  const replaceGame = useCallback((g: Game) => setGames((gs) => gs.map((x) => (x.id === g.id ? g : x))), []);

  const gamesRef = useRef<Game[]>([]);
  gamesRef.current = games;
  const updateGame = useCallback(
    async (id: string, patch: GamePatch) => {
      const before = gamesRef.current.find((g) => g.id === id);
      const updated = await run(async () => {
        const g = await repo.updateGame(id, patch);
        replaceGame(g);
        return g;
      });
      if (updated && before && patch.status && patch.status !== before.status) {
        if (patch.status === "dropped") setFeedbackFor({ gameId: id, kind: "dropped" });
        if (patch.status === "completed" && updated.rating == null) setFeedbackFor({ gameId: id, kind: "completed" });
      }
    },
    [repo, run, replaceGame],
  );

  const addRecEvent = useCallback(
    async (kind: string, gameId: string | null, reason: string | null = null, context: Record<string, unknown> = {}) => {
      await run(async () => {
        await repo.addRecEvent(kind, gameId, reason, context);
        await reloadRecEvents();
      });
    },
    [repo, run, reloadRecEvents],
  );

  const bulkUpdate = useCallback(
    async (ids: string[], patch: GamePatch) => {
      await run(async () => {
        await repo.bulkUpdate(ids, patch);
        await reloadGames();
      }, `Updated ${ids.length} game${ids.length === 1 ? "" : "s"}.`);
    },
    [repo, run, reloadGames],
  );

  const setLength = useCallback(
    async (id: string, kind: LengthKind, hours: number | null) => {
      await run(async () => {
        await repo.setUserLength(id, kind, hours);
        const g = await repo.loadGame(id);
        if (g) replaceGame(g);
      });
    },
    [repo, run, replaceGame],
  );

  const setTags = useCallback(
    async (id: string, tags: string[]) => {
      await run(async () => {
        await repo.setTags(id, tags);
        const g = await repo.loadGame(id);
        if (g) replaceGame(g);
      });
    },
    [repo, run, replaceGame],
  );

  const setSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettingsState((prev) => {
        const next = { ...prev, ...patch };
        applyLook(next);
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void repo.setSetting("app_settings", next).catch(() => toast("Could not save settings.", true)), 300);
        return next;
      });
    },
    [repo, toast],
  );

  const setProfile = useCallback(
    async (p: GamingProfile) => {
      setProfileState(p);
      await run(() => repo.setSetting("profile", p));
    },
    [repo, run],
  );

  const finishFirstRun = useCallback(async () => {
    await repo.setSetting("first_run_done", true);
    setFirstRun(false);
  }, [repo]);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })),
    [],
  );

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const value: Store = {
    repo,
    ready,
    fatal,
    info,
    games,
    gameById,
    collections,
    settings,
    profile,
    firstRun,
    recEvents,
    addRecEvent,
    feedbackFor,
    setFeedbackFor,
    logFor,
    setLogFor,
    reloadAll,
    reloadCollections,
    updateGame,
    bulkUpdate,
    setLength,
    setTags,
    setSettings,
    setProfile,
    finishFirstRun,
    toast,
    toasts,
    confirm,
    confirmState: confirmState
      ? {
          ...confirmState,
          resolve: (v: boolean) => {
            confirmState.resolve(v);
            setConfirmState(null);
          },
        }
      : null,
    run,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useApp outside AppProvider");
  return s;
}
