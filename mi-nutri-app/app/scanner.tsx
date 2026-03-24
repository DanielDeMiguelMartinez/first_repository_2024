import { Camera, CameraView } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, Vibration, View } from "react-native";

const BARCODE_TYPES: any[] = [
  "ean13", "ean8", "upc_a", "upc_e",
  "code128", "code39", "code93",
  "qr", "datamatrix", "pdf417", "aztec", "itf14",
];

export default function ScannerScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const scannedRef = useRef(false);
  const router = useRouter();
  const { forReceta, forCreateFood } = useLocalSearchParams<{
    forReceta?: string;
    forCreateFood?: string;
  }>();

  useEffect(() => {
    Camera.requestCameraPermissionsAsync().then(({ status }) =>
      setHasPermission(status === "granted")
    );
  }, []);

  const handleScan = ({ data }: { data: string }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;

    // Feedback háptico inmediato al detectar
    if (Platform.OS !== "web") Vibration.vibrate(50);

    if (forCreateFood === "1") {
      router.replace({ pathname: "/create-food", params: { scannedCode: data } });
    } else if (forReceta === "1") {
      router.replace({ pathname: "/recetas", params: { scannedCode: data, scannedForReceta: "1" } });
    } else {
      router.replace({ pathname: "/add-food", params: { code: data } });
    }
  };

  if (hasPermission === null) {
    return (
      <View style={s.permWrap}>
        <Text style={s.permText}>Solicitando permiso de cámara…</Text>
      </View>
    );
  }
  if (hasPermission === false) {
    return (
      <View style={s.permWrap}>
        <Text style={s.permText}>Sin permiso de cámara.</Text>
        <Text style={s.permSub}>Ve a Ajustes y activa el permiso para esta app.</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={handleScan}
      />

      {/* Overlay oscuro con ventana de escaneo */}
      <View style={s.overlay} pointerEvents="none">
        {/* Zona transparente — el CSS de "hueco" se hace con 4 vistas oscuras */}
        <View style={s.overlayTop} />
        <View style={s.overlayMiddle}>
          <View style={s.overlaySide} />
          <View style={s.scanWindow}>
            {/* Esquinas del marco */}
            <View style={[s.corner, s.cornerTL]} />
            <View style={[s.corner, s.cornerTR]} />
            <View style={[s.corner, s.cornerBL]} />
            <View style={[s.corner, s.cornerBR]} />
          </View>
          <View style={s.overlaySide} />
        </View>
        <View style={s.overlayBottom}>
          <Text style={s.hint}>Apunta al código de barras del producto</Text>
        </View>
      </View>

      {/* Botón volver */}
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
        <Text style={s.backText}>← Volver</Text>
      </TouchableOpacity>
    </View>
  );
}

const WINDOW_W = "78%";
const WINDOW_H = 140;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },

  permWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#0F172A" },
  permText: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  permSub:  { color: "#94A3B8", fontSize: 13, textAlign: "center" },

  // Overlay con hueco
  overlay:       { flex: 1 },
  overlayTop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  overlayMiddle: { flexDirection: "row", height: WINDOW_H },
  overlaySide:   { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  overlayBottom: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", paddingTop: 20,
  },
  scanWindow: {
    width: WINDOW_W as any,
    height: WINDOW_H,
    position: "relative",
  },

  hint: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // Esquinas
  corner:     { position: "absolute", width: 24, height: 24, borderColor: "#fff" },
  cornerTL:   { top: 0, left: 0,     borderTopWidth: 3, borderLeftWidth: 3,   borderTopLeftRadius: 6 },
  cornerTR:   { top: 0, right: 0,    borderTopWidth: 3, borderRightWidth: 3,  borderTopRightRadius: 6 },
  cornerBL:   { bottom: 0, left: 0,  borderBottomWidth: 3, borderLeftWidth: 3,  borderBottomLeftRadius: 6 },
  cornerBR:   { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },

  backBtn: {
    position: "absolute", top: 52, left: 16,
    backgroundColor: "#000000BB",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  backText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
