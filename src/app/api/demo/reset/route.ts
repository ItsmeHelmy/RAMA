import { NextResponse } from "next/server";
import { getDb, seedDemoData } from "@/lib/db";

export async function POST() {
  seedDemoData(getDb());
  return NextResponse.json({ ok: true, message: "Data simulasi dikembalikan ke kondisi awal." });
}
