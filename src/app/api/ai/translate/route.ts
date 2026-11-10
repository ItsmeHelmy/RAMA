import { NextRequest, NextResponse } from "next/server";
import { translateGitDiffWithAI } from "@/lib/ai-translator";
import { getDb, getMergeRequestById } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      mr_id,
      title = "Update Layanan Core BSI UII",
      repo_name = "bsi-uii / uii-core-service",
      git_diff,
      custom_api_key,
    } = body;

    if (!git_diff) {
      return NextResponse.json(
        { ok: false, error: "Data git_diff wajib disertakan untuk dianalisis oleh AI." },
        { status: 400 }
      );
    }

    const summary = await translateGitDiffWithAI({
      title,
      repoName: repo_name,
      gitDiff: git_diff,
      customApiKey: custom_api_key,
    });

    if (mr_id) {
      const db = getDb();
      db.prepare(`
        UPDATE MergeRequests
        SET ai_summary_json = ?, risk_level = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(summary), summary.riskLevel, new Date().toISOString(), Number(mr_id));
    }

    return NextResponse.json({
      ok: true,
      summary,
      request: mr_id ? getMergeRequestById(Number(mr_id)) : undefined,
    });
  } catch (error) {
    console.error("[POST /api/ai/translate] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Gagal menerjemahkan git diff dengan AI." },
      { status: 500 }
    );
  }
}
