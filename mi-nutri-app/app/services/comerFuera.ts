/**
 * comerFuera.ts — service for "Comer Fuera" restaurant search.
 * Calls /api/restaurant-search (FatSecret proxy) by food category.
 */

export type ResultadoRestaurante = {
  nombre: string;
  restaurante?: string; // restaurant chain name if known
  calorias: number;
  proteinas: number;
  carbs: number;
  grasas: number;
  porcion?: string;
};

export async function buscarPorCategoria(
  category: string,
  lang: string
): Promise<ResultadoRestaurante[]> {
  try {
    const res = await fetch(
      `/api/restaurant-search?category=${encodeURIComponent(category)}&lang=${encodeURIComponent(lang)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results as ResultadoRestaurante[]) || [];
  } catch {
    return [];
  }
}
