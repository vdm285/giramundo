// Offline shell, for same-origin GET requests only. The rules:
// - The page: network first, always revalidated, kept under one key, "./". A
//   network that fails, stalls for 3.5 s or answers 404/5xx gets the kept page
//   when there is one. A stamped worker keeps only its own build's page.
// - Files under assets/ (code, styles, fonts): cache first. Their names are
//   hashed, so a new build brings new names: install caches this build's files
//   and activate prunes the ones it does not list.
// - The data JSON (anything not named here): network first and revalidated,
//   so a deploy and fresh headlines show up at once; the cached copy offline.
// - Textures, flags and images (.png, .jpg, .svg) outside assets/: cache first,
//   forever, never revalidated. A changed one needs a new file name.
// One cache name across deploys, so textures, flags and data are not fetched again.
const CACHE = 'giramundo-v2';
// Earlier names of this app's cache (git history), deleted by exact name: the
// origin vdm285.github.io is shared with the owner's other apps (Papelito,
// A cómo, Tabla Viva), whose caches are theirs.
const RETIRED = ['globo-curioso-v1', 'giramundo-v1'];
const HEAVY = /\/(textures|flags|assets)\/|\.(woff2?|png|jpg|svg)$/;
// The build stamps both (vite.config.js, swStamp): an id taken from the build's
// files, so a deploy that changes the code installs a new worker, and the
// build's hashed files under assets/, the ones install fetches and the prune
// keeps. Unstamped (public/sw.js as the dev server serves it), the list is
// empty: install fetches nothing and activate prunes no code.
const BUILD = '__GIRAMUNDO_BUILD__';
const BUILD_ASSETS = /*__GIRAMUNDO_ASSETS__*/ [];
// This worker's own path (/giramundo/ on Pages). Cache Storage belongs to the
// origin, not the path.
const SCOPE = new URL('./', self.location.href).pathname;
const ASSETS = `${SCOPE}assets/`;
// The page is kept under one key, "./", whatever a link added to it
// (?fbclid=..., index.html), so copies do not pile up.
const SHELL = new URL('./', self.location.href).href;
const isPage = (url) => url.pathname === SCOPE || url.pathname === `${SCOPE}index.html`;
// Pages answers every file with max-age=600, so a plain fetch can come from the
// browser's HTTP cache, up to 10 minutes old: a page that names code a new worker
// has just pruned, data from before the last deploy. The page and the data are
// always revalidated (a 304 when unchanged).
const FRESH = { cache: 'no-cache' };
// How long a navigation waits for the network before the kept page answers.
const PATIENCE = 3500;
// A page of this build: it names files under assets/, and every one is in the list.
const ownPage = (html) => {
  const named = [...html.matchAll(/assets\/([^"'?#\s>]+)/g)].map((m) => m[1]);
  return named.length > 0 && named.every((file) => BUILD_ASSETS.includes(file));
};

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if (!BUILD_ASSETS.length) return;
    // This build's page and code are cached before activate prunes the last
    // build's, so the cache never holds a page whose code is gone. A page that
    // names files outside this build (a CDN copy not yet updated) fails the
    // install: the current worker stays, and the next navigation tries again.
    const page = await fetch(SHELL, FRESH);
    if (!page.ok) throw new Error(`sw: the page answered ${page.status}`);
    if (!ownPage(await page.clone().text())) throw new Error('sw: the page is not this build\'s');
    // The .woff files are the fallback for browsers without woff2: cached only
    // if one asks. Files already cached (unchanged fonts, code the page just
    // loaded) are not fetched again.
    await Promise.all(BUILD_ASSETS.filter((file) => !file.endsWith('.woff')).map(async (file) => {
      const url = `${ASSETS}${file}`;
      if (!(await cache.match(url))) await cache.add(url);
    }));
    await cache.put(SHELL, page);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all(RETIRED.map((name) => caches.delete(name)));
    const keep = new Set(BUILD_ASSETS);
    const cache = await caches.open(CACHE);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      // copies of the page earlier workers kept per link
      const extraPage = isPage(url) && url.href !== SHELL;
      // the hashed files under this scope's assets/ that this build does not
      // list (0.76 MB of code a deploy); only when the list is known
      const oldCode = keep.size > 0 && url.pathname.startsWith(ASSETS) && !keep.has(url.pathname.slice(ASSETS.length));
      if (extraPage || oldCode) await cache.delete(request);
    }
    await self.clients.claim();
  })());
});

// A stamped worker keeps a page under "./" only when it is this build's: a newer
// build's page, fetched while this worker still runs, names code this cache may
// not hold, and that build's own install stores it (code first, page last).
// Unstamped, every page is kept.
async function keepPage(cache, response) {
  if (BUILD_ASSETS.length && !ownPage(await response.clone().text())) return;
  await cache.put(SHELL, response);
}

async function navigate(event, request, url) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, FRESH);
  // kept when it arrives, also after the kept copy has answered a slow network
  event.waitUntil(network.then((response) => (response.ok && isPage(url) ? keepPage(cache, response.clone()) : undefined)).catch(() => {}));
  const kept = async () => (isPage(url) ? undefined : await cache.match(request)) || cache.match(SHELL);
  try {
    const response = await Promise.race([network, new Promise((resolve) => { setTimeout(resolve, PATIENCE, null); })]);
    // no answer yet: the kept page, or wait on (nothing kept)
    if (!response) return (await kept()) || (await network);
    if (response.status === 404 || response.status >= 500) return (await kept()) || response;
    return response;
  } catch {
    return (await kept()) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(event, request, url));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (HEAVY.test(url.pathname)) {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }
    try {
      const response = await fetch(request, FRESH);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch {
      return (await cache.match(request)) || Response.error();
    }
  })());
});
