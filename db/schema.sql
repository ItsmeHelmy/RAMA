-- ============================================================================
-- RAMA (Request, Align, Monitor, Approve) — Skema Simulasi POC (P1, P2, P4)
-- Badan Sistem Informasi (BSI) · Universitas Islam Indonesia (UII)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('DEVELOPER','PM','CORE','INTEROP')),
  title TEXT NOT NULL,
  avatar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT NOT NULL UNIQUE,              -- contoh: REL-2026-041
  judul TEXT NOT NULL,
  modul TEXT NOT NULL,
  repo TEXT NOT NULL,
  feature_branch TEXT NOT NULL,           -- branch asal layer 1 (feature/*)
  author_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (
    status IN ('Pending_PM','Pending_Core','Pending_Interop','Approved','Perlu_Revisi')
  ),
  risk_level TEXT NOT NULL CHECK (
    risk_level IN ('LOW','MEDIUM','HIGH') -- diisi rule engine deterministik (P4), bukan AI
  ),
  triggered_rules_json TEXT NOT NULL,
  changed_files_json TEXT NOT NULL,
  git_diff_masked TEXT NOT NULL,          -- rahasia disamarkan (R4) sebelum disimpan
  ai_summary_json TEXT,
  ai_source TEXT NOT NULL CHECK (ai_source IN ('gemini','contoh','tidak_tersedia')),
  rollback_plan TEXT NOT NULL DEFAULT '', -- diisi developer saat membuat request
  iterasi INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_mrs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL REFERENCES release_requests(id) ON DELETE CASCADE,
  iterasi INTEGER NOT NULL,
  layer INTEGER NOT NULL CHECK (layer BETWEEN 1 AND 4),
  repo TEXT NOT NULL,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  mr_number INTEGER NOT NULL,             -- ditampilkan sebagai !841
  status TEXT NOT NULL CHECK (
    status IN ('BELUM_DIMULAI','MENUNGGU','DISETUJUI','DITOLAK')
  ),
  opened_at TEXT,
  decided_at TEXT,
  decided_by INTEGER REFERENCES users(id),
  UNIQUE (release_id, iterasi, layer)
);

CREATE TABLE IF NOT EXISTS approval_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL REFERENCES release_requests(id) ON DELETE CASCADE,
  layer INTEGER,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role_at_action TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('SUBMIT','APPROVE','REJECT','RESUBMIT','BLOCKED')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,                -- termasuk DITOLAK_SISTEM untuk percobaan ilegal
  comment TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'simulasi',
  created_at TEXT NOT NULL
);
