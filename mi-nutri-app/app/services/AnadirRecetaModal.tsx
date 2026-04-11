import { useApp } from "@/app/services/i18n";
import { Receta } from "@/app/services/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  Modal, ScrollView, Text, TextInput, TouchableOpacity, View,
} from "react-native";

export type MealKey = "desayuno" | "comida" | "merienda" | "cena";
export const MEAL_ICONS: Record<MealKey, string> = { desayuno: "🌅", comida: "☀️", merienda: "🍎", cena: "🌙" };

function safeNum(val: any): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

export function AnadirRecetaModal({
  receta, visible, onClose, onAdd, initialMeal, initialRaciones, hideMealSelector, dateKey,
}: {
  receta: Receta | null;
  visible: boolean;
  onClose: () => void;
  onAdd: (kcal: number, prot: number, carb: number, gras: number, nombre: string, meal: MealKey, raciones: number, ingredientesGramos?: number[]) => Promise<void>;
  initialMeal?: MealKey;
  initialRaciones?: number;
  hideMealSelector?: boolean;
  dateKey?: string;
}) {
  const { t, colors } = useApp();
  const MEAL_LABELS: Record<MealKey, string> = { desayuno: t.breakfast, comida: t.lunch, merienda: t.snack, cena: t.dinner };
  const [racionesBase, setRacionesBase] = useState(1);
  const [racionesAnadir, setRacionesAnadir] = useState(1);
  const [ingModifs, setIngModifs] = useState<{ gramos: number; pinned: boolean }[]>([]);
  const [ingEditandoIdx, setIngEditandoIdx] = useState<number | null>(null);
  const [ingEditandoGramos, setIngEditandoGramos] = useState("");
  const [mealSel, setMealSel] = useState<MealKey>(initialMeal ?? "comida");

  useEffect(() => {
    if (visible) setMealSel(initialMeal ?? "comida");
  }, [visible]);

  useEffect(() => {
    if (!receta) { setIngModifs([]); setIngEditandoIdx(null); return; }
    Promise.all([
      AsyncStorage.getItem("nutri_recetas_raciones"),
      AsyncStorage.getItem("nutri_receta_gramos"),
    ]).then(([vRaciones, vGramos]) => {
      let mapRaciones: Record<string, number> = {};
      try { if (vRaciones) mapRaciones = JSON.parse(vRaciones); } catch {}
      let mapGramos: Record<string, number[]> = {};
      try { if (vGramos) mapGramos = JSON.parse(vGramos); } catch {}
      const rBase = mapRaciones[receta.nombre] ?? receta.raciones ?? 1;
      const rInit = initialRaciones != null ? initialRaciones : rBase;
      const factor = rBase > 0 ? rInit / rBase : 1;
      setRacionesBase(rBase);
      setRacionesAnadir(rInit);
      // Scope por fecha+nombre si se pasa dateKey, si no solo por nombre
      const gramosKey = dateKey ? `${dateKey}::${receta.nombre}` : receta.nombre;
      const savedGramos = mapGramos[gramosKey];
      setIngModifs((receta.ingredientes ?? []).map((ing, i) => {
        const gramos = (savedGramos && savedGramos[i] != null)
          ? savedGramos[i]
          : Math.round(ing.gramos * factor);
        return { gramos, pinned: !!(savedGramos && savedGramos[i] != null) };
      }));
      setIngEditandoIdx(null);
    });
  }, [receta?.nombre, initialRaciones, dateKey]);

  const parsearCantidad = (s: string): number => {
    const n = Number(s.replace(",", "."));
    return isNaN(n) || n <= 0 ? 0 : n;
  };

  const cambiarRaciones = (delta: number) => {
    if (!receta) return;
    const nuevo = Math.max(0.25, Math.round((racionesAnadir + delta) * 4) / 4);
    setRacionesAnadir(nuevo);
    const factor = nuevo / racionesBase;
    setIngModifs(prev =>
      (receta.ingredientes ?? []).map((ing, i) => ({
        gramos: prev[i]?.pinned ? prev[i].gramos : Math.round(ing.gramos * factor),
        pinned: prev[i]?.pinned ?? false,
      }))
    );
  };

  const confirmarGramos = (idx: number) => {
    const g = Math.max(1, Math.round(parsearCantidad(ingEditandoGramos) || 1));
    setIngModifs(prev => prev.map((m, i) => i === idx ? { gramos: g, pinned: true } : m));
    setIngEditandoIdx(null);
  };

  const desanclar = (idx: number) => {
    if (!receta) return;
    const factor = racionesAnadir / racionesBase;
    const gramosBase = receta.ingredientes[idx]?.gramos ?? 0;
    setIngModifs(prev => prev.map((m, i) => i === idx ? { gramos: Math.round(gramosBase * factor), pinned: false } : m));
  };

  if (!receta) return null;

  const estaModif = ingModifs.some(m => m.pinned);
  const totalesModif = (receta.ingredientes ?? []).reduce((acc, ing, i) => {
    const g = ingModifs[i]?.gramos ?? ing.gramos;
    const f = ing.gramos > 0 ? g / ing.gramos : 0;
    return { kcal: acc.kcal + safeNum(ing.calorias)*f, prot: acc.prot + safeNum(ing.proteinas)*f, carb: acc.carb + safeNum(ing.carbs)*f, gras: acc.gras + safeNum(ing.grasas)*f };
  }, { kcal: 0, prot: 0, carb: 0, gras: 0 });

  const handleAdd = async (useModified: boolean) => {
    // Commit any in-progress gram edit before computing totals
    const effectiveModifs = ingEditandoIdx !== null
      ? ingModifs.map((m, i) => i === ingEditandoIdx
          ? { gramos: Math.max(1, Math.round(parsearCantidad(ingEditandoGramos) || 1)), pinned: true }
          : m)
      : ingModifs;

    const suffix = racionesAnadir !== racionesBase
      ? ` (×${racionesAnadir % 1 === 0 ? racionesAnadir : racionesAnadir.toFixed(2).replace(/\.?0+$/, "")})`
      : "";
    let kcal: number, prot: number, carb: number, gras: number;
    const hasAnyModif = effectiveModifs.some(m => m.pinned);
    if (useModified || hasAnyModif) {
      const modTotals = (receta.ingredientes ?? []).reduce((acc, ing, i) => {
        const g = effectiveModifs[i]?.gramos ?? ing.gramos;
        const f = ing.gramos > 0 ? g / ing.gramos : 0;
        return { kcal: acc.kcal + safeNum(ing.calorias)*f, prot: acc.prot + safeNum(ing.proteinas)*f, carb: acc.carb + safeNum(ing.carbs)*f, gras: acc.gras + safeNum(ing.grasas)*f };
      }, { kcal: 0, prot: 0, carb: 0, gras: 0 });
      kcal = Math.round(modTotals.kcal);
      prot = Number(modTotals.prot.toFixed(1));
      carb = Number(modTotals.carb.toFixed(1));
      gras = Number(modTotals.gras.toFixed(1));
    } else {
      const factor = racionesAnadir / racionesBase;
      const orig = (receta.ingredientes ?? []).reduce((acc, ing) => ({
        kcal: acc.kcal + safeNum(ing.calorias) * factor,
        prot: acc.prot + safeNum(ing.proteinas) * factor,
        carb: acc.carb + safeNum(ing.carbs) * factor,
        gras: acc.gras + safeNum(ing.grasas) * factor,
      }), { kcal: 0, prot: 0, carb: 0, gras: 0 });
      kcal = Math.round(orig.kcal);
      prot = Number(orig.prot.toFixed(1));
      carb = Number(orig.carb.toFixed(1));
      gras = Number(orig.gras.toFixed(1));
    }
    const hayModif = useModified && effectiveModifs.some(m => m.pinned);
    const gramosGuardar = hayModif ? effectiveModifs.map(m => m.gramos) : undefined;
    // Persistir o borrar gramos modificados (scoped por fecha+nombre si hay dateKey)
    try {
      const vGramos = await AsyncStorage.getItem("nutri_receta_gramos");
      let mapGramos: Record<string, number[]> = {};
      try { if (vGramos) mapGramos = JSON.parse(vGramos); } catch {}
      const gramosKey = dateKey ? `${dateKey}::${receta.nombre}` : receta.nombre;
      if (hayModif) {
        mapGramos[gramosKey] = effectiveModifs.map(m => m.gramos);
      } else {
        delete mapGramos[gramosKey];
      }
      await AsyncStorage.setItem("nutri_receta_gramos", JSON.stringify(mapGramos));
    } catch {}
    try {
      await onAdd(kcal, prot, carb, gras, receta.nombre + suffix, mealSel, racionesAnadir, gramosGuardar);
      onClose();
    } catch {
      // onAdd falló — no cerrar el modal para que el usuario pueda reintentar
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { setIngEditandoIdx(null); onClose(); }}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: "#000000AA", justifyContent: "center", alignItems: "center", padding: 20 }}
        activeOpacity={1} onPress={() => { setIngEditandoIdx(null); onClose(); }}>
        <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.card, borderRadius: 24, width: "100%", maxHeight: "90%", borderWidth: 1, borderColor: colors.cardBorder, overflow: "hidden" }}>
          {/* Cabecera + selector de raciones */}
          <View style={{ padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800", flex: 1 }} numberOfLines={2}>{receta.nombre}</Text>
              {estaModif && (
                <View style={{ backgroundColor: "#F59E0B22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#F59E0B55" }}>
                  <Text style={{ color: "#F59E0B", fontSize: 10, fontWeight: "700" }}>MODIFICADA</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
              <Text style={{ color: colors.textSub, fontSize: 13 }}>{t.servingsToAdd ?? "Raciones"}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <TouchableOpacity onPress={() => cambiarRaciones(-0.5)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inputBg, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: colors.text, fontSize: 18 }}>−</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, minWidth: 32, textAlign: "center" }}>
                  {racionesAnadir % 1 === 0 ? racionesAnadir : racionesAnadir.toFixed(2).replace(/\.?0+$/, "")}
                </Text>
                <TouchableOpacity onPress={() => cambiarRaciones(0.5)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "#1F6FEB", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontSize: 18 }}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Lista de ingredientes */}
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
            <View style={{ padding: 14, gap: 6 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Ingredientes</Text>
              {(receta.ingredientes ?? []).map((ing, i) => {
                const modif = ingModifs[i];
                const gramosActuales = modif?.gramos ?? ing.gramos;
                const isPinned = modif?.pinned ?? false;
                const isEditing = ingEditandoIdx === i;
                const macroIng = ing.gramos > 0 ? { kcal: Math.round(safeNum(ing.calorias) * gramosActuales / ing.gramos) } : { kcal: 0 };
                return (
                  <View key={i} style={{ backgroundColor: isPinned ? "#F59E0B11" : colors.bg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: isPinned ? "#F59E0B44" : colors.cardBorder }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 }} numberOfLines={1}>{ing.nombre}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {isPinned && (
                          <TouchableOpacity onPress={() => desanclar(i)} style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "#F59E0B22", borderRadius: 6 }}>
                            <Text style={{ color: "#F59E0B", fontSize: 10, fontWeight: "700" }}>✕ fijado</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => { setIngEditandoIdx(i); setIngEditandoGramos(String(gramosActuales)); }}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.inputBg, borderRadius: 8, borderWidth: 1, borderColor: isEditing ? "#1F6FEB" : colors.cardBorder }}>
                          <Text style={{ color: isEditing ? "#58A6FF" : colors.textSub, fontSize: 13, fontWeight: "700" }}>{gramosActuales}{ing.unidad ?? "g"}</Text>
                        </TouchableOpacity>
                        <Text style={{ color: colors.textMuted, fontSize: 11 }}>{macroIng.kcal}kcal</Text>
                      </View>
                    </View>
                    {isEditing && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <TextInput
                          style={{ flex: 1, backgroundColor: colors.card, borderRadius: 8, borderWidth: 1.5, borderColor: "#1F6FEB", color: colors.text, fontSize: 16, fontWeight: "700", padding: 8, textAlign: "center" }}
                          value={ingEditandoGramos} onChangeText={v => setIngEditandoGramos(v.replace(",", ".").replace(/[^0-9.]/g, ""))}
                          keyboardType="decimal-pad" selectTextOnFocus autoFocus
                          onSubmitEditing={() => confirmarGramos(i)}
                        />
                        <Text style={{ color: colors.textMuted, fontSize: 13 }}>{ing.unidad ?? "g"}</Text>
                        <TouchableOpacity onPress={() => confirmarGramos(i)} style={{ backgroundColor: "#1F6FEB", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>OK</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Totales en tiempo real */}
          <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.cardBorder }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[
                { val: Math.round(totalesModif.kcal), label: "kcal", color: "#4ADE80" },
                { val: totalesModif.prot.toFixed(1) + "g", label: t.proteins, color: "#60A5FA" },
                { val: totalesModif.carb.toFixed(1) + "g", label: t.carbs, color: "#FBBF24" },
                { val: totalesModif.gras.toFixed(1) + "g", label: t.fats, color: "#F87171" },
              ].map(item => (
                <View key={item.label} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 8, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder }}>
                  <Text style={{ color: item.color, fontSize: 13, fontWeight: "800" }}>{item.val}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 9, marginTop: 1 }}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Selector de comida */}
          {!hideMealSelector && (
            <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{t.whichMealToAdd}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(["desayuno", "comida", "merienda", "cena"] as MealKey[]).map(m => (
                  <TouchableOpacity key={m}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: mealSel === m ? "#1F6FEB22" : colors.bg, borderWidth: 1, borderColor: mealSel === m ? "#58A6FF" : colors.cardBorder }}
                    onPress={() => setMealSel(m)}>
                    <Text style={{ fontSize: 14 }}>{MEAL_ICONS[m]}</Text>
                    <Text style={{ color: mealSel === m ? "#58A6FF" : colors.textMuted, fontSize: 13, fontWeight: "700" }}>{MEAL_LABELS[m]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Botones */}
          {estaModif ? (
            <View style={{ gap: 8, paddingHorizontal: 14, paddingBottom: 16 }}>
              <View style={{ backgroundColor: "#FBBF2422", borderRadius: 10, borderWidth: 1, borderColor: "#FBBF2444", paddingVertical: 7, paddingHorizontal: 12 }}>
                <Text style={{ color: "#FBBF24", fontSize: 12, fontWeight: "600", textAlign: "center" }}>Has modificado ingredientes. ¿Qué versión añadir?</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 12, alignItems: "center" }} onPress={() => handleAdd(false)}>
                  <Text style={{ color: colors.textSub, fontWeight: "700", fontSize: 13 }}>Original</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, backgroundColor: "#1F6FEB", borderRadius: 12, padding: 12, alignItems: "center" }} onPress={() => handleAdd(true)}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Modificada ✓</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={{ backgroundColor: colors.inputBg, borderRadius: 12, padding: 12, alignItems: "center" }} onPress={onClose}>
                <Text style={{ color: colors.textMuted, fontWeight: "600", fontSize: 14 }}>{t.cancel}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingBottom: 16 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: colors.inputBg, borderRadius: 12, padding: 14, alignItems: "center" }} onPress={onClose}>
                <Text style={{ color: colors.textSub, fontWeight: "700", fontSize: 15 }}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: "#1F6FEB", borderRadius: 12, padding: 14, alignItems: "center" }} onPress={() => handleAdd(false)}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{hideMealSelector ? (t.save ?? "Guardar") : t.add}</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
