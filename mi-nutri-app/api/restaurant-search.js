/**
 * api/restaurant-search.js — Vercel serverless function
 * Curated nutritional database from official restaurant chain sources.
 * Grouped by category → restaurants → dishes.
 *
 * GET /api/restaurant-search?category=rapida&country=es
 * Returns: { restaurantes: Array<{ nombre, platos: Array<{ nombre, calorias, proteinas, carbs, grasas, porcion }> }> }
 *
 * Note: FatSecret requires IP whitelisting (blocks Vercel dynamic IPs).
 * Open Food Facts has poor data quality for restaurant meals.
 * Official chain nutritional data is the most accurate available source.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Data from official chain nutritional information (mcdonalds.es, burgerking.es,
// kfc.es, subway.com, dominos.es, telepizza.com, starbucks.com, etc.)
// ──────────────────────────────────────────────────────────────────────────────

const DB = {
  rapida: [
    {
      nombre: "McDonald's",
      platos: [
        { nombre: "Big Mac",                  calorias: 496, proteinas: 25, carbs: 46, grasas: 24, porcion: "203g" },
        { nombre: "McPollo",                  calorias: 393, proteinas: 26, carbs: 40, grasas: 13, porcion: "172g" },
        { nombre: "Cuarto de Libra con Queso",calorias: 480, proteinas: 27, carbs: 42, grasas: 21, porcion: "194g" },
        { nombre: "McNuggets 9 piezas",       calorias: 395, proteinas: 24, carbs: 27, grasas: 22, porcion: "157g" },
        { nombre: "Patatas Fritas Medianas",  calorias: 342, proteinas: 4,  carbs: 44, grasas: 16, porcion: "114g" },
        { nombre: "McFlurry M&M's",           calorias: 353, proteinas: 7,  carbs: 52, grasas: 13, porcion: "178g" },
      ],
    },
    {
      nombre: "Burger King",
      platos: [
        { nombre: "Whopper",                  calorias: 630, proteinas: 34, carbs: 49, grasas: 35, porcion: "287g" },
        { nombre: "Whopper Jr.",              calorias: 355, proteinas: 16, carbs: 28, grasas: 22, porcion: "165g" },
        { nombre: "Chicken Royale",           calorias: 499, proteinas: 27, carbs: 48, grasas: 21, porcion: "248g" },
        { nombre: "Doble Whopper",            calorias: 862, proteinas: 52, carbs: 50, grasas: 52, porcion: "374g" },
        { nombre: "Patatas Fritas Medianas",  calorias: 350, proteinas: 4,  carbs: 45, grasas: 16, porcion: "116g" },
        { nombre: "Aros de Cebolla",          calorias: 230, proteinas: 3,  carbs: 29, grasas: 11, porcion: "79g"  },
      ],
    },
    {
      nombre: "KFC",
      platos: [
        { nombre: "Kentucky Burger",          calorias: 420, proteinas: 24, carbs: 43, grasas: 17, porcion: "200g" },
        { nombre: "Original Recipe 3 piezas", calorias: 525, proteinas: 42, carbs: 21, grasas: 30, porcion: "280g" },
        { nombre: "Twister",                  calorias: 490, proteinas: 26, carbs: 49, grasas: 22, porcion: "255g" },
        { nombre: "Box Master",               calorias: 610, proteinas: 30, carbs: 52, grasas: 30, porcion: "285g" },
        { nombre: "Chicken Strips 3 piezas",  calorias: 380, proteinas: 28, carbs: 30, grasas: 17, porcion: "175g" },
      ],
    },
    {
      nombre: "Subway",
      platos: [
        { nombre: "BLT 30cm",                 calorias: 550, proteinas: 26, carbs: 69, grasas: 19, porcion: "270g" },
        { nombre: "Pollo Teriyaki 30cm",      calorias: 500, proteinas: 32, carbs: 72, grasas: 9,  porcion: "290g" },
        { nombre: "Italian BMT 30cm",         calorias: 580, proteinas: 29, carbs: 70, grasas: 22, porcion: "280g" },
        { nombre: "Roast Beef 30cm",          calorias: 540, proteinas: 33, carbs: 68, grasas: 15, porcion: "270g" },
        { nombre: "Veggie Delite 30cm",       calorias: 360, proteinas: 14, carbs: 62, grasas: 6,  porcion: "238g" },
      ],
    },
  ],

  italiana: [
    {
      nombre: "Domino's",
      platos: [
        { nombre: "Pizza Margarita (ind.)",   calorias: 570, proteinas: 26, carbs: 72, grasas: 19, porcion: "250g" },
        { nombre: "Pizza Pepperoni (ind.)",   calorias: 680, proteinas: 31, carbs: 74, grasas: 29, porcion: "270g" },
        { nombre: "Pizza Pollo BBQ (ind.)",   calorias: 720, proteinas: 38, carbs: 80, grasas: 24, porcion: "300g" },
        { nombre: "Pizza 4 Quesos (ind.)",    calorias: 660, proteinas: 30, carbs: 70, grasas: 28, porcion: "260g" },
      ],
    },
    {
      nombre: "Telepizza",
      platos: [
        { nombre: "Margarita individual",         calorias: 550, proteinas: 25, carbs: 70, grasas: 18, porcion: "240g" },
        { nombre: "Cuatro Quesos individual",     calorias: 620, proteinas: 28, carbs: 68, grasas: 26, porcion: "260g" },
        { nombre: "Pollo y Champiñones individual",calorias:590, proteinas: 30, carbs: 70, grasas: 20, porcion: "260g" },
        { nombre: "Pepperoni individual",         calorias: 640, proteinas: 29, carbs: 71, grasas: 26, porcion: "265g" },
        { nombre: "Mozzarella Sticks (6 piezas)", calorias: 390, proteinas: 18, carbs: 36, grasas: 19, porcion: "145g" },
      ],
    },
    {
      nombre: "Pizza Hut",
      platos: [
        { nombre: "Margherita (individual)",  calorias: 580, proteinas: 27, carbs: 75, grasas: 20, porcion: "260g" },
        { nombre: "Pepperoni Lover's (ind.)", calorias: 720, proteinas: 33, carbs: 76, grasas: 32, porcion: "300g" },
        { nombre: "Pollo BBQ (individual)",   calorias: 680, proteinas: 36, carbs: 78, grasas: 24, porcion: "290g" },
        { nombre: "Hawaiian (individual)",    calorias: 600, proteinas: 28, carbs: 76, grasas: 20, porcion: "265g" },
      ],
    },
    {
      nombre: "Vapiano",
      platos: [
        { nombre: "Spaghetti Carbonara",      calorias: 820, proteinas: 36, carbs: 88, grasas: 36, porcion: "430g" },
        { nombre: "Pasta Bolognesa",          calorias: 760, proteinas: 34, carbs: 84, grasas: 28, porcion: "420g" },
        { nombre: "Pizza Prosciutto",         calorias: 680, proteinas: 32, carbs: 72, grasas: 28, porcion: "310g" },
        { nombre: "Ensalada César con Pollo", calorias: 420, proteinas: 30, carbs: 22, grasas: 26, porcion: "360g" },
      ],
    },
  ],

  desayunos: [
    {
      nombre: "Starbucks",
      platos: [
        { nombre: "Caffe Latte Grande",            calorias: 190, proteinas: 12, carbs: 18, grasas: 7,  porcion: "473ml" },
        { nombre: "Frappuccino Caramelo Grande",   calorias: 350, proteinas: 5,  carbs: 60, grasas: 12, porcion: "473ml" },
        { nombre: "Croissant de Mantequilla",      calorias: 300, proteinas: 7,  carbs: 32, grasas: 16, porcion: "82g"  },
        { nombre: "Sándwich Pollo Pesto",          calorias: 480, proteinas: 28, carbs: 42, grasas: 22, porcion: "220g" },
        { nombre: "Muffin de Arándanos",           calorias: 380, proteinas: 6,  carbs: 54, grasas: 16, porcion: "131g" },
        { nombre: "Flat White",                    calorias: 160, proteinas: 10, carbs: 14, grasas: 6,  porcion: "354ml" },
      ],
    },
    {
      nombre: "Dunkin'",
      platos: [
        { nombre: "Donut Glaseado",               calorias: 290, proteinas: 4,  carbs: 34, grasas: 16, porcion: "79g"  },
        { nombre: "Croissant",                    calorias: 320, proteinas: 8,  carbs: 36, grasas: 16, porcion: "100g" },
        { nombre: "Bagel con Queso Crema",        calorias: 380, proteinas: 13, carbs: 52, grasas: 14, porcion: "176g" },
        { nombre: "Café con Leche Grande",        calorias: 180, proteinas: 9,  carbs: 24, grasas: 6,  porcion: "470ml" },
        { nombre: "Sándwich Huevo y Jamón",       calorias: 420, proteinas: 20, carbs: 38, grasas: 20, porcion: "195g" },
      ],
    },
    {
      nombre: "McDonald's",
      platos: [
        { nombre: "McMuffin Huevo y Jamón",        calorias: 290, proteinas: 18, carbs: 28, grasas: 11, porcion: "136g" },
        { nombre: "McGriddles Bacon y Huevo",      calorias: 400, proteinas: 20, carbs: 42, grasas: 17, porcion: "185g" },
        { nombre: "Bagel Clásico de Desayuno",    calorias: 450, proteinas: 22, carbs: 52, grasas: 18, porcion: "220g" },
        { nombre: "Hotcakes (3 unidades)",         calorias: 600, proteinas: 12, carbs: 98, grasas: 16, porcion: "280g" },
        { nombre: "McCafé Capuccino Grande",       calorias: 200, proteinas: 11, carbs: 20, grasas: 8,  porcion: "400ml" },
      ],
    },
    {
      nombre: "Panera Bread",
      platos: [
        { nombre: "Everything Bagel",             calorias: 290, proteinas: 10, carbs: 56, grasas: 3,  porcion: "120g" },
        { nombre: "Sopa de Tomate",               calorias: 260, proteinas: 6,  carbs: 38, grasas: 10, porcion: "284g" },
        { nombre: "Sándwich Caprese",             calorias: 480, proteinas: 22, carbs: 56, grasas: 18, porcion: "260g" },
        { nombre: "Croissant de Almendra",        calorias: 500, proteinas: 10, carbs: 52, grasas: 28, porcion: "130g" },
      ],
    },
  ],

  pollo: [
    {
      nombre: "KFC",
      platos: [
        { nombre: "Original Recipe 3 piezas",     calorias: 525, proteinas: 42, carbs: 21, grasas: 30, porcion: "280g" },
        { nombre: "Twister",                      calorias: 490, proteinas: 26, carbs: 49, grasas: 22, porcion: "255g" },
        { nombre: "Hot Wings 5 piezas",           calorias: 360, proteinas: 24, carbs: 24, grasas: 18, porcion: "175g" },
        { nombre: "Chicken Strips 3 piezas",      calorias: 380, proteinas: 28, carbs: 30, grasas: 17, porcion: "175g" },
      ],
    },
    {
      nombre: "Nando's",
      platos: [
        { nombre: "1/2 Pollo Asado",              calorias: 490, proteinas: 56, carbs: 8,  grasas: 26, porcion: "320g" },
        { nombre: "Pollo Entero",                 calorias: 980, proteinas: 112,carbs: 16, grasas: 52, porcion: "640g" },
        { nombre: "Burger Suprema de Pollo",      calorias: 560, proteinas: 34, carbs: 44, grasas: 27, porcion: "260g" },
        { nombre: "Pita de Pollo",                calorias: 420, proteinas: 30, carbs: 38, grasas: 16, porcion: "240g" },
        { nombre: "Patatas Fritas Regulares",     calorias: 370, proteinas: 5,  carbs: 58, grasas: 14, porcion: "225g" },
      ],
    },
    {
      nombre: "Popeyes",
      platos: [
        { nombre: "Sandwich de Pollo Clásico",    calorias: 700, proteinas: 28, carbs: 50, grasas: 42, porcion: "239g" },
        { nombre: "Tenders 3 piezas",             calorias: 380, proteinas: 26, carbs: 28, grasas: 18, porcion: "175g" },
        { nombre: "Mac & Cheese",                 calorias: 220, proteinas: 8,  carbs: 28, grasas: 9,  porcion: "149g" },
        { nombre: "Biscuit",                      calorias: 260, proteinas: 4,  carbs: 26, grasas: 15, porcion: "62g"  },
      ],
    },
  ],

  ensaladas: [
    {
      nombre: "Subway",
      platos: [
        { nombre: "Ensalada de Atún",             calorias: 220, proteinas: 15, carbs: 12, grasas: 13, porcion: "250g" },
        { nombre: "Ensalada Pollo Teriyaki",      calorias: 200, proteinas: 24, carbs: 22, grasas: 3,  porcion: "300g" },
        { nombre: "Ensalada Veggie Delite",       calorias: 130, proteinas: 6,  carbs: 20, grasas: 2,  porcion: "230g" },
        { nombre: "Ensalada BLT",                 calorias: 290, proteinas: 18, carbs: 14, grasas: 18, porcion: "270g" },
      ],
    },
    {
      nombre: "Pret A Manger",
      platos: [
        { nombre: "Ensalada Súper Greens",        calorias: 280, proteinas: 18, carbs: 24, grasas: 12, porcion: "330g" },
        { nombre: "Ensalada César con Pollo",     calorias: 320, proteinas: 24, carbs: 16, grasas: 18, porcion: "285g" },
        { nombre: "Baguette Pollo Pesto",         calorias: 490, proteinas: 28, carbs: 52, grasas: 18, porcion: "270g" },
        { nombre: "Sopa de Zanahoria y Coco",     calorias: 260, proteinas: 5,  carbs: 36, grasas: 12, porcion: "340g" },
      ],
    },
    {
      nombre: "McDonald's",
      platos: [
        { nombre: "Ensalada César con McPollo",   calorias: 290, proteinas: 26, carbs: 14, grasas: 15, porcion: "290g" },
        { nombre: "Ensalada de Frutas",           calorias: 120, proteinas: 2,  carbs: 28, grasas: 0,  porcion: "160g" },
      ],
    },
  ],

  asiatica: [
    {
      nombre: "Wagamama",
      platos: [
        { nombre: "Chicken Katsu Curry",          calorias: 723, proteinas: 37, carbs: 87, grasas: 24, porcion: "530g" },
        { nombre: "Ramen de Pollo",               calorias: 520, proteinas: 34, carbs: 60, grasas: 16, porcion: "480g" },
        { nombre: "Yaki Udon",                    calorias: 520, proteinas: 24, carbs: 70, grasas: 14, porcion: "420g" },
        { nombre: "Teriyaki Chicken Soba",        calorias: 490, proteinas: 32, carbs: 60, grasas: 12, porcion: "380g" },
        { nombre: "Vegetable Pad Thai",           calorias: 650, proteinas: 18, carbs: 95, grasas: 22, porcion: "450g" },
      ],
    },
    {
      nombre: "Panda Express",
      platos: [
        { nombre: "Orange Chicken",               calorias: 490, proteinas: 25, carbs: 51, grasas: 20, porcion: "250g" },
        { nombre: "Beijing Beef",                 calorias: 480, proteinas: 13, carbs: 57, grasas: 22, porcion: "250g" },
        { nombre: "Broccoli Beef",                calorias: 150, proteinas: 9,  carbs: 13, grasas: 7,  porcion: "170g" },
        { nombre: "Pollo con Vegetales",          calorias: 180, proteinas: 19, carbs: 13, grasas: 6,  porcion: "170g" },
        { nombre: "Fried Rice",                   calorias: 620, proteinas: 18, carbs: 98, grasas: 16, porcion: "525g" },
      ],
    },
    {
      nombre: "Itsu",
      platos: [
        { nombre: "Gyoza de Cerdo (6 piezas)",    calorias: 240, proteinas: 12, carbs: 28, grasas: 8,  porcion: "140g" },
        { nombre: "Salmon Avocado Roll",          calorias: 320, proteinas: 14, carbs: 44, grasas: 10, porcion: "160g" },
        { nombre: "Yasai Fried Rice",             calorias: 380, proteinas: 12, carbs: 70, grasas: 7,  porcion: "290g" },
        { nombre: "Ramen Miso con Pollo",         calorias: 440, proteinas: 28, carbs: 54, grasas: 12, porcion: "380g" },
      ],
    },
  ],

  japonesa: [
    {
      nombre: "Wagamama",
      platos: [
        { nombre: "Chicken Katsu Curry",          calorias: 723, proteinas: 37, carbs: 87, grasas: 24, porcion: "530g" },
        { nombre: "Ramen de Pollo",               calorias: 520, proteinas: 34, carbs: 60, grasas: 16, porcion: "480g" },
        { nombre: "Yaki Udon",                    calorias: 520, proteinas: 24, carbs: 70, grasas: 14, porcion: "420g" },
        { nombre: "Teriyaki Soba",                calorias: 490, proteinas: 32, carbs: 60, grasas: 12, porcion: "380g" },
        { nombre: "Edamame",                      calorias: 140, proteinas: 12, carbs: 10, grasas: 6,  porcion: "140g" },
      ],
    },
    {
      nombre: "Yo Sushi",
      platos: [
        { nombre: "California Roll (8 piezas)",   calorias: 280, proteinas: 10, carbs: 44, grasas: 6,  porcion: "180g" },
        { nombre: "Gyoza (6 piezas)",             calorias: 220, proteinas: 10, carbs: 26, grasas: 8,  porcion: "130g" },
        { nombre: "Donburi de Salmón",            calorias: 560, proteinas: 28, carbs: 74, grasas: 16, porcion: "380g" },
        { nombre: "Edamame",                      calorias: 140, proteinas: 12, carbs: 10, grasas: 6,  porcion: "140g" },
        { nombre: "Yasai Bento",                  calorias: 490, proteinas: 16, carbs: 78, grasas: 14, porcion: "350g" },
      ],
    },
    {
      nombre: "Itsu",
      platos: [
        { nombre: "Salmon Avocado Roll",          calorias: 320, proteinas: 14, carbs: 44, grasas: 10, porcion: "160g" },
        { nombre: "Ramen Miso con Pollo",         calorias: 440, proteinas: 28, carbs: 54, grasas: 12, porcion: "380g" },
        { nombre: "Gyoza de Cerdo (6 piezas)",    calorias: 240, proteinas: 12, carbs: 28, grasas: 8,  porcion: "140g" },
        { nombre: "Poké Bowl de Salmón",          calorias: 510, proteinas: 26, carbs: 66, grasas: 14, porcion: "380g" },
      ],
    },
  ],

  mexicana: [
    {
      nombre: "Taco Bell",
      platos: [
        { nombre: "Crunch Wrap Supreme",          calorias: 530, proteinas: 20, carbs: 68, grasas: 20, porcion: "263g" },
        { nombre: "Chalupa Supreme",              calorias: 360, proteinas: 14, carbs: 40, grasas: 17, porcion: "174g" },
        { nombre: "Beefy 5-Layer Burrito",        calorias: 490, proteinas: 19, carbs: 65, grasas: 17, porcion: "248g" },
        { nombre: "Doritos Locos Tacos",          calorias: 170, proteinas: 8,  carbs: 15, grasas: 9,  porcion: "99g"  },
        { nombre: "Mexican Pizza",                calorias: 540, proteinas: 20, carbs: 52, grasas: 28, porcion: "216g" },
      ],
    },
    {
      nombre: "Chipotle",
      platos: [
        { nombre: "Burrito de Pollo",             calorias: 590, proteinas: 36, carbs: 71, grasas: 16, porcion: "420g" },
        { nombre: "Bowl de Carnitas",             calorias: 480, proteinas: 36, carbs: 55, grasas: 12, porcion: "380g" },
        { nombre: "Tacos de Barbacoa (3)",        calorias: 390, proteinas: 30, carbs: 40, grasas: 11, porcion: "280g" },
        { nombre: "Bowl Veggie",                  calorias: 380, proteinas: 14, carbs: 64, grasas: 10, porcion: "360g" },
        { nombre: "Quesadilla de Pollo",          calorias: 650, proteinas: 38, carbs: 52, grasas: 30, porcion: "300g" },
      ],
    },
  ],

  carnes: [
    {
      nombre: "Foster's Hollywood",
      platos: [
        { nombre: "T-Bone Steak",                 calorias: 660, proteinas: 58, carbs: 8,  grasas: 42, porcion: "350g" },
        { nombre: "Ribs 1/2 rack",                calorias: 680, proteinas: 42, carbs: 36, grasas: 40, porcion: "400g" },
        { nombre: "Hamburguesa Clásica",          calorias: 580, proteinas: 34, carbs: 42, grasas: 30, porcion: "270g" },
        { nombre: "Alitas de Pollo BBQ",          calorias: 490, proteinas: 32, carbs: 24, grasas: 29, porcion: "290g" },
        { nombre: "Nachos con Cheddar",           calorias: 620, proteinas: 18, carbs: 62, grasas: 34, porcion: "320g" },
      ],
    },
    {
      nombre: "TGI Fridays",
      platos: [
        { nombre: "Jack Daniel's Ribs (media)",   calorias: 780, proteinas: 48, carbs: 56, grasas: 38, porcion: "480g" },
        { nombre: "Mega Burger",                  calorias: 760, proteinas: 44, carbs: 52, grasas: 40, porcion: "380g" },
        { nombre: "Pasta Pollo y Setas",          calorias: 650, proteinas: 32, carbs: 72, grasas: 24, porcion: "420g" },
        { nombre: "Alitas BBQ (12 piezas)",       calorias: 570, proteinas: 36, carbs: 28, grasas: 34, porcion: "360g" },
        { nombre: "Nachos Tex-Mex",               calorias: 680, proteinas: 22, carbs: 68, grasas: 38, porcion: "360g" },
      ],
    },
    {
      nombre: "Outback Steakhouse",
      platos: [
        { nombre: "Rib-Eye Steak 350g",           calorias: 680, proteinas: 55, carbs: 4,  grasas: 48, porcion: "350g" },
        { nombre: "Chicken on the Barbie",        calorias: 410, proteinas: 46, carbs: 10, grasas: 20, porcion: "280g" },
        { nombre: "Salmon Asado",                 calorias: 460, proteinas: 42, carbs: 8,  grasas: 28, porcion: "280g" },
        { nombre: "Ribs de Cerdo Completas",      calorias: 1200, proteinas: 76, carbs: 52, grasas: 78, porcion: "700g" },
      ],
    },
  ],

  española: [
    {
      nombre: "Telepizza",
      platos: [
        { nombre: "Margarita individual",         calorias: 550, proteinas: 25, carbs: 70, grasas: 18, porcion: "240g" },
        { nombre: "Cuatro Quesos individual",     calorias: 620, proteinas: 28, carbs: 68, grasas: 26, porcion: "260g" },
        { nombre: "Pollo y Champiñones individual",calorias:590, proteinas: 30, carbs: 70, grasas: 20, porcion: "260g" },
        { nombre: "Mozzarella Sticks (6 piezas)", calorias: 390, proteinas: 18, carbs: 36, grasas: 19, porcion: "145g" },
      ],
    },
    {
      nombre: "TGB – The Good Burger",
      platos: [
        { nombre: "La Original",                  calorias: 520, proteinas: 30, carbs: 42, grasas: 26, porcion: "238g" },
        { nombre: "Crispy Pollo",                 calorias: 490, proteinas: 28, carbs: 48, grasas: 20, porcion: "238g" },
        { nombre: "La Veggie",                    calorias: 450, proteinas: 18, carbs: 52, grasas: 18, porcion: "230g" },
        { nombre: "Patatas Fritas",               calorias: 310, proteinas: 4,  carbs: 41, grasas: 14, porcion: "115g" },
        { nombre: "Aros de Cebolla",              calorias: 280, proteinas: 4,  carbs: 34, grasas: 14, porcion: "110g" },
      ],
    },
    {
      nombre: "McDonald's",
      platos: [
        { nombre: "Big Mac",                      calorias: 496, proteinas: 25, carbs: 46, grasas: 24, porcion: "203g" },
        { nombre: "McPollo",                      calorias: 393, proteinas: 26, carbs: 40, grasas: 13, porcion: "172g" },
        { nombre: "Cuarto de Libra con Queso",    calorias: 480, proteinas: 27, carbs: 42, grasas: 21, porcion: "194g" },
        { nombre: "Patatas Fritas Medianas",      calorias: 342, proteinas: 4,  carbs: 44, grasas: 16, porcion: "114g" },
      ],
    },
  ],

  mediterranea: [
    {
      nombre: "Nando's",
      platos: [
        { nombre: "1/2 Pollo Asado",              calorias: 490, proteinas: 56, carbs: 8,  grasas: 26, porcion: "320g" },
        { nombre: "Burger Suprema de Pollo",      calorias: 560, proteinas: 34, carbs: 44, grasas: 27, porcion: "260g" },
        { nombre: "Pita de Pollo",                calorias: 420, proteinas: 30, carbs: 38, grasas: 16, porcion: "240g" },
        { nombre: "Patatas Fritas",               calorias: 370, proteinas: 5,  carbs: 58, grasas: 14, porcion: "225g" },
        { nombre: "Corn on the Cob",              calorias: 240, proteinas: 6,  carbs: 42, grasas: 6,  porcion: "180g" },
      ],
    },
    {
      nombre: "Pret A Manger",
      platos: [
        { nombre: "Falafel Wrap",                 calorias: 480, proteinas: 18, carbs: 60, grasas: 18, porcion: "270g" },
        { nombre: "Baguette Pollo Pesto",         calorias: 490, proteinas: 28, carbs: 52, grasas: 18, porcion: "270g" },
        { nombre: "Ensalada Súper Greens",        calorias: 280, proteinas: 18, carbs: 24, grasas: 12, porcion: "330g" },
        { nombre: "Sopa de Tomate",               calorias: 240, proteinas: 5,  carbs: 34, grasas: 10, porcion: "340g" },
      ],
    },
    {
      nombre: "McDonald's",
      platos: [
        { nombre: "Wrap de Pollo",                calorias: 440, proteinas: 28, carbs: 48, grasas: 16, porcion: "210g" },
        { nombre: "McPollo",                      calorias: 393, proteinas: 26, carbs: 40, grasas: 13, porcion: "172g" },
        { nombre: "Ensalada César con McPollo",   calorias: 290, proteinas: 26, carbs: 14, grasas: 15, porcion: "290g" },
      ],
    },
  ],

  americana: [
    {
      nombre: "TGI Fridays",
      platos: [
        { nombre: "Jack Daniel's Ribs (media)",   calorias: 780, proteinas: 48, carbs: 56, grasas: 38, porcion: "480g" },
        { nombre: "Mega Burger",                  calorias: 760, proteinas: 44, carbs: 52, grasas: 40, porcion: "380g" },
        { nombre: "Pasta Pollo y Setas",          calorias: 650, proteinas: 32, carbs: 72, grasas: 24, porcion: "420g" },
        { nombre: "Alitas BBQ (12 piezas)",       calorias: 570, proteinas: 36, carbs: 28, grasas: 34, porcion: "360g" },
        { nombre: "Brownie con Helado",           calorias: 560, proteinas: 6,  carbs: 70, grasas: 28, porcion: "180g" },
      ],
    },
    {
      nombre: "Applebee's",
      platos: [
        { nombre: "Classic Burger",               calorias: 700, proteinas: 36, carbs: 54, grasas: 38, porcion: "350g" },
        { nombre: "Double Crunch Shrimp",         calorias: 590, proteinas: 28, carbs: 60, grasas: 26, porcion: "300g" },
        { nombre: "Grilled Chicken",              calorias: 380, proteinas: 46, carbs: 12, grasas: 16, porcion: "260g" },
        { nombre: "Riblet Platter",               calorias: 840, proteinas: 46, carbs: 68, grasas: 42, porcion: "480g" },
      ],
    },
    {
      nombre: "Denny's",
      platos: [
        { nombre: "Grand Slam Desayuno",          calorias: 740, proteinas: 36, carbs: 68, grasas: 38, porcion: "430g" },
        { nombre: "Pancakes (3 unidades)",        calorias: 640, proteinas: 12, carbs: 98, grasas: 22, porcion: "290g" },
        { nombre: "Classic Burger",               calorias: 660, proteinas: 32, carbs: 52, grasas: 34, porcion: "320g" },
        { nombre: "Mozzarella Sticks",            calorias: 630, proteinas: 28, carbs: 58, grasas: 32, porcion: "280g" },
      ],
    },
  ],

  francesa: [
    {
      nombre: "Le Pain Quotidien",
      platos: [
        { nombre: "Tartine de Salmón Ahumado",    calorias: 480, proteinas: 26, carbs: 46, grasas: 22, porcion: "260g" },
        { nombre: "Croque Monsieur",              calorias: 520, proteinas: 24, carbs: 48, grasas: 24, porcion: "250g" },
        { nombre: "Quiche Lorraine",              calorias: 440, proteinas: 18, carbs: 32, grasas: 28, porcion: "200g" },
        { nombre: "Sopa de Cebolla Gratinada",    calorias: 360, proteinas: 14, carbs: 40, grasas: 16, porcion: "380g" },
        { nombre: "Pain au Chocolat",             calorias: 320, proteinas: 7,  carbs: 38, grasas: 16, porcion: "90g"  },
      ],
    },
    {
      nombre: "Pret A Manger",
      platos: [
        { nombre: "Croissant de Mantequilla",     calorias: 290, proteinas: 6,  carbs: 30, grasas: 16, porcion: "73g"  },
        { nombre: "Baguette Jamón y Mostaza",     calorias: 420, proteinas: 22, carbs: 44, grasas: 16, porcion: "220g" },
        { nombre: "Quiche de Espinacas y Feta",   calorias: 400, proteinas: 16, carbs: 28, grasas: 26, porcion: "185g" },
        { nombre: "Madeleines (2 unidades)",      calorias: 290, proteinas: 4,  carbs: 36, grasas: 14, porcion: "70g"  },
      ],
    },
    {
      nombre: "McDonald's",
      platos: [
        { nombre: "Croque McDo",                  calorias: 410, proteinas: 20, carbs: 44, grasas: 18, porcion: "195g" },
        { nombre: "McCafé Pain au Chocolat",      calorias: 340, proteinas: 7,  carbs: 44, grasas: 16, porcion: "100g" },
        { nombre: "P'tit Déjeuner Complet",       calorias: 580, proteinas: 20, carbs: 68, grasas: 26, porcion: "290g" },
      ],
    },
  ],

  alemana: [
    {
      nombre: "Nordsee",
      platos: [
        { nombre: "Filete de Bacalao",            calorias: 390, proteinas: 28, carbs: 36, grasas: 14, porcion: "240g" },
        { nombre: "Gambas a la Plancha",          calorias: 280, proteinas: 32, carbs: 8,  grasas: 14, porcion: "200g" },
        { nombre: "Fish & Chips",                 calorias: 560, proteinas: 24, carbs: 60, grasas: 24, porcion: "340g" },
        { nombre: "Sandwich de Salmón",           calorias: 440, proteinas: 24, carbs: 44, grasas: 18, porcion: "230g" },
      ],
    },
    {
      nombre: "Vapiano",
      platos: [
        { nombre: "Spaghetti Carbonara",          calorias: 820, proteinas: 36, carbs: 88, grasas: 36, porcion: "430g" },
        { nombre: "Pasta Bolognesa",              calorias: 760, proteinas: 34, carbs: 84, grasas: 28, porcion: "420g" },
        { nombre: "Pizza Prosciutto",             calorias: 680, proteinas: 32, carbs: 72, grasas: 28, porcion: "310g" },
        { nombre: "Risotto de Champiñones",       calorias: 580, proteinas: 18, carbs: 78, grasas: 20, porcion: "380g" },
      ],
    },
    {
      nombre: "McDonald's",
      platos: [
        { nombre: "Big Mac",                      calorias: 496, proteinas: 25, carbs: 46, grasas: 24, porcion: "203g" },
        { nombre: "Currywurst con Patatas",       calorias: 560, proteinas: 22, carbs: 56, grasas: 28, porcion: "290g" },
        { nombre: "Patatas Fritas Medianas",      calorias: 342, proteinas: 4,  carbs: 44, grasas: 16, porcion: "114g" },
      ],
    },
  ],

  vegetariana: [
    {
      nombre: "Pret A Manger",
      platos: [
        { nombre: "Falafel Wrap",                 calorias: 480, proteinas: 18, carbs: 60, grasas: 18, porcion: "270g" },
        { nombre: "Ensalada Súper Greens",        calorias: 280, proteinas: 18, carbs: 24, grasas: 12, porcion: "330g" },
        { nombre: "Bowl de Edamame y Quinoa",     calorias: 420, proteinas: 22, carbs: 52, grasas: 14, porcion: "360g" },
        { nombre: "Sopa de Tomate y Albahaca",    calorias: 240, proteinas: 5,  carbs: 34, grasas: 10, porcion: "340g" },
        { nombre: "Croissant de Espinacas y Feta",calorias: 380, proteinas: 12, carbs: 38, grasas: 20, porcion: "145g" },
      ],
    },
    {
      nombre: "Chipotle",
      platos: [
        { nombre: "Bowl Veggie (Sofritas)",       calorias: 380, proteinas: 14, carbs: 64, grasas: 10, porcion: "360g" },
        { nombre: "Burrito Veggie",               calorias: 490, proteinas: 16, carbs: 80, grasas: 12, porcion: "400g" },
        { nombre: "Tacos de Frijoles (3)",        calorias: 350, proteinas: 12, carbs: 56, grasas: 8,  porcion: "280g" },
        { nombre: "Ensalada de Sofritas",         calorias: 300, proteinas: 14, carbs: 40, grasas: 12, porcion: "340g" },
      ],
    },
    {
      nombre: "Subway",
      platos: [
        { nombre: "Veggie Delite 30cm",           calorias: 360, proteinas: 14, carbs: 62, grasas: 6,  porcion: "238g" },
        { nombre: "Veggie Patty 30cm",            calorias: 480, proteinas: 24, carbs: 64, grasas: 14, porcion: "270g" },
        { nombre: "Ensalada Veggie Delite",       calorias: 130, proteinas: 6,  carbs: 20, grasas: 2,  porcion: "230g" },
      ],
    },
    {
      nombre: "McDonald's",
      platos: [
        { nombre: "McVeggie",                     calorias: 395, proteinas: 18, carbs: 52, grasas: 13, porcion: "200g" },
        { nombre: "Ensalada de Frutas",           calorias: 120, proteinas: 2,  carbs: 28, grasas: 0,  porcion: "160g" },
        { nombre: "McFlurry Oreo",                calorias: 342, proteinas: 7,  carbs: 51, grasas: 12, porcion: "166g" },
      ],
    },
  ],
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const category = ((req.query && req.query.category) || "").trim();
  if (!category) {
    res.status(400).json({ error: "category is required", restaurantes: [] });
    return;
  }

  const restaurantes = DB[category];
  if (!restaurantes) {
    res.status(400).json({ error: "unknown category", restaurantes: [] });
    return;
  }

  res.status(200).json({ restaurantes });
};
