//! Installed-game discovery for Epic Games, Ubisoft Connect and Rockstar Games Launcher,
//! and starting games through their launchers.
//!
//! Only READS what the launchers keep on this PC, and only when the front end asks after
//! you allowed it:
//!   Epic      %ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item  (JSON, one per install)
//!   Ubisoft   HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher(\Installs\<id>)   (InstallDir)
//!   Rockstar  HKLM\SOFTWARE\WOW6432Node\Rockstar Games\<game>              (InstallFolder)
//!   Windows   ...\CurrentVersion\Uninstall\*  (display names; Ubisoft / Rockstar entries only)
//! Nothing is written, no launcher is signed in to, and no file leaves the PC.
//!
//! Launching hands a launcher link (steam://, com.epicgames.launcher://, uplay://) to
//! Windows; the launcher itself starts the game, so DRM and sign-in are untouched.

use serde::Serialize;
use std::path::PathBuf;

const MAX_MANIFESTS: usize = 3000;
const MAX_MANIFEST_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EpicRaw {
    detected: bool,
    manifests_dir: Option<String>,
    manifests: Vec<String>,
    error: Option<String>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegEntry {
    key: String,
    display_name: String,
    install_location: String,
    publisher: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UbiInstall {
    id: String,
    install_dir: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UbisoftRaw {
    detected: bool,
    launcher_dir: Option<String>,
    installs: Vec<UbiInstall>,
    uninstall: Vec<RegEntry>,
    error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RockGame {
    key: String,
    install_folder: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RockstarRaw {
    detected: bool,
    launcher_dir: Option<String>,
    games: Vec<RockGame>,
    uninstall: Vec<RegEntry>,
    error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LauncherRaw {
    epic: EpicRaw,
    ubisoft: UbisoftRaw,
    rockstar: RockstarRaw,
}

fn epic_dir() -> PathBuf {
    let base = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    PathBuf::from(base).join("Epic").join("EpicGamesLauncher").join("Data").join("Manifests")
}

fn scan_epic() -> EpicRaw {
    let dir = epic_dir();
    let mut out = EpicRaw { detected: dir.is_dir(), manifests_dir: Some(dir.to_string_lossy().into_owned()), ..Default::default() };
    if !out.detected {
        return out;
    }
    match std::fs::read_dir(&dir) {
        Ok(entries) => {
            for e in entries.flatten().take(MAX_MANIFESTS) {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("item")) != Some(true) {
                    continue;
                }
                if std::fs::metadata(&p).map(|m| m.len() > MAX_MANIFEST_BYTES).unwrap_or(true) {
                    continue;
                }
                if let Ok(text) = std::fs::read_to_string(&p) {
                    out.manifests.push(text);
                }
            }
        }
        Err(e) => out.error = Some(format!("Couldn't read the Epic manifests folder: {e}")),
    }
    out
}

#[cfg(windows)]
mod reg {
    use super::RegEntry;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    pub fn string(root: &RegKey, path: &str, value: &str) -> Option<String> {
        root.open_subkey(path).ok()?.get_value::<String, _>(value).ok().filter(|s| !s.trim().is_empty())
    }

    pub fn key_exists(root: &RegKey, path: &str) -> bool {
        root.open_subkey(path).is_ok()
    }

    /// Sub-key names with one string value each (missing values are skipped).
    pub fn subkeys_with(root: &RegKey, path: &str, value: &str) -> Vec<(String, String)> {
        let mut out = Vec::new();
        if let Ok(k) = root.open_subkey(path) {
            for name in k.enum_keys().flatten().take(2000) {
                if let Ok(sub) = k.open_subkey(&name) {
                    if let Ok(v) = sub.get_value::<String, _>(value) {
                        if !v.trim().is_empty() {
                            out.push((name, v));
                        }
                    }
                }
            }
        }
        out
    }

    pub fn hklm() -> RegKey {
        RegKey::predef(HKEY_LOCAL_MACHINE)
    }

    /// Windows' "installed programs" list, filtered to entries `keep` accepts.
    pub fn uninstall_entries(keep: &dyn Fn(&str, &str) -> bool) -> Vec<RegEntry> {
        let mut out = Vec::new();
        let roots = [
            (RegKey::predef(HKEY_LOCAL_MACHINE), "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
            (RegKey::predef(HKEY_LOCAL_MACHINE), "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
            (RegKey::predef(HKEY_CURRENT_USER), "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
        ];
        for (root, path) in roots.iter() {
            if let Ok(k) = root.open_subkey(path) {
                for name in k.enum_keys().flatten().take(5000) {
                    if let Ok(sub) = k.open_subkey(&name) {
                        let get = |v: &str| sub.get_value::<String, _>(v).unwrap_or_default();
                        let publisher = get("Publisher");
                        if !keep(&name, &publisher) {
                            continue;
                        }
                        out.push(RegEntry { key: name.clone(), display_name: get("DisplayName"), install_location: get("InstallLocation"), publisher });
                    }
                }
            }
        }
        out
    }
}

#[cfg(windows)]
fn scan_ubisoft() -> UbisoftRaw {
    let hklm = reg::hklm();
    let base = "SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher";
    let installs: Vec<UbiInstall> = reg::subkeys_with(&hklm, &format!("{base}\\Installs"), "InstallDir")
        .into_iter()
        .map(|(id, dir)| UbiInstall { id, install_dir: dir })
        .collect();
    UbisoftRaw {
        detected: reg::key_exists(&hklm, base) || !installs.is_empty(),
        launcher_dir: reg::string(&hklm, base, "InstallDir"),
        installs,
        uninstall: reg::uninstall_entries(&|key, publisher| key.to_ascii_lowercase().starts_with("uplay install") || publisher.to_ascii_lowercase().contains("ubisoft")),
        error: None,
    }
}

#[cfg(windows)]
fn scan_rockstar() -> RockstarRaw {
    let hklm = reg::hklm();
    let base = "SOFTWARE\\WOW6432Node\\Rockstar Games";
    let skip = |k: &str| {
        let k = k.to_ascii_lowercase();
        k == "launcher" || k.contains("social club") || k == "rockstar games launcher"
    };
    let games: Vec<RockGame> = reg::subkeys_with(&hklm, base, "InstallFolder")
        .into_iter()
        .filter(|(k, _)| !skip(k))
        .map(|(key, folder)| RockGame { key, install_folder: folder })
        .collect();
    let launcher_dir = reg::string(&hklm, &format!("{base}\\Launcher"), "InstallFolder");
    RockstarRaw {
        detected: launcher_dir.is_some() || reg::key_exists(&hklm, base),
        launcher_dir,
        games,
        uninstall: reg::uninstall_entries(&|_key, publisher| publisher.to_ascii_lowercase().contains("rockstar")),
        error: None,
    }
}

#[cfg(not(windows))]
fn scan_ubisoft() -> UbisoftRaw {
    UbisoftRaw { error: Some("Ubisoft Connect detection only works on Windows.".into()), ..Default::default() }
}

#[cfg(not(windows))]
fn scan_rockstar() -> RockstarRaw {
    RockstarRaw { error: Some("Rockstar Games Launcher detection only works on Windows.".into()), ..Default::default() }
}

/// Reads the launchers listed in `which` ("epic", "ubisoft", "rockstar"); others are left empty.
#[tauri::command]
pub async fn launcher_scan(which: Vec<String>) -> Result<LauncherRaw, String> {
    let has = |s: &str| which.iter().any(|w| w == s);
    let mut out = LauncherRaw::default();
    if has("epic") {
        out.epic = scan_epic();
    }
    if has("ubisoft") {
        out.ubisoft = scan_ubisoft();
    }
    if has("rockstar") {
        out.rockstar = scan_rockstar();
    }
    Ok(out)
}

fn seg_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Only these launcher links are ever opened (the same rules as src/launchers/launch.ts).
pub fn allowed_launch(uri: &str) -> bool {
    if let Some(rest) = uri.strip_prefix("steam://rungameid/") {
        return !rest.is_empty() && rest.len() <= 20 && rest.chars().all(|c| c.is_ascii_digit());
    }
    if let Some(rest) = uri.strip_prefix("uplay://launch/") {
        if let Some(id) = rest.strip_suffix("/0") {
            return !id.is_empty() && id.len() <= 20 && id.chars().all(|c| c.is_ascii_digit());
        }
        return false;
    }
    if let Some(rest) = uri.strip_prefix("com.epicgames.launcher://apps/") {
        if let Some(ids) = rest.strip_suffix("?action=launch&silent=true") {
            let parts: Vec<&str> = ids.split("%3A").collect();
            return parts.len() == 3 && parts.iter().all(|p| seg_ok(p));
        }
    }
    false
}

/// Starts a game through its launcher.
#[tauri::command]
pub async fn launch_game(app: tauri::AppHandle, uri: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !allowed_launch(&uri) {
        return Err("blocked: not a launcher link REWIND can open".into());
    }
    app.opener().open_url(uri, None::<&str>).map_err(|e| format!("Couldn't start the launcher: {e}"))
}

#[cfg(test)]
mod tests {
    use super::allowed_launch;

    #[test]
    fn launch_links_are_checked() {
        assert!(allowed_launch("steam://rungameid/32370"));
        assert!(allowed_launch("uplay://launch/5059/0"));
        assert!(allowed_launch("com.epicgames.launcher://apps/abc123%3Adef456%3AFortniteGame?action=launch&silent=true"));
        assert!(!allowed_launch("steam://rungameid/"));
        assert!(!allowed_launch("steam://rungameid/1;calc"));
        assert!(!allowed_launch("steam://install/32370"));
        assert!(!allowed_launch("uplay://launch/5059/1"));
        assert!(!allowed_launch("com.epicgames.launcher://apps/a%3Ab?action=launch&silent=true"));
        assert!(!allowed_launch("com.epicgames.launcher://apps/a%3Ab%3Ac/../x?action=launch&silent=true"));
        assert!(!allowed_launch("file:///C:/Windows/System32/calc.exe"));
        assert!(!allowed_launch("https://example.com"));
    }

    #[test]
    fn epic_dir_points_at_manifests() {
        let d = super::epic_dir();
        let tail = std::path::Path::new("Epic").join("EpicGamesLauncher").join("Data").join("Manifests");
        assert!(d.ends_with(tail));
    }
}
