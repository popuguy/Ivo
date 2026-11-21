import { markTypographyVersion } from './capabilities.js';
import { contentsSettings } from './contents-settings.js';
import { LIMITS } from './constants.js';
import { addPage, insertObject } from './scene.js';
import { startTextFlow, textFlowForFrame } from './text-flows.js';
import { objectAvailable } from './publishing.js';
import { plainText } from '../text/html.js';

export function contentsOwner(doc, frame) {
  const flow = textFlowForFrame(doc, frame);
  return flow?.contents ? flow : null;
}

export function canPlaceContents(doc, frame) {
  if (frame?.type !== 'text' || frame.textKind === 'point') return false;
  const flow = textFlowForFrame(doc, frame);
  if (plainText(flow?.html ?? frame.html) || flow?.contents) return false;
  return (flow ? doc.blocks.filter((b) => b.textFlowId === flow.id) : [frame]).every((b) =>
    objectAvailable(doc, b),
  );
}

export function writeContents(doc, frame, html, settings, { update = false } = {}) {
  if (html.length > LIMITS.html)
    throw Error('The table of contents exceeds the document text limit.');
  const validated = contentsSettings(settings);
  const newPage = !frame && !update;
  if (update) {
    if (!contentsOwner(doc, frame)) throw Error('Select a table of contents to update.');
    const frames = frame.textFlowId
      ? doc.blocks.filter((b) => b.textFlowId === frame.textFlowId)
      : [frame];
    if (frames.some((b) => !objectAvailable(doc, b)))
      throw Error('Unlock every frame of the table of contents to update it.');
  } else if (frame) {
    if (!canPlaceContents(doc, frame)) throw Error('Choose an empty, unlocked area text frame.');
  } else {
    if (doc.pages.length >= 128 || doc.blocks.length >= LIMITS.blocksPerDocument)
      throw Error('The document has reached its page or object limit.');
    const page = addPage(doc, doc.pages.at(-1).id);
    page.name = (validated.title.trim() || 'Contents').slice(0, 180);
    const margin = Math.min(36, page.width / 8, page.height / 8);
    frame = insertObject(doc, 'text', page.id, {
      x: margin,
      y: margin,
      w: page.width - 2 * margin,
      h: page.height - 2 * margin,
      html: '',
      textKind: 'area',
    });
  }
  const flow = startTextFlow(doc, frame.id, { automaticPages: false });
  if (!update) flow.automaticPages = newPage;
  flow.html = html;
  flow.contents = validated;
  markTypographyVersion(doc);
  return frame;
}
