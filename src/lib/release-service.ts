/**
 * RAMA — operasi Release Request. Semua penegakan wewenang terjadi di sini (server),
 * bukan di UI. Percobaan yang ditolak dicatat ke approval_logs dengan
 * to_status = DITOLAK_SISTEM.
 */
import { summarizeChange } from "./ai-summary";
import { getRelease, getUser, inTransaction, insertLog, insertMrSet, nextMrNumber, nextReleaseKode } from "./db";
import { evaluateRisk, maskSecrets, parseChangedFiles } from "./risk-engine";
import { DecisionAction, LAYER_BY_STATUS, validateDecision, validateResubmit } from "./workflow";
import { ReleaseRequest } from "./types";

export type ServiceResult =
  | { ok: true; release: ReleaseRequest; message: string }
  | { ok: false; httpStatus: number; error: string; release?: ReleaseRequest };

export const BLOCKED_STATUS = "DITOLAK_SISTEM";

export async function createRelease(input: {
  actorId: number;
  judul: string;
  modul: string;
  repo: string;
  featureBranch: string;
  rollbackPlan: string;
  gitDiff: string;
  presetKey?: string;
  apiKey?: string;
}): Promise<ServiceResult> {
  const actor = getUser(input.actorId);
  if (!actor) return { ok: false, httpStatus: 401, error: "Pengguna tidak dikenal." };
  if (actor.role !== "DEVELOPER") {
    return { ok: false, httpStatus: 403, error: "Hanya Developer yang dapat membuat Release Request (setelah MR layer 1 di-merge ke develop)." };
  }
  if (!input.judul.trim() || !input.gitDiff.trim()) {
    return { ok: false, httpStatus: 422, error: "Judul dan git diff wajib diisi." };
  }
  if (!input.featureBranch.trim().startsWith("feature/")) {
    return { ok: false, httpStatus: 422, error: "Branch layer 1 harus diawali 'feature/' (feature → develop)." };
  }

  // 1. Rule engine deterministik pada diff asli; 2. samarkan rahasia SEBELUM disimpan / dikirim ke AI.
  const files = parseChangedFiles(input.gitDiff);
  const risk = evaluateRisk(files, input.gitDiff);
  const { masked } = maskSecrets(input.gitDiff);

  // 3. Ringkasan AI (boleh gagal — tidak memengaruhi risiko maupun alur approval).
  const ai = await summarizeChange({
    judul: input.judul,
    maskedDiff: masked,
    presetKey: input.presetKey,
    rawDiffForPresetMatch: input.gitDiff,
    apiKey: input.apiKey,
  });

  const releaseId = inTransaction((db) => {
    const now = new Date().toISOString();
    const res = db
      .prepare(
        `INSERT INTO release_requests (kode, judul, modul, repo, feature_branch, author_id, status, risk_level,
          triggered_rules_json, changed_files_json, git_diff_masked, ai_summary_json, ai_source, rollback_plan, iterasi, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Pending_PM', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        nextReleaseKode(db), input.judul.trim(), input.modul.trim() || "-", input.repo.trim(), input.featureBranch.trim(),
        actor.id, risk.level, JSON.stringify(risk.triggeredRules), JSON.stringify(files), masked,
        ai.summary ? JSON.stringify(ai.summary) : null, ai.source, input.rollbackPlan.trim(), now, now
      );
    const id = Number(res.lastInsertRowid);
    insertMrSet(db, { releaseId: id, iterasi: 1, repo: input.repo.trim(), featureBranch: input.featureBranch.trim(), authorId: actor.id, at: now, firstNumber: nextMrNumber(db) });
    insertLog(db, {
      releaseId: id, layer: 1, userId: actor.id, role: actor.role, action: "SUBMIT", from: "Draft_GitLab", to: "Pending_PM",
      comment: `MR layer 1 (${input.featureBranch.trim()} → develop) di-merge (simulasi). Release Request dibuat; MR layer 2 dibuka. Risiko ${risk.level} dari rule engine.`,
      at: now,
    });
    return id;
  });

  return { ok: true, release: getRelease(releaseId)!, message: "Release Request dibuat dan menunggu PM." };
}

export function decide(input: {
  releaseId: number;
  actorId: number;
  action: DecisionAction;
  note?: string;
  layer?: number;
}): ServiceResult {
  const actor = getUser(input.actorId);
  if (!actor) return { ok: false, httpStatus: 401, error: "Pengguna tidak dikenal." };
  const release = getRelease(input.releaseId);
  if (!release) return { ok: false, httpStatus: 404, error: "Release Request tidak ditemukan." };
  if (input.action !== "APPROVE" && input.action !== "REJECT") {
    return { ok: false, httpStatus: 400, error: "Aksi harus APPROVE atau REJECT." };
  }

  const check = validateDecision({ release, actor, action: input.action, note: input.note, requestedLayer: input.layer });
  const note = (input.note || "").trim();

  if (!check.ok) {
    inTransaction((db) =>
      insertLog(db, {
        releaseId: release.id, layer: input.layer ?? LAYER_BY_STATUS[release.status] ?? null, userId: actor.id, role: actor.role,
        action: "BLOCKED", from: release.status, to: BLOCKED_STATUS,
        comment: `Percobaan ${input.action} ditolak server (${check.httpStatus}): ${check.error}${note ? ` · Catatan aktor: "${note}"` : ""}`,
        at: new Date().toISOString(),
      })
    );
    return { ok: false, httpStatus: check.httpStatus, error: check.error, release: getRelease(release.id) };
  }

  inTransaction((db) => {
    const now = new Date().toISOString();
    const layer = check.layer;
    db.prepare(
      "UPDATE release_mrs SET status = ?, decided_at = ?, decided_by = ? WHERE release_id = ? AND iterasi = ? AND layer = ?"
    ).run(input.action === "APPROVE" ? "DISETUJUI" : "DITOLAK", now, actor.id, release.id, release.iterasi, layer);
    if (input.action === "APPROVE" && layer < 4) {
      db.prepare("UPDATE release_mrs SET status = 'MENUNGGU', opened_at = ? WHERE release_id = ? AND iterasi = ? AND layer = ?").run(
        now, release.id, release.iterasi, layer + 1
      );
    }
    db.prepare("UPDATE release_requests SET status = ?, updated_at = ? WHERE id = ?").run(check.nextStatus, now, release.id);
    insertLog(db, {
      releaseId: release.id, layer, userId: actor.id, role: actor.role, action: input.action, from: release.status, to: check.nextStatus,
      comment: note || (input.action === "APPROVE" ? `Disetujui; MR layer ${layer} di-merge (simulasi).` : "Ditolak."),
      at: now,
    });
  });

  const updated = getRelease(release.id)!;
  const message =
    input.action === "REJECT"
      ? `Ditolak di layer ${check.layer}. Request dikembalikan ke developer (Perlu_Revisi).`
      : check.nextStatus === "Approved"
      ? "Layer 4 disetujui. Request Dirilis (simulasi)."
      : `Layer ${check.layer} disetujui dan di-merge (simulasi). MR layer ${check.layer + 1} dibuka.`;
  return { ok: true, release: updated, message };
}

export function resubmit(input: { releaseId: number; actorId: number; note?: string }): ServiceResult {
  const actor = getUser(input.actorId);
  if (!actor) return { ok: false, httpStatus: 401, error: "Pengguna tidak dikenal." };
  const release = getRelease(input.releaseId);
  if (!release) return { ok: false, httpStatus: 404, error: "Release Request tidak ditemukan." };

  const check = validateResubmit({ release, actor });
  if (!check.ok) {
    inTransaction((db) =>
      insertLog(db, {
        releaseId: release.id, layer: 1, userId: actor.id, role: actor.role, action: "BLOCKED", from: release.status, to: BLOCKED_STATUS,
        comment: `Percobaan kirim ulang ditolak server (${check.httpStatus}): ${check.error}`, at: new Date().toISOString(),
      })
    );
    return { ok: false, httpStatus: check.httpStatus, error: check.error, release: getRelease(release.id) };
  }

  inTransaction((db) => {
    const now = new Date().toISOString();
    const iterasi = release.iterasi + 1;
    db.prepare("UPDATE release_requests SET status = 'Pending_PM', iterasi = ?, updated_at = ? WHERE id = ?").run(iterasi, now, release.id);
    insertMrSet(db, { releaseId: release.id, iterasi, repo: release.repo, featureBranch: release.feature_branch, authorId: actor.id, at: now, firstNumber: nextMrNumber(db) });
    insertLog(db, {
      releaseId: release.id, layer: 1, userId: actor.id, role: actor.role, action: "RESUBMIT", from: "Perlu_Revisi", to: "Pending_PM",
      comment: (input.note || "").trim() || `Revisi di-merge ulang ke develop (simulasi, iterasi ${iterasi}). Kembali ke PM.`,
      at: now,
    });
  });

  return { ok: true, release: getRelease(release.id)!, message: "Dikirim ulang. Request kembali ke Pending_PM." };
}

/** Membuat ulang ringkasan AI. Tidak menyentuh risk_level (milik rule engine). */
export async function regenerateSummary(input: { releaseId: number; apiKey?: string; presetKey?: string }): Promise<ServiceResult> {
  const release = getRelease(input.releaseId);
  if (!release) return { ok: false, httpStatus: 404, error: "Release Request tidak ditemukan." };
  const ai = await summarizeChange({
    judul: release.judul,
    maskedDiff: release.git_diff,
    presetKey: input.presetKey,
    rawDiffForPresetMatch: release.git_diff,
    apiKey: input.apiKey,
  });
  inTransaction((db) =>
    db.prepare("UPDATE release_requests SET ai_summary_json = ?, ai_source = ? WHERE id = ?").run(
      ai.summary ? JSON.stringify(ai.summary) : null, ai.source, release.id
    )
  );
  return {
    ok: true,
    release: getRelease(release.id)!,
    message: ai.source === "gemini" ? "Ringkasan dibuat ulang oleh Gemini." : ai.source === "contoh" ? "Menampilkan contoh output AI." : "Ringkasan AI tidak tersedia.",
  };
}
