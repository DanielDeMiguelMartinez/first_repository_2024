import { useApp } from "@/app/services/i18n";
import { crearAlimentoPersonalizado } from "@/app/services/supabase";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type Campo = {
  key: string;
  label: string;
  unit?: string;
  decimal?: boolean;
};

const CAMPOS: Campo[] = [
  { key: "calorias", label: "Calorías", unit: "kcal" },
  { key: "proteinas", label: "Proteínas", unit: "g/100g", decimal: true },
  { key: "carbohidratos", label: "Carbohidratos", unit: "g/100g", decimal: true },
  { key: "azucares", label: "Azúcares", unit: "g/100g", decimal: true },
  { key: "grasas", label: "Grasas", unit: "g/100g", decimal: true },
  { key: "grasas_saturadas", label: "Grasas saturadas", unit: "g/100g", decimal: true },
  { key: "fibra", label: "Fibra", unit: "g/100g", decimal: true },
  { key: "sal", label: "Sal", unit: "g/100g", decimal: true },
];

const SUPERMERCADOS = [
  "Mercadona", "Carrefour", "Lidl", "DIA", "Alcampo", "Eroski",
  "Aldi", "Consum", "Simply", "Hipercor", "El Corte Inglés",
  "Caprabo", "Ahorramas", "Gadis", "Spar", "Covirán",
  "Bonpreu", "Condis", "Otro",
];

const SUPER_COLORS: Record<string, string> = {
  Mercadona: "#00A651", Carrefour: "#004A97", Lidl: "#0050AA",
  DIA: "#E30613", Alcampo: "#FF6600", Eroski: "#E2001A",
  Aldi: "#00529B", Consum: "#E2001A", Simply: "#FF6600",
  Hipercor: "#E30613", "El Corte Inglés": "#006400",
  Caprabo: "#E2001A", Ahorramas: "#FF6600", Gadis: "#004A97",
  Spar: "#E2001A", Covirán: "#FF6600", Bonpreu: "#B8860B",
  Condis: "#004A97", Otro: "#6B7280",
};

const SUGERENCIAS_PORCION = [
  "1 galleta", "1 rebanada", "1 pan", "1 tortita", "1 barrita",
  "1 onza", "1 cracker", "1 oblea", "1 pieza", "1 unidad",
  "1 taza", "1 cucharada", "1 cucharadita", "1 ración",
];

type Porcion = { nombre: string; gramos: string };

export default function CreateFoodScreen() {
  const { colors, theme } = useApp();
  const s = makeSStyles(colors);
  const router = useRouter();
  const params = useLocalSearchParams<{ scannedCode?: string }>();
  const [guardando, setGuardando] = useState(false);
  const [superSeleccionado, setSuperSeleccionado] = useState("");
  const [mostrarSupers, setMostrarSupers] = useState(false);
  const [codigoBarras, setCodigoBarras] = useState("");
  const [porciones, setPorciones] = useState<Porcion[]>([]);
  const [pesoEnvase, setPesoEnvase] = useState("");
  const [form, setForm] = useState<Record<string, string>>({
    nombre: "", marca: "", calorias: "", proteinas: "",
    carbohidratos: "", azucares: "", grasas: "",
    grasas_saturadas: "", fibra: "", sal: "",
  });

  useEffect(() => {
    if (params.scannedCode) setCodigoBarras(params.scannedCode);
  }, [params.scannedCode]);

  // Normaliza separador decimal: acepta tanto "," como "." (útil en teclados europeos)
  const set = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val.replace(",", ".") }));
  const seleccionarSuper = (s: string) => { setSuperSeleccionado(s); setMostrarSupers(false); };

  const agregarPorcion = () => setPorciones((prev) => [...prev, { nombre: "", gramos: "" }]);
  const actualizarPorcion = (i: number, campo: keyof Porcion, valor: string) =>
    setPorciones((prev) => prev.map((p, idx) => idx === i ? { ...p, [campo]: valor } : p));
  const eliminarPorcion = (i: number) =>
    setPorciones((prev) => prev.filter((_, idx) => idx !== i));

  const calcularPorcion = (gramos: number) => {
    const f = gramos / 100;
    return {
      cal: Math.round((Number(form.calorias) || 0) * f),
      prot: ((Number(form.proteinas) || 0) * f).toFixed(1),
      carb: ((Number(form.carbohidratos) || 0) * f).toFixed(1),
      gras: ((Number(form.grasas) || 0) * f).toFixed(1),
    };
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { Alert.alert("Error", "El nombre es obligatorio."); return; }
    if (!form.calorias || !form.proteinas || !form.carbohidratos || !form.grasas) {
      Alert.alert("Error", "Calorías, proteínas, carbohidratos y grasas son obligatorios."); return;
    }
    for (const p of porciones) {
      if (p.nombre.trim() && (!p.gramos || Number(p.gramos) <= 0)) {
        Alert.alert("Error", `Indica el peso en gramos de "${p.nombre}".`); return;
      }
    }

    setGuardando(true);

    const porcionesLimpias = porciones
      .filter((p) => p.nombre.trim() && Number(p.gramos) > 0)
      .map((p) => ({ nombre: p.nombre.trim(), gramos: Number(p.gramos) }));

    // Construimos el objeto sin campos undefined para evitar errores en Supabase
    const alimento: Record<string, any> = {
      nombre: form.nombre.trim(),
      // marca es opcional — si está vacía no la enviamos o ponemos null
      marca: form.marca.trim() || null,
      supermercado: superSeleccionado || "Personalizado",
      calorias: Number(form.calorias) || 0,
      proteinas: Number(form.proteinas) || 0,
      carbohidratos: Number(form.carbohidratos) || 0,
      azucares: Number(form.azucares) || 0,
      grasas: Number(form.grasas) || 0,
      grasas_saturadas: Number(form.grasas_saturadas) || 0,
      fibra: Number(form.fibra) || 0,
      sal: Number(form.sal) || 0,
    };

    // Solo añadir campos opcionales si tienen valor
    if (pesoEnvase && Number(pesoEnvase) > 0) alimento.peso_envase = Number(pesoEnvase);
    if (codigoBarras.trim()) alimento.codigo_barras = codigoBarras.trim();
    if (porcionesLimpias.length > 0) alimento.porciones = porcionesLimpias;

    try {
      const ok = await crearAlimentoPersonalizado(alimento as any);
      setGuardando(false);
      if (ok) {
        Alert.alert(
          "✓ Guardado",
          codigoBarras.trim()
            ? "Alimento creado. Al escanear ese código aparecerá esta información."
            : "Alimento creado y disponible para todos los usuarios.",
          [{ text: "OK", onPress: () => router.back() }]
        );
      } else {
        Alert.alert("Error", "No se pudo guardar. Comprueba tu conexión e inténtalo de nuevo.");
      }
    } catch (e: any) {
      setGuardando(false);
      Alert.alert("Error", `No se pudo guardar: ${e?.message || "error desconocido"}`);
    }
  };

  const colorSuper = superSeleccionado ? (SUPER_COLORS[superSeleccionado] || "#6B7280") : null;
  const hayMacros = form.calorias || form.proteinas || form.carbohidratos || form.grasas;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
      <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">

        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.back}>← Volver</Text>
          </TouchableOpacity>
          <Text style={s.title}>Crear alimento</Text>
          <Text style={s.subtitle}>Visible para todos los usuarios</Text>
        </View>

        {/* INFO BÁSICA */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>🏷️ Información básica</Text>

          <View style={s.field}>
            <Text style={s.label}>Nombre <Text style={s.required}>*</Text></Text>
            <TextInput style={s.input} value={form.nombre} onChangeText={(v) => set("nombre", v)}
              placeholder="Ej: Galletas María Fontaneda" placeholderTextColor={colors.textMuted} />
          </View>

          {/* MARCA — opcional */}
          <View style={s.field}>
            <Text style={s.label}>Marca <Text style={s.optional}>(opcional)</Text></Text>
            <TextInput style={s.input} value={form.marca} onChangeText={(v) => set("marca", v)}
              placeholder="Ej: Fontaneda" placeholderTextColor={colors.textMuted} />
          </View>

          {/* SUPERMERCADO */}
          <View style={s.field}>
            <Text style={s.label}>Supermercado <Text style={s.optional}>(opcional)</Text></Text>
            <TouchableOpacity
              style={[s.superSelector, colorSuper && { borderColor: colorSuper + "66", backgroundColor: colorSuper + "11" }]}
              onPress={() => setMostrarSupers((v) => !v)}
              activeOpacity={0.7}
            >
              {superSeleccionado ? (
                <View style={s.superSelectedRow}>
                  <View style={[s.superDot, { backgroundColor: colorSuper! }]} />
                  <Text style={[s.superSelectedText, { color: colorSuper! }]}>{superSeleccionado}</Text>
                </View>
              ) : (
                <Text style={s.superPlaceholder}>Seleccionar supermercado...</Text>
              )}
              <Text style={s.superChevron}>{mostrarSupers ? "▲" : "▼"}</Text>
            </TouchableOpacity>
            {mostrarSupers && (
              <View style={s.superDropdown}>
                {SUPERMERCADOS.map((sup) => {
                  const color = SUPER_COLORS[sup] || "#6B7280";
                  const activo = superSeleccionado === sup;
                  return (
                    <TouchableOpacity key={sup} style={[s.superOption, activo && { backgroundColor: color + "22" }]}
                      onPress={() => seleccionarSuper(sup)} activeOpacity={0.7}>
                      <View style={[s.superDot, { backgroundColor: color }]} />
                      <Text style={[s.superOptionText, activo && { color, fontWeight: "700" }]}>{sup}</Text>
                      {activo && <Text style={[s.superCheck, { color }]}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={s.superClearBtn} onPress={() => { setSuperSeleccionado(""); setMostrarSupers(false); }}>
                  <Text style={s.superClearText}>✕ Sin supermercado</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* CÓDIGO DE BARRAS */}
          <View style={s.field}>
            <Text style={s.label}>Código de barras <Text style={s.optional}>(opcional)</Text></Text>
            <Text style={s.labelHint}>Otros usuarios verán esta info al escanear el producto</Text>
            <View style={s.barcodeRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={codigoBarras}
                onChangeText={setCodigoBarras}
                placeholder="Ej: 8410128001234"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
              />
              <TouchableOpacity
                style={s.scanBarcodeBtn}
                onPress={() => router.push({ pathname: "/scanner", params: { forCreateFood: "1" } })}
                activeOpacity={0.7}
              >
                <Text style={s.scanBarcodeBtnIcon}>📷</Text>
              </TouchableOpacity>
            </View>
            {codigoBarras.trim().length > 0 && (
              <View style={s.barcodeBadge}>
                <Text style={s.barcodeBadgeCheck}>✓</Text>
                <Text style={s.barcodeBadgeText}>Código: {codigoBarras.trim()}</Text>
                <TouchableOpacity onPress={() => setCodigoBarras("")}>
                  <Text style={s.barcodeBadgeClear}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* MACROS */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>📊 Valores por 100g</Text>
          <View style={s.macrosGrid}>
            {CAMPOS.map((campo) => (
              <View key={campo.key} style={s.macroField}>
                <Text style={s.macroLabel}>{campo.label}</Text>
                {campo.unit && <Text style={s.macroUnit}>{campo.unit}</Text>}
                <TextInput
                  style={s.macroInput}
                  value={form[campo.key]}
                  onChangeText={(v) => set(campo.key, v)}
                  keyboardType={campo.decimal ? "decimal-pad" : "numeric"}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            ))}
          </View>
        </View>

        {/* PESO ENVASE */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>📦 Peso del envase <Text style={s.optional}>(opcional)</Text></Text>
          <Text style={s.sectionSubtitle}>Peso total del paquete completo</Text>
          <View style={s.pesoEnvaseRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={pesoEnvase}
              onChangeText={setPesoEnvase}
              placeholder="Ej: 200"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />
            <View style={s.pesoEnvaseUnit}>
              <Text style={s.pesoEnvaseUnitText}>g</Text>
            </View>
          </View>
        </View>

        {/* PORCIONES */}
        <View style={s.section}>
          <View style={s.sectionHeaderRow}>
            <View>
              <Text style={s.sectionTitle}>🍽️ Porciones individuales <Text style={s.optional}>(opcional)</Text></Text>
              <Text style={s.sectionSubtitle}>Ej: 1 galleta = 8g, 1 rebanada = 25g</Text>
            </View>
            <TouchableOpacity style={s.addPorcionBtn} onPress={agregarPorcion}>
              <Text style={s.addPorcionBtnText}>+ Añadir</Text>
            </TouchableOpacity>
          </View>

          {porciones.length === 0 ? (
            <TouchableOpacity style={s.emptyPorciones} onPress={agregarPorcion} activeOpacity={0.7}>
              <Text style={s.emptyPorcionesIcon}>🍽️</Text>
              <Text style={s.emptyPorcionesText}>Toca para añadir una porción</Text>
              <Text style={s.emptyPorcionesHint}>Ej: 1 galleta, 1 rebanada, 1 pan...</Text>
            </TouchableOpacity>
          ) : (
            porciones.map((porcion, i) => {
              const g = Number(porcion.gramos) || 0;
              const macrosPorcion = g > 0 && hayMacros ? calcularPorcion(g) : null;
              return (
                <View key={i} style={s.porcionCard}>
                  <View style={s.porcionCardHeader}>
                    <Text style={s.porcionCardNum}>Porción {i + 1}</Text>
                    <TouchableOpacity onPress={() => eliminarPorcion(i)}>
                      <Text style={s.porcionDelete}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.field}>
                    <Text style={s.label}>Nombre de la porción</Text>
                    <TextInput style={s.input} value={porcion.nombre}
                      onChangeText={(v) => actualizarPorcion(i, "nombre", v)}
                      placeholder="Ej: 1 galleta" placeholderTextColor={colors.textMuted} />
                  </View>
                  {/* Sugerencias */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={s.sugerenciasRow}>
                      {SUGERENCIAS_PORCION.map((sug) => (
                        <TouchableOpacity
                          key={sug}
                          style={[s.sugerenciaChip, porcion.nombre === sug && s.sugerenciaChipActive]}
                          onPress={() => actualizarPorcion(i, "nombre", sug)}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.sugerenciaChipText, porcion.nombre === sug && s.sugerenciaChipTextActive]}>
                            {sug}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                  <View style={s.field}>
                    <Text style={s.label}>Peso de esta porción</Text>
                    <View style={s.pesoEnvaseRow}>
                      <TextInput
                        style={[s.input, { flex: 1 }]}
                        value={porcion.gramos}
                        onChangeText={(v) => actualizarPorcion(i, "gramos", v)}
                        placeholder="Ej: 8" placeholderTextColor={colors.textMuted} keyboardType="numeric"
                      />
                      <View style={s.pesoEnvaseUnit}>
                        <Text style={s.pesoEnvaseUnitText}>g</Text>
                      </View>
                    </View>
                  </View>
                  {macrosPorcion && (
                    <View style={s.porcionPreview}>
                      <Text style={s.porcionPreviewTitle}>
                        Macros de {porcion.nombre || `porción ${i + 1}`} ({g}g)
                      </Text>
                      <View style={s.porcionPreviewRow}>
                        {[
                          { val: macrosPorcion.cal, label: "kcal", color: "#4ADE80" },
                          { val: macrosPorcion.prot + "g", label: "Prot", color: "#60A5FA" },
                          { val: macrosPorcion.carb + "g", label: "Carbos", color: "#FBBF24" },
                          { val: macrosPorcion.gras + "g", label: "Grasas", color: "#F87171" },
                        ].map((item) => (
                          <View key={item.label} style={s.porcionPreviewBox}>
                            <Text style={[s.porcionPreviewVal, { color: item.color }]}>{item.val}</Text>
                            <Text style={s.porcionPreviewLabel}>{item.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}
          {porciones.length > 0 && (
            <TouchableOpacity style={s.addOtraPorcionBtn} onPress={agregarPorcion}>
              <Text style={s.addOtraPorcionBtnText}>+ Añadir otra porción</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* PREVIEW */}
        {hayMacros ? (
          <View style={s.preview}>
            <View style={s.previewHeader}>
              <Text style={s.previewTitle}>Vista previa por 100g</Text>
              {superSeleccionado && colorSuper && (
                <View style={[s.previewBadge, { backgroundColor: colorSuper + "22", borderColor: colorSuper + "55" }]}>
                  <Text style={[s.previewBadgeText, { color: colorSuper }]}>{superSeleccionado}</Text>
                </View>
              )}
            </View>
            <View style={s.previewGrid}>
              {[
                { val: form.calorias || "0", label: "kcal", color: "#4ADE80" },
                { val: (form.proteinas || "0") + "g", label: "Prot", color: "#60A5FA" },
                { val: (form.carbohidratos || "0") + "g", label: "Carbos", color: "#FBBF24" },
                { val: (form.grasas || "0") + "g", label: "Grasas", color: "#F87171" },
              ].map((item) => (
                <View key={item.label} style={s.previewBox}>
                  <Text style={[s.previewVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={s.previewLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <TouchableOpacity style={[s.saveBtn, guardando && s.saveBtnDisabled]} onPress={guardar} disabled={guardando}>
          <Text style={s.saveBtnText}>{guardando ? "Guardando..." : "✓ Crear alimento"}</Text>
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeSStyles(c: any) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 16, paddingBottom: 8, gap: 4 },
  back: { color: "#58A6FF", fontSize: 14, marginBottom: 4 },
  title: { color: c.text, fontSize: 26, fontWeight: "800" },
  subtitle: { color: c.textMuted, fontSize: 13 },
  section: { backgroundColor: c.card, borderRadius: 20, padding: 16, marginTop: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 12 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  sectionTitle: { color: c.textSub, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  sectionSubtitle: { color: c.textMuted, fontSize: 11, marginTop: 2 },
  field: { gap: 6 },
  label: { color: c.textSub, fontSize: 13 },
  labelHint: { color: c.textMuted, fontSize: 11, marginTop: -2 },
  optional: { color: c.textMuted, fontWeight: "400", fontSize: 11, textTransform: "none", letterSpacing: 0 },
  required: { color: "#F87171" },
  input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 12, color: c.text, fontSize: 15 },
  barcodeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  scanBarcodeBtn: { width: 48, height: 48, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  scanBarcodeBtnIcon: { fontSize: 22 },
  barcodeBadge: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#14532D", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  barcodeBadgeCheck: { color: "#4ADE80", fontSize: 14, fontWeight: "800" },
  barcodeBadgeText: { flex: 1, color: "#4ADE80", fontSize: 13, fontWeight: "600" },
  barcodeBadgeClear: { color: "#4ADE80", fontSize: 13 },
  superSelector: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 12 },
  superSelectedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  superDot: { width: 10, height: 10, borderRadius: 5 },
  superSelectedText: { fontSize: 15, fontWeight: "700" },
  superPlaceholder: { color: c.textMuted, fontSize: 15 },
  superChevron: { color: c.textMuted, fontSize: 12 },
  superDropdown: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, overflow: "hidden", marginTop: 4 },
  superOption: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.card },
  superOptionText: { flex: 1, color: c.textSub, fontSize: 14 },
  superCheck: { fontSize: 14, fontWeight: "700" },
  superClearBtn: { paddingHorizontal: 14, paddingVertical: 12, alignItems: "center" },
  superClearText: { color: c.textMuted, fontSize: 13 },
  pesoEnvaseRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  pesoEnvaseUnit: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 12, width: 48, alignItems: "center", justifyContent: "center" },
  pesoEnvaseUnitText: { color: c.textMuted, fontSize: 15, fontWeight: "600" },
  addPorcionBtn: { backgroundColor: "#1F6FEB22", borderWidth: 1, borderColor: "#1F6FEB55", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addPorcionBtnText: { color: "#58A6FF", fontSize: 13, fontWeight: "700" },
  emptyPorciones: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 20, alignItems: "center", gap: 6 },
  emptyPorcionesIcon: { fontSize: 32 },
  emptyPorcionesText: { color: c.textMuted, fontSize: 14, fontWeight: "600" },
  emptyPorcionesHint: { color: c.textMuted, fontSize: 12 },
  porcionCard: { backgroundColor: c.bg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  porcionCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  porcionCardNum: { color: c.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  porcionDelete: { fontSize: 16 },
  sugerenciasRow: { flexDirection: "row", gap: 6, paddingVertical: 4 },
  sugerenciaChip: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  sugerenciaChipActive: { backgroundColor: "#1F6FEB22", borderColor: "#58A6FF" },
  sugerenciaChipText: { color: c.textMuted, fontSize: 12 },
  sugerenciaChipTextActive: { color: "#58A6FF", fontWeight: "600" },
  porcionPreview: { backgroundColor: c.card, borderRadius: 10, padding: 10, gap: 8 },
  porcionPreviewTitle: { color: c.textMuted, fontSize: 11, fontWeight: "600" },
  porcionPreviewRow: { flexDirection: "row", gap: 6 },
  porcionPreviewBox: { flex: 1, backgroundColor: c.bg, borderRadius: 8, padding: 8, alignItems: "center" },
  porcionPreviewVal: { fontSize: 13, fontWeight: "800" },
  porcionPreviewLabel: { color: c.textMuted, fontSize: 9, marginTop: 1 },
  addOtraPorcionBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 12, alignItems: "center" },
  addOtraPorcionBtnText: { color: c.textMuted, fontSize: 13 },
  macrosGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  macroField: { width: "47%", gap: 4 },
  macroLabel: { color: c.textSub, fontSize: 12 },
  macroUnit: { color: c.textMuted, fontSize: 10 },
  macroInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, padding: 10, color: c.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
  preview: { backgroundColor: c.card, borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  previewTitle: { color: c.textMuted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  previewBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  previewBadgeText: { fontSize: 11, fontWeight: "700" },
  previewGrid: { flexDirection: "row", gap: 8 },
  previewBox: { flex: 1, backgroundColor: c.bg, borderRadius: 10, padding: 10, alignItems: "center" },
  previewVal: { fontSize: 16, fontWeight: "800" },
  previewLabel: { color: c.textMuted, fontSize: 10, marginTop: 2 },
  saveBtn: { backgroundColor: "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 20 },
  saveBtnDisabled: { backgroundColor: "#1F3A6B" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
}); };