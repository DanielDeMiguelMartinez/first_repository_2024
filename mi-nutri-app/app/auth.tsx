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

export default function AuthScreen() {
  const { colors, theme } = useApp();
  const router = useRouter();
  const [modo, setModo] = useState<"login" | "registro" | "recovery">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [recoveryEnviado, setRecoveryEnviado] = useState(false);

  const validarEmail = (e: string) => /\S+@\S+\.\S+/.test(e);

  const handleLogin = async () => {
    setError("");
    if (!validarEmail(email)) { setError("Introduce un email válido."); return; }
    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres."); return; }
    setCargando(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setCargando(false);
    if (err) {
      if (err.message.includes("Invalid login")) setError("Email o contraseña incorrectos.");
      else setError(err.message);
      return;
    }
    const { data: perfil } = await supabase
      .from("perfiles")
      .select("id")
      .eq("id", data.user!.id)
      .single();
    if (!perfil) {
      router.replace("/onboarding");
    } else {
      router.replace("/");
    }
  };

  const handleRegistro = async () => {
    setError("");
    if (!validarEmail(email)) { setError("Introduce un email válido."); return; }
    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres."); return; }
    setCargando(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    setCargando(false);
    if (err) {
      if (err.message.includes("already registered")) setError("Ya existe una cuenta con ese email.");
      else setError(err.message);
      return;
    }
    if (data.user) {
      router.replace("/onboarding");
    }
  };

  const handleRecovery = async () => {
    setError("");
    if (!validarEmail(email)) { setError("Introduce un email válido."); return; }
    setCargando(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: "nutritrack://reset-password" } // cambia por tu deep link si tienes
    );
    setCargando(false);
    if (err) { setError(err.message); return; }
    setRecoveryEnviado(true);
  };

  const s = makeStyles(colors);

  // ── Pantalla recuperar contraseña ────────────────────────────────────────
  if (modo === "recovery") {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <View style={s.logoWrap}>
              <Text style={s.logoEmoji}>🔑</Text>
              <Text style={s.logoTitle}>Recuperar contraseña</Text>
              <Text style={s.logoSub}>Te enviaremos un enlace para restablecer tu contraseña</Text>
            </View>

            {recoveryEnviado ? (
              <View style={{ gap: 16 }}>
                <View style={{ backgroundColor: "#4ADE8022", borderRadius: 16, padding: 20, borderWidth: 1, borderColor: "#4ADE8055", alignItems: "center", gap: 12 }}>
                  <Text style={{ fontSize: 48 }}>📬</Text>
                  <Text style={{ color: "#4ADE80", fontSize: 16, fontWeight: "800", textAlign: "center" }}>¡Email enviado!</Text>
                  <Text style={{ color: colors.textSub, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                    Revisa tu bandeja de entrada en{"\n"}
                    <Text style={{ color: colors.text, fontWeight: "700" }}>{email}</Text>
                  </Text>
                </View>
                <TouchableOpacity style={s.btn} onPress={() => { setModo("login"); setRecoveryEnviado(false); setEmail(""); }}>
                  <Text style={s.btnText}>Volver al inicio de sesión</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.form}>
                <View style={s.field}>
                  <Text style={s.label}>Email</Text>
                  <TextInput
                    style={s.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="tu@email.com"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                  />
                </View>

                {error ? (
                  <View style={s.errorBox}>
                    <Text style={s.errorText}>⚠️ {error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[s.btn, cargando && s.btnDisabled]}
                  onPress={handleRecovery}
                  disabled={cargando}
                >
                  <Text style={s.btnText}>{cargando ? "Enviando..." : "Enviar enlace"}</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => { setModo("login"); setError(""); }} style={{ alignItems: "center", paddingVertical: 8 }}>
                  <Text style={{ color: colors.textSub, fontSize: 14 }}>← Volver al inicio de sesión</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Login / Registro ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          <View style={s.logoWrap}>
            <Text style={s.logoEmoji}>🥗</Text>
            <Text style={s.logoTitle}>NutriTrack</Text>
            <Text style={s.logoSub}>Tu diario nutricional personal</Text>
          </View>

          <View style={s.tabs}>
            <TouchableOpacity style={[s.tab, modo === "login" && s.tabActive]} onPress={() => { setModo("login"); setError(""); }}>
              <Text style={[s.tabText, modo === "login" && s.tabTextActive]}>Iniciar sesión</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.tab, modo === "registro" && s.tabActive]} onPress={() => { setModo("registro"); setError(""); }}>
              <Text style={[s.tabText, modo === "registro" && s.tabTextActive]}>Crear cuenta</Text>
            </TouchableOpacity>
          </View>

          <View style={s.form}>
            <View style={s.field}>
              <Text style={s.label}>Email</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                placeholder="tu@email.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Contraseña</Text>
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
              />
            </View>

            {error ? (
              <View style={s.errorBox}>
                <Text style={s.errorText}>⚠️ {error}</Text>
              </View>
            ) : null}

            {modo === "registro" && (
              <View style={s.infoBox}>
                <Text style={s.infoText}>
                  📱 Tu cuenta funcionará en todos tus dispositivos con el mismo email y contraseña.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.btn, cargando && s.btnDisabled]}
              onPress={modo === "login" ? handleLogin : handleRegistro}
              disabled={cargando}
            >
              <Text style={s.btnText}>
                {cargando ? "Cargando..." : modo === "login" ? "Entrar" : "Crear cuenta"}
              </Text>
            </TouchableOpacity>

            {/* Recuperar contraseña — solo visible en login */}
            {modo === "login" && (
              <TouchableOpacity onPress={() => { setModo("recovery"); setError(""); }} style={{ alignItems: "center", paddingVertical: 8 }}>
                <Text style={{ color: "#58A6FF", fontSize: 14, fontWeight: "600" }}>¿Olvidaste tu contraseña?</Text>
              </TouchableOpacity>
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 },
    logoWrap: { alignItems: "center", paddingTop: 60, paddingBottom: 40, gap: 8 },
    logoEmoji: { fontSize: 64 },
    logoTitle: { color: colors.text, fontSize: 32, fontWeight: "900", letterSpacing: -1 },
    logoSub: { color: colors.textMuted, fontSize: 15, textAlign: "center" },
    tabs: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: colors.cardBorder, marginBottom: 24 },
    tab: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 12 },
    tabActive: { backgroundColor: "#1F6FEB" },
    tabText: { color: colors.textSub, fontSize: 14, fontWeight: "600" },
    tabTextActive: { color: "#fff", fontWeight: "700" },
    form: { gap: 16 },
    field: { gap: 6 },
    label: { color: colors.textSub, fontSize: 13, fontWeight: "600" },
    input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 14, padding: 16, color: colors.text, fontSize: 16 },
    errorBox: { backgroundColor: "#EF444422", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EF444455" },
    errorText: { color: "#EF4444", fontSize: 14 },
    infoBox: { backgroundColor: "#1F6FEB11", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#1F6FEB33" },
    infoText: { color: "#58A6FF", fontSize: 13, lineHeight: 18 },
    btn: { backgroundColor: "#1F6FEB", borderRadius: 14, padding: 18, alignItems: "center", marginTop: 8 },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  });
}