import { hasListNumbering, markTypographyVersion } from './capabilities.js';
import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../text/typography.js';
import { uid, createBlock } from './model.js';
const STYLE_KEYS = Object.keys({ ...CHARACTER_FIELDS, ...PARAGRAPH_FIELDS });
const nativeComposition = (flow) =>
  flow.composition?.version === 1 &&
  ['paragraph', 'single-line'].includes(flow.composition.composer);

/** Explicitly choose the new authority without rewriting older flows on read. */
export function enableNativeComposition(document, textFlow, composer = 'paragraph') {
  if (!document.textFlows?.includes(textFlow) || !['paragraph', 'single-line'].includes(composer))
    throw new Error('Choose a document text flow and a supported composer.');
  textFlow.composition = { version: 1, composer };
  document.canvasVersion = Math.max(document.canvasVersion || 1, 7);
  if (hasListNumbering(document)) markTypographyVersion(document);
  return textFlow;
}

function continuationIds(document, textFlow) {
  // Normal UUID flow identities are retained verbatim. Long imported identities
  // receive a compact deterministic suffix to stay inside the stable-ID budget.
  let identity = textFlow.id;
  if (identity.length > 85) {
    let hash = 2166136261;
    for (const character of identity)
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    identity = identity.slice(0, 70) + '-' + hash.toString(36);
  }
  const used = new Set([
    document.id,
    ...document.pages.map((page) => page.id),
    ...document.blocks.map((frame) => frame.id),
    ...document.blocks.flatMap((frame) => (frame.points || []).map((point) => point.id)),
    ...(document.textFlows || []).map((flow) => flow.id),
    ...(document.publishing?.layers || []).map((layer) => layer.id),
    ...(document.publishing?.parents || []).flatMap((parent) => [
      parent.id,
      ...parent.blocks.map((block) => block.id),
      ...parent.blocks.flatMap((block) => (block.points || []).map((point) => point.id)),
    ]),
    ...(document.publishing?.paragraphStyles || []).map((style) => style.id),
    ...(document.publishing?.characterStyles || []).map((style) => style.id),
  ]);
  let ordinal = textFlow.frameIds.length;
  while (
    used.has(`page-auto-${identity}-${ordinal}`) ||
    used.has(`frame-auto-${identity}-${ordinal}`)
  )
    ordinal++;
  return { page: `page-auto-${identity}-${ordinal}`, frame: `frame-auto-${identity}-${ordinal}` };
}
export function textFlowForFrame(document, frame) {
  const id =
    typeof frame === 'string'
      ? document.blocks.find((b) => b.id === frame)?.textFlowId
      : frame?.textFlowId;
  return document.textFlows?.find((textFlow) => textFlow.id === id) || null;
}
/** Threaded text has one style owner. Frame geometry must not revive old character defaults. */
export function frameTextSettings(document, frame) {
  const flow = textFlowForFrame(document, frame);
  if (flow) return flow.style;
  const settings = typeof frame === 'string' ? document.blocks.find((b) => b.id === frame) : frame;
  // Quote is a source-owned default, not a hidden CSS-only character override.
  // Named styles and explicit textOverrides resolve above this base as usual.
  return settings?.type === 'quote' && settings.italic === undefined
    ? { ...settings, italic: true }
    : settings;
}
export function startTextFlow(
  document,
  frameId,
  { automaticPages = true, deleteEmptyPages = true } = {},
) {
  const frame = document.blocks.find((b) => b.id === frameId);
  if (!frame || !['text', 'quote'].includes(frame.type)) throw new Error('Choose a text frame.');
  const current = textFlowForFrame(document, frame);
  if (current) return current;
  const settings = frameTextSettings(document, frame),
    style = Object.fromEntries(
      STYLE_KEYS.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]),
    );
  if (frame.textOverrides) style.textOverrides = structuredClone(frame.textOverrides);
  const textFlow = {
    id: uid('flow-'),
    html: frame.html,
    frameIds: [frame.id],
    style,
    automaticPages,
    deleteEmptyPages,
    autoPages: [],
  };
  frame.type = 'text';
  frame.html = '';
  frame.textKind = 'area';
  frame.textFlowId = textFlow.id;
  (document.textFlows ||= []).push(textFlow);
  document.canvasVersion = Math.max(document.canvasVersion, 4);
  return textFlow;
}
export function threadFrame(document, fromId, targetId) {
  if (fromId === targetId) throw new Error('Choose another text frame.');
  const target = document.blocks.find((b) => b.id === targetId);
  if (
    !target ||
    target.type !== 'text' ||
    target.textFlowId ||
    target.html.replace(/<[^>]*>/g, '').trim()
  )
    throw new Error('Choose an empty, unthreaded text frame.');
  const textFlow = startTextFlow(document, fromId, { automaticPages: false });
  const index = textFlow.frameIds.indexOf(fromId);
  textFlow.frameIds.splice(index + 1, 0, targetId);
  target.textFlowId = textFlow.id;
  target.html = '';
  target.textKind = 'area';
  return textFlow;
}
export function appendTextFlowPage(document, textFlow) {
  if (document.pages.length >= 128 || document.blocks.length >= 1000) return null;
  const last = document.blocks.find((b) => b.id === textFlow.frameIds.at(-1)),
    index = document.pages.findIndex((p) => p.id === last.pageId),
    previous = document.pages[index];
  let x = last.x,
    y = last.y,
    parentId = last.parentId;
  while (parentId) {
    const parent = document.blocks.find((b) => b.id === parentId);
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId;
  }
  const ids = nativeComposition(textFlow) ? continuationIds(document, textFlow) : null;
  const page = {
    id: ids?.page || uid('page-'),
    name: `Page ${document.pages.length + 1}`,
    width: previous.width,
    height: previous.height,
    ...(previous.parentPageId ? { parentPageId: previous.parentPageId } : {}),
  };
  document.pages.splice(index + 1, 0, page);
  const frame = createBlock('text', {
    ...(ids ? { id: ids.frame } : {}),
    ...structuredClone(textFlow.style),
    pageId: page.id,
    textFlowId: textFlow.id,
    x,
    y,
    w: last.w,
    h: last.h,
    textScale: structuredClone(last.textScale || { x: 1, y: 1 }),
    ...(last.frameOptions ? { frameOptions: structuredClone(last.frameOptions) } : {}),
    ...(last.textWrap ? { textWrap: structuredClone(last.textWrap) } : {}),
    ...(last.ignoreTextWrap !== undefined ? { ignoreTextWrap: last.ignoreTextWrap } : {}),
    ...(last.layerId ? { layerId: last.layerId } : {}),
    html: '',
    textKind: 'area',
  });
  document.blocks.push(frame);
  textFlow.frameIds.push(frame.id);
  textFlow.autoPages.push({ pageId: page.id, frameId: frame.id });
  return frame;
}
export function removeTextFlowFrames(document, ids) {
  const removed = new Set(ids);
  for (const textFlow of document.textFlows || []) {
    if (nativeComposition(textFlow) && textFlow.frameIds.some((id) => removed.has(id)))
      textFlow.automaticPages = false;
    textFlow.frameIds = textFlow.frameIds.filter((id) => !removed.has(id));
    textFlow.autoPages = textFlow.autoPages.filter((value) => !removed.has(value.frameId));
  }
  if (document.textFlows)
    document.textFlows = document.textFlows.filter((textFlow) => textFlow.frameIds.length);
}
export function duplicateTextFlows(document, ids) {
  const additions = [];
  for (const textFlow of document.textFlows || []) {
    const frameIds = textFlow.frameIds.filter((id) => ids.has(id)).map((id) => ids.get(id));
    if (!frameIds.length) continue;
    const copy = {
      ...structuredClone(textFlow),
      id: uid('flow-'),
      frameIds,
      automaticPages: false,
      autoPages: [],
    };
    for (const id of frameIds) document.blocks.find((b) => b.id === id).textFlowId = copy.id;
    additions.push(copy);
  }
  if (additions.length) document.textFlows.push(...additions);
}
export function trimTextFlowPages(document, textFlow, used) {
  if (!textFlow.deleteEmptyPages) return false;
  let changed = false;
  for (const owned of [...textFlow.autoPages].reverse()) {
    const index = textFlow.frameIds.indexOf(owned.frameId);
    if (index < used || index < 0) continue;
    if (document.pages.some((page) => page.id === owned.pageId && page.section)) continue;
    if (document.blocks.some((b) => b.pageId === owned.pageId && b.id !== owned.frameId)) continue;
    document.pages = document.pages.filter((p) => p.id !== owned.pageId);
    document.blocks = document.blocks.filter((b) => b.id !== owned.frameId);
    textFlow.frameIds.splice(index, 1);
    textFlow.autoPages = textFlow.autoPages.filter((p) => p !== owned);
    changed = true;
  }
  return changed;
}
