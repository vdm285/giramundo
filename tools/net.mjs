// Shared helpers for the build scripts in tools/: polite fetch with retries,
// a disk cache in data/cache/ (gitignored), a small worker pool, and the
// country join against public/data/facts.json.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const UA = 'Giramundo/1.0 (https://github.com/vdm285/giramundo; educational static site)';
export const cacheDir = join(root, 'data/cache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function pool(items, size, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

// fetch with retries on 429/5xx and network errors. Honors Retry-After.
export async function fetchRetry(url, init = {}, tries = 5) {
  let wait = 2000;
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= tries) {
      throw new Error(`${res.status} ${res.statusText} ${url.slice(0, 160)}`);
    }
    const after = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : wait);
    wait *= 2;
  }
}

// GET JSON, cached on disk under data/cache/<sub>/.
export async function getJsonCached(url, sub, headers = { Accept: 'application/json' }) {
  const dir = join(cacheDir, sub);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`);
  if (await exists(path)) return JSON.parse(await readFile(path, 'utf8'));
  const res = await fetchRetry(url, { headers });
  const text = await res.text();
  const data = JSON.parse(text);
  await writeFile(path, text);
  return data;
}

// Wikidata SPARQL (POST so long VALUES lists fit), cached by query text.
export async function sparql(query, sub = 'wikidata') {
  const dir = join(cacheDir, sub);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${createHash('sha1').update(query).digest('hex').slice(0, 16)}.json`);
  if (await exists(path)) return JSON.parse(await readFile(path, 'utf8')).results.bindings;
  const res = await fetchRetry('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ query }).toString(),
  });
  const text = await res.text();
  const data = JSON.parse(text);
  await writeFile(path, text);
  return data.results.bindings;
}

export async function loadFacts() {
  const facts = JSON.parse(await readFile(join(root, 'public/data/facts.json'), 'utf8'));
  const iso2 = new Set(facts.countries.map((c) => c.iso2));
  const byIso3 = new Map(facts.countries.map((c) => [c.iso3, c.iso2]));
  return { facts, iso2, byIso3 };
}

export const today = () => new Date().toISOString().slice(0, 10);

export function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
