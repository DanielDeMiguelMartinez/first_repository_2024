import { useApp } from "@/app/services/i18n";
import { signalMealSaved } from "@/app/services/refreshSignal";
import { buscarDesdeEscaneo } from "@/app/services/openFoodFacts";
import {
  buscarAlimentosPersonalizados,
  crearReceta,
  eliminarReceta,
  IngredienteReceta,
  obtenerRecetas,
  Receta
} from "@/app/services/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// Convierte cualquier valor a número seguro — evita crashes de toFixed/undefined
function safeNum(val: any): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function getTodayKey(): string {
  const d = new Date();
  return `nutri_meals_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const RECENT_FOODS_KEY = "nutri_recent_foods_v2";
const FAVORITES_KEY = "nutri_favorites";
const SAVED_COMMUNITY_KEY = "nutri_recetas_guardadas";

type RecetaGuardada = {
  pub_id: string;
  nombre: string;
  descripcion: string;
  ingredientes: any[];
  calorias_total: number;
  proteinas_total: number;
  grasas_total: number;
  carbohidratos_total: number;
  autor: string;
  savedAt: number;
};

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

const ALIMENTOS_BASICOS = [
  { nombre: "Manzana", supermercado: "Cualquier mercado", marca: "Natural", calorias: 52, proteinas: 0.3, grasas: 0.2, carbohidratos: 14 },
  { nombre: "Plátano", supermercado: "Cualquier mercado", marca: "Natural", calorias: 89, proteinas: 1.1, grasas: 0.3, carbohidratos: 23 },
  { nombre: "Naranja", supermercado: "Cualquier mercado", marca: "Natural", calorias: 47, proteinas: 0.9, grasas: 0.1, carbohidratos: 12 },
  { nombre: "Pechuga de pollo", supermercado: "Cualquier mercado", marca: "Natural", calorias: 165, proteinas: 31, grasas: 3.6, carbohidratos: 0 },
  { nombre: "Pechuga de pavo", supermercado: "Cualquier mercado", marca: "Natural", calorias: 135, proteinas: 30, grasas: 1, carbohidratos: 0 },
  { nombre: "Ternera", supermercado: "Cualquier mercado", marca: "Natural", calorias: 250, proteinas: 26, grasas: 15, carbohidratos: 0 },
  { nombre: "Salmón", supermercado: "Cualquier mercado", marca: "Natural", calorias: 208, proteinas: 20, grasas: 13, carbohidratos: 0 },
  { nombre: "Huevo", supermercado: "Cualquier mercado", marca: "Natural", calorias: 155, proteinas: 13, grasas: 11, carbohidratos: 1.1 },
  { nombre: "Leche entera", supermercado: "Cualquier mercado", marca: "Natural", calorias: 61, proteinas: 3.2, grasas: 3.3, carbohidratos: 4.8 },
  { nombre: "Yogur natural", supermercado: "Cualquier mercado", marca: "Natural", calorias: 59, proteinas: 3.5, grasas: 3.3, carbohidratos: 4.7 },
  { nombre: "Arroz blanco cocido", supermercado: "Cualquier mercado", marca: "Natural", calorias: 130, proteinas: 2.7, grasas: 0.3, carbohidratos: 28 },
  { nombre: "Pasta cocida", supermercado: "Cualquier mercado", marca: "Natural", calorias: 158, proteinas: 5.8, grasas: 0.9, carbohidratos: 31 },
  { nombre: "Pan de molde", supermercado: "Cualquier mercado", marca: "Natural", calorias: 265, proteinas: 9, grasas: 3.2, carbohidratos: 49 },
  { nombre: "Patata cocida", supermercado: "Cualquier mercado", marca: "Natural", calorias: 77, proteinas: 2, grasas: 0.1, carbohidratos: 17 },
  { nombre: "Brócoli", supermercado: "Cualquier mercado", marca: "Natural", calorias: 34, proteinas: 2.8, grasas: 0.4, carbohidratos: 7 },
  { nombre: "Zanahoria", supermercado: "Cualquier mercado", marca: "Natural", calorias: 41, proteinas: 0.9, grasas: 0.2, carbohidratos: 10 },
  { nombre: "Tomate", supermercado: "Cualquier mercado", marca: "Natural", calorias: 18, proteinas: 0.9, grasas: 0.2, carbohidratos: 3.9 },
  { nombre: "Espinacas", supermercado: "Cualquier mercado", marca: "Natural", calorias: 23, proteinas: 2.9, grasas: 0.4, carbohidratos: 3.6 },
  { nombre: "Aceite de oliva", supermercado: "Cualquier mercado", marca: "Natural", calorias: 884, proteinas: 0, grasas: 100, carbohidratos: 0 },
  { nombre: "Lentejas cocidas", supermercado: "Cualquier mercado", marca: "Natural", calorias: 116, proteinas: 9, grasas: 0.4, carbohidratos: 20 },
  { nombre: "Garbanzos cocidos", supermercado: "Cualquier mercado", marca: "Natural", calorias: 164, proteinas: 8.9, grasas: 2.6, carbohidratos: 27 },
  { nombre: "Avena", supermercado: "Cualquier mercado", marca: "Natural", calorias: 389, proteinas: 17, grasas: 7, carbohidratos: 66 },
  { nombre: "Almendras", supermercado: "Cualquier mercado", marca: "Natural", calorias: 579, proteinas: 21, grasas: 50, carbohidratos: 22 },
  { nombre: "Atún en lata", supermercado: "Cualquier mercado", marca: "Natural", calorias: 116, proteinas: 25, grasas: 1, carbohidratos: 0 },
  { nombre: "Requesón", supermercado: "Cualquier mercado", marca: "Natural", calorias: 74, proteinas: 11, grasas: 3, carbohidratos: 3 },
  { nombre: "Queso cottage", supermercado: "Cualquier mercado", marca: "Natural", calorias: 98, proteinas: 11, grasas: 4.3, carbohidratos: 3.4 },
  { nombre: "Clara de huevo", supermercado: "Cualquier mercado", marca: "Natural", calorias: 52, proteinas: 11, grasas: 0.2, carbohidratos: 0.7 },
  { nombre: "Sardinas en lata", supermercado: "Cualquier mercado", marca: "Natural", calorias: 208, proteinas: 25, grasas: 11, carbohidratos: 0 },
  { nombre: "Bacalao", supermercado: "Cualquier mercado", marca: "Natural", calorias: 82, proteinas: 18, grasas: 0.7, carbohidratos: 0 },
  { nombre: "Merluza", supermercado: "Cualquier mercado", marca: "Natural", calorias: 86, proteinas: 17, grasas: 1.4, carbohidratos: 0 },
  { nombre: "Gambas", supermercado: "Cualquier mercado", marca: "Natural", calorias: 85, proteinas: 18, grasas: 0.9, carbohidratos: 0.9 },
  { nombre: "Edamame", supermercado: "Cualquier mercado", marca: "Natural", calorias: 121, proteinas: 11, grasas: 5, carbohidratos: 9 },
  { nombre: "Tofu firme", supermercado: "Cualquier mercado", marca: "Natural", calorias: 76, proteinas: 8, grasas: 4.2, carbohidratos: 1.9 },
  { nombre: "Tempeh", supermercado: "Cualquier mercado", marca: "Natural", calorias: 193, proteinas: 19, grasas: 11, carbohidratos: 9 },
  { nombre: "Judías blancas cocidas", supermercado: "Cualquier mercado", marca: "Natural", calorias: 139, proteinas: 9.7, grasas: 0.5, carbohidratos: 25 },
  { nombre: "Queso parmesano", supermercado: "Cualquier mercado", marca: "Natural", calorias: 431, proteinas: 38, grasas: 29, carbohidratos: 4 },
  { nombre: "Proteína de suero (whey)", supermercado: "Cualquier mercado", marca: "Natural", calorias: 370, proteinas: 80, grasas: 4, carbohidratos: 8 },
];

type AlimentoBuscado = {
  nombre: string; supermercado: string; marca: string;
  calorias: number; proteinas: number; grasas: number; carbohidratos: number;
  esPersonalizado?: boolean;
};

type FavoriteFood = AlimentoBuscado & { savedAt: number };
type RecentFood = AlimentoBuscado & { addedAt: number };

function extraerSupermercado(p: any): string {
  const tiendas: Record<string, string> = {
    mercadona: "Mercadona", hacendado: "Mercadona", carrefour: "Carrefour",
    lidl: "Lidl", simply: "Simply", alcampo: "Alcampo", dia: "DIA",
    eroski: "Eroski", condis: "Condis", hipercor: "Hipercor",
    "el corte ingles": "El Corte Inglés", aldi: "Aldi", consum: "Consum",
    caprabo: "Caprabo", bonpreu: "Bonpreu", ahorramas: "Ahorramas",
    gadis: "Gadis", spar: "Spar", coviran: "Covirán",
  };
  const texto = [p.brands || "", p.stores || "", p.owner || ""].join(" ").toLowerCase();
  for (const [key, val] of Object.entries(tiendas)) {
    if (texto.includes(key)) return val;
  }
  if (p.brands) return p.brands.split(",")[0].trim();
  return "Marca desconocida";
}

// Extrae nutrientes de forma 100% segura desde OpenFoodFacts
function extraerNutrientes(p: any): Pick<AlimentoBuscado, "calorias" | "proteinas" | "grasas" | "carbohidratos"> {
  const n = p.nutriments || {};
  return {
    calorias: safeNum(n["energy-kcal_100g"] ?? n["energy-kcal"] ?? n["energy_100g"] ?? n["energy"]),
    proteinas: safeNum(n["proteins_100g"] ?? n["proteins"]),
    grasas: safeNum(n["fat_100g"] ?? n["fat"]),
    carbohidratos: safeNum(n["carbohydrates_100g"] ?? n["carbohydrates"]),
  };
}

async function cargarFavoritos(): Promise<FavoriteFood[]> {
  try {
    const stored = await AsyncStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

async function toggleFavorito(alimento: AlimentoBuscado): Promise<FavoriteFood[]> {
  const lista = await cargarFavoritos();
  const existe = lista.find((f) => f.nombre.toLowerCase() === alimento.nombre.toLowerCase());
  let nueva: FavoriteFood[];
  if (existe) {
    nueva = lista.filter((f) => f.nombre.toLowerCase() !== alimento.nombre.toLowerCase());
  } else {
    nueva = [{ ...alimento, savedAt: Date.now() }, ...lista];
  }
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(nueva));
  return nueva;
}

async function cargarRecientes(): Promise<RecentFood[]> {
  try {
    const stored = await AsyncStorage.getItem(RECENT_FOODS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

async function registrarReciente(alimento: AlimentoBuscado): Promise<void> {
  try {
    const lista = await cargarRecientes();
    const filtrada = lista.filter((f) => f.nombre.toLowerCase() !== alimento.nombre.toLowerCase());
    const nueva: RecentFood[] = [{ ...alimento, addedAt: Date.now() }, ...filtrada].slice(0, 50);
    await AsyncStorage.setItem(RECENT_FOODS_KEY, JSON.stringify(nueva));
  } catch {}
}

function BuscadorIngrediente({
  onSelect, onScanear, onClose,
}: {
  onSelect: (alimento: AlimentoBuscado, gramos: number) => void;
  onScanear: () => void;
  onClose: () => void;
}) {
  const { colors: bColors } = useApp();
  const b = makeBStyles(bColors);
  const [busqueda, setBusqueda] = useState("");
  const [gramos, setGramos] = useState("100");
  const [resultados, setResultados] = useState<AlimentoBuscado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [seleccionado, setSeleccionado] = useState<AlimentoBuscado | null>(null);
  const [recientes, setRecientes] = useState<RecentFood[]>([]);
  const [favoritos, setFavoritos] = useState<FavoriteFood[]>([]);
  const [tabHistorial, setTabHistorial] = useState<"recientes" | "favoritos">("recientes");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Record<string, AlimentoBuscado[]>>({});
  const currentSearch = useRef("");

  useEffect(() => {
    cargarRecientes().then(setRecientes);
    cargarFavoritos().then(setFavoritos);
  }, []);

  const esFavorito = (nombre: string) =>
    favoritos.some((f) => f.nombre.toLowerCase() === nombre.toLowerCase());

  const handleToggleFavorito = async (alimento: AlimentoBuscado) => {
    const nueva = await toggleFavorito(alimento);
    setFavoritos(nueva);
  };

  // Limpia TODO el estado del buscador de una vez
  const limpiarBuscador = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setBusqueda("");
    setResultados([]);
    setCargando(false);
    currentSearch.current = "";
    setSeleccionado(null);
    setGramos("100");
  };

  const buscar = (texto: string) => {
    setBusqueda(texto);
    setSeleccionado(null);
    currentSearch.current = texto;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!texto.trim()) { setResultados([]); setCargando(false); return; }
    const locales = ALIMENTOS_BASICOS.filter((a) => a.nombre.toLowerCase().includes(texto.toLowerCase()));
    setResultados(locales);
    if (cacheRef.current[texto]) { setResultados(cacheRef.current[texto]); return; }
    buscarAlimentosPersonalizados(texto).then((pers) => {
      if (currentSearch.current !== texto) return;
      const conv: AlimentoBuscado[] = pers.map((p) => ({
        nombre: p.nombre,
        supermercado: p.supermercado || "Personalizado",
        marca: p.marca,
        calorias: safeNum(p.calorias),
        proteinas: safeNum(p.proteinas),
        grasas: safeNum(p.grasas),
        carbohidratos: safeNum(p.carbohidratos),
        esPersonalizado: true,
      }));
      setResultados((prev) => {
        const nuevos = conv.filter((c) => !prev.some((p) => p.nombre.toLowerCase() === c.nombre.toLowerCase()));
        return [...nuevos, ...prev];
      });
    }).catch(() => {});
    setCargando(true);
    debounceRef.current = setTimeout(async () => {
      if (currentSearch.current !== texto) return;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const enc = encodeURIComponent(texto);
        const [resEs, resWorld] = await Promise.allSettled([
          fetch(`https://es.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=10&sort_by=unique_scans_n`, { signal: controller.signal }),
          fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=10&sort_by=unique_scans_n`, { signal: controller.signal }),
        ]);
        clearTimeout(timeout);
        if (currentSearch.current !== texto) return;
        const vistos = new Set<string>();
        const remotos: AlimentoBuscado[] = [];
        for (const r of [resEs, resWorld]) {
          if (r.status !== "fulfilled") continue;
          const data = await r.value.json();
          for (const p of data.products || []) {
            if (!p.product_name) continue;
            const nombre = (p.product_name_es || p.product_name).toLowerCase();
            if (vistos.has(nombre)) continue;
            vistos.add(nombre);
            remotos.push({
              nombre: p.product_name_es || p.product_name,
              marca: p.brands?.split(",")[0].trim() || "Sin marca",
              supermercado: extraerSupermercado(p),
              ...extraerNutrientes(p),
            });
          }
        }
        const localesFinal = ALIMENTOS_BASICOS.filter((a) => a.nombre.toLowerCase().includes(texto.toLowerCase()));
        const todos: AlimentoBuscado[] = [...localesFinal];
        for (const r of remotos) {
          if (!todos.some((t) => t.nombre.toLowerCase() === r.nombre.toLowerCase())) todos.push(r);
        }
        cacheRef.current[texto] = todos;
        if (currentSearch.current === texto) setResultados(todos);
      } catch {}
      finally { if (currentSearch.current === texto) setCargando(false); }
    }, 150);
  };

  const confirmar = async () => {
    if (!seleccionado) return;
    await registrarReciente(seleccionado);
    onSelect(seleccionado, Number(gramos) || 100);
    onClose();
  };

  const listaHistorial = tabHistorial === "recientes" ? recientes : favoritos;

  const renderAlimentoItem = (prod: AlimentoBuscado, i: number) => {
    const sc = SUPER_COLORS[prod.supermercado] || "#4B5563";
    const fav = esFavorito(prod.nombre);
    return (
      <View key={i} style={b.resultItemWrap}>
        <TouchableOpacity style={b.resultItem} onPress={() => { setSeleccionado(prod); Keyboard.dismiss(); }} activeOpacity={0.7}>
          <View style={b.resultLeft}>
            <View style={b.resultNameRow}>
              <Text style={b.resultName} numberOfLines={1}>{prod.nombre}</Text>
              {prod.esPersonalizado && <View style={b.customBadge}><Text style={b.customBadgeText}>✦ propio</Text></View>}
            </View>
            <View style={b.resultMeta}>
              <View style={[b.superBadge, { backgroundColor: sc + "22", borderColor: sc + "55" }]}>
                <Text style={[b.superBadgeText, { color: sc }]}>{prod.supermercado}</Text>
              </View>
              {prod.marca !== "Natural" && prod.marca !== "Sin marca" && <Text style={b.resultMarca}>{prod.marca}</Text>}
            </View>
            <Text style={b.resultMacros}>P {safeNum(prod.proteinas).toFixed(1)}g · C {safeNum(prod.carbohidratos).toFixed(1)}g · G {safeNum(prod.grasas).toFixed(1)}g</Text>
          </View>
          <View style={b.resultRight}>
            <Text style={b.resultKcal}>{safeNum(prod.calorias).toFixed(0)}</Text>
            <Text style={b.resultKcalUnit}>kcal/100g</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={b.favBtn} onPress={() => handleToggleFavorito(prod)}>
          <Text style={[b.favIcon, fav && b.favIconActive]}>{fav ? "★" : "☆"}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScrollView style={b.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={b.header}>
        <TouchableOpacity onPress={onClose}><Text style={b.close}>✕ Cerrar</Text></TouchableOpacity>
        <Text style={b.title}>Añadir ingrediente</Text>
      </View>

      {/* Barra de búsqueda — el ✕ limpia TODO (texto + selección + gramos) */}
      <View style={b.searchBox}>
        <Text style={b.searchIcon}>🔍</Text>
        <TextInput
          style={b.searchInput}
          value={busqueda}
          onChangeText={buscar}
          placeholder="Buscar alimento..."
          placeholderTextColor={bColors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {(busqueda.length > 0 || seleccionado) && (
          <TouchableOpacity onPress={limpiarBuscador}>
            <Text style={b.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={b.scanBtn} onPress={onScanear}>
        <Text style={b.scanBtnText}>📷 Escanear código de barras</Text>
      </TouchableOpacity>

      {busqueda.length === 0 && !seleccionado && (
        <View style={b.historialWrap}>
          <View style={b.historialTabs}>
            <TouchableOpacity style={[b.historialTab, tabHistorial === "recientes" && b.historialTabActive]} onPress={() => setTabHistorial("recientes")}>
              <Text style={[b.historialTabText, tabHistorial === "recientes" && b.historialTabTextActive]}>⚡ Recientes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[b.historialTab, tabHistorial === "favoritos" && b.historialTabActive]} onPress={() => setTabHistorial("favoritos")}>
              <Text style={[b.historialTabText, tabHistorial === "favoritos" && b.historialTabTextActive]}>★ Favoritos</Text>
            </TouchableOpacity>
          </View>
          {listaHistorial.length === 0 ? (
            <Text style={b.emptyHistorial}>{tabHistorial === "recientes" ? "Aquí aparecerán los alimentos que busques" : "Pulsa ☆ en cualquier alimento para guardarlo"}</Text>
          ) : (
            listaHistorial.map((food, i) => renderAlimentoItem(food, i))
          )}
        </View>
      )}

      {busqueda.length > 0 && !seleccionado && (
        <>
          {cargando && <View style={b.loadingRow}><ActivityIndicator color="#58A6FF" size="small" /><Text style={b.loadingText}>Buscando en tiendas...</Text></View>}
          {resultados.map((prod, i) => renderAlimentoItem(prod, i))}
          {!cargando && resultados.length === 0 && <Text style={b.emptyHistorial}>Sin resultados para "{busqueda}"</Text>}
        </>
      )}

      {seleccionado && (
        <View style={b.selectedCard}>
          <TouchableOpacity onPress={() => { setSeleccionado(null); setGramos("100"); }}>
            <Text style={b.changeBtn}>← Cambiar</Text>
          </TouchableOpacity>
          <Text style={b.selectedName}>{seleccionado.nombre}</Text>
          <View style={b.selectedMeta}>
            <View style={[b.superBadge, { backgroundColor: (SUPER_COLORS[seleccionado.supermercado] || "#4B5563") + "22", borderColor: (SUPER_COLORS[seleccionado.supermercado] || "#4B5563") + "55" }]}>
              <Text style={[b.superBadgeText, { color: SUPER_COLORS[seleccionado.supermercado] || "#4B5563" }]}>{seleccionado.supermercado}</Text>
            </View>
          </View>
          <View style={b.gramosRow}>
            <Text style={b.gramosLabel}>Cantidad (g)</Text>
            <TextInput style={b.gramosInput} value={gramos} onChangeText={setGramos} keyboardType="numeric" selectTextOnFocus />
          </View>
          <View style={b.previewRow}>
            {[
              { val: Math.round(safeNum(seleccionado.calorias) * (Number(gramos) || 0) / 100), label: "kcal", color: "#4ADE80" },
              { val: (safeNum(seleccionado.proteinas) * (Number(gramos) || 0) / 100).toFixed(1) + "g", label: "Prot", color: "#60A5FA" },
              { val: (safeNum(seleccionado.carbohidratos) * (Number(gramos) || 0) / 100).toFixed(1) + "g", label: "Carbos", color: "#FBBF24" },
              { val: (safeNum(seleccionado.grasas) * (Number(gramos) || 0) / 100).toFixed(1) + "g", label: "Grasas", color: "#F87171" },
            ].map((item) => (
              <View key={item.label} style={b.previewBox}>
                <Text style={[b.previewVal, { color: item.color }]}>{item.val}</Text>
                <Text style={b.previewLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={b.confirmBtn} onPress={confirmar}>
            <Text style={b.confirmText}>+ Añadir a la receta</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

export default function RecetasScreen() {
  const { colors, theme } = useApp();
  const s = makeSStyles(colors);
  const router = useRouter();
  const params = useLocalSearchParams<{ scannedCode?: string; scannedForReceta?: string }>();
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalAnadir, setModalAnadir] = useState<Receta | null>(null);
  const [modalAnadirGuardada, setModalAnadirGuardada] = useState<RecetaGuardada | null>(null);
  const [mealSeleccionada, setMealSeleccionada] = useState<MealKey>("comida");
  const [modalCrear, setModalCrear] = useState(false);
  const [mostrarBuscador, setMostrarBuscador] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [ingredientes, setIngredientes] = useState<IngredienteReceta[]>([]);
  const [guardandoReceta, setGuardandoReceta] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState<Receta | null>(null);
  const [confirmarBorrarGuardada, setConfirmarBorrarGuardada] = useState<RecetaGuardada | null>(null);
  const [tab, setTab] = useState<"mias" | "guardadas">("mias");
  const [recetasGuardadas, setRecetasGuardadas] = useState<RecetaGuardada[]>([]);

  useFocusEffect(React.useCallback(() => {
    cargarRecetasList();
    AsyncStorage.getItem(SAVED_COMMUNITY_KEY).then((raw) => {
      setRecetasGuardadas(raw ? JSON.parse(raw) : []);
    });
  }, []));

  useEffect(() => {
    if (params.scannedCode && params.scannedForReceta === "1") {
      cargarIngredientePorCodigo(params.scannedCode);
      setModalCrear(true);
      setMostrarBuscador(false);
    }
  }, [params.scannedCode]);

  const cargarRecetasList = async () => {
    setCargando(true);
    try {
      const data = await obtenerRecetas();
      setRecetas(data);
    } catch {
      setRecetas([]);
    } finally {
      setCargando(false);
    }
  };

  const cargarIngredientePorCodigo = async (codigo: string) => {
    try {
      const prod = await buscarDesdeEscaneo(codigo);
      if (!prod) { Alert.alert("No encontrado", "Producto no encontrado."); return; }
      setIngredientes((prev) => [...prev, {
        nombre: prod.nombre,
        gramos: 100,
        calorias: Math.round(safeNum(prod.nutrientes.calorias)),
        proteinas: Number(safeNum(prod.nutrientes.proteinas).toFixed(1)),
        carbs: Number(safeNum(prod.nutrientes.carbohidratos).toFixed(1)),
        grasas: Number(safeNum(prod.nutrientes.grasas).toFixed(1)),
      }]);
    } catch { Alert.alert("Error", "No se pudo cargar el producto."); }
  };

  const totalesReceta = (ings: IngredienteReceta[]) => ings.reduce(
    (acc, i) => ({
      calorias: acc.calorias + safeNum(i.calorias),
      proteinas: acc.proteinas + safeNum(i.proteinas),
      carbs: acc.carbs + safeNum(i.carbs),
      grasas: acc.grasas + safeNum(i.grasas),
    }),
    { calorias: 0, proteinas: 0, carbs: 0, grasas: 0 }
  );

  const agregarIngrediente = (alimento: AlimentoBuscado, gramos: number) => {
    const factor = gramos / 100;
    setIngredientes((prev) => [...prev, {
      nombre: alimento.nombre,
      gramos,
      calorias: Math.round(safeNum(alimento.calorias) * factor),
      proteinas: Number((safeNum(alimento.proteinas) * factor).toFixed(1)),
      carbs: Number((safeNum(alimento.carbohidratos) * factor).toFixed(1)),
      grasas: Number((safeNum(alimento.grasas) * factor).toFixed(1)),
    }]);
    setMostrarBuscador(false);
  };

  const quitarIngrediente = (i: number) => setIngredientes((prev) => prev.filter((_, idx) => idx !== i));

  const guardarReceta = async () => {
    if (!nombre.trim()) { Alert.alert("Error", "El nombre es obligatorio."); return; }
    if (ingredientes.length === 0) { Alert.alert("Error", "Añade al menos un ingrediente."); return; }
    setGuardandoReceta(true);
    const totales = totalesReceta(ingredientes);
    const ok = await crearReceta({
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      ingredientes,
      calorias_total: totales.calorias,
      proteinas_total: totales.proteinas,
      grasas_total: totales.grasas,
      carbohidratos_total: totales.carbs,
    });
    setGuardandoReceta(false);
    if (ok) { setModalCrear(false); setNombre(""); setDescripcion(""); setIngredientes([]); cargarRecetasList(); }
    else Alert.alert("Error", "No se pudo guardar la receta.");
  };

  const anadirAlDia = async (receta: Receta, meal: MealKey) => {
    try {
      const storageKey = getTodayKey();
      const stored = await AsyncStorage.getItem(storageKey);
      const meals = stored ? JSON.parse(stored) : { desayuno: [], comida: [], merienda: [], cena: [] };
      meals[meal] = [...meals[meal], {
        id: Date.now().toString(), name: receta.nombre, brand: "Receta",
        supermercado: "Receta propia",
        calories: Math.round(safeNum(receta.calorias_total)),
        protein: Number(safeNum(receta.proteinas_total).toFixed(1)),
        carbs: Number(safeNum(receta.carbohidratos_total).toFixed(1)),
        fat: Number(safeNum(receta.grasas_total).toFixed(1)),
        saturatedFat: 0, sugar: 0, fiber: 0, salt: 0, per100: null,
      }];
      await AsyncStorage.setItem(storageKey, JSON.stringify(meals));
      signalMealSaved(meals, storageKey);
      setModalAnadir(null);
      Alert.alert("✓ Añadido", `${receta.nombre} añadido a ${MEAL_LABELS[meal]}.`);
    } catch { Alert.alert("Error", "No se pudo añadir al día."); }
  };

  const anadirGuardadaAlDia = async (rg: RecetaGuardada, meal: MealKey) => {
    try {
      const storageKey = getTodayKey();
      const stored = await AsyncStorage.getItem(storageKey);
      const meals = stored ? JSON.parse(stored) : { desayuno: [], comida: [], merienda: [], cena: [] };
      meals[meal] = [...meals[meal], {
        id: Date.now().toString(), name: rg.nombre, brand: "Receta guardada",
        supermercado: "Receta propia",
        calories: Math.round(safeNum(rg.calorias_total)),
        protein: Number(safeNum(rg.proteinas_total).toFixed(1)),
        carbs: Number(safeNum(rg.carbohidratos_total).toFixed(1)),
        fat: Number(safeNum(rg.grasas_total).toFixed(1)),
        saturatedFat: 0, sugar: 0, fiber: 0, salt: 0, per100: null,
      }];
      await AsyncStorage.setItem(storageKey, JSON.stringify(meals));
      signalMealSaved(meals, storageKey);
      setModalAnadirGuardada(null);
      Alert.alert("✓ Añadido", `${rg.nombre} añadido a ${MEAL_LABELS[meal]}.`);
    } catch { Alert.alert("Error", "No se pudo añadir al día."); }
  };

  const quitarGuardada = async (pub_id: string) => {
    const raw = await AsyncStorage.getItem(SAVED_COMMUNITY_KEY);
    const lista: RecetaGuardada[] = raw ? JSON.parse(raw) : [];
    const nueva = lista.filter((r) => r.pub_id !== pub_id);
    await AsyncStorage.setItem(SAVED_COMMUNITY_KEY, JSON.stringify(nueva));
    setRecetasGuardadas(nueva);
  };

  const borrarReceta = (receta: Receta) => setConfirmarBorrar(receta);

  const confirmarEliminarReceta = async () => {
    if (!confirmarBorrar) return;
    const ok = await eliminarReceta(confirmarBorrar.id!);
    setConfirmarBorrar(null);
    if (!ok) {
      Alert.alert("Error", "No se pudo eliminar la receta.");
      return;
    }
    cargarRecetasList();
  };

  const totalesActuales = totalesReceta(ingredientes);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />

      <Modal visible={modalCrear} animationType="slide" onRequestClose={() => { setModalCrear(false); setMostrarBuscador(false); }}>
        <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
          <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
          {mostrarBuscador ? (
            <BuscadorIngrediente
              onSelect={agregarIngrediente}
              onScanear={() => { setModalCrear(false); setMostrarBuscador(false); router.push({ pathname: "/scanner", params: { forReceta: "1" } }); }}
              onClose={() => setMostrarBuscador(false)}
            />
          ) : (
            <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
              <View style={s.modalHeader}>
                <TouchableOpacity onPress={() => { setModalCrear(false); setNombre(""); setDescripcion(""); setIngredientes([]); }}>
                  <Text style={s.back}>✕ Cerrar</Text>
                </TouchableOpacity>
                <Text style={s.title}>Nueva receta</Text>
              </View>
              <View style={s.card}>
                <Text style={s.cardTitle}>📝 Nombre y descripción</Text>
                <TextInput style={s.input} value={nombre} onChangeText={setNombre} placeholder="Ej: Arroz con pollo" placeholderTextColor={colors.textMuted} />
                <TextInput style={[s.input, { marginTop: 8 }]} value={descripcion} onChangeText={setDescripcion} placeholder="Descripción (opcional)" placeholderTextColor={colors.textMuted} />
              </View>
              <View style={s.card}>
                <View style={s.cardTitleRow}>
                  <Text style={s.cardTitle}>🥗 Ingredientes</Text>
                  <TouchableOpacity style={s.addIngBtnRow} onPress={() => setMostrarBuscador(true)}><Text style={s.addIngBtnRowText}>+ Añadir</Text></TouchableOpacity>
                </View>
                {ingredientes.length === 0 ? (
                  <View style={s.emptyIngWrap}>
                    <Text style={s.emptyIng}>Sin ingredientes todavía</Text>
                    <TouchableOpacity style={s.addIngBig} onPress={() => setMostrarBuscador(true)}><Text style={s.addIngBigText}>🔍 Buscar o escanear ingrediente</Text></TouchableOpacity>
                  </View>
                ) : (
                  <>
                    {ingredientes.map((ing, i) => (
                      <View key={i} style={s.ingItem}>
                        <View style={s.ingLeft}>
                          <Text style={s.ingName} numberOfLines={1}>{ing.nombre}</Text>
                          <Text style={s.ingMacros}>{ing.gramos}g · {ing.calorias} kcal · P{ing.proteinas}g C{ing.carbs}g G{ing.grasas}g</Text>
                        </View>
                        <TouchableOpacity onPress={() => quitarIngrediente(i)}><Text style={s.ingDelete}>✕</Text></TouchableOpacity>
                      </View>
                    ))}
                    <View style={s.totalesWrap}>
                      <Text style={s.totalesTitle}>Total receta</Text>
                      <View style={s.totalesRow}>
                        {[
                          { val: Math.round(totalesActuales.calorias), label: "kcal", color: "#4ADE80" },
                          { val: totalesActuales.proteinas.toFixed(1) + "g", label: "Prot", color: "#60A5FA" },
                          { val: totalesActuales.carbs.toFixed(1) + "g", label: "Carbos", color: "#FBBF24" },
                          { val: totalesActuales.grasas.toFixed(1) + "g", label: "Grasas", color: "#F87171" },
                        ].map((item) => (
                          <View key={item.label} style={s.totalesBox}>
                            <Text style={[s.totalesVal, { color: item.color }]}>{item.val}</Text>
                            <Text style={s.totalesLabel}>{item.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                    <TouchableOpacity style={s.addMoreBtn} onPress={() => setMostrarBuscador(true)}><Text style={s.addMoreBtnText}>+ Añadir otro ingrediente</Text></TouchableOpacity>
                  </>
                )}
              </View>
              <TouchableOpacity style={[s.saveBtn, guardandoReceta && { backgroundColor: "#1F3A6B" }]} onPress={guardarReceta} disabled={guardandoReceta}>
                <Text style={s.saveBtnText}>{guardandoReceta ? "Guardando..." : "✓ Guardar receta"}</Text>
              </TouchableOpacity>
              <View style={{ height: 60 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      <Modal visible={!!modalAnadir} transparent animationType="fade" onRequestClose={() => setModalAnadir(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setModalAnadir(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>{modalAnadir?.nombre}</Text>
            <Text style={s.popupSubtitle}>¿A qué comida añadir?</Text>
            <View style={s.mealSelector}>
              {(Object.keys(MEAL_LABELS) as MealKey[]).map((m) => (
                <TouchableOpacity key={m} style={[s.mealChip, mealSeleccionada === m && s.mealChipActive]} onPress={() => setMealSeleccionada(m)}>
                  <Text style={s.mealChipIcon}>{MEAL_ICONS[m]}</Text>
                  <Text style={[s.mealChipText, mealSeleccionada === m && s.mealChipTextActive]}>{MEAL_LABELS[m]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModalAnadir(null)}><Text style={s.cancelText}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={() => modalAnadir && anadirAlDia(modalAnadir, mealSeleccionada)}><Text style={s.confirmText}>Añadir</Text></TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <View style={s.headerOuter}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Volver</Text></TouchableOpacity>
        <View style={s.headerRow}>
          <Text style={s.title}>Recetas</Text>
          {tab === "mias" && (
            <TouchableOpacity style={s.newBtn} onPress={() => { setNombre(""); setDescripcion(""); setIngredientes([]); setMostrarBuscador(false); setModalCrear(true); }}>
              <Text style={s.newBtnText}>+ Nueva</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={s.tabsRow}>
          <TouchableOpacity style={[s.tabBtn, tab === "mias" && s.tabBtnActive]} onPress={() => setTab("mias")}>
            <Text style={[s.tabBtnText, tab === "mias" && s.tabBtnTextActive]}>Mis recetas</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tabBtn, tab === "guardadas" && s.tabBtnActive]} onPress={() => setTab("guardadas")}>
            <Text style={[s.tabBtnText, tab === "guardadas" && s.tabBtnTextActive]}>
              Guardadas{recetasGuardadas.length > 0 ? ` (${recetasGuardadas.length})` : ""}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {tab === "mias" ? (
          cargando ? (
            <ActivityIndicator color="#58A6FF" style={{ marginTop: 40 }} />
          ) : recetas.length === 0 ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyIcon}>🍳</Text>
              <Text style={s.emptyTitle}>Sin recetas todavía</Text>
              <Text style={s.emptyText}>Crea tu primera receta</Text>
              <TouchableOpacity style={s.saveBtn} onPress={() => { setNombre(""); setDescripcion(""); setIngredientes([]); setMostrarBuscador(false); setModalCrear(true); }}>
                <Text style={s.saveBtnText}>+ Crear receta</Text>
              </TouchableOpacity>
            </View>
          ) : (
            recetas.map((receta) => (
              <View key={receta.id} style={s.recetaCard}>
                <View style={s.recetaHeader}>
                  <View style={s.recetaLeft}>
                    <Text style={s.recetaNombre}>{receta.nombre}</Text>
                    {receta.descripcion ? <Text style={s.recetaDesc} numberOfLines={1}>{receta.descripcion}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => borrarReceta(receta)}><Text style={s.deleteBtn}>🗑️</Text></TouchableOpacity>
                </View>
                {receta.ingredientes && receta.ingredientes.length > 0 && (
                  <View style={s.ingList}>
                    {receta.ingredientes.map((ing, i) => (
                      <View key={i} style={s.ingPill}><Text style={s.ingPillText}>{ing.nombre} {ing.gramos}g</Text></View>
                    ))}
                  </View>
                )}
                <View style={s.macrosRow}>
                  {[
                    { val: Math.round(safeNum(receta.calorias_total)), label: "kcal", color: "#4ADE80" },
                    { val: Math.round(safeNum(receta.proteinas_total)) + "g", label: "Prot", color: "#60A5FA" },
                    { val: Math.round(safeNum(receta.carbohidratos_total)) + "g", label: "Carbos", color: "#FBBF24" },
                    { val: Math.round(safeNum(receta.grasas_total)) + "g", label: "Grasas", color: "#F87171" },
                  ].map((item) => (
                    <View key={item.label} style={s.macroBox}>
                      <Text style={[s.macroVal, { color: item.color }]}>{item.val}</Text>
                      <Text style={s.macroLabel}>{item.label}</Text>
                    </View>
                  ))}
                </View>
                <View style={s.cardBtnsRow}>
                  <TouchableOpacity style={[s.anadirBtn, { flex: 1 }]} onPress={() => setModalAnadir(receta)}>
                    <Text style={s.anadirBtnText}>+ Añadir al día</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.reelBtn}
                    onPress={() => router.push({ pathname: "/reels", params: { recetaNombre: receta.nombre } })}
                  >
                    <Text style={s.reelBtnText}>📹</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )
        ) : (
          recetasGuardadas.length === 0 ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyIcon}>🔖</Text>
              <Text style={s.emptyTitle}>Sin recetas guardadas</Text>
              <Text style={s.emptyText}>Guarda recetas de la Comunidad para tenerlas aquí</Text>
            </View>
          ) : (
            recetasGuardadas.map((rg) => (
              <View key={rg.pub_id} style={s.recetaCard}>
                <View style={s.recetaHeader}>
                  <View style={s.recetaLeft}>
                    <Text style={s.recetaNombre}>{rg.nombre}</Text>
                    <Text style={s.recetaDesc} numberOfLines={1}>por {rg.autor}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setConfirmarBorrarGuardada(rg)}>
                    <Text style={s.deleteBtn}>🗑️</Text>
                  </TouchableOpacity>
                </View>
                {rg.ingredientes && rg.ingredientes.length > 0 && (
                  <View style={s.ingList}>
                    {rg.ingredientes.map((ing: any, i: number) => (
                      <View key={i} style={s.ingPill}><Text style={s.ingPillText}>{ing.nombre} {ing.gramos}g</Text></View>
                    ))}
                  </View>
                )}
                <View style={s.macrosRow}>
                  {[
                    { val: Math.round(safeNum(rg.calorias_total)), label: "kcal", color: "#4ADE80" },
                    { val: Math.round(safeNum(rg.proteinas_total)) + "g", label: "Prot", color: "#60A5FA" },
                    { val: Math.round(safeNum(rg.carbohidratos_total)) + "g", label: "Carbos", color: "#FBBF24" },
                    { val: Math.round(safeNum(rg.grasas_total)) + "g", label: "Grasas", color: "#F87171" },
                  ].map((item) => (
                    <View key={item.label} style={s.macroBox}>
                      <Text style={[s.macroVal, { color: item.color }]}>{item.val}</Text>
                      <Text style={s.macroLabel}>{item.label}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={s.anadirBtn} onPress={() => setModalAnadirGuardada(rg)}>
                  <Text style={s.anadirBtnText}>+ Añadir al día</Text>
                </TouchableOpacity>
              </View>
            ))
          )
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal añadir receta guardada al día */}
      <Modal visible={!!modalAnadirGuardada} transparent animationType="fade" onRequestClose={() => setModalAnadirGuardada(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setModalAnadirGuardada(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>{modalAnadirGuardada?.nombre}</Text>
            <Text style={s.popupSubtitle}>¿A qué comida añadir?</Text>
            <View style={s.mealSelector}>
              {(Object.keys(MEAL_LABELS) as MealKey[]).map((m) => (
                <TouchableOpacity key={m} style={[s.mealChip, mealSeleccionada === m && s.mealChipActive]} onPress={() => setMealSeleccionada(m)}>
                  <Text style={s.mealChipIcon}>{MEAL_ICONS[m]}</Text>
                  <Text style={[s.mealChipText, mealSeleccionada === m && s.mealChipTextActive]}>{MEAL_LABELS[m]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModalAnadirGuardada(null)}><Text style={s.cancelText}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={() => modalAnadirGuardada && anadirGuardadaAlDia(modalAnadirGuardada, mealSeleccionada)}><Text style={s.confirmText}>Añadir</Text></TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal confirmación borrar receta */}
      <Modal visible={!!confirmarBorrar} transparent animationType="fade" onRequestClose={() => setConfirmarBorrar(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmarBorrar(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>🗑️ Eliminar receta</Text>
            <Text style={s.popupSubtitle}>¿Seguro que quieres eliminar "{confirmarBorrar?.nombre}"? Esta acción no se puede deshacer.</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarBorrar(null)}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: "#EF4444" }]} onPress={confirmarEliminarReceta}>
                <Text style={s.confirmText}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal confirmación quitar receta guardada */}
      <Modal visible={!!confirmarBorrarGuardada} transparent animationType="fade" onRequestClose={() => setConfirmarBorrarGuardada(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmarBorrarGuardada(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>🗑️ Quitar receta guardada</Text>
            <Text style={s.popupSubtitle}>¿Quitar "{confirmarBorrarGuardada?.nombre}" de tus guardadas? La receta seguirá disponible en Comunidad.</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarBorrarGuardada(null)}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: "#EF4444" }]} onPress={() => { if (confirmarBorrarGuardada) { quitarGuardada(confirmarBorrarGuardada.pub_id); setConfirmarBorrarGuardada(null); } }}>
                <Text style={s.confirmText}>Quitar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function makeBStyles(c: any) { return StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 16, paddingBottom: 8, gap: 4 },
  close: { color: "#58A6FF", fontSize: 14, marginBottom: 4 },
  title: { color: c.text, fontSize: 22, fontWeight: "800" },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4, gap: 8, marginTop: 12 },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, color: c.text, fontSize: 15, paddingVertical: 10 },
  clearBtn: { color: c.textMuted, fontSize: 14, paddingHorizontal: 4 },
  scanBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14, alignItems: "center", marginTop: 10 },
  scanBtnText: { color: c.textSub, fontSize: 14, fontWeight: "600" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  loadingText: { color: c.textMuted, fontSize: 12 },
  historialWrap: { paddingTop: 8, gap: 8 },
  historialTabs: { flexDirection: "row", backgroundColor: c.card, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 4 },
  historialTab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  historialTabActive: { backgroundColor: "#1F6FEB" },
  historialTabText: { color: c.textMuted, fontSize: 13, fontWeight: "600" },
  historialTabTextActive: { color: "#fff", fontWeight: "700" },
  emptyHistorial: { color: c.textMuted, fontSize: 13, textAlign: "center", paddingVertical: 16 },
  resultItemWrap: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 6 },
  resultItem: { flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.cardBorder },
  resultLeft: { flex: 1, marginRight: 8, gap: 4 },
  resultNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  resultName: { color: c.text, fontSize: 14, fontWeight: "600", flex: 1 },
  resultRight: { alignItems: "center" },
  customBadge: { backgroundColor: "#A78BFA22", borderWidth: 1, borderColor: "#A78BFA55", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  customBadgeText: { color: "#A78BFA", fontSize: 9, fontWeight: "700" },
  resultMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  superBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  superBadgeText: { fontSize: 10, fontWeight: "700" },
  resultMarca: { color: c.textMuted, fontSize: 11 },
  resultMacros: { color: c.textMuted, fontSize: 11 },
  resultKcal: { color: "#4ADE80", fontSize: 16, fontWeight: "800" },
  resultKcalUnit: { color: c.textMuted, fontSize: 10 },
  favBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
  favIcon: { fontSize: 18, color: c.textMuted },
  favIconActive: { color: "#FBBF24" },
  selectedCard: { backgroundColor: c.card, borderRadius: 20, padding: 16, marginTop: 12, borderWidth: 1, borderColor: c.cardBorder, gap: 12 },
  changeBtn: { color: "#58A6FF", fontSize: 13 },
  selectedName: { color: c.text, fontSize: 17, fontWeight: "800" },
  selectedMeta: { flexDirection: "row" },
  gramosRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.bg, borderRadius: 12, padding: 14 },
  gramosLabel: { color: c.textSub, fontSize: 15 },
  gramosInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 10, color: c.text, fontSize: 22, fontWeight: "800", width: 100, textAlign: "center" },
  previewRow: { flexDirection: "row", gap: 8 },
  previewBox: { flex: 1, backgroundColor: c.bg, borderRadius: 10, padding: 10, alignItems: "center" },
  previewVal: { fontSize: 15, fontWeight: "800" },
  previewLabel: { color: c.textMuted, fontSize: 10, marginTop: 2 },
  confirmBtn: { backgroundColor: "#1F6FEB", borderRadius: 12, padding: 14, alignItems: "center" },
  confirmText: { color: "#fff", fontWeight: "700", fontSize: 15 },
}); }

function makeSStyles(c: any) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  headerOuter: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tabsRow: { flexDirection: "row", backgroundColor: c.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: c.cardBorder, gap: 4 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  tabBtnActive: { backgroundColor: "#1F6FEB" },
  tabBtnText: { color: c.textMuted, fontSize: 13, fontWeight: "600" as const },
  tabBtnTextActive: { color: "#fff", fontWeight: "700" as const },
  back: { color: "#58A6FF", fontSize: 14 },
  title: { color: c.text, fontSize: 26, fontWeight: "800" },
  newBtn: { backgroundColor: "#1F6FEB", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  newBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: c.textSub, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  addIngBtnRow: { backgroundColor: "#1F6FEB22", borderWidth: 1, borderColor: "#1F6FEB55", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addIngBtnRowText: { color: "#58A6FF", fontSize: 13, fontWeight: "700" },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 12, color: c.text, fontSize: 15 },
  emptyIngWrap: { gap: 10, alignItems: "center", paddingVertical: 8 },
  emptyIng: { color: c.textMuted, fontSize: 13 },
  addIngBig: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14, alignItems: "center", width: "100%" },
  addIngBigText: { color: c.textMuted, fontSize: 14 },
  ingItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.bg, borderRadius: 10, padding: 12 },
  ingLeft: { flex: 1, gap: 3, marginRight: 8 },
  ingName: { color: "#E5E7EB", fontSize: 14, fontWeight: "600" },
  ingMacros: { color: c.textMuted, fontSize: 11 },
  ingDelete: { color: c.textMuted, fontSize: 14 },
  totalesWrap: { backgroundColor: c.bg, borderRadius: 12, padding: 12, gap: 8, marginTop: 4 },
  totalesTitle: { color: c.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  totalesRow: { flexDirection: "row", gap: 8 },
  totalesBox: { flex: 1, alignItems: "center" },
  totalesVal: { fontSize: 15, fontWeight: "800" },
  totalesLabel: { color: c.textMuted, fontSize: 10, marginTop: 1 },
  addMoreBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 12, alignItems: "center" },
  addMoreBtnText: { color: c.textMuted, fontSize: 13 },
  saveBtn: { backgroundColor: "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 16 },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  emptyWrap: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: c.text, fontSize: 20, fontWeight: "800" },
  emptyText: { color: c.textMuted, fontSize: 14, textAlign: "center", paddingHorizontal: 20 },
  recetaCard: { backgroundColor: c.card, borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: c.cardBorder, gap: 12 },
  recetaHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  recetaLeft: { flex: 1, gap: 2 },
  recetaNombre: { color: c.text, fontSize: 17, fontWeight: "800" },
  recetaDesc: { color: c.textMuted, fontSize: 12 },
  deleteBtn: { fontSize: 18 },
  ingList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  ingPill: { backgroundColor: c.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: c.cardBorder },
  ingPillText: { color: c.textSub, fontSize: 11 },
  macrosRow: { flexDirection: "row", gap: 8 },
  macroBox: { flex: 1, backgroundColor: c.bg, borderRadius: 10, padding: 10, alignItems: "center" },
  macroVal: { fontSize: 15, fontWeight: "800" },
  macroLabel: { color: c.textMuted, fontSize: 10, marginTop: 2 },
  cardBtnsRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  anadirBtn: { backgroundColor: "#1F6FEB22", borderWidth: 1, borderColor: "#1F6FEB55", borderRadius: 10, padding: 12, alignItems: "center" },
  anadirBtnText: { color: "#58A6FF", fontSize: 14, fontWeight: "700" },
  reelBtn: { backgroundColor: "#7C3AED22", borderWidth: 1, borderColor: "#7C3AED55", borderRadius: 10, padding: 12, alignItems: "center", justifyContent: "center" },
  reelBtnText: { fontSize: 18 },
  modalHeader: { paddingTop: 16, paddingBottom: 8, gap: 4 },
  overlay: { flex: 1, backgroundColor: "#000000AA", justifyContent: "center", alignItems: "center", padding: 20 },
  popup: { backgroundColor: c.card, borderRadius: 24, padding: 24, width: "100%", borderWidth: 1, borderColor: c.cardBorder, gap: 16 },
  popupTitle: { color: c.text, fontSize: 18, fontWeight: "800" },
  popupSubtitle: { color: c.textMuted, fontSize: 13 },
  mealSelector: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mealChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder },
  mealChipActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
  mealChipIcon: { fontSize: 14 },
  mealChipText: { color: c.textMuted, fontSize: 13, fontWeight: "600" },
  mealChipTextActive: { color: "#58A6FF" },
  popupBtns: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: c.cardBorder, borderRadius: 12, padding: 14, alignItems: "center" },
  cancelText: { color: c.textSub, fontWeight: "700", fontSize: 15 },
  confirmBtn: { flex: 1, backgroundColor: "#1F6FEB", borderRadius: 12, padding: 14, alignItems: "center" },
  confirmText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  gramosInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 10, color: c.text, fontSize: 15, width: 70, textAlign: "center" },
}); }