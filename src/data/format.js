// Spanish exonyms for capitals the datasets leave in English.
// Only used when we are sure of the everyday Spanish name.
const ES_CAPITAL = {
  US: 'Washington D. C.',
  JP: 'Tokio',
  GB: 'Londres',
  FR: 'París',
  DE: 'Berlín',
  IT: 'Roma',
  CN: 'Pekín',
  KR: 'Seúl',
  KP: 'Pionyang',
  EG: 'El Cairo',
  GR: 'Atenas',
  SE: 'Estocolmo',
  DK: 'Copenhague',
  FI: 'Helsinki',
  PL: 'Varsovia',
  AT: 'Viena',
  CZ: 'Praga',
  HU: 'Budapest',
  RO: 'Bucarest',
  PT: 'Lisboa',
  NL: 'Ámsterdam',
  BE: 'Bruselas',
  CH: 'Berna',
  RU: 'Moscú',
  UA: 'Kiev',
  TR: 'Ankara',
  IN: 'Nueva Delhi',
  TH: 'Bangkok',
  VN: 'Hanói',
  AU: 'Canberra',
  CA: 'Ottawa',
  BR: 'Brasilia',
  AR: 'Buenos Aires',
  CO: 'Bogotá',
  PE: 'Lima',
  CL: 'Santiago',
  ZA: 'Pretoria',
  NG: 'Abuya',
  KE: 'Nairobi',
  ET: 'Adís Abeba',
  MA: 'Rabat',
  SA: 'Riad',
  IR: 'Teherán',
  IQ: 'Bagdad',
  PK: 'Islamabad',
  AF: 'Kabul',
  BD: 'Daca',
  PH: 'Manila',
  MY: 'Kuala Lumpur',
  ID: 'Yakarta',
  NZ: 'Wellington',
  IE: 'Dublín',
  NO: 'Oslo',
  IS: 'Reikiavik',
  HR: 'Zagreb',
  RS: 'Belgrado',
  BG: 'Sofía',
  SK: 'Bratislava',
  SI: 'Liubliana',
  LT: 'Vilna',
  LV: 'Riga',
  EE: 'Tallin',
  BY: 'Minsk',
  GE: 'Tiflis',
  AM: 'Ereván',
  AZ: 'Bakú',
  KZ: 'Astaná',
  UZ: 'Taskent',
  MN: 'Ulán Bator',
  NP: 'Katmandú',
  MM: 'Naipyidó',
  KH: 'Nom Pen',
  LA: 'Vientián',
  TW: 'Taipéi',
  SG: 'Singapur',
  IL: 'Jerusalén',
  SY: 'Damasco',
  LB: 'Beirut',
  JO: 'Amán',
  YE: 'Saná',
  AE: 'Abu Dabi',
  QA: 'Doha',
  KW: 'Kuwait',
  OM: 'Mascate',
  DZ: 'Argel',
  TN: 'Túnez',
  LY: 'Trípoli',
  SD: 'Jartum',
  SS: 'Yuba',
  CD: 'Kinsasa',
  CG: 'Brazzaville',
  AO: 'Luanda',
  MZ: 'Maputo',
  TZ: 'Dodoma',
  UG: 'Kampala',
  GH: 'Acra',
  SN: 'Dakar',
  ML: 'Bamako',
  CM: 'Yaundé',
  MG: 'Antananarivo',
  CU: 'La Habana',
  DO: 'Santo Domingo',
  HT: 'Puerto Príncipe',
  PA: 'Ciudad de Panamá',
  CR: 'San José',
  GT: 'Ciudad de Guatemala',
  SV: 'San Salvador',
  HN: 'Tegucigalpa',
  NI: 'Managua',
  VE: 'Caracas',
  UY: 'Montevideo',
  PY: 'Asunción',
  BO: 'Sucre',
  EC: 'Quito',
  GY: 'Georgetown',
  SR: 'Paramaribo',
};

const CAPITAL_TZ = {
  US: 'America/New_York',
  MX: 'America/Mexico_City',
  CA: 'America/Toronto',
  RU: 'Europe/Moscow',
  BR: 'America/Sao_Paulo',
  AU: 'Australia/Sydney',
  CL: 'America/Santiago',
  EC: 'America/Guayaquil',
  PT: 'Europe/Lisbon',
  ES: 'Europe/Madrid',
  CD: 'Africa/Kinshasa',
  ID: 'Asia/Jakarta',
  KZ: 'Asia/Almaty',
  MN: 'Asia/Ulaanbaatar',
  NZ: 'Pacific/Auckland',
  CN: 'Asia/Shanghai',
  AR: 'America/Argentina/Buenos_Aires',
  GL: 'America/Nuuk',
  PF: 'Pacific/Tahiti',
  KI: 'Pacific/Tarawa',
  UA: 'Europe/Kyiv',
  PS: 'Asia/Hebron',
  IL: 'Asia/Jerusalem',
  FM: 'Pacific/Chuuk',
  PG: 'Pacific/Port_Moresby',
};

const CONTINENT = {
  'North America': { es: 'América del Norte', en: 'North America' },
  'South America': { es: 'América del Sur', en: 'South America' },
  Europe: { es: 'Europa', en: 'Europe' },
  Africa: { es: 'África', en: 'Africa' },
  Asia: { es: 'Asia', en: 'Asia' },
  Oceania: { es: 'Oceanía', en: 'Oceania' },
  Antarctica: { es: 'Antártida', en: 'Antarctica' },
  Other: { es: 'Otro', en: 'Other' },
};

export function locale(lang) {
  return lang === 'es' ? 'es-MX' : 'en-US';
}

export function formatCount(n, lang) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(locale(lang)).format(n);
}

export function formatCompact(n, lang) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(locale(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function continentOf(country) {
  const s = `${country.subregion || ''} ${country.region || ''}`;
  if (/south america/i.test(s)) return 'South America';
  if (/america/i.test(s)) return 'North America';
  if (/africa/i.test(country.region || '')) return 'Africa';
  if (/europe/i.test(country.region || '')) return 'Europe';
  if (/asia/i.test(country.region || '')) return 'Asia';
  if (/oceania/i.test(country.region || '')) return 'Oceania';
  if (/antarct/i.test(country.region || '')) return 'Antarctica';
  return 'Other';
}

export function continentLabel(key, lang) {
  return CONTINENT[key]?.[lang] || key;
}

export function displayCapital(country, lang) {
  if (!country) return '';
  if (country.iso2 === 'PS') return '';
  if (lang === 'es' && ES_CAPITAL[country.iso2]) return ES_CAPITAL[country.iso2];
  return country.capital?.[lang] || country.capital?.en || '';
}

export function mainZone(country) {
  const zones = country?.timezones || [];
  const preferred = CAPITAL_TZ[country?.iso2];
  if (preferred && zones.includes(preferred)) return preferred;
  if (preferred && !zones.length) return preferred;
  return zones[0] || preferred || null;
}

export function formatTime(zone, lang, date = new Date()) {
  if (!zone) return '';
  try {
    return new Intl.DateTimeFormat(locale(lang), {
      hour: '2-digit', minute: '2-digit', timeZone: zone, hourCycle: 'h23',
    }).format(date);
  } catch {
    return '';
  }
}

export function languageNames(codes, lang) {
  const dn = new Intl.DisplayNames([locale(lang)], { type: 'language' });
  return (codes || []).map((code) => {
    try { return dn.of(code); } catch { return code; }
  }).filter(Boolean);
}

export function currencyLabel(currency, lang) {
  if (!currency) return '';
  try {
    const name = new Intl.DisplayNames([locale(lang)], { type: 'currency' }).of(currency.code);
    return `${name} · ${currency.code}`;
  } catch {
    return currency.code;
  }
}

export function timesPhrase(n) {
  if (n < 10) {
    const s = n.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  }
  return String(Math.round(n));
}

export function sizeVersus(area, name, mxArea, mxName, lang) {
  if (!area || !mxArea) return '';
  const ratio = mxArea / area;
  if (ratio > 0.87 && ratio < 1.15) {
    return lang === 'es'
      ? `${name} y ${mxName} tienen un tamaño parecido.`
      : `${name} and ${mxName} are about the same size.`;
  }
  if (ratio > 1) {
    const n = timesPhrase(ratio);
    return lang === 'es'
      ? `${name} cabe unas ${n} veces en ${mxName}.`
      : `${name} would fit about ${n} times inside ${mxName}.`;
  }
  const n = timesPhrase(1 / ratio);
  return lang === 'es'
    ? `${mxName} cabe unas ${n} veces en ${name}.`
    : `${mxName} would fit about ${n} times inside ${name}.`;
}

export function zoneSentence(lat, lang, date = new Date()) {
  const abs = Math.abs(lat);
  if (abs < 15) {
    return lang === 'es'
      ? 'Está en el trópico. Allí el año se parece más a temporada de lluvias y temporada seca que a verano e invierno. Es una pista por la latitud, no un pronóstico.'
      : 'This place is in the tropics. The year there is shaped more by rain and dry seasons than by summer and winter. That is a hint from latitude, not a forecast.';
  }
  if (abs >= 66.5) {
    return lang === 'es'
      ? 'Está en la zona polar. Hay épocas con sol de medianoche y épocas con noches muy largas.'
      : 'This place is in the polar zone. Parts of the year have midnight sun, and parts have very long nights.';
  }
  const month = date.getMonth();
  const north = ['invierno', 'invierno', 'primavera', 'primavera', 'primavera', 'verano', 'verano', 'verano', 'otoño', 'otoño', 'otoño', 'invierno'];
  const northEn = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const season = lat >= 0 ? north[month] : north[(month + 6) % 12];
  const seasonEn = lat >= 0 ? northEn[month] : northEn[(month + 6) % 12];
  const hemi = lat >= 0
    ? (lang === 'es' ? 'norte' : 'northern')
    : (lang === 'es' ? 'sur' : 'southern');
  return lang === 'es'
    ? `En el hemisferio ${hemi}, por el mes en que estamos, toca ${season}. Es aproximado: cerca del mar o de una montaña el tiempo cambia.`
    : `In the ${hemi} hemisphere, this month falls in ${seasonEn}. That is approximate: coasts and mountains keep their own weather.`;
}

export function sentences(text, maxChars) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > 60) return cut.slice(0, end + 1);
  return `${cut.trim()}…`;
}

export function familyQuestion(name, lang) {
  return lang === 'es'
    ? `Si pudieras visitar ${name}, ¿qué te gustaría conocer primero?`
    : `If you could visit ${name}, what would you want to see first?`;
}
