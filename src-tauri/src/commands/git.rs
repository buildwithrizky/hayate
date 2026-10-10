use serde_json::{json, Value};

use crate::git_ops;

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
