# Agent Guidelines - ade-harness

## Wajib Baca & Patuhi (Mandatory References)
Sebelum menulis kode atau membuat perubahan arsitektur/UI, semua agent wajib membaca dan mematuhi panduan berikut:
- [`ARCHITECTURE.md`](ARCHITECTURE.md): Aturan arsitektur sistem, pembagian modul, alur data, dan kontrak integrasi.
- [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md): Standar visual, token CSS, komponen UI, konsistensi antarmuka.

Dilarang membuat perubahan arsitektur atau antarmuka tanpa menyelaraskan ke dua dokumen di atas.

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

