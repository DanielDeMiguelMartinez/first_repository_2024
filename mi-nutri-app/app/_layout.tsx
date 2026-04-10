import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, Text, TouchableOpacity, View } from "react-native";
import {
  AppContext,
  DARK_COLORS,
  Language,
  LIGHT_COLORS,
  Theme,
  THEME_KEY,
  LANGUAGE_KEY,
  TRANSLATIONS,
} from "./services/i18n";
import { supabase } from "./services/supabase";
import { setUserLanguage } from "./services/openFoodFacts";
import { setD1TokenProvider } from "./services/d1";

// Inyectar proveedor de JWT para que el proxy D1 autentique con Supabase
setD1TokenProvider(() =>
  supabase.auth.getSession().then(({ data }) => data.session?.access_token ?? null)
);

// useNativeDriver solo funciona en iOS/Android, no en web
const nativeDriver = Platform.OS !== "web";

// ── Error Boundary ────────────────────────────────────────────────────────────
function ErrorFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#0A0F1A", alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
      <Text style={{ fontSize: 56 }}>⚠️</Text>
      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900", textAlign: "center" }}>Algo salió mal</Text>
      <Text style={{ color: "#475569", fontSize: 13, textAlign: "center", lineHeight: 20 }}>
        {error?.message ?? "Error inesperado"}
      </Text>
      <TouchableOpacity
        onPress={onReset}
        style={{ backgroundColor: "#1F6FEB", borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14, marginTop: 8 }}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>Reintentar</Text>
      </TouchableOpacity>
    </View>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onReset={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}

// ── Splash screen ─────────────────────────────────────────────────────────────
function SplashScreen({ tagline }: { tagline?: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: nativeDriver,
    }).start();
  }, []);
  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: "#0A0F1A",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        opacity,
      }}
    >
      <Text style={{ fontSize: 72 }}>🥗</Text>
      <Text style={{ color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: -1 }}>
        NutriTrack
      </Text>
      <Text style={{ color: "#475569", fontSize: 14 }}>
        {tagline ?? "Your personal nutrition diary"}
      </Text>
      <ActivityIndicator color="#1F6FEB" style={{ marginTop: 24 }} />
    </Animated.View>
  );
}

// ── Banner de sin conexión ────────────────────────────────────────────────────
function NetworkBanner({ visible, noConnectionMsg }: { visible: boolean; noConnectionMsg: string }) {
  const translateY = useRef(new Animated.Value(-50)).current;
  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : -50,
      useNativeDriver: nativeDriver,
      tension: 100,
      friction: 10,
    }).start();
  }, [visible]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999,
        transform: [{ translateY }],
      }}
    >
      <View
        style={{
          backgroundColor: "#EF4444",
          paddingVertical: 8,
          paddingHorizontal: 16,
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <Text style={{ fontSize: 14 }}>📡</Text>
        <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
          {noConnectionMsg}
        </Text>
      </View>
    </Animated.View>
  );
}

// ── Detectar idioma del dispositivo / navegador ───────────────────────────────
function detectarIdiomaDispositivo(): Language {
  try {
    const locale =
      (typeof navigator !== "undefined" && navigator.language) ||
      (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().locale : "es") ||
      "es";
    const code = locale.slice(0, 2).toLowerCase();
    // Map locale code → supported Language
    const MAP: Record<string, string> = {
      es: "es", gl: "es", eu: "es",
      ca: "ca",
      pt: "pt",
      fr: "fr", oc: "fr",
      it: "it",
      de: "de",
      nl: "nl",
      sv: "sv",
      da: "da",
      nb: "nb", no: "nb",
      fi: "fi",
      pl: "pl",
      cs: "cs",
      sk: "sk",
      hu: "hu",
      ro: "ro",
      uk: "uk",
      ru: "ru",
      el: "el",
      he: "he",
      ar: "ar",
      hi: "hi",
      th: "th",
      vi: "vi",
      id: "id", ms: "id",
      ja: "ja",
      ko: "ko",
      zh: "zh",
      tr: "tr",
    };
    return (MAP[code] as Language) ?? "en";
  } catch {
    return "es";
  }
}

// ── Comprobar conexión ───────────────────────────────────────────────────────
async function comprobarConexion(): Promise<boolean> {
  if (Platform.OS === "web") {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch("https://google.com", {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

// ── Root layout ───────────────────────────────────────────────────────────────
export default function RootLayout() {
  const [language, setLanguageState] = useState<Language>("es");
  const [theme, setThemeState] = useState<Theme>("dark");
  const [loaded, setLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const router = useRouter();

  // Cargar tema e idioma persistidos; si el usuario eligió idioma manual se respeta,
  // si no, se detecta del dispositivo como fallback.
  useEffect(() => {
    (async () => {
      try {
        const storedTheme = await AsyncStorage.getItem(THEME_KEY);
        if (storedTheme) setThemeState(storedTheme as Theme);
      } catch {}
      try {
        const storedLang = await AsyncStorage.getItem(LANGUAGE_KEY);
        const lang: Language = (storedLang as Language) ?? detectarIdiomaDispositivo();
        setLanguageState(lang);
        setUserLanguage(lang);
      } catch {
        const lang = detectarIdiomaDispositivo();
        setLanguageState(lang);
        setUserLanguage(lang);
      }
      setLoaded(true);
    })();
  }, []);

  // Vigilar conexión
  useEffect(() => {
    const check = async () => {
      const online = await comprobarConexion();
      setIsOnline(online);
    };

    check();

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleOnline  = () => check();
      const handleOffline = () => setIsOnline(false);
      window.addEventListener("online",  handleOnline);
      window.addEventListener("offline", handleOffline);
      const interval = setInterval(check, 15000);
      return () => {
        window.removeEventListener("online",  handleOnline);
        window.removeEventListener("offline", handleOffline);
        clearInterval(interval);
      };
    } else {
      const interval = setInterval(check, 10000);
      return () => clearInterval(interval);
    }
  }, []);

  // ── Gestión de sesión ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return;

    // true cuando INITIAL_SESSION ya fue procesado
    let initialHandled = false;

    const redirigirInicial = async (session: any) => {
      if (!session) {
        router.replace("/auth");
        return;
      }
      try {
        const { data: perfil } = await supabase
          .from("perfiles")
          .select("id")
          .eq("id", session.user.id)
          .single();
        if (!perfil) {
          router.replace("/onboarding");
        } else {
          router.replace("/");
        }
      } catch {
        router.replace("/");
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "INITIAL_SESSION") {
          initialHandled = true;
          await redirigirInicial(session);
        } else if (event === "SIGNED_IN" && !initialHandled) {
          initialHandled = true;
          await redirigirInicial(session);
        } else if (event === "SIGNED_OUT") {
          // Solo redirigimos a /auth si INITIAL_SESSION ya fue procesado
          // (evita redirigir cuando SIGNED_OUT se dispara durante la
          // inicialización, antes de que se haya restaurado la sesión del storage).
          if (initialHandled) {
            router.replace("/auth");
          }
        }
        // TOKEN_REFRESHED no provoca navegación
      }
    );

    return () => subscription.unsubscribe();
  }, [loaded]);

  // ── Refresco al recuperar el foco + sincronización entre pestañas ────────────
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    // Cuando la pestaña vuelve a ser visible, forzamos getSession().
    // Esto hace que Supabase compruebe si el token expiró y lo renueve
    // antes de que cualquier pantalla lance sus peticiones.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        supabase.auth.getSession();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // Cuando otra pestaña actualiza los tokens en localStorage, refrescamos
    // la sesión en esta pestaña para que no trabaje con tokens caducados.
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.includes("supabase") && e.newValue) {
        supabase.auth.getSession();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setLanguage = async (l: Language) => {
    setLanguageState(l);
    setUserLanguage(l);
    await AsyncStorage.setItem(LANGUAGE_KEY, l);
  };

  const setTheme = async (t: Theme) => {
    setThemeState(t);
    await AsyncStorage.setItem(THEME_KEY, t);
  };

  const t = TRANSLATIONS[language];
  const colors = theme === "dark" ? DARK_COLORS : LIGHT_COLORS;

  if (!loaded) return <SplashScreen tagline={t.appTagline} />;

  return (
    <ErrorBoundary>
      <AppContext.Provider value={{ language, theme, t, setLanguage, setTheme, colors, isOnline }}>
        <NetworkBanner visible={!isOnline} noConnectionMsg={t.noConnection} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: "fade_from_bottom",
          }}
        >
          <Stack.Screen name="index"       options={{ headerShown: false }} />
          <Stack.Screen name="auth"        options={{ headerShown: false }} />
          <Stack.Screen name="onboarding"  options={{ headerShown: false }} />
          <Stack.Screen name="add-food"    options={{ headerShown: false }} />
          <Stack.Screen name="scanner"     options={{ headerShown: false }} />
          <Stack.Screen name="recetas"     options={{ headerShown: false }} />
          <Stack.Screen name="create-food" options={{ headerShown: false }} />
          <Stack.Screen name="edit-food"   options={{ headerShown: false }} />
          <Stack.Screen name="settings"    options={{ headerShown: false }} />
          <Stack.Screen name="comunidad"      options={{ headerShown: false }} />
          <Stack.Screen name="reels"         options={{ headerShown: false }} />
          <Stack.Screen name="perfil"        options={{ headerShown: false }} />
          <Stack.Screen name="buscar"        options={{ headerShown: false }} />
          <Stack.Screen name="usuario/[id]"  options={{ headerShown: false }} />
          <Stack.Screen name="notificaciones" options={{ headerShown: false }} />
          <Stack.Screen name="widget"         options={{ headerShown: false }} />
          <Stack.Screen name="seguimiento"   options={{ headerShown: false }} />
        </Stack>
      </AppContext.Provider>
    </ErrorBoundary>
  );
}