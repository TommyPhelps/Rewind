//! Local SQLite access for the frontend.
//!
//! The app keeps one connection behind a mutex. The frontend sends SQL with
//! positional `?` parameters; `db_batch` runs a list of statements inside one
//! transaction so imports and bulk edits are all-or-nothing.

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

pub struct Db(pub Mutex<Connection>);

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    let _mode: String = conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(conn)
}

#[derive(Deserialize)]
pub struct Stmt {
    sql: String,
    #[serde(default)]
    params: Vec<Json>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    rows_affected: usize,
    last_insert_id: i64,
}

fn to_sql(v: &Json) -> Value {
    match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(if *b { 1 } else { 0 }),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().unwrap_or(0.0)),
        },
        Json::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(Json::Number)
            .unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        // The schema stores no blobs; covers live on disk.
        ValueRef::Blob(_) => Json::Null,
    }
}

fn select_rows(conn: &Connection, sql: &str, params: &[Json]) -> rusqlite::Result<Vec<Map<String, Json>>> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(params.iter().map(to_sql)))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut m = Map::new();
        for (i, name) in names.iter().enumerate() {
            m.insert(name.clone(), from_sql(row.get_ref(i)?));
        }
        out.push(m);
    }
    Ok(out)
}

fn exec_one(conn: &Connection, sql: &str, params: &[Json]) -> rusqlite::Result<usize> {
    let mut stmt = conn.prepare(sql)?;
    stmt.execute(params_from_iter(params.iter().map(to_sql)))
}

fn run_batch(conn: &mut Connection, statements: &[Stmt]) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let mut total = 0usize;
    for s in statements {
        total += exec_one(&tx, &s.sql, &s.params)?;
    }
    tx.commit()?;
    Ok(total)
}

fn lock_err<T>(_: T) -> String {
    "The database is unavailable (lock poisoned). Restart REWIND.".to_string()
}

#[tauri::command]
pub async fn db_select(
    state: tauri::State<'_, Db>,
    sql: String,
    params: Option<Vec<Json>>,
) -> Result<Vec<Map<String, Json>>, String> {
    let conn = state.0.lock().map_err(lock_err)?;
    select_rows(&conn, &sql, &params.unwrap_or_default()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_execute(
    state: tauri::State<'_, Db>,
    sql: String,
    params: Option<Vec<Json>>,
) -> Result<ExecResult, String> {
    let conn = state.0.lock().map_err(lock_err)?;
    let n = exec_one(&conn, &sql, &params.unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(ExecResult {
        rows_affected: n,
        last_insert_id: conn.last_insert_rowid(),
    })
}

#[tauri::command]
pub async fn db_batch(state: tauri::State<'_, Db>, statements: Vec<Stmt>) -> Result<usize, String> {
    let mut conn = state.0.lock().map_err(lock_err)?;
    run_batch(&mut conn, &statements).map_err(|e| e.to_string())
}

/// Copies the whole database (a consistent snapshot, including anything still in the WAL)
/// into `<app data>/backups/rewind-<label>-<time>.sqlite3`. Taken automatically before a
/// schema upgrade, so the previous version's data can always be recovered.
pub fn snapshot_to(conn: &Connection, dir: &Path, label: &str) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let safe: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')).take(40).collect();
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let path = dir.join(format!("rewind-{}-{}.sqlite3", if safe.is_empty() { "snapshot" } else { &safe }, secs));
    let target = path.to_string_lossy().into_owned();
    conn.execute("VACUUM INTO ?1", [target]).map_err(|e| format!("Couldn't save a database snapshot: {e}"))?;
    Ok(path)
}

#[tauri::command]
pub async fn db_snapshot(app: tauri::AppHandle, state: tauri::State<'_, Db>, label: String) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backups");
    let conn = state.0.lock().map_err(lock_err)?;
    snapshot_to(&conn, &dir, &label).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_is_all_or_nothing_and_snapshot_copies_everything() {
        let dir = std::env::temp_dir().join(format!("rewind-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = open(&dir.join("t.sqlite3")).unwrap();
        conn.execute_batch("CREATE TABLE g (id TEXT PRIMARY KEY, title TEXT NOT NULL)").unwrap();
        let ok = vec![Stmt { sql: "INSERT INTO g VALUES (?, ?)".into(), params: vec![Json::from("a"), Json::from("Deus Ex")] }];
        assert_eq!(run_batch(&mut conn, &ok).unwrap(), 1);
        let bad = vec![
            Stmt { sql: "INSERT INTO g VALUES (?, ?)".into(), params: vec![Json::from("b"), Json::from("Thief")] },
            Stmt { sql: "INSERT INTO g VALUES (?, ?)".into(), params: vec![Json::from("a"), Json::from("dup")] },
        ];
        assert!(run_batch(&mut conn, &bad).is_err());
        let rows = select_rows(&conn, "SELECT id FROM g ORDER BY id", &[]).unwrap();
        assert_eq!(rows.len(), 1, "failed batch rolled back");
        let snap = snapshot_to(&conn, &dir.join("backups"), "before-v5").unwrap();
        let copy = Connection::open(&snap).unwrap();
        let n: i64 = copy.query_row("SELECT COUNT(*) FROM g", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        drop(copy);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
