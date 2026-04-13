// POST /api/generate-meal-plan — ONE day at a time

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "KEY_MISSING" });

  const { weight, height, age, sex, goal, mealFrequency, allergies, cuisine, restriction, cookingTime, language, calorieGoal, proteinGoal, carbsGoal, fatGoal, dayName } = req.body;

  const w = Number(weight), h = Number(height), a = Number(age);
  if (!w || w < 20 || w > 300) return res.status(400).json({ error: "Invalid weight" });
  if (!h || h < 100 || h > 250) return res.status(400).json({ error: "Invalid height" });
  if (!a || a < 10 || a > 100) return res.status(400).json({ error: "Invalid age" });

  let slots;
  if (typeof mealFrequency === "string" && mealFrequency.includes(",")) slots = mealFrequency.split(",");
  else { const F={"2":["comida","cena"],"3":["desayuno","comida","cena"],"4":["desayuno","comida","merienda","cena"],"5":["desayuno","snack1","comida","merienda","cena"],"6":["desayuno","snack1","comida","merienda","cena","snack2"]}; slots=F[mealFrequency]||F["4"]; }

  const L={es:"Spanish",en:"English",fr:"French",de:"German",zh:"Chinese",pt:"Portuguese",it:"Italian"};
  const lang = L[language]||"Spanish";
  const day = dayName || "Lunes";

  const prompt = `${day} meal plan. ${w}kg ${sex} ${goal} ${calorieGoal||2000}kcal ${proteinGoal||150}gP. Allergies:${allergies?.length?allergies.join(","):"none"}. ${restriction||"none"} ${cuisine||"mixed"} ${cookingTime||"medium"}.
Meals:${slots.join(",")}.
JSON only, ${lang}, no markdown:
{"day":"${day}","meals":{"SLOT":{"name":"x","ingredients":[{"name":"x","grams":100,"kcal":200,"protein":20,"carbs":25,"fat":8}],"totals":{"kcal":400,"protein":35,"carbs":45,"fat":15},"alternatives":[{"name":"alt","ingredients":[{"name":"x","grams":100,"kcal":200,"protein":20,"carbs":25,"fat":8}],"totals":{"kcal":400,"protein":35,"carbs":45,"fat":15}}]}},"dayTotals":{"kcal":${calorieGoal||2000},"protein":${proteinGoal||150},"carbs":${carbsGoal||250},"fat":${fatGoal||65}}}
2-4 ingredients per meal, 1 alternative per meal. Be concise.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return res.status(response.status).json({ error: `API_${response.status}: ${errText.slice(0, 300)}` });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: `CATCH: ${e?.message || "unknown"}` });
  }
}
