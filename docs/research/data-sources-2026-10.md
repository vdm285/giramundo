# Data-source feasibility, checked 2026-10-16

Giramundo is static (GitHub Pages), must cost nothing to run, and must keep working without any AI subscription. Two ways a source can be used:

- **Mode A**: the browser calls it live. Needs CORS and no secret key.
- **Mode B**: a scheduled GitHub Actions workflow in the public repo fetches it and commits small JSON files, so the site stays static.

"CORS yes" below means a probe from `Origin: https://vdm285.github.io` returned `Access-Control-Allow-Origin: *`.

## Platform limits (confirmed)

| Item | Finding | Source |
|---|---|---|
| Actions on public repos | Free on standard GitHub-hosted runners | [About billing for Actions](https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions) |
| Cron | Minimum interval 5 minutes; runs only on the default branch; may be delayed at the top of the hour; **auto-disabled after 60 days without repo activity** | [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) |
| Repo and file size | >50 MiB warns, >100 MiB blocked; repo ideally under 1 GB | [About large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) |
| Pages | Site ≤1 GB, 100 GB/month bandwidth (soft) | [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |

## News and "now"

| Source | Provides | Cost / key | CORS | Limits | License / attribution | Mode | Caveat |
|---|---|---|---|---|---|---|---|
| GDELT DOC 2.0 | Keyword article lists, timelines, 65 languages | Free, no key | Docs say yes | Not published; probe got HTTP 429 then a timeout | Link to publishers | B, best effort | Flaky |
| Wikipedia REST feed (`feed/onthisday`, `feed/featured`) | On this day, in the news, most read, picture of the day | Free, no key | **Yes** | 200 req/s global; send `Api-User-Agent` | CC BY-SA, keep links | **A** | `es` has `on_this_day`, `in_the_news`, `most_read`; no featured article in es ([availability](https://es.wikipedia.org/api/rest_v1/feed/availability)) |
| Wikipedia Portal:Current events, Wikinews Action API | Daily curated bullets | Free, no key | Yes with `origin=*` | WMF policy | CC BY-SA | A or B | Portal is English-only wikitext; es.wikinews is thin |
| Google News RSS (`news.google.com/rss?hl=es-419&gl=MX&ceid=MX:es-419`) | Per-country, topic, search headlines | Free, no key | **No** | Unofficial; URL schemes change silently | Legacy terms: non-commercial, credit Google News and each publisher | **B** | Unsupported product |
| NewsAPI.org free | 100 req/day, 24 h delay | Free key | localhost only | Production forbidden | | Neither | [Pricing](https://newsapi.org/pricing) |
| GNews free | 100 req/day, 10 articles, 12 h delay | Free key | localhost only | Non-commercial only | | B, barely | [Pricing](https://gnews.io/pricing) |
| Currents, NewsData.io | 200–250 req/day | Free key | Not stated | Republication limits | Link-out | B, weak | |
| Mediastack free | 100 req/month | Free key | | Too small | | Neither | |
| Reuters, AP RSS | Reuters public feeds dead since 2020; AP feeds stopped 2024 | | | | | Neither | |
| BBC RSS (`feeds.bbci.co.uk/mundo/rss.xml`, `/news/world/rss.xml`) | World and BBC Mundo (Spanish) | Free | No | | Attribute "BBC News", no logos | B | Headline and link only |
| El País (`feeds.elpais.com/mrss-s/...`) | Section feeds | Free | **Yes** | | No published RSS terms found | A or B | Spanish-language win |
| El Universal (`eluniversal.com.mx/arc/outboundfeeds/rss/`) | Front-page feed | Free | Not probed | | No terms found | B | |

## Media

| Source | Provides | Cost / key | CORS | Limits | License / attribution | Mode | Caveat |
|---|---|---|---|---|---|---|---|
| YouTube iframe embed | Player | Free, no key | n/a | | Do not obscure YouTube branding | **A** | `youtube-nocookie.com` for a privacy mode |
| YouTube oEmbed | Title, thumbnail, embed HTML | Free, no key | **Yes** | Unpublished | | A | Fails for embed-disabled videos |
| YouTube Data API v3 | Search and metadata | Free; key; 10,000 units/day, `search.list` costs 100 ([Getting started](https://developers.google.com/youtube/v3/getting-started)) | Yes | 100 searches/day | [Developer Policies](https://developers.google.com/youtube/terms/developer-policies): stored metadata ≤30 days then refresh | **B** | Ship only video IDs; re-fetch titles via oEmbed at view time |
| Wikimedia Commons API (`list=geosearch&gsnamespace=6&origin=*`) | Geotagged photos | Free, no key | **Yes** | WMF policy | Per-file CC licenses; show author and license | **A** | Must read each file's license |
| Wikipedia REST `page/media-list/{title}` | Images on an article | Free, no key | **Yes** | 200 req/s | CC BY-SA or per file | A | Titles differ per language |
| Unsplash | Photos | Free key; demo 50 req/h | Yes | Approval needed | Keys "must remain confidential" ([Guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)) | B only | Not safe client-side |
| Pexels | Photos | Free key; 200/h | Not stated | | Credit photographer and Pexels | B | |

## Maps and place

| Source | Provides | Cost / key | Limits | Terms | Mode | Caveat |
|---|---|---|---|---|---|---|
| Google Maps Embed API (incl. `streetview` mode) | iframe map or Street View | **Free, unlimited**, key required ([Usage and billing](https://developers.google.com/maps/documentation/embed/usage-and-billing)); a billing account must be attached | None | Google Maps terms | **A** | Restrict key to Embed API and website referrers |
| Maps JavaScript API | Dynamic map | 10,000 loads/month free since March 2025 ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing)) | Then billed | | A, risky | Overage is real money |
| Street View Static / Dynamic | Image or JS panorama | 10,000 / 5,000 free per month | | | A, risky | Prefer Embed `streetview` |
| Mapillary | Street-level CC BY-SA photos | Free client token; 60k/min ([API docs](https://www.mapillary.com/developer/api-documentation)) | Generous | CC BY-SA; credit user and Mapillary | A | |
| OSM raster tiles | Basemap | Free, no key | Viewport only, attribution ([policy](https://operations.osmfoundation.org/policies/tiles/)) | ODbL | A, light | Not needed: Giramundo paints its own globe |
| Nominatim | Geocoding | Free, no key | 1 req/s; no client-side autocomplete ([policy](https://operations.osmfoundation.org/policies/nominatim/)) | ODbL | B only | |
| Photon (komoot) | Typeahead geocoding | Free, no key | "Be fair" | OSM attribution | A, light | Could vanish |

## Live and ambient data

| Source | Key | CORS | Limits | License | Mode |
|---|---|---|---|---|---|
| [Open-Meteo](https://open-meteo.com/en/terms) | None (non-commercial) | **Yes** | <10k/day; CC BY 4.0; void if the site carries ads or subscriptions | CC BY 4.0 | **A** |
| [USGS earthquake GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | None | **Yes** | Updated every minute | Public domain, credit USGS | **A** |
| [wheretheiss.at](https://wheretheiss.at/w/developer) | None | **Yes** | ~1 req/s | No terms published | A |
| [OpenSky](https://openskynetwork.github.io/opensky-api/rest.html) | Anonymous 400 credits/day | **No** | 10 s resolution | Non-commercial; cite paper | **B** (snapshot) |
| [Frankfurter](https://frankfurter.dev/) | None | **Yes** | No quotas; daily rates | Open source | **A** |
| [Nager.Date](https://nagerholidays.com/Api) | None | **Yes** | No rate limits | Open source | A |
| [Wikidata SPARQL](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual) | None | **Yes** | 60 s per query; 429 with Retry-After | CC0 | **B** (precompute UNESCO sites, dishes, anthems, people) |
| [World Bank v2](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation) | None | **Yes** | Unstated | CC BY 4.0 | B (already) |
| REST Countries | v3.1 deprecated; v5 needs key, 500 req/month ([versions](https://restcountries.com/docs/countries/api-versions)) | | | | B once |

## Recommended stack

| Area | Pick | Mode | Owner key? |
|---|---|---|---|
| News | Wikipedia `feed/featured` live (es/en in-the-news, most-read); Google News RSS per country plus BBC Mundo and El País via an hourly Action into `public/data/news/{iso}.json` (headline, link, source only). Skip NewsAPI and Mediastack. GDELT only as optional enrichment. | A + B | No |
| Media | YouTube iframe and oEmbed live; curated video IDs via the Data API in a weekly Action; Commons geosearch and media-list live for photos. Skip Unsplash and Pexels. | A + B | Yes, once: YouTube Data API key as an Actions secret, never shipped |
| Maps | Google Maps Embed API `place` and `streetview` iframes with a website-restricted key; Mapillary as keyed CC BY-SA fallback. No Maps JS API, no OSM tiles. | A | Yes, once: Maps Embed key (billing account at $0) and Mapillary client token |
| Ambient | Open-Meteo, USGS, wheretheiss.at, Frankfurter, Nager.Date live; OpenSky snapshot and Wikidata facts via Actions; World Bank stays in `npm run data`. | A + B | No |

Operational notes: add a `workflow_dispatch` and a keep-alive so the cron is not disabled after 60 idle days. Open-Meteo's free tier is void if the site ever carries ads or subscriptions.
