import { Icon } from "../ui/Icon.tsx";

const PLANS: Record<"pick" | "discover" | "mods", { title: string; phase: number; points: string[] }> = {
  pick: {
    title: "Pick for me",
    phase: 2,
    points: [
      "Session-based picker: what experience you want, energy, time available, commitment, and what to avoid. Every question optional.",
      "Deterministic, explainable scores with adjustable weights: each suggestion says why it fits and why it might not.",
      "Friction Check: 'not in the mood', take a break, show something different. Repeated passes lower a game temporarily, never permanently.",
      "Unlimited rerolls. No streaks, no penalties, no daily goals.",
    ],
  },
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

export function PlannedView({ view }: { view: "pick" | "discover" | "mods" }) {
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
            {view === "pick" && (
              <div className="note info" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <Icon name="alert" />
                <span>Until then your old REWIND artifact still works as before. Your Up Next list was carried over and is on Home.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
