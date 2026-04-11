import { calcularMacros, Nutrientes } from "@/app/services/calcularMacros";
import { actualizarRacha } from "@/app/services/gamification";
import { useApp } from "@/app/services/i18n";
import { ALERGENOS_KEYWORDS } from "@/app/onboarding";
import { buscarDesdeEscaneoMultiple, buscarProductosPorNombre } from "@/app/services/openFoodFacts";
import { signalMealSaved } from "@/app/services/refreshSignal";
import { buscarAlimentosPersonalizados, guardarAlimentoBuscado, supabase } from "@/app/services/supabase";
import { detectarPaisUsuario } from "@/app/services/countryDetector";
import { rankear } from "@/app/services/fuzzySearch";
import { preprocesarQuery, normQuery } from "@/app/services/queryExpander";
import { syncDayToCloud } from "@/app/services/cloudSync";
import { FoodUnit, FOOD_UNIT_GRAMS, fromGrams } from "@/app/services/units";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Keyboard, Platform,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";

function getTodayKey(): string {
  const d = new Date();
  return `nutri_meals_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const STORAGE_KEY = getTodayKey();
const RECENT_FOODS_KEY = "nutri_recent_foods_v2";
const FAVORITES_KEY = "nutri_favorites";
const SEARCH_CACHE_KEY = "nutri_search_cache_v1"; // kept for legacy cleanup only
// País detectado una sola vez al iniciar (no cambia durante la sesión)
const PAIS_USUARIO = detectarPaisUsuario();

type MealKey = "desayuno" | "comida" | "merienda" | "cena";
const MEAL_LABELS: Record<MealKey, string> = { desayuno: "Desayuno", comida: "Comida", merienda: "Merienda", cena: "Cena" };
const MEAL_ICONS: Record<MealKey, string> = { desayuno: "🌅", comida: "☀️", merienda: "🍎", cena: "🌙" };

const SUPER_COLORS: Record<string, string> = {
  Mercadona: "#00A651", Carrefour: "#004A97", Lidl: "#0050AA",
  DIA: "#E30613", Alcampo: "#FF6600", Eroski: "#E2001A",
  Aldi: "#00529B", Consum: "#E2001A", Simply: "#FF6600",
  Hipercor: "#E30613", "El Corte Inglés": "#006400",
  Caprabo: "#E2001A", Ahorramas: "#FF6600", Gadis: "#004A97",
  Spar: "#E2001A", Covirán: "#FF6600", Bonpreu: "#B8860B",
  Condis: "#004A97", "Cualquier mercado": "#4B5563",
  "Marca desconocida": "#4B5563", "Personalizado": "#A78BFA",
};

type Porcion = { nombre: string; gramos: number };

type Producto = {
  nombre: string;
  supermercado: string;
  marca: string;
  nutrientes: Nutrientes;
  pesoEnvase?: number;
  nombreUnidadEnvase?: string;
  esPersonalizado?: boolean;
  porciones?: Porcion[];
  codigoBarras?: string;
  scanCount?: number;  // popularidad: veces escaneado en la comunidad
  isRecent?: boolean;  // coincide con un alimento usado recientemente
};

/** Devuelve el nombre de la unidad del envase según el tipo de producto */
function detectarNombreUnidad(nombre: string, _peso: number): string {
  const n = nombre.toLowerCase();
  if (/yogur|yogurt/.test(n))                                   return "1 yogur";
  if (/huevo|egg/.test(n))                                      return "1 huevo";
  if (/barrita|bar\b/.test(n))                                  return "1 barrita";
  if (/galleta(?!s)/.test(n))                                   return "1 galleta";
  if (/galletas/.test(n))                                       return "1 paquete";
  if (/magdalena|muffin/.test(n))                               return "1 magdalena";
  if (/donut/.test(n))                                          return "1 donut";
  if (/croissant/.test(n))                                      return "1 croissant";
  if (/pan de molde|pan molde/.test(n))                         return "1 rebanada";
  if (/chocolate/.test(n))                                      return "1 onza";
  if (/bombón|bombon/.test(n))                                  return "1 bombón";
  if (/caramelo/.test(n))                                       return "1 caramelo";
  if (/lata|conserva/.test(n))                                  return "1 lata";
  if (/bote/.test(n))                                           return "1 bote";
  if (/botella/.test(n))                                        return "1 botella";
  if (/refresco|soda/.test(n))                                  return "1 lata";
  if (/zumo|juice/.test(n))                                     return "1 vaso";
  if (/leche|milk/.test(n))                                     return "1 vaso";
  if (/café|cafe|coffee/.test(n))                               return "1 taza";
  if (/té\b|te\b|tea/.test(n))                                  return "1 taza";
  if (/bolsa|chips|snack|palomita/.test(n))                     return "1 bolsa";
  if (/proteína|proteina|whey|casein|scoop/.test(n))            return "1 scoop";
  if (/manzana|pera|naranja|plátano|platano|kiwi|melocotón|melocoton|ciruela|mandarina/.test(n)) return "1 unidad";
  return "1 envase";
}

// ── QuantitySelector ──────────────────────────────────────────────────────────
const ENVASE_CACHE_KEY        = (id: string) => `nutri_envase_v2_${id.toLowerCase().trim()}`;
const ENVASE_NOMBRE_CACHE_KEY = (id: string) => `nutri_envase_nombre_${id.toLowerCase().trim()}`;

type UnitChip = {
  key: string;
  topLine: string;
  bottomLine?: string;
  grams: number;
  hasQty?: boolean;
  isGram?: boolean;
};

function buildChips(prod: Producto, envaseNum: number, nombreEnvaseCustom?: string): UnitChip[] {
  const chips: UnitChip[] = [];
  if (prod.porciones?.length) {
    for (const p of prod.porciones)
      chips.push({ key: `p_${p.nombre}`, topLine: p.nombre, bottomLine: `${p.gramos} g`, grams: p.gramos, hasQty: true });
  }
  const envase = prod.pesoEnvase ?? (envaseNum > 0 ? envaseNum : 0);
  if (envase > 0) {
    const raw  = nombreEnvaseCustom?.trim()
      ? (nombreEnvaseCustom.trim().match(/^\d/) ? nombreEnvaseCustom.trim() : `1 ${nombreEnvaseCustom.trim()}`)
      : (prod.nombreUnidadEnvase ?? detectarNombreUnidad(prod.nombre, envase));
    const unit = raw.replace(/^1\s/, "");
    chips.push({ key: "e1",  topLine: raw,          bottomLine: `${envase} g`,                   grams: envase,                   hasQty: true });
    chips.push({ key: "e_h", topLine: `½ ${unit}`,  bottomLine: `${Math.round(envase * 0.5)} g`, grams: Math.round(envase * 0.5) });
    chips.push({ key: "e_q", topLine: `¼ ${unit}`,  bottomLine: `${Math.round(envase * 0.25)} g`,grams: Math.round(envase * 0.25) });
  }
  chips.push({ key: "g", topLine: "g", grams: 1, isGram: true });
  return chips;
}
// ─────────────────────────────────────────────────────────────────────────────

type RecentFood = Producto & { addedAt: number };
type FavoriteFood = Producto & { savedAt: number };

const ALIMENTOS_BASICOS: Producto[] = [
  { nombre: "Manzana", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 52, proteinas: 0.3, grasas: 0.2, grasasSaturadas: 0, carbohidratos: 14, azucares: 10, fibra: 2.4, sal: 0 } },
  { nombre: "Plátano", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 89, proteinas: 1.1, grasas: 0.3, grasasSaturadas: 0.1, carbohidratos: 23, azucares: 12, fibra: 2.6, sal: 0 } },
  { nombre: "Naranja", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 47, proteinas: 0.9, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 12, azucares: 9, fibra: 2.4, sal: 0 } },
  { nombre: "Pera", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 57, proteinas: 0.4, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 15, azucares: 10, fibra: 3.1, sal: 0 } },
  { nombre: "Fresa", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 32, proteinas: 0.7, grasas: 0.3, grasasSaturadas: 0, carbohidratos: 8, azucares: 4.9, fibra: 2, sal: 0 } },
  { nombre: "Uva", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 69, proteinas: 0.7, grasas: 0.2, grasasSaturadas: 0, carbohidratos: 18, azucares: 15, fibra: 0.9, sal: 0 } },
  { nombre: "Sandía", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 30, proteinas: 0.6, grasas: 0.2, grasasSaturadas: 0, carbohidratos: 8, azucares: 6, fibra: 0.4, sal: 0 } },
  { nombre: "Melón", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 34, proteinas: 0.8, grasas: 0.2, grasasSaturadas: 0, carbohidratos: 8, azucares: 8, fibra: 0.9, sal: 0 } },
  { nombre: "Melocotón", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 39, proteinas: 0.9, grasas: 0.3, grasasSaturadas: 0, carbohidratos: 10, azucares: 8, fibra: 1.5, sal: 0 } },
  { nombre: "Kiwi", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 61, proteinas: 1.1, grasas: 0.5, grasasSaturadas: 0, carbohidratos: 15, azucares: 9, fibra: 3, sal: 0 } },
  { nombre: "Mango", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 60, proteinas: 0.8, grasas: 0.4, grasasSaturadas: 0.1, carbohidratos: 15, azucares: 14, fibra: 1.6, sal: 0 } },
  { nombre: "Piña", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 50, proteinas: 0.5, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 13, azucares: 10, fibra: 1.4, sal: 0 } },
  { nombre: "Pechuga de pollo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 165, proteinas: 31, grasas: 3.6, grasasSaturadas: 1, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0.1 } },
  { nombre: "Pechuga de pavo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 135, proteinas: 30, grasas: 1, grasasSaturadas: 0.3, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0.1 } },
  { nombre: "Ternera", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 250, proteinas: 26, grasas: 15, grasasSaturadas: 6, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0.1 } },
  { nombre: "Salmón", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 208, proteinas: 20, grasas: 13, grasasSaturadas: 3, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0.1 } },
  { nombre: "Atún fresco", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 144, proteinas: 23, grasas: 5, grasasSaturadas: 1.3, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0.1 } },
  { nombre: "Merluza", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 86, proteinas: 17, grasas: 1.4, grasasSaturadas: 0.3, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0.2 } },
  { nombre: "Huevo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 155, proteinas: 13, grasas: 11, grasasSaturadas: 3.3, carbohidratos: 1.1, azucares: 1.1, fibra: 0, sal: 0.4 } },
  { nombre: "Leche entera", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 61, proteinas: 3.2, grasas: 3.3, grasasSaturadas: 2.1, carbohidratos: 4.8, azucares: 4.8, fibra: 0, sal: 0.1 } },
  { nombre: "Yogur natural", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 59, proteinas: 3.5, grasas: 3.3, grasasSaturadas: 2.1, carbohidratos: 4.7, azucares: 4.7, fibra: 0, sal: 0.1 } },
  { nombre: "Queso fresco", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 98, proteinas: 11, grasas: 4.3, grasasSaturadas: 2.8, carbohidratos: 3.4, azucares: 3.4, fibra: 0, sal: 0.4 } },
  { nombre: "Arroz blanco cocido", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 130, proteinas: 2.7, grasas: 0.3, grasasSaturadas: 0.1, carbohidratos: 28, azucares: 0, fibra: 0.4, sal: 0 } },
  { nombre: "Pasta cocida", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 158, proteinas: 5.8, grasas: 0.9, grasasSaturadas: 0.2, carbohidratos: 31, azucares: 0.6, fibra: 1.8, sal: 0 } },
  { nombre: "Pan de molde", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 265, proteinas: 9, grasas: 3.2, grasasSaturadas: 0.7, carbohidratos: 49, azucares: 5, fibra: 2.7, sal: 1.1 } },
  { nombre: "Patata cocida", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 77, proteinas: 2, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 17, azucares: 0.8, fibra: 2.2, sal: 0 } },
  { nombre: "Brócoli", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 34, proteinas: 2.8, grasas: 0.4, grasasSaturadas: 0, carbohidratos: 7, azucares: 1.7, fibra: 2.6, sal: 0 } },
  { nombre: "Zanahoria", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 41, proteinas: 0.9, grasas: 0.2, grasasSaturadas: 0, carbohidratos: 10, azucares: 4.7, fibra: 2.8, sal: 0.1 } },
  { nombre: "Tomate", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 18, proteinas: 0.9, grasas: 0.2, grasasSaturadas: 0, carbohidratos: 3.9, azucares: 2.6, fibra: 1.2, sal: 0 } },
  { nombre: "Lechuga", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 15, proteinas: 1.4, grasas: 0.2, grasasSaturadas: 0, carbohidratos: 2.9, azucares: 1.5, fibra: 1.3, sal: 0 } },
  { nombre: "Espinacas", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 23, proteinas: 2.9, grasas: 0.4, grasasSaturadas: 0.1, carbohidratos: 3.6, azucares: 0.4, fibra: 2.2, sal: 0.1 } },
  { nombre: "Cebolla", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 40, proteinas: 1.1, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 9, azucares: 4.2, fibra: 1.7, sal: 0 } },
  { nombre: "Ajo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 149, proteinas: 6.4, grasas: 0.5, grasasSaturadas: 0.1, carbohidratos: 33, azucares: 1, fibra: 2.1, sal: 0 } },
  { nombre: "Aceite de oliva", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 884, proteinas: 0, grasas: 100, grasasSaturadas: 14, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0 } },
  { nombre: "Lentejas cocidas", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 116, proteinas: 9, grasas: 0.4, grasasSaturadas: 0.1, carbohidratos: 20, azucares: 1.8, fibra: 7.9, sal: 0 } },
  { nombre: "Garbanzos cocidos", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 164, proteinas: 8.9, grasas: 2.6, grasasSaturadas: 0.3, carbohidratos: 27, azucares: 4.8, fibra: 7.6, sal: 0 } },
  { nombre: "Avena", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 389, proteinas: 17, grasas: 7, grasasSaturadas: 1.2, carbohidratos: 66, azucares: 1, fibra: 10.6, sal: 0 } },
  { nombre: "Almendras", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 579, proteinas: 21, grasas: 50, grasasSaturadas: 3.8, carbohidratos: 22, azucares: 4.4, fibra: 12.5, sal: 0 } },
  { nombre: "Nueces", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 654, proteinas: 15, grasas: 65, grasasSaturadas: 6.1, carbohidratos: 14, azucares: 2.6, fibra: 6.7, sal: 0 } },
  { nombre: "Atún en lata", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 116, proteinas: 25, grasas: 1, grasasSaturadas: 0.3, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0.8 } },
  { nombre: "Jamón serrano", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 241, proteinas: 30, grasas: 12, grasasSaturadas: 4.2, carbohidratos: 0.5, azucares: 0.5, fibra: 0, sal: 4.5 } },
  { nombre: "Chocolate negro 70%", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 598, proteinas: 7.8, grasas: 43, grasasSaturadas: 25, carbohidratos: 46, azucares: 28, fibra: 10, sal: 0.1 } },
  // ── Especias y hierbas ─────────────────────────────────────────────────────
  { nombre: "Sal", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 0, proteinas: 0, grasas: 0, grasasSaturadas: 0, carbohidratos: 0, azucares: 0, fibra: 0, sal: 100 } },
  { nombre: "Pimienta negra", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 251, proteinas: 10, grasas: 3.3, grasasSaturadas: 0.9, carbohidratos: 64, azucares: 0.6, fibra: 25, sal: 0 } },
  { nombre: "Pimienta blanca", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 296, proteinas: 10, grasas: 2.1, grasasSaturadas: 0.6, carbohidratos: 68, azucares: 0, fibra: 26, sal: 0 } },
  { nombre: "Pimentón dulce", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 282, proteinas: 14, grasas: 13, grasasSaturadas: 2.1, carbohidratos: 54, azucares: 10, fibra: 34, sal: 0.1 } },
  { nombre: "Pimentón picante", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 282, proteinas: 14, grasas: 13, grasasSaturadas: 2.1, carbohidratos: 54, azucares: 10, fibra: 34, sal: 0.1 } },
  { nombre: "Pimentón ahumado", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 282, proteinas: 14, grasas: 13, grasasSaturadas: 2.1, carbohidratos: 54, azucares: 10, fibra: 34, sal: 0.1 } },
  { nombre: "Comino", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 375, proteinas: 18, grasas: 22, grasasSaturadas: 1.5, carbohidratos: 44, azucares: 2.3, fibra: 11, sal: 0.2 } },
  { nombre: "Orégano", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 265, proteinas: 9, grasas: 4.3, grasasSaturadas: 1.6, carbohidratos: 69, azucares: 4.1, fibra: 43, sal: 0 } },
  { nombre: "Albahaca seca", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 233, proteinas: 23, grasas: 4, grasasSaturadas: 0, carbohidratos: 48, azucares: 1.7, fibra: 38, sal: 0 } },
  { nombre: "Albahaca fresca", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 22, proteinas: 3.2, grasas: 0.6, grasasSaturadas: 0, carbohidratos: 2.7, azucares: 0.3, fibra: 1.6, sal: 0 } },
  { nombre: "Romero", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 131, proteinas: 3.3, grasas: 5.9, grasasSaturadas: 2.8, carbohidratos: 21, azucares: 0.7, fibra: 14, sal: 0 } },
  { nombre: "Tomillo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 101, proteinas: 5.6, grasas: 1.7, grasasSaturadas: 0.6, carbohidratos: 24, azucares: 0, fibra: 14, sal: 0 } },
  { nombre: "Laurel", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 313, proteinas: 7.6, grasas: 8.4, grasasSaturadas: 2.3, carbohidratos: 75, azucares: 0, fibra: 26, sal: 0 } },
  { nombre: "Canela", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 247, proteinas: 4, grasas: 1.2, grasasSaturadas: 0.3, carbohidratos: 81, azucares: 2.2, fibra: 53, sal: 0 } },
  { nombre: "Cúrcuma", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 354, proteinas: 8, grasas: 10, grasasSaturadas: 3.1, carbohidratos: 65, azucares: 3.2, fibra: 21, sal: 0 } },
  { nombre: "Jengibre en polvo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 335, proteinas: 9, grasas: 4.2, grasasSaturadas: 1.2, carbohidratos: 72, azucares: 3.4, fibra: 14, sal: 0 } },
  { nombre: "Jengibre fresco", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 80, proteinas: 1.8, grasas: 0.8, grasasSaturadas: 0.2, carbohidratos: 18, azucares: 1.7, fibra: 2, sal: 0 } },
  { nombre: "Azafrán", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 310, proteinas: 11, grasas: 5.9, grasasSaturadas: 1.6, carbohidratos: 65, azucares: 0, fibra: 4, sal: 0 } },
  { nombre: "Nuez moscada", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 525, proteinas: 5.8, grasas: 36, grasasSaturadas: 25, carbohidratos: 49, azucares: 2.9, fibra: 21, sal: 0 } },
  { nombre: "Clavo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 274, proteinas: 6, grasas: 13, grasasSaturadas: 3.6, carbohidratos: 66, azucares: 2.4, fibra: 34, sal: 0.3 } },
  { nombre: "Cardamomo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 311, proteinas: 11, grasas: 6.7, grasasSaturadas: 0.7, carbohidratos: 68, azucares: 0.4, fibra: 28, sal: 0 } },
  { nombre: "Curry en polvo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 325, proteinas: 14, grasas: 14, grasasSaturadas: 2, carbohidratos: 58, azucares: 2.8, fibra: 33, sal: 0.1 } },
  { nombre: "Garam masala", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 379, proteinas: 14, grasas: 16, grasasSaturadas: 3, carbohidratos: 58, azucares: 1, fibra: 22, sal: 0.2 } },
  { nombre: "Cilantro seco", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 298, proteinas: 12, grasas: 17, grasasSaturadas: 0.99, carbohidratos: 55, azucares: 0, fibra: 42, sal: 0 } },
  { nombre: "Cilantro fresco", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 23, proteinas: 2.1, grasas: 0.5, grasasSaturadas: 0, carbohidratos: 3.7, azucares: 0.9, fibra: 2.8, sal: 0 } },
  { nombre: "Perejil fresco", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 36, proteinas: 3, grasas: 0.8, grasasSaturadas: 0, carbohidratos: 6.3, azucares: 0.9, fibra: 3.3, sal: 0.1 } },
  { nombre: "Perejil seco", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 292, proteinas: 26, grasas: 5.5, grasasSaturadas: 0.9, carbohidratos: 50, azucares: 7.3, fibra: 33, sal: 0.5 } },
  { nombre: "Eneldo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 43, proteinas: 3.5, grasas: 1.1, grasasSaturadas: 0.1, carbohidratos: 7, azucares: 0, fibra: 2.1, sal: 0 } },
  { nombre: "Cebollino", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 30, proteinas: 3.3, grasas: 0.7, grasasSaturadas: 0.1, carbohidratos: 4.4, azucares: 1.9, fibra: 2.5, sal: 0 } },
  { nombre: "Estragón", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 295, proteinas: 23, grasas: 7.2, grasasSaturadas: 1.9, carbohidratos: 50, azucares: 1.9, fibra: 7.4, sal: 0.1 } },
  { nombre: "Salvia", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 315, proteinas: 11, grasas: 13, grasasSaturadas: 7, carbohidratos: 61, azucares: 1.7, fibra: 40, sal: 0 } },
  { nombre: "Menta fresca", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 70, proteinas: 3.8, grasas: 0.9, grasasSaturadas: 0.2, carbohidratos: 15, azucares: 0, fibra: 8, sal: 0 } },
  { nombre: "Hierbabuena", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 70, proteinas: 3.8, grasas: 0.9, grasasSaturadas: 0.2, carbohidratos: 15, azucares: 0, fibra: 8, sal: 0 } },
  { nombre: "Mejorana", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 271, proteinas: 13, grasas: 7, grasasSaturadas: 1.8, carbohidratos: 61, azucares: 4.1, fibra: 40, sal: 0 } },
  { nombre: "Hinojo semillas", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 345, proteinas: 16, grasas: 15, grasasSaturadas: 0.5, carbohidratos: 52, azucares: 0, fibra: 40, sal: 0 } },
  { nombre: "Semillas de sésamo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 573, proteinas: 17, grasas: 50, grasasSaturadas: 7, carbohidratos: 23, azucares: 0.3, fibra: 11.8, sal: 0 } },
  { nombre: "Semillas de chía", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 486, proteinas: 17, grasas: 31, grasasSaturadas: 3.3, carbohidratos: 42, azucares: 0, fibra: 34, sal: 0 } },
  { nombre: "Semillas de lino", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 534, proteinas: 18, grasas: 42, grasasSaturadas: 3.7, carbohidratos: 29, azucares: 1.6, fibra: 27, sal: 0 } },
  { nombre: "Semillas de amapola", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 525, proteinas: 18, grasas: 42, grasasSaturadas: 4.5, carbohidratos: 28, azucares: 2.9, fibra: 20, sal: 0 } },
  { nombre: "Mostaza en polvo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 508, proteinas: 26, grasas: 36, grasasSaturadas: 2, carbohidratos: 35, azucares: 6.8, fibra: 13, sal: 0.1 } },
  { nombre: "Páprika", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 282, proteinas: 14, grasas: 13, grasasSaturadas: 2.1, carbohidratos: 54, azucares: 10, fibra: 34, sal: 0.1 } },
  { nombre: "Cayena", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 318, proteinas: 12, grasas: 17, grasasSaturadas: 3, carbohidratos: 57, azucares: 10, fibra: 27, sal: 0.1 } },
  { nombre: "Chile en polvo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 282, proteinas: 13, grasas: 14, grasasSaturadas: 2.4, carbohidratos: 50, azucares: 7.2, fibra: 29, sal: 0.2 } },
  { nombre: "Guindilla", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 40, proteinas: 1.9, grasas: 0.4, grasasSaturadas: 0, carbohidratos: 9, azucares: 5.3, fibra: 1.5, sal: 0 } },
  { nombre: "Pimienta de cayena", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 318, proteinas: 12, grasas: 17, grasasSaturadas: 3, carbohidratos: 57, azucares: 10, fibra: 27, sal: 0.1 } },
  { nombre: "Anís estrellado", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 337, proteinas: 18, grasas: 16, grasasSaturadas: 0, carbohidratos: 50, azucares: 0, fibra: 15, sal: 0 } },
  { nombre: "Anís en grano", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 337, proteinas: 18, grasas: 16, grasasSaturadas: 0, carbohidratos: 50, azucares: 0, fibra: 15, sal: 0 } },
  { nombre: "Vainilla en vaina", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 288, proteinas: 0.1, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 13, azucares: 13, fibra: 0, sal: 0 } },
  { nombre: "Extracto de vainilla", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 288, proteinas: 0.1, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 13, azucares: 13, fibra: 0, sal: 0 } },
  { nombre: "Levadura de hornear", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 53, proteinas: 5.1, grasas: 0.2, grasasSaturadas: 0, carbohidratos: 28, azucares: 0, fibra: 0, sal: 11.8 } },
  { nombre: "Bicarbonato de sodio", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 0, proteinas: 0, grasas: 0, grasasSaturadas: 0, carbohidratos: 0, azucares: 0, fibra: 0, sal: 27.4 } },
  { nombre: "Vinagre de vino", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 19, proteinas: 0, grasas: 0, grasasSaturadas: 0, carbohidratos: 0.6, azucares: 0.6, fibra: 0, sal: 0 } },
  { nombre: "Vinagre de manzana", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 22, proteinas: 0, grasas: 0, grasasSaturadas: 0, carbohidratos: 0.9, azucares: 0.4, fibra: 0, sal: 0 } },
  { nombre: "Vinagre balsámico", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 88, proteinas: 0.5, grasas: 0, grasasSaturadas: 0, carbohidratos: 17, azucares: 15, fibra: 0, sal: 0 } },
  { nombre: "Salsa de soja", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 53, proteinas: 8.1, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 5, azucares: 1.7, fibra: 0.8, sal: 14.9 } },
  { nombre: "Aceite de sésamo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 884, proteinas: 0, grasas: 100, grasasSaturadas: 14, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0 } },
  { nombre: "Aceite de coco", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 862, proteinas: 0, grasas: 100, grasasSaturadas: 87, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0 } },
  { nombre: "Aceite de girasol", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 884, proteinas: 0, grasas: 100, grasasSaturadas: 10, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0 } },
  { nombre: "Mantequilla", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 717, proteinas: 0.9, grasas: 81, grasasSaturadas: 51, carbohidratos: 0.1, azucares: 0.1, fibra: 0, sal: 0.6 } },
  { nombre: "Tahini", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 595, proteinas: 17, grasas: 54, grasasSaturadas: 7.6, carbohidratos: 21, azucares: 0.5, fibra: 9.3, sal: 0 } },
  { nombre: "Miso", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 199, proteinas: 12, grasas: 6, grasasSaturadas: 1.1, carbohidratos: 27, azucares: 6.2, fibra: 5.4, sal: 12.4 } },
  { nombre: "Salsa Worcestershire", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 78, proteinas: 2.6, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 19, azucares: 17, fibra: 0, sal: 4.6 } },
  { nombre: "Concentrado de tomate", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 82, proteinas: 4.3, grasas: 0.5, grasasSaturadas: 0.1, carbohidratos: 18, azucares: 12, fibra: 4.1, sal: 0.1 } },
  { nombre: "Caldo de pollo", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 15, proteinas: 0.5, grasas: 0.3, grasasSaturadas: 0.1, carbohidratos: 1.4, azucares: 0.4, fibra: 0, sal: 0.5 } },
  { nombre: "Caldo de verduras", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 7, proteinas: 0.4, grasas: 0.1, grasasSaturadas: 0, carbohidratos: 1.2, azucares: 0.3, fibra: 0, sal: 0.3 } },
  { nombre: "Caldo de carne", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 17, proteinas: 1.1, grasas: 0.5, grasasSaturadas: 0.2, carbohidratos: 1.7, azucares: 0.4, fibra: 0, sal: 0.5 } },
  { nombre: "Levadura nutricional", marca: "Natural", supermercado: "Cualquier mercado", nutrientes: { calorias: 325, proteinas: 50, grasas: 5, grasasSaturadas: 0.7, carbohidratos: 38, azucares: 0.5, fibra: 26, sal: 0.1 } },
];

// Cache en memoria de sesión: instantáneo, sin I/O a disco
const _memCache = new Map<string, { data: Producto[]; ts: number }>();
const MEM_CACHE_TTL = 1000 * 60 * 30; // 30 min
const PERSISTENT_CACHE_KEY = "nutri_search_pcache_v1";
const PERSISTENT_CACHE_MAX = 20;

function getMemCached(q: string): Producto[] | null {
  const e = _memCache.get(q);
  if (!e) return null;
  if (Date.now() - e.ts > MEM_CACHE_TTL) { _memCache.delete(q); return null; }
  return e.data;
}

function setMemCached(q: string, data: Producto[]) {
  if (_memCache.size >= 200) {
    const oldest = _memCache.keys().next().value;
    if (oldest) _memCache.delete(oldest);
  }
  _memCache.set(q, { data, ts: Date.now() });
  // Persist las últimas PERSISTENT_CACHE_MAX búsquedas a disco (no bloqueante)
  _persistCache();
}

function _persistCache() {
  try {
    const entries = Array.from(_memCache.entries())
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, PERSISTENT_CACHE_MAX);
    const obj = Object.fromEntries(entries);
    AsyncStorage.setItem(PERSISTENT_CACHE_KEY, JSON.stringify(obj)).catch(() => {});
  } catch {}
}

export async function cargarCachePersistente() {
  try {
    const raw = await AsyncStorage.getItem(PERSISTENT_CACHE_KEY);
    if (!raw) return;
    const saved: Record<string, { data: Producto[]; ts: number }> = JSON.parse(raw);
    const now = Date.now();
    for (const [q, entry] of Object.entries(saved)) {
      if (!_memCache.has(q) && now - entry.ts < MEM_CACHE_TTL) {
        _memCache.set(q, entry);
      }
    }
  } catch {}
}

// Mapa de términos en otros idiomas → nombre español equivalente
// Permite buscar "apple" y encontrar "Manzana", "chicken" y encontrar "Pechuga de pollo", etc.
const FOOD_ALIASES: Record<string, string> = {
  // EN
  apple:"manzana",banana:"plátano",orange:"naranja",pear:"pera",strawberry:"fresa",grape:"uva",watermelon:"sandía",melon:"melón",peach:"melocotón",kiwi:"kiwi",mango:"mango",pineapple:"piña","chicken breast":"pechuga de pollo","turkey breast":"pechuga de pavo",beef:"ternera",salmon:"salmón",tuna:"atún",hake:"merluza",egg:"huevo","whole milk":"leche entera","natural yogurt":"yogur natural",oats:"avena",rice:"arroz","white rice":"arroz","brown rice":"arroz integral",bread:"pan","whole wheat bread":"pan integral",pasta:"pasta",potato:"patata","sweet potato":"boniato",lettuce:"lechuga",tomato:"tomate",cucumber:"pepino",carrot:"zanahoria",onion:"cebolla",garlic:"ajo",pepper:"pimiento",spinach:"espinacas",broccoli:"brócoli",lentils:"lentejas",chickpeas:"garbanzos","black beans":"frijoles negros","olive oil":"aceite de oliva","sunflower oil":"aceite de girasol",butter:"mantequilla",cheese:"queso","cream cheese":"queso crema",ham:"jamón cocido","cured ham":"jamón serrano",tuna:"atún en lata","protein powder":"proteína en polvo",oatmeal:"avena",
  // FR
  pomme:"manzana",banane:"plátano","poulet":"pechuga de pollo",riz:"arroz",pain:"pan",oeuf:"huevo",lait:"leche entera",yaourt:"yogur natural","pomme de terre":"patata",tomate:"tomate",carotte:"zanahoria",concombre:"pepino","épinards":"espinacas",
  // DE
  apfel:"manzana",banane:"plátano",huhn:"pechuga de pollo",reis:"arroz",brot:"pan",ei:"huevo",milch:"leche entera",joghurt:"yogur natural",kartoffel:"patata",tomate:"tomate",karotte:"zanahoria",gurke:"pepino",
  // PT
  maçã:"manzana",frango:"pechuga de pollo",arroz:"arroz",pão:"pan",ovo:"huevo",leite:"leche entera",iogurte:"yogur natural",batata:"patata",tomate:"tomate",cenoura:"zanahoria",
  // IT
  mela:"manzana",pollo:"pechuga de pollo",riso:"arroz",pane:"pan",uovo:"huevo",latte:"leche entera",yogurt:"yogur natural",patata:"patata",pomodoro:"tomate",carota:"zanahoria",
  // ── Especias EN ──
  salt:"sal",pepper:"pimienta negra","black pepper":"pimienta negra","white pepper":"pimienta blanca",paprika:"pimentón dulce","smoked paprika":"pimentón ahumado","hot paprika":"pimentón picante",cumin:"comino",oregano:"orégano",basil:"albahaca seca","fresh basil":"albahaca fresca",rosemary:"romero",thyme:"tomillo","bay leaf":"laurel","bay leaves":"laurel",cinnamon:"canela",turmeric:"cúrcuma",ginger:"jengibre en polvo","fresh ginger":"jengibre fresco",saffron:"azafrán","nutmeg":"nuez moscada",clove:"clavo",cloves:"clavo",cardamom:"cardamomo",curry:"curry en polvo","curry powder":"curry en polvo","garam masala":"garam masala",coriander:"cilantro seco","fresh coriander":"cilantro fresco","fresh cilantro":"cilantro fresco",cilantro:"cilantro fresco",parsley:"perejil fresco","dried parsley":"perejil seco",dill:"eneldo",chives:"cebollino",tarragon:"estragón",sage:"salvia",mint:"menta fresca",spearmint:"hierbabuena",marjoram:"mejorana","fennel seeds":"hinojo semillas","sesame seeds":"semillas de sésamo","chia seeds":"semillas de chía","flax seeds":"semillas de lino","poppy seeds":"semillas de amapola","mustard powder":"mostaza en polvo",cayenne:"cayena","chili powder":"chile en polvo","star anise":"anís estrellado","anise seeds":"anís en grano",vanilla:"extracto de vainilla","vanilla extract":"extracto de vainilla","baking powder":"levadura de hornear","baking soda":"bicarbonato de sodio","wine vinegar":"vinagre de vino","apple cider vinegar":"vinagre de manzana","balsamic vinegar":"vinagre balsámico","soy sauce":"salsa de soja","sesame oil":"aceite de sésamo","coconut oil":"aceite de coco","sunflower oil":"aceite de girasol",butter:"mantequilla",tahini:"tahini",miso:"miso","worcestershire sauce":"salsa Worcestershire","tomato paste":"concentrado de tomate","chicken broth":"caldo de pollo","vegetable broth":"caldo de verduras","beef broth":"caldo de carne","nutritional yeast":"levadura nutricional",
  // ── Especias FR ──
  sel:"sal",poivre:"pimienta negra","poivre noir":"pimienta negra",paprika:"pimentón dulce",cumin:"comino",origan:"orégano",basilic:"albahaca seca",romarin:"romero",thym:"tomillo","feuille de laurier":"laurel",cannelle:"canela",curcuma:"cúrcuma",gingembre:"jengibre en polvo",safran:"azafrán","noix de muscade":"nuez moscada",girofle:"clavo",cardamome:"cardamomo","curry en poudre":"curry en polvo",coriandre:"cilantro fresco",persil:"perejil fresco",aneth:"eneldo",ciboulette:"cebollino",estragon:"estragón",sauge:"salvia",menthe:"menta fresca",marjolaine:"mejorana","graines de sésame":"semillas de sésamo","graines de chia":"semillas de chía",vanille:"extracto de vainilla","levure chimique":"levadura de hornear","bicarbonate de soude":"bicarbonato de sodio","vinaigre de vin":"vinagre de vino","sauce soja":"salsa de soja",beurre:"mantequilla",
  // ── Especias DE ──
  salz:"sal",pfeffer:"pimienta negra",paprika:"pimentón dulce",kumin:"comino",oregano:"orégano",basilikum:"albahaca seca",rosmarin:"romero",thymian:"tomillo",lorbeer:"laurel",zimt:"canela",kurkuma:"cúrcuma",ingwer:"jengibre en polvo",safran:"azafrán",muskatnuss:"nuez moscada",nelken:"clavo",kardamom:"cardamomo",koriander:"cilantro fresco",petersilie:"perejil fresco",dill:"eneldo",schnittlauch:"cebollino",estragon:"estragón",salbei:"salvia",minze:"menta fresca",majoran:"mejorana",vanille:"extracto de vainilla",backpulver:"levadura de hornear",natron:"bicarbonato de sodio",butter:"mantequilla",
  // ── Especias IT ──
  sale:"sal","pepe nero":"pimienta negra",paprica:"pimentón dulce",cumino:"comino",origano:"orégano",basilico:"albahaca seca",rosmarino:"romero",timo:"tomillo",alloro:"laurel",cannella:"canela",curcuma:"cúrcuma",zenzero:"jengibre en polvo",zafferano:"azafrán","noce moscata":"nuez moscada",chiodo:"clavo",cardamomo:"cardamomo",coriandolo:"cilantro fresco",prezzemolo:"perejil fresco",aneto:"eneldo",erba:"cebollino",dragoncello:"estragón",salvia:"salvia",menta:"menta fresca",maggiorana:"mejorana",vaniglia:"extracto de vainilla",burro:"mantequilla",
  // ── Especias PT ──
  sal:"sal","pimenta preta":"pimienta negra",páprica:"pimentón dulce",cominho:"comino",orégano:"orégano",manjericão:"albahaca seca",alecrim:"romero",tomilho:"tomillo",louro:"laurel",canela:"canela",açafrão:"azafrán","noz moscada":"nuez moscada",cravo:"clavo",coentro:"cilantro fresco",salsa:"perejil fresco",endro:"eneldo",cebolinho:"cebollino",estragão:"estragón",sálvia:"salvia",hortelã:"menta fresca",manjerona:"mejorana",baunilha:"extracto de vainilla",manteiga:"mantequilla",
  // ── Especias árabe / marroquí ──
  "ras el hanout":"garam masala",harissa:"cayena","za'atar":"orégano",zaatar:"orégano",sumac:"pimentón dulce",
  // RU / others phonetic omitted for brevity
};

// Supermercados conocidos (en minúsculas) para detectarlos en la búsqueda
const SUPER_KEYS = Object.keys(SUPER_COLORS).map(s => s.toLowerCase());

function parseQuery(texto: string): { nameTokens: string[]; superTokens: string[] } {
  const tokens = texto.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const superTokens: string[] = [];
  const nameTokens: string[] = [];
  for (const t of tokens) {
    const esSuperToken = SUPER_KEYS.some(s => s === t || (t.length >= 4 && s.startsWith(t)));
    if (esSuperToken) superTokens.push(t);
    else nameTokens.push(t);
  }
  return { nameTokens, superTokens };
}

function buscarEnLocal(texto: string): Producto[] {
  const { nameTokens, superTokens } = parseQuery(texto);
  if (!nameTokens.length && !superTokens.length) return [];
  return ALIMENTOS_BASICOS.filter((a) => {
    const nombreL = a.nombre.toLowerCase();
    const superL = (a.supermercado ?? "").toLowerCase();
    const marcaL = (a.marca ?? "").toLowerCase();
    // Todos los tokens deben coincidir en nombre O marca (permite buscar "arroz hacendado")
    const nameMatch = nameTokens.length === 0 || nameTokens.every(t => {
      const alias = FOOD_ALIASES[t];
      return nombreL.includes(t) || marcaL.includes(t) || (alias ? nombreL.includes(alias.toLowerCase()) : false);
    });
    // Al menos un token de super debe coincidir en supermercado o marca
    const superMatch = superTokens.length === 0 || superTokens.some(t =>
      superL.includes(t) || marcaL.includes(t)
    );
    return nameMatch && superMatch;
  });
}

async function registrarEnHistorial(prod: Producto): Promise<RecentFood[]> {
  try {
    const stored = await AsyncStorage.getItem(RECENT_FOODS_KEY);
    const lista: RecentFood[] = stored ? JSON.parse(stored) : [];
    const nueva: RecentFood = { ...prod, addedAt: Date.now() };
    const filtrada = lista.filter((f) => f.nombre.toLowerCase() !== prod.nombre.toLowerCase());
    const actualizada = [nueva, ...filtrada].slice(0, 50);
    await AsyncStorage.setItem(RECENT_FOODS_KEY, JSON.stringify(actualizada));
    upsertRecienteCloud(nueva).catch(() => {});
    return actualizada;
  } catch { return []; }
}

async function cargarFavoritosStorage(): Promise<FavoriteFood[]> {
  try {
    const stored = await AsyncStorage.getItem(FAVORITES_KEY);
    if (!stored) return [];
    const parsed: any[] = JSON.parse(stored);
    return parsed.map(f => ({ ...normalizarProducto(f), savedAt: f.savedAt }));
  } catch { return []; }
}

async function toggleFavoritoStorage(prod: Producto): Promise<FavoriteFood[]> {
  const lista = await cargarFavoritosStorage();
  const existe = lista.find((f) => f.nombre.toLowerCase() === prod.nombre.toLowerCase());
  let nueva: FavoriteFood[];
  if (existe) {
    nueva = lista.filter((f) => f.nombre.toLowerCase() !== prod.nombre.toLowerCase());
    deleteFavCloud(prod.nombre).catch(() => {});
  } else {
    const fav: FavoriteFood = { ...prod, savedAt: Date.now() };
    nueva = [fav, ...lista];
    upsertFavCloud(fav).catch(() => {});
  }
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(nueva));
  return nueva;
}

// ── Cloud sync helpers ────────────────────────────────────────────────────────
async function getUid(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch { return null; }
}

async function upsertFavCloud(fav: FavoriteFood) {
  const uid = await getUid(); if (!uid) return;
  await supabase.from("alimentos_favoritos").upsert(
    { user_id: uid, nombre: fav.nombre, producto_data: fav, saved_at: fav.savedAt },
    { onConflict: "user_id,nombre" }
  );
}

async function deleteFavCloud(nombre: string) {
  const uid = await getUid(); if (!uid) return;
  await supabase.from("alimentos_favoritos").delete()
    .eq("user_id", uid).eq("nombre", nombre);
}

async function upsertRecienteCloud(rec: RecentFood) {
  const uid = await getUid(); if (!uid) return;
  await supabase.from("alimentos_recientes").upsert(
    { user_id: uid, nombre: rec.nombre, producto_data: rec, added_at: rec.addedAt },
    { onConflict: "user_id,nombre" }
  );
}

async function clearRecientesCloud() {
  const uid = await getUid(); if (!uid) return;
  await supabase.from("alimentos_recientes").delete().eq("user_id", uid);
}

async function loadFavsCloud(): Promise<FavoriteFood[]> {
  const uid = await getUid(); if (!uid) return [];
  const { data } = await supabase.from("alimentos_favoritos")
    .select("producto_data").eq("user_id", uid)
    .order("saved_at", { ascending: false }).limit(200);
  return (data ?? []).map((r: any) => r.producto_data as FavoriteFood);
}

async function loadRecientesCloud(): Promise<RecentFood[]> {
  const uid = await getUid(); if (!uid) return [];
  const { data } = await supabase.from("alimentos_recientes")
    .select("producto_data").eq("user_id", uid)
    .order("added_at", { ascending: false }).limit(50);
  return (data ?? []).map((r: any) => r.producto_data as RecentFood);
}

function mergeRecientes(a: RecentFood[], b: RecentFood[]): RecentFood[] {
  const map = new Map<string, RecentFood>();
  for (const f of [...a, ...b]) {
    const k = f.nombre.toLowerCase();
    const ex = map.get(k);
    if (!ex || f.addedAt > ex.addedAt) map.set(k, f);
  }
  return Array.from(map.values()).sort((x, y) => y.addedAt - x.addedAt).slice(0, 50);
}

function mergeFavs(a: FavoriteFood[], b: FavoriteFood[]): FavoriteFood[] {
  const map = new Map<string, FavoriteFood>();
  for (const f of [...a, ...b]) {
    const k = f.nombre.toLowerCase();
    const ex = map.get(k);
    if (!ex || f.savedAt > ex.savedAt) map.set(k, f);
  }
  return Array.from(map.values()).sort((x, y) => y.savedAt - x.savedAt);
}
// ─────────────────────────────────────────────────────────────────────────────

function safeNutriente(val: any): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

// Mapea marca/nombre de marca al nombre del supermercado
const MARCA_A_SUPER: Array<[string, string]> = [
  ["hacendado", "Mercadona"], ["mercadona", "Mercadona"],
  ["carrefour", "Carrefour"],
  ["lidl", "Lidl"],
  ["aldi", "Aldi"],
  ["dia%", "DIA"], [" dia ", "DIA"],
  ["alcampo", "Alcampo"],
  ["eroski", "Eroski"],
  ["consum", "Consum"],
  ["simply", "Simply"],
  ["hipercor", "Hipercor"],
  ["el corte ingl", "El Corte Inglés"],
  ["caprabo", "Caprabo"],
  ["ahorramas", "Ahorramas"],
  ["gadis", "Gadis"],
  ["spar", "Spar"],
  ["coviran", "Covirán"],
  ["bonpreu", "Bonpreu"],
  ["condis", "Condis"],
  ["auchan", "Alcampo"],
  ["continente", "Carrefour"],
];
function marcaASupermercado(marca: string): string | null {
  if (!marca || marca === "Sin marca") return null;
  const m = ` ${marca.toLowerCase().trim()} `;
  for (const [key, val] of MARCA_A_SUPER) {
    if (m.includes(key)) return val;
  }
  return null;
}

function normalizarProducto(prod: any): Producto {
  if (!prod) {
    return {
      nombre: "", marca: "Sin marca", supermercado: "Desconocido", esPersonalizado: false,
      nutrientes: { calorias: 0, proteinas: 0, grasas: 0, grasasSaturadas: 0, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0 },
    };
  }
  if (prod.nutrientes && typeof prod.nutrientes === "object") {
    const superRaw2 = prod.supermercado ?? "Desconocido";
    const superFinal2 = (superRaw2 === "Cualquier mercado" || superRaw2 === "Marca desconocida" || superRaw2 === "Desconocido")
      ? (marcaASupermercado(prod.marca ?? "") ?? superRaw2)
      : superRaw2;
    return {
      ...prod,
      supermercado: superFinal2,
      porciones: Array.isArray(prod.porciones) ? prod.porciones : undefined,
      nutrientes: {
        calorias: safeNutriente(prod.nutrientes.calorias),
        proteinas: safeNutriente(prod.nutrientes.proteinas),
        grasas: safeNutriente(prod.nutrientes.grasas),
        grasasSaturadas: safeNutriente(prod.nutrientes.grasasSaturadas),
        carbohidratos: safeNutriente(prod.nutrientes.carbohidratos),
        azucares: safeNutriente(prod.nutrientes.azucares),
        fibra: safeNutriente(prod.nutrientes.fibra),
        sal: safeNutriente(prod.nutrientes.sal),
      },
    };
  }
  const marcaRaw = prod.marca ?? "Sin marca";
  const superRaw = prod.supermercado ?? "Desconocido";
  const superFinal = (superRaw === "Cualquier mercado" || superRaw === "Marca desconocida" || superRaw === "Desconocido")
    ? (marcaASupermercado(marcaRaw) ?? superRaw)
    : superRaw;
  return {
    nombre: prod.nombre ?? "",
    marca: marcaRaw,
    supermercado: superFinal,
    esPersonalizado: prod.esPersonalizado ?? false,
    pesoEnvase: prod.pesoEnvase ?? prod.peso_envase,
    nombreUnidadEnvase: prod.nombreUnidadEnvase ?? prod.nombre_unidad_envase,
    porciones: Array.isArray(prod.porciones) ? prod.porciones : undefined,
    nutrientes: {
      calorias: safeNutriente(prod.calorias),
      proteinas: safeNutriente(prod.proteinas),
      grasas: safeNutriente(prod.grasas),
      grasasSaturadas: safeNutriente(prod.grasas_saturadas ?? prod.grasasSaturadas),
      carbohidratos: safeNutriente(prod.carbohidratos),
      azucares: safeNutriente(prod.azucares),
      fibra: safeNutriente(prod.fibra),
      sal: safeNutriente(prod.sal),
    },
  };
}

const SwipeableFoodItem = memo(function SwipeableFoodItem({
  prod, isFav, onSelect, onToggleFav, colors: c, alergias = [],
}: {
  prod: Producto; isFav: boolean;
  onSelect: (p: Producto) => void; onToggleFav: (p: Producto) => void; colors: any; alergias?: string[];
}) {
  const { t } = useApp();
  const sw = useMemo(() => makeSwStyles(c), [c]);
  const sc = SUPER_COLORS[prod.supermercado] || "#4B5563";
  const nombreLower = prod.nombre.toLowerCase();
  const alergenoEncontrado = alergias.find((id) =>
    (ALERGENOS_KEYWORDS[id] ?? []).some((kw) => nombreLower.includes(kw))
  );

  return (
    <View style={sw.wrap}>
      <View style={sw.item}>
        <TouchableOpacity style={sw.itemInner} onPress={() => onSelect(prod)} activeOpacity={0.7}>
          <View style={sw.left}>
            <View style={sw.nameRow}>
              {prod.isRecent && <Text style={{ fontSize: 14, marginRight: 4 }}>🕐</Text>}
              <Text style={sw.name} numberOfLines={1}>{prod.nombre}</Text>
              {prod.esPersonalizado && <View style={sw.customBadge}><Text style={sw.customBadgeText}>{t.customBadge}</Text></View>}
              {alergenoEncontrado && (
                <View style={{ backgroundColor: "#EF444422", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: "#EF444455" }}>
                  <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "700" }}>{t.allergenWarning}</Text>
                </View>
              )}
            </View>
            <View style={sw.meta}>
              <View style={[sw.superBadge, { backgroundColor: sc + "22", borderColor: sc + "55" }]}>
                <Text style={[sw.superBadgeText, { color: sc }]}>{prod.supermercado}</Text>
              </View>
              {prod.marca !== "Natural" && prod.marca !== "Sin marca" && <Text style={sw.marca}>{prod.marca}</Text>}
            </View>
            <Text style={sw.macros}>
              {t.proteins[0]} {(prod.nutrientes?.proteinas ?? 0).toFixed(1)}g · {t.carbs[0]} {(prod.nutrientes?.carbohidratos ?? 0).toFixed(1)}g · {t.fats[0]} {(prod.nutrientes?.grasas ?? 0).toFixed(1)}g
            </Text>
          </View>
          <View style={sw.right}>
            <Text style={sw.kcal}>{(prod.nutrientes?.calorias ?? 0).toFixed(0)}</Text>
            <Text style={sw.kcalUnit}>kcal/100g</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={sw.starBtn} onPress={() => onToggleFav(prod)}>
          <Text style={[sw.starIcon, isFav && sw.starIconActive]}>{isFav ? "★" : "☆"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

function SkeletonFoodItem({ colors }: { colors: any }) {
  const bg = colors.cardBorder + "66";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12,
      paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.cardBorder + "44" }}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: bg }} />
      <View style={{ flex: 1, gap: 7 }}>
        <View style={{ height: 13, backgroundColor: bg, borderRadius: 5, width: "60%" }} />
        <View style={{ height: 10, backgroundColor: bg, borderRadius: 4, width: "38%" }} />
      </View>
    </View>
  );
}

export default function AddFoodScreen() {
  const { colors, theme, t, isOnline } = useApp();
  const s = useMemo(() => makeSStyles(colors), [colors]);
  const { code, meal: mealParam, storageKey: storageKeyParam } = useLocalSearchParams<{ code?: string; meal?: MealKey; storageKey?: string }>();

  function storageKeyToDate(key: string): Date {
    const parts = key.replace("nutri_meals_", "").split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  const targetDate = storageKeyParam ? storageKeyToDate(storageKeyParam) : new Date();
  const isOtherDay = storageKeyParam
    ? (() => { const d = targetDate; const n = new Date(); return !(d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()); })()
    : false;
  const targetDateLabel = isOtherDay
    ? targetDate.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })
    : "";
  const router = useRouter();

  const [tab, setTab] = useState<"nombre" | "codigo">("nombre");
  const [historialTab, setHistorialTab] = useState<"recientes" | "favoritos">("recientes");
  const [busqueda, setBusqueda] = useState("");
  const [codigo, setCodigo] = useState(code || "");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [producto, setProducto] = useState<Producto | null>(null);
  const [gramos, setGramos] = useState("100");
  const [portionLabelFromPicker, setPortionLabelFromPicker] = useState<string | undefined>(undefined);
  const [porcionUsadaIdx, setPorcionUsadaIdx] = useState<number | null>(null);
  const [porcionUsadaCantidad, setPorcionUsadaCantidad] = useState<string>("");
  const [mealSeleccionada, setMealSeleccionada] = useState<MealKey>((mealParam as MealKey) || "desayuno");
  const [cargando, setCargando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recentFoods, setRecentFoods] = useState<RecentFood[]>([]);
  const [favorites, setFavorites] = useState<FavoriteFood[]>([]);
  const [pesoEnvase, setPesoEnvase]       = useState("");
  const [nombreEnvase, setNombreEnvase]   = useState("");
  const [mostrarEnvaseManual, setMostrarEnvaseManual] = useState(false);
  // ── VOZ ──────────────────────────────────────────────────────────────────
  const [escuchando, setEscuchando] = useState(false);
  const [codigoNoEncontrado, setCodigoNoEncontrado] = useState<string | null>(null);
  const [alergias, setAlergias] = useState<string[]>([]);

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSearch = useRef("");
  const scrollRef = useRef<any>(null);
  // Keeps the SpeechRecognition instance alive — Chrome Android GC's local vars before events fire
  const recognitionRef   = useRef<any>(null);
  // MediaRecorder para el fallback Firefox
  const mediaRecorderRef = useRef<any>(null);

  useEffect(() => { cargarDatos(); }, []);

  // Recargar recientes cada vez que la pantalla recibe el foco (ej. volver de añadir al día)
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(RECENT_FOODS_KEY).then(v => {
      if (v) {
        const parsed: any[] = JSON.parse(v);
        setRecentFoods(parsed.map(f => ({ ...normalizarProducto(f), addedAt: f.addedAt })));
      }
    }).catch(() => {});
  }, []));

  // Callbacks estables para que React.memo en SwipeableFoodItem funcione correctamente.
  // Con la firma (prod: Producto) => void podemos pasarlos sin recrearlos en cada render.
  const handleSelectItem = useCallback((item: Producto) => { seleccionarProducto(item); }, []);
  const handleToggleFavItem = useCallback((item: Producto) => { handleToggleFav(item); }, [favorites]);

  // Realtime: sincronizar recientes y favoritos entre dispositivos de la misma cuenta
  useEffect(() => {
    let favCh: ReturnType<typeof supabase.channel> | null = null;
    let recCh: ReturnType<typeof supabase.channel> | null = null;
    getUid().then(uid => {
      if (!uid) return;
      favCh = supabase.channel(`add-food-favs-${uid}`)
        .on('postgres_changes' as any, {
          event: '*', schema: 'public', table: 'alimentos_favoritos',
          filter: `user_id=eq.${uid}`,
        }, async () => {
          const cloud = await loadFavsCloud();
          setFavorites(cloud);
          AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(cloud)).catch(() => {});
        })
        .subscribe();
      recCh = supabase.channel(`add-food-recs-${uid}`)
        .on('postgres_changes' as any, {
          event: '*', schema: 'public', table: 'alimentos_recientes',
          filter: `user_id=eq.${uid}`,
        }, async () => {
          const cloud = await loadRecientesCloud();
          setRecentFoods(cloud);
          AsyncStorage.setItem(RECENT_FOODS_KEY, JSON.stringify(cloud)).catch(() => {});
        })
        .subscribe();
    });
    return () => {
      if (favCh) supabase.removeChannel(favCh);
      if (recCh) supabase.removeChannel(recCh);
    };
  }, []);

  useEffect(() => {
    if (code) { setTab("codigo"); setCodigo(code); cargarPorCodigo(code); }
  }, [code]);

  const cargarDatos = async () => {
    // 0. Cache persistente — restaura búsquedas anteriores antes de cargar nada más
    cargarCachePersistente().catch(() => {});

    // 1. Local inmediato
    let recentRaw: string | null = null;
    try {
      recentRaw = await AsyncStorage.getItem(RECENT_FOODS_KEY);
      if (recentRaw) {
        const parsed: any[] = JSON.parse(recentRaw);
        setRecentFoods(parsed.map(f => ({ ...normalizarProducto(f), addedAt: f.addedAt })));
      }
    } catch {}
    const favsLocal = await cargarFavoritosStorage();
    setFavorites(favsLocal);
    try {
      const storedAlergias = await AsyncStorage.getItem("nutri_alergias");
      if (storedAlergias) setAlergias(JSON.parse(storedAlergias));
    } catch {}

    // 2. Merge con nube en background
    loadRecientesCloud().then(async cloudRec => {
      if (!cloudRec.length) return;
      const localStored = await AsyncStorage.getItem(RECENT_FOODS_KEY).catch(() => null);
      const local: RecentFood[] = localStored ? JSON.parse(localStored) : [];
      const merged = mergeRecientes(local, cloudRec);
      setRecentFoods(merged);
      AsyncStorage.setItem(RECENT_FOODS_KEY, JSON.stringify(merged)).catch(() => {});
    }).catch(() => {});

    loadFavsCloud().then(async cloudFavs => {
      if (!cloudFavs.length) return;
      const local = await cargarFavoritosStorage();
      const merged = mergeFavs(local, cloudFavs);
      setFavorites(merged);
      AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(merged)).catch(() => {});
    }).catch(() => {});

    // 3. Prefetch top 5 recientes en background (2s delay para no bloquear arranque)
    setTimeout(() => {
      try {
        const recents: RecentFood[] = recentRaw ? JSON.parse(recentRaw) : [];
        const top5 = recents.slice(0, 5);
        for (const rf of top5) {
          if (getMemCached(rf.nombre)) continue; // ya en cache
          const { principal, alternativas } = preprocesarQuery(rf.nombre);
          buscarAlimentosPersonalizados(principal, PAIS_USUARIO, alternativas)
            .then(deBD => {
              if (!deBD.length) return;
              const prods = deBD.map(p => ({ ...normalizarProducto(p), esPersonalizado: true, scanCount: p.scan_count ?? 0 }));
              setMemCached(rf.nombre, rankear(rf.nombre, prods));
            }).catch(() => {});
        }
      } catch {}
    }, 2000);
  };

  const favSet = useMemo(
    () => new Set(favorites.map((f) => f.nombre.toLowerCase())),
    [favorites]
  );
  const isFav = useCallback((nombre: string) => favSet.has(nombre.toLowerCase()), [favSet]);

  const handleToggleFav = async (prod: Producto) => {
    const nueva = await toggleFavoritoStorage(prod);
    setFavorites(nueva);
  };

  const resetEnvase = () => { setMostrarEnvaseManual(false); setPesoEnvase(""); setNombreEnvase(""); };
  const resetPorcion = () => { setPortionLabelFromPicker(undefined); };

  // Auto-guardar envase en AsyncStorage + Supabase cuando el usuario lo escribe
  useEffect(() => {
    if (!producto || producto.pesoEnvase) return;
    if (envaseTimerRef.current) clearTimeout(envaseTimerRef.current);
    if (!pesoEnvase || Number(pesoEnvase) <= 0) return;
    envaseTimerRef.current = setTimeout(async () => {
      const cacheId = producto.codigoBarras || producto.nombre;
      // Local (este dispositivo)
      AsyncStorage.setItem(ENVASE_CACHE_KEY(cacheId), pesoEnvase).catch(() => {});
      if (nombreEnvase.trim()) {
        AsyncStorage.setItem(ENVASE_NOMBRE_CACHE_KEY(cacheId), nombreEnvase.trim()).catch(() => {});
      }
      // Cloud (todos los usuarios) — por código de barras si existe, si no por nombre
      if (producto.codigoBarras) {
        try {
          const patchFields: Record<string, any> = { peso_envase: Number(pesoEnvase) };
          if (nombreEnvase.trim()) patchFields.nombre_unidad_envase = nombreEnvase.trim();
          const { data: rows } = await supabase
            .from("alimentos_personalizados")
            .update(patchFields)
            .eq("codigo_barras", producto.codigoBarras)
            .select("id");
          if (!rows || rows.length === 0) {
            await supabase.from("alimentos_personalizados").insert({
              nombre: producto.nombre,
              marca: producto.marca,
              supermercado: producto.supermercado,
              calorias: producto.nutrientes.calorias,
              proteinas: producto.nutrientes.proteinas,
              grasas: producto.nutrientes.grasas,
              grasas_saturadas: producto.nutrientes.grasasSaturadas,
              carbohidratos: producto.nutrientes.carbohidratos,
              azucares: producto.nutrientes.azucares,
              fibra: producto.nutrientes.fibra,
              sal: producto.nutrientes.sal,
              codigo_barras: producto.codigoBarras,
              es_compartido: true,
              ...patchFields,
            });
          }
        } catch {}
      } else {
        // Sin código de barras: actualizar/insertar por nombre
        try {
          const patchFields: Record<string, any> = { peso_envase: Number(pesoEnvase) };
          if (nombreEnvase.trim()) patchFields.nombre_unidad_envase = nombreEnvase.trim();
          const { data: rows } = await supabase
            .from("alimentos_personalizados")
            .update(patchFields)
            .ilike("nombre", producto.nombre)
            .select("id");
          if (!rows || rows.length === 0) {
            await supabase.from("alimentos_personalizados").insert({
              nombre: producto.nombre,
              marca: producto.marca,
              supermercado: producto.supermercado,
              calorias: producto.nutrientes.calorias,
              proteinas: producto.nutrientes.proteinas,
              grasas: producto.nutrientes.grasas,
              grasas_saturadas: producto.nutrientes.grasasSaturadas,
              carbohidratos: producto.nutrientes.carbohidratos,
              azucares: producto.nutrientes.azucares,
              fibra: producto.nutrientes.fibra,
              sal: producto.nutrientes.sal,
              es_compartido: true,
              ...patchFields,
            });
          }
        } catch {}
      }
    }, 1200);
    return () => { if (envaseTimerRef.current) clearTimeout(envaseTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pesoEnvase, nombreEnvase, producto?.codigoBarras, producto?.nombre, producto?.pesoEnvase]);

  // Suscripción en tiempo real: si otro usuario guarda peso/nombre de envase para este producto, se muestra aquí
  useEffect(() => {
    if (!producto || producto.pesoEnvase) return;
    const channel = supabase
      .channel(`envase-rt-${producto.nombre.replace(/\s+/g, '-')}`)
      .on('postgres_changes' as any, {
        event: 'UPDATE',
        schema: 'public',
        table: 'alimentos_personalizados',
      }, (payload: any) => {
        const row = payload.new;
        if (!row.peso_envase) return;
        const match = producto.codigoBarras
          ? row.codigo_barras === producto.codigoBarras
          : row.nombre?.toLowerCase() === producto.nombre.toLowerCase();
        if (match) {
          const envaseStr = String(row.peso_envase);
          setPesoEnvase(envaseStr);
          setMostrarEnvaseManual(true);
          if (row.nombre_unidad_envase) setNombreEnvase(row.nombre_unidad_envase);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [producto?.nombre, producto?.codigoBarras, producto?.pesoEnvase]);

  const macros = producto ? calcularMacros(producto.nutrientes, Number(gramos) || 0) : null;
  const caloriasCalculadas = macros ? macros.calorias.toFixed(0) : "0";
  const superColor = producto ? (SUPER_COLORS[producto.supermercado] || "#4B5563") : "#4B5563";

  // Marca recientes y los sube al principio, manteniendo el orden del resto
  const mezclarConRecientes = (lista: Producto[], q: string): Producto[] => {
    const q2 = q.toLowerCase();
    const recientesCoinciden = recentFoods
      .filter(r => r.nombre.toLowerCase().includes(q2))
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    if (recientesCoinciden.length === 0) return lista;

    const nombresLista = new Set(lista.map(p => p.nombre.toLowerCase()));

    // Recientes que coinciden: siempre usamos los datos del historial (supermercado, nutrientes, etc.)
    const recientesProductos: Producto[] = recientesCoinciden
      .map(r => ({ ...r, isRecent: true } as unknown as Producto));

    // El resto de la lista sin los que ya están como recientes
    const sinRecientes = lista.filter(p => !recientesCoinciden.some(r => r.nombre.toLowerCase() === p.nombre.toLowerCase()));

    return [...recientesProductos, ...sinRecientes];
  };

  const buscarConDebounce = (texto: string) => {
    setBusqueda(texto);
    setProducto(null);
    currentSearch.current = texto;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!texto.trim()) { setResultados([]); setCargando(false); return; }

    // 1. Cache en memoria — instantáneo si ya se buscó antes en esta sesión
    const cached = getMemCached(texto);
    if (cached) { setResultados(mezclarConRecientes(cached, texto)); setCargando(false); return; }

    // 2. Locales hardcoded — inmediato mientras carga BD
    const locales = rankear(texto, ALIMENTOS_BASICOS);
    if (locales.length > 0) setResultados(mezclarConRecientes(locales, texto));
    setCargando(true);

    debounceRef.current = setTimeout(async () => {
      if (currentSearch.current !== texto) return;

      // 3. D1/Supabase — búsqueda por texto literal del usuario
      try {
        const deBD = await buscarAlimentosPersonalizados(texto, PAIS_USUARIO, []).catch(() => [] as any[]);
        if (currentSearch.current !== texto) return;

        const vistos = new Set<string>();
        const productos: Producto[] = [];
        for (const p of deBD) {
          const k = (p.nombre ?? "").toLowerCase();
          if (!k || vistos.has(k)) continue;
          vistos.add(k);
          productos.push({ ...normalizarProducto(p), esPersonalizado: true, scanCount: p.scan_count ?? 0 });
        }

        if (productos.length > 0) {
          const rankeados = rankear(texto, productos);
          if (rankeados.length > 0 && currentSearch.current === texto) {
            const nombresDB = new Set(rankeados.map(r => r.nombre.toLowerCase()));
            const localesSinDup = locales.filter(l => !nombresDB.has(l.nombre.toLowerCase()));
            const merged = mezclarConRecientes([...rankeados, ...localesSinDup], texto);
            setResultados(merged);
            setMemCached(texto, merged);
            scrollRef.current?.scrollTo?.({ y: 0, animated: false });
          }
        }
      } catch {}

      if (currentSearch.current !== texto) return;

      // 4. APIs externas (OFF / USDA)
      try {
        await buscarProductosPorNombre(texto, (nuevos) => {
          if (currentSearch.current !== texto) return;
          setResultados(prev => {
            const vistosPrev = new Set(prev.map(p => p.nombre.toLowerCase()));
            const sinDup = nuevos.filter(n => !vistosPrev.has(n.nombre.toLowerCase()));
            if (sinDup.length === 0) return prev;
            const todo = mezclarConRecientes(rankear(texto, [...prev, ...sinDup]), texto);
            setMemCached(texto, todo);
            return todo;
          });
        }, PAIS_USUARIO);
      } catch {}

      if (currentSearch.current === texto) setCargando(false);
    }, 200);
  };

  // ── iniciarVoz — micrófono robusto para cualquier navegador/dispositivo ───────
  //
  // Dos causas raíz del fallo en Chrome Android:
  //  1. GC BUG: la variable `recognition` era local → Chrome la recolectaba antes
  //     de que disparara ningún evento. Fix: almacenarla en recognitionRef.
  //  2. PERMISSION CHAIN: getUserMedia establece el permiso de micrófono a nivel
  //     del navegador. El callback .then() de una promesa iniciada en un gesto de
  //     usuario conserva la "user activation" en Chrome, por lo que recognition.start()
  //     dentro de ese callback sí tiene permisos.
  //
  // NOT async — la función no puede ser async; el path web no usa await.
  const iniciarVoz = () => {
    if (Platform.OS === "web") {

      // ── Si ya está escuchando, parar ───────────────────────────────────────
      if (escuchando) {
        try { recognitionRef.current?.abort(); } catch {}
        recognitionRef.current = null;
        setEscuchando(false);
        return;
      }

      // ── Detección de soporte ──────────────────────────────────────────────
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) {
        // Fallback para Firefox u otros sin Web Speech API:
        // Grabamos con MediaRecorder y transcribimos vía Whisper en el servidor.
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          Alert.alert(t.voiceUnavailable, t.voiceUnavailableMsg);
          return;
        }

        // Si ya estaba grabando, parar
        if (escuchando) {
          try { mediaRecorderRef.current?.stop(); } catch {}
          return;
        }

        setEscuchando(true);
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
              ? "audio/webm;codecs=opus"
              : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
              ? "audio/ogg;codecs=opus"
              : "";
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            mediaRecorderRef.current = recorder;
            const chunks: BlobPart[] = [];

            recorder.ondataavailable = (e: any) => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = async () => {
              stream.getTracks().forEach((t: any) => t.stop());
              mediaRecorderRef.current = null;
              const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
              // Convertir a base64 data URL
              const base64: string = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
              try {
                const res = await fetch("/api/transcribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ audio: base64, lang: navigator.language }),
                });
                const json = await res.json();
                if (json.text) {
                  buscarConDebounce(json.text);
                } else if (json.error === "not-configured") {
                  Alert.alert(t.voiceNotConfigured, t.voiceNotConfiguredMsg);
                } else if (json.error) {
                  Alert.alert(t.voiceError, t.voiceTranscribeError);
                }
              } catch {
                Alert.alert(t.voiceError, t.voiceNoConnection);
              } finally {
                setEscuchando(false);
              }
            };

            recorder.start(200); // chunks cada 200ms para data rápida
            // Auto-detener tras 10 segundos
            setTimeout(() => {
              if (recorder.state !== "inactive") recorder.stop();
            }, 10000);
          })
          .catch((e: any) => {
            setEscuchando(false);
            mediaRecorderRef.current = null;
            if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
              Alert.alert(t.micBlocked, t.micAllowBrowser);
            } else {
              Alert.alert(t.error, t.micAccessError);
            }
          });
        return;
      }

      // ── Mensaje de instrucciones si el permiso está denegado ──────────────
      const instruccionesPermiso = t.micBlockedInstructions;

      // ── Crea el objeto SR, lo guarda en ref (evita GC) y llama start() ───
      const arrancarReconocimiento = () => {
        // Abortar cualquier reconocimiento previo que pudiera estar colgado
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch {}
          recognitionRef.current = null;
        }

        const recognition = new SR();
        recognitionRef.current = recognition;   // ← CRÍTICO: evita el GC en Chrome Android

        // Normalizar código de idioma: iOS Safari necesita "es-ES" no "es"
        // Si ya viene con región ("es-MX", "pt-BR"…) se usa directamente.
        // Solo se expande si es un código corto de 2 letras.
        const rawLang = navigator.language || "es-ES";
        const fullLangMap: Record<string, string> = {
          es: "es-ES", en: "en-US", fr: "fr-FR", de: "de-DE",
          zh: "zh-CN", pt: "pt-BR", it: "it-IT", ja: "ja-JP",
          ko: "ko-KR", ar: "ar-SA", ru: "ru-RU", nl: "nl-NL",
          pl: "pl-PL", sv: "sv-SE", nb: "nb-NO", da: "da-DK",
          fi: "fi-FI", tr: "tr-TR", he: "he-IL", hi: "hi-IN",
          id: "id-ID", ms: "ms-MY", th: "th-TH", vi: "vi-VN",
          cs: "cs-CZ", sk: "sk-SK", ro: "ro-RO", hu: "hu-HU",
          uk: "uk-UA", ca: "ca-ES", hr: "hr-HR", bg: "bg-BG",
        };
        // Si rawLang ya tiene región (longitud > 2), usarlo tal cual
        recognition.lang = rawLang.length > 2 ? rawLang : (fullLangMap[rawLang] ?? `${rawLang}-${rawLang.toUpperCase()}`);
        recognition.interimResults = false;
        recognition.continuous     = false;
        recognition.maxAlternatives = 3;

        // Auto-cancelar tras 15 s si el navegador no responde
        const timeoutId = setTimeout(() => {
          if (recognitionRef.current === recognition) {
            try { recognition.abort(); } catch {}
            setEscuchando(false);
            recognitionRef.current = null;
          }
        }, 15000);

        const limpiarTimeout = () => clearTimeout(timeoutId);

        recognition.onstart  = () => setEscuchando(true);
        recognition.onend    = () => { limpiarTimeout(); setEscuchando(false); recognitionRef.current = null; };
        recognition.onnomatch = () => { limpiarTimeout(); setEscuchando(false); recognitionRef.current = null; };

        recognition.onerror = (e: any) => {
          limpiarTimeout();
          setEscuchando(false);
          recognitionRef.current = null;
          switch (e.error) {
            case "not-allowed":
            case "service-not-allowed":
              Alert.alert(t.micBlocked, instruccionesPermiso, [{ text: t.understood }]);
              break;
            case "network":
              Alert.alert(t.noConnectionTitle, t.voiceNeedsInternet);
              break;
            case "audio-capture":
              Alert.alert(t.noMicTitle, t.noMicMsg);
              break;
            case "language-not-supported":
              // Reintentar siempre con español explícito
              try {
                const r2 = new SR();
                recognitionRef.current = r2;
                r2.lang = "es-ES"; // fallback universal
                r2.interimResults = false;
                r2.continuous = false;
                r2.maxAlternatives = 3;
                r2.onend    = () => { setEscuchando(false); recognitionRef.current = null; };
                r2.onerror  = () => { setEscuchando(false); recognitionRef.current = null; };
                r2.onresult = (ev: any) => {
                  setEscuchando(false);
                  recognitionRef.current = null;
                  for (let i = 0; i < (ev.results?.length ?? 0); i++) {
                    const t = ev.results[i]?.[0]?.transcript?.trim();
                    if (t) { buscarConDebounce(t); return; }
                  }
                };
                r2.start();
              } catch { setEscuchando(false); recognitionRef.current = null; }
              break;
            case "no-speech":
            case "aborted":
              break; // silencioso — el usuario no habló o canceló
            default:
              Alert.alert(t.voiceError, t.voiceGenericError.replace("{code}", e.error));
          }
        };

        recognition.onresult = (e: any) => {
          limpiarTimeout();
          setEscuchando(false);
          recognitionRef.current = null;
          for (let i = 0; i < (e.results?.length ?? 0); i++) {
            const texto = e.results[i]?.[0]?.transcript?.trim();
            if (texto) { buscarConDebounce(texto); return; }
          }
        };

        try {
          recognition.start();
        } catch (err: any) {
          limpiarTimeout();
          setEscuchando(false);
          recognitionRef.current = null;
          const name = err?.name ?? "";
          if (name === "NotAllowedError" || name === "SecurityError") {
            Alert.alert(t.micBlocked, instruccionesPermiso, [{ text: t.understood }]);
          } else if (name === "InvalidStateError") {
            // ya había un reconocimiento activo — ignorar
          } else {
            Alert.alert(t.voiceError, err?.message ?? t.micStartError);
          }
        }
      };

      // Llamar directamente desde el gesto del usuario — el navegador gestiona
      // el diálogo de permiso internamente. No usar getUserMedia: su .then() es
      // asíncrono y rompe el contexto de activación en Safari/Firefox Android.
      arrancarReconocimiento();
      return;
    }

    // ── Nativo: expo-speech-recognition (iOS / Android app) ─────────────────
    void (async () => {
      try {
        const { ExpoSpeechRecognitionModule } = await import("expo-speech-recognition");
        const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!granted) {
          Alert.alert(t.permissionDenied, t.activateMicSettings);
          return;
        }
        setEscuchando(true);
        // Usar el idioma real del dispositivo (funciona en Hermes + JSCore)
        const deviceLang = (() => {
          try { return new Intl.DateTimeFormat().resolvedOptions().locale || "es-ES"; }
          catch { return "es-ES"; }
        })();
        ExpoSpeechRecognitionModule.start({ lang: deviceLang, interimResults: false, continuous: false });
        const unsubResult = ExpoSpeechRecognitionModule.addListener("result", (event: any) => {
          const texto = event.results?.[0]?.transcript ?? "";
          if (texto.trim()) buscarConDebounce(texto.trim());
          setEscuchando(false);
          unsubResult.remove(); unsubError.remove(); unsubEnd.remove();
        });
        const unsubError = ExpoSpeechRecognitionModule.addListener("error", () => {
          setEscuchando(false);
          unsubResult.remove(); unsubError.remove(); unsubEnd.remove();
        });
        const unsubEnd = ExpoSpeechRecognitionModule.addListener("end", () => {
          setEscuchando(false);
          unsubResult.remove(); unsubError.remove(); unsubEnd.remove();
        });
      } catch {
        setEscuchando(false);
        Alert.alert(t.voiceUnavailable, t.voiceNativeUnavailable);
      }
    })();
  };

  const cargarPorCodigo = async (c: string) => {
    if (!c.trim()) return;
    setCargando(true);
    const prods = await buscarDesdeEscaneoMultiple(c);
    setCargando(false);
    if (prods.length === 0) {
      setCodigoNoEncontrado(c);
      return;
    }
    if (prods.length > 1) {
      // Múltiples versiones del mismo código → mostrar lista para que el usuario elija
      setResultados(prods.map(p => ({ ...normalizarProducto(p), codigoBarras: c.trim() })));
      setProducto(null);
      setBusqueda("");
      return;
    }
    // Un solo resultado → seleccionar directamente (comportamiento anterior)
    const normalizado = { ...normalizarProducto(prods[0]), codigoBarras: c.trim() };
    const updated = await registrarEnHistorial(normalizado);
    setRecentFoods(updated);
    setProducto(normalizado);
    setResultados([]);
    setGuardado(false);
    resetEnvase();
    resetPorcion();
    // Incrementar scan_count en D1 (igual que al buscar por nombre)
    if (!normalizado.esPersonalizado) {
      guardarAlimentoBuscado({
        nombre: normalizado.nombre, marca: normalizado.marca,
        supermercado: normalizado.supermercado,
        calorias: normalizado.nutrientes.calorias,
        proteinas: normalizado.nutrientes.proteinas,
        grasas: normalizado.nutrientes.grasas,
        grasas_saturadas: normalizado.nutrientes.grasasSaturadas ?? 0,
        carbohidratos: normalizado.nutrientes.carbohidratos,
        azucares: normalizado.nutrientes.azucares ?? 0,
        fibra: normalizado.nutrientes.fibra ?? 0,
        sal: normalizado.nutrientes.sal ?? 0,
        codigo_barras: c.trim(),
      }).catch(() => {});
    }
    if (!normalizado.pesoEnvase) {
      try {
        const saved = await AsyncStorage.getItem(ENVASE_CACHE_KEY(c.trim()));
        if (saved && Number(saved) > 0) {
          setPesoEnvase(saved);
          setMostrarEnvaseManual(true);
        }
        const savedNombre = await AsyncStorage.getItem(ENVASE_NOMBRE_CACHE_KEY(c.trim()));
        if (savedNombre) setNombreEnvase(savedNombre);
      } catch {}
    }
  };

  const seleccionarProducto = async (prod: Producto) => {
    Keyboard.dismiss();
    const normalizado = normalizarProducto(prod);
    const updated = await registrarEnHistorial(normalizado);
    setRecentFoods(updated);
    setProducto(normalizado);
    setResultados([]);
    setBusqueda("");
    setGramos("100");
    setGuardado(false);
    resetEnvase();
    // Guardar en Supabase si no proviene ya de ahí
    if (!prod.esPersonalizado) {
      guardarAlimentoBuscado({
        nombre: normalizado.nombre,
        marca: normalizado.marca,
        supermercado: normalizado.supermercado,
        calorias: normalizado.nutrientes.calorias,
        proteinas: normalizado.nutrientes.proteinas,
        grasas: normalizado.nutrientes.grasas,
        grasas_saturadas: normalizado.nutrientes.grasasSaturadas ?? 0,
        carbohidratos: normalizado.nutrientes.carbohidratos,
        azucares: normalizado.nutrientes.azucares ?? 0,
        fibra: normalizado.nutrientes.fibra ?? 0,
        sal: normalizado.nutrientes.sal ?? 0,
        ...((normalizado as any).codigoBarras ? { codigo_barras: (normalizado as any).codigoBarras } : {}),
      }).catch(() => {});
    }
    if (!normalizado.pesoEnvase) {
      const cacheId = (normalizado as any).codigoBarras || normalizado.nombre;
      try {
        const saved = await AsyncStorage.getItem(ENVASE_CACHE_KEY(cacheId));
        if (saved && Number(saved) > 0) {
          setPesoEnvase(saved);
          setMostrarEnvaseManual(true);
        }
        const savedNombre = await AsyncStorage.getItem(ENVASE_NOMBRE_CACHE_KEY(cacheId));
        if (savedNombre) setNombreEnvase(savedNombre);
      } catch {}
      // Obtener peso/nombre de envase de Supabase (datos de otros usuarios)
      supabase
        .from("alimentos_personalizados")
        .select("peso_envase, nombre_unidad_envase")
        .ilike("nombre", normalizado.nombre)
        .not("peso_envase", "is", null)
        .limit(1)
        .then(({ data }) => {
          if (data?.[0]?.peso_envase) {
            const envaseStr = String(data[0].peso_envase);
            setPesoEnvase(envaseStr);
            setMostrarEnvaseManual(true);
            AsyncStorage.setItem(ENVASE_CACHE_KEY(cacheId), envaseStr).catch(() => {});
            if (data[0].nombre_unidad_envase) {
              setNombreEnvase(data[0].nombre_unidad_envase);
              AsyncStorage.setItem(ENVASE_NOMBRE_CACHE_KEY(cacheId), data[0].nombre_unidad_envase).catch(() => {});
            }
          }
        }).catch(() => {});
    }
  };

  // ── guardarAlimento ───────────────────────────────────────────────────────
  const guardarAlimento = async () => {
    setSaveError(null);
    if (!producto) { setSaveError("Sin producto seleccionado."); return; }
    if (!macros)   { setSaveError("Sin macros calculados."); return; }

    const targetKey = storageKeyParam || STORAGE_KEY;
    const fechaStr  = targetKey.replace("nutri_meals_", "");
    const gramosNum = Number(gramos) || 0;

    // Calcular la etiqueta de la porción guardada
    const portionLabel = portionLabelFromPicker;

    const entradaComida = {
      id: Date.now().toString(),
      name: producto.nombre,
      brand: producto.marca,
      supermercado: producto.supermercado,
      calories: Number(caloriasCalculadas),
      protein: Number(macros.proteinas.toFixed(1)),
      carbs: Number(macros.carbohidratos.toFixed(1)),
      fat: Number(macros.grasas.toFixed(1)),
      saturatedFat: Number(macros.grasasSaturadas.toFixed(1)),
      sugar: Number(macros.azucares.toFixed(1)),
      fiber: Number(macros.fibra.toFixed(1)),
      salt: Number(macros.sal.toFixed(3)),
      portionLabel,
      per100: {
        calories: producto.nutrientes.calorias,
        protein: producto.nutrientes.proteinas,
        carbs: producto.nutrientes.carbohidratos,
        fat: producto.nutrientes.grasas,
        saturatedFat: producto.nutrientes.grasasSaturadas,
        sugar: producto.nutrientes.azucares,
        fiber: producto.nutrientes.fibra,
        salt: producto.nutrientes.sal,
      },
      porciones: (() => {
        const base = producto.porciones && producto.porciones.length > 0 ? [...producto.porciones] : [];
        const envaseG = Number(pesoEnvase) || producto.pesoEnvase || 0;
        if (envaseG > 0 && !base.some(p => p.gramos === envaseG)) {
          const rawNombre = nombreEnvase.trim()
            ? (nombreEnvase.trim().match(/^\d/) ? nombreEnvase.trim() : `1 ${nombreEnvase.trim()}`)
            : (producto.nombreUnidadEnvase ?? detectarNombreUnidad(producto.nombre, envaseG));
          base.push({ nombre: rawNombre.replace(/^1\s+/, ""), gramos: envaseG });
        }
        return base.length > 0 ? base : undefined;
      })(),
      porcionUsadaIdx: porcionUsadaIdx !== null ? porcionUsadaIdx : undefined,
      porcionUsadaCantidad: porcionUsadaIdx !== null ? porcionUsadaCantidad : undefined,
    };

    // Guardar envase manual en caché local (para este dispositivo)
    if (Number(pesoEnvase) > 0 && !producto.pesoEnvase) {
      const cacheId = producto.codigoBarras || producto.nombre;
      AsyncStorage.setItem(ENVASE_CACHE_KEY(cacheId), pesoEnvase).catch(() => {});
      if (nombreEnvase.trim()) {
        AsyncStorage.setItem(ENVASE_NOMBRE_CACHE_KEY(cacheId), nombreEnvase.trim()).catch(() => {});
      }
    }

    // Si el usuario introdujo el envase manualmente con código de barras → guardar para todos
    if (Number(pesoEnvase) > 0 && producto.codigoBarras && !producto.pesoEnvase) {
      (async () => {
        try {
          const updates: any = { peso_envase: Number(pesoEnvase) };
          if (nombreEnvase.trim()) updates.nombre_unidad_envase = nombreEnvase.trim();
          await supabase.from("alimentos_personalizados")
            .update(updates)
            .eq("codigo_barras", producto.codigoBarras!);
        } catch {}
      })();
    }

    try {
      // 1. Guardar en AsyncStorage
      const stored = await AsyncStorage.getItem(targetKey);
      const base = { desayuno: [] as any[], comida: [] as any[], merienda: [] as any[], cena: [] as any[] };
      const meals = stored ? { ...base, ...JSON.parse(stored) } : base;
      meals[mealSeleccionada] = [...(meals[mealSeleccionada] ?? []), entradaComida];
      await AsyncStorage.setItem(targetKey, JSON.stringify(meals));
      syncDayToCloud(targetKey, meals);

      // 2. Supabase en background (no bloquea si falla)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          supabase.from("comidas").insert({
            user_id: session.user.id,
            fecha: fechaStr,
            meal_type: mealSeleccionada,
            food_data: entradaComida,
          });
          // Actualizar racha del día al guardar comida
          actualizarRacha(session.user.id).catch(() => {});
        }
      }).catch(() => {});

      // Señal síncrona a index con el objeto de meals ya guardado
      signalMealSaved(meals, targetKey);

      setGuardado(true);
      setTimeout(() => {
        // Volver al estado inicial para añadir otro alimento
        setProducto(null);
        setBusqueda("");
        setResultados([]);
        setGramos("100");
        setSaveError(null);
        setGuardado(false);
      }, 800);
    } catch (e: any) {
      setSaveError(e?.message ?? t.saveErrorMsg);
    }
  };


  const listaHistorial = historialTab === "recientes" ? recentFoods : favorites;

  const renderHistorial = () => (
    <View style={s.historialWrap}>
      <View style={s.historialTabs}>
        <TouchableOpacity style={[s.historialTab, historialTab === "recientes" && s.historialTabActive]} onPress={() => setHistorialTab("recientes")}>
          <Text style={[s.historialTabText, historialTab === "recientes" && s.historialTabTextActive]}>{t.recentFoods}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.historialTab, historialTab === "favoritos" && s.historialTabActive]} onPress={() => setHistorialTab("favoritos")}>
          <Text style={[s.historialTabText, historialTab === "favoritos" && s.historialTabTextActive]}>{t.favorites}</Text>
        </TouchableOpacity>
      </View>
      {listaHistorial.length > 0 && <Text style={s.swipeHint}>{t.swipeToFav}</Text>}
      {listaHistorial.length === 0 ? (
        <Text style={s.emptyHistory}>
          {historialTab === "recientes" ? t.noRecentFoods : t.noFavorites}
        </Text>
      ) : (
        listaHistorial.map((food, i) => (
          <SwipeableFoodItem key={i} prod={food} isFav={isFav(food.nombre)} onSelect={handleSelectItem} onToggleFav={handleToggleFavItem} colors={colors} alergias={alergias} />
        ))
      )}
      {historialTab === "recientes" && recentFoods.length > 0 && (
        <TouchableOpacity onPress={async () => { setRecentFoods([]); await AsyncStorage.removeItem(RECENT_FOODS_KEY); clearRecientesCloud().catch(() => {}); }} style={s.clearAllBtn}>
          <Text style={s.clearAllBtnText}>{t.clearRecent}</Text>
        </TouchableOpacity>
      )}
      <View style={s.quickBtns}>
        <TouchableOpacity style={s.quickBtn} onPress={() => router.push({ pathname: "/recetas", params: { openCreate: "1" } })}>
          <Text style={s.quickBtnText}>{t.addFromRecipes}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // Header compartido para FlatList (tab nombre) y ScrollView (resto de tabs)
  const renderHeader = () => (
    <>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.backText}>{t.back}</Text></TouchableOpacity>
        <View style={s.titleRow}>
          <Text style={s.title}>{t.addFoodTitle}</Text>
          <TouchableOpacity style={s.crealoBtn} onPress={() => router.push("/create-food")}>
            <Text style={s.crealoBtnText}>{t.createYourself}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, tab === "nombre" && s.tabActive]} onPress={() => { setTab("nombre"); setProducto(null); setResultados([]); setBusqueda(""); setCodigoNoEncontrado(null); }}>
          <Text style={[s.tabText, tab === "nombre" && s.tabTextActive]}>{t.byName}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === "codigo" && s.tabActive]} onPress={() => { setTab("codigo"); setProducto(null); setResultados([]); setCodigoNoEncontrado(null); }}>
          <Text style={[s.tabText, tab === "codigo" && s.tabTextActive]}>{t.byBarcode}</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // Tab "nombre" sin producto: FlatList como scroll raíz para virtualización real
  if (tab === "nombre" && !producto) {
    const listHeader = (
      <View style={s.section}>
        {renderHeader()}
        <View style={s.searchBox}>
          <Text style={s.searchIcon}>🔍</Text>
          <TextInput style={s.searchInput} value={busqueda} onChangeText={buscarConDebounce} placeholder="Manzana, pollo, arroz..." placeholderTextColor={colors.textMuted} returnKeyType="search" autoCorrect={false} autoCapitalize="none" />
          {busqueda.length > 0 && (
            <TouchableOpacity onPress={() => { setBusqueda(""); setResultados([]); setCargando(false); currentSearch.current = ""; }}>
              <Text style={s.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={iniciarVoz} style={{ paddingHorizontal: 4 }}>
            <Text style={[s.clearBtn, escuchando && { color: "#F87171" }]}>
              {escuchando ? "🔴" : "🎤"}
            </Text>
          </TouchableOpacity>
        </View>
        {busqueda.length === 0 && renderHistorial()}
        {busqueda.length > 0 && cargando && resultados.length === 0 && (
          [0,1,2].map(i => <SkeletonFoodItem key={i} colors={colors} />)
        )}
        {busqueda.length > 0 && cargando && resultados.length > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 4 }}>
            <ActivityIndicator size="small" color="#1F6FEB" />
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t.loading}</Text>
          </View>
        )}
      </View>
    );

    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
        <FlatList
          ref={scrollRef}
          data={busqueda.length > 0 ? resultados : []}
          keyExtractor={(item, i) => `${item.nombre}_${i}`}
          renderItem={({ item }) => (
            <SwipeableFoodItem
              prod={item}
              isFav={isFav(item.nombre)}
              onSelect={handleSelectItem}
              onToggleFav={handleToggleFavItem}
              colors={colors}
              alergias={alergias}
            />
          )}
          ListHeaderComponent={listHeader}
          ListFooterComponent={
            busqueda.length > 0 && !cargando && resultados.length === 0 ? (
              <View style={[s.section, s.noResultsWrap]}>
                <Text style={s.emptyText}>{t.noResults} "{busqueda}"</Text>
                {!isOnline && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EF444422", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 14 }}>📡</Text>
                    <Text style={{ color: "#EF4444", fontSize: 13 }}>{t.noConnection}</Text>
                  </View>
                )}
                <TouchableOpacity style={s.quickBtn} onPress={() => router.push("/create-food")}><Text style={s.quickBtnText}>{t.createThisFood}</Text></TouchableOpacity>
                <TouchableOpacity style={s.quickBtn} onPress={() => router.push({ pathname: "/recetas", params: { openCreate: "1" } })}><Text style={s.quickBtnText}>{t.addFromRecipes}</Text></TouchableOpacity>
              </View>
            ) : <View style={{ height: 60 }} />
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 16, backgroundColor: colors.bg }}
          initialNumToRender={8}
          maxToRenderPerBatch={5}
          windowSize={5}
          removeClippedSubviews={Platform.OS !== "web"}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <ScrollView ref={scrollRef} style={[s.scroll, { backgroundColor: colors.bg }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {renderHeader()}

        {tab === "codigo" && !producto && (
          <View style={s.section}>
            <View style={s.searchRow}>
              <TextInput style={s.searchInputCodigo} value={codigo} onChangeText={setCodigo} placeholder={t.enterBarcode} placeholderTextColor={colors.textMuted} keyboardType="numeric" returnKeyType="search" onSubmitEditing={() => cargarPorCodigo(codigo)} />
              <TouchableOpacity style={s.searchBtn} onPress={() => cargarPorCodigo(codigo)}><Text style={s.searchBtnText}>{t.confirm}</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={s.scanBtn} onPress={() => router.push("/scanner")}><Text style={s.scanBtnText}>{t.scanWithCamera}</Text></TouchableOpacity>
            {cargando && [0,1,2].map(i => <SkeletonFoodItem key={i} colors={colors} />)}
            {codigoNoEncontrado && !cargando && (
              <View style={s.notFoundBanner}>
                <Text style={s.notFoundTitle}>{t.barcodeNotFound}</Text>
                <Text style={s.notFoundSub}>{codigoNoEncontrado}</Text>
                <View style={s.notFoundBtns}>
                  <TouchableOpacity style={s.notFoundBtn} onPress={() => { setCodigoNoEncontrado(null); router.back(); }}>
                    <Text style={s.notFoundBtnText}>{t.back}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.notFoundBtn, s.notFoundBtnPrimary]} onPress={() => router.push({ pathname: "/create-food", params: { scannedCode: codigoNoEncontrado } })}>
                    <Text style={[s.notFoundBtnText, s.notFoundBtnPrimaryText]}>{t.addNewFood}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {!cargando && !codigoNoEncontrado && renderHistorial()}
          </View>
        )}

        {producto && (
          <View style={s.productCard}>
            <View style={s.productHeader}>
              <TouchableOpacity style={s.changeBtn} onPress={() => { setProducto(null); setGuardado(false); resetEnvase(); }}><Text style={s.changeBtnText}>← Cambiar</Text></TouchableOpacity>
              <View style={s.productTitleRow}>
                <View style={s.productNameRow}>
                  <Text style={s.productName}>{producto.nombre}</Text>
                  {producto.esPersonalizado && <View style={s.customBadge}><Text style={s.customBadgeText}>{t.customBadge}</Text></View>}
                </View>
                <TouchableOpacity style={s.productFavBtn} onPress={() => handleToggleFav(producto)}>
                  <Text style={[s.productFavIcon, isFav(producto.nombre) && s.productFavIconActive]}>{isFav(producto.nombre) ? "★" : "☆"}</Text>
                </TouchableOpacity>
              </View>
              <View style={s.productMeta}>
                <View style={[s.superBadgeLg, { backgroundColor: superColor + "22", borderColor: superColor + "55" }]}><Text style={[s.superBadgeLgText, { color: superColor }]}>{producto.supermercado}</Text></View>
                {producto.marca !== "Natural" && producto.marca !== "Sin marca" && producto.marca !== producto.supermercado && <Text style={s.productMarca}>{producto.marca}</Text>}
              </View>
            </View>

            {/* ── Selector de cantidad ── */}
            <QuantitySelector
              key={`${producto.nombre}_${producto.pesoEnvase ?? ""}_${pesoEnvase}_${nombreEnvase}`}
              producto={producto}
              pesoEnvaseNum={Number(pesoEnvase) || 0}
              nombreEnvaseCustom={nombreEnvase || undefined}
              onGramosChange={(g, label, pidx, pcant) => {
                setGramos(String(g));
                setPortionLabelFromPicker(label);
                setPorcionUsadaIdx(pidx);
                setPorcionUsadaCantidad(pcant);
                setGuardado(false);
              }}
              colors={colors}
            />

            {/* Manual envase input (only when product has no preset weight) */}
            {!producto.pesoEnvase && (
              <View style={s.envaseWrapCompact}>
                {!mostrarEnvaseManual ? (
                  <TouchableOpacity style={s.envaseBtn} onPress={() => setMostrarEnvaseManual(true)}>
                    <Text style={s.envaseBtnText}>{t.addPackageWeightBtn}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={s.envaseWrap}>
                    <View style={s.envaseRow}>
                      <View style={s.envaseLeft}>
                        <Text style={s.envaseLabel}>{t.weightGramsLabel}</Text>
                        <Text style={s.envaseHint}>{t.weightGramsExample}</Text>
                      </View>
                      <TextInput style={s.envaseInput} value={pesoEnvase} onChangeText={v => { setPesoEnvase(v); setGuardado(false); }} keyboardType="numeric" selectTextOnFocus placeholder="125" placeholderTextColor={colors.textMuted} />
                    </View>
                    <View style={s.envaseRow}>
                      <View style={s.envaseLeft}>
                        <Text style={s.envaseLabel}>{t.unitNameLabel}</Text>
                        <Text style={s.envaseHint}>{t.unitNameExample}</Text>
                      </View>
                      <TextInput style={s.envaseInput} value={nombreEnvase} onChangeText={v => { setNombreEnvase(v); setGuardado(false); }} placeholder={t.unitNamePlaceholder} placeholderTextColor={colors.textMuted} />
                    </View>
                    <TouchableOpacity onPress={resetEnvase}><Text style={s.envaseClose}>{t.removePackage}</Text></TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            <View style={s.macrosGrid}>
              {[
                { val: caloriasCalculadas, label: "kcal", color: "#4ADE80", border: "#4ADE8033" },
                { val: macros?.proteinas.toFixed(1) + "g", label: t.proteins, color: "#60A5FA", border: "#60A5FA33" },
                { val: macros?.carbohidratos.toFixed(1) + "g", label: t.carbs, color: "#FBBF24", border: "#FBBF2433" },
                { val: macros?.grasas.toFixed(1) + "g", label: t.fats, color: "#F87171", border: "#F8717133" },
              ].map((item) => (
                <View key={item.color} style={[s.macroBox, { borderColor: item.border }]}>
                  <Text style={[s.macroBoxVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={s.macroBoxLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            <View style={s.macrosGrid}>
              {[
                { val: macros?.grasasSaturadas.toFixed(1) + "g", label: t.saturatedFat, color: "#FCA5A5", border: "#F8717122" },
                { val: macros?.azucares.toFixed(1) + "g", label: t.sugars, color: "#FDE68A", border: "#FBBF2422" },
                { val: macros?.fibra.toFixed(1) + "g", label: t.fiber, color: "#6EE7B7", border: "#34D39933" },
                { val: macros?.sal.toFixed(2) + "g", label: t.saltLabel, color: "#CBD5E1", border: "#94A3B833" },
              ].map((item) => (
                <View key={item.color} style={[s.macroBox, { borderColor: item.border }]}>
                  <Text style={[s.macroBoxVal, s.macroBoxValSm, { color: item.color }]}>{item.val}</Text>
                  <Text style={s.macroBoxLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            <Text style={s.mealSelectorTitle}>{t.addTo}</Text>
            {isOtherDay && (
              <View style={{ backgroundColor: "#1F6FEB22", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#1F6FEB55", marginBottom: 4 }}>
                <Text style={{ color: "#58A6FF", fontSize: 13, fontWeight: "600", textAlign: "center" }}>{t.addingToDate.replace("{date}", targetDateLabel)}</Text>
              </View>
            )}
            <View style={s.mealSelector}>
              {(Object.keys(MEAL_LABELS) as MealKey[]).map((m) => (
                <TouchableOpacity key={m} style={[s.mealChip, mealSeleccionada === m && s.mealChipActive]} onPress={() => setMealSeleccionada(m)}>
                  <Text style={s.mealChipIcon}>{MEAL_ICONS[m]}</Text>
                  <Text style={[s.mealChipText, mealSeleccionada === m && s.mealChipTextActive]}>{m === "desayuno" ? t.breakfast : m === "comida" ? t.lunch : m === "merienda" ? t.snack : t.dinner}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {saveError && (
              <View style={{ backgroundColor: "#EF444422", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#EF444455", marginBottom: 8 }}>
                <Text style={{ color: "#EF4444", fontSize: 13, fontWeight: "600", textAlign: "center" }}>⚠ {saveError}</Text>
              </View>
            )}
            <TouchableOpacity style={[s.saveBtn, guardado && s.saveBtnDone]} onPress={guardarAlimento} disabled={guardado}>
              <Text style={s.saveBtnText}>{guardado ? t.saved : t.save}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── QuantitySelector ─────────────────────────────────────────────────────────
function QuantitySelector({ producto, pesoEnvaseNum, nombreEnvaseCustom, onGramosChange, colors }: {
  producto: Producto;
  pesoEnvaseNum: number;
  nombreEnvaseCustom?: string;
  onGramosChange: (grams: number, label: string | undefined, porcionIdx: number | null, porcionCantidad: string) => void;
  colors: any;
}) {
  const { t } = useApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chips = useMemo(() => buildChips(producto, pesoEnvaseNum, nombreEnvaseCustom),
    [producto.nombre, producto.pesoEnvase, JSON.stringify(producto.porciones), pesoEnvaseNum, nombreEnvaseCustom]);

  const [selKey, setSelKey]   = useState(chips[0]?.key ?? "g");
  const [qty,    setQty]      = useState(1);
  const [gramTxt, setGramTxt] = useState("100");
  const [foodUnit, setFoodUnit] = useState<FoodUnit>("g");
  const totalRef = useRef<number>(100); // ref para leer el valor actual sin closure stale

  const sel   = chips.find(c => c.key === selKey) ?? chips[chips.length - 1];
  const total = sel.isGram
    ? Math.round(parseFloat((((Number(gramTxt) || 0) * FOOD_UNIT_GRAMS[foodUnit]).toFixed(4))))
    : sel.hasQty
      ? Math.round(sel.grams * qty)
      : sel.grams;

  totalRef.current = total;

  const changeFoodUnit = (newUnit: FoodUnit) => {
    const currentGrams = Math.round(parseFloat((((Number(gramTxt) || 0) * FOOD_UNIT_GRAMS[foodUnit]).toFixed(4))));
    setGramTxt(String(+fromGrams(currentGrams, newUnit).toFixed(2)));
    setFoodUnit(newUnit);
  };

  const notifyParent = (t: number) => {
    const unitName = sel.topLine.replace(/^\d+\s+/, "");
    const label = sel.isGram ? undefined
      : sel.hasQty ? `${qty} ${unitName}`.trim()
      : sel.topLine;
    const porcionIdx = (!sel.isGram && sel.key.startsWith("p_"))
      ? (producto.porciones?.findIndex(p => `p_${p.nombre}` === sel.key) ?? -1)
      : -1;
    const porcionIdxFinal = porcionIdx >= 0 ? porcionIdx : null;
    const porcionCantidad = porcionIdxFinal !== null ? String(qty) : "";
    onGramosChange(Math.max(1, t), label || undefined, porcionIdxFinal, porcionCantidad);
  };

  useEffect(() => {
    notifyParent(total);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, sel.key, qty]);

  const pick = (key: string) => {
    setSelKey(key);
    setQty(1);
    if (chips.find(c => c.key === key)?.isGram) setGramTxt("100");
  };

  return (
    <View style={{ gap: 10 }}>
      {/* ── Chips de unidad ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
        {chips.map(c => {
          const active = c.key === selKey;
          return (
            <TouchableOpacity
              key={c.key}
              onPress={() => pick(c.key)}
              style={[qss.chip,
                { borderColor: active ? "#1F6FEB" : colors.cardBorder,
                  backgroundColor: active ? "#1F6FEB" : colors.card }]}
              activeOpacity={0.7}
            >
              <Text style={[qss.chipTop, { color: active ? "#fff" : colors.text }]}>{c.topLine}</Text>
              {c.bottomLine && (
                <Text style={[qss.chipBot, { color: active ? "#93C5FD" : colors.textMuted }]}>{c.bottomLine}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Stepper para unidades con cantidad ── */}
      {sel.hasQty && (
        <View style={[qss.stepRow, { backgroundColor: colors.bg }]}>
          <TouchableOpacity style={qss.stepBtn} onPress={() => setQty(q => Math.max(1, q - 1))}>
            <Text style={qss.stepBtnText}>−</Text>
          </TouchableOpacity>
          <View style={qss.stepMid}>
            <Text style={[qss.stepNum, { color: colors.text }]}>{qty}</Text>
            <Text style={[qss.stepUnit, { color: colors.textMuted }]}>{sel.topLine}</Text>
          </View>
          <TouchableOpacity style={qss.stepBtn} onPress={() => setQty(q => q + 1)}>
            <Text style={qss.stepBtnText}>+</Text>
          </TouchableOpacity>
          <View style={[qss.stepBadge, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={qss.stepBadgeNum}>{total}</Text>
            <Text style={qss.stepBadgeG}>g</Text>
          </View>
        </View>
      )}

      {/* ── Valor fijo (fracciones, 100g) ── */}
      {!sel.hasQty && !sel.isGram && (
        <View style={[qss.fixedRow, { backgroundColor: colors.bg }]}>
          <Text style={[qss.fixedLabel, { color: colors.textSub }]}>{sel.topLine}</Text>
          <Text style={qss.fixedVal}>{total} g</Text>
        </View>
      )}

      {/* ── Entrada libre de gramos ── */}
      {sel.isGram && (
        <View style={{ gap: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
            {(["g", "oz", "cup", "tbsp", "tsp", "ml"] as FoodUnit[]).map(u => {
              const label = u === "cup" ? t.unitCup : u === "tbsp" ? t.unitTbsp : u === "tsp" ? t.unitTsp : u;
              const active = foodUnit === u;
              return (
                <TouchableOpacity key={u} onPress={() => changeFoodUnit(u)}
                  style={{ borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 6,
                    borderColor: active ? "#1F6FEB" : colors.cardBorder,
                    backgroundColor: active ? "#1F6FEB22" : colors.card }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#58A6FF" : colors.textSub }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={[qss.gramRow, { backgroundColor: colors.bg }]}>
            <Text style={[qss.gramLabel, { color: colors.textSub }]}>{t.foodUnitLabel}</Text>
            <TextInput
              style={[qss.gramInput,
                { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.card }]}
              value={gramTxt}
              onChangeText={v => { setGramTxt(v.replace(",", ".").replace(/[^0-9.]/g, "")); }}
              keyboardType="decimal-pad"
              selectTextOnFocus
            />
            <Text style={[qss.gramG, { color: colors.textMuted }]}>{foodUnit === "cup" ? t.unitCup : foodUnit === "tbsp" ? t.unitTbsp : foodUnit === "tsp" ? t.unitTsp : foodUnit}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const qss = StyleSheet.create({
  chip:        { borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center", minWidth: 64 },
  chipTop:     { fontSize: 13, fontWeight: "700" },
  chipBot:     { fontSize: 11, marginTop: 2 },
  stepRow:     { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 12, gap: 10 },
  stepBtn:     { width: 46, height: 46, borderRadius: 23, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" },
  stepBtnText: { color: "#fff", fontSize: 26, fontWeight: "300", lineHeight: 30 },
  stepMid:     { flex: 1, alignItems: "center", gap: 2 },
  stepNum:     { fontSize: 38, fontWeight: "900", lineHeight: 42 },
  stepUnit:    { fontSize: 11 },
  stepBadge:   { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center", minWidth: 60 },
  stepBadgeNum:{ color: "#4ADE80", fontSize: 20, fontWeight: "800" },
  stepBadgeG:  { color: "#4ADE80", fontSize: 11 },
  fixedRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, padding: 14 },
  fixedLabel:  { fontSize: 15 },
  fixedVal:    { color: "#4ADE80", fontSize: 18, fontWeight: "700" },
  gramRow:     { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14 },
  gramLabel:   { fontSize: 15, flex: 1 },
  gramInput:   { borderWidth: 1.5, borderRadius: 12, padding: 10, fontSize: 22, fontWeight: "800", width: 100, textAlign: "center" },
  gramG:       { fontSize: 15 },
});
// ─────────────────────────────────────────────────────────────────────────────

function makeSwStyles(c: any) { return StyleSheet.create({
  wrap: { position: "relative", marginTop: 8, overflow: "hidden", borderRadius: 12 },
  favBg: { position: "absolute", right: 0, top: 0, bottom: 0, width: 72, backgroundColor: c.textMuted, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  favBgActive: { backgroundColor: "#78350F" },
  favBgBtn: { alignItems: "center", justifyContent: "center", gap: 2, width: "100%", height: "100%" },
  favBgIcon: { color: "#FBBF24", fontSize: 22 },
  favBgText: { color: "#FBBF24", fontSize: 9, fontWeight: "700" },
  item: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
  itemInner: { flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 },
  left: { flex: 1, marginRight: 8, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: c.text, fontSize: 14, fontWeight: "600", flex: 1 },
  customBadge: { backgroundColor: "#A78BFA22", borderWidth: 1, borderColor: "#A78BFA55", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  customBadgeText: { color: "#A78BFA", fontSize: 9, fontWeight: "700" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  superBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  superBadgeText: { fontSize: 10, fontWeight: "700" },
  marca: { color: c.textMuted, fontSize: 11 },
  macros: { color: c.textMuted, fontSize: 11 },
  right: { alignItems: "center" },
  kcal: { color: "#4ADE80", fontSize: 18, fontWeight: "800" },
  kcalUnit: { color: c.textMuted, fontSize: 10 },
  starBtn: { paddingHorizontal: 12, paddingVertical: 14 },
  starIcon: { fontSize: 20, color: c.textMuted },
  starIconActive: { color: "#FBBF24" },
}); }

function makeSStyles(c: any) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 16, paddingBottom: 8, gap: 4 },
  backText: { color: "#58A6FF", fontSize: 14, marginBottom: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: c.text, fontSize: 26, fontWeight: "800" },
  crealoBtn: { backgroundColor: "#1F6FEB22", borderWidth: 1, borderColor: "#58A6FF88", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  crealoBtnText: { color: "#58A6FF", fontSize: 13, fontWeight: "600" },
  tabs: { flexDirection: "row", gap: 10, marginVertical: 16 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, alignItems: "center" },
  tabActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
  tabText: { color: c.textMuted, fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: "#58A6FF" },
  section: { gap: 8 },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4, gap: 8 },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, color: c.text, fontSize: 15, paddingVertical: 10 },
  clearBtn: { color: c.textMuted, fontSize: 14, paddingHorizontal: 4 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  loadingText: { color: c.textMuted, fontSize: 12 },
  searchRow: { flexDirection: "row", gap: 10 },
  searchInputCodigo: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, color: c.text, fontSize: 15 },
  searchBtn: { backgroundColor: "#1F6FEB", borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  scanBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14, alignItems: "center" },
  scanBtnText: { color: c.textSub, fontSize: 14, fontWeight: "600" },
  historialWrap: { gap: 8, paddingTop: 8 },
  historialTabs: { flexDirection: "row", backgroundColor: c.card, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: c.cardBorder },
  historialTab: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  historialTabActive: { backgroundColor: "#1F6FEB" },
  historialTabText: { color: c.textMuted, fontSize: 13, fontWeight: "600" },
  historialTabTextActive: { color: "#fff", fontWeight: "700" },
  swipeHint: { color: c.textMuted, fontSize: 11, textAlign: "right" },
  emptyHistory: { color: c.textMuted, fontSize: 13, textAlign: "center", paddingVertical: 16 },
  clearAllBtn: { alignItems: "center", paddingVertical: 4 },
  clearAllBtnText: { color: c.textMuted, fontSize: 12 },
  quickBtns: { gap: 6, marginTop: 4 },
  quickBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, alignItems: "center" },
  quickBtnText: { color: c.textMuted, fontSize: 13 },

  noResultsWrap: { gap: 8, alignItems: "center", paddingTop: 8 },
  notFoundBanner: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 20, marginTop: 20, gap: 12, alignItems: "center" },
  notFoundTitle: { color: c.text, fontSize: 16, fontWeight: "700" },
  notFoundSub: { color: c.textMuted, fontSize: 12, fontFamily: "monospace" },
  notFoundBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  notFoundBtn: { flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, alignItems: "center" },
  notFoundBtnText: { color: c.textSub, fontSize: 13, fontWeight: "600" },
  notFoundBtnPrimary: { backgroundColor: "#1F6FEB", borderColor: "#1F6FEB" },
  notFoundBtnPrimaryText: { color: "#fff" },
  emptyText: { color: c.textMuted, fontSize: 13, textAlign: "center" },
  productCard: { backgroundColor: c.card, borderRadius: 20, padding: 18, marginTop: 8, borderWidth: 1, borderColor: c.cardBorder, gap: 16 },
  productHeader: { gap: 6 },
  changeBtn: { alignSelf: "flex-start", marginBottom: 2 },
  changeBtnText: { color: "#58A6FF", fontSize: 13 },
  productTitleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  productNameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  productName: { color: c.text, fontSize: 18, fontWeight: "800", flex: 1 },
  productFavBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  productFavIcon: { fontSize: 20, color: c.textMuted },
  productFavIconActive: { color: "#FBBF24" },
  productMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  superBadgeLg: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  superBadgeLgText: { fontSize: 12, fontWeight: "700" },
  productMarca: { color: c.textMuted, fontSize: 12 },
  customBadge: { backgroundColor: "#A78BFA22", borderWidth: 1, borderColor: "#A78BFA55", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  customBadgeText: { color: "#A78BFA", fontSize: 9, fontWeight: "700" },
  cantidadWrap: { gap: 10 },
  gramosRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.bg, borderRadius: 12, padding: 14 },
  gramosLabel: { color: c.textSub, fontSize: 15 },
  gramosInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 10, color: c.text, fontSize: 22, fontWeight: "800", width: 100, textAlign: "center" },
  envaseAutoWrap: { backgroundColor: c.bg, borderRadius: 12, padding: 14, gap: 12 },
  envaseAutoHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  envaseAutoLabel: { color: c.textSub, fontSize: 13, fontWeight: "600" },
  envaseAutoHint: { color: c.textMuted, fontSize: 10, marginTop: 2 },
  envaseManualLink: { color: c.textMuted, fontSize: 11, textAlign: "center" },
  envaseWrapCompact: { marginTop: 2 },
  envaseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 10 },
  envaseBtnText: { color: c.textMuted, fontSize: 13 },
  envaseWrap: { backgroundColor: c.bg, borderRadius: 12, padding: 14, gap: 12 },
  envaseRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  envaseLeft: { flex: 1, gap: 3 },
  envaseLabel: { color: c.textSub, fontSize: 14, fontWeight: "600" },
  envaseHint: { color: c.textMuted, fontSize: 11 },
  envaseInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 10, color: c.text, fontSize: 20, fontWeight: "800", width: 90, textAlign: "center" },
  envasePorciones: { flexDirection: "row", gap: 8 },
  porcionesWrap: { backgroundColor: c.bg, borderRadius: 12, padding: 14, gap: 10 },
  porcionesTitle: { color: c.textSub, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  porcionesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  porcionItemBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center", gap: 2 },
  porcionItemBtnActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
  porcionItemNombre: { color: c.textSub, fontSize: 13, fontWeight: "600" },
  porcionItemNombreActive: { color: "#58A6FF" },
  cantidadPorcionWrap: { backgroundColor: c.card, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: "#1F6FEB33" },
  cantidadPorcionLabel: { color: c.textSub, fontSize: 13, fontWeight: "600", textAlign: "center" },
  cantidadPorcionRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  cantidadBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" },
  cantidadBtnText: { color: "#fff", fontSize: 24, fontWeight: "300", lineHeight: 28 },
  cantidadNumWrap: { alignItems: "center", minWidth: 80 },
  cantidadNum: { color: c.text, fontSize: 36, fontWeight: "900" },
  cantidadNumSub: { color: c.textMuted, fontSize: 11, marginTop: 2 },
  cantidadResumen: { alignItems: "center", gap: 4 },
  cantidadResumenText: { color: c.textSub, fontSize: 13 },
  porcionItemGramos: { color: c.textMuted, fontSize: 11 },
  porcionItemGramosActive: { color: "#58A6FF" },
  porcionChip: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 10, alignItems: "center", gap: 2 },
  porcionChipActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
  porcionChipLabel: { color: c.textMuted, fontSize: 11, fontWeight: "600" },
  porcionChipLabelActive: { color: "#58A6FF" },
  porcionChipG: { color: c.textMuted, fontSize: 12, fontWeight: "700" },
  envaseClose: { color: c.textMuted, fontSize: 12, textAlign: "center" },
  macrosGrid: { flexDirection: "row", gap: 8 },
  macroBox: { flex: 1, backgroundColor: c.bg, borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1 },
  macroBoxVal: { fontSize: 16, fontWeight: "800" },
  macroBoxValSm: { fontSize: 13 },
  macroBoxLabel: { color: c.textMuted, fontSize: 9, marginTop: 2, textAlign: "center" },
  mealSelectorTitle: { color: c.textSub, fontSize: 13, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" },
  mealSelector: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mealChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder },
  mealChipActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
  mealChipIcon: { fontSize: 14 },
  mealChipText: { color: c.textMuted, fontSize: 13, fontWeight: "600" },
  mealChipTextActive: { color: "#58A6FF" },
  saveBtn: { backgroundColor: "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center" },
  saveBtnDone: { backgroundColor: "#166534" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
}); }
