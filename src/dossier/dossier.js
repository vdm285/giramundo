// The dossier panel: hero, facts, section nav, the active section, sources.
// Pure template; app/app.js owns state and fetching.

import { html, nothing } from 'lit';
import { SECTIONS } from '../app/router.js';
import { t } from '../app/i18n.js';
import { continentLabel, currencyLabel, displayCapital, formatCompact, formatCount, formatTime, languageNames, mainZone } from '../data/format.js';
import { commonsPage, commonsThumb } from '../live/sources.js';
import { aiModeUrl, buildPrompt } from '../live/ask.js';

// Today's notes first; anything dated before 1990 or labeled specimen or
// historical waits behind a toggle (the future time slider's first job).
export function splitBills(bills) {
  const current = [];
  const old = [];
  for (const b of bills) {
    const title = `${b.file || ''} ${b.series || ''}`;
    const years = [...title.matchAll(/\b(1[6-9]\d\d|20\d\d)\b/g)].map((x) => Number(x[1]));
    const oldest = years.length ? Math.max(...years) : null;
    const flagged = /specimen|histor|antigu|\bold\b|obsolet|demonetiz|emergency|provisional|revoluci|local issue/i.test(title);
    if (b.historical || flagged || (oldest != null && oldest < 1990)) old.push(b);
    else current.push(b);
  }
  return { current, old };
}

// Real banknotes and coins from Wikimedia Commons, as a slideshow sized like
// a bill. Hover shows the denomination, the currency and the rate.
function renderMoney(m) {
  const { lang, country, money, on, content } = m;
  const code = country.currencies?.[0]?.code;
  const cur = code ? money?.[code] : null;
  if (!cur) return nothing;
  const { current, old } = splitBills(cur.banknotes || []);
  const bills = m.moneyOld ? old : (current.length ? current : old);
  const idx = bills.length ? (m.moneyIdx || 0) % bills.length : 0;
  const oldToggle = old.length && current.length
    ? html`<button class="chip" style="margin-top:6px" @click=${() => on('money-old')}>${m.moneyOld ? t(lang, 'moneyOldHide') : `${t(lang, 'moneyOld')} · ${old.length}`}</button>`
    : nothing;
  const rates = content.rates;
  const perUsd = rates?.usd?.[code];
  const fmt = (n) => new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US', { maximumSignificantDigits: 4 }).format(n);
  const rate = perUsd ? `1 USD = ${fmt(perUsd)} ${code}${code !== 'MXN' && rates.usd.MXN ? ` · 1 ${code} = ${fmt(rates.usd.MXN / perUsd)} MXN` : ''}` : '';
  const name = cur.name?.[lang] || cur.name?.en || code;
  if (!bills.length) {
    return html`<p class="small muted" style="margin:10px 0 0">${name} · ${code}${rate ? ` · ${rate}` : ''}</p>`;
  }
  const bill = bills[idx];
  return html`
    <div class="money" tabindex="0" aria-label=${`${t(lang, 'moneyBills')}: ${name}`}>
      ${bills.map((b, i) => html`<img class=${i === idx ? 'on' : ''} src=${commonsThumb(b.file, 900)} alt=${`${b.denomination || ''} ${name}`} loading=${i === idx ? 'eager' : 'lazy'}>`)}
      ${bills.length > 1 ? html`<div class="dots">${bills.map((_, i) => html`<i class=${i === idx ? 'on' : ''}></i>`)}</div>
        <button class="step l" aria-label="prev" @click=${() => on('money-step', -1)}>‹</button>
        <button class="step r" aria-label="next" @click=${() => on('money-step', 1)}>›</button>` : nothing}
      <div class="label"><span><b>${bill.denomination ? `${bill.denomination} ` : ''}${name}</b>${rate ? html`<br>${rate}` : nothing}</span>
        <a class="credit" style="position:static;background:none;padding:0" href=${commonsPage(bill.file)} target="_blank" rel="noreferrer">${bill.license || 'Commons'}</a></div>
    </div>
    ${oldToggle}
    ${cur.coins?.length ? html`<div class="coins">${cur.coins.slice(0, 8).map((c) => html`<a href=${commonsPage(c.file)} target="_blank" rel="noreferrer" title=${`${c.denomination || ''} · ${c.license || ''}`}><img loading="lazy" src=${commonsThumb(c.file, 160)} alt=""></a>`)}</div>` : nothing}
    ${renderConverter(m, code, name, perUsd)}
    ${renderRateLine(m, code)}`;
}

// A 24-hour ring: day half, night half, their hour hand and yours.
function hourIn(zone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const mi = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return h + mi / 60;
  } catch { return null; }
}

function renderSunClock(zone, lang) {
  const theirs = hourIn(zone);
  const mine = new Date().getHours() + new Date().getMinutes() / 60;
  if (theirs == null) return nothing;
  const ang = (h) => ((h / 24) * 360 - 90) * Math.PI / 180;
  const hand = (h, r) => `${(22 + r * Math.cos(ang(h))).toFixed(1)},${(22 + r * Math.sin(ang(h))).toFixed(1)}`;
  // Day from 6 to 18 on the ring (a sketch, not the sunrise table).
  const arc = (a, b, r) => {
    const s = ang(a); const e = ang(b);
    return `M22,22 L${(22 + r * Math.cos(s)).toFixed(1)},${(22 + r * Math.sin(s)).toFixed(1)} A${r},${r} 0 0 1 ${(22 + r * Math.cos(e)).toFixed(1)},${(22 + r * Math.sin(e)).toFixed(1)} Z`;
  };
  const label = `${t(lang, 'themNow')} ${String(Math.floor(theirs)).padStart(2, '0')}:${String(Math.round((theirs % 1) * 60)).padStart(2, '0')} · ${t(lang, 'youAre')} ${String(Math.floor(mine)).padStart(2, '0')}:${String(Math.round((mine % 1) * 60)).padStart(2, '0')}`;
  return html`<svg class="sunclock" viewBox="0 0 44 44" role="img" aria-label=${label}><title>${label}</title>
    <circle cx="22" cy="22" r="20" class="night"></circle>
    <path class="day" d=${arc(6, 18, 20)}></path>
    <circle cx="22" cy="22" r="20" class="rim"></circle>
    <line class="hand home" x1="22" y1="22" x2=${hand(mine, 14).split(',')[0]} y2=${hand(mine, 14).split(',')[1]}></line>
    <line class="hand" x1="22" y1="22" x2=${hand(theirs, 17).split(',')[0]} y2=${hand(theirs, 17).split(',')[1]}></line>
    <circle cx="22" cy="22" r="2.2" fill="#fff"></circle>
  </svg>`;
}

// 100 USD, precomputed in the local currency and in pesos; the amount is editable.
function renderConverter(m, code, name, perUsd) {
  const { lang, content, on } = m;
  if (!perUsd || code === 'USD') return nothing;
  const amount = m.convertAmount || 100;
  const nf = (n) => new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US', { maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
  const mxn = content.rates?.usd?.MXN;
  return html`<div class="convert">
    <input type="text" inputmode="decimal" .value=${String(amount)} aria-label=${t(lang, 'convert')} @change=${(e) => on('convert', e.target.value)}>
    <span>USD =</span>
    <b>${nf(amount * perUsd)} ${code}</b>
    ${mxn && code !== 'MXN' ? html`<span class="muted">· ${nf(amount * mxn)} MXN</span>` : nothing}
  </div>`;
}

function renderRateLine(m, code) {
  const { lang, content } = m;
  const h = content.rateHistory;
  if (!h?.days?.length || code === 'USD') return nothing;
  const series = h.perUsd.map((v) => (v == null ? null : v));
  const pts = series.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 10) return nothing;
  const W = 440;
  const H = 64;
  const padT = 8;
  const padB = 14;
  const vals = pts.map((p) => p[1]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const sx = (i) => (i / (series.length - 1)) * W;
  const sy = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const area = `${d}L${sx(pts.at(-1)[0]).toFixed(1)},${H - padB}L${sx(pts[0][0]).toFixed(1)},${H - padB}Z`;
  const first = vals[0];
  const last = vals.at(-1);
  const change = ((last - first) / first) * 100;
  const nf = (n) => new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US', { maximumSignificantDigits: 4 }).format(n);
  return html`
    <svg class="rateline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label=${t(lang, 'rateYear')}>
      <path class="fill" d=${area}></path>
      <path class="line" d=${d}></path>
      <text x="0" y=${H - 3}>${h.days[0].slice(0, 7)}</text>
      <text x=${W} y=${H - 3} text-anchor="end">${h.days.at(-1).slice(0, 7)}</text>
      <text x="0" y="9">${nf(min)}</text>
      <text x=${W} y="9" text-anchor="end">${nf(max)}</text>
    </svg>
    <p class="money-meta"><span>${t(lang, 'rateYear')}: 1 USD = ${nf(last)} ${code}</span><span style=${`color:${change > 0 ? 'var(--coral)' : '#1e7a3c'}`}>${change > 0 ? '+' : ''}${change.toFixed(1)}% ${lang === 'es' ? 'frente al dólar' : 'vs the dollar'}</span></p>`;
}
import { disputeNote } from '../data/disputed.js';
import { haversineKm } from '../geo/math.js';
import { renderAhora, renderDatos, renderLugares, renderVer, renderWiki } from './sections.js';
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
      ${hero?.src ? html`<img src=${hero.src} alt="" @load=${(e) => e.target.classList.add('ready')} @error=${(e) => { e.target.hidden = true; }}>` : nothing}
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
        ${m.factsOpen ? html`<div class="facts">${facts.map(([k, v]) => html`<div><span>${k}</span><strong title=${v}>${v}</strong></div>`)}</div>` : nothing}
        ${renderMoney(m)}` : nothing}
      ${body}
      <div class="chips" style="margin-top:18px">
        <span>${neighbors.length ? t(lang, 'neighbors') : t(lang, 'nearest')}</span>
        ${near.length ? near.map((c) => html`<button class="chip" @click=${() => on('go', c.iso2 || c.placeId)}>${c.flag ? html`<img alt="" src=${base + c.flag}>` : nothing}${c.name[lang] || c.name.en}</button>`) : html`<em class="muted small">${t(lang, 'noBorder')}</em>`}
      </div>
      <p class="src">${t(lang, 'sources')}: Wikipedia (CC BY-SA)${country.popYear ? `, World Bank ${country.popYear}` : ''}, Natural Earth, Wikidata. ${world.built}.
        <a href=${`https://github.com/vdm285/giramundo/issues/new?title=${encodeURIComponent(`Corrección: ${name}`)}`} target="_blank" rel="noreferrer">${t(lang, 'report')}</a></p>
    </div>`;
}
