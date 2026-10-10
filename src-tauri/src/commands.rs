use base64::Engine;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use sysinfo::System;

use crate::git_ops;
use crate::pty_mgr::PtyManager;
use crate::workspace;

fn resolve_dir_path(path: &str) -> Result<String, String> {
    let p = PathBuf::from(path);
    if !p.exists() || !p.is_dir() {
        return Err("Directory path does not exist".to_string());
    }
    Ok(p.canonicalize().unwrap_or(p).to_string_lossy().to_string())
}

#[tauri::command]
pub async fn pick_folder(_app: tauri::AppHandle) -> Result<Value, String> {
    match workspace::pick_folder_dialog().await {
        Ok(Some(ws)) => Ok(json!(ws)),
        Ok(None) => Ok(json!({ "canceled": true })),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn get_workspaces() -> Result<Vec<workspace::Workspace>, String> {
    Ok(workspace::load_workspaces().await)
}

#[tauri::command]
pub async fn create_workspace(
    name: Option<String>,
    path: Option<String>,
) -> Result<workspace::Workspace, String> {
    let name = name.unwrap_or_default().trim().to_string();
    let path = path.unwrap_or_default().trim().to_string();
    if name.is_empty() || path.is_empty() {
        return Err("name and path required".to_string());
    }

    let resolved = resolve_dir_path(&path)?;
    let mut list = workspace::load_workspaces().await;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let ws = workspace::Workspace {
        id: format!("ws_{}", &uuid::Uuid::new_v4().simple().to_string()[..10]),
        name,
        path: resolved,
        created_at: now,
    };

    list.push(ws.clone());
    workspace::save_workspaces(&list).await?;
    Ok(ws)
}

#[tauri::command]
pub async fn update_workspace(
    id: String,
    name: Option<String>,
    path: Option<String>,
) -> Result<workspace::Workspace, String> {
    let mut list = workspace::load_workspaces().await;
    let idx = list
        .iter()
        .position(|w| w.id == id)
        .ok_or_else(|| "Workspace not found".to_string())?;

    let name = name.unwrap_or_default().trim().to_string();
    let path = path.unwrap_or_default().trim().to_string();
    if name.is_empty() || path.is_empty() {
        return Err("name and path required".to_string());
    }

    let resolved = resolve_dir_path(&path)?;
    list[idx].name = name;
    list[idx].path = resolved;

    workspace::save_workspaces(&list).await?;
    Ok(list[idx].clone())
}

#[tauri::command]
pub async fn delete_workspace(id: String) -> Result<Value, String> {
    let mut list = workspace::load_workspaces().await;
    let idx = list
        .iter()
        .position(|w| w.id == id)
        .ok_or_else(|| "Workspace not found".to_string())?;

    let deleted = list.remove(idx);
    workspace::save_workspaces(&list).await?;
    Ok(json!({ "ok": true, "deleted": deleted }))
}

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
pub async fn get_git_status(path: String) -> Result<git_ops::GitStatusResult, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    git_ops::git_status(&path).await
}

#[tauri::command]
pub async fn get_git_diff(
    path: String,
    file: Option<String>,
    staged: Option<bool>,
    commit: Option<String>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    let staged_only = staged.unwrap_or(false);
    let diff = git_ops::git_diff(&path, file.as_deref(), staged_only, commit.as_deref()).await?;
    Ok(json!({ "diff": diff, "file": file }))
}

#[tauri::command]
pub async fn git_commit(
    path: String,
    message: String,
    stage_all: Option<bool>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    if message.trim().is_empty() {
        return Err("message required".to_string());
    }
    let stage = stage_all != Some(false);
    let output = git_ops::git_commit(&path, &message, stage).await?;
    Ok(json!({ "ok": true, "output": output }))
}

#[tauri::command]
pub async fn get_git_log(path: String) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    let commits = git_ops::git_log(&path).await?;
    Ok(json!({ "commits": commits }))
}

#[tauri::command]
pub async fn git_stage(
    path: String,
    file: Option<String>,
    all: Option<bool>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    git_ops::git_stage(&path, file.as_deref(), all == Some(true)).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn git_unstage(
    path: String,
    file: Option<String>,
    all: Option<bool>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    git_ops::git_unstage(&path, file.as_deref(), all == Some(true)).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn git_discard(
    path: String,
    file: Option<String>,
    all: Option<bool>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    git_ops::git_discard(&path, file.as_deref(), all == Some(true)).await?;
    Ok(json!({ "ok": true }))
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

#[tauri::command]
pub async fn get_system_status() -> Result<Value, String> {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let total_b = sys.total_memory();
    let used_b = sys.used_memory();

    let total_gb = (total_b as f64) / (1024.0 * 1024.0 * 1024.0);
    let used_gb = (used_b as f64) / (1024.0 * 1024.0 * 1024.0);
    let pct = if total_b > 0 {
        ((used_b as f64 / total_b as f64) * 100.0).round() as u64
    } else {
        0
    };

    Ok(json!({
        "processRssMb": 35,
        "systemUsedGb": format!("{used_gb:.1}"),
        "systemTotalGb": format!("{total_gb:.1}"),
        "systemPercent": pct,
    }))
}

#[tauri::command]
pub async fn pty_send(msg: Value, state: tauri::State<'_, Arc<PtyManager>>) -> Result<(), String> {
    let action = msg
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing action".to_string())?;

    match action {
        "spawn" => {
            let sid = msg.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            let repo = msg.get("repoPath").and_then(|v| v.as_str()).unwrap_or("");
            let cols = msg.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
            let rows = msg.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
            if sid.is_empty() || repo.is_empty() {
                return Err("sessionId and repoPath required".to_string());
            }
            state.spawn(sid, repo, cols, rows)?;
        }
        "input" => {
            let sid = msg.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            let input_data = msg.get("data").and_then(|v| v.as_str()).unwrap_or("");
            if sid.is_empty() {
                return Err("sessionId required".to_string());
            }
            state.write(sid, input_data)?;
        }
        "resize" => {
            let sid = msg.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            let cols = msg.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
            let rows = msg.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
            if sid.is_empty() {
                return Err("sessionId required".to_string());
            }
            state.resize(sid, cols, rows)?;
        }
        "kill" | "stop" => {
            let sid = msg.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            if sid.is_empty() {
                return Err("sessionId required".to_string());
            }
            state.kill(sid)?;
        }
        other => return Err(format!("unknown action: {other}")),
    }

    Ok(())
}
