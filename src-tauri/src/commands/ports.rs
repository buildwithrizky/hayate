use crate::process_utils::silent_command;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListeningPort {
    pub port: u16,
    pub pid: u32,
    pub command: String,
    pub address: String,
}

pub fn parse_lsof_ports(output: &str) -> Vec<ListeningPort> {
    let mut ports = Vec::new();
    let mut seen_ports = HashSet::new();

    for line in output.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }

        let command = parts[0].to_string();
        let pid = match parts[1].parse::<u32>() {
            Ok(p) => p,
            Err(_) => continue,
        };

        let addr_candidate = if parts.last() == Some(&"(LISTEN)") {
            parts.get(parts.len() - 2).copied().unwrap_or("")
        } else {
            parts.last().copied().unwrap_or("")
        };

        if let Some(colon_pos) = addr_candidate.rfind(':') {
            let port_str = &addr_candidate[colon_pos + 1..];
            if let Ok(port) = port_str.parse::<u16>() {
                if !seen_ports.contains(&port) {
                    seen_ports.insert(port);
                    ports.push(ListeningPort {
                        port,
                        pid,
                        command,
                        address: addr_candidate.to_string(),
                    });
                }
            }
        }
    }

    ports.sort_by_key(|p| p.port);
    ports
}

#[tauri::command]
pub async fn list_active_ports() -> Result<Vec<ListeningPort>, String> {
    #[cfg(windows)]
    {
        let output = silent_command("netstat")
            .args(&["-ano", "-p", "tcp"])
            .output()
            .await
            .map_err(|e| format!("netstat exec error: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut ports = Vec::new();
        let mut seen = HashSet::new();
        for line in stdout.lines() {
            if line.contains("LISTENING") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 5 {
                    if let (Some(addr), Ok(pid)) = (parts.get(1), parts[4].parse::<u32>()) {
                        if let Some(pos) = addr.rfind(':') {
                            if let Ok(port) = addr[pos + 1..].parse::<u16>() {
                                if !seen.contains(&port) {
                                    seen.insert(port);
                                    ports.push(ListeningPort {
                                        port,
                                        pid,
                                        command: "process".into(),
                                        address: addr.to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        ports.sort_by_key(|p| p.port);
        Ok(ports)
    }

    #[cfg(not(windows))]
    {
        let output = silent_command("lsof")
            .args(&["-iTCP", "-sTCP:LISTEN", "-n", "-P"])
            .output()
            .await
            .map_err(|e| format!("lsof exec error: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(parse_lsof_ports(&stdout))
    }
}

#[tauri::command]
pub async fn kill_port_process(pid: u32) -> Result<(), String> {
    if pid <= 1 {
        return Err("invalid pid".to_string());
    }

    #[cfg(windows)]
    {
        silent_command("taskkill")
            .args(&["/F", "/PID", &pid.to_string()])
            .output()
            .await
            .map_err(|e| format!("taskkill error: {e}"))?;
    }

    #[cfg(not(windows))]
    {
        silent_command("kill")
            .args(&["-9", &pid.to_string()])
            .output()
            .await
            .map_err(|e| format!("kill error: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lsof_ports() {
        let sample = "COMMAND  PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnode 1234 dev 22u IPv4 0x123 0t0 TCP *:3000 (LISTEN)\nbun 5678 dev 14u IPv4 0x456 0t0 TCP 127.0.0.1:5173 (LISTEN)\n";
        let ports = parse_lsof_ports(sample);
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].port, 3000);
        assert_eq!(ports[0].command, "node");
        assert_eq!(ports[0].pid, 1234);

        assert_eq!(ports[1].port, 5173);
        assert_eq!(ports[1].command, "bun");
        assert_eq!(ports[1].pid, 5678);
    }
}
