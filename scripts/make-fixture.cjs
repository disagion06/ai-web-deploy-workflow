'use strict';
/**
 * 生成「合成脏站」测试夹具：node scripts/make-fixture.cjs [输出目录]
 *
 * 为什么需要它：
 *   冒烟测试原先直接指向作者本机的真实作品集目录，里面全是真实个人信息。
 *   这带来两个问题：
 *     1. 仓库一旦公开，测试脚本里就带着真实手机号 / 邮箱 / 姓名；
 *     2. 换任何一台机器，`npm run smoke` 都跑不过（路径不存在、值对不上）。
 *
 *   所以这里在运行时生成一个 **完全合成** 的站点，包含：
 *     - 各类应当命中的敏感信息（手机号 / 邮箱 / 姓名 / 出生年月 / 学校 / 城市 / 已打码手机号）
 *     - 一条"不许命中"的误报陷阱（三届全国大学生广告大赛）
 *     - 已打码手机号（medium，默认保留）
 *     - 人像图片（文件名与 alt 都能被 PORTRAIT_RE 命中）
 *     - 两个超过 50MB 的视频（用稀疏文件，秒级生成，用于验证大文件提示与排除逻辑）
 *     - `_backup/` `_shots/` 两个应被建议排除的目录
 *
 * 所有值都是公开的假数据：13800138000 / demo@example.com / 王小明 / 示例大学 / 2000.01
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.work', 'fixture-site'));

/* ------------------------------------------------------------ PNG 编码（零依赖） */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** 生成一张 w×h 的纯色 PNG */
function makePng(w, h, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowLen = 1 + w * 3;
  const raw = Buffer.alloc(rowLen * h);
  for (let y = 0; y < h; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 3;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------ 站点内容 */

const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>示例作品集（合成测试站）</title>
</head>
<body>
<header class="hero">
  <img src="assets/portrait-demo.png" alt="示例头像" width="160" height="160">
  <h1 class="hero-name">王小明</h1>
  <p class="hero-sub">新媒体运营 · 昆明</p>
</header>

<main>
  <section class="info">
    <h2>基本信息</h2>
    <p>姓名：王小明</p>
    <div class="info-item"><span class="info-label">出生年月</span><span class="info-val">2000.01</span></div>
    <div class="info-item"><span class="info-label">联系电话</span><span class="info-val">13800138000</span></div>
    <div class="info-item"><span class="info-label">备用电话</span><span class="info-val">138 **** 8000</span></div>
    <div class="info-item"><span class="info-label">邮箱</span><span class="info-val">demo@example.com</span></div>
    <div class="info-item"><span class="info-label">学校</span><span class="info-val">示例大学</span></div>
  </section>

  <section class="works">
    <h2>作品</h2>
    <p>荣获三届全国大学生广告大赛优秀奖（这一句是用来验证「学校规则不许误报」的陷阱）。</p>
    <video controls preload="none" src="assets/video-demo.mp4"></video>
    <video controls preload="none" src="assets/video-extra.mp4"></video>
  </section>
</main>

<footer>
  <p>联系：13800138000 · demo@example.com</p>
</footer>
</body>
</html>
`;

const BACKUP_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>旧版备份</title></head>
<body><p>这是一个旧版备份页，不应出现在上线目录里。</p></body></html>
`;

/* ------------------------------------------------------------ 执行 */

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  fs.writeFileSync(path.join(OUT, 'index.html'), INDEX_HTML, 'utf8');

  const assetsDir = path.join(OUT, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  // 人像图片：文件名含 portrait，alt 含「头像」，两处都能命中 PORTRAIT_RE
  fs.writeFileSync(path.join(assetsDir, 'portrait-demo.png'), makePng(48, 48, [214, 176, 143]));

  // 两个大视频：用稀疏文件凑体积（秒级），并写出合法的 MP4 头，
  // 这样 lib/assets.js 的编码探测能正常走通（这里给 H.264，避免被当成需转码）
  for (const name of ['video-demo.mp4', 'video-extra.mp4']) {
    const p = path.join(assetsDir, name);
    fs.writeFileSync(p, mp4WithH264());
    fs.truncateSync(p, 52 * 1024 * 1024);
  }

  // 应被建议排除的目录
  fs.mkdirSync(path.join(OUT, '_backup'), { recursive: true });
  fs.writeFileSync(path.join(OUT, '_backup', 'index-v1.html'), BACKUP_HTML, 'utf8');
  fs.mkdirSync(path.join(OUT, '_shots'), { recursive: true });
  fs.writeFileSync(path.join(OUT, '_shots', 'note.txt'), '截图临时目录，不应上线。\n', 'utf8');

  console.log('合成测试站已生成：' + OUT);
  return OUT;
}

/**
 * 拼一个最小但结构合法的 MP4：ftyp + moov(trak/mdia/minf/stbl/stsd with avc1) + mdat。
 * 只为让编码探测（lib/assets.js 的 stsd 解析）有东西可读，不含真实视频数据。
 */
function mp4WithH264() {
  const box = (type, payload) => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(8 + payload.length, 0);
    return Buffer.concat([size, Buffer.from(type, 'latin1'), payload]);
  };
  const full = (type, payload) => box(type, Buffer.concat([Buffer.alloc(4), payload]));

  // stsd：version/flags(4) + entry_count(4) + [size(4) + 'avc1' + 少量填充]
  const entryBody = Buffer.alloc(16);
  entryBody.writeUInt32BE(24, 0);
  entryBody.write('avc1', 4, 'latin1');
  const stsd = full('stsd', Buffer.concat([uint32(1), entryBody]));

  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', minf);
  const trak = box('trak', mdia);
  const moov = box('moov', trak);
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom', 'latin1'), uint32(512), Buffer.from('isomiso2avc1mp41', 'latin1')]));
  const mdat = box('mdat', Buffer.alloc(64));

  return Buffer.concat([ftyp, moov, mdat]);
}

function uint32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

if (require.main === module) main();

module.exports = { main, OUT, makePng };
