use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitFileChange {
    pub file: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatusResult {
    pub branch: String,
    pub upstream: String,
    pub staged: Vec<GitFileChange>,
    pub unstaged: Vec<GitFileChange>,
    pub untracked: Vec<String>,
    pub ignored: Vec<String>,
    pub clean: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommitItem {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub author: String,
    #[serde(rename = "relativeDate")]
    pub relative_date: String,
    pub message: String,
}

fn extended_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let curr = std::env::var("PATH").unwrap_or_default();
    format!("{}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:{}", home, curr)
}

pub async fn git_status(repo_path: &str) -> Result<GitStatusResult, String> {
    let output = Command::new("git")
        .args(["status", "--porcelain=v1", "--ignored=traditional", "-b"])
        .current_dir(repo_path)
        .env("PATH", extended_path())
        .output()
        .await
        .map_err(|e| format!("git status exec error: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(if err.trim().is_empty() {
            "git status failed".to_string()
        } else {
            err.trim().to_string()
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines = stdout.lines();

    let mut branch = String::new();
    let mut upstream = String::new();
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut ignored = Vec::new();

    for line in lines {
        if let Some(branch_line) = line.strip_prefix("## ") {
            let trimmed = branch_line.trim();
            if trimmed.starts_with("No commits yet on ") {
                branch = trimmed.replace("No commits yet on ", "").trim().to_string();
            } else if trimmed.starts_with("Initial commit on ") {
                branch = trimmed.replace("Initial commit on ", "").trim().to_string();
            } else {
                let parts: Vec<&str> = trimmed.split("...").collect();
                branch = parts.first().unwrap_or(&"").to_string();
                if parts.len() > 1 {
                    upstream = parts[1].split_whitespace().next().unwrap_or("").to_string();
                }
            }
            continue;
        }

        if let Some(ig) = line.strip_prefix("!! ") {
            ignored.push(ig.trim().to_string());
            continue;
        }

        if line.len() < 4 {
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let x = chars[0];
        let y = chars[1];
        let file = line[3..].trim().to_string();

        if x == '?' && y == '?' {
            untracked.push(file);
        } else {
            if x != ' ' && x != '?' {
                staged.push(GitFileChange {
                    file: file.clone(),
                    status: x.to_string(),
                });
            }
            if y != ' ' && y != '?' {
                unstaged.push(GitFileChange {
                    file,
                    status: y.to_string(),
                });
            }
        }
    }

    let clean = staged.is_empty() && unstaged.is_empty() && untracked.is_empty();

    Ok(GitStatusResult {
        branch,
        upstream,
        staged,
        unstaged,
        untracked,
        ignored,
        clean,
    })
}

pub async fn git_diff(
    repo_path: &str,
    target_file: Option<&str>,
    staged_only: bool,
    commit_hash: Option<&str>,
) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path).env("PATH", extended_path());

    if let Some(commit) = commit_hash {
        cmd.args(["show", "--patch", commit]);
    } else {
        cmd.arg("diff");
        if staged_only {
            cmd.arg("--cached");
        } else {
            cmd.arg("HEAD");
        }
        if let Some(file) = target_file {
            cmd.arg("--").arg(file);
        }
    }

    let output = cmd.output().await.map_err(|e| e.to_string())?;

    if !output.status.success() && !staged_only && commit_hash.is_none() {
        // Fallback for repo with no commits yet (HEAD not found)
        let mut fallback = Command::new("git");
        fallback.current_dir(repo_path).env("PATH", extended_path()).arg("diff");
        if let Some(file) = target_file {
            fallback.arg("--").arg(file);
        }
        let fb_out = fallback.output().await.map_err(|e| e.to_string())?;
        return Ok(String::from_utf8_lossy(&fb_out.stdout).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub async fn git_commit(repo_path: &str, message: &str, stage_all: bool) -> Result<String, String> {
    if stage_all {
        let add_out = Command::new("git")
            .args(["add", "-A"])
            .current_dir(repo_path)
            .env("PATH", extended_path())
            .output()
            .await
            .map_err(|e| e.to_string())?;

        if !add_out.status.success() {
            let err = String::from_utf8_lossy(&add_out.stderr);
            return Err(format!("git add failed: {}", err.trim()));
        }
    }

    let commit_out = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(repo_path)
        .env("PATH", extended_path())
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !commit_out.status.success() {
        let err = String::from_utf8_lossy(&commit_out.stderr);
        let out = String::from_utf8_lossy(&commit_out.stdout);
        let msg = if !err.trim().is_empty() { err } else { out };
        return Err(msg.trim().to_string());
    }

    Ok(String::from_utf8_lossy(&commit_out.stdout).trim().to_string())
}

pub async fn git_log(repo_path: &str) -> Result<Vec<GitCommitItem>, String> {
    let output = Command::new("git")
        .args(["log", "-n", "25", "--pretty=format:%H|%h|%an|%ar|%s"])
        .current_dir(repo_path)
        .env("PATH", extended_path())
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            GitCommitItem {
                hash: parts.first().unwrap_or(&"").to_string(),
                short_hash: parts.get(1).unwrap_or(&"").to_string(),
                author: parts.get(2).unwrap_or(&"").to_string(),
                relative_date: parts.get(3).unwrap_or(&"").to_string(),
                message: parts[4..].join("|"),
            }
        })
        .collect();

    Ok(commits)
}

pub async fn git_stage(repo_path: &str, file: Option<&str>, all: bool) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path).env("PATH", extended_path()).arg("add");

    if all {
        cmd.arg("-A");
    } else if let Some(f) = file {
        cmd.arg("--").arg(f);
    } else {
        return Err("file or all required".to_string());
    }

    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git add failed: {}", err.trim()));
    }
    Ok(())
}

pub async fn git_unstage(repo_path: &str, file: Option<&str>, all: bool) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path).env("PATH", extended_path()).args(["reset", "HEAD"]);

    if !all {
        if let Some(f) = file {
            cmd.arg("--").arg(f);
        } else {
            return Err("file or all required".to_string());
        }
    }

    let mut out = cmd.output().await.map_err(|e| e.to_string())?;

    // Fallback if no initial commit
    if !out.status.success() {
        let mut rm_cmd = Command::new("git");
        rm_cmd.current_dir(repo_path).env("PATH", extended_path()).args(["rm", "--cached", "-r", "--"]);
        if all {
            rm_cmd.arg(".");
        } else if let Some(f) = file {
            rm_cmd.arg(f);
        }
        out = rm_cmd.output().await.map_err(|e| e.to_string())?;
    }

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git unstage failed: {}", err.trim()));
    }

    Ok(())
}

pub async fn git_discard(repo_path: &str, file: Option<&str>, all: bool) -> Result<(), String> {
    if all {
        let _ = Command::new("git")
            .args(["restore", "--staged", "."])
            .current_dir(repo_path)
            .env("PATH", extended_path())
            .output()
            .await;

        let res = Command::new("git")
            .args(["restore", "--worktree", "."])
            .current_dir(repo_path)
            .env("PATH", extended_path())
            .output()
            .await;

        if let Ok(r) = res {
            if !r.status.success() {
                let _ = Command::new("git")
                    .args(["checkout", "--", "."])
                    .current_dir(repo_path)
                    .env("PATH", extended_path())
                    .output()
                    .await;
            }
        }

        let _ = Command::new("git")
            .args(["clean", "-fd"])
            .current_dir(repo_path)
            .env("PATH", extended_path())
            .output()
            .await;

        return Ok(());
    }

    let file_str = file.ok_or_else(|| "file or all required".to_string())?;
    let path = Path::new(repo_path).join(file_str);

    // Clean untracked
    let _ = Command::new("git")
        .args(["clean", "-fd", "--", file_str])
        .current_dir(repo_path)
        .env("PATH", extended_path())
        .output()
        .await;

    // Restore tracked changes
    let res = Command::new("git")
        .args(["restore", "--staged", "--worktree", "--", file_str])
        .current_dir(repo_path)
        .env("PATH", extended_path())
        .output()
        .await;

    if let Ok(r) = res {
        if !r.status.success() {
            let _ = Command::new("git")
                .args(["checkout", "--", file_str])
                .current_dir(repo_path)
                .env("PATH", extended_path())
                .output()
                .await;
        }
    }

    // Untracked physical deletion fallback
    if path.exists() {
        let check = Command::new("git")
            .args(["ls-files", "--error-unmatch", "--", file_str])
            .current_dir(repo_path)
            .env("PATH", extended_path())
            .output()
            .await;

        let is_tracked = check.map(|c| c.status.success()).unwrap_or(false);
        if !is_tracked {
            if path.is_dir() {
                let _ = tokio::fs::remove_dir_all(&path).await;
            } else {
                let _ = tokio::fs::remove_file(&path).await;
            }
        }
    }

    Ok(())
}
