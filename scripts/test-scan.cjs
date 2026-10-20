'use strict';
/**
 * 只测扫描：node scripts/test-scan.cjs ["站点目录"]`n * 不传目录时用 scripts/make-fixture.cjs 生成的合成测试站（不含真实个人信息）
 */
const { scan } = require('../lib/scanner');
const { humanBytes } = require('../lib/util');

const fixture = require('./make-fixture.cjs');
const root = process.argv[2] || fixture.main();

(async () => {
  const t0 = Date.now();
  const res = await scan({ root, onLog: (lvl, msg) => console.log('[' + lvl + '] ' + msg) });
  if (!res.ok) {
    console.error(res.error);
    process.exit(1);
  }
  console.log('\n=== 概览 ===');
  console.log('站点：', res.name, '| 入口：', res.indexHtml, '| 文件数：', res.stats.files, '| 体积：', humanBytes(res.stats.bytes));
  console.log('\n=== 文本敏感项（' + res.findings.length + '） ===');
  for (const f of res.findings) {
    console.log(
      '  [' +
        f.severity.padEnd(6) +
        '] ' +
        f.ruleLabel.padEnd(12) +
        ' ' +
        f.value.padEnd(22) +
        ' x' +
        String(f.count).padEnd(3) +
        ' → ' +
        f.maskPreview +
        '  (' +
        f.files.join(',') +
        ')'
    );
  }
  console.log('\n=== 图片（' + res.images.length + '） ===');
  for (const im of res.images) {
    console.log(
      '  ' + im.rel.padEnd(34) + (im.w && im.h ? im.w + 'x' + im.h : '?') + '  ' + humanBytes(im.bytes) + '  [' + im.tags.join(', ') + ']' + (im.gps ? ' GPS ' + im.gps.lat + ',' + im.gps.lng : '')
    );
  }
  console.log('\n=== 大文件 ===');
  res.largeFiles.forEach((f) => console.log('  ' + f.rel + '  ' + humanBytes(f.bytes)));
  console.log('\n=== 建议排除 ===');
  res.suggestedExcludes.forEach((f) => console.log('  ' + f.rel + '  ' + humanBytes(f.bytes) + '  — ' + f.reason));
  console.log('\n=== 警告 ===');
  res.warnings.forEach((w) => console.log('  ! ' + w));
  console.log('\n耗时 ' + (Date.now() - t0) + 'ms');
})();
