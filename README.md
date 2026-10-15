# Globo Curioso

A globe you can spin. Tap any country, even if you do not know its name, and read where it sits, what people eat, and what Wikipedia says. There is a kid mode, a “where is it?” game, and tours. No account. No ads.

Spanish is the language it opens in. The EN button switches the interface and the articles.

## Try it

```bash
npm install
npm test
npm run dev
```

Open http://localhost:5173 . On a phone, use the address Vite prints under Network.

The static build is `npm run build`. GitHub Pages publishes `main` to `https://vdm285.github.io/interactive-globe/`.

## What a tap shows

- **Facts**, immediately: capital, population (World Bank year when we have one), area, languages, currency, local time, neighbors.
- **Historia, Comida, Cultura**: the Wikipedia introduction, in Spanish or English, with a link back. The texts are CC BY-SA. About 240 countries have a Spanish history extract vendored in `public/data/wiki/`. If a file is missing, the page asks Wikipedia directly.
- **Viajes**: a latitude hint, plus OpenStreetMap, Google Maps and Google Earth. It does not invent a list of sights.
- **Hoy**: Wikipedia’s “on this day” and the day’s news, live. Lines that mention the country come first. Kid mode drops lines about violence.

The light on the Earth is the real sun. Atlas mode is the paper globe. Disputed borders are named in the card. The map itself is Natural Earth’s de facto drawing.

## Data

`npm run data` rebuilds `public/data/facts.json` and the flags from the cached country files in `data/cache/` (gitignored) plus the World Bank population API.

`npm run stories` refetches Wikipedia intros. It is resumable. Send a proper User-Agent; the script already does. Do not hammer the APIs.

## Tests

`npm test` checks the sphere math (east is right, north is up, a drag follows the finger), that Mexico City falls in Mexico, search nicknames, share links, and that kid mode removes violent “today” lines.

## License

Code: MIT. See `LICENSE`.

Country shapes: Natural Earth, public domain, via `world-atlas`.

Earth photographs: NASA Visible Earth (public domain), the Blue Marble and Black Marble plates redistributed with three-globe’s examples.

Wikipedia extracts: CC BY-SA. Credit the linked article if you reuse one.

Population: World Bank indicator `SP.POP.TOTL`, most recent value, with a fallback dataset where the Bank has no row.
