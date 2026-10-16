import { useMemo, useState } from "react";
import { LEGACY_MODPACKS } from "../migrate/legacyReference.ts";

const PLANS: Record<"discover" | "mods", { title: string; phase: number; points: string[] }> = {
  discover: {
    title: "Discover",
    phase: 4,
    points: [
      "Hidden gems, classics, short masterpieces, PS2-era picks and games similar to your favourites.",
      "Games you already own come first; games you don't own are clearly labelled.",
      "No invented prices or review scores: store pages open in your browser.",
    ],
  },
  mods: {
    title: "Mods & Modpacks",
    phase: 4,
    points: [
      "Minecraft modpack discovery through Modrinth and CurseForge's official APIs, with verified facts kept apart from descriptions.",
      "A modding companion: profiles, mod managers, notes and backups.",
      "Nothing is ever installed, downloaded or changed without your say-so.",
    ],
  },
};

/** Screens that aren't built yet. They say so plainly and never simulate results. */
export function PlannedView({ view }: { view: "discover" | "mods" }) {
  const p = PLANS[view];
  return (
    <div className="content pad">
      <div className="planned-grid">
        <section className="panel">
          <div className="hd">
            {p.title}
            <span className="right">
              <span className="led warn"><i /> not built yet · planned for phase {p.phase}</span>
            </span>
          </div>
          <div className="bd" style={{ display: "grid", gap: "0.6rem" }}>
            <p style={{ margin: 0 }}>This screen is a placeholder. Nothing here is simulated or made up. What it will do:</p>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "0.35rem" }}>
              {p.points.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {view === "discover" && (
              <p className="dim" style={{ margin: 0, fontSize: "var(--fs-s)" }}>
                Until then, Pick for me covers the games already in your library, and Series follow-ups (in Collections) lists sequels you own.
              </p>
            )}
          </div>
        </section>
        {view === "mods" && <LegacyModpacks />}
      </div>
    </div>
  );
}

function LegacyModpacks() {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? LEGACY_MODPACKS.filter((m) => (m.name + " " + m.tags.join(" ") + " " + m.blurb).toLowerCase().includes(t)) : LEGACY_MODPACKS;
  }, [q]);
  return (
    <section className="panel" aria-labelledby="h-mp">
      <div className="hd" id="h-mp">
        Your old REWIND modpack list <span className="count">{LEGACY_MODPACKS.length}</span>
        <span className="right">
          <input className="field" type="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter modpacks" />
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: "0.6rem" }}>
        <div className="note" style={{ fontSize: "var(--fs-s)" }}>
          Saved from the old app, shown as-is. Descriptions are the old app's own notes, not checked against Modrinth or CurseForge, so versions,
          loaders and sizes may be out of date.
        </div>
        {list.length === 0 ? (
          <div className="empty"><b>No matches</b></div>
        ) : (
          <div className="mp-list">
            {list.map((m) => (
              <div className="mp" key={m.id}>
                <b>{m.name}</b>
                <span className="d">{m.blurb}</span>
                <div className="chips">
                  {m.tags.map((t) => (
                    <span className="chip" key={t} style={{ fontSize: "var(--fs-xs)" }}>{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
