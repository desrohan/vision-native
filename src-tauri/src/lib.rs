use std::process::Command;
use std::fs;
use tauri::{
    tray::TrayIconBuilder,
    menu::{Menu, MenuItem},
    Manager, WindowEvent,
};

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
    Command::new("open")
        .arg("-a")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", path, e))?;
    Ok(format!("Launched {}", path))
}

#[tauri::command]
fn open_url(url: String) -> Result<String, String> {
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open URL {}: {}", url, e))?;
    Ok(format!("Opened {}", url))
}

#[tauri::command]
fn send_keyboard_shortcut(keys: String) -> Result<String, String> {
    // Use AppleScript for reliable key simulation on macOS
    // keys format: "cmd+shift+p"
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

    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to send shortcut: {}", e))?;

    Ok(format!("Sent shortcut: {}", keys))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            launch_app,
            open_url,
            send_keyboard_shortcut,
            get_installed_apps
        ])
        .setup(|app| {
            // System tray
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Vision", true, None::<&str>)?;
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
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide main window to tray instead of quitting
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
