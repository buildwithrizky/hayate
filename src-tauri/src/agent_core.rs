use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMConfig {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(rename = "baseUrl", default = "default_base_url")]
    pub base_url: String,
    #[serde(rename = "apiKey", default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

fn default_provider() -> String {
    "openai".to_string()
}
fn default_base_url() -> String {
    std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string())
}
fn default_model() -> String {
    std::env::var("ADE_MODEL").unwrap_or_else(|_| "gpt-4o".to_string())
}

impl Default for LLMConfig {
    fn default() -> Self {
        Self {
            provider: default_provider(),
            base_url: default_base_url(),
            api_key: std::env::var("OPENAI_API_KEY").unwrap_or_default(),
            model: default_model(),
            temperature: None,
            max_tokens: None,
        }
    }
}

pub fn get_agent_config_file() -> PathBuf {
    crate::workspace::get_ade_dir().join("agent-config.json")
}

pub async fn load_agent_config() -> LLMConfig {
    let file = get_agent_config_file();
    match fs::read_to_string(&file).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => LLMConfig::default(),
    }
}

pub async fn save_agent_config(cfg: &Value) -> Result<LLMConfig, String> {
    let mut current = load_agent_config().await;

    if let Some(p) = cfg.get("provider").and_then(|v| v.as_str()) {
        current.provider = p.to_string();
    }
    if let Some(u) = cfg.get("baseUrl").and_then(|v| v.as_str()) {
        current.base_url = u.to_string();
    }
    if let Some(k) = cfg.get("apiKey").and_then(|v| v.as_str()) {
        current.api_key = k.to_string();
    }
    if let Some(m) = cfg.get("model").and_then(|v| v.as_str()) {
        current.model = m.to_string();
    }
    if let Some(t) = cfg.get("temperature").and_then(|v| v.as_f64()) {
        current.temperature = Some(t as f32);
    }
    if let Some(mt) = cfg.get("maxTokens").and_then(|v| v.as_u64()) {
        current.max_tokens = Some(mt as u32);
    }

    let dir = crate::workspace::get_ade_dir();
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let json = serde_json::to_string_pretty(&current).map_err(|e| e.to_string())?;
    fs::write(get_agent_config_file(), json)
        .await
        .map_err(|e| e.to_string())?;

    Ok(current)
}

// Core Tool: read_file
pub async fn tool_read_file(
    path_str: &str,
    offset: Option<usize>,
    limit: Option<usize>,
    cwd: &str,
) -> Result<String, String> {
    let target = resolve_path(path_str, cwd);
    let raw = fs::read_to_string(&target)
        .await
        .map_err(|e| format!("File not found or unreadable: {e}"))?;

    let lines: Vec<&str> = raw.lines().collect();
    let total = lines.len();

    let off = offset.unwrap_or(1).max(1);
    if off > total && total > 0 {
        return Ok(format!(
            "[File has {total} lines. Requested offset {off} exceeds total.]"
        ));
    }

    let start = off - 1;
    let end = if let Some(lim) = limit {
        (start + lim).min(total)
    } else {
        total
    };

    let sliced = lines[start..end].join("\n");
    Ok(truncate_50k(sliced))
}

// Core Tool: edit_file
pub async fn tool_edit_file(
    path_str: &str,
    old_text: &str,
    new_text: &str,
    cwd: &str,
) -> Result<String, String> {
    let target = resolve_path(path_str, cwd);
    let raw = fs::read_to_string(&target)
        .await
        .map_err(|e| format!("File not found: {e}"))?;

    let count = raw.matches(old_text).count();
    if count == 0 {
        return Err(format!("oldText not found in {}", target.display()));
    }
    if count > 1 {
        return Err(format!(
            "oldText found multiple ({count}) times in {}. Must be unique.",
            target.display()
        ));
    }

    let updated = raw.replacen(old_text, new_text, 1);
    fs::write(&target, updated)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;

    Ok(format!("Successfully edited {}", target.display()))
}

// Core Tool: write_file
pub async fn tool_write_file(path_str: &str, content: &str, cwd: &str) -> Result<String, String> {
    let target = resolve_path(path_str, cwd);
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent).await;
    }
    fs::write(&target, content)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(format!("Successfully wrote to {}", target.display()))
}

// Core Tool: bash
pub async fn tool_bash(cmd: &str, cwd: &str) -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let curr = std::env::var("PATH").unwrap_or_default();
    let ext_path = format!("{}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:{}", home, curr);

    let child = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .current_dir(cwd)
        .env("PATH", ext_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    let output = tokio::time::timeout(Duration::from_secs(30), child.wait_with_output())
        .await
        .map_err(|_| "Command timed out after 30s".to_string())?
        .map_err(|e| format!("Command execution error: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut res = stdout.to_string();
    if !stderr.is_empty() {
        if !res.is_empty() {
            res.push('\n');
        }
        res.push_str(&stderr);
    }
    if res.trim().is_empty() {
        res = format!("(command exited with code {})", output.status.code().unwrap_or(0));
    }
    Ok(truncate_50k(res))
}

fn resolve_path(p: &str, cwd: &str) -> PathBuf {
    let path = Path::new(p);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new(cwd).join(path)
    }
}

fn truncate_50k(text: String) -> String {
    let max = 50 * 1024;
    if text.len() <= max {
        text
    } else {
        let mut truncated = text[..max].to_string();
        truncated.push_str("\n... [truncated at 50KB]");
        truncated
    }
}

pub fn get_tool_definitions() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read contents of a file with boundary checking (offset and limit in lines).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path (absolute or relative to cwd)" },
                        "offset": { "type": "number", "description": "1-indexed starting line number (default: 1)" },
                        "limit": { "type": "number", "description": "Maximum number of lines to read" }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "edit_file",
                "description": "Edit a file using exact string replacement (oldText must match uniquely).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path (absolute or relative to cwd)" },
                        "oldText": { "type": "string", "description": "Exact string to be replaced" },
                        "newText": { "type": "string", "description": "Replacement string" }
                    },
                    "required": ["path", "oldText", "newText"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Create or overwrite a file with given content.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path (absolute or relative to cwd)" },
                        "content": { "type": "string", "description": "Content to write into file" }
                    },
                    "required": ["path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "bash",
                "description": "Execute a shell command with a 30s timeout and 50KB maximum output buffer.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command to execute" },
                        "cwd": { "type": "string", "description": "Optional working directory" }
                    },
                    "required": ["command"]
                }
            }
        }
    ])
}

// ReAct loop execution emitting SSE strings
pub async fn run_react_agent_stream(
    prompt: String,
    images: Vec<Value>,
    cwd: String,
    config: LLMConfig,
    tx: tokio::sync::mpsc::Sender<String>,
) {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_default();

    let mut messages: Vec<Value> = Vec::new();
    let sys_prompt = "You are ADE Assistant, an expert AI coding agent. You can inspect workspaces, execute shell commands, read and write files using provided tools. Always think concisely.";
    messages.push(json!({
        "role": "system",
        "content": sys_prompt
    }));

    if !images.is_empty() {
        let mut user_parts: Vec<Value> = vec![json!({ "type": "text", "text": prompt })];
        for img in images {
            if let Some(url_str) = img.get("dataUrl").and_then(|v| v.as_str()) {
                user_parts.push(json!({
                    "type": "image_url",
                    "image_url": { "url": url_str }
                }));
            }
        }
        messages.push(json!({
            "role": "user",
            "content": user_parts
        }));
    } else {
        messages.push(json!({
            "role": "user",
            "content": prompt
        }));
    }

    let max_turns = 15;
    let mut turn = 0;

    while turn < max_turns {
        turn += 1;

        let base_url = config.base_url.trim_end_matches('/');
        let url = format!("{base_url}/chat/completions");

        let mut req_body = json!({
            "model": config.model,
            "messages": messages,
            "stream": true,
            "tools": get_tool_definitions(),
            "tool_choice": "auto"
        });

        if let Some(temp) = config.temperature {
            req_body["temperature"] = json!(temp);
        }
        if let Some(max_tok) = config.max_tokens {
            req_body["max_tokens"] = json!(max_tok);
        }

        let mut req = client.post(&url).json(&req_body);
        if !config.api_key.is_empty() {
            req = req.bearer_auth(&config.api_key);
        }
        if config.provider == "openrouter" {
            req = req.header("HTTP-Referer", "https://ade.local");
            req = req.header("X-Title", "ADE Harness Agent");
        }

        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = tx
                    .send(format!(
                        "data: {}\n\n",
                        json!({"type": "error", "error": e.to_string()})
                    ))
                    .await;
                break;
            }
        };

        if !res.status().is_success() {
            let err_text = res.text().await.unwrap_or_default();
            let _ = tx
                .send(format!(
                    "data: {}\n\n",
                    json!({"type": "error", "error": format!("API error: {err_text}")})
                ))
                .await;
            break;
        }

        let mut stream = res.bytes_stream();
        let mut buffer = String::new();
        let mut accumulated_content = String::new();
        let mut tool_calls_map: std::collections::BTreeMap<usize, (String, String, String)> =
            std::collections::BTreeMap::new(); // idx -> (id, name, args)

        while let Some(chunk_res) = stream.next().await {
            let chunk = match chunk_res {
                Ok(c) => c,
                Err(_) => break,
            };

            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer.drain(..=newline_pos);

                if !line.starts_with("data:") {
                    continue;
                }
                let data_str = line.trim_start_matches("data:").trim();
                if data_str == "[DONE]" {
                    break;
                }

                if let Ok(v) = serde_json::from_str::<Value>(data_str) {
                    if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
                        if let Some(first) = choices.first() {
                            if let Some(delta) = first.get("delta") {
                                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                    accumulated_content.push_str(content);
                                    let _ = tx
                                        .send(format!(
                                            "data: {}\n\n",
                                            json!({"type": "chunk", "text": content})
                                        ))
                                        .await;
                                }

                                if let Some(tool_calls) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
                                    for tc in tool_calls {
                                        let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                                        let entry = tool_calls_map.entry(idx).or_insert((String::new(), String::new(), String::new()));
                                        if let Some(id) = tc.get("id").and_then(|s| s.as_str()) {
                                            entry.0 = id.to_string();
                                        }
                                        if let Some(func) = tc.get("function") {
                                            if let Some(name) = func.get("name").and_then(|n| n.as_str()) {
                                                entry.1.push_str(name);
                                            }
                                            if let Some(args) = func.get("arguments").and_then(|a| a.as_str()) {
                                                entry.2.push_str(args);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // If no tool calls, conversation finished
        if tool_calls_map.is_empty() {
            messages.push(json!({
                "role": "assistant",
                "content": accumulated_content
            }));
            let _ = tx
                .send(format!("data: {}\n\n", json!({"type": "finish", "reason": "stop"})))
                .await;
            break;
        }

        // Assistant made tool calls
        let mut assistant_tc_list = Vec::new();
        for (idx, (id, name, args)) in &tool_calls_map {
            let tc_id = if id.is_empty() {
                format!("call_{idx}")
            } else {
                id.clone()
            };
            assistant_tc_list.push(json!({
                "id": tc_id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": args
                }
            }));
        }

        messages.push(json!({
            "role": "assistant",
            "content": if accumulated_content.is_empty() { Value::Null } else { json!(accumulated_content) },
            "tool_calls": assistant_tc_list
        }));

        // Execute tools
        for (idx, (id, name, args)) in &tool_calls_map {
            let tc_id = if id.is_empty() {
                format!("call_{idx}")
            } else {
                id.clone()
            };
            let parsed_args: Value = serde_json::from_str(args).unwrap_or(json!({}));

            let _ = tx
                .send(format!(
                    "data: {}\n\n",
                    json!({
                        "type": "tool_start",
                        "id": tc_id,
                        "name": name,
                        "args": parsed_args
                    })
                ))
                .await;

            let (output, is_error) = match name.as_str() {
                "read_file" => {
                    let p = parsed_args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    let off = parsed_args.get("offset").and_then(|v| v.as_u64()).map(|u| u as usize);
                    let lim = parsed_args.get("limit").and_then(|v| v.as_u64()).map(|u| u as usize);
                    match tool_read_file(p, off, lim, &cwd).await {
                        Ok(res) => (res, false),
                        Err(e) => (e, true),
                    }
                }
                "edit_file" => {
                    let p = parsed_args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    let old_t = parsed_args.get("oldText").and_then(|v| v.as_str()).unwrap_or("");
                    let new_t = parsed_args.get("newText").and_then(|v| v.as_str()).unwrap_or("");
                    match tool_edit_file(p, old_t, new_t, &cwd).await {
                        Ok(res) => (res, false),
                        Err(e) => (e, true),
                    }
                }
                "write_file" => {
                    let p = parsed_args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    let c = parsed_args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    match tool_write_file(p, c, &cwd).await {
                        Ok(res) => (res, false),
                        Err(e) => (e, true),
                    }
                }
                "bash" => {
                    let cmd_str = parsed_args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                    let custom_cwd = parsed_args
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .map(|s| resolve_path(s, &cwd).to_string_lossy().to_string())
                        .unwrap_or_else(|| cwd.clone());
                    match tool_bash(cmd_str, &custom_cwd).await {
                        Ok(res) => (res, false),
                        Err(e) => (e, true),
                    }
                }
                other => (format!("Unknown tool: {other}"), true),
            };

            let _ = tx
                .send(format!(
                    "data: {}\n\n",
                    json!({
                        "type": "tool_end",
                        "id": tc_id,
                        "name": name,
                        "output": output,
                        "is_error": is_error
                    })
                ))
                .await;

            messages.push(json!({
                "role": "tool",
                "tool_call_id": tc_id,
                "name": name,
                "content": output
            }));
        }
    }

    let _ = tx.send("data: [DONE]\n\n".to_string()).await;
}
