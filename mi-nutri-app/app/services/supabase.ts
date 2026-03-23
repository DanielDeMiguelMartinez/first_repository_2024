import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const SUPABASE_URL = "https://ncgkmfoftvudowmfjasj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZ2ttZm9mdHZ1ZG93bWZqYXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3Njc1ODUsImV4cCI6MjA4OTM0MzU4NX0.SpKfkviJWaSCS0XuTRZcJ3BiyqALbHzEjsPDgmE3xk0";

const getStorage = () => {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      return localStorage;
    }
    return undefined;
  }
  const { default: AsyncStorage } = require("@react-native-async-storage/async-storage");
  return AsyncStorage;
};

// Singleton para evitar múltiples instancias del cliente
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: getStorage(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // En web: usamos navigator.locks para coordinar el refresco de token entre
      // pestañas (evita que dos pestañas consuman el mismo refresh token).
      // Añadimos un timeout de 10 s para evitar cuelgues en producción (Vercel).
      // Si navigator.locks no está disponible, fallback a ejecución directa.
      ...(Platform.OS === "web" && {
        lock: (_name: string, _acquireTimeout: number, fn: () => Promise<any>): Promise<any> => {
          if (typeof navigator !== "undefined" && navigator.locks) {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 10_000);
            return navigator.locks
              .request(_name, { signal: controller.signal }, fn)
              .finally(() => clearTimeout(t))
              .catch((e: any) => {
                // Si el lock se canceló por timeout, ejecutamos directamente
                if (e?.name === "AbortError") return fn();
                throw e;
              });
          }
          return fn();
        },
      }),
    },
  });

  return _supabase;
}

export const supabase = getSupabase();

export type Porcion = {
  nombre: string;
  gramos: number;
};

export type AlimentoPersonalizado = {
  id?: string;
  nombre: string;
  marca: string;
  supermercado: string;
  calorias: number;
  proteinas: number;
  grasas: number;
  grasas_saturadas: number;
  carbohidratos: number;
  azucares: number;
  fibra: number;
  sal: number;
  peso_envase?: number;
  codigo_barras?: string;
  es_compartido?: boolean;
  porciones?: Porcion[];
};

export type Receta = {
  id?: string;
  nombre: string;
  descripcion: string;
  ingredientes: IngredienteReceta[];
  calorias_total: number;
  proteinas_total: number;
  grasas_total: number;
  carbohidratos_total: number;
};

export type IngredienteReceta = {
  nombre: string;
  gramos: number;
  calorias: number;
  proteinas: number;
  carbs: number;
  grasas: number;
};

export async function buscarAlimentosPersonalizados(nombre: string): Promise<AlimentoPersonalizado[]> {
  if (!nombre?.trim()) return [];
  try {
    const { data, error } = await supabase
      .from("alimentos_personalizados")
      .select("*")
      .ilike("nombre", `%${nombre}%`)
      .limit(20);
    if (error) return [];
    return data || [];
  } catch { return []; }
}

export async function buscarAlimentoPorCodigo(codigo: string): Promise<AlimentoPersonalizado | null> {
  if (!codigo?.trim()) return null;
  try {
    const { data, error } = await supabase
      .from("alimentos_personalizados")
      .select("*")
      .eq("codigo_barras", codigo.trim())
      .limit(1)
      .single();
    if (error || !data) return null;
    return data;
  } catch { return null; }
}

export async function guardarProductoEscaneado(alimento: AlimentoPersonalizado): Promise<boolean> {
  if (!alimento.codigo_barras?.trim()) return false;
  try {
    const existe = await buscarAlimentoPorCodigo(alimento.codigo_barras);
    if (existe) return true;
    const { error } = await supabase
      .from("alimentos_personalizados")
      .insert([{ ...alimento, es_compartido: true }]);
    return !error;
  } catch { return false; }
}

export async function crearAlimentoPersonalizado(alimento: AlimentoPersonalizado): Promise<boolean> {
  const { error } = await supabase
    .from("alimentos_personalizados")
    .insert([{ ...alimento, es_compartido: false }]);
  return !error;
}

export async function obtenerRecetas(): Promise<Receta[]> {
  const { data: ses } = await supabase.auth.getSession();
  const uid = ses.session?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("recetas")
    .select("*")
    .eq("user_id", uid)
    .order("creado_en", { ascending: false })
    .limit(100);
  if (error) return [];
  return data || [];
}

export async function crearReceta(receta: Receta): Promise<boolean> {
  const { data: ses } = await supabase.auth.getSession();
  const uid = ses.session?.user?.id;
  const { error } = await supabase
    .from("recetas")
    .insert([{ ...receta, user_id: uid }]);
  return !error;
}

export async function eliminarReceta(id: string): Promise<boolean> {
  // Aseguramos que la sesión esté activa antes de borrar
  await supabase.auth.getSession();
  const { error, count } = await supabase
    .from("recetas")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) {
    console.error("[eliminarReceta] error:", error.message, "code:", error.code);
    return false;
  }
  // count === 0 significa que la política RLS impidió el borrado (sin error explícito)
  if (count === 0) {
    console.warn("[eliminarReceta] 0 filas borradas — posible política RLS que bloquea el DELETE.");
    return false;
  }
  return true;
}

export async function eliminarPublicacion(id: string): Promise<boolean> {
  await supabase.auth.getSession();
  const { error, count } = await supabase
    .from("publicaciones_recetas")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) {
    console.error("[eliminarPublicacion] error:", error.message, "code:", error.code);
    return false;
  }
  if (count === 0) {
    console.warn("[eliminarPublicacion] 0 filas borradas — falta política DELETE en Supabase.");
    return false;
  }
  return true;
}