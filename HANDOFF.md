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
- **Settings** (gear in the dock): visual quality (Automatic, Full, Simple, flat map), opening country (country of the day, home, where you are, random, last seen), home country, idle spin, sun offset. Automatic quality drops to Simple before offering the flat map when the frame rate stays under 20.
- **Local radio** (`src/live/radio.js`, block in Ahora): up to 8 HTTPS streams per country from the Radio-Browser snapshot (`public/data/radio.json`, 240 countries); one shared audio element and a mini player (bottom left) that keeps playing while you wander; 15 s watchdog marks a dead stream.
- **Cities** (`src/dossier/city.js`, data from `public/data/cities.json`, 228 countries, 1,353 cities from Natural Earth populated places): city dots appear when close (capitals gold); tap one for a city card with the Wikipedia paragraph and photo, Natural Earth's urban-area estimate, local time, weather, walking-tour videos matched by place, YouTube search links, Street View and maps. Hash `#mx/ciudad/mx-guadalajara`.
- **Cultura** (data `public/data/culture.json` from Wikidata, `npm run culture`): the anthem with a Commons recording for 187 countries and a player, official languages with worldwide native-speaker counts, and up to twelve notable people (citizens ranked by Wikipedia sitelinks, with photo, occupation and years). The card says the ranking measures fame, not merit; sitelinks skew to politicians and athletes.
- **"To understand the news"** block in Ahora: Wikipedia front-page items and yesterday's most-read articles that mention the country, plus background article links (history, politics, economy, geography, demographics) in the reader's language.
- **Radio curation** (`tools/build-radio.mjs`): stations are scored toward local culture (news, talk, public, regional genres, the country's own language) and away from global pop and English-language music outside anglophone countries; votes break ties.
- **Performance**: the pixel ratio starts at 1.5 at most and adapts to the frame rate (0.7 to the cap); idle frames draw at a third rate; Three.js is a separate chunk loaded only for the globe; the country-id and border textures are precomputed PNGs (`npm run maps`, `public/textures/idmap.png` and `borders.png`, rebuild when `countries-50m.json` changes) with in-browser painting as the fallback. Settings shows a live readout (fps, buffer size, pixel ratio, GPU).
- **First paint**: a 90 KB 1k day plate loads first, the 4k plate replaces it, the 8k plate only when close in Full quality.
- **Play** (`src/app/play.js`, `src/app/tours.js`, `src/dossier/play.js`; "Jugar" in the dock): guess-the-country with five rounds, guesses painted by distance (red near, blue far) with km and heading, two pools (big countries, all); tours with a progress bar, prev/pause/next, an arc between stops, and heritage tours that open each site's detail; compare with another country (tap or search) showing an arc and side-by-side facts and indicators.

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

1. Test the live site in Chrome after a hard refresh (Ctrl+Shift+R) and read the Performance line in Settings; check `chrome://gpu` says WebGL is hardware accelerated. Report the line if it still lags.
2. Create a YouTube Data API key and add it as the `YOUTUBE_API_KEY` repository secret (steps in `docs/PIPELINES.md`).
3. Create a Google Maps Embed API key restricted to `https://vdm285.github.io/*` and set it as the `VITE_MAPS_EMBED_KEY` repository variable (already read by the workflow).
4. Rename the local folder to `D:\_GitHub\giramundo` to match the repository (one `Rename-Item` in PowerShell with nothing open in the folder).

## 2026-10-20

- Minimalism pass after Victor's review: search is a lens icon that expands, the cog sits in the top bar, tagline and dock are gone (Sorpréndeme, Jugar and Acerca de removed from the UI; the play code stays in `src/app/play.js` for later, About lives at the end of Settings). Section headings inside the card are gone where the tab already says it (dishes, places, radio, headlines, culture); image labels show on hover. City dots only when close. Radio drops international pop outright. Each headline has a "Contexto" link with a short targeted prompt (`headlinePrompt` in `src/live/ask.js`); the Wikipedia background block was replaced by that link plus Preguntar. All Preguntar prompts are now short and semantic, no app preamble.
- Victor's standing requests: Mexico is the test country for every feature; per-country curation runs later with sub-agents; genuine regional food (a per-country override file is being built); a country-focus view with states and municipalities (geoBoundaries data being built); news thumbnails later; headlines in the local language later; a portfolio artifact with clickable options before committing to big UI decisions.

- Media-first dossier, first pass: the facts grid became a one-line capsule with "Más datos"; the Wikipedia paragraphs sit behind a "Leer" fold (optional, never removed); Comida shows the dishes first with their local-language name and a recipe search in that name; Cultura's languages carry a play button that starts a local station in that language; the anthem plays from the hero through the shared player; a city card offers a station within 60 km when the directory has one; banknotes and coins from Commons appear as a slideshow under the capsule when `public/data/money.json` has them. Keyless walking-tour videos come from YouTube channel RSS feeds at deploy time (`npm run walks`, `public/data/walks/`, gitignored) and merge into Ver.
- **Money** (`tools/build-money.mjs`, `public/data/money.json`, 252 KB): 112 of 162 currency codes have banknote scans, 115 have coins, from Wikimedia Commons with year, series, license and credit per file. Current series ranked first; the card hides pre-1990 and specimen notes behind a toggle and says plainly when Commons lacks the current notes (Mexico: Familia G is copyrighted, so only revolution-era bills exist). Under the slideshow: a 100 USD converter and a 12-month Frankfurter line.
- **Walks** (`tools/build-walks.mjs`): 40 verified YouTube channels via keyless RSS; videos filed under cities and countries; merged into Ver and the city card.
- **Preguntar** (`src/live/ask.js`): a context prompt built from what is on screen (country, section, dishes with local names, sites, people, today's headlines, the compared country, the city) shown in an editable box in the dossier and opened in Google AI Mode (`google.com/search?udm=50&sn=aim&q=...`) in the reader's own browser. Verified live on 2026-10-20: a 2,066-character Spanish prompt opened AI Mode and was answered with cited sources; prompts are capped at 1,800. No key, no API; nothing is sent until the reader clicks. Later: an AI could write the prompt instead of templates, still behind the same button.
- Principle written into `docs/EDITORIAL.md`: content shown to the reader is genuine and local (real recordings, real scans, real streams), never synthetic.
- Chrome diagnosis (done through the Chrome extension): WebGL runs on "Microsoft Basic Render Driver", i.e. software rendering, with a device pixel ratio of 3 in Victor's Chrome window. That, not the app, is why Chrome lags in every mode. Owner fix: enable graphics acceleration in `chrome://settings/system`, relaunch, confirm in `chrome://gpu`; update the NVIDIA driver; set Chrome to High performance in Windows Graphics settings.
- Flat map: static layer cached in an offscreen canvas (`renderStatic` in `src/flat/map.js`); panning is cheap now.
- Wireframe mode and the `wireframe` branch: see `docs/WIREFRAME.md`.

## Evening of 2026-10-16, in short

- Victor's hands-on verdict: the Simple globe is perfectly smooth in Chrome and in the desktop pane; Full and Atlas lag in both. Technical review pending (remind him about `chrome://gpu`). Candidate next steps: default to Simple on first visit, or cut the Full shader's cost (fewer texture reads, skip the 4-tap id blend when far), then re-test.
- Added: wider dossier, full-card mode (expand button in the hero), YouTube search links on every dish, heritage site and person. Victor wants hand-curated, good-quality videos behind every clickable thing eventually; that is a pipeline job (Data API or manual seed with oEmbed checks), not search links.
- Requested for later: compare-and-contrast between two countries inside the same section (the current compare block is facts only).

## If you continue

1. Agreed next step: feature-by-feature review cards with Victor, starting with Ahora (news order, radio curation, weather, background block), then Ver, then Play. Apply answers one feature at a time.
2. Datos: year playback on the globe (slider animating indicators; `setDataColors` already repaints in one call).
3. Historia: a timeline from Wikidata events and Wikipedia history sections, with uneven coverage labeled.
4. Radio curation: tune `localScore` in `tools/build-radio.mjs` with real feedback; consider a "talk only" filter.
5. Phone layout polish is last by decision; the bottom sheet works but is unrefined.
6. Do not weaken `tests/geo.test.mjs`. The frame bugs are silent until you screenshot the wrong continent.
