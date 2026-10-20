// Things to do: the guess-the-country game, tours, and compare.
// Pure logic over the store; app.js injects what it needs and renders.

import { haversineKm, rotateFeature } from '../geo/math.js';
import { buildJourneys } from './tours.js';

const GAME_COLORS = ['#2b5fa8', '#6fbfa0', '#f6e27a', '#f08a3c', '#d7301f'];

function lerp(a, b, u) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((x, i) => Math.round(x + (pb[i] - x) * u).toString(16).padStart(2, '0')).join('')}`;
}

// Hot when close: 0 km is red, 12,000 km and beyond is blue.
export function distanceColor(km) {
  const u = 1 - Math.min(1, Math.max(0, km) / 12000) ** 0.6;
  const x = u * (GAME_COLORS.length - 1);
  const i = Math.min(GAME_COLORS.length - 2, Math.floor(x));
  return lerp(GAME_COLORS[i], GAME_COLORS[i + 1], x - i);
}

function bearingDeg(a, b) {
  const toRad = Math.PI / 180;
  const dLon = (b.lon - a.lon) * toRad;
  const y = Math.sin(dLon) * Math.cos(b.lat * toRad);
  const x = Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) - Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

export function compass(deg, lang) {
  const es = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const en = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return (lang === 'es' ? es : en)[Math.round(deg / 45) % 8];
}

export function createPlay({ store, world, surface, select, flyToCountry }) {
  let tourTimer = null;
  let tourStarted = 0;
  const STEP_MS = 9000;

  function pool(level) {
    const min = level === 'hard' ? 20000 : 250000;
    return world.countries.filter((c) => c.onMap && c.iso2 && c.iso2 !== 'AQ' && (c.area || 0) > min && (c.population || 0) > (level === 'hard' ? 50000 : 2e6));
  }

  function paintGame(game) {
    const s = surface();
    if (!s) return;
    const byIso = new Map(game.guesses.map((g) => [g.iso2, g.color]));
    s.setDataColors((feature) => {
      const iso = feature.properties.iso2;
      if (game.done && iso === game.target.iso2) return '#ffffff';
      return byIso.get(iso) || '#454b55';
    });
    s.setStyle('data');
  }

  function restore() {
    const s = surface();
    const st = store.get();
    if (!s) return;
    s.setStyle(st.view);
    s.setSelected(null);
  }

  function startGame(level = 'normal') {
    stopTour();
    const candidates = pool(level);
    const rounds = [];
    const used = new Set();
    while (rounds.length < 5 && used.size < candidates.length) {
      const c = candidates[Math.floor(Math.random() * candidates.length)];
      if (used.has(c.iso2)) continue;
      used.add(c.iso2);
      rounds.push(c);
    }
    const game = { level, rounds, round: 0, total: rounds.length, target: rounds[0], guesses: [], scores: [], done: false, over: false };
    store.set({ game, collapsed: false, compare: null, picking: false, playmenu: false });
    const s = surface();
    s?.setSelected(null);
    s?.setBeacon(null);
    s?.setMarkers([]);
    paintGame(game);
    s?.flyTo(20, s.view.lon, 4.6);
  }

  function guess(country) {
    const game = store.get().game;
    if (!game || game.done || game.over || !country?.iso2) return;
    if (game.guesses.some((g) => g.iso2 === country.iso2)) return;
    const target = game.target;
    const km = Math.round(haversineKm({ lat: country.ll[0], lon: country.ll[1] }, { lat: target.ll[0], lon: target.ll[1] }));
    const hit = country.iso2 === target.iso2;
    const g = { iso2: country.iso2, km, hit, color: hit ? '#ffffff' : distanceColor(km), bearing: bearingDeg({ lat: country.ll[0], lon: country.ll[1] }, { lat: target.ll[0], lon: target.ll[1] }) };
    const next = { ...game, guesses: [...game.guesses, g], done: hit };
    if (hit) next.scores = [...game.scores, next.guesses.length];
    store.set({ game: next });
    paintGame(next);
    if (hit) {
      const s = surface();
      s?.setSelected(world.features.find((f) => f.properties.iso2 === target.iso2) || null);
      s?.setBeacon(target.ll[0], target.ll[1]);
    }
  }

  function giveUp() {
    const game = store.get().game;
    if (!game || game.done) return;
    const next = { ...game, done: true, scores: [...game.scores, null] };
    store.set({ game: next });
    paintGame(next);
    const s = surface();
    s?.setSelected(world.features.find((f) => f.properties.iso2 === game.target.iso2) || null);
    s?.setBeacon(game.target.ll[0], game.target.ll[1]);
    s?.flyTo(game.target.ll[0], game.target.ll[1], 3.2);
  }

  function nextRound() {
    const game = store.get().game;
    if (!game) return;
    if (game.round + 1 >= game.total) {
      store.set({ game: { ...game, over: true } });
      return;
    }
    const round = game.round + 1;
    const next = { ...game, round, target: game.rounds[round], guesses: [], done: false };
    store.set({ game: next });
    const s = surface();
    s?.setSelected(null);
    s?.setBeacon(null);
    paintGame(next);
  }

  function endGame({ open } = {}) {
    const game = store.get().game;
    store.set({ game: null });
    restore();
    if (open && game?.target) select(game.target.iso2);
  }

  // ---------- tours ----------

  function tours(lang) {
    return buildJourneys(world, lang);
  }

  function startTour(id) {
    const s = store.get();
    const journey = tours(s.lang).find((j) => j.id === id);
    if (!journey) return;
    if (s.game) endGame();
    store.set({ tour: { ...journey, index: 0, playing: true }, playmenu: false, compare: null, picking: false });
    surface()?.clearArcs();
    stepTour(0);
  }

  function stepTour(index) {
    const t = store.get().tour;
    if (!t) return;
    const stop = t.stops[index];
    const prev = t.stops[index - 1];
    const country = world.byIso.get(stop.iso2);
    if (!country) { advanceTour(1); return; }
    store.set({ tour: { ...t, index } });
    select(stop.iso2, { fly: true, section: stop.place ? 'lugares' : undefined });
    if (stop.place) {
      const st = store.get();
      store.set({ place: stop.place, content: { ...st.content, place: stop.place } });
    }
    const s = surface();
    if (s && prev) {
      const a = world.byIso.get(prev.iso2);
      s.clearArcs();
      if (a?.ll && country.ll) s.addArc({ lat: a.ll[0], lon: a.ll[1] }, { lat: country.ll[0], lon: country.ll[1] });
    }
    if (stop.ll && s) s.flyTo(stop.ll[0], stop.ll[1], stop.dist || 2.2);
    tourStarted = performance.now();
    scheduleTour();
  }

  function scheduleTour() {
    clearTimeout(tourTimer);
    const t = store.get().tour;
    if (!t?.playing) return;
    tourTimer = setTimeout(() => advanceTour(1), STEP_MS);
  }

  function advanceTour(delta) {
    const t = store.get().tour;
    if (!t) return;
    const index = t.index + delta;
    if (index >= t.stops.length) { stopTour({ keep: true }); return; }
    if (index < 0) return;
    stepTour(index);
  }

  function toggleTour() {
    const t = store.get().tour;
    if (!t) return;
    store.set({ tour: { ...t, playing: !t.playing } });
    if (!t.playing) { tourStarted = performance.now(); scheduleTour(); } else clearTimeout(tourTimer);
  }

  function stopTour({ keep } = {}) {
    clearTimeout(tourTimer);
    if (!store.get().tour) return;
    store.set({ tour: null });
    if (!keep) surface()?.clearArcs();
  }

  function tourProgress() {
    const t = store.get().tour;
    if (!t?.playing) return 0;
    return Math.min(1, (performance.now() - tourStarted) / STEP_MS);
  }

  // ---------- compare ----------

  function startCompare() {
    store.set({ picking: true, playmenu: false });
  }

  function setCompare(iso2) {
    const s = store.get();
    if (!iso2 || iso2 === s.id) { store.set({ picking: false }); return; }
    store.set({ compare: iso2, picking: false, collapsed: false });
    const a = world.byIso.get(s.id);
    const b = world.byIso.get(iso2);
    const sf = surface();
    if (sf && a?.ll && b?.ll) {
      sf.clearArcs();
      sf.addArc({ lat: a.ll[0], lon: a.ll[1] }, { lat: b.ll[0], lon: b.ll[1] }, { color: '#7fd1ff' });
      sf.setCompare(world.features.find((f) => f.properties.iso2 === iso2) || null);
      // True-size overlay: the selected country's outline carried onto the
      // compared country by a rotation of the sphere, so its size is honest.
      const own = world.features.find((f) => f.properties.iso2 === a.iso2);
      if (own) sf.setGhost?.(rotateFeature(own, { lat: a.ll[0], lon: a.ll[1] }, { lat: b.ll[0], lon: b.ll[1] }));
      const mid = { lat: (a.ll[0] + b.ll[0]) / 2, lon: a.ll[1] + ((((b.ll[1] - a.ll[1]) + 540) % 360) - 180) / 2 };
      const km = haversineKm({ lat: a.ll[0], lon: a.ll[1] }, { lat: b.ll[0], lon: b.ll[1] });
      sf.flyTo(mid.lat, mid.lon, Math.min(5.5, 1.8 + km / 2500));
    }
  }

  function clearCompare() {
    store.set({ compare: null, picking: false });
    const sf = surface();
    sf?.clearArcs();
    sf?.setCompare(null);
    sf?.setGhost?.(null);
  }

  return {
    startGame, guess, giveUp, nextRound, endGame,
    tours, startTour, toggleTour, stopTour, advanceTour, tourProgress,
    startCompare, setCompare, clearCompare,
    paintGame,
  };
}
