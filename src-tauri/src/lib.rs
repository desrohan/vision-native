use std::process::Command as StdCommand;
use std::fs;
use std::sync::Mutex;
use tauri::{
    tray::TrayIconBuilder,
    menu::{Menu, MenuItem},
    Manager, State, WindowEvent, Emitter,
};
use tauri_plugin_shell::{ShellExt, process::CommandChild};
use serde_json::Value;

/// Holds the sidecar child process so we can write to its stdin and kill it.
struct SidecarState {
    child: Option<CommandChild>,
}

#[tauri::command]
fn get_installed_apps() -> Result<Vec<String>, String> {
    let apps_dir = "/Applications";
    let mut apps: Vec<String> = Vec::new();

    let entries = fs::read_dir(apps_dir)
        .map_err(|e| format!("Failed to read /Applications: {}", e))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".app") {
            apps.push(name.trim_end_matches(".app").to_string());
        }
    }

    apps.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(apps)
}

#[tauri::command]
fn launch_app(path: String) -> Result<String, String> {
    StdCommand::new("open")
        .arg("-a")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", path, e))?;
    Ok(format!("Launched {}", path))
}

#[tauri::command]
fn open_url(url: String) -> Result<String, String> {
    StdCommand::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open URL {}: {}", url, e))?;
    Ok(format!("Opened {}", url))
}

#[tauri::command]
fn send_keyboard_shortcut(keys: String) -> Result<String, String> {
    let parts: Vec<&str> = keys.split('+').map(|s| s.trim()).collect();

    let mut modifiers = Vec::new();
    let mut key_char = "";

    for part in &parts {
        match part.to_lowercase().as_str() {
            "cmd" | "command" => modifiers.push("command down"),
            "shift" => modifiers.push("shift down"),
            "alt" | "option" => modifiers.push("option down"),
            "ctrl" | "control" => modifiers.push("control down"),
            _ => key_char = *part,
        }
    }

    let modifier_str = if modifiers.is_empty() {
        String::new()
    } else {
        format!(" using {{{}}}", modifiers.join(", "))
    };

    let script = format!(
        r#"tell application "System Events" to keystroke "{}"{}"#,
        key_char, modifier_str
    );

    StdCommand::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to send shortcut: {}", e))?;

    Ok(format!("Sent shortcut: {}", keys))
}

/// Send a JSON command to the sidecar's stdin.
#[tauri::command]
fn sidecar_send(
    state: State<'_, Mutex<SidecarState>>,
    message: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = s.child {
        child
            .write((message.trim().to_string() + "\n").as_bytes())
            .map_err(|e| format!("Failed to write to sidecar: {}", e))?;
        Ok(())
    } else {
        Err("Sidecar not running".to_string())
    }
}

/// Spawn the sidecar and wire up stdout event forwarding.
fn spawn_sidecar(app: &tauri::AppHandle) -> Result<CommandChild, String> {
    let shell = app.shell();
    let (mut rx, child) = shell
        .sidecar("vision-sidecar")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    let app_handle = app.clone();

    // Read sidecar stdout lines and emit as Tauri events
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    // Parse the JSON to determine event type
                    if let Ok(json) = serde_json::from_str::<Value>(&line_str) {
                        let event_type = json.get("type")
                            .and_then(|t| t.as_str())
                            .unwrap_or("unknown");

                        let event_name = format!("sidecar:{}", event_type);
                        let _ = app_handle.emit(&event_name, json.clone());

                        // Also emit generic event for the frontend
                        let _ = app_handle.emit("sidecar:message", json);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    eprintln!("[sidecar stderr] {}", line_str);
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[sidecar] terminated with {:?}", status);
                    let _ = app_handle.emit("sidecar:terminated", serde_json::json!({
                        "code": status.code,
                        "signal": status.signal,
                    }));
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(SidecarState { child: None }))
        .invoke_handler(tauri::generate_handler![
            launch_app,
            open_url,
            send_keyboard_shortcut,
            get_installed_apps,
            sidecar_send,
        ])
        .setup(|app| {
            // System tray
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Gestus", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                        "quit" => {
                            // Kill sidecar before quitting
                            if let Some(state) = app.try_state::<Mutex<SidecarState>>() {
                                if let Ok(mut s) = state.lock() {
                                    if let Some(child) = s.child.take() {
                                        let _ = child.kill();
                                    }
                                }
                            }
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Spawn sidecar
            match spawn_sidecar(app.handle()) {
                Ok(child) => {
                    let state = app.state::<Mutex<SidecarState>>();
                    let mut s = state.lock().unwrap();
                    s.child = Some(child);
                    println!("[gestus] Sidecar spawned successfully");
                }
                Err(e) => {
                    eprintln!("[gestus] Failed to spawn sidecar: {}", e);
                    // Non-fatal: app can still work for settings UI
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    window.hide().ok();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
