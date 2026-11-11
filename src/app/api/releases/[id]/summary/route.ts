import { NextRequest, NextResponse } from "next/server";
import { regenerateSummary } from "@/lib/release-service";

/** POST /api/releases/:id/summary — buat ulang ringkasan AI. Tidak mengubah risk_level. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const result = await regenerateSummary({ releaseId: Number(id), apiKey: body.api_key });
  if (!result.ok) return NextResponse.json(result, { status: result.httpStatus });
  return NextResponse.json(result);
}
