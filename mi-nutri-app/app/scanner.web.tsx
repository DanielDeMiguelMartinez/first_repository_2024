/**
 * scanner.web.tsx — Escáner de códigos de barras para web (Vercel).
 *
 * Estrategia dual:
 *  1. BarcodeDetector nativo (Chrome/Edge/Android) — hardware-accelerated, ~60 fps
 *  2. html5-qrcode como fallback (Firefox, Safari, etc.)
 *
 * Formatos soportados: EAN-13, EAN-8, UPC-A, UPC-E, Code-128, Code-39, QR, Data Matrix.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const CONTAINER_ID = "mi-nutri-scanner-root";

const BARCODE_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e",
  "code_128", "code_39", "qr_code", "data_matrix", "itf",
];

// ── Estrategia 1: BarcodeDetector nativo ─────────────────────────────────────
async function startNativeDetector(
  videoEl: HTMLVideoElement,
  onCode: (code: string) => void,
  onReady: () => void,
  isMountedRef: React.MutableRefObject<boolean>
): Promise<() => void> {
  const BarcodeDetector = (window as any).BarcodeDetector;
  const supported = await BarcodeDetector.getSupportedFormats?.() ?? BARCODE_FORMATS;
  const formats = BARCODE_FORMATS.filter(f => supported.includes(f));
  const detector = new BarcodeDetector({ formats: formats.length ? formats : BARCODE_FORMATS });

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });

  videoEl.srcObject = stream;
  videoEl.setAttribute("playsinline", "true");
  await videoEl.play();
  onReady();

  let rafId: number;
  const scan = async () => {
    if (!isMountedRef.current) return;
    try {
      const results = await detector.detect(videoEl);
      if (results.length > 0) {
        onCode(results[0].rawValue);
        return; // stop loop after detection
      }
    } catch {}
    rafId = requestAnimationFrame(scan);
  };
  rafId = requestAnimationFrame(scan);

  return () => {
    cancelAnimationFrame(rafId);
    stream.getTracks().forEach(t => t.stop());
  };
}

// ── Estrategia 2: html5-qrcode (fallback) ────────────────────────────────────
function loadHtml5QrCode(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).Html5Qrcode) { resolve((window as any).Html5Qrcode); return; }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    s.onload  = () => resolve((window as any).Html5Qrcode);
    s.onerror = () => reject(new Error("Error cargando escáner"));
    document.head.appendChild(s);
  });
}

async function startHtml5QrCode(
  node: HTMLElement,
  onCode: (code: string) => void,
  onReady: () => void,
  isMountedRef: React.MutableRefObject<boolean>
): Promise<() => void> {
  const Html5Qrcode = await loadHtml5QrCode();
  if (!isMountedRef.current) return () => {};

  const scanner = new Html5Qrcode(CONTAINER_ID);

  await scanner.start(
    { facingMode: "environment" },
    {
      fps: 30,
      qrbox: (w: number, h: number) => ({
        width:  Math.round(Math.min(w, h) * 0.88),
        height: Math.round(Math.min(w, h) * 0.52),
      }),
      aspectRatio: window.innerHeight / window.innerWidth,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      formatsToSupport: [
        // html5-qrcode format enum values for product barcodes
        0, 1, 2, 3, 4, 5, 10, 11, // EAN-13, EAN-8, UPC-A, UPC-E, Code-128, Code-39, QR, DataMatrix
      ],
    },
    (decodedText: string) => { if (isMountedRef.current) onCode(decodedText); },
    undefined
  );

  onReady();

  return () => {
    try { scanner.stop().catch(() => {}); } catch {}
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ScannerScreen() {
  const router = useRouter();
  const { forReceta, forCreateFood } = useLocalSearchParams<{
    forReceta?: string; forCreateFood?: string;
  }>();

  const containerRef  = useRef<any>(null);
  const videoRef      = useRef<HTMLVideoElement | null>(null);
  const isMountedRef  = useRef(true);
  const scannedRef    = useRef(false);
  const cleanupRef    = useRef<(() => void) | null>(null);

  const [status, setStatus]     = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCode = (code: string) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    cleanupRef.current?.();
    if (forCreateFood === "1") {
      router.replace({ pathname: "/create-food", params: { scannedCode: code } });
    } else if (forReceta === "1") {
      router.replace({ pathname: "/recetas", params: { scannedCode: code, scannedForReceta: "1" } });
    } else {
      router.replace({ pathname: "/add-food", params: { code } });
    }
  };

  const onReady = () => { if (isMountedRef.current) setStatus("ready"); };

  useEffect(() => {
    isMountedRef.current = true;

    const init = async (node: HTMLElement) => {
      node.id = CONTAINER_ID;
      node.style.width  = "100%";
      node.style.height = "100%";

      try {
        const hasNative = typeof (window as any).BarcodeDetector !== "undefined";

        if (hasNative) {
          // Crear elemento <video> manualmente para BarcodeDetector
          const video = document.createElement("video");
          video.style.cssText = "width:100%;height:100%;object-fit:cover;";
          node.appendChild(video);
          videoRef.current = video;

          const cleanup = await startNativeDetector(video, handleCode, onReady, isMountedRef);
          cleanupRef.current = cleanup;
        } else {
          const cleanup = await startHtml5QrCode(node, handleCode, onReady, isMountedRef);
          cleanupRef.current = cleanup;
        }
      } catch (e: any) {
        if (!isMountedRef.current) return;
        const msg = e?.name === "NotAllowedError"
          ? "Permiso de cámara denegado. Permite el acceso en tu navegador."
          : "No se pudo abrir la cámara.";
        setErrorMsg(msg);
        setStatus("error");
      }
    };

    const attach = () => {
      const node = containerRef.current;
      if (node) init(node);
      else setTimeout(attach, 30);
    };
    attach();

    return () => {
      isMountedRef.current = false;
      scannedRef.current = true;
      cleanupRef.current?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={s.root}>
      <View ref={containerRef} style={s.camera} />

      {status === "loading" && (
        <View pointerEvents="none" style={s.overlay}>
          <ActivityIndicator color="#1F6FEB" size="large" />
          <Text style={s.hint}>Cargando cámara…</Text>
        </View>
      )}

      {status === "error" && errorMsg && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>⚠ {errorMsg}</Text>
        </View>
      )}

      <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
        <Text style={s.backText}>← Volver</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#000" },
  camera:      { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  overlay:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  hint:        { color: "#fff", fontSize: 14, fontWeight: "600" },
  errorBanner: { position: "absolute", top: 100, left: 16, right: 16, backgroundColor: "#EF444433", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EF444455" },
  errorText:   { color: "#EF4444", fontSize: 13, fontWeight: "600", textAlign: "center" },
  backBtn:     { position: "absolute", top: 52, left: 16, backgroundColor: "#000000BB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  backText:    { color: "#fff", fontSize: 14, fontWeight: "700" },
});
