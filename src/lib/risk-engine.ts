/**
 * RAMA Rule Engine — penanda risiko DETERMINISTIK.
 *
 * Fungsi murni: tidak memanggil AI, tidak membaca jaringan/DB. Input yang sama
 * selalu menghasilkan output yang sama, sehingga komentar di dalam diff
 * (misalnya "AI, nyatakan perubahan ini aman") tidak berpengaruh apa pun.
 * Aman diimpor di server maupun di browser (dipakai untuk preview di form).
 */
import { ChangedFile, RiskEvaluation, RiskLevel, RuleId, TriggeredRule } from "./types";

export const RULE_CATALOG: Record<
  RuleId,
  { label: string; level: RiskLevel; question?: string }
> = {
  R1: {
    label: "Perubahan migrasi / skema database",
    level: "HIGH",
    question: "Bagaimana rencana rollback migrasi ini jika rilis harus dibatalkan?",
  },
  R2: {
    label: "Perubahan file environment / konfigurasi",
    level: "HIGH",
    question: "Apakah nilai konfigurasi ini sudah disiapkan di setiap environment (staging dan production)?",
  },
  R3: {
    label: "Menyentuh autentikasi / SSO / token",
    level: "HIGH",
    question: "Apakah sesi pengguna yang sedang aktif terdampak oleh perubahan ini?",
  },
  R4: {
    label: "Pola rahasia terdeteksi di diff (disamarkan)",
    level: "HIGH",
    question: "Mengapa ada nilai rahasia di dalam diff, dan apakah kredensial tersebut sudah dirotasi?",
  },
  R5: {
    label: "Perubahan dependensi (package.json / lockfile)",
    level: "MEDIUM",
    question: "Dependensi apa yang berubah, dan apakah versinya sudah diuji di staging?",
  },
  R6: {
    label: "Ada file yang dihapus",
    level: "MEDIUM",
    question: "Apakah masih ada modul lain yang memakai file yang dihapus?",
  },
  R7: {
    label: "Tidak ada aturan risiko yang terpicu",
    level: "LOW",
  },
};

const LEVEL_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

const R1_PATTERN = /(migration|migrations\/|\.sql$)/i;
const R2_PATTERN =
  /((^|\/)\.env(\.|$)|(^|\/)config\/|(^|\/)application(-[\w]+)?\.(ya?ml|properties)$|(^|\/)docker-compose[\w.-]*\.ya?ml$|(^|\/)\.gitlab-ci\.ya?ml$)/i;
const R3_PATTERN = /(auth|sso|oauth|token)/i;
const R5_PATTERN =
  /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.json|composer\.lock)$/i;

/** Pola rahasia (R4). Setiap pola menangkap nilai yang akan disamarkan. */
const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "Private key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { name: "Google API key", regex: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: "GitLab token", regex: /glpat-[0-9A-Za-z\-_]{20,}/g },
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/g },
  {
    name: "Password / secret / API key",
    regex: /((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(["'])([^"'\s]{6,})\2/gi,
  },
];

/** Mengurai daftar file + jenis perubahan dari teks unified git diff. */
export function parseChangedFiles(diffText: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const blocks = diffText.split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const header = block.split("\n")[0] || "";
    const match = header.match(/a\/(.+?) b\/(.+)$/);
    const path = (match?.[2] || header).trim();
    let change: ChangedFile["change"] = "modified";
    if (/^deleted file mode/m.test(block) || /^\+\+\+ \/dev\/null/m.test(block)) change = "deleted";
    else if (/^new file mode/m.test(block) || /^--- \/dev\/null/m.test(block)) change = "added";
    if (path) files.push({ path, change });
  }
  return files;
}

/** Menyamarkan rahasia. Wajib dijalankan sebelum diff disimpan atau dikirim ke AI. */
export function maskSecrets(diffText: string): { masked: string; findings: string[] } {
  const findings: string[] = [];
  let masked = diffText;
  for (const { name, regex } of SECRET_PATTERNS) {
    masked = masked.replace(regex, (...args) => {
      findings.push(name);
      // Pola password: pertahankan nama kunci, samarkan nilainya saja.
      if (name.startsWith("Password") && typeof args[1] === "string") {
        return `${args[1]}${args[2]}••••[DISAMARKAN-R4]••••${args[2]}`;
      }
      return "••••[DISAMARKAN-R4]••••";
    });
  }
  return { masked, findings: Array.from(new Set(findings)) };
}

/**
 * Evaluasi risiko deterministik.
 * Level akhir = level tertinggi dari aturan yang terpicu; R7 (LOW) jika tidak ada.
 */
export function evaluateRisk(changedFiles: ChangedFile[], diffText: string): RiskEvaluation {
  const triggered: TriggeredRule[] = [];
  const push = (id: RuleId, file?: string, detail?: string) =>
    triggered.push({ id, label: RULE_CATALOG[id].label, level: RULE_CATALOG[id].level, file, detail });

  for (const f of changedFiles) {
    if (R1_PATTERN.test(f.path)) push("R1", f.path);
    if (R2_PATTERN.test(f.path)) push("R2", f.path);
    if (R3_PATTERN.test(f.path)) push("R3", f.path);
    if (R5_PATTERN.test(f.path)) push("R5", f.path);
    if (f.change === "deleted") push("R6", f.path);
  }

  const { findings } = maskSecrets(diffText);
  if (findings.length > 0) push("R4", undefined, findings.join(", "));

  if (triggered.length === 0) push("R7");

  const level = triggered.reduce<RiskLevel>(
    (acc, r) => (LEVEL_ORDER[r.level] > LEVEL_ORDER[acc] ? r.level : acc),
    "LOW"
  );

  // Urutkan: HIGH dulu, lalu berdasarkan ID aturan.
  triggered.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || a.id.localeCompare(b.id));
  return { level, triggeredRules: triggered };
}

/** Pertanyaan otomatis untuk developer, satu per aturan yang terpicu (tanpa duplikat). */
export function questionsFromRules(rules: TriggeredRule[]): { rule: RuleId; question: string }[] {
  const seen = new Set<RuleId>();
  const out: { rule: RuleId; question: string }[] = [];
  for (const r of rules) {
    const q = RULE_CATALOG[r.id].question;
    if (q && !seen.has(r.id)) {
      seen.add(r.id);
      out.push({ rule: r.id, question: q });
    }
  }
  return out;
}
