"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Code2,
  Database,
  FlaskConical,
  GitMerge,
  GitPullRequest,
  KeyRound,
  LayoutGrid,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Terminal,
  UserCircle2,
  X,
} from "lucide-react";
import { ApprovalLog, ReleaseRequest, ReleaseStatus, User } from "@/lib/types";
import { evaluateRisk, parseChangedFiles } from "@/lib/risk-engine";
import { canDecide, LAYERS, REQUIRED_ROLE_BY_STATUS, ROLE_LABEL, STATUS_LABEL } from "@/lib/workflow";
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
  DecisionPanel,
  DeveloperQuestions,
  EmptyColumn,
  LogActionChip,
  MiniStepper,
  MrLayerList,
  RiskBadge,
  RollbackPlan,
  RuleFlags,
  ServerError,
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

const PIPELINE_COLUMNS: ReleaseStatus[] = ["Pending_PM", "Pending_Core", "Pending_Interop", "Approved"];
const ACTIVE_USER_KEY = "RAMA_ACTIVE_USER_ID";
const API_KEY_STORAGE = "RAMA_GEMINI_API_KEY";

type Toast = { title: string; detail?: string; tone: "success" | "error" | "info" };

export default function RamaPage() {
  const now = useNow();
  const [users, setUsers] = useState<User[]>([]);
  const [releases, setReleases] = useState<ReleaseRequest[]>([]);
  const [logs, setLogs] = useState<ApprovalLog[]>([]);
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [serverHasKey, setServerHasKey] = useState(false);
  const [loading, setLoading] = useState(true);

  const [activeUserId, setActiveUserId] = useState<number>(2);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<"pipeline" | "mobile" | "audit">("pipeline");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const activeUser = users.find((u) => u.id === activeUserId);
  const selected = releases.find((r) => r.id === selectedId) ?? releases[0];
  const aiEnabled = Boolean(apiKey || serverHasKey);

  const notify = useCallback((t: Toast) => {
    setToast(t);
    setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 5000);
  }, []);

  const load = useCallback(async () => {
    let data: ReturnType<typeof browserGetDashboard>;
    try {
      const res = await fetch("/api/releases", { cache: "no-store" });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        data = await res.json();
      } else {
        data = browserGetDashboard();
      }
    } catch {
      data = browserGetDashboard();
    }
    setUsers(data.users);
    setReleases(data.releases);
    setLogs(data.logs);
    setPresets(data.presets);
    setServerHasKey(Boolean(data.geminiConfigured));
    setLoading(false);
    return data.releases as ReleaseRequest[];
  }, []);

  useEffect(() => {
    const savedUser = Number(localStorage.getItem(ACTIVE_USER_KEY));
    if (savedUser) setActiveUserId(savedUser);
    setApiKey(localStorage.getItem(API_KEY_STORAGE) || "");
    load().then((list) => {
      const first = list.find((r) => r.status === "Pending_PM") ?? list[0];
      if (first) setSelectedId(first.id);
    });
  }, [load]);

  const switchUser = (id: number) => {
    setActiveUserId(id);
    setServerError(null);
    localStorage.setItem(ACTIVE_USER_KEY, String(id));
  };

  // -------------------------------------------------------------------------
  // Aksi (semua lewat API; server yang memutuskan boleh/tidak)
  // -------------------------------------------------------------------------

  async function post(url: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, any> }> {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status !== 404 && res.status !== 405 && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
      }
    } catch {
      // Fallback to browser simulation store on static Cloudflare hosting
    }
    if (url === "/api/demo/reset") return { status: 200, data: browserResetDemo() };
    if (url === "/api/releases") return browserCreateRelease(body);
    const decMatch = url.match(/^\/api\/releases\/(\d+)\/decision$/);
    if (decMatch) return browserDecide(Number(decMatch[1]), body);
    const resubMatch = url.match(/^\/api\/releases\/(\d+)\/resubmit$/);
    if (resubMatch) return browserResubmit(Number(resubMatch[1]), body);
    const sumMatch = url.match(/^\/api\/releases\/(\d+)\/summary$/);
    if (sumMatch) return browserRegenerateSummary(Number(sumMatch[1]), body);
    return { status: 404, data: { error: "Endpoint tidak ditemukan." } };
  }

  async function decide(release: ReleaseRequest, action: "APPROVE" | "REJECT", note: string, opts?: { omitLayer?: boolean }) {
    setBusy(true);
    setServerError(null);
    const layer = { Pending_PM: 2, Pending_Core: 3, Pending_Interop: 4 }[release.status as string];
    const { status, data } = await post(`/api/releases/${release.id}/decision`, {
      actor_id: activeUserId,
      action,
      note,
      ...(opts?.omitLayer ? {} : { layer }),
    });
    await load();
    setBusy(false);
    if (status >= 400) {
      setServerError({ releaseId: release.id, httpStatus: status, error: data.error || "Ditolak server." });
      notify({ title: `Server menolak (HTTP ${status})`, detail: data.error, tone: "error" });
    } else {
      notify({ title: action === "APPROVE" ? "Disetujui" : "Ditolak · Perlu revisi", detail: data.message, tone: action === "APPROVE" ? "success" : "info" });
    }
  }

  async function resubmit(release: ReleaseRequest, note: string) {
    setBusy(true);
    setServerError(null);
    const { status, data } = await post(`/api/releases/${release.id}/resubmit`, { actor_id: activeUserId, note });
    await load();
    setBusy(false);
    if (status >= 400) {
      setServerError({ releaseId: release.id, httpStatus: status, error: data.error });
      notify({ title: `Server menolak (HTTP ${status})`, detail: data.error, tone: "error" });
    } else notify({ title: "Dikirim ulang", detail: data.message, tone: "success" });
  }

  async function regenerate(release: ReleaseRequest) {
    setRegenerating(true);
    const { data } = await post(`/api/releases/${release.id}/summary`, { api_key: apiKey || undefined });
    await load();
    setRegenerating(false);
    notify({ title: "Ringkasan AI", detail: data.message, tone: data.release?.ai_source === "gemini" ? "success" : "info" });
  }

  async function resetDemo() {
    setLoading(true);
    await post("/api/demo/reset", {});
    const list = await load();
    setServerError(null);
    setSelectedId((list.find((r) => r.status === "Pending_PM") ?? list[0])?.id ?? null);
    notify({ title: "Data simulasi direset", tone: "info" });
  }

  const decisionProps = (r: ReleaseRequest) => ({
    release: r,
    user: activeUser,
    busy,
    serverError,
    onDecide: (action: "APPROVE" | "REJECT", note: string) => decide(r, action, note),
    onResubmit: (note: string) => resubmit(r, note),
    onSelfApproveTest: () => decide(r, "APPROVE", "Saya setujui sendiri saja.", { omitLayer: true }),
  });

  // -------------------------------------------------------------------------
  // Turunan
  // -------------------------------------------------------------------------

  const counts = useMemo(() => {
    const c: Record<ReleaseStatus, number> = { Pending_PM: 0, Pending_Core: 0, Pending_Interop: 0, Approved: 0, Perlu_Revisi: 0 };
    releases.forEach((r) => (c[r.status] += 1));
    return c;
  }, [releases]);

  const myQueue = (u: User) => releases.filter((r) => (u.role === "DEVELOPER" ? r.status === "Perlu_Revisi" && r.author_id === u.id : canDecide(r, u).allowed)).length;

  if (loading && releases.length === 0) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">Memuat data simulasi…</div>;
  }

  return (
    <div className="min-h-screen bg-[#060d1a] text-slate-100">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm">
          <div
            className={`flex items-start gap-3 rounded-xl border p-3 text-xs shadow-2xl backdrop-blur ${
              toast.tone === "success"
                ? "border-emerald-500/40 bg-emerald-950/95"
                : toast.tone === "error"
                ? "border-rose-500/40 bg-rose-950/95"
                : "border-slate-600 bg-slate-900/95"
            }`}
          >
            <div className="flex-1">
              <p className="font-bold">{toast.title}</p>
              {toast.detail && <p className="mt-0.5 text-slate-300">{toast.detail}</p>}
            </div>
            <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#071124]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/40 bg-[#0b1a33]">
              <GitMerge className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-extrabold tracking-tight">RAMA</span>
                <span className="rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  Mode Simulasi · data contoh
                </span>
              </div>
              <p className="hidden text-[11px] text-slate-400 sm:block">Request, Align, Monitor, Approve — orkestrasi rilis berjenjang BSI UII</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span title={activeUser?.role === "DEVELOPER" ? "" : "Hanya Developer yang membuat Release Request. Masuk sebagai Developer dulu."}>
              <button
                disabled={activeUser?.role !== "DEVELOPER"}
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <GitPullRequest className="h-4 w-4" /> Simulasi MR dari GitLab
              </button>
            </span>
            <button
              onClick={() => setShowKeyModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
            >
              <KeyRound className="h-3.5 w-3.5 text-amber-400" />
              {aiEnabled ? "Gemini: aktif" : "Gemini: nonaktif"}
            </button>
            <button
              onClick={resetDemo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Reset demo
            </button>
          </div>
        </div>

        {/* Login switcher */}
        <div className="border-t border-slate-800 bg-[#0a1730]">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
            <span className="mr-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
              <UserCircle2 className="h-4 w-4 text-amber-400" /> Mode Demo: masuk sebagai…
            </span>
            {users.map((u) => {
              const active = u.id === activeUserId;
              const q = myQueue(u);
              return (
                <button
                  key={u.id}
                  onClick={() => switchUser(u.id)}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                    active ? "border-amber-400 bg-amber-500/10 text-white" : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[9px] font-bold text-amber-300">{u.avatar}</span>
                  <span className="font-semibold">{u.name.replace(/ \(.*\)/, "")}</span>
                  <span className="text-slate-500">{ROLE_LABEL[u.role]}</span>
                  {q > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-extrabold text-slate-950">{q}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-6">
        {/* 4 layer branch */}
        <section className="rounded-2xl border border-slate-800 bg-[#0a1630] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Alur 4 layer branch · satu Release Request = satu MR per layer</h2>
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-400" /> Wewenang ditegakkan di server
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {LAYERS.map((l) => {
              const isMine = activeUser?.role === l.role;
              const count = l.status ? counts[l.status] : null;
              return (
                <div key={l.layer} className={`rounded-xl border p-3 ${isMine ? "border-amber-400/60 bg-amber-500/5" : "border-slate-800 bg-slate-900/60"}`}>
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-mono font-bold text-amber-300/90">LAYER {l.layer}</span>
                    {count !== null && <span className="rounded bg-slate-800 px-1.5 text-slate-200">{count} menunggu</span>}
                  </div>
                  <p className="mt-1 font-mono text-xs text-white">
                    {l.source} → {l.target}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Otoritas: <span className="text-slate-200">{ROLE_LABEL[l.role]}</span>
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {l.layer === 1 ? "Selesai saat Release Request dibuat" : l.layer === 4 ? `Approve → Dirilis (simulasi) · ${counts.Approved} dirilis` : `Status: ${l.status}`}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Tabs */}
        <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
          {[
            { id: "pipeline", label: "Pipeline Tracker", icon: LayoutGrid },
            { id: "mobile", label: "Tampilan Approver (Mobile)", icon: Smartphone },
            { id: "audit", label: "Audit Trail", icon: Database },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold ${
                tab === t.id ? "bg-amber-500 text-slate-950" : "border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </nav>

        {/* ================= PIPELINE ================= */}
        {tab === "pipeline" && (
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:col-span-7">
              {[...PIPELINE_COLUMNS, "Perlu_Revisi" as ReleaseStatus].map((status) => {
                const items = releases.filter((r) => r.status === status);
                const role = REQUIRED_ROLE_BY_STATUS[status];
                const mine = role && activeUser?.role === role;
                return (
                  <div
                    key={status}
                    className={`rounded-2xl border p-3 ${status === "Perlu_Revisi" ? "md:col-span-2 border-rose-500/20 bg-rose-950/10" : mine ? "border-amber-500/40 bg-[#0c1b36]" : "border-slate-800 bg-[#091326]"}`}
                  >
                    <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={status} />
                        <span className="text-[11px] text-slate-500">({items.length})</span>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {role ? `Diputuskan: ${ROLE_LABEL[role]}` : status === "Approved" ? "Otoritas akhir: Tim Interoperability" : "Kembali ke developer"}
                      </span>
                    </div>
                    <div className={`gap-2 ${status === "Perlu_Revisi" ? "grid md:grid-cols-2" : "space-y-2"}`}>
                      {items.length === 0 && <EmptyColumn label={`Tidak ada request ${STATUS_LABEL[status].toLowerCase()}`} />}
                      {items.map((r) => {
                        const isSel = selected?.id === r.id;
                        const myTurn = activeUser ? canDecide(r, activeUser).allowed || (r.status === "Perlu_Revisi" && r.author_id === activeUser.id) : false;
                        return (
                          <button
                            key={r.id}
                            onClick={() => {
                              setSelectedId(r.id);
                              setServerError(null);
                            }}
                            className={`block w-full rounded-xl border p-3 text-left transition ${
                              isSel ? "border-amber-400 bg-slate-900 ring-1 ring-amber-400/30" : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] font-bold text-amber-300">{r.kode}</span>
                              <RiskBadge level={r.risk_level} />
                            </div>
                            <p className="text-xs font-bold leading-snug text-white">{r.judul}</p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {r.modul} · <span className="font-mono">{r.repo}</span>
                            </p>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <MiniStepper release={r} />
                              {myTurn && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-extrabold text-slate-950">GILIRAN ANDA</span>}
                            </div>
                            <p className="mt-1.5 text-[10px] text-slate-400">{waitingText(r, now)}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inspector */}
            {selected && (
              <aside className="space-y-3 xl:sticky xl:top-36 xl:col-span-5 xl:max-h-[calc(100vh-10rem)] xl:overflow-y-auto">
                <div className="rounded-2xl border border-slate-800 bg-[#0b172e] p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">{selected.kode}</span>
                    <StatusBadge status={selected.status} />
                    <RiskBadge level={selected.risk_level} />
                  </div>
                  <h2 className="text-sm font-extrabold text-white">{selected.judul}</h2>
                  <p className="text-[11px] text-slate-400">
                    {selected.modul} · <span className="font-mono">{selected.repo}</span> · diajukan {selected.author_name}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-300">{waitingText(selected, now)}</p>
                </div>

                <DecisionPanel {...decisionProps(selected)} />
                <RuleFlags release={selected} />
                <AiSummaryBlock release={selected} canRegenerate={aiEnabled} regenerating={regenerating} onRegenerate={() => regenerate(selected)} />
                <DeveloperQuestions release={selected} />
                <RollbackPlan release={selected} />

                <section className="rounded-xl border border-slate-800 bg-[#0b172e] p-3">
                  <h4 className="mb-2 text-xs font-bold text-white">MR per layer (simulasi)</h4>
                  <MrLayerList release={selected} />
                </section>

                <section className="rounded-xl border border-slate-800 bg-[#0b172e] p-3">
                  <button onClick={() => setShowDiff((v) => !v)} className="flex w-full items-center justify-between text-xs font-bold text-white">
                    <span className="flex items-center gap-1.5">
                      <Code2 className="h-3.5 w-3.5" /> Diff ({selected.changed_files.length} file, rahasia disamarkan)
                    </span>
                    <span className="text-[10px] text-slate-400">{showDiff ? "Sembunyikan" : "Tampilkan"}</span>
                  </button>
                  {showDiff && <DiffView diff={selected.git_diff} />}
                </section>

                <section className="rounded-xl border border-slate-800 bg-[#0b172e] p-3">
                  <h4 className="mb-2 text-xs font-bold text-white">Riwayat request ini</h4>
                  <ul className="space-y-1.5">
                    {selected.logs.map((l) => (
                      <li key={l.id} className={`border-l-2 pl-2 text-[11px] ${l.action === "BLOCKED" ? "border-rose-500" : "border-slate-700"}`}>
                        <div className="flex flex-wrap items-center gap-1.5 text-slate-400">
                          <LogActionChip log={l} />
                          <span className="text-slate-200">{l.user_name}</span>
                          <span>· L{l.layer ?? "-"}</span>
                          <span className="font-mono text-[10px]">
                            {l.from_status} → {l.to_status}
                          </span>
                          <span className="ml-auto text-[10px]">{formatTime(l.created_at)}</span>
                        </div>
                        <p className="text-slate-300">{l.comment}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              </aside>
            )}
          </div>
        )}

        {/* ================= MOBILE ================= */}
        {tab === "mobile" && selected && (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            <div className="flex flex-col items-center lg:col-span-5">
              <p className="mb-2 text-[11px] text-slate-400">
                Tampilan di HP approver · masuk sebagai <strong className="text-white">{activeUser?.name}</strong> ({activeUser && ROLE_LABEL[activeUser.role]})
              </p>
              <div className="w-full max-w-[390px] overflow-hidden rounded-[36px] border-[8px] border-slate-800 bg-[#071022] shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-2 text-[10px] text-slate-400">
                  <span className="font-bold text-slate-200">RAMA</span>
                  <span className="rounded-full border border-amber-400/40 px-1.5 text-[9px] text-amber-300">Simulasi</span>
                </div>
                <div className="max-h-[680px] space-y-2.5 overflow-y-auto p-3.5">
                  <select
                    value={selected.id}
                    onChange={(e) => {
                      setSelectedId(Number(e.target.value));
                      setServerError(null);
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-amber-300"
                  >
                    {releases.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.kode} · {STATUS_LABEL[r.status]}
                      </option>
                    ))}
                  </select>
                  <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <StatusBadge status={selected.status} />
                      <RiskBadge level={selected.risk_level} />
                    </div>
                    <p className="text-xs font-bold text-white">{selected.judul}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <MiniStepper release={selected} />
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">{waitingText(selected, now)}</p>
                  </div>
                  <RuleFlags release={selected} compact />
                  <AiSummaryBlock release={selected} compact />
                  <DeveloperQuestions release={selected} />
                  <DecisionPanel {...decisionProps(selected)} />
                </div>
              </div>
            </div>

            <div className="space-y-3 lg:col-span-7">
              <div className="rounded-2xl border border-slate-800 bg-[#0b172e] p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-rose-400">Tanpa RAMA</p>
                <h3 className="mt-0.5 text-sm font-extrabold text-white">Approver non-teknis hanya menerima diff mentah lewat grup WhatsApp</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Di sebelah kiri, approver melihat penanda aturan yang bisa ditelusuri ke file tertentu, ringkasan bantuan AI yang diberi label jelas, dan
                  pertanyaan yang perlu diajukan ke developer. Keputusan tetap di tangan penanggung jawab layer.
                </p>
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-800 bg-[#050a14]">
                  <div className="flex items-center gap-1.5 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-300">
                    <Terminal className="h-3.5 w-3.5 text-amber-400" /> {selected.kode} · diff (rahasia disamarkan)
                  </div>
                  <DiffView diff={selected.git_diff} tall />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= AUDIT ================= */}
        {tab === "audit" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-[#091326]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Database className="h-4 w-4 text-amber-400" /> approval_logs · {logs.length} entri
                </h3>
                <span className="text-[10px] text-slate-500">
                  Termasuk percobaan yang ditolak server (DITOLAK_SISTEM). Sumber semua entri: simulasi.
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-900 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Waktu</th>
                      <th className="px-3 py-2">Release</th>
                      <th className="px-3 py-2">Layer</th>
                      <th className="px-3 py-2">Pelaku</th>
                      <th className="px-3 py-2">Aksi</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Catatan</th>
                      <th className="px-3 py-2">Sumber</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {[...logs].reverse().map((l) => (
                      <tr key={l.id} className={l.action === "BLOCKED" ? "bg-rose-950/30" : ""}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-400">{formatTime(l.created_at)}</td>
                        <td className="px-3 py-2 font-mono font-bold text-amber-300">{l.release_kode}</td>
                        <td className="px-3 py-2 text-slate-300">{l.layer ?? "-"}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="text-slate-200">{l.user_name}</span> <span className="text-slate-500">({l.role_at_action})</span>
                        </td>
                        <td className="px-3 py-2">
                          <LogActionChip log={l} />
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 font-mono ${l.to_status === "DITOLAK_SISTEM" ? "text-rose-300" : "text-slate-300"}`}>
                          {l.from_status} → {l.to_status}
                        </td>
                        <td className="min-w-[280px] px-3 py-2 text-slate-300">{l.comment}</td>
                        <td className="px-3 py-2 text-slate-500">{l.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#091326] p-3">
              <h3 className="mb-2 text-xs font-bold text-white">users</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {users.map((u) => (
                  <div key={u.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-[11px]">
                    <p className="font-bold text-white">{u.name}</p>
                    <p className="text-slate-400">{u.title}</p>
                    <p className="mt-1 font-mono text-[10px] text-amber-300">{u.role}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {showCreate && activeUser && (
        <CreateReleaseModal
          presets={presets}
          actor={activeUser}
          apiKey={apiKey}
          onClose={() => setShowCreate(false)}
          onCreated={async (r) => {
            setShowCreate(false);
            await load();
            setSelectedId(r.id);
            setTab("pipeline");
            notify({ title: `${r.kode} dibuat · Pending_PM`, detail: `Risiko ${r.risk_level} dari rule engine. Ringkasan AI: ${r.ai_source}.`, tone: "success" });
          }}
        />
      )}

      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-slate-700 bg-[#0a162c] p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Ringkasan AI (opsional)</h3>
              <button onClick={() => setShowKeyModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-300">
              <li>
                Dengan API key: ringkasan dibuat live oleh <code>gemini-3.8-flash</code>, dibatasi ke ringkasan, dampak pengguna, dan pertanyaan. Tanpa level risiko,
                tanpa angka, tanpa klaim aman.
              </li>
              <li>Tanpa API key: skenario preset menampilkan teks berlabel “Contoh output AI”; diff kustom menampilkan “Ringkasan AI tidak tersedia”.</li>
              <li>Level risiko selalu dari rule engine, apa pun mode AI-nya.</li>
            </ul>
            {serverHasKey && <p className="text-[11px] text-emerald-300">GEMINI_API_KEY sudah terpasang di server.</p>}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIza… (disimpan di browser ini saja)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setApiKey("");
                  localStorage.removeItem(API_KEY_STORAGE);
                  setShowKeyModal(false);
                }}
                className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300"
              >
                Hapus key
              </button>
              <button
                onClick={() => {
                  localStorage.setItem(API_KEY_STORAGE, apiKey);
                  setShowKeyModal(false);
                }}
                className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950"
              >
                Simpan
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
    <pre className={`mt-2 overflow-auto rounded-lg bg-[#050a14] p-3 font-mono text-[10.5px] leading-relaxed ${tall ? "max-h-[560px]" : "max-h-72"}`}>
      {diff.split("\n").map((line, i) => {
        let cls = "text-slate-400";
        if (line.includes("[DISAMARKAN-R4]")) cls = "bg-rose-950/50 text-rose-300";
        else if (line.startsWith("+") && !line.startsWith("+++")) cls = "bg-emerald-950/30 text-emerald-300";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "bg-rose-950/30 text-rose-300";
        else if (line.startsWith("@@")) cls = "text-sky-400";
        else if (line.startsWith("diff --git")) cls = "text-amber-300 font-bold";
        return (
          <div key={i} className={`px-1 ${cls}`}>
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
  apiKey,
  onClose,
  onCreated,
}: {
  presets: PresetOption[];
  actor: User;
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
    const payload = {
      actor_id: actor.id,
      judul,
      modul,
      repo,
      feature_branch: branch,
      rollback_plan: rollback,
      git_diff: diff,
      preset_key: presetKey || undefined,
      api_key: apiKey || undefined,
    };
    let status = 500;
    let data: Record<string, any> = {};
    try {
      const res = await fetch("/api/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status !== 404 && res.status !== 405 && res.headers.get("content-type")?.includes("application/json")) {
        status = res.status;
        data = await res.json();
      } else {
        const fb = await browserCreateRelease(payload);
        status = fb.status;
        data = fb.data;
      }
    } catch {
      const fb = await browserCreateRelease(payload);
      status = fb.status;
      data = fb.data;
    }
    setSubmitting(false);
    if (status >= 400) return setError(`HTTP ${status}: ${data.error}`);
    onCreated(data.release as ReleaseRequest);
  }

  const input = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-700 bg-[#0a162c]">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-5 py-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-white">
              <GitPullRequest className="h-4 w-4 text-amber-400" /> Simulasi MR dari GitLab
            </h3>
            <p className="text-[11px] text-slate-400">
              MR layer 1 (feature → develop) dianggap sudah di-merge oleh developer. RAMA membuat Release Request dan membuka MR layer 2 untuk PM.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="grid max-h-[80vh] grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-slate-300">Skenario contoh</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {presets.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => applyPreset(p)}
                    className={`rounded-lg border p-2 text-left text-[11px] ${
                      presetKey === p.key ? "border-amber-400 bg-amber-500/10 text-white" : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <span className="block font-mono text-[9px] font-bold text-amber-400">{p.badge}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-slate-400 sm:col-span-2">
                Judul
                <input required value={judul} onChange={(e) => setJudul(e.target.value)} className={input} />
              </label>
              <label className="text-[11px] text-slate-400">
                Modul
                <input value={modul} onChange={(e) => setModul(e.target.value)} className={input} />
              </label>
              <label className="text-[11px] text-slate-400">
                Repo
                <input value={repo} onChange={(e) => setRepo(e.target.value)} className={`${input} font-mono`} />
              </label>
              <label className="text-[11px] text-slate-400 sm:col-span-2">
                Branch layer 1 (feature → develop)
                <input value={branch} onChange={(e) => setBranch(e.target.value)} className={`${input} font-mono`} />
              </label>
              <label className="text-[11px] text-slate-400 sm:col-span-2">
                Rencana rollback <span className="text-slate-500">(diisi developer)</span>
                <textarea value={rollback} onChange={(e) => setRollback(e.target.value)} rows={2} className={input} />
              </label>
            </div>
            <label className="block text-[11px] text-slate-400">
              Git diff
              <textarea required value={diff} onChange={(e) => setDiff(e.target.value)} rows={10} className={`${input} font-mono text-[10.5px] text-emerald-300`} />
            </label>
          </div>

          <div className="space-y-3 lg:col-span-2">
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold text-white">Preview penanda aturan</p>
                <RiskBadge level={preview.level} size="md" />
              </div>
              <ul className="space-y-1">
                {preview.triggeredRules.map((r, i) => (
                  <li key={i} className="text-[11px] text-slate-300">
                    <span className="font-mono font-bold text-slate-100">{r.id}</span> · {r.file ? <span className="font-mono break-all">{r.file}</span> : r.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-slate-500">
                Dihitung di browser dengan fungsi yang sama dengan server. Ubah diff untuk melihat aturan berubah. AI tidak dipakai.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px] text-slate-400">
              <p className="mb-1 font-semibold text-slate-200">Yang akan terjadi</p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>Rule engine menghitung risiko dari daftar file dan pola diff.</li>
                <li>Rahasia di diff disamarkan sebelum disimpan dan sebelum dikirim ke AI.</li>
                <li>Release Request dibuat: MR L1 di-merge (simulasi), MR L2 menunggu PM.</li>
                <li>Ringkasan AI dibuat jika tersedia; jika tidak, alur tetap berjalan.</li>
              </ol>
            </div>
            {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-2 text-[11px] text-rose-200">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Buat Release Request
            </button>
            <p className="flex items-center gap-1 text-[10px] text-slate-500">
              <FlaskConical className="h-3 w-3" /> Data simulasi. Tidak ada koneksi ke GitLab BSI UII.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
