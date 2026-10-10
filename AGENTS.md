# Agent Guidelines - Hayate

## Wajib Baca & Patuhi (Mandatory References)
Sebelum menulis kode atau membuat perubahan arsitektur/UI, semua agent wajib membaca dan mematuhi panduan berikut:
- [`ARCHITECTURE.md`](ARCHITECTURE.md): Aturan arsitektur sistem, pembagian modul, alur data, dan kontrak integrasi.
- [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md): Standar visual, token CSS, komponen UI, konsistensi antarmuka.

Dilarang membuat perubahan arsitektur atau antarmuka tanpa menyelaraskan ke dua dokumen di atas.

## Technical Rules

### File Size Hard Limits
- **Maksimal 400–500 baris per file** untuk semua bahasa (CSS, JS, Rust).
- File mendekati/melebihi 500 baris WAJIB dipecah ke submodul domain kohesif.

### CSS Organization
- Semua styling berada di `public/css/` dipisah per concern (`tokens.css`, `base.css`, `layout.css`, `tabs.css`, `workspace.css`, `views.css`, `explorer.css`, `git.css`, `modals.css`).
- Entry point: `public/css/index.css` via `@import`.
- Monolithic single-file CSS dilarang keras.
- **Zero Hardcoded CSS Values (STRICT)**: Dilarang keras hardcode literal value di CSS (`px`, `rem`, `s`, `ms`, `#hex`, `rgba`) di luar blok `:root`. Semua property wajib konsisten menggunakan token `:root` (`var(--token)`).

### Frontend JS Organization
- Native ES Modules di `public/js/` dengan `index.js` sebagai bootstrap entry point (`<script type="module">`).
- Tanpa bundler (no Vite, Webpack, Rollup).
- Subdomain wajib di folder/modul tersendiri (`public/js/views/`, `public/js/git/`, `workspace.js`, `tabs.js`, `state.js`, `api.js`, `layout.js`, `explorer.js`).
- Monolith file dilarang keras.

### Rust Backend Commands Organization
- Tauri commands DILARANG ditumpuk di satu file monolith.
- Semua command handler wajib dimodularisasi per domain di `src-tauri/src/commands/<domain>.rs` (contoh: `workspace.rs`, `fs.rs`, `git.rs`, `system.rs`).
- Re-export seluruh handler via `src-tauri/src/commands/mod.rs`.
- Pisahkan domain logic dari command handler: handler hanya parse/invoke, core logic di modul domain (`workspace.rs`, `git_ops.rs`, `pty_mgr.rs`).
- **Zero Panic**: banned `unwrap()` dan `expect()` pada runtime path. Gunakan `?` atau pattern matching.
- **Native Error Handling**: gunakan `std::fmt::Display` dan `std::error::Error` standar tanpa crate error fiktif (`thiserror` tidak terpasang di dependencies).

### Anti-Spaghetti Code
- **Guard Clauses & Early Returns**: wajib gunakan guard clauses / early returns. Hindari nested `if` lebih dari 3 level.
- **Single Responsibility**: batas panjang fungsi maksimal 40–50 baris. Pecah logic jika melebihi batas ini.
- **Modularisasi Terisolasi**: larangan god-object dan god-function. Pisahkan domain logic ke fungsi/modul independen dengan tanggung jawab tunggal.

## Prinsip Wajib: DRY & SOLID

### DRY (Don't Repeat Yourself)
- **Larangan copy-paste logic**: duplikasi kode dilarang.
- **Single Source of Truth (SSOT)**: satu sumber pasti untuk state, tipe data, konfigurasi, dan konstanta.
- **Ekstraksi reusable util**: ekstrak helper/util terpisah jika pola kode muncul $\ge$ 2 kali.

### SOLID Principles
- **S - Single Responsibility**: 1 modul/fungsi/struct hanya pegang 1 tanggung jawab spesifik. Batas fungsi 40–50 baris.
- **O - Open/Closed**: Modul terbuka untuk ekstensi (traits/plugins/handlers), tertutup untuk modifikasi destruktif pada core logic.
- **L - Liskov Substitution**: Kontrak/trait konsisten. Tidak boleh ada implementasi yang merusak behavior dasar interface.
- **I - Interface Segregation**: Trait & interface ramping. Caller tidak boleh dipaksa bergantung pada method yang tidak dipakainya.
- **D - Dependency Inversion**: Pisahkan dependensi konkrit lewat traits/abstraksi. Domain logic tidak boleh direct-couple ke IO/adapter mentah.

