const memory = new Map();
const todayMemory = new Map();

const HARD = /muerte|muertos|murieron|murió|guerra|ataque|bombar|asesin|masacre|terror|killed|dead|death|war\b|bomb|massacre/i;

export function gentleItems(items, kids) {
  if (!kids) return items;
  return items.filter((item) => !HARD.test(`${item.text || ''} ${item.title || ''}`));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export async function loadStory(iso2, base) {
  const key = iso2.toLowerCase();
  if (memory.has(key)) return memory.get(key);
  const local = await fetchJson(`${base}data/wiki/${key}.json`);
  memory.set(key, local);
  return local;
}

export async function liveSummary(lang, title) {
  const key = `live:${lang}:${title}`;
  if (memory.has(key)) return memory.get(key);
  const host = lang === 'en' ? 'en' : 'es';
  const url = `https://${host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const data = await fetchJson(url);
  const page = data?.extract ? {
    title: data.title,
    extract: data.extract,
    url: data.content_urls?.desktop?.page || '',
    thumb: data.thumbnail?.source || '',
    description: data.description || '',
  } : null;
  memory.set(key, page);
  return page;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export async function loadToday(lang) {
  const now = new Date();
  const key = `${lang}:${now.getMonth()}:${now.getDate()}`;
  if (todayMemory.has(key)) return todayMemory.get(key);
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const host = lang === 'en' ? 'en' : 'es';
  const [events, featured] = await Promise.all([
    fetchJson(`https://${host}.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`),
    fetchJson(`https://${host}.wikipedia.org/api/rest_v1/feed/featured/${now.getFullYear()}/${mm}/${dd}`),
  ]);
  const pack = {
    events: (events?.events || []).map((event) => ({
      year: event.year,
      text: event.text,
      url: event.pages?.[0]?.content_urls?.desktop?.page || '',
    })),
    news: (featured?.news || []).map((item) => ({
      text: item.story || '',
      url: item.links?.[0]?.content_urls?.desktop?.page || '',
    })),
    date: now.toISOString().slice(0, 10),
  };
  todayMemory.set(key, pack);
  return pack;
}

export function matchesCountry(text, names) {
  const hay = (text || '').toLowerCase();
  return names.some((name) => name && hay.includes(name.toLowerCase()));
}
