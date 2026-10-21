// The deck: a country as nine full-screen panels passed sideways, with
// a shelf of themes along the bottom (the ones already seen dimmed, the
// ones that changed carrying a count) and the corner globe as the way out.
// Pure template; app/app.js owns the panel index, the read marks, the
// slideshow beat and the radio.

import { html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { SECTIONS } from '../app/router.js';
import { t } from '../app/i18n.js';
import { currencyLabel, displayCapital, formatCompact, formatCount, formatTime, languageNames, mainZone } from '../data/format.js';
import { commonsPage, commonsThumb } from '../live/sources.js';
import { aiModeUrl, buildPrompt } from '../live/ask.js';
import { disputeNote } from '../data/disputed.js';
import { renderConverter, renderMoney, renderRateLine, renderSunClock } from './money.js';
import { renderAhora, renderDatos, renderLugares, renderVer, renderWiki } from './sections.js';
import { renderNewsLine, renderPeopleRow, renderSoundBar, renderWindow } from './inicio.js';
import { renderCompare } from './play.js';

const icons = {
  share: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>`,
  close: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  ask: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.8 2 2-.8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>`,
};

function heroShots(m) {
  return (m.places?.heritage || []).filter((h) => h.image).slice(0, 5);
}

// ---- the panels ----

function panelAhora(m) {
  return html`
    ${renderNewsLine(m, { big: true })}
    ${renderAhora(m)}`;
}

function panelIdentidad(m) {
  const { lang, country, culture, content, on } = m;
  const name = country.name[lang] || country.name.en;
  const official = country.official?.[lang] || '';
  const capital = displayCapital(country, lang);
  const zone = mainZone(country);
  const time = formatTime(zone, lang);
  const shots = heroShots(m);
  const hero = content.hero;
  const idx = shots.length ? (m.heroIdx || 0) % shots.length : 0;
  const dispute = disputeNote(country.iso2 || country.placeId, lang, false);
  const facts = [
    capital && country.iso2 !== 'PS' ? [t(lang, 'capital'), capital] : null,
    country.population ? [t(lang, 'population'), `${formatCount(country.population, lang)}${country.popYear ? ` · ${country.popYear}` : ''}`] : null,
    country.area ? [t(lang, 'area'), `${formatCount(Math.round(country.area), lang)} km²`] : null,
    country.languages?.length ? [t(lang, 'languages'), languageNames(country.languages, lang).join(', ')] : null,
    country.currencies?.[0] ? [t(lang, 'currency'), currencyLabel(country.currencies[0], lang)] : null,
    country.population && country.area ? [t(lang, 'density'), `${formatCount(Math.round(country.population / country.area), lang)} ${t(lang, 'perKm')}`] : null,
    country.calling ? [t(lang, 'calling'), `+${country.calling}`] : null,
  ].filter(Boolean);
  const langs = culture?.languages || [];
  return html`
    <div class="idhero">
      ${shots.length >= 2
        ? shots.map((h, i) => html`<img class=${i === idx ? 'on' : 'off'} src=${commonsThumb(h.image, 1400)} alt="" loading=${i === idx ? 'eager' : 'lazy'} @error=${(e) => { e.target.hidden = true; }}>`)
        : hero?.src ? html`<img class="on" src=${hero.src} alt="" @error=${(e) => { e.target.hidden = true; }}>` : nothing}
      ${shots.length >= 2 ? html`<a class="credit" href=${commonsPage(shots[idx].image)} target="_blank" rel="noreferrer">${shots[idx].label?.[lang] || shots[idx].label?.en || 'Wikimedia Commons'}</a>`
        : hero?.credit ? html`<a class="credit" href=${hero.link} target="_blank" rel="noreferrer">${hero.credit}</a>` : nothing}
      <div class="title">
        ${country.flag ? html`<img class="flag" alt="" src=${m.base + country.flag}>` : nothing}
        <div>
          <h1>${name}</h1>
          <p class="sub">${[official && official !== name ? official : '', capital && country.iso2 !== 'PS' ? capital : '', time].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
    </div>
    <div class="idbody">
      ${!country.onMap && country.iso2 ? html`<div class="note"><p>${t(lang, 'small')}</p></div>` : nothing}
      ${dispute ? html`<aside class="note"><strong>${t(lang, 'disputed')}</strong><p>${dispute}</p></aside>` : nothing}
      ${renderSoundBar(m)}
      <div class="money-small" @click=${() => on('panel', 'datos')} title=${t(lang, 'sec_datos')}>${renderMoney({ ...m, moneyOld: false })}</div>
      ${langs.length ? html`<div class="chips" aria-label=${t(lang, 'languages')}>${langs.slice(0, 6).map((l) => {
        const station = m.stationFor?.(l);
        const current = station && m.radio?.station?.id === station.id;
        return html`<span class="chip hear" aria-current=${Boolean(current)} title=${station ? `${t(lang, 'hearLangTitle')}: ${station.name}` : ''}>
          ${station ? html`<button class="play" aria-label=${t(lang, 'hearLang')} @click=${() => on(current ? 'radio-toggle' : 'radio-play', { station, iso2: country.iso2 })}>
            ${current && (m.radio.status === 'playing' || m.radio.status === 'loading') ? html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>` : html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`}</button>` : nothing}
          ${l.label?.[lang] || l.label?.en}</span>`;
      })}</div>` : nothing}
      <div class="capsule">
        ${zone ? renderSunClock(zone, lang) : nothing}
        ${country.population ? html`<span>${formatCompact(country.population, lang)} ${lang === 'es' ? 'personas' : 'people'}</span>` : nothing}
        ${country.area ? html`<span>${formatCompact(Math.round(country.area), lang)} km²</span>` : nothing}
        <button class="more" aria-expanded=${Boolean(m.factsOpen)} @click=${() => on('facts')}>${t(lang, m.factsOpen ? 'factsLess' : 'factsMore')}</button>
        ${m.canState ? html`<button class="more" @click=${() => on('focus')}>${t(lang, 'statesGo')}</button>` : nothing}
      </div>
      ${m.factsOpen ? html`<div class="facts">${facts.map(([k, v]) => html`<div><span>${k}</span><strong title=${v}>${v}</strong></div>`)}</div>` : nothing}
      <p class="small muted">${t(lang, 'identityNote')}</p>
    </div>`;
}

function panelComida(m) {
  const { lang, content, places } = m;
  const dishes = (content.food?.all?.length ? content.food.all : (places?.dishes || [])).filter((d) => d.image);
  return html`
    ${renderWindow({
      items: dishes, idx: Math.floor((m.tick4 || 0) / 2), src: (d) => commonsThumb(d.image, 1200), cls: 'top',
      caption: (d) => {
        const name = d.label?.[lang] || d.label?.en || d.label?.local || '';
        const local = d.label?.local && d.label.local !== name ? d.label.local : '';
        const region = d.region?.[lang] || d.region?.es || '';
        return html`<b>${name}</b>${local ? html`<small>${local}</small>` : nothing}${region ? html`<small>${region}</small>` : nothing}`;
      },
      onOpen: () => {},
    })}
    ${renderWiki(m, 'comida')}`;
}

function panelLugares(m) {
  const { lang, places } = m;
  const sites = [...(places?.heritage || []), ...(places?.landmarks || [])].filter((p) => p.image);
  return html`
    ${m.place ? nothing : renderWindow({
      items: sites, idx: Math.floor(((m.tick4 || 0) + 1) / 2), src: (p) => commonsThumb(p.image, 1200), cls: 'top',
      caption: (p) => html`<b>${p.label?.[lang] || p.label?.en || ''}</b>${p.year ? html`<small>UNESCO · ${p.year}</small>` : p.desc?.[lang] || p.desc?.en ? html`<small>${p.desc?.[lang] || p.desc?.en}</small>` : nothing}`,
      onOpen: () => {},
    })}
    ${renderLugares(m)}`;
}

function panelGente(m) {
  return html`
    ${renderPeopleRow(m)}
    ${renderWiki({ ...m, noCulture: true }, 'cultura')}`;
}

function panelMusica(m) {
  const { lang, country, culture } = m;
  const genres = culture?.music?.genres || [];
  const instruments = culture?.music?.instruments || [];
  const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const name = country.name[lang] || country.name.en;
  const tile = (g, what) => html`
    <a class="place dish ${g.image ? '' : 'noimg'}" href=${yt(`${g.label?.[lang] || g.label?.en} ${what} ${country.name.en}`)} target="_blank" rel="noreferrer" title=${g.desc?.[lang] || g.desc?.en || ''}>
      ${g.image ? html`<img loading="lazy" src=${commonsThumb(g.image, 480)} alt="">` : nothing}
      <span class="cap">${g.label?.[lang] || g.label?.en}${g.desc?.[lang] || g.desc?.en ? html`<small>${g.desc?.[lang] || g.desc?.en}</small>` : nothing}</span>
      <span class="yt">▶ YouTube</span>
    </a>`;
  return html`
    ${genres.length ? html`<div class="places dishes dense">${genres.map((g) => tile(g, lang === 'es' ? 'música' : 'music'))}</div>` : html`<p class="muted">${t(lang, 'seeNone')}</p>`}
    ${instruments.length ? html`<h3 class="region">${lang === 'es' ? 'Instrumentos' : 'Instruments'}</h3><div class="places dishes dense">${instruments.map((g) => tile(g, lang === 'es' ? 'instrumento' : 'instrument'))}</div>` : nothing}
    <p class="links"><a href=${yt(`${lang === 'es' ? 'música de' : 'music of'} ${name}`)} target="_blank" rel="noreferrer">${t(lang, 'musicSearch')} ↗</a></p>
    <p class="small muted">${t(lang, 'musicNote')}</p>`;
}

function panelCaminar(m) {
  return renderVer(m);
}

function panelHistoria(m) {
  return renderWiki({ ...m, readOpen: { ...(m.readOpen || {}), historia: m.readOpen?.historia ?? true } }, 'historia');
}

function panelDatos(m) {
  const { lang, country } = m;
  const code = country.currencies?.[0]?.code;
  const cur = code ? m.money?.[code] : null;
  const perUsd = m.content?.rates?.usd?.[code];
  return html`
    ${cur ? html`<h2>${cur.name?.[lang] || cur.name?.en || code} · ${code}</h2>${renderMoney(m)}` : nothing}
    ${perUsd && code !== 'USD' ? html`${renderConverter(m, code, cur?.name?.[lang] || code, perUsd)}${renderRateLine(m, code)}` : nothing}
    ${renderDatos(m)}`;
}

const PANELS = {
  ahora: panelAhora, identidad: panelIdentidad, comida: panelComida, lugares: panelLugares, gente: panelGente,
  musica: panelMusica, caminar: panelCaminar, historia: panelHistoria, datos: panelDatos,
};

// ---- the deck ----

export function renderDeck(m) {
  const { lang, country, on, panel, read } = m;
  if (!country) return nothing;
  const name = country.name[lang] || country.name.en;
  const idx = Math.max(0, SECTIONS.indexOf(panel));
  const seen = read?.[country.iso2 || country.placeId] || {};
  const newsCount = (() => {
    const since = seen.ahora;
    if (!since || !m.content.news) return 0;
    const items = [...(m.content.news.es || []), ...(m.content.news.en || [])];
    return items.filter((n) => n.published && Math.floor(new Date(n.published).getTime() / 86400000) > since).length;
  })();
  return keyed(country.iso2 || country.placeId, html`
    <div class="deck" tabindex="-1">
      <div class="deck-head">
        ${country.flag ? html`<img alt="" src=${m.base + country.flag}>` : nothing}
        <b>${name}</b>
        <div class="tools">
          <button class="ask" aria-pressed=${Boolean(m.ask)} title=${t(lang, 'askTitle')} @click=${() => on('ask')}>${icons.ask} ${t(lang, 'ask')}</button>
          <button title=${t(lang, 'share')} aria-label=${t(lang, 'share')} @click=${() => on('share')}>${icons.share}</button>
          <button title=${t(lang, 'toGlobe')} aria-label=${t(lang, 'toGlobe')} @click=${() => on('collapse')}>${icons.close}</button>
        </div>
      </div>
      <div class="deck-track" style=${`--i:${idx}`}>
        ${SECTIONS.map((p, i) => {
          const near = Math.abs(i - idx) <= 1;
          return html`
            <section class="panel ${i === idx ? 'on' : ''} ${p}" data-panel=${p} aria-hidden=${i !== idx} @click=${(e) => { if (i !== idx) { e.preventDefault(); on('panel', p); } }}>
              <div class="panel-scroll">
                ${i === idx && m.ask ? html`
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
                ${i === idx && m.compare ? renderCompare(m) : nothing}
                ${near ? PANELS[p](m) : html`<h2 class="stub">${t(lang, `sec_${p}`)}</h2>`}
              </div>
              ${i !== idx ? html`<span class="panel-name">${t(lang, `sec_${p}`)}</span>` : nothing}
            </section>`;
        })}
      </div>
      <nav class="shelf" aria-label=${t(lang, 'shelf')}>
        ${SECTIONS.map((p, i) => html`
          <button aria-current=${i === idx} class=${seen[p] ? 'seen' : ''} @click=${() => on('panel', p)} title=${seen[p] ? t(lang, 'readMark') : ''}>
            ${t(lang, `sec_${p}`)}${p === 'ahora' && newsCount ? html`<i class="n">${newsCount}</i>` : seen[p] ? html`<i class="tick">✓</i>` : nothing}
          </button>`)}
      </nav>
      <div class="medallion" title=${t(lang, 'miniHint')}><canvas id="mini" width="150" height="150" aria-label=${t(lang, 'miniHint')}></canvas></div>
      <button class="deck-arrow l" aria-label=${t(lang, 'prev')} ?disabled=${idx === 0} @click=${() => on('panel-step', -1)}>‹</button>
      <button class="deck-arrow r" aria-label=${t(lang, 'next')} ?disabled=${idx === SECTIONS.length - 1} @click=${() => on('panel-step', 1)}>›</button>
    </div>`);
}
