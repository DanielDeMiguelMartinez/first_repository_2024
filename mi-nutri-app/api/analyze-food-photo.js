// POST /api/analyze-food-photo
// Analyzes a food photo using Claude Vision to estimate macros
// Body: { image: base64string, language: "es" }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { image, language } = req.body;
  if (!image) return res.status(400).json({ error: "Missing image" });

  const LANG_NAMES = {
    es: "Spanish", en: "English", fr: "French", de: "German", zh: "Chinese",
    pt: "Portuguese", it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian",
    ar: "Arabic", ja: "Japanese", ko: "Korean", hi: "Hindi", tr: "Turkish",
  };
  const langName = LANG_NAMES[language] || "Spanish";

  // Detect media type from base64 header or default to jpeg
  let mediaType = "image/jpeg";
  let base64Data = image;
  if (image.startsWith("data:")) {
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      mediaType = match[1];
      base64Data = match[2];
    }
  }

  const prompt = `You are an expert nutritionist. Analyze this food photo and identify every food item visible.

For each food item, estimate:
- Name (in ${langName})
- Estimated weight in grams
- Calories (kcal)
- Protein (g)
- Carbs (g)
- Fat (g)

Also provide totals for the entire plate/meal.

RESPOND WITH ONLY VALID JSON, no markdown, no explanation:
{
  "items": [
    {
      "name": "Food name in ${langName}",
      "grams": 150,
      "kcal": 200,
      "protein": 25,
      "carbs": 10,
      "fat": 8
    }
  ],
  "totals": {
    "kcal": 500,
    "protein": 40,
    "carbs": 50,
    "fat": 20
  },
  "description": "Brief description of the meal in ${langName}"
}

Be as accurate as possible with portion sizes. Use common nutritional databases as reference. If you can't identify a food clearly, make your best estimate and note it in the name.`;

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
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Data },
            },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Claude API error: ${err}` });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";

    let result;
    try {
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: "Failed to parse response", raw: text.slice(0, 500) });
    }

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
