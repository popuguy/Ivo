import { inspectFont } from '../../../domain/text/fonts.js';
/** Validate/decode before committing an immutable, deduplicated vault asset. */
export async function prepareFont(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()),
    font = inspectFont(bytes);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  let data = '';
  for (let i = 0; i < bytes.length; i += 32768)
    data += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const asset = {
    id: 'font-' + hash,
    name: file.name,
    mimeType: font.mimeType,
    data: `data:${font.mimeType};base64,${btoa(data)}`,
    font,
  };
  // Browser sanitization/decoding is a separate gate from metadata validation.
  await new FontFace('ivo-' + asset.id, bytes, {
    weight: String(font.weight),
    style: font.italic ? 'italic' : 'normal',
  }).load();
  return asset;
}
