use std::sync::Arc;
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

pub mod commands;
pub mod git_ops;
pub mod pty_mgr;
pub mod workspace;

async fn check_and_apply_update(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let updater = app.updater()?;
    if let Some(update) = updater.check().await? {
        log::info!("Update found: version {}", update.version);
        let mut downloaded = 0;
        update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    log::info!("Downloaded {downloaded}/{} bytes", content_length.unwrap_or(0));
                },
                || {
                    log::info!("Download finished, installing update");
                },
            )
            .await?;
        log::info!("Update installed. Relaunching app...");
        app.restart();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = Arc::new(pty_mgr::PtyManager::new());

    tauri::Builder::default()
        .manage(Arc::clone(&pty_manager))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_handle = app.handle().clone();

            // Background auto-updater task
            let updater_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                // ponytail: delay check 5s to avoid fighting startup load, upgrade to interval timer if polling wanted
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                if let Err(e) = check_and_apply_update(updater_handle).await {
                    log::error!("Auto-updater error: {e}");
                }
            });

            // Background listener forwarding PTY messages as Tauri event "pty-message"
            let pty_listener_handle = app_handle.clone();
            let mut pty_rx = pty_manager.subscribe();
            tauri::async_runtime::spawn(async move {
                while let Ok(msg) = pty_rx.recv().await {
                    if let Err(e) = pty_listener_handle.emit("pty-message", msg) {
                        log::error!("Failed to emit pty-message event: {e}");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::get_workspaces,
            commands::create_workspace,
            commands::update_workspace,
            commands::delete_workspace,
            commands::get_files,
            commands::get_file_content,
            commands::save_file_content,
            commands::get_git_status,
            commands::get_git_diff,
            commands::git_commit,
            commands::get_git_log,
            commands::git_stage,
            commands::git_unstage,
            commands::git_discard,
            commands::upload_image,
            commands::get_image_preview,
            commands::get_system_status,
            commands::pty_send,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
