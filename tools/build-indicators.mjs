// Builds public/data/indicators.json and public/data/pophistory.json from the
// World Bank World Development Indicators API (CC BY 4.0). Each indicator keeps
// the most recent non-empty value per country with its year. Aggregates
// (regions, income groups) do not join to facts.json and are dropped.
// Raw responses are cached in data/cache/worldbank/.
// Re-run: npm run indicators

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, pool, getJsonCached, loadFacts, today, round } from './net.mjs';

// World Bank codes that differ from the ISO3 in facts.json.
const WB_ALIASES = { XKX: 'XK' }; // Kosovo

const INDICATORS = {
  lifeExp: {
    code: 'SP.DYN.LE00.IN', decimals: 1,
    label: { es: 'Esperanza de vida', en: 'Life expectancy' },
    unit: { es: 'años', en: 'years' },
  },
  gdpPc: {
    code: 'NY.GDP.PCAP.CD', decimals: 0,
    label: { es: 'PIB por persona', en: 'GDP per person' },
    unit: { es: 'US$', en: 'US$' },
  },
  forest: {
    code: 'AG.LND.FRST.ZS', decimals: 1,
    label: { es: 'Bosques', en: 'Forest' },
    unit: { es: '% del territorio', en: '% of land' },
  },
  internet: {
    code: 'IT.NET.USER.ZS', decimals: 1,
    label: { es: 'Usan internet', en: 'Internet users' },
    unit: { es: '% de la gente', en: '% of people' },
  },
  urban: {
    code: 'SP.URB.TOTL.IN.ZS', decimals: 1,
    label: { es: 'Viven en ciudades', en: 'Live in cities' },
    unit: { es: '% de la gente', en: '% of people' },
  },
  fertility: {
    code: 'SP.DYN.TFRT.IN', decimals: 2,
    label: { es: 'Hijos por mujer', en: 'Births per woman' },
    unit: { es: 'hijos', en: 'births' },
  },
  kids: {
    code: 'SP.POP.0014.TO.ZS', decimals: 1,
    label: { es: 'Niñas y niños (0 a 14 años)', en: 'Children (ages 0–14)' },
    unit: { es: '% de la población', en: '% of population' },
  },
  // EN.ATM.CO2E.PC was archived; this is its WDI replacement (EDGAR, excl. LULUCF).
  co2Pc: {
    code: 'EN.GHG.CO2.PC.CE.AR5', decimals: 2,
    label: { es: 'CO₂ por persona', en: 'CO₂ per person' },
    unit: { es: 't al año', en: 't per year' },
  },
  electricity: {
    code: 'EG.ELC.ACCS.ZS', decimals: 1,
    label: { es: 'Tienen electricidad', en: 'Access to electricity' },
    unit: { es: '% de la gente', en: '% of people' },
  },
  renewables: {
    code: 'EG.FEC.RNEW.ZS', decimals: 1,
    label: { es: 'Energía renovable', en: 'Renewable energy' },
    unit: { es: '% de la energía usada', en: '% of final energy' },
  },
  popGrowth: {
    code: 'SP.POP.GROW', decimals: 2,
    label: { es: 'Crecimiento de la población', en: 'Population growth' },
    unit: { es: '% al año', en: '% per year' },
  },
};

const { iso2: known, byIso3 } = await loadFacts();
const toIso2 = (iso3) => {
  const iso2 = WB_ALIASES[iso3] || byIso3.get(iso3);
  return iso2 && known.has(iso2) ? iso2 : null;
};

// All pages of one World Bank query.
async function wbRows(code, query) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=20000&${query}&page=${page}`;
    const [meta, data] = await getJsonCached(url, 'worldbank');
    if (!meta || meta.message) throw new Error(`World Bank error for ${code}: ${JSON.stringify(meta)}`);
    rows.push(...(data || []));
    if (page >= meta.pages) return rows;
  }
}

const built = today();
const out = { built, source: 'World Bank, World Development Indicators', indicators: {} };
const report = [];

await pool(Object.entries(INDICATORS), 4, async ([key, def]) => {
  const rows = await wbRows(def.code, 'mrnev=1');
  const values = {};
  let wbName = '';
  for (const row of rows) {
    const iso2 = toIso2(row.countryiso3code);
    if (!iso2 || typeof row.value !== 'number' || !Number.isFinite(row.value)) continue;
    values[iso2] = [round(row.value, def.decimals), Number(row.date)];
    wbName ||= row.indicator?.value || '';
  }
  const n = Object.keys(values).length;
  if (n < 150) throw new Error(`${key} (${def.code}) only has ${n} countries`);
  const years = Object.values(values).map((v) => v[1]).sort((a, b) => a - b);
  report.push(`${key.padEnd(12)} ${def.code.padEnd(22)} ${n} countries, median year ${years[years.length >> 1]} (${years[0]}–${years.at(-1)})`);
  out.indicators[key] = {
    code: def.code, name: wbName, label: def.label, unit: def.unit, decimals: def.decimals, values,
  };
});

// Keep the declared order, not completion order.
out.indicators = Object.fromEntries(Object.keys(INDICATORS).map((k) => [k, out.indicators[k]]));

// Population for every year since 1960.
const START = 1960;
const END = new Date().getFullYear();
const popRows = await wbRows('SP.POP.TOTL', `date=${START}:${END}`);
const series = {};
for (const row of popRows) {
  const iso2 = toIso2(row.countryiso3code);
  if (!iso2) continue;
  const i = Number(row.date) - START;
  if (i < 0) continue;
  series[iso2] ||= [];
  series[iso2][i] = typeof row.value === 'number' ? Math.round(row.value) : null;
}
for (const [iso2, arr] of Object.entries(series)) {
  const filled = Array.from(arr, (v) => (v == null ? null : v));
  while (filled.length && filled.at(-1) == null) filled.pop();
  if (filled.length) series[iso2] = filled;
  else delete series[iso2];
}
const pop = { built, source: 'World Bank, World Development Indicators (SP.POP.TOTL)', start: START, values: series };

await writeFile(join(root, 'public/data/indicators.json'), JSON.stringify(out));
await writeFile(join(root, 'public/data/pophistory.json'), JSON.stringify(pop));
console.log(report.sort().join('\n'));
const mx = series.MX || [];
console.log(`pophistory ${Object.keys(series).length} countries, MX ${START}=${mx[0]} latest=${mx.at(-1)} (${START + mx.length - 1})`);
