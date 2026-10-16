# Handoff — 2026-10-16

The state of the code after the rebuild. `docs/VISION.md` is the plan; this file is what exists. Design calls below were made with Victor in this session.

## Shipped

- **Globe** (`src/globe/`): Three.js, NASA 4k day and night plates, cloud plate with shadows, relief from a height plate, atmospheric scattering shell, dusk band, city lights, ocean glint, twinkling stars. Three styles blend in the shader: Earth, Atlas (paper, per-country colors, graticule, hillshade) and Data (choropleth from a palette texture, hatched where there is no data). Selection is a fat-line outline plus a tint from a country-id texture; hover lifts; a beacon pulses at the selected point. Markers (small states, World Heritage sites) are a Points cloud; arcs exist for later tours.
- **Flat map** (`src/flat/map.js`): Canvas 2D equirectangular with the same interface as the globe (`flyTo`, `setSelected`, `setMarkers`, `setBeacon`, `pickLatLon`, `markerAt`...). Earth style draws the day plate with a computed night mask; Atlas and Data styles draw vectors. Scroll zooms toward the cursor, the world wraps. Offered automatically when WebGL is missing, and suggested when the globe runs under 20 fps for six seconds; also a toggle in the top bar.
- **Dossier** (`src/dossier/`): hero photo (first World Heritage photo, else the first non-flag photo on the Wikipedia article), flag, name, capital, local time; seven sections. Ahora: Open-Meteo weather at the capital (coordinates from the capital's Wikipedia summary), local time, Frankfurter rates against USD and MXN, Nager.Date holiday today or next, headlines (deploy-time JSON, both languages), Wikipedia on-this-day with lines about the country first, USGS quakes within 800 km. Historia, Comida, Cultura: vendored Wikipedia extracts with live fallback; Comida adds Wikidata dishes with Commons photos. Lugares: UNESCO sites grid with photos, tap to open a detail and fly there, pins on the globe. Ver: YouTube embeds (nocookie, click to play), grouped as walk, food, drone; Street View embed when `VITE_MAPS_EMBED_KEY` is set, otherwise links. Datos: population curve since 1960 as inline SVG, eleven World Bank indicators with value, year and rank, and a button to paint the map with each.
- **Shell** (`src/app/app.js`): wordmark, search with flags and alias notes (EUA, Holanda, Malvinas), view switch, language, dock (Surprise me, About), legend with an indicator picker in Data view, toasts, tooltip, keyboard (/ arrows + - Enter Esc).
- **Router** (`src/app/router.js`): `#mx`, `#jp/ver/en`, `#somaliland/ahora`. Hash changes after load are followed.
- **Pipelines** (`docs/PIPELINES.md`): headlines every six hours at deploy time (not committed); places from Wikidata (committed, 174 countries with heritage, 1,172 sites); videos via YouTube Data API when the `YOUTUBE_API_KEY` secret exists, else a committed seed of 49 verified videos for 16 countries.
- **Service worker**: network first for the shell and JSON, cache first for textures, fonts and flags.

## Decisions

- Rebuilt from scratch rather than patched; mined the previous session's shader draft for the GLSL. Kid mode, text-to-speech, the templated "Sabías que" lines, the family question, the old quiz and tours were removed. Quiz and tours return rebuilt in the "things to do" phase.
- The idle spin stops while a country is selected and the dossier is open; it resumes when the dossier is collapsed. A flight lands the country in the part of the screen the dossier does not cover.
- lit-html renders the UI (escapes by default). No framework beyond that.
- Deploy-time data is not committed, so the repository stays small; if the schedule ever stops, the last deploy keeps working.
- The local git `user.email` for this repo is the GitHub noreply address; pushes with the real address are rejected by GitHub's email-privacy setting.

## Verify

`npm test` (13 tests, green). `npm run build` (green, one 650 kB chunk, mostly Three.js). `npm run dev`, then Mexico and Japan in Earth, Atlas, Data; the flat map; Ahora, Lugares, Ver, Datos. Checked in the desktop app's browser pane on 2026-10-16.

## Known limits

- Hero photos come from Wikipedia's media list with a name filter; a few countries will get an odd first photo. World Heritage photos take precedence where they exist.
- Dishes are "items filed under the national cuisine in Wikidata", not a verdict; the card credits Wikidata.
- Headlines link through Google News redirect URLs; the publisher name is shown from the feed.
- Videos exist for 16 countries until the owner adds the YouTube key; the Actions cursor sweeps the rest over about eight days.
- The flat map has no clouds or relief, and its night mask is coarse (1° cells).
- Phone layout is a bottom sheet that works but has not been polished; desktop first by decision.
- Fifteen territories are only a dot (no shape at 1:50m). Crimea falls inside the Russia shape; Laayoune inside Morocco; the notes say so.

## Owner to-do

1. Create a YouTube Data API key and add it as the `YOUTUBE_API_KEY` repository secret (steps in `docs/PIPELINES.md`).
2. Create a Google Maps Embed API key restricted to `https://vdm285.github.io/*` and set it as `VITE_MAPS_EMBED_KEY` (a repository variable or secret used at build time).
3. Rename the local folder to `giramundo` to match the repository.

## If you continue

1. Phase 4 in `docs/VISION.md`: guess-the-country with distance shading, country of the day, narrated tours using `addArc`, a rebuilt compare.
2. 8k day plate loaded only when close; the uniforms already accept any size.
3. Cities as a second tap level; the id-map approach extends to any polygon set.
4. Do not weaken `tests/geo.test.mjs`. The frame bugs are silent until you screenshot the wrong continent.
