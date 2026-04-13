import { useApp } from "@/app/services/i18n";
import { useNotifCount } from "@/app/services/useNotifCount";
import { usePathname, useRouter } from "expo-router";
import { Platform, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const TAB_BAR_HEIGHT = 68;

export function BottomTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors, t } = useApp();

  const TABS = [
    { label: t.tabHome,    icon: "🏠", route: "/" },
    { label: t.tabReels,   icon: "🎬", route: "/reels" },
    { label: t.recipes,    icon: "🍳", route: "/recetas" },
    { label: t.searchTab,  icon: "🔍", route: "/buscar" },
    { label: t.tabProfile, icon: "👤", route: "/perfil" },
  ];

  const isActive = (route: string) =>
    route === "/" ? pathname === "/" || pathname === "" : pathname.startsWith(route);

  const notifCount = useNotifCount();
  const bottomPad = Math.max(insets.bottom, 6);

  return (
    <View style={{
      position: "absolute", bottom: 0, left: 0, right: 0,
      flexDirection: "row", backgroundColor: colors.card,
      borderTopWidth: 1, borderTopColor: colors.cardBorder,
      paddingTop: 8, paddingBottom: bottomPad,
      ...(Platform.OS === "web"
        ? { boxShadow: "0 -4px 24px rgba(0,0,0,0.18)" } as any
        : { elevation: 18, shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 10 }),
    }}>
      {TABS.map(tab => {
        const active = isActive(tab.route);
        const isPerfil = tab.route === "/perfil";
        const badge = isPerfil ? notifCount : 0;
        return (
          <TouchableOpacity
            key={tab.route}
            style={{ flex: 1, alignItems: "center", gap: 2 }}
            onPress={() => { if (!active) router.replace(tab.route as any); }}
            activeOpacity={0.7}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            {active && (
              <View style={{ position: "absolute", top: -8, width: 32, height: 3,
                borderRadius: 2, backgroundColor: "#1F6FEB" }} />
            )}
            <View style={{ position: "relative" }}>
              <Text style={{ fontSize: 22, opacity: active ? 1 : 0.45 }}>{tab.icon}</Text>
              {badge > 0 && (
                <View style={{
                  position: "absolute", top: -4, right: -6,
                  minWidth: 16, height: 16, borderRadius: 8,
                  backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center",
                  paddingHorizontal: 3,
                }}>
                  <Text style={{ color: "#fff", fontSize: 9, fontWeight: "900", lineHeight: 13 }}>
                    {badge > 99 ? "99+" : badge}
                  </Text>
                </View>
              )}
            </View>
            <Text style={{ fontSize: 10, fontWeight: active ? "800" : "500",
              color: active ? "#1F6FEB" : colors.textMuted, letterSpacing: -0.2 }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
