// Library check-up: what's missing, duplicates, and store links that look wrong.
// Everything is a suggestion. Looking up details only adds store data next to yours;
// combining and re-matching happen only when you click.

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Thumb } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { auditLibrary, GAP_LABEL, type Gap } from "../lib/audit.ts";
import { LAUNCHER_LABEL, STATUSES, type Game } from "../lib/types.ts";
import { DEFAULT_SYNC, summary } from "../meta/sync.ts";
import { PROVIDER_LABEL } from "../meta/types.ts";
import { cancelSync, igdbCreds, PHASE_LABEL, startSync, useSyncState } from "../state/metaSync.ts";
import { MatchPicker } from "./MatchPicker.tsx";

type Tab = "missing" | "duplicates" | "links" | "review";

export function CheckUpDialog({ nav, onClose, onCombine }: { nav: Nav; onClose(): void; onCombine(a: Game, b: Game): Promise<void> }) {
  const { games, repo, settings, reloadAll, toast, run } = useApp();
  const sync = useSyncState();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("missing");
  const [useIgdb, setUseIgdb] = useState(true);
  const [hasIgdb, setHasIgdb] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    void repo.getSetting<string[]>("checkup_dismissed", []).then((d) => setDismissed(new Set(d)));
    void igdbCreds(repo).then((c) => setHasIgdb(!!c));
  }, [repo]);
  const audit = useMemo(() => auditLibrary(games, dismissed, settings.useUnverifiedLengths), [games, dismissed, settings.useUnverifiedLengths]);
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const lookup = audit.lookupIds.map((id) => byId.get(id)!).filter(Boolean);

  const dismiss = async (key: string) => {
    const next = new Set([...dismissed, key]);
    setDismissed(next);
    await run(() => repo.setSetting("checkup_dismissed", [...next]));
  };

  const runLookup = async () => {
    const creds = useIgdb ? await igdbCreds(repo) : null;
    const r = await startSync(repo, { ...DEFAULT_SYNC, gameIds: audit.lookupIds, searchSteam: true, refreshDays: 30, igdb: creds }, reloadAll);
    if (r) {
      setLastRun({ text: r.message, ok: r.outcome === "complete" });
      toast(r.outcome === "complete" ? `Check-up: ${r.message}` : r.message, r.outcome === "error");
    }
  };

  const p = sync.progress;
  const minutes = Math.max(1, Math.ceil((lookup.filter((g) => !g.meta.steam).length * 1.7) / 60));
  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "missing", label: "Missing details", n: lookup.length },
    { id: "duplicates", label: "Duplicates", n: audit.duplicates.length },
    { id: "links", label: "Store links to check", n: audit.mismatches.length },
    { id: "review", label: "Needs a match", n: audit.review.length },
  ];

  return (
    <Modal title="Library check-up" xl onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="row">
        {(Object.keys(GAP_LABEL) as Gap[]).map((k) => (
          <span key={k} className="chip">
            {GAP_LABEL[k]} <span className="num">{audit.gapCounts[k]}</span>
          </span>
        ))}
        <span className="meta">of {games.length} games</span>
      </div>
      <div className="seg" role="tablist" aria-label="Check-up sections">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label} <span className="n">{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "missing" && (
        <div className="stack">
          {sync.running ? (
            <div className="card pad stack tight" role="status">
              <div className="row">
                <b>{p ? PHASE_LABEL[p.phase] : "Starting…"}</b>
                <span className="spacer" />
                <span className="meta num">{p && p.total ? `${p.done} of ${p.total}` : ""}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${p && p.total ? Math.round((p.done / p.total) * 100) : 2}%` }} />
              </div>
              <span className="meta ellipsis">{p?.current || " "}</span>
              {p && <span className="meta">{summary(p.counts)}</span>}
              <div className="row">
                <button className="btn" onClick={cancelSync}>
                  <Icon name="stop" /> Stop
                </button>
                <span className="meta">Stopping keeps everything found so far. Run the check-up again to carry on where it stopped.</span>
              </div>
            </div>
          ) : lookup.length === 0 ? (
            <div className="empty">
              <b>Nothing left to look up</b>
              <span className="hint">
                Games still missing something either aren't on Steam{hasIgdb ? " or IGDB" : ""}, or you said they aren't. You can fill in details yourself on each game.
              </span>
            </div>
          ) : (
            <>
              <div className="card pad stack tight">
                <b>
                  {lookup.length} game{lookup.length === 1 ? "" : "s"} can get store details and artwork
                </b>
                <span className="dim">
                  REWIND searches Steam{hasIgdb && useIgdb ? " and IGDB" : ""} for each one. Exact title matches are linked; anything uncertain (other editions, similar
                  names) waits under “Needs a match” for you to choose. Store data is kept next to your own — your titles, statuses, notes, ratings, tags and lengths
                  are never changed.
                </span>
                <span className="meta">
                  Steam allows about one search every 1.6 seconds, so this takes roughly {minutes} minute{minutes === 1 ? "" : "s"}. Results are saved as they arrive and
                  work offline afterwards.
                </span>
                <div className="row">
                  <button className="btn primary" onClick={() => void runLookup()}>
                    <Icon name="download" /> Look up {lookup.length} game{lookup.length === 1 ? "" : "s"}
                  </button>
                  <label className="check" title={hasIgdb ? "" : "Connect IGDB in Settings → Connections"}>
                    <input type="checkbox" disabled={!hasIgdb} checked={hasIgdb && useIgdb} onChange={(e) => setUseIgdb(e.target.checked)} />
                    Also use IGDB{hasIgdb ? "" : " (not connected)"}
                  </label>
                </div>
              </div>
              {lastRun && <div className={"note " + (lastRun.ok ? "ok" : "bad")}>Last lookup: {lastRun.text}</div>}
            </>
          )}
          {lookup.length > 0 && (
            <div className="rows boxed">
              {(showAll ? lookup : lookup.slice(0, 40)).map((g) => (
                <div className="r-item" key={g.id}>
                  <Thumb file={g.coverPath} />
                  <div className="r-main">
                    <button
                      className="linkish r-title"
                      onClick={() => {
                        onClose();
                        nav.openGame(g.id, "library");
                      }}
                    >
                      {cleanTitle(g.title)}
                    </button>
                    <span className="r-sub">
                      Missing: {(audit.gaps.get(g.id) ?? []).map((x) => GAP_LABEL[x].replace(/^No /, "").toLowerCase()).join(", ")}
                      {g.meta.steam?.status === "error" ? " · last lookup failed" : ""}
                    </span>
                  </div>
                  <span />
                </div>
              ))}
              {lookup.length > 40 && !showAll && (
                <div className="r-item no-lead">
                  <span className="meta">and {lookup.length - 40} more</span>
                  <button className="btn sm ghost" onClick={() => setShowAll(true)}>
                    Show all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "duplicates" &&
        (audit.duplicates.length === 0 ? (
          <div className="empty">
            <b>No duplicates found</b>
            <span className="hint">Entries with the same title, or linked to the same Steam app, show up here.</span>
          </div>
        ) : (
          <div className="rows boxed">
            {audit.duplicates.map((d) => (
              <div className="r-item no-lead" key={d.key}>
                <div className="r-main">
                  <span className="r-title" style={{ whiteSpace: "normal" }}>
                    {cleanTitle(d.a.title)} <span className="muted">and</span> {cleanTitle(d.b.title)}
                  </span>
                  <span className="r-sub">
                    {d.kind === "same"
                      ? "Same title — probably one game entered twice"
                      : "Same game, different edition wording — often really two editions you own separately"}
                    {" · "}
                    {[d.a, d.b].map((g) => `${STATUSES.find((s) => s.id === g.status)?.label}${g.rating ? ` ${"★".repeat(g.rating)}` : ""}${g.sources.length ? ` on ${g.sources.map((s) => LAUNCHER_LABEL[s.source]).join(", ")}` : ""}`).join(" / ")}
                  </span>
                </div>
                <div className="r-acts">
                  <button className="btn sm" onClick={() => void onCombine(d.a, d.b)}>
                    Combine…
                  </button>
                  <button className="btn sm ghost" onClick={() => void dismiss("dup:" + d.key)}>
                    Keep separate
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === "links" &&
        (audit.mismatches.length === 0 ? (
          <div className="empty">
            <b>No suspicious store links</b>
            <span className="hint">When a game is linked to a store page with a very different name (a soundtrack, a different edition), it's listed here.</span>
          </div>
        ) : (
          <div className="rows boxed">
            {audit.mismatches.map((m) => (
              <div key={m.key} style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="r-item no-lead" style={{ borderBottom: 0 }}>
                  <div className="r-main">
                    <span className="r-title">{cleanTitle(m.game.title)}</span>
                    <span className="r-sub">
                      Linked on {PROVIDER_LABEL[m.provider]} as “{cleanTitle(m.listedAs)}”
                    </span>
                  </div>
                  <div className="r-acts">
                    <button className="btn sm" onClick={() => setPicking(picking === m.key ? null : m.key)} aria-expanded={picking === m.key}>
                      Change match…
                    </button>
                    <button className="btn sm ghost" onClick={() => void dismiss(m.key)}>
                      It's right
                    </button>
                  </div>
                </div>
                {picking === m.key && (
                  <div style={{ padding: "0 var(--s3) var(--s3)" }}>
                    <MatchPicker game={m.game} provider={m.provider} compact onDone={() => setPicking(null)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

      {tab === "review" &&
        (audit.review.length === 0 ? (
          <div className="empty">
            <b>Nothing waiting</b>
            <span className="hint">When a title could match more than one store page — different editions, remasters — it waits here instead of being guessed.</span>
          </div>
        ) : (
          <div className="stack">
            {audit.review.slice(0, 30).map((g) => (
              <div key={g.id} className="card pad stack tight">
                <b>{cleanTitle(g.title)}</b>
                {(["steam", "igdb"] as const)
                  .filter((p) => g.meta[p]?.status === "review")
                  .map((p) => (
                    <div key={p} className="stack tight">
                      <span className="meta">Which {PROVIDER_LABEL[p]} page is it?</span>
                      <MatchPicker game={g} provider={p} compact />
                    </div>
                  ))}
              </div>
            ))}
            {audit.review.length > 30 && <span className="meta">Showing 30 of {audit.review.length}. Decide these and the rest appear.</span>}
          </div>
        ))}
    </Modal>
  );
}
