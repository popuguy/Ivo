import test from 'node:test';
import assert from 'node:assert/strict';
import { changeCaseParts } from '../../src/domain/text/change-case.js';
test('casing preserves run ownership, locale expansions and contextual final sigma', () => {
  assert.deepEqual(changeCaseParts(['stra', 'ß', 'e'], 'case-uppercase', 'de'), [
    'STRA',
    'SS',
    'E',
  ]);
  assert.deepEqual(changeCaseParts(['Ο', 'Σ'], 'case-lowercase', 'el'), ['ο', 'ς']);
  assert.deepEqual(changeCaseParts(['i', 'stanbul ışı', 'k'], 'case-title', 'tr'), [
    'İ',
    'stanbul Işı',
    'k',
  ]);
  assert.deepEqual(changeCaseParts(['papier. «', 'ÉTÉ', '»! FIN'], 'case-sentence', 'fr'), [
    'Papier. «',
    'Été',
    '»! Fin',
  ]);
  assert.deepEqual(changeCaseParts(['ОДИН ', 'ДВА'], 'case-lowercase', 'ru'), ['один ', 'два']);
});
