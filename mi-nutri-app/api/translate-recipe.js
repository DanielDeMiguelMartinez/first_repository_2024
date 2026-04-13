/**
 * api/translate-recipe.js — Vercel serverless function
 *
 * Cuando se publica una receta, traduce nombre + descripción + ingredientes
 * a todos los idiomas usando Google Cloud Translation API y los guarda
 * en `traducciones_recetas`.
 *
 * Requiere en Vercel Environment Variables:
 *   GOOGLE_TRANSLATE_KEY → API key de Google Cloud Translation
 *   SUPABASE_SERVICE_KEY → service role key de Supabase (para saltar RLS en escritura)
 *
 * POST /api/translate-recipe
 * Body: { pub_id: "uuid" }
 * Response: { ok: true, langs: N } | { ok: false, reason: string }
 */

export const config = { maxDuration: 60 };

const SUPABASE_URL = "https://ncgkmfoftvudowmfjasj.supabase.co";

// Idiomas soportados por Google Cloud Translation → código app
const GOOGLE_LANGS = [
  { g: "en",    app: "en" },
  { g: "fr",    app: "fr" },
  { g: "de",    app: "de" },
  { g: "it",    app: "it" },
  { g: "pt",    app: "pt" },
  { g: "nl",    app: "nl" },
  { g: "pl",    app: "pl" },
  { g: "ru",    app: "ru" },
  { g: "ar",    app: "ar" },
  { g: "ja",    app: "ja" },
  { g: "ko",    app: "ko" },
  { g: "tr",    app: "tr" },
  { g: "uk",    app: "uk" },
  { g: "ro",    app: "ro" },
  { g: "el",    app: "el" },
  { g: "cs",    app: "cs" },
  { g: "sv",    app: "sv" },
  { g: "hu",    app: "hu" },
  { g: "fi",    app: "fi" },
  { g: "da",    app: "da" },
  { g: "sk",    app: "sk" },
  { g: "no",    app: "nb" },
  { g: "zh-CN", app: "zh" },
];

/**
 * Traduce un array de textos a un idioma usando Google Cloud Translation.
 * Envía todos los textos en una sola petición (más eficiente y barato).
 */
async function callGoogle(textos, targetLang, apiKey) {
  const noVacios = textos.map((t, i) => ({ t: t ?? "", i })).filter(x => x.t.trim());
  if (!noVacios.length) return textos;
  try {
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: noVacios.map(x => x.t),
          source: "es",
          target: targetLang,
          format: "text",
        }),
      }
    );
    if (!res.ok) return textos;
    const data = await res.json();
    const trs = data?.data?.translations?.map(x => x.translatedText) ?? [];
    const resultado = [...textos];
    noVacios.forEach((x, ci) => { resultado[x.i] = trs[ci] ?? x.t; });
    return resultado;
  } catch {
    return textos;
  }
}

async function supabaseFetch(path, options, serviceKey) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const googleKey = process.env.GOOGLE_TRANSLATE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!googleKey) {
    return res.status(200).json({ ok: false, reason: "no-google-key" });
  }
  if (!serviceKey) {
    return res.status(200).json({ ok: false, reason: "no-service-key" });
  }

  const { pub_id } = req.body ?? {};
  if (!pub_id) return res.status(400).json({ error: "pub_id required" });

  // 1. Obtener la receta de Supabase
  const fetchRes = await supabaseFetch(
    `/publicaciones_recetas?id=eq.${encodeURIComponent(pub_id)}&select=*`,
    {},
    serviceKey
  );
  const pubs = await fetchRes.json();
  const pub = pubs?.[0];
  if (!pub) return res.status(404).json({ error: "recipe not found" });

  const ingNombres = (pub.ingredientes ?? []).map(i => i?.nombre ?? "");
  // Array: [nombre, descripcion, ...ingNombres]
  const textos = [pub.nombre_receta ?? "", pub.descripcion ?? "", ...ingNombres];

  // 2. Traducir a todos los idiomas en paralelo — cada idioma es 1 sola petición a Google
  const traducciones = await Promise.all(
    GOOGLE_LANGS.map(async ({ g, app }) => {
      const trs = await callGoogle(textos, g, googleKey);
      return {
        pub_id,
        lang: app,
        nombre: trs[0] || pub.nombre_receta,
        descripcion: trs[1] || "",
        ingredientes: trs.slice(2),
      };
    })
  );

  // 3. Upsert en traducciones_recetas (merge si ya existe el par pub_id+lang)
  const upsertRes = await supabaseFetch(
    "/traducciones_recetas",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(traducciones),
    },
    serviceKey
  );

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    // log("[translate-recipe] upsert error:", err);
    return res.status(500).json({ ok: false, reason: "db-write-failed" });
  }

  return res.status(200).json({ ok: true, langs: traducciones.length });
}
