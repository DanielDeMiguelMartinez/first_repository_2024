import { useApp } from "@/app/services/i18n";
import { signalMealSaved } from "@/app/services/refreshSignal";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
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

type MealKey = "desayuno" | "comida" | "merienda" | "cena";

function getTodayKey(): string {
  const d = new Date();
  return `nutri_meals_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EditFoodScreen() {
  const { colors, theme } = useApp();
  const { meal, foodId, foodData, storageKey: storageKeyParam } = useLocalSearchParams<{
    meal: MealKey;
    foodId: string;
    foodData: string;
    storageKey?: string;
  }>();
  const router = useRouter();
  const food = JSON.parse(foodData || "{}");

  // Clave de almacenamiento: viene del param o es la de hoy
  const targetKey = storageKeyParam || getTodayKey();

  const [gramos, setGramos] = useState("100");
  const [guardado, setGuardado] = useState(false);

  // Nutrientes por 100 g: usamos food.per100 si existe, si no recalculamos
  const per100 = food.per100 ?? null;
  const kcalPer1g   = per100 ? per100.calories / 100    : food.calories / 100;
  const protPer1g   = per100 ? per100.protein / 100     : food.protein / 100;
  const carbsPer1g  = per100 ? per100.carbs / 100       : food.carbs / 100;
  const fatPer1g    = per100 ? per100.fat / 100         : food.fat / 100;
  const satFatPer1g = per100 ? per100.saturatedFat / 100 : (food.saturatedFat || 0) / 100;
  const sugarPer1g  = per100 ? per100.sugar / 100       : (food.sugar || 0) / 100;
  const fiberPer1g  = per100 ? per100.fiber / 100       : (food.fiber || 0) / 100;
  const saltPer1g   = per100 ? per100.salt / 100        : (food.salt || 0) / 100;

  const g = Number(gramos) || 0;
  const newCalories  = Math.round(kcalPer1g * g);
  const newProtein   = (protPer1g * g).toFixed(1);
  const newCarbs     = (carbsPer1g * g).toFixed(1);
  const newFat       = (fatPer1g * g).toFixed(1);
  const newSatFat    = (satFatPer1g * g).toFixed(1);
  const newSugar     = (sugarPer1g * g).toFixed(1);
  const newFiber     = (fiberPer1g * g).toFixed(1);
  const newSalt      = (saltPer1g * g).toFixed(3);

  const guardar = async () => {
    try {
      const stored = await AsyncStorage.getItem(targetKey);
      const meals = stored
        ? JSON.parse(stored)
        : { desayuno: [], comida: [], merienda: [], cena: [] };

      meals[meal] = meals[meal].map((f: any) =>
        f.id === foodId
          ? {
              ...f,
              calories: newCalories,
              protein: Number(newProtein),
              carbs: Number(newCarbs),
              fat: Number(newFat),
              saturatedFat: Number(newSatFat),
              sugar: Number(newSugar),
              fiber: Number(newFiber),
              salt: Number(newSalt),
            }
          : f
      );

      await AsyncStorage.setItem(targetKey, JSON.stringify(meals));
      signalMealSaved(meals, targetKey);
      setGuardado(true);
      setTimeout(() => router.back(), 600);
    } catch {
      Alert.alert("Error", "No se pudo guardar.");
    }
  };

  const bg    = colors.bg;
  const card  = colors.card;
  const text  = colors.text;
  const muted = colors.textMuted;
  const sub   = colors.textSub;
  const border = colors.cardBorder;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: bg }]}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={bg} />
      <ScrollView style={[s.scroll, { backgroundColor: bg }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={[s.back, { color: "#58A6FF" }]}>← Volver</Text>
          </TouchableOpacity>
          <Text style={[s.title, { color: text }]}>Editar alimento</Text>
          <Text style={[s.subtitle, { color: muted }]}>{food.name}</Text>
        </View>

        <View style={[s.card, { backgroundColor: card, borderColor: border }]}>
          <View style={s.gramosRow}>
            <Text style={[s.gramosLabel, { color: sub }]}>Cantidad (g)</Text>
            <TextInput
              style={[s.gramosInput, { backgroundColor: bg, borderColor: border, color: text }]}
              value={gramos}
              onChangeText={setGramos}
              keyboardType="numeric"
              selectTextOnFocus
            />
          </View>

          <View style={s.macrosGrid}>
            <View style={[s.macroBox, { borderColor: "#4ADE8033" }]}>
              <Text style={[s.macroVal, { color: "#4ADE80" }]}>{newCalories}</Text>
              <Text style={[s.macroLabel, { color: muted }]}>kcal</Text>
            </View>
            <View style={[s.macroBox, { borderColor: "#60A5FA33" }]}>
              <Text style={[s.macroVal, { color: "#60A5FA" }]}>{newProtein}g</Text>
              <Text style={[s.macroLabel, { color: muted }]}>Proteínas</Text>
            </View>
            <View style={[s.macroBox, { borderColor: "#FBBF2433" }]}>
              <Text style={[s.macroVal, { color: "#FBBF24" }]}>{newCarbs}g</Text>
              <Text style={[s.macroLabel, { color: muted }]}>Carbos</Text>
            </View>
            <View style={[s.macroBox, { borderColor: "#F8717133" }]}>
              <Text style={[s.macroVal, { color: "#F87171" }]}>{newFat}g</Text>
              <Text style={[s.macroLabel, { color: muted }]}>Grasas</Text>
            </View>
          </View>

          <View style={s.macrosGrid}>
            <View style={[s.macroBox, { borderColor: "#F8717122" }]}>
              <Text style={[s.macroVal, s.macroValSm, { color: "#FCA5A5" }]}>{newSatFat}g</Text>
              <Text style={[s.macroLabel, { color: muted }]}>G. Saturadas</Text>
            </View>
            <View style={[s.macroBox, { borderColor: "#FBBF2422" }]}>
              <Text style={[s.macroVal, s.macroValSm, { color: "#FDE68A" }]}>{newSugar}g</Text>
              <Text style={[s.macroLabel, { color: muted }]}>Azúcares</Text>
            </View>
            <View style={[s.macroBox, { borderColor: "#34D39933" }]}>
              <Text style={[s.macroVal, s.macroValSm, { color: "#6EE7B7" }]}>{newFiber}g</Text>
              <Text style={[s.macroLabel, { color: muted }]}>Fibra</Text>
            </View>
            <View style={[s.macroBox, { borderColor: "#94A3B833" }]}>
              <Text style={[s.macroVal, s.macroValSm, { color: "#CBD5E1" }]}>{newSalt}g</Text>
              <Text style={[s.macroLabel, { color: muted }]}>Sal</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[s.saveBtn, guardado && s.saveBtnDone]}
            onPress={guardar}
            disabled={guardado}
          >
            <Text style={s.saveBtnText}>
              {guardado ? "✓ Guardado" : "Guardar cambios"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1 },
  scroll:     { flex: 1, paddingHorizontal: 16 },
  header:     { paddingTop: 16, paddingBottom: 8, gap: 4 },
  back:       { fontSize: 14, marginBottom: 4 },
  title:      { fontSize: 26, fontWeight: "800" },
  subtitle:   { fontSize: 14 },
  card: {
    borderRadius: 20, padding: 18,
    marginTop: 16, borderWidth: 1, gap: 16,
  },
  gramosRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  gramosLabel: { fontSize: 15 },
  gramosInput: {
    borderWidth: 1, borderRadius: 10, padding: 10,
    fontSize: 20, fontWeight: "700", width: 100, textAlign: "center",
  },
  macrosGrid: { flexDirection: "row", gap: 8 },
  macroBox: {
    flex: 1, borderRadius: 12, padding: 10,
    alignItems: "center", borderWidth: 1,
  },
  macroVal:    { fontSize: 17, fontWeight: "800" },
  macroValSm:  { fontSize: 14 },
  macroLabel:  { fontSize: 9, marginTop: 2, textAlign: "center" },
  saveBtn:     { backgroundColor: "#1F6FEB", borderRadius: 14, padding: 16, alignItems: "center" },
  saveBtnDone: { backgroundColor: "#166534" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
