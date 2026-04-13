/**
 * api/detect-lang.js — Vercel serverless function
 *
 * Descarga un vídeo ya subido a Supabase Storage y detecta su idioma hablado
 * usando OpenAI Whisper con verbose_json (sin forzar idioma → detección automática).
 *
 * POST /api/detect-lang
 * Body: { videoUrl: "https://..." }
 * Response: { language: "es" } | { language: null }
 *
 * Requiere: OPENAI_API_KEY en variables de entorno de Vercel.
 * Límite Whisper: 25 MB. Si el vídeo es mayor devuelve { language: null }.
 */

export const config = { maxDuration: 45 };

// Mapeo de nombres de idioma que devuelve Whisper → código ISO 639-1
const WHISPER_TO_LANG = {
  spanish: "es", english: "en", french: "fr", german: "de", chinese: "zh",
  portuguese: "pt", italian: "it", dutch: "nl", polish: "pl", russian: "ru",
  arabic: "ar", japanese: "ja", korean: "ko", hindi: "hi", turkish: "tr",
  vietnamese: "vi", indonesian: "id", thai: "th", ukrainian: "uk", romanian: "ro",
  greek: "el", czech: "cs", swedish: "sv", hungarian: "hu", catalan: "ca",
  hebrew: "he", norwegian: "nb", finnish: "fi", danish: "da", slovak: "sk",
  mandarin: "zh", cantonese: "zh",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ language: null });
  }

  try {
    const { videoUrl } = req.body ?? {};
    if (!videoUrl || typeof videoUrl !== "string") {
      return res.status(400).json({ error: "No videoUrl provided" });
    }

    // Descargar el vídeo desde Supabase Storage
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      // log("[detect-lang] Could not fetch video", videoRes.status);
      return res.status(200).json({ language: null });
    }

    const buffer = Buffer.from(await videoRes.arrayBuffer());

    // Límite de Whisper: 25 MB
    if (buffer.length > 25 * 1024 * 1024) {
      // log("[detect-lang] Video too large for Whisper:", buffer.length);
      return res.status(200).json({ language: null });
    }

    // Inferir extensión desde la URL (limpia parámetros de query)
    const cleanUrl = videoUrl.split("?")[0];
    const ext = cleanUrl.split(".").pop()?.toLowerCase() ?? "mp4";
    const mimeType =
      ext === "webm" ? "video/webm" :
      ext === "ogg"  ? "video/ogg"  :
      ext === "mov"  ? "video/quicktime" : "video/mp4";

    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append("file", blob, `reel.${ext}`);
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    // ⚠️ No se pasa "language" → Whisper detecta automáticamente el idioma hablado

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errBody = await whisperRes.text().catch(() => "");
      // log("[detect-lang] Whisper error", whisperRes.status, errBody);
      return res.status(200).json({ language: null });
    }

    const data = await whisperRes.json();
    // verbose_json devuelve { language: "spanish", text: "...", ... }
    const whisperLang = (data.language ?? "").toLowerCase();
    const langCode = WHISPER_TO_LANG[whisperLang] ?? null;

    // log("[detect-lang] Detected:", whisperLang, "→", langCode);
    return res.status(200).json({ language: langCode });

  } catch (e) {
    // log("[detect-lang] unexpected error", e);
    return res.status(200).json({ language: null });
  }
}
