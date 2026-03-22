/**
 * api/restaurant-search.js — Vercel serverless function
 * Proxies FatSecret so secrets never reach the browser.
 *
 * GET /api/restaurant-search?q=paella
 * Returns: { results: Array<{ nombre, fuente, calorias, proteinas, carbs, grasas, porcion }> }
 *
 * Env vars needed in Vercel:
 *   FATSECRET_CLIENT_ID
 *   FATSECRET_CLIENT_SECRET
 */

let _fsToken = null;
let _fsTokenExpiry = 0;

async function getFatSecretToken() {
  if (_fsToken && Date.now() < _fsTokenExpiry) return _fsToken;

  const clientId = process.env.FATSECRET_CLIENT_ID || "";
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return null;

  const body =
    `grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&scope=basic`;

  const res = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!data.access_token) return null;

  _fsToken = data.access_token;
  _fsTokenExpiry = Date.now() + ((data.expires_in || 86400) - 300) * 1000;
  return _fsToken;
}

/** Parses "Per 100g - Calories: 143kcal | Fat: 4.20g | Carbs: 17.66g | Protein: 8.28g" */
function parseFatSecretDesc(desc) {
  if (!desc) return null;
  const m = desc.match(
    /Calories:\s*([\d.]+)kcal.*?Fat:\s*([\d.]+)g.*?Carbs:\s*([\d.]+)g.*?Protein:\s*([\d.]+)g/i
  );
  if (!m) return null;
  return { calorias: +m[1], grasas: +m[2], carbs: +m[3], proteinas: +m[4] };
}

async function searchFatSecret(q, token) {
  if (!token) return [];
  const headers = { Authorization: `Bearer ${token}` };
  const enc = encodeURIComponent(q);

  const [foodsRes, restaurantRes] = await Promise.allSettled([
    fetch(
      `https://platform.fatsecret.com/rest/2/foods.search?search_expression=${enc}&format=json&max_results=12`,
      { headers }
    ).then((r) => r.json()),
    fetch(
      `https://platform.fatsecret.com/rest/2/restaurant.items.search?search_expression=${enc}&format=json&max_results=10`,
      { headers }
    ).then((r) => r.json()),
  ]);

  const results = [];

  if (foodsRes.status === "fulfilled" && foodsRes.value?.foods) {
    const raw = foodsRes.value.foods.food;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const f of list) {
      const macros = parseFatSecretDesc(f.food_description);
      if (!macros || macros.calorias === 0) continue;
      results.push({
        nombre: f.food_name,
        fuente: "FatSecret",
        ...macros,
        porcion: "100g",
      });
    }
  }

  if (restaurantRes.status === "fulfilled" && restaurantRes.value?.restaurant_items) {
    const raw = restaurantRes.value.restaurant_items.restaurant_item;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const item of list) {
      if (!item.calories) continue;
      results.push({
        nombre:
          item.restaurant_item_name +
          (item.restaurant_name ? ` (${item.restaurant_name})` : ""),
        fuente: "FatSecret Restaurante",
        calorias: Math.round(+(item.calories || 0)),
        proteinas: +(item.protein || 0),
        carbs: +(item.carbohydrate || 0),
        grasas: +(item.fat || 0),
        porcion: item.serving_size || "",
      });
    }
  }

  return results;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const q = ((req.query && req.query.q) || "").trim();
  if (!q) {
    res.status(400).json({ error: "q is required", results: [] });
    return;
  }

  try {
    const token = await getFatSecretToken();
    const results = await searchFatSecret(q, token);
    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: String(err), results: [] });
  }
};
