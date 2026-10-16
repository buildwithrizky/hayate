# Hayate

[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-1.80+-orange?logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

High-performance, lightweight developer workspace and terminal harness built on Tauri v2 and Rust, styled with Sokudo design system aesthetics.

---

## Features

- **Workspace Management**: Multi-folder workspace switcher with persistent state in `~/.hayate/workspaces.json`.
- **Multi-Tab Workbench**:
  - Terminal: Embedded PTY via `portable-pty` and xterm.js.
  - Browser: In-app live web preview.
  - Markdown: Live rendered preview.
  - Code Editor: Syntax-highlighted code viewer and editor.
  - Diff Viewer: Side-by-side and unified git diff views.
- **Built-in Git & Source Control**: Visual branch tree, file staging/unstaging/discard, commit box, and interactive commit history.
- **Built-in File Explorer**: Interactive directory tree with git status decorators and quick preview modal.
- **Productivity Shortcuts**:
  - `Cmd+B` / `Ctrl+B`: Toggle workspace sidebar.
  - `Cmd+L` / `Ctrl+L`: Toggle git/explorer sidebar.
  - Drag-to-resize split panels.
- **Native IPC Architecture**: Fast, low-latency Tauri v2 native commands and event bridges (zero external HTTP server overhead).
- **Auto-Updater**: Background update checker using cryptographically signed release manifests (`minisign`).

---

## Installation (macOS)

1. Download `Hayate_<version>_aarch64.zip` from [GitHub Releases](https://github.com/buildwithrizky/hayate/releases).
2. Extract file zip, drag `Hayate.app` ke folder `/Applications`.
3. Jika muncul warning Gatekeeper ("damaged" / "developer cannot be verified" karena belum ada Apple Developer ID):
   - Klik kanan `Hayate.app` > pilih **Open** > klik **Open Anyway**.
   - Atau jalankan di terminal:
     ```bash
     xattr -cr /Applications/Hayate.app
     ```

---

## Development

### Prerequisites

- Rust 1.80+ (`rustup default stable`)
- Bun or Node.js

### Run Dev

```bash
cargo tauri dev
```

### Build Production

```bash
cargo tauri build
```

Bundle output located at `src-tauri/target/release/bundle/`.

---

## Architecture & Codebase Design

- **Modular CSS (`public/css/*`)**: Token-driven styling following the Sokudo design system; zero hardcoded magic values.
- **Native ES Modules (`public/js/*`)**: Vanilla ESM runtime; zero bundler friction, instant browser reload.
- **Modular Backend Commands (`src-tauri/src/commands/*`)**: Domain-separated Rust IPC commands (pty, git, fs, workspace, updater).

For deep dives:
- See [`ARCHITECTURE.md`](ARCHITECTURE.md) for IPC flow, state handling, and PTY lifecycle.
- See [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) for tokens, typography, and UI specs.
