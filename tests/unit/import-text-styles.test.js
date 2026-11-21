import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument } from '../../src/domain/documents/scene.js';
import {
  enablePublishing,
  saveTextStyle,
  resolvedTextStyle,
} from '../../src/domain/documents/publishing.js';
import { importTextStyles } from '../../src/domain/documents/import-text-styles.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';

function fixture() {
  const local = createSceneDocument('Issue'),
    donor = createSceneDocument('Library');
  enablePublishing(local);
  enablePublishing(donor);
  const localBase = saveTextStyle(local, 'paragraph', {
    name: 'Body',
    attributes: { fontSize: 14 },
  });
  const a = saveTextStyle(donor, 'paragraph', { name: 'Body', attributes: { fontSize: 11 } });
  const b = saveTextStyle(donor, 'paragraph', {
    name: 'Caption',
    basedOn: a.id,
    nextStyle: a.id,
    attributes: { italic: true },
  });
  saveTextStyle(donor, 'paragraph', { ...a, nextStyle: b.id });
  return { local, donor, localBase, a, b };
}
for (const policy of ['existing', 'incoming', 'rename'])
  test('load style dependencies, Next Style cycles and conflict policy ' + policy, () => {
    const { local, donor, localBase, a, b } = fixture(),
      source = JSON.stringify(donor);
    importTextStyles(local, donor, [b.id], policy);
    const imported = local.publishing.paragraphStyles.find((s) => s.name === 'Caption');
    const base = local.publishing.paragraphStyles.find((s) => s.id === imported.basedOn);
    assert.notEqual(imported.id, b.id);
    assert.notEqual(base.id, a.id);
    assert.equal(imported.nextStyle, base.id);
    assert.equal(
      resolvedTextStyle(local, 'paragraph', imported.id).fontSize,
      policy === 'existing' ? 14 : 11,
    );
    assert.equal(base.name, policy === 'rename' ? 'Body (1)' : 'Body');
    if (policy !== 'existing') assert.equal(base.nextStyle, imported.id);
    assert.equal(localBase.id === base.id, policy !== 'rename');
    assert.equal(JSON.stringify(donor), source);
    assert.deepEqual(
      validateImport({ schemaVersion: archiveVersion([local]), documents: [local] }).documents[0]
        .publishing.paragraphStyles,
      local.publishing.paragraphStyles,
    );
  });
test('failed imports preserve both style families and current references', () => {
  const { local, donor, b } = fixture(),
    initial = structuredClone(local);
  assert.throws(() => importTextStyles(local, donor, [b.id, 'missing'], 'incoming'));
  assert.deepEqual(local, initial);
  donor.publishing.paragraphStyles[0].basedOn = b.id;
  assert.throws(() => importTextStyles(local, donor, [b.id], 'incoming'), /cycle/);
  assert.deepEqual(local, initial);
});
