# REWIND 2.0

A personal gaming companion for Windows 11: your game library, what you're playing next, and (in later
phases) an explainable "what should I play tonight" picker, Minecraft modpack discovery and a modding
companion. Dark early-2000s look, five themes, a sibling to Nook Tracker.

Everything lives in one SQLite file on your PC. No account, no server, no telemetry. It works offline.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Inspect the old REWIND artifact, its data, and the build options | Done |
| 1 | Tauri app, SQLite, dark Y2K design system, library import, navigation, Windows build | Built (v2.0.0) |
| 2 | Recommendation engine: Pick for me, Friction Check, taste profile, presets | **Built (v2.1.0)** |
| 3 | Steam import, metadata and cover art, series navigator, advanced collections | Planned |
| 4 | Minecraft modpack discovery, modding companion, Discover, low-stimulation mode | Planned |
| 5 | Backup completion, performance, polish | Planned |

Screens for later phases are shown in the sidebar with a `P4` tag and open a placeholder that
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

### What Phase 2 adds: Pick for me

A deterministic recommender (no AI service, no internet) that ranks the games you own for *this* session
and says why.

- **Optional session settings**: experience (immersive, story, mastery, cozy, exploration, building,
  strategy, nostalgic, unusual), energy, time available, commitment, structure, difficulty, things to
  avoid, continue vs. start new. Nothing is required; the last session is remembered.
- **Presets**: five built in (Low-energy evening, Story night, Challenge me, Quick break, Weekend deep dive)
  plus your own.
- **Explanations**: every suggestion lists why it fits and why it might not, a fit band (not a fake
  percentage), confidence, commitment estimate, and where each piece of data came from. "Show scoring"
  reveals each factor.
- **Friction Check**: Ready to play / Something completely different / Not in the mood (take a break,
  revisit later). No streaks, goals or penalties.
- **Passing**: "Not this one" asks why (optional). The game is shown less for a while and the note says
  until when; it is never banned. Reasons like "too grindy" nudge your preferences and fade after 60 days.
  Unlimited "Next".
- **Surprise me**: one click, picked among strong matches (seeded, so it's repeatable).
- **Your taste**: what REWIND believes and why: tags you lean towards/away from, trait preferences with
  their sources, how your profile lines are read, drop reasons, and a **time played vs. enjoyment** table
  for high-playtime games with no enjoyment info, so you can answer with one click.
- **Weights**: seven sliders, normalised before scoring.
- When you mark a game **Dropped** it asks why (optional); **Completed** asks how it was (optional).

How it separates time spent from enjoyment: enjoyment comes only from ratings, favorites, your profile's
enjoyed / struggled lists, finishing, dropping and your answers. Playtime is a weak hint used only when
nothing else is known, never for multiplayer games, and always labelled as such. "Struggled after many
restarts / replaying" is read as burnout on that game, not a dislike of its genre.

**Data quality.** 247 of the 404 imported games had no tags or player info. Phase 2 bundles a *REWIND
reference* table (`src/data/referenceTraits.ts`) of estimated tags, player modes and length classes for
236 of them, plus extra trait tags (guided, aimless, grind, punishing…) for well-known games. It is
labelled `est.` everywhere, only fills unknown fields, never overwrites your edits, and is applied to a
game only once, so anything you remove stays removed. 11 obscure titles are left unknown.

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

The installer is compiled on a free GitHub-hosted Windows machine. Nothing needs installing on your PC.

1. The project lives in a private GitHub repository.
2. Every push to `main` starts **Actions → Windows build** (or press *Run workflow*). The first run takes
   roughly 15–25 minutes; later runs are faster because the Rust build is cached.
3. When the run shows a green check, open it and download **REWIND-2.0.0-windows-x64** (a zip with the
   setup `.exe`, the `.msi`, a portable `.exe` and `SHA256SUMS.txt`).
4. Optional: push a tag like `v2.0.0` and the workflow also publishes a **Release** with the files attached.

What the workflow does on its own:
- **Lockfiles**: the first successful install commits `package-lock.json` and `src-tauri/Cargo.lock` back
  to `main`, so later builds use exactly the same dependency versions.
- **Logs**: full plain-text logs of every stage are saved to a `ci-logs` branch, so a failed build can be
  diagnosed without digging through the Actions page. The branch never triggers builds and is safe to delete.
- Each stage (tests, frontend, Rust + NSIS, MSI, type check) reports separately, and whatever installers
  were built are uploaded even if a later stage fails.

Cost: private repos on GitHub Free get 2,000 Actions minutes a month; Windows minutes count double, so
one build uses roughly 30–50 of them.

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
- 33 tests, including 17 for recommendations: KOTOR II as the follow-up to KOTOR, souls-likes for
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
  no layout overflow, no console errors.

Not yet verified (needs a Windows PC): the compiled installer itself, first launch under WebView2,
native Open/Save dialogs, window-position memory across your two monitors, and SmartScreen behaviour.
