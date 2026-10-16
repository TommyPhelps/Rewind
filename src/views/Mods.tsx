import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store.tsx";
import { net } from "../state/metaSync.ts";
import {
  CF_SECRET,
  cfKey,
  loadCompare,
  loadPackPrefs,
  matchLegacy,
  packDetail,
  saveCompare,
  savePackPrefs,
  searchCurseForge,
  searchModrinth,
  suggestedPacks,
  type LegacyMatch,
} from "../state/packs.ts";
import { NetError } from "../meta/http.ts";
import { searchCurse } from "../mods/curseforge.ts";
import { agoText, compareRows, compareVerdict, DEFAULT_PACK_PREFS, EVIDENCE_LABEL, packFit, readPack, SIGNAL_LABEL, type PackPrefs, type Signal } from "../mods/evidence.ts";
import { DEFAULT_PACK_SEARCH, LOADERS, MODRINTH_PACK_CATEGORIES, PACK_SOURCE_LABEL, type Evidence, type PackDetail, type PackSearch, type PackSummary } from "../mods/packTypes.ts";
import { MARK_LABEL, MARKS, type MarkKind } from "../discover/marks.ts";
import { presetById } from "../mods/companion.ts";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { fmtDate } from "../ui/bits.tsx";
import { artSrc, openExternal } from "../platform/native.ts";
import { CompanionTab } from "./ModCompanion.tsx";
import type { Nav } from "../App.tsx";

type Tab = "packs" | "compare" | "old" | "companion";
type Browse = "suggested" | "search" | "saved";
type PSort = "fit" | "relevance" | "downloads" | "updated";
type AnyPack = PackSummary | PackDetail;

const MC_VERSIONS = ["1.21.1", "1.21.4", "1.20.1", "1.19.2", "1.18.2", "1.16.5", "1.12.2", "1.7.10"];
const isDetail = (p: AnyPack): p is PackDetail => "fetchedAt" in p;
const fmtN = (n: number | null) => (n == null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const EV_CLASS: Record<Evidence, string> = { verified: "ev-v", author: "ev-a", inferred: "ev-i" };

function errText(e: unknown, source: "Modrinth" | "CurseForge"): string {
  if (e instanceof NetError) {
    if (e.kind === "offline") return `You're offline, and REWIND has nothing saved for this yet. ${source} needs an internet connection.`;
    if (e.kind === "auth") return source === "CurseForge" ? "CurseForge refused the API key (or none is set). Check it under Sources." : e.message;
    if (e.kind === "rate_limited") return `${source} asked REWIND to slow down. Try again in a minute.`;
    if (e.kind === "server") return `${source} is having problems right now (${e.status ?? "error"}). Try again later.`;
    if (e.kind === "not_found") return e.message;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Square pack icon: cached copy when saved, else the image from Modrinth/CurseForge (empty frame if it fails). */
function PackIcon({ p, size = "4rem" }: { p: AnyPack & { iconFile?: string }; size?: string }) {
  const [bad, setBad] = useState(false);
  const src = (p.iconFile ? artSrc(p.iconFile) : null) ?? p.iconUrl;
  return (
    <div className="picon" style={{ width: size, height: size }} aria-hidden="true">
      {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : <Icon name="mods" />}
    </div>
  );
}

function Labels({ p }: { p: AnyPack }) {
  const r = useMemo(() => readPack(p), [p]);
  if (!r.labels.length) return null;
  return (
    <div className="chips">
      {r.labels.slice(0, 5).map((l) => (
        <span key={l.label} className={"chip evc " + EV_CLASS[l.evidence]} title={`${l.why} — ${EVIDENCE_LABEL[l.evidence]}`}>
          {l.label}
        </span>
      ))}
    </div>
  );
}

export function ModsView({ nav, openProfile }: { nav: Nav; openProfile: string | null }) {
  const app = useApp();
  const { repo, marks, run } = app;
  const [tab, setTab] = useState<Tab>(openProfile ? "companion" : "packs");
  const [prefs, setPrefsState] = useState<PackPrefs>(DEFAULT_PACK_PREFS);
  const [compare, setCompareState] = useState<string[]>([]);
  const [details, setDetails] = useState<Map<string, PackDetail>>(new Map());
  const [hasCf, setHasCf] = useState(false);
  const [profileSel, setProfileSel] = useState<string | null>(openProfile);
  const [profilesCount, setProfilesCount] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    void loadPackPrefs(repo).then(setPrefsState);
    void loadCompare(repo).then(setCompareState);
    void cfKey(repo).then((k) => setHasCf(!!k));
    void repo.getSetting<Tab>("mods_tab", "packs").then((t) => !openProfile && setTab(t));
    void repo.loadModProfiles().then((ps) => setProfilesCount(ps.length));
  }, [repo, openProfile]);
  useEffect(() => {
    if (openProfile) {
      setTab("companion");
      setProfileSel(openProfile);
    }
  }, [openProfile]);
  const chooseTab = (t: Tab) => {
    setTab(t);
    void repo.setSetting("mods_tab", t).catch(() => undefined);
  };
  const setPrefs = (p: PackPrefs) => {
    setPrefsState(p);
    void run(() => savePackPrefs(repo, p));
  };
  const setCompare = (keys: string[]) => {
    setCompareState(keys);
    void saveCompare(repo, keys);
  };
  const toggleCompare = (key: string) => {
    if (compare.includes(key)) setCompare(compare.filter((k) => k !== key));
    else if (compare.length >= 4) app.toast("You can compare up to 4 packs. Remove one first.", true);
    else setCompare([...compare, key]);
  };
  const rememberDetail = useCallback((d: PackDetail) => setDetails((m) => new Map(m).set(d.key, d)), []);

  const savedPacks = useMemo(() => [...marks.values()].filter((m) => m.key.startsWith("mr:") || m.key.startsWith("cf:")), [marks]);

  const createProfile = async (p: AnyPack) => {
    const preset = presetById("minecraft");
    const mods = isDetail(p) && p.mods ? p.mods.map((m) => ({ name: m.title, url: `https://modrinth.com/mod/${m.slug}`, category: m.categories.filter((c) => c !== "library")[0] ?? "" })) : [];
    const id = await run(
      () =>
        repo.createModProfile({
          name: p.title.replace(/\s*\(TEST\)$/, "") || "Modpack",
          gameKey: "minecraft",
          gameTitle: "Minecraft (Java)",
          manager: "",
          packKey: p.key,
          checklist: preset.checklist,
          entries: mods,
        }),
      mods.length ? `Profile created with the pack's ${mods.length} Modrinth-listed mods.` : "Profile created.",
    );
    if (id) {
      setProfileSel(id);
      setProfilesCount((n) => n + 1);
      chooseTab("companion");
    }
  };

  return (
    <div className="mods">
      <div className="toolbar mods-tabs">
        <div className="seg" role="tablist" aria-label="Mods & Modpacks">
          <button role="tab" aria-pressed={tab === "packs"} aria-selected={tab === "packs"} onClick={() => chooseTab("packs")}>
            Modpacks
          </button>
          <button role="tab" aria-pressed={tab === "compare"} aria-selected={tab === "compare"} onClick={() => chooseTab("compare")}>
            Compare <span className="n">{compare.length}</span>
          </button>
          <button role="tab" aria-pressed={tab === "old"} aria-selected={tab === "old"} onClick={() => chooseTab("old")}>
            Your old list
          </button>
          <button role="tab" aria-pressed={tab === "companion"} aria-selected={tab === "companion"} onClick={() => chooseTab("companion")}>
            Modding companion <span className="n">{profilesCount}</span>
          </button>
        </div>
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => setSourcesOpen(true)} title="Where modpack data comes from">
          <span className="led ok"><i /></span> Modrinth
          <span className={"led " + (hasCf ? "ok" : "")}><i /></span> CurseForge{hasCf ? "" : " (off)"}
        </button>
      </div>
      {tab === "packs" && (
        <PacksTab
          prefs={prefs}
          setPrefs={setPrefs}
          hasCf={hasCf}
          compare={compare}
          toggleCompare={toggleCompare}
          details={details}
          rememberDetail={rememberDetail}
          savedCount={savedPacks.length}
          onCreateProfile={(p) => void createProfile(p)}
        />
      )}
      {tab === "compare" && <CompareTab keys={compare} setKeys={setCompare} prefs={prefs} details={details} rememberDetail={rememberDetail} />}
      {tab === "old" && <OldListTab prefs={prefs} compare={compare} toggleCompare={toggleCompare} details={details} rememberDetail={rememberDetail} onCreateProfile={(p) => void createProfile(p)} />}
      {tab === "companion" && <CompanionTab nav={nav} selected={profileSel} onSelect={setProfileSel} onCount={setProfilesCount} onOpenPack={() => chooseTab("packs")} />}
      {sourcesOpen && <SourcesDialog onClose={() => setSourcesOpen(false)} onChange={(v) => setHasCf(v)} />}
    </div>
  );
}

// ---------------- Modpacks ----------------

function PacksTab({
  prefs,
  setPrefs,
  hasCf,
  compare,
  toggleCompare,
  details,
  rememberDetail,
  savedCount,
  onCreateProfile,
}: {
  prefs: PackPrefs;
  setPrefs(p: PackPrefs): void;
  hasCf: boolean;
  compare: string[];
  toggleCompare(k: string): void;
  details: Map<string, PackDetail>;
  rememberDetail(d: PackDetail): void;
  savedCount: number;
  onCreateProfile(p: AnyPack): void;
}) {
  const { repo, marks } = useApp();
  const [browse, setBrowse] = useState<Browse>("suggested");
  const [s, setS] = useState<PackSearch>(DEFAULT_PACK_SEARCH);
  const [draft, setDraft] = useState("");
  const [useCf, setUseCf] = useState(false);
  const [sort, setSort] = useState<PSort>("fit");
  const [hits, setHits] = useState<PackSummary[]>([]);
  const [meta, setMeta] = useState<{ fetchedAt: string | null; offline: boolean; total: number }>({ fetchedAt: null, offline: false, total: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cfErr, setCfErr] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [editPrefs, setEditPrefs] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Load results for the current mode.
  useEffect(() => {
    let alive = true;
    setErr(null);
    setCfErr(null);
    if (browse === "saved") {
      setHits(
        [...marks.values()]
          .filter((m) => m.key.startsWith("mr:") || m.key.startsWith("cf:"))
          .map((m) => ({ ...(m.snapshot as unknown as PackSummary), key: m.key }))
          .filter((p) => p && p.title),
      );
      setMeta({ fetchedAt: null, offline: false, total: 0 });
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        if (browse === "suggested") {
          const r = await suggestedPacks(repo, prefs, nonce > 0);
          if (!alive) return;
          setHits(r.value);
          setMeta({ fetchedAt: r.fetchedAt, offline: r.offline, total: r.value.length });
        } else {
          const out: PackSummary[] = [];
          let fetchedAt: string | null = null;
          let offline = false;
          let total = 0;
          try {
            const r = await searchModrinth(repo, s, nonce > 0);
            out.push(...r.value.hits);
            fetchedAt = r.fetchedAt;
            offline = r.offline;
            total += r.value.total;
          } catch (e) {
            if (alive) setErr(errText(e, "Modrinth"));
          }
          if (useCf && hasCf) {
            try {
              const r = await searchCurseForge(repo, s, nonce > 0);
              out.push(...r.value.hits);
              total += r.value.total;
              fetchedAt ??= r.fetchedAt;
              if (r.offline) offline = true;
            } catch (e) {
              if (alive) setCfErr(errText(e, "CurseForge"));
            }
          }
          if (!alive) return;
          setHits(out);
          setMeta({ fetchedAt, offline, total });
        }
      } catch (e) {
        if (alive) {
          setErr(errText(e, "Modrinth"));
          setHits([]);
        }
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [browse, s, useCf, hasCf, prefs, repo, nonce, browse === "saved" ? marks : null]);

  // Check details (the mod list) for the best few, in the background, so the fit rests on evidence.
  const ranked = useMemo(() => {
    const withFit = hits.map((h) => {
      const d = details.get(h.key) ?? null;
      const p: AnyPack = d ?? h;
      return { p, fit: packFit(p, prefs) };
    });
    if (sort === "fit" || browse === "suggested") withFit.sort((a, b) => b.fit.score - a.fit.score || (b.p.downloads ?? 0) - (a.p.downloads ?? 0));
    else if (sort === "downloads") withFit.sort((a, b) => (b.p.downloads ?? 0) - (a.p.downloads ?? 0));
    else if (sort === "updated") withFit.sort((a, b) => (b.p.updated ?? "").localeCompare(a.p.updated ?? ""));
    return withFit;
  }, [hits, details, prefs, sort, browse]);

  useEffect(() => {
    if (browse === "saved") return;
    const todo = ranked.slice(0, 10).map((x) => x.p).filter((p) => !isDetail(p) && p.source === "modrinth");
    if (!todo.length) return;
    let alive = true;
    void (async () => {
      setChecking({ done: 0, total: todo.length });
      for (const [i, p] of todo.entries()) {
        if (!alive) return;
        try {
          const r = await packDetail(repo, p.key, { hint: p });
          if (alive) rememberDetail(r.value);
        } catch {
          /* leave it as a summary; the card says details aren't loaded */
        }
        if (alive) setChecking({ done: i + 1, total: todo.length });
      }
      if (alive) setChecking(null);
    })();
    return () => {
      alive = false;
      setChecking(null);
    };
    // Only when the result set changes, not on every detail that arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, browse]);

  const selected = ranked.find((x) => x.p.key === selKey)?.p ?? null;
  const runSearch = () => {
    setBrowse("search");
    setS({ ...s, query: draft, offset: 0 });
  };
  const toggleCat = (c: string) => {
    setBrowse("search");
    setS({ ...s, categories: s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c], offset: 0 });
  };

  return (
    <div className="packs">
      <aside className={"pk-filters" + (filtersOpen ? " open" : "")}>
        <button className="btn sm pk-ftoggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          Filters & sort {filtersOpen ? "▴" : "▾"}
        </button>
        <div className="seg" role="group" aria-label="Browse">
          <button aria-pressed={browse === "suggested"} onClick={() => setBrowse("suggested")}>Suggested</button>
          <button aria-pressed={browse === "search"} onClick={() => setBrowse("search")}>Search</button>
          <button aria-pressed={browse === "saved"} onClick={() => setBrowse("saved")}>
            Saved <span className="n">{savedCount}</span>
          </button>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <input className="field grow" type="search" placeholder="Search modpacks…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Search modpacks" />
          <button className="btn icon" type="submit" aria-label="Search">
            <Icon name="search" />
          </button>
        </form>
        <div className="psec">
          <span className="psec-h">Style (author's tags)</span>
          <div className="chips">
            {MODRINTH_PACK_CATEGORIES.map((c) => (
              <button key={c.id} className={"chip toggle" + (s.categories.includes(c.id) ? " on" : "")} aria-pressed={s.categories.includes(c.id)} onClick={() => toggleCat(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="psec">
          <span className="psec-h">Minecraft version</span>
          <select className="select" value={s.mcVersion} onChange={(e) => (setBrowse("search"), setS({ ...s, mcVersion: e.target.value, offset: 0 }))} aria-label="Minecraft version">
            <option value="">Any</option>
            {MC_VERSIONS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="psec">
          <span className="psec-h">Loader</span>
          <div className="seg">
            <button aria-pressed={!s.loader} onClick={() => (setBrowse("search"), setS({ ...s, loader: "", offset: 0 }))}>Any</button>
            {LOADERS.map((l) => (
              <button key={l} aria-pressed={s.loader === l} onClick={() => (setBrowse("search"), setS({ ...s, loader: l, offset: 0 }))}>
                {l === "neoforge" ? "NeoForge" : l[0].toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="psec">
          <span className="psec-h">Sources</span>
          <label className="check">
            <input type="checkbox" checked disabled /> Modrinth
          </label>
          <label className="check" title={hasCf ? "" : "Add a CurseForge API key under Sources (top right)"}>
            <input type="checkbox" checked={useCf && hasCf} disabled={!hasCf} onChange={(e) => setUseCf(e.target.checked)} /> CurseForge {hasCf ? "" : <span className="dim">(needs a key)</span>}
          </label>
        </div>
        <div className="psec">
          <span className="psec-h">Sort</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as PSort)} aria-label="Sort">
            <option value="fit">Best fit for you</option>
            <option value="relevance">Search relevance</option>
            <option value="downloads">Most downloaded</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
        <button className="btn sm" onClick={() => setEditPrefs(true)}>
          <Icon name="settings" /> What I want in a pack…
        </button>
        <div className="dim" style={{ fontSize: "var(--fs-xs)", lineHeight: 1.4 }}>
          {browse === "suggested"
            ? "Suggested: Modrinth's most-downloaded packs in the styles you like, re-ranked by fit for you. Downloads only decide what's considered, not the order."
            : "Facts come from Modrinth (and CurseForge if you add a key). Labels say whether they're from the pack's mod list, the author, or REWIND's estimate."}
        </div>
      </aside>

      <section className="pk-results" aria-label="Modpacks">
        <div className="pk-status">
          {busy ? (
            <span className="led ok blink"><i /> Loading…</span>
          ) : meta.fetchedAt ? (
            <span className={"led " + (meta.offline ? "warn" : "ok")}>
              <i /> {meta.offline ? `Offline — showing results saved ${fmtDate(meta.fetchedAt)}` : `${ranked.length} packs · checked ${agoText(Math.floor((Date.now() - Date.parse(meta.fetchedAt)) / 86_400_000))}`}
            </span>
          ) : browse === "saved" ? (
            <span className="dim">Your saved packs, from what REWIND kept when you saved them.</span>
          ) : null}
          {checking && (
            <span className="led info blink">
              <i /> checking mod lists {checking.done}/{checking.total}
            </span>
          )}
          <span className="grow" />
          {browse !== "saved" && (
            <button className="btn ghost sm" onClick={() => setNonce((n) => n + 1)} disabled={busy} title="Fetch again instead of using saved results">
              ↻ Refresh
            </button>
          )}
          {browse === "saved" && savedCount > 0 && <RefreshSaved onDone={rememberDetail} />}
        </div>
        {err && <div className="note bad">{err}</div>}
        {cfErr && <div className="note">{cfErr}</div>}
        {!busy && !err && ranked.length === 0 && (
          <div className="empty">
            {browse === "saved" ? (
              <>
                <b>No saved packs yet</b>
                <div>Use Interested, Want to try or Wishlist on any pack.</div>
              </>
            ) : (
              <>
                <b>No packs found</b>
                <div>Try fewer style filters, another Minecraft version, or a different search.</div>
              </>
            )}
          </div>
        )}
        <div className="pk-list">
          {ranked.map(({ p, fit }) => {
            const mark = marks.get(p.key);
            return (
              <div key={p.key} className={"pk-row" + (selKey === p.key ? " sel" : "")} role="button" tabIndex={0} aria-pressed={selKey === p.key} onClick={() => setSelKey(p.key)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelKey(p.key))}>
                <PackIcon p={p as AnyPack & { iconFile?: string }} />
                <div className="pk-main">
                  <div className="pk-title">
                    <b>{p.title}</b>
                    {p.author && <span className="dim"> by {p.author}</span>}
                    {isDetail(p) && p.unavailable && <span className="chip notown">unavailable</span>}
                  </div>
                  <div className="pk-desc">{p.description}</div>
                  <Labels p={p} />
                  <div className="pk-facts">
                    <span>{p.mcVersions.slice(0, 2).join(", ") || "MC ?"}</span>
                    <span>{p.loaders.join("/") || "loader ?"}</span>
                    <span title="Downloads (verified)">↓ {fmtN(p.downloads)}</span>
                    <span title="Last update">updated {agoText(p.updated ? Math.floor((Date.now() - Date.parse(p.updated)) / 86_400_000) : null)}</span>
                    <span className="dim">{PACK_SOURCE_LABEL[p.source]}</span>
                  </div>
                </div>
                <div className="pk-side">
                  <span className={"band b-" + fit.band} title={fit.partial ? "Based on the pack's tags only; its mod list isn't loaded yet" : "Based on the pack's mod list and details"}>
                    {fit.band === "excellent" ? "Excellent fit" : fit.band === "good" ? "Good fit" : fit.band === "fair" ? "Possible fit" : "Weak fit"}
                    {fit.partial ? "*" : ""}
                  </span>
                  {mark && <span className="chip">{MARK_LABEL[mark.kind]}</span>}
                  <label className="check" onClick={(e) => e.stopPropagation()} title="Add to the comparison (up to 4)">
                    <input type="checkbox" checked={compare.includes(p.key)} onChange={() => toggleCompare(p.key)} /> Compare
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        {browse === "search" && meta.total > s.offset + 20 && !busy && (
          <div className="row" style={{ justifyContent: "center" }}>
            {s.offset > 0 && <button className="btn sm" onClick={() => setS({ ...s, offset: Math.max(0, s.offset - 20) })}>← Previous</button>}
            <span className="dim mono" style={{ fontSize: "var(--fs-xs)" }}>{s.offset + 1}–{s.offset + ranked.length} of {meta.total}</span>
            <button className="btn sm" onClick={() => setS({ ...s, offset: s.offset + 20 })}>Next →</button>
          </div>
        )}
        <div className="dim attrib-s" style={{ fontSize: "var(--fs-xs)" }}>Modpack data from Modrinth{hasCf ? " and CurseForge" : ""}. * = judged from the pack's tags only, until its mod list is checked.</div>
      </section>

      {selected ? (
        <PackDetailPane
          key={selected.key}
          pack={selected}
          prefs={prefs}
          inCompare={compare.includes(selected.key)}
          onCompare={() => toggleCompare(selected.key)}
          onClose={() => setSelKey(null)}
          onLoaded={rememberDetail}
          onCreateProfile={onCreateProfile}
        />
      ) : (
        <aside className="detail pk-detail pk-empty">
          <div className="empty">
            <b>Pick a pack</b>
            <div>Details show what it is, how REWIND knows, and how it fits what you want.</div>
          </div>
        </aside>
      )}
      {editPrefs && <PackPrefsDialog prefs={prefs} onClose={() => setEditPrefs(false)} onSave={setPrefs} />}
    </div>
  );
}

function RefreshSaved({ onDone }: { onDone(d: PackDetail): void }) {
  const { repo, marks, run, toast, reloadAll } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <button
      className="btn ghost sm"
      disabled={!!busy}
      onClick={() =>
        void run(async () => {
          const saved = [...marks.values()].filter((m) => m.key.startsWith("mr:") || m.key.startsWith("cf:"));
          let gone = 0;
          let failed = 0;
          for (const [i, m] of saved.entries()) {
            setBusy(`${i + 1}/${saved.length}`);
            try {
              const r = await packDetail(repo, m.key, { force: true, fallback: (m.snapshot as unknown as PackDetail)?.fetchedAt ? (m.snapshot as unknown as PackDetail) : null });
              if (r.value.unavailable) gone++;
              await repo.updateMarkSnapshot(m.key, { ...(r.value as unknown as Record<string, unknown>), iconFile: m.snapshot.iconFile });
              onDone(r.value);
            } catch {
              failed++;
            }
          }
          setBusy(null);
          await reloadAll();
          toast(`Saved packs refreshed${gone ? `; ${gone} no longer available` : ""}${failed ? `; ${failed} couldn't be checked` : ""}.`, failed > 0);
        })
      }
    >
      {busy ? `Refreshing ${busy}` : "↻ Refresh saved packs"}
    </button>
  );
}

function PackAnswerBar({ pack }: { pack: AnyPack }) {
  const { marks, setMark, clearMark, toast } = useApp();
  const mark = marks.get(pack.key) ?? null;
  const answer = async (kind: MarkKind) => {
    if (mark?.kind === kind) {
      await clearMark(pack.key);
      return;
    }
    const snapshot: Record<string, unknown> = { ...(pack as unknown as Record<string, unknown>) };
    if (kind !== "not_interested" && pack.iconUrl) {
      try {
        const f = await net.download(pack.iconUrl, `${pack.key.replace(":", "-")}-icon`);
        snapshot.iconFile = f.file;
      } catch {
        /* offline: the icon link is kept */
      }
    }
    await setMark({ key: pack.key, kind, title: pack.title, snapshot });
    toast(`${MARK_LABEL[kind]}: ${pack.title}`);
  };
  return (
    <div className="answers" role="group" aria-label="Your answer">
      {MARKS.map((m) => (
        <button key={m.id} className={"btn sm ans a-" + m.id} aria-pressed={mark?.kind === m.id} onClick={() => void answer(m.id)} title={mark?.kind === m.id ? "Click again to clear" : m.hint}>
          {m.id === "played" ? "Played it" : m.short}
        </button>
      ))}
    </div>
  );
}

export function PackDetailPane({
  pack,
  prefs,
  inCompare,
  onCompare,
  onClose,
  onLoaded,
  onCreateProfile,
}: {
  pack: AnyPack;
  prefs: PackPrefs;
  inCompare: boolean;
  onCompare(): void;
  onClose(): void;
  onLoaded(d: PackDetail): void;
  onCreateProfile(p: AnyPack): void;
}) {
  const { repo } = useApp();
  const [d, setD] = useState<PackDetail | null>(isDetail(pack) ? pack : null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<{ fetchedAt: string; offline: boolean } | null>(null);
  const [modQ, setModQ] = useState("");
  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await packDetail(repo, pack.key, { hint: isDetail(pack) ? null : pack, force, fallback: isDetail(pack) ? pack : null });
        setD(r.value);
        setAsOf({ fetchedAt: r.fetchedAt, offline: r.offline });
        onLoaded(r.value);
      } catch (e) {
        setErr(errText(e, pack.source === "curseforge" ? "CurseForge" : "Modrinth"));
      } finally {
        setLoading(false);
      }
    },
    [repo, pack, onLoaded],
  );
  useEffect(() => {
    if (!isDetail(pack) || !pack.fetchedAt) void load();
    // Only once per pack (the key remounts this component).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const p: AnyPack = d ?? pack;
  const reading = useMemo(() => readPack(p), [p]);
  const fit = useMemo(() => packFit(p, prefs, new Date(), reading), [p, prefs, reading]);
  const mods = d?.mods ?? null;
  const shownMods = mods ? mods.filter((m) => !modQ || m.title.toLowerCase().includes(modQ.toLowerCase())) : [];
  const img = d?.gallery[0] ?? p.imageUrl;
  return (
    <aside className="detail pk-detail" aria-label={`Modpack: ${p.title}`}>
      <div className="dd-head">
        <span className="dtitle">{p.title}</span>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="dd-body">
        {img && <PackBanner url={img} />}
        <div className="row" style={{ gap: "0.7rem", alignItems: "flex-start", flexWrap: "nowrap" }}>
          <PackIcon p={p as AnyPack & { iconFile?: string }} size="4.5rem" />
          <div style={{ display: "grid", gap: "0.3rem", minWidth: 0 }}>
            <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
              {p.author ? `by ${p.author} · ` : ""}
              {PACK_SOURCE_LABEL[p.source]}
            </div>
            <div className="chips">
              <span className={"band b-" + fit.band}>{fit.band === "excellent" ? "Excellent fit" : fit.band === "good" ? "Good fit" : fit.band === "fair" ? "Possible fit" : "Weak fit"}</span>
              {reading.labels.map((l) => (
                <span key={l.label} className={"chip evc " + EV_CLASS[l.evidence]} title={`${l.why} — ${EVIDENCE_LABEL[l.evidence]}`}>
                  {l.label}
                </span>
              ))}
            </div>
          </div>
        </div>
        {d?.unavailable && <div className="note bad">{d.unavailable.reason} Showing what REWIND saved on {fmtDate(d.fetchedAt)}.</div>}
        {asOf?.offline && <div className="note">Offline — showing details saved {fmtDate(asOf.fetchedAt)}.</div>}
        {err && <div className="note bad">{err}</div>}
        <PackAnswerBar pack={p} />
        <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
          <button className="btn sm" aria-pressed={inCompare} onClick={onCompare}>
            {inCompare ? "✓ In comparison" : "Add to comparison"}
          </button>
          <button className="btn sm" onClick={() => void openExternal(p.pageUrl)}>
            Official page
          </button>
          <button className="btn sm" onClick={() => onCreateProfile(p)} title="A modding-companion profile for this pack, with its mod list">
            Plan a playthrough…
          </button>
          <button className="btn ghost sm" onClick={() => void load(true)} disabled={loading}>
            {loading ? "Loading…" : "↻ Reload details"}
          </button>
        </div>

        <div className="dd-why">
          <h3>Fit for you {fit.partial && <span className="dim">(from tags only — {loading ? "checking the mod list…" : "mod list not checked"})</span>}</h3>
          <ul className="pros">{fit.pros.length ? fit.pros.map((x) => <li key={x.text}>{x.text} <span className={"evm " + EV_CLASS[x.evidence]}>{EVIDENCE_LABEL[x.evidence]}</span></li>) : <li className="dim">Nothing that matches what you asked for</li>}</ul>
          <ul className="cons">{fit.cons.map((x) => <li key={x.text}>{x.text} <span className={"evm " + EV_CLASS[x.evidence]}>{EVIDENCE_LABEL[x.evidence]}</span></li>)}</ul>
          {fit.unknown.length > 0 && <div className="dim" style={{ fontSize: "var(--fs-s)", marginTop: "0.3rem" }}>Unknown: {fit.unknown.join(", ")}.</div>}
        </div>

        <dl className="kv">
          <dt>Progression</dt>
          <dd>{reading.progression} <span className="evm ev-i">REWIND's reading</span></dd>
          <dt>Quest book</dt>
          <dd>
            {reading.quests.state === "verified" ? "Yes" : reading.quests.state === "author" ? "The author says so" : reading.quests.state === "none_found" ? "None found" : "Unknown"}
            <span className="dim"> — {reading.quests.why}</span>
            {reading.quests.quality && <div className="dim">{reading.quests.quality}</div>}
            {reading.authorClaims.length > 0 && <div className="dim">Author's own claim: {reading.authorClaims.join(", ")}</div>}
          </dd>
          <dt>Difficulty</dt>
          <dd>
            {reading.difficulty.level === "beginner" ? "Beginner-friendly" : reading.difficulty.level[0].toUpperCase() + reading.difficulty.level.slice(1)}
            <span className="dim"> — {reading.difficulty.why}</span> <span className={"evm " + EV_CLASS[reading.difficulty.evidence]}>{EVIDENCE_LABEL[reading.difficulty.evidence]}</span>
          </dd>
          <dt>Complexity</dt>
          <dd>{reading.complexity.why}</dd>
          <dt>Performance</dt>
          <dd>{reading.performance.length ? reading.performance.join("; ") : <span className="dim">Nothing known</span>}</dd>
          <dt>Shaders</dt>
          <dd>{reading.shaders.why}</dd>
          <dt>Maintenance</dt>
          <dd className={reading.maintenance.state === "stale" || reading.maintenance.state === "archived" ? "bad-t" : ""}>{reading.maintenance.why}</dd>
          <dt>Minecraft</dt>
          <dd>{(d?.latest?.mcVersions ?? p.mcVersions).slice(0, 6).join(", ") || "unknown"}</dd>
          <dt>Loader</dt>
          <dd>{(d?.latest?.loaders ?? p.loaders).join(", ") || "unknown"}</dd>
          {d?.latest && (
            <>
              <dt>Pack version</dt>
              <dd>
                {d.latest.number} <span className="dim">({fmtDate(d.latest.date)}{d.latest.fileSize ? `, ${(d.latest.fileSize / 1_048_576).toFixed(1)} MB download` : ""})</span>
              </dd>
            </>
          )}
          <dt>Downloads</dt>
          <dd>{p.downloads?.toLocaleString("en-US") ?? "—"}{p.follows != null ? ` · ${p.follows.toLocaleString("en-US")} followers` : ""}</dd>
          {p.disclosures.length > 0 && (
            <>
              <dt>Disclosures</dt>
              <dd>The pack says it includes: {p.disclosures.map((x) => x.replace(/_/g, " ")).join(", ")}</dd>
            </>
          )}
        </dl>

        <div className="dd-sum">
          <h3>What's inside</h3>
          {d?.modsNote && <p className="dim" style={{ fontSize: "var(--fs-s)" }}>{d.modsNote}</p>}
          {reading.modsBy.length > 0 && (
            <div className="chips" style={{ margin: "0.3rem 0" }}>
              {reading.modsBy.map((m) => (
                <span key={m.label} className="chip">
                  {m.label} {m.count}
                </span>
              ))}
            </div>
          )}
          {mods && mods.length > 0 && (
            <>
              <input className="field" type="search" placeholder={`Filter ${mods.length} mods…`} value={modQ} onChange={(e) => setModQ(e.target.value)} aria-label="Filter mods" />
              <ul className="modlist">
                {shownMods.slice(0, 200).map((m) => (
                  <li key={m.id}>
                    <button className="linkish" onClick={() => void openExternal(`https://modrinth.com/mod/${encodeURIComponent(m.slug)}`)}>
                      {m.title}
                    </button>
                    <span className="dim"> {m.categories.filter((c) => c !== "library").slice(0, 2).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {d?.bodyText && (
          <details className="dd-sum">
            <summary>
              <h3 style={{ display: "inline" }}>The author's description</h3> <span className="dim">(their words, shown as plain text)</span>
            </summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{d.bodyText}</p>
          </details>
        )}
        {d && (
          <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
            {(["issues", "wiki", "source", "discord", "website"] as const).map((k) =>
              d.links[k] ? (
                <button key={k} className="btn ghost sm" onClick={() => void openExternal(d.links[k]!)}>
                  {k === "issues" ? "Issue tracker" : k === "wiki" ? "Wiki" : k === "source" ? "Source" : k === "discord" ? "Discord" : "Website"}
                </button>
              ) : null,
            )}
          </div>
        )}
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
          Data from {PACK_SOURCE_LABEL[p.source]}{d ? `, fetched ${fmtDate(d.fetchedAt)}` : ""}. REWIND never downloads or installs packs: use the official page or your launcher.
        </div>
      </div>
    </aside>
  );
}

function PackBanner({ url }: { url: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return (
    <div className="pk-banner">
      <img src={url} alt="" loading="lazy" onError={() => setBad(true)} />
    </div>
  );
}

// ---------------- Compare ----------------

function CompareTab({ keys, setKeys, prefs, details, rememberDetail }: { keys: string[]; setKeys(k: string[]): void; prefs: PackPrefs; details: Map<string, PackDetail>; rememberDetail(d: PackDetail): void }) {
  const { repo, marks } = useApp();
  const [packs, setPacks] = useState<Map<string, AnyPack>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errs, setErrs] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    for (const k of keys) {
      if (details.has(k) || packs.has(k) || loading.has(k)) continue;
      setLoading((s) => new Set(s).add(k));
      const snap = marks.get(k)?.snapshot as unknown as PackDetail | undefined;
      void packDetail(repo, k, { fallback: snap?.fetchedAt ? snap : null })
        .then((r) => {
          if (!alive) return;
          setPacks((m) => new Map(m).set(k, r.value));
          rememberDetail(r.value);
        })
        .catch(async (e) => {
          if (!alive) return;
          setErrs((m) => new Map(m).set(k, errText(e, k.startsWith("cf:") ? "CurseForge" : "Modrinth")));
          // Use whatever summary is cached so the row still lines up.
          const summary = (snap as unknown as PackSummary) ?? null;
          if (summary?.title) setPacks((m) => new Map(m).set(k, summary));
        })
        .finally(() => alive && setLoading((s) => {
          const n = new Set(s);
          n.delete(k);
          return n;
        }));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join()]);
  const list = keys.map((k) => details.get(k) ?? packs.get(k)).filter((x): x is AnyPack => !!x);
  if (!keys.length)
    return (
      <div className="content pad">
        <div className="empty">
          <b>Nothing to compare yet</b>
          <div>Tick “Compare” on up to four packs in Modpacks or Your old list.</div>
        </div>
      </div>
    );
  const { rows, fits } = compareRows(list, prefs);
  const verdict = compareVerdict(list, fits);
  return (
    <div className="content pad">
      <div className="panel">
        <div className="hd">
          Side by side <span className="count">{list.length} packs</span>
          <span className="right">
            <button className="btn ghost sm" onClick={() => setKeys([])}>Clear</button>
          </span>
        </div>
        <div className="bd" style={{ display: "grid", gap: "0.7rem" }}>
          {verdict && <div className="note info verdict">{verdict}</div>}
          {loading.size > 0 && <span className="led ok blink"><i /> Loading {loading.size} pack{loading.size === 1 ? "" : "s"}…</span>}
          {[...errs.entries()].map(([k, e]) => (
            <div key={k} className="note">{k}: {e}</div>
          ))}
          <div className="cmp-wrap">
            <table className="t cmp">
              <thead>
                <tr>
                  <th />
                  {list.map((p) => (
                    <th key={p.key}>
                      <div className="cmp-h">
                        <PackIcon p={p as AnyPack & { iconFile?: string }} size="2.6rem" />
                        <b>{p.title}</b>
                        <button className="btn ghost icon sm" onClick={() => setKeys(keys.filter((k) => k !== p.key))} aria-label={`Remove ${p.title}`}>
                          <Icon name="x" />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    {r.cells.map((c, i) => (
                      <td key={i} className={(c.good ? "good-t" : "") + (c.bad ? " bad-t" : "")}>
                        {r.label === "Official page" ? (
                          <button className="linkish" onClick={() => void openExternal(c.text)}>Open page</button>
                        ) : (
                          <>
                            {c.text}
                            {c.evidence && <span className={"evm " + EV_CLASS[c.evidence]}>{EVIDENCE_LABEL[c.evidence]}</span>}
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">Why it fits</th>
                  {fits.map((f, i) => (
                    <td key={i}>
                      <ul className="pros">{f.pros.slice(0, 3).map((x) => <li key={x.text}>{x.text}</li>)}</ul>
                      <ul className="cons">{f.cons.slice(0, 2).map((x) => <li key={x.text}>{x.text}</li>)}</ul>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>Quest quality is never rated: REWIND can only confirm a quest book exists. “Unknown” means the source doesn't say.</div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Old list ----------------

function OldListTab({ prefs, compare, toggleCompare, details, rememberDetail, onCreateProfile }: { prefs: PackPrefs; compare: string[]; toggleCompare(k: string): void; details: Map<string, PackDetail>; rememberDetail(d: PackDetail): void; onCreateProfile(p: AnyPack): void }) {
  const { repo } = useApp();
  const [rows, setRows] = useState<LegacyMatch[] | null>(null);
  const [asOf, setAsOf] = useState<{ fetchedAt: string; offline: boolean } | null>(null);
  const [prog, setProg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const check = async (force: boolean) => {
    setErr(null);
    try {
      const r = await matchLegacy(repo, force, (d, t) => setProg(`${d}/${t}`));
      setRows(r.value);
      setAsOf({ fetchedAt: r.fetchedAt, offline: r.offline });
    } catch (e) {
      setErr(errText(e, "Modrinth"));
    } finally {
      setProg(null);
    }
  };
  useEffect(() => {
    void repo.getCacheEntry<LegacyMatch[]>("legacy_packs_v1").then((c) => {
      if (c) {
        setRows(c.value);
        setAsOf({ fetchedAt: c.fetchedAt, offline: false });
      }
    });
  }, [repo]);
  const selected = rows?.find((r) => r.pack?.key === sel)?.pack ?? null;
  const found = rows?.filter((r) => r.pack).length ?? 0;
  return (
    <div className="packs old">
      <section className="pk-results wide">
        <div className="panel">
          <div className="hd">
            Your old REWIND modpack list <span className="count">36</span>
            <span className="right">
              <button className="btn sm" onClick={() => void check(!!rows)} disabled={!!prog}>
                {prog ? `Checking ${prog}…` : rows ? "↻ Check again" : "Check them on Modrinth"}
              </button>
            </span>
          </div>
          <div className="bd" style={{ display: "grid", gap: "0.5rem" }}>
            <div className="note info" style={{ fontSize: "var(--fs-s)" }}>
              The descriptions are the old app's own notes. REWIND looks each name up on Modrinth and only links an exact name match, so a pack that lives only on CurseForge or the FTB app shows as “not found”.
              {asOf && ` Checked ${fmtDate(asOf.fetchedAt)}: ${found} of ${rows?.length ?? 0} found.`}
            </div>
            {err && <div className="note bad">{err}</div>}
          </div>
          <div className="bd flush list">
            {(rows ?? []).map((r) => {
              const p = r.pack ? details.get(r.pack.key) ?? r.pack : null;
              const fit = p ? packFit(p, prefs) : null;
              return (
                <div className={"li oldrow" + (p && sel === p.key ? " sel" : "")} key={r.id}>
                  {p ? <PackIcon p={p} size="2.6rem" /> : <div className="picon" style={{ width: "2.6rem", height: "2.6rem" }} />}
                  <div className="grow" style={{ display: "grid", gap: "0.15rem" }}>
                    <b>{r.name}</b>
                    <span className="dim" style={{ fontSize: "var(--fs-s)" }}>Old note: {r.blurb}</span>
                    {p ? (
                      <span style={{ fontSize: "var(--fs-s)" }}>
                        Modrinth: <b>{p.title}</b> · {p.mcVersions.slice(0, 2).join(", ")} · {p.loaders.join("/")} · ↓ {fmtN(p.downloads)} · updated {agoText(p.updated ? Math.floor((Date.now() - Date.parse(p.updated)) / 86_400_000) : null)}
                      </span>
                    ) : (
                      <span className="dim" style={{ fontSize: "var(--fs-s)" }}>Not found on Modrinth under this name.</span>
                    )}
                  </div>
                  {fit && <span className={"band b-" + fit.band}>{fit.band}</span>}
                  {p && (
                    <>
                      <label className="check" title="Add to the comparison">
                        <input type="checkbox" checked={compare.includes(p.key)} onChange={() => toggleCompare(p.key)} /> Compare
                      </label>
                      <button className="btn sm" onClick={() => setSel(p.key)}>Details</button>
                    </>
                  )}
                </div>
              );
            })}
            {!rows && (
              <div className="empty" style={{ margin: "0.8rem" }}>
                Not checked yet. Press “Check them on Modrinth” (about 36 quick lookups; needs internet).
              </div>
            )}
          </div>
        </div>
      </section>
      {selected && (
        <PackDetailPane key={selected.key} pack={details.get(selected.key) ?? selected} prefs={prefs} inCompare={compare.includes(selected.key)} onCompare={() => toggleCompare(selected.key)} onClose={() => setSel(null)} onLoaded={rememberDetail} onCreateProfile={onCreateProfile} />
      )}
    </div>
  );
}

// ---------------- dialogs ----------------

function PackPrefsDialog({ prefs, onClose, onSave }: { prefs: PackPrefs; onClose(): void; onSave(p: PackPrefs): void }) {
  const [p, setP] = useState<PackPrefs>(prefs);
  const signals = Object.keys(p.weights) as Signal[];
  return (
    <Modal
      title="What I want in a modpack"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => setP(DEFAULT_PACK_PREFS)}>Reset to defaults</button>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => (onSave(p), onClose())}>Save</button>
        </>
      }
    >
      <p style={{ margin: 0 }} className="dim">
        Start from your profile (quest books, clear progression, exploration, cozy building, shaders; no aimless kitchen sinks). Slide left to avoid, right to want. Popularity is capped so it can never outweigh the rest.
      </p>
      <div className="prefsliders">
        {signals.map((k) => (
          <label key={k} className="pslider">
            <span>{SIGNAL_LABEL[k]}</span>
            <input type="range" min={-1} max={1} step={0.1} value={p.weights[k]} onChange={(e) => setP({ ...p, weights: { ...p.weights, [k]: Number(e.target.value) } })} aria-label={SIGNAL_LABEL[k]} />
            <span className="num dim">{p.weights[k] > 0.05 ? "want" : p.weights[k] < -0.05 ? "avoid" : "—"} {p.weights[k].toFixed(1)}</span>
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: "0.8rem" }}>
        <label className="row" style={{ gap: "0.4rem" }}>
          Prefer Minecraft
          <select className="select" value={p.mcVersion} onChange={(e) => setP({ ...p, mcVersion: e.target.value })}>
            <option value="">any version</option>
            {MC_VERSIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="row" style={{ gap: "0.4rem" }}>
          Loader
          <select className="select" value={p.loader} onChange={(e) => setP({ ...p, loader: e.target.value })}>
            <option value="">any</option>
            {LOADERS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  );
}

function SourcesDialog({ onClose, onChange }: { onClose(): void; onChange(hasKey: boolean): void }) {
  const { repo, run, toast } = useApp();
  const [key, setKey] = useState("");
  const [has, setHas] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  useEffect(() => {
    void repo.getSecret(CF_SECRET).then((k) => setHas(!!k));
  }, [repo]);
  return (
    <Modal title="Where modpack data comes from" wide onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="conn-sec">
        <b>Modrinth</b> <span className="led ok"><i /> on, no key needed</span>
        <p className="dim" style={{ margin: "0.3rem 0 0" }}>
          Modrinth's public API: search, pack details, versions and the list of Modrinth-hosted mods inside each pack. REWIND identifies itself and stays far below Modrinth's limit of 300 requests a minute.
        </p>
      </div>
      <div className="conn-sec">
        <b>CurseForge</b> <span className={"led " + (has ? "ok" : "")}><i /> {has ? "key saved" : "off"}</span>
        <p className="dim" style={{ margin: "0.3rem 0" }}>
          CurseForge's API needs a key, which you get from CurseForge's developer console (console.curseforge.com) after accepting their terms. REWIND can't include one for you. Without it, CurseForge packs simply don't appear. Its API also doesn't list the mods inside a pack, so CurseForge packs are judged on their tags and description only.
        </p>
        <div className="row">
          <input className="field grow" type="password" placeholder={has ? "•••••• (saved — paste a new one to replace)" : "Paste your CurseForge API key"} value={key} onChange={(e) => setKey(e.target.value)} aria-label="CurseForge API key" autoComplete="off" />
          <button
            className="btn"
            disabled={!key.trim()}
            onClick={() =>
              void run(async () => {
                setTest("Testing…");
                try {
                  await searchCurseForgeWithKey(key.trim());
                  await repo.setSecret(CF_SECRET, key.trim());
                  setHas(true);
                  onChange(true);
                  setKey("");
                  setTest("Key works. Saved on this PC only (never in backups).");
                } catch (e) {
                  setTest(errText(e, "CurseForge"));
                }
              })
            }
          >
            Test & save
          </button>
          {has && (
            <button
              className="btn danger"
              onClick={() =>
                void run(async () => {
                  await repo.setSecret(CF_SECRET, null);
                  setHas(false);
                  onChange(false);
                  setTest(null);
                  toast("CurseForge key removed.");
                })
              }
            >
              Remove
            </button>
          )}
        </div>
        {test && <div className="note info" style={{ fontSize: "var(--fs-s)" }}>{test}</div>}
      </div>
      <div className="dim" style={{ fontSize: "var(--fs-s)" }}>FTB packs that are only on the FTB app aren't covered: FTB has no documented public API for this.</div>
    </Modal>
  );
}

async function searchCurseForgeWithKey(key: string): Promise<void> {
  await searchCurse(net, key, { ...DEFAULT_PACK_SEARCH, query: "skyblock" }, new Map());
}
