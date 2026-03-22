/**
 * scanner.web.tsx — Escáner de códigos de barras para web (Vercel).
 *
 * Estrategia de escaneo automático (en orden de prioridad):
 *  1. BarcodeDetector API  — nativo en Chrome/Edge (más rápido)
 *  2. ZXing via CDN        — funciona en Firefox, Safari, etc.
 *  3. Solo entrada manual  — fallback universal
 *
 * Siempre muestra un campo de texto para introducir el código manualmente.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { useApp } from "./services/i18n";

/* ── Carga dinámica de ZXing desde CDN ─────────────────────────────────────── */
function loadZXing(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).ZXing) { resolve((window as any).ZXing); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/zxing-library.min.js";
    s.onload  = () => resolve((window as any).ZXing);
    s.onerror = () => reject(new Error("No se pudo cargar ZXing"));
    document.head.appendChild(s);
  });
}

/* ── Componente ────────────────────────────────────────────────────────────── */
export default function ScannerScreen() {
  const { colors, theme } = useApp();
  const router = useRouter();
  const { forReceta, forCreateFood } = useLocalSearchParams<{
    forReceta?: string; forCreateFood?: string;
  }>();

  /* refs DOM */
  const containerRef   = useRef<any>(null);
  const videoRef       = useRef<HTMLVideoElement | null>(null);
  const canvasRef      = useRef<HTMLCanvasElement | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const zxingCtrlRef   = useRef<any>(null);   // controls devueltos por ZXing
  const scannedRef     = useRef(false);

  /* estado UI */
  const [status, setStatus]       = useState<"loading" | "ready" | "error">("loading");
  const [scanMode, setScanMode]   = useState<"native" | "zxing" | "manual">("native");
  const [manualCode, setManualCode] = useState("");
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);

  /* ── Navegación con el código ── */
  const handleCode = (code: string) => {
    if (scannedRef.current) return;
    scannedRef.current = true;

    streamRef.current?.getTracks().forEach(t => t.stop());
    if (intervalRef.current)  clearInterval(intervalRef.current);
    if (zxingCtrlRef.current) zxingCtrlRef.current.stop();

    if (forCreateFood === "1") {
      router.replace({ pathname: "/create-food", params: { scannedCode: code } });
    } else if (forReceta === "1") {
      router.replace({ pathname: "/recetas", params: { scannedCode: code, scannedForReceta: "1" } });
    } else {
      router.replace({ pathname: "/add-food", params: { code } });
    }
  };

  /* ── Inicialización ── */
  useEffect(() => {
    /* Crear elementos video y canvas en el DOM */
    const video  = document.createElement("video");
    const canvas = document.createElement("canvas");
    video.setAttribute("autoplay", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;";
    canvas.style.display = "none";
    videoRef.current  = video;
    canvasRef.current = canvas;
    document.body.appendChild(canvas);

    /* Insertar video en el contenedor RN una vez montado */
    const attach = () => {
      const node = containerRef.current;
      if (node) { node.appendChild(video); init(video, canvas); }
      else setTimeout(attach, 50);
    };
    attach();

    return () => {
      scannedRef.current = true; // evita handleCode tras desmontaje
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (intervalRef.current)  clearInterval(intervalRef.current);
      if (zxingCtrlRef.current) try { zxingCtrlRef.current.stop(); } catch {}
      if (video.parentNode)  video.parentNode.removeChild(video);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    /* 1. Solicitar cámara */
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      });
      streamRef.current = stream;
      video.srcObject   = stream;
      await video.play();
    } catch (e: any) {
      const denied = e?.name === "NotAllowedError";
      setErrorMsg(denied ? "Permiso de cámara denegado." : "No se pudo abrir la cámara.");
      setStatus("error");
      return;
    }

    /* 2a. Intentar BarcodeDetector nativo (Chrome/Edge) */
    if (typeof (window as any).BarcodeDetector !== "undefined") {
      try {
        const detector = new (window as any).BarcodeDetector({
          formats: ["ean_13", "ean_8", "qr_code", "code_128", "upc_a", "upc_e", "code_39"],
        });
        setScanMode("native");
        setStatus("ready");
        intervalRef.current = setInterval(async () => {
          if (scannedRef.current || video.readyState < 2) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(video, 0, 0);
          try {
            const codes = await detector.detect(canvas);
            if (codes.length > 0) handleCode(codes[0].rawValue);
          } catch {}
        }, 350);
        return;
      } catch {}
    }

    /* 2b. Fallback: ZXing via CDN (Firefox, Safari, etc.) */
    try {
      setScanMode("zxing");
      setStatus("loading");
      const ZXing = await loadZXing();
      const reader = new ZXing.BrowserMultiFormatReader();
      setStatus("ready");
      /* decodeFromVideoElement lanza su propio bucle interno */
      const controls = reader.decodeFromVideoElement(
        video,
        (result: any) => { if (result) handleCode(result.getText()); },
      );
      zxingCtrlRef.current = controls;
      return;
    } catch {}

    /* 2c. Sin escaneo automático — solo manual */
    setScanMode("manual");
    setStatus("ready");
  }

  const modeLabel =
    status === "loading"   ? "Cargando escáner…" :
    scanMode === "native"  ? "Centra el código en el recuadro" :
    scanMode === "zxing"   ? "Centra el código en el recuadro" :
                             "Introduce el código manualmente";

  return (
    <View style={s.root}>
      {/* Contenedor de vídeo */}
      <View ref={containerRef} style={s.camera} />

      {/* Overlay con marco */}
      {status !== "error" && (
        <View pointerEvents="none" style={s.overlay}>
          {status === "loading" ? (
            <ActivityIndicator color="#1F6FEB" size="large" />
          ) : (
            <View style={s.frame}>
              <View style={[s.corner, s.tl]} />
              <View style={[s.corner, s.tr]} />
              <View style={[s.corner, s.bl]} />
              <View style={[s.corner, s.br]} />
            </View>
          )}
          <Text style={s.hint}>{modeLabel}</Text>
        </View>
      )}

      {/* Error cámara */}
      {status === "error" && errorMsg && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>⚠ {errorMsg}</Text>
        </View>
      )}

      {/* Botón volver */}
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
        <Text style={s.backText}>← Volver</Text>
      </TouchableOpacity>

      {/* Entrada manual — siempre visible */}
      <View style={[s.panel, { backgroundColor: theme === "dark" ? "#0D1117EE" : "#FFFFFFEE" }]}>
        <Text style={[s.panelTitle, { color: colors.text }]}>
          O introduce el código de barras:
        </Text>
        <View style={s.manualRow}>
          <TextInput
            style={[s.input, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder, color: colors.text }]}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="Ej: 8410076472620"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            returnKeyType="search"
            onSubmitEditing={() => manualCode.trim() && handleCode(manualCode.trim())}
          />
          <TouchableOpacity
            style={[s.btn, !manualCode.trim() && { opacity: 0.4 }]}
            onPress={() => manualCode.trim() && handleCode(manualCode.trim())}
            disabled={!manualCode.trim()}
          >
            <Text style={s.btnText}>Buscar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const C = 22;
const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: "#000" },
  camera:    { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  overlay:   { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, paddingBottom: 180 },
  frame:     { width: 270, height: 190, position: "relative" },
  corner:    { position: "absolute", width: C, height: C, borderColor: "#1F6FEB", borderRadius: 4 },
  tl:        { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr:        { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl:        { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br:        { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  hint:      { color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center", paddingHorizontal: 32 },
  errorBanner: { position: "absolute", top: 100, left: 16, right: 16, backgroundColor: "#EF444433", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EF444455" },
  errorText: { color: "#EF4444", fontSize: 13, fontWeight: "600", textAlign: "center" },
  backBtn:   { position: "absolute", top: 52, left: 16, backgroundColor: "#000000BB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  backText:  { color: "#fff", fontSize: 14, fontWeight: "700" },
  panel:     { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 36, gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  panelTitle:{ fontSize: 13, fontWeight: "700" },
  manualRow: { flexDirection: "row", gap: 8 },
  input:     { flex: 1, borderWidth: 1, borderRadius: 12, padding: 13, fontSize: 16 },
  btn:       { backgroundColor: "#1F6FEB", borderRadius: 12, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  btnText:   { color: "#fff", fontSize: 15, fontWeight: "700" },
});
