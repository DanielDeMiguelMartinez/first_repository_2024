// POST /api/generate-meal-plan
// Generates a personalized weekly meal plan using Claude API

import { createClient } from "@supabase/supabase-js";

const RATE_WINDOW_MS = 300_000; // 5 min
const RATE_MAX = 3; // 3 plans per 5 min
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

  // Auth (optional if SUPABASE_URL not configured)
  let uid = "anonymous";
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    uid = await verifyAuth(req) || "anonymous";
  }

  // Rate limit
  if (!checkRate(uid)) return res.status(429).json({ error: "Too many requests. Wait 5 minutes." });

  const {
    weight, height, age, sex, activity, goal,
    mealFrequency, allergies, cuisine, restriction,
    budget, cookingTime, language,
    calorieGoal, proteinGoal, carbsGoal, fatGoal,
  } = req.body;

  // Input validation
  const w = Number(weight), h = Number(height), a = Number(age);
  if (!w || w < 20 || w > 300) return res.status(400).json({ error: "Invalid weight" });
  if (!h || h < 100 || h > 250) return res.status(400).json({ error: "Invalid height" });
  if (!a || a < 10 || a > 100) return res.status(400).json({ error: "Invalid age" });

  // Map meal frequency to slot names
  let slots;
  if (typeof mealFrequency === "string" && mealFrequency.includes(",")) {
    slots = mealFrequency.split(",");
  } else {
    const FREQ_SLOTS = {
      "2": ["comida", "cena"],
      "3": ["desayuno", "comida", "cena"],
      "4": ["desayuno", "comida", "merienda", "cena"],
      "5": ["desayuno", "snack1", "comida", "merienda", "cena"],
      "6": ["desayuno", "snack1", "comida", "merienda", "cena", "snack2"],
    };
    slots = FREQ_SLOTS[mealFrequency] || FREQ_SLOTS["4"];
  }

  const LANG_NAMES = {
    es: "Spanish", en: "English", fr: "French", de: "German", zh: "Chinese",
    pt: "Portuguese", it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian",
  };
  const langName = LANG_NAMES[language] || "Spanish";

  const DAY_NAMES = {
    es: ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"],
    en: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
  };
  const days = DAY_NAMES[language] || DAY_NAMES.es;

  const prompt = `You are a professional nutritionist. Generate a complete 7-day meal plan.

USER PROFILE:
- Weight: ${w} kg, Height: ${h} cm, Age: ${a}, Sex: ${sex}
- Activity level: ${activity}
- Goal: ${goal}
- Daily targets: ${calorieGoal || 2000} kcal, ${proteinGoal || 150}g protein, ${carbsGoal || 250}g carbs, ${fatGoal || 65}g fat
- Allergies: ${allergies?.length ? allergies.join(", ") : "none"}
- Dietary restriction: ${restriction || "none"}
- Cuisine preference: ${cuisine || "mixed"}
- Budget: ${budget || "medium"}
- Cooking time: ${cookingTime || "medium"}
- Meal slots per day: ${slots.join(", ")}

Generate 7 days (${days.join(", ")}). Each meal needs name, ingredients with grams and macros, 2 alternative meals with similar macros, and 2 alternative ingredients per ingredient.
ALL text in ${langName}. Distribute calories logically across meals.

RESPOND WITH ONLY VALID JSON:
{"days":[{"day":"${days[0]}","meals":{"${slots[0]}":{"name":"...","ingredients":[{"name":"...","grams":150,"kcal":200,"protein":25,"carbs":10,"fat":8,"alternatives":[{"name":"...","grams":140,"kcal":195,"protein":24,"carbs":11,"fat":7},{"name":"...","grams":160,"kcal":205,"protein":26,"carbs":9,"fat":9}]}],"totals":{"kcal":450,"protein":35,"carbs":40,"fat":18},"alternatives":[{"name":"...","ingredients":[...],"totals":{...}},{"name":"...","ingredients":[...],"totals":{...}}]}},"dayTotals":{"kcal":2000,"protein":150,"carbs":250,"fat":65}}]}`;

  // Retry up to 2 times
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        if (attempt < 1) continue;
        return res.status(response.status).json({ error: "API error" });
      }

      const data = await response.json();
      const text = data.content?.[0]?.text ?? "";
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const plan = JSON.parse(jsonStr);

      if (!plan.days || !Array.isArray(plan.days) || plan.days.length < 7) {
        if (attempt < 1) continue;
        return res.status(500).json({ error: "Invalid plan structure" });
      }

      return res.status(200).json(plan);
    } catch (e) {
      if (attempt < 1) continue;
      return res.status(500).json({ error: "Failed to generate plan" });
    }
  }
}
