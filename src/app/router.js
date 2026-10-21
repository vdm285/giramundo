// The hash is the share link: #mx (opens Inicio), #mx/historia, #jp/ver/en, #somaliland/ahora.
// Country first (ISO 3166-1 alpha-2, lowercase, or a place id for the two
// shapes without a code), then the section, then an optional language.

export const SECTIONS = ['inicio', 'ahora', 'historia', 'comida', 'cultura', 'lugares', 'ver', 'datos'];
const SECTION_SET = new Set(SECTIONS);

// A city inside a country: #mx/ciudad/mx-guadalajara (the id comes from
// public/data/cities.json).
export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return null;
  const iso = /^[a-z]{2}$/i.test(parts[0]) ? parts[0].toUpperCase() : null;
  const placeId = iso ? null : parts[0];
  const city = parts[1] === 'ciudad' && parts[2] ? parts[2] : null;
  const section = SECTION_SET.has(parts[1]) ? parts[1] : null;
  let lang = null;
  if (parts.includes('en')) lang = 'en';
  else if (parts.includes('es')) lang = 'es';
  return { iso, placeId, section, city, lang };
}

export function buildHash({ iso, placeId, section, city, lang }) {
  const id = (iso || placeId || '').toLowerCase();
  if (!id) return '#';
  const parts = [id];
  if (city) parts.push('ciudad', city);
  else if (section && section !== 'inicio') parts.push(section);
  if (lang === 'en') parts.push('en');
  return `#${parts.join('/')}`;
}
