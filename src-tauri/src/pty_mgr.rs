use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
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

        #[cfg(windows)]
        let (shell, shell_args) = resolve_windows_shell();
        #[cfg(not(windows))]
        let (shell, shell_args): (String, Vec<String>) = (
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
            Vec::new(),
        );
        let mut cmd = CommandBuilder::new(&shell);
        cmd.args(shell_args);
        cmd.cwd(repo_path);

        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default();
        let current_path = std::env::var_os("PATH").unwrap_or_default();
        let mut paths: Vec<PathBuf> = Vec::new();

        if !home.is_empty() {
            paths.push(PathBuf::from(&home).join(".bun").join("bin"));
        }
        #[cfg(not(windows))]
        {
            paths.push(PathBuf::from("/opt/homebrew/bin"));
            paths.push(PathBuf::from("/usr/local/bin"));
        }
        paths.extend(std::env::split_paths(&current_path));
        let extra_paths = std::env::join_paths(paths)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        cmd.env("TERM", "xterm-256color");
        cmd.env("PATH", extra_paths);
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_ALL", "en_US.UTF-8");
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
            let mut buf = [0u8; 16384];
            let mut leftover = Vec::with_capacity(4);
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        if !leftover.is_empty() {
                            let text = String::from_utf8_lossy(&leftover).into_owned();
                            let _ = bcast.send(PtyWsMessage::Output {
                                session_id: sid.clone(),
                                text,
                            });
                        }
                        break;
                    }
                    Ok(n) => {
                        let combined = if leftover.is_empty() {
                            buf[..n].to_vec()
                        } else {
                            leftover.extend_from_slice(&buf[..n]);
                            std::mem::take(&mut leftover)
                        };

                        let mut slice = &combined[..];
                        let mut output = String::new();

                        while !slice.is_empty() {
                            match std::str::from_utf8(slice) {
                                Ok(s) => {
                                    output.push_str(s);
                                    slice = &[];
                                }
                                Err(e) => {
                                    let valid = e.valid_up_to();
                                    if valid > 0 {
                                        if let Ok(s) = std::str::from_utf8(&slice[..valid]) {
                                            output.push_str(s);
                                        }
                                        slice = &slice[valid..];
                                    }

                                    match e.error_len() {
                                        Some(err_len) => {
                                            output.push('\u{FFFD}');
                                            slice = &slice[err_len..];
                                        }
                                        None => {
                                            // Incomplete multi-byte sequence at chunk boundary: keep in leftover
                                            leftover.extend_from_slice(slice);
                                            slice = &[];
                                        }
                                    }
                                }
                            }
                        }

                        if !output.is_empty() {
                            let _ = bcast.send(PtyWsMessage::Output {
                                session_id: sid.clone(),
                                text: output,
                            });
                        }

                        // Yield thread if buffer full to prevent CPU starvation on heavy stream
                        if n == buf.len() {
                            std::thread::yield_now();
                        }
                    }
                    Err(_) => {
                        if !leftover.is_empty() {
                            let text = String::from_utf8_lossy(&leftover).into_owned();
                            let _ = bcast.send(PtyWsMessage::Output {
                                session_id: sid.clone(),
                                text,
                            });
                        }
                        break;
                    }
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

#[cfg(any(windows, test))]
fn find_in_paths(name: &str, paths: &[PathBuf]) -> Option<PathBuf> {
    for dir in paths {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(any(windows, test))]
fn select_shell_candidate(
    bash_candidates: &[PathBuf],
    ps_candidates: &[PathBuf],
    path_dirs: &[PathBuf],
    comspec: Option<&str>,
) -> (String, Vec<String>) {
    // 1. Git Bash candidates
    if let Some(path) = bash_candidates.iter().find(|p| p.is_file()) {
        return (
            path.to_string_lossy().to_string(),
            vec!["--login".to_string(), "-i".to_string()],
        );
    }
    if let Some(path) = find_in_paths("bash.exe", path_dirs) {
        return (
            path.to_string_lossy().to_string(),
            vec!["--login".to_string(), "-i".to_string()],
        );
    }

    // 2. PowerShell candidates
    if let Some(path) = ps_candidates.iter().find(|p| p.is_file()) {
        return (path.to_string_lossy().to_string(), Vec::new());
    }
    if let Some(path) = find_in_paths("powershell.exe", path_dirs) {
        return (path.to_string_lossy().to_string(), Vec::new());
    }

    // 3. Fallback: cmd.exe only when powershell unavailable
    let fallback = comspec.unwrap_or("cmd.exe").to_string();
    (fallback, Vec::new())
}

#[cfg(windows)]
fn resolve_windows_shell() -> (String, Vec<String>) {
    // ponytail: static list covers Git standard/user installs; add registry query if custom installs missed.
    let mut bash_candidates = vec![
        PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"),
    ];
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let base = PathBuf::from(local_app_data);
        bash_candidates.push(base.join(r"Programs\Git\bin\bash.exe"));
        bash_candidates.push(base.join(r"Git\bin\bash.exe"));
    }
    if let Ok(prog_files) = std::env::var("ProgramFiles") {
        bash_candidates.push(PathBuf::from(prog_files).join(r"Git\bin\bash.exe"));
    }
    if let Ok(prog_files_x86) = std::env::var("ProgramFiles(x86)") {
        bash_candidates.push(PathBuf::from(prog_files_x86).join(r"Git\bin\bash.exe"));
    }

    let mut ps_candidates = vec![PathBuf::from(
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
    )];
    if let Ok(sys_root) = std::env::var("SystemRoot").or_else(|_| std::env::var("WINDIR")) {
        ps_candidates
            .push(PathBuf::from(sys_root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe"));
    }

    let path_var = std::env::var_os("PATH").unwrap_or_default();
    let path_dirs: Vec<PathBuf> = std::env::split_paths(&path_var).collect();
    let comspec = std::env::var("COMSPEC").ok();

    select_shell_candidate(
        &bash_candidates,
        &ps_candidates,
        &path_dirs,
        comspec.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_select_shell_prefers_bash_candidate() {
        let temp_dir = std::env::temp_dir();
        let fake_bash = temp_dir.join("test_fake_bash.exe");
        let _ = std::fs::File::create(&fake_bash);

        let (shell, args) = select_shell_candidate(&[fake_bash.clone()], &[], &[], Some("cmd.exe"));
        let _ = std::fs::remove_file(&fake_bash);

        assert_eq!(shell, fake_bash.to_string_lossy().to_string());
        assert_eq!(args, vec!["--login".to_string(), "-i".to_string()]);
    }

    #[test]
    fn test_select_shell_fallback_powershell_candidate() {
        let temp_dir = std::env::temp_dir();
        let fake_ps = temp_dir.join("test_fake_powershell.exe");
        let _ = std::fs::File::create(&fake_ps);

        let (shell, args) = select_shell_candidate(&[], &[fake_ps.clone()], &[], Some("cmd.exe"));
        let _ = std::fs::remove_file(&fake_ps);

        assert_eq!(shell, fake_ps.to_string_lossy().to_string());
        assert!(args.is_empty());
    }

    #[test]
    fn test_select_shell_fallback_comspec() {
        let (shell, args) =
            select_shell_candidate(&[], &[], &[], Some("C:\\Windows\\system32\\cmd.exe"));
        assert_eq!(shell, "C:\\Windows\\system32\\cmd.exe");
        assert!(args.is_empty());

        let (default_shell, _) = select_shell_candidate(&[], &[], &[], None);
        assert_eq!(default_shell, "cmd.exe");
    }
}
