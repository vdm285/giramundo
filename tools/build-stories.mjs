// Fetches short Wikipedia intros for history, food and culture.
// Resumable: raw pages live in data/cache/wiki-pages.json (gitignored).
// Output: public/data/wiki/{iso}.json  — CC BY-SA, keep the article links.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Giramundo/1.0 (https://github.com/vdm285/giramundo; educational static site; contact via github.com/vdm285)';
const cachePath = join(root, 'data/cache/wiki-pages.json');

const facts = JSON.parse(await readFile(join(root, 'public/data/facts.json'), 'utf8'));
let cache = {};
try { cache = JSON.parse(await readFile(cachePath, 'utf8')); } catch { cache = {}; }

function titlesFor(lang, layer, name) {
  if (layer === 'historia') return [name];
  if (lang === 'es' && layer === 'comida') {
    return [`Gastronomía de ${name}`, `Gastronomía del ${name}`, `Gastronomía de la ${name}`, `Gastronomía de los ${name}`];
  }
  if (lang === 'en' && layer === 'comida') {
    return [`${name} cuisine`, `Cuisine of ${name}`, `Cuisine of the ${name}`];
  }
  if (lang === 'es') {
    return [`Cultura de ${name}`, `Cultura del ${name}`, `Cultura de la ${name}`, `Cultura de los ${name}`];
  }
  return [`Culture of ${name}`, `Culture of the ${name}`];
}

function acceptable(layer, page) {
  if (!page || page.missing || !page.extract || page.extract.length < 80) return false;
  const title = page.title || '';
  if (/desambiguación|disambiguation/i.test(title)) return false;
  if (layer === 'historia') return true;
  return /gastronom|cocina|cuisine|cultura|culture/i.test(title);
}

async function fetchBatch(lang, titles) {
  const pending = titles.filter((t) => cache[`${lang}:${t}`] === undefined);
  if (!pending.length) return;
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=extracts|pageimages|info&inprop=url&piprop=thumbnail&pithumbsize=480&exintro=1&explaintext=1&exchars=1200&titles=${pending.map((t) => encodeURIComponent(t)).join('|')}`;
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.status !== 429 && res.status !== 503) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`${res.status} ${lang} batch`);
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {});
  const byTitle = new Map(pages.map((p) => [p.title, p]));
  for (const r of data.query?.redirects || []) {
    const target = byTitle.get(r.to);
    if (target) byTitle.set(r.from, target);
  }
  for (const n of data.query?.normalized || []) {
    const target = byTitle.get(n.to);
    if (target) byTitle.set(n.from, target);
  }
  for (const title of pending) {
    const page = byTitle.get(title);
    cache[`${lang}:${title}`] = page ? {
      title: page.title,
      extract: page.extract || '',
      url: page.fullurl || '',
      thumb: page.thumbnail?.source || '',
      missing: Boolean(page.missing) || !page.extract,
    } : { missing: true, title, extract: '', url: '', thumb: '' };
  }
}

function pack(page) {
  if (!page || page.missing) return null;
  return {
    title: page.title,
    extract: page.extract,
    url: page.url,
    thumb: page.thumb && page.thumb.startsWith('https://') ? page.thumb : '',
  };
}

const jobs = [];
for (const c of facts.countries) {
  for (const lang of ['es', 'en']) {
    const name = c.name[lang] || c.name.en;
    for (const layer of ['historia', 'comida', 'cultura']) {
      for (const title of titlesFor(lang, layer, name)) jobs.push({ lang, title });
    }
  }
}
const unique = [];
const seen = new Set();
for (const job of jobs) {
  const key = `${job.lang}:${job.title}`;
  if (seen.has(key) || cache[key]) continue;
  seen.add(key);
  unique.push(job);
}
console.log(`wiki lookups to do: ${unique.length} (cached ${Object.keys(cache).length})`);

const byLang = { es: [], en: [] };
for (const job of unique) byLang[job.lang].push(job.title);
for (const lang of ['es', 'en']) {
  const list = byLang[lang];
  for (let i = 0; i < list.length; i += 12) {
    const batch = list.slice(i, i + 12);
    await fetchBatch(lang, batch);
    if ((i / 12) % 8 === 0) {
      await writeFile(cachePath, JSON.stringify(cache));
      console.log(`${lang} ${Math.min(i + 12, list.length)}/${list.length}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}
await writeFile(cachePath, JSON.stringify(cache));

await mkdir(join(root, 'public/data/wiki'), { recursive: true });
let written = 0;
for (const c of facts.countries) {
  const story = { iso2: c.iso2, fetched: facts.built, license: 'CC BY-SA 4.0', es: {}, en: {} };
  for (const lang of ['es', 'en']) {
    const name = c.name[lang] || c.name.en;
    for (const layer of ['historia', 'comida', 'cultura']) {
      const hit = titlesFor(lang, layer, name)
        .map((title) => cache[`${lang}:${title}`])
        .find((page) => acceptable(layer, page));
      story[lang][layer] = pack(hit);
    }
  }
  await writeFile(join(root, 'public/data/wiki', `${c.iso2.toLowerCase()}.json`), JSON.stringify(story));
  written += 1;
}
const withFood = facts.countries.filter((c) => {
  // counted below from files we just composed
  return true;
}).length;
let foodEs = 0;
let cultureEs = 0;
for (const c of facts.countries) {
  const name = c.name.es;
  if (titlesFor('es', 'comida', name).some((t) => acceptable('comida', cache[`es:${t}`]))) foodEs += 1;
  if (titlesFor('es', 'cultura', name).some((t) => acceptable('cultura', cache[`es:${t}`]))) cultureEs += 1;
}
console.log(`wrote ${written} stories; es food ${foodEs}; es culture ${cultureEs}`);
await access(join(root, 'public/data/wiki/mx.json'));
