import { NextRequest, NextResponse } from "next/server";
import {
  getAllMergeRequests,
  getAllUsers,
  getDb,
  getMergeRequestById,
  getUserByRole,
} from "@/lib/db";
import { translateGitDiffWithAI } from "@/lib/ai-translator";
import { DEMO_SCENARIOS } from "@/lib/mock-scenarios";

export async function GET() {
  try {
    const users = getAllUsers();
    const requests = getAllMergeRequests();
    return NextResponse.json({
      ok: true,
      users,
      requests,
      scenarios: DEMO_SCENARIOS,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  } catch (error) {
    console.error("[GET /api/requests] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Gagal memuat data Merge Requests dari database." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      title,
      repo_name = "bsi-uii / uii-core-service",
      source_branch = "feat/new-release",
      target_branch = "main",
      environment = "Production",
      version_tag = "v2.5.0",
      git_diff,
      custom_api_key,
    } = body;

    if (!title || !git_diff) {
      return NextResponse.json(
        { ok: false, error: "Judul pengajuan (title) dan data git_diff wajib diisi." },
        { status: 400 }
      );
    }

    // 1. Pencegatan oleh AI Code Translator (Gemini API + Smart Hybrid Engine)
    const aiSummary = await translateGitDiffWithAI({
      title,
      repoName: repo_name,
      gitDiff: git_diff,
      customApiKey: custom_api_key,
    });

    // 2. Simpan ke tabel MergeRequests dengan status awal 'Pending_PM'
    const db = getDb();
    const devUser = getUserByRole("DEVELOPER");
    const authorId = devUser?.id || 1;
    const now = new Date().toISOString();
    const mrCode = `MR-2026-${Math.floor(842 + Math.random() * 150)}`;

    const insertMR = db.prepare(`
      INSERT INTO MergeRequests (
        mr_code, title, repo_name, source_branch, target_branch,
        author_id, status, git_diff, ai_summary_json, risk_level,
        environment, version_tag, whatsapp_notified, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertMR.run(
      mrCode,
      title,
      repo_name,
      source_branch,
      target_branch,
      authorId,
      "Pending_PM",
      git_diff,
      JSON.stringify(aiSummary),
      aiSummary.riskLevel,
      environment,
      version_tag,
      1,
      now,
      now
    );

    const newMrId = Number(result.lastInsertRowid);

    // 3. Catat ke tabel ApprovalLogs (Audit Trail)
    const insertLog = db.prepare(`
      INSERT INTO ApprovalLogs (
        mr_id, user_id, role_at_action, action, from_status, to_status, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLog.run(
      newMrId,
      authorId,
      "DEVELOPER",
      "SUBMIT",
      "Draft_GitLab",
      "Pending_PM",
      `Pengajuan rilis dibuat & git diff berhasil diringkas oleh AI Code Translator (${aiSummary.generatedBy === "gemini-api" ? "Google Gemini API" : "RAMA Hybrid AI"}).`,
      now
    );

    const createdRequest = getMergeRequestById(newMrId);

    return NextResponse.json({
      ok: true,
      message: "Merge Request berhasil dibuat dan diterjemahkan oleh AI.",
      request: createdRequest,
    });
  } catch (error) {
    console.error("[POST /api/requests] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Gagal membuat pengajuan Merge Request baru." },
      { status: 500 }
    );
  }
}
