import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../text/typography.js';

const native = (flow) =>
  flow.composition?.version === 1 &&
  ['paragraph', 'single-line'].includes(flow.composition.composer);
const typography = new Set([
  ...Object.keys(CHARACTER_FIELDS),
  ...Object.keys(PARAGRAPH_FIELDS),
  'textOverrides',
  'html',
]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const frameContent = (frame) =>
  Object.fromEntries(Object.entries(frame).filter(([key]) => !typography.has(key)));

function pureOwnership(document) {
  const pages = new Map((document.pages || []).map((page) => [page.id, page])),
    frames = new Map(document.blocks.map((frame) => [frame.id, frame])),
    contents = new Map(),
    candidates = [],
    pageClaims = new Map(),
    frameClaims = new Map(),
    pageIdentities = new Map(),
    frameIdentities = new Map(),
    memberships = new Map();
  for (const page of document.pages || [])
    pageIdentities.set(page.id, (pageIdentities.get(page.id) || 0) + 1);
  for (const block of document.blocks) {
    frameIdentities.set(block.id, (frameIdentities.get(block.id) || 0) + 1);
    if (!contents.has(block.pageId)) contents.set(block.pageId, []);
    contents.get(block.pageId).push(block);
  }
  for (const flow of document.textFlows || []) {
    for (const id of flow.frameIds || []) memberships.set(id, (memberships.get(id) || 0) + 1);
    for (const owned of flow.autoPages || []) {
      pageClaims.set(owned.pageId, (pageClaims.get(owned.pageId) || 0) + 1);
      frameClaims.set(owned.frameId, (frameClaims.get(owned.frameId) || 0) + 1);
      if (!native(flow)) continue;
      const page = pages.get(owned.pageId),
        frame = frames.get(owned.frameId);
      if (
        page &&
        frame &&
        frame.type === 'text' &&
        frame.textKind === 'area' &&
        frame.html === '' &&
        frame.textFlowId === flow.id &&
        frame.pageId === page.id &&
        !frame.parentId &&
        flow.frameIds.includes(frame.id) &&
        contents.get(page.id)?.length === 1
      )
        candidates.push({ flow, owned, page, frame });
    }
  }
  return candidates.filter(
    ({ owned }) =>
      pageClaims.get(owned.pageId) === 1 &&
      frameClaims.get(owned.frameId) === 1 &&
      pageIdentities.get(owned.pageId) === 1 &&
      frameIdentities.get(owned.frameId) === 1 &&
      memberships.get(owned.frameId) === 1,
  );
}

/**
 * Read-only authored-content projection for equality/history checks. Saved documents
 * and history snapshots retain full derived pages. Only unmodified, exclusively
 * owned native continuation pages are omitted; legacy and mixed-content pages stay.
 */
export function authoredLayoutDocument(document) {
  const owned = pureOwnership(document);
  if (!owned.length) return document;
  const pageIds = new Set(owned.map((value) => value.page.id)),
    frameIds = new Set(owned.map((value) => value.frame.id));
  return {
    ...document,
    pages: document.pages.filter((page) => !pageIds.has(page.id)),
    blocks: document.blocks.filter((frame) => !frameIds.has(frame.id)),
    textFlows: document.textFlows.map((flow) => ({
      ...flow,
      frameIds: flow.frameIds.filter((id) => !frameIds.has(id)),
      autoPages: flow.autoPages.filter((value) => !pageIds.has(value.pageId)),
    })),
  };
}

/**
 * Before recording an intentional command, release affected native page ownership
 * on `after`. Source/typography changes alone do not promote pages. Derived layout
 * updates bypass this operation. Neither `before` nor source/style data is changed.
 */
export function promoteTextLayout(before, after) {
  const previous = new Map(pureOwnership(before).map((value) => [value.frame.id, value])),
    derivedFrames = new Set([
      ...previous.keys(),
      ...pureOwnership(after).map((value) => value.frame.id),
    ]),
    nextFrames = new Map(after.blocks.map((frame) => [frame.id, frame])),
    nextPages = new Map((after.pages || []).map((page) => [page.id, page])),
    commonPages = new Set(
      (before.pages || []).map((page) => page.id).filter((id) => nextPages.has(id)),
    ),
    oldOrder = (before.pages || []).map((page) => page.id).filter((id) => commonPages.has(id)),
    newOrder = (after.pages || []).map((page) => page.id).filter((id) => commonPages.has(id));
  let count = 0;
  for (const flow of after.textFlows || []) {
    if (!native(flow)) continue;
    const oldFlow = (before.textFlows || []).find((candidate) => candidate.id === flow.id),
      common = new Set((oldFlow?.frameIds || []).filter((id) => flow.frameIds.includes(id))),
      threadChanged =
        oldFlow &&
        (!same(
          oldFlow.frameIds.filter((id) => !derivedFrames.has(id)),
          flow.frameIds.filter((id) => !derivedFrames.has(id)),
        ) ||
          !same(
            oldFlow.frameIds.filter((id) => common.has(id)),
            flow.frameIds.filter((id) => common.has(id)),
          ));
    flow.autoPages = flow.autoPages.filter((owned) => {
      const old = previous.get(owned.frameId);
      if (!old || old.flow.id !== flow.id) return true;
      const frame = nextFrames.get(owned.frameId),
        page = nextPages.get(owned.pageId),
        oldBefore = new Set(oldOrder.slice(0, oldOrder.indexOf(owned.pageId))),
        newBefore = new Set(newOrder.slice(0, newOrder.indexOf(owned.pageId))),
        reordered =
          oldBefore.size !== newBefore.size || [...oldBefore].some((id) => !newBefore.has(id)),
        extraObject = after.blocks.some(
          (block) => block.pageId === owned.pageId && block.id !== owned.frameId,
        ),
        changed =
          threadChanged ||
          reordered ||
          extraObject ||
          !frame ||
          !page ||
          !same(old.page, page) ||
          !same(frameContent(old.frame), frameContent(frame));
      if (changed) count++;
      return !changed;
    });
  }
  // Missing pure pages may be an asynchronous shrink during an open typing batch.
  // Explicit deletion is distinguished by the domain removal command, which turns
  // off automatic append; inferring intent from missing geometry would be unsafe.
  return count;
}
