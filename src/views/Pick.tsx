import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ContextMenu, Modal, type MenuItem } from "../ui/Overlays.tsx";
import { Cover, StatusPill } from "../ui/bits.tsx";
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
  recommend,
  STRUCTURE_LABEL,
  surprisePick,
  TIME_LABEL,
  DEFAULT_WEIGHTS,
  type AvoidKey,
  type Rec,
  type Session,
  type Weights,
} from "../rec/engine.ts";
import { PASS_REASONS, REASONS } from "../rec/taste.ts";
import { TasteView } from "./Taste.tsx";

export interface PickRequest {
  session?: Partial<Session>;
  surprise?: boolean;
  nonce: number;
}

type Mood = "ready" | "not_in_mood";

export function PickView({ nav, request }: { nav: Nav; request: PickRequest | null }) {
  const { games, profile, recEvents, settings, addRecEvent, updateGame, confirm, toast } = useApp();
  const { taste, series } = useTaste();
  const ps = usePickerSettings();
  const [tab, setTab] = useState<"pick" | "taste" | "weights">("pick");
  const [mood, setMood] = useState<Mood>("ready");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [mainId, setMainId] = useState<string | null>(null);
  const [surpriseN, setSurpriseN] = useState(0);
  const [showScore, setShowScore] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const handled = useRef<number>(-1);
  const S = ps.session;

  const result = useMemo(
    () =>
      recommend({
        games,
        taste,
        events: recEvents,
        session: S,
        weights: ps.weights,
        profile,
        series,
        allowUnverified: settings.useUnverifiedLengths,
      }),
    [games, taste, recEvents, S, ps.weights, profile, series, settings.useUnverifiedLengths],
  );
  const list = useMemo(() => diversify(result.results, 6, taste.idf, skipped), [result, taste.idf, skipped]);
  const main: Rec | null = (mainId ? result.results.find((r) => r.game.id === mainId && !skipped.has(r.game.id)) : null) ?? list[0] ?? null;
  const alts = list.filter((r) => r.game.id !== main?.game.id).slice(0, 4);

  const update = (patch: Partial<Session>) => {
    ps.setSession({ ...S, ...patch });
    setSkipped(new Set());
    setMainId(null);
  };

  const surprise = (sessionOverride?: Session) => {
    const base = sessionOverride ?? S;
    const r = sessionOverride
      ? recommend({ games, taste, events: recEvents, session: base, weights: ps.weights, profile, series, allowUnverified: settings.useUnverifiedLengths })
      : result;
    const n = surpriseN + 1;
    setSurpriseN(n);
    const seed = hashString(new Date().toISOString().slice(0, 10) + "|" + n + "|" + JSON.stringify(base));
    const pick = surprisePick(r.results, seed, skipped);
    if (pick) {
      setMainId(pick.game.id);
      setMood("ready");
      void addRecEvent("surprise", pick.game.id, null, { session: base });
    }
  };

  // Requests from Home ("Low energy tonight", "Surprise me").
  useEffect(() => {
    if (!request || !ps.loaded || handled.current === request.nonce) return;
    handled.current = request.nonce;
    setTab("pick");
    setMood("ready");
    if (request.session) {
      const next = { ...EMPTY_SESSION, ...request.session };
      ps.setSession(next);
      setSkipped(new Set());
      setMainId(null);
      if (request.surprise) surprise(next);
    } else if (request.surprise) surprise();
  }, [request, ps.loaded]);

  const reroll = () => {
    if (!main) return;
    setSkipped((s) => new Set([...s, main.game.id]));
    setMainId(null);
  };

  const play = async (r: Rec) => {
    await addRecEvent("accept", r.game.id, null, { session: S, score: Math.round(r.score * 100) / 100 });
    if (r.game.status !== "playing") await updateGame(r.game.id, { status: "playing", lastPlayed: new Date().toISOString().slice(0, 10) });
    toast(`Enjoy ${cleanTitle(r.game.title)}. It's marked as Playing.`);
  };

  const pass = async (r: Rec, reason: string) => {
    await addRecEvent("pass", r.game.id, reason, { session: S });
    setSkipped((s) => new Set([...s, r.game.id]));
    if (mainId === r.game.id) setMainId(null);
    if (reason === "already_finished") {
      if (await confirm({ title: "Mark as completed?", body: <>Mark <b>{cleanTitle(r.game.title)}</b> as Completed?</>, ok: "Mark completed" })) {
        await updateGame(r.game.id, { status: "completed" });
      }
    } else if (reason === "not_interested") {
      if (await confirm({ title: "Not interested?", body: <>Set <b>{cleanTitle(r.game.title)}</b> to "Not interested"? It won't be suggested until you change it back.</>, ok: "Set not interested" })) {
        await updateGame(r.game.id, { status: "not_interested" });
      }
    } else {
      const def = REASONS[reason];
      toast(`Noted: ${def.label.toLowerCase()}. ${def.cooldownDays <= 2 ? "It'll be back soon." : `Shown less for ${def.cooldownDays} days.`}`);
    }
  };

  const passMenu = (e: { clientX: number; clientY: number }, r: Rec) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [{ heading: "Why not this one?" }, ...PASS_REASONS.map((k) => ({ label: REASONS[k].label, onClick: () => void pass(r, k) }))],
    });

  const activePreset = [...BUILT_IN_PRESETS, ...ps.presets].find((p) => sameSession({ ...EMPTY_SESSION, ...p.session }, S));
  const hasSettings = !sameSession(S, { ...EMPTY_SESSION, progress: S.progress, includeWishlist: S.includeWishlist, hideRejected: S.hideRejected });

  if (!ps.loaded) return <div className="content pad dim">Loading…</div>;

  return (
    <div className="content fill">
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Pick for me">
          <button role="tab" aria-pressed={tab === "pick"} onClick={() => setTab("pick")}>
            <Icon name="pick" /> Pick for me
          </button>
          <button role="tab" aria-pressed={tab === "taste"} onClick={() => setTab("taste")}>
            <Icon name="star" /> Your taste
          </button>
          <button role="tab" aria-pressed={tab === "weights"} onClick={() => setTab("weights")}>
            <Icon name="settings" /> Weights
          </button>
        </div>
        {tab === "pick" && (
          <>
            <span className="divider" />
            <span className="mono dim" style={{ fontSize: "0.78rem" }}>Friction check:</span>
            <div className="seg" role="group" aria-label="How do you feel about playing?">
              <button aria-pressed={mood === "ready" && !S.different} onClick={() => { setMood("ready"); if (S.different) update({ different: false }); }}>
                Ready to play
              </button>
              <button aria-pressed={mood === "ready" && S.different} onClick={() => { setMood("ready"); update({ different: true }); }}>
                Something completely different
              </button>
              <button aria-pressed={mood === "not_in_mood"} onClick={() => setMood("not_in_mood")}>
                Not in the mood
              </button>
            </div>
            <span className="grow" />
            <button className="btn primary" onClick={() => surprise()} title="One click: a strong match picked for you">
              <Icon name="pick" /> Surprise me
            </button>
          </>
        )}
      </div>

      {tab === "taste" && <TasteView nav={nav} />}
      {tab === "weights" && <WeightsPanel weights={ps.weights} onChange={ps.setWeights} />}

      {tab === "pick" && (
        <div className="pick">
          <aside className="pick-side" aria-label="Session settings">
            <Section title="Presets">
              <div className="chips">
                {[...BUILT_IN_PRESETS, ...ps.presets].map((p) => (
                  <span key={p.id} className={"chip preset" + (activePreset?.id === p.id ? " on" : "")}>
                    <button className="pname" onClick={() => update({ ...EMPTY_SESSION, progress: S.progress, includeWishlist: S.includeWishlist, hideRejected: S.hideRejected, ...p.session })}>
                      {p.name}
                    </button>
                    {!p.builtIn && (
                      <button aria-label={`Delete preset ${p.name}`} onClick={() => void ps.savePresets(ps.presets.filter((x) => x.id !== p.id))}>
                        <Icon name="x" className="ico" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn sm" onClick={() => setSavingPreset(true)} disabled={!hasSettings}>
                  <Icon name="plus" /> Save current as preset
                </button>
                {hasSettings && (
                  <button className="btn sm ghost" onClick={() => update({ ...EMPTY_SESSION, progress: S.progress, includeWishlist: S.includeWishlist, hideRejected: S.hideRejected })}>
                    Clear all
                  </button>
                )}
              </div>
            </Section>

            <Section title="What experience do you want?" hint="optional">
              <div className="exp-grid">
                {(Object.keys(EXPERIENCE_LABEL) as (keyof typeof EXPERIENCE_LABEL)[]).map((k) => (
                  <button key={k} className="btn sm" aria-pressed={S.experience === k} onClick={() => update({ experience: S.experience === k ? null : k })}>
                    {EXPERIENCE_LABEL[k]}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Energy">
              <Seg value={S.energy} options={ENERGY_LABEL} onChange={(energy) => update({ energy })} />
            </Section>
            <Section title="Time available">
              <Seg value={S.time} options={TIME_LABEL} onChange={(time) => update({ time })} />
            </Section>
            <Section title="Commitment">
              <Seg value={S.commitment} options={COMMIT_LABEL} onChange={(commitment) => update({ commitment })} />
            </Section>

            <Section title="Avoid" hint={S.avoid.length ? `${S.avoid.length} on` : undefined}>
              <div className="chips">
                {(Object.keys(AVOID_LABEL) as AvoidKey[]).map((k) => {
                  const on = S.avoid.includes(k);
                  const forced = k === "multiplayer" && profile.excludeMultiplayerDependent;
                  return (
                    <button
                      key={k}
                      className={"chip toggle" + (on || forced ? " on" : "")}
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
            </Section>

            <button className="btn sm ghost" style={{ justifySelf: "start" }} onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
              {showMore ? "▾" : "▸"} More options
            </button>
            {showMore && (
              <>
                <Section title="Structure">
                  <Seg value={S.structure} options={STRUCTURE_LABEL} onChange={(structure) => update({ structure })} />
                </Section>
                <Section title="Difficulty">
                  <Seg value={S.difficulty} options={DIFFICULTY_LABEL} onChange={(difficulty) => update({ difficulty })} />
                </Section>
                <Section title="Start or continue">
                  <div className="seg">
                    {(["either", "continue", "new"] as const).map((p) => (
                      <button key={p} aria-pressed={S.progress === p} onClick={() => update({ progress: p })}>
                        {p === "either" ? "Either" : p === "continue" ? "Continue something" : "Start something new"}
                      </button>
                    ))}
                  </div>
                </Section>
                <label className="check">
                  <input type="checkbox" checked={S.hideRejected} onChange={(e) => update({ hideRejected: e.target.checked })} />
                  Hide games I passed on this week
                </label>
                <label className="check">
                  <input type="checkbox" checked={S.includeWishlist} onChange={(e) => update({ includeWishlist: e.target.checked })} />
                  Include wishlist games I don't own
                </label>
              </>
            )}
          </aside>

          <section className="pick-main" aria-live="polite">
            {mood === "not_in_mood" ? (
              <NotInTheMood
                onBreak={() => {
                  void addRecEvent("break", null);
                  toast("Enjoy the break. Nothing is counted against you.");
                }}
                onDifferent={() => {
                  setMood("ready");
                  update({ different: true });
                }}
                onLater={() => {
                  void addRecEvent("mood_skip", null);
                  nav.go("home");
                }}
              />
            ) : !main ? (
              <div className="empty">
                Nothing left to suggest with these settings{skipped.size ? " (you've skipped " + skipped.size + ")" : ""}.{" "}
                {skipped.size > 0 && (
                  <button className="btn sm" onClick={() => setSkipped(new Set())}>
                    Start over
                  </button>
                )}
              </div>
            ) : (
              <>
                <RecCard
                  rec={main}
                  big
                  onPlay={() => void play(main)}
                  onPass={(e) => passMenu(e, main)}
                  onReroll={reroll}
                  onOpen={() => nav.openGame(main.game.id, "library")}
                  showScore={showScore}
                  toggleScore={() => setShowScore((v) => !v)}
                />
                {alts.length > 0 && (
                  <div className="panel">
                    <div className="hd">
                      Also worth considering
                      <span className="right dim mono" style={{ fontSize: "0.72rem" }}>click to compare</span>
                    </div>
                    <div className="bd flush">
                      <div className="list">
                        {alts.map((r) => (
                          <div key={r.game.id} className="li alt" onClick={() => setMainId(r.game.id)}>
                            <span className={"band b-" + r.band}>{BAND_LABEL[r.band].replace(" fit", "")}</span>
                            <span className="t" title={r.game.title}>{cleanTitle(r.game.title)}</span>
                            <span className="why dim ellipsis">{r.pros[0]?.text ?? ""}</span>
                            <button
                              className="btn sm ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                passMenu(e, r);
                              }}
                            >
                              Pass
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="dim mono" style={{ fontSize: "0.74rem" }}>
                  {result.results.length} candidates
                  {result.excluded.length > 0 && <> · left out: {result.excluded.map((e) => `${e.count} ${e.reason.toLowerCase()}`).join(", ")}</>}
                  {skipped.size > 0 && <> · {skipped.size} skipped this session</>}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {savingPreset && (
        <SavePresetDialog
          onClose={() => setSavingPreset(false)}
          onSave={async (name) => {
            const p: Preset = { id: crypto.randomUUID(), name, session: { ...S, different: false } };
            await ps.savePresets([...ps.presets, p]);
            setSavingPreset(false);
            toast(`Saved preset "${name}".`);
          }}
        />
      )}
    </div>
  );
}

function sameSession(a: Session, b: Session): boolean {
  const norm = (s: Session) => JSON.stringify({ ...s, avoid: [...s.avoid].sort(), different: false });
  return norm(a) === norm(b);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="psec">
      <div className="psec-h">
        {title}
        {hint && <span className="dim"> · {hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Seg<K extends string>({ value, options, onChange }: { value: K | null; options: Record<K, string>; onChange(v: K | null): void }) {
  return (
    <div className="seg">
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

export function RecCard({
  rec,
  big,
  onPlay,
  onPass,
  onReroll,
  onOpen,
  showScore,
  toggleScore,
}: {
  rec: Rec;
  big?: boolean;
  onPlay?(): void;
  onPass?(e: { clientX: number; clientY: number }): void;
  onReroll?(): void;
  onOpen?(): void;
  showScore?: boolean;
  toggleScore?(): void;
}) {
  const g = rec.game;
  return (
    <article className={"panel reccard" + (big ? " big" : "")}>
      <div className="rc-body">
        <Cover game={g} />
        <div className="rc-info">
          <div className="row" style={{ gap: "0.4rem" }}>
            <span className={"band b-" + rec.band}>{BAND_LABEL[rec.band]}</span>
            <span className={"conf c-" + rec.confidence.level} title={rec.confidence.notes.join(" · ") || "Based on solid data"}>
              {rec.confidence.level} confidence
            </span>
            <StatusPill status={g.status} />
            {g.ownership !== "owned" && <span className="badge est">{g.ownership === "wishlist" ? "not owned · wishlist" : g.ownership}</span>}
          </div>
          <h2 className="rc-title">{cleanTitle(g.title)}</h2>
          <div className="mono dim" style={{ fontSize: "0.78rem" }}>{rec.commitment}</div>
          <div className="rc-why">
            <div>
              <h3>Why it fits</h3>
              <ul className="pros">
                {rec.pros.length ? rec.pros.map((p) => <li key={p.text}>{p.text}</li>) : <li className="dim">Nothing stands out either way</li>}
              </ul>
            </div>
            <div>
              <h3>Why it might not</h3>
              <ul className="cons">
                {rec.cons.length ? rec.cons.map((p) => <li key={p.text}>{p.text}</li>) : <li className="dim">No obvious drawbacks for this session</li>}
              </ul>
            </div>
          </div>
          {rec.deprioritized && (
            <div className="note" style={{ fontSize: "0.85rem" }}>
              {rec.deprioritized.text}. It's shown less until {rec.deprioritized.until}, then returns to normal.
            </div>
          )}
          <div className="rc-src mono">
            {rec.sources.join("  ·  ")}
            {rec.confidence.notes.length > 0 && <> · {rec.confidence.notes.join(" · ")}</>}
          </div>
          {showScore && (
            <div className="scorebars">
              {rec.components.map((c) => (
                <div key={c.key + c.label} className="sb">
                  <span className="dim">{c.label}</span>
                  <span className="sb-track">
                    <span className="sb-mid" />
                    <span className={"sb-fill " + (c.score >= 0 ? "pos" : "neg")} style={c.score >= 0 ? { left: "50%", width: `${c.score * 50}%` } : { right: "50%", width: `${-c.score * 50}%` }} />
                  </span>
                  <span className="num dim">×{c.weight.toFixed(1)}</span>
                </div>
              ))}
              <div className="dim" style={{ fontSize: "0.78rem" }}>
                Each bar is one factor from −1 to +1; weights are normalised. Bands, not exact percentages, because the inputs are estimates.
              </div>
            </div>
          )}
          {(onPlay || onPass) && (
            <div className="row rc-actions">
              {onPlay && (
                <button className="btn primary" onClick={onPlay}>
                  <Icon name="play" /> {g.status === "playing" ? "Keep playing" : "Play this"}
                </button>
              )}
              {onPass && (
                <button className="btn" onClick={(e) => onPass(e)}>
                  Not this one ▾
                </button>
              )}
              {onReroll && (
                <button className="btn" onClick={onReroll} title="Show the next suggestion (no penalty)">
                  ↻ Next
                </button>
              )}
              {onOpen && (
                <button className="btn ghost" onClick={onOpen}>
                  Details
                </button>
              )}
              <span className="grow" />
              {toggleScore && (
                <button className="btn sm ghost" onClick={toggleScore} aria-pressed={showScore}>
                  {showScore ? "Hide scoring" : "Show scoring"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function NotInTheMood({ onBreak, onDifferent, onLater }: { onBreak(): void; onDifferent(): void; onLater(): void }) {
  return (
    <div className="panel">
      <div className="hd">Not in the mood</div>
      <div className="bd" style={{ display: "grid", gap: "0.8rem" }}>
        <p style={{ margin: 0 }}>That's completely fine. No streaks, no goals, nothing counted against you or any game.</p>
        <div className="row">
          <button className="btn" onClick={onBreak}>Take a break</button>
          <button className="btn" onClick={onDifferent}>Show me something completely different</button>
          <button className="btn ghost" onClick={onLater}>Revisit later</button>
        </div>
        <p className="dim" style={{ margin: 0, fontSize: "0.85rem" }}>Your settings are kept for next time.</p>
      </div>
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
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button>
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

function WeightsPanel({ weights, onChange }: { weights: Weights; onChange(w: Weights): void }) {
  const keys = Object.keys(weights) as (keyof typeof weights)[];
  return (
    <div className="content pad">
      <div className="panel" style={{ maxWidth: "46rem" }}>
        <div className="hd">
          How much each factor counts
          <span className="right">
            <button className="btn sm" onClick={() => onChange(DEFAULT_WEIGHTS)}>
              Reset
            </button>
          </span>
        </div>
        <div className="bd" style={{ display: "grid", gap: "0.7rem" }}>
          {keys.map((k) => (
            <label key={k} className="wrow">
              <span>{WEIGHT_LABELS[k]}</span>
              <input type="range" min={0} max={2} step={0.25} value={weights[k]} onChange={(e) => onChange({ ...weights, [k]: Number(e.target.value) })} />
              <span className="num">{weights[k] === 0 ? "off" : `${weights[k].toFixed(2)}×`}</span>
            </label>
          ))}
          <div className="dim" style={{ fontSize: "0.85rem" }}>
            Weights are normalised before scoring, so only their relative size matters. "Things to avoid" always counts fully, and games that need
            other players stay out while your profile says so.
          </div>
        </div>
      </div>
    </div>
  );
}

const WEIGHT_LABELS: Record<string, string> = {
  mood: "Matches the mood you picked",
  energyTime: "Fits your energy and time",
  commitment: "Fits the commitment you want",
  taste: "Matches your taste and history",
  structure: "Structure and difficulty",
  variety: "Variety (recent passes, series order)",
  library: "Owned and in-progress games",
};
