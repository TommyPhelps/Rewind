import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/store.tsx";
import { Icon } from "../ui/Icon.tsx";
import { CommitInput, Cover, fmtDate, fmtDateTime, SourceBadge, Stars } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { effectiveLength, fmtHours } from "../lib/library.ts";
import {
  INSTALL,
  LENGTH_KINDS,
  MULTIPLAYER,
  OWNERSHIP,
  REC_PREFS,
  SOURCE_LABEL,
  STATUSES,
  type EventRow,
  type Game,
} from "../lib/types.ts";
import { openExternal } from "../platform/native.ts";
import { useTaste } from "../state/recs.ts";
import { DEFAULT_WEIGHTS, EMPTY_SESSION, BAND_LABEL, recommend } from "../rec/engine.ts";
import { TRAIT_LABEL, TRAITS } from "../rec/traits.ts";
import { REASONS } from "../rec/taste.ts";
import { SCALES } from "../lib/types.ts";
import { AboutSection, Banner, PlaytimeRows, SourcesSection } from "./GameMeta.tsx";
import { presetById, presetForGame } from "../mods/companion.ts";
import type { ModProfile } from "../mods/companionTypes.ts";
import { gameKey, hiddenUntil, MARK_LABEL } from "../discover/marks.ts";
import type { Nav } from "../App.tsx";

export function GameDetail({ id, onClose, nav }: { id: string; onClose(): void; nav?: Nav }) {
  const { games, gameById, settings, setSettings, updateGame, setLength, setTags, collections, repo, run, reloadCollections, profile, recEvents, setLogFor } = useApp();
  const { taste, series, marksByGame } = useTaste();
  const g = gameById.get(id);
  const [width, setWidth] = useState(settings.detailWidth);
  const [dragging, setDragging] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [newTag, setNewTag] = useState("");
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    void repo.driver
      .select<Record<string, unknown>>(`SELECT * FROM events WHERE game_id = ? ORDER BY ts DESC, id DESC LIMIT 30`, [id])
      .then((rows) => setEvents(rows.map((r) => ({ id: Number(r.id), ts: String(r.ts), type: String(r.type), gameId: id, data: JSON.parse(String(r.data || "{}")) }))));
  }, [id, repo, g?.updatedAt]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => setWidth(Math.max(300, Math.min(720, startW.current + (startX.current - e.clientX))));
    const up = () => {
      setDragging(false);
      setSettings({ detailWidth: width });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging, width, setSettings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".shade") && !(e.target as HTMLElement)?.closest?.("input, textarea, select")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!g) return null;
  const set = (patch: Parameters<typeof updateGame>[1]) => void updateGame(g.id, patch);
  const inCols = new Set(collections.filter((c) => c.gameIds.includes(g.id)).map((c) => c.id));
  const upNext = collections.find((c) => c.name.toLowerCase() === "up next") ?? null;

  return (
    <aside className="detail" style={{ width: `min(${width}px, 46vw)` }} aria-label={`Details for ${cleanTitle(g.title)}`}>
      <div
        className={"resize" + (dragging ? " on" : "")}
        onMouseDown={(e) => {
          startX.current = e.clientX;
          startW.current = width;
          setDragging(true);
          e.preventDefault();
        }}
        onDoubleClick={() => {
          setWidth(400);
          setSettings({ detailWidth: 400 });
        }}
        title="Drag to resize (double-click to reset)"
        role="separator"
        aria-orientation="vertical"
      />
      <div className="titlebar" style={{ minHeight: "2.4rem", padding: "0 0.4rem 0 0.85rem" }}>
        <span className="mono dim" style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Game details</span>
        <div className="right">
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close details (Esc)" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="scroll">
        <Banner game={g} />
        <div className="dhead">
          <Cover game={g} eager />
          <div style={{ display: "grid", gap: "0.45rem", minWidth: 0 }}>
            <TitleEditor game={g} onSave={(title) => set({ title })} />
            <div className="row" style={{ gap: "0.6rem" }}>
              <Stars value={g.rating} onChange={(rating) => set({ rating })} />
              <button className={"star" + (g.favorite ? " on" : "")} onClick={() => set({ favorite: !g.favorite })} aria-label={g.favorite ? "Remove favorite" : "Mark favorite"} title="Favorite">
                <Icon name="star" />
              </button>
            </div>
            <select className="select" value={g.status} onChange={(e) => set({ status: e.target.value as Game["status"] })} aria-label="Status">
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="quick" role="group" aria-label="Quick actions">
          {g.status !== "playing" && (
            <button className="btn sm primary" onClick={() => set({ status: "playing" })}>
              <Icon name="play" /> {g.status === "paused" ? "Resume" : "Start playing"}
            </button>
          )}
          {g.status === "playing" && (
            <button className="btn sm" onClick={() => set({ status: "paused" })}>
              <Icon name="pause" /> Pause
            </button>
          )}
          {(g.status === "playing" || g.status === "paused" || g.status === "replay") && (
            <button className="btn sm" onClick={() => set({ status: "completed" })}>
              <Icon name="check" /> Completed
            </button>
          )}
          <button className="btn sm" onClick={() => setLogFor({ gameId: g.id })}>Log session</button>
          {upNext &&
            (upNext.gameIds.includes(g.id) ? (
              <button
                className="btn sm ghost"
                onClick={async () => {
                  await run(() => repo.removeFromCollection(upNext.id, [g.id]), "Removed from Up Next.");
                  await reloadCollections();
                }}
              >
                Up Next #{upNext.gameIds.indexOf(g.id) + 1} ✕
              </button>
            ) : (
              <button
                className="btn sm ghost"
                onClick={async () => {
                  await run(() => repo.addToCollection(upNext.id, [g.id]), "Added to the end of Up Next.");
                  await reloadCollections();
                }}
              >
                <Icon name="plus" /> Up Next
              </button>
            ))}
        </div>

        <WhySection gameId={id} games={games} taste={taste} series={series} profile={profile} recEvents={recEvents} allowUnverified={settings.useUnverifiedLengths} marks={marksByGame} />

        <AboutSection game={g} />

        <DiscoverAnswer gameId={g.id} />
        <ModdingSection game={g} nav={nav} />

        <details className="sec" open>
          <summary>Overview</summary>
          <div className="body">
            <div className="form2">
              <label className="lbl">
                Ownership
                <select className="select" value={g.ownership} onChange={(e) => set({ ownership: e.target.value as Game["ownership"] })}>
                  {OWNERSHIP.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="lbl">
                Installed
                <select className="select" value={g.installStatus} onChange={(e) => set({ installStatus: e.target.value as Game["installStatus"] })}>
                  {INSTALL.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="lbl">
                <span className="lbl-row">Players {g.metaSource.multiplayer && <SourceBadge source={g.metaSource.multiplayer} />}</span>
                <select className="select" value={g.multiplayer} onChange={(e) => set({ multiplayer: e.target.value as Game["multiplayer"] })}>
                  {MULTIPLAYER.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="lbl">
                <span className="lbl-row">Endless / sandbox {g.metaSource.endless && <SourceBadge source={g.metaSource.endless} />}</span>
                <select
                  className="select"
                  value={g.endless == null ? "" : g.endless ? "1" : "0"}
                  onChange={(e) => set({ endless: e.target.value === "" ? null : e.target.value === "1" })}
                >
                  <option value="">Unknown</option>
                  <option value="1">Yes, no real ending</option>
                  <option value="0">No, it ends</option>
                </select>
              </label>
              <label className="lbl">
                Platform
                <CommitInput value={g.platform} onCommit={(v) => set({ platform: v.trim() || "PC" })} />
              </label>
              <label className="lbl">
                Store
                <CommitInput value={g.storefront ?? ""} placeholder="unknown" onCommit={(v) => set({ storefront: v.trim() || null })} />
              </label>
              <label className="lbl" style={{ gridColumn: "1 / -1" }}>
                Suggest in Pick for me
                <select className="select" value={g.recPref} onChange={(e) => set({ recPref: e.target.value as Game["recPref"] })}>
                  {REC_PREFS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
            </div>
          </div>
        </details>

        <details className="sec" open>
          <summary>
            Length
            <span className="right dim mono" style={{ fontSize: "var(--fs-xs)" }}>your value wins</span>
          </summary>
          <div className="body">
            {LENGTH_KINDS.map((k) => {
              const eff = effectiveLength(g, k.id, settings.useUnverifiedLengths);
              const mine = g.lengths.find((l) => l.kind === k.id && l.source === "user");
              const other = g.lengths.filter((l) => l.kind === k.id && l.source !== "user");
              return (
                <div className="lenrow" key={k.id}>
                  <span className="dim">{k.label}</span>
                  <span className="num" title={eff ? SOURCE_LABEL[eff.source] ?? eff.source : "No data"}>
                    {eff ? (
                      <>
                        {fmtHours(eff.hours)} <SourceBadge source={eff.source} />
                        {mine && other.length > 0 && <span className="dim" style={{ fontSize: "var(--fs-xs)" }}> (est. {fmtHours(other[0].hours)})</span>}
                      </>
                    ) : (
                      <span className="dim">unknown</span>
                    )}
                  </span>
                  <CommitInput
                    value={mine ? String(mine.hours) : ""}
                    placeholder="yours"
                    ariaLabel={`Your ${k.label} hours`}
                    onCommit={(v) => {
                      const t = v.trim();
                      const n = t === "" ? null : Number(t);
                      if (n != null && !(n >= 0 && n < 10000)) return;
                      void setLength(g.id, k.id, n);
                    }}
                  />
                </div>
              );
            })}
            <div className="lenrow">
              <span className="dim">Length class</span>
              <span>
                {g.scale ? (
                  <SourceBadge source={g.metaSource.scale ?? "user"} />
                ) : (
                  <span className="dim">{g.endless ? "endless flag" : g.lengths.length ? "from hours" : "unknown"}</span>
                )}
              </span>
              <select className="select" value={g.scale ?? ""} onChange={(e) => set({ scale: (e.target.value || null) as Game["scale"] })} aria-label="Length class">
                <option value="">—</option>
                {SCALES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            {g.lengths.some((l) => l.source === "legacy_table" || l.source === "ai_estimate") && (
              <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
                <span className="badge est">est.</span> = carried over from the old REWIND table; never verified. Type your own hours to override.
              </div>
            )}
            <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => void openExternal(`https://howlongtobeat.com/?q=${encodeURIComponent(cleanTitle(g.title))}`)}>
              Look up on HowLongToBeat ↗
            </button>
          </div>
        </details>

        <details className="sec" open>
          <summary>Notes</summary>
          <div className="body">
            <NotesEditor game={g} onSave={(notes) => set({ notes })} />
          </div>
        </details>

        <details className="sec" open>
          <summary>Tags</summary>
          <div className="body">
            <div className="chips">
              {g.tags.length === 0 && <span className="dim" style={{ fontSize: "var(--fs-s)" }}>No tags yet.</span>}
              {g.tags.map((t) => (
                <span key={t.tag} className={"chip" + (t.source === "user" ? " user" : "")} title={t.source === "user" ? "Your tag" : SOURCE_LABEL[t.source === "legacy" ? "legacy_table" : t.source] ?? t.source}>
                  {t.tag}
                  <button aria-label={`Remove tag ${t.tag}`} onClick={() => void setTags(g.id, g.tags.filter((x) => x.tag !== t.tag).map((x) => x.tag))}>
                    <Icon name="x" className="ico" />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTag.trim()) return;
                void setTags(g.id, [...g.tags.map((t) => t.tag), ...newTag.split(",")]);
                setNewTag("");
              }}
            >
              <input className="field grow" placeholder="add tags, comma separated" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
              <button className="btn sm" type="submit">Add</button>
            </form>
          </div>
        </details>

        <details className="sec">
          <summary>
            Traits <span className="right dim mono" style={{ fontSize: "var(--fs-xs)" }}>inferred from tags</span>
          </summary>
          <div className="body">
            <TraitBars values={taste.traits.get(g.id)?.values} />
            <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
              Worked out from the tags above, so they're only as accurate as the tags. Add tags like <span className="mono">guided</span>,{" "}
              <span className="mono">aimless</span>, <span className="mono">grind</span>, <span className="mono">punishing</span>, <span className="mono">gentle</span>,{" "}
              <span className="mono">dialogue</span>, <span className="mono">setup</span>, <span className="mono">quicksession</span> or <span className="mono">tense</span> to correct them.
            </div>
            {recEvents.some((e) => e.gameId === g.id && (e.kind === "pass" || e.kind === "drop")) && (
              <div style={{ fontSize: "var(--fs-s)" }}>
                <div className="mono dim" style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Your passes and drop reasons</div>
                {recEvents
                  .filter((e) => e.gameId === g.id && (e.kind === "pass" || e.kind === "drop"))
                  .slice(-6)
                  .reverse()
                  .map((e) => (
                    <div key={e.id}>
                      {fmtDateTime(e.ts)} · {e.kind === "pass" ? "passed" : "dropped"}: {REASONS[e.reason ?? ""]?.label ?? e.reason ?? "no reason"}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </details>

        <details className="sec" open={collections.length > 0 && collections.length < 8}>
          <summary>
            Collections <span className="right dim num">{inCols.size}</span>
          </summary>
          <div className="body">
            {collections.length === 0 && <span className="dim" style={{ fontSize: "var(--fs-s)" }}>No collections yet. Create one in Collections.</span>}
            {collections.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={inCols.has(c.id)}
                  onChange={async (e) => {
                    const add = e.target.checked;
                    await run(async () => {
                      if (add) await repo.addToCollection(c.id, [g.id]);
                      else await repo.removeFromCollection(c.id, [g.id]);
                    });
                    await reloadCollections();
                  }}
                />
                {c.name}
              </label>
            ))}
          </div>
        </details>

        <details className="sec">
          <summary>Playtime & dates</summary>
          <div className="body">
            <dl className="kv">
              <PlaytimeRows game={g} />
              <dt>Completed</dt>
              <dd>
                <CommitInput type="date" value={g.dateCompleted ?? ""} onCommit={(v) => set({ dateCompleted: v || null })} />
              </dd>
              <dt>Dropped</dt>
              <dd>
                <CommitInput type="date" value={g.dateDropped ?? ""} onCommit={(v) => set({ dateDropped: v || null })} />
              </dd>
              <dt>Added</dt>
              <dd className="num">{fmtDate(g.createdAt)}</dd>
            </dl>
            <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
              REWIND uses the larger of the two figures. Playtime is never treated as proof you enjoyed a game; log sessions yourself for a real history.
            </div>
          </div>
        </details>

        <SourcesSection game={g} />

        <details className="sec">
          <summary>
            Your corrections <span className="right dim mono" style={{ fontSize: "var(--fs-xs)" }}>override store data</span>
          </summary>
          <div className="body">
            <div className="form2">
              <label className="lbl">
                Release year
                <CommitInput value={g.releaseYear ? String(g.releaseYear) : ""} placeholder="unknown" onCommit={(v) => set({ releaseYear: /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : null })} />
              </label>
              <label className="lbl">
                Developer
                <CommitInput value={g.developer ?? ""} placeholder="unknown" onCommit={(v) => set({ developer: v.trim() || null })} />
              </label>
              <label className="lbl">
                Publisher
                <CommitInput value={g.publisher ?? ""} placeholder="unknown" onCommit={(v) => set({ publisher: v.trim() || null })} />
              </label>
            </div>
            <div className="dim" style={{ fontSize: "var(--fs-s)" }}>Leave these empty to show what Steam or IGDB says. Anything you type here wins and is never replaced by a sync.</div>
          </div>
        </details>

        <details className="sec">
          <summary>
            History <span className="right dim num">{events.length}</span>
          </summary>
          <div className="body">
            {events.length === 0 ? (
              <span className="dim" style={{ fontSize: "var(--fs-s)" }}>No recorded changes yet.</span>
            ) : (
              <div className="eventlog inset">
                {events.map((e) => (
                  <div className="ev" key={e.id}>
                    <time>{fmtDateTime(e.ts)}</time>
                    <span>{describeEvent(e)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    </aside>
  );
}

function TitleEditor({ game, onSave }: { game: Game; onSave(t: string): void }) {
  const [v, setV] = useState(cleanTitle(game.title));
  useEffect(() => setV(cleanTitle(game.title)), [game.title]);
  return (
    <textarea
      className="dtitle"
      rows={2}
      value={v}
      aria-label="Title"
      title="Click to rename"
      onChange={(e) => setV(e.target.value.replace(/\n/g, " "))}
      onBlur={() => {
        const t = v.trim();
        if (t && t !== cleanTitle(game.title)) onSave(t);
        else setV(cleanTitle(game.title));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function NotesEditor({ game, onSave }: { game: Game; onSave(n: string): void }) {
  const [v, setV] = useState(game.notes);
  const [dirty, setDirty] = useState(false);
  const latest = useRef({ v, dirty, onSave });
  latest.current = { v, dirty, onSave };
  // Switching to another game or closing the panel never loses a half-typed note.
  useEffect(() => () => {
    if (latest.current.dirty) latest.current.onSave(latest.current.v);
  }, []);
  useEffect(() => {
    setV(game.notes);
    setDirty(false);
  }, [game.notes]);
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      onSave(v);
      setDirty(false);
    }, 900);
    return () => window.clearTimeout(t);
  }, [v, dirty, onSave]);
  return (
    <>
      <textarea
        className="field"
        value={v}
        placeholder="Where you left off, mods you used, what to remember next time…"
        onChange={(e) => {
          setV(e.target.value);
          setDirty(true);
        }}
        onBlur={() => {
          if (dirty) {
            onSave(v);
            setDirty(false);
          }
        }}
      />
      <span className="dim mono" style={{ fontSize: "var(--fs-xs)" }}>{dirty ? "saving…" : "saved"}</span>
    </>
  );
}

export function describeEvent(e: EventRow, title?: string): string {
  const t = title ? `${title}: ` : "";
  const label = (s: unknown) => STATUSES.find((x) => x.id === s)?.label ?? String(s);
  switch (e.type) {
    case "status":
      return `${t}${label(e.data.from)} → ${label(e.data.to)}`;
    case "rating":
      return `${t}rating ${e.data.to ? "★".repeat(Number(e.data.to)) : "cleared"}`;
    case "game_added":
      return `${t || String(e.data.title) + ": "}added to library`;
    case "import":
      return `Imported from ${String(e.data.from)}: ${e.data.added} added, ${e.data.merged} merged, ${e.data.skipped} skipped`;
    case "restore":
      return `Backup restored (${String(e.data.mode)})`;
    case "steam_import": {
      const src = e.data.source === "steam_local" ? "Steam client on this PC" : "Steam account";
      return `Steam import (${src}): ${Number(e.data.linked ?? 0)} matched, ${Number(e.data.added ?? 0)} added, Steam playtime updated for ${Number(e.data.playtimeUpdated ?? 0)}`;
    }
    case "metadata_sync": {
      const c = e.data as Record<string, number | string>;
      const bits = [c.linked && `${c.linked} linked`, c.fetched && `${c.fetched} updated`, c.covers && `${c.covers} covers`, c.review && `${c.review} to review`].filter(Boolean);
      const how = c.outcome === "complete" ? "" : c.outcome === "offline" ? " (stopped: offline)" : c.outcome === "cancelled" ? " (stopped by you)" : ` (${String(c.outcome)})`;
      return `Details & covers sync${how}${bits.length ? ": " + bits.join(", ") : ": nothing new"}`;
    }
    case "session": {
      const m = e.data.minutes == null ? null : Number(e.data.minutes);
      return `${t}played${m ? ` for ${m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`}` : ""} (logged for ${String(e.data.date)})`;
    }
    case "legacy_log":
      return `[old REWIND] ${String(e.data.text).replace(/[™®]/g, "")}`;
    case "discover_lookup":
      return `Discover looked beyond your library on IGDB: ${Number(e.data.games ?? 0)} games found from ${Number(e.data.seeds ?? 0)} favourites`;
    case "mod_profile_created":
      return `${t}modding profile "${String(e.data.name)}" created`;
    case "mod_profile_deleted":
      return `${t}modding profile "${String(e.data.name)}" deleted`;
    case "game_added_from_discover":
      return `${t || String(e.data.title) + ": "}added to library from Discover (${String(e.data.ownership)})`;
    default:
      return `${t}${e.type}`;
  }
}

function WhySection({
  gameId,
  games,
  taste,
  series,
  profile,
  recEvents,
  allowUnverified,
  marks,
}: {
  marks: Map<string, { kind: string }>;
  gameId: string;
  games: Game[];
  taste: ReturnType<typeof useTaste>["taste"];
  series: ReturnType<typeof useTaste>["series"];
  profile: ReturnType<typeof useApp>["profile"];
  recEvents: ReturnType<typeof useApp>["recEvents"];
  allowUnverified: boolean;
}) {
  const r = recommend({ games, taste, events: recEvents, session: EMPTY_SESSION, weights: DEFAULT_WEIGHTS, profile, series, allowUnverified, marks });
  const rec = r.results.find((x) => x.game.id === gameId);
  return (
    <details className="sec" open>
      <summary>
        Why REWIND would suggest it
        <span className="right">{rec ? <span className={"band b-" + rec.band}>{BAND_LABEL[rec.band]}</span> : <span className="dim mono" style={{ fontSize: "var(--fs-xs)" }}>not suggested</span>}</span>
      </summary>
      <div className="body" style={{ fontSize: "var(--fs-s)" }}>
        {!rec ? (
          <div className="dim">
            Left out of suggestions:{" "}
            {(() => {
              const g = games.find((x) => x.id === gameId)!;
              if (g.tags.some((t) => t.tag === "tool")) return "it's a tool or test client.";
              if (g.status === "not_interested") return "marked Not interested.";
              if (g.recPref === "never") return "set to never suggest.";
              if (g.multiplayer === "mp_required" || g.multiplayer === "coop_focused") return "it needs other players (change Players above if that's wrong).";
              if (g.status === "completed") return "you've finished it (Pick for me includes finished games under 'Something nostalgic').";
              if (g.ownership !== "owned") return "you don't own it.";
              return "excluded by current settings.";
            })()}
          </div>
        ) : (
          <>
            <div className="dim">With no mood or time set — Pick for me adjusts this to each session.</div>
            {rec.pros.length > 0 && (
              <ul className="pros">
                {rec.pros.map((p) => <li key={p.text}>{p.text}</li>)}
              </ul>
            )}
            {rec.cons.length > 0 && (
              <ul className="cons">
                {rec.cons.map((p) => <li key={p.text}>{p.text}</li>)}
              </ul>
            )}
            <div className="mono dim" style={{ fontSize: "var(--fs-xs)" }}>
              {rec.confidence.level} confidence · {rec.sources.join(" · ")}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function TraitBars({ values }: { values: Record<string, number | null> | undefined }) {
  if (!values) return null;
  const known = TRAITS.filter((t) => values[t] != null);
  if (!known.length) return <div className="dim" style={{ fontSize: "var(--fs-s)" }}>No tags yet, so no traits.</div>;
  return (
    <div className="traitbars">
      {known.map((t) => (
        <div key={t} className="tb">
          <span>{TRAIT_LABEL[t]}</span>
          <span className="track"><span className="fill" style={{ width: `${(values[t] ?? 0) * 100}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

/** Your Discover answer for this game, if any, with a way to clear it. */
function DiscoverAnswer({ gameId }: { gameId: string }) {
  const { marks, clearMark } = useApp();
  const m = marks.get(gameKey(gameId));
  if (!m) return null;
  const until = hiddenUntil(m);
  return (
    <div className="note info row" style={{ fontSize: "var(--fs-s)" }}>
      <span className="grow">
        Your answer in Discover: <b>{MARK_LABEL[m.kind]}</b> ({fmtDate(m.updatedAt)}){until ? ` — hidden from suggestions until ${until}` : ""}.
      </span>
      <button className="btn ghost sm" onClick={() => void clearMark(m.key)}>
        Clear
      </button>
    </div>
  );
}

/** Modding-companion profiles linked to this game. */
function ModdingSection({ game, nav }: { game: Game; nav?: Nav }) {
  const { repo, run } = useApp();
  const [profiles, setProfiles] = useState<ModProfile[] | null>(null);
  const preset = presetForGame(game);
  useEffect(() => {
    void repo.loadModProfiles().then((ps) => setProfiles(ps.filter((p) => p.gameId === game.id)));
  }, [repo, game.id]);
  if (!profiles || (!profiles.length && !preset)) return null;
  return (
    <details className="sec" open={profiles.length > 0}>
      <summary>Modding {profiles.length > 0 && <span className="dim">({profiles.length})</span>}</summary>
      <div className="body" style={{ display: "grid", gap: "0.4rem" }}>
        {profiles.map((p) => (
          <div key={p.id} className="row">
            <span className="grow">
              <b>{p.name}</b> <span className="dim">· {p.entries.length} mods{p.manager ? ` · ${p.manager}` : ""} · {p.status}</span>
            </span>
            {nav && (
              <button className="btn sm" onClick={() => nav.openModProfile(p.id)}>
                Open
              </button>
            )}
          </div>
        ))}
        {preset && nav && (
          <button
            className="btn sm"
            onClick={async () => {
              const id = await run(() => repo.createModProfile({ name: `${cleanTitle(game.title)} — modded`, gameKey: preset.id, gameId: game.id, gameTitle: game.title, manager: presetById(preset.id).managers[0] ?? "", checklist: preset.checklist }));
              if (id) nav.openModProfile(id);
            }}
          >
            <Icon name="plus" /> Plan a modded playthrough
          </button>
        )}
      </div>
    </details>
  );
}
