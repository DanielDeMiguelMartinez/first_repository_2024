// POST /api/analyze-food-photo — Edge runtime for 30s timeout

export const config = { runtime: 'edge' };

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

export default async function handler(req) {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500 });

  const body = await req.json();
  const { image, language } = body;
  if (!image) return new Response(JSON.stringify({ error: "Missing image" }), { status: 400 });

  const base64Len = typeof image === "string" ? image.length : 0;
  if (base64Len > MAX_IMAGE_SIZE) return new Response(JSON.stringify({ error: "Image too large (max 4MB)" }), { status: 413 });

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

  for (let attempt = 0; attempt < 2; attempt++) {
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
        if (attempt < 1) continue;
        const status = response.status;
        if (status === 529 || status === 503) return new Response(JSON.stringify({ error: "IA saturada. Inténtalo en unos minutos." }), { status: 503 });
        if (status === 402) return new Response(JSON.stringify({ error: "Créditos agotados." }), { status: 402 });
        return new Response(JSON.stringify({ error: "Error al analizar." }), { status: 500 });
      }
      const data = await response.json();
      const text = data.content?.[0]?.text ?? "";
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return new Response(jsonStr, { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      if (attempt < 1) continue;
      return new Response(JSON.stringify({ error: "Error al analizar" }), { status: 500 });
    }
  }
}
