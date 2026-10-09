# Hayate Design System — Tokens

Dokumentasi token aktif dan aturan styling Sokudo (`https://sokudo.dev`) di `public/style.css`.

---

## 1. Core Tokens (`:root`)

### Surface & Background (Pure Pitch Black Palette)
| Token | Nilai | Penggunaan |
|---|---|---|
| `--bg-app` | `#000000` | Pure pitch black: base app, main canvas, editor/terminal background |
| `--bg-panel` | `#0f0f0f` | Surface tier 1: header, sidebar, statusbar, modal container |
| `--bg-subtle` | `#141414` | Surface tier 2: tab inactive, card, item list, chat message |
| `--bg-hover` | `#1a1a1a` | Interactive hover state |
| `--bg-active` | `#222222` | Interactive active / selected state |

### Border & Glassmorphism
| Token | Nilai | Penggunaan |
|---|---|---|
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` | Pembatas layout, panel divider, subtle glass edges |
| `--border-strong` | `rgba(255, 255, 255, 0.16)` | Card frame, hover border, modal window border, input frame |
| `--border-focus` | `#0091ff` | Electric blue focus ring |
| `--glass-bg` | `rgba(15, 15, 15, 0.75)` | Glassmorphism panel backdrop |
| `--glass-blur` | `blur(12px)` | Backdrop filter untuk glass surface |

### Accent & Glow (Electric Blue / Subtle Cyan)
| Token | Nilai | Penggunaan |
|---|---|---|
| `--accent-blue` | `#0091ff` | Electric blue: primary button, active highlight, focused borders |
| `--accent-blue-hover` | `#1a9eff` | Electric blue hover state |
| `--accent-blue-glow` | `0 0 16px rgba(0, 145, 255, 0.35)` | Subtle glow highlight untuk brand accents & buttons |
| `--accent-cyan` | `#00d2ff` | Cyan highlight & secondary status glow |
| `--accent-emerald` | `#10b981` | Running, connected, success, commit |
| `--accent-emerald-glow` | `rgba(16, 185, 129, 0.4)` | Pulse dot glow |
| `--accent-danger` | `#f43f5e` | Error, offline, kill process |
| `--accent-amber` | `#f59e0b` | Warning, connecting, dirty state |

### Typography
| Token | Nilai | Penggunaan |
|---|---|---|
| `--font-sans` | `'Figtree', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | Clean sans default UI Sokudo (headings, buttons, UI controls) |
| `--font-mono` | `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | Clean monospace default (code editor, terminal, logs, file paths) |
| `--text-main` | `#f5f5f7` | Teks utama, judul, value aktif |
| `--text-muted` | `#9e9ea7` | Label, metadata, secondary text |
| `--text-dim` | `#5c5c66` | Dim text, counter, placeholder, ikon pasif |

### Radii (Sokudo Shapes)
| Token | Nilai | Penggunaan |
|---|---|---|
| `--radius-xs` | `2px` | Micro-elements, inline badges kecil |
| `--radius-sm` | `4px` | Tag, badge kecil, scrollbar thumb, item buttons |
| `--radius-md` | `6px` | Dropdown menu, code block pre, tab selector |
| `--radius-lg` | `8px` | Container subtle, frame sedang |
| `--radius-input` | `8px` | Form input, prompt box, search box (8px - 10px) |
| `--radius-card` | `14px` | Modal, card container, preview frame (14px - 16px) |
| `--radius-pill` | `9999px` | Button pill, status pill, tabs pill Sokudo |

---

## 2. Layout & Styling Rules

1. **Sokudo Aesthetic**: Pure pitch black `#000000` dengan kontras kaca subtle (`rgba(255, 255, 255, 0.08)` dan `0.16`). Tidak ada gray/slate murahan.
2. **Electric Blue Signature**: Aksen utama `#0091ff` dengan transisi ke hover `#1a9eff` dan subtle cyan/blue glow.
3. **Pill Buttons & Rounded Corners**: Tombol interaktif menggunakan pill (`9999px`), modal/kartu memakai `14px` - `16px`, input memakai `8px` - `10px`.
4. **Figtree + Clean Mono**: UI controls berkarakter modern dan bersih lewat Figtree, sedangkan representasi kode/terminal tetap presisi dengan monospace.
5. **No Broken UI**: Semua selector kelas, struktur grid/flex, dan fungsionalitas UI ADE Harness tetap 100% kompatibel dan utuh.
