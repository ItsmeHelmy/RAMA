"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Database,
  Eye,
  FileCode2,
  GitBranch,
  GitMerge,
  GitPullRequest,
  KeyRound,
  Layers,
  LayoutGrid,
  ListFilter,
  Lock,
  MessageSquareMore,
  RefreshCw,
  Rocket,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  Users,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import {
  MergeRequestItem,
  MRStatus,
  RiskLevel,
  User,
  UserRole,
} from "@/lib/types";
import { ROLE_METADATA, WORKFLOW_STAGES } from "@/lib/state-machine";
import { DemoScenarioPreset } from "@/lib/mock-scenarios";

const KANBAN_COLUMNS: MRStatus[] = [
  "Pending_PM",
  "Pending_Core",
  "Pending_Interop",
  "Approved",
];

const RISK_BADGE_STYLES: Record<RiskLevel, string> = {
  LOW: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  MEDIUM: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  HIGH: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  CRITICAL: "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse",
};

const STATUS_BADGE_STYLES: Record<MRStatus, string> = {
  Pending_PM: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Pending_Core: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Pending_Interop: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Rejected: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export default function RamaDashboardPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<MergeRequestItem[]>([]);
  const [scenarios, setScenarios] = useState<DemoScenarioPreset[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  // Active Role untuk simulasi Role-Based State Machine
  const [activeRole, setActiveRole] = useState<UserRole>("PM");
  // Mode Demo Juri: jika aktif, setelah klik Approve otomatis pindah ke role layer berikutnya agar alur 1-klik terlihat mulus
  const [autoAdvanceRole, setAutoAdvanceRole] = useState<boolean>(true);

  // Navigasi Tab Utama
  const [activeTab, setActiveTab] = useState<
    "pipeline" | "mobile-approval" | "audit-db"
  >("pipeline");
  const [pipelineLayout, setPipelineLayout] = useState<"kanban" | "list">(
    "kanban"
  );

  // Merge Request yang sedang dipilih untuk diinspeksi / di-approve
  const [selectedMrId, setSelectedMrId] = useState<number | null>(null);
  const [showRawDiffInMobile, setShowRawDiffInMobile] =
    useState<boolean>(false);
  const [approvalComment, setApprovalComment] = useState<string>("");

  // Toast / Notifikasi Real-time (Simulasi WhatsApp Group & Webhook Alert)
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    detail: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // Modal Suntikkan Git Diff Baru (Skenario Demo)
  const [showInjectModal, setShowInjectModal] = useState<boolean>(false);
  const [injectTitle, setInjectTitle] = useState<string>("");
  const [injectRepo, setInjectRepo] = useState<string>(
    "bsi-uii / uii-tagihan-core-service"
  );
  const [injectBranch, setInjectBranch] = useState<string>(
    "feat/qris-dynamic-reconciliation-v2"
  );
  const [injectVersion, setInjectVersion] = useState<string>("v3.9.0");
  const [injectDiff, setInjectDiff] = useState<string>("");
  const [injectSubmitting, setInjectSubmitting] = useState<boolean>(false);

  // Modal Konfigurasi Gemini API Key (Opsional untuk Live LLM)
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [customApiKey, setCustomApiKey] = useState<string>("");
  const [serverHasGeminiKey, setServerHasGeminiKey] = useState<boolean>(false);
  const [retranslating, setRetranslating] = useState<boolean>(false);

  const showToast = (
    title: string,
    detail: string,
    type: "success" | "error" | "info" = "info"
  ) => {
    setToastMessage({ title, detail, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.title === title ? null : prev));
    }, 5500);
  };

  const fetchDashboardData = async (keepSelection = true) => {
    try {
      const res = await fetch("/api/requests", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setUsers(data.users || []);
        setRequests(data.requests || []);
        setScenarios(data.scenarios || []);
        setServerHasGeminiKey(Boolean(data.geminiConfigured));

        if (!keepSelection || !selectedMrId) {
          const defaultPending =
            (data.requests as MergeRequestItem[]).find(
              (r) => r.status === "Pending_PM"
            ) || data.requests?.[0];
          if (defaultPending) {
            setSelectedMrId(defaultPending.id);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch RAMA dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData(false);
    const savedKey =
      typeof window !== "undefined"
        ? localStorage.getItem("RAMA_GEMINI_API_KEY") || ""
        : "";
    if (savedKey) setCustomApiKey(savedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedMr = useMemo(
    () => requests.find((r) => r.id === selectedMrId) || requests[0] || null,
    [requests, selectedMrId]
  );

  const activeUser = useMemo(
    () => users.find((u) => u.role === activeRole) || users[0],
    [users, activeRole]
  );

  // Buka modal injeksi dengan preset pertama jika belum diisi
  const openInjectModalWithPreset = (presetKey?: string) => {
    const preset =
      scenarios.find((s) => s.key === presetKey) || scenarios[0];
    if (preset) {
      setInjectTitle(preset.title);
      setInjectRepo(preset.repo_name);
      setInjectBranch(preset.source_branch);
      setInjectVersion(preset.version_tag);
      setInjectDiff(preset.git_diff);
    }
    setShowInjectModal(true);
  };

  // Handler Action Approve / Reject / Reopen
  const handleApprovalAction = async (
    mr: MergeRequestItem,
    action: "APPROVE" | "REJECT" | "REOPEN"
  ) => {
    setActionLoadingId(mr.id);
    try {
      const res = await fetch(`/api/requests/${mr.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          role: activeRole,
          comment: approvalComment,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        showToast(
          "Aksi Ditolak oleh Role-Based State Machine",
          data.error || "Role Anda tidak memiliki wewenang pada tahap ini.",
          "error"
        );
        return;
      }

      const updated: MergeRequestItem = data.request;
      setRequests((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      setSelectedMrId(updated.id);
      setApprovalComment("");

      // Jika Auto-Advance Role aktif dan aksi adalah APPROVE, otomatis pindah ke role berikutnya agar demo ke juri makin praktis
      if (action === "APPROVE" && autoAdvanceRole) {
        const nextRequiredRole =
          WORKFLOW_STAGES[updated.status]?.requiredRole;
        if (nextRequiredRole) {
          setActiveRole(nextRequiredRole);
          showToast(
            `✅ Disetujui oleh ${activeRole} ➔ Berpindah ke ${updated.status}`,
            `Notifikasi WA & Webhook terkirim! Mode Demo otomatis mengalihkan perspektif Anda ke role '${nextRequiredRole}' untuk gate berikutnya.`,
            "success"
          );
          return;
        }
      }

      showToast(
        action === "APPROVE"
          ? `🎉 ${mr.mr_code} Berhasil Disetujui!`
          : action === "REJECT"
          ? `⛔ ${mr.mr_code} Ditolak & Dikembalikan ke Developer`
          : `🔄 ${mr.mr_code} Diajukan Ulang`,
        `Status berubah dari ${mr.status} ➔ ${updated.status}. Audit log tersimpan di SQLite.`,
        action === "REJECT" ? "error" : "success"
      );
    } catch (error) {
      console.error("Action error:", error);
      showToast(
        "Kesalahan Jaringan",
        "Gagal menghubungi server backend RAMA.",
        "error"
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handler Suntikkan Git Diff Kompleks (Create Request Baru)
  const handleCreateMergeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!injectTitle.trim() || !injectDiff.trim()) return;

    setInjectSubmitting(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: injectTitle,
          repo_name: injectRepo,
          source_branch: injectBranch,
          target_branch: "main",
          environment: "Production (Cluster BSI UII)",
          version_tag: injectVersion,
          git_diff: injectDiff,
          custom_api_key: customApiKey,
        }),
      });
      const data = await res.json();
      if (data.ok && data.request) {
        const created: MergeRequestItem = data.request;
        setRequests((prev) => [created, ...prev]);
        setSelectedMrId(created.id);
        setActiveRole("PM");
        setShowInjectModal(false);
        showToast(
          `✨ Git Diff Diterjemahkan & Masuk Antrean Pending_PM!`,
          `${created.mr_code} berhasil diringkas menjadi 3 poin bahasa bisnis oleh AI Code Translator. Role aktif disetel ke PM untuk 1-Click Approval.`,
          "success"
        );
      } else {
        showToast(
          "Gagal Membuat Request",
          data.error || "Periksa kembali input Anda.",
          "error"
        );
      }
    } catch (err) {
      console.error("Create MR error:", err);
      showToast("Gagal Menyuntikkan Data", "Terjadi kesalahan server.", "error");
    } finally {
      setInjectSubmitting(false);
    }
  };

  // Handler Re-Run AI Translator menggunakan Gemini API
  const handleRetranslateSelected = async () => {
    if (!selectedMr) return;
    setRetranslating(true);
    try {
      const res = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mr_id: selectedMr.id,
          title: selectedMr.title,
          repo_name: selectedMr.repo_name,
          git_diff: selectedMr.git_diff,
          custom_api_key: customApiKey,
        }),
      });
      const data = await res.json();
      if (data.ok && data.request) {
        setRequests((prev) =>
          prev.map((item) =>
            item.id === data.request.id ? data.request : item
          )
        );
        showToast(
          "✨ AI Code Translator Diperbarui!",
          `Ringkasan bisnis ${selectedMr.mr_code} berhasil diregenerasi (${
            data.summary?.generatedBy === "gemini-api"
              ? "Google Gemini API Live"
              : "RAMA Hybrid AI Engine"
          }).`,
          "success"
        );
      }
    } catch (err) {
      console.error("Retranslate error:", err);
    } finally {
      setRetranslating(false);
    }
  };

  // Handler Reset Database Demo
  const handleResetDemo = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setUsers(data.users || []);
        setRequests(data.requests || []);
        const firstPending = (data.requests as MergeRequestItem[]).find(
          (r) => r.status === "Pending_PM"
        );
        if (firstPending) setSelectedMrId(firstPending.id);
        setActiveRole("PM");
        showToast(
          "🔄 Skenario Demo Direset!",
          "Seluruh data MergeRequests & ApprovalLogs di SQLite telah dikembalikan ke kondisi awal.",
          "info"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const totalLogsCount = useMemo(
    () => requests.reduce((acc, r) => acc + (r.logs?.length || 0), 0),
    [requests]
  );

  const stageCounts = useMemo(() => {
    const counts: Record<MRStatus, number> = {
      Pending_PM: 0,
      Pending_Core: 0,
      Pending_Interop: 0,
      Approved: 0,
      Rejected: 0,
    };
    requests.forEach((r) => {
      counts[r.status] = (counts[r.status] || 0) + 1;
    });
    return counts;
  }, [requests]);

  const canCurrentRoleApproveSelected = useMemo(() => {
    if (!selectedMr) return false;
    return WORKFLOW_STAGES[selectedMr.status]?.requiredRole === activeRole;
  }, [selectedMr, activeRole]);

  return (
    <div className="min-h-screen flex flex-col bg-[#060d1a] text-slate-100">
      {/* Top Notification Toast (Simulasi Notifikasi WA / Webhook Real-Time) */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div
            className={`rounded-2xl border p-4 shadow-2xl backdrop-blur-xl flex items-start gap-3.5 ${
              toastMessage.type === "success"
                ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-100"
                : toastMessage.type === "error"
                ? "bg-rose-950/90 border-rose-500/40 text-rose-100"
                : "bg-slate-900/95 border-amber-500/40 text-slate-100"
            }`}
          >
            <div className="mt-0.5">
              {toastMessage.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : toastMessage.type === "error" ? (
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
              ) : (
                <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
              )}
            </div>
            <div className="flex-1 text-xs leading-relaxed">
              <p className="font-bold text-sm mb-0.5">{toastMessage.title}</p>
              <p className="text-slate-300">{toastMessage.detail}</p>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* HEADER UTAMA RAMA BSI UII */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#071124]/90 backdrop-blur-xl">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Brand Logo & Title */}
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-blue-600 p-[1.5px] shadow-lg shadow-amber-500/10">
              <div className="w-full h-full bg-[#09152b] rounded-[10px] flex items-center justify-center">
                <GitMerge className="w-6 h-6 text-amber-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-amber-300 bg-clip-text text-transparent">
                  RAMA DASHBOARD
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  BSI UII • POC MVP
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                <strong className="text-slate-200">
                  Request, Align, Monitor, Approve
                </strong>{" "}
                — AI Release Orchestrator & Anti-Blind Approval Engine
              </p>
            </div>
          </div>

          {/* Action Buttons Kanan */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => openInjectModalWithPreset("qris-payment-gateway")}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
            >
              <Zap className="w-4 h-4 fill-slate-950" />
              <span>Suntikkan Git Diff (Simulasi Webhook)</span>
            </button>

            <button
              onClick={() => setShowApiKeyModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition-colors cursor-pointer"
              title="Konfigurasi Gemini API Key"
            >
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden md:inline">
                {customApiKey || serverHasGeminiKey
                  ? "Gemini API: Aktif"
                  : "Gemini Hybrid AI"}
              </span>
            </button>

            <button
              onClick={handleResetDemo}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800/90 hover:bg-slate-700/80 text-slate-300 border border-slate-700/80 transition-colors cursor-pointer"
              title="Reset Database ke Kondisi Awal Demo"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Reset Demo</span>
            </button>
          </div>
        </div>

        {/* BAR SIMULASI ROLE-BASED STATE MACHINE */}
        <div className="border-t border-slate-800/70 bg-[#0a1730]/90">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mr-1">
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                Simulasi Role Aktif:
              </span>
              {(["DEVELOPER", "PM", "CORE", "INTEROP"] as UserRole[]).map(
                (r) => {
                  const isActive = activeRole === r;
                  const meta = ROLE_METADATA[r];
                  const pendingCountForRole = meta.canApproveStatus
                    ? stageCounts[meta.canApproveStatus]
                    : 0;
                  return (
                    <button
                      key={r}
                      onClick={() => setActiveRole(r)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 border cursor-pointer ${
                        isActive
                          ? "bg-blue-600/25 text-white border-amber-400/80 shadow-sm shadow-amber-500/10"
                          : "bg-slate-900/70 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700"
                      }`}
                    >
                      <span>{meta.label}</span>
                      {pendingCountForRole > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-slate-950 font-extrabold">
                          {pendingCountForRole}
                        </span>
                      )}
                    </button>
                  );
                }
              )}
            </div>

            {/* Info User Aktif & Toggle Auto-Advance Demo */}
            <div className="flex items-center gap-4 text-xs">
              {activeUser && (
                <div className="hidden lg:flex items-center gap-2 text-slate-300">
                  <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[11px] font-bold flex items-center justify-center">
                    {activeUser.avatar}
                  </span>
                  <span>
                    Login sbg:{" "}
                    <strong className="text-white">{activeUser.name}</strong>{" "}
                    <span className="text-slate-400">
                      ({ROLE_METADATA[activeRole].layerName})
                    </span>
                  </span>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer select-none bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={autoAdvanceRole}
                  onChange={(e) => setAutoAdvanceRole(e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>Auto-Switch Role saat Approve (Mode Demo 1-Klik)</span>
              </label>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT CONTAINER */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* STATE MACHINE PIPELINE STEPPER & METRICS */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8 rounded-2xl border border-slate-800/90 bg-gradient-to-br from-[#0b1933] via-[#091428] to-[#081020] p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Arsitektur Role-Based State Machine (Kebijakan Deployment Berjenjang BSI UII)
                </h2>
              </div>
              <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Strict Gate Enforcement
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {KANBAN_COLUMNS.map((statusKey, idx) => {
                const st = WORKFLOW_STAGES[statusKey];
                const isRoleMatch = st.requiredRole === activeRole;
                return (
                  <div
                    key={statusKey}
                    className={`relative rounded-xl p-3 border transition-all ${
                      isRoleMatch
                        ? "bg-amber-500/10 border-amber-400/60 shadow-md shadow-amber-500/5"
                        : "bg-slate-900/70 border-slate-800/80"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span className="font-mono font-semibold text-amber-300/90">
                        STEP 0{idx + 1}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-bold text-xs">
                        {stageCounts[statusKey]} MR
                      </span>
                    </div>
                    <p className="font-bold text-xs text-white truncate">
                      {st.label}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Otoritas:{" "}
                      <strong className="text-slate-200">
                        {st.requiredRole || "GitLab Auto-Deploy"}
                      </strong>
                    </p>
                    {isRoleMatch && (
                      <span className="mt-1.5 inline-block text-[10px] font-semibold text-amber-300">
                        ● Layer Wewenang Anda
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ringkasan Dampak Solusi RAMA */}
          <div className="lg:col-span-4 rounded-2xl border border-slate-800/90 bg-gradient-to-br from-[#0e2144] to-[#091428] p-4 flex flex-col justify-between shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> Value Proposition RAMA
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                Zero Blind Approval
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 my-3">
              <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-2.5 text-center">
                <p className="text-lg font-extrabold text-white">3 Poin</p>
                <p className="text-[10px] text-slate-400">
                  Bahasa Bisnis AI Summary
                </p>
              </div>
              <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-2.5 text-center">
                <p className="text-lg font-extrabold text-amber-400">1-Klik</p>
                <p className="text-[10px] text-slate-400">
                  Mobile & Web Approval
                </p>
              </div>
              <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-2.5 text-center">
                <p className="text-lg font-extrabold text-emerald-400">
                  {totalLogsCount} Log
                </p>
                <p className="text-[10px] text-slate-400">
                  Jejak Audit SQLite
                </p>
              </div>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">
              Menggantikan diskusi manual di{" "}
              <span className="text-amber-300 font-semibold">Grup WhatsApp</span>{" "}
              & pembacaan ratusan baris{" "}
              <code className="text-sky-300">git diff</code> mentah dengan
              orkestrasi berjenjang yang transparan.
            </p>
          </div>
        </section>

        {/* NAVIGATION TABS & VIEW CONTROLS */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab("pipeline")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === "pipeline"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                  : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>1. Pipeline Tracker & Executive Inspector</span>
            </button>

            <button
              onClick={() => setActiveTab("mobile-approval")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === "mobile-approval"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                  : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>2. Mobile-Responsive Approval View (PM / Core)</span>
            </button>

            <button
              onClick={() => setActiveTab("audit-db")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === "audit-db"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                  : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              <Database className="w-4 h-4" />
              <span>3. Audit Trail & Tabel Relasional SQLite</span>
            </button>
          </div>

          {activeTab === "pipeline" && (
            <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setPipelineLayout("kanban")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                  pipelineLayout === "kanban"
                    ? "bg-slate-800 text-amber-300"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Kanban Board
              </button>
              <button
                onClick={() => setPipelineLayout("list")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                  pipelineLayout === "list"
                    ? "bg-slate-800 text-amber-300"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <ListFilter className="w-3.5 h-3.5" /> Tabel / List View
              </button>
            </div>
          )}
        </div>

        {/* =================================================================== */}
        {/* TAB 1: PIPELINE TRACKER (KANBAN / LIST) + AI SUMMARY SIDE PANEL     */}
        {/* =================================================================== */}
        {activeTab === "pipeline" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            {/* Kolom Kiri (7/12): Kanban atau List Pipeline */}
            <div className="xl:col-span-7 space-y-4">
              {pipelineLayout === "kanban" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {KANBAN_COLUMNS.map((colStatus) => {
                    const stageInfo = WORKFLOW_STAGES[colStatus];
                    const items = requests.filter(
                      (r) => r.status === colStatus
                    );
                    const isMyGate = stageInfo.requiredRole === activeRole;

                    return (
                      <div
                        key={colStatus}
                        className={`rounded-2xl border p-3.5 flex flex-col min-h-[340px] ${
                          isMyGate
                            ? "bg-[#0c1b36]/90 border-amber-500/40"
                            : "bg-[#091326]/90 border-slate-800/90"
                        }`}
                      >
                        {/* Column Header */}
                        <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-800/80">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-md border ${STATUS_BADGE_STYLES[colStatus]}`}
                              >
                                {colStatus}
                              </span>
                              <span className="text-xs font-bold text-slate-400">
                                ({items.length})
                              </span>
                            </div>
                            <p className="text-xs font-semibold text-slate-200 mt-1">
                              {stageInfo.label}
                            </p>
                          </div>
                          {isMyGate && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-slate-950">
                              Giliran Anda ({activeRole})
                            </span>
                          )}
                        </div>

                        {/* Cards inside column */}
                        <div className="space-y-3 flex-1">
                          {items.length === 0 ? (
                            <div className="h-44 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center text-center p-4 text-slate-500 text-xs">
                              <GitPullRequest className="w-6 h-6 mb-1.5 opacity-40" />
                              Tidak ada antrean rilis pada tahap{" "}
                              <span className="font-mono text-slate-400">
                                {colStatus}
                              </span>
                            </div>
                          ) : (
                            items.map((mr) => {
                              const isSelected = selectedMr?.id === mr.id;
                              const canApprove =
                                WORKFLOW_STAGES[mr.status]?.requiredRole ===
                                activeRole;

                              return (
                                <div
                                  key={mr.id}
                                  onClick={() => setSelectedMrId(mr.id)}
                                  className={`rounded-xl border p-3.5 transition-all cursor-pointer ${
                                    isSelected
                                      ? "bg-slate-900 border-amber-400 ring-1 ring-amber-400/40 shadow-lg"
                                      : "bg-slate-900/60 border-slate-800/90 hover:border-slate-700"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <span className="font-mono text-[11px] font-bold text-amber-300">
                                      {mr.mr_code} • {mr.version_tag}
                                    </span>
                                    <span
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                        RISK_BADGE_STYLES[mr.risk_level]
                                      }`}
                                    >
                                      RISK: {mr.risk_level}
                                    </span>
                                  </div>

                                  <h3 className="text-xs font-bold text-white leading-snug mb-1.5">
                                    {mr.title}
                                  </h3>

                                  {/* Mini AI Summary Preview */}
                                  <div className="rounded-lg bg-slate-950/80 border border-slate-800/80 p-2 mb-2.5">
                                    <div className="flex items-center gap-1 text-[10px] font-bold text-amber-300 mb-0.5">
                                      <Sparkles className="w-3 h-3" />
                                      <span>AI Ringkasan Bisnis:</span>
                                    </div>
                                    <p className="text-[11px] text-slate-300 line-clamp-2">
                                      {mr.ai_summary.headline}
                                    </p>
                                  </div>

                                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                                    <span className="truncate max-w-[160px] font-mono">
                                      {mr.repo_name}
                                    </span>
                                    <span>
                                      +{mr.ai_summary.linesAdded} / -
                                      {mr.ai_summary.linesRemoved} baris
                                    </span>
                                  </div>

                                  {/* One-Click Approve directly on Kanban card */}
                                  {canApprove ? (
                                    <div
                                      className="mt-3 pt-2.5 border-t border-slate-800 flex items-center gap-2"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        disabled={actionLoadingId === mr.id}
                                        onClick={() =>
                                          handleApprovalAction(mr, "APPROVE")
                                        }
                                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10 cursor-pointer"
                                      >
                                        <ThumbsUp className="w-3.5 h-3.5" />
                                        <span>
                                          1-Click Approve ({activeRole})
                                        </span>
                                      </button>
                                      <button
                                        disabled={actionLoadingId === mr.id}
                                        onClick={() =>
                                          handleApprovalAction(mr, "REJECT")
                                        }
                                        className="py-1.5 px-2.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-semibold text-xs cursor-pointer"
                                        title="Reject Request"
                                      >
                                        <ThumbsDown className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    mr.status !== "Approved" && (
                                      <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400">
                                        <span className="flex items-center gap-1">
                                          <Lock className="w-3 h-3 text-slate-500" />
                                          Menunggu role:{" "}
                                          <strong className="text-slate-200">
                                            {
                                              WORKFLOW_STAGES[mr.status]
                                                .requiredRole
                                            }
                                          </strong>
                                        </span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const reqRole =
                                              WORKFLOW_STAGES[mr.status]
                                                .requiredRole;
                                            if (reqRole) setActiveRole(reqRole);
                                            setSelectedMrId(mr.id);
                                          }}
                                          className="text-amber-400 hover:underline font-semibold cursor-pointer"
                                        >
                                          Pindah ke {WORKFLOW_STAGES[mr.status].requiredRole} →
                                        </button>
                                      </div>
                                    )
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* LIST VIEW */
                <div className="rounded-2xl border border-slate-800 bg-[#091326] overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-400 uppercase text-[10px]">
                        <th className="py-3 px-4">Kode MR</th>
                        <th className="py-3 px-4">Judul & AI Headline</th>
                        <th className="py-3 px-4">Risiko</th>
                        <th className="py-3 px-4">Status Gate</th>
                        <th className="py-3 px-4 text-right">Aksi Cepat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {requests.map((mr) => {
                        const canApprove =
                          WORKFLOW_STAGES[mr.status]?.requiredRole ===
                          activeRole;
                        return (
                          <tr
                            key={mr.id}
                            onClick={() => setSelectedMrId(mr.id)}
                            className={`hover:bg-slate-800/40 cursor-pointer ${
                              selectedMr?.id === mr.id ? "bg-slate-800/60" : ""
                            }`}
                          >
                            <td className="py-3 px-4 font-mono font-bold text-amber-300 whitespace-nowrap">
                              {mr.mr_code}
                            </td>
                            <td className="py-3 px-4">
                              <p className="font-bold text-white">{mr.title}</p>
                              <p className="text-slate-400 text-[11px]">
                                ✨ {mr.ai_summary.headline}
                              </p>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  RISK_BADGE_STYLES[mr.risk_level]
                                }`}
                              >
                                {mr.risk_level}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border ${
                                  STATUS_BADGE_STYLES[mr.status]
                                }`}
                              >
                                {mr.status}
                              </span>
                            </td>
                            <td
                              className="py-3 px-4 text-right whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {canApprove ? (
                                <button
                                  onClick={() =>
                                    handleApprovalAction(mr, "APPROVE")
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs cursor-pointer"
                                >
                                  Approve ({activeRole})
                                </button>
                              ) : (
                                <span className="text-slate-500 text-[11px]">
                                  {WORKFLOW_STAGES[mr.status]?.requiredRole
                                    ? `Wewenang ${WORKFLOW_STAGES[mr.status].requiredRole}`
                                    : "Final"}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Jika ada MR yang berstatus Rejected, tampilkan bar khusus di bawah Kanban */}
              {stageCounts.Rejected > 0 && (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-rose-300 flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      Daftar Pengajuan Ditolak / Revisi (Rejected:{" "}
                      {stageCounts.Rejected})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {requests
                      .filter((r) => r.status === "Rejected")
                      .map((mr) => (
                        <div
                          key={mr.id}
                          onClick={() => setSelectedMrId(mr.id)}
                          className="rounded-xl bg-slate-900/90 border border-rose-500/40 p-3 flex items-center justify-between gap-3 cursor-pointer"
                        >
                          <div>
                            <p className="text-xs font-bold text-white">
                              {mr.mr_code} — {mr.title}
                            </p>
                            <p className="text-[11px] text-rose-300">
                              Dikembalikan ke Developer untuk perbaikan
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveRole("DEVELOPER");
                              handleApprovalAction(mr, "REOPEN");
                            }}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs shrink-0 cursor-pointer"
                          >
                            Ajukan Ulang
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Kolom Kanan (5/12): DETAIL PENGAJUAN & ✨ AI SUMMARY CARD (THE SECRET SAUCE) */}
            <div className="xl:col-span-5">
              {selectedMr && (
                <div className="rounded-2xl border border-slate-800 bg-[#0b172e] shadow-2xl overflow-hidden sticky top-28">
                  {/* Top Header Detail */}
                  <div className="p-4 bg-gradient-to-r from-[#102347] via-[#0d1c38] to-[#0b172e] border-b border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-extrabold px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {selectedMr.mr_code}
                        </span>
                        <span
                          className={`text-xs font-bold px-2.5 py-0.5 rounded-md border ${
                            STATUS_BADGE_STYLES[selectedMr.status]
                          }`}
                        >
                          {WORKFLOW_STAGES[selectedMr.status].label}
                        </span>
                      </div>

                      <button
                        onClick={() => setActiveTab("mobile-approval")}
                        className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-1 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-700 cursor-pointer"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        <span>Buka Mode Mobile PM</span>
                      </button>
                    </div>

                    <h2 className="text-sm sm:text-base font-extrabold text-white leading-snug">
                      {selectedMr.title}
                    </h2>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-300">
                      <span className="flex items-center gap-1 font-mono text-sky-300">
                        <GitBranch className="w-3.5 h-3.5" />
                        {selectedMr.source_branch} ➔ {selectedMr.target_branch}
                      </span>
                      <span>•</span>
                      <span>Oleh: {selectedMr.author_name}</span>
                    </div>
                  </div>

                  {/* ✨ AI SUMMARY CARD (3 POIN BAHASA BISNIS / MANUSIA) */}
                  <div className="p-4 space-y-4 max-h-[calc(100vh-250px)] overflow-y-auto">
                    <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-slate-900/95 to-blue-950/40 p-4 shadow-inner">
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-amber-300" />
                          </div>
                          <div>
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                              ✨ AI Code Translator Card
                            </h3>
                            <p className="text-[10px] text-slate-400">
                              Terjemahan Otomatis Git Diff ke Bahasa Bisnis (
                              {selectedMr.ai_summary.generatedBy ===
                              "gemini-api"
                                ? "Google Gemini 2.5 Flash"
                                : "RAMA Hybrid Gemini Engine"}
                              )
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={handleRetranslateSelected}
                          disabled={retranslating}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-amber-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
                          title="Analisis ulang git diff dengan AI"
                        >
                          <Bot
                            className={`w-3.5 h-3.5 ${
                              retranslating ? "animate-spin" : ""
                            }`}
                          />
                          <span>
                            {retranslating ? "Meringkas..." : "Re-Translate AI"}
                          </span>
                        </button>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/90 mb-3">
                        <p className="text-xs font-bold text-white">
                          “{selectedMr.ai_summary.headline}”
                        </p>
                      </div>

                      {/* 3 POIN UTAMA BAHASA MANUSIA */}
                      <div className="space-y-3 text-xs">
                        {/* Poin 1: Fitur & Nilai Bisnis */}
                        <div className="rounded-xl bg-emerald-950/25 border border-emerald-500/30 p-3">
                          <p className="font-bold text-emerald-300 flex items-center gap-1.5 mb-1.5">
                            <Rocket className="w-3.5 h-3.5" />
                            1. Fitur & Dampak Bisnis (Bahasa Manusia)
                          </p>
                          <ul className="space-y-1 text-slate-200 list-disc list-inside text-[11px] leading-relaxed">
                            {selectedMr.ai_summary.businessImpact.map(
                              (pt, i) => (
                                <li key={i}>{pt}</li>
                              )
                            )}
                          </ul>
                        </div>

                        {/* Poin 2: Perbaikan Bug & Teknis */}
                        <div className="rounded-xl bg-sky-950/25 border border-sky-500/30 p-3">
                          <p className="font-bold text-sky-300 flex items-center gap-1.5 mb-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            2. Bug Fix & Penyempurnaan Teknis Inti
                          </p>
                          <ul className="space-y-1 text-slate-200 list-disc list-inside text-[11px] leading-relaxed">
                            {selectedMr.ai_summary.technicalFixes.map(
                              (pt, i) => (
                                <li key={i}>{pt}</li>
                              )
                            )}
                          </ul>
                        </div>

                        {/* Poin 3: Risiko & Mitigasi */}
                        <div className="rounded-xl bg-amber-950/25 border border-amber-500/30 p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="font-bold text-amber-300 flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              3. Analisis Risiko & Kesiapan Mitigasi
                            </p>
                            <span
                              className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                                RISK_BADGE_STYLES[selectedMr.risk_level]
                              }`}
                            >
                              {selectedMr.risk_level} RISK
                            </span>
                          </div>
                          <ul className="space-y-1 text-slate-200 list-disc list-inside text-[11px] leading-relaxed">
                            {selectedMr.ai_summary.riskAnalysis.map((pt, i) => (
                              <li key={i}>{pt}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Metadata Baris & Estimasi Downtime */}
                      <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span>
                          Estimasi Downtime:{" "}
                          <strong className="text-emerald-300">
                            {selectedMr.ai_summary.estimatedDowntime}
                          </strong>
                        </span>
                        <span>
                          Cakupan:{" "}
                          <strong className="text-slate-200">
                            {selectedMr.ai_summary.filesChanged} file (+
                            {selectedMr.ai_summary.linesAdded} / -
                            {selectedMr.ai_summary.linesRemoved})
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* PANEL EKSEKUSI ONE-CLICK APPROVAL */}
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-amber-400" />
                          Keputusan Gate ({selectedMr.status})
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Role Aktif:{" "}
                          <strong className="text-amber-300">
                            {activeRole}
                          </strong>
                        </span>
                      </div>

                      {canCurrentRoleApproveSelected ? (
                        <div className="space-y-2.5">
                          <input
                            type="text"
                            value={approvalComment}
                            onChange={(e) => setApprovalComment(e.target.value)}
                            placeholder={`Catatan opsional sebagai ${activeRole} (misal: Lanjutkan ke gate berikutnya)...`}
                            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                          />
                          <div className="flex items-center gap-2.5">
                            <button
                              disabled={actionLoadingId === selectedMr.id}
                              onClick={() =>
                                handleApprovalAction(selectedMr, "APPROVE")
                              }
                              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer"
                            >
                              <ThumbsUp className="w-4 h-4" />
                              <span>
                                APPROVE & LANJUTKAN KE{" "}
                                {
                                  WORKFLOW_STAGES[selectedMr.status]
                                    .nextStatusOnApprove
                                }
                              </span>
                            </button>
                            <button
                              disabled={actionLoadingId === selectedMr.id}
                              onClick={() =>
                                handleApprovalAction(selectedMr, "REJECT")
                              }
                              className="py-2.5 px-4 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <ThumbsDown className="w-4 h-4" />
                              <span>Reject</span>
                            </button>
                          </div>
                        </div>
                      ) : selectedMr.status === "Approved" ? (
                        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-200 flex items-center gap-2.5">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                          <div>
                            <p className="font-bold">
                              Seluruh Layer Telah Menyetujui (Siap Rilis /
                              Deployed)
                            </p>
                            <p className="text-[11px] text-emerald-300/80">
                              GitLab CI/CD Pipeline telah menerima sinyal merge
                              otomatis dari RAMA.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex items-center justify-between gap-3">
                          <div className="text-xs">
                            <p className="font-semibold text-amber-300 flex items-center gap-1.5">
                              <Lock className="w-3.5 h-3.5" />
                              Gate Dikunci oleh Role-Based State Machine
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Tahap <strong>{selectedMr.status}</strong> hanya
                              dapat disetujui oleh role{" "}
                              <strong className="text-white">
                                {
                                  WORKFLOW_STAGES[selectedMr.status]
                                    .requiredRole
                                }
                              </strong>
                              .
                            </p>
                          </div>
                          {WORKFLOW_STAGES[selectedMr.status].requiredRole && (
                            <button
                              onClick={() =>
                                setActiveRole(
                                  WORKFLOW_STAGES[selectedMr.status]
                                    .requiredRole!
                                )
                              }
                              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 cursor-pointer"
                            >
                              Simulasikan Role{" "}
                              {WORKFLOW_STAGES[selectedMr.status].requiredRole}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Riwayat Audit Singkat MR Ini */}
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5">
                      <p className="text-xs font-bold text-slate-300 mb-2.5 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        Jejak Audit Persetujuan ({selectedMr.logs.length} Aktivitas)
                      </p>
                      <div className="space-y-2">
                        {selectedMr.logs.map((log) => (
                          <div
                            key={log.id}
                            className="text-[11px] border-l-2 border-amber-500/50 pl-2.5 py-0.5"
                          >
                            <div className="flex items-center justify-between text-slate-400">
                              <span className="font-bold text-slate-200">
                                {log.user_name} ({log.role_at_action})
                              </span>
                              <span className="font-mono text-[10px]">
                                {log.from_status} ➔ {log.to_status}
                              </span>
                            </div>
                            <p className="text-slate-300 mt-0.5">
                              {log.comment}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: MOBILE-RESPONSIVE APPROVAL VIEW & BLIND APPROVAL COMPARISON  */}
        {/* =================================================================== */}
        {activeTab === "mobile-approval" && selectedMr && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Kiri (5/12): SIMULATOR SMARTPHONE EKSEKUTIF (PM / CORE MOBILE VIEW) */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <div className="mb-2 text-center">
                <span className="text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  📱 Mobile-Responsive Approval View (Tampilan HP PM / Manajer)
                </span>
              </div>

              {/* Frame Smartphone */}
              <div className="w-full max-w-[390px] rounded-[38px] border-[8px] border-slate-800 bg-[#071022] shadow-2xl overflow-hidden flex flex-col">
                {/* Notch / Speaker Bar */}
                <div className="bg-slate-950 py-2 px-6 flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800/80">
                  <span className="font-bold text-slate-200">09:41 WIB</span>
                  <div className="w-20 h-3.5 rounded-full bg-slate-900 border border-slate-800" />
                  <span>5G • 100%</span>
                </div>

                {/* Simulasi Banner Link dari Notifikasi WA Bot RAMA */}
                <div className="bg-emerald-950/70 border-b border-emerald-500/30 px-3.5 py-2 flex items-center gap-2.5">
                  <MessageSquareMore className="w-4 h-4 text-emerald-400 shrink-0" />
                  <p className="text-[11px] text-emerald-200 leading-tight">
                    <strong>RAMA Bot Notifier:</strong> Pengajuan{" "}
                    <span className="font-mono underline">
                      {selectedMr.mr_code}
                    </span>{" "}
                    menunggu persetujuan 1-Klik Anda.
                  </p>
                </div>

                {/* Isi Layar Mobile */}
                <div className="p-4 space-y-3.5 flex-1">
                  {/* Selector MR Cepat di Mobile */}
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={selectedMr.id}
                      onChange={(e) => setSelectedMrId(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-amber-300 focus:outline-none"
                    >
                      {requests.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.mr_code} [{r.status}] — {r.title.slice(0, 38)}...
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Card Header Pengajuan */}
                  <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                          STATUS_BADGE_STYLES[selectedMr.status]
                        }`}
                      >
                        {selectedMr.status}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          RISK_BADGE_STYLES[selectedMr.risk_level]
                        }`}
                      >
                        RISIKO: {selectedMr.risk_level}
                      </span>
                    </div>
                    <h3 className="text-xs font-extrabold text-white leading-snug">
                      {selectedMr.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 font-mono">
                      {selectedMr.repo_name} ({selectedMr.version_tag})
                    </p>
                  </div>

                  {/* ✨ AI SUMMARY CARD DI MOBILE */}
                  <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-b from-amber-500/15 to-slate-900/95 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold text-amber-300 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> ✨ AI Summary Card
                      </span>
                      <span className="text-[10px] text-emerald-300 font-semibold">
                        ⏱ {selectedMr.ai_summary.estimatedDowntime}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-white bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                      {selectedMr.ai_summary.headline}
                    </p>

                    <div className="space-y-2 text-[11px]">
                      <div>
                        <p className="font-bold text-emerald-300">
                          🎯 1. Fitur & Manfaat Bisnis:
                        </p>
                        <p className="text-slate-200 mt-0.5">
                          {selectedMr.ai_summary.businessImpact[0]}
                        </p>
                      </div>

                      <div>
                        <p className="font-bold text-sky-300">
                          🔧 2. Perbaikan Teknis & Bug Fix:
                        </p>
                        <p className="text-slate-200 mt-0.5">
                          {selectedMr.ai_summary.technicalFixes[0]}
                        </p>
                      </div>

                      <div>
                        <p className="font-bold text-amber-300">
                          ⚠️ 3. Risiko & Mitigasi:
                        </p>
                        <p className="text-slate-200 mt-0.5">
                          {selectedMr.ai_summary.riskAnalysis[0]}
                        </p>
                      </div>
                    </div>

                    {/* Toggle Lihat Raw Git Diff jika penasaran */}
                    <button
                      onClick={() =>
                        setShowRawDiffInMobile(!showRawDiffInMobile)
                      }
                      className="w-full py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[10px] font-semibold text-slate-400 hover:text-white flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Code2 className="w-3 h-3" />
                      <span>
                        {showRawDiffInMobile
                          ? "Sembunyikan Kode Mentah Git Diff"
                          : `Lihat Raw Git Diff (+${selectedMr.ai_summary.linesAdded} baris)`}
                      </span>
                    </button>

                    {showRawDiffInMobile && (
                      <pre className="p-2 rounded-lg bg-black text-[9px] font-mono text-emerald-300 overflow-x-auto max-h-36">
                        {selectedMr.git_diff}
                      </pre>
                    )}
                  </div>

                  {/* TOMBOL ONE-CLICK ACTION MOBILE */}
                  <div className="pt-1">
                    {WORKFLOW_STAGES[selectedMr.status]?.requiredRole &&
                      WORKFLOW_STAGES[selectedMr.status]?.requiredRole !==
                        activeRole && (
                        <button
                          onClick={() =>
                            setActiveRole(
                              WORKFLOW_STAGES[selectedMr.status].requiredRole!
                            )
                          }
                          className="w-full mb-2 py-1.5 px-3 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[11px] font-bold cursor-pointer"
                        >
                          Klik untuk Beralih ke Role{" "}
                          {WORKFLOW_STAGES[selectedMr.status].requiredRole}{" "}
                          terlebih dahulu
                        </button>
                      )}

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        disabled={
                          !canCurrentRoleApproveSelected ||
                          actionLoadingId === selectedMr.id
                        }
                        onClick={() =>
                          handleApprovalAction(selectedMr, "APPROVE")
                        }
                        className="py-3 px-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 cursor-pointer"
                      >
                        <ThumbsUp className="w-4 h-4" />
                        <span>Approve</span>
                      </button>

                      <button
                        disabled={
                          !canCurrentRoleApproveSelected ||
                          actionLoadingId === selectedMr.id
                        }
                        onClick={() =>
                          handleApprovalAction(selectedMr, "REJECT")
                        }
                        className="py-3 px-3 rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 disabled:opacity-40 text-rose-300 border border-rose-500/40 font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <ThumbsDown className="w-4 h-4" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bottom Home Indicator */}
                <div className="py-2.5 bg-slate-950 flex justify-center">
                  <div className="w-28 h-1 rounded-full bg-slate-700" />
                </div>
              </div>
            </div>

            {/* Kanan (7/12): KONTRAS "BEFORE (BLIND APPROVAL)" VS "AFTER (RAMA AI)" */}
            <div className="lg:col-span-7 space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-[#0b172e] p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400">
                      Masalah Sebelumnya: &ldquo;The Missing Link & Blind Approvals&rdquo;
                    </span>
                    <h3 className="text-base font-extrabold text-white mt-0.5">
                      Mengapa Manajer Non-Teknis Kesulitan Menyetujui Rilis Tanpa RAMA?
                    </h3>
                  </div>
                  <FileCode2 className="w-6 h-6 text-rose-400" />
                </div>

                <p className="text-xs text-slate-300 leading-relaxed mb-3">
                  Sebelum adanya <strong>RAMA Dashboard</strong>, approver di
                  level manajerial hanya menerima tautan <code>git diff</code>{" "}
                  mentah seperti di bawah ini lewat Grup WhatsApp. Karena sulit
                  dipahami secara cepat, terjadilah{" "}
                  <strong className="text-rose-300">Blind Approval</strong>{" "}
                  (asal setuju) atau justru antrean rilis macet berhari-hari.
                </p>

                {/* Raw Git Diff View */}
                <div className="rounded-xl border border-slate-800 bg-[#050a14] overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-[11px]">
                    <span className="font-mono text-slate-300 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-amber-400" />
                      Raw GitLab Diff ({selectedMr.mr_code})
                    </span>
                    <span className="text-rose-400 font-semibold">
                      Sulit Dipahami Non-Teknis
                    </span>
                  </div>
                  <pre className="p-4 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[320px] text-slate-300">
                    {selectedMr.git_diff.split("\n").map((line, idx) => {
                      let color = "text-slate-300";
                      if (line.startsWith("+") && !line.startsWith("+++"))
                        color = "text-emerald-400 bg-emerald-950/30";
                      else if (line.startsWith("-") && !line.startsWith("---"))
                        color = "text-rose-400 bg-rose-950/30";
                      else if (line.startsWith("@@")) color = "text-sky-400";
                      return (
                        <div key={idx} className={`${color} px-1`}>
                          {line}
                        </div>
                      );
                    })}
                  </pre>
                </div>

                {/* Stepper Pergerakan Langsung untuk Demo Juri */}
                <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs">
                    <p className="font-bold text-white">
                      Ingin Mendemokan Pergerakan Instan ke Juri?
                    </p>
                    <p className="text-slate-400 text-[11px]">
                      Klik tombol Approve pada simulator HP di sebelah kiri
                      untuk memindahkan status{" "}
                      <strong className="text-amber-300">
                        {selectedMr.mr_code}
                      </strong>{" "}
                      secara langsung!
                    </p>
                  </div>
                  <button
                    onClick={() => openInjectModalWithPreset("qris-payment-gateway")}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Suntikkan Skenario Git Diff Baru</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: AUDIT TRAIL & RELATIONAL DATABASE EXPLORER (SQLite)          */}
        {/* =================================================================== */}
        {activeTab === "audit-db" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Tabel Users (4/12) */}
              <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#091326] overflow-hidden">
                <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Tabel SQLite: <code>Users</code> ({users.length} Role)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400">
                    db/rama.db
                  </span>
                </div>
                <div className="divide-y divide-slate-800/70">
                  {users.map((u) => (
                    <div
                      key={u.id}
                      className="p-3.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-amber-300">
                          {u.avatar}
                        </div>
                        <div>
                          <p className="font-bold text-white">{u.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {u.title}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          ROLE_METADATA[u.role].badgeColor
                        }`}
                      >
                        {u.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabel ApprovalLogs (8/12) */}
              <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#091326] overflow-hidden">
                <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Tabel SQLite: <code>ApprovalLogs</code> (Real-Time Audit
                      Trail)
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Total {totalLogsCount} Transisi Tercatat
                  </span>
                </div>

                <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800/70">
                  {requests
                    .flatMap((r) =>
                      r.logs.map((l) => ({ ...l, mr_code: r.mr_code }))
                    )
                    .sort((a, b) => b.id - a.id)
                    .map((log) => (
                      <div
                        key={log.id}
                        className="p-3.5 text-xs flex items-start justify-between gap-4 hover:bg-slate-900/50"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-amber-300">
                              {log.mr_code}
                            </span>
                            <span className="font-bold text-white">
                              {log.user_name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-sky-300">
                              {log.role_at_action}
                            </span>
                            <span className="text-[11px] font-mono text-emerald-300">
                              {log.from_status} ➔ {log.to_status}
                            </span>
                          </div>
                          <p className="text-slate-300 text-[11px]">
                            {log.comment}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ===================================================================== */}
      {/* MODAL 1: SUNTIKKAN GIT DIFF KOMPLEKS (DEMO SKENARIO PENGAJUAN BARU)   */}
      {/* ===================================================================== */}
      {showInjectModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-[#0a162c] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Zap className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-extrabold text-white">
                    Suntikkan GitLab Merge Request & Raw Git Diff (Simulasi Webhook)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Pilih preset skenario BSI UII atau tempelkan{" "}
                    <code>git diff</code> kustom untuk diterjemahkan oleh AI Code
                    Translator
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowInjectModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleCreateMergeRequest}
              className="p-5 space-y-4 max-h-[82vh] overflow-y-auto"
            >
              {/* Preset Selector */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-1.5">
                  Pilih Preset Skenario Kompleks (1-Klik Isi Otomatis):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {scenarios.map((sc) => (
                    <button
                      type="button"
                      key={sc.key}
                      onClick={() => {
                        setInjectTitle(sc.title);
                        setInjectRepo(sc.repo_name);
                        setInjectBranch(sc.source_branch);
                        setInjectVersion(sc.version_tag);
                        setInjectDiff(sc.git_diff);
                      }}
                      className={`text-left p-2.5 rounded-xl border text-xs transition-all cursor-pointer ${
                        injectTitle === sc.title
                          ? "bg-amber-500/15 border-amber-400 text-white"
                          : "bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <span className="text-[10px] font-extrabold text-amber-400 block">
                        {sc.badge}
                      </span>
                      <span className="font-semibold line-clamp-1">
                        {sc.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Judul Merge Request GitLab
                  </label>
                  <input
                    type="text"
                    required
                    value={injectTitle}
                    onChange={(e) => setInjectTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tag Versi Rilis
                  </label>
                  <input
                    type="text"
                    value={injectVersion}
                    onChange={(e) => setInjectVersion(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Repositori Layanan BSI UII
                  </label>
                  <input
                    type="text"
                    value={injectRepo}
                    onChange={(e) => setInjectRepo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Source Branch
                  </label>
                  <input
                    type="text"
                    value={injectBranch}
                    onChange={(e) => setInjectBranch(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Payload Raw <code>git diff</code> (Akan Dicegat & Diringkas
                    oleh Gemini AI)
                  </label>
                  <span className="text-[11px] text-amber-300">
                    Otomatis masuk ke status: <strong>Pending_PM</strong>
                  </span>
                </div>
                <textarea
                  rows={8}
                  required
                  value={injectDiff}
                  onChange={(e) => setInjectDiff(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInjectModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={injectSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs flex items-center gap-2 shadow-lg cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {injectSubmitting
                      ? "Menerjemahkan Git Diff dengan AI..."
                      : "Terjemahkan dengan AI & Kirim ke Antrean PM"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: KONFIGURASI GEMINI API KEY (HYBRID MODE)                     */}
      {/* ===================================================================== */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0a162c] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-extrabold text-white">
                  Mode Hybrid Gemini API (AI Code Translator)
                </h3>
              </div>
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Secara bawaan, RAMA dilengkapi{" "}
              <strong className="text-amber-300">
                Smart Hybrid AI Diff Engine
              </strong>{" "}
              sehingga demo di hadapan juri dijamin berjalan{" "}
              <strong>100% instan & anti-gagal</strong> meskipun tanpa koneksi
              internet. Jika Anda ingin menggunakan{" "}
              <strong>Google Gemini 2.5 Flash API Live</strong>, masukkan{" "}
              <code>GEMINI_API_KEY</code> di bawah ini:
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Google Gemini API Key (Opsional)
              </label>
              <input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setCustomApiKey("");
                  localStorage.removeItem("RAMA_GEMINI_API_KEY");
                  setShowApiKeyModal(false);
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Gunakan Hybrid Engine Bawaan
              </button>
              <button
                onClick={() => {
                  localStorage.setItem("RAMA_GEMINI_API_KEY", customApiKey);
                  setShowApiKeyModal(false);
                  showToast(
                    "Konfigurasi AI Disimpan",
                    customApiKey
                      ? "Gemini API Key aktif! Klik 'Re-Translate AI' atau suntikkan diff baru."
                      : "Menggunakan RAMA Hybrid AI Engine.",
                    "success"
                  );
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs cursor-pointer"
              >
                Simpan Konfigurasi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
