import "./globals.css";
import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "SteelFrame GenIA — SENAI Distrito Tecnológico",
  description:
    "Cadastre terrenos pelo mapa de satélite e gere modelos 3D de galpões steel frame com IA. SENAI Distrito Tecnológico.",
  icons: {
    icon: [{ url: "/brand/logo_dt.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={montserrat.variable}>
      <body className="font-sans">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[#161419]/70 backdrop-blur">
          <div className="mx-auto max-w-7xl px-6">
            <div className="brand">
              <Link
                href="/"
                className="flex items-center gap-3"
                aria-label="SteelFrame GenIA — SENAI Distrito Tecnológico"
              >
                <Image
                  src="/brand/logo_completo.svg"
                  alt="SENAI Distrito Tecnológico"
                  width={180}
                  height={56}
                  className="brand-logo"
                  priority
                />
              </Link>

              <div className="brand-text hidden sm:flex">
                <span className="brand-title">SteelFrame GenIA</span>
                <span className="brand-sub">
                  Distrito Tecnológico · Steel Frame
                </span>
              </div>

              <nav className="flex items-center gap-3 text-sm">
                <Link
                  href="/"
                  className="hidden text-slate-300 hover:text-white md:inline"
                >
                  Terrenos
                </Link>
                <Link
                  href="/base-conhecimento"
                  className="hidden text-slate-300 hover:text-white md:inline"
                >
                  Base de conhecimento
                </Link>
                <Link href="/terrenos/novo" className="dt-btn-primary text-xs">
                  + Novo terreno
                </Link>
              </nav>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
