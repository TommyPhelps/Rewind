// Activity answers one question: what have I played and finished?
// One chronological feed of things that really happened, each marked with where it came
// from (you, a timed session, a Steam or launcher import, a lookup, a backup). Sessions can
// be corrected or deleted right here.

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { fmtClock, fmtDay, fmtMinutes } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import type { EventRow } from "../lib/types.ts";
import { describeEvent } from "./GameDetail.tsx";
import { todayIso } from "../db/repo.ts";

type Sess = { id: string; gameId: string; date: string; minutes: number | null; note: string; source: string };
type Kind = "all" | "play" | "changes" | "imports";

const KINDS: { id: Kind; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "play", label: "Play sessions" },
  { id: "changes", label: "Status and ratings" },
  { id: "imports", label: "Imports and lookups" },
];

const SOURCE: Record<string, string> = {
  status: "You",
  rating: "You",
  game_added: "You",
  games_merged: "You",
  steam_import: "Steam",
  launcher_import: "Launchers",
  metadata_sync: "Store lookup",
  import: "Backup",
  restore: "Backup",
  legacy_log: "Old REWIND",
  discover_lookup: "Discover",
  game_added_from_discover: "Discover",
  mod_profile_created: "REWIND 4",
  mod_profile_deleted: "REWIND 4",
};

const kindOf = (t: string): Kind => (t === "status" || t === "rating" || t === "game_added" || t === "games_merged" || t === "game_added_from_discover" ? "changes" : t === "session" ? "play" : "imports");

type Item = { key: string; day: string; ts: string; ev?: EventRow; s?: Sess };

const localDay = (iso: string) => {
  if (iso.length === 10) return iso;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ActivityView({ nav }: { nav: Nav }) {
  const { repo, games, gameById, setLogFor, confirm, run } = useApp();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [limit, setLimit] = useState(300);
  const [kind, setKind] = useState<Kind>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void repo.recentEvents(limit).then(setEvents);
    void repo.loadSessions(limit).then(setSessions);
  }, [repo, games, limit, version]);

  const items = useMemo(() => {
    const out: Item[] = [];
    // Sessions come from the sessions table (so they can be corrected); their log events are skipped.
    if (kind === "all" || kind === "play") for (const s of sessions) out.push({ key: "s" + s.id, day: s.date, ts: s.date + "T23:59:59", s });
    for (const e of events) {
      if (e.type === "session") continue;
      if (kind !== "all" && kindOf(e.type) !== kind) continue;
      out.push({ key: "e" + e.id, day: localDay(e.ts), ts: e.ts, ev: e });
    }
    out.sort((a, b) => b.day.localeCompare(a.day) || b.ts.localeCompare(a.ts));
    const days: { day: string; items: Item[] }[] = [];
    for (const it of out) {
      const last = days[days.length - 1];
      if (last && last.day === it.day) last.items.push(it);
      else days.push({ day: it.day, items: [it] });
    }
    return days;
  }, [events, sessions, kind]);

  const month = todayIso().slice(0, 7);
  const thisMonth = useMemo(() => {
    const ss = sessions.filter((s) => s.date.startsWith(month));
    const mins = ss.reduce((n, s) => n + (s.minutes ?? 0), 0);
    const done = games.filter((g) => g.dateCompleted?.startsWith(month)).length;
    return { n: ss.length, mins, done };
  }, [sessions, games, month]);

  const title = (id: string | null) => (id ? cleanTitle(gameById.get(id)?.title ?? "(removed game)") : "");
  const open = (id: string | null) => id && gameById.has(id) && nav.openGame(id);

  return (
    <div className="page">
      <div className="page-in read">
        <header className="page-head">
          <h1>Activity</h1>
          <span className="sub">
            This month: {thisMonth.n} session{thisMonth.n === 1 ? "" : "s"}
            {thisMonth.mins ? ` · ${fmtMinutes(thisMonth.mins)} logged` : ""} · {thisMonth.done} finished
          </span>
          <div className="acts">
            <button className="btn" onClick={() => setLogFor({ gameId: null })}>
              <Icon name="clock" /> Log a session
            </button>
          </div>
        </header>
        <div className="seg sm" role="group" aria-label="Show" style={{ marginBottom: "var(--s5)" }}>
          {KINDS.map((k) => (
            <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <b>Nothing here yet</b>
            <span className="hint">
              Activity only shows things that really happened: status changes and ratings, sessions you log or time with Play, imports and lookups. Nothing is
              made up from playtime.
            </span>
          </div>
        ) : (
          <div className="feed">
            {items.map(({ day, items: xs }) => (
              <section className="day" key={day} aria-label={fmtDay(day)}>
                <h3>{fmtDay(day)}</h3>
                {xs.map((it) =>
                  it.s ? (
                    <SessionItem
                      key={it.key}
                      s={it.s}
                      title={title(it.s.gameId)}
                      onOpen={() => open(it.s!.gameId)}
                      editing={editing === it.s.id}
                      onEdit={() => setEditing(editing === it.s!.id ? null : it.s!.id)}
                      onSave={async (patch) => {
                        const ok = await run(async () => {
                          await repo.updateSession(it.s!.id, patch);
                          return true;
                        }, "Session updated.");
                        if (ok) {
                          setEditing(null);
                          setVersion((v) => v + 1);
                        }
                      }}
                      onDelete={async () => {
                        const ok = await confirm({ title: "Delete this session?", body: <p>Delete the {fmtDay(it.s!.date)} session of <b>{title(it.s!.gameId)}</b>?</p>, ok: "Delete", danger: true });
                        if (!ok) return;
                        await run(() => repo.deleteSession(it.s!.id), "Session deleted.");
                        setVersion((v) => v + 1);
                      }}
                    />
                  ) : (
                    <div className="f-item" key={it.key}>
                      <time>{fmtClock(it.ev!.ts)}</time>
                      <span className="f-text">
                        {it.ev!.gameId && gameById.has(it.ev!.gameId) ? (
                          <>
                            <button className="linkish g" onClick={() => open(it.ev!.gameId)}>
                              {title(it.ev!.gameId)}
                            </button>
                            <span className="dim"> · {describeEvent(it.ev!, undefined, true)}</span>
                          </>
                        ) : (
                          <span className="dim">{describeEvent(it.ev!)}</span>
                        )}
                      </span>
                      <span className="f-side">
                        <span className="src">{SOURCE[it.ev!.type] ?? "REWIND"}</span>
                      </span>
                    </div>
                  ),
                )}
              </section>
            ))}
            {(events.length >= limit || sessions.length >= limit) && (
              <button className="btn" style={{ justifySelf: "start" }} onClick={() => setLimit((l) => l + 500)}>
                Show older
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionItem({
  s,
  title,
  onOpen,
  editing,
  onEdit,
  onSave,
  onDelete,
}: {
  s: Sess;
  title: string;
  onOpen(): void;
  editing: boolean;
  onEdit(): void;
  onSave(p: { date: string; minutes: number | null; note: string }): void;
  onDelete(): void;
}) {
  const [date, setDate] = useState(s.date);
  const [mins, setMins] = useState(s.minutes == null ? "" : String(s.minutes));
  const [note, setNote] = useState(s.note);
  useEffect(() => {
    setDate(s.date);
    setMins(s.minutes == null ? "" : String(s.minutes));
    setNote(s.note);
  }, [s, editing]);
  return (
    <div className="f-item">
      <time>{s.minutes != null ? fmtMinutes(s.minutes) : "—"}</time>
      <div className="f-text">
        <button className="linkish g" onClick={onOpen}>
          {title}
        </button>
        <span className="dim"> · played{s.note ? ` — ${s.note}` : ""}</span>
        {editing && (
          <form
            className="f-edit"
            onSubmit={(e) => {
              e.preventDefault();
              const m = mins.trim() === "" ? null : Number(mins);
              onSave({ date, minutes: m, note });
            }}
          >
            <input className="field" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
            <input className="field" style={{ width: "6rem" }} inputMode="numeric" value={mins} placeholder="minutes" onChange={(e) => setMins(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Minutes" />
            <input className="field grow" value={note} placeholder="Note" onChange={(e) => setNote(e.target.value)} aria-label="Note" />
            <button className="btn sm primary" type="submit">
              Save
            </button>
            <button className="btn sm ghost" type="button" onClick={onEdit}>
              Cancel
            </button>
          </form>
        )}
      </div>
      <span className="f-side">
        <span className="src">{s.source === "timed" ? "Timed" : "Logged"}</span>
        {!editing && (
          <>
            <button className="btn sm ghost icon" onClick={onEdit} aria-label="Correct this session" title="Correct">
              <Icon name="edit" />
            </button>
            <button className="btn sm ghost icon" onClick={onDelete} aria-label="Delete this session" title="Delete">
              <Icon name="trash" />
            </button>
          </>
        )}
      </span>
    </div>
  );
}
