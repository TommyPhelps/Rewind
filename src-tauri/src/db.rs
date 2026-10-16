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
