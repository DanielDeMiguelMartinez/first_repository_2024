import { Camera, CameraView } from "expo-camera";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

export default function ScannerScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  if (hasPermission === null) return <Text>Solicitando permiso…</Text>;
  if (hasPermission === false) return <Text>No hay permiso para la cámara</Text>;

  const handleScan = ({ data }: { data: string }) => {
    setScanned(true);
    router.replace({
      pathname: "/add-food",
      params: { code: data },
    });
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ["qr", "ean13", "ean8", "code128", "upc_a", "upc_e"],
        }}
        onBarcodeScanned={scanned ? undefined : handleScan}
      />
      {scanned && (
        <View style={styles.buttonContainer}>
          <Button title="Escanear de nuevo" onPress={() => setScanned(false)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  buttonContainer: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
  },
});