// The dossier panel: hero, facts, section nav, the active section, sources.
// Pure template; app/app.js owns state and fetching.

import { html, nothing } from 'lit';
import { SECTIONS } from '../app/router.js';
import { t } from '../app/i18n.js';
import { continentLabel, currencyLabel, displayCapital, formatCount, formatTime, languageNames, mainZone } from '../data/format.js';
import { disputeNote } from '../data/disputed.js';
import { haversineKm } from '../geo/math.js';
import { renderAhora, renderDatos, renderLugares, renderVer, renderWiki } from './sections.js';

const HOME = { lat: 19.4326, lon: -99.1332 };

const icons = {
  share: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>`,
  collapse: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
};

function nearest(country, countries, n) {
  if (!country.ll) return [];
  return countries
    .filter((c) => c !== country && c.ll && (c.iso2 || c.placeId))
    .map((c) => ({ c, km: haversineKm({ lat: country.ll[0], lon: country.ll[1] }, { lat: c.ll[0], lon: c.ll[1] }) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n)
    .map((row) => row.c);
}

export function renderDossier(m) {
  const { lang, country, section, world, content, on, base } = m;
  if (!country) return nothing;
  const name = country.name[lang] || country.name.en;
  const official = country.official?.[lang] || '';
  const capital = displayCapital(country, lang);
  const zone = mainZone(country);
  const time = formatTime(zone, lang);
  const km = country.ll ? Math.round(haversineKm({ lat: country.ll[0], lon: country.ll[1] }, HOME)) : null;
  const dispute = disputeNote(country.iso2 || country.placeId, lang, false);
  const hero = content.hero;
  const flag = country.flag
    ? html`<img class="flag" alt="" src=${base + country.flag} width="54" height="38">`
    : html`<span class="badge">${(country.iso2 || name).slice(0, 2)}</span>`;
  const neighbors = (country.borders || []).map((iso) => world.byIso.get(iso)).filter(Boolean);
  const near = neighbors.length ? neighbors : nearest(country, world.countries, 4);
  const facts = [
    capital && country.iso2 !== 'PS' ? [t(lang, 'capital'), capital] : null,
    country.population ? [t(lang, 'population'), `${formatCount(country.population, lang)}${country.popYear ? ` · ${country.popYear}` : ''}`] : null,
    country.area ? [t(lang, 'area'), `${formatCount(Math.round(country.area), lang)} km²`] : null,
    country.languages?.length ? [t(lang, 'languages'), languageNames(country.languages, lang).join(', ')] : null,
    country.currencies?.[0] ? [t(lang, 'currency'), currencyLabel(country.currencies[0], lang)] : null,
    country.population && country.area ? [t(lang, 'density'), `${formatCount(Math.round(country.population / country.area), lang)} ${t(lang, 'perKm')}`] : null,
    country.calling ? [t(lang, 'calling'), `+${country.calling}`] : null,
    country.continent ? [t(lang, 'continent'), continentLabel(country.continent, lang)] : null,
  ].filter(Boolean);

  let body;
  switch (section) {
    case 'ahora': body = renderAhora(m); break;
    case 'comida': body = renderWiki(m, 'comida'); break;
    case 'cultura': body = renderWiki(m, 'cultura'); break;
    case 'lugares': body = renderLugares(m); break;
    case 'ver': body = renderVer(m); break;
    case 'datos': body = renderDatos(m); break;
    default: body = renderWiki(m, 'historia');
  }

  return html`
    <div class="hero">
      ${hero?.src ? html`<img src=${hero.src} alt="" @load=${(e) => e.target.classList.add('ready')} @error=${(e) => { e.target.remove(); }}>` : nothing}
      <div class="hero-tools">
        <button title=${t(lang, 'collapse')} aria-label=${t(lang, 'collapse')} @click=${() => on('collapse')}>${icons.collapse}</button>
        <button title=${t(lang, 'share')} aria-label=${t(lang, 'share')} @click=${() => on('share')}>${icons.share}</button>
      </div>
      ${hero?.credit ? html`<a class="credit" href=${hero.link} target="_blank" rel="noreferrer">${hero.credit}</a>` : nothing}
      <div class="title">
        ${flag}
        <div>
          <h1>${name}</h1>
          <p class="sub">${[official && official !== name ? official : '', capital && country.iso2 !== 'PS' ? capital : '', time ? `${time}` : ''].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
    </div>
    <nav class="secnav" role="tablist">
      ${SECTIONS.map((s) => html`<button role="tab" aria-selected=${s === section} @click=${() => on('section', s)}>${t(lang, `sec_${s}`)}</button>`)}
    </nav>
    <div class="body">
      ${!country.onMap && country.iso2 ? html`<div class="note"><p>${t(lang, 'small')}</p></div>` : nothing}
      ${dispute ? html`<aside class="note"><strong>${t(lang, 'disputed')}</strong><p>${dispute}</p></aside>` : nothing}
      ${section === 'historia' ? html`
        <div class="facts">${facts.map(([k, v]) => html`<div><span>${k}</span><strong title=${v}>${v}</strong></div>`)}</div>
        ${km != null && country.iso2 !== 'MX' ? html`<p class="small muted">${formatCount(km, lang)} ${t(lang, 'kmFrom')} ${t(lang, 'fromHome')}</p>` : nothing}` : nothing}
      ${body}
      <div class="chips" style="margin-top:18px">
        <span>${neighbors.length ? t(lang, 'neighbors') : t(lang, 'nearest')}</span>
        ${near.length ? near.map((c) => html`<button class="chip" @click=${() => on('go', c.iso2 || c.placeId)}>${c.flag ? html`<img alt="" src=${base + c.flag}>` : nothing}${c.name[lang] || c.name.en}</button>`) : html`<em class="muted small">${t(lang, 'noBorder')}</em>`}
      </div>
      <p class="src">${t(lang, 'sources')}: Wikipedia (CC BY-SA)${country.popYear ? `, World Bank ${country.popYear}` : ''}, Natural Earth, Wikidata. ${world.built}.
        <a href=${`https://github.com/vdm285/giramundo/issues/new?title=${encodeURIComponent(`Corrección: ${name}`)}`} target="_blank" rel="noreferrer">${t(lang, 'report')}</a></p>
    </div>`;
}
