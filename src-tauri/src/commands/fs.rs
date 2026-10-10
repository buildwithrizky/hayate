use base64::Engine;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

use crate::pty_mgr::PtyManager;
use crate::workspace;

#[tauri::command]
pub async fn get_files(
    path: String,
    workspace_id: Option<String>,
) -> Result<Vec<workspace::FileItem>, String> {
    let mut target = if path.trim().is_empty() {
        None
    } else {
        Some(path)
    };
    if target.is_none()
        && let Some(ws_id) = workspace_id
    {
        let list = workspace::load_workspaces().await;
        if let Some(ws) = list.into_iter().find(|w| w.id == ws_id) {
            target = Some(ws.path);
        }
    }

    let target_path = target.ok_or_else(|| "path or workspaceId required".to_string())?;
    let res = workspace::list_files(&target_path).await?;
    Ok(res.items)
}

#[tauri::command]
pub async fn get_file_content(path: String) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    match workspace::read_file_content(&path).await {
        Ok(res) => Ok(json!(res)),
        Err((_, err)) => Err(err),
    }
}

#[tauri::command]
pub async fn save_file_content(path: String, content: String) -> Result<Value, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("path required".to_string());
    }
    let size = workspace::write_file_content(p, &content).await?;
    Ok(json!({ "ok": true, "path": p, "size": size }))
}

#[tauri::command]
pub async fn upload_image(
    session_id: Option<String>,
    file_name: Option<String>,
    base64_data: String,
    state: tauri::State<'_, Arc<PtyManager>>,
) -> Result<Value, String> {
    let (bytes, ext) = if let Some((b, e)) = workspace::decode_image_data(&base64_data) {
        (b, e)
    } else {
        let b64_clean = base64_data.trim();
        let engine = base64::engine::general_purpose::STANDARD;
        let decoded = engine
            .decode(b64_clean)
            .map_err(|e| format!("Invalid base64 payload: {e}"))?;
        let ext = file_name
            .as_deref()
            .and_then(|f| f.split('.').next_back())
            .map(|e| e.to_lowercase())
            .unwrap_or_else(|| "png".to_string());
        (decoded, ext)
    };

    let repo_path = session_id
        .as_deref()
        .and_then(|sid| state.get_repo_path(sid));
    let res = workspace::save_image_bytes(repo_path.as_deref(), &bytes, &ext).await?;
    Ok(json!(res))
}

#[tauri::command]
pub async fn get_image_preview(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => return Err("Unsupported image extension".to_string()),
    };

    let bytes = tokio::fs::read(p)
        .await
        .map_err(|e| format!("Image file not found: {e}"))?;

    let engine = base64::engine::general_purpose::STANDARD;
    let b64 = engine.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}
