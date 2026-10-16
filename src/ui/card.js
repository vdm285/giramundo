import { antipode, haversineKm } from '../geo/math.js';
import { nameWater } from '../geo/oceans.js';
import { disputeNote } from '../data/disputed.js';
import {
  continentLabel, currencyLabel, displayCapital, familyQuestion, formatCompact, formatCount,
  formatTime, languageNames, mainZone, sentences, sizeVersus, zoneSentence,
} from '../data/format.js';
import { t } from './i18n.js';

const TABS = ['historia', 'comida', 'cultura', 'viajes', 'hoy'];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function safeThumb(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    if (!/(^|\.)wikipedia\.org$|(^|\.)wikimedia\.org$/.test(parsed.hostname)) return '';
    return esc(parsed.href);
  } catch {
    return '';
  }
}

function wikiSearch(lang, query) {
  const host = lang === 'en' ? 'en.wikipedia.org' : 'es.wikipedia.org';
  return `https://${host}/wiki/Special:Search?search=${encodeURIComponent(query)}`;
}

function antipodeLine(country, index, lang) {
  if (!country.ll) return '';
  const spot = antipode(country.ll[0], country.ll[1]);
  const hit = index.find(spot.lon, spot.lat);
  const name = country.name[lang] || country.name.en;
  if (hit) {
    const other = hit.properties.iso2
      ? null
      : (hit.properties.name);
    return { spot, feature: hit, otherName: other };
  }
  return { spot, water: nameWater(spot.lat, spot.lon, lang) };
}

export function renderCard(model) {
  const {
    lang, kids, country, tab, story, today, home, mexico, compare, loading,
    index, built, quiz, tour,
  } = model;
  if (!country && !quiz) {
    return `<p class="empty">${esc(t(lang, 'coach'))}</p>`;
  }
  if (quiz && !quiz.reveal) {
    const target = quiz.target;
    const name = target.name[lang] || target.name.en;
    return `
      <button class="handle" type="button" data-action="sheet" aria-label="${esc(t(lang, 'more'))}"></button>
      <div class="quiz-card">
        <p class="eyebrow">${esc(t(lang, 'quizRound'))} ${quiz.index + 1} ${esc(t(lang, 'quizOf'))} ${quiz.total}</p>
        <h2>${esc(t(lang, 'quizFind'))} ${esc(name)}?</h2>
        <p class="lede">${esc(lang === 'es' ? 'Gira el globo y toca el país.' : 'Spin the globe and tap the country.')}</p>
        <div class="qdots">${quiz.marks.map((mark) => `<i class="${mark}"></i>`).join('')}</div>
      </div>`;
  }

  const name = country.name[lang] || country.name.en;
  const capital = displayCapital(country, lang);
  const zone = mainZone(country);
  const time = formatTime(zone, lang);
  const manyZones = (country.timezones || []).length > 1;
  const timeLabel = manyZones ? t(lang, 'capitalTime') : t(lang, 'localTime');
  const flag = country.flag ? `<img class="flag" alt="" src="${esc(import.meta.env.BASE_URL + country.flag)}" width="44" height="30">` : `<span class="badge">${esc((country.iso2 || name).slice(0, 2))}</span>`;
  const pop = country.population
    ? `${formatCount(country.population, lang)}${country.popYear ? ` · ${country.popYear}` : ''}`
    : '';
  const area = country.area ? `${formatCount(Math.round(country.area), lang)} km²` : '';
  const langs = languageNames(country.languages, lang).join(', ');
  const money = currencyLabel(country.currencies?.[0], lang);
  const density = country.population && country.area
    ? `${formatCount(Math.round(country.population / country.area), lang)} ${t(lang, 'perKm')}`
    : '';
  const homeKm = country.ll && home
    ? Math.round(haversineKm({ lat: country.ll[0], lon: country.ll[1] }, home))
    : null;
  const size = mexico && country.iso2 !== 'MX'
    ? sizeVersus(country.area, name, mexico.area, mexico.name[lang] || mexico.name.es, lang)
    : '';
  const anti = country.ll ? antipodeLine(country, index, lang) : null;
  let dig = '';
  if (anti?.feature) {
    const other = anti.feature.properties.iso2
      ? model.byIso.get(anti.feature.properties.iso2)
      : model.byPlace.get(anti.feature.properties.placeId);
    const otherName = other?.name?.[lang] || other?.name?.en || anti.feature.properties.name;
    dig = `${t(lang, 'dig')} ${name}, ${t(lang, 'digOut')} ${otherName}.`;
  } else if (anti?.water) {
    dig = `${t(lang, 'dig')} ${name}, ${t(lang, 'digWater')} ${anti.water} (${t(lang, 'approx')}).`;
  }
  const zoneLine = country.ll ? zoneSentence(country.ll[0], lang) : '';
  const dispute = disputeNote(country.iso2 || country.placeId, lang, kids);
  const page = story?.[lang]?.[tab] || null;
  const maxChars = kids ? 280 : 720;

  const facts = [
    capital && country.iso2 !== 'PS' ? [t(lang, 'capital'), capital] : null,
    pop ? [t(lang, 'population'), pop] : null,
    area ? [t(lang, 'area'), area] : null,
    langs ? [t(lang, 'languages'), langs] : null,
    money ? [t(lang, 'currency'), money] : null,
    density ? [t(lang, 'density'), density] : null,
    time ? [timeLabel, time, zone] : null,
    country.calling ? [t(lang, 'calling'), `+${esc(country.calling)}`] : null,
    country.continent ? [t(lang, 'continent'), continentLabel(country.continent, lang)] : null,
  ].filter(Boolean);

  const body = renderTab({
    lang, kids, tab, page, loading, country, name, zoneLine, today, story,
  });

  const neighbors = (country.borders || [])
    .map((iso) => model.byIso.get(iso))
    .filter(Boolean);
  const nearLabel = neighbors.length ? t(lang, 'neighbors') : t(lang, 'nearest');
  const near = neighbors.length ? neighbors : nearest(country, model.countries, 3);

  const compareBlock = compare ? renderCompare(country, compare, lang) : '';
  const tourBlock = tour ? `<p class="tourbar">${esc(tour.title)} · ${tour.index + 1}/${tour.total} <button type="button" data-action="stop-tour">${esc(t(lang, 'tourStop'))}</button></p>` : '';

  return `
    ${tourBlock}
    <button class="handle" type="button" data-action="sheet">${esc(name)}</button>
    <header class="card-head">
      <div class="title-row">
        ${flag}
        <div>
          <p class="eyebrow">${esc((country.official?.[lang] || '') !== name ? (country.official?.[lang] || '') : '')}</p>
          <h2 id="cname">${esc(name)}</h2>
          <p class="kicker">${[
            capital,
            time && `${timeLabel} ${time}`,
            homeKm != null ? `${formatCount(homeKm, lang)} km ${t(lang, 'fromHome')}` : '',
          ].filter(Boolean).map(esc).join(' · ')}</p>
        </div>
      </div>
      <div class="acts">
        <button class="btn" type="button" data-action="speak">${esc(t(lang, 'speak'))}</button>
        <button class="btn" type="button" data-action="share">${esc(t(lang, 'share'))}</button>
        ${country.iso2 ? `<button class="btn" type="button" data-action="compare">${esc(t(lang, 'compare'))}</button>` : ''}
      </div>
    </header>
    ${!country.onMap && country.iso2 ? `<p class="note">${esc(t(lang, 'small'))}</p>` : ''}
    ${dispute ? `<aside class="dispute"><strong>${esc(lang === 'es' ? 'Frontera en disputa' : 'Disputed border')}</strong><p>${esc(dispute)}</p></aside>` : ''}
    <div class="hook">
      <p class="eyebrow">${esc(t(lang, 'didYou'))}</p>
      ${dig ? `<p>${esc(dig)}</p>` : ''}
      ${size ? `<p>${esc(size)}</p>` : ''}
      ${zoneLine ? `<p>${esc(zoneLine)}</p>` : ''}
    </div>
    <div class="statgrid">${facts.map(([k, v, zoneId]) => `<div${zoneId ? ` data-zone="${esc(zoneId)}"` : ''}><span>${esc(k)}</span><strong${zoneId ? ' class="js-time"' : ''}>${esc(v)}</strong></div>`).join('')}</div>
    <div class="tabs" role="tablist">
      ${TABS.map((id) => `<button type="button" class="tab" role="tab" data-action="tab" data-tab="${id}" aria-selected="${id === tab}" id="tab-${id}">${esc(t(lang, `tab${id[0].toUpperCase()}${id.slice(1)}`))}</button>`).join('')}
    </div>
    <div class="tabbody" id="tabbody" role="tabpanel">${body}</div>
    ${compareBlock}
    <div class="near"><span>${esc(nearLabel)}</span>${near.map((c) => `<button type="button" class="chip" data-action="go" data-iso="${esc(c.iso2 || c.placeId)}">${esc(c.name[lang] || c.name.en)}</button>`).join('') || `<em>${esc(t(lang, 'noBorder'))}</em>`}</div>
    ${kids ? `<p class="family"><strong>${esc(t(lang, 'family'))}</strong> ${esc(familyQuestion(name, lang))}</p>` : `<p class="family">${esc(familyQuestion(name, lang))}</p>`}
    <p class="src">${esc(t(lang, 'sources'))}: Wikipedia (CC BY-SA)${country.popYear ? `, World Bank ${country.popYear}` : ''}, Natural Earth. ${esc(built)}.
      <a href="https://github.com/vdm285/giramundo/issues/new?title=${encodeURIComponent(`Corrección: ${name}`)}" target="_blank" rel="noreferrer">${esc(t(lang, 'report'))}</a>
    </p>`;
}

function nearest(country, countries, n) {
  if (!country.ll) return [];
  return countries
    .filter((c) => c !== country && c.ll && (c.iso2 || c.placeId))
    .map((c) => ({ c, km: haversineKm({ lat: country.ll[0], lon: country.ll[1] }, { lat: c.ll[0], lon: c.ll[1] }) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n)
    .map((row) => row.c);
}

function renderCompare(a, b, lang) {
  const row = (label, av, bv) => `<div class="crow"><span>${esc(label)}</span><strong>${av}</strong><strong>${bv}</strong></div>`;
  const km = a.ll && b.ll
    ? formatCount(Math.round(haversineKm({ lat: a.ll[0], lon: a.ll[1] }, { lat: b.ll[0], lon: b.ll[1] })), lang)
    : '—';
  return `
    <section class="compare">
      <header><h3>${esc(t(lang, 'compareWith'))} ${esc(b.name[lang] || b.name.en)}</h3>
        <button type="button" data-action="clear-compare">${esc(t(lang, 'clearCompare'))}</button></header>
      ${row(t(lang, 'distance'), `${km} km`, '')}
      ${row(t(lang, 'population'), formatCompact(a.population, lang), formatCompact(b.population, lang))}
      ${row(t(lang, 'area'), a.area ? `${formatCompact(a.area, lang)} km²` : '—', b.area ? `${formatCompact(b.area, lang)} km²` : '—')}
    </section>`;
}

function renderTab({ lang, kids, tab, page, loading, country, name, zoneLine, today }) {
  if (tab === 'viajes') {
    const ll = country.ll;
    const q = ll ? `${ll[0]},${ll[1]}` : name;
    const earth = ll
      ? `https://earth.google.com/web/@${ll[0]},${ll[1]},2400a,350000d,35y,0h,0t,0r`
      : `https://earth.google.com/web/search/${encodeURIComponent(name)}`;
    const osm = ll
      ? `https://www.openstreetmap.org/?mlat=${ll[0]}&mlon=${ll[1]}#map=5/${ll[0]}/${ll[1]}`
      : `https://www.openstreetmap.org/search?query=${encodeURIComponent(name)}`;
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    return `
      <p>${esc(zoneLine || t(lang, 'viajesNone'))}</p>
      <p class="links">
        <a href="${osm}" target="_blank" rel="noreferrer">${esc(t(lang, 'viajesOsm'))}</a>
        <a href="${maps}" target="_blank" rel="noreferrer">${esc(t(lang, 'viajesMap'))}</a>
        <a href="${earth}" target="_blank" rel="noreferrer">${esc(t(lang, 'viajesEarth'))}</a>
      </p>
      <p class="muted">${esc(t(lang, 'unescoSoon'))}</p>`;
  }
  if (tab === 'hoy') return renderToday(today, country, lang, kids);
  if (loading && !page) {
    return `<div class="skel"></div><div class="skel short"></div><p class="muted">${esc(t(lang, 'loading'))}</p>`;
  }
  if (!page?.extract) {
    if ((tab === 'comida' || tab === 'cultura') && country.population != null && country.population < 100) {
      const who = formatCount(country.population, lang);
      return `<p>${esc(lang === 'es'
        ? `Wikipedia no tiene un artículo de ${tab === 'comida' ? 'cocina' : 'cultura'} para este territorio. En los datos viven aquí ${who} personas.`
        : `Wikipedia has no ${tab === 'comida' ? 'food' : 'culture'} article for this territory. The data counts ${who} people living here.`)}</p>`;
    }
    const query = tab === 'comida'
      ? (lang === 'es' ? `Gastronomía de ${name}` : `${name} cuisine`)
      : tab === 'cultura'
        ? (lang === 'es' ? `Cultura de ${name}` : `Culture of ${name}`)
        : name;
    return `<p>${esc(t(lang, 'emptyLayer'))}</p><p class="links"><a href="${wikiSearch(lang, query)}" target="_blank" rel="noreferrer">${esc(t(lang, 'readMore'))}</a></p>`;
  }
  const text = sentences(page.extract, kids ? 280 : 720);
  const thumb = safeThumb(page.thumb);
  return `
    ${thumb ? `<figure class="shot"><img alt="" src="${thumb}"></figure>` : ''}
    ${page.description ? `<p class="eyebrow">${esc(page.description)}</p>` : ''}
    ${page.fallbackLang ? `<p class="muted">${esc(page.fallbackLang === 'en' ? (lang === 'es' ? 'No hay un artículo en español. Este párrafo es el de Wikipedia en inglés.' : 'This paragraph is from English Wikipedia.') : (lang === 'es' ? 'Este párrafo es el de Wikipedia en español.' : 'There is no English article. This paragraph is from Spanish Wikipedia.'))}</p>` : ''}
    <p class="prose">${esc(text)}</p>
    <p class="links">
      ${page.url ? `<a href="${esc(page.url)}" target="_blank" rel="noreferrer">${esc(t(lang, 'readMore'))}</a>` : ''}
      ${kids && lang === 'es' ? `<a href="${wikiSearch('es', name).replace('wikipedia.org/wiki/Special:Search?search=', 'vikidia.org/wiki/')}" target="_blank" rel="noreferrer">${esc(t(lang, 'readVikidia'))}</a>` : ''}
    </p>`;
}

function renderToday(today, country, lang, kids) {
  if (!today) return `<div class="skel"></div><p class="muted">${esc(t(lang, 'loading'))}</p>`;
  if (!today.events?.length && !today.news?.length) return `<p>${esc(t(lang, 'hoyEmpty'))}</p>`;
  const names = [country.name.es, country.name.en, country.name.es?.split(' ')[0]].filter(Boolean);
  const related = [];
  const rest = [];
  for (const event of today.events || []) {
    const blob = `${event.text}`;
    if (names.some((n) => blob.toLowerCase().includes(n.toLowerCase()))) related.push(event);
    else rest.push(event);
  }
  const events = kids ? filterHard([...related, ...rest]) : [...related, ...rest];
  const news = kids ? filterHard(today.news || []) : (today.news || []);
  const items = events.slice(0, kids ? 3 : 4);
  const relatedCount = related.length;
  return `
    ${relatedCount ? `<h3>${esc(t(lang, 'hoyHere'))}</h3>` : `<h3>${esc(t(lang, 'hoyWorld'))}</h3>`}
    <ol class="events">${items.map((event) => `<li><span>${esc(event.year || '')}</span> ${esc(event.text || '')}${event.url ? ` <a href="${esc(event.url)}" target="_blank" rel="noreferrer">↗</a>` : ''}</li>`).join('')}</ol>
    ${news.length ? `<h3>${esc(t(lang, 'hoyNews'))}</h3><ul class="events">${news.slice(0, 3).map((item) => `<li>${esc(item.text)}</li>`).join('')}</ul>` : ''}
    <p class="muted">${esc(t(lang, 'hoyNote'))} ${esc(today.date || '')}</p>`;
}

function filterHard(items) {
  return items.filter((item) => !/muerte|muertos|murieron|murió|guerra|ataque|bombar|asesin|masacre|terror|killed|dead|death|war\b|bomb|massacre/i.test(`${item.text || ''} ${item.title || ''}`));
}

export function speechText(model) {
  const { lang, country, tab, story, kids } = model;
  if (!country) return '';
  const name = country.name[lang] || country.name.en;
  const capital = displayCapital(country, lang);
  const page = story?.[lang]?.[tab];
  const bit = page?.extract ? sentences(page.extract, kids ? 220 : 420) : '';
  return [name, capital, bit].filter(Boolean).join('. ');
}
