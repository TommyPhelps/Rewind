// Links that start a game through its own launcher. REWIND never runs game executables
// directly and never bypasses a launcher: it hands one of these links to Windows, and the
// launcher (Steam, Epic, Ubisoft Connect) takes over, including DRM and sign-in.

import type { Game, GameSource, LauncherId } from "../lib/types.ts";

export const steamLaunch = (appid: number | string) => `steam://rungameid/${String(appid).replace(/\D/g, "")}`;

/** Epic's launcher link: namespace:catalogItemId:appName, URL-encoded as the launcher's own shortcuts do. */
export function epicLaunch(namespace: string, catalogItemId: string, appName: string): string | null {
  const ok = (s: string) => /^[A-Za-z0-9._-]+$/.test(s);
  if (!ok(namespace) || !ok(catalogItemId) || !ok(appName)) return null;
  return `com.epicgames.launcher://apps/${namespace}%3A${catalogItemId}%3A${appName}?action=launch&silent=true`;
}

export const ubisoftLaunch = (id: string) => (/^\d+$/.test(id) ? `uplay://launch/${id}/0` : null);

/** The same checks the desktop app makes before opening a launch link. */
export function isAllowedLaunch(uri: string): boolean {
  return (
    /^steam:\/\/rungameid\/\d+$/.test(uri) ||
    /^com\.epicgames\.launcher:\/\/apps\/[A-Za-z0-9._-]+%3A[A-Za-z0-9._-]+%3A[A-Za-z0-9._-]+\?action=launch&silent=true$/.test(uri) ||
    /^uplay:\/\/launch\/\d+\/0$/.test(uri)
  );
}

const PREF: LauncherId[] = ["steam", "epic", "ubisoft", "gog", "rockstar", "other"];

export interface LaunchTarget {
  uri: string;
  source: LauncherId;
  installed: boolean | null;
}

/**
 * The best way to start a game: an installed copy first, then any launcher link REWIND
 * knows. A Steam app id counts only when the game is actually on Steam for you (a Steam
 * import or a launcher scan said so), not just because metadata was linked.
 */
export function launchTarget(g: Pick<Game, "sources">): LaunchTarget | null {
  const cands = g.sources
    .filter((s): s is GameSource & { launch: string } => !!s.launch && isAllowedLaunch(s.launch))
    .sort((a, b) => Number(b.installed === true) - Number(a.installed === true) || PREF.indexOf(a.source) - PREF.indexOf(b.source));
  const best = cands[0];
  return best ? { uri: best.launch, source: best.source, installed: best.installed } : null;
}
