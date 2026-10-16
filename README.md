# REWIND 3.0

A personal gaming companion for Windows 11: your game library, what you're playing next, and (in later
phases) an explainable "what should I play tonight" picker, Minecraft modpack discovery and a modding
companion. Dark early-2000s look, five themes, a sibling to Nook Tracker.

Everything lives in one SQLite file on your PC. No account, no server, no telemetry. It works offline.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Inspect the old REWIND artifact, its data, and the build options | Done |
| 1 | Tauri app, SQLite, dark Y2K design system, library import, navigation, Windows build | Built (v2.0.0) |
| 2 | Recommendation engine: Pick for me, Friction Check, taste profile, presets | Built (v2.1.0) |
| 2.5 | Desktop layouts, readability, Home dashboard, session intent, queues, Activity overview | Built (v2.5.0) |
| 3 | Steam library import, game metadata, cover art, offline cache, metadata-aware recommendations | **Built (v3.0.0)** |
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

### What 2.5 changes: desktop layout, readability, queues

- **Layouts that use the screen.** Home, Activity and Settings are dashboards whose columns follow the
  window width (one column in a small window, up to four at 2560×1440). Long text keeps a readable width;
  nothing scrolls sideways at 960×600 or at 125/150/200% Windows scaling.
- **Bigger, consistent type** on one scale, plus **Density** (Compact / Comfortable / Spacious) and text
  size up to 150% in Settings → Appearance. Clearer status pills, focus rings and empty states.
- **Home**: Tonight's recommendation (from your last Pick-for-me settings, with one-click intents),
  Currently playing (log a session, pause, complete), Continue where you left off, Up Next (with a
  review count), Series follow-ups, Recent activity, and a library overview where every number opens
  that slice of the Library.
- **Separate ideas, kept separate.** *Playing*, *Paused* and *Replay* are statuses you set. *Up Next* is
  your own ordered list. *Series follow-ups*, *Continue where you left off* and *Replay candidates* are
  automatic lists that update themselves.
- **Hours near an estimate no longer mean "finished".** A game counts as probably finished only once your
  hours pass the main-story estimate. KOTOR at 37h of ~40h is unfinished, so KOTOR II waits in Series
  follow-ups instead of being suggested.
- **Review your queue** (Collections → Up Next): suggestions such as "you're playing KOTOR now; remove
  it from Up Next?" or "KOTOR II follows a game you haven't finished". Nothing changes until you click,
  and "Keep as is" is remembered. Your imported statuses and queue were not touched.
- **Session intent** in Pick for me: Anything, Continue my current game, Resume something paused, Start
  something new, Replay something familiar, Something completely different. Sequels wait for the earlier
  game unless you tick "Allow sequels before I finish the earlier game". Long, dialogue-heavy RPGs are no
  longer treated as low-energy picks ("Needs steady concentration").
- **Recommendation card**: title, fit, ownership, status and commitment up top; why it fits / why it might
  not; confidence and data sources; "How this was scored" expands.
- **Collections**: three panels (lists, the open list, game details), drag-and-drop or Alt+↑/↓ to
  reorder, move to top, move to another collection, Del to remove.
- **Activity**: play sessions you log (REWIND never invents history), recently started, completed with
  dates, paused, recent Pick-for-me choices, and the full log with a filter.
- **Library**: two-line rows with progress ("37h of ~40h main story · Up Next #1"), progress and
  "needs info" filters, sort by last played or Pick-for-me fit, neutral cover placeholders (no fake art).
- **Mods** shows your old REWIND modpack list as saved, labelled unverified. Discover stays a labelled
  placeholder.

### What Phase 3 adds: Steam, metadata and artwork

Everything is on the new **Steam & metadata** screen (Ctrl+8).

**Import your Steam library** (preview first, then one all-or-nothing transaction with a safety snapshot):
- *Steam client on this PC* — reads the Steam client's own files (`localconfig.vdf`, app manifests).
  No password, no key, works with a private profile. Sees games this account has launched or installed.
- *Steam account (Web API)* — every owned game, via the official `IPlayerService/GetOwnedGames`.
  Needs your free Steam Web API key (steamcommunity.com/dev/apikey) and "Game details" set to public.
- Matching: already-linked app id → exact title → same title with edition wording → similar (shown,
  never applied unless you choose) → new game. Two REWIND entries with one title are a conflict you
  resolve. Tools, servers, soundtracks and test clients aren't ticked.
- Steam's playtime is stored **separately** from the old app's figure (REWIND uses the larger) and a
  smaller number never replaces a larger one. Ratings, notes, statuses, favourites and preferences are
  never touched.

**Details & covers** (background sync, cancellable, resumes where it stopped):
- Links each game to Steam by app id, or by store search when the title matches exactly with no equally
  good rival. Everything else waits in **Needs your decision** with candidates; "None of these" is
  remembered. Titles that normalise to the same thing in your library (e.g. GTA V Legacy / Enhanced) are
  only linked on a literal title match.
- Store data in batches of 25 via Steam's `IStoreBrowseService/GetItems`: developers, publishers,
  original release date, player modes, platforms, description, Steam user tags (with votes), artwork paths.
- Artwork: the 600×900 library cover (falls back to the store header, shown centred on a blurred copy —
  never stretched or invented), plus the header and, for games you open, the wide hero image. Cached
  in `%APPDATA%\dev.tommy.rewind\artwork\`; missing files are fetched again on the next sync.
- Optional **IGDB** (free Twitch Client ID + Secret): extra details and IGDB's player-submitted "time to
  beat", stored as lengths labelled `igdb`. Your own hours always win.
- Pacing: one store search every ~1.6 s, batched store reads, 4 image downloads at a time, retries with
  back-off and Retry-After on rate limits. Offline: the run stops with "couldn't reach the internet" and
  nothing already saved is lost or marked as failed.

**What it changes, and what it never changes:** it adds tags mapped from well-voted Steam user tags
(source "Steam user tags"; tags you removed are not put back), replaces *estimated* player modes with
Steam's categories (never your own choice), adds IGDB lengths, and sets the cover unless you picked your
own picture. Unlinking removes exactly what that link added. Title, status, rating, notes, your tags and
your lengths are untouched; "Your corrections" fields in the details panel override store data.

**Browsing:** cover grid in three sizes (S/M/L, 9–12 columns at 2560×1440) with status, Up Next position
and playtime on each cover; small covers in list rows; filters for artwork / match state; sort by release
year; search also matches developers and publishers. The details panel gains a banner, an *About* section
where every fact shows its source, store links, and *Sources & artwork* to change or remove a match or use
your own cover image.

**Recommendations:** store-derived tags count at 0.6× of your own and REWIND's curated tags, so broad
labels can't outweigh what you've told REWIND; ratings and feedback remain the strongest signals. New:
developer affinity from games you rated or listed ("Made by BioWare, who also made STAR WARS Knights of
the Old Republic, which you enjoyed"), Steam player modes keep multiplayer-only games out, and a game you
played recently is never called "already played through" just because its hours passed an estimate.
Explanations list "Details: Steam store / IGDB.com".

**Keys and privacy:** the Steam key and IGDB credentials are stored only in the local database's
`secrets` table, never in backups, and only sent to Steam or Twitch. The app only talks to an allow-list
of Steam and IGDB hosts over HTTPS (enforced in Rust, including redirects). Nothing about your library
is uploaded; each lookup sends only the game being looked up.

**Limits, stated plainly:** Steam's store endpoints (`GetItems`, `storesearch`, `GetTagList`) are public
and keyless but not formally documented by Valve, so they could change; `tools/probe-steam.mjs` (Actions →
"Steam endpoint probe") re-checks them. HowLongToBeat has no public API, so REWIND only links to it.
"Steam client on this PC" can't see owned games that were never installed or launched.

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
  meta/         Steam / IGDB clients, title matching, Steam import planner, metadata sync, VDF parser
src-tauri/      Rust: rusqlite bridge with real transactions, file I/O for chosen files, safety snapshots,
                HTTPS allow-list client + artwork cache (net.rs), Steam client file reader (steam_local.rs)
tests/          node:test suites against node:sqlite (same SQL as the app)
tools/          icon generator, browser preview build + dev SQL bridge (development only)
```

## Testing record

Automated (run here and in CI):
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
  and scaling with no overflow.

Not yet verified (needs a Windows PC and the internet): the compiled installer itself, first launch under
WebView2, native Open/Save dialogs, window-position memory across your two monitors, SmartScreen
behaviour, real Steam / IGDB requests from the app (the endpoints themselves were checked from GitHub's
servers), reading your real Steam folder, and cached covers loading through the asset protocol.
