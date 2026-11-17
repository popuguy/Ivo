import { createDocument, createBlock } from '../../src/domain/documents/model.js';
/** Legacy grid fixture. Production documents are created through scene commands. */
export function templateDocument(title, template = 'blank') {
  const doc = createDocument(title, template);
  doc.kicker = 'NOTEBOOK';
  doc.blocks = [
    createBlock('text', {
      html: '<p>Begin with a thought.</p>',
      x: 1,
      y: 1,
      w: 8,
      h: 12,
      fontSize: 20,
      textStyle: 'serif',
    }),
  ];
  doc.layout = { columns: 12, rows: 25 };
  return doc;
}
