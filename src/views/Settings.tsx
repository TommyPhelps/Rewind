// Settings answers one question: how do I customise and manage REWIND?

import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import type { GamingProfile } from "../lib/types.ts";
import { DEFAULT_PROFILE } from "../data/profileDefaults.ts";
import { backupFileName, createBackup } from "../backup/backup.ts";
import { pickJsonFile, saveJsonFile, saveTextFile } from "../platform/native.ts";
import { SCHEMA_VERSION } from "../db/schema.ts";
import { hasLegacyModding, legacyModdingMarkdown, loadLegacyModding, type LegacyModding } from "../legacy/export.ts";
import { usePickerSettings } from "../state/recs.ts";
import { DEFAULT_WEIGHTS, type Weights } from "../rec/engine.ts";
import { ConnectionsTab } from "./Connections.tsx";
import { TasteView } from "./Taste.tsx";

export type SettingsTab = "general" | "connections" | "recommendations" | "data" | "about";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "connections", label: "Connections" },
  { id: "recommendations", label: "Recommendations" },
  { id: "data", label: "Data and backups" },
  { id: "about", label: "Keyboard and about" },
];

export function SettingsView({ nav, tab, onTab }: { nav: Nav; tab: SettingsTab; onTab(t: SettingsTab): void }) {
  return (
    <div className="page">
      <div className="page-in">
        <header className="page-head">
          <h1>Settings</h1>
        </header>
        <div className="settings">
          <nav className="tabs-v" role="tablist" aria-label="Settings sections">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label} style={{ minWidth: 0 }}>
            {tab === "general" && <General />}
            {tab === "connections" && <ConnectionsTab nav={nav} />}
            {tab === "recommendations" && <Recommendations nav={nav} />}
            {tab === "data" && <Data nav={nav} />}
            {tab === "about" && <About />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-l">
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </div>
      <div className="stack tight" style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function General() {
  const { settings, setSettings } = useApp();
  return (
    <div>
      <Row label="Text size" hint="On top of Windows display scaling">
        <div className="seg" role="radiogroup" aria-label="Text size">
          {[0.9, 1, 1.1, 1.2, 1.3].map((s) => (
            <button key={s} role="radio" aria-checked={settings.uiScale === s} aria-pressed={settings.uiScale === s} onClick={() => setSettings({ uiScale: s })}>
              {Math.round(s * 100)}%
            </button>
          ))}
        </div>
      </Row>
      <Row label="Sidebar" hint="Ctrl+B">
        <label className="check">
          <input type="checkbox" checked={settings.sidebarCollapsed} onChange={(e) => setSettings({ sidebarCollapsed: e.target.checked })} /> Show icons only
        </label>
      </Row>
      <Row label="Library">
        <label className="check">
          <input type="checkbox" checked={settings.listCovers} onChange={(e) => setSettings({ listCovers: e.target.checked })} /> Small covers in the list view
        </label>
      </Row>
      <Row label="Length estimates" hint="From the old REWIND table">
        <label className="check">
          <input type="checkbox" checked={settings.useUnverifiedLengths} onChange={(e) => setSettings({ useUnverifiedLengths: e.target.checked })} /> Use them when I haven't entered my own length
        </label>
        <span className="meta">They're marked “estimate” wherever they appear. Turning this off hides them; nothing is deleted.</span>
      </Row>
    </div>
  );
}

function Recommendations({ nav }: { nav: Nav }) {
  const { profile, setProfile, confirm } = useApp();
  const ps = usePickerSettings();
  const setList = (k: keyof Omit<GamingProfile, "excludeMultiplayerDependent">, list: string[]) => void setProfile({ ...profile, [k]: list });
  return (
    <div className="stack loose">
      <section>
        <div className="sec-h">
          <h2>Your gaming profile</h2>
          <div className="acts">
            <button
              className="btn sm ghost"
              onClick={async () => {
                if (await confirm({ title: "Reset profile", body: <p>Put the profile back to the starting lists?</p>, ok: "Reset" })) void setProfile(DEFAULT_PROFILE);
              }}
            >
              Reset
            </button>
          </div>
        </div>
        <p className="sec-sub">A starting point, not a rule. Pick for me and Discover read it; change it whenever your tastes change.</p>
        <div className="grid2">
          <ListEditor title="Games I've enjoyed" items={profile.enjoyed} onChange={(l) => setList("enjoyed", l)} />
          <ListEditor title="Struggled to stay interested in" items={profile.struggled} onChange={(l) => setList("struggled", l)} />
          <ListEditor title="I value" items={profile.values} onChange={(l) => setList("values", l)} />
          <ListEditor title="I often dislike" items={profile.dislikes} onChange={(l) => setList("dislikes", l)} />
        </div>
        <label className="check" style={{ marginTop: "var(--s4)" }}>
          <input type="checkbox" checked={profile.excludeMultiplayerDependent} onChange={(e) => void setProfile({ ...profile, excludeMultiplayerDependent: e.target.checked })} /> Never suggest games that need other players
        </label>
      </section>

      <section>
        <div className="sec-h">
          <h2>What REWIND has learned</h2>
        </div>
        <TasteView nav={nav} />
      </section>

      <details className="drawer-adv">
        <summary>
          <Icon name="settings" /> Advanced: how much each factor counts
        </summary>
        <div className="body">{ps.loaded && <Weights weights={ps.weights} onChange={ps.setWeights} />}</div>
      </details>
    </div>
  );
}

const WEIGHT_LABELS: Record<string, string> = {
  mood: "Matches the mood you picked",
  energyTime: "Fits your energy and time",
  commitment: "Fits the commitment you want",
  taste: "Matches your taste and history",
  structure: "Structure and difficulty",
  variety: "Variety (recent skips, series order)",
  library: "Owned and in-progress games",
};

function Weights({ weights, onChange }: { weights: Weights; onChange(w: Weights): void }) {
  const keys = Object.keys(weights) as (keyof Weights)[];
  return (
    <div className="stack">
      {keys.map((k) => (
        <label key={k} className="pref" style={{ gridTemplateColumns: "minmax(12rem, 18rem) minmax(0, 1fr) 4rem" }}>
          <span>{WEIGHT_LABELS[k] ?? k}</span>
          <input type="range" min={0} max={2} step={0.25} value={weights[k]} onChange={(e) => onChange({ ...weights, [k]: Number(e.target.value) })} />
          <span className="num muted">{weights[k] === 0 ? "off" : `${weights[k].toFixed(2)}×`}</span>
        </label>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => onChange(DEFAULT_WEIGHTS)}>
          Reset to defaults
        </button>
        <span className="meta">Only the relative sizes matter. “Avoid” choices always count fully.</span>
      </div>
    </div>
  );
}

function Data({ nav }: { nav: Nav }) {
  const { repo, info, run, games, toast, gameById } = useApp();
  const [legacy, setLegacy] = useState<LegacyModding | null>(null);
  useEffect(() => {
    void loadLegacyModding(repo).then(setLegacy).catch(() => setLegacy(null));
  }, [repo]);

  const exportBackup = async () => {
    const path = await run(async () => {
      const b = await createBackup(repo, info?.version ?? "?");
      return saveJsonFile("Save REWIND backup", backupFileName(), JSON.stringify(b, null, 1));
    });
    if (path) toast(`Backup saved: ${path}`);
  };
  const importFile = async () => {
    const f = await run(() => pickJsonFile("Choose a REWIND backup"));
    if (f) nav.startImport(f);
  };
  const exportLegacy = async () => {
    if (!legacy) return;
    const md = legacyModdingMarkdown(legacy, (id) => (id ? gameById.get(id)?.title ?? null : null), new Date());
    const path = await run(() => saveTextFile("Save modding records", "rewind-modding-records.md", md, "Markdown", "md"));
    if (path) toast(`Saved: ${path}`);
  };

  return (
    <div>
      <Row label="Backup" hint="Everything except API keys">
        <div className="row">
          <button className="btn primary" onClick={() => void exportBackup()}>
            <Icon name="download" /> Save a backup…
          </button>
          <button className="btn" onClick={() => void importFile()}>
            <Icon name="upload" /> Restore or import…
          </button>
        </div>
        <span className="meta">Restore accepts backups from every REWIND version and the old artifact's export. You always see a preview first, and a safety copy is saved before anything changes.</span>
      </Row>
      <Row label="Where your data is">
        <dl className="kv">
          <dt>Games</dt>
          <dd className="num">{games.length}</dd>
          <dt>Database</dt>
          <dd className="mono">{info?.dbPath}</dd>
          <dt>Safety copies</dt>
          <dd className="mono">{info?.backupsDir}</dd>
          <dt>Schema</dt>
          <dd className="num">version {SCHEMA_VERSION}</dd>
        </dl>
        <span className="meta">Before an upgrade changes the database, a full copy of the file is saved to the safety copies folder. Copies made before imports and restores are kept there too (the newest 20).</span>
      </Row>
      {legacy && hasLegacyModding(legacy) && (
        <Row label="Modding records" hint="From REWIND 4">
          <span className="dim">
            REWIND 5 no longer has a Mods & Modpacks section. Your {legacy.profiles.length} modding profile{legacy.profiles.length === 1 ? "" : "s"}
            {legacy.packs.length ? ` and ${legacy.packs.length} saved modpack${legacy.packs.length === 1 ? "" : "s"}` : ""} are still kept in the database and in backups. Save
            them as a readable file:
          </span>
          <button className="btn" style={{ justifySelf: "start" }} onClick={() => void exportLegacy()}>
            <Icon name="download" /> Export modding records (Markdown)…
          </button>
        </Row>
      )}
    </div>
  );
}

function About() {
  const { info } = useApp();
  const keys: [string, string][] = [
    ["Ctrl+1 … Ctrl+6", "Go to a section"],
    ["Ctrl+F", "Search the library"],
    ["Ctrl+N", "Add a game"],
    ["Ctrl+B", "Icons-only sidebar"],
    ["↑ ↓ Home End", "Move through the game list (Shift extends the selection)"],
    ["Enter", "Open the selected game"],
    ["Ctrl+A", "Select every game in the list"],
    ["Delete", "Remove the selected games (asks first)"],
    ["Esc", "Close a dialog, menu or the details panel"],
    ["Alt+↑ / Alt+↓", "Reorder Up Next"],
    ["← →", "Discover: move between games"],
    ["I T W P N", "Discover: Interested, Want to try, Wishlist, Already played, Not interested"],
  ];
  return (
    <div>
      <Row label="Keyboard">
        <dl className="kv">
          {keys.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>
                <span className="kbd">{k}</span>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <span className="meta">Right-click a game for status, favourite, Up Next and remove.</span>
      </Row>
      <Row label="REWIND" hint={`Version ${info?.version ?? "?"}`}>
        <span className="dim">
          Everything is stored in one file on this PC. No account, no telemetry, no ads. REWIND only goes online when you ask it to: a Steam import, a details lookup,
          adding a game, or looking beyond your library in Discover. Those send only what's needed to look something up — a game's name or id — never your notes,
          ratings or library. Launchers are only started through their own links, so sign-in and DRM are untouched.
        </span>
      </Row>
    </div>
  );
}

function ListEditor({ title, items, onChange }: { title: string; items: string[]; onChange(l: string[]): void }) {
  const [v, setV] = useState("");
  return (
    <div className="prof">
      <h3>{title}</h3>
      <div className="chips">
        {items.map((it) => (
          <span key={it} className="chip user">
            {it}
            <button aria-label={`Remove ${it}`} onClick={() => onChange(items.filter((x) => x !== it))}>
              <Icon name="x" />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="meta">Empty</span>}
      </div>
      <form
        className="row nowrap"
        onSubmit={(e) => {
          e.preventDefault();
          const t = v.trim();
          if (t && !items.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...items, t]);
          setV("");
        }}
      >
        <input className="field sm grow" placeholder="Add…" value={v} onChange={(e) => setV(e.target.value)} aria-label={`Add to ${title}`} />
        <button className="btn sm" type="submit">
          Add
        </button>
      </form>
    </div>
  );
}
