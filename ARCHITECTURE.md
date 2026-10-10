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

## 2. Frontend Structure (`public/`)

Native ES Modules tanpa bundler. Modularisasi CSS dan JS per concern:

```
public/
  index.html
  css/
    index.css               # Main CSS entry point (@import aggregator)
    tokens.css              # Design tokens (:root variables)
    base.css                # CSS reset & element base styles
    layout.css              # Shell, split panels, resize handles
    tabs.css                # Tab bar & tab items
    workspace.css           # Workspace view container
    views.css               # View panes (terminal, editor, diff, browser)
    explorer.css            # File tree explorer & icons
    git.css                 # Source control UI & diff indicators
    modals.css              # Dialogs, prompts, palette modals
  js/
    index.js                # Bootstrap entry point & app init
    api.js                  # Tauri invoke wrapper & transport bridge
    state.js                # Central application reactive state
    layout.js               # Shell layout & pane resize logic
    tabs.js                 # Tab manager & navigation
    workspace.js            # Workspace session & project state
    explorer.js             # File tree actions & navigation
    views/
      terminal.js           # xterm.js setup & PTY bridge
      editor.js             # Prism editor & file viewer
      diff.js               # Unified/split diff viewer
      browser.js            # Preview iframe/webview browser
    git/
      index.js              # Git panel bootstrap & events
      status.js             # Git status polling & staged/unstaged view
      diff.js               # Git diff loader & parser
      commits.js            # Commit history & commit action
```

### Frontend Rules
- Strict file limit 400–500 baris per file.
- Single-file monolithic CSS / JS dilarang keras.
- CSS wajib per concern di `public/css/`, entry point `index.css`.
- JS wajib native ES modules di `public/js/` dengan bootstrap di `index.js`.
- Subdomain views di `public/js/views/`, git domain di `public/js/git/`.

---

## 3. Backend Architecture (Rust / Tauri Commands)

```
src-tauri/src/
  main.rs                   # Binary entry point
  lib.rs                    # Tauri app builder, plugin registration & invoke handlers
  pty_mgr.rs                # PTY process manager & portable-pty session
  workspace.rs              # Workspace domain logic & state
  git_ops.rs                # Git command execution & parsing logic
  commands/
    mod.rs                  # Module registry & re-exports (`pub use ...`)
    workspace.rs            # Workspace invoke commands (`open_workspace`, etc.)
    fs.rs                   # Filesystem invoke commands (`read_dir`, `read_file`, etc.)
    git.rs                  # Git invoke commands (`git_status`, `git_diff`, etc.)
    system.rs               # System & platform commands
```

### Layer Flow
1. **Commands Layer (`src-tauri/src/commands/<domain>.rs`)**:
   - Handler command Tauri menerima IPC request dari frontend (`api.js`).
   - Parse argumen, validasi input, panggil domain logic, return `Result<T, String>`.
   - Re-export tersentralisasi via `commands/mod.rs`.
2. **Domain Modules (`src-tauri/src/<domain>.rs`)**:
   - Pure logic & core execution (`workspace.rs`, `git_ops.rs`, `pty_mgr.rs`).
   - Tidak direct-couple ke payload command Tauri.

### Rules & Native Error Handling
- **Zero Panic**: Haram `unwrap()` / `expect()` pada runtime command path. Gunakan `?` atau pattern matching.
- **Native Error**: Pakai `std::fmt::Display` + `std::error::Error` standar (tanpa phantom crate seperti `thiserror`).
- **File Limit**: Maksimal 400–500 baris per file. Command baru wajib masuk ke submodul domain masing-masing.

```rust
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

impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
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


