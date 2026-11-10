import { NextResponse } from "next/server";
import { getAllMergeRequests, getAllUsers, getDb, seedInitialData } from "@/lib/db";

export async function POST() {
  try {
    const db = getDb();
    seedInitialData(db);
    return NextResponse.json({
      ok: true,
      message: "Database SQLite berhasil di-reset ke skenario demo awal BSI UII.",
      users: getAllUsers(),
      requests: getAllMergeRequests(),
    });
  } catch (error) {
    console.error("[POST /api/demo/reset] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Gagal me-reset data demo." },
      { status: 500 }
    );
  }
}
