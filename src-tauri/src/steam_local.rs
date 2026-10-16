//! Reads the Steam client's own files on this PC, so a Steam library can be imported
//! without a password, an API key or a public profile. Nothing is written and nothing
//! leaves the PC: the raw text is handed to the front end, which parses it.
//!
//! Files read (all plain-text Valve KeyValues):
//!   <Steam>/steamapps/libraryfolders.vdf            where the game libraries are
//!   <library>/steamapps/appmanifest_<id>.acf        installed games (id + name)
//!   <Steam>/userdata/<account>/config/localconfig.vdf   per-game playtime and last played

use serde::Serialize;
use std::path::{Path, PathBuf};

const MAX_MANIFESTS: usize = 5000;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_CONFIG_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamAccount {
    /// The folder name under userdata: the 32-bit Steam account id.
    id: String,
    local_config: String,
    /// Seconds since 1970 when localconfig.vdf was last written (the most recently used account is newest).
    modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamLocal {
    root: String,
    libraries: Vec<String>,
    manifests: Vec<String>,
    accounts: Vec<SteamAccount>,
}

fn candidates() -> Vec<PathBuf> {
    let mut v = Vec::new();
    for var in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
        if let Ok(p) = std::env::var(var) {
            v.push(PathBuf::from(p).join("Steam"));
        }
    }
    for p in [r"C:\Program Files (x86)\Steam", r"C:\Program Files\Steam", r"C:\Steam", r"D:\Steam", r"D:\Program Files (x86)\Steam", r"E:\Steam"] {
        v.push(PathBuf::from(p));
    }
    if let Ok(home) = std::env::var("HOME") {
        v.push(PathBuf::from(&home).join(".steam/steam"));
        v.push(PathBuf::from(&home).join(".local/share/Steam"));
    }
    v
}

fn looks_like_steam(p: &Path) -> bool {
    p.join("steamapps").is_dir() || p.join("userdata").is_dir()
}

/// Library paths listed in libraryfolders.vdf: lines like  "path"   "D:\\\\SteamLibrary"
fn library_paths(vdf: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let t = line.trim();
        if !t.to_ascii_lowercase().starts_with("\"path\"") {
            continue;
        }
        let parts: Vec<&str> = t.split('"').collect();
        // ["", "path", "<tabs>", "D:\\SteamLibrary", ""]
        if parts.len() >= 4 {
            let raw = parts[3].replace("\\\\", "\\");
            if !raw.is_empty() {
                out.push(PathBuf::from(raw));
            }
        }
    }
    out
}

fn read_limited(p: &Path, max: u64) -> Option<String> {
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > max {
        return None;
    }
    std::fs::read(p).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

#[tauri::command]
pub async fn steam_local_scan(dir: Option<String>) -> Result<SteamLocal, String> {
    let root = match dir {
        Some(d) => {
            let p = PathBuf::from(d);
            if !looks_like_steam(&p) {
                return Err("not_found: That folder doesn't look like a Steam folder (it has no steamapps or userdata folder inside).".into());
            }
            p
        }
        None => candidates()
            .into_iter()
            .find(|p| looks_like_steam(p))
            .ok_or_else(|| "not_found: Steam wasn't found in the usual places. Choose your Steam folder.".to_string())?,
    };

    let mut libraries: Vec<PathBuf> = vec![root.clone()];
    if let Some(text) = read_limited(&root.join("steamapps").join("libraryfolders.vdf"), 4 * 1024 * 1024) {
        for p in library_paths(&text) {
            if !libraries.iter().any(|q| q == &p) {
                libraries.push(p);
            }
        }
    }

    let mut manifests = Vec::new();
    for lib in &libraries {
        let apps = lib.join("steamapps");
        if let Ok(entries) = std::fs::read_dir(&apps) {
            for e in entries.filter_map(|e| e.ok()) {
                if manifests.len() >= MAX_MANIFESTS {
                    break;
                }
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("appmanifest_") && name.ends_with(".acf") {
                    if let Some(t) = read_limited(&e.path(), MAX_MANIFEST_BYTES) {
                        manifests.push(t);
                    }
                }
            }
        }
    }

    let mut accounts = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root.join("userdata")) {
        for e in entries.filter_map(|e| e.ok()) {
            let id = e.file_name().to_string_lossy().to_string();
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) || id == "0" {
                continue;
            }
            let cfg = e.path().join("config").join("localconfig.vdf");
            let modified = std::fs::metadata(&cfg)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if let Some(text) = read_limited(&cfg, MAX_CONFIG_BYTES) {
                accounts.push(SteamAccount { id, local_config: text, modified });
            }
        }
    }

    Ok(SteamLocal {
        root: root.to_string_lossy().into_owned(),
        libraries: libraries.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        manifests,
        accounts,
    })
}
