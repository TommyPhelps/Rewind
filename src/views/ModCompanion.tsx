import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { exportModList, GAME_PRESETS, isKnownModSite, moddableGames, parseModList, presetById, presetForGame, type ParseResult } from "../mods/companion.ts";
import { NOTE_KINDS, PROFILE_STATUSES, RUN_STATUSES, type ModEntry, type ModNote, type ModProfile, type NoteKind, type RunStatus } from "../mods/companionTypes.ts";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { CommitInput, fmtDate } from "../ui/bits.tsx";
import { openExternal, pickTextFile, saveTextFile } from "../platform/native.ts";
import type { Nav } from "../App.tsx";

export function CompanionTab({ nav, selected, onSelect, onCount, onOpenPack }: { nav: Nav; selected: string | null; onSelect(id: string | null): void; onCount(n: number): void; onOpenPack(): void }) {
  const { repo, run } = useApp();
  const [profiles, setProfiles] = useState<ModProfile[] | null>(null);
  const [creating, setCreating] = useState(false);
  const reload = useCallback(async () => {
    const ps = await repo.loadModProfiles();
    setProfiles(ps);
    onCount(ps.length);
  }, [repo, onCount]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const cur = profiles?.find((p) => p.id === selected) ?? profiles?.[0] ?? null;

  return (
    <div className="comp">
      <aside className="comp-list">
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> New modding profile
        </button>
        <div className="note info" style={{ fontSize: "var(--fs-xs)" }}>
          Your own records: mod lists, notes, backups and playthroughs. REWIND never reads or changes game folders or mod-manager files on its own.
        </div>
        {profiles?.length === 0 && <div className="empty">No profiles yet.</div>}
        {(profiles ?? []).map((p) => (
          <button key={p.id} className="dr-item" aria-current={cur?.id === p.id ? "page" : undefined} onClick={() => onSelect(p.id)}>
            <span className="dr-l">{p.name}</span>
            <small>
              {presetById(p.gameKey).label}
              {p.manager ? ` · ${p.manager}` : ""}
            </small>
            <span className="dr-n num" title="Mods in the list">{p.entries.length}</span>
          </button>
        ))}
      </aside>
      <section className="comp-main">{cur ? <ProfileEditor key={cur.id} p={cur} reload={reload} nav={nav} onDeleted={() => onSelect(null)} onOpenPack={onOpenPack} /> : <div className="empty">Create a profile for a modded game: Skyrim, Oblivion, Morrowind, Warband, Fallout, Minecraft or anything else.</div>}</section>
      {creating && (
        <NewProfileDialog
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const id = await run(() => repo.createModProfile(input), "Profile created.");
            setCreating(false);
            if (id) {
              await reload();
              onSelect(id);
            }
          }}
        />
      )}
    </div>
  );
}

function NewProfileDialog({ onClose, onCreate }: { onClose(): void; onCreate(i: { name: string; gameKey: string; gameId: string | null; gameTitle: string; manager: string; checklist: string[] }): void }) {
  const { games } = useApp();
  const moddable = useMemo(() => moddableGames(games), [games]);
  const [gameId, setGameId] = useState<string>(moddable[0]?.game.id ?? "");
  const [presetId, setPresetId] = useState<string>(moddable[0]?.preset.id ?? "minecraft");
  const [mode, setMode] = useState<"library" | "preset">(moddable.length ? "library" : "preset");
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const preset = presetById(mode === "library" ? moddable.find((m) => m.game.id === gameId)?.preset.id ?? "other" : presetId);
  const [manager, setManager] = useState(preset.managers[0] ?? "");
  const [checklist, setChecklist] = useState(true);
  useEffect(() => setManager(preset.managers[0] ?? ""), [preset.id]);
  const game = mode === "library" ? games.find((g) => g.id === gameId) ?? null : null;
  const gameTitle = game ? game.title : presetId === "other" ? title : preset.label;
  return (
    <Modal
      title="New modding profile"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!gameTitle.trim()} onClick={() => onCreate({ name: name.trim() || `${cleanTitle(gameTitle)} — modded`, gameKey: preset.id, gameId: game?.id ?? null, gameTitle, manager, checklist: checklist ? preset.checklist : [] })}>
            Create
          </button>
        </>
      }
    >
      <div className="seg">
        <button aria-pressed={mode === "library"} disabled={!moddable.length} onClick={() => setMode("library")}>A game in my library</button>
        <button aria-pressed={mode === "preset"} onClick={() => setMode("preset")}>Another game</button>
      </div>
      {mode === "library" ? (
        <label className="psec">
          <span className="psec-h">Game ({moddable.length} in your library with a preset)</span>
          <select className="select" value={gameId} onChange={(e) => setGameId(e.target.value)}>
            {moddable.map((m) => (
              <option key={m.game.id} value={m.game.id}>
                {cleanTitle(m.game.title)} — {m.preset.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="psec">
            <span className="psec-h">Game</span>
            <select className="select" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {GAME_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          {presetId === "other" && (
            <label className="psec">
              <span className="psec-h">Game title</span>
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Stardew Valley" />
            </label>
          )}
        </>
      )}
      <label className="psec">
        <span className="psec-h">Profile name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${cleanTitle(gameTitle || "Game")} — modded`} />
      </label>
      <label className="psec">
        <span className="psec-h">Mod manager / launcher</span>
        <input className="field" list="mgr-list" value={manager} onChange={(e) => setManager(e.target.value)} />
        <datalist id="mgr-list">{preset.managers.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <label className="check">
        <input type="checkbox" checked={checklist} onChange={(e) => setChecklist(e.target.checked)} /> Start with a backup checklist ({preset.checklist.length} general steps you can edit)
      </label>
    </Modal>
  );
}

function ProfileEditor({ p, reload, nav, onDeleted, onOpenPack }: { p: ModProfile; reload(): Promise<void>; nav: Nav; onDeleted(): void; onOpenPack(): void }) {
  const { repo, run, confirm, games, marks, toast } = useApp();
  const preset = presetById(p.gameKey);
  const game = p.gameId ? games.find((g) => g.id === p.gameId) ?? null : null;
  const pack = p.packKey ? marks.get(p.packKey) ?? null : null;
  const save = (patch: Parameters<typeof repo.updateModProfile>[1]) => void run(async () => {
    await repo.updateModProfile(p.id, patch);
    await reload();
  });
  const doExport = async () => {
    const md = exportModList({ ...p, gameTitle: game?.title ?? p.gameTitle });
    const path = await run(() => saveTextFile("Export mod list", `${p.name.replace(/[^\w.-]+/g, "_")}-mods.md`, md, "Markdown", "md"));
    if (path) toast(`Saved ${path}`);
  };
  return (
    <div className="comp-grid">
      <section className="panel" aria-labelledby="h-prof">
        <div className="hd" id="h-prof">
          Profile
          <span className="right">
            <button
              className="btn ghost sm danger"
              onClick={async () => {
                if (await confirm({ title: "Delete this profile?", body: <>“{p.name}” and its mod list, notes, checklist and playthroughs will be removed from REWIND. Your game and mod-manager files aren't touched.</>, ok: "Delete", danger: true })) {
                  await run(() => repo.deleteModProfile(p.id), "Profile deleted.");
                  await reload();
                  onDeleted();
                }
              }}
            >
              Delete
            </button>
          </span>
        </div>
        <div className="bd form2">
          <label className="psec">
            <span className="psec-h">Name</span>
            <CommitInput value={p.name} onCommit={(v) => v.trim() && save({ name: v.trim() })} ariaLabel="Profile name" />
          </label>
          <label className="psec">
            <span className="psec-h">Status</span>
            <select className="select" value={p.status} onChange={(e) => save({ status: e.target.value as ModProfile["status"] })}>
              {PROFILE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <div className="psec">
            <span className="psec-h">Game</span>
            <span>
              {game ? (
                <button className="linkish" onClick={() => nav.openGame(game.id, "library")}>{cleanTitle(game.title)}</button>
              ) : (
                p.gameTitle || preset.label
              )}{" "}
              <span className="dim">({preset.label}{game ? ", in your library" : ""})</span>
            </span>
          </div>
          <label className="psec">
            <span className="psec-h">Mod manager / launcher</span>
            <CommitInput value={p.manager} onCommit={(v) => save({ manager: v })} ariaLabel="Mod manager" placeholder={preset.managers.join(", ")} />
          </label>
          <label className="psec">
            <span className="psec-h">Game version</span>
            <CommitInput value={p.gameVersion} onCommit={(v) => save({ gameVersion: v })} ariaLabel="Game version" placeholder={preset.id === "skyrim_se" ? "e.g. 1.6.1170" : preset.id === "minecraft" ? "e.g. 1.20.1 + NeoForge" : "The version you play"} />
          </label>
          {p.packKey && (
            <div className="psec">
              <span className="psec-h">Based on modpack</span>
              <span>
                {pack ? pack.title : p.packKey}{" "}
                <button className="btn ghost sm" onClick={onOpenPack}>Find in Modpacks</button>
              </span>
            </div>
          )}
          <label className="psec" style={{ gridColumn: "1 / -1" }}>
            <span className="psec-h">Setup notes</span>
            <NotesBox value={p.notes} onSave={(v) => save({ notes: v })} />
          </label>
        </div>
        <div className="bd" style={{ borderTop: "1px solid var(--lo)", display: "grid", gap: "0.4rem" }}>
          <span className="psec-h">Official links <span className="dim">(open in your browser)</span></span>
          <div className="row" style={{ gap: "0.35rem" }}>
            {[...preset.sites, ...preset.managerLinks, ...preset.tools].map((l) => (
              <button key={l.url} className="btn sm" onClick={() => void openExternal(l.url)}>{l.label}</button>
            ))}
          </div>
        </div>
      </section>

      <ModListPanel p={p} reload={reload} onExport={() => void doExport()} />
      <NotesPanel p={p} reload={reload} />
      <ChecklistPanel p={p} reload={reload} />
      <RunsPanel p={p} reload={reload} />
    </div>
  );
}

function NotesBox({ value, onSave }: { value: string; onSave(v: string): void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <textarea className="field" rows={4} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} placeholder="INI tweaks, install order, things to remember…" />;
}

function ModListPanel({ p, reload, onExport }: { p: ModProfile; reload(): Promise<void>; onExport(): void }) {
  const { repo, run, toast } = useApp();
  const [q, setQ] = useState("");
  const [paste, setPaste] = useState<{ text: string; parsed: ParseResult | null; from: string } | null>(null);
  const [adding, setAdding] = useState("");
  const shown = p.entries.filter((e) => !q || (e.name + " " + e.category + " " + e.notes).toLowerCase().includes(q.toLowerCase()));
  const move = (e: ModEntry, d: -1 | 1) => {
    const ids = p.entries.map((x) => x.id);
    const i = ids.indexOf(e.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(async () => {
      await repo.reorderModEntries(p.id, ids);
      await reload();
    });
  };
  const upd = (e: ModEntry, patch: Parameters<typeof repo.updateModEntry>[1]) => void run(async () => {
    await repo.updateModEntry(e.id, patch);
    await reload();
  });
  const enabled = p.entries.filter((e) => e.enabled).length;
  return (
    <section className="panel span2" aria-labelledby="h-mods">
      <div className="hd" id="h-mods">
        Mod list <span className="count">{p.entries.length} ({enabled} on)</span>
        <span className="right">
          <button className="btn sm" onClick={() => setPaste({ text: "", parsed: null, from: "paste" })}>Paste a list…</button>
          <button
            className="btn sm"
            onClick={() =>
              void run(async () => {
                const f = await pickTextFile("Open a mod list (read only)");
                if (f) setPaste({ text: f.text, parsed: parseModList(f.text), from: f.path });
              })
            }
            title="modlist.txt, plugins.txt, loadorder.txt or any text list. The file is only read."
          >
            Open a file…
          </button>
          <button className="btn sm" onClick={onExport} disabled={!p.entries.length}>Export…</button>
          <button
            className="btn sm"
            disabled={!p.entries.length}
            onClick={() =>
              void navigator.clipboard
                .writeText(p.entries.map((e, i) => `${i + 1}. ${e.enabled ? "" : "(off) "}${e.name}${e.version ? ` ${e.version}` : ""}${e.url ? ` — ${e.url}` : ""}`).join("\n"))
                .then(() => toast("Mod list copied."), () => toast("Couldn't copy.", true))
            }
          >
            Copy
          </button>
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: "0.5rem" }}>
        <div className="row">
          <form
            className="row grow"
            onSubmit={(e) => {
              e.preventDefault();
              if (!adding.trim()) return;
              const parsed = parseModList(adding).mods;
              void run(async () => {
                await repo.addModEntries(p.id, parsed.length ? parsed : [{ name: adding.trim() }]);
                setAdding("");
                await reload();
              });
            }}
          >
            <input className="field grow" placeholder="Add a mod: name, or a Nexus / Modrinth / CurseForge link" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add a mod" />
            <button className="btn" type="submit">Add</button>
          </form>
          {p.entries.length > 8 && <input className="field" type="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "12rem" }} aria-label="Filter mods" />}
        </div>
        {p.entries.length === 0 ? (
          <div className="empty">No mods yet. Add them one by one, paste a list, or open your mod manager's list file (REWIND only reads it).</div>
        ) : (
          <div className="ml-wrap">
            <table className="t ml">
              <thead>
                <tr>
                  <th className="n">#</th>
                  <th>On</th>
                  <th>Mod</th>
                  <th>Version</th>
                  <th>Category</th>
                  <th>Link</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className={e.enabled ? "" : "off"}>
                    <td className="n">{p.entries.indexOf(e) + 1}</td>
                    <td>
                      <input type="checkbox" checked={e.enabled} onChange={(x) => upd(e, { enabled: x.target.checked })} aria-label={`${e.name} enabled`} />
                    </td>
                    <td><CommitInput className="field cell" value={e.name} onCommit={(v) => v.trim() && upd(e, { name: v.trim() })} ariaLabel="Mod name" /></td>
                    <td><CommitInput className="field cell" value={e.version} onCommit={(v) => upd(e, { version: v })} ariaLabel="Version" /></td>
                    <td><CommitInput className="field cell" value={e.category} onCommit={(v) => upd(e, { category: v })} ariaLabel="Category" /></td>
                    <td>
                      {e.url ? (
                        <button className="linkish" onClick={() => void openExternal(e.url)} title={isKnownModSite(e.url) ? e.url : `${e.url} — not a mod site REWIND recognises; check it before downloading anything`}>
                          {isKnownModSite(e.url) ? new URL(e.url).host.replace(/^www\./, "") : "⚠ " + new URL(e.url).host}
                        </button>
                      ) : (
                        <CommitInput className="field cell" value="" placeholder="https://…" onCommit={(v) => /^https?:\/\//.test(v.trim()) ? upd(e, { url: v.trim() }) : v.trim() && toast("Links must start with https://", true)} ariaLabel="Link" />
                      )}
                    </td>
                    <td><CommitInput className="field cell" value={e.notes} onCommit={(v) => upd(e, { notes: v })} ariaLabel="Notes" /></td>
                    <td className="nowrap">
                      <button className="btn ghost icon sm" onClick={() => move(e, -1)} aria-label="Move up"><Icon name="up" /></button>
                      <button className="btn ghost icon sm" onClick={() => move(e, 1)} aria-label="Move down"><Icon name="down" /></button>
                      <button className="btn ghost icon sm" onClick={() => void run(async () => (await repo.deleteModEntries([e.id]), await reload()))} aria-label={`Remove ${e.name}`}><Icon name="x" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {paste && (
        <Modal
          title={paste.from === "paste" ? "Paste a mod list" : `Mod list from ${paste.from.split(/[\\/]/).pop()}`}
          wide
          onClose={() => setPaste(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPaste(null)}>Cancel</button>
              <button
                className="btn primary"
                disabled={!paste.parsed?.mods.length}
                onClick={() =>
                  void run(async () => {
                    const n = await repo.addModEntries(p.id, paste.parsed!.mods);
                    setPaste(null);
                    await reload();
                    toast(`Added ${n} mods.`);
                  })
                }
              >
                Add {paste.parsed?.mods.length ?? 0} mods
              </button>
            </>
          }
        >
          {paste.from === "paste" && (
            <textarea
              className="field"
              rows={10}
              placeholder={"One per line. Works with:\n+Enabled mod / -Disabled mod   (Mod Organizer 2 modlist.txt)\n*Plugin.esp                    (plugins.txt)\nName - https://www.nexusmods.com/…   (links)"}
              value={paste.text}
              onChange={(e) => setPaste({ ...paste, text: e.target.value, parsed: e.target.value.trim() ? parseModList(e.target.value) : null })}
            />
          )}
          {paste.parsed && (
            <div className="note info" style={{ fontSize: "var(--fs-s)" }}>
              Read as {paste.parsed.format === "mo2" ? "a Mod Organizer 2 mod list (order as in the file)" : paste.parsed.format === "plugins" ? "a plugin / load-order list" : paste.parsed.format === "links" ? "a list of links" : "one mod per line"}: {paste.parsed.mods.length} mods
              {paste.parsed.skipped ? `, ${paste.parsed.skipped} lines skipped (duplicates, separators, DLC)` : ""}. Nothing on your PC is changed.
            </div>
          )}
          {paste.parsed && (
            <ul className="modlist">
              {paste.parsed.mods.slice(0, 80).map((m, i) => (
                <li key={i}>
                  {m.enabled ? "" : <span className="dim">(off) </span>}
                  {m.name}
                  {m.version && <span className="dim"> {m.version}</span>}
                  {m.url && <span className="dim"> — {m.url}</span>}
                </li>
              ))}
              {paste.parsed.mods.length > 80 && <li className="dim">…and {paste.parsed.mods.length - 80} more</li>}
            </ul>
          )}
        </Modal>
      )}
    </section>
  );
}

function NotesPanel({ p, reload }: { p: ModProfile; reload(): Promise<void> }) {
  const { repo, run } = useApp();
  const [edit, setEdit] = useState<Partial<ModNote> | null>(null);
  return (
    <section className="panel" aria-labelledby="h-notes">
      <div className="hd" id="h-notes">
        Compatibility & setup notes <span className="count">{p.modNotes.length}</span>
        <span className="right">
          <button className="btn sm" onClick={() => setEdit({ kind: "compat", mods: [] })}><Icon name="plus" /> Note</button>
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: "0.5rem" }}>
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>Your own notes. REWIND doesn't check compatibility; add a link to where you read something so you can find it again.</div>
        {p.modNotes.length === 0 && <div className="empty">No notes yet.</div>}
        {p.modNotes.map((n) => (
          <div key={n.id} className={"mnote" + (n.status === "resolved" ? " done" : "")}>
            <div className="row" style={{ gap: "0.4rem" }}>
              <span className="chip">{NOTE_KINDS.find((k) => k.id === n.kind)?.label}</span>
              <b className="grow">{n.title || "(untitled)"}</b>
              {n.status === "resolved" && <span className="chip own">resolved</span>}
              <button className="btn ghost sm" onClick={() => setEdit(n)}>Edit</button>
            </div>
            {n.body && <p>{n.body}</p>}
            {n.mods.length > 0 && <div className="chips">{n.mods.map((m) => <span key={m} className="chip">{m}</span>)}</div>}
            {n.sourceUrl && (
              <button className="linkish" style={{ fontSize: "var(--fs-s)" }} onClick={() => void openExternal(n.sourceUrl)}>
                Source: {n.sourceUrl}
              </button>
            )}
          </div>
        ))}
      </div>
      {edit && (
        <Modal
          title={edit.id ? "Edit note" : "New note"}
          onClose={() => setEdit(null)}
          footer={
            <>
              {edit.id && (
                <button className="btn danger" onClick={() => void run(async () => (await repo.deleteModNote(edit.id!), setEdit(null), await reload()))}>Delete</button>
              )}
              <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button
                className="btn primary"
                onClick={() =>
                  void run(async () => {
                    if (edit.sourceUrl && !/^https?:\/\//.test(edit.sourceUrl)) throw new Error("The source link must start with https://");
                    await repo.saveModNote({ ...edit, profileId: p.id });
                    setEdit(null);
                    await reload();
                  })
                }
              >
                Save
              </button>
            </>
          }
        >
          <div className="seg">
            {NOTE_KINDS.map((k) => (
              <button key={k.id} aria-pressed={edit.kind === k.id} onClick={() => setEdit({ ...edit, kind: k.id as NoteKind })}>{k.label}</button>
            ))}
          </div>
          <input className="field" placeholder="Title, e.g. “Frostfall needs Campfire”" value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <textarea className="field" rows={5} placeholder="What you found and what fixed it" value={edit.body ?? ""} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <input className="field" list="note-mods" placeholder="Mods it's about (comma-separated)" value={(edit.mods ?? []).join(", ")} onChange={(e) => setEdit({ ...edit, mods: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          <datalist id="note-mods">{p.entries.map((m) => <option key={m.id} value={m.name} />)}</datalist>
          <input className="field" placeholder="Source link (optional): https://…" value={edit.sourceUrl ?? ""} onChange={(e) => setEdit({ ...edit, sourceUrl: e.target.value })} />
          <label className="check">
            <input type="checkbox" checked={edit.status === "resolved"} onChange={(e) => setEdit({ ...edit, status: e.target.checked ? "resolved" : "open" })} /> Resolved
          </label>
        </Modal>
      )}
    </section>
  );
}

function ChecklistPanel({ p, reload }: { p: ModProfile; reload(): Promise<void> }) {
  const { repo, run } = useApp();
  const [text, setText] = useState("");
  const done = p.checklist.filter((c) => c.doneAt).length;
  return (
    <section className="panel" aria-labelledby="h-check">
      <div className="hd" id="h-check">
        Backup checklist <span className="count">{done}/{p.checklist.length}</span>
        <span className="right">
          <button className="btn ghost sm" disabled={!done} onClick={() => void run(async () => (await repo.resetChecklist(p.id), await reload()))} title="Untick everything, ready for your next change">
            Reset
          </button>
          {p.checklist.length === 0 && (
            <button className="btn sm" onClick={() => void run(async () => (await repo.addCheckItems(p.id, presetById(p.gameKey).checklist), await reload()))}>
              Add the usual steps
            </button>
          )}
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: "0.3rem" }}>
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>General, safe steps to do yourself before changing your setup. Tick them off as you go.</div>
        {p.checklist.map((c) => (
          <div key={c.id} className="ckrow">
            <label className="check grow">
              <input type="checkbox" checked={!!c.doneAt} onChange={(e) => void run(async () => (await repo.setCheckDone(c.id, e.target.checked), await reload()))} />
              <span className={c.doneAt ? "dim" : ""}>{c.text}</span>
            </label>
            {c.doneAt && <span className="dim mono" style={{ fontSize: "var(--fs-xs)" }}>{fmtDate(c.doneAt)}</span>}
            <button className="btn ghost icon sm" onClick={() => void run(async () => (await repo.deleteCheckItem(c.id), await reload()))} aria-label="Remove step"><Icon name="x" /></button>
          </div>
        ))}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void run(async () => {
              await repo.addCheckItems(p.id, [text]);
              setText("");
              await reload();
            });
          }}
        >
          <input className="field grow" placeholder="Add a step…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Add a checklist step" />
          <button className="btn" type="submit">Add</button>
        </form>
      </div>
    </section>
  );
}

function RunsPanel({ p, reload }: { p: ModProfile; reload(): Promise<void> }) {
  const { repo, run } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="panel" aria-labelledby="h-runs">
      <div className="hd" id="h-runs">
        Modded playthroughs <span className="count">{p.runs.length}</span>
        <span className="right">
          <button className="btn sm" onClick={() => void run(async () => (await repo.saveModRun({ profileId: p.id, name: "New playthrough", startedAt: today }), await reload()))}>
            <Icon name="plus" /> Playthrough
          </button>
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: "0.5rem" }}>
        {p.runs.length === 0 && <div className="empty">Track characters or worlds you play with this setup.</div>}
        {p.runs.map((r) => {
          const set = (patch: Partial<typeof r>) => void run(async () => (await repo.saveModRun({ ...r, ...patch }), await reload()));
          return (
            <div key={r.id} className="runrow">
              <CommitInput value={r.name} onCommit={(v) => set({ name: v })} ariaLabel="Playthrough name" />
              <select className="select" value={r.status} onChange={(e) => set({ status: e.target.value as RunStatus, endedAt: e.target.value === "finished" || e.target.value === "abandoned" ? r.endedAt ?? today : r.endedAt })}>
                {RUN_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <CommitInput type="date" value={r.startedAt ?? ""} onCommit={(v) => set({ startedAt: v || null })} ariaLabel="Started" />
              <CommitInput type="date" value={r.endedAt ?? ""} onCommit={(v) => set({ endedAt: v || null })} ariaLabel="Ended" />
              <button className="btn ghost icon sm" onClick={() => void run(async () => (await repo.deleteModRun(r.id), await reload()))} aria-label="Remove playthrough"><Icon name="x" /></button>
              <CommitInput className="field runnote" value={r.notes} onCommit={(v) => set({ notes: v })} ariaLabel="Notes" placeholder="Build, goals, where you left off…" />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Profiles for one library game (shown on the game's page). */
export function profilesForGame(profiles: ModProfile[], gameId: string): ModProfile[] {
  return profiles.filter((p) => p.gameId === gameId);
}

export { presetForGame };
