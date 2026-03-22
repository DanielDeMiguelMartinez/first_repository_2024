import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
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
import { useApp } from "./services/i18n";
import { supabase } from "./services/supabase";

export type UserProfile = {
  id?: string;
  nombre: string;
  peso: number;
  altura: number;
  edad: number;
  sexo: "hombre" | "mujer";
  actividad: "sedentario" | "ligero" | "moderado" | "activo" | "muy_activo";
  objetivo: "perder" | "mantener" | "ganar";
};

const ACTIVIDAD_LABELS: Record<UserProfile["actividad"], string> = {
  sedentario: "Sedentario",
  ligero: "Ligero (1-2 días/sem)",
  moderado: "Moderado (3-5 días/sem)",
  activo: "Activo (6-7 días/sem)",
  muy_activo: "Muy activo (2x día)",
};

const ACTIVIDAD_ICONS: Record<UserProfile["actividad"], string> = {
  sedentario: "🪑", ligero: "🚶", moderado: "🏃", activo: "💪", muy_activo: "🔥",
};

const OBJETIVO_LABELS: Record<UserProfile["objetivo"], string> = {
  perder: "Perder grasa", mantener: "Mantener peso", ganar: "Ganar músculo",
};

const OBJETIVO_ICONS: Record<UserProfile["objetivo"], string> = {
  perder: "⬇️", mantener: "⚖️", ganar: "⬆️",
};

export function calcularObjetivos(p: UserProfile) {
  const bmr = p.sexo === "hombre"
    ? 10 * p.peso + 6.25 * p.altura - 5 * p.edad + 5
    : 10 * p.peso + 6.25 * p.altura - 5 * p.edad - 161;
  const factores = { sedentario: 1.2, ligero: 1.375, moderado: 1.55, activo: 1.725, muy_activo: 1.9 };
  const tdee = Math.round(bmr * factores[p.actividad]);
  const calorias = p.objetivo === "perder" ? tdee - 400 : p.objetivo === "ganar" ? tdee + 300 : tdee;
  const proteinas = Math.round(p.peso * (p.objetivo === "ganar" ? 2.2 : 1.8));
  const grasas = Math.round((calorias * 0.25) / 9);
  const carbos = Math.round((calorias - proteinas * 4 - grasas * 9) / 4);
  return { calories: Math.max(1200, calorias), protein: proteinas, carbs: Math.max(50, carbos), fat: grasas };
}

const PASOS = ["bienvenida", "nombre", "sexo", "medidas", "actividad", "objetivo"] as const;
type Paso = typeof PASOS[number];

// ── Preview de macros en tiempo real ─────────────────────────────────────────
function MacrosPreview({ peso, altura, edad, sexo, actividad, objetivo, colors }: {
  peso: string; altura: string; edad: string;
  sexo: UserProfile["sexo"]; actividad: UserProfile["actividad"]; objetivo: UserProfile["objetivo"];
  colors: any;
}) {
  const p = Number(peso);
  const h = Number(altura);
  const e = Number(edad);
  const valido = p >= 30 && p <= 300 && h >= 100 && h <= 250 && e >= 10 && e <= 100;
  if (!valido) return null;

  const goals = calcularObjetivos({ nombre: "", peso: p, altura: h, edad: e, sexo, actividad, objetivo });

  return (
    <View style={{ backgroundColor: "#1F6FEB11", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#1F6FEB33", gap: 10 }}>
      <Text style={{ color: "#58A6FF", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
        ✨ Tu objetivo diario estimado
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[
          { val: String(goals.calories), label: "kcal", color: "#4ADE80" },
          { val: goals.protein + "g", label: "Prot", color: "#60A5FA" },
          { val: goals.carbs + "g", label: "Carbos", color: "#FBBF24" },
          { val: goals.fat + "g", label: "Grasas", color: "#F87171" },
        ].map((item) => (
          <View key={item.label} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder }}>
            <Text style={{ color: item.color, fontSize: 15, fontWeight: "800" }}>{item.val}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>{item.label}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: "center" }}>
        Basado en tu perfil · Puedes ajustarlo después en Ajustes
      </Text>
    </View>
  );
}

export default function OnboardingScreen() {
  const { colors, theme } = useApp();
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("bienvenida");
  const [nombre, setNombre] = useState("");
  const [sexo, setSexo] = useState<UserProfile["sexo"]>("hombre");
  const [peso, setPeso] = useState("");
  const [altura, setAltura] = useState("");
  const [edad, setEdad] = useState("");
  const [actividad, setActividad] = useState<UserProfile["actividad"]>("moderado");
  const [objetivo, setObjetivo] = useState<UserProfile["objetivo"]>("mantener");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const pasoIdx = PASOS.indexOf(paso);
  const progreso = pasoIdx / (PASOS.length - 1);

  const siguiente = () => {
    setError("");
    if (paso === "nombre" && !nombre.trim()) { setError("Introduce tu nombre"); return; }
    if (paso === "medidas") {
      if (!peso || Number(peso) < 30 || Number(peso) > 300) { setError("Introduce un peso válido (30-300 kg)"); return; }
      if (!altura || Number(altura) < 100 || Number(altura) > 250) { setError("Introduce una altura válida (100-250 cm)"); return; }
      if (!edad || Number(edad) < 10 || Number(edad) > 100) { setError("Introduce una edad válida"); return; }
    }
    const idx = PASOS.indexOf(paso);
    if (idx < PASOS.length - 1) setPaso(PASOS[idx + 1]);
  };

  const atras = () => {
    const idx = PASOS.indexOf(paso);
    if (idx > 0) setPaso(PASOS[idx - 1]);
  };

  const finalizar = async () => {
    if (guardando) return;
    setError("");
    setGuardando(true);

    try {
      // Obtener sesión — reintentamos hasta 3 veces por si el lock tarda
      let session = null;
      for (let i = 0; i < 3; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) { session = data.session; break; }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (!session) {
        setError("Sesión expirada. Vuelve a iniciar sesión.");
        setGuardando(false);
        return;
      }

      const profile: UserProfile = {
        nombre: nombre.trim(),
        peso: Number(peso),
        altura: Number(altura),
        edad: Number(edad),
        sexo, actividad, objetivo,
      };

      const goals = calcularObjetivos(profile);

      // Guardar perfil con reintento ante errores de lock
      let guardado = false;
      let ultimoError = "";
      for (let i = 0; i < 3; i++) {
        const { error: err } = await supabase.from("perfiles").upsert({
          id: session.user.id,
          ...profile,
          calorias_objetivo: goals.calories,
          proteina_objetivo: goals.protein,
          carbos_objetivo: goals.carbs,
          grasa_objetivo: goals.fat,
        });
        if (!err) { guardado = true; break; }
        ultimoError = err.message;
        // Si es error de lock, esperar un poco y reintentar
        if (err.message?.includes("Lock") || err.message?.includes("lock")) {
          await new Promise((r) => setTimeout(r, 800));
        } else {
          break; // Otro tipo de error, no reintentar
        }
      }

      if (!guardado) {
        setError("Error al guardar el perfil: " + ultimoError);
        setGuardando(false);
        return;
      }

      const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
      await AsyncStorage.setItem("nutri_daily_goals", JSON.stringify(goals));

      router.replace("/");
    } catch (e: any) {
      setError("Error: " + e.message);
    }
    setGuardando(false);
  };

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>

        {paso !== "bienvenida" && (
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${progreso * 100}%` as any }]} />
          </View>
        )}

        <View style={s.container}>

          {paso === "bienvenida" && (
            <View style={s.stepWrap}>
              <Text style={s.bigEmoji}>👋</Text>
              <Text style={s.stepTitle}>¡Bienvenido!</Text>
              <Text style={s.stepDesc}>Vamos a configurar tu perfil para calcular tus objetivos nutricionales personalizados.</Text>
              <TouchableOpacity style={s.btn} onPress={siguiente}>
                <Text style={s.btnText}>Empezar →</Text>
              </TouchableOpacity>
            </View>
          )}

          {paso === "nombre" && (
            <View style={s.stepWrap}>
              <Text style={s.bigEmoji}>😊</Text>
              <Text style={s.stepTitle}>¿Cómo te llamas?</Text>
              <Text style={s.stepDesc}>Tu nombre aparecerá en la comunidad y en tus publicaciones.</Text>
              <View style={s.fieldsCol}>
                <TextInput
                  style={[s.fieldInput, { width: "100%", textAlign: "center", fontSize: 22, paddingVertical: 16 }]}
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder="Tu nombre"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  autoFocus
                  maxLength={30}
                />
              </View>
              {error ? <View style={s.errorBox}><Text style={s.errorText}>⚠️ {error}</Text></View> : null}
              <View style={s.navRow}>
                <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>← Atrás</Text></TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>Siguiente →</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {paso === "sexo" && (
            <View style={s.stepWrap}>
              <Text style={s.stepTitle}>¿Cuál es tu sexo?</Text>
              <Text style={s.stepDesc}>Lo usamos para calcular tu metabolismo basal.</Text>
              <View style={s.optionsCol}>
                {(["hombre", "mujer"] as const).map((sx) => (
                  <TouchableOpacity key={sx} style={[s.optionCard, sexo === sx && s.optionCardActive]} onPress={() => setSexo(sx)} activeOpacity={0.7}>
                    <Text style={s.optionEmoji}>{sx === "hombre" ? "♂️" : "♀️"}</Text>
                    <Text style={[s.optionText, sexo === sx && s.optionTextActive]}>{sx === "hombre" ? "Hombre" : "Mujer"}</Text>
                    {sexo === sx && <Text style={s.optionCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.navRow}>
                <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>← Atrás</Text></TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>Siguiente →</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {paso === "medidas" && (
            <View style={s.stepWrap}>
              <Text style={s.stepTitle}>Tus medidas</Text>
              <Text style={s.stepDesc}>Necesitamos estos datos para calcular tus calorías.</Text>
              <View style={s.fieldsCol}>
                {[
                  { label: "Peso", unit: "kg", val: peso, set: setPeso, placeholder: "70" },
                  { label: "Altura", unit: "cm", val: altura, set: setAltura, placeholder: "175" },
                  { label: "Edad", unit: "años", val: edad, set: setEdad, placeholder: "25" },
                ].map((f) => (
                  <View key={f.label} style={s.fieldRow}>
                    <Text style={s.fieldLabel}>{f.label}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <TextInput style={s.fieldInput} value={f.val} onChangeText={f.set} placeholder={f.placeholder} placeholderTextColor={colors.textMuted} keyboardType="numeric" selectTextOnFocus />
                      <Text style={{ color: colors.textMuted, fontSize: 13 }}>{f.unit}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <MacrosPreview peso={peso} altura={altura} edad={edad} sexo={sexo} actividad={actividad} objetivo={objetivo} colors={colors} />
              {error ? <View style={s.errorBox}><Text style={s.errorText}>⚠️ {error}</Text></View> : null}
              <View style={s.navRow}>
                <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>← Atrás</Text></TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>Siguiente →</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {paso === "actividad" && (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={s.stepWrap}>
                <Text style={s.stepTitle}>Nivel de actividad</Text>
                <Text style={s.stepDesc}>¿Cuánto ejercicio haces a la semana?</Text>
                <View style={s.optionsCol}>
                  {(Object.keys(ACTIVIDAD_LABELS) as UserProfile["actividad"][]).map((a) => (
                    <TouchableOpacity key={a} style={[s.optionCard, actividad === a && s.optionCardActive]} onPress={() => setActividad(a)} activeOpacity={0.7}>
                      <Text style={s.optionEmoji}>{ACTIVIDAD_ICONS[a]}</Text>
                      <Text style={[s.optionText, actividad === a && s.optionTextActive]}>{ACTIVIDAD_LABELS[a]}</Text>
                      {actividad === a && <Text style={s.optionCheck}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
                <MacrosPreview peso={peso} altura={altura} edad={edad} sexo={sexo} actividad={actividad} objetivo={objetivo} colors={colors} />
                <View style={s.navRow}>
                  <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>← Atrás</Text></TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>Siguiente →</Text></TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}

          {paso === "objetivo" && (
            <View style={s.stepWrap}>
              <Text style={s.stepTitle}>Tu objetivo</Text>
              <Text style={s.stepDesc}>¿Qué quieres conseguir?</Text>
              <View style={s.optionsCol}>
                {(Object.keys(OBJETIVO_LABELS) as UserProfile["objetivo"][]).map((o) => (
                  <TouchableOpacity key={o} style={[s.optionCard, objetivo === o && s.optionCardActive]} onPress={() => setObjetivo(o)} activeOpacity={0.7}>
                    <Text style={s.optionEmoji}>{OBJETIVO_ICONS[o]}</Text>
                    <Text style={[s.optionText, objetivo === o && s.optionTextActive]}>{OBJETIVO_LABELS[o]}</Text>
                    {objetivo === o && <Text style={s.optionCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
              <MacrosPreview peso={peso} altura={altura} edad={edad} sexo={sexo} actividad={actividad} objetivo={objetivo} colors={colors} />
              {error ? <View style={s.errorBox}><Text style={s.errorText}>⚠️ {error}</Text></View> : null}
              <View style={s.navRow}>
                <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>← Atrás</Text></TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, guardando && { opacity: 0.7 }]}
                  onPress={finalizar}
                  disabled={guardando}
                >
                  <Text style={s.btnText}>{guardando ? "Guardando..." : "¡Listo! ✓"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    progressBar: { height: 4, backgroundColor: colors.cardBorder },
    progressFill: { height: 4, backgroundColor: "#1F6FEB", borderRadius: 2 },
    container: { flex: 1, paddingHorizontal: 24 },
    stepWrap: { flex: 1, paddingTop: 40, gap: 20 },
    bigEmoji: { fontSize: 72, textAlign: "center" },
    stepTitle: { color: colors.text, fontSize: 28, fontWeight: "900", textAlign: "center" },
    stepDesc: { color: colors.textSub, fontSize: 15, textAlign: "center", lineHeight: 22 },
    optionsCol: { gap: 10, flex: 1 },
    optionCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: colors.cardBorder },
    optionCardActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
    optionEmoji: { fontSize: 24 },
    optionText: { flex: 1, color: colors.textSub, fontSize: 15, fontWeight: "600" },
    optionTextActive: { color: "#58A6FF", fontWeight: "700" },
    optionCheck: { color: "#58A6FF", fontSize: 18, fontWeight: "800" },
    fieldsCol: { gap: 12 },
    fieldRow: { backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.cardBorder, flexDirection: "row", alignItems: "center" },
    fieldLabel: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
    fieldInput: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, padding: 10, color: colors.text, fontSize: 20, fontWeight: "800", width: 80, textAlign: "center" },
    navRow: { flexDirection: "row", gap: 12, paddingBottom: 24 },
    btn: { flex: 1, backgroundColor: "#1F6FEB", borderRadius: 14, padding: 18, alignItems: "center" },
    btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
    btnSecondary: { backgroundColor: colors.card, borderRadius: 14, padding: 18, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 20 },
    btnSecondaryText: { color: colors.textSub, fontSize: 15, fontWeight: "600" },
    errorBox: { backgroundColor: "#EF444422", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#EF444455" },
    errorText: { color: "#EF4444", fontSize: 13 },
  });
}