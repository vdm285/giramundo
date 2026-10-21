// Money: real banknotes and coins from Wikimedia Commons, the converter and
// the rate line. Pure templates; app/app.js owns the slideshow index.

import { html, nothing } from 'lit';
import { t } from '../app/i18n.js';
import { commonsPage, commonsThumb } from '../live/sources.js';

// Today's notes first; anything dated before 1990 or labeled specimen or
// historical waits behind a toggle (the future time slider's first job).
// An entry with `local` is an issuer's own file of the current issue
// (data/overrides/money.json): current whatever its year says.
export function splitBills(bills) {
  const current = [];
  const old = [];
  for (const b of bills) {
    const title = `${b.file || ''} ${b.series || ''}`;
    // Diagrams of a note's parts and security features are not notes.
    if (/partes de|diagram|esquema|elementos de seguridad|security feature|seguridad\d|hilo din|watermark|marca de agua|detalle|detail of|\.tif$|\.gif$/i.test(title)) continue;
    if (b.local) { current.push(b); continue; }
    const years = [...title.matchAll(/\b(1[6-9]\d\d|20\d\d)\b/g)].map((x) => Number(x[1]));
    const year = b.year || (years.length ? Math.max(...years) : null);
    const flagged = /specimen|histor|antigu|\bold\b|obsolet|demonetiz|emergency|provisional|revoluci|local issue|banco yucateco|comisi[oó]n reguladora/i.test(title);
    if (b.historical || flagged || (year != null && year < 1990)) old.push(b);
    else current.push(b);
  }
  // "Uncertain" when nothing proves a note from this century exists in the set:
  // the card then says Commons may not hold the current series. An issuer's
  // own file settles it.
  const uncertain = !bills.some((b) => b.local || (b.year && b.year >= 2000) || /current|polymer|europa|new|20[12]\d/i.test(`${b.series || ''} ${b.file || ''}`));
  return { current, old, uncertain };
}

// Image and credit link of a note or coin: an issuer's file served from
// public/data/, or the Commons thumbnail and file page.
const imageSrc = (f, base, width) => (f.local ? `${base}data/${f.local}` : commonsThumb(f.file, width));
const creditHref = (f) => f.terms || commonsPage(f.file);

// Real banknotes and coins from Wikimedia Commons. One rectangle for the
// bill (a slideshow across denominations), one circle beside it for the
// coin (its own slideshow). Hover shows denomination, currency and rate.
// The converter and the rate line live in Datos (renderConverter, renderRateLine).
export function renderMoney(m) {
  const { lang, country, money, on, content } = m;
  const code = country.currencies?.[0]?.code;
  const cur = code ? money?.[code] : null;
  if (!cur) return nothing;
  const { current, old, uncertain } = splitBills(cur.banknotes || []);
  const bills = m.moneyOld ? old : (current.length ? current : old);
  const uncertainNote = uncertain && bills.length ? html`<p class="small muted" style="margin:6px 0 0">${t(lang, 'moneyUncertain')}</p>` : nothing;
  const idx = bills.length ? (m.moneyIdx || 0) % bills.length : 0;
  const oldToggle = old.length && current.length
    ? html`<button class="chip" style="margin-top:6px" @click=${() => on('money-old')}>${m.moneyOld ? t(lang, 'moneyOldHide') : `${t(lang, 'moneyOld')} · ${old.length}`}</button>`
    : nothing;
  const rates = content.rates;
  const perUsd = rates?.usd?.[code];
  const fmt = (n) => new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US', { maximumSignificantDigits: 4 }).format(n);
  const rate = perUsd ? `1 USD = ${fmt(perUsd)} ${code}${code !== 'MXN' && rates.usd.MXN ? ` · 1 ${code} = ${fmt(rates.usd.MXN / perUsd)} MXN` : ''}` : '';
  const name = cur.name?.[lang] || cur.name?.en || code;
  if (!bills.length && !cur.coins?.length) {
    return html`<p class="small muted" style="margin:10px 0 0">${name} · ${code}${rate ? ` · ${rate}` : ''}</p>`;
  }
  const bill = bills[idx];
  const coins = (cur.coins || []).slice(0, 10);
  const cidx = coins.length ? (m.tick4 || 0) % coins.length : 0;
  const coin = coins[cidx];
  const base = m.base ?? import.meta.env.BASE_URL;
  return html`
    <div class="money-row">
      ${bills.length ? html`
      <div class="money" tabindex="0" aria-label=${`${t(lang, 'moneyBills')}: ${name}`}>
        ${bills.map((b, i) => html`<img class=${i === idx ? 'on' : ''} src=${imageSrc(b, base, 900)} alt=${`${b.denomination || ''} ${name}`} loading=${i === idx ? 'eager' : 'lazy'}>`)}
        ${bills.length > 1 ? html`<div class="dots">${bills.map((_, i) => html`<i class=${i === idx ? 'on' : ''}></i>`)}</div>
          <button class="step l" aria-label="prev" @click=${() => on('money-step', -1)}>‹</button>
          <button class="step r" aria-label="next" @click=${() => on('money-step', 1)}>›</button>` : nothing}
        <div class="label"><span><b>${bill.denomination ? `${bill.denomination} ` : ''}${name}</b>${bill.year || bill.series ? ` · ${[bill.series, bill.year].filter(Boolean).join(' ')}` : ''}${rate ? html`<br>${rate}` : nothing}</span>
          <a class="credit" style="position:static;background:none;padding:0" href=${creditHref(bill)} target="_blank" rel="noreferrer">${bill.license || 'Commons'}</a></div>
      </div>` : nothing}
      ${coin ? html`
      <a class="coin" href=${creditHref(coin)} target="_blank" rel="noreferrer" title=${`${coin.denomination ? `${coin.denomination} ` : ''}${name}${coin.license ? ` · ${coin.license}` : ''}`} aria-label=${t(lang, 'moneyCoins')}>
        ${coins.map((c, i) => html`<img class=${i === cidx ? 'on' : ''} src=${imageSrc(c, base, 320)} alt="" loading=${i === cidx ? 'eager' : 'lazy'}>`)}
        <span class="cap">${coin.denomination || ''}</span>
      </a>` : nothing}
    </div>
    ${uncertainNote}
    ${oldToggle}`;
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

export function renderSunClock(zone, lang) {
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
export function renderConverter(m, code, name, perUsd) {
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

export function renderRateLine(m, code) {
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
