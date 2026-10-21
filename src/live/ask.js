// "Preguntar": a short, targeted prompt opened in Google AI Mode in the
// reader's own browser. No key, no API, nothing leaves the page until the
// reader clicks. Verified 2026-10-20: google.com/search?q=...&udm=50&sn=aim
// opens AI Mode with the query and answers with cited sources.
//
// Prompts are deliberately short: the model does not need to know about
// this app, only the country, the thing in focus and the question.

const MAX = 1800;

export function aiModeUrl(prompt) {
  return `https://www.google.com/search?udm=50&sn=aim&q=${encodeURIComponent(prompt.slice(0, MAX))}`;
}

const list = (items, n) => items.filter(Boolean).slice(0, n).join(', ');

// One headline, one country. Staged on purpose: a bare "give context" request
// came back as a summary of the article. Asking the model to first read it,
// then name the underlying themes, then pull earlier news and history that
// explain those themes, gives the connect-the-dots answer the reader wanted.
export function headlinePrompt(headline, countryName, lang) {
  return lang === 'es'
    ? `Noticia de ${countryName}: "${headline}". Trabaja en pasos. 1) Busca la noticia y resume en dos líneas qué pasó. 2) Nombra los temas de fondo que toca (instituciones, actores, conflictos o procesos de largo plazo). 3) Para cada tema, trae noticias anteriores y hechos históricos de ${countryName} que lo expliquen, con fechas y fuentes locales. 4) Cierra con qué conviene seguir observando. Sin introducción ni repetir la pregunta.`
    : `News from ${countryName}: "${headline}". Work in steps. 1) Find the story and summarize what happened in two lines. 2) Name the underlying themes it touches (institutions, actors, long-running conflicts or processes). 3) For each theme, bring earlier news and historical facts from ${countryName} that explain it, with dates and local sources. 4) Close with what to watch next. No preamble, do not repeat the question.`;
}

// The prompt for the current view: country or city, the items in focus, one question.
export function buildPrompt(m) {
  const { lang, country, section, content = {}, places, culture, city, compareCountry } = m;
  const es = lang === 'es';
  const name = country?.name?.[lang] || country?.name?.en || '';
  const cname = city ? (city.name?.[lang] || city.name?.en) : null;
  const where = cname ? `${cname}, ${name}` : name;
  const tail = es ? 'Fuentes recientes.' : 'Recent sources.';

  if (compareCountry) {
    const other = compareCountry.name?.[lang] || compareCountry.name?.en;
    return es
      ? `${name} y ${other}: compara su historia reciente, economía y vida cotidiana. ¿Qué los acerca y qué los separa? ${tail}`
      : `${name} and ${other}: compare recent history, economy and everyday life. What brings them together and what sets them apart? ${tail}`;
  }

  switch (section) {
    case 'ahora': {
      const heads = [...(content.news?.[lang] || []), ...(content.news?.[es ? 'en' : 'es'] || [])].slice(0, 3).map((n) => `"${n.title}"`);
      return es
        ? `${where}, esta semana. Titulares: ${heads.join('; ') || 'sin titulares a la mano'}. ¿Qué está pasando, qué historia reciente lo explica y qué dicen los locales? ${tail}`
        : `${where}, this week. Headlines: ${heads.join('; ') || 'none at hand'}. What is happening, what recent history explains it, and what are locals saying? ${tail}`;
    }
    case 'comida': {
      const dishes = (places?.dishes || []).map((d) => (d.label?.local && d.label.local !== (d.label?.[lang] || '') ? d.label.local : (d.label?.[lang] || d.label?.en)));
      return es
        ? `Cocina de ${where}: ${list(dishes, 6)}. ¿Cómo los preparan en casa los locales, en qué regiones y ocasiones se comen, y qué versiones turísticas conviene evitar? ${tail}`
        : `Food of ${where}: ${list(dishes, 6)}. How do locals cook them at home, in which regions and occasions, and which tourist versions should be avoided? ${tail}`;
    }
    case 'cultura': {
      const people = (culture?.people || []).map((p) => p.label?.[lang] || p.label?.en);
      return es
        ? `Cultura cotidiana de ${where}, más allá de los clichés: costumbres, humor, música que escuchan los locales, y por qué figuras como ${list(people, 4)} importan allí. ${tail}`
        : `Everyday culture of ${where}, beyond the clichés: customs, humor, the music locals listen to, and why figures like ${list(people, 4)} matter there. ${tail}`;
    }
    case 'lugares': {
      const focus = content.place ? (content.place.label?.[lang] || content.place.label?.en) : null;
      const sites = (places?.heritage || []).map((h) => h.label?.[lang] || h.label?.en);
      return es
        ? `${focus || list(sites, 5)} (${where}): historia detrás del lugar, cómo lo viven los locales hoy y cómo se visita sin la versión de postal. ${tail}`
        : `${focus || list(sites, 5)} (${where}): the story behind the place, how locals relate to it today, and how to visit it without the postcard version. ${tail}`;
    }
    case 'ver':
      return es
        ? `Barrios y calles de ${cname || name} por los que caminan los locales, no los turistas: cuáles, a qué hora, y qué se come por ahí. ${tail}`
        : `Neighborhoods and streets of ${cname || name} where locals walk, not tourists: which ones, when, and what to eat nearby. ${tail}`;
    case 'datos':
      return es
        ? `${name}: ¿cómo han cambiado población, esperanza de vida e ingreso por persona en las últimas décadas, y qué lo explica? ${tail}`
        : `${name}: how have population, life expectancy and income per person changed over recent decades, and what explains it? ${tail}`;
    default:
      return es
        ? `${where}: ¿qué momentos de su historia explican mejor cómo es hoy, y qué sigue pesando en la vida diaria? ${tail}`
        : `${where}: which moments of its history best explain how it is today, and what still weighs on daily life? ${tail}`;
  }
}
