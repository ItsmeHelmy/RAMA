"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  HelpCircle,
  Lock,
  RotateCcw,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { ApprovalLog, MRStatus, ReleaseMR, ReleaseRequest, ReleaseStatus, RiskLevel, User } from "@/lib/types";
import { questionsFromRules } from "@/lib/risk-engine";
import { canDecide, LAYER_BY_STATUS, LAYERS, MIN_NOTE_LENGTH, REQUIRED_ROLE_BY_STATUS, ROLE_LABEL, STATUS_LABEL } from "@/lib/workflow";

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
  if (!iso) return "-";
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "baru saja";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d} hr ${h} jam`;
  if (h > 0) return `${h} jam ${m} mnt`;
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

/** Teks read-only tentang posisi request, mis. "Menunggu: Tim Core · 2 jam 14 mnt". */
export function waitingText(release: ReleaseRequest, now: number): string {
  const role = REQUIRED_ROLE_BY_STATUS[release.status];
  const mr = currentMr(release);
  if (role && mr) return `Menunggu: ${ROLE_LABEL[role]} · ${durationSince(mr.opened_at, now)}`;
  if (release.status === "Perlu_Revisi") return `Perlu revisi · ditolak di layer ${mr?.layer ?? "?"} · ${durationSince(mr?.decided_at ?? null, now)}`;
  return `Dirilis (simulasi) · ${formatTime(release.updated_at)}`;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const RISK_STYLE: Record<RiskLevel, string> = {
  LOW: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  MEDIUM: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  HIGH: "bg-rose-500/15 text-rose-300 border-rose-500/40",
};

/** Satu-satunya komponen label risiko. Selalu membaca release.risk_level (dari rule engine). */
export function RiskBadge({ level, size = "sm" }: { level: RiskLevel; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${RISK_STYLE[level]} ${
        size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-[10px]"
      }`}
    >
      RISIKO {level}
    </span>
  );
}

export const STATUS_STYLE: Record<ReleaseStatus, string> = {
  Pending_PM: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Pending_Core: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Pending_Interop: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Perlu_Revisi: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export function StatusBadge({ status }: { status: ReleaseStatus }) {
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const MR_STYLE: Record<MRStatus, { cls: string; label: string }> = {
  DISETUJUI: { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", label: "Di-merge (simulasi)" },
  MENUNGGU: { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "Menunggu keputusan" },
  DITOLAK: { cls: "bg-rose-500/15 text-rose-300 border-rose-500/30", label: "Ditolak" },
  BELUM_DIMULAI: { cls: "bg-slate-800 text-slate-400 border-slate-700", label: "Belum dimulai" },
};

// ---------------------------------------------------------------------------
// Mini stepper (4 titik) & daftar MR per layer
// ---------------------------------------------------------------------------

export function MiniStepper({ release }: { release: ReleaseRequest }) {
  return (
    <div className="flex items-center gap-1" aria-label="Posisi layer">
      {release.mrs.map((mr, i) => {
        const color =
          mr.status === "DISETUJUI"
            ? "bg-emerald-400"
            : mr.status === "MENUNGGU"
            ? "bg-amber-400 ring-2 ring-amber-400/30"
            : mr.status === "DITOLAK"
            ? "bg-rose-500"
            : "bg-slate-700";
        return (
          <React.Fragment key={mr.layer}>
            <span title={`Layer ${mr.layer}: ${mr.source_branch} → ${mr.target_branch} · ${MR_STYLE[mr.status].label}`} className="flex items-center gap-1">
              <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
              <span className="text-[9px] font-mono text-slate-500">L{mr.layer}</span>
            </span>
            {i < release.mrs.length - 1 && <span className="h-px w-3 bg-slate-700" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function MrLayerList({ release }: { release: ReleaseRequest }) {
  return (
    <div className="space-y-1.5">
      {release.iterasi > 1 && (
        <p className="text-[11px] text-amber-300">
          Iterasi {release.iterasi} · MR baru dibuka setelah revisi (riwayat iterasi sebelumnya ada di Audit Trail).
        </p>
      )}
      {release.mrs.map((mr) => {
        const owner = LAYERS[mr.layer - 1].role;
        return (
          <div key={mr.layer} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-slate-200">
                <span className="text-slate-500">L{mr.layer}</span> {mr.source_branch} → {mr.target_branch}{" "}
                <span className="text-amber-300/80">{mr.mr_ref}</span>
              </span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${MR_STYLE[mr.status].cls}`}>
                {MR_STYLE[mr.status].label}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-slate-500">
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
// P4: Penanda aturan (deterministik), ringkasan AI, pertanyaan
// ---------------------------------------------------------------------------

export function RuleFlags({ release, compact = false }: { release: ReleaseRequest; compact?: boolean }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-white">
          <ShieldAlert className="h-3.5 w-3.5 text-slate-300" />
          Penanda Aturan (deterministik)
        </h4>
        <RiskBadge level={release.risk_level} size="md" />
      </div>
      <ul className="space-y-1">
        {release.triggered_rules.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px]">
            <span
              className={`mt-px shrink-0 rounded px-1.5 py-px font-mono text-[10px] font-bold ${
                r.level === "HIGH" ? "bg-rose-500/20 text-rose-300" : r.level === "MEDIUM" ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"
              }`}
            >
              {r.id}
            </span>
            <span className="text-slate-300">
              {r.file ? <span className="font-mono text-slate-200 break-all">{r.file}</span> : <span className="text-slate-200">{r.label}</span>}
              {r.file && !compact && <span className="text-slate-500"> · {r.label}</span>}
              {r.detail && <span className="text-slate-500"> · {r.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!compact && (
        <p className="mt-2 text-[10px] text-slate-500">
          Dihitung rule engine dari daftar file dan pola diff. Tidak memakai AI. Level = aturan tertinggi yang terpicu.
        </p>
      )}
    </section>
  );
}

export function AiSummaryBlock({
  release,
  compact = false,
  canRegenerate,
  regenerating,
  onRegenerate,
}: {
  release: ReleaseRequest;
  compact?: boolean;
  canRegenerate?: boolean;
  regenerating?: boolean;
  onRegenerate?: () => void;
}) {
  const s = release.ai_summary;
  const sourceChip =
    release.ai_source === "gemini" ? "Gemini · gemini-3.8-flash" : release.ai_source === "contoh" ? "Contoh output AI" : "Tidak tersedia";
  return (
    <section className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-indigo-200">
          <Bot className="h-3.5 w-3.5" />
          Bantuan Memahami Perubahan
        </h4>
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-indigo-400/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-200">
            {sourceChip}
          </span>
          {canRegenerate && onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-white disabled:opacity-50"
            >
              {regenerating ? "Memproses…" : "Buat ulang"}
            </button>
          )}
        </div>
      </div>
      <p className="mb-2 text-[10px] italic text-indigo-300/80">Dibuat AI sebagai bantuan, dapat keliru. Verifikasi ke developer.</p>

      {s ? (
        <div className="space-y-2 text-[11px] text-slate-200">
          <p>{s.ringkasan}</p>
          {s.dampak_pengguna.length > 0 && (
            <div>
              <p className="mb-0.5 font-semibold text-indigo-200">Dampak ke pengguna</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {(compact ? s.dampak_pengguna.slice(0, 2) : s.dampak_pengguna).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-700 p-2.5 text-[11px] text-slate-400">
          <p className="font-semibold text-slate-300">Ringkasan AI tidak tersedia.</p>
          <p>Penanda aturan dan tombol keputusan tetap berfungsi. Baca diff atau tanyakan langsung ke developer.</p>
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
    <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-white">
        <HelpCircle className="h-3.5 w-3.5 text-slate-300" />
        Pertanyaan untuk developer
      </h4>
      <ul className="space-y-1 text-[11px]">
        {ruleQs.map((q) => (
          <li key={q.rule} className="flex gap-2">
            <span className="shrink-0 rounded bg-slate-800 px-1.5 py-px font-mono text-[10px] font-bold text-slate-300">{q.rule}</span>
            <span className="text-slate-200">{q.question}</span>
          </li>
        ))}
        {aiQs.map((q, i) => (
          <li key={`ai-${i}`} className="flex gap-2">
            <span className="shrink-0 rounded bg-indigo-500/20 px-1.5 py-px font-mono text-[10px] font-bold text-indigo-200">AI</span>
            <span className="text-slate-200">{q}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RollbackPlan({ release }: { release: ReleaseRequest }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px]">
      <div className="mb-0.5 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 font-bold text-white">
          <RotateCcw className="h-3.5 w-3.5 text-slate-300" /> Rencana rollback
        </h4>
        <span className="rounded bg-slate-800 px-1.5 py-px text-[10px] text-slate-400">Diisi developer</span>
      </div>
      {release.rollback_plan ? (
        <p className="text-slate-300">{release.rollback_plan}</p>
      ) : (
        <p className="text-amber-300">Belum diisi developer.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// P1: Panel keputusan (wewenang ditegakkan server; UI hanya mencerminkan)
// ---------------------------------------------------------------------------

export interface ServerError {
  releaseId: number;
  httpStatus: number;
  error: string;
}

export function DecisionPanel({
  release,
  user,
  busy,
  serverError,
  onDecide,
  onResubmit,
  onSelfApproveTest,
}: {
  release: ReleaseRequest;
  user: User | undefined;
  busy: boolean;
  serverError: ServerError | null;
  onDecide: (action: "APPROVE" | "REJECT", note: string) => void;
  onResubmit: (note: string) => void;
  onSelfApproveTest: () => void;
}) {
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [release.id, release.status]);

  const requiredRole = REQUIRED_ROLE_BY_STATUS[release.status];
  const permission = canDecide(release, user);
  const isAuthor = user?.id === release.author_id;
  const err = serverError && serverError.releaseId === release.id ? serverError : null;

  const errorBox = err && (
    <div className="rounded-lg border border-rose-500/50 bg-rose-950/40 p-2.5 text-[11px] text-rose-100">
      <p className="flex items-center gap-1.5 font-bold">
        <XCircle className="h-3.5 w-3.5 text-rose-400" /> Server menolak · HTTP {err.httpStatus}
      </p>
      <p className="mt-0.5">{err.error}</p>
      <p className="mt-1 text-[10px] text-rose-300/80">Percobaan ini dicatat di Audit Trail dengan status DITOLAK_SISTEM.</p>
    </div>
  );

  if (release.status === "Approved") {
    return (
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-[11px] text-emerald-100">
        <p className="flex items-center gap-1.5 font-bold">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Dirilis (simulasi)
        </p>
        <p className="mt-0.5 text-emerald-200/80">Keempat layer disetujui. Otoritas akhir: Tim Interoperability.</p>
      </section>
    );
  }

  if (release.status === "Perlu_Revisi") {
    const reject = lastRejectLog(release);
    return (
      <section className="space-y-2 rounded-xl border border-rose-500/30 bg-rose-950/15 p-3 text-[11px]">
        <p className="flex items-center gap-1.5 font-bold text-rose-200">
          <AlertTriangle className="h-4 w-4 text-rose-400" /> Perlu revisi
        </p>
        {reject && (
          <p className="text-slate-300">
            Ditolak oleh <strong>{reject.user_name}</strong> ({ROLE_LABEL[reject.role_at_action]}) di layer {reject.layer}: “{reject.comment}”
          </p>
        )}
        {isAuthor ? (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Apa yang diperbaiki? (opsional)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[11px] text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
            />
            <button
              disabled={busy}
              onClick={() => onResubmit(note)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Kirim ulang setelah revisi
            </button>
            <p className="text-[10px] text-slate-500">Asumsi sementara: setelah dikirim ulang, request kembali ke PM (menunggu konfirmasi wawancara).</p>
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-slate-400">
            <Lock className="h-3.5 w-3.5" /> Menunggu developer pengaju merevisi dan mengirim ulang.
          </p>
        )}
        {errorBox}
      </section>
    );
  }

  const noteRequired = release.risk_level === "HIGH";
  return (
    <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-900/80 p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold text-white">Keputusan layer {LAYER_BY_STATUS[release.status]}</span>
        <span className="text-slate-400">Penanggung jawab: {requiredRole ? ROLE_LABEL[requiredRole] : "-"}</span>
      </div>

      {permission.allowed && (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={noteRequired ? "Catatan wajib (risiko HIGH)…" : "Catatan (wajib jika reject)…"}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[11px] text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
          />
          <p className="text-[10px] text-slate-500">
            Reject wajib alasan ≥ {MIN_NOTE_LENGTH} karakter{noteRequired ? `; approve risiko HIGH wajib catatan ≥ ${MIN_NOTE_LENGTH} karakter` : ""}. Divalidasi server.
          </p>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <span title={permission.allowed ? "" : permission.reason} className="block">
          <button
            disabled={!permission.allowed || busy}
            onClick={() => onDecide("APPROVE", note)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ThumbsUp className="h-3.5 w-3.5" /> Approve
          </button>
        </span>
        <span title={permission.allowed ? "" : permission.reason} className="block">
          <button
            disabled={!permission.allowed || busy}
            onClick={() => onDecide("REJECT", note)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ThumbsDown className="h-3.5 w-3.5" /> Reject
          </button>
        </span>
      </div>

      {!permission.allowed && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Lock className="h-3.5 w-3.5 shrink-0" /> {permission.reason}
        </p>
      )}

      {isAuthor && (
        <button
          disabled={busy}
          onClick={onSelfApproveTest}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber-400/50 bg-amber-500/5 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/10"
        >
          <FlaskConical className="h-3.5 w-3.5" /> Coba approve request milik sendiri (panggil API sungguhan)
        </button>
      )}

      {errorBox}
    </section>
  );
}

export function LogActionChip({ log }: { log: ApprovalLog }) {
  const map: Record<string, string> = {
    SUBMIT: "bg-sky-500/15 text-sky-300",
    APPROVE: "bg-emerald-500/15 text-emerald-300",
    REJECT: "bg-rose-500/15 text-rose-300",
    RESUBMIT: "bg-amber-500/15 text-amber-300",
    BLOCKED: "bg-rose-600/30 text-rose-200",
  };
  return <span className={`rounded px-1.5 py-px font-mono text-[10px] font-bold ${map[log.action]}`}>{log.action}</span>;
}

export function EmptyColumn({ label }: { label: string }) {
  return (
    <div className="flex h-24 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 text-[11px] text-slate-600">
      <CircleDashed className="mb-1 h-4 w-4" />
      {label}
    </div>
  );
}
