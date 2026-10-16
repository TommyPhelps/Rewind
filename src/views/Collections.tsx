import { useEffect, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { CommitInput, StatusPill } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { displayLength, fmtHours } from "../lib/library.ts";

export function CollectionsView({ nav, selectedId }: { nav: Nav; selectedId: string | null }) {
  const { collections, gameById, repo, run, reloadCollections, confirm, settings } = useApp();
  const [activeId, setActiveId] = useState<string | null>(collections[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  useEffect(() => {
    if (activeId && !collections.some((c) => c.id === activeId)) setActiveId(collections[0]?.id ?? null);
    if (!activeId && collections.length) setActiveId(collections[0].id);
  }, [collections, activeId]);
  const col = collections.find((c) => c.id === activeId) ?? null;

  const move = async (idx: number, delta: number) => {
    if (!col) return;
    const ids = [...col.gameIds];
    const j = idx + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await run(() => repo.reorderCollection(col.id, ids));
    await reloadCollections();
  };

  return (
    <div className="content pad">
      <div style={{ display: "grid", gridTemplateColumns: "16rem minmax(0, 1fr)", gap: "1rem", alignItems: "start", maxWidth: "70rem" }}>
        <div className="panel">
          <div className="hd">Collections</div>
          <div className="bd flush">
            <div className="list">
              {collections.map((c) => (
                <div
                  key={c.id}
                  className="li"
                  style={{ cursor: "pointer", background: c.id === activeId ? "var(--sel-strong)" : undefined }}
                  onClick={() => setActiveId(c.id)}
                >
                  <Icon name="collections" />
                  <span className="t">{c.name}</span>
                  <span className="num dim">{c.gameIds.length}</span>
                </div>
              ))}
            </div>
            <form
              className="row"
              style={{ padding: "0.6rem", borderTop: "1px solid var(--lo)" }}
              onSubmit={async (e) => {
                e.preventDefault();
                const id = await run(() => repo.createCollection(newName));
                if (id) {
                  setNewName("");
                  await reloadCollections();
                  setActiveId(id);
                }
              }}
            >
              <input className="field grow" placeholder="New collection" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className="btn icon" type="submit" aria-label="Create collection">
                <Icon name="plus" />
              </button>
            </form>
          </div>
        </div>

        {col ? (
          <div className="panel">
            <div className="hd">
              <CommitInput
                className="field"
                value={col.name}
                ariaLabel="Collection name"
                onCommit={async (v) => {
                  await run(() => repo.updateCollection(col.id, { name: v }));
                  await reloadCollections();
                }}
              />
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
            <div className="bd" style={{ display: "grid", gap: "0.6rem" }}>
              <CommitInput
                value={col.description}
                placeholder="Description (optional)"
                onCommit={async (v) => {
                  await run(() => repo.updateCollection(col.id, { description: v }));
                  await reloadCollections();
                }}
              />
              {col.gameIds.length === 0 ? (
                <div className="empty">Empty. Add games from the Library: right-click a game, or select several and use the bulk bar.</div>
              ) : (
                <div className="list inset">
                  {col.gameIds.map((id, i) => {
                    const g = gameById.get(id);
                    if (!g) return null;
                    const len = displayLength(g, settings.useUnverifiedLengths);
                    return (
                      <div className="li" key={id} style={{ background: selectedId === id ? "var(--sel)" : undefined }}>
                        <span className="pos">{i + 1}.</span>
                        <span className="t" onClick={() => nav.openGame(id)}>{cleanTitle(g.title)}</span>
                        <StatusPill status={g.status} />
                        <span className="num dim" style={{ width: "3.5rem", textAlign: "right" }}>{g.endless ? "∞" : len ? fmtHours(len.hours) : ""}</span>
                        <button className="btn icon sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                          <Icon name="up" />
                        </button>
                        <button className="btn icon sm" onClick={() => move(i, 1)} disabled={i === col.gameIds.length - 1} aria-label="Move down">
                          <Icon name="down" />
                        </button>
                        <button
                          className="btn icon sm ghost"
                          aria-label="Remove from collection"
                          title="Remove from this collection"
                          onClick={async () => {
                            await run(() => repo.removeFromCollection(col.id, [id]));
                            await reloadCollections();
                          }}
                        >
                          <Icon name="x" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="empty">No collections yet. Create one on the left.</div>
        )}
      </div>
    </div>
  );
}
