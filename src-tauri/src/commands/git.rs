use crate::process_utils::silent_command;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::git_ops;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchItem {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncStatus {
    pub ahead: usize,
    pub behind: usize,
}

fn extended_path() -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let current_path = std::env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<std::path::PathBuf> = Vec::new();

    if !home.is_empty() {
        paths.push(std::path::PathBuf::from(&home).join(".bun").join("bin"));
    }
    #[cfg(not(windows))]
    {
        paths.push(std::path::PathBuf::from("/opt/homebrew/bin"));
        paths.push(std::path::PathBuf::from("/usr/local/bin"));
    }
    paths.extend(std::env::split_paths(&current_path));
    std::env::join_paths(paths)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

async fn run_git_cmd(repo_path: &str, args: &[&str]) -> Result<String, String> {
    if repo_path.trim().is_empty() {
        return Err("repo_path required".to_string());
    }

    let output = silent_command("git")
        .args(args)
        .current_dir(repo_path)
        .env("PATH", extended_path())
        .output()
        .await
        .map_err(|e| format!("git {} exec error: {e}", args.first().unwrap_or(&"")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!(
                "git {} failed with exit code {:?}",
                args.first().unwrap_or(&""),
                output.status.code()
            )
        };
        return Err(msg);
    }

    if !stdout.is_empty() {
        Ok(stdout)
    } else {
        Ok(stderr)
    }
}

#[tauri::command]
pub async fn get_git_status(path: String) -> Result<git_ops::GitStatusResult, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    git_ops::git_status(&path).await
}

#[tauri::command]
pub async fn get_git_diff(
    path: String,
    file: Option<String>,
    staged: Option<bool>,
    commit: Option<String>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    let staged_only = staged.unwrap_or(false);
    let diff = git_ops::git_diff(&path, file.as_deref(), staged_only, commit.as_deref()).await?;
    Ok(json!({ "diff": diff, "file": file }))
}

#[tauri::command]
pub async fn git_commit(
    path: String,
    message: String,
    stage_all: Option<bool>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    if message.trim().is_empty() {
        return Err("message required".to_string());
    }
    let stage = stage_all != Some(false);
    let output = git_ops::git_commit(&path, &message, stage).await?;
    Ok(json!({ "ok": true, "output": output }))
}

#[tauri::command]
pub async fn get_git_log(path: String) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    let commits = git_ops::git_log(&path).await?;
    Ok(json!({ "commits": commits }))
}

#[tauri::command]
pub async fn git_stage(
    path: String,
    file: Option<String>,
    all: Option<bool>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    git_ops::git_stage(&path, file.as_deref(), all == Some(true)).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn git_unstage(
    path: String,
    file: Option<String>,
    all: Option<bool>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    git_ops::git_unstage(&path, file.as_deref(), all == Some(true)).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn git_discard(
    path: String,
    file: Option<String>,
    all: Option<bool>,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("path required".to_string());
    }
    git_ops::git_discard(&path, file.as_deref(), all == Some(true)).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn git_push(repo_path: String) -> Result<String, String> {
    run_git_cmd(&repo_path, &["push"]).await
}

#[tauri::command]
pub async fn git_pull(repo_path: String) -> Result<String, String> {
    run_git_cmd(&repo_path, &["pull"]).await
}

#[tauri::command]
pub async fn git_fetch(repo_path: String) -> Result<String, String> {
    run_git_cmd(&repo_path, &["fetch"]).await
}

pub fn parse_branch_list(output: &str) -> Vec<BranchItem> {
    let mut branches = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let is_current = line.starts_with('*');
        let raw_name = trimmed.strip_prefix('*').unwrap_or(trimmed).trim();

        // ponytail: skip symbolic HEAD pointer aliases like 'origin/HEAD -> origin/main'
        if raw_name.contains("->") {
            continue;
        }

        let is_remote = raw_name.starts_with("remotes/");
        let name = if let Some(stripped) = raw_name.strip_prefix("remotes/") {
            stripped.to_string()
        } else {
            raw_name.to_string()
        };

        branches.push(BranchItem {
            name,
            is_current,
            is_remote,
        });
    }

    branches
}

#[tauri::command]
pub async fn git_list_branches(repo_path: String) -> Result<Vec<BranchItem>, String> {
    let raw = run_git_cmd(&repo_path, &["branch", "-a"]).await?;
    Ok(parse_branch_list(&raw))
}

#[tauri::command]
pub async fn git_checkout_branch(
    repo_path: String,
    branch_name: String,
    create_new: bool,
) -> Result<String, String> {
    let trimmed = branch_name.trim();
    if trimmed.is_empty() {
        return Err("branch_name required".to_string());
    }

    let args: Vec<&str> = if create_new {
        vec!["checkout", "-b", trimmed]
    } else {
        vec!["checkout", trimmed]
    };

    run_git_cmd(&repo_path, &args).await
}

#[tauri::command]
pub async fn git_stash(repo_path: String, include_untracked: bool) -> Result<String, String> {
    let args: Vec<&str> = if include_untracked {
        vec!["stash", "push", "-u"]
    } else {
        vec!["stash", "push"]
    };

    run_git_cmd(&repo_path, &args).await
}

#[tauri::command]
pub async fn git_stash_pop(repo_path: String) -> Result<String, String> {
    run_git_cmd(&repo_path, &["stash", "pop"]).await
}

pub fn parse_sync_status(output: &str) -> Result<SyncStatus, String> {
    let trimmed = output.trim();
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(format!("unexpected rev-list output: {output}"));
    }

    let ahead = parts[0]
        .parse::<usize>()
        .map_err(|e| format!("failed to parse ahead count: {e}"))?;
    let behind = parts[1]
        .parse::<usize>()
        .map_err(|e| format!("failed to parse behind count: {e}"))?;

    Ok(SyncStatus { ahead, behind })
}

#[tauri::command]
pub async fn git_get_sync_status(repo_path: String) -> Result<SyncStatus, String> {
    let raw = run_git_cmd(
        &repo_path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .await?;
    parse_sync_status(&raw)
}

#[tauri::command]
pub async fn git_show_file(repo_path: String, spec: String) -> Result<String, String> {
    git_ops::git_show_file(&repo_path, &spec).await
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorktreeItem {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub is_bare: bool,
    pub is_main: bool,
    pub is_agent_scratch: bool,
}

pub fn parse_worktree_list(output: &str) -> Vec<WorktreeItem> {
    let mut worktrees = Vec::new();
    let blocks = output.split("\n\n");
    let mut is_first = true;

    for block in blocks {
        let lines: Vec<&str> = block.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
        if lines.is_empty() {
            continue;
        }

        let mut path = String::new();
        let mut head = String::new();
        let mut branch = String::new();
        let mut is_bare = false;

        for line in lines {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = p.trim().to_string();
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.trim().to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                let stripped = b.trim();
                branch = stripped.strip_prefix("refs/heads/").unwrap_or(stripped).to_string();
            } else if line == "bare" {
                is_bare = true;
            }
        }

        if !path.is_empty() {
            let is_agent_scratch = path.contains(".claude/worktrees") || path.contains(".gsd-workspaces");
            worktrees.push(WorktreeItem {
                path,
                head,
                branch,
                is_bare,
                is_main: is_first,
                is_agent_scratch,
            });
            is_first = false;
        }
    }

    worktrees
}

#[tauri::command]
pub async fn git_list_worktrees(repo_path: String) -> Result<Vec<WorktreeItem>, String> {
    let raw = run_git_cmd(&repo_path, &["worktree", "list", "--porcelain"]).await?;
    Ok(parse_worktree_list(&raw))
}

#[tauri::command]
pub async fn git_add_worktree(
    repo_path: String,
    path: String,
    branch: String,
    create_branch: bool,
) -> Result<String, String> {
    let p = path.trim();
    let b = branch.trim();
    if p.is_empty() {
        return Err("path required".to_string());
    }

    let args: Vec<&str> = if create_branch {
        if b.is_empty() {
            return Err("branch required when create_branch is true".to_string());
        }
        vec!["worktree", "add", "-b", b, p]
    } else if !b.is_empty() {
        vec!["worktree", "add", p, b]
    } else {
        vec!["worktree", "add", p]
    };

    run_git_cmd(&repo_path, &args).await
}

#[tauri::command]
pub async fn git_remove_worktree(
    repo_path: String,
    path: String,
    force: bool,
) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("path required".to_string());
    }

    let args: Vec<&str> = if force {
        vec!["worktree", "remove", "--force", p]
    } else {
        vec!["worktree", "remove", p]
    };

    run_git_cmd(&repo_path, &args).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_worktree_list() {
        let sample = "worktree /Users/dev/hayate\nHEAD 1234abcd\nbranch refs/heads/main\n\nworktree /Users/dev/hayate/.claude/worktrees/agent-1\nHEAD 5678ef01\nbranch refs/heads/agent-feature\n\n";
        let list = parse_worktree_list(sample);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].path, "/Users/dev/hayate");
        assert_eq!(list[0].branch, "main");
        assert!(list[0].is_main);
        assert!(!list[0].is_agent_scratch);

        assert_eq!(list[1].path, "/Users/dev/hayate/.claude/worktrees/agent-1");
        assert_eq!(list[1].branch, "agent-feature");
        assert!(!list[1].is_main);
        assert!(list[1].is_agent_scratch);
    }

    #[test]
    fn test_parse_branch_list() {
        let sample =
            "* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n  feature/test\n";
        let branches = parse_branch_list(sample);
        assert_eq!(branches.len(), 3);
        assert_eq!(
            branches[0],
            BranchItem {
                name: "main".into(),
                is_current: true,
                is_remote: false
            }
        );
        assert_eq!(
            branches[1],
            BranchItem {
                name: "origin/main".into(),
                is_current: false,
                is_remote: true
            }
        );
        assert_eq!(
            branches[2],
            BranchItem {
                name: "feature/test".into(),
                is_current: false,
                is_remote: false
            }
        );
    }

    #[test]
    fn test_parse_sync_status() {
        let sample = "3\t5\n";
        let status = parse_sync_status(sample).expect("valid counts");
        assert_eq!(
            status,
            SyncStatus {
                ahead: 3,
                behind: 5
            }
        );
    }
}
