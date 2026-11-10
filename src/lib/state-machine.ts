import { MRStatus, UserRole } from "./types";

export interface StageDefinition {
  status: MRStatus;
  label: string;
  shortLabel: string;
  requiredRole: UserRole | null;
  nextStatusOnApprove: MRStatus | null;
  stepNumber: number;
  description: string;
}

export const WORKFLOW_STAGES: Record<MRStatus, StageDefinition> = {
  Pending_PM: {
    status: "Pending_PM",
    label: "Menunggu Persetujuan PM",
    shortLabel: "Layer 1: PM Alignment",
    requiredRole: "PM",
    nextStatusOnApprove: "Pending_Core",
    stepNumber: 1,
    description:
      "Validasi kesesuaian fitur bisnis, timeline rilis, dan kebutuhan stakeholder unit/fakultas.",
  },
  Pending_Core: {
    status: "Pending_Core",
    label: "Menunggu Tim Core",
    shortLabel: "Layer 2: Core Architecture",
    requiredRole: "CORE",
    nextStatusOnApprove: "Pending_Interop",
    stepNumber: 2,
    description:
      "Verifikasi keamanan skema database utama, performa query, dan kompatibilitas modul inti UII.",
  },
  Pending_Interop: {
    status: "Pending_Interop",
    label: "Menunggu Tim Interoperability",
    shortLabel: "Layer 3: Interop & Gateway",
    requiredRole: "INTEROP",
    nextStatusOnApprove: "Approved",
    stepNumber: 3,
    description:
      "Validasi kontrak API antar-layanan (SIAKAD, Keuangan, Gateway Bank Mitra) dan zero-downtime deployment.",
  },
  Approved: {
    status: "Approved",
    label: "Siap Rilis (Approved)",
    shortLabel: "Layer 4: Ready to Deploy",
    requiredRole: null,
    nextStatusOnApprove: null,
    stepNumber: 4,
    description:
      "Seluruh gate berjenjang telah terverifikasi. Pipeline GitLab CI/CD diizinkan mengeksekusi merge & rilis.",
  },
  Rejected: {
    status: "Rejected",
    label: "Ditolak / Revisi (Rejected)",
    shortLabel: "Blocked / Needs Revision",
    requiredRole: "DEVELOPER",
    nextStatusOnApprove: "Pending_PM",
    stepNumber: 0,
    description:
      "Pengajuan ditolak pada salah satu gate dan dikembalikan ke Developer beserta catatan audit untuk perbaikan.",
  },
};

export const ROLE_METADATA: Record<
  UserRole,
  {
    label: string;
    badgeColor: string;
    layerName: string;
    canApproveStatus: MRStatus | null;
    responsibility: string;
  }
> = {
  DEVELOPER: {
    label: "Developer (Pengaju)",
    badgeColor: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    layerName: "Source Layer (GitLab MR)",
    canApproveStatus: null,
    responsibility: "Mengajukan Merge Request & merespons revisi jika ditolak",
  },
  PM: {
    label: "Project Manager (PM)",
    badgeColor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    layerName: "Gate 1: Business & Product Alignment",
    canApproveStatus: "Pending_PM",
    responsibility: "Menyetujui kesesuaian fitur bisnis tanpa harus membaca ratusan baris kode",
  },
  CORE: {
    label: "Tim Core BSI",
    badgeColor: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    layerName: "Gate 2: Core System & Database Integrity",
    canApproveStatus: "Pending_Core",
    responsibility: "Memastikan perubahan aman terhadap arsitektur inti & database master",
  },
  INTEROP: {
    label: "Tim Interoperability",
    badgeColor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    layerName: "Gate 3: API Gateway & Cross-System Sync",
    canApproveStatus: "Pending_Interop",
    responsibility: "Otorisasi akhir sebelum rilis ke Production & sinkronisasi API eksternal",
  },
};

/**
 * Validasi ketat Role-Based State Machine:
 * Memastikan hanya role yang berwenang yang dapat melakukan APPROVE / REJECT pada status tertentu.
 */
export function validateStateTransition(
  currentStatus: MRStatus,
  userRole: UserRole,
  action: "APPROVE" | "REJECT" | "REOPEN"
): {
  allowed: boolean;
  nextStatus?: MRStatus;
  error?: string;
} {
  if (action === "REOPEN") {
    if (currentStatus !== "Rejected") {
      return {
        allowed: false,
        error: "Hanya Merge Request berstatus Rejected yang dapat diajukan ulang (Reopen).",
      };
    }
    if (userRole !== "DEVELOPER" && userRole !== "PM") {
      return {
        allowed: false,
        error: "Hanya Developer atau PM yang dapat membuka kembali pengajuan yang ditolak.",
      };
    }
    return { allowed: true, nextStatus: "Pending_PM" };
  }

  const stage = WORKFLOW_STAGES[currentStatus];
  if (!stage || !stage.requiredRole) {
    return {
      allowed: false,
      error: `Status '${currentStatus}' sudah final dan tidak memerlukan persetujuan lagi.`,
    };
  }

  if (stage.requiredRole !== userRole) {
    return {
      allowed: false,
      error: `Akses Ditolak (Role-Based State Machine): Status '${currentStatus}' hanya dapat diproses oleh role '${stage.requiredRole}', sedangkan role aktif Anda adalah '${userRole}'.`,
    };
  }

  if (action === "REJECT") {
    return {
      allowed: true,
      nextStatus: "Rejected",
    };
  }

  if (action === "APPROVE" && stage.nextStatusOnApprove) {
    return {
      allowed: true,
      nextStatus: stage.nextStatusOnApprove,
    };
  }

  return {
    allowed: false,
    error: "Transisi status tidak valid.",
  };
}
