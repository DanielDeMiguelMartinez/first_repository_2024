import { useApp } from "@/app/services/i18n";
import { supabase } from "@/app/services/supabase";
import { useAvatar } from "@/app/services/useAvatar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, Image, Modal, Platform,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";

const { width: SW, height: SH } = Dimensions.get("window");
const LIKED_KEY = "nutri_liked_videos";

type Reel = {
  id: string;
  autor: string;
  autor_id: string;
  titulo: string;
  descripcion: string;
  video_url: string;
  likes: number;
  creado_en: string;
};

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ─── Reproductor de vídeo ─────────────────────────────────────────────────────
function VideoPlayer({ url, active, muted, onToggleMute, onPress }: {
  url: string; active: boolean; muted: boolean;
  onToggleMute: () => void; onPress: () => void;
}) {
  const ref = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;
    if (active) ref.current.play?.().catch(() => {});
    else { ref.current.pause?.(); ref.current.currentTime = 0; }
  }, [active]);

  useEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;
    ref.current.muted = muted;
  }, [muted]);

  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {(React.createElement as any)("video", {
          ref,
          src: url,
          style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
          muted: true,
          loop: true,
          playsInline: true,
          onClick: onPress,
        })}
        <TouchableOpacity style={s.muteBtn} onPress={onToggleMute}>
          <Text style={{ fontSize: 18 }}>{muted ? "🔇" : "🔊"}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}
      activeOpacity={1} onPress={onPress}
    >
      <Text style={{ fontSize: 52 }}>🎬</Text>
      <Text style={{ color: "#aaa", fontSize: 13, marginTop: 10, textAlign: "center", paddingHorizontal: 32 }}>
        Abre en la app nativa para reproducir vídeos
      </Text>
    </TouchableOpacity>
  );
}

// ─── Tarjeta de reel (pantalla completa) ──────────────────────────────────────
function ReelItem({ reel, active, muted, onToggleMute, liked, onLike, seguido, onFollow, esMio, onDelete }: {
  reel: Reel; active: boolean; muted: boolean; onToggleMute: () => void;
  liked: boolean; onLike: () => void;
  seguido: boolean; onFollow: () => void;
  esMio: boolean; onDelete: () => void;
}) {
  const [showDesc, setShowDesc] = useState(false);
  return (
    <View style={{ width: SW, height: SH, backgroundColor: "#000" }}>
      <VideoPlayer
        url={reel.video_url} active={active} muted={muted}
        onToggleMute={onToggleMute} onPress={() => setShowDesc(v => !v)}
      />
      {/* Gradiente inferior */}
      <View style={s.gradient} pointerEvents="none" />

      {/* Info inferior izquierda */}
      <View style={s.bottomInfo} pointerEvents="none">
        <Text style={s.autor}>@{reel.autor}</Text>
        <Text style={s.titulo}>{reel.titulo}</Text>
        {showDesc && reel.descripcion ? (
          <Text style={s.desc}>{reel.descripcion}</Text>
        ) : null}
        <Text style={s.time}>{timeAgo(reel.creado_en)}</Text>
      </View>

      {/* Acciones derecha */}
      <View style={s.actions}>
        {esMio ? (
          <TouchableOpacity style={s.actionBtn} onPress={onDelete}>
            <Text style={s.actionIcon}>🗑️</Text>
            <Text style={s.actionLabel}>Borrar</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.actionBtn} onPress={onFollow}>
            <View style={[s.followCircle, seguido && s.followCircleActive]}>
              <Text style={{ fontSize: 18 }}>{seguido ? "✓" : "+"}</Text>
            </View>
            <Text style={s.actionLabel}>{seguido ? "Siguiendo" : "Seguir"}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.actionBtn} onPress={onLike}>
          <Text style={s.actionIcon}>{liked ? "❤️" : "🤍"}</Text>
          <Text style={s.actionLabel}>{reel.likes + (liked ? 1 : 0)}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Modal subir vídeo ────────────────────────────────────────────────────────
function ModalSubir({ visible, onClose, onSubido, nombreUsuario, userId }: {
  visible: boolean; onClose: () => void; onSubido: () => void;
  nombreUsuario: string; userId: string;
}) {
  const { colors } = useApp();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [videoFile, setVideoFile] = useState<any>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const seleccionar = () => {
    if (Platform.OS !== "web") {
      Alert.alert("Próximamente", "La subida desde app nativa estará disponible pronto.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/mp4,video/webm,video/quicktime";
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      if (file.size > 200 * 1024 * 1024) {
        Alert.alert("Demasiado grande", "El vídeo debe pesar menos de 200 MB.");
        return;
      }
      setVideoFile(file);
      setPreview(URL.createObjectURL(file));
    };
    input.click();
  };

  const subir = async () => {
    if (!videoFile) { Alert.alert("", "Selecciona un vídeo primero."); return; }
    if (!titulo.trim()) { Alert.alert("", "Escribe un título."); return; }
    if (!userId) { Alert.alert("Error", "Debes iniciar sesión."); return; }

    setSubiendo(true); setProgreso(5);
    const ext = videoFile.name?.split(".").pop() ?? "mp4";
    const path = `${userId}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("videos")
      .upload(path, videoFile, { contentType: videoFile.type, upsert: false });

    if (upErr) {
      setSubiendo(false);
      Alert.alert("Error al subir", upErr.message);
      return;
    }
    setProgreso(75);

    const { data: { publicUrl } } = supabase.storage.from("videos").getPublicUrl(path);
    const { error: dbErr } = await supabase.from("videos_recetas").insert([{
      autor: nombreUsuario || "Anónimo",
      autor_id: userId,
      titulo: titulo.trim(),
      descripcion: descripcion.trim(),
      video_url: publicUrl,
      likes: 0,
    }]);

    setSubiendo(false);
    if (dbErr) { Alert.alert("Error", dbErr.message); return; }

    setProgreso(100);
    Alert.alert("✓ Publicado", "Tu reel ya está visible en la comunidad 🎉");
    setTitulo(""); setDescripcion(""); setVideoFile(null); setPreview(null);
    onSubido(); onClose();
  };

  const m = makeSubirStyles(colors);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={m.safe}>
        <View style={m.header}>
          <TouchableOpacity onPress={onClose}><Text style={m.close}>✕ Cerrar</Text></TouchableOpacity>
          <Text style={m.title}>📹 Nuevo Reel</Text>
          <Text style={m.subtitle}>Comparte tu receta en vídeo corto</Text>
        </View>
        <ScrollView style={m.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={[m.picker, preview && m.pickerFull]} onPress={seleccionar}>
            {preview
              ? Platform.OS === "web"
                ? (React.createElement as any)("video", {
                    src: preview,
                    style: { width: "100%", height: 260, objectFit: "cover", borderRadius: 14 },
                    muted: true, loop: true, autoPlay: true, playsInline: true,
                  })
                : <View style={m.placeholder}><Text style={m.pickerIcon}>🎬</Text><Text style={m.pickerText}>Vídeo seleccionado</Text></View>
              : <View style={m.placeholder}>
                  <Text style={m.pickerIcon}>📹</Text>
                  <Text style={m.pickerText}>Toca para seleccionar vídeo</Text>
                  <Text style={m.pickerHint}>MP4 · WebM · MOV · máx. 200 MB</Text>
                </View>
            }
          </TouchableOpacity>

          <TextInput
            style={m.input} value={titulo} onChangeText={setTitulo}
            placeholder="Título del reel..." placeholderTextColor={colors.textMuted}
            maxLength={80}
          />
          <TextInput
            style={[m.input, { height: 80 }]} value={descripcion} onChangeText={setDescripcion}
            placeholder="Descripción opcional (ingredientes, consejos...)"
            placeholderTextColor={colors.textMuted} multiline numberOfLines={3} maxLength={250}
          />

          {subiendo && (
            <View style={m.progressWrap}>
              <View style={[m.progressBar, { width: `${progreso}%` as any }]} />
              <Text style={m.progressText}>Subiendo {progreso}%...</Text>
            </View>
          )}

          <TouchableOpacity
            style={[m.btn, (!videoFile || subiendo) && m.btnDis]}
            onPress={subir} disabled={!videoFile || subiendo}
          >
            {subiendo
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={m.btnText}>🎬 Publicar Reel</Text>
            }
          </TouchableOpacity>
          <View style={{ height: 60 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function ReelsScreen() {
  const router = useRouter();
  const { colors, theme } = useApp();
  const avatarUri = useAvatar();
  const [tab, setTab] = useState<"parati" | "amigos">("parati");
  const [reels, setReels] = useState<Reel[]>([]);
  const [amigosReels, setAmigosReels] = useState<Reel[]>([]);
  const [cargando, setCargando] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [muted, setMuted] = useState(true);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [seguidosIds, setSeguidosIds] = useState<Set<string>>(new Set());
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [userId, setUserId] = useState("");
  const [modalSubir, setModalSubir] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState<Reel | null>(null);

  useFocusEffect(useCallback(() => {
    cargarDatos();
  }, [tab]));

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const { data: sesion } = await supabase.auth.getSession();
      const uid = sesion.session?.user?.id ?? "";
      if (uid && !userId) setUserId(uid);

      if (uid) {
        const { data: p } = await supabase.from("perfiles").select("nombre").eq("id", uid).single();
        if (p?.nombre) setNombreUsuario(p.nombre);

        const { data: segs } = await supabase.from("seguidos").select("followed_id").eq("follower_id", uid);
        setSeguidosIds(new Set((segs ?? []).map((s: any) => s.followed_id)));
      }

      const liked = await AsyncStorage.getItem(LIKED_KEY);
      setLikedIds(new Set(liked ? JSON.parse(liked) : []));

      if (tab === "parati") {
        const { data } = await supabase.from("videos_recetas").select("*").order("creado_en", { ascending: false });
        setReels((data ?? []).filter((r: any) => r.video_url));
      } else {
        const { data: segs } = await supabase.from("seguidos").select("followed_id").eq("follower_id", uid);
        const ids = (segs ?? []).map((s: any) => s.followed_id);
        if (ids.length > 0) {
          const { data } = await supabase.from("videos_recetas").select("*").in("autor_id", ids).order("creado_en", { ascending: false });
          setAmigosReels((data ?? []).filter((r: any) => r.video_url));
        } else {
          setAmigosReels([]);
        }
      }
    } finally {
      setCargando(false);
    }
  };

  const handleLike = async (reel: Reel) => {
    const already = likedIds.has(reel.id);
    const next = new Set(likedIds);
    if (already) {
      next.delete(reel.id);
      await supabase.from("videos_recetas").update({ likes: Math.max(0, reel.likes - 1) }).eq("id", reel.id);
    } else {
      next.add(reel.id);
      await supabase.from("videos_recetas").update({ likes: reel.likes + 1 }).eq("id", reel.id);
    }
    setLikedIds(next);
    await AsyncStorage.setItem(LIKED_KEY, JSON.stringify([...next]));
    // Update local state so counter reacts instantly
    const update = (list: Reel[]) => list.map(r => r.id === reel.id ? { ...r, likes: already ? Math.max(0, r.likes - 1) : r.likes + 1 } : r);
    setReels(update); setAmigosReels(update);
  };

  const handleFollow = async (reel: Reel) => {
    if (!userId) return;
    const siguiendo = seguidosIds.has(reel.autor_id);
    const next = new Set(seguidosIds);
    if (siguiendo) {
      await supabase.from("seguidos").delete().eq("follower_id", userId).eq("followed_id", reel.autor_id);
      next.delete(reel.autor_id);
    } else {
      await supabase.from("seguidos").insert([{
        follower_id: userId, follower_nombre: nombreUsuario,
        followed_id: reel.autor_id, followed_nombre: reel.autor,
      }]);
      next.add(reel.autor_id);
    }
    setSeguidosIds(next);
  };

  const handleDelete = async (reel: Reel) => {
    try {
      const url = new URL(reel.video_url);
      const parts = url.pathname.split("/videos/");
      if (parts[1]) await supabase.storage.from("videos").remove([decodeURIComponent(parts[1])]);
    } catch {}
    await supabase.from("videos_recetas").delete().eq("id", reel.id);
    setConfirmarBorrar(null);
    cargarDatos();
  };

  const lista = tab === "parati" ? reels : amigosReels;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Feed */}
      {cargando ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : lista.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 40 }}>
          <Text style={{ fontSize: 64, textAlign: "center" }}>{tab === "amigos" ? "👥" : "🎬"}</Text>
          <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 20, textAlign: "center" }}>
            {tab === "amigos" ? "Sigue a alguien primero" : "Sin reels todavía"}
          </Text>
          <Text style={{ color: "#94A3B8", fontSize: 14, marginTop: 10, textAlign: "center", lineHeight: 22 }}>
            {tab === "amigos"
              ? "Ve a «Para ti», mira los reels de otros y toca el botón ＋ para seguirlos"
              : "Sé el primero en compartir tu receta en vídeo corto"}
          </Text>
          {tab === "parati" && (
            <TouchableOpacity
              style={{ marginTop: 28, backgroundColor: "#1F6FEB", borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 }}
              onPress={() => setModalSubir(true)}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>📹 Subir mi primer reel</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onScroll={e => setActiveIdx(Math.round(e.nativeEvent.contentOffset.y / SH))}
          scrollEventThrottle={16}
        >
          {lista.map((reel, i) => (
            <ReelItem
              key={reel.id}
              reel={reel}
              active={i === activeIdx}
              muted={muted}
              onToggleMute={() => setMuted(v => !v)}
              liked={likedIds.has(reel.id)}
              onLike={() => handleLike(reel)}
              seguido={seguidosIds.has(reel.autor_id)}
              onFollow={() => handleFollow(reel)}
              esMio={reel.autor_id === userId}
              onDelete={() => setConfirmarBorrar(reel)}
            />
          ))}
        </ScrollView>
      )}

      {/* Header superpuesto */}
      <SafeAreaView style={s.headerWrap} pointerEvents="box-none">
        <View style={s.header} pointerEvents="box-none">
          <TouchableOpacity onPress={() => router.back()} style={s.headerSide}>
            <Text style={s.back}>← Volver</Text>
          </TouchableOpacity>
          <View style={s.tabs}>
            <TouchableOpacity onPress={() => { setTab("parati"); setActiveIdx(0); }}>
              <Text style={[s.tabTxt, tab === "parati" && s.tabTxtActive]}>Para ti</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setTab("amigos"); setActiveIdx(0); }}>
              <Text style={[s.tabTxt, tab === "amigos" && s.tabTxtActive]}>
                Amigos{seguidosIds.size > 0 ? ` (${seguidosIds.size})` : ""}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setModalSubir(true)} style={s.headerSide}>
            <Text style={s.uploadIcon}>＋</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Modal subir */}
      <ModalSubir
        visible={modalSubir}
        onClose={() => setModalSubir(false)}
        onSubido={cargarDatos}
        nombreUsuario={nombreUsuario}
        userId={userId}
      />

      {/* Confirmar borrar */}
      <Modal visible={!!confirmarBorrar} transparent animationType="fade" onRequestClose={() => setConfirmarBorrar(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmarBorrar(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>🗑️ Eliminar reel</Text>
            <Text style={s.popupSub}>¿Eliminar «{confirmarBorrar?.titulo}»? No se puede deshacer.</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.popupCancel} onPress={() => setConfirmarBorrar(null)}>
                <Text style={{ color: "#94A3B8", fontWeight: "700" }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.popupDelete} onPress={() => confirmarBorrar && handleDelete(confirmarBorrar)}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  headerWrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  headerSide: { minWidth: 60 },
  back: { color: "#fff", fontSize: 14, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  tabs: { flexDirection: "row", gap: 24, alignItems: "center" },
  tabTxt: { color: "rgba(255,255,255,0.55)", fontSize: 16, fontWeight: "700", paddingBottom: 2, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  tabTxtActive: { color: "#fff", borderBottomWidth: 2, borderBottomColor: "#fff" },
  uploadIcon: { color: "#fff", fontSize: 24, fontWeight: "300", textAlign: "right", textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  gradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 260, backgroundColor: "transparent",
    // gradient simulado con múltiples capas
  },
  bottomInfo: { position: "absolute", bottom: 32, left: 16, right: 80, gap: 4 },
  autor: { color: "#fff", fontWeight: "800", fontSize: 15, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  titulo: { color: "#fff", fontSize: 14, fontWeight: "600", textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  desc: { color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 17, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  time: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2 },
  actions: { position: "absolute", bottom: 28, right: 14, gap: 22, alignItems: "center" },
  actionBtn: { alignItems: "center", gap: 3 },
  actionIcon: { fontSize: 30, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  actionLabel: { color: "#fff", fontSize: 11, fontWeight: "700", textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  followCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 2, borderColor: "#fff", justifyContent: "center", alignItems: "center" },
  followCircleActive: { backgroundColor: "#1F6FEB", borderColor: "#1F6FEB" },
  muteBtn: { position: "absolute", top: 56, right: 12, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 22, width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  overlay: { flex: 1, backgroundColor: "#000000BB", justifyContent: "center", alignItems: "center", padding: 24 },
  popup: { backgroundColor: "#1E2533", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360 },
  popupTitle: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 8 },
  popupSub: { color: "#94A3B8", fontSize: 14, lineHeight: 20, marginBottom: 20 },
  popupBtns: { flexDirection: "row", gap: 12 },
  popupCancel: { flex: 1, backgroundColor: "#2D3748", borderRadius: 12, padding: 14, alignItems: "center" },
  popupDelete: { flex: 1, backgroundColor: "#EF4444", borderRadius: 12, padding: 14, alignItems: "center" },
});

function makeSubirStyles(colors: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 4 },
    close: { color: "#58A6FF", fontSize: 14 },
    title: { color: colors.text, fontSize: 24, fontWeight: "900" },
    subtitle: { color: colors.textMuted, fontSize: 13 },
    scroll: { flex: 1, paddingHorizontal: 16 },
    picker: { borderWidth: 2, borderColor: colors.cardBorder, borderStyle: "dashed" as const, borderRadius: 16, marginBottom: 16, overflow: "hidden", backgroundColor: colors.card },
    pickerFull: { borderStyle: "solid" as const, borderColor: "#1F6FEB" },
    placeholder: { height: 200, justifyContent: "center", alignItems: "center", gap: 10 },
    pickerIcon: { fontSize: 52 },
    pickerText: { color: colors.text, fontSize: 16, fontWeight: "700" },
    pickerHint: { color: colors.textMuted, fontSize: 12 },
    input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 12, padding: 14, color: colors.text, fontSize: 15, marginBottom: 12 },
    progressWrap: { backgroundColor: colors.card, borderRadius: 8, overflow: "hidden", height: 8, marginBottom: 8 },
    progressBar: { height: 8, backgroundColor: "#1F6FEB", borderRadius: 8 },
    progressText: { color: colors.textMuted, fontSize: 11, textAlign: "center", marginBottom: 12 },
    btn: { backgroundColor: "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 8 },
    btnDis: { opacity: 0.45 },
    btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  });
}
