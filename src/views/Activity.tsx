import { useEffect, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { fmtDateTime } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import type { EventRow } from "../lib/types.ts";
import { describeEvent } from "./GameDetail.tsx";

export function ActivityView({ nav }: { nav: Nav }) {
  const { repo, games, gameById } = useApp();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [limit, setLimit] = useState(200);
  useEffect(() => {
    void repo.recentEvents(limit).then(setEvents);
  }, [repo, games, limit]);
  return (
    <div className="content pad">
      <div className="stack" style={{ maxWidth: "60rem" }}>
        <div className="note info">
          This log only records things that actually happened in REWIND: status changes, ratings, imports and restores. Play sessions,
          stats and recommendation history arrive with Phase 2.
        </div>
        <div className="panel">
          <div className="hd">
            Log <span className="right dim num">{events.length}</span>
          </div>
          <div className="bd flush">
            {events.length === 0 ? (
              <div style={{ padding: "0.75rem" }} className="dim">Nothing recorded yet.</div>
            ) : (
              <div className="eventlog">
                {events.map((e) => {
                  const g = e.gameId ? gameById.get(e.gameId) : undefined;
                  return (
                    <div className="ev" key={e.id}>
                      <time>{fmtDateTime(e.ts)}</time>
                      <span>
                        {g ? (
                          <a href="#" onClick={(ev) => { ev.preventDefault(); nav.openGame(g.id); }}>
                            {cleanTitle(g.title)}
                          </a>
                        ) : null}
                        {g ? ": " : ""}
                        {describeEvent(e)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {events.length >= limit && (
          <button className="btn" style={{ justifySelf: "start" }} onClick={() => setLimit((l) => l + 300)}>
            Show older
          </button>
        )}
      </div>
    </div>
  );
}
