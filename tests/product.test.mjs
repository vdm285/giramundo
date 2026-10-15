import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { searchCountries, prepareSearch } from '../src/data/search.js';
import { buildHash, parseHash } from '../src/data/hash.js';
import { disputeNote } from '../src/data/disputed.js';
import { gentleItems } from '../src/data/content.js';
import { sizeVersus, displayCapital, mainZone } from '../src/data/format.js';

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

test('links round-trip the country, the tab, kid mode and language', () => {
  const hash = buildHash({ iso: 'MX', tab: 'comida', kids: true, lang: 'en' });
  assert.deepEqual(parseHash(hash), { iso: 'MX', placeId: null, tab: 'comida', kids: true, lang: 'en' });
});

test('disputed places have a kid version and an adult version', () => {
  for (const key of ['FK', 'EH', 'TW', 'IL', 'PS', 'RU', 'UA', 'northern-cyprus']) {
    assert.ok(disputeNote(key, 'es', false).length > 40, key);
    assert.ok(disputeNote(key, 'en', true).length > 20, key);
  }
});

test('kid mode drops violent on-this-day lines and keeps a quiet one', () => {
  const items = [
    { text: 'A treaty was signed.' },
    { text: 'Una guerra comenzó y hubo muchos muertos.' },
  ];
  const kept = gentleItems(items, true);
  assert.equal(kept.length, 1);
  assert.match(kept[0].text, /treaty/);
  assert.equal(gentleItems(items, false).length, 2);
});

test('size and capital wording stay honest', () => {
  const line = sizeVersus(100, 'A', 250, 'México', 'es');
  assert.match(line, /cabe unas 2\.5 veces/);
  const mx = countries.find((c) => c.iso2 === 'MX');
  const jp = countries.find((c) => c.iso2 === 'JP');
  assert.equal(displayCapital(mx, 'es'), 'Ciudad de México');
  assert.equal(displayCapital(jp, 'es'), 'Tokio');
  assert.equal(displayCapital({ iso2: 'PS', capital: { es: 'East Jerusalem', en: 'Ramallah' } }, 'es'), '');
  assert.equal(mainZone(countries.find((c) => c.iso2 === 'US')), 'America/New_York');
  assert.equal(mainZone(mx), 'America/Mexico_City');
});
