#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

struct BackendChild(Mutex<Option<Child>>);

fn repo_root_from_exe(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().app_data_dir() {
        return dir;
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn spawn_backend(_app: &AppHandle) -> Option<Child> {
    let current_dir = std::env::current_dir().ok()?;
    let project_dir = current_dir;
    let script = format!(
        "cd '{}' && bash scripts/start-backend.sh",
        project_dir.display()
    );

    Command::new("bash")
        .arg("-lc")
        .arg(script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
            }

            let backend = spawn_backend(&app.handle());
            app.manage(BackendChild(Mutex::new(backend)));
            let _ = app.emit("desktop-ready", "AI Assistant desktop shell ready");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<BackendChild>() {
                    if let Ok(mut child_guard) = state.0.lock() {
                        if let Some(mut child) = child_guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
