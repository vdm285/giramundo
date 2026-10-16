# PIPELINES.md — deploy-time data

Giramundo is static. Some sources have no CORS or should not be hit from every visitor's browser, so a scheduled GitHub Actions run fetches them, writes small JSON files into `public/data/`, and `vite build` ships them with the site. These files are **not committed** (see `.gitignore`); the repository does not grow, and if the schedule ever stops, the last deploy keeps working. The background is in `docs/VISION.md` ("The two data modes") and `docs/research/data-sources-2026-10.md`.

Every pipeline follows the same rules: polite fetching through `tools/net.mjs` (shared User-Agent, retries on 429/5xx, bounded concurrency), one failing source never aborts the run, and the output names its source so the card can credit it.

## News

### What runs

`npm run news` → `node tools/build-news.mjs`.

For every country in `public/data/facts.json` with an `iso2`, it searches Google News RSS twice:

- Spanish, Mexican edition: `https://news.google.com/rss/search?q=<query>&hl=es-419&gl=MX&ceid=MX:es-419`
- English, US edition: `https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en`

The query is the country's name in that language, quoted (`"Japón"`, `"Japan"`). Names that are also something else (Georgia, Jordan, Chad, Jersey, Chile, Mauricio, Reunión, Guadalupe...) use a hand-written query from the `QUERY_OVERRIDES` map at the top of the script, which adds a disambiguating term (`"Georgia" (Tbilisi OR Georgian OR Caucasus)`), excludes a namesake (`-"New Jersey"`), or uses the name newsrooms actually write (`"Arabia Saudita" OR "Arabia Saudí"`). When a country's headlines look wrong, that map is where to fix it.

The top 8 items per language are kept. Once per run it also fetches three world feeds and keeps 12 items each:

| id | name | lang | feed |
|---|---|---|---|
| `bbc-mundo` | BBC Mundo | es | `https://feeds.bbci.co.uk/mundo/rss.xml` |
| `bbc-world` | BBC News | en | `https://feeds.bbci.co.uk/news/world/rss.xml` |
| `elpais-internacional` | El País Internacional | es | `https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada` |

The RSS is parsed with a small regex parser (no dependency): `title`, `link` (or `guid`), `pubDate`, `source`. CDATA is unwrapped and HTML entities are decoded. Google prefixes nothing but suffixes every title with ` - Publisher`; that suffix is removed when the `<source>` element names the same publisher, so the headline reads as the publisher wrote it. The `?oc=5` tail on Google links and BBC's `at_medium`/`at_campaign` tracking parameters are dropped.

Politeness: at most 3 requests in flight, request starts spaced 250 ms apart, 20 s per request, 3 attempts via `fetchRetry`, and a total budget of 12 minutes (`NEWS_BUDGET_MS` to change). About 500 requests are made per run, so a normal run takes 2 to 4 minutes. If a country's fetch fails, its file is still written with empty lists and an `error` string, and the run continues. The script never throws out of the whole run because of one feed.

### When

`.github/workflows/pages.yml` runs `npm run news` every 6 hours (`0 */6 * * *`), on every push to `main`, and on `workflow_dispatch`, after `npm test` and before `npm run build`. The step has `continue-on-error: true`: a Google News outage produces a deploy with fewer or no headlines, never a failed deploy. GitHub disables cron on repositories with no activity for 60 days; a `workflow_dispatch` run or any commit re-arms it.

### Output

All files live in `public/data/news/` and are kept under 10 KB each (minified JSON, titles only, no descriptions). The size cap wins over the item counts: Google News links are redirect URLs of 220 to 450 bytes, so a country file holds about 5 to 7 headlines per language after trimming (items are dropped from the tail of the longer list until the file fits; a typical run gives a median of 12 headlines per country out of the 16 fetched), and `world.json` holds 8 per feed rather than 12. If more headlines matter more than the cap, raise `MAX_BYTES` in the script or split the world feeds into one file each.

`public/data/news/{iso2 lowercase}.json`, one per country:

```json
{
  "iso2": "JP",
  "built": "2026-10-16T17:02:11Z",
  "es": [ { "title": "…", "url": "https://news.google.com/rss/articles/…", "source": "El Universal", "published": "2026-10-16T13:44:00Z" } ],
  "en": [ { "title": "…", "url": "…", "source": "Reuters", "published": "…" } ],
  "error": "es: 503 Service Unavailable …"
}
```

`error` is present only when a fetch failed; `published` is `null` when the feed gave no parseable date; `source` is `null` when the feed has no `<source>`. Google links are Google News redirects that resolve to the publisher's article; we do not pre-resolve them (that would need one more request per headline and Google's redirect format changes).

`public/data/news/world.json`:

```json
{
  "built": "…",
  "feeds": [
    { "id": "bbc-mundo", "name": "BBC Mundo", "lang": "es", "url": "https://www.bbc.com/mundo",
      "items": [ { "title": "…", "url": "https://www.bbc.com/mundo/articles/…", "source": "BBC Mundo", "published": "…" } ] }
  ]
}
```

`public/data/news/index.json`, for the UI to know what exists without probing 250 files:

```json
{
  "built": "…",
  "countries": { "JP": { "es": 8, "en": 8 }, "XX": { "es": 0, "en": 0, "error": "…" } },
  "attribution": "Headlines link to their publishers. Country searches via Google News RSS."
}
```

### Attribution rules

- Headline and link only. No article text, no descriptions, no images. We do not host or summarize anyone's reporting.
- Every headline shows its publisher (`source`) and links out to the article. Country headlines also credit Google News, whose RSS terms allow personal, non-commercial use of the feed with credit to Google News and to each publisher. Giramundo carries no ads, no subscriptions and no tracking, which keeps it on the right side of that line and of Open-Meteo's similar rule.
- BBC feeds: attribute "BBC News" / "BBC Mundo" in text, no BBC logos. El País: attribute "El País" and link to the article.
- Headlines are shown as the publisher wrote them. We never rewrite, translate or editorialize a headline; a headline the card cannot show is dropped, not changed.
- The card must say when headlines are stale: show `built` and fall back gracefully when a country has none (`es: []`, `en: []`), which is normal for small territories.

### Run locally

```sh
npm run news                       # writes public/data/news/, 2 to 4 minutes
NEWS_BUDGET_MS=120000 npm run news # shorter budget; late countries get an error entry
npm run dev                        # the dev server serves public/ as-is
```

Check `public/data/news/index.json` for the counts and any `error` entries, and open a few files (`mx.json`, `jp.json`, `ge.json`) to confirm the headlines are about the right place. The folder is gitignored; do not commit it.

## Places

### What runs

`npm run places` → `node tools/build-places.mjs`. Source: the Wikidata Query Service (SPARQL), through the cached `sparql` helper in `tools/net.mjs` (responses land in `data/cache/wikidata/`, keyed by query text, so a re-run after a code change that does not touch a query is free).

Countries join to `public/data/facts.json` through P297 (ISO 3166-1 alpha-2). Dissolved states are skipped; where two live items share a code (Antarctica, Cyprus) the one with more sitelinks wins. All 250 countries match today. A country with nothing filed under it gets an empty entry; nothing is invented.

Per country it collects:

- **UNESCO World Heritage sites**: items with a UNESCO id (P757, without a `-`, which excludes the component parts of serial sites) and a live heritage-designation statement (P1435 = Q9259, not deprecated, no end date, so delisted sites drop out) whose country (P17) is this one. Transboundary sites appear under every country they lie in and carry `shared: n`; they sort after the local sites because they have one coordinate. Label es/en, description es/en, coordinates (P625), one Commons image (P18), the inscription year (the designation's start time, P580) and the es/en Wikipedia article URLs. Capped at 25 per country: sites with a photo and coordinates first, then the ones more Wikipedias write about (sitelinks). Capped today: BR CN DE ES FR GB IN IR IT JP MX RU US.
- **National cuisine**: the item that is an instance of "national cuisine" (Q1968435) with P17 = the country, with its es/en Wikipedia URLs.
- **Dishes**: Wikidata has no "national dish" property and the "national dish" class (Q1391582) is applied to seven items worldwide, so the list is the items filed under the national cuisine (P2012) that have a photo, ranked by sitelinks, 8 per country. A dish whose recorded country of origin (P495) is elsewhere is dropped; one whose origin is this country ranks above one with no origin recorded; restaurants, chains, brands, people and books filed under a cuisine are excluded by type. Items tagged as national dishes carry `national: true` and sort first. This is "what Wikidata files under Mexican cuisine", not a verdict: the card should say so (`notes` in the file).
- **Anthem** (P85): the statement that is a national anthem (Q23691) and preferred when several exist (Mexico also lists its flag salute), skipping ended statements.
- **Demonym** (P1549): Spanish masculine singular when marked (P5185 = Q499327), English singular when marked (P11054 = Q110786); plural-marked forms are skipped when anything else exists; unmarked Spanish pairs break the tie away from `-a`.

Labels fall back es ← mul ← en and en ← mul ← es. Wikidata stores a name that is the same in every language ("Marcha Real", "Kimigayo") under the `mul` language only; without that fallback Spain has no anthem.

WDQS specifics: the join order of the two heavy queries is pinned with `hint:Query hint:optimizer "None"` (left to itself Blazegraph starts from "every item with a photo" and hits the 60 s limit); queries are batched 25 countries at a time; a 1.5 s gap is left between live queries because WDQS answers bursts from one client with 429 and a Retry-After, which `fetchRetry` honors. A full run from an empty cache is about 25 queries and under 3 minutes.

### When

On demand. The output is **committed** (`public/data/places.json`, about 600 KB), because World Heritage lists change once a year and the file is useful offline. Re-run after the July UNESCO session, or when a card shows a wrong label, and commit the result.

### Output

`public/data/places.json`:

```json
{
  "built": "2026-10-16",
  "source": "Wikidata (CC0), Wikimedia Commons",
  "attribution": { "data": "…", "images": "…", "text": "…" },
  "notes": "how each list was built, one line",
  "countries": {
    "MX": {
      "qid": "Q96",
      "demonym": { "es": "mexicano", "en": "Mexican" },
      "anthem": { "qid": "Q200742", "es": "Himno Nacional Mexicano", "en": "National Anthem of Mexico" },
      "cuisine": { "qid": "Q207965", "label": { "es": "gastronomía de México", "en": "Mexican cuisine" },
                   "wiki": { "es": "https://es.wikipedia.org/wiki/…", "en": "https://en.wikipedia.org/wiki/Mexican_cuisine" } },
      "dishes": [ { "qid": "Q191655", "label": { "es": "taco", "en": "taco" }, "image": "001 Tacos de carnitas, carne asada y al pastor.jpg" } ],
      "heritage": [
        { "qid": "Q5859", "whs": "483",
          "label": { "es": "Chichén Itzá", "en": "Chichen Itza" },
          "desc": { "es": "sitio arqueológico de la península de Yucatán…", "en": "pre-Columbian Maya city in Mexico" },
          "ll": [20.6831, -88.5686],
          "image": "Chichen Itza 3.jpg",
          "year": 1989,
          "wiki": { "es": "https://es.wikipedia.org/wiki/Chich%C3%A9n_Itz%C3%A1", "en": "https://en.wikipedia.org/wiki/Chichen_Itza" } }
      ]
    }
  }
}
```

`demonym`, `anthem`, `cuisine`, `desc` are `null` when Wikidata has nothing; `ll`, `image`, `year` are `null` per site when missing; `wiki` has only the languages that have an article (sometimes `{}`); `shared: n` appears only on transboundary sites; `national: true` only on dishes tagged as such; `whs` is the UNESCO id as Wikidata stores it (`"1061bis"`, `"1321rev"` are official suffixes).

`image` is a Wikimedia Commons **file name**, not a URL. The site builds thumbnails itself: `https://commons.wikimedia.org/wiki/Special:FilePath/<encodeURIComponent(image)>?width=640`, and links the file page `https://commons.wikimedia.org/wiki/File:<image>` for the credit.

Counts on 2026-10-16: 174 countries with at least one site, 1,172 site entries (1,134 with image, 1,157 with coordinates, 111 transboundary repeats); 194 countries with a cuisine item, 112 with dishes (519 dishes); 237 anthems (missing: PT, whose Wikidata item has no P85, EH, and small territories); 235 demonyms.

### Attribution rules

- Wikidata is CC0: no credit is legally required, but the card should say "Datos: Wikidata" and link the item (`https://www.wikidata.org/wiki/<qid>`) so a wrong fact can be fixed at the source.
- Commons images are **not** CC0. Each file has its own license (CC BY, CC BY-SA, public domain…). When the card shows an image it must link to the file page, and ideally show the author and license fetched live from `https://commons.wikimedia.org/w/api.php?action=query&titles=File:<image>&prop=imageinfo&iiprop=extmetadata&format=json&origin=*` (fields `Artist`, `LicenseShortName`, `LicenseUrl`). Never crop out a watermark or present the photo as ours.
- `desc` and `wiki` are Wikipedia: CC BY-SA 4.0; keep the link.
- Dishes are a Wikidata filing, not an editorial ranking. The card says where the list comes from and does not call anything "the national dish" unless `national: true`.

### Run locally

```sh
npm run places                 # about 25 SPARQL queries, under 3 minutes from an empty cache
rm -r data/cache/wikidata      # to force fresh data (the cache is keyed by query text)
```

Check the console summary (countries with heritage, sites, images), then open `public/data/places.json` and look at `MX` and `JP`. Commit the file.

## Videos

### What runs

`npm run videos` → `node tools/build-videos.mjs`. Writes `public/data/videos/{iso2 lowercase}.json`, one per country, **not committed** (`.gitignore`).

Two modes, chosen by the `YOUTUBE_API_KEY` environment variable:

**With a key** (deploy): YouTube Data API v3 `search.list` with `type=video`, `videoEmbeddable=true`, `videoDuration=long` (over 20 minutes), `safeSearch=moderate`, `relevanceLanguage=en`, up to three queries per country, 4 results kept per query:

| kind | query |
|---|---|
| `walk` | `<capital en> walking tour 4K` |
| `food` | `<country en> street food` |
| `drone` | `<country en> drone 4K` |

Quota: `search.list` costs 100 units and the free quota is 10,000 units per day, so one run makes at most **95 searches** (`MAX_SEARCHES`, 9,500 units) and stops. It remembers where it stopped in `data/cache/youtube/cursor.json` (`{ "next": <index into facts.json>, "started", "updated" }`); the next run resumes there, so a daily schedule sweeps all 250 countries in about 8 days and then starts over, which keeps every stored title under YouTube's 30-day limit. A country whose turn has not come keeps its previous file. A 403 (quota exceeded) stops the run with the cursor still on the current country. Note that `data/cache/` is gitignored, so on GitHub Actions the cursor only survives between runs if the workflow caches that folder (`actions/cache` with `path: data/cache` and a fixed key); without it every run restarts at the first country, which still refreshes the same ~30 countries daily and is harmless.

**Without a key** (local dev): copies `public/data/videos-seed.json` into the per-country files for the 16 seeded countries and prints a notice. The seed was hand-curated on 2026-10-16: 49 videos for MX JP US ES FR IT BR AR DE GB KR TH EG MA IN TR, two 4K walking tours of the capital or most famous city plus a street-food or drone film each, every ID verified through the YouTube oEmbed endpoint (`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json`, no key, fails for embed-disabled videos). To add a seed entry, verify the ID the same way and record the channel name as oEmbed returns it (`author_name`). The seed is committed.

### Output

`public/data/videos/{iso2}.json`:

```json
{
  "iso2": "MX",
  "built": "2026-10-16",
  "items": [
    { "id": "fVh9YNTzhak", "kind": "walk", "query": "Mexico City walking tour 4K",
      "channel": "HP Walking Tours", "title": "Mexico City 4K Walking Tour - 190 min Tour …",
      "place": "Mexico City" }
  ]
}
```

`kind` is `walk`, `food` or `drone`. `place` is present only on seeded items (the city the video is about). `public/data/videos-seed.json` has the same item shape under `countries: { "MX": [ … ] }`.

### Attribution and policy rules

- We store only IDs and a snapshot of title and channel. **Stored metadata must be refreshed within 30 days** (YouTube API Services Developer Policies, III.E.4). The daily sweep handles the files; the site must still re-fetch the title, channel and thumbnail through oEmbed when it shows a video, and use the stored title only as a fallback while that request is in flight.
- Play through the official iframe embed (`https://www.youtube-nocookie.com/embed/<id>` for the privacy-enhanced mode). Do not hide, cover or alter YouTube's branding or controls, do not autoplay with sound, and do not overlay anything on the player.
- Show the channel name next to the video and link to the video on YouTube. We do not download, re-encode or host any video.
- The API key never ships: it is read from the environment at build time only. Nothing in `src/` reads it.

### Run locally

```sh
npm run videos                                # no key: seed → public/data/videos/{mx,jp,…}.json
YOUTUBE_API_KEY=AIza... npm run videos        # real search, 95 searches, then resumes next time
rm data/cache/youtube/cursor.json             # start the sweep over
```

On Windows PowerShell: `$env:YOUTUBE_API_KEY = "AIza..."; npm run videos`.

### Adding the key to GitHub Actions

1. Google Cloud Console → create a project → "APIs & Services" → enable **YouTube Data API v3** → "Credentials" → "Create credentials" → "API key". Under "API restrictions" allow only YouTube Data API v3. It is free; no billing account is needed for the 10,000 daily units.
2. GitHub repository → Settings → Secrets and variables → Actions → "New repository secret" → name `YOUTUBE_API_KEY`, paste the key.
3. In `.github/workflows/pages.yml`, give the step that runs `npm run videos` the secret as an environment variable, one line under `env:`:

   ```yaml
   YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
   ```

   Run it with `continue-on-error: true` like the news step, and schedule it at most once a day (the quota is daily). Without the secret the step still succeeds and ships the seed.

## Radio

### What runs

`npm run radio` → `node tools/build-radio.mjs`. Source: [Radio-Browser](https://www.radio-browser.info), a community-run directory of internet radio streams with a free, keyless JSON API (`https://api.radio-browser.info`).

The script resolves `all.api.radio-browser.info` in DNS, reverse-resolves the addresses to the mirror names (`de1.api.radio-browser.info`, …) and picks one at random, as the API documentation asks; if DNS fails it falls back to `de1`. For every country in `public/data/facts.json` with an `iso2` it requests once:

```
GET https://<mirror>/json/stations/bycountrycodeexact/<ISO2>?order=votes&reverse=true&hidebroken=true&limit=100
```

Raw responses are cached under `data/cache/radio/` (gitignored) through `getJsonCached`. Politeness: at most 3 requests in flight, starts spaced 300 ms apart, retries via `fetchRetry`, the shared User-Agent on every request. A country whose request fails gets an empty list and an entry in `errors`; the run continues. A full run is 250 requests and about 80 s (also from the cache, because the pacing still applies).

### Filters

The site is served over HTTPS (GitHub Pages). A browser refuses to load an `http://` stream from an HTTPS page (mixed content), so only `https://` streams can ever play. Each station must pass all of:

- `lastcheckok === 1` — Radio-Browser's own checker reached the stream recently.
- `ssl_error === 0` — the certificate verifies.
- `url_resolved` starts with `https://` and is not a playlist file (`.m3u`, `.pls`, `.asx`).
- A codec the `<audio>` element decodes natively: `MP3`, `AAC`, `AAC+`, `OGG` (Vorbis/Opus). Stations whose codec the directory has not identified (`UNKNOWN`, empty) rank after those. Video codecs (`FLV`, `MP4`, `AAC,H.264`) are dropped.
- HLS (`hls === 1` or a `.m3u8` URL) is used only when a country has nothing else, and is then marked `hls: true` so the player can treat it differently (Safari plays HLS natively; Chrome and Firefox need a library). On 2026-10-16 no country needed it.

Survivors are ranked by `votes`, then `clickcount`, de-duplicated by name (case-insensitive) and by URL, and capped at 8 per country. Votes are community votes on the directory, not our ranking: this is "the most-voted HTTPS streams filed under this country", and the card should say so. Community filing is imperfect: a few stations sit under the wrong country or are themed internet stations rather than local broadcasters (Japan's list is mostly J-pop/anime internet radio; "Free FM Tokyo" streams from a Madrid host). We do not correct the directory; a wrong entry is fixed at the source (`https://www.radio-browser.info`, "edit" on the station) and picked up at the next run.

### When

On demand. The output is **committed** (`public/data/radio.json`, about 380 KB), so the site works offline and without hitting the directory. Refresh **monthly**: stream URLs rot, and `hidebroken` plus `lastcheckok` only reflect the directory's state on the day of the run. Run `RADIO_FRESH=1 npm run radio` (clears `data/cache/radio/` first; without it the cached responses from the previous run are reused and nothing changes), look at the summary, commit.

The API answers browser requests with `Access-Control-Allow-Origin: *` (checked 2026-10-16 with an `Origin` header on GET and on an OPTIONS preflight; `User-Agent` is in `Access-Control-Allow-Headers`). So the site **may** later query the directory live, for example `/json/stations/byuuid/<id>` to fetch a station's current `favicon` and `url_resolved`, or `/json/url/<id>` to register a click (which is what keeps `clickcount` honest). The committed snapshot stays the primary source; a live query is an enhancement that must fail silently. Do not fall back to live queries for the whole list on every visit: the directory is run by volunteers.

### Output

`public/data/radio.json`:

```json
{
  "built": "2026-10-16",
  "source": "Radio-Browser (community directory, https://www.radio-browser.info)",
  "attribution": "Station names and streams belong to their broadcasters. …",
  "server": "de1.api.radio-browser.info",
  "countries": {
    "MX": [
      { "id": "a0b40c3f-aede-46e9-b67f-38cd8b262936",
        "name": "88.9 Noticias - 88.9 FM - XHM-FM - Grupo ACIR - Ciudad de México",
        "url": "https://playerservices.streamtheworld.com/api/livestream-redirect/XHMFMAAC_SC.aac",
        "codec": "AAC+", "bitrate": 48,
        "tags": ["88.9", "88.9 fm", "acir", "balada en español"],
        "lang": "spanish",
        "homepage": "https://www.iheart.com/live/889-noticias-6531/",
        "ll": null,
        "votes": 11783 }
    ]
  }
}
```

- `id` is the Radio-Browser `stationuuid`; `url` is `url_resolved` (the stream, after the directory followed playlists and redirects). Some streams answer with one more redirect (StreamTheWorld, Zeno); the `<audio>` element follows it.
- `codec` is as the directory spells it (`MP3`, `AAC`, `AAC+`, `OGG`), `null` when unknown; `bitrate` in kbit/s, `null` when 0 or unknown; `tags` at most 4, lowercase, as filed; `lang` is the directory's free-text language (`"spanish"`, sometimes `"spanish,english"`), `null` when empty; `homepage` is `null` unless it is an `http(s)` URL; `ll` is `[lat, lon]` rounded to 4 decimals or `null` (313 of 1,426 stations have one); `votes` is the directory's vote count.
- `hls: true` appears only on HLS streams (none today).
- `favicon` is **absent**: the file would exceed the 400 KB cap with it (the script drops favicons first, then cuts tags to 2, then lowers the per-country cap, and stops as soon as the file fits; today the first step was enough). If favicons matter, fetch them live by `id` (see "When") or raise `MAX_BYTES`.
- `errors: { "<ISO2>": "message" }` appears only when a country's request failed. A country with no playable station has `[]`.

Counts on 2026-10-16: 10,036 raw rows fetched; 1,426 playable stations in 240 countries; 140 countries have the full 8; 10 countries have none (BL BV EH GS HM MP NF PN TK WS: uninhabited or tiny territories, plus Western Sahara, Samoa and the Northern Marianas, whose few entries are all `http://`). Codecs kept: MP3 967, AAC 268, AAC+ 182, OGG 9.

### Attribution and policy rules

- Station names, logos and streams belong to their broadcasters. The site plays the public stream URL in an `<audio>` element and **never** re-hosts, records, re-streams or proxies audio. If a broadcaster's stream stops answering, it disappears at the next refresh; we do not look for a replacement URL ourselves.
- Directory data is community-contributed to Radio-Browser. Credit it in text ("Directorio: Radio-Browser") and link `https://www.radio-browser.info`. Show the station name as filed and link its `homepage` when it has one.
- The card must show `built` so a listener knows how old the list is, and must cope with `[]` (normal for small territories) and with a stream that fails to load (offer the next one or a short "no answer" line; never spin forever).
- Say that the list is "most voted on Radio-Browser", not "the best stations" or "the national broadcaster". We do not rank or endorse stations.

### Run locally

```sh
npm run radio                  # 250 requests, about 80 s; reuses data/cache/radio/ when present
RADIO_FRESH=1 npm run radio    # clear the cache first: this is the monthly refresh
```

On Windows PowerShell: `$env:RADIO_FRESH = "1"; npm run radio`.

Check the console summary (playable stations, countries with none, hls-only countries, raw codec mix), open `public/data/radio.json` and look at `MX`, `JP` and `FR`, and try two or three `url` values with `curl -sI -m 8 -L <url>` (expect `audio/mpeg`, `audio/aac`, `audio/aacp` or `audio/ogg`). Commit the file.
