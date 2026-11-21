import { crc32, deflateSync } from 'node:zlib';

const colors = [
  [42, 71, 92],
  [192, 96, 59],
  [76, 106, 93],
  [211, 177, 126],
  [115, 94, 119],
  [95, 115, 147],
];
function chunk(tag, bytes) {
  const type = Buffer.from(tag);
  const out = Buffer.alloc(12 + bytes.length);
  out.writeUInt32BE(bytes.length);
  type.copy(out, 4);
  bytes.copy(out, 8);
  out.writeUInt32BE(crc32(bytes, crc32(type)), 8 + bytes.length);
  return out;
}
// Six original 3072 × 2048 indexed rasters. Repeated placements share the
// source file, just as multiple crops of a contact sheet would.
export function weavePNG(index) {
  const w = 3072,
    h = 2048,
    data = Buffer.alloc((w + 1) * h),
    header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 3;
  const palette = Buffer.alloc(256 * 3),
    color = colors[index];
  for (let j = 0; j < 256; j++)
    for (let c = 0; c < 3; c++)
      palette[j * 3 + c] = Math.max(0, Math.min(255, color[c] + (j - 124) * 0.65));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const twill = (x + 2 * y + index * 11) % 29;
      const band = (Math.floor((x + index * 71) / 173) + Math.floor(y / 137)) % 4;
      data[(w + 1) * y + x + 1] =
        62 + band * 23 + twill * 2 + (x % 5 < 2 ? 18 : 0) + (y % 7 < 2 ? 14 : 0);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('PLTE', palette),
    chunk('IDAT', deflateSync(data)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
