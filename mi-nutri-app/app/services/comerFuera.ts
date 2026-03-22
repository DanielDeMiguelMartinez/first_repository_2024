/**
 * comerFuera.ts — service for "Comer Fuera" feature.
 * Calls /api/nearby-restaurants to find real nearby chain restaurants
 * and their healthy menu options.
 */

export type PlatoSaludable = {
  nombre: string;
  calorias: number;
  proteinas: number;
  carbs: number;
  grasas: number;
  porcion?: string;
};

export type RestauranteCercano = {
  nombre: string;
  distancia?: number | null; // metros
  rating?: number | null;
  platos: PlatoSaludable[];
};

// For the "add to meal" modal — plato + which restaurant it belongs to
export type PlatoParaAnadir = PlatoSaludable & { restaurante: string };

export type RespuestaCercanos = {
  restaurantes: RestauranteCercano[];
  modo?: "cercanos" | "popular"; // "popular" = no GPS/API keys, showing popular chains
  error?: string;
};

export async function buscarRestaurantesCercanos(
  lat: number,
  lon: number,
  country = "",
  radio = 5000
): Promise<RespuestaCercanos> {
  try {
    const url = `/api/nearby-restaurants?lat=${lat}&lon=${lon}&radius=${radio}&country=${encodeURIComponent(country)}`;
    const res = await fetch(url);
    if (!res.ok) return { restaurantes: [], modo: "popular" };
    return await res.json();
  } catch {
    return { restaurantes: [], modo: "popular" };
  }
}

export async function buscarRestaurantesPopulares(country = ""): Promise<RespuestaCercanos> {
  try {
    const url = `/api/nearby-restaurants?country=${encodeURIComponent(country)}`;
    const res = await fetch(url);
    if (!res.ok) return { restaurantes: [], modo: "popular" };
    return await res.json();
  } catch {
    return { restaurantes: [], modo: "popular" };
  }
}
