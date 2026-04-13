import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useApp } from "./services/i18n";
import { supabase } from "./services/supabase";
import { displayWeightToKg, kgToDisplay, loadWeightUnit, WeightUnit } from "./services/units";

const GOALS_KEY = "nutri_daily_goals";
const SEGUIMIENTO_KEY = "nutri_seguimiento_v1";

type RegistroSemanal = {
  fecha: string;
  peso: number;
  sensacion: "hambre" | "bien" | "lleno";
  caloriasPromedio: number;
  caloriasAnteriores: number;
  caloriasNuevas: number;
  proteinaNueva: number;
  carbosNuevos: number;
  grasaNueva: number;
  ajuste: number;
  nota: string;
  tdee: number;
  objetivoCaloricoIdeal: number;
};

type Sensacion = "hambre" | "bien" | "lleno";
type Objetivo = "perder" | "mantener" | "ganar";

const SENSACION_ICONS: Record<Sensacion, string> = { hambre: "😤", bien: "😊", lleno: "🤢" };
const SENSACION_COLORS: Record<Sensacion, string> = { hambre: "#F87171", bien: "#4ADE80", lleno: "#FBBF24" };

// Reintenta obtener la sesión hasta N veces — necesario en web
async function getSessionWithRetry(intentos = 5, espera = 600) {
  for (let i = 0; i < intentos; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    await new Promise((r) => setTimeout(r, espera));
  }
  return null;
}

function calcularTDEE(p: { peso: number; altura: number; edad: number; sexo: "hombre" | "mujer"; actividad: string }): number {
  const bmr = p.sexo === "hombre"
    ? 10 * p.peso + 6.25 * p.altura - 5 * p.edad + 5
    : 10 * p.peso + 6.25 * p.altura - 5 * p.edad - 161;
  const factores: Record<string, number> = { sedentario: 1.2, ligero: 1.375, moderado: 1.55, activo: 1.725, muy_activo: 1.9 };
  return Math.round(bmr * (factores[p.actividad] ?? 1.55));
}

function calcularMetaCaloriasIdeal(tdee: number, objetivo: Objetivo): number {
  if (objetivo === "perder") return Math.max(1200, tdee - 500);
  if (objetivo === "ganar") return tdee + 300;
  return tdee;
}

function calcularMacros(calorias: number, peso: number, objetivo: Objetivo) {
  const proteina = Math.round(peso * (objetivo === "ganar" ? 2.2 : objetivo === "perder" ? 2.0 : 1.8));
  const grasa = Math.round((calorias * 0.25) / 9);
  const carbos = Math.max(50, Math.round((calorias - proteina * 4 - grasa * 9) / 4));
  return { protein: proteina, fat: grasa, carbs: carbos };
}

function calcularAjusteSemanal(params: {
  objetivo: Objetivo; sensacion: Sensacion; pesoActual: number;
  pesoAnterior: number | null; caloriasActuales: number; tdee: number; peso: number;
}, t: any): { nuevasCalorias: number; ajuste: number; razon: string } {
  const { objetivo, sensacion, pesoActual, pesoAnterior, caloriasActuales, tdee } = params;

  if (pesoAnterior === null) {
    const meta = calcularMetaCaloriasIdeal(tdee, objetivo);
    return { nuevasCalorias: meta, ajuste: meta - caloriasActuales, razon: t.firstWeekSetupReason };
  }

  const variacionPeso = pesoActual - pesoAnterior;
  const VELOCIDAD_IDEAL: Record<Objetivo, { min: number; max: number }> = {
    perder: { min: -1.0, max: -0.3 },
    mantener: { min: -0.2, max: 0.2 },
    ganar: { min: 0.2, max: 0.5 },
  };
  const { min, max } = VELOCIDAD_IDEAL[objetivo];
  const enRangoIdeal = variacionPeso >= min && variacionPeso <= max;
  let ajuste = 0;
  let razon = "";
  const n = (v: number) => Math.abs(v).toFixed(1);
  const sign = (v: number) => (v >= 0 ? "+" : "");

  if (objetivo === "perder") {
    if (variacionPeso > 0.2) {
      ajuste = sensacion === "lleno" ? -200 : -150;
      razon = t.gainedWeightReduceCal.replace("{n}", n(variacionPeso));
    } else if (variacionPeso > -0.1) {
      ajuste = sensacion === "lleno" ? -150 : sensacion === "hambre" ? -50 : -100;
      razon = t.weightStalled.replace("{n}", `${sign(variacionPeso)}${n(variacionPeso)}`);
    } else if (enRangoIdeal) {
      if (sensacion === "hambre") { ajuste = 75; razon = t.idealLossHungry.replace("{n}", n(variacionPeso)); }
      else { ajuste = 0; razon = t.idealLossOk.replace("{n}", n(variacionPeso)); }
    } else if (variacionPeso < -1.0) {
      ajuste = sensacion === "hambre" ? 200 : 150;
      razon = t.tooFastLoss.replace("{n}", n(variacionPeso));
    }
  } else if (objetivo === "ganar") {
    if (variacionPeso < 0) {
      ajuste = sensacion === "lleno" ? 100 : 200;
      razon = t.lostWeightGainGoal.replace("{n}", n(variacionPeso));
    } else if (variacionPeso < 0.2) {
      ajuste = sensacion === "lleno" ? 75 : 150;
      razon = t.gainedTooLittle.replace("{n}", n(variacionPeso));
    } else if (enRangoIdeal) {
      ajuste = 0; razon = t.idealGainOk.replace("{n}", n(variacionPeso));
    } else if (variacionPeso > 0.6) {
      ajuste = -100; razon = t.gainedTooFast.replace("{n}", n(variacionPeso));
    }
  } else {
    if (Math.abs(variacionPeso) <= 0.2) { ajuste = 0; razon = t.weightStableOk.replace("{n}", `${sign(variacionPeso)}${n(variacionPeso)}`); }
    else if (variacionPeso > 0.3) { ajuste = sensacion === "lleno" ? -150 : -100; razon = t.gainedMaintain.replace("{n}", n(variacionPeso)); }
    else if (variacionPeso < -0.3) { ajuste = sensacion === "hambre" ? 150 : 100; razon = t.lostMaintain.replace("{n}", n(variacionPeso)); }
  }

  const margenMax = objetivo === "perder" ? tdee - 200 : tdee + 600;
  const margenMin = Math.max(1200, objetivo === "perder" ? tdee - 800 : 1200);
  const nuevasCalorias = Math.min(margenMax, Math.max(margenMin, caloriasActuales + ajuste));
  return { nuevasCalorias, ajuste: nuevasCalorias - caloriasActuales, razon };
}

async function obtenerPromedioSemanal(): Promise<number> {
  try {
    let total = 0; let dias = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = `nutri_meals_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        const meals = JSON.parse(stored);
        const kcal = Object.values(meals).flat().reduce((acc: number, f: any) => acc + (f.calories || 0), 0);
        if (kcal > 0) { total += kcal; dias++; }
      }
    }
    return dias > 0 ? Math.round(total / dias) : 0;
  } catch { return 0; }
}

type DiaMacros = {
  fecha: Date;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  hasData: boolean;
};

async function obtenerHistorial7Dias(): Promise<DiaMacros[]> {
  const dias: DiaMacros[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = `nutri_meals_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        const meals: Record<string, any[]> = JSON.parse(stored);
        const items: any[] = Object.values(meals).flat();
        const kcal    = Math.round(items.reduce((a, f) => a + (f.calories || 0), 0));
        const protein = Math.round(items.reduce((a, f) => a + (f.protein  || 0), 0));
        const carbs   = Math.round(items.reduce((a, f) => a + (f.carbs    || 0), 0));
        const fat     = Math.round(items.reduce((a, f) => a + (f.fat      || 0), 0));
        dias.push({ fecha: d, kcal, protein, carbs, fat, hasData: kcal > 0 });
      } else {
        dias.push({ fecha: d, kcal: 0, protein: 0, carbs: 0, fat: 0, hasData: false });
      }
    } catch {
      dias.push({ fecha: d, kcal: 0, protein: 0, carbs: 0, fat: 0, hasData: false });
    }
  }
  return dias;
}

// ── Gráfico semanal ─────────────────────────────────────────────────────────
type MacroKey = "kcal" | "protein" | "carbs" | "fat";
const GRAFICO_MACRO_COLORS: Record<MacroKey, string> = {
  kcal: "#4ADE80", protein: "#60A5FA", carbs: "#FBBF24", fat: "#F87171",
};
const GRAFICO_MACRO_UNITS: Record<MacroKey, string> = {
  kcal: "kcal", protein: "g", carbs: "g", fat: "g",
};

function GraficoSemanal({ datos, goals, colors }: {
  datos: DiaMacros[];
  goals: { calories: number; protein: number; carbs: number; fat: number } | null;
  colors: any;
}) {
  const { t, language } = useApp();
  const [macro, setMacro] = useState<MacroKey>("kcal");
  const locale = language === "zh" ? "zh-CN" : language === "ja" ? "ja-JP" : language === "ko" ? "ko-KR" : language === "ar" ? "ar-SA" : language;
  const getMacroLabel = (m: MacroKey) => m === "kcal" ? t.calories : m === "protein" ? t.proteins : m === "carbs" ? t.carbs : t.fats;

  const getVal = (d: DiaMacros): number =>
    macro === "kcal" ? d.kcal : macro === "protein" ? d.protein : macro === "carbs" ? d.carbs : d.fat;

  const goalVal = !goals ? 0
    : macro === "kcal" ? goals.calories
    : macro === "protein" ? goals.protein
    : macro === "carbs" ? goals.carbs
    : goals.fat;

  const maxVal = Math.max(...datos.map(getVal), goalVal, 1);
  const CHART_H = 110;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const diasConDatos = datos.filter(d => d.hasData);
  const promedio = diasConDatos.length > 0
    ? Math.round(diasConDatos.reduce((a, d) => a + getVal(d), 0) / diasConDatos.length)
    : 0;
  const diffPct = goalVal > 0 && promedio > 0
    ? Math.round(((promedio - goalVal) / goalVal) * 100)
    : null;

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.cardBorder, gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>{t.last7DaysHistory}</Text>

      {/* Selector macro */}
      <View style={{ flexDirection: "row", gap: 6 }}>
        {(["kcal", "protein", "carbs", "fat"] as MacroKey[]).map(m => (
          <TouchableOpacity
            key={m}
            style={{ flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: "center", backgroundColor: macro === m ? GRAFICO_MACRO_COLORS[m] + "22" : colors.bg, borderWidth: 1, borderColor: macro === m ? GRAFICO_MACRO_COLORS[m] : colors.cardBorder }}
            onPress={() => setMacro(m)}
          >
            <Text style={{ color: macro === m ? GRAFICO_MACRO_COLORS[m] : colors.textMuted, fontSize: 10, fontWeight: "700" }}>
              {getMacroLabel(m)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Barras */}
      <View style={{ position: "relative" }}>
        {/* Línea de objetivo (dashed simulada con View) */}
        {goalVal > 0 && (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 22 + Math.round((goalVal / maxVal) * CHART_H), height: 1, backgroundColor: GRAFICO_MACRO_COLORS[macro] + "55" }}>
            <Text style={{ position: "absolute", right: 2, top: -10, color: GRAFICO_MACRO_COLORS[macro], fontSize: 8, fontWeight: "700" }}>{t.goal}</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: CHART_H + 22 }}>
          {datos.map((dia, i) => {
            const val = getVal(dia);
            const barH = dia.hasData ? Math.max(4, Math.round((val / maxVal) * CHART_H)) : 4;
            const isToday = dia.fecha.getTime() === hoy.getTime();
            const overGoal = goalVal > 0 && val > goalVal * 1.08;
            const barColor = !dia.hasData ? colors.cardBorder : overGoal ? "#F87171" : GRAFICO_MACRO_COLORS[macro];
            const dowJS = dia.fecha.getDay();
            const dowIdx = dowJS === 0 ? 6 : dowJS - 1;
            return (
              <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: CHART_H + 22 }}>
                {dia.hasData && (
                  <Text style={{ color: barColor, fontSize: 8, fontWeight: "700", marginBottom: 2 }}>
                    {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val)}
                  </Text>
                )}
                <View style={{ width: "82%", height: barH, borderRadius: 5, backgroundColor: barColor, opacity: isToday ? 1 : 0.65 }} />
                <Text style={{ color: isToday ? GRAFICO_MACRO_COLORS[macro] : colors.textMuted, fontSize: 10, marginTop: 4, fontWeight: isToday ? "800" : "500" }}>
                  {dia.fecha.toLocaleDateString(locale, { weekday: "short" }).slice(0, 2).toUpperCase()}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Resumen */}
      {diasConDatos.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: "center" }}>
          {t.noHistoryData}
        </Text>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.bg, borderRadius: 10, padding: 10 }}>
          <Text style={{ color: colors.textSub, fontSize: 12 }}>
            {t.avgNDays.replace("{n}", String(diasConDatos.length))}{" "}
            <Text style={{ color: GRAFICO_MACRO_COLORS[macro], fontWeight: "700" }}>
              {promedio} {GRAFICO_MACRO_UNITS[macro]}
            </Text>
          </Text>
          {diffPct !== null && (
            <Text style={{ color: Math.abs(diffPct) <= 8 ? "#4ADE80" : diffPct > 8 ? "#F87171" : "#FBBF24", fontSize: 11, fontWeight: "700" }}>
              {diffPct > 0 ? "+" : ""}{t.vsMeta.replace("{pct}", String(diffPct))}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

export default function SeguimientoScreen() {
  const router = useRouter();
  const { colors, theme, t, language } = useApp();
  const locale = language === "zh" ? "zh-CN" : language === "ja" ? "ja-JP" : language === "ko" ? "ko-KR" : language === "ar" ? "ar-SA" : language;
  const [peso, setPeso] = useState("");
  const [sensacion, setSensacion] = useState<Sensacion>("bien");
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<RegistroSemanal[]>([]);
  const [goals, setGoals] = useState<{ calories: number; protein: number; carbs: number; fat: number } | null>(null);
  const [perfil, setPerfil] = useState<{ peso: number; altura: number; edad: number; sexo: "hombre" | "mujer"; actividad: string; objetivo: Objetivo } | null>(null);
  const [promedioSemanal, setPromedioSemanal] = useState(0);
  const [historialDiario, setHistorialDiario] = useState<DiaMacros[]>([]);
  const [ultimoRegistro, setUltimoRegistro] = useState<RegistroSemanal | null>(null);
  const [yaRegistradoEstaSemana, setYaRegistradoEstaSemana] = useState(false);
  const [tdee, setTdee] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg");

  useFocusEffect(useCallback(() => { cargarDatos(); }, []));
  useEffect(() => { loadWeightUnit().then(setWeightUnit); }, []);

  const cargarDatos = async () => {
    try {
      const [promedio, historial7d] = await Promise.all([
        obtenerPromedioSemanal(),
        obtenerHistorial7Dias(),
      ]);
      setPromedioSemanal(promedio);
      setHistorialDiario(historial7d);

      // Usar reintento para esperar a que la sesión esté lista en web
      const session = await getSessionWithRetry();
      if (!session?.user) return;
      setUserId(session.user.id);

      const { data: perfilData } = await supabase
        .from("perfiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (perfilData) {
        const p = {
          peso: perfilData.peso,
          altura: perfilData.altura,
          edad: perfilData.edad,
          sexo: perfilData.sexo,
          actividad: perfilData.actividad,
          objetivo: perfilData.objetivo,
        };
        setPerfil(p);
        setTdee(calcularTDEE(p));

        const goalsRaw = await AsyncStorage.getItem(GOALS_KEY);
        const goalsLocal = goalsRaw ? JSON.parse(goalsRaw) : null;

        if (perfilData.calorias_objetivo) {
          const goalsRemotos = {
            calories: perfilData.calorias_objetivo,
            protein: perfilData.proteina_objetivo ?? goalsLocal?.protein ?? 150,
            carbs: perfilData.carbos_objetivo ?? goalsLocal?.carbs ?? 250,
            fat: perfilData.grasa_objetivo ?? goalsLocal?.fat ?? 65,
          };
          await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(goalsRemotos));
          setGoals(goalsRemotos);
        } else if (goalsLocal) {
          setGoals(goalsLocal);
        } else {
          const tdeeCalc = calcularTDEE(p);
          const metaIdeal = calcularMetaCaloriasIdeal(tdeeCalc, p.objetivo);
          const macros = calcularMacros(metaIdeal, p.peso, p.objetivo);
          const goalsCalculados = { calories: metaIdeal, ...macros };
          await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(goalsCalculados));
          setGoals(goalsCalculados);
        }
      } else {
        const goalsRaw = await AsyncStorage.getItem(GOALS_KEY);
        if (goalsRaw) setGoals(JSON.parse(goalsRaw));
      }

      try {
        const { data: registros } = await supabase
          .from("seguimiento_semanal")
          .select("*")
          .eq("user_id", session.user.id)
          .order("fecha", { ascending: false })
          .limit(20);

        if (registros && registros.length > 0) {
          const hist: RegistroSemanal[] = registros.map((r: any) => ({
            fecha: r.fecha,
            peso: r.peso,
            sensacion: r.sensacion,
            caloriasPromedio: r.calorias_promedio,
            caloriasAnteriores: r.calorias_anteriores,
            caloriasNuevas: r.calorias_nuevas,
            proteinaNueva: r.proteina_nueva,
            carbosNuevos: r.carbos_nuevos,
            grasaNueva: r.grasa_nueva,
            ajuste: r.ajuste,
            nota: r.nota,
            tdee: r.tdee,
            objetivoCaloricoIdeal: r.objetivo_calorico_ideal,
          }));
          setHistorial(hist);
          await AsyncStorage.setItem(SEGUIMIENTO_KEY, JSON.stringify(hist));
          const ultimo = hist[0];
          setUltimoRegistro(ultimo);
          const dias = Math.floor((Date.now() - new Date(ultimo.fecha).getTime()) / (1000 * 60 * 60 * 24));
          setYaRegistradoEstaSemana(dias < 6);
        } else {
          const historialRaw = await AsyncStorage.getItem(SEGUIMIENTO_KEY);
          if (historialRaw) {
            const hist = JSON.parse(historialRaw);
            setHistorial(hist);
            if (hist.length > 0) {
              setUltimoRegistro(hist[0]);
              const dias = Math.floor((Date.now() - new Date(hist[0].fecha).getTime()) / (1000 * 60 * 60 * 24));
              setYaRegistradoEstaSemana(dias < 6);
            }
          }
        }
      } catch {
        const historialRaw = await AsyncStorage.getItem(SEGUIMIENTO_KEY);
        if (historialRaw) {
          const hist = JSON.parse(historialRaw);
          setHistorial(hist);
          if (hist.length > 0) {
            setUltimoRegistro(hist[0]);
            const dias = Math.floor((Date.now() - new Date(hist[0].fecha).getTime()) / (1000 * 60 * 60 * 24));
            setYaRegistradoEstaSemana(dias < 6);
          }
        }
      }
    } catch (e: any) { console.warn("cargarHistorial:", e?.message); }
  };

  const guardarRegistro = async () => {
    const pesoDisplay = Number(peso.replace(",", "."));
    const minW = weightUnit === "lbs" ? 66 : 30;
    const maxW = weightUnit === "lbs" ? 661 : 300;
    if (!peso || pesoDisplay < minW || pesoDisplay > maxW) {
      Alert.alert(t.invalidWeight, t.invalidWeightMsg);
      return;
    }
    if (!goals || !perfil) {
      Alert.alert(t.error, t.couldNotLoadProfile);
      return;
    }

    setGuardando(true);
    try {
      const pesoNum = displayWeightToKg(Number(peso.replace(",", ".")), weightUnit);
      const tdeeActual = calcularTDEE({ ...perfil, peso: pesoNum });
      const metaIdeal = calcularMetaCaloriasIdeal(tdeeActual, perfil.objetivo);

      const { nuevasCalorias, ajuste, razon } = calcularAjusteSemanal({
        objetivo: perfil.objetivo, sensacion,
        pesoActual: pesoNum, pesoAnterior: ultimoRegistro ? ultimoRegistro.peso : null,
        caloriasActuales: goals.calories, tdee: tdeeActual, peso: pesoNum,
      }, t);

      const nuevosMacros = calcularMacros(nuevasCalorias, pesoNum, perfil.objetivo);
      const nuevosGoals = { calories: nuevasCalorias, ...nuevosMacros };

      const registro: RegistroSemanal = {
        fecha: new Date().toISOString(), peso: pesoNum, sensacion,
        caloriasPromedio: promedioSemanal, caloriasAnteriores: goals.calories,
        caloriasNuevas: nuevasCalorias, proteinaNueva: nuevosMacros.protein,
        carbosNuevos: nuevosMacros.carbs, grasaNueva: nuevosMacros.fat,
        ajuste, nota: razon, tdee: tdeeActual, objetivoCaloricoIdeal: metaIdeal,
      };

      const nuevoHistorial = [registro, ...historial].slice(0, 20);
      await AsyncStorage.setItem(SEGUIMIENTO_KEY, JSON.stringify(nuevoHistorial));
      await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(nuevosGoals));

      if (userId) {
        try {
          await supabase.from("seguimiento_semanal").insert({
            user_id: userId,
            fecha: registro.fecha,
            peso: registro.peso,
            sensacion: registro.sensacion,
            calorias_promedio: registro.caloriasPromedio,
            calorias_anteriores: registro.caloriasAnteriores,
            calorias_nuevas: registro.caloriasNuevas,
            proteina_nueva: registro.proteinaNueva,
            carbos_nuevos: registro.carbosNuevos,
            grasa_nueva: registro.grasaNueva,
            ajuste: registro.ajuste,
            nota: registro.nota,
            tdee: registro.tdee,
            objetivo_calorico_ideal: registro.objetivoCaloricoIdeal,
          });
          await supabase.from("perfiles").update({
            calorias_objetivo: nuevasCalorias,
            proteina_objetivo: nuevosMacros.protein,
            carbos_objetivo: nuevosMacros.carbs,
            grasa_objetivo: nuevosMacros.fat,
            peso: pesoNum,
          }).eq("id", userId);
        } catch (e: any) { console.warn("guardarRegistro cloud sync:", e?.message); }
      }

      setGoals(nuevosGoals);
      setHistorial(nuevoHistorial);
      setUltimoRegistro(registro);
      setYaRegistradoEstaSemana(true);
      setPeso("");

      const mensajeAjuste = ajuste === 0
        ? t.noCalorieChanges
        : ajuste > 0
          ? t.calAdded.replace("{n}", String(ajuste)).replace("{goal}", String(nuevasCalorias))
          : t.calReduced.replace("{n}", String(Math.abs(ajuste))).replace("{goal}", String(nuevasCalorias));

      Alert.alert(t.weeklyRecord, `${razon}\n\n${mensajeAjuste}`);
    } catch { Alert.alert(t.error, t.couldNotSaveRecord); }
    setGuardando(false);
  };

  const previewAjuste = (() => {
    const minW = weightUnit === "lbs" ? 66 : 30;
    if (!goals || !perfil || !peso || Number(peso.replace(",", ".")) < minW) return null;
    const pesoNum = displayWeightToKg(Number(peso.replace(",", ".")), weightUnit);
    const tdeeActual = calcularTDEE({ ...perfil, peso: pesoNum });
    return calcularAjusteSemanal({
      objetivo: perfil.objetivo, sensacion,
      pesoActual: pesoNum, pesoAnterior: ultimoRegistro ? ultimoRegistro.peso : null,
      caloriasActuales: goals.calories, tdee: tdeeActual, peso: pesoNum,
    }, t);
  })();

  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>{t.back}</Text></TouchableOpacity>
          <Text style={s.title}>{t.weeklyTracking}</Text>
          <Text style={s.subtitle}>{t.trackWeightSubtitle}</Text>
        </View>

        {perfil && tdee > 0 && (
          <View style={s.tdeeCard}>
            <Text style={s.tdeeTitle}>{t.yourMetabolismCalc}</Text>
            <View style={s.tdeeRow}>
              <View style={s.tdeeDato}>
                <Text style={s.tdeeDatoVal}>{tdee}</Text>
                <Text style={s.tdeeDatoLabel}>{t.tdeeLabel}</Text>
              </View>
              <View style={s.tdeeDato}>
                <Text style={[s.tdeeDatoVal, { color: "#4ADE80" }]}>{calcularMetaCaloriasIdeal(tdee, perfil.objetivo)}</Text>
                <Text style={s.tdeeDatoLabel}>{t.idealGoalLabel}</Text>
              </View>
              <View style={s.tdeeDato}>
                <Text style={[s.tdeeDatoVal, { color: "#60A5FA" }]}>{goals?.calories ?? "—"}</Text>
                <Text style={s.tdeeDatoLabel}>{t.currentLabel}</Text>
              </View>
            </View>
            <Text style={s.tdeeHint}>
              {perfil.objetivo === "perder"
                ? t.tdeeDeficit.replace("{n}", String(tdee - (goals?.calories ?? tdee))).replace("{kg}", (((tdee - (goals?.calories ?? tdee)) * 7) / 7700).toFixed(2))
                : perfil.objetivo === "ganar"
                  ? t.tdeeSurplus.replace("{n}", String((goals?.calories ?? tdee) - tdee))
                  : t.tdeeMaintain}
            </Text>
          </View>
        )}

        {goals && (
          <View style={s.goalsCard}>
            <Text style={s.goalsTitle}>{t.currentGoalsTitle}</Text>
            <View style={s.goalsRow}>
              {[
                { val: goals.calories, label: "kcal", color: "#4ADE80" },
                { val: goals.protein + "g", label: t.proteins, color: "#60A5FA" },
                { val: goals.carbs + "g", label: t.carbs, color: "#FBBF24" },
                { val: goals.fat + "g", label: t.fats, color: "#F87171" },
              ].map((item) => (
                <View key={item.label} style={s.goalChip}>
                  <Text style={[s.goalChipVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={s.goalChipLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
            {promedioSemanal > 0 && (
              <View style={s.promedioRow}>
                <Text style={s.promedioLabel}>{t.weeklyActualAvg}</Text>
                <Text style={[s.promedioVal, { color: promedioSemanal > goals.calories ? "#F87171" : "#4ADE80" }]}>
                  {promedioSemanal} {t.kcalPerDay}
                </Text>
              </View>
            )}
          </View>
        )}

        {historialDiario.length > 0 && (
          <GraficoSemanal datos={historialDiario} goals={goals} colors={colors} />
        )}

        {yaRegistradoEstaSemana ? (
          <View style={s.yaRegistradoCard}>
            <Text style={s.yaRegistradoIcon}>✅</Text>
            <Text style={s.yaRegistradoTitle}>{t.alreadyRegisteredThisWeek}</Text>
            <Text style={s.yaRegistradoDesc}>
              {t.comeBackInDays.replace("{n}", String(ultimoRegistro ? Math.max(1, 7 - Math.floor((Date.now() - new Date(ultimoRegistro.fecha).getTime()) / (1000 * 60 * 60 * 24))) : 7))}
            </Text>
            {ultimoRegistro && (
              <View style={s.ultimoResumen}>
                <Text style={s.ultimoResumenText}>{t.lastWeightLabel} <Text style={{ color: colors.text, fontWeight: "700" }}>{kgToDisplay(ultimoRegistro.peso, weightUnit)} {weightUnit}</Text></Text>
                <Text style={[s.ultimoResumenText, { color: ultimoRegistro.ajuste >= 0 ? "#4ADE80" : "#F87171" }]}>
                  {ultimoRegistro.ajuste >= 0 ? "+" : ""}{t.kcalAdjusted.replace("{n}", String(ultimoRegistro.ajuste))}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={s.formCard}>
            <Text style={s.formTitle}>{t.thisWeekRecord}</Text>

            <View style={s.fieldRow}>
              <View style={s.fieldLeft}>
                <Text style={s.fieldLabel}>{t.yourCurrentWeight}</Text>
                <Text style={s.fieldHint}>{ultimoRegistro ? t.lastWeekKgLabel.replace("{n}", String(kgToDisplay(ultimoRegistro.peso, weightUnit))) : t.firstTimeRegistering}</Text>
              </View>
              <View style={s.fieldRight}>
                <TextInput style={s.pesoInput} value={peso} onChangeText={setPeso} placeholder={weightUnit === "lbs" ? "154" : "70"} placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" selectTextOnFocus />
                <Text style={s.pesoUnit}>{weightUnit}</Text>
              </View>
            </View>

            {ultimoRegistro && peso && Number(peso) >= (weightUnit === "lbs" ? 66 : 30) && (() => {
              const prevDisplay = kgToDisplay(ultimoRegistro.peso, weightUnit);
              const curDisplay = Number(peso);
              const diff = curDisplay - prevDisplay;
              const threshold = weightUnit === "lbs" ? 0.2 : 0.1;
              const color = diff > threshold ? "#F87171" : diff < -threshold ? "#4ADE80" : "#FBBF24";
              return (
                <View style={[s.variacionRow, { borderColor: color }]}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color }}>
                    {diff > 0 ? "+" : ""}{diff.toFixed(1)} {weightUnit} {t.kgThisWeek}
                    {diff > threshold ? t.weightRising : diff < -threshold ? t.weightFalling : t.weightStable}
                  </Text>
                </View>
              );
            })()}

            <Text style={s.sensacionTitle}>{t.howDidYouFeel}</Text>
            <View style={s.sensacionCol}>
              {(["hambre", "bien", "lleno"] as Sensacion[]).map((sv) => (
                <TouchableOpacity key={sv} style={[s.sensacionBtn, sensacion === sv && { backgroundColor: SENSACION_COLORS[sv] + "22", borderColor: SENSACION_COLORS[sv] }]} onPress={() => setSensacion(sv)} activeOpacity={0.7}>
                  <Text style={s.sensacionIcon}>{SENSACION_ICONS[sv]}</Text>
                  <Text style={[s.sensacionLabel, sensacion === sv && { color: SENSACION_COLORS[sv], fontWeight: "700" }]}>{sv === "hambre" ? t.feelingHungry : sv === "bien" ? t.feelingGood : t.feelingFull}</Text>
                  {sensacion === sv && <Text style={[s.sensacionCheck, { color: SENSACION_COLORS[sv] }]}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>

            {previewAjuste && (
              <View style={s.previewCard}>
                <Text style={s.previewTitulo}>{t.estimatedAdjustment}</Text>
                <Text style={s.previewRazon}>{previewAjuste.razon}</Text>
                <View style={s.previewNums}>
                  <View style={s.previewNum}>
                    <Text style={[s.previewNumVal, { color: previewAjuste.ajuste === 0 ? "#58A6FF" : previewAjuste.ajuste > 0 ? "#4ADE80" : "#F87171" }]}>
                      {previewAjuste.ajuste === 0 ? "=" : previewAjuste.ajuste > 0 ? `+${previewAjuste.ajuste}` : previewAjuste.ajuste} kcal
                    </Text>
                    <Text style={s.previewNumLabel}>{t.changeLabel}</Text>
                  </View>
                  <View style={s.previewNum}>
                    <Text style={[s.previewNumVal, { color: "#4ADE80" }]}>{previewAjuste.nuevasCalorias}</Text>
                    <Text style={s.previewNumLabel}>{t.newGoal}</Text>
                  </View>
                  {goals && perfil && (
                    <View style={s.previewNum}>
                      <Text style={[s.previewNumVal, { color: "#FBBF24" }]}>
                        ~{(Math.abs(calcularTDEE({ ...perfil, peso: displayWeightToKg(Number(peso), weightUnit) }) - previewAjuste.nuevasCalorias) * 7 / 7700).toFixed(2)}kg
                      </Text>
                      <Text style={s.previewNumLabel}>{t.weekEstimate}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            <TouchableOpacity style={[s.guardarBtn, guardando && s.guardarBtnDisabled]} onPress={guardarRegistro} disabled={guardando}>
              <Text style={s.guardarBtnText}>{guardando ? t.savingDots : t.saveAndUpdateGoals}</Text>
            </TouchableOpacity>
          </View>
        )}

        {historial.length > 0 && (
          <View style={s.historialSection}>
            <Text style={s.historialTitle}>{t.weeklyHistory}</Text>
            {historial.map((reg, i) => {
              const fechaStr = new Date(reg.fecha).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
              const varPeso = i < historial.length - 1 ? reg.peso - historial[i + 1].peso : null;
              return (
                <View key={i} style={s.historialCard}>
                  <View style={s.historialHeader}>
                    <View style={s.historialFechaWrap}>
                      <Text style={s.historialFecha}>{fechaStr}</Text>
                      {varPeso !== null && (
                        <Text style={[s.historialVarPeso, { color: varPeso < -0.1 ? "#4ADE80" : varPeso > 0.1 ? "#F87171" : "#FBBF24" }]}>
                          {varPeso > 0 ? "+" : ""}{varPeso.toFixed(1)}kg
                        </Text>
                      )}
                    </View>
                    <View style={[s.historialSensacion, { backgroundColor: SENSACION_COLORS[reg.sensacion] + "22", borderColor: SENSACION_COLORS[reg.sensacion] + "55" }]}>
                      <Text style={{ fontSize: 12 }}>{SENSACION_ICONS[reg.sensacion]}</Text>
                    </View>
                  </View>
                  <View style={s.historialRow}>
                    {[
                      { val: `${reg.peso}kg`, label: t.weightLabel },
                      { val: reg.caloriasPromedio > 0 ? String(reg.caloriasPromedio) : "—", label: t.avgKcal },
                      { val: reg.ajuste === 0 ? "=" : reg.ajuste > 0 ? `+${reg.ajuste}` : String(reg.ajuste), label: t.adjustmentLabel, color: reg.ajuste === 0 ? colors.textSub : reg.ajuste > 0 ? "#4ADE80" : "#F87171" },
                      { val: String(reg.caloriasNuevas), label: t.newGoal, color: "#4ADE80" },
                    ].map((d) => (
                      <View key={d.label} style={s.historialDato}>
                        <Text style={[s.historialDatoVal, d.color ? { color: d.color } : {}]}>{d.val}</Text>
                        <Text style={s.historialDatoLabel}>{d.label}</Text>
                      </View>
                    ))}
                  </View>
                  {reg.nota ? <Text style={s.historialNota}>"{reg.nota}"</Text> : null}
                </View>
              );
            })}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
function makeStyles(colors: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { flex: 1, paddingHorizontal: 16 },
    header: { paddingTop: 20, paddingBottom: 16, gap: 6 },
    back: { color: "#58A6FF", fontSize: 14, marginBottom: 4 },
    title: { color: colors.text, fontSize: 28, fontWeight: "800" },
    subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
    tdeeCard: { backgroundColor: colors.card, borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.cardBorder, gap: 12 },
    tdeeTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
    tdeeRow: { flexDirection: "row", gap: 8 },
    tdeeDato: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder },
    tdeeDatoVal: { color: colors.text, fontSize: 16, fontWeight: "800" },
    tdeeDatoLabel: { color: colors.textMuted, fontSize: 9, marginTop: 2, textAlign: "center" },
    tdeeHint: { color: colors.textMuted, fontSize: 12, textAlign: "center", lineHeight: 16 },
    goalsCard: { backgroundColor: colors.card, borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.cardBorder, gap: 12 },
    goalsTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
    goalsRow: { flexDirection: "row", gap: 8 },
    goalChip: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder },
    goalChipVal: { fontSize: 14, fontWeight: "800" },
    goalChipLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
    promedioRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.bg, borderRadius: 10, padding: 10 },
    promedioLabel: { color: colors.textSub, fontSize: 13 },
    promedioVal: { fontSize: 14, fontWeight: "700" },
    yaRegistradoCard: { backgroundColor: "#4ADE8011", borderRadius: 20, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: "#4ADE8033", alignItems: "center", gap: 8 },
    yaRegistradoIcon: { fontSize: 40 },
    yaRegistradoTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
    yaRegistradoDesc: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
    ultimoResumen: { flexDirection: "row", gap: 16, marginTop: 4 },
    ultimoResumenText: { color: colors.textMuted, fontSize: 13 },
    formCard: { backgroundColor: colors.card, borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.cardBorder, gap: 16 },
    formTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
    fieldRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.bg, borderRadius: 14, padding: 14 },
    fieldLeft: { flex: 1, gap: 4 },
    fieldLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
    fieldHint: { color: colors.textMuted, fontSize: 12 },
    fieldRight: { flexDirection: "row", alignItems: "center", gap: 8 },
    pesoInput: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 12, padding: 12, color: colors.text, fontSize: 24, fontWeight: "800", width: 90, textAlign: "center" },
    pesoUnit: { color: colors.textMuted, fontSize: 14 },
    variacionRow: { backgroundColor: colors.bg, borderRadius: 10, padding: 10, borderWidth: 1, alignItems: "center" },
    sensacionTitle: { color: colors.textSub, fontSize: 13, fontWeight: "600" },
    sensacionCol: { gap: 8 },
    sensacionBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.cardBorder },
    sensacionIcon: { fontSize: 22 },
    sensacionLabel: { flex: 1, color: colors.textSub, fontSize: 15, fontWeight: "600" },
    sensacionCheck: { fontSize: 16, fontWeight: "800" },
    previewCard: { backgroundColor: "#1F6FEB11", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#1F6FEB33", gap: 10 },
    previewTitulo: { color: "#58A6FF", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    previewRazon: { color: colors.textSub, fontSize: 13, lineHeight: 18 },
    previewNums: { flexDirection: "row", gap: 8 },
    previewNum: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder },
    previewNumVal: { fontSize: 15, fontWeight: "800" },
    previewNumLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
    guardarBtn: { backgroundColor: "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center" },
    guardarBtnDisabled: { opacity: 0.6 },
    guardarBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
    historialSection: { gap: 10, marginBottom: 8 },
    historialTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
    historialCard: { backgroundColor: colors.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.cardBorder, gap: 10 },
    historialHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    historialFechaWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
    historialFecha: { color: colors.textSub, fontSize: 13, fontWeight: "600" },
    historialVarPeso: { fontSize: 12, fontWeight: "700" },
    historialSensacion: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    historialRow: { flexDirection: "row", gap: 8 },
    historialDato: { flex: 1, backgroundColor: colors.bg, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
    historialDatoVal: { color: colors.text, fontSize: 13, fontWeight: "700" },
    historialDatoLabel: { color: colors.textMuted, fontSize: 9, marginTop: 2 },
    historialNota: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontStyle: "italic" },
  });
}