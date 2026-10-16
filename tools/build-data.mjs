// Builds public/data/facts.json, copies the map, and downloads flags.
// Sources are fetched once at build time so the site stays static.
// Re-run: npm run data

import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCountry } from 'countries-and-timezones';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Giramundo/1.0 (https://github.com/vdm285/giramundo; educational static site)';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function pool(items, size, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
}

const mledoze = JSON.parse(await readFile(join(root, 'data/cache/countries.json'), 'utf8'));
const dr5 = JSON.parse(await readFile(join(root, 'data/cache/dr5hn.json'), 'utf8'));
const byDr = new Map(dr5.map((c) => [c.iso2, c]));

const wb = await getJson('https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&mrnev=1&per_page=400');
const popByIso3 = new Map();
for (const row of wb[1] || []) {
  if (row?.countryiso3code && typeof row.value === 'number') {
    popByIso3.set(row.countryiso3code, { value: row.value, year: Number(row.date) });
  }
}

const iso2ByIso3 = new Map(mledoze.map((c) => [c.cca3, c.cca2]));

function zonesFor(iso2, dr) {
  const fromDr = (dr?.timezones || []).map((t) => t.zoneName).filter(Boolean);
  if (fromDr.length) return [...new Set(fromDr)];
  try {
    return getCountry(iso2)?.timezones || [];
  } catch {
    return [];
  }
}

const countries = mledoze.map((c) => {
  const dr = byDr.get(c.cca2);
  const pop = popByIso3.get(c.cca3);
  const es = c.translations?.spa?.common || c.name?.native?.spa?.common || dr?.native || c.name.common;
  const en = c.name.common;
  const natives = Object.values(c.name?.native || {}).map((n) => n.common).filter(Boolean);
  const ll = Array.isArray(c.latlng) && c.latlng.length === 2
    ? c.latlng.map(Number)
    : [Number(dr?.latitude), Number(dr?.longitude)];
  const currencies = Object.entries(c.currencies || {}).map(([code, v]) => ({
    code,
    symbol: v.symbol || '',
  }));
  if (!currencies.length && dr?.currency) {
    currencies.push({ code: dr.currency, symbol: dr.currency_symbol || '' });
  }
  return {
    iso2: c.cca2,
    iso3: c.cca3,
    ccn3: c.ccn3 ? String(Number(c.ccn3)) : null,
    name: { es, en },
    official: {
      es: c.translations?.spa?.official || es,
      en: c.name.official || en,
    },
    capital: {
      es: dr?.capital || c.capital?.[0] || '',
      en: c.capital?.[0] || dr?.capital || '',
    },
    ll: Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? ll : null,
    region: c.region || dr?.region || '',
    subregion: c.subregion || dr?.subregion || '',
    population: pop?.value ?? (Number(dr?.population) || null),
    popYear: pop?.year ?? null,
    area: Number(c.area) || Number(dr?.area_sq_km) || null,
    languages: Object.keys(c.languages || {}),
    currencies,
    timezones: zonesFor(c.cca2, dr),
    landlocked: Boolean(c.landlocked),
    independent: c.independent !== false,
    unMember: Boolean(c.unMember),
    borders: (c.borders || []).map((iso3) => iso2ByIso3.get(iso3)).filter(Boolean),
    calling: dr?.phonecode ? String(dr.phonecode) : '',
    flag: null,
    search: [...new Set([
      es, en, c.name.official, c.translations?.spa?.official, dr?.native, dr?.capital, c.capital?.[0],
      c.cca2, c.cca3, ...(c.altSpellings || []), ...natives,
    ].filter(Boolean))],
  };
}).filter((c) => c.iso2 && c.name.en);

const mexico = countries.find((c) => c.iso2 === 'MX');
if (!mexico || !(mexico.population > 100_000_000)) {
  throw new Error(`Mexico population looks wrong: ${mexico?.population}`);
}

await mkdir(join(root, 'public/flags'), { recursive: true });
await mkdir(join(root, 'public/data'), { recursive: true });
let flags = 0;
await pool(countries, 10, async (c) => {
  const dest = join(root, 'public/flags', `${c.iso2.toLowerCase()}.png`);
  if (await exists(dest)) {
    c.flag = `flags/${c.iso2.toLowerCase()}.png`;
    flags += 1;
    return;
  }
  const url = `https://flagcdn.com/w80/${c.iso2.toLowerCase()}.png`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    c.flag = `flags/${c.iso2.toLowerCase()}.png`;
    flags += 1;
  } catch {
    // A missing flag falls back to initials in the UI.
  }
});

const built = new Date().toISOString().slice(0, 10);
const facts = {
  built,
  sources: {
    names: 'mledoze/countries (names, area, borders, languages)',
    population: 'World Bank SP.POP.TOTL, most recent value per country, with dr5hn as fallback',
    timezones: 'dr5hn/countries-states-cities-database and countries-and-timezones',
    map: 'Natural Earth via world-atlas 2.0.2 (public domain)',
    flags: 'flagcdn.com',
    prose: 'Wikipedia summaries, CC BY-SA, fetched per country',
  },
  countries: countries.sort((a, b) => a.name.en.localeCompare(b.name.en)),
};

await writeFile(join(root, 'public/data/facts.json'), JSON.stringify(facts));
await copyFile(
  join(root, 'node_modules/world-atlas/countries-50m.json'),
  join(root, 'public/data/countries-50m.json'),
);
console.log(`facts ${countries.length}, flags ${flags}, built ${built}, MX pop ${mexico.population} (${mexico.popYear})`);
