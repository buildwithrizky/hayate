use base64::Engine;
use serde_json::{Value, json};
use std::path::Path;
use tauri::State;

use crate::fs_watcher::SharedFsWatcher;
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
) -> Result<Value, String> {
    let _ = session_id;
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

    let res = workspace::save_image_bytes(&bytes, &ext).await?;
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
pub async fn watch_directory(
    watcher: State<'_, SharedFsWatcher>,
    path: String,
) -> Result<(), String> {
    watcher.watch(&path).await
}

#[tauri::command]
pub async fn unwatch_directory(watcher: State<'_, SharedFsWatcher>) -> Result<(), String> {
    watcher.unwatch().await
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    let p = Path::new(path.trim());
    if p.as_os_str().is_empty() {
        return Err("path required".to_string());
    }
    if let Some(parent) = p.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create parent directory: {e}"))?;
    }
    tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(p)
        .await
        .map_err(|e| format!("Failed to create file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn create_dir(path: String) -> Result<(), String> {
    let p = Path::new(path.trim());
    if p.as_os_str().is_empty() {
        return Err("path required".to_string());
    }
    tokio::fs::create_dir_all(p)
        .await
        .map_err(|e| format!("Failed to create directory: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    let old = Path::new(old_path.trim());
    let new = Path::new(new_path.trim());
    if old.as_os_str().is_empty() || new.as_os_str().is_empty() {
        return Err("old_path and new_path required".to_string());
    }
    tokio::fs::rename(old, new)
        .await
        .map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn move_path(src_path: String, dst_path: String) -> Result<(), String> {
    let src = Path::new(src_path.trim());
    let dst = Path::new(dst_path.trim());
    if src.as_os_str().is_empty() || dst.as_os_str().is_empty() {
        return Err("src_path and dst_path required".to_string());
    }
    if !src.exists() {
        return Err(format!("Source path does not exist: {}", src.display()));
    }
    if let Some(parent) = dst.parent().filter(|p| !p.as_os_str().is_empty()) {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create destination parent: {e}"))?;
    }
    tokio::fs::rename(src, dst)
        .await
        .map_err(|e| format!("Failed to move: {e}"))?;
    Ok(())
}

fn copy_dir_all_sync(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all_sync(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn copy_path(src_path: String, dst_path: String) -> Result<(), String> {
    let src = Path::new(src_path.trim()).to_path_buf();
    let dst = Path::new(dst_path.trim()).to_path_buf();
    if src.as_os_str().is_empty() || dst.as_os_str().is_empty() {
        return Err("src_path and dst_path required".to_string());
    }
    if !src.exists() {
        return Err(format!("Source path does not exist: {}", src.display()));
    }
    if let Some(parent) = dst.parent().filter(|p| !p.as_os_str().is_empty()) {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create destination parent: {e}"))?;
    }

    let is_dir = tokio::fs::metadata(&src)
        .await
        .map_err(|e| format!("Metadata error: {e}"))?
        .is_dir();

    if is_dir {
        tokio::task::spawn_blocking(move || copy_dir_all_sync(&src, &dst))
            .await
            .map_err(|e| format!("Task spawn error: {e}"))?
            .map_err(|e| format!("Failed to copy directory: {e}"))?;
    } else {
        tokio::fs::copy(&src, &dst)
            .await
            .map_err(|e| format!("Failed to copy file: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(path.trim());
    if p.as_os_str().is_empty() {
        return Err("path required".to_string());
    }
    let metadata = tokio::fs::metadata(p)
        .await
        .map_err(|e| format!("Path not found: {e}"))?;

    // Try OS trash first (Safe Delete)
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Finder\" to delete POSIX file \"{}\"",
            p.to_string_lossy()
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
        );
        let status = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .status()
            .await;
        if status.is_ok_and(|st| st.success()) {
            return Ok(());
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = tokio::process::Command::new("gio")
            .arg("trash")
            .arg(p)
            .status()
            .await;
        if let Ok(st) = status {
            if st.success() {
                return Ok(());
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::Delete{}(\"{}\", [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
            if metadata.is_dir() {
                "Directory"
            } else {
                "File"
            },
            p.to_string_lossy().replace('"', "`\"")
        );
        let status = tokio::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(&script)
            .status()
            .await;
        if let Ok(st) = status {
            if st.success() {
                return Ok(());
            }
        }
    }

    // Fallback: permanent deletion if OS trash unavailable
    if metadata.is_dir() {
        tokio::fs::remove_dir_all(p)
            .await
            .map_err(|e| format!("Failed to remove directory: {e}"))?;
    } else {
        tokio::fs::remove_file(p)
            .await
            .map_err(|e| format!("Failed to remove file: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("path required".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .arg("-R")
            .arg(p)
            .status()
            .await
            .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        tokio::process::Command::new("explorer")
            .arg(format!("/select,{p}"))
            .status()
            .await
            .map_err(|e| format!("Failed to reveal in Explorer: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if Path::new(p).is_dir() {
            p.to_string()
        } else {
            Path::new(p)
                .parent()
                .map(|parent| parent.to_string_lossy().to_string())
                .unwrap_or_else(|| p.to_string())
        };
        tokio::process::Command::new("xdg-open")
            .arg(target)
            .status()
            .await
            .map_err(|e| format!("Failed to reveal path: {e}"))?;
    }
    Ok(())
}
