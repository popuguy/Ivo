/** Native clipboard writes acknowledge completion; callers must not report success before it. */
export function createDocumentClipboard({ clipboard, ClipboardItem }) {
  return {
    async copyPath(file, kind) {
      if (!['relative', 'absolute'].includes(kind))
        throw new Error('Choose a supported path format.');
      await clipboard.writeText(kind === 'relative' ? file.relativePath : file.absolutePath);
    },
    async copyLink({ id, title }) {
      const name = String(title || 'Untitled'),
        escape = (value) =>
          String(value).replace(
            /[&<>"']/g,
            (char) =>
              ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
          );
      await clipboard.write([
        new ClipboardItem({
          'text/plain': '[[' + name + ']]',
          'text/html': `<a data-doc-id="${escape(id)}" href="#doc=${encodeURIComponent(id)}">${escape(name)}</a>`,
        }),
      ]);
    },
  };
}
