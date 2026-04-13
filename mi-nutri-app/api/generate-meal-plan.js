// POST /api/generate-meal-plan — ONE day, edge runtime for 30s timeout

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500 });

  const body = await req.json();
  const { weight, height, age, sex, goal, mealFrequency, allergies, cuisine, restriction, cookingTime, language, calorieGoal, proteinGoal, carbsGoal, fatGoal, dayName } = body;

  const w = Number(weight), h = Number(height), a = Number(age);
  if (!w || w < 20 || w > 300) return new Response(JSON.stringify({ error: "Invalid weight" }), { status: 400 });
  if (!h || h < 100 || h > 250) return new Response(JSON.stringify({ error: "Invalid height" }), { status: 400 });
  if (!a || a < 10 || a > 100) return new Response(JSON.stringify({ error: "Invalid age" }), { status: 400 });

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

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      });
      if (!response.ok) {
        if (attempt < 1) continue;
        const status = response.status;
        if (status === 529 || status === 503) return new Response(JSON.stringify({ error: "El servicio de IA está saturado. Inténtalo en unos minutos." }), { status: 503 });
        if (status === 402) return new Response(JSON.stringify({ error: "Créditos de IA agotados." }), { status: 402 });
        return new Response(JSON.stringify({ error: "Error al generar el plan." }), { status: 500 });
      }
      const data = await response.json();
      const text = data.content?.[0]?.text ?? "";
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return new Response(jsonStr, { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      if (attempt < 1) continue;
      return new Response(JSON.stringify({ error: "Error al generar" }), { status: 500 });
    }
  }
}
