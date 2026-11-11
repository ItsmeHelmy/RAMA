import { NextRequest, NextResponse } from "next/server";
import { decide } from "@/lib/release-service";

/**
 * POST /api/releases/:id/decision
 * Body: { actor_id, action: "APPROVE" | "REJECT", note?, layer? }
 * State tujuan selalu dihitung server. Role salah / pengaju sendiri / lompat layer → 403.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const result = decide({
    releaseId: Number(id),
    actorId: Number(body.actor_id),
    action: body.action,
    note: typeof body.note === "string" ? body.note : undefined,
    layer: body.layer !== undefined ? Number(body.layer) : undefined,
  });
  if (!result.ok) return NextResponse.json(result, { status: result.httpStatus });
  return NextResponse.json(result);
}
