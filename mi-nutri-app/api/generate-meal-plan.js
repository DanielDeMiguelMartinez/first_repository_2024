// POST /api/generate-meal-plan
// Generates a personalized weekly meal plan using Claude API
// Body: { weight, height, age, sex, activity, goal, mealFrequency, allergies[], cuisine, restriction, budget, cookingTime, language }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const {
    weight, height, age, sex, activity, goal,
    mealFrequency, allergies, cuisine, restriction,
    budget, cookingTime, language,
    calorieGoal, proteinGoal, carbsGoal, fatGoal,
  } = req.body;

  if (!weight || !height || !age) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Map meal frequency to meal slot names
  const FREQ_SLOTS = {
    "2":  ["comida", "cena"],
    "3":  ["desayuno", "comida", "cena"],
    "4":  ["desayuno", "comida", "merienda", "cena"],
    "5":  ["desayuno", "snack1", "comida", "merienda", "cena"],
    "6":  ["desayuno", "snack1", "comida", "merienda", "cena", "snack2"],
  };
  const slots = FREQ_SLOTS[mealFrequency] || FREQ_SLOTS["4"];

  const LANG_NAMES = {
    es: "Spanish", en: "English", fr: "French", de: "German", zh: "Chinese",
    pt: "Portuguese", it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian",
    ar: "Arabic", ja: "Japanese", ko: "Korean", hi: "Hindi", tr: "Turkish",
  };
  const langName = LANG_NAMES[language] || "Spanish";

  const DAY_NAMES = {
    es: ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"],
    en: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
  };
  const days = DAY_NAMES[language] || DAY_NAMES.es;

  const prompt = `You are a professional nutritionist. Generate a complete 7-day meal plan.

USER PROFILE:
- Weight: ${weight} kg, Height: ${height} cm, Age: ${age}, Sex: ${sex}
- Activity level: ${activity}
- Goal: ${goal}
- Daily targets: ${calorieGoal} kcal, ${proteinGoal}g protein, ${carbsGoal}g carbs, ${fatGoal}g fat
- Allergies/intolerances: ${allergies?.length ? allergies.join(", ") : "none"}
- Dietary restriction: ${restriction || "none"}
- Cuisine preference: ${cuisine || "mixed"}
- Budget: ${budget || "medium"}
- Cooking time: ${cookingTime || "medium"}
- Meal slots per day: ${slots.join(", ")}

INSTRUCTIONS:
1. Generate a plan for 7 days (${days.join(", ")})
2. Each day has these meal slots: ${slots.join(", ")}
3. Each meal must have: name, list of ingredients with grams, and macros (kcal, protein, carbs, fat)
4. Each meal must include 2 alternative meals with SIMILAR macros (±10%)
5. Each ingredient must include 2 alternative ingredients with SIMILAR macros (±15%)
6. The daily totals should approximate the user's targets
7. Distribute calories logically across meals (e.g., breakfast ~25%, lunch ~35%, snack ~10%, dinner ~30%)
8. Use real, common foods. Be specific with quantities in grams.
9. ALL text (meal names, ingredient names) must be in ${langName}
10. Respect allergies and restrictions strictly

RESPOND WITH ONLY VALID JSON, no markdown, no explanation. Use this exact structure:
{
  "days": [
    {
      "day": "${days[0]}",
      "meals": {
        "${slots[0]}": {
          "name": "Meal name",
          "ingredients": [
            {
              "name": "Ingredient name",
              "grams": 150,
              "kcal": 200,
              "protein": 25,
              "carbs": 10,
              "fat": 8,
              "alternatives": [
                { "name": "Alt ingredient 1", "grams": 140, "kcal": 195, "protein": 24, "carbs": 11, "fat": 7 },
                { "name": "Alt ingredient 2", "grams": 160, "kcal": 205, "protein": 26, "carbs": 9, "fat": 9 }
              ]
            }
          ],
          "totals": { "kcal": 450, "protein": 35, "carbs": 40, "fat": 18 },
          "alternatives": [
            {
              "name": "Alternative meal 1",
              "ingredients": [{ "name": "...", "grams": 100, "kcal": 100, "protein": 10, "carbs": 10, "fat": 5, "alternatives": [] }],
              "totals": { "kcal": 445, "protein": 34, "carbs": 42, "fat": 17 }
            },
            {
              "name": "Alternative meal 2",
              "ingredients": [{ "name": "...", "grams": 100, "kcal": 100, "protein": 10, "carbs": 10, "fat": 5, "alternatives": [] }],
              "totals": { "kcal": 455, "protein": 36, "carbs": 38, "fat": 19 }
            }
          ]
        }
      },
      "dayTotals": { "kcal": 2000, "protein": 150, "carbs": 250, "fat": 65 }
    }
  ]
}

Generate ALL 7 days with ALL ${slots.length} meals each. Every meal needs 2 alternatives and every ingredient needs 2 alternatives.`;

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
      const err = await response.text();
      return res.status(response.status).json({ error: `Claude API error: ${err}` });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";

    // Parse JSON from response (Claude sometimes wraps in markdown)
    let plan;
    try {
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      plan = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: "Failed to parse meal plan JSON", raw: text.slice(0, 500) });
    }

    // Validate structure
    if (!plan.days || !Array.isArray(plan.days) || plan.days.length < 7) {
      return res.status(500).json({ error: "Invalid plan structure", raw: text.slice(0, 500) });
    }

    return res.status(200).json(plan);
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
