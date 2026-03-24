/**
 * scanner.web.tsx — Escáner de códigos de barras para web (Vercel).
 *
 * Mejoras de velocidad y detección:
 *  1. BarcodeDetector nativo (Chrome/Edge/Android)
 *     - Resolución 720p en vez de 1080p → 4× menos píxeles a procesar
 *     - createImageBitmap con crop a la zona de escaneo → mucho más rápido
 *     - Autofocus + auto-exposición continuos forzados tras arrancar
 *     - 60fps de frame rate solicitado
 *  2. html5-qrcode como fallback (Firefox, Safari)
 *     - Preload del script en paralelo con la comprobación de BarcodeDetector
 *     - fps elevado a 60 (antes 30)
 *  3. Linterna/torch para luz baja
 *  4. Vibración al detectar
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";

const CONTAINER_ID = "mi-nutri-scanner-root";

const BARCODE_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e",
  "code_128", "code_39", "qr_code", "data_matrix", "itf",
];

// Fracción del vídeo que se recorta para la detección (reduce ~80% de píxeles)
const CROP_W = 0.85;  // 85% del ancho
const CROP_H = 0.30;  // 30% del alto — suficiente para un EAN-13 horizontal

// ── Utilidades ────────────────────────────────────────────────────────────────
function vibrate() {
  try { navigator.vibrate?.(50); } catch {}
}

async function applyOptimalConstraints(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({
      advanced: [
        { focusMode: "continuous" } as any,
        { exposureMode: "continuous" } as any,
        { whiteBalanceMode: "continuous" } as any,
      ],
    });
  } catch {}
}

// ── Estrategia 1: BarcodeDetector nativo ─────────────────────────────────────
async function startNativeDetector(
  videoEl: HTMLVideoElement,
  onCode: (code: string) => void,
  onReady: () => void,
  onTorchReady: (toggle: () => void) => void,
  isMountedRef: React.MutableRefObject<boolean>
): Promise<() => void> {
  const BarcodeDetectorClass = (window as any).BarcodeDetector;
  const supported = await BarcodeDetectorClass.getSupportedFormats?.() ?? BARCODE_FORMATS;
  const formats = BARCODE_FORMATS.filter(f => supported.includes(f));
  const detector = new BarcodeDetectorClass({ formats: formats.length ? formats : BARCODE_FORMATS });

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      width:  { ideal: 1280 },   // 720p — óptimo para barcode
      height: { ideal: 720 },
      frameRate: { ideal: 60 },  // más frames = más oportunidades de detección
    },
  });

  videoEl.srcObject = stream;
  videoEl.setAttribute("playsinline", "true");
  await videoEl.play();

  // Forzar autofocus/autoexposición tras arrancar
  await applyOptimalConstraints(stream);

  // Exponer toggle de linterna si el dispositivo la soporta
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as any;
  if (caps?.torch) {
    let torchOn = false;
    onTorchReady(() => {
      torchOn = !torchOn;
      track.applyConstraints({ advanced: [{ torch: torchOn } as any] }).catch(() => {});
    });
  }

  onReady();

  let rafId: number;
  let lastDetectTime = 0;
  const MIN_INTERVAL_MS = 80; // máximo ~12 detecciones/seg para no bloquear UI

  const scan = async (now: number) => {
    if (!isMountedRef.current) return;

    // Limitar frecuencia de detección
    if (now - lastDetectTime >= MIN_INTERVAL_MS) {
      lastDetectTime = now;
      try {
        const vw = videoEl.videoWidth;
        const vh = videoEl.videoHeight;

        if (vw > 0 && vh > 0) {
          // Recortar solo la zona de escaneo (mucho menos datos que el frame completo)
          const cropW = Math.round(vw * CROP_W);
          const cropH = Math.round(vh * CROP_H);
          const sx    = Math.round((vw - cropW) / 2);
          const sy    = Math.round((vh - cropH) / 2);

          const bitmap = await createImageBitmap(videoEl, sx, sy, cropW, cropH);
          const results = await detector.detect(bitmap);
          bitmap.close(); // liberar memoria inmediatamente

          if (results.length > 0) {
            vibrate();
            onCode(results[0].rawValue);
            return; // detener loop
          }
        }
      } catch {}
    }

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
      fps: 60,  // antes 30 — el doble de oportunidades de detección
      qrbox: (w: number, h: number) => ({
        width:  Math.round(w * CROP_W),
        height: Math.round(h * CROP_H),
      }),
      aspectRatio: window.innerHeight / window.innerWidth,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      formatsToSupport: [0, 1, 2, 3, 4, 5, 10, 11], // EAN-13, EAN-8, UPC-A, UPC-E, Code-128, Code-39, QR, DataMatrix
      videoConstraints: {
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
        facingMode: "environment",
      },
    },
    (decodedText: string) => {
      if (!isMountedRef.current) return;
      vibrate();
      onCode(decodedText);
    },
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

  const containerRef = useRef<any>(null);
  const videoRef     = useRef<HTMLVideoElement | null>(null);
  const isMountedRef = useRef(true);
  const scannedRef   = useRef(false);
  const cleanupRef   = useRef<(() => void) | null>(null);

  const [status, setStatus]         = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [torchFn, setTorchFn]       = useState<(() => void) | null>(null);
  const [torchOn, setTorchOn]       = useState(false);

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

  const handleTorch = () => {
    if (!torchFn) return;
    torchFn();
    setTorchOn(v => !v);
  };

  useEffect(() => {
    isMountedRef.current = true;

    // Precargar html5-qrcode en paralelo para que el fallback arranque instantáneo
    const preloadPromise = loadHtml5QrCode().catch(() => {});

    const init = async (node: HTMLElement) => {
      node.id = CONTAINER_ID;
      node.style.width  = "100%";
      node.style.height = "100%";

      try {
        const hasNative = typeof (window as any).BarcodeDetector !== "undefined";

        if (hasNative) {
          const video = document.createElement("video");
          video.style.cssText = "width:100%;height:100%;object-fit:cover;";
          node.appendChild(video);
          videoRef.current = video;

          const cleanup = await startNativeDetector(
            video,
            handleCode,
            onReady,
            (fn) => setTorchFn(() => fn),
            isMountedRef
          );
          cleanupRef.current = cleanup;
        } else {
          await preloadPromise; // ya estará listo
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
      {/* Vista de cámara */}
      <View ref={containerRef} style={s.camera} />

      {/* Overlay con guía visual */}
      {status === "ready" && (
        <View style={s.overlay} pointerEvents="none">
          {/* Marco de escaneo */}
          <View style={s.scanFrame}>
            {/* Esquinas */}
            <View style={[s.corner, s.cornerTL]} />
            <View style={[s.corner, s.cornerTR]} />
            <View style={[s.corner, s.cornerBL]} />
            <View style={[s.corner, s.cornerBR]} />
            {/* Línea de escaneo */}
            <ScanLine />
          </View>
          <Text style={s.hint}>Apunta al código de barras del producto</Text>
        </View>
      )}

      {/* Cargando */}
      {status === "loading" && (
        <View pointerEvents="none" style={s.loadingOverlay}>
          <ActivityIndicator color="#1F6FEB" size="large" />
          <Text style={s.loadingText}>Activando cámara…</Text>
        </View>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>⚠ {errorMsg}</Text>
        </View>
      )}

      {/* Botones superiores */}
      <View style={s.topBar}>
        <TouchableOpacity style={s.topBtn} onPress={() => router.back()}>
          <Text style={s.topBtnText}>← Volver</Text>
        </TouchableOpacity>
        {torchFn && (
          <TouchableOpacity style={[s.topBtn, torchOn && s.topBtnActive]} onPress={handleTorch}>
            <Text style={s.topBtnText}>{torchOn ? "🔦 ON" : "🔦"}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// Línea de escaneo animada
function ScanLine() {
  const pos = useRef<any>(null);
  const direction = useRef(1);
  const value = useRef(0);

  useEffect(() => {
    let frame: number;
    const animate = () => {
      value.current += direction.current * 1.2;
      if (value.current >= 100) { value.current = 100; direction.current = -1; }
      if (value.current <= 0)   { value.current = 0;   direction.current = 1;  }
      if (pos.current) pos.current.setNativeProps?.({ style: { top: `${value.current}%` } });
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <View ref={pos} style={s.scanLine} />;
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#000" },
  camera:       { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },

  // Overlay visual
  overlay:      { flex: 1, alignItems: "center", justifyContent: "center" },
  scanFrame: {
    width: "80%",
    height: "22%",
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },
  scanLine: {
    position: "absolute",
    left: 0, right: 0,
    height: 2,
    backgroundColor: "#1F6FEB",
    opacity: 0.9,
    top: "50%",
  } as any,

  // Esquinas del marco
  corner: {
    position: "absolute",
    width: 22, height: 22,
    borderColor: "#fff",
  },
  cornerTL: { top: 0, left: 0,  borderTopWidth: 3, borderLeftWidth: 3,  borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0,  borderBottomWidth: 3, borderLeftWidth: 3,  borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },

  hint: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 18,
    textAlign: "center",
    textShadowColor: "#000",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Loading
  loadingOverlay: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  loadingText:    { color: "#fff", fontSize: 14, fontWeight: "600" },

  // Error
  errorBanner: {
    position: "absolute", top: 100, left: 16, right: 16,
    backgroundColor: "#EF444433",
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#EF444455",
  },
  errorText: { color: "#EF4444", fontSize: 13, fontWeight: "600", textAlign: "center" },

  // Barra superior
  topBar: {
    position: "absolute", top: 52, left: 16, right: 16,
    flexDirection: "row", justifyContent: "space-between",
  },
  topBtn: {
    backgroundColor: "#000000BB",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  topBtnActive: { backgroundColor: "#1F6FEB" },
  topBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
