import Link from "next/link";
import { prisma } from "@sfg/db";
import { TerrainCard } from "@/components/TerrainCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const terrains = await prisma.terrain.findMany({
    include: { buildings: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="dt-status-pill mb-3">
            SENAI · Distrito Tecnológico
          </span>
          <h1 className="text-3xl font-extrabold uppercase tracking-tight text-white">
            Meus terrenos
          </h1>
          <p className="text-sm text-white/60">
            Cadastre terrenos pelo mapa de satélite e gere modelos 3D steel
            frame com IA.
          </p>
        </div>
      </div>

      {terrains.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur">
          <p className="text-white/80">
            Você ainda não cadastrou nenhum terreno.
          </p>
          <Link
            href="/terrenos/novo"
            className="dt-btn-primary mt-4 inline-flex text-sm"
          >
            Cadastrar primeiro terreno
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {terrains.map((t) => (
            <TerrainCard key={t.id} terrain={t} />
          ))}
        </div>
      )}
    </div>
  );
}
