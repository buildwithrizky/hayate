# Agent Guidelines - ade-harness

## Technical Rules

### Frontend (Native ES Modules)
- Gunakan native ES Modules (`<script type="module">`, `import`/`export`).
- Tanpa bundler (no Vite, Webpack, Rollup).
- Pisahkan state dan event listener per domain (`terminal`, `agent`, `workspace`, `api`).
- Dilarang membuat monolith file baru (no 3000-line files). Fitur baru wajib masuk modul terpisah di `public/js/`.

### Backend (Rust / Axum)
- Pisahkan domain logic dari routing Axum: handlers hanya parse request/response, core logic di modul domain masing-masing.
- **Zero Panic**: banned `unwrap()` dan `expect()` pada request execution path. Gunakan `?` atau pattern matching.
- **Native Error Handling**: gunakan `std::fmt::Display` dan `std::error::Error` standar tanpa crate error fiktif (`thiserror` tidak terpasang di dependencies).
- Map error domain ke HTTP status/response via Axum `IntoResponse`.

### Anti-Spaghetti Code
- **Guard Clauses & Early Returns**: wajib gunakan guard clauses / early returns. Hindari nested `if` lebih dari 3 level.
- **Single Responsibility**: batas panjang fungsi maksimal 40–50 baris. Pecah logic jika melebihi batas ini.
- **Modularisasi Terisolasi**: larangan god-object dan god-function. Pisahkan domain logic ke fungsi/modul independen dengan tanggung jawab tunggal.
