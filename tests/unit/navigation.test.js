import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quickSwitcherResults,
  rememberDocument,
  readRecentDocuments,
} from '../../src/domain/knowledge/navigation.js';
const docs = [
  { id: 'a', title: 'Daily notes', aliases: ['Journal'], updatedAt: '2026-11-01' },
  { id: 'b', title: 'Design notes', aliases: ['Résumé'], updatedAt: '2026-11-02' },
  { id: 'c', title: 'dn', aliases: [], updatedAt: '2026-11-03' },
];
test('Quick switcher searches names and aliases with ordered fuzzy letters and diacritics', () => {
  assert.deepEqual(
    quickSwitcherResults(docs, 'dn').map((r) => r.document.id),
    ['c', 'a', 'b'],
  );
  assert.equal(quickSwitcherResults(docs, 'resume')[0].alias, 'Résumé');
  assert.equal(quickSwitcherResults(docs, 'jrnl')[0].document.id, 'a');
  assert.equal(quickSwitcherResults(docs, 'dnz').length, 0);
});
test('Blank switcher begins with active document, then most recently opened', () => {
  assert.deepEqual(
    quickSwitcherResults(docs, '', { activeId: 'b', recentIds: ['a', 'b', 'c'] }).map(
      (r) => r.document.id,
    ),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(rememberDocument(['a', 'b', 'a'], 'b'), ['b', 'a']);
  assert.deepEqual(
    readRecentDocuments({ getItem: () => JSON.stringify(['a', 'a', 12, '../bad', 'b']) }),
    ['a', 'b'],
  );
  assert.deepEqual(readRecentDocuments({ getItem: () => '{bad' }), []);
});
