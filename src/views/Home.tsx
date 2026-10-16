import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Cover, fmtDateTime, StatusPill, Thumb } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { displayLength, fmtHours } from "../lib/library.ts";
import { STATUSES, type EventRow, type Game } from "../lib/types.ts";
import { describeEvent } from "./GameDetail.tsx";
import { useTaste } from "../state/recs.ts";
import { BAND_LABEL, DEFAULT_WEIGHTS, diversify, INTENT_LABEL, normalizeSession, recommend, type Intent, type Session } from "../rec/engine.ts";
import { findUpNext, resumeCandidates, reviewUpNext, seriesFollowUps } from "../lib/queues.ts";
import { lastPlayedAny, progressRatio, progressState, progressText } from "../rec/progress.ts";

export function HomeView({ nav }: { nav: Nav }) {
  const { games, gameById, collections, settings, repo, updateGame, profile, recEvents, setLogFor } = useApp();
  const { taste, series, marksByGame } = useTaste();
  const allowEst = settings.useUnverifiedLengths;
  const [events, setEvents] = useState<EventRow[]>([]);
  const [lastSession, setLastSession] = useState<Session | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  useEffect(() => {
    void repo.recentEvents(10).then(setEvents);
  }, [repo, games]);
  useEffect(() => {
    void repo.getSetting<Record<string, unknown>>("rec_last_session", {}).then((s) => setLastSession(normalizeSession(s)));
    void repo.getSetting<string[]>("queue_review_dismissed", []).then((d) => setDismissed(new Set(d)));
  }, [repo]);

  const playing = useMemo(() => games.filter((g) => g.status === "playing").sort(byRecent), [games]);
  const resume = useMemo(
    () =>
      resumeCandidates(games, allowEst).slice(0, 8),
    [games, allowEst],
  );
  const upNext = findUpNext(collections);
  const followUps = useMemo(() => seriesFollowUps(games, series, allowEst), [games, series, allowEst]);
  const struggled = useMemo(() => new Set([...taste.evidence].filter(([, e]) => e.value < 0 && !e.playtimeOnly).map(([id]) => id)), [taste]);
  const review = useMemo(() => reviewUpNext(upNext, games, series, { dismissed, struggled, allowUnverified: allowEst }), [upNext, games, series, dismissed, struggled, allowEst]);

  // Tonight: whatever you last asked Pick for me, applied to today.
  const tonight = useMemo(() => {
    if (!lastSession) return [];
    const r = recommend({ games, taste, events: recEvents, session: lastSession, weights: DEFAULT_WEIGHTS, profile, series, allowUnverified: allowEst, marks: marksByGame });
    return diversify(r.results.filter((x) => !x.heldBack), 3, taste.idf);
  }, [lastSession, games, taste, recEvents, profile, series, allowEst, marksByGame]);
  const counts = useMemo(() => STATUSES.map((s) => ({ ...s, n: games.filter((g) => g.status === s.id).length })), [games]);
  const needsInfo = useMemo(() => games.filter((g) => !g.tags.length || !displayLength(g, allowEst)).length, [games, allowEst]);
  const sessionDesc = lastSession ? describeSession(lastSession) : "";

  const quick = (intent: Intent) => nav.pick({ ...(lastSession ?? {}), intent });

  return (
    <div className="content pad">
      <div className="dash">
        {/* Tonight */}
        <section className="panel span2" aria-labelledby="h-tonight">
          <div className="hd" id="h-tonight">
            Tonight's recommendation
            <span className="right">
              <span className="count" title="The settings you last used in Pick for me">{sessionDesc}</span>
            </span>
          </div>
          <div className="bd" style={{ display: "grid", gap: "var(--gap)" }}>
            <div className="intent-row" role="group" aria-label="What do you want to do?">
              {(["continue", "resume", "new", "replay", "different"] as Intent[]).map((i) => (
                <button key={i} className="btn sm" onClick={() => quick(i)}>
                  {INTENT_LABEL[i]}
                </button>
              ))}
              <span className="grow" />
              <button className="btn primary" onClick={() => nav.pick(undefined, true)}>
                <Icon name="pick" /> Surprise me
              </button>
            </div>
            {tonight.length === 0 ? (
              <div className="empty">
                <b>No suggestion yet</b>
                <span className="hint">Open Pick for me and choose what you're in the mood for.</span>
              </div>
            ) : (
              <>
                <div className="tonight-card">
                  <button className="tc-cover" onClick={() => nav.openGame(tonight[0].game.id)} aria-label={`Details for ${cleanTitle(tonight[0].game.title)}`}>
                    <Cover game={tonight[0].game} eager />
                  </button>
                  <div style={{ display: "grid", gap: "0.4rem", minWidth: 0 }}>
                    <div className="rc-chips">
                      <span className={"band b-" + tonight[0].band}>{BAND_LABEL[tonight[0].band]}</span>
                      <StatusPill status={tonight[0].game.status} />
                      <span className="chip">{tonight[0].commitment}</span>
                    </div>
                    <button className="linkish tt" onClick={() => nav.openGame(tonight[0].game.id)}>
                      {cleanTitle(tonight[0].game.title)}
                    </button>
                    <ul className="pros">
                      {tonight[0].pros.slice(0, 3).map((p) => <li key={p.text}>{p.text}</li>)}
                    </ul>
                    {tonight[0].cons[0] && (
                      <ul className="cons">
                        <li>{tonight[0].cons[0].text}</li>
                      </ul>
                    )}
                  </div>
                  <div style={{ display: "grid", gap: "0.4rem" }}>
                    <button className="btn primary" onClick={() => nav.pick(lastSession ?? undefined)}>
                      Open in Pick for me
                    </button>
                    <button className="btn" onClick={() => nav.openGame(tonight[0].game.id)}>Details</button>
                  </div>
                </div>
                {tonight.length > 1 && (
                  <div className="list inset">
                    {tonight.slice(1).map((r) => (
                      <div className="li" key={r.game.id}>
                        <span className={"band b-" + r.band}>{BAND_LABEL[r.band].replace(" fit", "")}</span>
                        <div className="t2">
                          <button className="linkish t" onClick={() => nav.openGame(r.game.id)}>{cleanTitle(r.game.title)}</button>
                          <span className="sub">{r.pros[0]?.text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Currently playing */}
        <section className="panel" aria-labelledby="h-playing">
          <div className="hd" id="h-playing">
            Currently playing <span className="count">{playing.length}</span>
            <span className="right">
              <button className="btn sm" onClick={() => setLogFor({ gameId: null })}>Log session</button>
            </span>
          </div>
          <div className="bd flush">
            {playing.length === 0 ? (
              <div className="empty">
                <b>Nothing marked Playing</b>
                <span className="hint">Open a game and set it to Playing, or let Pick for me suggest one.</span>
              </div>
            ) : (
              <div className="list">
                {playing.map((g) => (
                  <div className="li" key={g.id}>
                    <Thumb file={g.coverPath} className="lt" />
                    <div className="t2">
                      <button className="linkish t" onClick={() => nav.openGame(g.id)}>{cleanTitle(g.title)}</button>
                      <span className="sub">{progressLine(g, allowEst)}</span>
                    </div>
                    <div className="acts">
                      <button className="btn sm" onClick={() => setLogFor({ gameId: g.id })} title="Log a play session">Log</button>
                      <button className="btn sm" onClick={() => updateGame(g.id, { status: "paused" })} title="Pause"><Icon name="pause" /></button>
                      <button className="btn sm" onClick={() => updateGame(g.id, { status: "completed" })} title="Mark completed"><Icon name="check" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Continue where you left off */}
        <section className="panel" aria-labelledby="h-resume">
          <div className="hd" id="h-resume">
            Continue where you left off <span className="count">{resume.length}</span>
          </div>
          <div className="bd flush">
            {resume.length === 0 ? (
              <div className="empty">
                <b>Nothing paused or part-played</b>
                <span className="hint">Paused games, and games with a couple of hours in that you haven't finished, show up here.</span>
              </div>
            ) : (
              <div className="list">
                {resume.map((g) => (
                  <div className="li" key={g.id}>
                    <Thumb file={g.coverPath} className="lt" />
                    <div className="t2">
                      <button className="linkish t" onClick={() => nav.openGame(g.id)}>{cleanTitle(g.title)}</button>
                      <span className="sub">
                        {g.status === "paused" ? "Paused · " : ""}
                        {progressLine(g, allowEst)}
                      </span>
                    </div>
                    <div className="acts">
                      <button className="btn sm" onClick={() => updateGame(g.id, { status: "playing" })}>
                        <Icon name="play" /> Resume
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Up Next */}
        <section className="panel" aria-labelledby="h-upnext">
          <div className="hd" id="h-upnext">
            Up Next <span className="count">{upNext?.gameIds.length ?? 0}</span>
            <span className="right">
              {review.length > 0 && (
                <button className="btn sm" onClick={() => nav.go("collections")} title="Suggestions for tidying your queue">
                  <Icon name="alert" /> {review.length} to review
                </button>
              )}
              <button className="btn sm ghost" onClick={() => nav.go("collections")}>Edit</button>
            </span>
          </div>
          <div className="bd flush">
            {!upNext || upNext.gameIds.length === 0 ? (
              <div className="empty">
                <b>Your queue is empty</b>
                <span className="hint">Right-click any game in the Library → Add to collection → Up Next.</span>
              </div>
            ) : (
              <div className="list">
                {upNext.gameIds.map((id, i) => {
                  const g = gameById.get(id);
                  if (!g) return null;
                  return (
                    <div className="li" key={id}>
                      <span className="pos">{i + 1}.</span>
                      <div className="t2">
                        <button className="linkish t" onClick={() => nav.openGame(id)} title={g.title}>{cleanTitle(g.title)}</button>
                        <span className="sub">{progressLine(g, allowEst)}</span>
                      </div>
                      <StatusPill status={g.status} />
                      {g.status !== "playing" && (
                        <button className="btn sm" onClick={() => updateGame(id, { status: "playing" })} title="Set to Playing">
                          <Icon name="play" /> Start
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Series follow-ups */}
        <section className="panel" aria-labelledby="h-series">
          <div className="hd" id="h-series">
            Series follow-ups <span className="auto">automatic</span>
          </div>
          <div className="bd flush">
            {followUps.length === 0 ? (
              <div className="empty">
                <b>No follow-ups right now</b>
                <span className="hint">When you play or finish a game that has a sequel in your library, the sequel waits here.</span>
              </div>
            ) : (
              <div className="list">
                {followUps.slice(0, 8).map((f) => (
                  <div className={"li" + (f.ready ? " ready" : "")} key={f.game.id}>
                    <div className="t2">
                      <button className="linkish t" onClick={() => nav.openGame(f.game.id)}>{cleanTitle(f.game.title)}</button>
                      <span className="sub">{f.text}</span>
                    </div>
                    <span className={"chip " + (f.ready ? "own" : "")}>{f.ready ? "ready" : "waiting"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Recent activity */}
        <section className="panel" aria-labelledby="h-act">
          <div className="hd" id="h-act">
            Recent activity
            <span className="right">
              <button className="btn sm ghost" onClick={() => nav.go("activity")}>All activity</button>
            </span>
          </div>
          <div className="bd flush">
            {events.length === 0 ? (
              <div className="empty"><b>Nothing yet</b></div>
            ) : (
              <div className="eventlog">
                {events.map((e) => (
                  <div className="ev" key={e.id}>
                    <time>{fmtDateTime(e.ts)}</time>
                    <span>{describeEvent(e, e.gameId ? cleanTitle(gameById.get(e.gameId)?.title ?? "") : undefined)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Library overview: every number opens that slice of the library */}
        <section className="panel" aria-labelledby="h-lib">
          <div className="hd" id="h-lib">
            Library <span className="count">{games.length} games</span>
            <span className="right">
              <form
                className="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  nav.librarySearch(q);
                }}
              >
                <Icon name="search" />
                <input className="field" type="search" placeholder="Find a game…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />
              </form>
            </span>
          </div>
          <div className="bd">
            <div className="statgrid">
              {counts.filter((c) => c.n > 0 || c.id === "playing").map((c) => (
                <button key={c.id} className="stat" onClick={() => nav.library({ status: c.id })}>
                  <span className="n">{c.n}</span>
                  <span className="l">{c.label}</span>
                </button>
              ))}
              <button className="stat" onClick={() => nav.library({ progress: "started" })}>
                <span className="n">{games.filter((g) => progressState(g, allowEst) === "started").length}</span>
                <span className="l">Started, unfinished</span>
              </button>
              <button className="stat" onClick={() => nav.library({ needsInfo: true })}>
                <span className="n">{needsInfo}</span>
                <span className="l">Missing tags or length</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function byRecent(a: Game, b: Game): number {
  return (lastPlayedAny(b) ?? "").localeCompare(lastPlayedAny(a) ?? "");
}

function progressLine(g: Game, allowEst: boolean): string {
  const p = progressRatio(g, allowEst);
  const len = displayLength(g, allowEst);
  const parts: string[] = [];
  if (p.hours >= 1) parts.push(progressText(g, allowEst));
  else parts.push(g.endless ? "endless" : len ? `not started · ~${fmtHours(len.hours)} long` : "not started");
  const lp = lastPlayedAny(g);
  if (lp) parts.push(`last played ${lp}`);
  return parts.join(" · ");
}

function describeSession(s: Session): string {
  const bits: string[] = [];
  if (s.intent !== "any") bits.push(INTENT_LABEL[s.intent].toLowerCase());
  if (s.experience) bits.push(s.experience);
  if (s.energy) bits.push(`${s.energy} energy`);
  if (s.time) bits.push(s.time.replace("lt30", "<30 min").replace("30to60", "30–60 min").replace("1to2", "1–2h").replace("2to4", "2–4h"));
  return bits.length ? `based on: ${bits.join(", ")}` : "no session settings";
}
