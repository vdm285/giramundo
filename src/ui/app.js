import { loadWorld } from '../data/load.js';
import { searchCountries } from '../data/search.js';
import { ALIAS_NOTES, norm } from '../data/aliases.js';
import { buildHash, parseHash } from '../data/hash.js';
import { buildJourneys } from '../data/journeys.js';
import { gentleItems, loadStory, loadToday, liveSummary } from '../data/content.js';
import { formatTime } from '../data/format.js';
import { nameWater } from '../geo/oceans.js';
import { createGlobe } from '../globe/scene.js';
import { renderCard, speechText } from './card.js';
import { t } from './i18n.js';

const base = import.meta.env.BASE_URL;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ui = {
  lang: localStorage.getItem('globo-lang') || 'es',
  kids: localStorage.getItem('globo-kids') === '1',
  atlas: localStorage.getItem('globo-atlas') === '1',
  spin: localStorage.getItem('globo-spin') !== '0',
  tab: 'historia',
  iso: 'MX',
  placeId: null,
  sun: 0,
  compareIso: null,
  pickingCompare: false,
  quiz: null,
  tour: null,
};

let world;
let globe;
let story = null;
let today = null;
let storyToken = 0;
let hoverKey = '';
let sheetOpen = false;
let home = readHome();
let deferredPrompt = null;

const card = () => document.getElementById('card');
const toastEl = () => document.getElementById('toast');

function readHome() {
  try {
    const saved = JSON.parse(localStorage.getItem('globo-home') || 'null');
    if (saved?.lat != null) return saved;
  } catch { /* keep the default */ }
  return { lat: 19.4326, lon: -99.1332, label: 'Ciudad de México' };
}

function countryNow() {
  if (ui.placeId) return world.byPlace.get(ui.placeId) || null;
  return world.byIso.get(ui.iso) || null;
}

function featureOf(country) {
  if (!country) return null;
  return world.features.find((feature) => (
    (country.iso2 && feature.properties.iso2 === country.iso2)
    || (country.placeId && feature.properties.placeId === country.placeId)
  )) || null;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function toast(message) {
  const el = toastEl();
  el.textContent = message;
  el.hidden = !message;
  clearTimeout(toast.timer);
  if (message) toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
}

function persist() {
  localStorage.setItem('globo-lang', ui.lang);
  localStorage.setItem('globo-kids', ui.kids ? '1' : '0');
  localStorage.setItem('globo-atlas', ui.atlas ? '1' : '0');
  localStorage.setItem('globo-spin', ui.spin ? '1' : '0');
}

function writeHash() {
  const next = buildHash({
    iso: ui.placeId ? null : ui.iso,
    placeId: ui.placeId,
    tab: ui.tab,
    kids: ui.kids,
    lang: ui.lang,
  });
  if (location.hash !== next) history.replaceState(null, '', next);
}

function applyChrome() {
  document.body.classList.toggle('kids', ui.kids);
  document.body.classList.toggle('atlas', ui.atlas);
  document.documentElement.lang = ui.lang === 'en' ? 'en' : 'es';
  const input = document.getElementById('q');
  input.placeholder = t(ui.lang, 'search');
  document.getElementById('kids').setAttribute('aria-checked', ui.kids ? 'true' : 'false');
  document.getElementById('kidsLabel').textContent = t(ui.lang, 'kids');
  document.getElementById('lang').textContent = t(ui.lang, 'langSwitch');
  document.getElementById('coach').textContent = t(ui.lang, 'coach');
  const dock = document.getElementById('dock');
  dock.innerHTML = [
    ['surprise', t(ui.lang, 'surprise')],
    ['quiz', t(ui.lang, 'quiz')],
    ['atlas', ui.atlas ? t(ui.lang, 'earth') : t(ui.lang, 'atlas')],
    ['more', t(ui.lang, 'more')],
  ].map(([action, label]) => `<button type="button" data-action="${action}" ${action === 'atlas' && ui.atlas ? 'aria-pressed="true"' : ''}>${esc(label)}</button>`).join('');
  globe?.setAtlas(ui.atlas);
  globe?.setSpin(ui.spin && !reduced);
}

function render() {
  const country = countryNow();
  applyChrome();
  const root = card();
  root.classList.toggle('open', sheetOpen);
  if (ui.quiz?.done) {
    const name = ui.lang === 'es' ? 'Ronda lista' : 'Round complete';
    root.innerHTML = `
      <button class="handle" type="button" data-action="sheet"></button>
      <div class="quiz-card">
        <h2>${esc(name)}</h2>
        <p class="lede">${ui.quiz.hits} / ${ui.quiz.total} ${esc(t(ui.lang, 'quizScore'))}</p>
        <div class="acts">
          <button class="btn solid" type="button" data-action="quiz">${esc(t(ui.lang, 'quizAgain'))}</button>
          <button class="btn" type="button" data-action="quiz-close">${esc(t(ui.lang, 'close'))}</button>
        </div>
      </div>`;
  } else {
    root.innerHTML = renderCard({
      lang: ui.lang,
      kids: ui.kids,
      country,
      tab: ui.tab,
      story,
      today,
      home,
      mexico: world.mexico,
      compare: ui.compareIso ? world.byIso.get(ui.compareIso) : null,
      loading: ui.loading,
      index: world.index,
      byIso: world.byIso,
      byPlace: world.byPlace,
      countries: world.countries,
      built: world.built,
      quiz: ui.quiz,
      tour: ui.tour,
    });
  }
  const name = country?.name?.[ui.lang] || country?.name?.en;
  document.title = name ? `${name} · Globo Curioso` : 'Globo Curioso';
  const live = document.getElementById('live');
  if (name && live.textContent !== name) live.textContent = name;
  writeHash();
  const feature = featureOf(country);
  if (ui.quiz && !ui.quiz.done) {
    globe?.hideRing();
    globe?.setHighlight(null, null);
  } else if (globe && feature) {
    globe.setHighlight(feature, null);
    if (country?.ll) globe.setRing(country.ll[0], country.ll[1]);
  }
}

async function ensureStory(country) {
  if (!country?.iso2) { story = null; return; }
  const token = ++storyToken;
  ui.loading = true;
  const local = await loadStory(country.iso2, base);
  if (token !== storyToken) return;
  story = local;
  const needsLive = !local?.[ui.lang]?.historia?.extract;
  ui.loading = needsLive;
  render();
  if (!needsLive) return;
  const live = await liveSummary(ui.lang, country.name[ui.lang] || country.name.en);
  if (token !== storyToken) return;
  story = story || { es: {}, en: {} };
  story[ui.lang] = { ...(story[ui.lang] || {}), historia: story[ui.lang]?.historia || live };
  ui.loading = false;
  render();
}

async function ensureToday() {
  today = await loadToday(ui.lang);
  if (ui.kids && today) {
    today = {
      ...today,
      events: gentleItems(today.events, true),
      news: gentleItems(today.news, true),
    };
  }
  if (ui.tab === 'hoy') render();
}

function focusCountry(country, { extra = 0, open = true, fly = true } = {}) {
  if (!country) return;
  ui.iso = country.iso2 || null;
  ui.placeId = country.placeId || null;
  if (open) sheetOpen = true;
  hoverKey = '';
  render();
  if (fly && country.ll && globe) {
    const dist = country.onMap ? 2.55 : 1.72;
    globe.flyTo(country.ll[0], country.ll[1], dist, extra);
  }
  ensureStory(country);
  syncPins();
}

function selectById(id, opts) {
  const country = world.byIso.get(id) || world.byPlace.get(id);
  if (!country) return;
  if (ui.pickingCompare && country.iso2 && country.iso2 !== ui.iso) {
    ui.compareIso = country.iso2;
    ui.pickingCompare = false;
    toast('');
    render();
    return;
  }
  focusCountry(country, opts);
}

function gradeQuiz(country) {
  const quiz = ui.quiz;
  if (!quiz || quiz.done) return;
  const target = quiz.rounds[quiz.index];
  const hit = country && country.iso2 === target.iso2;
  quiz.marks[quiz.index] = hit ? 'hit' : 'miss';
  if (hit) quiz.hits += 1;
  const targetName = target.name[ui.lang] || target.name.en;
  const got = country?.name?.[ui.lang] || country?.name?.en;
  toast(hit
    ? t(ui.lang, 'quizHit')
    : `${t(ui.lang, 'quizMiss')} ${got || '…'}. ${targetName} ${t(ui.lang, 'quizHere')}.`);
  if (target.ll && globe) globe.flyTo(target.ll[0], target.ll[1], 2.4, 0);
  quiz.index += 1;
  if (quiz.index >= quiz.total) {
    quiz.done = true;
    ui.iso = target.iso2;
    render();
    return;
  }
  quiz.target = quiz.rounds[quiz.index];
  render();
  if (ui.kids) speak(speechText({ lang: ui.lang, country: quiz.target, tab: 'historia', story: null, kids: true }).split('.')[0]);
}

function startQuiz() {
  const pool = world.countries.filter((c) => c.onMap && c.iso2 && c.iso2 !== 'AQ' && (c.area || 0) > (ui.kids ? 450000 : 160000));
  const rounds = [];
  const used = new Set();
  while (rounds.length < 5 && used.size < pool.length) {
    const country = pool[Math.floor(Math.random() * pool.length)];
    if (used.has(country.iso2)) continue;
    used.add(country.iso2);
    rounds.push(country);
  }
  ui.quiz = { rounds, index: 0, total: rounds.length, hits: 0, marks: rounds.map(() => ''), target: rounds[0], done: false };
  ui.tour = null;
  sheetOpen = true;
  render();
  if (ui.kids && rounds[0]) speak(`${t(ui.lang, 'quizFind')} ${rounds[0].name[ui.lang] || rounds[0].name.en}`);
}

function stopTour() {
  clearTimeout(ui.tour?.timer);
  ui.tour = null;
  render();
}

function playTour(journey) {
  stopTour();
  document.getElementById('more')?.close();
  const stops = journey.stops.map((iso) => world.byIso.get(iso)).filter(Boolean);
  if (!stops.length) return;
  ui.quiz = null;
  const step = (index) => {
    const country = stops[index];
    ui.tour = { title: journey.title, index, total: stops.length, timer: null };
    focusCountry(country, { open: true });
    if (index + 1 < stops.length) {
      ui.tour.timer = setTimeout(() => step(index + 1), reduced ? 200 : 3600);
    }
  };
  step(0);
}

function syncPins() {
  if (!globe) return;
  const dist = globe.view.dist;
  const pins = world.countries.filter((c) => c.ll && c.iso2 && !c.onMap && (dist < 2.4 || c.iso2 === ui.iso));
  globe.setPins(pins.map((c) => ({ lat: c.ll[0], lon: c.ll[1], iso2: c.iso2 })));
}

function pinHit(x, y) {
  if (!globe || globe.view.dist > 2.5) return null;
  let best = null;
  let bestD = 22;
  for (const country of world.countries) {
    if (!country.ll || country.onMap) continue;
    const p = globe.project(country.ll[0], country.ll[1]);
    if (!p) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { best = country; bestD = d; }
  }
  return best;
}

function onGlobeClick(event) {
  document.getElementById('coach').hidden = true;
  localStorage.setItem('globo-coach', '1');
  const pin = pinHit(event.clientX, event.clientY);
  const ll = globe.pickLatLon(event.clientX, event.clientY);
  const feature = pin ? featureOf(pin) : (ll && world.index.find(ll.lon, ll.lat));
  const country = pin || (feature && (
    world.byIso.get(feature.properties.iso2) || world.byPlace.get(feature.properties.placeId)
  ));
  if (ui.quiz && !ui.quiz.done) {
    gradeQuiz(country || null);
    return;
  }
  if (country) {
    selectById(country.iso2 || country.placeId);
    return;
  }
  if (ll) toast(`${t(ui.lang, 'ocean')}: ${nameWater(ll.lat, ll.lon, ui.lang)} (${t(ui.lang, 'approx')}).`);
}

function fillMore() {
  const journeys = buildJourneys(world.countries, ui.lang);
  const jumps = [
    ['North America', ui.lang === 'es' ? 'América del Norte' : 'North America', 22, -100],
    ['South America', ui.lang === 'es' ? 'América del Sur' : 'South America', -15, -60],
    ['Europe', ui.lang === 'es' ? 'Europa' : 'Europe', 50, 10],
    ['Africa', ui.lang === 'es' ? 'África' : 'Africa', 4, 18],
    ['Asia', 'Asia', 28, 88],
    ['Oceania', ui.lang === 'es' ? 'Oceanía' : 'Oceania', -22, 135],
  ];
  document.getElementById('more').innerHTML = `
    <form method="dialog"><button class="icon-x" value="cancel" aria-label="${esc(t(ui.lang, 'close'))}">×</button></form>
    <h2>${esc(t(ui.lang, 'moreTitle'))}</h2>
    <label class="row"><input id="spinToggle" type="checkbox" ${ui.spin ? 'checked' : ''}> ${esc(t(ui.lang, 'spin'))}</label>
    <label class="row">${esc(t(ui.lang, 'sun'))} <input id="sun" type="range" min="-12" max="12" step="0.5" value="${ui.sun}"></label>
    <p class="muted">${esc(t(ui.lang, 'sunHelp'))}</p>
    <button class="btn" type="button" data-action="sun-now">${esc(t(ui.lang, 'sunNow'))}</button>
    <h3>${esc(t(ui.lang, 'home'))}</h3>
    <p>${esc(home.label)} · ${home.lat.toFixed(1)}, ${home.lon.toFixed(1)}</p>
    <div class="acts">
      <button class="btn" type="button" data-action="locate">${esc(t(ui.lang, 'useLocation'))}</button>
      <button class="btn" type="button" data-action="reset-home">${esc(t(ui.lang, 'resetHome'))}</button>
      <button class="btn" type="button" data-action="go-home">${esc(t(ui.lang, 'home'))}</button>
    </div>
    <h3>${esc(t(ui.lang, 'tours'))}</h3>
    <div class="tourlist">${journeys.map((j) => `<button type="button" data-action="tour" data-tour="${j.id}"><strong>${esc(j.title)}</strong><span>${esc(j.blurb)}</span></button>`).join('')}</div>
    <h3>${esc(t(ui.lang, 'continent'))}</h3>
    <div class="chips">${jumps.map((j) => `<button type="button" class="chip" data-action="jump" data-lat="${j[2]}" data-lon="${j[3]}">${esc(j[1])}</button>`).join('')}</div>
    <div class="acts">
      <button class="btn" type="button" data-action="about">${esc(t(ui.lang, 'about'))}</button>
      ${deferredPrompt ? `<button class="btn" type="button" data-action="install">${esc(t(ui.lang, 'install'))}</button>` : ''}
    </div>`;
  document.getElementById('spinToggle').addEventListener('change', (event) => {
    ui.spin = event.target.checked;
    persist();
    globe?.setSpin(ui.spin && !reduced);
  });
  document.getElementById('sun').addEventListener('input', (event) => {
    ui.sun = Number(event.target.value);
    globe?.setSunOffset(ui.sun);
  });
}

function fillAbout() {
  document.getElementById('about').innerHTML = `
    <form method="dialog"><button class="icon-x" value="cancel" aria-label="${esc(t(ui.lang, 'close'))}">×</button></form>
    <h2>${esc(t(ui.lang, 'about'))}</h2>
    <p>${esc(t(ui.lang, 'aboutLead'))}</p>
    <p>${esc(t(ui.lang, 'aboutP2'))}</p>
    <p>${esc(t(ui.lang, 'aboutP3'))}</p>
    <p>${esc(t(ui.lang, 'aboutP4'))}</p>
    <p><a href="https://github.com/vdm285/interactive-globe" target="_blank" rel="noreferrer">github.com/vdm285/interactive-globe</a></p>`;
}

function speak(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = ui.lang === 'es' ? 'es-MX' : 'en-US';
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang === utter.lang) || voices.find((v) => v.lang?.toLowerCase().startsWith(ui.lang));
  if (voice) utter.voice = voice;
  window.speechSynthesis.speak(utter);
}

function canWebGL() {
  try {
    const test = document.createElement('canvas');
    return Boolean(test.getContext('webgl2') || test.getContext('webgl'));
  } catch {
    return false;
  }
}

function showFallback() {
  const root = document.getElementById('fallback');
  root.hidden = false;
  root.innerHTML = `<p>${esc(t(ui.lang, 'fallback'))}</p><div class="fallback-list">${
    world.countries.filter((c) => c.iso2).sort((a, b) => (a.name[ui.lang] || a.name.en).localeCompare(b.name[ui.lang] || b.name.en, ui.lang))
      .map((c) => `<button type="button" data-action="go" data-iso="${c.iso2}">${esc(c.name[ui.lang] || c.name.en)}</button>`).join('')
  }</div>`;
}

export async function boot() {
  const bootError = document.getElementById('boot-error');
  try {
    world = await loadWorld(base);
  } catch (error) {
    console.error(error);
    bootError.hidden = false;
    bootError.textContent = t(ui.lang, 'boot');
    return;
  }
  const hashed = parseHash(location.hash);
  if (hashed?.iso && world.byIso.get(hashed.iso)) ui.iso = hashed.iso;
  if (hashed?.placeId && world.byPlace.get(hashed.placeId)) ui.placeId = hashed.placeId;
  if (hashed?.tab) ui.tab = hashed.tab;
  if (hashed?.kids) ui.kids = true;
  if (hashed?.lang) ui.lang = hashed.lang;

  if (localStorage.getItem('globo-coach') === '1') document.getElementById('coach').hidden = true;

  if (canWebGL()) {
    try {
      globe = await createGlobe(document.getElementById('c'), world.features, base);
      globe.setAtlas(ui.atlas);
      globe.setSpin(ui.spin && !reduced);
      globe.onClick(onGlobeClick);
      globe.onHover((event) => {
        if (!globe || event.pointerType === 'touch' || ui.quiz) return;
        const ll = globe.pickLatLon(event.clientX, event.clientY);
        const feature = ll && world.index.find(ll.lon, ll.lat);
        const key = feature?.properties.iso2 || feature?.properties.placeId || '';
        const tip = document.getElementById('tip');
        if (!key) { tip.hidden = true; if (hoverKey) { hoverKey = ''; globe.setHighlight(featureOf(countryNow()), null); } return; }
        const country = world.byIso.get(feature.properties.iso2) || world.byPlace.get(feature.properties.placeId);
        tip.hidden = false;
        tip.style.left = `${event.clientX}px`;
        tip.style.top = `${event.clientY}px`;
        tip.textContent = country?.name?.[ui.lang] || country?.name?.en || feature.properties.name;
        if (key !== hoverKey) {
          hoverKey = key;
          globe.setHighlight(featureOf(countryNow()), feature);
        }
      });
      const country = countryNow();
      if (country?.ll) globe.flyTo(country.ll[0], country.ll[1], country.onMap ? 3.15 : 1.8, 0);
    } catch (error) {
      console.error(error);
      showFallback();
    }
  } else {
    showFallback();
  }

  render();
  ensureStory(countryNow());
  ensureToday();
  syncPins();
  setInterval(syncPins, 800);
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-zone] .js-time')) {
      el.textContent = formatTime(el.parentElement.dataset.zone, ui.lang);
    }
  }, 15000);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  }

  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'lang') {
      ui.lang = ui.lang === 'es' ? 'en' : 'es';
      persist();
      today = null;
      ensureToday();
      ensureStory(countryNow());
      render();
    } else if (action === 'kids') {
      ui.kids = !ui.kids;
      persist();
      if (today) ensureToday();
      render();
    } else if (action === 'atlas') {
      ui.atlas = !ui.atlas;
      persist();
      render();
    } else if (action === 'more') {
      fillMore();
      document.getElementById('more').showModal();
    } else if (action === 'about') {
      document.getElementById('more')?.close();
      fillAbout();
      document.getElementById('about').showModal();
    } else if (action === 'surprise') {
      const pool = world.countries.filter((c) => c.ll && c.iso2 && c.iso2 !== ui.iso && c.iso2 !== 'AQ');
      const pick = pool[Math.floor(Math.random() * pool.length)];
      ui.quiz = null;
      selectById(pick.iso2, { extra: 1 });
    } else if (action === 'quiz') {
      startQuiz();
    } else if (action === 'quiz-close') {
      ui.quiz = null;
      render();
    } else if (action === 'sheet') {
      sheetOpen = !sheetOpen;
      card().classList.toggle('open', sheetOpen);
    } else if (action === 'tab') {
      ui.tab = button.dataset.tab;
      if (ui.tab === 'hoy' && !today) ensureToday();
      render();
    } else if (action === 'go') {
      const query = document.getElementById('q').value;
      const id = button.dataset.iso;
      const note = ALIAS_NOTES[norm(query)];
      ui.quiz = null;
      selectById(id);
      if (note && (note.iso === id)) toast(note[ui.lang]);
      document.getElementById('suggest').innerHTML = '';
      document.getElementById('q').value = '';
    } else if (action === 'speak') {
      speak(speechText({ lang: ui.lang, country: countryNow(), tab: ui.tab, story, kids: ui.kids }));
    } else if (action === 'share') {
      const url = `${location.origin}${location.pathname}${location.search}${location.hash}`;
      const title = countryNow()?.name?.[ui.lang] || 'Globo Curioso';
      if (navigator.share) navigator.share({ title, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast(t(ui.lang, 'copied')));
    } else if (action === 'compare') {
      ui.pickingCompare = true;
      toast(t(ui.lang, 'pickSecond'));
      document.getElementById('q').focus();
    } else if (action === 'clear-compare') {
      ui.compareIso = null;
      ui.pickingCompare = false;
      render();
    } else if (action === 'tour') {
      const journey = buildJourneys(world.countries, ui.lang).find((j) => j.id === button.dataset.tour);
      if (journey) playTour(journey);
    } else if (action === 'stop-tour') {
      stopTour();
    } else if (action === 'jump') {
      document.getElementById('more')?.close();
      globe?.flyTo(Number(button.dataset.lat), Number(button.dataset.lon), 3.3, 0);
    } else if (action === 'sun-now') {
      ui.sun = 0;
      globe?.setSunOffset(0);
      const slider = document.getElementById('sun');
      if (slider) slider.value = '0';
    } else if (action === 'locate') {
      if (!navigator.geolocation) { toast(t(ui.lang, 'locFail')); return; }
      navigator.geolocation.getCurrentPosition((pos) => {
        home = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: ui.lang === 'es' ? 'Tu ubicación' : 'Your location',
        };
        localStorage.setItem('globo-home', JSON.stringify(home));
        document.getElementById('more')?.close();
        globe?.flyTo(home.lat, home.lon, 2.3, 0);
        const feature = world.index.find(home.lon, home.lat);
        const found = feature && (world.byIso.get(feature.properties.iso2) || world.byPlace.get(feature.properties.placeId));
        if (found) selectById(found.iso2 || found.placeId);
        else render();
      }, () => toast(t(ui.lang, 'locFail')), { enableHighAccuracy: false, timeout: 8000 });
    } else if (action === 'reset-home') {
      home = { lat: 19.4326, lon: -99.1332, label: 'Ciudad de México' };
      localStorage.removeItem('globo-home');
      render();
    } else if (action === 'go-home') {
      document.getElementById('more')?.close();
      globe?.flyTo(home.lat, home.lon, 2.2, 0);
      const feature = world.index.find(home.lon, home.lat);
      const found = feature && (world.byIso.get(feature.properties.iso2) || world.byPlace.get(feature.properties.placeId));
      if (found) selectById(found.iso2 || found.placeId, { fly: false });
    } else if (action === 'install' && deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
    }
  });

  const form = document.getElementById('searchForm');
  const input = document.getElementById('q');
  const suggest = document.getElementById('suggest');
  input.addEventListener('input', () => {
    const hits = searchCountries(world.countries, input.value);
    suggest.innerHTML = hits.map((c) => {
      const name = c.name[ui.lang] || c.name.en;
      return `<button type="button" data-action="go" data-iso="${esc(c.iso2 || c.placeId)}">${esc(name)}</button>`;
    }).join('');
    suggest.hidden = !hits.length;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const hits = searchCountries(world.countries, input.value, 1);
    if (!hits[0]) return;
    const note = ALIAS_NOTES[norm(input.value)];
    ui.quiz = null;
    selectById(hits[0].iso2 || hits[0].placeId);
    if (note && note.iso === (hits[0].iso2)) toast(note[ui.lang]);
    suggest.innerHTML = '';
    input.value = '';
  });

  window.addEventListener('keydown', (event) => {
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (event.key === '/' && !typing) { event.preventDefault(); input.focus(); return; }
    if (event.key === 'Escape') {
      document.getElementById('more')?.close();
      document.getElementById('about')?.close();
      ui.pickingCompare = false;
    }
    if (typing || !globe) return;
    if (event.key === 'ArrowLeft') globe.nudge(-28, 0);
    else if (event.key === 'ArrowRight') globe.nudge(28, 0);
    else if (event.key === 'ArrowUp') globe.nudge(0, -22);
    else if (event.key === 'ArrowDown') globe.nudge(0, 22);
    else if (event.key === '+' || event.key === '=') globe.zoom(0.9);
    else if (event.key === '-' || event.key === '_') globe.zoom(1.1);
    else if (event.key === 'Enter') {
      const feature = world.index.find(globe.view.lon, globe.view.lat);
      const country = feature && (world.byIso.get(feature.properties.iso2) || world.byPlace.get(feature.properties.placeId));
      if (country) selectById(country.iso2 || country.placeId);
    }
  });
}
