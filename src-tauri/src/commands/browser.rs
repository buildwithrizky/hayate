use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl,
};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Clone)]
struct BrowserTitlePayload {
    tab_id: String,
    title: String,
}

#[derive(Serialize, Clone)]
struct BrowserLoadedPayload {
    tab_id: String,
    url: String,
}

pub fn get_titlebar_offset(window: &tauri::Window) -> f64 {
    #[cfg(target_os = "macos")]
    {
        if let (Ok(inner), Ok(outer), Ok(scale)) = (
            window.inner_position(),
            window.outer_position(),
            window.scale_factor(),
        ) {
            let diff_y = (inner.y - outer.y) as f64 / scale;
            if diff_y > 0.0 {
                return diff_y;
            }
        }
        28.0
    }
    #[cfg(not(target_os = "macos"))]
    {
        0.0
    }
}

#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    tab_id: String,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let offset_y = get_titlebar_offset(&window);
    let adjusted_y = bounds.y + offset_y;

    if let Some(webview) = app.get_webview(&tab_id) {
        let parsed: Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
        webview.navigate(parsed).map_err(|e| e.to_string())?;
        webview
            .set_bounds(tauri::Rect {
                position: LogicalPosition::new(bounds.x, adjusted_y).into(),
                size: LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)).into(),
            })
            .map_err(|e| e.to_string())?;
        let _ = webview.show();
        return Ok(());
    }

    let parsed: Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;

    let tid_title = tab_id.clone();
    let app_title = app.clone();
    let tid_loaded = tab_id.clone();
    let app_loaded = app.clone();

    let builder = WebviewBuilder::new(&tab_id, WebviewUrl::External(parsed))
        .on_document_title_changed(move |_wv, title| {
            let _ = app_title.emit(
                "browser-title",
                BrowserTitlePayload {
                    tab_id: tid_title.clone(),
                    title,
                },
            );
        })
        .on_page_load(move |_wv, payload| {
            let _ = app_loaded.emit(
                "browser-loaded",
                BrowserLoadedPayload {
                    tab_id: tid_loaded.clone(),
                    url: payload.url().to_string(),
                },
            );
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, adjusted_y),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(|e| format!("Failed to create child webview: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, tab_id: String, url: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_id)
        .ok_or_else(|| format!("Webview {tab_id} not found"))?;
    let parsed: Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    tab_id: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let offset_y = app
        .get_window("main")
        .map(|w| get_titlebar_offset(&w))
        .unwrap_or(0.0);
    let adjusted_y = bounds.y + offset_y;
    let webview = app
        .get_webview(&tab_id)
        .ok_or_else(|| format!("Webview {tab_id} not found"))?;
    webview
        .set_bounds(tauri::Rect {
            position: LogicalPosition::new(bounds.x, adjusted_y).into(),
            size: LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)).into(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_set_visible(
    app: AppHandle,
    tab_id: String,
    visible: bool,
) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_id)
        .ok_or_else(|| format!("Webview {tab_id} not found"))?;
    if visible {
        webview.show().map_err(|e| e.to_string())
    } else {
        webview.hide().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_id)
        .ok_or_else(|| format!("Webview {tab_id} not found"))?;
    webview.reload().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_id)
        .ok_or_else(|| format!("Webview {tab_id} not found"))?;
    webview
        .eval("window.history.back()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    let webview = app
        .get_webview(&tab_id)
        .ok_or_else(|| format!("Webview {tab_id} not found"))?;
    webview
        .eval("window.history.forward()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, tab_id: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&tab_id) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
