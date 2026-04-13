// POST /api/analyze-food-photo

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "KEY_MISSING" });

  const { image, language } = req.body;
  if (!image) return res.status(400).json({ error: "Missing image" });

  if (image.length > 4 * 1024 * 1024) return res.status(413).json({ error: "Image too large" });

  let mediaType = "image/jpeg";
  let base64Data = image;
  if (image.startsWith("data:")) {
    const match = image.match(/^data:(image\/[\w+]+);base64,(.+)$/);
    if (match) { mediaType = match[1]; base64Data = match[2]; }
  } else {
    if (base64Data.startsWith("iVBOR")) mediaType = "image/png";
    else if (base64Data.startsWith("R0lGOD")) mediaType = "image/gif";
    else if (base64Data.startsWith("UklGR")) mediaType = "image/webp";
  }

  const L={es:"Spanish",en:"English",fr:"French",de:"German",zh:"Chinese",pt:"Portuguese",it:"Italian"};
  const langName = L[language]||"Spanish";

  const prompt = `Analyze this food photo. For each item: name(${langName}), grams, kcal, protein, carbs, fat. Plus totals and description.
JSON only, no markdown:
{"items":[{"name":"x","grams":150,"kcal":200,"protein":25,"carbs":10,"fat":8}],"totals":{"kcal":500,"protein":40,"carbs":50,"fat":20},"description":"brief ${langName}"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1500,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
          { type: "text", text: prompt },
        ]}],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return res.status(response.status).json({ error: `API_${response.status}: ${errText.slice(0, 300)}` });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return res.status(200).json(JSON.parse(jsonStr));
  } catch (e) {
    return res.status(500).json({ error: `CATCH: ${e?.message || "unknown"}` });
  }
}
