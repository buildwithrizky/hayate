use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::sync::mpsc;

const DEBOUNCE_MS: u64 = 300;

fn is_noisy(path: &Path) -> bool {
    let mut in_git = false;
    for comp in path.components() {
        let name = comp.as_os_str();
        if in_git {
            if name == "objects" || name == "index.lock" || name == "logs" {
                return true;
            }
        } else if name == ".git" {
            in_git = true;
        } else if matches!(
            name.to_str(),
            Some(
                "node_modules"
                    | "target"
                    | ".DS_Store"
                    | ".turbo"
                    | ".next"
                    | ".nuxt"
                    | ".svelte-kit"
                    | "dist"
                    | "build"
                    | "out"
                    | ".cache"
                    | ".parcel-cache"
                    | "__pycache__"
                    | ".venv"
                    | "venv"
                    | ".pytest_cache"
                    | ".mypy_cache"
                    | "coverage"
                    | ".nyc_output"
                    | ".idea"
                    | ".vscode"
            )
        ) {
            return true;
        }
    }

    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|name| name.ends_with('~') || name.ends_with(".tmp") || name == "index.lock")
}

struct ActiveWatch {
    watcher: RecommendedWatcher,
    path: PathBuf,
}

pub struct FsWatcherState {
    active: Mutex<Option<ActiveWatch>>,
    debounce_tx: mpsc::Sender<PathBuf>,
}

impl FsWatcherState {
    pub fn new(app_handle: AppHandle) -> Self {
        let (tx, mut rx) = mpsc::channel::<PathBuf>(100);

        // ponytail: single debounce worker for active workspace; upgrade to per-path map if multi-workspace parallel watch needed
        tauri::async_runtime::spawn(async move {
            let debounce_dur = Duration::from_millis(DEBOUNCE_MS);
            while let Some(first_path) = rx.recv().await {
                let mut latest_path = first_path;
                loop {
                    tokio::select! {
                        next = rx.recv() => {
                            match next {
                                Some(p) => latest_path = p,
                                None => return,
                            }
                        }
                        _ = tokio::time::sleep(debounce_dur) => {
                            break;
                        }
                    }
                }

                let payload = serde_json::json!({ "path": latest_path.to_string_lossy() });
                if let Err(e) = app_handle.emit("workspace-fs-changed", payload) {
                    log::warn!("Failed to emit workspace-fs-changed: {e}");
                }
            }
        });

        Self {
            active: Mutex::new(None),
            debounce_tx: tx,
        }
    }

    pub async fn watch(&self, path_str: &str) -> Result<(), String> {
        let path = PathBuf::from(path_str);
        if !path.exists() {
            return Err(format!("Path does not exist: {path_str}"));
        }

        self.unwatch().await?;

        let tx = self.debounce_tx.clone();
        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| match res {
                Ok(event) => {
                    if let Some(target) = event.paths.into_iter().find(|p| !is_noisy(p)) {
                        let _ = tx.try_send(target);
                    }
                }
                Err(e) => {
                    log::warn!("Watcher error: {e}");
                }
            },
            Config::default(),
        )
        .map_err(|e| e.to_string())?;

        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        *self.active.lock().await = Some(ActiveWatch { watcher, path });

        Ok(())
    }

    pub async fn unwatch(&self) -> Result<(), String> {
        let mut guard = self.active.lock().await;
        if let Some(mut active) = guard.take() {
            let _ = active.watcher.unwatch(&active.path);
        }

        Ok(())
    }
}

pub type SharedFsWatcher = Arc<FsWatcherState>;
