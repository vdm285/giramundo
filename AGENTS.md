# AGENTS.md — Giramundo

Read this before changing the app. `docs/VISION.md` says where the product is going and why. `HANDOFF.md` is the state of the code. `docs/PIPELINES.md` is how data gets in. `docs/EDITORIAL.md` is the rule for words on a card.

Owner: Victor (github.com/vdm285). The product opens in Mexican Spanish; English is the other button, not a second site. Audience: curious adults. Kid mode is parked, not deleted from the plan.

## What this is

A static globe on GitHub Pages. Three.js draws the Earth; a Canvas 2D flat map is the fallback and an alternative view. d3-geo decides which country a tap hit. Every country opens a dossier with eight sections: Inicio (the media overview the country opens on), Ahora, Historia, Comida, Cultura, Lugares, Ver, Datos. A second tap on the open country drops to its states (where `public/data/admin/` has them), full screen, with the dossier aside. Facts, Wikipedia extracts, indicators and places are vendored. Headlines and videos are collected at deploy time by GitHub Actions. Weather, rates, holidays, earthquakes and photos are fetched live from free, keyless, CORS-enabled sources. There is no server and no account.

## Do not

- Invent a population, a capital, a dish, a headline, or a place. If the source does not have it, the dossier says so.
- Add a paid API, a key that must stay secret in the browser, or anything that stops working when a subscription lapses. Keys allowed: a YouTube Data API key as an Actions secret, a referrer-locked Google Maps Embed key.
- Commit the deploy-time files (`public/data/news/`, `public/data/videos/`). They are rebuilt on every deploy so the repository stays small.
- "Fix" a border by editing a shape to match one country's claim. The map is Natural Earth de facto. `src/data/disputed.js` is where the disagreement is spoken, naming the parties, picking no winner.
- Flip a sign in `src/geo/orient.js` or `src/geo/math.js` without running `npm test`. Those tests are the spec: the place you view faces +Z, east is screen-right, north is screen-up, a drag to the right carries the ground to the right.
- Present Wikipedia or a publisher's text as if we wrote it. Keep the link and the credit.
- Add ads, tracking, or a login.

## Where things live

- `src/globe/scene.js`: renderer, Earth, clouds, atmosphere, stars, outline, markers, arcs, picking. The NASA plates, the id map and the border map put longitude 0 at the center; the sphere's UV puts it on the left, so the shader samples at `uv.x + 0.5`.
- `src/globe/shaders.js`: all GLSL. Linear light inside, `colorspace_fragment` at the end.
- `src/globe/paint.js`: the country-id texture (R + G·256 = id), the border texture, palette textures.
- `src/globe/camera.js`: view state `{lat, lon, dist}`, drag with inertia, wheel and pinch, flights, idle spin.
- `src/flat/map.js`: the flat map with the same interface as the globe (`flyTo`, `setSelected`, `setMarkers`, `pickLatLon`...).
- `src/app/app.js`: store, surface switching, content fetching per country, the shell. `src/app/router.js`: hash `#mx/ahora/en`.
- `src/dossier/`: lit templates. `dossier.js` is the frame; `inicio.js` the overview; `money.js` the banknotes, coin, converter and rate line; `sections.js` the rest. lit escapes by default; never use `unsafeHTML` on fetched text.
- `src/live/sources.js`: every outside call. Add new sources there, with their license in a comment.
- Shell rule (Victor, 2026-10-20): the only fixed controls are the lens (search) and the cog (Settings), translucent at the corners. Anything used less than constantly goes into Settings or onto the card; nothing takes padding from the viewport. No wordmark.
- `public/data/facts.json`: one row per country (`npm run data`). `public/data/wiki/{iso}.json`: extracts (`npm run stories`). `public/data/indicators.json`, `pophistory.json` (`npm run indicators`). `public/data/places.json` (`npm run places`). `public/data/radio.json` (`npm run radio`). `public/data/cities.json` (`npm run cities`). `public/data/culture.json` (`npm run culture`). Deploy-time only, never committed: `public/data/news/`, `public/data/videos/`.
- Loading is two-phase (`src/data/load.js`): `loadWorld` fetches shapes and facts so the globe can mount; `loadExtras` adds everything else in place. A new dataset goes in `loadExtras` and is read defensively (it may be null for a moment).
- `tools/net.mjs`: shared fetch, cache, pool for the build scripts.
- `tests/`: `npm test`. Do not weaken a test to make a change pass.

## Checks

`npm test`, then `npm run dev`, then look at Mexico and at Japan, in Earth, Atlas and Data, on the globe and on the flat map, with the dossier open and collapsed. A country you just opened must land in the part of the screen the dossier does not cover and stay there (spin waits). Disputed places must show their note. Nothing on a card may be invented.
