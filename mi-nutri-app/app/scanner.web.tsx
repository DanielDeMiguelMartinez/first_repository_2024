/**
 * scanner.web.tsx — Escáner de códigos de barras para web (Vercel).
 * Expo Router carga este archivo automáticamente en web en lugar de scanner.tsx.
 *
 * • Usa getUserMedia() del navegador para acceder a la cámara.
 * • Usa BarcodeDetector API (Chrome/Edge) para el escaneo automático.
 * • Muestra siempre un campo de entrada manual como alternativa universal.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useApp } from "./services/i18n";

export default function ScannerScreen() {
  const { colors, theme } = useApp();
  const router = useRouter();
  const { forReceta, forCreateFood } = useLocalSearchParams<{
    forReceta?: string;
    forCreateFood?: string;
  }>();

  const containerRef = useRef<any>(null);
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scannedRef = useRef(false);

  const [cameraReady, setCameraReady] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");

  // Navega con el código escaneado o introducido
  const handleCode = (code: string) => {
    if (scannedRef.current) return;
    scannedRef.current = true;

    // Parar cámara
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (forCreateFood === "1") {
      router.replace({ pathname: "/create-food", params: { scannedCode: code } });
    } else if (forReceta === "1") {
      router.replace({ pathname: "/recetas", params: { scannedCode: code, scannedForReceta: "1" } });
    } else {
      router.replace({ pathname: "/add-food", params: { code } });
    }
  };

  useEffect(() => {
    const supported = typeof (window as any).BarcodeDetector !== "undefined";
    setAutoScan(supported);

    // Crear elementos de vídeo y canvas en el DOM
    const video = document.createElement("video");
    video.setAttribute("autoplay", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;";
    videoEl.current = video;

    const canvas = document.createElement("canvas");
    canvas.style.display = "none";
    canvasEl.current = canvas;
    document.body.appendChild(canvas);

    // Insertar vídeo en el contenedor React Native
    const tryInsert = () => {
      const node = containerRef.current;
      if (node) {
        node.appendChild(video);
        startCamera(video, canvas, supported);
      } else {
        setTimeout(tryInsert, 50);
      }
    };
    tryInsert();

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (video.parentNode) video.parentNode.removeChild(video);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    supported: boolean,
  ) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setCameraReady(true);

      if (!supported) return;

      const detector = new (window as any).BarcodeDetector({
        formats: ["ean_13", "ean_8", "qr_code", "code_128", "upc_a", "upc_e", "code_39"],
      });

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
        } catch { /* el frame pudo estar vacío */ }
      }, 350);
    } catch (e: any) {
      setError(
        e?.name === "NotAllowedError"
          ? "Permiso de cámara denegado. Usa el campo manual."
          : "No se pudo abrir la cámara. Usa el campo manual.",
      );
    }
  }

  return (
    <View style={styles.root}>
      {/* Contenedor de vídeo */}
      <View ref={containerRef} style={styles.camera} />

      {/* Marco de encuadre */}
      {cameraReady && (
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>
          <Text style={styles.hint}>
            {autoScan
              ? "Centra el código en el recuadro"
              : "Escaneo automático no disponible en este navegador"}
          </Text>
        </View>
      )}

      {/* Error de cámara */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠ {error}</Text>
        </View>
      )}

      {/* Botón volver */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>← Volver</Text>
      </TouchableOpacity>

      {/* Entrada manual — siempre visible */}
      <View style={[styles.manualPanel, { backgroundColor: theme === "dark" ? "#0D1117EE" : "#FFFFFFEE" }]}>
        <Text style={[styles.manualTitle, { color: colors.text }]}>
          📷 {cameraReady ? "O introduce el código" : "Introduce el código de barras"}
        </Text>
        <View style={styles.manualRow}>
          <TextInput
            style={[styles.manualInput, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder, color: colors.text }]}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="Ej: 8410076472620"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            returnKeyType="search"
            onSubmitEditing={() => manualCode.trim() && handleCode(manualCode.trim())}
          />
          <TouchableOpacity
            style={[styles.manualBtn, !manualCode.trim() && { opacity: 0.4 }]}
            onPress={() => manualCode.trim() && handleCode(manualCode.trim())}
            disabled={!manualCode.trim()}
          >
            <Text style={styles.manualBtnText}>Buscar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const CORNER = 22;
const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#000" },
  camera:     { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  overlay:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, paddingBottom: 180 },
  frame:      { width: 270, height: 190, position: "relative" },
  corner:     { position: "absolute", width: CORNER, height: CORNER, borderColor: "#1F6FEB", borderRadius: 4 },
  tl:         { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr:         { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl:         { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br:         { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  hint:       { color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center", paddingHorizontal: 32 },
  errorBanner:{ position: "absolute", top: 100, left: 16, right: 16, backgroundColor: "#EF444433", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EF444455" },
  errorText:  { color: "#EF4444", fontSize: 13, fontWeight: "600", textAlign: "center" },
  backBtn:    { position: "absolute", top: 52, left: 16, backgroundColor: "#000000BB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  backText:   { color: "#fff", fontSize: 14, fontWeight: "700" },
  manualPanel:{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 36, gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  manualTitle:{ fontSize: 13, fontWeight: "700" },
  manualRow:  { flexDirection: "row", gap: 8 },
  manualInput:{ flex: 1, borderWidth: 1, borderRadius: 12, padding: 13, fontSize: 16 },
  manualBtn:  { backgroundColor: "#1F6FEB", borderRadius: 12, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  manualBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
