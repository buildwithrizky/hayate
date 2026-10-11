# Changelog

## [0.1.6] - 2026-10-11

### Feat
- Persist window state across restarts.
- Unify new tab button, add shortcuts, polish tab icons, and handle empty workspace state.
- Add Cmd+Backspace shortcut to clear line in terminal.

### Fix
- Correct gitignore matching for directory rules and parent paths.

### Refactor
- Save clipboard images to temp with UUID naming.

## [0.1.5] - 2026-10-10

### Fix
- Configure active minisign signing keys and enable Tauri auto-updater artifacts (`latest.json` & `.sig`).

## [0.1.4] - 2026-10-10

### Feat
- UI resizable sidebars with persistence and keyboard shortcuts (Cmd+B, Cmd+L).
- Vertical ellipsis dropdown menu on workspace items.

### Fix
- Git status badge alignment and whitespace wrap in source control file tree.

### Refactor
- Modularize monolithic CSS (`public/css/*`), JS ES modules (`public/js/*`), and backend Tauri commands (`src-tauri/src/commands/*`).

### Style
- Enforce strict design system tokens across UI components.
