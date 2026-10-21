# Current banknotes and coins: what exists, what is allowed, what to do

Research note, 2026-10-20. No code was changed. Everything below was checked on
that date with the Commons/MediaWiki API, direct HTTP requests (headers only,
no image downloads) and the pages cited. Where I could not reach a source, it
says so.

## TL;DR

- Commons has **no Familia F or Familia G Mexican banknote**. The tree under
  `Category:Banknotes of Mexico` is 36 files, all pre-1920 except five
  security-feature diagrams and a 1969-era 1-peso note. The 2009 Familia F
  commemoratives exist only as two tiny Banxico-credited diagrams.
- Commons has **one current Mexican coin as a cut-out**: `File:1peso 2025.png`
  (CC0, 539×540, PNG with alpha, uploaded 2026-03). Plus one good two-sided
  photo of the 1-peso coin on black (`File:Moneda 1 Peso Mexicano A741300.jpg`,
  CC BY-SA 4.0, 5492×3414) and one CC0 scene of 10-peso coins. Nothing for
  2, 5, 20 pesos or the centavos.
- English Wikipedia's "Mexican peso" article shows the current notes and coins
  through ~95 **local fair-use files** (57–202 px, tagged "Fair use"). They
  cannot be reused. Spanish Wikipedia has nothing current.
- Banco de México offers **no image kit, no API, no licence**. Its catalogue
  pages serve thumbnails only: notes 159–202 px wide, coins 63–142 px. Article
  17 of the Ley Monetaria prohibits any reproduction of notes or coins unless
  the SHCP, after hearing Banxico, authorises it expressly. The gob.mx
  procedure page (SHCP1334) now redirects to the portal home.
- Pattern elsewhere: ECB, Bank of England and the US give blanket consent
  under conditions (specimen marking, size, one side); Bank of Japan asks for
  prior permission for any image; Banco Central do Brasil publishes no policy
  I could find (Commons records VRT-confirmed conditions: "SEM VALOR" diagonal,
  72 dpi).
- No free image-search API exists: Google Custom Search JSON API is closed to
  new customers and shuts down 2027-01-01; Bing Search APIs were retired
  2025-08-11. Both are out anyway: a search result is not a licence.
- Recommendation: for Mexico keep the Commons card (option c) and add an
  official **link-out tile** to Banxico's per-denomination pages (option b)
  now; write to SHCP/Banxico for an educational authorisation and hi-res art
  in parallel. Build the per-bank override downloader (option a) only for
  issuers with written blanket consent: ECB, Bank of England, US (uscurrency.gov).

---

## 1. What Commons holds for the Mexican peso today

### 1.1 Category tree

`Category:Money of Mexico` → `Banknotes of Mexico`, `Coins of Mexico`,
`Mexican real`, `Numismatics in Mexico`. `Category:Mexican peso` exists but is
empty (0 files, 0 subcats).

`Category:Banknotes of Mexico` (36 files) has four subcats: *Banknotes of the
Mexican Revolution*, *Banknotes of Mexico Bicentennial* (2 files), *Local
banknotes of Mexico*, *Banknotes of Yucatán*. There is **no series or
denomination subcategory** (no "Familia G", no "500 peso banknotes of Mexico").

`Category:Coins of Mexico` (342 files) has twelve subcats, all historical or
non-circulating: *Countermarked*, *Bullion*, *Gallica*, *Gold coins*, *Náprstek
Museum*, *Mint of Mexico*, *on postcards*, *Silver coins*, *Stamp impression*,
*Token coins*, *Coins of Yucatán*, *Coins of Zacatecas*. Again no "by
denomination" or "by year" tree.

### 1.2 Every file that is, or claims to be, current (2009–present)

Banknotes (Familia F 2006–2017, Familia G 2018–2021):

| File | What it is | Size | Licence on the page | Verdict |
|---|---|---|---|---|
| `Seguridad100.jpg`, `Seguridad200.jpg` | Security-feature diagrams of the 2010 Bicentennial commemorative 100 and 200 (Familia F) | 372×177, 229×323 | CC BY-SA 4.0, artist "Banco de México", *Items with VRTS permission confirmed* | Genuine permission on record, but diagrams, not notes, and far below 600 px |
| `Hilo dinámico. Bilete de 200 pesos.gif` | Animation of the dynamic thread on the 200 G | 224×168 GIF | CC BY-SA 4.0, artist "Banco de México", credit = a banxico.org.mx URL, uploader `Guanajuatensecajeteroxd`, no VRT | **Mis-licensed**: the uploader cannot CC-license Banxico's work. Exclude |
| `Partes de los billetes D1.jpg`, `Partes de los billetes F.jpg` | 2009 "own work" diagrams labelling the parts of a D1 and an F note | 853×358 | CC BY 3.0 / GFDL, self-published | Derivative of Banxico artwork presented as own work; **doubtful**. Exclude |
| `Series D1-F intaglio (100/200/500).svg`, `Series F intaglio (1000).svg` | Tactile marks for the blind, drawn from Banxico's accessibility page | 50–70 px SVG | PD-shape | Not a banknote image |
| `1 MX Peso bill Obverse.jpg` / `reverse.jpg` | 1969–70 "AA series" 1-peso note | 3944×1728 | CC BY-SA 4.0 "own work" | Historic (old peso); the scan is fine as history, not current |

Nothing else. Full-text searches on Commons for "familia G", "Familia G
Banxico", "Nezahualcóyotl 100 pesos billete", "500 pesos Benito Juárez
2018", "1000 pesos Madero Carmen Serdán", "200 pesos Hidalgo Morelos 2019",
"billete 50 pesos ajolote", "20 pesos 2021 independencia" and "Mexican peso
banknote polymer" return **0 relevant files** (the hits are PDFs of novels and
EU Official Journals).

Coins (C/D types in circulation since 1992/2009, 20-peso C1):

| File | What it is | Size | Licence | Verdict |
|---|---|---|---|---|
| `1peso 2025.png` | Obverse (value side) of the current 1-peso coin dated 2025, cut out | 539×540, PNG `truecolour-alpha` | CC0, uploader `GoVargasV`, 2026-03-25, in *Coins of Mexico* | **Usable circle today**. Only one side, one denomination |
| `Peso 2025.png` | Same coin, smaller | 150×150, PNG no alpha, uncategorised | CC0 | Too small |
| `Moneda 1 Peso Mexicano A741300.jpg` | Both sides of a 2017 1-peso coin on black | 5492×3414 | CC BY-SA 4.0, 2026-02 | Croppable to two clean circles (black, not transparent) |
| `Coins of Mexico.jpg` | A pile of bimetallic 10-peso coins on a tray | 3002×1296 | CC0, 2024 | Scene, not a cut-out |
| `Monedas en la mano.JPG`, `Monedas en México.jpg` (2009), `Pesos mexicanos.jpg` (2006), `Money for tips.jpg` | Hands and heaps | large | CC BY / BY-SA | Scenes; some pre-2009 |

Searches for "moneda 10 pesos México bimetálica", "moneda 20 pesos
dodecagonal", "moneda 50 centavos México", "moneda 5 pesos México",
`deepcategory:"Coins of Mexico" 2020`, and a year-OR list 2010–2025 inside the
coin tree return only pre-1930 pieces, Libertad bullion and the files above.

Transparent PNGs: `deepcategory:"Money of Mexico" filemime:image/png` gives
139 files; apart from `1peso 2025.png` every one is a historic 8 reales / 1
peso (1771–1921), e.g. `Mexico Carlos III Pillar Dollar of 8 Reales 1771 (obv)
transparent background.png`. Good for a "then" strip, useless for "now".

### 1.3 Wikipedia and Wikidata

- en.wikipedia "Mexican peso": 100 images; ~95 are `File:Banco de México
  <series> $<n> obverse/reverse.png` hosted **locally on en.wiki**, licence
  "Fair use", 57–202 px (G $1000 is 202×86). These are the F and G notes and
  the AA–D coins. Fair-use files cannot be copied anywhere, by Wikipedia's own
  policy and by law. The five Commons-hosted images in the article are all
  historic.
- es.wikipedia "Peso mexicano" (no fair use on es.wiki): only Commons files,
  all historic, plus `Mxn currency.png`, which is a text logo "MX$".
- Wikidata `Q4730` (Mexican peso) `P18` is `Counterfeit Pesos (San Ysidro)
  (8652511989).jpg`. `build-money.mjs` stores that as `image`; it should never
  be shown as "the peso".
- Wikidata coin items for Mexico: Libertad, Centenario, 2010 Revolution
  commemorative. No items for the circulating C/D coins.

### 1.4 Why

Banxico keeps the rights and never released the designs; Commons deletes
non-free currency (see `Commons:Currency`). The only Banxico-credited files
with a real permission ticket are the two 2010 diagrams, obtained one-off by
a user.

---

## 2. Banco de México's own terms

### 2.1 The law (Ley Monetaria de los Estados Unidos Mexicanos, Cámara de Diputados PDF, last reform DOF 19-01-2026)

> **Artículo 17.-** Queda prohibida la imitación o reproducción total o
> parcial, de monedas metálicas o de billetes, nacionales o extranjeros, en
> rótulos, viñetas, anuncios o en cualquiera otra forma, salvo en aquellos
> casos en que la Secretaría de Hacienda y Crédito Público, oyendo previamente
> al Banco de México, lo autorice expresamente, por tratarse de imágenes de
> monedas que carezcan de idoneidad para engañar, que no conduzcan o puedan
> conducir a la falsificación de dichas piezas ni, en general, afecten la
> seguridad de la circulación monetaria.
>
> Queda igualmente prohibida la comercialización de reproducciones o
> imitaciones no autorizadas.
>
> Las personas que contravengan lo dispuesto en este artículo, serán
> sancionadas administrativamente por la Secretaría de Hacienda y Crédito
> Público, con multa hasta de un millón de pesos. [...]
> *(Artículo derogado DOF 22-03-1933. Adicionado DOF 07-01-1980)*

Note the wording covers **coins and banknotes**, "en cualquiera otra forma"
(so a web page), and makes authorisation the rule, not the exception. There is
no educational or informational carve-out in the statute.

Source: https://www.diputados.gob.mx/LeyesBiblio/pdf/LMEUM.pdf (page 5).

### 2.2 Banxico's page "Use of banknotes and coins images"

https://www.banxico.org.mx/regulations-and-supervision/use-of-banknotes-and-coins-im.html
(verbatim, English version; the Spanish slug
`/marco-normativo/uso-imagenes-billetes-monedas-.html` now 302s to
`anterior.banxico.org.mx` and 404s):

> As established by Article 17 of Mexico's monetary law, the total or partial
> imitation or reproduction of metal coins or banknotes, domestic or foreign,
> in labels, drawings, advertisements or in any other form is prohibited except
> in those cases in which the Ministry of Finance and Public Credit, in
> agreement with Banco of México, authorizes it specifically. In the latter
> case, the images cannot have an appearance suitable for misleading, cannot
> lead to counterfeiting nor, in general, can they affect the safety of
> currency circulation.
>
> To request the corresponding authorization, please contact:
> MINISTRY OF FINANCE AND PUBLIC CREDIT, Unidad de Banca Valores y Ahorro,
> 1971 Insurgentes Sur, Tower 3, 5th floor, Guadalupe Inn, Álvaro Obregón,
> Postal Code 01020, México City. Telephone: +52(55) 3688 1996

The page links the gob.mx procedure
`http://www.gob.mx/tramites/ficha/autorizacion-para-la-reproduccion-de-billetes-o-monedas/SHCP1334`.
On 2026-10-20 that URL (and a gob.mx trámite search) redirects to the gob.mx
home page: the ficha is gone or renamed. No "fines educativos/informativos"
wording, no specimen rule, no size rule appears on Banxico's own page.

### 2.3 The CBCDG "Rules for use" page for MXN (written with Banxico)

https://rulesforuse.org/en/currency/mxn/ , run by the Central Bank Counterfeit
Deterrence Group (37 central banks). It restates Article 17 and adds the only
concrete criteria I found anywhere:

- Printed media: "A banknote may be reproduced if the reproductions are
  smaller than 75% or larger than 125% of the original banknote." Applicants
  "are usually asked to make the size differ by at least 25%"; partial,
  low-resolution images preferred; nothing that "constitutes or promotes
  counterfeiting".
- Electronic media: "Low resolution images are preferred, but there are no
  specific limitations."
- Contacts at Banxico: Guilmar Ernesto Moncayo Ponce (Process Reengineering
  and Development Division, gmoncayop@banxico.org.mx, +52 55 5268 8353) and
  Ricardo Trejo Barragán (Currency Counterfeiting Subdivision,
  rtrejo@banxico.org.mx, +52 55 5268 8517), Av. Legaria 691, Col. Irrigación,
  CDMX.

So: there is no self-serve licence. The route is a written request to SHCP
(with Banxico's opinion). The criteria they apply are size ≠ original,
low resolution, no counterfeiting risk.

### 2.4 Does Banxico offer images, an API, hotlinkable files?

Catalogue: https://www.banxico.org.mx/banknotes-and-coins/currently-banknotes-and-coins.html
("Currently manufactured banknotes and coins") lists, with one page each:

- Banknotes (G): 20 (commemorative, bicentennial of Independence), 50, 100,
  200, 500, 1000.
- Coins: 5¢ (C), 10¢ (D), 20¢ (D), 50¢ (D), $1, $2, $5, $10 (C), $20 (C1,
  2026 FIFA World Cup commemoratives, four reverses).

Per-denomination pages (English slugs; Spanish slugs redirect to the retired
`anterior.` host and 404):

| Note | Page | Images (`https://www.banxico.org.mx` + path) | Pixel size |
|---|---|---|---|
| 20 G | `/banknotes-and-coins/20-peso-commemorative-bankn.html` | `/multimedia/20G_anv.png` | 159×86 |
| 50 G | `/banknotes-and-coins/50-peso-banknote-g-circulat.html` | `/multimedia/50G_anv.png`, `/multimedia/50G_rev.png` | 86×165 (vertical) |
| 100 G | `/banknotes-and-coins/100-peso-banknote-g-circula.html` | `/multimedia/100G_anv_ngo.png` | 80×162 (vertical) |
| 200 G | `/banknotes-and-coins/200-peso-banknote-circulati.html` | `/multimedia/200G_anv_web.png` | 171×80 |
| 500 G | `/banknotes-and-coins/500-peso-banknote-circulation001.html` | `/multimedia/bill500G_Anv.png`, `/multimedia/bill500G_Rev.png` | 180×80 |
| 1000 G | `/banknotes-and-coins/pagina-banknotes-and-coins00001.html` | `/multimedia/1000G_anv_ngo.png`, `/multimedia/1000G_rev_ngo.png` | 202×86 |
| $10 coin | `/banknotes-and-coins/10-peso-coins-circulation-ban.html` | `/multimedia/C_mon_10_pesosAnv.png`, `C_mon_10_resumen.png` | 142×142 |
| $1 coin | `/banknotes-and-coins/1-peso-coin-circulation-banco.html` | `/multimedia/C_mon_1_resumen.png` | 63×63 |
| 10¢ coin | `/banknotes-and-coins/10-centavo-coin-circulation-b.html` | `/multimedia/C_mon_010.png` | 88×88 |
| $20 C1 | `/banknotes-and-coins/20-peso-current-coin-belong.html` | `/multimedia/mon20C1_FIFA-*_rev.PNG`, `anvComunFIFA_mon20C1.PNG` | not measured |

(Only the 50, 500, 1000, $10 and $20 pages were opened; the 20/100/200
anversos come from the index page; reverse file names for 20/100/200 are
unverified.)

HTTP behaviour of `/multimedia/*.png` (HEAD and 1-byte GET):

- `200 OK`, `Content-Type: image/png`, served identically to a Chrome UA, a
  bare `node` UA and curl's default UA; no `Referer` check (tested with
  `Origin`/`Referer: https://vdm285.github.io`).
- **No `Access-Control-Allow-Origin` header** → a plain `<img src>` hotlink
  works, but `fetch()`/canvas from the GitHub Pages origin would be blocked.
- `Last-Modified: 26 Feb 2020`; `Content-Length` 34,695 B (500 G) / 45,979 B
  (10¢ coin). These are thumbnails. The 1000 G at 202×86 is the largest.
- The section root `https://www.banxico.org.mx/billetes-y-monedas/` returns
  **403** to curl and to the built-in browser; the site returns **406** to a
  client without an `Accept: text/html` header. GitHub Actions `fetch` would
  need browser-ish headers for the HTML pages (the PNGs do not care).

There is no download section, no zip, no API, no PDF poster that I could
find on banxico.org.mx (a search for "cartel", "material descargable",
"alta resolución" turned up only press coverage). The images are also
smaller than `MIN_WIDTH_CURRENT` (560) by a factor of three, so even with
permission they would not pass `build-money.mjs` as written; they would need
to be a separate, explicitly tiny "official thumbnail" tile.

---

## 3. Other central banks: the general pattern

| Issuer | Consent model | Key conditions | Images offered | Fetch test (headers) |
|---|---|---|---|---|
| **ECB (euro)** https://www.ecb.europa.eu/euro/banknotes/images/html/index.en.html | Blanket: "You are free to download low-resolution (72 dpi) images of euro banknotes marked with the word 'specimen'." No written permission issued; compliance is on the user (Decision ECB/2013/10 as amended by 2020/2090). | Digital: "specimen" diagonal, bold Arial, ≥75% of length, ≥15% of width, contrasting colour; ≤72 dpi at 100% size. Design elements not on a banknote-like background. Copyright © ECB. | `/euro/shared/img/Banknotes ES1 Specimen 72dpi.zip` and `... ES2 Specimen 72dpi.zip` (72 dpi, pre-marked). 300 dpi TIFF only for professional physical reproduction, with a confidentiality declaration. | zip: `200`, `application/zip`, no CORS header. Commons also hosts the Europa series under `{{Money-EU}}` (218 files; e.g. `The Europa series 50 € obverse side.png`, 588×322, from the ECB Flickr). |
| **Bank of England** https://www.bankofengland.co.uk/banknotes/using-images-of-banknotes | Blanket: "we give consent to reproduce... if you comply with [the] conditions, and you don't need to contact us for permission." Copyright is the Bank's; some elements licensed from third parties. | Digital reproductions: no offensive context; no distortion of the monarch; and either SPECIMEN overprint when >50% of one side is shown (unless slanted >20°) or <50% shown. One-sided and 25% size rules apply to physical only. No novelty versions. | "Current banknotes image library" on Flickr: https://www.flickr.com/photos/bankofengland/albums/72157662787666013 (titles like "King Charles III £5 note - front", "£50 front - polymer"; Download button present; licence label not readable without JS). | not tested (Flickr). |
| **Federal Reserve / BEP (USD)** https://www.bep.gov/currency/currency-image-use , https://www.uscurrency.gov/media/multimedia-library | Public domain as US Government work; counterfeiting law still applies. 18 U.S.C. §504 / 31 CFR 411: colour illustrations allowed if one-sided, size <¾ or >1½ linear, and files "destroyed and/or deleted or erased after their final use". §475 bans currency look-alikes in advertising. | One side; size rule (moot on screen but keep one side). | uscurrency.gov multimedia library: per-file licence lines, "Public Domain (U.S. Currency Education Program)" or "CC BY-SA 4.0 (Bureau of Engraving and Printing)", e.g. `/sites/default/files/media/images/100-front-2013-present.jpg`. Commons: `{{PD-USGov-money}}`, full set of current notes. | `200`, `image/jpeg`, 220,638 B, no CORS header. |
| **Bank of Japan (JPY)** https://www.boj.or.jp/en/about/copyright.htm | Permission required for images: site content may be copied with credit "with the exceptions below", and the exceptions include "the copying or reproduction of graphics, illustrations, or other image data" and commercial use → "please contact the Public Relations Department (post.prd8@boj.or.jp) in advance". CBCDG JPY page: rules are the Ministry of Finance's (Japanese only); contact post.cid1@boj.or.jp. | Not published in English; counterfeiting law. BoJ does not provide hi-res images. | `/en/note_tfjgs/note/valid/img/f10000f.png` etc. (14 files on the "valid notes" page), footer "Copyright Bank of Japan All Rights Reserved". | `200`, `image/png`, 98,897 B, no CORS header. Commons hosts user photos of the 2024 series (e.g. `Series F 10K Yen Bank of Japan note - obverse.jpg`, CC BY-SA 4.0, with the `Restrictions: currency` flag). |
| **Banco Central do Brasil (BRL)** | **No public policy page found.** bcb.gov.br is an Angular SPA (WebFetch returns only the title; the built-in browser could not open it in this session). Searches on "uso de imagens de cédulas", "reprodução", FAQ Meio Circulante gave nothing official. | Commons `{{Money-BR}}` (VRT ticket on record): Brazilian money belongs to the Union; misleading reproductions punishable (Lei 9.279/1996 art. 191). Terms recorded on the tag: "SEM VALOR" diagonally, ≥20% of the image; max 72 dpi. | Official pictures of the Segunda Família are on the "Cédulas e moedas" section (per BCB notice on the R$200); Commons has `Money-BR` files (e.g. `200 Brazil real Second Obverse.jpg`). | not tested (SPA). |
| **Banxico (MXN)** | Authorisation by SHCP per Art. 17, case by case. | Size ≠ original (±25%), low resolution, nothing counterfeitable. | Thumbnails only (≤202 px). | `200`, `image/png`, no CORS, no referer check. |

Takeaway: the issuers that publish a **blanket, written consent with
objective conditions** are the ECB, the Bank of England and the US. Those
three can be handled by a per-issuer override with a build-time download and
a credit line. Japan and Mexico are "ask first"; Brazil is "no published
rule, Commons-recorded conditions".

---

## 4. Third-party catalogues

- **Numista** (Terms of Use, version 3 January 2023,
  https://en.numista.com/conditions.php , §12): photographs are either the
  collector's own ("may indicate their name in the credit line") or come
  "from NUMISTA's partners who authorise the Collector to reuse said
  photographs free of charge **on the Platform**". §12.2 forbids "Reproduction,
  extraction or reuse, by any means, including methods similar to scrapping of
  content (photographs, descriptions, etc.) published by the Operator or by a
  Collector." Each photo belongs to its contributor; some are CC (rare); the
  API licence covers data, not pictures (a licence field was documented but
  never returned, per staff on the forum). **Not reusable** without per-photo
  permission.
- **Colnect**: terms page sits behind an Anubis anti-scraping challenge.
  Images are community-uploaded with no source tracking; Numista explicitly
  refuses Colnect pictures "to avoid issues with copyrights". **Unknown
  rights, treat as all-rights-reserved.**
- **Banknote World, Leftover Currency**: commercial shops; both return 403 to
  non-browser fetchers, so I could not read their terms. Product photos are
  the shops' own copyrighted work by default. **Not reusable.**
- **English Wikipedia "Mexican peso"**: verified above, ~95 local fair-use
  files. Wikipedia's non-free policy allows them only inside that article;
  reuse is a copyright violation. **Not reusable.**
- **Spanish Wikipedia**: nothing current (es.wiki has no fair use).

---

## 5. Image search APIs

- **Google Custom Search JSON API** (developers.google.com/custom-search/v1/overview,
  read 2026-10-20): "The Custom Search JSON API is closed to new customers.
  Existing Custom Search JSON API customers have until January 1, 2027 to
  transition to an alternative solution." Pricing (existing customers only):
  100 queries/day free, then $5 per 1,000, max 10k/day. The Terms also say the
  API "may be provided to you without any free usage quota".
- **Bing Image Search API**: Microsoft retired the public Bing Search and Bing
  Custom Search APIs on 11 August 2025 (learn.microsoft.com/bing/search-apis);
  the SharePoint Bing image picker was removed in March–April 2026. The
  pointed-to replacement, "Grounding with Bing Search" in Azure AI Foundry, is
  paid and returns web grounding, not image rights.
- **SerpApi / Apify scrapers**: paid (SerpApi advertises a 250-search/month
  free tier), ToS-grey, and irrelevant: a search hit is not a licence, so
  every image would still need its own clearance.

Conclusion: no image-search route is compatible with "zero recurring cost"
and "genuine, credited content". Even if it were free, it would not solve the
rights problem.

---

## 6. Options and recommendation

### (a) Per-issuer override + build-time download

`data/overrides/money.json` keyed by ISO 4217 code, each entry naming the
issuer's consent page, the image URLs (or a Commons file list), whether a
SPECIMEN overlay is required, and a credit line. A new `tools/build-money-official.mjs`
step downloads into `public/data/money/<ISO>/`, applies the overlay where
needed (sharp or node-canvas, a new dev dependency; or use images the issuer
already marked), writes `w/h/credit/licence` into `money.json`, and the card
shows "Imagen oficial del <banco>, reproducida conforme a <condiciones>"
with the link.

- Effort: 2–3 days (schema, downloader with cache under `data/cache/`, overlay,
  card copy in es/en, a test that every override has a consent URL, and the
  commit rule: downloaded images are deploy-time files, not committed, like
  `news/`).
- Legal risk by issuer: ECB **low** (pre-marked 72 dpi specimen zip; respect
  ≤72 dpi); Bank of England **low** if the SPECIMEN overprint is applied
  (>50% of one side shown) and the monarch is not distorted; US **low**
  (public domain; show one side; delete build artefacts after use, which a
  stateless Actions runner does anyway); Japan **not allowed** without a
  reply from BoJ PR; Brazil **medium** (no published policy; the Commons
  `Money-BR` conditions, SEM VALOR + 72 dpi, are the only recorded terms);
  **Mexico: not allowed** without an SHCP authorisation, and the only files
  are ≤202 px thumbnails.

### (b) Link-out tiles to the official catalogue

For issuers without consent, the banknote slideshow shows the Commons
historic strip as now, and one extra tile: the issuer's own catalogue page per
denomination (for Mexico the six Banxico pages above, grouped as one "Billetes
actuales (Familia G) · Banco de México" tile, each denomination a link). No
image is copied. Optionally the Banxico thumbnail is embedded as a plain
`<img src>` hotlink (it works: 200, no referer check, no CORS needed for
`<img>`), but that is still a "reproduction" in Art. 17's words, so I would
not do it without the letter.

- Effort: half a day (an `official` field in the override file, a tile in
  `sections.js`, es/en copy, a test that every URL answers 200 at build).
- Legal risk: **none**. It is a hyperlink to the central bank.

### (c) Commons only, with the honest note (status quo)

Keep `build-money.mjs`, tighten the filter: drop `Hilo dinámico` GIF and the
two `Partes de los billetes` diagrams (mis-licensed/doubtful), ignore
Wikidata P18 for MXN (a counterfeit photo), and pick up `1peso 2025.png` for
the coin circle (it already sits in `Coins of Mexico` and parses as
denomination 1, year 2025).

- Effort: an hour. Legal risk: none, provided the mis-licensed files are
  excluded.

### What I would do for Mexico

1. **Now:** (c) + (b). The card keeps saying, truthfully, that Commons does
   not have the current notes, shows the 1-peso CC0 circle (the only current
   coin cut-out), and adds the Banxico link-out tile with the six Familia G
   pages and the coin pages. Zero legal exposure, consistent with EDITORIAL.md
   ("money is a scan of a real banknote" stays true for what we show; what we
   cannot show we link).
2. **In parallel:** write to SHCP (Unidad de Banca, Valores y Ahorro) with
   copy to the Banxico contacts on the CBCDG page, asking for authorisation to
   display the Familia G notes and C/D coins on a free educational site, at
   reduced size, one side, with "MUESTRA" or "SIN VALOR" overlay, and ask
   whether they can supply web-resolution art (the public thumbnails are
   ≤202 px). The gob.mx ficha SHCP1334 is gone, so email is the route. If the
   answer is yes, it becomes an `(a)` override with the letter's conditions
   written into the credit line.
3. **Do not** copy the Banxico `/multimedia/*.png` files or the en.wiki
   fair-use files into `public/data/`. Both would breach the rules in
   AGENTS.md and, for Banxico, Art. 17.

### What exactly to download for MXN if authorised

Only the files Banxico serves (all thumbnails), unless they send larger art:

```
https://www.banxico.org.mx/multimedia/20G_anv.png         159×86
https://www.banxico.org.mx/multimedia/50G_anv.png         86×165   (+ 50G_rev.png)
https://www.banxico.org.mx/multimedia/100G_anv_ngo.png    80×162
https://www.banxico.org.mx/multimedia/200G_anv_web.png    171×80
https://www.banxico.org.mx/multimedia/bill500G_Anv.png    180×80   (+ bill500G_Rev.png)
https://www.banxico.org.mx/multimedia/1000G_anv_ngo.png   202×86   (+ 1000G_rev_ngo.png)
coins: C_mon_005_resumen.png, C_mon_010.png (88×88), D_mon_020_resumen.png,
       D_mon_050_resumen.png, C_mon_1_resumen.png (63×63), C_mon_2_resumen.png,
       C_mon_5.png, C_mon_10_pesosAnv.png (142×142), anvComunFIFA_mon20C1.PNG
```

At these sizes they fit a 40-px "official thumbnail" strip, not a slideshow.
The ask to Banxico should therefore include web-resolution (≈600 px wide)
files, one side each, already marked, as the ECB does.

### Start with the issuers who already said yes

If the owner wants a visible win while Mexico is pending, implement (a) for
EUR (ECB zip, already specimen-marked, 72 dpi), USD (uscurrency.gov public
domain files, one side) and GBP (BoE Flickr library with SPECIMEN overlay).
That covers three of the most-looked-at currencies with written consent and
teaches the pipeline before any case-by-case bank is added.

---

## Appendix: queries and endpoints used

- Commons API: `list=categorymembers` on the five Mexican categories;
  `list=search` with `srnamespace=6`, `deepcategory:`, `filemime:image/png`,
  `intext:`; `prop=imageinfo` with `extmetadata` (LicenseShortName, Artist,
  Credit, Restrictions) and PNG `metadata` (colorType) for the two 2025 coin
  files; `prop=revisions` on `Template:Money-BR/i18n`, `Money-EU/en`,
  `PD-USGov-money/en`.
- en/es.wikipedia API: `prop=images` on the peso articles, `prop=imageinfo` to
  split Commons-hosted from local fair-use files.
- Wikidata SPARQL: `wd:Q4730 wdt:P18`, Mexican coin items.
- HTTP HEAD / 1-byte range GET on banxico.org.mx `/multimedia/*.png`,
  ecb.europa.eu zip, boj.or.jp PNG, uscurrency.gov JPG, with `Origin:
  https://vdm285.github.io`.
- Pages read: diputados.gob.mx LMEUM.pdf (p. 5), banxico.org.mx
  use-of-banknotes-and-coins-im.html, currently-banknotes-and-coins.html and
  the 50/500/1000/$10/$20 pages, rulesforuse.org mxn/jpy/usd/index, ECB
  images page, Bank of England "Using images of banknotes", BEP
  currency-image-use, uscurrency.gov multimedia library, BoJ copyright and
  valid-notes pages, Numista conditions.php, Google Custom Search overview,
  Microsoft Bing Search APIs retirement notice.
- Not reachable in this session: bcb.gov.br (SPA), gob.mx ficha SHCP1334
  (redirects home), Colnect terms (anti-bot wall), Banknote World and Leftover
  Currency terms (403), Flickr licence label on the BoE album (needs JS).
