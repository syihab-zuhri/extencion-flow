// Generates flat-color PNG icons for the extension using only Node stdlib
// (PNG encoder + zlib). Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

const NAVY = [12, 45, 92, 255];      // #0C2D5C
const BLUE = [24, 95, 165, 255];     // #185FA5
const GOLD = [186, 117, 23, 255];    // #BA7517

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let c = ~0;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function makePng(size) {
  // RGBA raw rows
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size / 2;
  const boltW = size * 0.16;
  const cx = size * 0.52, cy = size * 0.5;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const i = rowStart + 1 + x * 4;
      const dx = x - r + 0.5, dy = y - r + 0.5;
      const inCircle = dx * dx + dy * dy <= (r - 1) * (r - 1);
      if (!inCircle) continue; // transparent outside
      let col = NAVY;
      // inner ring
      if (dx * dx + dy * dy <= (r * 0.78) ** 2) col = BLUE;
      // stylized lightning bolt: leaning bar with a jog at the middle
      const lx = x - cx, ly = y - cy;
      const s = size / 48;
      if (ly > -12 * s && ly < 14 * s) {
        const mid = Math.abs(ly) < 12 * s;
        const lean = lx + ly * 0.45;
        if (mid && lean > -boltW * 0.6 && lean < boltW * 0.9 && Math.abs(ly) < boltW * 1.8) col = GOLD;
      }
      raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2]; raw[i + 3] = col[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, color type RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  const file = join(outDir, `icon_${size}.png`);
  writeFileSync(file, makePng(size));
  console.log(`wrote ${file}`);
}
