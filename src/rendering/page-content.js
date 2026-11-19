import { frameTextSettings } from '../domain/documents/text-flows.js';
import { objectAvailable, effectiveTextStyle } from '../domain/documents/publishing.js';
import { applyNamedTextStyles } from './text/styles.js';
import { childrenOf } from '../domain/documents/scene.js';
import { escapeHTML as esc, cleanHTML } from '../shared/html/sanitize.js';
import { applyFrameTypography } from './text/format.js';
import { applyTextLayout } from './text/layout.js';

/** Shared authored-object markup, used by the interactive editor and the frozen PDF renderer. */
export function sceneObjectHTML(
  item,
  {
    document: doc,
    source,
    textHTML = (block) => cleanHTML(block.html),
    editableId = null,
    editing = false,
    flow = null,
  },
) {
  const kids = childrenOf(doc, item.id).filter((child) =>
      objectAvailable(doc, child, { editing: false }),
    ),
    render = (child) =>
      sceneObjectHTML(child, { document: doc, source, textHTML, editableId, editing, flow });
  let content;
  if (item.type === 'polygon')
    content = `<svg class="canvas-polygon" viewBox="0 0 ${item.w} ${item.h}" preserveAspectRatio="none" aria-label="Polygon"><polygon points="${item.points.map((p) => `${p.x * item.w},${p.y * item.h}`).join(' ')}" fill="${item.fill}" stroke="${item.stroke}" stroke-width="${item.strokeWidth}"/></svg>${kids.length ? `<div class="canvas-clip" style="clip-path:polygon(${item.points.map((p) => `${p.x * 100}% ${p.y * 100}%`).join(',')})">${kids.map(render).join('')}</div>` : ''}`;
  else if (item.type === 'image')
    content = item.src
      ? `<figure><div class="canvas-image-frame"><img draggable="false" src="${esc(source(item.src))}" alt="${esc(item.alt || 'Image')}" style="object-fit:${item.fit === 'contain' ? 'contain' : 'cover'};object-position:${item.crop?.x ?? 50}% ${item.crop?.y ?? 50}%"></div>${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ''}</figure>`
      : '<div class="canvas-asset-placeholder">Image</div>';
  else if (item.type === 'pdf')
    content = `<div class="canvas-legacy-attachment"><span>PDF attachment</span><strong>${esc(item.alt || item.caption || 'Original PDF')}</strong>${item.src ? `<a href="${esc(source(item.src))}" download="${esc(item.alt || 'original.pdf')}">Save original PDF</a>` : ''}</div>`;
  else if (item.type === 'rule') content = '<hr>';
  else
    content = `<div class="rich-text canvas-text ${item.textFlowId ? 'flow-fragment ' : ''}${item.textStyle || 'serif'}" ${item.textFlowId ? 'data-flow-frame' : 'data-scene-text'}="${esc(item.id)}" data-text-kind="${item.textKind || 'area'}" ${!item.textFlowId && editableId === item.id ? 'contenteditable="true" role="textbox" aria-label="Edit text object"' : ''} style="font-size:${item.fontSize || 16}px;text-align:${item.align || 'left'};--text-scale-x:${item.textScale?.x ?? 1};--text-scale-y:${item.textScale?.y ?? 1}">${item.textFlowId ? flow?.fragments.get(item.id)?.html || '' : textHTML(item)}</div>`;
  return `<div class="canvas-object object-${item.type}" data-object="${esc(item.id)}" tabindex="${editing ? 0 : -1}" role="group" aria-label="${esc(item.type)} object" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;${item.frameOptions ? `background:${item.frameOptions.fill === 'none' ? 'transparent' : item.frameOptions.fill || 'transparent'};border:${item.frameOptions.strokeWidth || 0}px solid ${item.frameOptions.stroke === 'none' ? 'transparent' : item.frameOptions.stroke || 'transparent'};border-radius:${item.frameOptions.corner || 0}px;box-sizing:border-box;` : ''}opacity:${(item.opacity ?? 100) / 100};transform:rotate(${item.rotation || 0}deg);${objectAvailable(doc, item) ? '' : 'pointer-events:none;'}">${content}</div>`;
}
// Native frames contain potentially thousands of instantiated SVG glyphs.
// Clearing and restoring inherited type styles on every input invalidates them all.
const framePresentation = new WeakMap();
export function applySceneTypography(root, doc) {
  const composedFlows = new Set(
    (doc.textFlows || []).filter((flow) => flow.composition).map((flow) => flow.id),
  );
  for (const item of doc.blocks) {
    if (item.type !== 'text' && item.type !== 'quote') continue;
    const element = root.querySelector(
      `[data-scene-text="${CSS.escape(item.id)}"],[data-flow-frame="${CSS.escape(item.id)}"]`,
    );
    if (element) {
      const settings = effectiveTextStyle(doc, frameTextSettings(doc, item));
      if (composedFlows.has(item.textFlowId)) {
        const key = JSON.stringify([settings, item.textScale, item.frameOptions, item.textKind]);
        if (framePresentation.get(element) === key) continue;
        framePresentation.set(element, key);
      } else framePresentation.delete(element);
      applyFrameTypography(element, settings);
      // Native glyphs already carry resolved run paint. Walking every SVG path
      // as browser rich text duplicates work and can decorate SVG title nodes.
      if (!composedFlows.has(item.textFlowId)) applyNamedTextStyles(element, doc);
      applyTextLayout(element, item);
    }
  }
}
