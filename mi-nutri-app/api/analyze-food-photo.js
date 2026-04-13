// POST /api/analyze-food-photo
// Analyzes a food photo using Claude Vision to estimate macros
// Body: { image: base64string, language: "es" }

import { createClient } from "@supabase/supabase-js";

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB base64
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5; // 5 requests per minute per user
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

  // Auth
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  // Rate limit
  if (!checkRate(uid)) return res.status(429).json({ error: "Too many requests. Wait 1 minute." });

  const { image, language } = req.body;
  if (!image) return res.status(400).json({ error: "Missing image" });

  // Size validation
  const base64Len = typeof image === "string" ? image.length : 0;
  if (base64Len > MAX_IMAGE_SIZE) return res.status(413).json({ error: "Image too large (max 4MB)" });

  // Media type validation
  let mediaType = "image/jpeg";
  let base64Data = image;
  if (image.startsWith("data:")) {
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) { mediaType = match[1]; base64Data = match[2]; }
  }
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!ALLOWED_TYPES.includes(mediaType)) return res.status(400).json({ error: "Unsupported image format" });

  const LANG_NAMES = {
    es: "Spanish", en: "English", fr: "French", de: "German", zh: "Chinese",
    pt: "Portuguese", it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian",
    ar: "Arabic", ja: "Japanese", ko: "Korean", hi: "Hindi", tr: "Turkish",
  };
  const langName = LANG_NAMES[language] || "Spanish";

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
    { "name": "Food name", "grams": 150, "kcal": 200, "protein": 25, "carbs": 10, "fat": 8 }
  ],
  "totals": { "kcal": 500, "protein": 40, "carbs": 50, "fat": 20 },
  "description": "Brief description of the meal in ${langName}"
}

Be as accurate as possible with portion sizes.`;

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
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        if (attempt < 1) continue; // retry
        return res.status(response.status).json({ error: "API error" });
      }

      const data = await response.json();
      const text = data.content?.[0]?.text ?? "";

      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const result = JSON.parse(jsonStr);
      return res.status(200).json(result);
    } catch (e) {
      if (attempt < 1) continue; // retry
      return res.status(500).json({ error: "Failed to analyze image" });
    }
  }
}
