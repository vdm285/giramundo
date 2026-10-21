// Inicio: what you see the moment a country opens. Media first, words on
// hover. One rectangle for the banknote and a circle for the coin, a sound
// bar (anthem, one local station with shuffle), two windows that slide
// through the country's food and its places, a news window, and the music
// genres born there. Every window is a door into its section.

import { html, nothing } from 'lit';
import { t, locale } from '../app/i18n.js';
import { commonsThumb } from '../live/sources.js';
import { aiModeUrl, headlinePrompt } from '../live/ask.js';
import { renderMoney } from './money.js';
import { renderRadio } from './sections.js';

// Two <img> slots so a slide can cross-fade: the slot whose parity matches
// the index is visible; the other already holds the next picture.
function slides(items, idx, src) {
  if (!items.length) return nothing;
  const n = items.length;
  const a = idx % 2 === 0 ? idx : (idx + 1) % n;
  const b = idx % 2 === 1 ? idx : (idx + 1) % n;
  return html`
    <img class=${idx % 2 === 0 ? 'on' : ''} src=${src(items[a])} alt="" loading="lazy" @error=${(e) => { e.target.hidden = true; }}>
    <img class=${idx % 2 === 1 ? 'on' : ''} src=${src(items[b])} alt="" loading="lazy" @error=${(e) => { e.target.hidden = true; }}>`;
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

export function renderInicio(m) {
  const { lang, country, content, places, culture, on } = m;
  const tick = m.tick4 || 0;
  const name = country.name[lang] || country.name.en;

  // Food: the deep list when it exists, the curated handful otherwise.
  const dishes = (content.food?.all?.length ? content.food.all : (places?.dishes || [])).filter((d) => d.image);
  const dIdx = dishes.length ? Math.floor(tick / 2) % dishes.length : 0;
  const dish = dishes[dIdx];
  const dishName = dish ? (dish.label?.[lang] || dish.label?.en || dish.label?.local || '') : '';
  const dishLocal = dish?.label?.local && dish.label.local !== dishName ? dish.label.local : '';
  const dishRegion = dish?.region?.[lang] || dish?.region?.es || '';

  // Places: World Heritage first, then the landmarks people visit.
  const sites = [...(places?.heritage || []), ...(places?.landmarks || [])].filter((p) => p.image);
  const pIdx = sites.length ? Math.floor((tick + 1) / 2) % sites.length : 0;
  const site = sites[pIdx];

  // News: one headline at a time, in the reader's language first.
  const news = content.news;
  const items = news ? [...(news[lang] || []), ...(news[lang === 'es' ? 'en' : 'es'] || [])] : [];
  const nIdx = items.length ? Math.floor(tick / 2) % items.length : 0;
  const headline = items[nIdx];

  const genres = culture?.music?.genres || [];
  const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

  return html`
    ${renderMoney(m)}

    <div class="soundbar">
      ${culture?.anthem?.audio || culture?.anthem?.audioVocal ? (() => {
        const current = m.radio?.station?.id === `anthem-${country.iso2}`;
        const busy = current && (m.radio.status === 'playing' || m.radio.status === 'loading');
        const sung = Boolean(culture.anthem.audioVocal);
        const lyrics = culture.anthem.lyricsUrl || culture.anthem.wiki?.[lang] || culture.anthem.wiki?.en || '';
        return html`<div class="radio-one anthem-one" aria-current=${current}>
          <button class="play" @click=${() => on('anthem')} aria-label=${t(lang, 'anthemPlay')}>
            ${busy ? html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>` : html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`}</button>
          <div style="min-width:0">
            <div class="name" title=${culture.anthem.label?.[lang] || culture.anthem.label?.en || ''}>${t(lang, 'anthem')}</div>
            <div class="meta">${t(lang, sung ? 'anthemSung' : 'anthemInstrumental')}${lyrics ? html` · <a href=${lyrics} target="_blank" rel="noreferrer">${t(lang, 'lyrics')}</a>` : nothing}</div>
          </div>
        </div>`;
      })() : nothing}
      ${renderRadio(m, { compact: true })}
    </div>

    <div class="windows">
      ${dishes.length ? html`
        <button class="window food" @click=${() => on('section', 'comida')} title=${t(lang, 'windowFood')}>
          ${slides(dishes, dIdx, (d) => commonsThumb(d.image, 640))}
          <span class="cap"><b>${dishName}</b>${dishLocal ? html`<small>${dishLocal}</small>` : nothing}${dishRegion ? html`<small>${dishRegion}</small>` : nothing}</span>
          <span class="tag">${t(lang, 'windowFood')}${dishes.length > 1 ? ` · ${dishes.length}` : ''}</span>
        </button>` : nothing}
      ${sites.length ? html`
        <button class="window places" @click=${() => on('section', 'lugares')} title=${t(lang, 'windowPlaces')}>
          ${slides(sites, pIdx, (p) => commonsThumb(p.image, 640))}
          <span class="cap"><b>${site.label?.[lang] || site.label?.en || ''}</b>${site.year ? html`<small>UNESCO · ${site.year}</small>` : site.desc?.[lang] || site.desc?.en ? html`<small>${site.desc?.[lang] || site.desc?.en}</small>` : nothing}</span>
          <span class="tag">${t(lang, 'windowPlaces')}${sites.length > 1 ? ` · ${sites.length}` : ''}</span>
        </button>` : nothing}
    </div>

    ${news === undefined || news === null ? html`<div class="skel tall" style="height:88px"></div>` : headline ? html`
      <div class="newsline">
        <a class="head" href=${headline.url} target="_blank" rel="noreferrer">${headline.title}</a>
        <div class="meta">
          <span>${headline.source || ''}</span>
          ${headline.published ? html`<span>${timeAgo(headline.published, lang)}</span>` : nothing}
          <a class="ctx" href=${aiModeUrl(headlinePrompt(headline.title, name, lang))} target="_blank" rel="noreferrer noopener" title=${t(lang, 'contextTitle')}>✦ ${t(lang, 'context')}</a>
          <button class="linkish" @click=${() => on('section', 'ahora')}>${t(lang, 'seeAll')} · ${items.length}</button>
        </div>
        <div class="dots">${items.slice(0, 12).map((_, i) => html`<i class=${i === nIdx % 12 ? 'on' : ''}></i>`)}</div>
      </div>` : nothing}

    ${genres.length ? html`
      <div class="chips music" aria-label=${t(lang, 'music')}>
        ${genres.slice(0, 8).map((g) => html`<a class="chip yt" href=${yt(`${g.label?.[lang] || g.label?.en} ${lang === 'es' ? 'música' : 'music'} ${country.name.en}`)} target="_blank" rel="noreferrer" title=${g.desc?.[lang] || g.desc?.en || ''}>▶ ${g.label?.[lang] || g.label?.en}</a>`)}
      </div>` : html`
      <div class="chips music"><a class="chip yt" href=${yt(`${lang === 'es' ? 'música de' : 'music of'} ${name}`)} target="_blank" rel="noreferrer">▶ ${t(lang, 'music')}</a></div>`}
  `;
}

export { locale };
