import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { setTextWrap } from '../../../src/domain/documents/text-wrap.js';
import {
  archiveVersion,
  markTypographyVersion,
} from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { openVault } from '../../../desktop/vault.mjs';
import { wrapSpec } from './layout.js';
import { weavePNG } from './materials.mjs';

export async function makeFixture(dir) {
  const spec = wrapSpec(),
    doc = createSceneDocument('Contour study', spec),
    frames = [],
    masks = [],
    assets = [];
  await mkdir(path.join(dir, 'Links'));
  for (let i = 0; i < 6; i++) {
    const bytes = weavePNG(i),
      name = 'Weave-' + (i + 1) + '.png';
    await writeFile(path.join(dir, 'Links', name), bytes);
    assets.push({
      id: 'weave-' + i,
      name,
      mimeType: 'image/png',
      data: 'data:image/png;base64,' + bytes.toString('base64'),
    });
  }
  for (const [index, page] of spec.pages.entries()) {
    const pageId = index ? addPage(doc, doc.pages.at(-1).id).id : doc.pages[0].id;
    doc.pages[index].height = page.height;
    for (const box of page.frames)
      frames.push(
        insertObject(doc, 'text', pageId, {
          ...box,
          html: frames.length ? '' : spec.paragraphs.map((s) => '<p>' + s + '</p>').join(''),
          textStyle: 'cmu-serif',
          fontSize: spec.size,
          leading: spec.leading,
          frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 12, verticalAlign: 'top' },
        }),
      );
    for (const { x, y, w, h, points, art } of page.masks) {
      const mask = insertObject(doc, 'polygon', pageId, {
        x,
        y,
        w,
        h,
        points: points.map(([px, py]) => ({ x: (px - x) / w, y: (py - y) / h })),
        fill: 'none',
        stroke: 'none',
        strokeWidth: 0,
      });
      masks.push(mask);
      insertObject(doc, 'image', pageId, {
        parentId: mask.id,
        x: 0,
        y: 0,
        w,
        h,
        src: 'asset:' + assets[art].id,
        fit: 'cover',
        alt: assets[art].name,
      });
    }
  }
  const flow = startTextFlow(doc, frames[0].id, { automaticPages: false });
  for (let i = 1; i < frames.length; i++) threadFrame(doc, frames[i - 1].id, frames[i].id);
  enableNativeComposition(doc, flow, 'paragraph');
  setTextWrap(
    doc,
    masks.map((m) => m.id),
    { mode: 'contour', side: 'both', contour: { source: 'frame' } },
  );
  markTypographyVersion(doc);
  const archive = validateImport({
    schemaVersion: archiveVersion([doc]),
    documents: [doc],
    assets,
  });
  const vault = await openVault(path.join(dir, 'Ivo vault'));
  await vault.saveImport(archive);
  await writeFile(path.join(dir, 'layout.json'), JSON.stringify(spec));
}
