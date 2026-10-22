import { useEffect, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { STATUSES } from "../lib/types.ts";
import {
  applyArtifactPlan,
  buildArtifactPlan,
  parseArtifactBackup,
  setPlanAction,
  type ArtifactPlan,
} from "../migrate/artifactImport.ts";
import {
  applyRestore,
  backupFileName,
  createBackup,
  detectBackupKind,
  previewRestore,
  validateBackup,
  type RestorePreview,
  type RewindBackup,
} from "../backup/backup.ts";
import { writeSafetySnapshot } from "../platform/native.ts";

export interface ImportRequest {
  path: string;
  text: string;
}

type Stage =
  | { k: "error"; msg: string; details?: string[] }
  | { k: "artifact"; plan: ArtifactPlan }
  | { k: "rewind2"; backup: RewindBackup; preview: RestorePreview; warnings: string[]; mode: "merge" | "replace" }
  | { k: "working"; msg: string }
  | { k: "done"; lines: string[]; snapshot: string | null };

const statusLabel = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s;

/** Validate -> preview -> confirm -> safety snapshot -> one-transaction apply. */
export function ImportFlow({ req, onClose, nav }: { req: ImportRequest; onClose(): void; nav: Nav }) {
  const { repo, info, reloadAll, finishFirstRun, confirm } = useApp();
  const [stage, setStage] = useState<Stage>({ k: "working", msg: "Reading file…" });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      let obj: unknown;
      try {
        obj = JSON.parse(req.text);
      } catch {
        setStage({ k: "error", msg: "That file isn't valid JSON, so it can't be a REWIND backup." });
        return;
      }
      const kind = detectBackupKind(obj);
      try {
        if (kind === "artifact") {
          const backup = parseArtifactBackup(obj);
          const existing = new Map((await repo.loadGames()).map((g) => [g.canon, g.id]));
          setStage({ k: "artifact", plan: buildArtifactPlan(backup, existing) });
        } else if (kind === "rewind2") {
          const v = validateBackup(obj);
          if (!v.ok) {
            setStage({ k: "error", msg: "This backup failed validation, so nothing was imported.", details: v.errors });
            return;
          }
          setStage({ k: "rewind2", backup: v.backup, preview: await previewRestore(repo, v.backup), warnings: v.warnings, mode: "merge" });
        } else {
          setStage({ k: "error", msg: "This JSON isn't a REWIND backup (neither the old artifact format nor REWIND 2)." });
        }
      } catch (e) {
        setStage({ k: "error", msg: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [req, repo]);

  /** Saves the current library before anything is written. */
  const snapshot = async (): Promise<string | null> => {
    if ((await repo.countGames()) === 0) return null;
    const b = await createBackup(repo, info?.version ?? "?");
    return writeSafetySnapshot(backupFileName("before-import"), JSON.stringify(b));
  };

  const doArtifact = async (plan: ArtifactPlan) => {
    setStage({ k: "working", msg: "Saving a safety snapshot…" });
    try {
      const snap = await snapshot();
      setStage({ k: "working", msg: `Importing ${plan.counts.add + plan.counts.merge} games…` });
      const r = await applyArtifactPlan(repo, plan);
      await reloadAll();
      await finishFirstRun();
      setStage({
        k: "done",
        snapshot: snap,
        lines: [
          `${r.added} games added${r.merged ? `, ${r.merged} merged into existing entries` : ""}.`,
          r.skipped ? `${r.skipped} row(s) skipped as you chose.` : "Nothing skipped.",
          r.upNextCollectionId ? `Your old pick slots became the "Up Next" collection.` : "",
        ].filter(Boolean),
      });
    } catch (e) {
      setStage({ k: "error", msg: `Import failed and was rolled back; your library is unchanged. ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const doRestore = async (backup: RewindBackup, mode: "merge" | "replace", preview: RestorePreview) => {
    if (mode === "replace") {
      const ok = await confirm({
        title: "Replace your library?",
        danger: true,
        ok: "Replace everything",
        body: (
          <>
            <p style={{ marginTop: 0 }}>
              Your current library ({preview.currentGames} games, with notes, collections and history) will be <b>deleted</b> and replaced by
              the backup from {preview.exportedAt.slice(0, 10)} ({preview.counts.games} games).
            </p>
            <p style={{ marginBottom: 0 }} className="dim">A safety snapshot of the current library is saved first, so this can be undone by restoring it.</p>
          </>
        ),
      });
      if (!ok) return;
    }
    setStage({ k: "working", msg: "Saving a safety snapshot…" });
    try {
      const snap = await snapshot();
      setStage({ k: "working", msg: "Restoring…" });
      const r = await applyRestore(repo, backup, mode);
      await reloadAll();
      await finishFirstRun();
      setStage({
        k: "done",
        snapshot: snap,
        lines:
          mode === "replace"
            ? [`Library replaced with ${r.gamesAdded} games from the backup.`]
            : [`${r.gamesAdded} new games added; ${r.gamesMatched} already in your library were left as they are (only empty fields filled).`],
      });
    } catch (e) {
      setStage({ k: "error", msg: `Restore failed and was rolled back; your library is unchanged. ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const file = req.path.split(/[\\/]/).pop();
  const close = () => {
    if (stage.k === "done") nav.go("library");
    onClose();
  };

  if (stage.k === "working") {
    return (
      <Modal title="Import" onClose={() => undefined}>
        <span className="led ok"><i /> {stage.msg}</span>
      </Modal>
    );
  }
  if (stage.k === "error") {
    return (
      <Modal title="Import" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
        <div className="note bad">{stage.msg}</div>
        {stage.details && (
          <ul className="mono" style={{ margin: 0, fontSize: "var(--fs-meta)" }}>
            {stage.details.slice(0, 15).map((d) => <li key={d}>{d}</li>)}
          </ul>
        )}
      </Modal>
    );
  }
  if (stage.k === "done") {
    return (
      <Modal title="Import complete" onClose={close} footer={<button className="btn primary" onClick={close}>Open library</button>}>
        <div className="note ok">{stage.lines.map((l) => <div key={l}>{l}</div>)}</div>
        {stage.snapshot && (
          <div className="dim" style={{ fontSize: "var(--fs-meta)" }}>
            Your library from before the import was saved to <span className="mono">{stage.snapshot}</span>
          </div>
        )}
      </Modal>
    );
  }

  if (stage.k === "rewind2") {
    const p = stage.preview;
    return (
      <Modal
        wide
        title={`Restore backup — ${file}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className={"btn primary" + (stage.mode === "replace" ? " danger" : "")} onClick={() => doRestore(stage.backup, stage.mode, p)}>
              {stage.mode === "merge" ? `Merge ${p.newGames} new games` : "Replace library…"}
            </button>
          </>
        }
      >
        <div className="note info">
          Backup from <b>{p.exportedAt.slice(0, 16).replace("T", " ")}</b> (REWIND {p.appVersion}). Nothing has been changed yet.
        </div>
        <table className="t">
          <tbody>
            {Object.entries(p.counts).map(([k, n]) => (
              <tr key={k}><td>{k.replace(/_/g, " ")}</td><td className="n">{n}</td></tr>
            ))}
          </tbody>
        </table>
        <div>
          <b>{p.matchingGames}</b> of the backup's games are already in your library{p.matchingGames ? " (matched by ID, Steam App ID or title)" : ""}; <b>{p.newGames}</b> are new.
          {p.matchingSamples.length > 0 && (
            <div className="dim mono" style={{ fontSize: "var(--fs-meta)", marginTop: 4 }}>
              e.g. {p.matchingSamples.slice(0, 4).map((s) => `${cleanTitle(s.incoming)} (${s.by})`).join(", ")}
            </div>
          )}
        </div>
        {stage.warnings.length > 0 && <div className="note">{stage.warnings.map((w) => <div key={w}>{w}</div>)}</div>}
        <div style={{ display: "grid", gap: 6 }}>
          <label className="check">
            <input type="radio" name="mode" checked={stage.mode === "merge"} onChange={() => setStage({ ...stage, mode: "merge" })} />
            <span><b>Merge</b> (safe): add what's missing. Nothing you already have is overwritten.</span>
          </label>
          <label className="check">
            <input type="radio" name="mode" checked={stage.mode === "replace"} onChange={() => setStage({ ...stage, mode: "replace" })} />
            <span><b>Replace</b>: delete the current library ({p.currentGames} games) and load the backup exactly.</span>
          </label>
        </div>
      </Modal>
    );
  }

  // Old artifact import
  const plan = stage.plan;
  const skipped = plan.games.filter((g) => g.action === "skip");
  const shown = showAll ? plan.games : plan.games.slice(0, 12);
  return (
    <Modal
      wide
      title={`Import from REWIND artifact — ${file}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => doArtifact(plan)} disabled={plan.counts.add + plan.counts.merge === 0}>
            Import {plan.counts.add + plan.counts.merge} games
          </button>
        </>
      }
    >
      <div className="note info">Preview only. Nothing is written until you press Import, and the whole import succeeds or fails as one step.</div>
      <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <table className="t">
          <tbody>
            <tr><td>Games in file</td><td className="n">{plan.counts.inFile}</td></tr>
            <tr><td>Will be added</td><td className="n ok">{plan.counts.add}</td></tr>
            <tr><td>Already here (merge, fill blanks only)</td><td className="n">{plan.counts.merge}</td></tr>
            <tr><td>Skipped</td><td className="n warn">{plan.counts.skip}</td></tr>
            <tr><td>With imported playtime</td><td className="n">{plan.counts.withPlaytime}</td></tr>
            <tr><td>Matched old length/tag table</td><td className="n">{plan.counts.legacyMatches}</td></tr>
            <tr><td>Notes / ratings / hidden</td><td className="n">{plan.counts.withNotes} / {plan.counts.withRating} / {plan.counts.hidden}</td></tr>
          </tbody>
        </table>
        <table className="t">
          <thead><tr><th>Old status</th><th>Becomes</th><th className="n">Games</th></tr></thead>
          <tbody>
            {plan.statusMap.map((m) => (
              <tr key={m.from}><td>{m.from}</td><td>{statusLabel(m.to)}</td><td className="n">{m.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.upNext.length > 0 && (
        <div>
          <b>Up Next</b> <span className="dim">(from your old pick slots, in order):</span>{" "}
          {plan.upNext.map((k) => cleanTitle(plan.games.find((g) => g.key === k)!.title)).join("  →  ")}
        </div>
      )}
      {skipped.length > 0 && (
        <div className="note">
          <b>Skipped rows</b> — tick any that really are games:
          {skipped.map((g) => (
            <label key={g.key} className="check" style={{ display: "flex", marginTop: 4 }}>
              <input type="checkbox" checked={false} onChange={() => setStage({ k: "artifact", plan: setPlanAction(plan, g.key, true) })} />
              <span>
                "{g.title}" <span className="dim">— {g.reason}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="dim" style={{ fontSize: "var(--fs-meta)" }}>
        Lengths and tags from the old app's built-in table are imported marked <span className="badge est">est.</span> (unverified). Your own values always win.
        The old penalty and award systems are not carried over.
      </div>
      <details>
        <summary className="dim" style={{ cursor: "pointer", fontSize: "var(--fs-meta)" }}>Show games ({plan.games.length})</summary>
        <table className="t" style={{ marginTop: 6 }}>
          <thead><tr><th>Title</th><th>Status</th><th className="n">Played</th><th>Action</th></tr></thead>
          <tbody>
            {shown.map((g) => (
              <tr key={g.key}>
                <td>{cleanTitle(g.title)}</td>
                <td>{statusLabel(g.status)}</td>
                <td className="n">{g.playtimeMin != null ? `${(g.playtimeMin / 60).toFixed(1)}h` : "—"}</td>
                <td className={g.action === "skip" ? "warn" : g.action === "merge" ? "info" : "ok"}>{g.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!showAll && plan.games.length > 12 && (
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setShowAll(true)}>Show all {plan.games.length}</button>
        )}
      </details>
    </Modal>
  );
}
