import { useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { useTaste } from "../state/recs.ts";
import { cleanTitle } from "../lib/canon.ts";
import { playtimeHours, REASONS } from "../rec/taste.ts";
import { TRAIT_LABEL, type Trait } from "../rec/traits.ts";

const ENJOY_BUTTONS: { label: string; rating: number }[] = [
  { label: "Loved it", rating: 5 },
  { label: "Liked it", rating: 4 },
  { label: "Mixed", rating: 3 },
  { label: "Didn't enjoy", rating: 2 },
];

export function TasteView({ nav }: { nav: Nav }) {
  const { games, updateGame, addRecEvent, recEvents, confirm } = useApp();
  const { taste } = useTaste();
  const [onlyUnknown, setOnlyUnknown] = useState(true);

  // Time played vs enjoyment: solo games with the most hours.
  const played = useMemo(
    () =>
      games
        .filter((g) => playtimeHours(g) >= 3 && g.multiplayer !== "mp_required" && g.multiplayer !== "coop_focused" && !g.tags.some((t) => t.tag === "tool"))
        .sort((a, b) => playtimeHours(b) - playtimeHours(a)),
    [games],
  );
  const rows = played.filter((g) => !onlyUnknown || !taste.evidence.get(g.id) || taste.evidence.get(g.id)!.playtimeOnly).slice(0, 25);
  const maxH = Math.max(1, ...played.map(playtimeHours));

  const tags = [...taste.tagAff.entries()].filter(([, a]) => Math.abs(a.aff) >= 0.08);
  const likes = tags.filter(([, a]) => a.aff > 0).sort((a, b) => b[1].aff - a[1].aff).slice(0, 10);
  const dislikes = tags.filter(([, a]) => a.aff < 0).sort((a, b) => a[1].aff - b[1].aff).slice(0, 8);
  const traits = (Object.entries(taste.traitPref) as [Trait, { value: number; parts: { label: string; value: number; source: string; fades?: string }[] }][])
    .filter(([, p]) => Math.abs(p.value) >= 0.08)
    .sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value));

  const drops = recEvents.filter((e) => e.kind === "drop" && e.reason);
  const dropCounts = new Map<string, number>();
  for (const d of drops) dropCounts.set(d.reason!, (dropCounts.get(d.reason!) ?? 0) + 1);
  const passes = recEvents.filter((e) => e.kind === "pass");
  const accepts = recEvents.filter((e) => e.kind === "accept");

  return (
    <div className="content pad">
      <div className="stack" style={{ maxWidth: "80rem" }}>
        <div className="note info">
          This is everything REWIND uses to judge your taste. Enjoyment comes from what you tell it (ratings, favorites, your profile lists,
          finishing or dropping games, and passing on suggestions). Hours played are shown, but they are <b>not</b> treated as enjoyment.
        </div>

        <div className="panel">
          <div className="hd">
            Time played vs. enjoyment
            <span className="right">
              <label className="check" style={{ textTransform: "none", letterSpacing: 0 }}>
                <input type="checkbox" checked={onlyUnknown} onChange={(e) => setOnlyUnknown(e.target.checked)} />
                only games with no enjoyment info
              </label>
            </span>
          </div>
          <div className="bd flush">
            {rows.length === 0 ? (
              <div style={{ padding: "0.8rem" }} className="dim">
                Every solo game with 3+ hours has enjoyment info. Untick the box to see them all.
              </div>
            ) : (
              <table className="t tvst">
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Time played</th>
                    <th>What REWIND knows</th>
                    <th>Did you enjoy it?</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => {
                    const ev = taste.evidence.get(g.id);
                    const h = playtimeHours(g);
                    const known = ev && !ev.playtimeOnly;
                    return (
                      <tr key={g.id}>
                        <td>
                          <a href="#" onClick={(e) => { e.preventDefault(); nav.openGame(g.id, "library"); }}>{cleanTitle(g.title)}</a>
                        </td>
                        <td className="tbar">
                          <span className="track"><span className="fill" style={{ width: `${(h / maxH) * 100}%` }} /></span>
                          <span className="num">{Math.round(h)}h</span>
                        </td>
                        <td className={known ? (ev!.value >= 0.2 ? "ok" : ev!.value <= -0.2 ? "bad" : "") : "dim"} style={{ fontSize: "var(--fs-s)" }}>
                          {known ? ev!.parts.filter((p) => p.kind !== "playtime").map((p) => p.label).join("; ") : "Only time spent: enjoyment unknown"}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 3, flexWrap: "nowrap" }}>
                            {ENJOY_BUTTONS.map((b) => (
                              <button key={b.rating} className="btn sm" aria-pressed={g.rating === b.rating} onClick={() => void updateGame(g.id, { rating: g.rating === b.rating ? null : b.rating })}>
                                {b.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="grid2">
          <div className="panel">
            <div className="hd">Leans towards</div>
            <div className="bd">
              <AffBars items={likes.map(([t, a]) => ({ label: t, v: a.aff }))} />
            </div>
          </div>
          <div className="panel">
            <div className="hd">Leans away from</div>
            <div className="bd">
              <AffBars items={dislikes.map(([t, a]) => ({ label: t, v: a.aff }))} />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="hd">
            What REWIND has learned about traits
            <span className="right">
              <button
                className="btn sm"
                disabled={!taste.learned.length}
                onClick={async () => {
                  if (await confirm({ title: "Reset learning", body: "Forget what REWIND inferred from your recent passes and drop reasons? Ratings, profile and history stay.", ok: "Reset" })) {
                    await addRecEvent("reset_learning", null);
                  }
                }}
              >
                Reset recent learning
              </button>
            </span>
          </div>
          <div className="bd">
            <table className="t">
              <thead>
                <tr>
                  <th>Trait</th>
                  <th>Preference</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {traits.map(([t, p]) => (
                  <tr key={t}>
                    <td>{TRAIT_LABEL[t]}</td>
                    <td style={{ width: "11rem" }}>
                      <span className="pref">
                        <span className="pref-mid" />
                        <span className={"pref-fill " + (p.value >= 0 ? "pos" : "neg")} style={p.value >= 0 ? { left: "50%", width: `${p.value * 50}%` } : { right: "50%", width: `${-p.value * 50}%` }} />
                      </span>
                    </td>
                    <td style={{ fontSize: "var(--fs-s)" }}>
                      {p.parts.map((x, i) => (
                        <span key={i} className={"why-part s-" + x.source.replace(/ /g, "-")}>
                          {x.source}: {x.label}
                          {x.fades ? ` (fades by ${x.fades})` : ""}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid2">
          <div className="panel">
            <div className="hd">Your profile, as REWIND reads it</div>
            <div className="bd" style={{ display: "grid", gap: "0.6rem", fontSize: "var(--fs-s)" }}>
              <div>
                {taste.profileMatches.map((m) => (
                  <div key={m.list + m.entry} className="pm">
                    <span className={m.list === "enjoyed" ? "ok" : "warn"}>{m.list === "enjoyed" ? "enjoyed" : "struggled"}</span>
                    <span>{m.entry}</span>
                    <span className="dim">→ {m.title ?? "not in your library (used as a general preference only)"}</span>
                  </div>
                ))}
              </div>
              <div>
                {taste.profileRules.map((r) => (
                  <div key={r.list + r.entry} className="pm">
                    <span className={r.list === "values" ? "ok" : "warn"}>{r.list === "values" ? "value" : "dislike"}</span>
                    <span>{r.entry}</span>
                    <span className="dim">→ {r.effect ?? "not used by the engine yet"}</span>
                  </div>
                ))}
              </div>
              <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => nav.go("settings")}>
                Edit profile in Settings
              </button>
            </div>
          </div>
          <div className="panel">
            <div className="hd">Your history with suggestions</div>
            <div className="bd" style={{ display: "grid", gap: "0.6rem", fontSize: "var(--fs-s)" }}>
              <dl className="kv">
                <dt>Suggestions you started</dt>
                <dd className="num">{accepts.length}</dd>
                <dt>Suggestions you passed on</dt>
                <dd className="num">{passes.length}</dd>
                <dt>Games dropped with a reason</dt>
                <dd className="num">{new Set(drops.map((d) => d.gameId)).size}</dd>
              </dl>
              {dropCounts.size > 0 ? (
                <div>
                  <div className="mono dim" style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Why you've dropped games</div>
                  {[...dropCounts.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => (
                    <div key={r} className="row" style={{ justifyContent: "space-between" }}>
                      <span>{REASONS[r]?.label ?? r}</span>
                      <span className="num">{n}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dim">When you set a game to Dropped, REWIND asks why (optional). Those reasons show up here and shape suggestions.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AffBars({ items }: { items: { label: string; v: number }[] }) {
  if (!items.length) return <div className="dim">Not enough information yet.</div>;
  return (
    <div className="bars">
      {items.map((x) => (
        <div className="bar" key={x.label}>
          <span className="mono">{x.label}</span>
          <div className="track">
            <div className={"fill" + (x.v < 0 ? " neg" : "")} style={{ width: `${Math.min(100, Math.abs(x.v) * 100)}%` }} />
          </div>
          <span className="num dim" style={{ textAlign: "right" }}>{x.v > 0 ? "+" : "−"}{Math.abs(x.v).toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
