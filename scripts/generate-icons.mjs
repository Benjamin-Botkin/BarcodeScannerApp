import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Draws a simple "scanner" icon: teal background, rounded-corner viewfinder
// brackets, and a row of barcode-like bars in the center.
function renderIcon(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const bg = [13, 148, 136]; // teal-600
  const fg = [255, 255, 255];

  const set = (x, y, color, alpha = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = alpha;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) set(x, y, bg);
  }

  // Corner viewfinder brackets
  const m = Math.round(size * 0.16); // margin
  const bl = Math.round(size * 0.22); // bracket arm length
  const t = Math.max(2, Math.round(size * 0.045)); // bracket thickness
  const corners = [
    [m, m, 1, 1],
    [size - m, m, -1, 1],
    [m, size - m, 1, -1],
    [size - m, size - m, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    for (let i = 0; i < bl; i++) {
      for (let w = 0; w < t; w++) {
        set(cx + dx * i, cy + dy * w * dy, fg);
        set(cx + dx * w * dx, cy + dy * i, fg);
      }
    }
  }

  // Barcode bars in the center
  const barsTop = Math.round(size * 0.4);
  const barsHeight = Math.round(size * 0.2);
  const widths = [3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2];
  const unit = Math.max(1, Math.round(size * 0.018));
  let bx = Math.round(size * 0.3);
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i] * unit;
    if (i % 2 === 0) {
      for (let yy = 0; yy < barsHeight; yy++) {
        for (let xx = 0; xx < w; xx++) set(bx + xx, barsTop + yy, fg);
      }
    }
    bx += w;
  }

  return px;
}

function encodePng(size) {
  const px = renderIcon(size);
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(px.buffer, y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes = [32, 180, 192, 512];
for (const size of sizes) {
  const png = encodePng(size);
  const name =
    size === 180
      ? "apple-touch-icon.png"
      : size === 32
        ? "favicon-32.png"
        : `icon-${size}.png`;
  writeFileSync(join(outDir, name), png);
  console.log(`wrote ${name} (${png.length} bytes)`);
}
