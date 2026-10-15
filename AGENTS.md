# AGENTS.md — Globo Curioso

Read this before changing the app. `HANDOFF.md` is the state of the code. `docs/EDITORIAL.md` is the rule for words on a card.

Owner: Victor (github.com/vdm285). The product opens in Mexican Spanish. English is the EN button, not a second site.

## What this is

A static globe. Three.js draws the Earth. d3-geo decides which country a tap hit and paints the atlas texture. Facts are vendored. Wikipedia text is vendored per country and can fall back to the Wikipedia REST API. There is no account and no key.

## Do not

- Invent a population, a capital, a dish, or a news line. If the source does not have it, the card should say so.
- “Fix” a border by editing a shape to match one country’s claim. The map is Natural Earth de facto. The note in `src/data/disputed.js` is where the disagreement is spoken.
- Flip a sign in `src/geo/orient.js` or `src/geo/math.js` without running `npm test`. Those tests are the spec: the place you view faces +Z, east is screen-right, north is screen-up, a drag to the right carries the ground to the right.
- Present Wikipedia text as if we wrote it. Keep the link and the CC BY-SA credit.

## Where things live

- `src/globe/scene.js` — camera, drag, sun, shaders. The NASA plates and the atlas canvas both put longitude 0 at the center. The sphere’s UV puts it on the left, so the shader samples those textures at `uv.x + 0.5`.
- `src/globe/paint.js` — atlas and highlight canvases. Use d3-geo’s path so Russia does not paint a stripe across the world.
- `src/ui/app.js` — selection, search, quiz, tours, hash (`#mx/comida/ninos/en`).
- `src/ui/card.js` — the paper card. Escape every string that is not a URL we built.
- `public/data/facts.json` — one row per country. Rebuild with `npm run data`.
- `public/data/wiki/{iso}.json` — intros. Rebuild with `npm run stories`.
- `tests/` — run with `npm test`. Do not weaken a test to make a change pass.

## Checks

`npm test`, then `npm run dev`, then look at Mexico and at Japan, in Earth and in Atlas, on a wide window and a narrow one. A country you just opened should stay on screen (spin waits). Kid mode must not show a “today” line about war or death.
