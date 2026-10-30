import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The harness records annotators by role label, never by personal name, and this app
// receives harness data through the export. Mirrors the harness's
// tests/test_annotator_names.py: the names are held only as salted SHA-256 digests of
// their normalised word forms. A digest keeps a name out of plain-text search; it is not
// anonymisation, because a guess can be checked against it.
//
// Annotator A also maintains both repositories. The licence and the README's
// attribution and licence lines name the maintainer rather than an annotation, so they
// may carry that name, exactly as often as they do now. The maintainer's account handle
// in URLs is one joined word and is deliberately not matched.

const root = fileURLToPath(new URL('..', import.meta.url));
const SALT = 'contract-eval/annotator-name-guard/v1:';

const NAME_DIGESTS = new Map([
  ['98e132075881e22e2d41f1bcc5d8d4ceb66700b289f3c092745a9ecf70703f1d', ['Annotator A', 'given name']],
  ['03307d4c43d9649375a992200129ca62f69d017e9b7bb0ea5f685da26f45fdae', ['Annotator A', 'family name']],
  ['be587e747108eb019b2f179d51cb2cd6f91dc630f33d8329891118daf078d086', ['Annotator A', 'family name']],
  ['8313fe3b6885810a7247e03815227ebb477652bb292d3a2a430fc3ff6c324a06', ['Annotator A', 'initial and family name']],
  ['bb02e0dae0d6396bcad249d4c60b71a3072e9b3197e8d04edff75b71fcf0dc0a', ['Annotator A', 'initial and family name']],
  ['0f4cac8f432252bdde197bc29abe05f4c85702d8094f91c5fccaecea1b449818', ['Annotator A', 'joined name']],
  ['904e23994892082e82446741d3da49387ce0b0965964ff8fd9b51e793faef74c', ['Annotator A', 'joined name']],
  ['48b83e0f11789ba6ba825faf2a28ae3f8d56fb4759ef46e057b314562866a4fb', ['Annotator A', 'joined name']],
  ['ddd87758a93d50b4128ce3580353d6721c110d6f0a52abf483897ef0cdad1e8a', ['Annotator B', 'given name']],
  ['fab47f4a7fe3cd6981bf88d7a1be0c323962f54580e939d9ad5457e2f3256d79', ['Annotator B', 'family name']],
  ['27d9910ea7c48fb49b8a150a8b40763bdb811491ec837e17886139a3f8f3cdaf', ['Annotator B', 'initial and family name']],
  ['023ba5b5cf3f239c9d4f3d23f745b9393ef94f4d40d9b17829e85a74942d6f0e', ['Annotator B', 'joined name']],
  ['82c3fa9bac65bd1b890d9a415d13f26c7edc14fce498e205ffcf8f24ca11ce4c', ['Annotator B', 'joined name']],
]);

// Maintainer notices, not annotations: the number of name words each holds today.
const ALLOWED = new Map([
  ['LICENSE\0Annotator A', 2],
  ['README.md\0Annotator A', 4],
]);

const ENTITIES = { amp: '&', auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', szlig: 'ß' };
const digests = new Map();
const digest = word => {
  if (!digests.has(word)) digests.set(word, crypto.createHash('sha256').update(SALT + word, 'utf8').digest('hex'));
  return digests.get(word);
};

const decodeUrl = text => text.replace(/(?:%[0-9a-fA-F]{2})+/g, run => {
  try { return decodeURIComponent(run); } catch { return run; }
});
const decodeHtml = text => text
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&([A-Za-z]+);/g, (entity, name) => ENTITIES[name] ?? entity);

// The text with JSON, URL and HTML escapes decoded, folded with umlauts as oe and as o.
function spellings(text) {
  const decoded = decodeHtml(decodeUrl(text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))));
  const folded = decoded.normalize('NFKC').toLowerCase().replace(/ß/g, 'ss');
  const transliterated = folded.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  const stripped = folded.normalize('NFKD').replace(/\p{M}/gu, '');
  return [transliterated, stripped];
}

// Every word of either annotator's name in the text, as [annotator, part of the name].
function nameHits(text) {
  let best = [];
  for (const spelling of spellings(text)) {
    const hits = (spelling.match(/[a-z0-9]+/g) ?? []).map(digest).filter(d => NAME_DIGESTS.has(d)).map(d => NAME_DIGESTS.get(d));
    if (hits.length > best.length) best = hits;
  }
  return best;
}

const trackedFiles = () => execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

test('no tracked file carries an annotator name', () => {
  const problems = [];
  for (const name of trackedFiles()) {
    const path = `${root}/${name}`;
    if (!fs.existsSync(path) || !fs.statSync(path).isFile()) continue; // deleted in the working tree
    const raw = fs.readFileSync(path);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      text = raw.toString('latin1'); // a binary's metadata chunks are still plain text
    }
    const located = nameHits(name).map(hit => ['path', hit]);
    text.split(/\r\n|\r|\n/).forEach((line, index) => {
      for (const hit of nameHits(line)) located.push([`line ${index + 1}`, hit]);
    });
    for (const annotator of ['Annotator A', 'Annotator B']) {
      const where = located.filter(([, [who]]) => who === annotator).map(([place, [, part]]) => `${place} (${part})`);
      const allowed = ALLOWED.get(`${name}\0${annotator}`) ?? 0;
      if (where.length !== allowed) problems.push(`${name}: ${annotator}'s name ${where.length}x, expected ${allowed}: ${where.join(', ')}`);
    }
  }
  assert.deepEqual(problems, [], 'Use the harness role labels (Annotator A, Annotator B)');
});

test('every allowance names a tracked file', () => {
  const tracked = new Set(trackedFiles());
  for (const key of ALLOWED.keys()) assert.ok(tracked.has(key.split('\0')[0]), key);
});

test('the matcher sees through case, accents and escapes', () => {
  // A matcher that silently found nothing would pass forever. Probe it with an ordinary
  // word in place of a name.
  NAME_DIGESTS.set(digest('gruesse'), ['probe', 'word']);
  NAME_DIGESTS.set(digest('grusse'), ['probe', 'word']);
  try {
    for (const text of ['Grüße', 'GRÜSSE', 'Grüße', 'Gr&uuml;&szlig;e', 'Gr%C3%BC%C3%9Fe',
      'Gr\\u00fc\\u00dfe', 'gruesse', 'path/grüße-file.json']) {
      assert.deepEqual(nameHits(text), [['probe', 'word']], text);
    }
    for (const text of ['Grußwort', 'Grüßen', 'begrüße']) assert.deepEqual(nameHits(text), [], text);
  } finally {
    NAME_DIGESTS.delete(digest('gruesse'));
    NAME_DIGESTS.delete(digest('grusse'));
  }
});
