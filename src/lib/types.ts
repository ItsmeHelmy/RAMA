export type UserRole = "DEVELOPER" | "PM" | "CORE" | "INTEROP";

/** Status sebuah Release Request (satu perjalanan rilis lintas 4 layer branch). */
export type ReleaseStatus =
  | "Pending_PM"
  | "Pending_Core"
  | "Pending_Interop"
  | "Approved"
  | "Perlu_Revisi";

/** Status MR simulasi pada satu layer. */
export type MRStatus = "BELUM_DIMULAI" | "MENUNGGU" | "DISETUJUI" | "DITOLAK";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type LogAction = "SUBMIT" | "APPROVE" | "REJECT" | "RESUBMIT" | "BLOCKED";

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  title: string;
  avatar: string;
}

export interface ChangedFile {
  path: string;
  change: "added" | "modified" | "deleted";
}

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";

export interface TriggeredRule {
  id: RuleId;
  label: string;
  level: RiskLevel;
  /** File pemicu (kosong untuk R4 yang memicu dari isi diff, atau R7). */
  file?: string;
  detail?: string;
}

export interface RiskEvaluation {
  level: RiskLevel;
  triggeredRules: TriggeredRule[];
}

/**
 * Output AI yang diizinkan. AI TIDAK menentukan level risiko, TIDAK menyatakan
 * perubahan aman, dan TIDAK menghasilkan angka (downtime, kecepatan, persentase).
 */
export interface AISummary {
  ringkasan: string;
  dampak_pengguna: string[];
  pertanyaan_untuk_developer: string[];
}

/** gemini = dipanggil live; contoh = teks statis mockup; tidak_tersedia = AI mati/gagal. */
export type AISource = "gemini" | "contoh" | "tidak_tersedia";

export interface ReleaseMR {
  id: number;
  release_id: number;
  iterasi: number;
  layer: 1 | 2 | 3 | 4;
  repo: string;
  source_branch: string;
  target_branch: string;
  mr_ref: string;
  status: MRStatus;
  opened_at: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
}

export interface ApprovalLog {
  id: number;
  release_id: number;
  release_kode: string;
  layer: number | null;
  user_id: number;
  user_name: string;
  role_at_action: UserRole;
  action: LogAction;
  from_status: string;
  to_status: string;
  comment: string;
  source: string;
  created_at: string;
}

export interface ReleaseRequest {
  id: number;
  kode: string;
  judul: string;
  modul: string;
  repo: string;
  feature_branch: string;
  author_id: number;
  author_name: string;
  status: ReleaseStatus;
  risk_level: RiskLevel;
  triggered_rules: TriggeredRule[];
  changed_files: ChangedFile[];
  /** Diff yang sudah disamarkan (R4) — diff mentah tidak pernah disimpan. */
  git_diff: string;
  ai_summary: AISummary | null;
  ai_source: AISource;
  rollback_plan: string;
  iterasi: number;
  created_at: string;
  updated_at: string;
  /** MR pada iterasi berjalan, berurutan layer 1..4. */
  mrs: ReleaseMR[];
  logs: ApprovalLog[];
}
