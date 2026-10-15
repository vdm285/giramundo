const TABS = new Set(['historia', 'comida', 'cultura', 'viajes', 'hoy']);

export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#/, '').split('/').filter(Boolean);
  if (!parts.length) return null;
  const iso = /^[a-z]{2}$/i.test(parts[0]) ? parts[0].toUpperCase() : null;
  const placeId = iso ? null : parts[0];
  const tab = TABS.has(parts[1]) ? parts[1] : 'historia';
  const kids = parts.includes('ninos');
  let lang = null;
  if (parts.includes('en')) lang = 'en';
  else if (parts.includes('es')) lang = 'es';
  return { iso, placeId, tab, kids, lang };
}

export function buildHash({ iso, placeId, tab, kids, lang }) {
  const id = (iso || placeId || 'mx').toLowerCase();
  const parts = [id, tab || 'historia'];
  if (kids) parts.push('ninos');
  if (lang === 'en') parts.push('en');
  return `#${parts.join('/')}`;
}
