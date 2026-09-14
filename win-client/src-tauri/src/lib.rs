use std::fs;
use std::path::PathBuf;
use tauri::{Manager, WindowEvent};
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};

#[tauri::command]
fn save_excel_file(filename: String, data: Vec<u8>) -> Result<String, String> {
    let download_dir = if let Ok(profile) = std::env::var("USERPROFILE") {
        PathBuf::from(profile).join("Downloads")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join("Downloads")
    } else {
        PathBuf::from(".")
    };

    if !download_dir.exists() {
        let _ = fs::create_dir_all(&download_dir);
    }

    let mut target_path = download_dir.join(&filename);

    // 파일명이 이미 존재하면 번호 추가
    if target_path.exists() {
        let stem = target_path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = target_path.extension().and_then(|e| e.to_str()).unwrap_or("xlsx");
        let mut count = 1;
        loop {
            let candidate_name = format!("{}_{}.{}", stem, count, ext);
            let candidate = download_dir.join(&candidate_name);
            if !candidate.exists() {
                target_path = candidate;
                break;
            }
            count += 1;
        }
    }

    fs::write(&target_path, data).map_err(|e| format!("파일 저장 실패: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_file_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![save_excel_file, open_file_in_folder])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| match event {
      WindowEvent::CloseRequested { api, .. } => {
        let _ = window.hide();
        api.prevent_close();
      }
      _ => {}
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
