# Architecture Blueprint - Hayate

## 1. System Overview

```
+-------------------------------------------------------------+
| Tauri v2 Desktop Shell                                      |
|                                                             |
|  +-------------------------+     HTTP / WebSocket           |
|  | Webview (Vanilla ES)    | <====================+         |
|  | index.html + public/js/ |                      |         |
|  +-------------------------+                      v         |
|                                        +------------------+ |
|                                        | Axum Microservice| |
|                                        | localhost:PORT   | |
|                                        +------------------+ |
|                                                 |           |
|                                        Tokio Async Runtime  |
|                                                 |           |
|                 +-------------------------------+---------+ |
|                 |               |               |         | |
|                 v               v               v         v |
|              PTY Mgr       Agent Core       Workspace  Git Ops|
+-------------------------------------------------------------+
```

---

## 2. Frontend Structure (`public/js/`)

Native ES Modules tanpa bundler. Pisah per domain praktis:

```
public/
  index.html
  style.css
  js/
    main.js                 # Entry point bootstrap
    api.js                  # Fetch wrapper & HTTP/WS calls
    terminal.js             # xterm.js setup & PTY WebSocket bridge
    agent.js                # Agent prompt, SSE/WS streaming, chat UI
    workspace.js            # File tree, file I/O, tabs, state
```

### Module Rules
- `api.js`: single source of truth HTTP/WS transport.
- `terminal.js`: lifecycle terminal dan resize handler.
- `agent.js`: interaksi Hayate agent, render chat & stream output.
- `workspace.js`: state file explorer & editor view.
- No monolith: dilarang tumpuk semua logic di satu file >3000 baris.

---

## 3. Backend Architecture (Rust / Axum)

### Layer Flow
1. **Handlers (`http_server.rs`)**: Route matching, parameter parsing, return response.
2. **Domain Modules**: Logic inti di modul terpisah (`pty_mgr.rs`, `workspace.rs`, `git_ops.rs`).

### Rules & Native Error Handling
- **Zero Panic**: Haram `unwrap()` / `expect()` pada request handler.
- **Native Error**: Pakai `std::fmt::Display` + `std::error::Error` standar (tanpa phantom crate seperti `thiserror`).

```rust
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::{error::Error, fmt};

#[derive(Debug)]
pub enum AppError {
    Pty(String),
    Io(std::io::Error),
    NotFound(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pty(msg) => write!(f, "PTY error: {msg}"),
            Self::Io(err) => write!(f, "IO error: {err}"),
            Self::NotFound(item) => write!(f, "Not found: {item}"),
        }
    }
}

impl Error for AppError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(err) => Some(err),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            Self::Pty(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            Self::Io(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}
```

---

## 4. Checklist Audit Kualitas DRY & SOLID

Setiap fitur atau perubahan kode wajib lolos checklist ini sebelum merge/commit:

- [ ] **DRY - Zero Duplication**: Tidak ada logic copy-paste; helper/util diekstrak jika pola berulang $\ge$ 2 kali.
- [ ] **DRY - SSOT Enforced**: State, tipe data, endpoint, dan konstanta tersentralisasi di satu modul definisi.
- [ ] **SRP - Single Responsibility**: Fungsi $\le$ 40–50 baris; setiap modul/struct/fungsi hanya tangani satu tugas.
- [ ] **OCP - Open/Closed**: Penambahan fitur baru memakai ekstensi (trait/handler/plugin) tanpa merusak core logic.
- [ ] **LSP - Liskov Substitution**: Semua implementasi trait/interface memenuhi kontrak tanpa behavior aneh atau error tak terduga.
- [ ] **ISP - Interface Segregation**: Interface/trait fokus dan ramping; caller tidak terbebani method yang tidak dibutuhkan.
- [ ] **DIP - Dependency Inversion**: Domain logic bergantung pada abstraksi/trait, bukan IO langsung atau implementasi konkrit adapter.


