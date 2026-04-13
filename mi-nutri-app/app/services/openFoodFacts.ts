import { Nutrientes } from "./calcularMacros";
import { buscarAlimentoPorCodigo, buscarAlimentosPersonalizados, guardarProductoEscaneado } from "./supabase";

const USDA_API_KEY = "zZ5WbhNqDzYmCy70MjhziQVbfZmLKH0aAyFgKNpX";

let _userLanguage = "es";
export function setUserLanguage(lang: string) { _userLanguage = lang; }
export function getUserLanguage() { return _userLanguage; }

export type Producto = {
  nombre: string;
  supermercado: string;
  marca: string;
  nutrientes: Nutrientes;
  pesoEnvase?: number;
  esPersonalizado?: boolean;
};

// ── QR nutricional ────────────────────────────────────────────────────────────
export function parsearQRNutricional(data: string): Producto | null {
  const trimmed = data.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj.calorias !== undefined || obj.calories !== undefined) {
        return {
          nombre: obj.nombre || obj.name || "Producto QR",
          marca: obj.marca || obj.brand || "Sin marca",
          supermercado: "Marca desconocida",
          pesoEnvase: Number(obj.pesoEnvase || obj.weight || 0) || undefined,
          nutrientes: {
            calorias: Number(obj.calorias ?? obj.calories ?? 0),
            proteinas: Number(obj.proteinas ?? obj.proteins ?? obj.protein ?? 0),
            grasas: Number(obj.grasas ?? obj.fat ?? 0),
            grasasSaturadas: Number(obj.grasasSaturadas ?? obj.saturatedFat ?? 0),
            carbohidratos: Number(obj.carbohidratos ?? obj.carbs ?? obj.carbohydrates ?? 0),
            azucares: Number(obj.azucares ?? obj.sugars ?? 0),
            fibra: Number(obj.fibra ?? obj.fiber ?? 0),
            sal: Number(obj.sal ?? obj.salt ?? 0),
          },
        };
      }
    } catch {}
  }
  if (trimmed.includes("=")) {
    const obj: Record<string, string> = {};
    for (const par of trimmed.split(/[|&\n]/)) {
      const [k, v] = par.split("=");
      if (k && v) obj[k.trim().toLowerCase()] = v.trim();
    }
    if (obj.calorias || obj.calories || obj.kcal) {
      return {
        nombre: obj.nombre || obj.name || "Producto QR",
        marca: obj.marca || obj.brand || "Sin marca",
        supermercado: "Marca desconocida",
        pesoEnvase: Number(obj.pesoenvase || obj.weight || 0) || undefined,
        nutrientes: {
          calorias: Number(obj.calorias ?? obj.calories ?? obj.kcal ?? 0),
          proteinas: Number(obj.proteinas ?? obj.proteins ?? obj.protein ?? 0),
          grasas: Number(obj.grasas ?? obj.fat ?? 0),
          grasasSaturadas: Number(obj.grasassaturadas ?? obj.saturatedfat ?? 0),
          carbohidratos: Number(obj.carbohidratos ?? obj.carbs ?? obj.carbohydrates ?? 0),
          azucares: Number(obj.azucares ?? obj.sugars ?? 0),
          fibra: Number(obj.fibra ?? obj.fiber ?? 0),
          sal: Number(obj.sal ?? obj.salt ?? 0),
        },
      };
    }
  }
  return null;
}

// ── Helpers OFF ───────────────────────────────────────────────────────────────
function extraerSupermercado(p: any): string {
  const tiendas: Record<string, string> = {
    mercadona: "Mercadona", hacendado: "Mercadona", carrefour: "Carrefour",
    lidl: "Lidl", simply: "Simply", alcampo: "Alcampo", dia: "DIA",
    eroski: "Eroski", condis: "Condis", hipercor: "Hipercor",
    "el corte ingles": "El Corte Inglés", "el corte inglés": "El Corte Inglés",
    aldi: "Aldi", consum: "Consum", caprabo: "Caprabo", bonpreu: "Bonpreu",
    ahorramas: "Ahorramas", gadis: "Gadis", spar: "Spar", coviran: "Covirán",
  };
  const texto = [p.brands || "", p.stores || "", p.owner || "", p.manufacturing_places || ""]
    .join(" ").toLowerCase();
  for (const [key, val] of Object.entries(tiendas)) {
    if (texto.includes(key)) return val;
  }
  if (p.brands) return p.brands.split(",")[0].trim();
  return "Marca desconocida";
}

function extraerNutrientesOFF(n: any): Nutrientes {
  return {
    calorias: n["energy-kcal_100g"] ?? n["energy_100g"] ??
      (n["energy-kj_100g"] ? Math.round(n["energy-kj_100g"] / 4.184) : 0),
    proteinas: n["proteins_100g"] ?? 0,
    grasas: n["fat_100g"] ?? 0,
    grasasSaturadas: n["saturated-fat_100g"] ?? 0,
    carbohidratos: n["carbohydrates_100g"] ?? 0,
    azucares: n["sugars_100g"] ?? 0,
    fibra: n["fiber_100g"] ?? 0,
    sal: n["salt_100g"] ?? 0,
  };
}

function extraerPesoEnvase(p: any): number | undefined {
  const raw = p.product_quantity || p.quantity || "";
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const val = Number(match[1]);
    if (val > 0 && val < 5000) return val;
  }
  return undefined;
}

function productoDesdeOFF(p: any): Producto | null {
  const nombre = p.product_name_es || p.product_name || p.abbreviated_product_name || "";
  if (!nombre) return null;
  const n = p.nutriments || {};
  const tieneCalorias = n["energy-kcal_100g"] || n["energy_100g"] || n["energy-kj_100g"];
  if (!tieneCalorias) return null;
  return {
    nombre,
    marca: p.brands?.split(",")[0].trim() || "Sin marca",
    supermercado: extraerSupermercado(p),
    pesoEnvase: extraerPesoEnvase(p),
    nutrientes: extraerNutrientesOFF(n),
  };
}

// ── Helpers USDA ──────────────────────────────────────────────────────────────
function getNutrienteUSDA(nutrientes: any[], id: number): number {
  const n = nutrientes.find((x: any) => x.nutrientId === id || x.nutrient?.id === id);
  return n ? Number(n.value ?? n.amount ?? 0) : 0;
}

function productoDesdeUSDA(item: any): Producto | null {
  try {
    const nombre = item.description || item.lowercaseDescription || "";
    if (!nombre) return null;
    const nutrientes = item.foodNutrients || [];
    const calorias = getNutrienteUSDA(nutrientes, 1008) || getNutrienteUSDA(nutrientes, 2047);
    if (!calorias) return null;
    const marca = item.brandOwner || item.brandName || "Sin marca";
    const supermercado = (() => {
      const texto = (marca + " " + (item.brandOwner || "")).toLowerCase();
      const tiendas: Record<string, string> = {
        mercadona: "Mercadona", hacendado: "Mercadona", carrefour: "Carrefour",
        lidl: "Lidl", alcampo: "Alcampo", dia: "DIA", aldi: "Aldi",
      };
      for (const [key, val] of Object.entries(tiendas)) {
        if (texto.includes(key)) return val;
      }
      if (marca !== "Sin marca") return marca;
      return "USDA";
    })();
    return {
      nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase(),
      marca,
      supermercado,
      nutrientes: {
        calorias,
        proteinas: getNutrienteUSDA(nutrientes, 1003),
        grasas: getNutrienteUSDA(nutrientes, 1004),
        grasasSaturadas: getNutrienteUSDA(nutrientes, 1258),
        carbohidratos: getNutrienteUSDA(nutrientes, 1005),
        azucares: getNutrienteUSDA(nutrientes, 2000) || getNutrienteUSDA(nutrientes, 1063),
        fibra: getNutrienteUSDA(nutrientes, 1079),
        sal: +(getNutrienteUSDA(nutrientes, 1093) / 400).toFixed(3),
      },
    };
  } catch { return null; }
}

// ── Utilidades de texto ───────────────────────────────────────────────────────
function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const STOP_WORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "con", "sin", "en", "a", "al", "y", "o", "para", "por",
]);

const TRADUCCIONES: Record<string, string> = {
  "tortita": "rice cake", "tortitas": "rice cakes",
  "maiz": "corn", "maíz": "corn",
  "avena": "oats", "arroz": "rice",
  "pollo": "chicken", "pechuga": "chicken breast",
  "ternera": "beef", "cerdo": "pork",
  "salmon": "salmon", "salmón": "salmon",
  "atun": "tuna", "atún": "tuna",
  "huevo": "egg", "huevos": "eggs",
  "leche": "milk", "yogur": "yogurt",
  "queso": "cheese", "mantequilla": "butter",
  "pan": "bread", "pasta": "pasta",
  "patata": "potato", "patatas": "potatoes",
  "tomate": "tomato", "lechuga": "lettuce",
  "zanahoria": "carrot", "cebolla": "onion",
  "espinacas": "spinach", "brocoli": "broccoli", "brócoli": "broccoli",
  "almendra": "almond", "almendras": "almonds",
  "nuez": "walnut", "nueces": "walnuts",
  "aceite": "oil", "oliva": "olive",
  "lenteja": "lentil", "lentejas": "lentils",
  "garbanzo": "chickpea", "garbanzos": "chickpeas",
  "platano": "banana", "plátano": "banana",
  "manzana": "apple", "naranja": "orange",
  "fresa": "strawberry", "fresas": "strawberries",
  "chocolate": "chocolate", "galleta": "cookie", "galletas": "cookies",
  "jamon": "ham", "jamón": "ham",
  "proteina": "protein", "proteína": "protein",
  "integral": "whole grain",
};

function traducirAlIngles(texto: string): string {
  return texto.toLowerCase().split(/\s+/)
    .map(p => TRADUCCIONES[p] || TRADUCCIONES[sinTildes(p)] || p)
    .join(" ");
}

function extraerPalabrasClave(texto: string): string[] {
  return texto.toLowerCase().split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function generarTerminosBusqueda(nombre: string): string[] {
  const terminos = new Set<string>();
  const nombreLower = nombre.toLowerCase().trim();
  const nombreSinTildes = sinTildes(nombreLower);
  const nombreIngles = traducirAlIngles(nombreLower);

  terminos.add(nombreLower);
  terminos.add(nombreSinTildes);
  terminos.add(nombreIngles);

  const palabras = extraerPalabrasClave(nombreLower).filter(p => p.length > 3);
  for (let i = 0; i < palabras.length - 1; i++) {
    const bigrama = `${palabras[i]} ${palabras[i + 1]}`;
    terminos.add(bigrama);
    terminos.add(sinTildes(bigrama));
    terminos.add(traducirAlIngles(bigrama));
  }
  for (const p of palabras) {
    const traducida = TRADUCCIONES[p] || TRADUCCIONES[sinTildes(p)];
    if (traducida) terminos.add(traducida);
    terminos.add(sinTildes(p));
  }

  return Array.from(terminos).filter(t => t.trim().length > 2);
}

// ── Búsqueda en OFF ───────────────────────────────────────────────────────────
async function fetchOFF(termino: string, signal: AbortSignal): Promise<Producto[]> {
  const enc = encodeURIComponent(termino);
  const peticiones = [
    fetch(`https://es.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=24&sort_by=unique_scans_n`, { signal }),
    fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=24&sort_by=unique_scans_n`, { signal }),
  ];
  const resultados = await Promise.allSettled(peticiones);
  const vistos = new Set<string>();
  const productos: Producto[] = [];
  for (const r of resultados) {
    if (r.status !== "fulfilled") continue;
    try {
      const data = await r.value.json();
      for (const p of data.products || []) {
        const prod = productoDesdeOFF(p);
        if (!prod) continue;
        const key = prod.nombre.toLowerCase();
        if (vistos.has(key)) continue;
        vistos.add(key);
        productos.push(prod);
      }
    } catch {}
  }
  return productos;
}

// ── Búsqueda en USDA ──────────────────────────────────────────────────────────
async function fetchUSDA(termino: string, signal: AbortSignal): Promise<Producto[]> {
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(termino)}&pageSize=20&dataType=Branded,Foundation,SR%20Legacy&api_key=${USDA_API_KEY}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    const vistos = new Set<string>();
    const productos: Producto[] = [];
    for (const item of data.foods || []) {
      const prod = productoDesdeUSDA(item);
      if (!prod) continue;
      const key = prod.nombre.toLowerCase();
      if (vistos.has(key)) continue;
      vistos.add(key);
      productos.push(prod);
    }
    return productos;
  } catch { return []; }
}

// ── Convierte AlimentoPersonalizado de Supabase a Producto ───────────────────
function alimentoSupabaseAProducto(a: any): Producto {
  return {
    nombre: a.nombre,
    marca: a.marca || "Sin marca",
    supermercado: a.supermercado || "Personalizado",
    esPersonalizado: true,
    pesoEnvase: a.peso_envase,
    nutrientes: {
      calorias: Number(a.calorias) || 0,
      proteinas: Number(a.proteinas) || 0,
      grasas: Number(a.grasas) || 0,
      grasasSaturadas: Number(a.grasas_saturadas) || 0,
      carbohidratos: Number(a.carbohidratos) || 0,
      azucares: Number(a.azucares) || 0,
      fibra: Number(a.fibra) || 0,
      sal: Number(a.sal) || 0,
    },
  };
}

// ── Guardar producto en Supabase en segundo plano ─────────────────────────────
function guardarEnSegundoPlano(prod: Producto, codigo: string) {
  guardarProductoEscaneado({
    nombre: prod.nombre,
    marca: prod.marca,
    supermercado: prod.supermercado,
    calorias: prod.nutrientes.calorias,
    proteinas: prod.nutrientes.proteinas,
    grasas: prod.nutrientes.grasas,
    grasas_saturadas: prod.nutrientes.grasasSaturadas,
    carbohidratos: prod.nutrientes.carbohidratos,
    azucares: prod.nutrientes.azucares,
    fibra: prod.nutrientes.fibra,
    sal: prod.nutrientes.sal,
    peso_envase: prod.pesoEnvase,
    codigo_barras: codigo,
    es_compartido: true,
  }).catch(() => {});
}

// ── Buscar por código de barras ───────────────────────────────────────────────
// Orden: Supabase compartida → QR nutricional → OFF → USDA
// Si encuentra en OFF/USDA lo guarda en Supabase para que otros lo vean por nombre
export async function buscarDesdeEscaneo(codigoEscaneado: string): Promise<Producto | null> {
  const data = codigoEscaneado.trim();

  // 1. Buscar en Supabase — base compartida entre todos los usuarios
  try {
    const enSupabase = await buscarAlimentoPorCodigo(data);
    if (enSupabase) return alimentoSupabaseAProducto(enSupabase);
  } catch {}

  // 2. URL de OpenFoodFacts en el QR
  const offMatch = data.match(/openfoodfacts\.org\/product\/(\d+)/i);
  if (offMatch) {
    const prod = await buscarProductoPorCodigo(offMatch[1]);
    if (prod) guardarEnSegundoPlano(prod, offMatch[1]);
    return prod;
  }

  // 3. QR con datos nutricionales JSON o key=value
  const qr = parsearQRNutricional(data);
  if (qr) return qr;

  // 4. Código numérico → buscar en OFF y USDA
  const prod = await buscarProductoPorCodigo(data);
  if (prod) guardarEnSegundoPlano(prod, data);
  return prod;
}

export async function buscarProductoPorCodigo(codigo: string): Promise<Producto | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const [offEs, offWorld, usdaRes] = await Promise.allSettled([
      fetch(`https://es.openfoodfacts.org/api/v0/product/${codigo}.json`, { signal: controller.signal }).then(r => r.json()),
      fetch(`https://world.openfoodfacts.org/api/v0/product/${codigo}.json`, { signal: controller.signal }).then(r => r.json()),
      fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${codigo}&dataType=Branded&api_key=${USDA_API_KEY}`, { signal: controller.signal }).then(r => r.json()),
    ]);
    clearTimeout(timeout);

    for (const r of [offEs, offWorld]) {
      if (r.status !== "fulfilled") continue;
      const data = r.value;
      if (data.status === 0 || !data.product) continue;
      const prod = productoDesdeOFF(data.product);
      if (prod) return prod;
    }

    if (usdaRes.status === "fulfilled") {
      const foods = usdaRes.value.foods || [];
      const match = foods.find((f: any) =>
        f.gtinUpc === codigo || f.gtinUpc === codigo.padStart(14, "0")
      );
      if (match) {
        const prod = productoDesdeUSDA(match);
        if (prod) return prod;
      }
    }
  } catch { clearTimeout(timeout); }
  return null;
}

// ── Búsqueda por nombre ───────────────────────────────────────────────────────
// Orden: Supabase compartida → OFF → USDA con múltiples variantes
export async function buscarProductosPorNombre(nombre: string): Promise<Producto[]> {
  const vistos = new Set<string>();
  const todos: Producto[] = [];

  // 1. Primero buscar en Supabase — productos escaneados por todos los usuarios
  try {
    const deSupabase = await buscarAlimentosPersonalizados(nombre);
    for (const a of deSupabase) {
      const key = sinTildes(a.nombre.toLowerCase());
      if (vistos.has(key)) continue;
      vistos.add(key);
      todos.push(alimentoSupabaseAProducto(a));
    }
  } catch {}

  // 2. Buscar en OFF y USDA con múltiples variantes en paralelo
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const terminos = generarTerminosBusqueda(nombre);
    const peticiones = terminos.flatMap(t => [
      fetchOFF(t, controller.signal),
      fetchUSDA(t, controller.signal),
    ]);

    const resultados = await Promise.allSettled(peticiones);
    clearTimeout(timeout);

    const nombreNorm = sinTildes(nombre.toLowerCase());
    const conMatch: Producto[] = [];
    const sinMatch: Producto[] = [];

    for (const r of resultados) {
      if (r.status !== "fulfilled") continue;
      for (const prod of r.value) {
        const key = sinTildes(prod.nombre.toLowerCase());
        if (vistos.has(key)) continue;
        vistos.add(key);
        const palabrasClave = extraerPalabrasClave(nombreNorm);
        const coincide = palabrasClave.some(p => key.includes(p));
        if (coincide) conMatch.push(prod);
        else sinMatch.push(prod);
      }
    }

    todos.push(...conMatch, ...sinMatch);
  } catch { clearTimeout(timeout); }

  return todos;
}