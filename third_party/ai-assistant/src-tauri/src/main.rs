#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

struct BackendChild(Mutex<Option<Child>>);

#[cfg(target_os = "windows")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "windows")]
fn spawn_backend(_app: &AppHandle) -> Option<Child> {
    let distro = std::env::var("AI_ASSISTANT_WSL_DISTRO")
        .unwrap_or_else(|_| "Ubuntu-24.04".to_string());
    let project_dir = std::env::var("AI_ASSISTANT_WSL_PROJECT_PATH")
        .unwrap_or_else(|_| "/home/thovinh/NemoClaw/third_party/ai-assistant".to_string());
    let host = std::env::var("AI_ASSISTANT_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("AI_ASSISTANT_PORT").unwrap_or_else(|_| "4317".to_string());
    let script = format!(
        "cd {} && AI_ASSISTANT_HOST={} AI_ASSISTANT_PORT={} bash scripts/start-backend.sh",
        shell_quote(&project_dir),
        shell_quote(&host),
        shell_quote(&port)
    );

    Command::new("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("bash")
        .arg("-lc")
        .arg(script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

#[cfg(not(target_os = "windows"))]
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
