# REWIND 5

A personal gaming companion for Windows 11: your game library across Steam, Epic Games, Ubisoft
Connect and Rockstar; what you're playing and what's next; an explainable "what should I play now";
and Discover shelves built from your own taste. Near-black, monochrome, quiet.

Everything lives in one SQLite file on your PC. No account, no server, no telemetry. It works offline;
it only goes online when you ask it to look something up.

- **Install:** [docs/INSTALL.md](docs/INSTALL.md) (download, checksum, upgrading from REWIND 4, where data lives)
- **What changed in 5.0:** [docs/release-notes/v5.0.0.md](docs/release-notes/v5.0.0.md)
- **Feature checklist, what was verified and known limitations:** [docs/V5-REPORT.md](docs/V5-REPORT.md)
- **Design system:** [docs/DESIGN.md](docs/DESIGN.md)

## The six sections

| Section | Answers | Highlights |
| --- | --- | --- |
| Home | What am I playing, and what's next? | Currently playing (Launch, Pause, Complete), tonight's suggestion, Continue, Up Next, recent activity. Empty sections are hidden. |
| Library | What do I own, and how is it organised? | Big search; status, source/launcher, genre, playtime, rating and favourite filters; More filters; list or covers; details drawer; Add game; Check-up; combine duplicates. |
| Discover | What interesting games are there for me? | One shelf at a time, covers only, reasons on request, Outside my library, Saved and Hidden, series kept in order. |
| Pick for me | What should I play right now? | What you feel like → time and energy → one game: Play, Skip or Another. More preferences folded away. |
| Activity | What have I played and finished? | One day-by-day feed with sources; correct or delete sessions in place. |
| Settings | Customise and manage | General, Connections (Steam, Epic, Ubisoft, Rockstar, IGDB), Recommendations, Data and backups, Keyboard and about. |

## Launchers: what works

| | Find games | Owned but not installed | Start a game | Playtime |
| --- | --- | --- | --- | --- |
| Steam | Steam client files on this PC, or the official Web API with your free key | Yes (Web API) | `steam://rungameid/…` | Yes, Steam's own figure |
| Epic Games | Install records in `ProgramData\Epic\EpicGamesLauncher\Data\Manifests` | No — no public library API | `com.epicgames.launcher://apps/…?action=launch` | No — not stored on your PC |
| Ubisoft Connect | Install list in the Windows registry | No — no public library API | `uplay://launch/<id>/0` | No |
| Rockstar Games | Rockstar entries in the Windows registry | No | No documented link; start it from the launcher | No |

REWIND reads Epic, Ubisoft and Rockstar data only after you allow it (Settings → Connections), shows a
preview before adding anything, never signs in to a launcher, never asks for a launcher password and
never changes launcher files. A game on several launchers is one entry; editions stay separate unless
you combine them. Playtime is never invented.

## Your data

- `%APPDATA%\dev.tommy.rewind\rewind.sqlite3` — your library. Safety copies in `…\backups\`, artwork in
  `…\artwork\`. Uninstalling doesn't delete them.
- Before a database upgrade REWIND copies the whole file to `backups\rewind-before-v<new>-from-v<old>-<time>.sqlite3`;
  if the copy fails, the upgrade doesn't run. Imports, restores, launcher imports and combining entries
  save a JSON safety copy first.
- Backups (Settings → Data and backups) contain everything except API keys. Backups from every earlier
  version restore.
- Steam and IGDB keys are encrypted with Windows DPAPI.
- REWIND 4's modding profiles and saved modpacks are kept, with a Markdown export.

### What happened to the old app's data

| Old artifact | REWIND 2 |
|---|---|
| 405 library rows | 404 games. One row literally titled "game" looks like a spreadsheet header and is skipped by default; the import screen lets you tick it back in. |
| Hours played | "Imported playtime", labelled with its source. Never treated as proof you liked a game. |
| Built-in length/tag table | Kept, but shown as `est.` (unverified). Your own hours always win; Settings can hide the estimates. |
| Long/short slot queues | The **Up Next** collection, same order (KOTOR → KOTOR II → Kenshi). |
| Finished games / dates / ratings / notes / hidden | Completed + date + playthrough / 1–5 stars / notes / "Never suggest". |
| "Solo only" setting | Profile: "Don't suggest games that need other players". |
| Activity log | Activity, with original timestamps, marked `[old REWIND]`. |
| Series lists and modpack list | Bundled for Phases 3 and 4. |
| Rerolls limits, penalties, awards | Not carried over (by design: no punishments, no streaks). |
| Everything else in the old state | Stored verbatim in settings (`legacy_rewind_state`) so nothing is lost. |

## Getting the installer

Releases are built by GitHub Actions on a GitHub-hosted Windows machine (**Actions → Windows build**).
A run builds the app, the NSIS and MSI installers and a portable exe, and checks them:

1. unit and integration tests (`npm test`, real SQLite) and the strict TypeScript check,
2. Rust tests on Windows (launch-link allow-list, DPAPI round trip, database snapshot),
3. a start-up check: the built portable exe is started on a REWIND 4 library and must upgrade it to
   schema 5 with a safety copy, keep all games and personal fields, encrypt the stored key and quit
   (`tools/smoke.ts`),
4. silent install of the NSIS installer, start of the installed app, silent uninstall that must keep the
   library; silent install and uninstall of the MSI,
5. SHA-256 checksums.

Pushing a tag `vX.Y.Z` (matching the app version) publishes a GitHub Release with
`REWIND-setup-x64.exe`, `REWIND-x64.msi`, `REWIND-portable-x64.exe` and `SHA256SUMS.txt` — only if every
check above passed. Logs of every run are kept on the `ci-logs` branch.

## Building on your own PC (optional)

Requires Node.js 22.18+, Rust (stable, MSVC) and the Visual Studio C++ Build Tools.

```powershell
npm install
npm test             # unit and integration tests on real SQLite
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev    # run with hot reload
npm run tauri build  # installers in src-tauri\target\release\bundle\
```

## Project layout

```
src/
  db/           SQLite schema + migrations, repository (all queries), optional DPAPI sealer
  backup/       backup format: export, validate, preview, merge/replace
  migrate/      old-artifact importer + bundled reference data
  launchers/    Epic / Ubisoft / Rockstar parsing, import plan, launch links
  lib/          types, filters and sorting, library check-up, combining entries
  meta/         Steam and IGDB clients, title matching, Steam import, details sync
  rec/          recommendation engine, taste model, explanations
  discover/     Discover shelves, IGDB "outside my library", answers
  legacy/       REWIND 4 modding records (read-only) and their Markdown export
  platform/     everything that talks to Windows (Tauri commands, dialogs)
  state/ views/ ui/ styles/
src-tauri/      Rust: SQLite bridge, file I/O, safety snapshots, HTTPS allow-list client and artwork cache,
                Steam client reader, launcher scan + launch (launchers.rs), DPAPI (secrets.rs)
tests/          node:test suites against node:sqlite (the same SQL as the app)
tools/          CI start-up check (smoke.ts), icon generator, browser preview build + dev SQL bridge
docs/           design system, install guide, release notes, v5 report
```

## Testing record

See [docs/V5-REPORT.md](docs/V5-REPORT.md) for REWIND 5.

### Earlier versions

Automated (run here and in CI):
- 102 tests (101 run here; 1 needs the real export file). Phase 4 adds: every Discover shelf explaining
  itself and using only your library without IGDB; short-game thresholds and no endless games; "Not
  interested" hiding for 90 then 180 days and coming back with a note, and counting as a pass; answers never
  changing your library; Want to try lifting a game in Pick for me; IGDB candidates with owned games
  recognised by Steam id, adult themes filtered, no prices or scores in what's shown, scope settings; wrong
  IGDB keys and offline giving clear messages; bad saved settings falling back; Modrinth search / details /
  mod lists against response shapes recorded from the live API (`tools/probe-mods.mjs`), quest books only
  claimed from the mod list, plain-text descriptions (no HTML or scripts), unsafe links dropped, kitchen
  sinks without quests, stale / archived packs, disclosures, downloads never beating fit; Modrinth 503,
  offline, 404 and a 429 that waits as told; CurseForge without a key, with a wrong key and with a key
  (invented fake), comparison rows and verdict; mod-list parsing for MO2, plugins.txt, links and plain
  lines; presets; the whole modding profile lifecycle; the v3 → v4 upgrade keeping every game, note and key;
  backups with answers and profiles (replace, merge, and older backups without the new sections).
- 77 tests (76 run here; 1 needs the real export file). Phase 3 adds: VDF and Steam client file
  parsing, Steam store / search / owned-games / IGDB parsers against response shapes recorded from the
  live endpoints, title matching (editions match, sequels never do, ties go to review), the Steam import
  plan (exact / edition / new / tools / conflicts, idempotent re-import, ratings / notes / status untouched,
  playtime kept separately and never lowered), the full sync against an invented fake Steam + IGDB
  (batching, review queue, your choices and removed tags respected, offline mid-run keeps progress, cancel,
  rate-limit retry, wrong IGDB secret, missing art re-downloaded, duplicate-title guard), backups that
  include links but never keys, the v2 → v3 upgrade keeping every game / note / queue, and the
  recommendation touchstones re-run with Steam data loaded (plus store tags counting less than a 1★
  rating, and the developer explanation).
- 2.5: 48 tests (47 run here; 1 needs the real export file). v2.5 adds: session intents (continue / resume /
  new / replay / different), sequels waiting for unfinished earlier games, KOTOR at 37h of ~40h counted
  as unfinished, concentration-heavy RPGs on low-energy nights, old saved sessions read correctly, Up Next
  review being suggestion-only with remembered dismissals, series follow-ups, "continue where you left
  off" skipping endless and multiplayer games, statuses / dates / logged sessions persisting, and moving
  and reordering between collections.
- Phase 2: KOTOR II follow-up order, souls-likes for
  mastery (but not 161h Elden Ring as a "new" pick), gentle games for cozy/low energy, Kenshi / Project
  Zomboid / Skyrim deprioritised but never banned, burnout not poisoning story RPGs, playtime ≠ enjoyment,
  passes fading after their cooldown, determinism, multiplayer exclusion, and a v1 → v2 database upgrade
  that keeps every game, note and setting.
- Phase 1 tests: schema migrations (incl. idempotence and concurrent init), the artifact importer (status
  mapping, header-row detection, Up Next order, sources, re-import merge, rollback on failure),
  edits/lengths/tags/collections, search/filter/sort, backup round trip (replace and merge), backup validation.
- The importer was also run against the real 405-row export: 404 imported, 1 skipped, 157 matched the
  legacy table, Up Next order preserved.
- The UI was driven in headless Chromium against real SQLite: full first-run import, edits persisting
  across reload, bulk edit, context menu, collections, backup export → merge restore → replace restore,
  delete with confirmation, all five themes, 1080p, 1440p, 960×600 minimum, 150% and 200% scaling,
  no layout overflow, no console errors. For 2.5 every screen was re-checked at 1920×1080, 2560×1440,
  2560×1440 at 150% and 200%, 1920×1080 at 125%, and 960×600, plus Spacious density at 130% text,
  the Up Next review buttons, drag and keyboard reordering, and logging a session. For 3.0 the browser
  preview answers network calls from the invented fake services (images say "TEST ART"): import from
  "Steam on this PC" with your real 404-game export, sync details and covers, review queue, grid S/M/L,
  list thumbnails, details banner and About, offline sync and offline import, and the same screen sizes
  and scaling with no overflow. For 4.0, with your real 404-game export and the invented fake IGDB /
  Modrinth / CurseForge: every Discover shelf, Look beyond my library, keyboard answers, Saved and Hidden,
  Discover settings, suggested packs with mod-list checks, pack details, comparison, your old list, creating
  a modding profile and pasting an MO2 list, at 2560×1440, 1920×1080, 2560×1440 at 150% and 200%, and
  960×600; and offline (saved IGDB and Modrinth results shown with their date, a clear message where
  nothing is saved). No console errors.

Not yet verified (needs a Windows PC and the internet): the compiled installer itself, first launch under
WebView2, native Open/Save dialogs, window-position memory across your two monitors, SmartScreen
behaviour, real Steam / IGDB requests from the app (the endpoints themselves were checked from GitHub's
servers), reading your real Steam folder, and cached covers loading through the asset protocol. For 4.0:
real IGDB discovery queries (built from IGDB's documentation; CI has no Twitch keys), real CurseForge
requests (needs a key; built from CurseForge's documentation), and Modrinth / IGDB images loading inside
the app (the live Modrinth API itself was checked from GitHub's servers).
