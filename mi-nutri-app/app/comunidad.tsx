import { useApp } from "@/app/services/i18n";
import { eliminarPublicacion, Receta, supabase } from "@/app/services/supabase";
import { useAvatar } from "@/app/services/useAvatar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type Publicacion = {
  id: string;
  nombre_receta: string;
  descripcion: string;
  ingredientes: any[];
  calorias_total: number;
  proteinas_total: number;
  grasas_total: number;
  carbohidratos_total: number;
  autor: string;
  autor_avatar: string | null;
  valoracion_media: number;
  total_valoraciones: number;
  creado_en: string;
};

type Valoracion = {
  id: string;
  publicacion_id: string;
  autor: string;
  autor_avatar: string | null;
  estrellas: number;
  comentario: string;
  creado_en: string;
};

const NOMBRE_KEY = "nutri_nombre_usuario";
const SAVED_RECIPES_KEY = "nutri_recetas_guardadas";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeNum(v: any): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

// ─── Reintenta obtener la sesión hasta N veces — necesario en web ─────────────
async function getSessionWithRetry(intentos = 5, espera = 600) {
  for (let i = 0; i < intentos; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    await new Promise((r) => setTimeout(r, espera));
  }
  return null;
}

function Estrellas({ valor, size = 16, onPress, starColor }: {
  valor: number;
  size?: number;
  onPress?: (n: number) => void;
  starColor: string;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onPress?.(n)} disabled={!onPress} activeOpacity={0.7}>
          <Text style={{ fontSize: size, color: n <= valor ? "#FBBF24" : starColor }}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Modal detalle de publicación ─────────────────────────────────────────────
function ModalDetalle({
  pub,
  visible,
  onClose,
  nombreUsuario,
  avatarUri,
}: {
  pub: Publicacion | null;
  visible: boolean;
  onClose: () => void;
  nombreUsuario: string;
  avatarUri?: string | null;
}) {
  const { colors, theme } = useApp();
  const [valoraciones, setValoraciones] = useState<Valoracion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [valorAvatarMap, setValorAvatarMap] = useState<Record<string, string>>({});
  const [estrellas, setEstrellas] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tab, setTab] = useState<"info" | "comentarios">("info");
  const [guardada, setGuardada] = useState(false);

  React.useEffect(() => {
    if (pub && visible) {
      cargarValoraciones();
      setEstrellas(0);
      setComentario("");
      setTab("info");
      // Check if this recipe is already saved
      AsyncStorage.getItem(SAVED_RECIPES_KEY).then((raw) => {
        const lista = raw ? JSON.parse(raw) : [];
        setGuardada(lista.some((r: any) => r.pub_id === pub.id));
      });
    }
  }, [pub, visible]);

  const cargarValoraciones = async () => {
    if (!pub) return;
    setCargando(true);
    const { data } = await supabase
      .from("valoraciones_recetas")
      .select("id, publicacion_id, autor, autor_avatar, estrellas, comentario, creado_en")
      .eq("publicacion_id", pub.id)
      .order("creado_en", { ascending: false });
    const lista = (data || []).map((v: any) => ({ ...v, autor_avatar: v.autor_avatar ?? null }));
    setValoraciones(lista);
    // Cargar fotos de perfil actuales de los comentaristas
    const uniqueAuthors = [...new Set(lista.map((v: any) => v.autor).filter(Boolean))];
    if (uniqueAuthors.length > 0) {
      const { data: perfilesData } = await supabase.from("perfiles").select("nombre, avatar_url").in("nombre", uniqueAuthors as string[]);
      const map: Record<string, string> = {};
      (perfilesData || []).forEach((p: any) => { if (p.nombre && p.avatar_url) map[p.nombre] = p.avatar_url; });
      setValorAvatarMap(map);
    }
    setCargando(false);
  };

  const enviarValoracion = async () => {
    if (!pub) return;
    if (estrellas === 0) { Alert.alert("", "Selecciona una puntuación de 1 a 5 estrellas."); return; }
    setEnviando(true);
    const { error } = await supabase.from("valoraciones_recetas").insert([{
      publicacion_id: pub.id,
      autor: nombreUsuario || "Anónimo",
      autor_avatar: avatarUri || null,
      estrellas,
      comentario: comentario.trim(),
    }]);
    if (error) { Alert.alert("Error", "No se pudo enviar."); setEnviando(false); return; }

    const { data: todas } = await supabase
      .from("valoraciones_recetas")
      .select("estrellas")
      .eq("publicacion_id", pub.id);
    if (todas && todas.length > 0) {
      const media = todas.reduce((a, v) => a + v.estrellas, 0) / todas.length;
      await supabase
        .from("publicaciones_recetas")
        .update({ valoracion_media: Math.round(media * 10) / 10, total_valoraciones: todas.length })
        .eq("id", pub.id);
    }

    setEstrellas(0);
    setComentario("");
    setEnviando(false);
    cargarValoraciones();
    Alert.alert("✓ Enviado", "Tu valoración ha sido publicada.");
  };

  const toggleGuardar = async () => {
    if (!pub) return;
    const raw = await AsyncStorage.getItem(SAVED_RECIPES_KEY);
    const lista = raw ? JSON.parse(raw) : [];
    if (guardada) {
      const nueva = lista.filter((r: any) => r.pub_id !== pub.id);
      await AsyncStorage.setItem(SAVED_RECIPES_KEY, JSON.stringify(nueva));
      setGuardada(false);
    } else {
      const nueva = [{ pub_id: pub.id, nombre: pub.nombre_receta, descripcion: pub.descripcion, ingredientes: pub.ingredientes, calorias_total: pub.calorias_total, proteinas_total: pub.proteinas_total, grasas_total: pub.grasas_total, carbohidratos_total: pub.carbohidratos_total, autor: pub.autor, savedAt: Date.now() }, ...lista];
      await AsyncStorage.setItem(SAVED_RECIPES_KEY, JSON.stringify(nueva));
      setGuardada(true);
      Alert.alert("✓ Guardada", "Receta guardada en tu sección de Recetas → Guardadas.");
    }
  };

  const anadirAlDia = async () => {
    if (!pub) return;
    try {
      const d = new Date();
      const key = `nutri_meals_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const stored = await AsyncStorage.getItem(key);
      const meals = stored ? JSON.parse(stored) : { desayuno: [], comida: [], merienda: [], cena: [] };
      meals.comida = [...meals.comida, {
        id: Date.now().toString(),
        name: pub.nombre_receta,
        brand: "Receta comunidad",
        supermercado: "Receta propia",
        calories: Math.round(safeNum(pub.calorias_total)),
        protein: Number(safeNum(pub.proteinas_total).toFixed(1)),
        carbs: Number(safeNum(pub.carbohidratos_total).toFixed(1)),
        fat: Number(safeNum(pub.grasas_total).toFixed(1)),
        saturatedFat: 0, sugar: 0, fiber: 0, salt: 0, per100: null,
      }];
      await AsyncStorage.setItem(key, JSON.stringify(meals));
      Alert.alert("✓ Añadido", `${pub.nombre_receta} añadido a Comida de hoy.`);
    } catch { Alert.alert("Error", "No se pudo añadir al día."); }
  };

  if (!pub) return null;

  const d = makeDetalleStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={d.safe}>
        <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
        <View style={d.header}>
          <TouchableOpacity onPress={onClose}><Text style={d.close}>← Volver</Text></TouchableOpacity>
          <View style={d.headerInfo}>
            <Text style={d.nombre} numberOfLines={2}>{pub.nombre_receta}</Text>
            <Text style={d.autor}>por {pub.autor} · {timeAgo(pub.creado_en)}</Text>
          </View>
        </View>

        <View style={d.tabs}>
          <TouchableOpacity style={[d.tab, tab === "info" && d.tabActive]} onPress={() => setTab("info")}>
            <Text style={[d.tabText, tab === "info" && d.tabTextActive]}>📋 Receta</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[d.tab, tab === "comentarios" && d.tabActive]} onPress={() => setTab("comentarios")}>
            <Text style={[d.tabText, tab === "comentarios" && d.tabTextActive]}>
              💬 Comentarios {valoraciones.length > 0 ? `(${valoraciones.length})` : ""}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={d.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {tab === "info" && (
            <>
              <View style={d.card}>
                <View style={d.ratingRow}>
                  <Estrellas valor={Math.round(pub.valoracion_media)} size={22} starColor={colors.cardBorder} />
                  <Text style={d.ratingNum}>{pub.valoracion_media > 0 ? pub.valoracion_media.toFixed(1) : "—"}</Text>
                  <Text style={d.ratingTotal}>{pub.total_valoraciones > 0 ? `${pub.total_valoraciones} valoración${pub.total_valoraciones !== 1 ? "es" : ""}` : "Sin valoraciones"}</Text>
                </View>
              </View>

              {pub.descripcion ? (
                <View style={d.card}>
                  <Text style={d.cardTitle}>📝 Descripción</Text>
                  <Text style={d.descripcion}>{pub.descripcion}</Text>
                </View>
              ) : null}

              <View style={d.card}>
                <Text style={d.cardTitle}>📊 Macros totales</Text>
                <View style={d.macrosRow}>
                  {[
                    { val: Math.round(safeNum(pub.calorias_total)), label: "kcal", color: "#4ADE80" },
                    { val: Math.round(safeNum(pub.proteinas_total)) + "g", label: "Prot", color: "#60A5FA" },
                    { val: Math.round(safeNum(pub.carbohidratos_total)) + "g", label: "Carbos", color: "#FBBF24" },
                    { val: Math.round(safeNum(pub.grasas_total)) + "g", label: "Grasas", color: "#F87171" },
                  ].map((item) => (
                    <View key={item.label} style={d.macroBox}>
                      <Text style={[d.macroVal, { color: item.color }]}>{item.val}</Text>
                      <Text style={d.macroLabel}>{item.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {pub.ingredientes && pub.ingredientes.length > 0 && (
                <View style={d.card}>
                  <Text style={d.cardTitle}>🥗 Ingredientes</Text>
                  <View style={d.ingList}>
                    {pub.ingredientes.map((ing: any, i: number) => (
                      <View key={i} style={d.ingPill}>
                        <Text style={d.ingPillText}>{ing.nombre} {ing.gramos}g</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <TouchableOpacity style={d.addDayBtn} onPress={anadirAlDia}>
                <Text style={d.addDayBtnText}>+ Añadir a mi día de hoy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[d.saveBtn, guardada && d.saveBtnActive]} onPress={toggleGuardar}>
                <Text style={[d.saveBtnText, guardada && d.saveBtnTextActive]}>
                  {guardada ? "🔖 Guardada en Mis Recetas" : "🔖 Guardar receta"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {tab === "comentarios" && (
            <>
              <View style={d.card}>
                <View style={d.commentAuthorRow}>
                  {avatarUri
                    ? <Image source={{ uri: avatarUri }} style={{ width: 34, height: 34, borderRadius: 17, marginRight: 8 }} />
                    : <View style={[d.avatar, { marginRight: 8 }]}><Text style={d.avatarText}>{(nombreUsuario || "A")[0].toUpperCase()}</Text></View>
                  }
                  <Text style={[d.commentAuthor, { fontSize: 15 }]}>{nombreUsuario || "Tú"}</Text>
                </View>
                <Text style={[d.cardTitle, { marginTop: 10 }]}>⭐ Tu valoración</Text>
                <View style={d.starsRow}>
                  <Estrellas valor={estrellas} size={32} onPress={setEstrellas} starColor={colors.cardBorder} />
                  {estrellas > 0 && (
                    <Text style={d.starsLabel}>
                      {["", "Malo", "Regular", "Bien", "Muy bien", "Excelente"][estrellas]}
                    </Text>
                  )}
                </View>
                <TextInput
                  style={d.commentInput}
                  value={comentario}
                  onChangeText={setComentario}
                  placeholder="Escribe un comentario o pregunta... (opcional)"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={3}
                />
                <TouchableOpacity
                  style={[d.sendBtn, (enviando || estrellas === 0) && d.sendBtnDisabled]}
                  onPress={enviarValoracion}
                  disabled={enviando || estrellas === 0}
                >
                  {enviando
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={d.sendBtnText}>Publicar valoración</Text>
                  }
                </TouchableOpacity>
              </View>

              {cargando ? (
                <ActivityIndicator color="#58A6FF" style={{ marginTop: 20 }} />
              ) : valoraciones.length === 0 ? (
                <View style={d.emptyComments}>
                  <Text style={d.emptyCommentsIcon}>💬</Text>
                  <Text style={d.emptyCommentsText}>Sé el primero en valorar esta receta</Text>
                </View>
              ) : (
                valoraciones.map((v) => (
                  <View key={v.id} style={d.commentCard}>
                    <View style={d.commentHeader}>
                      <View style={d.commentAuthorRow}>
                        {(valorAvatarMap[v.autor] ?? (v.autor === nombreUsuario ? avatarUri : null) ?? v.autor_avatar)
                          ? <Image source={{ uri: (valorAvatarMap[v.autor] ?? (v.autor === nombreUsuario ? avatarUri : null) ?? v.autor_avatar)! }} style={{ width: 32, height: 32, borderRadius: 16, marginRight: 8 }} />
                          : <View style={d.avatar}><Text style={d.avatarText}>{(v.autor || "A")[0].toUpperCase()}</Text></View>
                        }
                        <View>
                          <Text style={d.commentAuthor}>{v.autor}</Text>
                          <Text style={d.commentTime}>{timeAgo(v.creado_en)}</Text>
                        </View>
                      </View>
                      <Estrellas valor={v.estrellas} size={14} starColor={colors.cardBorder} />
                    </View>
                    {v.comentario ? <Text style={d.commentText}>{v.comentario}</Text> : null}
                  </View>
                ))
              )}
            </>
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Modal publicar receta ─────────────────────────────────────────────────────
function ModalPublicar({
  visible,
  onClose,
  onPublicado,
  nombreUsuario,
  avatarUri,
}: {
  visible: boolean;
  onClose: () => void;
  onPublicado: () => void;
  nombreUsuario: string;
  avatarUri?: string | null;
}) {
  const { colors, theme } = useApp();
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [seleccionada, setSeleccionada] = useState<Receta | null>(null);
  const [publicando, setPublicando] = useState(false);

  React.useEffect(() => {
    if (visible) cargarMisRecetas();
  }, [visible]);

  const cargarMisRecetas = async () => {
    const { data } = await supabase.from("recetas").select("*").order("creado_en", { ascending: false });
    const limpias = (data || [])
      .filter((r: any) => r && r.nombre)
      .map((r: any) => ({
        id: r.id ?? "",
        nombre: r.nombre ?? "",
        descripcion: r.descripcion ?? "",
        ingredientes: r.ingredientes ?? [],
        calorias_total: safeNum(r.calorias_total),
        proteinas_total: safeNum(r.proteinas_total),
        grasas_total: safeNum(r.grasas_total),
        carbohidratos_total: safeNum(r.carbohidratos_total),
      }));
    setRecetas(limpias);
  };

  const publicar = async () => {
    if (!seleccionada) { Alert.alert("", "Selecciona una receta para publicar."); return; }
    setPublicando(true);
    // Verificar que el usuario no ha publicado ya esta receta
    const { data: existing } = await supabase
      .from("publicaciones_recetas")
      .select("id")
      .eq("autor", nombreUsuario || "Anónimo")
      .eq("nombre_receta", seleccionada.nombre)
      .limit(1);
    if (existing && existing.length > 0) {
      setPublicando(false);
      Alert.alert("Ya publicada", "Ya has compartido esta receta en la comunidad. Elimínala si quieres volver a publicarla.");
      return;
    }
    const { error } = await supabase.from("publicaciones_recetas").insert([{
      nombre_receta: seleccionada.nombre,
      descripcion: seleccionada.descripcion || "",
      ingredientes: seleccionada.ingredientes || [],
      calorias_total: safeNum(seleccionada.calorias_total),
      proteinas_total: safeNum(seleccionada.proteinas_total),
      grasas_total: safeNum(seleccionada.grasas_total),
      carbohidratos_total: safeNum(seleccionada.carbohidratos_total),
      autor: nombreUsuario || "Anónimo",
      autor_avatar: avatarUri || null,
    }]);
    setPublicando(false);
    if (error) { Alert.alert("Error", "No se pudo publicar."); return; }
    Alert.alert("✓ Publicada", "Tu receta ya está visible para toda la comunidad.");
    setSeleccionada(null);
    onPublicado();
    onClose();
  };

  const p = makePublicarStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={p.safe}>
        <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
        <View style={p.header}>
          <TouchableOpacity onPress={onClose}><Text style={p.close}>✕ Cerrar</Text></TouchableOpacity>
          <Text style={p.title}>Publicar receta</Text>
          <Text style={p.subtitle}>Elige una de tus recetas para compartir con la comunidad</Text>
        </View>
        <ScrollView style={p.scroll} showsVerticalScrollIndicator={false}>
          {recetas.length === 0 ? (
            <View style={p.empty}>
              <Text style={p.emptyIcon}>🍳</Text>
              <Text style={p.emptyText}>No tienes recetas guardadas todavía.</Text>
              <Text style={p.emptySubText}>Crea una receta primero desde la sección Recetas.</Text>
            </View>
          ) : (
            recetas.map((r) => {
              const activa = seleccionada?.id === r.id;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[p.recetaCard, activa && p.recetaCardActive]}
                  onPress={() => setSeleccionada(r)}
                  activeOpacity={0.7}
                >
                  <View style={p.recetaLeft}>
                    <Text style={p.recetaNombre}>{r.nombre}</Text>
                    {r.descripcion ? <Text style={p.recetaDesc} numberOfLines={1}>{r.descripcion}</Text> : null}
                    <View style={p.macrosRow}>
                      {[
                        { val: Math.round(safeNum(r.calorias_total)), label: "kcal", color: "#4ADE80" },
                        { val: Math.round(safeNum(r.proteinas_total)) + "g", label: "P", color: "#60A5FA" },
                        { val: Math.round(safeNum(r.carbohidratos_total)) + "g", label: "C", color: "#FBBF24" },
                        { val: Math.round(safeNum(r.grasas_total)) + "g", label: "G", color: "#F87171" },
                      ].map((m) => (
                        <Text key={m.label} style={{ color: m.color, fontSize: 12, fontWeight: "700" }}>
                          {m.val}<Text style={{ color: colors.textMuted, fontWeight: "400" }}>{m.label} </Text>
                        </Text>
                      ))}
                    </View>
                  </View>
                  <View style={[p.radio, activa && p.radioActive]}>
                    {activa && <View style={p.radioDot} />}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          {seleccionada && (
            <TouchableOpacity
              style={[p.publishBtn, publicando && p.publishBtnDisabled]}
              onPress={publicar}
              disabled={publicando}
            >
              {publicando
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={p.publishBtnText}>🌍 Publicar en la comunidad</Text>
              }
            </TouchableOpacity>
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Pantalla principal ────────────────────────────────────────────────────────
export default function ComunidadScreen() {
  const router = useRouter();
  const { colors, theme } = useApp();
  const avatarUri = useAvatar();
  const [publicaciones, setPublicaciones] = useState<Publicacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalDetalle, setModalDetalle] = useState<Publicacion | null>(null);
  const [modalPublicar, setModalPublicar] = useState(false);
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [filtro, setFiltro] = useState<"recientes" | "mejor_valoradas">("recientes");
  const [confirmarBorrar, setConfirmarBorrar] = useState<Publicacion | null>(null);
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});

  useFocusEffect(useCallback(() => {
    cargarPublicaciones();
    cargarNombre();
  }, [filtro]));

  const cargarNombre = async () => {
    try {
      const session = await getSessionWithRetry();
      if (!session?.user) return;
      const { data } = await supabase
        .from("perfiles")
        .select("nombre")
        .eq("id", session.user.id)
        .single();
      if (data?.nombre) setNombreUsuario(data.nombre);
    } catch {}
  };

  const cargarPublicaciones = async () => {
    setCargando(true);
    const order = filtro === "mejor_valoradas" ? "valoracion_media" : "creado_en";
    const { data } = await supabase
      .from("publicaciones_recetas")
      .select("*")
      .order(order, { ascending: false })
      .limit(50);
    const limpias = (data || [])
      .filter((item: any) => item && item.nombre_receta)
      .map((item: any) => ({
        id: item.id ?? "",
        nombre_receta: item.nombre_receta ?? "",
        descripcion: item.descripcion ?? "",
        ingredientes: item.ingredientes ?? [],
        calorias_total: safeNum(item.calorias_total),
        proteinas_total: safeNum(item.proteinas_total),
        grasas_total: safeNum(item.grasas_total),
        carbohidratos_total: safeNum(item.carbohidratos_total),
        autor: item.autor ?? "Anónimo",
        autor_avatar: item.autor_avatar ?? null,
        valoracion_media: safeNum(item.valoracion_media),
        total_valoraciones: safeNum(item.total_valoraciones),
        creado_en: item.creado_en ?? new Date().toISOString(),
      }));
    setPublicaciones(limpias);
    // Cargar fotos de perfil actuales para todos los autores
    const uniqueAuthors = [...new Set(limpias.map((p: any) => p.autor).filter(Boolean))];
    if (uniqueAuthors.length > 0) {
      const { data: perfilesData } = await supabase.from("perfiles").select("nombre, avatar_url").in("nombre", uniqueAuthors as string[]);
      const map: Record<string, string> = {};
      (perfilesData || []).forEach((p: any) => { if (p.nombre && p.avatar_url) map[p.nombre] = p.avatar_url; });
      setAvatarMap(map);
    }
    setCargando(false);
  };

  // ── NUEVO: eliminar publicación propia ────────────────────────────────────
  const borrarPublicacion = (pub: Publicacion) => setConfirmarBorrar(pub);

  const confirmarEliminarPublicacion = async () => {
    if (!confirmarBorrar) return;
    const ok = await eliminarPublicacion(confirmarBorrar.id);
    setConfirmarBorrar(null);
    if (!ok) {
      Alert.alert("Error", "No se pudo eliminar la publicación.");
      return;
    }
    cargarPublicaciones();
  };

  const s = makePrincipalStyles(colors);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />

      <ModalDetalle
        pub={modalDetalle}
        visible={!!modalDetalle}
        onClose={() => setModalDetalle(null)}
        nombreUsuario={nombreUsuario}
        avatarUri={avatarUri}
      />
      <ModalPublicar
        visible={modalPublicar}
        onClose={() => setModalPublicar(false)}
        onPublicado={cargarPublicaciones}
        nombreUsuario={nombreUsuario}
        avatarUri={avatarUri}
      />

      <View style={s.header}>
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>← Volver</Text></TouchableOpacity>
          {avatarUri
            ? <Image source={{ uri: avatarUri }} style={{ width: 32, height: 32, borderRadius: 16 }} />
            : null
          }
        </View>
        <View style={s.headerRow}>
          <View>
            <Text style={s.title}>Comunidad</Text>
            <Text style={s.subtitle}>Recetas de otros usuarios</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity style={[s.publishBtn, { backgroundColor: "#7C3AED22", borderColor: "#7C3AED55" }]} onPress={() => router.push("/reels")}>
              <Text style={[s.publishBtnText, { color: "#A78BFA" }]}>📹 Reels</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.publishBtn} onPress={() => setModalPublicar(true)}>
              <Text style={s.publishBtnText}>+ Publicar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.filtros}>
          <TouchableOpacity
            style={[s.filtroBtn, filtro === "recientes" && s.filtroBtnActive]}
            onPress={() => setFiltro("recientes")}
          >
            <Text style={[s.filtroBtnText, filtro === "recientes" && s.filtroBtnTextActive]}>🕐 Recientes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.filtroBtn, filtro === "mejor_valoradas" && s.filtroBtnActive]}
            onPress={() => setFiltro("mejor_valoradas")}
          >
            <Text style={[s.filtroBtnText, filtro === "mejor_valoradas" && s.filtroBtnTextActive]}>⭐ Mejor valoradas</Text>
          </TouchableOpacity>
        </View>
      </View>

      {cargando ? (
        <ActivityIndicator color="#58A6FF" style={{ marginTop: 40 }} />
      ) : publicaciones.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>👨‍🍳</Text>
          <Text style={s.emptyTitle}>Sin publicaciones todavía</Text>
          <Text style={s.emptyText}>Sé el primero en compartir una receta con la comunidad</Text>
          <TouchableOpacity style={s.publishBtn} onPress={() => setModalPublicar(true)}>
            <Text style={s.publishBtnText}>+ Publicar mi primera receta</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
          {publicaciones.map((pub) => (
            <TouchableOpacity
              key={pub.id}
              style={s.card}
              onPress={() => setModalDetalle(pub)}
              activeOpacity={0.7}
            >
              <View style={s.cardHeader}>
                {(avatarMap[pub.autor] ?? (pub.autor === nombreUsuario ? avatarUri : null) ?? pub.autor_avatar)
                  ? <Image source={{ uri: (avatarMap[pub.autor] ?? (pub.autor === nombreUsuario ? avatarUri : null) ?? pub.autor_avatar)! }} style={{ width: 34, height: 34, borderRadius: 17, marginRight: 8 }} />
                  : <View style={s.avatarSmall}><Text style={s.avatarSmallText}>{(pub.autor || "A")[0].toUpperCase()}</Text></View>
                }
                <View style={s.cardAuthorInfo}>
                  <Text style={s.cardAuthor}>{pub.autor}</Text>
                  <Text style={s.cardTime}>{timeAgo(pub.creado_en)}</Text>
                </View>
                {pub.total_valoraciones > 0 && (
                  <View style={s.badgeValoracion}>
                    <Text style={s.badgeValoracionText}>★ {pub.valoracion_media.toFixed(1)}</Text>
                  </View>
                )}
                {/* ── NUEVO: botón eliminar solo visible para el autor ── */}
                {pub.autor === nombreUsuario && (
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation(); borrarPublicacion(pub); }}
                    style={s.deleteBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={s.deleteBtnText}>🗑️</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={s.cardNombre}>{pub.nombre_receta}</Text>
              {pub.descripcion ? <Text style={s.cardDesc} numberOfLines={2}>{pub.descripcion}</Text> : null}

              <View style={s.macrosRow}>
                {[
                  { val: Math.round(safeNum(pub.calorias_total)), label: "kcal", color: "#4ADE80" },
                  { val: Math.round(safeNum(pub.proteinas_total)) + "g", label: "Prot", color: "#60A5FA" },
                  { val: Math.round(safeNum(pub.carbohidratos_total)) + "g", label: "Carbos", color: "#FBBF24" },
                  { val: Math.round(safeNum(pub.grasas_total)) + "g", label: "Grasas", color: "#F87171" },
                ].map((item) => (
                  <View key={item.label} style={s.macroChip}>
                    <Text style={[s.macroChipVal, { color: item.color }]}>{item.val}</Text>
                    <Text style={s.macroChipLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>

              <View style={s.cardFooter}>
                <Estrellas valor={Math.round(pub.valoracion_media)} size={13} starColor={colors.cardBorder} />
                <Text style={s.cardFooterText}>
                  {pub.total_valoraciones > 0
                    ? `${pub.total_valoraciones} valoración${pub.total_valoraciones !== 1 ? "es" : ""}`
                    : "Sin valoraciones aún"}
                </Text>
                <Text style={s.cardVerMas}>Ver receta →</Text>
              </View>
            </TouchableOpacity>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Modal confirmación borrar publicación */}
      <Modal visible={!!confirmarBorrar} transparent animationType="fade" onRequestClose={() => setConfirmarBorrar(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmarBorrar(null)}>
          <TouchableOpacity activeOpacity={1} style={s.popup}>
            <Text style={s.popupTitle}>🗑️ Eliminar publicación</Text>
            <Text style={s.popupSubtitle}>¿Seguro que quieres eliminar "{confirmarBorrar?.nombre_receta}" de la comunidad? Esta acción no se puede deshacer.</Text>
            <View style={s.popupBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmarBorrar(null)}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.deleteConfirmBtn} onPress={confirmarEliminarPublicacion}>
                <Text style={s.confirmText}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Estilos pantalla principal ───────────────────────────────────────────────
function makePrincipalStyles(colors: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { flex: 1, paddingHorizontal: 16 },
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 10 },
    topBar: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
    back: { color: "#58A6FF", fontSize: 14 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    title: { color: colors.text, fontSize: 26, fontWeight: "800" },
    subtitle: { color: colors.textMuted, fontSize: 13 },
    publishBtn: { backgroundColor: "#7C3AED", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
    publishBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
    filtros: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.cardBorder, gap: 4 },
    filtroBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
    filtroBtnActive: { backgroundColor: "#1F6FEB" },
    filtroBtnText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
    filtroBtnTextActive: { color: "#fff", fontWeight: "700" },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 },
    emptyIcon: { fontSize: 56 },
    emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: "center", paddingHorizontal: 30 },
    card: { backgroundColor: colors.card, borderRadius: 20, padding: 16, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.cardBorder, gap: 10 },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
    avatarSmall: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#1F6FEB33", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#1F6FEB55" },
    avatarSmallText: { color: "#58A6FF", fontSize: 14, fontWeight: "800" },
    cardAuthorInfo: { flex: 1 },
    cardAuthor: { color: colors.text, fontSize: 13, fontWeight: "700" },
    cardTime: { color: colors.textMuted, fontSize: 11 },
    badgeValoracion: { backgroundColor: "#FBBF2422", borderWidth: 1, borderColor: "#FBBF2455", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    badgeValoracionText: { color: "#FBBF24", fontSize: 12, fontWeight: "700" },
    // ── NUEVO: estilos para el botón eliminar en comunidad ──
    deleteBtn: { padding: 4 },
    deleteBtnText: { fontSize: 16 },
    cardNombre: { color: colors.text, fontSize: 17, fontWeight: "800" },
    cardDesc: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
    macrosRow: { flexDirection: "row", gap: 6 },
    macroChip: { flex: 1, backgroundColor: colors.bg, borderRadius: 8, paddingVertical: 7, alignItems: "center" },
    macroChipVal: { fontSize: 13, fontWeight: "800" },
    macroChipLabel: { color: colors.textMuted, fontSize: 10, marginTop: 1 },
    cardFooter: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.cardBorder },
    cardFooterText: { flex: 1, color: colors.textMuted, fontSize: 12 },
    cardVerMas: { color: "#58A6FF", fontSize: 13, fontWeight: "600" },
    overlay: { flex: 1, backgroundColor: "#000000CC", justifyContent: "center", alignItems: "center", padding: 24 },
    popup: { backgroundColor: colors.card, borderRadius: 24, padding: 24, width: "100%", borderWidth: 1, borderColor: colors.cardBorder, gap: 16 },
    popupTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
    popupSubtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    popupBtns: { flexDirection: "row", gap: 10 },
    cancelBtn: { flex: 1, backgroundColor: colors.cardBorder, borderRadius: 12, padding: 14, alignItems: "center" },
    cancelText: { color: colors.textSub, fontWeight: "700", fontSize: 15 },
    deleteConfirmBtn: { flex: 1, backgroundColor: "#EF4444", borderRadius: 12, padding: 14, alignItems: "center" },
    confirmText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  });
}

// ─── Estilos modal detalle ────────────────────────────────────────────────────
function makeDetalleStyles(colors: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { flex: 1, paddingHorizontal: 16 },
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 6 },
    close: { color: "#58A6FF", fontSize: 14 },
    headerInfo: { gap: 2 },
    nombre: { color: colors.text, fontSize: 22, fontWeight: "800" },
    autor: { color: colors.textMuted, fontSize: 13 },
    tabs: { flexDirection: "row", marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.cardBorder, marginBottom: 4 },
    tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
    tabActive: { backgroundColor: "#1F6FEB" },
    tabText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
    tabTextActive: { color: "#fff", fontWeight: "700" },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.cardBorder, gap: 10 },
    cardTitle: { color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    ratingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    ratingNum: { color: "#FBBF24", fontSize: 22, fontWeight: "800" },
    ratingTotal: { color: colors.textMuted, fontSize: 13 },
    descripcion: { color: colors.text, fontSize: 14, lineHeight: 20 },
    macrosRow: { flexDirection: "row", gap: 8 },
    macroBox: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, padding: 10, alignItems: "center" },
    macroVal: { fontSize: 16, fontWeight: "800" },
    macroLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
    ingList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    ingPill: { backgroundColor: colors.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.cardBorder },
    ingPillText: { color: colors.textSub, fontSize: 11 },
    addDayBtn: { backgroundColor: "#1F6FEB22", borderWidth: 1, borderColor: "#1F6FEB55", borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 12 },
    addDayBtnText: { color: "#58A6FF", fontSize: 14, fontWeight: "700" },
    saveBtn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 12 },
    saveBtnActive: { backgroundColor: "#7C3AED22", borderColor: "#7C3AED" },
    saveBtnText: { color: colors.textMuted, fontSize: 14, fontWeight: "700" },
    saveBtnTextActive: { color: "#A78BFA" },
    starsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    starsLabel: { color: "#FBBF24", fontSize: 14, fontWeight: "700" },
    commentInput: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 10, padding: 12, color: colors.text, fontSize: 14, minHeight: 80, textAlignVertical: "top" },
    sendBtn: { backgroundColor: "#7C3AED", borderRadius: 10, padding: 13, alignItems: "center" },
    sendBtnDisabled: { backgroundColor: "#4C1D95" },
    sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
    emptyComments: { alignItems: "center", paddingTop: 40, gap: 10 },
    emptyCommentsIcon: { fontSize: 40 },
    emptyCommentsText: { color: colors.textMuted, fontSize: 14 },
    commentCard: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.cardBorder, gap: 8 },
    commentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    commentAuthorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#1F6FEB33", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#1F6FEB55" },
    avatarText: { color: "#58A6FF", fontSize: 13, fontWeight: "800" },
    commentAuthor: { color: colors.text, fontSize: 13, fontWeight: "700" },
    commentTime: { color: colors.textMuted, fontSize: 11 },
    commentText: { color: colors.textSub, fontSize: 13, lineHeight: 18 },
  });
}

// ─── Estilos modal publicar ───────────────────────────────────────────────────
function makePublicarStyles(colors: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { flex: 1, paddingHorizontal: 16 },
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 4 },
    close: { color: "#58A6FF", fontSize: 14, marginBottom: 4 },
    title: { color: colors.text, fontSize: 24, fontWeight: "800" },
    subtitle: { color: colors.textMuted, fontSize: 13 },
    empty: { alignItems: "center", paddingTop: 60, gap: 10 },
    emptyIcon: { fontSize: 48 },
    emptyText: { color: colors.text, fontSize: 16, fontWeight: "700" },
    emptySubText: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
    recetaCard: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.cardBorder, flexDirection: "row", alignItems: "center", gap: 12 },
    recetaCardActive: { borderColor: "#7C3AED", backgroundColor: "#7C3AED11" },
    recetaLeft: { flex: 1, gap: 4 },
    recetaNombre: { color: colors.text, fontSize: 15, fontWeight: "700" },
    recetaDesc: { color: colors.textMuted, fontSize: 12 },
    macrosRow: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.cardBorder, alignItems: "center", justifyContent: "center" },
    radioActive: { borderColor: "#7C3AED" },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#7C3AED" },
    publishBtn: { backgroundColor: "#7C3AED", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 16 },
    publishBtnDisabled: { backgroundColor: "#4C1D95" },
    publishBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  });
}