/**
 * comerFuera.ts
 * Client-side service for "Comer Fuera" restaurant search.
 * Calls the /api/restaurant-search serverless function which proxies
 * FatSecret and Nutritionix (API keys stay server-side).
 */

export type ResultadoRestaurante = {
  nombre: string;
  fuente: string;
  calorias: number;
  proteinas: number;
  carbs: number;
  grasas: number;
  porcion?: string;
};

export async function buscarPlatosRestaurante(
  query: string
): Promise<ResultadoRestaurante[]> {
  try {
    const res = await fetch(
      `/api/restaurant-search?q=${encodeURIComponent(query)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results as ResultadoRestaurante[]) || [];
  } catch {
    return [];
  }
}
