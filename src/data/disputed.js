// Neutral notes for places this map cannot draw without a dispute.
// They name the claims. They do not pick a winner. Kid versions stay short
// and skip graphic detail. Map-specific lines are added by the caller when
// a test point falls inside a shape (see noteFor).

const NOTES = {
  XK: {
    es: 'Kosovo declaró su independencia en 2008. Serbia no la reconoce. Una parte de los países del mundo sí la reconoce y otra no. Este mapa lo dibuja como una forma propia, sin decidir la disputa.',
    en: 'Kosovo declared independence in 2008. Serbia does not recognize it. Some countries do, and others do not. This map draws it as its own shape and does not settle the dispute.',
    kid: {
      es: 'Hay países que no se ponen de acuerdo sobre si Kosovo es independiente. El mapa lo muestra aparte y no toma partido.',
      en: 'Countries disagree about whether Kosovo is independent. The map shows it separately and does not take a side.',
    },
  },
  FK: {
    es: 'El Reino Unido administra estas islas y las llama Falkland Islands. La Argentina las reclama como las Islas Malvinas y las considera parte de su territorio. El mapa muestra el control de facto, no un fallo.',
    en: 'The United Kingdom administers these islands and calls them the Falkland Islands. Argentina claims them as the Islas Malvinas and says they are part of its territory. The map shows de facto control, not a verdict.',
    kid: {
      es: 'La Argentina y el Reino Unido no se ponen de acuerdo sobre de quién son estas islas. Unos dicen Malvinas y otros Falkland.',
      en: 'Argentina and the United Kingdom disagree about these islands. One name is Malvinas and the other is Falkland.',
    },
  },
  EH: {
    es: 'Marruecos administra gran parte de este territorio, incluida El Aaiún, y en este mapa esa ciudad cae dentro de la forma de Marruecos. El Frente Polisario proclama la República Árabe Saharaui Democrática sobre el conjunto. La ONU lo lista como territorio no autónomo. La forma llamada Sahara Occidental es el dibujo de Natural Earth, no un reconocimiento.',
    en: 'Morocco administers much of this territory, including Laayoune, and on this map that city falls inside the Morocco shape. The Polisario Front proclaims the Sahrawi Arab Democratic Republic over the whole territory. The UN lists it as a non-self-governing territory. The Western Sahara shape is Natural Earth’s drawing, not a recognition.',
    kid: {
      es: 'Varias partes dicen que esta tierra les pertenece. Los gobiernos todavía no se ponen de acuerdo.',
      en: 'More than one side says this land is theirs. Governments still do not agree.',
    },
  },
  MA: {
    es: 'En este mapa, El Aaiún cae dentro de la forma de Marruecos. El Sahara Occidental sigue dibujado aparte: Marruecos administra gran parte, el Frente Polisario reclama un estado propio y la ONU lo trata como territorio no autónomo.',
    en: 'On this map, Laayoune falls inside the Morocco shape. Western Sahara is still drawn separately: Morocco administers much of it, the Polisario Front claims a state of its own, and the UN treats it as a non-self-governing territory.',
    kid: {
      es: 'Al lado de Marruecos hay un territorio cuyo nombre y dueño no están acordados. El mapa muestra las dos formas.',
      en: 'Next to Morocco there is a territory whose name and status are not agreed. The map shows both shapes.',
    },
  },
  TW: {
    es: 'La isla la gobierna el gobierno de Taipéi. Pekín afirma que Taiwán forma parte de China. Los países mantienen relaciones distintas con cada lado. Este mapa dibuja la isla como una forma propia, que es el control de facto, y no resuelve el estatus.',
    en: 'The island is governed from Taipei. Beijing says Taiwan is part of China. Countries keep different relationships with each side. This map draws the island as its own shape, which is de facto control, and does not decide the status.',
    kid: {
      es: 'Los gobiernos no se ponen de acuerdo sobre el estatus de esta isla. Aquí puedes tocarla para conocerla, y el mapa no dice quién tiene la razón.',
      en: 'Governments disagree about the status of this island. You can tap it to learn about it. The map does not say who is right.',
    },
  },
  IL: {
    es: 'Israel y Palestina mantienen un conflicto sobre fronteras, seguridad y estado. Jerusalén y otras zonas se reclaman de las dos partes. Hay países que reconocen al Estado de Palestina y países que no. Este mapa sigue las formas de Natural Earth y no es un fallo.',
    en: 'Israel and Palestine are in a conflict over borders, security and statehood. Jerusalem and other areas are claimed by both sides. Some countries recognize the State of Palestine and others do not. This map follows Natural Earth’s shapes and is not a verdict.',
    kid: {
      es: 'Israel y Palestina tienen un desacuerdo muy serio sobre la tierra y las fronteras. Este mapa no dice quién tiene la razón.',
      en: 'Israel and Palestine have a serious disagreement about the land and the borders. This map does not say who is right.',
    },
  },
  PS: {
    es: 'Israel y Palestina mantienen un conflicto sobre fronteras, seguridad y estado. Las fuentes de este mapa no coinciden en una sola capital: una lista Ramala y otra Jerusalén Este. Hay países que reconocen al Estado de Palestina y países que no. El dibujo es el de Natural Earth, no un fallo.',
    en: 'Israel and Palestine are in a conflict over borders, security and statehood. The sources behind this map do not agree on one capital: one lists Ramallah, another East Jerusalem. Some countries recognize the State of Palestine and others do not. The drawing is Natural Earth’s, not a verdict.',
    kid: {
      es: 'Israel y Palestina tienen un desacuerdo muy serio sobre la tierra y las fronteras. Las personas adultas tampoco coinciden en cómo nombrar la capital.',
      en: 'Israel and Palestine have a serious disagreement about the land and the borders. Adults also disagree about what to call the capital.',
    },
  },
  RU: {
    es: 'En este archivo de mapa, el punto de Crimea cae dentro de la forma de Rusia. Ucrania, y la mayor parte de los países en la ONU, consideran Crimea y otras zonas ocupadas como territorio de Ucrania. Rusia dice que son suyas y las administra. El mapa muestra ese control de facto, no un reconocimiento.',
    en: 'In this map file, the point for Crimea falls inside the Russia shape. Ukraine, and most countries at the UN, consider Crimea and other occupied areas to be Ukraine’s territory. Russia says they are Russian and administers them. The map shows that de facto control, not a recognition.',
    kid: {
      es: 'Rusia y Ucrania no se ponen de acuerdo sobre Crimea y otras zonas. El mapa muestra quién las controla ahora, y eso no quiere decir que todos lo acepten.',
      en: 'Russia and Ukraine disagree about Crimea and other areas. The map shows who controls them now, which is not the same as everyone accepting it.',
    },
  },
  UA: {
    es: 'Rusia controla Crimea y otras zonas que Ucrania y la mayor parte de la ONU consideran ucranianas. En este archivo, el punto de Crimea cae dentro de la forma de Rusia, porque el mapa sigue el control de facto de Natural Earth. Ucrania no acepta esa pérdida.',
    en: 'Russia controls Crimea and other areas that Ukraine and most of the UN consider Ukrainian. In this file, the point for Crimea falls inside the Russia shape, because the map follows Natural Earth’s de facto control. Ukraine does not accept that loss.',
    kid: {
      es: 'Ucrania y Rusia no se ponen de acuerdo sobre partes de la frontera. El mapa muestra el control de ahora, no una decisión final.',
      en: 'Ukraine and Russia disagree about parts of the border. The map shows who is in control now, not a final decision.',
    },
  },
  IN: {
    es: 'Cachemira es reclamada, en partes distintas, por India, Pakistán y China. El punto de prueba que usamos (cerca de 34°N, 76°E) cae, en este archivo, dentro de la forma de India. Eso describe este dibujo, no la disputa entera.',
    en: 'Kashmir is claimed, in different parts, by India, Pakistan and China. The test point we use (near 34°N, 76°E) falls inside the India shape in this file. That describes this drawing, not the whole dispute.',
    kid: {
      es: 'India, Pakistán y China no se ponen de acuerdo sobre Cachemira. El mapa no elige un ganador.',
      en: 'India, Pakistan and China disagree about Kashmir. The map does not pick a winner.',
    },
  },
  PK: {
    es: 'Cachemira es reclamada, en partes distintas, por India, Pakistán y China. El dibujo de este mapa no resuelve esa disputa.',
    en: 'Kashmir is claimed, in different parts, by India, Pakistan and China. This map’s drawing does not settle that dispute.',
    kid: {
      es: 'India, Pakistán y China no se ponen de acuerdo sobre Cachemira.',
      en: 'India, Pakistan and China disagree about Kashmir.',
    },
  },
  CN: {
    es: 'China reclama zonas que también reclaman India y otros vecinos, entre ellas parte de Cachemira. Taiwán está dibujado aparte: Pekín lo reclama y el gobierno de Taipéi gobierna la isla. El mapa no decide esas disputas.',
    en: 'China claims areas that India and other neighbors also claim, including part of Kashmir. Taiwan is drawn separately: Beijing claims it, and the government in Taipei governs the island. The map does not decide those disputes.',
    kid: {
      es: 'China y algunos vecinos no se ponen de acuerdo sobre partes de la frontera, ni sobre Taiwán. El mapa no toma partido.',
      en: 'China and some neighbors disagree about parts of the border, and about Taiwan. The map does not take a side.',
    },
  },
  'northern-cyprus': {
    es: 'La República de Chipre es el estado que reconoce la mayor parte del mundo. En el norte hay una administración que se llama a sí misma República Turca del Norte de Chipre. Solo Turquía la reconoce. El mapa separa las dos zonas.',
    en: 'The Republic of Cyprus is the state most of the world recognizes. In the north, an administration calls itself the Turkish Republic of Northern Cyprus. Only Turkey recognizes it. The map separates the two zones.',
    kid: {
      es: 'La isla de Chipre está dividida. Casi todos los países reconocen solo una de las dos partes.',
      en: 'The island of Cyprus is divided. Almost every country recognizes only one of the two parts.',
    },
  },
  somaliland: {
    es: 'Somalilandia se administra sola desde 1991 y reclama ser un estado. Somalia sostiene que sigue siendo parte de su territorio. Casi ningún país la reconoce como estado independiente. Natural Earth la dibuja aparte, y dibujarla no es reconocerla.',
    en: 'Somaliland has administered itself since 1991 and claims to be a state. Somalia says it is still part of its territory. Almost no country recognizes it as independent. Natural Earth draws it separately, and drawing it is not the same as recognizing it.',
    kid: {
      es: 'Esta región se gobierna sola, pero casi nadie la cuenta como un país aparte. Somalia dice que es parte de ella.',
      en: 'This region governs itself, but almost nobody counts it as a separate country. Somalia says it is part of Somalia.',
    },
  },
};

export function disputeNote(key, lang, kids) {
  const note = NOTES[key];
  if (!note) return '';
  if (kids && note.kid) return note.kid[lang] || note.kid.es;
  return note[lang] || note.es;
}
