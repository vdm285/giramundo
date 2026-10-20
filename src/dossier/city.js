// The city card: a second tap level inside a country. Natural Earth gives
// the point and a population estimate; Wikipedia gives the paragraph and the
// photo; Open-Meteo the weather; YouTube and Street View the rest.

import { html, nothing } from 'lit';
import { t, locale } from '../app/i18n.js';
import { formatCount, formatTime, sentences } from '../data/format.js';

const MAPS_KEY = import.meta.env.VITE_MAPS_EMBED_KEY || '';

export function renderCity(m) {
  const { lang, city, country, content, on, base } = m;
  const name = city.name?.[lang] || city.name?.en;
  const countryName = country?.name?.[lang] || country?.name?.en || '';
  const summary = content.citySummary;
  const w = content.cityWeather;
  const hero = content.cityHero;
  const time = city.tz ? formatTime(city.tz, lang) : '';
  const ll = city.ll;
  const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const videos = (content.videos?.items || []).filter((v) => v.place && city.name?.en && v.place.toLowerCase() === city.name.en.toLowerCase());
  const current = content.video && videos.some((v) => v.id === content.video.id) ? content.video : videos[0];
  return html`
    <div class="hero">
      ${hero?.src ? html`<img src=${hero.src} alt="" @load=${(e) => e.target.classList.add('ready')} @error=${(e) => { e.target.hidden = true; }}>` : nothing}
      <div class="hero-tools">
        <button title=${t(lang, 'collapse')} aria-label=${t(lang, 'collapse')} @click=${() => on('collapse')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
        <button title=${t(lang, 'share')} aria-label=${t(lang, 'share')} @click=${() => on('share')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg></button>
      </div>
      ${hero?.credit ? html`<a class="credit" href=${hero.link} target="_blank" rel="noreferrer">${hero.credit}</a>` : nothing}
      <div class="title">
        ${country?.flag ? html`<img class="flag" alt="" src=${base + country.flag} width="54" height="38">` : nothing}
        <div>
          <p class="sub" style="margin:0 0 2px">${t(lang, 'cityIn')} <button class="linkish" @click=${() => on('city-close')}>${countryName}</button></p>
          <h1>${name}</h1>
          <p class="sub">${[city.capital ? t(lang, 'cityCapital') : '', city.admin1 || '', time].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
    </div>
    <div class="body">
      <div class="facts">
        ${city.pop ? html`<div><span>${t(lang, 'cityPop')}</span><strong>${formatCount(city.pop, lang)}</strong></div>` : nothing}
        ${time ? html`<div><span>${t(lang, 'localTime')}</span><strong class="js-time" data-zone=${city.tz}>${time}</strong></div>` : nothing}
        ${w ? html`<div><span>${t(lang, 'cityWeather')}</span><strong>${Math.round(w.temp)}° · ${w.desc[lang] || w.desc.es}</strong></div>` : nothing}
        ${ll ? html`<div><span>${t(lang, 'cityCoords')}</span><strong>${ll[0].toFixed(2)}, ${ll[1].toFixed(2)}</strong></div>` : nothing}
      </div>
      ${city.pop ? html`<p class="small muted">${t(lang, 'cityPopNote')}</p>` : nothing}
      ${m.cityStation ? (() => {
        const current = m.radio?.station?.id === m.cityStation.id;
        const busy = current && (m.radio.status === 'playing' || m.radio.status === 'loading');
        return html`<p><span class="chip hear" aria-current=${Boolean(current)}>
          <button class="play" aria-label=${t(lang, 'hearCity')} @click=${() => on(current ? 'radio-toggle' : 'hear-city', m.cityStation)}>
            ${busy ? html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>` : html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`}</button>
          ${t(lang, 'hearCity')}: ${m.cityStation.name.split(/\s[-–|]\s/)[0]}</span></p>`;
      })() : nothing}
      ${summary === undefined ? html`<div class="skel"></div><div class="skel short"></div>`
        : summary?.extract ? html`
          ${summary.description ? html`<p class="small muted" style="text-transform:uppercase;letter-spacing:.06em;font-weight:600">${summary.description}</p>` : nothing}
          <p class="prose">${sentences(summary.extract, 700)}</p>
          <p class="links"><a href=${summary.url} target="_blank" rel="noreferrer">${t(lang, 'readMore')}</a></p>`
        : html`<p class="muted">${t(lang, 'emptyLayer')}</p>`}

      <h2>${t(lang, 'sec_ver')}</h2>
      ${current ? html`
        <div class="video">
          ${content.playing === current.id
            ? html`<iframe src=${`https://www.youtube-nocookie.com/embed/${current.id}?autoplay=1&rel=0`} title=${current.title || ''} allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
            : html`<button class="play" @click=${() => on('play', current.id)} aria-label="Play"><img src=${`https://i.ytimg.com/vi/${current.id}/hqdefault.jpg`} alt=""></button>`}
        </div>
        <div class="video-meta"><span>${current.title || ''}</span><a href=${`https://www.youtube.com/watch?v=${current.id}`} target="_blank" rel="noreferrer">${current.channel || 'YouTube'} ↗</a></div>` : nothing}
      <p class="links">
        <a href=${yt(`${city.name.en} walking tour 4K`)} target="_blank" rel="noreferrer">${t(lang, 'ytWalk')} ↗</a>
        <a href=${yt(`${city.name.en} street food`)} target="_blank" rel="noreferrer">${t(lang, 'ytFood')} ↗</a>
        <a href=${yt(`${city.name.en} drone 4K`)} target="_blank" rel="noreferrer">${t(lang, 'seeDrone')} ↗</a>
      </p>
      ${MAPS_KEY && ll ? html`<div class="embed"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen
        src=${`https://www.google.com/maps/embed/v1/streetview?key=${MAPS_KEY}&location=${ll[0]},${ll[1]}&heading=0&pitch=0&fov=90`}></iframe></div>` : nothing}
      <p class="links">
        ${ll ? html`<a href=${`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll[0]},${ll[1]}`} target="_blank" rel="noreferrer">Street View ↗</a>` : nothing}
        <a href=${`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${city.name.en}, ${country?.name?.en || ''}`)}`} target="_blank" rel="noreferrer">${t(lang, 'seeMaps')} ↗</a>
        ${ll ? html`<a href=${`https://www.openstreetmap.org/?mlat=${ll[0]}&mlon=${ll[1]}#map=11/${ll[0]}/${ll[1]}`} target="_blank" rel="noreferrer">${t(lang, 'seeOsm')} ↗</a>` : nothing}
      </p>
      <div class="chips" style="margin-top:18px">
        <span>${t(lang, 'cityOthers')}</span>
        ${(m.cities || []).filter((c) => c.id !== city.id).slice(0, 8).map((c) => html`<button class="chip" @click=${() => on('city', c)}>${c.name?.[lang] || c.name?.en}</button>`)}
        <button class="chip" @click=${() => on('city-close')}>← ${countryName}</button>
      </div>
      <p class="src">${t(lang, 'sources')}: Natural Earth, Wikipedia (CC BY-SA), Open-Meteo (CC BY 4.0).</p>
    </div>`;
}

export function cityLocale(lang) { return locale(lang); }
