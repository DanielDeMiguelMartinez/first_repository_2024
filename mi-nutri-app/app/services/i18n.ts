import { createContext, useContext } from "react";

export type Language = "es" | "en" | "fr" | "de" | "zh";
export type Theme = "dark" | "light";

export const LANGUAGE_KEY = "nutri_language";
export const THEME_KEY = "nutri_theme";

export const LANGUAGE_NAMES: Record<Language, string> = {
  es: "Español", en: "English", fr: "Français", de: "Deutsch", zh: "中文",
};

export const LANGUAGE_FLAGS: Record<Language, string> = {
  es: "🇪🇸", en: "🇬🇧", fr: "🇫🇷", de: "🇩🇪", zh: "🇨🇳",
};

type Translations = {
  settings: string; back: string; save: string; cancel: string;
  delete: string; confirm: string; close: string;
  today: string; yesterday: string; tomorrow: string;
  myNutrition: string; recipes: string; createFood: string;
  returnToday: string; caloriesConsumed: string;
  caloriesLeft: string; caloriesOver: string; goal: string;
  proteins: string; carbs: string; fats: string;
  mealsOfDay: string; breakfast: string; lunch: string;
  snack: string; dinner: string; addFood: string;
  noFoodsRegistered: string; deleteFood: string;
  deleteFoodConfirm: string; editGoal: string;
  dailyGoals: string; manual: string;
  calculateWithAI: string; editGoalsManually: string;
  calories: string; perDay: string; saveGoals: string;
  aiWillCalculate: string; bodyPhoto: string; optional: string;
  photoHelps: string; camera: string; gallery: string; removePhoto: string;
  personalData: string; weight: string; height: string; age: string;
  sex: string; male: string; female: string;
  activityLevel: string; sedentary: string; light: string;
  moderate: string; active: string; veryActive: string;
  noExercise: string; days12: string; days35: string;
  days67: string; twiceDay: string; objective: string;
  loseFat: string; maintain: string; gainMuscle: string;
  calculating: string; calculateGoals: string;
  personalizedRec: string; applyGoals: string;
  incompleteData: string; incompleteDataMsg: string;
  goToToday: string; addFoodTitle: string; byName: string;
  byCode: string; searchPlaceholder: string;
  searchingStores: string; barcodeScanner: string;
  scanWithCamera: string; recentFoods: string;
  favorites: string; swipeToFav: string;
  noRecentFoods: string; noFavorites: string;
  deleteRecents: string; noResults: string;
  createThisFood: string; addFromRecipes: string;
  cantFind: string; quantity: string;
  packageWeight: string; perManufacturer: string;
  changeManually: string; usePackageWeight: string;
  whole: string; removePackage: string; addTo: string;
  savingFood: string; saved: string; notFound: string;
  productNotFound: string; errorSaving: string;
  settingsTitle: string; language: string; theme: string;
  darkTheme: string; lightTheme: string; chooseLanguage: string;
  chooseTheme: string; appearance: string; savedSettings: string;
};

const ES: Translations = {
  settings: "Ajustes", back: "← Volver", save: "Guardar", cancel: "Cancelar",
  delete: "Eliminar", confirm: "Confirmar", close: "✕ Cerrar",
  today: "Hoy", yesterday: "Ayer", tomorrow: "Mañana",
  myNutrition: "Tu día nutricional", recipes: "Recetas", createFood: "Crear alimento",
  returnToday: "Volver a hoy →", caloriesConsumed: "kcal consumidas",
  caloriesLeft: "restantes", caloriesOver: "excedidas", goal: "Objetivo",
  proteins: "Proteínas", carbs: "Carbos", fats: "Grasas",
  mealsOfDay: "Comidas del día", breakfast: "Desayuno", lunch: "Comida",
  snack: "Merienda", dinner: "Cena", addFood: "+ Añadir",
  noFoodsRegistered: "Sin alimentos registrados", deleteFood: "Eliminar",
  deleteFoodConfirm: "¿Eliminar este alimento?", editGoal: "✏️ Editar objetivo",
  dailyGoals: "🎯 Objetivos diarios", manual: "✏️ Manual",
  calculateWithAI: "🤖 Calcular con IA", editGoalsManually: "Edita tus metas nutricionales manualmente",
  calories: "Calorías", perDay: "g/día", saveGoals: "Guardar objetivos",
  aiWillCalculate: "La IA calculará tus calorías y macros según tus datos",
  bodyPhoto: "📸 Foto del físico", optional: "(opcional)",
  photoHelps: "Si incluyes una foto, la IA podrá estimar tu composición corporal.",
  camera: "Cámara", gallery: "Galería", removePhoto: "✕ Quitar foto",
  personalData: "📊 Datos personales", weight: "Peso (kg)", height: "Altura (cm)", age: "Edad",
  sex: "⚧ Sexo", male: "♂ Hombre", female: "♀ Mujer",
  activityLevel: "🏃 Nivel de actividad", sedentary: "Sedentario", light: "Ligero",
  moderate: "Moderado", active: "Activo", veryActive: "Muy activo",
  noExercise: "Sin ejercicio", days12: "1-2 días/sem", days35: "3-5 días/sem",
  days67: "6-7 días/sem", twiceDay: "2x día", objective: "🎯 Objetivo",
  loseFat: "⬇️ Perder grasa", maintain: "⚖️ Mantener", gainMuscle: "⬆️ Ganar músculo",
  calculating: "Analizando datos...", calculateGoals: "🤖 Calcular mis objetivos con IA",
  personalizedRec: "✨ Recomendación personalizada", applyGoals: "✓ Aplicar estos objetivos",
  incompleteData: "Datos incompletos", incompleteDataMsg: "Introduce peso, altura y edad para continuar.",
  goToToday: "Ir a hoy", addFoodTitle: "Añadir alimento", byName: "🔍 Por nombre",
  byCode: "📷 Por código", searchPlaceholder: "Manzana, pollo, arroz...",
  searchingStores: "Buscando en tiendas...", barcodeScanner: "📷 Escanear código de barras",
  scanWithCamera: "📷 Escanear con cámara", recentFoods: "⚡ Recientes",
  favorites: "★ Favoritos", swipeToFav: "← Desliza para favoritar",
  noRecentFoods: "Aquí aparecerán los alimentos que busques",
  noFavorites: "Pulsa ☆ o desliza ← en cualquier alimento para guardarlo",
  deleteRecents: "Borrar recientes", noResults: "Sin resultados para",
  createThisFood: "➕ Crear este alimento", addFromRecipes: "🍳 Añadir desde recetas",
  cantFind: "➕ ¿No encuentras lo que buscas? Créalo tú", quantity: "Cantidad (g)",
  packageWeight: "📦 Peso del envase", perManufacturer: "Según el fabricante",
  changeManually: "✏️ Cambiar peso manualmente", usePackageWeight: "📦 Usar peso del envase",
  whole: "Entero", removePackage: "✕ Quitar envase", addTo: "Añadir a",
  savingFood: "Guardando...", saved: "✓ Guardado", notFound: "No encontrado",
  productNotFound: "No se encontró ningún producto con ese código.",
  errorSaving: "No se pudo guardar el alimento.",
  settingsTitle: "Ajustes", language: "Idioma", theme: "Tema",
  darkTheme: "Oscuro", lightTheme: "Claro", chooseLanguage: "Selecciona un idioma",
  chooseTheme: "Selecciona el tema", appearance: "Apariencia",
  savedSettings: "Ajustes guardados",
};

const EN: Translations = {
  settings: "Settings", back: "← Back", save: "Save", cancel: "Cancel",
  delete: "Delete", confirm: "Confirm", close: "✕ Close",
  today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow",
  myNutrition: "Your nutrition day", recipes: "Recipes", createFood: "Create food",
  returnToday: "Back to today →", caloriesConsumed: "kcal consumed",
  caloriesLeft: "remaining", caloriesOver: "exceeded", goal: "Goal",
  proteins: "Proteins", carbs: "Carbs", fats: "Fats",
  mealsOfDay: "Meals of the day", breakfast: "Breakfast", lunch: "Lunch",
  snack: "Snack", dinner: "Dinner", addFood: "+ Add",
  noFoodsRegistered: "No foods registered", deleteFood: "Delete",
  deleteFoodConfirm: "Delete this food?", editGoal: "✏️ Edit goal",
  dailyGoals: "🎯 Daily goals", manual: "✏️ Manual",
  calculateWithAI: "🤖 Calculate with AI", editGoalsManually: "Edit your nutritional goals manually",
  calories: "Calories", perDay: "g/day", saveGoals: "Save goals",
  aiWillCalculate: "AI will calculate your calories and macros based on your data",
  bodyPhoto: "📸 Body photo", optional: "(optional)",
  photoHelps: "If you include a photo, AI can estimate your body composition.",
  camera: "Camera", gallery: "Gallery", removePhoto: "✕ Remove photo",
  personalData: "📊 Personal data", weight: "Weight (kg)", height: "Height (cm)", age: "Age",
  sex: "⚧ Sex", male: "♂ Male", female: "♀ Female",
  activityLevel: "🏃 Activity level", sedentary: "Sedentary", light: "Light",
  moderate: "Moderate", active: "Active", veryActive: "Very active",
  noExercise: "No exercise", days12: "1-2 days/wk", days35: "3-5 days/wk",
  days67: "6-7 days/wk", twiceDay: "2x/day", objective: "🎯 Goal",
  loseFat: "⬇️ Lose fat", maintain: "⚖️ Maintain", gainMuscle: "⬆️ Gain muscle",
  calculating: "Analyzing data...", calculateGoals: "🤖 Calculate my goals with AI",
  personalizedRec: "✨ Personalized recommendation", applyGoals: "✓ Apply these goals",
  incompleteData: "Incomplete data", incompleteDataMsg: "Enter weight, height and age to continue.",
  goToToday: "Go to today", addFoodTitle: "Add food", byName: "🔍 By name",
  byCode: "📷 By code", searchPlaceholder: "Apple, chicken, rice...",
  searchingStores: "Searching stores...", barcodeScanner: "📷 Scan barcode",
  scanWithCamera: "📷 Scan with camera", recentFoods: "⚡ Recent",
  favorites: "★ Favorites", swipeToFav: "← Swipe to favorite",
  noRecentFoods: "Foods you search will appear here",
  noFavorites: "Tap ☆ or swipe ← on any food to save it",
  deleteRecents: "Clear recent", noResults: "No results for",
  createThisFood: "➕ Create this food", addFromRecipes: "🍳 Add from recipes",
  cantFind: "➕ Can't find it? Create it", quantity: "Quantity (g)",
  packageWeight: "📦 Package weight", perManufacturer: "Per manufacturer",
  changeManually: "✏️ Change manually", usePackageWeight: "📦 Use package weight",
  whole: "Whole", removePackage: "✕ Remove package", addTo: "Add to",
  savingFood: "Saving...", saved: "✓ Saved", notFound: "Not found",
  productNotFound: "No product found with that code.",
  errorSaving: "Could not save the food.",
  settingsTitle: "Settings", language: "Language", theme: "Theme",
  darkTheme: "Dark", lightTheme: "Light", chooseLanguage: "Select a language",
  chooseTheme: "Select theme", appearance: "Appearance",
  savedSettings: "Settings saved",
};

const FR: Translations = {
  settings: "Paramètres", back: "← Retour", save: "Sauvegarder", cancel: "Annuler",
  delete: "Supprimer", confirm: "Confirmer", close: "✕ Fermer",
  today: "Aujourd'hui", yesterday: "Hier", tomorrow: "Demain",
  myNutrition: "Ta journée nutritionnelle", recipes: "Recettes", createFood: "Créer un aliment",
  returnToday: "Retour à aujourd'hui →", caloriesConsumed: "kcal consommées",
  caloriesLeft: "restantes", caloriesOver: "dépassées", goal: "Objectif",
  proteins: "Protéines", carbs: "Glucides", fats: "Lipides",
  mealsOfDay: "Repas du jour", breakfast: "Petit-déjeuner", lunch: "Déjeuner",
  snack: "Collation", dinner: "Dîner", addFood: "+ Ajouter",
  noFoodsRegistered: "Aucun aliment enregistré", deleteFood: "Supprimer",
  deleteFoodConfirm: "Supprimer cet aliment ?", editGoal: "✏️ Modifier l'objectif",
  dailyGoals: "🎯 Objectifs quotidiens", manual: "✏️ Manuel",
  calculateWithAI: "🤖 Calculer avec IA", editGoalsManually: "Modifiez vos objectifs nutritionnels manuellement",
  calories: "Calories", perDay: "g/jour", saveGoals: "Sauvegarder les objectifs",
  aiWillCalculate: "L'IA calculera vos calories et macros selon vos données",
  bodyPhoto: "📸 Photo du physique", optional: "(optionnel)",
  photoHelps: "Avec une photo, l'IA peut estimer votre composition corporelle.",
  camera: "Appareil photo", gallery: "Galerie", removePhoto: "✕ Supprimer la photo",
  personalData: "📊 Données personnelles", weight: "Poids (kg)", height: "Taille (cm)", age: "Âge",
  sex: "⚧ Sexe", male: "♂ Homme", female: "♀ Femme",
  activityLevel: "🏃 Niveau d'activité", sedentary: "Sédentaire", light: "Léger",
  moderate: "Modéré", active: "Actif", veryActive: "Très actif",
  noExercise: "Sans exercice", days12: "1-2 jours/sem", days35: "3-5 jours/sem",
  days67: "6-7 jours/sem", twiceDay: "2x/jour", objective: "🎯 Objectif",
  loseFat: "⬇️ Perdre du gras", maintain: "⚖️ Maintenir", gainMuscle: "⬆️ Prendre du muscle",
  calculating: "Analyse en cours...", calculateGoals: "🤖 Calculer mes objectifs avec IA",
  personalizedRec: "✨ Recommandation personnalisée", applyGoals: "✓ Appliquer ces objectifs",
  incompleteData: "Données incomplètes", incompleteDataMsg: "Entrez poids, taille et âge pour continuer.",
  goToToday: "Aller à aujourd'hui", addFoodTitle: "Ajouter un aliment", byName: "🔍 Par nom",
  byCode: "📷 Par code", searchPlaceholder: "Pomme, poulet, riz...",
  searchingStores: "Recherche en cours...", barcodeScanner: "📷 Scanner le code-barres",
  scanWithCamera: "📷 Scanner avec caméra", recentFoods: "⚡ Récents",
  favorites: "★ Favoris", swipeToFav: "← Glisser pour favoris",
  noRecentFoods: "Les aliments recherchés apparaîtront ici",
  noFavorites: "Appuyez ☆ ou glissez ← pour sauvegarder",
  deleteRecents: "Effacer récents", noResults: "Aucun résultat pour",
  createThisFood: "➕ Créer cet aliment", addFromRecipes: "🍳 Ajouter depuis recettes",
  cantFind: "➕ Vous ne trouvez pas ? Créez-le", quantity: "Quantité (g)",
  packageWeight: "📦 Poids de l'emballage", perManufacturer: "Selon le fabricant",
  changeManually: "✏️ Changer manuellement", usePackageWeight: "📦 Utiliser le poids de l'emballage",
  whole: "Entier", removePackage: "✕ Retirer l'emballage", addTo: "Ajouter à",
  savingFood: "Sauvegarde...", saved: "✓ Sauvegardé", notFound: "Non trouvé",
  productNotFound: "Aucun produit trouvé avec ce code.",
  errorSaving: "Impossible de sauvegarder l'aliment.",
  settingsTitle: "Paramètres", language: "Langue", theme: "Thème",
  darkTheme: "Sombre", lightTheme: "Clair", chooseLanguage: "Sélectionnez une langue",
  chooseTheme: "Sélectionnez le thème", appearance: "Apparence",
  savedSettings: "Paramètres sauvegardés",
};

const DE: Translations = {
  settings: "Einstellungen", back: "← Zurück", save: "Speichern", cancel: "Abbrechen",
  delete: "Löschen", confirm: "Bestätigen", close: "✕ Schließen",
  today: "Heute", yesterday: "Gestern", tomorrow: "Morgen",
  myNutrition: "Dein Ernährungstag", recipes: "Rezepte", createFood: "Lebensmittel erstellen",
  returnToday: "Zurück zu heute →", caloriesConsumed: "kcal konsumiert",
  caloriesLeft: "übrig", caloriesOver: "überschritten", goal: "Ziel",
  proteins: "Proteine", carbs: "Kohlenhydrate", fats: "Fette",
  mealsOfDay: "Mahlzeiten des Tages", breakfast: "Frühstück", lunch: "Mittagessen",
  snack: "Snack", dinner: "Abendessen", addFood: "+ Hinzufügen",
  noFoodsRegistered: "Keine Lebensmittel eingetragen", deleteFood: "Löschen",
  deleteFoodConfirm: "Dieses Lebensmittel löschen?", editGoal: "✏️ Ziel bearbeiten",
  dailyGoals: "🎯 Tagesziele", manual: "✏️ Manuell",
  calculateWithAI: "🤖 Mit KI berechnen", editGoalsManually: "Bearbeite deine Ernährungsziele manuell",
  calories: "Kalorien", perDay: "g/Tag", saveGoals: "Ziele speichern",
  aiWillCalculate: "KI berechnet deine Kalorien und Makros basierend auf deinen Daten",
  bodyPhoto: "📸 Körperfoto", optional: "(optional)",
  photoHelps: "Mit einem Foto kann die KI deine Körperzusammensetzung besser einschätzen.",
  camera: "Kamera", gallery: "Galerie", removePhoto: "✕ Foto entfernen",
  personalData: "📊 Persönliche Daten", weight: "Gewicht (kg)", height: "Größe (cm)", age: "Alter",
  sex: "⚧ Geschlecht", male: "♂ Mann", female: "♀ Frau",
  activityLevel: "🏃 Aktivitätsniveau", sedentary: "Sitzend", light: "Leicht",
  moderate: "Moderat", active: "Aktiv", veryActive: "Sehr aktiv",
  noExercise: "Kein Sport", days12: "1-2 Tage/Wo", days35: "3-5 Tage/Wo",
  days67: "6-7 Tage/Wo", twiceDay: "2x/Tag", objective: "🎯 Ziel",
  loseFat: "⬇️ Fett verlieren", maintain: "⚖️ Halten", gainMuscle: "⬆️ Muskeln aufbauen",
  calculating: "Analysiere Daten...", calculateGoals: "🤖 Meine Ziele mit KI berechnen",
  personalizedRec: "✨ Personalisierte Empfehlung", applyGoals: "✓ Diese Ziele anwenden",
  incompleteData: "Unvollständige Daten", incompleteDataMsg: "Gib Gewicht, Größe und Alter ein.",
  goToToday: "Zu heute", addFoodTitle: "Lebensmittel hinzufügen", byName: "🔍 Nach Name",
  byCode: "📷 Nach Code", searchPlaceholder: "Apfel, Hähnchen, Reis...",
  searchingStores: "Suche in Geschäften...", barcodeScanner: "📷 Barcode scannen",
  scanWithCamera: "📷 Mit Kamera scannen", recentFoods: "⚡ Zuletzt",
  favorites: "★ Favoriten", swipeToFav: "← Wischen zum Favorisieren",
  noRecentFoods: "Gesuchte Lebensmittel erscheinen hier",
  noFavorites: "Tippe ☆ oder wische ← zum Speichern",
  deleteRecents: "Zuletzt löschen", noResults: "Keine Ergebnisse für",
  createThisFood: "➕ Dieses Lebensmittel erstellen", addFromRecipes: "🍳 Aus Rezepten hinzufügen",
  cantFind: "➕ Nicht gefunden? Erstelle es", quantity: "Menge (g)",
  packageWeight: "📦 Packungsgewicht", perManufacturer: "Laut Hersteller",
  changeManually: "✏️ Manuell ändern", usePackageWeight: "📦 Packungsgewicht verwenden",
  whole: "Ganz", removePackage: "✕ Packung entfernen", addTo: "Hinzufügen zu",
  savingFood: "Speichern...", saved: "✓ Gespeichert", notFound: "Nicht gefunden",
  productNotFound: "Kein Produkt mit diesem Code gefunden.",
  errorSaving: "Lebensmittel konnte nicht gespeichert werden.",
  settingsTitle: "Einstellungen", language: "Sprache", theme: "Theme",
  darkTheme: "Dunkel", lightTheme: "Hell", chooseLanguage: "Sprache auswählen",
  chooseTheme: "Theme auswählen", appearance: "Erscheinungsbild",
  savedSettings: "Einstellungen gespeichert",
};

const ZH: Translations = {
  settings: "设置", back: "← 返回", save: "保存", cancel: "取消",
  delete: "删除", confirm: "确认", close: "✕ 关闭",
  today: "今天", yesterday: "昨天", tomorrow: "明天",
  myNutrition: "你的营养日", recipes: "食谱", createFood: "创建食物",
  returnToday: "返回今天 →", caloriesConsumed: "千卡已消耗",
  caloriesLeft: "剩余", caloriesOver: "超出", goal: "目标",
  proteins: "蛋白质", carbs: "碳水", fats: "脂肪",
  mealsOfDay: "今日餐食", breakfast: "早餐", lunch: "午餐",
  snack: "点心", dinner: "晚餐", addFood: "+ 添加",
  noFoodsRegistered: "暂无食物记录", deleteFood: "删除",
  deleteFoodConfirm: "删除这个食物？", editGoal: "✏️ 编辑目标",
  dailyGoals: "🎯 每日目标", manual: "✏️ 手动",
  calculateWithAI: "🤖 用AI计算", editGoalsManually: "手动编辑您的营养目标",
  calories: "卡路里", perDay: "克/天", saveGoals: "保存目标",
  aiWillCalculate: "AI将根据您的数据计算卡路里和宏量营养素",
  bodyPhoto: "📸 体型照片", optional: "（可选）",
  photoHelps: "如果您包含照片，AI可以估计您的身体成分。",
  camera: "相机", gallery: "相册", removePhoto: "✕ 删除照片",
  personalData: "📊 个人数据", weight: "体重 (kg)", height: "身高 (cm)", age: "年龄",
  sex: "⚧ 性别", male: "♂ 男", female: "♀ 女",
  activityLevel: "🏃 活动水平", sedentary: "久坐", light: "轻度",
  moderate: "中度", active: "活跃", veryActive: "非常活跃",
  noExercise: "不运动", days12: "每周1-2天", days35: "每周3-5天",
  days67: "每周6-7天", twiceDay: "每天2次", objective: "🎯 目标",
  loseFat: "⬇️ 减脂", maintain: "⚖️ 维持", gainMuscle: "⬆️ 增肌",
  calculating: "分析数据中...", calculateGoals: "🤖 用AI计算我的目标",
  personalizedRec: "✨ 个性化建议", applyGoals: "✓ 应用这些目标",
  incompleteData: "数据不完整", incompleteDataMsg: "请输入体重、身高和年龄以继续。",
  goToToday: "前往今天", addFoodTitle: "添加食物", byName: "🔍 按名称",
  byCode: "📷 按条码", searchPlaceholder: "苹果、鸡肉、米饭...",
  searchingStores: "正在搜索商店...", barcodeScanner: "📷 扫描条码",
  scanWithCamera: "📷 用相机扫描", recentFoods: "⚡ 最近",
  favorites: "★ 收藏", swipeToFav: "← 左滑收藏",
  noRecentFoods: "搜索过的食物将显示在这里",
  noFavorites: "点击 ☆ 或左滑任意食物以保存",
  deleteRecents: "清除最近", noResults: "没有结果",
  createThisFood: "➕ 创建此食物", addFromRecipes: "🍳 从食谱添加",
  cantFind: "➕ 找不到？自己创建", quantity: "数量 (g)",
  packageWeight: "📦 包装重量", perManufacturer: "按制造商",
  changeManually: "✏️ 手动更改", usePackageWeight: "📦 使用包装重量",
  whole: "整个", removePackage: "✕ 移除包装", addTo: "添加到",
  savingFood: "保存中...", saved: "✓ 已保存", notFound: "未找到",
  productNotFound: "未找到该条码对应的产品。",
  errorSaving: "无法保存食物。",
  settingsTitle: "设置", language: "语言", theme: "主题",
  darkTheme: "深色", lightTheme: "浅色", chooseLanguage: "选择语言",
  chooseTheme: "选择主题", appearance: "外观",
  savedSettings: "设置已保存",
};

export const TRANSLATIONS: Record<Language, Translations> = { es: ES, en: EN, fr: FR, de: DE, zh: ZH };

export type AppContextType = {
  language: Language;
  theme: Theme;
  t: Translations;
  setLanguage: (l: Language) => void;
  setTheme: (t: Theme) => void;
  colors: ColorScheme;
};

export type ColorScheme = {
  bg: string;
  card: string;
  cardBorder: string;
  text: string;
  textSub: string;
  textMuted: string;
  accent: string;
  inputBg: string;
  inputBorder: string;
};

// Paleta oscura refinada: azul noche profundo con tonos más cálidos y contraste mejorado
export const DARK_COLORS: ColorScheme = {
  bg: "#0A0F1A",          // azul noche muy profundo, más rico que gris puro
  card: "#111827",         // azul gris oscuro — más profundidad que antes
  cardBorder: "#1F2937",   // borde sutil con más contraste
  text: "#F1F5F9",         // blanco ligeramente azulado, menos frío que #F9FAFB
  textSub: "#94A3B8",      // azul gris claro — más elegante que gris puro
  textMuted: "#475569",    // azul gris medio
  accent: "#60A5FA",       // azul eléctrico más vibrante
  inputBg: "#0F172A",      // azul noche para inputs
  inputBorder: "#1E293B",  // borde input con más definición
};

// Paleta clara: blanco puro + gris cálido + marrón sutil — limpia y minimalista
// Paleta clara: blanco cálido + marrón stone más marcado + grises cálidos
export const LIGHT_COLORS: ColorScheme = {
  bg: "#F7F4F0",          // blanco cálido beige sutil
  card: "#FFFFFF",         // blanco puro para tarjetas
  cardBorder: "#E2DDD6",   // borde marrón stone más visible
  text: "#1C1917",         // casi negro cálido stone-900
  textSub: "#57534E",      // marrón stone-600 más oscuro y con más carácter
  textMuted: "#A8A29E",    // gris marrón claro stone-400
  accent: "#1F6FEB",       // azul de acción
  inputBg: "#F0EDE8",      // fondo input marrón muy suave
  inputBorder: "#CCC5BB",  // borde input marrón stone más definido
};

export const AppContext = createContext<AppContextType>({
  language: "es", theme: "dark",
  t: ES, setLanguage: () => {}, setTheme: () => {},
  colors: DARK_COLORS,
});

export const useApp = () => useContext(AppContext);