/**
 * api/transcribe.js — Vercel serverless function
 *
 * Recibe audio en base64 (data URL), lo transcribe con OpenAI Whisper y devuelve el texto.
 * Usado como fallback para navegadores sin Web Speech API (Firefox desktop).
 *
 * Requiere: OPENAI_API_KEY en las variables de entorno de Vercel.
 * Si no está configurada, devuelve { error: "not-configured" } (no rompe la app).
 *
 * POST /api/transcribe
 * Body: { audio: "data:audio/webm;base64,...", lang: "es-ES" }
 * Response: { text: "pollo con arroz" } | { error: string }
 */

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Responde OK para que el cliente muestre un mensaje amigable en vez de un crash
    return res.status(200).json({ error: "not-configured" });
  }

  try {
    const { audio, lang } = req.body ?? {};
    if (!audio || typeof audio !== "string") {
      return res.status(400).json({ error: "No audio provided" });
    }

    // audio es un data URL: "data:audio/webm;base64,AAAA..."
    const commaIdx = audio.indexOf(",");
    const base64Data = commaIdx !== -1 ? audio.slice(commaIdx + 1) : audio;
    const mimeMatch  = audio.match(/^data:([^;]+);/);
    const mimeType   = mimeMatch ? mimeMatch[1] : "audio/webm";
    const ext        = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";

    const audioBuffer = Buffer.from(base64Data, "base64");
    if (audioBuffer.length < 100) {
      // Audio demasiado corto — probablemente silencio
      return res.status(200).json({ text: "" });
    }

    // Construir FormData para Whisper
    // Node 18+ tiene FormData nativo
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", "whisper-1");
    formData.append("response_format", "json");
    // Solo pasar el código de 2 letras (Whisper lo entiende mejor)
    if (lang && typeof lang === "string") {
      formData.append("language", lang.slice(0, 2));
    }

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errBody = await whisperRes.text().catch(() => "");
      // log("[transcribe] Whisper error", whisperRes.status, errBody);
      return res.status(200).json({ error: "transcription-failed" });
    }

    const { text } = await whisperRes.json();
    return res.status(200).json({ text: (text ?? "").trim() });

  } catch (e) {
    // log("[transcribe] unexpected error", e);
    return res.status(200).json({ error: "transcription-failed" });
  }
}
