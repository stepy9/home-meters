// Draws the PNG icons (iOS needs a PNG apple-touch-icon) after icon.svg: three bars on blue. No dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Full-bleed square (iOS rounds the corners itself), shapes in the 64-unit grid of icon.svg.
const bars = [
  { x: 13, y: 30, w: 10, h: 22, color: hex("#fbbf24") },
  { x: 27, y: 14, w: 10, h: 38, color: hex("#ffffff") },
  { x: 41, y: 24, w: 10, h: 28, color: hex("#22d3ee") },
];
function png(size) {
  const s = size / 64;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / s;
      const v = (y + 0.5) / s;
      const bar = bars.find((b) => {
        if (u < b.x || u > b.x + b.w || v < b.y || v > b.y + b.h) return false;
        const r = 3;
        const cx = Math.min(Math.max(u, b.x + r), b.x + b.w - r);
        const cy = Math.min(Math.max(v, b.y + r), b.y + b.h - r);
        return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
      });
      row.set(bar ? bar.color : hex("#2563eb"), 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size));
