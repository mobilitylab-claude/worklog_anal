use std::fs;
use std::path::PathBuf;
use tauri::{Manager, WindowEvent};
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

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

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::{Command, Stdio};
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        if let Ok(mut child) = Command::new("cmd")
            .args(["/C", "clip"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            let _ = child.wait();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      // 이미 실행 중인 인스턴스가 있을 때 새 인스턴스가 호출되면 기존 창을 복원 및 포커스
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }))
    .invoke_handler(tauri::generate_handler![save_excel_file, open_file_in_folder, copy_to_clipboard])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // 트레이 우클릭 컨텍스트 메뉴 생성
      let show_item = MenuItem::with_id(app, "show", "창 열기", true, None::<&str>)?;
      let hide_item = MenuItem::with_id(app, "hide", "창 숨기기", true, None::<&str>)?;
      let separator = PredefinedMenuItem::separator(app)?;
      let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;

      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Jira Worklog Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "show" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
              }
            }
            "hide" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
              }
            }
            "quit" => {
              app.exit(0);
            }
            _ => {}
          }
        })
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
