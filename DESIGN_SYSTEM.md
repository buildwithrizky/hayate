# DESIGN_SYSTEM.md — Web ADE Harness Design Tokens

Dokumentasi token aktif dan aturan styling `public/style.css`.

---

## 1. Core Tokens (`:root`)

### Surface & Background
| Token | Nilai | Penggunaan |
|---|---|---|
| `--bg-app` | `#08090d` | Base background aplikasi, kanvas editor/preview |
| `--bg-panel` | `#0d0f14` | Header, sidebar, panel container, modal header |
| `--bg-subtle` | `#12151d` | Item list, kartu, tabs default, search input |
| `--bg-hover` | `#181c26` | Interactive hover state |
| `--bg-active` | `#1f2432` | Interactive active / selected state |

### Border
| Token | Nilai | Penggunaan |
|---|---|---|
| `--border-subtle` | `#1a1e29` | Pembatas layout, panel divider, frame elemen |
| `--border-strong` | `#272c3d` | Divider tegas, scrollbar thumb, hover border |
| `--border-focus` | `#3b82f6` | Input focus ring |

### Typography & Text
| Token | Nilai | Penggunaan |
|---|---|---|
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ...` | Monospace UI default (terminal, tabs, logs) |
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...` | Prose & markdown preview |
| `--text-main` | `#f3f4f6` | Teks utama, judul, value aktif |
| `--text-muted` | `#8b92a5` | Label, metadata, secondary text |
| `--text-dim` | `#545b6e` | Dim text, counter, placeholder, ikon pasif |

### Accent & Status
| Token | Nilai | Penggunaan |
|---|---|---|
| `--accent-emerald` | `#10b981` | Running, connected, success, commit |
| `--accent-emerald-glow` | `rgba(16, 185, 129, 0.4)` | Pulse dot glow, active glow |
| `--accent-danger` | `#f43f5e` | Error, offline, kill process |
| `--accent-amber` | `#f59e0b` | Warning, connecting, dirty state |
| `--accent-blue` | `#3b82f6` | Info, focus ring |

### Radius
| Token | Nilai | Penggunaan |
|---|---|---|
| `--radius-sm` | `3px` | Tag, scrollbar thumb, tab border |
| `--radius-md` | `4px` | Tombol, input, commit box |
| `--radius-full` | `9999px` | Pulse dot, status pill |

---

## 2. Layout & Styling Rules

1. **Native CSS Only**: Tidak ada CSS utility framework atau preprocessor eksternal. Gunakan CSS custom properties resmi di atas.
2. **Dense Monospace Engineering Theme**: Pertahankan layout compact, kontras tajam dark mode, dan font mono untuk komponen kontrol operasional.
3. **Warna Semantik Konsisten**: Status colors hanya untuk status operasional nyata (emerald = ready/ok, amber = pending/dirty, danger = down/err).
4. **Anti-Slop**: Tidak memakai gradient ungu AI, neon glow acak, glassmorphism blur berat, atau margin/padding spekulatif tak terpakai.
