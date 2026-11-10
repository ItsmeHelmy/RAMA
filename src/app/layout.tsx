import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAMA Dashboard — BSI UII Release Orchestration & AI Approval Engine",
  description:
    "Request, Align, Monitor, Approve: Middleware & Workflow Engine cerdas berbasis Gemini AI untuk mencegah Blind Approval pada deployment berjenjang di BSI UII.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="dark">
      <body className="min-h-screen bg-[#060d1a] text-slate-100 antialiased selection:bg-amber-500/30 selection:text-amber-200">
        {children}
      </body>
    </html>
  );
}
