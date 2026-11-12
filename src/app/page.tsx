"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Code2,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  History,
  Info,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import { ApprovalLog, ReleaseRequest, ReleaseStatus, RiskLevel, User } from "@/lib/types";
import { evaluateRisk, parseChangedFiles } from "@/lib/risk-engine";
import {
  canDecide,
  LAYERS,
  REQUIRED_ROLE_BY_STATUS,
  ROLE_LABEL,
  STATUS_HINT,
  STATUS_LABEL,
} from "@/lib/workflow";
import {
  browserCreateRelease,
  browserDecide,
  browserGetDashboard,
  browserRegenerateSummary,
  browserResetDemo,
  browserResubmit,
} from "@/lib/browser-store";
import {
  AiSummaryBlock,
  DecisionError,
  DecisionPanel,
  DeveloperQuestions,
  EmptyColumn,
  LOG_ACTION_META,
  LogActionChip,
  MiniStepper,
  MrLayerList,
  RiskBadge,
  RollbackPlan,
  RuleFlags,
  StatusBadge,
  formatTime,
  useNow,
  waitingText,
} from "@/components/rama";

interface PresetOption {
  key: string;
  label: string;
  badge: string;
  judul: string;
  modul: string;
  repo: string;
  feature_branch: string;
  rollback_plan: string;
  git_diff: string;
}

const BOARD_GROUPS: { status: ReleaseStatus; dot: string }[] = [
  { status: "Pending_PM", dot: "bg-amber-400" },
  { status: "Pending_Core", dot: "bg-violet-500" },
  { status: "Pending_Interop", dot: "bg-sky-500" },
  { status: "Perlu_Revisi", dot: "bg-rose-500" },
  { status: "Approved", dot: "bg-emerald-500" },
];

const STATUS_PLAIN_MAP: Record<string, string> = {
  Draft_GitLab: "Draf di GitLab",
  Pending_PM: "Menunggu Project Manager",
  Pending_Core: "Menunggu Tim Core",
  Pending_Interop: "Menunggu Tim Interoperability",
  Approved: "Dirilis (simulasi)",
  Perlu_Revisi: "Perlu revisi",
  DITOLAK_SISTEM: "Ditolak sistem",
};

const USER_ROLE_SUMMARY: Record<string, string> = {
  DEVELOPER: "Mengajukan rilis dan memperbaiki revisi",
  PM: "Menilai prioritas dan dampak ke pengguna",
  CORE: "Memeriksa arsitektur, database, dan rollback",
  INTEROP: "Memeriksa integrasi luar dan merilis ke production",
};

const ACTIVE_USER_KEY = "RAMA_ACTIVE_USER_ID";
const API_KEY_STORAGE = "RAMA_GEMINI_API_KEY";
const IS_BROWSER_DEMO = process.env.NEXT_PUBLIC_RAMA_STATIC === "1";

type Toast = { title: string; detail?: string; tone: "success" | "error" | "info" };

function extractArea(modul: string): string {
  return (modul.split("·")[0] || modul).trim();
}

async function fetchDashboard(): Promise<ReturnType<typeof browserGetDashboard>> {
  const res = await fetch("/api/releases", { cache: "no-store" });
  if (!res.ok) throw new Error(`API demo mengembalikan HTTP ${res.status}`);
  return res.json();
}

async function postDemo(url: string, body: Record<string, unknown>): Promise<{ status: number | null; data: Record<string, any> }> {
  if (!IS_BROWSER_DEMO) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { status: res.status, data };
    } catch {
      return { status: null, data: { error: "Respons dari API demo tidak tersedia. Muat ulang untuk memeriksa status terbaru." } };
    }
  }

  if (url === "/api/demo/reset") return { status: 200, data: browserResetDemo() };
  if (url === "/api/releases") return browserCreateRelease(body);
  const match = url.match(/^\/api\/releases\/(\d+)\/(decision|resubmit|summary)$/);
  if (!match) return { status: 404, data: { error: "Aksi simulasi tidak ditemukan." } };
  const id = Number(match[1]);
  if (match[2] === "decision") return browserDecide(id, body);
  if (match[2] === "resubmit") return browserResubmit(id, body);
  return browserRegenerateSummary(id, body);
}

function failureTitle(status: number | null) {
  if (status === null) return "API demo tidak tersedia";
  return IS_BROWSER_DEMO ? `Ditolak oleh aturan demo · kode simulasi ${status}` : `Ditolak di server · HTTP ${status}`;
}

export default function RamaPage() {
  const now = useNow();
  const [users, setUsers] = useState<User[]>([]);
  const [releases, setReleases] = useState<ReleaseRequest[]>([]);
  const [logs, setLogs] = useState<ApprovalLog[]>([]);
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [serverHasKey, setServerHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [activeUserId, setActiveUserId] = useState<number>(2);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<"pipeline" | "mobile" | "audit">("pipeline");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<DecisionError | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Filter state for Papan rilis
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [riskFilter, setRiskFilter] = useState<"ALL" | RiskLevel>("ALL");
  const [stageFilter, setStageFilter] = useState<"ALL" | ReleaseStatus>("ALL");
  const [areaFilter, setAreaFilter] = useState<string>("ALL");
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);

  // Filter state for Riwayat keputusan
  const [auditReleaseFilter, setAuditReleaseFilter] = useState<string>("ALL");
  const [auditActionFilter, setAuditActionFilter] = useState<string>("ALL");

  const [apiKey, setApiKey] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showMrList, setShowMrList] = useState(false);

  const activeUser = users.find((u) => u.id === activeUserId);
  const selected = releases.find((r) => r.id === selectedId) ?? releases[0];
  const aiEnabled = Boolean(apiKey || serverHasKey);

  const notify = useCallback((t: Toast) => {
    setToast(t);
    setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 5000);
  }, []);

  const load = useCallback(async () => {
    try {
      const data: ReturnType<typeof browserGetDashboard> = IS_BROWSER_DEMO ? browserGetDashboard() : await fetchDashboard();
      setUsers(data.users);
      setReleases(data.releases);
      setLogs(data.logs);
      setPresets(data.presets);
      setServerHasKey(data.geminiConfigured);
      setSelectedId((id) => id ?? (data.releases.find((r) => r.status === "Pending_PM") ?? data.releases[0])?.id ?? null);
      setLoadError(false);
      return data.releases;
    } catch {
      setLoadError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedUser = Number(localStorage.getItem(ACTIVE_USER_KEY));
    if (savedUser) setActiveUserId(savedUser);
    setApiKey(localStorage.getItem(API_KEY_STORAGE) || "");
    void load();
  }, [load]);

  useEffect(() => {
    if (!showFilterPopover) return;
    const onDown = (e: MouseEvent) => {
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(e.target as Node)) {
        setShowFilterPopover(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowFilterPopover(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showFilterPopover]);

  const switchUser = (id: number) => {
    setActiveUserId(id);
    setDecisionError(null);
    localStorage.setItem(ACTIVE_USER_KEY, String(id));
  };

  function reportDecisionError(releaseId: number, status: number | null, data: Record<string, any>) {
    const title = failureTitle(status);
    const error = data.error || "Keputusan tidak dapat diproses.";
    setDecisionError({ releaseId, title, error, logged: Boolean(data.release) });
    notify({ title, detail: error, tone: "error" });
  }

  async function decide(release: ReleaseRequest, action: "APPROVE" | "REJECT", note: string, opts?: { omitLayer?: boolean }) {
    setBusy(true);
    setDecisionError(null);
    const layer = { Pending_PM: 2, Pending_Core: 3, Pending_Interop: 4 }[release.status as string];
    const { status, data } = await postDemo(`/api/releases/${release.id}/decision`, {
      actor_id: activeUserId,
      action,
      note,
      ...(opts?.omitLayer ? {} : { layer }),
    });
    await load();
    setBusy(false);
    if (status === null || status >= 400) {
      reportDecisionError(release.id, status, data);
    } else {
      notify({
        title: action === "APPROVE" ? `${release.kode} disetujui` : `${release.kode} dikembalikan ke developer`,
        detail: data.message,
        tone: action === "APPROVE" ? "success" : "info",
      });
    }
  }

  async function resubmit(release: ReleaseRequest, note: string) {
    setBusy(true);
    setDecisionError(null);
    const { status, data } = await postDemo(`/api/releases/${release.id}/resubmit`, { actor_id: activeUserId, note });
    await load();
    setBusy(false);
    if (status === null || status >= 400) {
      reportDecisionError(release.id, status, data);
    } else {
      notify({ title: `${release.kode} diajukan ulang ke Project Manager`, detail: data.message, tone: "success" });
    }
  }

  async function regenerate(release: ReleaseRequest, overrideKey?: string) {
    setRegenerating(true);
    const keyToUse = (overrideKey ?? apiKey).trim();
    const { status, data } = await postDemo(`/api/releases/${release.id}/summary`, { api_key: keyToUse || undefined });
    await load();
    setRegenerating(false);
    if (status === null || status >= 400) {
      notify({ title: failureTitle(status), detail: data.error, tone: "error" });
    } else {
      notify({
        title: "Penjelasan singkat AI",
        detail: data.message,
        tone: data.release?.ai_source === "gemini" ? "success" : "error",
      });
    }
  }

  async function resetDemo() {
    setLoading(true);
    const { status, data } = await postDemo("/api/demo/reset", {});
    if (status === null || status >= 400) {
      setLoading(false);
      notify({ title: failureTitle(status), detail: data.error, tone: "error" });
      return;
    }
    const list = await load();
    setDecisionError(null);
    if (list) setSelectedId((list.find((r) => r.status === "Pending_PM") ?? list[0])?.id ?? null);
    notify({ title: "Data demo dikembalikan ke awal.", tone: "info" });
  }

  const decisionProps = (r: ReleaseRequest) => ({
    release: r,
    user: activeUser,
    busy: busy || loadError,
    decisionError,
    onDecide: (action: "APPROVE" | "REJECT", note: string) => decide(r, action, note),
    onResubmit: (note: string) => resubmit(r, note),
    onSelfApproveTest: () => decide(r, "APPROVE", "Saya setujui sendiri saja.", { omitLayer: true }),
  });

  // -------------------------------------------------------------------------
  // Derived counts & filters
  // -------------------------------------------------------------------------

  const counts = useMemo(() => {
    const c: Record<ReleaseStatus, number> = {
      Pending_PM: 0,
      Pending_Core: 0,
      Pending_Interop: 0,
      Approved: 0,
      Perlu_Revisi: 0,
    };
    releases.forEach((r) => (c[r.status] += 1));
    return c;
  }, [releases]);

  const isReleaseForUser = useCallback(
    (r: ReleaseRequest, u: User | undefined) => {
      if (!u) return false;
      if (u.role === "DEVELOPER") return r.status === "Perlu_Revisi" && r.author_id === u.id;
      return canDecide(r, u).allowed;
    },
    []
  );

  const myQueueCount = (u: User) => releases.filter((r) => isReleaseForUser(r, u)).length;
  const activeUserQueue = useMemo(() => releases.filter((r) => isReleaseForUser(r, activeUser)), [releases, activeUser, isReleaseForUser]);

  const areas = useMemo(() => Array.from(new Set(releases.map((r) => extractArea(r.modul)))).sort(), [releases]);

  const visibleReleases = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return releases.filter((r) => {
      if (onlyMine && !isReleaseForUser(r, activeUser)) return false;
      if (riskFilter !== "ALL" && r.risk_level !== riskFilter) return false;
      if (stageFilter !== "ALL" && r.status !== stageFilter) return false;
      if (areaFilter !== "ALL" && extractArea(r.modul) !== areaFilter) return false;
      if (term) {
        const hay = `${r.kode} ${r.judul} ${r.modul} ${r.repo}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [releases, searchQuery, onlyMine, riskFilter, stageFilter, areaFilter, activeUser, isReleaseForUser]);

  const activeFilterCount =
    (riskFilter !== "ALL" ? 1 : 0) + (stageFilter !== "ALL" ? 1 : 0) + (areaFilter !== "ALL" ? 1 : 0);

  const filteredLogs = useMemo(() => {
    return [...logs]
      .reverse()
      .filter((l) => {
        if (auditReleaseFilter !== "ALL" && l.release_kode !== auditReleaseFilter) return false;
        if (auditActionFilter !== "ALL" && l.action !== auditActionFilter) return false;
        return true;
      });
  }, [logs, auditReleaseFilter, auditActionFilter]);

  if (loading && releases.length === 0) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Memuat data simulasi…</div>;
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-ink">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm">
          <div
            className={`flex items-start gap-3 rounded-2xl border p-3.5 text-xs shadow-xl backdrop-blur ${
              toast.tone === "success"
                ? "border-emerald-200 bg-white text-ink"
                : toast.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-slate-200 bg-white text-ink"
            }`}
          >
            <div className="flex-1">
              <p className="font-bold">{toast.title}</p>
              {toast.detail && <p className="mt-0.5 text-slate-600">{toast.detail}</p>}
            </div>
            <button onClick={() => setToast(null)} className="text-slate-400 hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-200">
              <GitBranch className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight text-ink">RAMA</h1>
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-200">
                  Mode simulasi · data contoh
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                Pantau dan setujui rilis aplikasi secara berjenjang di BSI UII
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 sm:text-sm"
            >
              <GitPullRequest className="h-4 w-4" /> Simulasikan pengajuan baru
            </button>
            <button
              onClick={() => setShowKeyModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 sm:text-sm"
            >
              <Sparkles className={`h-4 w-4 ${aiEnabled ? "text-brand-600" : "text-amber-500"}`} />
              {aiEnabled ? "AI: Gemini aktif" : "AI: pasang API key"}
            </button>
            <button
              onClick={resetDemo}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 sm:text-sm"
            >
              <RotateCcw className={`h-4 w-4 text-slate-500 ${loading ? "animate-spin" : ""}`} /> Reset demo
            </button>
          </div>
        </div>

        {/* Role switcher ("Anda masuk sebagai") */}
        <div className="border-t border-slate-100 bg-[#f8fafc]/80">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2.5 px-4 py-3 sm:px-6">
            <span className="mr-1 text-xs font-medium text-slate-500 sm:text-sm">Anda masuk sebagai</span>
            {users.map((u) => {
              const active = u.id === activeUserId;
              const q = myQueueCount(u);
              const shortName = u.name.replace(/ \(.*\)/, "");
              return (
                <button
                  key={u.id}
                  onClick={() => switchUser(u.id)}
                  className={`flex items-center gap-2.5 rounded-full border px-3 py-1.5 text-left transition ${
                    active
                      ? "border-brand-600 bg-white ring-2 ring-brand-600/20 shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {u.avatar}
                  </span>
                  <div className="leading-tight">
                    <p className="text-xs font-bold text-ink">{shortName}</p>
                    <p className="text-[11px] text-slate-500">{ROLE_LABEL[u.role]}</p>
                  </div>
                  {q > 0 && (
                    <span
                      title={`${q} menunggu tindakan`}
                      className="ml-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-400 px-1.5 text-[11px] font-extrabold text-slate-950"
                    >
                      {q}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-6">
        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-900"
          >
            Data demo gagal dimuat. Coba ambil status terbaru sebelum memutuskan.
            <button onClick={() => void load()} className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-ink shadow-sm">
              Muat ulang data
            </button>
          </div>
        )}

        {/* Contextual Urgent Notification Banner */}
        {activeUser && activeUserQueue.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs text-ink sm:text-sm">
            <div className="flex items-center gap-2.5">
              <Info className="h-4 w-4 shrink-0 text-amber-600" />
              <p>
                <strong className="font-bold">
                  {activeUser.name.replace(/ \(.*\)/, "")}, ada {activeUserQueue.length} rilis yang menunggu keputusan Anda.
                </strong>{" "}
                <span className="text-slate-700">{activeUserQueue[0].judul}.</span>
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedId(activeUserQueue[0].id);
                setDecisionError(null);
                setTab("pipeline");
              }}
              className="rounded-xl border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-amber-50"
            >
              Buka sekarang
            </button>
          </div>
        )}

        {/* 4-Stage Process Overview ("Alur persetujuan: 4 tahap") */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-ink">Alur persetujuan: 4 tahap</h2>
              <p className="text-xs text-slate-500 sm:text-sm">
                Setiap perubahan harus disetujui berurutan oleh orang yang berwenang.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <ShieldCheck className="h-4 w-4 text-slate-400" />
              {IS_BROWSER_DEMO ? "Wewenang dicek aturan demo" : "Wewenang dicek di server"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LAYERS.map((l) => {
              const isMine = activeUser?.role === l.role;
              const count = l.status ? counts[l.status] : null;
              return (
                <div
                  key={l.layer}
                  className={`flex flex-col justify-between rounded-2xl border p-4 transition ${
                    isMine ? "border-brand-600 bg-brand-50/20 ring-1 ring-brand-600/20" : "border-slate-200 bg-white"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          isMine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {l.layer}
                      </span>
                      <p className="text-sm font-bold text-ink">{l.title}</p>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">{l.plain}</p>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        {l.layer === 1
                          ? "Otomatis saat diajukan"
                          : count && count > 0
                          ? `${count} menunggu`
                          : "Tidak ada antrean"}
                      </span>
                      {isMine && <span className="font-bold text-brand-600">Tahap Anda</span>}
                    </div>
                    <div className="mt-2.5 border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-400">
                      {l.source} → {l.target}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Main Navigation Tabs */}
        <nav className="flex flex-wrap gap-6 border-b border-slate-200">
          {[
            { id: "pipeline", label: "Papan rilis", icon: ClipboardList },
            { id: "mobile", label: "Tampilan HP approver", icon: Smartphone },
            { id: "audit", label: "Riwayat keputusan", icon: History },
          ].map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id as typeof tab)}
                className={`inline-flex items-center gap-2 border-b-2 pb-3 text-xs font-semibold transition sm:text-sm ${
                  active
                    ? "border-brand-600 text-brand-600"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-ink"
                }`}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </nav>

        {/* ================= TAB 1: PAPAN RILIS ================= */}
        {tab === "pipeline" && (
          <div className="space-y-4">
            {/* Search & Filter Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari rilis"
                    className="w-56 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-ink placeholder:text-slate-400 focus:border-brand-600 focus:outline-none sm:w-64 sm:text-sm"
                  />
                </div>

                {/* Semua / Giliran saya segmented toggle */}
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setOnlyMine(false)}
                    className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                      !onlyMine ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"
                    }`}
                  >
                    Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyMine(true)}
                    className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                      onlyMine ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"
                    }`}
                  >
                    Giliran saya · {activeUserQueue.length}
                  </button>
                </div>

                {/* Filter Popover Button */}
                <div className="relative" ref={filterPopoverRef}>
                  <button
                    type="button"
                    onClick={() => setShowFilterPopover((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      activeFilterCount > 0
                        ? "border-brand-600 bg-brand-50 text-brand-700"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filter
                    {activeFilterCount > 0 && (
                      <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>

                  {showFilterPopover && (
                    <div className="absolute left-0 top-full z-30 mt-2 w-80 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
                      <div>
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Risiko</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              { id: "ALL", label: "Semua risiko", count: releases.length },
                              { id: "HIGH", label: "Tinggi", count: releases.filter((r) => r.risk_level === "HIGH").length },
                              { id: "MEDIUM", label: "Sedang", count: releases.filter((r) => r.risk_level === "MEDIUM").length },
                              { id: "LOW", label: "Rendah", count: releases.filter((r) => r.risk_level === "LOW").length },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setRiskFilter(opt.id)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                                riskFilter === opt.id
                                  ? "bg-brand-600 text-white"
                                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {opt.label}
                              <span
                                className={`rounded-full px-1.5 text-[10px] ${
                                  riskFilter === opt.id ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {opt.count}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Tahap</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              { id: "ALL", label: "Semua" },
                              { id: "Pending_PM", label: "Menunggu Project Manager" },
                              { id: "Pending_Core", label: "Menunggu Tim Core" },
                              { id: "Pending_Interop", label: "Menunggu Tim Interoperability" },
                              { id: "Perlu_Revisi", label: "Perlu revisi" },
                              { id: "Approved", label: "Dirilis (simulasi)" },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setStageFilter(opt.id)}
                              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                stageFilter === opt.id
                                  ? "bg-brand-600 text-white"
                                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Bidang</p>
                        <div className="flex flex-wrap gap-1.5">
                          {["ALL", ...areas].map((a) => (
                            <button
                              key={a}
                              type="button"
                              onClick={() => setAreaFilter(a)}
                              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                areaFilter === a
                                  ? "bg-brand-600 text-white"
                                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {a === "ALL" ? "Semua" : a}
                            </button>
                          ))}
                        </div>
                      </div>

                      {activeFilterCount > 0 && (
                        <div className="border-t border-slate-100 pt-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setRiskFilter("ALL");
                              setStageFilter("ALL");
                              setAreaFilter("ALL");
                            }}
                            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                          >
                            Reset filter
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-500">
                <strong className="font-bold text-ink">{visibleReleases.length}</strong> dari {releases.length} rilis
              </p>
            </div>

            {/* Kanban Columns + Right Inspector */}
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-7">
                {BOARD_GROUPS.map(({ status, dot }) => {
                  const items = visibleReleases.filter((r) => r.status === status);
                  return (
                    <div
                      key={status}
                      className={`rounded-2xl border border-slate-200 bg-white/80 p-3.5 shadow-[0_1px_2px_rgba(15,27,51,0.03)] ${
                        status === "Approved" ? "md:col-span-2" : ""
                      }`}
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                            <h3 className="text-sm font-bold text-ink">{STATUS_LABEL[status]}</h3>
                          </div>
                          <p className="mt-0.5 pl-4 text-xs text-slate-500">{STATUS_HINT[status]}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 ring-1 ring-inset ring-slate-200">
                          {items.length}
                        </span>
                      </div>

                      <div className={`gap-2.5 ${status === "Approved" ? "grid md:grid-cols-2" : "space-y-2.5"}`}>
                        {items.length === 0 && <EmptyColumn label={`Tidak ada rilis pada tahap ini`} />}
                        {items.map((r) => {
                          const isSel = selected?.id === r.id;
                          const myTurn = isReleaseForUser(r, activeUser);
                          return (
                            <button
                              key={r.id}
                              onClick={() => {
                                setSelectedId(r.id);
                                setDecisionError(null);
                              }}
                              className={`block w-full rounded-2xl border p-3.5 text-left transition ${
                                isSel
                                  ? "border-brand-600 bg-white ring-2 ring-brand-600/15 shadow-sm"
                                  : "border-slate-200 bg-white hover:border-slate-300"
                              }`}
                            >
                              <div className="mb-1.5 flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-bold text-slate-500">{r.kode}</span>
                                <RiskBadge level={r.risk_level} />
                              </div>
                              <p className="text-sm font-bold leading-snug text-ink">{r.judul}</p>
                              <p className="mt-1 text-xs text-slate-500">{r.modul}</p>
                              <p className="mt-0.5 font-mono text-[11px] text-slate-400">{r.repo}</p>

                              <div className="mt-3">
                                <MiniStepper release={r} />
                              </div>

                              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs text-slate-500">{waitingText(r, now)}</span>
                                {myTurn && (
                                  <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
                                    Giliran Anda
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Inspector Panel */}
              {selected && (
                <aside className="space-y-3.5 xl:sticky xl:top-6 xl:col-span-5">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-500">{selected.kode}</span>
                      <StatusBadge status={selected.status} />
                      <RiskBadge level={selected.risk_level} />
                    </div>
                    <h2 className="mt-2 text-base font-extrabold leading-snug text-ink">{selected.judul}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {selected.modul} · diajukan {selected.author_name.replace(/ \(.*\)/, "")}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-400">{selected.repo}</p>

                    <div className="mt-3.5">
                      <MiniStepper release={selected} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{waitingText(selected, now)}</p>
                  </div>

                  <DecisionPanel {...decisionProps(selected)} />
                  <RuleFlags release={selected} />
                  <AiSummaryBlock
                    release={selected}
                    canRegenerate={aiEnabled}
                    regenerating={regenerating}
                    onRegenerate={() => regenerate(selected)}
                    onConfigureKey={() => setShowKeyModal(true)}
                  />
                  <DeveloperQuestions release={selected} />
                  <RollbackPlan release={selected} />

                  {/* Collapsible MR per Tahap & Diff */}
                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
                    <button
                      type="button"
                      onClick={() => setShowMrList((v) => !v)}
                      className="flex w-full items-center justify-between text-xs font-bold text-ink"
                    >
                      <span>Detail MR per tahap (4 branch simulasi)</span>
                      <span className="text-[11px] font-semibold text-brand-600">
                        {showMrList ? "Sembunyikan" : "Tampilkan"}
                      </span>
                    </button>
                    {showMrList && (
                      <div className="mt-3">
                        <MrLayerList release={selected} />
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
                    <button
                      type="button"
                      onClick={() => setShowDiff((v) => !v)}
                      className="flex w-full items-center justify-between text-xs font-bold text-ink"
                    >
                      <span className="flex items-center gap-1.5">
                        <Code2 className="h-4 w-4 text-brand-600" /> Diff kode ({selected.changed_files.length} file, rahasia disamarkan)
                      </span>
                      <span className="text-[11px] font-semibold text-brand-600">
                        {showDiff ? "Sembunyikan" : "Tampilkan"}
                      </span>
                    </button>
                    {showDiff && <DiffView diff={selected.git_diff} />}
                  </section>
                </aside>
              )}
            </div>
          </div>
        )}

        {/* ================= TAB 2: TAMPILAN HP APPROVER ================= */}
        {tab === "mobile" && selected && (
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
            <div>
              <p className="mb-3 text-center text-xs text-slate-500 sm:text-sm">
                Tampilan di HP approver · masuk sebagai{" "}
                <strong className="font-bold text-ink">{activeUser?.name.replace(/ \(.*\)/, "")}</strong> (
                {activeUser && ROLE_LABEL[activeUser.role]})
              </p>

              <div className="mx-auto w-full max-w-[23rem] rounded-[2.5rem] border-[10px] border-ink bg-ink shadow-xl shadow-slate-300">
                <div className="flex h-[46rem] flex-col overflow-hidden rounded-[1.9rem] bg-[#f6f8fc]">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                    <span className="text-sm font-extrabold text-ink">RAMA</span>
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                      Simulasi
                    </span>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
                    <select
                      aria-label="Pilih rilis"
                      value={selected.id}
                      onChange={(e) => {
                        setSelectedId(Number(e.target.value));
                        setDecisionError(null);
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-ink shadow-sm focus:border-brand-600 focus:outline-none"
                    >
                      {releases.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.kode} · {STATUS_LABEL[r.status]}
                        </option>
                      ))}
                    </select>

                    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={selected.status} />
                        <RiskBadge level={selected.risk_level} />
                      </div>
                      <p className="text-sm font-bold text-ink">{selected.judul}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{selected.modul}</p>
                      <div className="mt-2.5">
                        <MiniStepper release={selected} />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{waitingText(selected, now)}</p>
                    </div>

                    <DecisionPanel {...decisionProps(selected)} />
                    <RuleFlags release={selected} compact />
                    <AiSummaryBlock
                      release={selected}
                      compact
                      canRegenerate={aiEnabled}
                      regenerating={regenerating}
                      onRegenerate={() => regenerate(selected)}
                      onConfigureKey={() => setShowKeyModal(true)}
                    />
                    <DeveloperQuestions release={selected} />
                    <RollbackPlan release={selected} />
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: "Tanpa RAMA" comparison */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
              <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                Tanpa RAMA
              </span>
              <h3 className="mt-2 text-lg font-bold text-ink">
                Approver non-teknis hanya menerima kode mentah lewat WhatsApp
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Di sebelah kiri, approver melihat tanda risiko yang bisa ditelusuri ke file tertentu, ringkasan bantuan AI dengan label jelas, dan pertanyaan yang perlu diajukan ke developer. Keputusan tetap di tangan penanggung jawab tahap.
              </p>

              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  <Code2 className="h-4 w-4 text-slate-400" />
                  <span className="font-mono">{selected.kode} · diff (rahasia disamarkan)</span>
                </div>
                <DiffView diff={selected.git_diff} tall />
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 3: RIWAYAT KEPUTUSAN ================= */}
        {tab === "audit" && (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
                <div>
                  <h3 className="text-sm font-bold text-ink">Riwayat keputusan</h3>
                  <p className="text-xs text-slate-500">
                    {filteredLogs.length} dari {logs.length} catatan · tidak bisa diubah · sumber: simulasi
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filter rilis"
                    value={auditReleaseFilter}
                    onChange={(e) => setAuditReleaseFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink focus:border-brand-600 focus:outline-none"
                  >
                    <option value="ALL">Semua rilis</option>
                    {releases.map((r) => (
                      <option key={r.id} value={r.kode}>
                        {r.kode}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter aksi"
                    value={auditActionFilter}
                    onChange={(e) => setAuditActionFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink focus:border-brand-600 focus:outline-none"
                  >
                    <option value="ALL">Semua aksi</option>
                    {Object.entries(LOG_ACTION_META).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Waktu</th>
                      <th className="px-4 py-3">Rilis</th>
                      <th className="px-4 py-3">Tahap</th>
                      <th className="px-4 py-3">Pelaku</th>
                      <th className="px-4 py-3">Aksi</th>
                      <th className="px-4 py-3">Perubahan status</th>
                      <th className="px-4 py-3">Catatan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredLogs.map((l) => (
                      <tr key={l.id} className={l.action === "BLOCKED" ? "bg-rose-50/50" : "hover:bg-slate-50/50"}>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatTime(l.created_at)}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono font-bold text-ink">{l.release_kode}</td>
                        <td className="px-4 py-3 text-slate-600">{l.layer ?? "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="font-semibold text-ink">{l.user_name.replace(/ \(.*\)/, "")}</div>
                          <div className="text-[11px] text-slate-500">{ROLE_LABEL[l.role_at_action]}</div>
                        </td>
                        <td className="px-4 py-3">
                          <LogActionChip log={l} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-1.5 text-xs text-slate-700">
                            <span>{STATUS_PLAIN_MAP[l.from_status] ?? l.from_status}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                            <span className={`font-semibold ${l.to_status === "DITOLAK_SISTEM" ? "text-rose-700" : "text-ink"}`}>
                              {STATUS_PLAIN_MAP[l.to_status] ?? l.to_status}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                            {l.from_status} → {l.to_status}
                          </div>
                        </td>
                        <td className="min-w-[280px] px-4 py-3 leading-relaxed text-slate-600">{l.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* "Siapa saja yang terlibat" User Roster */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
              <h3 className="mb-3 text-sm font-bold text-ink">Siapa saja yang terlibat</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {users.map((u) => (
                  <div key={u.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-200">
                        {u.avatar}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-ink">{u.name.replace(/ \(.*\)/, "")}</p>
                        <p className="text-[11px] text-slate-500">{u.title}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">{USER_ROLE_SUMMARY[u.role]}</p>
                    <span className="mt-2 inline-flex rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                      {ROLE_LABEL[u.role]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {showCreate && users.length > 0 && (
        <CreateReleaseModal
          presets={presets}
          actor={activeUser ?? users[0]}
          developerUser={users.find((u) => u.role === "DEVELOPER") ?? users[0]}
          apiKey={apiKey}
          onClose={() => setShowCreate(false)}
          onCreated={async (r) => {
            setShowCreate(false);
            await load();
            setSelectedId(r.id);
            setTab("pipeline");
            notify({
              title: `Rilis baru ${r.kode} masuk dari GitLab (simulasi).`,
              detail: `Risiko: ${r.risk_level} (dihitung dari aturan tetap).`,
              tone: "success",
            });
          }}
        />
      )}

      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md space-y-3.5 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
                <Sparkles className="h-4 w-4 text-brand-600" /> Pengaturan Gemini AI (Penjelasan Singkat)
              </h3>
              <button onClick={() => setShowKeyModal(false)} className="text-slate-400 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-slate-600">
              <li>
                Penjelasan singkat dibuat langsung oleh <strong>Gemini AI</strong> (<code>gemini-3.5-flash-lite</code> /{" "}
                <code>gemini-3.1-flash-lite</code>), dibatasi ke ringkasan perubahan, dampak bagi pengguna, dan pertanyaan untuk developer.
              </li>
              <li>
                Tidak menggunakan contoh teks statis: penjelasan hanya muncul setelah di-generate dengan API key Gemini Anda.
              </li>
              <li>
                Penanda risiko otomatis (<code>Risiko tinggi</code> / <code>Risiko sedang</code> / <code>Risiko rendah</code>) selalu dihitung dari aturan tetap, bukan AI.
              </li>
            </ul>
            {serverHasKey && <p className="text-xs font-medium text-emerald-700">GEMINI_API_KEY sudah terpasang di server.</p>}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AQ.… atau AIza… (disimpan di browser ini saja)"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs text-ink focus:border-brand-600 focus:bg-white focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setApiKey("");
                  localStorage.removeItem(API_KEY_STORAGE);
                  setShowKeyModal(false);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hapus key
              </button>
              <button
                onClick={() => {
                  const trimmed = apiKey.trim();
                  setApiKey(trimmed);
                  localStorage.setItem(API_KEY_STORAGE, trimmed);
                  setShowKeyModal(false);
                  if (trimmed && selected && !selected.ai_summary) {
                    void regenerate(selected, trimmed);
                  }
                }}
                className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                Simpan & Buat Ringkasan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffView({ diff, tall = false }: { diff: string; tall?: boolean }) {
  return (
    <pre
      className={`mt-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3 font-mono text-[11px] leading-relaxed ${
        tall ? "max-h-[560px]" : "max-h-72"
      }`}
    >
      {diff.split("\n").map((line, i) => {
        let cls = "text-slate-600";
        if (line.includes("[DISAMARKAN-R4]")) cls = "bg-rose-100 text-rose-800 font-semibold";
        else if (line.startsWith("+") && !line.startsWith("+++")) cls = "bg-emerald-50 text-emerald-800";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "bg-rose-50 text-rose-800";
        else if (line.startsWith("@@")) cls = "text-sky-700 font-medium";
        else if (line.startsWith("diff --git")) cls = "text-ink font-bold";
        return (
          <div key={i} className={`px-1.5 py-0.5 ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function CreateReleaseModal({
  presets,
  actor,
  developerUser,
  apiKey,
  onClose,
  onCreated,
}: {
  presets: PresetOption[];
  actor: User;
  developerUser: User;
  apiKey: string;
  onClose: () => void;
  onCreated: (r: ReleaseRequest) => void;
}) {
  const [presetKey, setPresetKey] = useState<string>(presets[0]?.key ?? "");
  const initial = presets[0];
  const [judul, setJudul] = useState(initial?.judul ?? "");
  const [modul, setModul] = useState(initial?.modul ?? "");
  const [repo, setRepo] = useState(initial?.repo ?? "");
  const [branch, setBranch] = useState(initial?.feature_branch ?? "feature/");
  const [rollback, setRollback] = useState(initial?.rollback_plan ?? "");
  const [diff, setDiff] = useState(initial?.git_diff ?? "");
  const [useDeveloperActor, setUseDeveloperActor] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => evaluateRisk(parseChangedFiles(diff), diff), [diff]);

  const applyPreset = (p: PresetOption) => {
    setPresetKey(p.key);
    setJudul(p.judul);
    setModul(p.modul);
    setRepo(p.repo);
    setBranch(p.feature_branch);
    setRollback(p.rollback_plan);
    setDiff(p.git_diff);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const effectiveActorId = actor.role === "DEVELOPER" || !useDeveloperActor ? actor.id : developerUser.id;
    const payload = {
      actor_id: effectiveActorId,
      judul,
      modul,
      repo,
      feature_branch: branch,
      rollback_plan: rollback,
      git_diff: diff,
      preset_key: presetKey || undefined,
      api_key: apiKey || undefined,
    };
    const { status, data } = await postDemo("/api/releases", payload);
    setSubmitting(false);
    if (status === null || status >= 400) return setError(`${failureTitle(status)}. ${data.error || "Gagal membuat rilis."}`);
    onCreated(data.release as ReleaseRequest);
  }

  const input =
    "mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ink focus:border-brand-600 focus:bg-white focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <GitPullRequest className="h-4 w-4 text-brand-600" /> Simulasikan pengajuan baru dari GitLab
            </h3>
            <p className="text-xs text-slate-500">
              Tahap 1 (feature/* → develop) selesai saat diajukan. RAMA membuat rilis baru dan membuka Tahap 2 untuk Project Manager.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="grid max-h-[80vh] grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-5">
          <div className="space-y-3.5 lg:col-span-3">
            {actor.role !== "DEVELOPER" && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                <span>
                  Anda masuk sebagai <strong>{ROLE_LABEL[actor.role]}</strong>. Pengajuan rilis dilakukan oleh{" "}
                  <strong>Developer ({developerUser.name})</strong>.
                </span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold">
                  <input
                    type="checkbox"
                    checked={useDeveloperActor}
                    onChange={(e) => setUseDeveloperActor(e.target.checked)}
                    className="rounded border-amber-300"
                  />
                  Ajukan sebagai {developerUser.name}
                </label>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-xs font-bold text-ink">Pilih skenario perubahan contoh</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {presets.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => applyPreset(p)}
                    className={`rounded-xl border p-2.5 text-left text-xs transition ${
                      presetKey === p.key
                        ? "border-brand-600 bg-brand-50/60 font-semibold text-ink ring-1 ring-brand-600/20"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span className="block font-mono text-[10px] font-bold text-brand-600">{p.badge}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Judul perubahan
                <input required value={judul} onChange={(e) => setJudul(e.target.value)} className={input} />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Bidang · Modul
                <input value={modul} onChange={(e) => setModul(e.target.value)} className={input} />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Repositori
                <input value={repo} onChange={(e) => setRepo(e.target.value)} className={`${input} font-mono`} />
              </label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Branch tahap 1 (feature/* → develop)
                <input value={branch} onChange={(e) => setBranch(e.target.value)} className={`${input} font-mono`} />
              </label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Rencana pembatalan <span className="text-slate-400">(diisi developer)</span>
                <textarea value={rollback} onChange={(e) => setRollback(e.target.value)} rows={2} className={input} />
              </label>
            </div>

            <label className="block text-xs font-medium text-slate-600">
              Git diff
              <textarea
                required
                value={diff}
                onChange={(e) => setDiff(e.target.value)}
                rows={9}
                className={`${input} font-mono text-[11px]`}
              />
            </label>
          </div>

          <div className="space-y-3.5 lg:col-span-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold text-ink">Pratinjau penanda risiko otomatis</p>
                <RiskBadge level={preview.level} size="md" />
              </div>
              <ul className="space-y-1.5">
                {preview.triggeredRules.map((r, i) => (
                  <li key={i} className="text-xs text-slate-600">
                    <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink ring-1 ring-slate-200">
                      {r.id}
                    </span>{" "}
                    · {r.file ? <span className="break-all font-mono text-[11px]">{r.file}</span> : r.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11px] text-slate-500">
                Dihitung dari aturan tetap, bukan AI. Ubah diff untuk melihat penanda berubah secara langsung.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
              <p className="mb-1.5 font-bold text-ink">Yang akan terjadi saat diajukan</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Aturan tetap menghitung tingkat risiko dari daftar file dan pola diff.</li>
                <li>Kredensial/rahasia di diff disamarkan sebelum disimpan dan dikirim ke AI.</li>
                <li>Rilis baru masuk ke kolom <strong>Menunggu Project Manager</strong> (Tahap 2).</li>
                <li>Jika API key Gemini terpasang, penjelasan singkat AI dibuat secara langsung.</li>
              </ol>
            </div>

            {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Ajukan Rilis Baru
            </button>

            <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <FlaskConical className="h-3.5 w-3.5" /> Data simulasi. Tidak terhubung ke GitLab produksi BSI UII.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
