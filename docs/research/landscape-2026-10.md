# Competitive landscape, October 2026

Researched 2026-10-16 for Giramundo. Web search plus direct fetches of product pages, Hacker News threads, Wikipedia and news coverage. Where a site could not be fetched, it says so.

## 1. Globe and country-explorer products

**Google Earth (web, mobile)**: free. Satellite globe with Wikipedia "Knowledge Cards" and Voyager guided stories. Strength: imagery, 3D cities, Street View. Weaknesses: Voyager was removed from the Android app in the September 2023 redesign and moved to a separate gallery page on desktop ([9to5Google](https://9to5google.com/2023/09/26/google-earth-android-redesign-projects/)); the gallery now lists about 34 stories, none tied to a country ([gallery](https://www.google.com/earth/about/gallery/)). Earth Pro ends June 2027. Country-level narrative is thin and buried.

**CIA World Factbook**: shut down 4 February 2026 with no explanation; the whole site now redirects to a farewell note ([SAN](https://san.com/cc/goodbye-factbook-cia-shuts-down-world-reference-publication-after-six-decades/), [Techdirt](https://www.techdirt.com/?p=532080)). **OpenFactBook** ([openfactbook.org](https://openfactbook.org/world-factbook/)) is a community successor: 261 entities, rankings, comparisons, free JSON API, English only, no map view. This is the single biggest vacuum in the space.

**WikiMiniAtlas** ([meta](https://meta.wikimedia.org/wiki/WikiMiniAtlas)): free Wikimedia plugin; since July 2026 a WebGL globe showing geocoded articles. Only lives inside Wikipedia articles; no country dossier.

**Marble (KDE)**: free desktop virtual globe with a basic Wikipedia layer. Not a web product.

**"Globe Explorer" (explorer.globe.engineer)**: an AI search engine that renders topic trees. Not a competitor.

**Mobile atlas apps** (*Earth 3D – World Atlas*, *Globe 3D – Planet Earth Guide*): freemium; top complaints are paywalled core content, "deceptive subscription", missing search, search UI covering the map, jumpy zoom ([reviews](https://justuseapp.com/en/app/581911397/earth-3d-world-atlas/reviews)).

**Geography games**: Seterra (freemium), GeoGuessr (paid beyond free tier), Worldle/Globle (free dailies; Globle hides borders and color-shades guesses by distance). Quizzes exist in bulk; quizzes attached to a country you were just reading about do not.

**Indie Three.js globes on Hacker News**: many exist but are thin (Mixora, Globe of History, rename.world). None combine facts, Wikipedia, news and video.

## 2. "Tap the globe, experience a place"

**Radio Garden** ([radio.garden](https://radio.garden)): free, ad-supported, Premium removes ads. Loved for the instant "spin and listen" feel. Complaints: UK geoblock since 2022, mislocated stations, Android "loads forever". A clone wave is under way: **GeoRadios** (Show HN, October 2026, React and Three.js, NASA Blue Marble, free, no ads) ([HN](https://news.ycombinator.com/item?id=50054379)).

**WindowSwap**: free curated window videos, no map. **Drive & Listen**: now a parked domain; appears dead. **City Walks** ([citywalks.live](https://citywalks.live)): free, about 99 cities, YouTube walks, day/night and city-sounds toggles, but ad popups and no map. **Virtual Vacation** ([virtualvacation.us](https://virtualvacation.us)): free; click a city on a map to view videos; looks unmaintained since 2021.

**earth.nullschool.net**: free, beautiful live wind globe; critiques: hidden settings, CPU-hungry, controls invert when upside down. **The True Size Of**: free Mercator-comparison tool. **Flightradar24**: free tier with heavy complaints about unskippable ads. **Our World in Data**: free; choropleths with 3D/2D toggle, year playback, a country selector that persists across charts ([OWID](https://ourworldindata.org/new-features-better-maps)).

## 3. News per country on a map

Nothing current fills this. Newsmap is defunct (the domain is now a casino blog). Unfiltered News (Google Jigsaw): DNS fails. Mondo News: open-source Dash globe, G20 only, archived September 2025. Liveuamap: incident markers for conflicts, not country summaries. Ground News: the map is a filter; the product is bias comparison, paid tiers. w0rld2day (Show HN 2024): domain gone. GDELT's own maps are analyst tools.

## Gaps nobody fills

- A free, bilingual (ES/EN) country reference since the Factbook died. OpenFactBook is English-only, map-less, and has no narrative. Spanish-language coverage in this category is essentially nil.
- "Why is this in the news?": headlines plus historical context per country. Every news-map effort found is dead, G20-only, or analyst-grade.
- One place that stitches facts, Wikipedia, video, Street View and indicators; today users hop between five sites.
- A no-backend, no-login, no-ads trust story. GeoRadios' reception shows "free, no ads, no tracking" is itself a feature people notice.
- Static GitHub Pages durability versus Heroku, Jigsaw and Google products that quietly vanish.

## Steal these ideas

- Radio Garden: zero-UI start, globe already spinning, first tap produces something within a second.
- Our World in Data: country selector that persists while you move between layers; 3D/2D toggle; year playback for indicators.
- Globle: color-shading distance feedback for a guessing quiz on your own globe.
- City Walks: day/night and ambient-sound toggles on video; label the video source in the corner.
- GeoRadios: NASA Blue Marble texture, daily-refreshed static JSON instead of a live API.
- Google Earth Knowledge Cards: short Wikipedia excerpt with image carousel, link out.

## Avoid

- Paywalling core content or "deceptive subscriptions".
- Ad popups and unskippable video ads.
- Hidden settings and inverted controls; search panels that cover the map.
- Depending on a third-party host or API that can disappear.
