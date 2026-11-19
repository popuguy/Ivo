import test from 'node:test';
import assert from 'node:assert/strict';
import { fontChoices, regularFace, systemFontId } from '../../src/domain/text/font-catalog.js';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { enablePublishing } from '../../src/domain/documents/publishing.js';
import { createSystemFonts } from '../../desktop/system-fonts.mjs';
import { createInstalledFontLibrary } from '../../src/features/editor/assets/installed-fonts.js';
import { createUserTemplate, instantiateTemplate } from '../../src/domain/documents/copy.js';
import { startTextFlow } from '../../src/domain/documents/text-flows.js';
import { effectiveTextStyle } from '../../src/domain/documents/publishing.js';

test('new document typography survives save, template duplication, threading and adding frames', () => {
  const doc = createSceneDocument('Layout', undefined, 'geist');
  const archived = validateImport({ schemaVersion: 6, assets: [], documents: [doc] }).documents[0];
  const copy = instantiateTemplate(createUserTemplate(archived, 'Template'), 'Copy');
  for (const document of [archived, copy]) {
    const frame = insertObject(document, 'text', document.pages[0].id);
    const flow = startTextFlow(document, frame.id);
    const base = effectiveTextStyle(document, flow.style);
    assert.deepEqual(
      [
        base.textStyle,
        base.fontSize,
        base.leading,
        base.autoLeading,
        base.paragraphBefore,
        base.paragraphAfter,
      ],
      ['geist', 12, 0, 120, 0, 0],
    );
    const special = insertObject(document, 'text', document.pages[0].id, { fontSize: 23 });
    assert.equal(effectiveTextStyle(document, special).fontSize, 23);
    assert.equal(
      validateImport({ schemaVersion: 6, assets: [], documents: [document] }).documents.length,
      1,
    );
  }
});

test('new-document font reuses the exact vault face offline and falls back when absent', async () => {
  const offline = (assets) => createInstalledFontLibrary({ assets: () => assets });
  const regular = { id: 'font-' + '1'.repeat(64), font: { postscript: 'MinionPro-Regular' } };
  const italic = { id: 'font-' + '2'.repeat(64), font: { postscript: 'MinionPro-It' } };
  assert.equal(await offline([italic, regular]).defaultDocumentFont(), regular.id);
  assert.equal(await offline([italic]).defaultDocumentFont(), 'cmu-serif');
  const failing = createInstalledFontLibrary({
    assets: () => [],
    native: {
      list: async () => [
        { family: 'Minion Pro', style: 'Regular', postscript: 'MinionPro-Regular' },
      ],
      read: async () => {
        throw Error('Font unavailable');
      },
    },
  });
  await assert.rejects(failing.defaultDocumentFont(), /Font unavailable/);
});
const faces = [
  {
    postscript: 'Example-Regular',
    family: 'Example',
    style: 'Regular',
    weight: 400,
    italic: false,
  },
  { postscript: 'Example-Bold', family: 'Example', style: 'Bold', weight: 700, italic: false },
  { postscript: 'Example-Italic', family: 'Example', style: 'Italic', weight: 400, italic: true },
];
test('system face identities are transient and every installed face is represented without duplicating shipped fonts', () => {
  const choices = fontChoices(
    [],
    [...faces, { postscript: 'CMUSerif-Roman', family: 'CMU Serif', style: 'Roman' }],
  );
  assert.equal(choices[0][0], 'cmu-serif');
  assert.equal(choices.filter(([id]) => id.startsWith('system:')).length, 3);
  assert(choices.some(([id]) => id === systemFontId('Example-Italic')));
  assert.equal(regularFace(faces, 'Example', true, false).postscript, 'Example-Bold');
  assert.equal(regularFace(faces, 'Example', false, true).postscript, 'Example-Italic');
  const doc = createSceneDocument('Defaults'),
    item = insertObject(doc, 'text', doc.pages[0].id);
  assert.equal(item.textStyle, 'cmu-serif');
  item.textStyle = systemFontId('Example-Regular');
  assert.throws(() => validateImport({ schemaVersion: 6, documents: [doc], assets: [] }));
  item.textStyle = 'geist';
  assert.throws(() => validateImport({ schemaVersion: 5, documents: [doc], assets: [] }));
  enablePublishing(doc);
  assert.equal(
    validateImport({ schemaVersion: 6, documents: [doc], assets: [] }).documents[0].blocks[0]
      .textStyle,
    'geist',
  );
});
test('native font bridge accepts only catalog identities and propagates failures without exposing paths', async () => {
  const calls = [];
  const fonts = createSystemFonts('/test/helper', {
    run: async (_exe, args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify(
          args[0] === 'list'
            ? faces.map((f) => ({ ...f, fullName: f.postscript }))
            : { name: 'font.ttf', data: 'AA==', variations: {} },
        ),
      };
    },
  });
  await assert.rejects(fonts.read('/private/no-font'), /installed/);
  assert(calls.every((args) => args[0] === 'list'));
  await fonts.read('Example-Regular');
  assert.deepEqual(calls.at(-1), ['read', 'Example-Regular']);
  const broken = createSystemFonts('/test/helper', {
    run: async () => {
      throw Object.assign(new Error('failed'), { stderr: 'Selected font is unavailable.' });
    },
  });
  await assert.rejects(broken.list(), /Selected font is unavailable/);
});

test('portable font aliases retain the explicitly selected Medium/Semibold face', async (t) => {
  const previous = { document: globalThis.document, FontFace: globalThis.FontFace },
    registered = new Set();
  t.after(() => {
    globalThis.document = previous.document;
    globalThis.FontFace = previous.FontFace;
  });
  globalThis.document = {
    fonts: { add: (f) => registered.add(f), delete: (f) => registered.delete(f) },
  };
  globalThis.FontFace = class {
    constructor(family, bytes, descriptors) {
      this.family = family;
      this.source = new TextDecoder().decode(bytes);
      this.descriptors = descriptors;
    }
    load() {
      return Promise.resolve(this);
    }
  };
  const asset = (id, weight) => ({
    id,
    mimeType: 'font/ttf',
    data: 'data:font/ttf;base64,' + btoa(id),
    font: { family: 'Face family', weight, italic: false, axes: [] },
  });
  const { prepareVaultFonts } = await import('../../src/rendering/text/fonts.js');
  await prepareVaultFonts([
    asset('regular', 400),
    asset('medium', 500),
    asset('semibold', 600),
    asset('bold', 700),
  ]);
  const matching = (id, weight) =>
    [...registered].find((f) => f.family === 'ivo-' + id && f.descriptors.weight === weight);
  assert.equal(matching('medium', '400').source, 'medium');
  assert.equal(matching('semibold', '700').source, 'semibold');
  assert.equal(matching('regular', '700').source, 'bold');
  assert(registered.size <= 16);
  await prepareVaultFonts([]);
});

test('legacy font resources do not require restyling old source', async () => {
  const { legacyFontFamilies } = await import('../../src/domain/text/font-references.js');
  const { archiveVersion } = await import('../../src/domain/documents/capabilities.js');
  const doc = createSceneDocument('Legacy'),
    item = insertObject(doc, 'text', doc.pages[0].id, {
      textStyle: 'serif',
      html: '<p><span data-ivo-font="sans">Text</span></p>',
    });
  const before = JSON.stringify(item);
  assert.deepEqual([...legacyFontFamilies(doc)].sort(), ['Georgia', 'Helvetica Neue']);
  assert.equal(archiveVersion([doc], [{ mimeType: 'font/ttf' }]), 6);
  assert.equal(JSON.stringify(item), before);
});

test('shipped font overrides never become missing vault asset references', async () => {
  const { referencedFonts } = await import('../../src/domain/text/font-references.js');
  const doc = createSceneDocument('Shipped override'),
    item = insertObject(doc, 'text', doc.pages[0].id);
  enablePublishing(doc);
  item.textOverrides = { textStyle: 'cmu-serif' };
  assert.deepEqual([...referencedFonts(doc)], []);
  validateImport({ schemaVersion: 6, documents: [doc], assets: [] });
});

test('system variable defaults stay automatic while nondefault instance coordinates remain portable', async (t) => {
  const { readFile } = await import('node:fs/promises');
  const { createInstalledFontLibrary } =
    await import('../../src/features/editor/assets/installed-fonts.js');
  const previous = globalThis.FontFace;
  t.after(() => {
    globalThis.FontFace = previous;
  });
  globalThis.FontFace = class {
    load() {
      return Promise.resolve(this);
    }
  };
  const bytes = await readFile(
      new URL('../../public/fonts/geist/Geist-Variable.ttf', import.meta.url),
    ),
    stored = [];
  let coordinate = 400;
  const library = createInstalledFontLibrary({
    native: {
      list: async () => [
        { postscript: 'Variable-Probe', family: 'Variable Probe', style: 'Regular' },
      ],
      read: async () => ({
        name: 'variable.ttf',
        data: bytes.toString('base64'),
        variations: { wght: coordinate },
      }),
    },
    assets: () => stored,
    persist: async (a) => stored.push(a),
  });
  const standard = await library.resolve(systemFontId('Variable-Probe'));
  assert.equal(standard.fontVariations, 'normal');
  coordinate = 550;
  const medium = await library.resolve(systemFontId('Variable-Probe'));
  assert.equal(medium.fontVariations, 'wght:550');
  assert.equal(medium.textStyle, standard.textStyle);
  assert.equal(stored.length, 1);
});
