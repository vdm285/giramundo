// Builds public/data/food/<ISO2>.json: the deep list of a country's own
// dishes, grouped by region, from Wikipedia's category trees and Wikidata.
//
//   npm run food -- --country=MX      one country
//   npm run food                      every country in COUNTRIES below
//   npm run food -- --country=MX --verbose      also list every dropped page and why
//   FOOD_FRESH=1 npm run food -- --country=MX   drop data/cache/food/ first
//
// How a dish gets in (nothing is written that is not a Wikipedia article with
// a Wikidata item; nothing is invented):
//
// 1. Wikipedia categories. The Spanish category tree under `esCategory`
//    (Categoría:Gastronomía de México) is walked to depth 2 with
//    list=categorymembers (pages and subcategories), skipping the branches
//    that are not food (people, restaurants, chefs, cookbooks, events,
//    utensils, ingredients: `skip` in the config). The English tree under
//    `enCategory` is walked the same way and adds what es.wikipedia has not
//    filed. The per-region categories (the subcategories of
//    `regions.parent`, "Categoría:Gastronomía de Oaxaca"...) give the
//    grouping: a dish filed under a state belongs to that state; a dish only
//    in the national tree goes to "Todo el país" / "Nationwide", unless its
//    Wikidata country of origin (P495) names a state of this country.
// 2. Pages resolve to Wikidata items through prop=pageprops (wikibase_item).
//    Lists ("Anexo:", "List of"), the cuisine articles themselves and pages
//    without an item are dropped.
// 3. Wikidata (wbgetentities, 50 items a call) gives label es/en/local,
//    description es/en, photo (P18), instance of (P31), cuisine (P2012),
//    country of origin (P495), sitelink count and the es/en article titles.
//    Dropped: humans, taxa, cultivars, ingredients-as-such, restaurants,
//    companies, brands, books, events, lists, cuisines and anything filed
//    under Tex-Mex cuisine (P2012 = Q29359) or with a country of origin that
//    is neither this country nor a place inside it (P495 -> P17).
// 4. data/overrides/dishes.json: `exclude` never appears; `include` items go
//    first in their region (their category region if any, else the state the
//    override names, else nationwide), even when the categories missed them.
//
// `kind` is a coarse label for the card (dish, antojito, soup, sweet, drink,
// bread, sauce, other), decided by the category a page was found in
// ("Sopas de México" -> soup) and otherwise by the labels of its P31 classes;
// when neither says anything it is "dish" for an item typed as a dish or
// food, else "other" (cheeses, sausages, edible insects).
//
// Ranking inside a region: curated first (in the overrides' order), then by
// sitelinks (how many Wikipedias have an article), then label. Regions are
// ordered by dish count, nationwide first.
//
// Politeness: one Wikimedia request at a time, 300 ms apart, fetchRetry on
// 429/5xx, a 6 s pause when the API answers "too many requests" as text.
// Every response is cached under data/cache/food/ (gitignored), so a re-run
// after a code change is free; FOOD_FRESH=1 clears it.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root, UA, cacheDir, fetchRetry, exists, today } from './net.mjs';

const OUT_DIR = join(root, 'public/data/food');
const OVERRIDES = join(root, 'data/overrides/dishes.json');
const FOOD_CACHE = join(cacheDir, 'food');
const MAX_BYTES = 400 * 1024;
const DEPTH = 2; // category depth under the national category
const BATCH = 50; // titles / ids per Wikimedia API call
const GAP_MS = 300;
const FRESH = process.env.FOOD_FRESH === '1';
const args = parseArgs();

// ----------------------------------------------------------------- config
//
// One entry per country. To add a country, add an entry here (see "Food" in
// docs/PIPELINES.md). `skip` is tested against subcategory titles (es and en)
// so non-food branches of the tree are not walked. `regions.parent` is the
// category whose subcategories are the regions; `regions.strip` removes the
// prefix of each subcategory title, and what remains is matched (accent- and
// case-insensitive) against `regions.list[*].match`. `regions.list` is also
// what P495 state labels are matched against.

const MX_REGIONS = [
  ['mx-agu', 'Aguascalientes', 'Aguascalientes'],
  ['mx-bcn', 'Baja California', 'Baja California'],
  ['mx-bcs', 'Baja California Sur', 'Baja California Sur'],
  ['mx-cam', 'Campeche', 'Campeche'],
  ['mx-chp', 'Chiapas', 'Chiapas'],
  ['mx-chh', 'Chihuahua', 'Chihuahua'],
  ['mx-coa', 'Coahuila', 'Coahuila', ['Coahuila de Zaragoza']],
  ['mx-col', 'Colima', 'Colima'],
  ['mx-cmx', 'Ciudad de México', 'Mexico City', ['Distrito Federal', 'CDMX']],
  ['mx-dur', 'Durango', 'Durango'],
  ['mx-gua', 'Guanajuato', 'Guanajuato'],
  ['mx-gro', 'Guerrero', 'Guerrero'],
  ['mx-hid', 'Hidalgo', 'Hidalgo'],
  ['mx-jal', 'Jalisco', 'Jalisco'],
  ['mx-mex', 'Estado de México', 'State of Mexico', ['México', 'estado de México']],
  ['mx-mic', 'Michoacán', 'Michoacán', ['Michoacán de Ocampo']],
  ['mx-mor', 'Morelos', 'Morelos'],
  ['mx-nay', 'Nayarit', 'Nayarit'],
  ['mx-nle', 'Nuevo León', 'Nuevo León'],
  ['mx-oax', 'Oaxaca', 'Oaxaca'],
  ['mx-pue', 'Puebla', 'Puebla'],
  ['mx-que', 'Querétaro', 'Querétaro', ['Querétaro de Arteaga']],
  ['mx-roo', 'Quintana Roo', 'Quintana Roo'],
  ['mx-slp', 'San Luis Potosí', 'San Luis Potosí'],
  ['mx-sin', 'Sinaloa', 'Sinaloa'],
  ['mx-son', 'Sonora', 'Sonora'],
  ['mx-tab', 'Tabasco', 'Tabasco'],
  ['mx-tam', 'Tamaulipas', 'Tamaulipas'],
  ['mx-tla', 'Tlaxcala', 'Tlaxcala'],
  ['mx-ver', 'Veracruz', 'Veracruz', ['Veracruz de Ignacio de la Llave']],
  ['mx-yuc', 'Yucatán', 'Yucatán', ['Península de Yucatán', 'Yucatan Peninsula']],
  ['mx-zac', 'Zacatecas', 'Zacatecas'],
].map(([id, es, en, aliases = []]) => ({ id, label: { es, en }, match: [es, en, ...aliases] }));

const COUNTRIES = {
  MX: {
    qid: 'Q96',
    cuisine: 'Q207965', // the national cuisine item (P2012 target)
    localLang: 'es',
    esCategory: 'Categoría:Gastronomía de México',
    enCategory: 'Category:Mexican cuisine',
    enMatch: /Mexic/i, // an en category must name the country for the en-only exception below
    // Subcategories (any depth) whose title matches are not walked.
    skip: /Cocineros|Restauradores|Restaurantes|Escritores|Eventos|Libros|Utensilios|Chiles en|Maíz en|Quelites|Maguey|Insectos|sefardí|Chefs|Restaurants|utensils|Designation of Origin|fusion|Chocolate|Caesar salad|stubs|Tortilla$|Day of the Dead|Tex-Mex|New Mexican|Mexican-American|Southwestern/i,
    // Category title -> kind, tested against the title of the category a page was found in.
    kinds: [
      [/Antojitos|Tacos|Taco$|Tamales|Tortas|Botanas|snack|Street food|Tortillas/i, 'antojito'],
      [/Sopas|soups|stews|Caldos/i, 'soup'],
      [/Postres|dulces|desserts|pastries|Chocolate/i, 'sweet'],
      [/Bebidas|drinks/i, 'drink'],
      [/Panes|breads/i, 'bread'],
      [/Salsas|Condimentos|sauces|garnish/i, 'sauce'],
      [/Platos|Platillos|dishes|Mole$|Ensaladas|Embutidos|Quesos|cheeses/i, 'dish'],
    ],
    regions: {
      parent: 'Categoría:Gastronomías regionales de México',
      strip: /^Categoría:Gastronomía (de la |del estado de |de |del )/i,
      list: MX_REGIONS,
    },
    nationwide: { es: 'Todo el país', en: 'Nationwide' },
  },
};

// Wikidata classes (P31), every id checked against its label on 2026-10-20.
// KEEP wins over DROP; HARD_DROP wins over everything (also over overrides).
const HARD_DROP = new Set([
  'Q5', // human
  'Q16521', 'Q4886', 'Q55983715', 'Q310890', 'Q7432', 'Q34740', 'Q35409', 'Q36602', 'Q4150646', // taxon, cultivar, organisms by common name, monotypic taxon, species, genus, family, order, cultivar group
  'Q13406463', 'Q4167410', 'Q4167836', 'Q11266439', // Wikimedia list, disambiguation, category, template
  'Q1778821', 'Q1968435', 'Q29359', // cuisine, national cuisine, Tex-Mex
]);
const DROP = new Set([
  'Q11707', 'Q18534542', 'Q4830453', 'Q6881511', 'Q783794', 'Q431289', 'Q167270', 'Q891723', 'Q114392939', 'Q2424752', // restaurant, restaurant chain, business, enterprise, company, brand, trademark, public company, drink brand, product
  'Q571', 'Q7725634', 'Q47461344', 'Q3331189', // book, literary work, written work, edition
  'Q132241', 'Q1435951', 'Q1656682', 'Q1190554', 'Q27968055', 'Q464980', // festival, food festival, event, occurrence, recurring event edition, exhibition
  'Q25403900', 'Q27643250', 'Q10675206', 'Q11004', 'Q3314483', 'Q756', 'Q506', 'Q95997873', // food ingredient (x2), ingredient, vegetable, fruit, plant, flower, herbal medicinal product (not Q2095 "food": Wikidata types esquites, quesillo and mole prieto as plain food)
  'Q74817647', 'Q120609028', // "aspect in a geographic region" ("Beer in Mexico", "Coffee in Chiapas"), same in a historical period
  'Q43229', 'Q79913', 'Q163740', 'Q2385804', 'Q3914', 'Q33506', 'Q17334923', 'Q22687', 'Q4989906', 'Q179049', 'Q13226383', // organization, NGO, nonprofit, educational institution, school, museum, physical location, bank, monument, nature reserve, facility
  'Q15416', 'Q11424', 'Q5398426', 'Q24634210', 'Q7889', // television program, film, series, podcast, video game
  'Q39614', 'Q1248784', 'Q4022', 'Q515', 'Q486972', // cemetery, airport, river, city, human settlement
  'Q28640', 'Q12737077', 'Q12136', 'Q7406919', 'Q8148', 'Q1047113', 'Q39546', 'Q16917', 'Q39715', // profession, occupation, disease, service, industry, field of study, physical tool, hospital, lighthouse
]);
const KEEP = new Set([
  'Q746549', 'Q19861951', 'Q6460735', 'Q3494357', 'Q219239', 'Q2920963', // dish, type of food or dish, meal, culinary speciality, recipe, stew
  'Q28100020', 'Q28100368', 'Q28100907', 'Q28101001', 'Q100320371', 'Q69393237', 'Q1495652', 'Q191655', 'Q28803', // pork, beef, shrimp, clam, offal dish; stuffed flatbread; mole; taco; sandwich
  'Q41415', 'Q182940', 'Q185583', 'Q13276', 'Q477248', 'Q13233', 'Q7802', // soup, dessert, candy, cake, pastry, ice cream, bread
  'Q40050', 'Q154', 'Q56139', 'Q134768', 'Q2536409', 'Q44', 'Q147538', 'Q282', 'Q2647467', 'Q26343751', // drink, alcoholic beverage, liquor, cocktail, IBA cocktail, beer, soft drink, wine, non-alcoholic beverage, fermented beverage
  'Q178359', 'Q2596997', 'Q749316', // sauce, condiment, snack
  'Q10943', 'Q131419', 'Q185217', // cheese, sausage, dairy product
]);
// When a class is in neither table, its label decides (generic, so a new
// country does not need new ids): anything that reads as an ingredient, a
// crop, a protected designation, an institution or a medium is dropped.
const KEEP_WORDS = /\b(dish|plato|platillo|soup|sopa|caldo|drink|bebida|beverage|dessert|postre|snack|botana|antojito|sauce|salsa|bread|pan|candy|dulce|confection|stew|guiso|cocktail|liquor|licor|cheese|queso|sausage|embutido|pastry|cake|pastel|tamal|taco|torta|spice mix|paste|entomophagy|entomofagia)\b/i;
const DROP_WORDS = /\b(cuisine|gastronom|museum|museo|festival|feria|fair|organi[sz]ation|institut|school|escuela|company|empresa|brand|marca|channel|canal|game|juego|television|film|book|libro|magazine|revista|website|restaurant|aspect|aspecto|practice|práctica|process|proceso|technique|técnica|designation of origin|denominación de origen|geographical indication|indicación geográfica|appellation|pepper|chili|chile|variety|variedad|landrace|cultivar|crop|cultivo|plant|planta|fruit|fruta|seed|semilla|grain|grano|bean|maize|maíz|corn|vanilla|vainilla|cacao|cocoa|coffee|café|salt|sal|ingredient|ingrediente|spice|especia|sweetener|edulcorante|vegetable|verdura|hortaliza|tuber|tubérculo|nut|flower|flor|fungus|hongo|mushroom|insect|insecto|animal|fish|pez|meat cut|corte|hill|colina|print|musical|work|obra|bottled|culture|cultura|taquería|booth|stand|puesto|tradition|tradición|custom|costumbre|slogan|intellectual|street vendor|vendedor)\b/i;

// Words in the labels of P31 classes that decide a kind when the category did not.
const KIND_WORDS = [
  [/\b(soup|sopa|caldo|stew|guiso|estofado|pozole)\b/i, 'soup'],
  [/\b(beverage|drink|bebida|liquor|licor|spirit|aguardiente|beer|cerveza|wine|vino|cocktail|cóctel|mezcal|tequila|pulque|atole|juice|jugo)\b/i, 'drink'],
  [/\b(dessert|postre|candy|dulce|confection|sweet|cake|pastel|ice cream|helado|pudding|flan|cookie|galleta|chocolate)\b/i, 'sweet'],
  [/\b(bread|pan|pastry|bollo|roll|tortilla)\b/i, 'bread'],
  [/\b(sauce|salsa|condiment|condimento|dip|seasoning|aderezo)\b/i, 'sauce'],
  [/\b(snack|botana|antojito|street food|taco|tamal|tamale|torta|sandwich|quesadilla)\b/i, 'antojito'],
  [/\b(cheese|queso|sausage|embutido|dairy|lácteo|insect|insecto|entomophagy|entomofagia)\b/i, 'other'],
  [/\b(dish|platillo|plato|food|alimento|comida|meal|meat|carne)\b/i, 'dish'],
];
const KINDS = new Set(['dish', 'antojito', 'soup', 'sweet', 'drink', 'bread', 'sauce', 'other']);

// --------------------------------------------------------------- fetching

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
let liveRequests = 0;

// One Wikimedia API call, JSON, cached forever under data/cache/food/<sub>/.
// The APIs sometimes answer a burst with a text page ("You are making too
// many requests"); that is not JSON, so wait and try again.
async function api(host, params, sub) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const dir = join(FOOD_CACHE, sub);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`);
  if (await exists(path)) return JSON.parse(await readFile(path, 'utf8'));
  for (let attempt = 1; ; attempt += 1) {
    const wait = GAP_MS - (Date.now() - lastRequest);
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    liveRequests += 1;
    const res = await fetchRetry(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      if (attempt >= 5) throw new Error(`${host}: not JSON after ${attempt} tries: ${text.slice(0, 80)}`);
      console.log(`${host}: ${text.slice(0, 40).replace(/\s+/g, ' ')}... waiting 6 s`);
      await sleep(6000);
      continue;
    }
    if (data.error) throw new Error(`${host}: ${data.error.code} ${data.error.info}`);
    await writeFile(path, text);
    return data;
  }
}

// All members of a category: { pages: [title], subcats: [title] }, following continuation.
async function categoryMembers(host, title) {
  const pages = [];
  const subcats = [];
  let cont = {};
  do {
    const data = await api(host, {
      action: 'query', list: 'categorymembers', cmtitle: title, cmtype: 'page|subcat', cmlimit: '500', ...cont,
    }, host.split('.')[0]);
    for (const m of data.query?.categorymembers || []) {
      if (m.ns === 14) subcats.push(m.title);
      else if (m.ns === 0) pages.push(m.title);
    }
    cont = data.continue || null;
  } while (cont);
  return { pages, subcats };
}

// Walk a category tree to `depth`, skipping branches that match `skip`.
// Returns Map<pageTitle, Set<categoryTitle>> (every category the page was seen in).
async function walk(host, rootCat, depth, skip, seen = new Set()) {
  const found = new Map();
  async function visit(cat, level) {
    if (seen.has(cat)) return;
    seen.add(cat);
    const { pages, subcats } = await categoryMembers(host, cat);
    for (const p of pages) {
      if (!found.has(p)) found.set(p, new Set());
      found.get(p).add(cat);
    }
    if (level >= depth) return;
    for (const sub of subcats) {
      if (skip && skip.test(sub)) continue;
      await visit(sub, level + 1);
    }
  }
  await visit(rootCat, 0);
  return found;
}

// Page titles -> Wikidata ids through prop=pageprops. Redirects are followed.
async function resolveQids(host, titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += BATCH) {
    const slice = titles.slice(i, i + BATCH);
    const data = await api(host, {
      action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: slice.join('|'), redirects: '1',
    }, host.split('.')[0]);
    const redirected = new Map((data.query?.redirects || []).map((r) => [r.to, r.from]));
    for (const page of data.query?.pages || []) {
      const q = page.pageprops?.wikibase_item;
      if (!q) continue;
      out.set(page.title, q);
      if (redirected.has(page.title)) out.set(redirected.get(page.title), q);
    }
  }
  return out;
}

// Wikidata entities, 50 a call.
async function getEntities(ids, props = 'labels|descriptions|claims|sitelinks', languages = 'es|en') {
  const out = new Map();
  const unique = [...new Set(ids)].sort();
  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH);
    const data = await api('www.wikidata.org', {
      action: 'wbgetentities', ids: slice.join('|'), props, languages,
    }, 'wikidata');
    for (const [id, e] of Object.entries(data.entities || {})) {
      if (e.missing !== undefined) continue;
      // Redirected items come back under their target id with a `redirects` note.
      out.set(id, e);
      if (e.redirects?.from) out.set(e.redirects.from, e);
    }
  }
  return out;
}

// --------------------------------------------------------------- helpers

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const claimIds = (e, prop) => (e.claims?.[prop] || [])
  .filter((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue?.value?.id)
  .map((c) => c.mainsnak.datavalue.value.id);
const label = (e, lang) => e.labels?.[lang]?.value || null;
const wikiUrl = (host, title) => `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

function isListTitle(title) {
  return /^(Anexo:|Lista de|List of|Gastronomía |Cuisine of|.* cuisine$|Cocina |Entomofagia|Entomophagy|Street vendors|Types of)/i.test(title)
    || /^(Historia de|History of|Comida en|Food in|.* in Mexico$)/i.test(title);
}

function kindFromClasses(classIds, classLabels) {
  for (const id of classIds) {
    const lbl = classLabels.get(id);
    if (!lbl) continue;
    for (const [re, kind] of KIND_WORDS) if (re.test(lbl)) return kind;
  }
  return null;
}

// --------------------------------------------------------------- one country

async function buildCountry(iso2, cfg, overrides) {
  console.log(`\n== ${iso2} ==`);
  const regionsById = new Map(cfg.regions.list.map((r) => [r.id, r]));
  const regionIdByName = new Map();
  for (const r of cfg.regions.list) for (const m of r.match) regionIdByName.set(fold(m), r.id);
  const matchRegion = (name) => {
    if (!name) return null;
    const f = fold(name);
    if (regionIdByName.has(f)) return regionIdByName.get(f);
    // "Guadalajara, Jalisco" -> Jalisco: longest alias contained in the string.
    let best = null;
    for (const [alias, id] of regionIdByName) {
      if (alias.length >= 5 && f.includes(alias) && (!best || alias.length > best.len)) best = { id, len: alias.length };
    }
    return best ? best.id : null;
  };

  // 1. Categories.
  const esPages = await walk('es.wikipedia.org', cfg.esCategory, DEPTH, cfg.skip);
  console.log(`es tree: ${esPages.size} pages`);
  const enPages = cfg.enCategory ? await walk('en.wikipedia.org', cfg.enCategory, DEPTH, cfg.skip) : new Map();
  console.log(`en tree: ${enPages.size} pages`);

  // Region categories: subcategories of the parent, matched to the region list.
  const regionCats = new Map(); // category title -> region id
  const { subcats: regionSubcats } = await categoryMembers('es.wikipedia.org', cfg.regions.parent);
  for (const sub of regionSubcats) {
    const id = matchRegion(sub.replace(cfg.regions.strip, ''));
    if (id) regionCats.set(sub, id);
    else console.log(`region category not matched: ${sub}`);
  }
  const regionPages = new Map(); // page title -> Set<regionId>
  for (const [cat, id] of regionCats) {
    const found = await walk('es.wikipedia.org', cat, 1, cfg.skip);
    for (const title of found.keys()) {
      if (!regionPages.has(title)) regionPages.set(title, new Set());
      regionPages.get(title).add(id);
      if (!esPages.has(title)) esPages.set(title, new Set());
      esPages.get(title).add(cat);
    }
  }
  console.log(`regions: ${regionCats.size} categories, ${regionPages.size} pages filed under one`);

  // 2. Titles -> QIDs.
  const esTitles = [...esPages.keys()].filter((t) => !isListTitle(t));
  const enTitles = [...enPages.keys()].filter((t) => !isListTitle(t));
  const esQ = await resolveQids('es.wikipedia.org', esTitles);
  const enQ = await resolveQids('en.wikipedia.org', enTitles);
  const esHit = esTitles.filter((t) => esQ.has(t)).length;
  const enHit = enTitles.filter((t) => enQ.has(t)).length;
  console.log(`items: ${esHit} of ${esTitles.length} es pages and ${enHit} of ${enTitles.length} en pages have a Wikidata item`);

  // Per QID: the categories it was seen in, the regions.
  const cats = new Map(); // qid -> Set<category>
  const regionsOf = new Map(); // qid -> Set<regionId>
  const addCats = (q, set) => { if (!cats.has(q)) cats.set(q, new Set()); for (const c of set) cats.get(q).add(c); };
  for (const [title, q] of esQ) {
    addCats(q, esPages.get(title) || []);
    for (const r of regionPages.get(title) || []) {
      if (!regionsOf.has(q)) regionsOf.set(q, new Set());
      regionsOf.get(q).add(r);
    }
  }
  const fromEs = new Set(esQ.values());
  for (const [title, q] of enQ) addCats(q, enPages.get(title) || []);

  // Overrides.
  const ov = overrides[iso2] || {};
  const excluded = new Set(ov.exclude || []);
  const included = (ov.include || []).map((x) => (typeof x === 'string' ? { qid: x } : x));
  const includedOrder = new Map(included.map((x, i) => [x.qid, i]));
  for (const x of included) if (!cats.has(x.qid)) cats.set(x.qid, new Set());

  // 3. Wikidata.
  const ids = [...cats.keys()].filter((q) => !excluded.has(q));
  const langs = ['es', 'en', cfg.localLang].filter((x, i, a) => x && a.indexOf(x) === i).join('|');
  const entities = await getEntities(ids, 'labels|descriptions|claims|sitelinks', langs);
  console.log(`wikidata: ${entities.size} items`);

  // Classes seen and origins seen, resolved in one more pass (labels only / P17).
  const classIds = new Set();
  const originIds = new Set();
  for (const e of entities.values()) {
    for (const c of claimIds(e, 'P31')) classIds.add(c);
    for (const c of claimIds(e, 'P495')) if (c !== cfg.qid) originIds.add(c);
  }
  const classEntities = await getEntities([...classIds], 'labels', 'es|en');
  const classLabels = new Map([...classEntities].map(([id, e]) => [id, `${label(e, 'en') || ''} / ${label(e, 'es') || ''}`]));
  const originEntities = await getEntities([...originIds], 'labels|claims', 'es|en');
  const originInCountry = new Set(); // origins that are places inside the country
  const originRegion = new Map(); // origin qid -> region id
  for (const [id, e] of originEntities) {
    if (claimIds(e, 'P17').includes(cfg.qid)) {
      originInCountry.add(id);
      const r = matchRegion(label(e, 'es')) || matchRegion(label(e, 'en'));
      if (r) originRegion.set(id, r);
    }
  }

  // 4. Filter and shape.
  const dropped = { human: 0, taxon: 0, type: 0, word: 0, texmex: 0, origin: 0, enOnly: 0, list: 0, excluded: excluded.size, noLabel: 0 };
  const droppedNames = [];
  const drop = (why, e) => { dropped[why] += 1; droppedNames.push(`${why}: ${label(e, 'es') || label(e, 'en')} (${e.id}) [${claimIds(e, 'P31').map((c) => (classLabels.get(c) || c).split(' / ')[0]).join('; ')}]`); };
  const unknownClasses = new Map();
  const dishes = new Map(); // qid -> dish
  for (const q of ids) {
    const e = entities.get(q);
    if (!e) { dropped.noLabel += 1; continue; }
    const curated = includedOrder.has(q);
    const p31 = claimIds(e, 'P31');
    const p2012 = claimIds(e, 'P2012');
    const p495 = claimIds(e, 'P495');
    if (p31.includes('Q5')) { drop('human', e); continue; }
    if (p31.some((c) => HARD_DROP.has(c))) {
      drop(/Q16521|Q4886|Q55983715|Q310890|Q7432|Q34740|Q35409|Q36602|Q4150646/.test(p31.join(',')) ? 'taxon' : 'list', e);
      continue;
    }
    if (!curated) {
      const kept = p31.some((c) => KEEP.has(c) || c === cfg.cuisine);
      if (!kept && p31.some((c) => DROP.has(c))) { drop('type', e); continue; }
      if (!kept && !p31.some((c) => KEEP_WORDS.test(classLabels.get(c) || '')) && p31.some((c) => DROP_WORDS.test(classLabels.get(c) || ''))) { drop('word', e); continue; }
      if (p2012.includes('Q29359')) { drop('texmex', e); continue; }
      if (p495.length && !p495.some((c) => c === cfg.qid || originInCountry.has(c))) { drop('origin', e); continue; }
      // Found only through en.wikipedia: ask Wikidata for a tie to the country
      // (origin here, or filed under its cuisine), else it is a world dish
      // en.wikipedia happens to file under this cuisine (baked beans).
      // Exception: no es.wikipedia article at all, and the en article sits in a
      // typed category that names the country ("Mexican soups", "Street food in
      // Mexico"): a dish only the English wiki has written up (sikil pak,
      // pollo motuleño). "Category:Taco" alone does not count (Taco Bell).
      if (!fromEs.has(q) && !p495.length && !p2012.includes(cfg.cuisine)) {
        // It also needs a Wikidata type or a photo: an item with neither is
        // usually a stub about a stand, a brand or a joke ("danger dog").
        const typedHere = !e.sitelinks?.eswiki && (p31.length || e.claims?.P18) && [...(cats.get(q) || [])]
          .some((cat) => cfg.enMatch?.test(cat) && cfg.kinds.some(([re]) => re.test(cat)));
        if (!typedHere) { drop('enOnly', e); continue; }
      }
    }
    for (const c of p31) if (!KEEP.has(c) && !DROP.has(c)) {
      unknownClasses.set(c, (unknownClasses.get(c) || 0) + 1);
      if (args.verbose) console.log(`  ? kept ${label(e, 'es') || label(e, 'en')} (${q}) as [${(classLabels.get(c) || c).split(' / ')[0]}]`);
    }

    const es = label(e, 'es') || label(e, 'mul') || label(e, 'en');
    const en = label(e, 'en') || label(e, 'mul') || es;
    if (!es && !en) { dropped.noLabel += 1; continue; }
    const local = cfg.localLang ? (label(e, cfg.localLang) || null) : null;
    const eswiki = e.sitelinks?.eswiki?.title;
    const enwiki = e.sitelinks?.enwiki?.title;
    const wiki = {};
    if (eswiki) wiki.es = wikiUrl('es.wikipedia.org', eswiki);
    if (enwiki) wiki.en = wikiUrl('en.wikipedia.org', enwiki);
    const image = e.claims?.P18?.find((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue)?.mainsnak.datavalue.value || null;

    // Kind: category hint, then class labels, then dish/other.
    let kind = null;
    for (const cat of cats.get(q) || []) {
      for (const [re, k] of cfg.kinds) if (re.test(cat)) { kind = kind || k; }
      if (kind) break;
    }
    if (!kind) kind = kindFromClasses(p31, classLabels);
    if (!kind) kind = 'dish';
    if (!KINDS.has(kind)) kind = 'other';

    // Regions: category regions; else the override's region; else P495 state; else nationwide.
    let regions = [...(regionsOf.get(q) || [])];
    if (!regions.length && curated) {
      const r = matchRegion(included[includedOrder.get(q)].region?.es) || matchRegion(included[includedOrder.get(q)].region?.en);
      if (r) regions = [r];
    }
    if (!regions.length) {
      const fromOrigin = p495.map((c) => originRegion.get(c)).filter(Boolean);
      if (fromOrigin.length) regions = [...new Set(fromOrigin)];
    }

    const desc = {};
    const des = e.descriptions?.es?.value;
    const den = e.descriptions?.en?.value;
    if (des) desc.es = des.length > 120 ? `${des.slice(0, 117).trimEnd()}…` : des;
    if (den) desc.en = den.length > 120 ? `${den.slice(0, 117).trimEnd()}…` : den;

    const dish = { qid: q, label: { es, en, local }, kind, sitelinks: Object.keys(e.sitelinks || {}).length };
    if (image) dish.image = image;
    if (Object.keys(wiki).length) dish.wiki = wiki;
    if (Object.keys(desc).length) dish.desc = desc;
    if (curated) dish.curated = true;
    dishes.set(q, { dish, regions });
  }

  if (args.verbose) for (const line of droppedNames.sort()) console.log(`  - ${line}`);

  // Report classes the tables do not know, most common first (for tuning).
  const unknownTop = [...unknownClasses].sort((a, b) => b[1] - a[1]).slice(0, 25);
  if (unknownTop.length) {
    console.log('P31 classes not in KEEP/DROP (kept; add to a table if wrong):');
    for (const [c, n] of unknownTop) console.log(`  ${c} x${n}  ${classLabels.get(c) || '?'}`);
  }

  // 5. Group.
  const byRegion = new Map(); // regionId | 'all' -> dishes
  const rank = (a, b) => {
    const ca = includedOrder.has(a.qid) ? includedOrder.get(a.qid) : Infinity;
    const cb = includedOrder.has(b.qid) ? includedOrder.get(b.qid) : Infinity;
    if (ca !== cb) return ca - cb;
    if (b.sitelinks !== a.sitelinks) return b.sitelinks - a.sitelinks;
    return (a.label.es || '').localeCompare(b.label.es || '', 'es');
  };
  const NATION = '_all';
  for (const { dish, regions } of dishes.values()) {
    const targets = regions.length ? regions : [NATION];
    for (const r of targets) {
      if (!byRegion.has(r)) byRegion.set(r, []);
      byRegion.get(r).push(dish);
    }
  }
  const regions = [];
  for (const [id, list] of byRegion) {
    list.sort(rank);
    const meta = id === NATION ? { id: 'all', label: cfg.nationwide } : { id, label: regionsById.get(id).label };
    regions.push({ ...meta, dishes: list });
  }
  regions.sort((a, b) => {
    if (a.id === 'all') return -1;
    if (b.id === 'all') return 1;
    if (b.dishes.length !== a.dishes.length) return b.dishes.length - a.dishes.length;
    return a.label.es.localeCompare(b.label.es, 'es');
  });
  const all = [...dishes.values()].map((d) => d.dish).sort(rank);

  // 6. Write, shrinking until it fits.
  const out = {
    built: today(),
    source: 'Wikipedia categories (es, en) and Wikidata (CC0); images from Wikimedia Commons',
    attribution: 'Data: Wikidata (CC0). Descriptions and article links: Wikipedia (CC BY-SA 4.0). Images: Wikimedia Commons, each under its own license; link the file page.',
    notes: 'Dishes are the food articles es/en Wikipedia files under the country\'s cuisine categories, resolved to Wikidata items. A region is the state whose category the article sits in; "all" is the national tree. This is a filing, not a ranking: sitelinks counts Wikipedias with an article. curated: true marks items from data/overrides/dishes.json.',
    country: iso2,
    cuisine: cfg.cuisine,
    localLang: cfg.localLang || null,
    counts: { regions: regions.length, dishes: all.length, images: all.filter((d) => d.image).length },
    regions,
    all,
  };
  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${iso2}.json`);
  let json = JSON.stringify(out);
  const steps = [
    ['desc dropped', () => { for (const d of all) delete d.desc; }],
    ['nationwide list trimmed to 150 lowest-linked out', () => {
      const nation = regions.find((r) => r.id === 'all');
      if (!nation) return;
      const cut = new Set(nation.dishes.slice(150).filter((d) => !d.curated).map((d) => d.qid));
      nation.dishes = nation.dishes.filter((d) => !cut.has(d.qid));
      out.all = out.all.filter((d) => !cut.has(d.qid));
    }],
  ];
  for (const [what, fn] of steps) {
    if (Buffer.byteLength(json) <= MAX_BYTES) break;
    fn();
    json = JSON.stringify(out);
    console.log(`over ${MAX_BYTES / 1024} KB: ${what} -> ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
  }
  await writeFile(file, json);

  // Summary.
  console.log(`dropped: ${Object.entries(dropped).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`regions ${regions.length}, dishes ${all.length}, with image ${out.counts.images}, curated ${all.filter((d) => d.curated).length}`);
  const kindCount = {};
  for (const d of all) kindCount[d.kind] = (kindCount[d.kind] || 0) + 1;
  console.log(`kinds: ${Object.entries(kindCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  for (const r of regions) console.log(`  ${r.label.es}: ${r.dishes.length}`);
  console.log(`wrote ${file} (${(Buffer.byteLength(json) / 1024).toFixed(0)} KB)`);
  return out;
}

// --------------------------------------------------------------- main

const wanted = args.country ? String(args.country).toUpperCase().split(',') : Object.keys(COUNTRIES);
for (const iso2 of wanted) {
  if (!COUNTRIES[iso2]) {
    console.error(`${iso2}: not configured. Add it to COUNTRIES in tools/build-food.mjs (see docs/PIPELINES.md, Food).`);
    process.exitCode = 1;
  }
}
if (FRESH) await rm(FOOD_CACHE, { recursive: true, force: true });
const overrides = JSON.parse(await readFile(OVERRIDES, 'utf8'));
for (const iso2 of wanted.filter((c) => COUNTRIES[c])) {
  try {
    await buildCountry(iso2, COUNTRIES[iso2], overrides);
  } catch (err) {
    console.error(`${iso2}: ${err.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${liveRequests} live requests (the rest from data/cache/food/)`);
