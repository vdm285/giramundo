function byArea(countries, n) {
  return [...countries].filter((c) => c.onMap && c.area).sort((a, b) => b.area - a.area).slice(0, n);
}

function byPop(countries, n) {
  return [...countries].filter((c) => c.onMap && c.population).sort((a, b) => b.population - a.population).slice(0, n);
}

export function buildJourneys(countries, lang) {
  const onMap = countries.filter((c) => c.onMap && c.ll && c.iso2 !== 'AQ');
  const equator = onMap.filter((c) => Math.abs(c.ll[0]) < 8).sort((a, b) => a.ll[1] - b.ll[1]).slice(0, 8);
  const locked = onMap.filter((c) => c.landlocked).sort((a, b) => (b.area || 0) - (a.area || 0)).slice(0, 8);
  const americas = ['CA', 'US', 'MX', 'CO', 'PE', 'BR', 'AR', 'CL']
    .map((iso) => onMap.find((c) => c.iso2 === iso))
    .filter(Boolean);
  const mexico = countries.find((c) => c.iso2 === 'MX');
  const neighbors = (mexico?.borders || [])
    .map((iso) => countries.find((c) => c.iso2 === iso))
    .filter(Boolean);
  const es = lang === 'es';
  return [
    {
      id: 'giants',
      title: es ? 'Los más grandes' : 'The largest',
      blurb: es ? 'Ocho países con más territorio en este mapa.' : 'Eight countries with the most land on this map.',
      stops: byArea(countries, 8).map((c) => c.iso2),
    },
    {
      id: 'people',
      title: es ? 'Donde vive más gente' : 'Where the most people live',
      blurb: es ? 'Por la población publicada, no por el tamaño.' : 'By the published population, not by size.',
      stops: byPop(countries, 8).map((c) => c.iso2),
    },
    {
      id: 'equator',
      title: es ? 'Cerca del ecuador' : 'Near the equator',
      blurb: es ? 'Su centro está a menos de 8° del ecuador. El país puede cruzarlo o solo acercarse.' : 'Their center is within 8° of the equator. The country may cross it, or only come close.',
      stops: equator.map((c) => c.iso2),
    },
    {
      id: 'locked',
      title: es ? 'Sin salida al mar' : 'No coast',
      blurb: es ? 'Una selección de países sin costa, de los más extensos.' : 'A selection of landlocked countries, starting with the largest.',
      stops: locked.map((c) => c.iso2),
    },
    {
      id: 'americas',
      title: es ? 'De norte a sur por América' : 'Down the Americas',
      blurb: es ? 'Un salto de norte a sur. No es cada país, es el camino.' : 'A hop from north to south. Not every country, just the path.',
      stops: americas.map((c) => c.iso2),
    },
    {
      id: 'casa',
      title: es ? 'Vecinos de México' : 'Mexico’s neighbors',
      blurb: es ? 'Los que comparten frontera terrestre con México.' : 'The ones that share a land border with Mexico.',
      stops: ['MX', ...neighbors.map((c) => c.iso2)],
    },
  ].filter((j) => j.stops.length > 1);
}
