import { useApp } from "@/app/services/i18n";
import { ALIMENTOS_BASICOS } from "@/app/services/alimentosBasicos";
import { useAvatar } from "@/app/services/useAvatar";
import { crearReceta, supabase, type Receta } from "@/app/services/supabase";
import { guardarRecetaEnCloud, quitarRecetaDeCloud } from "@/app/services/cloudSync";
import { AnadirRecetaModal, type MealKey } from "@/app/services/AnadirRecetaModal";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Video, ResizeMode } from "expo-av";
import { Audio } from "expo-av";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, AppState, Dimensions, Image, Modal, PanResponder, Pressable,
  Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View, useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SW } = Dimensions.get("window");
const LIKED_KEY          = "nutri_liked_videos";
const LIKED_HASHTAGS_KEY = "nutri_liked_hashtags";

// Cache de avatares: evita refetch en cada carga del feed, TTL de 5 min
const _avatarCache    = new Map<string, string>();
const _avatarCacheTTL = new Map<string, number>();
const AVATAR_TTL_MS   = 5 * 60 * 1000;

// Filtros disponibles — usado tanto en ModalSubir (cámara) como en VideoPlayer (playback web)
// Base: brightness(1.04) contrast(1.06) saturate(1.08) aplicado siempre como base "creator look"
const BASE_ENHANCE = "brightness(1.04) contrast(1.06) saturate(1.08)";
const FILTERS = [
  { name: "Normal",  icon: "○",  webCss: BASE_ENHANCE,                                                                    overlay: "transparent", opacity: 0 },
  { name: "Vivido",  icon: "🌈", webCss: `${BASE_ENHANCE} saturate(1.7) contrast(1.08)`,                                  overlay: "#FF4400",     opacity: 0.05 },
  { name: "Cálido",  icon: "🌅", webCss: `${BASE_ENHANCE} sepia(0.25) saturate(1.4) brightness(1.06)`,                    overlay: "#FF8800",     opacity: 0.08 },
  { name: "Frío",    icon: "❄️", webCss: `${BASE_ENHANCE} hue-rotate(18deg) saturate(1.2) brightness(1.03)`,              overlay: "#2266FF",     opacity: 0.07 },
  { name: "B&N",     icon: "◑",  webCss: `brightness(1.06) contrast(1.18) grayscale(1)`,                                  overlay: "#888888",     opacity: 0.20 },
  { name: "Fade",    icon: "☁️", webCss: `brightness(1.12) contrast(0.85) saturate(0.75)`,                                overlay: "#ffffff",     opacity: 0.12 },
  { name: "Cine",    icon: "🎞️", webCss: `contrast(1.22) brightness(0.90) saturate(1.35) sepia(0.08)`,                    overlay: "#000000",     opacity: 0.08 },
  { name: "Golden",  icon: "✨", webCss: `${BASE_ENHANCE} sepia(0.15) saturate(1.5) brightness(1.08) hue-rotate(-5deg)`,  overlay: "#FFAA00",     opacity: 0.06 },
  { name: "Moody",   icon: "🌑", webCss: `brightness(0.88) contrast(1.20) saturate(1.15) hue-rotate(5deg)`,              overlay: "#220033",     opacity: 0.12 },
];

type Reel = {
  id: string; autor: string; autor_id: string;
  titulo: string; descripcion: string; video_url: string;
  likes: number; views: number; creado_en: string;
  hashtags: string[]; filtro?: string; camara_frontal?: boolean;
  autor_avatar?: string; cancion?: string; cancion_url?: string; cancion_start?: number;
  fotos?: string[]; language?: string;
  cancion_volumen?: number; mute_video?: boolean;
  comentarios?: number;
};

type MediaClip = {
  id: string;
  uri: string;
  type: "video" | "photo";
  duration: number;          // seconds to display
  transition: "fade" | "zoom" | "slide" | "cut";
  file?: File;               // web: File object
  isNative?: boolean;        // native: local URI
  mimeType?: string;
  fileName?: string;
};

type SongResult = {
  trackId: number; trackName: string; artistName: string;
  previewUrl: string; artworkUrl100: string; trackTimeMillis: number;
  isFullTrack?: boolean;
};

const MUSIC_CATS = [
  { id: "parati",      label: "Para ti",    cat: "pop" },
  { id: "tendencias",  label: "Tendencias", cat: "pop+rock" },
  { id: "reggaeton",   label: "Reggaeton",  cat: "reggaeton" },
  { id: "latino",      label: "Latino",     cat: "latin" },
  { id: "pop",         label: "Pop",        cat: "pop" },
  { id: "electronica", label: "Electrónica",cat: "electronic" },
  { id: "rock",        label: "Rock",       cat: "rock" },
  { id: "lofi",        label: "Lo-fi",      cat: "ambient" },
];

// Efectos de sonido predefinidos para el editor

// Transiciones disponibles para insertar en el timeline
const TRANSITIONS = [
  { id: "fade",   icon: "🌫️", name: "Fade"    },
  { id: "zoom",   icon: "🔍", name: "Zoom"    },
  { id: "swipe",  icon: "👉", name: "Swipe"   },
  { id: "flash",  icon: "⚡", name: "Flash"   },
  { id: "blur",   icon: "💧", name: "Blur"    },
  { id: "rotate", icon: "🌀", name: "Giro"    },
];

// ── Algoritmo de engagement ───────────────────────────────────────────────────
// Mezcla recencia, tasa de engagement (likes/vistas), popularidad absoluta,
// personalización por hashtags y preferencia de idioma (TikTok-style).
function scoreReel(reel: Reel, likedHashtagSet: Set<string>, userLang = "es"): number {
  const ageHours  = (Date.now() - new Date(reel.creado_en).getTime()) / 3_600_000;
  const recency   = Math.exp(-ageHours / 72);                                    // semivida 3 días
  const likesScore = Math.log1p(reel.likes) / 8;                                 // escala log
  const viewsScore = Math.log1p(reel.views) / 10;
  const engRate    = reel.views > 5 ? Math.min(reel.likes / reel.views, 1) : 0;  // viral boost
  const personal   = reel.hashtags?.some(h => likedHashtagSet.has(h)) ? 0.10 : 0;
  const lang       = reel.language;
  const langBoost  = lang === userLang ? 0.15
    : (lang === "en" && userLang !== "en") ? 0.06
    : !lang ? 0.04
    : 0;
  // Aleatoriedad: añade ruido para que el feed sea diferente cada vez
  const randomness = (Math.random() - 0.5) * 0.30;
  return recency * 0.30 + likesScore * 0.20 + engRate * 0.20 + viewsScore * 0.05 + personal + langBoost + randomness;
}
type RecetaItem = { id: string; nombre: string; descripcion?: string };

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".0", "") + "K";
  return String(n);
}


// ─── Selector de música estilo Instagram ──────────────────────────────────────
function MusicPickerModal({ visible, onClose, onSelect, videoDuration = 0 }: {
  visible: boolean; onClose: () => void;
  onSelect: (song: { name: string; url: string; startTime: number }) => void;
  videoDuration?: number;
}) {
  const { t } = useApp();
  const [activeCat, setActiveCat] = useState("parati");
  const [searchQuery, setSearchQuery] = useState("");
  const [songs, setSongs] = useState<SongResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewingUrl, setPreviewingUrl] = useState<string | null>(null);
  const previewRef = useRef<any>(null);
  const cacheRef = useRef<Map<string, SongResult[]>>(new Map());
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp step
  const [selectedTrack, setSelectedTrack] = useState<SongResult | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [playPos, setPlayPos] = useState(0);
  const posIntervalRef = useRef<any>(null);
  const barWidthRef = useRef(0);

  const isVercel = Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname?.includes("vercel");
  const apiBase = isVercel ? "" : (process.env.EXPO_PUBLIC_API_URL || "https://mi-nutri-app-theta.vercel.app");

  const fetchMusic = async (term: string, limit = 25): Promise<SongResult[]> => {
    try {
      const res = await fetch(`${apiBase}/api/music?term=${encodeURIComponent(term)}&limit=${limit}`);
      if (res.ok) {
        const json = await res.json();
        return (json.results ?? []).filter((t: any) => t.previewUrl) as SongResult[];
      }
    } catch {}
    return [];
  };

  const loadCat = async (catId: string) => {
    if (cacheRef.current.has(catId)) { setSongs(cacheRef.current.get(catId)!); return; }
    setLoading(true);
    const cat = MUSIC_CATS.find(c => c.id === catId);
    if (!cat) { setLoading(false); return; }
    try {
      const res = await fetch(`${apiBase}/api/music?cat=${encodeURIComponent(cat.cat)}&limit=25`);
      if (res.ok) {
        const json = await res.json();
        const results = (json.results ?? []).filter((t: any) => t.previewUrl) as SongResult[];
        cacheRef.current.set(catId, results);
        setSongs(results);
        setLoading(false);
        return;
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    if (!visible) return;
    if (!searchQuery.trim()) loadCat(activeCat);
  }, [visible, activeCat]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (debRef.current) clearTimeout(debRef.current);
    if (!q.trim()) { loadCat(activeCat); return; }
    setLoading(true);
    debRef.current = setTimeout(async () => {
      const results = await fetchMusic(q);
      setSongs(results);
      setLoading(false);
    }, 400);
  };

  const stopPreview = () => {
    if (posIntervalRef.current) { clearInterval(posIntervalRef.current); posIntervalRef.current = null; }
    if (previewRef.current) { previewRef.current.pause(); previewRef.current.src = ""; previewRef.current = null; }
    setPreviewingUrl(null);
    setPlayPos(0);
  };

  const togglePreview = (url: string) => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    if (previewingUrl === url) { stopPreview(); return; }
    stopPreview();
    const a = new (window as any).Audio(url);
    a.onended = () => setPreviewingUrl(null);
    a.play().catch(() => {});
    previewRef.current = a;
    setPreviewingUrl(url);
  };

  const selectSong = (track: SongResult) => {
    stopPreview();
    setSelectedTrack(track);
    setStartTime(0);
    setPlayPos(0);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const a = new (window as any).Audio(track.previewUrl);
      a.currentTime = 0;
      a.onended = () => {
        setPreviewingUrl(null);
        if (posIntervalRef.current) { clearInterval(posIntervalRef.current); posIntervalRef.current = null; }
      };
      a.play().catch(() => {});
      previewRef.current = a;
      setPreviewingUrl(track.previewUrl);
      if (posIntervalRef.current) clearInterval(posIntervalRef.current);
      posIntervalRef.current = setInterval(() => {
        if (previewRef.current && !previewRef.current.paused) {
          setPlayPos(Math.floor(previewRef.current.currentTime));
        }
      }, 200);
    }
  };

  const confirmWithTime = () => {
    if (!selectedTrack) return;
    stopPreview();
    onSelect({ name: `${selectedTrack.artistName} · ${selectedTrack.trackName}`, url: selectedTrack.previewUrl, startTime });
    setSelectedTrack(null); setStartTime(0); setPlayPos(0);
    onClose();
  };

  const changeStart = (delta: number) => {
    if (!selectedTrack) return;
    const total = Math.min(Math.floor(selectedTrack.trackTimeMillis / 1000), 30);
    const maxStart = videoDuration > 0 ? Math.max(0, total - videoDuration) : total - 1;
    const next = Math.max(0, Math.min(maxStart, startTime + delta));
    setStartTime(next);
    if (previewRef.current) {
      previewRef.current.currentTime = next;
      if (previewRef.current.paused) {
        previewRef.current.play().catch(() => {});
        if (!posIntervalRef.current) {
          posIntervalRef.current = setInterval(() => {
            if (previewRef.current && !previewRef.current.paused) {
              setPlayPos(Math.floor(previewRef.current.currentTime));
            }
          }, 200);
        }
      }
    }
  };

  const close = () => {
    stopPreview();
    setSearchQuery(""); setSelectedTrack(null); setStartTime(0); setPlayPos(0);
    onClose();
  };

  useEffect(() => { return () => { if (posIntervalRef.current) clearInterval(posIntervalRef.current); }; }, []);

  const fmtMs = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ── Recommended start positions ───────────────────────────────────────────
  // Si hay duración de vídeo, las 3 partes se calculan respetando que la
  // canción tenga que cubrir exactamente esa duración desde el punto elegido.
  const buildRecos = (track: SongResult) => {
    const totalSec = Math.min(Math.floor(track.trackTimeMillis / 1000), 30);
    // Punto máximo de inicio: a partir de aquí la canción no alcanzaría a cubrir el vídeo
    const maxStart = videoDuration > 0 ? Math.max(0, totalSec - videoDuration) : Math.max(0, totalSec - 8);
    const recos = [
      { label: "Intro",  icon: "🎵", time: 0 },
      { label: t.chorus, icon: "⭐", time: Math.round(maxStart * 0.5) },
      { label: t.ending, icon: "🔥", time: maxStart },
    ];
    const seen = new Set<number>();
    return recos.filter(r => { if (seen.has(r.time)) return false; seen.add(r.time); return true; });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0A0F1A" }}>

        {/* ── PASO 2: elegir fragmento ── */}
        {selectedTrack ? (
          <View style={{ flex: 1, paddingHorizontal: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14, paddingBottom: 18, gap: 12 }}>
              <TouchableOpacity onPress={() => { setSelectedTrack(null); setStartTime(0); stopPreview(); }}>
                <Text style={{ color: "#60A5FA", fontSize: 15, fontWeight: "700" }}>‹ {t.back}</Text>
              </TouchableOpacity>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800", flex: 1 }}>{t.chooseFragment}</Text>
            </View>

            {/* Portada + info */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 28 }}>
              <Image source={{ uri: selectedTrack.artworkUrl100 }}
                style={{ width: 72, height: 72, borderRadius: 14 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }} numberOfLines={1}>
                  {selectedTrack.trackName}
                </Text>
                <Text style={{ color: "#64748B", fontSize: 13, marginTop: 3 }}>
                  {selectedTrack.artistName}
                </Text>
                <Text style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>
                  {t.preview}: {fmtMs(selectedTrack.trackTimeMillis)}
                </Text>
              </View>
            </View>

            {/* Selector de tiempo */}
            <Text style={{ color: "#94A3B8", fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginBottom: 12 }}>
              {t.fragmentStart}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 }}>
              <TouchableOpacity onPress={() => changeStart(-5)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#1E2533", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>−5s</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeStart(-1)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#1E2533", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#94A3B8", fontSize: 13 }}>−1s</Text>
              </TouchableOpacity>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={{ color: "#1F6FEB", fontSize: 36, fontWeight: "900" }}>
                  {fmtSec(startTime)}
                </Text>
                <Text style={{ color: "#475569", fontSize: 11 }}>{t.startLabel}</Text>
              </View>
              <TouchableOpacity onPress={() => changeStart(1)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#1E2533", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#94A3B8", fontSize: 13 }}>+1s</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeStart(5)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#1E2533", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>+5s</Text>
              </TouchableOpacity>
            </View>

            {/* Scrubber interactivo */}
            {(() => {
              const totalSec = Math.min(Math.floor(selectedTrack.trackTimeMillis / 1000), 30);
              const maxStart = videoDuration > 0 ? Math.max(0, totalSec - videoDuration) : totalSec - 1;
              const pct = totalSec > 0 ? (startTime / totalSec) * 100 : 0;
              const winPct = videoDuration > 0 && totalSec > 0 ? (videoDuration / totalSec) * 100 : 0;
              const playPct = totalSec > 0 ? (playPos / totalSec) * 100 : 0;
              return (
                <View style={{ marginVertical: 16 }}>
                  {videoDuration > 0 && (
                    <Text style={{ color: "#94A3B8", fontSize: 11, marginBottom: 6, textAlign: "center" }}>
                      Tu vídeo dura {fmtSec(videoDuration)} · la canción cubre ese tramo desde el punto elegido
                    </Text>
                  )}
                  <Pressable
                    onLayout={(e) => { barWidthRef.current = e.nativeEvent.layout.width; }}
                    onPress={(e) => {
                      if (!barWidthRef.current) return;
                      const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidthRef.current));
                      const newTime = Math.min(Math.floor(ratio * totalSec), maxStart);
                      setStartTime(newTime);
                      if (previewRef.current) {
                        previewRef.current.currentTime = newTime;
                        if (previewRef.current.paused) {
                          previewRef.current.play().catch(() => {});
                          if (!posIntervalRef.current) {
                            posIntervalRef.current = setInterval(() => {
                              if (previewRef.current && !previewRef.current.paused) {
                                setPlayPos(Math.floor(previewRef.current.currentTime));
                              }
                            }, 200);
                          }
                        }
                      }
                    }}
                    style={{ paddingVertical: 10 }}
                  >
                    <View style={{ height: 6, backgroundColor: "#1E2533", borderRadius: 3 }}>
                      {/* Ventana del vídeo (tramo que se usará) */}
                      {winPct > 0 && (
                        <View style={{ position: "absolute", left: `${pct}%` as any, top: 0, bottom: 0, width: `${winPct}%` as any, backgroundColor: "#1F6FEB55", borderRadius: 3 }} />
                      )}
                      {/* Punto de inicio */}
                      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%` as any, backgroundColor: "#1F6FEB", borderRadius: 3 }} />
                      {playPos > 0 && (
                        <View style={{ position: "absolute", left: `${playPct}%` as any, top: -4, width: 2, height: 14, backgroundColor: "#4ADE80", borderRadius: 1, marginLeft: -1 }} />
                      )}
                      <View style={{ position: "absolute", left: `${pct}%` as any, top: -5, width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", marginLeft: -8, elevation: 3 }} />
                    </View>
                  </Pressable>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                    <Text style={{ color: "#475569", fontSize: 10 }}>0:00</Text>
                    {playPos > 0 && <Text style={{ color: "#4ADE80", fontSize: 10 }}>▶ {fmtSec(playPos)}</Text>}
                    <Text style={{ color: "#475569", fontSize: 10 }}>{fmtSec(totalSec)}</Text>
                  </View>
                </View>
              );
            })()}

            {/* Secciones recomendadas */}
            <Text style={{ color: "#94A3B8", fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginBottom: 10 }}>
              {t.recommendedParts}
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 32 }}>
              {buildRecos(selectedTrack).map(reco => (
                <TouchableOpacity key={reco.label} onPress={() => {
                  setStartTime(reco.time);
                  if (previewRef.current) {
                    previewRef.current.currentTime = reco.time;
                    if (previewRef.current.paused) previewRef.current.play().catch(() => {});
                  }
                }} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 14,
                  backgroundColor: startTime === reco.time ? "#1F6FEB" : "#1E2533",
                  borderWidth: 1.5,
                  borderColor: startTime === reco.time ? "#1F6FEB" : "#2E3A4E" }}>
                  <Text style={{ fontSize: 18 }}>{reco.icon}</Text>
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700", marginTop: 4 }}>{reco.label}</Text>
                  <Text style={{ color: startTime === reco.time ? "#FFFFFFBB" : "#64748B", fontSize: 11, marginTop: 1 }}>
                    {fmtSec(reco.time)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity onPress={confirmWithTime}
              style={{ backgroundColor: "#1F6FEB", borderRadius: 16, paddingVertical: 16, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "900" }}>
                ✓ {t.useFrom} {fmtSec(startTime)}
              </Text>
            </TouchableOpacity>
          </View>

        ) : (
          /* ── PASO 1: elegir canción ── */
          <>
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 12 }}>
              <TouchableOpacity onPress={close}><Text style={{ color: "#fff", fontSize: 22 }}>✕</Text></TouchableOpacity>
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", flex: 1 }}>{t.addMusic}</Text>
            </View>

            <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: "#1E2533", borderRadius: 14,
              flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 8 }}>
              <Text style={{ fontSize: 16 }}>🔍</Text>
              <TextInput style={{ flex: 1, color: "#fff", fontSize: 15, paddingVertical: 12 }}
                placeholder={t.searchSongOrArtist} placeholderTextColor="#64748B"
                value={searchQuery} onChangeText={handleSearch}
                autoCapitalize="none" autoCorrect={false} />
              {loading && <ActivityIndicator color="#60A5FA" size="small" />}
              {!!searchQuery && (
                <TouchableOpacity onPress={() => { setSearchQuery(""); loadCat(activeCat); }}>
                  <Text style={{ color: "#64748B", fontSize: 16 }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {!searchQuery && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 8, flexGrow: 0 }}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                {MUSIC_CATS.map(cat => {
                  const label = cat.id === "parati" ? t.forYou : cat.id === "tendencias" ? t.trends : cat.id === "electronica" ? t.electronic : cat.label;
                  return (
                  <TouchableOpacity key={cat.id}
                    style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                      backgroundColor: activeCat === cat.id ? "#1F6FEB" : "#1E2533" }}
                    onPress={() => setActiveCat(cat.id)}>
                    <Text style={{ color: activeCat === cat.id ? "#fff" : "#94A3B8", fontSize: 13, fontWeight: "700" }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {songs.map(track => (
                <View key={track.trackId}
                  style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12,
                    gap: 12, borderBottomWidth: 1, borderBottomColor: "#ffffff0A" }}>
                  <Image source={{ uri: track.artworkUrl100 }} style={{ width: 52, height: 52, borderRadius: 10 }} />
                  <TouchableOpacity style={{ flex: 1, gap: 2 }} onPress={() => selectSong(track)}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14, flex: 1 }} numberOfLines={1}>{track.trackName}</Text>
                      {track.isFullTrack && <View style={{ backgroundColor: "#22C55E22", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ color: "#22C55E", fontSize: 9, fontWeight: "700" }}>COMPLETA</Text></View>}
                    </View>
                    <Text style={{ color: "#64748B", fontSize: 12 }} numberOfLines={1}>
                      {track.artistName} · {fmtMs(track.trackTimeMillis)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ width: 36, height: 36, borderRadius: 18,
                      backgroundColor: previewingUrl === track.previewUrl ? "#EF4444" : "#1F6FEB33",
                      alignItems: "center", justifyContent: "center" }}
                    onPress={() => togglePreview(track.previewUrl)}>
                    <Text style={{ fontSize: 14 }}>{previewingUrl === track.previewUrl ? "⏹" : "▶"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#1F6FEB", borderRadius: 12 }}
                    onPress={() => selectSong(track)}>
                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{t.use}</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {!loading && songs.length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 60, gap: 12 }}>
                  <Text style={{ fontSize: 48 }}>🎵</Text>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>{t.noResults}</Text>
                  <Text style={{ color: "#64748B", fontSize: 13 }}>{t.noResultsTry}</Text>
                </View>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Slideshow de fotos ────────────────────────────────────────────────────────
function PhotoSlideshow({ fotos, active, onLastSwipe }: { fotos: string[]; active: boolean; onLastSwipe?: () => void }) {
  const [current, setCurrent] = useState(0);
  const { width: SW } = useWindowDimensions();
  const lastSwipeRef = useRef(0);

  useEffect(() => { if (active) setCurrent(0); }, [active]);

  if (Platform.OS === "web") {
    // Web: CSS scroll-snap horizontal
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {(React.createElement as any)("div", {
          ref: (el: any) => {
            if (el && !el._setup) {
              el._setup = true;
              el.style.cssText = "display:flex;overflow-x:scroll;scroll-snap-type:x mandatory;height:100%;scrollbar-width:none;-webkit-overflow-scrolling:touch;";
              el.addEventListener("scroll", () => {
                const idx = Math.round(el.scrollLeft / el.clientWidth);
                setCurrent(idx);
                // Detectar swipe extra en la última foto
                if (idx >= fotos.length - 1) {
                  const maxScroll = el.scrollWidth - el.clientWidth;
                  if (el.scrollLeft >= maxScroll - 5) {
                    const now = Date.now();
                    if (now - lastSwipeRef.current > 800) {
                      lastSwipeRef.current = now;
                      // Siguiente swipe en la última foto → perfil
                      el._atEnd = true;
                    }
                  }
                } else {
                  el._atEnd = false;
                }
              }, { passive: true });
              // Detectar touch en la última
              el.addEventListener("touchend", () => {
                if (el._atEnd && onLastSwipe) {
                  onLastSwipe();
                  el._atEnd = false;
                }
              });
            }
          },
        },
          fotos.map((uri: string, i: number) =>
            (React.createElement as any)("div", {
              key: i,
              style: { scrollSnapAlign: "start", minWidth: "100%", height: "100%", flexShrink: 0 },
            },
              (React.createElement as any)("img", {
                src: uri,
                style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
              })
            )
          )
        )}
        {fotos.length > 1 && (
          <View style={{ position: "absolute", bottom: 12, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 }} pointerEvents="none">
            {fotos.map((_: string, i: number) => (
              <View key={i} style={{ width: i === current ? 16 : 6, height: 6, borderRadius: 3,
                backgroundColor: i === current ? "#fff" : "rgba(255,255,255,0.4)" }} />
            ))}
          </View>
        )}
      </View>
    );
  }

  // Native: ScrollView horizontal con pagingEnabled
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={e => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
          setCurrent(idx);
        }}
        onMomentumScrollEnd={e => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
          if (idx >= fotos.length - 1 && onLastSwipe) {
            const now = Date.now();
            if (now - lastSwipeRef.current > 800) {
              lastSwipeRef.current = now;
            }
          }
        }}>
        {fotos.map((uri, i) => (
          <View key={i} style={{ width: SW, flex: 1 }}>
            <Image source={{ uri }} style={{ width: SW, flex: 1 }} resizeMode="cover" />
          </View>
        ))}
      </ScrollView>
      {fotos.length > 1 && (
        <View style={{ position: "absolute", bottom: 12, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 }} pointerEvents="none">
          {fotos.map((_, i) => (
            <View key={i} style={{ width: i === current ? 16 : 6, height: 6, borderRadius: 3,
              backgroundColor: i === current ? "#fff" : "rgba(255,255,255,0.4)" }} />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Reproductor ──────────────────────────────────────────────────────────────
function VideoPlayer({ url, active, filtro, camaraFrontal, cancionUrl, cancionStart, cancionVolumen, muteVideo, webMuted, paused, speedUp }: {
  url: string; active: boolean;
  filtro?: string; camaraFrontal?: boolean; cancionUrl?: string; cancionStart?: number;
  cancionVolumen?: number; muteVideo?: boolean; webMuted?: boolean; paused?: boolean; speedUp?: boolean;
}) {
  // Filtro base siempre activo + filtro elegido encima
  const baseFilter = FILTERS[0].webCss; // BASE_ENHANCE siempre
  const extraFilter = filtro && filtro !== "Normal" ? (FILTERS.find(f => f.name === filtro)?.webCss ?? baseFilter) : baseFilter;
  const filterCss = extraFilter;
  const ref = useRef<any>(null);
  const fsRef = useRef<any>(null);
  const musicRef = useRef<any>(null);
  const [webFullscreen, setWebFullscreen] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ── Native refs ───────────────────────────────────────────────────────────
  const nativeVideoRef = useRef<any>(null);
  const nativeMusicRef = useRef<any>(null);

  // ── Limpieza al desmontar ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (musicRef.current) { musicRef.current.pause(); musicRef.current.src = ""; musicRef.current = null; }
    };
  }, []);

  // ── Fade in al activar ───────────────────────────────────────────────────────
  useEffect(() => {
    if (active) {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Volumen balanceado: vídeo al 85%, música al 35% para no solaparse con la voz
  const musicVol = Math.min(cancionVolumen ?? 0.35, 0.40);

  // ── Native: music only (video lo maneja shouldPlay en el componente) ────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    const run = async () => {
      if (active) {
        if (cancionUrl) {
          try {
            await Audio.setAudioModeAsync({
              playsInSilentModeIOS: true,
              allowsRecordingIOS: false,
              staysActiveInBackground: false,
            });
            if (cancelled) return;
            if (!nativeMusicRef.current) {
              const { sound } = await Audio.Sound.createAsync(
                { uri: cancionUrl },
                { isLooping: true, volume: musicVol, positionMillis: (cancionStart ?? 0) * 1000 }
              );
              if (cancelled) { sound.unloadAsync().catch(() => {}); return; }
              nativeMusicRef.current = sound;
            }
            await nativeMusicRef.current?.playAsync?.();
          } catch {}
        }
      } else {
        nativeMusicRef.current?.pauseAsync?.().catch(() => {});
      }
    };
    run();
    return () => { cancelled = true; };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Native music cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      nativeMusicRef.current?.unloadAsync?.().catch(() => {});
    };
  }, []);

  // ── Web: reproducción sincronizada vídeo + música ─────────────────────────
  const activeGenRef = useRef(0); // generación para evitar race conditions
  useEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;
    const el = ref.current;
    el.loop = true;
    el.preload = "auto";

    const gen = ++activeGenRef.current;

    if (!active) {
      el.pause?.();
      if (musicRef.current) { musicRef.current.pause(); musicRef.current.src = ""; musicRef.current = null; }
      return;
    }

    // ── Activo: reproducir ──
    el.muted = (webMuted !== false) || !!muteVideo;
    el.currentTime = 0;
    el.play?.().catch(() => { el.muted = true; el.play?.().catch(() => {}); });

    // Música: crear nueva
    if (musicRef.current) { musicRef.current.pause(); musicRef.current.src = ""; musicRef.current = null; }
    let musicAudio: any = null;
    if (cancionUrl && typeof window !== "undefined" && (window as any).Audio) {
      musicAudio = new (window as any).Audio(cancionUrl);
      musicAudio.loop = false;
      musicAudio.muted = webMuted;
      musicAudio.volume = musicVol;
      musicAudio.preload = "auto";
      musicAudio.currentTime = cancionStart ?? 0;
      musicRef.current = musicAudio;
      musicAudio.play?.().catch(() => {});
    }

    // Sincronizar música cuando el vídeo loopea
    const onTimeUpdate = () => {
      if (gen !== activeGenRef.current || !musicAudio) return;
      if (el.currentTime < 0.3 && musicAudio.currentTime > 1) {
        musicAudio.currentTime = cancionStart ?? 0;
        musicAudio.play?.().catch(() => {});
      }
    };
    el.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      // NO pausar aquí — el efecto de !active se encarga
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Web: sincronizar mute ────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;
    if (ref.current) ref.current.muted = webMuted || !!muteVideo;
    if (musicRef.current) musicRef.current.muted = webMuted;
  }, [webMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Web: visibilitychange — pausa vídeo+música cuando la pestaña se oculta ──
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const handler = () => {
      if (document.hidden) {
        ref.current?.pause?.();
        if (musicRef.current) musicRef.current.pause();
      } else if (active) {
        ref.current?.play?.().catch(() => {});
        if (musicRef.current) musicRef.current.play?.().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Native: AppState — pausa cuando la app va a background ────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        nativeVideoRef.current?.pauseAsync?.().catch(() => {});
        nativeMusicRef.current?.pauseAsync?.().catch(() => {});
      } else if (active) {
        nativeVideoRef.current?.playAsync?.().catch(() => {});
        nativeMusicRef.current?.playAsync?.().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pause/resume ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;
    if (paused) {
      ref.current?.pause?.();
      if (musicRef.current) musicRef.current.pause();
    } else {
      ref.current?.play?.().catch(() => {});
      if (musicRef.current) musicRef.current.play?.().catch(() => {});
    }
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Velocidad 2x ──────────────────────────────────────────────────────────
  useEffect(() => {
    const rate = speedUp ? 2.0 : 1.0;
    if (Platform.OS === "web") {
      if (ref.current) ref.current.playbackRate = rate;
      if (musicRef.current) musicRef.current.playbackRate = rate;
    } else {
      nativeVideoRef.current?.setRateAsync?.(rate, true).catch(() => {});
      nativeMusicRef.current?.setRateAsync?.(rate, true).catch(() => {});
    }
  }, [speedUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fullscreen ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== "web" || !webFullscreen || !fsRef.current) return;
    if (ref.current) fsRef.current.currentTime = ref.current.currentTime ?? 0;
    fsRef.current.muted = true;
    fsRef.current.play?.().catch(() => {});
  }, [webFullscreen]);

  // ── Native: expo-av ───────────────────────────────────────────────────────
  if (Platform.OS !== "web") {
    return (
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <Video
          ref={nativeVideoRef}
          source={{ uri: url }}
          style={{ flex: 1 }}
          resizeMode={ResizeMode.COVER}
          isLooping
          isMuted={!!muteVideo}
          shouldPlay={active && !paused}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ flex: 1, backgroundColor: "#000", opacity: fadeAnim }}>
      {(React.createElement as any)("video", {
        ref,
        src: url,
        preload: "auto",
        style: {
          width: "100%", height: "100%",
          objectFit: "cover",
          display: "block",
          backgroundColor: "#000",
          ...(filterCss ? { filter: filterCss } : {}),
          ...(camaraFrontal ? { transform: "scaleX(-1)", WebkitTransform: "scaleX(-1)" } : {}),
        },
        loop: true,
        playsInline: true,
      })}

      {/* Solo botón pantalla completa */}
      <View style={vid.controls} pointerEvents="box-none">
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
              <TouchableOpacity style={vid.btn} onPress={() => setWebFullscreen(false)}>
                <Text style={vid.btnTxt}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </Animated.View>
  );
}

const vid = StyleSheet.create({
  controls: { position: "absolute", top: 52, right: 10, gap: 8 },
  btn: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 22, width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  btnTxt: { fontSize: 17 },
});

// ─── Tarjeta de reel — estilo TikTok ──────────────────────────────────────────
function ReelItem({ reel, active, liked, onLike, seguido, onFollow, esMio, onDelete, onComentarios, onGuardar, isGuardado, onAnadirAlDia, onOpenProfile }: {
  reel: Reel; active: boolean;
  liked: boolean; onLike: () => void; seguido: boolean; onFollow: () => void;
  esMio: boolean; onDelete: () => void;
  onComentarios: () => void;
  onGuardar: () => void; isGuardado: boolean; onAnadirAlDia: () => void;
  onOpenProfile: () => void;
}) {
  const { t } = useApp();
  const { width: SW, height: SH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [showDesc, setShowDesc] = useState(false);
  const [macros, setMacros] = useState<{ kcal: number; prot: number } | null>(null);
  const isMobile = SW < 768;
  const [webMuted, setWebMuted] = useState(!isMobile);
  const [paused, setPaused] = useState(false);
  const [speedUp, setSpeedUp] = useState(false);
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef(0);
  const swiped = useRef(false);
  const [showBigHeart, setShowBigHeart] = useState(false);
  const bigHeartScale = useRef(new Animated.Value(0)).current;
  const bigHeartOpacity = useRef(new Animated.Value(0)).current;

  // Reset paused cuando cambia de reel
  useEffect(() => { setPaused(false); }, [active]);

  const triggerBigHeart = () => {
    setShowBigHeart(true);
    bigHeartScale.setValue(0.3);
    bigHeartOpacity.setValue(1);
    Animated.parallel([
      Animated.spring(bigHeartScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 12 }),
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(bigHeartOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
    ]).start(() => setShowBigHeart(false));
  };

  const handleVideoTap = () => {
    // Si deslizó o estaba en 2x, no hacer nada
    if (speedUp || swiped.current) { swiped.current = false; return; }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap (o más) → solo dar like, nunca quitar + corazón grande
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      if (!liked) onLike(); // solo dar like si no lo tiene ya
      triggerBigHeart(); // siempre mostrar corazón
      Animated.sequence([
        Animated.spring(likeScale, { toValue: 1.6, useNativeDriver: true, speed: 50, bounciness: 14 }),
        Animated.spring(likeScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }),
      ]).start();
    } else {
      // Single tap → esperar para ver si es double
      tapTimerRef.current = setTimeout(() => {
        setPaused(p => !p);
        tapTimerRef.current = null;
      }, 300);
    }
    lastTapRef.current = now;
  };

  const handleTouchStart = (e: any) => { swipeStartX.current = e.nativeEvent.pageX ?? e.nativeEvent.locationX ?? 0; swiped.current = false; };
  const isPhotoReel = reel.fotos && reel.fotos.length > 0;
  const handleTouchEnd = (e: any) => {
    if (isPhotoReel) return; // photo reels handle swipe via PhotoSlideshow
    const endX = e.nativeEvent.pageX ?? e.nativeEvent.locationX ?? 0;
    const diff = endX - swipeStartX.current;
    if (diff < -80) { swiped.current = true; onOpenProfile(); }
  };

  // Like bounce
  const likeScale = useRef(new Animated.Value(1)).current;
  // Music disc rotation
  const discRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const spin = Animated.loop(
      Animated.timing(discRotate, { toValue: 1, duration: 6000, useNativeDriver: true })
    );
    spin.start();
    return () => { spin.stop(); discRotate.setValue(0); };
  }, [active]);

  useEffect(() => {
    if (!active || macros !== null) return;
    supabase.from("recetas")
      .select("calorias_total,proteinas_total")
      .eq("nombre", reel.titulo)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setMacros({ kcal: Math.round(data.calorias_total), prot: Math.round(data.proteinas_total) });
      });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotate = discRotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const handleLike = () => {
    onLike();
    Animated.sequence([
      Animated.spring(likeScale, { toValue: 1.6, useNativeDriver: true, speed: 50, bounciness: 14 }),
      Animated.spring(likeScale, { toValue: 1,   useNativeDriver: true, speed: 20, bounciness: 4  }),
    ]).start();
  };

  const AVATAR_COLORS = ["#EF4444","#F97316","#EAB308","#22C55E","#3B82F6","#8B5CF6","#EC4899"];
  const avatarLetter = reel.autor ? reel.autor[0].toUpperCase() : "?";
  const avatarColor  = AVATAR_COLORS[(reel.autor?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
  const musicLabel   = reel.cancion ? reel.cancion : `${t.originalSong} · ${reel.autor}`;
  const bottomBase   = insets.bottom + 22;

  // Columna de botones de acción (reutilizada en web y native)
  const ActionButtons = () => (
    <>
      {/* Avatar del autor + botón seguir */}
      <TouchableOpacity activeOpacity={esMio ? 1 : 0.75} onPress={esMio ? undefined : onFollow}
        style={{ alignItems: "center", marginBottom: 6 }}>
        <View style={[r.avatarRing, { borderColor: seguido ? "#1F6FEB" : "#fff" }]}>
          {reel.autor_avatar
            ? <Image source={{ uri: reel.autor_avatar }} style={[r.avatarInnerImg, { overflow: "hidden" } as any]} />
            : <View style={[r.avatarInner, { backgroundColor: avatarColor, overflow: "hidden" }]}>
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "900" }}>{avatarLetter}</Text>
              </View>
          }
        </View>
        {!esMio && (
          <View style={[r.followPill, { backgroundColor: seguido ? "#1F6FEB" : "#FF2D5E" }]}>
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "900", lineHeight: 16 }}>
              {seguido ? "✓" : "+"}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Like */}
      <TouchableOpacity style={r.actionBtn} onPress={handleLike}>
        <Animated.Text style={[r.actionIcon, { transform: [{ scale: likeScale }] }]}>
          {liked ? "❤️" : "🤍"}
        </Animated.Text>
        <Text style={r.actionLbl}>{fmtCount(reel.likes)}</Text>
      </TouchableOpacity>

      {/* Comentarios */}
      <TouchableOpacity style={r.actionBtn} onPress={onComentarios}>
        <View style={r.actionCircle}><Text style={{ fontSize: 20 }}>💬</Text></View>
        <Text style={r.actionLbl}>{reel.comentarios ? fmtCount(reel.comentarios) : "0"}</Text>
      </TouchableOpacity>

      {/* Guardar */}
      {!esMio && (
        <TouchableOpacity style={r.actionBtn} onPress={onGuardar}>
          <View style={[r.actionCircle, isGuardado && { backgroundColor: "rgba(251,191,36,0.22)", borderColor: "#FBBF2455" }]}>
            <Text style={{ fontSize: 20 }}>{isGuardado ? "🔖" : "📌"}</Text>
          </View>
          <Text style={r.actionLbl}>{isGuardado ? "Guardado" : "Guardar"}</Text>
        </TouchableOpacity>
      )}

      {/* Añadir al día */}
      <TouchableOpacity style={r.actionBtn} onPress={onAnadirAlDia}>
        <View style={r.actionCircle}><Text style={{ fontSize: 20 }}>➕</Text></View>
        <Text style={r.actionLbl}>Añadir</Text>
      </TouchableOpacity>

      {/* Borrar (solo propio) */}
      {esMio && (
        <TouchableOpacity style={r.actionBtn} onPress={onDelete}>
          <View style={[r.actionCircle, { backgroundColor: "rgba(239,68,68,0.18)", borderColor: "#EF444455" }]}>
            <Text style={{ fontSize: 20 }}>🗑️</Text>
          </View>
          <Text style={[r.actionLbl, { color: "#EF4444" }]}>{t.delete}</Text>
        </TouchableOpacity>
      )}

      {/* Disco giratorio */}
      <Animated.View style={[r.musicDisc, { transform: [{ rotate }] }]}>
        <Text style={{ fontSize: 16 }}>🎵</Text>
      </Animated.View>
    </>
  );

  // Info del autor/título (abajo del vídeo)
  const InfoOverlay = ({ webMode }: { webMode?: boolean }) => (
    <View style={webMode
      ? { padding: 14, gap: 5 }
      : [r.info, { bottom: bottomBase + 10 }]}
      pointerEvents="none">
      <Text style={r.autor}>@{reel.autor}</Text>
      <Text style={r.titulo}>🍽 {reel.titulo}</Text>
      {macros && (
        <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
          <View style={{ backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: "#FCD34D", fontSize: 11, fontWeight: "700" }}>🔥 {macros.kcal} kcal</Text>
          </View>
          <View style={{ backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: "#86EFAC", fontSize: 11, fontWeight: "700" }}>💪 {macros.prot}g prot</Text>
          </View>
        </View>
      )}
      {showDesc && reel.descripcion
        ? <Text style={r.desc}>{reel.descripcion}</Text>
        : reel.descripcion
        ? <Text style={r.hint}>{t.tapForDescription}</Text>
        : null}
      {reel.hashtags?.filter(h => h !== "__cf__").length > 0 && (
        <Text style={r.hashtags} numberOfLines={1}>
          {reel.hashtags.filter(h => h !== "__cf__").slice(0, 5).map(h => `#${h}`).join(" ")}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
        <Text style={{ fontSize: 12 }}>🎵</Text>
        <Text style={r.musicText} numberOfLines={1}>{musicLabel}</Text>
      </View>
    </View>
  );

  // ── WEB DESKTOP: layout tipo Instagram — vídeo 9:16 centrado + botones a la derecha ──
  if (Platform.OS === "web" && !isMobile) {
    const vidH = SH;
    const vidW = Math.round(vidH * 9 / 16);
    return (
      <View style={{ width: SW, height: SH, backgroundColor: "#000", flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
        {/* Vídeo 9:16 centrado */}
        <View style={{ width: vidW, height: vidH, position: "relative", overflow: "hidden" as any }}
          onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleVideoTap}
            onPressIn={() => { longPressRef.current = setTimeout(() => setSpeedUp(true), 400); }}
            onPressOut={() => { if (longPressRef.current) clearTimeout(longPressRef.current); longPressRef.current = null; setSpeedUp(false); }}>
            {reel.fotos && reel.fotos.length > 0
              ? <PhotoSlideshow fotos={reel.fotos} active={active} onLastSwipe={onOpenProfile} />
              : <VideoPlayer url={reel.video_url} active={active}
                  filtro={reel.filtro} camaraFrontal={reel.camara_frontal || reel.hashtags?.includes("__cf__")}
                  cancionUrl={reel.cancion_url} cancionStart={reel.cancion_start ?? 0}
                  cancionVolumen={reel.cancion_volumen ?? 1} muteVideo={!!reel.mute_video}
                  webMuted={webMuted} paused={paused} speedUp={speedUp} />
            }
          </TouchableOpacity>

          {/* Icono de pausa */}
          {paused && (
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" }}>
              <View style={{ backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 40, width: 72, height: 72, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 32, color: "#fff" }}>▶</Text>
              </View>
            </View>
          )}

          <View pointerEvents="none"
            style={[r.shadow, { background: "linear-gradient(to top,rgba(0,0,0,0.92) 0%,rgba(0,0,0,0.5) 38%,transparent 100%)" } as any]} />
          <InfoOverlay webMode={false} />

          {/* Mute */}
          <TouchableOpacity onPress={() => setWebMuted(v => !v)}
            style={{ position: "absolute", top: 12, right: 10, zIndex: 30,
              backgroundColor: webMuted ? "rgba(0,0,0,0.55)" : "rgba(30,180,70,0.75)",
              borderRadius: 22, width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 18 }}>{webMuted ? "🔇" : "🔊"}</Text>
          </TouchableOpacity>

        </View>

        {/* Botones a la derecha del vídeo */}
        <View style={{ width: 80, paddingLeft: 12, gap: 18, alignItems: "center", justifyContent: "flex-end", paddingBottom: 40, alignSelf: "flex-end" }}>
          <ActionButtons />
        </View>
      </View>
    );
  }

  // ── MÓVIL (web + native): pantalla completa, botones superpuestos ──
  return (
    <View style={{ width: SW, height: SH, backgroundColor: "#000" }}
      onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleVideoTap}
        onPressIn={() => { longPressRef.current = setTimeout(() => setSpeedUp(true), 400); }}
        onPressOut={() => { if (longPressRef.current) clearTimeout(longPressRef.current); longPressRef.current = null; setSpeedUp(false); }}>
        {reel.fotos && reel.fotos.length > 0
          ? <PhotoSlideshow fotos={reel.fotos} active={active} onLastSwipe={onOpenProfile} />
          : <VideoPlayer url={reel.video_url} active={active}
              filtro={reel.filtro} camaraFrontal={reel.camara_frontal || reel.hashtags?.includes("__cf__")}
              cancionUrl={reel.cancion_url} cancionStart={reel.cancion_start ?? 0}
              cancionVolumen={reel.cancion_volumen ?? 1} muteVideo={!!reel.mute_video}
              webMuted={webMuted} paused={paused} speedUp={speedUp} />
        }
      </TouchableOpacity>
      {/* Icono de pausa / 2x */}
      {(paused || speedUp) && (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" }}>
          <View style={{ backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 40, paddingHorizontal: speedUp ? 20 : 0, width: speedUp ? undefined : 72, height: 72, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: speedUp ? 22 : 32, color: "#fff", fontWeight: "900" }}>{speedUp ? "2x ⏩" : "▶"}</Text>
          </View>
        </View>
      )}
      {/* Big heart on double tap */}
      {showBigHeart && (
        <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center", opacity: bigHeartOpacity, transform: [{ scale: bigHeartScale }] }}>
          <Text style={{ fontSize: 100, textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 12 }}>❤️</Text>
        </Animated.View>
      )}
      <View pointerEvents="none"
        style={[r.shadow, { background: "linear-gradient(to top,rgba(0,0,0,0.94) 0%,rgba(0,0,0,0.6) 40%,transparent 100%)" } as any]} />
      <InfoOverlay />
      <View style={[r.actions, { bottom: bottomBase }]}>
        <ActionButtons />
      </View>
    </View>
  );
}

const r = StyleSheet.create({
  shadow:        { position: "absolute", bottom: 0, left: 0, right: 0, height: 430 },
  info:          { position: "absolute", left: 16, right: 76, gap: 6 },
  autor:         { color: "#fff", fontWeight: "900", fontSize: 17, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  titulo:        { color: "rgba(255,255,255,0.95)", fontWeight: "700", fontSize: 15, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  desc:          { color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 18 },
  hint:          { color: "rgba(255,255,255,0.38)", fontSize: 11 },
  hashtags:      { color: "#60A5FA", fontSize: 13, fontWeight: "700", textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  musicText:     { color: "rgba(255,255,255,0.62)", fontSize: 12, flex: 1 },
  actions:       { position: "absolute", right: 10, gap: 14, alignItems: "center" },
  avatarRing:    { width: 46, height: 46, borderRadius: 23, borderWidth: 2, padding: 2, alignItems: "center", justifyContent: "center" },
  avatarInner:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarInnerImg:{ width: 40, height: 40, borderRadius: 20 },
  followPill:    { position: "absolute", bottom: -9, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#000" },
  actionBtn:     { alignItems: "center", gap: 3 },
  actionIcon:    { fontSize: 28, textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  actionCircle:  { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" },
  actionLbl:     { color: "#fff", fontSize: 11, fontWeight: "700", textShadowColor: "#000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  musicDisc:     { width: 38, height: 38, borderRadius: 19, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "#2a2a2a" },
});


// ─── Modal comentarios ────────────────────────────────────────────────────────
type Comentario = {
  id: string; autor: string; autor_id: string;
  autor_avatar?: string; contenido: string; creado_en: string;
  respuesta_a?: string | null; respuesta_autor?: string | null;
};

function ComentariosModal({ visible, reel, userId, nombreUsuario, avatarUri, onClose, onCountChange }: {
  visible: boolean; reel: Reel | null;
  userId: string; nombreUsuario: string; avatarUri?: string | null;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}) {
  const { t } = useApp();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; autor: string } | null>(null);

  useEffect(() => {
    if (!visible || !reel) return;
    setCargando(true);
    supabase.from("comentarios_reels")
      .select("*").eq("reel_id", reel.id)
      .order("creado_en", { ascending: true }).limit(200)
      .then(({ data }) => {
        const list = (data ?? []) as Comentario[];
        setComentarios(list);
        onCountChange?.(list.length);
        setCargando(false);
      });
  }, [visible, reel?.id]);

  const enviar = async () => {
    if (!texto.trim() || !userId || !reel || enviando) return;
    setEnviando(true);
    const nuevo: any = {
      reel_id: reel.id, autor_id: userId,
      autor: nombreUsuario || "Anónimo",
      autor_avatar: avatarUri ?? null,
      contenido: texto.trim(),
      respuesta_a: replyTo?.id ?? null,
      respuesta_autor: replyTo?.autor ?? null,
    };
    const { data, error } = await supabase.from("comentarios_reels").insert([nuevo]).select().single();
    if (!error && data) {
      const updated = [...comentarios, data as Comentario];
      setComentarios(updated);
      onCountChange?.(updated.length);
    }
    setTexto("");
    setReplyTo(null);
    setEnviando(false);
  };

  const eliminar = async (cid: string) => {
    await supabase.from("comentarios_reels").delete().eq("id", cid);
    const updated = comentarios.filter(c => c.id !== cid && c.respuesta_a !== cid);
    setComentarios(updated);
    onCountChange?.(updated.length);
  };

  if (!reel) return null;

  const AVATAR_COLORS = ["#EF4444","#F97316","#EAB308","#22C55E","#3B82F6","#8B5CF6","#EC4899"];
  const esCreador = (autorId: string) => autorId === reel.autor_id;

  // Organizar: comentarios raíz + respuestas agrupadas
  const rootComments = comentarios.filter(c => !c.respuesta_a);
  const replies = comentarios.filter(c => c.respuesta_a);
  const getReplies = (parentId: string) => replies.filter(r => r.respuesta_a === parentId);

  const renderComment = (c: Comentario, isReply = false) => {
    const letter = c.autor ? c.autor[0].toUpperCase() : "?";
    const color = AVATAR_COLORS[(c.autor?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
    return (
      <View key={c.id} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start",
        ...(isReply ? { marginLeft: 44, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: "#1F293B" } : {}) }}>
        {c.autor_avatar
          ? <Image source={{ uri: c.autor_avatar }} style={{ width: isReply ? 28 : 34, height: isReply ? 28 : 34, borderRadius: isReply ? 14 : 17 }} />
          : <View style={{ width: isReply ? 28 : 34, height: isReply ? 28 : 34, borderRadius: isReply ? 14 : 17, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: isReply ? 11 : 14 }}>{letter}</Text>
            </View>
        }
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: "#60A5FA", fontWeight: "700", fontSize: 13 }}>@{c.autor}</Text>
            {esCreador(c.autor_id) && (
              <View style={{ backgroundColor: "#1F6FEB22", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: "#1F6FEB44" }}>
                <Text style={{ color: "#60A5FA", fontSize: 9, fontWeight: "800" }}>CREADOR</Text>
              </View>
            )}
          </View>
          {c.respuesta_autor && (
            <Text style={{ color: "#475569", fontSize: 11 }}>↳ @{c.respuesta_autor}</Text>
          )}
          <Text style={{ color: "#E2E8F0", fontSize: 14, marginTop: 2, lineHeight: 20 }}>{c.contenido}</Text>
          <TouchableOpacity onPress={() => { setReplyTo({ id: c.id, autor: c.autor }); }}
            style={{ marginTop: 4 }}>
            <Text style={{ color: "#475569", fontSize: 11, fontWeight: "600" }}>Responder</Text>
          </TouchableOpacity>
        </View>
        {c.autor_id === userId && (
          <TouchableOpacity onPress={() => eliminar(c.id)}>
            <Text style={{ color: "#EF4444", fontSize: 13 }}>🗑</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
      <View style={{ backgroundColor: "#111827", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "70%", paddingBottom: 16 }}>
        <View style={{ alignItems: "center", paddingVertical: 12 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#374151" }} />
        </View>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800", textAlign: "center", marginBottom: 12 }}>
          💬 {comentarios.length > 0 ? `${comentarios.length} ` : ""}Comentarios
        </Text>
        {cargando ? (
          <ActivityIndicator color="#60A5FA" style={{ marginVertical: 24 }} />
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 12 }}>
            {comentarios.length === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <Text style={{ fontSize: 36 }}>💬</Text>
                <Text style={{ color: "#64748B", marginTop: 8 }}>Sé el primero en comentar</Text>
              </View>
            )}
            {rootComments.map(c => (
              <View key={c.id}>
                {renderComment(c)}
                {getReplies(c.id).map(r => renderComment(r, true))}
              </View>
            ))}
          </ScrollView>
        )}
        {/* Reply indicator */}
        {replyTo && (
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 6, backgroundColor: "#1F293B", gap: 8 }}>
            <Text style={{ color: "#60A5FA", fontSize: 12, flex: 1 }}>↳ Respondiendo a @{replyTo.autor}</Text>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "700" }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Input */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: "#1F2937" }}>
          <TextInput
            style={{ flex: 1, backgroundColor: "#1E2533", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: "#fff", fontSize: 14 }}
            placeholder={replyTo ? `Responder a @${replyTo.autor}...` : "Escribe un comentario..."}
            placeholderTextColor="#475569"
            value={texto} onChangeText={setTexto}
            maxLength={280} multiline={false}
            returnKeyType="send" onSubmitEditing={enviar}
          />
          <TouchableOpacity
            onPress={enviar}
            disabled={!texto.trim() || enviando}
            style={{ backgroundColor: texto.trim() ? "#1F6FEB" : "#1E2533", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ color: texto.trim() ? "#fff" : "#475569", fontWeight: "700" }}>
              {enviando ? "..." : "Enviar"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Canvas text helper ────────────────────────────────────────────────────────
function drawTextOnCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  position: "top" | "center" | "bottom",
  W: number,
  H: number,
  alpha = 1,
) {
  if (!text.trim() || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const fontSize = Math.max(24, Math.round(W * 0.052));
  ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxW = W * 0.84;
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  const lineH = fontSize * 1.38;
  const padV = 12, padH = 18;
  const boxH = lines.length * lineH + padV * 2;
  const boxW = Math.min(W * 0.90, maxW + padH * 2);
  const boxX = (W - boxW) / 2;
  const boxY = position === "top" ? H * 0.08
    : position === "center" ? H / 2 - boxH / 2
    : H * 0.88 - boxH;
  ctx.fillStyle = "rgba(0,0,0,0.52)";
  ctx.beginPath();
  const r = 14;
  ctx.moveTo(boxX + r, boxY);
  ctx.lineTo(boxX + boxW - r, boxY);
  ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + r, r);
  ctx.lineTo(boxX + boxW, boxY + boxH - r);
  ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH, r);
  ctx.lineTo(boxX + r, boxY + boxH);
  ctx.arcTo(boxX, boxY + boxH, boxX, boxY + boxH - r, r);
  ctx.lineTo(boxX, boxY + r);
  ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
  let ty = boxY + padV + lineH / 2;
  for (const line of lines) { ctx.fillText(line, W / 2, ty); ty += lineH; }
  ctx.restore();
}

// ─── Canvas + MediaRecorder compositor (web only) ─────────────────────────────
async function composeVideoClips(
  clips: MediaClip[],
  filterCss: string,
  textOverlay: string,
  textPosition: "top" | "center" | "bottom",
  musicUrl: string | null,
  musicStartTime: number,
  musicVolume: number,
  onProgress: (p: number) => void,
): Promise<Blob> {
  const W = 720, H = 1280;
  const FPS = 30;
  const FRAME_MS = 1000 / FPS;
  const FADE_MS = 300;

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const canvasStream = (canvas as any).captureStream(FPS) as MediaStream;

  // Pick best supported mimeType
  const TYPES = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  const mimeType = TYPES.find(t => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "video/webm";

  // Web Audio API — mix music into the recorded stream
  let audioCtx: any = null;
  try {
    audioCtx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    const audioDest = audioCtx.createMediaStreamDestination() as MediaStreamAudioDestinationNode;
    audioDest.stream.getAudioTracks().forEach((t: MediaStreamTrack) => canvasStream.addTrack(t));
    if (musicUrl) {
      try {
        const resp = await fetch(musicUrl);
        const arr = await resp.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(arr);
        const src = audioCtx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const gain = audioCtx.createGain();
        gain.gain.value = Math.min(musicVolume, 0.40);
        src.connect(gain); gain.connect(audioDest);
        src.start(0, musicStartTime);
      } catch { /* music fetch/decode failed — continue without music */ }
    }
  } catch { /* AudioContext not available */ }

  const recorder = new MediaRecorder(canvasStream, {
    mimeType: mimeType as any,
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e: any) => { if (e.data?.size > 0) chunks.push(e.data); };
  recorder.start(100);

  const totalDuration = clips.reduce((s, c) => s + c.duration, 0);
  let globalElapsed = 0;

  for (let ci = 0; ci < clips.length; ci++) {
    const clip = clips[ci];
    const clipDurMs = clip.duration * 1000;
    const zoomIn = ci % 2 === 0; // alternate Ken Burns direction

    if (clip.type === "video") {
      const vid = document.createElement("video");
      vid.src = clip.uri;
      vid.muted = true;
      vid.crossOrigin = "anonymous";
      vid.preload = "auto";
      await new Promise<void>(r => {
        vid.onloadeddata = () => r();
        vid.onerror = () => r();
        setTimeout(r, 6000);
      });
      // Usar la duración real del vídeo, no la del clip (que puede estar desactualizada)
      const realDurMs = vid.duration && isFinite(vid.duration) && vid.duration > 0
        ? vid.duration * 1000
        : clipDurMs;
      await vid.play().catch(() => {});
      const clipStart = performance.now();
      await new Promise<void>(resolve => {
        let interval: ReturnType<typeof setInterval>;
        const draw = () => {
          const elapsed = performance.now() - clipStart;
          if (elapsed >= realDurMs || vid.ended) { clearInterval(interval); resolve(); return; }
          try {
            ctx.filter = filterCss || "none";
            ctx.drawImage(vid as any, 0, 0, W, H);
            ctx.filter = "none";
          } catch {}
          const fadeIn = Math.min(FADE_MS, elapsed) / FADE_MS;
          const fadeOut = Math.max(0, elapsed - (clipDurMs - FADE_MS)) / FADE_MS;
          if (fadeIn < 1) { ctx.globalAlpha = 1 - fadeIn; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
          if (fadeOut > 0) { ctx.globalAlpha = fadeOut; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
          drawTextOnCanvas(ctx, textOverlay, textPosition, W, H, Math.min(fadeIn, 1 - fadeOut));
        };
        interval = setInterval(draw, FRAME_MS);
        draw();
      });
      vid.pause();
    } else {
      // Photo with Ken Burns
      const img = new (window as any).Image() as HTMLImageElement;
      img.crossOrigin = "anonymous";
      img.src = clip.uri;
      await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); setTimeout(r, 6000); });
      const imgAspect = (img.naturalWidth || W) / (img.naturalHeight || H);
      const canvasAspect = W / H;
      const clipStart = performance.now();
      await new Promise<void>(resolve => {
        let interval: ReturnType<typeof setInterval>;
        const draw = () => {
          const elapsed = performance.now() - clipStart;
          if (elapsed >= clipDurMs) { clearInterval(interval); resolve(); return; }
          const progress = elapsed / clipDurMs;
          const scale = zoomIn ? (1.0 + 0.08 * progress) : (1.08 - 0.08 * progress);
          let dw: number, dh: number;
          if (imgAspect < canvasAspect) { dw = W * scale; dh = dw / imgAspect; }
          else { dh = H * scale; dw = dh * imgAspect; }
          const dx = (W - dw) / 2, dy = (H - dh) / 2;
          ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
          try {
            ctx.filter = filterCss || "none";
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.filter = "none";
          } catch {}
          const fadeIn = Math.min(FADE_MS, elapsed) / FADE_MS;
          const fadeOut = Math.max(0, elapsed - (clipDurMs - FADE_MS)) / FADE_MS;
          if (fadeIn < 1) { ctx.globalAlpha = 1 - fadeIn; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
          if (fadeOut > 0) { ctx.globalAlpha = fadeOut; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
          drawTextOnCanvas(ctx, textOverlay, textPosition, W, H, Math.min(fadeIn, 1 - fadeOut));
        };
        interval = setInterval(draw, FRAME_MS);
        draw();
      });
    }

    globalElapsed += clip.duration;
    onProgress(Math.round((globalElapsed / totalDuration) * 80));
  }

  // Flush last frames then stop
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  await new Promise(r => setTimeout(r, 400));
  if (audioCtx) audioCtx.close().catch(() => {});
  recorder.stop();

  return new Promise(resolve => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      resolve(blob);
    };
  });
}

// ─── Modal subir reel — 3 pasos: Receta → Cámara → Detalles ──────────────────
function ModalSubir({ visible, onClose, onSubido, nombreUsuario, userId, avatarUri, recetaPrevia }: {
  visible: boolean; onClose: () => void; onSubido: () => void;
  nombreUsuario: string; userId: string; avatarUri?: string | null; recetaPrevia?: string;
}) {
  const { colors, t, language } = useApp();
  const router = useRouter();
  const [step, setStep] = useState<"receta" | "camara" | "detalles">("receta");

  // ── Paso 1: Receta ────────────────────────────────────────────────────────
  const [recetas, setRecetas] = useState<RecetaItem[]>([]);
  const [recetaElegida, setRecetaElegida] = useState(recetaPrevia ?? "");

  // ── Paso 2: Cámara ────────────────────────────────────────────────────────
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const durTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartRef = useRef(0);
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
  // ── Música ─────────────────────────────────────────────────────────────────
  const [selectedSong, setSelectedSong] = useState<{ name: string; url: string; startTime: number } | null>(null);
  const [musicPickerVisible, setMusicPickerVisible] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.8);        // 0–1
  const [muteVideo, setMuteVideo] = useState(false);           // silenciar audio del vídeo
  const [videoDuration, setVideoDuration] = useState(0);       // segundos del vídeo actual
  const [previewing, setPreviewing] = useState(false);         // preview activo en detalles
  const previewMusicRef = useRef<any>(null);
  const detailVideoRef  = useRef<any>(null);
  const volBarWidthRef  = useRef(0);
  // ── Fotos ──────────────────────────────────────────────────────────────────
  const [selectedFotos, setSelectedFotos] = useState<Array<{ uri: string; file?: any }>>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState("Normal");

  // ── Modo galería ──────────────────────────────────────────────────────────────
  const [cameraTab, setCameraTab] = useState<"camera" | "gallery">("camera");
  const [clips, setClips] = useState<MediaClip[]>([]);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [textOverlay, setTextOverlay] = useState("");
  const [textPosition, setTextPosition] = useState<"top" | "center" | "bottom">("bottom");
  const [composing, setComposing] = useState(false);
  const [composingProgress, setComposingProgress] = useState(0);

  // ── Editor TikTok Studio ──────────────────────────────────────────────────────
  const [previewAreaH, setPreviewAreaH] = useState(0);
  const [editorTab, setEditorTab] = useState<"musica" | "filtros" | "texto" | "descripcion">("musica");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [contentIsHorizontal, setContentIsHorizontal] = useState(false);
  const [musicStartInVideo, setMusicStartInVideo] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const timelineWidthRef = useRef(300);
  const [editorSpeedUp, setEditorSpeedUp] = useState(false);
  const editorLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cámara TikTok UI ─────────────────────────────────────────────────────────
  const [recordMode, setRecordMode] = useState<"foto" | "15s" | "60s" | "10min">("60s");
  const [filterCarouselVisible, setFilterCarouselVisible] = useState(false);
  const [filterIntensity, setFilterIntensity] = useState(0.85);
  const filterIntensityBarRef = useRef(0);

  // Cargar recetas al abrir: solo las del usuario, filtrando las ya publicadas en reels O comunidad
  useEffect(() => {
    if (!visible || !userId) return;
    (async () => {
      const [recetasRes, reelsRes] = await Promise.all([
        supabase.from("recetas").select("id,nombre,descripcion").eq("user_id", userId).order("creado_en", { ascending: false }).limit(200),
        supabase.from("videos_recetas").select("titulo").eq("autor_id", userId),
      ]);
      const yaEnReels = new Set((reelsRes.data ?? []).map((r: any) => r.titulo?.trim()));
      const filtradas = ((recetasRes.data ?? []) as any[]).filter((r: any) => r.nombre && !yaEnReels.has(r.nombre.trim())) as RecetaItem[];
      setRecetas(filtradas);
      // Pre-rellenar descripción si viene con receta previa
      if (recetaPrevia && !descripcion.trim()) {
        const rec = filtradas.find(r => r.nombre === recetaPrevia);
        if (rec?.descripcion) setDescripcion(rec.descripcion);
      }
    })();
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
    setStep("receta"); setRecetaElegida("");
    setRecording(false); setDuration(0); setCameraTransition(false);
    if (durTimerRef.current) clearInterval(durTimerRef.current);
    setVideoFile(null);
    if (webPreview) URL.revokeObjectURL(webPreview);
    setWebPreview(null); setFlipH(false);
    setDescripcion(""); setHashtagsInput(""); setSubiendo(false); setProgreso(0);
    setSelectedSong(null); setMusicPickerVisible(false);
    setMusicVolume(0.8); setMuteVideo(false); setVideoDuration(0); setPreviewing(false);
    if (previewMusicRef.current) { previewMusicRef.current.pause(); previewMusicRef.current.src = ""; previewMusicRef.current = null; }
    setSelectedFotos([]);
    // Galería
    setCameraTab("camera");
    setClips(prev => { prev.forEach(c => { if (c.uri?.startsWith("blob:")) URL.revokeObjectURL(c.uri); }); return []; });
    setEditingClipId(null); setTextOverlay(""); setTextPosition("bottom");
    setComposing(false); setComposingProgress(0);
    // Editor
    setEditorTab("musica"); setCurrentTime(0); setIsPlaying(false);
    setMusicStartInVideo(0); setIsDragOver(false);
    // Cámara TikTok UI
    setRecordMode("60s"); setFilterCarouselVisible(false); setFilterIntensity(0.85);
  };

  const cerrar = () => { limpiar(); onClose(); };
  const elegirReceta = (nombre: string) => {
    setRecetaElegida(nombre);
    // Pre-rellenar descripción con la de la receta
    const rec = recetas.find(r => r.nombre === nombre);
    if (rec?.descripcion && !descripcion.trim()) setDescripcion(rec.descripcion);
    setStep("camara");
  };


  // ── Acciones cámara ───────────────────────────────────────────────────────
  const startRecording = async () => {
    if (!cameraRef.current || recording) return;
    setDuration(0); setRecording(true);
    recordStartRef.current = Date.now();
    durTimerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    try {
      const maxDur = recordMode === "15s" ? 15 : recordMode === "60s" ? 60 : recordMode === "10min" ? 600 : 30;
      const video = await (cameraRef.current as any).recordAsync({ maxDuration: maxDur });
      if (durTimerRef.current) clearInterval(durTimerRef.current);
      setCameraTransition(true); // Ocultar cámara inmediatamente para evitar el "flip"
      setRecording(false);
      setVideoDuration(Math.round((Date.now() - recordStartRef.current) / 1000));
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
        if (file.size > 500 * 1024 * 1024) { Alert.alert(t.tooLarge, t.maxFileSize); return; }
        if (webPreview) URL.revokeObjectURL(webPreview);
        const previewUrl = URL.createObjectURL(file);
        setVideoFile(file); setWebPreview(previewUrl);
        // Detectar duración del vídeo
        const tmpVid = document.createElement("video");
        tmpVid.preload = "metadata";
        tmpVid.onloadedmetadata = () => setVideoDuration(Math.round(tmpVid.duration) || 0);
        tmpVid.src = previewUrl;
        setStep("detalles");
      };
      input.click();
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert(t.noPermission, t.needGalleryAccess); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "videos", allowsEditing: false, quality: 1 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const ext = (asset.fileName ?? "video.mp4").split(".").pop() ?? "mp4";
    setVideoFile({ uri: asset.uri, type: asset.mimeType ?? `video/${ext}`, name: asset.fileName ?? `video.${ext}`, isNative: true });
    if (asset.duration) setVideoDuration(Math.round(asset.duration));
    setStep("detalles");
  };

  const pickFotos = async (onPicked?: () => void) => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*"; input.multiple = true;
      input.onchange = (e: any) => {
        const files: File[] = Array.from(e.target?.files ?? []);
        if (!files.length) return;
        const nuevas = files.slice(0, 10 - selectedFotos.length).map(f => ({
          uri: URL.createObjectURL(f), file: f,
        }));
        setSelectedFotos(s => [...s, ...nuevas]);
        onPicked?.();
      };
      input.click();
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert(t.noPermission, t.needGalleryAccess); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images", allowsMultipleSelection: true, quality: 0.85,
      selectionLimit: 10 - selectedFotos.length,
    });
    if (result.canceled || !result.assets?.length) return;
    setSelectedFotos(s => [...s, ...result.assets.map(a => ({ uri: a.uri }))]);
    onPicked?.();
  };

  // ── Galería: selección múltiple de vídeos y fotos ────────────────────────────
  const pickMediaGaleria = async () => {
    const maxMore = 10 - clips.length;
    if (maxMore <= 0) { Alert.alert("Máximo 10 clips"); return; }

    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*,image/*";
      input.multiple = true;
      input.onchange = (e: any) => {
        const files = Array.from(e.target?.files ?? []).slice(0, maxMore) as File[];
        if (!files.length) return;
        // Si hay algún vídeo, tomar solo el primer vídeo; si solo fotos, todas
        const hasVid = files.some(f => f.type.startsWith("video/"));
        const filtered = hasVid ? [files.find(f => f.type.startsWith("video/"))!] : files;
        const nuevos: MediaClip[] = filtered.map(f => ({
          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          uri: URL.createObjectURL(f),
          type: (f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(f.name)) ? "video" : "photo",
          duration: (f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(f.name)) ? 10 : 3,
          transition: "fade",
          file: f,
          mimeType: f.type,
          fileName: f.name,
        }));
        // Detectar duración real de vídeos
        nuevos.forEach(clip => {
          if (clip.type === "video") {
            const tmp = document.createElement("video");
            tmp.preload = "metadata";
            tmp.onloadedmetadata = () => {
              const d = Math.min(Math.ceil(tmp.duration || 10), 180);
              setClips(prev => prev.map(c => c.id === clip.id ? { ...c, duration: d } : c));
            };
            tmp.src = clip.uri;
          }
        });
        setClips(prev => [...prev, ...nuevos]);
      };
      input.click();
      return;
    }

    // Native
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert(t.noPermission, t.needGalleryAccess); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: maxMore,
    });
    if (result.canceled || !result.assets?.length) return;
    // Si hay algún vídeo, tomar solo el primer vídeo; si solo fotos, todas
    const hasVid = result.assets.some(a => a.type === "video");
    const filteredAssets = hasVid ? [result.assets.find(a => a.type === "video")!] : result.assets;
    const nuevos: MediaClip[] = filteredAssets.map(a => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      uri: a.uri,
      type: a.type === "video" ? "video" : "photo",
      duration: a.type === "video" ? Math.min(Math.ceil((a.duration ?? 10000) / 1000), 180) : 3,
      transition: "fade",
      isNative: true,
      mimeType: a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/jpeg"),
      fileName: a.fileName ?? (a.type === "video" ? "video.mp4" : "photo.jpg"),
    }));
    setClips(prev => [...prev, ...nuevos]);
    setTimeout(() => setStep("detalles"), 50);
  };

  const moveClip = (id: string, dir: -1 | 1) => {
    setClips(prev => {
      const idx = prev.findIndex(c => c.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  };

  const removeClip = (id: string) => {
    setClips(prev => {
      const clip = prev.find(c => c.id === id);
      if (clip?.uri?.startsWith("blob:")) URL.revokeObjectURL(clip.uri);
      return prev.filter(c => c.id !== id);
    });
  };

  const setClipDuration = (id: string, d: number) =>
    setClips(prev => prev.map(c => c.id === id ? { ...c, duration: d } : c));

  const fmtDur = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const fmtSec2 = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const curFilter = FILTERS.find(f => f.name === selectedFilter) ?? FILTERS[0];

  // ── Preview: reproduce el vídeo con la música superpuesta ─────────────────
  const posIntervalEditorRef = useRef<any>(null);

  const stopPreview = () => {
    if (posIntervalEditorRef.current) { clearInterval(posIntervalEditorRef.current); posIntervalEditorRef.current = null; }
    if (previewMusicRef.current) {
      previewMusicRef.current.pause();
      previewMusicRef.current.src = "";
      previewMusicRef.current = null;
    }
    if (detailVideoRef.current) {
      detailVideoRef.current.loop = true;
      detailVideoRef.current.muted = true;
      detailVideoRef.current.onended = null;
    }
    setPreviewing(false);
  };

  const toggleEditorPlayback = () => {
    if (Platform.OS === "web") {
      const el = detailVideoRef.current;
      if (!el) return;
      if (previewing) {
        // Pausar
        el.pause?.();
        if (previewMusicRef.current) previewMusicRef.current.pause();
        if (posIntervalEditorRef.current) { clearInterval(posIntervalEditorRef.current); posIntervalEditorRef.current = null; }
        setPreviewing(false);
      } else {
        // Reproducir desde posición actual
        el.loop = false;
        el.muted = muteVideo;
        el.onended = () => { stopPreview(); setCurrentTime(0); el.currentTime = 0; };
        el.play?.().catch(() => {});
        // Música
        if (selectedSong && typeof window !== "undefined" && (window as any).Audio) {
          if (previewMusicRef.current) { previewMusicRef.current.pause(); previewMusicRef.current.src = ""; }
          const audio = new (window as any).Audio(selectedSong.url);
          audio.currentTime = (selectedSong.startTime ?? 0) + currentTime;
          audio.volume = musicVolume;
          audio.loop = false;
          audio.play?.().catch(() => {});
          previewMusicRef.current = audio;
        }
        // Tracking posición
        if (posIntervalEditorRef.current) clearInterval(posIntervalEditorRef.current);
        posIntervalEditorRef.current = setInterval(() => {
          if (el && !el.paused) setCurrentTime(Math.floor(el.currentTime));
        }, 200);
        setPreviewing(true);
      }
    } else {
      // Native: toggle play
      setIsPlaying(v => !v);
    }
  };

  const seekEditorTo = (seconds: number) => {
    setCurrentTime(seconds);
    if (Platform.OS === "web" && detailVideoRef.current) {
      detailVideoRef.current.currentTime = seconds;
    } else if (Platform.OS !== "web" && detailVideoRef.current) {
      detailVideoRef.current.setPositionAsync?.(seconds * 1000).catch(() => {});
    }
    // Sincronizar música
    if (previewMusicRef.current && selectedSong) {
      previewMusicRef.current.currentTime = (selectedSong.startTime ?? 0) + seconds;
    }
  };

  const subir = async () => {
    const isGalleryMode = clips.length > 0;
    if (!videoFile && selectedFotos.length === 0 && !isGalleryMode) { Alert.alert(t.noContent, t.recordVideoOrAddPhotos); return; }
    if (!recetaElegida.trim()) { Alert.alert(t.noRecipeSelected, t.goBackAndChooseRecipe); return; }
    if (!userId) { Alert.alert(t.sessionExpired, t.closeAndReopen); return; }

    // ── Determinar vídeo y fotos efectivos ─────────────────────────────────
    let effectiveVideoFile: any = videoFile;
    let effectiveFotos = selectedFotos;

    // ── Galería web: si hay un solo vídeo, subirlo directamente sin compositor ──
    if (isGalleryMode && Platform.OS === "web") {
      const videoClips = clips.filter(c => c.type === "video");
      const photoClips = clips.filter(c => c.type === "photo");

      // Un solo vídeo → subir el archivo directamente (sin Canvas/MediaRecorder)
      if (videoClips.length === 1 && photoClips.length === 0 && videoClips[0].file) {
        effectiveVideoFile = videoClips[0].file;
        effectiveFotos = [];
        // Continúa con el flujo normal de abajo
      } else if (videoClips.length === 1 && photoClips.length === 0 && !videoClips[0].file) {
        // Vídeo de URL (blob:) sin file — descargarlo como blob
        try {
          const r = await fetch(videoClips[0].uri);
          const blob = await r.blob();
          const ext = videoClips[0].mimeType?.includes("mp4") ? "mp4" : "webm";
          effectiveVideoFile = new File([blob], `reel.${ext}`, { type: videoClips[0].mimeType || "video/mp4" });
          effectiveFotos = [];
        } catch {
          Alert.alert("Error", "No se pudo procesar el vídeo");
          return;
        }
      } else {
        // Múltiples clips → compositor Canvas
        if (typeof MediaRecorder === "undefined") {
          Alert.alert("No soportado", "Tu navegador no admite grabación de canvas. Prueba en Chrome o Edge.");
          return;
        }
        setComposing(true); setComposingProgress(0);
        try {
          const curF = FILTERS.find(f => f.name === selectedFilter) ?? FILTERS[0];
          const blob = await composeVideoClips(clips, curF.webCss, textOverlay, textPosition,
            selectedSong?.url ?? null, selectedSong?.startTime ?? 0, musicVolume, setComposingProgress);
          setComposingProgress(82); setComposing(false);
          const ext = blob.type.includes("mp4") ? "mp4" : "webm";
          effectiveVideoFile = new File([blob], `reel.${ext}`, { type: blob.type });
          effectiveFotos = [];
        } catch (e: any) {
          setComposing(false);
          Alert.alert("Error al componer el vídeo", e?.message ?? "Inténtalo de nuevo");
          return;
        }
      }
    }

    // ── Galería nativa ─────────────────────────────────────────────────────
    if (isGalleryMode && Platform.OS !== "web") {
      const videoClip = clips.find(c => c.type === "video");
      if (videoClip) {
        const ext = (videoClip.fileName?.split(".").pop() ?? "mp4").toLowerCase();
        effectiveVideoFile = { uri: videoClip.uri, type: videoClip.mimeType ?? `video/${ext}`, name: videoClip.fileName ?? `reel.${ext}`, isNative: true };
      }
      effectiveFotos = clips.filter(c => c.type === "photo").map(c => ({ uri: c.uri }));
    }
    setSubiendo(true); setProgreso(5);
    try {
      // Verificar que esta receta no tiene ya un reel publicado
      setProgreso(8);
      const { data: enReels, error: checkErr } = await supabase
        .from("videos_recetas").select("id").eq("autor_id", userId).eq("titulo", recetaElegida.trim()).limit(1);
      if (checkErr) { Alert.alert("Error al verificar", checkErr.message); setSubiendo(false); return; }
      if (enReels && enReels.length > 0) {
        setSubiendo(false);
        Alert.alert(t.alreadyHaveReel, t.oneReelPerRecipe);
        return;
      }

      // ── Subir vídeo (si existe) ────────────────────────────────────────────
      let publicUrl = "";
      if (effectiveVideoFile) {
        const mimeType: string = effectiveVideoFile.type ?? "video/mp4";
        const rawName = effectiveVideoFile.isNative ? (effectiveVideoFile.uri.split("/").pop() ?? "reel.mp4") : (effectiveVideoFile.name ?? "reel.mp4");
        const ext = (rawName.split(".").pop() ?? "mp4").split("?")[0].toLowerCase();
        const path = `${userId}/${Date.now()}.${ext}`;
        setProgreso(15);

        let uploadData: Blob;
        if (effectiveVideoFile.isNative) {
          const r = await fetch(effectiveVideoFile.uri);
          uploadData = await r.blob();
        } else {
          uploadData = effectiveVideoFile as Blob;
        }
        setProgreso(30);

        // Upload con timeout de 60s para evitar que se quede colgado
        const uploadPromise = supabase.storage
          .from("videos").upload(path, uploadData, { contentType: mimeType, upsert: false });
        const timeoutPromise = new Promise<{ error: { message: string } }>(resolve =>
          setTimeout(() => resolve({ error: { message: "Timeout: el vídeo tardó demasiado en subirse. Prueba con un vídeo más corto." } }), 180000)
        );
        const { error: upErr } = await Promise.race([uploadPromise, timeoutPromise]) as any;

        if (upErr) {
          setSubiendo(false);
          const isNoBucket = upErr.message?.includes("not found") || upErr.message?.includes("Bucket") || (upErr as any).statusCode === 404;
          const isAuth = upErr.message?.includes("security") || upErr.message?.includes("permission") || (upErr as any).statusCode === 403;
          let errMsg = upErr.message;
          if (isNoBucket) errMsg = 'El bucket "videos" no existe en Supabase.\n\n👉 Storage → New bucket → Nombre: videos → Public bucket';
          else if (isAuth) errMsg = 'Sin permisos en Storage.\n\n👉 Supabase → Storage → Policies → INSERT para "anon"';
          Alert.alert("Error al subir vídeo", errMsg);
          return;
        }
        publicUrl = supabase.storage.from("videos").getPublicUrl(path).data.publicUrl;
      }
      setProgreso(50);

      // ── Subir fotos (si existen) ───────────────────────────────────────────
      let fotosUrls: string[] = [];
      if (effectiveFotos.length > 0) {
        for (let i = 0; i < effectiveFotos.length; i++) {
          const foto = effectiveFotos[i];
          try {
            let uploadBlob: Blob;
            let contentType: string;
            if ((foto as any).file) {
              uploadBlob = (foto as any).file as Blob;
              contentType = (foto as any).file.type || "image/jpeg";
            } else {
              const r = await fetch(foto.uri);
              uploadBlob = await r.blob();
              contentType = uploadBlob.type || "image/jpeg";
            }
            const ext = contentType.includes("png") ? "png" : "jpg";
            const fpath = `${userId}/fotos/${Date.now()}_${i}.${ext}`;
            const { error: fErr } = await supabase.storage
              .from("videos").upload(fpath, uploadBlob, { contentType, upsert: false });
            if (!fErr) {
              fotosUrls.push(supabase.storage.from("videos").getPublicUrl(fpath).data.publicUrl);
            } else {
              console.error("[subir foto]", fErr.message);
            }
          } catch {}
          setProgreso(50 + Math.round((i + 1) / effectiveFotos.length * 30));
        }
      }
      setProgreso(80);

      const hashtags = [
        ...(hashtagsInput.match(/#[\w\u00C0-\u024F\u0400-\u04FF]+/g) ?? []).map(h => h.toLowerCase().slice(1)),
        ...(flipH ? ["__cf__"] : []),
      ];

      const base = {
        autor: nombreUsuario || t.anonymous, autor_id: userId,
        autor_avatar: avatarUri || null,
        titulo: recetaElegida.trim(), descripcion: descripcion.trim(),
        video_url: publicUrl || "", likes: 0, language,
        cancion_volumen: selectedSong ? musicVolume : null,
        mute_video: muteVideo || null,
      };

      setProgreso(85);

      // Insertar en BD — intentar con todas las columnas, si falla reducir
      const rowCompleto: Record<string, any> = {
        autor: base.autor, autor_id: base.autor_id, autor_avatar: base.autor_avatar,
        titulo: base.titulo, descripcion: base.descripcion,
        video_url: publicUrl || "", likes: 0, views: 0, language, hashtags,
        filtro: selectedFilter !== "Normal" ? selectedFilter : null,
        camara_frontal: flipH,
        cancion: selectedSong?.name ?? null,
        cancion_url: selectedSong?.url ?? null,
        cancion_start: selectedSong?.startTime ?? 0,
        cancion_volumen: selectedSong ? musicVolume : null,
        mute_video: muteVideo || null,
        fotos: fotosUrls.length > 0 ? fotosUrls : null,
      };

      setProgreso(90);
      console.log("[reel] insertando en BD...", JSON.stringify(rowCompleto).slice(0, 200));

      // Helper: insert con timeout de 15s
      const insertWithTimeout = async (row: any) => {
        const p = supabase.from("videos_recetas").insert([row]);
        const timeout = new Promise<{ error: { message: string } }>(r => setTimeout(() => r({ error: { message: "Timeout 15s al insertar en BD" } }), 15000));
        return Promise.race([p, timeout]) as any;
      };

      let dbErr: any = null;
      // Intento 1: completo
      const r1 = await insertWithTimeout(rowCompleto);
      dbErr = r1.error;
      console.log("[reel] intento 1:", dbErr ? dbErr.message : "OK");

      // Intento 2: sin columnas opcionales
      if (dbErr) {
        const { cancion_volumen, mute_video, autor_avatar, cancion_start, ...rowBase } = rowCompleto;
        const r2 = await insertWithTimeout(rowBase);
        dbErr = r2.error;
        console.log("[reel] intento 2:", dbErr ? dbErr.message : "OK");
      }

      // Intento 3: mínimo
      if (dbErr) {
        const rowMin = { autor: base.autor, autor_id: base.autor_id, titulo: base.titulo, descripcion: base.descripcion, video_url: publicUrl || "", likes: 0, language };
        const r3 = await insertWithTimeout(rowMin);
        dbErr = r3.error;
        console.log("[reel] intento 3:", dbErr ? dbErr.message : "OK");
      }

      setSubiendo(false);
      if (dbErr) {
        Alert.alert("Error al guardar en BD", `${dbErr.message ?? "Error desconocido"}\n\n${(dbErr as any).code ?? ""} ${(dbErr as any).details ?? (dbErr as any).hint ?? ""}`);
        return;
      }
      setProgreso(100);

      Alert.alert(t.published, t.reelPublishedMsg.replace("{name}", recetaElegida));
      limpiar(); onSubido(); onClose();
    } catch (e: any) {
      setSubiendo(false);
      Alert.alert(t.unexpectedError, e?.message ?? t.tryAgain);
    }
  };

  const m = makeSubirStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cerrar}>

      {/* ══ PASO 1: RECETA ══════════════════════════════════════════════════ */}
      {step === "receta" && (
        <SafeAreaView style={m.safe}>
          <View style={m.header}>
            <TouchableOpacity onPress={cerrar}
              style={{ backgroundColor: "#ffffff15", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={m.back}>{t.close}</Text>
            </TouchableOpacity>
            <Text style={m.title}>📋 Elige la receta</Text>
            <View style={{ width: 60 }} />
          </View>
          {/* 3 numbered circles progress */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 14, gap: 0 }}>
            {([t.recipeLabel, t.videoLabel, t.details]).map((lbl, i) => (
              <React.Fragment key={lbl}>
                {i > 0 && <View style={{ flex: 1, height: 1.5, backgroundColor: i <= 0 ? "#FFFFFF" : "#ffffff30" }} />}
                <View style={{ alignItems: "center", gap: 4 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15,
                    backgroundColor: i === 0 ? "#FFFFFF" : "transparent",
                    borderWidth: i === 0 ? 0 : 1.5, borderColor: "#ffffff30",
                    alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: i === 0 ? "#000" : "#ffffff50", fontSize: 13, fontWeight: "800" }}>{i + 1}</Text>
                  </View>
                  <Text style={{ color: i === 0 ? "#fff" : "#ffffff50", fontSize: 10, fontWeight: "700" }}>{lbl}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
          <ScrollView style={m.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {(
              <>
                {recetas.map(rec => (
                  <TouchableOpacity key={rec.id} style={m.recetaCard} onPress={() => elegirReceta(rec.nombre)}>
                    <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#1F6FEB22",
                      alignItems: "center", justifyContent: "center", marginRight: 14 }}>
                      <Text style={{ color: "#60A5FA", fontSize: 17, fontWeight: "800" }}>
                        {rec.nombre.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={m.recetaNombre}>{rec.nombre}</Text>
                      {rec.descripcion ? <Text style={m.recetaDesc} numberOfLines={1}>{rec.descripcion}</Text> : null}
                    </View>
                    <Text style={{ color: "#ffffff40", fontSize: 20, fontWeight: "300" }}>›</Text>
                  </TouchableOpacity>
                ))}
                {recetas.length === 0 && (
                  <View style={m.emptyBox}>
                    <Text style={{ fontSize: 52 }}>🍽</Text>
                    <Text style={[m.emptyTxt, { color: "#fff" }]}>{t.noRecipesYet}</Text>
                    <Text style={m.emptyHint}>{t.createOrGoToRecipes}</Text>
                  </View>
                )}
                <TouchableOpacity style={m.nuevaBtn} onPress={() => {
                  onClose();
                  setTimeout(() => router.push("/recetas?openCreate=1&from=reels" as any), 200);
                }}>
                  <Text style={m.nuevaBtnTxt}>+ {t.newRecipe}</Text>
                </TouchableOpacity>
              </>
            )}
            <View style={{ height: 60 }} />
          </ScrollView>
        </SafeAreaView>
      )}

      {/* ══ PASO 2: CÁMARA ══════════════════════════════════════════════════ */}
      {step === "camara" && (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {Platform.OS === "web" ? (
            /* Web: Drop zone unificado */
            <SafeAreaView style={[m.safe, { backgroundColor: "#0F172A" }]}>
              <View style={[m.header, { backgroundColor: "#0F172A" }]}>
                <TouchableOpacity onPress={() => setStep("receta")}>
                  <Text style={[m.back, { color: "#58A6FF" }]}>← {t.recipeLabel}</Text>
                </TouchableOpacity>
                <Text style={[m.title, { color: "#fff" }]}>🎬 {t.recordVideo}</Text>
                <View style={{ width: 60 }} />
              </View>
              <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
                {(React.createElement as any)("div", {
                  onDragOver: (e: any) => { e.preventDefault(); setIsDragOver(true); },
                  onDragLeave: () => setIsDragOver(false),
                  onDrop: (e: any) => {
                    e.preventDefault(); setIsDragOver(false);
                    const files = Array.from(e.dataTransfer?.files ?? []) as File[];
                    if (!files.length) return;
                    const accepted = files.filter((f: File) => f.type.startsWith("video/") || f.type.startsWith("image/"));
                    if (!accepted.length) return;
                    // Si hay algún vídeo, tomar solo el primer vídeo; si solo fotos, todas
                    const hasVideo = accepted.some((f: File) => f.type.startsWith("video/"));
                    const filtered = hasVideo ? [accepted.find((f: File) => f.type.startsWith("video/"))!] : accepted;
                    const nuevos: MediaClip[] = filtered.map((f: File) => ({
                      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                      uri: URL.createObjectURL(f),
                      type: (f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(f.name)) ? "video" : "photo",
                      duration: (f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(f.name)) ? 10 : 3,
                      transition: "fade" as const,
                      file: f, mimeType: f.type, fileName: f.name,
                    }));
                    nuevos.forEach(clip => {
                      if (clip.type === "video") {
                        const tmp = document.createElement("video");
                        tmp.preload = "metadata";
                        tmp.onloadedmetadata = () => {
                          const d = Math.min(Math.ceil(tmp.duration || 10), 180);
                          setClips(prev => prev.map(c => c.id === clip.id ? { ...c, duration: d } : c));
                          if (nuevos.length === 1) setVideoDuration(d);
                        };
                        tmp.src = clip.uri;
                      }
                    });
                    setClips(prev => [...prev, ...nuevos]);
                    setCurrentTime(0); setIsPlaying(false);
                    setTimeout(() => setStep("detalles"), 50);
                  },
                  style: {
                    border: `2px dashed ${isDragOver ? "#1F6FEB" : "#334155"}`,
                    borderRadius: 24,
                    padding: 60,
                    textAlign: "center",
                    backgroundColor: isDragOver ? "#1F6FEB0D" : "#0D1117",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
                  },
                },
                  (React.createElement as any)("div", { style: { fontSize: 72 } }, isDragOver ? "📥" : "🎬"),
                  (React.createElement as any)("div", {
                    style: { color: isDragOver ? "#60A5FA" : "#CBD5E1", fontSize: 20, fontWeight: "800" },
                  }, isDragOver ? "Suelta aquí" : "Arrastra tu vídeo o tus fotos aquí"),
                  (React.createElement as any)("div", {
                    style: { color: "#475569", fontSize: 13 },
                  }, "MP4 · MOV · WebM · JPG · PNG"),
                  (React.createElement as any)("button", {
                    style: {
                      marginTop: 8, backgroundColor: "#1F6FEB", color: "#fff", border: "none",
                      borderRadius: 14, padding: "12px 32px", fontWeight: "700", fontSize: 15,
                      cursor: "pointer",
                    },
                    onClick: (e: any) => {
                      e.stopPropagation();
                      const input = document.createElement("input");
                      input.type = "file"; input.accept = "video/*,image/*"; input.multiple = true;
                      input.onchange = (ev: any) => {
                        const files = Array.from(ev.target?.files ?? []) as File[];
                        if (!files.length) return;
                        // Si hay algún vídeo, tomar solo el primer vídeo; si solo fotos, todas
                        const hasVid = files.some((f: File) => f.type.startsWith("video/"));
                        const filtered = hasVid ? [files.find((f: File) => f.type.startsWith("video/"))!] : files;
                        const nuevos: MediaClip[] = filtered.map((f: File) => ({
                          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                          uri: URL.createObjectURL(f),
                          type: (f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(f.name)) ? "video" : "photo",
                          duration: (f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(f.name)) ? 10 : 3,
                          transition: "fade" as const,
                          file: f, mimeType: f.type, fileName: f.name,
                        }));
                        nuevos.forEach(clip => {
                          if (clip.type === "video") {
                            const tmp = document.createElement("video");
                            tmp.preload = "metadata";
                            tmp.onloadedmetadata = () => {
                              const d = Math.min(Math.ceil(tmp.duration || 10), 180);
                              setClips(prev => prev.map(c => c.id === clip.id ? { ...c, duration: d } : c));
                              if (nuevos.length === 1) setVideoDuration(d);
                            };
                            tmp.src = clip.uri;
                          }
                        });
                        setClips(prev => [...prev, ...nuevos]);
                        setCurrentTime(0); setIsPlaying(false);
                        setTimeout(() => setStep("detalles"), 50);
                      };
                      input.click();
                    },
                  }, "Seleccionar fotos o vídeos"),
                )}
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
                <Text style={{ color: "#fff", fontWeight: "700" }}>{t.grantPermissions}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep("receta")}>
                <Text style={{ color: "#94A3B8", marginTop: 8 }}>{t.back}</Text>
              </TouchableOpacity>
            </SafeAreaView>
          ) : (
            /* ─── Cámara TikTok Studio — pantalla completa ─── */
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
              {/* Color overlay del filtro activo */}
              {curFilter.name !== "Normal" && (
                <View pointerEvents="none" style={{
                  ...StyleSheet.absoluteFillObject,
                  backgroundColor: curFilter.overlay,
                  opacity: curFilter.opacity * filterIntensity,
                }} />
              )}

              {/* ── TOP BAR ─────────────────────────────────── */}
              {!recording && (
                <View style={{
                  position: "absolute", top: 0, left: 0, right: 0,
                  paddingTop: 52, paddingBottom: 12, paddingHorizontal: 16,
                  flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  backgroundColor: "rgba(0,0,0,0.28)",
                }}>
                  {/* ✕ Cerrar */}
                  <TouchableOpacity onPress={() => setStep("receta")}
                    style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" }}>
                    <Text style={{ color: "#fff", fontSize: 18, fontWeight: "300" }}>✕</Text>
                  </TouchableOpacity>
                  {/* 🎵 Añadir sonido */}
                  <TouchableOpacity onPress={() => setMusicPickerVisible(true)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 22, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" }}>
                    <Text style={{ fontSize: 16 }}>🎵</Text>
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
                      {selectedSong ? selectedSong.name.slice(0, 16) + "…" : "Añadir sonido"}
                    </Text>
                  </TouchableOpacity>
                  {/* Receta */}
                  <View style={{ backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 100, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }} numberOfLines={1}>🍽 {recetaElegida}</Text>
                  </View>
                </View>
              )}

              {/* Timer al grabar */}
              {recording && (
                <View style={{ position: "absolute", top: 56, alignSelf: "center", backgroundColor: "#EF4444EE", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" }} />
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 17, letterSpacing: 1 }}>{fmtDur(duration)}</Text>
                  <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>/ {recordMode === "15s" ? "0:15" : recordMode === "60s" ? "1:00" : "10:00"}</Text>
                </View>
              )}

              {/* ── SIDEBAR DERECHA — iconos verticales ───── */}
              {!recording && (
                <View style={{
                  position: "absolute", right: 12, top: "30%",
                  gap: 16, alignItems: "center",
                }}>
                  {[
                    { icon: "🔄", label: "Voltear",  onPress: () => setFacing(f => f === "back" ? "front" : "back") },
                    { icon: "⚡", label: "Veloc.",   onPress: () => {} },
                    { icon: "⏱",  label: "Timer",    onPress: () => {} },
                    { icon: "✨", label: "Belleza",  onPress: () => {} },
                    { icon: "🎨", label: "Filtros",  onPress: () => setFilterCarouselVisible(v => !v) },
                  ].map(item => (
                    <TouchableOpacity key={item.label} onPress={item.onPress}
                      style={{ alignItems: "center", gap: 3 }}>
                      <View style={{
                        width: 46, height: 46, borderRadius: 23,
                        backgroundColor: (item.label === "Filtros" && filterCarouselVisible) ? "rgba(31,111,235,0.7)" : "rgba(0,0,0,0.52)",
                        borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
                        justifyContent: "center", alignItems: "center",
                      }}>
                        <Text style={{ fontSize: 20 }}>{item.icon}</Text>
                      </View>
                      <Text style={{ color: "rgba(255,255,255,0.82)", fontSize: 10, fontWeight: "600" }}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* ── CARRUSEL DE FILTROS ────────────────────── */}
              {filterCarouselVisible && !recording && (
                <View style={{ position: "absolute", bottom: 210, left: 0, right: 0 }}>
                  {/* Barra de intensidad */}
                  <View style={{ paddingHorizontal: 20, marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>Intensidad</Text>
                      <Pressable
                        style={{ flex: 1, paddingVertical: 10 }}
                        onLayout={e => { filterIntensityBarRef.current = e.nativeEvent.layout.width; }}
                        onPress={e => {
                          const w = filterIntensityBarRef.current;
                          if (!w) return;
                          setFilterIntensity(Math.max(0.1, Math.min(1, e.nativeEvent.locationX / w)));
                        }}>
                        <View style={{ height: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2 }}>
                          <View style={{ width: `${filterIntensity * 100}%` as any, height: 4, backgroundColor: "#fff", borderRadius: 2 }} />
                        </View>
                      </Pressable>
                      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700", minWidth: 30 }}>{Math.round(filterIntensity * 100)}%</Text>
                    </View>
                  </View>
                  {/* Lista de filtros */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 10 }}>
                    {FILTERS.map(f => (
                      <TouchableOpacity key={f.name}
                        onPress={() => { setSelectedFilter(f.name); }}
                        style={{ alignItems: "center", gap: 6 }}>
                        <View style={{
                          width: 62, height: 82, borderRadius: 14, overflow: "hidden",
                          borderWidth: selectedFilter === f.name ? 2.5 : 1,
                          borderColor: selectedFilter === f.name ? "#fff" : "rgba(255,255,255,0.25)",
                          backgroundColor: "#111",
                        }}>
                          <View style={{ flex: 1, backgroundColor: f.overlay !== "transparent" ? f.overlay : "#334155", opacity: 0.7 + (f.opacity ?? 0) }} />
                          <View style={{ position: "absolute", inset: 0, justifyContent: "center", alignItems: "center" }}>
                            <Text style={{ fontSize: 24 }}>{f.icon}</Text>
                          </View>
                        </View>
                        <Text style={{ color: selectedFilter === f.name ? "#fff" : "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: selectedFilter === f.name ? "800" : "500" }}>
                          {f.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* ── SELECTOR DE MODO ──────────────────────── */}
              {!recording && (
                <View style={{ position: "absolute", bottom: 130, left: 0, right: 0, alignItems: "center" }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 4 }}>
                    {(["foto", "15s", "60s", "10min"] as const).map(mode => (
                      <TouchableOpacity key={mode} onPress={() => setRecordMode(mode)}
                        style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 }}>
                        <Text style={{
                          color: recordMode === mode ? "#fff" : "rgba(255,255,255,0.45)",
                          fontSize: 15,
                          fontWeight: recordMode === mode ? "800" : "400",
                        }}>
                          {mode === "foto" ? "Foto" : mode === "15s" ? "15s" : mode === "60s" ? "60s" : "10 min"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  {/* Indicador subrayado del modo activo */}
                  <View style={{ width: 20, height: 2.5, backgroundColor: "#fff", borderRadius: 2, marginTop: 4 }} />
                </View>
              )}

              {/* ── CONTROLES INFERIORES ────────────────── */}
              <View style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                paddingBottom: 46, paddingHorizontal: 28,
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              }}>
                {/* Galería (izq abajo) */}
                <TouchableOpacity
                  onPress={() => setCameraTab("gallery")} disabled={recording}
                  style={{ width: 56, height: 56, borderRadius: 14, overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)" }}>
                  <Text style={{ fontSize: 24 }}>🖼️</Text>
                  <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 9, fontWeight: "700" }}>Galería</Text>
                </TouchableOpacity>

                {/* BOTÓN CAPTURA — circular grande */}
                <TouchableOpacity
                  onPress={recording ? stopRecording : (recordMode === "foto"
                    ? async () => {
                        try {
                          const photo = await (cameraRef.current as any).takePictureAsync({ quality: 1 });
                          if (photo?.uri) {
                            setSelectedFotos(s => [...s, { uri: photo.uri }]);
                            setStep("detalles");
                          }
                        } catch {}
                      }
                    : startRecording)}
                  activeOpacity={0.85}>
                  {/* Anillo exterior */}
                  <View style={{
                    width: 86, height: 86, borderRadius: 43,
                    borderWidth: recording ? 4 : 5,
                    borderColor: recording ? "#EF4444" : "#ffffffEE",
                    justifyContent: "center", alignItems: "center",
                  }}>
                    {/* Círculo interior */}
                    <View style={{
                      width: recording ? 30 : (recordMode === "foto" ? 68 : 68),
                      height: recording ? 30 : (recordMode === "foto" ? 68 : 68),
                      borderRadius: recording ? 6 : (recordMode === "foto" ? 34 : 34),
                      backgroundColor: recording ? "#fff" : (recordMode === "foto" ? "#fff" : "#EF4444"),
                    }} />
                  </View>
                </TouchableOpacity>

                {/* Fotos (der abajo) */}
                <TouchableOpacity
                  onPress={() => pickFotos(() => setStep("detalles"))} disabled={recording}
                  style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.4)", borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", justifyContent: "center", alignItems: "center" }}>
                  <Text style={{ fontSize: 24 }}>📸</Text>
                  <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 9, fontWeight: "700" }}>Fotos</Text>
                </TouchableOpacity>
              </View>
            </CameraView>
          )}
          {/* Overlay negro: oculta la cámara durante la transición para evitar el "flip" visual */}
          {cameraTransition && (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#000", zIndex: 999 }]} pointerEvents="none" />
          )}
        </View>
      )}

      {/* ══ PASO 3: EDITOR TIKTOK STUDIO ════════════════════════════════════ */}
      {step === "detalles" && (
        <View style={{ flex: 1, backgroundColor: "#0A0F1A" }}>
          <SafeAreaView style={{ flex: 1 }}>

          {/* ── Header ───────────────────────────────────────────────────────── */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
            <TouchableOpacity onPress={() => { setIsPlaying(false); setStep("camara"); }}
              style={{ backgroundColor: "#ffffff18", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>← Atrás</Text>
            </TouchableOpacity>
            <Text style={{ flex: 1, color: "#fff", fontSize: 14, fontWeight: "800", textAlign: "center" }} numberOfLines={1}>
              🍽 {recetaElegida}
            </Text>
            <TouchableOpacity onPress={cerrar}
              style={{ backgroundColor: "#ffffff18", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Text style={{ color: "#94A3B8", fontWeight: "700", fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          </View>
          {/* ── Contenedor principal: preview arriba centrado, herramientas abajo ── */}
          <View style={{ flex: 1, flexDirection: "column" }}>

          {/* ── Video Preview ──────────────────────────────────────────────────── */}
          {/* Web: ocupa todo el ancho (sin restricción 9:16) para ser lo más grande posible */}
          {/* Native: 9:16 centrado medido con onLayout */}
          <View
            style={Platform.OS === "web"
              ? { flex: 1, backgroundColor: "#000", overflow: "hidden", position: "relative" }
              : { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}
            onLayout={e => setPreviewAreaH(e.nativeEvent.layout.height)}
          >

            {/* ── Web: preview a pantalla completa con rotación para horizontal ── */}
            {Platform.OS === "web" && (() => {
              const firstClipUri = clips.length > 0 ? clips[0].uri : null;
              const firstClipIsVideo = clips.length > 0 && clips[0].type === "video";
              const src = webPreview ?? (firstClipIsVideo ? firstClipUri : null);
              const imgSrc = !src ? (selectedFotos[0]?.uri ?? firstClipUri) : null;
              const filterCss = curFilter.webCss ? { filter: curFilter.webCss } : {};
              const normStyle: any = {
                position: "absolute", top: 0, left: 0,
                width: "100%", height: "100%", objectFit: "contain", ...filterCss,
              };
              const rotStyle: any = {
                position: "absolute",
                width: "177.78%", height: "56.25%",
                top: "21.875%", left: "-38.89%",
                transform: "rotate(90deg)", objectFit: "contain", ...filterCss,
              };
              if (src) return (React.createElement as any)("video", {
                ref: (el: any) => { detailVideoRef.current = el; },
                src, style: contentIsHorizontal ? rotStyle : normStyle,
                onLoadedMetadata: (e: any) => setContentIsHorizontal(e.target.videoWidth > e.target.videoHeight),
                muted: !previewing || muteVideo, loop: !previewing, autoPlay: !previewing, playsInline: true,
              });
              if (imgSrc) return (React.createElement as any)("img", {
                src: imgSrc,
                style: contentIsHorizontal ? rotStyle : normStyle,
                onLoad: (e: any) => setContentIsHorizontal(e.target.naturalWidth > e.target.naturalHeight),
              });
              return null;
            })()}

            {/* ── Native: contenedor 9:16 centrado ── */}
            {Platform.OS !== "web" && previewAreaH > 0 && (() => {
              const pW = previewAreaH * 9 / 16;
              const pH = previewAreaH;
              const rotNative: any = {
                position: "absolute",
                width: pH, height: pW,
                top: (pH - pW) / 2, left: (pW - pH) / 2,
                transform: [{ rotate: "90deg" }],
              };
              const uri0 = videoFile?.uri ?? (clips.length > 0 ? clips[0].uri : null);
              const isVideo0 = !!videoFile?.uri || (clips.length > 0 && clips[0].type === "video");
              const fotoUri = selectedFotos.length > 0 ? selectedFotos[0].uri
                : (clips.length > 0 && clips[0].type === "photo" ? clips[0].uri : null);
              const container916 = { width: pW, height: pH, overflow: "hidden" as const, position: "relative" as const, backgroundColor: "#000" as const };
              return (
                <View style={container916}>
                  {uri0 && isVideo0
                    ? <Video ref={detailVideoRef} source={{ uri: uri0 }}
                        style={StyleSheet.absoluteFillObject}
                        resizeMode={ResizeMode.CONTAIN}
                        isLooping={!isPlaying} shouldPlay={isPlaying} isMuted={muteVideo}
                        onReadyForDisplay={(e: any) => {
                          const { width, height } = e.naturalSize ?? {};
                          if (width && height) setContentIsHorizontal(width > height);
                        }}
                        onPlaybackStatusUpdate={(s: any) => {
                          if (s.didJustFinish) setIsPlaying(false);
                          if (s.positionMillis !== undefined) setCurrentTime(Math.floor(s.positionMillis / 1000));
                        }} />
                    : fotoUri
                      ? <Image source={{ uri: fotoUri }}
                          style={StyleSheet.absoluteFillObject}
                          resizeMode="contain"
                          onLoad={(e: any) => {
                            const { width, height } = e.nativeEvent?.source ?? {};
                            if (width && height) setContentIsHorizontal(width > height);
                          }} />
                      : <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 8 }}>
                          <Text style={{ fontSize: 52 }}>🎬</Text>
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Sin vista previa</Text>
                        </View>
                  }
                </View>
              );
            })()}

            {/* ── Overlays (filtro, texto, play/pause, duración) ── */}
            {curFilter.overlay !== "transparent" && (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: curFilter.overlay, opacity: curFilter.opacity }]} pointerEvents="none" />
            )}
            {textOverlay.trim() !== "" && (
              <View style={[StyleSheet.absoluteFillObject, {
                justifyContent: textPosition === "top" ? "flex-start" : textPosition === "center" ? "center" : "flex-end",
                paddingVertical: 24, paddingHorizontal: 16, alignItems: "center",
              }]} pointerEvents="none">
                <View style={{ backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16, textAlign: "center" }}>{textOverlay}</Text>
                </View>
              </View>
            )}

            {/* Tap para play/pause + long press 2x */}
            <TouchableOpacity
              activeOpacity={1}
              style={StyleSheet.absoluteFillObject}
              onPress={() => { if (!editorSpeedUp) toggleEditorPlayback(); }}
              onPressIn={() => { editorLongPressRef.current = setTimeout(() => {
                setEditorSpeedUp(true);
                if (Platform.OS === "web" && detailVideoRef.current) detailVideoRef.current.playbackRate = 2.0;
                else if (detailVideoRef.current) detailVideoRef.current.setRateAsync?.(2.0, true).catch(() => {});
                if (previewMusicRef.current) previewMusicRef.current.playbackRate = 2.0;
              }, 400); }}
              onPressOut={() => {
                if (editorLongPressRef.current) clearTimeout(editorLongPressRef.current); editorLongPressRef.current = null;
                if (editorSpeedUp) {
                  setEditorSpeedUp(false);
                  if (Platform.OS === "web" && detailVideoRef.current) detailVideoRef.current.playbackRate = 1.0;
                  else if (detailVideoRef.current) detailVideoRef.current.setRateAsync?.(1.0, true).catch(() => {});
                  if (previewMusicRef.current) previewMusicRef.current.playbackRate = 1.0;
                }
              }}
            >
              {/* 2x indicator */}
              {editorSpeedUp && (
                <View pointerEvents="none" style={{ position: "absolute", top: "40%", left: 0, right: 0, alignItems: "center", zIndex: 10 }}>
                  <View style={{ backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 }}>
                    <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900" }}>2x ⏩</Text>
                  </View>
                </View>
              )}
              <View style={{ position: "absolute", bottom: 10, right: 10,
                backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 22, width: 40, height: 40,
                alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 16 }}>{(Platform.OS === "web" ? previewing : isPlaying) ? "⏸" : "▶"}</Text>
              </View>
              {videoDuration > 0 && (
                <View style={{ position: "absolute", bottom: 10, left: 10,
                    backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
                      {fmtSec2(currentTime)} / {fmtSec2(videoDuration)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              {/* Botón mute audio del vídeo */}
              <TouchableOpacity
                onPress={() => setMuteVideo(v => !v)}
                style={{ position: "absolute", top: 10, right: 10,
                  backgroundColor: muteVideo ? "rgba(239,68,68,0.6)" : "rgba(0,0,0,0.55)",
                  borderRadius: 22, width: 40, height: 40,
                  alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 16 }}>{muteVideo ? "🔇" : "🔊"}</Text>
              </TouchableOpacity>

          </View>

          {/* ── Herramientas abajo ─────────────────────────────────────────────── */}
          <View>

          {/* ── Timeline interactiva ─────────────────────────────────────────── */}
          <View style={{ backgroundColor: "#060B14", paddingVertical: 7, paddingHorizontal: 14 }}
            onLayout={(e) => { timelineWidthRef.current = e.nativeEvent.layout.width - 28; }}>
            {/* Track con barra de progreso + thumb arrastrable */}
            <View
              style={{ height: 36, justifyContent: "center" }}
              onStartShouldSetResponder={() => videoDuration > 0}
              onMoveShouldSetResponder={() => videoDuration > 0}
              onResponderGrant={(e) => {
                if (!timelineWidthRef.current || videoDuration <= 0) return;
                const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / timelineWidthRef.current));
                seekEditorTo(Math.floor(ratio * videoDuration));
              }}
              onResponderMove={(e) => {
                if (!timelineWidthRef.current || videoDuration <= 0) return;
                const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / timelineWidthRef.current));
                seekEditorTo(Math.floor(ratio * videoDuration));
              }}
            >
              {/* Barra de fondo */}
              <View style={{ height: 6, borderRadius: 3, backgroundColor: "#1E293B", overflow: "hidden", position: "relative" }}>
                {/* Barra de progreso rellena */}
                {videoDuration > 0 && (
                  <View style={{
                    position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: 3,
                    backgroundColor: "#1F6FEB",
                    width: `${Math.min((currentTime / videoDuration) * 100, 100)}%` as any,
                  }} />
                )}
                {/* Bloque de música */}
                {selectedSong && videoDuration > 0 && (
                  <View style={{
                    position: "absolute", top: 0, bottom: 0, borderRadius: 3,
                    backgroundColor: "#8B5CF644",
                    left: `${(musicStartInVideo / videoDuration) * 100}%` as any,
                    right: "0%",
                  }} />
                )}
              </View>
              {/* Thumb circular */}
              {videoDuration > 0 && (
                <View style={{
                  position: "absolute",
                  left: `${(currentTime / videoDuration) * 100}%` as any,
                  top: 10, marginLeft: -8,
                  width: 16, height: 16, borderRadius: 8,
                  backgroundColor: "#fff",
                  borderWidth: 2, borderColor: "#1F6FEB",
                  elevation: 4,
                  shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3,
                }} />
              )}
            </View>
            {/* Time labels */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
              <Text style={{ color: "#475569", fontSize: 9 }}>0:00</Text>
              {videoDuration > 0 && <Text style={{ color: "#475569", fontSize: 9 }}>{fmtSec2(Math.floor(videoDuration / 2))}</Text>}
              <Text style={{ color: "#475569", fontSize: 9 }}>{videoDuration > 0 ? fmtSec2(videoDuration) : "--:--"}</Text>
            </View>
          </View>

          {/* ── Tool Tabs ─────────────────────────────────────────────────────── */}
          <View style={{ flexDirection: "row", backgroundColor: "#060B14",
            borderTopWidth: 1, borderTopColor: "#ffffff0D", borderBottomWidth: 1, borderBottomColor: "#ffffff0D" }}>
            {([
              { id: "musica",  icon: "🎵", label: "Música"  },
              { id: "filtros", icon: "🎞", label: "Filtros" },
              { id: "texto",   icon: "✏️", label: "Texto"   },
              { id: "descripcion", icon: "📄", label: t.descriptionLabel },
            ] as const).map(tab2 => (
              <TouchableOpacity key={tab2.id} onPress={() => setEditorTab(tab2.id)}
                style={{ flex: 1, alignItems: "center", paddingVertical: 9, gap: 2,
                  borderBottomWidth: 2,
                  borderBottomColor: editorTab === tab2.id ? "#1F6FEB" : "transparent" }}>
                <Text style={{ fontSize: 15 }}>{tab2.icon}</Text>
                <Text style={{ color: editorTab === tab2.id ? "#60A5FA" : "#475569", fontSize: 9, fontWeight: "700" }}>
                  {tab2.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Tool Panel ────────────────────────────────────────────────────── */}
          <View style={{ height: 150, backgroundColor: "#060B14" }}>

            {/* MÚSICA */}
            {editorTab === "musica" && (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}
                keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {selectedSong ? (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10,
                      backgroundColor: "#1F6FEB18", borderRadius: 12, padding: 10,
                      borderWidth: 1, borderColor: "#1F6FEB44" }}>
                      <Text style={{ fontSize: 20 }}>🎵</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#60A5FA", fontWeight: "800", fontSize: 12 }} numberOfLines={1}>{selectedSong.name}</Text>
                        <Text style={{ color: "#ffffff50", fontSize: 10 }}>
                          Empieza en {fmtSec2(musicStartInVideo)} del vídeo
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => setSelectedSong(null)}>
                        <View style={{ backgroundColor: "#EF444430", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "700" }}>✕</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                    {/* Volume */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ color: "#475569", fontSize: 11 }}>🔈</Text>
                      {Platform.OS === "web" ? (
                        <input type="range" min={0} max={100} step={1}
                          value={Math.round(musicVolume * 100)}
                          onChange={(e: any) => setMusicVolume(Number(e.target.value) / 100)}
                          style={{ flex: 1, accentColor: "#1F6FEB", cursor: "pointer" }} />
                      ) : (
                        <Pressable style={{ flex: 1, paddingVertical: 10 }}
                          onLayout={(e) => { volBarWidthRef.current = e.nativeEvent.layout.width; }}
                          onPress={(e) => {
                            if (!volBarWidthRef.current) return;
                            setMusicVolume(Math.max(0, Math.min(1, e.nativeEvent.locationX / volBarWidthRef.current)));
                          }}>
                          <View style={{ height: 4, backgroundColor: "#1E2533", borderRadius: 2 }}>
                            <View style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                              width: `${musicVolume * 100}%` as any, backgroundColor: "#1F6FEB", borderRadius: 2 }} />
                            <View style={{ position: "absolute", left: `${musicVolume * 100}%` as any,
                              top: -6, width: 14, height: 14, borderRadius: 7, backgroundColor: "#fff", marginLeft: -7 }} />
                          </View>
                        </Pressable>
                      )}
                      <Text style={{ color: "#475569", fontSize: 11 }}>🔊</Text>
                      <Text style={{ color: "#60A5FA", fontSize: 10, fontWeight: "700", minWidth: 30 }}>{Math.round(musicVolume * 100)}%</Text>
                    </View>
                    {/* Mute video audio toggle */}
                    {videoFile && (
                      <TouchableOpacity onPress={() => setMuteVideo(v => !v)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8,
                          backgroundColor: "#0D1117", borderRadius: 10, padding: 10 }}>
                        <Text style={{ fontSize: 16 }}>{muteVideo ? "🔇" : "🔊"}</Text>
                        <Text style={{ color: "#94A3B8", fontSize: 12, flex: 1 }}>
                          {muteVideo ? "Audio del vídeo silenciado" : "Audio original del vídeo activo"}
                        </Text>
                        <View style={{ width: 36, height: 20, borderRadius: 10, paddingHorizontal: 2,
                          backgroundColor: muteVideo ? "#1F6FEB" : "#374151", justifyContent: "center" }}>
                          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: "#fff",
                            alignSelf: muteVideo ? "flex-end" : "flex-start" }} />
                        </View>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <TouchableOpacity
                    style={{ flexDirection: "row", alignItems: "center", gap: 12,
                      backgroundColor: "#0D1117", borderRadius: 14, padding: 14,
                      borderWidth: 1, borderColor: "#ffffff12" }}
                    onPress={() => setMusicPickerVisible(true)}>
                    <Text style={{ fontSize: 28 }}>🎵</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{t.chooseSong}</Text>
                      <Text style={{ color: "#64748B", fontSize: 11 }}>Pop, Latino, Lo-fi y más</Text>
                    </View>
                    <Text style={{ color: "#60A5FA", fontSize: 20 }}>›</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}

            {/* FILTROS */}
            {editorTab === "filtros" && (
              <View style={{ flex: 1, justifyContent: "center" }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
                  {FILTERS.map(f => (
                    <TouchableOpacity key={f.name} onPress={() => setSelectedFilter(f.name)}
                      style={{ alignItems: "center", gap: 6 }}>
                      <View style={{ width: 60, height: 80, borderRadius: 10, overflow: "hidden",
                        borderWidth: 2, borderColor: selectedFilter === f.name ? "#fff" : "transparent",
                        backgroundColor: "#1E293B" }}>
                        <View style={{ flex: 1, backgroundColor: "#1E293B", justifyContent: "center", alignItems: "center" }}>
                          <Text style={{ fontSize: 28 }}>🍽</Text>
                        </View>
                        {f.overlay !== "transparent" && (
                          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: f.overlay, opacity: f.opacity * 1.5 }]} />
                        )}
                      </View>
                      <Text style={{ color: selectedFilter === f.name ? "#fff" : "#64748B",
                        fontSize: 9, fontWeight: "700", textAlign: "center" }}>
                        {f.icon} {f.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* TEXTO */}
            {editorTab === "texto" && (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}
                keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <TextInput style={[m.input, { marginBottom: 0 }]}
                  value={textOverlay} onChangeText={setTextOverlay}
                  placeholder="Texto que aparece sobre el vídeo..."
                  placeholderTextColor="#ffffff40" maxLength={80} />
                {textOverlay.trim() !== "" && (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {(["top", "center", "bottom"] as const).map(pos => (
                      <TouchableOpacity key={pos} onPress={() => setTextPosition(pos)}
                        style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center",
                          backgroundColor: textPosition === pos ? "#1F6FEB" : "#0D1117",
                          borderWidth: 1, borderColor: textPosition === pos ? "#60A5FA" : "#1E293B" }}>
                        <Text style={{ color: textPosition === pos ? "#fff" : "#475569", fontSize: 11, fontWeight: "700" }}>
                          {pos === "top" ? "↑ Arriba" : pos === "center" ? "• Centro" : "↓ Abajo"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}

            {/* AJUSTES */}
            {editorTab === "descripcion" && (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}
                keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <TextInput style={[m.input, { height: 68, marginBottom: 0 }]}
                  value={descripcion} onChangeText={setDescripcion}
                  placeholder={t.recipeStepsPlaceholder}
                  placeholderTextColor="#ffffff40" multiline numberOfLines={3} maxLength={300} />
                <TextInput style={[m.input, { marginBottom: 0 }]}
                  value={hashtagsInput} onChangeText={setHashtagsInput}
                  placeholder={t.hashtagsPlaceholder}
                  placeholderTextColor="#ffffff40" maxLength={120}
                  autoCapitalize="none" autoCorrect={false} />
              </ScrollView>
            )}
          </View>

          {/* ── Publish Bar ───────────────────────────────────────────────────── */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10,
            paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#060B14",
            borderTopWidth: 1, borderTopColor: "#ffffff10" }}>
            {subiendo && (
              <View style={{ flex: 1, height: 4, backgroundColor: "#1E293B", borderRadius: 2, overflow: "hidden" }}>
                <View style={{ width: `${progreso}%` as any, height: 4, backgroundColor: "#1F6FEB", borderRadius: 2 }} />
              </View>
            )}
            {!subiendo && (
              <Text style={{ flex: 1, color: "#475569", fontSize: 11 }} numberOfLines={1}>
                {hashtagsInput.trim() ? hashtagsInput.trim().split(/\s+/).slice(0, 3).join(" ") : "🍽 " + recetaElegida}
              </Text>
            )}
            <TouchableOpacity
              style={{ backgroundColor: (subiendo || composing || (!videoFile && selectedFotos.length === 0 && clips.length === 0) || !userId) ? "#1E293B" : "#1F6FEB",
                borderRadius: 20, paddingHorizontal: 24, paddingVertical: 12,
                flexDirection: "row", alignItems: "center", gap: 8 }}
              onPress={subir}
              disabled={subiendo || composing || (!videoFile && selectedFotos.length === 0 && clips.length === 0) || !userId}>
              {subiendo || composing
                ? <><ActivityIndicator color="#fff" size="small" /><Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>{progreso}%</Text></>
                : <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>{t.publishReel} →</Text>
              }
            </TouchableOpacity>
          </View>

          </View>{/* end herramientas */}
          </View>{/* end contenedor principal */}

          {/* Overlay compositor Canvas */}
          {composing && (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(10,15,26,0.94)", justifyContent: "center", alignItems: "center", gap: 20, zIndex: 99 }]}>
              <Text style={{ fontSize: 52 }}>🎬</Text>
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", textAlign: "center" }}>Componiendo reel...</Text>
              <Text style={{ color: "#64748B", fontSize: 13, textAlign: "center", paddingHorizontal: 32 }}>
                Esto puede tardar unos segundos dependiendo de la duración y el número de clips.
              </Text>
              <View style={{ width: 220, height: 6, backgroundColor: "#1E293B", borderRadius: 3, overflow: "hidden" }}>
                <View style={{ width: `${composingProgress}%` as any, height: 6, backgroundColor: "#1F6FEB", borderRadius: 3 }} />
              </View>
              <Text style={{ color: "#60A5FA", fontSize: 13, fontWeight: "700" }}>{composingProgress}%</Text>
            </View>
          )}
        </SafeAreaView>
        </View>
      )}

      <MusicPickerModal
        visible={musicPickerVisible}
        onClose={() => setMusicPickerVisible(false)}
        onSelect={song => { setSelectedSong(song); setMusicStartInVideo(currentTime); }}
        videoDuration={videoDuration}
      />
    </Modal>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function ReelsScreen() {
  const { t, language } = useApp();
  const router = useRouter();
  const params = useLocalSearchParams<{ recetaNombre?: string }>();
  const [tab, setTab] = useState<"parati" | "siguiendo">("parati");
  const [reels, setReels] = useState<Reel[]>([]);
  const [siguiendoReels, setSiguiendoReels] = useState<Reel[]>([]);
  const [cargando, setCargando] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [seguidosIds, setSeguidosIds] = useState<Set<string>>(new Set());
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [userId, setUserId] = useState("");
  const myAvatarUri = useAvatar();
  const [modalSubir, setModalSubir] = useState(false);
  const [recetaPrevia, setRecetaPrevia] = useState<string | undefined>();
  const [confirmarBorrar, setConfirmarBorrar] = useState<Reel | null>(null);
  const [modalReceta, setModalReceta] = useState<Reel | null>(null);
  const [recetaDetalle, setRecetaDetalle] = useState<any>(null);
  const [cargandoReceta, setCargandoReceta] = useState(false);
  const [likedHashtags, setLikedHashtags] = useState<Set<string>>(new Set());
  const [hashtagActivo, setHashtagActivo] = useState<string | null>(null);
  const [modalBuscar, setModalBuscar] = useState(false);
  const [buscarQuery, setBuscarQuery] = useState("");
  const [buscarTab, setBuscarTab] = useState<"hashtags" | "personas">("hashtags");
  const [personasResultados, setPersonasResultados] = useState<any[]>([]);
  const { height: SH } = useWindowDimensions();
  const [guardandoRecetaExt, setGuardandoRecetaExt] = useState(false);
  const [recetaGuardada, setRecetaGuardada] = useState(false);
  const scrollRef = useRef<any>(null);
  const scrollDebounceRef = useRef<any>(null);
  const viewedThisSession = useRef<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const [modalComentarios, setModalComentarios] = useState<Reel | null>(null);
  const [sugeridosCreadores, setSugeridosCreadores] = useState<any[]>([]);
  const [savedVideoIds, setSavedVideoIds] = useState<Set<string>>(new Set());
  const [reelParaAnadir, setReelParaAnadir] = useState<{ reel: Reel; detalle: any } | null>(null);
  const [navigatingAway, setNavigatingAway] = useState(false);

  const feedPaused = modalSubir || !!confirmarBorrar || !!modalReceta || !!modalComentarios || modalBuscar || navigatingAway;

  // Configurar audio session una sola vez al montar (necesario para iOS modo silencio)
  useEffect(() => {
    if (Platform.OS === "web") return;
    try {
      Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
      }).catch(() => {});
    } catch {}
  }, []);

  // Si viene desde recetas.tsx con una receta pre-seleccionada
  useEffect(() => {
    if (params.recetaNombre) {
      setRecetaPrevia(decodeURIComponent(params.recetaNombre));
      setModalSubir(true);
    }
  }, [params.recetaNombre]);

  // Cargar reels vistos de AsyncStorage al montar
  useEffect(() => {
    AsyncStorage.getItem("nutri_viewed_reels").then(v => {
      if (v) try { const arr = JSON.parse(v); arr.forEach((id: string) => viewedThisSession.current.add(id)); } catch {}
    });
  }, []);

  // View tracking: increment after 2s watching the same reel
  useEffect(() => {
    const currentList = tab === "parati" ? reels : siguiendoReels;
    const reel = currentList[activeIdx];
    if (!reel) return;
    const timer = setTimeout(() => {
      if (viewedThisSession.current.has(reel.id)) return;
      viewedThisSession.current.add(reel.id);
      supabase.rpc("increment_views", { row_id: reel.id });
      // Persistir vistos (últimos 200 para no crecer infinito)
      const arr = [...viewedThisSession.current].slice(-200);
      AsyncStorage.setItem("nutri_viewed_reels", JSON.stringify(arr));
      const upd = (list: Reel[]) => list.map(r => r.id === reel.id ? { ...r, views: (r.views ?? 0) + 1 } : r);
      setReels(upd); setSiguiendoReels(upd);
    }, 2000);
    return () => clearTimeout(timer);
  }, [activeIdx, tab]);

  useFocusEffect(useCallback(() => {
    // Pantalla activa
    setNavigatingAway(false);
    setActiveIdx(0);
    setTimeout(() => {
      if (scrollRef.current?.scrollTo) scrollRef.current.scrollTo({ y: 0, animated: false });
      else if (scrollRef.current?.scrollTop !== undefined) scrollRef.current.scrollTop = 0;
    }, 0);
    let mounted = true;
    cargarDatos(mounted);
    // Pantalla pierde foco → pausar todo
    return () => { mounted = false; setNavigatingAway(true); };
  }, [tab]));

  const cargarDatos = async (mounted = true) => {
    if (mounted) setCargando(true);
    setHasMore(true);
    cursorRef.current = null;
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

      const [liked, likedHTRaw, savedRaw] = await Promise.all([
        AsyncStorage.getItem(LIKED_KEY),
        AsyncStorage.getItem(LIKED_HASHTAGS_KEY),
        AsyncStorage.getItem("nutri_recetas_guardadas"),
      ]);
      if (!mounted) return;
      setLikedIds(new Set(liked ? JSON.parse(liked) : []));
      const savedLista = savedRaw ? JSON.parse(savedRaw) : [];
      setSavedVideoIds(new Set(savedLista.filter((r: any) => r.reel_id).map((r: any) => r.reel_id as string)));
      const likedHTSet = new Set<string>(likedHTRaw ? JSON.parse(likedHTRaw) : []);
      setLikedHashtags(likedHTSet);

      const mergeAvatars = async (reelList: Reel[]): Promise<Reel[]> => {
        const now = Date.now();
        const uncachedIds = [...new Set(reelList.map(r => r.autor_id).filter(id => {
          if (!id) return false;
          if (!_avatarCache.has(id)) return true;
          return now - (_avatarCacheTTL.get(id) ?? 0) > AVATAR_TTL_MS; // expirado
        }))];
        if (uncachedIds.length > 0) {
          const { data: perfs } = await supabase.from("perfiles").select("id,avatar_url").in("id", uncachedIds);
          for (const p of perfs ?? []) {
            _avatarCache.set(p.id, p.avatar_url ?? "");
            _avatarCacheTTL.set(p.id, now);
          }
        }
        return reelList.map(r => {
          const cached = _avatarCache.get(r.autor_id);
          return { ...r, autor_avatar: cached || r.autor_avatar };
        });
      };

      if (tab === "parati") {
        const { data } = await supabase.from("videos_recetas").select("*").order("creado_en", { ascending: false }).limit(50);
        if (!mounted) return;
        const raw = (data ?? []).filter((r: any) => r.titulo || r.video_url || (r.fotos?.length ?? 0) > 0) as Reel[];
        if (data && data.length < 50) setHasMore(false);
        else if (data && data.length > 0) cursorRef.current = data[data.length - 1].creado_en;
        // Separar vistos y no vistos, no vistos primero
        const notSeen = raw.filter(r => !viewedThisSession.current.has(r.id));
        const seen = raw.filter(r => viewedThisSession.current.has(r.id));
        const sortedNew = notSeen.sort((a, b) => scoreReel(b, likedHTSet, language) - scoreReel(a, likedHTSet, language));
        const sortedSeen = seen.sort((a, b) => scoreReel(b, likedHTSet, language) - scoreReel(a, likedHTSet, language));
        const sorted = [...sortedNew, ...sortedSeen];
        const withAvatars = await mergeAvatars(sorted);
        if (!mounted) return;
        setReels(withAvatars);
      } else {
        const { data: segs } = await supabase.from("seguidos").select("followed_id").eq("follower_id", uid);
        const ids = (segs ?? []).map((s: any) => s.followed_id);
        if (!mounted) return;
        if (ids.length > 0) {
          const { data } = await supabase.from("videos_recetas").select("*").in("autor_id", ids).order("creado_en", { ascending: false }).limit(50);
          if (!mounted) return;
          const filtered = (data ?? []).filter((r: any) => r.titulo || r.video_url || (r.fotos?.length ?? 0) > 0) as Reel[];
          const withAvatars = await mergeAvatars(filtered);
          if (!mounted) return;
          setSiguiendoReels(withAvatars);
        } else {
          // Suggest top creators: users with most reels
          const { data: topReels } = await supabase
            .from("videos_recetas")
            .select("autor_id, autor, autor_avatar")
            .neq("autor_id", uid)
            .order("creado_en", { ascending: false })
            .limit(100);
          setSiguiendoReels([]);
          if (topReels) {
            const seen = new Set<string>();
            const sugeridos = topReels.filter((r: any) => {
              if (!r.autor_id || seen.has(r.autor_id)) return false;
              seen.add(r.autor_id);
              return true;
            }).slice(0, 8);
            if (mounted) setSugeridosCreadores(sugeridos as any[]);
          }
        }
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

  const handleGuardarVideo = async (reel: Reel) => {
    const SAVED_KEY = "nutri_recetas_guardadas";
    const raw = await AsyncStorage.getItem(SAVED_KEY);
    const lista = raw ? JSON.parse(raw) : [];
    const yaGuardado = lista.some((r: any) => r.reel_id === reel.id);
    if (yaGuardado) {
      const nueva = lista.filter((r: any) => r.reel_id !== reel.id);
      await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(nueva));
      quitarRecetaDeCloud(`reel_${reel.id}`);
      const next = new Set(savedVideoIds); next.delete(reel.id); setSavedVideoIds(next);
    } else {
      const entrada = {
        pub_id: `reel_${reel.id}`, reel_id: reel.id,
        video_url: reel.video_url, nombre: reel.titulo,
        descripcion: reel.descripcion ?? "", ingredientes: [],
        calorias_total: 0, proteinas_total: 0, grasas_total: 0, carbohidratos_total: 0,
        autor: reel.autor ?? "", savedAt: Date.now(),
      };
      await AsyncStorage.setItem(SAVED_KEY, JSON.stringify([...lista, entrada]));
      guardarRecetaEnCloud(`reel_${reel.id}`, entrada);
      const next = new Set(savedVideoIds); next.add(reel.id); setSavedVideoIds(next);
    }
  };

  const reelToReceta = (reel: Reel, detalle: any): Receta => {
    const ings: any[] = detalle?.ingredientes ?? [];
    const totalG = ings.reduce((s: number, i: any) => s + (i.gramos || 0), 0);
    return {
      nombre: detalle?.nombre ?? reel.titulo,
      descripcion: detalle?.descripcion ?? reel.descripcion ?? "",
      raciones: 1,
      calorias_total: detalle?.calorias_total ?? 0,
      proteinas_total: detalle?.proteinas_total ?? 0,
      grasas_total: detalle?.grasas_total ?? 0,
      carbohidratos_total: detalle?.carbohidratos_total ?? 0,
      ingredientes: ings.map((ing: any) => {
        const frac = totalG > 0 ? (ing.gramos || 0) / totalG : 0;
        return {
          nombre: ing.nombre, gramos: ing.gramos || 0,
          calorias: (detalle?.calorias_total ?? 0) * frac,
          proteinas: (detalle?.proteinas_total ?? 0) * frac,
          carbs: (detalle?.carbohidratos_total ?? 0) * frac,
          grasas: (detalle?.grasas_total ?? 0) * frac,
        };
      }),
    } as Receta;
  };

  const handleAnadirAlDia = async (reel: Reel) => {
    const { data } = await supabase
      .from("recetas")
      .select("nombre,descripcion,ingredientes,calorias_total,proteinas_total,grasas_total,carbohidratos_total")
      .eq("nombre", reel.titulo).limit(1).single();
    setReelParaAnadir({ reel, detalle: data ?? null });
  };

  const guardarEnMeal = async (kcal: number, prot: number, carb: number, gras: number, nombre: string, meal: MealKey, raciones: number) => {
    if (!reelParaAnadir) return;
    const d = new Date();
    const key = `nutri_meals_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const stored = await AsyncStorage.getItem(key);
    const BASE = { desayuno: [] as any[], comida: [] as any[], merienda: [] as any[], cena: [] as any[] };
    const meals = stored ? { ...BASE, ...JSON.parse(stored) } : { ...BASE };
    meals[meal] = [...(meals[meal] ?? []), {
      id: Date.now().toString(), name: nombre,
      brand: reelParaAnadir.reel.autor ? `@${reelParaAnadir.reel.autor}` : "Receta propia",
      supermercado: "Receta propia", calories: Math.round(kcal),
      protein: Number(prot.toFixed(1)), carbs: Number(carb.toFixed(1)), fat: Number(gras.toFixed(1)),
      servingSize: 1, esReceta: true, raciones,
    }];
    await AsyncStorage.setItem(key, JSON.stringify(meals));
    setReelParaAnadir(null);
    Alert.alert("✅ Añadido", `"${nombre}" añadido al ${meal}`);
  };

  const cargarMas = async () => {
    if (!hasMore || loadingMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const { data } = await supabase
        .from("videos_recetas")
        .select("*")
        .lt("creado_en", cursorRef.current)
        .order("creado_en", { ascending: false })
        .limit(20);
      if (!data || data.length === 0) { setHasMore(false); return; }
      if (data.length < 20) setHasMore(false);
      cursorRef.current = data[data.length - 1].creado_en;
      const raw = data.filter((r: any) => r.titulo || r.video_url || (r.fotos?.length ?? 0) > 0) as Reel[];
      setReels(prev => [...prev, ...raw]);
    } catch {}
    finally { setLoadingMore(false); }
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

  const buscarPersonas = async (q: string) => {
    if (!q.trim()) { setPersonasResultados([]); return; }
    const { data } = await supabase.from("perfiles").select("id,nombre_usuario,avatar_url,bio").ilike("nombre_usuario", `%${q.trim()}%`).limit(20);
    setPersonasResultados(data ?? []);
  };

  const abrirPerfilReel = (autorId: string) => {
    setModalBuscar(false);
    setBuscarQuery("");
    setPersonasResultados([]);
    router.push({ pathname: "/usuario/[id]" as any, params: { id: autorId } });
  };

  const lista = tab === "parati" ? reels : siguiendoReels;

  const listaFiltrada = useMemo(() => {
    return hashtagActivo ? lista.filter(r => r.hashtags?.includes(hashtagActivo)) : lista;
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
        tab === "siguiendo" ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 64 }}>👥</Text>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 16, textAlign: "center" }}>
              {t.noReelsFromFollowed}
            </Text>
            {sugeridosCreadores.length > 0 && (
              <View style={{ marginTop: 24, width: "100%" }}>
                <Text style={{ color: "#94A3B8", fontSize: 13, marginBottom: 14, textAlign: "center" }}>
                  Descubre creadores populares
                </Text>
                {sugeridosCreadores.map((c: any) => {
                  const AVATAR_COLORS = ["#EF4444","#F97316","#EAB308","#22C55E","#3B82F6","#8B5CF6","#EC4899"];
                  const letter = c.autor ? c.autor[0].toUpperCase() : "?";
                  const color = AVATAR_COLORS[(c.autor?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
                  const seguido = seguidosIds.has(c.autor_id);
                  return (
                    <View key={c.autor_id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 }}>
                      {c.autor_avatar
                        ? <Image source={{ uri: c.autor_avatar }} style={{ width: 42, height: 42, borderRadius: 21 }} />
                        : <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{letter}</Text>
                          </View>
                      }
                      <Text style={{ color: "#fff", fontWeight: "700", flex: 1 }}>@{c.autor}</Text>
                      <TouchableOpacity
                        onPress={async () => {
                          if (seguido) {
                            await supabase.from("seguidos").delete().eq("follower_id", userId).eq("followed_id", c.autor_id);
                            setSeguidosIds(prev => { const n = new Set(prev); n.delete(c.autor_id); return n; });
                          } else {
                            await supabase.from("seguidos").upsert([{ follower_id: userId, follower_nombre: nombreUsuario, followed_id: c.autor_id, followed_nombre: c.autor }], { onConflict: "follower_id,followed_id", ignoreDuplicates: true });
                            setSeguidosIds(prev => new Set([...prev, c.autor_id]));
                          }
                        }}
                        style={{ backgroundColor: seguido ? "#1E2533" : "#1F6FEB", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 }}>
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{seguido ? "Siguiendo ✓" : "Seguir"}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 64 }}>🎬</Text>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 20, textAlign: "center" }}>
              {t.noReelsYet}
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: 14, marginTop: 10, textAlign: "center", lineHeight: 22 }}>
              {t.beFirstToShareVideo}
            </Text>
            <TouchableOpacity
              style={{ marginTop: 28, backgroundColor: "#1F6FEB", borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 }}
              onPress={() => setModalSubir(true)}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{t.uploadFirstReel}</Text>
            </TouchableOpacity>
          </View>
        )
      ) : Platform.OS === "web" ? (
        // Web: CSS scroll-snap para transiciones ultra fluidas
        (React.createElement as any)("div", {
          ref: (el: any) => {
            scrollRef.current = el;
            if (el && !el._snapSetup) {
              el._snapSetup = true;
              el.style.cssText = "flex:1;overflow-y:scroll;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;";
              el.addEventListener("scroll", () => {
                if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
                scrollDebounceRef.current = setTimeout(() => {
                  const idx = Math.round(el.scrollTop / el.clientHeight);
                  setActiveIdx(idx);
                }, 80);
                if (tab === "parati" && !loadingMore && el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 2) cargarMas();
              }, { passive: true });
            }
          },
        },
          listaFiltrada.map((reel: Reel, i: number) => (
            (React.createElement as any)("div", {
              key: reel.id,
              style: { scrollSnapAlign: "start", height: `${SH}px`, width: "100%", flexShrink: 0 },
            },
              Math.abs(i - activeIdx) <= 1 ? (
                <ReelItem
                  reel={reel}
                  active={i === activeIdx && !feedPaused}
                  liked={likedIds.has(reel.id)}
                  onLike={() => handleLike(reel)}
                  seguido={seguidosIds.has(reel.autor_id)}
                  onFollow={() => handleFollow(reel)}
                  esMio={reel.autor_id === userId}
                  onDelete={() => setConfirmarBorrar(reel)}
                  onComentarios={() => setModalComentarios(reel)}
                  onGuardar={() => handleGuardarVideo(reel)}
                  isGuardado={savedVideoIds.has(reel.id)}
                  onAnadirAlDia={() => handleAnadirAlDia(reel)}
                  onOpenProfile={() => abrirPerfilReel(reel.autor_id)}
                />
              ) : <View style={{ flex: 1, backgroundColor: "#000" }} />
            )
          )),
          loadingMore && (React.createElement as any)("div", { style: { height: 80, display: "flex", alignItems: "center", justifyContent: "center" } },
            <ActivityIndicator color="#fff" />
          ),
        )
      ) : (
        // Native: ScrollView con pagingEnabled
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          onScroll={e => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / SH);
            if (idx !== activeIdx) setActiveIdx(idx);
            if (tab === "parati" && !loadingMore) {
              const totalHeight = e.nativeEvent.contentSize.height;
              const offset = e.nativeEvent.contentOffset.y;
              const viewHeight = e.nativeEvent.layoutMeasurement.height;
              if (totalHeight - offset - viewHeight < SH * 2) cargarMas();
            }
          }}
          scrollEventThrottle={16}
        >
          {listaFiltrada.map((reel, i) => (
            Math.abs(i - activeIdx) <= 1 ? (
              <ReelItem
                key={reel.id}
                reel={reel}
                active={i === activeIdx && !feedPaused}
                liked={likedIds.has(reel.id)}
                onLike={() => handleLike(reel)}
                seguido={seguidosIds.has(reel.autor_id)}
                onFollow={() => handleFollow(reel)}
                esMio={reel.autor_id === userId}
                onDelete={() => setConfirmarBorrar(reel)}
                onComentarios={() => setModalComentarios(reel)}
                onGuardar={() => handleGuardarVideo(reel)}
                isGuardado={savedVideoIds.has(reel.id)}
                onAnadirAlDia={() => handleAnadirAlDia(reel)}
                onOpenProfile={() => abrirPerfilReel(reel.autor_id)}
              />
            ) : <View key={reel.id} style={{ width: SW, height: SH, backgroundColor: "#000" }} />
          ))}
          {loadingMore && (
            <View style={{ height: 80, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Header superpuesto ── */}
      <SafeAreaView style={h.wrap} pointerEvents="box-none">
        <View style={h.row} pointerEvents="box-none">
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace("/" as any)} style={{ minWidth: 70 }}>
            <Text style={h.back}>{t.back}</Text>
          </TouchableOpacity>
          <View style={h.tabs}>
            <TouchableOpacity onPress={() => { setTab("parati"); setActiveIdx(0); setHashtagActivo(null); }}>
              <Text style={[h.tab, tab === "parati" && h.tabActive]}>{t.forYou}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setTab("siguiendo"); setActiveIdx(0); setHashtagActivo(null); }}>
              <Text style={[h.tab, tab === "siguiendo" && h.tabActive]}>
                {t.followingCount}{seguidosIds.size > 0 ? ` (${seguidosIds.size})` : ""}
              </Text>
            </TouchableOpacity>
          </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 70, justifyContent: "flex-end" }}>
            <TouchableOpacity onPress={() => setModalBuscar(true)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 16 }}>🔍</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setRecetaPrevia(undefined); setModalSubir(true); }}>
              <Text style={h.plus}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>
        {hashtagActivo && (
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 6 }}>
            <View style={[h.chip, h.chipActive]}>
              <Text style={[h.chipTxt, h.chipActiveTxt]}>#{hashtagActivo}</Text>
            </View>
            <TouchableOpacity onPress={() => { setHashtagActivo(null); setActiveIdx(0); }} style={{ marginLeft: 6 }}>
              <Text style={{ color: "#fff", fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* ── Modal búsqueda ── */}
      <Modal visible={modalBuscar} animationType="slide" onRequestClose={() => { setModalBuscar(false); setBuscarQuery(""); setPersonasResultados([]); }}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <SafeAreaView style={{ flex: 1 }}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 10 }}>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ fontSize: 15, marginRight: 6 }}>🔍</Text>
                <TextInput
                  style={{ flex: 1, color: "#fff", fontSize: 15 }}
                  placeholder={buscarTab === "hashtags" ? "Buscar hashtag..." : "Buscar persona..."}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={buscarQuery}
                  onChangeText={q => {
                    setBuscarQuery(q);
                    if (buscarTab === "personas") buscarPersonas(q);
                  }}
                  autoFocus
                />
                {!!buscarQuery && (
                  <TouchableOpacity onPress={() => { setBuscarQuery(""); setPersonasResultados([]); }}>
                    <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity onPress={() => { setModalBuscar(false); setBuscarQuery(""); setPersonasResultados([]); }}>
                <Text style={{ color: "#60A5FA", fontSize: 15, fontWeight: "600" }}>{t.cancel}</Text>
              </TouchableOpacity>
            </View>
            {/* Tabs */}
            <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)", marginHorizontal: 14, marginBottom: 4 }}>
              {(["hashtags", "personas"] as const).map(tab => (
                <TouchableOpacity key={tab} onPress={() => { setBuscarTab(tab); setBuscarQuery(""); setPersonasResultados([]); }}
                  style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: buscarTab === tab ? "#1F6FEB" : "transparent" }}>
                  <Text style={{ color: buscarTab === tab ? "#fff" : "rgba(255,255,255,0.4)", fontWeight: "700", fontSize: 14 }}>
                    {tab === "hashtags" ? "# Hashtags" : "👤 Personas"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
              {buscarTab === "hashtags" ? (
                <View style={{ padding: 14 }}>
                  {!buscarQuery && (
                    <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Populares</Text>
                  )}
                  {todosHashtags
                    .filter(h => !buscarQuery || h.toLowerCase().includes(buscarQuery.toLowerCase().replace(/^#/, "")))
                    .map(tag => (
                      <TouchableOpacity key={tag} onPress={() => { setHashtagActivo(tag); setActiveIdx(0); setModalBuscar(false); setBuscarQuery(""); }}
                        style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)" }}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#1F6FEB22", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                          <Text style={{ color: "#60A5FA", fontSize: 18, fontWeight: "800" }}>#</Text>
                        </View>
                        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>#{tag}</Text>
                        {hashtagActivo === tag && <Text style={{ color: "#60A5FA", marginLeft: "auto" }}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                  {buscarQuery && todosHashtags.filter(h => h.toLowerCase().includes(buscarQuery.toLowerCase().replace(/^#/, ""))).length === 0 && (
                    <Text style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 40 }}>Sin resultados</Text>
                  )}
                </View>
              ) : (
                <View style={{ padding: 14 }}>
                  {personasResultados.length === 0 && !!buscarQuery && (
                    <Text style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 40 }}>Sin resultados</Text>
                  )}
                  {!buscarQuery && (
                    <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Busca por nombre de usuario</Text>
                  )}
                  {personasResultados.map(persona => (
                    <TouchableOpacity key={persona.id} onPress={() => abrirPerfilReel(persona.id)}
                      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)" }}>
                      {persona.avatar_url
                        ? <Image source={{ uri: persona.avatar_url }} style={{ width: 44, height: 44, borderRadius: 22, marginRight: 12 }} />
                        : <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>{(persona.nombre_usuario?.[0] ?? "?").toUpperCase()}</Text>
                          </View>
                      }
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>@{persona.nombre_usuario}</Text>
                        {persona.bio ? <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }} numberOfLines={1}>{persona.bio}</Text> : null}
                      </View>
                      <Text style={{ color: "rgba(255,255,255,0.3)", fontSize: 18 }}>›</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Modal subir */}
      <ModalSubir
        visible={modalSubir}
        onClose={() => { setModalSubir(false); setRecetaPrevia(undefined); }}
        onSubido={cargarDatos}
        nombreUsuario={nombreUsuario}
        userId={userId}
        avatarUri={myAvatarUri}
        recetaPrevia={recetaPrevia}
      />

      {/* Comentarios */}
      <ComentariosModal
        visible={!!modalComentarios}
        reel={modalComentarios}
        userId={userId}
        nombreUsuario={nombreUsuario}
        avatarUri={myAvatarUri}
        onClose={() => setModalComentarios(null)}
        onCountChange={(count) => {
          if (!modalComentarios) return;
          const upd = (list: Reel[]) => list.map(r => r.id === modalComentarios.id ? { ...r, comentarios: count } : r);
          setReels(upd); setSiguiendoReels(upd);
        }}
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
            <Text style={{ color: "#94A3B8", fontSize: 12, marginBottom: 12 }}>{t.by} @{modalReceta?.autor}</Text>

            {cargandoReceta ? (
              <ActivityIndicator color="#58A6FF" style={{ marginVertical: 20 }} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Macros */}
                {recetaDetalle && (
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                    {[
                      { val: Math.round(recetaDetalle.calorias_total ?? 0), label: "kcal", color: "#4ADE80" },
                      { val: Math.round(recetaDetalle.proteinas_total ?? 0) + "g", label: t.proteins, color: "#60A5FA" },
                      { val: Math.round(recetaDetalle.carbohidratos_total ?? 0) + "g", label: t.carbs, color: "#FBBF24" },
                      { val: Math.round(recetaDetalle.grasas_total ?? 0) + "g", label: t.fats, color: "#F87171" },
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
                    <Text style={{ color: "#fff", fontWeight: "700", marginBottom: 6 }}>📝 {t.descriptionLabel}</Text>
                    <Text style={{ color: "#CBD5E1", fontSize: 13, lineHeight: 20 }}>
                      {recetaDetalle?.descripcion || modalReceta?.descripcion}
                    </Text>
                  </View>
                ) : null}

                {/* Ingredientes */}
                {recetaDetalle?.ingredientes?.length > 0 ? (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ color: "#fff", fontWeight: "700", marginBottom: 8 }}>🥗 {t.ingredientsLabel}</Text>
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
                        const nuevaEntrada = {
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
                        };
                        await AsyncStorage.setItem(SAVED_KEY, JSON.stringify([...lista, nuevaEntrada]));
                        guardarRecetaEnCloud(`reel_${modalReceta.id}`, nuevaEntrada);
                      }
                      setGuardandoRecetaExt(false);
                      setRecetaGuardada(true);
                      Alert.alert(t.saved, t.recipeSavedMsg);
                    }}
                    disabled={guardandoRecetaExt || recetaGuardada}
                  >
                    {guardandoRecetaExt
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>
                          {recetaGuardada ? t.saved : `💾 ${t.saveRecipeBtn}`}
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

      {/* Añadir receta del reel al día */}
      <AnadirRecetaModal
        receta={reelParaAnadir ? reelToReceta(reelParaAnadir.reel, reelParaAnadir.detalle) : null}
        visible={!!reelParaAnadir}
        onClose={() => setReelParaAnadir(null)}
        onAdd={guardarEnMeal}
      />

      {/* Confirmar borrar */}
      <Modal visible={!!confirmarBorrar} transparent animationType="fade" onRequestClose={() => setConfirmarBorrar(null)}>
        <TouchableOpacity style={p.overlay} activeOpacity={1} onPress={() => setConfirmarBorrar(null)}>
          <TouchableOpacity activeOpacity={1} style={p.box}>
            <Text style={p.title}>🗑️ {t.delete}</Text>
            <Text style={p.sub}>{t.deleteReelConfirm.replace("{name}", confirmarBorrar?.titulo ?? "")}</Text>
            <View style={p.btns}>
              <TouchableOpacity style={p.cancel} onPress={() => setConfirmarBorrar(null)}>
                <Text style={{ color: "#94A3B8", fontWeight: "700" }}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={p.del} onPress={() => confirmarBorrar && handleDelete(confirmarBorrar)}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>{t.delete}</Text>
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
    safe: { flex: 1, backgroundColor: "#000" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, backgroundColor: "#000", borderBottomWidth: 0 },
    back: { color: "#fff", fontSize: 14, minWidth: 60 },
    title: { color: "#fff", fontSize: 17, fontWeight: "700", textAlign: "center", flex: 1 },
    steps: { flexDirection: "row", alignItems: "center", paddingHorizontal: 32, paddingVertical: 12, gap: 0 },
    step: { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
    stepDone: { backgroundColor: "#1F6FEB22", borderColor: "#1F6FEB" },
    stepLine: { width: 20, height: 2, backgroundColor: colors.cardBorder },
    stepTxt: { color: colors.text, fontSize: 12, fontWeight: "700" },
    scroll: { flex: 1, paddingHorizontal: 16, backgroundColor: "#000" },
    recetaCard: { backgroundColor: "#111111", borderWidth: 0, borderRadius: 16, padding: 18, marginBottom: 10, flexDirection: "row", alignItems: "center" },
    recetaNombre: { color: "#fff", fontSize: 16, fontWeight: "700", flex: 1 },
    recetaDesc: { color: "#ffffff60", fontSize: 12, flex: 1, marginTop: 2 },
    recetaFlecha: { color: "#ffffff40", fontSize: 18, fontWeight: "300" },
    nuevaBtn: { borderWidth: 1, borderColor: "#ffffff20", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 4 },
    nuevaBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
    nuevaBox: { backgroundColor: "#111", borderRadius: 14, padding: 16, marginTop: 8 },
    nuevaLabel: { color: "#ffffff80", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
    emptyBox: { alignItems: "center", paddingVertical: 40, gap: 8 },
    emptyIcon: { fontSize: 52 },
    emptyTxt: { color: "#fff", fontSize: 18, fontWeight: "700" },
    emptyHint: { color: "#ffffff60", fontSize: 13, textAlign: "center" },
    picker: { backgroundColor: "#111", borderWidth: 2, borderColor: "#ffffff15", borderStyle: "dashed" as const, borderRadius: 16, height: 200, justifyContent: "center", alignItems: "center", gap: 10 },
    pickerIcon: { fontSize: 52 },
    pickerTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
    pickerHint: { color: "#ffffff60", fontSize: 12 },
    previewWrap: { borderRadius: 20, overflow: "hidden", backgroundColor: "#000", marginBottom: 4 },
    changeBtn: { backgroundColor: "#EF444422", borderWidth: 1, borderColor: "#EF4444", borderRadius: 10, padding: 12, alignItems: "center", margin: 10 },
    changeBtnTxt: { color: "#EF4444", fontWeight: "700", fontSize: 13 },
    input: { backgroundColor: "#111", borderWidth: 0, borderRadius: 16, padding: 16, color: "#fff", fontSize: 15 },
    progWrap: { backgroundColor: "#ffffff15", borderRadius: 99, height: 6, marginBottom: 16, overflow: "hidden" },
    progBar: { backgroundColor: "#1F6FEB", height: 6 },
    progTxt: { color: "#ffffff60", fontSize: 11, textAlign: "center", marginBottom: 4 },
    publishBtn: { backgroundColor: "#EF4444", borderRadius: 20, padding: 20, alignItems: "center", marginTop: 14 },
    publishTxt: { color: "#fff", fontSize: 17, fontWeight: "800" },
    cancelBtn: { flex: 1, backgroundColor: "#ffffff15", borderRadius: 10, padding: 12, alignItems: "center" },
    cancelTxt: { color: "#fff", fontWeight: "700" },
    nextBtn: { backgroundColor: "#1F6FEB", borderRadius: 16, flex: 1, padding: 16, alignItems: "center" },
    nextBtnTxt: { color: "#fff", fontWeight: "700" },
    btnDis: { opacity: 0.4 },
  });
}
