import { useApp } from "@/app/services/i18n";
import { crearReceta, supabase } from "@/app/services/supabase";
import { useAvatar } from "@/app/services/useAvatar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, Modal, Platform,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";

const { width: SW, height: SH } = Dimensions.get("window");
const LIKED_KEY = "nutri_liked_videos";

type Reel = {
  id: string; autor: string; autor_id: string;
  titulo: string; descripcion: string; video_url: string;
  likes: number; creado_en: string;
};
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
function VideoPlayer({ url, active, muted, onToggleMute }: {
  url: string; active: boolean; muted: boolean; onToggleMute: () => void;
}) {
  const ref = useRef<any>(null);

  // Play / pause según si el reel está activo
  useEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;
    if (active) {
      ref.current.play?.().catch(() => {});
    } else {
      ref.current.pause?.();
      ref.current.currentTime = 0;
    }
  }, [active]);

  // Mute / unmute sin recargar el vídeo
  useEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;
    ref.current.muted = muted;
  }, [muted]);

  const goFullscreen = () => {
    const v = ref.current;
    if (!v) return;
    (v.requestFullscreen ?? v.webkitRequestFullscreen ?? v.webkitEnterFullscreen)?.call(v);
  };

  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {(React.createElement as any)("video", {
          ref,
          src: url,
          // preload inteligente: el activo carga todo, el resto solo metadatos
          preload: active ? "auto" : "metadata",
          style: {
            width: "100%", height: "100%",
            objectFit: "contain",   // máxima resolución sin recorte
            display: "block",
            backgroundColor: "#000",
          },
          muted: true,   // el atributo inicial; se controla por ref
          loop: true,
          playsInline: true,
        })}
        {/* Controles superpuestos */}
        <View style={vid.controls} pointerEvents="box-none">
          <TouchableOpacity style={vid.btn} onPress={onToggleMute}>
            <Text style={vid.btnTxt}>{muted ? "🔇" : "🔊"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={vid.btn} onPress={goFullscreen}>
            <Text style={vid.btnTxt}>⛶</Text>
          </TouchableOpacity>
        </View>
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
  const [showDesc, setShowDesc] = useState(false);

  return (
    <View style={{ width: SW, height: SH, backgroundColor: "#000" }}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowDesc(v => !v)}>
        <VideoPlayer url={reel.video_url} active={active} muted={muted} onToggleMute={onToggleMute} />
      </TouchableOpacity>

      {/* Sombra inferior */}
      <View style={r.shadow} pointerEvents="none" />

      {/* Info izquierda abajo */}
      <View style={r.info} pointerEvents="none">
        <Text style={r.autor}>@{reel.autor}</Text>
        <Text style={r.titulo}>🍽 {reel.titulo}</Text>
        {showDesc && reel.descripcion ? (
          <Text style={r.desc}>{reel.descripcion}</Text>
        ) : reel.descripcion ? (
          <Text style={r.hint}>Toca para ver descripción</Text>
        ) : null}
        <Text style={r.time}>{timeAgo(reel.creado_en)}</Text>
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
          <Text style={r.actionLbl}>{reel.likes + (liked ? 1 : 0)}</Text>
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
  shadow: { position: "absolute", bottom: 0, left: 0, right: 0, height: 280, background: "linear-gradient(transparent,rgba(0,0,0,0.85))" as any },
  info: { position: "absolute", bottom: 30, left: 14, right: 80, gap: 5 },
  autor: { color: "#fff", fontWeight: "800", fontSize: 15, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  titulo: { color: "#fff", fontWeight: "700", fontSize: 14, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  desc: { color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 17 },
  hint: { color: "rgba(255,255,255,0.4)", fontSize: 11 },
  time: { color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 2 },
  actions: { position: "absolute", bottom: 24, right: 12, gap: 20, alignItems: "center" },
  actionBtn: { alignItems: "center", gap: 3 },
  actionIcon: { fontSize: 30, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  actionLbl: { color: "#fff", fontSize: 11, fontWeight: "700", textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  circle: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 2, borderColor: "#fff", justifyContent: "center", alignItems: "center" },
  circleActive: { backgroundColor: "#1F6FEB", borderColor: "#1F6FEB" },
});

// ─── Modal subir reel ─────────────────────────────────────────────────────────
function ModalSubir({ visible, onClose, onSubido, nombreUsuario, userId, recetaPrevia }: {
  visible: boolean; onClose: () => void; onSubido: () => void;
  nombreUsuario: string; userId: string; recetaPrevia?: string;
}) {
  const { colors } = useApp();
  const [step, setStep] = useState<"receta" | "video">("receta");
  const [recetas, setRecetas] = useState<RecetaItem[]>([]);
  const [recetaElegida, setRecetaElegida] = useState<string>(recetaPrevia ?? "");
  const [modoCrear, setModoCrear] = useState(false);
  // Campos crear receta nueva
  const [nuevaNombre, setNuevaNombre] = useState("");
  const [nuevaDesc, setNuevaDesc] = useState("");
  const [nuevaKcal, setNuevaKcal] = useState("");
  const [nuevaProt, setNuevaProt] = useState("");
  const [nuevaCarbos, setNuevaCarbos] = useState("");
  const [nuevaGrasas, setNuevaGrasas] = useState("");
  const [guardandoReceta, setGuardandoReceta] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [videoFile, setVideoFile] = useState<any>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);

  // Cargar recetas del usuario cuando abre el modal
  useEffect(() => {
    if (!visible || !userId) return;
    supabase.from("recetas").select("id,nombre,descripcion")
      .order("creado_en", { ascending: false })
      .then(({ data }) => setRecetas((data ?? []) as RecetaItem[]));
    // Si viene con receta previa, pasar directo al paso de vídeo
    if (recetaPrevia) { setRecetaElegida(recetaPrevia); setStep("video"); }
    else { setStep("receta"); setRecetaElegida(""); }
  }, [visible, userId, recetaPrevia]);

  const limpiar = () => {
    setStep("receta"); setRecetaElegida(""); setModoCrear(false);
    setNuevaNombre(""); setNuevaDesc(""); setNuevaKcal(""); setNuevaProt(""); setNuevaCarbos(""); setNuevaGrasas("");
    setDescripcion(""); setVideoFile(null); setPreview(null); setSubiendo(false); setProgreso(0);
  };

  const cerrar = () => { limpiar(); onClose(); };

  const elegirReceta = (nombre: string) => { setRecetaElegida(nombre); setStep("video"); };

  const guardarNuevaReceta = async () => {
    const nombre = nuevaNombre.trim();
    if (!nombre) return;
    setGuardandoReceta(true);
    await crearReceta({
      nombre,
      descripcion: nuevaDesc.trim(),
      ingredientes: [],
      calorias_total: parseFloat(nuevaKcal) || 0,
      proteinas_total: parseFloat(nuevaProt) || 0,
      grasas_total: parseFloat(nuevaGrasas) || 0,
      carbohidratos_total: parseFloat(nuevaCarbos) || 0,
    });
    setGuardandoReceta(false);
    elegirReceta(nombre);
  };

  const seleccionarVideo = () => {
    if (Platform.OS !== "web") { Alert.alert("Próximamente", "Subida desde app nativa disponible pronto."); return; }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/mp4,video/webm,video/quicktime,video/*";
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      if (file.size > 500 * 1024 * 1024) { Alert.alert("Demasiado grande", "Máximo 500 MB."); return; }
      // Liberar URL anterior si existe
      if (preview) URL.revokeObjectURL(preview);
      setVideoFile(file);
      setPreview(URL.createObjectURL(file));
    };
    input.click();
  };

  const quitarVideo = () => {
    if (preview) URL.revokeObjectURL(preview);
    setVideoFile(null); setPreview(null);
  };

  const subir = async () => {
    const titulo = recetaElegida.trim();
    if (!titulo) { Alert.alert("", "Selecciona o escribe una receta."); return; }
    if (!videoFile) { Alert.alert("", "Selecciona un vídeo primero."); return; }
    if (!userId) { Alert.alert("Error", "Debes iniciar sesión."); return; }
    setSubiendo(true); setProgreso(5);

    const ext = (videoFile.name ?? "video.mp4").split(".").pop();
    const path = `${userId}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("videos")
      .upload(path, videoFile, { contentType: videoFile.type, upsert: false });

    if (upErr) { setSubiendo(false); Alert.alert("Error al subir", upErr.message); return; }
    setProgreso(78);

    const { data: { publicUrl } } = supabase.storage.from("videos").getPublicUrl(path);

    const { error: dbErr } = await supabase.from("videos_recetas").insert([{
      autor: nombreUsuario || "Anónimo",
      autor_id: userId,
      titulo,
      descripcion: descripcion.trim(),
      video_url: publicUrl,
      likes: 0,
    }]);

    setSubiendo(false);
    if (dbErr) { Alert.alert("Error", dbErr.message); return; }
    setProgreso(100);
    Alert.alert("✓ Publicado", `Reel de «${titulo}» publicado 🎉`);
    limpiar(); onSubido(); onClose();
  };

  const m = makeSubirStyles(colors);
  const tituloReceta = recetaElegida || "";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cerrar}>
      <SafeAreaView style={m.safe}>
        {/* Cabecera */}
        <View style={m.header}>
          <TouchableOpacity onPress={
            modoCrear ? () => setModoCrear(false)
            : step === "video" && !recetaPrevia ? () => setStep("receta")
            : cerrar
          }>
            <Text style={m.back}>
              {modoCrear ? "← Recetas" : step === "video" && !recetaPrevia ? "← Receta" : "✕ Cerrar"}
            </Text>
          </TouchableOpacity>
          <Text style={m.title}>
            {step === "receta" ? "📋 Elige la receta" : `🎬 Vídeo de «${tituloReceta}»`}
          </Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Indicador de pasos */}
        <View style={m.steps}>
          <View style={[m.step, m.stepDone]}><Text style={m.stepTxt}>1 Receta</Text></View>
          <View style={m.stepLine} />
          <View style={[m.step, step === "video" && m.stepDone]}><Text style={m.stepTxt}>2 Vídeo</Text></View>
        </View>

        {/* ── PASO 1: elegir receta ── */}
        {step === "receta" && (
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
                <TextInput
                  style={m.input} value={nuevaNombre} onChangeText={setNuevaNombre}
                  placeholder="Ej: Pasta carbonara casera" placeholderTextColor={colors.textMuted}
                  autoFocus maxLength={80}
                />
                <Text style={[m.nuevaLabel, { marginTop: 12 }]}>Descripción (opcional)</Text>
                <TextInput
                  style={[m.input, { height: 70 }]} value={nuevaDesc} onChangeText={setNuevaDesc}
                  placeholder="Pasos, ingredientes, consejos..." placeholderTextColor={colors.textMuted}
                  multiline numberOfLines={3} maxLength={200}
                />
                <Text style={[m.nuevaLabel, { marginTop: 12 }]}>Macros (opcional)</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                  {[
                    { label: "kcal", val: nuevaKcal, set: setNuevaKcal, color: "#4ADE80" },
                    { label: "Prot g", val: nuevaProt, set: setNuevaProt, color: "#60A5FA" },
                    { label: "Carbos g", val: nuevaCarbos, set: setNuevaCarbos, color: "#FBBF24" },
                    { label: "Grasas g", val: nuevaGrasas, set: setNuevaGrasas, color: "#F87171" },
                  ].map(f => (
                    <View key={f.label} style={{ flex: 1 }}>
                      <Text style={{ color: f.color, fontSize: 10, fontWeight: "700", marginBottom: 3 }}>{f.label}</Text>
                      <TextInput
                        style={[m.input, { paddingVertical: 8, textAlign: "center" }]}
                        value={f.val} onChangeText={f.set}
                        placeholder="0" placeholderTextColor={colors.textMuted}
                        keyboardType="numeric" maxLength={6}
                      />
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <TouchableOpacity style={m.cancelBtn} onPress={() => setModoCrear(false)}>
                    <Text style={m.cancelTxt}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[m.nextBtn, (!nuevaNombre.trim() || guardandoReceta) && m.btnDis]}
                    onPress={guardarNuevaReceta}
                    disabled={!nuevaNombre.trim() || guardandoReceta}
                  >
                    {guardandoReceta
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={m.nextBtnTxt}>Guardar y continuar →</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <View style={{ height: 60 }} />
          </ScrollView>
        )}

        {/* ── PASO 2: vídeo ── */}
        {step === "video" && (
          <ScrollView style={m.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Preview con botón cambiar */}
            {preview ? (
              <View style={m.previewWrap}>
                {Platform.OS === "web"
                  ? (React.createElement as any)("video", {
                      src: preview,
                      style: { width: "100%", height: 300, objectFit: "contain", borderRadius: 14, backgroundColor: "#000" },
                      muted: true, loop: true, autoPlay: true, playsInline: true,
                    })
                  : null
                }
                <TouchableOpacity style={m.changeBtn} onPress={quitarVideo}>
                  <Text style={m.changeBtnTxt}>✕ Quitar y elegir otro vídeo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={m.picker} onPress={seleccionarVideo}>
                <Text style={m.pickerIcon}>📹</Text>
                <Text style={m.pickerTxt}>Toca para seleccionar vídeo</Text>
                <Text style={m.pickerHint}>MP4 · WebM · MOV · hasta 500 MB</Text>
              </TouchableOpacity>
            )}

            <TextInput
              style={[m.input, { height: 90, marginTop: 14 }]}
              value={descripcion} onChangeText={setDescripcion}
              placeholder="Descripción opcional: ingredientes, pasos, consejos..."
              placeholderTextColor={colors.textMuted} multiline numberOfLines={4} maxLength={300}
            />

            {subiendo && (
              <View style={m.progWrap}>
                <View style={[m.progBar, { width: `${progreso}%` as any }]} />
                <Text style={m.progTxt}>Subiendo {progreso}%…</Text>
              </View>
            )}

            <TouchableOpacity
              style={[m.publishBtn, (!videoFile || subiendo) && m.btnDis]}
              onPress={subir} disabled={!videoFile || subiendo}
            >
              {subiendo
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={m.publishTxt}>🎬 Publicar Reel</Text>
              }
            </TouchableOpacity>
            <View style={{ height: 60 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function ReelsScreen() {
  const router = useRouter();
  const { colors, theme } = useApp();
  const params = useLocalSearchParams<{ recetaNombre?: string }>();
  const [tab, setTab] = useState<"parati" | "siguiendo">("parati");
  const [reels, setReels] = useState<Reel[]>([]);
  const [siguiendoReels, setSiguiendoReels] = useState<Reel[]>([]);
  const [cargando, setCargando] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [muted, setMuted] = useState(true);
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

  // Si viene desde recetas.tsx con una receta pre-seleccionada
  useEffect(() => {
    if (params.recetaNombre) {
      setRecetaPrevia(decodeURIComponent(params.recetaNombre));
      setModalSubir(true);
    }
  }, [params.recetaNombre]);

  useFocusEffect(useCallback(() => {
    cargarDatos();
  }, [tab]));

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id ?? "";
      if (uid) setUserId(uid);

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
          setSiguiendoReels((data ?? []).filter((r: any) => r.video_url));
        } else setSiguiendoReels([]);
      }
    } finally { setCargando(false); }
  };

  const handleLike = async (reel: Reel) => {
    const already = likedIds.has(reel.id);
    const next = new Set(likedIds);
    const delta = already ? -1 : 1;
    if (already) next.delete(reel.id); else next.add(reel.id);
    setLikedIds(next);
    await AsyncStorage.setItem(LIKED_KEY, JSON.stringify([...next]));
    await supabase.from("videos_recetas").update({ likes: Math.max(0, reel.likes + delta) }).eq("id", reel.id);
    const upd = (list: Reel[]) => list.map(r => r.id === reel.id ? { ...r, likes: Math.max(0, r.likes + delta) } : r);
    setReels(upd); setSiguiendoReels(upd);
  };

  const handleFollow = async (reel: Reel) => {
    if (!userId) return;
    const siguiendo = seguidosIds.has(reel.autor_id);
    const next = new Set(seguidosIds);
    if (siguiendo) {
      await supabase.from("seguidos").delete().eq("follower_id", userId).eq("followed_id", reel.autor_id);
      next.delete(reel.autor_id);
    } else {
      await supabase.from("seguidos").insert([{ follower_id: userId, follower_nombre: nombreUsuario, followed_id: reel.autor_id, followed_nombre: reel.autor }]);
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

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── Feed ── */}
      {cargando ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : lista.length === 0 ? (
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
            <TouchableOpacity onPress={() => { setTab("parati"); setActiveIdx(0); }}>
              <Text style={[h.tab, tab === "parati" && h.tabActive]}>Para ti</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setTab("siguiendo"); setActiveIdx(0); }}>
              <Text style={[h.tab, tab === "siguiendo" && h.tabActive]}>
                Siguiendo{seguidosIds.size > 0 ? ` (${seguidosIds.size})` : ""}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => { setRecetaPrevia(undefined); setModalSubir(true); }} style={{ minWidth: 70, alignItems: "flex-end" }}>
            <Text style={h.plus}>＋</Text>
          </TouchableOpacity>
        </View>
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
