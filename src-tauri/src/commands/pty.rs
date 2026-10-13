use serde_json::Value;
use std::sync::Arc;

use crate::pty_mgr::PtyManager;

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
