import { clipboard, ClipboardItem } from 'electron';

// Electron can return a zero-format item for a fresh macOS pasteboard.
export async function snapshotClipboard() {
  const items = await clipboard.read();
  return Promise.all(
    items
      .filter((item) => item.types.length > 0)
      .map(async (item) => {
        const entries = await Promise.all(
          item.types.map(async (type) => [type, await item.getType(type)]),
        );
        return new ClipboardItem(Object.fromEntries(entries));
      }),
  );
}
