// The dossier panel: hero, facts, section nav, the active section, sources.
// Pure template; app/app.js owns state and fetching.

import { html, nothing } from 'lit';
import { SECTIONS } from '../app/router.js';
import { t } from '../app/i18n.js';
import { continentLabel, currencyLabel, displayCapital, formatCompact, formatCount, formatTime, languageNames, mainZone } from '../data/format.js';
import { commonsPage, commonsThumb } from '../live/sources.js';
import { aiModeUrl, buildPrompt } from '../live/ask.js';
import { renderConverter, renderRateLine, renderSunClock } from './money.js';
export { splitBills } from './money.js';

import { disputeNote } from '../data/disputed.js';
import { haversineKm } from '../geo/math.js';
import { renderAhora, renderDatos, renderLugares, renderVer, renderWiki } from './sections.js';
import { renderInicio } from './inicio.js';
import { renderCompare } from './play.js';

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
    case 'inicio': body = renderInicio(m); break;
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
      ${(() => {
        // A slow slideshow of up to five World Heritage photos, cross-fading;
        // the single hero photo when there are not enough.
        const shots = (m.places?.heritage || []).filter((h) => h.image).slice(0, 5);
        if (shots.length >= 2) {
          const idx = (m.heroIdx || 0) % shots.length;
          return shots.map((h, i) => html`<img class=${i === idx ? 'ready on' : 'off'} src=${commonsThumb(h.image, 1000)} alt="" loading=${i === idx ? 'eager' : 'lazy'} @error=${(e) => { e.target.hidden = true; }}>`);
        }
        return hero?.src ? html`<img src=${hero.src} alt="" @load=${(e) => e.target.classList.add('ready')} @error=${(e) => { e.target.hidden = true; }}>` : nothing;
      })()}
      <div class="hero-tools">
        <button title=${t(lang, 'collapse')} aria-label=${t(lang, 'collapse')} @click=${() => on('collapse')}>${icons.collapse}</button>
        <button title=${t(lang, 'share')} aria-label=${t(lang, 'share')} @click=${() => on('share')}>${icons.share}</button>
        ${m.culture?.anthem?.audio ? html`<button class="anthem" aria-current=${m.radio?.station?.id === `anthem-${country.iso2}`} title=${t(lang, 'anthemPlay')} @click=${() => on('anthem')}>
          ${m.radio?.station?.id === `anthem-${country.iso2}` && (m.radio.status === 'playing' || m.radio.status === 'loading')
            ? html`<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`
            : html`<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>`}
          ${t(lang, 'anthem')}</button>` : nothing}
        <button class="ask" aria-pressed=${Boolean(m.ask)} title=${t(lang, 'askTitle')} @click=${() => on('ask')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>
          ${t(lang, 'ask')}</button>
        <button title=${t(lang, m.wide ? 'shrink' : 'expand')} aria-label=${t(lang, m.wide ? 'shrink' : 'expand')} aria-pressed=${Boolean(m.wide)} @click=${() => on('wide')}>
          ${m.wide
            ? html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 20v-5h5M4 15h5v5M20 9h-5V4"/></svg>`
            : html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`}
        </button>
      </div>
      ${(() => {
        const shots = (m.places?.heritage || []).filter((h) => h.image).slice(0, 5);
        if (shots.length >= 2) {
          const h = shots[(m.heroIdx || 0) % shots.length];
          return html`<a class="credit" href=${commonsPage(h.image)} target="_blank" rel="noreferrer">${h.label?.[lang] || h.label?.en || 'Wikimedia Commons'}</a>`;
        }
        return hero?.credit ? html`<a class="credit" href=${hero.link} target="_blank" rel="noreferrer">${hero.credit}</a>` : nothing;
      })()}
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
      ${m.ask ? html`
        <div class="askbox">
          <h3>${t(lang, 'askTitle')}</h3>
          <p class="small muted" style="margin-bottom:8px">${t(lang, 'askHint')}</p>
          <textarea .value=${m.ask.text} maxlength="1800" @input=${(e) => on('ask-edit', e.target.value)}></textarea>
          <div class="acts">
            <a class="btn solid" href=${aiModeUrl(m.ask.text)} target="_blank" rel="noreferrer noopener">${t(lang, 'askOpen')} ↗</a>
            <button class="btn" @click=${() => on('ask-edit', buildPrompt(m))}>${t(lang, 'askReset')}</button>
            <span class="count">${m.ask.text.length}/1800</span>
          </div>
        </div>` : nothing}
      ${m.compare ? renderCompare(m) : nothing}
      ${!country.onMap && country.iso2 ? html`<div class="note"><p>${t(lang, 'small')}</p></div>` : nothing}
      ${dispute ? html`<aside class="note"><strong>${t(lang, 'disputed')}</strong><p>${dispute}</p></aside>` : nothing}
      ${section === 'historia' ? html`
        <div class="capsule">
          ${zone ? renderSunClock(zone, lang) : nothing}
          ${capital && country.iso2 !== 'PS' ? html`<span><b>${capital}</b></span>` : nothing}
          ${country.population ? html`<span>${formatCompact(country.population, lang)} ${lang === 'es' ? 'personas' : 'people'}</span>` : nothing}
          ${country.languages?.length ? html`<span>${languageNames(country.languages.slice(0, 2), lang).join(', ')}</span>` : nothing}
          ${km != null && country.iso2 !== 'MX' ? html`<span class="muted">${formatCount(km, lang)} ${t(lang, 'kmFrom')} ${t(lang, 'fromHome')}</span>` : nothing}
          <button class="more" aria-expanded=${Boolean(m.factsOpen)} @click=${() => on('facts')}>${t(lang, m.factsOpen ? 'factsLess' : 'factsMore')}</button>
        </div>
        ${m.factsOpen ? html`<div class="facts">${facts.map(([k, v]) => html`<div><span>${k}</span><strong title=${v}>${v}</strong></div>`)}</div>` : nothing}` : nothing}
      ${body}
      <div class="chips" style="margin-top:18px">
        <span>${neighbors.length ? t(lang, 'neighbors') : t(lang, 'nearest')}</span>
        ${near.length ? near.map((c) => html`<button class="chip" @click=${() => on('go', c.iso2 || c.placeId)}>${c.flag ? html`<img alt="" src=${base + c.flag}>` : nothing}${c.name[lang] || c.name.en}</button>`) : html`<em class="muted small">${t(lang, 'noBorder')}</em>`}
      </div>
      <p class="src">${t(lang, 'sources')}: Wikipedia (CC BY-SA)${country.popYear ? `, World Bank ${country.popYear}` : ''}, Natural Earth, Wikidata. ${world.built}.
        <a href=${`https://github.com/vdm285/giramundo/issues/new?title=${encodeURIComponent(`Corrección: ${name}`)}`} target="_blank" rel="noreferrer">${t(lang, 'report')}</a></p>
    </div>`;
}
