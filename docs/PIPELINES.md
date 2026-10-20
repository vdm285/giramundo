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
- **Dishes**: Wikidata has no "national dish" property and the "national dish" class (Q1391582) is applied to seven items worldwide, so the list is the items filed under the national cuisine (P2012) that have a photo, ranked by sitelinks, 8 per country. A dish whose recorded country of origin (P495) is elsewhere is dropped; one whose origin is this country ranks above one with no origin recorded; restaurants, chains, brands, people and books filed under a cuisine are excluded by type. Items tagged as national dishes carry `national: true` and sort first. Each dish carries its es/en Wikipedia URLs in `wiki` when they exist. This is "what Wikidata files under Mexican cuisine", not a verdict: the card should say so (`notes` in the file).
  Two generic filters (added 2026-10-20) apply to every country: (1) a dish filed under **Tex-Mex cuisine** (P2012 = Q29359) is dropped even when it is also filed under the country's own cuisine, because Wikidata files chili con carne under Mexican, US and Tex-Mex cuisine at once, with origin Mexico; (2) a dish with **no country of origin** is kept only when its cuisine statement names this country's cuisine item (the "national dish" branch reaches items through P17 and is exempt). The filters are generic on purpose; a dish they drop wrongly (guacamole is also filed under Tex-Mex) is rescued per country through the overrides file below, which bypasses them. The console prints how many dishes each filter removed and the top ten countries.
- **Curated dishes** (`data/overrides/dishes.json`, committed, added 2026-10-20): per country, Wikidata items a person vouched for. They are fetched in one query (label es/en/mul, photo P18, es/en Wikipedia) and placed first, in the file's order, each with `curated: true` and an optional `region: { es, en }` (the state or area it belongs to, for the card to show on hover); the generic list fills the remaining slots up to 8, so a country with 8 or more curated dishes shows only those. Excluded items are dropped wherever they came from. See "How to curate a country" below.
- **Anthem** (P85): the statement that is a national anthem (Q23691) and preferred when several exist (Mexico also lists its flag salute), skipping ended statements.
- **Demonym** (P1549): Spanish masculine singular when marked (P5185 = Q499327), English singular when marked (P11054 = Q110786); plural-marked forms are skipped when anything else exists; unmarked Spanish pairs break the tie away from `-a`.

Labels fall back es ← mul ← en and en ← mul ← es. Wikidata stores a name that is the same in every language ("Marcha Real", "Kimigayo") under the `mul` language only; without that fallback Spain has no anthem.

- **Local labels** (added 2026-10-20): every dish, the cuisine and every heritage site also carry `label.local`, the Wikidata label in the country's first language, so the card can show the dish as locals write it (寿司, ผัดไทย, Kölner Dom). The language is `facts.json` `languages[0]` (ISO 639-3) mapped to a Wikidata code through the `LANG_CODES` table in the script (spa→es, jpn→ja, zho→zh, nor→nb/no…); when the code is not in the table, the country's most-spoken official language from `culture.json` (`languages[0].code`, Wikidata P218) is used; else `null`. The chosen code is written once per country as `localLang`, and repeated on each dish as `localLang` for convenience. For es/en countries the existing label is reused (no query); for the other 62 languages the items are queried in batches of 200 per language (`VALUES ?item {…} ?item rdfs:label ?l FILTER(LANG(?l) IN ("ja","mul"))`), `mul` as the fallback, about 60 extra queries once (cached). `label.local` is `null` when Wikidata has no label in that language (all of Bolivia's dishes under Aymara, Vanuatu under Bislama, Greenland under Greenlandic). Caveat: `facts.json` lists a country's languages alphabetically, so the "first" one is Arabic for Israel, German for Belgium, French for Switzerland, English for India and Aymara for Bolivia; to change a country's language, change the order in `facts.json` or the mapping in the script, not the output.

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
      "localLang": "es",
      "cuisine": { "qid": "Q207965", "label": { "es": "gastronomía de México", "en": "Mexican cuisine", "local": "gastronomía de México" },
                   "wiki": { "es": "https://es.wikipedia.org/wiki/…", "en": "https://en.wikipedia.org/wiki/Mexican_cuisine" } },
      "dishes": [
        { "qid": "Q4804467", "label": { "es": "Cochinita pibil", "en": "Cochinita pibil", "local": "Cochinita pibil" }, "localLang": "es",
          "image": "Cochinita pibil 2.jpg", "wiki": { "es": "https://es.wikipedia.org/wiki/Cochinita_pibil", "en": "https://en.wikipedia.org/wiki/Cochinita_pibil" },
          "region": { "es": "Yucatán", "en": "Yucatán" }, "curated": true },
        { "qid": "Q191655", "label": { "es": "taco", "en": "taco", "local": "taco" }, "localLang": "es", "image": "001 Tacos de carnitas, carne asada y al pastor.jpg", "wiki": { "es": "…", "en": "…" } }
      ],
      "heritage": [
        { "qid": "Q5859", "whs": "483",
          "label": { "es": "Chichén Itzá", "en": "Chichen Itza", "local": "Chichén Itzá" },
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

`demonym`, `anthem`, `cuisine`, `desc` are `null` when Wikidata has nothing; `ll`, `image`, `year` are `null` per site when missing; `wiki` has only the languages that have an article (sometimes `{}`); `shared: n` appears only on transboundary sites; `national: true` only on dishes tagged as such; `curated: true` and `region` only on dishes that come from `data/overrides/dishes.json`; `whs` is the UNESCO id as Wikidata stores it (`"1061bis"`, `"1321rev"` are official suffixes).

`image` is a Wikimedia Commons **file name**, not a URL. The site builds thumbnails itself: `https://commons.wikimedia.org/wiki/Special:FilePath/<encodeURIComponent(image)>?width=640`, and links the file page `https://commons.wikimedia.org/wiki/File:<image>` for the credit.

Counts on 2026-10-16: 174 countries with at least one site, 1,172 site entries (1,134 with image, 1,157 with coordinates, 111 transboundary repeats); 194 countries with a cuisine item, 112 with dishes (519 dishes); 237 anthems (missing: PT, whose Wikidata item has no P85, EH, and small territories); 235 demonyms. Local labels on 2026-10-20: 64 languages (AQ has none), 465 of 519 dishes have `label.local` and 280 of those differ from both es and en; 182 of 194 cuisines and 1,067 of 1,172 sites have one. The file is 671 KB (cap: keep it under 2 MB). After the Tex-Mex filter and the Mexico curation (2026-10-20): 528 dishes in 112 countries (MX has 18 curated, no generic fill; the Tex-Mex filter removed 2 dishes in MX and 1 in US), 484 dishes have a `wiki` link, 719 KB.

### Attribution rules

- Wikidata is CC0: no credit is legally required, but the card should say "Datos: Wikidata" and link the item (`https://www.wikidata.org/wiki/<qid>`) so a wrong fact can be fixed at the source.
- Commons images are **not** CC0. Each file has its own license (CC BY, CC BY-SA, public domain…). When the card shows an image it must link to the file page, and ideally show the author and license fetched live from `https://commons.wikimedia.org/w/api.php?action=query&titles=File:<image>&prop=imageinfo&iiprop=extmetadata&format=json&origin=*` (fields `Artist`, `LicenseShortName`, `LicenseUrl`). Never crop out a watermark or present the photo as ours.
- `desc` and `wiki` are Wikipedia: CC BY-SA 4.0; keep the link.
- Dishes are a Wikidata filing, not an editorial ranking. The card says where the list comes from and does not call anything "the national dish" unless `national: true`. Curated dishes are still Wikidata items: the person picked which ones, not what they are.

### How to curate a country

Wikidata's filing is thin for most kitchens: the regional dishes a local would name usually carry "country of origin" but no "cuisine" statement, so they never reach the generic list, while border or export food does. The fix is a short list per country in **`data/overrides/dishes.json`** (committed; `data/cache/` is not):

```json
{
  "MX": {
    "note": "why this country needed a hand, and any call you made against the data",
    "include": [
      { "qid": "Q4804467", "region": { "es": "Yucatán", "en": "Yucatán" } },
      "Q515692"
    ],
    "exclude": ["Q863794", "Q2666603"]
  }
}
```

- `include`: Wikidata Q-ids, in the order the card should show them (the card shows the first six). An entry is a plain `"Q…"` or an object with `qid` and `region`, short es/en strings naming the state or area (`"Todo el país"` / `"Nationwide"` when it has none). The build fetches label, photo and Wikipedia links from Wikidata; the file never carries a name, a photo or a description.
- `exclude`: Q-ids that must not appear, whatever Wikidata files them under.
- `note`: free text for the next person. Keys starting with `_` are comments.
- The rule: **an override must be a real Wikidata item with a photo (P18)**. An id that does not resolve, or has no photo, is skipped with a console warning, never written. No invented dishes: if the dish has no Wikidata item yet, create the item there (with a Commons photo) first, then point at it.
- To find ids: search the dish on wikidata.org in es and en, open the item, check P18 (image), P495 (country of origin) and P2012 (cuisine). Prefer the specific item over the generic one ("Mole poblano" Q3319470 over "mole"; "Huachinango a la veracruzana" Q17073167 over "fish"). Record in `note` when you went against the data (Mexico excludes nachos although Wikidata says they were born in Piedras Negras).

Then `npm run places` (the curated query and the changed batches run live, about 1.5 s apart; everything else is cached), read the `curated:` and `dish filters:` lines in the console summary, open `public/data/places.json` at the country, and commit both files.

### Run locally

```sh
npm run places                 # about 25 SPARQL queries, under 3 minutes from an empty cache
rm -r data/cache/wikidata      # to force fresh data (the cache is keyed by query text)
```

Check the console summary (countries with heritage, sites, images, curated dishes, dish filters), then open `public/data/places.json` and look at `MX` and `JP`. Commit the file (and `data/overrides/dishes.json` if it changed).

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

## Walks (keyless)

### What runs

`npm run walks` → `node tools/build-walks.mjs`. Writes `public/data/walks/{iso2 lowercase}.json` plus `index.json`, **not committed** (`.gitignore`), deploy-time like news. No key: YouTube publishes an Atom feed per channel, `https://www.youtube.com/feeds/videos.xml?channel_id=UC…`, with the 15 latest videos (`yt:videoId`, `title`, `published`, `media:thumbnail`). The same endpoint takes `playlist_id=PL…` if a playlist is ever wanted.

The source is a **curated list of 40 travel channels** at the top of the script (`CHANNELS`: handle, kind, home country), verified on 2026-10-20: 29 walking-tour channels (Rambalac, NIPPON WANDERING TV, Tokyo Explorer, Seoul Walker, Walk East, Walking in India, Ambient Walking, LATIN WALKS, MADRID WALK, Mexico Caminando, Caminando por México, Prowalk Tours, Watched Walker, POPtravel, 4K Urban Life, HP Walking Tours, BookingHunterTV, World Walking Tours, 4K WALK, Wind Walk Travel Videos, BLA BLA WALKER, One Man Wolf Pack, World Wanderings, LADmob, Walk The Tour, Through Streets & Tastes, Walking OZ, and the Spanish-language travel vloggers alanxelmundo and Luisito Comunica), 7 food channels (Mark Wiens, Best Ever Food Review Show, The Food Ranger, Davidsbeenhere, STREET FOOD KING, TabiEats, La Ruta de la Garnacha), 3 scenic/drone channels (Drone Snap, Relaxation Film, Scenic Relaxation) and 1 city-sounds channel (Nomadic Ambience). `kind` (`walk | food | drone | sounds`) is the channel's genre, not a per-video judgment: a Luisito Comunica vlog about a cantina is filed as `walk`. The handle → `channel_id` lookup reads `<meta itemprop="identifier" content="UC…">` (or `"externalId"`) from `https://www.youtube.com/@handle` and is cached 30 days in `data/cache/youtube-rss/channels.json`; a handle that 404s is cached 7 days and reported, never guessed. To add a channel, append it to `CHANNELS` and run `WALKS_DRY=1 npm run walks`, which resolves and prints every channel without fetching feeds. Many plausible handles are squatted or dead (`@JapanWalk` is an Indonesian vlog, `@WalkingPeru` a shoe shop, `@CityWalks` a treadmill channel): always read the channel's recent titles before keeping it.

**Matching** is by title only. Every city name in `cities.json` (es and en, plus a few aliases: NYC/Manhattan, CDMX, Saigon, Bombay, Puebla), every country name in `facts.json` (es/en, plus aliases such as Turkey, UK/England/Scotland, Holland, Korea, Czech Republic, USA), a table of regions and islands people name instead of the country (Sicily, Bali, Yucatán, Santorini, Shibuya…), the demonyms from `places.json` ("Mexican", "Somali") and flag emoji (🇲🇽 → MX) are folded (accents stripped, lowercase) and matched longest-first on word boundaries. A city match wins over a country name, which wins over a demonym; among equals, the first in the title. Guards: a city name that is also an ordinary word or a first name (Nice, Tours, Split, Reading, Como, Lagos, Victoria, Callao, San Lorenzo…) or that exists in several countries (Valencia, Tripoli, Hyderabad, Hamilton) counts only when the title also names the country (or shows its flag) or the channel is about that country; "Little Italy", "Rome of the North", "Venice of the Alps", "New Mexico", "French fries" are consumed before matching; when the title names a country, a city from another country is demoted ("Trier, Germany … Rome of the North" → DE). A channel with a `home` country (Rambalac → JP) files titles that name no place under that country with `place: null` and `via: "channel"`, and its own country wins ties ("De Sol a Callao … Madrid" → Madrid, not Callao, Peru). Titles are also de-duplicated per channel (re-uploads).

Politeness: 3 requests in flight, starts 400 ms apart, `fetchRetry` (3 attempts), feeds cached 6 h in `data/cache/youtube-rss/<channelId>.xml`. A full run from an empty cache is about 80 requests and 40 s; from the cache, a second. A feed that fails is reported and skipped; the run goes on.

### When

Recommendation: run it in `.github/workflows/pages.yml` on the same schedule as news (every 6 hours, `0 */6 * * *`, plus every push and `workflow_dispatch`), after `npm test` and before `npm run build`, with `continue-on-error: true`. The feeds change a few times a day at most, so 6 h matches the cache TTL and keeps the stored titles far inside YouTube's 30-day refresh rule. The one line to add next to the news step is:

```yaml
      - run: npm run walks
```

(with `continue-on-error: true` on the step, like news). No secret is needed. It is a separate file set from `videos/` (the Data API sweep), so both can ship; the card can show walks first and fall back to videos.

### Output

`public/data/walks/{iso2}.json`, capped at **24** per country, newest first but round-robin across channels so one prolific channel does not fill the list, and channel-only matches after titled ones:

```json
{
  "iso2": "MX",
  "built": "2026-10-20T19:00:17Z",
  "items": [
    { "id": "IO9nezGv06A", "kind": "food", "title": "TACOS al CARBON BARATOS VS CAROS en CDMX",
      "channel": "La Ruta de la Garnacha", "place": "Mexico City", "cityId": "mx-mexico-city",
      "published": "2026-10-18T17:00:15+00:00", "thumb": "https://i2.ytimg.com/vi/IO9nezGv06A/hqdefault.jpg",
      "via": "city" }
  ]
}
```

`place` is the English city name from `cities.json` and `cityId` its slug, both `null` when only the country matched; `via` says how the item was filed: `city`, `country` (name, alias, region or flag), `demonym`, or `channel` (no place in the title; the channel's home country). `thumb` is the feed's thumbnail URL (`i*.ytimg.com`), `null` if the feed had none. `published` is the feed's ISO timestamp.

`public/data/walks/index.json`: `{ built, source, attribution, channels: [ { handle, id, name, kind, home } ], countries: { "MX": { items: 24, cities: 4, kinds: { walk: 17, food: 6, sounds: 1 } } } }`. A country with no match has no file and no index entry; the card must cope.

Counts on 2026-10-20: 40 channels, 592 videos in the feeds, 521 filed (251 by city, 209 by country, 9 by demonym, 52 channel-only) into 68 countries, 80 distinct cities; MX 24 (CDMX, Puebla, Mérida, Monterrey), JP 24 (Tokyo, Kyoto, Osaka), FR 14 (Paris, Lyon, Marseille). 69 files, 134 KB in total. Coverage follows the channel list: Europe, East and South Asia, Mexico and the Southern Cone are good; Africa and Central Asia appear only when a world channel passes through.

Known risks: demonym matches are the weakest tier ("Indian cooking" filmed in Malaysia; "Greek yogurt"); a drone channel's "Canada Autumn" is scenery, not a city; a title naming two places files under the first ("Laos & Cambodia" → LA); Spanish vlogs (Luisito, Alan) are travel vlogs, not silent 4K walks, and carry `kind: "walk"` because that is the channel's genre. When a wrong item shows up, the fix is in the script's lists (`COMMON_CITY_WORDS`, `NOT_PLACES`, `REGION_ALIASES`, `COUNTRY_ALIASES`), never in the output.

### Attribution and policy rules

Same as Videos: we store only IDs and a snapshot of title, channel and thumbnail URL; the site re-reads title and channel through oEmbed when it shows a video, plays through the official `youtube-nocookie.com` embed, shows the channel name, links to YouTube and never hosts or re-encodes anything. The feeds are public and keyless; we read 40 of them every 6 hours, which is what a feed reader does. Titles are shown as the channel wrote them.

### Run locally

```sh
npm run walks                 # ~80 requests, ~40 s from an empty cache; then cached 6 h
WALKS_DRY=1 npm run walks     # resolve the channel list only, print id, kind, home, name
```

On Windows PowerShell: `$env:WALKS_DRY = "1"; npm run walks`. Check the console summary, then `public/data/walks/index.json` and `mx.json`, `jp.json`, `fr.json`. The folder is gitignored; do not commit it.

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

## Cities

### What runs

`npm run cities` → `node tools/build-cities.mjs`. Source: [Natural Earth](https://www.naturalearthdata.com) 1:10m **Populated Places**, the full version (not `_simple`), because it carries localized names (`NAME_ES`, `NAME_EN`). Natural Earth is public domain: no credit is required, but the card says "Datos: Natural Earth" like the map does. The GeoJSON (19 MB, 7,342 points) is taken from the `nvkelso/natural-earth-vector` repository, which mirrors the official release (`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson`), and cached in `data/cache/ne/` (gitignored). If that file ever disappears the script falls back to `ne_10m_populated_places_simple.geojson` and warns that the Spanish names will be English.

Rows join to `public/data/facts.json` through `ISO_A2`. Rows Natural Earth marks `-99` join through `ADM0_A3` → facts `iso3`, with aliases for the codes it spells differently (`KOS` → `UNK` Kosovo, `PSX` → `PSE`, `ALD` → `ALA`, `SAH` → `ESH`), then `SOV_A3`. When `ISO_A2` and `ADM0_A3` disagree, the admin-0 unit wins unless it is the sovereign itself: Niue's rows say `NZ`/`NIU` (so Niue), Martinique's say `MQ`/`FRA` (so Martinique). Somaliland (`SOL`, 7 rows) and Northern Cyprus (`CYN`, 2 rows) are not countries in `facts.json` and are left out; the console reports them. "Historic place" (abandoned towns, Chernobyl) and "Meteorological Station" rows are skipped; Antarctica keeps its scientific stations.

Per country: the capital, always, plus the largest places by `POP_MAX`, up to **8** in total (**12** for CN, IN, US, BR, RU, MX, JP, ID, NG, PK). Duplicate names are dropped (case-insensitive English name). The capital is decided per country, in this order: the row whose name is the capital `facts.json` gives (so the dossier and the pin agree: Sucre, Pretoria, Naypyidaw, Dodoma, Porto-Novo, Gitega); otherwise every `FEATURECLA = "Admin-0 capital"` row; otherwise, for dependencies, every `"Admin-0 region capital"` row (Nuuk, Hong Kong, Gibraltar, Nouméa). `"Admin-0 capital alt"` is never a capital (Natural Earth uses it for Kyoto, Lagos, Valparaíso, Tel Aviv), and `"Admin-0 region capital"` is not used when the country has a national capital (it also covers Cardiff, Banja Luka, Batumi, Novi Sad, Sukhumi).

Natural Earth's `TIMEZONE` is sometimes empty, stale or wrong (Macau is filed under `America/Fortaleza`): renamed zones are mapped to their IANA names (`Asia/Rangoon` → `Asia/Yangon`, `Europe/Kiev` → `Europe/Kyiv`...), and a missing zone, or one the country does not have in `facts.json`, becomes the country's zone when it has exactly one; a wrong zone in a multi-zone country is kept as the source has it.

### When

On demand. The output is **committed** (`public/data/cities.json`, about 225 KB). Natural Earth releases are rare (5.x in 2022–2024); re-run when a new release lands or a capital changes, and commit. `CITIES_FRESH=1 npm run cities` re-downloads the source (`$env:CITIES_FRESH = "1"; npm run cities` on PowerShell).

### Output

`public/data/cities.json`:

```json
{
  "built": "2026-10-16",
  "source": "Natural Earth 1:10m Populated Places (public domain)",
  "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson",
  "countries": {
    "MX": [
      { "id": "mx-mexico-city", "name": { "es": "Ciudad de México", "en": "Mexico City" },
        "ll": [19.444, -99.133], "pop": 19028000, "capital": true,
        "admin1": "Distrito Federal", "tz": "America/Mexico_City", "qid": "Q1489" },
      { "id": "mx-guadalajara", "name": { "es": "Guadalajara", "en": "Guadalajara" },
        "ll": [20.672, -103.332], "pop": 4198000, "capital": false,
        "admin1": "Jalisco", "tz": "America/Mexico_City", "qid": "Q9022" }
    ]
  }
}
```

- `id` is the **slug**: the country's `iso2` in lowercase, a hyphen, then the English name (`NAME_EN`, falling back to `NAME`) with accents stripped (NFD, combining marks removed; ß → ss, ø → o, æ → ae, đ → d, ł → l, apostrophes dropped), lowercased, every run of other characters replaced by one hyphen, hyphens trimmed: `São Paulo` → `br-sao-paulo`, `Kōbe` → `jp-kobe`, `Ciudad Nezahualcóyotl` → `mx-ciudad-nezahualcoyotl`. If two places in one country slug the same, the second gets `-2`. The slug is stable across runs as long as the English name does not change; it is meant for the URL hash and for linking other datasets.
- `name.es` is `NAME_ES`, `name.en` is `NAME_EN`, both falling back to `NAME`. Natural Earth copies the English name into `NAME_ES` when it has no Spanish exonym, so `es` equals `en` for most places and differs where Spanish has a name (`Tokio`, `Marsella`, `Burdeos`, `Argel`, `Kioto`).
- `ll` is `[lat, lon]` rounded to 3 decimals (about 100 m), from `LATITUDE`/`LONGITUDE` (the geometry when those are missing).
- `pop` is `POP_MAX`, Natural Earth's estimate of the urban agglomeration (it can be the metro area, so Osaka reads 11.3 million), or `null` when 0. Say "Natural Earth estimate", never "the population of the city".
- `capital` is `true` on the capital rows as decided above. Eswatini has two (Mbabane and Lobamba, both named in `facts.json`). A country can have none: AQ, YT, MP, TK, VI, EH, where Natural Earth has no point with the capital's name (Dzaoudzi is there but Mamoudzou is not; Capitol Hill but not Saipan).
- `admin1` is `ADM1NAME` (state, province, region, as Natural Earth spells it, so `"Distrito Federal"` for CDMX), `null` when missing; `tz` is the IANA zone or `null`; `qid` is the Wikidata id (`Q…`) or `null` (4 rows). Link `https://www.wikidata.org/wiki/<qid>` for the source; a Wikipedia article can be found from it.
- The file is kept under 250 KB: the script drops `admin1` from every row first, then `tz`, then lowers the per-country cap, and stops as soon as it fits (today nothing was dropped).

Counts on 2026-10-16: 228 of 250 countries have at least one place, 1,353 places, 223 capital rows; 10 countries have 12, 125 have 8, 93 have fewer. 22 countries have none, all small territories Natural Earth has no point for: AI BV IO VG BQ CX CC TF GG HM JE MS NR NF PN BL SH MF PM SX UM WF. The card must cope with a missing country and with a list without a capital.

### Run locally

```sh
npm run cities                  # downloads 19 MB once into data/cache/ne/, then a few seconds
CITIES_FRESH=1 npm run cities   # re-download the source
```

Check the console summary (unmatched codes, countries with none, countries without a capital row), open `public/data/cities.json` and look at `MX`, `JP` and `FR`: the capital first with `capital: true`, Spanish exonyms where they exist, populations in the right order. Commit the file.

## Culture

### What runs

`npm run culture` → `node tools/build-culture.mjs`. Source: the Wikidata Query Service (SPARQL), through the cached `sparql` helper in `tools/net.mjs` (responses land in `data/cache/wikidata/`, keyed by query text). Countries join to `public/data/facts.json` through P297 (ISO 3166-1 alpha-2) exactly as the Places pipeline does; all 250 match. Demonym and cuisine live in `places.json` and are not repeated here.

Per country it collects:

- **Anthem** (P85): the statement that is a national anthem (Q23691) and Preferred when several exist (Mexico also lists its flag salute), skipping ended and deprecated statements. Label es/en (with the `mul` fallback: "Kimigayo"), the es/en Wikipedia article URLs, and **one audio file** from the anthem item's P51, as a Commons file name. When there are several, the script prefers names containing "instrumental", then official-band recordings ("US Navy Band", "Marine Band", "Banda…"), then a format a browser plays (`.ogg`, `.oga`, `.opus`, `.mp3`, `.flac`, `.wav`), and demotes `.mid`. Play it from `https://commons.wikimedia.org/wiki/Special:FilePath/<encodeURIComponent(audio)>` in an `<audio>` element; Chrome and Firefox play Ogg Vorbis, Safari needs a fallback or a note that the file is on Commons.
- **People**: up to 12 humans (P31 = Q5) whose country of citizenship (P27) is the country, with deprecated and ended citizenships skipped (Kazuo Ishiguro is not listed under Japan; Soviet citizens are not Russians), ranked by sitelinks (how many Wikipedias have an article). Finding "the 40 most-linked citizens" of a big country by `ORDER BY` alone takes ~35 s for the United States, so one range query over everyone with at least 30 sitelinks (`hint:Prior hint:rangeSafe true`, 43,000 rows in a few seconds) fills the big countries, and only the countries that get fewer than 40 candidates from it run their own `ORDER BY DESC(?links) LIMIT 40` query, which is quick because they are small. Candidates are then detailed in batches of 200 (two flat queries each: labels, descriptions, image, dates, birth countries; then occupations). Blazegraph throws a `StackOverflowError` when those OPTIONALs are combined with `GROUP BY` / `GROUP_CONCAT`, so the rows are merged in JS. A country whose query fails keeps an empty list and the run continues.
  Ranking in JS: people whose recorded birthplace (P19 → P17) is in another country sort after the rest (naturalized citizens stay in but do not lead: Wikidata gives Trotsky, Buñuel and Cortés Mexican citizenship); then by sitelinks. Only people with a photo (P18) are kept when that leaves at least 6; otherwise the ones without fill the list. The occupation shown is the one with Preferred rank when an editor set one, else one the Wikidata description itself names (by word stem, plus a short alias table: "president" implies politician, "filmmaker" film director, "actress" actor), else the person's occupation whose own item has the most sitelinks. SPARQL does not expose statement order, so "the first P106" cannot be read literally.
- **Languages**: official languages (P37) of the country, skipping ended and deprecated statements, with label es/en, the ISO 639-1 code (P218) when the language has one, and the number of native speakers (P1098 on the language item: the Preferred value, else the most recent point in time, else the largest), rounded to an integer. The count is **global**, not per country: Spanish shows about 485 million under Mexico and under Spain, English 753 million under India. Sorted by speakers.

Labels fall back es ← mul ← en and en ← mul ← es; descriptions es ← en.

WDQS specifics: 1.5 s gap between live queries (429 with Retry-After is honored by `fetchRetry`); the range query pins its join order with `hint:Query hint:optimizer "None"`. A full run from an empty cache is about 265 queries and 10 to 12 minutes; from the cache, seconds.

### Known skew

Sitelinks measure how many Wikipedias write about someone, which favors presidents, footballers and pop singers over scientists, painters and composers: of the 2,617 people kept on 2026-10-16, 1,280 are shown as politicians and 296 as footballers. Small countries' lists are mostly heads of state. Mexico does come out as Frida Kahlo, Octavio Paz, Lila Downs, Salma Hayek, Claudia Sheinbaum, Emiliano Zapata, López Obrador, Benito Juárez, Diego Rivera, Peña Nieto, Anthony Quinn, Porfirio Díaz; Japan as Bashō, Naruhito, Kurosawa, Hokusai, Abe, Hirohito, Akihito, Murakami, Kawabata, Miyazaki, Mishima, Suga. The card should say "the people most Wikipedias write about", not "the most important people". To change the mix, edit `rankPeople` in the script (for example, weight occupations) rather than the output; the tuning notes are at the top of `tools/build-culture.mjs`.

### When

On demand. The output is **committed** (`public/data/culture.json`, about 845 KB, capped at 900 KB: the script shortens descriptions to 100 characters first, then lowers the people cap to 10, then 8, and stops as soon as the file fits; today nothing was cut). Re-run a few times a year, or when a card shows a wrong name, with `rm -r data/cache/wikidata` first to force fresh data, and commit.

### Output

`public/data/culture.json`:

```json
{
  "built": "2026-10-16",
  "source": "Wikidata (CC0), Wikimedia Commons",
  "attribution": { "data": "…", "images": "…", "text": "…" },
  "notes": "how each list was built, one line",
  "countries": {
    "MX": {
      "anthem": { "qid": "Q200742",
                  "label": { "es": "Himno Nacional Mexicano", "en": "National Anthem of Mexico" },
                  "audio": "Himno Nacional Mexicano instrumental.ogg",
                  "wiki": { "es": "https://es.wikipedia.org/wiki/Himno_nacional_mexicano", "en": "https://en.wikipedia.org/wiki/Himno_Nacional_Mexicano" } },
      "people": [
        { "qid": "Q5588", "label": { "es": "Frida Kahlo", "en": "Frida Kahlo" },
          "desc": { "es": "pintora y activista mexicana", "en": "Mexican painter (1907–1954)" },
          "image": "Frida Kahlo, by Guillermo Kahlo (cropped).jpg",
          "born": 1907, "died": 1954,
          "job": { "es": "pintor", "en": "painter" } }
      ],
      "languages": [
        { "qid": "Q1321", "label": { "es": "español", "en": "Spanish" }, "code": "es", "speakers": 485000000 },
        { "qid": "Q13300", "label": { "es": "náhuatl", "en": "Nahuatl" }, "code": null, "speakers": 1925620 }
      ]
    }
  }
}
```

`anthem` is `null` when Wikidata has no P85 (PT, EH and small territories); `audio` is `null` when the anthem item has no P51; `wiki` has only the languages that have an article. Per person, `desc`, `image`, `born`, `died`, `job` are `null` when missing (`born` is negative for BCE). `people` is `[]` for 19 territories (AS AQ BV BQ CW GF TF GL GU HM MP BL SH PM SX GS SJ UM VI). `code` and `speakers` are `null` per language when missing; `languages` is `[]` for AQ BV GP MQ UY (Uruguay's item has no P37).

`image` and `audio` are Wikimedia Commons **file names**, not URLs: thumbnail `https://commons.wikimedia.org/wiki/Special:FilePath/<encodeURIComponent(image)>?width=640`, file page `https://commons.wikimedia.org/wiki/File:<image>` for the credit.

Counts on 2026-10-16: 237 countries with an anthem, 187 with audio (147 `.ogg`, 32 `.oga`, 6 `.wav`, 1 `.mp3`, 1 `.mid` for Pitcairn), 236 with a Wikipedia article; 231 countries with people, 218 with at least 6, 209 with the full 12; 2,617 people, 2,492 with image; 245 countries with languages, 523 entries, 478 with a speaker count.

### Attribution rules

- Wikidata is CC0; the card should still say "Datos: Wikidata" and link each item (`https://www.wikidata.org/wiki/<qid>`) so a wrong fact is fixed at the source.
- Commons images **and audio** are not CC0: each file has its own license. Link the file page next to every portrait and every anthem player, and show the author and license fetched live (see the Places section for the `imageinfo` call). Most anthem recordings are public domain or US government works, but check per file.
- `desc` is the Wikidata description (CC0); `wiki` links point to Wikipedia (CC BY-SA 4.0).
- Say "the people most Wikipedias write about", never "the most famous" or "the greatest". Living politicians dominate; the card should not read as an endorsement.

### Run locally

```sh
npm run culture                # about 265 SPARQL queries, 10 to 12 minutes from an empty cache
rm -r data/cache/wikidata      # to force fresh data (shared with npm run places)
```

Check the console summary (anthems with audio, countries with at least 6 people, languages), then open `public/data/culture.json` and look at `MX`, `JP` and `FR`. Commit the file.

## Precomputed maps

`npm run maps` → `public/textures/idmap.png` and `public/textures/borders.png`. The shader used to get these from two 4096x2048 canvases painted at startup (`paintIdMap`, `paintBorders` in `src/globe/paint.js`), which froze slow machines for about a second. Now they are painted once, offline, from `public/data/countries-50m.json`. Re-run whenever that file changes. Takes about 4 seconds.

### Steps

1. `tools/build-maps.mjs` (Node) turns the TopoJSON into features in file order (`id` = index + 1, the same `assignIds` rule the app uses) and projects every polygon with d3-geo's `geoEquirectangular` path into a recording context, so the rings are cut at the antimeridian exactly as the browser cut them (Russia, Fiji and Antarctica's pole cap). Each emitted piece is sorted into outer or hole by the sign of its area in pixel space. Output: `data/cache/maps/rings.json` (gitignored) as `{ width, height, features: [{ id, name, numeric, area, rings, holes }] }` with pixel coordinates, `area` being the feature's bbox area in texels. It then spawns the two Python scripts and checks the files exist.
2. `tools/paint-maps.py` (Pillow) fills the id map with `ImageDraw.polygon` (no anti-aliasing), largest bbox first so enclaves paint over their hosts; each feature's holes are filled black right after its outer rings; a 1 px same-color outline keeps sub-texel countries on the map. A country left with no texel because a neighbor covers it (Sint Maarten under St-Martin: one texel is about 10 km) gets one texel at its centroid. The borders are drawn as 3 px lines at 8192x4096 and Lanczos-downsampled to 4096x2048; segments d3 added along the antimeridian or the pole edge are skipped so there is no seam line through Chukotka.
3. `tools/check-maps.py` reads `idmap.png` back and samples Mexico City, Maseru, the Caspian, the mid-Pacific, Singapore, the South Pole, Chukotka east of 180, Fiji, San Marino, the Vatican, Monaco and Pretoria. The build fails if any decodes to the wrong id.

### Files

| File | Size | Encoding |
| --- | --- | --- |
| `public/textures/idmap.png` | 4096x2048, palette PNG (242 entries, byte-exact with the RGB image), 86 KB | `R = id & 255`, `G = (id >> 8) & 255`, `B = 0`; ocean and lakes `(0, 0, 0)` |
| `public/textures/borders.png` | 4096x2048, LA PNG, 430 KB | `L = 255` everywhere; `A` = outline coverage, 1.5 px wide, quantized to 32 levels |

Both are equirectangular with longitude 0 at the center and north at the top: `x = (lon + 180) / 360 * 4096`, `y = (90 - lat) / 180 * 2048`. Sample them like the NASA plates (`uv.x + 0.5`).

### Loading in the app

- Both: `THREE.TextureLoader`, default `flipY = true` (the same orientation `CanvasTexture` had), `colorSpace = NoColorSpace`, `wrapS = RepeatWrapping`, `wrapT = ClampToEdgeWrapping`.
- `idmap.png`: `magFilter = minFilter = NearestFilter`, `generateMipmaps = false`, `anisotropy = 1`. Any filtering blends ids into a neighbor's.
- `borders.png`: `LinearFilter` with mipmaps and anisotropy as before; the shader reads `.a`.
- The ids only match while the app assigns them the same way (`feature(topo, topo.objects.countries).features[i].properties.id = i + 1`). Rebuild the PNGs with the map.

## Money

### What runs

`npm run money` → `node tools/build-money.mjs`. For every currency code in `public/data/facts.json` (162 codes on 2026-10-20) it collects photographs or scans of the banknotes (first) and coins from Wikimedia Commons, with the license and author of each file, plus the currency's name and issuer from Wikidata. Nothing is drawn or invented: a currency whose notes are not on Commons gets an empty list, and the card must say so.

Two sources, both through `tools/net.mjs`:

- **Wikidata** (one SPARQL query, cached in `data/cache/wikidata/`): the item whose ISO 4217 code (P498) is the code, its label es/en (with the `mul` fallback: "euro"), its Commons category (P373), its main image (P18) and its issuer (P562, "central bank/issuer", skipping ended and deprecated statements). When two items share a code the one with more sitelinks wins. 153 codes match; the 9 that do not (AAD CKD FOK GGP IMP JEP KID TVD ZWB) are not ISO 4217 codes but the unofficial codes facts.json carries for Antarctica, the Cook Islands, the Faroes, Guernsey, the Isle of Man, Jersey, Kiribati, Tuvalu and Zimbabwe's bond notes; they get `name: null` and empty lists.
- **Wikimedia Commons API** (`https://commons.wikimedia.org/w/api.php`, every response cached in `data/cache/commons/` keyed by URL). Pool of 2, request starts 400 ms apart, retries and the shared User-Agent from `fetchRetry`; cached answers skip the gate, so a re-run after a scoring change takes about 30 s. A full crawl from an empty cache was 1,861 requests in 16 minutes.

### How files are found

1. **Root categories.** The subcategories of the Wikidata category ("Money of Mexico", "Euro") that name banknotes or coins, plus guessed names checked in one batched `categoryinfo` call: "Banknotes of <country>", "Banknotes of the <official name>", "<Currency> banknotes", "Coins of …". Ranking: a category that names the currency itself ("Banknotes of Brazilian real", "Euro coins") beats one that names the state officially ("Banknotes of the People's Republic of China", which holds the renminbi while "Banknotes of China" holds every dynasty), which beats "Banknotes of <country>", which beats anything else. A denomination category ("1 Yen banknotes of Japan", "One dollar coins of Canada") is never a root. At most two roots per kind; when the first names the currency or the state and is not tiny, it stands alone. The primary country of a code is the one whose ISO2 opens it (MXN → MX, GBP → GB), else the most populous user, so GBP guesses "United Kingdom" and not "Jersey".
2. **Denomination categories.** Subcategories such as "1000 won banknotes", "20 United States dollar banknotes", "Euro coins (10 cents)", "Dimes of the United States", directly under a root or under its "by denomination" / "by face value" / "by name" child, ranked by size and capped at 8 (notes) or 6 (coins). A file found through one inherits the denomination when its title does not state it.
3. **Search.** CirrusSearch `deepcategory:"<category>"` flattens a whole tree in one request. Each denomination category and each root is searched sorted by `create_timestamp_desc` (newest uploads first, which favors the series in circulation) and by relevance; trees with more than 200 hits are narrowed to files that name the unit (`(yen OR yens)`, with `cent`, `quarter`, `dime`… for coins) and get one more page aimed at obverse scans. **Never put a negated word in a deepcategory query**: `-specimen` made the Korean tree drop from 132 hits to 7; specimens are scored down instead. A currency with no category at all falls back to plain search (`"banknote" "<label en>"`, `"billete" "<label es>"`).
4. **Title scoring** in JS, no network: obverse words up (+6), reverse words down; a face value detected in the title (+3): a round number (1, 2, 2.5, 20, 500, 100000; 1967 and 17 are years and catalog numbers) followed within three words by a unit noun, a currency symbol, or preceded by "billete de" / "banknote of", with inflections matched by stem ("Zlotych" is złoty, "krónur" is króna) and number words in es/en/pt/nl/de/fr ("Dos pesos", "twee rand"); a year in the title: 2010+ strongly up, 2000s up, 1950–1989 down (−6), earlier −12; the newest series seen across the currency's titles (letter: "Series F", "Familia G"; ordinal: "Second series", "1 Brazil real Second Obverse"; Roman: "serieVI") +4, an older series −3; words marking the current issue ("polymer", "Europa series", "new", "9th series") +4; a foreign unit or another country's name in the title −6; commemorative, bullion and collector words −6; scene words (wallet, hand, pile, ATM, hologram, signature, chart) −4; dealer, museum, cheque, token, colonial, fantasy, "old"/"historic" and the like −9. A title that names only the other kind ("Moneda" under banknotes) is out (−20). Files scoring under 1 are dropped: a file that earned one penalty is left out even when the currency is thin, because an empty gallery beats a wrong one.
5. **imageinfo** for the 40 best notes and 30 best coins (50 titles per call): width, height, MIME, `LicenseShortName`, `Artist`, `Credit`, `AttributionRequired`. SVG, GIF and PDF are skipped; width must be at least 600, or 560 for a file the title dates to 2010 or later or places in the newest series (the ECB's own Europa-series scans are 596 px wide, Brazil's second-family scans 573). One file per denomination, at most two files without a detected denomination (and only when the title names a banknote or coin), 8 notes and 6 coins per currency. Today's money comes first in the list (dated 2000 or later, newest series, or marked current), each block in face-value order, then undated or older issues.

### Honesty

Commons only has what people were allowed to upload. A central bank that keeps its copyright (Mexico, the United Kingdom, Canada, Australia, Poland, the Nordic countries, Vietnam and many more) has no current notes on Commons; the gallery is then older issues or empty. Mexico's "Familia G" (2018–) is not on Commons at all: the MXN list is 1910s revolution-era notes and a 1970 one-peso note, filed exactly as Commons files them. The card must therefore say "lo que Wikimedia Commons tiene archivado" / "as filed on Wikimedia Commons", show `year` and `series` when present, and never say "current" or "today's banknotes" by itself. The data that *is* current: USD (Federal Reserve notes, series 2013–2025), EUR (Europa series 10–200 €, 5 € 2013; the 500 € is the 2002 issue because no Europa 500 exists), JPY (the 2024 series 1,000/5,000/10,000 yen first), BRL (second family 1–200 reais), INR (Mahatma Gandhi New Series 2014–2018), EGP (2011–2022 incl. the 10-pound polymer), KRW (serie V/VI and the 2009 50,000 won).

Licenses are whatever the file page says and are kept per file: public domain (338 files), CC BY-SA 4.0 (316), CC0 (101), CC BY-SA 3.0 (85), CC BY 4.0 (40), smaller CC variants, and issuer permissions that are **not** free licenses: "ECB decisions ECB/2003/4 and ECB/2003/5" (7 euro notes: reproduction allowed as long as it cannot be mistaken for a genuine note), "Use permitted by the BOI, Currency Department" (Israel), "South Korean currency", "GODL-India", "Copyrighted free use". The script filters nothing by license; the card shows `license` and `artist` from the file and links the file page, where the full terms are.

### When

On demand; the output is **committed** (`public/data/money.json`, about 250 KB, capped at 600 KB: the script drops `credit` first, then lowers the per-currency caps). Re-run a couple of times a year or when a new series is issued, with `rm -r data/cache/commons` first for fresh search results (the Wikidata cache can stay), and commit.

### Output

`public/data/money.json`:

```json
{
  "built": "2026-10-20",
  "source": "Wikidata (CC0), Wikimedia Commons (per-file licenses)",
  "attribution": { "data": "…", "images": "…" },
  "notes": "how the lists were built, one paragraph",
  "currencies": {
    "BRL": {
      "name": { "es": "real brasileño", "en": "Brazilian real" },
      "issuer": { "es": "Banco Central de Brasil", "en": "Central Bank of Brazil", "qid": "Q806186" },
      "qid": "Q173117",
      "image": "Novas cedulas real thumb11-450x309.jpg",
      "categories": { "banknotes": "Banknotes of Brazilian real", "coins": "Coins of Brazilian real" },
      "banknotes": [
        { "file": "200 Brazil real Second Obverse.jpg", "denomination": "200", "w": 573, "h": 262,
          "license": "Public domain", "artist": "Central Bank of Brazil", "credit": "\" Cédula de 200 Reais \", Central Bank of Brazil",
          "attributionRequired": false, "series": "2", "side": "obverse" }
      ],
      "coins": [
        { "file": "25 Centavos (2021) - Vorderseite.jpg", "denomination": "25 (subunit)", "w": 1857, "h": 1883,
          "license": "Public domain", "artist": "…", "credit": "…", "attributionRequired": false, "year": 2021, "side": "obverse" }
      ]
    }
  }
}
```

- `name`, `issuer`, `qid`, `image` are from Wikidata and `null` when missing (`name` is Wikidata's label as it stands: Q4730 is labelled "peso", not "Mexican peso"; fix it at the source). `image` is the item's P18, a Commons file name, the card's fallback when the lists are empty (126 currencies have one). `note` appears only on the 9 codes without a Wikidata item.
- `categories` names the Commons category each list was built from (`null` when none was found), so a wrong gallery can be traced.
- Per file: `file` is the Commons **file name** (no `File:`), `denomination` the face value as a string (`"25 (subunit)"` for cents, centavos, piastres…; `null` when not detected), `w`/`h` the pixel size, `license` the file's short license name, `artist` and `credit` as plain text clipped to 60 characters (`null` when missing), `attributionRequired` a boolean or `null`; `year`, `series` and `side` (`"obverse"`/`"reverse"`) appear only when the title states them.
- Thumbnail: `https://commons.wikimedia.org/wiki/Special:FilePath/<encodeURIComponent(file)>?width=800`; file page for the credit: `https://commons.wikimedia.org/wiki/File:<file>`.

Counts on 2026-10-20: 162 codes; 112 currencies with at least one banknote, 69 with four or more, 35 with the full eight; 115 with at least one coin, 28 with six; 551 banknote files and 394 coin files, 473 of them obverse, 414 dated in the title and 316 of those 2000 or later. 22 codes have nothing: the 9 non-ISO codes, and AOA AWG BMD FKP GIP KYD LSL MZN PYG SHP STN SZL ZMW, whose Commons categories hold nothing that passes (copyrighted notes, tiny files, or only dealer scans of colonial issues). 50 currencies have no banknote; 28 of them do have coins, among them DKK, NZD, COP, VND, ZAR, ISK, CUP and DOP, for which Commons holds only 19th-century private bank notes, correctly scored out.

### Attribution rules

- Wikidata is CC0; say "Datos: Wikidata" and link `https://www.wikidata.org/wiki/<qid>`.
- Every image links its Commons file page and shows `license` and `artist` as given. The ECB, Bank of Israel, Bank of Korea and Indian government permissions are not free licenses: show them verbatim, never relabel them "public domain". Banknote designs belong to their issuers; we show photographs and scans as Commons hosts them and host nothing ourselves.
- Never crop out a "SPECIMEN" overprint or a watermark; never present a note as current unless `year` or `series` in the data says so.

### Run locally

```sh
npm run money                                  # ~30 s from the cache; 16 min and 1,900 requests from empty
MONEY_ONLY=MXN,JPY,EUR npm run money           # a few codes
MONEY_ONLY=KRW MONEY_DEBUG=1 npm run money     # prints roots, denomination categories and the top 20 scored titles
rm -r data/cache/commons                       # fresh search results (the refresh)
```

On Windows PowerShell: `$env:MONEY_ONLY = "MXN,JPY"; npm run money`. Check the console summary, then open `public/data/money.json` and look at `USD`, `EUR`, `JPY`, `BRL` (should read as today's notes) and `MXN` (older issues, by Commons' limits, not ours). Commit the file.

## Admin boundaries

### What runs

`npm run admin` → `node tools/build-admin.mjs --country=MX` (MX is the default; pass another ISO 3166-1 alpha-2 code to build another country). Source: [geoBoundaries](https://www.geoboundaries.org), the gbOpen release, through its API: `https://www.geoboundaries.org/api/current/gbOpen/<ISO3>/<ADM1|ADM2>/` (ISO3 comes from `facts.json`). The answer is JSON; the script reads `simplifiedGeometryGeoJSON` (falling back to `gjDownloadURL`) and the metadata (`boundarySource`, `boundaryLicense`, `boundaryYearRepresented`, `buildDate`). Both the API answers and the GeoJSON files are cached in `data/cache/admin/` (gitignored; Mexico: 4 MB for ADM1, 17 MB for ADM2). `ADMIN_FRESH=1 npm run admin` re-downloads (`$env:ADMIN_FRESH = "1"; npm run admin` on PowerShell).

geoBoundaries republishes one official or UN/World Bank layer per country and level, and **each layer carries its own license**, returned by the API. For Mexico: ADM1 (32 states, 2020) is INEGI via HDX under **CC BY 3.0 IGO**; ADM2 (2,457 municipalities, 2012) is the World Bank's "Mexico municipalities 2012" under **CC BY 4.0**. geoBoundaries asks to be cited (Runfola et al. 2020, PLoS ONE 15(4): e0231866). The credit line for the UI is **"geoBoundaries, CC BY 4.0"**, linking `https://www.geoboundaries.org`; `index.json` keeps the per-layer license and the source URL so a longer credit can be shown on demand.

### Simplification (and why it is for display only)

The "simplified" files geoBoundaries serves are still far too big for a static site (Mexico ADM1 would be 1.5 MB at 3 decimals, ADM2 6.7 MB), so the script simplifies again, without dependencies:

1. Coordinates are quantized to 3 decimals (about 100 m).
2. Every vertex is classified: a point with three or more distinct neighbors across all rings is a **junction**; the others are interior arc points. Rings are cut into arcs at the junctions, and an arc shared by two neighbors is stored once (Mexico ADM1: 87,689 vertices become 66,595 points, 1,386 arcs, 246 junctions; ADM2: 364,465 vertices, 7,969 arcs, 5,071 junctions).
3. Each arc is simplified once with **Visvalingam-Whyatt** (effective triangle area in km², endpoints pinned), so two states or two municipalities keep exactly the same border: 4,863 ADM1 edges are shared by two states and none is duplicated.
4. The tolerance is found by bisection on the serialized size against a byte target (ADM1 290 KB; ADM2 1.15 MB for a single file, otherwise 150 KB or 400 bytes per municipality per state, whichever is more).
5. Islands shrink to triangles before they vanish; rings smaller than three times the tolerance (and degenerate rings) are dropped unless they are the feature's biggest.

The result is a **display layer**: fine for a country or state focus view, where the viewer sees a few hundred metres of error at most. It is not for measuring area or length, for counting what falls inside a boundary at the edge, or for any legal question; the geoBoundaries source files (and INEGI's Marco Geoestadístico) are. Mexico's ADM2 is the **2012** municipal map: the municipalities created since (several in Chiapas and Quintana Roo, among others) are not in it, and the dossier must not pretend otherwise.

Exterior rings are rewound to d3-geo's convention (clockwise exterior, as d3 reads the sphere) before any `geoContains`, both when assigning parents and in the output, so the app can call `geoContains(feature.geometry, [lon, lat])` directly.

### Output

`public/data/admin/`, **committed**:

```
index.json            what exists: countries, levels, counts, bytes, tolerance, source, license, build date
mx-adm1.json          FeatureCollection, 32 states, 289 KB
mx/<adm1-id>.json     one FeatureCollection of municipalities per state (32 files, 3.6 MB in all, 16 KB to 228 KB each)
```

ADM1 properties: `{ "id": "mx-jal", "name": "Jalisco", "code": "MX-JAL" }`, plus `official` when the constitutional name is longer (`"Coahuila de Zaragoza"`, `"Michoacán de Ocampo"`, `"Veracruz de Ignacio de la Llave"`; `"México"` for `Estado de México`). `id` is `<iso2>-<ISO 3166-2 suffix in lowercase>`; `code` the ISO 3166-2 code. geoBoundaries' Mexico names are ASCII (`Yucatan`, `Nuevo Leon`) and it codes both "Distrito Federal" and "Mexico" as `MX-MEX`, so `tools/build-admin.mjs` carries a table of the 32 states with Spanish names and codes (`MX-CMX` for Ciudad de México); for another country, the source's `shapeName` and `shapeISO` are used as they stand, with a slug when there is no code.

ADM2 properties: `{ "id": "mx-jal-guadalajara", "name": "Guadalajara", "parent": "mx-jal" }`. `parent` is found by **point-in-polygon of the municipality's spherical centroid against the ADM1 shapes** (d3-geo `geoContains`, after a bounding-box prefilter); when the centroid falls outside every state (a crescent, an archipelago) forty vertices vote instead. `id` is `<parent>-<slug of the name>`, with `-2`, `-3` for repeats inside a state. The source has no municipal codes (INEGI's `CVEGEO` is not in the layer), so there is no `code`. Names come with their accents from the source (`Jesús María`, `Mérida`).

A single national ADM2 file would need a tolerance of 5.9 km² to fit 1.2 MB and would keep 12% of the vertices, so the script splits by state whenever a single file would keep less than 40%: the app loads `mx/<adm1-id>.json` when a state is in focus. The split files are filtered from the national topology, so municipalities across a state line still share their border.

`index.json`:

```json
{
  "built": "2026-10-20",
  "source": "geoBoundaries (gbOpen), https://www.geoboundaries.org",
  "credit": "geoBoundaries, CC BY 4.0",
  "citation": "Runfola D, et al. (2020) ...",
  "note": "Simplified for display ... Not for area, length or legal questions.",
  "countries": {
    "MX": {
      "iso3": "MEX",
      "levels": {
        "adm1": { "file": "mx-adm1.json", "count": 32, "bytes": 289387, "toleranceKm2": 1.108,
                  "year": "2020", "source": "Instituto Nacional de Estadística y Geografía (INEGI)",
                  "license": "Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO)",
                  "sourceUrl": "data.humdata.org/dataset/...", "api": "https://www.geoboundaries.org/api/current/gbOpen/MEX/ADM1/", "gbBuild": "Feb 21, 2024" },
        "adm2": { "split": "adm1", "dir": "mx/", "count": 2457, "bytes": 3615496, "toleranceKm2": 2.695,
                  "year": "2012", "source": "World Bank", "license": "Creative Commons Attribution 4.0 (CC BY 4.0)", "...": "...",
                  "files": { "mx-jal": { "file": "mx/mx-jal.json", "count": 125, "bytes": 149000, "toleranceKm2": 0.675 }, "...": {} } }
      }
    }
  }
}
```

When a single ADM2 file fits, `adm2` has `file` instead of `split`/`dir`/`files`. Running the script for another country merges that country into `index.json` and leaves the others alone.

### Checks (Mexico, 2026-10-20)

- ADM1: 32 features, 32 distinct ISO codes, names `Aguascalientes … Zacatecas` with accents; no polygon larger than a hemisphere (winding).
- ADM2: 2,457 features across 32 files, every one with a parent; per state: Oaxaca 569, Puebla 217, Veracruz 212, Jalisco 125, Estado de México 125, Chiapas 118, Michoacán 112, Yucatán 106, Hidalgo 84, Guerrero 83, Sonora 72, Chihuahua 67, Tlaxcala 60, San Luis Potosí 58, Zacatecas 58, Nuevo León 51, Guanajuato 46, Tamaulipas 43, Durango 39, Coahuila 38, Morelos 33, Nayarit 20, Querétaro 18, Sinaloa 18, Tabasco 17, Ciudad de México 16, Aguascalientes 11, Campeche 11, Colima 10, Quintana Roo 10, Baja California 5, Baja California Sur 5.
- Point tests on the written files: Guadalajara (20.67, −103.35) → Jalisco / Guadalajara; Mérida (20.97, −89.62) → Yucatán / Mérida; the Zócalo → Ciudad de México / Cuauhtémoc; Monterrey → Nuevo León / Monterrey; Tijuana → Baja California / Tijuana.

### Another country

`npm run admin -- --country=JP`. The script needs the country in `facts.json` (for ISO3), fetches `ADM1` and `ADM2` (ADM2 is optional: a country without one gets only `<iso2>-adm1.json`), and uses geoBoundaries' names and `shapeISO` codes as they come. Look at the console: the license line per level (add it to the credit if it is not CC BY), the per-state counts, and any "without a parent" warning. Add a name table like `MX_STATES` only when the source's names are ASCII or its codes are wrong, as Mexico's were. Commit `public/data/admin/`.
