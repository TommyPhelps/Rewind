// A game's details: play, status, rating and notes up front; facts next; technical and
// source information folded away until you want it.

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/store.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ContextMenu, type MenuItem } from "../ui/Overlays.tsx";
import { CommitInput, Cover, FavButton, fmtDate, fmtDateTime, fmtDay, SourceBadge, Stars } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { companies, effectiveLength, fmtHours, fmtPlaytime, releaseYear } from "../lib/library.ts";
import { INSTALL, LAUNCHER_LABEL, LENGTH_KINDS, MULTIPLAYER, OWNERSHIP, REC_PREFS, SCALES, SOURCE_LABEL, STATUSES, type EventRow, type Game } from "../lib/types.ts";
import { openExternal } from "../platform/native.ts";
import { useTaste } from "../state/recs.ts";
import { DEFAULT_WEIGHTS, EMPTY_SESSION, recommend } from "../rec/engine.ts";
import { explain } from "../rec/explain.ts";
import { TRAIT_LABEL, TRAITS } from "../rec/traits.ts";
import { REASONS } from "../rec/taste.ts";
import { AboutSection, Banner, PlaytimeRows, SourcesSection } from "./GameMeta.tsx";
import { gameKey, hiddenUntil, MARK_LABEL } from "../discover/marks.ts";
import { launchTarget } from "../launchers/launch.ts";
import type { Nav } from "../App.tsx";

export function GameDetail({ id, onClose }: { id: string; onClose(): void; nav?: Nav }) {
  const { gameById, settings, setSettings, updateGame, setLength, setTags, repo, run, reloadAll, confirm, setLogFor, upNextIds, toggleUpNext, timer, play, stopTimer } = useApp();
  const g = gameById.get(id);
  const [width, setWidth] = useState(settings.detailWidth);
  const [dragging, setDragging] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [newTag, setNewTag] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [legacyMods, setLegacyMods] = useState(0);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    void repo.driver
      .select<Record<string, unknown>>(`SELECT * FROM events WHERE game_id = ? ORDER BY ts DESC, id DESC LIMIT 40`, [id])
      .then((rows) => setEvents(rows.map((r) => ({ id: Number(r.id), ts: String(r.ts), type: String(r.type), gameId: id, data: JSON.parse(String(r.data || "{}")) }))));
  }, [id, repo, g?.updatedAt]);
  useEffect(() => {
    void repo.driver.select<{ n: number }>(`SELECT COUNT(*) AS n FROM mod_profiles WHERE game_id = ?`, [id]).then((r) => setLegacyMods(Number(r[0]?.n ?? 0))).catch(() => setLegacyMods(0));
  }, [id, repo]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => setWidth(Math.max(340, Math.min(760, startW.current + (startX.current - e.clientX))));
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
      if (e.key === "Escape" && !document.querySelector(".shade, .menu") && !(e.target as HTMLElement)?.closest?.("input, textarea, select")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!g) return null;
  const set = (patch: Parameters<typeof updateGame>[1]) => void updateGame(g.id, patch);
  const target = launchTarget(g);
  const timing = timer?.gameId === g.id;
  const queued = upNextIds.indexOf(g.id);
  const year = releaseYear(g);
  const dev = g.developer ?? companies(g)[0];
  const where = [...new Set(g.sources.map((s) => LAUNCHER_LABEL[s.source]))];
  const meta = [year, dev, where.length ? where.join(", ") : g.storefront].filter(Boolean).join(" · ");

  const moreMenu = (e: { clientX: number; clientY: number }) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Log a play session…", icon: "clock", onClick: () => setLogFor({ gameId: g.id }) },
        { label: g.status === "not_interested" ? "Set back to Backlog" : "Not interested", onClick: () => set({ status: g.status === "not_interested" ? "backlog" : "not_interested" }) },
        { separator: true },
        {
          label: "Remove from library…",
          icon: "trash",
          danger: true,
          onClick: async () => {
            if (!(await confirm({ title: "Remove from library", danger: true, ok: "Remove", body: <p>Remove <b>{cleanTitle(g.title)}</b> from REWIND, with its notes, tags and history? Nothing is uninstalled.</p> }))) return;
            await run(async () => {
              await repo.deleteGames([g.id]);
              await reloadAll();
            }, `Removed ${cleanTitle(g.title)}.`);
            onClose();
          },
        },
      ],
    });

  return (
    <aside className="drawer" style={{ ["--dw" as string]: `${width}px` }} aria-label={`Details for ${cleanTitle(g.title)}`}>
      <div
        className={"resize" + (dragging ? " on" : "")}
        onMouseDown={(e) => {
          startX.current = e.clientX;
          startW.current = width;
          setDragging(true);
          e.preventDefault();
        }}
        onDoubleClick={() => {
          setWidth(440);
          setSettings({ detailWidth: 440 });
        }}
        title="Drag to resize (double-click to reset)"
        role="separator"
        aria-orientation="vertical"
      />
      <div className="drawer-head">
        <span className="meta">Game details</span>
        <button className="btn ghost icon sm" onClick={(e) => moreMenu(e)} aria-label="More actions" title="More">
          <Icon name="more" />
        </button>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close details (Esc)" title="Close (Esc)">
          <Icon name="x" />
        </button>
      </div>
      <div className="drawer-body">
        <Banner game={g} />
        <div className="d-top">
          <Cover game={g} eager />
          <div className="d-id">
            <TitleEditor game={g} onSave={(title) => set({ title })} />
            {meta && <span className="d-meta">{meta}</span>}
            <select className="select sm" value={g.status} onChange={(e) => set({ status: e.target.value as Game["status"] })} aria-label="Status" style={{ justifySelf: "start" }}>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <div className="row nowrap" style={{ gap: "var(--s3)" }}>
              <Stars value={g.rating} onChange={(rating) => set({ rating })} />
              <FavButton on={g.favorite} onToggle={() => set({ favorite: !g.favorite })} />
            </div>
          </div>
        </div>

        <div className="d-acts" role="group" aria-label="Actions">
          {timing ? (
            <button className="btn primary" onClick={stopTimer}>
              <Icon name="stop" /> Stop and log
            </button>
          ) : (
            <button className="btn primary" onClick={() => void play(g.id)} title={target ? `Start through ${LAUNCHER_LABEL[target.source]}` : "There's no launcher link for this game: this starts a session timer"}>
              <Icon name="play" /> {target ? (g.status === "paused" ? "Continue" : "Play") : "Start timer"}
            </button>
          )}
          {g.status === "playing" && (
            <button className="btn" onClick={() => set({ status: "paused" })}>
              <Icon name="pause" /> Pause
            </button>
          )}
          {(g.status === "playing" || g.status === "paused" || g.status === "replay") && (
            <button className="btn" onClick={() => set({ status: "completed" })}>
              <Icon name="check" /> Complete
            </button>
          )}
          <button className="btn" aria-pressed={queued >= 0} onClick={() => void toggleUpNext(g.id)} title={queued >= 0 ? "Remove from Up Next" : "Add to the end of Up Next"}>
            <Icon name="queue" /> {queued >= 0 ? `Up Next #${queued + 1}` : "Up Next"}
          </button>
        </div>
        {target && !target.installed && target.installed !== null && <div className="meta" style={{ padding: "0 var(--s4) var(--s3)" }}>Not installed as of the last scan — {LAUNCHER_LABEL[target.source]} will offer to install it.</div>}

        <DiscoverAnswer gameId={g.id} />

        <details className="dsec" open>
          <summary>Notes</summary>
          <div className="body">
            <NotesEditor game={g} onSave={(notes) => set({ notes })} />
          </div>
        </details>

        <details className="dsec" open>
          <summary>
            Tags <span className="hint">{g.tags.length || ""}</span>
          </summary>
          <div className="body">
            <div className="chips">
              {g.tags.length === 0 && <span className="meta">No tags yet.</span>}
              {g.tags.map((t) => (
                <span key={t.tag} className={"chip" + (t.source === "user" ? " user" : "")} title={t.source === "user" ? "Your tag" : SOURCE_LABEL[t.source === "legacy" ? "legacy_table" : t.source] ?? t.source}>
                  {t.tag}
                  <button aria-label={`Remove tag ${t.tag}`} onClick={() => void setTags(g.id, g.tags.filter((x) => x.tag !== t.tag).map((x) => x.tag))}>
                    <Icon name="x" />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="row nowrap"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTag.trim()) return;
                void setTags(g.id, [...g.tags.map((t) => t.tag), ...newTag.split(",")]);
                setNewTag("");
              }}
            >
              <input className="field sm grow" placeholder="Add tags, separated by commas" value={newTag} onChange={(e) => setNewTag(e.target.value)} aria-label="Add tags" />
              <button className="btn sm" type="submit">
                Add
              </button>
            </form>
          </div>
        </details>

        <AboutSection game={g} />

        <details className="dsec">
          <summary>
            Length <span className="hint">{lengthHint(g, settings.useUnverifiedLengths)}</span>
          </summary>
          <div className="body">
            {LENGTH_KINDS.map((k) => {
              const eff = effectiveLength(g, k.id, settings.useUnverifiedLengths);
              const mine = g.lengths.find((l) => l.kind === k.id && l.source === "user");
              return (
                <div className="lenrow" key={k.id}>
                  <span className="muted">{k.label}</span>
                  <span className="num" title={eff ? SOURCE_LABEL[eff.source] ?? eff.source : "No data"}>
                    {eff ? (
                      <>
                        {fmtHours(eff.hours)} <SourceBadge source={eff.source} />
                      </>
                    ) : (
                      <span className="muted">unknown</span>
                    )}
                  </span>
                  <CommitInput
                    className="field"
                    value={mine ? String(mine.hours) : ""}
                    placeholder="your hours"
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
              <span className="muted">Length class</span>
              <span className="meta">{g.scale ? "set" : g.endless ? "no set ending" : "from hours"}</span>
              <select className="select sm" value={g.scale ?? ""} onChange={(e) => set({ scale: (e.target.value || null) as Game["scale"] })} aria-label="Length class">
                <option value="">—</option>
                {SCALES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <span className="meta">Your hours always win over estimates. “estimate” means carried over from the old REWIND table and never verified.</span>
          </div>
        </details>

        <WhySection game={g} />

        <details className="dsec">
          <summary>Your details</summary>
          <div className="body">
            <div className="form2">
              <label className="lbl">
                Ownership
                <select className="select sm" value={g.ownership} onChange={(e) => set({ ownership: e.target.value as Game["ownership"] })}>
                  {OWNERSHIP.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="lbl">
                Installed
                <select className="select sm" value={g.installStatus} onChange={(e) => set({ installStatus: e.target.value as Game["installStatus"] })}>
                  {INSTALL.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="lbl">
                Players
                <select className="select sm" value={g.multiplayer} onChange={(e) => set({ multiplayer: e.target.value as Game["multiplayer"] })}>
                  {MULTIPLAYER.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="lbl">
                Has an ending
                <select className="select sm" value={g.endless == null ? "" : g.endless ? "1" : "0"} onChange={(e) => set({ endless: e.target.value === "" ? null : e.target.value === "1" })}>
                  <option value="">Unknown</option>
                  <option value="0">Yes</option>
                  <option value="1">No (endless or sandbox)</option>
                </select>
              </label>
              <label className="lbl">
                Suggest in Pick for me
                <select className="select sm" value={g.recPref} onChange={(e) => set({ recPref: e.target.value as Game["recPref"] })}>
                  {REC_PREFS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="lbl">
                Platform
                <CommitInput className="field sm" value={g.platform} onCommit={(v) => set({ platform: v.trim() || "PC" })} />
              </label>
              <label className="lbl">
                Release year
                <CommitInput className="field sm" value={g.releaseYear ? String(g.releaseYear) : ""} placeholder={year ? String(year) : "unknown"} onCommit={(v) => set({ releaseYear: /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : null })} />
              </label>
              <label className="lbl">
                Developer
                <CommitInput className="field sm" value={g.developer ?? ""} placeholder={companies(g)[0] ?? "unknown"} onCommit={(v) => set({ developer: v.trim() || null })} />
              </label>
              <label className="lbl">
                Publisher
                <CommitInput className="field sm" value={g.publisher ?? ""} placeholder="unknown" onCommit={(v) => set({ publisher: v.trim() || null })} />
              </label>
              <label className="lbl">
                Completed on
                <CommitInput className="field sm" type="date" value={g.dateCompleted ?? ""} onCommit={(v) => set({ dateCompleted: v || null })} />
              </label>
              <label className="lbl">
                Dropped on
                <CommitInput className="field sm" type="date" value={g.dateDropped ?? ""} onCommit={(v) => set({ dateDropped: v || null })} />
              </label>
            </div>
            <span className="meta">Empty fields show store data in grey. Anything you type wins and is never replaced by a lookup.</span>
          </div>
        </details>

        <details className="dsec">
          <summary>
            Playtime <span className="hint">{fmtPlaytime(Math.max(g.steamPlaytimeMin ?? 0, g.importedPlaytimeMin ?? 0) || null)}</span>
          </summary>
          <div className="body">
            <dl className="kv">
              <PlaytimeRows game={g} />
              {g.sources
                .filter((s) => s.source !== "steam")
                .map((s) => (
                  <PlaytimeLine key={s.source} label={`${LAUNCHER_LABEL[s.source]} playtime`} value={s.playtimeMin} />
                ))}
              <dt>Last played</dt>
              <dd>{g.lastPlayed ? fmtDay(g.lastPlayed) : <span className="muted">—</span>}</dd>
              <dt>Added</dt>
              <dd className="num">{fmtDate(g.createdAt)}</dd>
            </dl>
            <span className="meta">
              Playtime is only shown when a launcher really reports it (Steam does; Epic, Ubisoft Connect and Rockstar don't). Sessions you log or time are kept
              separately in Activity.
            </span>
          </div>
        </details>

        <details className="dsec">
          <summary>
            Launchers and store links <span className="hint">technical</span>
          </summary>
          <div className="body">
            {g.sources.length === 0 ? (
              <span className="meta">No launcher recorded. Import from Settings → Connections, or choose where you have it when adding a game.</span>
            ) : (
              <div className="stack tight">
                {g.sources.map((s) => (
                  <div key={s.source} className="srcrow">
                    <div className="row">
                      <b>{LAUNCHER_LABEL[s.source]}</b>
                      <span className="muted">
                        · {s.installed === true ? "installed" : s.installed === false ? "not installed" : "install state unknown"}
                        {s.lastSeenAt ? ` · seen ${fmtDate(s.lastSeenAt)}` : ""} · {METHOD[s.method] ?? s.method}
                      </span>
                    </div>
                    {s.installPath && <span className="mono muted ellipsis" title={s.installPath}>{s.installPath}</span>}
                    {s.launch && <span className="mono muted ellipsis" title="Launch link">{s.launch}</span>}
                    {s.source === "rockstar" && <span className="meta">Rockstar has no documented way to start a single game: open the Rockstar Games Launcher yourself.</span>}
                  </div>
                ))}
              </div>
            )}
            <SourcesSection game={g} />
            {legacyMods > 0 && (
              <div className="note">
                {legacyMods} modding profile{legacyMods > 1 ? "s" : ""} from REWIND 4 {legacyMods > 1 ? "are" : "is"} kept for this game. Export them from Settings → Data.
              </div>
            )}
          </div>
        </details>

        <details className="dsec">
          <summary>
            History <span className="hint">{events.length}</span>
          </summary>
          <div className="body">
            {events.length === 0 ? (
              <span className="meta">No recorded changes yet.</span>
            ) : (
              <div className="rows">
                {events.map((e) => (
                  <div className="r-item no-lead" key={e.id} style={{ minHeight: 0, padding: "var(--s1) 0" }}>
                    <span className="small">{describeEvent(e)}</span>
                    <span className="meta num">{fmtDateTime(e.ts)}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn sm ghost" style={{ justifySelf: "start" }} onClick={() => void openExternal(`https://howlongtobeat.com/?q=${encodeURIComponent(cleanTitle(g.title))}`)}>
              Look it up on HowLongToBeat <Icon name="external" />
            </button>
          </div>
        </details>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </aside>
  );
}

const METHOD: Record<string, string> = {
  steam_import: "from your Steam library",
  local_scan: "found on this PC",
  manual: "added by you",
  migrated: "from REWIND 4",
};

function PlaytimeLine({ label, value }: { label: string; value: number | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value != null ? fmtPlaytime(value) : <span className="muted">not reported by the launcher</span>}</dd>
    </>
  );
}

function lengthHint(g: Game, allowEst: boolean): string {
  if (g.endless) return "no set ending";
  const m = effectiveLength(g, "main", allowEst);
  const e = effectiveLength(g, "main_extras", allowEst);
  const x = e ?? m;
  return x ? `${x.verified ? "" : "~"}${fmtHours(x.hours)}` : "unknown";
}

function TitleEditor({ game, onSave }: { game: Game; onSave(t: string): void }) {
  const [v, setV] = useState(cleanTitle(game.title));
  useEffect(() => setV(cleanTitle(game.title)), [game.title]);
  return (
    <textarea
      className="d-title"
      rows={1}
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
        if (e.key === "Escape") {
          setV(cleanTitle(game.title));
          e.stopPropagation();
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
  // Switching game or closing the panel never loses a half-typed note.
  useEffect(
    () => () => {
      if (latest.current.dirty) latest.current.onSave(latest.current.v);
    },
    [],
  );
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
        placeholder="Where you left off, what to remember next time…"
        aria-label="Notes"
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
      <span className="meta">{dirty ? "Saving…" : "Saved"}</span>
    </>
  );
}

/** `shown`: the caller already printed the game's name next to this text. */
export function describeEvent(e: EventRow, title?: string, shown = false): string {
  const t = title ? `${title}: ` : "";
  const named = (x: unknown) => (t || shown ? t : String(x) + ": ");
  const label = (s: unknown) => STATUSES.find((x) => x.id === s)?.label ?? String(s);
  switch (e.type) {
    case "status":
      return `${t}${label(e.data.from)} → ${label(e.data.to)}`;
    case "rating":
      return `${t}${e.data.to ? `rated ${"★".repeat(Number(e.data.to))}` : "rating cleared"}`;
    case "game_added":
      return `${named(e.data.title)}added to the library`;
    case "import":
      return `Imported from ${String(e.data.from)}: ${e.data.added} added, ${e.data.merged} merged, ${e.data.skipped} skipped`;
    case "restore":
      return `Backup restored (${String(e.data.mode)})`;
    case "steam_import": {
      const src = e.data.source === "steam_local" ? "Steam on this PC" : "your Steam account";
      return `Steam import from ${src}: ${Number(e.data.linked ?? 0)} matched, ${Number(e.data.added ?? 0)} added, playtime updated for ${Number(e.data.playtimeUpdated ?? 0)}`;
    }
    case "launcher_import": {
      const d = e.data as Record<string, unknown>;
      const srcs = Array.isArray(d.sources) ? (d.sources as string[]).map((s) => LAUNCHER_LABEL[s as keyof typeof LAUNCHER_LABEL] ?? s).join(", ") : "launchers";
      return `Launcher scan (${srcs}): ${Number(d.linked ?? 0)} matched, ${Number(d.added ?? 0)} added${Number(d.uninstalled ?? 0) ? `, ${Number(d.uninstalled)} no longer installed` : ""}`;
    }
    case "metadata_sync": {
      const c = e.data as Record<string, number | string>;
      const bits = [c.linked && `${c.linked} linked`, c.fetched && `${c.fetched} updated`, c.covers && `${c.covers} covers`, c.review && `${c.review} to review`].filter(Boolean);
      const how = c.outcome === "complete" ? "" : c.outcome === "offline" ? " (stopped: offline)" : c.outcome === "cancelled" ? " (stopped by you)" : ` (${String(c.outcome)})`;
      return `Store details lookup${how}${bits.length ? ": " + bits.join(", ") : ": nothing new"}`;
    }
    case "session": {
      const m = e.data.minutes == null ? null : Number(e.data.minutes);
      return `${t}played${m ? ` for ${m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`}` : ""} (session for ${String(e.data.date)})`;
    }
    case "games_merged":
      return `${t}combined with “${String(e.data.merged).replace(/[™®]/g, "")}”`;
    case "legacy_log":
      return `From the old REWIND: ${String(e.data.text).replace(/[™®]/g, "")}`;
    case "discover_lookup":
      return `Discover looked beyond your library: ${Number(e.data.games ?? 0)} games found from ${Number(e.data.seeds ?? 0)} favourites`;
    case "mod_profile_created":
      return `${t}modding profile “${String(e.data.name)}” created (REWIND 4)`;
    case "mod_profile_deleted":
      return `${t}modding profile “${String(e.data.name)}” deleted (REWIND 4)`;
    case "game_added_from_discover":
      return `${named(e.data.title)}added from Discover (${String(e.data.ownership)})`;
    default:
      return `${t}${e.type.replace(/_/g, " ")}`;
  }
}

function WhySection({ game }: { game: Game }) {
  const { games, profile, recEvents, settings } = useApp();
  const { taste, series, marksByGame } = useTaste();
  const allowUnverified = settings.useUnverifiedLengths;
  const [open, setOpen] = useState(false);
  return (
    <details className="dsec" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        Why REWIND would suggest it <span className="hint">on request</span>
      </summary>
      {open && <WhyBody game={game} games={games} taste={taste} series={series} profile={profile} recEvents={recEvents} allowUnverified={allowUnverified} marks={marksByGame} />}
    </details>
  );
}

function WhyBody({
  game,
  games,
  taste,
  series,
  profile,
  recEvents,
  allowUnverified,
  marks,
}: {
  game: Game;
  games: Game[];
  taste: ReturnType<typeof useTaste>["taste"];
  series: ReturnType<typeof useTaste>["series"];
  profile: ReturnType<typeof useApp>["profile"];
  recEvents: ReturnType<typeof useApp>["recEvents"];
  allowUnverified: boolean;
  marks: Map<string, { kind: string }>;
}) {
  const r = recommend({ games, taste, events: recEvents, session: EMPTY_SESSION, weights: DEFAULT_WEIGHTS, profile, series, allowUnverified, marks });
  const rec = r.results.find((x) => x.game.id === game.id);
  if (!rec) {
    const why = game.tags.some((t) => t.tag === "tool")
      ? "it's a tool, not a game."
      : game.status === "not_interested"
        ? "you marked it Not interested."
        : game.recPref === "never"
          ? "it's set to never be suggested (Your details)."
          : game.multiplayer === "mp_required" || game.multiplayer === "coop_focused"
            ? "it needs other players (change Players under Your details if that's wrong)."
            : game.status === "completed"
              ? "you've finished it (Pick for me can still offer it as a replay)."
              : game.ownership !== "owned"
                ? "you don't own it."
                : "it's excluded by your current settings.";
    return (
      <div className="body">
        <span className="dim">Not suggested right now: {why}</span>
      </div>
    );
  }
  const e = explain(rec, allowUnverified, 5);
  const traits = taste.traits.get(game.id)?.values;
  const known = traits ? TRAITS.filter((t) => traits[t] != null) : [];
  const passes = recEvents.filter((x) => x.gameId === game.id && (x.kind === "pass" || x.kind === "drop")).slice(-5).reverse();
  return (
    <div className="body">
      {e.reasons.length > 0 ? (
        <ul className="why">
          {e.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <span className="dim">Nothing specific stands out for this game yet — rate similar games or add tags to tell REWIND more.</span>
      )}
      {rec.cons.length > 0 && (
        <ul className="why cons">
          {rec.cons.slice(0, 3).map((x) => (
            <li key={x.text}>{x.text}</li>
          ))}
        </ul>
      )}
      <span className="meta">
        {rec.confidence.level} confidence · based on {rec.sources.join(", ") || "your library only"}. Pick for me adjusts this to your mood and time.
      </span>
      {known.length > 0 && (
        <div className="traitbars" aria-label="Traits worked out from tags">
          {known.map((t) => (
            <div key={t} className="tb">
              <span>{TRAIT_LABEL[t]}</span>
              <span className="track">
                <span className="fill" style={{ width: `${(traits![t] ?? 0) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
      {passes.length > 0 && (
        <div className="stack tight">
          <span className="meta">Your passes and drop reasons</span>
          {passes.map((x) => (
            <span key={x.id} className="small dim">
              {fmtDay(x.ts)} · {x.kind === "pass" ? "passed" : "dropped"}: {REASONS[x.reason ?? ""]?.label ?? x.reason ?? "no reason"}
            </span>
          ))}
        </div>
      )}
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
    <div className="note row" style={{ margin: "0 var(--s4) var(--s4)" }}>
      <span className="grow">
        You said <b>{MARK_LABEL[m.kind]}</b> in Discover ({fmtDay(m.updatedAt)}){until ? `, hidden from suggestions until ${until}` : ""}.
      </span>
      <button className="btn ghost sm" onClick={() => void clearMark(m.key)}>
        Clear
      </button>
    </div>
  );
}
