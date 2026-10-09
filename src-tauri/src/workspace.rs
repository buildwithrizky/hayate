use base64::Engine;
use rfd::AsyncFileDialog;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub size: u64,
    #[serde(rename = "modifiedTime")]
    pub modified_time: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BrowseResult {
    pub current: String,
    pub dirs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FilesResult {
    pub path: String,
    pub items: Vec<FileItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContentResult {
    pub path: String,
    pub content: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadImageResult {
    pub ok: bool,
    pub path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub token: String,
    pub label: String,
    #[serde(rename = "previewUrl")]
    pub preview_url: String,
}

pub fn get_ade_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ADE_CONFIG_DIR") {
        PathBuf::from(dir)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".ade")
    }
}

pub fn get_workspaces_file() -> PathBuf {
    get_ade_dir().join("workspaces.json")
}

pub async fn load_workspaces() -> Vec<Workspace> {
    let file = get_workspaces_file();
    match fs::read_to_string(&file).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub async fn save_workspaces(list: &[Workspace]) -> Result<(), String> {
    let dir = get_ade_dir();
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create ADE config dir: {e}"))?;
    let file = get_workspaces_file();
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&file, json)
        .await
        .map_err(|e| format!("Failed to save workspaces.json: {e}"))?;
    Ok(())
}

pub async fn pick_folder_dialog() -> Result<Option<Workspace>, String> {
    let handle = AsyncFileDialog::new()
        .set_title("Select Project Folder")
        .pick_folder()
        .await;

    if let Some(folder) = handle {
        let path_buf = folder.path().to_path_buf();
        let path_str = path_buf.to_string_lossy().to_string();
        let name = path_buf
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());

        let mut list = load_workspaces().await;
        if let Some(existing) = list.iter().find(|w| w.path == path_str) {
            return Ok(Some(existing.clone()));
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let ws = Workspace {
            id: format!("ws_{}", &uuid::Uuid::new_v4().simple().to_string()[..10]),
            name,
            path: path_str,
            created_at: now,
        };

        list.push(ws.clone());
        save_workspaces(&list).await?;
        Ok(Some(ws))
    } else {
        Ok(None)
    }
}

pub async fn browse_dirs(dir: Option<String>) -> Result<BrowseResult, String> {
    let target = if let Some(d) = dir {
        PathBuf::from(d)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
    };

    let target = target.canonicalize().map_err(|e| e.to_string())?;
    let mut entries = fs::read_dir(&target).await.map_err(|e| e.to_string())?;
    let mut dirs = Vec::new();

    while let Ok(Some(entry)) = entries.next_entry().await {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }
        if let Ok(ft) = entry.file_type().await {
            if ft.is_dir() {
                dirs.push(entry.path().to_string_lossy().to_string());
            }
        }
    }
    dirs.sort();

    Ok(BrowseResult {
        current: target.to_string_lossy().to_string(),
        dirs,
    })
}

pub async fn list_files(target_path: &str) -> Result<FilesResult, String> {
    let resolved = PathBuf::from(target_path)
        .canonicalize()
        .map_err(|e| format!("Invalid path {target_path}: {e}"))?;

    let mut entries = fs::read_dir(&resolved).await.map_err(|e| e.to_string())?;
    let mut items = Vec::new();

    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" || name.starts_with(".DS_Store") {
            continue;
        }

        let full_path = entry.path().to_string_lossy().to_string();
        let mut is_directory = false;
        let mut size = 0u64;
        let mut modified_time = 0u64;

        if let Ok(meta) = entry.metadata().await {
            is_directory = meta.is_dir();
            size = meta.len();
            if let Ok(mtime) = meta.modified() {
                if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                    modified_time = dur.as_millis() as u64;
                }
            }
        }

        items.push(FileItem {
            name,
            path: full_path,
            is_directory,
            size,
            modified_time,
        });
    }

    items.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            b.is_directory.cmp(&a.is_directory)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(FilesResult {
        path: resolved.to_string_lossy().to_string(),
        items,
    })
}

pub async fn read_file_content(path_str: &str) -> Result<FileContentResult, (u16, String)> {
    let path = PathBuf::from(path_str);
    let meta = fs::metadata(&path)
        .await
        .map_err(|e| (400, format!("File not found: {e}")))?;

    if meta.is_dir() {
        return Err((400, "Path is directory".to_string()));
    }

    let max_bytes = 1024 * 1024; // 1MB
    if meta.len() > max_bytes {
        return Err((413, "File too large (> 1MB)".to_string()));
    }

    let content = fs::read_to_string(&path)
        .await
        .map_err(|e| (400, format!("Failed to read file: {e}")))?;

    Ok(FileContentResult {
        path: path.to_string_lossy().to_string(),
        content,
        size: meta.len(),
    })
}

pub async fn write_file_content(path_str: &str, content: &str) -> Result<u64, String> {
    let path = PathBuf::from(path_str);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(content.len() as u64)
}

pub async fn save_image_bytes(
    repo_path: Option<&str>,
    bytes: &[u8],
    ext: &str,
) -> Result<UploadImageResult, String> {
    let mut index = 1u32;

    if let Some(repo) = repo_path {
        let ade_images_dir = Path::new(repo).join(".ade").join("images");
        fs::create_dir_all(&ade_images_dir)
            .await
            .map_err(|e| e.to_string())?;

        if let Ok(mut rd) = fs::read_dir(&ade_images_dir).await {
            while let Ok(Some(ent)) = rd.next_entry().await {
                let name = ent.file_name().to_string_lossy().to_string();
                if name.starts_with("image") {
                    if let Some(num_part) = name.strip_prefix("image").and_then(|s| s.split('.').next()) {
                        if let Ok(num) = num_part.parse::<u32>() {
                            if num >= index {
                                index = num + 1;
                            }
                        }
                    }
                }
            }
        }

        let filename = format!("image{index}.{ext}");
        let target_path = ade_images_dir.join(&filename);
        fs::write(&target_path, bytes).await.map_err(|e| e.to_string())?;

        // symlink in repo root: imageN.ext -> .ade/images/imageN.ext
        let symlink_path = Path::new(repo).join(&filename);
        let _ = fs::remove_file(&symlink_path).await;
        #[cfg(unix)]
        let _ = tokio::fs::symlink(Path::new(".ade").join("images").join(&filename), &symlink_path).await;

        let target_str = target_path.to_string_lossy().to_string();
        Ok(UploadImageResult {
            ok: true,
            path: target_str.clone(),
            relative_path: filename.clone(),
            token: format!("[{filename}]"),
            label: format!("Image {index}"),
            preview_url: format!("/api/image-preview?path={}", urlencoding(&target_str)),
        })
    } else {
        let tmp = std::env::temp_dir();
        let filename = format!("image{index}.{ext}");
        let target_path = tmp.join(&filename);
        fs::write(&target_path, bytes).await.map_err(|e| e.to_string())?;

        let target_str = target_path.to_string_lossy().to_string();
        Ok(UploadImageResult {
            ok: true,
            path: target_str.clone(),
            relative_path: filename.clone(),
            token: format!("[{filename}]"),
            label: format!("Image {index}"),
            preview_url: format!("/api/image-preview?path={}", urlencoding(&target_str)),
        })
    }
}

pub fn decode_image_data(data_uri: &str) -> Option<(Vec<u8>, String)> {
    if let Some(rest) = data_uri.strip_prefix("data:image/") {
        if let Some((mime_type, b64)) = rest.split_once(";base64,") {
            let ext = match mime_type {
                "png" => "png",
                "jpeg" | "jpg" => "jpg",
                "webp" => "webp",
                "gif" => "gif",
                "svg+xml" => "svg",
                _ => return None,
            };
            let engine = base64::engine::general_purpose::STANDARD;
            if let Ok(bytes) = engine.decode(b64.trim()) {
                return Some((bytes, ext.to_string()));
            }
        }
    }
    None
}

fn urlencoding(s: &str) -> String {
    let mut result = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            result.push(b as char);
        } else {
            result.push_str(&format!("%{:02X}", b));
        }
    }
    result
}
