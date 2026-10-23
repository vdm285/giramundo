import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Stamp the built service worker (public/sw.js) with the build's hashed files
// under assets/ and an id taken from them: a deploy that changes the code
// installs a new worker, its install caches this build's page and code, and its
// activate prunes earlier builds' files from the cache. A data-only redeploy
// (the six-hourly news run) leaves sw.js unchanged.
const swStamp = () => {
  let outDir = resolve('dist');
  let base = '/';
  return {
    name: 'sw-stamp',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    closeBundle() {
      const file = join(outDir, 'sw.js');
      if (!existsSync(file)) return;
      const list = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
        ? list(join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]));
      const assetsDir = join(outDir, 'assets');
      const assets = existsSync(assetsDir) ? list(assetsDir).sort() : [];
      // An empty list would leave the worker fetching and pruning nothing: fail the build instead.
      if (!assets.length) throw new Error(`sw-stamp: no files under ${assetsDir}`);
      // The worker's install refuses a page that names a file under assets/ the list lacks, and its
      // activate prunes what the list does not name: the built page must name only listed files.
      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      const entry = html.match(/<script\b[^>]*\btype="module"[^>]*>/)?.[0].match(/\bsrc="([^"]+)"/)?.[1] || '';
      const prefix = `${base}assets/`;
      if (!entry.startsWith(prefix) || !assets.includes(entry.slice(prefix.length))) throw new Error(`sw-stamp: the entry script of index.html (${entry || 'none'}) is not among the files under ${prefix}`);
      const unlisted = [...html.matchAll(/assets\/([^"'?#\s>]+)/g)].map((m) => m[1]).filter((name) => !assets.includes(name));
      if (unlisted.length) throw new Error(`sw-stamp: index.html names files under assets/ that are not there: ${unlisted.join(', ')}`);
      const id = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
      const src = readFileSync(file, 'utf8');
      const idSlot = "'__GIRAMUNDO_BUILD__'";
      const assetsSlot = '/*__GIRAMUNDO_ASSETS__*/ []';
      if (!src.includes(idSlot) || !src.includes(assetsSlot)) throw new Error('sw-stamp: the placeholders are missing from sw.js');
      // functions, so a "$" in a file name is not read as a replacement pattern
      writeFileSync(file, src.replace(idSlot, () => JSON.stringify(id)).replace(assetsSlot, () => JSON.stringify(assets)));
    },
  };
};

// GitHub Pages serves the site from /giramundo/. Local dev stays at /.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173, host: true },
  plugins: [swStamp()],
});
