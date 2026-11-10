export type UserRole = "DEVELOPER" | "PM" | "CORE" | "INTEROP";

export type MRStatus =
  | "Pending_PM"
  | "Pending_Core"
  | "Pending_Interop"
  | "Approved"
  | "Rejected";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  title: string;
  department: string;
  avatar: string;
}

export interface AISummary {
  headline: string;
  businessImpact: string[]; // Poin 1: Fitur & Nilai Bisnis (Bahasa Manusia)
  technicalFixes: string[]; // Poin 2: Bug Fix & Perubahan Teknis
  riskAnalysis: string[]; // Poin 3: Risiko & Kesiapan Mitigasi
  riskLevel: RiskLevel;
  riskReason: string;
  affectedModules: string[];
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  estimatedDowntime: string;
  rollbackReady: boolean;
  generatedBy: "gemini-api" | "rama-hybrid-ai";
}

export interface ApprovalLog {
  id: number;
  mr_id: number;
  user_id: number;
  user_name?: string;
  user_title?: string;
  user_avatar?: string;
  role_at_action: UserRole;
  action: "SUBMIT" | "APPROVE" | "REJECT" | "REOPEN";
  from_status: string;
  to_status: string;
  comment: string;
  created_at: string;
}

export interface MergeRequestItem {
  id: number;
  mr_code: string;
  title: string;
  repo_name: string;
  source_branch: string;
  target_branch: string;
  author_id: number;
  author_name: string;
  author_title: string;
  author_avatar: string;
  status: MRStatus;
  git_diff: string;
  ai_summary: AISummary;
  risk_level: RiskLevel;
  environment: string;
  version_tag: string;
  whatsapp_notified: boolean;
  created_at: string;
  updated_at: string;
  logs: ApprovalLog[];
}
