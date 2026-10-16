import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { fmtDateTime, StatusPill } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { displayLength, fmtHours } from "../lib/library.ts";
import { STATUSES, type EventRow } from "../lib/types.ts";
import { describeEvent } from "./GameDetail.tsx";

export function HomeView({ nav }: { nav: Nav }) {
  const { games, gameById, collections, settings, repo, updateGame } = useApp();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    void repo.recentEvents(8).then(setEvents);
  }, [repo, games]);

  const upNext = collections.find((c) => c.name.toLowerCase() === "up next");
  const active = useMemo(() => games.filter((g) => g.status === "playing" || g.status === "paused"), [games]);
  const counts = useMemo(() => STATUSES.map((s) => ({ ...s, n: games.filter((g) => g.status === s.id).length })), [games]);
  const max = Math.max(1, ...counts.map((c) => c.n));
  const stats = useMemo(() => {
    const est = games.filter((g) => {
      const l = displayLength(g, true);
      return l && !l.verified;
    }).length;
    const confirmed = games.filter((g) => displayLength(g, true)?.verified).length;
    const unknown = games.filter((g) => !g.endless && !displayLength(g, true)).length;
    const mp = games.filter((g) => g.multiplayer === "mp_required" || g.multiplayer === "coop_focused").length;
    const fav = games.filter((g) => g.favorite).length;
    return { est, unknown, mp, fav, confirmed };
  }, [games]);

  return (
    <div className="content pad">
      <div className="stack" style={{ maxWidth: "78rem" }}>
        <div className="panel">
          <div className="hero">
            <span className="big">{games.length}</span>
            <span className="dim">games in your library</span>
            <form
              className="search grow"
              style={{ maxWidth: "26rem", marginLeft: "auto" }}
              onSubmit={(e) => {
                e.preventDefault();
                nav.librarySearch(q);
              }}
            >
              <Icon name="search" />
              <input className="field" type="search" placeholder="Jump to a game…" value={q} onChange={(e) => setQ(e.target.value)} />
            </form>
          </div>
        </div>

        <div className="panel">
          <div className="hd">
            Tonight
            <span className="right dim mono" style={{ fontSize: "0.72rem", textTransform: "none", letterSpacing: 0 }}>one click opens Pick for me</span>
          </div>
          <div className="bd row tonight">
            <button className="btn" onClick={() => nav.pick({ energy: "low", time: "1to2", avoid: ["difficulty", "setup"] })}>Low energy</button>
            <button className="btn" onClick={() => nav.pick({ time: "lt30", commitment: "one", avoid: ["setup"] })}>Under 30 minutes</button>
            <button className="btn" onClick={() => nav.pick({ experience: "story", energy: "medium" })}>A good story</button>
            <button className="btn" onClick={() => nav.pick({ experience: "mastery", energy: "high", difficulty: "challenging" })}>Up for a challenge</button>
            <button className="btn" onClick={() => nav.pick({ progress: "continue" })}>Continue something</button>
            <span className="grow" />
            <button className="btn primary" onClick={() => nav.pick(undefined, true)}>Surprise me</button>
          </div>
        </div>

        <div className="grid2">
          <div className="stack">
            <div className="panel">
              <div className="hd">
                Now playing
                <span className="right dim num">{active.length}</span>
              </div>
              <div className="bd flush">
                {active.length === 0 ? (
                  <div style={{ padding: "0.75rem" }}>
                    <div className="empty">Nothing marked as playing. Start something from Up Next, or set a game to Playing.</div>
                  </div>
                ) : (
                  <div className="list">
                    {active.map((g) => (
                      <div className="li" key={g.id}>
                        <span className="t" onClick={() => nav.openGame(g.id)}>{cleanTitle(g.title)}</span>
                        <StatusPill status={g.status} />
                        {g.status === "paused" ? (
                          <button className="btn sm" onClick={() => updateGame(g.id, { status: "playing" })}><Icon name="play" /> Resume</button>
                        ) : (
                          <button className="btn sm" onClick={() => updateGame(g.id, { status: "paused" })}><Icon name="pause" /> Pause</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="hd">
                Up next
                <span className="right">
                  {upNext && <button className="btn sm ghost" onClick={() => nav.go("collections")}>edit order</button>}
                </span>
              </div>
              <div className="bd flush">
                {!upNext || upNext.gameIds.length === 0 ? (
                  <div style={{ padding: "0.75rem" }}>
                    <div className="empty">No "Up Next" list. Make a collection called Up Next and it shows here.</div>
                  </div>
                ) : (
                  <div className="list">
                    {upNext.gameIds.map((id, i) => {
                      const g = gameById.get(id);
                      if (!g) return null;
                      const len = displayLength(g, settings.useUnverifiedLengths);
                      return (
                        <div className="li" key={id}>
                          <span className="pos">{i + 1}.</span>
                          <span className="t" onClick={() => nav.openGame(id)} title={g.title}>{cleanTitle(g.title)}</span>
                          <span className="num dim">{g.endless ? "∞" : len ? fmtHours(len.hours) : ""}</span>
                          {g.status === "playing" ? (
                            <StatusPill status="playing" />
                          ) : (
                            <button className="btn sm" onClick={() => updateGame(id, { status: "playing" })} title="Set status to Playing">
                              <Icon name="play" /> Start
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="panel">
              <div className="hd">Library at a glance</div>
              <div className="bd">
                <div className="bars">
                  {counts.map((c) => (
                    <div className="bar" key={c.id}>
                      <StatusPill status={c.id} />
                      <div className="track">
                        <div className="fill" style={{ width: `${(c.n / max) * 100}%` }} />
                      </div>
                      <span className="num" style={{ textAlign: "right" }}>{c.n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="hd">Data quality</div>
              <div className="bd">
                <dl className="kv">
                  <dt>Lengths you've confirmed</dt>
                  <dd className="num">{stats.confirmed}</dd>
                  <dt>Old unverified estimates</dt>
                  <dd className="num warn">{stats.est}</dd>
                  <dt>Length unknown</dt>
                  <dd className="num">{stats.unknown}</dd>
                  <dt>Need other players</dt>
                  <dd className="num">{stats.mp}</dd>
                  <dt>Favorites</dt>
                  <dd className="num">{stats.fav}</dd>
                </dl>
                <div className="dim" style={{ fontSize: "0.82rem", marginTop: "0.6rem" }}>
                  Tags and lengths marked est. are estimates (old REWIND table or REWIND reference); Steam import and verified metadata arrive in Phase 3.
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="hd">
                Recent activity
                <span className="right"><button className="btn sm ghost" onClick={() => nav.go("activity")}>all</button></span>
              </div>
              <div className="bd flush">
                {events.length === 0 ? (
                  <div style={{ padding: "0.75rem" }} className="dim">Nothing yet.</div>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
