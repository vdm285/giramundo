// The seven sections of a country dossier. Each is a pure function of the
// model and returns a lit template. Fetching happens in app/app.js; here we
// only draw what has arrived, and say plainly when a source has nothing.

import { html, nothing } from 'lit';
import { t, locale } from '../app/i18n.js';
import { formatCompact, formatCount, formatTime, mainZone, sentences } from '../data/format.js';
import { haversineKm } from '../geo/math.js';
import { commonsPage, commonsThumb } from '../live/sources.js';
import { shortName } from '../live/radio.js';

const MAPS_KEY = import.meta.env.VITE_MAPS_EMBED_KEY || '';

function wikiSearch(lang, query) {
  const host = lang === 'en' ? 'en.wikipedia.org' : 'es.wikipedia.org';
  return `https://${host}/wiki/Special:Search?search=${encodeURIComponent(query)}`;
}

function timeAgo(iso, lang) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const h = Math.round(ms / 3600e3);
  if (h < 1) return lang === 'es' ? 'hace minutos' : 'minutes ago';
  if (h < 48) return lang === 'es' ? `hace ${h} h` : `${h} h ago`;
  const d = Math.round(h / 24);
  return lang === 'es' ? `hace ${d} días` : `${d} days ago`;
}

// ---------- Ahora ----------

function moneyCell(country, rates, lang) {
  const code = country.currencies?.[0]?.code;
  if (!code || !rates?.usd) return nothing;
  const perUsd = rates.usd[code];
  const mxn = rates.usd.MXN;
  if (!perUsd) return nothing;
  const fmt = (n) => new Intl.NumberFormat(locale(lang), { maximumSignificantDigits: 4 }).format(n);
  const line1 = `1 USD = ${fmt(perUsd)} ${code}`;
  const line2 = code === 'MXN' ? '' : (mxn ? `1 ${code} = ${fmt(mxn / perUsd)} MXN` : '');
  return html`<div class="cell"><span>${t(lang, 'nowMoney')}</span><strong>${line1}</strong>${line2 ? html`<div class="small muted">${line2}</div>` : nothing}</div>`;
}

const playIcon = html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const pauseIcon = html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;

export function renderRadio(m) {
  const { lang, country, world, radio, on } = m;
  const stations = country.iso2 ? world.radio?.[country.iso2] : null;
  if (!world.radio) return nothing;
  return html`
    <h2>${t(lang, 'radio')}</h2>
    <p class="small muted">${t(lang, 'radioLead')}</p>
    ${stations?.length ? html`<ul class="stations">${stations.map((s) => {
      const current = radio?.station?.id === s.id;
      const busy = current && (radio.status === 'playing' || radio.status === 'loading');
      return html`<li aria-current=${current}>
        <button class="play" @click=${() => on(current ? 'radio-toggle' : 'radio-play', { station: s, iso2: country.iso2 })} aria-label=${busy ? t(lang, 'radioPause') : t(lang, 'radioPlay')}>${busy ? pauseIcon : playIcon}</button>
        ${s.favicon ? html`<img src=${s.favicon} alt="" loading="lazy" @error=${(e) => { e.target.hidden = true; }}>` : nothing}
        <div style="min-width:0">
          <div class="name" title=${s.name}>${shortName(s.name)}</div>
          <div class="meta">${[...(s.tags || []).slice(0, 2), s.codec ? `${s.codec}${s.bitrate ? ` ${s.bitrate}k` : ''}` : ''].filter(Boolean).join(' · ')}
            ${current && radio.status === 'loading' ? html` · ${t(lang, 'radioLoading')}` : nothing}
            ${current && radio.status === 'error' ? html` · <span style="color:var(--coral)">${t(lang, radio.error === 'gesture' ? 'radioGesture' : 'radioError')}</span>` : nothing}
          </div>
        </div>
      </li>`;
    })}</ul>
    <p class="small muted"><a href="https://www.radio-browser.info" target="_blank" rel="noreferrer">Radio-Browser</a> · ${lang === 'es' ? 'Las estaciones son de sus emisoras.' : 'Stations belong to their broadcasters.'}</p>`
      : html`<p class="muted">${t(lang, 'radioNone')}</p>`}`;
}

export function renderAhora(m) {
  const { lang, country, content } = m;
  const zone = mainZone(country);
  const w = content.weather;
  const holidays = content.holidays || [];
  const next = content.nextHoliday;
  const news = content.news;
  const today = content.today;
  const names = [country.name.es, country.name.en].filter(Boolean).map((n) => n.toLowerCase());
  const mentions = (text) => names.some((n) => (text || '').toLowerCase().includes(n));
  const events = today?.events ? [...today.events].sort((a, b) => Number(mentions(b.text)) - Number(mentions(a.text))) : null;
  const related = events?.filter((e) => mentions(e.text)) || [];
  const shown = related.length ? related.slice(0, 4) : (events || []).slice(0, 3);
  const quakes = (content.quakes || [])
    .map((q) => ({ ...q, km: country.ll ? haversineKm({ lat: country.ll[0], lon: country.ll[1] }, q) : Infinity }))
    .filter((q) => q.km < 800)
    .sort((a, b) => b.mag - a.mag)
    .slice(0, 4);
  const dateFmt = new Intl.DateTimeFormat(locale(lang), { month: 'short', day: 'numeric' });
  return html`
    <div class="now-grid">
      ${w ? html`
        <div class="wx">
          <div class="temp">${Math.round(w.temp)}°</div>
          <div>
            <div class="desc">${w.desc[lang] || w.desc.es}</div>
            <div class="meta">${t(lang, 'nowWeather')} · ${t(lang, 'nowFeels')} ${Math.round(w.feels)}° · ${t(lang, 'nowWind')} ${Math.round(w.wind)} km/h · ${t(lang, 'nowHumidity')} ${w.humidity}%</div>
          </div>
        </div>` : html`<div class="wx"><div class="skel short"></div></div>`}
      ${zone ? html`<div class="cell"><span>${(country.timezones || []).length > 1 ? t(lang, 'capitalTime') : t(lang, 'localTime')}</span><strong class="js-time" data-zone=${zone}>${formatTime(zone, lang)}</strong><div class="small muted">${zone.replace(/_/g, ' ')}</div></div>` : nothing}
      ${moneyCell(country, content.rates, lang)}
      ${holidays.length ? html`<div class="cell"><span>${t(lang, 'nowHoliday')}</span><strong>${holidays[0].local}</strong>${holidays[0].name !== holidays[0].local ? html`<div class="small muted">${holidays[0].name}</div>` : nothing}</div>`
        : next ? html`<div class="cell"><span>${lang === 'es' ? 'Próximo feriado' : 'Next holiday'}</span><strong>${next.local}</strong><div class="small muted">${dateFmt.format(new Date(`${next.date}T12:00:00`))}</div></div>` : nothing}
    </div>

    ${renderRadio(m)}

    <h2>${t(lang, 'nowHeadlines')}</h2>
    ${news == null ? html`<div class="skel"></div><div class="skel short"></div>` : headlines(news, lang)}

    ${renderBackground(m)}

    ${shown.length ? html`
      <h2>${t(lang, 'nowOnThisDay')}</h2>
      <ol class="events">${shown.map((e) => html`<li><span>${e.year}</span>${e.url ? html`<a href=${e.url} target="_blank" rel="noreferrer">${e.text}</a>` : e.text}</li>`)}</ol>
      <p class="small muted">Wikipedia · CC BY-SA</p>` : nothing}

    ${content.quakes ? html`
      <h2>${t(lang, 'nowQuakes')}</h2>
      ${quakes.length ? html`<ul class="headlines quakes">${quakes.map((q) => html`<li><a href=${q.url} target="_blank" rel="noreferrer">${q.place}</a><b>M ${q.mag.toFixed(1)}</b></li>`)}</ul><p class="small muted">USGS</p>`
        : html`<p class="small muted">${t(lang, 'nowQuakeNone')}</p>`}` : nothing}
  `;
}

// "Why is this in the news": Wikipedia's in-the-news and most-read items that
// mention the country, then the background articles every country has.
function renderBackground(m) {
  const { lang, country, content } = m;
  const name = country.name[lang] || country.name.en;
  const names = [country.name.es, country.name.en, country.official?.es, country.official?.en].filter(Boolean).map((n) => n.toLowerCase());
  const mentions = (s) => names.some((n) => (s || '').toLowerCase().includes(n));
  const inNews = (content.today?.news || []).filter((n) => mentions(n.text) || (n.titles || []).some(mentions)).slice(0, 3);
  const mostRead = (content.mostRead || []).filter((a) => mentions(a.title) || mentions(a.extract) || mentions(a.description)).slice(0, 4);
  const host = lang === 'en' ? 'en' : 'es';
  const go = (q) => `https://${host}.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}&go=Go`;
  const topics = lang === 'es'
    ? [['Historia', `Historia de ${name}`], ['Política', `Política de ${name}`], ['Economía', `Economía de ${name}`], ['Geografía', `Geografía de ${name}`], ['Demografía', `Demografía de ${name}`]]
    : [['History', `History of ${name}`], ['Politics', `Politics of ${name}`], ['Economy', `Economy of ${name}`], ['Geography', `Geography of ${name}`], ['Demographics', `Demographics of ${name}`]];
  return html`
    <h2>${t(lang, 'bgTitle')}</h2>
    ${inNews.length ? html`<h3>${t(lang, 'bgInNews')}</h3><ul class="headlines">${inNews.map((n) => html`<li><a href=${n.url} target="_blank" rel="noreferrer">${n.text}</a></li>`)}</ul>` : nothing}
    ${mostRead.length ? html`<h3>${t(lang, 'bgMostRead')}</h3><ul class="headlines">${mostRead.map((a) => html`<li><a href=${a.url} target="_blank" rel="noreferrer">${a.title}</a><div class="meta"><span>${a.description || ''}</span></div></li>`)}</ul>` : nothing}
    ${!inNews.length && !mostRead.length ? html`<p class="small muted">${t(lang, 'bgQuiet')}</p>` : nothing}
    <div class="chips" style="margin-top:8px"><span>${t(lang, 'bgRead')}</span>${topics.map(([label, q]) => html`<a class="chip" href=${go(q)} target="_blank" rel="noreferrer">${label}</a>`)}</div>
    <p class="small muted">Wikipedia · CC BY-SA</p>`;
}

function headlines(news, lang) {
  const primary = lang === 'es' ? news.es : news.en;
  const secondary = lang === 'es' ? news.en : news.es;
  const list = (items) => html`<ul class="headlines">${items.map((n) => html`
    <li><a href=${n.url} target="_blank" rel="noreferrer">${n.title}</a>
      <div class="meta"><span>${n.source || ''}</span>${n.published ? html`<span>${timeAgo(n.published, lang)}</span>` : nothing}</div></li>`)}</ul>`;
  if (!primary?.length && !secondary?.length) return html`<p class="muted">${t(lang, 'nowNoNews')}</p>`;
  return html`
    ${primary?.length ? list(primary) : nothing}
    ${secondary?.length ? html`<h3>${t(lang, lang === 'es' ? 'nowHeadlinesEn' : 'nowHeadlinesEs')}</h3>${list(secondary)}` : nothing}
    <p class="small muted">${t(lang, 'nowSourceGoogle')} · ${t(lang, 'nowUpdated')} ${news.built ? timeAgo(news.built, lang) : ''}</p>`;
}

// ---------- Wikipedia sections ----------

export function renderWiki(m, key) {
  const { lang, country, content } = m;
  const name = country.name[lang] || country.name.en;
  const story = content.story;
  if (story === undefined) return html`<div class="skel"></div><div class="skel"></div><div class="skel short"></div>`;
  const page = story?.[lang]?.[key] || (key === 'historia' ? content.liveSummary : null);
  const dishes = key === 'comida' ? (m.places?.dishes || []) : [];
  if (!page?.extract) {
    const query = key === 'comida'
      ? (lang === 'es' ? `Gastronomía de ${name}` : `${name} cuisine`)
      : key === 'cultura' ? (lang === 'es' ? `Cultura de ${name}` : `Culture of ${name}`) : name;
    return html`
      <p class="muted">${t(lang, 'emptyLayer')}</p>
      <p class="links"><a href=${wikiSearch(lang, query)} target="_blank" rel="noreferrer">${t(lang, 'readMore')}</a></p>
      ${dishList(dishes, lang)}`;
  }
  return html`
    ${page.description ? html`<p class="small muted" style="text-transform:uppercase;letter-spacing:.06em;font-weight:600">${page.description}</p>` : nothing}
    ${page.fallbackLang ? html`<p class="small muted">${t(lang, page.fallbackLang === 'en' ? 'fromEnglish' : 'fromSpanish')}</p>` : nothing}
    <p class="prose">${sentences(page.extract, 900)}</p>
    <p class="links">${page.url ? html`<a href=${page.url} target="_blank" rel="noreferrer">${t(lang, 'readMore')}</a>` : nothing}</p>
    ${dishList(dishes, lang)}
    ${key === 'cultura' ? renderCulture(m) : nothing}`;
}

// Anthem, languages and notable people from Wikidata (public/data/culture.json).
function renderCulture(m) {
  const { lang, culture } = m;
  if (!culture) return nothing;
  const anthem = culture.anthem;
  const people = culture.people || [];
  const langs = culture.languages || [];
  const nf = (n) => new Intl.NumberFormat(locale(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return html`
    ${anthem ? html`
      <h3>${t(lang, 'anthem')}</h3>
      <p style="margin:0 0 6px"><strong>${anthem.label?.[lang] || anthem.label?.en || ''}</strong>
        ${anthem.wiki?.[lang] || anthem.wiki?.en ? html` · <a href=${anthem.wiki?.[lang] || anthem.wiki?.en} target="_blank" rel="noreferrer">Wikipedia</a>` : nothing}</p>
      ${anthem.audio ? html`<audio controls preload="none" src=${commonsThumb(anthem.audio).replace(/\?width=\d+$/, '')} style="width:100%"></audio>
        <p class="small muted"><a href=${commonsPage(anthem.audio)} target="_blank" rel="noreferrer">Wikimedia Commons</a> · ${t(lang, 'anthemNote')}</p>` : nothing}` : nothing}
    ${langs.length ? html`
      <h3>${t(lang, 'languages')}</h3>
      <div class="chips">${langs.map((l) => html`<span class="chip" title=${l.speakers ? `${nf(l.speakers)} ${t(lang, 'speakers')}` : ''}>${l.label?.[lang] || l.label?.en}${l.speakers ? html` <small class="muted">· ${nf(l.speakers)}</small>` : nothing}</span>`)}</div>
      <p class="small muted">${t(lang, 'languagesNote')}</p>` : nothing}
    ${people.length ? html`
      <h3>${t(lang, 'people')}</h3>
      <div class="people">${people.map((p) => html`
        <a class="person" href=${`https://www.wikidata.org/wiki/${p.qid}`} target="_blank" rel="noreferrer" title=${p.desc?.[lang] || p.desc?.en || ''}>
          ${p.image ? html`<img loading="lazy" src=${commonsThumb(p.image, 240)} alt="">` : html`<div class="noface">${(p.label?.[lang] || p.label?.en || '?').slice(0, 1)}</div>`}
          <strong>${p.label?.[lang] || p.label?.en}</strong>
          <span>${[p.job?.[lang] || p.job?.en || '', p.born ? `${p.born}${p.died ? `–${p.died}` : ''}` : ''].filter(Boolean).join(' · ')}</span>
        </a>`)}</div>
      <p class="small muted">${t(lang, 'peopleNote')}</p>` : nothing}`;
}

function dishList(dishes, lang) {
  if (!dishes.length) return nothing;
  return html`
    <h3>${lang === 'es' ? 'Platos típicos' : 'Typical dishes'}</h3>
    <div class="places">${dishes.slice(0, 6).map((d) => html`
      <a class="place ${d.image ? '' : 'noimg'}" href=${d.wiki?.[lang] || d.wiki?.en || `https://www.wikidata.org/wiki/${d.qid}`} target="_blank" rel="noreferrer">
        ${d.image ? html`<img loading="lazy" src=${commonsThumb(d.image, 480)} alt="">` : nothing}
        <div class="cap">${d.label?.[lang] || d.label?.en}</div>
      </a>`)}</div>
    <p class="small muted">Wikidata · Wikimedia Commons</p>`;
}

// ---------- Lugares ----------

export function renderLugares(m) {
  const { lang, places, on } = m;
  const sites = places?.heritage || [];
  if (!sites.length) return html`<p class="muted">${t(lang, 'placesNone')}</p>`;
  const sel = m.place;
  return html`
    <h2>${t(lang, 'placesHeritage')} <span class="muted small">· ${sites.length}</span></h2>
    ${sel ? html`
      <div class="place-detail">
        ${sel.image ? html`<img src=${commonsThumb(sel.image, 900)} alt="">` : nothing}
        <h3>${sel.label?.[lang] || sel.label?.en}</h3>
        ${sel.desc?.[lang] || sel.desc?.en ? html`<p>${sel.desc?.[lang] || sel.desc?.en}</p>` : nothing}
        <p class="small muted">${sel.year ? `${t(lang, 'placesInscribed')} ${sel.year} · ` : ''}UNESCO · Wikidata${sel.image ? html` · <a href=${commonsPage(sel.image)} target="_blank" rel="noreferrer">Commons</a>` : nothing}</p>
        <p class="links">
          ${sel.wiki?.[lang] || sel.wiki?.en ? html`<a href=${sel.wiki?.[lang] || sel.wiki?.en} target="_blank" rel="noreferrer">${t(lang, 'readMore')}</a>` : nothing}
          ${sel.ll ? html`<a href=${`https://www.google.com/maps/search/?api=1&query=${sel.ll[0]},${sel.ll[1]}`} target="_blank" rel="noreferrer">Google Maps</a>` : nothing}
        </p>
      </div>` : nothing}
    <div class="places">${sites.map((s) => html`
      <button class="place ${s.image ? '' : 'noimg'}" @click=${() => on('place', s)} aria-pressed=${sel === s}>
        ${s.image ? html`<img loading="lazy" src=${commonsThumb(s.image, 480)} alt="">` : nothing}
        <div class="cap">${s.label?.[lang] || s.label?.en}${s.year ? html`<small>${s.year}</small>` : nothing}</div>
      </button>`)}</div>
    <p class="small muted">UNESCO World Heritage · Wikidata (CC0) · Wikimedia Commons</p>`;
}

// ---------- Ver ----------

export function renderVer(m) {
  const { lang, country, content, on } = m;
  const vids = content.videos?.items || [];
  const current = content.video || vids[0] || null;
  const ll = country.capitalLL || country.ll;
  const name = country.name[lang] || country.name.en;
  const kinds = [['walk', 'seeWalks'], ['food', 'seeFood'], ['drone', 'seeDrone']];
  const streetLink = ll ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll[0]},${ll[1]}` : '';
  const mapsLink = ll ? `https://www.google.com/maps/search/?api=1&query=${ll[0]},${ll[1]}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
  const osm = ll ? `https://www.openstreetmap.org/?mlat=${ll[0]}&mlon=${ll[1]}#map=6/${ll[0]}/${ll[1]}` : '';
  const earth = ll ? `https://earth.google.com/web/@${ll[0]},${ll[1]},2400a,350000d,35y,0h,0t,0r` : '';
  return html`
    ${vids.length ? html`
      <div class="video">
        ${content.playing === current?.id
          ? html`<iframe src=${`https://www.youtube-nocookie.com/embed/${current.id}?autoplay=1&rel=0`} title=${current.title || ''} allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
          : html`<button class="play" @click=${() => on('play', current.id)} aria-label="Play"><img src=${`https://i.ytimg.com/vi/${current.id}/hqdefault.jpg`} alt=""></button>`}
      </div>
      <div class="video-meta">
        <span>${current.title || ''}</span>
        <a href=${`https://www.youtube.com/watch?v=${current.id}`} target="_blank" rel="noreferrer">${current.channel || 'YouTube'} ↗</a>
      </div>
      ${kinds.map(([kind, label]) => {
        const list = vids.filter((v) => v.kind === kind);
        if (!list.length) return nothing;
        return html`<h3>${t(lang, label)}</h3>
          <div class="video-list">${list.map((v) => html`
            <button @click=${() => on('video', v)} aria-pressed=${current?.id === v.id} title=${v.title || ''}>
              <img loading="lazy" src=${`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="">
            </button>`)}</div>`;
      })}
      <p class="small muted">${t(lang, 'seeCredit')}</p>`
      : html`<p class="muted">${t(lang, 'seeNone')}</p>`}
    <p class="links">
      <a href=${`https://www.youtube.com/results?search_query=${encodeURIComponent(`${country.name.en} walking tour 4K`)}`} target="_blank" rel="noreferrer">${t(lang, 'ytWalk')} ↗</a>
      <a href=${`https://www.youtube.com/results?search_query=${encodeURIComponent(`${country.name.en} street food`)}`} target="_blank" rel="noreferrer">${t(lang, 'ytFood')} ↗</a>
      <a href=${`https://www.youtube.com/results?search_query=${encodeURIComponent(`${country.name.en} travel vlog`)}`} target="_blank" rel="noreferrer">${t(lang, 'ytTravel')} ↗</a>
    </p>

    <h2>${t(lang, 'seeStreet')}</h2>
    ${MAPS_KEY && ll
      ? html`<div class="embed"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen
          src=${`https://www.google.com/maps/embed/v1/streetview?key=${MAPS_KEY}&location=${ll[0]},${ll[1]}&heading=0&pitch=0&fov=90`}></iframe></div>`
      : nothing}
    <p class="links">
      ${streetLink ? html`<a href=${streetLink} target="_blank" rel="noreferrer">Street View ↗</a>` : nothing}
      <a href=${mapsLink} target="_blank" rel="noreferrer">${t(lang, 'seeMaps')} ↗</a>
      ${osm ? html`<a href=${osm} target="_blank" rel="noreferrer">${t(lang, 'seeOsm')} ↗</a>` : nothing}
      ${earth ? html`<a href=${earth} target="_blank" rel="noreferrer">${t(lang, 'seeEarth')} ↗</a>` : nothing}
    </p>`;
}

// ---------- Datos ----------

function sparkline(series, start, lang) {
  const pts = series.map((v, i) => [start + i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return nothing;
  const W = 440;
  const H = 120;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 22;
  const x0 = pts[0][0];
  const x1 = pts.at(-1)[0];
  const max = Math.max(...pts.map((p) => p[1]));
  const sx = (x) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (W - padL - padR);
  const sy = (v) => padT + (1 - v / max) * (H - padT - padB);
  const d = pts.map(([x, v], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const area = `${d}L${sx(x1).toFixed(1)},${H - padB}L${sx(x0).toFixed(1)},${H - padB}Z`;
  const years = [x0, Math.round((x0 + x1) / 2), x1];
  return html`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    <line x1=${padL} x2=${W - padR} y1=${H - padB} y2=${H - padB}></line>
    <path class="fill" d=${area}></path>
    <path class="line" d=${d}></path>
    ${years.map((y) => html`<text x=${sx(y)} y=${H - 6} text-anchor=${y === x0 ? 'start' : y === x1 ? 'end' : 'middle'}>${y}</text>`)}
    <text x=${padL} y=${padT + 4} text-anchor="start">${formatCompact(max, lang)}</text>
  </svg>`;
}

export function renderDatos(m) {
  const { lang, country, world, indicator, on } = m;
  const iso = country.iso2;
  const pop = iso && world.pophistory?.values?.[iso];
  const inds = world.indicators || {};
  const rows = Object.entries(inds).map(([key, def]) => {
    const v = def.values?.[iso];
    const all = Object.values(def.values || {}).map((x) => x[0]);
    let rank = null;
    if (v) {
      const sorted = [...all].sort((a, b) => b - a);
      rank = sorted.indexOf(v[0]) + 1;
    }
    return { key, def, v, rank, n: all.length };
  });
  const nf = (n, d) => new Intl.NumberFormat(locale(lang), { maximumFractionDigits: d }).format(n);
  return html`
    ${pop?.length > 1 ? html`
      <h2>${t(lang, 'dataPopulation')}</h2>
      ${sparkline(pop, world.pophistory.start, lang)}
      <p class="small muted">${formatCount(pop[0], lang)} (${world.pophistory.start}) → ${formatCount(pop.at(-1), lang)} (${world.pophistory.start + pop.length - 1}) · ${t(lang, 'dataSource')}</p>` : nothing}
    <h2>${lang === 'es' ? 'Indicadores' : 'Indicators'}</h2>
    ${rows.map(({ key, def, v, rank, n }) => html`
      <div class="ind">
        <div class="k">${def.label?.[lang] || key}<small>${def.unit?.[lang] || ''}${v ? ` · ${v[1]}` : ''}${rank ? ` · #${rank} ${t(lang, 'dataRank')} ${n}` : ''}</small></div>
        <div class="v">${v ? nf(v[0], def.decimals ?? 1) : html`<span class="muted small">${t(lang, 'dataNoData')}</span>`}</div>
        <button title=${t(lang, 'dataPaint')} aria-pressed=${indicator === key && m.view === 'data'} @click=${() => on('paint', key)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
        </button>
      </div>`)}
    <p class="small muted">${t(lang, 'dataSource')} · CC BY 4.0${world.indicatorsBuilt ? ` · ${world.indicatorsBuilt}` : ''}</p>`;
}
