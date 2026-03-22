/**
 * scanner.web.tsx — Escáner de códigos de barras para web (Vercel).
 *
 * Usa html5-qrcode que gestiona internamente los permisos de cámara,
 * el stream de vídeo y el bucle de detección.
 * Soporta: EAN-13, EAN-8, QR, Code-128, UPC-A/E, Code-39, Data Matrix, etc.
 * Funciona en Chrome, Firefox, Safari (iOS/macOS) y Android.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const CONTAINER_ID = "mi-nutri-scanner-root";

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

export default function ScannerScreen() {
  const router = useRouter();
  const { forReceta, forCreateFood } = useLocalSearchParams<{
    forReceta?: string; forCreateFood?: string;
  }>();

  const containerRef = useRef<any>(null);
  const scannerRef   = useRef<any>(null);
  const scannedRef   = useRef(false);

  const [status, setStatus]     = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCode = (code: string) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    if (scannerRef.current) {
      try { scannerRef.current.stop().catch(() => {}); } catch {}
    }
    if (forCreateFood === "1") {
      router.replace({ pathname: "/create-food", params: { scannedCode: code } });
    } else if (forReceta === "1") {
      router.replace({ pathname: "/recetas", params: { scannedCode: code, scannedForReceta: "1" } });
    } else {
      router.replace({ pathname: "/add-food", params: { code } });
    }
  };

  useEffect(() => {
    let isMounted = true;

    const init = async (node: HTMLElement) => {
      /* Aseguramos que el nodo tenga las dimensiones correctas */
      node.id = CONTAINER_ID;
      node.style.width  = "100%";
      node.style.height = "100%";

      try {
        const Html5Qrcode = await loadHtml5QrCode();
        if (!isMounted) return;

        const scanner = new Html5Qrcode(CONTAINER_ID);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            /* Recuadro de guía centrado en pantalla */
            qrbox: (w: number, h: number) => ({
              width:  Math.round(Math.min(w, h) * 0.75),
              height: Math.round(Math.min(w, h) * 0.45),
            }),
            aspectRatio: window.innerHeight / window.innerWidth,
          },
          (decodedText: string) => { if (isMounted) handleCode(decodedText); },
          /* Ignorar errores de frame individuales */
          undefined
        );

        if (isMounted) setStatus("ready");
      } catch (e: any) {
        if (!isMounted) return;
        const msg = e?.name === "NotAllowedError"
          ? "Permiso de cámara denegado."
          : "No se pudo abrir la cámara.";
        setErrorMsg(msg);
        setStatus("error");
      }
    };

    /* Esperar a que el ref de React Native esté montado en el DOM */
    const attach = () => {
      const node = containerRef.current;
      if (node) { init(node); }
      else { setTimeout(attach, 50); }
    };
    attach();

    return () => {
      isMounted = false;
      scannedRef.current = true;
      if (scannerRef.current) {
        try { scannerRef.current.stop().catch(() => {}); } catch {}
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={s.root}>
      {/* html5-qrcode inyecta el vídeo y el marco de guía aquí */}
      <View ref={containerRef} style={s.camera} />

      {/* Overlay de carga */}
      {status === "loading" && (
        <View pointerEvents="none" style={s.overlay}>
          <ActivityIndicator color="#1F6FEB" size="large" />
          <Text style={s.hint}>Cargando cámara…</Text>
        </View>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>⚠ {errorMsg}</Text>
        </View>
      )}

      {/* Botón volver */}
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
