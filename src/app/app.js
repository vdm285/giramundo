// The controller. Owns the store, the surface (globe or flat map), fetching
// of content for the selected country, and the shell UI. Templates for the
// dossier live in ../dossier; drawing lives in ../globe and ../flat.

import { html, nothing, render } from 'lit';
import { loadExtras, loadWorld } from '../data/load.js';
import { searchCountries } from '../data/search.js';
import { ALIAS_NOTES, norm } from '../data/aliases.js';
import { formatTime } from '../data/format.js';
import { nameWater } from '../geo/oceans.js';
// The 3D engine is loaded on demand (see mountSurface), so the flat map
// path never downloads Three.js.
import { createFlatMap } from '../flat/map.js';
import { renderDossier } from '../dossier/dossier.js';
import * as live from '../live/sources.js';
import { createRadio, shortName } from '../live/radio.js';
import { renderGame, renderPlayMenu, renderTourBar } from '../dossier/play.js';
import { renderCity } from '../dossier/city.js';
import { createPlay } from './play.js';
import { createStore, readSetting, writeSetting } from './state.js';

const radio = createRadio();
let play = null;
import { buildHash, parseHash } from './router.js';
import { t } from './i18n.js';

const base = import.meta.env.BASE_URL;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const INDICATOR_RAMPS = {
  default: ['#1b2a49', '#2f6d9b', '#6fbfa0', '#f6e27a'],
  co2Pc: ['#f5efe1', '#e9a26a', '#c0392b', '#4a0f0f'],
  popGrowth: ['#2a5caa', '#9ec9e2', '#f6e27a', '#d7301f'],
};

let world;
let surface = null;
let store;
let token = 0;
let suggestedFlat = false;
let searchIndex = -1;

// ---------- helpers ----------

function countryOf(id) {
  return world.byIso.get(id) || world.byPlace.get(id) || null;
}

function featureOf(country) {
  if (!country) return null;
  return world.features.find((f) => (
    (country.iso2 && f.properties.iso2 === country.iso2)
    || (country.placeId && f.properties.placeId === country.placeId)
  )) || null;
}

function countryOfFeature(feature) {
  if (!feature) return null;
  return world.byIso.get(feature.properties.iso2) || world.byPlace.get(feature.properties.placeId) || null;
}

function lerpColor(a, b, u) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((x, i) => Math.round(x + (pb[i] - x) * u));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function ramp(stops, u) {
  const x = Math.max(0, Math.min(0.9999, u)) * (stops.length - 1);
  const i = Math.floor(x);
  return lerpColor(stops[i], stops[i + 1], x - i);
}

// Rank-based scale: robust to GDP-style skew, matches how people read maps.
function indicatorScale(def) {
  const values = Object.values(def.values || {}).map((v) => v[0]).sort((a, b) => a - b);
  const n = values.length;
  const stops = INDICATOR_RAMPS[def.key] || INDICATOR_RAMPS.default;
  return {
    n,
    min: values[0],
    median: values[n >> 1],
    max: values[n - 1],
    color(v) {
      if (v == null) return null;
      let lo = 0;
      let hi = n;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] < v) lo = mid + 1; else hi = mid; }
      return ramp(stops, lo / Math.max(1, n - 1));
    },
    stops,
  };
}

function toast(message, actions = null) {
  store.set({ toast: message ? { message, actions, at: Date.now() } : null });
  clearTimeout(toast.timer);
  if (message && !actions) toast.timer = setTimeout(() => store.set({ toast: null }), 3600);
}

// ---------- content ----------

async function loadContent(country) {
  const my = ++token;
  const s = store.get();
  const content = {};
  const alive = () => my === token;
  const patch = (more) => {
    if (!alive()) return;
    Object.assign(content, more);
    // Merge over the store's copy so city keys added meanwhile survive.
    store.set({ content: { ...store.get().content, ...more } });
  };
  store.set({ content: {} });
  const lang = s.lang;
  const iso = country.iso2;
  const places = iso ? world.places?.[iso] : null;
  const firstImage = places?.heritage?.find((h) => h.image);

  // Story and hero first: they shape the first paint.
  live.loadStory(iso, base).then(async (story) => {
    patch({ story: story || null });
    const page = story?.[lang]?.historia;
    const summary = page?.title ? await live.wikiSummary(lang, page.title) : await live.wikiSummary(lang, country.name[lang] || country.name.en);
    if (!page?.extract && summary) patch({ liveSummary: summary });
    if (!firstImage) {
      const main = summary?.image || summary?.thumb || page?.thumb || '';
      const flaggy = /flag|bandera|coat|escudo|emblem|seal|map|mapa|locat|orthographic|\.svg/i.test(main);
      if (main && !flaggy) patch({ hero: { src: main, credit: 'Wikipedia', link: summary?.url || page?.url || '' } });
      const photo = await live.wikiPhoto(lang, page?.title || summary?.title || country.name[lang] || country.name.en);
      if (photo) patch({ hero: { src: photo.src, credit: photo.caption ? photo.caption.slice(0, 60) : 'Wikimedia Commons', link: photo.page } });
      else if (main && flaggy) patch({ hero: { src: main, credit: 'Wikipedia', link: summary?.url || page?.url || '' } });
    }
  });
  if (firstImage) {
    patch({ hero: { src: live.commonsThumb(firstImage.image, 1000), credit: firstImage.label?.[lang] || firstImage.label?.en || 'Wikimedia Commons', link: live.commonsPage(firstImage.image) } });
  }

  if (!iso) return;
  live.loadNews(iso, base).then((news) => patch({ news: news || { es: [], en: [] } }));
  live.loadVideos(iso, base, world.videoSeed).then((videos) => patch({ videos }));
  live.holidaysToday(iso).then((holidays) => patch({ holidays }));
  live.nextHoliday(iso).then((nextHoliday) => patch({ nextHoliday }));
  live.rates().then((rates) => patch({ rates }));
  live.quakesWeek().then((quakes) => patch({ quakes }));
  live.wikiToday(lang).then((today) => patch({ today }));
  live.wikiMostRead(lang).then((mostRead) => patch({ mostRead }));

  // Weather at the capital when Wikipedia knows where it is; else the center.
  const capitalName = country.capital?.[lang] || country.capital?.en;
  const where = capitalName ? await live.wikiSummary(lang, capitalName) : null;
  const ll = where?.coordinates ? [where.coordinates.lat, where.coordinates.lon] : country.ll;
  if (ll) {
    if (alive()) country.capitalLL = ll;
    live.weatherAt(ll[0], ll[1]).then((weather) => patch({ weather }));
  }
}

// ---------- selection ----------

// Distance by size, and a longitude offset so the country lands in the
// part of the screen the dossier does not cover.
function flyToCountry(country, turns = 0) {
  const dist = country.onMap ? (country.area > 3e6 ? 3.0 : country.area > 3e5 ? 2.4 : 1.9) : 1.6;
  const dossier = document.querySelector('.dossier');
  const covered = dossier && !store.get().collapsed && window.innerWidth >= 920 ? dossier.getBoundingClientRect().width + 20 : 0;
  const h = window.innerHeight;
  const radiusPx = (1 / (dist * Math.tan((32 * Math.PI / 180) / 2))) * (h / 2);
  // At the screen center one degree of longitude spans radiusPx * pi / 180 pixels.
  const degPerPx = 57.3 / Math.max(80, radiusPx);
  const shift = (covered / 2) * degPerPx;
  surface.flyTo(country.ll[0], country.ll[1] + shift, dist, { turns });
}

// ---------- cities ----------

let cityToken = 0;

function openCity(city) {
  if (!city) return;
  const s = store.get();
  const iso = city.id.slice(0, 2).toUpperCase();
  if (s.id !== iso) {
    // Different country: select it without flying, then land on the city.
    select(iso, { fly: false });
  }
  store.set({ city, collapsed: false, place: null, playmenu: false, content: { ...store.get().content, citySummary: undefined, cityWeather: null, cityHero: null, playing: null } });
  surface?.setBeacon(city.ll[0], city.ll[1]);
  surface?.flyTo(city.ll[0], city.ll[1] + cityShift(), 1.42);
  syncMarkers();
  loadCityContent(city);
  requestAnimationFrame(() => { const el = document.querySelector('.dossier-scroll'); if (el) el.scrollTop = 0; });
}

function cityShift() {
  const dossier = document.querySelector('.dossier');
  const covered = dossier && !store.get().collapsed && window.innerWidth >= 920 ? dossier.getBoundingClientRect().width + 20 : 0;
  const radiusPx = (1 / (1.42 * Math.tan((32 * Math.PI / 180) / 2))) * (window.innerHeight / 2);
  return (covered / 2) * (57.3 / Math.max(80, radiusPx));
}

function closeCity() {
  const s = store.get();
  store.set({ city: null });
  const country = countryOf(s.id);
  if (country?.ll) { surface?.setBeacon(country.ll[0], country.ll[1]); flyToCountry(country); }
  syncMarkers();
}

async function loadCityContent(city) {
  const my = ++cityToken;
  const lang = store.get().lang;
  const alive = () => my === cityToken && store.get().city?.id === city.id;
  const patch = (more) => { if (alive()) store.set({ content: { ...store.get().content, ...more } }); };
  const title = city.name?.[lang] || city.name?.en;
  const [summary, weather] = await Promise.all([
    live.wikiSummary(lang, title).then((s) => s || (lang === 'es' ? live.wikiSummary('en', city.name?.en) : null)),
    live.weatherAt(city.ll[0], city.ll[1]),
  ]);
  patch({ citySummary: summary || null, cityWeather: weather });
  const main = summary?.image || summary?.thumb || '';
  const flaggy = /flag|bandera|coat|escudo|emblem|seal|map|mapa|locat|\.svg/i.test(main);
  if (main && !flaggy) patch({ cityHero: { src: main, credit: 'Wikipedia', link: summary?.url || '' } });
  else {
    const photo = await live.wikiPhoto(lang, summary?.title || title);
    if (photo) patch({ cityHero: { src: photo.src, credit: photo.caption ? photo.caption.slice(0, 60) : 'Wikimedia Commons', link: photo.page } });
  }
}

function select(id, { fly = true, turns = 0, section } = {}) {
  const country = countryOf(id);
  if (!country) return;
  const s = store.get();
  const feature = featureOf(country);
  if (s.compare && s.compare !== id && id !== s.id) play?.clearCompare();
  store.set({ id, collapsed: false, section: section || s.section, hover: null, place: null, playmenu: false, city: null });
  writeSetting('last', id);
  surface?.setSelected(feature);
  // The idle spin would carry the country you are reading about off-screen.
  surface?.setSpin(false);
  surface?.setBeacon(country.ll?.[0], country.ll?.[1]);
  if (fly && country.ll && surface) flyToCountry(country, turns);
  syncMarkers();
  loadContent(country);
  requestAnimationFrame(() => { const el = document.querySelector('.dossier-scroll'); if (el) el.scrollTop = 0; });
}

function syncMarkers() {
  if (!surface) return;
  const s = store.get();
  const country = countryOf(s.id);
  const dist = surface.view.dist;
  const markers = [];
  for (const c of world.countries) {
    if (!c.ll || !c.iso2 || c.onMap) continue;
    if (dist < 3.2 || c.iso2 === s.id) markers.push({ lat: c.ll[0], lon: c.ll[1], id: c.iso2, color: '#f6d78a', size: 9, kind: 'country' });
  }
  const cities = country?.iso2 ? world.cities?.[country.iso2] : null;
  if (cities && (dist < 2.0 || s.city)) {
    for (const c of cities) {
      markers.push({ lat: c.ll[0], lon: c.ll[1], id: c.id, color: c.capital ? '#ffd27a' : '#fff4dc', size: c.capital ? 9 : 7, kind: 'city', city: c, highlight: s.city?.id === c.id });
    }
  }
  const places = country?.iso2 ? world.places?.[country.iso2]?.heritage : null;
  if (places && (s.section === 'lugares' || dist < 2.2)) {
    for (const p of places) {
      if (!p.ll) continue;
      markers.push({ lat: p.ll[0], lon: p.ll[1], id: p.qid, color: '#8fd5ff', size: 7, kind: 'place', place: p, highlight: s.place === p });
    }
  }
  surface.setMarkers(markers);
}

// 'auto' starts full and drops to simple if the frame rate says so (see watchPerformance).
let autoLevel = 'full';
function applyQuality() {
  const q = store.get().quality;
  surface?.setQuality?.(q === 'auto' ? autoLevel : q);
}

function applyDataColors() {
  const s = store.get();
  if (!surface) return;
  const def = world.indicators?.[s.indicator];
  if (!def || s.view !== 'data') { store.set({ legend: null }); return; }
  const scale = indicatorScale({ ...def, key: s.indicator });
  surface.setDataColors((feature) => {
    const iso = feature.properties.iso2;
    const v = iso ? def.values?.[iso]?.[0] : null;
    return scale.color(v);
  });
  store.set({ legend: { key: s.indicator, def, scale } });
}

// ---------- surface ----------

async function mountSurface(flat) {
  const canvas = document.getElementById('c');
  const flatCanvas = document.getElementById('flat');
  const prev = surface;
  const keep = prev ? { ...prev.view } : null;
  surface = null;
  prev?.dispose();
  canvas.hidden = flat;
  flatCanvas.hidden = !flat;
  document.body.classList.toggle('flat', flat);
  let next;
  if (flat) {
    next = createFlatMap(flatCanvas, world, { base });
  } else {
    const { createGlobe } = await import('../globe/scene.js');
    next = await createGlobe(canvas, world, { base, reduced });
  }
  surface = next;
  if (keep) { next.view.lat = keep.lat; next.view.lon = keep.lon; }
  const s = store.get();
  next.setStyle(s.view);
  next.setSpin(s.spin && s.collapsed && !reduced);
  next.setSunOffset(s.sun);
  surface = next;
  applyQuality();
  const country = countryOf(s.id);
  next.setSelected(featureOf(country));
  if (country?.ll) next.setBeacon(country.ll[0], country.ll[1]);
  next.onTap(onTap);
  next.onMove(onMove);
  applyDataColors();
  syncMarkers();
  if (country?.ll && keep) flyToCountry(country);
  return next;
}

function onTap(event) {
  const s = store.get();
  if (s.playmenu) store.set({ playmenu: false });
  if (s.game && !s.game.over) {
    const ll = surface.pickLatLon(event.clientX, event.clientY);
    const feature = ll && world.index.find(ll.lon, ll.lat);
    const country = countryOfFeature(feature);
    if (country?.iso2) play.guess(country);
    return;
  }
  if (s.picking) {
    const ll = surface.pickLatLon(event.clientX, event.clientY);
    const feature = ll && world.index.find(ll.lon, ll.lat);
    const country = countryOfFeature(feature);
    if (country?.iso2) play.setCompare(country.iso2);
    return;
  }
  const marker = surface.markerAt(event.clientX, event.clientY);
  if (marker?.kind === 'city') { openCity(marker.city); return; }
  if (marker?.kind === 'place') {
    store.set({ place: marker.place, section: 'lugares', collapsed: false });
    syncMarkers();
    return;
  }
  if (marker?.kind === 'country') { select(marker.id); return; }
  const ll = surface.pickLatLon(event.clientX, event.clientY);
  const feature = ll && world.index.find(ll.lon, ll.lat);
  const country = countryOfFeature(feature);
  if (country) { select(country.iso2 || country.placeId); return; }
  if (ll) toast(`${t(s.lang, 'ocean')}: ${nameWater(ll.lat, ll.lon, s.lang)} (${t(s.lang, 'approx')}).`);
  document.getElementById('coach').hidden = true;
}

function onMove(event) {
  if (event.pointerType === 'touch') return;
  const s = store.get();
  const tip = document.getElementById('tip');
  const marker = surface.markerAt(event.clientX, event.clientY);
  let label = '';
  let feature = null;
  if (marker?.kind === 'place') label = marker.place.label?.[s.lang] || marker.place.label?.en || '';
  else if (marker?.kind === 'city') label = marker.city.name?.[s.lang] || marker.city.name?.en || '';
  else if (marker?.kind === 'country') label = countryOf(marker.id)?.name?.[s.lang] || '';
  else {
    const ll = surface.pickLatLon(event.clientX, event.clientY);
    feature = ll && world.index.find(ll.lon, ll.lat);
    const country = countryOfFeature(feature);
    label = country?.name?.[s.lang] || country?.name?.en || feature?.properties?.name || '';
    if (s.view === 'data' && country?.iso2 && s.legend) {
      const v = s.legend.def.values?.[country.iso2];
      if (v) label += ` · ${new Intl.NumberFormat(s.lang === 'es' ? 'es-MX' : 'en-US', { maximumFractionDigits: s.legend.def.decimals ?? 1 }).format(v[0])} ${s.legend.def.unit?.[s.lang] || ''}`;
    }
  }
  const key = feature?.properties?.id || marker?.id || null;
  if (key !== s.hover) { store.set({ hover: key }); surface.setHover(feature); }
  tip.hidden = !label;
  if (label) { tip.textContent = label; tip.style.left = `${event.clientX}px`; tip.style.top = `${event.clientY}px`; }
  document.body.style.cursor = label ? 'pointer' : '';
}

// ---------- actions from the dossier and the shell ----------

async function on(action, payload) {
  const s = store.get();
  switch (action) {
    case 'go': select(payload); break;
    case 'section':
      store.set({ section: payload, playing: null });
      syncMarkers();
      requestAnimationFrame(() => { const el = document.querySelector('.dossier-scroll'); if (el) el.scrollTop = 0; });
      break;
    case 'collapse':
      store.set({ collapsed: !s.collapsed });
      surface?.setSpin(s.spin && !s.collapsed && !reduced);
      if (!s.collapsed) surface?.control?.hold?.(6000);
      break;
    case 'place': {
      store.set({ place: payload, content: { ...s.content, place: payload } });
      if (payload?.ll) surface?.flyTo(payload.ll[0], payload.ll[1], Math.min(surface.view.dist, 1.5));
      syncMarkers();
      break;
    }
    case 'video': store.set({ content: { ...s.content, video: payload, playing: null } }); break;
    case 'play': store.set({ content: { ...s.content, playing: payload } }); break;
    case 'paint': {
      const same = s.indicator === payload && s.view === 'data';
      store.set({ indicator: payload, view: same ? 'earth' : 'data' });
      writeSetting('view', same ? 'earth' : 'data');
      surface?.setStyle(same ? 'earth' : 'data');
      applyDataColors();
      break;
    }
    case 'indicator':
      store.set({ indicator: payload });
      applyDataColors();
      break;
    case 'view':
      store.set({ view: payload });
      writeSetting('view', payload);
      surface?.setStyle(payload);
      applyDataColors();
      break;
    case 'flat':
      store.set({ flat: payload, toast: null });
      writeSetting('flat', payload);
      await mountSurface(payload);
      break;
    case 'lang': {
      const lang = s.lang === 'es' ? 'en' : 'es';
      store.set({ lang });
      writeSetting('lang', lang);
      document.documentElement.lang = lang;
      const country = countryOf(s.id);
      if (country) loadContent(country);
      break;
    }
    case 'surprise': {
      const pool = world.countries.filter((c) => c.ll && c.iso2 && c.iso2 !== s.id && c.iso2 !== 'AQ' && c.onMap && (c.population || 0) > 300000);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      select(pick.iso2, { turns: 1 });
      break;
    }
    case 'share': {
      const url = `${location.origin}${location.pathname}${buildHash({ iso: s.id?.length === 2 ? s.id : null, placeId: s.id?.length === 2 ? null : s.id, section: s.section, city: s.city?.id || null, lang: s.lang })}`;
      const title = `${s.city ? (s.city.name?.[s.lang] || s.city.name?.en) : (countryOf(s.id)?.name?.[s.lang] || '')} · Giramundo`;
      if (navigator.share) navigator.share({ title, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast(t(s.lang, 'copied')));
      break;
    }
    case 'about': document.getElementById('about').showModal(); break;
    case 'settings': document.getElementById('settings').showModal(); break;
    case 'playmenu': store.set({ playmenu: !s.playmenu }); break;
    case 'game': play.startGame(payload); break;
    case 'game-next': play.nextRound(); break;
    case 'game-giveup': play.giveUp(); break;
    case 'game-end': play.endGame(); break;
    case 'game-open': play.endGame({ open: true }); break;
    case 'tour': play.startTour(payload); break;
    case 'tour-prev': play.advanceTour(-1); break;
    case 'tour-next': play.advanceTour(1); break;
    case 'tour-toggle': play.toggleTour(); break;
    case 'tour-stop': play.stopTour(); break;
    case 'compare': play.startCompare(); toast(t(s.lang, 'comparePick')); document.getElementById('q')?.focus(); break;
    case 'compare-clear': play.clearCompare(); break;
    case 'city': openCity(payload); break;
    case 'city-close': closeCity(); break;
    case 'radio-play': radio.play(payload.station, payload.iso2); break;
    case 'radio-toggle': radio.toggle(); break;
    case 'radio-stop': radio.stop(); break;
    case 'radio-volume': radio.setVolume(payload); break;
    case 'radio-next': {
      const r = radio.state;
      const list = r.iso2 ? world.radio?.[r.iso2] : null;
      if (!list?.length) break;
      const i = list.findIndex((x) => x.id === r.station?.id);
      radio.play(list[(i + 1) % list.length], r.iso2);
      break;
    }
    case 'quality':
      store.set({ quality: payload });
      writeSetting('quality', payload);
      applyQuality();
      break;
    case 'opening':
      store.set({ opening: payload });
      writeSetting('opening', payload);
      break;
    case 'set-home':
      if (s.id) { store.set({ home: s.id }); writeSetting('home', s.id); }
      break;
    case 'spin':
      store.set({ spin: payload });
      writeSetting('spin', payload);
      surface?.setSpin(payload && s.collapsed && !reduced);
      break;
    case 'sun':
      store.set({ sun: payload });
      surface?.setSunOffset(payload);
      break;
    default: break;
  }
}

// ---------- shell ----------

const globeIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`;
const flatIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>`;
const gearIcon = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
const playIcon = html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const pauseIcon = html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
const nextIcon = html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5v14l8-7zM16 5h2v14h-2z"/></svg>`;
const searchIcon = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;

function shell(s) {
  const country = countryOf(s.id);
  const places = country?.iso2 ? world.places?.[country.iso2] : null;
  const legend = s.legend;
  const nf = (n) => new Intl.NumberFormat(s.lang === 'es' ? 'es-MX' : 'en-US', { maximumFractionDigits: legend?.def.decimals ?? 1, notation: n > 99999 ? 'compact' : 'standard' }).format(n);
  return html`
    <header class="topbar">
      <a class="wordmark" href="#" @click=${(e) => { e.preventDefault(); select('MX', { turns: 0 }); }}>Giramundo <small>${t(s.lang, 'tagline')}</small></a>
      <form class="search" role="search" autocomplete="off" @submit=${onSearchSubmit}>
        ${searchIcon}
        <input id="q" type="search" placeholder=${t(s.lang, 'search')} aria-label=${t(s.lang, 'search')} @input=${onSearchInput} @keydown=${onSearchKey} @blur=${() => setTimeout(() => store.set({ hits: [] }), 150)}>
        <div class="suggest" role="listbox">
          ${(s.hits || []).map((c, i) => html`<button type="button" role="option" aria-selected=${i === searchIndex} @mousedown=${(e) => e.preventDefault()} @click=${() => pickHit(c)}>
            ${c.flag ? html`<img alt="" src=${base + c.flag}>` : nothing}${c.name[s.lang] || c.name.en}
            ${c.aliasNote ? html`<span class="note">${c.aliasNote}</span>` : nothing}</button>`)}
        </div>
      </form>
      <div class="topright">
        <div class="seg" role="group" aria-label=${t(s.lang, 'viewsLabel')}>
          ${['earth', 'atlas', 'data'].map((v) => html`<button aria-pressed=${s.view === v} @click=${() => on('view', v)}>${t(s.lang, `view${v[0].toUpperCase()}${v.slice(1)}`)}</button>`)}
          <button aria-pressed=${s.flat} title=${s.flat ? t(s.lang, 'viewGlobe') : t(s.lang, 'viewFlat')} aria-label=${s.flat ? t(s.lang, 'viewGlobe') : t(s.lang, 'viewFlat')} @click=${() => on('flat', !s.flat)}>${s.flat ? globeIcon : flatIcon}</button>
        </div>
        <button class="ghost" @click=${() => on('lang')}>${t(s.lang, 'langSwitch')}</button>
      </div>
    </header>
    <nav class="dock">
      <button @click=${() => on('surprise')}>${t(s.lang, 'surprise')}</button>
      ${s.collapsed && country ? html`<button @click=${() => on('collapse')}>${t(s.lang, 'expand')}</button>` : nothing}
      <button @click=${() => on('playmenu')} aria-expanded=${s.playmenu}>${t(s.lang, 'play')}</button>
      <button @click=${() => on('about')}>${t(s.lang, 'about')}</button>
      <button class="gear" title=${t(s.lang, 'settings')} aria-label=${t(s.lang, 'settings')} @click=${() => on('settings')}>${gearIcon}</button>
    </nav>
    ${s.playmenu ? renderPlayMenu({ lang: s.lang, on, tours: play.tours(s.lang) }) : nothing}
    ${s.tour ? renderTourBar({ lang: s.lang, tour: s.tour, on, progress: play.tourProgress() }) : nothing}
    <dialog id="settings" class="settings">
      <form method="dialog"><button class="x" value="cancel" aria-label=${t(s.lang, 'close')}>×</button></form>
      <h2>${t(s.lang, 'settings')}</h2>
      <h3>${t(s.lang, 'quality')}</h3>
      <div class="opts">${['auto', 'full', 'simple'].map((q) => html`<button aria-pressed=${s.quality === q} @click=${() => on('quality', q)}>${t(s.lang, `quality${q[0].toUpperCase()}${q.slice(1)}`)}</button>`)}
        <button aria-pressed=${s.flat} @click=${() => on('flat', !s.flat)}>${t(s.lang, 'viewFlat')}</button></div>
      <p class="help">${t(s.lang, 'qualityHelp')}</p>
      ${s.perf ? html`<p class="help" style="font-variant-numeric:tabular-nums">${t(s.lang, 'perf')}: ${s.perf.fps} fps · ${s.perf.width}×${s.perf.height} @${Number(s.perf.pixelRatio).toFixed(2)} · ${s.perf.gpu}${s.perf.webgl2 === false ? ' · WebGL 1' : ''}</p>` : nothing}
      <h3>${t(s.lang, 'opening')}</h3>
      <div class="opts">${['day', 'home', 'here', 'random', 'last'].map((o) => html`<button aria-pressed=${s.opening === o} @click=${() => on('opening', o)}>${t(s.lang, `open${o[0].toUpperCase()}${o.slice(1)}`)}</button>`)}</div>
      <p class="help">${t(s.lang, 'openingHint')}</p>
      <h3>${t(s.lang, 'homeBase')}: ${countryOf(s.home)?.name?.[s.lang] || s.home}</h3>
      <div class="opts"><button @click=${() => on('set-home')} ?disabled=${!s.id || s.id === s.home}>${t(s.lang, 'setHome')}</button></div>
      <label class="row"><input type="checkbox" .checked=${s.spin} @change=${(e) => on('spin', e.target.checked)}> ${t(s.lang, 'spin')}</label>
      <label class="row">${t(s.lang, 'sunOffset')} <input type="range" min="-12" max="12" step="0.5" .value=${String(s.sun)} @input=${(e) => on('sun', Number(e.target.value))}> <button type="button" class="chip" @click=${() => on('sun', 0)}>${t(s.lang, 'sunNow')}</button></label>
    </dialog>
    ${s.radio?.station ? (() => {
      const r = s.radio;
      const from = countryOf(r.iso2);
      const busy = r.status === 'playing' || r.status === 'loading';
      const status = r.status === 'loading' ? t(s.lang, 'radioLoading')
        : r.status === 'error' ? t(s.lang, r.error === 'gesture' ? 'radioGesture' : 'radioError')
          : r.status === 'playing' ? (from?.name?.[s.lang] || '') : (from?.name?.[s.lang] || '');
      return html`<div class="player" role="region" aria-label=${t(s.lang, 'radio')}>
        <button class="pbtn main" @click=${() => on('radio-toggle')} aria-label=${busy ? t(s.lang, 'radioPause') : t(s.lang, 'radioPlay')}>${busy ? pauseIcon : playIcon}</button>
        ${from?.flag ? html`<img alt="" src=${base + from.flag}>` : nothing}
        <div class="pinfo">
          <button @click=${() => select(r.iso2)} title=${r.station.name}>${shortName(r.station.name)}</button>
          <span class=${r.status === 'playing' ? 'live' : ''}>${status}</span>
        </div>
        <input type="range" min="0" max="1" step="0.05" .value=${String(r.volume)} aria-label=${t(s.lang, 'radioVolume')} @input=${(e) => on('radio-volume', Number(e.target.value))}>
        <button class="pbtn" @click=${() => on('radio-next')} title=${t(s.lang, 'radioNext')} aria-label=${t(s.lang, 'radioNext')}>${nextIcon}</button>
        <button class="pbtn" @click=${() => on('radio-stop')} title=${t(s.lang, 'radioStop')} aria-label=${t(s.lang, 'radioStop')}>×</button>
      </div>`;
    })() : nothing}
    ${legend ? html`
      <div class="legend">
        <strong>${legend.def.label?.[s.lang]}</strong>
        <span class="small">${legend.def.unit?.[s.lang] || ''} · ${legend.scale.n} ${t(s.lang, 'dataCountries')}</span>
        <div class="bar" style=${`background: linear-gradient(90deg, ${legend.scale.stops.join(', ')})`}></div>
        <div class="ticks"><span>${nf(legend.scale.min)}</span><span>${nf(legend.scale.median)}</span><span>${nf(legend.scale.max)}</span></div>
        <select @change=${(e) => on('indicator', e.target.value)}>
          ${Object.entries(world.indicators || {}).map(([k, d]) => html`<option value=${k} ?selected=${k === s.indicator}>${d.label?.[s.lang] || k}</option>`)}
        </select>
      </div>` : nothing}
    ${s.toast ? html`<p class="toast ${s.toast.actions ? 'ask' : ''}">${s.toast.message}${s.toast.actions ? s.toast.actions.map((a) => html`<button class=${a.quiet ? 'quiet' : ''} @click=${a.run}>${a.label}</button>`) : nothing}</p>` : nothing}
    <aside class="dossier" aria-live="off">
      <div class="dossier-scroll">
        ${s.game
          ? renderGame({ lang: s.lang, game: s.game, world, on, base })
          : s.city
            ? renderCity({ lang: s.lang, city: s.city, country, content: s.content, cities: world.cities?.[country?.iso2] || [], on, base })
            : renderDossier({ ...s, country, world, places, culture: country?.iso2 ? world.culture?.[country.iso2] : null, on, base, feature: featureOf(country) })}
      </div>
    </aside>
    <dialog id="about">
      <form method="dialog"><button class="x" value="cancel" aria-label=${t(s.lang, 'close')}>×</button></form>
      <h2>Giramundo</h2>
      <p>${t(s.lang, 'aboutLead')}</p>
      <p>${t(s.lang, 'aboutP2')}</p>
      <p>${t(s.lang, 'aboutP3')}</p>
      <p>${t(s.lang, 'aboutP4')} <a href="https://github.com/vdm285/giramundo" target="_blank" rel="noreferrer">github.com/vdm285/giramundo</a></p>
    </dialog>`;
}

function onSearchInput(e) {
  const s = store.get();
  const q = e.target.value;
  const hits = searchCountries(world.countries, q).map((c) => {
    const note = ALIAS_NOTES[norm(q)];
    return note && note.iso === c.iso2 ? Object.assign(Object.create(c), { aliasNote: note[s.lang] }) : c;
  });
  searchIndex = hits.length ? 0 : -1;
  store.set({ hits });
}

function onSearchKey(e) {
  const hits = store.get().hits || [];
  if (e.key === 'ArrowDown') { e.preventDefault(); searchIndex = Math.min(hits.length - 1, searchIndex + 1); store.set({ hits: [...hits] }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); searchIndex = Math.max(0, searchIndex - 1); store.set({ hits: [...hits] }); }
  else if (e.key === 'Escape') { e.target.value = ''; store.set({ hits: [] }); e.target.blur(); }
}

function onSearchSubmit(e) {
  e.preventDefault();
  const hits = store.get().hits || [];
  const hit = hits[Math.max(0, searchIndex)] || searchCountries(world.countries, e.target.q.value, 1)[0];
  if (hit) pickHit(hit);
}

function pickHit(c) {
  const input = document.getElementById('q');
  if (c.aliasNote) toast(c.aliasNote);
  input.value = '';
  input.blur();
  store.set({ hits: [] });
  const s = store.get();
  if (s.picking && c.iso2) { play.setCompare(c.iso2); return; }
  if (s.game && !s.game.over && c.iso2) { play.guess(c); return; }
  select(c.iso2 || c.placeId);
}

// ---------- boot ----------

// The pool for "country of the day" and "random": real countries with a
// shape, people, and at least one World Heritage photo so the hero lands.
function showcasePool() {
  return world.countries.filter((c) => c.iso2 && c.onMap && c.iso2 !== 'AQ' && (c.population || 0) > 1e6
    && world.places?.[c.iso2]?.heritage?.some((h) => h.image));
}

function countryOfTheDay() {
  const pool = showcasePool();
  const day = Math.floor(Date.now() / 86400000);
  // A fixed shuffle so consecutive days do not walk the alphabet.
  let x = Math.imul(day, 2654435761) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 1274126177) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return pool[x % pool.length]?.iso2 || 'MX';
}

function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 3600000 },
    );
  });
}

async function chooseOpening(s) {
  switch (s.opening) {
    case 'home': return countryOf(s.home) ? s.home : 'MX';
    case 'random': { const pool = showcasePool(); return pool[Math.floor(Math.random() * pool.length)]?.iso2 || 'MX'; }
    case 'last': { const last = readSetting('last', null); return countryOf(last) ? last : countryOfTheDay(); }
    case 'here': {
      const here = await locate();
      const feature = here && world.index.find(here.lon, here.lat);
      const country = countryOfFeature(feature);
      if (country) return country.iso2 || country.placeId;
      toast(t(s.lang, 'locFail'));
      return countryOfTheDay();
    }
    default: return countryOfTheDay();
  }
}

function canWebGL() {
  try {
    const test = document.createElement('canvas');
    return Boolean(test.getContext('webgl2') || test.getContext('webgl'));
  } catch { return false; }
}

function watchPerformance() {
  const startedAt = performance.now();
  setInterval(() => {
    if (suggestedFlat || !surface || store.get().flat) return;
    if (document.visibilityState !== 'visible' || performance.now() - startedAt < 15000) return;
    const hist = surface.getFpsHistory?.() || [];
    if (hist.length < 6 || !hist.slice(-6).every((f) => f < 20)) return;
    // In automatic quality, step down to the simple globe before offering the flat map.
    if (store.get().quality === 'auto' && autoLevel === 'full') {
      autoLevel = 'simple';
      applyQuality();
      return;
    }
    {
      suggestedFlat = true;
      const lang = store.get().lang;
      toast(t(lang, 'flatSuggest'), [
        { label: t(lang, 'flatYes'), run: () => on('flat', true) },
        { label: t(lang, 'flatNo'), quiet: true, run: () => store.set({ toast: null }) },
      ]);
    }
  }, 2500);
}

export async function boot() {
  const bootError = document.getElementById('boot-error');
  const hashed = parseHash(location.hash);
  const lang = hashed?.lang || readSetting('lang', 'es');
  store = createStore({
    lang,
    view: readSetting('view', 'earth'),
    flat: readSetting('flat', false),
    quality: readSetting('quality', 'auto'),
    opening: readSetting('opening', 'day'),
    home: readSetting('home', 'MX'),
    spin: readSetting('spin', true),
    sun: 0,
    id: 'MX',
    section: hashed?.section || 'historia',
    collapsed: false,
    hover: null,
    indicator: 'lifeExp',
    content: {},
    place: null,
    hits: [],
    toast: null,
    legend: null,
    radio: radio.state,
    game: null,
    tour: null,
    compare: null,
    picking: false,
    playmenu: false,
    city: null,
  });
  document.documentElement.lang = lang;
  radio.subscribe((r) => store.set({ radio: r }));

  try {
    world = await loadWorld(base);
  } catch (error) {
    console.error(error);
    bootError.hidden = false;
    bootError.textContent = t(lang, 'boot');
    return;
  }
  play = createPlay({ store, world, surface: () => surface, select, flyToCountry });
  // Phase two of the data (places, radio, cities, indicators) streams in
  // while the globe is already up. Nothing below the surface mount waits on it.
  const extras = loadExtras(world, base);
  store.set({ id: null });

  const ui = document.getElementById('ui');
  const draw = () => {
    const s = store.get();
    document.body.classList.toggle('collapsed', s.collapsed);
    document.body.classList.toggle('empty', !s.id && !s.game);
    document.body.classList.toggle('picking', Boolean(s.picking));
    render(shell(s), ui);
    const next = buildHash({ iso: s.id?.length === 2 ? s.id : null, placeId: s.id?.length === 2 ? null : s.id, section: s.section, city: s.city?.id || null, lang: s.lang });
    if (location.hash !== next) history.replaceState(null, '', next);
    const name = s.city ? (s.city.name?.[s.lang] || s.city.name?.en) : countryOf(s.id)?.name?.[s.lang];
    document.title = name ? `${name} · Giramundo` : 'Giramundo';
  };
  store.subscribe(draw);
  draw();
  // Debug handle for the console; not part of the public surface.
  window.giramundo = { store, on, select, get world() { return world; }, get surface() { return surface; } };

  const webgl = canWebGL();
  if (!webgl && !store.get().flat) { store.set({ flat: true }); toast(t(lang, 'webglMissing')); }
  try {
    await mountSurface(store.get().flat);
  } catch (error) {
    console.error(error);
    if (!store.get().flat) { store.set({ flat: true }); await mountSurface(true); }
  }

  await extras;
  // Which country opens: the link wins; otherwise the reader's setting.
  let opening = null;
  if (hashed?.iso && world.byIso.get(hashed.iso)) opening = hashed.iso;
  else if (hashed?.placeId && world.byPlace.get(hashed.placeId)) opening = hashed.placeId;
  else opening = await chooseOpening(store.get());
  select(opening, { fly: true });
  if (readSetting('coached', false)) document.getElementById('coach').hidden = true;
  setTimeout(() => { document.getElementById('coach').hidden = true; writeSetting('coached', true); }, 9000);

  window.addEventListener('hashchange', () => {
    const next = parseHash(location.hash);
    if (!next) return;
    const s = store.get();
    if (next.lang && next.lang !== s.lang) on('lang');
    const id = next.iso || next.placeId;
    if (next.city) {
      const city = (world.cities?.[next.iso] || []).find((c) => c.id === next.city);
      if (city && city.id !== s.city?.id) openCity(city);
      return;
    }
    if (s.city && !next.city) closeCity();
    if (id && id !== s.id && countryOf(id)) select(id, { section: next.section || s.section });
    else if (next.section && next.section !== s.section) on('section', next.section);
  });
  if (hashed?.city) {
    const city = (world.cities?.[hashed.iso] || []).find((c) => c.id === hashed.city);
    if (city) openCity(city);
  }

  setInterval(() => {
    const lang = store.get().lang;
    for (const el of document.querySelectorAll('.js-time[data-zone]')) el.textContent = formatTime(el.dataset.zone, lang);
  }, 15000);
  setInterval(syncMarkers, 900);
  setInterval(() => { if (store.get().tour?.playing) store.set({ tick: Date.now() }); }, 400);
  // Performance readout, refreshed only while the settings dialog is open.
  setInterval(() => {
    if (!document.getElementById('settings')?.open || !surface) return;
    const info = surface.getInfo ? surface.getInfo() : { fps: Math.round(surface.getFps()), gpu: 'Canvas 2D', width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio };
    store.set({ perf: info });
  }, 1000);
  watchPerformance();

  window.addEventListener('keydown', (event) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (event.key === '/' && !typing) { event.preventDefault(); document.getElementById('q').focus(); return; }
    if (event.key === 'Escape') { document.getElementById('about')?.close(); }
    if (typing || !surface) return;
    const step = 28;
    if (event.key === 'ArrowLeft') surface.control?.nudge(-step, 0);
    else if (event.key === 'ArrowRight') surface.control?.nudge(step, 0);
    else if (event.key === 'ArrowUp') surface.control?.nudge(0, -step);
    else if (event.key === 'ArrowDown') surface.control?.nudge(0, step);
    else if (event.key === '+' || event.key === '=') surface.control?.zoomBy(0.85);
    else if (event.key === '-' || event.key === '_') surface.control?.zoomBy(1.18);
    else if (event.key === 'Enter') {
      const feature = world.index.find(surface.view.lon, surface.view.lat);
      const country = countryOfFeature(feature);
      if (country) select(country.iso2 || country.placeId);
    }
  });
}
