# REWIND 2.0

A personal gaming companion for Windows 11: your game library, what you're playing next, and (in later
phases) an explainable "what should I play tonight" picker, Minecraft modpack discovery and a modding
companion. Dark early-2000s look, five themes, a sibling to Nook Tracker.

Everything lives in one SQLite file on your PC. No account, no server, no telemetry. It works offline.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Inspect the old REWIND artifact, its data, and the build options | Done |
| 1 | Tauri app, SQLite, dark Y2K design system, library import, navigation, Windows build | **Built (this version)** |
| 2 | Pick for me (session picker, explainable scores), Friction Check, sessions, stats | Planned |
| 3 | Steam import, metadata and cover art, series navigator, advanced collections | Planned |
| 4 | Minecraft modpack discovery, modding companion, Discover, low-stimulation mode | Planned |
| 5 | Backup completion, performance, polish | Planned |

Screens for later phases are shown in the sidebar with a `P2`/`P4` tag and open a placeholder that
says what's coming. Nothing in them is simulated.

### What Phase 1 does

- **Library**: virtualized table and cover grid (hundreds of games stay fast), search across titles,
  tags and notes, filters (status, length, ownership, tag, collection, favorites, solo only), sorting,
  multi-select (Ctrl/Shift click, Shift+arrows, Ctrl+A), right-click menu, bulk status / ownership /
  favorite / tag / collection / remove.
- **Game details panel** (resizable): status, rating (1–5), favorite, ownership, installed, players,
  endless, notes (autosave), tags, collections, your own lengths (main / main+extras / completionist),
  imported playtime, dates, a real per-game history.
- **Home**: now playing, Up Next with Start buttons, library at a glance, data-quality counts, recent activity.
- **Collections**: create, rename, describe, reorder, remove.
- **Activity**: a log of things that actually happened (status changes, ratings, imports, restores).
- **Settings**: 5 dark themes (Midnight 2003 default, Nook Classic, CRT Amber, Gothic Library, Monochrome),
  text size, editable gaming profile, backup and restore.
- **Import from the old artifact** with a full preview, then one all-or-nothing transaction.
- **Backups**: versioned JSON, validation, preview, *merge* (never overwrites) or *replace* (confirmed),
  and an automatic safety snapshot before every import or restore.
- **Windows**: remembers window size/position, pulls the window back if a monitor disappears, minimum
  size 960×600, works with display scaling, keyboard shortcuts (see Settings → Keyboard).

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

## Installing on Windows 11

1. Download the build (see *Getting the installer* below). You get:
   - `REWIND_2.0.0_x64-setup.exe` — normal installer (installs for your user, no admin needed)
   - `REWIND_2.0.0_x64_en-US.msi` — MSI installer, if you prefer
   - `REWIND_2.0.0_x64_portable.exe` — runs without installing (uses Windows 11's built-in WebView2)
   - `SHA256SUMS.txt` — checksums
2. Run the setup `.exe`.
3. On first launch choose **Import from the REWIND artifact** and pick `rewind-artifact-export-2026-10-16.json`
   (or a fresh one from the old app's *Download backup* button). Check the preview, press **Import**.

### About the SmartScreen warning

The app isn't code-signed (a signing certificate costs money every year), so Windows may show
"Windows protected your PC" the first time. That warning means "Microsoft doesn't recognise this
publisher yet", not "this is malware". Before clicking **More info → Run anyway**, check:

- the file came from **your own** GitHub repository's Actions run or Release, and
- its SHA-256 matches `SHA256SUMS.txt` from the same run
  (PowerShell: `Get-FileHash .\REWIND_2.0.0_x64-setup.exe`).

If either doesn't match, don't run it. Never bypass SmartScreen for files from anywhere else.

### Where your data lives

`%APPDATA%\dev.tommy.rewind\rewind.sqlite3`, with safety snapshots in
`%APPDATA%\dev.tommy.rewind\backups\`. Uninstalling the app does not delete them. Settings shows the exact paths.

## Getting the installer (GitHub Actions)

The installer is compiled on a free GitHub-hosted Windows machine:

1. Create a repository on GitHub (private is fine) and push this folder to it.
2. Open the repo's **Actions** tab → **Windows build**. It runs on every push (or press *Run workflow*).
3. When it finishes (about 10–20 minutes the first time, faster after), open the run and download the
   **REWIND-2.0.0-windows-x64** artifact (a zip containing the files above).
4. Optional: push a tag like `v2.0.0` and the workflow also publishes a **Release** with the files
   attached, which is easier to download.

The first run also uploads a **lockfiles** artifact (`package-lock.json`, `src-tauri/Cargo.lock`).
Commit those two files so later builds use exactly the same dependency versions.

Cost: free for public repos; private repos on GitHub Free get 2,000 Actions minutes a month and
Windows minutes count double, so one build uses roughly 20–40 of them.

## Building on your own PC (optional)

Requires Node.js 22.18+, Rust (stable, MSVC) and the Visual Studio C++ Build Tools.

```powershell
npm install
npm test            # schema, migration, backup and filter tests on real SQLite
npm run tauri dev   # run with hot reload
npm run tauri build # installers in src-tauri\target\release\bundle\
```

## Project layout

```
src/
  db/           SQLite schema + migrations, repository (all queries)
  migrate/      old-artifact importer + its bundled reference data
  backup/       REWIND 2 backup format: export, validate, preview, merge/replace
  lib/          types, title matching, filtering/sorting/length rules
  platform/     everything that talks to Windows (Tauri commands, dialogs, window placement)
  state/        app store (React context)
  views/ ui/    screens and components
  styles/       themes.css (5 skins as CSS variables), app.css
src-tauri/      Rust: rusqlite bridge with real transactions, file I/O for chosen files, safety snapshots
tests/          node:test suites against node:sqlite (same SQL as the app)
tools/          icon generator, browser preview build + dev SQL bridge (development only)
```

## Testing record

Automated (run here and in CI):
- 15 tests: schema migrations (incl. idempotence and concurrent init), the artifact importer (status
  mapping, header-row detection, Up Next order, sources, re-import merge, rollback on failure),
  edits/lengths/tags/collections, search/filter/sort, backup round trip (replace and merge), backup validation.
- The importer was also run against the real 405-row export: 404 imported, 1 skipped, 157 matched the
  legacy table, Up Next order preserved.
- The UI was driven in headless Chromium against real SQLite: full first-run import, edits persisting
  across reload, bulk edit, context menu, collections, backup export → merge restore → replace restore,
  delete with confirmation, all five themes, 1080p, 1440p, 960×600 minimum, 150% and 200% scaling,
  no layout overflow, no console errors.

Not yet verified (needs a Windows PC): the compiled installer itself, first launch under WebView2,
native Open/Save dialogs, window-position memory across your two monitors, and SmartScreen behaviour.
