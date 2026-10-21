// Media pieces shared by the panels of the deck (deck.js): the sound bar
// (anthem, one station with shuffle), a window that cross-fades through a
// list of photos, the news line, the people row. Pure templates; the 4 s
// beat (`tick4`) and the radio state come from app/app.js.

import { html, nothing } from 'lit';
import { t, locale } from '../app/i18n.js';
import { commonsThumb } from '../live/sources.js';
import { aiModeUrl, headlinePrompt } from '../live/ask.js';
import { renderRadio } from './sections.js';

// Two <img> slots so a slide can cross-fade: the slot whose parity matches
// the index is visible; the other already holds the next picture.
export function slides(items, idx, src) {
  if (!items.length) return nothing;
  const n = items.length;
  const a = idx % 2 === 0 ? idx : (idx + 1) % n;
  const b = idx % 2 === 1 ? idx : (idx + 1) % n;
  return html`
    <img class=${idx % 2 === 0 ? 'on' : ''} src=${src(items[a])} alt="" loading="lazy" @error=${(e) => { e.target.hidden = true; }}>
    <img class=${idx % 2 === 1 ? 'on' : ''} src=${src(items[b])} alt="" loading="lazy" @error=${(e) => { e.target.hidden = true; }}>`;
}

export function timeAgo(iso, lang) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const h = Math.round(ms / 3600e3);
  if (h < 1) return lang === 'es' ? 'hace minutos' : 'minutes ago';
  if (h < 48) return lang === 'es' ? `hace ${h} h` : `${h} h ago`;
  const d = Math.round(h / 24);
  return lang === 'es' ? `hace ${d} días` : `${d} days ago`;
}

// Anthem (sung first) and one local station with shuffle.
export function renderSoundBar(m) {
  const { lang, country, culture, on } = m;
  return html`
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
    </div>`;
}

// A window: photos cross-fading, the caption always on, a tag on hover.
export function renderWindow({ items, idx, src, caption, tag, onOpen, cls = '' }) {
  if (!items.length) return nothing;
  const it = items[idx % items.length];
  return html`
    <button class="window ${cls}" @click=${onOpen} title=${tag || ''}>
      ${slides(items, idx % items.length, src)}
      <span class="cap">${caption(it)}</span>
      ${tag ? html`<span class="tag">${tag}${items.length > 1 ? ` · ${items.length}` : ''}</span>` : nothing}
    </button>`;
}

// One headline at a time with its Contexto link; the dots show the rest.
export function renderNewsLine(m, { big = false } = {}) {
  const { lang, country, content, on } = m;
  const news = content.news;
  const name = country.name[lang] || country.name.en;
  const items = news ? [...(news[lang] || []), ...(news[lang === 'es' ? 'en' : 'es'] || [])] : [];
  if (news === undefined || news === null) return html`<div class="skel tall" style="height:88px"></div>`;
  if (!items.length) return html`<p class="muted small">${t(lang, 'nowNoNews')}</p>`;
  const nIdx = Math.floor((m.tick4 || 0) / 2) % items.length;
  const headline = items[nIdx];
  return html`
    <div class="newsline ${big ? 'big' : ''}">
      <a class="head" href=${headline.url} target="_blank" rel="noreferrer">${headline.title}</a>
      <div class="meta">
        <span>${headline.source || ''}</span>
        ${headline.published ? html`<span>${timeAgo(headline.published, lang)}</span>` : nothing}
        <a class="ctx" href=${aiModeUrl(headlinePrompt(headline.title, name, lang))} target="_blank" rel="noreferrer noopener" title=${t(lang, 'contextTitle')}>✦ ${t(lang, 'context')}</a>
        ${on && !big ? html`<button class="linkish" @click=${() => on('panel', 'ahora')}>${t(lang, 'seeAll')} · ${items.length}</button>` : nothing}
      </div>
      <div class="dots">${items.slice(0, 12).map((_, i) => html`<i class=${i === nIdx % 12 ? 'on' : ''}></i>`)}</div>
    </div>`;
}

const DOMAIN_RING = { arts: '#e4603a', science: '#2f6d9b', sports: '#1e7a3c', politics: '#8a5a2b', thought: '#6b4fa0', other: '#7a7064' };

// Twelve faces in one row; the ring hints the domain, the line below
// orders them by birth year. Names and domain on hover.
export function renderPeopleRow(m) {
  const { lang, culture } = m;
  const people = (culture?.people || []).slice(0, 12);
  if (!people.length) return nothing;
  const years = people.map((p) => p.born).filter(Boolean);
  const y0 = years.length ? Math.min(...years) : 1800;
  const y1 = years.length ? Math.max(...years, y0 + 50) : 2000;
  const domainLabel = (d) => ({
    es: { arts: 'artes', science: 'ciencia', sports: 'deporte', politics: 'historia y política', thought: 'pensamiento', other: '' },
    en: { arts: 'arts', science: 'science', sports: 'sports', politics: 'history and politics', thought: 'thought', other: '' },
  })[lang]?.[d] || '';
  return html`
    <div class="people-row" aria-label=${t(lang, 'people')}>
      ${people.map((p) => html`
        <a class="face" href=${`https://www.wikidata.org/wiki/${p.qid}`} target="_blank" rel="noreferrer" style=${`--ring:${DOMAIN_RING[p.domain] || DOMAIN_RING.other}`}
          title=${[p.label?.[lang] || p.label?.en, p.job?.[lang] || p.job?.en, p.born ? `${p.born}${p.died ? `–${p.died}` : ''}` : ''].filter(Boolean).join(' · ')}>
          ${p.image ? html`<img loading="lazy" src=${commonsThumb(p.image, 200)} alt="">` : html`<span class="noface">${(p.label?.[lang] || p.label?.en || '?').slice(0, 1)}</span>`}
          <b>${p.label?.[lang] || p.label?.en}</b>
          <small>${[domainLabel(p.domain), p.born].filter(Boolean).join(' · ')}</small>
        </a>`)}
    </div>
    ${years.length > 2 ? html`
      <div class="epoch" aria-hidden="true">
        ${people.filter((p) => p.born).map((p) => html`<i style=${`left:${(((p.born - y0) / Math.max(1, y1 - y0)) * 100).toFixed(1)}%;background:${DOMAIN_RING[p.domain] || DOMAIN_RING.other}`}></i>`)}
        <span class="lo">${y0}</span><span class="hi">${y1}</span>
      </div>` : nothing}
    <p class="small muted">${t(lang, 'peopleNote')}</p>`;
}

export { locale };
