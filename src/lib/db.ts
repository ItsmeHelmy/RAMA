import path from "path";
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import { DEMO_SCENARIOS } from "./mock-scenarios";
import { ApprovalLog, MergeRequestItem, MRStatus, User, UserRole } from "./types";

const DB_DIR = path.join(process.cwd(), "db");
const DB_PATH = path.join(DB_DIR, "rama.db");

declare global {
  // eslint-disable-next-line no-var
  var __ramaDb: DatabaseSync | undefined;
}

export function getDb(): DatabaseSync {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (!global.__ramaDb) {
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    initSchemaAndSeed(db);
    global.__ramaDb = db;
  }

  return global.__ramaDb;
}

function initSchemaAndSeed(db: DatabaseSync) {
  db.exec(`
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
  `);

  const userCount = db.prepare("SELECT COUNT(*) as count FROM Users").get() as { count: number };
  if (userCount.count === 0) {
    seedInitialData(db);
  }
}

export function seedInitialData(db: DatabaseSync) {
  db.exec("DELETE FROM ApprovalLogs;");
  db.exec("DELETE FROM MergeRequests;");
  db.exec("DELETE FROM Users;");
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('Users', 'MergeRequests', 'ApprovalLogs');");

  const insertUser = db.prepare(`
    INSERT INTO Users (name, email, role, title, department, avatar)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // 4 Role utama sesuai arsitektur deployment berjenjang BSI UII
  insertUser.run(
    "Helmyawan (Lead Dev)",
    "helmy.dev@uii.ac.id",
    "DEVELOPER",
    "Full-Stack Engineer • Tim Aplikasi Akademik & Keuangan",
    "Divisi Pengembangan Sistem BSI",
    "HD"
  );
  insertUser.run(
    "Nadia Putri, M.Kom.",
    "nadia.pm@uii.ac.id",
    "PM",
    "Product & Project Manager (PM)",
    "Manajemen Produk & Layanan Digital BSI",
    "NP"
  );
  insertUser.run(
    "Ir. Dimas Prakoso, S.T.",
    "dimas.core@uii.ac.id",
    "CORE",
    "Principal Core & Database Architect",
    "Tim Core Architecture & Data BSI",
    "DP"
  );
  insertUser.run(
    "Rizky Pratama, M.Cs.",
    "rizky.interop@uii.ac.id",
    "INTEROP",
    "Head of Interoperability & API Gateway",
    "Tim Interoperability & Infrastruktur Rilis",
    "RP"
  );

  const insertMR = db.prepare(`
    INSERT INTO MergeRequests (
      mr_code, title, repo_name, source_branch, target_branch,
      author_id, status, git_diff, ai_summary_json, risk_level,
      environment, version_tag, whatsapp_notified, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLog = db.prepare(`
    INSERT INTO ApprovalLogs (
      mr_id, user_id, role_at_action, action, from_status, to_status, comment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

  // Seed ke-4 skenario agar tiap kolom Kanban memiliki contoh nyata untuk didemokan
  DEMO_SCENARIOS.forEach((sc, idx) => {
    const createdAt = iso((4 - idx) * 35);
    const updatedAt = iso((4 - idx) * 10);

    const res = insertMR.run(
      sc.mr_code,
      sc.title,
      sc.repo_name,
      sc.source_branch,
      sc.target_branch,
      1, // Author: Developer
      sc.defaultStatus,
      sc.git_diff,
      JSON.stringify(sc.fallbackSummary),
      sc.fallbackSummary.riskLevel,
      sc.environment,
      sc.version_tag,
      1,
      createdAt,
      updatedAt
    );

    const mrId = Number(res.lastInsertRowid);

    // Log 1: Developer Submit
    insertLog.run(
      mrId,
      1,
      "DEVELOPER",
      "SUBMIT",
      "Draft_GitLab",
      "Pending_PM",
      `Merge Request ${sc.mr_code} dikirim dari GitLab Webhook. AI Code Translator berhasil menerjemahkan git diff ke Bahasa Bisnis.`,
      createdAt
    );

    if (sc.defaultStatus === "Pending_Core" || sc.defaultStatus === "Pending_Interop" || sc.defaultStatus === "Approved") {
      insertLog.run(
        mrId,
        2,
        "PM",
        "APPROVE",
        "Pending_PM",
        "Pending_Core",
        "Dampak bisnis sudah sesuai kebutuhan semester ini. AI Summary jelas, lanjutkan verifikasi teknis ke Tim Core.",
        iso((4 - idx) * 25)
      );
    }

    if (sc.defaultStatus === "Pending_Interop" || sc.defaultStatus === "Approved") {
      insertLog.run(
        mrId,
        3,
        "CORE",
        "APPROVE",
        "Pending_Core",
        "Pending_Interop",
        "Skema database & strategi zero-downtime terverifikasi aman. Silakan Tim Interop validasi API Gateway.",
        iso((4 - idx) * 18)
      );
    }

    if (sc.defaultStatus === "Approved") {
      insertLog.run(
        mrId,
        4,
        "INTEROP",
        "APPROVE",
        "Pending_Interop",
        "Approved",
        "Kontrak API & koneksi eksternal BSrE aman. Otorisasi rilis ke Production disetujui.",
        iso(8)
      );
    }
  });
}

export function getAllUsers(): User[] {
  const db = getDb();
  return db.prepare("SELECT * FROM Users ORDER BY id ASC").all() as unknown as User[];
}

export function getUserByRole(role: UserRole): User | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM Users WHERE role = ? LIMIT 1").get(role) as unknown as
    | User
    | undefined;
}

export function getAllMergeRequests(): MergeRequestItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT
        mr.*,
        u.name as author_name,
        u.title as author_title,
        u.avatar as author_avatar
      FROM MergeRequests mr
      JOIN Users u ON mr.author_id = u.id
      ORDER BY mr.id DESC
    `
    )
    .all() as Array<Record<string, unknown>>;

  const logRows = db
    .prepare(
      `
      SELECT
        l.*,
        u.name as user_name,
        u.title as user_title,
        u.avatar as user_avatar
      FROM ApprovalLogs l
      JOIN Users u ON l.user_id = u.id
      ORDER BY l.id ASC
    `
    )
    .all() as unknown as ApprovalLog[];

  const logsByMr = new Map<number, ApprovalLog[]>();
  for (const log of logRows) {
    const list = logsByMr.get(log.mr_id) || [];
    list.push(log);
    logsByMr.set(log.mr_id, list);
  }

  return rows.map((row) => ({
    id: Number(row.id),
    mr_code: String(row.mr_code),
    title: String(row.title),
    repo_name: String(row.repo_name),
    source_branch: String(row.source_branch),
    target_branch: String(row.target_branch),
    author_id: Number(row.author_id),
    author_name: String(row.author_name),
    author_title: String(row.author_title),
    author_avatar: String(row.author_avatar),
    status: String(row.status) as MRStatus,
    git_diff: String(row.git_diff),
    ai_summary: JSON.parse(String(row.ai_summary_json)),
    risk_level: String(row.risk_level) as MergeRequestItem["risk_level"],
    environment: String(row.environment),
    version_tag: String(row.version_tag),
    whatsapp_notified: Boolean(row.whatsapp_notified),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    logs: logsByMr.get(Number(row.id)) || [],
  }));
}

export function getMergeRequestById(id: number): MergeRequestItem | undefined {
  const all = getAllMergeRequests();
  return all.find((item) => item.id === id);
}
