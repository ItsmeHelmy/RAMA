-- ============================================================================
-- RAMA (Request, Align, Monitor, Approve) Database Schema (SQLite / PostgreSQL)
-- Badan Sistem Informasi (BSI) - Universitas Islam Indonesia (UII)
-- ============================================================================

CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('DEVELOPER', 'PM', 'CORE', 'INTEROP')),
    title TEXT NOT NULL,
    department TEXT NOT NULL,
    avatar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS MergeRequests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    source_branch TEXT NOT NULL,
    target_branch TEXT NOT NULL,
    author_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Pending_PM', 'Pending_Core', 'Pending_Interop', 'Approved', 'Rejected')),
    git_diff TEXT NOT NULL,
    ai_summary_json TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    environment TEXT NOT NULL DEFAULT 'Production',
    version_tag TEXT NOT NULL DEFAULT 'v2.4.0',
    whatsapp_notified INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (author_id) REFERENCES Users(id)
);

CREATE TABLE IF NOT EXISTS ApprovalLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role_at_action TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('SUBMIT', 'APPROVE', 'REJECT', 'REOPEN')),
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (mr_id) REFERENCES MergeRequests(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES Users(id)
);
