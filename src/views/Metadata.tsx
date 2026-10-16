import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Cover, fmtDateTime } from "../ui/bits.tsx";
import { cleanTitle } from "../lib/canon.ts";
import type { Game } from "../lib/types.ts";
import type { MetaFilter } from "../lib/library.ts";
import { artStats, openExternal } from "../platform/native.ts";
import { cancelSync, igdbCreds, loadLastSync, net, PHASE_LABEL, startSync, useSyncState } from "../state/metaSync.ts";
import { DEFAULT_SYNC, igdbToken, summary } from "../meta/sync.ts";
import { getOwnedGames, isValidApiKey, parseSteamIdInput, resolveVanity } from "../meta/steam.ts";
import { toNetError } from "../meta/http.ts";
import { PROVIDER_LABEL, type Provider } from "../meta/types.ts";
import { STEAM_SOURCE_LABEL, type SteamSource } from "../meta/steamImport.ts";
import { SteamImportDialog } from "./SteamImport.tsx";
import { MatchPicker } from "./MatchPicker.tsx";

export function MetadataView({ nav }: { nav: Nav }) {
  const { games, repo, reloadAll, toast } = useApp();
  const sync = useSyncState();
  const [importing, setImporting] = useState<SteamSource | null>(null);
  const [hasIgdb, setHasIgdb] = useState(false);
  const [hasSteamKey, setHasSteamKey] = useState(false);
  const [useIgdb, setUseIgdb] = useState(true);
  const [searchSteam, setSearchSteam] = useState(true);
  const [disk, setDisk] = useState<{ files: number; bytes: number; dir: string } | null>(null);
  const [connVersion, setConnVersion] = useState(0);

  useEffect(() => {
    void loadLastSync(repo);
  }, [repo]);
  useEffect(() => {
    void (async () => {
      setHasIgdb(Boolean(await igdbCreds(repo)));
      setHasSteamKey(Boolean((await repo.getSecret("steam_api_key")) && (await repo.getSetting<string>("steam_id", ""))));
    })();
  }, [repo, connVersion]);
  useEffect(() => {
    if (!sync.running) void artStats().then(setDisk).catch(() => undefined);
  }, [sync.running, games]);

  const stats = useMemo(() => {
    const s = { total: games.length, cover: 0, linked: 0, details: 0, review: 0, notFound: 0, steamTime: 0, unlinked: 0, igdb: 0 };
    for (const g of games) {
      if (g.coverPath) s.cover++;
      if (g.steamAppId != null) s.linked++;
      else if (!g.meta.steam || g.meta.steam.status === "error") s.unlinked++;
      if (g.meta.steam?.data || g.meta.igdb?.data) s.details++;
      if (g.meta.steam?.status === "review" || g.meta.igdb?.status === "review") s.review++;
      if (g.steamAppId == null && g.meta.steam?.status === "none") s.notFound++;
      if (g.steamPlaytimeMin != null) s.steamTime++;
      if (g.meta.igdb?.status === "linked") s.igdb++;
    }
    return s;
  }, [games]);

  const reviewList = useMemo(
    () =>
      games
        .flatMap((g) => (["steam", "igdb"] as Provider[]).filter((p) => g.meta[p]?.status === "review").map((p) => ({ g, p })))
        .sort((a, b) => a.g.title.localeCompare(b.g.title)),
    [games],
  );
  const notFound = useMemo(() => games.filter((g) => g.steamAppId == null && g.meta.steam?.status === "none").sort((a, b) => a.title.localeCompare(b.title)), [games]);

  const run = async (refreshDays: number) => {
    const creds = useIgdb ? await igdbCreds(repo) : null;
    const res = await startSync(repo, { ...DEFAULT_SYNC, refreshDays, searchSteam, igdb: creds }, reloadAll);
    if (res) toast(res.outcome === "complete" ? `Metadata: ${res.message}` : res.message, res.outcome === "error");
  };

  const go = (meta: MetaFilter) => nav.library({ meta });
  const p = sync.progress;
  const estMinutes = Math.ceil((stats.unlinked * 1.7) / 60);

  return (
    <div className="content pad">
      <div className="dash">
        <section className="panel span2" aria-labelledby="h-cov">
          <div className="hd" id="h-cov">
            Library coverage <span className="count">{games.length} games</span>
          </div>
          <div className="bd">
            <div className="statgrid">
              <button className="stat" onClick={() => go("has_cover")}><span className="n">{stats.cover}</span><span className="l">with a cover</span></button>
              <button className="stat" onClick={() => go("no_cover")}><span className="n">{stats.total - stats.cover}</span><span className="l">no cover yet</span></button>
              <button className="stat" onClick={() => go("linked")}><span className="n">{stats.linked}</span><span className="l">linked to Steam</span></button>
              <button className="stat" onClick={() => go("review")}><span className={"n" + (stats.review ? " warn" : "")}>{stats.review}</span><span className="l">need you to pick a match</span></button>
              <button className="stat" onClick={() => go("not_found")}><span className="n">{stats.notFound}</span><span className="l">not found on Steam</span></button>
              <div className="stat static"><span className="n">{stats.steamTime}</span><span className="l">with Steam playtime</span></div>
              {stats.igdb > 0 && <div className="stat static"><span className="n">{stats.igdb}</span><span className="l">linked to IGDB</span></div>}
            </div>
            <div className="covstrip" aria-hidden="true">
              {games.filter((g) => g.coverPath).slice(0, 14).map((g) => <Cover key={g.id} game={g} />)}
            </div>
          </div>
        </section>

        <ConnectionsPanel onChange={() => setConnVersion((v) => v + 1)} />

        <section className="panel" aria-labelledby="h-imp">
          <div className="hd" id="h-imp">Import your Steam library</div>
          <div className="bd" style={{ display: "grid", gap: "0.7rem" }}>
            <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
              Matches Steam games to the ones already in REWIND and adds Steam's playtime alongside your existing hours. You see every match first; ratings, notes and statuses are never changed. Your Steam password is never needed.
            </div>
            <div className="choice2">
              <button className="btn" onClick={() => setImporting("steam_local")}>
                <Icon name="folder" /> {STEAM_SOURCE_LABEL.steam_local}
              </button>
              <span className="dim" style={{ fontSize: "var(--fs-s)" }}>No key, works with a private profile. Sees games launched or installed with this account.</span>
            </div>
            <div className="choice2">
              <button className="btn" onClick={() => setImporting("steam_api")} disabled={!hasSteamKey} title={hasSteamKey ? "" : "Add your Steam Web API key and SteamID under Connections"}>
                <Icon name="download" /> {STEAM_SOURCE_LABEL.steam_api}
              </button>
              <span className="dim" style={{ fontSize: "var(--fs-s)" }}>Every owned game. Needs your free Steam Web API key and public “Game details”.</span>
            </div>
          </div>
        </section>

        <section className="panel span2" aria-labelledby="h-sync">
          <div className="hd" id="h-sync">
            Details &amp; covers
            <span className="right">{sync.running ? <span className="led ok blink"><i /> working</span> : <span className="count">offline copies, kept on this PC</span>}</span>
          </div>
          <div className="bd" style={{ display: "grid", gap: "0.8rem" }}>
            {sync.running ? (
              <div className="syncbox">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b>{p ? PHASE_LABEL[p.phase] : "Starting…"}</b>
                  <span className="mono dim">{p && p.total ? `${p.done} / ${p.total}` : ""}</span>
                </div>
                <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={p?.total || 1} aria-valuenow={p?.done ?? 0}>
                  <i style={{ width: `${p && p.total ? Math.round((p.done / p.total) * 100) : 3}%` }} />
                </div>
                <div className="mono dim ellipsis" style={{ fontSize: "var(--fs-xs)" }}>{p?.current || " "}</div>
                {p && <div className="dim" style={{ fontSize: "var(--fs-s)" }}>{summary(p.counts)}</div>}
                <div className="row">
                  <button className="btn" onClick={cancelSync}><Icon name="x" /> Stop</button>
                  <span className="dim" style={{ fontSize: "var(--fs-s)" }}>You can keep using REWIND. Stopping keeps everything fetched so far.</span>
                </div>
              </div>
            ) : (
              <>
                {sync.last && (
                  <div className={"note " + (sync.last.outcome === "complete" ? "ok" : sync.last.outcome === "cancelled" ? "" : "bad")} style={{ fontSize: "var(--fs-s)" }}>
                    <b>Last run {fmtDateTime(sync.last.finishedAt)}:</b> {sync.last.message}
                  </div>
                )}
                <div className="row">
                  <button className="btn primary" onClick={() => void run(30)}>
                    <Icon name="download" /> Update details &amp; covers
                  </button>
                  <button className="btn" onClick={() => void run(0)} title="Re-read every linked game from the store, even if it was fetched recently">
                    Refresh everything
                  </button>
                </div>
                <div className="checks">
                  <label className="check">
                    <input type="checkbox" checked={searchSteam} onChange={(e) => setSearchSteam(e.target.checked)} />
                    Look up games that aren't linked to Steam by their title{stats.unlinked ? ` (${stats.unlinked} games, about ${estMinutes} min — Steam allows one search every ~1.6 s)` : ""}
                  </label>
                  <label className="check" title={hasIgdb ? "" : "Add IGDB credentials under Connections"}>
                    <input type="checkbox" disabled={!hasIgdb} checked={hasIgdb && useIgdb} onChange={(e) => setUseIgdb(e.target.checked)} />
                    Also use IGDB (player-submitted completion times, games Steam doesn't cover){hasIgdb ? "" : " — not connected"}
                  </label>
                </div>
              </>
            )}
            <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
              Only games matched exactly are linked automatically; anything uncertain waits below for you. Covers are saved to{" "}
              <span className="mono">{disk?.dir ?? "your app data folder"}</span>
              {disk && disk.files ? ` (${disk.files} files, ${(disk.bytes / 1048576).toFixed(1)} MB)` : ""} and work offline.
            </div>
          </div>
        </section>

        <section className="panel full" aria-labelledby="h-rev">
          <div className="hd" id="h-rev">
            Needs your decision <span className="count">{reviewList.length}</span>
          </div>
          <div className="bd flush">
            {reviewList.length === 0 ? (
              <div className="empty">
                <b>Nothing to decide</b>
                <span className="hint">When a title could match more than one store page, it waits here instead of being guessed.</span>
              </div>
            ) : (
              <div className="revlist">
                {reviewList.slice(0, 60).map(({ g, p: prov }) => (
                  <div className="revitem" key={g.id + prov}>
                    <div className="revhead">
                      <button className="linkish t" onClick={() => nav.openGame(g.id)}>{cleanTitle(g.title)}</button>
                      <span className="chip">{PROVIDER_LABEL[prov]}</span>
                    </div>
                    <MatchPicker game={g} provider={prov} compact />
                  </div>
                ))}
                {reviewList.length > 60 && <div className="empty"><span className="hint">Showing 60 of {reviewList.length}. Decide these and the rest appear.</span></div>}
              </div>
            )}
          </div>
        </section>

        <NotFoundPanel games={notFound} nav={nav} />

        <section className="panel" aria-labelledby="h-src">
          <div className="hd" id="h-src">Where the data comes from</div>
          <div className="bd srcnotes">
            <p><b>Steam store</b> — names, release dates, developers, publishers, player modes, platforms, descriptions and artwork, from the public store endpoints the Steam client itself uses. No key needed. Shown as “Steam store”.</p>
            <p><b>Steam user tags</b> — the community's tags with their vote counts. Only well-voted tags are used, they're labelled “Steam user tags”, and your own tags always count more.</p>
            <p><b>Your Steam library</b> — the official Steam Web API (your key, read-only) or the Steam client's files on this PC.</p>
            <p><b>IGDB.com</b> (optional, by Twitch) — extra details and player-submitted completion times, labelled “IGDB”.</p>
            <p className="dim">HowLongToBeat has no public API, so REWIND only links to it. Nothing is sent anywhere except the game being looked up; nothing about your library leaves this PC.</p>
          </div>
        </section>
      </div>
      {importing && (
        <SteamImportDialog
          source={importing}
          onClose={() => setImporting(null)}
          onImported={() => toast("Steam import finished. Fetch details & covers next to see the artwork.")}
        />
      )}
    </div>
  );
}

function NotFoundPanel({ games, nav }: { games: Game[]; nav: Nav }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const list = all ? games : games.slice(0, 24);
  return (
    <section className="panel span2" aria-labelledby="h-nf">
      <div className="hd" id="h-nf">
        Not found on Steam <span className="count">{games.length}</span>
      </div>
      <div className="bd flush">
        {games.length === 0 ? (
          <div className="empty">
            <b>Nothing missing</b>
            <span className="hint">Games Steam doesn't sell (or that are listed under another name) show up here so you can link them by hand.</span>
          </div>
        ) : (
          <div className="list">
            {list.map((g) => (
              <div key={g.id} className="li col">
                <div className="row" style={{ width: "100%" }}>
                  <button className="linkish t" onClick={() => nav.openGame(g.id)}>{cleanTitle(g.title)}</button>
                  <span className="grow" />
                  <button className="btn sm" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
                    {open === g.id ? "Close" : "Find it…"}
                  </button>
                </div>
                {open === g.id && <MatchPicker game={g} provider="steam" compact onDone={() => setOpen(null)} />}
              </div>
            ))}
            {games.length > 24 && !all && (
              <div className="li">
                <button className="btn sm ghost" onClick={() => setAll(true)}>Show all {games.length}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ConnectionsPanel({ onChange }: { onChange(): void }) {
  const { repo, run, toast } = useApp();
  const [key, setKey] = useState("");
  const [steamId, setSteamId] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [cid, setCid] = useState("");
  const [secret, setSecret] = useState("");
  const [hasIgdb, setHasIgdb] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setHasKey(Boolean(await repo.getSecret("steam_api_key")));
      setSteamId(await repo.getSetting<string>("steam_id", ""));
      setHasIgdb(Boolean(await igdbCreds(repo)));
      setCid((await repo.getSecret("igdb_client_id")) ?? "");
    })();
  }, [repo]);

  const saveSteam = async () => {
    setMsg(null);
    const k = key.trim();
    if (k && !isValidApiKey(k)) {
      setMsg({ text: "A Steam Web API key is 32 letters and numbers (0-9, A-F).", ok: false });
      return;
    }
    const id = parseSteamIdInput(steamId);
    if (steamId.trim() && id.kind === "invalid") {
      setMsg({ text: id.reason, ok: false });
      return;
    }
    await run(async () => {
      if (k) await repo.setSecret("steam_api_key", k);
      await repo.setSetting("steam_id", steamId.trim());
    });
    if (k) setHasKey(true);
    setKey("");
    onChange();
    setMsg({ text: "Saved on this PC.", ok: true });
  };

  const testSteam = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const k = key.trim() || (await repo.getSecret("steam_api_key"));
      if (!k) throw new Error("Enter your key first.");
      const id = parseSteamIdInput(steamId);
      if (id.kind === "invalid") throw new Error(id.reason);
      const sid = id.kind === "steamid" ? id.id : await resolveVanity(net, k, id.name);
      const res = await getOwnedGames(net, k, sid);
      setMsg(
        res.privateOrEmpty
          ? { text: "The key works, but Steam returned no games — your profile's “Game details” are probably private.", ok: false }
          : { text: `Connected: Steam lists ${res.games.length} games for this account.`, ok: true },
      );
    } catch (e) {
      setMsg({ text: e instanceof Error && !("kind" in e) ? e.message : toNetError(e).message, ok: false });
    }
    setBusy(false);
  };

  const saveIgdb = async () => {
    setMsg(null);
    if (!cid.trim() || !secret.trim()) {
      setMsg({ text: "Enter both the Client ID and the Client Secret.", ok: false });
      return;
    }
    setBusy(true);
    try {
      await igdbToken(repo, net, { clientId: cid.trim(), clientSecret: secret.trim() });
      await repo.setSecret("igdb_client_id", cid.trim());
      await repo.setSecret("igdb_client_secret", secret.trim());
      setHasIgdb(true);
      setSecret("");
      onChange();
      setMsg({ text: "IGDB connected.", ok: true });
    } catch (e) {
      setMsg({ text: toNetError(e).message, ok: false });
    }
    setBusy(false);
  };

  const clear = async (what: "steam" | "igdb") => {
    await run(async () => {
      if (what === "steam") await repo.setSecret("steam_api_key", null);
      else for (const k of ["igdb_client_id", "igdb_client_secret", "igdb_token"]) await repo.setSecret(k, null);
    });
    if (what === "steam") setHasKey(false);
    else {
      setHasIgdb(false);
      setCid("");
    }
    onChange();
    toast(what === "steam" ? "Steam key removed from this PC." : "IGDB credentials removed from this PC.");
  };

  return (
    <section className="panel" aria-labelledby="h-conn" id="connections">
      <div className="hd" id="h-conn">Connections <span className="count">optional</span></div>
      <div className="bd conn">
        <div className="conn-sec">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>Steam Web API</b>
            <span className={"led " + (hasKey ? "ok" : "off")}><i /> {hasKey ? "key saved" : "no key"}</span>
          </div>
          <label className="lbl">
            Your SteamID or profile link
            <input className="field" value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="steamcommunity.com/id/yourname or 7656119…" />
          </label>
          <label className="lbl">
            Web API key {hasKey && <span className="dim">(saved — enter a new one to replace it)</span>}
            <span className="row">
              <input className="field grow mono" type={showKey ? "text" : "password"} value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "••••••••••••••••" : "32 characters"} autoComplete="off" spellCheck={false} />
              <button className="btn sm ghost" type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? "Hide" : "Show"}</button>
            </span>
          </label>
          <div className="row">
            <button className="btn sm primary" onClick={() => void saveSteam()}>Save</button>
            <button className="btn sm" disabled={busy} onClick={() => void testSteam()}>Test</button>
            {hasKey && <button className="btn sm ghost" onClick={() => void clear("steam")}>Remove key</button>}
            <button className="btn sm ghost" onClick={() => void openExternal("https://steamcommunity.com/dev/apikey")}>Get a free key ↗</button>
          </div>
        </div>
        <div className="conn-sec">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>IGDB (via Twitch)</b>
            <span className={"led " + (hasIgdb ? "ok" : "off")}><i /> {hasIgdb ? "connected" : "not connected"}</span>
          </div>
          <div className="form2">
            <label className="lbl">
              Client ID
              <input className="field mono" value={cid} onChange={(e) => setCid(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="lbl">
              Client Secret
              <input className="field mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={hasIgdb ? "saved" : ""} autoComplete="off" />
            </label>
          </div>
          <div className="row">
            <button className="btn sm primary" disabled={busy} onClick={() => void saveIgdb()}>Connect</button>
            {hasIgdb && <button className="btn sm ghost" onClick={() => void clear("igdb")}>Remove</button>}
            <button className="btn sm ghost" onClick={() => void openExternal("https://api-docs.igdb.com/#account-creation")}>How to get these ↗</button>
          </div>
        </div>
        {msg && <div className={"note " + (msg.ok ? "ok" : "bad")} style={{ fontSize: "var(--fs-s)" }}>{msg.text}</div>}
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>Keys are stored only in REWIND's database on this PC, never in backups, and are only sent to Steam or Twitch.</div>
      </div>
    </section>
  );
}
