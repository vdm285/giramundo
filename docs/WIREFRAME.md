# Wireframe mode and the `wireframe` branch

Victor calls it the skeleton, the wireframe, or the prototype; the industry mostly says **wireframe** for the look-free layout and **reference implementation** for the logic you are expected to restyle. Here it means one thing: Giramundo with every visual feature stripped out and every piece of logic intact.

What it is for:

- A performance floor. If the wireframe is slow on a machine, the logic is the problem, not the styling. If the wireframe is fast and the full app is slow, the styling is the problem.
- A starting point for forks. Take the wireframe, keep the data, the picking, the dossier, the radio, the game, and give it your own taste, the way you remodel a house that is structurally sound but unfurnished.

## How it works

There is one code base. Wireframe is a mode, not a copy:

- `src/main.js` checks `VITE_WIREFRAME=1` (build time) or `?wireframe` in the URL (run time). In wireframe mode it loads `src/styles/wireframe.css` instead of `src/styles/app.css`, and no web fonts.
- `src/app/app.js` forces the flat map in atlas style and simple quality; the 3D engine is never downloaded.
- `src/flat/map.js` draws white paper and black outlines only; no plates, no night mask.
- `wireframe.css` hides every image, video and iframe, removes shadows, blur and transitions, and lays the page out as a map on the left and a plain document on the right.

Everything else is untouched: data loading, two-phase boot, the dossier's eight sections, headlines, radio, places, cities, the game, tours, compare, settings, share links.

## Try it

```bash
npm run dev
```

Then open http://localhost:5173/?wireframe . Or build it that way:

```bash
VITE_WIREFRAME=1 npm run build
```

## The branch

The `wireframe` branch is `main` plus a `.env` file containing `VITE_WIREFRAME=1`, so a checkout of that branch builds and deploys the wireframe by default. It is meant to be merged from `main` regularly (`git merge main`), never the other way around. Forkers who want their own look start from that branch, delete `.env` when they are ready to style, and write their own stylesheet next to `wireframe.css`.

Because the mode lives on `main`, the branch never drifts: a feature added to `main` shows up in the wireframe on the next merge, unstyled.

## Restyling from here

Start with `src/styles/wireframe.css`. Every class the app renders is listed there with the smallest rule that keeps it usable. Replace rules; do not rename classes, the templates in `src/dossier/` depend on them. The map's look lives in `src/flat/map.js` (`renderStatic`) and, for the globe, in `src/globe/shaders.js`.
