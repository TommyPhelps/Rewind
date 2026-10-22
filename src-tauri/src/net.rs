//! Network access for metadata lookups and artwork.
//!
//! The web page never talks to the internet directly: every request goes through
//! `http_request`, which only allows HTTPS to a short list of hosts: Steam and IGDB (via
//! Twitch).
//! Artwork is downloaded once into <app data>/artwork and shown from there, so the
//! library works offline. Errors are prefixed with a kind ("offline:", "timeout:",
//! "blocked:", "network:") that the front end turns into plain-language messages.
//! Request URLs are stripped from error text so an API key can never end up in a message.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

const ALLOWED_HOSTS: &[&str] = &[
    "api.steampowered.com",
    "store.steampowered.com",
    "shared.akamai.steamstatic.com",
    "shared.cloudflare.steamstatic.com",
    "shared.fastly.steamstatic.com",
    "cdn.akamai.steamstatic.com",
    "cdn.cloudflare.steamstatic.com",
    "cdn.fastly.steamstatic.com",
    "steamcdn-a.akamaihd.net",
    "id.twitch.tv",
    "api.igdb.com",
    "images.igdb.com",
];

const MAX_BODY: usize = 12 * 1024 * 1024;
const MAX_IMAGE: usize = 15 * 1024 * 1024;

pub struct Http(pub reqwest::Client);

fn host_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().map(|h| ALLOWED_HOSTS.contains(&h)).unwrap_or(false)
}

pub fn client() -> Result<reqwest::Client, String> {
    // Redirects are followed only while they stay on the allowed hosts.
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            attempt.error("too many redirects")
        } else if host_allowed(attempt.url()) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    reqwest::Client::builder()
        // Identifies the app and project; no personal details are sent.
        .user_agent(concat!("TommyPhelps/REWIND/", env!("CARGO_PKG_VERSION"), " (personal game library; +https://github.com/TommyPhelps/Rewind)"))
        .connect_timeout(Duration::from_secs(10))
        .redirect(policy)
        .build()
        .map_err(|e| e.to_string())
}

fn check_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "blocked: not a valid web address".to_string())?;
    if url.scheme() != "https" {
        return Err("blocked: only HTTPS is allowed".into());
    }
    if !host_allowed(&url) {
        let host = url.host_str().unwrap_or("");
        return Err(format!("blocked: REWIND only contacts Steam and IGDB, not {host}"));
    }
    Ok(url)
}

fn describe(e: reqwest::Error) -> String {
    let timeout = e.is_timeout();
    let connect = e.is_connect();
    let text = e.without_url().to_string();
    if timeout {
        format!("timeout: {text}")
    } else if connect {
        format!("offline: {text}")
    } else {
        format!("network: {text}")
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpReq {
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResp {
    status: u16,
    body: String,
    retry_after: Option<String>,
}

#[tauri::command]
pub async fn http_request(http: tauri::State<'_, Http>, req: HttpReq) -> Result<HttpResp, String> {
    let url = check_url(&req.url)?;
    let method = match req.method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return Err("blocked: unsupported method".into()),
    };
    let mut rb = http
        .0
        .request(method, url)
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(25_000).clamp(1_000, 120_000)));
    for (k, v) in req.headers {
        rb = rb.header(k, v);
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    let resp = rb.send().await.map_err(describe)?;
    let status = resp.status().as_u16();
    // Retry-After, or X-Ratelimit-Reset on a 429, both in seconds.
    let retry_after = resp
        .headers()
        .get("retry-after")
        .or_else(|| if status == 429 { resp.headers().get("x-ratelimit-reset") } else { None })
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().await.map_err(describe)?;
    if bytes.len() > MAX_BODY {
        return Err("network: response too large".into());
    }
    Ok(HttpResp { status, body: String::from_utf8_lossy(&bytes).into_owned(), retry_after })
}

fn art_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("artwork");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_name(name: &str) -> Result<String, String> {
    let s: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    if s.is_empty() || s.starts_with('.') || s.len() > 120 {
        return Err("blocked: bad file name".into());
    }
    Ok(s)
}

fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 12 {
        return None;
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"GIF8") {
        Some("gif")
    } else {
        None
    }
}

fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let tmp = dir.join(format!("{name}.part"));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtFile {
    /// Path relative to the app data folder, e.g. "artwork/steam-32370-cover.jpg".
    file: String,
    bytes: usize,
}

/// Downloads one image into the artwork cache. `name` is the file name without extension;
/// the extension comes from the image itself, and anything that isn't an image is refused.
#[tauri::command]
pub async fn download_art(app: tauri::AppHandle, http: tauri::State<'_, Http>, url: String, name: String) -> Result<ArtFile, String> {
    let url = check_url(&url)?;
    let base = safe_name(&name)?;
    let resp = http.0.get(url).timeout(Duration::from_secs(40)).send().await.map_err(describe)?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Err(format!("http {status}"));
    }
    let bytes = resp.bytes().await.map_err(describe)?;
    if bytes.len() > MAX_IMAGE {
        return Err("network: image too large".into());
    }
    let ext = image_ext(&bytes).ok_or_else(|| "bad_response: not an image".to_string())?;
    let file = format!("{base}.{ext}");
    write_atomic(&art_dir(&app)?, &file, &bytes)?;
    Ok(ArtFile { file: format!("artwork/{file}"), bytes: bytes.len() })
}

/// Copies an image the user picked in an Open dialog into the artwork cache (their own cover).
#[tauri::command]
pub async fn import_art(app: tauri::AppHandle, path: String, name: String) -> Result<ArtFile, String> {
    let base = safe_name(&name)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    if bytes.len() > MAX_IMAGE {
        return Err("That image is larger than 15 MB.".into());
    }
    let ext = image_ext(&bytes).ok_or_else(|| "That file is not a JPEG, PNG, WebP or GIF image.".to_string())?;
    let file = format!("{base}.{ext}");
    write_atomic(&art_dir(&app)?, &file, &bytes)?;
    Ok(ArtFile { file: format!("artwork/{file}"), bytes: bytes.len() })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtStats {
    files: usize,
    bytes: u64,
    dir: String,
}

#[tauri::command]
pub async fn art_stats(app: tauri::AppHandle) -> Result<ArtStats, String> {
    let dir = art_dir(&app)?;
    let mut files = 0usize;
    let mut bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.filter_map(|e| e.ok()) {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    files += 1;
                    bytes += m.len();
                }
            }
        }
    }
    Ok(ArtStats { files, bytes, dir: dir.to_string_lossy().into_owned() })
}

/// Deletes cached artwork files. Only plain file names inside the artwork folder are accepted.
#[tauri::command]
pub async fn delete_art(app: tauri::AppHandle, files: Vec<String>) -> Result<usize, String> {
    let dir = art_dir(&app)?;
    let mut n = 0;
    for f in files {
        let name = f.strip_prefix("artwork/").unwrap_or(&f);
        let name = safe_name(name)?;
        if std::fs::remove_file(dir.join(name)).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

/// Which of these cached files are missing (e.g. after restoring a backup on another PC).
#[tauri::command]
pub async fn art_missing(app: tauri::AppHandle, files: Vec<String>) -> Result<Vec<String>, String> {
    let dir = art_dir(&app)?;
    Ok(files
        .into_iter()
        .filter(|f| {
            let name = f.strip_prefix("artwork/").unwrap_or(f);
            match safe_name(name) {
                Ok(n) => !dir.join(n).is_file(),
                Err(_) => true,
            }
        })
        .collect())
}
