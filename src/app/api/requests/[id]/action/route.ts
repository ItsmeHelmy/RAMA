import { NextRequest, NextResponse } from "next/server";
import { getDb, getMergeRequestById, getUserByRole } from "@/lib/db";
import { validateStateTransition } from "@/lib/state-machine";
import { UserRole } from "@/lib/types";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const mrId = Number(id);
    const body = await req.json();
    const { action, role, comment } = body as {
      action: "APPROVE" | "REJECT" | "REOPEN";
      role: UserRole;
      comment?: string;
    };

    if (!mrId || !action || !role) {
      return NextResponse.json(
        { ok: false, error: "Parameter mrId, action, dan role wajib disertakan." },
        { status: 400 }
      );
    }

    const currentMr = getMergeRequestById(mrId);
    if (!currentMr) {
      return NextResponse.json(
        { ok: false, error: `Merge Request #${mrId} tidak ditemukan.` },
        { status: 404 }
      );
    }

    // Validasi Role-Based State Machine
    const transition = validateStateTransition(currentMr.status, role, action);
    if (!transition.allowed || !transition.nextStatus) {
      return NextResponse.json(
        {
          ok: false,
          error: transition.error || "Aksi tidak diizinkan oleh Role-Based State Machine.",
        },
        { status: 403 }
      );
    }

    const db = getDb();
    const actingUser = getUserByRole(role);
    const userId = actingUser?.id || 2;
    const now = new Date().toISOString();

    // Update status pada tabel MergeRequests
    db.prepare(`
      UPDATE MergeRequests
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(transition.nextStatus, now, mrId);

    const defaultComment =
      action === "APPROVE"
        ? `Disetujui pada layer ${role}. Status berpindah otomatis dari ${currentMr.status} ➔ ${transition.nextStatus}.`
        : action === "REJECT"
        ? `Ditolak pada layer ${role}. Dikembalikan ke Developer untuk revisi.`
        : `Diajukan ulang setelah perbaikan kode. Kembali ke antrean Pending_PM.`;

    // Simpan riwayat ke tabel ApprovalLogs (Audit Trail)
    db.prepare(`
      INSERT INTO ApprovalLogs (
        mr_id, user_id, role_at_action, action, from_status, to_status, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mrId,
      userId,
      role,
      action,
      currentMr.status,
      transition.nextStatus,
      comment?.trim() || defaultComment,
      now
    );

    const updatedMr = getMergeRequestById(mrId);

    return NextResponse.json({
      ok: true,
      message: `Status berhasil diperbarui menjadi ${transition.nextStatus}`,
      request: updatedMr,
    });
  } catch (error) {
    console.error("[POST /api/requests/[id]/action] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Terjadi kesalahan saat memproses aksi persetujuan." },
      { status: 500 }
    );
  }
}
