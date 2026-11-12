/**
 * RAMA — penyimpanan SQLite (node:sqlite, Node 22+).
 * Semua data adalah simulasi; tidak ada koneksi ke GitLab BSI UII.
 */
import path from "path";
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import { evaluateRisk, maskSecrets, parseChangedFiles } from "./risk-engine";
import { SCENARIO_PRESETS, SEED_APPROVAL_NOTES, SEED_RELEASES } from "./mock-scenarios";
import { LAYERS } from "./workflow";
import { ApprovalLog, ReleaseMR, ReleaseRequest, User } from "./types";

const DB_DIR = path.join(process.cwd(), "db");
const DB_PATH = path.join(DB_DIR, "rama-sim.db");

declare global {
  // eslint-disable-next-line no-var
  var __ramaSimDb: DatabaseSync | undefined;
}

const SCHEMA = `
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
  kode TEXT NOT NULL UNIQUE,
  judul TEXT NOT NULL,
  modul TEXT NOT NULL,
  repo TEXT NOT NULL,
  feature_branch TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('Pending_PM','Pending_Core','Pending_Interop','Approved','Perlu_Revisi')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
  triggered_rules_json TEXT NOT NULL,
  changed_files_json TEXT NOT NULL,
  git_diff_masked TEXT NOT NULL,
  ai_summary_json TEXT,
  ai_source TEXT NOT NULL CHECK (ai_source IN ('gemini','contoh','tidak_tersedia')),
  rollback_plan TEXT NOT NULL DEFAULT '',
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
  mr_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('BELUM_DIMULAI','MENUNGGU','DISETUJUI','DITOLAK')),
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
  to_status TEXT NOT NULL,
  comment TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'simulasi',
  created_at TEXT NOT NULL
);
`;

export function getDb(): DatabaseSync {
  if (!global.__ramaSimDb) {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    const { c } = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    if (c === 0) seedDemoData(db);
    global.__ramaSimDb = db;
  }
  return global.__ramaSimDb;
}

/** Menjalankan fn di dalam transaksi SQLite. */
export function inTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helper tulis (dipakai seed dan release-service)
// ---------------------------------------------------------------------------

export function nextMrNumber(db: DatabaseSync): number {
  const row = db.prepare("SELECT MAX(mr_number) AS m FROM release_mrs").get() as { m: number | null };
  return (row.m ?? 900) + 1;
}

export function nextReleaseKode(db: DatabaseSync): string {
  const rows = db.prepare("SELECT kode FROM release_requests").all() as { kode: string }[];
  const max = rows.reduce((acc, r) => Math.max(acc, Number(r.kode.split("-").pop()) || 0), 0);
  return `REL-2026-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Membuat satu set MR untuk sebuah iterasi: layer 1 DISETUJUI (sudah di-merge ke develop
 * oleh developer), layer 2 MENUNGGU, layer 3–4 BELUM_DIMULAI.
 */
export function insertMrSet(
  db: DatabaseSync,
  p: { releaseId: number; iterasi: number; repo: string; featureBranch: string; authorId: number; at: string; firstNumber: number }
) {
  const stmt = db.prepare(`
    INSERT INTO release_mrs (release_id, iterasi, layer, repo, source_branch, target_branch, mr_number, status, opened_at, decided_at, decided_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of LAYERS) {
    const source = l.layer === 1 ? p.featureBranch : l.source;
    if (l.layer === 1) {
      stmt.run(p.releaseId, p.iterasi, 1, p.repo, source, l.target, p.firstNumber, "DISETUJUI", p.at, p.at, p.authorId);
    } else if (l.layer === 2) {
      stmt.run(p.releaseId, p.iterasi, 2, p.repo, source, l.target, p.firstNumber + 1, "MENUNGGU", p.at, null, null);
    } else {
      stmt.run(p.releaseId, p.iterasi, l.layer, p.repo, source, l.target, p.firstNumber + l.layer - 1, "BELUM_DIMULAI", null, null, null);
    }
  }
}

export function insertLog(
  db: DatabaseSync,
  p: {
    releaseId: number;
    layer: number | null;
    userId: number;
    role: string;
    action: string;
    from: string;
    to: string;
    comment: string;
    at: string;
  }
) {
  db.prepare(`
    INSERT INTO approval_logs (release_id, layer, user_id, role_at_action, action, from_status, to_status, comment, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'simulasi', ?)
  `).run(p.releaseId, p.layer, p.userId, p.role, p.action, p.from, p.to, p.comment, p.at);
}

// ---------------------------------------------------------------------------
// Seed data demo
// ---------------------------------------------------------------------------

export function seedDemoData(db: DatabaseSync) {
  db.exec("DELETE FROM approval_logs; DELETE FROM release_mrs; DELETE FROM release_requests; DELETE FROM users;");
  db.exec("DELETE FROM sqlite_sequence;");

  const insertUser = db.prepare("INSERT INTO users (name, email, role, title, avatar) VALUES (?, ?, ?, ?, ?)");
  insertUser.run("Helmy (Developer)", "helmy.dev@uii.ac.id", "DEVELOPER", "Full-Stack Engineer · Tim Aplikasi", "HD");
  insertUser.run("Nadia Putri", "nadia.pm@uii.ac.id", "PM", "Project Manager", "NP");
  insertUser.run("Dimas Prakoso", "dimas.core@uii.ac.id", "CORE", "Tim Core · Arsitektur & Database", "DP");
  insertUser.run("Rizky Pratama", "rizky.interop@uii.ac.id", "INTEROP", "Tim Interoperability · API Gateway", "RP");
  const USER_BY_LAYER: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4 };
  const ROLE_BY_LAYER: Record<number, string> = { 1: "DEVELOPER", 2: "PM", 3: "CORE", 4: "INTEROP" };
  const STATUS_WAITING_AT: Record<number, string> = { 2: "Pending_PM", 3: "Pending_Core", 4: "Pending_Interop" };

  const insertRelease = db.prepare(`
    INSERT INTO release_requests (kode, judul, modul, repo, feature_branch, author_id, status, risk_level,
      triggered_rules_json, changed_files_json, git_diff_masked, ai_summary_json, ai_source, rollback_plan, iterasi, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, 'tidak_tersedia', ?, 1, ?, ?)
  `);

  const now = Date.now();
  for (const seed of SEED_RELEASES) {
    const preset = SCENARIO_PRESETS.find((p) => p.key === seed.presetKey)!;
    const files = parseChangedFiles(preset.git_diff);
    const risk = evaluateRisk(files, preset.git_diff);
    const { masked } = maskSecrets(preset.git_diff);

    // Layer yang sedang menunggu / tempat reject terjadi (5 = semua layer selesai).
    const stopLayer =
      seed.status === "Approved" ? 5 : seed.status === "Perlu_Revisi" ? seed.rejectedAtLayer! : { Pending_PM: 2, Pending_Core: 3, Pending_Interop: 4 }[seed.status]!;
    // Jumlah keputusan (approve layer 2..stopLayer-1, ditambah satu reject jika Perlu_Revisi).
    const decisions = Math.max(0, Math.min(stopLayer, 5) - 2) + (seed.status === "Perlu_Revisi" ? 1 : 0);
    const stepMs = (seed.createdMinutesAgo * 60_000) / (decisions + 0.6);
    const t0 = now - seed.createdMinutesAgo * 60_000;
    const at = (i: number) => new Date(t0 + stepMs * i).toISOString();
    const lastAt = at(decisions);

    const res = insertRelease.run(
      seed.kode, preset.judul, preset.modul, preset.repo, preset.feature_branch, seed.status, risk.level,
      JSON.stringify(risk.triggeredRules), JSON.stringify(files), masked,
      preset.rollback_plan, at(0), lastAt
    );
    const releaseId = Number(res.lastInsertRowid);
    insertMrSet(db, { releaseId, iterasi: 1, repo: preset.repo, featureBranch: preset.feature_branch, authorId: 1, at: at(0), firstNumber: seed.mrBase });
    insertLog(db, {
      releaseId, layer: 1, userId: 1, role: "DEVELOPER", action: "SUBMIT", from: "Draft_GitLab", to: "Pending_PM",
      comment: `MR layer 1 (${preset.feature_branch} → develop) di-merge (simulasi). Release Request dibuat; MR layer 2 dibuka.`,
      at: at(0),
    });

    const updateMr = db.prepare(
      "UPDATE release_mrs SET status = ?, opened_at = COALESCE(opened_at, ?), decided_at = ?, decided_by = ? WHERE release_id = ? AND iterasi = 1 AND layer = ?"
    );
    const openMr = db.prepare("UPDATE release_mrs SET status = 'MENUNGGU', opened_at = ? WHERE release_id = ? AND iterasi = 1 AND layer = ?");

    for (let layer = 2; layer < Math.min(stopLayer, 5); layer++) {
      const t = at(layer - 1);
      updateMr.run("DISETUJUI", t, t, USER_BY_LAYER[layer], releaseId, layer);
      if (layer < 4) openMr.run(t, releaseId, layer + 1);
      insertLog(db, {
        releaseId, layer, userId: USER_BY_LAYER[layer], role: ROLE_BY_LAYER[layer], action: "APPROVE",
        from: STATUS_WAITING_AT[layer], to: layer === 4 ? "Approved" : STATUS_WAITING_AT[layer + 1],
        comment: SEED_APPROVAL_NOTES[layer as 2 | 3 | 4], at: t,
      });
    }
    if (seed.status === "Perlu_Revisi") {
      const layer = seed.rejectedAtLayer!;
      const t = at(decisions);
      updateMr.run("DITOLAK", t, t, USER_BY_LAYER[layer], releaseId, layer);
      insertLog(db, {
        releaseId, layer, userId: USER_BY_LAYER[layer], role: ROLE_BY_LAYER[layer], action: "REJECT",
        from: STATUS_WAITING_AT[layer], to: "Perlu_Revisi", comment: seed.rejectReason || "Perlu revisi.", at: t,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------

export function getUsers(): User[] {
  return getDb().prepare("SELECT id, name, email, role, title, avatar FROM users ORDER BY id").all() as unknown as User[];
}

export function getUser(id: number): User | undefined {
  return getDb().prepare("SELECT id, name, email, role, title, avatar FROM users WHERE id = ?").get(id) as unknown as
    | User
    | undefined;
}

export function getLogs(releaseId?: number): ApprovalLog[] {
  const sql = `
    SELECT l.*, u.name AS user_name, r.kode AS release_kode
    FROM approval_logs l
    JOIN users u ON u.id = l.user_id
    JOIN release_requests r ON r.id = l.release_id
    ${releaseId ? "WHERE l.release_id = ?" : ""}
    ORDER BY l.id ASC`;
  const stmt = getDb().prepare(sql);
  return (releaseId ? stmt.all(releaseId) : stmt.all()) as unknown as ApprovalLog[];
}

function rowToRelease(row: Record<string, unknown>, mrs: ReleaseMR[], logs: ApprovalLog[]): ReleaseRequest {
  return {
    id: Number(row.id),
    kode: String(row.kode),
    judul: String(row.judul),
    modul: String(row.modul),
    repo: String(row.repo),
    feature_branch: String(row.feature_branch),
    author_id: Number(row.author_id),
    author_name: String(row.author_name),
    status: row.status as ReleaseRequest["status"],
    risk_level: row.risk_level as ReleaseRequest["risk_level"],
    triggered_rules: JSON.parse(String(row.triggered_rules_json)),
    changed_files: JSON.parse(String(row.changed_files_json)),
    git_diff: String(row.git_diff_masked),
    ai_summary: row.ai_summary_json ? JSON.parse(String(row.ai_summary_json)) : null,
    ai_source: row.ai_source as ReleaseRequest["ai_source"],
    rollback_plan: String(row.rollback_plan || ""),
    iterasi: Number(row.iterasi),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    mrs,
    logs,
  };
}

export function listReleases(): ReleaseRequest[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, u.name AS author_name FROM release_requests r JOIN users u ON u.id = r.author_id ORDER BY r.id DESC`
    )
    .all() as Record<string, unknown>[];
  const mrRows = db
    .prepare(
      `SELECT m.*, u.name AS decided_by_name FROM release_mrs m
       JOIN release_requests r ON r.id = m.release_id AND r.iterasi = m.iterasi
       LEFT JOIN users u ON u.id = m.decided_by
       ORDER BY m.layer ASC`
    )
    .all() as Record<string, unknown>[];
  const logs = getLogs();

  return rows.map((row) => {
    const id = Number(row.id);
    const mrs: ReleaseMR[] = mrRows
      .filter((m) => Number(m.release_id) === id)
      .map((m) => ({
        id: Number(m.id),
        release_id: id,
        iterasi: Number(m.iterasi),
        layer: Number(m.layer) as ReleaseMR["layer"],
        repo: String(m.repo),
        source_branch: String(m.source_branch),
        target_branch: String(m.target_branch),
        mr_ref: `!${m.mr_number}`,
        status: m.status as ReleaseMR["status"],
        opened_at: (m.opened_at as string) ?? null,
        decided_at: (m.decided_at as string) ?? null,
        decided_by_name: (m.decided_by_name as string) ?? null,
      }));
    return rowToRelease(row, mrs, logs.filter((l) => l.release_id === id));
  });
}

export function getRelease(id: number): ReleaseRequest | undefined {
  return listReleases().find((r) => r.id === id);
}
