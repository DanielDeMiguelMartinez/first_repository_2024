/**
 * offlineQueue.ts — Cola de operaciones pendientes para sincronizar cuando hay internet
 *
 * Cuando el usuario está offline, las operaciones de cloud sync se encolan.
 * Al recuperar conexión, se procesan automáticamente.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabase";

const QUEUE_KEY = "nutri_offline_queue";

type QueueItem = {
  id: string;
  type: "sync_day" | "sync_water" | "sync_goals" | "insert" | "upsert";
  table?: string;
  data: any;
  timestamp: number;
};

let _queue: QueueItem[] = [];
let _processing = false;

/** Cargar cola al iniciar la app */
export async function loadQueue(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    _queue = raw ? JSON.parse(raw) : [];
  } catch { _queue = []; }
}

/** Guardar cola en storage */
async function saveQueue(): Promise<void> {
  try { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(_queue)); } catch {}
}

/** Añadir operación a la cola */
export async function enqueue(item: Omit<QueueItem, "id" | "timestamp">): Promise<void> {
  _queue.push({
    ...item,
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
  });
  // Limitar cola a 200 items
  if (_queue.length > 200) _queue = _queue.slice(-200);
  await saveQueue();
}

/** Procesar toda la cola */
export async function processQueue(): Promise<number> {
  if (_processing || _queue.length === 0) return 0;
  _processing = true;
  let processed = 0;

  try {
    const { data: ses } = await supabase.auth.getSession();
    const uid = ses.session?.user?.id;
    if (!uid) { _processing = false; return 0; }

    const toProcess = [..._queue];
    const failed: QueueItem[] = [];

    for (const item of toProcess) {
      try {
        if (item.type === "sync_day") {
          const { dateKey, meals } = item.data;
          const fecha = dateKey.replace("nutri_meals_", "");
          await supabase.from("registros_diarios").upsert(
            { user_id: uid, fecha, comidas: meals, actualizado_en: new Date(item.timestamp).toISOString() },
            { onConflict: "user_id,fecha" }
          );
        } else if (item.type === "sync_water") {
          const { dateKey, vasos } = item.data;
          const fecha = dateKey.replace("nutri_water_", "");
          await supabase.from("agua_diaria").upsert(
            { user_id: uid, fecha, vasos, actualizado_en: new Date(item.timestamp).toISOString() },
            { onConflict: "user_id,fecha" }
          );
        } else if (item.type === "sync_goals") {
          const goals = item.data;
          await supabase.from("perfiles").update({
            calorias_objetivo: goals.calories,
            proteina_objetivo: goals.protein,
            carbos_objetivo: goals.carbs,
            grasa_objetivo: goals.fat,
          }).eq("id", uid);
        } else if (item.type === "insert" && item.table) {
          await supabase.from(item.table).insert([item.data]);
        } else if (item.type === "upsert" && item.table) {
          await supabase.from(item.table).upsert([item.data]);
        }
        processed++;
      } catch {
        // Si falla, mantener en cola para reintentar
        if (Date.now() - item.timestamp < 7 * 24 * 60 * 60 * 1000) { // max 7 días
          failed.push(item);
        }
      }
    }

    _queue = failed;
    await saveQueue();
  } catch {}

  _processing = false;
  return processed;
}

/** Número de items pendientes */
export function queueSize(): number { return _queue.length; }

/** Escuchar cambios de conexión y procesar cola automáticamente */
export function startAutoSync(): void {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.addEventListener("online", () => { processQueue(); });
    // Intentar cada 30s por si acaso
    setInterval(() => {
      if (navigator.onLine && _queue.length > 0) processQueue();
    }, 30000);
  }
}
