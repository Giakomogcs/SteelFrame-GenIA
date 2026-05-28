import "./globals.css";
import type { Metadata } from "next";
import { prisma } from "@sfg/db";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "SteelFrame GenIA — SENAI Distrito Tecnológico",
  description:
    "Cadastre terrenos pelo mapa de satélite e gere modelos 3D de galpões steel frame com IA. SENAI Distrito Tecnológico.",
  icons: {
    icon: [{ url: "/brand/logo_dt.svg", type: "image/svg+xml" }],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let terrenoCount: number | undefined;
  try {
    terrenoCount = await prisma.terrain.count();
  } catch {
    /* db may not be ready */
  }

  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;900&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="app">
          <Sidebar counts={{ terrenos: terrenoCount }} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
