# ADE Desktop Harness

Desktop harness untuk Autonomous Development Environment (ADE) berbasis Tauri v2 dan embedded HTTP/WebSocket server.

## Tech Stack

- **Desktop Framework**: Tauri v2
- **Backend Core**: Rust (`Axum`, `portable-pty`, `Tokio`)
- **Frontend**: Vanilla JS, Vanilla CSS, native HTML (dengan vendor `xterm.js` & `prism.js`)

## Development

Jalankan mode development (desktop app + live reload backend):

```bash
cargo tauri dev
```

## Build Production

Build installer binary desktop:

```bash
cargo tauri build
```

Bundle output ada di `src-tauri/target/release/bundle/`.
