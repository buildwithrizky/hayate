# Agent Notch Companion Blueprint

Dokumen perancangan teknis integrasi Notch HUD & AI Agent Companion di Hayate (adopsi konsep Coucou - Skenario 3: Persistent Ambient Companion).

Referensi arsitektur & token styling:
- [ARCHITECTURE.md](../ARCHITECTURE.md) (Tauri v2 shell, Axum microservice, Tokio runtime, PTY manager)
- [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) (Pure Pitch Black palette, strict `:root` tokens, zero hardcoded CSS)

---

## 1. Ringkasan & Arsitektur Sistem

Notch Companion adalah overlay HUD persistent pada notch MacBook (atau top-center screen non-notch). Berfungsi memantau live status agent eksternal/internal (Claude Code, Pi, Goose, Aider, Hayate internal agent), menampilkan visual activity stream, serta melayani tool execution approval secara real-time.

### Diagram Arsitektur

```
+-----------------------------------------------------------------------------------+
| Host System (macOS / Linux / Windows)                                             |
|                                                                                   |
|  +--------------------+   JSON-RPC over Unix Domain Socket   +-----------------+  |
|  | CLI Agent Process  | -----------------------------------> | hayate-hook CLI |  |
|  | (Claude Code, Pi)  | <----------------------------------- | (shims/wrapper) |  |
|  +--------------------+           stdout/exit-code           +--------+--------+  |
|                                                                       |           |
|                                         IPC: /tmp/hayate-notch.sock   |           |
|                                         (Windows: Named Pipe)         v           |
|  +-----------------------------------------------------------------------------+  |
|  | Hayate Core (Tauri v2 + Tokio Runtime)                                      |  |
|  |                                                                             |  |
|  |  +---------------------------+       tokio::sync::broadcast                 |  |
|  |  | Unix Domain Socket Server | -----------------------------------+          |  |
|  |  | (tokio::net::UnixListener)|                                    |          |  |
|  |  +---------------------------+                                    v          |  |
|  |                                                        +------------------+ |  |
|  |  +---------------------------+     Tauri Event IPC     | Notch State Mgr  | |  |
|  |  | AppKit Window Controller  | <====================== | (In-memory sync) | |  |
|  |  | (NSPanel, StatusItem)     |                         +--------+---------+ |  |
|  |  +---------------------------+                                  |           |  |
|  |                                                                 v           |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  | Tauri Webview Window: `notch` (`public/notch.html`)                   |  |  |
|  |  | - Status Pill: idle | busy | waiting_approval | error                   |  |  |
|  |  | - Expandable HUD Panel (Tool approval card, live token, diff stream) |  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### Komponen Inti
1. **Unix Domain Socket Listener (`tokio::net::UnixListener`)**: Endpoint `/tmp/hayate-notch.sock` menangani stream event status dan approval request berlatensi sub-milidetik.
2. **Notch State Manager**: Menyimpan state mesin `idle` -> `busy` -> `waiting_approval` -> `completed`/`failed`, route timeout approval, dan sinkronisasi ke UI.
3. **Dedicated Tauri Webview (`notch`)**: Window independen transparan dengan posisi presisi di bezel atas layar.
4. **AppKit Window Level Bridge**: Memastikan HUD berada di layer atas (`NSStatusWindowLevel`), non-activating panel (`NSWindowStyleMaskNonactivatingPanel`), dan support multi-space macOS.

---

## 2. Protocol IPC (Unix Domain Socket / Named Pipe)

Komunikasi menggunakan JSON-RPC 2.0 framing via newline-delimited JSON (`\n`).

### 2.1 Agent State Event (`agent.status`)
CLI hook mengirim update status pekerjaan agent.

**Payload Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "agent.status",
  "params": {
    "session_id": "sess-claude-9821",
    "agent_name": "Claude Code",
    "state": "busy",
    "message": "Editing src-tauri/src/pty.rs",
    "tokens": {
      "input": 12450,
      "output": 830
    },
    "timestamp": 1711200000000
  }
}
```

**Nilai `state`:** `idle` | `busy` | `waiting_approval` | `success` | `error`

### 2.2 Tool Approval Request (`tool.request_approval`)
Agent hook memblokir eksekusi sampai Hayate Notch mengirim approval/rejection.

**Payload Request (Hook -> Hayate):**
```json
{
  "jsonrpc": "2.0",
  "id": "req-tool-104",
  "method": "tool.request_approval",
  "params": {
    "session_id": "sess-claude-9821",
    "tool_name": "Bash",
    "command": "cargo test --all",
    "danger_level": "medium",
    "working_dir": "/Users/rizkymaulana/Projects/hayate",
    "timeout_ms": 60000
  }
}
```

**Payload Response (Hayate -> Hook):**
```json
{
  "jsonrpc": "2.0",
  "id": "req-tool-104",
  "result": {
    "decision": "approved",
    "override_command": null,
    "user_note": null,
    "decided_at": 1711200005120
  }
}
```

**Nilai `decision`:** `approved` | `rejected` | `timed_out`

---

## 3. Window Management macOS (AppKit Level)

Agar HUD menempel natural pada notch hardware MacBook tanpa flicker atau mengambil fokus keyboard workspace:

### 3.1 Properti NSWindow / NSPanel
- **Subclass**: `NSPanel` dengan flag `NSWindowStyleMaskNonactivatingPanel` agar terminal/editor pengguna tidak kehilangan keyboard focus saat HUD muncul.
- **Window Level**: `kCGStatusWindowLevel` (di atas fullscreen apps dan dock).
- **Collection Behavior**:
  ```objc
  [panel setCollectionBehavior:
      NSWindowCollectionBehaviorCanJoinAllSpaces |
      NSWindowCollectionBehaviorStationary |
      NSWindowCollectionBehaviorIgnoresCycle |
      NSWindowCollectionBehaviorFullScreenAuxiliary];
  ```
- **Transparency & Chrome**:
  - `isOpaque = NO`
  - `backgroundColor = [NSColor clearColor]`
  - `hasShadow = NO` (shadow di-handle via CSS token `--shadow-lg` Hayate)
  - `titlebarAppearsTransparent = YES`

### 3.2 Notch Geometry Detection
Pemanfaatan `NSScreen` API pada macOS:
- Cek property `safeAreaInsets.top`:
  - Jika `safeAreaInsets.top > 24.0pt` -> Hardware notch terdeteksi (MacBook Pro/Air M-series). Lebar notch tipikal ~160pt-220pt.
  - Jika standard (`<= 24.0pt`) -> Non-notch screen. HUD dirender sebagai compact top pill floating (32px height, centered horizontally).
- **Centering Calculation**:
  - `X = screen.frame.origin.x + (screen.frame.size.width - hud_width) / 2`
  - `Y = screen.frame.origin.y + screen.frame.size.height - hud_height`

### 3.3 State Visual Sizing
| State | Width | Height | Visual Appearance |
|---|---|---|---|
| Compact (Idle/Running) | `180px` | `32px` | Menempel presisi menutup bezel notch |
| Expand (Tool Approval) | `460px` | `180px` | Expand ke bawah melingkupi detail perintah & diff |
| Expanded Live Stream | `520px` | `320px` | Scrollable command output / thought logs |

---

## 4. CLI Hook (`hayate-hook`) & PTY Terminal Integration

### 4.1 CLI Binary Specs (`hayate-hook`)
Lightweight Rust binary (diproduksi di `src-tauri/src/bin/hayate-hook.rs`):
- Ukuran biner < 2MB, runtime overhead < 5ms startup.
- Mode Eksekusi:
  1. `hayate-hook notify --state busy --msg "Compiling..."`
  2. `hayate-hook approve --tool "Bash" --cmd "git reset --hard"`
- Jika socket `/tmp/hayate-notch.sock` tidak aktif (Hayate closed):
  - Fallback graceful: langsung prompt interaktif TTY via fallback terminal standard (`[Y/n]`).

### 4.2 Integration Claude Code / Pi Coding Agent
Konfigurasi wrapper script atau global runner:
```bash
# hooks/pre-tool-execution.sh
#!/usr/bin/env bash
DECISION=$(hayate-hook approve --tool "$1" --cmd "$2" --json)
if [[ $(echo "$DECISION" | jq -r .result.decision) != "approved" ]]; then
  echo "Blocked by Hayate Notch Companion" >&2
  exit 1
fi
```

### 4.3 Hayate Internal PTY Hook
Hayate PTY Manager (`src-tauri/src/pty/`) memantau escape sequences atau wrapper shell env `HAYATE_NOTCH_IPC=1`. Setiap command yang di-spawn dari terminal view otomatis mengabari status agent bila terminal tab berada dalam AI agent mode.

---

## 5. Styling & Visual Tokens (`DESIGN_SYSTEM.md`)

Notch HUD menggunakan 100% token Hayate tanpa hardcoded style:

```css
/* public/css/notch.css */
.notch-hud {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: var(--border-default-subtle);
  border-top: none;
  border-bottom-left-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-lg);
  color: var(--text-primary);
  box-shadow: var(--shadow-modal);
  transition: width var(--transition-normal), height var(--transition-normal);
}

.notch-pill-status-busy {
  background: var(--accent-orange-subtle);
  color: var(--accent-orange);
  border: var(--border-width-default) solid var(--accent-orange-border);
  box-shadow: var(--accent-orange-glow);
}

.notch-pill-status-approval {
  background: var(--accent-red-subtle);
  color: var(--accent-red);
  border: var(--border-width-default) solid var(--accent-red-border);
  box-shadow: var(--accent-red-glow);
}
```

---

## 6. Tahapan Implementasi Bertahap (The Ladder)

Implementasi mengikuti prinsip *ladder of abstraction* terkecil:

### Milestone 1: Minimal Notch Window & Protocol (Rung 1-3)
- [ ] Buat window kedua Tauri (`notch`) di `src-tauri/tauri.conf.json` (`transparent: true`, `decorations: false`, `alwaysOnTop: true`).
- [ ] Implementasi Mac AppKit helper (`set_notch_window_level`) via `objc2` / `cocoa` crate di macOS target.
- [ ] Tokio Unix Domain Socket listener di background task Hayate.
- [ ] View `public/notch.html` dan `public/css/notch.css` rendering status dasar (`idle`, `busy`).

### Milestone 2: Approval HUD & `hayate-hook` CLI (Rung 4-5)
- [ ] Buat binary target `src-tauri/src/bin/hayate-hook.rs`.
- [ ] Expand HUD layout ketika menerima event `tool.request_approval`.
- [ ] Button action Approve (`Enter` / shortcut) & Reject (`Esc`) mengirim event balik ke socket channel.
- [ ] Fallback TTY prompt bila daemon IPC offline.

### Milestone 3: Auto Notch Detection & Live PTY Sync (Rung 6)
- [ ] Integrasi screen safeAreaInsets runtime calculation untuk MacBook notch versus regular monitor.
- [ ] Sinkronisasi active AI session dari internal Hayate PTY manager ke Notch HUD.
- [ ] Menambahkan quick-jump: klik HUD mengarahkan fokus Hayate ke tab terminal/agent yang bersangkutan.
