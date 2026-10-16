import { feature } from 'topojson-client';
import { makeIndex } from '../geo/pick.js';
import { continentOf } from './format.js';
import { prepareSearch } from './search.js';

const PALETTE = {
  'North America': ['#e3d2b0', '#f0e2c4', '#cbb892'],
  'South America': ['#c9d7a6', '#dce8bf', '#b4c68f'],
  Europe: ['#efd0c0', '#f6dfd2', '#e0b8a4'],
  Africa: ['#e6c07e', '#f3d29a', '#d4ab68'],
  Asia: ['#c9d4e6', '#dce5f2', '#b4c3d8'],
  Oceania: ['#b7d8d0', '#d0e8e2', '#9ec7bd'],
  Antarctica: ['#e7eef2', '#f5f8fa', '#d5e1e8'],
  Other: ['#e4d8c8', '#efe6da', '#d3c4b0'],
};

const SPECIALS = [
  {
    placeId: 'northern-cyprus',
    featureName: 'N. Cyprus',
    name: { es: 'Chipre del Norte', en: 'Northern Cyprus' },
    official: { es: 'Administración del norte de Chipre', en: 'Administration of northern Cyprus' },
    ll: [35.25, 33.4],
    related: 'CY',
    region: 'Europe',
    subregion: 'Southern Europe',
    search: ['Chipre del Norte', 'Northern Cyprus', 'Chipre'],
  },
  {
    placeId: 'somaliland',
    featureName: 'Somaliland',
    name: { es: 'Somalilandia', en: 'Somaliland' },
    official: { es: 'Somalilandia', en: 'Somaliland' },
    ll: [9.56, 44.07],
    related: 'SO',
    region: 'Africa',
    subregion: 'Eastern Africa',
    search: ['Somalilandia', 'Somaliland'],
  },
];

function shadeCountries(countries) {
  const shade = new Map();
  const order = [...countries].sort((a, b) => (b.borders?.length || 0) - (a.borders?.length || 0));
  for (const country of order) {
    const used = new Set((country.borders || []).map((iso) => shade.get(iso)).filter((n) => n != null));
    let k = 0;
    while (used.has(k) && k < 3) k += 1;
    shade.set(country.iso2 || country.placeId, k % 3);
  }
  for (const country of countries) {
    const key = continentOf(country);
    const colors = PALETTE[key] || PALETTE.Other;
    country.continent = key;
    country.fill = colors[shade.get(country.iso2 || country.placeId) % colors.length];
  }
}

export async function loadWorld(base) {
  const optional = (url) => fetch(url).then((res) => (res.ok ? res.json() : null)).catch(() => null);
  const [facts, topo, indicators, pophistory, places, videoSeed, radio, cities] = await Promise.all([
    fetch(`${base}data/facts.json`).then((res) => res.json()),
    fetch(`${base}data/countries-50m.json`).then((res) => res.json()),
    optional(`${base}data/indicators.json`),
    optional(`${base}data/pophistory.json`),
    optional(`${base}data/places.json`),
    optional(`${base}data/videos-seed.json`),
    optional(`${base}data/radio.json`),
    optional(`${base}data/cities.json`),
  ]);
  const countries = facts.countries.map((country) => ({ ...country, onMap: false }));
  const byIso = new Map(countries.map((c) => [c.iso2, c]));
  const byCcn = new Map(countries.filter((c) => c.ccn3).map((c) => [String(Number(c.ccn3)), c]));
  const fc = feature(topo, topo.objects.countries);

  for (const shape of fc.features) {
    const numeric = shape.id != null && shape.id !== '' ? String(Number(shape.id)) : null;
    let country = numeric && numeric !== 'NaN' ? byCcn.get(numeric) : null;
    const named = { Kosovo: 'XK', 'Indian Ocean Ter.': 'IO' }[shape.properties.name];
    if (named) country = byIso.get(named) || country;
    if (country) {
      shape.properties.iso2 = country.iso2;
      country.onMap = true;
    } else {
      const special = SPECIALS.find((s) => s.featureName === shape.properties.name);
      if (special) shape.properties.placeId = special.placeId;
    }
  }

  const specials = SPECIALS.map((s) => ({
    ...s,
    iso2: null,
    onMap: true,
    population: null,
    area: null,
    languages: [],
    currencies: [],
    timezones: s.placeId === 'northern-cyprus' ? ['Asia/Nicosia'] : ['Africa/Mogadishu'],
    borders: s.related ? [s.related] : [],
    capital: { es: '', en: '' },
    landlocked: false,
    flag: null,
  }));
  const all = [...countries, ...specials];
  shadeCountries(all);
  for (const shape of fc.features) {
    const country = shape.properties.iso2
      ? byIso.get(shape.properties.iso2)
      : specials.find((s) => s.placeId === shape.properties.placeId);
    shape.properties.fill = country?.fill || '#d9cbb8';
  }
  prepareSearch(all);
  return {
    built: facts.built,
    sources: facts.sources,
    indicators: indicators?.indicators || null,
    indicatorsBuilt: indicators?.built || null,
    pophistory: pophistory || null,
    places: places?.countries || null,
    videoSeed: videoSeed || null,
    radio: radio?.countries || null,
    cities: cities?.countries || null,
    countries: all,
    byIso,
    byPlace: new Map(specials.map((s) => [s.placeId, s])),
    features: fc.features,
    index: makeIndex(fc.features),
    mexico: byIso.get('MX'),
  };
}
