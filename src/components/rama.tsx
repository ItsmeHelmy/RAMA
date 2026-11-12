"use client";

import React, { useEffect, useId, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  HelpCircle,
  Lock,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  Undo2,
  XCircle,
} from "lucide-react";
import { ApprovalLog, MRStatus, ReleaseMR, ReleaseRequest, ReleaseStatus, RiskLevel, User } from "@/lib/types";
import { questionsFromRules } from "@/lib/risk-engine";
import { SEED_APPROVAL_NOTES } from "@/lib/mock-scenarios";
import {
  canDecide,
  LAYER_BY_STATUS,
  LAYERS,
  MIN_NOTE_LENGTH,
  REQUIRED_ROLE_BY_STATUS,
  RISK_META,
  ROLE_LABEL,
  STATUS_LABEL,
} from "@/lib/workflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-render berkala agar teks "menunggu X jam Y mnt" tetap akurat. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function durationSince(iso: string | null, now: number): string {
  if (!iso) return "1 mnt";
  const mins = Math.max(1, Math.floor((now - new Date(iso).getTime()) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d} hr ${h} jam`;
  if (h > 0) return m > 0 ? `${h} jam ${m} mnt` : `${h} jam`;
  return `${m} mnt`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function currentMr(release: ReleaseRequest): ReleaseMR | undefined {
  const layer = LAYER_BY_STATUS[release.status];
  if (layer) return release.mrs.find((m) => m.layer === layer);
  if (release.status === "Perlu_Revisi") return release.mrs.find((m) => m.status === "DITOLAK");
  return undefined;
}

export function lastRejectLog(release: ReleaseRequest): ApprovalLog | undefined {
  return [...release.logs].reverse().find((l) => l.action === "REJECT");
}

/** Teks read-only tentang posisi request sesuai kamus redesign. */
export function waitingText(release: ReleaseRequest, now: number): string {
  const role = REQUIRED_ROLE_BY_STATUS[release.status];
  const mr = currentMr(release);
  if (role && mr) return `${ROLE_LABEL[role]} · menunggu ${durationSince(mr.opened_at, now)}`;
  if (release.status === "Perlu_Revisi") {
    return `Ditolak di tahap ${mr?.layer ?? "?"} · ${durationSince(mr?.decided_at ?? null, now)} lalu`;
  }
  return `Dirilis ${formatTime(release.updated_at)}`;
}

// ---------------------------------------------------------------------------
// Badges & Pills (Light Theme Redesign)
// ---------------------------------------------------------------------------

const RISK_STYLE: Record<RiskLevel, { pill: string; dot: string }> = {
  LOW: {
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  MEDIUM: {
    pill: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
  },
  HIGH: {
    pill: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
};

/** Satu-satunya komponen label risiko. Selalu membaca release.risk_level (dari rule engine). */
export function RiskBadge({ level, size = "sm" }: { level: RiskLevel; size?: "sm" | "md" }) {
  const style = RISK_STYLE[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${style.pill} ${
        size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2.5 py-0.5 text-[11px]"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {RISK_META[level].label}
    </span>
  );
}

export const STATUS_STYLE: Record<ReleaseStatus, string> = {
  Pending_PM: "bg-amber-50 text-amber-800 ring-amber-200",
  Pending_Core: "bg-violet-50 text-violet-700 ring-violet-200",
  Pending_Interop: "bg-sky-50 text-sky-700 ring-sky-200",
  Approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Perlu_Revisi: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function StatusBadge({ status }: { status: ReleaseStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const MR_STYLE: Record<MRStatus, { cls: string; label: string }> = {
  DISETUJUI: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Disetujui & di-merge" },
  MENUNGGU: { cls: "bg-amber-50 text-amber-800 ring-amber-200", label: "Menunggu keputusan" },
  DITOLAK: { cls: "bg-rose-50 text-rose-700 ring-rose-200", label: "Ditolak" },
  BELUM_DIMULAI: { cls: "bg-slate-100 text-slate-500 ring-slate-200", label: "Belum dimulai" },
};

const STAGE_SHORT = ["Ajukan", "PM", "Core", "Interop"] as const;

// ---------------------------------------------------------------------------
// 4-Stage Progress Bar (Ajukan · PM · Core · Interop) & MR List
// ---------------------------------------------------------------------------

export function MiniStepper({ release }: { release: ReleaseRequest }) {
  return (
    <div className="grid w-full grid-cols-4 gap-1.5" aria-label="Posisi tahap">
      {release.mrs.map((mr, idx) => {
        const barColor =
          mr.status === "DISETUJUI"
            ? "bg-emerald-500"
            : mr.status === "MENUNGGU"
            ? "bg-amber-400"
            : mr.status === "DITOLAK"
            ? "bg-rose-500"
            : "bg-slate-200";
        const textColor =
          mr.status === "DISETUJUI"
            ? "text-emerald-700 font-semibold"
            : mr.status === "MENUNGGU"
            ? "text-amber-700 font-semibold"
            : mr.status === "DITOLAK"
            ? "text-rose-700 font-semibold"
            : "text-slate-400";
        return (
          <div
            key={mr.layer}
            title={`Tahap ${mr.layer}: ${mr.source_branch} → ${mr.target_branch} · ${MR_STYLE[mr.status].label}`}
            className="flex flex-col gap-1"
          >
            <span className={`h-1.5 w-full rounded-full ${barColor}`} />
            <span className={`text-[10px] leading-none ${textColor}`}>{STAGE_SHORT[idx] ?? `T${mr.layer}`}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MrLayerList({ release }: { release: ReleaseRequest }) {
  return (
    <div className="space-y-2">
      {release.iterasi > 1 && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
          Iterasi {release.iterasi} · MR baru dibuka setelah revisi (riwayat iterasi sebelumnya tercatat di Riwayat keputusan).
        </p>
      )}
      {release.mrs.map((mr) => {
        const owner = LAYERS[mr.layer - 1].role;
        return (
          <div key={mr.layer} className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-ink">
                <span className="font-bold text-slate-400">Tahap {mr.layer}</span> · {mr.source_branch} → {mr.target_branch}{" "}
                <span className="font-semibold text-brand-600">{mr.mr_ref}</span>
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${MR_STYLE[mr.status].cls}`}>
                {MR_STYLE[mr.status].label}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
              <span>Penanggung jawab: {ROLE_LABEL[owner]}</span>
              {mr.opened_at && <span>Dibuka {formatTime(mr.opened_at)}</span>}
              {mr.decided_at && (
                <span>
                  Diputuskan {formatTime(mr.decided_at)}
                  {mr.decided_by_name ? ` oleh ${mr.decided_by_name}` : ""}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// P4: Penanda risiko otomatis (deterministik), Penjelasan singkat (AI), Pertanyaan
// ---------------------------------------------------------------------------

export function RuleFlags({ release, compact = false }: { release: ReleaseRequest; compact?: boolean }) {
  const primaryRule = release.triggered_rules[0];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          <ShieldAlert className="h-4 w-4 text-brand-600" />
          Penanda risiko otomatis
        </h3>
        <RiskBadge level={release.risk_level} size="md" />
      </div>

      <p className="mt-2 text-xs font-medium text-ink">
        {primaryRule ? `${primaryRule.label}.` : "Evaluasi aturan perubahan."}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{RISK_META[release.risk_level].hint}</p>

      <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/80">
        <ul className="space-y-1.5">
          {release.triggered_rules.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 ring-1 ring-slate-200">
                {r.id}
              </span>
              <div className="min-w-0 flex-1">
                {r.file ? (
                  <p className="break-all font-mono text-[11px] font-medium text-ink">{r.file}</p>
                ) : (
                  <p className="font-medium text-ink">{r.label}</p>
                )}
                {r.file && r.label && <p className="text-[11px] text-slate-500">{r.label}</p>}
                {r.detail && <p className="text-[11px] text-slate-500">{r.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
        {!compact && <p className="text-[11px] text-slate-500">Dihitung dari aturan tetap, bukan AI.</p>}
      </div>
    </section>
  );
}

export function AiSummaryBlock({
  release,
  compact = false,
  canRegenerate,
  regenerating,
  onRegenerate,
  onConfigureKey,
}: {
  release: ReleaseRequest;
  compact?: boolean;
  canRegenerate?: boolean;
  regenerating?: boolean;
  onRegenerate?: () => void;
  onConfigureKey?: () => void;
}) {
  const s = release.ai_summary;
  const sourceChip = release.ai_source === "gemini" && s ? "Dibuat AI" : "Belum dibuat";
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          <Bot className="h-4 w-4 text-brand-600" />
          Penjelasan singkat
        </h3>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
              s ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-slate-100 text-slate-600 ring-slate-200"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            {sourceChip}
          </span>
          {canRegenerate && onRegenerate ? (
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            >
              {regenerating ? "Memproses…" : s ? "Buat ulang" : "Buat Ringkasan AI"}
            </button>
          ) : (
            onConfigureKey && (
              <button
                onClick={onConfigureKey}
                className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100"
              >
                Pasang API Key
              </button>
            )
          )}
        </div>
      </div>

      <p className="mt-1.5 text-xs text-slate-500">
        Ringkasan ini bantuan AI dan bisa keliru. Konfirmasikan ke developer.
      </p>

      {s ? (
        <div className="mt-3 space-y-3 text-xs leading-relaxed text-ink">
          <p>{s.ringkasan}</p>
          {s.dampak_pengguna.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-bold text-ink">Dampak bagi pengguna</h4>
              <ul className="list-disc space-y-1 pl-4 text-slate-600">
                {(compact ? s.dampak_pengguna.slice(0, 2) : s.dampak_pengguna).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-500">
          <p className="font-semibold text-ink">
            {regenerating
              ? "Sedang membuat penjelasan singkat menggunakan Gemini AI…"
              : canRegenerate
              ? "Penjelasan singkat AI belum dibuat untuk rilis ini."
              : "Penjelasan singkat AI belum tersedia (API Key Gemini belum dipasang)."}
          </p>
          <p className="mt-0.5">
            Penanda risiko otomatis dan tombol keputusan tetap berfungsi. Anda dapat membuat penjelasan langsung dengan Gemini AI.
          </p>
          {canRegenerate && onRegenerate && !regenerating ? (
            <button
              onClick={onRegenerate}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              <Sparkles className="h-3.5 w-3.5" /> Buat Ringkasan dengan Gemini AI
            </button>
          ) : (
            onConfigureKey &&
            !regenerating && (
              <button
                onClick={onConfigureKey}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-slate-50"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Pasang API Key Gemini
              </button>
            )
          )}
        </div>
      )}
    </section>
  );
}

export function DeveloperQuestions({ release }: { release: ReleaseRequest }) {
  const ruleQs = questionsFromRules(release.triggered_rules);
  const aiQs = release.ai_summary?.pertanyaan_untuk_developer ?? [];
  if (ruleQs.length === 0 && aiQs.length === 0) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
      <h3 className="mb-2.5 flex items-center gap-2 text-sm font-bold text-ink">
        <HelpCircle className="h-4 w-4 text-brand-600" />
        Tanyakan ke developer
      </h3>
      <ul className="space-y-2 text-xs">
        {ruleQs.map((q) => (
          <li key={q.rule} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 ring-1 ring-inset ring-slate-200">
              {q.rule}
            </span>
            <span className="text-slate-700">{q.question}</span>
          </li>
        ))}
        {aiQs.map((q, i) => (
          <li key={`ai-${i}`} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-700 ring-1 ring-inset ring-brand-200">
              AI
            </span>
            <span className="text-slate-700">{q}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RollbackPlan({ release }: { release: ReleaseRequest }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          <RotateCcw className="h-4 w-4 text-brand-600" /> Rencana pembatalan
        </h3>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
          Diisi developer
        </span>
      </div>
      {release.rollback_plan ? (
        <p className="text-xs leading-relaxed text-slate-600">{release.rollback_plan}</p>
      ) : (
        <p className="text-xs font-medium text-amber-700">Belum diisi developer.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Panel Keputusan (Keputusan tahap X / Perlu diperbaiki developer / Keputusan)
// ---------------------------------------------------------------------------

export interface DecisionError {
  releaseId: number;
  title: string;
  error: string;
  logged: boolean;
}

export function DecisionPanel({
  release,
  user,
  busy,
  decisionError,
  onDecide,
  onResubmit,
  onSelfApproveTest,
}: {
  release: ReleaseRequest;
  user: User | undefined;
  busy: boolean;
  decisionError: DecisionError | null;
  onDecide: (action: "APPROVE" | "REJECT", note: string) => void;
  onResubmit: (note: string) => void;
  onSelfApproveTest: () => void;
}) {
  const [note, setNote] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const noteId = useId();

  useEffect(() => {
    setNote("");
    setRejectOpen(false);
  }, [release.id, release.status, user?.id]);

  const currentLayer = LAYER_BY_STATUS[release.status];
  const requiredRole = REQUIRED_ROLE_BY_STATUS[release.status];
  const permission = canDecide(release, user);
  const isAuthor = user?.id === release.author_id;
  const err = decisionError?.releaseId === release.id ? decisionError : null;

  const errorBox = err && (
    <div role="alert" className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
      <p className="flex items-center gap-1.5 font-bold text-rose-900">
        <XCircle className="h-4 w-4 text-rose-600" /> {err.title}
      </p>
      <p className="mt-0.5">{err.error}</p>
      {err.logged && (
        <p className="mt-1 text-[11px] font-medium text-rose-700">
          Percobaan ini dicatat di Riwayat keputusan sebagai DITOLAK_SISTEM.
        </p>
      )}
    </div>
  );

  if (release.status === "Approved") {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
        <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-900">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Keputusan
        </h3>
        <p className="mt-1 text-xs text-emerald-800">
          Sudah disetujui di semua tahap pada {formatTime(release.updated_at)}. Tidak ada tindakan lagi.
        </p>
      </section>
    );
  }

  if (release.status === "Perlu_Revisi") {
    const reject = lastRejectLog(release);
    return (
      <section className="space-y-3 rounded-2xl border border-rose-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
            <Undo2 className="h-4 w-4 text-rose-600" /> Perlu diperbaiki developer
          </h3>
          <span className="text-xs text-slate-500">Penanggung jawab: Developer</span>
        </div>

        <p className="text-xs text-slate-600">
          Perubahan ini ditolak di tahap {reject?.layer ?? "?"}. Developer memperbaiki, lalu mengajukan ulang dari awal.
        </p>

        {reject && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-2.5 text-xs text-rose-900">
            <span className="font-semibold">{reject.user_name}</span> ({ROLE_LABEL[reject.role_at_action]}): “{reject.comment}”
          </div>
        )}

        {isAuthor ? (
          <div className="space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Catatan perbaikan untuk Project Manager (opsional)…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-ink placeholder:text-slate-400 focus:border-brand-600 focus:bg-white focus:outline-none"
            />
            <button
              disabled={busy}
              onClick={() => onResubmit(note)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" /> Ajukan ulang
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-100 py-2.5 text-xs font-semibold text-slate-400"
            >
              <Undo2 className="h-4 w-4" /> Ajukan ulang
            </button>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" /> Hanya Developer yang dapat mengajukan ulang.
            </p>
          </div>
        )}
        {errorBox}
      </section>
    );
  }

  const noteRequiredForApprove = release.risk_level === "HIGH";
  const defaultNoteForLayer = currentLayer ? SEED_APPROVAL_NOTES[currentLayer] : "";

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          <Check className="h-4 w-4 text-brand-600" /> Keputusan tahap {currentLayer}
        </h3>
        <span className="text-xs text-slate-500">
          Penanggung jawab: {requiredRole ? ROLE_LABEL[requiredRole] : "-"}
        </span>
      </div>

      {permission.allowed ? (
        rejectOpen ? (
          <div className="space-y-2.5">
            <label htmlFor={noteId} className="block text-xs font-semibold text-ink">
              Alasan penolakan (wajib, akan dibaca developer)
            </label>
            <textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Contoh: Mohon jelaskan rencana rollback sebelum diajukan ulang."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-ink placeholder:text-slate-400 focus:border-brand-600 focus:bg-white focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRejectOpen(false);
                  setNote("");
                }}
                className="rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy || note.trim().length < MIN_NOTE_LENGTH}
                onClick={() => onDecide("REJECT", note)}
                className="rounded-xl bg-rose-600 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
              >
                Kirim penolakan
              </button>
            </div>
          </div>
        ) : (
          <>
            {noteRequiredForApprove && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={noteId} className="block text-xs font-semibold text-ink">
                    Catatan verifikasi (wajib untuk risiko tinggi)
                  </label>
                  {defaultNoteForLayer && (
                    <button
                      type="button"
                      onClick={() => setNote(defaultNoteForLayer)}
                      className="text-[11px] font-semibold text-brand-600 hover:text-brand-700"
                    >
                      Isi catatan standar
                    </button>
                  )}
                </div>
                <textarea
                  id={noteId}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Bukti apa yang sudah Anda periksa sebelum menyetujui rilis risiko tinggi ini?"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-ink placeholder:text-slate-400 focus:border-brand-600 focus:bg-white focus:outline-none"
                />
                <p className="text-[11px] text-slate-500">
                  Risiko tinggi wajib menyertakan catatan verifikasi minimal {MIN_NOTE_LENGTH} karakter.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() => onDecide("APPROVE", note)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Setujui
              </button>
              <button
                disabled={busy}
                onClick={() => setRejectOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ThumbsDown className="h-3.5 w-3.5" /> Tolak
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2.5 text-xs font-semibold text-slate-400"
            >
              <Check className="h-4 w-4" /> Setujui
            </button>
            <button
              disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-xs font-semibold text-slate-400"
            >
              <ThumbsDown className="h-3.5 w-3.5" /> Tolak
            </button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" /> {permission.reason}
          </p>
        </>
      )}

      {isAuthor && (
        <button
          disabled={busy}
          onClick={onSelfApproveTest}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100/70"
        >
          <FlaskConical className="h-3.5 w-3.5 text-amber-600" /> Uji persetujuan rilis sendiri (uji blokir server)
        </button>
      )}

      {errorBox}
    </section>
  );
}

export const LOG_ACTION_META: Record<string, { label: string; cls: string }> = {
  SUBMIT: { label: "Mengajukan", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  APPROVE: { label: "Menyetujui", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  REJECT: { label: "Menolak", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  RESUBMIT: { label: "Mengajukan ulang", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  BLOCKED: { label: "Ditolak sistem", cls: "bg-rose-100 text-rose-800 ring-rose-300" },
};

export function LogActionChip({ log }: { log: ApprovalLog }) {
  const meta = LOG_ACTION_META[log.action] ?? { label: log.action, cls: "bg-slate-100 text-slate-700 ring-slate-200" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export function EmptyColumn({ label }: { label: string }) {
  return (
    <div className="flex h-24 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-400">
      <CircleDashed className="mb-1 h-4 w-4" />
      {label}
    </div>
  );
}
