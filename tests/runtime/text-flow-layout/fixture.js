import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import {
  layoutDocumentTextFlows,
  prepareTextFlowFonts,
} from '../../../src/rendering/text/flow-layout.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  await prepareTextFlowFonts();
  const doc = createSceneDocument('Flow fixture', { width: 360, height: 300 }),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 30,
      y: 30,
      w: 300,
      h: 220,
      textStyle: 'cmu-serif',
      fontSize: 16,
    });
  frame.html = Array.from(
    { length: 90 },
    (_, i) =>
      `<p>Paragraph ${i}: <strong>Rich</strong> <em>café Ω</em> text wraps across linked pages with its original source intact.</p>${i % 9 === 0 ? '<p><br></p>' : ''}`,
  ).join('');
  const original = frame.html,
    textFlow = startTextFlow(doc, frame.id),
    second = insertObject(doc, 'text', addPage(doc, doc.pages[0].id).id, {
      x: 25,
      y: 25,
      w: 240,
      h: 180,
    });
  threadFrame(doc, frame.id, second.id);
  const began = performance.now(),
    plan = layoutDocumentTextFlows(doc),
    host = document.createElement('div');
  host.innerHTML = original;
  const expected = host.textContent;
  const joined = textFlow.frameIds
    .map((id) => {
      host.innerHTML = plan.fragments.get(id).html;
      return host.textContent;
    })
    .join('');
  assert(
    joined === expected,
    `Pagination changed source text: ${joined.length} vs ${expected.length}`,
  );
  assert(textFlow.html === original, 'Pagination modified canonical rich source');
  assert(
    doc.pages.length > 5 && !plan.status.get(textFlow.id).overset,
    'Automatic continuation did not fit textFlow',
  );
  assert(plan.fragments.get(frame.id).html.includes('<strong>'), 'Rich type disappeared');
  validateImport({ schemaVersion: 5, documents: [doc], assets: [] });
  const layoutMs = performance.now() - began,
    pages = doc.pages.length;
  const protectedPage = doc.pages.at(-1);
  insertObject(doc, 'polygon', protectedPage.id, { x: 5, y: 5, w: 10, h: 10 });
  textFlow.html = '<p>Short note.</p>';
  const short = layoutDocumentTextFlows(doc);
  assert(
    doc.pages.length < pages && doc.pages.some((p) => p.id === protectedPage.id),
    'Safe empty-page removal deleted authored content or failed',
  );
  assert(!short.status.get(textFlow.id).overset, 'Short note became overset');
  validateImport({ schemaVersion: 5, documents: [doc], assets: [] });
  const listDoc = createSceneDocument('List and one paragraph', { width: 300, height: 250 }),
    listFrame = insertObject(listDoc, 'text', listDoc.pages[0].id, {
      x: 20,
      y: 20,
      w: 260,
      h: 160,
      textStyle: 'cmu-serif',
      fontSize: 18,
      html:
        '<ol>' +
        Array.from(
          { length: 30 },
          (_, i) => `<li>Item ${i + 1}: continued list content with its number.</li>`,
        ).join('') +
        '</ol>',
    });
  const _listTextFlow = startTextFlow(listDoc, listFrame.id),
    lists = layoutDocumentTextFlows(listDoc);
  for (const part of lists.fragments.values()) {
    host.innerHTML = part.html;
    assert(
      [...host.querySelectorAll('li')].every((li) => li.closest('ol')),
      'List continuation lost its list context',
    );
  }
  const oneDoc = createSceneDocument('One paragraph', { width: 300, height: 250 }),
    oneFrame = insertObject(oneDoc, 'text', oneDoc.pages[0].id, {
      x: 20,
      y: 20,
      w: 260,
      h: 130,
      textStyle: 'cmu-serif',
      fontSize: 16,
      html:
        '<p><strong><em>' +
        Array.from({ length: 300 }, (_, i) => 'T' + String(i).padStart(3, '0')).join(' ') +
        '</em></strong></p>',
    }),
    oneTextFlow = startTextFlow(oneDoc, oneFrame.id),
    one = layoutDocumentTextFlows(oneDoc);
  const parts = oneTextFlow.frameIds.map((id) => one.fragments.get(id));
  assert(parts.length > 5, 'Single paragraph did not span frames');
  let joinedOne = '';
  for (const part of parts) {
    host.innerHTML = part.html;
    joinedOne += host.textContent;
    assert(host.querySelector('strong em'), 'Single-run continuation lost formatting context');
  }
  assert(
    joinedOne === Array.from({ length: 300 }, (_, i) => 'T' + String(i).padStart(3, '0')).join(' '),
    'Single paragraph lost or duplicated characters',
  );
  const unicode = createSceneDocument('Graphemes and blank lines', { width: 220, height: 180 }),
    unicodeFrame = insertObject(unicode, 'text', unicode.pages[0].id, {
      x: 20,
      y: 20,
      w: 180,
      h: 80,
      fontSize: 18,
      html: '<p>' + ('é 👩🏽‍🎨 家族 ' + '<br><br>').repeat(30) + '</p>',
    }),
    unicodeTextFlow = startTextFlow(unicode, unicodeFrame.id),
    unicodePlan = layoutDocumentTextFlows(unicode);
  host.innerHTML = unicodeTextFlow.html;
  const unicodeText = host.textContent,
    breaks = host.querySelectorAll('br').length;
  let actual = '',
    actualBreaks = 0;
  for (const value of unicodePlan.fragments.values()) {
    host.innerHTML = value.html;
    actual += host.textContent;
    actualBreaks += host.querySelectorAll('br').length;
    assert(
      !host.textContent.match(/^[\u0300-\u036f\u200d]/u) &&
        !(host.textContent.charCodeAt(0) >= 0xdc00 && host.textContent.charCodeAt(0) <= 0xdfff),
      'Frame cut split a grapheme',
    );
  }
  assert(
    actual === unicodeText && actualBreaks === breaks,
    'Graphemes or blank lines were lost during pagination',
  );
  const tiny = createSceneDocument('Unplaceable text'),
    tinyFrame = insertObject(tiny, 'text', tiny.pages[0].id, {
      w: 80,
      h: 2,
      fontSize: 24,
      html: '<p>This textFlow must remain recoverable.</p>',
    }),
    tinyTextFlow = startTextFlow(tiny, tinyFrame.id),
    tinyPlan = layoutDocumentTextFlows(tiny);
  assert(
    tiny.pages.length === 1 && tinyPlan.status.get(tinyTextFlow.id).overset,
    'Unplaceable lines created futile automatic pages',
  );
  assert(
    tinyTextFlow.html === '<p>This textFlow must remain recoverable.</p>',
    'Overset discarded canonical text',
  );
  console.log(
    'IVO_TEXT_FLOW_RESULT:' +
      JSON.stringify({
        ok: true,
        layoutMs,
        pagesBeforeShrink: pages,
        pagesAfterShrink: doc.pages.length,
        variableFrames: true,
        numberedListContext: true,
        singleParagraphContinuous: true,
        graphemeAndBlankLinePreservation: true,
        unplaceableTextPreserved: true,
        richSourcePreserved: true,
        noMissingOrDuplicateText: true,
        safeAutomaticPages: true,
      }),
  );
} catch (error) {
  console.log('IVO_TEXT_FLOW_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
