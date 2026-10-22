# REWIND design system

REWIND 5 has one look: near-black, monochrome, flat, square and compact. This file is the
reference for it. The tokens live in `src/styles/tokens.css`; components and layouts live in
`src/styles/app.css`. When you change a value, change it in both places.

## Principles

1. **One question per screen.** Home: what am I playing and what's next. Library: what I own
   and how it's organised. Discover: interesting games. Pick for me: what to play now.
   Activity: what I played and finished. Settings: customise and manage.
2. **Progressive disclosure.** Show what's used most often. Advanced filters, technical and
   source information, API keys and recommendation weights stay folded away until opened.
3. **No empty furniture.** A section with nothing in it isn't drawn. When a whole screen is
   empty, it says what to do next in one short line.
4. **Quiet surfaces, readable text.** Contrast comes from text weight and grey levels, not
   colour, boxes or effects.
5. **Honest labels.** Estimates are marked as estimates, sources are named, and nothing is
   invented to fill space.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `--deep` | `#000000` | Inputs, wells, artwork backdrops |
| `--bg` | `#050505` | The window |
| `--surface` | `#101010` | Sidebar, panels, cards, the details drawer |
| `--surface-2` | `#151515` | Buttons, raised rows, placeholders |
| `--elevated` | `#1B1B1B` | Dialogs, menus, toasts |
| `--hover` | `#202020` | Hover on any interactive surface |
| `--selected` | `#242424` | Selected rows, pressed toggles, current nav item |
| `--border` | `#292929` | All dividers and outlines |
| `--border-strong` | `#3A3A3A` | Hovered outlines, dialog edges |
| `--text` | `#ECECEC` | Primary text |
| `--text-2` | `#A6A6A6` | Secondary text |
| `--muted` | `#858585` | Meta, captions, counts, disabled |
| `--accent` | `#D5D5D5` | Primary buttons, focus outline, selection marks |
| `--bad` / `--ok` | `#D39191` / `#A7C2A7` | Only for errors and confirmations, sparingly |

Not used anywhere: navy or tinted backgrounds, gradients, bevels, glows, neon labels, pills,
heavy shadows. The one exception is the darkened, blurred backdrop behind landscape-only
artwork, which keeps a store header from being stretched.

Selection is shown with `--selected` plus a 2 px `--accent` bar on the leading edge (nav items,
list rows, tabs) or a 2 px `--accent` outline (covers).

## Type

- Family: `Segoe UI Variable Text`, `Segoe UI`, then `Inter`, then the system UI font. Display
  sizes use `Segoe UI Variable Display`. Nothing is bundled: Windows always has Segoe UI.
- Monospace (`Cascadia Mono`, `Consolas`) only for technical values: install paths, launch
  links, file locations, keyboard keys.
- Sentence case everywhere ("Add game", "Library check-up"). No all-caps labels and no
  letter-spaced small caps; the only uppercase is the REWIND wordmark.

| Token | Size at 100% | Use |
| --- | --- | --- |
| `--fs-title` | 24 px | Page titles, the featured game, the picked game |
| `--fs-section` | 17 px | Section headings |
| `--fs-lead` | 15 px | Card titles, large buttons |
| `--fs-body` | 14 px | Body text, rows, controls |
| `--fs-meta` | 12.5 px | Meta lines, captions, small buttons |
| `--fs-small` | 12 px | Counts, source marks |

The root size is `14px × --scale` (Settings → General → Text size, 90–130%). On windows wider
than 2400 CSS px the root becomes 15 px, and above 3200 CSS px (a 4K screen at 100% Windows
scaling) 18 px, so a 4K desktop reads like a 1440p one. Everything is in `rem`, so spacing grows
with it.

## Space, shape and motion

- 4 px grid: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32, `--s7` 48 (at 100%).
- Controls: 32 px (`--ctl`), small 28 px, large 36 px. List rows 40–44 px.
- Corners are square (`border-radius: 0` globally). Borders are 1 px.
- Transitions 120 ms (hover, colour) and 180 ms (dialogs, progress), ease-out. Nothing
  animates on its own except the "working" dot. `prefers-reduced-motion` turns motion off.

## Layout

- Sidebar 13 rem with six sections (Ctrl+1…6); icons only below 1180 px or on request (Ctrl+B).
- Reading pages (Home, Pick for me, Settings) are centred, max 92 rem; Activity max 62 rem.
  Library and Discover use the full width.
- Pages scroll vertically only. Nothing scrolls the whole page sideways; wide content
  (segmented controls, shelf tabs) scrolls inside its own strip.
- The details drawer opens on the right (30 rem, resizable 340–760 px). Below 980 px it
  overlays the list instead of squeezing it.
- Checked at 800×600, 1024×700, 1280×720 (1920×1080 at 150%), 1536×864 (125%), 1920×1080,
  2560×1440 and 3840×2160.

## Components

| Component | Class | Notes |
| --- | --- | --- |
| Button | `.btn` + `.primary` / `.ghost` / `.danger` / `.sm` / `.lg` / `.icon` | One primary per area. Toggles use `aria-pressed`. |
| Input, select | `.field`, `.select` | Black well, 1 px border, accent border on focus. |
| Search | `.search` (`.lg` on the Library) | Icon inside the field. |
| Segmented control | `.seg` (`.sm`) | Status tabs, view switches, small option sets. |
| Chip | `.chip` (`.user` for yours) | Tags and filter chips; square, never pill-shaped. |
| Status | `.status.st-<id>` | Grey text with a small square mark whose fill differs per status. |
| Source mark | `.src` | "you", "Steam", "IGDB", "estimate", "Timed", "Logged". |
| Row list | `.rows` > `.r-item` | Lead (thumb or number), main (title + sub), actions. |
| Section | `.sec` > `.sec-h` (h2 + `.count` + `.acts`) | Page sections. |
| Card | `.card`, `.feature`, `.now-card`, `.result`, `.conn` | Flat `--surface` box with a 1 px border. |
| Folded section | `details.dsec`, `details.drawer-adv`, `details.conn-more` | Progressive disclosure. |
| Cover | `.cover` (2:3), `.thumb` | Without artwork: a flat placeholder with the title, or a small mark in grids where the title is printed below. |
| Dialog | `.shade` > `.dlg` (`.wide`, `.xl`) | Header, scrolling body, footer with the primary action last. |
| Menu, toast | `.menu`, `.toasts` > `.toast` | Elevated surface. |
| Note | `.note` (`.info`, `.ok`, `.bad`) | A 2 px left rule, never a coloured box. |
| Progress | `.bar` (`.thin`) | Used for lookups and play progress. |

## Writing

- Say what happens, briefly: "Look up 37 games", "Combine…", "Stop and log".
- Explanations name the game's own facts or your own history ("Similar to Persona 4
  Golden, which you enjoyed"). Generic lines that would fit any game are left out.
- Limitations are stated plainly where they matter ("Rockstar has no documented way to start
  a single game").
