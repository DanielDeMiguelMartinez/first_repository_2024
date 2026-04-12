import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
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
import { Language, LANGUAGE_FLAGS, LANGUAGE_NAMES, TRANSLATIONS, useApp } from "./services/i18n";
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

const ACTIVIDAD_ICONS: Record<UserProfile["actividad"], string> = {
  sedentario: "🪑", ligero: "🚶", moderado: "🏃", activo: "💪", muy_activo: "🔥",
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

const PASOS = ["bienvenida", "nombre", "sexo", "medidas", "actividad", "objetivo", "alergias", "comidas"] as const;
type Paso = typeof PASOS[number];

const ALERGENOS = [
  { id: "gluten",       emoji: "🌾", label: "Gluten",       keywords: ["trigo","harina","pan","pasta","galleta","cereal","avena","centeno","cebada","espelta"] },
  { id: "lacteos",      emoji: "🥛", label: "Lácteos",      keywords: ["leche","queso","yogur","mantequilla","nata","lactosa","suero","whey","caseína"] },
  { id: "huevo",        emoji: "🥚", label: "Huevo",        keywords: ["huevo","mayonesa","tortilla"] },
  { id: "pescado",      emoji: "🐟", label: "Pescado",      keywords: ["pescado","salmón","atún","bacalao","merluza","sardina","anchoa","lubina","dorada","trucha"] },
  { id: "mariscos",     emoji: "🦐", label: "Mariscos",     keywords: ["marisco","gamba","langostino","mejillón","almeja","calamar","pulpo","cangrejo"] },
  { id: "frutos_secos", emoji: "🌰", label: "Frutos secos", keywords: ["almendra","nuez","avellana","pistacho","anacardo","cacahuete","nuez de","macadamia"] },
  { id: "soja",         emoji: "🌱", label: "Soja",         keywords: ["soja","tofu","edamame","miso","tempeh"] },
  { id: "sesamo",       emoji: "🌿", label: "Sésamo",       keywords: ["sésamo","tahini","tahín"] },
] as const;
type AlergenaId = typeof ALERGENOS[number]["id"];
export const ALERGENOS_KEYWORDS: Record<string, string[]> = Object.fromEntries(ALERGENOS.map(a => [a.id, [...a.keywords]]));

// ── Preview de macros en tiempo real ─────────────────────────────────────────
function MacrosPreview({ peso, altura, edad, sexo, actividad, objetivo, colors, t }: {
  peso: string; altura: string; edad: string;
  sexo: UserProfile["sexo"]; actividad: UserProfile["actividad"]; objetivo: UserProfile["objetivo"];
  colors: any; t: any;
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
        ✨ {t.estimatedDailyGoal}
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
        {t.basedOnProfile}
      </Text>
    </View>
  );
}

const ALL_LANGUAGES_ON = Object.keys(TRANSLATIONS) as Language[];

export default function OnboardingScreen() {
  const { colors, theme, t, language, setLanguage } = useApp();
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("bienvenida");
  const [showLangModal, setShowLangModal] = useState(false);
  const [nombre, setNombre] = useState("");
  const [sexo, setSexo] = useState<UserProfile["sexo"]>("hombre");
  const [peso, setPeso] = useState("");
  const [altura, setAltura] = useState("");
  const [edad, setEdad] = useState("");
  const [actividad, setActividad] = useState<UserProfile["actividad"]>("moderado");
  const [objetivo, setObjetivo] = useState<UserProfile["objetivo"]>("mantener");
  const [alergias, setAlergias] = useState<AlergenaId[]>([]);
  const [mealCount, setMealCount] = useState(4);
  const [selectedMeals, setSelectedMeals] = useState(["desayuno", "comida", "merienda", "cena"]);
  const ALL_MEAL_OPTIONS = [
    { key: "desayuno", icon: "🌅" }, { key: "snack1", icon: "🥜" },
    { key: "comida", icon: "☀️" }, { key: "merienda", icon: "🍎" },
    { key: "cena", icon: "🌙" }, { key: "snack2", icon: "🥛" },
  ];
  const MEAL_LABEL_MAP: Record<string, string> = {
    desayuno: t.breakfast, snack1: t.snack1Label, comida: t.lunch,
    merienda: t.snack, cena: t.dinner, snack2: t.snack2Label,
  };
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const pasoIdx = PASOS.indexOf(paso);
  const progreso = pasoIdx / (PASOS.length - 1);

  const siguiente = () => {
    setError("");
    if (paso === "nombre" && !nombre.trim()) { setError(t.enterName); return; }
    if (paso === "medidas") {
      if (!peso || Number(peso) < 30 || Number(peso) > 300) { setError(t.invalidWeight); return; }
      if (!altura || Number(altura) < 100 || Number(altura) > 250) { setError(t.invalidHeight); return; }
      if (!edad || Number(edad) < 10 || Number(edad) > 100) { setError(t.invalidAge); return; }
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
        setError(t.sessionExpiredMsg);
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
        setError(t.errorSavingProfile.replace("{error}", ultimoError));
        setGuardando(false);
        return;
      }

      const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
      await AsyncStorage.setItem("nutri_daily_goals", JSON.stringify(goals));
      await AsyncStorage.setItem("nutri_alergias", JSON.stringify(alergias));
      await AsyncStorage.setItem("nutri_meal_frequency", selectedMeals.join(","));

      router.replace("/");
    } catch (e: any) {
      setError(t.error + ": " + e.message);
    }
    setGuardando(false);
  };

  const ACTIVIDAD_LABELS: Record<UserProfile["actividad"], string> = {
    sedentario: t.sedentary,
    ligero: `${t.light} (${t.days12})`,
    moderado: `${t.moderate} (${t.days35})`,
    activo: `${t.active} (${t.days67})`,
    muy_activo: `${t.veryActive} (${t.twiceDay})`,
  };

  const OBJETIVO_LABELS: Record<UserProfile["objetivo"], string> = {
    perder: t.loseFat, mantener: t.maintain, ganar: t.gainMuscle,
  };

  const ALERGENO_LABELS: Record<string, string> = {
    lacteos: t.allergenDairy, huevo: t.allergenEgg, pescado: t.allergenFish,
    mariscos: t.allergenShellfish, cacahuetes: t.allergenPeanuts, frutos_secos: t.allergenTreeNuts,
    gluten: t.allergenGluten, soja: t.allergenSoy, sesamo: t.allergenSesame,
    mostaza: t.allergenMustard, moluscos: t.allergenMolluscs, apio: t.allergenCelery,
    sulfitos: t.allergenSulphites, altramuz: t.allergenLupin,
  };

  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />

      {/* Selector de idioma — esquina superior izquierda */}
      <TouchableOpacity
        onPress={() => setShowLangModal(true)}
        style={{ position: "absolute", top: 16, left: 16, zIndex: 20,
          flexDirection: "row", alignItems: "center", gap: 6,
          backgroundColor: colors.card, borderRadius: 22,
          paddingHorizontal: 12, paddingVertical: 8,
          borderWidth: 1, borderColor: colors.cardBorder }}>
        <Text style={{ fontSize: 18 }}>{LANGUAGE_FLAGS[language]}</Text>
        <Text style={{ color: colors.textSub, fontSize: 12, fontWeight: "700" }}>{LANGUAGE_NAMES[language]}</Text>
      </TouchableOpacity>

      <Modal visible={showLangModal} transparent animationType="slide" onRequestClose={() => setShowLangModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "#00000099" }} activeOpacity={1} onPress={() => setShowLangModal(false)} />
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "70%", paddingBottom: 32 }}>
          <View style={{ alignItems: "center", paddingVertical: 14 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.cardBorder }} />
          </View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center", marginBottom: 8 }}>
            🌐 Language / Idioma
          </Text>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {ALL_LANGUAGES_ON.map(lang => (
              <TouchableOpacity
                key={lang}
                style={{ flexDirection: "row", alignItems: "center", gap: 14,
                  paddingHorizontal: 22, paddingVertical: 13,
                  backgroundColor: language === lang ? "#1F6FEB18" : "transparent" }}
                onPress={() => { setLanguage(lang); setShowLangModal(false); }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 26 }}>{LANGUAGE_FLAGS[lang]}</Text>
                <Text style={{ flex: 1, color: colors.text, fontSize: 15,
                  fontWeight: language === lang ? "800" : "500" }}>
                  {LANGUAGE_NAMES[lang]}
                </Text>
                {language === lang && <Text style={{ color: "#1F6FEB", fontSize: 18, fontWeight: "900" }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

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
              <Text style={s.stepTitle}>{t.welcome}</Text>
              <Text style={s.stepDesc}>{t.setupProfile}</Text>
              <TouchableOpacity style={s.btn} onPress={siguiente}>
                <Text style={s.btnText}>{t.getStarted}</Text>
              </TouchableOpacity>
            </View>
          )}

          {paso === "nombre" && (
            <View style={s.stepWrap}>
              <Text style={s.bigEmoji}>😊</Text>
              <Text style={s.stepTitle}>{t.whatsYourName}</Text>
              <Text style={s.stepDesc}>{t.nameWillAppear}</Text>
              <View style={s.fieldsCol}>
                <TextInput
                  style={[s.fieldInput, { width: "100%", textAlign: "center", fontSize: 22, paddingVertical: 16 }]}
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder={t.yourNamePlaceholder}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  autoFocus
                  maxLength={30}
                />
              </View>
              {error ? <View style={s.errorBox}><Text style={s.errorText}>⚠️ {error}</Text></View> : null}
              <View style={s.navRow}>
                <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>{t.back}</Text></TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>{t.next}</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {paso === "sexo" && (
            <View style={s.stepWrap}>
              <Text style={s.stepTitle}>{t.sex}</Text>
              <Text style={s.stepDesc}>{t.usedForMetabolism}</Text>
              <View style={s.optionsCol}>
                {(["hombre", "mujer"] as const).map((sx) => (
                  <TouchableOpacity key={sx} style={[s.optionCard, sexo === sx && s.optionCardActive]} onPress={() => setSexo(sx)} activeOpacity={0.7}>
                    <Text style={s.optionEmoji}>{sx === "hombre" ? "♂️" : "♀️"}</Text>
                    <Text style={[s.optionText, sexo === sx && s.optionTextActive]}>{sx === "hombre" ? t.male : t.female}</Text>
                    {sexo === sx && <Text style={s.optionCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.navRow}>
                <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>{t.back}</Text></TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>{t.next}</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {paso === "medidas" && (
            <View style={s.stepWrap}>
              <Text style={s.stepTitle}>{t.yourMeasurements}</Text>
              <Text style={s.stepDesc}>{t.dataForCalories}</Text>
              <View style={s.fieldsCol}>
                {[
                  { label: t.weight, unit: "kg", val: peso, set: setPeso, placeholder: "70" },
                  { label: t.height, unit: "cm", val: altura, set: setAltura, placeholder: "175" },
                  { label: t.age, unit: "", val: edad, set: setEdad, placeholder: "25" },
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
              <MacrosPreview peso={peso} altura={altura} edad={edad} sexo={sexo} actividad={actividad} objetivo={objetivo} colors={colors} t={t} />
              {error ? <View style={s.errorBox}><Text style={s.errorText}>⚠️ {error}</Text></View> : null}
              <View style={s.navRow}>
                <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>{t.back}</Text></TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>{t.next}</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {paso === "actividad" && (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={s.stepWrap}>
                <Text style={s.stepTitle}>{t.activityLevel}</Text>
                <Text style={s.stepDesc}>{t.howMuchExercise}</Text>
                <View style={s.optionsCol}>
                  {(Object.keys(ACTIVIDAD_LABELS) as UserProfile["actividad"][]).map((a) => (
                    <TouchableOpacity key={a} style={[s.optionCard, actividad === a && s.optionCardActive]} onPress={() => setActividad(a)} activeOpacity={0.7}>
                      <Text style={s.optionEmoji}>{ACTIVIDAD_ICONS[a]}</Text>
                      <Text style={[s.optionText, actividad === a && s.optionTextActive]}>{ACTIVIDAD_LABELS[a]}</Text>
                      {actividad === a && <Text style={s.optionCheck}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
                <MacrosPreview peso={peso} altura={altura} edad={edad} sexo={sexo} actividad={actividad} objetivo={objetivo} colors={colors} t={t} />
                <View style={s.navRow}>
                  <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>{t.back}</Text></TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>{t.next}</Text></TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}

          {paso === "objetivo" && (
            <View style={s.stepWrap}>
              <Text style={s.stepTitle}>{t.yourGoal}</Text>
              <Text style={s.stepDesc}>{t.whatDoYouWant}</Text>
              <View style={s.optionsCol}>
                {(Object.keys(OBJETIVO_LABELS) as UserProfile["objetivo"][]).map((o) => (
                  <TouchableOpacity key={o} style={[s.optionCard, objetivo === o && s.optionCardActive]} onPress={() => setObjetivo(o)} activeOpacity={0.7}>
                    <Text style={s.optionEmoji}>{OBJETIVO_ICONS[o]}</Text>
                    <Text style={[s.optionText, objetivo === o && s.optionTextActive]}>{OBJETIVO_LABELS[o]}</Text>
                    {objetivo === o && <Text style={s.optionCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
              <MacrosPreview peso={peso} altura={altura} edad={edad} sexo={sexo} actividad={actividad} objetivo={objetivo} colors={colors} t={t} />
              <View style={s.navRow}>
                <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>{t.back}</Text></TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={siguiente}><Text style={s.btnText}>{t.next}</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {paso === "alergias" && (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={s.stepWrap}>
                <Text style={s.bigEmoji}>⚠️</Text>
                <Text style={s.stepTitle}>{t.allergiesIntolerances}</Text>
                <Text style={s.stepDesc}>{t.selectAllergensDesc}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {ALERGENOS.map((a) => {
                    const sel = alergias.includes(a.id as AlergenaId);
                    return (
                      <TouchableOpacity
                        key={a.id}
                        onPress={() => setAlergias((prev) =>
                          sel ? prev.filter((x) => x !== a.id) : [...prev, a.id as AlergenaId]
                        )}
                        style={{
                          flexDirection: "row", alignItems: "center", gap: 6,
                          paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
                          borderWidth: 1.5,
                          backgroundColor: sel ? "#EF444422" : colors.card,
                          borderColor: sel ? "#EF4444" : colors.cardBorder,
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 18 }}>{a.emoji}</Text>
                        <Text style={{ color: sel ? "#EF4444" : colors.textSub, fontSize: 14, fontWeight: sel ? "700" : "500" }}>{ALERGENO_LABELS[a.id] ?? a.label}</Text>
                        {sel && <Text style={{ color: "#EF4444", fontWeight: "800" }}>✕</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {alergias.length === 0 && (
                  <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>
                    {t.noAllergensHint}
                  </Text>
                )}
                {error ? <View style={s.errorBox}><Text style={s.errorText}>⚠️ {error}</Text></View> : null}
                <View style={s.navRow}>
                  <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>{t.back}</Text></TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={siguiente}>
                    <Text style={s.btnText}>{t.next} →</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}

          {/* ── Paso: comidas al día ── */}
          {paso === "comidas" && (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={s.stepWrap}>
                <Text style={s.bigEmoji}>🍽</Text>
                <Text style={s.stepTitle}>{t.mealFrequency}</Text>
                <Text style={s.stepDesc}>{t.mealFrequencyDesc}</Text>

                <View style={s.optionsCol}>
                  {ALL_MEAL_OPTIONS.map(m => {
                    const sel = selectedMeals.includes(m.key);
                    return (
                      <TouchableOpacity key={m.key}
                        style={[s.optionCard, sel && s.optionCardActive]}
                        onPress={() => {
                          const order = ALL_MEAL_OPTIONS.map(x => x.key);
                          let next: string[];
                          if (sel) {
                            if (selectedMeals.length <= 2) return;
                            next = selectedMeals.filter(k => k !== m.key);
                          } else {
                            if (selectedMeals.length >= 6) return;
                            next = [...selectedMeals, m.key];
                          }
                          next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
                          setSelectedMeals(next);
                          setMealCount(next.length);
                        }}
                        activeOpacity={0.7}>
                        <Text style={s.optionEmoji}>{m.icon}</Text>
                        <Text style={[s.optionText, sel && s.optionTextActive, { flex: 1 }]}>{MEAL_LABEL_MAP[m.key]}</Text>
                        <View style={{
                          width: 26, height: 26, borderRadius: 13,
                          backgroundColor: sel ? "#1F6FEB" : "transparent",
                          borderWidth: sel ? 0 : 2, borderColor: colors.cardBorder,
                          alignItems: "center", justifyContent: "center",
                        }}>
                          {sel && <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>✓</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: "center" }}>
                  {selectedMeals.length} {t.mealFrequency.toLowerCase()}
                </Text>

                {error ? <View style={s.errorBox}><Text style={s.errorText}>⚠️ {error}</Text></View> : null}
                <View style={s.navRow}>
                  <TouchableOpacity style={s.btnSecondary} onPress={atras}><Text style={s.btnSecondaryText}>{t.back}</Text></TouchableOpacity>
                  <TouchableOpacity
                    style={[s.btn, (guardando || selectedMeals.length < 2) && { opacity: 0.7 }]}
                    onPress={finalizar}
                    disabled={guardando || selectedMeals.length < 2}
                  >
                    <Text style={s.btnText}>{guardando ? t.loading : `${t.save} ✓`}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
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