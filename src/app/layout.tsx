import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAMA — Pantau & Setujui Rilis Aplikasi Berjenjang di BSI UII",
  description:
    "Pantau dan setujui rilis aplikasi secara berjenjang di BSI UII dengan penanda risiko otomatis, penjelasan singkat AI, dan riwayat keputusan.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-screen bg-[#f8fafc] font-sans text-ink antialiased selection:bg-brand-100 selection:text-brand-700">
        {children}
      </body>
    </html>
  );
}
