import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Image, Platform, ScrollView,
  Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "./services/i18n";
import { supabase } from "./services/supabase";
import { BottomTabBar, TAB_BAR_HEIGHT } from "./services/BottomTabBar";
import { resetNotifCount } from "./services/useNotifCount";

type TipoNotif = "comentario" | "comentario_reel" | "solicitud" | "nuevo_seguidor" | "solicitud_aceptada";

type Notif = {
  id: string;
  tipo: TipoNotif;
  de_id: string;
  de_nombre: string;
  de_avatar?: string | null;
  referencia_id?: string | null;
  referencia_nombre?: string | null;
  contenido?: string | null;
  leida: boolean;
  creado_en: string;
};

const AVATAR_COLORS = ["#EF4444","#F97316","#EAB308","#22C55E","#3B82F6","#8B5CF6","#EC4899"];

function timeAgo(dateStr: string, justNow: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return justNow;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function iconForTipo(tipo: TipoNotif): string {
  switch (tipo) {
    case "comentario":         return "💬";
    case "comentario_reel":    return "🎬";
    case "solicitud":          return "👤";
    case "nuevo_seguidor":     return "➕";
    case "solicitud_aceptada": return "✅";
  }
}

function textoForNotif(n: Notif & { contenido?: string }, t: { commentedYourRecipe: string; wantsToFollow: string; startedFollowing: string; acceptedFollowRequest: string }): string {
  switch (n.tipo) {
    case "comentario":
      return `${t.commentedYourRecipe}${n.referencia_nombre ? ` "${n.referencia_nombre}"` : ""}`;
    case "comentario_reel":
      return n.contenido || t.commentedYourRecipe;
    case "solicitud":
      return t.wantsToFollow;
    case "nuevo_seguidor":
      return t.startedFollowing;
    case "solicitud_aceptada":
      return t.acceptedFollowRequest;
  }
}

export default function NotificacionesScreen() {
  const { colors, t } = useApp();
  const router = useRouter();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [cargando, setCargando] = useState(true);
  const [userId, setUserId] = useState("");
  const [myNombre, setMyNombre] = useState("");
  const [myAvatar, setMyAvatar] = useState<string | null>(null);

  const abrirNotif = (n: Notif) => {
    if (n.tipo === "comentario" && n.referencia_id) {
      router.push(`/receta/${n.referencia_id}` as any);
    } else if (n.tipo === "comentario_reel") {
      router.push("/reels" as any);
    } else if (n.tipo === "nuevo_seguidor" || n.tipo === "solicitud_aceptada") {
      if (n.de_id) router.push(`/usuario/${n.de_id}` as any);
    }
  };

  useFocusEffect(useCallback(() => {
    cargar();
  }, []));

  // Suscripción en tiempo real: nuevas notificaciones aparecen sin recargar
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifs-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notificaciones", filter: `usuario_id=eq.${userId}` },
        (payload) => {
          setNotifs(prev => {
            if (prev.some(n => n.id === payload.new.id)) return prev;
            return [payload.new as Notif, ...prev];
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const cargar = async () => {
    setCargando(true);
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id ?? "";
      setUserId(uid);
      if (!uid) { setCargando(false); return; }

      const [{ data: perf }, { data }] = await Promise.all([
        supabase.from("perfiles").select("nombre,avatar_url").eq("id", uid).single(),
        supabase.from("notificaciones")
          .select("*")
          .eq("usuario_id", uid)
          .order("creado_en", { ascending: false })
          .limit(60),
      ]);
      setMyNombre(perf?.nombre ?? "");
      setMyAvatar(perf?.avatar_url ?? null);
      setNotifs((data ?? []) as Notif[]);

      // Marcar todas como leídas en segundo plano y resetear badge
      supabase.from("notificaciones")
        .update({ leida: true })
        .eq("usuario_id", uid)
        .eq("leida", false)
        .then(() => { resetNotifCount(); });
    } catch {}
    setCargando(false);
  };

  const aceptarSolicitud = async (notif: Notif) => {
    try {
      await Promise.all([
        supabase.from("solicitudes_seguimiento")
          .update({ estado: "aceptada" })
          .eq("solicitante_id", notif.de_id)
          .eq("destinatario_id", userId),
        supabase.from("seguidos").upsert([{
          follower_id: notif.de_id,
          followed_id: userId,
        }]),
      ]);
      // Notificar al solicitante que fue aceptado
      await supabase.from("notificaciones").insert([{
        usuario_id: notif.de_id,
        tipo: "solicitud_aceptada",
        de_id: userId,
        de_nombre: myNombre || t.someone,
        de_avatar: myAvatar,
      }]);
      // Eliminar esta notificación
      await supabase.from("notificaciones").delete().eq("id", notif.id);
      setNotifs(prev => prev.filter(n => n.id !== notif.id));
    } catch {}
  };

  const rechazarSolicitud = async (notif: Notif) => {
    try {
      await supabase.from("solicitudes_seguimiento")
        .update({ estado: "rechazada" })
        .eq("solicitante_id", notif.de_id)
        .eq("destinatario_id", userId);
      await supabase.from("notificaciones").delete().eq("id", notif.id);
      setNotifs(prev => prev.filter(n => n.id !== notif.id));
    } catch {}
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
        borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: "900" }}>{t.notificationsTitle}</Text>
        {notifs.length > 0 && (
          <TouchableOpacity onPress={async () => {
            try {
              await supabase.from("notificaciones").delete().eq("usuario_id", userId);
              setNotifs([]);
            } catch {}
          }}>
            <Text style={{ color: "#EF4444", fontSize: 13, fontWeight: "700" }}>{t.clearAll}</Text>
          </TouchableOpacity>
        )}
      </View>

      {cargando ? (
        <ActivityIndicator color="#1F6FEB" size="large" style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14,
          paddingBottom: TAB_BAR_HEIGHT + 20 }}>

          {notifs.length === 0 && (
            <View style={{ alignItems: "center", paddingTop: 80, gap: 14 }}>
              <Text style={{ fontSize: 58 }}>🔔</Text>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>{t.noNotifications}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", paddingHorizontal: 32 }}>
                {t.notificationsHint}
              </Text>
            </View>
          )}

          {notifs.map(n => {
            const aColor = AVATAR_COLORS[(n.de_nombre?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
            const esSolicitud = n.tipo === "solicitud";
            const esTocable = (n.tipo === "comentario" && !!n.referencia_id) ||
              n.tipo === "comentario_reel" || n.tipo === "nuevo_seguidor" || n.tipo === "solicitud_aceptada";
            const Wrapper = esTocable ? TouchableOpacity : View;
            return (
              <Wrapper key={n.id} onPress={esTocable ? () => abrirNotif(n) : undefined} activeOpacity={0.75}
                style={{ flexDirection: "row", alignItems: "flex-start",
                  backgroundColor: n.leida ? colors.card : "#1F6FEB0E",
                  borderRadius: 18, padding: 14, marginBottom: 10, gap: 12,
                  borderWidth: 1.5,
                  borderColor: n.leida ? colors.cardBorder : "#1F6FEB55" }}>

                {/* Avatar + icono tipo */}
                <View style={{ position: "relative" }}>
                  <View style={{ width: 50, height: 50, borderRadius: 25, overflow: "hidden",
                    backgroundColor: aColor, alignItems: "center", justifyContent: "center" }}>
                    {n.de_avatar
                      ? Platform.OS === "web"
                        ? (React.createElement as any)("img", {
                            src: n.de_avatar,
                            style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
                          })
                        : <Image source={{ uri: n.de_avatar }} style={{ width: 50, height: 50 }} resizeMode="cover" />
                      : <Text style={{ color: "#fff", fontSize: 21, fontWeight: "900" }}>
                          {(n.de_nombre?.[0] ?? "?").toUpperCase()}
                        </Text>
                    }
                  </View>
                  {/* Badge de tipo */}
                  <View style={{ position: "absolute", bottom: -3, right: -3, width: 22, height: 22,
                    borderRadius: 11, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center",
                    borderWidth: 1.5, borderColor: colors.cardBorder }}>
                    <Text style={{ fontSize: 11 }}>{iconForTipo(n.tipo)}</Text>
                  </View>
                </View>

                {/* Contenido */}
                <View style={{ flex: 1, gap: 5 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 }}>
                      <Text style={{ fontWeight: "800" }}>{n.de_nombre}</Text>
                      {" "}<Text style={{ color: colors.textSub }}>{textoForNotif(n, t)}</Text>
                    </Text>
                    {!n.leida && (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#1F6FEB", marginLeft: 8 }} />
                    )}
                  </View>

                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{timeAgo(n.creado_en, t.justNow)}</Text>

                  {/* Botones aceptar/rechazar solicitud */}
                  {esSolicitud && (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                      <TouchableOpacity onPress={() => aceptarSolicitud(n)}
                        style={{ flex: 1, backgroundColor: "#1F6FEB", borderRadius: 12,
                          paddingVertical: 9, alignItems: "center" }}>
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{t.accept}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => rechazarSolicitud(n)}
                        style={{ flex: 1, backgroundColor: "transparent", borderRadius: 12,
                          paddingVertical: 9, alignItems: "center",
                          borderWidth: 1.5, borderColor: colors.cardBorder }}>
                        <Text style={{ color: colors.textMuted, fontWeight: "700", fontSize: 13 }}>{t.reject}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </Wrapper>
            );
          })}
        </ScrollView>
      )}

      <BottomTabBar />
    </SafeAreaView>
  );
}
