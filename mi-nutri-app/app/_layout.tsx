import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, Text, View } from "react-native";
import {
  AppContext,
  DARK_COLORS,
  Language,
  LANGUAGE_KEY,
  LIGHT_COLORS,
  Theme,
  THEME_KEY,
  TRANSLATIONS,
} from "./services/i18n";
import { supabase } from "./services/supabase";

// useNativeDriver solo funciona en iOS/Android, no en web
const nativeDriver = Platform.OS !== "web";

// ── Splash screen ─────────────────────────────────────────────────────────────
function SplashScreen() {
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
      <Text style={{ color: "#475569", fontSize: 14 }}>Tu diario nutricional personal</Text>
      <ActivityIndicator color="#1F6FEB" style={{ marginTop: 24 }} />
    </Animated.View>
  );
}

// ── Banner de sin conexión ────────────────────────────────────────────────────
function NetworkBanner({ visible }: { visible: boolean }) {
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
          Sin conexión — trabajando en modo local
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
    const MAP: Record<string, Language> = {
      es: "es", ca: "es", gl: "es", eu: "es", pt: "es", // Iberian → Spanish
      fr: "fr", oc: "fr",                                // French group
      de: "de", nl: "de", sv: "de", da: "de", nb: "de", no: "de", fi: "de", // Germanic → German
      zh: "zh",                                           // Chinese
    };
    return MAP[code] ?? "en";
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

  // Cargar preferencias guardadas
  useEffect(() => {
    (async () => {
      try {
        const [storedLang, storedTheme] = await Promise.all([
          AsyncStorage.getItem(LANGUAGE_KEY),
          AsyncStorage.getItem(THEME_KEY),
        ]);
        if (storedLang) setLanguageState(storedLang as Language);
        else setLanguageState(detectarIdiomaDispositivo());
        if (storedTheme) setThemeState(storedTheme as Theme);
      } catch {}
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
    await AsyncStorage.setItem(LANGUAGE_KEY, l);
  };

  const setTheme = async (t: Theme) => {
    setThemeState(t);
    await AsyncStorage.setItem(THEME_KEY, t);
  };

  if (!loaded) return <SplashScreen />;

  const t = TRANSLATIONS[language];
  const colors = theme === "dark" ? DARK_COLORS : LIGHT_COLORS;

  return (
    <AppContext.Provider value={{ language, theme, t, setLanguage, setTheme, colors }}>
      <NetworkBanner visible={!isOnline} />
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
        <Stack.Screen name="settings"    options={{ headerShown: false }} />
        <Stack.Screen name="comunidad"   options={{ headerShown: false }} />
        <Stack.Screen name="reels"       options={{ headerShown: false }} />
        <Stack.Screen name="seguimiento" options={{ headerShown: false }} />
      </Stack>
    </AppContext.Provider>
  );
}