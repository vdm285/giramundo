// Tours: ordered stops with a one-line reason each. Computed from the data,
// never hand-typed numbers. A stop is { iso2, ll?, dist?, blurb }.

function byArea(countries, n) {
  return countries.filter((c) => c.onMap && c.area && c.iso2 !== 'AQ').sort((a, b) => b.area - a.area).slice(0, n);
}
function byPop(countries, n) {
  return countries.filter((c) => c.onMap && c.population).sort((a, b) => b.population - a.population).slice(0, n);
}
function fmt(n, lang) {
  return new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function buildJourneys(world, lang) {
  const es = lang === 'es';
  const all = world.countries;
  const onMap = all.filter((c) => c.onMap && c.ll && c.iso2 && c.iso2 !== 'AQ');
  const name = (c) => c.name[lang] || c.name.en;
  const equator = onMap.filter((c) => Math.abs(c.ll[0]) < 8).sort((a, b) => a.ll[1] - b.ll[1]).slice(0, 9);
  const locked = onMap.filter((c) => c.landlocked).sort((a, b) => (b.area || 0) - (a.area || 0)).slice(0, 8);
  const americas = ['CA', 'US', 'MX', 'GT', 'CO', 'PE', 'BR', 'AR', 'CL'].map((iso) => world.byIso.get(iso)).filter((c) => c?.onMap);
  const mexico = world.byIso.get('MX');
  const neighbors = (mexico?.borders || []).map((iso) => world.byIso.get(iso)).filter(Boolean);
  const heritageMX = (world.places?.MX?.heritage || []).filter((h) => h.ll && h.image).slice(0, 8);

  // Famous sites across the world: the first photographed site of a spread of countries.
  const wonders = ['PE', 'EG', 'IN', 'CN', 'JO', 'IT', 'KH', 'GR', 'TR', 'AU']
    .map((iso) => ({ iso, site: (world.places?.[iso]?.heritage || []).find((h) => h.ll && h.image) }))
    .filter((x) => x.site);

  const journeys = [
    {
      id: 'giants',
      title: es ? 'Los gigantes' : 'The giants',
      blurb: es ? 'Los ocho países con más territorio en este mapa.' : 'The eight countries with the most land on this map.',
      stops: byArea(all, 8).map((c) => ({ iso2: c.iso2, dist: 3.2, blurb: `${fmt(Math.round(c.area), lang)} km²` })),
    },
    {
      id: 'people',
      title: es ? 'Donde vive más gente' : 'Where the most people live',
      blurb: es ? 'Por la población publicada, no por el tamaño.' : 'By published population, not by size.',
      stops: byPop(all, 8).map((c) => ({ iso2: c.iso2, blurb: `${fmt(c.population, lang)} ${es ? 'personas' : 'people'}${c.popYear ? ` · ${c.popYear}` : ''}` })),
    },
    {
      id: 'equator',
      title: es ? 'La vuelta por el ecuador' : 'Around the equator',
      blurb: es ? 'De oeste a este, países cuyo centro está a menos de 8° del ecuador.' : 'West to east, countries whose center sits within 8° of the equator.',
      stops: equator.map((c) => ({ iso2: c.iso2, blurb: `${c.ll[0].toFixed(1)}° ${es ? 'de latitud' : 'latitude'}` })),
    },
    {
      id: 'locked',
      title: es ? 'Sin salida al mar' : 'No coastline',
      blurb: es ? 'Los países sin costa más extensos.' : 'The largest landlocked countries.',
      stops: locked.map((c) => ({ iso2: c.iso2, blurb: `${fmt(Math.round(c.area), lang)} km²` })),
    },
    {
      id: 'americas',
      title: es ? 'De norte a sur por América' : 'Down the Americas',
      blurb: es ? 'Un salto de Canadá a Chile. No es cada país, es el camino.' : 'A hop from Canada to Chile. Not every country, just the path.',
      stops: americas.map((c) => ({ iso2: c.iso2, blurb: c.capital?.[lang] || c.capital?.en || '' })),
    },
    {
      id: 'casa',
      title: es ? 'México y sus vecinos' : 'Mexico and its neighbors',
      blurb: es ? 'Los que comparten frontera terrestre con México.' : 'The ones that share a land border with Mexico.',
      stops: [mexico, ...neighbors].filter(Boolean).map((c) => ({ iso2: c.iso2, blurb: c.capital?.[lang] || '' })),
    },
  ];
  if (heritageMX.length > 2) {
    journeys.push({
      id: 'patrimonio-mx',
      title: es ? 'Patrimonio de México' : 'Mexico’s World Heritage',
      blurb: es ? 'Ocho sitios de la lista de la UNESCO, de cerca.' : 'Eight UNESCO sites, up close.',
      stops: heritageMX.map((h) => ({ iso2: 'MX', ll: h.ll, dist: 1.45, place: h, blurb: h.label?.[lang] || h.label?.en })),
    });
  }
  if (wonders.length > 4) {
    journeys.push({
      id: 'wonders',
      title: es ? 'Diez maravillas' : 'Ten wonders',
      blurb: es ? 'Un sitio célebre por país, en diez países.' : 'One famous site per country, across ten countries.',
      stops: wonders.map(({ iso, site }) => ({ iso2: iso, ll: site.ll, dist: 1.5, place: site, blurb: site.label?.[lang] || site.label?.en })),
    });
  }
  return journeys.filter((j) => j.stops.length > 1).map((j) => ({ ...j, stops: j.stops.map((s) => ({ ...s, name: name(world.byIso.get(s.iso2) || { name: {} }) })) }));
}
