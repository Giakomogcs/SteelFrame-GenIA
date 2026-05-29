import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy de geocoding server-side.
 *
 * O Nominatim (OSM) exige um `User-Agent` identificando a aplicação e bloqueia
 * (HTTP 403) requisições anônimas feitas direto do navegador — além de o browser
 * não permitir definir `User-Agent` no `fetch`. Por isso a busca de endereço é
 * feita aqui, no servidor, onde podemos enviar os headers corretos.
 *
 * GET /api/geocode?q=<endereço, cidade, CEP, ou "lat,lng">
 * Retorna: { lat, lon, displayName, address }[]
 */

interface NominatimResult {
  lat: string;
  lon: string;
  display_name?: string;
  address?: Record<string, string>;
}

const USER_AGENT =
  "SteelFrame-GenIA/1.0 (https://github.com/senai/steelframe-genia)";

const CEP_RE = /^\d{5}-?\d{3}$/;
const LATLNG_RE = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { error: "Parâmetro 'q' é obrigatório." },
      { status: 400 },
    );
  }

  try {
    // Coordenadas "lat,lng" — devolve direto e tenta reverse-geocoding.
    if (LATLNG_RE.test(q)) {
      const [lat, lon] = q.split(",").map((s) => parseFloat(s.trim()));
      const reverse = await fetchReverse(lat, lon);
      return NextResponse.json([
        {
          lat: String(lat),
          lon: String(lon),
          displayName:
            reverse?.display_name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
          address: reverse?.address ?? null,
        },
      ]);
    }

    // CEP — usa ViaCEP para montar um endereço textual e geocodifica.
    let query = q;
    if (CEP_RE.test(q)) {
      const cep = q.replace(/\D/g, "");
      const via = await fetchViaCep(cep);
      if (via) query = via;
    }

    const results = await fetchSearch(query);
    return NextResponse.json(
      results.map((r) => ({
        lat: r.lat,
        lon: r.lon,
        displayName: r.display_name ?? null,
        address: r.address ?? null,
      })),
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Falha no geocoding." },
      { status: 502 },
    );
  }
}

async function fetchSearch(query: string): Promise<NominatimResult[]> {
  // 1) Nominatim (preferencial — endereço estruturado completo).
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&countrycodes=br&q=` +
      encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as NominatimResult[];
      if (data.length > 0) return data;
    }
    // 429 (rate limit) ou vazio → cai para o Photon.
  } catch {
    /* rede falhou — tenta o fallback */
  }

  // 2) Photon (Komoot) — sem chave, sem rate-limit agressivo.
  return fetchPhoton(query);
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

async function fetchPhoton(query: string): Promise<NominatimResult[]> {
  const url =
    `https://photon.komoot.io/api/?limit=5&lang=default&q=` +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Geocoding indisponível (${res.status}).`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const features = (json.features ?? []).filter(
    (f) =>
      !f.properties?.country ||
      /bra[sz]il/i.test(f.properties.country) ||
      f.properties.country === "BR",
  );
  return features
    .filter((f) => f.geometry?.coordinates)
    .map((f) => {
      const [lon, lat] = f.geometry!.coordinates!;
      const p = f.properties ?? {};
      const displayName = [
        [p.street, p.housenumber].filter(Boolean).join(", "),
        p.district,
        p.city,
        p.state,
        p.postcode,
        p.country,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        lat: String(lat),
        lon: String(lon),
        display_name: displayName || p.name,
        address: {
          road: p.street ?? "",
          house_number: p.housenumber ?? "",
          suburb: p.district ?? "",
          city: p.city ?? "",
          state: p.state ?? "",
          postcode: p.postcode ?? "",
        },
      } as NominatimResult;
    });
}

async function fetchReverse(
  lat: number,
  lon: number,
): Promise<NominatimResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (res.ok) return (await res.json()) as NominatimResult;
  } catch {
    /* ignora — reverse é opcional */
  }
  return null;
}

async function fetchViaCep(cep: string): Promise<string | null> {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      erro?: boolean;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };
    if (data.erro) return null;
    return [data.logradouro, data.bairro, data.localidade, data.uf, "Brasil"]
      .filter(Boolean)
      .join(", ");
  } catch {
    return null;
  }
}
