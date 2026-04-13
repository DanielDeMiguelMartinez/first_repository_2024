import AsyncStorage from "@react-native-async-storage/async-storage";
import { BottomTabBar, TAB_BAR_HEIGHT } from "@/app/services/BottomTabBar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signalMealSaved, subscribeMealUpdates } from "./services/refreshSignal";
import {
  ActivityIndicator,
  Alert,
  Modal,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { useApp } from "./services/i18n";
import { getTipDelDia, getTipShownKey } from "./services/tips";
import { eliminarSesionEjercicio, Logro, obtenerSesionesHoy, registrarAguaCompletada, registrarSesionEjercicio, SesionEjercicio } from "./services/gamification";

const EJERCICIO_KEY_PREFIX = "nutri_ejercicio_";
const PROFILE_KEY = "nutri_user_profile";
const MET: Record<string, number> = {
  walking: 3.5, running: 8.0, cycling: 7.0,
  swimming: 7.0, weights: 4.5, hiit: 9.0,
  yoga: 2.5, soccer: 7.0, tennis: 6.0,
};
import { buscarRestaurantesCercanos, buscarRestaurantesPopulares, PlatoParaAnadir, RestauranteCercano } from "./services/comerFuera";
import { obtenerRecetas, Receta, supabase } from "./services/supabase";
import { AnadirRecetaModal, MealKey } from "./recetas";
import { FoodUnit, FOOD_UNIT_GRAMS, fromGrams } from "./services/units";
import {
  loadDayFromCloud, syncDayToCloud,
  loadGoalsFromCloud, syncGoalsToCloud,
  loadWaterFromCloud, syncWaterToCloud,
  migrateLocalToCloud,
} from "./services/cloudSync";

type Porcion = { nombre: string; gramos: number };

type FoodEntry = {
  id: string;
  name: string;
  brand?: string;
  supermercado?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  per100?: {
    calories: number; protein: number; carbs: number; fat: number;
    saturatedFat: number; sugar: number; fiber: number; salt: number;
  };
  porciones?: Porcion[];
  // Ración usada al añadir (para pre-seleccionarla al editar)
  porcionUsadaIdx?: number;
  porcionUsadaCantidad?: string;
  // Para recetas propias: número de raciones añadidas
  raciones?: number;
};

type MealData = {
  desayuno: FoodEntry[];
  snack1: FoodEntry[];
  comida: FoodEntry[];
  merienda: FoodEntry[];
  cena: FoodEntry[];
  snack2: FoodEntry[];
};

const GOALS_KEY = "nutri_daily_goals";
const WATER_KEY = "nutri_water_";
const STREAK_KEY = "nutri_streak";
const DEFAULT_GOALS = { calories: 2000, protein: 150, carbs: 250, fat: 65 };
const WATER_GOAL = 8;

const SUPER_COLORS: Record<string, string> = {
  Mercadona: "#00A651", Carrefour: "#004A97", Lidl: "#0050AA",
  DIA: "#E30613", Alcampo: "#FF6600", Eroski: "#E2001A",
  Aldi: "#00529B", Consum: "#E2001A", "El Corte Inglés": "#006400",
};

const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MESES_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MESES_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const MESES_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const MESES_ZH = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
const DIAS_ES = ["Lu","Ma","Mi","Ju","Vi","Sá","Do"];
const DIAS_EN = ["Mo","Tu","We","Th","Fr","Sa","Su"];
const DIAS_FR = ["Lu","Ma","Me","Je","Ve","Sa","Di"];
const DIAS_DE = ["Mo","Di","Mi","Do","Fr","Sa","So"];
const DIAS_ZH = ["一","二","三","四","五","六","日"];

const EMPTY_MEALS: MealData = { desayuno: [], snack1: [], comida: [], merienda: [], cena: [], snack2: [] };

const MEAL_FREQUENCY_KEY = "nutri_meal_frequency";

// Qué claves de MealData se muestran según la frecuencia elegida
const FREQUENCY_MEALS: Record<string, (keyof MealData)[]> = {
  "2":  ["comida", "cena"],
  "3":  ["desayuno", "comida", "cena"],
  "4":  ["desayuno", "comida", "merienda", "cena"],
  "5":  ["desayuno", "snack1", "comida", "merienda", "cena"],
  "6":  ["desayuno", "snack1", "comida", "merienda", "cena", "snack2"],
};


function dateToKey(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `nutri_meals_${y}-${mo}-${d}`;
}
function waterKey(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${WATER_KEY}${y}-${mo}-${d}`;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function calcularGramosActuales(food: FoodEntry): number {
  if (!food.per100 || food.per100.calories === 0) return 100;
  return Math.round((food.calories / food.per100.calories) * 100);
}

async function actualizarRacha(): Promise<number> {
  try {
    const hoy = new Date();
    const ayerKey = dateToKey(addDays(hoy, -1));
    const ayerData = await AsyncStorage.getItem(ayerKey);
    const ayerTieneComidas = ayerData ? Object.values(JSON.parse(ayerData)).flat().length > 0 : false;
    const rawStreak = await AsyncStorage.getItem(STREAK_KEY);
    const streakData = rawStreak ? JSON.parse(rawStreak) : { count: 0, lastDate: "" };
    const lastDate = streakData.lastDate ? new Date(streakData.lastDate) : null;
    const eraAyer = lastDate ? isSameDay(lastDate, addDays(hoy, -1)) : false;
    const eraHoy = lastDate ? isSameDay(lastDate, hoy) : false;
    let newCount = streakData.count;
    if (eraHoy) {
    } else if (eraAyer && ayerTieneComidas) {
      newCount = streakData.count + 1;
    } else if (!eraAyer) {
      newCount = 1;
    }
    await AsyncStorage.setItem(STREAK_KEY, JSON.stringify({ count: newCount, lastDate: hoy.toISOString() }));
    return newCount;
  } catch { return 0; }
}

const WaterCounter = React.memo(function WaterCounter({ vasos, onAdd, onRemove, colors }: {
  vasos: number; onAdd: () => void; onRemove: () => void; colors: any;
}) {
  const { t } = useApp();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.cardBorder, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 18 }}>💧</Text>
          <View>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>{t.dailyWater}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>{vasos}/{WATER_GOAL} {t.cups}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.cardBorder, alignItems: "center", justifyContent: "center" }}
            onPress={onRemove}
            disabled={vasos === 0}
          >
            <Text style={{ color: vasos === 0 ? colors.textMuted : colors.text, fontSize: 18, lineHeight: 22 }}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" }}
            onPress={onAdd}
            disabled={vasos >= WATER_GOAL}
          >
            <Text style={{ color: "#fff", fontSize: 18, lineHeight: 22 }}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ height: 6, backgroundColor: colors.inputBg, borderRadius: 3, overflow: "hidden" }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: vasos >= WATER_GOAL ? "#4ADE80" : "#38BDF8", width: `${Math.min((vasos / WATER_GOAL) * 100, 100)}%` as any }} />
      </View>
      <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
        {Array.from({ length: WATER_GOAL }).map((_, i) => (
          <Text key={i} style={{ fontSize: 16, opacity: i < vasos ? 1 : 0.25 }}>💧</Text>
        ))}
      </View>
    </View>
  );
});

function EditGramosModal({ visible, food, onClose, onSave }: {
  visible: boolean; food: FoodEntry | null; onClose: () => void;
  onSave: (g: number, porcionIdx: number | null, porcionCantidad: string) => void;
}) {
  const { t, colors } = useApp();
  const [gramos, setGramos] = useState("100");
  const [foodUnit, setFoodUnit] = useState<FoodUnit>("g");
  const [displayText, setDisplayText] = useState("100");
  const [porcionIdx, setPorcionIdx] = useState<number | null>(null);
  const [cantidades, setCantidades] = useState<string[]>([]);

  const parsearCantidad = (s: string): number => {
    const txt = s.trim().replace(",", ".");
    // "½", "1½", "2½", etc.
    const halfMatch = txt.match(/^(\d*)\s*½$/);
    if (halfMatch) return (Number(halfMatch[1]) || 0) + 0.5;
    // "1/2", "3/4", etc.
    const frac = txt.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (frac) { const v = Number(frac[1]) / Number(frac[2]); return v > 0 ? v : 0; }
    const n = Number(txt);
    return isNaN(n) || n <= 0 ? 0 : n;
  };

  // Formatea múltiplos de 0.5 con símbolo de fracción: 0.5→"½", 1.5→"1½"
  const formatCantidad = (n: number): string => {
    const intPart = Math.floor(n);
    const esMedio = Math.round((n - intPart) * 2) === 1;
    if (!esMedio) return String(intPart);
    return intPart === 0 ? "½" : `${intPart}½`;
  };

  React.useEffect(() => {
    if (!food) return;
    setFoodUnit("g");
    if (food.porcionUsadaIdx !== undefined && food.porciones?.[food.porcionUsadaIdx]) {
      const idx = food.porcionUsadaIdx;
      const cant = food.porcionUsadaCantidad ?? "1";
      const gPor = Math.round(food.porciones[idx].gramos * parsearCantidad(cant));
      setPorcionIdx(idx);
      setCantidades((food.porciones ?? []).map((_, i) => i === idx ? cant : "1"));
      setGramos(String(gPor));
      setDisplayText(String(gPor));
    } else if (food.porciones && food.porciones.length > 0) {
      setPorcionIdx(0);
      setCantidades(food.porciones.map(() => "1"));
      const g0 = food.porciones[0].gramos;
      setGramos(String(g0));
      setDisplayText(String(g0));
    } else {
      setPorcionIdx(null);
      setCantidades([]);
      const gInit = String(calcularGramosActuales(food));
      setGramos(gInit);
      setDisplayText(gInit);
    }
  }, [food]);

  const changeFoodUnit = (newUnit: FoodUnit) => {
    setFoodUnit(newUnit);
    const gNum = Number(gramos) || 0;
    if (newUnit === "g") {
      setDisplayText(gramos);
    } else {
      const converted = +(gNum / FOOD_UNIT_GRAMS[newUnit]).toFixed(2);
      setDisplayText(String(converted).replace(".", ","));
    }
  };

  const onFreeInput = (v: string) => {
    setDisplayText(v);
    const gVal = Math.round((Number(v.replace(",", ".")) || 0) * FOOD_UNIT_GRAMS[foodUnit]);
    setGramos(String(gVal));
    setPorcionIdx(null);
  };

  const onUnitInput = (v: string) => {
    setDisplayText(v);
    const parsed = parsearCantidad(v);
    if (parsed > 0) setGramos(String(Math.round(parsed * FOOD_UNIT_GRAMS[foodUnit])));
    setPorcionIdx(null);
  };

  const stepQuantity = (delta: number) => {
    if (foodUnit === "g") {
      const current = Number(displayText.replace(",", ".")) || 0;
      const nueva = Math.max(5, current + delta * 5);
      onFreeInput(String(Math.round(nueva)));
    } else {
      const current = parsearCantidad(displayText);
      const nueva = Math.max(0.5, +(current + delta * 0.5).toFixed(1));
      const nuevaStr = Number.isInteger(nueva) ? String(nueva) : String(nueva).replace(".", ",");
      setDisplayText(nuevaStr);
      setGramos(String(Math.round(nueva * FOOD_UNIT_GRAMS[foodUnit])));
      setPorcionIdx(null);
    }
  };

  const cambiarCantidadPorcion = (i: number, delta: number) => {
    if (!food?.porciones) return;
    const actual = parsearCantidad(cantidades[i] ?? "1");
    const nueva = Math.max(0.5, Math.round((actual + delta) * 2) / 2);
    const nuevaStr = formatCantidad(nueva);
    const newCantidades = [...cantidades];
    newCantidades[i] = nuevaStr;
    setCantidades(newCantidades);
    setPorcionIdx(i);
    const gPor = Math.round(food.porciones[i].gramos * nueva);
    setGramos(String(gPor));
    setDisplayText(foodUnit === "g" ? String(gPor) : String(+(gPor / FOOD_UNIT_GRAMS[foodUnit]).toFixed(2)).replace(".", ","));
  };

  const onCantidadTextChange = (i: number, v: string) => {
    if (!food?.porciones) return;
    const newCantidades = [...cantidades];
    newCantidades[i] = v;
    setCantidades(newCantidades);
    setPorcionIdx(i);
    const parsed = parsearCantidad(v);
    if (parsed > 0) {
      const gPor = Math.round(food.porciones[i].gramos * parsed);
      setGramos(String(gPor));
      setDisplayText(foodUnit === "g" ? String(gPor) : String(+(gPor / FOOD_UNIT_GRAMS[foodUnit]).toFixed(2)).replace(".", ","));
    }
  };

  const UNIT_LABELS: Record<FoodUnit, string> = { g: "g", oz: "oz", cup: "Taza", tbsp: "Cda.", tsp: "Cdta.", ml: "ml" };
  const UNITS: FoodUnit[] = ["g", "oz", "cup", "tbsp", "tsp", "ml"];

  if (!food) return null;
  const g = Number(gramos) || 0;
  const p = food.per100;
  const cal = p ? Math.round((p.calories * g) / 100) : food.calories;
  const prot = p ? ((p.protein * g) / 100).toFixed(1) : String(food.protein);
  const carb = p ? ((p.carbs * g) / 100).toFixed(1) : String(food.carbs);
  const fat = p ? ((p.fat * g) / 100).toFixed(1) : String(food.fat);
  const sc = food.supermercado ? (SUPER_COLORS[food.supermercado] || "#4B5563") : null;
  const hasPorciones = !!(food.porciones && food.porciones.length > 0);
  const cantidadActiva = porcionIdx !== null ? (cantidades[porcionIdx] ?? "1") : "1";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000AA", justifyContent: "center", alignItems: "center", padding: 20 }} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.card, borderRadius: 24, padding: 24, width: "100%", borderWidth: 1, borderColor: colors.cardBorder, gap: 14 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }} numberOfLines={2}>{food.name}</Text>
          {sc && food.supermercado && (
            <View style={{ alignSelf: "flex-start", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: sc + "22", borderColor: sc + "55" }}>
              <Text style={{ color: sc, fontSize: 11, fontWeight: "700" }}>{food.supermercado}</Text>
            </View>
          )}

          {/* ── Selector de unidad ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {UNITS.map(u => (
                <TouchableOpacity key={u} onPress={() => changeFoodUnit(u)}
                  style={{ backgroundColor: foodUnit === u ? "#1F6FEB" : colors.inputBg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5, borderColor: foodUnit === u ? "#1F6FEB" : colors.cardBorder }}>
                  <Text style={{ color: foodUnit === u ? "#fff" : colors.textSub, fontSize: 13, fontWeight: "700" }}>{UNIT_LABELS[u]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* ── Input de cantidad ── */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, borderRadius: 16, padding: 12, gap: 8 }}>
            <TextInput
              style={{ color: colors.text, fontSize: 32, fontWeight: "900", textAlign: "center", backgroundColor: "transparent", minWidth: 80 }}
              value={displayText}
              onChangeText={foodUnit === "g" ? onFreeInput : onUnitInput}
              keyboardType="decimal-pad"
              selectTextOnFocus
            />
            <Text style={{ color: colors.textMuted, fontSize: 16, fontWeight: "600" }}>{UNIT_LABELS[foodUnit]}</Text>
          </View>

          {/* ── Porciones: una fila por porción con stepper a la derecha ── */}
          {hasPorciones && (
            <View style={{ gap: 8 }}>
              {food.porciones!.map((por, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", backgroundColor: porcionIdx === i ? "#1F6FEB18" : colors.bg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1.5, borderColor: porcionIdx === i ? "#1F6FEB" : colors.cardBorder }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>{por.nombre}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{por.gramos}g / unidad</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <TouchableOpacity onPress={() => cambiarCantidadPorcion(i, -0.5)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "300", lineHeight: 24 }}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={{ color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center", width: 52, backgroundColor: "transparent" }}
                      value={cantidades[i] ?? "1"}
                      onChangeText={(v) => onCantidadTextChange(i, v)}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                    <TouchableOpacity onPress={() => cambiarCantidadPorcion(i, 0.5)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "300", lineHeight: 24 }}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── Macros ── */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[
              { val: String(cal), unit: "kcal", color: "#4ADE80" },
              { val: prot + "g", unit: t.proteins.slice(0, 4), color: "#60A5FA" },
              { val: carb + "g", unit: t.carbs, color: "#FBBF24" },
              { val: fat + "g", unit: t.fats, color: "#F87171" },
            ].map((item) => (
              <View key={item.unit} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
                <Text style={{ color: item.color, fontSize: 15, fontWeight: "800" }}>{item.val}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>{item.unit}</Text>
              </View>
            ))}
          </View>

          {/* ── Botones ── */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 14, alignItems: "center" }} onPress={onClose}>
              <Text style={{ color: colors.textSub, fontWeight: "700", fontSize: 15 }}>{t.cancel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, backgroundColor: "#1F6FEB", borderRadius: 12, padding: 14, alignItems: "center" }} onPress={() => onSave(g, porcionIdx, cantidadActiva)}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{t.save}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function GoalsModal({ visible, goals, onClose, onSave }: {
  visible: boolean; goals: typeof DEFAULT_GOALS; onClose: () => void; onSave: (g: typeof DEFAULT_GOALS) => void;
}) {
  const { t, colors } = useApp();
  const [cal, setCal] = useState(String(goals.calories));
  const [prot, setProt] = useState(String(goals.protein));
  const [carbs, setCarbs] = useState(String(goals.carbs));
  const [fat, setFat] = useState(String(goals.fat));

  React.useEffect(() => {
    if (visible) { setCal(String(goals.calories)); setProt(String(goals.protein)); setCarbs(String(goals.carbs)); setFat(String(goals.fat)); }
  }, [visible, goals]);

  const handleCalChange = (v: string) => {
    setCal(v);
    const kcal = Number(v);
    if (kcal > 0) { setProt(String(Math.round((kcal * 0.30) / 4))); setCarbs(String(Math.round((kcal * 0.40) / 4))); setFat(String(Math.round((kcal * 0.30) / 9))); }
  };
  const handleMacroChange = (field: "prot" | "carbs" | "fat", v: string) => {
    if (field === "prot") setProt(v);
    if (field === "carbs") setCarbs(v);
    if (field === "fat") setFat(v);
    const p = field === "prot" ? Number(v) : Number(prot);
    const c = field === "carbs" ? Number(v) : Number(carbs);
    const f = field === "fat" ? Number(v) : Number(fat);
    const kcal = Math.round(p * 4 + c * 4 + f * 9);
    if (kcal > 0) setCal(String(kcal));
  };
  const guardarManual = () => {
    onSave({ calories: Number(cal) || DEFAULT_GOALS.calories, protein: Number(prot) || DEFAULT_GOALS.protein, carbs: Number(carbs) || DEFAULT_GOALS.carbs, fat: Number(fat) || DEFAULT_GOALS.fat });
    onClose();
  };
  const calFromMacros = Math.round(Number(prot) * 4 + Number(carbs) * 4 + Number(fat) * 9);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000000CC", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%", borderWidth: 1, borderColor: colors.cardBorder }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>{t.dailyGoals}</Text>
            <TouchableOpacity onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.textSub, fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 14 }}>
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t.editGoalsManually}</Text>
              <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder, gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#4ADE80" }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>{t.calories}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>{t.kcalAutoMacros}</Text>
                  </View>
                  <TextInput style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: "#4ADE8044", borderRadius: 10, padding: 10, color: colors.text, fontSize: 18, fontWeight: "800", width: 90, textAlign: "center" }} value={cal} onChangeText={handleCalChange} keyboardType="numeric" selectTextOnFocus />
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {[{ label: t.prot30, color: "#60A5FA", val: Math.round(Number(cal) * 0.30 / 4) }, { label: t.carbs40, color: "#FBBF24", val: Math.round(Number(cal) * 0.40 / 4) }, { label: t.fat30, color: "#F87171", val: Math.round(Number(cal) * 0.30 / 9) }].map((m) => (
                    <View key={m.label} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 8, padding: 8, alignItems: "center" }}>
                      <Text style={{ color: m.color, fontSize: 13, fontWeight: "800" }}>{m.val}g</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 9, marginTop: 1 }}>{m.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {[
                { label: t.proteins, unit: t.perDay, val: prot, field: "prot" as const, color: "#60A5FA", hint: "1g = 4 kcal" },
                { label: t.carbs, unit: t.perDay, val: carbs, field: "carbs" as const, color: "#FBBF24", hint: "1g = 4 kcal" },
                { label: t.fats, unit: t.perDay, val: fat, field: "fat" as const, color: "#F87171", hint: "1g = 9 kcal" },
              ].map((item) => (
                <View key={item.label} style={{ backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder, gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>{item.label}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.unit} · {item.hint}</Text>
                    </View>
                    <TextInput style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: item.color + "44", borderRadius: 10, padding: 10, color: colors.text, fontSize: 18, fontWeight: "800", width: 90, textAlign: "center" }} value={item.val} onChangeText={(v) => handleMacroChange(item.field, v)} keyboardType="numeric" selectTextOnFocus />
                  </View>
                </View>
              ))}
              {calFromMacros > 0 && calFromMacros !== Number(cal) && (
                <View style={{ backgroundColor: "#1F6FEB11", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#1F6FEB33", flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontSize: 16 }}>💡</Text>
                  <Text style={{ color: "#58A6FF", fontSize: 13, flex: 1 }}>Tus macros suman <Text style={{ fontWeight: "800" }}>{calFromMacros} kcal</Text>. Toca guardar para aplicarlo.</Text>
                  <TouchableOpacity onPress={() => setCal(String(calFromMacros))} style={{ backgroundColor: "#1F6FEB33", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Text style={{ color: "#58A6FF", fontSize: 12, fontWeight: "700" }}>Usar</Text>
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity style={{ backgroundColor: "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 4, marginBottom: 16 }} onPress={guardarManual}>
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>{t.saveGoals}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CalendarioModal({ visible, selectedDate, onClose, onSelect }: {
  visible: boolean; selectedDate: Date; onClose: () => void; onSelect: (date: Date) => void;
}) {
  const { t, colors, language } = useApp();
  const [viewDate, setViewDate] = useState(new Date(selectedDate));
  const today = new Date();
  React.useEffect(() => { if (visible) setViewDate(new Date(selectedDate)); }, [visible, selectedDate]);
  const MESES_MAP: Record<string, string[]> = { es: MESES_ES, en: MESES_EN, fr: MESES_FR, de: MESES_DE, zh: MESES_ZH };
  const DIAS_MAP: Record<string, string[]> = { es: DIAS_ES, en: DIAS_EN, fr: DIAS_FR, de: DIAS_DE, zh: DIAS_ZH };
  const MESES = MESES_MAP[language] || MESES_EN;
  const DIAS = DIAS_MAP[language] || DIAS_EN;
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000CC", justifyContent: "center", alignItems: "center", padding: 16 }} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.card, borderRadius: 28, padding: 20, width: "100%", borderWidth: 1, borderColor: colors.cardBorder, gap: 6 }}>
          <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "600", textAlign: "center", letterSpacing: 2 }}>{year}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" }} onPress={() => setViewDate(new Date(year, month - 1, 1))}>
              <Text style={{ color: colors.textSub, fontSize: 20, fontWeight: "300", lineHeight: 22 }}>‹</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>{MESES[month]}</Text>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" }} onPress={() => setViewDate(new Date(year, month + 1, 1))}>
              <Text style={{ color: colors.textSub, fontSize: 20, fontWeight: "300", lineHeight: 22 }}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: "row", marginBottom: 4 }}>
            {DIAS.map((d) => <Text key={d} style={{ flex: 1, color: colors.textMuted, fontSize: 12, fontWeight: "600", textAlign: "center", paddingVertical: 4 }}>{d}</Text>)}
          </View>
          {weeks.map((week, wi) => (
            <View key={wi} style={{ flexDirection: "row", marginBottom: 2 }}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={{ flex: 1, aspectRatio: 1 }} />;
                const cellDate = new Date(year, month, day);
                const isToday = isSameDay(cellDate, today);
                const isSelected = isSameDay(cellDate, selectedDate);
                return (
                  <TouchableOpacity key={di} style={{ flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: isSelected || isToday ? "#1F6FEB" : "transparent" }} onPress={() => { onSelect(cellDate); onClose(); }}>
                    <Text style={{ color: isSelected || isToday ? "#fff" : colors.text, fontSize: 15, fontWeight: isSelected || isToday ? "800" : "500" }}>{day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {[
              { label: t.yesterday, fn: () => { onSelect(addDays(today, -1)); onClose(); } },
              { label: t.today, fn: () => { onSelect(new Date()); onClose(); }, active: true },
              { label: t.tomorrow, fn: () => { onSelect(addDays(today, 1)); onClose(); } },
            ].map((btn) => (
              <TouchableOpacity key={btn.label} style={{ flex: 1, backgroundColor: btn.active ? "#1F6FEB22" : colors.inputBg, borderRadius: 10, padding: 10, alignItems: "center", borderWidth: btn.active ? 1 : 0, borderColor: "#1F6FEB55" }} onPress={btn.fn}>
                <Text style={{ color: btn.active ? "#58A6FF" : colors.textSub, fontSize: 13, fontWeight: btn.active ? "700" : "600" }}>{btn.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function FoodRow({ food, onEdit, onDelete }: { food: FoodEntry; onEdit: () => void; onDelete: () => void }) {
  const { colors } = useApp();
  const sc = food.supermercado ? (SUPER_COLORS[food.supermercado] || "#4B5563") : null;
  const esReceta = food.per100 == null;
  const gramos = esReceta ? 0 : calcularGramosActuales(food);
  const raciones = food.raciones ?? 1;
  const labelCantidad = esReceta
    ? (raciones === 1 ? "1 ración" : `${raciones % 1 === 0 ? raciones : raciones.toFixed(2).replace(/\.?0+$/, "")} raciones`)
    : ((food as any).portionLabel ? `${(food as any).portionLabel} · ${gramos}g` : `${gramos}g`);
  return (
    <Pressable
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: pressed ? colors.inputBg : colors.bg, borderRadius: 12, padding: 12, marginBottom: 6 })}
      onPress={onEdit}
    >
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{food.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
          {sc && food.supermercado && (<><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sc }} /><Text style={{ color: sc, fontSize: 10, fontWeight: "700" }}>{food.supermercado}</Text><Text style={{ color: colors.textMuted, fontSize: 10 }}>·</Text></>)}
          <Text style={{ color: colors.textSub, fontSize: 11, fontWeight: "500" }}>
            {labelCantidad}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ color: colors.textSub, fontSize: 13, fontWeight: "600" }}>{food.calories} kcal</Text>
        <TouchableOpacity style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" }} onPress={(e) => { e.stopPropagation(); onDelete(); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700" }}>✕</Text>
        </TouchableOpacity>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { t, colors, theme, language, isOnline } = useApp();

  const MET_LABELS: Record<string, string> = {
    walking: t.actWalking, running: t.actRunning, cycling: t.actCycling,
    swimming: t.actSwimming, weights: t.actWeights, hiit: t.actHIIT,
    yoga: t.actYoga, soccer: t.actSoccer, tennis: t.actTennis,
  };

  const params = useLocalSearchParams<{ goToDate?: string }>();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [meals, setMeals] = useState<MealData>(EMPTY_MEALS);
  const [cargandoComidas, setCargandoComidas] = useState(true);
  const lastCloudLoadRef = useRef(0);
  const [mealFrequency, setMealFrequency] = useState("4");
  const visibleMeals: (keyof MealData)[] = mealFrequency.includes(",")
    ? mealFrequency.split(",") as (keyof MealData)[]
    : FREQUENCY_MEALS[mealFrequency] ?? FREQUENCY_MEALS["4"];
  const [expanded, setExpanded] = useState<Record<keyof MealData, boolean>>({ desayuno: true, snack1: true, comida: true, merienda: true, cena: true, snack2: true });
  const [editFood, setEditFood] = useState<{ food: FoodEntry; meal: keyof MealData } | null>(null);
  const [editRecetaFood, setEditRecetaFood] = useState<{ food: FoodEntry; meal: keyof MealData; initialRaciones?: number } | null>(null);
  const [recetaParaEditar, setRecetaParaEditar] = useState<Receta | null>(null);
  const recetasCacheRef = useRef<Receta[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showGoals, setShowGoals] = useState(false);
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [confirmDelete, setConfirmDelete] = useState<{ meal: keyof MealData; id: string } | null>(null);
  const [vasos, setVasos] = useState(0);
  const [streak, setStreak] = useState(0);
  const [showDuplicarCalendario, setShowDuplicarCalendario] = useState(false);
  const [duplicarComidaKey, setDuplicarComidaKey] = useState<keyof MealData | null>(null);
  const [showComerFuera, setShowComerFuera] = useState(false);
  const [tipModal, setTipModal] = useState(false);
  const tipDelDia = getTipDelDia(language);
  const [ejercicioKcal, setEjercicioKcal] = useState(0);
  const [showEjercicio, setShowEjercicio] = useState(false);
  const [ejercicioTipo, setEjercicioTipo] = useState("running");
  const [ejercicioMins, setEjercicioMins] = useState("30");
  const [nuevoLogro, setNuevoLogro] = useState<Logro | null>(null);
  const [sesionesHoy, setSesionesHoy] = useState<SesionEjercicio[]>([]);
  const [pesoKg, setPesoKg] = useState(70);
  const [userCountry, setUserCountry] = useState("");
  const [userCity, setUserCity] = useState("");
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [restaurantesCercanos, setRestaurantesCercanos] = useState<RestauranteCercano[]>([]);
  const [modoCercanos, setModoCercanos] = useState<"cercanos" | "popular">("popular");
  const [restauranteActivo, setRestauranteActivo] = useState<RestauranteCercano | null>(null);
  const [nearbyError, setNearbyError] = useState<"ubicacion" | null>(null);
  const [platoParaAnadir, setPlatoParaAnadir] = useState<PlatoParaAnadir | null>(null);
  const [mealComerFuera, setMealComerFuera] = useState<keyof MealData>("comida");

  // ── Plan semanal ──────────────────────────────────────────────────────────
  const [planModal, setPlanModal] = useState(false);
  const [planStep, setPlanStep] = useState<"cuisine" | "restriction" | "budget" | "cooking" | "generating">("cuisine");
  const [planCuisine, setPlanCuisine] = useState("mixed");
  const [planRestriction, setPlanRestriction] = useState("none");
  const [planBudget, setPlanBudget] = useState("medium");
  const [planCookingTime, setPlanCookingTime] = useState("medium");
  const [weeklyPlan, setWeeklyPlan] = useState<any>(null);
  const [planError, setPlanError] = useState("");
  const [planDayIdx, setPlanDayIdx] = useState(0);
  const [planSwapModal, setPlanSwapModal] = useState<{ dayIdx: number; mealKey: string; type: "meal" | "ingredient"; ingIdx?: number } | null>(null);

  const isToday = isSameDay(currentDate, new Date());
  const storageKey = dateToKey(currentDate);

  const MEAL_LABELS: Record<keyof MealData, string> = {
    desayuno: t.breakfast, snack1: t.snack1Label, comida: t.lunch,
    merienda: t.snack, cena: t.dinner, snack2: t.snack2Label,
  };
  const MEAL_ICONS: Record<keyof MealData, string> = {
    desayuno: "🌅", snack1: "🥜", comida: "☀️",
    merienda: "🍎", cena: "🌙", snack2: "🥛",
  };

  function formatDateLabel(date: Date): string {
    if (isSameDay(date, new Date())) return t.today;
    if (isSameDay(date, addDays(new Date(), -1))) return t.yesterday;
    if (isSameDay(date, addDays(new Date(), 1))) return t.tomorrow;
    return date.toLocaleDateString(
      language === "en" ? "en-GB" : language === "fr" ? "fr-FR" : language === "de" ? "de-DE" : language === "zh" ? "zh-CN" : "es-ES",
      { weekday: "long", day: "numeric", month: "long" }
    );
  }

  const BASE_MEALS: MealData = { desayuno: [], snack1: [], comida: [], merienda: [], cena: [], snack2: [] };

  const loadMeals = async (date: Date, skipCloud = false, showSpinner = true) => {
    try {
      if (showSpinner) setCargandoComidas(true);
      const key = dateToKey(date);
      // 1. Mostrar datos locales inmediatamente
      const stored = await AsyncStorage.getItem(key);
      // Merge with BASE_MEALS to ensure all keys always exist (prevents undefined render crash)
      const localMeals: MealData = stored
        ? { ...BASE_MEALS, ...JSON.parse(stored) }
        : EMPTY_MEALS;
      setMeals(localMeals);
      setCargandoComidas(false);
      // 2. Cargar desde cloud y fusionar (saltar si datos recientes para ahorrar peticiones)
      if (skipCloud || Date.now() - lastCloudLoadRef.current < 8000) return;
      lastCloudLoadRef.current = Date.now();
      const cloudResult = await loadDayFromCloud(key);
      if (cloudResult) {
        const { comidas: cloudMeals, cloudTs } = cloudResult;
        const merged: MealData = {
          desayuno: [...(cloudMeals.desayuno ?? [])],
          snack1:   [...(cloudMeals.snack1 ?? [])],
          comida:   [...(cloudMeals.comida ?? [])],
          merienda: [...(cloudMeals.merienda ?? [])],
          cena:     [...(cloudMeals.cena ?? [])],
          snack2:   [...(cloudMeals.snack2 ?? [])],
        };
        let hasOffline = false;
        for (const meal of Object.keys(merged) as (keyof MealData)[]) {
          for (const li of localMeals[meal]) {
            if (!merged[meal].some((ci: any) => ci.id === li.id)) {
              const itemTs = parseInt(li.id);
              if (!isNaN(itemTs) && itemTs > cloudTs) {
                merged[meal].push(li);
                hasOffline = true;
              }
            }
          }
        }
        if (hasOffline) syncDayToCloud(key, merged);
        setMeals(merged);
        await AsyncStorage.setItem(key, JSON.stringify(merged));
      }
    } catch { setMeals(EMPTY_MEALS); setCargandoComidas(false); }
  };

  const loadGoals = async () => {
    try {
      const stored = await AsyncStorage.getItem(GOALS_KEY);
      if (stored) setGoals(JSON.parse(stored));
      // Actualizar con datos cloud
      const cloud = await loadGoalsFromCloud();
      if (cloud) {
        setGoals(cloud);
        await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(cloud));
      }
    } catch (e: any) { console.warn("loadGoals:", e?.message); }
  };

  const loadWater = async (date: Date) => {
    try {
      const stored = await AsyncStorage.getItem(waterKey(date));
      setVasos(stored ? Number(stored) : 0);
      // Actualizar con datos cloud
      const fecha = waterKey(date).replace("nutri_water_", "");
      const cloud = await loadWaterFromCloud(fecha);
      if (cloud !== null) {
        setVasos(cloud);
        await AsyncStorage.setItem(waterKey(date), String(cloud));
      }
    } catch { setVasos(0); }
  };

  // Carga inicial + suscripción a señal de add-food
  useEffect(() => {
    loadMeals(currentDate);
    loadWater(currentDate);
    loadGoals();
    // Migrar datos locales al cloud la primera vez (en background)
    migrateLocalToCloud();

    const unsub = subscribeMealUpdates(({ meals, dateKey }) => {
      const parts = dateKey.replace("nutri_meals_", "").split("-");
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      setCurrentDate(date);
      setMeals({ desayuno: [], comida: [], merienda: [], cena: [], ...(meals as MealData) });
      setCargandoComidas(false);
      // Marcar cloud como reciente para que useFocusEffect no lo vuelva a pedir
      lastCloudLoadRef.current = Date.now();
      loadWater(date);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: sincronizar comidas y agua entre dispositivos
  const setMealsRef = useRef(setMeals);
  const setVasosRef = useRef(setVasos);
  const currentDateRef = useRef(currentDate);
  const tRef = useRef(t);
  useEffect(() => { currentDateRef.current = currentDate; }, [currentDate]);
  useEffect(() => { tRef.current = t; }, [t]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      channel = supabase.channel(`nutri-sync-${uid}`)
        .on('postgres_changes' as any, {
          event: '*', schema: 'public', table: 'registros_diarios',
          filter: `user_id=eq.${uid}`,
        }, async (payload: any) => {
          const fecha = payload.new?.fecha ?? payload.old?.fecha;
          if (!fecha) return;
          const cur = currentDateRef.current;
          const curFecha = dateToKey(cur).replace('nutri_meals_', '');
          if (fecha !== curFecha) return;
          // Cargar desde cloud sin mezclar con local (autoritativo)
          const cloudResult = await loadDayFromCloud(dateToKey(cur));
          if (cloudResult !== null) {
            setMealsRef.current(cloudResult.comidas);
            await AsyncStorage.setItem(dateToKey(cur), JSON.stringify(cloudResult.comidas));
          }
        })
        .on('postgres_changes' as any, {
          event: '*', schema: 'public', table: 'agua_diaria',
          filter: `user_id=eq.${uid}`,
        }, async (payload: any) => {
          const fecha = payload.new?.fecha ?? payload.old?.fecha;
          if (!fecha) return;
          const cur = currentDateRef.current;
          const curFecha = dateToKey(cur).replace('nutri_meals_', '');
          if (fecha !== curFecha) return;
          const vasos = payload.new?.vasos ?? 0;
          setVasosRef.current(vasos);
          await AsyncStorage.setItem(`nutri_water_${fecha}`, String(vasos));
        })
        .subscribe();
    });
    return () => { if (channel) supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Popup tip del día — una vez al día al abrir la app
  useEffect(() => {
    AsyncStorage.getItem(getTipShownKey()).then(v => { if (!v) setTipModal(true); });
    cargarEjercicio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cerrarTipModal = async () => {
    await AsyncStorage.setItem(getTipShownKey(), '1');
    setTipModal(false);
  };

  const ejercicioKeyHoy = () => {
    const d = new Date();
    return `${EJERCICIO_KEY_PREFIX}${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  const cargarEjercicio = async () => {
    try {
      const [ej, prof] = await Promise.all([
        AsyncStorage.getItem(ejercicioKeyHoy()),
        AsyncStorage.getItem(PROFILE_KEY),
      ]);
      setEjercicioKcal(ej ? Number(ej) : 0);
      if (prof) { const p = JSON.parse(prof); if (p?.peso) setPesoKg(Number(p.peso)); }
      const sesiones = await obtenerSesionesHoy();
      setSesionesHoy(sesiones);
    } catch (e: any) { console.warn("cargarEjercicio:", e?.message); }
  };

  const guardarEjercicio = async () => {
    const mins = Number(ejercicioMins) || 0;
    if (mins <= 0) return;
    const met = MET[ejercicioTipo] ?? 5;
    const kcal = Math.round(met * pesoKg * (mins / 60));
    const nuevo = ejercicioKcal + kcal;
    setEjercicioKcal(nuevo);
    await AsyncStorage.setItem(ejercicioKeyHoy(), String(nuevo));

    // Registrar sesión y obtener nuevos logros desbloqueados
    const logrosNuevos = await registrarSesionEjercicio(MET_LABELS[ejercicioTipo] ?? ejercicioTipo, mins, kcal);
    const sesiones = await obtenerSesionesHoy();
    setSesionesHoy(sesiones);
    if (logrosNuevos.length > 0) setNuevoLogro(logrosNuevos[0]);

    setShowEjercicio(false);
    setEjercicioMins("30");
  };

  const eliminarEjercicio = async (sesion: SesionEjercicio) => {
    const { sesionesHoy: nuevas, kcalHoy } = await eliminarSesionEjercicio(sesion);
    setSesionesHoy(nuevas);
    setEjercicioKcal(kcalHoy);
    await AsyncStorage.setItem(ejercicioKeyHoy(), String(kcalHoy));
  };

  // Recarga al enfocar la pantalla (vuelta desde cualquier pantalla, cambio de día)
  useFocusEffect(React.useCallback(() => {
    // Cargar frecuencia de comidas y plan semanal
    AsyncStorage.getItem(MEAL_FREQUENCY_KEY).then(v => { if (v) setMealFrequency(v); });
    AsyncStorage.getItem("nutri_weekly_plan").then(v => { if (v) try { setWeeklyPlan(JSON.parse(v)); } catch (e: any) { console.warn("weeklyPlan parse:", e?.message); } });
    // Si el cloud fue actualizado hace menos de 8s (p.ej. por signal de add-food), saltar cloud
    const skipCloud = Date.now() - lastCloudLoadRef.current < 8000;
    loadMeals(currentDate, skipCloud, false);
    loadWater(currentDate);
    loadGoals();
    actualizarRacha().then(setStreak);
    obtenerSesionesHoy().then(setSesionesHoy);
    // Siempre refrescar la caché al volver a la pantalla
    recetasCacheRef.current = [];
    obtenerRecetas().then(r => { recetasCacheRef.current = r; }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]));

  // ── Plan semanal: generar y swap ──────────────────────────────────────────
  const generatePlan = async () => {
    if (!isOnline) { setPlanError(t.noConnection); return; }
    setPlanStep("generating"); setPlanError("");
    try {
      const profile = await supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return null;
        const { data } = await supabase.from("perfiles").select("*").eq("id", session.user.id).single();
        return data;
      });
      if (!profile) { setPlanError("Perfil no encontrado"); setPlanStep("cuisine"); return; }
      const goalsRaw = await AsyncStorage.getItem("nutri_daily_goals");
      const g = goalsRaw ? JSON.parse(goalsRaw) : { calories: 2000, protein: 150, carbs: 250, fat: 65 };
      const mealFreq = (await AsyncStorage.getItem(MEAL_FREQUENCY_KEY)) || "4";
      const alergiasRaw = await AsyncStorage.getItem("nutri_alergias");
      const alergias = alergiasRaw ? JSON.parse(alergiasRaw) : [];
      const baseUrl = Platform.OS === "web" ? "" : (process.env.EXPO_PUBLIC_API_URL || "https://mi-nutri-app-theta.vercel.app");
      const { data: { session: authSes } } = await supabase.auth.getSession();
      const res = await fetch(`${baseUrl}/api/generate-meal-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authSes?.access_token ? { "Authorization": `Bearer ${authSes.access_token}` } : {}) },
        body: JSON.stringify({
          weight: profile.peso, height: profile.altura, age: profile.edad,
          sex: profile.sexo, activity: profile.actividad, goal: profile.objetivo,
          mealFrequency: mealFreq, allergies: alergias,
          cuisine: planCuisine, restriction: planRestriction,
          budget: planBudget, cookingTime: planCookingTime, language,
          calorieGoal: g.calories, proteinGoal: g.protein, carbsGoal: g.carbs, fatGoal: g.fat,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: "Error" })); setPlanError(err.error || "Error"); setPlanStep("cuisine"); return; }
      const plan = await res.json();
      setWeeklyPlan(plan); await AsyncStorage.setItem("nutri_weekly_plan", JSON.stringify(plan));
      setPlanModal(false); setPlanDayIdx(0);
    } catch (e: any) { setPlanError(e.message || "Error"); setPlanStep("cuisine"); }
  };

  const swapMealInPlan = (dayIdx: number, mealKey: string, altIdx: number) => {
    if (!weeklyPlan) return;
    const updated = { ...weeklyPlan, days: [...weeklyPlan.days] };
    const day = { ...updated.days[dayIdx], meals: { ...updated.days[dayIdx].meals } };
    const current = day.meals[mealKey];
    const alt = current.alternatives[altIdx];
    day.meals[mealKey] = { ...alt, alternatives: [current, ...current.alternatives.filter((_: any, i: number) => i !== altIdx)] };
    updated.days[dayIdx] = day;
    setWeeklyPlan(updated); AsyncStorage.setItem("nutri_weekly_plan", JSON.stringify(updated));
    setPlanSwapModal(null);
  };

  const swapIngredientInPlan = (dayIdx: number, mealKey: string, ingIdx: number, altIdx: number) => {
    if (!weeklyPlan) return;
    const updated = { ...weeklyPlan, days: [...weeklyPlan.days] };
    const day = { ...updated.days[dayIdx], meals: { ...updated.days[dayIdx].meals } };
    const meal = { ...day.meals[mealKey], ingredients: [...day.meals[mealKey].ingredients] };
    const cur = meal.ingredients[ingIdx]; const alt = cur.alternatives[altIdx];
    meal.ingredients[ingIdx] = { ...alt, alternatives: [{ name: cur.name, grams: cur.grams, kcal: cur.kcal, protein: cur.protein, carbs: cur.carbs, fat: cur.fat, alternatives: [] }, ...cur.alternatives.filter((_: any, i: number) => i !== altIdx)] };
    day.meals[mealKey] = meal; updated.days[dayIdx] = day;
    setWeeklyPlan(updated); AsyncStorage.setItem("nutri_weekly_plan", JSON.stringify(updated));
    setPlanSwapModal(null);
  };

  const addPlanMealToDay = async (mealKey: string, meal: any) => {
    const key = storageKey;
    const stored = await AsyncStorage.getItem(key);
    const base: MealData = { desayuno: [], snack1: [], comida: [], merienda: [], cena: [], snack2: [] };
    const current: MealData = stored ? { ...base, ...JSON.parse(stored) } : base;
    const mk = mealKey as keyof MealData;
    const newEntries: FoodEntry[] = (meal.ingredients ?? []).map((ing: any) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: `${ing.name} (${meal.name})`,
      calories: Math.round(ing.kcal ?? 0),
      protein: Math.round((ing.protein ?? 0) * 10) / 10,
      carbs: Math.round((ing.carbs ?? 0) * 10) / 10,
      fat: Math.round((ing.fat ?? 0) * 10) / 10,
      per100: {
        calories: ing.grams > 0 ? Math.round((ing.kcal / ing.grams) * 100) : 0,
        protein: ing.grams > 0 ? Math.round(((ing.protein ?? 0) / ing.grams) * 1000) / 10 : 0,
        carbs: ing.grams > 0 ? Math.round(((ing.carbs ?? 0) / ing.grams) * 1000) / 10 : 0,
        fat: ing.grams > 0 ? Math.round(((ing.fat ?? 0) / ing.grams) * 1000) / 10 : 0,
        saturatedFat: 0, sugar: 0, fiber: 0, salt: 0,
      },
    }));
    current[mk] = [...(current[mk] ?? []), ...newEntries];
    await AsyncStorage.setItem(key, JSON.stringify(current));
    syncDayToCloud(key, current);
    setMeals(current);
    Alert.alert("✅", `${meal.name} → ${t.breakfast === MEAL_LABELS[mk] ? MEAL_LABELS[mk] : MEAL_LABELS[mk]}`);
  };

  // Sync native home screen widget (Android + iOS) when data changes
  useEffect(() => {
    if (Platform.OS === "web" || !NativeModules.SharedPrefs) return;
    const t = Object.values(meals).flat().reduce(
      (acc, f) => ({ calories: acc.calories + f.calories, protein: acc.protein + f.protein, carbs: acc.carbs + f.carbs, fat: acc.fat + f.fat }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
    try {
      NativeModules.SharedPrefs.setMacros({
        cals:    Math.round(t.calories),
        calGoal: goals.calories,
        protein: Math.round(t.protein),
        carbs:   Math.round(t.carbs),
        fat:     Math.round(t.fat),
      });
    } catch {}
  }, [meals, goals, ejercicioKcal]);

  const saveGoals = async (newGoals: typeof DEFAULT_GOALS) => {
    setGoals(newGoals);
    await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(newGoals));
    syncGoalsToCloud(newGoals);
  };

  const goToDay = (date: Date) => { setCurrentDate(date); loadMeals(date); loadWater(date); };

  const addWater = useCallback(async () => {
    setVasos(prev => {
      if (prev >= WATER_GOAL) return prev;
      const nuevo = prev + 1;
      const key = waterKey(currentDateRef.current);
      AsyncStorage.setItem(key, String(nuevo)).catch(() => {});
      syncWaterToCloud(key.replace("nutri_water_", ""), nuevo);
      if (nuevo === WATER_GOAL) {
        registrarAguaCompletada().then(logros => {
          if (logros.length > 0) setNuevoLogro(logros[0]);
          else Alert.alert(tRef.current.waterGoalReached, tRef.current.drankAllGlasses, [{ text: tRef.current.understood }]);
        });
      }
      return nuevo;
    });
  }, []);

  const removeWater = useCallback(async () => {
    setVasos(prev => {
      if (prev === 0) return prev;
      const nuevo = prev - 1;
      const key = waterKey(currentDateRef.current);
      AsyncStorage.setItem(key, String(nuevo)).catch(() => {});
      syncWaterToCloud(key.replace("nutri_water_", ""), nuevo);
      return nuevo;
    });
  }, []);

  const duplicarDia = () => {
    const totalAlimentos = Object.values(meals).flat().length;
    if (totalAlimentos === 0) { Alert.alert(t.noMeals, t.noFoodsToday); return; }
    setShowDuplicarCalendario(true);
  };

  const copiarA = async (targetDate: Date) => {
    try {
      const targetKey = dateToKey(targetDate);
      const nuevosMeals: MealData = {
        desayuno: (meals.desayuno ?? []).map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
        snack1: (meals.snack1 ?? []).map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
        comida: (meals.comida ?? []).map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
        merienda: (meals.merienda ?? []).map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
        cena: (meals.cena ?? []).map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
        snack2: (meals.snack2 ?? []).map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
      };
      await AsyncStorage.setItem(targetKey, JSON.stringify(nuevosMeals));
      syncDayToCloud(targetKey, nuevosMeals);
      const fechaLabel = targetDate.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
      Alert.alert(t.copied, `Las comidas se han copiado al ${fechaLabel}.`, [
        { text: t.viewThatDay, onPress: () => goToDay(targetDate) },
        { text: t.ok }
      ]);
    } catch { Alert.alert(t.error, t.couldNotDuplicate); }
  };

  const copiarComidaA = async (targetDate: Date) => {
    if (!duplicarComidaKey) return;
    const meal = duplicarComidaKey;
    try {
      const targetKey = dateToKey(targetDate);
      const stored = await AsyncStorage.getItem(targetKey);
      const targetMeals: MealData = stored ? JSON.parse(stored) : { desayuno: [], comida: [], merienda: [], cena: [] };
      const nuevosItems = meals[meal].map(f => ({ ...f, id: Date.now().toString() + Math.random() }));
      targetMeals[meal] = [...targetMeals[meal], ...nuevosItems];
      await AsyncStorage.setItem(targetKey, JSON.stringify(targetMeals));
      syncDayToCloud(targetKey, targetMeals);
      const fechaLabel = targetDate.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
      Alert.alert(t.copied, `${MEAL_LABELS[meal]} copiado al ${fechaLabel}.`, [
        { text: t.viewThatDay, onPress: () => goToDay(targetDate) },
        { text: t.ok }
      ]);
    } catch { Alert.alert(t.error, t.couldNotDuplicate); }
    setDuplicarComidaKey(null);
  };

  const buscarCercanos = async (lat: number, lon: number, country: string) => {
    setLoadingNearby(true);
    setRestaurantesCercanos([]);
    setRestauranteActivo(null);
    const result = await buscarRestaurantesCercanos(lat, lon, country);
    setModoCercanos(result.modo ?? "popular");
    setRestaurantesCercanos(result.restaurantes);
    setLoadingNearby(false);
  };

  const obtenerUbicacion = () => {
    if (loadingLocation) return;
    setNearbyError(null);
    setLoadingLocation(true);
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          setUserLat(latitude);
          setUserLon(longitude);
          let cc = userCountry;
          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
              { headers: { "User-Agent": "mi-nutri-app/1.0" } }
            );
            const data = await res.json();
            cc = (data.address?.country_code || "").toLowerCase();
            const city = data.address?.city || data.address?.town || data.address?.village || "";
            setUserCountry(cc);
            setUserCity(city ? `${city}${cc ? ", " + cc.toUpperCase() : ""}` : cc.toUpperCase());
          } catch (e: any) { console.warn("geocoding:", e?.message); }
          setLoadingLocation(false);
          buscarCercanos(latitude, longitude, cc);
        },
        () => {
          setLoadingLocation(false);
          setNearbyError("ubicacion");
          // Still show popular chains even without GPS
          buscarRestaurantesPopulares(userCountry).then(r => {
            setModoCercanos("popular");
            setRestaurantesCercanos(r.restaurantes);
          });
        },
        { timeout: 10000 }
      );
    } else {
      setLoadingLocation(false);
      buscarRestaurantesPopulares(userCountry).then(r => {
        setModoCercanos("popular");
        setRestaurantesCercanos(r.restaurantes);
      });
    }
  };

  const anadirPlatoRapido = async (plato: PlatoParaAnadir, meal: keyof MealData) => {
    try {
      const key = dateToKey(currentDate);
      const stored = await AsyncStorage.getItem(key);
      const base = { desayuno: [] as any[], comida: [] as any[], merienda: [] as any[], cena: [] as any[] };
      const updated = stored ? { ...base, ...JSON.parse(stored) } : base;
      const entrada = {
        id: Date.now().toString(),
        name: plato.nombre,
        brand: plato.restaurante || "Restaurante",
        supermercado: "Restaurante",
        calories: plato.calorias,
        protein: plato.proteinas,
        carbs: plato.carbs,
        fat: plato.grasas,
        per100: null,
      };
      updated[meal] = [...updated[meal], entrada];
      await AsyncStorage.setItem(key, JSON.stringify(updated));
      syncDayToCloud(key, updated);
      signalMealSaved(updated, key);
      setPlatoParaAnadir(null);
    } catch { Alert.alert(t.error, t.couldNotAddDish); }
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 40 && Math.abs(g.dy) < 20 && Math.abs(g.dx) > Math.abs(g.dy) * 3,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -80) { setCurrentDate((prev) => { const n = addDays(prev, 1); loadMeals(n); loadWater(n); return n; }); }
        else if (g.dx > 80) { setCurrentDate((prev) => { const n = addDays(prev, -1); loadMeals(n); loadWater(n); return n; }); }
      },
    })
  ).current;

  const removeFood = (meal: keyof MealData, id: string) => { setConfirmDelete({ meal, id }); };

  const confirmRemove = async () => {
    if (!confirmDelete) return;
    const { meal, id } = confirmDelete;
    const key = dateToKey(currentDate);
    setConfirmDelete(null);
    const updated = { ...meals, [meal]: meals[meal].filter((f) => f.id !== id) };
    setMeals(updated);
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    syncDayToCloud(key, updated);
  };

  const openEditFood = async (food: FoodEntry, meal: keyof MealData) => {
    if (food.per100 == null) {
      const baseName = ((food as any).recetaNombre as string | undefined)
        ?? food.name.replace(/\s*\(×[\d.]+\)$/, "");
      try {
        // Use cached list first (instant); fetch fresh if cache is empty
        const cached = recetasCacheRef.current;
        const lista = cached.length > 0 ? cached : await obtenerRecetas();
        if (cached.length === 0) recetasCacheRef.current = lista;
        const receta = lista.find(r => r.nombre === baseName);
        if (receta) {
          // Compute how many raciones the stored entry represents
          const rBase = receta.raciones ?? 1;
          const calPorRacion = rBase > 0 ? receta.calorias_total / rBase : receta.calorias_total;
          const initialRaciones = calPorRacion > 0
            ? Math.max(0.25, Math.round((food.calories / calPorRacion) * 4) / 4)
            : rBase;
          // Restore previously modified ingredient grams if stored on the food entry
          const storedGramos = (food as any).ingredientesGramos as number[] | undefined;
          const recetaConGramos: Receta = storedGramos && storedGramos.length === receta.ingredientes.length
            ? { ...receta, ingredientes: receta.ingredientes.map((ing, i) => ({ ...ing, gramos: storedGramos[i] })) }
            : receta;
          setEditRecetaFood({ food, meal, initialRaciones });
          setRecetaParaEditar(recetaConGramos);
          return;
        }
      } catch (e: any) { console.warn("editFood recipe lookup:", e?.message); }
      // Community/external recipe — look up in saved recipes (have full ingredients)
      const raciones = (food as any).raciones ?? 1;
      try {
        const savedRaw = await AsyncStorage.getItem("nutri_recetas_guardadas");
        if (savedRaw) {
          const savedList = JSON.parse(savedRaw) as any[];
          const guardada = savedList.find((g: any) => g.nombre === baseName || g.pub_id === (food as any).pub_id);
          if (guardada && Array.isArray(guardada.ingredientes) && guardada.ingredientes.length > 0) {
            const ings: any[] = guardada.ingredientes;
            const totalG = ings.reduce((s: number, i: any) => s + (i.gramos || 0), 0);
            const recetaFromSaved = {
              nombre: baseName,
              descripcion: guardada.descripcion ?? "",
              raciones: 1,
              calorias_total: guardada.calorias_total,
              proteinas_total: guardada.proteinas_total,
              carbohidratos_total: guardada.carbohidratos_total,
              grasas_total: guardada.grasas_total,
              ingredientes: ings.map((ing: any) => {
                const frac = totalG > 0 ? (ing.gramos || 0) / totalG : 0;
                return {
                  nombre: ing.nombre,
                  gramos: ing.gramos || 0,
                  calorias: guardada.calorias_total * frac,
                  proteinas: guardada.proteinas_total * frac,
                  carbs: guardada.carbohidratos_total * frac,
                  grasas: guardada.grasas_total * frac,
                };
              }),
            } as unknown as Receta;
            setEditRecetaFood({ food, meal, initialRaciones: raciones });
            setRecetaParaEditar(recetaFromSaved);
            return;
          }
        }
      } catch (e: any) { console.warn("editFood saved recipes lookup:", e?.message); }
      // Fallback: try fetching from Supabase by recipe name
      try {
        const { data } = await supabase
          .from("publicaciones_recetas")
          .select("nombre_receta,descripcion,ingredientes,calorias_total,proteinas_total,grasas_total,carbohidratos_total")
          .eq("nombre_receta", baseName)
          .limit(1)
          .single();
        if (data && Array.isArray(data.ingredientes) && data.ingredientes.length > 0) {
          const ings: any[] = data.ingredientes;
          const totalG = ings.reduce((s: number, i: any) => s + (i.gramos || 0), 0);
          const recetaFromPub = {
            nombre: baseName,
            descripcion: data.descripcion ?? "",
            raciones: 1,
            calorias_total: data.calorias_total,
            proteinas_total: data.proteinas_total,
            carbohidratos_total: data.carbohidratos_total,
            grasas_total: data.grasas_total,
            ingredientes: ings.map((ing: any) => {
              const frac = totalG > 0 ? (ing.gramos || 0) / totalG : 0;
              return {
                nombre: ing.nombre,
                gramos: ing.gramos || 0,
                calorias: data.calorias_total * frac,
                proteinas: data.proteinas_total * frac,
                carbs: data.carbohidratos_total * frac,
                grasas: data.grasas_total * frac,
              };
            }),
          } as unknown as Receta;
          setEditRecetaFood({ food, meal, initialRaciones: raciones });
          setRecetaParaEditar(recetaFromPub);
          return;
        }
      } catch (e: any) { console.warn("editFood supabase lookup:", e?.message); }
      // Last resort: no ingredient data available, fall through to EditGramosModal
      setEditFood({ food, meal });
      return;
    }
    setEditFood({ food, meal });
  };

  const saveEditedReceta = async (kcal: number, prot: number, carb: number, gras: number, nombre: string, newMeal: MealKey, raciones: number = 1, ingredientesGramos?: number[]) => {
    if (!editRecetaFood) return;
    const { food, meal: oldMeal } = editRecetaFood;
    const recetaNombre = (food as any).recetaNombre ?? nombre.replace(/\s*\(×[\d.]+\)$/, "");
    const updated = {
      ...meals,
      [oldMeal]: (meals[oldMeal] ?? []).map((f) =>
        f.id !== food.id ? f : { ...f, name: nombre, calories: kcal, protein: prot, carbs: carb, fat: gras, recetaNombre, raciones, ingredientesGramos }
      ),
    };
    // Write BEFORE closing so useFocusEffect reads fresh data if it fires on modal close
    await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
    lastCloudLoadRef.current = Date.now(); // prevent useFocusEffect from reloading over our data
    syncDayToCloud(storageKey, updated);
    setMeals(updated);
    setEditRecetaFood(null);
    setRecetaParaEditar(null);
  };

  const saveEditedGramos = async (newGramos: number, porcionIdx: number | null, porcionCantidad: string) => {
    if (!editFood) return;
    const { food, meal } = editFood;
    const p = food.per100;
    if (!p) {
      // Receta o alimento sin datos por 100g: escalar proporcionalmente (100 = 1 ración completa)
      const oldGramos = calcularGramosActuales(food) || 100;
      const ratio = newGramos / oldGramos;
      const updatedRecipe = {
        ...meals,
        [meal]: (meals[meal] ?? []).map(f => f.id !== food.id ? f : {
          ...f,
          calories: Math.round(food.calories * ratio),
          protein: Number((food.protein * ratio).toFixed(1)),
          carbs: Number((food.carbs * ratio).toFixed(1)),
          fat: Number((food.fat * ratio).toFixed(1)),
        }),
      };
      setMeals(updatedRecipe);
      await AsyncStorage.setItem(storageKey, JSON.stringify(updatedRecipe));
      syncDayToCloud(storageKey, updatedRecipe);
      setEditFood(null);
      return;
    }
    const updated = {
      ...meals,
      [meal]: meals[meal].map((f) => f.id !== food.id ? f : {
        ...f,
        calories: Math.round((p.calories * newGramos) / 100),
        protein: Number(((p.protein * newGramos) / 100).toFixed(1)),
        carbs: Number(((p.carbs * newGramos) / 100).toFixed(1)),
        fat: Number(((p.fat * newGramos) / 100).toFixed(1)),
        saturatedFat: Number(((p.saturatedFat * newGramos) / 100).toFixed(1)),
        sugar: Number(((p.sugar * newGramos) / 100).toFixed(1)),
        fiber: Number(((p.fiber * newGramos) / 100).toFixed(1)),
        salt: Number(((p.salt * newGramos) / 100).toFixed(3)),
        porcionUsadaIdx: porcionIdx ?? undefined,
        porcionUsadaCantidad: porcionIdx !== null ? porcionCantidad : undefined,
      }),
    };
    setMeals(updated);
    await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
    syncDayToCloud(storageKey, updated);
    setEditFood(null);
  };

  const totals = Object.values(meals).flat().filter(Boolean).reduce(
    (acc, f) => ({ calories: acc.calories + (f.calories || 0), protein: acc.protein + (f.protein || 0), carbs: acc.carbs + (f.carbs || 0), fat: acc.fat + (f.fat || 0) }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const mealTotals = (entries: FoodEntry[]) => ({
    calories: (entries ?? []).reduce((a, f) => a + (f.calories || 0), 0),
    protein: (entries ?? []).reduce((a, f) => a + (f.protein || 0), 0),
    carbs: (entries ?? []).reduce((a, f) => a + (f.carbs || 0), 0),
    fat: (entries ?? []).reduce((a, f) => a + (f.fat || 0), 0),
  });

  const calObjetivo = goals.calories;
  const calPct = Math.min((totals.calories / calObjetivo) * 100, 100);
  const calExcedidas = totals.calories > calObjetivo;
  const restantes = Math.abs(calObjetivo - Math.round(totals.calories));
  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <EditGramosModal visible={!!editFood} food={editFood?.food ?? null} onClose={() => setEditFood(null)} onSave={saveEditedGramos} />
      <AnadirRecetaModal
        receta={recetaParaEditar}
        visible={!!editRecetaFood && !!recetaParaEditar}
        initialMeal={editRecetaFood?.meal as MealKey | undefined}
        initialRaciones={editRecetaFood?.initialRaciones}
        onClose={() => { setEditRecetaFood(null); setRecetaParaEditar(null); }}
        onAdd={saveEditedReceta}
        hideMealSelector
        dateKey={storageKey}
      />
      <GoalsModal visible={showGoals} goals={goals} onClose={() => setShowGoals(false)} onSave={saveGoals} />
      <CalendarioModal visible={showCalendar} selectedDate={currentDate} onClose={() => setShowCalendar(false)} onSelect={goToDay} />

      {/* ── Toast de logro desbloqueado ── */}
      <Modal visible={!!nuevoLogro} transparent animationType="fade" onRequestClose={() => setNuevoLogro(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000AA", justifyContent: "center", alignItems: "center", padding: 32 }} activeOpacity={1} onPress={() => setNuevoLogro(null)}>
          <View style={{ backgroundColor: colors.card, borderRadius: 24, padding: 32, alignItems: "center", borderWidth: 2, borderColor: "#FBBF24", gap: 12, maxWidth: 300 }}>
            <Text style={{ fontSize: 64 }}>{nuevoLogro?.emoji}</Text>
            <Text style={{ color: "#FBBF24", fontSize: 11, fontWeight: "800", letterSpacing: 2 }}>{t.medalUnlocked}</Text>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900", textAlign: "center" }}>{nuevoLogro?.titulo}</Text>
            <Text style={{ color: colors.textSub, fontSize: 14, textAlign: "center", lineHeight: 20 }}>{nuevoLogro?.descripcion}</Text>
            <TouchableOpacity onPress={() => setNuevoLogro(null)} style={{ marginTop: 8, backgroundColor: "#FBBF24", borderRadius: 14, paddingHorizontal: 28, paddingVertical: 12 }}>
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 15 }}>{t.niceExcl}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000AA", justifyContent: "center", alignItems: "center", padding: 24 }} activeOpacity={1} onPress={() => setConfirmDelete(null)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.card, borderRadius: 20, padding: 24, width: "100%", borderWidth: 1, borderColor: colors.cardBorder, gap: 16 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>{t.deleteFood}</Text>
            <Text style={{ color: colors.textSub, fontSize: 14 }}>{t.deleteFoodConfirm}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 14, alignItems: "center" }} onPress={() => setConfirmDelete(null)}>
                <Text style={{ color: colors.textSub, fontWeight: "700", fontSize: 15 }}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: "#EF444422", borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: "#EF444455" }} onPress={confirmRemove}>
                <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 15 }}>{t.delete}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Popup tip del día — aparece una vez al día */}
      <Modal visible={tipModal} transparent animationType="fade" onRequestClose={cerrarTipModal}>
        <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 24, padding: 28, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: colors.cardBorder }}>
            <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 10 }}>{tipDelDia.icono}</Text>
            <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center', marginBottom: 8 }}>💡 {t.tipOfDay}</Text>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center', marginBottom: 14, lineHeight: 24 }}>{tipDelDia.titulo}</Text>
            <Text style={{ color: colors.textSub, fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 26 }}>{tipDelDia.contenido}</Text>
            <TouchableOpacity onPress={cerrarTipModal} style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }} activeOpacity={0.8}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{t.understood} ✓</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Calendario para duplicar día completo */}
      <CalendarioModal
        visible={showDuplicarCalendario}
        selectedDate={currentDate}
        onClose={() => setShowDuplicarCalendario(false)}
        onSelect={(date) => {
          setShowDuplicarCalendario(false);
          copiarA(date);
        }}
      />
      {/* Calendario para duplicar una comida */}
      <CalendarioModal
        visible={!!duplicarComidaKey}
        selectedDate={currentDate}
        onClose={() => setDuplicarComidaKey(null)}
        onSelect={(date) => {
          setDuplicarComidaKey(null);
          copiarComidaA(date);
        }}
      />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + 8 }}>
        <View style={s.header}>
          <View style={s.dateNav} {...panResponder.panHandlers}>
            <TouchableOpacity style={s.dateNavBtn} onPress={() => goToDay(addDays(currentDate, -1))}>
              <Text style={s.dateNavArrow}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.dateTitleWrap} onPress={() => setShowCalendar(true)}>
              <Text style={s.dateTitle}>{formatDateLabel(currentDate)}</Text>
              <Text style={s.dateSub}>{currentDate.toLocaleDateString(language === "en" ? "en-GB" : language === "fr" ? "fr-FR" : language === "de" ? "de-DE" : language === "zh" ? "zh-CN" : "es-ES", { day: "numeric", month: "long", year: "numeric" })}</Text>
              <Text style={{ fontSize: 13 }}>📅</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.dateNavBtn} onPress={() => goToDay(addDays(currentDate, 1))}>
              <Text style={s.dateNavArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {isToday && (
            <>
              {streak > 0 && (
                <View style={s.streakBadge}>
                  <Text style={{ fontSize: 16 }}>🔥</Text>
                  <Text style={s.streakText}>{streak} {streak !== 1 ? t.streakDays : t.streakDay}</Text>
                </View>
              )}
              <TouchableOpacity style={s.seguimientoBtn} onPress={() => router.push("/seguimiento")}>
                <Text style={s.seguimientoBtnIcon}>📊</Text>
                <Text style={s.seguimientoBtnText}>{t.weeklyTracking}</Text>
                <Text style={s.seguimientoBtnArrow}>→</Text>
              </TouchableOpacity>

              {/* ══ PLAN SEMANAL ═══════════════════════════════════════════════ */}
              <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.cardBorder, gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: "800" }}>📋 {t.weeklyPlan}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>{t.weeklyPlanDesc}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setPlanStep("cuisine"); setPlanError(""); setPlanModal(true); }}
                    style={{ backgroundColor: "#8B5CF6", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>
                      {weeklyPlan ? "🔄 " + t.regeneratePlan : "✨ " + t.generatePlan}
                    </Text>
                  </TouchableOpacity>
                </View>

                {weeklyPlan?.days?.length > 0 && (
                  <>
                    {/* Selector de día */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {weeklyPlan.days.map((day: any, i: number) => (
                        <TouchableOpacity key={i} onPress={() => setPlanDayIdx(i)}
                          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                            backgroundColor: planDayIdx === i ? "#8B5CF622" : colors.bg,
                            borderWidth: 1, borderColor: planDayIdx === i ? "#8B5CF6" : colors.cardBorder }}>
                          <Text style={{ color: planDayIdx === i ? "#A78BFA" : colors.textMuted, fontSize: 11, fontWeight: "700" }}>
                            {day.day}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    {/* Totales del día + botón añadir todo */}
                    {weeklyPlan.days[planDayIdx]?.dayTotals && (
                      <View style={{ gap: 6 }}>
                        <View style={{ flexDirection: "row", gap: 4 }}>
                          {[
                            { val: weeklyPlan.days[planDayIdx].dayTotals.kcal, label: "kcal", color: "#4ADE80" },
                            { val: `${weeklyPlan.days[planDayIdx].dayTotals.protein}g`, label: "P", color: "#60A5FA" },
                            { val: `${weeklyPlan.days[planDayIdx].dayTotals.carbs}g`, label: "C", color: "#FBBF24" },
                            { val: `${weeklyPlan.days[planDayIdx].dayTotals.fat}g`, label: "G", color: "#F87171" },
                          ].map(m => (
                            <View key={m.label} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 8, padding: 6, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder }}>
                              <Text style={{ color: m.color, fontSize: 12, fontWeight: "800" }}>{m.val}</Text>
                              <Text style={{ color: colors.textMuted, fontSize: 8 }}>{m.label}</Text>
                            </View>
                          ))}
                        </View>
                        <TouchableOpacity
                          onPress={async () => {
                            const dayMeals = weeklyPlan.days[planDayIdx]?.meals ?? {};
                            for (const [mk, meal] of Object.entries(dayMeals) as [string, any][]) {
                              await addPlanMealToDay(mk, meal);
                            }
                          }}
                          style={{ backgroundColor: "#4ADE8018", borderRadius: 10, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: "#4ADE8033" }}>
                          <Text style={{ color: "#4ADE80", fontSize: 12, fontWeight: "800" }}>➕ {t.addToToday} — {weeklyPlan.days[planDayIdx]?.day}</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Comidas del día */}
                    {Object.entries(weeklyPlan.days[planDayIdx]?.meals ?? {}).map(([mk, meal]: [string, any]) => {
                      const SICONS: Record<string, string> = { desayuno: "🌅", snack1: "🥜", comida: "☀️", merienda: "🍎", cena: "🌙", snack2: "🥛" };
                      const SLABELS: Record<string, string> = { desayuno: t.breakfast, snack1: t.snack1Label, comida: t.lunch, merienda: t.snack, cena: t.dinner, snack2: t.snack2Label };
                      return (
                        <View key={mk} style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 10, gap: 6, borderWidth: 1, borderColor: colors.cardBorder }}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>
                              {SICONS[mk] || "🍽"} {SLABELS[mk] || mk}
                            </Text>
                            <View style={{ flexDirection: "row", gap: 6 }}>
                              <TouchableOpacity onPress={() => addPlanMealToDay(mk, meal)}
                                style={{ backgroundColor: "#4ADE8022", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#4ADE8044" }}>
                                <Text style={{ color: "#4ADE80", fontSize: 9, fontWeight: "700" }}>➕ {t.addToToday}</Text>
                              </TouchableOpacity>
                              {meal.alternatives?.length > 0 && (
                                <TouchableOpacity onPress={() => setPlanSwapModal({ dayIdx: planDayIdx, mealKey: mk, type: "meal" })}
                                  style={{ backgroundColor: "#8B5CF622", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                                  <Text style={{ color: "#C4B5FD", fontSize: 9, fontWeight: "700" }}>🔄 {t.swapMeal}</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                          <Text style={{ color: "#8B5CF6", fontSize: 12, fontWeight: "600" }}>{meal.name}</Text>
                          <View style={{ flexDirection: "row", gap: 6 }}>
                            <Text style={{ color: "#4ADE80", fontSize: 9, fontWeight: "700" }}>{meal.totals?.kcal} kcal</Text>
                            <Text style={{ color: "#60A5FA", fontSize: 9, fontWeight: "700" }}>{meal.totals?.protein}g P</Text>
                            <Text style={{ color: "#FBBF24", fontSize: 9, fontWeight: "700" }}>{meal.totals?.carbs}g C</Text>
                            <Text style={{ color: "#F87171", fontSize: 9, fontWeight: "700" }}>{meal.totals?.fat}g G</Text>
                          </View>
                          {meal.ingredients?.map((ing: any, ii: number) => (
                            <TouchableOpacity key={ii}
                              onPress={() => ing.alternatives?.length > 0 ? setPlanSwapModal({ dayIdx: planDayIdx, mealKey: mk, type: "ingredient", ingIdx: ii }) : null}
                              style={{ flexDirection: "row", alignItems: "center", paddingVertical: 2, gap: 6 }}>
                              <Text style={{ color: colors.textSub, fontSize: 11, flex: 1 }}>• {ing.name} ({ing.grams}g)</Text>
                              <Text style={{ color: colors.textMuted, fontSize: 9 }}>{ing.kcal}kcal</Text>
                              {ing.alternatives?.length > 0 && <Text style={{ color: "#8B5CF6", fontSize: 9 }}>🔄</Text>}
                            </TouchableOpacity>
                          ))}
                        </View>
                      );
                    })}
                  </>
                )}
              </View>
            </>
          )}

          {Object.values(meals).flat().length > 0 && (
            <TouchableOpacity style={s.duplicarBtn} onPress={duplicarDia}>
              <Text style={{ fontSize: 14 }}>📋</Text>
              <Text style={s.duplicarBtnText}>{t.duplicateDay}</Text>
            </TouchableOpacity>
          )}

          {!isToday && (
            <TouchableOpacity style={s.goTodayBadge} onPress={() => goToDay(new Date())}>
              <Text style={s.goTodayText}>{t.returnToday}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Calorías ── */}
        <View style={s.calCard}>
          <View style={s.calTop}>
            <View>
              <Text style={s.calNum}>{Math.round(totals.calories)}</Text>
              <Text style={s.calLabel}>{t.caloriesConsumed}</Text>
            </View>
            <View style={s.calRight}>
              <Text style={[s.calRemain, { color: calExcedidas ? "#FF6B6B" : "#4ADE80" }]}>{restantes}</Text>
              <Text style={s.calRemainLabel}>{calExcedidas ? t.caloriesOver : t.caloriesLeft}</Text>
              <TouchableOpacity style={s.editGoalBtn} onPress={() => setShowGoals(true)}>
                <Text style={s.editGoalBtnText}>{t.editGoal}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={s.barBg}>
            <View style={[s.barFill, { width: `${calPct}%` as any, backgroundColor: calPct > 100 ? "#FF6B6B" : "#4ADE80" }]} />
          </View>
          <Text style={s.barHint}>{t.goal}: {goals.calories} kcal{ejercicioKcal > 0 ? `  ·  🔥 ${ejercicioKcal} quemadas` : ''}</Text>
        </View>

        {/* ── Macros ── */}
        <View style={s.macrosRow}>
          {[
            { label: t.proteins, val: totals.protein, goal: goals.protein, color: "#60A5FA" },
            { label: t.carbs, val: totals.carbs, goal: goals.carbs, color: "#FBBF24" },
            { label: t.fats, val: totals.fat, goal: goals.fat, color: "#F87171" },
          ].map((macro) => (
            <TouchableOpacity key={macro.label} style={s.macroCard} onPress={() => setShowGoals(true)} activeOpacity={0.8}>
              <View style={[s.macroDot, { backgroundColor: macro.color }]} />
              <Text style={s.macroVal}>{Math.round(macro.val)}<Text style={s.macroUnit}>g</Text></Text>
              <Text style={s.macroLabel}>{macro.label}</Text>
              <View style={s.macroBarBg}>
                <View style={[s.macroBarFill, { width: `${Math.min((macro.val / macro.goal) * 100, 100)}%` as any, backgroundColor: macro.color }]} />
              </View>
              <Text style={s.macroGoal}>/ {macro.goal}g</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Comidas del día ── */}
        <Text style={s.sectionTitle}>{t.mealsOfDay}</Text>
        {cargandoComidas ? (
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <ActivityIndicator color={colors.accent} size="small" />
          </View>
        ) : visibleMeals.map((meal) => {
          const mealEntries = meals[meal] ?? [];
          const mt = mealTotals(mealEntries);
          const isExpanded = expanded[meal];
          return (
            <View key={meal} style={s.mealCard}>
              <TouchableOpacity style={s.mealHeader} onPress={() => setExpanded((p) => ({ ...p, [meal]: !p[meal] }))} activeOpacity={0.7}>
                <View style={s.mealLeft}>
                  <Text style={s.mealIcon}>{MEAL_ICONS[meal]}</Text>
                  <View>
                    <Text style={s.mealName}>{MEAL_LABELS[meal]}</Text>
                    <Text style={s.mealKcal}>{Math.round(mt.calories)} kcal</Text>
                  </View>
                </View>
                <View style={s.mealRight}>
                  {mealEntries.length > 0 && (
                    <TouchableOpacity style={s.copyBtn} onPress={() => setDuplicarComidaKey(meal)}>
                      <Text style={s.copyBtnText}>📋</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.addBtn} onPress={() => router.push({ pathname: "/add-food", params: { meal, storageKey } })}>
                    <Text style={s.addBtnText}>{t.addFood}</Text>
                  </TouchableOpacity>
                  <Text style={s.chevron}>{isExpanded ? "▲" : "▼"}</Text>
                </View>
              </TouchableOpacity>
              <View style={s.mealMacroRow}>
                {[
                  { val: Math.round(mt.protein), label: t.proteins.slice(0, 4), color: "#60A5FA" },
                  { val: Math.round(mt.carbs), label: t.carbs, color: "#FBBF24" },
                  { val: Math.round(mt.fat), label: t.fats, color: "#F87171" },
                ].map((item) => (
                  <View key={item.label} style={s.mealMacroChip}>
                    <Text style={[s.mealMacroVal, { color: item.color }]}>{item.val}g</Text>
                    <Text style={s.mealMacroLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>
              {isExpanded && (
                <View style={s.foodList}>
                  {mealEntries.length === 0 ? (
                    <Text style={s.emptyMeal}>{t.noFoodsRegistered}</Text>
                  ) : (
                    mealEntries.map((food) => (
                      <FoodRow key={food.id} food={food} onEdit={() => openEditFood(food, meal)} onDelete={() => removeFood(meal, food.id)} />
                    ))
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* ── Actividad física ── */}
        <TouchableOpacity
          onPress={() => setShowEjercicio(true)}
          activeOpacity={0.8}
          style={{ marginHorizontal: 16, marginBottom: 14, backgroundColor: colors.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.cardBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 20 }}>🏃</Text>
            <View>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{t.physicalActivity}</Text>
              {sesionesHoy.length > 0
                ? <Text style={{ color: "#4ADE80", fontSize: 11, fontWeight: '600' }}>
                    {sesionesHoy.map(s => `${s.tipo} ${s.mins}'`).join('  ·  ')}
                  </Text>
                : <Text style={{ color: colors.textMuted, fontSize: 11 }}>{t.logExercise}</Text>
              }
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            {ejercicioKcal > 0 && <Text style={{ color: "#F87171", fontSize: 11, fontWeight: '700' }}>🔥 {ejercicioKcal} kcal</Text>}
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>{t.addFood}</Text>
          </View>
        </TouchableOpacity>

        {/* ── Modal ejercicio ── */}
        <Modal visible={showEjercicio} transparent animationType="slide" onRequestClose={() => setShowEjercicio(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setShowEjercicio(false)}>
            <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 16 }}>🏃 {t.logExercise}</Text>
              <Text style={{ color: colors.textSub, fontSize: 12, marginBottom: 8 }}>{t.activityType}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {Object.keys(MET).map(tipo => (
                  <TouchableOpacity
                    key={tipo}
                    onPress={() => setEjercicioTipo(tipo)}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: ejercicioTipo === tipo ? colors.accent : colors.inputBg, borderWidth: 1, borderColor: ejercicioTipo === tipo ? colors.accent : colors.cardBorder }}
                  >
                    <Text style={{ color: ejercicioTipo === tipo ? '#fff' : colors.text, fontSize: 13, fontWeight: '600' }}>{MET_LABELS[tipo] ?? tipo}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ color: colors.textSub, fontSize: 12, marginBottom: 8 }}>{t.durationMins}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                {['15','30','45','60','90'].map(m => (
                  <TouchableOpacity key={m} onPress={() => setEjercicioMins(m)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: ejercicioMins === m ? colors.accent : colors.inputBg, alignItems: 'center', borderWidth: 1, borderColor: ejercicioMins === m ? colors.accent : colors.cardBorder }}>
                    <Text style={{ color: ejercicioMins === m ? '#fff' : colors.text, fontWeight: '700' }}>{m}'</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {(() => { const met = MET[ejercicioTipo] ?? 5; const kcal = Math.round(met * pesoKg * ((Number(ejercicioMins)||0)/60)); return (
                <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 16 }}>{t.kcalBurned.replace("{kcal}", String(kcal))}</Text>
              ); })()}
              <TouchableOpacity onPress={guardarEjercicio} style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }} activeOpacity={0.8}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>✓ {t.save}</Text>
              </TouchableOpacity>

              {/* Lista de sesiones de hoy con opción de borrar */}
              {sesionesHoy.length > 0 && (
                <View style={{ marginTop: 20, gap: 8 }}>
                  <Text style={{ color: colors.textSub, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.todaySessions}</Text>
                  {sesionesHoy.map((s, i) => (
                    <View key={s.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.cardBorder }}>
                      <Text style={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' }}>{s.tipo}  {s.mins}'</Text>
                      <Text style={{ color: '#F87171', fontSize: 13, fontWeight: '700', marginRight: 12 }}>🔥 {s.kcal} kcal</Text>
                      <TouchableOpacity onPress={() => eliminarEjercicio(s)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ color: '#EF4444', fontSize: 18, fontWeight: '700', lineHeight: 20 }}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* ── Agua ── */}
        {isToday && (
          <View style={{ marginTop: 4, marginBottom: 8 }}>
            <WaterCounter vasos={vasos} onAdd={addWater} onRemove={removeWater} colors={colors} />
          </View>
        )}

        {/* ── Comer Fuera ── */}
        <View style={{ marginTop: 12, marginBottom: 8 }}>
          <TouchableOpacity
            style={[s.comerFueraHeader, showComerFuera && s.comerFueraHeaderOpen]}
            onPress={() => {
              const opening = !showComerFuera;
              setShowComerFuera(v => !v);
              if (opening && restaurantesCercanos.length === 0) obtenerUbicacion();
            }}
            activeOpacity={0.8}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: 22 }}>🍽️</Text>
              <View>
                <Text style={s.comerFueraTitulo}>{t.eatOut}</Text>
                <Text style={s.comerFueraSub}>
                  {modoCercanos === "cercanos" && userCity
                    ? t.nearRestaurantsCity.replace("{city}", userCity.split(",")[0])
                    : t.healthyRestaurantOptions}
                </Text>
              </View>
            </View>
            <Text style={s.comerFueraChevron}>{showComerFuera ? "▲" : "▼"}</Text>
          </TouchableOpacity>

          {showComerFuera && (
            <View style={s.comerFueraBody}>

              {/* Barra de ubicación */}
              <View style={s.locationBar}>
                <Text style={{ fontSize: 13 }}>📍</Text>
                {loadingLocation
                  ? <><ActivityIndicator size="small" color="#1F6FEB" /><Text style={s.locationBarText}>{t.detectingLocation}</Text></>
                  : <Text style={s.locationBarText}>
                      {nearbyError === "ubicacion"
                        ? t.noLocationAccess
                        : modoCercanos === "cercanos"
                          ? userCity || t.locationDetected
                          : userCity || t.popularRestaurants}
                    </Text>
                }
                {nearbyError === "ubicacion" && (
                  <TouchableOpacity onPress={obtenerUbicacion} style={{ marginLeft: "auto" }}>
                    <Text style={{ color: "#58A6FF", fontSize: 12 }}>{t.retry}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Vista: lista de restaurantes */}
              {!restauranteActivo && (
                <View>
                  {/* Indicador de modo */}
                  {modoCercanos === "cercanos" && (
                    <View style={s.modoBadge}>
                      <Text style={s.modoBadgeText}>{t.restaurantsNearYou}</Text>
                    </View>
                  )}
                  {modoCercanos === "popular" && restaurantesCercanos.length > 0 && (
                    <View style={[s.modoBadge, { backgroundColor: colors.inputBg }]}>
                      <Text style={[s.modoBadgeText, { color: colors.textMuted }]}>{t.popularChains}</Text>
                    </View>
                  )}

                  {/* Cargando */}
                  {loadingNearby && (
                    <View style={s.nearbyLoading}>
                      <ActivityIndicator color="#1F6FEB" />
                      <Text style={s.nearbyLoadingText}>{t.searchingRestaurants}</Text>
                    </View>
                  )}

                  {/* Lista de restaurantes */}
                  {!loadingNearby && restaurantesCercanos.map((rest, i) => (
                    <TouchableOpacity
                      key={i}
                      style={s.restCard}
                      onPress={() => setRestauranteActivo(rest)}
                      activeOpacity={0.75}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.restCardName}>🏪 {rest.nombre}</Text>
                        <View style={s.restCardMeta}>
                          {rest.distancia != null && (
                            <Text style={s.restCardDist}>
                              {rest.distancia < 1000
                                ? `${rest.distancia}m`
                                : `${(rest.distancia / 1000).toFixed(1)}km`}
                            </Text>
                          )}
                          {rest.rating != null && (
                            <Text style={s.restCardRating}>⭐ {rest.rating}</Text>
                          )}
                          <Text style={s.restCardCount}>🥗 {rest.platos.length} {t.healthierOptions.replace("🥗 ", "").replace(/ \(≤.*\)/, "")}</Text>
                        </View>
                      </View>
                      <Text style={{ color: "#58A6FF", fontSize: 20 }}>›</Text>
                    </TouchableOpacity>
                  ))}

                  {!loadingNearby && restaurantesCercanos.length === 0 && !loadingLocation && (
                    <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", paddingVertical: 20 }}>
                      {t.noRestaurantsFound}
                    </Text>
                  )}
                </View>
              )}

              {/* Vista: opciones saludables del restaurante seleccionado */}
              {restauranteActivo && (
                <View>
                  <TouchableOpacity
                    style={s.backToList}
                    onPress={() => setRestauranteActivo(null)}
                  >
                    <Text style={s.backToListText}>← {restauranteActivo.nombre}</Text>
                  </TouchableOpacity>

                  {/* Meta: distancia y rating */}
                  {(restauranteActivo.distancia != null || restauranteActivo.rating != null) && (
                    <Text style={s.restDetailMeta}>
                      {restauranteActivo.distancia != null
                        ? restauranteActivo.distancia < 1000
                          ? `${restauranteActivo.distancia}m`
                          : `${(restauranteActivo.distancia / 1000).toFixed(1)}km`
                        : ""}
                      {restauranteActivo.rating != null
                        ? ` · ⭐ ${restauranteActivo.rating}`
                        : ""}
                    </Text>
                  )}

                  <View style={s.saludableHeader}>
                    <Text style={s.saludableHeaderText}>{t.healthierOptions}</Text>
                  </View>

                  {restauranteActivo.platos.map((plato, i) => (
                    <TouchableOpacity
                      key={i}
                      style={s.platoRow}
                      onPress={() => { setPlatoParaAnadir({ ...plato, restaurante: restauranteActivo.nombre }); setMealComerFuera("comida"); }}
                      activeOpacity={0.75}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.platoNombre} numberOfLines={1}>{plato.nombre}</Text>
                        <View style={s.platoMacros}>
                          <Text style={[s.platoMacroVal, { color: "#60A5FA" }]}>{plato.proteinas}g P</Text>
                          <Text style={s.platoMacroDot}>·</Text>
                          <Text style={[s.platoMacroVal, { color: "#FBBF24" }]}>{plato.carbs}g C</Text>
                          <Text style={s.platoMacroDot}>·</Text>
                          <Text style={[s.platoMacroVal, { color: "#F87171" }]}>{plato.grasas}g G</Text>
                          {plato.porcion
                            ? <><Text style={s.platoMacroDot}>·</Text><Text style={[s.platoMacroVal, { color: colors.textMuted }]}>{plato.porcion}</Text></>
                            : null}
                        </View>
                      </View>
                      <View style={s.platoRight}>
                        <Text style={s.platoCal}>{plato.calorias}</Text>
                        <Text style={s.platoCalLabel}>kcal</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={s.comerFueraDisclaimer}>
                {t.eatingOutDisclaimer}
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Modal añadir plato rápido ── */}
      <Modal visible={!!platoParaAnadir} transparent animationType="slide" onRequestClose={() => setPlatoParaAnadir(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000AA", justifyContent: "flex-end" }} activeOpacity={1} onPress={() => setPlatoParaAnadir(null)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, gap: 16 }}>
            {/* Cabecera */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text style={{ fontSize: 28 }}>🍽️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{platoParaAnadir?.nombre}</Text>
                <Text style={{ color: "#4ADE80", fontSize: 14, fontWeight: "700" }}>
                  {platoParaAnadir?.calorias} kcal{platoParaAnadir?.restaurante ? ` · ${platoParaAnadir.restaurante}` : ""}
                </Text>
              </View>
            </View>
            {/* Macros */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { label: t.proteins, val: platoParaAnadir?.proteinas, color: "#60A5FA" },
                { label: t.carbs, val: platoParaAnadir?.carbs, color: "#FBBF24" },
                { label: t.fats, val: platoParaAnadir?.grasas, color: "#F87171" },
              ].map(m => (
                <View key={m.label} style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 10, alignItems: "center" }}>
                  <Text style={{ color: m.color, fontSize: 18, fontWeight: "800" }}>{m.val}g</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>{m.label}</Text>
                </View>
              ))}
            </View>
            {/* Selector de comida */}
            <Text style={{ color: colors.textSub, fontSize: 13, fontWeight: "600" }}>{t.addTo}:</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["desayuno", "comida", "merienda", "cena"] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={{ flex: 1, backgroundColor: mealComerFuera === m ? "#1F6FEB" : colors.inputBg, borderRadius: 12, padding: 10, alignItems: "center", borderWidth: mealComerFuera === m ? 0 : 1, borderColor: colors.cardBorder }}
                  onPress={() => setMealComerFuera(m)}
                >
                  <Text style={{ fontSize: 16 }}>{({ desayuno: "🌅", comida: "☀️", merienda: "🍎", cena: "🌙" })[m]}</Text>
                  <Text style={{ color: mealComerFuera === m ? "#fff" : colors.textSub, fontSize: 10, fontWeight: "700", marginTop: 2, textTransform: "capitalize" }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* Botón confirmar */}
            <TouchableOpacity
              style={{ backgroundColor: "#1F6FEB", borderRadius: 16, padding: 16, alignItems: "center" }}
              onPress={() => platoParaAnadir && anadirPlatoRapido(platoParaAnadir, mealComerFuera)}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>{t.addTo} {MEAL_LABELS[mealComerFuera]}</Text>
            </TouchableOpacity>
            {platoParaAnadir?.porcion && (
              <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: "center" }}>{t.portionColon.replace("{value}", platoParaAnadir.porcion)}</Text>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal cuestionario plan semanal ── */}
      <Modal visible={planModal} transparent animationType="slide" onRequestClose={() => setPlanModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000CC", justifyContent: "flex-end" }} activeOpacity={1} onPress={() => planStep !== "generating" && setPlanModal(false)}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: "85%" }} onStartShouldSetResponder={() => true}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#374151" }} />
            </View>
            {planStep === "generating" ? (
              <View style={{ alignItems: "center", gap: 16, paddingVertical: 40 }}>
                <ActivityIndicator size="large" color="#8B5CF6" />
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>{t.generatingPlan}</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {planStep === "cuisine" && (
                  <View style={{ gap: 14 }}>
                    <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>🍳 {t.planQuestionCuisine}</Text>
                    {[
                      { val: "mediterranean", label: t.planCuisineMediterranean, emoji: "🫒" },
                      { val: "asian", label: t.planCuisineAsian, emoji: "🥢" },
                      { val: "latam", label: t.planCuisineLatAm, emoji: "🌮" },
                      { val: "nordic", label: t.planCuisineNordic, emoji: "🐟" },
                      { val: "mixed", label: t.planCuisineMixed, emoji: "🌍" },
                    ].map(o => (
                      <TouchableOpacity key={o.val} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, backgroundColor: planCuisine === o.val ? "#8B5CF622" : colors.bg, borderWidth: 1, borderColor: planCuisine === o.val ? "#8B5CF6" : colors.cardBorder }} onPress={() => setPlanCuisine(o.val)}>
                        <Text style={{ fontSize: 24 }}>{o.emoji}</Text>
                        <Text style={{ color: planCuisine === o.val ? "#C4B5FD" : colors.textSub, fontSize: 15, fontWeight: "600", flex: 1 }}>{o.label}</Text>
                        {planCuisine === o.val && <Text style={{ color: "#8B5CF6", fontWeight: "800" }}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity onPress={() => setPlanStep("restriction")} style={{ backgroundColor: "#8B5CF6", borderRadius: 14, padding: 16, alignItems: "center" }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{t.next} →</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {planStep === "restriction" && (
                  <View style={{ gap: 14 }}>
                    <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>🥗 {t.planQuestionRestrictions}</Text>
                    {[
                      { val: "none", label: t.planRestrictionNone, emoji: "✅" },
                      { val: "vegetarian", label: t.planRestrictionVegetarian, emoji: "🥬" },
                      { val: "vegan", label: t.planRestrictionVegan, emoji: "🌱" },
                      { val: "keto", label: t.planRestrictionKeto, emoji: "🥑" },
                      { val: "paleo", label: t.planRestrictionPaleo, emoji: "🥩" },
                    ].map(o => (
                      <TouchableOpacity key={o.val} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, backgroundColor: planRestriction === o.val ? "#8B5CF622" : colors.bg, borderWidth: 1, borderColor: planRestriction === o.val ? "#8B5CF6" : colors.cardBorder }} onPress={() => setPlanRestriction(o.val)}>
                        <Text style={{ fontSize: 24 }}>{o.emoji}</Text>
                        <Text style={{ color: planRestriction === o.val ? "#C4B5FD" : colors.textSub, fontSize: 15, fontWeight: "600", flex: 1 }}>{o.label}</Text>
                        {planRestriction === o.val && <Text style={{ color: "#8B5CF6", fontWeight: "800" }}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity onPress={() => setPlanStep("cuisine")} style={{ flex: 1, borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder }}><Text style={{ color: colors.textSub, fontWeight: "700" }}>{t.back}</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => setPlanStep("budget")} style={{ flex: 1, backgroundColor: "#8B5CF6", borderRadius: 14, padding: 16, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "800" }}>{t.next} →</Text></TouchableOpacity>
                    </View>
                  </View>
                )}
                {planStep === "budget" && (
                  <View style={{ gap: 14 }}>
                    <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>💰 {t.planBudgetQuestion}</Text>
                    {[
                      { val: "low", label: t.planBudgetLow, emoji: "🪙" },
                      { val: "medium", label: t.planBudgetMedium, emoji: "💵" },
                      { val: "high", label: t.planBudgetHigh, emoji: "💎" },
                    ].map(o => (
                      <TouchableOpacity key={o.val} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, backgroundColor: planBudget === o.val ? "#8B5CF622" : colors.bg, borderWidth: 1, borderColor: planBudget === o.val ? "#8B5CF6" : colors.cardBorder }} onPress={() => setPlanBudget(o.val)}>
                        <Text style={{ fontSize: 24 }}>{o.emoji}</Text>
                        <Text style={{ color: planBudget === o.val ? "#C4B5FD" : colors.textSub, fontSize: 15, fontWeight: "600", flex: 1 }}>{o.label}</Text>
                        {planBudget === o.val && <Text style={{ color: "#8B5CF6", fontWeight: "800" }}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity onPress={() => setPlanStep("restriction")} style={{ flex: 1, borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder }}><Text style={{ color: colors.textSub, fontWeight: "700" }}>{t.back}</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => setPlanStep("cooking")} style={{ flex: 1, backgroundColor: "#8B5CF6", borderRadius: 14, padding: 16, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "800" }}>{t.next} →</Text></TouchableOpacity>
                    </View>
                  </View>
                )}
                {planStep === "cooking" && (
                  <View style={{ gap: 14 }}>
                    <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>⏱ {t.planCookingTime}</Text>
                    {[
                      { val: "quick", label: t.planCookingQuick, emoji: "⚡" },
                      { val: "medium", label: t.planCookingMedium, emoji: "🍳" },
                      { val: "elaborate", label: t.planCookingElaborate, emoji: "👨‍🍳" },
                    ].map(o => (
                      <TouchableOpacity key={o.val} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, backgroundColor: planCookingTime === o.val ? "#8B5CF622" : colors.bg, borderWidth: 1, borderColor: planCookingTime === o.val ? "#8B5CF6" : colors.cardBorder }} onPress={() => setPlanCookingTime(o.val)}>
                        <Text style={{ fontSize: 24 }}>{o.emoji}</Text>
                        <Text style={{ color: planCookingTime === o.val ? "#C4B5FD" : colors.textSub, fontSize: 15, fontWeight: "600", flex: 1 }}>{o.label}</Text>
                        {planCookingTime === o.val && <Text style={{ color: "#8B5CF6", fontWeight: "800" }}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                    {planError ? <View style={{ backgroundColor: "#EF444422", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#EF444455" }}><Text style={{ color: "#F87171", fontSize: 13 }}>⚠️ {planError}</Text></View> : null}
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity onPress={() => setPlanStep("budget")} style={{ flex: 1, borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder }}><Text style={{ color: colors.textSub, fontWeight: "700" }}>{t.back}</Text></TouchableOpacity>
                      <TouchableOpacity onPress={generatePlan} style={{ flex: 1, backgroundColor: "#8B5CF6", borderRadius: 14, padding: 16, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "800" }}>{t.generatePlan} ✨</Text></TouchableOpacity>
                    </View>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal swap comida/ingrediente ── */}
      <Modal visible={!!planSwapModal} transparent animationType="fade" onRequestClose={() => setPlanSwapModal(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000AA" }} activeOpacity={1} onPress={() => setPlanSwapModal(null)} />
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: "60%" }}>
          <View style={{ alignItems: "center", marginBottom: 12 }}><View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#374151" }} /></View>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 14 }}>🔄 {t.chooseAlternative}</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {planSwapModal && weeklyPlan && (() => {
              const meal = weeklyPlan.days[planSwapModal.dayIdx]?.meals?.[planSwapModal.mealKey];
              if (!meal) return null;
              if (planSwapModal.type === "meal") {
                return (meal.alternatives ?? []).map((alt: any, i: number) => (
                  <TouchableOpacity key={i} onPress={() => swapMealInPlan(planSwapModal.dayIdx, planSwapModal.mealKey, i)}
                    style={{ backgroundColor: colors.bg, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.cardBorder, gap: 6 }}>
                    <Text style={{ color: "#8B5CF6", fontSize: 14, fontWeight: "700" }}>{alt.name}</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Text style={{ color: "#4ADE80", fontSize: 11 }}>{alt.totals?.kcal} kcal</Text>
                      <Text style={{ color: "#60A5FA", fontSize: 11 }}>{alt.totals?.protein}g P</Text>
                      <Text style={{ color: "#FBBF24", fontSize: 11 }}>{alt.totals?.carbs}g C</Text>
                      <Text style={{ color: "#F87171", fontSize: 11 }}>{alt.totals?.fat}g G</Text>
                    </View>
                    {alt.ingredients?.map((ing: any, j: number) => (
                      <Text key={j} style={{ color: colors.textSub, fontSize: 11 }}>• {ing.name} ({ing.grams}g)</Text>
                    ))}
                  </TouchableOpacity>
                ));
              }
              const ing = meal.ingredients?.[planSwapModal.ingIdx!];
              if (!ing) return null;
              return (ing.alternatives ?? []).map((alt: any, i: number) => (
                <TouchableOpacity key={i} onPress={() => swapIngredientInPlan(planSwapModal.dayIdx, planSwapModal.mealKey, planSwapModal.ingIdx!, i)}
                  style={{ backgroundColor: colors.bg, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.cardBorder, gap: 4 }}>
                  <Text style={{ color: "#8B5CF6", fontSize: 14, fontWeight: "700" }}>{alt.name} ({alt.grams}g)</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Text style={{ color: "#4ADE80", fontSize: 11 }}>{alt.kcal} kcal</Text>
                    <Text style={{ color: "#60A5FA", fontSize: 11 }}>{alt.protein}g P</Text>
                    <Text style={{ color: "#FBBF24", fontSize: 11 }}>{alt.carbs}g C</Text>
                    <Text style={{ color: "#F87171", fontSize: 11 }}>{alt.fat}g G</Text>
                  </View>
                </TouchableOpacity>
              ));
            })()}
          </ScrollView>
        </View>
      </Modal>

      <BottomTabBar />
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useApp>["colors"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { flex: 1, paddingHorizontal: 16 },
    header: { paddingTop: 20, paddingBottom: 8, gap: 10 },
    dateNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    dateNavBtn: { padding: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder },
    dateNavArrow: { color: colors.textSub, fontSize: 22, fontWeight: "300" },
    dateTitleWrap: { flex: 1, alignItems: "center", gap: 2 },
    dateTitle: { color: colors.text, fontSize: 20, fontWeight: "800", textTransform: "capitalize" },
    dateSub: { color: colors.textMuted, fontSize: 11, textTransform: "capitalize" },
    streakBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", backgroundColor: "#F97316" + "22", borderWidth: 1, borderColor: "#F97316" + "55", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
    streakText: { color: "#F97316", fontSize: 13, fontWeight: "700" },
    goTodayBadge: { alignSelf: "center", backgroundColor: "#1F6FEB22", borderWidth: 1, borderColor: "#1F6FEB55", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
    goTodayText: { color: "#58A6FF", fontSize: 13, fontWeight: "600" },
    seguimientoBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#7C3AED22", borderWidth: 1, borderColor: "#7C3AED55", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
    seguimientoBtnIcon: { fontSize: 18 },
    seguimientoBtnText: { flex: 1, color: "#A78BFA", fontSize: 14, fontWeight: "700" },
    seguimientoBtnArrow: { color: "#A78BFA", fontSize: 16 },
    duplicarBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
    duplicarBtnText: { color: colors.textSub, fontSize: 13, fontWeight: "600" },
    copyBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder },
    copyBtnText: { fontSize: 14 },
    calCard: { backgroundColor: colors.card, borderRadius: 20, padding: 20, marginVertical: 14, borderWidth: 1, borderColor: colors.cardBorder },
    calTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
    calNum: { color: colors.text, fontSize: 48, fontWeight: "900", lineHeight: 52 },
    calLabel: { color: colors.textSub, fontSize: 13, marginTop: 2 },
    calRight: { alignItems: "flex-end", gap: 4 },
    calRemain: { fontSize: 28, fontWeight: "700" },
    calRemainLabel: { color: colors.textSub, fontSize: 12 },
    editGoalBtn: { backgroundColor: colors.inputBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: 4 },
    editGoalBtnText: { color: colors.textSub, fontSize: 11, fontWeight: "600" },
    barBg: { height: 8, backgroundColor: colors.inputBg, borderRadius: 4, overflow: "hidden" },
    barFill: { height: 8, borderRadius: 4 },
    barHint: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
    macrosRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
    macroCard: { flex: 1, backgroundColor: colors.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.cardBorder },
    macroDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 8 },
    macroVal: { color: colors.text, fontSize: 22, fontWeight: "800" },
    macroUnit: { fontSize: 12, color: colors.textSub, fontWeight: "400" },
    macroLabel: { color: colors.textSub, fontSize: 11, marginTop: 2, marginBottom: 6 },
    macroBarBg: { height: 4, backgroundColor: colors.inputBg, borderRadius: 2, overflow: "hidden" },
    macroBarFill: { height: 4, borderRadius: 2 },
    macroGoal: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
    sectionTitle: { color: colors.textSub, fontSize: 13, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },
    mealCard: { backgroundColor: colors.card, borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.cardBorder },
    mealHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    mealLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
    mealRight: { flexDirection: "row", alignItems: "center", gap: 10 },
    mealIcon: { fontSize: 28 },
    mealName: { color: colors.text, fontSize: 16, fontWeight: "700" },
    mealKcal: { color: colors.textSub, fontSize: 12, marginTop: 1 },
    addBtn: { backgroundColor: "#1F6FEB22", borderWidth: 1, borderColor: "#1F6FEB55", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
    addBtnText: { color: "#58A6FF", fontSize: 13, fontWeight: "600" },
    chevron: { color: colors.textMuted, fontSize: 12 },
    mealMacroRow: { flexDirection: "row", gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.cardBorder },
    mealMacroChip: { flex: 1, backgroundColor: colors.bg, borderRadius: 8, paddingVertical: 6, alignItems: "center" },
    mealMacroVal: { fontSize: 14, fontWeight: "700" },
    mealMacroLabel: { color: colors.textMuted, fontSize: 10, marginTop: 1 },
    foodList: { marginTop: 10 },
    emptyMeal: { color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: "center", paddingBottom: 4 },
    // Comer Fuera
    comerFueraHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.cardBorder },
    comerFueraHeaderOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 },
    comerFueraTitulo: { color: colors.text, fontSize: 15, fontWeight: "800" },
    comerFueraSub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    comerFueraChevron: { color: colors.textMuted, fontSize: 12 },
    comerFueraBody: { backgroundColor: colors.card, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderWidth: 1, borderTopWidth: 0, borderColor: colors.cardBorder, padding: 14, gap: 0 },
    locationBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 2, marginBottom: 4 },
    locationBarText: { color: colors.textMuted, fontSize: 12, flex: 1 },
    modoBadge: { backgroundColor: "#1F6FEB22", borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 8, alignSelf: "flex-start" },
    modoBadgeText: { color: "#1F6FEB", fontSize: 11, fontWeight: "700" },
    restCard: { backgroundColor: colors.inputBg, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    restCardName: { color: colors.text, fontSize: 14, fontWeight: "700" },
    restCardMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
    restCardDist: { color: colors.textMuted, fontSize: 12 },
    restCardRating: { color: "#FBBF24", fontSize: 12, fontWeight: "700" },
    restCardCount: { color: "#4ADE80", fontSize: 12, fontWeight: "600" },
    backToList: { flexDirection: "row", alignItems: "center", paddingVertical: 8, marginBottom: 8 },
    backToListText: { color: "#1F6FEB", fontSize: 14, fontWeight: "700" },
    restDetailMeta: { color: colors.textMuted, fontSize: 12, marginBottom: 10 },
    saludableHeader: { backgroundColor: "#4ADE8022", borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 8 },
    saludableHeaderText: { color: "#4ADE80", fontSize: 12, fontWeight: "700" },
    nearbyLoading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
    nearbyLoadingText: { color: colors.textMuted, fontSize: 13 },
    platoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.cardBorder, gap: 10 },
    platoLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
    platoNombre: { color: colors.text, fontSize: 14, fontWeight: "600" },
    platoNota: { color: colors.textMuted, fontSize: 10, marginTop: 1 },
    platoMacros: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
    platoMacroVal: { fontSize: 11, fontWeight: "700" },
    platoMacroDot: { color: colors.textMuted, fontSize: 10 },
    platoRight: { alignItems: "flex-end" },
    platoCal: { color: "#4ADE80", fontSize: 18, fontWeight: "800" },
    platoCalLabel: { color: colors.textMuted, fontSize: 10 },
    comerFueraDisclaimer: { color: colors.textMuted, fontSize: 10, textAlign: "center", marginTop: 14, lineHeight: 15 },
  });
}