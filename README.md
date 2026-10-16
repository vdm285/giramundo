# Giramundo

Spin the Earth. Tap a country. See it, know it, and feel what is happening there right now: headlines, weather, local time, history, food, culture, World Heritage sites with photos, walking-tour videos, Street View, and forty years of data. Spanish first, English one click away. Free, no account, no ads, no server.

Live: https://vdm285.github.io/giramundo/

The product vision and roadmap are in [`docs/VISION.md`](docs/VISION.md). How the data is collected is in [`docs/PIPELINES.md`](docs/PIPELINES.md). The state of the code is in [`HANDOFF.md`](HANDOFF.md). Rules for the words on a card are in [`docs/EDITORIAL.md`](docs/EDITORIAL.md).

## Run it

```bash
npm install
npm test
npm run dev
```

Open http://localhost:5173. For headlines locally, run `npm run news` once (it takes about two minutes and writes files that are not committed).

## Settings

The gear at the right end of the bottom dock opens the only settings menu: visual quality (Automatic, Full, Simple, or the flat map), which country opens when there is no link (country of the day, your home country, where you are, random, or the last one you saw), your home country, the idle spin, and a slider to move the sun. Everything is stored in the browser only. A shared link always opens the country in the link.

`npm run build` makes the static site in `dist/`. GitHub Pages publishes `main`, on every push and on a schedule every six hours so the headlines stay fresh.

## What is where

- `src/globe/`: the Three.js globe. `scene.js` builds the scene, `camera.js` handles drag, zoom and flights, `shaders.js` is the GLSL, `paint.js` paints the country-id and border textures.
- `src/flat/map.js`: the flat equirectangular map, drawn with Canvas 2D. Same picking, same dossier.
- `src/app/`: the controller (`app.js`), the store, the hash router, the strings.
- `src/dossier/`: the country panel and its seven sections.
- `src/live/sources.js`: every live source the browser calls, and the deploy-time files it reads.
- `src/data/`: loading and shaping the country data; `src/geo/`: sphere math, picking, oceans.
- `tools/`: build scripts for facts, Wikipedia extracts, World Bank indicators, headlines, places and videos.
- `public/data/`: the vendored data. `public/textures/`: NASA plates and the cloud and relief maps.
- `tests/`: `npm test`. The geo tests are the spec for the sphere frame; do not weaken them.

## Data and credits

- Country shapes: Natural Earth 1:50m (public domain) via `world-atlas`.
- Earth plates: NASA Visible Earth, Blue Marble and Black Marble (public domain). Clouds and relief from NASA plates.
- Facts: `mledoze/countries`, `dr5hn/countries-states-cities-database`, and the World Bank (`SP.POP.TOTL`, CC BY 4.0).
- Indicators and population history: World Bank, World Development Indicators (CC BY 4.0).
- Paragraphs: Wikipedia introductions (CC BY-SA), linked to the article.
- Places and dishes: Wikidata (CC0). Photos: Wikimedia Commons, each under its own license, linked.
- Headlines: Google News RSS searches and publisher feeds; headline and link only, each credited to its publisher.
- Weather: Open-Meteo (CC BY 4.0). Exchange rates: Frankfurter. Holidays: Nager.Date. Earthquakes: USGS.
- Videos: embedded from YouTube; they belong to their creators.

Code: MIT, see `LICENSE`.
