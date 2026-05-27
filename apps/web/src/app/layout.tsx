import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "SteelFrame GenIA",
  description:
    "Cadastre terrenos pelo mapa e gere modelos 3D de galpões steel frame com IA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-block h-7 w-7 rounded bg-gradient-to-br from-brand-500 to-brand-700" />
              SteelFrame <span className="text-brand-500">GenIA</span>
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="text-slate-300 hover:text-white">
                Terrenos
              </Link>
              <Link
                href="/terrenos/novo"
                className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-500"
              >
                + Novo terreno
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
