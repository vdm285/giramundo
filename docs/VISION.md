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

1. **Foundation** (in progress): rename to Giramundo, research, this document, remove the bland parts (kid mode switch, text-to-speech, templated hooks, family question), clean baseline on `main`.
2. **The globe**: a renderer that does not look cheap. Clouds with shadows, terrain relief, atmospheric scattering, dusk band, city lights, ocean glint, a glowing outline for the selected country instead of a flat fill, twinkling stars, smooth flights. Live ambient layers: day/night, recent earthquakes, the ISS. Earth, Atlas and Data views. The flat 2D map (equirectangular, zoomable, same picking, same dossier).
3. **The dossier**: the sections above, the pipelines behind them, and the Actions schedule.
4. **Things to do**: a guess-the-country game with distance shading, a country of the day, narrated tours with flight arcs, a rebuilt compare mode, "surprise me" that lands on something interesting.
5. **Later**: phone layout, kid mode, optional user-supplied AI key for summaries, travel links (flights, stays) with approximate costs, VR, news-outlet bias disclosure and user-chosen outlets.

## Parked ideas (not forgotten)

- Kid mode as a layer: larger type, shorter extracts, gentle news filter, Vikidia links.
- Historical context behind headlines: link today's news to the history section and to past events.
- Live radio (Radio Garden style) via the Radio-Browser open directory.
- Flights overhead (OpenSky snapshot).
- Cities as a second level of tap.

## Decision log

- 2026-10-16: Name changed from Globo Curioso to Giramundo. Repository renamed to `vdm285/giramundo`.
- 2026-10-16: Audience is curious adults; kid mode parked. Desktop web first.
- 2026-10-16: Flat map uses the equirectangular projection so it reuses the globe's plates and hit-testing.
- 2026-10-16: Deploy-time data collection instead of committing feeds, to keep the repository small.
- 2026-10-16: The previous session's unfinished shader rewrite is mined for parts, not wired in as-is.
- 2026-10-15: Engine is Three.js; Natural Earth 1:50m shapes; no news API keys; Wikipedia extracts vendored.
