import { markTypographyVersion } from './capabilities.js';
import { indexSettings } from './subject-index.js';
import { contentsSettings } from './contents-settings.js';
import { LIMITS } from './constants.js';
import { addPage, insertObject } from './scene.js';
import { startTextFlow, textFlowForFrame } from './text-flows.js';
import { objectAvailable } from './publishing.js';
import { plainText } from '../text/html.js';

export function generatedTextFlow(doc, frame) {
  const flow = textFlowForFrame(doc, frame);
  return flow?.contents || flow?.index ? flow : null;
}

export function canPlacePublicationText(doc, frame) {
  if (frame?.type !== 'text' || frame.textKind === 'point') return false;
  const flow = textFlowForFrame(doc, frame);
  if (plainText(flow?.html ?? frame.html) || flow?.contents || flow?.index) return false;
  return (flow ? doc.blocks.filter((b) => b.textFlowId === flow.id) : [frame]).every((b) =>
    objectAvailable(doc, b),
  );
}

export function writePublicationText(
  doc,
  frame,
  html,
  settings,
  { update = false, kind = 'contents' } = {},
) {
  if (!['contents', 'index'].includes(kind)) throw Error('Unknown publication type.');
  const label = kind === 'index' ? 'index' : 'table of contents';
  if (html.length > LIMITS.html) throw Error(`The ${label} exceeds the document text limit.`);
  const validated = kind === 'index' ? indexSettings(settings) : contentsSettings(settings);
  const newPage = !frame && !update;
  if (update) {
    if (!generatedTextFlow(doc, frame)?.[kind]) throw Error(`Select the ${label} to update.`);
    const frames = frame.textFlowId
      ? doc.blocks.filter((b) => b.textFlowId === frame.textFlowId)
      : [frame];
    if (frames.some((b) => !objectAvailable(doc, b)))
      throw Error(`Unlock every frame of the ${label} to update it.`);
  } else if (frame) {
    if (!canPlacePublicationText(doc, frame))
      throw Error('Choose an empty, unlocked area text frame.');
  } else {
    if (doc.pages.length >= 128 || doc.blocks.length >= LIMITS.blocksPerDocument)
      throw Error('The document has reached its page or object limit.');
    const page = addPage(doc, doc.pages.at(-1).id);
    page.name = (validated.title.trim() || (kind === 'index' ? 'Index' : 'Contents')).slice(0, 180);
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
  flow[kind] = validated;
  markTypographyVersion(doc);
  return frame;
}
