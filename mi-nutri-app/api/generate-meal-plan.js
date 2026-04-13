// POST /api/generate-meal-plan
// Generates ONE day of a meal plan (call 7 times for a full week)

import { createClient } from "@supabase/supabase-js";

export const maxDuration = 15;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const rateBuckets = new Map();
function checkRate(uid) {
  const now = Date.now();
  const bucket = rateBuckets.get(uid) ?? [];
  const recent = bucket.filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return false;
  recent.push(now);
  rateBuckets.set(uid, recent);
  return true;
}

async function verifyAuth(req) {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return null;
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await sb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  let uid = "anonymous";
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    uid = await verifyAuth(req) || "anonymous";
  }
  if (!checkRate(uid)) return res.status(429).json({ error: "Too many requests" });

  const {
    weight, height, age, sex, activity, goal,
    mealFrequency, allergies, cuisine, restriction,
    budget, cookingTime, language,
    calorieGoal, proteinGoal, carbsGoal, fatGoal,
    dayName, dayIndex,
  } = req.body;

  const w = Number(weight), h = Number(height), a = Number(age);
  if (!w || w < 20 || w > 300) return res.status(400).json({ error: "Invalid weight" });
  if (!h || h < 100 || h > 250) return res.status(400).json({ error: "Invalid height" });
  if (!a || a < 10 || a > 100) return res.status(400).json({ error: "Invalid age" });

  let slots;
  if (typeof mealFrequency === "string" && mealFrequency.includes(",")) {
    slots = mealFrequency.split(",");
  } else {
    const FREQ = { "2": ["comida","cena"], "3": ["desayuno","comida","cena"], "4": ["desayuno","comida","merienda","cena"], "5": ["desayuno","snack1","comida","merienda","cena"], "6": ["desayuno","snack1","comida","merienda","cena","snack2"] };
    slots = FREQ[mealFrequency] || FREQ["4"];
  }

  const LANGS = { es:"Spanish", en:"English", fr:"French", de:"German", zh:"Chinese", pt:"Portuguese", it:"Italian" };
  const langName = LANGS[language] || "Spanish";
  const day = dayName || "Lunes";

  const prompt = `Generate a meal plan for ONE day (${day}).
Profile: ${w}kg, ${h}cm, ${a}yo, ${sex}, ${activity}, goal:${goal}
Targets: ${calorieGoal||2000}kcal, ${proteinGoal||150}g P, ${carbsGoal||250}g C, ${fatGoal||65}g F
Allergies: ${allergies?.length ? allergies.join(",") : "none"}
Diet: ${restriction||"none"}, Cuisine: ${cuisine||"mixed"}, Budget: ${budget||"medium"}, Time: ${cookingTime||"medium"}
Meals: ${slots.join(", ")}

Each meal: name, ingredients(name,grams,kcal,protein,carbs,fat), totals, 2 alternative meals.
ALL text in ${langName}. ONLY valid JSON, no markdown:
{"day":"${day}","meals":{"${slots[0]}":{"name":"...","ingredients":[{"name":"...","grams":100,"kcal":200,"protein":20,"carbs":25,"fat":8,"alternatives":[{"name":"...","grams":100,"kcal":195,"protein":19,"carbs":26,"fat":7}]}],"totals":{"kcal":400,"protein":35,"carbs":45,"fat":15},"alternatives":[{"name":"...","ingredients":[{"name":"...","grams":100,"kcal":200,"protein":20,"carbs":25,"fat":8,"alternatives":[]}],"totals":{"kcal":395,"protein":34,"carbs":46,"fat":14}}]}},"dayTotals":{"kcal":2000,"protein":150,"carbs":250,"fat":65}}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 3000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) {
        if (attempt < 1) continue;
        const status = response.status;
        if (status === 529 || status === 503) return res.status(503).json({ error: "El servicio de IA está saturado. Inténtalo de nuevo en unos minutos." });
        if (status === 402) return res.status(402).json({ error: "Créditos de IA agotados." });
        return res.status(500).json({ error: "Error al generar el plan. Inténtalo de nuevo." });
      }
      const data = await response.json();
      const text = data.content?.[0]?.text ?? "";
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const dayPlan = JSON.parse(jsonStr);
      return res.status(200).json(dayPlan);
    } catch (e) {
      if (attempt < 1) continue;
      return res.status(500).json({ error: "Failed to generate" });
    }
  }
}
