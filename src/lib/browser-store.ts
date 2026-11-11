/**
 * RAMA — Browser-side simulation store for static/Cloudflare hosting.
 *
 * Uses the exact same deterministic Rule Engine (risk-engine.ts),
 * Role-Based State Machine (workflow.ts), and Mock Scenarios (mock-scenarios.ts)
 * as the Node.js SQLite backend, persisting state in localStorage so the
 * public Cloudflare deployment works 100% interactively without requiring a Node VM.
 */
import { GoogleGenAI } from "@google/genai";
import { evaluateRisk, maskSecrets, parseChangedFiles } from "./risk-engine";
import { findPreset, SCENARIO_PRESETS, SEED_APPROVAL_NOTES, SEED_RELEASES } from "./mock-scenarios";
import { DecisionAction, LAYER_BY_STATUS, LAYERS, validateDecision, validateResubmit } from "./workflow";
import { AISource, AISummary, ApprovalLog, ReleaseMR, ReleaseRequest, User } from "./types";

const STORAGE_KEY = "RAMA_CF_SIM_STATE_V1";
const BLOCKED_STATUS = "DITOLAK_SISTEM";

interface SimState {
  users: User[];
  releases: ReleaseRequest[];
  logs: ApprovalLog[];
  nextMrNum: number;
}

const DEFAULT_USERS: User[] = [
  { id: 1, name: "Helmy (Developer)", email: "helmy.dev@uii.ac.id", role: "DEVELOPER", title: "Full-Stack Engineer · Tim Aplikasi", avatar: "HD" },
  { id: 2, name: "Nadia Putri", email: "nadia.pm@uii.ac.id", role: "PM", title: "Project Manager", avatar: "NP" },
  { id: 3, name: "Dimas Prakoso", email: "dimas.core@uii.ac.id", role: "CORE", title: "Tim Core · Arsitektur & Database", avatar: "DP" },
  { id: 4, name: "Rizky Pratama", email: "rizky.interop@uii.ac.id", role: "INTEROP", title: "Tim Interoperability · API Gateway", avatar: "RP" },
];

function buildMrSet(p: {
  releaseId: number;
  iterasi: number;
  repo: string;
  featureBranch: string;
  authorName: string;
  at: string;
  firstNumber: number;
}): ReleaseMR[] {
  return LAYERS.map((l, idx) => {
    const source = l.layer === 1 ? p.featureBranch : l.source;
    const mrRef = `!${p.firstNumber + idx}`;
    if (l.layer === 1) {
      return {
        id: p.firstNumber + idx,
        release_id: p.releaseId,
        iterasi: p.iterasi,
        layer: 1,
        repo: p.repo,
        source_branch: source,
        target_branch: l.target,
        mr_ref: mrRef,
        status: "DISETUJUI",
        opened_at: p.at,
        decided_at: p.at,
        decided_by_name: p.authorName,
      };
    }
    if (l.layer === 2) {
      return {
        id: p.firstNumber + idx,
        release_id: p.releaseId,
        iterasi: p.iterasi,
        layer: 2,
        repo: p.repo,
        source_branch: source,
        target_branch: l.target,
        mr_ref: mrRef,
        status: "MENUNGGU",
        opened_at: p.at,
        decided_at: null,
        decided_by_name: null,
      };
    }
    return {
      id: p.firstNumber + idx,
      release_id: p.releaseId,
      iterasi: p.iterasi,
      layer: l.layer,
      repo: p.repo,
      source_branch: source,
      target_branch: l.target,
      mr_ref: mrRef,
      status: "BELUM_DIMULAI",
      opened_at: null,
      decided_at: null,
      decided_by_name: null,
    };
  });
}

function createInitialSeedState(): SimState {
  const users = DEFAULT_USERS;
  const userByLayer: Record<number, User> = { 1: users[0], 2: users[1], 3: users[2], 4: users[3] };
  const statusWaitingAt: Record<number, string> = { 2: "Pending_PM", 3: "Pending_Core", 4: "Pending_Interop" };

  const releases: ReleaseRequest[] = [];
  const logs: ApprovalLog[] = [];
  let logId = 1;
  let maxMr = 900;
  const now = Date.now();

  SEED_RELEASES.forEach((seed, idx) => {
    const releaseId = idx + 1;
    const preset = SCENARIO_PRESETS.find((p) => p.key === seed.presetKey)!;
    const files = parseChangedFiles(preset.git_diff);
    const risk = evaluateRisk(files, preset.git_diff);
    const { masked } = maskSecrets(preset.git_diff);

    const stopLayer =
      seed.status === "Approved"
        ? 5
        : seed.status === "Perlu_Revisi"
        ? seed.rejectedAtLayer!
        : { Pending_PM: 2, Pending_Core: 3, Pending_Interop: 4 }[seed.status]!;
    const decisions = Math.max(0, Math.min(stopLayer, 5) - 2) + (seed.status === "Perlu_Revisi" ? 1 : 0);
    const stepMs = (seed.createdMinutesAgo * 60_000) / (decisions + 0.6);
    const t0 = now - seed.createdMinutesAgo * 60_000;
    const at = (i: number) => new Date(t0 + stepMs * i).toISOString();
    const lastAt = at(decisions);

    const mrs = buildMrSet({
      releaseId,
      iterasi: 1,
      repo: preset.repo,
      featureBranch: preset.feature_branch,
      authorName: users[0].name,
      at: at(0),
      firstNumber: seed.mrBase,
    });
    maxMr = Math.max(maxMr, seed.mrBase + 4);

    const relLogs: ApprovalLog[] = [];
    const pushLog = (entry: Omit<ApprovalLog, "id">) => {
      const full: ApprovalLog = { id: logId++, ...entry };
      relLogs.push(full);
      logs.push(full);
    };

    pushLog({
      release_id: releaseId,
      release_kode: seed.kode,
      layer: 1,
      user_id: users[0].id,
      user_name: users[0].name,
      role_at_action: "DEVELOPER",
      action: "SUBMIT",
      from_status: "Draft_GitLab",
      to_status: "Pending_PM",
      comment: `MR layer 1 (${preset.feature_branch} → develop) di-merge (simulasi). Release Request dibuat; MR layer 2 dibuka.`,
      source: "simulasi",
      created_at: at(0),
    });

    for (let layer = 2; layer < Math.min(stopLayer, 5); layer++) {
      const t = at(layer - 1);
      const u = userByLayer[layer];
      const mr = mrs.find((m) => m.layer === layer)!;
      mr.status = "DISETUJUI";
      mr.opened_at = mr.opened_at || t;
      mr.decided_at = t;
      mr.decided_by_name = u.name;

      if (layer < 4) {
        const nextMr = mrs.find((m) => m.layer === layer + 1)!;
        nextMr.status = "MENUNGGU";
        nextMr.opened_at = t;
      }

      pushLog({
        release_id: releaseId,
        release_kode: seed.kode,
        layer,
        user_id: u.id,
        user_name: u.name,
        role_at_action: u.role,
        action: "APPROVE",
        from_status: statusWaitingAt[layer],
        to_status: layer === 4 ? "Approved" : statusWaitingAt[layer + 1],
        comment: SEED_APPROVAL_NOTES[layer as 2 | 3 | 4],
        source: "simulasi",
        created_at: t,
      });
    }

    if (seed.status === "Perlu_Revisi") {
      const layer = seed.rejectedAtLayer!;
      const t = at(decisions);
      const u = userByLayer[layer];
      const mr = mrs.find((m) => m.layer === layer)!;
      mr.status = "DITOLAK";
      mr.opened_at = mr.opened_at || t;
      mr.decided_at = t;
      mr.decided_by_name = u.name;

      pushLog({
        release_id: releaseId,
        release_kode: seed.kode,
        layer,
        user_id: u.id,
        user_name: u.name,
        role_at_action: u.role,
        action: "REJECT",
        from_status: statusWaitingAt[layer],
        to_status: "Perlu_Revisi",
        comment: seed.rejectReason || "Perlu revisi.",
        source: "simulasi",
        created_at: t,
      });
    }

    releases.push({
      id: releaseId,
      kode: seed.kode,
      judul: preset.judul,
      modul: preset.modul,
      repo: preset.repo,
      feature_branch: preset.feature_branch,
      author_id: users[0].id,
      author_name: users[0].name,
      status: seed.status,
      risk_level: risk.level,
      triggered_rules: risk.triggeredRules,
      changed_files: files,
      git_diff: masked,
      ai_summary: preset.contohSummary,
      ai_source: "contoh",
      rollback_plan: preset.rollback_plan,
      iterasi: 1,
      created_at: at(0),
      updated_at: lastAt,
      mrs,
      logs: relLogs,
    });
  });

  // Sort releases descending by id (newest first) just like SQLite
  releases.sort((a, b) => b.id - a.id);

  return { users, releases, logs, nextMrNum: maxMr + 1 };
}

function loadState(): SimState {
  if (typeof window === "undefined") return createInitialSeedState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SimState;
      if (Array.isArray(parsed.releases) && Array.isArray(parsed.users)) {
        return parsed;
      }
    }
  } catch {
    // ignore corrupt storage
  }
  const initial = createInitialSeedState();
  saveState(initial);
  return initial;
}

function saveState(state: SimState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota error
  }
}

async function summarizeInBrowser(params: {
  judul: string;
  maskedDiff: string;
  presetKey?: string;
  rawDiffForPresetMatch?: string;
  apiKey?: string;
}): Promise<{ summary: AISummary | null; source: AISource }> {
  const key = params.apiKey?.trim();
  if (key) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.interactions.create({
        model: "gemini-3.8-flash",
        system_instruction:
          "Anda membantu approver non-teknis di BSI UII memahami git diff. Tulis Bahasa Indonesia sederhana. JANGAN menyebut level risiko (LOW/MEDIUM/HIGH), JANGAN klaim aman, JANGAN menulis angka/estimasi waktu.",
        input: `Judul perubahan: ${params.judul}\n\n<diff>\n${params.maskedDiff.slice(0, 12000)}\n</diff>`,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              ringkasan: { type: "string" },
              dampak_pengguna: { type: "array", items: { type: "string" } },
              pertanyaan_untuk_developer: { type: "array", items: { type: "string" } },
            },
            required: ["ringkasan", "dampak_pengguna", "pertanyaan_untuk_developer"],
          },
        },
        store: false,
      });
      if (res.output_text) {
        const parsed = JSON.parse(res.output_text) as AISummary;
        if (parsed.ringkasan) return { summary: parsed, source: "gemini" };
      }
    } catch (err) {
      console.warn("[RAMA Browser AI] Gagal memanggil Gemini:", err);
    }
    return { summary: null, source: "tidak_tersedia" };
  }

  const preset = findPreset(params.presetKey) || SCENARIO_PRESETS.find((p) => p.git_diff.trim() === params.rawDiffForPresetMatch?.trim());
  if (preset && params.rawDiffForPresetMatch?.trim() === preset.git_diff.trim()) {
    return { summary: preset.contohSummary, source: "contoh" };
  }
  return { summary: null, source: "tidak_tersedia" };
}

export function browserGetDashboard() {
  const state = loadState();
  return {
    ok: true,
    mode: "simulasi",
    users: state.users,
    releases: state.releases,
    logs: state.logs,
    presets: SCENARIO_PRESETS.map(({ contohSummary: _omit, ...p }) => p),
    geminiConfigured: false,
  };
}

export function browserResetDemo() {
  const fresh = createInitialSeedState();
  saveState(fresh);
  return { ok: true, message: "Data simulasi dikembalikan ke kondisi awal." };
}

export async function browserCreateRelease(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const state = loadState();
  const actor = state.users.find((u) => u.id === Number(body.actor_id));
  if (!actor) return { status: 401, data: { ok: false, error: "Pengguna tidak dikenal." } };
  if (actor.role !== "DEVELOPER") {
    return {
      status: 403,
      data: { ok: false, error: "Hanya Developer yang dapat membuat Release Request (setelah MR layer 1 di-merge ke develop)." },
    };
  }
  const judul = String(body.judul || "").trim();
  const modul = String(body.modul || "").trim() || "-";
  const repo = String(body.repo || "").trim();
  const featureBranch = String(body.feature_branch || "").trim();
  const rollbackPlan = String(body.rollback_plan || "").trim();
  const gitDiff = String(body.git_diff || "").trim();

  if (!judul || !gitDiff) {
    return { status: 422, data: { ok: false, error: "Judul dan git diff wajib diisi." } };
  }
  if (!featureBranch.startsWith("feature/")) {
    return { status: 422, data: { ok: false, error: "Branch layer 1 harus diawali 'feature/' (feature → develop)." } };
  }

  const files = parseChangedFiles(gitDiff);
  const risk = evaluateRisk(files, gitDiff);
  const { masked } = maskSecrets(gitDiff);
  const ai = await summarizeInBrowser({
    judul,
    maskedDiff: masked,
    presetKey: body.preset_key ? String(body.preset_key) : undefined,
    rawDiffForPresetMatch: gitDiff,
    apiKey: body.api_key ? String(body.api_key) : undefined,
  });

  const maxId = state.releases.reduce((acc, r) => Math.max(acc, r.id), 0);
  const maxKodeNum = state.releases.reduce((acc, r) => Math.max(acc, Number(r.kode.split("-").pop()) || 0), 0);
  const releaseId = maxId + 1;
  const kode = `REL-2026-${String(maxKodeNum + 1).padStart(3, "0")}`;
  const now = new Date().toISOString();

  const mrs = buildMrSet({
    releaseId,
    iterasi: 1,
    repo,
    featureBranch,
    authorName: actor.name,
    at: now,
    firstNumber: state.nextMrNum,
  });
  state.nextMrNum += 4;

  const logEntry: ApprovalLog = {
    id: state.logs.reduce((acc, l) => Math.max(acc, l.id), 0) + 1,
    release_id: releaseId,
    release_kode: kode,
    layer: 1,
    user_id: actor.id,
    user_name: actor.name,
    role_at_action: actor.role,
    action: "SUBMIT",
    from_status: "Draft_GitLab",
    to_status: "Pending_PM",
    comment: `MR layer 1 (${featureBranch} → develop) di-merge (simulasi). Release Request dibuat; MR layer 2 dibuka. Risiko ${risk.level} dari rule engine.`,
    source: "simulasi",
    created_at: now,
  };
  state.logs.push(logEntry);

  const created: ReleaseRequest = {
    id: releaseId,
    kode,
    judul,
    modul,
    repo,
    feature_branch: featureBranch,
    author_id: actor.id,
    author_name: actor.name,
    status: "Pending_PM",
    risk_level: risk.level,
    triggered_rules: risk.triggeredRules,
    changed_files: files,
    git_diff: masked,
    ai_summary: ai.summary,
    ai_source: ai.source,
    rollback_plan: rollbackPlan,
    iterasi: 1,
    created_at: now,
    updated_at: now,
    mrs,
    logs: [logEntry],
  };

  state.releases.unshift(created);
  saveState(state);
  return { status: 200, data: { ok: true, release: created, message: "Release Request dibuat dan menunggu PM." } };
}

export function browserDecide(releaseId: number, body: Record<string, unknown>): { status: number; data: Record<string, unknown> } {
  const state = loadState();
  const actor = state.users.find((u) => u.id === Number(body.actor_id));
  if (!actor) return { status: 401, data: { ok: false, error: "Pengguna tidak dikenal." } };
  const release = state.releases.find((r) => r.id === releaseId);
  if (!release) return { status: 404, data: { ok: false, error: "Release Request tidak ditemukan." } };

  const action = body.action as DecisionAction;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const requestedLayer = body.layer !== undefined ? Number(body.layer) : undefined;

  const check = validateDecision({ release, actor, action, note, requestedLayer });
  const now = new Date().toISOString();
  const nextLogId = state.logs.reduce((acc, l) => Math.max(acc, l.id), 0) + 1;

  if (!check.ok) {
    const blockedLog: ApprovalLog = {
      id: nextLogId,
      release_id: release.id,
      release_kode: release.kode,
      layer: requestedLayer ?? LAYER_BY_STATUS[release.status] ?? null,
      user_id: actor.id,
      user_name: actor.name,
      role_at_action: actor.role,
      action: "BLOCKED",
      from_status: release.status,
      to_status: BLOCKED_STATUS,
      comment: `Percobaan ${action} ditolak server (${check.httpStatus}): ${check.error}${note ? ` · Catatan aktor: "${note}"` : ""}`,
      source: "simulasi",
      created_at: now,
    };
    state.logs.push(blockedLog);
    release.logs.push(blockedLog);
    saveState(state);
    return { status: check.httpStatus, data: { ok: false, error: check.error, release } };
  }

  const mr = release.mrs.find((m) => m.layer === check.layer);
  if (mr) {
    mr.status = action === "APPROVE" ? "DISETUJUI" : "DITOLAK";
    mr.decided_at = now;
    mr.decided_by_name = actor.name;
  }
  if (action === "APPROVE" && check.layer < 4) {
    const nextMr = release.mrs.find((m) => m.layer === check.layer + 1);
    if (nextMr) {
      nextMr.status = "MENUNGGU";
      nextMr.opened_at = now;
    }
  }

  const prevStatus = release.status;
  release.status = check.nextStatus;
  release.updated_at = now;

  const okLog: ApprovalLog = {
    id: nextLogId,
    release_id: release.id,
    release_kode: release.kode,
    layer: check.layer,
    user_id: actor.id,
    user_name: actor.name,
    role_at_action: actor.role,
    action,
    from_status: prevStatus,
    to_status: check.nextStatus,
    comment: note || (action === "APPROVE" ? `Disetujui; MR layer ${check.layer} di-merge (simulasi).` : "Ditolak."),
    source: "simulasi",
    created_at: now,
  };
  state.logs.push(okLog);
  release.logs.push(okLog);
  saveState(state);

  const message =
    action === "REJECT"
      ? `Ditolak di layer ${check.layer}. Request dikembalikan ke developer (Perlu_Revisi).`
      : check.nextStatus === "Approved"
      ? "Layer 4 disetujui. Request Dirilis (simulasi)."
      : `Layer ${check.layer} disetujui dan di-merge (simulasi). MR layer ${check.layer + 1} dibuka.`;
  return { status: 200, data: { ok: true, release, message } };
}

export function browserResubmit(releaseId: number, body: Record<string, unknown>): { status: number; data: Record<string, unknown> } {
  const state = loadState();
  const actor = state.users.find((u) => u.id === Number(body.actor_id));
  if (!actor) return { status: 401, data: { ok: false, error: "Pengguna tidak dikenal." } };
  const release = state.releases.find((r) => r.id === releaseId);
  if (!release) return { status: 404, data: { ok: false, error: "Release Request tidak ditemukan." } };

  const check = validateResubmit({ release, actor });
  const now = new Date().toISOString();
  const nextLogId = state.logs.reduce((acc, l) => Math.max(acc, l.id), 0) + 1;

  if (!check.ok) {
    const blockedLog: ApprovalLog = {
      id: nextLogId,
      release_id: release.id,
      release_kode: release.kode,
      layer: 1,
      user_id: actor.id,
      user_name: actor.name,
      role_at_action: actor.role,
      action: "BLOCKED",
      from_status: release.status,
      to_status: BLOCKED_STATUS,
      comment: `Percobaan kirim ulang ditolak server (${check.httpStatus}): ${check.error}`,
      source: "simulasi",
      created_at: now,
    };
    state.logs.push(blockedLog);
    release.logs.push(blockedLog);
    saveState(state);
    return { status: check.httpStatus, data: { ok: false, error: check.error, release } };
  }

  release.iterasi += 1;
  release.status = "Pending_PM";
  release.updated_at = now;
  release.mrs = buildMrSet({
    releaseId: release.id,
    iterasi: release.iterasi,
    repo: release.repo,
    featureBranch: release.feature_branch,
    authorName: actor.name,
    at: now,
    firstNumber: state.nextMrNum,
  });
  state.nextMrNum += 4;

  const note = typeof body.note === "string" ? body.note.trim() : "";
  const logEntry: ApprovalLog = {
    id: nextLogId,
    release_id: release.id,
    release_kode: release.kode,
    layer: 1,
    user_id: actor.id,
    user_name: actor.name,
    role_at_action: actor.role,
    action: "RESUBMIT",
    from_status: "Perlu_Revisi",
    to_status: "Pending_PM",
    comment: note || `Revisi di-merge ulang ke develop (simulasi, iterasi ${release.iterasi}). Kembali ke PM.`,
    source: "simulasi",
    created_at: now,
  };
  state.logs.push(logEntry);
  release.logs.push(logEntry);
  saveState(state);

  return { status: 200, data: { ok: true, release, message: "Dikirim ulang. Request kembali ke Pending_PM." } };
}

export async function browserRegenerateSummary(releaseId: number, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const state = loadState();
  const release = state.releases.find((r) => r.id === releaseId);
  if (!release) return { status: 404, data: { ok: false, error: "Release Request tidak ditemukan." } };

  const ai = await summarizeInBrowser({
    judul: release.judul,
    maskedDiff: release.git_diff,
    rawDiffForPresetMatch: release.git_diff,
    apiKey: body.api_key ? String(body.api_key) : undefined,
  });
  release.ai_summary = ai.summary;
  release.ai_source = ai.source;
  saveState(state);

  return {
    status: 200,
    data: {
      ok: true,
      release,
      message: ai.source === "gemini" ? "Ringkasan dibuat ulang oleh Gemini." : ai.source === "contoh" ? "Menampilkan contoh output AI." : "Ringkasan AI tidak tersedia.",
    },
  };
}
