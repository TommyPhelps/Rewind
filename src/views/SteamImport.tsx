import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { Icon } from "../ui/Icon.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { fmtPlaytime } from "../lib/library.ts";
import { createBackup, backupFileName } from "../backup/backup.ts";
import { pickFolder, steamLocalScan, writeSafetySnapshot } from "../platform/native.ts";
import { net } from "../state/metaSync.ts";
import { getOwnedGames, getStoreItems, parseSteamIdInput, resolveVanity } from "../meta/steam.ts";
import { localOwnedGames, parseLocalScan, type LocalLibrary } from "../meta/steamLocal.ts";
import { buildSteamPlan, KIND_LABEL, planProblems, STEAM_SOURCE_LABEL, steamPlanStatements, type ApplySummary, type PlanRow, type RowKind, type SteamPlan, type SteamSource } from "../meta/steamImport.ts";
import { CONFIDENCE_LABEL } from "../meta/match.ts";
import { toNetError } from "../meta/http.ts";

type Stage =
  | { kind: "loading"; text: string }
  | { kind: "error"; text: string; canPickFolder?: boolean }
  | { kind: "accounts"; lib: LocalLibrary }
  | { kind: "preview"; plan: SteamPlan; note: string | null }
  | { kind: "done"; summary: ApplySummary };

const KIND_ORDER: RowKind[] = ["conflict", "similar", "new", "edition", "exact", "linked"];

/** Import a Steam library: read it, show a preview with every match and choice, then apply in one go. */
export function SteamImportDialog({ source, onClose, onImported }: { source: SteamSource; onClose(): void; onImported(summary: ApplySummary): void }) {
  const { repo, games, info, run, reloadAll } = useApp();
  const [stage, setStage] = useState<Stage>({ kind: "loading", text: "Reading your Steam library…" });
  const [filter, setFilter] = useState<RowKind | "all" | "changes">("changes");
  const [markOwned, setMarkOwned] = useState(true);
  const [busy, setBusy] = useState(false);

  const fromLocal = async (lib: LocalLibrary, accountIdx: number) => {
    const acc = lib.accounts[accountIdx] ?? null;
    const ids = [...new Set([...lib.installed.keys(), ...(acc?.apps.keys() ?? [])])].filter((id) => !lib.installed.has(id));
    const names = new Map<number, string>();
    let note: string | null = null;
    let lookupFailed = false;
    setStage({ kind: "loading", text: `Looking up names for ${ids.length} games on the Steam store…` });
    try {
      for (let i = 0; i < ids.length; i += 25) {
        const items = await getStoreItems(net, ids.slice(i, i + 25), new Map());
        for (const [id, m] of items) names.set(id, m.name);
        setStage({ kind: "loading", text: `Looking up names on the Steam store… ${Math.min(i + 25, ids.length)} of ${ids.length}` });
      }
    } catch (e) {
      lookupFailed = true;
      note = `Couldn't reach the Steam store to look up names (${toNetError(e).message.replace(/\.$/, "")}). Games installed on this PC are still listed.`;
    }
    const { games: owned, unnamed } = localOwnedGames(lib, acc, names);
    if (unnamed.length) {
      const n = unnamed.length;
      note =
        (note ? note + " " : "") +
        (lookupFailed
          ? `${n} played game${n > 1 ? "s" : ""} couldn't be named without the internet and ${n > 1 ? "aren't" : "isn't"} listed; run the import again when you're online.`
          : `${n} app${n > 1 ? "s have" : " has"} no store page (removed, tools or region-locked) and ${n > 1 ? "aren't" : "isn't"} listed.`);
    }
    setStage({ kind: "preview", plan: buildSteamPlan(owned, games, "steam_local"), note });
  };

  const scanLocal = async (dir?: string) => {
    setStage({ kind: "loading", text: "Reading the Steam client's files on this PC…" });
    try {
      const lib = parseLocalScan(await steamLocalScan(dir));
      if (!lib.accounts.length && !lib.installed.size) {
        setStage({ kind: "error", text: "That Steam folder has no installed games and no signed-in accounts.", canPickFolder: true });
        return;
      }
      if (lib.accounts.length > 1) setStage({ kind: "accounts", lib });
      else await fromLocal(lib, 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStage({ kind: "error", text: msg.replace(/^not_found: /, ""), canPickFolder: true });
    }
  };

  const loadApi = async () => {
    setStage({ kind: "loading", text: "Asking Steam for your owned games…" });
    try {
      const key = await repo.getSecret("steam_api_key");
      const idRaw = await repo.getSetting<string>("steam_id", "");
      if (!key || !idRaw) {
        setStage({ kind: "error", text: "Add your Steam Web API key and SteamID under Connections first, or use “Steam on this PC”, which needs neither." });
        return;
      }
      const parsed = parseSteamIdInput(idRaw);
      if (parsed.kind === "invalid") {
        setStage({ kind: "error", text: parsed.reason });
        return;
      }
      const steamid = parsed.kind === "steamid" ? parsed.id : await resolveVanity(net, key, parsed.name);
      const res = await getOwnedGames(net, key, steamid);
      if (res.privateOrEmpty) {
        setStage({
          kind: "error",
          text: "Steam returned no games for this account. That usually means your profile's “Game details” are private. You can make them public in Steam (Profile → Edit Profile → Privacy Settings), import, and set them back — or use “Steam on this PC”, which works with a private profile.",
        });
        return;
      }
      setStage({ kind: "preview", plan: buildSteamPlan(res.games, games, "steam_api"), note: null });
    } catch (e) {
      setStage({ kind: "error", text: toNetError(e).message });
    }
  };

  useEffect(() => {
    if (source === "steam_local") void scanLocal();
    else void loadApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = stage.kind === "preview" ? stage.plan : null;
  const setAction = (row: PlanRow, value: string) => {
    if (!plan) return;
    const action = value === "add" ? { type: "add" as const } : value === "skip" ? { type: "skip" as const } : { type: "link" as const, gameId: value };
    const rows = plan.rows.map((r) => (r === row ? { ...r, action } : r));
    setStage({ kind: "preview", plan: { ...plan, rows }, note: stage.kind === "preview" ? stage.note : null });
  };

  const problems = useMemo(() => (plan ? planProblems(plan) : []), [plan]);
  const tally = useMemo(() => {
    const t = { link: 0, add: 0, skip: 0 };
    for (const r of plan?.rows ?? []) t[r.action.type]++;
    return t;
  }, [plan]);
  const visible = useMemo(() => {
    if (!plan) return [];
    const rows = plan.rows.filter((r) => (filter === "all" ? true : filter === "changes" ? r.kind !== "linked" : r.kind === filter));
    return [...rows].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.owned.name.localeCompare(b.owned.name));
  }, [plan, filter]);

  const apply = async () => {
    if (!plan || problems.length) return;
    setBusy(true);
    const ok = await run(async () => {
      // A safety snapshot first, like every other import.
      const b = await createBackup(repo, info?.version ?? "?");
      await writeSafetySnapshot(backupFileName("before-steam-import"), JSON.stringify(b));
      const { stmts, summary } = steamPlanStatements(repo, plan, games, { markOwned });
      await repo.batch(stmts);
      await reloadAll();
      return summary;
    });
    setBusy(false);
    if (ok) {
      setStage({ kind: "done", summary: ok });
      onImported(ok);
    }
  };

  const title = `Import from ${STEAM_SOURCE_LABEL[source]}`;

  return (
    <Modal
      title={title}
      onClose={onClose}
      xl={stage.kind === "preview"}
      wide={stage.kind !== "preview"}
      footer={
        stage.kind === "preview" ? (
          <>
            <label className="check" style={{ marginRight: "auto" }}>
              <input type="checkbox" checked={markOwned} onChange={(e) => setMarkOwned(e.target.checked)} />
              Mark matched games as Owned (Steam lists them in your library)
            </label>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || problems.length > 0 || tally.link + tally.add === 0} onClick={() => void apply()}>
              <Icon name="download" /> Import {tally.link} matched{tally.add ? ` + add ${tally.add} new` : ""}
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>{stage.kind === "done" ? "Close" : "Cancel"}</button>
        )
      }
    >
      {stage.kind === "loading" && (
        <div className="empty">
          <span className="led ok blink"><i /> {stage.text}</span>
        </div>
      )}
      {stage.kind === "error" && (
        <div style={{ display: "grid", gap: "0.7rem" }}>
          <div className="note bad">{stage.text}</div>
          {stage.canPickFolder && (
            <div className="row">
              <button
                className="btn"
                onClick={async () => {
                  const dir = await pickFolder("Choose your Steam folder (the one with steamapps and userdata inside)");
                  if (dir) void scanLocal(dir);
                }}
              >
                <Icon name="folder" /> Choose Steam folder…
              </button>
              <span className="dim" style={{ fontSize: "var(--fs-meta)" }}>Usually C:\Program Files (x86)\Steam</span>
            </div>
          )}
        </div>
      )}
      {stage.kind === "accounts" && (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <div>More than one Steam account has signed in on this PC. Which one is yours?</div>
          {stage.lib.accounts.map((a, i) => (
            <button key={a.accountId} className="btn" style={{ justifyContent: "flex-start" }} onClick={() => void fromLocal(stage.lib, i)}>
              {a.persona ?? "Steam account"} <span className="dim mono">· {a.steamId64} · {a.apps.size} games played</span>
            </button>
          ))}
        </div>
      )}
      {stage.kind === "done" && (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <div className="note ok">
            Imported: {stage.summary.linked} games matched{stage.summary.added ? `, ${stage.summary.added} added` : ""}, Steam playtime updated for {stage.summary.playtimeUpdated}
            {stage.summary.markedOwned ? `, ${stage.summary.markedOwned} marked Owned` : ""}. A safety snapshot was saved first.
          </div>
          <div className="dim">Your ratings, notes, statuses and preferences were not changed. Artwork and store details for new games come from the Library check-up.</div>
        </div>
      )}
      {stage.kind === "preview" && plan && (
        <div className="imp">
          <div className="imp-top">
            <div className="seg" role="tablist" aria-label="Show">
              <button aria-pressed={filter === "changes"} onClick={() => setFilter("changes")}>Needs a look / changes</button>
              {KIND_ORDER.filter((k) => plan.counts[k]).map((k) => (
                <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {KIND_LABEL[k]} <span className="n">{plan.counts[k]}</span>
                </button>
              ))}
              <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <span className="n">{plan.rows.length}</span></button>
            </div>
            <div className="dim" style={{ fontSize: "var(--fs-meta)" }}>
              {plan.rows.length} Steam games · {plan.notInSteam} REWIND games aren't in this list and stay exactly as they are.
              {source === "steam_local" && " This PC's Steam client only knows games that this account has launched or installed; owned games never played anywhere won't appear."}
            </div>
            {stage.note && <div className="note">{stage.note}</div>}
            {problems.map((p) => <div key={p} className="note bad">{p}</div>)}
          </div>
          <div className="imp-table" role="table" aria-label="Steam games to import">
            <div className="imp-row head" role="row">
              <span>Steam game</span>
              <span className="r">Steam playtime</span>
              <span>Match in your library</span>
              <span>What happens</span>
            </div>
            {visible.map((r) => (
              <div className={"imp-row k-" + r.kind} role="row" key={r.owned.appid}>
                <span className="t2">
                  <span className="t">{cleanTitle(r.owned.name)}</span>
                  <span className="sub mono">app {r.owned.appid}{r.owned.lastPlayed ? ` · last played ${r.owned.lastPlayed}` : ""}{r.owned.installed ? " · installed" : ""}</span>
                </span>
                <span className="r num">{r.owned.playtimeMin ? fmtPlaytime(r.owned.playtimeMin) : "—"}</span>
                <span className="t2">
                  {r.candidates.length ? (
                    <>
                      <span className="t">{cleanTitle(r.candidates[0].title)}</span>
                      <span className={"sub conf-" + (r.confidence ?? "none")}>{r.kind === "conflict" ? r.note : r.confidence ? CONFIDENCE_LABEL[r.confidence] : KIND_LABEL[r.kind]}</span>
                    </>
                  ) : (
                    <span className="sub">{r.note || "Not in REWIND"}</span>
                  )}
                </span>
                <select
                  className="select"
                  aria-label={`What to do with ${cleanTitle(r.owned.name)}`}
                  value={r.action.type === "link" ? r.action.gameId : r.action.type}
                  onChange={(e) => setAction(r, e.target.value)}
                >
                  {r.candidates.map((c) => (
                    <option key={c.gameId} value={c.gameId}>
                      Link to “{cleanTitle(c.title)}”{c.score < 1 ? ` (${Math.round(c.score * 100)}%)` : ""}
                    </option>
                  ))}
                  <option value="add">Add as a new game</option>
                  <option value="skip">Skip</option>
                </select>
              </div>
            ))}
            {visible.length === 0 && <div className="empty"><b>Nothing in this group</b></div>}
          </div>
        </div>
      )}
    </Modal>
  );
}
