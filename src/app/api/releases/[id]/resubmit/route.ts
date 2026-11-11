import { NextRequest, NextResponse } from "next/server";
import { resubmit } from "@/lib/release-service";

/** POST /api/releases/:id/resubmit — Body: { actor_id, note? }. Hanya developer pengaju. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const result = resubmit({ releaseId: Number(id), actorId: Number(body.actor_id), note: body.note });
  if (!result.ok) return NextResponse.json(result, { status: result.httpStatus });
  return NextResponse.json(result);
}
