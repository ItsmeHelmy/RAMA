import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAMA — Review & Pelacakan Rilis BSI UII",
  description:
    "Simulasi rilis berjenjang BSI UII dengan pelacakan PIC, penanda risiko, bantuan memahami perubahan, dan jejak keputusan.",
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
