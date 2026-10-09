pub mod agent_core;
pub mod git_ops;
pub mod http_server;
pub mod pty_mgr;
pub mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn embedded Axum HTTP + WS server on 127.0.0.1:3456
            tauri::async_runtime::spawn(async move {
                let port = std::env::var("PORT")
                    .ok()
                    .and_then(|p| p.parse::<u16>().ok())
                    .unwrap_or(3456);

                if let Err(e) = http_server::start_server(port).await {
                    eprintln!("ADE embedded server error: {e}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
