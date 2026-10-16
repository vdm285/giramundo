// The hash is the share link: #mx/historia, #jp/ver/en, #somaliland/ahora.
// Country first (ISO 3166-1 alpha-2, lowercase, or a place id for the two
// shapes without a code), then the section, then an optional language.

export const SECTIONS = ['ahora', 'historia', 'comida', 'cultura', 'lugares', 'ver', 'datos'];
const SECTION_SET = new Set(SECTIONS);

export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return null;
  const iso = /^[a-z]{2}$/i.test(parts[0]) ? parts[0].toUpperCase() : null;
  const placeId = iso ? null : parts[0];
  const section = SECTION_SET.has(parts[1]) ? parts[1] : null;
  let lang = null;
  if (parts.includes('en')) lang = 'en';
  else if (parts.includes('es')) lang = 'es';
  return { iso, placeId, section, lang };
}

export function buildHash({ iso, placeId, section, lang }) {
  const id = (iso || placeId || '').toLowerCase();
  if (!id) return '#';
  const parts = [id];
  if (section && section !== 'historia') parts.push(section);
  if (lang === 'en') parts.push('en');
  return `#${parts.join('/')}`;
}
