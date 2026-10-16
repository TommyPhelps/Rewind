import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "./store.tsx";
import { buildTaste } from "../rec/taste.ts";
import { buildSeriesIndex } from "../rec/series.ts";
import { DEFAULT_WEIGHTS, EMPTY_SESSION, normalizeSession, type Session, type Weights } from "../rec/engine.ts";

export interface Preset {
  id: string;
  name: string;
  session: Partial<Session>;
  builtIn?: boolean;
}

export const BUILT_IN_PRESETS: Preset[] = [
  { id: "low-energy", name: "Low-energy evening", builtIn: true, session: { energy: "low", time: "1to2", avoid: ["difficulty", "setup"] } },
  { id: "story-night", name: "Story night", builtIn: true, session: { experience: "story", energy: "medium", time: "2to4" } },
  { id: "challenge", name: "Challenge me", builtIn: true, session: { experience: "mastery", energy: "high", difficulty: "challenging" } },
  { id: "quick-break", name: "Quick break", builtIn: true, session: { time: "lt30", commitment: "one", avoid: ["setup"] } },
  { id: "deep-dive", name: "Weekend deep dive", builtIn: true, session: { experience: "immersive", time: "open", commitment: "long" } },
];

let SERIES: ReturnType<typeof buildSeriesIndex> | null = null;

/** The taste model, rebuilt whenever your games, profile or feedback change. */
export function useTaste() {
  const { games, profile, recEvents, settings, marks } = useApp();
  const series = useMemo(() => (SERIES ??= buildSeriesIndex()), []);
  const taste = useMemo(() => buildTaste(games, profile, recEvents, new Date(), settings.useUnverifiedLengths), [games, profile, recEvents, settings.useUnverifiedLengths]);
  // Your Discover answers about library games ("Want to try", "Already played"…), for Pick for me.
  const marksByGame = useMemo(() => {
    const m = new Map<string, { kind: string }>();
    for (const x of marks.values()) if (x.gameId) m.set(x.gameId, x);
    return m;
  }, [marks]);
  return { taste, series, marksByGame };
}

/** Saved picker state: last session, custom presets, weights. */
export function usePickerSettings() {
  const { repo, run } = useApp();
  const [loaded, setLoaded] = useState(false);
  const [session, setSessionState] = useState<Session>(EMPTY_SESSION);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [weights, setWeightsState] = useState<Weights>(DEFAULT_WEIGHTS);

  useEffect(() => {
    void (async () => {
      const [s, p, w] = await Promise.all([
        repo.getSetting<Record<string, unknown>>("rec_last_session", {}),
        repo.getSetting<Preset[]>("rec_presets", []),
        repo.getSetting<Partial<Weights>>("rec_weights", {}),
      ]);
      setSessionState(normalizeSession(s));
      setPresets(p);
      setWeightsState({ ...DEFAULT_WEIGHTS, ...w });
      setLoaded(true);
    })();
  }, [repo]);

  const setSession = useCallback(
    (next: Session) => {
      setSessionState(next);
      void repo.setSetting("rec_last_session", next).catch(() => undefined);
    },
    [repo],
  );
  const setWeights = useCallback(
    (w: Weights) => {
      setWeightsState(w);
      void repo.setSetting("rec_weights", w).catch(() => undefined);
    },
    [repo],
  );
  const savePresets = useCallback(
    async (list: Preset[]) => {
      setPresets(list);
      await run(() => repo.setSetting("rec_presets", list));
    },
    [repo, run],
  );
  return { loaded, session, setSession, presets, savePresets, weights, setWeights };
}
