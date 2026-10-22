// Pick for me answers one question: what should I play right now?
// Say what you feel like, optionally how much time and energy you have, and get one game
// with reasons specific to it. Play, skip (with a reason) or ask for another.
// Finer preferences are folded away under "More preferences".

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ContextMenu, Modal, type MenuItem } from "../ui/Overlays.tsx";
import { Cover } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { BUILT_IN_PRESETS, usePickerSettings, useTaste, type Preset } from "../state/recs.ts";
import {
  AVOID_LABEL,
  BAND_LABEL,
  COMMIT_LABEL,
  DIFFICULTY_LABEL,
  diversify,
  EMPTY_SESSION,
  ENERGY_LABEL,
  EXPERIENCE_LABEL,
  hashString,
  INTENT_LABEL,
  recommend,
  STRUCTURE_LABEL,
  surprisePick,
  TIME_LABEL,
  type AvoidKey,
  type Intent,
  type Rec,
  type Session,
} from "../rec/engine.ts";
import { PASS_REASONS, REASONS } from "../rec/taste.ts";
import { explain, oneLine } from "../rec/explain.ts";
import { launchTarget } from "../launchers/launch.ts";
import { LAUNCHER_LABEL } from "../lib/types.ts";

export interface PickRequest {
  session?: Partial<Session>;
  surprise?: boolean;
  nonce: number;
}

const INTENT_HINT: Record<Intent, string> = {
  any: "No preference — the best fit tonight",
  continue: "Keep going with what you're playing",
  resume: "Pick up something paused or part-played",
  new: "Something you haven't started",
  replay: "A favourite you've finished",
  different: "Away from your usual",
};

const INTENTS: Intent[] = ["any", "new", "continue", "resume", "replay", "different"];

export function PickView({ nav, request }: { nav: Nav; request: PickRequest | null }) {
  const { games, profile, recEvents, settings, addRecEvent, updateGame, confirm, toast, play } = useApp();
  const { taste, series, marksByGame } = useTaste();
  const ps = usePickerSettings();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [mainId, setMainId] = useState<string | null>(null);
  const [surpriseN, setSurpriseN] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [resting, setResting] = useState(false);
  const handled = useRef(-1);
  const S = ps.session;
  const allowEst = settings.useUnverifiedLengths;

  const result = useMemo(
    () => recommend({ games, taste, events: recEvents, session: S, weights: ps.weights, profile, series, allowUnverified: allowEst, marks: marksByGame }),
    [games, taste, recEvents, S, ps.weights, profile, series, allowEst, marksByGame],
  );
  const list = useMemo(() => diversify(result.results.filter((r) => !r.heldBack), 5, taste.idf, skipped), [result, taste.idf, skipped]);
  const heldBack = useMemo(() => result.results.filter((r) => r.heldBack), [result]);
  const main: Rec | null = (mainId ? result.results.find((r) => r.game.id === mainId && !skipped.has(r.game.id)) : null) ?? list[0] ?? null;
  const alts = list.filter((r) => r.game.id !== main?.game.id).slice(0, 4);

  const update = (patch: Partial<Session>) => {
    ps.setSession({ ...S, ...patch });
    setSkipped(new Set());
    setMainId(null);
    setResting(false);
  };

  const surprise = (base: Session = S) => {
    const r = base === S ? result : recommend({ games, taste, events: recEvents, session: base, weights: ps.weights, profile, series, allowUnverified: allowEst, marks: marksByGame });
    const n = surpriseN + 1;
    setSurpriseN(n);
    const pick = surprisePick(r.results, hashString(new Date().toISOString().slice(0, 10) + "|" + n + "|" + JSON.stringify(base)), skipped);
    if (pick) {
      setMainId(pick.game.id);
      void addRecEvent("surprise", pick.game.id, null, { session: base });
    }
  };

  // Requests from Home ("More choices", a ready-made session).
  useEffect(() => {
    if (!request || !ps.loaded || handled.current === request.nonce) return;
    handled.current = request.nonce;
    setResting(false);
    if (request.session) {
      const next = { ...EMPTY_SESSION, ...request.session };
      ps.setSession(next);
      setSkipped(new Set());
      setMainId(null);
      if (request.surprise) surprise(next);
    } else if (request.surprise) surprise();
  }, [request, ps.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const another = () => {
    if (!main) return;
    setSkipped((s) => new Set([...s, main.game.id]));
    setMainId(null);
  };

  const doPlay = async (r: Rec) => {
    await addRecEvent("accept", r.game.id, null, { session: S, score: Math.round(r.score * 100) / 100 });
    await play(r.game.id);
  };

  const pass = async (r: Rec, reason: string) => {
    await addRecEvent("pass", r.game.id, reason, { session: S });
    setSkipped((s) => new Set([...s, r.game.id]));
    if (mainId === r.game.id) setMainId(null);
    if (reason === "already_finished") {
      if (await confirm({ title: "Mark as completed?", body: <p>Mark <b>{cleanTitle(r.game.title)}</b> as Completed?</p>, ok: "Mark completed" })) await updateGame(r.game.id, { status: "completed" });
    } else if (reason === "not_interested") {
      if (await confirm({ title: "Not interested?", body: <p>Set <b>{cleanTitle(r.game.title)}</b> to Not interested? It won't be suggested until you change it back.</p>, ok: "Set not interested" }))
        await updateGame(r.game.id, { status: "not_interested" });
    } else {
      const def = REASONS[reason];
      toast(`Noted: ${def.label.toLowerCase()}. ${def.cooldownDays <= 2 ? "It'll come back soon." : `Shown less for ${def.cooldownDays} days.`}`);
    }
  };

  const skipMenu = (e: { clientX: number; clientY: number }, r: Rec) =>
    setMenu({ x: e.clientX, y: e.clientY, items: [{ heading: "Why not this one?" }, ...PASS_REASONS.map((k) => ({ label: REASONS[k].label, onClick: () => void pass(r, k) }))] });

  const reset = { ...EMPTY_SESSION, intent: S.intent, includeWishlist: S.includeWishlist, hideRejected: S.hideRejected, allowSequels: S.allowSequels };
  const advCount = [S.experience, S.commitment, S.structure, S.difficulty].filter(Boolean).length + S.avoid.length + Number(S.allowSequels) + Number(S.includeWishlist) + Number(S.hideRejected);

  if (!ps.loaded) return <div className="page" />;

  return (
    <div className="page">
      <div className="page-in">
        <div className="pick">
          <header className="page-head" style={{ marginBottom: 0 }}>
            <h1>Pick for me</h1>
            <div className="acts">
              <button className="btn ghost" onClick={() => setResting((v) => !v)} aria-pressed={resting}>
                Not in the mood
              </button>
              <button className="btn" onClick={() => surprise()} title="A strong match, picked at random">
                <Icon name="pick" /> Surprise me
              </button>
            </div>
          </header>

          <section aria-labelledby="h-intent" className="stack">
            <h2 id="h-intent" style={{ fontSize: "var(--fs-section)" }}>
              What do you feel like?
            </h2>
            <div className="intents" role="radiogroup" aria-label="What do you feel like?">
              {INTENTS.map((k) => (
                <button key={k} className="intent" role="radio" aria-checked={S.intent === k} aria-pressed={S.intent === k} onClick={() => update({ intent: k })}>
                  <b>{INTENT_LABEL[k]}</b>
                  <span>{INTENT_HINT[k]}</span>
                </button>
              ))}
            </div>
            <div className="optrow">
              <span className="row nowrap">
                <span className="lbl2">Time</span>
                <Seg value={S.time} options={TIME_LABEL} onChange={(time) => update({ time })} />
              </span>
              <span className="row nowrap">
                <span className="lbl2">Energy</span>
                <Seg value={S.energy} options={ENERGY_LABEL} onChange={(energy) => update({ energy })} />
              </span>
            </div>
          </section>

          {resting ? (
            <section className="card pad stack" aria-live="polite">
              <b>That's fine</b>
              <p className="dim" style={{ margin: 0 }}>No streaks, no goals, and nothing is counted against you or any game.</p>
              <div className="row">
                <button
                  className="btn"
                  onClick={() => {
                    void addRecEvent("break", null);
                    toast("Enjoy the break.");
                    nav.go("home");
                  }}
                >
                  Take a break
                </button>
                <button className="btn" onClick={() => update({ intent: "different" })}>
                  Show me something completely different
                </button>
              </div>
            </section>
          ) : !main ? (
            <section className="empty" aria-live="polite">
              <b>{emptyTitle(S.intent, skipped.size)}</b>
              <span className="hint">{emptyHint(S.intent)}</span>
              <div className="row">
                {skipped.size > 0 && (
                  <button className="btn sm" onClick={() => setSkipped(new Set())}>
                    Start over
                  </button>
                )}
                {S.intent !== "any" && (
                  <button className="btn sm" onClick={() => update({ intent: "any" })}>
                    Anything instead
                  </button>
                )}
                {advCount > 0 && (
                  <button className="btn sm" onClick={() => update(reset)}>
                    Clear preferences
                  </button>
                )}
              </div>
            </section>
          ) : (
            <section aria-live="polite" aria-label="Recommendation" className="stack">
              <ResultCard rec={main} allowEst={allowEst} onPlay={() => void doPlay(main)} onSkip={(e) => skipMenu(e, main)} onAnother={another} onOpen={() => nav.openGame(main.game.id, "library")} />
              {alts.length > 0 && (
                <div className="stack tight">
                  <span className="meta">Other good options — choose one to see why</span>
                  <div className="alts">
                    {alts.map((r) => (
                      <button key={r.game.id} className="tile-btn" onClick={() => setMainId(r.game.id)} title={oneLine(r, allowEst)}>
                        <Cover game={r.game} />
                        <span className="tb-t">{cleanTitle(r.game.title)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <span className="meta">
                {result.results.length} games considered
                {result.excluded.length > 0 && <> · left out: {result.excluded.map((e) => `${e.count} ${e.reason.toLowerCase()}`).join(", ")}</>}
                {skipped.size > 0 && <> · {skipped.size} skipped this time</>}
              </span>
              {heldBack.length > 0 && !S.allowSequels && (
                <div className="note row">
                  <span className="grow">
                    Waiting until you finish the earlier game: {heldBack.slice(0, 3).map((r) => cleanTitle(r.game.title)).join(", ")}
                    {heldBack.length > 3 ? ` and ${heldBack.length - 3} more` : ""}.
                  </span>
                  <button className="btn sm ghost" onClick={() => update({ allowSequels: true })}>
                    Allow sequels
                  </button>
                </div>
              )}
            </section>
          )}

          <details className="drawer-adv">
            <summary>
              <Icon name="filter" /> More preferences{advCount ? ` (${advCount})` : ""}
            </summary>
            <div className="body">
              <div className="stack tight">
                <span className="meta">Presets</span>
                <div className="chips">
                  {[...BUILT_IN_PRESETS, ...ps.presets].map((p) => (
                    <span key={p.id} className={"chip" + (sameSession({ ...EMPTY_SESSION, ...p.session, intent: S.intent }, S) ? " on" : "")}>
                      <button style={{ margin: 0, color: "inherit" }} onClick={() => update({ ...reset, ...p.session })}>
                        {p.name}
                      </button>
                      {!p.builtIn && (
                        <button aria-label={`Delete preset ${p.name}`} onClick={() => void ps.savePresets(ps.presets.filter((x) => x.id !== p.id))}>
                          <Icon name="x" />
                        </button>
                      )}
                    </span>
                  ))}
                  <button className="chip" onClick={() => setSavingPreset(true)} disabled={advCount === 0 && !S.time && !S.energy}>
                    <Icon name="plus" /> Save current
                  </button>
                </div>
              </div>
              <div className="stack tight">
                <span className="meta">Kind of experience</span>
                <div className="chips">
                  {(Object.keys(EXPERIENCE_LABEL) as (keyof typeof EXPERIENCE_LABEL)[]).map((k) => (
                    <button key={k} className="chip" aria-pressed={S.experience === k} onClick={() => update({ experience: S.experience === k ? null : k })}>
                      {EXPERIENCE_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="optrow">
                <span className="row nowrap">
                  <span className="lbl2">Commitment</span>
                  <Seg value={S.commitment} options={COMMIT_LABEL} onChange={(commitment) => update({ commitment })} />
                </span>
              </div>
              <div className="optrow">
                <span className="row nowrap">
                  <span className="lbl2">Structure</span>
                  <Seg value={S.structure} options={STRUCTURE_LABEL} onChange={(structure) => update({ structure })} />
                </span>
                <span className="row nowrap">
                  <span className="lbl2">Difficulty</span>
                  <Seg value={S.difficulty} options={DIFFICULTY_LABEL} onChange={(difficulty) => update({ difficulty })} />
                </span>
              </div>
              <div className="stack tight">
                <span className="meta">Avoid</span>
                <div className="chips">
                  {(Object.keys(AVOID_LABEL) as AvoidKey[]).map((k) => {
                    const on = S.avoid.includes(k);
                    const forced = k === "multiplayer" && profile.excludeMultiplayerDependent;
                    return (
                      <button
                        key={k}
                        className="chip"
                        aria-pressed={on || forced}
                        disabled={forced}
                        title={forced ? "Always on: your profile excludes games that need other players" : undefined}
                        onClick={() => update({ avoid: on ? S.avoid.filter((a) => a !== k) : [...S.avoid, k] })}
                      >
                        {AVOID_LABEL[k]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="checks">
                <label className="check">
                  <input type="checkbox" checked={S.allowSequels} onChange={(e) => update({ allowSequels: e.target.checked })} /> Allow sequels before I finish the earlier game
                </label>
                <label className="check">
                  <input type="checkbox" checked={S.hideRejected} onChange={(e) => update({ hideRejected: e.target.checked })} /> Hide games I skipped this week
                </label>
                <label className="check">
                  <input type="checkbox" checked={S.includeWishlist} onChange={(e) => update({ includeWishlist: e.target.checked })} /> Include wishlist games I don't own
                </label>
              </div>
              <div className="row">
                {advCount > 0 && (
                  <button className="btn sm" onClick={() => update(reset)}>
                    Clear preferences
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => nav.settings("recommendations")}>
                  Your taste and how factors are weighted…
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {savingPreset && (
        <SavePresetDialog
          onClose={() => setSavingPreset(false)}
          onSave={async (name) => {
            const p: Preset = { id: crypto.randomUUID(), name, session: { ...S } };
            await ps.savePresets([...ps.presets, p]);
            setSavingPreset(false);
            toast(`Saved preset “${name}”.`);
          }}
        />
      )}
    </div>
  );
}

function ResultCard({ rec, allowEst, onPlay, onSkip, onAnother, onOpen }: { rec: Rec; allowEst: boolean; onPlay(): void; onSkip(e: { clientX: number; clientY: number }): void; onAnother(): void; onOpen(): void }) {
  const g = rec.game;
  const e = explain(rec, allowEst, 4);
  const target = launchTarget(g);
  return (
    <article className="result" aria-label={`Suggestion: ${cleanTitle(g.title)}`}>
      <button className="linkish" onClick={onOpen} aria-label="Details">
        <Cover game={g} eager />
      </button>
      <div className="r-body">
        <span className="r-facts">
          {BAND_LABEL[rec.band]}
          {e.facts ? ` · ${e.facts}` : ""}
          {g.ownership !== "owned" ? ` · ${g.ownership === "wishlist" ? "on your wishlist" : "not owned"}` : ""}
        </span>
        <h2 className="r-title">{cleanTitle(g.title)}</h2>
        {e.reasons.length > 0 ? (
          <ul className="why" style={{ paddingLeft: "1rem" }}>
            {e.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <span className="dim">REWIND doesn't know much about this one yet, so this is a loose fit. Rate games you've played to sharpen suggestions.</span>
        )}
        {e.caveat && <span className="meta">Worth knowing: {e.caveat.charAt(0).toLowerCase() + e.caveat.slice(1)}</span>}
        {rec.deprioritized && <span className="meta">{rec.deprioritized.text}. Shown less until {rec.deprioritized.until}.</span>}
        <div className="r-acts">
          <button className="btn primary lg" onClick={onPlay} title={target ? `Start through ${LAUNCHER_LABEL[target.source]}` : "Marks it Playing and times the session"}>
            <Icon name="play" /> {g.status === "playing" ? "Keep playing" : "Play"}
          </button>
          <button className="btn lg" onClick={(ev) => onSkip(ev)}>
            Skip
          </button>
          <button className="btn lg" onClick={onAnother} title="Show another suggestion (no penalty)">
            Another
          </button>
          <button className="btn ghost" onClick={onOpen}>
            Details
          </button>
        </div>
        <details className="dsec" style={{ borderTop: "1px solid var(--border)", marginTop: "var(--s2)" }}>
          <summary style={{ padding: "var(--s2) 0", fontWeight: 400, color: "var(--muted)" }}>How this was scored</summary>
          <div className="scorebars" style={{ paddingBottom: "var(--s2)" }}>
            {rec.components.map((c) => (
              <div key={c.key + c.label} className="sb">
                <span className="dim">{c.label}</span>
                <span className="sb-track">
                  <span className="sb-mid" />
                  <span className={"sb-fill " + (c.score >= 0 ? "pos" : "neg")} style={c.score >= 0 ? { left: "50%", width: `${c.score * 50}%` } : { right: "50%", width: `${-c.score * 50}%` }} />
                </span>
                <span className="num muted">×{c.weight.toFixed(1)}</span>
              </div>
            ))}
            <span className="meta">
              {rec.confidence.level} confidence{rec.confidence.notes.length ? ` (${rec.confidence.notes.join("; ")})` : ""}. Data: {rec.sources.join(", ") || "your library only"}.
            </span>
          </div>
        </details>
      </div>
    </article>
  );
}

function sameSession(a: Session, b: Session): boolean {
  const norm = (s: Session) => JSON.stringify({ ...s, avoid: [...s.avoid].sort() });
  return norm(a) === norm(b);
}

function emptyTitle(intent: Intent, skipped: number): string {
  if (skipped) return `That's everything that fits (${skipped} skipped)`;
  if (intent === "continue") return "Nothing is marked Playing";
  if (intent === "resume") return "Nothing paused or part-played fits";
  if (intent === "replay") return "No replay candidates fit";
  return "Nothing fits these preferences";
}

function emptyHint(intent: Intent): string {
  if (intent === "continue") return "Set a game to Playing from its details, or choose something else above.";
  if (intent === "resume") return "Paused games and games with time already in them appear here.";
  if (intent === "replay") return "Replays come from games you've finished, rated highly or marked Replay.";
  return "Try fewer preferences.";
}

function Seg<K extends string>({ value, options, onChange }: { value: K | null; options: Record<K, string>; onChange(v: K | null): void }) {
  return (
    <div className="seg sm">
      <button aria-pressed={value == null} onClick={() => onChange(null)}>
        Any
      </button>
      {(Object.keys(options) as K[]).map((k) => (
        <button key={k} aria-pressed={value === k} onClick={() => onChange(value === k ? null : k)}>
          {options[k]}
        </button>
      ))}
    </div>
  );
}

function SavePresetDialog({ onClose, onSave }: { onClose(): void; onSave(name: string): void }) {
  const [name, setName] = useState("");
  return (
    <Modal
      title="Save preset"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            Save
          </button>
        </>
      }
    >
      <label className="lbl">
        Name
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())} placeholder="e.g. Sunday afternoon" autoFocus />
      </label>
    </Modal>
  );
}
