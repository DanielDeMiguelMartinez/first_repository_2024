/**
 * api/restaurant-search.js — Vercel serverless function
 * Searches FatSecret by food category, returns dishes + restaurant names.
 *
 * GET /api/restaurant-search?category=italiana&lang=es
 * Returns: { results: Array<{ nombre, restaurante?, calorias, proteinas, carbs, grasas, porcion? }> }
 *
 * Env vars:
 *   FATSECRET_CLIENT_ID
 *   FATSECRET_CLIENT_SECRET
 */

let _fsToken = null;
let _fsTokenExpiry = 0;

// English search terms per category (FatSecret works best with English)
const CATEGORY_TERMS = {
  rapida:      ["burger", "hamburger", "nuggets", "sandwich wrap"],
  italiana:    ["pizza margherita", "pasta carbonara", "spaghetti bolognese", "lasagna"],
  pollo:       ["grilled chicken", "chicken breast", "rotisserie chicken", "chicken sandwich"],
  ensaladas:   ["caesar salad", "greek salad", "garden salad"],
  asiatica:    ["sushi roll", "ramen noodles", "fried rice", "pad thai"],
  mexicana:    ["burrito", "taco", "nachos", "quesadilla"],
  carnes:      ["ribeye steak", "beef ribs", "pork chop", "bbq"],
  española:    ["paella", "tortilla espanola", "gazpacho", "croquettes"],
  mediterranea:["hummus", "kebab", "falafel", "shawarma"],
  americana:   ["bbq ribs", "pulled pork sandwich", "mac cheese", "hot dog"],
  francesa:    ["crepe", "quiche", "croque monsieur"],
  alemana:     ["bratwurst", "schnitzel", "currywurst"],
};

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

function parseFatSecretDesc(desc) {
  if (!desc) return null;
  const m = desc.match(
    /Calories:\s*([\d.]+)kcal.*?Fat:\s*([\d.]+)g.*?Carbs:\s*([\d.]+)g.*?Protein:\s*([\d.]+)g/i
  );
  if (!m) return null;
  return { calorias: +m[1], grasas: +m[2], carbs: +m[3], proteinas: +m[4] };
}

async function searchRestaurantItems(term, headers) {
  const enc = encodeURIComponent(term);
  try {
    const res = await fetch(
      `https://platform.fatsecret.com/rest/2/restaurant.items.search?search_expression=${enc}&format=json&max_results=8`,
      { headers }
    );
    const data = await res.json();
    const raw = data?.restaurant_items?.restaurant_item;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list
      .filter(item => item.calories)
      .map(item => ({
        nombre: item.restaurant_item_name,
        restaurante: item.restaurant_name || undefined,
        calorias: Math.round(+(item.calories || 0)),
        proteinas: +(item.protein || 0),
        carbs: +(item.carbohydrate || 0),
        grasas: +(item.fat || 0),
        porcion: item.serving_size || undefined,
      }));
  } catch { return []; }
}

async function searchGenericFoods(term, headers) {
  const enc = encodeURIComponent(term);
  try {
    const res = await fetch(
      `https://platform.fatsecret.com/rest/2/foods.search?search_expression=${enc}&format=json&max_results=8`,
      { headers }
    );
    const data = await res.json();
    const raw = data?.foods?.food;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const results = [];
    for (const f of list) {
      const macros = parseFatSecretDesc(f.food_description);
      if (!macros || macros.calorias === 0) continue;
      results.push({
        nombre: f.food_name,
        restaurante: undefined,
        ...macros,
        porcion: "100g",
      });
    }
    return results;
  } catch { return []; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const category = ((req.query && req.query.category) || "").trim();
  if (!category) {
    res.status(400).json({ error: "category is required", results: [] });
    return;
  }

  const terms = CATEGORY_TERMS[category];
  if (!terms) {
    res.status(400).json({ error: "unknown category", results: [] });
    return;
  }

  try {
    const token = await getFatSecretToken();
    if (!token) {
      res.status(500).json({ error: "FatSecret token failed", results: [] });
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };

    // Search restaurant items for all terms in parallel
    const restaurantSearches = await Promise.all(
      terms.map(t => searchRestaurantItems(t, headers))
    );

    const seen = new Set();
    const all = [];

    // Add restaurant items first (they have restaurant names)
    for (const batch of restaurantSearches) {
      for (const item of batch) {
        const key = item.nombre.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(item);
      }
    }

    // If few restaurant results, fill with generic foods
    if (all.length < 8) {
      const generic = await searchGenericFoods(terms[0], headers);
      for (const item of generic) {
        const key = item.nombre.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(item);
        if (all.length >= 20) break;
      }
    }

    res.status(200).json({ results: all.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: String(err), results: [] });
  }
};
