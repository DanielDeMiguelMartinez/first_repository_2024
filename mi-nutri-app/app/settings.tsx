import AsyncStorage from "@react-native-async-storage/async-storage";
import { BottomTabBar, TAB_BAR_HEIGHT } from "@/app/services/BottomTabBar";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
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
import { calcularObjetivos, UserProfile } from "./onboarding";
import { Language, LANGUAGE_FLAGS, LANGUAGE_NAMES, LANGUAGE_NAMES_EN, Theme, TRANSLATIONS, useApp } from "./services/i18n";
import { supabase } from "./services/supabase";
import { kgToDisplay, loadWeightUnit, saveWeightUnit, WeightUnit } from "./services/units";

const GOALS_KEY  = "nutri_daily_goals";


export default function SettingsScreen() {
  const router = useRouter();
  const { t, language, theme, setLanguage, setTheme, colors } = useApp();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editNombre, setEditNombre] = useState("");
  const [editPeso, setEditPeso] = useState("");
  const [editAltura, setEditAltura] = useState("");
  const [editEdad, setEditEdad] = useState("");
  const [editSexo, setEditSexo] = useState<UserProfile["sexo"]>("hombre");
  const [editActividad, setEditActividad] = useState<UserProfile["actividad"]>("moderado");
  const [editObjetivo, setEditObjetivo] = useState<UserProfile["objetivo"]>("mantener");
  const [errorEdit, setErrorEdit] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmarLogout, setConfirmarLogout] = useState(false);
  const [confirmarCerrarCuenta, setConfirmarCerrarCuenta] = useState(false);
  const [cerrandoCuenta, setCerrandoCuenta] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [langSearch, setLangSearch] = useState("");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg");
  const [mealCount, setMealCount] = useState(4);
  const [selectedMeals, setSelectedMeals] = useState<string[]>(["desayuno", "comida", "merienda", "cena"]);

  const s = useMemo(() => makeStyles(colors), [colors]);

  const ACTIVIDAD_LABELS: Record<UserProfile["actividad"], string> = {
    sedentario: `${t.sedentary} 🪑`, ligero: `${t.light} 🚶`, moderado: `${t.moderate} 🏃`,
    activo: `${t.active} 💪`, muy_activo: `${t.veryActive} 🔥`,
  };

  const OBJETIVO_LABELS: Record<UserProfile["objetivo"], string> = {
    perder: t.loseFat, mantener: t.maintain, ganar: t.gainMuscle,
  };

  useEffect(() => {
    // Escuchar el estado de auth — funciona tanto en web como en móvil
    // porque espera a que Supabase restaure la sesión antes de llamar
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUserEmail(session.user.email || "");
          setUserId(session.user.id);
          const { data } = await supabase
            .from("perfiles")
            .select("*")
            .eq("id", session.user.id)
            .single();
          if (data) setProfile(data as UserProfile);
        }
      }
    );

    // También intentar cargar inmediatamente por si la sesión ya está lista
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUserEmail(session.user.email || "");
        setUserId(session.user.id);
        const { data } = await supabase
          .from("perfiles")
          .select("*")
          .eq("id", session.user.id)
          .single();
        if (data) setProfile(data as UserProfile);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { loadWeightUnit().then(setWeightUnit); }, []);
  useEffect(() => {
    AsyncStorage.getItem("nutri_meal_frequency").then(v => {
      if (!v) return;
      if (v.includes(",")) {
        // New format: "desayuno,comida,cena"
        const list = v.split(",");
        setMealCount(list.length);
        setSelectedMeals(list);
      } else {
        // Legacy format: "2","3","4","5","6"
        const LEGACY: Record<string, string[]> = {
          "2": ["comida","cena"], "3": ["desayuno","comida","cena"],
          "4": ["desayuno","comida","merienda","cena"],
          "5": ["desayuno","snack1","comida","merienda","cena"],
          "6": ["desayuno","snack1","comida","merienda","cena","snack2"],
        };
        const list = LEGACY[v] ?? LEGACY["4"];
        setMealCount(list.length);
        setSelectedMeals(list);
      }
    });
  }, []);

  const handleWeightUnitChange = async (unit: WeightUnit) => {
    setWeightUnit(unit);
    await saveWeightUnit(unit);
  };

  const ALL_MEALS = [
    { key: "desayuno", icon: "🌅", label: t.breakfast },
    { key: "snack1",   icon: "🥜", label: t.snack1Label },
    { key: "comida",   icon: "☀️", label: t.lunch },
    { key: "merienda", icon: "🍎", label: t.snack },
    { key: "cena",     icon: "🌙", label: t.dinner },
    { key: "snack2",   icon: "🥛", label: t.snack2Label },
  ];
  const MEAL_ORDER = ALL_MEALS.map(m => m.key);

  const toggleMeal = async (key: string) => {
    let next: string[];
    if (selectedMeals.includes(key)) {
      if (selectedMeals.length <= 2) return;
      next = selectedMeals.filter(m => m !== key);
    } else {
      if (selectedMeals.length >= 6) return;
      next = [...selectedMeals, key];
    }
    next.sort((a, b) => MEAL_ORDER.indexOf(a) - MEAL_ORDER.indexOf(b));
    setSelectedMeals(next);
    setMealCount(next.length);
    await AsyncStorage.setItem("nutri_meal_frequency", next.join(","));
  };

  const openEditProfile = () => {
    if (!profile) return;
    setEditNombre(profile.nombre || "");
    setEditPeso(String(profile.peso));
    setEditAltura(String(profile.altura));
    setEditEdad(String(profile.edad));
    setEditSexo(profile.sexo);
    setEditActividad(profile.actividad);
    setEditObjetivo(profile.objetivo);
    setErrorEdit("");
    setShowEditProfile(true);
  };

  const guardarPerfil = async () => {
    setErrorEdit("");
    if (!editNombre.trim()) { setErrorEdit(t.enterName); return; }
    if (!editPeso || Number(editPeso) < 30 || Number(editPeso) > 300) { setErrorEdit(t.invalidWeight); return; }
    if (!editAltura || Number(editAltura) < 100 || Number(editAltura) > 250) { setErrorEdit(t.invalidHeight); return; }
    if (!editEdad || Number(editEdad) < 10 || Number(editEdad) > 100) { setErrorEdit(t.invalidAge); return; }

    if (!userId) { setErrorEdit(t.sessionUnavailable); return; }

    setGuardando(true);
    try {
      const newProfile: UserProfile = {
        nombre: editNombre.trim(),
        peso: Number(editPeso),
        altura: Number(editAltura),
        edad: Number(editEdad),
        sexo: editSexo,
        actividad: editActividad,
        objetivo: editObjetivo,
      };

      const goals = calcularObjetivos(newProfile);

      const { error } = await supabase.from("perfiles").upsert({
        id: userId,
        ...newProfile,
        calorias_objetivo: goals.calories,
        proteina_objetivo: goals.protein,
        carbos_objetivo: goals.carbs,
        grasa_objetivo: goals.fat,
      }, { onConflict: "id" });

      if (error) { setErrorEdit(t.error + ": " + error.message); setGuardando(false); return; }

      await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(goals));
      setProfile(newProfile);
      setShowEditProfile(false);

      Alert.alert(
        t.profileUpdated,
        `🔥 ${goals.calories} kcal\n💪 ${goals.protein}g ${t.proteins}\n🌾 ${goals.carbs}g ${t.carbs}\n🥑 ${goals.fat}g ${t.fats}`,
        [{ text: t.understood }]
      );
    } catch (e: any) { setErrorEdit(t.error + ": " + e.message); }
    setGuardando(false);
  };

  const handleCerrarCuenta = async () => {
    if (!userId) return;
    setCerrandoCuenta(true);
    try {
      // Borrar datos del usuario
      await Promise.all([
        supabase.from("seguidos").delete().eq("follower_id", userId),
        supabase.from("seguidos").delete().eq("followed_id", userId),
        supabase.from("videos_recetas").delete().eq("autor_id", userId),
      ]);
      await supabase.from("perfiles").delete().eq("id", userId);
      // Eliminar la cuenta de autenticación (requiere función SQL delete_current_user)
      await supabase.rpc("delete_current_user");
    } catch {}
    await AsyncStorage.clear();
    await supabase.auth.signOut();
    router.replace("/auth");
  };

  const handleLogout = () => setConfirmarLogout(true);

  const confirmarLogoutAccion = async () => {
    setConfirmarLogout(false);
    await supabase.auth.signOut();
    router.replace("/auth");
  };

  const languages: Language[] = Object.keys(TRANSLATIONS) as Language[];
  const themes: { val: Theme; label: string; icon: string }[] = [
    { val: "dark", label: t.darkTheme, icon: "🌙" },
    { val: "light", label: t.lightTheme, icon: "☀️" },
  ];

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />

      <Modal visible={showEditProfile} transparent animationType="slide" onRequestClose={() => setShowEditProfile(false)}>
        <View style={{ flex: 1, backgroundColor: "#000000CC", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "95%", borderWidth: 1, borderColor: colors.cardBorder }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>{t.editProfile}</Text>
              <TouchableOpacity onPress={() => setShowEditProfile(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.textSub, fontSize: 14 }}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: "#1F6FEB11", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#1F6FEB33" }}>
              <Text style={{ color: "#58A6FF", fontSize: 13 }}>{t.editProfileHint}</Text>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={{ padding: 16, gap: 14 }}>
                <Text style={s.editLabel}>{t.whatsYourName}</Text>
                <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder }}>
                  <TextInput style={{ color: colors.text, fontSize: 16, fontWeight: "600" }} value={editNombre} onChangeText={setEditNombre} placeholder={t.yourNamePlaceholder} placeholderTextColor={colors.textMuted} autoCapitalize="words" maxLength={30} />
                </View>

                <Text style={s.editLabel}>{t.sex}</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["hombre", "mujer"] as const).map((sx) => (
                    <TouchableOpacity key={sx} style={[s.editChip, editSexo === sx && s.editChipActive]} onPress={() => setEditSexo(sx)}>
                      <Text style={[s.editChipText, editSexo === sx && s.editChipTextActive]}>{sx === "hombre" ? t.male : t.female}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.editLabel}>{t.measurements}</Text>
                {[
                  { key: "peso", label: t.weight, val: editPeso, set: setEditPeso },
                  { key: "altura", label: t.height, val: editAltura, set: setEditAltura },
                  { key: "edad", label: t.age, val: editEdad, set: setEditEdad },
                ].map((f) => (
                  <View key={f.key} style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder }}>
                    <Text style={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: "600" }}>{f.label}</Text>
                    <TextInput style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, padding: 10, color: colors.text, fontSize: 18, fontWeight: "800", width: 80, textAlign: "center" }} value={f.val} onChangeText={f.set} keyboardType="numeric" selectTextOnFocus />
                  </View>
                ))}

                <Text style={s.editLabel}>{t.activityLevel}</Text>
                <View style={{ gap: 8 }}>
                  {(Object.keys(ACTIVIDAD_LABELS) as UserProfile["actividad"][]).map((a) => (
                    <TouchableOpacity key={a} style={[s.editChipFull, editActividad === a && s.editChipActive]} onPress={() => setEditActividad(a)}>
                      <Text style={[s.editChipText, editActividad === a && s.editChipTextActive]}>{ACTIVIDAD_LABELS[a]}</Text>
                      {editActividad === a && <Text style={{ color: "#58A6FF" }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.editLabel}>{t.goal}</Text>
                <View style={{ gap: 8 }}>
                  {(Object.keys(OBJETIVO_LABELS) as UserProfile["objetivo"][]).map((o) => (
                    <TouchableOpacity key={o} style={[s.editChipFull, editObjetivo === o && s.editChipActive]} onPress={() => setEditObjetivo(o)}>
                      <Text style={[s.editChipText, editObjetivo === o && s.editChipTextActive]}>{OBJETIVO_LABELS[o]}</Text>
                      {editObjetivo === o && <Text style={{ color: "#58A6FF" }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </View>

                {errorEdit ? (
                  <View style={{ backgroundColor: "#EF444422", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#EF444455" }}>
                    <Text style={{ color: "#EF4444" }}>⚠️ {errorEdit}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={{ backgroundColor: guardando ? "#1F3A6B" : "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center", marginBottom: 24 }}
                  onPress={guardarPerfil}
                  disabled={guardando}
                >
                  <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>{guardando ? t.loading : t.saveChanges}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal: confirmar cerrar sesión */}
      <Modal visible={confirmarLogout} transparent animationType="fade" onRequestClose={() => setConfirmarLogout(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmarLogout(false)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>🚪 {t.logout}</Text>
            <Text style={s.popupSubtitle}>{t.confirmLogout}</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarLogout(false)}>
                <Text style={s.cancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: "#EF4444" }]} onPress={confirmarLogoutAccion}>
                <Text style={s.confirmText}>{t.logout}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal: confirmar cerrar cuenta */}
      <Modal visible={confirmarCerrarCuenta} transparent animationType="fade" onRequestClose={() => !cerrandoCuenta && setConfirmarCerrarCuenta(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => !cerrandoCuenta && setConfirmarCerrarCuenta(false)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>{t.closeAccount}</Text>
            <Text style={s.popupSubtitle}>{t.deleteAccountWarning}</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarCerrarCuenta(false)} disabled={cerrandoCuenta}>
                <Text style={s.cancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, { backgroundColor: "#EF4444" }, cerrandoCuenta && { opacity: 0.6 }]}
                onPress={handleCerrarCuenta}
                disabled={cerrandoCuenta}
              >
                <Text style={s.confirmText}>{cerrandoCuenta ? t.deleting : t.yesDelete}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + 8 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.backBtn}>{t.back}</Text>
          </TouchableOpacity>
          <Text style={s.title}>{t.settingsTitle}</Text>
        </View>

        {profile && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>{t.myProfile}</Text>
            <View style={{ alignItems: "center", paddingVertical: 8, gap: 4 }}>
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.2 }}>{profile.nombre}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{userEmail}</Text>
            </View>
            <View style={s.profileStats}>
              {[
                { label: t.weight, val: `${kgToDisplay(profile.peso, weightUnit).toFixed(1)} ${weightUnit}`, dot: "#60A5FA" },
                { label: t.height, val: `${profile.altura} cm`, dot: "#4ADE80" },
                { label: t.age, val: `${profile.edad}`, dot: "#FBBF24" },
              ].map((stat) => (
                <View key={stat.label} style={s.profileStat}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{stat.val}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: stat.dot }} />
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>{stat.label}</Text>
                  </View>
                </View>
              ))}
            </View>
            <View style={{ gap: 8 }}>
              <View style={s.profileRow}>
                <Text style={s.profileRowLabel}>{t.activity}</Text>
                <Text style={s.profileRowVal}>{ACTIVIDAD_LABELS[profile.actividad]}</Text>
              </View>
              <View style={s.profileRow}>
                <Text style={s.profileRowLabel}>{t.goal}</Text>
                <Text style={s.profileRowVal}>{OBJETIVO_LABELS[profile.objetivo]}</Text>
              </View>
            </View>
            <TouchableOpacity style={s.editProfileBtn} onPress={openEditProfile}>
              <Text style={s.editProfileBtnText}>{t.editProfileAndRecalculate}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionLabel}>🎨 {t.appearance}</Text>
          <Text style={s.fieldLabel}>{t.theme}</Text>
          <View style={s.optionsRow}>
            {themes.map((th) => (
              <TouchableOpacity key={th.val} style={[s.optionChip, theme === th.val && s.optionChipActive]} onPress={() => setTheme(th.val)}>
                <Text style={[s.optionIcon, { fontSize: 22 }]}>{th.icon}</Text>
                <Text style={[s.optionLabel, theme === th.val && s.optionLabelActive]}>{th.label}</Text>
                {theme === th.val && <Text style={s.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>📏 {t.weightUnitSetting}</Text>
          <View style={s.optionsRow}>
            {(["kg", "lbs"] as WeightUnit[]).map((u) => (
              <TouchableOpacity key={u} style={[s.optionChip, weightUnit === u && s.optionChipActive]} onPress={() => handleWeightUnitChange(u)}>
                <Text style={[s.optionLabel, weightUnit === u && s.optionLabelActive]}>{u === "kg" ? t.weightUnitKg : t.weightUnitLbs}</Text>
                {weightUnit === u && <Text style={s.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>🍽 {t.mealFrequency}</Text>
          <Text style={s.sectionDesc}>{t.mealFrequencyDesc}</Text>
          <View style={{ gap: 8 }}>
            {ALL_MEALS.map(m => {
              const sel = selectedMeals.includes(m.key);
              return (
                <TouchableOpacity key={m.key}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 12,
                    backgroundColor: sel ? "#1F6FEB15" : colors.bg,
                    borderRadius: 14, padding: 14,
                    borderWidth: 1.5, borderColor: sel ? "#1F6FEB" : colors.cardBorder,
                  }}
                  onPress={() => toggleMeal(m.key)}
                  activeOpacity={0.7}>
                  <Text style={{ fontSize: 24 }}>{m.icon}</Text>
                  <Text style={{ flex: 1, color: sel ? colors.text : colors.textMuted, fontSize: 15, fontWeight: sel ? "700" : "500" }}>{m.label}</Text>
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
          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: "center", marginTop: 4 }}>
            {selectedMeals.length} {t.mealFrequency.toLowerCase()}
          </Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>🌍 {t.language}</Text>
          <Text style={s.sectionDesc}>{t.chooseLanguage}</Text>
          <TouchableOpacity style={s.langPickerBtn} onPress={() => { setLangSearch(""); setShowLangModal(true); }} activeOpacity={0.8}>
            <Text style={{ fontSize: 22 }}>{LANGUAGE_FLAGS[language]}</Text>
            <Text style={s.langPickerText}>{LANGUAGE_NAMES[language]}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 18 }}>›</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={showLangModal} transparent animationType="slide" onRequestClose={() => setShowLangModal(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000CC", justifyContent: "flex-end" }} activeOpacity={1} onPress={() => setShowLangModal(false)}>
            <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingBottom: 40, maxHeight: "80%" }} onStartShouldSetResponder={() => true}>
              <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginBottom: 12 }}>🌍 {t.chooseLanguage}</Text>
                <TextInput
                  value={langSearch}
                  onChangeText={setLangSearch}
                  placeholder="🔍 English, Español, Français..."
                  placeholderTextColor={colors.textMuted}
                  style={{ backgroundColor: colors.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.text, fontSize: 15, borderWidth: 1, borderColor: colors.inputBorder }}
                />
              </View>
              <FlatList
                data={(Object.keys(TRANSLATIONS) as Language[]).filter(lang => {
                  const q = langSearch.toLowerCase();
                  if (!q) return true;
                  return LANGUAGE_NAMES[lang].toLowerCase().includes(q) || (LANGUAGE_NAMES_EN[lang] ?? "").toLowerCase().includes(q);
                })}
                keyExtractor={item => item}
                keyboardShouldPersistTaps="handled"
                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.cardBorder, marginHorizontal: 16 }} />}
                renderItem={({ item: lang }) => (
                  <TouchableOpacity style={[s.langRow, language === lang && s.langRowActive]} onPress={() => { setLanguage(lang); setShowLangModal(false); }} activeOpacity={0.7}>
                    <Text style={{ fontSize: 22 }}>{LANGUAGE_FLAGS[lang]}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.langName, language === lang && s.langNameActive]}>{LANGUAGE_NAMES[lang]}</Text>
                      {LANGUAGE_NAMES_EN[lang] && LANGUAGE_NAMES_EN[lang] !== LANGUAGE_NAMES[lang] && (
                        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{LANGUAGE_NAMES_EN[lang]}</Text>
                      )}
                    </View>
                    {language === lang && <View style={s.langCheck}><Text style={s.langCheckText}>✓</Text></View>}
                  </TouchableOpacity>
                )}
              />
            </View>
          </TouchableOpacity>
        </Modal>

        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <Text style={{ fontSize: 20 }}>🚪</Text>
            <Text style={s.logoutText}>{t.logout}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={s.deleteAccountBtn} onPress={() => setConfirmarCerrarCuenta(true)}>
          <Text style={s.deleteAccountText}>{t.closeAccountPermanently}</Text>
        </TouchableOpacity>

        <View style={{ height: 8 }} />
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof import("./services/i18n").useApp>["colors"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { flex: 1, paddingHorizontal: 16 },
    header: { paddingTop: 20, paddingBottom: 16, gap: 6 },
    backBtn: { color: colors.accent, fontSize: 14, marginBottom: 4 },
    title: { color: colors.text, fontSize: 28, fontWeight: "800" },
    section: { backgroundColor: colors.card, borderRadius: 24, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: colors.cardBorder, gap: 12 },
    sectionLabel: { color: colors.text, fontSize: 17, fontWeight: "800" },
    sectionDesc: { color: colors.textMuted, fontSize: 13, marginTop: -4 },
    fieldLabel: { color: colors.textSub, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
    profileCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.bg, borderRadius: 14, padding: 14 },
    profileAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    profileStats: { flexDirection: "row", gap: 8 },
    profileStat: { flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 16, alignItems: "center" },
    profileRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.bg, borderRadius: 10, padding: 12 },
    profileRowLabel: { color: colors.textSub, fontSize: 13 },
    profileRowVal: { color: colors.text, fontSize: 13, fontWeight: "600" },
    editProfileBtn: { backgroundColor: "#1F6FEB", borderRadius: 16, padding: 16, alignItems: "center" },
    editProfileBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    editLabel: { color: colors.textSub, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    editChip: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder },
    editChipFull: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder },
    editChipActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
    editChipText: { color: colors.textSub, fontSize: 14, fontWeight: "600" },
    editChipTextActive: { color: "#58A6FF", fontWeight: "700" },
    logoutBtn: { backgroundColor: "#EF444422", borderRadius: 14, padding: 18, alignItems: "center", borderWidth: 1, borderColor: "#EF444455", marginBottom: 8 },
    logoutText: { color: "#EF4444", fontSize: 15, fontWeight: "700" },
    deleteAccountBtn: { borderRadius: 14, padding: 14, alignItems: "center", borderWidth: 1, borderColor: "#EF444433", marginBottom: 8 },
    deleteAccountText: { color: "#EF444488", fontSize: 13, fontWeight: "600" },
    overlay: { flex: 1, backgroundColor: "#000000AA", justifyContent: "center", alignItems: "center", padding: 20 },
    popup: { backgroundColor: colors.card, borderRadius: 24, padding: 24, width: "100%", borderWidth: 1, borderColor: colors.cardBorder, gap: 16 },
    popupTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
    popupSubtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
    popupBtns: { flexDirection: "row" as const, gap: 10 },
    cancelBtn: { flex: 1, backgroundColor: colors.cardBorder, borderRadius: 12, padding: 14, alignItems: "center" as const },
    cancelText: { color: colors.textSub, fontWeight: "700" as const, fontSize: 15 },
    confirmBtn: { flex: 1, borderRadius: 12, padding: 14, alignItems: "center" as const },
    confirmText: { color: "#fff", fontWeight: "700" as const, fontSize: 15 },
    optionsRow: { flexDirection: "row", gap: 10 },
    optionChip: { flex: 1, flexDirection: "column", alignItems: "center", gap: 6, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 16, padding: 16 },
    optionChipActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
    optionIcon: { fontSize: 20 },
    optionLabel: { color: colors.textSub, fontSize: 14, fontWeight: "600", textAlign: "center" },
    optionLabelActive: { color: "#58A6FF", fontWeight: "700" },
    checkmark: { color: "#58A6FF", fontSize: 16, fontWeight: "800" },
    langPickerBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.inputBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: colors.inputBorder },
    langPickerText: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "700" },
    langRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
    langRowActive: { backgroundColor: "#1F6FEB11" },
    langFlag: { fontSize: 22 },
    langName: { flex: 1, color: colors.textSub, fontSize: 16, fontWeight: "600" },
    langNameActive: { color: "#58A6FF", fontWeight: "700" },
    langCheck: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" },
    langCheckText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  });
}