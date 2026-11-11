import { NextRequest, NextResponse } from "next/server";
import { getLogs, getUsers, listReleases } from "@/lib/db";
import { createRelease } from "@/lib/release-service";
import { SCENARIO_PRESETS } from "@/lib/mock-scenarios";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: "simulasi",
    users: getUsers(),
    releases: listReleases(),
    logs: getLogs(),
    presets: SCENARIO_PRESETS.map(({ contohSummary: _omit, ...p }) => p),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
}

/** Simulasi MR dari GitLab: membuat Release Request baru (hanya Developer). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await createRelease({
    actorId: Number(body.actor_id),
    judul: String(body.judul || ""),
    modul: String(body.modul || ""),
    repo: String(body.repo || ""),
    featureBranch: String(body.feature_branch || ""),
    rollbackPlan: String(body.rollback_plan || ""),
    gitDiff: String(body.git_diff || ""),
    presetKey: body.preset_key ? String(body.preset_key) : undefined,
    apiKey: body.api_key ? String(body.api_key) : undefined,
  });
  if (!result.ok) return NextResponse.json(result, { status: result.httpStatus });
  return NextResponse.json(result);
}
