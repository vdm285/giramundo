// Templates for the play layer: the play menu, the game panel that replaces
// the dossier during a round, the tour bar, and the compare block.

import { html, nothing } from 'lit';
import { t } from '../app/i18n.js';
import { compass } from '../app/play.js';
import { formatCompact, formatCount } from '../data/format.js';
import { haversineKm } from '../geo/math.js';

const icons = {
  prev: html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 5v14l-8-7zM6 5h2v14H6z"/></svg>`,
  next: html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5v14l8-7zM16 5h2v14h-2z"/></svg>`,
  play: html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
  pause: html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`,
};

export function renderPlayMenu(m) {
  const { lang, on, tours } = m;
  return html`<div class="playmenu" role="dialog" aria-label=${t(lang, 'play')}>
    <h3>${t(lang, 'gameTitle')}</h3>
    <p class="small muted" style="margin:0 0 8px">${t(lang, 'gameLead')}</p>
    <div class="opts">
      <button @click=${() => on('game', 'normal')}>${t(lang, 'gameNormal')}</button>
      <button @click=${() => on('game', 'hard')}>${t(lang, 'gameHard')}</button>
    </div>
    <h3>${t(lang, 'tours')}</h3>
    ${tours.map((j) => html`<button class="tour" @click=${() => on('tour', j.id)}><strong>${j.title}</strong><span>${j.blurb} · ${j.stops.length} ${t(lang, 'stops')}</span></button>`)}
    <h3>${t(lang, 'compare')}</h3>
    <div class="opts"><button @click=${() => on('compare')}>${t(lang, 'compareStart')}</button></div>
  </div>`;
}

export function renderGame(m) {
  const { lang, game, world, on, base } = m;
  const name = (c) => c?.name?.[lang] || c?.name?.en || '';
  if (game.over) {
    const solved = game.scores.filter((s) => s != null);
    const avg = solved.length ? (solved.reduce((a, b) => a + b, 0) / solved.length).toFixed(1) : '—';
    return html`<div class="game">
      <p class="eyebrow">${t(lang, 'gameTitle')}</p>
      <h1>${t(lang, 'gameOver')}</h1>
      <p>${t(lang, 'gameFound')} ${solved.length} ${t(lang, 'gameOf')} ${game.total}. ${t(lang, 'gameAvg')} ${avg}.</p>
      <div class="rounds">${game.scores.map((s) => html`<i class=${s == null ? 'miss' : 'hit'}></i>`)}</div>
      <div class="acts">
        <button class="btn solid" @click=${() => on('game', game.level)}>${t(lang, 'gameAgain')}</button>
        <button class="btn" @click=${() => on('game-end')}>${t(lang, 'close')}</button>
      </div></div>`;
  }
  const target = game.target;
  const guesses = [...game.guesses].reverse();
  return html`<div class="game">
    <p class="eyebrow">${t(lang, 'gameRound')} ${game.round + 1} ${t(lang, 'gameOf')} ${game.total}</p>
    <h1>${t(lang, 'gameFind')} ${name(target)}?</h1>
    ${game.done
      ? html`<p>${game.guesses.at(-1)?.hit ? `${t(lang, 'gameHit')} ${game.guesses.length} ${t(lang, game.guesses.length === 1 ? 'gameTry' : 'gameTries')}.` : t(lang, 'gameRevealed')}</p>
        <div class="acts">
          <button class="btn solid" @click=${() => on('game-next')}>${game.round + 1 >= game.total ? t(lang, 'gameResults') : t(lang, 'gameNext')}</button>
          <button class="btn" @click=${() => on('game-open')}>${t(lang, 'gameOpen')} ${name(target)}</button>
        </div>`
      : html`<p class="muted">${t(lang, 'gameHow')}</p>
        <div class="scale"></div>
        <div class="ticks"><span>${t(lang, 'gameFar')}</span><span>${t(lang, 'gameNear')}</span></div>`}
    ${guesses.length ? html`<ul class="guesses">${guesses.map((g) => {
      const c = world.byIso.get(g.iso2);
      return html`<li><i class="swatch" style=${`background:${g.color}`}></i>${c?.flag ? html`<img alt="" src=${base + c.flag}>` : nothing}<span>${name(c)}</span>
        <b>${g.hit ? '✓' : `${formatCount(g.km, lang)} km ${compass(g.bearing, lang)}`}</b></li>`;
    })}</ul>` : nothing}
    <div class="rounds">${game.rounds.map((_, i) => html`<i class=${i < game.round ? (game.scores[i] == null ? 'miss' : 'hit') : ''}></i>`)}</div>
    <div class="acts">
      ${!game.done ? html`<button class="btn" @click=${() => on('game-giveup')}>${t(lang, 'gameGiveUp')}</button>` : nothing}
      <button class="btn" @click=${() => on('game-end')}>${t(lang, 'gameQuit')}</button>
    </div>
  </div>`;
}

export function renderTourBar(m) {
  const { lang, tour, on, progress } = m;
  const stop = tour.stops[tour.index];
  return html`<div class="tourbar" role="region" aria-label=${t(lang, 'tours')}>
    <div style="min-width:0">
      <strong title=${tour.title}>${tour.title}</strong>
      <div class="n">${tour.index + 1}/${tour.stops.length} · ${stop?.name || ''}${stop?.blurb ? ` · ${stop.blurb}` : ''}</div>
    </div>
    <button @click=${() => on('tour-prev')} aria-label=${t(lang, 'prev')} ?disabled=${tour.index === 0}>${icons.prev}</button>
    <button @click=${() => on('tour-toggle')} aria-label=${tour.playing ? t(lang, 'pause') : t(lang, 'resume')}>${tour.playing ? icons.pause : icons.play}</button>
    <button @click=${() => on('tour-next')} aria-label=${t(lang, 'next')}>${icons.next}</button>
    <button @click=${() => on('tour-stop')} aria-label=${t(lang, 'tourStop')}>×</button>
    <div class="bar"><i style=${`width:${Math.round(progress * 100)}%`}></i></div>
  </div>`;
}

export function renderCompare(m) {
  const { lang, country, world, compare, on, base } = m;
  const b = world.byIso.get(compare);
  if (!b || !country) return nothing;
  const a = country;
  const name = (c) => c.name[lang] || c.name.en;
  const inds = world.indicators || {};
  const row = (label, va, vb) => html`<div class="crow"><span>${label}</span><strong>${va}</strong><strong>${vb}</strong></div>`;
  const km = a.ll && b.ll ? Math.round(haversineKm({ lat: a.ll[0], lon: a.ll[1] }, { lat: b.ll[0], lon: b.ll[1] })) : null;
  const nf = (v, d) => (v == null ? '—' : new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US', { maximumFractionDigits: d }).format(v));
  const ind = (key) => inds[key] ? row(inds[key].label?.[lang] || key, nf(inds[key].values?.[a.iso2]?.[0], inds[key].decimals), nf(inds[key].values?.[b.iso2]?.[0], inds[key].decimals)) : nothing;
  const flag = (c) => (c.flag ? html`<img alt="" src=${base + c.flag}>` : nothing);
  return html`<section class="compare">
    <header><h3>${t(lang, 'compare')}</h3><button @click=${() => on('compare-clear')}>${t(lang, 'compareClear')}</button></header>
    <div class="crow"><span></span><strong>${flag(a)}${name(a)}</strong><strong><button class="chip" style="min-height:28px;padding:0 8px" @click=${() => on('go', b.iso2)}>${flag(b)}${name(b)}</button></strong></div>
    ${km != null ? row(t(lang, 'distance'), `${formatCount(km, lang)} km`, '') : nothing}
    ${row(t(lang, 'population'), formatCompact(a.population, lang), formatCompact(b.population, lang))}
    ${row(t(lang, 'area'), a.area ? `${formatCompact(a.area, lang)} km²` : '—', b.area ? `${formatCompact(b.area, lang)} km²` : '—')}
    ${row(t(lang, 'density'), a.population && a.area ? nf(Math.round(a.population / a.area), 0) : '—', b.population && b.area ? nf(Math.round(b.population / b.area), 0) : '—')}
    ${ind('lifeExp')}${ind('gdpPc')}${ind('internet')}${ind('urban')}${ind('forest')}
    <p class="small muted" style="margin:8px 0 0">${t(lang, 'dataSource')}</p>
  </section>`;
}
