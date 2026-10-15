// Coarse water names for taps that miss every country. Boxes are checked
// first, then a rough ocean split. The UI says these are approximate.

const WATERS = [
  { es: 'golfo de México', en: 'Gulf of Mexico', minLat: 18, maxLat: 31, minLon: -98, maxLon: -81 },
  { es: 'mar Caribe', en: 'Caribbean Sea', minLat: 9, maxLat: 22, minLon: -90, maxLon: -60 },
  { es: 'mar Mediterráneo', en: 'Mediterranean Sea', minLat: 30, maxLat: 46, minLon: -6, maxLon: 36 },
  { es: 'mar Rojo', en: 'Red Sea', minLat: 12, maxLat: 30, minLon: 32, maxLon: 44 },
  { es: 'golfo Pérsico', en: 'Persian Gulf', minLat: 23, maxLat: 31, minLon: 47, maxLon: 57 },
  { es: 'mar del Norte', en: 'North Sea', minLat: 51, maxLat: 62, minLon: -4, maxLon: 9 },
  { es: 'mar Báltico', en: 'Baltic Sea', minLat: 53, maxLat: 66, minLon: 9, maxLon: 30 },
  { es: 'mar Negro', en: 'Black Sea', minLat: 40, maxLat: 48, minLon: 27, maxLon: 42 },
  { es: 'bahía de Bengala', en: 'Bay of Bengal', minLat: 5, maxLat: 22, minLon: 80, maxLon: 95 },
  { es: 'mar de China Meridional', en: 'South China Sea', minLat: 0, maxLat: 23, minLon: 105, maxLon: 121 },
  { es: 'mar de Japón', en: 'Sea of Japan', minLat: 33, maxLat: 52, minLon: 127, maxLon: 142 },
];

function inBox(lat, lon, w) {
  return lat >= w.minLat && lat <= w.maxLat && lon >= w.minLon && lon <= w.maxLon;
}

export function nameWater(lat, lon, lang) {
  const sea = WATERS.find((w) => inBox(lat, lon, w));
  if (sea) return sea[lang] || sea.es;
  if (lat > 66) return lang === 'es' ? 'océano Ártico' : 'Arctic Ocean';
  if (lat < -55) return lang === 'es' ? 'océano Austral' : 'Southern Ocean';
  const pacific = lon <= -70 || lon >= 145 || (lat < 0 && lon >= 120);
  const indian = lon > 20 && lon < 120 && lat < 30 && lat > -55 && !(lat > 10 && lon < 40);
  if (indian && !(lon > 100 && lat > 0)) return lang === 'es' ? 'océano Índico' : 'Indian Ocean';
  if (pacific && !indian) return lang === 'es' ? 'océano Pacífico' : 'Pacific Ocean';
  return lang === 'es' ? 'océano Atlántico' : 'Atlantic Ocean';
}
