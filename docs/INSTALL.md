# Installing REWIND 5 on Windows 11

## 1. Download

From the repository's **Releases** page (newest at the top), download one of:

- `REWIND-setup-x64.exe` — recommended. Installs for your Windows account only; no admin rights.
- `REWIND-x64.msi` — installs for every account on the PC; asks for admin rights.
- `REWIND-portable-x64.exe` — no installation; keep it anywhere and double-click it.

Also download `SHA256SUMS.txt`.

## 2. Check the file

The app isn't code-signed, so Windows may say "Windows protected your PC" the first time. That means
"Microsoft doesn't know this publisher", not "this is harmful". Before going past it, check the file is
the one GitHub built. In PowerShell, in your Downloads folder:

```powershell
Get-FileHash .\REWIND-setup-x64.exe
```

The long code it prints must match the line for that file in `SHA256SUMS.txt`. If it matches, choose
**More info → Run anyway**. If it doesn't, delete the file and don't run it. Never do this for files from
anywhere else.

## 3. Install (upgrading from REWIND 4 is the same)

Run the setup file. You don't need to uninstall REWIND 4 first: the installer replaces the app and
leaves your library alone.

The first time REWIND 5 opens an existing library it:

1. saves a full copy of your database to
   `%APPDATA%\dev.tommy.rewind\backups\rewind-before-v5-from-v4-<time>.sqlite3`,
2. upgrades the database (adds launcher records, turns your collections into tags, keeps everything else),
3. encrypts your saved Steam/IGDB keys with Windows.

If step 1 fails (for example, the disk is full), it stops and changes nothing.

It's still a good idea to save a backup in REWIND 4 first (Settings → Data & backup → Save backup).

## 4. After installing

- **Settings → Connections**: import from Steam (no key needed) and, if you use them, let REWIND look for
  Epic Games, Ubisoft Connect and Rockstar games. Each asks before reading anything and shows a preview.
- **Library → Check-up**: fetch artwork and details for games that don't have them yet.
- **Settings → Data and backups**: if you used Mods & Modpacks in REWIND 4, export those records here.

## Where your data lives

| What | Where |
| --- | --- |
| Your library | `%APPDATA%\dev.tommy.rewind\rewind.sqlite3` |
| Safety copies (before upgrades, imports, restores, combining) | `%APPDATA%\dev.tommy.rewind\backups\` |
| Downloaded artwork | `%APPDATA%\dev.tommy.rewind\artwork\` |

Uninstalling REWIND does **not** delete these. Settings → Data and backups shows the exact paths.

## Going back to REWIND 4

1. Close REWIND and install REWIND 4.0.0 from its release.
2. Copy `rewind-before-v5-from-v4-<time>.sqlite3` from the backups folder over
   `%APPDATA%\dev.tommy.rewind\rewind.sqlite3` (keep a copy of the v5 file somewhere first).

REWIND 4 can't open a schema 5 database directly, and changes made in REWIND 5 after upgrading aren't in
that copy. A JSON backup saved from REWIND 5 can be restored into REWIND 5 later.
