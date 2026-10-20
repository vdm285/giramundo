// "Pregúntale a la IA": a context-rich prompt assembled from what the reader
// has on screen, opened in Google AI Mode in their own browser. No key, no
// API, nothing leaves the page until the reader clicks. Verified 2026-10-20:
// google.com/search?q=...&udm=50&sn=aim opens AI Mode with the query, and a
// 2,000-character Spanish prompt answered with cited sources.

const MAX = 1800;

export function aiModeUrl(prompt) {
  return `https://www.google.com/search?udm=50&sn=aim&q=${encodeURIComponent(prompt.slice(0, MAX))}`;
}

function list(items, n) {
  return items.filter(Boolean).slice(0, n).join(', ');
}

// Build the prompt for the current view. `m` is the dossier model: lang,
// country, section, content, places, culture, city, compare (country), world.
export function buildPrompt(m) {
  const { lang, country, section, content = {}, places, culture, city, compareCountry } = m;
  const es = lang === 'es';
  const name = country?.name?.[lang] || country?.name?.en || '';
  const parts = [];
  const read = [];

  if (city) {
    const cname = city.name?.[lang] || city.name?.en;
    parts.push(es
      ? `Estoy explorando ${cname}, ${name}, en Giramundo, un globo interactivo.`
      : `I am exploring ${cname}, ${name}, on Giramundo, an interactive globe.`);
    if (content.citySummary?.description) read.push(content.citySummary.description);
  } else {
    parts.push(es
      ? `Estoy explorando ${name} en Giramundo, un globo interactivo.`
      : `I am exploring ${name} on Giramundo, an interactive globe.`);
  }

  const capital = country?.capital?.[lang] || country?.capital?.en;
  if (capital && !city) read.push(es ? `capital ${capital}` : `capital ${capital}`);

  if (section === 'ahora' || section === 'historia') {
    const heads = [...(content.news?.[lang] || []), ...(content.news?.[lang === 'es' ? 'en' : 'es'] || [])].slice(0, 4).map((n) => `"${n.title}"`);
    if (heads.length) read.push((es ? 'titulares de hoy: ' : "today's headlines: ") + heads.join(', '));
  }
  if (section === 'comida') {
    const dishes = (places?.dishes || []).map((d) => d.label?.local && d.label.local !== (d.label?.[lang] || '') ? `${d.label?.[lang] || d.label?.en} (${d.label.local})` : (d.label?.[lang] || d.label?.en));
    if (dishes.length) read.push((es ? 'platos típicos: ' : 'typical dishes: ') + list(dishes, 8));
  }
  if (section === 'lugares') {
    const sites = (places?.heritage || []).map((h) => h.label?.[lang] || h.label?.en);
    if (sites.length) read.push((es ? 'sitios Patrimonio de la Humanidad: ' : 'World Heritage sites: ') + list(sites, 8));
    if (content.place) read.push((es ? 'me interesa en particular ' : 'I am especially interested in ') + (content.place.label?.[lang] || content.place.label?.en));
  }
  if (section === 'cultura') {
    const people = (culture?.people || []).map((p) => p.label?.[lang] || p.label?.en);
    if (people.length) read.push((es ? 'gente notable: ' : 'notable people: ') + list(people, 8));
    const langs = (culture?.languages || []).map((l) => l.label?.[lang] || l.label?.en);
    if (langs.length) read.push((es ? 'idiomas: ' : 'languages: ') + list(langs, 4));
    if (culture?.anthem?.label) read.push((es ? 'himno: ' : 'anthem: ') + (culture.anthem.label[lang] || culture.anthem.label.en));
  }
  if (section === 'datos' && country?.population) {
    read.push(es ? `población ${country.population.toLocaleString('es-MX')}` : `population ${country.population.toLocaleString('en-US')}`);
  }
  if (compareCountry) {
    read.push((es ? 'lo comparo con ' : 'I am comparing it with ') + (compareCountry.name?.[lang] || compareCountry.name?.en));
  }

  if (read.length) parts.push((es ? 'Leí en la ficha: ' : 'I read on the card: ') + read.join('; ') + '.');

  const ask = {
    ahora: es ? `¿Qué está pasando esta semana en ${name} y qué contexto histórico ayuda a entenderlo?` : `What is happening this week in ${name}, and what historical context helps make sense of it?`,
    historia: es ? `¿Qué momentos de la historia de ${name} explican mejor cómo es hoy?` : `Which moments in ${name}'s history best explain how it is today?`,
    comida: es ? `¿Cómo preparan estos platos los locales y qué los hace diferentes de las versiones para turistas?` : `How do locals actually prepare these dishes, and what makes them different from the tourist versions?`,
    cultura: es ? `¿Qué debería saber sobre la cultura cotidiana de ${name}, más allá de los clichés?` : `What should I know about everyday culture in ${name}, beyond the clichés?`,
    lugares: es ? `¿Cuál es la historia detrás de estos lugares y cómo se visitan hoy?` : `What is the story behind these places, and how are they visited today?`,
    ver: es ? `¿Qué barrios o calles de ${city ? (city.name?.[lang] || city.name?.en) : name} vale la pena caminar y por qué?` : `Which neighborhoods or streets of ${city ? (city.name?.[lang] || city.name?.en) : name} are worth walking, and why?`,
    datos: es ? `¿Qué explican estas cifras sobre ${name} y cómo han cambiado en las últimas décadas?` : `What do these figures say about ${name}, and how have they changed over recent decades?`,
  };
  parts.push(ask[section] || ask.ahora);
  parts.push(es ? 'Responde en español con fuentes recientes.' : 'Answer in English with recent sources.');
  return parts.join(' ').slice(0, MAX);
}
