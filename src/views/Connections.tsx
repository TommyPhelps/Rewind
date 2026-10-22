// Settings → Connections: every place REWIND can get your games or game details from, in
// one list. Each shows what it can and can't do, when it was last used and how many games
// came from it. Nothing connects until you ask, launcher folders are read only after you
// allow it, and API keys stay hidden unless you open "Advanced".

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { fmtDay } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { LAUNCHER_LABEL, type EventRow, type ScanLauncher } from "../lib/types.ts";
import { backupFileName, createBackup } from "../backup/backup.ts";
import { launcherScan, openExternal, writeSafetySnapshot } from "../platform/native.ts";
import { LAUNCHER_FACTS, parseAll, type LauncherScan } from "../launchers/scan.ts";
import { buildLauncherPlan, launcherStatements, type ApplySummary, type LauncherPlan, type PlanRow } from "../launchers/plan.ts";
import { igdbCreds, net } from "../state/metaSync.ts";
import { igdbToken } from "../meta/sync.ts";
import { getOwnedGames, isValidApiKey, parseSteamIdInput, resolveVanity } from "../meta/steam.ts";
import { toNetError } from "../meta/http.ts";
import { STEAM_SOURCE_LABEL, type SteamSource } from "../meta/steamImport.ts";
import { SteamImportDialog } from "./SteamImport.tsx";

const WHAT_IS_READ: Record<ScanLauncher, { reads: string; detail: string }> = {
  epic: {
    reads: "the install records the Epic Games Launcher keeps in C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests",
    detail: "Each installed game has one small file there with its name, install folder and the id the launcher uses to start it.",
  },
  ubisoft: {
    reads: "Ubisoft Connect's install list in the Windows registry, and Windows' list of installed programs for the game names",
    detail: "These hold each installed game's id and folder.",
  },
  rockstar: {
    reads: "the Rockstar Games entries in the Windows registry, and Windows' list of installed programs for the game names",
    detail: "These hold each installed game's folder.",
  },
};

export function ConnectionsTab({ nav }: { nav: Nav }) {
  const { games, repo, settings, setSettings, toast } = useApp();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [steamImport, setSteamImport] = useState<SteamSource | null>(null);
  const [consent, setConsent] = useState<ScanLauncher | null>(null);
  const [scanning, setScanning] = useState<ScanLauncher | null>(null);
  const [plan, setPlan] = useState<{ plan: LauncherPlan; scans: LauncherScan[] } | null>(null);
  const [keys, setKeys] = useState({ steam: false, steamId: "", igdb: false, v: 0 });

  useEffect(() => {
    void repo.recentEvents(2000).then((evs) => setEvents(evs.filter((e) => e.type === "steam_import" || e.type === "launcher_import")));
  }, [repo, games]);
  useEffect(() => {
    void (async () => {
      const [k, id, ig] = await Promise.all([repo.getSecret("steam_api_key").catch(() => null), repo.getSetting<string>("steam_id", ""), igdbCreds(repo).catch(() => null)]);
      setKeys((x) => ({ ...x, steam: !!k, steamId: id, igdb: !!ig }));
    })();
  }, [repo, keys.v]);

  const count = (src: string) => games.filter((g) => g.sources.some((s) => s.source === src)).length;
  const installed = (src: string) => games.filter((g) => g.sources.some((s) => s.source === src && s.installed)).length;
  const lastEvent = (src: string) => events.find((e) => (src === "steam" ? e.type === "steam_import" : e.type === "launcher_import" && Array.isArray(e.data.sources) && (e.data.sources as string[]).includes(src)));
  const allowed = (l: ScanLauncher) => settings.launcherAccess[l] === true;

  const scan = async (l: ScanLauncher) => {
    setScanning(l);
    try {
      const raw = await launcherScan([l]);
      const scans = parseAll(raw).filter((s) => s.source === l);
      const s = scans[0];
      if (!s.detected) {
        toast(`${LAUNCHER_LABEL[l]} doesn't seem to be installed on this PC${s.error ? ` (${s.error})` : ""}.`, true);
        return;
      }
      setPlan({ plan: buildLauncherPlan(games, scans), scans });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setScanning(null);
    }
  };

  const steamLast = lastEvent("steam");
  return (
    <div className="stack loose">
      <p className="dim" style={{ margin: 0 }}>
        Where REWIND gets your games and game details. Nothing connects until you use it, and REWIND never asks for a launcher password or changes a
        launcher's files. A game you own on several launchers stays one entry; different editions stay separate unless you combine them.
      </p>

      <div>
        <Connection
          name="Steam"
          state={count("steam") ? `${count("steam")} games${installed("steam") ? ` · ${installed("steam")} installed` : ""}` : "Not imported yet"}
          last={steamLast ? `Last import ${fmtDay(steamLast.ts)} (${steamLast.data.source === "steam_local" ? "Steam on this PC" : "Web API"})` : null}
          facts={LAUNCHER_FACTS.steam}
          actions={
            <>
              <button className="btn primary" onClick={() => setSteamImport("steam_local")} title="No key needed; reads the Steam client's files on this PC">
                <Icon name="download" /> {count("steam") ? "Update from this PC" : "Import from this PC"}
              </button>
              <button className="btn" onClick={() => setSteamImport("steam_api")} disabled={!keys.steam || !keys.steamId} title={keys.steam && keys.steamId ? "Every owned game, through the official Web API" : "Add a Steam Web API key under Advanced first"}>
                {STEAM_SOURCE_LABEL.steam_api}
              </button>
            </>
          }
          advanced={<SteamKeys hasKey={keys.steam} steamId={keys.steamId} onChange={() => setKeys((x) => ({ ...x, v: x.v + 1 }))} />}
          advancedLabel="Advanced: Steam Web API key"
        />
        {(["epic", "ubisoft", "rockstar"] as ScanLauncher[]).map((l) => {
          const ev = lastEvent(l);
          return (
            <Connection
              key={l}
              name={LAUNCHER_LABEL[l]}
              state={!allowed(l) ? "Not allowed to look on this PC yet" : count(l) ? `${count(l)} games · ${installed(l)} installed` : "Allowed · nothing imported yet"}
              last={ev ? `Last scan ${fmtDay(ev.ts)}` : null}
              facts={LAUNCHER_FACTS[l]}
              actions={
                allowed(l) ? (
                  <>
                    <button className="btn primary" onClick={() => void scan(l)} disabled={scanning != null}>
                      <Icon name="refresh" /> {scanning === l ? "Scanning…" : "Scan for installed games"}
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setSettings({ launcherAccess: { ...settings.launcherAccess, [l]: false } });
                        toast(`REWIND won't look at ${LAUNCHER_LABEL[l]} on this PC any more. Games already imported stay.`);
                      }}
                    >
                      Stop looking
                    </button>
                  </>
                ) : (
                  <button className="btn" onClick={() => setConsent(l)}>
                    Allow and scan…
                  </button>
                )
              }
            />
          );
        })}
        <Connection
          name="IGDB"
          state={keys.igdb ? "Connected" : "Not connected"}
          last={null}
          facts={{
            can: ["Game details and covers for games Steam doesn't sell", "Player-submitted completion times", "Discover: games outside your library"],
            cannot: ["Know what you own — it's a game database, not a store"],
          }}
          actions={<span className="meta">Uses free Twitch developer keys (no payment). Add them under Advanced.</span>}
          advanced={<IgdbKeys has={keys.igdb} onChange={() => setKeys((x) => ({ ...x, v: x.v + 1 }))} />}
          advancedLabel="Advanced: IGDB keys"
        />
      </div>

      <div className="card pad row">
        <span className="grow">
          <b>Library check-up</b>
          <span className="dim"> — look up missing details and artwork, find duplicates and wrong editions.</span>
        </span>
        <button className="btn" onClick={() => nav.library({})}>
          Open the Library
        </button>
      </div>

      <p className="meta" style={{ margin: 0 }}>
        Keys are encrypted with Windows (DPAPI) so only your Windows account on this PC can read them, are never included in backups, and are only sent to
        Steam or Twitch. HowLongToBeat, GOG and other stores have no public API, so REWIND only links to them.
      </p>

      {steamImport && <SteamImportDialog source={steamImport} onClose={() => setSteamImport(null)} onImported={() => toast("Steam import finished. Run the Library check-up to fetch artwork for new games.")} />}
      {consent && (
        <ConsentDialog
          launcher={consent}
          onClose={() => setConsent(null)}
          onAllow={() => {
            setSettings({ launcherAccess: { ...settings.launcherAccess, [consent]: true } });
            const l = consent;
            setConsent(null);
            void scan(l);
          }}
        />
      )}
      {plan && <LauncherImportDialog plan={plan.plan} scans={plan.scans} onClose={() => setPlan(null)} />}
    </div>
  );
}

function Connection({
  name,
  state,
  last,
  facts,
  actions,
  advanced,
  advancedLabel,
}: {
  name: string;
  state: string;
  last: string | null;
  facts: { can: string[]; cannot: string[] };
  actions: ReactNode;
  advanced?: ReactNode;
  advancedLabel?: string;
}) {
  return (
    <section className="conn" aria-label={name}>
      <div className="conn-h">
        <div className="stack tight">
          <h3>{name}</h3>
          <span className="state">
            {state}
            {last ? ` · ${last}` : ""}
          </span>
        </div>
        <div className="acts">{actions}</div>
      </div>
      <div className="conn-facts">
        <div>
          <span className="k">Can</span>
          <ul>
            {facts.can.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <span className="k">Can't</span>
          <ul>
            {facts.cannot.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      {advanced && (
        <details className="conn-more">
          <summary>{advancedLabel}</summary>
          <div className="body">{advanced}</div>
        </details>
      )}
    </section>
  );
}

function ConsentDialog({ launcher, onClose, onAllow }: { launcher: ScanLauncher; onClose(): void; onAllow(): void }) {
  const w = WHAT_IS_READ[launcher];
  return (
    <Modal
      title={`Let REWIND look for ${LAUNCHER_LABEL[launcher]} games?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Not now
          </button>
          <button className="btn primary" onClick={onAllow}>
            Allow and scan
          </button>
        </>
      }
    >
      <p>
        REWIND will read {w.reads}. {w.detail}
      </p>
      <ul className="why" style={{ paddingLeft: "1.1rem" }}>
        <li>Only reads — nothing is changed, moved or deleted.</li>
        <li>No sign-in, no password, nothing sent over the internet.</li>
        <li>Only installed games can be found; {LAUNCHER_LABEL[launcher]} doesn't expose your full library or playtime.</li>
        <li>You'll see every match before anything is added. You can stop this later.</li>
      </ul>
    </Modal>
  );
}

const GROUPS: { id: "maybe" | "add" | "link" | "known" | "skip"; label: string; hint: string }[] = [
  { id: "maybe", label: "Possibly another edition", hint: "Similar to a game you have, but the edition wording differs. Kept as a separate game unless you say it's the same." },
  { id: "add", label: "New to your library", hint: "Added as owned on this launcher." },
  { id: "link", label: "Already in your library", hint: "Same title: this launcher is added to the existing entry. Your data is unchanged." },
  { id: "known", label: "Known from an earlier scan", hint: "Install state and folder are refreshed." },
  { id: "skip", label: "Not games", hint: "Launchers and tools; skipped unless you add them." },
];

function LauncherImportDialog({ plan: initial, scans, onClose }: { plan: LauncherPlan; scans: LauncherScan[]; onClose(): void }) {
  const { repo, gameById, run, reloadAll, info, games } = useApp();
  const [rows, setRows] = useState<PlanRow[]>(initial.rows);
  const [done, setDone] = useState<ApplySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => ({ ...initial, rows }), [initial, rows]);
  const setRow = (i: number, patch: Partial<PlanRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const errors = scans.map((s) => s.error).filter(Boolean);
  const name = (id: string | null) => (id ? cleanTitle(gameById.get(id)?.title ?? "?") : "");

  const apply = async () => {
    setBusy(true);
    const res = await run(async () => {
      if (games.length) await writeSafetySnapshot(backupFileName("before-launcher-import"), JSON.stringify(await createBackup(repo, info?.version ?? "?")));
      const { stmts, summary } = launcherStatements(repo, plan);
      await repo.batch(stmts);
      await reloadAll();
      return summary;
    });
    setBusy(false);
    if (res) setDone(res);
  };

  if (done)
    return (
      <Modal title="Import finished" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <p>
          {done.added} added, {done.linked} joined to games you already had, {done.refreshed} refreshed{done.uninstalled ? `, ${done.uninstalled} marked as no longer installed` : ""}.
        </p>
        <span className="meta">A safety copy of your library was saved first. New games can get artwork from the Library check-up.</span>
      </Modal>
    );

  return (
    <Modal
      title={`${scans.map((s) => LAUNCHER_LABEL[s.source]).join(", ")}: what was found`}
      xl
      onClose={onClose}
      footer={
        <>
          <span className="meta">
            {rows.filter((r) => r.choice === "add").length} to add · {rows.filter((r) => r.choice === "link" && r.action.type !== "known").length} to join · {plan.noLongerInstalled.length} no longer installed
          </span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void apply()} disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </button>
        </>
      }
    >
      {errors.map((e) => (
        <div key={e} className="note">{e}</div>
      ))}
      <p className="dim">Nothing is saved until you press Import. Your ratings, notes, statuses and playtime are never changed.</p>
      {GROUPS.map((grp) => {
        const xs = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.action.type === grp.id);
        if (!xs.length) return null;
        return (
          <section key={grp.id} className="stack tight">
            <div className="sec-h" style={{ marginBottom: 0 }}>
              <h2 style={{ fontSize: "var(--fs-lead)" }}>{grp.label}</h2>
              <span className="count">{xs.length}</span>
            </div>
            <span className="meta">{grp.hint}</span>
            <div className="rows boxed">
              {xs.map(({ r, i }) => (
                <div className="r-item no-lead" key={i}>
                  <div className="r-main">
                    <span className="r-title">{r.scanned.title}</span>
                    <span className="r-sub">
                      {LAUNCHER_LABEL[r.scanned.source]}
                      {r.scanned.installPath ? ` · ${r.scanned.installPath}` : ""}
                      {r.action.type === "link" || r.action.type === "known" ? ` · joins “${name(r.action.gameId)}”` : ""}
                      {r.action.type === "skip" ? ` · ${r.action.why}` : ""}
                      {r.scanned.titleFrom === "folder name" ? " · name taken from the folder" : ""}
                    </span>
                  </div>
                  <div className="r-acts">
                    {r.action.type === "maybe" ? (
                      <select
                        className="select sm"
                        value={r.choice === "link" ? `link:${r.target}` : r.choice}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("link:")) setRow(i, { choice: "link", target: v.slice(5) });
                          else setRow(i, { choice: v as PlanRow["choice"] });
                        }}
                        aria-label={`What to do with ${r.scanned.title}`}
                      >
                        <option value="add">Separate game</option>
                        {(r.action as { gameIds: string[] }).gameIds.map((id) => (
                          <option key={id} value={`link:${id}`}>Same as “{name(id)}”</option>
                        ))}
                        <option value="skip">Skip</option>
                      </select>
                    ) : r.action.type === "add" || r.action.type === "skip" ? (
                      <label className="check">
                        <input type="checkbox" checked={r.choice === "add"} onChange={(e) => setRow(i, { choice: e.target.checked ? "add" : "skip" })} /> Add
                      </label>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {plan.noLongerInstalled.length > 0 && (
        <section className="stack tight">
          <b>No longer installed</b>
          <span className="meta">{plan.noLongerInstalled.map((n) => name(n.gameId)).join(", ")} — marked as not installed. Nothing is removed from your library.</span>
        </section>
      )}
      {rows.length === 0 && <div className="empty"><b>No installed games found</b><span className="hint">Install a game through the launcher, then scan again.</span></div>}
    </Modal>
  );
}

function SteamKeys({ hasKey, steamId: savedId, onChange }: { hasKey: boolean; steamId: string; onChange(): void }) {
  const { repo, run, toast } = useApp();
  const [key, setKey] = useState("");
  const [steamId, setSteamId] = useState(savedId);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSteamId(savedId), [savedId]);

  const save = async () => {
    setMsg(null);
    const k = key.trim();
    if (k && !isValidApiKey(k)) return setMsg({ text: "A Steam Web API key is 32 characters (0–9, A–F).", ok: false });
    const id = parseSteamIdInput(steamId);
    if (steamId.trim() && id.kind === "invalid") return setMsg({ text: id.reason, ok: false });
    await run(async () => {
      if (k) await repo.setSecret("steam_api_key", k);
      await repo.setSetting("steam_id", steamId.trim());
    });
    setKey("");
    onChange();
    setMsg({ text: "Saved on this PC.", ok: true });
  };
  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const k = key.trim() || (await repo.getSecret("steam_api_key"));
      if (!k) throw new Error("Enter your key first.");
      const id = parseSteamIdInput(steamId);
      if (id.kind === "invalid") throw new Error(id.reason);
      const sid = id.kind === "steamid" ? id.id : await resolveVanity(net, k, id.name);
      const res = await getOwnedGames(net, k, sid);
      setMsg(res.privateOrEmpty ? { text: "The key works, but Steam returned no games — your profile's “Game details” are probably private.", ok: false } : { text: `Works: Steam lists ${res.games.length} games for this account.`, ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error && !("kind" in e) ? e.message : toNetError(e).message, ok: false });
    }
    setBusy(false);
  };
  return (
    <>
      <div className="form2">
        <label className="lbl">
          SteamID or profile link
          <input className="field" value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="steamcommunity.com/id/yourname" />
        </label>
        <label className="lbl">
          Web API key {hasKey && "(saved — type a new one to replace it)"}
          <input className="field mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "saved" : "32 characters"} autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <div className="row">
        <button className="btn sm primary" onClick={() => void save()}>
          Save
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void test()}>
          Test
        </button>
        {hasKey && (
          <button
            className="btn sm ghost"
            onClick={async () => {
              await run(() => repo.setSecret("steam_api_key", null));
              onChange();
              toast("Steam key removed from this PC.");
            }}
          >
            Remove key
          </button>
        )}
        <button className="btn sm ghost" onClick={() => void openExternal("https://steamcommunity.com/dev/apikey")}>
          Get a free key <Icon name="external" />
        </button>
      </div>
      {msg && <div className={"note " + (msg.ok ? "ok" : "bad")}>{msg.text}</div>}
    </>
  );
}

function IgdbKeys({ has, onChange }: { has: boolean; onChange(): void }) {
  const { repo, run, toast } = useApp();
  const [cid, setCid] = useState("");
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setMsg(null);
    if (!cid.trim() || !secret.trim()) return setMsg({ text: "Enter both the Client ID and the Client Secret.", ok: false });
    setBusy(true);
    try {
      await igdbToken(repo, net, { clientId: cid.trim(), clientSecret: secret.trim() });
      await repo.setSecret("igdb_client_id", cid.trim());
      await repo.setSecret("igdb_client_secret", secret.trim());
      setCid("");
      setSecret("");
      onChange();
      setMsg({ text: "IGDB connected.", ok: true });
    } catch (e) {
      setMsg({ text: toNetError(e).message, ok: false });
    }
    setBusy(false);
  };
  return (
    <>
      <div className="form2">
        <label className="lbl">
          Client ID
          <input className="field mono" value={cid} onChange={(e) => setCid(e.target.value)} placeholder={has ? "saved" : ""} autoComplete="off" spellCheck={false} />
        </label>
        <label className="lbl">
          Client Secret
          <input className="field mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={has ? "saved" : ""} autoComplete="off" />
        </label>
      </div>
      <div className="row">
        <button className="btn sm primary" disabled={busy} onClick={() => void connect()}>
          {has ? "Replace" : "Connect"}
        </button>
        {has && (
          <button
            className="btn sm ghost"
            onClick={async () => {
              await run(async () => {
                for (const k of ["igdb_client_id", "igdb_client_secret", "igdb_token"]) await repo.setSecret(k, null);
              });
              onChange();
              toast("IGDB keys removed from this PC.");
            }}
          >
            Remove
          </button>
        )}
        <button className="btn sm ghost" onClick={() => void openExternal("https://api-docs.igdb.com/#account-creation")}>
          How to get these <Icon name="external" />
        </button>
      </div>
      {msg && <div className={"note " + (msg.ok ? "ok" : "bad")}>{msg.text}</div>}
    </>
  );
}

