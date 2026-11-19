import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { summarizeTextStyle } from '../../../src/rendering/text/selection-style.js';
import { applyNamedTextStyles } from '../../../src/rendering/text/styles.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { projectFlowInput, flowInputHTML } from '../../../src/rendering/text/flow-input.js';
import { textIndexMap, captureTextSelection } from '../../../src/shared/dom/text-selection.js';
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const tick = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export async function verifyTextControls(host) {
  const doc = createSceneDocument('Type controls'),
    item = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 40,
      w: 300,
      h: 240,
      textStyle: 'sans',
      fontSize: 16,
      html: '<p><span data-ivo-font="cmu-serif" data-ivo-size="12">Actual source font.</span></p>',
    });
  let commits = 0;
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    source: (s) => s,
    onChange: () => {},
    onCommit: () => commits++,
    onNotify: (message) => {
      throw new Error(message);
    },
    sessionId: 'type-controls',
  });
  const pick = () =>
    editor.restoreView({ selection: [item.id], activePage: item.pageId, tool: 'select' });
  pick();
  await tick();
  const field = (name) => host.querySelector(`[data-object-prop="${name}"]`);
  assert(
    field('textStyle').value === 'cmu-serif' && field('fontSize').value === '12',
    'Frame selection showed defaults instead of actual source typography',
  );
  const characterMore = () => host.querySelector('[data-property-disclosure="character"]');
  const percent = () => field('horizontalScale');
  assert(
    !characterMore().parentElement.open && !percent().getClientRects().length,
    'Character scale leaked into the compact Character controls',
  );
  characterMore().click();
  assert(percent().getBoundingClientRect().width > 0, 'More Character options did not open');
  const changeScale = (delta) =>
    percent().closest('.property-number').querySelector(`[data-property-step="${delta}"]`).click();
  changeScale(1);
  assert(
    percent().value === '101' && characterMore().parentElement.open,
    'Scale step or expanded state lost on commit',
  );
  changeScale(-1);
  assert(percent().value === '100', 'Scale step down did not restore the original value');
  characterMore().click();
  const leading = field('leading').closest('.property-number');
  assert(
    leading.classList.contains('uses-auto-leading') &&
      leading.querySelector('.auto-leading-value').textContent === '(14.4 pt)',
    'Auto leading did not show the selected type size times the auto leading percentage',
  );
  const align = (value) => host.querySelector(`[data-paragraph-align="${value}"]`);
  align('center').click();
  assert(
    align('center').getAttribute('aria-pressed') === 'true' && field('align').value === 'center',
    'Paragraph buttons were not synchronized with authored paragraph alignment',
  );
  align('left').click();
  const commitsBeforePreview = commits;
  const before = JSON.stringify(doc);
  host.querySelector('.canvas-type-options').click();
  const popup = host.querySelector('.type-options-popover'),
    row = popup.querySelector('[data-feature-row="smallCaps"]');
  assert(
    !row.hidden && popup.querySelector('[data-feature-row="fractions"]').hidden,
    'Font feature applicability ignored shipped font tables',
  );
  const rect = popup.getBoundingClientRect(),
    bounds = host.getBoundingClientRect();
  assert(
    Math.abs(rect.width - 242) < 1 &&
      rect.left >= bounds.left &&
      rect.right <= bounds.right &&
      rect.bottom <= bounds.bottom,
    'Popup detached from its anchor or escaped the editor',
  );
  assert(
    JSON.stringify(doc) === before && commits === commitsBeforePreview,
    'Feature preview changed authored source',
  );
  const oldPaint = getComputedStyle(row).backgroundColor;
  row.click();
  assert(
    row.dataset.checked === 'true' &&
      row.querySelector('input').checked &&
      getComputedStyle(row).backgroundColor !== oldPaint,
    'Feature selection failed to refresh checked paint',
  );
  assert(
    item.html.includes('data-ivo-smcp="true"'),
    'Whole-frame feature failed to reach source text',
  );
  row.click();
  assert(
    row.dataset.checked === 'false' && !row.querySelector('input').checked,
    'Feature could not be toggled off',
  );
  popup.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  assert(!host.querySelector('.type-options-popover'), 'Escape did not dismiss feature popup');
  field('textStyle').value = 'serif';
  field('textStyle').dispatchEvent(new Event('change', { bubbles: true }));
  assert(
    getComputedStyle(host.querySelector('[data-ivo-font="serif"]')).fontFamily.includes('Georgia'),
    'Whole-frame font changed only its default while leaving inline runs unchanged',
  );
  item.html =
    '<p><span data-ivo-font="cmu-serif" data-ivo-smcp="true">One</span><span data-ivo-font="serif">Two</span></p>';
  editor.refreshExternal();
  pick();
  assert(
    field('textStyle').value === '' &&
      field('textStyle').selectedOptions[0].textContent === 'Mixed',
    'Mixed frame font was reported as a misleading single default',
  );
  await editor.command('document-text');
  const live = host.querySelector('[data-scene-text]');
  live.focus();
  const first = live.querySelector('span').firstChild;
  getSelection().setBaseAndExtent(first, 0, first, first.length);
  document.dispatchEvent(new Event('selectionchange'));
  assert(field('textStyle').value === 'cmu-serif', 'Selected range did not update Properties font');
  host.querySelector('.canvas-contextual-bar [data-canvas-command="type-options"]').click();
  assert(
    host.querySelector('[data-type-feature="smallCaps"]').checked,
    'Popup ignored the selected range feature state',
  );
  const rangeFeature = host.querySelector('[data-type-feature="smallCaps"]');
  rangeFeature.focus();
  rangeFeature.click();
  assert(
    !rangeFeature.checked &&
      host.querySelector('[data-feature-row="smallCaps"]').dataset.checked === 'false',
    'Selected-word feature paint became stale after the control took focus',
  );
  rangeFeature.focus();
  rangeFeature.click();
  assert(
    rangeFeature.checked && getSelection().toString() === 'One',
    'Feature toggle lost the word selection or applied at a collapsed insertion point',
  );

  editor.destroy();
  host.innerHTML = '';

  const root = document.createElement('div');
  root.innerHTML = cleanHTML(
    '<p data-ivo-smcp="true">Alpha <span data-ivo-liga="false">Beta</span></p><p><br></p><p>Gamma 🌿 delta</p>',
  );
  document.body.append(root);
  applyNamedTextStyles(root, doc);
  const featurePaint = getComputedStyle(root.querySelector('span')).fontFeatureSettings;
  assert(
    featurePaint.includes('"smcp"') &&
      !featurePaint.includes('"smcp" 0') &&
      featurePaint.includes('"liga" 0'),
    'Child feature override erased another inherited OpenType feature',
  );
  const canonical = flowInputHTML(root),
    text = root.lastChild.firstChild,
    map = textIndexMap(root),
    start = map.segments.find((part) => part.node === text).start + 6;
  root.contentEditable = 'true';
  root.focus();
  getSelection().setBaseAndExtent(text, 8, text, 10);
  const bookmark = captureTextSelection(root);
  projectFlowInput(root, start);
  assert(
    flowInputHTML(root) === canonical,
    'Page projection altered canonical text or persisted generated prefixes',
  );
  assert(
    captureTextSelection(root).focus.index === bookmark.focus.index,
    'Page projection moved the logical selection',
  );
  assert(
    summarizeTextStyle(root, doc, {}).mixed.includes('smallCaps'),
    'Source summary skipped hidden text or collapsed mixed feature state',
  );
  projectFlowInput(root, 0);
  assert(
    flowInputHTML(root) === canonical && !root.querySelector('[data-flow-input-prefix]'),
    'Returning to the first frame lost source or retained projection wrappers',
  );
  root.remove();
}
