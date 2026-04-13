/**
 * api/d1-proxy.js — Vercel serverless function
 *
 * Proxy seguro para Cloudflare D1. Valida el JWT de Supabase del usuario
 * antes de reenviar la petición SQL al Worker de Cloudflare.
 *
 * De esta forma D1_URL y D1_TOKEN permanecen en variables de entorno
 * del servidor (sin prefijo EXPO_PUBLIC_) y nunca llegan al bundle del cliente.
 *
 * Variables de entorno necesarias en Vercel (sin EXPO_PUBLIC_):
 *   D1_URL               — URL del Cloudflare Worker (p. ej. https://mi-nutri-d1.workers.dev)
 *   D1_TOKEN             — Token secreto del Worker
 *   EXPO_PUBLIC_SUPABASE_URL       — ya está definida (también la lee el proxy)
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY  — ya está definida (también la lee el proxy)
 *
 * POST /api/d1-proxy
 * Headers: Authorization: Bearer <supabase-access-token>
 * Body:    pipeline JSON tal como lo enviaría d1.ts directamente
 * Response: respuesta del Worker tal cual
 */

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Autenticar al usuario con Supabase ──────────────────────────────────────
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization header required" });
  }
  const token = auth.slice(7);

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    }).catch(() => null);

    if (!userRes?.ok) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
  }

  // ── Reenviar al Worker de Cloudflare D1 ─────────────────────────────────────
  const d1Url = process.env.D1_URL;
  const d1Token = process.env.D1_TOKEN;

  if (!d1Url || !d1Token) {
    return res.status(503).json({ error: "D1 not configured on server" });
  }

  try {
    const d1Res = await fetch(`${d1Url}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${d1Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    const data = await d1Res.json().catch(() => ({}));
    return res.status(d1Res.ok ? 200 : d1Res.status).json(data);
  } catch (e) {
    // log("[d1-proxy] error:", e);
    return res.status(500).json({ error: "D1 proxy error" });
  }
}
