import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { signalMealSaved, subscribeMealUpdates } from "./services/refreshSignal";
import {
  ActivityIndicator,
  Alert,
  Modal,
  PanResponder,
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
import { buscarRestaurantesCercanos, buscarRestaurantesPopulares, PlatoParaAnadir, RestauranteCercano } from "./services/comerFuera";
import { supabase } from "./services/supabase";

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
};

type MealData = {
  desayuno: FoodEntry[];
  comida: FoodEntry[];
  merienda: FoodEntry[];
  cena: FoodEntry[];
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

const EMPTY_MEALS: MealData = { desayuno: [], comida: [], merienda: [], cena: [] };


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

function WaterCounter({ vasos, onAdd, onRemove, colors }: {
  vasos: number; onAdd: () => void; onRemove: () => void; colors: any;
}) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.cardBorder, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 18 }}>💧</Text>
          <View>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Agua diaria</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>{vasos}/{WATER_GOAL} vasos</Text>
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
}

function EditGramosModal({ visible, food, onClose, onSave }: {
  visible: boolean; food: FoodEntry | null; onClose: () => void; onSave: (g: number) => void;
}) {
  const { t, colors } = useApp();
  const [gramos, setGramos] = useState("100");
  const [porcionIdx, setPorcionIdx] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState(1);

  React.useEffect(() => {
    if (food) {
      const g = calcularGramosActuales(food);
      setGramos(String(g));
      setPorcionIdx(null);
      setCantidad(1);
    }
  }, [food]);

  if (!food) return null;
  const g = Number(gramos) || 0;
  const p = food.per100;
  const cal = p ? Math.round((p.calories * g) / 100) : food.calories;
  const prot = p ? ((p.protein * g) / 100).toFixed(1) : String(food.protein);
  const carb = p ? ((p.carbs * g) / 100).toFixed(1) : String(food.carbs);
  const fat = p ? ((p.fat * g) / 100).toFixed(1) : String(food.fat);
  const sc = food.supermercado ? (SUPER_COLORS[food.supermercado] || "#4B5563") : null;

  const seleccionarPorcion = (i: number) => {
    if (porcionIdx === i) { setPorcionIdx(null); setCantidad(1); setGramos(String(calcularGramosActuales(food))); }
    else { setPorcionIdx(i); setCantidad(1); setGramos(String(food.porciones![i].gramos)); }
  };
  const cambiarCantidad = (delta: number) => {
    if (porcionIdx === null || !food.porciones) return;
    const nueva = Math.max(1, cantidad + delta);
    setCantidad(nueva);
    setGramos(String(food.porciones[porcionIdx].gramos * nueva));
  };

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
          {food.porciones && food.porciones.length > 0 && (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>🍽️ Porciones</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {food.porciones.map((por, i) => (
                  <TouchableOpacity key={i} style={{ backgroundColor: porcionIdx === i ? "#1F6FEB22" : colors.inputBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: porcionIdx === i ? "#58A6FF" : colors.cardBorder, alignItems: "center" }} onPress={() => seleccionarPorcion(i)}>
                    <Text style={{ color: porcionIdx === i ? "#58A6FF" : colors.textSub, fontSize: 13, fontWeight: "600" }}>{por.nombre}</Text>
                    <Text style={{ color: porcionIdx === i ? "#58A6FF" : colors.textMuted, fontSize: 11 }}>{por.gramos}g c/u</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {porcionIdx !== null && food.porciones[porcionIdx] && (
                <View style={{ backgroundColor: colors.bg, borderRadius: 14, padding: 12, gap: 8, borderWidth: 1, borderColor: "#1F6FEB33" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 }}>
                    <TouchableOpacity style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" }} onPress={() => cambiarCantidad(-1)}>
                      <Text style={{ color: "#fff", fontSize: 22, fontWeight: "300", lineHeight: 26 }}>−</Text>
                    </TouchableOpacity>
                    <View style={{ alignItems: "center", minWidth: 70 }}>
                      <Text style={{ color: colors.text, fontSize: 32, fontWeight: "900" }}>{cantidad}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>{food.porciones[porcionIdx].nombre}</Text>
                    </View>
                    <TouchableOpacity style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" }} onPress={() => cambiarCantidad(1)}>
                      <Text style={{ color: "#fff", fontSize: 22, fontWeight: "300", lineHeight: 26 }}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ color: colors.textSub, fontSize: 12, textAlign: "center" }}>
                    {cantidad} × {food.porciones[porcionIdx].gramos}g = <Text style={{ color: colors.text, fontWeight: "700" }}>{food.porciones[porcionIdx].gramos * cantidad}g</Text>
                  </Text>
                </View>
              )}
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.bg, borderRadius: 12, padding: 14 }}>
            <Text style={{ color: colors.textSub, fontSize: 15 }}>{t.quantity}</Text>
            <TextInput style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, padding: 10, color: colors.text, fontSize: 24, fontWeight: "800", width: 110, textAlign: "center" }} value={gramos} onChangeText={(v) => { setGramos(v); setPorcionIdx(null); }} keyboardType="numeric" selectTextOnFocus />
          </View>
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
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 14, alignItems: "center" }} onPress={onClose}>
              <Text style={{ color: colors.textSub, fontWeight: "700", fontSize: 15 }}>{t.cancel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, backgroundColor: "#1F6FEB", borderRadius: 12, padding: 14, alignItems: "center" }} onPress={() => onSave(g)}>
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
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>kcal · cambia los macros automáticamente</Text>
                  </View>
                  <TextInput style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: "#4ADE8044", borderRadius: 10, padding: 10, color: colors.text, fontSize: 18, fontWeight: "800", width: 90, textAlign: "center" }} value={cal} onChangeText={handleCalChange} keyboardType="numeric" selectTextOnFocus />
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {[{ label: "Prot 30%", color: "#60A5FA", val: Math.round(Number(cal) * 0.30 / 4) }, { label: "Carbs 40%", color: "#FBBF24", val: Math.round(Number(cal) * 0.40 / 4) }, { label: "Grasa 30%", color: "#F87171", val: Math.round(Number(cal) * 0.30 / 9) }].map((m) => (
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
  const MESES = language === "en" ? MESES_EN : language === "fr" ? MESES_FR : language === "de" ? MESES_DE : language === "zh" ? MESES_ZH : MESES_ES;
  const DIAS = language === "en" ? DIAS_EN : language === "fr" ? DIAS_FR : language === "de" ? DIAS_DE : language === "zh" ? DIAS_ZH : DIAS_ES;
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
  const gramos = calcularGramosActuales(food);
  return (
    <Pressable
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: pressed ? colors.inputBg : colors.bg, borderRadius: 12, padding: 12, marginBottom: 6 })}
      onPress={onEdit}
    >
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{food.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
          {sc && food.supermercado && (<><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sc }} /><Text style={{ color: sc, fontSize: 10, fontWeight: "700" }}>{food.supermercado}</Text><Text style={{ color: colors.textMuted, fontSize: 10 }}>·</Text></>)}
          <Text style={{ color: colors.textSub, fontSize: 11, fontWeight: "500" }}>{gramos} g</Text>
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
  const { t, colors, theme, language } = useApp();

  const params = useLocalSearchParams<{ goToDate?: string }>();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [meals, setMeals] = useState<MealData>(EMPTY_MEALS);
  const [expanded, setExpanded] = useState<Record<keyof MealData, boolean>>({ desayuno: true, comida: true, merienda: true, cena: true });
  const [editFood, setEditFood] = useState<{ food: FoodEntry; meal: keyof MealData } | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showGoals, setShowGoals] = useState(false);
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [confirmDelete, setConfirmDelete] = useState<{ meal: keyof MealData; id: string } | null>(null);
  const [vasos, setVasos] = useState(0);
  const [streak, setStreak] = useState(0);
  const [showDuplicarCalendario, setShowDuplicarCalendario] = useState(false);
  const [duplicarComidaKey, setDuplicarComidaKey] = useState<keyof MealData | null>(null);
  const [showComerFuera, setShowComerFuera] = useState(false);
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

  const isToday = isSameDay(currentDate, new Date());
  const storageKey = dateToKey(currentDate);

  const MEAL_LABELS: Record<keyof MealData, string> = { desayuno: t.breakfast, comida: t.lunch, merienda: t.snack, cena: t.dinner };
  const MEAL_ICONS: Record<keyof MealData, string> = { desayuno: "🌅", comida: "☀️", merienda: "🍎", cena: "🌙" };

  function formatDateLabel(date: Date): string {
    if (isSameDay(date, new Date())) return t.today;
    if (isSameDay(date, addDays(new Date(), -1))) return t.yesterday;
    if (isSameDay(date, addDays(new Date(), 1))) return t.tomorrow;
    return date.toLocaleDateString(
      language === "en" ? "en-GB" : language === "fr" ? "fr-FR" : language === "de" ? "de-DE" : language === "zh" ? "zh-CN" : "es-ES",
      { weekday: "long", day: "numeric", month: "long" }
    );
  }

  const loadMeals = async (date: Date) => {
    try {
      const key = dateToKey(date);
      const fechaStr = key.replace("nutri_meals_", "");
      const stored = await AsyncStorage.getItem(key);
      const localMeals = stored ? JSON.parse(stored) : EMPTY_MEALS;
      setMeals(localMeals);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const { data: filas, error } = await supabase.from("comidas").select("meal_type, food_data").eq("user_id", session.user.id).eq("fecha", fechaStr);
        if (error || !filas || filas.length === 0) return;
        const remoteMeals: MealData = { desayuno: [], comida: [], merienda: [], cena: [] };
        for (const fila of filas) {
          const meal = fila.meal_type as keyof MealData;
          if (remoteMeals[meal]) remoteMeals[meal].push(fila.food_data);
        }
        // Merge: add remote entries not yet in local (by id), never remove local items
        const mergedMeals = { ...localMeals };
        let changed = false;
        for (const meal of Object.keys(mergedMeals) as (keyof MealData)[]) {
          for (const rf of remoteMeals[meal]) {
            if (!mergedMeals[meal].some((lf: any) => lf.id === rf.id)) {
              mergedMeals[meal] = [...mergedMeals[meal], rf];
              changed = true;
            }
          }
        }
        if (changed) { setMeals(mergedMeals); await AsyncStorage.setItem(key, JSON.stringify(mergedMeals)); }
      } catch {}
    } catch { setMeals(EMPTY_MEALS); }
  };

  const loadGoals = async () => {
    try {
      const stored = await AsyncStorage.getItem(GOALS_KEY);
      if (stored) setGoals(JSON.parse(stored));
    } catch {}
  };

  const loadWater = async (date: Date) => {
    try {
      const stored = await AsyncStorage.getItem(waterKey(date));
      setVasos(stored ? Number(stored) : 0);
    } catch { setVasos(0); }
  };

  // Carga inicial + suscripción a señal de add-food
  useEffect(() => {
    // Siempre cargar al montar (cubre el caso de remount tras router.replace)
    loadMeals(currentDate);
    loadWater(currentDate);
    loadGoals();

    const unsub = subscribeMealUpdates(({ meals, dateKey }) => {
      const parts = dateKey.replace("nutri_meals_", "").split("-");
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      setCurrentDate(date);
      // Actualización inmediata con los datos ya guardados (sin esperar AsyncStorage)
      setMeals(meals as MealData);
      // Recarga asíncrona para aplicar merge con Supabase
      loadMeals(date);
      loadWater(date);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recarga al enfocar la pantalla (vuelta desde cualquier pantalla, cambio de día)
  useFocusEffect(React.useCallback(() => {
    loadMeals(currentDate);
    loadWater(currentDate);
    loadGoals();
    actualizarRacha().then(setStreak);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]));

  const saveGoals = async (newGoals: typeof DEFAULT_GOALS) => {
    setGoals(newGoals);
    await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(newGoals));
  };

  const goToDay = (date: Date) => { setCurrentDate(date); loadMeals(date); loadWater(date); };

  const addWater = async () => {
    if (vasos >= WATER_GOAL) return;
    const nuevo = vasos + 1;
    setVasos(nuevo);
    await AsyncStorage.setItem(waterKey(currentDate), String(nuevo));
    if (nuevo === WATER_GOAL) Alert.alert("💧 ¡Meta de agua alcanzada!", "Has bebido los 8 vasos de hoy. ¡Excelente!");
  };
  const removeWater = async () => {
    if (vasos === 0) return;
    const nuevo = vasos - 1;
    setVasos(nuevo);
    await AsyncStorage.setItem(waterKey(currentDate), String(nuevo));
  };

  const duplicarDia = () => {
    const totalAlimentos = Object.values(meals).flat().length;
    if (totalAlimentos === 0) { Alert.alert("Sin comidas", "No hay alimentos registrados en este día para duplicar."); return; }
    setShowDuplicarCalendario(true);
  };

  const copiarA = async (targetDate: Date) => {
    try {
      const targetKey = dateToKey(targetDate);
      const nuevosMeals: MealData = {
        desayuno: meals.desayuno.map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
        comida: meals.comida.map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
        merienda: meals.merienda.map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
        cena: meals.cena.map(f => ({ ...f, id: Date.now().toString() + Math.random() })),
      };
      await AsyncStorage.setItem(targetKey, JSON.stringify(nuevosMeals));
      const fechaLabel = targetDate.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
      Alert.alert("✓ Copiado", `Las comidas se han copiado al ${fechaLabel}.`, [
        { text: "Ver ese día", onPress: () => goToDay(targetDate) },
        { text: "OK" }
      ]);
    } catch { Alert.alert("Error", "No se pudo duplicar el día."); }
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
      const fechaLabel = targetDate.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
      Alert.alert("✓ Copiado", `${MEAL_LABELS[meal]} copiado al ${fechaLabel}.`, [
        { text: "Ver ese día", onPress: () => goToDay(targetDate) },
        { text: "OK" }
      ]);
    } catch { Alert.alert("Error", "No se pudo duplicar la comida."); }
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
          } catch {}
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
      signalMealSaved(updated, key);
      setPlatoParaAnadir(null);
    } catch { Alert.alert("Error", "No se pudo añadir el plato."); }
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
    setMeals((prev) => {
      const updated = { ...prev, [meal]: prev[meal].filter((f) => f.id !== id) };
      AsyncStorage.setItem(dateToKey(currentDate), JSON.stringify(updated));
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) return;
          const fechaStr = dateToKey(currentDate).replace("nutri_meals_", "");
          await supabase.from("comidas").delete().eq("user_id", session.user.id).eq("fecha", fechaStr).eq("meal_type", meal).contains("food_data", { id });
        } catch {}
      })();
      return updated;
    });
    setConfirmDelete(null);
  };

  const saveEditedGramos = async (newGramos: number) => {
    if (!editFood) return;
    const { food, meal } = editFood;
    const p = food.per100;
    if (!p) { setEditFood(null); return; }
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
      }),
    };
    setMeals(updated);
    await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
    setEditFood(null);
  };

  const totals = Object.values(meals).flat().reduce(
    (acc, f) => ({ calories: acc.calories + f.calories, protein: acc.protein + f.protein, carbs: acc.carbs + f.carbs, fat: acc.fat + f.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const mealTotals = (entries: FoodEntry[]) => ({
    calories: entries.reduce((a, f) => a + f.calories, 0),
    protein: entries.reduce((a, f) => a + f.protein, 0),
    carbs: entries.reduce((a, f) => a + f.carbs, 0),
    fat: entries.reduce((a, f) => a + f.fat, 0),
  });

  const calPct = Math.min((totals.calories / goals.calories) * 100, 100);
  const calExcedidas = totals.calories > goals.calories;
  const restantes = Math.abs(goals.calories - Math.round(totals.calories));
  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <EditGramosModal visible={!!editFood} food={editFood?.food ?? null} onClose={() => setEditFood(null)} onSave={saveEditedGramos} />
      <GoalsModal visible={showGoals} goals={goals} onClose={() => setShowGoals(false)} onSave={saveGoals} />
      <CalendarioModal visible={showCalendar} selectedDate={currentDate} onClose={() => setShowCalendar(false)} onSelect={goToDay} />

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

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
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
                  <Text style={s.streakText}>{streak} día{streak !== 1 ? "s" : ""} de racha</Text>
                </View>
              )}
              <View style={s.headerBtns}>
                <TouchableOpacity style={s.headerBtn} onPress={() => router.push("/recetas")}>
                  <Text style={s.headerBtnIcon}>🍳</Text>
                  <Text style={s.headerBtnText}>{t.recipes}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtn} onPress={() => router.push("/create-food")}>
                  <Text style={s.headerBtnIcon}>➕</Text>
                  <Text style={s.headerBtnText}>{t.createFood}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtn} onPress={() => router.push("/comunidad")}>
                  <Text style={s.headerBtnIcon}>👥</Text>
                  <Text style={s.headerBtnText}>Comunidad</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtn} onPress={() => router.push("/settings")}>
                  <Text style={s.headerBtnIcon}>⚙️</Text>
                  <Text style={s.headerBtnText}>{t.settings}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.seguimientoBtn} onPress={() => router.push("/seguimiento")}>
                <Text style={s.seguimientoBtnIcon}>📊</Text>
                <Text style={s.seguimientoBtnText}>Seguimiento semanal</Text>
                <Text style={s.seguimientoBtnArrow}>→</Text>
              </TouchableOpacity>
            </>
          )}

          {Object.values(meals).flat().length > 0 && (
            <TouchableOpacity style={s.duplicarBtn} onPress={duplicarDia}>
              <Text style={{ fontSize: 14 }}>📋</Text>
              <Text style={s.duplicarBtnText}>Duplicar este día</Text>
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
          <Text style={s.barHint}>{t.goal}: {goals.calories} kcal</Text>
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
        {(Object.keys(MEAL_LABELS) as (keyof MealData)[]).map((meal) => {
          const mt = mealTotals(meals[meal]);
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
                  {meals[meal].length > 0 && (
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
                  {meals[meal].length === 0 ? (
                    <Text style={s.emptyMeal}>{t.noFoodsRegistered}</Text>
                  ) : (
                    meals[meal].map((food) => (
                      <FoodRow key={food.id} food={food} onEdit={() => setEditFood({ food, meal })} onDelete={() => removeFood(meal, food.id)} />
                    ))
                  )}
                </View>
              )}
            </View>
          );
        })}

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
                <Text style={s.comerFueraTitulo}>Comer Fuera</Text>
                <Text style={s.comerFueraSub}>
                  {modoCercanos === "cercanos" && userCity
                    ? `Restaurantes cerca de ${userCity.split(",")[0]}`
                    : "Opciones saludables en restaurantes"}
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
                  ? <><ActivityIndicator size="small" color="#1F6FEB" /><Text style={s.locationBarText}>Detectando ubicación…</Text></>
                  : <Text style={s.locationBarText}>
                      {nearbyError === "ubicacion"
                        ? "Sin acceso a ubicación — mostrando populares"
                        : modoCercanos === "cercanos"
                          ? userCity || "Ubicación detectada"
                          : userCity || "Restaurantes populares"}
                    </Text>
                }
                {nearbyError === "ubicacion" && (
                  <TouchableOpacity onPress={obtenerUbicacion} style={{ marginLeft: "auto" }}>
                    <Text style={{ color: "#58A6FF", fontSize: 12 }}>Reintentar</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Vista: lista de restaurantes */}
              {!restauranteActivo && (
                <View>
                  {/* Indicador de modo */}
                  {modoCercanos === "cercanos" && (
                    <View style={s.modoBadge}>
                      <Text style={s.modoBadgeText}>🗺️ Restaurantes encontrados cerca de ti</Text>
                    </View>
                  )}
                  {modoCercanos === "popular" && restaurantesCercanos.length > 0 && (
                    <View style={[s.modoBadge, { backgroundColor: colors.inputBg }]}>
                      <Text style={[s.modoBadgeText, { color: colors.textMuted }]}>⭐ Cadenas populares en tu zona</Text>
                    </View>
                  )}

                  {/* Cargando */}
                  {loadingNearby && (
                    <View style={s.nearbyLoading}>
                      <ActivityIndicator color="#1F6FEB" />
                      <Text style={s.nearbyLoadingText}>Buscando restaurantes cercanos…</Text>
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
                          <Text style={s.restCardCount}>🥗 {rest.platos.length} opciones saludables</Text>
                        </View>
                      </View>
                      <Text style={{ color: "#58A6FF", fontSize: 20 }}>›</Text>
                    </TouchableOpacity>
                  ))}

                  {!loadingNearby && restaurantesCercanos.length === 0 && !loadingLocation && (
                    <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", paddingVertical: 20 }}>
                      No encontramos restaurantes conocidos en tu zona.
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
                    <Text style={s.saludableHeaderText}>🥗 Opciones más saludables (≤ 650 kcal)</Text>
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
                Datos nutricionales oficiales de cada cadena. Disponibilidad según zona.
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
                { label: "Proteínas", val: platoParaAnadir?.proteinas, color: "#60A5FA" },
                { label: "Carbos", val: platoParaAnadir?.carbs, color: "#FBBF24" },
                { label: "Grasas", val: platoParaAnadir?.grasas, color: "#F87171" },
              ].map(m => (
                <View key={m.label} style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 10, alignItems: "center" }}>
                  <Text style={{ color: m.color, fontSize: 18, fontWeight: "800" }}>{m.val}g</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>{m.label}</Text>
                </View>
              ))}
            </View>
            {/* Selector de comida */}
            <Text style={{ color: colors.textSub, fontSize: 13, fontWeight: "600" }}>Añadir a:</Text>
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
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>Añadir a {mealComerFuera}</Text>
            </TouchableOpacity>
            {platoParaAnadir?.porcion && (
              <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: "center" }}>Porción: {platoParaAnadir.porcion}</Text>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
    headerBtns: { flexDirection: "row", gap: 6 },
    headerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 8 },
    headerBtnIcon: { fontSize: 12 },
    headerBtnText: { color: colors.textSub, fontSize: 10, fontWeight: "600" },
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