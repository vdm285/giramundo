# Giramundo — vision and roadmap

Updated 2026-10-16. This is the north star. `HANDOFF.md` says what the code does today; this file says where it is going and why. If they disagree, the code is behind.

## The one-sentence pitch

A cinematic globe where every country is a living dossier: spin the Earth, tap a country, and in one place see it, know it, and feel what is happening there right now.

## Why this instead of a search box

Google and an AI chat answer a question you already know how to ask. Giramundo is for the moment before the question: you are curious about the world, you want to wander, and you want the wandering to be visual and alive. It stitches together what today lives on five sites (an atlas, Wikipedia, a news site, YouTube walking tours, Street View, a statistics portal) into one spin-and-tap surface, with every claim traceable to its source.

The CIA World Factbook closed in February 2026. Nothing free, bilingual, and map-first replaced it. See `docs/research/landscape-2026-10.md`.

## Who it is for

Curious adults first, in Mexican Spanish and in English. Kids are welcome and a kid mode is a parked idea, but the product is not a classroom tool and is not watered down. It should be something you open to explore and something you show a friend.

## Principles

1. **Free to run, free to use, forever.** Static site on GitHub Pages. No server, no account, no ads, no tracking, no paid API. Nothing stops working if an AI subscription lapses.
2. **Traceable.** Every number and paragraph names its source and links out. We never invent a fact, a dish, a capital, or a headline. If the source is missing, the card says so.
3. **Objective on disputes, never silent.** Borders follow Natural Earth's de facto shapes. Disputed places get a note that names the parties and does not pick a winner. We do not hide what is going on.
4. **First tap pays off within a second.** Zero-UI start: the globe is already spinning, and tapping anything produces something immediately. Nothing important hides behind a settings menu.
5. **Rich by default, simple on demand.** The full experience is a detailed 3D globe. A flat 2D map with the same features is one toggle away, and is offered automatically when WebGL is missing or slow.
6. **Written for the next person.** Humans and AI agents will pick this up from the public repo. Docs explain decisions, not just mechanics.

## What a country dossier contains

Sections, in order. Each is independent and degrades gracefully when its source is empty.

| Section | Spanish | What it shows | Source and mode |
|---|---|---|---|
| Now | Ahora | Headlines about the country (ES and EN), weather in the capital, local time, today's holiday if any, exchange rate against the peso and the dollar, nearby earthquakes if any | Wikipedia in-the-news (live); RSS headlines collected at deploy time; Open-Meteo, Nager.Date, Frankfurter, USGS (live) |
| Story | Historia | Wikipedia introduction, history article, timeline hooks | Vendored Wikipedia extracts (CC BY-SA), with live fallback |
| Food | Comida | National cuisine article, signature dishes | Vendored Wikipedia; Wikidata for dishes |
| Culture | Cultura | Culture article, languages, anthem, notable people | Vendored Wikipedia; Wikidata |
| Places | Lugares | UNESCO World Heritage sites with photos, pins on the globe | Wikidata (precomputed), Wikimedia Commons images (live) |
| See | Ver | Walking-tour and travel videos, Street View of the capital, map embed | YouTube embeds (IDs curated at deploy time), Google Maps Embed API |
| Data | Datos | Population since 1960, life expectancy, GDP per person, forest, internet, urban share and more, with year playback and comparison | World Bank (precomputed) |

The dossier also keeps: flag, capital, population with year, area, languages, currency, calling code, neighbors, dispute note, and a share link.

## The two data modes

Detailed in `docs/research/data-sources-2026-10.md`.

- **Mode A, live from the browser**: sources with CORS and no secret. Wikipedia, Wikimedia Commons, Open-Meteo, USGS, Frankfurter, Nager.Date, the ISS position.
- **Mode B, collected at deploy time**: a scheduled GitHub Actions run fetches sources that lack CORS or need a secret (RSS headlines, YouTube search), writes JSON into the build, and deploys. The JSON is not committed, so the repository does not grow. If the schedule ever stops, the last deploy keeps working.

Keys the owner creates once, at no cost: a YouTube Data API key (Actions secret, never shipped) and a Google Maps Embed API key (shipped, restricted to this site's URL).

## Roadmap

Phases are built in order. Each ends with a deploy and a check-in.

Status on 2026-10-16: phases 1 to 4 shipped in their first versions (see `HANDOFF.md`); what remains in each is listed there. Next: feature-by-feature review with the owner, year playback in Datos, a Historia timeline.

1. **Foundation** (done): rename to Giramundo, research, this document, remove the bland parts (kid mode switch, text-to-speech, templated hooks, family question), clean baseline on `main`.
2. **The globe** (done): a renderer that does not look cheap. Clouds with shadows, terrain relief, atmospheric scattering, dusk band, city lights, ocean glint, a glowing outline for the selected country instead of a flat fill, twinkling stars, smooth flights. Live ambient layers: day/night, recent earthquakes, the ISS. Earth, Atlas and Data views. The flat 2D map (equirectangular, zoomable, same picking, same dossier).
3. **The dossier**: the sections above, the pipelines behind them, and the Actions schedule.
4. **Things to do**: a guess-the-country game with distance shading, a country of the day, narrated tours with flight arcs, a rebuilt compare mode, "surprise me" that lands on something interesting.
5. **Later**: phone layout, kid mode, optional user-supplied AI key for summaries, travel links (flights, stays) with approximate costs, VR, news-outlet bias disclosure and user-chosen outlets.

## Parked ideas (not forgotten)

- Kid mode as a layer: larger type, shorter extracts, gentle news filter, Vikidia links.
- Historical context behind headlines: link today's news to the history section and to past events. First step (now): Wikipedia "in the news" and "most read" items that mention the country, plus background articles. Done 2026-10-20 as a zero-cost bridge: the Preguntar button assembles a prompt from the screen and opens Google AI Mode in the reader's browser. Later: an optional AI layer where the reader pastes their own key (Claude, OpenAI, or a local model), stored only in their browser, that summarizes with context and answers follow-up questions about the country, comparisons included. Nothing runs by default.
- Live radio: AI subtitles or live translation of what is playing, as an optional layer, much later.
- Flights overhead (OpenSky snapshot).
- Cities as a second level of tap.
- Travel: flights and stays with approximate costs for a country the reader falls for.
- Video "cinema mode": when a walking tour plays, widen the player and put place context around it instead of a small frame. Parked until the dossier layout settles.
- Food: recipe links per dish (video recipes, ingredient notes), and, with the reader's permission for location, restaurants nearby that serve that cuisine. The restaurant idea needs a source that is free and honest; parked.
- Radio: AI subtitles or live translation; a "talk only" filter if the reader wants speech, not music.
- Performance: a true lightweight mode that still shows the features (flat map, no clouds or relief, smaller plates, deferred data). The first paint should not wait for places, radio or indicators.
- Phone layout polish; VR.
- Time: a slider to travel back in time per country (borders, names, money, population), paired one day with the scale slider from the long-horizon note: a crosshair of space (micro to macro) and time (past to now). No forward slider for human affairs; only curated astronomical events (eclipses, transits) would extend into the future. Money is the first candidate: current notes by default, historical notes behind the time control.
- **The long horizon, in a footnote.** Giramundo is the Earth level of a larger family Victor imagines: zoom out to the solar system, the Milky Way and galaxy clusters (NASA imagery, astronomy); zoom in from Earth to a city, to a person, to organs, tissues, cells, molecules, atoms, particles. Each level would be its own repository with its own focus, linked to its neighbors by a deliberate "step up / step down" control, never by an accidental scroll. Modular by design, so one level can be world-class without waiting for the others. Giramundo should stay the best Earth level it can be; the only thing it owes that future is clean interfaces and good docs.

## Modes and settings

Rich by default, simple on demand, and never forced. Settings live in one quiet menu (the gear in the dock), documented in the README:

- **Visual quality**: Auto (measures the frame rate), Full (clouds, relief, 8k plate when close, more stars), Simple (no clouds, 4k plate, fewer stars), Flat map.
- **Opening country** when there is no link: Country of the day (default), Home (Mexico, or a country you pick), My location (asks for permission), Random, Last visited.
- Language, idle spin, sun time offset.

## Decision log

- 2026-10-16: Name changed from Globo Curioso to Giramundo. Repository renamed to `vdm285/giramundo`.
- 2026-10-16: Audience is curious adults; kid mode parked. Desktop web first.
- 2026-10-16: Flat map uses the equirectangular projection so it reuses the globe's plates and hit-testing.
- 2026-10-16: Deploy-time data collection instead of committing feeds, to keep the repository small.
- 2026-10-16: The previous session's unfinished shader rewrite is mined for parts, not wired in as-is.
- 2026-10-16: Rebuilt from scratch: new globe, flat map, seven-section dossier, deploy-time pipelines. Kid mode, text-to-speech, templated hooks and the old quiz and tours removed.
- 2026-10-16: Next phases in order of appetite: local radio, games and tours, deeper dossier. Mobile last. 8k plate approved (Solar System Scope, CC BY 4.0) behind a quality setting. News context: Wikipedia links now, reader-keyed AI parked. Opening country is a reader setting, default country of the day.
- 2026-10-15: Engine is Three.js; Natural Earth 1:50m shapes; no news API keys; Wikipedia extracts vendored.
