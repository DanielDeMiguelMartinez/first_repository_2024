/**
 * api/cron/update-nutrition.js
 *
 * Vercel cron — runs every 6 months (Jan 1 and Jul 1 at midnight UTC).
 * Uses Claude API to review and update chain nutrition data,
 * then stores the result in Supabase so nearby-restaurants.js picks it up.
 *
 * Required env vars (set in Vercel dashboard):
 *   ANTHROPIC_API_KEY        — Anthropic API key
 *   SUPABASE_URL             — https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key (allows writes)
 *   CRON_SECRET              — Random string to protect the endpoint
 *
 * Supabase setup (run once in SQL editor):
 *   CREATE TABLE IF NOT EXISTS app_config (
 *     key text PRIMARY KEY,
 *     value jsonb NOT NULL,
 *     updated_at timestamptz DEFAULT now()
 *   );
 *   ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "public read" ON app_config FOR SELECT USING (true);
 *   CREATE POLICY "service write" ON app_config FOR ALL
 *     USING (auth.role() = 'service_role');
 */

// Chain names — used to drive the update prompt
const CHAIN_NAMES = [
  "McDonald's","Burger King","KFC","Subway","Domino's","Telepizza","Pizza Hut",
  "Starbucks","Dunkin'","Nando's","TGB – The Good Burger","Chipotle","Taco Bell",
  "Pret A Manger","Panera Bread","Wagamama","Yo Sushi","Itsu","Panda Express",
  "Outback Steakhouse","TGI Fridays","Foster's Hollywood","Le Pain Quotidien",
  "Nordsee","Vapiano","Popeyes","Five Guys","Shake Shack","100 Montaditos",
  "La Tagliatella","Ginos","Pans & Company","Nostrum","Vips","Carl's Jr.",
  "Wendy's","Grosso Napoletano","Tim Hortons","Lizarran","Goiko","Rodilla",
  "Bocatta","Udon","Lateral","La Pepita","La Sureña","Maoz","Papa John's",
  "Little Caesars","Sbarro","Costa Coffee","Caffe Nero","Paul","Brioche Dorée",
  "The Coffee Bean","Quiznos","Jimmy John's","Jersey Mike's","Qdoba","Del Taco",
  "El Pollo Loco","Applebee's","Chili's","Denny's","IHOP","Red Robin",
  "Ruby Tuesday","LongHorn Steakhouse","Texas Roadhouse","P.F. Chang's",
  "Wok to Walk","Yoshinoya","Genki Sushi","Wingstop","Buffalo Wild Wings",
  "Raising Cane's","Jollibee","Pizza Express","Zizzi","Bella Italia",
  "Frankie & Benny's","Hippopotamus","Quick","Döner Kebab","Istanbul Kebab",
  "Hesburger","Max Burgers","Freshii","Eataly","SushiRoll","Poké House",
  "Honest Burgers","Leon","Döner & Gyros","MOS Burger","Honest Greens","Bulk",
  "Bacoa","Sagardi","Muerde la Pasta","Green & Berry","Sushita","Pollo Campero",
  "Noodles & Company","Flax & Kale","Kiosko","Poke Me","VICIO","Burguer Fiction",
  "La Mordida","Miss Sushi","Momo","Ramen-Ya Hiro","Cervecería Gambrinus",
  "Taberna La Daniela","Las Bravas","Pez Tortilla","La Barraca","Juancho's BBQ",
  "Pastafiore","Bar Tomate","Tatel","La Máquina","Lamucca","La Finca",
  "Green is Better","Mama Campo","Tomatito","Fismuler","La Ancha",
  "Cervecería Cruz Blanca","Sushimore","Kirei","Brunchit","La Panetteria",
  "La Taberna del Alabardero","La Carlota","Arby's","Sonic Drive-In",
  "Jack in the Box","Whataburger","White Castle","Hardee's","Culver's",
  "Steak 'n Shake","Smashburger","Fatburger","The Habit Burger Grill","Rally's",
  "Church's Chicken","Zaxby's","Bojangles'","A&W","Long John Silver's",
  "Captain D's","Cook Out","Steak Escape","Wienerschnitzel","Caribou Coffee",
  "Auntie Anne's","Cinnabon","Corner Bakery Cafe","Au Bon Pain",
  "Einstein Bros. Bagels","Peet's Coffee","Lavazza","Greggs","Wasabi","EAT.",
  "Olive Garden","Red Lobster","Cheesecake Factory","Cracker Barrel","Bob Evans",
  "Sizzler","Bonefish Grill","Carrabba's","Cheddar's","Jason's Deli",
  "McAlister's Deli","Potbelly","Schlotzsky's","Firehouse Subs","Golden Corral",
  "GBK – Gourmet Burger Kitchen","Byron Burger","Prezzo","Ask Italian",
  "Café Rouge","Harvester","Beefeater","Bill's Restaurant","Miller & Carter",
  "O'Tacos","Flunch","Buffalo Grill","Courtepaille","Léon de Bruxelles",
  "Hans im Glück","L'Osteria","Block House","Dean & David","Backwerk",
  "Peter Pane","Old Wild West","Autogrill","El Corral","Bembos","Bob's",
  "Giraffas","Habib's","Frisby","Al Baik","Shawarma Republic","Fuddruckers",
  "Marugame Udon","Sukiya","Matsuya","Coco Ichibanya","Pepper Lunch","Lotteria",
  "Thai Express","Manchu Wok","Shakey's Pizza","Chowking","Mang Inasal",
  "Tropical Smoothie Cafe","Smoothie King","Dairy Queen","Baskin-Robbins",
  "Cold Stone Creamery","Marble Slab Creamery","Krispy Kreme","Jamba Juice",
  "Nathan's Famous","Which Wich","SushiSamba","Pitaya","Hummus Bros",
  "Noodles Box","Mad Mex","Guzman y Gomez","Tortilla","Tossed","Protein Haus",
  "SuperGreen","Salad Box","Wrap It Up","Chicken Nation",
];

const ITEM_SCHEMA = `{ nombre: string, calorias: number, proteinas: number, carbs: number, grasas: number, porcion?: string }`;

function buildPrompt(chains) {
  return `You are a nutrition database assistant. For each restaurant chain listed below, provide 3-6 of their CURRENT menu items with accurate nutritional values (as of 2025) in JSON format.

Return ONLY a valid JSON object with chain names as keys. Each value is an array of items with these fields:
${ITEM_SCHEMA}

Rules:
- calorias, proteinas, carbs, grasas must be numbers (integers)
- porcion is optional (e.g. "200g", "350ml")
- Use official nutritional information from each chain's website
- Include a mix of popular and healthy options
- Focus on items available in Spain/Europe when the chain is present there

Chains to update:
${chains.join(", ")}

Return ONLY the JSON object, no markdown, no explanation.`;
}

async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function parseJSON(text) {
  // Strip markdown fences if present
  const clean = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  return JSON.parse(clean);
}

async function supabaseRead(supabaseUrl, key, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/app_config?key=eq.chain_nutrition&select=value`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.value?.chains || null;
}

async function supabaseWrite(supabaseUrl, serviceKey, chains) {
  const res = await fetch(`${supabaseUrl}/rest/v1/app_config`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      key: "chain_nutrition",
      value: { chains, updated_at: new Date().toISOString() },
    }),
  });
  return res.ok;
}

module.exports = async function handler(req, res) {
  // Protect endpoint
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers["authorization"] || "";
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) return res.status(400).json({ error: "ANTHROPIC_API_KEY not set" });
  if (!supabaseUrl || !serviceKey) return res.status(400).json({ error: "Supabase env vars not set" });

  try {
    // Load existing data from Supabase (to merge, not overwrite)
    const existing = (await supabaseRead(supabaseUrl, "chain_nutrition", serviceKey)) || {};

    // Process chains in batches of 60 (fit within Claude's context + response limit)
    const BATCH = 60;
    let merged = { ...existing };

    for (let i = 0; i < CHAIN_NAMES.length; i += BATCH) {
      const batch = CHAIN_NAMES.slice(i, i + BATCH);
      const prompt = buildPrompt(batch);
      let text;
      try {
        text = await callClaude(prompt);
        const parsed = parseJSON(text);
        merged = { ...merged, ...parsed };
      } catch (e) {
        // log(`Batch ${i}-${i + BATCH} failed:`, e.message, text?.slice(0, 200));
        // Continue with next batch
      }
    }

    // Save to Supabase
    const ok = await supabaseWrite(supabaseUrl, serviceKey, merged);
    const chainCount = Object.keys(merged).length;

    return res.status(200).json({
      ok,
      chains_updated: chainCount,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
};
