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
  ActivityIndicator, Alert, Animated, Dimensions, Image, Modal, PanResponder, Pressable,
  Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View, useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SW } = Dimensions.get("window");
const LIKED_KEY          = "nutri_liked_videos";
const LIKED_HASHTAGS_KEY = "nutri_liked_hashtags";
const DISMISSED_KEY      = "nutri_dismissed_reels";

// Cache de avatares: evita refetch en cada carga del feed, TTL de 5 min
const _avatarCache    = new Map<string, string>();
const _avatarCacheTTL = new Map<string, number>();
const AVATAR_TTL_MS   = 5 * 60 * 1000;

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
  autor_avatar?: string; cancion?: string; cancion_url?: string; cancion_start?: number;
  fotos?: string[]; language?: string;
  cancion_volumen?: number; mute_video?: boolean;
  comentarios?: number;
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
  // Boost de idioma: mismo idioma > inglés (universal) > sin datos > otro idioma
  const lang       = reel.language;
  const langBoost  = lang === userLang ? 0.15
    : (lang === "en" && userLang !== "en") ? 0.06
    : !lang ? 0.04   // reels sin detección (legacy) — no penalizar
    : 0;
  return recency * 0.40 + likesScore * 0.20 + engRate * 0.25 + viewsScore * 0.05 + personal + langBoost;
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

  const fetchMusic = async (term: string, limit = 25): Promise<SongResult[]> => {
    try {
      const res = await fetch(`/api/music?term=${encodeURIComponent(term)}&limit=${limit}`);
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
      const res = await fetch(`/api/music?cat=${encodeURIComponent(cat.cat)}&limit=25`);
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
function PhotoSlideshow({ fotos, active }: { fotos: string[]; active: boolean }) {
  const [current, setCurrent] = useState(0);
  const scrollRef = useRef<any>(null);
  const { width: SW } = useWindowDimensions();

  useEffect(() => {
    if (!active || fotos.length <= 1) return;
    const t = setInterval(() => {
      setCurrent(c => {
        const next = (c + 1) % fotos.length;
        scrollRef.current?.scrollTo?.({ x: next * SW, animated: true });
        return next;
      });
    }, 3500);
    return () => clearInterval(t);
  }, [active, fotos.length, SW]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <ScrollView ref={scrollRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={e => setCurrent(Math.round(e.nativeEvent.contentOffset.x / SW))}>
        {fotos.map((uri, i) => (
          <View key={i} style={{ width: SW, flex: 1 }}>
            {Platform.OS === "web"
              ? (React.createElement as any)("img", {
                  src: uri, style: { width: "100%", height: "100%", objectFit: "cover", display: "block" }
                })
              : <Image source={{ uri }} style={{ width: SW, flex: 1 }} resizeMode="cover" />
            }
          </View>
        ))}
      </ScrollView>
      {fotos.length > 1 && (
        <View style={{ position: "absolute", bottom: 12, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 }}>
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
function VideoPlayer({ url, active, filtro, camaraFrontal, cancionUrl, cancionStart, cancionVolumen, muteVideo, webMuted }: {
  url: string; active: boolean;
  filtro?: string; camaraFrontal?: boolean; cancionUrl?: string; cancionStart?: number;
  cancionVolumen?: number; muteVideo?: boolean; webMuted?: boolean;
}) {
  const filterCss = filtro ? (FILTERS.find(f => f.name === filtro)?.webCss ?? "") : "";
  const ref = useRef<any>(null);
  const fsRef = useRef<any>(null);
  const musicRef = useRef<any>(null);
  const [webFullscreen, setWebFullscreen] = useState(false);

  // ── Native refs ───────────────────────────────────────────────────────────
  const nativeVideoRef = useRef<any>(null);
  const nativeMusicRef = useRef<any>(null);

  // ── Limpieza al desmontar ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (musicRef.current) { musicRef.current.pause(); musicRef.current.src = ""; musicRef.current = null; }
    };
  }, []);

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
                { isLooping: true, volume: cancionVolumen ?? 1, positionMillis: (cancionStart ?? 0) * 1000 }
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

  // ── Web: Play / pause ─────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;

    if (active) {
      // Mute via ref (NOT via React prop — React tiene un bug conocido con el atributo muted)
      ref.current.muted = true; // muted primero para que el navegador permita autoplay
      ref.current.play?.().then(() => {
        // Una vez arrancado, aplicar preferencia del usuario
        if (ref.current) ref.current.muted = (webMuted !== false) || !!muteVideo;
      }).catch(() => {});

      // Música web
      if (cancionUrl && typeof window !== "undefined" && (window as any).Audio) {
        if (musicRef.current && musicRef.current._url !== cancionUrl) {
          musicRef.current.pause(); musicRef.current.src = ""; musicRef.current = null;
        }
        if (!musicRef.current) {
          const audio = new (window as any).Audio(cancionUrl);
          audio._url = cancionUrl;
          audio.loop = true;
          audio.muted = webMuted;
          audio.volume = cancionVolumen ?? 1;
          if (cancionStart && cancionStart > 0) audio.currentTime = cancionStart;
          musicRef.current = audio;
          audio.play?.().catch(() => {});
        } else if (musicRef.current.paused) {
          musicRef.current.muted = webMuted;
          musicRef.current.volume = cancionVolumen ?? 1;
          musicRef.current.play?.().catch(() => {});
        } else {
          musicRef.current.muted = webMuted;
        }
      }
    } else {
      ref.current.pause?.();
      ref.current.currentTime = 0;
      if (musicRef.current) { musicRef.current.pause(); }
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Web: sincronizar mute cuando el usuario lo cambia ────────────────────
  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;
    if (ref.current) ref.current.muted = webMuted || !!muteVideo;
    if (musicRef.current) musicRef.current.muted = webMuted;
  }, [webMuted]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <Video
        ref={nativeVideoRef}
        source={{ uri: url }}
        style={{ flex: 1 }}
        resizeMode={ResizeMode.COVER}
        isLooping
        isMuted={!!muteVideo}
        shouldPlay={active}
      />
    );
  }

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
    </View>
  );
}

const vid = StyleSheet.create({
  controls: { position: "absolute", top: 52, right: 10, gap: 8 },
  btn: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 22, width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  btnTxt: { fontSize: 17 },
});

// ─── Tarjeta de reel — estilo TikTok ──────────────────────────────────────────
function ReelItem({ reel, active, liked, onLike, seguido, onFollow, esMio, onDelete, onDismiss, onComentarios, onGuardar, isGuardado, onAnadirAlDia }: {
  reel: Reel; active: boolean;
  liked: boolean; onLike: () => void; seguido: boolean; onFollow: () => void;
  esMio: boolean; onDelete: () => void;
  onDismiss: () => void; onComentarios: () => void;
  onGuardar: () => void; isGuardado: boolean; onAnadirAlDia: () => void;
}) {
  const { t } = useApp();
  const { width: SW, height: SH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [showDesc, setShowDesc] = useState(false);
  const [macros, setMacros] = useState<{ kcal: number; prot: number } | null>(null);
  const [webMuted, setWebMuted] = useState(true);

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

  return (
    <View style={{ width: SW, height: SH, backgroundColor: "#000" }}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowDesc(v => !v)}>
        {reel.fotos && reel.fotos.length > 0
          ? <PhotoSlideshow fotos={reel.fotos} active={active} />
          : <VideoPlayer url={reel.video_url} active={active}
              filtro={reel.filtro} camaraFrontal={reel.camara_frontal || reel.hashtags?.includes("__cf__")}
              cancionUrl={reel.cancion_url} cancionStart={reel.cancion_start ?? 0}
              cancionVolumen={reel.cancion_volumen ?? 1} muteVideo={!!reel.mute_video}
              webMuted={webMuted} />
        }
      </TouchableOpacity>

      {/* Gradiente inferior fuerte */}
      <View pointerEvents="none"
        style={[r.shadow, { background: "linear-gradient(to top,rgba(0,0,0,0.94) 0%,rgba(0,0,0,0.6) 40%,transparent 100%)" } as any]} />

      {/* Botón mute (solo web) */}
      {Platform.OS === "web" && (
        <TouchableOpacity
          onPress={() => setWebMuted(v => !v)}
          style={{ position: "absolute", top: insets.top + 10, right: 12, zIndex: 30,
            backgroundColor: webMuted ? "rgba(0,0,0,0.55)" : "rgba(30,180,70,0.75)",
            borderRadius: 22, width: 42, height: 42, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 20 }}>{webMuted ? "🔇" : "🔊"}</Text>
        </TouchableOpacity>
      )}

      {/* No me interesa */}
      <View style={{ position: "absolute", top: insets.top + 8, left: 12 }} pointerEvents="box-none">
        <TouchableOpacity
          onPress={onDismiss}
          style={{ backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>✕ No me interesa</Text>
        </TouchableOpacity>
      </View>

      {/* Info bottom-left */}
      <View style={[r.info, { bottom: bottomBase + 10 }]} pointerEvents="none">
        <Text style={r.autor}>@{reel.autor}</Text>
        <Text style={r.titulo}>🍽 {reel.titulo}</Text>
        {macros && (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
            <View style={{ backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 4 }}>
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

      {/* Columna de acciones derecha */}
      <View style={[r.actions, { bottom: bottomBase }]}>

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

        {/* Like con animación */}
        <TouchableOpacity style={r.actionBtn} onPress={handleLike}>
          <Animated.Text style={[r.actionIcon, { transform: [{ scale: likeScale }] }]}>
            {liked ? "❤️" : "🤍"}
          </Animated.Text>
          <Text style={r.actionLbl}>{fmtCount(reel.likes)}</Text>
        </TouchableOpacity>

        {/* Comentarios */}
        <TouchableOpacity style={r.actionBtn} onPress={onComentarios}>
          <View style={r.actionCircle}>
            <Text style={{ fontSize: 20 }}>💬</Text>
          </View>
          <Text style={r.actionLbl}>{reel.comentarios ? fmtCount(reel.comentarios) : "0"}</Text>
        </TouchableOpacity>

        {/* Guardar video (solo reels ajenos) */}
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
          <View style={r.actionCircle}>
            <Text style={{ fontSize: 20 }}>➕</Text>
          </View>
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

        {/* Disco de música giratorio */}
        <Animated.View style={[r.musicDisc, { transform: [{ rotate }] }]}>
          <Text style={{ fontSize: 16 }}>🎵</Text>
        </Animated.View>
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
};

function ComentariosModal({ visible, reel, userId, nombreUsuario, avatarUri, onClose }: {
  visible: boolean; reel: Reel | null;
  userId: string; nombreUsuario: string; avatarUri?: string | null;
  onClose: () => void;
}) {
  const { t } = useApp();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!visible || !reel) return;
    setCargando(true);
    supabase.from("comentarios_reels")
      .select("*").eq("reel_id", reel.id)
      .order("creado_en", { ascending: true }).limit(100)
      .then(({ data }) => {
        setComentarios((data ?? []) as Comentario[]);
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
    };
    const { data, error } = await supabase.from("comentarios_reels").insert([nuevo]).select().single();
    if (!error && data) setComentarios(prev => [...prev, data as Comentario]);
    setTexto("");
    setEnviando(false);
  };

  const eliminar = async (id: string) => {
    await supabase.from("comentarios_reels").delete().eq("id", id);
    setComentarios(prev => prev.filter(c => c.id !== id));
  };

  if (!reel) return null;

  const AVATAR_COLORS = ["#EF4444","#F97316","#EAB308","#22C55E","#3B82F6","#8B5CF6","#EC4899"];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
      <View style={{ backgroundColor: "#111827", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "65%", paddingBottom: 16 }}>
        {/* Handle */}
        <View style={{ alignItems: "center", paddingVertical: 12 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#374151" }} />
        </View>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800", textAlign: "center", marginBottom: 12 }}>
          💬 Comentarios
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
            {comentarios.map(c => {
              const letter = c.autor ? c.autor[0].toUpperCase() : "?";
              const color = AVATAR_COLORS[(c.autor?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
              return (
                <View key={c.id} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                  {c.autor_avatar
                    ? <Image source={{ uri: c.autor_avatar }} style={{ width: 34, height: 34, borderRadius: 17 }} />
                    : <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{letter}</Text>
                      </View>
                  }
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#60A5FA", fontWeight: "700", fontSize: 13 }}>@{c.autor}</Text>
                    <Text style={{ color: "#E2E8F0", fontSize: 14, marginTop: 2, lineHeight: 20 }}>{c.contenido}</Text>
                  </View>
                  {c.autor_id === userId && (
                    <TouchableOpacity onPress={() => eliminar(c.id)}>
                      <Text style={{ color: "#EF4444", fontSize: 13 }}>🗑</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
        {/* Input */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: "#1F2937" }}>
          <TextInput
            style={{ flex: 1, backgroundColor: "#1E2533", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: "#fff", fontSize: 14 }}
            placeholder="Escribe un comentario..."
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

// ─── Modal subir reel — 3 pasos: Receta → Cámara → Detalles ──────────────────
function ModalSubir({ visible, onClose, onSubido, nombreUsuario, userId, avatarUri, recetaPrevia }: {
  visible: boolean; onClose: () => void; onSubido: () => void;
  nombreUsuario: string; userId: string; avatarUri?: string | null; recetaPrevia?: string;
}) {
  const { colors, t, language } = useApp();
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
  // Ingredientes dentro de crear receta
  const [ingQuery, setIngQuery] = useState("");
  const [ingResultados, setIngResultados] = useState<any[]>([]);
  const [ingSeleccionado, setIngSeleccionado] = useState<any | null>(null);
  const [ingGramos, setIngGramos] = useState("100");
  const [ingredientes, setIngredientes] = useState<Array<{nombre:string;gramos:number;calorias:number;proteinas:number;grasas:number;carbohidratos:number}>>([]);

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

  // Cargar recetas al abrir: solo las del usuario, filtrando las ya publicadas en reels O comunidad
  useEffect(() => {
    if (!visible || !userId) return;
    (async () => {
      const [recetasRes, reelsRes] = await Promise.all([
        supabase.from("recetas").select("id,nombre,descripcion").eq("user_id", userId).order("creado_en", { ascending: false }).limit(200),
        supabase.from("videos_recetas").select("titulo").eq("autor_id", userId),
      ]);
      const yaEnReels = new Set((reelsRes.data ?? []).map((r: any) => r.titulo?.trim()));
      setRecetas(((recetasRes.data ?? []) as any[]).filter((r: any) => r.nombre && !yaEnReels.has(r.nombre.trim())) as RecetaItem[]);
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
    setStep("receta"); setRecetaElegida(""); setModoCrear(false);
    setNuevaNombre(""); setNuevaDesc(""); setNuevaKcal(""); setNuevaProt(""); setNuevaCarbos(""); setNuevaGrasas("");
    setIngQuery(""); setIngResultados([]); setIngSeleccionado(null); setIngGramos("100"); setIngredientes([]);
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
  };

  const cerrar = () => { limpiar(); onClose(); };
  const elegirReceta = (nombre: string) => { setRecetaElegida(nombre); setStep("camara"); };

  const guardarNuevaReceta = async () => {
    const nombre = nuevaNombre.trim();
    if (!nombre) return;
    setGuardandoReceta(true);
    // Si hay ingredientes, calcular macros desde ellos; si no, usar campos manuales
    const kcal = ingredientes.length > 0
      ? ingredientes.reduce((s, i) => s + i.calorias, 0)
      : parseFloat(nuevaKcal) || 0;
    const prot = ingredientes.length > 0
      ? ingredientes.reduce((s, i) => s + i.proteinas, 0)
      : parseFloat(nuevaProt) || 0;
    const grasas = ingredientes.length > 0
      ? ingredientes.reduce((s, i) => s + i.grasas, 0)
      : parseFloat(nuevaGrasas) || 0;
    const carbos = ingredientes.length > 0
      ? ingredientes.reduce((s, i) => s + i.carbohidratos, 0)
      : parseFloat(nuevaCarbos) || 0;
    await crearReceta({
      nombre, descripcion: nuevaDesc.trim(),
      ingredientes: ingredientes.map(i => ({ nombre: i.nombre, gramos: i.gramos,
        calorias: i.calorias, proteinas: i.proteinas, grasas: i.grasas, carbs: i.carbohidratos })),
      calorias_total: kcal, proteinas_total: prot, grasas_total: grasas, carbohidratos_total: carbos,
    });
    setGuardandoReceta(false);
    elegirReceta(nombre);
  };

  const buscarIng = async (q: string) => {
    setIngQuery(q);
    setIngSeleccionado(null);
    if (!q.trim()) { setIngResultados([]); return; }
    const lower = q.toLowerCase();
    const local = ALIMENTOS_BASICOS.filter(a => a.nombre.toLowerCase().includes(lower)).slice(0, 6);
    try {
      const { data } = await supabase.from("alimentos")
        .select("nombre,calorias,proteinas,grasas,carbohidratos")
        .ilike("nombre", `%${q.trim()}%`).limit(6);
      const remoto = (data ?? []).map((d: any) => ({
        nombre: d.nombre, calorias: d.calorias ?? 0,
        proteinas: d.proteinas ?? 0, grasas: d.grasas ?? 0, carbohidratos: d.carbohidratos ?? 0,
      }));
      const nombres = new Set(local.map(x => x.nombre.toLowerCase()));
      setIngResultados([...local, ...remoto.filter((r: any) => !nombres.has(r.nombre.toLowerCase()))].slice(0, 8));
    } catch {
      setIngResultados(local);
    }
  };

  const agregarIng = () => {
    if (!ingSeleccionado) return;
    const g = parseFloat(ingGramos) || 100;
    const factor = g / 100;
    setIngredientes(prev => [...prev, {
      nombre: ingSeleccionado.nombre, gramos: g,
      calorias:     Math.round(ingSeleccionado.calorias     * factor),
      proteinas:    Math.round(ingSeleccionado.proteinas    * factor * 10) / 10,
      grasas:       Math.round(ingSeleccionado.grasas       * factor * 10) / 10,
      carbohidratos:Math.round(ingSeleccionado.carbohidratos* factor * 10) / 10,
    }]);
    setIngQuery(""); setIngResultados([]); setIngSeleccionado(null); setIngGramos("100");
  };

  // ── Acciones cámara ───────────────────────────────────────────────────────
  const startRecording = async () => {
    if (!cameraRef.current || recording) return;
    setDuration(0); setRecording(true);
    recordStartRef.current = Date.now();
    durTimerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    try {
      const video = await (cameraRef.current as any).recordAsync({ maxDuration: 120 });
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

  const fmtDur = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const fmtSec2 = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const curFilter = FILTERS.find(f => f.name === selectedFilter) ?? FILTERS[0];

  // ── Preview: reproduce el vídeo con la música superpuesta ─────────────────
  const stopPreview = () => {
    if (previewMusicRef.current) {
      previewMusicRef.current.pause();
      previewMusicRef.current.src = "";
      previewMusicRef.current = null;
    }
    if (detailVideoRef.current) {
      detailVideoRef.current.loop = true;
      detailVideoRef.current.muted = true;
      detailVideoRef.current.currentTime = 0;
      detailVideoRef.current.onended = null;
      detailVideoRef.current.play?.().catch(() => {});
    }
    setPreviewing(false);
  };

  const startPreview = () => {
    if (previewing) { stopPreview(); return; }
    if (detailVideoRef.current) {
      detailVideoRef.current.loop = false;
      detailVideoRef.current.muted = muteVideo;
      detailVideoRef.current.currentTime = 0;
      detailVideoRef.current.onended = stopPreview;
      detailVideoRef.current.play?.().catch(() => {});
    }
    if (selectedSong && typeof window !== "undefined" && (window as any).Audio) {
      const audio = new (window as any).Audio(selectedSong.url);
      audio.currentTime = selectedSong.startTime ?? 0;
      audio.volume = musicVolume;
      audio.loop = false;
      audio.play?.().catch(() => {});
      previewMusicRef.current = audio;
    }
    setPreviewing(true);
  };

  const subir = async () => {
    if (!videoFile && selectedFotos.length === 0) { Alert.alert(t.noContent, t.recordVideoOrAddPhotos); return; }
    if (!recetaElegida.trim()) { Alert.alert(t.noRecipeSelected, t.goBackAndChooseRecipe); return; }
    if (!userId) { Alert.alert(t.sessionExpired, t.closeAndReopen); return; }
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
      if (videoFile) {
        const mimeType: string = videoFile.type ?? "video/mp4";
        const rawName = videoFile.isNative ? (videoFile.uri.split("/").pop() ?? "reel.mp4") : (videoFile.name ?? "reel.mp4");
        const ext = (rawName.split(".").pop() ?? "mp4").split("?")[0].toLowerCase();
        const path = `${userId}/${Date.now()}.${ext}`;
        setProgreso(15);

        let uploadData: Blob;
        if (videoFile.isNative) {
          const r = await fetch(videoFile.uri);
          uploadData = await r.blob();
        } else {
          uploadData = videoFile as Blob;
        }
        setProgreso(30);

        // Upload con timeout de 60s para evitar que se quede colgado
        const uploadPromise = supabase.storage
          .from("videos").upload(path, uploadData, { contentType: mimeType, upsert: false });
        const timeoutPromise = new Promise<{ error: { message: string } }>(resolve =>
          setTimeout(() => resolve({ error: { message: "Timeout: el vídeo tardó demasiado en subirse. Prueba con un vídeo más corto." } }), 60000)
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
      if (selectedFotos.length > 0) {
        for (let i = 0; i < selectedFotos.length; i++) {
          const foto = selectedFotos[i];
          try {
            let uploadBlob: Blob;
            let contentType: string;
            if (foto.file) {
              uploadBlob = foto.file as Blob;
              contentType = foto.file.type || "image/jpeg";
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
          setProgreso(50 + Math.round((i + 1) / selectedFotos.length * 30));
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
      // Intentar con todas las columnas opcionales
      const rowCompleto = {
        ...base, views: 0, hashtags,
        filtro: selectedFilter !== "Normal" ? selectedFilter : null,
        camara_frontal: flipH,
        cancion: selectedSong?.name ?? null,
        cancion_url: selectedSong?.url ?? null,
        cancion_start: selectedSong?.startTime ?? 0,
        fotos: fotosUrls.length > 0 ? fotosUrls : null,
      };
      let { error: dbErr } = await supabase.from("videos_recetas").insert([rowCompleto]);

      // Si falla (400 por columna inexistente u otro error), reintentar solo con columnas garantizadas
      if (dbErr) {
        const rowBase = {
          autor: base.autor, autor_id: base.autor_id,
          titulo: base.titulo, descripcion: base.descripcion,
          video_url: publicUrl || "", likes: 0, language,
          hashtags, views: 0,
          filtro: selectedFilter !== "Normal" ? selectedFilter : null,
          camara_frontal: flipH,
          cancion: selectedSong?.name ?? null,
          cancion_url: selectedSong?.url ?? null,
          fotos: fotosUrls.length > 0 ? fotosUrls : null,
        };
        const retry = await supabase.from("videos_recetas").insert([rowBase]);
        dbErr = retry.error;
      }

      setSubiendo(false);
      if (dbErr) {
        Alert.alert("Error al guardar en BD", `${dbErr.message}\nCódigo: ${(dbErr as any).code}`);
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
            <TouchableOpacity onPress={modoCrear ? () => setModoCrear(false) : cerrar}
              style={{ backgroundColor: "#ffffff15", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={m.back}>{modoCrear ? `← ${t.recipes}` : t.close}</Text>
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
            {!modoCrear ? (
              <>
                {recetas.map(rec => (
                  <TouchableOpacity key={rec.id} style={m.recetaCard} onPress={() => elegirReceta(rec.nombre)}>
                    {/* Left icon circle with first letter */}
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
                <TouchableOpacity style={m.nuevaBtn} onPress={() => setModoCrear(true)}>
                  <Text style={m.nuevaBtnTxt}>+ {t.newRecipe}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={m.nuevaBox}>
                <Text style={m.nuevaLabel}>{t.recipeName} *</Text>
                <TextInput style={m.input} value={nuevaNombre} onChangeText={setNuevaNombre}
                  placeholder={t.recipeNamePlaceholder} placeholderTextColor="#ffffff40" autoFocus maxLength={80} />
                <Text style={[m.nuevaLabel, { marginTop: 12 }]}>{t.descriptionOptional}</Text>
                <TextInput style={[m.input, { height: 70 }]} value={nuevaDesc} onChangeText={setNuevaDesc}
                  placeholder={t.recipeStepsPlaceholder} placeholderTextColor="#ffffff40" multiline numberOfLines={3} maxLength={200} />

                {/* ── Buscador de ingredientes ── */}
                <Text style={[m.nuevaLabel, { marginTop: 14 }]}>{t.addIngredientsOptional}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <TextInput
                    style={[m.input, { flex: 1, marginBottom: 0 }]}
                    value={ingQuery} onChangeText={buscarIng}
                    placeholder={t.searchFood} placeholderTextColor="#ffffff40"
                    autoCorrect={false} autoCapitalize="none"
                  />
                </View>
                {/* Resultados */}
                {ingResultados.length > 0 && !ingSeleccionado && (
                  <View style={{ backgroundColor: "#0A0F1A", borderRadius: 10, marginBottom: 8,
                    borderWidth: 1, borderColor: "#1E2533", overflow: "hidden" }}>
                    {ingResultados.map((ali, idx) => (
                      <TouchableOpacity key={idx} onPress={() => { setIngSeleccionado(ali); setIngQuery(ali.nombre); setIngResultados([]); }}
                        style={{ paddingHorizontal: 12, paddingVertical: 9,
                          borderBottomWidth: idx < ingResultados.length - 1 ? 1 : 0,
                          borderBottomColor: "#1E2533" }}>
                        <Text style={{ color: "#fff", fontSize: 13 }}>{ali.nombre}</Text>
                        <Text style={{ color: "#94A3B8", fontSize: 11 }}>
                          {ali.calorias} kcal · {ali.proteinas}g P · {ali.carbohidratos}g C · {ali.grasas}g G (por 100g)
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {/* Gramos + añadir */}
                {ingSeleccionado && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <View style={{ flex: 1, backgroundColor: "#0A0F1A", borderRadius: 10, padding: 8,
                      borderWidth: 1, borderColor: "#1F6FEB44" }}>
                      <Text style={{ color: "#60A5FA", fontSize: 11, fontWeight: "700" }}>{ingSeleccionado.nombre}</Text>
                    </View>
                    <TextInput
                      style={[m.input, { width: 68, marginBottom: 0, textAlign: "center", paddingVertical: 8 }]}
                      value={ingGramos} onChangeText={setIngGramos}
                      keyboardType="decimal-pad" placeholder="g" placeholderTextColor="#ffffff40"
                    />
                    <Text style={{ color: "#94A3B8", fontSize: 12 }}>g</Text>
                    <TouchableOpacity onPress={agregarIng}
                      style={{ backgroundColor: "#1F6FEB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{t.addFood}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {/* Lista de ingredientes añadidos */}
                {ingredientes.length > 0 && (
                  <View style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700" }}>{t.ingredientsAdded}</Text>
                      <Text style={{ color: "#4ADE80", fontSize: 11, fontWeight: "700" }}>
                        {ingredientes.reduce((s,i)=>s+i.calorias,0)} kcal total
                      </Text>
                    </View>
                    {ingredientes.map((ing, idx) => (
                      <View key={idx} style={{ flexDirection: "row", alignItems: "center",
                        backgroundColor: "#0A0F1A", borderRadius: 9, paddingHorizontal: 10,
                        paddingVertical: 7, marginBottom: 4, borderWidth: 1, borderColor: "#1E2533" }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{ing.nombre}</Text>
                          <Text style={{ color: "#64748B", fontSize: 10 }}>
                            {ing.gramos}g · {ing.calorias} kcal · {ing.proteinas}g P
                          </Text>
                        </View>
                        <TouchableOpacity onPress={() => setIngredientes(p => p.filter((_,i)=>i!==idx))}>
                          <Text style={{ color: "#EF4444", fontSize: 16, paddingHorizontal: 4 }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {/* Macros manuales (solo si no hay ingredientes) */}
                {ingredientes.length === 0 && (
                  <>
                    <Text style={[m.nuevaLabel, { marginTop: 4 }]}>{t.manualMacros}</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                      {[{label:"kcal",val:nuevaKcal,set:setNuevaKcal,color:"#4ADE80"},{label:`${t.proteins} g`,val:nuevaProt,set:setNuevaProt,color:"#60A5FA"},{label:`${t.carbs} g`,val:nuevaCarbos,set:setNuevaCarbos,color:"#FBBF24"},{label:`${t.fats} g`,val:nuevaGrasas,set:setNuevaGrasas,color:"#F87171"}].map(f => (
                        <View key={f.label} style={{ flex: 1 }}>
                          <Text style={{ color: f.color, fontSize: 10, fontWeight: "700", marginBottom: 3 }}>{f.label}</Text>
                          <TextInput style={[m.input, { paddingVertical: 8, textAlign: "center" }]} value={f.val} onChangeText={f.set}
                            placeholder="0" placeholderTextColor="#ffffff40" keyboardType="decimal-pad" maxLength={6} />
                        </View>
                      ))}
                    </View>
                  </>
                )}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <TouchableOpacity style={m.cancelBtn} onPress={() => setModoCrear(false)}>
                    <Text style={m.cancelTxt}>{t.cancel}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[m.nextBtn, (!nuevaNombre.trim() || guardandoReceta) && m.btnDis]}
                    onPress={guardarNuevaReceta} disabled={!nuevaNombre.trim() || guardandoReceta}>
                    {guardandoReceta ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.nextBtnTxt}>{t.saveAndContinue}</Text>}
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
                  <Text style={[m.back, { color: "#58A6FF" }]}>← {t.recipeLabel}</Text>
                </TouchableOpacity>
                <Text style={[m.title, { color: "#fff" }]}>🎬 {t.recordVideo}</Text>
                <View style={{ width: 60 }} />
              </View>
              <View style={m.steps}>
                {([t.recipeLabel, t.videoLabel, t.details]).map((lbl, i) => (
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
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>{t.recordVideo}</Text>
                  <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center" }}>{t.openCameraDirectly}</Text>
                </TouchableOpacity>

                {/* Separador */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: "#ffffff22" }} />
                  <Text style={{ color: "#64748B", fontSize: 12 }}>o</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: "#ffffff22" }} />
                </View>

                {/* Galería de vídeo */}
                <TouchableOpacity
                  style={{ backgroundColor: "#1E293B", borderRadius: 20, padding: 16, alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#334155" }}
                  onPress={pickGallery}>
                  <Text style={{ fontSize: 32 }}>🖼️</Text>
                  <Text style={{ color: "#CBD5E1", fontSize: 14, fontWeight: "700" }}>{t.uploadFromGallery}</Text>
                  <Text style={{ color: "#64748B", fontSize: 12 }}>MP4 · MOV · WebM · hasta 500 MB</Text>
                </TouchableOpacity>

                {/* Separador */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: "#ffffff22" }} />
                  <Text style={{ color: "#64748B", fontSize: 12 }}>o</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: "#ffffff22" }} />
                </View>

                {/* Fotos */}
                <TouchableOpacity
                  style={{ backgroundColor: "#1E293B", borderRadius: 20, padding: 16, alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#334155" }}
                  onPress={() => pickFotos(() => setStep("detalles"))}>
                  <Text style={{ fontSize: 32 }}>📸</Text>
                  <Text style={{ color: "#CBD5E1", fontSize: 14, fontWeight: "700" }}>{t.uploadPhotos}</Text>
                  <Text style={{ color: "#64748B", fontSize: 12 }}>{t.photoCarouselHint}</Text>
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
                <Text style={{ color: "#fff", fontWeight: "700" }}>{t.grantPermissions}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep("receta")}>
                <Text style={{ color: "#94A3B8", marginTop: 8 }}>{t.back}</Text>
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

                {/* Fotos (derecha abajo) */}
                <TouchableOpacity
                  style={{ width: 60, height: 60, borderRadius: 16, backgroundColor: "#0008", borderWidth: 2, borderColor: "#ffffff55", justifyContent: "center", alignItems: "center" }}
                  onPress={() => pickFotos(() => setStep("detalles"))} disabled={recording}>
                  <Text style={{ fontSize: 26 }}>📸</Text>
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

      {/* ══ PASO 3: DETALLES ════════════════════════════════════════════════ */}
      {step === "detalles" && (
        <SafeAreaView style={m.safe}>
          <View style={m.header}>
            <TouchableOpacity onPress={() => { setVideoFile(null); setWebPreview(null); setStep("camara"); }}
              style={{ backgroundColor: "#ffffff15", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={m.back}>{t.back}</Text>
            </TouchableOpacity>
            <Text style={m.title}>✏️ {t.details}</Text>
            <View style={{ width: 60 }} />
          </View>
          {/* All 3 circles filled */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 14, gap: 0 }}>
            {([t.recipeLabel, t.videoLabel, t.details]).map((lbl, i) => (
              <React.Fragment key={lbl}>
                {i > 0 && <View style={{ flex: 1, height: 1.5, backgroundColor: "#FFFFFF" }} />}
                <View style={{ alignItems: "center", gap: 4 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15,
                    backgroundColor: "#FFFFFF",
                    alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#000", fontSize: 13, fontWeight: "800" }}>{i + 1}</Text>
                  </View>
                  <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{lbl}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
          <ScrollView style={m.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Preview — fotos o vídeo */}
            {selectedFotos.length > 0 ? (
              <View style={{ borderRadius: 20, height: 220, overflow: "hidden", marginBottom: 12, backgroundColor: "#111" }}>
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                  style={{ flex: 1 }} contentContainerStyle={{ flexDirection: "row" }}>
                  {selectedFotos.map((f, i) => (
                    <View key={i} style={{ width: 165, height: 220, position: "relative" }}>
                      {Platform.OS === "web"
                        ? (React.createElement as any)("img", { src: f.uri,
                            style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } })
                        : <Image source={{ uri: f.uri }} style={{ width: 165, height: 220 }} resizeMode="cover" />
                      }
                    </View>
                  ))}
                </ScrollView>
                <View style={{ position: "absolute", bottom: 8, right: 10, backgroundColor: "#000000AA",
                  borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                    {selectedFotos.length} foto{selectedFotos.length > 1 ? "s" : ""}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={{ borderRadius: 20, overflow: "hidden", marginBottom: 6, position: "relative", backgroundColor: "#111" }}>
                {webPreview
                  ? (React.createElement as any)("video", {
                      ref: (el: any) => { detailVideoRef.current = el; },
                      src: webPreview,
                      style: { width: "100%", height: 220, objectFit: "cover", backgroundColor: "#000",
                        borderRadius: 20,
                        ...(curFilter.webCss ? { filter: curFilter.webCss } : {}) },
                      muted: !previewing || muteVideo,
                      loop: !previewing,
                      autoPlay: !previewing,
                      playsInline: true,
                    })
                  : <View style={{ height: 220, justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: "#111" }}>
                      <Text style={{ fontSize: 40 }}>🎬</Text>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{t.videoReady}</Text>
                    </View>
                }
                {/* Botón de preview (web + vídeo) */}
                {Platform.OS === "web" && webPreview && (
                  <TouchableOpacity
                    onPress={startPreview}
                    style={{ position: "absolute", bottom: 10, right: 10,
                      backgroundColor: previewing ? "#EF444488" : "#00000088",
                      borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 20 }}>{previewing ? "⏹" : "▶"}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {/* Info duración */}
            {videoDuration > 0 && (
              <Text style={{ color: "#475569", fontSize: 11, marginBottom: 10, textAlign: "center" }}>
                Duración del vídeo: {fmtSec2(videoDuration)}
              </Text>
            )}
            {/* Filter strip — pill chips */}
            <Text style={m.nuevaLabel}>{t.visualFilter}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 16 }}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
              {FILTERS.map(f => (
                <TouchableOpacity key={f.name}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                    backgroundColor: selectedFilter === f.name ? "#fff" : "#ffffff15",
                    borderWidth: 0 }}
                  onPress={() => setSelectedFilter(f.name)}>
                  <Text style={{ color: selectedFilter === f.name ? "#000" : "#fff", fontSize: 12, fontWeight: "700" }}>
                    {f.icon} {f.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={m.nuevaLabel}>{t.descriptionOptional}</Text>
            <TextInput style={[m.input, { height: 90, marginBottom: 14 }]}
              value={descripcion} onChangeText={setDescripcion}
              placeholder={t.recipeStepsPlaceholder}
              placeholderTextColor="#ffffff40" multiline numberOfLines={4} maxLength={300} />

            <Text style={m.nuevaLabel}>
              Hashtags <Text style={{ color: "#ffffff50", fontWeight: "400" }}>{t.optional}</Text>
            </Text>
            <TextInput style={[m.input, { marginBottom: 14 }]}
              value={hashtagsInput} onChangeText={setHashtagsInput}
              placeholder={t.hashtagsPlaceholder}
              placeholderTextColor="#ffffff40" maxLength={120}
              autoCapitalize="none" autoCorrect={false} />

            {/* ── Música estilo Instagram ─────────────────────────────────── */}
            <Text style={m.nuevaLabel}>{t.addMusic}</Text>
            {selectedSong ? (
              <View style={{ backgroundColor: "#1F6FEB22", borderRadius: 14, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "#1F6FEB55" }}>
                {/* Cabecera: nombre + quitar */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <Text style={{ fontSize: 22 }}>🎵</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#60A5FA", fontWeight: "800", fontSize: 13 }} numberOfLines={1}>{selectedSong.name}</Text>
                    <Text style={{ color: "#ffffff55", fontSize: 11 }}>
                      {videoDuration > 0 ? `Empieza en ${fmtSec2(selectedSong.startTime)} · dura ${fmtSec2(videoDuration)}` : "Canción seleccionada"}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedSong(null)}>
                    <View style={{ backgroundColor: "#EF444433", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "700" }}>✕ {t.remove}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
                {/* Volumen de la música */}
                <View style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700" }}>🎵 Volumen música</Text>
                    <Text style={{ color: "#60A5FA", fontSize: 11, fontWeight: "700" }}>{Math.round(musicVolume * 100)}%</Text>
                  </View>
                  {Platform.OS === "web" ? (
                    <input
                      type="range" min={0} max={100} step={1}
                      value={Math.round(musicVolume * 100)}
                      onChange={(e: any) => setMusicVolume(Number(e.target.value) / 100)}
                      style={{ width: "100%", accentColor: "#1F6FEB", height: 20, cursor: "pointer" }}
                    />
                  ) : (
                    <Pressable
                      onLayout={(e) => { volBarWidthRef.current = e.nativeEvent.layout.width; }}
                      onPress={(e) => {
                        if (!volBarWidthRef.current) return;
                        const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / volBarWidthRef.current));
                        setMusicVolume(Math.round(ratio * 100) / 100);
                      }}
                      style={{ paddingVertical: 10 }}
                    >
                      <View style={{ height: 5, backgroundColor: "#1E2533", borderRadius: 3 }}>
                        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                          width: `${musicVolume * 100}%` as any, backgroundColor: "#1F6FEB", borderRadius: 3 }} />
                        <View style={{ position: "absolute", left: `${musicVolume * 100}%` as any,
                          top: -5, width: 15, height: 15, borderRadius: 7.5,
                          backgroundColor: "#fff", marginLeft: -7.5, elevation: 3 }} />
                      </View>
                    </Pressable>
                  )}
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "#475569", fontSize: 10 }}>🔈</Text>
                    <Text style={{ color: "#475569", fontSize: 10 }}>🔊</Text>
                  </View>
                </View>
                {/* Silenciar audio del vídeo */}
                {videoFile && (
                  <TouchableOpacity
                    onPress={() => setMuteVideo(v => !v)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10,
                      backgroundColor: muteVideo ? "#ffffff12" : "transparent",
                      borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 18 }}>{muteVideo ? "🔇" : "🔊"}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
                        {muteVideo ? "Audio del vídeo silenciado" : "Audio del vídeo activo"}
                      </Text>
                      <Text style={{ color: "#64748B", fontSize: 11 }}>
                        {muteVideo ? "Solo se oirá la música" : "Toca para silenciar el vídeo y escuchar solo la música"}
                      </Text>
                    </View>
                    <View style={{ width: 38, height: 22, borderRadius: 11,
                      backgroundColor: muteVideo ? "#1F6FEB" : "#374151",
                      justifyContent: "center", paddingHorizontal: 3 }}>
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff",
                        alignSelf: muteVideo ? "flex-end" : "flex-start" }} />
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#111",
                  borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#ffffff15" }}
                onPress={() => setMusicPickerVisible(true)}>
                <Text style={{ fontSize: 24 }}>🎵</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>{t.chooseSong}</Text>
                  <Text style={{ color: "#64748B", fontSize: 12 }}>{t.musicGenres}</Text>
                </View>
                <Text style={{ color: "#60A5FA", fontSize: 20 }}>›</Text>
              </TouchableOpacity>
            )}

            {/* ── Fotos ────────────────────────────────────────────────────── */}
            <Text style={m.nuevaLabel}>📸 {t.photos}</Text>
            {selectedFotos.length > 0 ? (
              <View style={{ marginBottom: 14 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
                  {selectedFotos.map((f, i) => (
                    <View key={i} style={{ position: "relative" }}>
                      {Platform.OS === "web"
                        ? (React.createElement as any)("img", { src: f.uri,
                            style: { width: 80, height: 80, objectFit: "cover", borderRadius: 12 } })
                        : <Image source={{ uri: f.uri }} style={{ width: 80, height: 80, borderRadius: 12 }} />
                      }
                      <TouchableOpacity
                        style={{ position: "absolute", top: -6, right: -6, backgroundColor: "#EF4444",
                          width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" }}
                        onPress={() => setSelectedFotos(s => s.filter((_, j) => j !== i))}>
                        <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={{ width: 80, height: 80, borderRadius: 12, backgroundColor: "#111",
                      borderWidth: 1.5, borderColor: "#ffffff20", borderStyle: "dashed",
                      alignItems: "center", justifyContent: "center" }}
                    onPress={() => pickFotos()}>
                    <Text style={{ fontSize: 28 }}>＋</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            ) : (
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#111",
                  borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#ffffff15" }}
                onPress={() => pickFotos()}>
                <Text style={{ fontSize: 24 }}>📸</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>{t.addPhotos}</Text>
                  <Text style={{ color: "#64748B", fontSize: 12 }}>{t.slideshowHint}</Text>
                </View>
                <Text style={{ color: "#60A5FA", fontSize: 20 }}>›</Text>
              </TouchableOpacity>
            )}
            <View style={{ height: 8 }} />

            {subiendo && (
              <View style={m.progWrap}>
                <View style={[m.progBar, { width: `${progreso}%` as any }]} />
                <Text style={m.progTxt}>{t.uploading.replace("{n}", String(progreso))}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[m.publishBtn, (subiendo || (!videoFile && selectedFotos.length === 0) || !userId) && m.btnDis]}
              onPress={subir}
              disabled={subiendo || (!videoFile && selectedFotos.length === 0) || !userId}>
              {subiendo ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.publishTxt}>{t.publishReel}</Text>}
            </TouchableOpacity>
            <View style={{ height: 60 }} />
          </ScrollView>
        </SafeAreaView>
      )}

      <MusicPickerModal
        visible={musicPickerVisible}
        onClose={() => setMusicPickerVisible(false)}
        onSelect={song => setSelectedSong(song)}
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
  const viewedThisSession = useRef<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [modalComentarios, setModalComentarios] = useState<Reel | null>(null);
  const [sugeridosCreadores, setSugeridosCreadores] = useState<any[]>([]);
  const [savedVideoIds, setSavedVideoIds] = useState<Set<string>>(new Set());
  const [reelParaAnadir, setReelParaAnadir] = useState<{ reel: Reel; detalle: any } | null>(null);

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

  // View tracking: increment after 2s watching the same reel
  useEffect(() => {
    const currentList = tab === "parati" ? reels : siguiendoReels;
    const reel = currentList[activeIdx];
    if (!reel) return;
    const timer = setTimeout(() => {
      if (viewedThisSession.current.has(reel.id)) return;
      viewedThisSession.current.add(reel.id);
      supabase.rpc("increment_views", { row_id: reel.id });
      const upd = (list: Reel[]) => list.map(r => r.id === reel.id ? { ...r, views: (r.views ?? 0) + 1 } : r);
      setReels(upd); setSiguiendoReels(upd);
    }, 2000);
    return () => clearTimeout(timer);
  }, [activeIdx, tab]);

  useFocusEffect(useCallback(() => {
    // Reset scroll position on focus to avoid web reload desync
    setActiveIdx(0);
    setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 0);
    let mounted = true;
    cargarDatos(mounted);
    return () => { mounted = false; };
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

      const [liked, likedHTRaw, dismissedRaw, savedRaw] = await Promise.all([
        AsyncStorage.getItem(LIKED_KEY),
        AsyncStorage.getItem(LIKED_HASHTAGS_KEY),
        AsyncStorage.getItem(DISMISSED_KEY),
        AsyncStorage.getItem("nutri_recetas_guardadas"),
      ]);
      if (!mounted) return;
      setLikedIds(new Set(liked ? JSON.parse(liked) : []));
      setDismissedIds(new Set(dismissedRaw ? JSON.parse(dismissedRaw) : []));
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
        const { data } = await supabase.from("videos_recetas").select("*").order("creado_en", { ascending: false }).limit(20);
        if (!mounted) return;
        const raw = (data ?? []).filter((r: any) => r.titulo || r.video_url || (r.fotos?.length ?? 0) > 0) as Reel[];
        if (data && data.length < 20) setHasMore(false);
        else if (data && data.length > 0) cursorRef.current = data[data.length - 1].creado_en;
        const sorted = [...raw].sort((a, b) => scoreReel(b, likedHTSet, language) - scoreReel(a, likedHTSet, language));
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

  const handleDismiss = async (reel: Reel) => {
    const next = new Set([...dismissedIds, reel.id]);
    setDismissedIds(next);
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    setReels(prev => prev.filter(r => r.id !== reel.id));
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
    let lista2 = hashtagActivo ? lista.filter(r => r.hashtags?.includes(hashtagActivo)) : lista;
    return lista2.filter(r => !dismissedIds.has(r.id));
  }, [lista, hashtagActivo, dismissedIds]);

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
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          onScroll={e => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / SH);
            if (idx !== activeIdx) setActiveIdx(idx);
            // Load more when near end
            if (tab === "parati" && !loadingMore) {
              const totalHeight = e.nativeEvent.contentSize.height;
              const offset = e.nativeEvent.contentOffset.y;
              const viewHeight = e.nativeEvent.layoutMeasurement.height;
              if (totalHeight - offset - viewHeight < SH * 2) cargarMas();
            }
          }}
          scrollEventThrottle={100}
        >
          {listaFiltrada.map((reel, i) => (
            <ReelItem
              key={reel.id}
              reel={reel}
              active={i === activeIdx}
              liked={likedIds.has(reel.id)}
              onLike={() => handleLike(reel)}
              seguido={seguidosIds.has(reel.autor_id)}
              onFollow={() => handleFollow(reel)}
              esMio={reel.autor_id === userId}
              onDelete={() => setConfirmarBorrar(reel)}
              onDismiss={() => handleDismiss(reel)}
              onComentarios={() => setModalComentarios(reel)}
              onGuardar={() => handleGuardarVideo(reel)}
              isGuardado={savedVideoIds.has(reel.id)}
              onAnadirAlDia={() => handleAnadirAlDia(reel)}
            />
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
