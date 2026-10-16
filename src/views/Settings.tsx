import { useState } from "react";
import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon } from "../ui/Icon.tsx";
import { THEMES, type GamingProfile } from "../lib/types.ts";
import { DEFAULT_PROFILE } from "../data/profileDefaults.ts";
import { backupFileName, createBackup } from "../backup/backup.ts";
import { pickJsonFile, saveJsonFile } from "../platform/native.ts";
import { SCHEMA_VERSION } from "../db/schema.ts";

const SWATCH: Record<string, string[]> = {
  midnight: ["#060a17", "#0d1530", "#1e3270", "#a9c1ef", "#d6dcea"],
  classic: ["#0a0c0b", "#121614", "#203028", "#86c9a0", "#cdd5cf"],
  amber: ["#090705", "#120e09", "#2c200d", "#ffb52e", "#f2b75a"],
  gothic: ["#100b0a", "#1a1311", "#521a25", "#cfab62", "#e6d9c6"],
  mono: ["#000000", "#0e0e0e", "#262626", "#ffffff", "#a6a6a6"],
};

export function SettingsView({ nav }: { nav: Nav }) {
  const { settings, setSettings, profile, setProfile, repo, info, run, games, confirm, toast } = useApp();

  const exportBackup = async () => {
    const path = await run(async () => {
      const b = await createBackup(repo, info?.version ?? "?");
      return saveJsonFile("Save REWIND backup", backupFileName(), JSON.stringify(b, null, 1));
    });
    if (path) toast(`Backup saved: ${path}`);
  };
  const importFile = async () => {
    const f = await run(() => pickJsonFile("Choose a REWIND backup (REWIND 2 or the old artifact)"));
    if (f) nav.startImport(f);
  };
  const setList = (k: keyof Omit<GamingProfile, "excludeMultiplayerDependent">, list: string[]) => void setProfile({ ...profile, [k]: list });

  return (
    <div className="content pad">
      <div className="stack" style={{ maxWidth: "62rem" }}>
        <div className="panel">
          <div className="hd">Appearance</div>
          <div className="bd" style={{ display: "grid", gap: "0.9rem" }}>
            <div className="themes" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.id} className="theme-card" role="radio" aria-checked={settings.theme === t.id} aria-pressed={settings.theme === t.id} onClick={() => setSettings({ theme: t.id })}>
                  <span className="sw">
                    {SWATCH[t.id].map((c) => (
                      <span key={c} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="nm">
                    {t.label} {t.id === "midnight" && <span className="dim">(default)</span>}
                    <small>{t.note}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="row">
              <span className="mono dim" style={{ fontSize: "0.8rem", width: "8rem" }}>Text size</span>
              <div className="seg" role="group" aria-label="Text size">
                {[0.9, 1, 1.1, 1.2, 1.3].map((s) => (
                  <button key={s} aria-pressed={settings.uiScale === s} onClick={() => setSettings({ uiScale: s })}>
                    {Math.round(s * 100)}%
                  </button>
                ))}
              </div>
              <span className="dim" style={{ fontSize: "0.82rem" }}>On top of Windows display scaling.</span>
            </div>
            <div className="row">
              <span className="mono dim" style={{ fontSize: "0.8rem", width: "8rem" }}>Sidebar</span>
              <label className="check">
                <input type="checkbox" checked={settings.sidebarCollapsed} onChange={(e) => setSettings({ sidebarCollapsed: e.target.checked })} />
                Collapsed <span className="kbd">Ctrl+B</span>
              </label>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="hd">
            Gaming profile
            <span className="right">
              <button
                className="btn sm"
                onClick={async () => {
                  if (await confirm({ title: "Reset profile", body: "Put the profile back to the starting list from your brief?", ok: "Reset" })) void setProfile(DEFAULT_PROFILE);
                }}
              >
                Reset to defaults
              </button>
            </span>
          </div>
          <div className="bd" style={{ display: "grid", gap: "1rem" }}>
            <div className="dim" style={{ fontSize: "0.88rem" }}>
              A starting point, not a rule. Pick for me (Phase 2) reads this, and you can change any of it whenever your tastes change.
            </div>
            <div className="grid2">
              <ListEditor title="Games I've enjoyed" items={profile.enjoyed} onChange={(l) => setList("enjoyed", l)} />
              <ListEditor title="Struggled to stay interested in" items={profile.struggled} onChange={(l) => setList("struggled", l)} />
              <ListEditor title="I value" items={profile.values} onChange={(l) => setList("values", l)} />
              <ListEditor title="I often dislike" items={profile.dislikes} onChange={(l) => setList("dislikes", l)} />
            </div>
            <label className="check">
              <input type="checkbox" checked={profile.excludeMultiplayerDependent} onChange={(e) => void setProfile({ ...profile, excludeMultiplayerDependent: e.target.checked })} />
              Don't suggest games that need other players
            </label>
          </div>
        </div>

        <div className="panel">
          <div className="hd">Library data</div>
          <div className="bd" style={{ display: "grid", gap: "0.5rem" }}>
            <label className="check">
              <input type="checkbox" checked={settings.useUnverifiedLengths} onChange={(e) => setSettings({ useUnverifiedLengths: e.target.checked })} />
              Show the old REWIND table's length estimates (marked <span className="badge est">est.</span>) when I haven't entered my own
            </label>
            <div className="dim" style={{ fontSize: "0.85rem" }}>
              Turn this off to see only lengths you've confirmed. The estimates stay stored either way.
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="hd">Data &amp; backup</div>
          <div className="bd" style={{ display: "grid", gap: "0.8rem" }}>
            <div className="row">
              <button className="btn primary" onClick={exportBackup}>
                <Icon name="download" /> Save backup…
              </button>
              <button className="btn" onClick={importFile}>
                <Icon name="upload" /> Import / restore…
              </button>
              <span className="dim" style={{ fontSize: "0.85rem" }}>
                Restore accepts REWIND 2 backups and the old artifact's backup. You always get a preview first.
              </span>
            </div>
            <dl className="kv">
              <dt>Games</dt>
              <dd className="num">{games.length}</dd>
              <dt>Database</dt>
              <dd className="mono" style={{ fontSize: "0.8rem" }}>{info?.dbPath}</dd>
              <dt>Safety snapshots</dt>
              <dd className="mono" style={{ fontSize: "0.8rem" }}>{info?.backupsDir} <span className="dim">(newest 20, saved before every import or restore)</span></dd>
              <dt>Schema</dt>
              <dd className="num">v{SCHEMA_VERSION}</dd>
            </dl>
          </div>
        </div>

        <div className="panel">
          <div className="hd">Keyboard</div>
          <div className="bd">
            <dl className="kv">
              <dt><span className="kbd">Ctrl+1</span> … <span className="kbd">Ctrl+8</span></dt><dd>Go to a section</dd>
              <dt><span className="kbd">Ctrl+F</span></dt><dd>Search the library</dd>
              <dt><span className="kbd">Ctrl+B</span></dt><dd>Collapse or expand the sidebar</dd>
              <dt><span className="kbd">↑ ↓ Home End</span></dt><dd>Move through the game list (Shift extends the selection)</dd>
              <dt><span className="kbd">Ctrl+A</span></dt><dd>Select every game in the current list</dd>
              <dt><span className="kbd">Delete</span></dt><dd>Remove selected games (asks first)</dd>
              <dt><span className="kbd">Esc</span></dt><dd>Close a dialog, menu or the details panel</dd>
              <dt>Right-click</dt><dd>Status, favorite, collections and remove for a game or selection</dd>
            </dl>
          </div>
        </div>

        <div className="panel">
          <div className="hd">About &amp; privacy</div>
          <div className="bd" style={{ display: "grid", gap: "0.4rem", fontSize: "0.9rem" }}>
            <div>REWIND {info?.version} — everything is stored in a SQLite file on this PC. No account, no telemetry, no ads, no tracking.</div>
            <div className="dim">
              The internet is only used when you open a store or HowLongToBeat link. Later phases add optional metadata and artwork lookups, which
              only send the specific game being looked up.
            </div>
          </div>
        </div>
      </div>
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
              <Icon name="x" className="ico" />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="dim" style={{ fontSize: "0.85rem" }}>Empty</span>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const t = v.trim();
          if (t && !items.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...items, t]);
          setV("");
        }}
      >
        <input className="field grow" placeholder="add…" value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn sm" type="submit">Add</button>
      </form>
    </div>
  );
}
