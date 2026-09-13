#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod imports;
mod launch;
mod model;
mod storage;
mod system_auth;

use model::Document;
use std::{
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};
use tauri::{Emitter, Manager, State};

struct Session {
    connection: rusqlite::Connection,
    last_active: Instant,
    wall_active: SystemTime,
    timeout: Duration,
}
impl Session {
    fn expired(&self) -> bool {
        self.last_active.elapsed() >= self.timeout
            || self
                .wall_active
                .elapsed()
                .map_or(true, |d| d >= self.timeout)
    }
}
#[derive(Default)]
struct Vault {
    session: Option<Session>,
    generation: u64,
    unlocking: bool,
}
type Shared = Mutex<Vault>;
fn access<T>(
    state: &Shared,
    f: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    let mut vault = state.lock().map_err(|_| "Vault unavailable")?;
    if vault.session.as_ref().is_some_and(Session::expired) {
        vault.session = None;
        vault.generation += 1;
    }
    f(vault.session.as_mut().ok_or("LOCKED")?)
}
#[tauri::command]
async fn unlock(app: tauri::AppHandle) -> Result<Document, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        let generation = {
            let mut vault = shared.lock().map_err(|_| "Vault unavailable")?;
            if vault.unlocking {
                return Err("Authentication is already in progress".into());
            }
            vault.session = None;
            vault.unlocking = true;
            vault.generation += 1;
            vault.generation
        };
        let auth = system_auth::challenge();
        let mut vault = shared.lock().map_err(|_| "Vault unavailable")?;
        vault.unlocking = false;
        auth?;
        if vault.generation != generation {
            return Err("Unlock cancelled".into());
        }
        let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let connection = storage::unlock(&directory.join("inventory.db"))?;
        let data = storage::read(&connection)?;
        vault.session = Some(Session {
            connection,
            last_active: Instant::now(),
            wall_active: SystemTime::now(),
            timeout: Duration::from_secs(data.settings.auto_lock_minutes * 60),
        });
        Ok(data)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn lock(state: State<Shared>, app: tauri::AppHandle) -> Result<(), String> {
    let mut vault = state.lock().map_err(|_| "Vault unavailable")?;
    vault.session = None;
    vault.generation += 1;
    let _ = app.emit("vault-locked", ());
    Ok(())
}
#[tauri::command]
fn activity(state: State<Shared>) -> Result<(), String> {
    access(&state, |s| {
        s.last_active = Instant::now();
        s.wall_active = SystemTime::now();
        Ok(())
    })
}
#[tauri::command]
fn session_status(state: State<Shared>) -> bool {
    access(&state, |_| Ok(())).is_ok()
}
#[tauri::command]
fn save_inventory(state: State<Shared>, document: Document) -> Result<Document, String> {
    access(&state, |s| {
        let data = storage::save(&mut s.connection, document)?;
        s.timeout = Duration::from_secs(data.settings.auto_lock_minutes * 60);
        Ok(data)
    })
}
#[tauri::command]
fn scan_configs(state: State<Shared>) -> Result<imports::Scan, String> {
    access(&state, |_| {
        let home = std::env::var("HOME").map_err(|_| "Home directory unavailable")?;
        Ok(imports::scan(std::path::Path::new(&home)))
    })
}
fn component_action(
    s: &Session,
    id: &str,
) -> Result<(model::Component, model::LaunchAction, String), String> {
    let d = storage::read(&s.connection)?;
    let c = d
        .components
        .iter()
        .find(|c| c.id == id)
        .ok_or("Component no longer exists")?;
    let t = d
        .component_types
        .iter()
        .find(|t| t.id == c.component_type_id)
        .ok_or("Component type is missing")?;
    let action = c
        .launch_action
        .as_ref()
        .or(t.launch_action.as_ref())
        .ok_or("No launch action configured")?;
    Ok((c.clone(), action.clone(), d.settings.terminal))
}
#[tauri::command]
fn preview_launch(state: State<Shared>, id: String) -> Result<String, String> {
    access(&state, |s| {
        let (c, a, _) = component_action(s, &id)?;
        launch::preview(&a, &c)
    })
}
#[tauri::command]
async fn launch_component(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (c, a, terminal) = access(&app.state::<Shared>(), |s| component_action(s, &id))?;
        // A system Automation prompt must not block the idle lock or other vault commands.
        launch::run(&a, &c, &terminal)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![
            unlock,
            lock,
            activity,
            session_status,
            save_inventory,
            scan_configs,
            preview_launch,
            launch_component
        ])
        .setup(|app| {
            // Hold an OS file lock for the process lifetime: two first-run instances
            // must never generate different keys for the same database.
            use std::os::{
                fd::AsRawFd,
                unix::fs::{OpenOptionsExt, PermissionsExt},
            };
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
            let file = std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .mode(0o600)
                .open(directory.join("instance.lock"))?;
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
                return Err("OpsPortal is already running".into());
            }
            app.manage(file);
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let shared = handle.state::<Shared>();
                if let Ok(mut v) = shared.lock() {
                    if v.session.as_ref().is_some_and(Session::expired) {
                        v.session = None;
                        v.generation += 1;
                        let _ = handle.emit("vault-locked", ());
                    }
                };
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Failed to start OpsPortal");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_operation_requires_live_session() {
        let shared = Shared::default();
        assert_eq!(access(&shared, |_| Ok(())).unwrap_err(), "LOCKED");
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        shared.lock().unwrap().session = Some(Session {
            connection: conn,
            last_active: Instant::now() - Duration::from_secs(2),
            wall_active: SystemTime::now(),
            timeout: Duration::from_secs(1),
        });
        assert!(access(&shared, |_| Ok(())).is_err());
        assert!(shared.lock().unwrap().session.is_none());
    }
}
