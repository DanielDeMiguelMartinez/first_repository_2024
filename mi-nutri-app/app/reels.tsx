import { useApp } from "@/app/services/i18n";
import { crearReceta, supabase } from "@/app/services/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, Dimensions, Modal, PanResponder,
  Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const { width: SW } = Dimensions.get("window");
const LIKED_KEY          = "nutri_liked_videos";
const LIKED_HASHTAGS_KEY = "nutri_liked_hashtags";

// Filtros disponibles — usado tanto en ModalSubir (cámara) como en VideoPlayer (playback web)
const FILTERS = [
  { name: "Normal",  icon: "○",  webCss: "",                                               overlay: "transparent", opacity: 0 },
  { name: "Vivido",  icon: "🌈", webCss: "saturate(1.9) contrast(1.1)",                    overlay: "#FF4400",     opacity: 0.06 },
  { name: "Cálido",  icon: "🌅", webCss: "sepia(0.35) saturate(1.5) brightness(1.05)",     overlay: "#FF7700",     opacity: 0.10 },
  { name: "Frío",    icon: "❄️", webCss: "hue-rotate(20deg) saturate(1.3) brightness(1.02)", overlay: "#3388FF",   opacity: 0.08 },
  { name: "B&N",     icon: "◑",  webCss: "grayscale(1) contrast(1.15)",                   overlay: "#888888",     opacity: 0.30 },
  { name: "Fade",    icon: "☁️", webCss: "brightness(1.15) contrast(0.8) saturate(0.7)",  overlay: "#ffffff",     opacity: 0.14 },
  { name: "Cine",    icon: "🎞️", webCss: "contrast(1.25) brightness(0.88) saturate(1.4)", overlay: "#000000",     opacity: 0.10 },
];

type Reel = {
  id: string; autor: string; autor_id: string;
  titulo: string; descripcion: string; video_url: string;
  likes: number; views: number; creado_en: string;
  hashtags: string[]; filtro?: string; camara_frontal?: boolean;
};

// ── Algoritmo de engagement ───────────────────────────────────────────────────
// Mezcla recencia, tasa de engagement (likes/vistas), popularidad absoluta
// y personalización (si el usuario ha interactuado con esos hashtags antes).
function scoreReel(reel: Reel, likedHashtagSet: Set<string>): number {
  const ageHours  = (Date.now() - new Date(reel.creado_en).getTime()) / 3_600_000;
  const recency   = Math.exp(-ageHours / 72);                                    // semivida 3 días
  const likesScore = Math.log1p(reel.likes) / 8;                                 // escala log
  const viewsScore = Math.log1p(reel.views) / 10;
  const engRate    = reel.views > 5 ? Math.min(reel.likes / reel.views, 1) : 0;  // viral boost
  const personal   = reel.hashtags?.some(h => likedHashtagSet.has(h)) ? 0.10 : 0;
  return recency * 0.40 + likesScore * 0.20 + engRate * 0.25 + viewsScore * 0.05 + personal;
}
type RecetaItem = { id: string; nombre: string; descripcion?: string };

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ─── Reproductor ──────────────────────────────────────────────────────────────
function VideoPlayer({ url, active, muted, onToggleMute, filtro, camaraFrontal }: {
  url: string; active: boolean; muted: boolean; onToggleMute: () => void;
  filtro?: string; camaraFrontal?: boolean;
}) {
  const filterCss = filtro ? (FILTERS.find(f => f.name === filtro)?.webCss ?? "") : "";
  const ref = useRef<any>(null);
  const fsRef = useRef<any>(null);
  const [webFullscreen, setWebFullscreen] = useState(false);

  // Play / pause según si el reel está activo
  useEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;
    if (active) {
      ref.current.muted = muted;
      // Intentar con audio; si el navegador bloquea, fallback a silencio
      ref.current.play?.().catch(() => {
        ref.current.muted = true;
        ref.current.play?.().catch(() => {});
      });
    } else {
      ref.current.pause?.();
      ref.current.currentTime = 0;
    }
  }, [active]);

  // Al abrir fullscreen: sincronizar posición y arrancar
  useEffect(() => {
    if (Platform.OS !== "web" || !webFullscreen || !fsRef.current) return;
    if (ref.current) fsRef.current.currentTime = ref.current.currentTime ?? 0;
    fsRef.current.muted = muted;
    fsRef.current.play?.().catch(() => {});
  }, [webFullscreen]);

  // Mute / unmute sin recargar el vídeo — al dessilenciar, forzar play con audio
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (ref.current) {
      ref.current.muted = muted;
      // Si se acaba de dessilenciar y el vídeo está activo, reintentar play con audio
      if (!muted && active) {
        ref.current.play?.().catch(() => { ref.current.muted = true; });
      }
    }
    if (fsRef.current) fsRef.current.muted = muted;
  }, [muted]);

  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {(React.createElement as any)("video", {
          ref,
          src: url,
          preload: active ? "auto" : "metadata",
          style: {
            width: "100%", height: "100%",
            objectFit: "cover",
            display: "block",
            backgroundColor: "#000",
            // Hardware acceleration para máxima nitidez
            willChange: "transform",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            ...(filterCss ? { filter: filterCss } : {}),
            ...(camaraFrontal ? { transform: "scaleX(-1)", WebkitTransform: "scaleX(-1)" } : {}),
          },
          muted: muted,
          loop: true,
          playsInline: true,
          // onCanPlay: arranca en cuanto hay datos suficientes sin esperar el efecto de React
          onCanPlay: (e: any) => {
            if (active) {
              e.target.play?.().catch(() => {
                e.target.muted = true;
                e.target.play?.().catch(() => {});
              });
            }
          },
        })}
        {/* Hint "toca para activar audio" — visible solo cuando está silenciado */}
        {muted && (
          <TouchableOpacity
            style={{ position: "absolute", top: 16, alignSelf: "center", left: 0, right: 0, alignItems: "center" }}
            onPress={onToggleMute}
            activeOpacity={0.7}>
            <View style={{ backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 16 }}>🔇</Text>
              <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>Toca para activar audio</Text>
            </View>
          </TouchableOpacity>
        )}
        {/* Controles superpuestos */}
        <View style={vid.controls} pointerEvents="box-none">
          <TouchableOpacity style={vid.btn} onPress={onToggleMute}>
            <Text style={vid.btnTxt}>{muted ? "🔇" : "🔊"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={vid.btn} onPress={() => setWebFullscreen(true)}>
            <Text style={vid.btnTxt}>⛶</Text>
          </TouchableOpacity>
        </View>
        {/* Fullscreen personalizado — conserva el filtro CSS */}
        {webFullscreen && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setWebFullscreen(false)}>
            <View style={{ flex: 1, backgroundColor: "#000" }}>
              {(React.createElement as any)("video", {
                ref: fsRef,
                src: url,
                style: {
                  width: "100%", height: "100%",
                  objectFit: "contain",
                  display: "block",
                  ...(filterCss ? { filter: filterCss } : {}),
                },
                muted: true,
                loop: true,
                autoPlay: true,
                playsInline: true,
              })}
              <View style={{ position: "absolute", top: 48, right: 14, gap: 10 }}>
                <TouchableOpacity style={vid.btn} onPress={onToggleMute}>
                  <Text style={vid.btnTxt}>{muted ? "🔇" : "🔊"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={vid.btn} onPress={() => setWebFullscreen(false)}>
                  <Text style={vid.btnTxt}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 52 }}>🎬</Text>
      <Text style={{ color: "#aaa", fontSize: 13, marginTop: 10, textAlign: "center", paddingHorizontal: 32 }}>
        Reproducción disponible en la web
      </Text>
    </View>
  );
}

const vid = StyleSheet.create({
  controls: { position: "absolute", top: 52, right: 10, gap: 8 },
  btn: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 22, width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  btnTxt: { fontSize: 17 },
});

// ─── Tarjeta de reel (pantalla completa) ──────────────────────────────────────
function ReelItem({ reel, active, muted, onToggleMute, liked, onLike, seguido, onFollow, esMio, onDelete, onVerReceta }: {
  reel: Reel; active: boolean; muted: boolean; onToggleMute: () => void;
  liked: boolean; onLike: () => void; seguido: boolean; onFollow: () => void;
  esMio: boolean; onDelete: () => void; onVerReceta: () => void;
}) {
  const { width: SW, height: SH } = useWindowDimensions();
  const [showDesc, setShowDesc] = useState(false);

  return (
    <View style={{ width: SW, height: SH, backgroundColor: "#000" }}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowDesc(v => !v)}>
        <VideoPlayer url={reel.video_url} active={active} muted={muted} onToggleMute={onToggleMute} filtro={reel.filtro} camaraFrontal={reel.camara_frontal || reel.hashtags?.includes("__cf__")} />
      </TouchableOpacity>

      {/* Sombra inferior */}
      <View style={[r.shadow, { background: "linear-gradient(transparent,rgba(0,0,0,0.85))" } as any]} pointerEvents="none" />

      {/* Info izquierda abajo */}
      <View style={r.info} pointerEvents="none">
        <Text style={r.autor}>@{reel.autor}</Text>
        <Text style={r.titulo}>🍽 {reel.titulo}</Text>
        {showDesc && reel.descripcion ? (
          <Text style={r.desc}>{reel.descripcion}</Text>
        ) : reel.descripcion ? (
          <Text style={r.hint}>Toca para ver descripción</Text>
        ) : null}
        {reel.hashtags?.filter(h => h !== "__cf__").length > 0 && (
          <Text style={r.hashtags} numberOfLines={1}>
            {reel.hashtags.filter(h => h !== "__cf__").slice(0, 5).map(h => `#${h}`).join(" ")}
          </Text>
        )}
        <Text style={r.time}>{timeAgo(reel.creado_en)} · {reel.views ?? 0} vistas</Text>
      </View>

      {/* Acciones derecha */}
      <View style={r.actions}>
        {esMio ? (
          <TouchableOpacity style={r.actionBtn} onPress={onDelete}>
            <Text style={r.actionIcon}>🗑️</Text>
            <Text style={r.actionLbl}>Borrar</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={r.actionBtn} onPress={onFollow}>
            <View style={[r.circle, seguido && r.circleActive]}>
              <Text style={{ fontSize: 20, color: "#fff" }}>{seguido ? "✓" : "+"}</Text>
            </View>
            <Text style={r.actionLbl}>{seguido ? "Siguiendo" : "Seguir"}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={r.actionBtn} onPress={onLike}>
          <Text style={r.actionIcon}>{liked ? "❤️" : "🤍"}</Text>
          <Text style={r.actionLbl}>{reel.likes}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={r.actionBtn} onPress={onVerReceta}>
          <Text style={r.actionIcon}>📋</Text>
          <Text style={r.actionLbl}>Receta</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const r = StyleSheet.create({
  shadow: { position: "absolute", bottom: 0, left: 0, right: 0, height: 280 },
  info: { position: "absolute", bottom: 30, left: 14, right: 80, gap: 5 },
  autor: { color: "#fff", fontWeight: "800", fontSize: 15, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  titulo: { color: "#fff", fontWeight: "700", fontSize: 14, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  desc: { color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 17 },
  hint:     { color: "rgba(255,255,255,0.4)", fontSize: 11 },
  hashtags: { color: "#60A5FA", fontSize: 12, fontWeight: "600", textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  time:     { color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 2 },
  actions: { position: "absolute", bottom: 24, right: 12, gap: 20, alignItems: "center" },
  actionBtn: { alignItems: "center", gap: 3 },
  actionIcon: { fontSize: 30, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  actionLbl: { color: "#fff", fontSize: 11, fontWeight: "700", textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  circle: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 2, borderColor: "#fff", justifyContent: "center", alignItems: "center" },
  circleActive: { backgroundColor: "#1F6FEB", borderColor: "#1F6FEB" },
});

// ─── Modal subir reel — 3 pasos: Receta → Cámara → Detalles ──────────────────
function ModalSubir({ visible, onClose, onSubido, nombreUsuario, userId, recetaPrevia }: {
  visible: boolean; onClose: () => void; onSubido: () => void;
  nombreUsuario: string; userId: string; recetaPrevia?: string;
}) {
  const { colors } = useApp();
  const [step, setStep] = useState<"receta" | "camara" | "detalles">("receta");

  // ── Paso 1: Receta ────────────────────────────────────────────────────────
  const [recetas, setRecetas] = useState<RecetaItem[]>([]);
  const [recetaElegida, setRecetaElegida] = useState(recetaPrevia ?? "");
  const [modoCrear, setModoCrear] = useState(false);
  const [nuevaNombre, setNuevaNombre] = useState("");
  const [nuevaDesc, setNuevaDesc] = useState("");
  const [nuevaKcal, setNuevaKcal] = useState("");
  const [nuevaProt, setNuevaProt] = useState("");
  const [nuevaCarbos, setNuevaCarbos] = useState("");
  const [nuevaGrasas, setNuevaGrasas] = useState("");
  const [guardandoReceta, setGuardandoReceta] = useState(false);

  // ── Paso 2: Cámara ────────────────────────────────────────────────────────
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const durTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [filterStripVisible, setFilterStripVisible] = useState(false);
  const [cameraTransition, setCameraTransition] = useState(false);
  const recBtnAnim = useRef(new Animated.Value(0)).current;
  const recBtnPR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !recording,
    onMoveShouldSetPanResponder: (_e, g) => !recording && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_e, g) => {
      if (g.dx > 0) recBtnAnim.setValue(Math.min(g.dx, 90));
    },
    onPanResponderRelease: (_e, g) => {
      if (g.dx > 40) setFilterStripVisible(v => !v);
      Animated.spring(recBtnAnim, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  // ── Paso 3: Detalles ──────────────────────────────────────────────────────
  const [videoFile, setVideoFile] = useState<any>(null);
  const [webPreview, setWebPreview] = useState<string | null>(null);
  const [flipH, setFlipH] = useState(false);          // voltear horizontalmente (cámara frontal)
  const [descripcion, setDescripcion] = useState("");
  const [hashtagsInput, setHashtagsInput] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState("Normal");

  // Cargar recetas al abrir
  useEffect(() => {
    if (!visible || !userId) return;
    supabase.from("recetas").select("id,nombre,descripcion")
      .order("creado_en", { ascending: false }).limit(100)
      .then(({ data }) => setRecetas((data ?? []) as RecetaItem[]));
    if (recetaPrevia) { setRecetaElegida(recetaPrevia); setStep("camara"); }
    else { setStep("receta"); setRecetaElegida(""); }
  }, [visible, userId, recetaPrevia]);

  // Pedir permisos en cuanto se abre el modal (no al cambiar de step)
  // Así al llegar al paso cámara ya están concedidos y se abre sola
  useEffect(() => {
    if (!visible || Platform.OS === "web") return;
    if (!camPerm?.granted) requestCamPerm();
    if (!micPerm?.granted) requestMicPerm();
  }, [visible]);

  const limpiar = () => {
    setStep("receta"); setRecetaElegida(""); setModoCrear(false);
    setNuevaNombre(""); setNuevaDesc(""); setNuevaKcal(""); setNuevaProt(""); setNuevaCarbos(""); setNuevaGrasas("");
    setRecording(false); setDuration(0); setCameraTransition(false);
    if (durTimerRef.current) clearInterval(durTimerRef.current);
    setVideoFile(null);
    if (webPreview) URL.revokeObjectURL(webPreview);
    setWebPreview(null); setFlipH(false);
    setDescripcion(""); setHashtagsInput(""); setSubiendo(false); setProgreso(0);
  };

  const cerrar = () => { limpiar(); onClose(); };
  const elegirReceta = (nombre: string) => { setRecetaElegida(nombre); setStep("camara"); };

  const guardarNuevaReceta = async () => {
    const nombre = nuevaNombre.trim();
    if (!nombre) return;
    setGuardandoReceta(true);
    await crearReceta({ nombre, descripcion: nuevaDesc.trim(), ingredientes: [],
      calorias_total: parseFloat(nuevaKcal) || 0, proteinas_total: parseFloat(nuevaProt) || 0,
      grasas_total: parseFloat(nuevaGrasas) || 0, carbohidratos_total: parseFloat(nuevaCarbos) || 0 });
    setGuardandoReceta(false);
    elegirReceta(nombre);
  };

  // ── Acciones cámara ───────────────────────────────────────────────────────
  const startRecording = async () => {
    if (!cameraRef.current || recording) return;
    setDuration(0); setRecording(true);
    durTimerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    try {
      const video = await (cameraRef.current as any).recordAsync({ maxDuration: 120 });
      if (durTimerRef.current) clearInterval(durTimerRef.current);
      setCameraTransition(true); // Ocultar cámara inmediatamente para evitar el "flip"
      setRecording(false);
      if (video?.uri) {
        const ext = (video.uri.split("/").pop()?.split(".").pop() ?? "mp4").split("?")[0].toLowerCase();
        setVideoFile({ uri: video.uri, type: `video/${ext}`, name: `reel.${ext}`, isNative: true, isFront: facing === "front" });
        setFlipH(true);
        setStep("detalles");
      }
    } catch {
      if (durTimerRef.current) clearInterval(durTimerRef.current);
      setCameraTransition(false);
      setRecording(false);
    }
  };

  const stopRecording = () => {
    setCameraTransition(true); // Pantalla negra inmediata → elimina el "flip" al parar
    (cameraRef.current as any)?.stopRecording?.();
    if (durTimerRef.current) clearInterval(durTimerRef.current);
  };

  const pickGallery = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "video/*";
      input.onchange = (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        if (file.size > 500 * 1024 * 1024) { Alert.alert("Demasiado grande", "Máx. 500 MB."); return; }
        if (webPreview) URL.revokeObjectURL(webPreview);
        setVideoFile(file); setWebPreview(URL.createObjectURL(file));
        setStep("detalles");
      };
      input.click();
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Sin permiso", "Necesitamos acceso a tu galería."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "videos", allowsEditing: false, quality: 1 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const ext = (asset.fileName ?? "video.mp4").split(".").pop() ?? "mp4";
    setVideoFile({ uri: asset.uri, type: asset.mimeType ?? `video/${ext}`, name: asset.fileName ?? `video.${ext}`, isNative: true });
    setStep("detalles");
  };

  const fmtDur = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const curFilter = FILTERS.find(f => f.name === selectedFilter) ?? FILTERS[0];

  const subir = async () => {
    if (!videoFile) { Alert.alert("Sin vídeo", "Graba o selecciona un vídeo primero."); return; }
    if (!recetaElegida.trim()) { Alert.alert("Sin receta", "Vuelve al paso 1 y elige una receta."); return; }
    if (!userId) { Alert.alert("Sesión caducada", "Cierra y vuelve a abrir la app."); return; }
    setSubiendo(true); setProgreso(5);
    try {
      // Verificar que no existe ya un reel del mismo usuario para esta receta
      const { data: existing } = await supabase
        .from("videos_recetas")
        .select("id")
        .eq("autor_id", userId)
        .eq("titulo", recetaElegida.trim())
        .limit(1);
      if (existing && existing.length > 0) {
        setSubiendo(false);
        Alert.alert("Ya publicada", "Ya tienes un reel publicado para esta receta. Elimínalo primero si quieres volver a publicarla.");
        return;
      }

      const mimeType: string = videoFile.type ?? "video/mp4";
      // Limpiar extensión (las URIs nativas pueden tener parámetros)
      const rawName = videoFile.isNative ? (videoFile.uri.split("/").pop() ?? "reel.mp4") : (videoFile.name ?? "reel.mp4");
      const ext = (rawName.split(".").pop() ?? "mp4").split("?")[0].toLowerCase();
      const path = `${userId}/${Date.now()}.${ext}`;

      let uploadData: any = videoFile;
      if (videoFile.isNative) {
        setProgreso(15);
        const r = await fetch(videoFile.uri);
        uploadData = await r.blob();
      }
      setProgreso(30);

      const { error: upErr } = await supabase.storage
        .from("videos")
        .upload(path, uploadData, { contentType: mimeType, upsert: false });

      if (upErr) {
        setSubiendo(false);
        const isNoBucket = upErr.message?.includes("not found") || upErr.message?.includes("Bucket") || (upErr as any).statusCode === 404;
        const isAuth = upErr.message?.includes("security") || upErr.message?.includes("permission") || (upErr as any).statusCode === 403;
        let errMsg = upErr.message;
        if (isNoBucket) {
          errMsg = 'El bucket "videos" no existe en Supabase.\n\n👉 Pasos:\n1. supabase.com → tu proyecto\n2. Storage → New bucket\n3. Nombre exacto: videos\n4. Marca "Public bucket"\n5. Save\n\nLuego vuelve a intentarlo.';
        } else if (isAuth) {
          errMsg = 'El bucket existe pero no tiene permisos.\n\n👉 Storage → Policies → añade INSERT y SELECT para "anon".';
        }
        Alert.alert("No se pudo subir el vídeo", errMsg);
        return;
      }
      setProgreso(80);

      const { data: { publicUrl } } = supabase.storage.from("videos").getPublicUrl(path);
      // flipH = true cuando es cámara frontal (detectado auto o elegido por el usuario)
      const hashtags = [
        ...(hashtagsInput.match(/#[\w\u00C0-\u024F\u0400-\u04FF]+/g) ?? []).map(h => h.toLowerCase().slice(1)),
        ...(flipH ? ["__cf__"] : []),  // flag de cámara frontal — siempre en hashtags sin necesitar columna DB
      ];

      const base = {
        autor: nombreUsuario || "Anónimo", autor_id: userId,
        titulo: recetaElegida.trim(), descripcion: descripcion.trim(),
        video_url: publicUrl, likes: 0,
      };

      // Intentar con columnas nuevas; si el schema no las tiene, reintentar sin ellas
      let dbErr: any;
      ({ error: dbErr } = await supabase.from("videos_recetas").insert([
        { ...base, views: 0, hashtags, filtro: selectedFilter !== "Normal" ? selectedFilter : null, camara_frontal: flipH },
      ]));
      if (dbErr?.code === "42703" || dbErr?.message?.includes("column")) {
        ({ error: dbErr } = await supabase.from("videos_recetas").insert([{ ...base, views: 0, hashtags, camara_frontal: flipH }]));
      }
      if (dbErr?.code === "42703" || dbErr?.message?.includes("column")) {
        ({ error: dbErr } = await supabase.from("videos_recetas").insert([{ ...base, views: 0, hashtags }]));
      }
      if (dbErr?.code === "42703" || dbErr?.message?.includes("column")) {
        ({ error: dbErr } = await supabase.from("videos_recetas").insert([base]));
      }

      setSubiendo(false);
      if (dbErr) {
        Alert.alert("Error en base de datos",
          `${dbErr.message}\nCódigo: ${dbErr.code}\n\n💡 Ejecuta el SQL de migraciones en Supabase SQL Editor (ALTER TABLE videos_recetas ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0; etc.)`
        );
        return;
      }
      setProgreso(100);
      Alert.alert("✓ Publicado", `Reel de «${recetaElegida}» publicado 🎉`);
      limpiar(); onSubido(); onClose();
    } catch (e: any) {
      setSubiendo(false);
      Alert.alert("Error inesperado", e?.message ?? "Inténtalo de nuevo.");
    }
  };

  const m = makeSubirStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cerrar}>

      {/* ══ PASO 1: RECETA ══════════════════════════════════════════════════ */}
      {step === "receta" && (
        <SafeAreaView style={m.safe}>
          <View style={m.header}>
            <TouchableOpacity onPress={modoCrear ? () => setModoCrear(false) : cerrar}>
              <Text style={m.back}>{modoCrear ? "← Recetas" : "✕ Cerrar"}</Text>
            </TouchableOpacity>
            <Text style={m.title}>📋 Elige la receta</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={m.steps}>
            {(["Receta","Vídeo","Detalles"] as const).map((lbl, i) => (
              <React.Fragment key={lbl}>
                {i > 0 && <View style={m.stepLine} />}
                <View style={[m.step, i === 0 && m.stepDone]}><Text style={m.stepTxt}>{i+1} {lbl}</Text></View>
              </React.Fragment>
            ))}
          </View>
          <ScrollView style={m.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {!modoCrear ? (
              <>
                {recetas.map(rec => (
                  <TouchableOpacity key={rec.id} style={m.recetaCard} onPress={() => elegirReceta(rec.nombre)}>
                    <View style={{ flex: 1 }}>
                      <Text style={m.recetaNombre}>{rec.nombre}</Text>
                      {rec.descripcion ? <Text style={m.recetaDesc} numberOfLines={1}>{rec.descripcion}</Text> : null}
                    </View>
                    <Text style={m.recetaFlecha}>→</Text>
                  </TouchableOpacity>
                ))}
                {recetas.length === 0 && (
                  <View style={m.emptyBox}>
                    <Text style={m.emptyIcon}>🍳</Text>
                    <Text style={m.emptyTxt}>No tienes recetas aún</Text>
                    <Text style={m.emptyHint}>Crea una nueva abajo o ve a la sección Recetas</Text>
                  </View>
                )}
                <TouchableOpacity style={m.nuevaBtn} onPress={() => setModoCrear(true)}>
                  <Text style={m.nuevaBtnTxt}>+ Crear receta nueva</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={m.nuevaBox}>
                <Text style={m.nuevaLabel}>Nombre de la receta *</Text>
                <TextInput style={m.input} value={nuevaNombre} onChangeText={setNuevaNombre}
                  placeholder="Ej: Pasta carbonara casera" placeholderTextColor={colors.textMuted} autoFocus maxLength={80} />
                <Text style={[m.nuevaLabel, { marginTop: 12 }]}>Descripción (opcional)</Text>
                <TextInput style={[m.input, { height: 70 }]} value={nuevaDesc} onChangeText={setNuevaDesc}
                  placeholder="Pasos, ingredientes, consejos..." placeholderTextColor={colors.textMuted} multiline numberOfLines={3} maxLength={200} />
                <Text style={[m.nuevaLabel, { marginTop: 12 }]}>Macros (opcional)</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                  {[{label:"kcal",val:nuevaKcal,set:setNuevaKcal,color:"#4ADE80"},{label:"Prot g",val:nuevaProt,set:setNuevaProt,color:"#60A5FA"},{label:"Carbos g",val:nuevaCarbos,set:setNuevaCarbos,color:"#FBBF24"},{label:"Grasas g",val:nuevaGrasas,set:setNuevaGrasas,color:"#F87171"}].map(f => (
                    <View key={f.label} style={{ flex: 1 }}>
                      <Text style={{ color: f.color, fontSize: 10, fontWeight: "700", marginBottom: 3 }}>{f.label}</Text>
                      <TextInput style={[m.input, { paddingVertical: 8, textAlign: "center" }]} value={f.val} onChangeText={f.set}
                        placeholder="0" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" maxLength={6} />
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <TouchableOpacity style={m.cancelBtn} onPress={() => setModoCrear(false)}>
                    <Text style={m.cancelTxt}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[m.nextBtn, (!nuevaNombre.trim() || guardandoReceta) && m.btnDis]}
                    onPress={guardarNuevaReceta} disabled={!nuevaNombre.trim() || guardandoReceta}>
                    {guardandoReceta ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.nextBtnTxt}>Guardar y continuar →</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <View style={{ height: 60 }} />
          </ScrollView>
        </SafeAreaView>
      )}

      {/* ══ PASO 2: CÁMARA ══════════════════════════════════════════════════ */}
      {step === "camara" && (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {Platform.OS === "web" ? (
            /* Web: cámara nativa del móvil + galería */
            <SafeAreaView style={[m.safe, { backgroundColor: "#0F172A" }]}>
              <View style={[m.header, { backgroundColor: "#0F172A" }]}>
                <TouchableOpacity onPress={() => setStep("receta")}>
                  <Text style={[m.back, { color: "#58A6FF" }]}>← Receta</Text>
                </TouchableOpacity>
                <Text style={[m.title, { color: "#fff" }]}>🎬 Grabar vídeo</Text>
                <View style={{ width: 60 }} />
              </View>
              <View style={m.steps}>
                {(["Receta","Vídeo","Detalles"] as const).map((lbl, i) => (
                  <React.Fragment key={lbl}>
                    {i > 0 && <View style={m.stepLine} />}
                    <View style={[m.step, i <= 1 && m.stepDone]}><Text style={m.stepTxt}>{i+1} {lbl}</Text></View>
                  </React.Fragment>
                ))}
              </View>
              <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
                {/* Cámara (selfie / frontal) */}
                <TouchableOpacity
                  style={{ backgroundColor: "#1F6FEB", borderRadius: 20, padding: 24, alignItems: "center", gap: 8 }}
                  onPress={() => {
                    const input = document.createElement("input");
                    input.type = "file"; input.accept = "video/*";
                    input.setAttribute("capture", "user");
                    input.onchange = (e: any) => {
                      const file = e.target?.files?.[0];
                      if (!file) return;
                      if (webPreview) URL.revokeObjectURL(webPreview);
                      setVideoFile(file); setWebPreview(URL.createObjectURL(file));
                      setFlipH(true); setStep("detalles");
                    };
                    input.click();
                  }}>
                  <Text style={{ fontSize: 48 }}>📹</Text>
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>Grabar vídeo</Text>
                  <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center" }}>Abre la cámara directamente</Text>
                </TouchableOpacity>

                {/* Separador */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: "#ffffff22" }} />
                  <Text style={{ color: "#64748B", fontSize: 12 }}>o</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: "#ffffff22" }} />
                </View>

                {/* Galería */}
                <TouchableOpacity
                  style={{ backgroundColor: "#1E293B", borderRadius: 20, padding: 16, alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#334155" }}
                  onPress={pickGallery}>
                  <Text style={{ fontSize: 32 }}>🖼️</Text>
                  <Text style={{ color: "#CBD5E1", fontSize: 14, fontWeight: "700" }}>Subir de galería</Text>
                  <Text style={{ color: "#64748B", fontSize: 12 }}>MP4 · MOV · WebM · hasta 500 MB</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          ) : (!camPerm?.granted || !micPerm?.granted) ? (
            /* Sin permisos */
            <SafeAreaView style={[m.safe, { backgroundColor: "#0F172A", justifyContent: "center", alignItems: "center", gap: 16, padding: 32 }]}>
              <Text style={{ fontSize: 52 }}>📷</Text>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" }}>
                Necesitamos acceso a la cámara y al micrófono
              </Text>
              <TouchableOpacity style={{ backgroundColor: "#1F6FEB", borderRadius: 12, paddingHorizontal: 28, paddingVertical: 12 }}
                onPress={() => { requestCamPerm(); requestMicPerm(); }}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Conceder permisos</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep("receta")}>
                <Text style={{ color: "#94A3B8", marginTop: 8 }}>← Volver</Text>
              </TouchableOpacity>
            </SafeAreaView>
          ) : (
            /* Cámara activa — pantalla completa */
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mode="video"
              videoQuality="2160p"
              autofocus="on"
              zoom={0}
              flash="off"
            >
              {/* Overlay filtro */}
              {curFilter.name !== "Normal" && (
                <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: curFilter.overlay, opacity: curFilter.opacity }} />
              )}

              {/* Nombre filtro activo */}
              {curFilter.name !== "Normal" && !recording && (
                <View style={{ position: "absolute", top: 100, alignSelf: "center", backgroundColor: "#0008", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 5 }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>{curFilter.icon} {curFilter.name}</Text>
                </View>
              )}

              {/* Nombre receta arriba */}
              {!recording && (
                <View style={{ position: "absolute", top: 52, alignSelf: "center", backgroundColor: "#0007", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 6, maxWidth: SW - 120 }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }} numberOfLines={1}>🍽 {recetaElegida}</Text>
                </View>
              )}

              {/* Botón X (cerrar) */}
              <TouchableOpacity
                style={{ position: "absolute", top: 52, left: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: "#0008", justifyContent: "center", alignItems: "center" }}
                onPress={() => setStep("receta")} disabled={recording}>
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: "300" }}>✕</Text>
              </TouchableOpacity>

              {/* Flip cámara */}
              <TouchableOpacity
                style={{ position: "absolute", top: 52, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: "#0008", justifyContent: "center", alignItems: "center" }}
                onPress={() => !recording && setFacing(f => f === "back" ? "front" : "back")}>
                <Text style={{ fontSize: 20 }}>🔄</Text>
              </TouchableOpacity>

              {/* Timer grabación */}
              {recording && (
                <View style={{ position: "absolute", top: 60, alignSelf: "center", backgroundColor: "#EF4444EE", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" }} />
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{fmtDur(duration)}</Text>
                </View>
              )}

              {/* Tira de filtros — visible al deslizar el botón de grabar */}
              {filterStripVisible && !recording && (
                <View style={{ position: "absolute", bottom: 160, left: 0, right: 0 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                    {FILTERS.map(f => (
                      <TouchableOpacity key={f.name}
                        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, marginRight: 4,
                          backgroundColor: selectedFilter === f.name ? "#1F6FEB" : "rgba(0,0,0,0.72)",
                          borderWidth: 2, borderColor: selectedFilter === f.name ? "#60A5FA" : "rgba(255,255,255,0.25)" }}
                        onPress={() => { setSelectedFilter(f.name); setFilterStripVisible(false); }}>
                        <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>{f.icon} {f.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Controles inferiores */}
              <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: 50,
                flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 32 }}>

                {/* + Galería (izquierda abajo) */}
                <TouchableOpacity
                  style={{ width: 60, height: 60, borderRadius: 16, backgroundColor: "#0008", borderWidth: 2, borderColor: "#ffffff55", justifyContent: "center", alignItems: "center" }}
                  onPress={pickGallery} disabled={recording}>
                  <Text style={{ fontSize: 30, color: "#fff" }}>＋</Text>
                </TouchableOpacity>

                {/* Botón grabar — desliza → para filtros */}
                <View style={{ alignItems: "center" }}>
                  {!recording && !filterStripVisible && (
                    <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, marginBottom: 6 }}>
                      ← Desliza → para filtros
                    </Text>
                  )}
                  <Animated.View
                    {...recBtnPR.panHandlers}
                    style={{ transform: [{ translateX: recBtnAnim }] }}>
                    <TouchableOpacity
                      style={{ width: 82, height: 82, borderRadius: 41, borderWidth: 5,
                        borderColor: recording ? "#EF4444" : "#ffffffDD",
                        backgroundColor: "transparent", justifyContent: "center", alignItems: "center" }}
                      onPress={recording ? stopRecording : startRecording}>
                      <View style={{
                        width: recording ? 28 : 68, height: recording ? 28 : 68,
                        borderRadius: recording ? 6 : 34,
                        backgroundColor: recording ? "#fff" : "#EF4444",
                      }} />
                    </TouchableOpacity>
                  </Animated.View>
                </View>

                {/* Espacio derecho */}
                <View style={{ width: 60 }} />
              </View>
            </CameraView>
          )}
          {/* Overlay negro: oculta la cámara durante la transición para evitar el "flip" visual */}
          {cameraTransition && (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#000", zIndex: 999 }]} pointerEvents="none" />
          )}
        </View>
      )}

      {/* ══ PASO 3: DETALLES ════════════════════════════════════════════════ */}
      {step === "detalles" && (
        <SafeAreaView style={m.safe}>
          <View style={m.header}>
            <TouchableOpacity onPress={() => { setVideoFile(null); setWebPreview(null); setStep("camara"); }}>
              <Text style={m.back}>← Vídeo</Text>
            </TouchableOpacity>
            <Text style={m.title}>✏️ Detalles</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={m.steps}>
            {(["Receta","Vídeo","Detalles"] as const).map((lbl, i) => (
              <React.Fragment key={lbl}>
                {i > 0 && <View style={m.stepLine} />}
                <View style={[m.step, m.stepDone]}><Text style={m.stepTxt}>{i+1} {lbl}</Text></View>
              </React.Fragment>
            ))}
          </View>
          <ScrollView style={m.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Mini-preview + toggle voltear */}
            <View style={{ backgroundColor: "#111", borderRadius: 14, height: 180,
              overflow: "hidden", marginBottom: 8, position: "relative" }}>
              {webPreview
                ? (React.createElement as any)("video", { src: webPreview,
                    style: { width: "100%", height: 180, objectFit: "cover", backgroundColor: "#000",
                      ...(curFilter.webCss ? { filter: curFilter.webCss } : {}) },
                    muted: true, loop: true, autoPlay: true, playsInline: true })
                : <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 36 }}>🎬</Text>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
                      {videoFile?.name ?? "Vídeo listo"}
                    </Text>
                  </View>
              }
            </View>
            {/* Tira de filtros — también accesible desde detalles */}
            <Text style={m.nuevaLabel}>Filtro visual</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 16 }}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
              {FILTERS.map(f => (
                <TouchableOpacity key={f.name}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                    backgroundColor: selectedFilter === f.name ? "#1F6FEB" : colors.card,
                    borderWidth: 1.5, borderColor: selectedFilter === f.name ? "#60A5FA" : colors.cardBorder }}
                  onPress={() => setSelectedFilter(f.name)}>
                  <Text style={{ color: selectedFilter === f.name ? "#fff" : colors.text, fontSize: 12, fontWeight: "700" }}>
                    {f.icon} {f.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={m.nuevaLabel}>
              Descripción <Text style={{ color: colors.textMuted, fontWeight: "400" }}>(opcional)</Text>
            </Text>
            <TextInput style={[m.input, { height: 90, marginBottom: 14 }]}
              value={descripcion} onChangeText={setDescripcion}
              placeholder="Ingredientes, pasos, consejos..."
              placeholderTextColor={colors.textMuted} multiline numberOfLines={4} maxLength={300} />

            <Text style={m.nuevaLabel}>
              Hashtags <Text style={{ color: colors.textMuted, fontWeight: "400" }}>(opcional)</Text>
            </Text>
            <TextInput style={[m.input, { marginBottom: 20 }]}
              value={hashtagsInput} onChangeText={setHashtagsInput}
              placeholder="#desayuno #proteina #fácil"
              placeholderTextColor={colors.textMuted} maxLength={120}
              autoCapitalize="none" autoCorrect={false} />

            {subiendo && (
              <View style={m.progWrap}>
                <View style={[m.progBar, { width: `${progreso}%` as any }]} />
                <Text style={m.progTxt}>Subiendo {progreso}%…</Text>
              </View>
            )}


            <TouchableOpacity style={[m.publishBtn, (subiendo || !videoFile || !userId) && m.btnDis]} onPress={subir} disabled={subiendo || !videoFile || !userId}>
              {subiendo ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.publishTxt}>🎬 Publicar Reel</Text>}
            </TouchableOpacity>
            <View style={{ height: 60 }} />
          </ScrollView>
        </SafeAreaView>
      )}
    </Modal>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function ReelsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ recetaNombre?: string }>();
  const [tab, setTab] = useState<"parati" | "siguiendo">("parati");
  const [reels, setReels] = useState<Reel[]>([]);
  const [siguiendoReels, setSiguiendoReels] = useState<Reel[]>([]);
  const [cargando, setCargando] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [muted, setMuted] = useState(true);  // empieza silenciado — autoplay garantizado; usuario toca 🔊 para activar
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [seguidosIds, setSeguidosIds] = useState<Set<string>>(new Set());
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [userId, setUserId] = useState("");
  const [modalSubir, setModalSubir] = useState(false);
  const [recetaPrevia, setRecetaPrevia] = useState<string | undefined>();
  const [confirmarBorrar, setConfirmarBorrar] = useState<Reel | null>(null);
  const [modalReceta, setModalReceta] = useState<Reel | null>(null);
  const [recetaDetalle, setRecetaDetalle] = useState<any>(null);
  const [cargandoReceta, setCargandoReceta] = useState(false);
  const [likedHashtags, setLikedHashtags] = useState<Set<string>>(new Set());
  const [hashtagActivo, setHashtagActivo] = useState<string | null>(null);
  const { height: SH } = useWindowDimensions();
  const [guardandoRecetaExt, setGuardandoRecetaExt] = useState(false);
  const [recetaGuardada, setRecetaGuardada] = useState(false);

  // Si viene desde recetas.tsx con una receta pre-seleccionada
  useEffect(() => {
    if (params.recetaNombre) {
      setRecetaPrevia(decodeURIComponent(params.recetaNombre));
      setModalSubir(true);
    }
  }, [params.recetaNombre]);

  // View tracking: increment after 2s watching the same reel
  useEffect(() => {
    const currentList = tab === "parati" ? reels : siguiendoReels;
    const reel = currentList[activeIdx];
    if (!reel) return;
    const timer = setTimeout(() => {
      supabase.rpc("increment_views", { row_id: reel.id });
      const upd = (list: Reel[]) => list.map(r => r.id === reel.id ? { ...r, views: (r.views ?? 0) + 1 } : r);
      setReels(upd); setSiguiendoReels(upd);
    }, 2000);
    return () => clearTimeout(timer);
  }, [activeIdx, tab]);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    cargarDatos(mounted);
    return () => { mounted = false; };
  }, [tab]));

  const cargarDatos = async (mounted = true) => {
    if (mounted) setCargando(true);
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id ?? "";
      if (!mounted) return;
      if (uid) setUserId(uid);

      if (uid) {
        const { data: p } = await supabase.from("perfiles").select("nombre").eq("id", uid).single();
        const { data: segs } = await supabase.from("seguidos").select("followed_id").eq("follower_id", uid);
        if (!mounted) return;
        if (p?.nombre) setNombreUsuario(p.nombre);
        setSeguidosIds(new Set((segs ?? []).map((s: any) => s.followed_id)));
      }

      const [liked, likedHTRaw] = await Promise.all([
        AsyncStorage.getItem(LIKED_KEY),
        AsyncStorage.getItem(LIKED_HASHTAGS_KEY),
      ]);
      if (!mounted) return;
      setLikedIds(new Set(liked ? JSON.parse(liked) : []));
      const likedHTSet = new Set<string>(likedHTRaw ? JSON.parse(likedHTRaw) : []);
      setLikedHashtags(likedHTSet);

      if (tab === "parati") {
        const { data } = await supabase.from("videos_recetas").select("*").order("creado_en", { ascending: false }).limit(50);
        if (!mounted) return;
        const raw = (data ?? []).filter((r: any) => r.video_url) as Reel[];
        setReels([...raw].sort((a, b) => scoreReel(b, likedHTSet) - scoreReel(a, likedHTSet)));
      } else {
        const { data: segs } = await supabase.from("seguidos").select("followed_id").eq("follower_id", uid);
        const ids = (segs ?? []).map((s: any) => s.followed_id);
        if (!mounted) return;
        if (ids.length > 0) {
          const { data } = await supabase.from("videos_recetas").select("*").in("autor_id", ids).order("creado_en", { ascending: false }).limit(50);
          if (!mounted) return;
          setSiguiendoReels((data ?? []).filter((r: any) => r.video_url));
        } else setSiguiendoReels([]);
      }
    } catch {
      // silently ignore network/auth errors on dismount
    } finally {
      if (mounted) setCargando(false);
    }
  };

  const handleLike = async (reel: Reel) => {
    const already = likedIds.has(reel.id);
    const delta = already ? -1 : 1;
    // Optimistic UI update
    const next = new Set(likedIds);
    if (already) next.delete(reel.id); else next.add(reel.id);
    setLikedIds(next);
    await AsyncStorage.setItem(LIKED_KEY, JSON.stringify([...next]));
    // Personalization: remember hashtags of liked reels
    if (!already && reel.hashtags?.length) {
      const nextHT = new Set([...likedHashtags, ...reel.hashtags]);
      setLikedHashtags(nextHT);
      AsyncStorage.setItem(LIKED_HASHTAGS_KEY, JSON.stringify([...nextHT]));
    }
    const upd = (list: Reel[]) => list.map(r => r.id === reel.id ? { ...r, likes: Math.max(0, r.likes + delta) } : r);
    setReels(upd); setSiguiendoReels(upd);
    // Use RPC increment to avoid race conditions between concurrent users
    const { error } = await supabase.rpc("increment_likes", { row_id: reel.id, delta });
    if (error) {
      // Rollback optimistic update on failure
      const rollback = new Set(likedIds);
      setLikedIds(rollback);
      await AsyncStorage.setItem(LIKED_KEY, JSON.stringify([...rollback]));
      const revert = (list: Reel[]) => list.map(r => r.id === reel.id ? { ...r, likes: Math.max(0, r.likes - delta) } : r);
      setReels(revert); setSiguiendoReels(revert);
    }
  };

  const handleFollow = async (reel: Reel) => {
    if (!userId) return;
    const siguiendo = seguidosIds.has(reel.autor_id);
    const next = new Set(seguidosIds);
    if (siguiendo) {
      await supabase.from("seguidos").delete().eq("follower_id", userId).eq("followed_id", reel.autor_id);
      next.delete(reel.autor_id);
    } else {
      await supabase.from("seguidos").upsert(
        [{ follower_id: userId, follower_nombre: nombreUsuario, followed_id: reel.autor_id, followed_nombre: reel.autor }],
        { onConflict: "follower_id,followed_id", ignoreDuplicates: true }
      );
      next.add(reel.autor_id);
    }
    setSeguidosIds(next);
  };

  const handleDelete = async (reel: Reel) => {
    try {
      const url = new URL(reel.video_url);
      const part = url.pathname.split("/videos/")[1];
      if (part) await supabase.storage.from("videos").remove([decodeURIComponent(part)]);
    } catch {}
    await supabase.from("videos_recetas").delete().eq("id", reel.id);
    setConfirmarBorrar(null);
    cargarDatos();
  };

  const abrirReceta = async (reel: Reel) => {
    setModalReceta(reel);
    setRecetaDetalle(null);
    setCargandoReceta(true);
    setRecetaGuardada(false);
    setGuardandoRecetaExt(false);
    const { data } = await supabase
      .from("recetas")
      .select("nombre,descripcion,ingredientes,calorias_total,proteinas_total,grasas_total,carbohidratos_total")
      .eq("nombre", reel.titulo)
      .limit(1)
      .single();
    setRecetaDetalle(data ?? null);
    setCargandoReceta(false);
  };

  const lista = tab === "parati" ? reels : siguiendoReels;

  const listaFiltrada = useMemo(() => {
    if (!hashtagActivo) return lista;
    return lista.filter(r => r.hashtags?.includes(hashtagActivo));
  }, [lista, hashtagActivo]);

  const todosHashtags = useMemo(() => {
    const counts = new Map<string, number>();
    lista.forEach(r => r.hashtags?.forEach(h => counts.set(h, (counts.get(h) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 15);
  }, [lista]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── Feed ── */}
      {cargando ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : listaFiltrada.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 40 }}>
          <Text style={{ fontSize: 64 }}>{tab === "siguiendo" ? "👥" : "🎬"}</Text>
          <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 20, textAlign: "center" }}>
            {tab === "siguiendo" ? "Sin reels de tus seguidos" : "Sin reels todavía"}
          </Text>
          <Text style={{ color: "#94A3B8", fontSize: 14, marginTop: 10, textAlign: "center", lineHeight: 22 }}>
            {tab === "siguiendo"
              ? "Ve a «Para ti», mira reels de otros y toca ＋ para seguirlos"
              : "Sé el primero en compartir tu receta en vídeo"}
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
          decelerationRate="fast"
          onScroll={e => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / SH);
            if (idx !== activeIdx) setActiveIdx(idx);
          }}
          scrollEventThrottle={100}
        >
          {listaFiltrada.map((reel, i) => (
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
              onVerReceta={() => abrirReceta(reel)}
            />
          ))}
        </ScrollView>
      )}

      {/* ── Header superpuesto ── */}
      <SafeAreaView style={h.wrap} pointerEvents="box-none">
        <View style={h.row} pointerEvents="box-none">
          <TouchableOpacity onPress={() => router.back()} style={{ minWidth: 70 }}>
            <Text style={h.back}>← Volver</Text>
          </TouchableOpacity>
          <View style={h.tabs}>
            <TouchableOpacity onPress={() => { setTab("parati"); setActiveIdx(0); setHashtagActivo(null); }}>
              <Text style={[h.tab, tab === "parati" && h.tabActive]}>Para ti</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setTab("siguiendo"); setActiveIdx(0); setHashtagActivo(null); }}>
              <Text style={[h.tab, tab === "siguiendo" && h.tabActive]}>
                Siguiendo{seguidosIds.size > 0 ? ` (${seguidosIds.size})` : ""}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => { setRecetaPrevia(undefined); setModalSubir(true); }} style={{ minWidth: 70, alignItems: "flex-end" }}>
            <Text style={h.plus}>＋</Text>
          </TouchableOpacity>
        </View>
        {todosHashtags.length > 0 && (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            style={{ paddingLeft: 12, marginBottom: 4 }}
            contentContainerStyle={{ gap: 6, paddingRight: 16 }}
            pointerEvents="auto"
          >
            <TouchableOpacity
              style={[h.chip, !hashtagActivo && h.chipActive]}
              onPress={() => { setHashtagActivo(null); setActiveIdx(0); }}
            >
              <Text style={[h.chipTxt, !hashtagActivo && h.chipActiveTxt]}>Todo</Text>
            </TouchableOpacity>
            {todosHashtags.map(tag => (
              <TouchableOpacity
                key={tag}
                style={[h.chip, hashtagActivo === tag && h.chipActive]}
                onPress={() => { setHashtagActivo(hashtagActivo === tag ? null : tag); setActiveIdx(0); }}
              >
                <Text style={[h.chipTxt, hashtagActivo === tag && h.chipActiveTxt]}>#{tag}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Modal subir */}
      <ModalSubir
        visible={modalSubir}
        onClose={() => { setModalSubir(false); setRecetaPrevia(undefined); }}
        onSubido={cargarDatos}
        nombreUsuario={nombreUsuario}
        userId={userId}
        recetaPrevia={recetaPrevia}
      />

      {/* ── Modal ver receta ── */}
      <Modal visible={!!modalReceta} transparent animationType="slide" onRequestClose={() => setModalReceta(null)}>
        <TouchableOpacity style={p.overlay} activeOpacity={1} onPress={() => setModalReceta(null)}>
          <TouchableOpacity activeOpacity={1} style={[p.box, { maxHeight: "80%" as any }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={[p.title, { flex: 1 }]}>🍽 {modalReceta?.titulo}</Text>
              <TouchableOpacity onPress={() => setModalReceta(null)}>
                <Text style={{ color: "#94A3B8", fontSize: 22, fontWeight: "300" }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: "#94A3B8", fontSize: 12, marginBottom: 12 }}>por @{modalReceta?.autor}</Text>

            {cargandoReceta ? (
              <ActivityIndicator color="#58A6FF" style={{ marginVertical: 20 }} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Macros */}
                {recetaDetalle && (
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                    {[
                      { val: Math.round(recetaDetalle.calorias_total ?? 0), label: "kcal", color: "#4ADE80" },
                      { val: Math.round(recetaDetalle.proteinas_total ?? 0) + "g", label: "Prot", color: "#60A5FA" },
                      { val: Math.round(recetaDetalle.carbohidratos_total ?? 0) + "g", label: "Carbos", color: "#FBBF24" },
                      { val: Math.round(recetaDetalle.grasas_total ?? 0) + "g", label: "Grasas", color: "#F87171" },
                    ].map(m => (
                      <View key={m.label} style={{ flex: 1, backgroundColor: "#ffffff11", borderRadius: 10, padding: 10, alignItems: "center" }}>
                        <Text style={{ color: m.color, fontSize: 15, fontWeight: "800" }}>{m.val}</Text>
                        <Text style={{ color: "#94A3B8", fontSize: 10, marginTop: 2 }}>{m.label}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Descripción */}
                {(recetaDetalle?.descripcion || modalReceta?.descripcion) ? (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ color: "#fff", fontWeight: "700", marginBottom: 6 }}>📝 Descripción</Text>
                    <Text style={{ color: "#CBD5E1", fontSize: 13, lineHeight: 20 }}>
                      {recetaDetalle?.descripcion || modalReceta?.descripcion}
                    </Text>
                  </View>
                ) : null}

                {/* Ingredientes */}
                {recetaDetalle?.ingredientes?.length > 0 ? (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ color: "#fff", fontWeight: "700", marginBottom: 8 }}>🥗 Ingredientes</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {recetaDetalle.ingredientes.map((ing: any, i: number) => (
                        <View key={i} style={{ backgroundColor: "#1F6FEB22", borderWidth: 1, borderColor: "#1F6FEB44", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
                          <Text style={{ color: "#93C5FD", fontSize: 12, fontWeight: "600" }}>{ing.nombre} {ing.gramos}g</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : !cargandoReceta && !recetaDetalle ? (
                  <Text style={{ color: "#64748B", fontSize: 13, textAlign: "center", marginVertical: 10 }}>
                    No se encontraron detalles de esta receta
                  </Text>
                ) : null}

                {/* Botón guardar receta en mis recetas */}
                {/* Solo visible para usuarios que NO publicaron el reel */}
                {userId && modalReceta && modalReceta.autor_id !== userId && (
                  <TouchableOpacity
                    style={{
                      backgroundColor: recetaGuardada ? "#15803D" : "#1F6FEB",
                      borderRadius: 14, padding: 14, alignItems: "center",
                      marginTop: 14, opacity: guardandoRecetaExt ? 0.7 : 1,
                    }}
                    onPress={async () => {
                      if (recetaGuardada || guardandoRecetaExt || !modalReceta) return;
                      setGuardandoRecetaExt(true);
                      const SAVED_KEY = "nutri_recetas_guardadas";
                      const raw = await AsyncStorage.getItem(SAVED_KEY);
                      const lista = raw ? JSON.parse(raw) : [];
                      if (!lista.some((r: any) => r.reel_id === modalReceta.id)) {
                        await AsyncStorage.setItem(SAVED_KEY, JSON.stringify([
                          ...lista,
                          {
                            pub_id: `reel_${modalReceta.id}`,
                            reel_id: modalReceta.id,
                            video_url: modalReceta.video_url,
                            nombre: recetaDetalle?.nombre ?? modalReceta.titulo,
                            descripcion: recetaDetalle?.descripcion ?? modalReceta.descripcion ?? "",
                            ingredientes: recetaDetalle?.ingredientes ?? [],
                            calorias_total: recetaDetalle?.calorias_total ?? 0,
                            proteinas_total: recetaDetalle?.proteinas_total ?? 0,
                            grasas_total: recetaDetalle?.grasas_total ?? 0,
                            carbohidratos_total: recetaDetalle?.carbohidratos_total ?? 0,
                            autor: modalReceta.autor ?? "",
                            savedAt: Date.now(),
                          },
                        ]));
                      }
                      setGuardandoRecetaExt(false);
                      setRecetaGuardada(true);
                      Alert.alert("✓ Guardada", "Receta añadida a tus Guardadas");
                    }}
                    disabled={guardandoRecetaExt || recetaGuardada}
                  >
                    {guardandoRecetaExt
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>
                          {recetaGuardada ? "✓ Guardada" : "💾 Guardar receta"}
                        </Text>
                    }
                  </TouchableOpacity>
                )}

                <View style={{ height: 8 }} />
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Confirmar borrar */}
      <Modal visible={!!confirmarBorrar} transparent animationType="fade" onRequestClose={() => setConfirmarBorrar(null)}>
        <TouchableOpacity style={p.overlay} activeOpacity={1} onPress={() => setConfirmarBorrar(null)}>
          <TouchableOpacity activeOpacity={1} style={p.box}>
            <Text style={p.title}>🗑️ Eliminar reel</Text>
            <Text style={p.sub}>¿Eliminar «{confirmarBorrar?.titulo}»? No se puede deshacer.</Text>
            <View style={p.btns}>
              <TouchableOpacity style={p.cancel} onPress={() => setConfirmarBorrar(null)}>
                <Text style={{ color: "#94A3B8", fontWeight: "700" }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={p.del} onPress={() => confirmarBorrar && handleDelete(confirmarBorrar)}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Estilos header ───────────────────────────────────────────────────────────
const shadow = { textShadowColor: "#000" as const, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };
const h = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  back: { color: "#fff", fontSize: 14, ...shadow },
  tabs: { flexDirection: "row", gap: 22 },
  tab: { color: "rgba(255,255,255,0.5)", fontSize: 16, fontWeight: "700", paddingBottom: 2, ...shadow },
  tabActive: { color: "#fff", borderBottomWidth: 2, borderBottomColor: "#fff" },
  plus: { color: "#fff", fontSize: 26, fontWeight: "300", ...shadow },
  chip: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipActive: { backgroundColor: "#1F6FEB" },
  chipTxt: { color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: "600" },
  chipActiveTxt: { color: "#fff" },
});

// ─── Estilos popup borrar ─────────────────────────────────────────────────────
const p = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000BB", justifyContent: "center", alignItems: "center", padding: 24 },
  box: { backgroundColor: "#1E2533", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 8 },
  sub: { color: "#94A3B8", fontSize: 14, lineHeight: 20, marginBottom: 20 },
  btns: { flexDirection: "row", gap: 12 },
  cancel: { flex: 1, backgroundColor: "#2D3748", borderRadius: 12, padding: 14, alignItems: "center" },
  del: { flex: 1, backgroundColor: "#EF4444", borderRadius: 12, padding: 14, alignItems: "center" },
});

// ─── Estilos modal subir ──────────────────────────────────────────────────────
function makeSubirStyles(colors: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
    back: { color: "#58A6FF", fontSize: 14, minWidth: 80 },
    title: { color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center", flex: 1 },
    steps: { flexDirection: "row", alignItems: "center", paddingHorizontal: 32, paddingVertical: 12, gap: 0 },
    step: { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
    stepDone: { backgroundColor: "#1F6FEB22", borderColor: "#1F6FEB" },
    stepLine: { width: 20, height: 2, backgroundColor: colors.cardBorder },
    stepTxt: { color: colors.text, fontSize: 12, fontWeight: "700" },
    scroll: { flex: 1, paddingHorizontal: 16 },
    recetaCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 14, padding: 16, marginBottom: 10, flexDirection: "row", alignItems: "center" },
    recetaNombre: { color: colors.text, fontSize: 16, fontWeight: "700", flex: 1 },
    recetaDesc: { color: colors.textMuted, fontSize: 12, flex: 1 },
    recetaFlecha: { color: "#58A6FF", fontSize: 18, fontWeight: "700" },
    nuevaBtn: { borderWidth: 2, borderColor: "#1F6FEB55", borderStyle: "dashed" as const, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 4 },
    nuevaBtnTxt: { color: "#58A6FF", fontWeight: "700", fontSize: 14 },
    nuevaBox: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 8 },
    nuevaLabel: { color: colors.text, fontWeight: "700", marginBottom: 8 },
    emptyBox: { alignItems: "center", paddingVertical: 40, gap: 8 },
    emptyIcon: { fontSize: 52 },
    emptyTxt: { color: colors.text, fontSize: 18, fontWeight: "700" },
    emptyHint: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
    picker: { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.cardBorder, borderStyle: "dashed" as const, borderRadius: 16, height: 200, justifyContent: "center", alignItems: "center", gap: 10 },
    pickerIcon: { fontSize: 52 },
    pickerTxt: { color: colors.text, fontSize: 16, fontWeight: "700" },
    pickerHint: { color: colors.textMuted, fontSize: 12 },
    previewWrap: { borderRadius: 14, overflow: "hidden", backgroundColor: "#000", marginBottom: 4 },
    changeBtn: { backgroundColor: "#EF444422", borderWidth: 1, borderColor: "#EF4444", borderRadius: 10, padding: 12, alignItems: "center", margin: 10 },
    changeBtnTxt: { color: "#EF4444", fontWeight: "700", fontSize: 13 },
    input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 12, padding: 14, color: colors.text, fontSize: 15 },
    progWrap: { backgroundColor: colors.card, borderRadius: 8, overflow: "hidden", height: 8, marginVertical: 12 },
    progBar: { height: 8, backgroundColor: "#1F6FEB", borderRadius: 8 },
    progTxt: { color: colors.textMuted, fontSize: 11, textAlign: "center", marginBottom: 4 },
    publishBtn: { backgroundColor: "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 14 },
    publishTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
    cancelBtn: { flex: 1, backgroundColor: colors.card, borderRadius: 10, padding: 12, alignItems: "center" },
    cancelTxt: { color: colors.textMuted, fontWeight: "700" },
    nextBtn: { flex: 2, backgroundColor: "#1F6FEB", borderRadius: 10, padding: 12, alignItems: "center" },
    nextBtnTxt: { color: "#fff", fontWeight: "700" },
    btnDis: { opacity: 0.4 },
  });
}
