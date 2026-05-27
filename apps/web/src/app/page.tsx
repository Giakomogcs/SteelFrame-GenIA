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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Meus terrenos</h1>
        <p className="text-sm text-slate-400">
          Cadastre terrenos pelo mapa de satélite e gere modelos 3D steel frame com IA.
        </p>
      </div>

      {terrains.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-slate-900/40 p-10 text-center">
          <p className="text-slate-300">Você ainda não cadastrou nenhum terreno.</p>
          <Link
            href="/terrenos/novo"
            className="mt-4 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium hover:bg-brand-500"
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
