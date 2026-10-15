# Handoff — 2026-10-15

The sketch lived in `vdm285/ideas` at `interactive-globe/` (`sketch.html`, one d3 school globe, four sample cards). This repository is the product. Victor asked for a finished, ambitious version and for pushes he or another agent can continue from. Design calls below were made under that instruction.

## Shipped

- Cinematic Earth (NASA day and night plates, real sun, atmosphere) and an Atlas mode (continent colors, borders via d3-geo).
- Tap, drag, wheel, pinch, keyboard arrows, search with Mexican nicknames (EUA, Holanda, Malvinas, Inglaterra → a note).
- 250 countries with flags, World Bank population where the Bank has a 2025 (or latest) figure, capitals, time zones, neighbors.
- The globe uses Natural Earth 1:50m (`public/data/countries-50m.json`), so Singapore, Malta and the other small states on that file are tappable. Fifteen territories are still only a dot (Bouvet, Tokelau, Tuvalu, and other rocks or overseas scraps the 50m file folds into a parent or omits).
- Wikipedia layers, vendored, as of the fill on 2026-10-15: history 250/250 in Spanish and English; food 241/250; culture 244/250. A missing Spanish food page uses the English article and the card says so. `tools/fill-gaps.mjs` is the resumable filler.
- Hoy is live from Wikipedia’s on-this-day and featured news. Kid mode filters violent lines.
- Quiz, surprise spin, computed tours, compare, share links, home location (default Mexico City, optional geolocation), disputed-border notes.
- PWA shell (`public/sw.js`, manifest). GitHub Pages workflow on `main`.

## Decisions

- Engine is Three.js, not the d3 school globe. Atlas mode keeps the paper-globe option one tap away. The old “school globe only” note in the dossier was set aside because the brief was a world-class visual.
- No news API key. GDELT returned 429. Hoy is Wikipedia, which is free, cited, and fresh each day.
- REST Countries v3 now requires a key. Facts come from `mledoze/countries`, `dr5hn/countries-states-cities-database`, and the World Bank. Those raw downloads stay in `data/cache/` and are gitignored.
- Clouds were dropped. The only small cloud plate on hand was a harsh black-and-white mask and it drew stripes.
- Borders are drawn in Atlas only. On the satellite they turned into noise.
- Spin pauses for 24 seconds after a flight so the country you opened does not slide away.

## Verify

`npm test` (13 tests, last run green). Dev server: `npm run dev`. Clicked in headless Chrome: Mexico’s Wikipedia paragraph, the food tab, Hoy mentioning Mexico, search “Japón”, kid switch, Earth and Atlas screenshots. No console exceptions on that pass.

## Known limits

- Fifteen territories are not a separate shape even at 1:50m. Search still flies to them and draws a dot when you are zoomed in.
- Crimea falls inside the Russia shape in this Natural Earth file. The Russia and Ukraine cards say so.
- Jerusalem’s test point falls in the Palestine shape; Tel Aviv falls in Israel. The card does not turn that into a verdict.
- Laayoune falls inside Morocco; a separate Western Sahara shape remains. Both cards explain it.
- Food and culture are missing for some countries. The card links to a Wikipedia search instead of inventing a paragraph.
- Viajes does not list UNESCO sites. A Wikidata query was not wired. Do not fake the list.
- “Hoy” depends on Wikipedia’s CORS. Offline, the vendored intros still work after the service worker has cached them; the live feed does not.
- The phone sheet covers the globe when it is open. That is deliberate. Collapsing it (the handle) brings the globe back.

## If you continue

1. A soft cloud texture (not a threshold mask) can come back in `scene.js`; the uniforms are still there and `clouds.visible` is false.
2. `countries-50m.json` on zoom would catch Singapore. Load it only after the distance drops.
3. A weekly action could refresh `public/data/wiki` and the population file. Keep the User-Agent and the cache in `tools/build-stories.mjs`.
4. Do not weaken `tests/geo.test.mjs`. The frame bugs are silent until you screenshot the wrong continent.
