import { uid } from '../../../domain/documents/model.js';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_BYTES = 20 * 1024 * 1024;

/** Prefer actual bitmap files; browsers can expose the same file twice. */
export function clipboardImages(clipboard) {
  const items = [...(clipboard?.items || [])].filter(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
  const files = items.length
    ? items.map((item) => item.getAsFile()).filter(Boolean)
    : [...(clipboard?.files || [])].filter((file) => file.type.startsWith('image/'));
  if (files.length) return files;
  // Rich clipboard formats sometimes carry an embedded bitmap instead of a
  // file item. Only embedded data is accepted here; no remote fetch is needed.
  const html = clipboard?.getData?.('text/html');
  if (!html || typeof document === 'undefined') return [];
  const template = document.createElement('template');
  template.innerHTML = html;
  return [...template.content.querySelectorAll('img[src]')].flatMap((image) => {
    const match = image
      .getAttribute('src')
      .match(/^data:(image\/(?:jpeg|png|webp|gif|avif));base64,([A-Za-z0-9+/]*={0,2})$/i);
    if (!match || match[2].length > (MAX_BYTES * 4) / 3 + 4) return [];
    try {
      const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
      return [
        new File([bytes], 'Pasted image.' + match[1].split('/')[1], {
          type: match[1].toLowerCase(),
        }),
      ];
    } catch {
      return [];
    }
  });
}

/** Decode before writing anything. The UI owns document selection and undo. */
export async function prepareImages(files, { readFile, measureImage = imageSize } = {}) {
  const prepared = [];
  for (const file of files) {
    if (!IMAGE_TYPES.includes(file.type))
      throw new Error('Paste a PNG, JPEG, WebP, GIF or AVIF image.');
    if (file.size > MAX_BYTES) throw new Error('Choose an image smaller than 20 MB.');
    const data = await readFile(file);
    const size = await measureImage(file, data);
    if (![size.width, size.height].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('This image could not be decoded.');
    prepared.push({
      asset: { id: uid('asset-'), name: file.name || 'Pasted image', mimeType: file.type, data },
      size,
    });
  }
  return prepared;
}

async function imageSize(file, data) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      /* Try the WebView's normal image decoder. */
    }
  }
  const image = new Image();
  image.src = data;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
