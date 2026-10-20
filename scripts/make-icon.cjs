'use strict';
/**
 * 生成程序图标 build/icon.ico（零依赖，纯手写像素 + ICO 封装）。
 *
 * 为什么不用图片库：这个项目刻意保持「零运行时依赖」，图标是构建期产物，
 * 没必要为了一个图标引入 sharp / canvas。这里直接用 4 倍超采样画圆角方块 + 上传箭头，
 * 再按 ICO 规范打包成多尺寸（BMP/DIB 格式，兼容性最好，连老工具都认）。
 *
 * 用法：node scripts/make-icon.cjs
 */
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SS = 4; // 超采样倍数（抗锯齿）

/* ------------------------------------------------------------ 画图 */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 判断归一化坐标 (u,v) 是否在圆角矩形内 */
function inRoundRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  const dx = u - cx;
  const dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 上传箭头（竖杆 + 三角头 + 底座），返回 true 表示该点属于箭头 */
function inArrow(u, v) {
  const shaft = Math.abs(u - 0.5) <= 0.085 && v >= 0.30 && v <= 0.70;
  const headTop = 0.17;
  const headBottom = 0.475;
  let head = false;
  if (v >= headTop && v <= headBottom) {
    const t = (v - headTop) / (headBottom - headTop);
    const halfW = 0.05 + t * 0.235;
    head = Math.abs(u - 0.5) <= halfW;
  }
  const tray = inRoundRect(u, v, 0.225, 0.755, 0.775, 0.845, 0.045);
  return shaft || head || tray;
}

/**
 * 画一张 size×size 的 RGBA 图。
 * 背景：蓝色渐变圆角方块（在深色/浅色桌面上都醒目）
 * 前景：白色上传箭头
 */
function render(size) {
  const out = Buffer.alloc(size * size * 4, 0);
  const N = size * SS;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px * SS + sx + 0.5) / N;
          const v = (py * SS + sy + 0.5) / N;
          if (!inRoundRect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22)) continue;
          let cr;
          let cg;
          let cb;
          if (inArrow(u, v)) {
            cr = 255;
            cg = 255;
            cb = 255;
          } else {
            // 对角渐变 #5AA6FF → #2A63D8
            const t = Math.min(1, Math.max(0, (u + v) / 2));
            cr = Math.round(lerp(0x5a, 0x2a, t));
            cg = Math.round(lerp(0xa6, 0x63, t));
            cb = Math.round(lerp(0xff, 0xd8, t));
          }
          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }
      const total = SS * SS;
      const o = (py * size + px) * 4;
      if (a === 0) continue;
      const cover = a / (total * 255); // 0~1 覆盖率
      out[o] = Math.round(r / (a / 255)); // 只对覆盖到的子像素求平均
      out[o + 1] = Math.round(g / (a / 255));
      out[o + 2] = Math.round(b / (a / 255));
      out[o + 3] = Math.round(cover * 255);
    }
  }
  return out;
}

/* ------------------------------------------------------------ ICO 封装 */

/** RGBA → BMP(DIB) 数据：BITMAPINFOHEADER + 自下而上的 BGRA + AND 掩码 */
function toDib(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight（XOR + AND 两张图，所以要 ×2）
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  header.writeUInt32LE(size * size * 4, 20); // biSizeImage
  header.writeInt32LE(0, 24);
  header.writeInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4; // DIB 自下而上
    const dstRow = y * size * 4;
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }

  // AND 掩码：1bpp，每行按 4 字节对齐；全 0 表示「用 alpha 通道」
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size, 0);

  return Buffer.concat([header, xor, mask]);
}

function buildIco(sizes) {
  const images = sizes.map((size) => {
    const rgba = render(size);
    return { size, data: toDib(rgba, size) };
  });

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // 256 用 0 表示
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
    e.writeUInt8(0, 2); // 调色板数
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += img.data.length;
  }

  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]);
}

/* ------------------------------------------------------------ PNG 预览 */

/**
 * 顺手写一张 256×256 的 PNG 预览（build/icon-preview.png）。
 * 只为「生成后肉眼确认图标长得对不对」，用 Node 内建 zlib 手写最小 PNG 编码器。
 */
function writePng(file, rgba, w, h) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : require('zlib').crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

/* ------------------------------------------------------------ main */

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const ico = buildIco(SIZES);
const icoPath = path.join(outDir, 'icon.ico');
fs.writeFileSync(icoPath, ico);

const previewPath = path.join(outDir, 'icon-preview.png');
writePng(previewPath, render(256), 256, 256);

console.log('已生成 ' + icoPath + '（' + SIZES.join('/') + '，共 ' + Math.round(ico.length / 1024) + ' KB）');
console.log('已生成预览图 ' + previewPath + '（用于肉眼确认图标）');
