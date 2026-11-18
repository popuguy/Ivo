/** Compatibility boundary for archives written before canonical text flows.
 * Read conversion only: supplied IDs, rich text, geometry and asset bytes stay intact.
 * The validator owns structural checks; opening a vault never rewrites old revisions.
 */
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export function migrateArchive(payload) {
  if (
    !payload ||
    ![1, 2, 3, 4, 5, 6, 7].includes(payload.schemaVersion) ||
    !Array.isArray(payload.documents)
  )
    return payload;
  let migrated = false;
  const documents = payload.documents.map((document) => {
    if (
      !document ||
      typeof document !== 'object' ||
      Array.isArray(document) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(document))
    )
      return document;
    const blocks = Array.isArray(document.blocks) ? document.blocks : [];
    const legacy =
      owns(document, 'stories') || blocks.some((block) => block && owns(block, 'storyId'));
    const current =
      owns(document, 'textFlows') || blocks.some((block) => block && owns(block, 'textFlowId'));
    if (legacy && (current || document.canvasVersion !== 3)) {
      throw new TypeError('Invalid archive: mixed or unsupported text flow representations.');
    }
    if (legacy || document.canvasVersion === 3) {
      if (payload.schemaVersion < 4)
        throw new TypeError('Invalid archive: linked text requires archive schema 4 or later.');
      if (current)
        throw new TypeError('Invalid archive: current text flows require canvas version 4.');
      migrated = true;
      const { stories, ...rest } = document;
      return {
        ...rest,
        canvasVersion: 4,
        ...(stories === undefined ? {} : { textFlows: stories }),
        blocks: blocks.map((block) => {
          if (!block || !owns(block, 'storyId')) return block;
          const { storyId, ...rest } = block;
          return { ...rest, textFlowId: storyId };
        }),
      };
    }
    return document;
  });
  return migrated
    ? { ...payload, schemaVersion: Math.max(5, payload.schemaVersion), documents }
    : payload;
}
