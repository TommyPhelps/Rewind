// Up Next: your own ordered queue. Reorder by dragging, with Alt+↑/↓, or the buttons;
// REWIND may suggest tidying it (finished games, sequels out of order) but changes nothing
// until you click.

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { Icon } from "../ui/Icon.tsx";
import { StatusPill } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { reviewUpNext, type ReviewAction, type ReviewItem } from "../lib/queues.ts";
import { useTaste } from "../state/recs.ts";
import type { Status } from "../lib/types.ts";
import { progressLine } from "./Home.tsx";

export function UpNextDialog({ nav, onClose }: { nav: Nav; onClose(): void }) {
  const { upNext, upNextIds, gameById, games, reorderUpNext, toggleUpNext, repo, run, updateGame, settings } = useApp();
  const { taste, series } = useTaste();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const allowEst = settings.useUnverifiedLengths;

  useEffect(() => {
    void repo.getSetting<string[]>("queue_review_dismissed", []).then((d) => setDismissed(new Set(d)));
  }, [repo]);
  const struggled = useMemo(() => new Set([...taste.evidence].filter(([, e]) => e.value < 0 && !e.playtimeOnly).map(([id]) => id)), [taste]);
  const review = useMemo(() => reviewUpNext(upNext, games, series, { dismissed, struggled, allowUnverified: allowEst }), [upNext, games, series, dismissed, struggled, allowEst]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= upNextIds.length || from === to) return;
    const ids = [...upNextIds];
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    void reorderUpNext(ids);
  };
  const apply = async (item: ReviewItem, a: ReviewAction) => {
    if (a.op === "keep") {
      const next = new Set([...dismissed, item.key]);
      setDismissed(next);
      await run(() => repo.setSetting("queue_review_dismissed", [...next]));
    } else if (a.op === "remove") await toggleUpNext(item.gameId, false);
    else await updateGame(item.gameId, { status: a.op.slice(7) as Status });
  };

  return (
    <Modal title="Up Next" wide onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <p className="dim">Your own queue, in your order. Games you're playing and paused games are tracked on Home already, so they don't need a place here.</p>
      {review.length > 0 && (
        <div className="stack tight">
          <span className="meta">Suggestions — nothing changes until you choose</span>
          <div className="rows boxed">
            {review.map((r) => (
              <div className="r-item no-lead" key={r.key}>
                <span className="r-main">
                  <span className="r-title" style={{ whiteSpace: "normal", fontWeight: 400 }}>{r.text}</span>
                </span>
                <span className="r-acts">
                  {r.actions.map((a) => (
                    <button key={a.op} className={"btn sm" + (a.op === "keep" ? " ghost" : "")} onClick={() => void apply(r, a)}>
                      {a.label}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {upNextIds.length === 0 ? (
        <div className="empty">
          <b>Up Next is empty</b>
          <span className="hint">Use “Up Next” on any game's details, or right-click games in the Library.</span>
        </div>
      ) : (
        <div className="rows boxed" role="list" aria-label="Up Next order">
          {upNextIds.map((id, i) => {
            const g = gameById.get(id);
            if (!g) return null;
            return (
              <div
                key={id}
                role="listitem"
                tabIndex={0}
                className="r-item"
                style={{ cursor: "grab", boxShadow: over === i && drag !== i ? "inset 0 2px 0 var(--accent)" : undefined, opacity: drag === i ? 0.5 : 1 }}
                draggable
                onDragStart={(e) => {
                  setDrag(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(i);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag != null) move(drag, drag < i ? i - 1 : i);
                  setDrag(null);
                  setOver(null);
                }}
                onKeyDown={(e) => {
                  if (e.altKey && e.key === "ArrowUp") {
                    e.preventDefault();
                    move(i, i - 1);
                  } else if (e.altKey && e.key === "ArrowDown") {
                    e.preventDefault();
                    move(i, i + 1);
                  } else if (e.key === "Delete") void toggleUpNext(id, false);
                }}
                aria-label={`${i + 1}. ${cleanTitle(g.title)}`}
              >
                <span className="r-pos">{i + 1}</span>
                <span className="r-main">
                  <button
                    className="linkish r-title"
                    onClick={() => {
                      onClose();
                      nav.openGame(id);
                    }}
                  >
                    {cleanTitle(g.title)}
                  </button>
                  <span className="r-sub">
                    <StatusPill status={g.status} /> · {progressLine(g, allowEst)}
                  </span>
                </span>
                <span className="r-acts">
                  <button className="btn sm ghost icon" disabled={i === 0} onClick={() => move(i, 0)} aria-label="Move to top" title="Move to top">
                    ⤒
                  </button>
                  <button className="btn sm ghost icon" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Move up" title="Move up (Alt+↑)">
                    <Icon name="up" />
                  </button>
                  <button className="btn sm ghost icon" disabled={i === upNextIds.length - 1} onClick={() => move(i, i + 1)} aria-label="Move down" title="Move down (Alt+↓)">
                    <Icon name="down" />
                  </button>
                  <button className="btn sm ghost icon" onClick={() => void toggleUpNext(id, false)} aria-label="Remove from Up Next" title="Remove (Delete)">
                    <Icon name="x" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
