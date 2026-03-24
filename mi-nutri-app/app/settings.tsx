import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Image,
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
import { Language, LANGUAGE_FLAGS, LANGUAGE_NAMES, Theme, useApp } from "./services/i18n";
import { supabase } from "./services/supabase";

const GOALS_KEY  = "nutri_daily_goals";
const AVATAR_KEY = "nutri_avatar";

const ACTIVIDAD_LABELS: Record<UserProfile["actividad"], string> = {
  sedentario: "Sedentario 🪑", ligero: "Ligero 🚶", moderado: "Moderado 🏃",
  activo: "Activo 💪", muy_activo: "Muy activo 🔥",
};

const OBJETIVO_LABELS: Record<UserProfile["objetivo"], string> = {
  perder: "⬇️ Perder grasa", mantener: "⚖️ Mantener peso", ganar: "⬆️ Ganar músculo",
};

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
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [confirmarBorrarFoto, setConfirmarBorrarFoto] = useState(false);
  const [confirmarLogout, setConfirmarLogout] = useState(false);
  const [confirmarCerrarCuenta, setConfirmarCerrarCuenta] = useState(false);
  const [cerrandoCuenta, setCerrandoCuenta] = useState(false);

  const s = makeStyles(colors);

  // Cargar avatar: AsyncStorage (rápido) + Supabase (sync entre dispositivos)
  useEffect(() => {
    AsyncStorage.getItem(AVATAR_KEY).then(v => { if (v) setAvatarUri(v); });
  }, []);

  // Cuando tengamos userId, sincronizar avatar desde Supabase
  useEffect(() => {
    if (!userId) return;
    supabase.from("perfiles").select("avatar_url").eq("id", userId).single()
      .then(({ data }) => {
        if (data?.avatar_url) {
          setAvatarUri(data.avatar_url);
          AsyncStorage.setItem(AVATAR_KEY, data.avatar_url);
        }
      });
  }, [userId]);

  const guardarAvatarEnNube = (dataUri: string) => {
    setAvatarUri(dataUri);
    AsyncStorage.setItem(AVATAR_KEY, dataUri);
    if (userId) {
      // upsert: crea la fila si no existe (evita que update falle silenciosamente)
      supabase.from("perfiles").upsert(
        { id: userId, avatar_url: dataUri, ...(profile?.nombre ? { nombre: profile.nombre } : {}) },
        { onConflict: "id" }
      );
    }
  };

  // NOT async — preserves user-gesture context on Android Chrome (same fix as mic)
  const handlePickAvatar = () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const full = ev.target?.result as string;
          if (!full) return;
          // Redimensionar a 200×200 para no guardar imágenes enormes en la BD
          const img = new (window as any).Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = 200; canvas.height = 200;
            canvas.getContext("2d")!.drawImage(img, 0, 0, 200, 200);
            guardarAvatarEnNube(canvas.toDataURL("image/jpeg", 0.85));
          };
          img.src = full;
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }
    void (async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permiso denegado", "Necesitas permitir el acceso a la galería de fotos.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"] as any,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const dataUri = asset.base64
          ? `data:image/jpeg;base64,${asset.base64}`
          : asset.uri;
        guardarAvatarEnNube(dataUri);
      }
    })();
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
    if (!editNombre.trim()) { setErrorEdit("El nombre no puede estar vacío"); return; }
    if (!editPeso || Number(editPeso) < 30 || Number(editPeso) > 300) { setErrorEdit("Peso inválido (30-300 kg)"); return; }
    if (!editAltura || Number(editAltura) < 100 || Number(editAltura) > 250) { setErrorEdit("Altura inválida (100-250 cm)"); return; }
    if (!editEdad || Number(editEdad) < 10 || Number(editEdad) > 100) { setErrorEdit("Edad inválida"); return; }

    if (!userId) { setErrorEdit("Sesión no disponible"); return; }

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

      if (error) { setErrorEdit("Error al guardar: " + error.message); setGuardando(false); return; }

      await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(goals));
      setProfile(newProfile);
      setShowEditProfile(false);

      Alert.alert(
        "✓ Perfil actualizado",
        `Tus objetivos nutricionales han sido recalculados:\n\n🔥 ${goals.calories} kcal/día\n💪 ${goals.protein}g proteína\n🌾 ${goals.carbs}g carbos\n🥑 ${goals.fat}g grasas`,
        [{ text: "Entendido" }]
      );
    } catch (e: any) { setErrorEdit("Error: " + e.message); }
    setGuardando(false);
  };

  const handleDeleteAvatar = async () => {
    setConfirmarBorrarFoto(false);
    setAvatarUri(null);
    await AsyncStorage.removeItem(AVATAR_KEY);
    if (userId) {
      await supabase.from("perfiles").update({ avatar_url: null }).eq("id", userId);
    }
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

  const languages: Language[] = ["es", "en", "fr", "de", "zh"];
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
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>✏️ Editar perfil</Text>
              <TouchableOpacity onPress={() => setShowEditProfile(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.textSub, fontSize: 14 }}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: "#1F6FEB11", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#1F6FEB33" }}>
              <Text style={{ color: "#58A6FF", fontSize: 13 }}>
                💡 Al guardar, tus objetivos de calorías y macros se recalcularán automáticamente según tu nuevo perfil.
              </Text>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={{ padding: 16, gap: 14 }}>
                <Text style={s.editLabel}>Nombre</Text>
                <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder }}>
                  <TextInput style={{ color: colors.text, fontSize: 16, fontWeight: "600" }} value={editNombre} onChangeText={setEditNombre} placeholder="Tu nombre" placeholderTextColor={colors.textMuted} autoCapitalize="words" maxLength={30} />
                </View>

                <Text style={s.editLabel}>Sexo</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["hombre", "mujer"] as const).map((sx) => (
                    <TouchableOpacity key={sx} style={[s.editChip, editSexo === sx && s.editChipActive]} onPress={() => setEditSexo(sx)}>
                      <Text style={[s.editChipText, editSexo === sx && s.editChipTextActive]}>{sx === "hombre" ? "♂️ Hombre" : "♀️ Mujer"}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.editLabel}>Medidas</Text>
                {[
                  { label: "Peso (kg)", val: editPeso, set: setEditPeso },
                  { label: "Altura (cm)", val: editAltura, set: setEditAltura },
                  { label: "Edad (años)", val: editEdad, set: setEditEdad },
                ].map((f) => (
                  <View key={f.label} style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder }}>
                    <Text style={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: "600" }}>{f.label}</Text>
                    <TextInput style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, padding: 10, color: colors.text, fontSize: 18, fontWeight: "800", width: 80, textAlign: "center" }} value={f.val} onChangeText={f.set} keyboardType="numeric" selectTextOnFocus />
                  </View>
                ))}

                <Text style={s.editLabel}>Nivel de actividad</Text>
                <View style={{ gap: 8 }}>
                  {(Object.keys(ACTIVIDAD_LABELS) as UserProfile["actividad"][]).map((a) => (
                    <TouchableOpacity key={a} style={[s.editChipFull, editActividad === a && s.editChipActive]} onPress={() => setEditActividad(a)}>
                      <Text style={[s.editChipText, editActividad === a && s.editChipTextActive]}>{ACTIVIDAD_LABELS[a]}</Text>
                      {editActividad === a && <Text style={{ color: "#58A6FF" }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.editLabel}>Objetivo</Text>
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
                  <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>{guardando ? "Guardando..." : "Guardar cambios"}</Text>
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
            <Text style={s.popupTitle}>🚪 Cerrar sesión</Text>
            <Text style={s.popupSubtitle}>¿Seguro que quieres cerrar sesión?</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarLogout(false)}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: "#EF4444" }]} onPress={confirmarLogoutAccion}>
                <Text style={s.confirmText}>Cerrar sesión</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal: confirmar borrar foto */}
      <Modal visible={confirmarBorrarFoto} transparent animationType="fade" onRequestClose={() => setConfirmarBorrarFoto(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmarBorrarFoto(false)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>🗑️ Eliminar foto de perfil</Text>
            <Text style={s.popupSubtitle}>¿Seguro que quieres eliminar tu foto de perfil? Se borrará en todos tus dispositivos.</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarBorrarFoto(false)}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: "#EF4444" }]} onPress={handleDeleteAvatar}>
                <Text style={s.confirmText}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal: confirmar cerrar cuenta */}
      <Modal visible={confirmarCerrarCuenta} transparent animationType="fade" onRequestClose={() => !cerrandoCuenta && setConfirmarCerrarCuenta(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => !cerrandoCuenta && setConfirmarCerrarCuenta(false)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>⚠️ Cerrar cuenta</Text>
            <Text style={s.popupSubtitle}>
              {"Esta acción eliminará permanentemente tu cuenta y todos tus datos (perfil, recetas, publicaciones, reels).\n\nEsta acción NO se puede deshacer."}
            </Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarCerrarCuenta(false)} disabled={cerrandoCuenta}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, { backgroundColor: "#EF4444" }, cerrandoCuenta && { opacity: 0.6 }]}
                onPress={handleCerrarCuenta}
                disabled={cerrandoCuenta}
              >
                <Text style={s.confirmText}>{cerrandoCuenta ? "Eliminando..." : "Sí, eliminar"}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.backBtn}>{t.back}</Text>
          </TouchableOpacity>
          <Text style={s.title}>{t.settingsTitle}</Text>
        </View>

        {profile && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>👤 Mi perfil</Text>
            <View style={s.profileCard}>
              <View>
                <TouchableOpacity style={s.profileAvatar} onPress={handlePickAvatar} activeOpacity={0.8}>
                  {avatarUri
                    ? <Image source={{ uri: avatarUri }} style={{ width: 56, height: 56, borderRadius: 28 }} />
                    : <Text style={{ fontSize: 32 }}>{profile.sexo === "hombre" ? "♂️" : "♀️"}</Text>}
                  <View style={{ position: "absolute", bottom: -2, right: -2, backgroundColor: "#1F6FEB", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 11 }}>📷</Text>
                  </View>
                </TouchableOpacity>
                {avatarUri ? (
                  <TouchableOpacity
                    style={{ position: "absolute", top: -4, left: -4, backgroundColor: "#EF4444", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center", zIndex: 10 }}
                    onPress={() => setConfirmarBorrarFoto(true)}
                  >
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>{profile.nombre}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{userEmail}</Text>
              </View>
            </View>
            <View style={s.profileStats}>
              {[
                { label: "Peso", val: `${profile.peso} kg` },
                { label: "Altura", val: `${profile.altura} cm` },
                { label: "Edad", val: `${profile.edad} años` },
              ].map((stat) => (
                <View key={stat.label} style={s.profileStat}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{stat.val}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{stat.label}</Text>
                </View>
              ))}
            </View>
            <View style={{ gap: 8 }}>
              <View style={s.profileRow}>
                <Text style={s.profileRowLabel}>Actividad</Text>
                <Text style={s.profileRowVal}>{ACTIVIDAD_LABELS[profile.actividad]}</Text>
              </View>
              <View style={s.profileRow}>
                <Text style={s.profileRowLabel}>Objetivo</Text>
                <Text style={s.profileRowVal}>{OBJETIVO_LABELS[profile.objetivo]}</Text>
              </View>
            </View>
            <TouchableOpacity style={s.editProfileBtn} onPress={openEditProfile}>
              <Text style={s.editProfileBtnText}>✏️ Editar perfil y recalcular objetivos</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionLabel}>🎨 {t.appearance}</Text>
          <Text style={s.fieldLabel}>{t.theme}</Text>
          <View style={s.optionsRow}>
            {themes.map((th) => (
              <TouchableOpacity key={th.val} style={[s.optionChip, theme === th.val && s.optionChipActive]} onPress={() => setTheme(th.val)}>
                <Text style={s.optionIcon}>{th.icon}</Text>
                <Text style={[s.optionLabel, theme === th.val && s.optionLabelActive]}>{th.label}</Text>
                {theme === th.val && <Text style={s.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>🌍 {t.language}</Text>
          <Text style={s.sectionDesc}>{t.chooseLanguage}</Text>
          {languages.map((lang) => (
            <TouchableOpacity key={lang} style={[s.langRow, language === lang && s.langRowActive]} onPress={() => setLanguage(lang)} activeOpacity={0.7}>
              <Text style={s.langFlag}>{LANGUAGE_FLAGS[lang]}</Text>
              <Text style={[s.langName, language === lang && s.langNameActive]}>{LANGUAGE_NAMES[lang]}</Text>
              {language === lang && <View style={s.langCheck}><Text style={s.langCheckText}>✓</Text></View>}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Text style={s.logoutText}>🚪 Cerrar sesión</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.deleteAccountBtn} onPress={() => setConfirmarCerrarCuenta(true)}>
          <Text style={s.deleteAccountText}>⚠️ Cerrar cuenta permanentemente</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
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
    section: { backgroundColor: colors.card, borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.cardBorder, gap: 12 },
    sectionLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
    sectionDesc: { color: colors.textMuted, fontSize: 13, marginTop: -4 },
    fieldLabel: { color: colors.textSub, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
    profileCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.bg, borderRadius: 14, padding: 14 },
    profileAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" },
    profileStats: { flexDirection: "row", gap: 8 },
    profileStat: { flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 12, alignItems: "center" },
    profileRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.bg, borderRadius: 10, padding: 12 },
    profileRowLabel: { color: colors.textSub, fontSize: 13 },
    profileRowVal: { color: colors.text, fontSize: 13, fontWeight: "600" },
    editProfileBtn: { backgroundColor: "#1F6FEB22", borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: "#1F6FEB55" },
    editProfileBtnText: { color: "#58A6FF", fontSize: 14, fontWeight: "700" },
    editLabel: { color: colors.textSub, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    editChip: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder },
    editChipFull: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder },
    editChipActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
    editChipText: { color: colors.textSub, fontSize: 14, fontWeight: "600" },
    editChipTextActive: { color: "#58A6FF", fontWeight: "700" },
    logoutBtn: { backgroundColor: "#EF444422", borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#EF444455", marginBottom: 8 },
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
    optionChip: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 14, padding: 14 },
    optionChipActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
    optionIcon: { fontSize: 20 },
    optionLabel: { flex: 1, color: colors.textSub, fontSize: 14, fontWeight: "600" },
    optionLabelActive: { color: "#58A6FF", fontWeight: "700" },
    checkmark: { color: "#58A6FF", fontSize: 16, fontWeight: "800" },
    langRow: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.inputBg, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.inputBorder },
    langRowActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
    langFlag: { fontSize: 28 },
    langName: { flex: 1, color: colors.textSub, fontSize: 16, fontWeight: "600" },
    langNameActive: { color: "#58A6FF", fontWeight: "700" },
    langCheck: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" },
    langCheckText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  });
}