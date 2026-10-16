// "Add to library" for a game found outside your library. Only ever runs when you press
// the button; Discover never adds anything by itself.

import type { Repo } from "../db/repo.ts";
import type { Game, Ownership, Status } from "../lib/types.ts";
import { applyStatements } from "../meta/apply.ts";
import type { ArtFile } from "../meta/http.ts";
import { blankMeta } from "../meta/sync.ts";
import { extMeta, type ExtGame } from "./beyond.ts";

export async function addExtToLibrary(
  repo: Repo,
  e: ExtGame,
  opts: { ownership: Ownership; status: Status; download?: (url: string, name: string) => Promise<ArtFile> },
): Promise<Game> {
  const games = await repo.loadGames();
  // A Steam app id can belong to only one game.
  const steamTaken = e.steamAppId != null && games.some((g) => g.steamAppId === e.steamAppId);
  const g = await repo.addGame({
    title: e.name,
    ownership: opts.ownership,
    status: opts.status,
    steamAppId: steamTaken ? undefined : e.steamAppId,
    storefront: e.steamAppId ? "Steam" : undefined,
  });
  const data = extMeta(e);
  // Cover: downloaded now if possible (best effort), otherwise on the next details sync.
  if (opts.download && data.art.cover) {
    try {
      const f = await opts.download(data.art.cover.url, `igdb-${e.igdbId}-cover`);
      data.art.cover = { ...data.art.cover, file: f.file };
    } catch {
      /* offline or blocked: the placeholder stays until the next sync */
    }
  }
  const now = new Date().toISOString();
  await repo.saveMeta([blankMeta(g.id, "igdb", { providerId: String(e.igdbId), status: "linked", method: "discover", confidence: 1, data, fetchedAt: now })], [
    repo.eventStatement("game_added_from_discover", g.id, { title: e.name, ownership: opts.ownership, igdb: e.igdbId }),
  ]);
  const fresh = (await repo.loadGame(g.id))!;
  await repo.batch(applyStatements(fresh));
  return (await repo.loadGame(g.id))!;
}
