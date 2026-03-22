import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
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

const SENSACION_LABELS: Record<Sensacion, string> = {
  hambre: "He pasado hambre",
  bien: "Me he sentido bien",
  lleno: "He estado muy lleno",
};
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
}): { nuevasCalorias: number; ajuste: number; razon: string } {
  const { objetivo, sensacion, pesoActual, pesoAnterior, caloriasActuales, tdee, peso } = params;

  if (pesoAnterior === null) {
    const meta = calcularMetaCaloriasIdeal(tdee, objetivo);
    return { nuevasCalorias: meta, ajuste: meta - caloriasActuales, razon: "Primera semana registrada. Establecemos tu objetivo calórico basado en tu metabolismo." };
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

  if (objetivo === "perder") {
    if (variacionPeso > 0.2) {
      ajuste = sensacion === "lleno" ? -200 : -150;
      razon = `Ganaste ${variacionPeso.toFixed(1)}kg esta semana. Bajamos las calorías para retomar el déficit.`;
    } else if (variacionPeso > -0.1) {
      ajuste = sensacion === "lleno" ? -150 : sensacion === "hambre" ? -50 : -100;
      razon = `Peso estancado (${variacionPeso >= 0 ? "+" : ""}${variacionPeso.toFixed(1)}kg). Bajamos ligeramente para activar el déficit.`;
    } else if (enRangoIdeal) {
      if (sensacion === "hambre") { ajuste = 75; razon = `Pérdida ideal de ${Math.abs(variacionPeso).toFixed(1)}kg pero con hambre. Subimos un poco para que sea sostenible.`; }
      else { ajuste = 0; razon = `Pérdida ideal de ${Math.abs(variacionPeso).toFixed(1)}kg/semana. Mantenemos el plan actual.`; }
    } else if (variacionPeso < -1.0) {
      ajuste = sensacion === "hambre" ? 200 : 150;
      razon = `Perdiste ${Math.abs(variacionPeso).toFixed(1)}kg, demasiado rápido. Subimos calorías para proteger el músculo.`;
    }
  } else if (objetivo === "ganar") {
    if (variacionPeso < 0) {
      ajuste = sensacion === "lleno" ? 100 : 200;
      razon = `Perdiste ${Math.abs(variacionPeso).toFixed(1)}kg cuando el objetivo es ganar. Aumentamos las calorías.`;
    } else if (variacionPeso < 0.2) {
      ajuste = sensacion === "lleno" ? 75 : 150;
      razon = `Ganaste solo ${variacionPeso.toFixed(1)}kg. Subimos un poco para acelerar el progreso.`;
    } else if (enRangoIdeal) {
      ajuste = 0; razon = `Ganancia ideal de ${variacionPeso.toFixed(1)}kg/semana. Mantenemos el plan.`;
    } else if (variacionPeso > 0.6) {
      ajuste = -100; razon = `Ganaste ${variacionPeso.toFixed(1)}kg, un poco rápido. Bajamos ligeramente para minimizar grasa.`;
    }
  } else {
    if (Math.abs(variacionPeso) <= 0.2) { ajuste = 0; razon = `Peso estable (${variacionPeso >= 0 ? "+" : ""}${variacionPeso.toFixed(1)}kg). Perfecto mantenimiento.`; }
    else if (variacionPeso > 0.3) { ajuste = sensacion === "lleno" ? -150 : -100; razon = `Ganaste ${variacionPeso.toFixed(1)}kg. Bajamos un poco para volver al peso objetivo.`; }
    else if (variacionPeso < -0.3) { ajuste = sensacion === "hambre" ? 150 : 100; razon = `Perdiste ${Math.abs(variacionPeso).toFixed(1)}kg. Subimos un poco para mantener el peso.`; }
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

export default function SeguimientoScreen() {
  const router = useRouter();
  const { colors, theme } = useApp();
  const [peso, setPeso] = useState("");
  const [sensacion, setSensacion] = useState<Sensacion>("bien");
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<RegistroSemanal[]>([]);
  const [goals, setGoals] = useState<{ calories: number; protein: number; carbs: number; fat: number } | null>(null);
  const [perfil, setPerfil] = useState<{ peso: number; altura: number; edad: number; sexo: "hombre" | "mujer"; actividad: string; objetivo: Objetivo } | null>(null);
  const [promedioSemanal, setPromedioSemanal] = useState(0);
  const [ultimoRegistro, setUltimoRegistro] = useState<RegistroSemanal | null>(null);
  const [yaRegistradoEstaSemana, setYaRegistradoEstaSemana] = useState(false);
  const [tdee, setTdee] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { cargarDatos(); }, []));

  const cargarDatos = async () => {
    try {
      const promedio = await obtenerPromedioSemanal();
      setPromedioSemanal(promedio);

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
    } catch {}
  };

  const guardarRegistro = async () => {
    if (!peso || Number(peso) < 30 || Number(peso) > 300) {
      Alert.alert("Peso inválido", "Introduce un peso entre 30 y 300 kg.");
      return;
    }
    if (!goals || !perfil) {
      Alert.alert("Error", "No se pudo cargar tu perfil.");
      return;
    }

    setGuardando(true);
    try {
      const pesoNum = Number(peso);
      const tdeeActual = calcularTDEE({ ...perfil, peso: pesoNum });
      const metaIdeal = calcularMetaCaloriasIdeal(tdeeActual, perfil.objetivo);

      const { nuevasCalorias, ajuste, razon } = calcularAjusteSemanal({
        objetivo: perfil.objetivo, sensacion,
        pesoActual: pesoNum, pesoAnterior: ultimoRegistro ? ultimoRegistro.peso : null,
        caloriasActuales: goals.calories, tdee: tdeeActual, peso: pesoNum,
      });

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
        } catch {}
      }

      setGoals(nuevosGoals);
      setHistorial(nuevoHistorial);
      setUltimoRegistro(registro);
      setYaRegistradoEstaSemana(true);
      setPeso("");

      const mensajeAjuste = ajuste === 0
        ? "Sin cambios en tus calorías esta semana."
        : ajuste > 0
          ? `Se añaden +${ajuste} kcal → nuevo objetivo: ${nuevasCalorias} kcal/día`
          : `Se reducen ${Math.abs(ajuste)} kcal → nuevo objetivo: ${nuevasCalorias} kcal/día`;

      Alert.alert("✓ Registrado", `${razon}\n\n${mensajeAjuste}`);
    } catch { Alert.alert("Error", "No se pudo guardar el registro."); }
    setGuardando(false);
  };

  const previewAjuste = (() => {
    if (!goals || !perfil || !peso || Number(peso) < 30) return null;
    const pesoNum = Number(peso);
    const tdeeActual = calcularTDEE({ ...perfil, peso: pesoNum });
    return calcularAjusteSemanal({
      objetivo: perfil.objetivo, sensacion,
      pesoActual: pesoNum, pesoAnterior: ultimoRegistro ? ultimoRegistro.peso : null,
      caloriasActuales: goals.calories, tdee: tdeeActual, peso: pesoNum,
    });
  })();

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Volver</Text></TouchableOpacity>
          <Text style={s.title}>Seguimiento semanal</Text>
          <Text style={s.subtitle}>Registra tu peso cada semana para ajustar tus calorías automáticamente</Text>
        </View>

        {perfil && tdee > 0 && (
          <View style={s.tdeeCard}>
            <Text style={s.tdeeTitle}>📐 Tu metabolismo calculado</Text>
            <View style={s.tdeeRow}>
              <View style={s.tdeeDato}>
                <Text style={s.tdeeDatoVal}>{tdee}</Text>
                <Text style={s.tdeeDatoLabel}>TDEE (kcal/día)</Text>
              </View>
              <View style={s.tdeeDato}>
                <Text style={[s.tdeeDatoVal, { color: "#4ADE80" }]}>{calcularMetaCaloriasIdeal(tdee, perfil.objetivo)}</Text>
                <Text style={s.tdeeDatoLabel}>Meta ideal</Text>
              </View>
              <View style={s.tdeeDato}>
                <Text style={[s.tdeeDatoVal, { color: "#60A5FA" }]}>{goals?.calories ?? "—"}</Text>
                <Text style={s.tdeeDatoLabel}>Actual</Text>
              </View>
            </View>
            <Text style={s.tdeeHint}>
              {perfil.objetivo === "perder"
                ? `Déficit de ${tdee - (goals?.calories ?? tdee)} kcal/día → pérdida estimada ~${(((tdee - (goals?.calories ?? tdee)) * 7) / 7700).toFixed(2)}kg/semana`
                : perfil.objetivo === "ganar"
                  ? `Superávit de ${(goals?.calories ?? tdee) - tdee} kcal/día`
                  : "Mantenimiento calórico"}
            </Text>
          </View>
        )}

        {goals && (
          <View style={s.goalsCard}>
            <Text style={s.goalsTitle}>🎯 Objetivos actuales</Text>
            <View style={s.goalsRow}>
              {[
                { val: goals.calories, label: "kcal", color: "#4ADE80" },
                { val: goals.protein + "g", label: "Prot", color: "#60A5FA" },
                { val: goals.carbs + "g", label: "Carbos", color: "#FBBF24" },
                { val: goals.fat + "g", label: "Grasas", color: "#F87171" },
              ].map((item) => (
                <View key={item.label} style={s.goalChip}>
                  <Text style={[s.goalChipVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={s.goalChipLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
            {promedioSemanal > 0 && (
              <View style={s.promedioRow}>
                <Text style={s.promedioLabel}>📊 Promedio real esta semana:</Text>
                <Text style={[s.promedioVal, { color: promedioSemanal > goals.calories ? "#F87171" : "#4ADE80" }]}>
                  {promedioSemanal} kcal/día
                </Text>
              </View>
            )}
          </View>
        )}

        {yaRegistradoEstaSemana ? (
          <View style={s.yaRegistradoCard}>
            <Text style={s.yaRegistradoIcon}>✅</Text>
            <Text style={s.yaRegistradoTitle}>Ya registraste esta semana</Text>
            <Text style={s.yaRegistradoDesc}>
              Vuelve en {ultimoRegistro ? Math.max(1, 7 - Math.floor((Date.now() - new Date(ultimoRegistro.fecha).getTime()) / (1000 * 60 * 60 * 24))) : 7} días.
            </Text>
            {ultimoRegistro && (
              <View style={s.ultimoResumen}>
                <Text style={s.ultimoResumenText}>Último peso: <Text style={{ color: colors.text, fontWeight: "700" }}>{ultimoRegistro.peso} kg</Text></Text>
                <Text style={[s.ultimoResumenText, { color: ultimoRegistro.ajuste >= 0 ? "#4ADE80" : "#F87171" }]}>
                  {ultimoRegistro.ajuste >= 0 ? "+" : ""}{ultimoRegistro.ajuste} kcal ajustadas
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={s.formCard}>
            <Text style={s.formTitle}>📝 Registro de esta semana</Text>

            <View style={s.fieldRow}>
              <View style={s.fieldLeft}>
                <Text style={s.fieldLabel}>⚖️ Tu peso actual</Text>
                <Text style={s.fieldHint}>{ultimoRegistro ? `Semana pasada: ${ultimoRegistro.peso} kg` : "Primera vez que registras"}</Text>
              </View>
              <View style={s.fieldRight}>
                <TextInput style={s.pesoInput} value={peso} onChangeText={setPeso} placeholder="70" placeholderTextColor={colors.textMuted} keyboardType="numeric" selectTextOnFocus />
                <Text style={s.pesoUnit}>kg</Text>
              </View>
            </View>

            {ultimoRegistro && peso && Number(peso) >= 30 && (
              <View style={[s.variacionRow, { borderColor: Number(peso) > ultimoRegistro.peso + 0.1 ? "#F87171" : Number(peso) < ultimoRegistro.peso - 0.1 ? "#4ADE80" : "#FBBF24" }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: Number(peso) > ultimoRegistro.peso + 0.1 ? "#F87171" : Number(peso) < ultimoRegistro.peso - 0.1 ? "#4ADE80" : "#FBBF24" }}>
                  {Number(peso) > ultimoRegistro.peso ? "+" : ""}{(Number(peso) - ultimoRegistro.peso).toFixed(1)} kg esta semana
                  {Number(peso) > ultimoRegistro.peso + 0.1 ? " · Subiendo ↑" : Number(peso) < ultimoRegistro.peso - 0.1 ? " · Bajando ↓" : " · Estable →"}
                </Text>
              </View>
            )}

            <Text style={s.sensacionTitle}>😮 ¿Cómo te has sentido comiendo esta semana?</Text>
            <View style={s.sensacionCol}>
              {(["hambre", "bien", "lleno"] as Sensacion[]).map((sv) => (
                <TouchableOpacity key={sv} style={[s.sensacionBtn, sensacion === sv && { backgroundColor: SENSACION_COLORS[sv] + "22", borderColor: SENSACION_COLORS[sv] }]} onPress={() => setSensacion(sv)} activeOpacity={0.7}>
                  <Text style={s.sensacionIcon}>{SENSACION_ICONS[sv]}</Text>
                  <Text style={[s.sensacionLabel, sensacion === sv && { color: SENSACION_COLORS[sv], fontWeight: "700" }]}>{SENSACION_LABELS[sv]}</Text>
                  {sensacion === sv && <Text style={[s.sensacionCheck, { color: SENSACION_COLORS[sv] }]}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>

            {previewAjuste && (
              <View style={s.previewCard}>
                <Text style={s.previewTitulo}>💡 Ajuste estimado si guardas ahora</Text>
                <Text style={s.previewRazon}>{previewAjuste.razon}</Text>
                <View style={s.previewNums}>
                  <View style={s.previewNum}>
                    <Text style={[s.previewNumVal, { color: previewAjuste.ajuste === 0 ? "#58A6FF" : previewAjuste.ajuste > 0 ? "#4ADE80" : "#F87171" }]}>
                      {previewAjuste.ajuste === 0 ? "=" : previewAjuste.ajuste > 0 ? `+${previewAjuste.ajuste}` : previewAjuste.ajuste} kcal
                    </Text>
                    <Text style={s.previewNumLabel}>Cambio</Text>
                  </View>
                  <View style={s.previewNum}>
                    <Text style={[s.previewNumVal, { color: "#4ADE80" }]}>{previewAjuste.nuevasCalorias}</Text>
                    <Text style={s.previewNumLabel}>Nueva meta</Text>
                  </View>
                  {goals && perfil && (
                    <View style={s.previewNum}>
                      <Text style={[s.previewNumVal, { color: "#FBBF24" }]}>
                        ~{(Math.abs(calcularTDEE({ ...perfil, peso: Number(peso) }) - previewAjuste.nuevasCalorias) * 7 / 7700).toFixed(2)}kg
                      </Text>
                      <Text style={s.previewNumLabel}>Est. semana</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            <TouchableOpacity style={[s.guardarBtn, guardando && s.guardarBtnDisabled]} onPress={guardarRegistro} disabled={guardando}>
              <Text style={s.guardarBtnText}>{guardando ? "Guardando..." : "Guardar y actualizar objetivos"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {historial.length > 0 && (
          <View style={s.historialSection}>
            <Text style={s.historialTitle}>📈 Historial de seguimiento</Text>
            {historial.map((reg, i) => {
              const fechaStr = new Date(reg.fecha).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
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
                      { val: `${reg.peso}kg`, label: "Peso" },
                      { val: reg.caloriasPromedio > 0 ? String(reg.caloriasPromedio) : "—", label: "Prom kcal" },
                      { val: reg.ajuste === 0 ? "=" : reg.ajuste > 0 ? `+${reg.ajuste}` : String(reg.ajuste), label: "Ajuste", color: reg.ajuste === 0 ? colors.textSub : reg.ajuste > 0 ? "#4ADE80" : "#F87171" },
                      { val: String(reg.caloriasNuevas), label: "Nueva meta", color: "#4ADE80" },
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