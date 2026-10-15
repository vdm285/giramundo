import { EXTRA_ALIASES, norm } from './aliases.js';

export function prepareSearch(countries) {
  for (const country of countries) {
    const extra = EXTRA_ALIASES[country.iso2] || [];
    country._n = [...new Set([...(country.search || []), ...extra, country.name?.es, country.name?.en]
      .filter(Boolean)
      .map(norm)
      .filter(Boolean))];
  }
  return countries;
}

export function searchCountries(countries, query, limit = 7) {
  const q = norm(query);
  if (!q) return [];
  const scored = [];
  for (const country of countries) {
    let score = 0;
    if (country.iso2?.toLowerCase() === q || country.iso3?.toLowerCase() === q) score = 96;
    else if (country._n?.some((n) => n === q)) score = 100;
    else if (country._n?.some((n) => n.startsWith(q))) score = 80;
    else if (country._n?.some((n) => n.includes(q))) score = 48;
    if (score) scored.push({ country, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.country.population || 0) - (a.country.population || 0));
  return scored.slice(0, limit).map((row) => row.country);
}
