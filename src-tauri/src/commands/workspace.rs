use serde_json::{json, Value};
use std::path::PathBuf;

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
