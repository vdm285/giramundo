import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { searchCountries, prepareSearch } from '../src/data/search.js';
import { buildHash, parseHash, SECTIONS } from '../src/app/router.js';
import { disputeNote } from '../src/data/disputed.js';
import { displayCapital, mainZone, sentences } from '../src/data/format.js';
import { splitBills } from '../src/dossier/money.js';

const facts = JSON.parse(readFileSync(new URL('../public/data/facts.json', import.meta.url)));
const countries = prepareSearch(facts.countries.map((c) => ({ ...c, onMap: true })));

test('search understands Mexican nicknames and does not invent a country', () => {
  assert.equal(searchCountries(countries, 'México')[0].iso2, 'MX');
  assert.equal(searchCountries(countries, 'EUA')[0].iso2, 'US');
  assert.equal(searchCountries(countries, 'Holanda')[0].iso2, 'NL');
  assert.equal(searchCountries(countries, 'Malvinas')[0].iso2, 'FK');
  assert.equal(searchCountries(countries, 'Japón')[0].iso2, 'JP');
  assert.equal(searchCountries(countries, 'zzzz-no-existe').length, 0);
});

test('share links round-trip the country, the section and the language', () => {
  const hash = buildHash({ iso: 'MX', section: 'comida', lang: 'en' });
  assert.equal(hash, '#mx/comida/en');
  assert.deepEqual(parseHash(hash), { iso: 'MX', placeId: null, section: 'comida', city: null, lang: 'en' });
  assert.equal(buildHash({ iso: 'JP', section: 'inicio', lang: 'es' }), '#jp');
  assert.equal(buildHash({ iso: 'JP', section: 'historia', lang: 'es' }), '#jp/historia');
  assert.deepEqual(parseHash('#somaliland/ahora'), { iso: null, placeId: 'somaliland', section: 'ahora', city: null, lang: null });
  assert.equal(parseHash('#mx/nope').section, null);
  assert.equal(parseHash(''), null);
  for (const s of SECTIONS) assert.equal(parseHash(`#fr/${s}`).section, s);
  assert.equal(buildHash({ iso: 'MX', city: 'mx-guadalajara', lang: 'es' }), '#mx/ciudad/mx-guadalajara');
  assert.equal(parseHash('#mx/ciudad/mx-guadalajara/en').city, 'mx-guadalajara');
});

test('disputed places have an adult note in both languages', () => {
  for (const key of ['FK', 'EH', 'TW', 'IL', 'PS', 'RU', 'UA', 'XK', 'northern-cyprus', 'somaliland']) {
    assert.ok(disputeNote(key, 'es', false).length > 40, key);
    assert.ok(disputeNote(key, 'en', false).length > 40, key);
  }
  assert.equal(disputeNote('MX', 'es', false), '');
});

test('capital wording stays honest and extracts cut at a sentence', () => {
  const mx = countries.find((c) => c.iso2 === 'MX');
  const jp = countries.find((c) => c.iso2 === 'JP');
  assert.equal(displayCapital(mx, 'es'), 'Ciudad de México');
  assert.equal(displayCapital(jp, 'es'), 'Tokio');
  assert.equal(displayCapital({ iso2: 'PS', capital: { es: 'East Jerusalem', en: 'Ramallah' } }, 'es'), '');
  assert.equal(mainZone(countries.find((c) => c.iso2 === 'US')), 'America/New_York');
  assert.equal(mainZone(mx), 'America/Mexico_City');
  const long = 'Primera frase larga que sirve de relleno para la prueba. Segunda frase. Tercera frase que ya no cabe.';
  assert.equal(sentences(long, 75), 'Primera frase larga que sirve de relleno para la prueba. Segunda frase.');
});

test('money overrides: an issuer file is current whatever its year, and every override names its terms', () => {
  const { current, old, uncertain } = splitBills([
    { local: 'money/USD/1-obverse.jpg', year: 1963, terms: 'https://www.uscurrency.gov/media/currency-image-use' },
    { file: 'Partes de los billetes D1.jpg' },
    { file: 'Billete de 5 pesos del Banco Yucateco (anverso).jpg' },
  ]);
  assert.equal(current.length, 1);
  assert.equal(current[0].local, 'money/USD/1-obverse.jpg');
  assert.equal(old.length, 1);
  assert.equal(uncertain, false);
  assert.equal(splitBills([{ file: 'Billete de 5 pesos del Banco Yucateco (anverso).jpg' }]).uncertain, true);
  const overrides = JSON.parse(readFileSync(new URL('../data/overrides/money.json', import.meta.url)));
  for (const [code, o] of Object.entries(overrides)) {
    if (code.startsWith('_')) continue;
    assert.match(o.terms || '', /^https:\/\//, `${code} needs the page that grants the reuse`);
    assert.ok(o.license && o.note, `${code} needs license and note`);
    for (const f of [...(o.banknotes || []), ...(o.coins || [])]) {
      assert.ok(f.denomination, `${code}: denomination`);
      assert.match(String(f.src), /^(https:\/\/|commons:|data\/sources\/money\/)/, `${code} ${f.denomination}: src must be https, commons: or data/sources/money/`);
      assert.doesNotMatch(String(f.src), /numista|colnect|wikipedia\.org/i, `${code} ${f.denomination}: not a reusable source`);
    }
  }
  const money = JSON.parse(readFileSync(new URL('../public/data/money.json', import.meta.url)));
  for (const code of ['USD', 'EUR']) {
    const notes = money.currencies[code].banknotes.filter((b) => b.local);
    assert.ok(notes.length >= 6, `${code} has its issuer's notes`);
    assert.equal(money.currencies[code].banknotes[0].local, notes[0].local, `${code}: issuer files come first`);
    for (const b of notes) assert.ok(b.terms && b.license && b.historical === false, `${code} ${b.denomination}`);
  }
  assert.ok(money.currencies.MXN.coins[0].local, 'MXN coin circle shows a real coin');
});
