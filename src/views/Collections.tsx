import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ContextMenu, type MenuItem } from "../ui/Overlays.tsx";
import { CommitInput, StatusPill } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { displayLength, fmtHours } from "../lib/library.ts";
import { findUpNext, resumeCandidates, reviewUpNext, seriesFollowUps, UP_NEXT, type ReviewAction, type ReviewItem } from "../lib/queues.ts";
import { progressRatio, progressText } from "../rec/progress.ts";
import { useTaste } from "../state/recs.ts";
import type { Game, Status } from "../lib/types.ts";

type AutoId = "auto:followups" | "auto:resume" | "auto:replay";
const AUTO: { id: AutoId; label: string; blurb: string }[] = [
  {
    id: "auto:followups",
    label: "Series follow-ups",
    blurb: "Sequels you own to games you're playing or have finished. Built from your statuses and playtime; it updates itself.",
  },
  {
    id: "auto:resume",
    label: "Continue where you left off",
    blurb: "Games marked Paused, plus backlog games you've already put a couple of hours into.",
  },
  {
    id: "auto:replay",
    label: "Replay candidates",
    blurb: "Games you marked Replay, and finished games you rated 4★ or higher or marked as favourites.",
  },
];

export function CollectionsView({ nav, selectedId }: { nav: Nav; selectedId: string | null }) {
  const { collections, games, gameById, repo, run, reloadCollections, confirm, settings, updateGame, toast } = useApp();
  const { taste, series } = useTaste();
  const allowEst = settings.useUnverifiedLengths;
  const upNext = findUpNext(collections);
  const manual = useMemo(() => {
    const rest = collections.filter((c) => c !== upNext);
    return upNext ? [upNext, ...rest] : rest;
  }, [collections, upNext]);
  const [activeId, setActiveId] = useState<string | null>(manual[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    void repo.getSetting<string[]>("queue_review_dismissed", []).then((d) => setDismissed(new Set(d)));
  }, [repo]);
  useEffect(() => {
    if (activeId?.startsWith("auto:")) return;
    if (activeId && !collections.some((c) => c.id === activeId)) setActiveId(manual[0]?.id ?? null);
    if (!activeId && manual.length) setActiveId(manual[0].id);
  }, [collections, manual, activeId]);

  const col = collections.find((c) => c.id === activeId) ?? null;
  const auto = AUTO.find((a) => a.id === activeId) ?? null;

  const struggled = useMemo(() => new Set([...taste.evidence].filter(([, e]) => e.value < 0 && !e.playtimeOnly).map(([id]) => id)), [taste]);
  const review = useMemo(
    () => (col && col === upNext ? reviewUpNext(upNext, games, series, { dismissed, struggled, allowUnverified: allowEst }) : []),
    [col, upNext, games, series, dismissed, struggled, allowEst],
  );

  const autoLists = useMemo(() => {
    const followUps = seriesFollowUps(games, series, allowEst);
    const resume = resumeCandidates(games, allowEst);
    const replay = games
      .filter((g) => g.status === "replay" || (g.status === "completed" && ((g.rating ?? 0) >= 4 || g.favorite)))
      .sort((a, b) => Number(b.status === "replay") - Number(a.status === "replay") || (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title));
    return {
      "auto:followups": followUps.map((f) => ({ game: f.game, sub: f.text, tag: f.ready ? "ready" : "waiting" })),
      "auto:resume": resume.map((g) => ({ game: g, sub: (g.status === "paused" ? "Paused · " : "") + progressLine(g, allowEst), tag: "" })),
      "auto:replay": replay.map((g) => ({ game: g, sub: g.status === "replay" ? "Marked Replay" : `Completed${g.rating ? " · " + "★".repeat(g.rating) : ""}${g.favorite ? " · favourite" : ""}`, tag: "" })),
    } as Record<AutoId, { game: Game; sub: string; tag: string }[]>;
  }, [games, series, allowEst]);

  const reorder = async (ids: string[]) => {
    if (!col) return;
    await run(() => repo.reorderCollection(col.id, ids));
    await reloadCollections();
  };
  const moveTo = async (from: number, to: number) => {
    if (!col) return;
    const ids = [...col.gameIds];
    if (to < 0 || to >= ids.length || from === to) return;
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    await reorder(ids);
  };
  const remove = async (id: string) => {
    if (!col) return;
    await run(() => repo.removeFromCollection(col.id, [id]));
    await reloadCollections();
  };
  const ensureUpNext = async (): Promise<string | null> => {
    if (upNext) return upNext.id;
    const id = await run(() => repo.createCollection("Up Next", "Games you plan to play next, in order."));
    return id ?? null;
  };
  const addToUpNext = async (g: Game) => {
    const id = await ensureUpNext();
    if (!id) return;
    const n = await run(() => repo.addToCollection(id, [g.id]));
    await reloadCollections();
    toast(n ? `Added ${cleanTitle(g.title)} to Up Next.` : `${cleanTitle(g.title)} is already in Up Next.`);
  };

  const applyReview = async (item: ReviewItem, a: ReviewAction) => {
    if (a.op === "keep") {
      const next = new Set([...dismissed, item.key]);
      setDismissed(next);
      await run(() => repo.setSetting("queue_review_dismissed", [...next]));
    } else if (a.op === "remove") {
      if (upNext) await run(() => repo.removeFromCollection(upNext.id, [item.gameId]));
      await reloadCollections();
    } else {
      await updateGame(item.gameId, { status: a.op.slice(7) as Status });
    }
  };

  const moveMenu = (e: { clientX: number; clientY: number }, id: string) => {
    if (!col) return;
    const others = collections.filter((c) => c.id !== col.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { heading: "Move to collection" },
        ...(others.length
          ? others.map((c) => ({
              label: c.name,
              onClick: async () => {
                await run(() => repo.moveBetweenCollections(col.id, c.id, [id]), `Moved to ${c.name}.`);
                await reloadCollections();
              },
            }))
          : [{ heading: "No other collections yet" }]),
      ],
    });
  };

  const rowKeys = (e: KeyboardEvent<HTMLDivElement>, i: number, id: string) => {
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      void moveTo(i, i - 1);
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      void moveTo(i, i + 1);
    } else if (e.key === "Enter") {
      nav.openGame(id);
    } else if (e.key === "Delete") {
      void remove(id);
    }
  };

  return (
    <div className="content fill">
      <div className="cols3">
        <nav className="clist" aria-label="Collections">
          <div className="grp">
            <span>Your collections</span>
            <span>{manual.length}</span>
          </div>
          {manual.map((c) => (
            <button key={c.id} className="ci" aria-current={c.id === activeId} onClick={() => setActiveId(c.id)}>
              <Icon name={c === upNext ? "play" : "collections"} />
              <span className="ellipsis">{c.name}</span>
              <span className="n">{c.gameIds.length}</span>
            </button>
          ))}
          <form
            className="row"
            style={{ padding: "0.4rem 0.2rem" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              const id = await run(() => repo.createCollection(newName.trim()));
              if (id) {
                setNewName("");
                await reloadCollections();
                setActiveId(id);
              }
            }}
          >
            <input className="field grow" placeholder="New collection…" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New collection name" />
            <button className="btn icon" type="submit" aria-label="Create collection" disabled={!newName.trim()}>
              <Icon name="plus" />
            </button>
          </form>
          <div className="grp">
            <span>Automatic lists</span>
          </div>
          {AUTO.map((a) => (
            <button key={a.id} className="ci auto" aria-current={a.id === activeId} onClick={() => setActiveId(a.id)} title="Built automatically; you can't reorder it">
              <Icon name="rewind" />
              <span className="ellipsis">{a.label}</span>
              <span className="n">{autoLists[a.id].length}</span>
            </button>
          ))}
        </nav>

        <div className="cmain">
          {auto ? (
            <section className="panel">
              <div className="hd">
                {auto.label} <span className="auto">automatic</span>
                <span className="count">{autoLists[auto.id].length}</span>
              </div>
              <div className="bd" style={{ fontSize: "var(--fs-s)" }}>
                <span className="dim">{auto.blurb}</span>
              </div>
              <div className="bd flush">
                {autoLists[auto.id].length === 0 ? (
                  <div className="empty">
                    <b>Nothing here right now</b>
                    <span className="hint">This list fills itself as your statuses and playtime change.</span>
                  </div>
                ) : (
                  <div className="list">
                    {autoLists[auto.id].map(({ game: g, sub, tag }) => (
                      <div className={"li" + (selectedId === g.id ? " sel" : "")} key={g.id}>
                        <div className="t2">
                          <button className="linkish t" onClick={() => nav.openGame(g.id)}>{cleanTitle(g.title)}</button>
                          <span className="sub">{sub}</span>
                        </div>
                        {tag && <span className={"chip " + (tag === "ready" ? "own" : "")}>{tag}</span>}
                        <StatusPill status={g.status} />
                        <div className="acts">
                          {!upNext?.gameIds.includes(g.id) && (
                            <button className="btn sm" onClick={() => void addToUpNext(g)} title="Add to the end of Up Next">
                              <Icon name="plus" /> Up Next
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : col ? (
            <>
              <section className="panel">
                <div className="hd">
                  <CommitInput
                    className="field"
                    value={col.name}
                    ariaLabel="Collection name"
                    onCommit={async (v) => {
                      if (!v.trim()) return;
                      await run(() => repo.updateCollection(col.id, { name: v.trim() }));
                      await reloadCollections();
                    }}
                  />
                  <span className="count">{col.gameIds.length} games</span>
                  <span className="right">
                    <button
                      className="btn sm danger"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Delete collection",
                          danger: true,
                          ok: "Delete collection",
                          body: <>Delete <b>{col.name}</b>? The games stay in your library; only the list is removed.</>,
                        });
                        if (ok) {
                          await run(() => repo.deleteCollection(col.id), `Deleted ${col.name}.`);
                          await reloadCollections();
                        }
                      }}
                    >
                      <Icon name="trash" /> Delete
                    </button>
                  </span>
                </div>
                <div className="bd">
                  <CommitInput
                    value={col.description}
                    placeholder="Description (optional)"
                    onCommit={async (v) => {
                      await run(() => repo.updateCollection(col.id, { description: v }));
                      await reloadCollections();
                    }}
                  />
                  {col.name.toLowerCase() === UP_NEXT && (
                    <div className="dim" style={{ fontSize: "var(--fs-s)", marginTop: "0.5rem" }}>
                      Up Next is your own ordered queue. Games you're playing, paused games and sequels are tracked separately, so they don't need a spot here.
                    </div>
                  )}
                </div>
              </section>

              {review.length > 0 && (
                <section className="panel review" aria-labelledby="h-review">
                  <div className="hd" id="h-review">
                    <Icon name="alert" /> Review your queue <span className="count">{review.length}</span>
                    <span className="right dim mono" style={{ fontSize: "var(--fs-xs)" }}>suggestions only · nothing changes until you click</span>
                  </div>
                  <div className="bd flush">
                    {review.map((r) => (
                      <div className="ritem" key={r.key}>
                        <div>
                          <button className="linkish" onClick={() => nav.openGame(r.gameId)}>{r.text}</button>
                        </div>
                        <div className="row" style={{ gap: "0.3rem" }}>
                          {r.actions.map((a) => (
                            <button key={a.op} className={"btn sm" + (a.op === "keep" ? " ghost" : "")} onClick={() => void applyReview(r, a)}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="panel" aria-label={`${col.name} games`}>
                <div className="hd">
                  Order
                  <span className="right dim mono" style={{ fontSize: "var(--fs-xs)" }}>drag rows · Alt+↑/↓ · Del removes</span>
                </div>
                <div className="bd flush">
                  {col.gameIds.length === 0 ? (
                    <div className="empty">
                      <b>This collection is empty</b>
                      <span className="hint">In the Library, right-click a game (or select several) and choose Add to collection.</span>
                    </div>
                  ) : (
                    <div role="list">
                      {col.gameIds.map((id, i) => {
                        const g = gameById.get(id);
                        if (!g) return null;
                        const len = displayLength(g, allowEst);
                        return (
                          <div
                            role="listitem"
                            tabIndex={0}
                            key={id}
                            className={"qrow" + (selectedId === id ? " sel" : "") + (dragIdx === i ? " dragging" : "") + (dropIdx === i && dragIdx !== i ? " dropbefore" : "")}
                            draggable
                            onDragStart={(e) => {
                              setDragIdx(i);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", id);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDropIdx(i);
                            }}
                            onDragEnd={() => {
                              setDragIdx(null);
                              setDropIdx(null);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragIdx != null) void moveTo(dragIdx, dragIdx < i ? i - 1 : i);
                              setDragIdx(null);
                              setDropIdx(null);
                            }}
                            onKeyDown={(e) => rowKeys(e, i, id)}
                            aria-label={`${i + 1}. ${cleanTitle(g.title)}`}
                          >
                            <span className="grip" aria-hidden>⋮⋮</span>
                            <span className="pos">{i + 1}</span>
                            <div className="t2" onClick={() => nav.openGame(id)}>
                              <span className="t" title={g.title}>{cleanTitle(g.title)}</span>
                              <span className="sub">{progressLine(g, allowEst)}</span>
                            </div>
                            <span className="hide-narrow"><StatusPill status={g.status} /></span>
                            <span className="num dim hide-narrow" style={{ minWidth: "3rem", textAlign: "right" }} title={len ? (len.verified ? "Length" : "Estimated length") : "Length unknown"}>
                              {g.endless ? "∞" : len ? (len.verified ? "" : "~") + fmtHours(len.hours) : "—"}
                            </span>
                            <div className="acts">
                              <button className="btn icon sm" onClick={() => void moveTo(i, 0)} disabled={i === 0} aria-label="Move to top" title="Move to top">
                                ⤒
                              </button>
                              <button className="btn icon sm" onClick={() => void moveTo(i, i - 1)} disabled={i === 0} aria-label="Move up" title="Move up">
                                <Icon name="up" />
                              </button>
                              <button className="btn icon sm" onClick={() => void moveTo(i, i + 1)} disabled={i === col.gameIds.length - 1} aria-label="Move down" title="Move down">
                                <Icon name="down" />
                              </button>
                              <button className="btn sm" onClick={(e) => moveMenu(e, id)} title="Move to another collection">
                                Move…
                              </button>
                              <button className="btn icon sm ghost" aria-label="Remove from collection" title="Remove from this collection (the game stays in your library)" onClick={() => void remove(id)}>
                                <Icon name="x" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : (
            <div className="empty">
              <b>No collections yet</b>
              <span className="hint">Create one on the left. "Up Next" is a good start: your own ordered list of what to play next.</span>
            </div>
          )}
        </div>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function progressLine(g: Game, allowEst: boolean): string {
  const p = progressRatio(g, allowEst);
  const parts: string[] = [];
  if (p.hours >= 1) parts.push(progressText(g, allowEst));
  else parts.push("not started");
  if (g.lastPlayed) parts.push(`last played ${g.lastPlayed}`);
  return parts.join(" · ");
}
