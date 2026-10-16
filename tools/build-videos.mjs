// Builds public/data/videos/{iso2}.json: a few YouTube video IDs per country
// (walking tours of the capital, street food, drone footage) for the "See"
// section of the dossier. The per-country files are NOT committed; they are
// produced at deploy time by a scheduled GitHub Actions run.
//
// Two modes:
//
//  - With YOUTUBE_API_KEY in the environment: YouTube Data API v3 search.list,
//    up to 3 queries per country, 4 results each. search.list costs 100 quota
//    units and the free quota is 10,000 units a day, so one run makes at most
//    MAX_SEARCHES (95) searches and remembers where it stopped in
//    data/cache/youtube/cursor.json. Successive daily runs sweep all countries
//    in about 8 days (250 countries x 3 queries / 95), then start over so no
//    stored metadata is older than YouTube's 30-day refresh rule. A country
//    whose turn has not come keeps its previous file (or the seed).
//
//  - Without a key: copies public/data/videos-seed.json (hand-curated,
//    oEmbed-verified IDs for a few countries) into the per-country files so
//    local development works, and prints a notice.
//
// We store only the video ID, the kind, the query, the channel and the title.
// The site must re-fetch title and thumbnail through YouTube oEmbed when it
// shows a video, so what the viewer sees is never older than 30 days.
// Re-run: npm run videos   (YOUTUBE_API_KEY=... npm run videos for the API)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, cacheDir, fetchRetry, loadFacts, today, exists } from './net.mjs';

const OUT_DIR = join(root, 'public/data/videos');
const SEED = join(root, 'public/data/videos-seed.json');
const CURSOR = join(cacheDir, 'youtube/cursor.json');
const MAX_SEARCHES = 95; // 95 x 100 units = 9,500 of the 10,000 daily units
const PER_QUERY = 4;
const API = 'https://www.googleapis.com/youtube/v3/search';

const { facts } = await loadFacts();
await mkdir(OUT_DIR, { recursive: true });

const fileFor = (iso2) => join(OUT_DIR, `${iso2.toLowerCase()}.json`);

async function writeCountry(iso2, items) {
  await writeFile(fileFor(iso2), JSON.stringify({ iso2, built: today(), items }));
}

// Queries per country. relevanceLanguage steers the ranking, not a filter.
function queriesFor(c) {
  const capital = c.capital?.en;
  const name = c.name.en;
  const list = [];
  if (capital) list.push({ kind: 'walk', q: `${capital} walking tour 4K`, lang: 'en' });
  list.push({ kind: 'food', q: `${name} street food`, lang: 'en' });
  list.push({ kind: 'drone', q: `${name} drone 4K`, lang: 'en' });
  return list;
}

async function searchYouTube(key, { q, lang }) {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    q,
    maxResults: String(PER_QUERY),
    videoEmbeddable: 'true',
    videoDuration: 'long', // > 20 minutes
    safeSearch: 'moderate',
    relevanceLanguage: lang,
    key, // last, so a truncated error message never includes it
  });
  const res = await fetchRetry(`${API}?${params}`, { headers: { Accept: 'application/json' } }, 2);
  const data = await res.json();
  return (data.items || [])
    .filter((it) => it.id?.videoId)
    .map((it) => ({
      id: it.id.videoId,
      channel: it.snippet?.channelTitle || '',
      title: it.snippet?.title || '',
    }));
}

async function fromSeed() {
  if (!(await exists(SEED))) {
    console.log(`No YOUTUBE_API_KEY and no ${SEED}; nothing written.`);
    return;
  }
  const seed = JSON.parse(await readFile(SEED, 'utf8'));
  let n = 0;
  for (const [iso2, items] of Object.entries(seed.countries || {})) {
    await writeCountry(iso2, items.map(({ id, kind, query, channel, title, place }) => ({ id, kind, query, channel, title, place })));
    n += 1;
  }
  console.log(`YOUTUBE_API_KEY is not set: copied the hand-curated seed for ${n} countries into ${OUT_DIR}.`);
  console.log('Set YOUTUBE_API_KEY (YouTube Data API v3) to search for every country.');
}

async function fromApi(key) {
  const countries = facts.countries;
  let cursor = { next: 0, started: null };
  if (await exists(CURSOR)) {
    try { cursor = { ...cursor, ...JSON.parse(await readFile(CURSOR, 'utf8')) }; } catch { /* fresh cursor */ }
  }
  if (cursor.next >= countries.length) cursor.next = 0;
  if (cursor.next === 0) cursor.started = today();

  let searches = 0;
  let done = 0;
  const start = cursor.next;
  let i = start;
  for (; i < countries.length; i += 1) {
    const c = countries[i];
    const queries = queriesFor(c);
    if (searches + queries.length > MAX_SEARCHES) break;
    const items = [];
    const seen = new Set();
    for (const query of queries) {
      let results;
      try {
        results = await searchYouTube(key, query);
      } catch (err) {
        // 403 here is almost always quotaExceeded, 400 a bad key: stop, keep
        // the cursor on this country and resume next run. Never echo the key.
        console.error(`${c.iso2} "${query.q}": ${err.message.split(key).join('***')}`);
        if (/^4\d\d /.test(err.message)) { await saveCursor(i); report(start, i, searches, done); return; }
        searches += 1;
        continue;
      }
      searches += 1;
      for (const r of results) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        items.push({ id: r.id, kind: query.kind, query: query.q, channel: r.channel, title: r.title });
      }
    }
    await writeCountry(c.iso2, items);
    done += 1;
  }
  await saveCursor(i);
  report(start, i, searches, done);

  async function saveCursor(next) {
    await mkdir(join(cacheDir, 'youtube'), { recursive: true });
    await writeFile(CURSOR, JSON.stringify({ next: next >= countries.length ? 0 : next, started: cursor.started, updated: today() }));
  }
  function report(from, to, used, written) {
    const slice = countries.slice(from, to).map((c) => c.iso2);
    console.log(`YouTube: ${used} searches (${used * 100} quota units), ${written} countries written: ${slice[0] || '-'}..${slice.at(-1) || '-'}`);
    console.log(to >= countries.length ? 'Sweep complete; the next run starts over at the first country.' : `Next run resumes at ${countries[to].iso2} (${countries.length - to} countries left).`);
  }
}

const key = process.env.YOUTUBE_API_KEY;
if (key) await fromApi(key);
else await fromSeed();
