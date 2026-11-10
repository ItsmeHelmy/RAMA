import { AISummary, MRStatus, RiskLevel } from "./types";

export interface DemoScenarioPreset {
  key: string;
  label: string;
  badge: string;
  mr_code: string;
  title: string;
  repo_name: string;
  source_branch: string;
  target_branch: string;
  environment: string;
  version_tag: string;
  defaultStatus: MRStatus;
  git_diff: string;
  fallbackSummary: AISummary;
}

export const DEMO_SCENARIOS: DemoScenarioPreset[] = [
  {
    key: "qris-payment-gateway",
    label: "Skenario Utama Demo: Integrasi QRIS Dinamis & Auto-Rekonsiliasi SPP",
    badge: "COMPLEX GIT DIFF • HIGH IMPACT",
    mr_code: "MR-2026-841",
    title: "feat(payment-gateway): Integrasi QRIS Dinamis Lintas Bank & Rekonsiliasi Tagihan SPP Otomatis",
    repo_name: "bsi-uii / uii-tagihan-core-service",
    source_branch: "feat/qris-dynamic-reconciliation-v2",
    target_branch: "main",
    environment: "Production (Cluster Keuangan UII)",
    version_tag: "v3.8.0-rc1",
    defaultStatus: "Pending_PM",
    git_diff: `diff --git a/src/services/payment/QrisDynamicSettlementService.ts b/src/services/payment/QrisDynamicSettlementService.ts
index 4a9e11c..9f82d41 100644
--- a/src/services/payment/QrisDynamicSettlementService.ts
+++ b/src/services/payment/QrisDynamicSettlementService.ts
@@ -18,14 +18,52 @@ export class QrisDynamicSettlementService {
-  async verifyCallback(payload: LegacyBankPayload): Promise<boolean> {
-    // Validasi statis hanya mendukung 1 bank mitra tanpa pengecekan idempotency
-    if (!payload.trxId || payload.status !== 'PAID') return false;
-    await this.db.query('UPDATE tagihan_mahasiswa SET status = "LUNAS" WHERE id = ?', [payload.billId]);
-    return true;
+  async verifyAndSettleCallback(payload: Iso20022QrisPayload, signature: string): Promise<SettlementResult> {
+    // 1. Verifikasi HMAC-SHA512 Signature dari Gateway Interoperabilitas Bank Mitra (BSI, Mandiri, BPD)
+    const isAuthentic = this.cryptoVerifier.verifyHmacSha512(payload, signature, process.env.INTEROP_WEBHOOK_SECRET!);
+    if (!isAuthentic) {
+      this.auditLogger.warn('INVALID_QRIS_SIGNATURE_ATTEMPT', { rrn: payload.retrievalReferenceNumber });
+      throw new UnauthorizedWebhookException('Invalid HMAC-SHA512 signature from payment gateway');
+    }
+
+    // 2. Idempotency Guard berbasis Redis + Unique Constraint RRN untuk mencegah double-settlement SPP
+    const lockKey = \`qris:lock:\${payload.retrievalReferenceNumber}\`;
+    const acquired = await this.redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 120);
+    if (!acquired) {
+      return { status: 'DUPLICATE_IGNORED', rrn: payload.retrievalReferenceNumber };
+    }
+
+    // 3. Transaksi Atomic Database + Auto-Unlock KRS SIAKAD via Event Bus
+    return await this.db.transaction(async (trx) => {
+      const invoice = await trx.selectFrom('tagihan_mahasiswa')
+        .where('nomor_pembayaran', '=', payload.virtualAccountOrInvoiceNo)
+        .forUpdate()
+        .executeTakeFirstOrThrow();
+
+      if (Number(invoice.nominal_tagihan) !== Number(payload.paidAmount)) {
+        throw new AmountMismatchException(invoice.nominal_tagihan, payload.paidAmount);
+      }
+
+      await trx.updateTable('tagihan_mahasiswa')
+        .set({
+          status_bayar: 'LUNAS_TERVERIFIKASI',
+          metode_kanal: \`QRIS_\${payload.acquirerBankCode}\`,
+          paid_at: new Date().toISOString(),
+          rrn_reference: payload.retrievalReferenceNumber,
+        })
+        .where('id', '=', invoice.id)
+        .execute();
+
+      await this.interopEventBus.publish('siakad.krs.eligibility.unlocked', {
+        nim: invoice.nim_mahasiswa,
+        tahun_akademik: invoice.periode_akademik,
+        settled_at: new Date().toISOString(),
+      });
+
+      return { status: 'SETTLED', invoiceId: invoice.id, nim: invoice.nim_mahasiswa };
+    });
   }
 }
diff --git a/db/migrations/20261110_add_qris_rrn_index.sql b/db/migrations/20261110_add_qris_rrn_index.sql
new file mode 100644
index 0000000..c12a87b
--- /dev/null
+++ b/db/migrations/20261110_add_qris_rrn_index.sql
@@ -0,0 +1,9 @@
+ALTER TABLE tagihan_mahasiswa
+  ADD COLUMN rrn_reference VARCHAR(64) NULL,
+  ADD COLUMN metode_kanal VARCHAR(32) DEFAULT 'VA_LEGACY';
+
+CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_tagihan_rrn_unique
+  ON tagihan_mahasiswa (rrn_reference)
+  WHERE rrn_reference IS NOT NULL;`,
    fallbackSummary: {
      headline:
        "Otomatisasi Pelunasan SPP via QRIS Lintas Bank & Pembukaan Kunci KRS Real-Time",
      businessImpact: [
        "Mahasiswa kini dapat membayar tagihan SPP/Catur Darma menggunakan QRIS dari bank/e-wallet mana pun dan status KRS di SIAKAD langsung aktif dalam < 2 detik (sebelumnya butuh rekonsiliasi manual H+1).",
        "Menghilangkan antrean komplain bukti bayar manual di loket Direktorat Keuangan saat periode krusial Key-In KRS.",
        "Mendukung pencatatan kanal bank pengirim secara otomatis untuk laporan audit keuangan universitas.",
      ],
      technicalFixes: [
        "Menambahkan proteksi Idempotency Lock (Redis) dan pengecekan nominal presisi agar tidak terjadi duplikasi pelunasan (double-settlement) saat trafik pembayaran tinggi.",
        "Memperketat keamanan webhook dengan validasi tanda tangan digital HMAC-SHA512 sebelum mengubah status tagihan mahasiswa.",
        "Menambahkan transaksi database atomik (ACID) serta pengiriman sinyal otomatis ke layanan SIAKAD.",
      ],
      riskAnalysis: [
        "Tingkat Risiko: MEDIUM-HIGH — Menyentuh tabel utama `tagihan_mahasiswa` dan integrasi Event Bus lintas sistem (`uii-tagihan` ➔ `uii-siakad`).",
        "Mitigasi Database: Penambahan kolom dan indeks menggunakan `CREATE UNIQUE INDEX CONCURRENTLY` sehingga ZERO DOWNTIME (tidak mengunci tabel saat jam kerja).",
        "Kesiapan Rollback: Variabel `INTEROP_WEBHOOK_SECRET` wajib terpasang di API Gateway Interop sebelum rilis.",
      ],
      riskLevel: "HIGH",
      riskReason:
        "Modifikasi alur pelunasan keuangan utama & skema tabel tagihan_mahasiswa serta webhook eksternal bank mitra.",
      affectedModules: [
        "UII-Tagihan (Keuangan)",
        "UII-SIAKAD (Aktivasi KRS)",
        "API Gateway Bank Mitra",
      ],
      linesAdded: 48,
      linesRemoved: 5,
      filesChanged: 2,
      estimatedDowntime: "0 Menit (Zero-Downtime Migration)",
      rollbackReady: true,
      generatedBy: "rama-hybrid-ai",
    },
  },
  {
    key: "siakad-krs-rate-limiter",
    label: "Skenario 2: Optimasi Anti-Down War KRS SIAKAD & Caching Kuota Kelas",
    badge: "PERFORMANCE & CORE DB",
    mr_code: "MR-2026-839",
    title: "perf(siakad-krs): Implementasi Distributed Seat Lock & Optimasi Query Kuota Kelas",
    repo_name: "bsi-uii / uii-ras-krs-engine",
    source_branch: "perf/krs-war-redis-seat-lock",
    target_branch: "main",
    environment: "Production (Cluster Akademik)",
    version_tag: "v4.2.1",
    defaultStatus: "Pending_Core",
    git_diff: `diff --git a/src/modules/krs/KrsEnrollmentController.ts b/src/modules/krs/KrsEnrollmentController.ts
index 812b901..e310c4a 100644
--- a/src/modules/krs/KrsEnrollmentController.ts
+++ b/src/modules/krs/KrsEnrollmentController.ts
@@ -42,15 +42,32 @@ export class KrsEnrollmentController {
   async enrollCourseClass(req: EnrollRequest): Promise<EnrollResponse> {
-    // Query COUNT(*) langsung ke tabel PostgreSQL setiap klik mahasiswa (Bottleneck CPU 98% saat War KRS)
-    const currentCount = await this.db.raw('SELECT COUNT(*) FROM krs_ambil_kelas WHERE kelas_id = ?', [req.kelasId]);
-    const quota = await this.db.raw('SELECT kuota_maks FROM master_kelas WHERE id = ?', [req.kelasId]);
-    if (currentCount >= quota) {
-      throw new QuotaExceededError('Kuota kelas penuh');
-    }
-    await this.db.insert('krs_ambil_kelas', { nim: req.nim, kelas_id: req.kelasId });
+    // Gunakan Atomic Lua Script di Redis untuk reservasi kursi dalam < 1.5ms tanpa membebani DB Utama
+    const seatReserved = await this.seatCounterService.reserveSeatAtomic(req.kelasId, req.nim);
+    if (!seatReserved.allowed) {
+      return {
+        success: false,
+        reason: 'KUOTA_KELAS_PENUH',
+        remainingSeats: 0,
+      };
+    }
+
+    try {
+      await this.krsWriteQueue.enqueuePersistEnrollment({
+        nim: req.nim,
+        kelasId: req.kelasId,
+        reservedToken: seatReserved.token,
+        timestamp: Date.now(),
+      });
+      return { success: true, remainingSeats: seatReserved.remaining };
+    } catch (err) {
+      // Auto-compensate kuota jika gagal masuk antrean persistensi
+      await this.seatCounterService.releaseSeatAtomic(req.kelasId, req.nim);
+      throw err;
+    }
   }
 }`,
    fallbackSummary: {
      headline:
        "Pencegahan Server Down saat 'War KRS' dengan Reservasi Kuota Kelas Instan",
      businessImpact: [
        "Meningkatkan kapasitas sistem RAS/KRS hingga 15.000 mahasiswa bersamaan tanpa loading lambat atau error 504 Gateway Timeout.",
        "Menjamin keadilan kuota kelas: tidak ada lagi kasus kuota kelas tembus melebihi kapasitas (over-enrollment) akibat klik bersamaan.",
        "Pengalaman pengisian KRS mahasiswa jauh lebih responsif (< 50 milidetik per mata kuliah).",
      ],
      technicalFixes: [
        "Mengganti query berat `SELECT COUNT(*)` langsung ke database utama dengan penghitung kuota atomik di memori (Redis Atomic Counter).",
        "Menambahkan mekanisme kompensasi otomatis (auto-release seat) jika proses penyimpanan ke database gagal di tengah jalan.",
        "Memisahkan beban baca-tulis menggunakan antrean terkelola (Write Queue).",
      ],
      riskAnalysis: [
        "Tingkat Risiko: MEDIUM — Mengubah mekanisme pengecekan kursi kelas pada modul inti akademik (`uii-ras-krs-engine`).",
        "Mitigasi: Sinkronisasi awal kuota Redis dijalankan otomatis 15 menit sebelum jadwal Key-In KRS dimulai.",
        "Kesiapan Rollback: Tersedia feature flag `USE_REDIS_SEAT_LOCK` untuk kembali ke mode database standar dalam 5 detik jika diperlukan.",
      ],
      riskLevel: "MEDIUM",
      riskReason:
        "Perubahan arsitektur konkurensi pengambilan kursi KRS menggunakan Redis & antrean asinkron.",
      affectedModules: ["UII-RAS (Key-In KRS)", "Master Kelas Akademik", "Redis Cluster BSI"],
      linesAdded: 25,
      linesRemoved: 8,
      filesChanged: 1,
      estimatedDowntime: "0 Menit",
      rollbackReady: true,
      generatedBy: "rama-hybrid-ai",
    },
  },
  {
    key: "sso-oauth2-token-rotation",
    label: "Skenario 3: Sinkronisasi SSO UIIGateway & Patch Keamanan Token Mitra",
    badge: "SECURITY & INTEROP",
    mr_code: "MR-2026-835",
    title: "sec(sso-interop): Rotasi Otomatis Refresh Token OAuth2 & Sinkronisasi Role Pegawai",
    repo_name: "bsi-uii / uii-sso-identity-bridge",
    source_branch: "sec/oauth2-token-rotation-strict",
    target_branch: "main",
    environment: "Production (SSO Gateway)",
    version_tag: "v2.9.4",
    defaultStatus: "Pending_Interop",
    git_diff: `diff --git a/src/auth/OAuth2TokenGuard.ts b/src/auth/OAuth2TokenGuard.ts
index 67b2109..120f88c 100644
--- a/src/auth/OAuth2TokenGuard.ts
+++ b/src/auth/OAuth2TokenGuard.ts
@@ -11,8 +11,24 @@ export class OAuth2TokenGuard {
   async exchangeToken(clientId: string, refreshToken: string) {
-    const session = await this.tokenStore.find(refreshToken);
-    return this.jwtSigner.sign({ sub: session.userId, roles: session.roles }, { expiresIn: '30d' });
+    const session = await this.tokenStore.findAndInvalidate(refreshToken);
+    if (!session || session.revoked) {
+      // Deteksi token reuse attack: cabut seluruh sesi aktif user terkait
+      await this.tokenStore.revokeAllUserSessions(session?.userId);
+      throw new SecurityBreachException('Refresh token reuse detected');
+    }
+
+    // Sinkronisasi jabatan struktural terbaru dari HRIS UII
+    const latestRoles = await this.hrisDirectoryClient.getActiveStructuralRoles(session.userId);
+    const accessToken = this.jwtSigner.sign(
+      { sub: session.userId, roles: latestRoles, scope: session.scope },
+      { expiresIn: '15m', issuer: 'https://sso.uii.ac.id' }
+    );
+    const nextRefreshToken = await this.tokenStore.issueRotatedToken(session.userId);
+    return { accessToken, refreshToken: nextRefreshToken, expiresIn: 900 };
   }
 }`,
    fallbackSummary: {
      headline:
        "Peningkatan Keamanan Login SSO UII & Sinkronisasi Jabatan Otomatis",
      businessImpact: [
        "Perubahan jabatan struktural dosen/tendik di sistem SDM (HRIS) langsung tercermin pada hak akses aplikasi tanpa harus menunggu masa aktif login 30 hari habis.",
        "Melindungi akun sivitas akademika dari pembajakan sesi (session hijacking) di perangkat bersama.",
        "Memenuhi standar kepatuhan audit keamanan informasi ISO 27001 lingkungan BSI UII.",
      ],
      technicalFixes: [
        "Memangkas masa berlaku Access Token dari 30 hari menjadi 15 menit dengan rotasi Refresh Token otomatis di latar belakang.",
        "Menambahkan deteksi pencurian token (Token Reuse Detection) yang otomatis mengamankan akun jika terdeteksi anomali.",
        "Menghubungkan penerbitan token dengan direktori jabatan aktif HRIS UII.",
      ],
      riskAnalysis: [
        "Tingkat Risiko: MEDIUM — Berdampak pada kontrak respons API `/oauth/token` yang digunakan oleh aplikasi mobile UII & portal mitra.",
        "Mitigasi Interop: Aplikasi klien yang sudah mendukung standar OAuth2 Refresh Rotation tidak akan terdampak.",
        "Kesiapan Rollback: Mendukung grace period 60 detik untuk transisi jaringan lambat.",
      ],
      riskLevel: "MEDIUM",
      riskReason:
        "Perubahan durasi token JWT & skema rotasi refresh token pada gateway SSO terpusat.",
      affectedModules: ["UIIGateway SSO", "UII-HRIS (Kepegawaian)", "Mobile App Gateway"],
      linesAdded: 18,
      linesRemoved: 2,
      filesChanged: 1,
      estimatedDowntime: "0 Menit",
      rollbackReady: true,
      generatedBy: "rama-hybrid-ai",
    },
  },
  {
    key: "academic-transcript-pdf-sign",
    label: "Skenario 4: Tanda Tangan Elektronik BSrE pada Transkrip Nilai Digital",
    badge: "DEPLOYED EXAMPLE",
    mr_code: "MR-2026-830",
    title: "feat(akademik-doc): Integrasi TTE BSrE BSSN pada Cetak Transkrip & Surat Aktif Kuliah",
    repo_name: "bsi-uii / uii-dokumen-akademik-svc",
    source_branch: "feat/bsre-digital-signature-v1",
    target_branch: "main",
    environment: "Production (Layanan Akademik)",
    version_tag: "v2.1.0",
    defaultStatus: "Approved",
    git_diff: `diff --git a/src/services/pdf/BsreSignatureService.ts b/src/services/pdf/BsreSignatureService.ts
index 1120a4b..7821c0f 100644
--- a/src/services/pdf/BsreSignatureService.ts
+++ b/src/services/pdf/BsreSignatureService.ts
@@ -9,6 +9,19 @@ export class BsreSignatureService {
   async signOfficialTranscript(pdfBuffer: Buffer, nipPejabat: string): Promise<SignedDocument> {
+    const qrVerificationUrl = await this.verificationRegistry.registerDocumentHash(pdfBuffer);
+    const stampedPdf = await this.pdfQrEmbedder.embedVerificationQr(pdfBuffer, qrVerificationUrl);
+    const signedBuffer = await this.bsreClient.signPdfWithPassphraseHash({
+      file: stampedPdf,
+      nik: nipPejabat,
+      timeoutMs: 8000,
+      retryAttempts: 2,
+    });
+    return { signedBuffer, qrVerificationUrl, signedAt: new Date().toISOString() };
   }
 }`,
    fallbackSummary: {
      headline:
        "Penerbitan Transkrip & Surat Aktif Mahasiswa Ber-TTE Resmi BSrE dengan QR Validasi",
      businessImpact: [
        "Mahasiswa dapat mengunduh Transkrip Nilai dan Surat Keterangan Aktif Kuliah yang sudah sah secara hukum (TTE BSrE) secara mandiri dari rumah.",
        "Memangkas waktu tunggu legalisir dokumen fakultas dari rata-rata 3 hari kerja menjadi kurang dari 1 menit.",
        "Dilengkapi QR Code verifikasi keaslian dokumen yang dapat dipindai oleh instansi/perusahaan penerima beasiswa atau kerja.",
      ],
      technicalFixes: [
        "Menambahkan penyematan QR Code hash dokumen secara otomatis sebelum dikirim ke server BSrE.",
        "Menambahkan mekanisme retry otomatis (2x) dan batas waktu 8 detik untuk mengantisipasi lonjakan antrean di jaringan BSrE.",
      ],
      riskAnalysis: [
        "Tingkat Risiko: LOW — Modul berdiri sendiri (isolated service) dan tidak mengubah skema tabel nilai akademik.",
        "Mitigasi: Jika koneksi BSrE sedang pemeliharaan, dokumen masuk ke antrean tanda tangan otomatis (async queue).",
      ],
      riskLevel: "LOW",
      riskReason:
        "Penambahan layanan tanda tangan dokumen PDF tanpa perubahan skema database kritikal.",
      affectedModules: ["UII-Dokumen Akademik", "Konektor TTE BSrE", "Portal Mahasiswa"],
      linesAdded: 13,
      linesRemoved: 0,
      filesChanged: 1,
      estimatedDowntime: "0 Menit",
      rollbackReady: true,
      generatedBy: "rama-hybrid-ai",
    },
  },
];
