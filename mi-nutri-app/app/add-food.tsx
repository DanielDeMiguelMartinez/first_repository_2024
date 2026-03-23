import { calcularMacros, Nutrientes } from "@/app/services/calcularMacros";
import { useApp } from "@/app/services/i18n";
import { buscarDesdeEscaneo, buscarProductosPorNombre } from "@/app/services/openFoodFacts";
import { signalMealSaved } from "@/app/services/refreshSignal";
import { buscarAlimentosPersonalizados, supabase } from "@/app/services/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, Keyboard, PanResponder, Platform,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";

const nativeDriver = Platform.OS !== "web";

function getTodayKey(): string {
  const d = new Date();
  return `nutri_meals_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const STORAGE_KEY = getTodayKey();
const RECENT_FOODS_KEY = "nutri_recent_foods_v2";
const FAVORITES_KEY = "nutri_favorites";
const SEARCH_CACHE_KEY = "nutri_search_cache_v1";
const CACHE_TTL = 1000 * 60 * 60 * 6;

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
  esPersonalizado?: boolean;
  porciones?: Porcion[];
};

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
];

async function getCached(query: string): Promise<Producto[] | null> {
  try {
    const raw = await AsyncStorage.getItem(`${SEARCH_CACHE_KEY}_${query}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

async function setCached(query: string, productos: Producto[]) {
  try {
    await AsyncStorage.setItem(
      `${SEARCH_CACHE_KEY}_${query}`,
      JSON.stringify({ data: productos, ts: Date.now() })
    );
  } catch {}
}

function buscarEnLocal(texto: string): Producto[] {
  const q = texto.toLowerCase();
  return ALIMENTOS_BASICOS.filter((a) => a.nombre.toLowerCase().includes(q));
}

async function registrarEnHistorial(prod: Producto): Promise<RecentFood[]> {
  try {
    const stored = await AsyncStorage.getItem(RECENT_FOODS_KEY);
    const lista: RecentFood[] = stored ? JSON.parse(stored) : [];
    const nueva: RecentFood = { ...prod, addedAt: Date.now() };
    const filtrada = lista.filter((f) => f.nombre.toLowerCase() !== prod.nombre.toLowerCase());
    const actualizada = [nueva, ...filtrada].slice(0, 50);
    await AsyncStorage.setItem(RECENT_FOODS_KEY, JSON.stringify(actualizada));
    return actualizada;
  } catch { return []; }
}

async function cargarFavoritosStorage(): Promise<FavoriteFood[]> {
  try {
    const stored = await AsyncStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

async function toggleFavoritoStorage(prod: Producto): Promise<FavoriteFood[]> {
  const lista = await cargarFavoritosStorage();
  const existe = lista.find((f) => f.nombre.toLowerCase() === prod.nombre.toLowerCase());
  let nueva: FavoriteFood[];
  if (existe) {
    nueva = lista.filter((f) => f.nombre.toLowerCase() !== prod.nombre.toLowerCase());
  } else {
    nueva = [{ ...prod, savedAt: Date.now() }, ...lista];
  }
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(nueva));
  return nueva;
}

function safeNutriente(val: any): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function normalizarProducto(prod: any): Producto {
  if (!prod) {
    return {
      nombre: "", marca: "Sin marca", supermercado: "Desconocido", esPersonalizado: false,
      nutrientes: { calorias: 0, proteinas: 0, grasas: 0, grasasSaturadas: 0, carbohidratos: 0, azucares: 0, fibra: 0, sal: 0 },
    };
  }
  if (prod.nutrientes && typeof prod.nutrientes === "object") {
    return {
      ...prod,
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
  return {
    nombre: prod.nombre ?? "",
    marca: prod.marca ?? "Sin marca",
    supermercado: prod.supermercado ?? "Desconocido",
    esPersonalizado: prod.esPersonalizado ?? false,
    pesoEnvase: prod.pesoEnvase ?? prod.peso_envase,
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

function SwipeableFoodItem({
  prod: prodRaw, isFav, onSelect, onToggleFav, colors: c,
}: {
  prod: Producto; isFav: boolean;
  onSelect: () => void; onToggleFav: () => void; colors: any;
}) {
  const prod = normalizarProducto(prodRaw);
  const sw = makeSwStyles(c);
  const translateX = useRef(new Animated.Value(0)).current;
  const [swiped, setSwiped] = useState(false);
  const sc = SUPER_COLORS[prod.supermercado] || "#4B5563";

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dy) < 20,
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) translateX.setValue(Math.max(g.dx, -80));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -40) {
          Animated.spring(translateX, { toValue: -72, useNativeDriver: nativeDriver }).start();
          setSwiped(true);
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: nativeDriver }).start();
          setSwiped(false);
        }
      },
    })
  ).current;

  const resetSwipe = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: nativeDriver }).start();
    setSwiped(false);
  };

  return (
    <View style={sw.wrap}>
      <View style={[sw.favBg, isFav && sw.favBgActive]}>
        <TouchableOpacity style={sw.favBgBtn} onPress={() => { onToggleFav(); resetSwipe(); }}>
          <Text style={sw.favBgIcon}>{isFav ? "★" : "☆"}</Text>
          <Text style={sw.favBgText}>{isFav ? "Quitar" : "Guardar"}</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={[sw.item, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <TouchableOpacity style={sw.itemInner} onPress={() => { resetSwipe(); onSelect(); }} activeOpacity={0.7}>
          <View style={sw.left}>
            <View style={sw.nameRow}>
              <Text style={sw.name} numberOfLines={1}>{prod.nombre}</Text>
              {prod.esPersonalizado && <View style={sw.customBadge}><Text style={sw.customBadgeText}>✦ propio</Text></View>}
            </View>
            <View style={sw.meta}>
              <View style={[sw.superBadge, { backgroundColor: sc + "22", borderColor: sc + "55" }]}>
                <Text style={[sw.superBadgeText, { color: sc }]}>{prod.supermercado}</Text>
              </View>
              {prod.marca !== "Natural" && prod.marca !== "Sin marca" && <Text style={sw.marca}>{prod.marca}</Text>}
            </View>
            <Text style={sw.macros}>
              P {prod.nutrientes.proteinas.toFixed(1)}g · C {prod.nutrientes.carbohidratos.toFixed(1)}g · G {prod.nutrientes.grasas.toFixed(1)}g
            </Text>
          </View>
          <View style={sw.right}>
            <Text style={sw.kcal}>{prod.nutrientes.calorias.toFixed(0)}</Text>
            <Text style={sw.kcalUnit}>kcal/100g</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={sw.starBtn} onPress={() => { resetSwipe(); onToggleFav(); }}>
          <Text style={[sw.starIcon, isFav && sw.starIconActive]}>{isFav ? "★" : "☆"}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function AddFoodScreen() {
  const { colors, theme } = useApp();
  const s = makeSStyles(colors);
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
  const [porcionSeleccionada, setPorcionSeleccionada] = useState<number | null>(null);
  const [cantidadPorciones, setCantidadPorciones] = useState(1);
  const [mealSeleccionada, setMealSeleccionada] = useState<MealKey>((mealParam as MealKey) || "desayuno");
  const [cargando, setCargando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recentFoods, setRecentFoods] = useState<RecentFood[]>([]);
  const [favorites, setFavorites] = useState<FavoriteFood[]>([]);
  const [pesoEnvase, setPesoEnvase] = useState("");
  const [mostrarEnvaseManual, setMostrarEnvaseManual] = useState(false);
  // ── VOZ ──────────────────────────────────────────────────────────────────
  const [escuchando, setEscuchando] = useState(false);
  const [codigoNoEncontrado, setCodigoNoEncontrado] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Record<string, Producto[]>>({});
  const currentSearch = useRef("");
  // Keeps the SpeechRecognition instance alive — Chrome Android GC's local vars before events fire
  const recognitionRef   = useRef<any>(null);
  // MediaRecorder para el fallback Firefox
  const mediaRecorderRef = useRef<any>(null);

  useEffect(() => { cargarDatos(); }, []);
  useEffect(() => {
    if (code) { setTab("codigo"); setCodigo(code); cargarPorCodigo(code); }
  }, [code]);

  const cargarDatos = async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_FOODS_KEY);
      if (stored) setRecentFoods(JSON.parse(stored));
    } catch {}
    const favs = await cargarFavoritosStorage();
    setFavorites(favs);
  };

  const isFav = (nombre: string) =>
    favorites.some((f) => f.nombre.toLowerCase() === nombre.toLowerCase());

  const handleToggleFav = async (prod: Producto) => {
    const nueva = await toggleFavoritoStorage(prod);
    setFavorites(nueva);
  };

  const resetEnvase = () => { setMostrarEnvaseManual(false); setPesoEnvase(""); };
  const resetPorcion = () => { setPorcionSeleccionada(null); setCantidadPorciones(1); };

  const macros = producto ? calcularMacros(producto.nutrientes, Number(gramos) || 0) : null;
  const caloriasCalculadas = macros ? macros.calorias.toFixed(0) : "0";
  const superColor = producto ? (SUPER_COLORS[producto.supermercado] || "#4B5563") : "#4B5563";

  const buscarConDebounce = (texto: string) => {
    setBusqueda(texto);
    setProducto(null);
    currentSearch.current = texto;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!texto.trim()) { setResultados([]); setCargando(false); return; }

    const locales = buscarEnLocal(texto);
    setResultados(locales);
    setCargando(true);

    if (cacheRef.current[texto]) {
      setResultados(cacheRef.current[texto]);
      setCargando(false);
      return;
    }

    getCached(texto).then((cached) => {
      if (cached && currentSearch.current === texto) {
        cacheRef.current[texto] = cached;
        setResultados(cached);
        setCargando(false);
      }
    });

    let personalizadosRef: Producto[] = [];

    buscarAlimentosPersonalizados(texto).then((personalizados) => {
      if (currentSearch.current !== texto) return;
      personalizadosRef = personalizados.map((p) => normalizarProducto(p));
      if (personalizadosRef.length > 0) {
        setResultados((prev) => {
          const nuevos = personalizadosRef.filter(
            (c) => !prev.some((p) => p.nombre.toLowerCase() === c.nombre.toLowerCase())
          );
          return [...nuevos, ...prev];
        });
      }
    }).catch(() => {});

    debounceRef.current = setTimeout(async () => {
      if (currentSearch.current !== texto) return;
      try {
        const remotos = await buscarProductosPorNombre(texto);
        const localesFinal = buscarEnLocal(texto);
        const todos: Producto[] = [...personalizadosRef];
        for (const r of localesFinal) {
          if (!todos.some((t) => t.nombre.toLowerCase() === r.nombre.toLowerCase()))
            todos.push(r);
        }
        for (const r of remotos) {
          if (!todos.some((t) => t.nombre.toLowerCase() === r.nombre.toLowerCase()))
            todos.push(r);
        }
        cacheRef.current[texto] = todos;
        setCached(texto, todos);
        if (currentSearch.current === texto) setResultados(todos);
      } catch {}
      finally {
        if (currentSearch.current === texto) setCargando(false);
      }
    }, 150);
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
          Alert.alert("🎤 Voz no disponible", "Tu navegador no soporta micrófono. Prueba Chrome, Edge o Safari.");
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
                  Alert.alert("🎤 Voz no configurada", "El servidor no tiene clave de transcripción. Usa Chrome o Edge para la búsqueda por voz.");
                } else if (json.error) {
                  Alert.alert("Error de voz", "No se pudo transcribir el audio. Inténtalo de nuevo.");
                }
              } catch {
                Alert.alert("Error de voz", "Sin conexión. Comprueba tu red e inténtalo de nuevo.");
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
              Alert.alert("🎤 Micrófono bloqueado", "Permite el acceso al micrófono en la barra de tu navegador.");
            } else {
              Alert.alert("Error", "No se pudo acceder al micrófono.");
            }
          });
        return;
      }

      // ── Mensaje de instrucciones si el permiso está denegado ──────────────
      const instruccionesPermiso =
        "Para activarlo:\n\n" +
        "• Toca 🔒 en la barra de URL\n" +
        "• Permisos del sitio → Micrófono → Permitir\n" +
        "• Recarga la página\n\n" +
        "Si el candado no aparece:\n" +
        "Chrome ⋮ → Configuración → Privacidad → Permisos del sitio → Micrófono";

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
              Alert.alert("🎤 Micrófono bloqueado", instruccionesPermiso, [{ text: "Entendido" }]);
              break;
            case "network":
              Alert.alert("Sin conexión", "El reconocimiento de voz necesita internet.");
              break;
            case "audio-capture":
              Alert.alert("Sin micrófono", "No se detectó micrófono en el dispositivo.");
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
              Alert.alert("Error de voz", `Error: ${e.error}. Recarga e inténtalo de nuevo.`);
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
            Alert.alert("🎤 Micrófono bloqueado", instruccionesPermiso, [{ text: "Entendido" }]);
          } else if (name === "InvalidStateError") {
            // ya había un reconocimiento activo — ignorar
          } else {
            Alert.alert("Error de voz", err?.message ?? "No se pudo iniciar el micrófono. Recarga la página e inténtalo de nuevo.");
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
          Alert.alert("Permiso denegado", "Activa el micrófono en Ajustes del dispositivo.");
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
        Alert.alert("Voz no disponible", "No se pudo iniciar el reconocimiento de voz.");
      }
    })();
  };

  const cargarPorCodigo = async (c: string) => {
    if (!c.trim()) return;
    setCargando(true);
    const prod = await buscarDesdeEscaneo(c);
    setCargando(false);
    if (prod) {
      const normalizado = normalizarProducto(prod);
      const updated = await registrarEnHistorial(normalizado);
      setRecentFoods(updated);
      setProducto(normalizado);
      setResultados([]);
      setGuardado(false);
      resetEnvase();
      resetPorcion();
    } else {
      setCodigoNoEncontrado(c);
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
  };

  // ── guardarAlimento ───────────────────────────────────────────────────────
  const guardarAlimento = async () => {
    setSaveError(null);
    if (!producto) { setSaveError("Sin producto seleccionado."); return; }
    if (!macros)   { setSaveError("Sin macros calculados."); return; }

    const targetKey = storageKeyParam || STORAGE_KEY;
    const fechaStr  = targetKey.replace("nutri_meals_", "");

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
      porciones: producto.porciones && producto.porciones.length > 0
        ? producto.porciones : undefined,
    };

    try {
      // 1. Guardar en AsyncStorage
      const stored = await AsyncStorage.getItem(targetKey);
      const base = { desayuno: [] as any[], comida: [] as any[], merienda: [] as any[], cena: [] as any[] };
      const meals = stored ? { ...base, ...JSON.parse(stored) } : base;
      meals[mealSeleccionada] = [...(meals[mealSeleccionada] ?? []), entradaComida];
      await AsyncStorage.setItem(targetKey, JSON.stringify(meals));

      // 2. Supabase en background (no bloquea si falla)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          supabase.from("comidas").insert({
            user_id: session.user.id,
            fecha: fechaStr,
            meal_type: mealSeleccionada,
            food_data: entradaComida,
          });
        }
      }).catch(() => {});

      // Señal síncrona a index con el objeto de meals ya guardado
      signalMealSaved(meals, targetKey);

      setGuardado(true);
      setTimeout(() => router.back(), 600);
    } catch (e: any) {
      setSaveError(e?.message ?? "No se pudo guardar. Inténtalo de nuevo.");
    }
  };

  const renderPorciones = (base: number) => (
    <View style={s.envasePorciones}>
      {[{ fraccion: 1, label: "Entero" }, { fraccion: 0.5, label: "½" }, { fraccion: 0.75, label: "¾" }, { fraccion: 0.25, label: "¼" }].map(({ fraccion, label }) => {
        const g = Math.round(base * fraccion);
        const activo = gramos === String(g);
        return (
          <TouchableOpacity key={fraccion} style={[s.porcionChip, activo && s.porcionChipActive]} onPress={() => { setGramos(String(g)); setGuardado(false); }}>
            <Text style={[s.porcionChipLabel, activo && s.porcionChipLabelActive]}>{label}</Text>
            <Text style={[s.porcionChipG, activo && s.porcionChipLabelActive]}>{g}g</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const listaHistorial = historialTab === "recientes" ? recentFoods : favorites;

  const renderHistorial = () => (
    <View style={s.historialWrap}>
      <View style={s.historialTabs}>
        <TouchableOpacity style={[s.historialTab, historialTab === "recientes" && s.historialTabActive]} onPress={() => setHistorialTab("recientes")}>
          <Text style={[s.historialTabText, historialTab === "recientes" && s.historialTabTextActive]}>⚡ Recientes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.historialTab, historialTab === "favoritos" && s.historialTabActive]} onPress={() => setHistorialTab("favoritos")}>
          <Text style={[s.historialTabText, historialTab === "favoritos" && s.historialTabTextActive]}>★ Favoritos</Text>
        </TouchableOpacity>
      </View>
      {listaHistorial.length > 0 && <Text style={s.swipeHint}>← Desliza para favoritar</Text>}
      {listaHistorial.length === 0 ? (
        <Text style={s.emptyHistory}>
          {historialTab === "recientes" ? "Aquí aparecerán los alimentos que busques" : "Pulsa ☆ o desliza ← en cualquier alimento para guardarlo"}
        </Text>
      ) : (
        listaHistorial.map((food, i) => (
          <SwipeableFoodItem key={i} prod={food} isFav={isFav(food.nombre)} onSelect={() => seleccionarProducto(food)} onToggleFav={() => handleToggleFav(food)} colors={colors} />
        ))
      )}
      {historialTab === "recientes" && recentFoods.length > 0 && (
        <TouchableOpacity onPress={async () => { setRecentFoods([]); await AsyncStorage.removeItem(RECENT_FOODS_KEY); }} style={s.clearAllBtn}>
          <Text style={s.clearAllBtnText}>Borrar recientes</Text>
        </TouchableOpacity>
      )}
      <View style={s.quickBtns}>
        <TouchableOpacity style={s.quickBtn} onPress={() => router.push("/create-food")}>
          <Text style={s.quickBtnText}>➕ ¿No encuentras lo que buscas? Créalo tú</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.quickBtn} onPress={() => router.push("/recetas")}>
          <Text style={s.quickBtnText}>🍳 Añadir desde recetas</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <ScrollView style={[s.scroll, { backgroundColor: colors.bg }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.backText}>← Volver</Text></TouchableOpacity>
          <Text style={s.title}>Añadir alimento</Text>
        </View>

        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, tab === "nombre" && s.tabActive]} onPress={() => { setTab("nombre"); setProducto(null); setResultados([]); setBusqueda(""); setCodigoNoEncontrado(null); }}>
            <Text style={[s.tabText, tab === "nombre" && s.tabTextActive]}>🔍 Por nombre</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === "codigo" && s.tabActive]} onPress={() => { setTab("codigo"); setProducto(null); setResultados([]); setCodigoNoEncontrado(null); }}>
            <Text style={[s.tabText, tab === "codigo" && s.tabTextActive]}>📷 Por código</Text>
          </TouchableOpacity>
        </View>

        {tab === "nombre" && !producto && (
          <View style={s.section}>
            <View style={s.searchBox}>
              <Text style={s.searchIcon}>🔍</Text>
              <TextInput style={s.searchInput} value={busqueda} onChangeText={buscarConDebounce} placeholder="Manzana, pollo, arroz..." placeholderTextColor={colors.textMuted} returnKeyType="search" autoCorrect={false} autoCapitalize="none" />
              {busqueda.length > 0 && (
                <TouchableOpacity onPress={() => { setBusqueda(""); setResultados([]); setCargando(false); currentSearch.current = ""; }}>
                  <Text style={s.clearBtn}>✕</Text>
                </TouchableOpacity>
              )}
              {/* ── Botón de voz ── */}
              <TouchableOpacity onPress={iniciarVoz} style={{ paddingHorizontal: 4 }}>
                <Text style={[s.clearBtn, escuchando && { color: "#F87171" }]}>
                  {escuchando ? "🔴" : "🎤"}
                </Text>
              </TouchableOpacity>
            </View>
            {busqueda.length === 0 && renderHistorial()}
            {busqueda.length > 0 && (
              <>
                {cargando && <View style={s.loadingRow}><ActivityIndicator color="#58A6FF" size="small" /><Text style={s.loadingText}>Buscando en tiendas...</Text></View>}
                {resultados.map((prod, i) => (
                  <SwipeableFoodItem key={i} prod={prod} isFav={isFav(prod.nombre)} onSelect={() => seleccionarProducto(prod)} onToggleFav={() => handleToggleFav(prod)} colors={colors} />
                ))}
                {!cargando && resultados.length === 0 && (
                  <View style={s.noResultsWrap}>
                    <Text style={s.emptyText}>Sin resultados para "{busqueda}"</Text>
                    <TouchableOpacity style={s.quickBtn} onPress={() => router.push("/create-food")}><Text style={s.quickBtnText}>➕ Crear este alimento</Text></TouchableOpacity>
                    <TouchableOpacity style={s.quickBtn} onPress={() => router.push("/recetas")}><Text style={s.quickBtnText}>🍳 Añadir desde recetas</Text></TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {tab === "codigo" && !producto && (
          <View style={s.section}>
            <View style={s.searchRow}>
              <TextInput style={s.searchInputCodigo} value={codigo} onChangeText={setCodigo} placeholder="Introduce el código de barras" placeholderTextColor={colors.textMuted} keyboardType="numeric" returnKeyType="search" onSubmitEditing={() => cargarPorCodigo(codigo)} />
              <TouchableOpacity style={s.searchBtn} onPress={() => cargarPorCodigo(codigo)}><Text style={s.searchBtnText}>Buscar</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={s.scanBtn} onPress={() => router.push("/scanner")}><Text style={s.scanBtnText}>📷 Escanear con cámara</Text></TouchableOpacity>
            {cargando && <ActivityIndicator color="#58A6FF" style={{ marginTop: 20 }} />}
            {codigoNoEncontrado && !cargando && (
              <View style={s.notFoundBanner}>
                <Text style={s.notFoundTitle}>Código no encontrado</Text>
                <Text style={s.notFoundSub}>{codigoNoEncontrado}</Text>
                <View style={s.notFoundBtns}>
                  <TouchableOpacity style={s.notFoundBtn} onPress={() => { setCodigoNoEncontrado(null); router.back(); }}>
                    <Text style={s.notFoundBtnText}>← Volver</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.notFoundBtn, s.notFoundBtnPrimary]} onPress={() => router.push({ pathname: "/create-food", params: { scannedCode: codigoNoEncontrado } })}>
                    <Text style={[s.notFoundBtnText, s.notFoundBtnPrimaryText]}>➕ Añadir nuevo alimento</Text>
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
                  {producto.esPersonalizado && <View style={s.customBadge}><Text style={s.customBadgeText}>✦ propio</Text></View>}
                </View>
                <TouchableOpacity style={s.productFavBtn} onPress={() => handleToggleFav(producto)}>
                  <Text style={[s.productFavIcon, isFav(producto.nombre) && s.productFavIconActive]}>{isFav(producto.nombre) ? "★" : "☆"}</Text>
                </TouchableOpacity>
              </View>
              <View style={s.productMeta}>
                <View style={[s.superBadgeLg, { backgroundColor: superColor + "22", borderColor: superColor + "55" }]}><Text style={[s.superBadgeLgText, { color: superColor }]}>{producto.supermercado}</Text></View>
                {producto.marca !== "Natural" && producto.marca !== "Sin marca" && <Text style={s.productMarca}>{producto.marca}</Text>}
              </View>
            </View>

            <View style={s.cantidadWrap}>
              <View style={s.gramosRow}>
                <Text style={s.gramosLabel}>Cantidad (g)</Text>
                <TextInput style={s.gramosInput} value={gramos} onChangeText={(v) => { setGramos(v.replace(",", ".")); setGuardado(false); }} keyboardType="decimal-pad" selectTextOnFocus />
              </View>
              {producto.pesoEnvase && !mostrarEnvaseManual && (
                <View style={s.envaseAutoWrap}>
                  <View style={s.envaseAutoHeader}>
                    <View><Text style={s.envaseAutoLabel}>📦 Peso del envase</Text><Text style={s.envaseAutoHint}>Según el fabricante</Text></View>
                    <View style={[s.superBadgeLg, { backgroundColor: superColor + "22", borderColor: superColor + "55" }]}><Text style={[s.superBadgeLgText, { color: superColor }]}>{producto.pesoEnvase}g</Text></View>
                  </View>
                  {renderPorciones(producto.pesoEnvase)}
                  <TouchableOpacity onPress={() => setMostrarEnvaseManual(true)}><Text style={s.envaseManualLink}>✏️ Cambiar peso manualmente</Text></TouchableOpacity>
                </View>
              )}
              {(!producto.pesoEnvase || mostrarEnvaseManual) && (
                <>
                  {!mostrarEnvaseManual ? (
                    <TouchableOpacity style={s.envaseBtn} onPress={() => setMostrarEnvaseManual(true)}><Text style={s.envaseBtnText}>📦 Usar peso del envase</Text></TouchableOpacity>
                  ) : (
                    <View style={s.envaseWrap}>
                      <View style={s.envaseRow}>
                        <View style={s.envaseLeft}><Text style={s.envaseLabel}>Peso del envase (g)</Text><Text style={s.envaseHint}>Ej: bolsa arroz 150g, lata 240g...</Text></View>
                        <TextInput style={s.envaseInput} value={pesoEnvase} onChangeText={setPesoEnvase} keyboardType="numeric" selectTextOnFocus placeholder="150" placeholderTextColor={colors.textMuted} />
                      </View>
                      {Number(pesoEnvase) > 0 && renderPorciones(Number(pesoEnvase))}
                      <TouchableOpacity onPress={resetEnvase}><Text style={s.envaseClose}>✕ Quitar envase</Text></TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </View>

            {producto.porciones && producto.porciones.length > 0 && (
              <View style={s.porcionesWrap}>
                <Text style={s.porcionesTitle}>🍽️ Porciones</Text>
                <View style={s.porcionesGrid}>
                  {producto.porciones.map((p, i) => {
                    const activo = porcionSeleccionada === i;
                    return (
                      <TouchableOpacity
                        key={i}
                        style={[s.porcionItemBtn, activo && s.porcionItemBtnActive]}
                        onPress={() => {
                          setPorcionSeleccionada(activo ? null : i);
                          setCantidadPorciones(1);
                          setGramos(activo ? "100" : String(p.gramos * 1));
                          setGuardado(false);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.porcionItemNombre, activo && s.porcionItemNombreActive]}>{p.nombre}</Text>
                        <Text style={[s.porcionItemGramos, activo && s.porcionItemGramosActive]}>{p.gramos}g c/u</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {porcionSeleccionada !== null && producto.porciones[porcionSeleccionada] && (() => {
                  const p = producto.porciones![porcionSeleccionada];
                  const totalGramos = p.gramos * cantidadPorciones;
                  const kcalPorcion = Math.round(producto.nutrientes.calorias * p.gramos / 100);
                  const kcalTotal = Math.round(producto.nutrientes.calorias * totalGramos / 100);
                  return (
                    <View style={s.cantidadPorcionWrap}>
                      <Text style={s.cantidadPorcionLabel}>¿Cuántas {p.nombre.replace(/^\d+\s*/, "")}s?</Text>
                      <View style={s.cantidadPorcionRow}>
                        <TouchableOpacity style={s.cantidadBtn} onPress={() => { const nueva = Math.max(1, cantidadPorciones - 1); setCantidadPorciones(nueva); setGramos(String(p.gramos * nueva)); setGuardado(false); }}>
                          <Text style={s.cantidadBtnText}>−</Text>
                        </TouchableOpacity>
                        <View style={s.cantidadNumWrap}>
                          <Text style={s.cantidadNum}>{cantidadPorciones}</Text>
                          <Text style={s.cantidadNumSub}>{p.nombre}</Text>
                        </View>
                        <TouchableOpacity style={s.cantidadBtn} onPress={() => { const nueva = cantidadPorciones + 1; setCantidadPorciones(nueva); setGramos(String(p.gramos * nueva)); setGuardado(false); }}>
                          <Text style={s.cantidadBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={s.cantidadResumen}>
                        <Text style={s.cantidadResumenText}>{cantidadPorciones} × {p.gramos}g = <Text style={{ color: "#F9FAFB", fontWeight: "700" }}>{totalGramos}g</Text></Text>
                        <Text style={[s.cantidadResumenText, { color: "#4ADE80" }]}>{kcalTotal} kcal ({kcalPorcion} kcal c/u)</Text>
                      </View>
                    </View>
                  );
                })()}
              </View>
            )}

            <View style={s.macrosGrid}>
              {[
                { val: caloriasCalculadas, label: "kcal", color: "#4ADE80", border: "#4ADE8033" },
                { val: macros?.proteinas.toFixed(1) + "g", label: "Proteínas", color: "#60A5FA", border: "#60A5FA33" },
                { val: macros?.carbohidratos.toFixed(1) + "g", label: "Carbos", color: "#FBBF24", border: "#FBBF2433" },
                { val: macros?.grasas.toFixed(1) + "g", label: "Grasas", color: "#F87171", border: "#F8717133" },
              ].map((item) => (
                <View key={item.label} style={[s.macroBox, { borderColor: item.border }]}>
                  <Text style={[s.macroBoxVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={s.macroBoxLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            <View style={s.macrosGrid}>
              {[
                { val: macros?.grasasSaturadas.toFixed(1) + "g", label: "G. Sat.", color: "#FCA5A5", border: "#F8717122" },
                { val: macros?.azucares.toFixed(1) + "g", label: "Azúcares", color: "#FDE68A", border: "#FBBF2422" },
                { val: macros?.fibra.toFixed(1) + "g", label: "Fibra", color: "#6EE7B7", border: "#34D39933" },
                { val: macros?.sal.toFixed(2) + "g", label: "Sal", color: "#CBD5E1", border: "#94A3B833" },
              ].map((item) => (
                <View key={item.label} style={[s.macroBox, { borderColor: item.border }]}>
                  <Text style={[s.macroBoxVal, s.macroBoxValSm, { color: item.color }]}>{item.val}</Text>
                  <Text style={s.macroBoxLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            <Text style={s.mealSelectorTitle}>Añadir a</Text>
            {isOtherDay && (
              <View style={{ backgroundColor: "#1F6FEB22", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#1F6FEB55", marginBottom: 4 }}>
                <Text style={{ color: "#58A6FF", fontSize: 13, fontWeight: "600", textAlign: "center" }}>📅 Añadiendo al {targetDateLabel}</Text>
              </View>
            )}
            <View style={s.mealSelector}>
              {(Object.keys(MEAL_LABELS) as MealKey[]).map((m) => (
                <TouchableOpacity key={m} style={[s.mealChip, mealSeleccionada === m && s.mealChipActive]} onPress={() => setMealSeleccionada(m)}>
                  <Text style={s.mealChipIcon}>{MEAL_ICONS[m]}</Text>
                  <Text style={[s.mealChipText, mealSeleccionada === m && s.mealChipTextActive]}>{MEAL_LABELS[m]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {saveError && (
              <View style={{ backgroundColor: "#EF444422", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#EF444455", marginBottom: 8 }}>
                <Text style={{ color: "#EF4444", fontSize: 13, fontWeight: "600", textAlign: "center" }}>⚠ {saveError}</Text>
              </View>
            )}
            <TouchableOpacity style={[s.saveBtn, guardado && s.saveBtnDone]} onPress={guardarAlimento} disabled={guardado}>
              <Text style={s.saveBtnText}>{guardado ? "✓ Guardado" : "Guardar alimento"}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

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
  title: { color: c.text, fontSize: 26, fontWeight: "800" },
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
