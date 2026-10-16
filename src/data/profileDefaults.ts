import type { GamingProfile } from "../lib/types.ts";

/** Starting point taken from Tommy's brief. Fully editable in Settings; "Reset" restores this. */
export const DEFAULT_PROFILE: GamingProfile = {
  enjoyed: [
    "The Witcher 3",
    "Elden Ring",
    "Dark Souls",
    "Persona 4 Golden",
    "Star Wars: Knights of the Old Republic",
    "Portal",
    "LEGO Star Wars",
  ],
  values: [
    "Strong gameplay",
    "Meaningful progression",
    "Immersive worlds",
    "Interesting characters",
    "Mechanical mastery",
    "Discovery",
    "Freedom with understandable goals",
    "Single-player experiences",
    "Games that reward sustained engagement",
    "Distinctive atmosphere",
    "Interesting systems",
    "Well-designed quest progression",
  ],
  dislikes: [
    "Excessive hand-holding",
    "Aimless sandbox gameplay",
    "Endless survival busywork",
    "Repetitive grinding",
    "Huge checklists",
    "Overly complicated setup",
    "Replaying introductory sections repeatedly",
    "Unnecessary interruptions",
    "Games that feel like obligations",
    "Poorly explained progression",
  ],
  struggled: [
    "Kenshi",
    "Project Zomboid",
    "Skyrim (after many restarts)",
    "Cyberpunk 2077 (after extensive replaying)",
    "Some large survival sandboxes",
  ],
  excludeMultiplayerDependent: true,
};
