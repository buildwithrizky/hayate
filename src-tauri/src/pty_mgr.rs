use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PtyWsMessage {
    #[serde(rename = "output")]
    Output {
        #[serde(rename = "sessionId")]
        session_id: String,
        text: String,
    },
    #[serde(rename = "spawned")]
    Spawned {
        #[serde(rename = "sessionId")]
        session_id: String,
        pid: u32,
        #[serde(rename = "repoPath")]
        repo_path: String,
    },
    #[serde(rename = "exit")]
    Exit {
        #[serde(rename = "sessionId")]
        session_id: String,
        code: i32,
    },
    #[serde(rename = "stopped")]
    Stopped {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        error: String,
    },
}

struct SessionEntry {
    repo_path: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    broadcast_tx: broadcast::Sender<PtyWsMessage>,
}

impl PtyManager {
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(1024);
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            broadcast_tx,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PtyWsMessage> {
        self.broadcast_tx.subscribe()
    }

    pub fn get_repo_path(&self, session_id: &str) -> Option<String> {
        self.sessions
            .lock()
            .ok()?
            .get(session_id)
            .map(|s| s.repo_path.clone())
    }

    pub fn spawn(
        &self,
        session_id: &str,
        repo_path: &str,
        cols: u16,
        rows: u16,
    ) -> Result<u32, String> {
        // Kill existing session if present
        let _ = self.kill(session_id);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(repo_path);

        let home = std::env::var("HOME").unwrap_or_default();
        let current_path = std::env::var("PATH").unwrap_or_default();
        let extra_paths = format!(
            "{}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:{}",
            home, current_path
        );

        cmd.env("TERM", "xterm-256color");
        cmd.env("PATH", extra_paths);
        if !home.is_empty() {
            cmd.env("HOME", &home);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {e}"))?;

        let pid = child.process_id().unwrap_or(0);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

        let session_entry = SessionEntry {
            repo_path: repo_path.to_string(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
        };

        if let Ok(mut lock) = self.sessions.lock() {
            lock.insert(session_id.to_string(), session_entry);
        }

        let sid = session_id.to_string();
        let sessions_map = Arc::clone(&self.sessions);
        let bcast = self.broadcast_tx.clone();

        let _ = bcast.send(PtyWsMessage::Spawned {
            session_id: sid.clone(),
            pid,
            repo_path: repo_path.to_string(),
        });

        // Background reader thread
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = bcast.send(PtyWsMessage::Output {
                            session_id: sid.clone(),
                            text,
                        });
                    }
                    Err(_) => break,
                }
            }

            // Cleanup & exit notice
            let exit_code = if let Ok(mut lock) = sessions_map.lock() {
                if let Some(entry) = lock.remove(&sid) {
                    if let Ok(mut child_lock) = entry.child.lock() {
                        child_lock
                            .wait()
                            .map(|status| status.exit_code() as i32)
                            .unwrap_or(0)
                    } else {
                        0
                    }
                } else {
                    0
                }
            } else {
                0
            };

            let _ = bcast.send(PtyWsMessage::Exit {
                session_id: sid,
                code: exit_code,
            });
        });

        Ok(pid)
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let entry = {
            let lock = self.sessions.lock().map_err(|e| e.to_string())?;
            lock.get(session_id).map(|s| Arc::clone(&s.writer))
        };

        if let Some(writer_arc) = entry {
            let mut writer = writer_arc.lock().map_err(|e| e.to_string())?;
            writer
                .write_all(data.as_bytes())
                .map_err(|e| format!("Failed to write to PTY: {e}"))?;
            writer
                .flush()
                .map_err(|e| format!("Failed to flush PTY: {e}"))?;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let entry = {
            let lock = self.sessions.lock().map_err(|e| e.to_string())?;
            lock.get(session_id).map(|s| Arc::clone(&s.master))
        };

        if let Some(master_arc) = entry {
            let master = master_arc.lock().map_err(|e| e.to_string())?;
            master
                .resize(PtySize {
                    rows: rows.max(1),
                    cols: cols.max(1),
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Failed to resize PTY: {e}"))?;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        let entry = {
            let mut lock = self.sessions.lock().map_err(|e| e.to_string())?;
            lock.remove(session_id)
        };

        if let Some(entry) = entry {
            if let Ok(mut child) = entry.child.lock() {
                let _ = child.kill();
            }
            let _ = self.broadcast_tx.send(PtyWsMessage::Stopped {
                session_id: session_id.to_string(),
            });
            Ok(())
        } else {
            Ok(())
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}
