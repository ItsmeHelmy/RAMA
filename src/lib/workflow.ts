/**
 * RAMA Workflow — aturan transisi Release Request lintas 4 layer branch.
 *
 * Layer 1  feature → develop               Developer  (selesai saat request dibuat)
 * Layer 2  develop → staging               PM         status: Pending_PM
 * Layer 3  staging → master                Tim Core   status: Pending_Core
 * Layer 4  master  → release/production    Tim Interop status: Pending_Interop
 *
 * API Node.js dan simulasi browser menjalankan aturan keputusan yang sama.
 */
import { ReleaseRequest, ReleaseStatus, RiskLevel, User, UserRole } from "./types";

export const MIN_NOTE_LENGTH = 10;

export const LAYERS = [
  {
    layer: 1,
    source: "feature/*",
    target: "develop",
    role: "DEVELOPER" as UserRole,
    status: null,
    title: "Developer mengajukan",
    short: "Ajukan",
    plain: "Developer menyelesaikan perubahan dan mengajukannya untuk ditinjau.",
  },
  {
    layer: 2,
    source: "develop",
    target: "staging",
    role: "PM" as UserRole,
    status: "Pending_PM" as ReleaseStatus,
    title: "Project Manager meninjau",
    short: "PM",
    plain: "Memastikan perubahan sesuai prioritas dan kebutuhan pengguna.",
  },
  {
    layer: 3,
    source: "staging",
    target: "master",
    role: "CORE" as UserRole,
    status: "Pending_Core" as ReleaseStatus,
    title: "Tim Core memeriksa teknis",
    short: "Core",
    plain: "Memeriksa arsitektur, database, dan rencana pembatalan.",
  },
  {
    layer: 4,
    source: "master",
    target: "release/production",
    role: "INTEROP" as UserRole,
    status: "Pending_Interop" as ReleaseStatus,
    title: "Tim Interoperability merilis",
    short: "Interop",
    plain: "Memastikan koneksi dengan sistem lain aman, lalu merilis.",
  },
] as const;

export const ROLE_LABEL: Record<UserRole, string> = {
  DEVELOPER: "Developer",
  PM: "Project Manager",
  CORE: "Tim Core",
  INTEROP: "Tim Interoperability",
};

export const STATUS_LABEL: Record<ReleaseStatus, string> = {
  Pending_PM: "Menunggu Project Manager",
  Pending_Core: "Menunggu Tim Core",
  Pending_Interop: "Menunggu Tim Interoperability",
  Approved: "Dirilis (simulasi)",
  Perlu_Revisi: "Perlu revisi",
};

export const STATUS_HINT: Record<ReleaseStatus, string> = {
  Pending_PM: "Menunggu keputusan Project Manager",
  Pending_Core: "Menunggu pemeriksaan Tim Core",
  Pending_Interop: "Menunggu persetujuan akhir Tim Interoperability",
  Perlu_Revisi: "Dikembalikan ke developer",
  Approved: "Sudah melewati semua tahap",
};

export const RISK_META: Record<RiskLevel, { label: string; hint: string }> = {
  HIGH: {
    label: "Risiko tinggi",
    hint: "Menyentuh data atau pembayaran. Periksa dengan teliti.",
  },
  MEDIUM: {
    label: "Risiko sedang",
    hint: "Mengubah fitur yang dipakai banyak pengguna.",
  },
  LOW: {
    label: "Risiko rendah",
    hint: "Perubahan kecil dan terbatas.",
  },
};

/** Layer yang sedang menunggu keputusan untuk status tertentu. */
export const LAYER_BY_STATUS: Partial<Record<ReleaseStatus, 2 | 3 | 4>> = {
  Pending_PM: 2,
  Pending_Core: 3,
  Pending_Interop: 4,
};

export const REQUIRED_ROLE_BY_STATUS: Partial<Record<ReleaseStatus, UserRole>> = {
  Pending_PM: "PM",
  Pending_Core: "CORE",
  Pending_Interop: "INTEROP",
};

const NEXT_STATUS_ON_APPROVE: Partial<Record<ReleaseStatus, ReleaseStatus>> = {
  Pending_PM: "Pending_Core",
  Pending_Core: "Pending_Interop",
  Pending_Interop: "Approved",
};

export type DecisionAction = "APPROVE" | "REJECT";

export interface ValidationFailure {
  ok: false;
  /** 403 = tidak berwenang, 409 = state tidak sesuai, 422 = data keputusan tidak lengkap. */
  httpStatus: 403 | 409 | 422;
  error: string;
}

export interface DecisionSuccess {
  ok: true;
  layer: 2 | 3 | 4;
  nextStatus: ReleaseStatus;
}

/**
 * Validasi keputusan approve/reject. Urutan cek:
 * 1. Status masih menunggu keputusan.
 * 2. Aktor bukan pengaju (separation of duties).
 * 3. Role aktor = role yang dibutuhkan layer saat ini.
 * 4. Jika klien menyebut layer, harus sama dengan layer saat ini (tidak boleh melompat).
 * 5. Reject wajib alasan; approve risiko HIGH wajib catatan.
 * Fungsi ini menghitung state tujuan berdasarkan keputusan dan state saat ini.
 */
export function validateDecision(params: {
  release: Pick<ReleaseRequest, "status" | "author_id" | "risk_level">;
  actor: User;
  action: DecisionAction;
  note?: string;
  requestedLayer?: number;
}): ValidationFailure | DecisionSuccess {
  const { release, actor, action, requestedLayer } = params;
  const note = (params.note || "").trim();
  const currentLayer = LAYER_BY_STATUS[release.status];
  const requiredRole = REQUIRED_ROLE_BY_STATUS[release.status];

  if (!currentLayer || !requiredRole) {
    return {
      ok: false,
      httpStatus: 409,
      error: `Release Request berstatus '${release.status}' tidak sedang menunggu keputusan layer mana pun.`,
    };
  }

  if (actor.id === release.author_id) {
    return {
      ok: false,
      httpStatus: 403,
      error: "Pengaju tidak boleh memutuskan Release Request miliknya sendiri (separation of duties).",
    };
  }

  if (actor.role !== requiredRole) {
    return {
      ok: false,
      httpStatus: 403,
      error: `Hanya ${ROLE_LABEL[requiredRole]} yang dapat memutuskan di layer ${currentLayer}. Anda masuk sebagai ${ROLE_LABEL[actor.role]}.`,
    };
  }

  if (requestedLayer !== undefined && requestedLayer !== currentLayer) {
    return {
      ok: false,
      httpStatus: 403,
      error: `Tidak boleh melompat layer: request sedang di layer ${currentLayer}, bukan layer ${requestedLayer}.`,
    };
  }

  if (action === "REJECT" && note.length < MIN_NOTE_LENGTH) {
    return {
      ok: false,
      httpStatus: 422,
      error: `Reject wajib menyertakan alasan (minimal ${MIN_NOTE_LENGTH} karakter).`,
    };
  }

  if (action === "APPROVE" && release.risk_level === "HIGH" && note.length < MIN_NOTE_LENGTH) {
    return {
      ok: false,
      httpStatus: 422,
      error: `Request berisiko HIGH: approve wajib menyertakan catatan (minimal ${MIN_NOTE_LENGTH} karakter).`,
    };
  }

  return {
    ok: true,
    layer: currentLayer,
    nextStatus: action === "APPROVE" ? NEXT_STATUS_ON_APPROVE[release.status]! : "Perlu_Revisi",
  };
}

/**
 * Validasi kirim ulang setelah revisi. Hanya pengaju (developer) yang boleh.
 * Asumsi sementara: request kembali ke Pending_PM (menunggu konfirmasi wawancara).
 */
export function validateResubmit(params: {
  release: Pick<ReleaseRequest, "status" | "author_id">;
  actor: User;
}): ValidationFailure | { ok: true; nextStatus: ReleaseStatus } {
  const { release, actor } = params;
  if (release.status !== "Perlu_Revisi") {
    return { ok: false, httpStatus: 409, error: "Hanya request berstatus Perlu_Revisi yang dapat dikirim ulang." };
  }
  if (actor.id !== release.author_id) {
    return { ok: false, httpStatus: 403, error: "Hanya developer pengaju yang dapat mengirim ulang setelah revisi." };
  }
  return { ok: true, nextStatus: "Pending_PM" };
}

/** Untuk UI: apakah user ini boleh memutuskan request ini sekarang? */
export function canDecide(
  release: Pick<ReleaseRequest, "status" | "author_id">,
  user: User | undefined
): { allowed: boolean; reason: string } {
  const role = REQUIRED_ROLE_BY_STATUS[release.status];
  if (!user) return { allowed: false, reason: "Belum masuk sebagai pengguna." };
  if (!role) return { allowed: false, reason: "Request ini tidak sedang menunggu keputusan." };
  if (user.id === release.author_id)
    return { allowed: false, reason: "Pengaju tidak boleh memutuskan request miliknya sendiri." };
  if (user.role !== role) return { allowed: false, reason: `Hanya ${ROLE_LABEL[role]} yang dapat memutuskan di layer ini.` };
  return { allowed: true, reason: "" };
}

export function noteRequirement(action: DecisionAction, risk: RiskLevel): boolean {
  return action === "REJECT" || risk === "HIGH";
}
