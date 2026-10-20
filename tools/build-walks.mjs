// Builds public/data/walks/{iso2}.json: recent videos from a curated list of
// travel channels (4K walking tours, street food, drone footage, city sounds),
// filed under the country whose city or name appears in the title. No key:
// YouTube publishes an Atom feed per channel at
//   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
// with the 15 latest videos (id, title, published, thumbnail). The channel id
// behind a handle is read once from the channel page HTML and cached.
//
// The per-country files are NOT committed (deploy-time, like news). We store
// only the video id, a snapshot of title and channel, the thumbnail URL the
// feed gave, and the match. The site shows the channel, links to YouTube and
// plays through the official embed; it does not host or re-encode anything.
//
// Matching is by title only, longest name first, on word boundaries, with
// accents stripped on both sides: a city from cities.json (es or en name)
// wins over a country name, which wins over a demonym ("Mexican"). A city
// name that is also an ordinary word (Nice, Tours, Split, Reading) or that
// exists in several countries (Valencia, Tripoli, Hyderabad) counts only when
// the title also names the country or the channel is about that one country.
// A channel that films a single country (Rambalac: Japan) files the videos
// whose title names no place under that country with place: null.
//
// Politeness: 3 requests in flight, starts 400 ms apart, feeds cached 6 h in
// data/cache/youtube-rss/ (channel ids: 30 days, missing handles: 7 days).
// Re-run: npm run walks            WALKS_DRY=1 npm run walks  (resolve only)

import { mkdir, readFile, writeFile, stat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { root, cacheDir, fetchRetry, loadFacts, exists, pool } from './net.mjs';

const OUT_DIR = join(root, 'public/data/walks');
const CACHE = join(cacheDir, 'youtube-rss');
const CHANNELS_CACHE = join(CACHE, 'channels.json');
const FEED_TTL_MS = 6 * 3600 * 1000;
const ID_TTL_MS = 30 * 24 * 3600 * 1000;
const MISS_TTL_MS = 7 * 24 * 3600 * 1000;
const POOL = 3;
const SPACING_MS = 400;
const MAX_PER_COUNTRY = 24;
const DRY = !!process.env.WALKS_DRY;

// Curated channels: [handle, kind, home]. kind: walk | food | drone | sounds.
// home: ISO2 when the channel films one country (used as the fallback country
// and to break ties); null for world channels. Verified 2026-10-20: every
// handle below resolved and its feed parsed. To add one, put it here and run
// WALKS_DRY=1 npm run walks; a handle that does not resolve is reported and
// skipped, never guessed.
const CHANNELS = [
  // walking tours
  ['Rambalac', 'walk', 'JP'],
  ['NIPPONWANDERINGTV', 'walk', 'JP'],
  ['TokyoExplorer', 'walk', 'JP'],
  ['JapanWalk', 'walk', 'JP'],
  ['SeoulWalker', 'walk', 'KR'],
  ['ProwalkTours', 'walk', null],
  ['WatchedWalker', 'walk', null],
  ['POPtravel', 'walk', null],
  ['KeeziWalks', 'walk', null],
  ['4KUrbanLife', 'walk', null],
  ['VirtualWalk', 'walk', null],
  ['NomadWalks', 'walk', null],
  ['WalkingToursbyKarl', 'walk', null],
  ['HPWalkingTours', 'walk', null],
  ['BookingHunterTV', 'walk', null],
  ['4KWalk', 'walk', null],
  ['WanderlustTravelVideos', 'walk', null],
  ['EuropeWalks', 'walk', null],
  ['WindWalk', 'walk', null],
  ['WindWalkTravelVideos', 'walk', null],
  ['CityWalks', 'walk', null],
  ['LatinWalks', 'walk', null],
  ['ActionKid', 'walk', 'US'],
  ['WalkEast', 'walk', null],
  ['WorldWalkingTours', 'walk', null],
  ['TheGlobalWalk', 'walk', null],
  ['AmbientWalking', 'sounds', null],
  ['NomadicAmbience', 'sounds', null],
  ['Walk4K', 'walk', null],
  ['JUTUBER', 'walk', null],
  ['SeongJaeWalk', 'walk', 'KR'],
  ['ChinaWalkingTours', 'walk', 'CN'],
  ['BeijingWalker', 'walk', 'CN'],
  ['WalkingTourSpain', 'walk', 'ES'],
  ['SpainWalks', 'walk', 'ES'],
  ['MadridWalk', 'walk', 'ES'],
  ['ParisWalks', 'walk', 'FR'],
  ['WalkingMexico', 'walk', 'MX'],
  ['CaminandoCDMX', 'walk', 'MX'],
  ['WalkingBogota', 'walk', 'CO'],
  ['CaminandoBuenosAires', 'walk', 'AR'],
  ['BuenosAiresWalks', 'walk', 'AR'],
  ['WalkingPeru', 'walk', 'PE'],
  ['UmbrellaWalk', 'walk', null],
  ['DreamyWalks', 'walk', null],
  ['RelaxingWalker', 'walk', null],
  ['TravelWalks4K', 'walk', null],
  ['ThroughMyLens', 'walk', null],
  ['Mapmaker', 'walk', null],
  ['WalkWithMe', 'walk', null],
  ['LivingWalks', 'walk', null],
  ['WalkRideFly', 'walk', null],
  ['Nomadic', 'walk', null],
  ['WorldWalkingTour', 'walk', null],
  ['WALKS_and_the_CITY', 'walk', null],
  ['BlaBlaWalker', 'walk', null],
  ['OneManWolfPack', 'walk', null],
  ['4KWorldWandering', 'walk', null],
  ['LADmob', 'walk', null],
  ['walkthetour', 'walk', null],
  ['ThroughStreetsAndTastes', 'walk', null],
  ['WalkinginIndia', 'walk', 'IN'],
  ['WalkingOZ', 'walk', null],
  ['narramundos', 'walk', null],
  ['JumpingPlaces', 'walk', null],
  ['TreadmillTV', 'walk', null],
  ['MexicoWalkingTours', 'walk', 'MX'],
  ['CaminandoPorMexico', 'walk', 'MX'],
  ['CDMXWalk', 'walk', 'MX'],
  ['WalkingTourMexico', 'walk', 'MX'],
  ['LimaWalk', 'walk', 'PE'],
  ['SantiagoWalk', 'walk', 'CL'],
  ['BogotaWalk', 'walk', 'CO'],
  ['CaminandoBogota', 'walk', 'CO'],
  ['poptravelorg', 'walk', null],
  // street food
  ['MarkWiens', 'food', null],
  ['BestEverFoodReviewShow', 'food', null],
  ['TheFoodRanger', 'food', null],
  ['StrictlyDumpling', 'food', null],
  ['ChopstickTravel', 'food', null],
  ['Davidsbeenhere', 'food', null],
  ['AdenFilms', 'food', null],
  ['YummyBoy', 'food', null],
  ['SettimeTravel', 'food', null],
  ['LaRutadelaGarnacha', 'food', 'MX'],
  ['AlexTienda', 'food', null],
  ['AlanxelMundo', 'walk', null],
  ['StreetFoodMexico', 'food', 'MX'],
  ['ComidaCallejeraMX', 'food', 'MX'],
  ['TacosdeCanasta', 'food', 'MX'],
  ['ElMundoDeDaniel', 'food', null],
  ['FoodieLand', 'food', null],
  ['KevinsKitchenAdventures', 'food', null],
  ['TravelThirsty', 'food', null],
  ['StreetFoodTV', 'food', null],
  ['TabiEats', 'food', 'JP'],
  ['sfk', 'food', null],
  ['luisitocomunica', 'walk', null],
  // drone / aerial
  ['ScenicRelaxation', 'drone', null],
  ['RelaxationFilm', 'drone', null],
  ['4KRelaxationChannel', 'drone', null],
  ['NatureRelaxationFilms', 'drone', null],
  ['DroneSnap', 'drone', null],
  ['AerialCinematics', 'drone', null],
  ['TheRelaxedGuy', 'drone', null],
  ['BeautifulWorld', 'drone', null],
  ['PlanetRelax', 'drone', null],
  ['AmazingPlacesOnOurPlanet', 'drone', null],
  ['TripAway', 'drone', null],
  ['SunnyDroneFilms', 'drone', null],
  ['ScenicRelaxationFilms', 'drone', null],
  // city sounds
  ['CitySounds', 'sounds', null],
  ['JapanAmbience', 'sounds', 'JP'],
  ['TokyoAmbience', 'sounds', 'JP'],
  ['WanderInRain', 'sounds', null],
  ['CalmedByNature', 'sounds', null],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pacing: every request start is at least SPACING_MS after the previous one,
// whichever worker asks.
let nextStart = 0;
async function paced(url, init) {
  const now = Date.now();
  const at = Math.max(now, nextStart);
  nextStart = at + SPACING_MS;
  if (at > now) await sleep(at - now);
  return fetchRetry(url, init, 3);
}

async function fresh(path, ttl) {
  try {
    const s = await stat(path);
    return Date.now() - s.mtimeMs < ttl;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// 1. Channel ids. The channel page carries
//    <meta itemprop="identifier" content="UC..."> and "externalId":"UC...".
//    Cached as { handle: { id, name, at } } (id null = handle not found).

async function loadChannelCache() {
  if (!(await exists(CHANNELS_CACHE))) return {};
  try { return JSON.parse(await readFile(CHANNELS_CACHE, 'utf8')); } catch { return {}; }
}

async function resolveHandle(handle) {
  const res = await paced(`https://www.youtube.com/@${encodeURIComponent(handle)}`, {
    headers: { Accept: 'text/html', 'Accept-Language': 'en' },
  }).catch((err) => {
    if (/^404 /.test(err.message)) return null;
    throw err;
  });
  if (!res) return { id: null, name: null };
  const html = await res.text();
  const id = /<meta itemprop="identifier" content="(UC[\w-]{22})"/.exec(html)?.[1]
    || /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1]
    || /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1]
    || null;
  const name = decodeEntities(/<meta itemprop="name" content="([^"]*)"/.exec(html)?.[1]
    || /<title>(.*?)(?: - YouTube)?<\/title>/.exec(html)?.[1] || '');
  return { id, name: name || null };
}

// ---------------------------------------------------------------------------
// 2. Feeds. Atom with yt: and media: namespaces; a small regex parser.

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

function parseFeed(xml) {
  const items = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const id = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(e)?.[1];
    if (!id) continue;
    items.push({
      id,
      title: decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] || ''),
      published: /<published>([^<]+)<\/published>/.exec(e)?.[1] || null,
      thumb: decodeEntities(/<media:thumbnail url="([^"]+)"/.exec(e)?.[1] || ''),
    });
  }
  return items;
}

async function fetchFeed(channelId) {
  const path = join(CACHE, `${channelId}.xml`);
  if (await fresh(path, FEED_TTL_MS)) return parseFeed(await readFile(path, 'utf8'));
  const res = await paced(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    headers: { Accept: 'application/atom+xml, text/xml' },
  });
  const xml = await res.text();
  const items = parseFeed(xml);
  if (!/<feed[\s>]/.test(xml)) throw new Error(`not an Atom feed (${xml.length} bytes)`);
  await writeFile(path, xml);
  return items;
}

// ---------------------------------------------------------------------------
// 3. Place matching.

// Accents off, lowercase, a few letters without a decomposition.
function fold(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l').replace(/[đĐ]/g, 'd').replace(/[æÆ]/g, 'ae').replace(/ı/g, 'i')
    .toLowerCase();
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// City names that are also ordinary words, first names or other things, in
// English or Spanish. They count only with the country named in the title or
// a single-country channel. Lowercase, folded.
const COMMON_CITY_WORDS = new Set([
  'nice', 'tours', 'split', 'reading', 'bath', 'mobile', 'orange', 'most', 'sale', 'hull', 'cork', 'derby',
  'salt', 'mango', 'david', 'mary', 'sur', 'lira', 'man', 'bo', 'lata', 'melo', 'pala', 'kaya', 'tema',
  'salta', 'salto', 'lagos', 'leon', 'nancy', 'wells', 'mesa', 'reno', 'eureka', 'buffalo', 'flint',
  'independence', 'victoria', 'trinidad', 'essen', 'brest', 'mons', 'angers', 'como', 'natal', 'santos',
  'mercedes', 'rosario', 'bello', 'soledad', 'pasto', 'armenia', 'perth', 'darwin', 'nelson', 'hastings',
  'regina', 'windsor', 'sydney', 'richmond', 'albany', 'dover', 'salem', 'lincoln', 'jackson', 'austin',
  'houston', 'phoenix', 'columbus', 'aurora', 'union', 'concord', 'bear', 'hope', 'para', 'manta', 'lima',
  'luxor', 'patan', 'ponce', 'porto', 'ruse', 'susa', 'sib', 'oran', 'arak', 'gaya', 'medan', 'maun',
  'gulu', 'kano', 'kandi', 'juba', 'dese', 'divo', 'rosso', 'nadi', 'macao', 'macau', 'roma', 'bata',
  'seeb', 'homs', 'hama', 'duma', 'douma', 'gaza', 'tete', 'moshi', 'mopti', 'pegu', 'bago', 'pune',
  'kaya', 'yei', 'wau', 'lae', 'gao', 'ibb', 'osh', 'ufa', 'aba', 'altai', 'george town', 'georgetown',
  'santa cruz', 'la paz', 'san jose', 'santiago', 'merida', 'cordoba', 'granada', 'toledo', 'valencia',
  'barcelona', 'cartagena', 'guadalajara', 'cuenca', 'leon', 'san juan', 'santa ana', 'la plata',
  'hamilton', 'kingston', 'plymouth', 'birmingham', 'manchester', 'cambridge', 'london', 'newcastle',
  'portland', 'durham', 'lancaster', 'alexandria', 'tripoli', 'hyderabad', 'concepcion', 'bucaramanga',
  'kayes', 'groningen',
]);

// Country names (or demonyms) that are also something else; same rule.
const COMMON_COUNTRY_WORDS = new Set([
  'georgia', 'jordan', 'chad', 'jersey', 'dominica', 'guinea', 'congo', 'niger', 'turkey', 'mali',
  'american', 'georgian', 'dominican', 'guinean', 'jordanian', 'nigerien', 'congolese', 'cook islands',
  'reunion', 'guam', 'man', 'niue', 'sur', 'palau',
]);

// Names people write that facts.json does not: aliases -> ISO2.
const COUNTRY_ALIASES = {
  TR: ['Turkey', 'Turkiye', 'Turquia'],
  CZ: ['Czech Republic', 'República Checa'],
  US: ['USA', 'U.S.A.', 'Estados Unidos de América', 'EE.UU.', 'EEUU', 'New York City', 'NYC'],
  GB: ['UK', 'U.K.', 'England', 'Great Britain', 'Britain', 'Scotland', 'Wales', 'Inglaterra', 'Escocia', 'Gran Bretaña'],
  NL: ['Holland', 'Holanda', 'The Netherlands'],
  MM: ['Burma', 'Birmania'],
  KR: ['Korea', 'Corea'],
  AE: ['UAE', 'EAU'],
  VA: ['Vatican', 'Vaticano'],
  CI: ["Côte d'Ivoire"],
  SZ: ['Swaziland', 'Suazilandia'],
  MK: ['Macedonia'],
  TL: ['East Timor'],
  CV: ['Cabo Verde'],
  SA: ['Arabia Saudita'],
  IR: ['Irán'],
  CN: ['Mainland China'],
  TW: ['Taipei', 'Taipéi'],
};

const { facts } = await loadFacts();
const cities = JSON.parse(await readFile(join(root, 'public/data/cities.json'), 'utf8'));
let demonyms = {};
try {
  const places = JSON.parse(await readFile(join(root, 'public/data/places.json'), 'utf8'));
  for (const [iso, c] of Object.entries(places.countries || {})) if (c.demonym) demonyms[iso] = c.demonym;
} catch { demonyms = {}; }

// Every name we can match: { key (folded), re, tier, iso, cityId, place, common, ambiguous }
const names = [];
{
  const cityByKey = new Map(); // folded name -> Set(iso)
  for (const [iso, list] of Object.entries(cities.countries)) {
    for (const c of list) {
      for (const n of new Set([c.name.en, c.name.es].filter(Boolean))) {
        const key = fold(n);
        if (!cityByKey.has(key)) cityByKey.set(key, new Set());
        cityByKey.get(key).add(iso);
        names.push({ key, tier: 0, iso, cityId: c.id, place: c.name.en, common: COMMON_CITY_WORDS.has(key) || key.length <= 3 });
      }
    }
  }
  for (const n of names) n.ambiguous = cityByKey.get(n.key).size > 1;
  const seen = new Set(names.map((n) => `${n.key}|${n.iso}`));
  const addCountry = (iso, text, tier) => {
    const key = fold(text);
    if (!key || seen.has(`${key}|${iso}`)) return;
    seen.add(`${key}|${iso}`);
    names.push({ key, tier, iso, cityId: null, place: null, common: COMMON_COUNTRY_WORDS.has(key) || key.length <= 3, ambiguous: false });
  };
  for (const c of facts.countries) {
    addCountry(c.iso2, c.name.en, 1);
    addCountry(c.iso2, c.name.es, 1);
    for (const a of COUNTRY_ALIASES[c.iso2] || []) addCountry(c.iso2, a, 1);
    const d = demonyms[c.iso2];
    if (d?.en) addCountry(c.iso2, d.en, 2);
    if (d?.es) addCountry(c.iso2, d.es, 2);
  }
  // Two countries called "Congo": ambiguous.
  const congo = names.filter((n) => n.tier === 1 && n.key === 'congo');
  if (congo.length > 1) for (const n of congo) n.ambiguous = true;
  names.sort((a, b) => b.key.length - a.key.length);
  for (const n of names) n.re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n.key)}(?![\\p{L}\\p{N}])`, 'u');
}

// Returns { iso, cityId, place, via } or null. via: city | country | demonym | channel.
function matchTitle(title, home) {
  const text = fold(title);
  const taken = []; // [start, end] spans already matched by a longer name
  const found = []; // { name, index }
  for (const n of names) {
    const m = n.re.exec(text);
    if (!m) continue;
    const s = m.index;
    const e = s + n.key.length;
    if (taken.some(([a, b]) => s < b && e > a)) continue;
    taken.push([s, e]);
    found.push({ n, index: s });
  }
  if (!found.length) return home ? { iso: home, cityId: null, place: null, via: 'channel' } : null;
  const countriesNamed = new Set(found.filter((f) => f.n.tier === 1 && !f.n.ambiguous && !f.n.common).map((f) => f.n.iso));
  const ok = (f) => {
    const n = f.n;
    if (!n.common && !n.ambiguous) return true;
    return countriesNamed.has(n.iso) || home === n.iso;
  };
  const good = found.filter(ok).sort((a, b) => a.n.tier - b.n.tier || a.index - b.index);
  if (!good.length) return home ? { iso: home, cityId: null, place: null, via: 'channel' } : null;
  const f = good[0];
  return { iso: f.n.iso, cityId: f.n.cityId, place: f.n.place, via: ['city', 'country', 'demonym'][f.n.tier] };
}

// ---------------------------------------------------------------------------
// 4. Run.

await mkdir(CACHE, { recursive: true });
const channelCache = await loadChannelCache();
const resolved = []; // { handle, kind, home, id, name }
const unresolved = [];
{
  const todo = CHANNELS.filter(([h]) => {
    const c = channelCache[h];
    if (!c) return true;
    return !(Date.now() - (c.at || 0) < (c.id ? ID_TTL_MS : MISS_TTL_MS));
  });
  await pool(todo, POOL, async ([handle]) => {
    try {
      const r = await resolveHandle(handle);
      channelCache[handle] = { ...r, at: Date.now() };
    } catch (err) {
      console.error(`@${handle}: ${err.message}`);
    }
  });
  await writeFile(CHANNELS_CACHE, JSON.stringify(channelCache, null, 1));
  for (const [handle, kind, home] of CHANNELS) {
    const c = channelCache[handle];
    if (c?.id) resolved.push({ handle, kind, home: home || null, id: c.id, name: c.name || handle });
    else unresolved.push(handle);
  }
}
console.log(`channels: ${resolved.length} resolved, ${unresolved.length} not found${unresolved.length ? ` (${unresolved.map((h) => `@${h}`).join(', ')})` : ''}`);
if (DRY) {
  for (const c of resolved) console.log(`  @${c.handle.padEnd(26)} ${c.id}  ${c.kind.padEnd(6)} ${c.home || '--'}  ${c.name}`);
  process.exit(0);
}

const byCountry = new Map(); // iso -> items
const stats = { videos: 0, matched: 0, via: { city: 0, country: 0, demonym: 0, channel: 0 }, feedErrors: [] };
const seenIds = new Set();
await pool(resolved, POOL, async (ch) => {
  let items;
  try {
    items = await fetchFeed(ch.id);
  } catch (err) {
    stats.feedErrors.push(`@${ch.handle}: ${err.message}`);
    return;
  }
  for (const it of items) {
    stats.videos += 1;
    const m = matchTitle(it.title, ch.home);
    if (!m) continue;
    if (seenIds.has(`${m.iso}|${it.id}`)) continue;
    seenIds.add(`${m.iso}|${it.id}`);
    stats.matched += 1;
    stats.via[m.via] += 1;
    const list = byCountry.get(m.iso) || [];
    list.push({
      id: it.id, kind: ch.kind, title: it.title, channel: ch.name,
      place: m.place, cityId: m.cityId, published: it.published, thumb: it.thumb || null,
      via: m.via, handle: ch.handle,
    });
    byCountry.set(m.iso, list);
  }
});

// Per country: newest first, but round-robin across channels so one prolific
// channel does not fill the whole list; cities named in the title before
// channel-only matches of the same age.
function pick(list) {
  const groups = new Map();
  for (const it of list.sort((a, b) => (a.via === 'channel') - (b.via === 'channel') || String(b.published).localeCompare(String(a.published)))) {
    if (!groups.has(it.handle)) groups.set(it.handle, []);
    groups.get(it.handle).push(it);
  }
  const out = [];
  while (out.length < MAX_PER_COUNTRY && groups.size) {
    for (const [h, g] of [...groups]) {
      out.push(g.shift());
      if (!g.length) groups.delete(h);
      if (out.length >= MAX_PER_COUNTRY) break;
    }
  }
  return out.map(({ handle, ...it }) => it);
}

await mkdir(OUT_DIR, { recursive: true });
for (const f of await readdir(OUT_DIR)) if (f.endsWith('.json')) await unlink(join(OUT_DIR, f));
const built = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const index = {
  built,
  source: 'YouTube channel feeds (Atom, no key). Titles and thumbnails are a snapshot; the site re-reads them through oEmbed at view time.',
  attribution: 'Videos belong to their channels. Show the channel name, link to YouTube, play through the official embed.',
  channels: resolved.map(({ handle, id, name, kind, home }) => ({ handle, id, name, kind, home })),
  countries: {},
};
let withItems = 0;
let cityMatches = 0;
for (const c of facts.countries) {
  const list = byCountry.get(c.iso2);
  if (!list?.length) continue;
  const items = pick(list);
  await writeFile(join(OUT_DIR, `${c.iso2.toLowerCase()}.json`), JSON.stringify({ iso2: c.iso2, built, items }));
  const kinds = {};
  for (const it of items) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
  const cities = new Set(items.filter((it) => it.cityId).map((it) => it.cityId));
  index.countries[c.iso2] = { items: items.length, cities: cities.size, kinds };
  withItems += 1;
  cityMatches += cities.size;
}
await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(index));

console.log(`videos: ${stats.videos} in ${resolved.length - stats.feedErrors.length} feeds; ${stats.matched} filed (city ${stats.via.city}, country ${stats.via.country}, demonym ${stats.via.demonym}, channel-only ${stats.via.channel})`);
console.log(`countries with items: ${withItems}; distinct cities matched: ${cityMatches}; wrote ${OUT_DIR}`);
if (stats.feedErrors.length) console.log(`feed errors: ${stats.feedErrors.join('; ')}`);
