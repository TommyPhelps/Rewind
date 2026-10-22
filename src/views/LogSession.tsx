import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { todayIso } from "../db/repo.ts";
import { fmtMinutes } from "../ui/bits.tsx";

/** Records a play session: one you type in, or one REWIND timed from Play to Stop. */
export function LogSessionDialog() {
  const { logFor, setLogFor, games, gameById, repo, run, reloadAll, toast, discardTimer, timer } = useApp();
  const [gameId, setGameId] = useState<string>("");
  const [date, setDate] = useState(todayIso());
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const options = useMemo(() => {
    const order = { playing: 0, paused: 1, replay: 2, backlog: 3, completed: 4, dropped: 5, not_interested: 6 } as Record<string, number>;
    return [...games].sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));
  }, [games]);
  useEffect(() => {
    if (!logFor) return;
    setMinutes(logFor.minutes != null ? String(logFor.minutes) : "");
    setDate(logFor.date && logFor.date <= todayIso() ? logFor.date : todayIso());
  }, [logFor]);
  if (!logFor) return null;
  const timed = logFor.source === "timed";
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
    const m = minutes.trim() === "" ? null : Math.max(1, Math.min(1439, Math.round(Number(minutes))));
    if (m != null && !Number.isFinite(m)) return;
    const ok = await run(async () => {
      await repo.addSession(g.id, date, m, note.trim(), timed ? "timed" : "manual");
      await reloadAll();
      return true;
    });
    if (ok) {
      if (timed && timer?.gameId === g.id) await discardTimer();
      toast(`Logged ${m ? fmtMinutes(m) + " of " : "a session of "}${cleanTitle(g.title)}.`);
      close();
    }
  };
  return (
    <Modal
      title={timed ? "Log this session" : "Log a play session"}
      onClose={close}
      footer={
        <>
          {timed && (
            <button
              className="btn ghost"
              onClick={async () => {
                await discardTimer();
                close();
              }}
              title="Stop the timer without saving a session"
            >
              Discard
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={close}>
            {timed ? "Keep timing" : "Cancel"}
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={!g}>
            Save session
          </button>
        </>
      }
    >
      {logFor.gameId ? (
        <b>{g ? cleanTitle(g.title) : "?"}</b>
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
      {timed && <span className="meta">Timed from when you pressed Play. Adjust the minutes if you stepped away.</span>}
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
        <input className="field" placeholder="Where you got to, what's next…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
      </label>
      <span className="meta">Sessions appear in Activity, where you can correct them later. Launcher playtime is kept separately and never turned into sessions.</span>
    </Modal>
  );
}
