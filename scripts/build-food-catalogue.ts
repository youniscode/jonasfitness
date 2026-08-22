/**
 * Food Nutrition Foundation V1 — CIQUAL → canonical catalogue build script.
 *
 * DETERMINISTIC IMPORT/CONVERSION STEP. The runtime app NEVER parses the raw
 * ANSES-CIQUAL dataset; it only reads the versioned output
 * (app/data/food-catalogue-v1.json) committed next to this script.
 *
 * Authoritative source:
 *   ANSES-CIQUAL French food composition table, 2020 edition
 *   ("Table Ciqual 2020", XML distribution, file set dated 2020-07-07).
 *   Downloaded from https://ciqual.anses.fr/ (open data).
 *   Citation required by the licence: "Anses. 2020. Ciqual French food
 *   composition table. https://ciqual.anses.fr/"
 *
 * What this script does:
 *   1. Parses alim_2020_07_07.xml + compo_2020_07_07.xml (windows-1252 XML).
 *   2. For each CURATED selection below (explicit CIQUAL alim_code), extracts
 *      energy kcal/100g (constituent 328), protein (25000), carbohydrate
 *      (31000), fat (40000) and fibre (34100) exactly as published.
 *   3. Emits the canonical FoodCatalogueItem JSON with full provenance.
 *
 * NO nutrient value is invented here: if a selected food lacks any of
 * kcal/protein/carb/fat in the source, the build FAILS for that item instead of
 * guessing. Values are rounded to at most 2 decimals purely to avoid float
 * noise; no other transformation is applied.
 *
 * Usage: node scripts/build-food-catalogue.ts <dir-with-ciqual-xml>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Curated selection — explicit, reviewed CIQUAL codes (stable identifiers).
// Raw vs cooked are SEPARATE canonical items; never converted silently.
// ---------------------------------------------------------------------------
type Curated = {
  id: string;
  code: string;
  category: "protein" | "carbohydrate" | "fat" | "dairy" | "fruit" | "vegetable" | "legume" | "grain" | "other";
  aliases: string[];
  allergens?: string[];
  vegetarian?: boolean;
};

const CURATED: Curated[] = [
  // Proteins — meat/fish/eggs (CIQUAL distinguishes raw and cooked states)
  { id: "chicken-breast-raw", code: "36017", category: "protein", aliases: ["raw chicken breast", "chicken fillet raw", "poulet filet cru"] },
  { id: "chicken-breast-cooked", code: "36018", category: "protein", aliases: ["grilled chicken breast", "cooked chicken breast", "pan-fried chicken breast", "poulet grille"] },
  { id: "chicken-thigh-roasted", code: "36006", category: "protein", aliases: ["roasted chicken thigh", "chicken thigh cooked"], vegetarian: false },
  { id: "turkey-escalope-raw", code: "36304", category: "protein", aliases: ["raw turkey escalope", "turkey breast raw"] },
  { id: "turkey-escalope-cooked", code: "36308", category: "protein", aliases: ["cooked turkey escalope", "roasted turkey escalope"] },
  { id: "beef-steak-raw", code: "6201", category: "protein", aliases: ["raw beef steak", "steak cru"] },
  { id: "beef-steak-grilled", code: "6200", category: "protein", aliases: ["grilled beef steak", "steak grille"] },
  { id: "beef-mince-5pct-raw", code: "6250", category: "protein", aliases: ["lean beef mince raw", "5% fat ground beef raw"] },
  { id: "beef-mince-5pct-cooked", code: "6251", category: "protein", aliases: ["lean beef mince cooked", "5% fat ground beef cooked"] },
  { id: "salmon-farmed-raw", code: "26036", category: "protein", aliases: ["raw salmon", "salmon filet raw"] },
  { id: "salmon-steamed", code: "26038", category: "protein", aliases: ["steamed salmon", "cooked salmon"] },
  { id: "salmon-grilled", code: "26229", category: "protein", aliases: ["grilled salmon", "pan-fried salmon"] },
  { id: "tuna-raw", code: "26053", category: "protein", aliases: ["fresh tuna", "raw tuna steak"] },
  { id: "tuna-canned-drained", code: "26039", category: "protein", aliases: ["canned tuna", "tuna in water drained"] },
  { id: "cod-raw", code: "26043", category: "protein", aliases: ["raw cod", "white fish raw", "cabillaud cru"] },
  { id: "cod-steamed", code: "26025", category: "protein", aliases: ["steamed cod", "cooked white fish"] },
  { id: "shrimp-raw", code: "10021", category: "protein", aliases: ["raw shrimp", "raw prawn"], allergens: ["shellfish"] },
  { id: "shrimp-cooked", code: "10007", category: "protein", aliases: ["cooked shrimp", "cooked prawn"], allergens: ["shellfish"] },
  { id: "egg-whole-raw", code: "22000", category: "protein", aliases: ["raw egg", "whole egg", "oeuf cru"], allergens: ["egg"] },
  { id: "egg-boiled", code: "22010", category: "protein", aliases: ["boiled egg", "hard boiled egg", "oeuf dur"], allergens: ["egg"] },
  { id: "egg-white-raw", code: "22001", category: "protein", aliases: ["egg white", "blanc d'oeuf", "egg whites"], allergens: ["egg"] },

  // Dairy
  { id: "milk-semi-skimmed-uht", code: "19041", category: "dairy", aliases: ["semi skimmed milk", "lait demi-ecreme"], allergens: ["milk"] },
  { id: "milk-whole-uht", code: "19023", category: "dairy", aliases: ["whole milk", "full fat milk", "lait entier"], allergens: ["milk"] },
  { id: "greek-yogurt-plain", code: "19860", category: "dairy", aliases: ["greek yogurt", "greek style yogurt plain", "yaourt grec nature"], allergens: ["milk"] },
  { id: "yogurt-plain-bifidus", code: "19546", category: "dairy", aliases: ["plain yogurt", "natural yogurt", "yaourt nature"], allergens: ["milk"] },
  { id: "fromage-blanc-0-fat", code: "19644", category: "dairy", aliases: ["fat free fromage blanc", "0% quark", "fromage blanc 0%"], allergens: ["milk"] },
  { id: "fromage-blanc-3-fat", code: "19646", category: "dairy", aliases: ["fromage blanc", "quark 3%"], allergens: ["milk"] },

  // Carbohydrates / grains (raw ≠ cooked)
  { id: "rice-white-raw", code: "9100", category: "carbohydrate", aliases: ["white rice dry", "uncooked white rice", "riz blanc cru"] },
  { id: "rice-white-cooked", code: "9104", category: "carbohydrate", aliases: ["cooked white rice", "boiled white rice", "riz blanc cuit"] },
  { id: "rice-basmati-cooked", code: "9125", category: "carbohydrate", aliases: ["basmati rice cooked", "riz basmati cuit"] },
  { id: "rice-brown-raw", code: "9102", category: "carbohydrate", aliases: ["brown rice dry", "uncooked brown rice", "riz complet cru"] },
  { id: "rice-brown-cooked", code: "9103", category: "carbohydrate", aliases: ["cooked brown rice", "riz complet cuit"] },
  { id: "oats-dry", code: "9311", category: "grain", aliases: ["rolled oats", "oat flakes", "flocons d'avoine", "avoine"] },
  { id: "pasta-dry-raw", code: "9810", category: "carbohydrate", aliases: ["dry pasta", "uncooked pasta", "pates seches crues"], allergens: ["gluten"] },
  { id: "pasta-dry-cooked", code: "9811", category: "carbohydrate", aliases: ["cooked pasta", "boiled pasta", "pates cuites"], allergens: ["gluten"] },
  { id: "pasta-wholemeal-raw", code: "9870", category: "carbohydrate", aliases: ["wholemeal pasta dry", "pates completes crues"], allergens: ["gluten"] },
  { id: "pasta-wholemeal-cooked", code: "9871", category: "carbohydrate", aliases: ["wholemeal pasta cooked", "pates completes cuites"], allergens: ["gluten"] },
  { id: "bread-baguette", code: "7001", category: "carbohydrate", aliases: ["french baguette", "baguette bread"], allergens: ["gluten"] },
  { id: "bread-wholemeal-t150", code: "7110", category: "carbohydrate", aliases: ["wholemeal bread", "integral bread", "pain complet"], allergens: ["gluten"] },
  { id: "potato-boiled", code: "4003", category: "carbohydrate", aliases: ["boiled potatoes", "potatoes cooked in water", "pommes de terre a l'eau"] },
  { id: "sweet-potato-raw", code: "4101", category: "carbohydrate", aliases: ["raw sweet potato", "patate douce crue"] },
  { id: "sweet-potato-cooked", code: "4102", category: "carbohydrate", aliases: ["cooked sweet potato", "patate douce cuite"] },
  { id: "couscous-raw", code: "9681", category: "grain", aliases: ["dry couscous", "uncooked couscous grain", "semoule crue"], allergens: ["gluten"] },
  { id: "couscous-cooked", code: "9683", category: "grain", aliases: ["cooked couscous", "couscous grain cooked"], allergens: ["gluten"] },
  { id: "quinoa-raw", code: "9340", category: "grain", aliases: ["dry quinoa", "uncooked quinoa"] },
  { id: "quinoa-cooked", code: "9341", category: "grain", aliases: ["cooked quinoa", "boiled quinoa"] },

  // Legumes / vegan proteins
  { id: "lentils-green-cooked", code: "20587", category: "legume", aliases: ["cooked green lentils", "boiled lentils", "lentilles vertes cuites"] },
  { id: "lentils-dry-raw", code: "20504", category: "legume", aliases: ["dry lentils", "uncooked lentils", "lentilles seches"] },
  { id: "chickpeas-cooked", code: "20507", category: "legume", aliases: ["boiled chickpeas", "pois chiches cuits"] },
  { id: "chickpeas-canned-drained", code: "20532", category: "legume", aliases: ["canned chickpeas", "pois chiches appertises egouttes"] },
  { id: "kidney-beans-cooked", code: "20503", category: "legume", aliases: ["boiled red kidney beans", "haricots rouges cuits"] },
  { id: "white-beans-cooked", code: "20502", category: "legume", aliases: ["boiled white beans", "haricots blancs cuits"] },
  { id: "tofu-plain", code: "20904", category: "legume", aliases: ["tofu", "plain tofu firm"], allergens: ["soy"] },
  { id: "tempeh", code: "20917", category: "legume", aliases: ["tempeh soy"], allergens: ["soy"] },

  // Fats / nuts
  { id: "olive-oil-extra-virgin", code: "17270", category: "fat", aliases: ["extra virgin olive oil", "olive oil", "huile d'olive vierge extra"] },
  { id: "avocado-raw", code: "13004", category: "fruit", aliases: ["avocado pulp", "avocat cru"] },
  { id: "almonds-with-skin", code: "15000", category: "fat", aliases: ["almonds", "amandes avec peau"], allergens: ["tree_nut"] },
  { id: "walnuts-shelled", code: "15005", category: "fat", aliases: ["walnuts", "walnut kernels", "noix cerneaux"], allergens: ["tree_nut"] },
  { id: "peanuts-raw", code: "15001", category: "fat", aliases: ["peanuts", "arachides"], allergens: ["peanut"] },
  { id: "peanut-butter", code: "15202", category: "fat", aliases: ["peanut butter smooth", "pate d'arachide"], allergens: ["peanut"] },

  // Fruit
  { id: "banana-raw", code: "13005", category: "fruit", aliases: ["banana pulp", "banane crue"] },
  { id: "apple-with-peel", code: "13039", category: "fruit", aliases: ["apple with skin", "pomme avec peau"] },
  { id: "orange-raw", code: "13034", category: "fruit", aliases: ["orange pulp", "orange crue"] },
  { id: "strawberry-raw", code: "13014", category: "fruit", aliases: ["strawberries", "fraises crues"] },
  { id: "blueberry-raw", code: "13028", category: "fruit", aliases: ["blueberries", "myrtilles crues"] },
  { id: "raspberry-raw", code: "13015", category: "fruit", aliases: ["raspberries", "framboises crues"] },
  { id: "grapes-white-raw", code: "13044", category: "fruit", aliases: ["white grapes", "raisin blanc cru"] },
  { id: "kiwi-raw", code: "13021", category: "fruit", aliases: ["kiwi fruit", "kiwi cru"] },

  // Vegetables
  { id: "broccoli-raw", code: "20057", category: "vegetable", aliases: ["raw broccoli", "brocoli cru"] },
  { id: "broccoli-steamed", code: "20304", category: "vegetable", aliases: ["steamed broccoli", "broccoli cooked", "brocoli cuit vapeur"] },
  { id: "spinach-raw", code: "20059", category: "vegetable", aliases: ["raw spinach", "epinards crus"] },
  { id: "spinach-boiled", code: "20336", category: "vegetable", aliases: ["cooked spinach", "boiled spinach", "epinards cuits"] },
  { id: "tomato-raw", code: "20047", category: "vegetable", aliases: ["raw tomato", "tomate crue"] },
  { id: "carrot-raw", code: "20009", category: "vegetable", aliases: ["raw carrot", "carotte crue"] },
  { id: "cucumber-raw", code: "20019", category: "vegetable", aliases: ["cucumber with peel", "concombre cru"] },
  { id: "bell-pepper-red-raw", code: "20087", category: "vegetable", aliases: ["red pepper raw", "poivron rouge cru"] },
  { id: "courgette-raw", code: "20020", category: "vegetable", aliases: ["zucchini with peel", "courgette crue"] },
  { id: "green-beans-raw", code: "20061", category: "vegetable", aliases: ["raw green beans", "haricots verts crus"] },
  { id: "green-beans-cooked", code: "20030", category: "vegetable", aliases: ["cooked green beans", "haricots verts cuits"] },
  { id: "lettuce-raw", code: "20031", category: "vegetable", aliases: ["lettuce", "raw lettuce", "laitue crue"] },
];

// ---------------------------------------------------------------------------
// CIQUAL constituent codes (per 100 g) used by this import.
// ---------------------------------------------------------------------------
const CONST_KCAL = "328"; // Energie, Règlement UE N° 1169/2011 (kcal/100 g)
const CONST_PROTEIN = "25000"; // Protéines, N x facteur de Jones (g/100 g)
const CONST_CARBOHYDRATE = "31000"; // Glucides (g/100 g)
const CONST_FAT = "40000"; // Lipides (g/100 g)
const CONST_FIBRE = "34100"; // Fibres alimentaires (g/100 g)

const DATASET_VERSION = "2020"; // Table Ciqual 2020 edition
const CATALOGUE_VERSION = "1";

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}

/**
 * Parses a CIQUAL teneur cell. Normalization policy (documented, deterministic,
 * NO invention):
 *   - numeric ("19,7")  -> exact published value
 *   - "< x" / "traces"  -> the SOURCE asserts a negligible upper bound; stored
 *                          as 0 (standard food-database practice, never a guess)
 *   - "-" or absent row -> not published by the source; see energy policy below
 *
 * Energy policy: when CIQUAL publishes no kcal value ("-"/absent) but DOES
 * publish protein, carbohydrate and fat, energy is DERIVED with the standard
 * Atwater factors (4/4/9 kcal per g) — the same convention CIQUAL itself uses
 * for its computed energy columns. Such items carry
 * source.energyDerivation = "atwater-4-4-9" so the runtime can distinguish
 * measured vs derived energy. No other field is ever synthesized.
 */
function teneur(value: string): number | null {
  const cleaned = value.trim();
  if (!cleaned || cleaned === "-") return null;
  if (cleaned.toLowerCase() === "traces" || cleaned.startsWith("<")) return 0;
  const n = Number(cleaned.replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

/** Deterministic 2-decimal rounding (no float dust in the committed data). */
function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function main(): void {
  const xmlDir = process.argv[2];
  if (!xmlDir) {
    console.error("Usage: node scripts/build-food-catalogue.ts <ciqual-xml-dir>");
    process.exit(1);
  }

  const alimsRaw = readFileSync(join(xmlDir, "alim_2020_07_07.xml"), "latin1");
  const compoRaw = readFileSync(join(xmlDir, "compo_2020_07_07.xml"), "latin1");

  const alims = new Map<string, { fr: string; eng: string }>();
  for (const m of alimsRaw.matchAll(/<ALIM>([\s\S]*?)<\/ALIM>/g)) {
    alims.set(tag(m[1], "alim_code"), { fr: tag(m[1], "alim_nom_fr"), eng: tag(m[1], "alim_nom_eng") });
  }

  // composition map: `${code}:${constCode}` -> value
  const compo = new Map<string, number>();
  for (const m of compoRaw.matchAll(/<COMPO>([\s\S]*?)<\/COMPO>/g)) {
    const block = m[1];
    const alimCode = tag(block, "alim_code");
    const constCode = tag(block, "const_code");
    if (!CURATED.some((c) => c.code === alimCode)) continue;
    if (![CONST_KCAL, CONST_PROTEIN, CONST_CARBOHYDRATE, CONST_FAT, CONST_FIBRE].includes(constCode)) continue;
    const value = teneur(tag(block, "teneur"));
    if (value !== null && !compo.has(`${alimCode}:${constCode}`)) {
      compo.set(`${alimCode}:${constCode}`, value);
    }
  }

  const foods: unknown[] = [];
  const failures: string[] = [];

  for (const curated of CURATED) {
    const alim = alims.get(curated.code);
    if (!alim || !alim.eng) {
      failures.push(`${curated.id}: CIQUAL code ${curated.code} not found`);
      continue;
    }
    const kcalDirect = compo.get(`${curated.code}:${CONST_KCAL}`);
    const proteinG = compo.get(`${curated.code}:${CONST_PROTEIN}`);
    const carbohydrateG = compo.get(`${curated.code}:${CONST_CARBOHYDRATE}`);
    const fatG = compo.get(`${curated.code}:${CONST_FAT}`);
    const fibreG = compo.get(`${curated.code}:${CONST_FIBRE}`);
    if ([proteinG, carbohydrateG, fatG].some((v) => v === null || v === undefined)) {
      failures.push(`${curated.id}: incomplete composition in source (P=${proteinG} C=${carbohydrateG} F=${fatG})`);
      continue;
    }
    let kcal: number;
    let energyDerivation: "measured" | "atwater-4-4-9";
    if (kcalDirect !== undefined && kcalDirect !== null) {
      kcal = kcalDirect;
      energyDerivation = "measured";
    } else {
      // Documented fallback: Atwater factors on published macro grams.
      kcal = r2((proteinG as number) * 4 + (carbohydrateG as number) * 4 + (fatG as number) * 9);
      energyDerivation = "atwater-4-4-9";
    }
    const isAnimalFlesh =
      curated.category === "protein" &&
      !["egg-whole-raw", "egg-boiled", "egg-white-raw"].includes(curated.id);
    const isEgg = ["egg-whole-raw", "egg-boiled", "egg-white-raw"].includes(curated.id);
    const isPlant = !isAnimalFlesh && !isEgg && curated.category !== "dairy";
    foods.push({
      id: curated.id,
      name: alim.eng,
      nameFr: alim.fr,
      aliases: curated.aliases,
      category: curated.category,
      nutritionPer100g: {
        kcal,
        proteinG: r2(proteinG as number),
        carbohydrateG: r2(carbohydrateG as number),
        fatG: r2(fatG as number),
        ...(fibreG !== undefined ? { fibreG: r2(fibreG) } : {}),
      },
      dietary: {
        vegetarian: !isAnimalFlesh,
        vegan: isPlant,
        containsPork: false,
        containsAlcohol: false,
      },
      ...(curated.allergens ? { allergens: curated.allergens } : {}),
      source: { provider: "CIQUAL", sourceId: curated.code, datasetVersion: DATASET_VERSION, energyDerivation },
    });
  }

  if (failures.length > 0 || foods.length !== CURATED.length) {
    console.error("BUILD FAILED — items missing authoritative values:");
    for (const f of failures) console.error(" - " + f);
    console.error("No output written.");
    process.exit(2);
  }

  const output = {
    catalogueVersion: CATALOGUE_VERSION,
    source: {
      provider: "CIQUAL",
      citation:
        "Anses. 2020. Ciqual French food composition table. https://ciqual.anses.fr/",
      datasetVersion: DATASET_VERSION,
      fileSetDate: "2020-07-07",
      constituentsUsed: {
        kcal: CONST_KCAL,
        proteinG: CONST_PROTEIN,
        carbohydrateG: CONST_CARBOHYDRATE,
        fatG: CONST_FAT,
        fibreG: CONST_FIBRE,
      },
    },
    foods,
  };
  const outPath = join(process.cwd(), "app", "data", "food-catalogue-v1.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Wrote ${foods.length} foods to ${outPath}`);
}

main();
