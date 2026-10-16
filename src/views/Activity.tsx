import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { fmtDate, fmtDateTime, StatusPill } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import type { EventRow } from "../lib/types.ts";
import { describeEvent } from "./GameDetail.tsx";
import { REASONS } from "../rec/taste.ts";

type Sess = { id: string; gameId: string; date: string; minutes: number | null; note: string };
type LogFilter = "all" | "status" | "session" | "rating" | "import";

const LOG_FILTERS: { id: LogFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "status", label: "Status changes" },
  { id: "session", label: "Play sessions" },
  { id: "rating", label: "Ratings" },
  { id: "import", label: "Imports & restores" },
];

/** Only things that really happened: changes you made in REWIND and sessions you logged. */
export function ActivityView({ nav }: { nav: Nav }) {
  const { repo, games, gameById, recEvents, setLogFor, confirm, run } = useApp();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [limit, setLimit] = useState(300);
  const [filter, setFilter] = useState<LogFilter>("all");

  useEffect(() => {
    void repo.recentEvents(Math.max(limit, 1500)).then(setEvents);
    void repo.loadSessions(60).then(setSessions);
  }, [repo, games, limit]);

  const title = (id: string | null) => (id ? cleanTitle(gameById.get(id)?.title ?? "(removed game)") : "");

  const started = useMemo(() => latestPerGame(events.filter((e) => e.type === "status" && e.data.to === "playing")).slice(0, 8), [events]);
  const paused = useMemo(() => {
    const when = new Map(latestPerGame(events.filter((e) => e.type === "status" && e.data.to === "paused")).map((e) => [e.gameId, e.ts]));
    return games
      .filter((g) => g.status === "paused")
      .map((g) => ({ g, ts: when.get(g.id) ?? null }))
      .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? "") || a.g.title.localeCompare(b.g.title));
  }, [events, games]);
  const completed = useMemo(() => {
    const done = games.filter((g) => g.status === "completed");
    const dated = done.filter((g) => g.dateCompleted).sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
    return { dated: dated.slice(0, 8), undated: done.length - dated.length, total: done.length };
  }, [games]);
  const choices = useMemo(
    () =>
      recEvents
        .filter((e) => (e.kind === "accept" || e.kind === "pass" || e.kind === "drop") && e.gameId)
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, 10),
    [recEvents],
  );
  const log = useMemo(() => {
    const match = (e: EventRow) =>
      filter === "all" ? true : filter === "import" ? e.type === "import" || e.type === "restore" || e.type === "legacy_log" : e.type === filter;
    return events.filter(match).slice(0, limit);
  }, [events, filter, limit]);

  const open = (id: string | null) => id && gameById.has(id) && nav.openGame(id);

  return (
    <div className="content pad">
      <div className="dash">
        <section className="panel span2" aria-labelledby="h-sess">
          <div className="hd" id="h-sess">
            Play sessions <span className="count">{sessions.length}</span>
            <span className="right">
              <button className="btn sm" onClick={() => setLogFor({ gameId: null })}>Log session</button>
            </span>
          </div>
          <div className="bd flush">
            {sessions.length === 0 ? (
              <div className="empty">
                <b>No sessions logged yet</b>
                <span className="hint">
                  REWIND doesn't invent play history. After you play, use Log session (here, on Home, or in a game's details) to keep a record.
                </span>
              </div>
            ) : (
              <div className="list">
                {sessions.map((s) => (
                  <div className="li" key={s.id}>
                    <span className="meta" style={{ minWidth: "6.5rem" }}>{fmtDate(s.date)}</span>
                    <div className="t2">
                      <button className="linkish t" onClick={() => open(s.gameId)}>{title(s.gameId)}</button>
                      {s.note && <span className="sub">{s.note}</span>}
                    </div>
                    <span className="meta">{s.minutes == null ? "time not logged" : fmtMin(s.minutes)}</span>
                    <button
                      className="btn icon sm ghost"
                      aria-label="Delete this session"
                      title="Delete this session"
                      onClick={async () => {
                        const ok = await confirm({ title: "Delete session?", body: <>Delete the {fmtDate(s.date)} session of <b>{title(s.gameId)}</b>?</>, ok: "Delete", danger: true });
                        if (!ok) return;
                        await run(() => repo.deleteSession(s.id), "Session deleted.");
                        setSessions((x) => x.filter((y) => y.id !== s.id));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="h-started">
          <div className="hd" id="h-started">Recently started</div>
          <div className="bd flush">
            {started.length === 0 ? (
              <div className="empty">
                <b>No games set to Playing yet</b>
                <span className="hint">When you set a game to Playing, it's recorded here with the date.</span>
              </div>
            ) : (
              <div className="list">
                {started.map((e) => (
                  <div className="li" key={e.id}>
                    <div className="t2">
                      <button className="linkish t" onClick={() => open(e.gameId)}>{title(e.gameId)}</button>
                      <span className="sub">set to Playing {fmtDateTime(e.ts)}</span>
                    </div>
                    {e.gameId && gameById.get(e.gameId) && <StatusPill status={gameById.get(e.gameId)!.status} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="h-done">
          <div className="hd" id="h-done">
            Completed <span className="count">{completed.total}</span>
          </div>
          <div className="bd flush">
            {completed.dated.length === 0 ? (
              <div className="empty">
                <b>No completion dates recorded</b>
                <span className="hint">
                  {completed.total ? `${completed.total} games are marked Completed but have no date. ` : ""}Marking a game Completed from now on records today's date.
                </span>
              </div>
            ) : (
              <>
                <div className="list">
                  {completed.dated.map((g) => (
                    <div className="li" key={g.id}>
                      <span className="meta" style={{ minWidth: "6.5rem" }}>{fmtDate(g.dateCompleted)}</span>
                      <div className="t2">
                        <button className="linkish t" onClick={() => open(g.id)}>{cleanTitle(g.title)}</button>
                      </div>
                      {g.rating ? <span className="meta">{"★".repeat(g.rating)}</span> : null}
                    </div>
                  ))}
                </div>
                {completed.undated > 0 && (
                  <div className="bd dim" style={{ fontSize: "var(--fs-xs)" }}>
                    + {completed.undated} completed without a recorded date.{" "}
                    <button className="linkish" style={{ textDecoration: "underline" }} onClick={() => nav.library({ status: "completed" })}>Show all</button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="h-paused">
          <div className="hd" id="h-paused">
            Paused <span className="count">{paused.length}</span>
          </div>
          <div className="bd flush">
            {paused.length === 0 ? (
              <div className="empty">
                <b>Nothing paused</b>
                <span className="hint">Pausing keeps a game out of the way without calling it dropped.</span>
              </div>
            ) : (
              <div className="list">
                {paused.map(({ g, ts }) => (
                  <div className="li" key={g.id}>
                    <div className="t2">
                      <button className="linkish t" onClick={() => open(g.id)}>{cleanTitle(g.title)}</button>
                      <span className="sub">{ts ? `paused ${fmtDateTime(ts)}` : "paused (date not recorded)"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="h-choices">
          <div className="hd" id="h-choices">Recent Pick-for-me choices</div>
          <div className="bd flush">
            {choices.length === 0 ? (
              <div className="empty">
                <b>No choices yet</b>
                <span className="hint">When you play or pass on a suggestion, it appears here. Passing never bans a game.</span>
              </div>
            ) : (
              <div className="list">
                {choices.map((e) => (
                  <div className="li" key={e.id}>
                    <span className={"chip " + (e.kind === "accept" ? "own" : "notown")} style={{ fontSize: "var(--fs-xs)" }}>
                      {e.kind === "accept" ? "played" : e.kind === "drop" ? "dropped" : "passed"}
                    </span>
                    <div className="t2">
                      <button className="linkish t" onClick={() => open(e.gameId)}>{title(e.gameId)}</button>
                      <span className="sub">
                        {e.reason ? (REASONS[e.reason]?.label ?? e.reason) + " · " : ""}
                        {fmtDateTime(e.ts)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel full" aria-labelledby="h-log">
          <div className="hd" id="h-log">
            Full log <span className="count">{log.length}</span>
            <span className="right">
              <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as LogFilter)} aria-label="Show in log">
                {LOG_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </span>
          </div>
          <div className="bd flush">
            {log.length === 0 ? (
              <div className="empty">
                <b>Nothing recorded{filter !== "all" ? " of this kind" : ""} yet</b>
                <span className="hint">The log only records things that happened in REWIND: status changes, ratings, sessions you logged, imports and restores.</span>
              </div>
            ) : (
              <div className="eventlog">
                {log.map((e) => (
                  <div className="ev" key={e.id}>
                    <time>{fmtDateTime(e.ts)}</time>
                    <span>
                      {e.gameId && gameById.has(e.gameId) ? (
                        <>
                          <button className="linkish" style={{ fontWeight: 600 }} onClick={() => open(e.gameId)}>{title(e.gameId)}</button>:{" "}
                        </>
                      ) : null}
                      {describeEvent(e)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {log.length >= limit && (
              <div className="bd">
                <button className="btn" onClick={() => setLimit((l) => l + 500)}>Show older</button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function latestPerGame(evts: EventRow[]): EventRow[] {
  const seen = new Set<string>();
  const out: EventRow[] = [];
  for (const e of [...evts].sort((a, b) => b.ts.localeCompare(a.ts))) {
    if (!e.gameId || seen.has(e.gameId)) continue;
    seen.add(e.gameId);
    out.push(e);
  }
  return out;
}

function fmtMin(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
}
