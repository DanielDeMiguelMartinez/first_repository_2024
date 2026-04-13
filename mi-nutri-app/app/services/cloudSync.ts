/**
 * cloudSync.ts — Sincronización cloud de datos de usuario
 *
 * Estrategia: local-first (escribe en AsyncStorage inmediatamente, luego
 * sincroniza con Supabase en background). Al cargar, muestra datos locales
 * al instante y actualiza con los datos cloud cuando llegan.
 *
 * Tablas Supabase necesarias (ejecutar en el SQL Editor de Supabase):
 * ─────────────────────────────────────────────────────────────────────
 * -- Registro diario de comidas (snapshot completo por día)
 * CREATE TABLE IF NOT EXISTS registros_diarios (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   fecha text NOT NULL,
 *   comidas jsonb NOT NULL DEFAULT '{"desayuno":[],"comida":[],"merienda":[],"cena":[]}',
 *   actualizado_en timestamptz DEFAULT now(),
 *   UNIQUE(user_id, fecha)
 * );
 * ALTER TABLE registros_diarios ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "registros_diarios_policy" ON registros_diarios
 *   FOR ALL USING (auth.uid() = user_id);
 *
 * -- Agua diaria
 * CREATE TABLE IF NOT EXISTS agua_diaria (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   fecha text NOT NULL,
 *   vasos integer NOT NULL DEFAULT 0,
 *   actualizado_en timestamptz DEFAULT now(),
 *   UNIQUE(user_id, fecha)
 * );
 * ALTER TABLE agua_diaria ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "agua_diaria_policy" ON agua_diaria
 *   FOR ALL USING (auth.uid() = user_id);
 *
 * -- Recetas guardadas de comunidad
 * CREATE TABLE IF NOT EXISTS recetas_guardadas (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   pub_id text NOT NULL,
 *   datos jsonb NOT NULL,
 *   guardado_en timestamptz DEFAULT now(),
 *   UNIQUE(user_id, pub_id)
 * );
 * ALTER TABLE recetas_guardadas ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "recetas_guardadas_policy" ON recetas_guardadas
 *   FOR ALL USING (auth.uid() = user_id);
 * ─────────────────────────────────────────────────────────────────────
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { enqueue } from "./offlineQueue";

const MIGRATION_KEY = "nutri_cloud_migration_v2";

// ────────────────────────────────────────────────────────────
// Comidas del día
// ────────────────────────────────────────────────────────────

/** Sincroniza el snapshot completo de un día con Supabase (no bloquea). Si falla, encola. */
export function syncDayToCloud(dateKey: string, meals: any): void {
  (async () => {
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id;
      if (!uid) return;
      const fecha = dateKey.replace("nutri_meals_", "");
      const { error } = await supabase.from("registros_diarios").upsert(
        { user_id: uid, fecha, comidas: meals, actualizado_en: new Date().toISOString() },
        { onConflict: "user_id,fecha" }
      );
      if (error) throw error;
    } catch {
      // Offline o error → encolar para retry
      enqueue({ type: "sync_day", data: { dateKey, meals } });
    }
  })();
}

/**
 * Carga las comidas de un día desde Supabase.
 * Intenta primero el snapshot completo (registros_diarios),
 * luego las filas individuales (comidas) para retrocompatibilidad.
 * Devuelve null si no hay datos en cloud.
 */
export async function loadDayFromCloud(dateKey: string): Promise<{ comidas: any; cloudTs: number } | null> {
  try {
    const { data: ses } = await supabase.auth.getSession();
    const uid = ses.session?.user?.id;
    if (!uid) return null;
    const fecha = dateKey.replace("nutri_meals_", "");

    // 1. Snapshot completo
    const { data: reg } = await supabase
      .from("registros_diarios")
      .select("comidas, actualizado_en")
      .eq("user_id", uid)
      .eq("fecha", fecha)
      .maybeSingle();
    if (reg?.comidas) {
      const cloudTs = reg.actualizado_en ? new Date(reg.actualizado_en).getTime() : 0;
      return { comidas: reg.comidas, cloudTs };
    }

    // 2. Retrocompat: filas individuales de la tabla comidas
    const { data: filas } = await supabase
      .from("comidas")
      .select("meal_type, food_data")
      .eq("user_id", uid)
      .eq("fecha", fecha);
    if (!filas || filas.length === 0) return null;
    const meals: any = { desayuno: [], snack1: [], comida: [], merienda: [], cena: [], snack2: [] };
    for (const fila of filas) {
      if (meals[fila.meal_type]) meals[fila.meal_type].push(fila.food_data);
    }
    return { comidas: meals, cloudTs: 0 };
  } catch { return null; }
}

// ────────────────────────────────────────────────────────────
// Objetivos nutricionales
// ────────────────────────────────────────────────────────────

/** Guarda los objetivos en la columna de perfiles (no bloquea). */
export function syncGoalsToCloud(goals: { calories: number; protein: number; carbs: number; fat: number }): void {
  (async () => {
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id;
      if (!uid) return;
      await supabase.from("perfiles").update({
        calorias_objetivo: goals.calories,
        proteina_objetivo: goals.protein,
        carbos_objetivo: goals.carbs,
        grasa_objetivo: goals.fat,
      }).eq("id", uid);
    } catch {}
  })();
}

/** Lee los objetivos desde perfiles. Devuelve null si no hay datos. */
export async function loadGoalsFromCloud(): Promise<{ calories: number; protein: number; carbs: number; fat: number } | null> {
  try {
    const { data: ses } = await supabase.auth.getSession();
    const uid = ses.session?.user?.id;
    if (!uid) return null;
    const { data } = await supabase
      .from("perfiles")
      .select("calorias_objetivo, proteina_objetivo, carbos_objetivo, grasa_objetivo")
      .eq("id", uid)
      .single();
    if (!data?.calorias_objetivo) return null;
    return {
      calories: data.calorias_objetivo,
      protein: data.proteina_objetivo ?? 150,
      carbs: data.carbos_objetivo ?? 250,
      fat: data.grasa_objetivo ?? 65,
    };
  } catch { return null; }
}

// ────────────────────────────────────────────────────────────
// Agua
// ────────────────────────────────────────────────────────────

/** Sincroniza el contador de agua de un día (no bloquea). */
export function syncWaterToCloud(fecha: string, vasos: number): void {
  (async () => {
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id;
      if (!uid) return;
      await supabase.from("agua_diaria").upsert(
        { user_id: uid, fecha, vasos, actualizado_en: new Date().toISOString() },
        { onConflict: "user_id,fecha" }
      );
    } catch {}
  })();
}

/** Lee el contador de agua de un día. Devuelve null si no hay datos. */
export async function loadWaterFromCloud(fecha: string): Promise<number | null> {
  try {
    const { data: ses } = await supabase.auth.getSession();
    const uid = ses.session?.user?.id;
    if (!uid) return null;
    const { data } = await supabase
      .from("agua_diaria")
      .select("vasos")
      .eq("user_id", uid)
      .eq("fecha", fecha)
      .maybeSingle();
    return data != null ? data.vasos : null;
  } catch { return null; }
}

// ────────────────────────────────────────────────────────────
// Recetas guardadas
// ────────────────────────────────────────────────────────────

/** Carga todas las recetas guardadas desde Supabase. */
export async function loadRecetasGuardadasFromCloud(): Promise<any[] | null> {
  try {
    const { data: ses } = await supabase.auth.getSession();
    const uid = ses.session?.user?.id;
    if (!uid) return null;
    const { data } = await supabase
      .from("recetas_guardadas")
      .select("datos")
      .eq("user_id", uid)
      .order("guardado_en", { ascending: false });
    if (!data) return null;
    return data.map((r: any) => r.datos);
  } catch { return null; }
}

/** Guarda una receta en Supabase (no bloquea). */
export function guardarRecetaEnCloud(pub_id: string, datos: any): void {
  (async () => {
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id;
      if (!uid) return;
      await supabase.from("recetas_guardadas").upsert(
        { user_id: uid, pub_id, datos, guardado_en: new Date().toISOString() },
        { onConflict: "user_id,pub_id" }
      );
    } catch {}
  })();
}

/** Elimina una receta guardada de Supabase (no bloquea). */
export function quitarRecetaDeCloud(pub_id: string): void {
  (async () => {
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id;
      if (!uid) return;
      await supabase.from("recetas_guardadas").delete().eq("user_id", uid).eq("pub_id", pub_id);
    } catch {}
  })();
}

// ────────────────────────────────────────────────────────────
// Migración única (datos locales → cloud)
// ────────────────────────────────────────────────────────────

/**
 * Sube todos los datos locales a Supabase la primera vez.
 * Se ejecuta en background sin bloquear la UI.
 */
export function migrateLocalToCloud(): void {
  (async () => {
    try {
      const done = await AsyncStorage.getItem(MIGRATION_KEY);
      if (done) return;
      const { data: ses } = await supabase.auth.getSession();
      if (!ses.session?.user?.id) return;

      const allKeys: string[] = await AsyncStorage.getAllKeys() as string[];

      // Comidas
      const mealKeys = allKeys.filter(k => k.startsWith("nutri_meals_"));
      for (const key of mealKeys) {
        const raw = await AsyncStorage.getItem(key);
        if (raw) { try { syncDayToCloud(key, JSON.parse(raw)); } catch {} }
      }

      // Objetivos
      const goalsRaw = await AsyncStorage.getItem("nutri_daily_goals");
      if (goalsRaw) { try { syncGoalsToCloud(JSON.parse(goalsRaw)); } catch {} }

      // Agua
      const waterKeys = allKeys.filter(k => k.startsWith("nutri_water_"));
      for (const key of waterKeys) {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const fecha = key.replace("nutri_water_", "");
          syncWaterToCloud(fecha, parseInt(raw, 10));
        }
      }

      // Recetas guardadas
      const recetasRaw = await AsyncStorage.getItem("nutri_recetas_guardadas");
      if (recetasRaw) {
        const lista = JSON.parse(recetasRaw);
        for (const r of lista) {
          if (r.pub_id) guardarRecetaEnCloud(r.pub_id, r);
        }
      }

      await AsyncStorage.setItem(MIGRATION_KEY, "1");
    } catch {} // Silencioso — reintentará en la próxima sesión
  })();
}
