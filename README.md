# 🚀 RAMA Dashboard — BSI UII Hackathon POC / MVP
**(Request, Align, Monitor, Approve)**

> **Menjembatani "The Missing Link & Blind Approvals" pada Deployment Berjenjang di Badan Sistem Informasi (BSI) Universitas Islam Indonesia (UII).**

---

## 🎯 Latar Belakang Masalah
Transisi kebijakan deployment berjenjang (**Developer ➔ PM ➔ Tim Core ➔ Interoperability**) di BSI UII sering menghadapi *bottleneck* karena:
1. **Komunikasi Manual di Grup WhatsApp**: Status rilis tercecer di ruang obrolan sehingga manajemen tidak mengetahui posisi rilis secara *real-time* (*Black Box*).
2. **Tidak Ada Audit Trail Terpusat**: Sulit melacak siapa yang menyetujui atau menolak sebuah perubahan kode dan apa alasannya.
3. **Risiko Tinggi "Blind Approval"**: Penanggung jawab non-teknis (seperti PM/Manajer) dipaksa menyetujui ratusan baris `git diff` mentah dari GitLab yang sulit dipahami.

---

## 💡 Arsitektur Solusi RAMA
1. **Role-Based State Machine (`src/lib/state-machine.ts`)**:
   Alur transisi status ketat: `Pending_PM` ➔ `Pending_Core` ➔ `Pending_Interop` ➔ `Approved` (serta `Rejected`). Setiap role (`DEVELOPER`, `PM`, `CORE`, `INTEROP`) hanya dapat mengeksekusi aksi pada gate wewenangnya.
2. **✨ AI Code Translator — The Secret Sauce (`src/lib/ai-translator.ts`)**:
   Mengintegrasikan **Google Gemini API (`gemini-2.5-flash`)** + **RAMA Smart Hybrid Diff Engine** di sisi backend untuk mencegat `git diff` mentah dan otomatis meringkasnya menjadi **3 Poin Bahasa Bisnis/Manusia**:
   - **Poin 1**: Fitur & Dampak Bisnis (Bahasa Manusia)
   - **Poin 2**: Bug Fix & Penyempurnaan Teknis Inti
   - **Poin 3**: Analisis Risiko, Mitigasi & Estimasi Downtime
3. **One-Click Action & Mobile-Responsive Approval View (`src/app/page.tsx`)**:
   Menyediakan **Kanban Pipeline Tracker** untuk pemantauan visual dan **Simulator Tampilan Smartphone Eksekutif** agar PM/Core dapat melakukan persetujuan dalam **1 Klik** tanpa perlu membaca kode mentah.
4. **Relational Database SQLite (`db/schema.sql` & `src/lib/db.ts`)**:
   Menyimpan tabel relasional `Users`, `MergeRequests`, dan `ApprovalLogs` secara persisten di `db/rama.db`.

---

## 🛠️ Cara Menjalankan Aplikasi

Pastikan menggunakan **Node.js v22+** (sudah terpasang di NVM `v22.23.4`):

```bash
# Gunakan Node 22
export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"

# Install dependencies (jika belum)
npm install

# Jalankan development server
npm run dev
```

Buka **`http://localhost:3000`** di browser.

*(Opsional)* Untuk mengaktifkan panggilan langsung ke **Google Gemini API (`gemini-2.5-flash`)**, tambahkan `GEMINI_API_KEY=AIzaSy...` pada file `.env.local` atau masukkan langsung lewat tombol **"Gemini Hybrid AI"** di pojok kanan atas dashboard.

---

## 🎬 Skenario Demo di Hadapan Juri (3 Menit)
1. **Tunjukkan Masalah ("Blind Approval")**: Buka tab **"2. Mobile-Responsive Approval View"**, perlihatkan betapa rumitnya `git diff` mentah di sebelah kanan dibandingkan dengan **✨ AI Summary Card** di layar HP PM di sebelah kiri.
2. **Suntikkan Git Diff Kompleks**: Klik tombol **"⚡ Suntikkan Git Diff (Simulasi Webhook)"** di kanan atas, pilih preset *Integrasi QRIS Dinamis & Auto-Rekonsiliasi SPP*, lalu klik **Terjemahkan dengan AI & Kirim ke Antrean PM**.
3. **Demonstrasikan Role-Based State Machine & 1-Click Approval**:
   - Dengan fitur **Auto-Switch Role** aktif, klik **1-Click Approve** sebagai **PM** (`Pending_PM` ➔ `Pending_Core`).
   - Klik **1-Click Approve** sebagai **Tim Core** (`Pending_Core` ➔ `Pending_Interop`).
   - Klik **1-Click Approve** sebagai **Tim Interoperability** (`Pending_Interop` ➔ `Approved / Siap Rilis`).
4. **Tunjukkan Audit Trail SQLite**: Buka tab **"3. Audit Trail & Tabel Relasional SQLite"** untuk memperlihatkan seluruh riwayat persetujuan yang tercatat secara *real-time* di tabel `ApprovalLogs`.
