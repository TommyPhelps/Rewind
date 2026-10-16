mod db;

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

const DB_FILE: &str = "rewind.sqlite3";
const KEEP_SAFETY_BACKUPS: usize = 20;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Reads a text file the user picked in a native Open dialog.
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Writes a text file to a path the user picked in a native Save dialog.
#[tauri::command]
async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not write {path}: {e}"))
}

/// Saves an automatic safety snapshot (taken before imports and restores)
/// into <app data>/backups and keeps only the newest few.
#[tauri::command]
async fn write_safety_backup(app: tauri::AppHandle, name: String, contents: String) -> Result<String, String> {
    let dir = data_dir(&app)?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    let safe = if safe.is_empty() { "snapshot.json".to_string() } else { safe };
    let path = dir.join(&safe);
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;

    // Prune: keep the newest KEEP_SAFETY_BACKUPS snapshot files.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
            .filter_map(|p| std::fs::metadata(&p).and_then(|m| m.modified()).ok().map(|t| (t, p)))
            .collect();
        files.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, old) in files.into_iter().skip(KEEP_SAFETY_BACKUPS) {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    db_path: String,
    backups_dir: String,
}

#[tauri::command]
async fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    let dir = data_dir(&app)?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        db_path: dir.join(DB_FILE).to_string_lossy().into_owned(),
        backups_dir: dir.join("backups").to_string_lossy().into_owned(),
        data_dir: dir.to_string_lossy().into_owned(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join(DB_FILE))?;
            app.manage(db::Db(std::sync::Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_select,
            db::db_execute,
            db::db_batch,
            read_text_file,
            write_text_file,
            write_safety_backup,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running REWIND");
}
