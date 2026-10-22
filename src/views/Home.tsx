// Home answers one question: what am I playing, and what's next?
// In order: what you're playing, tonight's suggestion, games to continue, your Up Next
// queue, and a few recent changes. Sections with nothing in them aren't shown.

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Cover, fmtClock, fmtDay, fmtMinutes, Thumb } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { displayLength, fmtHours } from "../lib/library.ts";
import { LAUNCHER_LABEL, type EventRow, type Game } from "../lib/types.ts";
import { describeEvent } from "./GameDetail.tsx";
import { useTaste } from "../state/recs.ts";
import { DEFAULT_WEIGHTS, diversify, EMPTY_SESSION, normalizeSession, recommend, type Rec, type Session } from "../rec/engine.ts";
import { resumeCandidates } from "../lib/queues.ts";
import { lastPlayedAny, progressRatio, progressText } from "../rec/progress.ts";
import { explain } from "../rec/explain.ts";
import { launchTarget } from "../launchers/launch.ts";
import { artSrc } from "../platform/native.ts";
import { UpNextDialog } from "./UpNext.tsx";

export function HomeView({ nav }: { nav: Nav }) {
  const { games, gameById, settings, repo, profile, recEvents, upNextIds, toggleUpNext, timer, play, addRecEvent } = useApp();
  const { taste, series, marksByGame } = useTaste();
  const allowEst = settings.useUnverifiedLengths;
  const [events, setEvents] = useState<EventRow[]>([]);
  const [lastSession, setLastSession] = useState<Session | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [editingQueue, setEditingQueue] = useState(false);

  useEffect(() => {
    void repo.recentEvents(6).then(setEvents);
  }, [repo, games]);
  useEffect(() => {
    void repo.getSetting<Record<string, unknown>>("rec_last_session", {}).then((s) => setLastSession(normalizeSession(s)));
  }, [repo]);

  const playing = useMemo(() => games.filter((g) => g.status === "playing").sort(byRecent), [games]);
  const resumeAll = useMemo(() => resumeCandidates(games, allowEst).filter((g) => g.status !== "playing"), [games, allowEst]);
  const queue = useMemo(() => upNextIds.map((id) => gameById.get(id)).filter((g): g is Game => !!g), [upNextIds, gameById]);

  // Tonight: what you last asked Pick for me for (or no preference), for a game you're not already playing.
  const tonight: Rec | null = useMemo(() => {
    const session: Session = { ...(lastSession ?? EMPTY_SESSION), intent: lastSession?.intent === "continue" ? "any" : lastSession?.intent ?? "any" };
    const r = recommend({ games, taste, events: recEvents, session, weights: DEFAULT_WEIGHTS, profile, series, allowUnverified: allowEst, marks: marksByGame });
    const pool = r.results.filter((x) => !x.heldBack && x.game.status !== "playing" && !skipped.includes(x.game.id));
    return diversify(pool, 1, taste.idf)[0] ?? null;
  }, [lastSession, games, taste, recEvents, profile, series, allowEst, marksByGame, skipped]);

  // Each game appears once on Home: tonight's pick isn't repeated under Continue.
  const resume = useMemo(() => resumeAll.filter((g) => g.id !== tonight?.game.id).slice(0, 6), [resumeAll, tonight]);
  const timing = timer ? gameById.get(timer.gameId) ?? null : null;
  const nothing = !playing.length && !tonight && !resume.length && !queue.length && !events.length;

  return (
    <div className="page">
      <div className="page-in">
        <header className="page-head">
          <h1>Home</h1>
          <div className="acts">
            <button className="btn" onClick={() => nav.addGame()}>
              <Icon name="plus" /> Add game
            </button>
            <button className="btn" onClick={() => nav.pick()}>
              <Icon name="pick" /> Pick for me
            </button>
          </div>
        </header>

        {nothing && (
          <div className="empty">
            <b>Your library is empty</b>
            <span className="hint">Add a game, import your Steam library, or restore a backup to get started.</span>
            <div className="row">
              <button className="btn primary" onClick={() => nav.addGame()}>
                Add a game
              </button>
              <button className="btn" onClick={() => nav.settings("connections")}>
                Import from Steam and other launchers
              </button>
            </div>
          </div>
        )}

        {(playing.length > 0 || timing) && (
          <section className="sec" aria-labelledby="h-now">
            <div className="sec-h">
              <h2 id="h-now">Currently playing</h2>
              <span className="count">{playing.length}</span>
            </div>
            <div className="now">
              {timing && timing.status !== "playing" && <NowCard g={timing} nav={nav} allowEst={allowEst} />}
              {playing.map((g) => (
                <NowCard key={g.id} g={g} nav={nav} allowEst={allowEst} />
              ))}
            </div>
          </section>
        )}

        {tonight && (
          <section className="sec" aria-labelledby="h-tonight">
            <div className="sec-h">
              <h2 id="h-tonight">Tonight's recommendation</h2>
              <span className="count">{lastSession && lastSession.intent !== "any" ? "based on your last Pick for me answers" : "from your library and taste"}</span>
            </div>
            <Feature
              rec={tonight}
              allowEst={allowEst}
              onPlay={() => {
                void addRecEvent("accept", tonight.game.id, null, { from: "home" });
                void play(tonight.game.id);
              }}
              onDetails={() => nav.openGame(tonight.game.id)}
              onElse={() => setSkipped((s) => [...s, tonight.game.id])}
              onQueue={() => void toggleUpNext(tonight.game.id, true)}
              queued={upNextIds.includes(tonight.game.id)}
              onMore={() => nav.pick()}
            />
          </section>
        )}

        {resume.length > 0 && (
          <section className="sec" aria-labelledby="h-cont">
            <div className="sec-h">
              <h2 id="h-cont">Continue</h2>
              <span className="count">paused or part-played</span>
            </div>
            <div className="rows">
              {resume.map((g) => (
                <div className="r-item" key={g.id}>
                  <Thumb file={g.coverPath} className="md" />
                  <div className="r-main">
                    <button className="linkish r-title" onClick={() => nav.openGame(g.id)}>
                      {cleanTitle(g.title)}
                    </button>
                    <span className="r-sub">{progressLine(g, allowEst)}</span>
                  </div>
                  <div className="r-acts">
                    <button className="btn sm" onClick={() => void play(g.id)}>
                      <Icon name="play" /> Continue
                    </button>
                    <button className="btn sm ghost" onClick={() => nav.openGame(g.id)}>
                      Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {queue.length > 0 && (
          <section className="sec" aria-labelledby="h-up">
            <div className="sec-h">
              <h2 id="h-up">Up Next</h2>
              <span className="count">{queue.length}</span>
              <div className="acts">
                <button className="btn sm ghost" onClick={() => setEditingQueue(true)}>
                  Reorder…
                </button>
              </div>
            </div>
            <div className="rows">
              {queue.slice(0, 6).map((g, i) => (
                <div className="r-item" key={g.id}>
                  <span className="r-pos">{i + 1}</span>
                  <div className="r-main">
                    <button className="linkish r-title" onClick={() => nav.openGame(g.id)}>
                      {cleanTitle(g.title)}
                    </button>
                    <span className="r-sub">{progressLine(g, allowEst)}</span>
                  </div>
                  <div className="r-acts">
                    {g.status !== "playing" && (
                      <button className="btn sm" onClick={() => void play(g.id)} title={launchTarget(g) ? "Start it through its launcher" : "Start playing"}>
                        <Icon name="play" /> Start
                      </button>
                    )}
                    <button className="btn sm ghost icon" onClick={() => void toggleUpNext(g.id, false)} aria-label="Remove from Up Next" title="Remove from Up Next">
                      <Icon name="x" />
                    </button>
                  </div>
                </div>
              ))}
              {queue.length > 6 && (
                <div className="r-item no-lead">
                  <span className="meta">and {queue.length - 6} more</span>
                  <button className="btn sm ghost" onClick={() => nav.library({ upNext: true })}>
                    Show all
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {events.length > 0 && (
          <section className="sec" aria-labelledby="h-act">
            <div className="sec-h">
              <h2 id="h-act">Recent activity</h2>
              <div className="acts">
                <button className="btn sm ghost" onClick={() => nav.go("activity")}>
                  All activity
                </button>
              </div>
            </div>
            <div className="rows">
              {events.map((e) => (
                <div className="r-item" key={e.id}>
                  <span className="r-time">{fmtDay(e.ts) === "Today" ? fmtClock(e.ts) : fmtDay(e.ts)}</span>
                  <div className="r-main">
                    <span className="r-title" style={{ fontWeight: 400 }}>
                      {e.gameId && gameById.has(e.gameId) ? (
                        <>
                          <button className="linkish" style={{ fontWeight: 500 }} onClick={() => nav.openGame(e.gameId!)}>
                            {cleanTitle(gameById.get(e.gameId)!.title)}
                          </button>
                          <span className="dim"> · {describeEvent(e, undefined, true)}</span>
                        </>
                      ) : (
                        <span className="dim">{describeEvent(e)}</span>
                      )}
                    </span>
                  </div>
                  <span />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {editingQueue && <UpNextDialog nav={nav} onClose={() => setEditingQueue(false)} />}
    </div>
  );
}

function NowCard({ g, nav, allowEst }: { g: Game; nav: Nav; allowEst: boolean }) {
  const { timer, play, stopTimer, updateGame } = useApp();
  const p = progressRatio(g, allowEst);
  const target = launchTarget(g);
  const isTiming = timer?.gameId === g.id;
  return (
    <article className="now-card" aria-label={cleanTitle(g.title)}>
      <button className="linkish" onClick={() => nav.openGame(g.id)} aria-label={`Details for ${cleanTitle(g.title)}`}>
        <Cover game={g} eager />
      </button>
      <div className="nc-body">
        <button className="linkish nc-title" onClick={() => nav.openGame(g.id)}>
          {cleanTitle(g.title)}
        </button>
        <span className="nc-meta">{progressLine(g, allowEst)}</span>
        {p.ratio != null && (
          <div className="bar thin" aria-hidden="true">
            <i style={{ width: `${Math.min(100, Math.round(p.ratio * 100))}%` }} />
          </div>
        )}
        {isTiming && <span className="timer">Playing since {fmtClock(timer!.startedAt)} · <Elapsed since={timer!.startedAt} /></span>}
        <div className="nc-acts">
          {isTiming ? (
            <button className="btn sm primary" onClick={stopTimer}>
              <Icon name="stop" /> Stop and log
            </button>
          ) : (
            <button className="btn sm primary" onClick={() => void play(g.id)} title={target ? `Start through ${LAUNCHER_LABEL[target.source]}` : "No launcher link: this times the session"}>
              <Icon name="play" /> {target ? "Launch" : "Start timer"}
            </button>
          )}
          <button className="btn sm" onClick={() => void updateGame(g.id, { status: "paused" })}>
            <Icon name="pause" /> Pause
          </button>
          <button className="btn sm" onClick={() => void updateGame(g.id, { status: "completed" })}>
            <Icon name="check" /> Complete
          </button>
          <button className="btn sm ghost" onClick={() => nav.openGame(g.id)}>
            Details
          </button>
        </div>
      </div>
    </article>
  );
}

function Feature({
  rec,
  allowEst,
  onPlay,
  onDetails,
  onElse,
  onQueue,
  queued,
  onMore,
}: {
  rec: Rec;
  allowEst: boolean;
  onPlay(): void;
  onDetails(): void;
  onElse(): void;
  onQueue(): void;
  queued: boolean;
  onMore(): void;
}) {
  const g = rec.game;
  const e = explain(rec, allowEst);
  const wide = wideArt(g);
  const target = launchTarget(g);
  const body = (
    <div className="f-body">
      <div className="stack tight">
        <span className="f-kicker">{e.facts || "In your library"}</span>
        <button className="linkish f-title" onClick={onDetails}>
          {cleanTitle(g.title)}
        </button>
        {e.reasons.length > 0 && (
          <ul className="f-why">
            {e.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {e.caveat && <span className="meta">Worth knowing: {lowerFirst(e.caveat)}</span>}
      </div>
      <div className="f-acts">
        <button className="btn primary lg" onClick={onPlay}>
          <Icon name="play" /> {target ? "Play" : "Start playing"}
        </button>
        <button className="btn lg" onClick={onElse}>
          Pick something else
        </button>
        <button className="btn ghost" onClick={onDetails}>
          Details
        </button>
        {!queued && (
          <button className="btn ghost" onClick={onQueue}>
            <Icon name="queue" /> Up Next
          </button>
        )}
        <button className="btn ghost" onClick={onMore}>
          More choices
        </button>
      </div>
    </div>
  );
  if (wide) {
    return (
      <article className="feature with-hero" aria-label={`Tonight: ${cleanTitle(g.title)}`}>
        <div className="hero-art">
          <img src={wide} alt="" />
        </div>
        {body}
      </article>
    );
  }
  return (
    <article className="feature" aria-label={`Tonight: ${cleanTitle(g.title)}`}>
      <button className="linkish" onClick={onDetails} aria-label="Details">
        <Cover game={g} eager />
      </button>
      {body}
    </article>
  );
}

/** Wide artwork already saved on this PC (Steam library hero, else the store header). Never downloads. */
export function wideArt(g: Game): string | null {
  const art = g.meta.steam?.status === "linked" ? g.meta.steam.data?.art : null;
  return artSrc(art?.hero?.file ?? art?.header?.file ?? null);
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return <>{fmtMinutes(Math.max(0, Math.round((now - Date.parse(since)) / 60000)))}</>;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function byRecent(a: Game, b: Game): number {
  return (lastPlayedAny(b) ?? "").localeCompare(lastPlayedAny(a) ?? "");
}

export function progressLine(g: Game, allowEst: boolean): string {
  const p = progressRatio(g, allowEst);
  const len = displayLength(g, allowEst);
  const parts: string[] = [];
  if (g.status === "paused") parts.push("Paused");
  if (p.hours >= 1) parts.push(progressText(g, allowEst));
  else parts.push(g.endless ? "Not started · no set ending" : len ? `Not started · about ${fmtHours(len.hours)}` : "Not started");
  const lp = lastPlayedAny(g);
  if (lp) parts.push(`last played ${fmtDay(lp)}`);
  return parts.join(" · ");
}
