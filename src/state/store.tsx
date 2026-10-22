import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Repo, type GamePatch } from "../db/repo.ts";
import { createDriver, ensureWindowOnScreen, getAppInfo, inDesktopApp, launchGame, protectSecret, setArtBase, smokeReport, snapshotDatabase, unprotectSecret, type AppInfo } from "../platform/native.ts";
import { SCHEMA_VERSION } from "../db/schema.ts";
import { DEFAULT_SETTINGS, LAUNCHER_LABEL, normalizeSettings, type AppSettings, type Collection, type Game, type GamingProfile, type LengthKind } from "../lib/types.ts";
import { cleanTitle } from "../lib/canon.ts";
import { findUpNext } from "../lib/queues.ts";
import { launchTarget } from "../launchers/launch.ts";
import { DEFAULT_PROFILE } from "../data/profileDefaults.ts";
import { applyReferenceData } from "../migrate/reference.ts";
import type { RecEvent } from "../rec/taste.ts";
import type { Mark, MarkKind } from "../discover/marks.ts";

export interface Toast {
  id: number;
  text: string;
  err?: boolean;
}

export interface LogRequest {
  gameId: string | null;
  minutes?: number;
  date?: string;
  source?: "manual" | "timed";
}

export interface PlayTimer {
  gameId: string;
  startedAt: string;
  launched: boolean;
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
  /** Your answers in Discover (Interested, Not interested, Wishlisted…), by item key. */
  marks: Map<string, Mark>;
  setMark(input: { key: string; kind: MarkKind; title: string; gameId?: string | null; snapshot?: Record<string, unknown> }): Promise<void>;
  clearMark(key: string): Promise<void>;
  /** Asks "why did you drop it?" / "how was it?" after a single game's status changes. */
  feedbackFor: { gameId: string; kind: "dropped" | "completed" } | null;
  setFeedbackFor(f: { gameId: string; kind: "dropped" | "completed" } | null): void;
  /** Opens the "Log a play session" dialog (gameId null = choose a game). A timed session arrives prefilled. */
  logFor: LogRequest | null;
  setLogFor(f: LogRequest | null): void;
  /** Up Next: your own ordered queue (kept as the "Up Next" list in the database). */
  upNext: Collection | null;
  upNextIds: string[];
  toggleUpNext(id: string, on?: boolean): Promise<void>;
  reorderUpNext(ids: string[]): Promise<void>;
  /** The game you pressed Play on, and when (kept until you stop it, even across restarts). */
  timer: PlayTimer | null;
  /** Launches through the game's launcher when it has one, and starts timing the session. */
  play(id: string): Promise<void>;
  stopTimer(): void;
  discardTimer(): Promise<void>;
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

const LS_SCALE = "rewind.scale";

/** Applied before React renders so the window never flashes at the wrong text size. */
export function applyEarlyLook() {
  try {
    const sc = localStorage.getItem(LS_SCALE);
    if (sc) document.documentElement.style.setProperty("--scale", sc);
  } catch {
    /* storage unavailable: defaults apply */
  }
}

function applyLook(s: AppSettings) {
  document.documentElement.style.setProperty("--scale", String(s.uiScale));
  try {
    localStorage.setItem(LS_SCALE, String(s.uiScale));
  } catch {
    /* ignore */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(
    () =>
      new Repo(
        createDriver(),
        inDesktopApp()
          ? {
              // Before upgrading an existing library, copy the whole database file to the backups folder.
              beforeMigrate: async (from, to) => void (await snapshotDatabase(`before-v${to}-from-v${from}`)),
              // API keys are encrypted with Windows DPAPI.
              sealer: { seal: protectSecret, open: unprotectSecret },
            }
          : {},
      ),
    [],
  );
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [profile, setProfileState] = useState<GamingProfile>(DEFAULT_PROFILE);
  const [firstRun, setFirstRun] = useState(false);
  const [recEvents, setRecEvents] = useState<RecEvent[]>([]);
  const [marks, setMarks] = useState<Map<string, Mark>>(new Map());
  const [feedbackFor, setFeedbackFor] = useState<Store["feedbackFor"]>(null);
  const [logFor, setLogFor] = useState<Store["logFor"]>(null);
  const [timer, setTimer] = useState<PlayTimer | null>(null);
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
  const reloadMarks = useCallback(async () => setMarks(new Map((await repo.loadMarks()).map((m) => [m.key, m]))), [repo]);
  const reloadAll = useCallback(async () => {
    // Newly imported games get the bundled reference estimates (only where unknown).
    await applyReferenceData(repo).catch(() => undefined);
    await Promise.all([reloadGames(), reloadCollections(), reloadRecEvents(), reloadMarks()]);
    setProfileState(await repo.getSetting("profile", DEFAULT_PROFILE));
  }, [repo, reloadGames, reloadCollections, reloadRecEvents, reloadMarks]);

  useEffect(() => {
    (async () => {
      try {
        const upgraded = await repo.init();
        await repo.sealSecrets().catch(() => 0);
        const s = normalizeSettings(await repo.getSetting<Partial<AppSettings> & Record<string, unknown>>("app_settings", {}));
        setTimer(await repo.getSetting<PlayTimer | null>("play_timer", null));
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
        void smokeReport({ ok: true, schema: SCHEMA_VERSION, upgraded, games: await repo.countGames(), version: appInfo.version, dataDir: appInfo.dataDir });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setFatal(msg);
        void smokeReport({ ok: false, error: msg });
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

  const setMark = useCallback(
    async (input: { key: string; kind: MarkKind; title: string; gameId?: string | null; snapshot?: Record<string, unknown> }) => {
      await run(async () => {
        await repo.setMark(input);
        await Promise.all([reloadMarks(), reloadRecEvents()]);
      });
    },
    [repo, run, reloadMarks, reloadRecEvents],
  );

  const clearMark = useCallback(
    async (key: string) => {
      await run(async () => {
        await repo.clearMark(key);
        await Promise.all([reloadMarks(), reloadRecEvents()]);
      });
    },
    [repo, run, reloadMarks, reloadRecEvents],
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

  const upNext = useMemo(() => findUpNext(collections), [collections]);
  const upNextIds = useMemo(() => upNext?.gameIds ?? [], [upNext]);

  const ensureUpNext = useCallback(async (): Promise<string> => {
    const cur = findUpNext(await repo.loadCollections());
    return cur ? cur.id : repo.createCollection("Up Next", "Games you plan to play next, in order.");
  }, [repo]);

  const toggleUpNext = useCallback(
    async (id: string, on?: boolean) => {
      const g = gamesRef.current.find((x) => x.id === id);
      const has = upNextIds.includes(id);
      const want = on ?? !has;
      if (want === has) return;
      await run(async () => {
        const cid = await ensureUpNext();
        if (want) await repo.addToCollection(cid, [id]);
        else await repo.removeFromCollection(cid, [id]);
        await reloadCollections();
      }, g ? (want ? `${cleanTitle(g.title)} added to Up Next.` : `${cleanTitle(g.title)} removed from Up Next.`) : undefined);
    },
    [repo, run, ensureUpNext, reloadCollections, upNextIds],
  );

  const reorderUpNext = useCallback(
    async (ids: string[]) => {
      await run(async () => {
        const cid = await ensureUpNext();
        await repo.reorderCollection(cid, ids);
        await reloadCollections();
      });
    },
    [repo, run, ensureUpNext, reloadCollections],
  );

  const play = useCallback(
    async (id: string) => {
      const g = gamesRef.current.find((x) => x.id === id);
      if (!g) return;
      const target = launchTarget(g);
      let launched = false;
      if (target) {
        try {
          await launchGame(target.uri);
          launched = true;
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), true);
          return;
        }
      }
      const t: PlayTimer = { gameId: id, startedAt: new Date().toISOString(), launched };
      setTimer(t);
      await repo.setSetting("play_timer", t).catch(() => undefined);
      if (g.status === "backlog" || g.status === "paused" || g.status === "replay") await updateGame(id, { status: "playing" });
      toast(launched ? `Starting ${cleanTitle(g.title)} through ${LAUNCHER_LABEL[target!.source]}. REWIND is timing the session.` : `Timing your ${cleanTitle(g.title)} session. Press Stop when you're done.`);
    },
    [repo, toast, updateGame],
  );

  const stopTimer = useCallback(() => {
    setTimer((t) => {
      if (t) {
        const mins = Math.round((Date.now() - Date.parse(t.startedAt)) / 60000);
        setLogFor({ gameId: t.gameId, minutes: Math.max(1, Math.min(1439, mins)), date: t.startedAt.slice(0, 10), source: "timed" });
      }
      return t;
    });
  }, []);

  const discardTimer = useCallback(async () => {
    setTimer(null);
    await repo.setSetting("play_timer", null).catch(() => undefined);
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
    marks,
    setMark,
    clearMark,
    feedbackFor,
    setFeedbackFor,
    logFor,
    setLogFor,
    upNext,
    upNextIds,
    toggleUpNext,
    reorderUpNext,
    timer,
    play,
    stopTimer,
    discardTimer,
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
