// Live sources the browser calls directly (Mode A in docs/VISION.md): all
// free, keyless, and CORS-enabled as of 2026-10-16. Every function returns
// null on failure instead of throwing, and caches in memory per session.
// Static files produced at deploy time (news, videos) are read here too.

const memory = new Map();

async function getJson(url, { ttlMs = 10 * 60 * 1000, headers } = {}) {
  const hit = memory.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) { memory.set(url, { at: Date.now(), value: null }); return null; }
    const value = await res.json();
    memory.set(url, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

const WIKI_HEADERS = { 'Api-User-Agent': 'Giramundo/1.0 (https://github.com/vdm285/giramundo)' };

// ---------- Wikipedia ----------

export async function loadStory(iso2, base) {
  if (!iso2) return null;
  return getJson(`${base}data/wiki/${iso2.toLowerCase()}.json`, { ttlMs: Infinity });
}

export async function wikiSummary(lang, title) {
  if (!title) return null;
  const host = lang === 'en' ? 'en' : 'es';
  const data = await getJson(`https://${host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { ttlMs: Infinity, headers: WIKI_HEADERS });
  if (!data?.extract) return null;
  return {
    title: data.title,
    extract: data.extract,
    description: data.description || '',
    url: data.content_urls?.desktop?.page || '',
    thumb: data.thumbnail?.source || '',
    image: data.originalimage?.source || '',
  };
}

// First photograph on an article that is not a flag, a seal, a map or a chart.
const NOT_A_PHOTO = /flag|bandera|coat|escudo|emblem|seal|map|mapa|carte|locat|orthographic|globe|chart|graph|diagram|logo|region|departem|provinc|territor|border|relief|topograph|satellite|climat|köppen|koppen|population|density|gdp|language|religion|anthem|himno|signature|firma|stamp|coin|banknote|\.svg$|\.gif$|\.png$/i;

export async function wikiPhoto(lang, title) {
  if (!title) return null;
  const host = lang === 'en' ? 'en' : 'es';
  const data = await getJson(`https://${host}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title.replace(/ /g, '_'))}`, { ttlMs: Infinity, headers: WIKI_HEADERS });
  const items = (data?.items || []).filter((i) => i.type === 'image' && i.showInGallery !== false);
  for (const item of items) {
    const name = item.title || '';
    if (NOT_A_PHOTO.test(name)) continue;
    const src = item.srcset?.[0]?.src || '';
    if (!src) continue;
    return {
      src: commonsThumb(name.replace(/^File:/i, ''), 1000),
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(name.replace(/ /g, '_'))}`,
      caption: item.caption?.text || '',
    };
  }
  return null;
}

function pad(n) { return String(n).padStart(2, '0'); }

// Yesterday's most-read articles (today's are not final yet).
export async function wikiMostRead(lang) {
  const d = new Date(Date.now() - 86400000);
  const host = lang === 'en' ? 'en' : 'es';
  const data = await getJson(`https://${host}.wikipedia.org/api/rest_v1/feed/featured/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, { ttlMs: 3600e3, headers: WIKI_HEADERS });
  return (data?.mostread?.articles || []).map((a) => ({
    title: a.titles?.normalized || a.title,
    extract: a.extract || '',
    description: a.description || '',
    url: a.content_urls?.desktop?.page || '',
    views: a.views,
    thumb: a.thumbnail?.source || '',
  }));
}

export async function wikiToday(lang) {
  const now = new Date();
  const host = lang === 'en' ? 'en' : 'es';
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const [events, featured] = await Promise.all([
    getJson(`https://${host}.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`, { ttlMs: 6 * 3600e3, headers: WIKI_HEADERS }),
    getJson(`https://${host}.wikipedia.org/api/rest_v1/feed/featured/${now.getFullYear()}/${mm}/${dd}`, { ttlMs: 3600e3, headers: WIKI_HEADERS }),
  ]);
  return {
    events: (events?.events || []).map((e) => ({ year: e.year, text: e.text, url: e.pages?.[0]?.content_urls?.desktop?.page || '' })),
    news: (featured?.news || []).map((n) => ({
      text: (n.story || '').replace(/<[^>]+>/g, ''),
      url: n.links?.[0]?.content_urls?.desktop?.page || '',
      titles: (n.links || []).map((l) => l.titles?.normalized || ''),
    })),
    date: now.toISOString().slice(0, 10),
  };
}

// ---------- Commons ----------

export function commonsThumb(filename, width = 900) {
  if (!filename) return '';
  const name = String(filename).replace(/^File:/i, '').replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

export function commonsPage(filename) {
  const name = String(filename).replace(/^File:/i, '').replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`;
}

// ---------- Weather (Open-Meteo, CC BY 4.0) ----------

const WMO = {
  0: ['Despejado', 'Clear sky'],
  1: ['Mayormente despejado', 'Mainly clear'],
  2: ['Parcialmente nublado', 'Partly cloudy'],
  3: ['Nublado', 'Overcast'],
  45: ['Niebla', 'Fog'],
  48: ['Niebla con escarcha', 'Rime fog'],
  51: ['Llovizna ligera', 'Light drizzle'],
  53: ['Llovizna', 'Drizzle'],
  55: ['Llovizna densa', 'Dense drizzle'],
  61: ['Lluvia ligera', 'Light rain'],
  63: ['Lluvia', 'Rain'],
  65: ['Lluvia fuerte', 'Heavy rain'],
  66: ['Lluvia helada', 'Freezing rain'],
  67: ['Lluvia helada fuerte', 'Heavy freezing rain'],
  71: ['Nieve ligera', 'Light snow'],
  73: ['Nieve', 'Snow'],
  75: ['Nieve fuerte', 'Heavy snow'],
  77: ['Granizo fino', 'Snow grains'],
  80: ['Chubascos ligeros', 'Light showers'],
  81: ['Chubascos', 'Showers'],
  82: ['Chubascos fuertes', 'Violent showers'],
  85: ['Chubascos de nieve', 'Snow showers'],
  86: ['Chubascos de nieve fuertes', 'Heavy snow showers'],
  95: ['Tormenta', 'Thunderstorm'],
  96: ['Tormenta con granizo', 'Thunderstorm with hail'],
  99: ['Tormenta con granizo fuerte', 'Thunderstorm with heavy hail'],
};

export async function weatherAt(lat, lon) {
  if (lat == null) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&timezone=auto`;
  const data = await getJson(url, { ttlMs: 15 * 60e3 });
  const c = data?.current;
  if (!c) return null;
  const code = WMO[c.weather_code] || ['', ''];
  return {
    temp: c.temperature_2m,
    feels: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    code: c.weather_code,
    isDay: c.is_day === 1,
    desc: { es: code[0], en: code[1] },
    timezone: data.timezone,
  };
}

// ---------- Money (Frankfurter) ----------

export async function rates() {
  // One call for everything: rates against USD, latest working day.
  const data = await getJson('https://api.frankfurter.dev/v1/latest?base=USD', { ttlMs: 6 * 3600e3 });
  if (!data?.rates) return null;
  return { date: data.date, usd: { USD: 1, ...data.rates } };
}

// ---------- Holidays (Nager.Date) ----------

export async function holidaysToday(iso2) {
  if (!iso2) return [];
  const year = new Date().getFullYear();
  const data = await getJson(`https://date.nager.at/api/v3/PublicHolidays/${year}/${iso2}`, { ttlMs: 24 * 3600e3 });
  if (!Array.isArray(data)) return [];
  const today = new Date().toISOString().slice(0, 10);
  return data.filter((h) => h.date === today).map((h) => ({ local: h.localName, name: h.name }));
}

export async function nextHoliday(iso2) {
  if (!iso2) return null;
  const data = await getJson(`https://date.nager.at/api/v3/NextPublicHolidays/${iso2}`, { ttlMs: 24 * 3600e3 });
  const h = Array.isArray(data) ? data[0] : null;
  return h ? { date: h.date, local: h.localName, name: h.name } : null;
}

// ---------- Earthquakes (USGS, public domain) ----------

export async function quakesWeek() {
  const data = await getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', { ttlMs: 20 * 60e3 });
  if (!data?.features) return [];
  return data.features.map((f) => ({
    mag: f.properties.mag,
    place: f.properties.place,
    time: f.properties.time,
    url: f.properties.url,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    depth: f.geometry.coordinates[2],
  }));
}

// ---------- The ISS ----------

export async function issNow() {
  const data = await getJson('https://api.wheretheiss.at/v1/satellites/25544', { ttlMs: 5000 });
  if (!data || data.latitude == null) return null;
  return { lat: data.latitude, lon: data.longitude, altKm: data.altitude, velocity: data.velocity };
}

// ---------- Deploy-time files ----------

export async function loadNews(iso2, base) {
  if (!iso2) return null;
  return getJson(`${base}data/news/${iso2.toLowerCase()}.json`, { ttlMs: 30 * 60e3 });
}

// Videos come from three keyless-or-free sources, merged: the curated seed
// (hand-verified), the Data API output when the owner has a key, and the
// channel RSS "walks" collected at deploy time. De-duplicated by id.
export async function loadVideos(iso2, base, seed) {
  if (!iso2) return null;
  const low = iso2.toLowerCase();
  const [file, walks] = await Promise.all([
    getJson(`${base}data/videos/${low}.json`, { ttlMs: Infinity }),
    getJson(`${base}data/walks/${low}.json`, { ttlMs: Infinity }),
  ]);
  const seen = new Set();
  const items = [];
  for (const v of [...(file?.items || []), ...(seed?.countries?.[iso2] || seed?.[iso2] || []), ...(walks?.items || [])]) {
    if (!v?.id || seen.has(v.id)) continue;
    seen.add(v.id);
    items.push(v);
  }
  return items.length ? { iso2, items } : null;
}

export async function youtubeInfo(id) {
  return getJson(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, { ttlMs: Infinity });
}
