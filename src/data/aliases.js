// Extra search words, and a note when the word is not the country's own name.
export const EXTRA_ALIASES = {
  US: ['EU', 'EUA', 'EEUU', 'EE UU', 'EE.UU.', 'USA', 'Estados Unidos de America'],
  GB: ['Inglaterra', 'Gran Bretana', 'Gran Bretaña', 'Reino Unido', 'UK', 'Britain', 'England'],
  NL: ['Holanda', 'Paises Bajos', 'Países Bajos', 'Holland'],
  MM: ['Birmania', 'Myanmar', 'Burma'],
  CZ: ['Chequia', 'Republica Checa', 'República Checa'],
  SZ: ['Suazilandia', 'Eswatini'],
  CI: ['Costa de Marfil', 'Ivory Coast'],
  TL: ['Timor Oriental', 'East Timor'],
  FK: ['Malvinas', 'Falklands', 'Islas Malvinas', 'Falkland'],
  KR: ['Corea del Sur', 'Corea', 'South Korea'],
  KP: ['Corea del Norte', 'Corea', 'North Korea'],
  CD: ['RDC', 'Congo Kinshasa', 'Republica Democratica del Congo'],
  CG: ['Congo Brazzaville', 'Republica del Congo'],
  AE: ['Emiratos', 'EAU', 'UAE'],
  RU: ['Rusia'],
  VA: ['Vaticano', 'Santa Sede'],
  BO: ['Bolivia'],
  VE: ['Venezuela'],
  TZ: ['Tanzania'],
  IR: ['Iran', 'Irán'],
  SY: ['Siria'],
  LA: ['Laos'],
  VN: ['Vietnam'],
  BN: ['Brunei'],
  CV: ['Cabo Verde'],
  ST: ['Santo Tome'],
  MK: ['Macedonia'],
  TR: ['Turquia', 'Turquía'],
  SA: ['Arabia'],
  NZ: ['Nueva Zelanda'],
  PG: ['Papua'],
  DO: ['Republica Dominicana'],
  SV: ['El Salvador'],
};

export const ALIAS_NOTES = {
  inglaterra: {
    iso: 'GB',
    es: 'Inglaterra es una de las naciones del Reino Unido. Te llevo al país.',
    en: 'England is one nation of the United Kingdom. Taking you to the country.',
  },
  england: {
    iso: 'GB',
    es: 'Inglaterra es una de las naciones del Reino Unido. Te llevo al país.',
    en: 'England is one nation of the United Kingdom. Taking you to the country.',
  },
  holanda: {
    iso: 'NL',
    es: 'Holanda es una región de los Países Bajos. Te llevo al país.',
    en: 'Holland is a region of the Netherlands. Taking you to the country.',
  },
  holland: {
    iso: 'NL',
    es: 'Holanda es una región de los Países Bajos. Te llevo al país.',
    en: 'Holland is a region of the Netherlands. Taking you to the country.',
  },
  malvinas: {
    iso: 'FK',
    es: 'Malvinas es el nombre que usa la Argentina. El Reino Unido dice Falkland. Abro la ficha con las dos posturas.',
    en: 'Malvinas is the name Argentina uses. The United Kingdom says Falkland. Opening the card with both positions.',
  },
  falklands: {
    iso: 'FK',
    es: 'El Reino Unido las llama Falkland. La Argentina dice Malvinas. Abro la ficha con las dos posturas.',
    en: 'The United Kingdom calls them the Falklands. Argentina says Malvinas. Opening the card with both positions.',
  },
  birmania: {
    iso: 'MM',
    es: 'Birmania y Myanmar son nombres del mismo país. Abro su ficha.',
    en: 'Burma and Myanmar are names for the same country. Opening its card.',
  },
};

export function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
