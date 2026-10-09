use crate::agent_core::{load_agent_config, run_react_agent_stream, save_agent_config};
use crate::git_ops;
use crate::pty_mgr::PtyManager;
use crate::workspace;

use axum::{
    extract::{
        ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade},
        FromRequest, Multipart, Query, State,
    },
    http::{header, HeaderValue, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post, put},
    Json, Router,
};
use futures_util::{stream, SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::path::PathBuf;
use sysinfo::System;
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

#[derive(Clone)]
pub struct AppState {
    pub pty_mgr: PtyManager,
}

fn resolve_public_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ADE_PUBLIC_DIR") {
        let p = PathBuf::from(dir);
        if p.exists() {
            return p;
        }
    }

    let dev_tauri = PathBuf::from("../public");
    if dev_tauri.exists() {
        return dev_tauri;
    }

    let dev_root = PathBuf::from("./public");
    if dev_root.exists() {
        return dev_root;
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let res_dir = exe_dir.join("../Resources/public");
            if res_dir.exists() {
                return res_dir;
            }
            let pub_dir = exe_dir.join("public");
            if pub_dir.exists() {
                return pub_dir;
            }
        }
    }

    PathBuf::from("../public")
}

pub fn create_router(state: AppState) -> Router {
    let public_dir = resolve_public_dir();

    let index_file = public_dir.join("index.html");

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api_routes = Router::new()
        // Workspaces
        .route("/api/pick-folder", post(handle_pick_folder))
        .route("/api/workspaces", get(handle_get_workspaces).post(handle_create_workspace))
        .route("/api/workspaces/:id", put(handle_update_workspace).delete(handle_delete_workspace))
        .route("/api/repos", get(handle_get_repos))
        .route("/api/browse", get(handle_browse))
        // Files
        .route("/api/files", get(handle_get_files))
        .route("/api/file-content", get(handle_get_file_content).post(handle_save_file_content).put(handle_save_file_content))
        // Images
        .route("/api/upload-image", post(handle_upload_image))
        .route("/api/upload-clipboard", post(handle_upload_image))
        .route("/api/image-preview", get(handle_image_preview))
        // Git
        .route("/api/git/status", get(handle_git_status))
        .route("/api/git/diff", get(handle_git_diff))
        .route("/api/git/commit", post(handle_git_commit))
        .route("/api/git/log", get(handle_git_log))
        .route("/api/git/stage", post(handle_git_stage))
        .route("/api/git/unstage", post(handle_git_unstage))
        .route("/api/git/discard", post(handle_git_discard))
        // Agent
        .route("/api/agent/config", get(handle_get_agent_config).post(handle_save_agent_config))
        .route("/api/agent/chat", post(handle_agent_chat))
        // System
        .route("/api/system-status", get(handle_system_status))
        // WebSocket
        .route("/ws", get(handle_ws_upgrade));

    // Serve static files with SPA fallback to index.html
    let serve_dir = ServeDir::new(&public_dir).not_found_service(ServeFile::new(index_file));

    Router::new()
        .merge(api_routes)
        .fallback_service(serve_dir)
        .layer(cors)
        .with_state(state)
}

pub async fn start_server(port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = AppState {
        pty_mgr: PtyManager::new(),
    };
    let app = create_router(state);
    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    log::info!("Embedded Axum HTTP server running on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

// ---------------- WS Handler ----------------

async fn handle_ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

async fn handle_ws_connection(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut bcast_rx = state.pty_mgr.subscribe();

    // Task forwarding pty output to ws
    let mut forward_task = tokio::spawn(async move {
        while let Ok(msg) = bcast_rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&msg) {
                if sender.send(AxumWsMessage::Text(json_str.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Handle client WS messages
    let pty_mgr = state.pty_mgr.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let AxumWsMessage::Text(txt) = msg {
                if let Ok(val) = serde_json::from_str::<Value>(&txt) {
                    let action = val.get("action").and_then(|v| v.as_str()).unwrap_or("");
                    match action {
                        "spawn" => {
                            let sid = val.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
                            let repo = val.get("repoPath").and_then(|v| v.as_str()).unwrap_or("");
                            let cols = val.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
                            let rows = val.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
                            if !sid.is_empty() && !repo.is_empty() {
                                let _ = pty_mgr.spawn(sid, repo, cols, rows);
                            }
                        }
                        "input" => {
                            let sid = val.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
                            let input_data = val.get("data").and_then(|v| v.as_str()).unwrap_or("");
                            if !sid.is_empty() {
                                let _ = pty_mgr.write(sid, input_data);
                            }
                        }
                        "resize" => {
                            let sid = val.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
                            let cols = val.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
                            let rows = val.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
                            if !sid.is_empty() {
                                let _ = pty_mgr.resize(sid, cols, rows);
                            }
                        }
                        "kill" | "stop" => {
                            let sid = val.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
                            if !sid.is_empty() {
                                let _ = pty_mgr.kill(sid);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    tokio::select! {
        _ = (&mut forward_task) => recv_task.abort(),
        _ = (&mut recv_task) => forward_task.abort(),
    }
}

// ---------------- Workspace Handlers ----------------

async fn handle_pick_folder() -> impl IntoResponse {
    match workspace::pick_folder_dialog().await {
        Ok(Some(ws)) => (StatusCode::CREATED, Json(json!(ws))).into_response(),
        Ok(None) => (StatusCode::OK, Json(json!({ "canceled": true }))).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err })),
        )
            .into_response(),
    }
}

async fn handle_get_workspaces() -> impl IntoResponse {
    let list = workspace::load_workspaces().await;
    Json(list)
}

#[derive(Deserialize)]
struct CreateWorkspaceReq {
    name: Option<String>,
    path: Option<String>,
}

async fn handle_create_workspace(Json(body): Json<CreateWorkspaceReq>) -> impl IntoResponse {
    let name = body.name.unwrap_or_default().trim().to_string();
    let path = body.path.unwrap_or_default().trim().to_string();
    if name.is_empty() || path.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "name and path required"}))).into_response();
    }

    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_dir() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "Directory path does not exist"}))).into_response();
    }

    let resolved = p.canonicalize().unwrap_or(p).to_string_lossy().to_string();
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
    if let Err(e) = workspace::save_workspaces(&list).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response();
    }

    (StatusCode::CREATED, Json(json!(ws))).into_response()
}

async fn handle_update_workspace(
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<CreateWorkspaceReq>,
) -> impl IntoResponse {
    let mut list = workspace::load_workspaces().await;
    let idx = list.iter().position(|w| w.id == id);
    let Some(idx) = idx else {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "Workspace not found"}))).into_response();
    };

    let name = body.name.unwrap_or_default().trim().to_string();
    let path = body.path.unwrap_or_default().trim().to_string();
    if name.is_empty() || path.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "name and path required"}))).into_response();
    }

    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_dir() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "Directory path does not exist"}))).into_response();
    }

    let resolved = p.canonicalize().unwrap_or(p).to_string_lossy().to_string();
    list[idx].name = name;
    list[idx].path = resolved;

    if let Err(e) = workspace::save_workspaces(&list).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response();
    }

    Json(json!(list[idx])).into_response()
}

async fn handle_delete_workspace(
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let mut list = workspace::load_workspaces().await;
    let idx = list.iter().position(|w| w.id == id);
    let Some(idx) = idx else {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "Workspace not found"}))).into_response();
    };

    let deleted = list.remove(idx);
    if let Err(e) = workspace::save_workspaces(&list).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response();
    }

    Json(json!({"ok": true, "deleted": deleted})).into_response()
}

async fn handle_get_repos() -> impl IntoResponse {
    let list = workspace::load_workspaces().await;
    let repos: Vec<String> = list.into_iter().map(|w| w.path).collect();
    Json(json!({ "root": "", "repos": repos }))
}

#[derive(Deserialize)]
struct BrowseQuery {
    dir: Option<String>,
}

async fn handle_browse(Query(query): Query<BrowseQuery>) -> impl IntoResponse {
    match workspace::browse_dirs(query.dir).await {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e, "dirs": []}))).into_response(),
    }
}

// ---------------- File Handlers ----------------

#[derive(Deserialize)]
struct FilesQuery {
    path: Option<String>,
    #[serde(rename = "workspaceId")]
    workspace_id: Option<String>,
}

async fn handle_get_files(Query(query): Query<FilesQuery>) -> impl IntoResponse {
    let mut target = query.path;
    if target.is_none() {
        if let Some(ws_id) = query.workspace_id {
            let list = workspace::load_workspaces().await;
            if let Some(ws) = list.into_iter().find(|w| w.id == ws_id) {
                target = Some(ws.path);
            }
        }
    }

    let Some(target_path) = target else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path or workspaceId required"}))).into_response();
    };

    match workspace::list_files(&target_path).await {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct FileContentQuery {
    path: Option<String>,
}

async fn handle_get_file_content(Query(query): Query<FileContentQuery>) -> impl IntoResponse {
    let Some(path) = query.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    };

    match workspace::read_file_content(&path).await {
        Ok(res) => Json(json!(res)).into_response(),
        Err((code, err)) => (StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_REQUEST), Json(json!({"error": err}))).into_response(),
    }
}

#[derive(Deserialize)]
struct SaveFileContentReq {
    path: Option<String>,
    content: Option<String>,
}

async fn handle_save_file_content(Json(body): Json<SaveFileContentReq>) -> impl IntoResponse {
    let path = body.path.unwrap_or_default().trim().to_string();
    let content = body.content.unwrap_or_default();
    if path.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    }

    match workspace::write_file_content(&path, &content).await {
        Ok(size) => Json(json!({"ok": true, "path": path, "size": size})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

// ---------------- Image Handlers ----------------

#[derive(Deserialize)]
struct PreviewQuery {
    path: Option<String>,
}

async fn handle_image_preview(Query(query): Query<PreviewQuery>) -> impl IntoResponse {
    let Some(p) = query.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "Missing path query parameter"}))).into_response();
    };

    let path = PathBuf::from(&p);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "Unsupported image extension"}))).into_response(),
    };

    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let mut res = Response::new(axum::body::Body::from(bytes));
            res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
            res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=3600"));
            res
        }
        Err(_) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "Image file not found"}))).into_response(),
    }
}

#[derive(Deserialize)]
struct UploadQuery {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

async fn handle_upload_image(
    Query(query): Query<UploadQuery>,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::extract::Request,
) -> impl IntoResponse {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let mut session_id = query.session_id.unwrap_or_default();
    let mut image_bytes: Option<Vec<u8>> = None;
    let mut ext = "png".to_string();

    if content_type.contains("multipart/form-data") {
        if let Ok(mut multipart) = Multipart::from_request(body, &()).await {
            while let Ok(Some(field)) = multipart.next_field().await {
                let name = field.name().unwrap_or("").to_string();
                if name == "sessionId" {
                    if let Ok(txt) = field.text().await {
                        session_id = txt;
                    }
                } else if name == "image" || name == "file" {
                    let file_name = field.file_name().unwrap_or("").to_string();
                    if let Some(e) = file_name.split('.').last() {
                        let e_lower = e.to_lowercase();
                        if ["png", "jpg", "jpeg", "webp", "gif", "svg"].contains(&e_lower.as_str()) {
                            ext = if e_lower == "jpeg" { "jpg".to_string() } else { e_lower };
                        }
                    }
                    if let Ok(bytes) = field.bytes().await {
                        image_bytes = Some(bytes.to_vec());
                    }
                }
            }
        }
    } else if content_type.contains("application/json") {
        let bytes = axum::body::to_bytes(body.into_body(), 10 * 1024 * 1024).await.unwrap_or_default();
        if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(s) = val.get("sessionId").and_then(|v| v.as_str()) {
                session_id = s.to_string();
            }
            let raw = val.get("image").or_else(|| val.get("data")).or_else(|| val.get("base64")).and_then(|v| v.as_str()).unwrap_or("");
            if let Some((b, e)) = workspace::decode_image_data(raw) {
                image_bytes = Some(b);
                ext = e;
            }
        }
    }

    let Some(bytes) = image_bytes else {
        return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "Invalid image format"}))).into_response();
    };

    let repo_path = if !session_id.is_empty() {
        state.pty_mgr.get_repo_path(&session_id)
    } else {
        None
    };

    match workspace::save_image_bytes(repo_path.as_deref(), &bytes, &ext).await {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e}))).into_response(),
    }
}

// ---------------- Git Handlers ----------------

#[derive(Deserialize)]
struct RepoQuery {
    path: Option<String>,
}

async fn handle_git_status(Query(q): Query<RepoQuery>) -> impl IntoResponse {
    let Some(p) = q.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    };
    match git_ops::git_status(&p).await {
        Ok(res) => Json(json!(res)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct DiffQuery {
    path: Option<String>,
    file: Option<String>,
    staged: Option<String>,
    commit: Option<String>,
}

async fn handle_git_diff(Query(q): Query<DiffQuery>) -> impl IntoResponse {
    let Some(p) = q.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    };
    let staged_only = q.staged.as_deref() == Some("true");
    match git_ops::git_diff(&p, q.file.as_deref(), staged_only, q.commit.as_deref()).await {
        Ok(diff) => Json(json!({ "diff": diff, "file": q.file })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct CommitReq {
    path: Option<String>,
    message: Option<String>,
    #[serde(rename = "stageAll")]
    stage_all: Option<bool>,
}

async fn handle_git_commit(Json(b): Json<CommitReq>) -> impl IntoResponse {
    let Some(p) = b.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    };
    let Some(msg) = b.message else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "message required"}))).into_response();
    };
    let stage_all = b.stage_all != Some(false);
    match git_ops::git_commit(&p, &msg, stage_all).await {
        Ok(output) => Json(json!({ "ok": true, "output": output })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn handle_git_log(Query(q): Query<RepoQuery>) -> impl IntoResponse {
    let Some(p) = q.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    };
    match git_ops::git_log(&p).await {
        Ok(commits) => Json(json!({ "commits": commits })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct GitStageReq {
    path: Option<String>,
    file: Option<String>,
    all: Option<bool>,
}

async fn handle_git_stage(Json(b): Json<GitStageReq>) -> impl IntoResponse {
    let Some(p) = b.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    };
    match git_ops::git_stage(&p, b.file.as_deref(), b.all == Some(true)).await {
        Ok(_) => Json(json!({ "ok": true })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn handle_git_unstage(Json(b): Json<GitStageReq>) -> impl IntoResponse {
    let Some(p) = b.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    };
    match git_ops::git_unstage(&p, b.file.as_deref(), b.all == Some(true)).await {
        Ok(_) => Json(json!({ "ok": true })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn handle_git_discard(Json(b): Json<GitStageReq>) -> impl IntoResponse {
    let Some(p) = b.path else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "path required"}))).into_response();
    };
    match git_ops::git_discard(&p, b.file.as_deref(), b.all == Some(true)).await {
        Ok(_) => Json(json!({ "ok": true })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

// ---------------- Agent Handlers ----------------

async fn handle_get_agent_config() -> impl IntoResponse {
    let cfg = load_agent_config().await;
    let masked_key = if !cfg.api_key.is_empty() {
        if cfg.api_key.len() > 8 {
            format!("{}...{}", &cfg.api_key[..4], &cfg.api_key[cfg.api_key.len() - 4..])
        } else {
            "****".to_string()
        }
    } else {
        String::new()
    };

    let val = json!({
        "ok": true,
        "config": {
            "provider": cfg.provider,
            "baseUrl": cfg.base_url,
            "apiKey": masked_key,
            "hasApiKey": !cfg.api_key.is_empty(),
            "model": cfg.model,
            "temperature": cfg.temperature,
            "maxTokens": cfg.max_tokens,
        }
    });
    Json(val)
}

async fn handle_save_agent_config(Json(b): Json<Value>) -> impl IntoResponse {
    match save_agent_config(&b).await {
        Ok(cfg) => Json(json!({ "ok": true, "config": cfg })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
struct AgentChatReq {
    prompt: Option<String>,
    #[serde(default)]
    images: Vec<Value>,
    #[serde(rename = "workspacePath")]
    workspace_path: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
}

async fn handle_agent_chat(Json(b): Json<AgentChatReq>) -> impl IntoResponse {
    let prompt = b.prompt.unwrap_or_default();
    if prompt.trim().is_empty() && b.images.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "Prompt or images required"}))).into_response();
    }

    let mut cfg = load_agent_config().await;
    if let Some(m) = b.model {
        if !m.trim().is_empty() {
            cfg.model = m;
        }
    }

    let cwd = b.workspace_path.or(b.cwd).unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });

    let (tx, rx) = mpsc::channel::<String>(100);
    tokio::spawn(async move {
        run_react_agent_stream(prompt, b.images, cwd, cfg, tx).await;
    });

    let stream = stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|msg| {
            let event = Event::default().data(
                msg.trim_end_matches("\n\n")
                    .trim_start_matches("data: ")
                    .to_string(),
            );
            (Ok::<_, Infallible>(event), rx)
        })
    });

    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

// ---------------- System Status ----------------

async fn handle_system_status() -> impl IntoResponse {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let total_b = sys.total_memory();
    let used_b = sys.used_memory();

    let total_gb = (total_b as f64) / (1024.0 * 1024.0 * 1024.0);
    let used_gb = (used_b as f64) / (1024.0 * 1024.0 * 1024.0);
    let pct = if total_b > 0 { ((used_b as f64 / total_b as f64) * 100.0).round() as u64 } else { 0 };

    Json(json!({
        "port": 3456,
        "processRssMb": 35,
        "systemUsedGb": format!("{used_gb:.1}"),
        "systemTotalGb": format!("{total_gb:.1}"),
        "systemPercent": pct,
    }))
}
