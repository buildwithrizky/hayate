use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub path: String,
    pub relative_path: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
    #[serde(default)]
    pub is_file_match: bool,
}

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    ".hayate",
    ".idea",
    ".vscode",
    "dist",
    "build",
];

const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB limit

fn is_binary_buffer(buffer: &[u8]) -> bool {
    // ponytail: simple NUL byte scan detects binary fast; upgrade to content-inspector crate if encoding edge cases emerge
    buffer.iter().take(8192).any(|&b| b == 0)
}

fn glob_to_regex(pattern: &str) -> Option<Regex> {
    let pat = pattern.trim();
    if pat.is_empty() || pat == "*" {
        return None;
    }
    let mut regex_str = String::with_capacity(pat.len() * 2 + 10);
    regex_str.push('^');
    let mut chars = pat.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    if chars.peek() == Some(&'/') {
                        chars.next();
                        regex_str.push_str("(?:.*/)?");
                    } else {
                        regex_str.push_str(".*");
                    }
                } else {
                    regex_str.push_str("[^/]*");
                }
            }
            '?' => regex_str.push_str("[^/]"),
            '.' | '(' | ')' | '+' | '|' | '^' | '$' | '@' | '%' | '{' | '}' | '[' | ']' | '\\' => {
                regex_str.push('\\');
                regex_str.push(c);
            }
            _ => regex_str.push(c),
        }
    }
    regex_str.push('$');
    RegexBuilder::new(&regex_str)
        .case_insensitive(true)
        .build()
        .ok()
}

fn matches_include(rel_path: &str, include_regex: Option<&Regex>) -> bool {
    if let Some(re) = include_regex {
        let norm = rel_path.replace('\\', "/");
        let file_name = norm.rsplit('/').next().unwrap_or(&norm);
        re.is_match(&norm) || re.is_match(file_name)
    } else {
        true
    }
}

fn collect_search_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()), // skip unreadable directories silently
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };

        if SKIP_DIRS.iter().any(|&d| d.eq_ignore_ascii_case(file_name)) {
            continue;
        }

        let is_dir = match entry.file_type() {
            Ok(ft) => ft.is_dir(),
            Err(_) => false,
        };

        if is_dir {
            collect_search_files(&path, files)?;
        } else {
            files.push(path);
        }
    }
    Ok(())
}

fn build_search_matcher(
    query: &str,
    case_sensitive: bool,
    match_whole_word: bool,
    use_regex: bool,
) -> Result<Regex, String> {
    let pattern = if use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };

    let full_pattern = if match_whole_word {
        format!(r"\b(?:{})\b", pattern)
    } else {
        pattern
    };

    RegexBuilder::new(&full_pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid search pattern: {e}"))
}

#[tauri::command]
pub async fn search_in_files(
    root_path: String,
    query: String,
    case_sensitive: bool,
    match_whole_word: bool,
    use_regex: bool,
    include_pattern: Option<String>,
    max_results: Option<usize>,
) -> Result<Vec<SearchResultItem>, String> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Root directory does not exist: {}", root_path));
    }

    let matcher = build_search_matcher(&query, case_sensitive, match_whole_word, use_regex)?;
    let limit = max_results.unwrap_or(2000);
    let inc_re = include_pattern.as_deref().and_then(glob_to_regex);

    tokio::task::spawn_blocking(move || {
        let mut file_list = Vec::new();
        collect_search_files(&root, &mut file_list)?;

        let mut results = Vec::new();
        let mut check_buffer = [0u8; 8192];

        for file_path in file_list {
            if results.len() >= limit {
                break;
            }

            let rel_str = match file_path.strip_prefix(&root) {
                Ok(p) => p.to_string_lossy().replace('\\', "/"),
                Err(_) => file_path.to_string_lossy().replace('\\', "/"),
            };

            if !matches_include(&rel_str, inc_re.as_ref()) {
                continue;
            }

            let meta = match fs::metadata(&file_path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            if meta.len() > MAX_FILE_SIZE_BYTES {
                continue;
            }

            let mut file = match File::open(&file_path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let read_bytes = match file.read(&mut check_buffer) {
                Ok(n) => n,
                Err(_) => continue,
            };

            if is_binary_buffer(&check_buffer[..read_bytes]) {
                continue;
            }

            // Rewind or re-open file for line-by-line streaming
            let file = match File::open(&file_path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let full_path_str = file_path.to_string_lossy().to_string();
            let file_name = Path::new(&rel_str)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&rel_str);

            // Match filename itself
            if let Some(mat) = matcher.find(file_name).filter(|_| results.len() < limit) {
                results.push(SearchResultItem {
                    path: full_path_str.clone(),
                    relative_path: rel_str.clone(),
                    line_number: 0,
                    line_content: file_name.to_string(),
                    match_start: mat.start(),
                    match_end: mat.end(),
                    is_file_match: true,
                });
            }

            let reader = BufReader::new(file);

            for (idx, line_res) in reader.lines().enumerate() {
                if results.len() >= limit {
                    break;
                }

                let line = match line_res {
                    Ok(l) => l,
                    Err(_) => break, // non-utf8 line encountered, stop file
                };

                for mat in matcher.find_iter(&line) {
                    if results.len() >= limit {
                        break;
                    }
                    results.push(SearchResultItem {
                        path: full_path_str.clone(),
                        relative_path: rel_str.clone(),
                        line_number: idx + 1,
                        line_content: line.clone(),
                        match_start: mat.start(),
                        match_end: mat.end(),
                        is_file_match: false,
                    });
                }
            }
        }

        Ok(results)
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub async fn list_workspace_files(
    root_path: String,
    max_files: Option<usize>,
) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Root directory does not exist: {}", root_path));
    }

    let limit = max_files.unwrap_or(10_000);

    tokio::task::spawn_blocking(move || {
        let mut file_list = Vec::new();
        collect_search_files(&root, &mut file_list)?;

        // ponytail: sort relative paths lexicographically; upgrade to gitignore crate if user ignores needed
        let mut rel_paths: Vec<String> = file_list
            .into_iter()
            .take(limit)
            .map(|p| match p.strip_prefix(&root) {
                Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
                Err(_) => p.to_string_lossy().replace('\\', "/"),
            })
            .collect();

        rel_paths.sort();
        Ok(rel_paths)
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_matcher_exact() {
        let matcher = build_search_matcher("hello", true, false, false).unwrap();
        assert!(matcher.is_match("hello world"));
        assert!(!matcher.is_match("Hello world"));
    }

    #[test]
    fn test_search_matcher_whole_word() {
        let matcher = build_search_matcher("foo", false, true, false).unwrap();
        assert!(matcher.is_match("bar foo baz"));
        assert!(!matcher.is_match("bar foobar baz"));
    }

    #[test]
    fn test_filename_match() {
        let matcher = build_search_matcher("main", false, false, false).unwrap();
        assert!(matcher.is_match("main.rs"));
    }

    #[test]
    fn test_glob_matcher() {
        let re = glob_to_regex("*.rs").unwrap();
        assert!(matches_include("src/main.rs", Some(&re)));
        assert!(!matches_include("src/main.js", Some(&re)));
    }

    #[tokio::test]
    async fn test_list_workspace_files_invalid_path() {
        let res = list_workspace_files("non_existent_dir_12345".to_string(), None).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn test_list_workspace_files_current_dir() {
        let res = list_workspace_files(".".to_string(), Some(10)).await;
        assert!(res.is_ok());
        let files = res.unwrap();
        assert!(!files.is_empty());
    }
}
