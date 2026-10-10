# Hayate Design System — Tokens

Dokumentasi token aktif dan aturan styling Sokudo (`https://sokudo.dev`) di `public/css/index.css`.

---

## 1. Zero Hardcoded CSS Values Policy (STRICT)

**Dilarang keras melakukan hardcode value di properti CSS apapun di luar blok `:root`!**
- **Semua nilai visual & layout WAJIB memakai token `:root` (`var(--token-name)`):**
  - Colors (`hex`, `rgb`, `rgba`, `hsl`)
  - Spacing & Gap (`--space-*`, `--gap-*`)
  - Border radius (`--radius-*`)
  - Border width & style (`--border-width-*`, `--border-*`)
  - Typography (`--font-size-*`, `--font-weight-*`, `--line-height-*`, `--font-sans`, `--font-mono`)
  - Layout & dimensions (`--width-*`, `--height-*`, `--size-*`)
  - Transitions & animation timing (`--transition-*`, `--duration-*`, `--ease-*`)
  - Z-index scale (`--z-*`)
  - Box shadows & glow effects (`--shadow-*`, `--accent-*-glow`)
- Setiap penambahan komponen baru atau refactor CSS harus diverifikasi tidak mengandung literal unit (`px`, `rem`, `s`, `ms`, `#hex`, `rgba`).

---

## 2. Core Tokens (`:root`)

### Surface & Background (Pure Pitch Black Palette)
| Token | Nilai | Penggunaan |
|---|---|---|
| `--bg-app` | `#000000` | Pure pitch black: base app, main canvas, editor/terminal background |
| `--bg-panel` | `#0f0f0f` | Surface tier 1: header, sidebar, statusbar, modal container |
| `--bg-subtle` | `#141414` | Surface tier 2: tab inactive, card, item list, chat message |
| `--bg-hover` | `#1a1a1a` | Interactive hover state |
| `--bg-active` | `#222222` | Interactive active / selected state |
| `--bg-solid-white` | `#ffffff` | Absolute pure white element |
| `--glass-bg` | `rgba(15, 15, 15, 0.75)` | Glassmorphism panel backdrop |
| `--glass-bg-header` | `rgba(15, 15, 15, 0.85)` | Glassmorphism header backdrop |
| `--glass-blur` | `blur(12px)` | Backdrop filter untuk glass surface |
| `--modal-backdrop` | `rgba(0, 0, 0, 0.75)` | Modal overlay backdrop |

### Border, Glassmorphism & Backdrop
| Token | Nilai | Penggunaan |
|---|---|---|
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` | Subtle border tint |
| `--border-strong` | `rgba(255, 255, 255, 0.16)` | Strong border tint |
| `--border-focus` | `#0091ff` | Focus state border |
| `--border-width-default` | `1px` | Standard border line width |
| `--border-width-quote` | `3px` | Quote / callout line width |
| `--border-default-subtle` | `1px solid var(--border-subtle)` | Standard subtle line border |
| `--border-default-strong` | `1px solid var(--border-strong)` | Standard strong line border |
| `--border-default-transparent` | `1px solid transparent` | Transparent placeholder border |
| `--border-emerald` | `1px solid var(--accent-emerald-border)` | Git / status running border |
| `--border-blue` | `1px solid var(--accent-blue-border)` | Active / highlight border |
| `--border-blue-strong` | `1px solid var(--accent-blue-border-strong)` | Selected tag border |
| `--border-cyan` | `1px solid var(--accent-cyan-border)` | Secondary status border |
| `--border-amber` | `1px solid var(--accent-amber-border)` | Warning status border |
| `--border-quote` | `3px solid var(--accent-blue)` | Blockquote left border |
| `--backdrop-header` | `blur(12px) saturate(1.4)` | Header backdrop filter |
| `--backdrop-modal` | `blur(10px) saturate(1.3)` | Modal backdrop filter |

### Accent & Glow (Electric Blue / Emerald / Danger / Amber)
| Token | Nilai | Penggunaan |
|---|---|---|
| `--accent-blue` | `#0091ff` | Electric blue primary |
| `--accent-blue-hover` | `#1a9eff` | Electric blue hover state |
| `--accent-blue-subtle` | `rgba(0, 145, 255, 0.06)` | Electric blue subtle surface |
| `--accent-blue-muted` | `rgba(0, 145, 255, 0.15)` | Electric blue tag background |
| `--accent-blue-badge` | `rgba(0, 145, 255, 0.16)` | Badge surface |
| `--accent-blue-select` | `rgba(0, 145, 255, 0.3)` | Selection highlight |
| `--accent-blue-border` | `rgba(0, 145, 255, 0.32)` | Subtle blue outline |
| `--accent-blue-border-strong` | `rgba(0, 145, 255, 0.35)` | Accent border |
| `--accent-blue-glow` | `0 0 16px rgba(0, 145, 255, 0.35)` | Brand glow |
| `--accent-blue-glow-sm` | `0 0 8px rgba(0, 145, 255, 0.4)` | Focus glow |
| `--accent-blue-glow-drag` | `0 0 8px rgba(0, 145, 255, 0.45)` | Resize dragging glow |
| `--accent-blue-glow-btn` | `0 0 12px rgba(0, 145, 255, 0.25)` | Primary button glow |
| `--accent-logo-glow` | `drop-shadow(0 0 6px rgba(29, 109, 255, 0.45))` | Logo mark glow |
| `--accent-cyan` | `#00d2ff` | Cyan highlight |
| `--accent-emerald` | `#10b981` | Running, connected, commit |
| `--accent-emerald-glow` | `rgba(16, 185, 129, 0.4)` | Pulse dot glow |
| `--accent-danger` | `#f43f5e` | Error, offline, kill |
| `--accent-amber` | `#f59e0b` | Warning, connecting, dirty |

### Typography Scale
| Token | Nilai | Penggunaan |
|---|---|---|
| `--font-sans` | `'Figtree', ...` | Sans font stack UI Sokudo |
| `--font-mono` | `'JetBrains Mono', ...` | Monospace code/terminal font stack |
| `--text-main` | `#f5f5f7` | Teks utama |
| `--text-muted` | `#9e9ea7` | Label, metadata |
| `--text-dim` | `#5c5c66` | Dim text, placeholder |
| `--font-size-2xs` | `9px` | Micro badge, chevron compact |
| `--font-size-xs` | `10px` | App badge, status bar divider, metadata |
| `--font-size-sm` | `11px` | Compact button, tab text, input text |
| `--font-size-sm-plus` | `11.5px` | File tree label |
| `--font-size-base` | `12px` | Regular UI text, commit item message |
| `--font-size-md` | `13px` | Base editor text, line numbers, body |
| `--font-size-md-code` | `0.92em` | Inline code markdown |
| `--font-size-h3` | `1.15em` | Heading 3 preview |
| `--font-size-h2` | `1.35em` | Heading 2 preview |
| `--font-size-h1` | `1.7em` | Heading 1 preview |
| `--font-weight-regular` | `400` | Regular body |
| `--font-weight-medium` | `500` | Active tab, primary button, tree directory |
| `--font-weight-semibold` | `600` | Sidebar header, markdown headings |
| `--font-weight-bold` | `700` | App title, tags, status badges |
| `--line-height-reset` | `1` | Icon, dot, badge inline |
| `--line-height-tight` | `1.1` | Compact tag |
| `--line-height-heading` | `1.25` | Preview headings |
| `--line-height-code` | `1.5` | Code editor & terminal lines |
| `--line-height-prose` | `1.6` | Prose / markdown content |

### Spacing & Gap Scale
| Token | Nilai | Penggunaan |
|---|---|---|
| `--space-3xs` | `1px` | Micro spacing |
| `--space-2xs` | `2px` | Tight inline pad |
| `--space-xs` | `4px` | Compact gap/pad |
| `--space-sm` | `6px` | Button internal pad |
| `--space-md` | `8px` | Card elements pad |
| `--space-lg` | `10px` | Section gap |
| `--space-xl` | `12px` | Container padding |
| `--space-2xl` | `14px` | Panel pad |
| `--space-3xl` | `24px` | Wide spacing |
| `--space-4xl` | `32px` | Extra wide spacing |
| `--gap-2xs` | `2px` | Inline badges |
| `--gap-xs` | `4px` | Icon + text |
| `--gap-sm` | `6px` | Button internals |
| `--gap-md` | `8px` | Groups |
| `--gap-lg` | `10px` | Header sections |

### Radii Scale (Sokudo Shapes)
| Token | Nilai | Penggunaan |
|---|---|---|
| `--radius-xs` | `2px` | Micro-elements, inline badges |
| `--radius-sm` | `4px` | Tag, badge kecil, scrollbar thumb |
| `--radius-md` | `6px` | Dropdown menu, code block pre |
| `--radius-lg` | `8px` | Container subtle, frame sedang |
| `--radius-input` | `8px` | Form input, prompt box |
| `--radius-card` | `14px` | Modal, card container |
| `--radius-pill` | `9999px` | Button pill, status pill |
| `--radius-full` | `50%` | Circle avatar/indicator |

### Dimensions & Layout Hierarchy
| Token | Nilai | Penggunaan |
|---|---|---|
| `--size-handle-line` | `1px` | Resize divider stroke |
| `--size-scrollbar` | `6px` | Scrollbar bar thickness |
| `--size-tab-dot` | `6px` | Tab dirty indicator dot |
| `--size-indicator-dot` | `8px` | Pulse dot indicator |
| `--size-handle-grab` | `9px` | Resize handle hit target |
| `--size-handle-offset` | `-4px` | Resize handle centering |
| `--size-icon-xs` | `14px` | Micro icon (chevron, file icon) |
| `--size-icon-sm` | `16px` | Small icon (tab close, badge) |
| `--size-icon-md` | `18px` | Medium icon (action buttons) |
| `--size-avatar-xs` | `20px` | Logo mark container |
| `--size-diff-sign` | `22px` | Diff sign gutter width |
| `--size-badge-min` | `22px` | Tab icon min width |
| `--size-tab-more-h` | `24px` | Tab more button height |
| `--size-statusbar-h` | `24px` | Statusbar height |
| `--size-btn-icon` | `26px` | Icon button size |
| `--size-tab-h` | `28px` | Tab pill height |
| `--size-panel-header-h` | `34px` | Panel sub-header height |
| `--size-bar-h` | `36px` | View toolbar height |
| `--size-sidebar-header-h` | `38px` | Left sidebar header height |
| `--size-tabs-bar-h` | `38px` | Main tabs bar height |
| `--size-rs-nav-h` | `38px` | Right sidebar nav height |
| `--size-modal-header-h` | `40px` | Modal header height |
| `--size-app-header-h` | `42px` | Top app header height |
| `--size-diff-gutter-w` | `44px` | Diff line number gutter width |
| `--size-commit-input-min-h` | `48px` | Commit textarea min height |
| `--size-line-numbers-w` | `48px` | Editor line number gutter width |
| `--width-sidebar-left` | `260px` | Left sidebar default width |
| `--width-sidebar-left-min` | `180px` | Left sidebar min width |
| `--width-sidebar-left-max` | `600px` | Left sidebar max width |
| `--width-sidebar-right` | `320px` | Right sidebar default width |
| `--width-sidebar-right-min` | `240px` | Right sidebar min width |
| `--width-sidebar-right-max` | `800px` | Right sidebar max width |
| `--width-modal` | `780px` | Modal window width |
| `--height-modal` | `560px` | Modal window height |
| `--width-dropdown-min` | `170px` | Dropdown menu min width |
| `--width-tab-max` | `200px` | Tab pill max width |
| `--width-subtext-max` | `140px` | Subtext ellipsis width |
| `--width-preview-thumb-max`| `220px` | Terminal preview image max width |
| `--height-preview-thumb-max`| `160px` | Terminal preview image max height |
| `--height-commits-list-max` | `220px` | Commit log list max height |

### Transitions & Animation Timings
| Token | Nilai | Penggunaan |
|---|---|---|
| `--ease-default` | `ease` | Standard easing curve |
| `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` | Snappy elastic spring |
| `--duration-fast` | `0.1s` | Quick hover/color fade |
| `--duration-normal` | `0.12s` | Standard UI state transition |
| `--duration-medium` | `0.14s` | Button interactive response |
| `--duration-moderate` | `0.15s` | Sidebar panel slide |
| `--duration-slow` | `0.18s` | Right sidebar drawer toggle |
| `--transition-color-fast` | `color 0.1s ease` | Fast text hover |
| `--transition-bg-fast` | `background 0.1s ease` | Fast surface hover |
| `--transition-bg-color-fast` | `background 0.1s ease, color 0.1s ease` | Fast interactive item |
| `--transition-color-normal` | `color 0.15s ease` | Standard link/text transition |
| `--transition-bg-normal` | `background 0.12s ease` | Standard surface transition |
| `--transition-bg-color-normal`| `background 0.15s ease, color 0.15s ease` | Tab item transition |
| `--transition-bg-border` | `background 0.12s ease, border-color 0.12s ease`| Bordered item hover |
| `--transition-opacity` | `opacity 0.12s ease` | Visibility fade |
| `--transition-transform` | `transform 0.15s ease` | Drawer slide |
| `--transition-all-normal` | `all 0.12s ease` | Multi-property shift |
| `--transition-btn` | `all 0.14s cubic-bezier(...)` | Pill button interactive feedback |
| `--transition-handle` | `background-color 0.15s ease, box-shadow 0.15s ease` | Resize handle hover |
| `--transition-sidebar-left` | `width 0.15s ease, ...` | Left sidebar collapse/expand |
| `--transition-sidebar-right`| `width 0.18s cubic-bezier(...), ...` | Right sidebar drawer toggle |

### Z-Index Hierarchy Scale
| Token | Nilai | Penggunaan |
|---|---|---|
| `--z-textarea` | `2` | Code textarea overlay |
| `--z-handle-grab` | `2` | Resize handle hit target layer |
| `--z-sidebar-right` | `5` | Right sidebar panel |
| `--z-handle` | `10` | Draggable divider lines |
| `--z-statusbar` | `10` | Bottom status bar |
| `--z-header` | `20` | Top floating header |
| `--z-tabs-bar` | `100` | Main tabs bar container |
| `--z-modal-backdrop` | `100` | Modal background overlay |
| `--z-modal-window` | `101` | Modal container frame |
| `--z-dropdown-wrapper` | `105` | Tab dropdown button wrapper |
| `--z-dropdown-menu` | `9999` | Context menus and dropdowns |
| `--z-popover` | `99999` | Image/tool popovers over everything |

### Box Shadows
| Token | Nilai | Penggunaan |
|---|---|---|
| `--shadow-xs` | `0 1px 3px rgba(0, 0, 0, 0.4)` | Subtitle badge / tiny surface |
| `--shadow-sm` | `0 1px 4px rgba(0, 0, 0, 0.4)` | Small elevation |
| `--shadow-header` | `0 4px 20px rgba(0, 0, 0, 0.35)` | Header shadow |
| `--shadow-popover` | `0 8px 24px rgba(0, 0, 0, 0.6)` | Status / image popover |
| `--shadow-dropdown` | `0 10px 30px rgba(0, 0, 0, 0.8)` | Dropdown shadow |
| `--shadow-modal` | `0 24px 64px rgba(0, 0, 0, 0.85), 0 0 0 1px ...` | Modal elevation frame |
| `--shadow-focus-blue` | `0 0 0 1px var(--accent-blue)` | Form focus ring |
| `--shadow-focus-glow` | `0 0 0 1px var(--accent-blue-glow)` | Commit input focus ring |
| `--shadow-glow-xs` | `0 0 5px var(--accent-emerald-glow)` | Compact status dot glow |
| `--shadow-glow-sm` | `0 0 8px var(--accent-emerald-glow)` | Pulse status dot glow |

### Opacity Tokens
| Token | Nilai | Penggunaan |
|---|---|---|
| `--opacity-0` | `0` | Elemen invisible / hidden state |
| `--opacity-disabled` | `0.3` | State disabled / pulse keyframe minimum |
| `--opacity-low` | `0.45` | Subtle hint / low emphasis |
| `--opacity-medium` | `0.6` | Medium emphasis / secondary icon |
| `--opacity-high` | `0.85` | High emphasis icon / primary icon |
| `--opacity-full` | `1` | Fully opaque element |

### Dimensions, Percentages & Coordinates
| Token | Nilai | Penggunaan |
|---|---|---|
| `--coord-0` | `0` | Coordinate zero (`top`, `bottom`, `left`, `right`, `inset`) |
| `--coord-auto` | `auto` | Coordinate / margin auto offset |
| `--size-0` | `0` | Zero width/height/padding/margin |
| `--full-pct` | `100%` | Full percentage dimension (100% width/height) |
| `--half-pct` | `50%` | Half percentage dimension (50%) |
| `--pct-80` | `80%` | Modal title max-width limit |
| `--vw-full` | `100vw` | Full viewport width |
| `--vh-full` | `100vh` | Full viewport height |
| `--vw-modal-max` | `90vw` | Modal viewport width upper bound |
| `--vh-modal-max` | `85vh` | Modal viewport height upper bound |
| `--max-w-modal` | `90vw` | Max modal width alias |
| `--max-h-modal` | `85vh` | Max modal height alias |
| `--space-neg-2xs` | `calc(-1 * var(--space-2xs))` | Negative offset dirty indicator |

### Display Keywords
| Token | Nilai | Penggunaan |
|---|---|---|
| `--display-none` | `none` | Menyembunyikan elemen (termasuk modal/dropdown tertutup) |
| `--display-flex` | `flex` | Flexbox layout container |
| `--display-inline-flex`| `inline-flex` | Inline flexbox element |
| `--display-block` | `block` | Block-level element |
| `--display-inline-block` | `inline-block` | Inline block-level element |
| `--display-grid` | `grid` | Grid layout container |
| `--display-table-row` | `table-row` | Diff table row display |

### Position Keywords
| Token | Nilai | Penggunaan |
|---|---|---|
| `--pos-relative` | `relative` | Position relative |
| `--pos-absolute` | `absolute` | Position absolute |
| `--pos-fixed` | `fixed` | Position fixed |
| `--pos-sticky` | `sticky` | Position sticky |

### Flex Layout Keywords & Values
| Token | Nilai | Penggunaan |
|---|---|---|
| `--flex-1` | `1` | Flex item fill available space |
| `--flex-auto` | `0 1 auto` | Tab scroll flex basis |
| `--flex-fill` | `1 1 0%` | Terminal container flex basis |
| `--flex-none` | `none` | Flex item non-growable non-shrinkable |
| `--flex-col` | `column` | Flex direction vertical |
| `--flex-row` | `row` | Flex direction horizontal |
| `--flex-shrink-0` | `0` | Mencegah elemen menyusut |
| `--flex-grow-1` | `1` | Elemen mengembang mengisi sisa space |
| `--flex-nowrap` | `nowrap` | Elemen flex tidak wrap |
| `--flex-wrap` | `wrap` | Elemen flex wrap jika ruang habis |

### Alignment & Justification Keywords
| Token | Nilai | Penggunaan |
|---|---|---|
| `--align-center` | `center` | Align items center |
| `--align-start` | `flex-start` | Align items flex start |
| `--align-end` | `flex-end` | Align items flex end |
| `--justify-center` | `center` | Justify content center |
| `--justify-between`| `space-between` | Justify content space between |
| `--justify-start` | `flex-start` | Justify content flex start |
| `--justify-end` | `flex-end` | Justify content flex end |

### Cursor & Interaction Keywords
| Token | Nilai | Penggunaan |
|---|---|---|
| `--cursor-pointer` | `pointer` | Interactive clickable element |
| `--cursor-default` | `default` | Standard cursor |
| `--cursor-col-resize` | `col-resize` | Splitter / panel resize handle |
| `--pointer-events-none` | `none` | Elemen tembus klik / event disabled |
| `--pointer-events-auto` | `auto` | Reset pointer events |
| `--user-select-none` | `none` | Mencegah seleksi teks pada UI chrome |

### Overflow & Whitespace Keywords
| Token | Nilai | Penggunaan |
|---|---|---|
| `--overflow-hidden` | `hidden` | Potong konten yang meluap |
| `--overflow-auto` | `auto` | Tampilkan scrollbar otomatis |
| `--overflow-visible`| `visible` | Konten meluap tetap terlihat |
| `--whitespace-nowrap` | `nowrap` | Teks satu baris tanpa wrap |
| `--whitespace-pre` | `pre` | Pertahankan spasi & newline kode |
| `--whitespace-pre-wrap` | `pre-wrap` | Pertahankan newline dan wrap otomatis |

### Typography Transforms, Tracking & Text Alignment
| Token | Nilai | Penggunaan |
|---|---|---|
| `--tracking-tight` | `-0.02em` | Tight letter spacing |
| `--tracking-normal` | `0.02em` | Snug letter spacing |
| `--tracking-wide` | `0.05em` | Wide letter spacing untuk sub-header |
| `--tracking-wider` | `0.08em` | Widest letter spacing untuk section header |
| `--text-transform-uppercase` | `uppercase` | Kapitalisasi judul & label |
| `--text-decoration-underline` | `underline` | Underline teks tautan |
| `--text-decoration-line-through`| `line-through` | Strikethrough git delete |
| `--text-align-center` | `center` | Teks rata tengah |
| `--text-align-left` | `left` | Teks rata kiri |
| `--text-align-right` | `right` | Teks rata kanan |
| `--valign-top` | `top` | Vertical align top untuk tabel |
| `--text-overflow-ellipsis` | `ellipsis` | Pemotongan teks overflow |
| `--word-break-all` | `break-all` | Word wrap paksa |

### Transforms, Filters & Utilities
| Token | Nilai | Penggunaan |
|---|---|---|
| `--transform-rotate-neg90` | `rotate(-90deg)` | Rotasi ikon chevron tertutup |
| `--filter-brightness-hover` | `brightness(1.1)` | Hover filter brightness |
| `--box-sizing-border` | `border-box` | Box sizing border box |
| `--border-collapse` | `collapse` | Table border collapse |
| `--table-layout-auto` | `auto` | Table layout auto |
| `--object-fit-contain` | `contain` | Image fit contain |
| `--resize-none` | `none` | Non-resizable textarea |
| `--resize-vertical` | `vertical` | Vertically resizable commit textarea |
| `--outline-none` | `none` | Remove outline focus |
| `--border-none` | `none` | Border none reset |
| `--bg-none` | `none` | Background none reset |
| `--bg-transparent` | `transparent` | Background transparent |
| `--text-transparent` | `transparent` | Text color transparent |
| `--tab-size-code` | `2` | Indentation tab size |
| `--transition-none` | `none` | Disable transitions saat resizing |
| `--content-empty` | `""` | Empty pseudo element content |


---

## 3. Layout & Styling Rules

1. **Zero Hardcoded Values**: Seluruh rule CSS di luar `:root` tidak boleh memakai unit mentah (`px`, `rem`, `s`, `ms`, `#hex`, `rgba`). Gunakan variabel `:root`.
2. **Sokudo Aesthetic**: Pure pitch black `#000000` dengan kontras kaca subtle (`rgba(255, 255, 255, 0.08)` dan `0.16`). Tidak ada gray/slate murahan.
3. **Electric Blue Signature**: Aksen utama `#0091ff` dengan transisi ke hover `#1a9eff` dan subtle cyan/blue glow.
4. **Pill Buttons & Rounded Corners**: Tombol interaktif menggunakan pill (`var(--radius-pill)`), modal/kartu memakai `var(--radius-card)`, input memakai `var(--radius-input)`.
5. **Figtree + Clean Mono**: UI controls berkarakter modern dan bersih lewat Figtree, sedangkan representasi kode/terminal tetap presisi dengan monospace.
6. **No Broken UI**: Semua selector kelas, struktur grid/flex, dan fungsionalitas UI ADE Harness tetap 100% kompatibel dan utuh.
