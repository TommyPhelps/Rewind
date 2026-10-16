import { useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { todayIso } from "../db/repo.ts";

/** Records a play session you tell it about. Nothing is ever logged automatically. */
export function LogSessionDialog() {
  const { logFor, setLogFor, games, gameById, repo, run, reloadAll, toast } = useApp();
  const [gameId, setGameId] = useState<string>("");
  const [date, setDate] = useState(todayIso());
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const options = useMemo(() => {
    const order = { playing: 0, paused: 1, replay: 2, backlog: 3, completed: 4, dropped: 5, not_interested: 6 } as Record<string, number>;
    return [...games].sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));
  }, [games]);
  if (!logFor) return null;
  const id = logFor.gameId ?? gameId;
  const g = id ? gameById.get(id) : undefined;
  const close = () => {
    setLogFor(null);
    setGameId("");
    setMinutes("");
    setNote("");
    setDate(todayIso());
  };
  const save = async () => {
    if (!g) return;
    const m = minutes.trim() === "" ? null : Math.max(1, Math.round(Number(minutes)));
    if (m != null && !Number.isFinite(m)) return;
    const ok = await run(async () => {
      await repo.addSession(g.id, date, m, note.trim());
      await reloadAll();
      return true;
    });
    if (ok) {
      toast(`Logged a session of ${cleanTitle(g.title)}.`);
      close();
    }
  };
  return (
    <Modal
      title="Log a play session"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!g}>Save session</button>
        </>
      }
    >
      {logFor.gameId ? (
        <div>
          <b>{g ? cleanTitle(g.title) : "?"}</b>
        </div>
      ) : (
        <label className="lbl">
          Game
          <select className="select" value={gameId} onChange={(e) => setGameId(e.target.value)} autoFocus>
            <option value="">Choose a game…</option>
            {options.map((x) => (
              <option key={x.id} value={x.id}>
                {cleanTitle(x.title)}
                {x.status === "playing" ? "  (playing)" : x.status === "paused" ? "  (paused)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form2">
        <label className="lbl">
          Date
          <input className="field" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="lbl">
          Minutes (optional)
          <input className="field" inputMode="numeric" placeholder="unknown" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ""))} />
        </label>
      </div>
      <label className="lbl">
        Note (optional)
        <input className="field" placeholder="Where you got to, what's next…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      </label>
      <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
        Only sessions you log appear in Activity. Imported playtime stays separate and is never turned into sessions.
      </div>
    </Modal>
  );
}
