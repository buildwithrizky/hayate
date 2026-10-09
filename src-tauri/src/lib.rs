use tauri_plugin_updater::UpdaterExt;

pub mod agent_core;
pub mod git_ops;
pub mod http_server;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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

            let port = std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(3456);

            // Spawn embedded Axum HTTP + WS server on 127.0.0.1:port
            let server_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http_server::start_server(port, Some(server_handle)).await {
                    eprintln!("ADE embedded server error: {e}");
                }
            });

            // Wait until Axum server binds and responds before webview renders/navigates
            tauri::async_runtime::block_on(async move {
                for _ in 0..50 {
                    if let Ok(Ok(stream)) = tokio::time::timeout(
                        std::time::Duration::from_millis(100),
                        tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")),
                    )
                    .await
                    {
                        drop(stream);
                        log::info!("Embedded Axum HTTP server confirmed listening on port {port}");
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                log::warn!("Axum server wait timed out before TCP bind check passed");
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
