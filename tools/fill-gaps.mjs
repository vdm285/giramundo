// Fills Wikipedia layers that the first pass missed.
// Uses the English article's Spanish link, then search, then a section of the
// country article. Never invents a paragraph. Resumable through data/cache.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'GloboCurioso/1.0 (https://github.com/vdm285/interactive-globe; educational static site; contact via github.com/vdm285)';
const cachePath = join(root, 'data/cache/wiki-pages.json');
const facts = JSON.parse(await readFile(join(root, 'public/data/facts.json'), 'utf8'));
let cache = {};
try { cache = JSON.parse(await readFile(cachePath, 'utf8')); } catch { cache = {}; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wiki(lang, params) {
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}&format=json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.status === 429 || res.status === 503) {
      await sleep(1200 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${lang}`);
    return res.json();
  }
  throw new Error(`gave up ${lang}`);
}

function cleanText(text) {
  return String(text || '')
    .replace(/\[\s*editar\s*\]/gi, '')
    .replace(/\[\s*edit\s*\]/gi, '')
    .replace(/Artículo principal:\s*[^.]+\.?\s*/gi, '')
    .replace(/Main article:\s*[^.]+\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function good(page, layer) {
  if (!page?.extract || page.extract.length < 80 || page.missing) return false;
  const title = page.title || '';
  if (/desambiguación|disambiguation|lista de |list of /i.test(title)) return false;
  if (layer === 'historia') return true;
  if (layer === 'comida') return /gastronom|cocina|cuisine|aliment|food/i.test(title);
  return /cultura|culture/i.test(title);
}

async function rememberExtract(lang, title) {
  const key = `${lang}:${title}`;
  if (cache[key]?.extract || cache[key]?.missing) return cache[key];
  const data = await wiki(lang, `action=query&redirects=1&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=1100&titles=${encodeURIComponent(title)}`);
  await sleep(80);
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
  const page = byTitle.get(title) || pages[0];
  cache[key] = page && !page.missing && page.extract ? {
    title: page.title,
    extract: page.extract,
    url: page.fullurl || '',
    thumb: '',
    missing: false,
  } : { missing: true, title, extract: '', url: '', thumb: '' };
  return cache[key];
}

async function langlink(from, title, to) {
  const key = `ll:${from}:${to}:${title}`;
  if (cache[key] !== undefined) return cache[key];
  const data = await wiki(from, `action=query&redirects=1&prop=langlinks&lllang=${to}&lllimit=1&titles=${encodeURIComponent(title)}`);
  await sleep(80);
  const page = Object.values(data.query?.pages || {})[0];
  cache[key] = page?.langlinks?.[0]?.['*'] || '';
  return cache[key];
}

async function search(lang, q) {
  const key = `search:${lang}:${q}`;
  if (cache[key]) return cache[key];
  const data = await wiki(lang, `action=query&list=search&srlimit=5&srsearch=${encodeURIComponent(q)}`);
  await sleep(90);
  cache[key] = (data.query?.search || []).map((row) => row.title);
  return cache[key];
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function sectionExtract(lang, pageTitle, layer) {
  const key = `sec:${lang}:${layer}:${pageTitle}`;
  if (cache[key] !== undefined) return cache[key];
  const words = layer === 'comida'
    ? ['gastronom', 'cocina', 'aliment', 'cuisine', 'food']
    : ['cultura', 'culture'];
  let data;
  try {
    data = await wiki(lang, `action=parse&redirects=1&prop=sections&page=${encodeURIComponent(pageTitle)}`);
  } catch {
    cache[key] = null;
    return null;
  }
  await sleep(80);
  const sections = data.parse?.sections || [];
  const hit = sections.find((section) => words.some((word) => section.line?.toLowerCase().includes(word))
    && !/lista|list of|referenc|bibliog|véase|see also/i.test(section.line || ''));
  if (!hit) {
    cache[key] = null;
    return null;
  }
  const html = await wiki(lang, `action=parse&prop=text&section=${hit.index}&page=${encodeURIComponent(pageTitle)}`);
  await sleep(80);
  const text = cleanText(htmlToText(html.parse?.text?.['*'])).slice(0, 1100);
  if (text.length < 80) {
    cache[key] = null;
    return null;
  }
  const host = lang === 'en' ? 'en.wikipedia.org' : 'es.wikipedia.org';
  const slug = encodeURIComponent(pageTitle.replace(/ /g, '_'));
  const hash = encodeURIComponent(hit.line.replace(/ /g, '_'));
  cache[key] = {
    title: `${hit.line} — ${pageTitle}`,
    extract: text,
    url: `https://${host}/wiki/${slug}#${hash}`,
    thumb: '',
  };
  return cache[key];
}

function queries(country, lang, layer) {
  const name = country.name[lang] || country.name.en;
  const official = country.official?.[lang] || '';
  if (layer === 'historia') return [name, official].filter(Boolean);
  if (layer === 'comida' && lang === 'es') return [`Gastronomía de ${name}`, `Cocina ${name}`, `Gastronomía ${official}`];
  if (layer === 'comida') return [`${name} cuisine`, `Cuisine of ${name}`, `Cuisine of the ${name}`];
  if (lang === 'es') return [`Cultura de ${name}`, `Cultura ${official}`];
  return [`Culture of ${name}`, `Culture of the ${name}`];
}

async function resolve(country, lang, layer, story) {
  const other = lang === 'es' ? 'en' : 'es';
  const otherPage = story[other]?.[layer];
  if (otherPage?.title && !otherPage.title.includes('—')) {
    const linked = await langlink(other, otherPage.title, lang);
    if (linked) {
      const page = await rememberExtract(lang, linked);
      if (good(page, layer)) return page;
    }
  }
  for (const q of queries(country, lang, layer)) {
    const titles = await search(lang, q);
    for (const title of titles) {
      const fake = { title, extract: 'x'.repeat(80) };
      if (!good(fake, layer)) continue;
      const page = await rememberExtract(lang, title);
      if (good(page, layer)) return page;
    }
  }
  if (layer !== 'historia' && story[lang]?.historia?.title) {
    const baseTitle = story[lang].historia.title.split(' — ')[0];
    const section = await sectionExtract(lang, baseTitle, layer);
    if (section && good(section, layer)) return section;
  }
  if (layer !== 'historia' && otherPage && good(otherPage, layer)) {
    return { ...otherPage, fallbackLang: other };
  }
  return null;
}

let changed = 0;
let looked = 0;
for (const country of facts.countries) {
  const path = join(root, 'public/data/wiki', `${country.iso2.toLowerCase()}.json`);
  const story = JSON.parse(await readFile(path, 'utf8'));
  let cleaned = false;
  for (const lang of ['es', 'en']) {
    for (const layer of ['historia', 'comida', 'cultura']) {
      const page = story[lang]?.[layer];
      if (!page?.extract) continue;
      const next = cleanText(page.extract);
      if (next !== page.extract) {
        page.extract = next;
        cleaned = true;
      }
    }
  }
  if (cleaned) await writeFile(path, JSON.stringify(story));
}
for (const country of facts.countries) {
  const path = join(root, 'public/data/wiki', `${country.iso2.toLowerCase()}.json`);
  const story = JSON.parse(await readFile(path, 'utf8'));
  let dirty = false;
  for (const lang of ['es', 'en']) {
    story[lang] = story[lang] || {};
    for (const layer of ['historia', 'comida', 'cultura']) {
      if (good(story[lang][layer], layer)) continue;
      looked += 1;
      const found = await resolve(country, lang, layer, story);
      if (found && good(found, layer)) {
        story[lang][layer] = found;
        dirty = true;
      }
    }
  }
  if (dirty) {
    await writeFile(path, JSON.stringify(story));
    changed += 1;
  }
  if (changed && changed % 20 === 0) await writeFile(cachePath, JSON.stringify(cache));
}
await writeFile(cachePath, JSON.stringify(cache));

const tally = { es: { historia: 0, comida: 0, cultura: 0 }, en: { historia: 0, comida: 0, cultura: 0 } };
for (const country of facts.countries) {
  const story = JSON.parse(await readFile(join(root, 'public/data/wiki', `${country.iso2.toLowerCase()}.json`), 'utf8'));
  for (const lang of ['es', 'en']) {
    for (const layer of ['historia', 'comida', 'cultura']) {
      if (good(story[lang]?.[layer], layer)) tally[lang][layer] += 1;
    }
  }
}
console.log(JSON.stringify({ changed, looked, of: facts.countries.length, tally }, null, 2));
