import { BottomTabBar, TAB_BAR_HEIGHT } from "@/app/services/BottomTabBar";
import { ALIMENTOS_BASICOS } from "@/app/services/alimentosBasicos";
import { AnadirRecetaModal, MealKey, MEAL_ICONS } from "@/app/services/AnadirRecetaModal";
export { AnadirRecetaModal };
export type { MealKey };
import { ModalDetalle } from "./comunidad";
import { guardarRecetaEnCloud, loadRecetasGuardadasFromCloud, quitarRecetaDeCloud, syncDayToCloud } from "@/app/services/cloudSync";
import { useApp } from "@/app/services/i18n";
import { traducirPublicaciones, type PubTraducida } from "@/app/services/translator";
import { signalMealSaved } from "@/app/services/refreshSignal";
import { buscarDesdeEscaneo } from "@/app/services/openFoodFacts";
import { detectarPaisUsuario } from "@/app/services/countryDetector";
import {
  buscarAlimentosPersonalizados,
  crearReceta,
  actualizarReceta,
  eliminarReceta,
  marcarPublicacionEliminada,
  guardarPorcion,
  guardarPorcionPorNombre,
  obtenerPorcionesPorNombre,
  IngredienteReceta,
  obtenerRecetas,
  Receta,
  supabase,
} from "@/app/services/supabase";
import { useAvatar } from "@/app/services/useAvatar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
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
export function safeNum(val: any): number {
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
const COMUNIDAD_CACHE_KEY = "nutri_comunidad_recetas_v1";

type RecetaGuardada = {
  pub_id: string;
  reel_id?: string;
  video_url?: string;
  nombre: string;
  descripcion: string;
  ingredientes: any[];
  calorias_total: number;
  proteinas_total: number;
  grasas_total: number;
  carbohidratos_total: number;
  autor: string;
  savedAt: number;
  eliminado?: boolean;
};


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


export type AlimentoBuscado = {
  nombre: string; supermercado: string; marca: string;
  calorias: number; proteinas: number; grasas: number; carbohidratos: number;
  esPersonalizado?: boolean;
  porciones?: Array<{ nombre: string; gramos: number }>;
  alimentoId?: string;
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
    if (!stored) return [];
    const parsed: any[] = JSON.parse(stored);
    return parsed.map(f => ({ ...normalizarAlimentoBuscado(f), savedAt: f.savedAt }));
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

function normalizarAlimentoBuscado(f: any): AlimentoBuscado {
  // add-food.tsx stores with nested `nutrientes`; BuscadorIngrediente expects flat fields
  const n = f.nutrientes;
  return {
    nombre: f.nombre ?? "",
    supermercado: f.supermercado ?? "Desconocido",
    marca: f.marca ?? "Sin marca",
    calorias: safeNum(n ? n.calorias : f.calorias),
    proteinas: safeNum(n ? n.proteinas : f.proteinas),
    grasas: safeNum(n ? n.grasas : f.grasas),
    carbohidratos: safeNum(n ? n.carbohidratos : f.carbohidratos),
    esPersonalizado: f.esPersonalizado ?? false,
    porciones: Array.isArray(f.porciones) ? f.porciones : undefined,
    alimentoId: f.alimentoId,
  };
}

async function cargarRecientes(): Promise<RecentFood[]> {
  try {
    const stored = await AsyncStorage.getItem(RECENT_FOODS_KEY);
    if (!stored) return [];
    const parsed: any[] = JSON.parse(stored);
    return parsed.map(f => ({ ...normalizarAlimentoBuscado(f), addedAt: f.addedAt }));
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

// ─── Skeleton loaders ─────────────────────────────────────────────────────────
function SkeletonFoodItem({ colors }: { colors: any }) {
  const bg = colors.cardBorder + "66";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12,
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder + "44" }}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: bg }} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ height: 13, backgroundColor: bg, borderRadius: 5, width: "65%" }} />
        <View style={{ height: 10, backgroundColor: bg, borderRadius: 4, width: "40%" }} />
      </View>
    </View>
  );
}

function SkeletonRecetaCard({ colors }: { colors: any }) {
  const bg = colors.cardBorder + "66";
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 16, marginBottom: 10,
      borderWidth: 1, borderColor: colors.cardBorder, padding: 14, gap: 10 }}>
      <View style={{ height: 14, backgroundColor: bg, borderRadius: 5, width: "60%" }} />
      <View style={{ height: 11, backgroundColor: bg, borderRadius: 4, width: "35%" }} />
      <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
        {[0,1,2,3].map(i => (
          <View key={i} style={{ flex: 1, height: 34, backgroundColor: bg, borderRadius: 8 }} />
        ))}
      </View>
    </View>
  );
}

export function BuscadorIngrediente({
  onSelect, onScanear, onClose, scannedCode,
}: {
  onSelect: (alimento: AlimentoBuscado, gramos: number) => void;
  onScanear: () => void;
  onClose: () => void;
  scannedCode?: string | null;
}) {
  const { colors: bColors, t } = useApp();
  const b = useMemo(() => makeBStyles(bColors), [bColors]);
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
  const [chipKey, setChipKey] = useState<string | null>(null);
  const [porcionesLocales, setPorcionesLocales] = useState<Array<{ nombre: string; gramos: number }>>([]);
  const [currentAlimentoId, setCurrentAlimentoId] = useState<string | null>(null);
  const [mostrarAnadirPorcion, setMostrarAnadirPorcion] = useState(false);
  const [nuevaPorNombre, setNuevaPorNombre] = useState("");
  const [nuevaPorGramos, setNuevaPorGramos] = useState("");
  const [guardandoPorcion, setGuardandoPorcion] = useState(false);

  useEffect(() => {
    cargarRecientes().then(setRecientes);
    cargarFavoritos().then(setFavoritos);
  }, []);

  // Auto-selects a scanned barcode product when provided
  useEffect(() => {
    if (!scannedCode) return;
    buscarDesdeEscaneo(scannedCode).then((prod) => {
      if (!prod) return;
      const ali: AlimentoBuscado = {
        nombre: prod.nombre,
        supermercado: prod.supermercado || "Escaneado",
        marca: prod.marca || "",
        calorias: safeNum(prod.nutrientes.calorias),
        proteinas: safeNum(prod.nutrientes.proteinas),
        grasas: safeNum(prod.nutrientes.grasas),
        carbohidratos: safeNum(prod.nutrientes.carbohidratos),
        esPersonalizado: false,
      };
      setBusqueda(prod.nombre);
      setResultados([ali]);
      setSeleccionado(ali);
    }).catch(() => {});
  }, [scannedCode]);

  useEffect(() => {
    if (!seleccionado) return;
    setChipKey(null);
    setMostrarAnadirPorcion(false);
    setNuevaPorNombre("");
    setNuevaPorGramos("");
    if (seleccionado.alimentoId) {
      setPorcionesLocales(seleccionado.porciones || []);
      setCurrentAlimentoId(seleccionado.alimentoId);
    } else {
      // Alimento básico u OpenFoodFacts: buscar si ya tiene porciones en la BD
      setPorcionesLocales([]);
      setCurrentAlimentoId(null);
      obtenerPorcionesPorNombre(seleccionado.nombre).then((res) => {
        if (res) {
          setPorcionesLocales(res.porciones);
          setCurrentAlimentoId(res.id);
        }
      });
    }
  }, [seleccionado]);

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
    setChipKey(null);
    setPorcionesLocales([]);
    setCurrentAlimentoId(null);
    setMostrarAnadirPorcion(false);
    setNuevaPorNombre("");
    setNuevaPorGramos("");
  };

  const handleGuardarPorcion = async () => {
    if (!seleccionado || !nuevaPorNombre.trim() || !nuevaPorGramos) return;
    const g = Number(nuevaPorGramos);
    if (!g) return;
    setGuardandoPorcion(true);
    const nuevas = [...porcionesLocales, { nombre: nuevaPorNombre.trim(), gramos: g }];
    let exito = false;
    if (currentAlimentoId) {
      exito = await guardarPorcion(currentAlimentoId, nuevas);
    } else {
      const newId = await guardarPorcionPorNombre(seleccionado, nuevas);
      if (newId) { setCurrentAlimentoId(newId); exito = true; }
    }
    if (exito) {
      setPorcionesLocales(nuevas);
      setGramos(String(g));
      setChipKey(`por_${nuevas.length - 1}`);
      setMostrarAnadirPorcion(false);
      setNuevaPorNombre("");
      setNuevaPorGramos("");
    }
    setGuardandoPorcion(false);
  };

  const buscar = (texto: string) => {
    setBusqueda(texto);
    setSeleccionado(null);
    currentSearch.current = texto;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!texto.trim()) { setResultados([]); setCargando(false); return; }
    const locales = ALIMENTOS_BASICOS.filter((a) => a.nombre.toLowerCase().includes(texto.toLowerCase()));
    // Solo reemplaza si hay locales; si no, mantiene resultados anteriores visibles
    if (locales.length > 0) setResultados(locales);
    if (cacheRef.current[texto]) { setResultados(cacheRef.current[texto]); return; }
    // D1 se lanza de inmediato (sin debounce) para mostrar resultados mientras escribe
    buscarAlimentosPersonalizados(texto, detectarPaisUsuario()).then((pers) => {
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
        porciones: Array.isArray(p.porciones) ? p.porciones : [],
        alimentoId: p.id,
      }));
      if (conv.length > 0) {
        setResultados((prev) => {
          const nuevos = conv.filter((c) => !prev.some((p) => p.nombre.toLowerCase() === c.nombre.toLowerCase()));
          const merged = [...nuevos, ...prev];
          cacheRef.current[texto] = merged;
          return merged;
        });
      }
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
        // Filtrar productos OFF sin datos nutricionales (evita 0s)
        const remotosConDatos = remotos.filter(r => r.calorias > 0 || r.proteinas > 0 || r.grasas > 0 || r.carbohidratos > 0);
        const todosBase: AlimentoBuscado[] = [...localesFinal];
        for (const r of remotosConDatos) {
          if (!todosBase.some((t) => t.nombre.toLowerCase() === r.nombre.toLowerCase())) todosBase.push(r);
        }
        if (currentSearch.current === texto) {
          setResultados(prev => {
            // Conservar resultados de D1 que ya llegaron antes (no sobreescribir)
            const extras = prev.filter(p => !todosBase.some(t => t.nombre.toLowerCase() === p.nombre.toLowerCase()));
            const merged = [...todosBase, ...extras];
            cacheRef.current[texto] = merged;
            return merged;
          });
        }
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
              {prod.esPersonalizado && <View style={b.customBadge}><Text style={b.customBadgeText}>{t.customBadge}</Text></View>}
            </View>
            <View style={b.resultMeta}>
              <View style={[b.superBadge, { backgroundColor: sc + "22", borderColor: sc + "55" }]}>
                <Text style={[b.superBadgeText, { color: sc }]}>{prod.supermercado}</Text>
              </View>
              {prod.marca !== "Natural" && prod.marca !== "Sin marca" && <Text style={b.resultMarca}>{prod.marca}</Text>}
            </View>
            <Text style={b.resultMacros}>{t.proteins[0]} {safeNum(prod.proteinas).toFixed(1)}g · {t.carbs[0]} {safeNum(prod.carbohidratos).toFixed(1)}g · {t.fats[0]} {safeNum(prod.grasas).toFixed(1)}g</Text>
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
        <TouchableOpacity onPress={onClose}><Text style={b.close}>{t.close}</Text></TouchableOpacity>
        <Text style={b.title}>{t.addIngredient}</Text>
      </View>

      {/* Barra de búsqueda — el ✕ limpia TODO (texto + selección + gramos) */}
      <View style={b.searchBox}>
        <Text style={b.searchIcon}>🔍</Text>
        <TextInput
          style={b.searchInput}
          value={busqueda}
          onChangeText={buscar}
          placeholder={t.searchFood}
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
        <Text style={b.scanBtnText}>{t.barcodeScanner}</Text>
      </TouchableOpacity>

      {busqueda.length === 0 && !seleccionado && (
        <View style={b.historialWrap}>
          <View style={b.historialTabs}>
            <TouchableOpacity style={[b.historialTab, tabHistorial === "recientes" && b.historialTabActive]} onPress={() => setTabHistorial("recientes")}>
              <Text style={[b.historialTabText, tabHistorial === "recientes" && b.historialTabTextActive]}>{t.recentFoods}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[b.historialTab, tabHistorial === "favoritos" && b.historialTabActive]} onPress={() => setTabHistorial("favoritos")}>
              <Text style={[b.historialTabText, tabHistorial === "favoritos" && b.historialTabTextActive]}>{t.favorites}</Text>
            </TouchableOpacity>
          </View>
          {listaHistorial.length === 0 ? (
            <Text style={b.emptyHistorial}>{tabHistorial === "recientes" ? t.noRecentFoods : t.noFavorites}</Text>
          ) : (
            listaHistorial.map((food, i) => renderAlimentoItem(food, i))
          )}
        </View>
      )}

      {busqueda.length > 0 && !seleccionado && (
        <>
          {cargando && [0,1,2].map(i => <SkeletonFoodItem key={i} colors={bColors} />)}
          {resultados.map((prod, i) => renderAlimentoItem(prod, i))}
          {!cargando && resultados.length === 0 && <Text style={b.emptyHistorial}>{t.noResults} "{busqueda}"</Text>}
        </>
      )}

      {seleccionado && (
        <View style={b.selectedCard}>
          <TouchableOpacity onPress={() => { setSeleccionado(null); setGramos("100"); }}>
            <Text style={b.changeBtn}>{t.change}</Text>
          </TouchableOpacity>
          <Text style={b.selectedName}>{seleccionado.nombre}</Text>
          <View style={b.selectedMeta}>
            <View style={[b.superBadge, { backgroundColor: (SUPER_COLORS[seleccionado.supermercado] || "#4B5563") + "22", borderColor: (SUPER_COLORS[seleccionado.supermercado] || "#4B5563") + "55" }]}>
              <Text style={[b.superBadgeText, { color: SUPER_COLORS[seleccionado.supermercado] || "#4B5563" }]}>{seleccionado.supermercado}</Text>
            </View>
          </View>
          {/* Chips de porciones */}
          <View>
            <Text style={b.porcionesLabel}>{t.portions}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
              <View style={b.chipsRow}>
                <TouchableOpacity
                  style={[b.chip, chipKey === "100g" && b.chipActive]}
                  onPress={() => { setChipKey("100g"); setGramos("100"); }}
                >
                  <Text style={[b.chipText, chipKey === "100g" && b.chipTextActive]}>100g</Text>
                </TouchableOpacity>
                {porcionesLocales.map((por, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[b.chip, chipKey === `por_${i}` && b.chipActive]}
                    onPress={() => { setChipKey(`por_${i}`); setGramos(String(por.gramos)); }}
                  >
                    <Text style={[b.chipText, chipKey === `por_${i}` && b.chipTextActive]}>{por.nombre}</Text>
                    <Text style={[b.chipGrams, chipKey === `por_${i}` && { color: "#fff" }]}>{por.gramos}g</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={b.gramosRow}>
            <Text style={b.gramosLabel}>{t.grams}</Text>
            <TextInput
              style={b.gramosInput}
              value={gramos}
              onChangeText={(v) => { setGramos(v); setChipKey(null); }}
              keyboardType="numeric"
              selectTextOnFocus
            />
          </View>

          {!mostrarAnadirPorcion && (
            <TouchableOpacity onPress={() => setMostrarAnadirPorcion(true)}>
              <Text style={b.addPorcionBtn}>{t.addCustomPortion}</Text>
            </TouchableOpacity>
          )}
          {mostrarAnadirPorcion && (
            <View style={b.addPorcionForm}>
              <TextInput
                style={b.addPorcionInput}
                placeholder={t.portionNamePlaceholder}
                placeholderTextColor={bColors.textMuted}
                value={nuevaPorNombre}
                onChangeText={setNuevaPorNombre}
              />
              <TextInput
                style={b.addPorcionInput}
                placeholder={t.grams}
                placeholderTextColor={bColors.textMuted}
                value={nuevaPorGramos}
                onChangeText={setNuevaPorGramos}
                keyboardType="numeric"
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  style={b.addPorcionCancel}
                  onPress={() => { setMostrarAnadirPorcion(false); setNuevaPorNombre(""); setNuevaPorGramos(""); }}
                >
                  <Text style={b.addPorcionCancelText}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={b.addPorcionSave} onPress={handleGuardarPorcion} disabled={guardandoPorcion}>
                  <Text style={b.addPorcionSaveText}>{guardandoPorcion ? "..." : t.save}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={b.previewRow}>
            {[
              { key: "kcal", val: Math.round(safeNum(seleccionado.calorias) * (Number(gramos) || 0) / 100), label: "kcal", color: "#4ADE80" },
              { key: "prot", val: (safeNum(seleccionado.proteinas) * (Number(gramos) || 0) / 100).toFixed(1) + "g", label: t.proteins, color: "#60A5FA" },
              { key: "carbs", val: (safeNum(seleccionado.carbohidratos) * (Number(gramos) || 0) / 100).toFixed(1) + "g", label: t.carbs, color: "#FBBF24" },
              { key: "fats", val: (safeNum(seleccionado.grasas) * (Number(gramos) || 0) / 100).toFixed(1) + "g", label: t.fats, color: "#F87171" },
            ].map((item) => (
              <View key={item.key} style={b.previewBox}>
                <Text style={[b.previewVal, { color: item.color }]}>{item.val}</Text>
                <Text style={b.previewLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={b.confirmBtn} onPress={confirmar}>
            <Text style={b.confirmText}>{t.addToRecipe}</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

// ─── Modal reutilizable para añadir receta al día ─────────────────────────────
function _OldAnadirRecetaModal({
  receta, visible, onClose, onAdd, initialMeal, initialRaciones,
}: {
  receta: Receta | null;
  visible: boolean;
  onClose: () => void;
  onAdd: (kcal: number, prot: number, carb: number, gras: number, nombre: string, meal: MealKey, raciones: number) => Promise<void>;
  initialMeal?: MealKey;
  initialRaciones?: number;
}) {
  const { t, colors } = useApp();
  const MEAL_LABELS: Record<MealKey, string> = { desayuno: t.breakfast, snack1: t.snack1Label, comida: t.lunch, merienda: t.snack, cena: t.dinner, snack2: t.snack2Label };
  const [racionesBase, setRacionesBase] = useState(1);
  const [racionesAnadir, setRacionesAnadir] = useState(1);
  const [ingModifs, setIngModifs] = useState<{ gramos: number; pinned: boolean }[]>([]);
  const [ingEditandoIdx, setIngEditandoIdx] = useState<number | null>(null);
  const [ingEditandoGramos, setIngEditandoGramos] = useState("");
  const [mealSel, setMealSel] = useState<MealKey>(initialMeal ?? "comida");

  useEffect(() => {
    if (visible) setMealSel(initialMeal ?? "comida");
  }, [visible]);

  useEffect(() => {
    if (!receta) { setIngModifs([]); setIngEditandoIdx(null); return; }
    AsyncStorage.getItem("nutri_recetas_raciones").then(v => {
      let map: Record<string, number> = {};
      try { if (v) map = JSON.parse(v); } catch {}
      const rBase = map[receta.nombre] ?? receta.raciones ?? 1;
      const rInit = initialRaciones != null ? initialRaciones : rBase;
      const factor = rBase > 0 ? rInit / rBase : 1;
      setRacionesBase(rBase);
      setRacionesAnadir(rInit);
      setIngModifs((receta.ingredientes ?? []).map(ing => ({ gramos: Math.round(ing.gramos * factor), pinned: false })));
      setIngEditandoIdx(null);
    });
  }, [receta?.nombre, initialRaciones]);

  const parsearCantidad = (s: string): number => {
    const n = Number(s.replace(",", "."));
    return isNaN(n) || n <= 0 ? 0 : n;
  };

  const cambiarRaciones = (delta: number) => {
    if (!receta) return;
    const nuevo = Math.max(0.25, Math.round((racionesAnadir + delta) * 4) / 4);
    setRacionesAnadir(nuevo);
    const factor = nuevo / racionesBase;
    setIngModifs(prev =>
      (receta.ingredientes ?? []).map((ing, i) => ({
        gramos: prev[i]?.pinned ? prev[i].gramos : Math.round(ing.gramos * factor),
        pinned: prev[i]?.pinned ?? false,
      }))
    );
  };

  const confirmarGramos = (idx: number) => {
    const g = Math.max(1, Math.round(parsearCantidad(ingEditandoGramos) || 1));
    setIngModifs(prev => prev.map((m, i) => i === idx ? { gramos: g, pinned: true } : m));
    setIngEditandoIdx(null);
  };

  const desanclar = (idx: number) => {
    if (!receta) return;
    const factor = racionesAnadir / racionesBase;
    const gramosBase = receta.ingredientes[idx]?.gramos ?? 0;
    setIngModifs(prev => prev.map((m, i) => i === idx ? { gramos: Math.round(gramosBase * factor), pinned: false } : m));
  };

  if (!receta) return null;

  const estaModif = ingModifs.some(m => m.pinned);
  const totalesModif = (receta.ingredientes ?? []).reduce((acc, ing, i) => {
    const g = ingModifs[i]?.gramos ?? ing.gramos;
    const f = ing.gramos > 0 ? g / ing.gramos : 0;
    return { kcal: acc.kcal + safeNum(ing.calorias)*f, prot: acc.prot + safeNum(ing.proteinas)*f, carb: acc.carb + safeNum(ing.carbs)*f, gras: acc.gras + safeNum(ing.grasas)*f };
  }, { kcal: 0, prot: 0, carb: 0, gras: 0 });

  const handleAdd = async (useModified: boolean) => {
    const suffix = racionesAnadir !== racionesBase
      ? ` (×${racionesAnadir % 1 === 0 ? racionesAnadir : racionesAnadir.toFixed(2).replace(/\.?0+$/, "")})`
      : "";
    let kcal: number, prot: number, carb: number, gras: number;
    if (useModified) {
      // Usa los gramos actuales (modificados o escalados) de ingModifs
      kcal = Math.round(totalesModif.kcal);
      prot = Number(totalesModif.prot.toFixed(1));
      carb = Number(totalesModif.carb.toFixed(1));
      gras = Number(totalesModif.gras.toFixed(1));
    } else {
      // Receta original: suma de ingredientes escalada por raciones (sin pines)
      const factor = racionesAnadir / racionesBase;
      const orig = (receta.ingredientes ?? []).reduce((acc, ing) => ({
        kcal: acc.kcal + safeNum(ing.calorias) * factor,
        prot: acc.prot + safeNum(ing.proteinas) * factor,
        carb: acc.carb + safeNum(ing.carbs) * factor,
        gras: acc.gras + safeNum(ing.grasas) * factor,
      }), { kcal: 0, prot: 0, carb: 0, gras: 0 });
      kcal = Math.round(orig.kcal);
      prot = Number(orig.prot.toFixed(1));
      carb = Number(orig.carb.toFixed(1));
      gras = Number(orig.gras.toFixed(1));
    }
    await onAdd(kcal, prot, carb, gras, receta.nombre + suffix, mealSel, racionesAnadir);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { setIngEditandoIdx(null); onClose(); }}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000AA", justifyContent: "center", alignItems: "center", padding: 20 }}
        activeOpacity={1} onPress={() => { setIngEditandoIdx(null); onClose(); }}>
        <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.card, borderRadius: 24, width: "100%", maxHeight: "90%", borderWidth: 1, borderColor: colors.cardBorder, overflow: "hidden" }}>
          {/* Cabecera + selector de raciones */}
          <View style={{ padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800", flex: 1 }} numberOfLines={2}>{receta.nombre}</Text>
              {estaModif && (
                <View style={{ backgroundColor: "#F59E0B22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#F59E0B55" }}>
                  <Text style={{ color: "#F59E0B", fontSize: 10, fontWeight: "700" }}>MODIFICADA</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
              <Text style={{ color: colors.textSub, fontSize: 13 }}>{t.servingsToAdd ?? "Raciones"}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <TouchableOpacity onPress={() => cambiarRaciones(-0.5)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: colors.text, fontSize: 18 }}>−</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, minWidth: 32, textAlign: "center" }}>
                  {racionesAnadir % 1 === 0 ? racionesAnadir : racionesAnadir.toFixed(2).replace(/\.?0+$/, "")}
                </Text>
                <TouchableOpacity onPress={() => cambiarRaciones(0.5)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontSize: 18 }}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Lista de ingredientes */}
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
            <View style={{ padding: 14, gap: 6 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Ingredientes</Text>
              {(receta.ingredientes ?? []).map((ing, i) => {
                const modif = ingModifs[i];
                const gramosActuales = modif?.gramos ?? ing.gramos;
                const isPinned = modif?.pinned ?? false;
                const isEditing = ingEditandoIdx === i;
                const macroIng = ing.gramos > 0 ? { kcal: Math.round(safeNum(ing.calorias) * gramosActuales / ing.gramos) } : { kcal: 0 };
                return (
                  <View key={i} style={{ backgroundColor: isPinned ? "#F59E0B11" : colors.bg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: isPinned ? "#F59E0B44" : colors.cardBorder }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 }} numberOfLines={1}>{ing.nombre}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {isPinned && (
                          <TouchableOpacity onPress={() => desanclar(i)} style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "#F59E0B22", borderRadius: 6 }}>
                            <Text style={{ color: "#F59E0B", fontSize: 10, fontWeight: "700" }}>✕ fijado</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => { setIngEditandoIdx(i); setIngEditandoGramos(String(gramosActuales)); }}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.inputBg, borderRadius: 8, borderWidth: 1, borderColor: isEditing ? "#1F6FEB" : colors.cardBorder }}>
                          <Text style={{ color: isEditing ? "#58A6FF" : colors.textSub, fontSize: 13, fontWeight: "700" }}>{gramosActuales}{ing.unidad ?? "g"}</Text>
                        </TouchableOpacity>
                        <Text style={{ color: colors.textMuted, fontSize: 11 }}>{macroIng.kcal}kcal</Text>
                      </View>
                    </View>
                    {isEditing && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <TextInput
                          style={{ flex: 1, backgroundColor: colors.card, borderRadius: 8, borderWidth: 1.5, borderColor: "#1F6FEB", color: colors.text, fontSize: 16, fontWeight: "700", padding: 8, textAlign: "center" }}
                          value={ingEditandoGramos} onChangeText={setIngEditandoGramos}
                          keyboardType="decimal-pad" selectTextOnFocus autoFocus
                          onSubmitEditing={() => confirmarGramos(i)}
                        />
                        <Text style={{ color: colors.textMuted, fontSize: 13 }}>{ing.unidad ?? "g"}</Text>
                        <TouchableOpacity onPress={() => confirmarGramos(i)} style={{ backgroundColor: "#1F6FEB", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>OK</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Totales en tiempo real */}
          <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.cardBorder }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[
                { val: Math.round(totalesModif.kcal), label: "kcal", color: "#4ADE80" },
                { val: totalesModif.prot.toFixed(1) + "g", label: t.proteins, color: "#60A5FA" },
                { val: totalesModif.carb.toFixed(1) + "g", label: t.carbs, color: "#FBBF24" },
                { val: totalesModif.gras.toFixed(1) + "g", label: t.fats, color: "#F87171" },
              ].map(item => (
                <View key={item.label} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 8, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder }}>
                  <Text style={{ color: item.color, fontSize: 13, fontWeight: "800" }}>{item.val}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 9, marginTop: 1 }}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Selector de comida */}
          <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
            <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{t.whichMealToAdd}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(["desayuno", "comida", "merienda", "cena"] as MealKey[]).map(m => (
                <TouchableOpacity key={m}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: mealSel === m ? "#1F6FEB22" : colors.bg, borderWidth: 1, borderColor: mealSel === m ? "#58A6FF" : colors.cardBorder }}
                  onPress={() => setMealSel(m)}>
                  <Text style={{ fontSize: 14 }}>{MEAL_ICONS[m]}</Text>
                  <Text style={{ color: mealSel === m ? "#58A6FF" : colors.textMuted, fontSize: 13, fontWeight: "700" }}>{MEAL_LABELS[m]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Botones */}
          {estaModif ? (
            <View style={{ gap: 8, paddingHorizontal: 14, paddingBottom: 16 }}>
              <View style={{ backgroundColor: "#FBBF2422", borderRadius: 10, borderWidth: 1, borderColor: "#FBBF2444", paddingVertical: 7, paddingHorizontal: 12 }}>
                <Text style={{ color: "#FBBF24", fontSize: 12, fontWeight: "600", textAlign: "center" }}>Has modificado ingredientes. ¿Qué versión añadir?</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 12, alignItems: "center" }} onPress={() => handleAdd(false)}>
                  <Text style={{ color: colors.textSub, fontWeight: "700", fontSize: 13 }}>Original</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, backgroundColor: "#1F6FEB", borderRadius: 12, padding: 12, alignItems: "center" }} onPress={() => handleAdd(true)}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Modificada ✓</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={{ backgroundColor: colors.inputBg, borderRadius: 12, padding: 12, alignItems: "center" }} onPress={onClose}>
                <Text style={{ color: colors.textMuted, fontWeight: "600", fontSize: 14 }}>{t.cancel}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingBottom: 16 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 14, alignItems: "center" }} onPress={onClose}>
                <Text style={{ color: colors.textSub, fontWeight: "700", fontSize: 15 }}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: "#1F6FEB", borderRadius: 12, padding: 14, alignItems: "center" }} onPress={() => handleAdd(false)}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{t.add}</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function RecetasScreen() {
  const { colors, theme, t, language } = useApp();
  const MEAL_LABELS: Record<MealKey, string> = { desayuno: t.breakfast, snack1: t.snack1Label, comida: t.lunch, merienda: t.snack, cena: t.dinner, snack2: t.snack2Label };
  const s = useMemo(() => makeSStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ scannedCode?: string; scannedForReceta?: string; openCreate?: string; from?: string }>();
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busquedaReceta, setBusquedaReceta] = useState("");
  const [modalAnadir, setModalAnadir] = useState<Receta | null>(null);
  const [modalAnadirGuardada, setModalAnadirGuardada] = useState<RecetaGuardada | null>(null);
  const [mealSeleccionada, setMealSeleccionada] = useState<MealKey>("comida");
  const [modalCrear, setModalCrear] = useState(false);
  const [mostrarBuscador, setMostrarBuscador] = useState(false);
  const [scannedIngCode, setScannedIngCode] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [ingredientes, setIngredientes] = useState<IngredienteReceta[]>([]);
  const [guardandoReceta, setGuardandoReceta] = useState(false);
  const [recetaEditando, setRecetaEditando] = useState<Receta | null>(null);
  const [confirmarBorrar, setConfirmarBorrar] = useState<Receta | null>(null);
  const [confirmarBorrarGuardada, setConfirmarBorrarGuardada] = useState<RecetaGuardada | null>(null);
  const [videoReelAbierto, setVideoReelAbierto] = useState<RecetaGuardada | null>(null);
  const [tab, setTab] = useState<"recientes" | "valoradas">("recientes");
  const [busquedaComunidad, setBusquedaComunidad] = useState("");
  const [modalDetallePub, setModalDetallePub] = useState<any | null>(null);
  const [comunidadRecetas, setComunidadRecetas] = useState<any[]>([]);
  const [cargandoComunidad, setCargandoComunidad] = useState(false);
  const [recetasGuardadas, setRecetasGuardadas] = useState<RecetaGuardada[]>([]);
  const [actualizadosIds, setActualizadosIds] = useState<Set<string>>(new Set());
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [publicandoId, setPublicandoId] = useState("");
  const avatarUri = useAvatar();
  const comunidadMountedRef = useRef(false);
  const [racionesMap, setRacionesMap] = useState<Record<string, number>>({});
  const [raciones, setRaciones] = useState(1);

  const guardadasSet = useMemo(() => new Set(recetasGuardadas.map(r => r.pub_id)), [recetasGuardadas]);

  // Traducciones de las publicaciones de la comunidad
  const [tradPubs, setTradPubs] = useState<Map<string, PubTraducida>>(new Map());
  const tPub = (pub: any): PubTraducida => tradPubs.get(pub.id) ?? {
    nombre: pub.nombre_receta, descripcion: pub.descripcion ?? "", ingredientes: (pub.ingredientes ?? []).map((i: any) => i.nombre),
  };

  const comunidadFiltrada = useMemo(() => {
    if (!busquedaComunidad.trim()) return comunidadRecetas;
    const q = busquedaComunidad.toLowerCase();
    return comunidadRecetas.filter(p =>
      (p.nombre_receta ?? "").toLowerCase().includes(q) ||
      (p.autor ?? "").toLowerCase().includes(q)
    );
  }, [comunidadRecetas, busquedaComunidad]);

  const cargarComunidad = async (orden: "recientes" | "valoradas", uidOverride?: string) => {
    setCargandoComunidad(true);
    try {
      let uid = uidOverride;
      if (uid === undefined) {
        const { data: sesData } = await supabase.auth.getSession();
        uid = sesData.session?.user?.id ?? "";
      }
      const filtrar = (lista: any[]) => uid ? lista.filter((p: any) => p.autor_id !== uid) : lista;

      const column = orden === "valoradas" ? "likes" : "creado_en";
      const { data, error } = await supabase
        .from("publicaciones_recetas")
        .select("*")
        .order(column, { ascending: false })
        .limit(40);
      let result: any[];
      if (error && orden === "valoradas") {
        const { data: fallback } = await supabase
          .from("publicaciones_recetas")
          .select("*")
          .order("creado_en", { ascending: false })
          .limit(40);
        result = filtrar(fallback ?? []);
      } else {
        result = filtrar(data ?? []);
      }
      setComunidadRecetas(result);
      if (orden === "recientes") {
        AsyncStorage.setItem(COMUNIDAD_CACHE_KEY, JSON.stringify(result)).catch(() => {});
      }
    } catch {
      setComunidadRecetas([]);
    } finally {
      setCargandoComunidad(false);
    }
  };

  const guardarComunidad = async (pub: any) => {
    if (guardadasSet.has(pub.id)) { await quitarGuardada(pub.id); return; }
    const nueva: RecetaGuardada = {
      pub_id: pub.id, nombre: pub.nombre_receta, descripcion: pub.descripcion ?? "",
      ingredientes: pub.ingredientes ?? [], calorias_total: pub.calorias_total ?? 0,
      proteinas_total: pub.proteinas_total ?? 0, grasas_total: pub.grasas_total ?? 0,
      carbohidratos_total: pub.carbohidratos_total ?? 0, autor: pub.autor, savedAt: Date.now(),
    };
    const raw = await AsyncStorage.getItem(SAVED_COMMUNITY_KEY);
    const lista: RecetaGuardada[] = raw ? JSON.parse(raw) : [];
    const actualizada = [...lista, nueva];
    await AsyncStorage.setItem(SAVED_COMMUNITY_KEY, JSON.stringify(actualizada));
    setRecetasGuardadas(actualizada);
    guardarRecetaEnCloud(nueva.pub_id, nueva);
  };

  useFocusEffect(React.useCallback(() => {
    (async () => {
      // 1. Mostrar caché de comunidad inmediatamente (sin esperar red)
      try {
        const cached = await AsyncStorage.getItem(COMUNIDAD_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.length) setComunidadRecetas(parsed);
        }
      } catch {}

      // 2. Cargar raciones del mapa desde AsyncStorage
      AsyncStorage.getItem("nutri_recetas_raciones").then(v => { try { if (v) setRacionesMap(JSON.parse(v)); } catch {} });

      // 3. Cargar recetas guardadas localmente de forma inmediata
      let listaGuardadas: RecetaGuardada[] = [];
      try {
        const raw = await AsyncStorage.getItem(SAVED_COMMUNITY_KEY);
        listaGuardadas = raw ? JSON.parse(raw) : [];
      } catch {}
      setRecetasGuardadas(listaGuardadas);

      // 4. Obtener sesión una sola vez para todas las operaciones
      const { data: sesData } = await supabase.auth.getSession();
      const uid = sesData.session?.user?.id ?? "";

      // 5. Ejecutar en paralelo: recetas propias, comunidad y perfil
      const [, , cloudLista] = await Promise.all([
        cargarRecetasList(),
        cargarComunidad("recientes", uid),
        loadRecetasGuardadasFromCloud(),
        uid
          ? supabase.from("perfiles").select("nombre").eq("id", uid).single()
              .then(({ data: p }) => { if (p?.nombre) setNombreUsuario(p.nombre); })
          : Promise.resolve(),
      ]);

      // 6. Fusionar guardadas locales con cloud
      if (cloudLista !== null) {
        const localIds = new Set(listaGuardadas.map(r => r.pub_id));
        const merged = [...listaGuardadas];
        for (const cr of cloudLista) {
          if (!localIds.has(cr.pub_id)) merged.push(cr);
        }
        setRecetasGuardadas(merged);
        await AsyncStorage.setItem(SAVED_COMMUNITY_KEY, JSON.stringify(merged));
        listaGuardadas = merged;
      }

      // 7. Detectar recetas actualizadas o eliminadas por el autor
      if (listaGuardadas.length === 0) return;
      try {
        const ids = listaGuardadas.map(r => r.pub_id);
        const { data } = await supabase
          .from("publicaciones_recetas")
          .select("id, editado_en, eliminado")
          .in("id", ids);
        if (!data) return;
        const updated = new Set<string>();
        const eliminadosIds = new Set<string>();
        data.forEach((pub: any) => {
          if (pub.eliminado) { eliminadosIds.add(pub.id); return; }
          if (!pub.editado_en) return;
          const guardada = listaGuardadas.find(r => r.pub_id === pub.id);
          if (guardada && new Date(pub.editado_en).getTime() > guardada.savedAt) updated.add(pub.id);
        });
        setActualizadosIds(updated);
        if (eliminadosIds.size > 0) {
          setRecetasGuardadas(prev => prev.map(r => eliminadosIds.has(r.pub_id) ? { ...r, eliminado: true } : r));
        }
      } catch {}
    })();
  }, []));

  useEffect(() => {
    if (!comunidadMountedRef.current) { comunidadMountedRef.current = true; return; }
    cargarComunidad(tab);
  }, [tab]);

  // Cargar traducciones: primero desde la BD (pre-generadas), luego cliente como fallback
  useEffect(() => {
    if (language === "es" || comunidadRecetas.length === 0) { setTradPubs(new Map()); return; }
    const pub_ids = comunidadRecetas.map(p => p.id).filter(Boolean);
    supabase
      .from("traducciones_recetas")
      .select("pub_id, nombre, descripcion, ingredientes")
      .in("pub_id", pub_ids)
      .eq("lang", language)
      .then(({ data }) => {
        const map = new Map<string, PubTraducida>();
        (data ?? []).forEach((tr: any) => {
          const pub = comunidadRecetas.find(p => p.id === tr.pub_id);
          if (!pub) return;
          map.set(tr.pub_id, {
            nombre: tr.nombre || pub.nombre_receta,
            descripcion: tr.descripcion || pub.descripcion || "",
            ingredientes: Array.isArray(tr.ingredientes) && tr.ingredientes.length
              ? tr.ingredientes
              : (pub.ingredientes ?? []).map((i: any) => i.nombre),
          });
        });
        // Recetas sin traducción previa → fallback cliente
        const sinTraducir = comunidadRecetas.filter(p => !map.has(p.id));
        if (sinTraducir.length > 0) {
          traducirPublicaciones(sinTraducir, language).then(extra => {
            extra.forEach((v, k) => map.set(k, v));
            setTradPubs(new Map(map));
          });
        } else {
          setTradPubs(new Map(map));
        }
      });
  }, [comunidadRecetas, language]);

  // Realtime: actualizar recetas guardadas entre dispositivos
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      channel = supabase.channel(`recetas-guardadas-${uid}`)
        .on('postgres_changes' as any, {
          event: '*', schema: 'public', table: 'recetas_guardadas',
          filter: `user_id=eq.${uid}`,
        }, async () => {
          const cloudLista = await loadRecetasGuardadasFromCloud();
          if (cloudLista !== null) {
            setRecetasGuardadas(cloudLista);
            AsyncStorage.setItem(SAVED_COMMUNITY_KEY, JSON.stringify(cloudLista));
          }
        })
        .subscribe();
    });
    return () => { if (channel) supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params.scannedCode && params.scannedForReceta === "1") {
      setScannedIngCode(params.scannedCode);
      setModalCrear(true);
      setMostrarBuscador(true);
    }
  }, [params.scannedCode]);

  useEffect(() => {
    if (params.openCreate === "1") {
      setModalCrear(true);
    }
  }, [params.openCreate]);

  const cargarRecetasList = async () => {
    // Only show spinner on first load (no existing data)
    if (recetas.length === 0) setCargando(true);
    try {
      const data = await obtenerRecetas();
      setRecetas(data);
    } catch {
      setRecetas([]);
    } finally {
      setCargando(false);
    }
  };

  const publicarReceta = async (receta: Receta) => {
    setPublicandoId(receta.id ?? "");
    // Always get fresh session so name and uid are never stale
    const { data: ses } = await supabase.auth.getSession();
    const uid = ses.session?.user?.id;
    if (!uid) { setPublicandoId(""); Alert.alert("", t.loginToPublish); return; }
    const autor = (await supabase.from("perfiles").select("nombre").eq("id", uid).single()).data?.nombre || nombreUsuario;
    if (!autor) { setPublicandoId(""); Alert.alert("", t.loginToPublish); return; }
    // Check BOTH tables — one publication per recipe across all sections
    const [{ data: enComunidad }, { data: enReels }] = await Promise.all([
      supabase.from("publicaciones_recetas").select("id").eq("autor", autor).eq("nombre_receta", receta.nombre).limit(1),
      supabase.from("videos_recetas").select("id").eq("autor_id", uid).eq("titulo", receta.nombre).limit(1),
    ]);
    if ((enComunidad?.length ?? 0) > 0 || (enReels?.length ?? 0) > 0) {
      setPublicandoId("");
      Alert.alert(t.recipeAlreadyPublished, t.canOnlyPublishOnce);
      return;
    }
    const { data: pubData, error } = await supabase.from("publicaciones_recetas").insert([{
      nombre_receta: receta.nombre,
      descripcion: receta.descripcion || "",
      ingredientes: receta.ingredientes || [],
      calorias_total: safeNum(receta.calorias_total),
      proteinas_total: safeNum(receta.proteinas_total),
      grasas_total: safeNum(receta.grasas_total),
      carbohidratos_total: safeNum(receta.carbohidratos_total),
      autor,
      autor_avatar: avatarUri || null,
    }]).select("id").single();
    setPublicandoId("");
    if (error) { Alert.alert(t.error, t.couldNotPublish); return; }
    // Traducir a todos los idiomas en background (fire-and-forget)
    if (pubData?.id) {
      fetch("/api/translate-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pub_id: pubData.id }),
      }).catch(() => {});
    }
    Alert.alert(t.published, `"${receta.nombre}" ${t.recipeNowVisible}`);
  };

  const cargarIngredientePorCodigo = async (codigo: string) => {
    try {
      const prod = await buscarDesdeEscaneo(codigo);
      if (!prod) { Alert.alert(t.notFound, t.productNotFound); return; }
      setIngredientes((prev) => [...prev, {
        nombre: prod.nombre,
        gramos: 100,
        calorias: Math.round(safeNum(prod.nutrientes.calorias)),
        proteinas: Number(safeNum(prod.nutrientes.proteinas).toFixed(1)),
        carbs: Number(safeNum(prod.nutrientes.carbohidratos).toFixed(1)),
        grasas: Number(safeNum(prod.nutrientes.grasas).toFixed(1)),
      }]);
    } catch { Alert.alert(t.error, t.couldNotLoadProduct); }
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
      unidad: "g",
      calorias: Math.round(safeNum(alimento.calorias) * factor),
      proteinas: Number((safeNum(alimento.proteinas) * factor).toFixed(1)),
      carbs: Number((safeNum(alimento.carbohidratos) * factor).toFixed(1)),
      grasas: Number((safeNum(alimento.grasas) * factor).toFixed(1)),
    }]);
    setMostrarBuscador(false);
  };

  const quitarIngrediente = (i: number) => setIngredientes((prev) => prev.filter((_, idx) => idx !== i));

  const guardarReceta = async () => {
    if (!nombre.trim()) { Alert.alert(t.error, t.nameRequired); return; }
    if (ingredientes.length === 0) { Alert.alert(t.error, t.addAtLeastOneIngredient); return; }
    setGuardandoReceta(true);
    const totales = totalesReceta(ingredientes);
    const ok = await crearReceta({
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      ingredientes,
      raciones,
      calorias_total: totales.calorias,
      proteinas_total: totales.proteinas,
      grasas_total: totales.grasas,
      carbohidratos_total: totales.carbs,
    });
    setGuardandoReceta(false);
    if (ok) {
      const nuevoMap = { ...racionesMap, [nombre.trim()]: raciones };
      setRacionesMap(nuevoMap);
      AsyncStorage.setItem("nutri_recetas_raciones", JSON.stringify(nuevoMap));
      setModalCrear(false); setNombre(""); setDescripcion(""); setIngredientes([]); setRaciones(1); cargarRecetasList();
      // Si venía de reels, volver allí
      if (params.from === "reels") {
        setTimeout(() => router.push("/reels" as any), 300);
      }
    } else Alert.alert(t.error, t.couldNotSaveRecipe);
  };

  const editarReceta = (receta: Receta) => {
    setRecetaEditando(receta);
    setNombre(receta.nombre);
    setDescripcion(receta.descripcion || "");
    setIngredientes(receta.ingredientes || []);
    setRaciones(racionesMap[receta.nombre] ?? 1);
    setMostrarBuscador(false);
    setModalCrear(true);
  };

  const guardarEdicion = async () => {
    if (!recetaEditando?.id) return;
    if (!nombre.trim()) { Alert.alert(t.error, t.nameRequired); return; }
    if (ingredientes.length === 0) { Alert.alert(t.error, t.addAtLeastOneIngredient); return; }
    setGuardandoReceta(true);
    const totales = totalesReceta(ingredientes);
    const cambios = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      ingredientes,
      raciones,
      calorias_total: totales.calorias,
      proteinas_total: totales.proteinas,
      grasas_total: totales.grasas,
      carbohidratos_total: totales.carbs,
    };
    const ok = await actualizarReceta(recetaEditando.id, cambios);
    if (ok) {
      // Sincronizar la publicación en comunidad (sin editado_en para que no falle si la columna no existe)
      await supabase.from("publicaciones_recetas")
        .update({
          nombre_receta: cambios.nombre,
          descripcion: cambios.descripcion,
          ingredientes: cambios.ingredientes,
          calorias_total: cambios.calorias_total,
          proteinas_total: cambios.proteinas_total,
          grasas_total: cambios.grasas_total,
          carbohidratos_total: cambios.carbohidratos_total,
        })
        .eq("nombre_receta", recetaEditando.nombre)
        .eq("autor", nombreUsuario);
      // editado_en en llamada separada: falla silenciosamente si la columna no existe aún
      supabase.from("publicaciones_recetas")
        .update({ editado_en: new Date().toISOString() })
        .eq("nombre_receta", cambios.nombre)
        .eq("autor", nombreUsuario)
        .then(() => {});
    }
    setGuardandoReceta(false);
    if (ok) {
      const nuevoMap = { ...racionesMap, [nombre.trim()]: raciones };
      setRacionesMap(nuevoMap);
      AsyncStorage.setItem("nutri_recetas_raciones", JSON.stringify(nuevoMap));
      setModalCrear(false); setRecetaEditando(null);
      setNombre(""); setDescripcion(""); setIngredientes([]); setRaciones(1);
      cargarRecetasList();
    } else Alert.alert(t.error, t.couldNotSaveChanges);
  };

  const anadirAlDia = async (kcal: number, prot: number, carb: number, gras: number, nombre: string, meal: MealKey, raciones: number = 1) => {
    try {
      const storageKey = getTodayKey();
      const stored = await AsyncStorage.getItem(storageKey);
      const BASE = { desayuno: [] as any[], comida: [] as any[], merienda: [] as any[], cena: [] as any[] };
      const meals = stored ? { ...BASE, ...JSON.parse(stored) } : { ...BASE };
      const recetaNombre = nombre.replace(/\s*\(×[\d.]+\)$/, "");
      meals[meal] = [...(meals[meal] ?? []), {
        id: Date.now().toString(), name: nombre, brand: t.ownRecipe,
        supermercado: t.ownRecipe, calories: kcal, protein: prot, carbs: carb, fat: gras,
        saturatedFat: 0, sugar: 0, fiber: 0, salt: 0, per100: null, recetaNombre, raciones,
      }];
      await AsyncStorage.setItem(storageKey, JSON.stringify(meals));
      syncDayToCloud(storageKey, meals);
      signalMealSaved(meals, storageKey);
      setModalAnadir(null);
      Alert.alert(t.added, `${nombre} → ${MEAL_LABELS[meal]}`);
    } catch { Alert.alert(t.error, t.couldNotAddToDay); }
  };

  const anadirGuardadaAlDia = async (rg: RecetaGuardada, meal: MealKey) => {
    try {
      const storageKey = getTodayKey();
      const stored = await AsyncStorage.getItem(storageKey);
      const BASE = { desayuno: [] as any[], comida: [] as any[], merienda: [] as any[], cena: [] as any[] };
      const meals = stored ? { ...BASE, ...JSON.parse(stored) } : { ...BASE };
      meals[meal] = [...(meals[meal] ?? []), {
        id: Date.now().toString(), name: rg.nombre, brand: t.ownRecipe,
        supermercado: t.ownRecipe,
        calories: Math.round(safeNum(rg.calorias_total)),
        protein: Number(safeNum(rg.proteinas_total).toFixed(1)),
        carbs: Number(safeNum(rg.carbohidratos_total).toFixed(1)),
        fat: Number(safeNum(rg.grasas_total).toFixed(1)),
        saturatedFat: 0, sugar: 0, fiber: 0, salt: 0, per100: null,
        recetaNombre: rg.nombre, raciones: 1,
      }];
      await AsyncStorage.setItem(storageKey, JSON.stringify(meals));
      syncDayToCloud(storageKey, meals);
      signalMealSaved(meals, storageKey);
      setModalAnadirGuardada(null);
      Alert.alert(t.added, `${rg.nombre} → ${MEAL_LABELS[meal]}`);
    } catch { Alert.alert(t.error, t.couldNotAddToDay); }
  };

  const quitarGuardada = async (pub_id: string) => {
    const raw = await AsyncStorage.getItem(SAVED_COMMUNITY_KEY);
    let lista: RecetaGuardada[] = [];
    try { lista = raw ? JSON.parse(raw) : []; } catch {}
    const nueva = lista.filter((r) => r.pub_id !== pub_id);
    await AsyncStorage.setItem(SAVED_COMMUNITY_KEY, JSON.stringify(nueva));
    setRecetasGuardadas(nueva);
    quitarRecetaDeCloud(pub_id);
  };

  const actualizarRecetaGuardada = async (pub_id: string) => {
    try {
      const { data: pub } = await supabase
        .from("publicaciones_recetas")
        .select("*")
        .eq("id", pub_id)
        .single();
      if (!pub) return;
      const raw = await AsyncStorage.getItem(SAVED_COMMUNITY_KEY);
      const lista: RecetaGuardada[] = raw ? JSON.parse(raw) : [];
      const nueva = lista.map(r => r.pub_id !== pub_id ? r : {
        ...r,
        nombre: pub.nombre_receta,
        descripcion: pub.descripcion ?? "",
        ingredientes: pub.ingredientes ?? [],
        calorias_total: pub.calorias_total ?? 0,
        proteinas_total: pub.proteinas_total ?? 0,
        grasas_total: pub.grasas_total ?? 0,
        carbohidratos_total: pub.carbohidratos_total ?? 0,
        savedAt: Date.now(),
      });
      await AsyncStorage.setItem(SAVED_COMMUNITY_KEY, JSON.stringify(nueva));
      setRecetasGuardadas(nueva);
      const recetaActualizada = nueva.find(r => r.pub_id === pub_id);
      if (recetaActualizada) guardarRecetaEnCloud(pub_id, recetaActualizada);
      setActualizadosIds(prev => { const s = new Set(prev); s.delete(pub_id); return s; });
      Alert.alert(t.recipeUpdated, t.recipeUpdatedMsg);
    } catch { Alert.alert(t.error, t.couldNotUpdateRecipe); }
  };

  const borrarReceta = (receta: Receta) => setConfirmarBorrar(receta);

  const confirmarEliminarReceta = async () => {
    if (!confirmarBorrar) return;
    const ok = await eliminarReceta(confirmarBorrar.id!);
    setConfirmarBorrar(null);
    if (!ok) {
      Alert.alert(t.error, t.couldNotDeleteRecipe);
      return;
    }
    // Marcar publicación como eliminada en segundo plano
    if (confirmarBorrar.nombre) marcarPublicacionEliminada(confirmarBorrar.nombre);
    cargarRecetasList();
  };

  const totalesActuales = totalesReceta(ingredientes);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />

      <Modal visible={modalCrear} animationType="slide" onRequestClose={() => {
        setModalCrear(false); setRecetaEditando(null); setMostrarBuscador(false);
        if (params.from === "reels") setTimeout(() => router.push("/reels" as any), 200);
      }}>
        <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
          <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
          {mostrarBuscador ? (
            <BuscadorIngrediente
              onSelect={(alimento, gramos) => { agregarIngrediente(alimento, gramos); setScannedIngCode(null); }}
              onScanear={() => { setModalCrear(false); setMostrarBuscador(false); router.push({ pathname: "/scanner", params: { forReceta: "1" } }); }}
              onClose={() => { setMostrarBuscador(false); setScannedIngCode(null); }}
              scannedCode={scannedIngCode}
            />
          ) : (
            <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
              <View style={s.modalHeader}>
                <TouchableOpacity onPress={() => { setModalCrear(false); setRecetaEditando(null); setNombre(""); setDescripcion(""); setIngredientes([]);
                  if (params.from === "reels") setTimeout(() => router.push("/reels" as any), 200);
                }}>
                  <Text style={s.back}>{t.close}</Text>
                </TouchableOpacity>
                <Text style={s.title}>{recetaEditando ? t.editRecipe : t.newRecipe}</Text>
              </View>
              <View style={s.card}>
                <Text style={s.cardTitle}>{t.nameAndDescription}</Text>
                <TextInput style={s.input} value={nombre} onChangeText={setNombre} placeholder={t.recipeNamePlaceholder} placeholderTextColor={colors.textMuted} />
                <TextInput style={[s.input, { marginTop: 8 }]} value={descripcion} onChangeText={setDescripcion} placeholder={t.descriptionOptional} placeholderTextColor={colors.textMuted} />
              </View>
              <View style={s.card}>
                <View style={s.cardTitleRow}>
                  <Text style={s.cardTitle}>🥗 {t.ingredientsLabel}</Text>
                  <TouchableOpacity style={s.addIngBtnRow} onPress={() => setMostrarBuscador(true)}><Text style={s.addIngBtnRowText}>{t.addFood}</Text></TouchableOpacity>
                </View>
                {ingredientes.length === 0 ? (
                  <View style={s.emptyIngWrap}>
                    <Text style={s.emptyIng}>{t.noIngredientsYet}</Text>
                    <TouchableOpacity style={s.addIngBig} onPress={() => setMostrarBuscador(true)}><Text style={s.addIngBigText}>{t.searchOrScanIngredient}</Text></TouchableOpacity>
                  </View>
                ) : (
                  <>
                    {ingredientes.map((ing, i) => (
                      <View key={i} style={s.ingItem}>
                        <View style={s.ingLeft}>
                          <Text style={s.ingName} numberOfLines={1}>{ing.nombre}</Text>
                          <Text style={s.ingMacros}>{ing.gramos}g · {ing.calorias} kcal · {t.proteins[0]}{ing.proteinas}g {t.carbs[0]}{ing.carbs}g {t.fats[0]}{ing.grasas}g</Text>
                        </View>
                        <TouchableOpacity onPress={() => quitarIngrediente(i)}><Text style={s.ingDelete}>✕</Text></TouchableOpacity>
                      </View>
                    ))}
                    <View style={s.totalesWrap}>
                      {/* Raciones stepper */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <Text style={s.totalesTitle}>{t.servingsCount}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <TouchableOpacity onPress={() => setRaciones(r => Math.max(1, r - 1))} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text, fontSize: 18 }}>−</Text></TouchableOpacity>
                          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800', minWidth: 24, textAlign: 'center' }}>{raciones}</Text>
                          <TouchableOpacity onPress={() => setRaciones(r => r + 1)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#1F6FEB', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 18 }}>+</Text></TouchableOpacity>
                        </View>
                      </View>
                      <Text style={s.totalesTitle}>{t.totalRecipe}</Text>
                      <View style={s.totalesRow}>
                        {[
                          { key: "kcal", val: Math.round(totalesActuales.calorias), label: "kcal", color: "#4ADE80" },
                          { key: "prot", val: totalesActuales.proteinas.toFixed(1) + "g", label: t.proteins, color: "#60A5FA" },
                          { key: "carbs", val: totalesActuales.carbs.toFixed(1) + "g", label: t.carbs, color: "#FBBF24" },
                          { key: "fats", val: totalesActuales.grasas.toFixed(1) + "g", label: t.fats, color: "#F87171" },
                        ].map((item) => (
                          <View key={item.key} style={s.totalesBox}>
                            <Text style={[s.totalesVal, { color: item.color }]}>{item.val}</Text>
                            <Text style={s.totalesLabel}>{item.label}</Text>
                          </View>
                        ))}
                      </View>
                      {raciones > 1 && (
                        <>
                          <Text style={[s.totalesTitle, { marginTop: 10 }]}>{t.perServing} ({raciones})</Text>
                          <View style={s.totalesRow}>
                            {[
                              { key: "kcal", val: Math.round(totalesActuales.calorias / raciones), label: "kcal", color: "#4ADE80" },
                              { key: "prot", val: (totalesActuales.proteinas / raciones).toFixed(1) + "g", label: t.proteins, color: "#60A5FA" },
                              { key: "carbs", val: (totalesActuales.carbs / raciones).toFixed(1) + "g", label: t.carbs, color: "#FBBF24" },
                              { key: "fats", val: (totalesActuales.grasas / raciones).toFixed(1) + "g", label: t.fats, color: "#F87171" },
                            ].map((item) => (
                              <View key={item.key} style={[s.totalesBox, { backgroundColor: colors.inputBg }]}>
                                <Text style={[s.totalesVal, { color: item.color }]}>{item.val}</Text>
                                <Text style={s.totalesLabel}>{item.label}</Text>
                              </View>
                            ))}
                          </View>
                        </>
                      )}
                    </View>
                    <TouchableOpacity style={s.addMoreBtn} onPress={() => setMostrarBuscador(true)}><Text style={s.addMoreBtnText}>{t.addAnotherIngredient}</Text></TouchableOpacity>
                  </>
                )}
              </View>
              <TouchableOpacity style={[s.saveBtn, guardandoReceta && { backgroundColor: "#1F3A6B" }]} onPress={recetaEditando ? guardarEdicion : guardarReceta} disabled={guardandoReceta}>
                <Text style={s.saveBtnText}>{guardandoReceta ? t.loading : recetaEditando ? `✓ ${t.saveChanges}` : `✓ ${t.saveRecipeBtn}`}</Text>
              </TouchableOpacity>
              <View style={{ height: 60 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      <AnadirRecetaModal
        receta={modalAnadir}
        visible={!!modalAnadir}
        onClose={() => setModalAnadir(null)}
        onAdd={anadirAlDia}
      />

      <View style={s.headerOuter}>
        <View style={s.headerRow}>
          <Text style={s.title}>{t.recipes}</Text>
        </View>
        <View style={s.tabsRow}>
          <TouchableOpacity style={[s.tabBtn, tab === "recientes" && s.tabBtnActive]} onPress={() => setTab("recientes")}>
            <Text style={[s.tabBtnText, tab === "recientes" && s.tabBtnTextActive]}>{t.recentFilter}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tabBtn, tab === "valoradas" && s.tabBtnActive]} onPress={() => setTab("valoradas")}>
            <Text style={[s.tabBtnText, tab === "valoradas" && s.tabBtnTextActive]}>{t.bestRated}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Buscador de recetas */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.card,
          borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder,
          paddingHorizontal: 13, paddingVertical: 9, gap: 8 }}>
          <Text style={{ fontSize: 15, opacity: 0.55 }}>🔍</Text>
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 14 }}
            placeholder={t.searchRecipesOrAuthor}
            placeholderTextColor={colors.textMuted}
            value={busquedaComunidad}
            onChangeText={setBusquedaComunidad}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {busquedaComunidad.length > 0 && (
            <TouchableOpacity onPress={() => setBusquedaComunidad("")}>
              <Text style={{ color: colors.textMuted, fontSize: 16, fontWeight: "700" }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + 8 }}>
        {cargandoComunidad ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              {[0,1,2].map(i => <SkeletonRecetaCard key={i} colors={colors} />)}
            </View>
          ) : comunidadFiltrada.length === 0 ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyIcon}>{busquedaComunidad ? "🔍" : "👥"}</Text>
              <Text style={s.emptyTitle}>{busquedaComunidad ? t.noResults : t.noRecipesInCommunity}</Text>
              <Text style={s.emptyText}>{busquedaComunidad ? `${t.noResults} "${busquedaComunidad}"` : t.beFirstToShare}</Text>
            </View>
          ) : (
            comunidadFiltrada.map((pub) => {
              const tr = tPub(pub);
              return (
              <TouchableOpacity key={pub.id} activeOpacity={0.9} onPress={() => setModalDetallePub(pub)} style={s.recetaCard}>
                <View style={s.recetaHeader}>
                  <View style={s.recetaLeft}>
                    <Text style={s.recetaNombre}>{tr.nombre}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                      {pub.autor_avatar
                        ? Platform.OS === "web"
                          ? (React.createElement as any)("img", { src: pub.autor_avatar, style: { width: 16, height: 16, borderRadius: 8, objectFit: "cover" } })
                          : <Image source={{ uri: pub.autor_avatar }} style={{ width: 16, height: 16, borderRadius: 8 }} />
                        : <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#334155", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 8, color: "#94A3B8" }}>{pub.autor?.[0]?.toUpperCase() ?? "?"}</Text>
                          </View>
                      }
                      <Text style={s.recetaDesc} numberOfLines={1}>{t.by} {pub.autor}</Text>
                    </View>
                  </View>
                  {!guardadasSet.has(pub.id) && (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); guardarComunidad(pub); }}>
                      <Text style={{ fontSize: 20 }}>＋</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {pub.ingredientes?.length > 0 && (
                  <View style={s.ingList}>
                    {pub.ingredientes.slice(0, 5).map((ing: any, i: number) => (
                      <View key={i} style={s.ingPill}><Text style={s.ingPillText}>{tr.ingredientes[i] ?? ing.nombre} {ing.gramos}g</Text></View>
                    ))}
                    {pub.ingredientes.length > 5 && <View style={s.ingPill}><Text style={s.ingPillText}>+{pub.ingredientes.length - 5} {t.more}</Text></View>}
                  </View>
                )}
                <View style={s.macrosRow}>
                  {[
                    { key: "kcal", val: Math.round(safeNum(pub.calorias_total)), label: "kcal", color: "#4ADE80" },
                    { key: "prot", val: Math.round(safeNum(pub.proteinas_total)) + "g", label: t.proteins, color: "#60A5FA" },
                    { key: "carbs", val: Math.round(safeNum(pub.carbohidratos_total)) + "g", label: t.carbs, color: "#FBBF24" },
                    { key: "fats", val: Math.round(safeNum(pub.grasas_total)) + "g", label: t.fats, color: "#F87171" },
                  ].map((item) => (
                    <View key={item.key} style={s.macroBox}>
                      <Text style={[s.macroVal, { color: item.color }]}>{item.val}</Text>
                      <Text style={s.macroLabel}>{item.label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 4 }}>{t.tapForDetails}</Text>
              </TouchableOpacity>
              );
            })
          )
        }
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal añadir receta guardada al día */}
      <Modal visible={!!modalAnadirGuardada} transparent animationType="fade" onRequestClose={() => setModalAnadirGuardada(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setModalAnadirGuardada(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>{modalAnadirGuardada?.nombre}</Text>
            <Text style={s.popupSubtitle}>{t.whichMealToAdd}</Text>
            <View style={s.mealSelector}>
              {(Object.keys(MEAL_LABELS) as MealKey[]).map((m) => (
                <TouchableOpacity key={m} style={[s.mealChip, mealSeleccionada === m && s.mealChipActive]} onPress={() => setMealSeleccionada(m)}>
                  <Text style={s.mealChipIcon}>{MEAL_ICONS[m]}</Text>
                  <Text style={[s.mealChipText, mealSeleccionada === m && s.mealChipTextActive]}>{MEAL_LABELS[m]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModalAnadirGuardada(null)}><Text style={s.cancelText}>{t.cancel}</Text></TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={() => modalAnadirGuardada && anadirGuardadaAlDia(modalAnadirGuardada, mealSeleccionada)}><Text style={s.confirmText}>{t.add}</Text></TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal confirmación borrar receta */}
      <Modal visible={!!confirmarBorrar} transparent animationType="fade" onRequestClose={() => setConfirmarBorrar(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmarBorrar(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>{t.deleteRecipe}</Text>
            <Text style={s.popupSubtitle}>"{confirmarBorrar?.nombre}" — {t.deleteRecipeConfirm}</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarBorrar(null)}>
                <Text style={s.cancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: "#EF4444" }]} onPress={confirmarEliminarReceta}>
                <Text style={s.confirmText}>{t.delete}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal confirmación quitar receta guardada */}
      <Modal visible={!!confirmarBorrarGuardada} transparent animationType="fade" onRequestClose={() => setConfirmarBorrarGuardada(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmarBorrarGuardada(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>{t.removeSavedRecipe}</Text>
            <Text style={s.popupSubtitle}>"{confirmarBorrarGuardada?.nombre}" — {t.removeSavedRecipeConfirm}</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarBorrarGuardada(null)}>
                <Text style={s.cancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: "#EF4444" }]} onPress={() => { if (confirmarBorrarGuardada) { quitarGuardada(confirmarBorrarGuardada.pub_id); setConfirmarBorrarGuardada(null); } }}>
                <Text style={s.confirmText}>{t.remove}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal reproducir reel guardado */}
      <Modal visible={!!videoReelAbierto} transparent animationType="fade" onRequestClose={() => setVideoReelAbierto(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setVideoReelAbierto(null)}>
          <TouchableOpacity activeOpacity={1} style={[s.popup, { padding: 0, overflow: "hidden" as const, backgroundColor: "#0F172A" }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 }}>
              <Text style={[s.popupTitle, { marginBottom: 0, flex: 1 }]} numberOfLines={1}>🎬 {videoReelAbierto?.nombre}</Text>
              <TouchableOpacity onPress={() => setVideoReelAbierto(null)}>
                <Text style={{ color: "#94A3B8", fontSize: 22, fontWeight: "300" }}>✕</Text>
              </TouchableOpacity>
            </View>
            {Platform.OS === "web" && videoReelAbierto?.video_url
              ? (React.createElement as any)("video", {
                  src: videoReelAbierto.video_url,
                  style: { width: "100%", maxHeight: 420, objectFit: "contain", backgroundColor: "#000", display: "block" },
                  controls: true,
                  autoPlay: true,
                  playsInline: true,
                  loop: true,
                })
              : <View style={{ height: 120, justifyContent: "center", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 40 }}>🎬</Text>
                  <Text style={{ color: "#94A3B8", fontSize: 12 }}>{t.availableOnWeb}</Text>
                </View>
            }
            <Text style={{ color: "#64748B", fontSize: 12, padding: 12 }}>{t.by} @{videoReelAbierto?.autor}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <BottomTabBar />

      <ModalDetalle
        pub={modalDetallePub}
        visible={!!modalDetallePub}
        onClose={() => setModalDetallePub(null)}
        nombreUsuario={nombreUsuario}
        avatarUri={avatarUri}
      />
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
  porcionesLabel: { color: c.textMuted, fontSize: 11, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  chipsRow: { flexDirection: "row" as const, gap: 8, paddingBottom: 4 },
  chip: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, alignItems: "center" as const, minWidth: 60 },
  chipActive: { backgroundColor: "#1F6FEB", borderColor: "#1F6FEB" },
  chipText: { color: c.textSub, fontSize: 13, fontWeight: "600" as const },
  chipTextActive: { color: "#fff", fontWeight: "700" as const },
  chipGrams: { color: c.textMuted, fontSize: 10, marginTop: 2 },
  addPorcionBtn: { color: "#58A6FF", fontSize: 13, fontWeight: "600" as const, textAlign: "center" as const, paddingVertical: 2 },
  addPorcionForm: { backgroundColor: c.bg, borderRadius: 12, padding: 12, gap: 8 },
  addPorcionInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, padding: 10, color: c.text, fontSize: 14 },
  addPorcionCancel: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 8, padding: 10, alignItems: "center" as const },
  addPorcionCancelText: { color: c.textMuted, fontSize: 13 },
  addPorcionSave: { flex: 1, backgroundColor: "#1F6FEB", borderRadius: 8, padding: 10, alignItems: "center" as const },
  addPorcionSaveText: { color: "#fff", fontSize: 13, fontWeight: "700" as const },
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