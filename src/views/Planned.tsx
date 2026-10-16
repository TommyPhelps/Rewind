
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
      "Your old REWIND modpack list is already saved and will appear here.",
      "A modding companion: profiles, mod managers, notes and backups. Nothing is installed or changed without your say-so.",
    ],
  },
};

export function PlannedView({ view }: { view: "discover" | "mods" }) {
  const p = PLANS[view];
  return (
    <div className="content pad">
      <div className="stack" style={{ maxWidth: "44rem" }}>
        <div className="panel">
          <div className="hd">
            {p.title}
            <span className="right">
              <span className="led warn"><i /> planned for phase {p.phase}</span>
            </span>
          </div>
          <div className="bd" style={{ display: "grid", gap: "0.6rem" }}>
            <p style={{ margin: 0 }}>
              Not built yet. This screen is a placeholder, so nothing here is simulated or made up. What it will do:
            </p>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "0.35rem" }}>
              {p.points.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
